import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build, stop, transformSync } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

const targetText = 'Owned generated AI Text link target';
const plainText = '  Plain <b>literal</b> text\n  with two spaces Ω.';
const fields = [
    { id: 'fldTitle', name: 'Name', type: 'singleLineText' },
    { id: 'fldAiOutput', name: 'Generated output', type: 'aiText' },
    { id: 'fldCleared', name: 'Cleared output', type: 'aiText' },
    { id: 'fldMissing', name: 'Missing output', type: 'aiText' },
];
const primaryValues = { recLinked: 'Link record', recPlain: 'Plain record' };
const linkedText = (url) => '  Generated result Ω\n  ' + url + '\n  End.';

function mountFixture({
    h,
    createRoot,
    version,
    ReadonlyPortalRecords,
    AiTextField,
    CompleteReadOnlyTextField,
    createBorrowedPortalRenderScope,
    convert,
    fields,
    primaryValues,
    linkedText,
    plainText,
}) {
    const target = new URL('generated-link', location.href).href;
    const generated = (value) =>
        Object.freeze({ state: 'generated', value, isStale: false });
    const configs = fields.map(({ id, name, type }, index) => ({
        id,
        name,
        config: { type, options: type === 'aiText' ? {} : null },
        isPrimaryField: index === 0,
        isComputed: type === 'aiText',
        description: null,
    }));
    const records = Object.freeze(
        [
            {
                id: 'recLinked',
                fields: {
                    fldTitle: primaryValues.recLinked,
                    fldAiOutput: generated(linkedText(target)),
                    fldCleared: null,
                },
            },
            {
                id: 'recPlain',
                fields: {
                    fldTitle: primaryValues.recPlain,
                    fldAiOutput: generated(plainText),
                    fldCleared: generated(''),
                },
            },
        ].map((row) =>
            Object.freeze({ ...row, fields: Object.freeze(row.fields) })
        )
    );
    const projection = {
        portalFieldId: 'fldSyntheticPortal',
        linkedTableId: 'tblSyntheticGrid',
        records,
        table: { airtableFields: configs },
        detailProjection: 'present',
        detailFields: configs.map((field) => ({
            fieldId: field.id,
            fieldName: field.name,
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
            miniExtConfig: {
                title: field.name,
                readOnly: true,
                conditionalFields: { logicalOperator: 'and', conditions: [] },
            },
        })),
    };
    const actions = {
        opens: 0,
        hostClicks: 0,
        selections: 0,
        writes: 0,
        submits: 0,
    };
    const writes = () => {
        actions.writes++;
    };
    const listeners = new Set();
    const stamp = {};
    const scope = createBorrowedPortalRenderScope({
        capture: () => ({ stamp, projection }),
        isCurrent: (candidate) => candidate === stamp,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        invokeIfCurrent() {
            writes();
            return false;
        },
    });
    const revision = scope.getSnapshot().revision;
    const byRecordId = new Map(
        records.map(({ id }) => [
            id,
            {
                revision,
                activate() {
                    actions.opens++;
                },
            },
        ])
    );
    const renderers = {
        renderSingleLineTextField: ({ value }) =>
            h(CompleteReadOnlyTextField, { value, language: 'en' }),
        renderAiTextField(field) {
            if (
                field.physicalKind !== 'aiText' ||
                field.presentation.type !== 'physical' ||
                field.capability.type !== 'readonly'
            ) {
                throw new Error('Expected the physical read-only AI Text cell');
            }
            const value = convert({
                value: field.value,
                airtableFieldConfig: field.field.config,
                source: {
                    type: 'airtableMock',
                    linkedTableStates: {},
                    dateParsing: 'local',
                },
                fieldName: field.field.name,
            });
            // The native Grid leaves nullish and empty-readable values blank.
            return value === ''
                ? h('span')
                : h(AiTextField, {
                      mode: 'controlled',
                      value,
                      language: 'en',
                  });
        },
    };
    const root = createRoot(document.querySelector('#root'));
    root.render(
        h(
            'form',
            {
                onClick() {
                    actions.hostClicks++;
                },
                onChange: writes,
                onSelect() {
                    actions.selections++;
                },
                onSubmit(event) {
                    event.preventDefault();
                    actions.submits++;
                },
            },
            h(ReadonlyPortalRecords, {
                scope,
                layout: 'grid',
                renderers,
                openActions: { scope, byRecordId },
                grid: {
                    ready: true,
                    preferenceScopeKey: 'fixture-ai-grid',
                    primaryFieldId: 'fldTitle',
                    rowHeight: 'tall',
                    hiddenColumns: {},
                    columnWidths: {
                        fldTitle: 140,
                        fldAiOutput: 440,
                        fldCleared: 120,
                        fldMissing: 120,
                    },
                    recordLabel: (id) => primaryValues[id],
                    onFieldHiddenChange: writes,
                    onColumnWidthCommit: writes,
                },
            })
        )
    );
    const enterEvents = [];
    function observeEnter(event) {
        if (event.key === 'Enter')
            enterEvents.push({
                trusted: event.isTrusted,
                href: event.target.closest('a')?.href ?? null,
            });
    }
    document.addEventListener('keydown', observeEnter, true);
    const rows = () => [
        ...document.querySelectorAll('tbody tr[data-record-id]'),
    ];
    const cells = (row) => [...row.querySelectorAll('td[data-field-id]')];
    const nodes = () => rows().flatMap((row) => [row, ...cells(row)]);
    let initialNodes;
    window.aiTextGridProof = {
        observe() {
            const current = nodes();
            initialNodes ??= current;
            return {
                react: version,
                revision: scope.getSnapshot().revision,
                records,
                sameNodes:
                    current.length === initialNodes.length &&
                    current.every((node, i) => node === initialNodes[i]),
                rows: rows().map((row) => [
                    row.dataset.recordId,
                    cells(row).map((cell) => ({
                        field: cell.dataset.fieldId,
                        primary: cell.dataset.primary,
                        text: cell.textContent,
                        links: [...cell.querySelectorAll('a')].map(
                            (anchor) => ({
                                href: anchor.href,
                                target: anchor.target,
                            })
                        ),
                        markup: cell.querySelector('b') !== null,
                        emptyPlaceholder:
                            cell.querySelector(
                                '[data-testid="no-value-test-id"]'
                            ) !== null,
                    })),
                ]),
                selection: window.getSelection()?.toString() ?? '',
                selectedCells: document.querySelectorAll(
                    '[aria-selected="true"]'
                ).length,
                actions: { ...actions },
            };
        },
        enterEvents: () => enterEvents,
        dispose() {
            document.removeEventListener('keydown', observeEnter, true);
            root.unmount();
            const afterUnmount = listeners.size;
            scope.destroy();
            return {
                afterUnmount,
                afterDestroy: listeners.size,
                rows: rows().length,
                actions: { ...actions },
            };
        },
    };
}

