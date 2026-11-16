import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFormController } from '../src/forms/index.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, savedForm } from './formsFixtures.js';
import {
    createFormCaptchaProviderRegistry,
    mountFormCaptcha,
    type FormCaptchaCallbacks,
    type FormCaptchaHost,
    type FormCaptchaNotice,
    type FormCaptchaProvider,
    type FormCaptchaScope,
    type FormCaptchaSnapshot,
    type FormCaptchaState,
    type FormCaptchaWidgetHandle,
} from '../src/ui/formCaptcha.js';

type Proof = Readonly<{ synthetic: true }>;
type Options = { theme: string };
const proof = (): Proof => ({ synthetic: true });
const flush = async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
};
function fakeContainer() {
    const children = new Set<object>();
    return {
        children,
        append(node: object) {
            children.add(node);
        },
        ownerDocument: {
            createElement() {
                const node = {
                    className: '',
                    remove() {
                        children.delete(node);
                    },
                };
                return node;
            },
        },
    } as unknown as HTMLElement;
}

function fixture() {
    const owner = {};
    const listeners = new Set<() => void>();
    const widgets: {
        callbacks: FormCaptchaCallbacks<Proof>;
        resets: number;
        removes: number;
    }[] = [];
    const order: string[] = [];
    const notices: FormCaptchaNotice[] = [];
    const states: FormCaptchaState[] = [];
    let loads = 0;
    let writes = 0;
    let invalidations = 0;
    let resetCallback: (() => void) | undefined;
    let beforePublish: (() => void) | undefined;
    let afterPublish: (() => void) | undefined;
    let beforeInvalidate: (() => void) | undefined;
    const provider: FormCaptchaProvider<Proof, Options> = {
        load() {
            loads++;
            order.push('load');
            return {
                render(_container, _options, callbacks) {
                    const widget = { callbacks, resets: 0, removes: 0 };
                    widgets.push(widget);
                    return {
                        reset() {
                            widget.resets++;
                            order.push('reset');
                            resetCallback?.();
                        },
                        remove() {
                            widget.removes++;
                            order.push('remove');
                        },
                    };
                },
            };
        },
    };
    let snapshot: FormCaptchaSnapshot<Proof, Options> = {
        owner,
        configurationRevision: 0,
        provider,
        options: { theme: 'light' },
        enabled: true,
        editable: true,
        verified: false,
        token: { owner, configurationRevision: 0, revision: {}, value: null },
    };
    const emit = () => {
        for (const listener of [...listeners]) listener();
    };
    const current = (scope: FormCaptchaScope) =>
        Object.is(scope.owner, snapshot.owner) &&
        scope.configurationRevision === snapshot.configurationRevision &&
        snapshot.enabled &&
        snapshot.editable &&
        !snapshot.verified;
    const host: FormCaptchaHost<Proof, Options> = {
        read: () => snapshot,
        subscribe(changed) {
            listeners.add(changed);
            return () => {
                listeners.delete(changed);
            };
        },
        publish(scope, value) {
            beforePublish?.();
            if (!current(scope)) return { status: 'refused' };
            writes++;
            order.push(value === null ? 'publish-null' : 'publish-proof');
            snapshot = {
                ...snapshot,
                token: { ...scope, value, revision: {} },
            };
            emit();
            afterPublish?.();
            return { status: 'admitted' };
        },
        invalidate(scope, expected) {
            invalidations++;
            beforeInvalidate?.();
            if (
                !Object.is(snapshot.owner, scope.owner) ||
                !Object.is(snapshot.token.owner, scope.owner) ||
                snapshot.token.configurationRevision !==
                    scope.configurationRevision ||
                snapshot.token.revision !== expected.revision
            )
                return { status: 'refused' };
            order.push('invalidate');
            snapshot = {
                ...snapshot,
                token: { ...snapshot.token, value: null, revision: {} },
            };
            emit();
            return { status: 'admitted' };
        },
        notify(notice) {
            notices.push(notice);
            order.push(notice.kind);
        },
    };
    return {
        host,
        provider,
        widgets,
        order,
        notices,
        states,
        read: () => snapshot,
        get counts() {
            return { loads, writes, invalidations, listeners: listeners.size };
        },
        mount: () =>
            mountFormCaptcha(fakeContainer(), host, (state) =>
                states.push(state)
            ),
        update(patch: Partial<typeof snapshot>) {
            snapshot = { ...snapshot, ...patch };
            emit();
        },
        clear() {
            snapshot = {
                ...snapshot,
                token: { ...snapshot.token, value: null, revision: {} },
            };
            emit();
        },
        onReset(callback: () => void) {
            resetCallback = callback;
        },
        beforePublish(callback?: () => void) {
            beforePublish = callback;
        },
        afterPublish(callback?: () => void) {
            afterPublish = callback;
        },
        beforeInvalidate(callback: () => void) {
            beforeInvalidate = callback;
        },
    };
}

