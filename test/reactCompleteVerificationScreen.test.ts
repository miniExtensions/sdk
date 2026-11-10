import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    CompleteVerificationScreen,
    type CompleteVerificationScreenProps,
} from '../src/react/index.js';
import { NativeVerificationOracle } from './fixtures/nativeVerificationOracle.js';

type Result = Readonly<object>;
type Props = CompleteVerificationScreenProps<Result>;
const labels = {
    sentCodeTo: 'We sent a code to',
    enterCode: 'Verification code',
    continue: 'Continue',
    reload: 'Reload',
    attemptsExhausted: 'Attempts exhausted',
    loading: 'Loading',
};
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

async function fixture(
    t: TestContext,
    implementation: 'native' | 'sdk',
    patch: Partial<Props> = {}
) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    const result = Object.freeze({});
    const requests: { verificationId: string; verificationCode: string }[] = [];
    const continuations: Result[] = [];
    const errors: Error[] = [];
    let reloads = 0,
        mounted = true;
    let props: Props = {
        verificationId: 'challenge-A',
        maskedDestination: 's***@example.invalid',
        labels,
        async confirm(input) {
            requests.push(input);
            return result;
        },
        async continueWithResult(value) {
            continuations.push(value);
        },
        reload() {
            reloads++;
        },
        onError(error) {
            errors.push(error);
        },
        ...patch,
    };
    const render = async () => {
        await act(async () =>
            root.render(
                h(
                    StrictMode,
                    null,
                    implementation === 'native'
                        ? h(NativeVerificationOracle<Result>, props)
                        : h(CompleteVerificationScreen<Result>, props)
                )
            )
        );
    };
    const unmount = async () => {
        if (mounted) {
            mounted = false;
            await act(async () => root.unmount());
        }
    };
    t.after(async () => {
        try {
            await unmount();
        } finally {
            keys.forEach((key, i) => {
                const descriptor = originals[i];
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    });
    const input = () => {
        const node = container.querySelector('input');
        assert.ok(node);
        return node;
    };
    const edit = async (value: string) => {
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            )?.set;
            assert.ok(setter);
            setter.call(input(), value);
            input().dispatchEvent(new window.Event('input', { bubbles: true }));
        });
    };
    // Deliberate synthetic submit models native programmatic form dispatch;
    // trusted Enter/pattern validation are separately proved in Chromium.
    const submit = async () => {
        const form = container.querySelector('form');
        assert.ok(form);
        let prevented = false;
        await act(async () => {
            const event = new window.Event('submit', {
                bubbles: true,
                cancelable: true,
            });
            form.dispatchEvent(event);
            prevented = event.defaultPrevented;
        });
        assert.equal(prevented, true);
    };
    await render();
    return {
        container,
        input,
        edit,
        submit,
        requests,
        continuations,
        errors,
        result,
        unmount,
        reloads: () => reloads,
        async update(next: Partial<Props>) {
            props = { ...props, ...next };
            await render();
        },
    };
}

