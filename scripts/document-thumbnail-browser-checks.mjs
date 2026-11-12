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
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import {
    assertDocumentAssets,
    documentAssetDirectory,
    documentPDFVersion,
} from './document-preview-assets.mjs';

const fixtures = JSON.parse(
    readFileSync(
        new URL('./fixtures/document-thumbnail.json', import.meta.url),
        'utf8'
    )
);
const assetPrefix = `/pdf-assets/pdfjs-${documentPDFVersion}/`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function hostSource(format) {
    return `
import React,{createElement as h,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
${format === 'cjs' ? "const {CreatedTimeField}=require('@miniextensions/sdk/react');" : "import {CreatedTimeField} from '@miniextensions/sdk/react';"}
const data=${JSON.stringify(fixtures)};
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const initialPromiseTry=Promise.try;
const nativePDFGlobals={api:Object.freeze({owner:'unrelated-pdf-api'}),testing:Object.freeze({owner:'unrelated-pdf-testing'}),worker:Object.freeze({WorkerMessageHandler:Object.freeze({owner:'unrelated-pdf-worker'})})};
globalThis.pdfjsLib=nativePDFGlobals.api;globalThis._pdfjsTestingUtils=nativePDFGlobals.testing;globalThis.pdfjsWorker=nativePDFGlobals.worker;
const made=[],revoked=[];const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=blob=>{const url=createURL(blob);made.push(url);return url;};URL.revokeObjectURL=url=>{revoked.push(url);revokeURL(url);};
let change,observed,submits=0,retainedImage;
function App(){
 const [state,setState]=useState({type:'text',uri:false,grid:false,disableOpen:true,disableDownload:false,revision:0,current:true,inert:false,far:false,mounted:true});
 const latest=useRef(state);useLayoutEffect(()=>{latest.current=state;});observed=state;change=patch=>setState(old=>({...old,...patch}));
 const token=useRef({}).current;const owner={token,isCurrent:()=>state.current&&latest.current.current};
 const kind=state.type==='modal'?'pdf':state.type==='deferred'?'text':state.type;
 const mime={text:'text/plain',csv:'text/csv',html:'text/html',tiff:'image/tiff',image:'image/png',pdf:'application/pdf',octet:'application/octet-stream'}[kind];
 const bytes=useMemo(()=>['tiff','image','pdf'].includes(kind)?decode(data[kind==='image'?'png':kind]):new TextEncoder().encode(state.revision?'Successor document':data[kind]??'unsupported'),[kind,state.revision]);
 const source=state.uri?{kind:'uri',revision:state.revision}:{kind:'bytes',mimeType:mime,bytes,revision:state.revision};
 const value=location.origin+'/documents/'+(state.type==='modal'?'known.pdf':state.type);
 const props={value,language:'en',dateConfig:{type:'dateTime',options:{dateFormat:{format:'YYYY-MM-DD'},timeFormat:{format:'HH:mm'},timeZone:'UTC'}},displayAsAttachments:true,owner,identity:'owned-document',inert:state.inert,attachmentOptions:{isInGrid:state.grid,disableOpenFiles:state.disableOpen,disableDownloadFiles:state.disableDownload,documentPreview:{source,pdfWorkerUrl:location.origin+(state.badWorker?'/missing-worker.mjs':'${assetPrefix}pdf.worker.mjs'),pdfResourceBaseUrl:location.origin+'${assetPrefix}'}},presentation:{association:{kind:'group',controlId:'document-display',labelId:'document-title',descriptionId:'document-help',formId:'document-form'},chromeOwner:'shell'}};
 const action=(name,patch)=>h('button',{type:'button',onClick:()=>change(patch)},name);
 return h('form',{id:'document-form',onSubmit:event=>{event.preventDefault();submits++;}},h('nav',null,
  action('Text',{type:'text',uri:false,grid:false,revision:0,far:false}),action('CSV',{type:'csv',uri:false,grid:false,far:false}),action('HTML',{type:'html',uri:false,grid:false,far:false}),action('TIFF',{type:'tiff',uri:false,grid:false,far:false}),action('Image',{type:'image',uri:false,grid:false,far:false}),action('Grid PDF',{type:'pdf',uri:false,grid:true,disableOpen:true,far:false}),action('Form PDF',{type:'pdf',uri:false,grid:false,disableOpen:true,far:false}),action('URI CSV',{type:'csv',uri:true,grid:false,far:false}),action('URI octet',{type:'octet',uri:true,grid:false,far:false}),action('Offscreen URI',{type:'deferred',uri:true,grid:false,far:true}),action('HTTP PDF modal',{type:'modal',uri:true,grid:false,disableOpen:false,far:false}),action('Allow Open',{disableOpen:false}),action('Refuse Download',{disableDownload:true}),action('New revision',{revision:1}),action('Inert',{inert:true}),action('Retire',{current:false}),action('Remove',{mounted:false})),
 h('label',{htmlFor:'neighbor'},'Neighbor'),h('input',{id:'neighbor',defaultValue:'neighbor draft'}),h('span',{id:'document-title'},'Created document'),h('p',{id:'document-help'},'Owned preview help'),
 h('div',{id:'document-host',style:{marginTop:state.far?'1800px':0,width:state.grid?'520px':'300px',height:state.grid?'420px':undefined}},state.mounted?h(CreatedTimeField,props):null),h('button',{type:'submit'},'Explicit Save'));
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.documentFixture={snapshot:()=>({react:React.version,submits,state:observed,made:[...made],revoked:[...revoked],promiseTryPreserved:Promise.try===initialPromiseTry,pdfGlobalsPreserved:globalThis.pdfjsLib===nativePDFGlobals.api&&globalThis._pdfjsTestingUtils===nativePDFGlobals.testing&&globalThis.pdfjsWorker===nativePDFGlobals.worker}),change:patch=>change(patch),rememberImage:()=>{retainedImage=document.querySelector('#document-host img');},oldImageSource:()=>retainedImage?.getAttribute('src')??null};
`;
}

