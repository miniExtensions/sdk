import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    lstatSync,
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
import { parseArgs } from 'node:util';
import { build, stop } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

const gridText = 'Synthetic visible Grid text';
const editableText = 'Synthetic adjacent editable text';
const sentinel = 'Fixture-owned clipboard sentinel';

const entry = `
import { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CompleteReadOnlyTextField, ReadonlyPortalGrid } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-readonly-text.css';
import '@miniextensions/sdk/react/readonly-portal-grid.css';

const observations = { opens: 0, preferenceWrites: 0, submits: 0, copyKeys: [] };
window.fixtureObservations = observations;
document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'c' && (event.ctrlKey || event.metaKey)) {
        observations.copyKeys.push(event.isTrusted);
    }
});
const columns = [{ fieldId: 'name', title: 'Name', icon: 'text' }];
const rows = [{ recordId: 'fixture-row', label: 'Fixture row', cells: [{
    fieldId: 'name',
    node: h(CompleteReadOnlyTextField, { value: ${JSON.stringify(gridText)}, language: 'en' }),
}] }];
function Fixture() {
    const [restricted, setRestricted] = useState(false);
    return h('form', { onSubmit(event) { event.preventDefault(); observations.submits++; } },
        h('button', { type: 'button', onClick() { setRestricted(true); } }, 'Restrict Grid selection'),
        h('button', { type: 'button', onClick() { setRestricted(false); } }, 'Allow Grid selection'),
        h(ReadonlyPortalGrid, {
            columns, rows, primaryFieldId: 'name', revision: 1, preferenceScopeKey: 'fixture-view',
            ready: true, isCurrent: () => true, hiddenColumns: {}, columnWidths: { name: 320 },
            allowHideColumns: true, doNotAllowUserToCopyTextOnGrid: restricted,
            onFieldHiddenChange() { observations.preferenceWrites++; },
            onColumnWidthCommit() { observations.preferenceWrites++; },
            onOpenRecord() { observations.opens++; },
        }),
        h('input', { 'aria-label': 'Adjacent editable control', defaultValue: ${JSON.stringify(editableText)} }),
    );
}
createRoot(document.querySelector('#root')).render(h(Fixture));
`;

function regularFile(path) {
    const absolute = resolve(path);
    assert(lstatSync(absolute).isFile());
    assert.equal(realpathSync(absolute), absolute, 'Refuse redirected input');
    return absolute;
}

function readQualifiedArchive(archivePath, receiptPath) {
    const archive = regularFile(archivePath);
    const kit = JSON.parse(readFileSync(regularFile(receiptPath), 'utf8'));
    const bytes = readFileSync(archive);
    assert.equal(kit.schemaVersion, 1);
    assert.equal(kit.verification.outcome, 'passed');
    assert.equal(kit.package.name, '@miniextensions/sdk');
    assert.equal(kit.package.filename, basename(archive));
    assert.equal(kit.package.bytes, bytes.length);
    assert.equal(
        kit.package.sha256,
        createHash('sha256').update(bytes).digest('hex')
    );
    assert.equal(
        kit.package.integrity,
        'sha512-' + createHash('sha512').update(bytes).digest('base64')
    );
    assert.match(kit.source.commit, /^[a-f0-9]{40}$/);
    assert.match(kit.source.tree, /^[a-f0-9]{40}$/);
    assert.equal(kit.ci.repository, 'miniExtensions/sdk');
    assert.equal(kit.ci.workflowSha, kit.source.commit);
    return { archive, kit };
}

async function getSelection(page) {
    return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

async function dragAcrossText(page, cell) {
    const rect = await cell.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const { left, right, top, height } = range.getBoundingClientRect();
        return { left, right, y: top + height / 2 };
    });
    assert(rect.right > rect.left, 'The packed Grid cell text must be visible');
    await page.mouse.move(rect.left - 2, rect.y);
    await page.mouse.down();
    await page.mouse.move(rect.right + 2, rect.y, { steps: 12 });
    await page.mouse.up();
    return getSelection(page);
}

