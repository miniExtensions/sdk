import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const fieldIds = ['fldTitle', 'fldClock', 'fldExact', 'fldNeighbor'];
const fieldNames = ['Name', 'Elapsed minutes', 'Elapsed precisely', 'Neighbor'];
const records = [
    {
        id: 'recMinute',
        fields: {
            fldTitle: 'Minute',
            fldClock: 60,
            fldExact: 60,
            fldNeighbor: 'Keep minute',
        },
    },
    {
        id: 'recNegative',
        fields: {
            fldTitle: 'Negative',
            fldClock: -3723.123,
            fldExact: -3723.123,
            fldNeighbor: 'Keep negative',
        },
    },
    {
        id: 'recZero',
        fields: {
            fldTitle: 'Zero',
            fldClock: 0,
            fldExact: 0,
            fldNeighbor: 'Keep zero',
        },
    },
    {
        id: 'recNull',
        fields: {
            fldTitle: 'Null',
            fldClock: null,
            fldExact: null,
            fldNeighbor: 'Keep null',
        },
    },
    {
        id: 'recOmitted',
        fields: { fldTitle: 'Omitted', fldNeighbor: 'Keep omitted' },
    },
];

// Ordinary native Grid Cell and ReadOnlyField use the frozen SDK formatter for
// nonempty physical Duration values. The Grid handles blanks before the leaf.
const nativeReference = {
    monorepo: '3c0455f33c9b1b20a7063d5d39d90767f2dc9bad',
    sdk: 'e93ac6d052d394ee7cf0c38c9a57aa7615b98bc6',
};
const nativeValues = [
    ['0:01', '1:00.000'],
    ['-1:02', '-1:02:03.123'],
    ['0:00', '0:00.000'],
    ['', ''],
    ['', ''],
];
const zeroActions = { selections: 0, opens: 0, writes: 0, submits: 0 };

export const readonlyPortalGridDurationEntry = String.raw`
import { StrictMode, createElement as h, version } from 'react';
import { CompleteReadOnlyTextField, ReadOnlyDurationField, ReadonlyPortalRecords } from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';

const fieldIds = ${JSON.stringify(fieldIds)};
const fieldNames = ${JSON.stringify(fieldNames)};
const duration = format => ({ type: 'duration', options: { durationFormat: format } });
const text = { type: 'singleLineText', options: null };
const fields = [text, duration('h:mm'), duration('h:mm:ss.SSS'), text].map((config, index) => ({
    id: fieldIds[index], name: fieldNames[index], config, isPrimaryField: index === 0,
    isComputed: false, description: null,
}));
const sourceRecords = ${JSON.stringify(records)};
const copyRecords = () => Object.freeze(sourceRecords.map(record =>
    Object.freeze({ ...record, fields: Object.freeze({ ...record.fields }) })));

export function createDurationGrid() {
    const actions = ${JSON.stringify(zeroActions)};
    const write = () => { actions.writes++; };
    const listeners = new Set();
    const acceptedValues = new Set();
    let stamp = {};
    let projection = {
        portalFieldId: 'fldTimers', linkedTableId: 'tblTimers', records: copyRecords(),
        table: { airtableFields: fields }, detailProjection: 'present',
        detailFields: fields.map(field => ({
            fieldId: field.id, fieldName: field.name, isHidden: false,
            fieldIsInEditingChildForm: false, childFormField: null,
            miniExtConfig: { title: field.name, readOnly: true,
                conditionalFields: { logicalOperator: 'and', conditions: [] } },
        })),
    };
    const scope = createBorrowedPortalRenderScope({
        capture: () => ({ stamp, projection }),
        isCurrent: expected => expected === stamp,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        invokeIfCurrent() { write(); return false; },
    });
    const grid = {
        ready: true, preferenceScopeKey: 'duration-grid', primaryFieldId: 'fldTitle',
        hiddenColumns: {}, columnWidths: {}, onFieldHiddenChange: write, onColumnWidthCommit: write,
    };
    const renderers = {
        renderSingleLineTextField: ({ value }) => h(CompleteReadOnlyTextField, { value, language: 'en' }),
        renderDurationField(field) {
            const metadata = fields.find(candidate => candidate.id === field.fieldId);
            const format = field.field.config.options.durationFormat;
            if (field.capability.type !== 'readonly' || field.physicalKind !== 'duration' ||
                field.computed || metadata?.config.options?.durationFormat !== format)
                throw new Error('Expected an admitted physical read-only Duration field');
            acceptedValues.add(JSON.stringify([field.fieldId, format, field.value, field.value === undefined]));
            return field.value == null ? h('span') : h(ReadOnlyDurationField, {
                value: field.value, format, language: 'en', className: 'read-only-text linkify',
            });
        },
    };
    let originalNodes;
    return {
        render(element) {
            const revision = scope.getSnapshot().revision;
            const byRecordId = new Map(projection.records.map(({ id }) => [id, {
                revision,
                activate() { actions.opens++; },
            }]));
            return h(element, {
                id: 'duration-grid', 'data-revision': revision,
                onChange: write,
                onSelect() { actions.selections++; },
                onSubmit(event) { event.preventDefault(); actions.submits++; },
            }, h(ReadonlyPortalRecords, { scope, layout: 'grid', grid, renderers,
                openActions: { scope, byRecordId },
            }));
        },
        publish() {
            acceptedValues.clear();
            stamp = {};
            projection = { ...projection, records: copyRecords() };
            for (const listener of listeners) listener();
        },
        observe(owner) {
            const headers = [...owner.querySelectorAll('th[data-field-id]')];
            const rows = [...owner.querySelectorAll('tr[data-record-id]')];
            const nodes = rows.flatMap(row => [row, ...row.querySelectorAll('td[data-field-id]')]);
            const stableNodes = originalNodes
                ? nodes.filter((node, index) => node === originalNodes[index]).length
                : null;
            originalNodes ??= nodes;
            return {
                react: version, stableNodes, revision: Number(owner.dataset.revision),
                acceptedValues: [...acceptedValues].sort(), records: projection.records,
                actions: { ...actions }, selected: owner.querySelectorAll('[aria-selected="true"]').length,
                headers: headers.map(header => [header.dataset.fieldId, header.textContent.trim()]),
                cells: rows.map(row => [row.dataset.recordId,
                    [...row.querySelectorAll('td[data-field-id]')].map(cell => ({
                        id: cell.dataset.fieldId, primary: cell.dataset.primary,
                        text: cell.textContent.trim(),
                        // Header controls and bound Open buttons are outside the Duration cells.
                        ...(cell.dataset.fieldId === 'fldClock' || cell.dataset.fieldId === 'fldExact' ? {
                            leaf: cell.querySelector('.mx-sdk-complete-readonly-text') !== null,
                            decoration: cell.querySelector('svg, [aria-label], [title]') !== null,
                            controls: cell.querySelector('input, button, textarea, select, [contenteditable], [role="button"]') !== null,
                        } : {}),
                    })),
                ]),
            };
        },
        destroy() {
            const afterUnmount = listeners.size;
            scope.destroy();
            return { listeners: { afterUnmount, afterDestroy: listeners.size }, actions: { ...actions } };
        },
    };
}

export function mountDurationGrid(root) {
    const fixture = createDurationGrid();
    const render = () => root.render(h(StrictMode, null, fixture.render('form')));
    window.__durationGrid = {
        observe: () => fixture.observe(document.querySelector('#duration-grid')),
        renew() { fixture.publish(); render(); },
        unmount() { root.unmount(); return fixture.destroy(); },
    };
    render();
}
`;