export async function prepareDocumentThumbnailBrowser(consumer, format) {
    const root = realpathSync(consumer);
    const temporary = mkdtempSync(join(root, '.document-thumbnail-browser-'));
    try {
        const entry = join(temporary, 'host.mjs');
        writeFileSync(entry, hostSource(format));
        const bundled = await build({
            absWorkingDir: root,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundled.metafile, root);
        const paths = Object.keys(bundled.metafile.inputs);
        for (const name of [
            'CreatedTimeField.js',
            'CreatedTimeResource.js',
            'document-preview/DocumentThumbnail.js',
            'document-preview/DocumentPDF.js',
        ])
            assert(
                paths.some((path) =>
                    path.endsWith(`/dist/${format}/react/${name}`)
                )
            );
        assert.equal(
            paths.filter((path) =>
                /(?:^|\/)node_modules\/react\/index\.js$/.test(path)
            ).length,
            1
        );
        const installed = join(root, 'node_modules/@miniextensions/sdk');
        const receipt = assertDocumentAssets(installed);
        const manifest = JSON.parse(
            readFileSync(
                join(installed, documentAssetDirectory, 'asset-manifest.json'),
                'utf8'
            )
        );
        const assets = new Map(
            manifest.files.map((file) => [
                assetPrefix + file.path,
                readFileSync(
                    join(installed, documentAssetDirectory, file.path)
                ),
            ])
        );
        const css = Buffer.concat(
            [
                'button',
                'complete-readonly-text',
                'html-description',
                'field-presentation',
            ]
                .map((name) =>
                    readFileSync(join(installed, `dist/esm/react/${name}.css`))
                )
                .concat([
                    Buffer.from(
                        'body{font:16px system-ui;margin:20px}main{max-width:700px}nav{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}form>label,form>input{display:block;margin:8px 0}button{margin:2px}'
                    ),
                ])
        );
        const script = bundled.outputFiles[0].contents;
        assets.set(
            '/',
            Buffer.from(
                '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/documents.css"><main></main><script type="module" src="/documents.js"></script></html>'
            )
        );
        assets.set('/documents.js', script);
        assets.set('/documents.css', css);
        return {
            assets,
            receipt: {
                format,
                assets: receipt,
                scriptSha256: hash(script),
                cssSha256: hash(css),
                inputs: paths
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

/** Actual installed ESM and CJS fields, real browser worker/canvas and owned data. */
export async function checkDocumentThumbnailBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, { status: 'running', profiles: [], cleanup: {} });
    let failure;
    for (const format of ['esm', 'cjs']) {
        const profile = {
            format,
            results: [],
            pageErrors: [],
            unexpectedRequests: [],
            resources: [],
            workers: [],
            cleanup: {},
        };
        evidence.profiles.push(profile);
        let server, context, page;
        const alive = new Set();
        try {
            const prepared = await prepareDocumentThumbnailBrowser(
                consumer,
                format
            );
            profile.package = prepared.receipt;
            const documentTypes = {
                text: ['text/plain', Buffer.from(fixtures.text)],
                deferred: ['text/plain', Buffer.from(fixtures.text)],
                csv: ['text/csv', Buffer.from(fixtures.csv)],
                html: ['text/html', Buffer.from(fixtures.html)],
                tiff: ['image/tiff', Buffer.from(fixtures.tiff, 'base64')],
                image: ['image/png', Buffer.from(fixtures.png, 'base64')],
                pdf: ['application/pdf', Buffer.from(fixtures.pdf, 'base64')],
                'known.pdf': [
                    'application/pdf',
                    Buffer.from(fixtures.pdf, 'base64'),
                ],
                octet: [
                    'application/octet-stream',
                    Buffer.from('not a provider document'),
                ],
            };
            server = createServer((request, response) => {
                const path = new URL(request.url, 'http://localhost').pathname;
                if (
                    path === '/missing-worker.mjs' &&
                    request.method === 'GET'
                ) {
                    profile.resources.push({
                        path,
                        method: request.method,
                        cookie: request.headers.cookie ?? null,
                        status: 404,
                    });
                    response.writeHead(404, {
                        'Content-Type': 'application/javascript',
                        'Cache-Control': 'no-store',
                    });
                    response.end();
                    return;
                }
                const document = path.startsWith('/documents/')
                    ? documentTypes[path.slice('/documents/'.length)]
                    : null;
                const bytes = document?.[1] ?? prepared.assets.get(path);
                if (!bytes || !['GET', 'HEAD'].includes(request.method)) {
                    response.writeHead(404);
                    response.end();
                    return;
                }
                if (document || path.startsWith(assetPrefix))
                    profile.resources.push({
                        path,
                        method: request.method,
                        cookie: request.headers.cookie ?? null,
                    });
                response.setHeader('Cache-Control', 'no-store');
                response.setHeader(
                    'Content-Type',
                    document?.[0] ??
                        (path.endsWith('.mjs') || path.endsWith('.js')
                            ? 'application/javascript'
                            : path.endsWith('.css')
                              ? 'text/css'
                              : path.endsWith('.wasm')
                                ? 'application/wasm'
                                : path === '/'
                                  ? 'text/html'
                                  : 'application/octet-stream')
                );
                response.end(request.method === 'HEAD' ? undefined : bytes);
            });
            await new Promise((done, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', done);
            });
            const origin = `http://127.0.0.1:${server.address().port}`;
            context = await browser.newContext({
                viewport: { width: 1000, height: 900 },
                acceptDownloads: true,
            });
            await context.addCookies([
                {
                    name: 'owned-doc-cookie',
                    value: 'must-not-be-sent',
                    url: origin,
                },
            ]);
            await context.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (
                    url.origin === origin &&
                    (prepared.assets.has(url.pathname) ||
                        (url.pathname === '/missing-worker.mjs' &&
                            route.request().method() === 'GET') ||
                        (Object.hasOwn(
                            documentTypes,
                            url.pathname.slice('/documents/'.length)
                        ) &&
                            url.pathname.startsWith('/documents/')))
                )
                    return route.continue();
                profile.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            page = await context.newPage();
            page.on('pageerror', (error) =>
                profile.pageErrors.push(error.message)
            );
            page.on('worker', (worker) => {
                alive.add(worker);
                profile.workers.push(worker.url());
                worker.on('close', () => alive.delete(worker));
            });
            const click = (name) =>
                page.getByRole('button', { name, exact: true }).click();
            const display = () => page.locator('#document-host');
            const untilClosed = async () => {
                for (let i = 0; alive.size && i < 200; i++)
                    await new Promise((done) => setTimeout(done, 5));
                assert.equal(
                    alive.size,
                    0,
                    'Owned PDF worker must finish retirement'
                );
            };
            const finish = async (name) => {
                const snapshot = await page.evaluate(() =>
                    window.documentFixture.snapshot()
                );
                assert.equal(snapshot.submits, 0);
                assert.equal(snapshot.promiseTryPreserved, true);
                assert.equal(
                    snapshot.pdfGlobalsPreserved,
                    true,
                    'SDK previews must preserve unrelated PDF library globals'
                );
                assert.equal(
                    await page.locator('#neighbor').inputValue(),
                    'independent unsaved draft'
                );
                assert.deepEqual(profile.pageErrors, []);
                assert.deepEqual(profile.unexpectedRequests, []);
                profile.results.push(name);
            };
            await page.goto(origin);
            await page.locator('#neighbor').fill('independent unsaved draft');
            await page.waitForFunction(() =>
                document
                    .querySelector('#document-host')
                    ?.textContent.includes('A readonly document')
            );
            await finish('literal-text-and-sibling');
            await click('CSV');
            await display().locator('table').waitFor();
            assert.equal(await display().locator('td').count(), 4);
            assert.match(
                await display().innerText(),
                /<img src=x onerror=alert\(1\)>/
            );
            assert.equal(await display().locator('img,script').count(), 0);
            await finish('literal-csv-headers-and-cells');
            await click('HTML');
            await display().locator('h2').waitFor();
            assert.equal(
                await display()
                    .locator('script,iframe,img,form,input,style,[href],[src]')
                    .count(),
                0
            );
            await finish('sanitized-html-with-zero-embedded-loads');
            await click('TIFF');
            await display().locator('[data-rendered-tiff]').waitFor();
            assert.deepEqual(
                await display()
                    .locator('canvas')
                    .evaluate((canvas) =>
                        Array.from(
                            canvas.getContext('2d').getImageData(0, 0, 2, 1)
                                .data
                        )
                    ),
                [255, 0, 0, 255, 0, 0, 255, 255]
            );
            await finish('actual-tiff-pixels');
            await click('Image');
            await page.waitForFunction(
                () =>
                    document.querySelector('#document-host img')
                        ?.naturalWidth === 2
            );
            await page.evaluate(() => window.documentFixture.rememberImage());
            await click('Text');
            assert.equal(
                await page.evaluate(() =>
                    window.documentFixture.oldImageSource()
                ),
                null
            );
            await finish('opaque-image-and-detached-url-retirement');
            await click('URI CSV');
            await display().locator('table').waitFor();
            assert.deepEqual(
                profile.resources
                    .filter((r) => r.path === '/documents/csv')
                    .map((r) => r.method),
                ['HEAD', 'GET']
            );
            await finish('explicit-credential-free-uri-admission');
            await click('URI octet');
            await page.waitForFunction(() =>
                document
                    .querySelector('#document-host')
                    ?.textContent.includes('Document preview unavailable')
            );
            assert.deepEqual(
                profile.resources
                    .filter((r) => r.path === '/documents/octet')
                    .map((r) => r.method),
                ['HEAD']
            );
            await finish('unknown-mime-without-provider');
            await click('Offscreen URI');
            assert.equal(
                profile.resources.filter(
                    (r) => r.path === '/documents/deferred'
                ).length,
                0
            );
            await display().scrollIntoViewIfNeeded();
            await page.waitForFunction(() =>
                document
                    .querySelector('#document-host')
                    ?.textContent.includes('A readonly document')
            );
            await finish('actual-intersection-gated-document-load');
            await click('Grid PDF');
            await display().locator('[data-rendered-page="1"]').waitFor();
            const gridBounds = await display().evaluate((host) => {
                const viewport = host.querySelector(
                    '.mx-sdk-created-time-resource li > div'
                );
                const hostBox = host.getBoundingClientRect();
                const viewportBox = viewport.getBoundingClientRect();
                return {
                    hostBottom: hostBox.bottom,
                    viewportBottom: viewportBox.bottom,
                    hostRight: hostBox.right,
                    viewportRight: viewportBox.right,
                };
            });
            assert(
                gridBounds.viewportBottom <= gridBounds.hostBottom + 1,
                'Grid preview must fit its supplied height'
            );
            assert(
                gridBounds.viewportRight <= gridBounds.hostRight + 1,
                'Grid preview must fit its supplied width'
            );
            const saveBox = await page
                .getByRole('button', { name: 'Explicit Save', exact: true })
                .boundingBox();
            assert(
                saveBox.y >= gridBounds.viewportBottom - 1,
                'Grid preview cannot overlap its neighboring form action'
            );
            assert.deepEqual(
                await display()
                    .locator('canvas')
                    .evaluate((canvas) =>
                        Array.from(
                            canvas.getContext('2d').getImageData(5, 5, 1, 1)
                                .data
                        )
                    ),
                [255, 0, 0, 255]
            );
            await click('Next page');
            await display().locator('[data-rendered-page="2"]').waitFor();
            const initialWidth = await display()
                .locator('canvas')
                .evaluate((canvas) => canvas.width);
            await click('Zoom in');
            await page.waitForFunction(
                (width) =>
                    document.querySelector('#document-host canvas')?.width >
                    width,
                initialWidth
            );
            await click('Reset zoom');
            await click('Show all pages');
            await page.waitForFunction(
                () =>
                    document.querySelectorAll(
                        '#document-host [data-rendered-page]'
                    ).length === 2
            );
            await click('Show one page');
            const [download] = await Promise.all([
                page.waitForEvent('download'),
                click('Download'),
            ]);
            const stream = await download.createReadStream();
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            assert.equal(
                hash(Buffer.concat(chunks)),
                hash(Buffer.from(fixtures.pdf, 'base64'))
            );
            await click('Refuse Download');
            assert.equal(
                await display()
                    .getByRole('button', { name: 'Download', exact: true })
                    .count(),
                0
            );
            await finish(
                'actual-pdf-worker-canvas-controls-and-guarded-download'
            );
            await page.screenshot({
                path: join(output, `document-pdf-${format}.png`),
            });
            await click('Form PDF');
            await display().locator('[data-rendered-page="1"]').waitFor();
            assert.equal(
                await display().locator('[data-document-pdf-controls]').count(),
                0
            );
            await click('Allow Open');
            await display().locator('button[aria-label]').click();
            assert.match(
                await page.locator('dialog').innerText(),
                /preview is not available/
            );
            assert.equal(
                await page.locator('dialog canvas,dialog img').count(),
                0
            );
            await page
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await finish('form-pdf-controls-remain-hidden');
            await click('HTTP PDF modal');
            await untilClosed();
            assert.equal(
                profile.resources.filter(
                    (r) => r.path === '/documents/known.pdf'
                ).length,
                0
            );
            await display().locator('button[aria-label]').click();
            await page.locator('dialog [data-rendered-page="2"]').waitFor();
            assert.equal(await page.locator('dialog iframe').count(), 0);
            await page
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await untilClosed();
            await finish(
                'known-http-pdf-modal-without-iframe-policy-exception'
            );
            await page.evaluate(() =>
                window.documentFixture.change({
                    type: 'pdf',
                    uri: false,
                    grid: true,
                    badWorker: true,
                    disableOpen: true,
                })
            );
            await page.waitForFunction(() =>
                document
                    .querySelector('#document-host')
                    ?.textContent.includes('Document preview unavailable')
            );
            await untilClosed();
            assert.equal(await display().locator('canvas').count(), 0);
            const missingWorkers = profile.resources.filter(
                (resource) => resource.path === '/missing-worker.mjs'
            );
            assert(
                missingWorkers.length > 0,
                'Negative worker fixture must reach its owned 404 route'
            );
            assert(
                missingWorkers.every(
                    (resource) =>
                        resource.method === 'GET' &&
                        resource.status === 404 &&
                        resource.cookie === null
                )
            );
            await finish('failed-worker-startup-feedback-and-port-disposal');
            await page.evaluate(() =>
                window.documentFixture.change({
                    type: 'text',
                    uri: false,
                    grid: false,
                    badWorker: false,
                    revision: 0,
                })
            );
            await click('New revision');
            await page.waitForFunction(() =>
                document
                    .querySelector('#document-host')
                    ?.textContent.includes('Successor document')
            );
            await click('Retire');
            await page.waitForFunction(
                () =>
                    window.documentFixture.snapshot().state.current === false &&
                    document.querySelector(
                        '#document-host [data-document-thumbnail]'
                    ) === null
            );
            assert.equal(
                await display().locator('[data-document-thumbnail]').count(),
                0
            );
            await untilClosed();
            const snapshot = await page.evaluate(() =>
                window.documentFixture.snapshot()
            );
            assert.deepEqual(
                [...snapshot.made].sort(),
                [...snapshot.revoked].sort()
            );
            assert.ok(
                profile.resources.every((resource) => resource.cookie === null)
            );
            await finish('payload-revision-owner-and-resource-disposal');
            profile.react = snapshot.react;
            profile.status = 'passed';
        } catch (error) {
            failure ??= error;
            profile.status = 'failed';
            profile.error = error.message;
        } finally {
            try {
                if (context) {
                    await context.close();
                    profile.cleanup.context = 'closed';
                }
            } catch (error) {
                failure ??= error;
                profile.cleanup.context = error.message;
            }
            try {
                if (server) {
                    server.closeAllConnections();
                    await new Promise((done, reject) =>
                        server.close((error) =>
                            error ? reject(error) : done()
                        )
                    );
                    profile.cleanup.server = 'closed';
                }
            } catch (error) {
                failure ??= error;
                profile.cleanup.server = error.message;
            }
        }
        if (failure) break;
    }
    evidence.status = failure ? 'failed' : 'passed';
    if (!failure) {
        assert.equal(evidence.profiles.length, 2);
        for (const profile of evidence.profiles)
            assert.equal(profile.results.length, 13);
    }
    evidence.cleanup.profiles = evidence.profiles.map(
        (profile) => profile.cleanup
    );
    evidence.scope =
        'Owned localhost fixtures, actual installed ESM/CJS and module workers; no provider, native monorepo or hosted acceptance';
    if (failure) throw failure;
}
