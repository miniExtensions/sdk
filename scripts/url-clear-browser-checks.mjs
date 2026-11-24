import assert from 'node:assert/strict';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { basename, join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const initialUrl =
    'https://example.test/a-long-url-that-overlaps-the-mobile-clear-button-without-wrapping';
const retainedDraft = 'Retain the neighboring draft';
const fixture = `
import {createElement as h, useState, version} from 'react';
import {createRoot} from 'react-dom/client';
import {UrlField} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/url-field.css';

const writes = [];
let submits = 0;
const owner = {token: 'fixture', isCurrent: () => true};
const deferred = new URLSearchParams(location.search).has('deferred');
function App() {
    const [value, setValue] = useState(${JSON.stringify(initialUrl)});
    return h('form', {id: 'fixture', onSubmit(event) {
        event.preventDefault();
        submits++;
    }},
        h(UrlField, {
            mode: 'controlled', form: 'fixture', title: 'Website', clearLabel: 'Clear website',
            initialMobile: true, enableInlineEdit: deferred, owner, value,
            onChange(next) {
                writes.push(next);
                setValue(next);
            },
        }),
        h('input', {'aria-label': 'Neighboring draft', defaultValue: 'Adjacent value'}));
}
window.urlClearProof = () => ({writes, submits, reactVersion: version});
createRoot(document.querySelector('main')).render(h(App));
`;

export async function checkUrlClearBrowser({
    browser,
    consumer,
    readArchiveMember,
    evidence,
}) {
    const root = realpathSync(consumer);
    const directory = mkdtempSync(join(root, '.url-clear-browser-'));
    const entry = join(directory, 'proof.mjs');
    let server;
    let context;
    evidence.cases = [];
    try {
        writeFileSync(entry, fixture);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            outdir: directory,
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, root);
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const sdkInputs = Object.keys(bundle.metafile.inputs)
            .map((input) => realpathSync(resolve(root, input)))
            .map((path) => relative(installed, path).replaceAll('\\', '/'))
            .filter((path) => path.startsWith('dist/esm/'));
        assert(sdkInputs.includes('dist/esm/react/ControlledUrlField.js'));
        assert(sdkInputs.includes('dist/esm/react/url-field.css'));
        evidence.stylesheets = sdkInputs.filter((path) =>
            path.endsWith('.css')
        );
        for (const path of evidence.stylesheets) {
            assert.deepEqual(
                readFileSync(join(installed, path)),
                readArchiveMember('package/' + path)
            );
        }
        const assets = new Map(
            bundle.outputFiles.map((file) => [
                '/' + basename(file.path),
                file.contents,
            ])
        );
        assert(assets.has('/proof.js') && assets.has('/proof.css'));
        server = createServer((request, response) => {
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/') {
                response.setHeader('content-type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/proof.css"><main></main><script type="module" src="/proof.js"></script>'
                );
            } else if (assets.has(path)) {
                response.setHeader(
                    'content-type',
                    path.endsWith('.css') ? 'text/css' : 'text/javascript'
                );
                response.end(assets.get(path));
            } else {
                response.writeHead(404).end();
            }
        });
        await new Promise((done, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', done);
        });
        const origin = 'http://127.0.0.1:' + server.address().port;
        context = await browser.newContext({
            viewport: { width: 375, height: 660 },
            isMobile: true,
            hasTouch: true,
        });
        const unexpectedRequests = [];
        await context.route('**/*', (route) => {
            const request = route.request();
            if (
                new URL(request.url()).origin === origin &&
                ['document', 'script', 'stylesheet'].includes(
                    request.resourceType()
                )
            ) {
                return route.continue();
            }
            unexpectedRequests.push(request.url());
            return route.abort();
        });
        for (const [mode, scenario] of [
            ['immediate', 'resting'],
            ['immediate', 'focused'],
            ['immediate', 'tab-round-trip'],
            ['immediate', 'keyboard-space'],
            ['deferred', 'tab-round-trip'],
        ]) {
            const page = await context.newPage();
            try {
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                const fixtureUrl =
                    origin + (mode === 'deferred' ? '/?deferred' : '/');
                await page.goto(fixtureUrl);
                const url = page.getByRole('textbox', {
                    name: 'Website',
                    exact: true,
                });
                const clear = page.getByRole('button', {
                    name: 'Clear website',
                    exact: true,
                });
                const link = page.locator('.mx-sdk-url-overlay');
                const sibling = page.getByRole('textbox', {
                    name: 'Neighboring draft',
                    exact: true,
                });
                await sibling.fill(retainedDraft);
                await sibling.blur();
                assert.equal(await url.inputValue(), initialUrl);
                assert.equal(await link.getAttribute('href'), initialUrl);
                const isFocused = (locator) =>
                    locator.evaluate(
                        (element) => element === document.activeElement
                    );
                if (scenario !== 'resting') {
                    await link.tap();
                    assert(
                        await isFocused(url),
                        'touch on the resting link focuses the editor'
                    );
                }
                if (
                    scenario === 'tab-round-trip' ||
                    scenario === 'keyboard-space'
                ) {
                    await page.keyboard.press('Tab');
                    assert(await isFocused(clear));
                    if (scenario === 'tab-round-trip') {
                        await page.keyboard.press('Shift+Tab');
                        assert(await isFocused(url));
                    }
                }
                const before = await page.evaluate(() =>
                    window.urlClearProof()
                );
                assert.deepEqual(before.writes, []);
                evidence.reactVersion = before.reactVersion;
                if (scenario === 'keyboard-space') {
                    await page.keyboard.press('Space');
                } else {
                    const target = await clear.boundingBox();
                    assert(target, 'Clear must have a visible touch target');
                    await page.touchscreen.tap(
                        target.x + target.width / 2,
                        target.y + target.height / 2
                    );
                }
                assert.equal(
                    await url.inputValue(),
                    '',
                    scenario + ' Clear must empty the textbox'
                );
                assert.deepEqual(
                    await page.evaluate(() => window.urlClearProof()),
                    {
                        writes: [''],
                        submits: 0,
                        reactVersion: before.reactVersion,
                    }
                );
                assert.equal(await sibling.inputValue(), retainedDraft);
                assert.equal(page.url(), fixtureUrl);
                assert.equal(context.pages().length, 1);
                assert.deepEqual(unexpectedRequests, []);
                assert.deepEqual(errors, []);
                evidence.cases.push({ mode, scenario });
            } finally {
                await page.close();
            }
        }
    } finally {
        try {
            await context?.close();
        } finally {
            try {
                if (server?.listening)
                    await new Promise((done) => server.close(done));
            } finally {
                rmSync(directory, { recursive: true, force: true });
            }
        }
    }
}