function verifyDurationGrid({ first, second, cleanup }, react) {
    assert.equal(first.stableNodes, null);
    assert.equal(second.stableNodes, records.length * (1 + fieldIds.length));
    assert(second.revision > first.revision);
    assert.deepEqual(cleanup, {
        listeners: { afterUnmount: 1, afterDestroy: 0 },
        actions: zeroActions,
    });
    const expectedSlots = ['fldClock', 'fldExact']
        .flatMap((id, index) =>
            records.map(({ fields }) =>
                JSON.stringify([
                    id,
                    ['h:mm', 'h:mm:ss.SSS'][index],
                    fields[id],
                    !Object.hasOwn(fields, id),
                ])
            )
        )
        .sort();
    const cells = records.map(({ id, fields }, index) => [
        id,
        fieldIds.map((fieldId, column) => ({
            id: fieldId,
            primary: column === 0 ? 'true' : 'false',
            text: [fields.fldTitle, ...nativeValues[index], fields.fldNeighbor][
                column
            ],
            ...(column === 1 || column === 2
                ? {
                      leaf: nativeValues[index][column - 1] !== '',
                      decoration: false,
                      controls: false,
                  }
                : {}),
        })),
    ]);
    for (const item of [first, second]) {
        assert.equal(item.react, react);
        assert.deepEqual(item.records, records);
        assert.deepEqual(item.acceptedValues, expectedSlots);
        assert.deepEqual(
            item.headers,
            fieldIds.map((id, index) => [id, fieldNames[index]])
        );
        assert.deepEqual(item.cells, cells);
        assert.deepEqual(item.actions, zeroActions);
        assert.equal(item.selected, 0);
    }
}

