// Local packed-package proof with synthetic data; no backend or publication.
// node scripts/check-lookup-browser.mjs /path/to/sdk.tgz [evidence-directory]
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
import { join, resolve, relative } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assertBrowserInputs } from './package-checks.mjs';
import { lookupLoadedFixture } from './lookup-consumer-checks.mjs';

assert(process.argv[2], 'Pass the tested SDK tarball');
const tarball = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? 'dist/lookup-browser');
const temporary = mkdtempSync(join(tmpdir(), 'sdk-lookup-browser-'));
mkdirSync(output, { recursive: true });
let browser, server, primaryFailure;
const receipt = { status: 'running', consumer: temporary, cleanup: {} };
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
    const { loaded, expected } = lookupLoadedFixture();
    writeFileSync(
        join(temporary, 'main.js'),
        `
import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createFormFieldBindings } from '@miniextensions/sdk/forms';
import { createFormRenderScope } from '@miniextensions/sdk/ui';
import { AirtableForm, LookupField, renderLookupField } from '@miniextensions/sdk/react';
const loaded = ${JSON.stringify(loaded)};
let requests = 0, writes = 0, rowEvents = 0, amountProps;
const fields = createFormFieldBindings({ loaded, client: { getSession: () => ({}), forms: { save: async () => { requests++; throw Error('No Lookup Save'); } } }, getScope: () => ({ownerId:'lookup-browser',revision:0}), saveOptions: {captchaVal:null,isComputeMode:false,context:{type:'direct-url'},searchQuery:{},conditionalLinkedRecordFieldIdsToFilteringValues:{}} });
const before = JSON.stringify(fields.controller.getState());
const binding = fields.field('amount');
binding.setValue = () => { writes++; throw Error('No Lookup setter'); };
const scope = createFormRenderScope({ fields, isCurrent: () => true, configurationRevision: () => 0 });
const root = createRoot(document.getElementById('root'));
const renderers = { renderMultipleLookupValuesField: props => { if(props.fieldId==='amount') amountProps=props; return h('section', {'data-field':props.fieldId}, renderLookupField(props)); } };
const view=()=>h(StrictMode,null,h('div',{onClick:()=>rowEvents++,onKeyDown:()=>rowEvents++}, h(AirtableForm,{scope,renderers},state=>state.fields.map(field=>field.node)),h('section',{'data-bound':true},h(LookupField,{binding}))));
root.render(view());
globalThis.lookupProof = {
    state: () => ({requests,writes,rowEvents,nativeUnchanged:before===JSON.stringify(fields.controller.getState()),amount:binding.getSnapshot().value}),
    retire: () => fields.destroy(),
    restore: () => flushSync(()=>root.render(view())),
    negative: index => {
      const badValues=[1,[[1]],new Array(1),[{linkedRecordId:'rec12345678901234',value:1}]];
      const props=index<4?{...amountProps,value:badValues[index]}:{...amountProps,field:{...amountProps.field,config:{...amountProps.field.config,options:{...amountProps.field.config.options,result:{type:'manualSort',options:null}}}}};
      flushSync(()=>root.render(renderLookupField(props)));
    },
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
        metafile: true,
    });
    await assertBrowserInputs(bundle.metafile, temporary);
    const bundleInputs = Object.keys(bundle.metafile.inputs).map((path) => ({
        path: relative(temporary, resolve(path)),
        sha256: createHash('sha256')
            .update(readFileSync(resolve(path)))
            .digest('hex'),
    }));
    const html =
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Read-only Lookup proof</title><style>body{font:16px system-ui;margin:24px;color:#182530}h1{font-size:24px}#root>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}section{border:1px solid #8996a0;border-radius:8px;padding:16px;min-width:0}label{font-weight:600}output{margin-top:8px;min-height:24px}output[aria-invalid=true]{outline:2px solid #b42318}</style><h1>Read-only Lookup presentation</h1><p>Synthetic accepted Form values, formatted without edits or resource loading.</p><main id="root"></main><script type="module" src="/main.js"></script>';
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
        executablePath: process.env.SDK_LOOKUP_CHROMIUM ?? '/usr/bin/chromium',
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
                    html.includes('PRIVATE_') ||
                    html.includes('private_source_link') ||
                    html.includes('private_source_field') ||
                    html.includes('private_target_table') ||
                    html.includes('rec12345678901234')
            ),
        false
    );
    await page.locator('[data-field="amount"] output').click();
    await page
        .locator('[data-field="amount"] output')
        .dispatchEvent('keydown', { key: 'Enter', bubbles: true });
    const initial = await page.evaluate(() => globalThis.lookupProof.state());
    assert.deepEqual(initial, {
        requests: 0,
        writes: 0,
        rowEvents: 0,
        nativeUnchanged: true,
        amount: [-1234.567],
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
    for (let index = 0; index < 5; index++) {
        await page.evaluate(
            (index) => globalThis.lookupProof.negative(index),
            index
        );
        assert.equal(await page.locator('output').textContent(), 'Unavailable');
        assert.equal(
            await page.locator('output').getAttribute('aria-invalid'),
            'true'
        );
    }
    assert.deepEqual(
        await page.evaluate(() => globalThis.lookupProof.state()),
        initial
    );
    await page.evaluate(() => globalThis.lookupProof.restore());
    await page.locator('[data-field="amount"] output').waitFor();
    await page.evaluate(() => globalThis.lookupProof.retire());
    await page.waitForFunction(() => document.querySelector('output') === null);
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    Object.assign(receipt, {
        status: 'passed',
        packageSha256: createHash('sha256')
            .update(readFileSync(tarball))
            .digest('hex'),
        browser: browser.version(),
        sandbox: true,
        cases: expected.length + 1 + 5,
        nativeCases: expected.length + 1,
        negativeCases: 5,
        source: (() => {
            const [commit, tree] = execFileSync(
                'git',
                ['rev-parse', 'HEAD', 'HEAD^{tree}'],
                { encoding: 'utf8' }
            )
                .trim()
                .split('\n');
            return { commit, tree };
        })(),
        bundleInputs,
        initial,
        retired: true,
        externalRequests: external,
        errors,
        screenshots: ['desktop.png', 'mobile.png', 'forced-colors.png'],
    });
} catch (error) {
    primaryFailure = { error };
    receipt.status = 'failed';
    receipt.error = error instanceof Error ? error.stack : String(error);
} finally {
    const cleanupErrors = [];
    for (const [name, acquired, cleanup] of [
        ['browser', Boolean(browser), () => browser.close()],
        [
            'server',
            Boolean(server),
            () =>
                new Promise((resolve, reject) =>
                    server.close((error) => (error ? reject(error) : resolve()))
                ),
        ],
        [
            'consumer',
            true,
            () => rmSync(temporary, { recursive: true, force: true }),
        ],
    ]) {
        if (!acquired) {
            receipt.cleanup[name] = 'not-acquired';
            continue;
        }
        try {
            await cleanup();
            receipt.cleanup[name] = 'completed';
        } catch (error) {
            receipt.cleanup[name] = 'failed';
            cleanupErrors.push(error);
        }
    }
    if (cleanupErrors.length) receipt.status = 'failed';
    writeFileSync(
        join(output, 'receipt.json'),
        JSON.stringify(receipt, null, 2) + '\n'
    );
    if (cleanupErrors.length)
        throw new AggregateError(
            [
                ...(primaryFailure ? [primaryFailure.error] : []),
                ...cleanupErrors,
            ],
            'Lookup proof cleanup failed'
        );
    if (primaryFailure) throw primaryFailure.error;
}
console.log(JSON.stringify(receipt, null, 2));
