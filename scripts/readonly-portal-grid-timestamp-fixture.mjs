import { StrictMode, createElement as h, version } from 'react';
import { flushSync } from 'react-dom';
import {
    CompleteReadOnlyTextField,
    CreatedTimeField,
    LastModifiedTimeField,
    ReadonlyPortalRecords,
} from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';

const columns = [
    ['fldName', 'Name'],
    ['fldCreated', 'Created at'],
    ['fldModified', 'Modified at'],
    ['fldNote', 'Note'],
];
const dateTime = (timeZone) => ({
    type: 'dateTime',
    options: {
        dateFormat: { name: 'friendly', format: 'LL' },
        timeFormat: { name: '24hour', format: 'HH:mm' },
        timeZone,
    },
});
const createdConfig = {
    type: 'createdTime',
    options: { result: dateTime('America/Los_Angeles') },
};
const modifiedConfig = (isValid) => ({
    type: 'lastModifiedTime',
    options: { isValid, result: dateTime('America/New_York') },
});
const text = { type: 'singleLineText', options: null };
const metadata = (valid) =>
    [text, createdConfig, modifiedConfig(valid), text].map((config, index) => ({
        id: columns[index][0],
        name: columns[index][1],
        config,
        description: null,
        isComputed: index === 1 || index === 2,
        isPrimaryField: index === 0,
    }));
const initial = [
    {
        id: 'recStored',
        fields: {
            fldName: 'Stored',
            fldCreated: '2026-11-12T00:30:00.000Z',
            fldModified: '2026-11-12T13:05:00.000Z',
            fldNote: 'Keep stored',
        },
    },
    {
        id: 'recNull',
        fields: {
            fldName: 'Null',
            fldCreated: null,
            fldModified: null,
            fldNote: 'Keep null',
        },
    },
    {
        id: 'recOmitted',
        fields: { fldName: 'Omitted', fldNote: 'Keep omitted' },
    },
];
// Native date formatting uses English, even if the UI language differs.
const displayedCreated = 'November 11, 2026 16:30';
const displayedModified = 'November 12, 2026 08:05';
const display = {
    language: 'fr',
    dateLanguage: 'en',
    displayContext: 'readonly',
};
const zero = {
    intents: 0,
    inputs: 0,
    selections: 0,
    writes: 0,
    submits: 0,
    requests: 0,
};

