import assert from 'node:assert/strict';
import { it } from 'node:test';
import { act, createElement as h, useState } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalGridSingleSelectCell,
    type PortalGridSingleSelectCellProps,
} from '../src/react/PortalGridSingleSelectCell.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

const choices = [
    { id: 'choice-1', name: 'airtable-open', displayName: 'Open for review' },
    { id: 'choice-2', name: 'airtable-done', displayName: 'Work completed' },
];

it('selects the physical cell before writing a labeled option to its row and field', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const records = ['row-first', 'row-current'];
    const fields = ['field-other', 'field-status'];
    const selections: string[] = [];
    const writes: Array<{
        tableId: string;
        recordId: string;
        fieldId: string;
        value: string | null;
    }> = [];
    const ownerTokens = new Map<string, symbol>(
        records.flatMap((recordId) =>
            fields.map(
                (fieldId) => [`${recordId}:${fieldId}`, Symbol()] as const
            )
        )
    );

    function Grid() {
        const [selected, setSelected] = useState<string>();
        const [values, setValues] = useState<Record<string, string | null>>({});
        return h(
            'table',
            null,
            h(
                'tbody',
                null,
                records.map((recordId) =>
                    h(
                        'tr',
                        { key: recordId },
                        fields.map((fieldId) => {
                            const cellIdentity = `${recordId}:${fieldId}`;
                            const title =
                                fieldId === 'field-status' ? 'Status' : 'Other';
                            const value = Object.hasOwn(values, cellIdentity)
                                ? values[cellIdentity]
                                : choices[0].name;
                            return h(PortalGridSingleSelectCell, {
                                key: fieldId,
                                cellIdentity,
                                title,
                                selected: selected === cellIdentity,
                                onSelect() {
                                    selections.push(cellIdentity);
                                    setSelected(cellIdentity);
                                },
                                value,
                                displayText:
                                    choices.find(
                                        (choice) => choice.name === value
                                    )?.displayName ?? '',
                                rowHeight: 'medium',
                                choices,
                                editor: {
                                    owner: {
                                        token: ownerTokens.get(cellIdentity),
                                        isCurrent: () =>
                                            selected === cellIdentity,
                                    },
                                    availableChoices: choices,
                                    formId: fixture.container.id,
                                    onValueChange(next) {
                                        writes.push({
                                            tableId: 'table-grid',
                                            recordId,
                                            fieldId,
                                            value: next,
                                        });
                                        setValues((previous) => ({
                                            ...previous,
                                            [cellIdentity]: next,
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
    const cell = fixture.container.querySelector('tr:last-child td:last-child');
    assert.ok(cell instanceof fixture.window.HTMLTableCellElement);
    assert.equal(cell.querySelector('[role="combobox"]'), null);
    assert.deepEqual(selections, []);

    await fixture.click(cell);
    assert.deepEqual(selections, ['row-current:field-status']);
    assert.equal(fixture.window.document.activeElement, cell);
    assert.equal(writes.length, 0);
    const input = cell.querySelector('[role="combobox"]');
    assert.ok(
        input instanceof fixture.window.HTMLInputElement,
        'a selected writable Grid cell exposes its Select picker'
    );
    assert.equal(input.form, fixture.container);
    assert.equal(input.getAttribute('form'), fixture.container.id);
    assert.equal(
        fixture.container.querySelectorAll('[role="combobox"]').length,
        1
    );
    assert.equal(cell.querySelector('[role="listbox"]'), null);

    await fixture.click(input);
    const option = [...cell.querySelectorAll('[role="option"]')].find(
        (element) => element.textContent === 'Work completed'
    );
    assert.ok(option instanceof fixture.window.HTMLElement);
    assert.equal(writes.length, 0);
    await fixture.click(option);
    assert.deepEqual(writes, [
        {
            tableId: 'table-grid',
            recordId: 'row-current',
            fieldId: 'field-status',
            value: 'airtable-done',
        },
    ]);
    assert.deepEqual(selections, ['row-current:field-status']);
    assert.equal(cell.querySelector('[role="listbox"]'), null);
    assert.equal(
        cell
            .querySelector('.mx-sdk-select-badge')
            ?.textContent?.replace('×', ''),
        'Work completed'
    );
    assert.equal(
        fixture.container.querySelector(
            'tr:first-child td:last-child .mx-sdk-select-badge'
        )?.textContent,
        'Open for review'
    );
    fixture.unchangedEffects();
});

function table(overrides: Partial<PortalGridSingleSelectCellProps> = {}) {
    return h(
        'table',
        null,
        h(
            'tbody',
            null,
            h(
                'tr',
                null,
                h(PortalGridSingleSelectCell, {
                    cellIdentity: 'row-A:status',
                    title: 'Status',
                    value: choices[0].name,
                    displayText: choices[0].displayName,
                    selected: true,
                    onSelect() {},
                    choices,
                    rowHeight: 'medium',
                    ...overrides,
                })
            )
        )
    );
}

it('keeps readonly badges, unavailable choices, blank cells and edit guidance', () => {
    const readonly = renderToString(
        table({
            readOnlyGuidance: {
                label: 'Use the edit form',
                text: 'Edit rules for this field require the edit form.',
            },
        })
    );
    assert.match(readonly, /Open for review/);
    assert.match(readonly, /data-editing="false"/);
    assert.match(readonly, /mx-sdk-portal-grid-text-cell__selection/);
    assert.match(
        readonly,
        /<button[^>]*type="button"[^>]*aria-label="Use the edit form"/
    );
    assert.doesNotMatch(readonly, /<input|role="listbox"|airtable-open/);
    const unavailable = renderToString(
        table({ value: 'retired-choice', displayText: 'retired-choice' })
    );
    assert.match(unavailable, /mx-sdk-select-badge[^>]*>retired-choice/);
    const blank = renderToString(
        table({ value: choices[0].name, displayText: '' })
    );
    assert.match(blank, /class="read-only-text"><\/span>/);
    assert.doesNotMatch(blank, /Open for review|None/);
});

it('refuses stale owners and removes picker targets when a slot is reused or made readonly', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    let current = true;
    let throws = false;
    const writes: string[] = [];
    const token = Symbol();
    const editor: NonNullable<PortalGridSingleSelectCellProps['editor']> = {
        owner: {
            token,
            isCurrent() {
                if (throws) throw new Error('Owner retired');
                return current;
            },
        },
        availableChoices: choices,
        onValueChange(value) {
            writes.push(`A:${value}`);
        },
    };
    const open = async () => {
        const input = fixture.container.querySelector('[role="combobox"]');
        assert.ok(input instanceof fixture.window.HTMLInputElement);
        await fixture.click(input);
        const option = fixture.container.querySelector(
            '[role="option"]:last-child'
        );
        assert.ok(option instanceof fixture.window.HTMLElement);
        return { input, option };
    };
    await fixture.render(table({ editor }));
    const cell = fixture.container.querySelector('td');
    const started = await open();
    current = false;
    await fixture.click(started.option);
    throws = true;
    await fixture.click(started.option);
    assert.equal(writes.length, 0);

    const replacement = {
        ...editor,
        owner: { token, isCurrent: () => true },
        onValueChange(value: string | null) {
            writes.push(`B:${value}`);
        },
    };
    await fixture.render(
        table({ cellIdentity: 'row-B:status', editor: replacement })
    );
    assert.equal(fixture.container.querySelector('td'), cell);
    assert.equal(started.input.isConnected, false);
    assert.equal(started.option.isConnected, false);
    assert.equal(fixture.container.querySelector('[role="listbox"]'), null);
    await fixture.click(started.option);
    const held = await open();
    await fixture.render(table({ cellIdentity: 'row-B:status' }));
    assert.equal(held.option.isConnected, false);
    assert.equal(fixture.container.querySelector('[role="combobox"]'), null);
    await fixture.render(
        table({ cellIdentity: 'row-B:status', editor: replacement })
    );
    await fixture.click(held.option);
    assert.equal(writes.length, 0);
    const fresh = await open();
    await fixture.click(fresh.option);
    assert.deepEqual(writes, ['B:airtable-done']);
});

it('admits only available list choices and clears through the current Form-associated editor', async (t) => {
    const fixture = await htmlPresentationFixture(t);
    const writes: Array<string | null> = [];
    const editor: NonNullable<PortalGridSingleSelectCellProps['editor']> = {
        owner: { token: Symbol(), isCurrent: () => true },
        availableChoices: [choices[1]],
        presentation: 'list',
        formId: fixture.container.id,
        onValueChange: (value) => {
            writes.push(value);
        },
    };
    await fixture.render(table({ editor }));
    const radios = fixture.container.querySelectorAll('input[type="radio"]');
    assert.equal(radios.length, 1);
    const [radio] = radios;
    assert.ok(radio instanceof fixture.window.HTMLInputElement);
    assert.equal(radio.form, fixture.container);
    assert.equal(radio.labels?.[0]?.textContent, 'Work completed');
    await fixture.click(radio);
    assert.deepEqual(writes, ['airtable-done']);
    await fixture.render(table({ editor, value: choices[1].name }));
    const clear = fixture.container.querySelector('button[aria-label="Clear"]');
    assert.ok(clear instanceof fixture.window.HTMLButtonElement);
    assert.equal(clear.type, 'button');
    assert.equal(clear.form, fixture.container);
    await act(async () => clear.click());
    assert.deepEqual(writes, ['airtable-done', null]);
    fixture.unchangedEffects();
});
