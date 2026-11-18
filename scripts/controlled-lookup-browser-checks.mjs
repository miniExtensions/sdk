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
import { controlledLookupAssembly } from './controlled-lookup-consumer-checks.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const galleryImagePath = (surface, source) =>
    '/gallery-recovery-' + surface + '-' + source + '.png';
const galleryImagePaths = new Set(
    ['list', 'picker'].flatMap((surface) =>
        ['thumb', 'preview', 'original'].map((source) =>
            galleryImagePath(surface, source)
        )
    )
);
const recoveredImage =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="green"/></svg>';
const host = String.raw`
const main=document.querySelector('main');root=createRoot(main);
window.fetch=async()=>{effects.transport++;throw Error('Unexpected Lookup fetch');};
XMLHttpRequest.prototype.open=function(){effects.transport++;throw Error('Unexpected Lookup XHR');};
window.open=function(){effects.transport++;throw Error('Unexpected Lookup window.open');};
if(navigator.sendBeacon)navigator.sendBeacon=function(){effects.transport++;return false;};
flushSync(()=>rerender());
const initial=()=>({status:'ready',result:{kind:'sequence',leaves:cohorts.map(([key,result])=>({key,result}))}});
window.lookupProof={snapshot,retire(){active=null;},initial(){flushSync(()=>renew(initial()));},cohort(name){const result=cohorts.find(([key])=>key===name)?.[1];if(!result)throw Error('Unknown cohort');flushSync(()=>renew({status:'ready',result}));},masked(){flushSync(()=>renew({status:'masked'}));},successor(){flushSync(()=>renew({status:'ready',result:{kind:'literal',text:'Successor canonical value'}}));},invalid(){flushSync(()=>renew({status:'ready',result:{kind:'sequence',leaves:[{key:'duplicate',result:{kind:'literal',text:'Private value'}},{key:'duplicate',result:{kind:'literal',text:'Private value'}}]}}));},richText(){flushSync(()=>renew({status:'ready',result:{kind:'richText',display:{identity:'owned-readonly-'+identity,value:['**Readonly rich content**','','[x] Supplied checked item'].join(String.fromCharCode(10)),emptyLabel:'No rich value',language:'en'}}}));},unmount(){flushSync(()=>root.unmount());}};
const externalCapture=createExternalCaptureScenario();
window.lookupProof.externalStart=()=>flushSync(()=>externalCapture.start());
window.lookupProof.externalAdmit=()=>externalCapture.admit();
window.lookupProof.externalRetire=()=>externalCapture.retire();
window.lookupProof.externalRecover=()=>externalCapture.recover();
window.lookupProof.externalSnapshot=()=>externalCapture.snapshot();
window.lookupProof.galleryRecovery=(surface)=>{
 const url=part=>window.location.origin+'/gallery-recovery-'+surface+'-'+part+'.png';
 const broken={id:'failed',type:'image/png',filename:'Adjunto.png',thumbnailUrl:url('thumb'),thumbnails:{full:{url:url(surface==='list'?'preview':'thumb')}},url:url('original')};
 const nonImage={id:'document',type:'application/pdf',filename:'Document.pdf',url:window.location.origin+'/gallery-document.pdf',thumbnailUrl:dataImage};
 const entries=surface==='picker'?[{id:'selected',type:'image/svg+xml',filename:'Still selected',url:dataImage},broken,nonImage]:[broken,nonImage];
 const display={entries,labels:{previewNotAvailable:'Imagen no disponible',retry:'Reintentar imagen'},disableDownloadFiles:true};
 flushSync(()=>renew({status:'ready',result:{kind:'urlGallery',display}}));
};
`;
const observedInput = String.raw`
window.lookupProof.currentInput=()=>JSON.stringify(state);
window.lookupProof.markdown=()=>flushSync(()=>renew({status:'ready',result:{kind:'markdown',value:'**Readonly supplied Markdown**',identity:'lookup-markdown-'+identity,emptyLabel:'No value'}}));
`;

