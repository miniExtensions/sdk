import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h, version } from 'react';
import {
    CompleteReadOnlyTextField,
    CurrencyField,
    ReadonlyPortalRecords,
} from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';
import { htmlPresentationFixture } from './htmlPresentationFixture.mjs';

const text = { type: 'singleLineText', options: null };
const currency = { type: 'currency', options: { symbol: '€', precision: 3 } };
const formatting = {
    numberSeparator: 'period-comma',
    showThousandsSeparator: true,
};
const fields = [
    { id: 'fldTitle', name: 'Name', isPrimaryField: true, config: text },
    { id: 'fldCurrency', name: 'Amount', config: currency },
    { id: 'fldNeighbor', name: 'Note', config: text },
].map((field) => ({
    isComputed: false,
    isPrimaryField: false,
    description: null,
    ...field,
}));
const records = [
    {
        id: 'recDebit',
        fields: {
            fldTitle: 'Debit',
            fldCurrency: -1234.5678,
            fldNeighbor: 'Keep debit',
        },
    },
    {
        id: 'recZero',
        fields: { fldTitle: 'Zero', fldCurrency: 0, fldNeighbor: 'Keep zero' },
    },
    {
        id: 'recNull',
        fields: {
            fldTitle: 'Null',
            fldCurrency: null,
            fldNeighbor: 'Keep null',
        },
    },
    {
        id: 'recOmitted',
        fields: { fldTitle: 'Omitted', fldNeighbor: 'Keep omitted' },
    },
    {
        id: 'recCredit',
        fields: {
            fldTitle: 'Credit',
            fldCurrency: 1234.5,
            fldNeighbor: 'Keep credit',
        },
    },
].map((record) =>
    Object.freeze({ ...record, fields: Object.freeze(record.fields) })
);
const expectedMoney = ['-€1.234,568', '€0,000', '', '', '€1.234,500'];

