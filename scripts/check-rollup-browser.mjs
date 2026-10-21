// Local packed-package proof with synthetic data; no backend or publication.
// node scripts/check-rollup-browser.mjs /path/to/sdk.tgz [evidence-directory]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { rollupLoadedFixture } from './rollup-consumer-checks.mjs';

assert(process.argv[2], 'Pass the tested SDK tarball');
const tarball = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? 'dist/rollup-browser');
const temporary = mkdtempSync(join(tmpdir(), 'sdk-rollup-browser-'));
mkdirSync(output, { recursive: true });
let browser, server;
try {
    writeFileSync(
        join(temporary, 'package.json'),
        '{"private":true,"type":"module"}'
    );
    execFileSync(
        'npm',
        [
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            tarball,
            'react@18.3.1',
            'react-dom@18.3.1',
        ],
        {
            cwd: temporary,
            env: {
                ...process.env,
                npm_config_cache: join(temporary, 'npm-cache'),
            },
            stdio: 'pipe',
        }
    );
    const { loaded, expected } = rollupLoadedFixture();
    writeFileSync(
        join(temporary, 'main.js'),
        `
import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createFormFieldBindings } from '@miniextensions/sdk/forms';
import { createFormRenderScope } from '@miniextensions/sdk/ui';
import { AirtableForm, RollupField, renderRollupField } from '@miniextensions/sdk/react';
const loaded = ${JSON.stringify(loaded)};
let requests = 0, writes = 0, rowEvents = 0;
const fields = createFormFieldBindings({ loaded, client: { getSession: () => ({}), forms: { save: async () => { requests++; throw Error('No Rollup Save'); } } }, getScope: () => ({ownerId:'rollup-browser',revision:0}), saveOptions: {captchaVal:null,isComputeMode:false,context:{type:'direct-url'},searchQuery:{},conditionalLinkedRecordFieldIdsToFilteringValues:{}} });
const before = JSON.stringify(fields.controller.getState());
const binding = fields.field('amount');
binding.setValue = () => { writes++; throw Error('No Rollup setter'); };
const scope = createFormRenderScope({ fields, isCurrent: () => true, configurationRevision: () => 0 });
const root = createRoot(document.getElementById('root'));
const renderers = { renderRollupField: props => h('section', {'data-field':props.fieldId}, renderRollupField(props)) };
root.render(h(StrictMode,null,h('div',{onClick:()=>rowEvents++,onKeyDown:()=>rowEvents++}, h(AirtableForm,{scope,renderers},state=>state.fields.map(field=>field.node)),h('section',{'data-bound':true},h(RollupField,{binding})))));
globalThis.rollupProof = {
    state: () => ({requests,writes,rowEvents,nativeUnchanged:before===JSON.stringify(fields.controller.getState()),amount:binding.getSnapshot().value}),
    retire: () => fields.destroy(),
};
`
    );
    const bundle = await build({
        entryPoints: [join(temporary, 'main.js')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        write: false,
    });
    const html =
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Read-only Rollup proof</title><style>body{font:16px system-ui;margin:24px;color:#182530}h1{font-size:24px}#root>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}section{border:1px solid #8996a0;border-radius:8px;padding:16px;min-width:0}label{font-weight:600}output{margin-top:8px;min-height:24px}output[aria-invalid=true]{outline:2px solid #b42318}</style><h1>Read-only Rollup presentation</h1><p>Synthetic accepted Form values, formatted without edits or resource loading.</p><main id="root"></main><script type="module" src="/main.js"></script>';
    server = createServer((request, response) => {
        if (request.url === '/main.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(bundle.outputFiles[0].contents);
        } else if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end(html);
        } else {
            response.statusCode = 404;
            response.end();
        }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
        executablePath: process.env.SDK_ROLLUP_CHROMIUM ?? '/usr/bin/chromium',
        headless: true,
        chromiumSandbox: true,
    });
    const context = await browser.newContext({
        viewport: { width: 1180, height: 1000 },
        reducedMotion: 'reduce',
    });
    const external = [],
        errors = [];
    await context.route('**/*', (route) => {
        if (new URL(route.request().url()).origin === origin)
            return route.continue();
        external.push(route.request().url());
        return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.locator('[data-field="amount"] output').waitFor();
    for (const [id, text] of expected)
        assert.equal(
            await page.locator(`[data-field="${id}"] output`).textContent(),
            text
        );
    assert.equal(
        await page.locator('[data-bound] output').textContent(),
        '-1234.57'
    );
    assert.equal(
        await page
            .locator(
                'input,button,a,img,iframe,object,embed,[contenteditable=true]'
            )
            .count(),
        0
    );
    assert.equal(
        await page
            .locator('#root')
            .innerHTML()
            .then(
                (html) =>
                    html.includes('PRIVATE_MASKED_ANSWER') ||
                    html.includes('rec12345678901234')
            ),
        false
    );
    await page.locator('[data-field="amount"] output').click();
    await page
        .locator('[data-field="amount"] output')
        .dispatchEvent('keydown', { key: 'Enter', bubbles: true });
    const initial = await page.evaluate(() => globalThis.rollupProof.state());
    assert.deepEqual(initial, {
        requests: 0,
        writes: 0,
        rowEvents: 0,
        nativeUnchanged: true,
        amount: -1234.567,
    });
    const screenshot = async (name) => {
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            ),
            true
        );
        await page.screenshot({ path: join(output, name), fullPage: true });
    };
    await screenshot('desktop.png');
    await page.setViewportSize({ width: 375, height: 900 });
    await screenshot('mobile.png');
    await page.emulateMedia({ forcedColors: 'active' });
    await screenshot('forced-colors.png');
    await page.evaluate(() => globalThis.rollupProof.retire());
    await page.waitForFunction(() => document.querySelector('output') === null);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    const receipt = {
        packageSha256: createHash('sha256')
            .update(readFileSync(tarball))
            .digest('hex'),
        browser: browser.version(),
        sandbox: true,
        cases: expected.length + 1,
        initial,
        retired: true,
        externalRequests: external,
        errors,
        screenshots: ['desktop.png', 'mobile.png', 'forced-colors.png'],
    };
    writeFileSync(
        join(output, 'receipt.json'),
        JSON.stringify(receipt, null, 2) + '\n'
    );
    console.log(JSON.stringify(receipt, null, 2));
} finally {
    await browser?.close();
    if (server) await new Promise((done) => server.close(done));
    rmSync(temporary, { recursive: true, force: true });
}