/** Installed public controls, trusted browser inputs, isolated provider-free host. */
export async function checkControlledLookupBrowser({
    browser,
    consumer,
    evidence,
    output,
    readArchiveMember,
}) {
    Object.assign(evidence, {
        status: 'running',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
        inputs: {},
    });
    let directory, server, context, page, failure;
    const bounded = async (operation) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(Error('Lookup cleanup timed out')),
                        5000
                    );
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        const root = realpathSync(consumer),
            installed = realpathSync(
                join(root, 'node_modules/@miniextensions/sdk')
            );
        assert.equal(
            typeof readArchiveMember,
            'function',
            'Exact admitted archive reader required'
        );
        evidence.archiveInputs = {};
        for (const format of ['esm', 'cjs']) {
            for (const name of [
                'react/index.js',
                'react/ControlledLookupField.js',
                'react/lookupPresentationValidation.js',
                'react/readonlyResourceOwner.js',
                'react/ReadOnlyURLGallery.js',
                'react/RecoverableImage.js',
                'react/readonly-url-gallery.css',
                'react/AttachmentPreview.js',
                'react/FormulaField.js',
                'react/lookupFieldTypes.d.ts',
                'react/lookup.css',
                'ui/lookupProjection.js',
            ]) {
                const member = 'dist/' + format + '/' + name;
                const actual = readFileSync(join(installed, member));
                assert(
                    actual.equals(readArchiveMember('package/' + member)),
                    'Installed Lookup input differs from admitted archive: ' +
                        member
                );
                evidence.archiveInputs[member] = sha(actual);
            }
        }
        directory = mkdtempSync(join(root, '.controlled-lookup-proof-'));
        const assets = new Map();
        for (const format of ['esm', 'cjs']) {
            const imports =
                format === 'esm'
                    ? "import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import * as api from '@miniextensions/sdk/react';import '@miniextensions/sdk/react/lookup.css';import '@miniextensions/sdk/react/readonly-url-gallery.css';"
                    : "const React=require('react');const {createRoot}=require('react-dom/client');const {flushSync}=require('react-dom');const api=require('@miniextensions/sdk/react');require('@miniextensions/sdk/react/lookup.css');require('@miniextensions/sdk/react/readonly-url-gallery.css');";
            const source =
                imports + controlledLookupAssembly + host + observedInput;
            const entry = join(directory, format + '.js');
            writeFileSync(entry, source);
            const bundle = await build({
                entryPoints: [entry],
                absWorkingDir: root,
                outdir: join(directory, 'out'),
                entryNames: format,
                bundle: true,
                platform: 'browser',
                format: 'esm',
                write: false,
                metafile: true,
                logLevel: 'silent',
            });
            await assertBrowserInputs(bundle.metafile, root);
            const inputs = Object.keys(bundle.metafile.inputs).filter((path) =>
                path.includes('/sdk/dist/')
            );
            assert(
                inputs.some((path) =>
                    path.endsWith('/react/ControlledLookupField.js')
                )
            );
            for (const input of inputs)
                assert(
                    realpathSync(resolve(root, input)).startsWith(
                        installed + '/'
                    )
                );
            evidence.inputs[format] = inputs;
            evidence[format + 'HostSha256'] = sha(source);
            for (const file of bundle.outputFiles) {
                const name = file.path.split('/').at(-1);
                assert([format + '.js', format + '.css'].includes(name));
                assets.set('/' + name, file.contents);
            }
        }
        server = createServer((request, response) => {
            const url = new URL(request.url, 'http://localhost');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; media-src 'self' data:; form-action 'none'; frame-src 'none'"
            );
            if (url.pathname === '/') {
                const format = url.searchParams.get('format');
                if (!['esm', 'cjs'].includes(format)) {
                    response.writeHead(400).end();
                    return;
                }
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Owned controlled Lookup proof</title><link rel="stylesheet" href="/' +
                        format +
                        '.css"><style>body{font:16px/1.5 system-ui;margin:1rem}main{max-width:48rem}#before,#after{margin:.5rem}</style><main></main><script type="module" src="/' +
                        format +
                        '.js"></script>'
                );
            } else if (assets.has(url.pathname)) {
                response.setHeader(
                    'Content-Type',
                    url.pathname.endsWith('.css')
                        ? 'text/css'
                        : 'text/javascript'
                );
                response.end(assets.get(url.pathname));
            } else response.writeHead(404).end();
        });
        await bounded(
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = 'http://127.0.0.1:' + server.address().port;
        evidence.origin = origin;
        for (const format of ['esm', 'cjs']) {
            context = await browser.newContext({
                serviceWorkers: 'block',
                viewport: { width: 390, height: 844 },
            });
            page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            page.on('dialog', (dialog) => {
                evidence.pageErrors.push('Unexpected ' + dialog.type());
                void dialog.dismiss();
            });
            const galleryRequests = [];
            let recoverThumbnail;
            await page.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (
                    url.origin === origin &&
                    galleryImagePaths.has(url.pathname) &&
                    route.request().resourceType() === 'image'
                ) {
                    galleryRequests.push(url.pathname);
                    const recovered = recoverThumbnail === url.pathname;
                    return route.fulfill({
                        status: recovered ? 200 : 404,
                        contentType: 'image/svg+xml',
                        headers: { 'Cache-Control': 'no-store' },
                        body: recovered ? recoveredImage : '',
                    });
                }
                if (
                    url.origin === origin &&
                    (url.pathname === '/' || assets.has(url.pathname))
                )
                    return route.continue();
                if (url.protocol === 'data:') return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            await page.goto(origin + '/?format=' + format);
            await page.waitForFunction(
                () => window.lookupProof?.snapshot().cohorts.length === 34
            );
            const record = (name, details = {}) =>
                evidence.results.push({
                    format,
                    name,
                    status: 'passed',
                    ...details,
                });
            const snapshot = () =>
                page.evaluate(() => window.lookupProof.snapshot());
            const checkContextMenu = async (retired) => {
                const anchor = page.locator('.mx-sdk-html a');
                const before = await snapshot();
                await anchor.evaluate((node) => {
                    const main = document.querySelector('main');
                    const observed = { targetRan: false };
                    let captured;
                    const start = (event) => {
                        if (event.target !== node) return;
                        captured = event;
                        Object.assign(observed, {
                            trusted: event.isTrusted,
                            button: event.button,
                            before: event.defaultPrevented,
                        });
                    };
                    const safety = (event) => {
                        if (event.target !== node) return;
                        // React's delegated capture listener was installed on
                        // this same mount before this safety observer. Record
                        // SDK prevention before suppressing the native menu.
                        observed.beforeHarness = event.defaultPrevented;
                        event.preventDefault();
                    };
                    const target = () => (observed.targetRan = true);
                    document.addEventListener('contextmenu', start, true);
                    main.addEventListener('contextmenu', safety, true);
                    node.addEventListener('contextmenu', target);
                    window.lookupContextMenu = () => ({
                        ...observed,
                        after: captured?.defaultPrevented,
                    });
                    window.lookupContextMenuCleanup = () => {
                        document.removeEventListener(
                            'contextmenu',
                            start,
                            true
                        );
                        main.removeEventListener('contextmenu', safety, true);
                        node.removeEventListener('contextmenu', target);
                        captured = null;
                        delete window.lookupContextMenu;
                        delete window.lookupContextMenuCleanup;
                    };
                });
                try {
                    await anchor.click({ button: 'right' });
                    const event = await page.evaluate(() =>
                        window.lookupContextMenu()
                    );
                    assert.equal(event.trusted, true);
                    assert.equal(event.button, 2);
                    assert.equal(event.before, false);
                    assert.equal(event.beforeHarness, retired);
                    assert.equal(event.targetRan, !retired);
                    assert.equal(event.after, true);
                    assert.equal(page.url(), origin + '/?format=' + format);
                    assert.equal(context.pages().length, 1);
                    assert.deepEqual(await snapshot(), before);
                    record(
                        retired
                            ? 'stale context-menu navigation refused by SDK before safety cancellation'
                            : 'current context menu admitted; harness suppresses native menu',
                        { event }
                    );
                } finally {
                    await page.evaluate(() =>
                        window.lookupContextMenuCleanup?.()
                    );
                }
            };
            const initial = await snapshot();
            if (evidence.react !== undefined)
                assert.equal(initial.react, evidence.react);
            if (evidence.actualReact !== undefined)
                assert.equal(initial.react, evidence.actualReact);
            evidence.actualReact = initial.react;
            evidence.platform = initial.platform;
            assert.equal(
                await page.locator('.mx-sdk-lookup-occurrence').count(),
                34
            );
            assert.equal(
                await page.locator('.mx-sdk-html strong').first().textContent(),
                'Rich HTML'
            );
            assert.equal(
                await page.locator('.mx-sdk-quill em').textContent(),
                'Quill content'
            );
            assert.equal(await page.locator('script:not([src])').count(), 0);
            assert.equal(await page.locator('.mx-sdk-select-badge').count(), 3);
            assert.equal(
                await page
                    .locator('.mx-sdk-select-badge')
                    .first()
                    .textContent(),
                'Urgent'
            );
            assert.deepEqual(
                await page
                    .locator('.mx-sdk-collaborator-name')
                    .allTextContents(),
                ['Ada', 'Grace', 'Supplied Person']
            );
            assert.equal(
                await page.locator('.mx-sdk-finder-rating svg').count(),
                5
            );
            assert.equal(await page.locator('.mx-sdk-rating-icon').count(), 3);
            const progress = await page
                .locator('.mx-sdk-localized-numeric-progress')
                .evaluate((node) => {
                    const fill = node.querySelector(
                        '.mx-sdk-localized-numeric-fill'
                    );
                    const track = node.querySelector(
                        '.mx-sdk-localized-numeric-track'
                    );
                    return {
                        fill: fill.getBoundingClientRect().width,
                        track: track.getBoundingClientRect().width,
                        width: fill.style.width,
                        text: node.textContent,
                    };
                });
            assert.equal(progress.width, '25%');
            assert(
                progress.track > 0 &&
                    Math.abs(progress.fill / progress.track - 0.25) < 0.02
            );
            assert.equal(progress.text, '25%');
            assert.match(initial.text, /greater than the maximum allowed/);
            for (const text of [
                'Literal <b>text</b>',
                '+1 202 555 0123',
                '1:01:01',
                'ABC-123',
                'Rollup result',
                'Supplied attachment',
                'Linked row',
                'Rich card',
                'Card detail',
                '1 234,50',
                '€0.00',
                '25%',
                '2026-11-16',
                '12:30',
                'Single choice',
                'Grace',
                'Captured button',
                'Borrowed URL',
                'Pill A',
                'Supplied linked label',
                'Supplied Person',
                'List row',
            ])
                assert(initial.text.includes(text), 'Missing cohort: ' + text);
            assert.equal(
                await page.locator('.mx-sdk-html b').textContent(),
                'Formula HTML'
            );
            assert.equal(
                await page
                    .locator('.mx-sdk-lookup-linked-table th')
                    .first()
                    .textContent(),
                'Name'
            );
            await page.waitForFunction(
                () =>
                    document.querySelector('.mx-sdk-url-gallery__thumbnail img')
                        ?.naturalWidth === 12
            );
            const leavesPaint = await page
                .locator(
                    '.mx-sdk-select-badge, .mx-sdk-collaborator-badge, .mx-sdk-finder-rating, .mx-sdk-rating-icon, .mx-sdk-lookup-linked-table'
                )
                .evaluateAll((nodes) =>
                    nodes.map((node) => ({
                        width: node.getBoundingClientRect().width,
                        height: node.getBoundingClientRect().height,
                    }))
                );
            assert(
                leavesPaint.every((rect) => rect.width > 0 && rect.height > 0)
            );
            assert.equal(
                await page
                    .locator('input[type=checkbox]')
                    .evaluateAll(
                        (nodes) =>
                            nodes.length === 2 &&
                            nodes.every(
                                (node) =>
                                    node.disabled &&
                                    node.readOnly &&
                                    node.checked
                            )
                    ),
                true
            );
            assert.equal(
                await page.locator('[data-checkbox-grid-value="true"]').count(),
                1
            );
            assert.doesNotMatch(
                initial.text,
                /(?:private|hidden)@example\.invalid/
            );
            const paint = await page
                .locator('.mx-sdk-controlled-lookup')
                .evaluate((node) => ({
                    width: node.getBoundingClientRect().width,
                    display: getComputedStyle(node).display,
                    overflow: document.documentElement.scrollWidth > innerWidth,
                }));
            assert(paint.width > 200);
            assert.equal(paint.display, 'block');
            assert.equal(paint.overflow, false);
            record('all rich cohorts, readonly/privacy and scoped paint', {
                ...paint,
                leavesPaint,
                progress,
                suppliedUnchanged: initial.suppliedUnchanged,
            });
            assert.equal(initial.suppliedUnchanged, true);
            await page.screenshot({
                path: join(output, 'controlled-lookup-rich-' + format + '.png'),
                fullPage: true,
            });

            await checkContextMenu(false);

            const open = page.getByRole('button', {
                name: 'Open linked row',
                exact: true,
            });
            await open.evaluate((node) => (node.id = 'real-linked-open'));
            await open.focus();
            await page.keyboard.press('Enter');
            assert.equal((await snapshot()).effects.opens, 1);
            assert.equal(
                (await snapshot()).effects.triggerId,
                'real-linked-open'
            );
            assert.equal(
                await open.evaluate((node) => node === document.activeElement),
                true
            );
            record('trusted child Open and actual trigger');
            await page.evaluate(() => window.lookupProof.retire());
            await page.keyboard.press('Enter');
            assert.equal((await snapshot()).effects.opens, 1);
            const staleLink = page.locator('.mx-sdk-html a');
            await staleLink.evaluate((node) => {
                document.addEventListener(
                    'click',
                    (event) => {
                        if (event.target !== node) return;
                        const observed = {
                            trusted: event.isTrusted,
                            before: event.defaultPrevented,
                            targetRan: false,
                        };
                        window.lookupBlockedClick = observed;
                        window.lookupBlockedEvent = event;
                        queueMicrotask(
                            () => (observed.microtask = event.defaultPrevented)
                        );
                    },
                    { capture: true, once: true }
                );
                node.addEventListener(
                    'click',
                    () => {
                        window.lookupBlockedClick.targetRan = true;
                    },
                    { once: true }
                );
            });
            await staleLink.click();
            const blockedClick = await page.evaluate(() => {
                const observed = {
                    ...window.lookupBlockedClick,
                    after: window.lookupBlockedEvent.defaultPrevented,
                };
                window.lookupBlockedEvent = null;
                return observed;
            });
            assert.equal(blockedClick.trusted, true);
            assert.equal(blockedClick.before, false);
            assert.equal(blockedClick.targetRan, false);
            assert.equal(blockedClick.after, true);
            assert.equal(page.url(), origin + '/?format=' + format);
            record(
                'stale activation refused before target/default navigation',
                { event: blockedClick }
            );
            await checkContextMenu(true);

            await page.evaluate(() => window.lookupProof.cohort('linkedCard'));
            const next = page.getByRole('button', {
                name: 'Next image',
                exact: true,
            });
            await next.click();
            assert.equal(
                await page
                    .locator('img[data-visible=true]')
                    .getAttribute('alt'),
                'Second'
            );
            await page.evaluate(() => window.lookupProof.retire());
            await next.click();
            assert.equal(
                await page
                    .locator('img[data-visible=true]')
                    .getAttribute('alt'),
                'Second'
            );
            record('real carousel interaction and stale refusal');

            await page.evaluate(() => window.lookupProof.cohort('gallery'));
            const galleryOpen = page.locator('.mx-sdk-url-gallery__open');
            await galleryOpen.focus();
            await page.keyboard.press('Enter');
            await page
                .getByRole('dialog', { name: 'Attachments', exact: true })
                .waitFor();
            await page.keyboard.press('Escape');
            assert.equal(await page.getByRole('dialog').count(), 0);
            assert.equal(
                await galleryOpen.evaluate(
                    (node) => node === document.activeElement
                ),
                true
            );
            await page.keyboard.press('Enter');
            await page.getByRole('dialog').waitFor();
            await page.evaluate(() => window.lookupProof.retire());
            await page
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            assert.equal(await page.getByRole('dialog').count(), 0);
            record('gallery keyboard/focus and stale Close remains usable');

            const recoveryEffects = (await snapshot()).effects;
            await page.evaluate(() =>
                window.lookupProof.galleryRecovery('list')
            );
            const tile = page.locator('.mx-sdk-url-gallery__entry').first();
            const failureLabel = 'Imagen no disponible: Adjunto.png';
            const listRetry = tile
                .getByRole('status', { name: failureLabel })
                .getByRole('button', {
                    name: 'Reintentar imagen',
                    exact: true,
                });
            await listRetry.waitFor();
            const listSources = ['thumb', 'preview', 'original'].map((source) =>
                galleryImagePath('list', source)
            );
            assert.deepEqual(galleryRequests, listSources);
            recoverThumbnail = listSources[0];
            await listRetry.click();
            await tile.locator('img').evaluate((image) => image.decode());
            assert.equal(await page.getByRole('dialog').count(), 0);
            assert.equal(
                await tile
                    .locator('.mx-sdk-url-gallery__open')
                    .evaluate((node) => node === document.activeElement),
                true
            );
            assert.deepEqual(galleryRequests, [...listSources, listSources[0]]);
            record(
                'gallery list follows granted errors and restores Open focus after trusted Retry'
            );

            recoverThumbnail = undefined;
            await page.evaluate(() =>
                window.lookupProof.galleryRecovery('picker')
            );
            await page.locator('.mx-sdk-url-gallery__open').first().click();
            const dialog = page.getByRole('dialog');
            const strip = dialog.locator('.mx-sdk-url-gallery__strip');
            const pickerRetry = strip
                .getByRole('status', { name: failureLabel })
                .getByRole('button', {
                    name: 'Reintentar imagen',
                    exact: true,
                });
            await pickerRetry.waitFor();
            assert.equal(await strip.locator('button button').count(), 0);
            assert.equal(
                await strip.locator('img[src*="gallery-document"]').count(),
                0
            );
            const beforeRetiredRetry = galleryRequests.length;
            await page.evaluate(() => window.lookupProof.retire());
            await pickerRetry.click();
            await page.evaluate(
                () => new Promise((done) => requestAnimationFrame(done))
            );
            assert.equal(galleryRequests.length, beforeRetiredRetry);
            await page.evaluate(() =>
                window.lookupProof.galleryRecovery('picker')
            );
            await page.locator('.mx-sdk-url-gallery__open').first().click();
            await pickerRetry.waitFor();
            recoverThumbnail = galleryImagePath('picker', 'thumb');
            await pickerRetry.click();
            await strip
                .locator('img[src*="gallery-recovery-picker-thumb"]')
                .evaluate((image) => image.decode());
            assert.equal(
                await dialog
                    .locator('.mx-sdk-url-gallery__position')
                    .textContent(),
                '1 / 3'
            );
            assert.equal(
                await strip
                    .getByRole('button', {
                        name: 'Select attachment 2',
                        exact: true,
                    })
                    .evaluate((node) => node === document.activeElement),
                true
            );
            assert(
                !galleryRequests.includes(galleryImagePath('picker', 'preview'))
            );
            assert(
                galleryRequests.includes(galleryImagePath('picker', 'original'))
            );
            assert.deepEqual((await snapshot()).effects, recoveryEffects);
            record(
                'gallery picker deduplicates, refuses retired Retry and preserves selection on current Retry'
            );

            await page.evaluate(() => window.lookupProof.richText());
            await page.locator('.ProseMirror[contenteditable=false]').waitFor();
            assert.match(
                await page.locator('.ProseMirror').textContent(),
                /Readonly rich content/
            );
            assert.equal(
                await page.locator('.ProseMirror strong').textContent(),
                'Readonly rich content'
            );
            const richCheck = page.locator('.ProseMirror input[type=checkbox]');
            assert.equal(await richCheck.count(), 1);
            assert.equal(await richCheck.isChecked(), true);
            const richSnapshot = () =>
                page.locator('.ProseMirror').evaluate((node) => {
                    const copy = node.cloneNode(true);
                    for (const item of copy.querySelectorAll('[class]')) {
                        for (const name of [...item.classList]) {
                            // Native ListItem decorations, not stored document data.
                            if (
                                name === 'hovering' ||
                                /^counter-\d+$/.test(name)
                            )
                                item.classList.remove(name);
                        }
                        if (item.classList.length === 0)
                            item.removeAttribute('class');
                    }
                    return {
                        html: copy.innerHTML,
                        checked: [
                            ...node.querySelectorAll('input[type=checkbox]'),
                        ].map((input) => input.checked),
                    };
                });
            const before = await richSnapshot();
            const inputBefore = await page.evaluate(() =>
                window.lookupProof.currentInput()
            );
            // Readonly editor hit testing intentionally targets this visible
            // native affordance above its underlying checkbox input.
            await page
                .locator(
                    '.ProseMirror li[data-type=checkbox_item] > span[contenteditable=false]'
                )
                .click();
            assert.equal(await richCheck.isChecked(), true);
            assert.deepEqual(await richSnapshot(), before);
            assert.equal(
                await page.evaluate(() => window.lookupProof.currentInput()),
                inputBefore
            );
            await page.locator('.ProseMirror').click();
            await page.keyboard.type('must not write');
            assert.deepEqual(await richSnapshot(), before);
            assert.equal(
                await page.evaluate(() => window.lookupProof.currentInput()),
                inputBefore
            );
            record(
                'actual readonly rich-text runtime and trusted no-write typing',
                {
                    checked: before.checked,
                    documentSha256: sha(before.html),
                    inputUnchanged: true,
                    ignoredTransientClasses: ['hovering', 'counter-<digits>'],
                }
            );

            await page.evaluate(() => window.lookupProof.markdown());
            await page
                .locator('.ProseMirror[contenteditable=false] strong')
                .waitFor();
            assert.equal(
                await page.locator('.ProseMirror strong').textContent(),
                'Readonly supplied Markdown'
            );
            const markdownBefore = await richSnapshot();
            const markdownInput = await page.evaluate(() =>
                window.lookupProof.currentInput()
            );
            await page.locator('.ProseMirror').click();
            await page.keyboard.type('also refused');
            assert.deepEqual(await richSnapshot(), markdownBefore);
            assert.equal(
                await page.evaluate(() => window.lookupProof.currentInput()),
                markdownInput
            );
            record(
                'actual reused Markdown readonly presentation and no-effect input'
            );

            await page.evaluate(() => window.lookupProof.masked());
            assert.match((await snapshot()).text, /••••••••/);
            assert.equal(
                await page
                    .locator(
                        '#lookup img,#lookup iframe,#lookup video,#lookup audio,.ProseMirror'
                    )
                    .count(),
                0
            );
            record('concealment retires rich/media DOM');
            await page.evaluate(() => window.lookupProof.successor());
            assert.match((await snapshot()).text, /Successor canonical value/);
            await page.evaluate(() => window.lookupProof.invalid());
            assert.match((await snapshot()).text, /Unavailable/);
            assert(!(await snapshot()).text.includes('Private value'));
            record('successor admission and malformed projection fail closed');
            await page.locator('#before').focus();
            await page.keyboard.press('Tab');
            assert.equal(
                await page
                    .locator('#after')
                    .evaluate((node) => node === document.activeElement),
                true
            );
            record('readonly traversal preserves native Tab focus');
            const final = await snapshot();
            for (const name of ['transport', 'rows', 'submits'])
                assert.equal(final.effects[name], 0);
            assert.equal(final.effects.opens, 1);
            assert.equal(final.suppliedUnchanged, true);
            record('immutable source and observed no-effect ports', {
                ...final.effects,
                suppliedUnchanged: final.suppliedUnchanged,
            });
            await page.evaluate(() => window.lookupProof.externalStart());
            await page.getByText('Unavailable', { exact: true }).waitFor();
            await page.evaluate(() => window.lookupProof.externalAdmit());
            await page
                .getByText('Subscribed installed capture', { exact: true })
                .waitFor();
            await page.evaluate(() => window.lookupProof.externalRetire());
            await page.getByText('Unavailable', { exact: true }).waitFor();
            const retiredCapture = await page.evaluate(() =>
                window.lookupProof.externalSnapshot()
            );
            assert.equal(retiredCapture.retiredSubscriptions, 0);
            assert.equal(retiredCapture.oldCurrent, false);
            assert(
                !retiredCapture.text.includes('Subscribed installed capture')
            );
            await page.evaluate(() => window.lookupProof.externalRecover());
            await page
                .getByText('Subscribed installed capture', { exact: true })
                .waitFor();
            assert.equal(
                (
                    await page.evaluate(() =>
                        window.lookupProof.externalSnapshot()
                    )
                ).oldCurrent,
                false
            );
            for (const name of ['transport', 'rows', 'submits'])
                assert.equal((await snapshot()).effects[name], 0);
            record(
                'external-store retirement, unavailable successor and fresh recovery'
            );
            await page.screenshot({
                path: join(output, 'controlled-lookup-' + format + '.png'),
                fullPage: true,
            });
            await page.evaluate(() => window.lookupProof.unmount());
            assert.equal(await page.locator('main > *').count(), 0);
            assert.equal(
                (
                    await page.evaluate(() =>
                        window.lookupProof.externalSnapshot()
                    )
                ).hostSubscriptions,
                0
            );
            record('full unmount cleanup');
            await context.close();
            context = null;
            page = null;
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
        evidence.scope =
            'Installed controlled Lookup ESM/CJS on real Chromium with trusted keyboard/mouse, rich paint/resources, stale ownership, focus/Close, readonly rich runtime and no canonical effects. This does not claim native Form acceptance.';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.lookupProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'controlled-lookup-failure.png'),
                    fullPage: true,
                });
            } catch {}
        }
    } finally {
        for (const [name, cleanup] of [
            ['context', () => context?.close()],
            [
                'server',
                () =>
                    new Promise((resolve, reject) => {
                        if (!server) return resolve();
                        server.closeAllConnections();
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        );
                    }),
            ],
            [
                'fixture',
                () => {
                    if (directory)
                        rmSync(directory, { recursive: true, force: true });
                },
            ],
        ]) {
            try {
                await bounded(cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                failure ??= error;
                evidence.status = 'failed';
                evidence.cleanup[name] = { error: error.message };
            }
        }
        writeFileSync(
            join(output, 'controlled-lookup.json'),
            JSON.stringify(evidence, null, 2) + '\n'
        );
    }
    if (failure) throw failure;
}
