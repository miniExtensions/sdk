import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createElement as h, useState } from 'react';
import {
    PortalGridMultipleSelectCell,
    type PortalGridMultipleSelectCellProps,
} from '../src/react/PortalGridMultipleSelectCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const choices = [
    { id: 'first', name: 'canonical-first', displayName: 'First choice' },
    { id: 'second', name: 'canonical-second', displayName: 'Second choice' },
];
const firstValue = choices[0].name;
const secondValue = choices[1].name;

it('selects a physical Grid cell, then adds and removes only the chosen canonical value', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const rows = ['row-A', 'row-B'];
    const fields = ['field-other', 'field-tags'];
    const selections: string[] = [];
    const writes: { recordId: string; fieldId: string; value: string[] }[] = [];

    function Grid() {
        const [selected, setSelected] = useState<string>();
        const [values, setValues] = useState<Record<string, string[]>>({});
        return h(
            'table',
            null,
            h(
                'tbody',
                null,
                rows.map((recordId) =>
                    h(
                        'tr',
                        { key: recordId },
                        fields.map((fieldId) => {
                            const identity = `${recordId}:${fieldId}`;
                            const value = values[identity] ?? [firstValue];
                            return h(PortalGridMultipleSelectCell, {
                                key: fieldId,
                                cellIdentity: identity,
                                title: 'Tags',
                                displayText: value.join(', '),
                                value,
                                choices,
                                rowHeight: 'medium',
                                selected: selected === identity,
                                onSelect() {
                                    selections.push(identity);
                                    setSelected(identity);
                                },
                                editor: {
                                    availableChoices: choices,
                                    presentation: 'list',
                                    formId: fixture.container.id,
                                    owner: {
                                        token: identity,
                                        isCurrent: () => selected === identity,
                                    },
                                    onValueChange(next) {
                                        writes.push({
                                            recordId,
                                            fieldId,
                                            value: next,
                                        });
                                        setValues((previous) => ({
                                            ...previous,
                                            [identity]: next,
                                        }));
                                    },
                                },
                            });
                        })
                    )
                )
            )
        );
    }

    await fixture.render(h(Grid));
    const cells = fixture.container.querySelectorAll('td');
    assert.equal(cells.length, 4);
    const target = cells[3];
    assert.ok(
        target.className.includes('mx-sdk-portal-grid-multiple-select-cell')
    );
    assert.equal(target.querySelector('input'), null);
    await fixture.click(target);
    assert.deepEqual(selections, ['row-B:field-tags']);
    assert.deepEqual(writes, []);
    const [first, second] = Array.from(
        target.querySelectorAll('input[type="checkbox"]')
    );
    assert.ok(first instanceof fixture.window.HTMLInputElement);
    assert.ok(second instanceof fixture.window.HTMLInputElement);
    assert.equal(second.form, fixture.container);
    assert.equal(second.labels?.[0]?.textContent, 'Second choice');
    assert.equal(first.checked, true);
    assert.equal(second.checked, false);

    await fixture.click(second);
    assert.deepEqual(writes, [
        {
            recordId: 'row-B',
            fieldId: 'field-tags',
            value: [firstValue, secondValue],
        },
    ]);
    assert.equal(first.checked, true);
    assert.equal(second.checked, true);
    await fixture.click(second);
    assert.deepEqual(writes, [
        {
            recordId: 'row-B',
            fieldId: 'field-tags',
            value: [firstValue, secondValue],
        },
        { recordId: 'row-B', fieldId: 'field-tags', value: [firstValue] },
    ]);
    assert.equal(first.checked, true);
    assert.equal(second.checked, false);
    assert.ok(
        Array.from(cells)
            .slice(0, 3)
            .every((cell) => cell.textContent === 'First choice')
    );
    fixture.unchangedEffects();
});

it('retires a recycled editor and refuses changes from its replacement when the owner is stale', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: string[][] = [];
    const frame: PortalGridMultipleSelectCellProps = {
        cellIdentity: 'row-A:tags',
        title: 'Tags',
        value: [firstValue],
        choices,
        displayText: 'First choice',
        rowHeight: 'short',
        selected: true,
        onSelect() {},
        editor: {
            availableChoices: choices,
            presentation: 'list',
            owner: { token: Symbol(), isCurrent: () => true },
            onValueChange: (value) => {
                writes.push(value);
            },
        },
    };
    const table = (props: PortalGridMultipleSelectCellProps) =>
        h(
            'table',
            null,
            h(
                'tbody',
                null,
                h('tr', null, h(PortalGridMultipleSelectCell, props))
            )
        );
    const input = () =>
        fixture.container.querySelectorAll('input[type="checkbox"]')[1];
    assert.ok(frame.editor);
    const extendedEditor = {
        ...frame.editor,
        value: [secondValue],
        disabled: true,
    };
    await fixture.render(table({ ...frame, editor: extendedEditor }));
    const old = input();
    assert.ok(old instanceof fixture.window.HTMLInputElement);
    assert.equal(old.checked, false);
    assert.equal(old.disabled, false);
    await fixture.render(
        table({
            ...frame,
            cellIdentity: 'row-B:tags',
            editor: {
                ...frame.editor,
                owner: { token: Symbol(), isCurrent: () => false },
            },
        })
    );
    const current = input();
    assert.ok(current instanceof fixture.window.HTMLInputElement);
    assert.notEqual(old, current);
    assert.equal(old.isConnected, false);
    await fixture.click(old);
    await fixture.click(current);
    assert.deepEqual(writes, []);
    fixture.unchangedEffects();
});
