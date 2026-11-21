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
    scrollTarget: 192,
};
const viewports = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'explicit-grid-under-640', width: 639, height: 800 },
];
const entryName = 'wide-readonly-grid-scene.mjs';
const sceneSource = `
import { createElement as h } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { CompleteReadOnlyTextField, ReadonlyPortalGrid } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/readonly-portal-grid.css';

const scene = ${JSON.stringify(scene)};
const activity = { widthCommits: 0, hiddenChanges: 0, submits: 0, fetches: 0, xhr: 0 };
const columns = scene.columns.map(([fieldId, title]) => ({ fieldId, title, icon: 'text' }));
const rows = scene.records.map(([recordId, values]) => ({
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
<body><div id="grid"></div><script defer src="/grid.js"></script></body></html>`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function measureGrid({ primary, neighbor, scrollTarget }) {
    const viewport = document.querySelector(
        '#grid .mx-sdk-readonly-grid__viewport'
    );
    const table = viewport.querySelector('table');
    const trackedFields = [primary, neighbor];
    const rowNodes = [...table.querySelectorAll('tbody tr')];
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
                                primary: cell.dataset.primary === 'true',
                                ...rect(cell, frame),
                            },
                        ])
                ),
            })),
            activity: { ...window.gridActivity },
        };
    };
    const before = snapshot();
    viewport.scrollLeft = scrollTarget;
    await new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(done))
    );
    return { before, after: snapshot() };
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
                header.width > 0 &&
                    header.height > 0 &&
                    header.right > 0 &&
                    header.left < sample.viewport.width,
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
                    cell.width > 0 && cell.height > 0,
                    `Invisible ${field} cell`
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
    for (const field of [scene.neighbor, scene.primary]) {
        const expected = under640 || field === scene.neighbor ? -scroll : 0;
        close(
            after.headers[field].left - before.headers[field].left,
            expected,
            `${field} header movement`
        );
        for (const [index, row] of after.rows.entries())
            close(
                row.cells[field].left - before.rows[index].cells[field].left,
                expected,
                `${row.id} ${field} cell movement`
            );
    }
    if (!under640)
        assert(
            after.headers[scene.primary].left >= -1 &&
                after.headers[scene.primary].right <= after.viewport.width + 1,
            'Sticky primary must stay in the viewport'
        );
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
                result.measurements = await page.evaluate(measureGrid, scene);
                if (width >= 640) {
                    const inset =
                        result.measurements.after.headers[scene.primary]?.left;
                    if (typeof inset === 'number')
                        result.deltaFromNativeInsetReferencePx =
                            inset -
                            report.native.desktopNoOpenPrimaryInsetReferencePx;
                }
                checkGeometry(result.measurements, width);
                assert.deepEqual(result.unexpectedRequests, []);
                assert.deepEqual(result.errors, []);
                result.status = 'passed';
            } catch (error) {
                result.status = 'failed';
                result.failure = error.message;
            } finally {
                await context.close();
            }
        }
    } catch (error) {
        report.failure = error.message;
    } finally {
        try {
            await browser?.close();
            report.cleanup.browser = browser ? 'closed' : 'not-started';
        } catch (error) {
            report.cleanup.browser = error.message;
        }
        try {
            if (server.listening)
                await new Promise((done, fail) => {
                    server.close((error) => (error ? fail(error) : done()));
                    server.closeAllConnections();
                });
            report.cleanup.server = 'closed';
        } catch (error) {
            report.cleanup.server = error.message;
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
