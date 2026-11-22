import { createElement as h, useLayoutEffect, useState, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
    CompleteReadOnlyTextField,
    CSVExportButton,
    ReadonlyPortalGrid,
} from '@miniextensions/sdk/react';
import { projectCSVExport } from '@miniextensions/sdk/portals';
import '@miniextensions/sdk/react/complete-readonly-text.css';
import '@miniextensions/sdk/react/csv-export.css';
import '@miniextensions/sdk/react/readonly-portal-grid.css';

const text = { type: 'singleLineText', options: null };
const fields = [
    { id: 'fldCompany', name: '__proto__', title: 'Company', config: text },
    {
        id: 'fldRegion',
        name: 'Region descriptor',
        title: 'Region',
        config: text,
    },
    {
        id: 'fldNote',
        name: 'Internal descriptor',
        title: 'Internal note',
        config: text,
    },
];
const offeredRecords = new Map([
    ['recAmber', ['Amber', 'West', 'PRIVATE-AMBER']],
    ['recOtherScope', ['OUT-OF-SCOPE', 'Elsewhere', 'PRIVATE-OTHER']],
    ['recZoe', ['Zoë, "Z"', 'Blue\nGreen', 'PRIVATE-ZOE']],
]);
const acceptedRecords = ['recZoe', 'recAmber'].map((recordId) => ({
    id: recordId,
    values: Object.fromEntries(
        fields.map(({ id }, index) => [id, offeredRecords.get(recordId)[index]])
    ),
}));

const labels = {
    download: 'Download CSV',
    warning: 'Only displayed records are included.',
    continue: 'Continue',
    cancel: 'Cancel',
    help: 'Export help',
    pending: 'Preparing',
    errors: {
        denied: 'Export denied',
        failed: 'Export failed',
        loading: 'Rows loading',
        schema: 'Fields changed',
        unexpected: 'CSV creation failed',
    },
};
const effects = {
    preferences: [],
    hideGestures: [],
    exportGestures: [],
    exportsFailed: [],
    inputs: 0,
    submits: 0,
    blockedConnections: 0,
};
const onPolicyViolation = (event) => {
    if (event.effectiveDirective === 'connect-src')
        effects.blockedConnections++;
};
document.addEventListener('securitypolicyviolation', onPolicyViolation);
const gridColumns = fields.map(({ id, title }) => ({
    fieldId: id,
    title,
    icon: 'text',
}));

function Fixture() {
    const [snapshot, commit] = useState({
        records: acceptedRecords,
        hidden: {},
        borrowedRecords: false,
    });
    const primary = gridColumns[0].fieldId;
    const gridRows = snapshot.records.map(({ id, values }) => ({
        recordId: id,
        label: values[primary],
        cells: fields.map(({ id }) => ({
            fieldId: id,
            node: h(CompleteReadOnlyTextField, {
                value: values[id],
                language: 'en',
            }),
        })),
    }));
    const input = {
        admission: {
            cohort: 'portal-grid',
            allowed: true,
            borrowedRecords: snapshot.borrowedRecords,
        },
        columns: fields.map(({ id, name, title }) => ({
            key: name,
            title,
            isHidden: id !== primary && snapshot.hidden[id] === true,
        })),
        rows: snapshot.records.map(({ values }) => ({
            status: 'loaded',
            viewType: 'list',
            fields: fields.map(({ id, name, config }) => ({
                field: { id, name, config },
                value: values[id],
            })),
        })),
    };
    useLayoutEffect(() => {
        window.readGridCSVFixture = () => {
            const projection = projectCSVExport(input);
            return {
                react: version,
                snapshot,
                visibleKeys: input.columns
                    .filter(({ isHidden }) => !isHidden)
                    .map(({ key }) => key),
                projection: {
                    status: projection.status,
                    reason: projection.failure?.reason ?? null,
                    count:
                        projection.failure?.recordCount ??
                        projection.document?.rows.length,
                    hasDocument: 'document' in projection,
                },
                effects,
            };
        };
        document.querySelector('#fixture-receipt').textContent = JSON.stringify(
            window.readGridCSVFixture()
        );
        return () => {
            delete window.readGridCSVFixture;
        };
    }, [input, snapshot]);

    return h(
        'form',
        {
            onInput() {
                effects.inputs++;
            },
            onSubmit(event) {
                event.preventDefault();
                effects.submits++;
            },
            onClickCapture(event) {
                if (event.target.closest('[role="switch"]'))
                    effects.hideGestures.push(event.isTrusted);
                if (event.target.closest('.mx-sdk-csv-export__trigger'))
                    effects.exportGestures.push(event.isTrusted);
            },
        },
        h(ReadonlyPortalGrid, {
            columns: gridColumns,
            rows: gridRows,
            primaryFieldId: primary,
            revision: 1,
            preferenceScopeKey: 'csv-download-fixture',
            ready: true,
            isCurrent: () => true,
            hiddenColumns: snapshot.hidden,
            columnWidths: {},
            allowHideColumns: true,
            onFieldHiddenChange(change) {
                effects.preferences.push(change);
                commit((current) => ({
                    ...current,
                    hidden: {
                        ...current.hidden,
                        [change.fieldId]: change.isHidden,
                    },
                }));
            },
        }),
        !snapshot.borrowedRecords &&
            h(CSVExportButton, {
                request: { input, filename: 'Synthetic Grid.csv' },
                labels,
                onFailure(failure) {
                    effects.exportsFailed.push(failure.reason);
                },
            }),
        h(
            'button',
            {
                type: 'button',
                onClick: () =>
                    commit((current) => ({
                        ...current,
                        borrowedRecords: true,
                    })),
            },
            'Show in borrowed scope'
        )
    );
}

const root = createRoot(document.querySelector('#root'));
window.unmountGridCSVFixture = () => {
    flushSync(() => root.unmount());
    document.removeEventListener('securitypolicyviolation', onPolicyViolation);
    document.querySelector('#finish-fixture').disabled = true;
    document.querySelector('#cleanup-receipt').textContent = JSON.stringify({
        gridRemoved: document.querySelector('#root').childNodes.length === 0,
        receiptReleased: !('readGridCSVFixture' in window),
        effects,
    });
    delete window.unmountGridCSVFixture;
};
document
    .querySelector('#finish-fixture')
    .addEventListener('click', window.unmountGridCSVFixture, { once: true });
flushSync(() => root.render(h(Fixture)));