test('initial null is inert; publication arms before canonical notification; later null resets once', async (t) => {
    const f = fixture();
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    assert.deepEqual(f.states, ['loading']);
    await flush();
    const widget = f.widgets[0];
    assert.equal(widget.resets, 0);
    const value = proof();
    widget.callbacks.change(value);
    assert.equal(f.read().token.value, value);
    f.clear();
    f.clear();
    assert.equal(widget.resets, 1);
    widget.callbacks.change(null);
    assert.equal(widget.resets, 2);
    assert.deepEqual(f.states, ['loading', 'ready']);
});

test('reset consumes its latch before synchronous change/expiry reentry', async (t) => {
    const f = fixture();
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    const widget = f.widgets[0];
    f.onReset(() => {
        widget.callbacks.change(null);
        widget.callbacks.expired();
        f.clear();
    });
    widget.callbacks.change(proof());
    f.clear();
    assert.equal(widget.resets, 1);
    assert.equal(f.counts.writes, 1);
    assert.deepEqual(f.notices, []);
});

test('expiry always publishes null before notification; error only notifies', async (t) => {
    const f = fixture();
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    const widget = f.widgets[0];
    const value = proof();
    widget.callbacks.change(value);
    const cause = {};
    widget.callbacks.error(cause);
    assert.equal(f.read().token.value, value);
    assert.deepEqual(f.notices, [{ kind: 'error', cause }]);
    widget.callbacks.expired();
    assert.equal(f.read().token.value, null);
    assert.deepEqual(f.order.slice(-3), ['publish-null', 'reset', 'expired']);
    assert.equal(f.read().verified, false);
});

for (const gate of ['enabled', 'editable', 'verified'] as const) {
    test(`${gate} gate retirement preserves canonical token and reopening creates a fresh instance`, async (t) => {
        const f = fixture();
        const mounted = f.mount();
        t.after(() => mounted.dispose());
        await flush();
        const old = f.widgets[0];
        const value = proof();
        old.callbacks.change(value);
        f.update({ [gate]: gate === 'verified' });
        old.callbacks.change(null);
        old.callbacks.expired();
        old.callbacks.error();
        assert.equal(f.read().token.value, value);
        assert.equal(old.removes, 1);
        assert.equal(f.states.at(-1), 'hidden');
        f.update({ [gate]: gate !== 'verified' });
        await flush();
        assert.equal(f.widgets.length, 2);
        old.callbacks.change(null);
        assert.equal(f.counts.writes, 1);
    });
}

test('same-owner configuration replacement invalidates its future token before load; configuration ABA is fresh', async (t) => {
    const f = fixture();
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    const old = f.widgets[0];
    old.callbacks.change(proof());
    f.update({ configurationRevision: 1, options: { theme: 'dark' } });
    await flush();
    assert.equal(f.read().token.value, null);
    assert.equal(f.counts.invalidations, 1);
    assert.ok(f.order.indexOf('invalidate') < f.order.lastIndexOf('load'));
    f.update({ configurationRevision: 2, options: { theme: 'light' } });
    await flush();
    old.callbacks.change(proof());
    assert.equal(f.widgets.length, 3);
    assert.equal(f.counts.writes, 1);
});

