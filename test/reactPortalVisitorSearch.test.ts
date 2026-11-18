import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h } from 'react';
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
    };
    const listeners = new Set<() => void>();
    const commands: PortalVisitorSearchCommand[] = [];
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
        select(viewId: string) {
            frame = {
                ...frame,
                stamp: {
                    ...frame.stamp,
                    viewId,
                    generation: frame.stamp.generation + 1,
                },
            };
            for (const listener of listeners) listener();
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