const entry = `
import { createElement as h, version } from 'react';
import { createRoot } from 'react-dom/client';
import { ReadonlyPortalRecords, AiTextField, CompleteReadOnlyTextField } from '@miniextensions/sdk/react';
import { createBorrowedPortalRenderScope } from '@miniextensions/sdk/ui';
import { getReadableStringFromAirtableValue as convert } from '@miniextensions/sdk/formulas';
import '@miniextensions/sdk/react/readonly-portal-grid.css';
(${mountFixture.toString()})({ h, createRoot, version, ReadonlyPortalRecords, AiTextField,
    CompleteReadOnlyTextField, createBorrowedPortalRenderScope, convert,
    fields: ${JSON.stringify(fields)}, primaryValues: ${JSON.stringify(primaryValues)},
    linkedText: ${linkedText.toString()}, plainText: ${JSON.stringify(plainText)} });
`;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const noActions = {
    opens: 0,
    hostClicks: 0,
    selections: 0,
    writes: 0,
    submits: 0,
};
function regularFile(path) {
    const absolute = resolve(path);
    assert(lstatSync(absolute).isFile());
    assert.equal(realpathSync(absolute), absolute, 'Refuse redirected input');
    return absolute;
}

function readKit(archive, receipt) {
    const kit = JSON.parse(readFileSync(regularFile(receipt), 'utf8'));
    const bytes = readFileSync(archive);
    assert.equal(kit.schemaVersion, 1);
    assert.equal(kit.verification.outcome, 'passed');
    assert.equal(kit.package.name, '@miniextensions/sdk');
    assert.equal(kit.package.filename, basename(archive));
    assert.equal(kit.package.bytes, bytes.length);
    assert.equal(kit.package.sha256, sha256(bytes));
    assert.equal(
        kit.package.integrity,
        'sha512-' + createHash('sha512').update(bytes).digest('base64')
    );
    assert.match(kit.source.commit, /^[0-9a-f]{40}$/);
    assert.match(kit.source.tree, /^[0-9a-f]{40}$/);
    assert.equal(kit.ci.repository, 'miniExtensions/sdk');
    assert.equal(kit.ci.workflowSha, kit.source.commit);
    return kit;
}

