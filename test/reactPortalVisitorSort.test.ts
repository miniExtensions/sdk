import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { PortalVisitorSort } from '../src/react/PortalVisitorSort.js';
import type {
    PortalVisitorSortCommand,
    PortalVisitorSortFrame,
    PortalVisitorSortOutcome,
    PortalVisitorSortPort,
} from '../src/portals/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

function owner() {
    let frame: PortalVisitorSortFrame = {
        stamp: {
            sessionId: 'session',
            fieldId: 'portal',
            viewId: 'accepted',
            configurationRevision: 1,
            metadataRevision: 1,
            generation: 1,
        },
        fields: [
            { id: 'title', name: 'Title' },
            { id: 'detail', name: 'Detail' },
        ],
        criteria: [],
    };
    const listeners = new Set<() => void>();
    const commands: PortalVisitorSortCommand[] = [];
    let deferred: Promise<PortalVisitorSortOutcome> | undefined;
    const port: PortalVisitorSortPort = {
        read: () => frame,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        apply(command) {
            commands.push(command);
            return (
                deferred ?? {
                    type: 'allocated',
                    requestId: 'actual-host-receipt',
                    generation: 2,
                }
            );
        },
    };
    return {
        port,
        commands,
        frame: () => frame,
        listeners,
        update(next: PortalVisitorSortFrame) {
            frame = next;
            for (const listener of listeners) listener();
        },
        defer(next: Promise<PortalVisitorSortOutcome>) {
            deferred = next;
        },
    };
}

type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;

function button(f: Fixture, label: string) {
    const element = [...f.container.querySelectorAll('button')].find(
        (item) =>
            (item.getAttribute('aria-label') ?? item.textContent) === label
    );
    assert.ok(element, label);
    return element;
}

it('server renders an escaped trigger without reading or subscribing to the host', () => {
    const html = renderToString(
        h(PortalVisitorSort, {
            port: {
                read() {
                    assert.fail('unexpected host read');
                },
                subscribe() {
                    assert.fail('unexpected subscription');
                },
                apply() {
                    assert.fail('unexpected apply');
                },
            },
            labels: { trigger: 'Sort <records>' },
        })
    );
    assert.match(html, /Sort &lt;records&gt;/);
    assert.doesNotMatch(html, /<dialog/);
});

it('hydrates the server trigger, opens from it and retires the subscription on unmount', async () => {
    const host = owner();
    const tree = h(StrictMode, null, h(PortalVisitorSort, { port: host.port }));
    const html = renderToString(tree);
    assert.equal(host.listeners.size, 0);
    const window = new Window({ url: 'http://127.0.0.1/visitor-sort' });
    const values = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const originals = new Map(
        Object.keys(values).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ])
    );
    let root: import('react-dom/client').Root | undefined;
    try {
        for (const [key, value] of Object.entries(values))
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value,
            });
        const container = window.document.createElement('div');
        container.innerHTML = html;
        window.document.body.append(container);
        const trigger = container.querySelector('button');
        assert.ok(trigger);
        const recoveries: unknown[] = [];
        const { hydrateRoot } = await import('react-dom/client');
        await act(async () => {
            root = hydrateRoot(container as unknown as HTMLElement, tree, {
                onRecoverableError: (error) => recoveries.push(error),
            });
        });
        assert.equal(container.querySelector('button'), trigger);
        assert.deepEqual(recoveries, []);
        await act(async () => trigger.click());
        assert.equal(host.listeners.size, 1);
        assert.equal(container.querySelector('dialog')?.open, true);
        assert.equal(host.commands.length, 0);
    } finally {
        await act(async () => root?.unmount());
        for (const [key, descriptor] of originals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
        }
        await window.happyDOM.close();
    }
    assert.equal(host.listeners.size, 0);
});

it('mounts the actual dialog, reorders through accessible buttons and sends an ordered command on Done', async (t) => {
    const f = await htmlPresentationFixture(t);
    const host = owner();
    const outcomes: PortalVisitorSortOutcome[] = [];
    await f.render(
        h(PortalVisitorSort, {
            port: host.port,
            onOutcome: (outcome) => outcomes.push(outcome),
        })
    );
    const trigger = button(f, 'Sort');
    trigger.focus();
    await f.click(trigger);
    assert.equal(host.listeners.size, 1);
    assert.equal(f.container.querySelector('dialog')?.open, true);
    assert.equal(f.window.document.activeElement?.textContent, 'Sort records');
    await f.click(button(f, 'Add sort condition'));
    await f.click(button(f, 'Add sort condition'));
    assert.equal(button(f, 'Add sort condition').disabled, true);
    await f.click(button(f, 'Move earlier 2'));
    assert.equal(
        f.window.document.activeElement?.getAttribute('aria-label'),
        'Move earlier 1'
    );
    assert.deepEqual(
        [...f.container.querySelectorAll('select[aria-label^=Field]')].map(
            (field) => {
                assert.ok(field instanceof f.window.HTMLSelectElement);
                return field.value;
            }
        ),
        ['detail', 'title']
    );
    assert.equal(host.commands.length, 0);
    await f.click(button(f, 'Done'));
    assert.equal(host.listeners.size, 0);
    assert.equal(f.container.querySelector('dialog'), null);
    assert.deepEqual(
        host.commands[0].criteria.map((rule) => rule.idOrName),
        [
            { type: 'id', id: 'detail' },
            { type: 'id', id: 'title' },
        ]
    );
    assert.deepEqual(outcomes, [
        { type: 'allocated', requestId: 'actual-host-receipt', generation: 2 },
    ]);
    f.unchangedEffects();
});

