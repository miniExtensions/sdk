import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import type {
    PortalVisitorSearchCommand,
    PortalVisitorSearchFrame,
    PortalVisitorSearchOutcome,
} from '../src/portals/index.js';
import {
    PortalVisitorSearch,
    type PortalVisitorSearchProps,
} from '../src/react/PortalVisitorSearch.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

function host() {
    let frame: PortalVisitorSearchFrame = {
        stamp: {
            sessionId: 'portal',
            fieldId: 'linked-records',
            viewId: 'initial',
            configurationRevision: 1,
            metadataRevision: 1,
            generation: 1,
        },
        searchTerm: 'previous',
        publicationRevision: 1,
    };
    const listeners = new Set<() => void>();
    const commands: PortalVisitorSearchCommand[] = [];
    const notifyListeners = () => {
        for (const listener of listeners) listener();
    };
    const publish = (next: PortalVisitorSearchFrame, notify: boolean) => {
        frame = next;
        if (notify) notifyListeners();
    };
    const port: PortalVisitorSearchProps['port'] = {
        read: () => frame,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        apply(command) {
            commands.push(command);
            return {
                type: 'allocated',
                requestId: `read-${commands.length}`,
                generation: frame.stamp.generation,
            };
        },
    };
    return {
        port,
        listeners,
        commands,
        select(viewId: string, notify = true) {
            publish(
                {
                    ...frame,
                    publicationRevision: frame.publicationRevision + 1,
                    stamp: {
                        ...frame.stamp,
                        viewId,
                        generation: frame.stamp.generation + 1,
                    },
                },
                notify
            );
        },
        notify: notifyListeners,
        advanceGeneration() {
            const generation = frame.stamp.generation + 1;
            publish({ ...frame, stamp: { ...frame.stamp, generation } }, true);
            return { generation, revision: frame.publicationRevision };
        },
        commit(searchTerm: string, advanceGeneration = true, notify = true) {
            const generation =
                frame.stamp.generation + Number(advanceGeneration);
            const revision = frame.publicationRevision + 1;
            publish(
                {
                    stamp: { ...frame.stamp, generation },
                    searchTerm,
                    publicationRevision: revision,
                },
                notify
            );
            return { generation, revision };
        },
    };
}

it('server renders portable labelled controls without contacting the host', () => {
    const html = renderToString(
        h(PortalVisitorSearch, {
            port: {
                read: () => assert.fail('unexpected read'),
                subscribe: () => assert.fail('unexpected subscribe'),
                apply: () => assert.fail('unexpected apply'),
            },
            labels: { input: 'Find <records>' },
        })
    );
    assert.match(html, /Find &lt;records&gt;/);
    assert.match(html, /role="search"/);
    assert.match(html, /disabled=""/);
    assert.doesNotMatch(html, /<form/);
});

it('hydrates the existing labelled input before enabling the available owner', async () => {
    const owner = host();
    const tree = h(
        StrictMode,
        null,
        h(PortalVisitorSearch, { port: owner.port })
    );
    const html = renderToString(tree);
    const window = new Window({ url: 'http://127.0.0.1/visitor-search' });
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const originals = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    let root: Root | undefined;
    try {
        for (const [key, value] of Object.entries(globals))
            Object.defineProperty(globalThis, key, {
                configurable: true,
                value,
            });
        const container = window.document.createElement('form');
        container.innerHTML = html;
        window.document.body.append(container);
        const input = container.querySelector('input');
        assert.ok(input?.disabled);
        const id = input.id;
        assert.equal(owner.listeners.size, 0);
        const recoveries: unknown[] = [];
        const { hydrateRoot } = await import('react-dom/client');
        await act(async () => {
            root = hydrateRoot(container as unknown as HTMLElement, tree, {
                onRecoverableError: (error) => recoveries.push(error),
            });
        });
        assert.equal(container.querySelector('input'), input);
        assert.equal(container.querySelector('label')?.htmlFor, id);
        assert.equal(input.disabled, false);
        assert.equal(input.value, 'previous');
        assert.deepEqual(recoveries, []);
        assert.deepEqual(owner.commands, []);
    } finally {
        await act(async () => root?.unmount());
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
    }
    assert.equal(owner.listeners.size, 0);
});

