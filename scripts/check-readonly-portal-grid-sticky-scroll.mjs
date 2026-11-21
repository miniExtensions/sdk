import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { build, stop, transformSync } from 'esbuild';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

// The same field IDs, widths, and record order identify the paired native scene.
const scene = {
    primary: 'fldProject',
    neighbor: 'fldOwner',
    columns: [
        ['fldProject', 'Project', 320],
        ['fldOwner', 'Owner', 340],
        ['fldPhase', 'Phase', 340],
        ['fldRegion', 'Region', 340],
        ['fldNotes', 'Notes', 340],
    ],
    records: [
        ['recAtlas', ['Atlas', 'Morgan', 'Planning', 'North', 'Keep Atlas']],
        ['recBeacon', ['Beacon', 'Taylor', 'Review', 'South', 'Keep Beacon']],
    ],
    openColumn: false,
    scrollTarget: 360,
};
const viewports = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'explicit-grid-under-640', width: 639, height: 800 },
];
const verticalScroll = 120;
const entryName = 'wide-readonly-grid-scene.mjs';
const sceneSource = `
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { CompleteReadOnlyTextField, ReadonlyPortalGrid } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/readonly-portal-grid.css';

const scene = ${JSON.stringify(scene)};
const vertical = location.pathname === '/vertical';
document.body.dataset.axis = vertical ? 'vertical' : 'horizontal';
const activity = { widthCommits: 0, hiddenChanges: 0, submits: 0, fetches: 0, xhr: 0 };
const columns = scene.columns.map(([fieldId, title]) => ({ fieldId, title, icon: 'text' }));
const records = vertical ? [...scene.records, ...Array.from({ length: 12 }, (_, index) => [
    'recExtra' + index, ['Project ' + index, 'Owner ' + index, 'Planning', 'North', 'Notes'],
])] : scene.records;
const rows = records.map(([recordId, values]) => ({
    recordId, label: values[0],
    cells: columns.map(({ fieldId }, index) => ({
        fieldId, node: h(CompleteReadOnlyTextField, { value: values[index], language: 'en' }),
    })),
}));
window.fetch = async () => { activity.fetches++; throw Error('Unexpected fetch'); };
XMLHttpRequest.prototype.open = () => { activity.xhr++; throw Error('Unexpected XHR'); };
const root = createRoot(document.getElementById('grid'));
flushSync(() => root.render(h('form', {
    onSubmit: (event) => { event.preventDefault(); activity.submits++; },
}, h(ReadonlyPortalGrid, {
    columns, rows, primaryFieldId: scene.primary, revision: 1,
    preferenceScopeKey: 'wide-readonly-grid', ready: true, isCurrent: () => true,
    hiddenColumns: {}, columnWidths: Object.fromEntries(scene.columns.map(([id, , width]) => [id, width])),
    allowHideColumns: false, rowHeight: 'short',
    onColumnWidthCommit: () => { activity.widthCommits++; },
    onFieldHiddenChange: () => { activity.hiddenChanges++; },
}))));
window.gridActivity = activity;
`;
const html = `<!doctype html><html lang="en" dir="ltr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wide read-only Grid scroll</title><link rel="stylesheet" href="/grid.css"></head>
<body><style>body[data-axis="vertical"] .mx-sdk-readonly-grid__viewport{max-block-size:190px}</style>
<div id="grid"></div><script defer src="/grid.js"></script></body></html>`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function createGridMeasurement({ primary, neighbor }) {
    const viewport = document.querySelector(
        '#grid .mx-sdk-readonly-grid__viewport'
    );
    const table = viewport.querySelector('table');
    const trackedFields = [primary, neighbor];
    const headerNodes = [...table.querySelectorAll('thead th')];
    const rowNodes = [...table.querySelectorAll('tbody tr')];
    const cellNodes = rowNodes.map((row) => [...row.cells]);
    const rect = (node, frame) => {
        const box = node.getBoundingClientRect();
        const left = frame.left + viewport.clientLeft;
        const top = frame.top + viewport.clientTop;
        return {
            left: box.left - left,
            top: box.top - top,
            right: box.right - left,
            bottom: box.bottom - top,
            width: box.width,
            height: box.height,
            position: getComputedStyle(node).position,
        };
    };
    const snapshot = () => {
        const frame = viewport.getBoundingClientRect();
        const headers = [...table.querySelectorAll('thead th')];
        return {
            pageWidth: window.innerWidth,
            under640: matchMedia('(max-width: 639px)').matches,
            viewport: {
                x: frame.x,
                y: frame.y,
                width: viewport.clientWidth,
                height: viewport.clientHeight,
                scrollWidth: viewport.scrollWidth,
                scrollLeft: viewport.scrollLeft,
                scrollHeight: viewport.scrollHeight,
                scrollTop: viewport.scrollTop,
            },
            headerIds: headers.map((header) => header.dataset.fieldId ?? null),
            headers: Object.fromEntries(
                headers
                    .filter((header) =>
                        trackedFields.includes(header.dataset.fieldId)
                    )
                    .map((header) => [
                        header.dataset.fieldId,
                        {
                            text: header.textContent.trim(),
                            sameNode: headerNodes.includes(header),
                            hitHeading: (() => {
                                const label = header
                                    .querySelector(
                                        '.mx-sdk-readonly-grid__heading'
                                    )
                                    .getBoundingClientRect();
                                const hit = document.elementFromPoint(
                                    label.left + label.width / 2,
                                    label.top + label.height / 2
                                );
                                return hit?.closest('th') === header;
                            })(),
                            ...rect(header, frame),
                        },
                    ])
            ),
            rows: [...table.querySelectorAll('tbody tr')].map((row, index) => ({
                id: row.dataset.recordId,
                sameNode: row === rowNodes[index],
                cellIds: [...row.cells].map(
                    (cell) => cell.dataset.fieldId ?? null
                ),
                buttons: row.querySelectorAll('button').length,
                cells: Object.fromEntries(
                    [...row.cells]
                        .filter((cell) =>
                            trackedFields.includes(cell.dataset.fieldId)
                        )
                        .map((cell) => [
                            cell.dataset.fieldId,
                            {
                                text: cell.textContent.trim(),
                                sameNode:
                                    cellNodes[index]?.includes(cell) ?? false,
                                primary: cell.dataset.primary === 'true',
                                ...rect(cell, frame),
                            },
                        ])
                ),
            })),
            activity: { ...window.gridActivity },
        };
    };
    return {
        snapshot,
        async scrollTo(target, axis = 'x') {
            if (axis === 'x') viewport.scrollLeft = target;
            else viewport.scrollTop = target;
            await new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done))
            );
            return snapshot();
        },
    };
}