function installConsumer(path, archive, react, kit) {
    mkdirSync(path);
    writeFileSync(
        join(path, 'package.json'),
        JSON.stringify({
            private: true,
            dependencies: {
                '@miniextensions/sdk': `file:${archive}`,
                react,
                'react-dom': react,
            },
        })
    );
    const installation = installAgeQualifiedConsumer({
        directory: path,
        args: ['install', '--ignore-scripts'],
    });
    assert.equal(installation.archiveSha256, kit.package.sha256);
    const require = createRequire(join(path, 'package.json'));
    for (const peer of ['react', 'react-dom'])
        assert.equal(require(`${peer}/package.json`).version, react);
    return installation;
}

async function buildProfile(path, format) {
    const filename = format === 'esm' ? 'fixture.mjs' : 'fixture.cjs';
    writeFileSync(
        join(path, filename),
        transformSync(entry, { format, loader: 'js', target: 'es2022' }).code
    );
    const bundle = await build({
        absWorkingDir: path,
        entryPoints: [filename],
        outfile: 'ai-text-grid.js',
        platform: 'browser',
        format: 'iife',
        bundle: true,
        write: false,
        metafile: true,
    });
    await assertBrowserInputs(bundle.metafile, path);
    const sdkPrefix = 'node_modules/@miniextensions/sdk/dist/';
    const sdkJs = Object.keys(bundle.metafile.inputs).filter(
        (name) => name.startsWith(sdkPrefix) && /\.[cm]?js$/.test(name)
    );
    for (const part of ['react', 'ui', 'formulas']) {
        assert(
            sdkJs.includes(`${sdkPrefix}${format}/${part}/index.js`),
            `Expected the packed ${format} ${part} entry`
        );
    }
    // Both public export trees import shared, format-independent vendored files.
    const wrongFormat = sdkJs.filter(
        (name) =>
            !name.startsWith(`${sdkPrefix}${format}/`) &&
            !name.startsWith(`${sdkPrefix}vendor/`)
    );
    assert.deepEqual(wrongFormat, [], 'Mixed SDK JavaScript export conditions');
    return bundle.outputFiles;
}

const fixtureHtml =
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>AI Text Grid fixture</title><link rel="icon" href="data:,"><link rel="stylesheet" href="ai-text-grid.css"><div id="root"></div><script defer src="ai-text-grid.js"></script>';
const linkHtml = `<!doctype html><meta charset="utf-8"><title>Owned popup</title><link rel="icon" href="data:,"><h1>${targetText}</h1>`;

