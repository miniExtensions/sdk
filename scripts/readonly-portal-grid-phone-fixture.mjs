import { StrictMode, createElement as h, version } from 'react';
import { createRoot } from 'react-dom/client';
import {
    CompleteReadOnlyPhoneNumberField,
    CompleteReadOnlyTextField,
    ReadonlyPortalRecords,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-phone.css';
import '@miniextensions/sdk/react/readonly-portal-grid.css';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';

const fields = [
    ['fldTitle', 'Name', 'singleLineText'],
    ['fldPhone', 'Phone', 'phoneNumber'],
    ['fldCleared', 'Cleared phone', 'phoneNumber'],
    ['fldOmitted', 'Omitted phone', 'phoneNumber'],
].map(([id, name, type], index) => ({
    id,
    name,
    config: { type, options: null },
    isPrimaryField: index === 0,
    isComputed: false,
    description: null,
}));
const titles = { recFirst: 'First contact', recSecond: 'Second contact' };
const root = createRoot(document.querySelector('#root'));
const actions = { opens: [], edits: 0, writes: 0, submits: 0, hostClicks: 0 };
const calls = [];
const listeners = new Set();
let stamp;
let projection;

function publish(first) {
    stamp = {};
    projection = {
        portalFieldId: 'fldPhoneGrid',
        linkedTableId: 'tblContacts',
        table: { airtableFields: fields },
        detailProjection: 'present',
        detailFields: fields.map(({ id, name }) => ({
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
        })),
        records: Object.freeze(
            [
                ['recFirst', first],
                ['recSecond', '(202) 555-0117 ext. 34'],
            ].map(([id, phone]) =>
                Object.freeze({
                    id,
                    fields: Object.freeze({
                        fldTitle: titles[id],
                        fldPhone: phone,
                        fldCleared: null,
                    }),
                })
            )
        ),
    };
    for (const listener of listeners) listener();
}

publish('+1 (202) 555-0103');
const scope = createBorrowedPortalRenderScope({
    capture: () => ({ stamp, projection }),
    isCurrent: (observed) => observed === stamp,
    subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    invokeIfCurrent(expected, { action, recordId }, current) {
        if (expected !== stamp || !current()) return false;
        if (action === 'open-row') actions.opens.push(recordId);
        else actions.edits++;
        return true;
    },
});
const write = () => actions.writes++;
const grid = {
    ready: true,
    preferenceScopeKey: 'phone-grid',
    primaryFieldId: 'fldTitle',
    hiddenColumns: {},
    columnWidths: { fldTitle: 160, fldPhone: 260 },
    recordLabel: (id) => titles[id],
    onFieldHiddenChange: write,
    onColumnWidthCommit: write,
};
const renderers = {
    renderSingleLineTextField: ({ value }) =>
        h(CompleteReadOnlyTextField, { value, language: 'en' }),
    renderPhoneNumberField(field) {
        if (
            field.physicalKind !== 'phoneNumber' ||
            field.presentation.type !== 'physical' ||
            field.capability.type !== 'readonly'
        )
            throw new Error('Expected a physical read-only Phone field');
        // As in the native Grid, blank cells do not mount the presentation leaf.
        return field.value == null
            ? h('span')
            : h(CompleteReadOnlyPhoneNumberField, {
                  value: field.value,
                  emptyLabel: 'No phone number',
              });
    },
};

function render() {
    const snapshot = scope.getSnapshot();
    const byRecordId = new Map(
        snapshot.rows.map(({ recordId }) => [
            recordId,
            {
                revision: snapshot.revision,
                activate(current) {
                    if (current()) void snapshot.actions.openRow(recordId);
                },
            },
        ])
    );
    root.render(
        h(
            StrictMode,
            null,
            h(
                'form',
                {
                    onClick: () => actions.hostClicks++,
                    onInput: write,
                    onChange: write,
                    onSubmit(event) {
                        event.preventDefault();
                        actions.submits++;
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
        )
    );
}

function observePhone(event) {
    const link = event.target.closest?.('td[data-field-id="fldPhone"] a');
    if (!link || !link.getAttribute('href').startsWith('tel:')) return;
    event.preventDefault();
    calls.push({
        href: link.getAttribute('href'),
        record: link.closest('tr').dataset.recordId,
        detail: event.detail,
        trusted: event.isTrusted,
        prevented: event.defaultPrevented,
    });
}
document.addEventListener('click', observePhone, true);
render();
window.phoneGrid = {
    observe: () => ({
        react: version,
        revision: scope.getSnapshot().revision,
        calls,
        actions,
        records: projection.records,
    }),
    renew(value) {
        publish(value);
        render();
    },
    dispose() {
        document.removeEventListener('click', observePhone, true);
        root.unmount();
        const afterUnmount = listeners.size;
        scope.destroy();
        return {
            afterUnmount,
            afterDestroy: listeners.size,
            rows: document.querySelectorAll('tbody tr').length,
        };
    },
};
