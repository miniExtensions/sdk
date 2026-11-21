import assert from 'node:assert/strict';

export const readonlyPortalGridNumberEntry = String.raw`
import { StrictMode, createElement as h, version } from 'react';
import { NumberField, ReadonlyPortalRecords } from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/localized-numeric.css';

const fields = [
    { id: 'fldTitle', name: 'Name', isPrimaryField: true, config: { type: 'singleLineText', options: null } },
    { id: 'fldAmount1', name: 'One place', config: { type: 'number', options: { precision: 1 } } },
    { id: 'fldAmount3', name: 'Three places', config: { type: 'number', options: { precision: 3 } } },
    { id: 'fldNeighbor', name: 'Neighbor', config: { type: 'singleLineText', options: null } },
].map(field => ({ isComputed: false, isPrimaryField: false, description: null, ...field }));
const records = Object.freeze([
    { id: 'recNegative', fields: { fldTitle: 'Negative', fldAmount1: -12.3456, fldAmount3: -12.3456, fldNeighbor: 'Keep negative' } },
    { id: 'recZero', fields: { fldTitle: 'Zero', fldAmount1: 0, fldAmount3: 0, fldNeighbor: 'Keep zero' } },
    { id: 'recNull', fields: { fldTitle: 'Null', fldAmount1: null, fldAmount3: null, fldNeighbor: 'Keep null' } },
    { id: 'recOmitted', fields: { fldTitle: 'Omitted', fldNeighbor: 'Keep omitted' } },
].map(({ id, fields }) => Object.freeze({ id, fields: Object.freeze(fields) })));

export function mountNumberGrid(root) {
    const grid = {
        ready: true, preferenceScopeKey: 'number-only-grid', primaryFieldId: 'fldTitle',
        hiddenColumns: {}, columnWidths: {},
    };
    const actions = { writes: 0, submits: 0 };
    const listeners = new Set();
    let stamp = {};
    let projection = {
        portalFieldId: 'fldChildren',
        linkedTableId: 'tblChildren',
        records,
        table: { airtableFields: fields },
        detailProjection: 'present',
        detailFields: fields.map(field => ({
            fieldId: field.id, fieldName: field.name, isHidden: false,
            fieldIsInEditingChildForm: false, childFormField: null,
            miniExtConfig: { title: field.name, conditionalFields: { logicalOperator: 'and', conditions: [] } },
        })),
    };
    const scope = createBorrowedPortalRenderScope({
        capture: () => ({ stamp, projection }),
        isCurrent: expected => expected === stamp,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        invokeIfCurrent() { actions.writes++; return false; },
    });
    const slots = {
        renderSingleLineTextField(field) { return h('span', null, field.value); },
        renderNumberField(field) {
            if (field.capability.type !== 'readonly' || field.physicalKind !== 'number' || field.computed)
                throw new Error('Expected an accepted physical read-only Number field');
            // Ordinary native Grid leaves null and omitted values blank before formatting.
            return field.value == null ? h('span') : h(NumberField, {
                mode: 'controlled',
                field,
                options: { presentation: 'display', showLabel: false },
            });
        },
    };
    let originalNodes;
    const render = () => root.render(h(StrictMode, null, h('form', {
        id: 'number-only-grid',
        'data-revision': scope.getSnapshot().revision,
        onChange() { actions.writes++; },
        onSubmit(event) { event.preventDefault(); actions.submits++; },
    }, h(ReadonlyPortalRecords, { scope, layout: 'grid', grid, renderers: slots }))));
    window.__numberGrid = {
        snapshot() {
            const form = document.querySelector('#number-only-grid');
            const gridRows = [...form.querySelectorAll('tbody tr')];
            const nodes = gridRows.flatMap(row => [row, ...row.querySelectorAll('td')]);
            const stableNodes = originalNodes
                ? nodes.filter((node, index) => node === originalNodes[index]).length
                : null;
            originalNodes ??= nodes;
            return {
                react: version, revision: Number(form.dataset.revision),
                stableNodes, records, actions,
                cells: gridRows.map(row => [
                    row.dataset.recordId,
                    [...row.querySelectorAll('td')].map(cell => ({
                        id: cell.dataset.fieldId, text: cell.innerText.trim(),
                        primary: cell.dataset.primary === 'true',
                        visible: cell.checkVisibility(),
                        numericDisplay: cell.querySelector('.mx-sdk-localized-numeric-display') !== null,
                        decoration: cell.querySelector('svg, [aria-label], [title]') !== null,
                        controls: cell.querySelector('button, input, textarea, select, [contenteditable="true"]') !== null,
                    })),
                ]),
            };
        },
        rerender() {
            stamp = {};
            projection = { ...projection, records: [...records] };
            for (const listener of listeners) listener();
            render();
        },
    };
    render();
}
`;