test('guarded invalidation refuses a reentrant successor token and never clears it', async (t) => {
    const f = fixture();
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    f.widgets[0].callbacks.change(proof());
    const successor = proof();
    f.beforeInvalidate(() =>
        f.update({
            token: {
                owner: f.read().owner,
                configurationRevision: 1,
                revision: {},
                value: successor,
            },
        })
    );
    f.update({ configurationRevision: 1 });
    await flush();
    assert.equal(f.read().token.value, successor);
    assert.equal(f.order.includes('invalidate'), false);
    assert.equal(f.widgets.length, 2);
});

test('owner replacement/ABA retires callbacks without invalidating successor canonical state', async (t) => {
    const f = fixture();
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    const first = f.widgets[0];
    first.callbacks.change(proof());
    const successor = proof();
    const nextOwner = {};
    f.update({
        owner: nextOwner,
        token: {
            owner: nextOwner,
            configurationRevision: 0,
            revision: {},
            value: successor,
        },
    });
    await flush();
    first.callbacks.expired();
    assert.equal(f.read().token.value, successor);
    f.update({ owner: {} });
    await flush();
    assert.equal(f.widgets.length, 3);
    assert.equal(f.counts.invalidations, 0);
});

test('owner replacement immediately before host admission refuses publication', async (t) => {
    const f = fixture();
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    const old = f.widgets[0];
    f.beforePublish(() => {
        f.beforePublish();
        f.update({ owner: {} });
    });
    old.callbacks.change(proof());
    await flush();
    assert.equal(f.counts.writes, 0);
    assert.equal(f.widgets.length, 2);
    assert.equal(old.removes, 1);
});

test('replacement after admitted publication fences notification and later callbacks', async (t) => {
    const f = fixture();
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    const old = f.widgets[0];
    const successor = proof();
    f.afterPublish(() => {
        f.afterPublish();
        const owner = {};
        f.update({
            owner,
            token: {
                owner,
                configurationRevision: 0,
                revision: {},
                value: successor,
            },
        });
    });
    old.callbacks.expired();
    old.callbacks.change(null);
    await flush();
    assert.equal(f.read().token.value, successor);
    assert.deepEqual(f.notices, []);
    assert.equal(f.counts.writes, 1);
});

test('delayed loader never renders a retired instance', async () => {
    const f = fixture();
    let finish!: (value: Awaited<ReturnType<typeof f.provider.load>>) => void;
    let renders = 0;
    f.update({
        provider: {
            load: () =>
                new Promise((resolve) => {
                    finish = resolve;
                }),
        },
    });
    const mounted = f.mount();
    mounted.dispose();
    mounted.dispose();
    finish({
        render() {
            renders++;
            throw Error('retired render');
        },
    });
    await flush();
    assert.equal(renders, 0);
    assert.equal(f.counts.listeners, 0);
});

test('late async render handle is removed exactly once without reset or publication', async () => {
    const f = fixture();
    let finish!: (value: FormCaptchaWidgetHandle) => void;
    let held!: FormCaptchaCallbacks<Proof>;
    let removes = 0;
    let resets = 0;
    f.update({
        provider: {
            load: () => ({
                render(_el, _options, callbacks) {
                    held = callbacks;
                    return new Promise((resolve) => {
                        finish = resolve;
                    });
                },
            }),
        },
    });
    const mounted = f.mount();
    await flush();
    mounted.dispose();
    finish({
        remove() {
            removes++;
        },
        reset() {
            resets++;
        },
    });
    held.change(proof());
    await flush();
    assert.equal(removes, 1);
    assert.equal(resets, 0);
    assert.equal(f.counts.writes, 0);
});

test('synchronous render callback null resets once after its handle arrives', async (t) => {
    const f = fixture();
    let resets = 0;
    f.update({
        provider: {
            load: () => ({
                render(_el, _options, callbacks) {
                    callbacks.change(null);
                    return {
                        remove() {},
                        reset() {
                            resets++;
                            callbacks.change(null);
                        },
                    };
                },
            }),
        },
    });
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    assert.equal(resets, 1);
    assert.equal(f.counts.writes, 1);
});