export function mountTimestampGrid(root, gridNode) {
    const effects = { ...zero };
    const assert = (condition, message) => {
        if (!condition) throw Error(message);
    };
    const equal = (actual, expected, message) =>
        assert(JSON.stringify(actual) === JSON.stringify(expected), message);
    const copyRecords = () =>
        Object.freeze(
            initial.map(({ id, fields }) =>
                Object.freeze({ id, fields: Object.freeze({ ...fields }) })
            )
        );

    let records = copyRecords();
    let fields = metadata(true);
    let stamp = {};
    const listeners = new Set();
    const received = new Set();
    const scope = createBorrowedPortalRenderScope({
        capture: () => ({
            stamp,
            projection: {
                portalFieldId: 'fldTimestampGrid',
                linkedTableId: 'tblTimestampGrid',
                records,
                table: { airtableFields: fields },
                detailProjection: 'present',
                detailFields: fields.map(({ id, name }) => ({
                    fieldId: id,
                    fieldName: name,
                    isHidden: false,
                    fieldIsInEditingChildForm: false,
                    childFormField: null,
                    miniExtConfig: { title: name, readOnly: true },
                })),
            },
        }),
        isCurrent: (expected) => expected === stamp,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        invokeIfCurrent() {
            effects.intents++;
            return false;
        },
    });
    const grid = {
        ready: true,
        preferenceScopeKey: 'readonly-timestamp-grid',
        primaryFieldId: 'fldName',
        hiddenColumns: {},
        columnWidths: {},
    };
    function checkSlot(field, id, config) {
        assert(
            field.fieldId === id &&
                field.context === 'portal-detail' &&
                field.physicalKind === config.type &&
                field.computed &&
                field.capability.type === 'readonly',
            `Expected physical read-only ${config.type} slot`
        );
        equal(field.field.config, config, `Complete ${config.type} metadata`);
        assert(
            field.value == null || typeof field.value === 'string',
            `Stored ${config.type} value`
        );
        received.add(
            JSON.stringify([id, field.value, field.value === undefined])
        );
    }
    const renderers = {
        renderSingleLineTextField: ({ value }) =>
            h(CompleteReadOnlyTextField, { value, language: 'en' }),
        renderCreatedTimeField(field) {
            checkSlot(field, 'fldCreated', createdConfig);
            return field.value == null
                ? null
                : h(CreatedTimeField, {
                      ...display,
                      value: field.value,
                      dateConfig: field.field.config.options.result,
                  });
        },
        renderLastModifiedTimeField(field) {
            const fieldConfig = field.field.config;
            checkSlot(field, 'fldModified', fields[2].config);
            // Native Grid skips nullish values and already-empty formatted values.
            // Invalid timestamp metadata formats to empty before the readonly leaf.
            return field.value == null || !fieldConfig.options.isValid
                ? null
                : h(LastModifiedTimeField, {
                      ...display,
                      value: field.value,
                      fieldConfig,
                  });
        },
    };
    const originalFetch = window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const forbidden = () => {
        effects.requests++;
        throw Error('Unexpected application request from Grid fixture');
    };
    window.fetch = forbidden;
    XMLHttpRequest.prototype.open = forbidden;
    let originalNodes;
    const render = () =>
        flushSync(() =>
            root.render(
                h(
                    StrictMode,
                    null,
                    h(
                        'form',
                        {
                            'aria-label': 'Physical timestamp Grid',
                            onInput: () => effects.inputs++,
                            onSelect: () => effects.selections++,
                            onChange: () => effects.writes++,
                            onSubmit(event) {
                                event.preventDefault();
                                effects.submits++;
                            },
                        },
                        h(ReadonlyPortalRecords, {
                            scope,
                            layout: 'grid',
                            grid,
                            renderers,
                        })
                    )
                )
            )
        );
    const verify = (valid, reuse) => {
        const headers = [...gridNode.querySelectorAll('th[data-field-id]')].map(
            (node) => [node.dataset.fieldId, node.innerText.trim()]
        );
        equal(headers, columns, 'Timestamp headers');
        const rows = [...gridNode.querySelectorAll('tbody tr[data-record-id]')];
        const nodes = rows.flatMap((row) => [
            row,
            ...row.querySelectorAll('td[data-field-id]'),
        ]);
        if (reuse)
            assert(
                nodes.every((node, index) => node === originalNodes[index]),
                'Grid replaced a row or cell'
            );
        else originalNodes = nodes;
        assert(
            nodes.length === initial.length * 5,
            'Unexpected row and cell count'
        );
        equal(
            rows.map((row) => row.dataset.recordId),
            initial.map(({ id }) => id),
            'Row IDs'
        );
        const cells = rows.map((row, index) => {
            const record = initial[index];
            const expected = [
                record.fields.fldName,
                index ? '' : displayedCreated,
                index || !valid ? '' : displayedModified,
                record.fields.fldNote,
            ];
            const rowCells = [...row.querySelectorAll('td[data-field-id]')];
            const actual = rowCells.map((cell, i) => {
                assert(
                    cell.dataset.primary === String(i === 0),
                    `Unexpected primary state for ${cell.dataset.fieldId}`
                );
                assert(
                    cell.checkVisibility(),
                    `Hidden cell ${cell.dataset.fieldId}`
                );
                if ((i === 1 || i === 2) && expected[i] === '') {
                    assert(
                        !cell.querySelector(
                            '.mx-sdk-readonly-text-empty, [role="alert"], svg, [title]'
                        ),
                        'Blank cell has a placeholder'
                    );
                }
                return [cell.dataset.fieldId, cell.innerText.trim()];
            });
            equal(
                actual,
                columns.map(([id], i) => [id, expected[i]]),
                `Native timestamp display for ${record.id}`
            );
            return [record.id, actual];
        });
        assert(
            !gridNode.querySelector(
                'input, button, textarea, select, [role="button"], [contenteditable], [aria-selected="true"]'
            ),
            'Editable, Clear, Open or selected cell appeared'
        );
        equal(effects, zero, 'Readonly effects');
        equal(records, initial, 'Canonical records or neighbors changed');
        const expected = ['fldCreated', 'fldModified']
            .flatMap((id) =>
                initial.map(({ fields }) =>
                    JSON.stringify([id, fields[id], !Object.hasOwn(fields, id)])
                )
            )
            .sort();
        equal(
            [...received].sort(),
            expected,
            'Stored, explicit null and omitted values at the slots'
        );
        return {
            react: version,
            revision: scope.getSnapshot().revision,
            cells,
            reusedNodes: reuse ? nodes.length : null,
            modifiedMetadataValid: fields[2].config.options.isValid,
            received: [...received].sort(),
            effects: { ...effects },
        };
    };
    const republish = (valid) => {
        received.clear();
        records = copyRecords();
        fields = metadata(valid);
        stamp = {};
        flushSync(() => {
            for (const listener of listeners) listener();
        });
        render();
        return verify(valid, true);
    };
    const close = () => {
        root.unmount();
        const afterUnmount = listeners.size;
        scope.destroy();
        window.fetch = originalFetch;
        XMLHttpRequest.prototype.open = originalOpen;
        delete window.__timestampGrid;
        assert(
            afterUnmount === 1 &&
                !listeners.size &&
                !gridNode.childNodes.length,
            'Grid lifecycle leaked'
        );
        equal(effects, zero, 'Effects during teardown');
        return {
            afterUnmount,
            afterDestroy: listeners.size,
            gridRemoved: true,
            effects: { ...effects },
        };
    };
    render();
    const initialObservation = verify(true, false);
    window.__timestampGrid = {
        initial: () => initialObservation,
        republish,
        close,
    };
}