function checkVerticalGeometry({ before, after }, width) {
    const narrow = width < 640;
    const shift = after.viewport.scrollTop;
    assert.equal(before.viewport.scrollTop, 0);
    assert.equal(shift, verticalScroll);
    assert.equal(before.viewport.scrollLeft, 0);
    assert.equal(after.viewport.scrollLeft, 0);
    assert(before.viewport.scrollHeight > before.viewport.height + shift);
    assert.equal(after.rows.length, scene.records.length + 12);
    assert.deepEqual(after.headerIds, before.headerIds);
    assert.deepEqual(
        after.rows.map((row) => [row.id, row.cellIds]),
        before.rows.map((row) => [row.id, row.cellIds])
    );
    for (const sample of [before, after]) {
        assert.equal(sample.pageWidth, width);
        assert.equal(sample.under640, narrow);
        assert.deepEqual(Object.values(sample.activity), [0, 0, 0, 0, 0]);
    }
    for (const field of [scene.primary, scene.neighbor]) {
        const initial = before.headers[field];
        const header = after.headers[field];
        assert(initial.hitHeading && header.sameNode);
        assert.equal(header.text, initial.text);
        assert.equal(header.left, initial.left);
        assert.equal(header.width, initial.width);
        assert.equal(
            header.top - initial.top,
            narrow ? -shift : 0,
            `${field} header top after vertical scroll`
        );
        assert.equal(
            header.hitHeading,
            !narrow,
            `${field} header hit after vertical scroll`
        );
        if (narrow) assert(header.bottom <= 0);
        else assert(header.top >= 0 && header.bottom <= after.viewport.height);
        const headerCenter = header.top + header.height / 2;
        let bodyPassesBehindHeader = false;
        for (const [index, row] of after.rows.entries()) {
            const cell = row.cells[field];
            const original = before.rows[index].cells[field];
            assert(row.sameNode && cell.sameNode && row.buttons === 0);
            assert.equal(cell.text, original.text);
            assert.equal(cell.top - original.top, -shift);
            assert.equal(cell.left, header.left);
            assert.equal(cell.right, header.right);
            if (cell.top <= headerCenter && cell.bottom > headerCenter)
                bodyPassesBehindHeader = true;
        }
        if (!narrow)
            assert(
                bodyPassesBehindHeader,
                `${field} body must pass behind its heading`
            );
    }
}

