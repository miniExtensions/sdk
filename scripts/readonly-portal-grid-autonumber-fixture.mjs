import { getReadableStringFromAirtableValue } from '@miniextensions/sdk/formulas';
import {
    AutoNumberField,
    CompleteReadOnlyTextField,
    ReadonlyPortalRecords,
} from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';
import { createElement as h, StrictMode, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const columns = [
    ['fldName', 'Name', 'singleLineText'],
    ['fldSerial', 'AutoNumber', 'autoNumber'],
    ['fldNote', 'Note', 'singleLineText'],
];
const fields = columns.map(([id, name, type]) => ({
    id,
    name,
    description: '',
    isPrimaryField: id === 'fldName',
    isComputed: type === 'autoNumber',
    config: { type, options: null },
}));
const detailFields = fields.map(({ id, name }) => ({
    fieldId: id,
    fieldName: name,
    isHidden: false,
    fieldIsInEditingChildForm: false,
    childFormField: null,
    miniExtConfig: {
        title: name,
        readOnly: true,
        conditionalFields: { logicalOperator: 'and', conditions: [] },
    },
}));
const cases = [
    { id: 'recNonzero', title: 'Nonzero', value: 1234567, text: '1234567' },
    { id: 'recZero', title: 'Saved zero', value: 0, text: '0' },
    { id: 'recNull', title: 'Explicit null', value: null, text: '' },
    { id: 'recOmitted', title: 'Omitted', text: '' },
];
const copyRecord = ({ id, title, value }) => ({
    id,
    fields: {
        fldName: title,
        ...(value === undefined ? {} : { fldSerial: value }),
        fldNote: `Keep ${title}`,
    },
});
const effects = { opens: 0, writes: 0, submits: 0, requests: 0 };
const write = () => effects.writes++;
const listeners = new Set();
const delivered = new Set();
let stamp = {};
let records = cases.map(copyRecord);
let subscriptions = 0;
const ownedScope = createBorrowedPortalRenderScope({
    capture: () => ({
        stamp,
        projection: {
            portalFieldId: 'fldInventory',
            linkedTableId: 'tblInventory',
            records,
            table: { airtableFields: fields },
            detailProjection: 'present',
            detailFields,
        },
    }),
    isCurrent: (candidate) => candidate === stamp,
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    invokeIfCurrent() {
        effects.opens++;
        return false;
    },
});
const scope = {
    ...ownedScope,
    subscribe(listener) {
        const unsubscribe = ownedScope.subscribe(listener);
        subscriptions++;
        return () => {
            unsubscribe();
            subscriptions--;
        };
    },
};
const grid = {
    ready: true,
    preferenceScopeKey: 'readonly-autonumber-grid',
    primaryFieldId: 'fldName',
    columnWidths: {},
    hiddenColumns: {},
    onFieldHiddenChange: write,
    onColumnWidthCommit: write,
};
const rootNode = document.getElementById('grid');
const root = createRoot(rootNode);
const receiptNode = document.getElementById('receipt');
const receipt = { react: version, error: null };
const events = new AbortController();
const fetch = window.fetch;
const open = XMLHttpRequest.prototype.open;
const refuseRequest = () => {
    effects.requests++;
    throw new Error('Unexpected request from the readonly Grid');
};
window.fetch = async () => refuseRequest();
XMLHttpRequest.prototype.open = refuseRequest;

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
    assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

const renderers = {
    renderSingleLineTextField: ({ value }) =>
        h(CompleteReadOnlyTextField, { value, language: 'fr' }),
    renderAutoNumberField(field) {
        equal(
            [field.fieldId, field.context, field.physicalKind, field.computed],
            ['fldSerial', 'portal-detail', 'autoNumber', true],
            'Expected the physical, computed AutoNumber detail slot'
        );
        equal(field.field.config, fields[1].config, 'AutoNumber schema');
        equal(field.capability, { type: 'readonly' }, 'Read-only capability');
        delivered.add(field.value);
        // Native Grid blanks nullish or empty formatted values before the leaf.
        if (field.value == null) return null;
        const value = getReadableStringFromAirtableValue({
            value: field.value,
            airtableFieldConfig: field.field.config,
            fieldName: field.field.name,
            source: {
                type: 'airtableMock',
                linkedTableStates: {},
                dateParsing: 'local',
            },
        });
        return value === ''
            ? null
            : h(AutoNumberField, { mode: 'controlled', language: 'fr', value });
    },
};
const originalNodes = new Map();
const interactive =
    'input, button, a, textarea, select, [role="button"], [contenteditable="true"], [data-testid="no-value-test-id"], [aria-selected="true"]';

function capture(expected, republished) {
    assert(!rootNode.querySelector(interactive), 'Grid exposed a control');
    assert(!getSelection()?.toString(), 'Unexpected text selection');
    const headers = [...rootNode.querySelectorAll('th[data-field-id]')];
    equal(
        headers.map((header) => [
            header.dataset.fieldId,
            header.innerText.trim(),
        ]),
        columns.map(([id, title]) => [id, title]),
        'Column identity, order and title'
    );
    const rows = [...rootNode.querySelectorAll('tr[data-record-id]')];
    equal(
        rows.map((row) => row.dataset.recordId),
        expected.map(({ id }) => id),
        'Row IDs and order'
    );
    let retained = 0;
    const cells = rows.map((row, index) => {
        const { id, title, text, value } = expected[index];
        equal(
            Object.hasOwn(records[index].fields, 'fldSerial'),
            value !== undefined,
            'Raw field presence'
        );
        equal(records[index].fields.fldSerial, value, 'Raw value');
        const entries = [...row.querySelectorAll('td[data-field-id]')];
        const values = entries.map((cell) => [
            cell.dataset.fieldId,
            cell.dataset.primary,
            cell.innerText.trim(),
        ]);
        equal(
            values,
            [
                ['fldName', 'true', title],
                ['fldSerial', 'false', text],
                ['fldNote', 'false', `Keep ${title}`],
            ],
            `Literal display and neighbor for ${id}`
        );
        const leaf = entries[1].querySelector('.mx-sdk-complete-readonly-text');
        assert(
            text ? leaf?.checkVisibility() : !leaf,
            `AutoNumber leaf for ${id}`
        );
        if (text === '')
            equal(
                entries[1].firstElementChild.childElementCount,
                0,
                `Blank cell decoration for ${id}`
            );
        for (const node of [row, ...entries]) {
            const key = `${id}/${node.dataset.fieldId ?? ''}`;
            if (republished) {
                assert(originalNodes.get(key) === node, `Remounted ${key}`);
                retained++;
            } else originalNodes.set(key, node);
        }
        return { id, values, hasValue: value !== undefined };
    });
    equal(delivered.size, 4, 'Physical slot received all four raw values');
    assert(
        expected.every(({ value }) => delivered.has(value)),
        'Physical slot payload'
    );
    equal(
        effects,
        { opens: 0, writes: 0, submits: 0, requests: 0 },
        'Grid effects'
    );
    return { cells, retained, effects: { ...effects } };
}

function run(name, check) {
    try {
        receipt[name] = check();
    } catch (error) {
        receipt.error = error instanceof Error ? error.message : String(error);
        throw error;
    } finally {
        receiptNode.textContent = JSON.stringify(receipt);
    }
}

run('initial', () => {
    flushSync(() =>
        root.render(
            h(
                StrictMode,
                null,
                h(
                    'form',
                    {
                        onInput: write,
                        onSubmit(event) {
                            event.preventDefault();
                            effects.submits++;
                        },
                    },
                    h(ReadonlyPortalRecords, {
                        scope,
                        grid,
                        renderers,
                        layout: 'grid',
                    })
                )
            )
        )
    );
    return capture(cases, false);
});

document.getElementById('republish').addEventListener(
    'click',
    () =>
        run('republished', () => {
            const reordered = [...cases].reverse();
            delivered.clear();
            const previousRevision = scope.getSnapshot().revision;
            flushSync(() => {
                records = reordered.map(copyRecord);
                stamp = {};
                for (const notify of [...listeners]) notify();
            });
            assert(
                scope.getSnapshot().revision > previousRevision,
                'Projection did not republish'
            );
            return capture(reordered, true);
        }),
    { signal: events.signal }
);

document.getElementById('dispose').addEventListener(
    'click',
    () =>
        run('disposed', () => {
            try {
                flushSync(() => root.unmount());
            } finally {
                ownedScope.destroy();
                events.abort();
                window.fetch = fetch;
                XMLHttpRequest.prototype.open = open;
            }
            equal(
                [listeners.size, subscriptions, rootNode.childElementCount],
                [0, 0, 0],
                'Grid teardown'
            );
            equal(
                effects,
                { opens: 0, writes: 0, submits: 0, requests: 0 },
                'Final effect counts'
            );
            return {
                listeners: listeners.size,
                subscriptions,
                effects: { ...effects },
            };
        }),
    { signal: events.signal }
);