it('commits exact draft text on Enter or button click and clears without submitting the outer form', async (t) => {
    const f = await htmlPresentationFixture(t);
    const owner = host();
    await f.render(h(PortalVisitorSearch, { port: owner.port }));
    assert.equal(owner.listeners.size, 1);
    const input = f.container.querySelector('input');
    const label = f.container.querySelector('label');
    const button = (name: string) => {
        const control = [...f.container.querySelectorAll('button')].find(
            (node) => node.textContent === name
        );
        assert.ok(control);
        return control;
    };
    assert.ok(input);
    assert.equal(label?.htmlFor, input.id);
    assert.equal(input.value, 'previous');
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            f.window.HTMLInputElement.prototype,
            'value'
        )?.set?.call(input, '  latest café  ');
        input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    });
    assert.equal(input.value, '  latest café  ');
    assert.deepEqual(owner.commands, []);
    await act(async () => {
        input.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Enter',
                bubbles: true,
                cancelable: true,
            })
        );
    });
    await f.click(button('Search'));
    await f.click(button('Clear search'));
    assert.deepEqual(
        owner.commands.map(({ source, searchTerm }) => [source, searchTerm]),
        [
            ['submit', '  latest café  '],
            ['submit', '  latest café  '],
            ['clear', ''],
        ]
    );
    assert.equal(input.value, '');
    await f.render(null);
    assert.equal(owner.listeners.size, 0);
});

it('fences a scanner callback to its opened owner and accepts one result', async (t) => {
    const f = await htmlPresentationFixture(t);
    const owner = host();
    let openScanner: (() => ((value: string) => void) | null) | undefined;
    await f.render(
        h(PortalVisitorSearch, {
            port: owner.port,
            renderScanner: ({ capture }) => {
                openScanner = capture;
                return null;
            },
        })
    );
    const oldScan = openScanner?.();
    assert.ok(oldScan);
    await act(async () => {
        owner.select('different');
        owner.select('initial');
        oldScan('old camera result');
    });
    assert.deepEqual(owner.commands, []);
    const freshScan = openScanner?.();
    assert.ok(freshScan);
    await act(async () => {
        freshScan('  001-α  ');
        freshScan('duplicate scanner result');
    });
    assert.deepEqual(
        owner.commands.map(({ source, searchTerm }) => [source, searchTerm]),
        [['scan', '  001-α  ']]
    );
    await f.render(null);
    freshScan('after unmount');
    assert.equal(owner.commands.length, 1);
});

it('keeps a superseded asynchronous receipt out of the replacement view', async (t) => {
    const f = await htmlPresentationFixture(t);
    const owner = host();
    let finish!: (outcome: PortalVisitorSearchOutcome) => void;
    const pending = new Promise<PortalVisitorSearchOutcome>((resolve) => {
        finish = resolve;
    });
    let invocations = 0;
    const outcomes: PortalVisitorSearchOutcome[] = [];
    await f.render(
        h(PortalVisitorSearch, {
            port: {
                ...owner.port,
                apply() {
                    invocations += 1;
                    return pending;
                },
            },
            onOutcome: (outcome) => outcomes.push(outcome),
        })
    );
    const button = [...f.container.querySelectorAll('button')].at(-1);
    assert.ok(button);
    await f.click(button);
    assert.equal(invocations, 1);
    await act(async () => {
        owner.select('replacement');
        finish({ type: 'allocated', requestId: 'old-receipt', generation: 1 });
    });
    assert.deepEqual(outcomes, []);
});