for (const implementation of ['native', 'sdk'] as const) {
    it(`${implementation}: caches a confirmed result before failed continuation and retries only continuation`, async (t) => {
        let calls = 0;
        const seen: Result[] = [];
        const f = await fixture(t, implementation, {
            async continueWithResult(value) {
                seen.push(value);
                if (++calls === 1) throw new Error('Load failed');
            },
        });
        assert.equal(f.container.querySelector('button')?.disabled, true);
        await f.edit('123456');
        await f.submit();
        assert.equal(
            f.container.querySelector('[role=alert]')?.textContent,
            'Load failed'
        );
        await f.edit('654321');
        assert.equal(
            f.container.querySelector('[role=alert]')?.textContent,
            'Load failed'
        );
        await f.submit();
        assert.equal(f.requests.length, 1);
        assert.equal(calls, 2);
        assert.equal(seen[0], f.result);
        assert.equal(seen[1], f.result);
        assert.ok(f.container.querySelector('[role=status]'));
        assert.equal(f.container.querySelector('form'), null);
    });
    it(`${implementation}: settled challenge change retains code/error and requires fresh confirmation`, async (t) => {
        const f = await fixture(t, implementation, {
            async continueWithResult() {
                throw new Error('Load failed');
            },
        });
        await f.edit('123456');
        await f.submit();
        await f.update({ verificationId: 'challenge-B' });
        assert.equal(f.input().value, '123456');
        assert.equal(
            f.container.querySelector('[role=alert]')?.textContent,
            'Load failed'
        );
        await f.submit();
        assert.deepEqual(
            f.requests.map((x) => x.verificationId),
            ['challenge-A', 'challenge-B']
        );
    });
    it(`${implementation}: invalid confirmation is not cached and corrected input is raw`, async (t) => {
        let calls = 0;
        const result = Object.freeze({});
        const inputs: string[] = [];
        const seen: Result[] = [];
        const f = await fixture(t, implementation, {
            async confirm(input) {
                inputs.push(input.verificationCode);
                if (++calls === 1) throw new Error('Invalid code');
                return result;
            },
            async continueWithResult(value) {
                seen.push(value);
            },
        });
        await f.edit('000000');
        await f.submit();
        assert.equal(seen.length, 0);
        assert.equal(
            f.container.querySelector('[role=alert]')?.textContent,
            'Invalid code'
        );
        await f.edit('001234');
        await f.submit();
        assert.deepEqual(inputs, ['000000', '001234']);
        assert.equal(seen[0], result);
    });
    it(`${implementation}: exhausted attempts activates Reload with no new confirmation or continuation`, async (t) => {
        let confirms = 0;
        const f = await fixture(t, implementation, {
            async confirm() {
                confirms++;
                throw new Error(labels.attemptsExhausted);
            },
        });
        await f.edit('000000');
        await f.submit();
        assert.equal(
            f.container.querySelector('button')?.textContent,
            'Reload'
        );
        await f.submit();
        assert.equal(f.reloads(), 1);
        assert.equal(confirms, 1);
        assert.equal(f.continuations.length, 0);
    });
    it(`${implementation}: pending confirmation captures original callback and challenge-specific cache identity`, async (t) => {
        const held = deferred<Result>();
        const resultA = Object.freeze({});
        const resultB = Object.freeze({});
        const requested: string[] = [];
        let old = 0,
            next = 0;
        const f = await fixture(t, implementation, {
            confirm(input) {
                requested.push(input.verificationId);
                return input.verificationId === 'challenge-A'
                    ? held.promise
                    : Promise.resolve(resultB);
            },
            async continueWithResult(value) {
                assert.equal(value, resultA);
                old++;
                throw new Error('Old continuation failed');
            },
        });
        await f.edit('123456');
        await f.submit();
        assert.equal(f.container.querySelector('input'), null);
        await f.update({
            verificationId: 'challenge-B',
            async continueWithResult(value) {
                assert.equal(value, resultB);
                next++;
            },
        });
        await act(async () => held.resolve(resultA));
        assert.equal(old, 1);
        assert.equal(next, 0);
        assert.equal(f.input().value, '123456');
        await f.submit();
        assert.equal(next, 1);
        assert.deepEqual(requested, ['challenge-A', 'challenge-B']);
    });
    it(`${implementation}: pending continuation stays captured; cached retry uses the newer callback`, async (t) => {
        const held = deferred<void>();
        let old = 0,
            next = 0;
        const f = await fixture(t, implementation, {
            async continueWithResult() {
                old++;
                await held.promise;
            },
        });
        await f.edit('123456');
        await f.submit();
        assert.equal(old, 1);
        await f.update({
            async continueWithResult(value) {
                assert.equal(value, f.result);
                next++;
            },
        });
        await act(async () => held.reject('Late load failure'));
        assert.equal(next, 0);
        assert.equal(f.errors[0]?.message, 'Late load failure');
        await f.submit();
        assert.equal(next, 1);
        assert.equal(f.requests.length, 1);
    });
    it(`${implementation}: unmount does not cancel admitted confirmation/continuation`, async (t) => {
        const held = deferred<Result>();
        const result = Object.freeze({});
        let calls = 0;
        const f = await fixture(t, implementation, {
            confirm: () => held.promise,
            async continueWithResult(value) {
                assert.equal(value, result);
                calls++;
            },
        });
        await f.edit('123456');
        await f.submit();
        await f.unmount();
        await act(async () => held.resolve(result));
        assert.equal(calls, 1);
        assert.equal(f.container.textContent, '');
    });
    it(`${implementation}: synthetic submit does not invent a handler-only empty or pattern guard`, async (t) => {
        const f = await fixture(t, implementation, {
            async continueWithResult() {
                throw new Error('Synthetic load failure');
            },
        });
        await f.submit();
        assert.equal(f.requests[0]?.verificationCode, '');
        await f.update({ verificationId: 'challenge-B' });
        await f.edit('raw text');
        await f.submit();
        assert.equal(f.requests[1]?.verificationCode, 'raw text');
    });
    it(`${implementation}: locale change preserves the error but current exact localized text selects Reload`, async (t) => {
        let confirms = 0;
        const f = await fixture(t, implementation, {
            async confirm() {
                confirms++;
                throw new Error(labels.attemptsExhausted);
            },
        });
        await f.edit('123456');
        await f.submit();
        await f.update({
            maskedDestination: '***42',
            labels: {
                sentCodeTo: 'Code envoyé à',
                enterCode: 'Code de vérification',
                continue: 'Continuer',
                reload: 'Recharger',
                attemptsExhausted: 'Essais épuisés',
                loading: 'Chargement',
            },
        });
        assert.equal(
            f.container.querySelector('button')?.textContent,
            'Continuer'
        );
        assert.equal(
            f.container.querySelector('[role=alert]')?.textContent,
            labels.attemptsExhausted
        );
        assert.equal(f.input().placeholder, 'Code de vérification');
        await f.submit();
        assert.equal(confirms, 2);
        assert.equal(f.reloads(), 0);
    });
    it(`${implementation}: A→B→A after successful confirmations replaces the one-entry cache`, async (t) => {
        const f = await fixture(t, implementation, {
            async continueWithResult() {
                throw new Error('Load failed');
            },
        });
        await f.edit('123456');
        await f.submit();
        await f.update({ verificationId: 'challenge-B' });
        await f.submit();
        await f.update({ verificationId: 'challenge-A' });
        await f.submit();
        assert.deepEqual(
            f.requests.map((x) => x.verificationId),
            ['challenge-A', 'challenge-B', 'challenge-A']
        );
    });
}

