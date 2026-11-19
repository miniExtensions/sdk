import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { PortalVisitorFilter } from '../src/react/PortalVisitorFilter.js';
import type {
    PortalVisitorFilterCommand,
    PortalVisitorFilterFrame,
    PortalVisitorFilterPort,
} from '../src/portals/visitorFilter.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

function owner() {
    let frame: PortalVisitorFilterFrame = {
        stamp: {
            sessionId: 'owner',
            fieldId: 'linked',
            viewId: 'a',
            configurationRevision: 1,
            metadataRevision: 1,
            generation: 1,
        },
        fields: [
            {
                id: 'title',
                name: 'Title',
                operators: [
                    {
                        label: 'contains',
                        operand: { kind: 'text' },
                        setting: {
                            fieldType: 'singleLineText',
                            type: 'contains',
                            idOrName: { type: 'id', id: 'title' },
                            value: '',
                        },
                    },
                ],
            },
        ],
        criteria: null,
    };
    const listeners = new Set<() => void>();
    const commands: PortalVisitorFilterCommand[] = [];
    let reads = 0;
    const port: PortalVisitorFilterPort = {
        read() {
            reads++;
            return frame;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        apply(command) {
            commands.push(command);
            return { type: 'allocated', requestId: 'request', generation: 2 };
        },
    };
    return {
        port,
        commands,
        reads: () => reads,
        listeners,
        update(viewId: string, generation: number) {
            frame = { ...frame, stamp: { ...frame.stamp, viewId, generation } };
            for (const f of listeners) f();
        },
    };
}

function button(
    f: Awaited<ReturnType<typeof htmlPresentationFixture>>,
    label: string
) {
    const result = Array.from(f.container.querySelectorAll('button')).find(
        (node) => node.textContent === label
    );
    assert.ok(result, `Expected the ${label} button`);
    return result;
}

for (const finish of ['Done', 'Close', 'Escape'] as const) {
    test(`mounted advanced Filter applies the nested tree once through ${finish}`, async (t) => {
        const host = owner();
        const markup = renderToString(
            h(PortalVisitorFilter, { port: host.port })
        );
        assert.match(markup, /Filter/);
        assert.equal(host.reads(), 0);
        const f = await htmlPresentationFixture(t);
        await f.render(h(PortalVisitorFilter, { port: host.port }));
        assert.equal(host.reads(), 0);
        await f.click(button(f, 'Filter'));
        await f.click(button(f, 'Add group'));
        assert.ok(f.container.querySelector('dialog[open]'));
        const group = f.container.querySelector('fieldset');
        assert.ok(group);
        const add = Array.from(group.querySelectorAll('button')).find(
            (node) => node.textContent === 'Add condition'
        );
        assert.ok(add);
        await f.click(add);
        assert.equal(host.commands.length, 0);
        if (finish === 'Escape') {
            const dialog = f.container.querySelector('dialog');
            assert.ok(dialog);
            await act(async () => {
                const event = new f.window.Event('cancel', {
                    bubbles: true,
                    cancelable: true,
                });
                dialog.dispatchEvent(event);
                assert.equal(event.defaultPrevented, true);
            });
        } else await f.click(button(f, finish));
        assert.equal(host.commands.length, 1);
        const tree = host.commands[0].criteria;
        const node = tree?.conditions[0];
        assert.equal(node?.type, 'groupCondition');
        assert.equal(node.conditions.length, 1);
        assert.equal(node.conditions[0].type, 'singleCondition');
        assert.equal(f.container.querySelector('dialog'), null);
        assert.equal(host.listeners.size, 0);
    });
}

test('mounted advanced Filter closes a retired A→B→A draft with zero commands', async (t) => {
    const host = owner();
    const f = await htmlPresentationFixture(t);
    await f.render(h(PortalVisitorFilter, { port: host.port }));
    await f.click(button(f, 'Filter'));
    await f.click(button(f, 'Add condition'));
    await act(async () => {
        host.update('b', 2);
        host.update('a', 3);
    });
    await f.click(button(f, 'Done'));
    assert.equal(host.commands.length, 0);
    assert.match(
        f.container.querySelector('[role="status"]')?.textContent ?? '',
        /changed/
    );
    assert.equal(host.listeners.size, 0);
});