test('changing callback ports or cosmetic options does not replace accepted configuration', async (t) => {
    const f = fixture();
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    f.update({ options: { theme: 'cosmetic-same-revision' } });
    mounted.updateHost({ ...f.host });
    await flush();
    f.widgets[0].callbacks.change(proof());
    assert.equal(f.counts.loads, 1);
    assert.equal(f.counts.listeners, 1);
});

test('independent widgets remove only their own handles; cleanup callbacks are retired first', async () => {
    const f = fixture();
    const a = f.mount();
    const b = f.mount();
    await flush();
    a.dispose();
    assert.equal(f.widgets[0].removes, 1);
    assert.equal(f.widgets[1].removes, 0);
    f.widgets[0].callbacks.change(proof());
    assert.equal(f.counts.writes, 0);
    f.widgets[1].callbacks.change(proof());
    assert.equal(f.counts.writes, 1);
    b.dispose();
    assert.equal(f.counts.listeners, 0);
});

for (const failure of ['load', 'render'] as const) {
    test(`${failure} failure reports unavailable without clearing canonical state`, async (t) => {
        const f = fixture();
        const cause = Error('synthetic unavailable');
        f.update({
            provider: {
                load() {
                    if (failure === 'load') throw cause;
                    return {
                        render() {
                            throw cause;
                        },
                    };
                },
            },
        });
        const mounted = f.mount();
        t.after(() => mounted.dispose());
        await flush();
        assert.equal(f.states.at(-1), 'unavailable');
        assert.deepEqual(f.notices, [{ kind: 'unavailable', cause }]);
        assert.equal(f.counts.writes, 0);
    });
}

test('registry coalesces matching loads and refuses conflicting global configuration before loading', async () => {
    const registry = createFormCaptchaProviderRegistry();
    const scope = {};
    const configuration = {};
    let loads = 0;
    const request = {
        scope,
        configuration,
        load() {
            loads++;
            return {
                render() {
                    throw Error('not rendered');
                },
            };
        },
    };
    const a = registry.provider(request);
    const b = registry.provider(request);
    assert.equal(a.load(), b.load());
    await a.load();
    assert.equal(loads, 1);
    const conflict = registry.provider({ ...request, configuration: {} });
    assert.throws(() => conflict.load(), /Conflicting CAPTCHA/);
    assert.equal(loads, 1);
});

test('registry retains failed loader admission without replacing shared globals or retrying', async () => {
    const registry = createFormCaptchaProviderRegistry();
    let loads = 0;
    const cause = Error('synthetic loader failure');
    const provider = registry.provider({
        scope: {},
        configuration: {},
        load() {
            loads++;
            throw cause;
        },
    });
    const first = provider.load();
    await assert.rejects(Promise.resolve(first), (error) => error === cause);
    await assert.rejects(
        Promise.resolve(provider.load()),
        (error) => error === cause
    );
    assert.equal(loads, 1);
});

test('fresh mount invalidates same-owner old-configuration token before admitting any replacement', async (t) => {
    const f = fixture();
    f.update({
        configurationRevision: 2,
        token: { ...f.read().token, value: proof() },
    });
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    assert.equal(f.read().token.value, null);
    assert.equal(f.counts.invalidations, 1);
    assert.ok(f.order.indexOf('invalidate') < f.order.indexOf('load'));
});

test('renderer failure retires retained callbacks and detaches its instance mount', async (t) => {
    const f = fixture();
    let held!: FormCaptchaCallbacks<Proof>;
    let node!: HTMLElement;
    f.update({
        provider: {
            load: () => ({
                render(el, _options, callbacks) {
                    node = el;
                    held = callbacks;
                    throw Error('synthetic render failure');
                },
            }),
        },
    });
    const mounted = f.mount();
    t.after(() => mounted.dispose());
    await flush();
    held.change(proof());
    held.expired();
    held.error();
    assert.equal(f.counts.writes, 0);
    assert.equal(node.className, 'mx-sdk-form-captcha-instance');
    assert.equal(f.states.at(-1), 'unavailable');
    assert.equal(f.notices.length, 1);
});