function checkGeometry({ before, after }, expectedWidth) {
    const under640 = expectedWidth < 640;
    const ids = scene.columns.map(([id]) => id);
    const fields = [scene.primary, scene.neighbor];
    const close = (actual, expected, label) =>
        assert(
            Math.abs(actual - expected) <= 1,
            `${label}: ${actual}, expected ${expected} ± 1px`
        );
    const scroll = after.viewport.scrollLeft - before.viewport.scrollLeft;
    close(before.viewport.scrollLeft, 0, 'initial horizontal offset');
    const primaryRects = (sample) => [
        ['Project header', sample.headers[scene.primary]],
        ...sample.rows.map((row) => [
            row.id + ' Project cell',
            row.cells[scene.primary],
        ]),
    ];
    for (const [label, rect] of primaryRects(before))
        assert(
            scroll > rect.right,
            `Actual scroll ${scroll}px must cross initial ${label} far edge ${rect.right}px`
        );
    const room =
        before.viewport.scrollWidth -
        before.viewport.width -
        before.viewport.scrollLeft;
    assert(
        room >= scene.scrollTarget,
        `Shared ${scene.scrollTarget}px target exceeds available horizontal room ${room}px`
    );
    close(scroll, scene.scrollTarget, 'actual horizontal scroll');
    for (const sample of [before, after]) {
        assert.equal(sample.pageWidth, expectedWidth);
        assert.equal(sample.under640, under640);
        assert(sample.viewport.scrollWidth > sample.viewport.width);
        assert.deepEqual(
            sample.headerIds,
            ids,
            'headers must include the exact fields and no Open or number gutter'
        );
        assert.deepEqual(
            sample.rows.map((row) => row.id),
            scene.records.map(([id]) => id)
        );
        assert.deepEqual(Object.values(sample.activity), [0, 0, 0, 0, 0]);
        for (const field of fields) {
            const index = ids.indexOf(field);
            const header = sample.headers[field];
            assert.equal(header.text, scene.columns[index][1]);
            assert(
                header.sameNode,
                `Unexpected replacement of ${field} header`
            );
            assert(
                header.width > 0 && header.height > 0,
                `Missing layout for ${field} header`
            );
            const requireVisibility =
                sample === before || field !== scene.primary;
            if (requireVisibility)
                assert(
                    header.right > 0 && header.left < sample.viewport.width,
                    `Invisible ${field} header`
                );
            for (const [rowIndex, row] of sample.rows.entries()) {
                assert(row.sameNode, `Unexpected replacement of ${row.id}`);
                assert.deepEqual(row.cellIds, ids);
                assert.equal(
                    row.buttons,
                    0,
                    `Unexpected row action on ${row.id}`
                );
                const cell = row.cells[field];
                assert.equal(cell.text, scene.records[rowIndex][1][index]);
                assert.equal(cell.primary, field === scene.primary);
                assert(
                    cell.sameNode,
                    `Unexpected replacement of ${row.id} ${field} cell`
                );
                assert(
                    cell.width > 0 && cell.height > 0,
                    `Missing layout for ${row.id} ${field} cell`
                );
                if (requireVisibility)
                    assert(
                        cell.right > 0 && cell.left < sample.viewport.width,
                        `Invisible ${row.id} ${field} cell`
                    );
                close(
                    cell.left,
                    header.left,
                    `${row.id} ${field} header/body alignment`
                );
                close(
                    cell.right,
                    header.right,
                    `${row.id} ${field} right edge alignment`
                );
            }
        }
    }
    const checkMovement = (initial, final, expected, label) => {
        close(final.left - initial.left, expected, `${label} movement`);
        close(
            final.right - initial.right,
            expected,
            `${label} far edge movement`
        );
        assert.equal(final.width, initial.width, `${label} width changed`);
        assert.equal(final.height, initial.height, `${label} height changed`);
    };
    for (const field of [scene.neighbor, scene.primary]) {
        const expected = under640 || field === scene.neighbor ? -scroll : 0;
        checkMovement(
            before.headers[field],
            after.headers[field],
            expected,
            `${field} header`
        );
        for (const [index, row] of after.rows.entries())
            checkMovement(
                before.rows[index].cells[field],
                row.cells[field],
                expected,
                `${row.id} ${field} cell`
            );
    }
    for (const [label, rect] of primaryRects(after)) {
        if (under640)
            assert(
                rect.right <= 0,
                `${label} must be fully outside the scrollport at 639px`
            );
        else
            assert(
                rect.left >= -1 && rect.right <= after.viewport.width + 1,
                `Sticky ${label} must stay in the viewport`
            );
    }
}