for (const type of ['refused', 'uncertain'] as const) {
    it(`delivers ${type} after this subscription commits a changed term`, async (t) => {
        const f = await htmlPresentationFixture(t);
        const owner = host();
        const outcomes: PortalVisitorSearchOutcome[] = [];
        const port: PortalVisitorSearchProps['port'] = {
            ...owner.port,
            apply(command) {
                return {
                    type,
                    committedPublication: owner.commit(command.searchTerm),
                };
            },
        };
        await f.render(
            h(PortalVisitorSearch, {
                port,
                onOutcome: (outcome) => outcomes.push(outcome),
            })
        );
        const clear = [...f.container.querySelectorAll('button')].find(
            (button) => button.textContent === 'Clear search'
        );
        assert.ok(clear);
        await f.click(clear);
        assert.equal(f.container.querySelector('input')?.value, '');
        assert.deepEqual(outcomes, [
            {
                type,
                committedPublication: { generation: 2, revision: 2 },
            },
        ]);
    });

    it(`drops a delayed ${type} scan receipt after the same term returns at the same generation`, async (t) => {
        const f = await htmlPresentationFixture(t);
        const owner = host();
        let finish!: () => void;
        let capture: (() => ((value: string) => void) | null) | undefined;
        let invocations = 0;
        const outcomes: PortalVisitorSearchOutcome[] = [];
        const port: PortalVisitorSearchProps['port'] = {
            ...owner.port,
            apply(command) {
                invocations += 1;
                const committedPublication = owner.commit(
                    command.searchTerm,
                    false
                );
                return new Promise((resolve) => {
                    finish = () => resolve({ type, committedPublication });
                });
            },
        };
        await f.render(
            h(PortalVisitorSearch, {
                port,
                onOutcome: (outcome) => outcomes.push(outcome),
                renderScanner(controls) {
                    capture = controls.capture;
                    return null;
                },
            })
        );
        const scan = capture?.();
        assert.ok(scan);
        await act(async () => scan('first publication'));
        assert.equal(
            f.container.querySelector('input')?.value,
            'first publication'
        );
        await act(async () => owner.commit('intervening publication', false));
        assert.equal(
            f.container.querySelector('input')?.value,
            'intervening publication'
        );
        await act(async () => owner.commit('first publication', false));
        assert.equal(
            f.container.querySelector('input')?.value,
            'first publication'
        );
        await act(async () => finish());
        assert.deepEqual(outcomes, []);
        assert.equal(invocations, 1);
    });
}

it('drops a pending receipt when the live owner changes before subscription notification', async (t) => {
    const f = await htmlPresentationFixture(t);
    const owner = host();
    let finish!: (outcome: PortalVisitorSearchOutcome) => void;
    const pending = new Promise<PortalVisitorSearchOutcome>((resolve) => {
        finish = resolve;
    });
    let invocations = 0;
    const outcomes: PortalVisitorSearchOutcome[] = [];
    await f.render(
        h(PortalVisitorSearch, {
            port: {
                ...owner.port,
                apply() {
                    invocations += 1;
                    return pending;
                },
            },
            onOutcome: (outcome) => outcomes.push(outcome),
        })
    );
    const submit = [...f.container.querySelectorAll('button')].at(-1);
    assert.ok(submit);
    await f.click(submit);
    assert.equal(invocations, 1);
    await act(async () => {
        owner.select('replacement', false);
        finish({ type: 'allocated', requestId: 'old-owner', generation: 1 });
    });
    assert.deepEqual(outcomes, []);
});

it('reports its own verified publication before the subscription sees it', async (t) => {
    const f = await htmlPresentationFixture(t);
    const owner = host();
    const outcomes: PortalVisitorSearchOutcome[] = [];
    const port: PortalVisitorSearchProps['port'] = {
        ...owner.port,
        apply(command) {
            return {
                type: 'allocated',
                requestId: 'current-request',
                generation: 1,
                committedPublication: owner.commit(
                    command.searchTerm,
                    false,
                    false
                ),
            };
        },
    };
    await f.render(
        h(PortalVisitorSearch, {
            port,
            onOutcome: (outcome) => outcomes.push(outcome),
        })
    );
    const clear = [...f.container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Clear search'
    );
    assert.ok(clear);
    await f.click(clear);
    assert.deepEqual(outcomes, [
        {
            type: 'allocated',
            requestId: 'current-request',
            generation: 1,
            committedPublication: { generation: 1, revision: 2 },
        },
    ]);
    await act(async () => owner.notify());
    assert.equal(outcomes.length, 1);
});

it('recovers from a transient read exception without replacing the enabled Search draft', async (t) => {
    const f = await htmlPresentationFixture(t);
    const owner = host();
    let readsBeforeFailure: number | undefined;
    const port: PortalVisitorSearchProps['port'] = {
        ...owner.port,
        read() {
            if (readsBeforeFailure === 0) {
                readsBeforeFailure = undefined;
                throw new Error('temporary owner read failure');
            }
            if (readsBeforeFailure !== undefined) readsBeforeFailure -= 1;
            return owner.port.read();
        },
    };
    await f.render(h(PortalVisitorSearch, { port }));
    const input = f.container.querySelector('input');
    assert.ok(input);
    await act(async () => {
        Object.getOwnPropertyDescriptor(
            f.window.HTMLInputElement.prototype,
            'value'
        )?.set?.call(input, 'typed before the read failure');
        input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    });
    readsBeforeFailure = 0;
    await act(async () => owner.notify());
    assert.equal(input.value, 'typed before the read failure');
    const submit = [...f.container.querySelectorAll('button')].at(-1);
    assert.ok(submit);
    readsBeforeFailure = 0;
    await f.click(submit);
    assert.equal(owner.commands.length, 0);
    assert.equal(submit.disabled, false);
    const clear = [...f.container.querySelectorAll('button')].find(
        (button) => button.textContent === 'Clear search'
    );
    assert.ok(clear);
    readsBeforeFailure = 1;
    await f.click(clear);
    assert.equal(owner.commands.length, 0);
    assert.equal(input.value, 'typed before the read failure');
    await f.click(submit);
    assert.equal(owner.commands.length, 1);
    assert.equal(owner.commands[0].searchTerm, 'typed before the read failure');
});

