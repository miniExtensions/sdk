import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { transformSync } from 'esbuild';

const timezones = ['UTC', 'America/Los_Angeles'];
const beforeJump = '2026-03-08T09:59:00Z';
const afterJump = '2026-03-08T10:00:00Z';
const records = [
    {
        id: 'recBefore',
        fields: {
            fldTitle: 'Before jump',
            fldFixed: beforeJump,
            fldClient: beforeJump,
            fldNeighbor: 'Keep before',
        },
    },
    {
        id: 'recAfter',
        fields: {
            fldTitle: 'After jump',
            fldFixed: afterJump,
            fldClient: afterJump,
            fldNeighbor: 'Keep after',
        },
    },
    {
        id: 'recNull',
        fields: {
            fldTitle: 'Null',
            fldFixed: null,
            fldClient: null,
            fldNeighbor: 'Keep null',
        },
    },
    {
        id: 'recOmitted',
        fields: { fldTitle: 'Omitted', fldNeighbor: 'Keep omitted' },
    },
];

export const readonlyPortalGridDateTimeEntry = String.raw`
import { StrictMode, createElement as h, version } from 'react';
import { CompleteReadOnlyTextField, ReadonlyPortalRecords } from '@miniextensions/sdk/react';
import { DateTimeField } from '@miniextensions/sdk/react/date';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';

const text = { type: 'singleLineText', options: null };
const dateTime = timeZone => ({
    type: 'dateTime',
    options: {
        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
        timeFormat: { name: '24hour', format: 'HH:mm' },
        timeZone,
    },
});
const fields = [
    { id: 'fldTitle', name: 'Name', isPrimaryField: true, config: text },
    { id: 'fldFixed', name: 'Los Angeles appointment', config: dateTime('America/Los_Angeles') },
    { id: 'fldClient', name: 'Client appointment', config: dateTime('client') },
    { id: 'fldNeighbor', name: 'Neighbor', config: text },
].map(field => ({ isComputed: false, isPrimaryField: false, description: null, ...field }));
const records = Object.freeze(${JSON.stringify(records)}.map(record =>
    Object.freeze({ ...record, fields: Object.freeze(record.fields) })));

export function createDateTimeGrid() {
    const actions = { selects: 0, writes: 0, submits: 0 };
    const write = () => { actions.writes++; };
    const listeners = new Set();
    let stamp = {};
    let projection = {
        portalFieldId: 'fldAppointments',
        linkedTableId: 'tblAppointments',
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
        invokeIfCurrent() { write(); return false; },
    });
    const grid = {
        ready: true, preferenceScopeKey: 'datetime-grid', primaryFieldId: 'fldTitle',
        hiddenColumns: {}, columnWidths: {}, onFieldHiddenChange: write, onColumnWidthCommit: write,
    };
    const renderers = {
        renderSingleLineTextField(field) {
            return h(CompleteReadOnlyTextField, { value: field.value, language: 'en' });
        },
        renderDateTimeField(field) {
            if (field.capability.type !== 'readonly' || field.physicalKind !== 'dateTime' || field.computed)
                throw new Error('Expected an admitted physical read-only DateTime field');
            // Ordinary Grid leaves null and omitted values blank before formatting.
            return field.value == null ? null : h(DateTimeField, {
                id: field.fieldId + '-' + field.value,
                sessionId: 'datetime-grid',
                airtableDateConfig: field.field.config,
                value: field.value,
                language: 'en',
                mode: 'readOnly',
            });
        },
    };
    let originalNodes;
    return {
        render(element) {
            return h(element, {
                id: 'datetime-grid',
                'data-revision': scope.getSnapshot().revision,
                onChange: write,
                onSelect() { actions.selects++; },
                onSubmit(event) { event.preventDefault(); actions.submits++; },
            }, h(ReadonlyPortalRecords, { scope, layout: 'grid', grid, renderers }));
        },
        publish() {
            stamp = {};
            projection = { ...projection, records: [...records] };
            for (const listener of listeners) listener();
        },
        destroy() {
            const afterUnmount = listeners.size;
            scope.destroy();
            return { afterUnmount, afterDestroy: listeners.size };
        },
        observe(gridElement) {
            const rows = [...gridElement.querySelectorAll('tr[data-record-id]')];
            const nodes = rows.flatMap(row => [row, ...row.querySelectorAll('td[data-field-id]')]);
            const stableNodes = originalNodes
                ? nodes.filter((node, index) => node === originalNodes[index]).length
                : null;
            originalNodes ??= nodes;
            return {
                react: version,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                revision: Number(gridElement.dataset.revision),
                stableNodes,
                records: projection.records,
                actions: { ...actions },
                selected: gridElement.querySelectorAll('[aria-selected="true"]').length,
                cells: rows.map(row => [
                    row.dataset.recordId,
                    [...row.querySelectorAll('td[data-field-id]')].map(cell => ({
                        id: cell.dataset.fieldId,
                        primary: cell.dataset.primary,
                        text: cell.textContent.trim(),
                        dateTimeLeafId: cell.querySelector('[id^="fldFixed-"], [id^="fldClient-"]')?.id ?? null,
                        controls: cell.querySelectorAll('input, textarea, select, button, [contenteditable], [role="dialog"]').length,
                    })),
                ]),
            };
        },
    };
}

export function mountDateTimeGrid(root) {
    const fixture = createDateTimeGrid();
    const render = () => root.render(h(StrictMode, null, fixture.render('form')));
    window.__dateTimeGrid = {
        observe: () => fixture.observe(document.querySelector('#datetime-grid')),
        renew() { fixture.publish(); render(); },
        unmount() { root.unmount(); return fixture.destroy(); },
    };
    render();
}
`;

