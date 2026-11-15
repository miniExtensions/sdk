// Local packed-package proof with synthetic data; no backend or publication.
// node scripts/check-formula-browser.mjs /path/to/sdk.tgz [evidence-directory]
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
import { formulaLoadedFixture } from './formula-consumer-checks.mjs';

assert(process.argv[2], 'Pass the tested SDK tarball');
const tarball = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? 'dist/formula-browser');
const reactVersion = process.env.SDK_FORMULA_REACT_VERSION ?? '18.3.1';
assert(
    ['18.3.1', '19.2.0'].includes(reactVersion),
    'Use a supported Formula React version'
);
const temporary = mkdtempSync(join(tmpdir(), 'sdk-formula-browser-'));
mkdirSync(output, { recursive: true });
let browser, server;
let releaseLateMedia = () => {};
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
            `react@${reactVersion}`,
            `react-dom@${reactVersion}`,
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
    const { loaded, expected } = formulaLoadedFixture();
    writeFileSync(
        join(temporary, 'main.js'),
        `
import { createElement as h, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createFormFieldBindings } from '@miniextensions/sdk/forms';
import { createFormRenderScope } from '@miniextensions/sdk/ui';
import { AirtableForm, FormulaField, renderFormulaField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/readonly-url-gallery.css';
import '@miniextensions/sdk/react/attachment-preview.css';
import '@miniextensions/sdk/react/complete-readonly-text.css';
import '@miniextensions/sdk/react/single-line-text.css';
import '@miniextensions/sdk/react/single-select.css';
import '@miniextensions/sdk/react/controlled-select.css';
import '@miniextensions/sdk/react/html-description.css';
const loaded = ${JSON.stringify(loaded)};
let requests = 0, writes = 0, rowEvents = 0;
const fields = createFormFieldBindings({ loaded, client: { getSession: () => ({}), forms: { save: async () => { requests++; throw Error('No Formula Save'); } } }, getScope: () => ({ownerId:'formula-browser',revision:0}), saveOptions: {captchaVal:null,isComputeMode:false,context:{type:'direct-url'},searchQuery:{},conditionalLinkedRecordFieldIdsToFilteringValues:{}} });
const before = JSON.stringify(fields.controller.getState());
const binding = fields.field('amount');
binding.setValue = () => { writes++; throw Error('No Formula setter'); };
const scope = createFormRenderScope({ fields, isCurrent: () => true, configurationRevision: () => 0 });
const root = createRoot(document.getElementById('root'));
const renderers = { renderFormulaField: props => h('section', {'data-field':props.fieldId}, renderFormulaField(props)) };
root.render(h(StrictMode,null,h('div',{onClick:()=>rowEvents++,onKeyDown:()=>rowEvents++}, h(AirtableForm,{scope,renderers},state=>state.fields.map(field=>field.node)),h('section',{'data-bound':true},h(FormulaField,{binding})))));
globalThis.formulaProof = {
    state: () => ({requests,writes,rowEvents,nativeUnchanged:before===JSON.stringify(fields.controller.getState()),amount:binding.getSnapshot().value}),
    retire: () => fields.destroy(),
};
const controlledRoot=createRoot(document.getElementById('controlled'));
let controlledSubmits=0;
let controlled={mode:'controlled',isValid:true,resultType:'singleLineText',language:'en',value:'literal',formattedValue:'literal',inputId:'controlled-answer',ariaLabel:'Computed answer',describedBy:'formula-help'};
globalThis.controlledFormulaProof={
  render: next=>{controlled={...controlled,...next};controlledRoot.render(h(StrictMode,null,h('form',{onSubmit:event=>{event.preventDefault();controlledSubmits++;}},h('label',{htmlFor:'sibling-draft'},'Sibling draft'),h('input',{id:'sibling-draft',defaultValue:'kept draft'}),h('p',{id:'formula-help'},'Formula help'),h(FormulaField,controlled))));},
  state:()=>({submits:controlledSubmits,sibling:document.getElementById('sibling-draft')?.value,legacy:globalThis.formulaProof.state()}),
  unmount:()=>controlledRoot.unmount(),
};
`
    );
    const bundle = await build({
        entryPoints: [join(temporary, 'main.js')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outfile: join(temporary, 'bundle.js'),
        write: false,
    });
    const javascript = bundle.outputFiles.find((file) =>
        file.path.endsWith('.js')
    );
    const stylesheet = bundle.outputFiles.find((file) =>
        file.path.endsWith('.css')
    );
    assert(
        javascript && stylesheet,
        'Controlled Formula ships its public styles'
    );
    const image =
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="seagreen"/></svg>';
    const pendingMedia = [];
    let mediaReleased = false;
    let markLateMediaSeen;
    const lateMediaSeen = new Promise((done) => {
        markLateMediaSeen = done;
    });
    releaseLateMedia = () => {
        mediaReleased = true;
        for (const response of pendingMedia.splice(0)) {
            if (!response.destroyed && !response.writableEnded)
                response.end(image);
        }
    };
    const html =
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Read-only Formula proof</title><link rel="stylesheet" href="/styles.css"><style>body{font:16px system-ui;margin:24px;color:#182530}h1{font-size:24px}#root>div{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px}section{border:1px solid #8996a0;border-radius:8px;padding:16px;min-width:0}label{font-weight:600}output{margin-top:8px;min-height:24px}output[aria-invalid=true]{outline:2px solid #b42318}</style><h1>Read-only Formula presentation</h1><p>Synthetic accepted Form values, formatted without edits or resource loading.</p><main id="root"></main><main id="controlled"></main><script type="module" src="/main.js"></script>';
    server = createServer((request, response) => {
        if (request.url === '/main.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(javascript.contents);
        } else if (request.url === '/styles.css') {
            response.setHeader('Content-Type', 'text/css');
            response.end(stylesheet.contents);
        } else if (
            ['/first.svg', '/other.svg', '/last.svg', '/late.svg'].includes(
                request.url
            )
        ) {
            response.setHeader('Content-Type', 'image/svg+xml');
            response.setHeader('Content-Length', Buffer.byteLength(image));
            if (request.url === '/late.svg' && !mediaReleased) {
                pendingMedia.push(response);
                markLateMediaSeen();
            } else response.end(image);
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
        executablePath: process.env.SDK_FORMULA_CHROMIUM ?? '/usr/bin/chromium',
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
    const initial = await page.evaluate(() => globalThis.formulaProof.state());
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
    await page.evaluate(() => globalThis.formulaProof.retire());
    await page.waitForFunction(() => document.querySelector('output') === null);
    const retiredState = await page.evaluate(() =>
        globalThis.formulaProof.state()
    );
    assert.equal(retiredState.requests, 0);
    assert.equal(retiredState.writes, 0);
    // The original inert binding proof above remains separate and unchanged.
    // Controlled modes now exercise the actual public field and media leaf.
    await page.emulateMedia({ forcedColors: 'none' });
    await page.setViewportSize({ width: 1180, height: 1000 });
    const renderControlled = async (props) => {
        await page.evaluate(
            (next) => globalThis.controlledFormulaProof.render(next),
            props
        );
    };
    const answer = page.locator('#controlled .mx-sdk-controlled-formula');
    await renderControlled({
        value: '<strong>Literal result</strong>',
        formattedValue: '<strong>Literal result</strong>',
    });
    await answer
        .getByText('<strong>Literal result</strong>', { exact: true })
        .waitFor();
    assert.equal(await answer.locator('strong').count(), 0);
    await renderControlled({
        value: '<strong>Sanitized result</strong><script>globalThis.formulaUnsafe=true</script>',
        renderFormulaAsHTML: true,
        renderFormulaAsAttachment: true,
        displayAsButton: true,
        heightForFormulaFieldHTML: 123,
        gallery: { entries: [{ url: origin + '/first.svg' }] },
    });
    await answer
        .locator('strong')
        .getByText('Sanitized result', { exact: true })
        .waitFor();
    assert.equal(await answer.locator('script,.mx-sdk-url-gallery').count(), 0);
    assert.equal(
        await page.evaluate(() => globalThis.formulaUnsafe),
        undefined
    );
    assert.equal(
        await answer
            .locator('strong')
            .evaluate((element) => element.parentElement.style.height),
        '123px'
    );
    await renderControlled({
        resultType: 'singleSelect',
        value: 'Ready',
        select: {
            choices: [{ id: 'Ready', name: 'Ready', color: 'greenLight2' }],
            isInGrid: true,
        },
    });
    await answer.getByText('Ready', { exact: true }).waitFor();
    assert.equal(
        await answer.locator('strong,.mx-sdk-url-gallery,input').count(),
        0
    );
    const first = {
        url: origin + '/first.svg',
        type: 'image/svg+xml',
        filename: 'First',
    };
    const other = {
        url: origin + '/other.svg',
        type: 'image/svg+xml',
        filename: 'Other',
    };
    const duplicate = { ...first, filename: 'First repeated.svg' };
    const last = {
        url: origin + '/last.svg',
        type: 'image/svg+xml',
        filename: 'Last',
    };
    const gallery = {
        entries: [first, other, duplicate, last],
        hideAttachmentName: false,
        thumbnailSize: 'small',
        thumbFitType: 'contain',
        labels: {
            attachments: 'Formula files',
            close: 'Close files',
            next: 'Next file',
            previous: 'Previous file',
            download: 'Download file',
            open: 'Open file',
            selectAttachment: 'Select file',
            empty: 'No formula files',
        },
    };
    await renderControlled({
        resultType: 'singleLineText',
        value: 'admitted formula URLs',
        renderFormulaAsHTML: false,
        gallery,
    });
    await answer
        .getByRole('button', { name: first.url, exact: true })
        .nth(1)
        .click();
    assert.equal(
        await answer
            .locator('.mx-sdk-url-gallery__entries img')
            .first()
            .evaluate((element) => getComputedStyle(element).objectFit),
        'contain'
    );
    const dialog = page.getByRole('dialog', { name: 'Formula files' });
    await dialog.waitFor();
    await dialog.getByText('3 / 4', { exact: true }).waitFor();
    await dialog
        .locator('.mx-sdk-url-gallery__filename')
        .getByText('First repeated.svg', { exact: true })
        .waitFor();
    assert.equal(
        await dialog
            .locator('.mx-sdk-url-gallery__preview img')
            .evaluate(async (element) => {
                await element.decode();
                return element.complete && element.naturalWidth > 0;
            }),
        true
    );
    const popupPromise = page.waitForEvent('popup');
    await dialog.getByRole('link', { name: 'Open file', exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.equal(popup.url(), first.url);
    await popup.close();
    const downloadPromise = page.waitForEvent('download');
    await dialog
        .getByRole('button', { name: 'Download file', exact: true })
        .click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), duplicate.filename);
    assert.equal(await download.failure(), null);
    assert.equal(readFileSync(await download.path(), 'utf8'), image);
    await download.delete();
    await dialog
        .getByRole('button', { name: 'Next file', exact: true })
        .click();
    await dialog.getByText('4 / 4', { exact: true }).waitFor();
    await dialog
        .getByRole('button', { name: 'Previous file', exact: true })
        .click();
    await dialog.getByText('3 / 4', { exact: true }).waitFor();
    await renderControlled({
        gallery: { ...gallery, entries: [other, first, duplicate] },
    });
    await dialog.getByText('3 / 3', { exact: true }).waitFor();
    await dialog
        .locator('.mx-sdk-url-gallery__filename')
        .getByText('First repeated.svg', { exact: true })
        .waitFor();
    await renderControlled({ gallery: { ...gallery, entries: [first] } });
    await dialog.getByText('1 / 1', { exact: true }).waitFor();
    await renderControlled({
        gallery: {
            ...gallery,
            entries: [first],
            disableOpenFiles: true,
            disableDownloadFiles: true,
            hideAttachmentName: true,
            isInGrid: true,
            thumbnailSize: 'medium',
            thumbFitType: 'cover',
        },
    });
    await page.waitForFunction(
        () =>
            document
                .querySelector('.mx-sdk-url-gallery')
                ?.getAttribute('data-grid') === 'true'
    );
    assert.equal(
        await dialog
            .getByRole('link', { name: 'Open file', exact: true })
            .count(),
        0
    );
    assert.equal(
        await dialog
            .getByRole('button', { name: 'Download file', exact: true })
            .count(),
        0
    );
    assert.equal(
        await answer
            .locator(
                '.mx-sdk-url-gallery__entries button,.mx-sdk-url-gallery__name'
            )
            .count(),
        0
    );
    assert.equal(
        await answer.locator('.mx-sdk-url-gallery').getAttribute('data-size'),
        'medium'
    );
    assert.equal(
        await answer.locator('.mx-sdk-url-gallery').getAttribute('data-fit'),
        'cover'
    );
    await renderControlled({ gallery: { ...gallery, entries: [] } });
    await answer.getByText('No formula files', { exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    await renderControlled({ gallery: { ...gallery, entries: [last] } });
    await answer.getByRole('button', { name: last.url, exact: true }).waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    // Hold a real image response across replacement through AttachmentPreview.
    const late = {
        url: origin + '/late.svg',
        type: 'image/svg+xml',
        filename: 'Late image',
    };
    await renderControlled({ gallery: { ...gallery, entries: [late] } });
    await answer.getByRole('button', { name: late.url, exact: true }).click();
    await dialog.waitFor();
    await lateMediaSeen;
    await renderControlled({ gallery: { ...gallery, entries: [last] } });
    await dialog
        .locator('.mx-sdk-url-gallery__filename')
        .getByText('Last', { exact: true })
        .waitFor();
    await dialog
        .locator('.mx-sdk-url-gallery__preview img')
        .evaluate((element) => element.decode());
    releaseLateMedia();
    assert.equal(
        await dialog
            .locator('.mx-sdk-url-gallery__preview img')
            .getAttribute('src'),
        last.url
    );
    assert.equal(await dialog.locator(`img[src="${late.url}"]`).count(), 0);
    await dialog
        .getByRole('button', { name: 'Close files', exact: true })
        .click();
    await answer.getByRole('button', { name: last.url, exact: true }).click();
    await dialog.waitFor();
    await dialog
        .getByRole('button', { name: 'Close files', exact: true })
        .click();
    assert.equal(await dialog.count(), 0);
    await answer.getByRole('button', { name: last.url, exact: true }).click();
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    await screenshot('controlled-desktop.png');
    await page.setViewportSize({ width: 375, height: 900 });
    await screenshot('controlled-mobile.png');
    await renderControlled({
        renderFormulaAsAttachment: false,
        displayAsButton: true,
        value: origin + '/last.svg',
        validUrlButtonLabel: 'Open computed link',
    });
    await answer
        .getByRole('link', { name: 'Open computed link', exact: true })
        .waitFor();
    await renderControlled({
        value: null,
        invalidUrlButtonLabel: 'Computed link unavailable',
    });
    await answer
        .getByRole('button', { name: 'Computed link unavailable', exact: true })
        .waitFor();
    assert.equal(await answer.locator('a').count(), 0);
    await renderControlled({
        value: 'PRIVATE_CONTROLLED_FORMULA',
        formattedValue: 'PRIVATE_CONTROLLED_FORMULA',
        obscurePassword: true,
        renderFormulaAsHTML: true,
        renderFormulaAsAttachment: true,
    });
    await answer.getByText('••••••••', { exact: true }).waitFor();
    assert.equal(
        (await answer.innerHTML()).includes('PRIVATE_CONTROLLED_FORMULA'),
        false
    );
    const controlled = await page.evaluate(() =>
        globalThis.controlledFormulaProof.state()
    );
    assert.equal(controlled.submits, 0);
    assert.equal(controlled.sibling, 'kept draft');
    assert.deepEqual(controlled.legacy, retiredState);
    await page.evaluate(() => globalThis.controlledFormulaProof.unmount());
    assert.equal(await page.locator('#controlled').innerHTML(), '');
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
    const receipt = {
        packageSha256: createHash('sha256')
            .update(readFileSync(tarball))
            .digest('hex'),
        browser: browser.version(),
        sandbox: true,
        reactVersion,
        cases: expected.length + 1,
        initial,
        retired: true,
        controlled,
        controlledCases: [
            'literal',
            'sanitized HTML precedence',
            'effective Select precedence',
            'ordered duplicate selection',
            'open',
            'download',
            'previous/next',
            'reorder',
            'shrink',
            'current options',
            'empty closes',
            'refill stays closed',
            'late image retirement',
            'Close',
            'Escape',
            'URL button',
            'masking',
            'sibling draft',
            'zero submit',
        ],
        externalRequests: external,
        errors,
        screenshots: [
            'desktop.png',
            'mobile.png',
            'forced-colors.png',
            'controlled-desktop.png',
            'controlled-mobile.png',
        ],
    };
    writeFileSync(
        join(output, 'receipt.json'),
        JSON.stringify(receipt, null, 2) + '\n'
    );
    console.log(JSON.stringify(receipt, null, 2));
} finally {
    releaseLateMedia();
    await browser?.close();
    if (server) await new Promise((done) => server.close(done));
    rmSync(temporary, { recursive: true, force: true });
}