test('installed readonly Grid preserves native physical Currency display', async (t) => {
    assert.equal(version, process.env.SDK_GRID_CURRENCY_REACT);
    const fixture = await htmlPresentationFixture(t);
    const { container, window } = fixture;
    const actions = { writes: 0, selections: 0, requests: 0 };
    const write = () => {
        actions.writes++;
    };
    container.addEventListener('change', write);
    container.addEventListener('select', () => {
        actions.selections++;
    });
    class RejectXHR {
        open() {
            actions.requests++;
            throw new Error('Unexpected Currency Grid request');
        }
    }
    const previousXHR = Object.getOwnPropertyDescriptor(
        globalThis,
        'XMLHttpRequest'
    );
    Object.defineProperty(globalThis, 'XMLHttpRequest', {
        configurable: true,
        value: RejectXHR,
    });
    Object.defineProperty(window, 'XMLHttpRequest', {
        configurable: true,
        value: RejectXHR,
    });
    t.after(() => {
        if (previousXHR)
            Object.defineProperty(globalThis, 'XMLHttpRequest', previousXHR);
        else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
    });

    const listeners = new Set();
    let stamp = {};
    let projection = {
        portalFieldId: 'fldLedger',
        linkedTableId: 'tblLedger',
        records,
        table: { airtableFields: fields },
        detailProjection: 'present',
        detailFields: fields.map((field) => ({
            fieldId: field.id,
            fieldName: field.name,
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: {
                title: field.name,
                readOnly: true,
                conditionalFields: { logicalOperator: 'and', conditions: [] },
                ...(field.config.type === 'currency' ? formatting : {}),
            },
        })),
    };
    const scope = createBorrowedPortalRenderScope({
        capture: () => ({ stamp, projection }),
        isCurrent: (expected) => expected === stamp,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        invokeIfCurrent() {
            write();
            return false;
        },
    });
    t.after(() => scope.destroy());

    const admittedValues = new Set();
    const renderers = {
        renderSingleLineTextField: ({ value }) =>
            h(CompleteReadOnlyTextField, { value, language: 'en' }),
        renderCurrencyField(field) {
            assert.equal(field.fieldId, 'fldCurrency');
            assert.equal(field.physicalKind, 'currency');
            assert.equal(field.computed, false);
            assert.equal(field.capability.type, 'readonly');
            assert.deepEqual(field.field.config, currency);
            assert.equal(
                field.displayConfig.numberSeparator,
                formatting.numberSeparator
            );
            assert.equal(
                field.displayConfig.showThousandsSeparator,
                formatting.showThousandsSeparator
            );
            admittedValues.add(field.value);
            // Ordinary native Grid Cell bypasses ReadOnlyField for absent values.
            return field.value == null
                ? null
                : h(CurrencyField, {
                      ...field,
                      options: {
                          presentation: 'display',
                          showLabel: false,
                          className: 'read-only-text linkify',
                      },
                  });
        },
    };
    const grid = {
        ready: true,
        preferenceScopeKey: 'currency-grid',
        primaryFieldId: 'fldTitle',
        hiddenColumns: {},
        columnWidths: {},
        onFieldHiddenChange: write,
        onColumnWidthCommit: write,
    };
    const render = () =>
        fixture.render(
            h(ReadonlyPortalRecords, { scope, layout: 'grid', grid, renderers })
        );
    const verify = () => {
        assert.deepEqual(
            admittedValues,
            new Set([-1234.5678, 0, null, undefined, 1234.5])
        );
        assert.equal(projection.records[2].fields.fldCurrency, null);
        assert(Object.hasOwn(projection.records[2].fields, 'fldCurrency'));
        assert(!Object.hasOwn(projection.records[3].fields, 'fldCurrency'));
        assert.deepEqual(actions, { writes: 0, selections: 0, requests: 0 });
        fixture.unchangedEffects();
        assert.equal(
            container.querySelectorAll('[aria-selected="true"]').length,
            0
        );
        assert.equal(window.getSelection()?.toString(), '');
        const headers = [...container.querySelectorAll('th[data-field-id]')];
        assert.deepEqual(
            headers.map((header) => header.dataset.fieldId),
            fields.map((field) => field.id)
        );
        const rows = [...container.querySelectorAll('tr[data-record-id]')];
        assert.deepEqual(
            rows.map((row) => row.dataset.recordId),
            records.map((record) => record.id)
        );
        const cells = rows.flatMap((row, index) => {
            const rowCells = [...row.querySelectorAll('td[data-field-id]')];
            assert.deepEqual(
                rowCells.map((cell) => [
                    cell.dataset.fieldId,
                    cell.dataset.primary,
                    cell.textContent,
                ]),
                [
                    ['fldTitle', 'true', records[index].fields.fldTitle],
                    ['fldCurrency', 'false', expectedMoney[index]],
                    ['fldNeighbor', 'false', records[index].fields.fldNeighbor],
                ]
            );
            const amount = rowCells[1];
            assert(
                !amount.querySelector(
                    'input, button, [role="button"], textarea, select, [contenteditable]'
                ),
                `Unexpected Currency editor in ${row.dataset.recordId}`
            );
            const leaf = amount.querySelector(
                '.mx-sdk-localized-numeric-display'
            );
            if (expectedMoney[index] === '') {
                assert(
                    !leaf,
                    `Unexpected empty-value leaf in ${row.dataset.recordId}`
                );
                assert.equal(amount.firstElementChild.childElementCount, 0);
            } else {
                assert.equal(
                    leaf?.querySelector('p')?.textContent,
                    expectedMoney[index]
                );
            }
            return rowCells;
        });
        // Headers preserve field IDs while the Grid replaces revision-owned controls.
        return [...rows, ...cells];
    };

    await render();
    const revision = scope.getSnapshot().revision;
    const before = verify();
    admittedValues.clear();
    await act(async () => {
        stamp = {};
        projection = { ...projection, records: [...records] };
        for (const listener of listeners) listener();
    });
    await render();
    assert(scope.getSnapshot().revision > revision);
    const after = verify();
    assert.equal(after.length, 20);
    for (const [index, node] of after.entries())
        assert(
            node === before[index],
            `Grid replaced row or cell node ${index}`
        );
    await fixture.render(null);
    assert.equal(listeners.size, 1);
    scope.destroy();
    assert.equal(listeners.size, 0);
    assert.deepEqual(actions, { writes: 0, selections: 0, requests: 0 });
});
