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
        seed(
            next: Pick<
                PortalVisitorFilterFrame,
                'criteria' | 'effectiveSettings'
            >
        ) {
            frame = { ...frame, ...next };
        },
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

for (const flow of ['revert', 'net edit', 'delete while edited'] as const) {
    test(`mounted projected Filter preserves raw versus effective settings through ${flow}`, async (t) => {
        const host = owner();
        const effective = {
            fieldType: 'singleLineText',
            type: 'contains',
            idOrName: { type: 'id', id: 'title' },
            value: 'Keep',
        } as const;
        const raw = {
            ...effective,
            idOrName: { type: 'name', name: 'Former title' } as const,
        };
        host.seed({
            criteria: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'group',
                        type: 'groupCondition',
                        logicalOperator: 'or',
                        conditions: [
                            {
                                id: 'former',
                                type: 'singleCondition',
                                setting: raw,
                            },
                            {
                                id: 'sibling',
                                type: 'singleCondition',
                                setting: {
                                    ...effective,
                                    idOrName: { type: 'name', name: 'Removed' },
                                },
                            },
                        ],
                    },
                ],
            },
            effectiveSettings: { former: effective },
        });
        const f = await htmlPresentationFixture(t);
        await f.render(h(PortalVisitorFilter, { port: host.port }));
        await f.click(button(f, 'Filter'));
        const input = f.container.querySelector('input');
        assert.ok(input);
        assert.equal(input.value, 'Keep');
        const write = Object.getOwnPropertyDescriptor(
            f.window.HTMLInputElement.prototype,
            'value'
        )?.set;
        assert.ok(write);
        const edit = async (value: string) => {
            await act(async () => {
                write.call(input, value);
                input.dispatchEvent(
                    new f.window.Event('input', { bubbles: true })
                );
            });
            assert.equal(input.value, value);
        };
        await edit('Changed');
        if (flow === 'delete while edited') {
            const remove = Array.from(f.container.querySelectorAll('button'))
                .filter((node) => node.textContent === 'Delete condition')
                .at(-1);
            assert.ok(remove);
            await f.click(remove);
        }
        if (flow !== 'net edit') await edit('Keep');
        assert.equal(host.commands.length, 0);
        await f.click(button(f, 'Done'));
        if (flow === 'revert') {
            assert.equal(host.commands.length, 0);
            return;
        }
        assert.equal(host.commands.length, 1);
        const group = host.commands[0].criteria?.conditions[0];
        assert.equal(group?.type, 'groupCondition');
        assert.equal(group.conditions.length, flow === 'net edit' ? 2 : 1);
        assert.deepEqual(group.conditions[0], {
            id: 'former',
            type: 'singleCondition',
            setting: {
                ...effective,
                value: flow === 'net edit' ? 'Changed' : 'Keep',
            },
        });
    });
}

test('the mounted dialog allows two group levels and disables the third', async (t) => {
    const host = owner();
    const f = await htmlPresentationFixture(t);
    await f.render(h(PortalVisitorFilter, { port: host.port }));
    await f.click(button(f, 'Filter'));
    await f.click(button(f, 'Add group'));
    const outer = f.container.querySelector('fieldset');
    assert.ok(outer);
    const nest = Array.from(outer.querySelectorAll('button')).find(
        (node) => node.textContent === 'Add group'
    );
    assert.ok(nest);
    assert.equal(nest.disabled, false);
    await f.click(nest);
    const inner = outer.querySelector('fieldset');
    assert.ok(inner);
    const third = Array.from(inner.querySelectorAll('button')).find(
        (node) => node.textContent === 'Add group'
    );
    assert.ok(third);
    assert.equal(third.disabled, true);
    await f.click(third);
    assert.equal(f.container.querySelectorAll('fieldset').length, 2);
    await f.click(button(f, 'Done'));
    assert.equal(host.commands.length, 1);
});

test('the mounted dialog preserves the original deeper subtree during an unrelated delete', async (t) => {
    const host = owner();
    const effective = {
        fieldType: 'singleLineText',
        type: 'contains',
        idOrName: { type: 'id', id: 'title' },
        value: 'Keep',
    } as const;
    const raw = {
        ...effective,
        idOrName: { type: 'name', name: 'Old title' } as const,
    };
    const retained = {
        id: 'outer',
        type: 'groupCondition' as const,
        logicalOperator: 'and' as const,
        conditions: [
            {
                id: 'middle',
                type: 'groupCondition' as const,
                logicalOperator: 'or' as const,
                conditions: [
                    {
                        id: 'unsupported',
                        type: 'groupCondition' as const,
                        logicalOperator: 'and' as const,
                        conditions: [
                            {
                                id: 'former',
                                type: 'singleCondition' as const,
                                setting: raw,
                            },
                        ],
                    },
                ],
            },
        ],
    };
    host.seed({
        criteria: {
            logicalOperator: 'or',
            conditions: [
                {
                    id: 'unrelated',
                    type: 'singleCondition',
                    setting: effective,
                },
                retained,
            ],
        },
        effectiveSettings: { former: effective },
    });
    const f = await htmlPresentationFixture(t);
    await f.render(h(PortalVisitorFilter, { port: host.port }));
    await f.click(button(f, 'Filter'));
    await f.click(button(f, 'Delete condition'));
    await f.click(button(f, 'Done'));
    assert.equal(host.commands.length, 1);
    assert.deepEqual(host.commands[0].criteria, {
        logicalOperator: 'or',
        conditions: [retained],
    });
});