function assertDateTimeGrid({ first, second, listeners }, timezone, react) {
    assert.equal(first.stableNodes, null);
    assert.equal(second.stableNodes, 20);
    assert(second.revision > first.revision);
    assert.deepEqual(listeners, { afterUnmount: 1, afterDestroy: 0 });
    const fixed = ['2026-03-08 01:59', '2026-03-08 03:00', '', ''];
    const client =
        timezone === 'UTC'
            ? ['2026-03-08 09:59', '2026-03-08 10:00', '', '']
            : fixed;
    const cells = records.map(({ id, fields }, index) => [
        id,
        ['fldTitle', 'fldFixed', 'fldClient', 'fldNeighbor'].map(
            (fieldId, column) => ({
                id: fieldId,
                primary: column === 0 ? 'true' : 'false',
                text: [
                    fields.fldTitle,
                    fixed[index],
                    client[index],
                    fields.fldNeighbor,
                ][column],
                dateTimeLeafId:
                    (fieldId === 'fldFixed' || fieldId === 'fldClient') &&
                    typeof fields[fieldId] === 'string'
                        ? fieldId + '-' + fields[fieldId]
                        : null,
                controls: 0,
            })
        ),
    ]);
    for (const item of [first, second]) {
        assert.equal(item.timezone, timezone);
        assert.equal(item.react, react);
        assert.deepEqual(item.records, records);
        assert.deepEqual(item.cells, cells);
        assert.deepEqual(item.actions, { selects: 0, writes: 0, submits: 0 });
        assert.equal(item.selected, 0);
    }
}