for (const includePublication of [false, true]) {
    it(`reports an accepted unchanged term when the owner advances generation ${includePublication ? 'with' : 'without'} a publication pair`, async (t) => {
        const f = await htmlPresentationFixture(t);
        const owner = host();
        const outcomes: PortalVisitorSearchOutcome[] = [];
        const port: PortalVisitorSearchProps['port'] = {
            ...owner.port,
            apply(command) {
                assert.equal(command.searchTerm, 'previous');
                const publication = owner.advanceGeneration();
                return {
                    type: 'allocated',
                    requestId: 'same-term-reload',
                    generation: publication.generation,
                    ...(includePublication
                        ? { committedPublication: publication }
                        : {}),
                };
            },
        };
        await f.render(
            h(PortalVisitorSearch, {
                port,
                onOutcome: (outcome) => outcomes.push(outcome),
            })
        );
        const submit = [...f.container.querySelectorAll('button')].at(-1);
        assert.ok(submit);
        await f.click(submit);
        assert.deepEqual(outcomes, [
            {
                type: 'allocated',
                requestId: 'same-term-reload',
                generation: 2,
                ...(includePublication
                    ? { committedPublication: { generation: 2, revision: 1 } }
                    : {}),
            },
        ]);
    });
}

it('drops an unpaired same-term allocation after a newer term publication returns to the original term', async (t) => {
    const f = await htmlPresentationFixture(t);
    const owner = host();
    let finish!: () => void;
    const outcomes: PortalVisitorSearchOutcome[] = [];
    const port: PortalVisitorSearchProps['port'] = {
        ...owner.port,
        apply() {
            const { generation } = owner.advanceGeneration();
            return new Promise((resolve) => {
                finish = () =>
                    resolve({
                        type: 'allocated',
                        requestId: 'old-same-term-allocation',
                        generation,
                    });
            });
        },
    };
    await f.render(
        h(PortalVisitorSearch, {
            port,
            onOutcome: (outcome) => outcomes.push(outcome),
        })
    );
    const submit = [...f.container.querySelectorAll('button')].at(-1);
    assert.ok(submit);
    await f.click(submit);
    await act(async () => owner.commit('different publication', false));
    await act(async () => owner.commit('previous', false));
    await act(async () => finish());
    assert.deepEqual(outcomes, []);
});

it('drops a late receipt when the same port is mounted in a new subscription', async (t) => {
    const f = await htmlPresentationFixture(t);
    const original = host();
    const replacement = host();
    let finish!: (outcome: PortalVisitorSearchOutcome) => void;
    const pending = new Promise<PortalVisitorSearchOutcome>((resolve) => {
        finish = resolve;
    });
    let invocations = 0;
    const port: PortalVisitorSearchProps['port'] = {
        ...original.port,
        apply() {
            invocations += 1;
            return pending;
        },
    };
    const outcomes: PortalVisitorSearchOutcome[] = [];
    const render = (nextPort: PortalVisitorSearchProps['port']) =>
        f.render(
            h(PortalVisitorSearch, {
                port: nextPort,
                onOutcome: (outcome) => outcomes.push(outcome),
            })
        );
    await render(port);
    const submit = [...f.container.querySelectorAll('button')].at(-1);
    assert.ok(submit);
    await f.click(submit);
    assert.equal(invocations, 1);
    await render(replacement.port);
    assert.equal(original.listeners.size, 0);
    await render(port);
    assert.equal(original.listeners.size, 1);
    await act(async () =>
        finish({ type: 'allocated', requestId: 'retired-port', generation: 1 })
    );
    assert.deepEqual(outcomes, []);
});
