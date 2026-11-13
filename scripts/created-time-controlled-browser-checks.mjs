import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

function fixtureSource(field = 'createdTime') {
    const loaded = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    loaded.payload.fieldIdsInForm = ['created', 'neighbor'];
    loaded.payload.formRecord.data.created = '2024-11-03T01:30:00.120-07:00';
    loaded.payload.formRecord.data.neighbor = 'Neighbor draft';
    loaded.payload.fieldIdsToSchemas.created = {
        fieldType: 'createdTime',
        airtableField: {
            id: 'created',
            name: 'Bound Created time',
            description: null,
            isPrimaryField: false,
            isComputed: true,
            config: {
                type: 'createdTime',
                options: {
                    result: {
                        type: 'dateTime',
                        options: {
                            dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                            timeFormat: { name: '24hour', format: 'HH:mm' },
                            timeZone: 'UTC',
                        },
                    },
                },
            },
        },
        miniExtConfig: {},
    };
    loaded.payload.fieldIdsToSchemas.neighbor = {
        fieldType: 'singleLineText',
        airtableField: {
            id: 'neighbor',
            name: 'Neighbor',
            description: null,
            isPrimaryField: false,
            isComputed: false,
            config: { type: 'singleLineText', options: null },
        },
        miniExtConfig: {},
    };
    if (field === 'lastModifiedTime') {
        const schema = loaded.payload.fieldIdsToSchemas.created;
        schema.fieldType = 'lastModifiedTime';
        schema.airtableField.config.type = 'lastModifiedTime';
        schema.airtableField.config.options.isValid = true;
    }
    return `
import React,{createElement as h,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {${field === 'createdTime' ? 'CreatedTimeField,BindingCreatedTimeField' : 'LastModifiedTimeField as CreatedTimeField,BindingLastModifiedTimeField as BindingCreatedTimeField'},TextField} from '@miniextensions/sdk/react';
import {createFormFieldBindings} from '@miniextensions/sdk/forms';
let requests=0,writes=0,submits=0,change,observed;
const downloadIntents=[];
new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node instanceof HTMLAnchorElement&&node.hasAttribute('download'))downloadIntents.push(node.getAttribute('download'));}).observe(document,{childList:true,subtree:true});
const fields=createFormFieldBindings({loaded:${JSON.stringify(loaded)},client:{getSession:()=>({}),forms:{save:async()=>{requests++;throw Error('No Save');}}},getScope:()=>({ownerId:'browser-created',revision:0}),saveOptions:{captchaVal:null,isComputeMode:false,context:{type:'direct-url'},searchQuery:{},conditionalLinkedRecordFieldIdsToFilteringValues:{}}});
const binding=fields.field('created');binding.setValue=()=>{writes++;throw Error('No Created-time writer');};
const neighbor=fields.field('neighbor');
const dateConfig={type:'dateTime',options:{dateFormat:{format:'YYYY-MM-DD'},timeFormat:{format:'HH:mm'},timeZone:'America/New_York'}};
function App(){
 const [state,setState]=useState({mode:'text',value:'2026-11-12T12:30:00Z',identity:'a',current:true,mounted:true,far:false});
 const latest=useRef(state);useLayoutEffect(()=>{latest.current=state;});observed=state;change=patch=>setState(old=>({...old,...patch}));
 const token=useRef({}).current;
 const owner={token,isCurrent:()=>state.current&&latest.current.current};
 const action=(label,patch)=>h('button',{type:'button',onClick:()=>change(patch)},label);
 const options={disableDownloadFiles:false,displayMode:state.mode==='icon'?'icon':'thumbnail'};
 const props={value:state.value,${field === 'createdTime' ? 'dateConfig:state.dateConfig??dateConfig' : "fieldConfig:{type:'lastModifiedTime',options:{isValid:state.isValid??true,result:state.dateConfig??dateConfig}}"},language:state.language??'en',dateLanguage:state.dateLanguage,owner,identity:state.identity,displayContext:state.mode==='editable'?'editable':'readonly',displayAsAttachments:['attachment','icon','inert'].includes(state.mode),displayAsButton:['attachment','button','editable'].includes(state.mode),buttonLabel:'Open supplied URL',inert:state.mode==='inert',attachmentOptions:options,presentation:{association:{kind:'group',controlId:'created-display',labelId:'created-title',descriptionId:'created-help',errorId:'created-error',formId:'native-form'},chromeOwner:'shell'}};
 return h('form',{id:'native-form',onSubmit:e=>{e.preventDefault();submits++;}},
  h('nav',{'aria-label':'Fixture controls'},action('Text',{mode:'text',value:'2026-11-12T12:30:00Z',far:false}),action('Attachment',{mode:'attachment',value:location.origin+'/image.jpg',far:false}),action('Offscreen attachment',{mode:'attachment',value:location.origin+'/offscreen.jpg',far:true}),action('Icon',{mode:'icon',value:location.origin+'/image.jpg',far:false}),action('Retry image',{mode:'attachment',value:location.origin+'/retry.jpg',far:false}),action('HTTP PDF',{mode:'attachment',value:location.origin+'/fixture.pdf',far:false}),action('URL button',{mode:'button',value:location.origin+'/a',far:false}),action('Replace URL',{value:location.origin+'/b',identity:'b'}),action('Restore URL',{mode:'button',value:location.origin+'/a',identity:'a'}),action('Inert',{mode:'inert',value:location.origin+'/image.jpg',far:false}),action('Retire',{current:false}),action('Remove',{mounted:false})),
  h('section',{className:'binding-natural'},h(CreatedTimeField,{binding})),h('section',{className:'binding-explicit'},h(BindingCreatedTimeField,{binding})),h(TextField,{binding:neighbor}),
  h('span',{id:'created-title'},'Created display'),h('p',{id:'created-help'},'Created help'),h('p',{id:'created-error'},'Created feedback'),
  h('div',{id:'display-container',style:{marginTop:state.far?'1800px':0}},state.mounted?h(CreatedTimeField,props):null),h('button',{type:'submit'},'Explicit Save'));
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.createdBrowser={snapshot:()=>({react:React.version,requests,writes,submits,downloadIntents:[...downloadIntents],value:binding.getSnapshot().value,neighbor:neighbor.getSnapshot().value,state:observed}),change:patch=>change(patch),destroy:()=>fields.destroy()};
`;
}