for (const revision of [NaN, Infinity, -1, 0.5]) {
    test(`invalid configuration revision ${revision} refuses without loading or hanging`, () => {
        const f = fixture();
        f.update({ configurationRevision: revision });
        const mounted = f.mount();
        assert.equal(f.counts.loads, 0);
        assert.deepEqual(f.states, ['unavailable']);
        mounted.dispose();
    });
}

test('retirement during an external read fences publication even when that read returns the old frame', async () => {
    const f = fixture();
    let disposeOnRead = false;
    let mounted!: ReturnType<typeof f.mount>;
    const host = {
        ...f.host,
        read() {
            const snapshot = f.read();
            if (disposeOnRead) mounted.dispose();
            return snapshot;
        },
    };
    mounted = mountFormCaptcha(fakeContainer(), host, () => {});
    await flush();
    disposeOnRead = true;
    f.widgets[0].callbacks.change(proof());
    assert.equal(f.counts.writes, 0);
    assert.equal(f.widgets[0].removes, 1);
});

test('throwing subscription cleanup still retires the exact mounted handle', async () => {
    const f = fixture();
    const host = {
        ...f.host,
        subscribe() {
            return () => {
                throw Error('synthetic cleanup failure');
            };
        },
    };
    const mounted = mountFormCaptcha(fakeContainer(), host, () => {});
    await flush();
    assert.throws(() => mounted.dispose(), /synthetic cleanup failure/);
    f.widgets[0].callbacks.change(proof());
    assert.equal(f.widgets[0].removes, 1);
    assert.equal(f.counts.writes, 0);
});

test('newer reentrant host update survives old subscription cleanup', async () => {
    const f = fixture();
    let mounted!: ReturnType<typeof f.mount>;
    let oldStops = 0;
    let middleSubscriptions = 0;
    let newestSubscriptions = 0;
    let newestStops = 0;
    const newest = {
        ...f.host,
        subscribe() {
            newestSubscriptions++;
            return () => {
                newestStops++;
            };
        },
    };
    const initial = {
        ...f.host,
        subscribe() {
            return () => {
                oldStops++;
                mounted.updateHost(newest);
            };
        },
    };
    mounted = mountFormCaptcha(fakeContainer(), initial, () => {});
    await flush();
    mounted.updateHost({
        ...f.host,
        subscribe() {
            middleSubscriptions++;
            return () => {};
        },
    });
    assert.equal(oldStops, 1);
    assert.equal(middleSubscriptions, 0);
    assert.equal(newestSubscriptions, 1);
    mounted.dispose();
    assert.equal(newestStops, 1);
});

test('refused callback publication does not arm a later canonical-null reset', async () => {
    const f = fixture();
    const mounted = mountFormCaptcha(
        fakeContainer(),
        { ...f.host, publish: () => ({ status: 'refused' }) },
        () => {}
    );
    await flush();
    f.widgets[0].callbacks.change(proof());
    f.clear();
    assert.equal(f.widgets[0].resets, 0);
    mounted.dispose();
});

test('refused prior-token invalidation blocks replacement; future provenance is never cleared', async () => {
    const f = fixture();
    const mounted = mountFormCaptcha(
        fakeContainer(),
        { ...f.host, invalidate: () => ({ status: 'refused' }) },
        (state) => f.states.push(state)
    );
    await flush();
    const value = proof();
    f.widgets[0].callbacks.change(value);
    f.update({ configurationRevision: 1 });
    await flush();
    assert.equal(f.counts.loads, 1);
    assert.equal(f.read().token.value, value);
    assert.equal(f.states.at(-1), 'unavailable');
    f.update({ token: { ...f.read().token, configurationRevision: 2 } });
    assert.equal(f.counts.loads, 1);
    assert.equal(f.read().token.value, value);
    mounted.dispose();
});

