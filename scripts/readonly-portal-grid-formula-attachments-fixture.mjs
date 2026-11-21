import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
    AirtableGrid,
    FormulaField,
    projectComputedFormulaDisplay,
    ReadonlyPortalGrid,
    ReadOnlyURLGallery,
} from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';

const columns = [
    ['fldName', 'Name', 'singleLineText'],
    ['fldNotes', 'Notes', 'singleLineText'],
    ['fldFormula', 'Formula attachments', 'formula'],
    ['fldTail', 'Tail', 'singleLineText'],
];
const fieldSchema = columns.map(([id, name, type]) => ({
    id,
    name,
    description: null,
    isComputed: type === 'formula',
    isPrimaryField: id === 'fldName',
    config: {
        type,
        options:
            type === 'formula'
                ? {
                      isValid: true,
                      result: { type: 'singleLineText', options: null },
                  }
                : null,
    },
}));
const entries = [
    { url: location.origin + '/first.png' },
    { url: location.origin + '/second.jpg' },
];
const formulaOutput = entries.map(({ url }) => url).join(' ');
const gallery = {
    entries,
    labels: { attachments: 'Formula attachment preview' },
};
const records = Object.freeze([
    Object.freeze({
        id: 'recPreview',
        fields: Object.freeze({
            fldName: 'Preview record',
            fldNotes: 'Synthetic notes',
            fldFormula: formulaOutput,
            fldTail: 'Tail value',
        }),
    }),
    Object.freeze({
        id: 'recNeighbor',
        fields: Object.freeze({
            fldName: 'Keep neighbor',
            fldNotes: 'Neighbor notes',
            fldTail: 'Neighbor tail',
        }),
    }),
]);
const before = JSON.stringify(records);
const effects = { opens: 0, writes: 0, submits: 0, runtimeRequests: 0 };
const trusted = [];
const projection = {
    portalFieldId: 'fldPortal',
    linkedTableId: 'tblGrid',
    records,
    table: { airtableFields: fieldSchema },
    detailProjection: 'present',
    detailFields: fieldSchema.map((field) => ({
        fieldId: field.id,
        fieldName: field.name,
        isHidden: false,
        fieldIsInEditingChildForm: false,
        childFormField: null,
        miniExtConfig: {
            title: field.name,
            ...(field.config.type === 'formula'
                ? { renderFormulaAsAttachment: true }
                : {}),
        },
    })),
};
const stamp = {};
const scope = createBorrowedPortalRenderScope({
    capture: () => ({ stamp, projection }),
    isCurrent: (expected) => expected === stamp,
    subscribe: () => () => {},
    invokeIfCurrent() {
        effects.writes++;
        return false;
    },
});
const deliveries = {};
const renderers = {
    renderSingleLineTextField: ({ value }) => h('span', null, value),
    renderFormulaField(field) {
        if (field.value !== formulaOutput) return null;
        deliveries[field.fieldId] = {
            context: field.context,
            physicalKind: field.physicalKind,
            computed: field.computed,
            capability: field.capability.type,
            type: field.field.config.type,
        };
        const projected = projectComputedFormulaDisplay({
            language: 'en',
            isValid: field.field.config.options.isValid,
            resultType: field.field.config.options.result.type,
            value: field.value,
            formattedValue: field.value,
            config: field.displayConfig,
            gallery,
            isInGrid: true,
        });
        if (projected.status !== 'ready')
            throw new Error('Expected readonly Formula attachment projection');
        return h(FormulaField, projected.display);
    },
};

function GridFixture() {
    return h(AirtableGrid, { scope, renderers }, (state) =>
        h(ReadonlyPortalGrid, {
            columns: state.columns,
            rows: state.rows.map((row) => ({
                ...row,
                label: records.find(({ id }) => id === row.recordId).fields
                    .fldName,
            })),
            primaryFieldId: 'fldName',
            revision: state.revision,
            preferenceScopeKey: 'formula-attachments-grid',
            ready: true,
            isCurrent: () => state.revision === scope.getSnapshot().revision,
            hiddenColumns: {},
            columnWidths: {
                fldName: 180,
                fldNotes: 410,
                fldFormula: 260,
                fldTail: 340,
            },
            rowHeight: 'extra-tall',
            onOpenRecord() {
                effects.opens++;
            },
            onColumnWidthCommit() {
                effects.writes++;
            },
        })
    );
}

const isStandalone = new URLSearchParams(location.search).has('standalone');
createRoot(document.getElementById('root')).render(
    h(
        StrictMode,
        null,
        h(
            'form',
            {
                onChange: () => effects.writes++,
                onSubmit(event) {
                    event.preventDefault();
                    effects.submits++;
                },
            },
            h(
                'button',
                { type: 'button', id: 'before-gallery' },
                'Before gallery'
            ),
            isStandalone ? h(ReadOnlyURLGallery, gallery) : h(GridFixture)
        )
    )
);
document.addEventListener(
    'keydown',
    (event) => {
        if (
            event.key !== 'Enter' &&
            event.key !== 'Escape' &&
            event.key !== 'Tab'
        )
            return;
        trusted.push({
            key: event.key,
            trusted: event.isTrusted,
            action:
                event.target.getAttribute('aria-label') ??
                event.target.textContent.trim(),
        });
    },
    true
);
const unexpectedRequest = () => {
    effects.runtimeRequests++;
    throw new Error('Unexpected Formula gallery runtime request');
};
window.fetch = async () => unexpectedRequest();
XMLHttpRequest.prototype.open = unexpectedRequest;
window.readFormulaGallery = () => ({
    effects,
    trusted,
    deliveries,
    recordsUnchanged: before === JSON.stringify(records),
});
