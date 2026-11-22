import { getReadableStringFromAirtableValue } from '@miniextensions/sdk/formulas';
import {
    CompleteReadOnlyTextField,
    MultipleCollaboratorsField,
    ReadonlyPortalRecords,
} from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';
import { createElement as h, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const zeta = { id: 'usrZeta', name: 'Zeta Person', email: 'z@example.invalid' };
const fallback = {
    id: 'usrEmail',
    name: '',
    email: 'fallback@example.invalid',
};
const alpha = {
    id: 'usrAlpha',
    name: 'Alpha Person',
    email: 'a@example.invalid',
};
const original = [
    ['recTeam', 'Team', [zeta, fallback, alpha, zeta]],
    ['recNull', 'Null', null],
    ['recOmitted', 'Omitted', undefined],
    ['recEmpty', 'Empty array', []],
    ['recEmail', 'Email only', [fallback]],
];
const fields = [
    ['fldName', 'Name', 'singleLineText'],
    ['fldTeam', 'Collaborators', 'multipleCollaborators'],
    ['fldNote', 'Note', 'singleLineText'],
].map(([id, name, type]) => ({
    id,
    name,
    description: '',
    isPrimaryField: id === 'fldName',
    isComputed: false,
    config: {
        type,
        options: type === 'multipleCollaborators' ? { choices: [] } : null,
    },
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
const recordsFrom = (rows) =>
    rows.map(([id, title, team]) => ({
        id,
        fields: {
            fldName: title,
            fldNote: `Keep ${title}`,
            ...(team === undefined ? {} : { fldTeam: team }),
        },
    }));
let records = recordsFrom(original);
let stamp = {};
const listeners = new Set();
const effects = {
    opens: [],
    currentnessChecks: 0,
    requests: 0,
    writes: 0,
    submits: 0,
};
const originalFetch = window.fetch;
const originalXhrOpen = XMLHttpRequest.prototype.open;
function rejectRequest() {
    effects.requests++;
    throw new Error('Unexpected provider request');
}
window.fetch = async () => rejectRequest();
XMLHttpRequest.prototype.open = rejectRequest;
const scope = createBorrowedPortalRenderScope({
    capture: () => ({
        stamp,
        projection: {
            portalFieldId: 'fldPortal',
            linkedTableId: 'tblTeams',
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
    invokeIfCurrent(expected, action, isCurrent) {
        if (expected !== stamp || !isCurrent()) throw new Error('Stale Open');
        effects.opens.push(action);
        return true;
    },
});
const owner = {
    token: Symbol('readonly-grid-assignment'),
    isCurrent() {
        effects.currentnessChecks++;
        throw new Error('Readonly badge requested write authority');
    },
};
const grid = {
    ready: true,
    preferenceScopeKey: 'readonly-collaborator-grid',
    primaryFieldId: 'fldName',
    columnWidths: { fldTeam: '600' },
    hiddenColumns: {},
    recordLabel: (id) =>
        original.find(([recordId]) => recordId === id)?.[1] ?? null,
};
const renderers = {
    renderSingleLineTextField: ({ value }) =>
        h(CompleteReadOnlyTextField, { value, language: 'en' }),
    renderMultipleCollaboratorsField(field) {
        if (
            field.fieldId !== 'fldTeam' ||
            field.context !== 'portal-detail' ||
            field.physicalKind !== 'multipleCollaborators' ||
            field.computed ||
            field.capability.type !== 'readonly'
        )
            throw new Error(
                'Expected the physical readonly collaborator detail'
            );
        // The ordinary native Grid gates display on its formatter before ReadOnlyField.
        if (
            field.value == null ||
            getReadableStringFromAirtableValue({
                value: field.value,
                airtableFieldConfig: field.field.config,
                fieldName: field.field.name,
                source: {
                    type: 'airtableMock',
                    linkedTableStates: {},
                    dateParsing: 'local',
                },
            }) === ''
        )
            return h('span', { className: 'read-only-text' });
        return h(MultipleCollaboratorsField, {
            mode: 'controlled',
            value: field.value,
            choices: [],
            owner,
            title: field.title,
            showLabel: false,
            readOnly: true,
            onValueChange() {
                effects.writes++;
                throw new Error('Readonly badge proposed a write');
            },
        });
    },
};
const container = document.getElementById('grid');
const root = createRoot(container);
function render() {
    const snapshot = scope.getSnapshot();
    const byRecordId = new Map(
        snapshot.rows.map(({ recordId }) => [
            recordId,
            {
                revision: snapshot.revision,
                activate(isCurrent) {
                    if (isCurrent()) void snapshot.actions.openRow(recordId);
                },
            },
        ])
    );
    root.render(
        h(
            'form',
            {
                onInput: () => effects.writes++,
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
                openActions: { scope, byRecordId },
            })
        )
    );
}
flushSync(render);
const nodes = new Map(
    [...container.querySelectorAll('tr[data-record-id]')].map((row) => [
        row.dataset.recordId,
        [row, ...row.querySelectorAll('td[data-field-id]')],
    ])
);
window.collaboratorGrid = {
    observe() {
        let retained = 0;
        const rows = [...container.querySelectorAll('tr[data-record-id]')].map(
            (row) => {
                const id = row.dataset.recordId;
                const cells = [...row.querySelectorAll('td[data-field-id]')];
                const team = cells.find(
                    (cell) => cell.dataset.fieldId === 'fldTeam'
                );
                retained += [row, ...cells].filter(
                    (node, index) => nodes.get(id)?.[index] === node
                ).length;
                return {
                    id,
                    fields: cells.map((cell) => cell.dataset.fieldId),
                    title: cells[0].textContent.trim(),
                    note: cells[2].textContent.trim(),
                    badges: [
                        ...team.querySelectorAll('.mx-sdk-collaborator-name'),
                    ].map((label) => label.textContent),
                    group:
                        team
                            .querySelector('[role="group"]')
                            ?.getAttribute('aria-label') ?? null,
                    controls: team.querySelectorAll(
                        'a, button, input, select, textarea, [tabindex], [contenteditable]'
                    ).length,
                    blank:
                        team.firstElementChild?.innerHTML ===
                        '<span class="read-only-text"></span>',
                };
            }
        );
        return {
            react: version,
            rows,
            retained,
            effects: structuredClone(effects),
        };
    },
    republish() {
        flushSync(() => {
            stamp = {};
            records = recordsFrom(
                [...original]
                    .reverse()
                    .map((row) =>
                        row[0] === 'recTeam'
                            ? [row[0], row[1], [fallback, zeta, zeta, alpha]]
                            : row
                    )
            );
            for (const listener of [...listeners]) listener();
            render();
        });
    },
    dispose() {
        try {
            flushSync(() => root.unmount());
        } finally {
            scope.destroy();
            window.fetch = originalFetch;
            XMLHttpRequest.prototype.open = originalXhrOpen;
        }
        return {
            listeners: listeners.size,
            children: container.childElementCount,
        };
    },
};