test('a regressed accepted configuration revision cannot resurrect its old widget', async () => {
    const f = fixture();
    const mounted = f.mount();
    await flush();
    f.update({ configurationRevision: 1 });
    await flush();
    f.update({ configurationRevision: 0 });
    await flush();
    assert.equal(f.counts.loads, 2);
    assert.equal(f.states.at(-1), 'unavailable');
    mounted.dispose();
});

test('async provider failures retire once and do not retry on duplicate host notification', async () => {
    const f = fixture();
    f.update({
        provider: {
            load: () => Promise.reject(Error('synthetic async failure')),
        },
    });
    const mounted = f.mount();
    await flush();
    f.clear();
    await flush();
    assert.equal(f.notices.length, 1);
    assert.equal(f.states.at(-1), 'unavailable');
    mounted.dispose();
});

test('widget expiry/config changes preserve dirty edits and the actual already allocated FormController Save', async () => {
    const f = fixture();
    const mounted = f.mount();
    await flush();
    let finish!: () => void;
    let calls = 0;
    let requestSignal: AbortSignal | null | undefined;
    let capturedInput = '';
    const response = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const options = { ...formSaveOptions(), captchaVal: null };
    const controller = createFormController({
        loaded: loadedForm(),
        saveOptions: options,
        getScope: () => ({ ownerId: 'synthetic-form', revision: 0 }),
        client: createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.invalid',
            fetch: async (_url, init) => {
                calls++;
                capturedInput = String(init?.body);
                requestSignal = init?.signal;
                await response;
                return new Response(JSON.stringify(savedForm()), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                });
            },
        }),
    });
    try {
        controller.write('fld_title', 'Edited before allocation');
        const pending = controller.save();
        assert.equal(calls, 1);
        const allocated = capturedInput;
        controller.write('fld_title', 'Newer dirty edit');
        const before = controller.getState();
        f.widgets[0].callbacks.change(proof());
        f.widgets[0].callbacks.expired();
        f.update({ configurationRevision: 1 });
        await flush();
        assert.equal(calls, 1);
        assert.equal(capturedInput, allocated);
        assert.equal(requestSignal?.aborted, false);
        assert.deepEqual(controller.getState().draft, before.draft);
        assert.equal(controller.getState().status, before.status);
        assert.equal(f.read().verified, false);
        finish();
        await pending;
        assert.equal(controller.getState().hasNewerEdits, true);
        assert.equal(
            controller.getState().draft?.data.fld_title,
            'Newer dirty edit'
        );
    } finally {
        controller.destroy();
        mounted.dispose();
    }
});

test('a pending reset cannot reset a newer proof before an async render handle returns', async () => {
    const f = fixture();
    let held!: FormCaptchaCallbacks<Proof>;
    let finish!: (value: FormCaptchaWidgetHandle) => void;
    let resets = 0;
    f.update({
        provider: {
            load: () => ({
                render(_node, _options, callbacks) {
                    held = callbacks;
                    return new Promise((resolve) => {
                        finish = resolve;
                    });
                },
            }),
        },
    });
    const mounted = f.mount();
    await flush();
    held.change(proof());
    f.clear();
    const successor = proof();
    held.change(successor);
    finish({
        reset() {
            resets++;
        },
        remove() {},
    });
    await flush();
    assert.equal(f.read().token.value, successor);
    assert.equal(resets, 0);
    f.clear();
    assert.equal(resets, 1);
    mounted.dispose();
});

test('a later refused callback preserves the prior accepted reset obligation', async () => {
    const f = fixture();
    let refuse = false;
    const mounted = mountFormCaptcha(
        fakeContainer(),
        {
            ...f.host,
            publish(scope, value) {
                return refuse
                    ? { status: 'refused' }
                    : f.host.publish(scope, value);
            },
        },
        () => {}
    );
    await flush();
    f.widgets[0].callbacks.change(proof());
    refuse = true;
    f.widgets[0].callbacks.change(null);
    assert.equal(f.widgets[0].resets, 0);
    f.clear();
    assert.equal(f.widgets[0].resets, 1);
    mounted.dispose();
});