export function checkReadonlyPortalGridDurationConsumer({
    root,
    format,
    extension,
    react,
    run,
}) {
    const entry = `readonly-portal-grid-duration.${extension}`;
    const test = `readonly-grid-duration.test.${extension}`;
    const receipt = 'duration-observation.json';
    const compile = (name, source) =>
        writeFileSync(
            join(root, name),
            transformSync(source, { loader: 'js', format, target: 'es2022' })
                .code
        );
    compile(entry, readonlyPortalGridDurationEntry);
    compile(
        test,
        `
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { act } from 'react';
import { htmlPresentationFixture } from './grid-fixture.${extension}';
import { createDurationGrid } from './${entry}';

test('installed Grid preserves ordinary native physical Duration', async t => {
    const f = await htmlPresentationFixture(t);
    const fixture = createDurationGrid();
    t.after(() => fixture.destroy());
    const xhr = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest');
    const reads = [];
    class ForbiddenXHR { open(method) { reads.push(method); throw new Error('Unexpected Duration Grid request'); } }
    Object.defineProperty(globalThis, 'XMLHttpRequest', { value: ForbiddenXHR, configurable: true });
    Object.defineProperty(f.window, 'XMLHttpRequest', { value: ForbiddenXHR, configurable: true });
    try {
        const observe = () => fixture.observe(f.container.querySelector('#duration-grid'));
        await f.render(fixture.render('div'));
        const first = observe();
        await act(async () => fixture.publish());
        await f.render(fixture.render('div'));
        const second = observe();
        f.unchangedEffects();
        await f.render(null);
        f.unchangedEffects();
        writeFileSync('${receipt}', JSON.stringify({ first, second, cleanup: fixture.destroy(), reads }));
    } finally {
        if (xhr) Object.defineProperty(globalThis, 'XMLHttpRequest', xhr);
        else Reflect.deleteProperty(globalThis, 'XMLHttpRequest');
    }
});`
    );
    const output = run(process.execPath, [
        '--test',
        '--test-reporter=tap',
        test,
    ]);
    for (const [counter, count] of [
        ['tests', 1],
        ['pass', 1],
        ['fail', 0],
        ['skipped', 0],
        ['cancelled', 0],
    ])
        assert.match(
            output,
            new RegExp('^# ' + counter + ' ' + count + '$', 'm')
        );
    const observed = JSON.parse(readFileSync(join(root, receipt), 'utf8'));
    verifyDurationGrid(observed, react);
    assert.deepEqual(observed.reads, []);
    return { ...observed, nativeReference, status: 'passed' };
}

export async function checkReadonlyPortalGridDurationBrowser({
    page,
    evidence,
}) {
    const browser = page.context().browser();
    assert(browser);
    const origin = new URL(page.url()).origin;
    const fixture = '/readonly-portal-grid.html?fixture=duration-only';
    const assets = new Set([
        fixture,
        '/readonly-portal-grid.js',
        '/readonly-portal-grid.css',
        '/favicon.ico',
    ]);
    const proof = { nativeReference, providerRequests: [], pageErrors: [] };
    evidence.duration = proof;
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                url.origin === origin &&
                request.method() === 'GET' &&
                !['fetch', 'xhr'].includes(request.resourceType()) &&
                assets.has(url.pathname + url.search)
            )
                return route.continue();
            proof.providerRequests.push({
                method: request.method(),
                path: url.pathname,
            });
            return route.abort();
        });
        const durationPage = await context.newPage();
        durationPage.on('pageerror', (error) =>
            proof.pageErrors.push(error.message)
        );
        await durationPage.goto(origin + fixture, { waitUntil: 'networkidle' });
        const grid = durationPage.locator('#duration-grid');
        await grid.getByRole('table').waitFor({ state: 'visible' });
        const observe = async () => {
            const snapshot = await durationPage.evaluate(() =>
                window.__durationGrid.observe()
            );
            for (const name of fieldNames) {
                const header = grid.getByRole('columnheader', {
                    name,
                    exact: false,
                });
                assert.equal(
                    await header.count(),
                    1,
                    `Accessible Grid header ${name}`
                );
                assert(await header.isVisible());
            }
            const displayed = await grid
                .locator('td[data-field-id]')
                .evaluateAll((cells) =>
                    cells.map((cell) => [
                        cell.checkVisibility(),
                        cell.innerText.trim(),
                    ])
                );
            assert.deepEqual(
                displayed,
                snapshot.cells.flatMap(([, cells]) =>
                    cells.map((cell) => [true, cell.text])
                )
            );
            for (const [index, row] of records.entries()) {
                const record = grid.locator(`tr[data-record-id="${row.id}"]`);
                for (const value of new Set(
                    nativeValues[index].filter(Boolean)
                )) {
                    assert.equal(
                        await record
                            .getByRole('cell', { name: value, exact: true })
                            .count(),
                        1
                    );
                }
            }
            assert.equal(await grid.getByRole('textbox').count(), 0);
            assert.equal(
                await grid.getByRole('button', { name: /clear/i }).count(),
                0
            );
            assert.equal(await grid.getByRole('dialog').count(), 0);
            return snapshot;
        };
        proof.first = await observe();
        await durationPage.evaluate(() => window.__durationGrid.renew());
        await durationPage.waitForFunction(
            (revision) =>
                Number(
                    document.querySelector('#duration-grid').dataset.revision
                ) > revision,
            proof.first.revision
        );
        proof.second = await observe();
        proof.cleanup = await durationPage.evaluate(() =>
            window.__durationGrid.unmount()
        );
        assert.equal(await grid.count(), 0);
        await durationPage.waitForLoadState('networkidle');
        verifyDurationGrid(proof, evidence.react);
        assert.deepEqual(proof.providerRequests, []);
        assert.deepEqual(proof.pageErrors, []);
        proof.status = 'passed';
    } finally {
        await context.close();
        proof.contextClosed = true;
    }
}