export function checkReadonlyPortalGridDateTimeConsumer({
    root,
    format,
    extension,
    react,
    run,
}) {
    const entry = 'readonly-portal-grid-datetime.' + extension;
    const receipt = 'datetime-observation.json';
    const testName = 'readonly-grid-datetime.test.' + extension;
    const compile = (name, source) =>
        writeFileSync(
            join(root, name),
            transformSync(source, {
                loader: 'js',
                format,
                target: 'es2022',
            }).code
        );
    compile(entry, readonlyPortalGridDateTimeEntry);
    compile(
        testName,
        `
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { act } from 'react';
import { htmlPresentationFixture } from './grid-fixture.${extension}';
import { createDateTimeGrid } from './${entry}';
test('renders accepted DateTime Grid slots and retires their listeners', async t => {
    const f = await htmlPresentationFixture(t);
    const fixture = createDateTimeGrid();
    t.after(() => fixture.destroy());
    await f.render(fixture.render('div'));
    const observe = () => fixture.observe(f.container.querySelector('#datetime-grid'));
    const first = observe();
    await act(async () => fixture.publish());
    await f.render(fixture.render('div'));
    const second = observe();
    await f.render(null);
    writeFileSync('${receipt}', JSON.stringify({ first, second, listeners: fixture.destroy() }));
});
`
    );
    return timezones.map((timezone) => {
        const output = run(
            process.execPath,
            ['--test', '--test-reporter=tap', testName],
            { TZ: timezone }
        );
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
        assertDateTimeGrid(observed, timezone, react);
        return { timezone, ...observed, status: 'passed' };
    });
}

export async function checkReadonlyPortalGridDateTimeBrowser({
    page,
    evidence,
}) {
    const browser = page.context().browser();
    assert(browser);
    const origin = new URL(page.url()).origin;
    const fixture = '/readonly-portal-grid.html?fixture=date-time';
    const paths = new Set([
        fixture,
        '/readonly-portal-grid.js',
        '/readonly-portal-grid.css',
        '/favicon.ico',
    ]);
    const cases = [];
    evidence.dateTime = cases;
    for (const timezoneId of timezones) {
        const item = { timezoneId, refusedRequests: [], pageErrors: [] };
        cases.push(item);
        const context = await browser.newContext({
            timezoneId,
            serviceWorkers: 'block',
        });
        try {
            await context.route('**/*', (route) => {
                const request = route.request();
                const url = new URL(request.url());
                if (
                    url.origin === origin &&
                    request.method() === 'GET' &&
                    !['fetch', 'xhr'].includes(request.resourceType()) &&
                    paths.has(url.pathname + url.search)
                )
                    return route.continue();
                item.refusedRequests.push({
                    method: request.method(),
                    url: request.url(),
                });
                return route.abort();
            });
            const gridPage = await context.newPage();
            gridPage.on('pageerror', (error) =>
                item.pageErrors.push(error.message)
            );
            await gridPage.goto(origin + fixture, { waitUntil: 'networkidle' });
            const grid = gridPage.locator('#datetime-grid');
            await grid.getByRole('table').waitFor({ state: 'visible' });
            const observe = async () => {
                const snapshot = await gridPage.evaluate(() =>
                    window.__dateTimeGrid.observe()
                );
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
                assert.equal(await gridPage.getByRole('dialog').count(), 0);
                return snapshot;
            };
            item.first = await observe();
            await gridPage.evaluate(() => window.__dateTimeGrid.renew());
            await gridPage.waitForFunction(
                (revision) =>
                    Number(
                        document.querySelector('#datetime-grid').dataset
                            .revision
                    ) > revision,
                item.first.revision
            );
            await gridPage.waitForLoadState('networkidle');
            item.second = await observe();
            item.listeners = await gridPage.evaluate(() =>
                window.__dateTimeGrid.unmount()
            );
            assertDateTimeGrid(item, timezoneId, evidence.react);
            assert.deepEqual(item.refusedRequests, []);
            assert.deepEqual(item.pageErrors, []);
            item.status = 'passed';
        } catch (error) {
            item.error = error.message;
        } finally {
            await context.close();
            item.cleanup = 'completed';
        }
    }
    assert.deepEqual(
        cases.flatMap((item) =>
            item.error ? [{ timezone: item.timezoneId, error: item.error }] : []
        ),
        [],
        'Packed read-only DateTime Grid'
    );
}