test('synchronous subscribers cannot reset an ultimately refused initial publication', async () => {
    const f = fixture();
    const mounted = mountFormCaptcha(
        fakeContainer(),
        {
            ...f.host,
            publish() {
                f.clear();
                return { status: 'refused' };
            },
        },
        () => {}
    );
    await flush();
    f.widgets[0].callbacks.change(null);
    assert.equal(f.widgets[0].resets, 0);
    mounted.dispose();
});

test('post-invalidation successor provenance is rechecked before replacement load', async () => {
    const f = fixture();
    const successor = proof();
    const mounted = mountFormCaptcha(
        fakeContainer(),
        {
            ...f.host,
            invalidate() {
                f.update({
                    token: {
                        owner: f.read().owner,
                        configurationRevision: 3,
                        revision: {},
                        value: successor,
                    },
                });
                return { status: 'admitted' };
            },
        },
        (state) => f.states.push(state)
    );
    await flush();
    f.widgets[0].callbacks.change(proof());
    f.update({ configurationRevision: 2 });
    await flush();
    assert.equal(f.read().token.value, successor);
    assert.equal(f.counts.loads, 1);
    assert.equal(f.states.at(-1), 'unavailable');
    mounted.dispose();
});

test('duplicate notification during refused invalidation cannot retry unchanged canonical admission', async () => {
    const f = fixture();
    let attempts = 0;
    const mounted = mountFormCaptcha(
        fakeContainer(),
        {
            ...f.host,
            invalidate() {
                attempts++;
                f.update({});
                return { status: 'refused' };
            },
        },
        () => {}
    );
    await flush();
    f.widgets[0].callbacks.change(proof());
    f.update({ configurationRevision: 1 });
    f.update({});
    f.update({});
    assert.equal(attempts, 1);
    assert.equal(f.counts.loads, 1);
    mounted.dispose();
});

test('an old unsubscribe that throws after installing newer ports cannot retire the newer owner', async () => {
    const f = fixture();
    let mounted!: ReturnType<typeof f.mount>;
    let stops = 0;
    const newer = {
        ...f.host,
        subscribe() {
            return () => {
                stops++;
            };
        },
    };
    mounted = mountFormCaptcha(
        fakeContainer(),
        {
            ...f.host,
            subscribe() {
                return () => {
                    mounted.updateHost(newer);
                    throw Error('old stop failed');
                };
            },
        },
        () => {}
    );
    await flush();
    assert.throws(() => mounted.updateHost({ ...f.host }), /old stop failed/);
    f.widgets[0].callbacks.change(proof());
    assert.equal(f.counts.writes, 1);
    assert.equal(f.widgets[0].removes, 0);
    mounted.dispose();
    assert.equal(stops, 1);
});

test('opaque NaN owner stamps mount once, publish and invalidate without a retirement loop', async () => {
    const f = fixture();
    f.update({ owner: NaN, token: { ...f.read().token, owner: NaN } });
    let reads = 0;
    const mounted = mountFormCaptcha(
        fakeContainer(),
        {
            ...f.host,
            read() {
                assert.ok(++reads < 100, 'finite owner reads');
                return f.read();
            },
        },
        (state) => f.states.push(state)
    );
    await flush();
    assert.equal(f.counts.loads, 1);
    assert.equal(f.states.at(-1), 'ready');
    f.widgets[0].callbacks.change(proof());
    assert.equal(f.counts.writes, 1);
    f.update({ configurationRevision: 1 });
    await flush();
    assert.equal(f.counts.invalidations, 1);
    assert.equal(f.read().token.value, null);
    assert.equal(f.counts.loads, 2);
    mounted.dispose();
});

test('opaque NaN loader configuration uses stable identity rather than conflicting with itself', async () => {
    const registry = createFormCaptchaProviderRegistry();
    let loads = 0;
    const provider = registry.provider({
        scope: {},
        configuration: NaN,
        load() {
            loads++;
            return {
                render() {
                    throw Error('no render');
                },
            };
        },
    });
    assert.equal(provider.load(), provider.load());
    await provider.load();
    assert.equal(loads, 1);
});