function verifyGrid(before, target, react) {
    assert.equal(before.react, react);
    assert.equal(before.sameNodes, true);
    assert.equal(before.selection, '');
    assert.equal(before.selectedCells, 0);
    assert.deepEqual(before.actions, noActions);
    assert.deepEqual(
        before.rows.map(([id]) => id),
        Object.keys(primaryValues)
    );
    for (const [id, cells] of before.rows) {
        assert.deepEqual(
            cells.map(({ field }) => field),
            fields.map(({ id }) => id)
        );
        assert.equal(cells[0].primary, 'true');
        assert.equal(cells[0].text, primaryValues[id]);
        assert.equal(
            cells[1].text,
            id === 'recLinked' ? linkedText(target) : plainText
        );
        assert.equal(cells[1].markup, false);
        assert.deepEqual(
            cells[1].links,
            id === 'recLinked' ? [{ href: target, target: '_blank' }] : []
        );
        for (const cell of cells.slice(2)) {
            assert.equal(cell.text, '');
            assert.deepEqual(cell.links, []);
            assert.equal(cell.emptyPlaceholder, false);
        }
    }
}

async function checkProfile(
    browser,
    origin,
    prefix,
    assets,
    serverHits,
    react
) {
    const context = await browser.newContext({
        viewport: { width: 1120, height: 630 },
        serviceWorkers: 'block',
    });
    const hits = [],
        unexpected = [],
        pages = [],
        pageErrors = [];
    const targetPath = prefix + 'generated-link';
    const target = origin + targetPath;
    let armed = false;
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const path = new URL(request.url());
            if (
                path.origin === origin &&
                path.search === '' &&
                request.method() === 'GET' &&
                assets.has(path.pathname)
            ) {
                if (
                    armed &&
                    path.pathname === targetPath &&
                    request.isNavigationRequest() &&
                    request.resourceType() === 'document'
                ) {
                    hits.push({
                        method: 'GET',
                        path: path.pathname,
                        type: 'document',
                    });
                    return route.continue();
                }
                if (
                    !armed &&
                    path.pathname.startsWith(prefix) &&
                    path.pathname !== targetPath &&
                    ['document', 'script', 'stylesheet'].includes(
                        request.resourceType()
                    )
                ) {
                    return route.continue();
                }
            }
            unexpected.push({
                method: request.method(),
                path: path.pathname,
                type: request.resourceType(),
            });
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(origin + prefix);
        const grid = page.getByRole('table', { name: 'Records' });
        const linkCell = grid.locator(
            'tr[data-record-id="recLinked"] td[data-field-id="fldAiOutput"]'
        );
        const link = linkCell.getByRole('link', { name: target, exact: true });
        await link.waitFor({ state: 'visible' });
        assert.equal(await grid.getByRole('link').count(), 1);
        assert.equal(
            await grid.getByRole('button', { name: /^Open record / }).count(),
            2
        );
        assert.deepEqual(
            await grid
                .locator('th[data-field-id]')
                .allTextContents()
                .then((names) => names.map((name) => name.trim())),
            fields.map(({ name }) => name)
        );
        const capture = () =>
            page.evaluate(() => window.aiTextGridProof.observe());
        const before = await capture();
        verifyGrid(before, target, react);
        assert.equal(
            await link.evaluate(
                (anchor) => getComputedStyle(anchor.closest('p')).whiteSpace
            ),
            'pre-wrap'
        );
        assert.equal(serverHits.get(targetPath) ?? 0, 0);
        assert.deepEqual(hits, []);
        assert.equal(context.pages().length, 1);

        await link.focus();
        assert.equal(
            await link.evaluate((anchor) => document.activeElement === anchor),
            true
        );
        context.on('page', (opened) => pages.push(opened));
        armed = true;
        const [popup] = await Promise.all([
            page.waitForEvent('popup', { timeout: 10000 }),
            page.keyboard.press('Enter'),
        ]);
        await popup.waitForURL(target);
        await popup
            .getByRole('heading', { name: targetText, exact: true })
            .waitFor({ state: 'visible' });
        assert.equal(pages.length, 1);
        assert.equal(pages[0], popup);
        assert.equal(context.pages().length, 2);
        assert.deepEqual(hits, [
            { method: 'GET', path: targetPath, type: 'document' },
        ]);
        assert.equal(serverHits.get(targetPath), 1);
        assert.equal(page.url(), origin + prefix);
        const enter = await page.evaluate(() =>
            window.aiTextGridProof.enterEvents()
        );
        assert.deepEqual(enter, [{ trusted: true, href: target }]);
        assert.deepEqual(await capture(), before);
        assert.deepEqual(unexpected, []);
        assert.deepEqual(pageErrors, []);

        const disposed = await page.evaluate(() =>
            window.aiTextGridProof.dispose()
        );
        assert.deepEqual(disposed, {
            // The host subscription belongs to the scope until destroy().
            afterUnmount: 1,
            afterDestroy: 0,
            rows: 0,
            actions: noActions,
        });
        assert.deepEqual(unexpected, []);
        return {
            result: 'passed',
            before,
            enter,
            documentRequests: hits,
            targetServerRequests: 1,
            openedPages: 1,
            unexpected,
            pageErrors,
            disposed,
        };
    } finally {
        await context.close();
    }
}