it('complete screen SSR has unique labels, literal destination, no service call or private result', () => {
    const props: Props = {
        verificationId: 'synthetic',
        maskedDestination: '<b>***42</b>',
        labels,
        confirm() {
            throw new Error('SSR confirmation');
        },
        continueWithResult() {
            throw new Error('SSR continuation');
        },
        reload() {
            assert.fail('SSR reload');
        },
    };
    const html = renderToString(
        h(
            'div',
            null,
            h(CompleteVerificationScreen<Result>, props),
            h(CompleteVerificationScreen<Result>, props)
        )
    );
    const ids = [...html.matchAll(/<input[^>]*id="([^"]+)"/g)].map((x) => x[1]);
    assert.equal(new Set(ids).size, 2);
    assert.ok(html.includes('&lt;b&gt;***42&lt;/b&gt;'));
    assert.ok(!html.includes('<b>***42</b>'));
    assert.ok(!html.includes('synthetic'));
    assert.ok(html.includes('type="submit"'));
});

it('complete screen keeps error formatting separate from exhaustion and renders pending decoration only pending', async (t) => {
    const f = await fixture(t, 'sdk', {
        async confirm() {
            throw new Error(labels.attemptsExhausted);
        },
        formatErrorMessage: (message) => `Displayed: ${message}`,
        pendingDetails: h('aside', null, 'Host timeout/help'),
    });
    assert.equal(f.container.querySelector('aside'), null);
    await f.edit('123456');
    await f.submit();
    assert.equal(
        f.container.querySelector('[role=alert]')?.textContent,
        `Displayed: ${labels.attemptsExhausted}`
    );
    await f.submit();
    assert.equal(f.reloads(), 1);
    await f.update({
        verificationId: 'challenge-B',
        labels: { ...labels, attemptsExhausted: 'different' },
        async confirm() {
            return f.result;
        },
    });
    await f.submit();
    assert.equal(
        f.container.querySelector('aside')?.textContent,
        'Host timeout/help'
    );
});