function checkOfflineGeometry() {
    const snapshot = (pageWidth, scrollLeft, pinPrimary) => {
        const viewport = {
            width: pageWidth - 16,
            scrollWidth: scene.columns.reduce(
                (total, [, , width]) => total + width,
                0
            ),
            scrollLeft,
        };
        const headerIds = scene.columns.map(([id]) => id);
        const rect = (index, text) => {
            const [id, , width] = scene.columns[index];
            const left =
                scene.columns
                    .slice(0, index)
                    .reduce((total, [, , size]) => total + size, 0) -
                (id === scene.primary && pinPrimary ? 0 : scrollLeft);
            return {
                text,
                sameNode: true,
                left,
                right: left + width,
                width,
                height: 32,
            };
        };
        return {
            pageWidth,
            under640: pageWidth < 640,
            viewport,
            headerIds,
            headers: Object.fromEntries(
                scene.columns.map(([id, title], index) => [
                    id,
                    rect(index, title),
                ])
            ),
            rows: scene.records.map(([id, values]) => ({
                id,
                sameNode: true,
                cellIds: headerIds,
                buttons: 0,
                cells: Object.fromEntries(
                    headerIds.map((field, index) => [
                        field,
                        {
                            ...rect(index, values[index]),
                            primary: field === scene.primary,
                        },
                    ])
                ),
            })),
            activity: {
                widthCommits: 0,
                hiddenChanges: 0,
                submits: 0,
                fetches: 0,
                xhr: 0,
            },
        };
    };
    const target = scene.scrollTarget;
    checkGeometry(
        {
            before: snapshot(1280, 0, true),
            after: snapshot(1280, target, true),
        },
        1280
    );
    checkGeometry(
        {
            before: snapshot(639, 0, false),
            after: snapshot(639, target, false),
        },
        639
    );
    console.log(
        'PASS synthetic controls: desktop pinning and 639px natural motion'
    );
    assert.throws(
        () =>
            checkGeometry(
                {
                    before: snapshot(639, 0, false),
                    after: snapshot(639, 192, false),
                },
                639
            ),
        /cross initial Project header far edge/
    );
    console.log(
        'PASS negative control: old 192px leaves Project partly visible'
    );
    const partial = snapshot(639, 0, false);
    partial.rows[1].cells[scene.primary].right = target + 1;
    assert.throws(
        () =>
            checkGeometry(
                { before: partial, after: snapshot(639, target, false) },
                639
            ),
        /cross initial recBeacon Project cell far edge/
    );
    console.log(
        'PASS negative control: scroll clears the header but not every Project body far edge'
    );
    assert.throws(
        () =>
            checkGeometry(
                {
                    before: snapshot(1280, 0, false),
                    after: snapshot(1280, target, false),
                },
                1280
            ),
        /fldProject header movement/
    );
    console.log(
        'PASS negative control: desktop Project scrolls out without pinning'
    );
    assert.throws(
        () =>
            checkGeometry(
                {
                    before: snapshot(639, 0, false),
                    after: snapshot(639, target, true),
                },
                639
            ),
        /fldProject header movement/
    );
    console.log('PASS negative control: Project remains pinned at 639px');
}