const { values } = parseArgs({
    options: {
        archive: { type: 'string' },
        receipt: { type: 'string' },
        chromium: { type: 'string' },
        output: { type: 'string' },
    },
});
assert(
    values.archive && values.receipt && values.chromium && values.output,
    'Pass --archive, --receipt, --chromium and --output'
);
const archive = regularFile(values.archive);
const kit = readKit(archive, values.receipt);
const [commit, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    { encoding: 'utf8' }
)
    .trim()
    .split('\n');
const assets = new Map(),
    serverHits = new Map();
const server = createServer((request, response) => {
    const asset = request.method === 'GET' && assets.get(request.url);
    if (!asset) return response.writeHead(404).end();
    serverHits.set(request.url, (serverHits.get(request.url) ?? 0) + 1);
    response
        .writeHead(200, {
            'Content-Type': asset.type,
            'Cache-Control': 'no-store',
            'Content-Security-Policy':
                "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'",
        })
        .end(asset.bytes);
});
const output = resolve(values.output);
mkdirSync(output);
const report = {
    fixture: {
        commit,
        tree,
        sourceSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    },
    archive: { source: kit.source, package: kit.package, ci: kit.ci },
    profiles: [],
    cleanup: {},
};
let browser, temporary;
try {
    browser = await chromium.launch({
        executablePath: regularFile(realpathSync(values.chromium)),
        headless: true,
        chromiumSandbox: true,
    });
    report.browser = browser.version();
    temporary = realpathSync(mkdtempSync(join(tmpdir(), 'sdk-ai-grid-link-')));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const react of ['18.3.1', '19.2.0']) {
        const path = join(temporary, react);
        const installation = installConsumer(path, archive, react, kit);
        for (const format of ['esm', 'cjs']) {
            const prefix = `/${react}-${format}/`;
            for (const file of await buildProfile(path, format)) {
                assets.set(prefix + basename(file.path), {
                    type: file.path.endsWith('.css')
                        ? 'text/css'
                        : 'text/javascript',
                    bytes: file.contents,
                });
            }
            assets.set(prefix, {
                type: 'text/html; charset=utf-8',
                bytes: fixtureHtml,
            });
            assets.set(prefix + 'generated-link', {
                type: 'text/html; charset=utf-8',
                bytes: linkHtml,
            });
            report.profiles.push({
                react,
                format,
                installation,
                ...(await checkProfile(
                    browser,
                    origin,
                    prefix,
                    assets,
                    serverHits,
                    react
                )),
            });
        }
    }
    readKit(archive, values.receipt);
    report.status = 'passed';
} catch (error) {
    report.status = 'failed';
    report.error = error.message;
    throw error;
} finally {
    try {
        if (browser) await browser.close();
        report.cleanup.browser = browser ? 'closed' : 'not launched';
    } finally {
        try {
            if (server.listening) {
                const closed = once(server, 'close');
                server.close();
                await closed;
                report.cleanup.loopback = 'closed';
            } else report.cleanup.loopback = 'not started';
        } finally {
            if (temporary) rmSync(temporary, { recursive: true });
            report.cleanup.consumers = temporary ? 'removed' : 'not created';
            await stop();
            writeFileSync(
                join(output, 'report.json'),
                JSON.stringify(report, null, 2) + '\n'
            );
        }
    }
}