// Captured from ordinary native Cell and ReadOnlyField at cc700cfc0d0dd211bca762b798404ca661756107,
// using the frozen native SDK formatter at e93ac6d052d394ee7cf0c38c9a57aa7615b98bc6.
const nativeCells = [
    ['recNegative', 'Negative', '-12.3', '-12.346', 'Keep negative'],
    ['recZero', 'Zero', '0.0', '0.000', 'Keep zero'],
    ['recNull', 'Null', '', '', 'Keep null'],
    ['recOmitted', 'Omitted', '', '', 'Keep omitted'],
];

export async function checkReadonlyPortalGridNumberBrowser({ page, evidence }) {
    const fixture = '/readonly-portal-grid.html?fixture=number-only';
    const origin = new URL(page.url()).origin;
    const allowed = new Set([
        fixture,
        '/readonly-portal-grid.js',
        '/readonly-portal-grid.css',
        '/favicon.ico',
    ]);
    const numberPage = await page.context().newPage();
    const proof = {
        nativeReference: {
            monorepo: 'cc700cfc0d0dd211bca762b798404ca661756107',
            sdk: 'e93ac6d052d394ee7cf0c38c9a57aa7615b98bc6',
        },
        providerRequests: [],
        pageErrors: [],
    };
    evidence.numberOnly = proof;
    try {
        numberPage.on('pageerror', (error) =>
            proof.pageErrors.push(error.message)
        );
        await numberPage.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                url.origin === origin &&
                request.method() === 'GET' &&
                !['fetch', 'xhr'].includes(request.resourceType()) &&
                allowed.has(url.pathname + url.search)
            )
                return route.continue();
            proof.providerRequests.push({
                method: request.method(),
                path: url.pathname,
            });
            return route.abort();
        });
        await numberPage.goto(origin + fixture, { waitUntil: 'networkidle' });
        await numberPage
            .locator('#number-only-grid')
            .getByRole('table')
            .waitFor();
        const snapshot = () =>
            numberPage.evaluate(() => window.__numberGrid.snapshot());
        proof.initial = await snapshot();
        await numberPage.evaluate(() => window.__numberGrid.rerender());
        await numberPage.waitForFunction(
            (revision) =>
                Number(
                    document.querySelector('#number-only-grid').dataset.revision
                ) > revision,
            proof.initial.revision
        );
        await numberPage.waitForLoadState('networkidle');
        proof.rerendered = await snapshot();
        assert.equal(proof.initial.react, evidence.react);
        assert(proof.rerendered.revision > proof.initial.revision);
        assert.equal(proof.rerendered.stableNodes, 20);
        assert.deepEqual(proof.rerendered.cells, proof.initial.cells);
        assert.deepEqual(proof.rerendered.records, proof.initial.records);
        for (const { cells, records, actions } of [
            proof.initial,
            proof.rerendered,
        ]) {
            assert.deepEqual(
                cells,
                nativeCells.map(([recordId, ...values]) => [
                    recordId,
                    ['fldTitle', 'fldAmount1', 'fldAmount3', 'fldNeighbor'].map(
                        (id, index) => ({
                            id,
                            text: values[index],
                            primary: index === 0,
                            visible: true,
                            numericDisplay:
                                (index === 1 || index === 2) &&
                                values[index] !== '',
                            decoration: false,
                            controls: false,
                        })
                    ),
                ])
            );
            for (const id of ['fldAmount1', 'fldAmount3']) {
                assert.equal(records[0].fields[id], -12.3456);
                assert.equal(records[1].fields[id], 0);
                assert(Object.hasOwn(records[2].fields, id));
                assert.equal(records[2].fields[id], null);
                assert(!Object.hasOwn(records[3].fields, id));
            }
            assert.deepEqual(actions, { writes: 0, submits: 0 });
        }
        assert.deepEqual(proof.providerRequests, []);
        assert.deepEqual(proof.pageErrors, []);
        proof.status = 'passed';
    } finally {
        await numberPage.close();
    }
}