it('dismissal keeps a missing criterion until explicit deletion and closes a stale view without a host call', async (t) => {
    const f = await htmlPresentationFixture(t);
    const host = owner();
    const stale = {
        type: 'asc',
        idOrName: { type: 'id', id: 'lost' },
    } as const;
    host.update({ ...host.frame(), criteria: [stale] });
    await f.render(h(PortalVisitorSort, { port: host.port }));
    await f.click(button(f, 'Sort'));
    assert.match(
        f.container.querySelector('dialog')?.textContent ?? '',
        /unavailable/
    );
    await f.click(button(f, 'Close'));
    assert.equal(host.commands.length, 0);
    await f.click(button(f, 'Sort'));
    await f.click(button(f, 'Delete sort condition 1'));
    await act(async () => {
        f.container.querySelector('dialog')?.dispatchEvent(
            new f.window.Event('cancel', {
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.deepEqual(
        host.commands.map((command) => command.criteria),
        [[]]
    );
    await f.click(button(f, 'Sort'));
    await f.click(button(f, 'Delete sort condition 1'));
    await act(async () =>
        host.update({
            ...host.frame(),
            stamp: { ...host.frame().stamp, generation: 3 },
        })
    );
    assert.match(
        f.container.querySelector('dialog')?.textContent ?? '',
        /fields changed/
    );
    await f.click(button(f, 'Done'));
    assert.equal(host.commands.length, 1);
    assert.equal(host.listeners.size, 0);
});

it('retires a host-disabled draft and drops a late receipt after the same port moves to a new generation', async (t) => {
    const f = await htmlPresentationFixture(t);
    const host = owner();
    const outcomes: PortalVisitorSortOutcome[] = [];
    const render = (disabled = false) =>
        f.render(
            h(PortalVisitorSort, {
                port: host.port,
                disabled,
                onOutcome: (outcome) => outcomes.push(outcome),
            })
        );
    await render();
    await f.click(button(f, 'Sort'));
    await f.click(button(f, 'Add sort condition'));
    await render(true);
    await f.click(button(f, 'Done'));
    assert.deepEqual(
        outcomes.map((outcome) => outcome.type),
        ['stale']
    );
    assert.equal(host.commands.length, 0);

    let resolveReceipt: (outcome: PortalVisitorSortOutcome) => void = () => {
        assert.fail('receipt resolver not created');
    };
    host.defer(
        new Promise((resolve) => {
            resolveReceipt = resolve;
        })
    );
    await render();
    await f.click(button(f, 'Sort'));
    await f.click(button(f, 'Add sort condition'));
    await f.click(button(f, 'Done'));
    await f.click(button(f, 'Sort'));
    assert.equal(host.commands.length, 1);
    assert.equal(f.container.querySelector('dialog'), null);
    await act(async () => {
        const first = host.frame();
        host.update({
            ...first,
            stamp: { ...first.stamp, viewId: 'other', generation: 2 },
        });
        host.update({ ...first, stamp: { ...first.stamp, generation: 3 } });
        resolveReceipt({
            type: 'allocated',
            requestId: 'previous-view',
            generation: 2,
        });
    });
    assert.deepEqual(
        outcomes.map((outcome) => outcome.type),
        ['stale']
    );
    assert.match(
        f.container.querySelector('[role=status]')?.textContent ?? '',
        /Open Sort again/
    );
});

it('moves focus to Done after deleting the last unavailable rule when Add is disabled', async (t) => {
    const f = await htmlPresentationFixture(t);
    const host = owner();
    host.update({
        ...host.frame(),
        fields: [],
        criteria: [{ type: 'asc', idOrName: { type: 'id', id: 'lost' } }],
    });
    await f.render(h(PortalVisitorSort, { port: host.port }));
    await f.click(button(f, 'Sort'));
    assert.equal(button(f, 'Add sort condition').disabled, true);
    const remove = button(f, 'Delete sort condition 1');
    remove.focus();
    await f.click(remove);
    assert.equal(f.window.document.activeElement, button(f, 'Done'));
    await f.click(button(f, 'Done'));
    assert.deepEqual(
        host.commands.map((command) => command.criteria),
        [[]]
    );
});
