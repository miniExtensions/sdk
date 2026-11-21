import { StrictMode, createElement as h, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { PercentField, ReadonlyPortalRecords } from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';

const columns = [
    ['fldName', 'Name', 'singleLineText'],
    ['fldProgress', 'Progress', 'percent'],
    ['fldPlain', 'Percent', 'percent'],
    ['fldNote', 'Note', 'singleLineText'],
];
const fields = columns.map(([id, name, type]) => ({
    id,
    name,
    description: null,
    isComputed: false,
    isPrimaryField: id === 'fldName',
    config: { type, options: type === 'percent' ? { precision: 2 } : null },
}));
const cases = [
    { id: 'Mixed', value: 0.425, label: '42,50%', fill: 42.5 },
    { id: 'Rounded', value: 0.426175, label: '42,62%', fill: 42.6175 },
    { id: 'Negative', value: -0.125, label: '-12,50%', fill: 0 },
    { id: 'Over', value: 1.2345, label: '123,45%', fill: 100 },
    { id: 'Zero', value: 0, label: '0,00%', fill: 0 },
    { id: 'Null', value: null, label: '', fill: null },
    { id: 'Omitted', label: '', fill: null },
];
const freezeRecord = ({ id, fields: values }) =>
    Object.freeze({ id, fields: Object.freeze(values) });
const initialRecords = Object.freeze(
    cases.map(({ id, value }) =>
        freezeRecord({
            id: `rec${id}`,
            fields: {
                fldName: id,
                ...(value === undefined
                    ? {}
                    : { fldProgress: value, fldPlain: value }),
                fldNote: `Keep ${id}`,
            },
        })
    )
);
const detailFields = fields.map((field) => ({
    fieldId: field.id,
    fieldName: field.name,
    isHidden: false,
    fieldIsInEditingChildForm: false,
    childFormField: null,
    miniExtConfig: {
        title: field.name,
        conditionalFields: { logicalOperator: 'and', conditions: [] },
        ...(field.config.type === 'percent'
            ? {
                  numberSeparator: 'period-comma',
                  showAsProgressBar: field.id === 'fldProgress',
              }
            : {}),
    },
}));
const grid = {
    ready: true,
    preferenceScopeKey: 'readonly-percent-grid',
    primaryFieldId: 'fldName',
    hiddenColumns: {},
    columnWidths: {},
};
const effects = { intent: 0, input: 0, writes: 0, submits: 0, requests: 0 };
const trusted = { progressCellClick: 0, Enter: 0, Escape: 0 };
const delivered = new Map();
const listeners = new Set();
let gridSubscriptions = 0;
let stamp = {};
let records = initialRecords;
const ownedScope = createBorrowedPortalRenderScope({
    capture: () => ({
        stamp,
        projection: {
            portalFieldId: 'fldRatios',
            linkedTableId: 'tblRatios',
            records,
            table: { airtableFields: fields },
            detailProjection: 'present',
            detailFields,
        },
    }),
    isCurrent: (expected) => expected === stamp,
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    invokeIfCurrent() {
        effects.intent++;
        return false;
    },
});
const scope = {
    ...ownedScope,
    subscribe(listener) {
        const unsubscribe = ownedScope.subscribe(listener);
        gridSubscriptions++;
        return () => {
            unsubscribe();
            gridSubscriptions--;
        };
    },
};
const rootNode = document.getElementById('grid');
const root = createRoot(rootNode);
const report = document.getElementById('receipt');
const republish = document.getElementById('republish');
const dispose = document.getElementById('dispose');
const fixtureEvents = new AbortController();
rootNode.addEventListener(
    'click',
    (event) => {
        if (
            event.isTrusted &&
            event.target.closest(
                'tr[data-record-id="recMixed"] td[data-field-id="fldProgress"]'
            )
        )
            trusted.progressCellClick++;
    },
    { signal: fixtureEvents.signal }
);
document.addEventListener(
    'keydown',
    (event) => {
        if (
            event.isTrusted &&
            (event.key === 'Enter' || event.key === 'Escape')
        )
            trusted[event.key]++;
    },
    { signal: fixtureEvents.signal }
);
const networkFailure = () => {
    effects.requests++;
    throw new Error('Unexpected runtime request from readonly Grid');
};
window.fetch = async () => networkFailure();
XMLHttpRequest.prototype.open = networkFailure;
const assert = (condition, reason) => {
    if (!condition) throw new Error(reason);
};
const equals = (actual, expected, reason) =>
    assert(JSON.stringify(actual) === JSON.stringify(expected), reason);
const renderers = {
    renderSingleLineTextField: ({ value }) => h('span', null, value),
    renderPercentField(field) {
        assert(
            field.context === 'portal-detail' &&
                field.physicalKind === 'percent' &&
                !field.computed &&
                field.capability.type === 'readonly' &&
                field.field.config.options.precision === 2,
            'Expected an admitted physical readonly Percent slot'
        );
        const values = delivered.get(field.fieldId) ?? new Set();
        values.add(field.value);
        delivered.set(field.fieldId, values);
        // Native Grid blanks nullish cells before calling the numeric leaf.
        return field.value == null
            ? null
            : h(PercentField, {
                  mode: 'controlled',
                  field,
                  options: { presentation: 'display', showLabel: false },
              });
    },
};
const receipt = {
    react: version,
    initial: null,
    republished: null,
    disposed: null,
    error: null,
};
let originalNodes;
const publishReceipt = () => {
    report.textContent = JSON.stringify(receipt);
};
function run(check) {
    try {
        check();
    } catch (error) {
        receipt.error = error instanceof Error ? error.message : String(error);
        throw error;
    } finally {
        publishReceipt();
    }
}
const render = () =>
    flushSync(() =>
        root.render(
            h(
                StrictMode,
                null,
                h(
                    'form',
                    {
                        'aria-label': 'Readonly Percent showcase',
                        onChange: () => effects.writes++,
                        onInput: () => effects.input++,
                        onSubmit: (event) => {
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
function verifyInert() {
    equals(
        effects,
        { intent: 0, input: 0, writes: 0, submits: 0, requests: 0 },
        'Readonly effects'
    );
    assert(!getSelection()?.toString(), 'Unexpected text selection');
    assert(
        !rootNode.querySelector('[aria-selected="true"]'),
        'Unexpected row selection'
    );
}
function capture(expected, checkIdentity) {
    const headers = [...rootNode.querySelectorAll('thead th[data-field-id]')];
    equals(
        headers.map((node) => [node.dataset.fieldId, node.innerText.trim()]),
        columns.map(([id, name]) => [id, name]),
        'Named column headers'
    );
    const rows = [...rootNode.querySelectorAll('tbody tr[data-record-id]')];
    const nodes = rows.flatMap((row) => [row, ...row.querySelectorAll('td')]);
    const stableNodes = checkIdentity
        ? nodes.filter((node, index) => node === originalNodes[index]).length
        : null;
    if (checkIdentity)
        assert(stableNodes === nodes.length, 'Rows or cells remounted');
    originalNodes ??= nodes;
    equals(
        rows.map((node) => node.dataset.recordId),
        expected.map(({ id }) => `rec${id}`),
        'Stable row IDs'
    );
    const cells = rows.map((row, index) => {
        const { id, label, fill } = expected[index];
        const entries = [...row.querySelectorAll('td[data-field-id]')];
        assert(
            entries.every((entry) => entry.checkVisibility()),
            `Hidden cells for ${id}`
        );
        assert(
            !row.querySelector(
                'input, button, textarea, select, [role="button"], [contenteditable="true"]'
            ),
            `Editable or Open/Clear control for ${id}`
        );
        equals(
            entries.map((entry) => [
                entry.dataset.fieldId,
                entry.innerText.trim(),
            ]),
            [
                ['fldName', id],
                ['fldProgress', label],
                ['fldPlain', label],
                ['fldNote', `Keep ${id}`],
            ],
            `Cell IDs, localized text and neighbor for ${id}`
        );
        const progress = entries[1].querySelector(
            '.mx-sdk-localized-numeric-fill'
        );
        const track = entries[1].querySelector(
            '.mx-sdk-localized-numeric-track'
        );
        assert(
            !entries[2].querySelector('.mx-sdk-localized-numeric-fill'),
            `Plain Percent fill for ${id}`
        );
        const width = progress ? Number.parseFloat(progress.style.width) : null;
        if (fill === null) {
            assert(width === null, `Blank field fill for ${id}`);
        } else {
            assert(
                progress && track && Math.abs(width - fill) < 1e-4,
                `Raw-fraction fill for ${id}`
            );
            const trackWidth = track.getBoundingClientRect().width;
            const painted = progress.getBoundingClientRect().width;
            assert(
                trackWidth > 0 &&
                    Math.abs(painted - (trackWidth * fill) / 100) < 1,
                `Measured fill geometry for ${id}`
            );
        }
        return {
            id: row.dataset.recordId,
            progress: label,
            plain: label,
            fill: width,
            neighbor: entries[3].innerText.trim(),
        };
    });
    for (const id of ['fldProgress', 'fldPlain']) {
        assert(
            delivered.get(id)?.has(null) &&
                delivered.get(id)?.has(undefined) &&
                delivered.get(id)?.has(0),
            'Slot distinguishes zero, explicit null and omitted'
        );
        assert(
            Object.hasOwn(initialRecords[5].fields, id) &&
                !Object.hasOwn(initialRecords[6].fields, id),
            'Host blank records'
        );
        assert(
            initialRecords[1].fields[id] === 0.426175,
            'Frozen original record changed'
        );
    }
    verifyInert();
    return {
        revision: scope.getSnapshot().revision,
        stableNodes,
        headers: columns.map(([, name]) => name),
        cells,
        effects: { ...effects },
    };
}
run(() => {
    render();
    assert(gridSubscriptions > 0, 'Grid did not subscribe to the scope');
    assert(listeners.size === 1, 'Expected one owned host subscription');
    receipt.initial = capture(cases, false);
});
republish.addEventListener('click', () =>
    run(() => {
        equals(
            trusted,
            { progressCellClick: 1, Enter: 1, Escape: 1 },
            'Expected trusted click and keyboard activation before republication'
        );
        const adjusted = {
            ...cases[1],
            value: 0.73126,
            label: '73,13%',
            fill: 73.126,
        };
        records = Object.freeze(
            initialRecords.map((record, index) =>
                index === 1
                    ? freezeRecord({
                          id: record.id,
                          fields: {
                              ...record.fields,
                              fldProgress: adjusted.value,
                              fldPlain: adjusted.value,
                          },
                      })
                    : record
            )
        );
        stamp = {};
        flushSync(() => {
            for (const listener of listeners) listener();
        });
        receipt.republished = capture(
            [cases[0], adjusted, ...cases.slice(2)],
            true
        );
        assert(
            receipt.republished.revision > receipt.initial.revision,
            'Scope revision did not advance'
        );
        receipt.republished.trusted = { ...trusted };
    })
);
dispose.addEventListener('click', () =>
    run(() => {
        const mountedGridSubscriptions = gridSubscriptions;
        flushSync(() => root.unmount());
        const hostSubscriptionsAfterUnmount = listeners.size;
        scope.destroy();
        fixtureEvents.abort();
        republish.disabled = true;
        dispose.disabled = true;
        assert(gridSubscriptions === 0, 'A Grid subscription survived unmount');
        assert(
            hostSubscriptionsAfterUnmount === 1 && listeners.size === 0,
            'The owned scope did not detach its host subscription on destruction'
        );
        assert(rootNode.childElementCount === 0, 'Grid survived unmount');
        verifyInert();
        receipt.disposed = {
            mountedGridSubscriptions,
            gridSubscriptions,
            hostSubscriptionsAfterUnmount,
            hostSubscriptions: listeners.size,
            renderedChildren: rootNode.childElementCount,
            effects: { ...effects },
        };
    })
);