async function runGestures(page) {
    const cell = page.getByText(gridText, { exact: true });
    const viewport = page.locator('.mx-sdk-readonly-grid__viewport');
    const setRestriction = async (restricted) => {
        const label = restricted
            ? 'Restrict Grid selection'
            : 'Allow Grid selection';
        await page.getByRole('button', { name: label, exact: true }).click();
        await page.waitForFunction((value) => {
            const grid = document.querySelector('.mx-sdk-readonly-grid');
            return grid?.getAttribute('data-copy-restricted') === String(value);
        }, restricted);
    };
    const resetClipboard = () =>
        page.evaluate(async (value) => {
            window.getSelection()?.removeAllRanges();
            await navigator.clipboard.writeText(value);
        }, sentinel);
    const copySelection = async () => {
        await page.keyboard.press('ControlOrMeta+C');
        return page.evaluate(() => navigator.clipboard.readText());
    };

    const cases = [];
    for (const [name, restricted] of [
        ['initially allowed', false],
        ['strict true', true],
        ['allowed again', false],
    ]) {
        await setRestriction(restricted);
        await resetClipboard();
        const userSelect = await viewport.evaluate(
            (node) => getComputedStyle(node).userSelect
        );
        assert.equal(userSelect === 'none', restricted);
        const selection = await dragAcrossText(page, cell);
        assert.equal(selection, restricted ? '' : gridText);
        const clipboard = await copySelection();
        assert.equal(clipboard, restricted ? sentinel : gridText);
        cases.push({ name, selection, clipboard });

        if (restricted) {
            await resetClipboard();
            const editable = page.getByRole('textbox', {
                name: 'Adjacent editable control',
            });
            await editable.focus();
            await page.keyboard.press('ControlOrMeta+A');
            const selected = await editable.evaluate((element) =>
                element.value.slice(
                    element.selectionStart,
                    element.selectionEnd
                )
            );
            assert.equal(selected, editableText);
            const copied = await copySelection();
            assert.equal(copied, editableText);
            cases.push({
                name: 'adjacent editable under strict true',
                selection: selected,
                clipboard: copied,
            });
        }
    }
    const effects = await page.evaluate(() => window.fixtureObservations);
    assert.deepEqual(effects, {
        opens: 0,
        preferenceWrites: 0,
        submits: 0,
        copyKeys: [true, true, true, true],
    });
    return { cases, effects };
}

async function runProfile(browser, archive, version) {
    const directory = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-grid-copy-'))
    );
    let context, server;
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: {
                    '@miniextensions/sdk': `file:${archive}`,
                    react: version,
                    'react-dom': version,
                },
            })
        );
        const install = installAgeQualifiedConsumer({
            directory,
            args: ['install'],
        });
        const require = createRequire(join(directory, 'package.json'));
        assert.equal(require('react/package.json').version, version);
        assert.equal(require('react-dom/package.json').version, version);
        writeFileSync(join(directory, 'fixture.mjs'), entry);
        const bundle = await build({
            absWorkingDir: directory,
            entryPoints: ['fixture.mjs'],
            outfile: 'app.js',
            bundle: true,
            write: false,
            metafile: true,
            logLevel: 'silent',
        });
        await assertBrowserInputs(bundle.metafile, directory);
        const assets = new Map([
            [
                '/',
                [
                    'text/html',
                    '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><div id="root"></div><script defer src="/app.js"></script>',
                ],
            ],
            ...bundle.outputFiles.map((file) => [
                '/' + basename(file.path),
                [
                    file.path.endsWith('.css') ? 'text/css' : 'text/javascript',
                    file.contents,
                ],
            ]),
        ]);
        server = createServer((request, response) => {
            const asset = request.method === 'GET' && assets.get(request.url);
            if (!asset) return response.writeHead(404).end();
            response
                .writeHead(200, {
                    'Content-Type': asset[0],
                    'Cache-Control': 'no-store',
                })
                .end(asset[1]);
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
            viewport: { width: 900, height: 420 },
            serviceWorkers: 'block',
        });
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
            origin,
        });
        const requests = [],
            errors = [];
        let loading = true;
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                loading &&
                request.method() === 'GET' &&
                url.origin === origin &&
                assets.has(url.pathname)
            ) {
                return route.continue();
            }
            requests.push({ method: request.method(), path: url.pathname });
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        await page
            .getByText(gridText, { exact: true })
            .waitFor({ state: 'visible' });
        loading = false;
        const result = await runGestures(page);
        assert.deepEqual(requests, []);
        assert.deepEqual(errors, []);
        return { react: version, install, ...result, requests, errors };
    } finally {
        try {
            if (context) await context.close();
        } finally {
            try {
                if (server?.listening) {
                    const closed = once(server, 'close');
                    server.close();
                    await closed;
                }
            } finally {
                rmSync(directory, { recursive: true });
            }
        }
    }
}

const { values } = parseArgs({
    options: {
        archive: { type: 'string' },
        receipt: { type: 'string' },
        chromium: { type: 'string' },
    },
});
assert(
    values.archive && values.receipt && values.chromium,
    'Pass --archive, --receipt and --chromium'
);
const { archive, kit } = readQualifiedArchive(values.archive, values.receipt);
const browser = await chromium.launch({
    executablePath: regularFile(values.chromium),
    headless: true,
    chromiumSandbox: true,
});
let profiles;
try {
    profiles = [];
    for (const version of ['18.3.1', '19.2.0']) {
        profiles.push(await runProfile(browser, archive, version));
    }
    readQualifiedArchive(values.archive, values.receipt);
} finally {
    try {
        await browser.close();
    } finally {
        await stop();
    }
}
console.log(
    JSON.stringify(
        {
            source: kit.source,
            package: kit.package,
            ci: kit.ci,
            browser: browser.version(),
            profiles,
            cleanup: 'completed',
        },
        null,
        2
    )
);