async function bundleInstalled({ consumer, archive, sha }) {
    const bundle = await build({
        stdin: {
            contents: sceneSource,
            sourcefile: entryName,
            resolveDir: consumer,
        },
        absWorkingDir: consumer,
        outdir: consumer,
        bundle: true,
        platform: 'browser',
        format: 'iife',
        metafile: true,
        write: false,
    });
    const { [entryName]: entry, ...inputs } = bundle.metafile.inputs;
    assert(entry, 'Expected only the in-memory entry outside installed files');
    await assertBrowserInputs({ inputs }, consumer);
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    const readMember = createArchiveMemberReader({
        archivePath: archive,
        expectedSha256: sha,
    });
    const verified = [];
    for (const input of Object.keys(inputs)) {
        const path = realpathSync(resolve(consumer, input));
        if (!path.startsWith(installed + sep)) continue;
        const member =
            'package/' + relative(installed, path).split(sep).join('/');
        assert.deepEqual(readFileSync(path), readMember(member), member);
        verified.push(member);
    }
    for (const name of ['ReadonlyPortalGrid.js', 'readonly-portal-grid.css'])
        assert(
            verified.some((member) => member.endsWith('/react/' + name)),
            `Missing installed ${name}`
        );
    const asset = (extension) => {
        const matches = bundle.outputFiles.filter((file) =>
            file.path.endsWith(extension)
        );
        assert.equal(matches.length, 1, `Expected one ${extension} asset`);
        return matches[0].contents;
    };
    return {
        js: asset('.js'),
        css: asset('.css'),
        verified: verified.length,
        react: JSON.parse(
            readFileSync(
                join(consumer, 'node_modules/react/package.json'),
                'utf8'
            )
        ).version,
    };
}