export async function prepareCreatedTimeBrowser(
    consumer,
    field = 'createdTime'
) {
    const root = realpathSync(consumer);
    const temporary = mkdtempSync(join(root, '.created-time-browser-'));
    try {
        const entry = join(temporary, 'host.mjs');
        writeFileSync(entry, fixtureSource(field));
        const result = await build({
            absWorkingDir: root,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(result.metafile, root);
        for (const name of [
            field === 'createdTime'
                ? 'CreatedTimeField.js'
                : 'LastModifiedTimeField.js',
            'ComputedTimeDisplay.js',
            'CreatedTimeResource.js',
        ])
            assert(
                Object.keys(result.metafile.inputs).some((path) =>
                    path.endsWith('/react/' + name)
                )
            );
        assert.equal(
            Object.keys(result.metafile.inputs).filter((path) =>
                /(?:^|\/)node_modules\/react\/index\.js$/.test(path)
            ).length,
            1
        );
        const installed = join(root, 'node_modules/@miniextensions/sdk');
        const styleNames = [
            'datetime',
            'text',
            'complete-readonly-text',
            'button',
            'html-description',
            'field-presentation',
        ];
        const styleEntry = join(temporary, 'styles.css');
        writeFileSync(
            styleEntry,
            styleNames
                .map(
                    (name) =>
                        `@import '${join(installed, `dist/esm/react/${name}.css`)}';`
                )
                .join('\n')
        );
        const styleBuild = await build({
            absWorkingDir: root,
            entryPoints: [styleEntry],
            bundle: true,
            write: false,
            metafile: true,
        });
        const styleRoot = realpathSync(join(installed, 'dist/esm/react')) + '/';
        for (const name of Object.keys(styleBuild.metafile.inputs))
            assert(
                (realpathSync(resolve(root, name)) ===
                    realpathSync(styleEntry) ||
                    realpathSync(resolve(root, name)).startsWith(styleRoot)) &&
                    name.endsWith('.css'),
                'Fixture styles must come from installed SDK CSS'
            );
        for (const output of Object.values(styleBuild.metafile.outputs))
            assert.deepEqual(
                output.imports,
                [],
                'Fixture styles cannot load external or unserved resources'
            );
        const css = Buffer.concat([
            styleBuild.outputFiles[0].contents,
            Buffer.from(
                '\nbody{font:16px system-ui;margin:20px}main{max-width:540px}button,a{margin:4px}nav{display:flex;flex-wrap:wrap;gap:4px}section{margin:12px 0}#display-container{width:300px}form>label{display:block}'
            ),
        ]);
        const script = result.outputFiles[0].contents;
        const hash = (bytes) =>
            createHash('sha256').update(bytes).digest('hex');
        return {
            assets: new Map([
                [
                    '/',
                    Buffer.from(
                        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/created.css"><main></main><script type="module" src="/created.js"></script></html>'
                    ),
                ],
                ['/created.js', script],
                ['/created.css', css],
            ]),
            receipt: {
                scriptSha256: hash(script),
                cssSha256: hash(css),
                styleInputs: Object.keys(styleBuild.metafile.inputs)
                    .filter((path) =>
                        realpathSync(resolve(root, path)).startsWith(styleRoot)
                    )
                    .map((path) => ({
                        path: path.slice(path.indexOf('/sdk/dist/') + 5),
                        sha256: hash(readFileSync(resolve(root, path))),
                    })),
                inputs: Object.keys(result.metafile.inputs)
                    .filter((path) => path.includes('/sdk/dist/'))
                    .map((path) => ({
                        path: path.slice(path.indexOf('/sdk/dist/') + 5),
                        sha256: hash(readFileSync(resolve(root, path))),
                    })),
            },
        };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

/** Actual installed public fields, trusted native Chromium actions and local resources. */
export async function checkCreatedTimeControlledBrowser({
    browser,
    consumer,
    evidence,
    output,
    field = 'createdTime',
}) {
    Object.assign(evidence, {
        status: 'running',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        resources: [],
        cleanup: {},
    });
    let server, context, page, failure;
    try {
        const prepared = await prepareCreatedTimeBrowser(consumer, field);
        evidence.package = prepared.receipt;
        let retries = 0;
        const image = Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="green"/></svg>'
        );
        server = createServer((request, response) => {
            const pathname = new URL(request.url, 'http://localhost').pathname;
            if (
                ['/image.jpg', '/offscreen.jpg', '/retry.jpg'].includes(
                    pathname
                )
            ) {
                evidence.resources.push({
                    path: pathname,
                    method: request.method,
                });
                if (pathname === '/retry.jpg' && retries++ === 0) {
                    response.writeHead(404);
                    response.end();
                    return;
                }
                response.setHeader('Content-Type', 'image/svg+xml');
                response.end(image);
                return;
            }
            const bytes = prepared.assets.get(pathname);
            if (!bytes || request.method !== 'GET') {
                response.writeHead(404);
                response.end();
                return;
            }
            response.setHeader(
                'Content-Type',
                pathname.endsWith('.js')
                    ? 'application/javascript'
                    : pathname.endsWith('.css')
                      ? 'text/css'
                      : 'text/html'
            );
            response.end(bytes);
        });
        await new Promise((done, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', done);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
            viewport: { width: 900, height: 900 },
            acceptDownloads: true,
        });
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (
                url.origin === origin &&
                [
                    '/',
                    '/created.js',
                    '/created.css',
                    '/image.jpg',
                    '/offscreen.jpg',
                    '/retry.jpg',
                ].includes(url.pathname)
            )
                return route.continue();
            evidence.unexpectedRequests.push(url.origin + url.pathname);
            return route.abort();
        });
        page = await context.newPage();
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        const snapshot = () =>
            page.evaluate(() => window.createdBrowser.snapshot());
        const click = (label) =>
            page.getByRole('button', { name: label, exact: true }).click();
        const display = () => page.locator('#created-display');
        const finish = async (name) => {
            const s = await snapshot();
            assert.equal(s.value, '2024-11-03T01:30:00.120-07:00');
            assert.equal(s.writes, 0);
            assert.equal(s.requests, 0);
            assert.equal(s.submits, 0);
            evidence.results.push(name);
        };
        await page.goto(origin);
        await display().waitFor();
        assert.match(await display().innerText(), /2026-11-12 07:30/);
        assert.equal(
            await display().getAttribute('aria-labelledby'),
            'created-title'
        );
        assert.equal(
            await display().getAttribute('aria-describedby'),
            'created-error created-help'
        );
        for (const selector of [
            '.binding-natural input',
            '.binding-explicit input',
        ]) {
            assert.equal(
                await page.locator(selector).inputValue(),
                '2024-11-03T01:30:00.120-07:00'
            );
            assert.equal(await page.locator(selector).isDisabled(), true);
        }
        await page
            .getByRole('textbox', { name: 'Neighbor', exact: true })
            .fill('Independent neighbor');
        assert.equal((await snapshot()).neighbor, 'Independent neighbor');
        if (field === 'lastModifiedTime') {
            await page.evaluate(() =>
                window.createdBrowser.change({ isValid: false })
            );
            await page.waitForFunction(() =>
                document
                    .querySelector('#created-display')
                    ?.textContent.includes('No Value')
            );
            await page.evaluate(() =>
                window.createdBrowser.change({
                    isValid: true,
                    dateConfig: {
                        type: 'date',
                        options: { dateFormat: { format: 'YYYY-MM-DD' } },
                    },
                    value: '2026-11-13',
                })
            );
            await page.waitForFunction(() =>
                document
                    .querySelector('#created-display')
                    ?.textContent.includes('2026-11-13')
            );
            await page.evaluate(() =>
                window.createdBrowser.change({ value: '2026-11-12T12:30:00Z' })
            );
        }
        const localeProps = {
            language: 'fr',
            dateLanguage: 'en',
            dateConfig: {
                type: 'dateTime',
                options: {
                    dateFormat: { format: 'dddd D MMMM YYYY' },
                    timeFormat: { format: 'HH:mm' },
                    timeZone: 'America/New_York',
                },
            },
        };
        await page.evaluate(
            (patch) => window.createdBrowser.change(patch),
            localeProps
        );
        await page.waitForFunction(() =>
            document
                .querySelector('#created-display')
                ?.textContent.includes('Thursday 12 November 2026 07:30')
        );
        await page.evaluate(() =>
            window.createdBrowser.change({ value: null })
        );
        await page.waitForFunction(() =>
            document
                .querySelector('#created-display')
                ?.textContent.includes('Pas de Valeur')
        );
        await page.evaluate(() =>
            window.createdBrowser.change({
                value: '2026-11-12T12:30:00Z',
                dateLanguage: undefined,
            })
        );
        await page.waitForFunction(
            (expected) =>
                document
                    .querySelector('#created-display')
                    ?.textContent.includes(expected),
            field === 'createdTime'
                ? 'jeudi 12 novembre 2026 07:30'
                : 'Thursday 12 November 2026 07:30'
        );
        await page.evaluate(() =>
            window.createdBrowser.change({ dateLanguage: 'en' })
        );
        await page.waitForFunction(() =>
            document
                .querySelector('#created-display')
                ?.textContent.includes('Thursday 12 November 2026 07:30')
        );
        await page.evaluate(() =>
            window.createdBrowser.change({
                language: 'en',
                dateLanguage: undefined,
                dateConfig: undefined,
            })
        );
        await page.waitForFunction(() =>
            document
                .querySelector('#created-display')
                ?.textContent.includes('2026-11-12 07:30')
        );
        await finish('public-binding-alias-controlled-text-and-sibling');
        await click('Offscreen attachment');
        assert.equal(await display().locator('img').count(), 0);
        assert.equal(
            evidence.resources.filter((r) => r.path === '/offscreen.jpg')
                .length,
            0
        );
        await display().scrollIntoViewIfNeeded();
        await display().locator('img').waitFor();
        await page.waitForFunction(
            () =>
                document.querySelector('#created-display img')?.naturalWidth > 0
        );
        assert(evidence.resources.some((r) => r.path === '/offscreen.jpg'));
        await page.screenshot({
            path: join(output, `${field}-visible.png`),
        });
        await finish('native-visibility-gated-image');
        const overlay = display().getByRole('button', {
            name: origin + '/offscreen.jpg',
            exact: true,
        });
        await overlay.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', {
            name: 'Attachments',
            exact: true,
        });
        await dialog.waitFor();
        assert.equal(await dialog.evaluate((node) => node.open), true);
        const download = page.waitForEvent('download');
        await dialog
            .getByRole('button', { name: 'Download', exact: true })
            .click();
        const completedDownload = await download;
        // Preserve the actual SDK/native download attribute; Chrome may add a
        // MIME-default extension to its suggested user-visible filename.
        assert.deepEqual((await snapshot()).downloadIntents, ['Unnamed']);
        assert.match(
            completedDownload.suggestedFilename(),
            /^Unnamed(?:\.txt)?$/
        );
        const downloaded = [];
        for await (const chunk of await completedDownload.createReadStream())
            downloaded.push(chunk);
        const downloadedBytes = Buffer.concat(downloaded);
        assert(downloadedBytes.equals(image));
        assert.equal(await page.locator('a[download]').count(), 0);
        evidence.download = {
            requestedName: 'Unnamed',
            suggestedFilename: completedDownload.suggestedFilename(),
            bytes: downloadedBytes.length,
            sha256: createHash('sha256').update(downloadedBytes).digest('hex'),
        };
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        assert.equal(
            await overlay.evaluate((node) => document.activeElement === node),
            true
        );
        await overlay.click();
        await dialog.waitFor();
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .click();
        await dialog.waitFor({ state: 'detached' });
        await finish(
            'native-dialog-keyboard-close-focus-and-explicit-download'
        );
        await page
            .getByRole('button', { name: 'Retry image', exact: true })
            .scrollIntoViewIfNeeded();
        await click('Retry image');
        await display()
            .getByRole('button', { name: 'Try again', exact: true })
            .waitFor();
        await display()
            .getByRole('button', { name: 'Try again', exact: true })
            .click();
        await page.waitForFunction(
            () =>
                document.querySelector('#created-display img')?.naturalWidth > 0
        );
        await finish('actual-image-failure-and-explicit-retry');
        await click('URL button');
        const held = await display().locator('a').elementHandle();
        assert(held);
        await click('Replace URL');
        assert.equal(await held.getAttribute('href'), null);
        await click('Restore URL');
        assert.equal(await held.getAttribute('href'), null);
        await held.dispose();
        assert.equal(
            await display().locator('a').getAttribute('href'),
            origin + '/a'
        );
        await finish('detached-link-url-identity-aba-retirement');
        await click('HTTP PDF');
        await display()
            .getByRole('button', { name: origin + '/fixture.pdf', exact: true })
            .click();
        await dialog.waitFor();
        assert.equal(await dialog.locator('iframe').count(), 0);
        assert.match(
            await dialog.innerText(),
            /Attachment preview is not available/
        );
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'detached' });
        await finish('http-pdf-retains-sdk-frame-policy');
        await click('Attachment');
        await page.setViewportSize({ width: 390, height: 844 });
        await display().scrollIntoViewIfNeeded();
        assert.equal(await display().isVisible(), true);
        await page.waitForFunction(
            () =>
                document.querySelector('#created-display img')?.naturalWidth > 0
        );
        assert(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth + 1
            )
        );
        await page.screenshot({
            path: join(output, `${field}-narrow.png`),
            fullPage: true,
        });
        await finish('narrow-layout-and-no-submit');
        await click('Inert');
        assert.equal(await display().locator('img,iframe,a').count(), 0);
        await click('Retire');
        assert.equal(await display().count(), 0);
        assert.equal((await snapshot()).neighbor, 'Independent neighbor');
        await finish('preview-inert-and-owner-retirement');
        assert.deepEqual(evidence.unexpectedRequests, []);
        assert.deepEqual(evidence.pageErrors, []);
        evidence.react = (await snapshot()).react;
        evidence.status = 'passed';
        evidence.scope =
            'Installed public binding/controlled fields with synthetic local images, native dialog and trusted keyboard/pointer. Generic document viewer, live providers and hosted native adoption remain outside this proof.';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page)
            try {
                await page.screenshot({
                    path: join(output, `${field}-failure.png`),
                    fullPage: true,
                });
            } catch (capture) {
                evidence.captureError = capture.message;
            }
    } finally {
        for (const [name, cleanup] of [
            ['context', () => context?.close()],
            [
                'server',
                () =>
                    new Promise((done, reject) => {
                        if (!server) return done();
                        server.closeAllConnections();
                        server.close((error) =>
                            error ? reject(error) : done()
                        );
                    }),
            ],
        ])
            try {
                await cleanup();
                evidence.cleanup[name] = 'closed';
            } catch (error) {
                evidence.cleanup[name] = error.message;
                failure ??= error;
            }
    }
    if (failure) throw failure;
}