async function measurePacked({ executablePath, output, inputs, sha }) {
    const assets = new Map([
        ['/', ['text/html', html]],
        ['/vertical', ['text/html', html]],
        ['/grid.js', ['text/javascript', inputs.js]],
        ['/grid.css', ['text/css', inputs.css]],
        ['/favicon.ico', ['image/x-icon', '']],
    ]);
    const server = createServer((request, response) => {
        const asset = request.method === 'GET' && assets.get(request.url);
        if (!asset) return response.writeHead(404).end();
        response.setHeader('Content-Type', asset[0]);
        response.setHeader(
            'Content-Security-Policy',
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'"
        );
        response.end(asset[1]);
    });
    const report = {
        scene,
        archiveSha256: sha,
        react: inputs.react,
        verifiedArchiveInputs: inputs.verified,
        fixtureSha256: sha256(readFileSync(new URL(import.meta.url))),
        native: {
            status: 'unmeasured',
            referenceRevision: '863d4bf27dd1943104a1879f1fb2b03184dbdd74',
            desktopNoOpenPrimaryInsetReferencePx: 32,
        },
        packed: [],
        cleanup: {},
    };
    let browser;
    try {
        await new Promise((ready, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', ready);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const { chromium } = await import('playwright');
        browser = await chromium.launch({
            executablePath,
            chromiumSandbox: true,
            headless: true,
        });
        report.chromium = browser.version();
        for (const { name, width, height } of viewports) {
            const result = {
                name,
                width,
                height,
                unexpectedRequests: [],
                errors: [],
                screenshots: {},
            };
            report.packed.push(result);
            const context = await browser.newContext({
                viewport: { width, height },
                serviceWorkers: 'block',
            });
            try {
                await context.route('**/*', (route) => {
                    const request = route.request();
                    const url = new URL(request.url());
                    if (
                        request.method() === 'GET' &&
                        url.origin === origin &&
                        assets.has(url.pathname) &&
                        !url.search
                    )
                        return route.continue();
                    result.unexpectedRequests.push({
                        method: request.method(),
                        local: url.origin === origin,
                    });
                    return route.abort();
                });
                const page = await context.newPage();
                page.on('pageerror', (error) =>
                    result.errors.push(error.message)
                );
                page.on('console', (message) => {
                    if (message.type() === 'error')
                        result.errors.push(message.text());
                });
                await page.goto(origin);
                await page
                    .locator(
                        `tr[data-record-id="${scene.records[0][0]}"] td[data-field-id="${scene.primary}"]`
                    )
                    .waitFor({ state: 'visible' });
                const measurement = await page.evaluateHandle(
                    createGridMeasurement,
                    scene
                );
                const captureViewport = async (phase) => {
                    const png = `${name}-${phase}.png`;
                    try {
                        await page.screenshot({
                            path: join(output, png),
                            type: 'png',
                            fullPage: false,
                        });
                        result.screenshots[phase] = png;
                    } catch (error) {
                        result.errors.push(
                            `Screenshot ${phase}: ${error.message}`
                        );
                    }
                };
                result.measurements = {
                    before: await measurement.evaluate((probe) =>
                        probe.snapshot()
                    ),
                };
                await captureViewport('before');
                result.measurements.after = await measurement.evaluate(
                    (probe, target) => probe.scrollTo(target),
                    scene.scrollTarget
                );
                await captureViewport('after');
                if (width >= 640) {
                    const inset =
                        result.measurements.after.headers[scene.primary]?.left;
                    if (typeof inset === 'number')
                        result.deltaFromNativeInsetReferencePx =
                            inset -
                            report.native.desktopNoOpenPrimaryInsetReferencePx;
                }
                checkGeometry(result.measurements, width);
                await page.goto(origin + '/vertical');
                await page
                    .locator('tbody tr')
                    .last()
                    .waitFor({ state: 'attached' });
                const vertical = await page.evaluateHandle(
                    createGridMeasurement,
                    scene
                );
                result.vertical = {
                    before: await vertical.evaluate((probe) =>
                        probe.snapshot()
                    ),
                };
                await captureViewport('vertical-before');
                result.vertical.after = await vertical.evaluate(
                    (probe, target) => probe.scrollTo(target, 'y'),
                    verticalScroll
                );
                await captureViewport('vertical-after');
                checkVerticalGeometry(result.vertical, width);
                if (width >= 640) {
                    const resize = page
                        .locator(`th[data-field-id="${scene.neighbor}"]`)
                        .getByRole('separator');
                    const initialWidth = Number(
                        await resize.getAttribute('aria-valuenow')
                    );
                    await resize.focus();
                    assert(
                        await resize.evaluate(
                            (node) => node === document.activeElement
                        )
                    );
                    await page.keyboard.down('ArrowRight');
                    assert.equal(
                        Number(await resize.getAttribute('aria-valuenow')),
                        initialWidth + 1
                    );
                    await page.keyboard.press('Escape');
                    await page.keyboard.up('ArrowRight');
                    assert.equal(
                        Number(await resize.getAttribute('aria-valuenow')),
                        initialWidth
                    );
                    const combined = await vertical.evaluate(
                        (probe, target) => probe.scrollTo(target),
                        scene.scrollTarget
                    );
                    result.vertical.combined = combined;
                    assert.equal(combined.viewport.scrollTop, verticalScroll);
                    assert.equal(
                        combined.viewport.scrollLeft,
                        scene.scrollTarget
                    );
                    const primary = combined.headers[scene.primary];
                    assert.equal(primary.top, 0);
                    assert.equal(primary.left, 0);
                    assert(primary.hitHeading);
                    assert.deepEqual(
                        Object.values(combined.activity),
                        [0, 0, 0, 0, 0]
                    );
                    await captureViewport('combined-after');
                }
                assert.deepEqual(result.unexpectedRequests, []);
                assert.deepEqual(result.errors, []);
                result.status = 'passed';
            } catch (error) {
                result.status = 'failed';
                result.failure = error.message;
            } finally {
                // Retain the per-width observations before closing the browser context.
                try {
                    writeFileSync(
                        join(output, `${name}.json`),
                        JSON.stringify(result, null, 2) + '\n',
                        { flag: 'wx' }
                    );
                } finally {
                    await context.close();
                }
            }
        }
    } catch (error) {
        report.failure = error.message;
    } finally {
        try {
            await browser?.close();
            report.cleanup.browser = browser ? 'closed' : 'not-started';
        } catch (error) {
            report.cleanup.browser = 'failed';
            report.cleanup.browserError = error.message;
        }
        try {
            if (server.listening)
                await new Promise((done, fail) => {
                    server.close((error) => (error ? fail(error) : done()));
                    server.closeAllConnections();
                });
            report.cleanup.server = 'closed';
        } catch (error) {
            report.cleanup.server = 'failed';
            report.cleanup.serverError = error.message;
        }
        const passed =
            !report.failure &&
            report.packed.length === viewports.length &&
            report.packed.every(({ status }) => status === 'passed') &&
            report.cleanup.browser === 'closed' &&
            report.cleanup.server === 'closed';
        writeFileSync(
            join(output, 'result.json'),
            JSON.stringify(
                { ...report, status: passed ? 'passed' : 'failed' },
                null,
                2
            ) + '\n',
            { flag: 'wx' }
        );
        if (!passed) process.exitCode = 1;
    }
}

const { values: args } = parseArgs({
    options: {
        'check-fixture': { type: 'boolean' },
        'inputs-only': { type: 'boolean' },
        consumer: { type: 'string' },
        archive: { type: 'string' },
        sha256: { type: 'string' },
        chromium: { type: 'string' },
        output: { type: 'string' },
    },
});
try {
    if (args['check-fixture']) {
        assert.equal(Object.keys(args).length, 1);
        transformSync(sceneSource, { loader: 'js', target: 'es2022' });
        checkOfflineGeometry();
        console.log(
            'Fixture entry syntax passed. Browser geometry unmeasured.'
        );
    } else {
        assert(
            args.consumer && args.archive && args.sha256,
            'Expected --consumer, --archive and --sha256'
        );
        assert.match(args.sha256, /^[0-9a-f]{64}$/);
        if (args['inputs-only']) assert(!args.chromium && !args.output);
        else
            assert(
                args.chromium && args.output,
                'Expected approved --chromium and new --output directory'
            );
        const consumer = realpathSync(args.consumer);
        const archive = realpathSync(args.archive);
        assert.equal(sha256(readFileSync(archive)), args.sha256);
        const inputs = await bundleInstalled({
            consumer,
            archive,
            sha: args.sha256,
        });
        if (args['inputs-only']) {
            console.log(
                `Verified ${inputs.verified} installed archive inputs with React ${inputs.react}. Browser geometry unmeasured.`
            );
        } else {
            const executablePath = realpathSync(args.chromium);
            const output = resolve(args.output);
            mkdirSync(output);
            await measurePacked({
                executablePath,
                output,
                inputs,
                sha: args.sha256,
            });
        }
    }
} finally {
    stop();
}
