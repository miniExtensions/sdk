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

export async function checkRecordCommentsBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, {
        status: 'running',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    let directory, server, context, page, failure;
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const bounded = async (label, operation) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(label + ' timed out')),
                        5000
                    );
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.record-comments-browser-'));
        const source = `
import React,{createElement as h,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CompleteRecordCommentsDialog,recordCommentsLabels} from '@miniextensions/sdk/react';
import {createRecordCommentsController} from '@miniextensions/sdk/ui';
const mode=new URLSearchParams(location.search).get('mode');
const stats={reads:[],writes:[],invalidations:[],dismissals:0};let release,openSecond;
const labels=mode==='spanish'?{...recordCommentsLabels,title:'Comentarios',addComment:'Añadir comentario',send:'Enviar',close:'Cerrar'}:mode==='literal'?{...recordCommentsLabels,title:'<Comentarios>'}:recordCommentsLabels;
function controller(token){return createRecordCommentsController({owner:{isCurrent:()=>true},childExtensionAccessToken:token,async list(input){stats.reads.push(input);if(mode==='refresh-failure'&&stats.reads.length===2)throw new Error('Synthetic refresh failure');return {readableVersionOfRecordPrimaryValue:'Ada',comments:Array.from({length:40},(_,index)=>({id:String(index),text:'Literal row '+index+' @[missing]',createdTime:'2024-01-01',lastUpdatedTime:null,authorLabel:'Verified author',actor:{type:'public',extensionId:'synthetic'}}))};},async append(input){stats.writes.push(input);if(mode==='pending')await new Promise(resolve=>{release=resolve;});},invalidate(input){stats.invalidations.push(input);}});}
const first=controller('captured-A'),second=controller('captured-B');
function App(){const invoker=useRef(null);const [open,setOpen]=useState(false),[two,setTwo]=useState(false);openSecond=()=>flushSync(()=>setTwo(true));return h('div',null,mode==='stable-invoker'?h('button',{ref:invoker},'Record options'):null,mode==='stable-invoker'&&open?null:h('button',{onClick:()=>setOpen(true)},'Open comments'),open?h(CompleteRecordCommentsDialog,{controller:first,labels,returnFocusTo:mode==='stable-invoker'?invoker:undefined,reservedInlineEndWidth:mode==='inset'?'440px':undefined,dismiss(){stats.dismissals++;setOpen(false);}}):null,two?h(CompleteRecordCommentsDialog,{controller:second,labels:{...recordCommentsLabels,title:'Second comments'},dismiss(){stats.dismissals++;setTwo(false);}}):null);}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.commentsProof={snapshot:()=>structuredClone(stats),release:()=>release(),openSecond:()=>openSecond()};
`;
        writeFileSync(join(directory, 'host.mjs'), source);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [join(directory, 'host.mjs')],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, root);
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const inputs = Object.keys(bundle.metafile.inputs).filter((p) =>
            p.includes('/sdk/dist/')
        );
        assert(
            inputs.some((p) => p.endsWith('/react/CompleteRecordComments.js'))
        );
        assert(inputs.some((p) => p.endsWith('/ui/recordComments.js')));
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/complete-record-comments.css')
        );
        Object.assign(evidence, {
            sdkInputs: inputs,
            harnessSha256: hash(readFileSync(new URL(import.meta.url))),
            hostSha256: hash(source),
            bundleSha256: hash(bundle.outputFiles[0].contents),
            cssSha256: hash(css),
        });
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; img-src 'none'"
            );
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (path === '/comments.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic record comments</title><link rel="stylesheet" href="/comments.css"><main></main><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            'comments server start',
            () =>
                new Promise((yes, no) => {
                    server.once('error', no);
                    server.listen(0, '127.0.0.1', yes);
                })
        );
        const origin = 'http://127.0.0.1:' + server.address().port;
        async function open(mode, width = 1280) {
            if (context) await context.close();
            context = await browser.newContext({
                viewport: { width, height: 800 },
            });
            await context.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (
                    url.origin === origin &&
                    ['/', '/proof.js', '/comments.css'].includes(url.pathname)
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            page = await context.newPage();
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            await page.goto(origin + '/?mode=' + mode);
            await page
                .getByRole('button', { name: 'Open comments', exact: true })
                .click();
            await page.getByRole('textbox').waitFor();
            assert.equal(await page.getByRole('dialog').count(), 1);
        }
        await open('normal');
        const dialog = page.getByRole('dialog', {
            name: 'Comments',
            exact: true,
        });
        await dialog.getByRole('textbox').fill('  raw @[missing] ');
        await dialog.getByRole('button', { name: 'Send', exact: true }).click();
        await page.waitForFunction(
            () => window.commentsProof.snapshot().invalidations.length === 1
        );
        assert.deepEqual(
            (await page.evaluate(() => window.commentsProof.snapshot())).writes,
            [
                {
                    childExtensionAccessToken: 'captured-A',
                    comment: '{{Ada}}:   raw @[missing] ',
                },
            ]
        );
        assert.equal(await dialog.getByRole('textbox').inputValue(), '');
        const geometry = await page.evaluate(() => {
            const panel = document.querySelector('.mx-sdk-comments-panel'),
                body = document.querySelector('.mx-sdk-comments-body'),
                header = document.querySelector('.mx-sdk-comments-header'),
                footer = document.querySelector('.mx-sdk-comments-footer');
            return {
                panel: panel.getBoundingClientRect().toJSON(),
                body: body.getBoundingClientRect().toJSON(),
                header: header.getBoundingClientRect().toJSON(),
                footer: footer.getBoundingClientRect().toJSON(),
                scrollHeight: body.scrollHeight,
            };
        });
        assert(geometry.panel.width <= 672.5 && geometry.panel.height <= 640.5);
        assert(geometry.scrollHeight > geometry.body.height);
        assert(
            geometry.header.bottom <= geometry.body.top + 1 &&
                geometry.body.bottom <= geometry.footer.top + 1
        );
        await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .focus();
        await page.keyboard.press('Tab');
        assert.equal(
            await dialog
                .getByRole('button', { name: 'Refresh', exact: true })
                .evaluate((node) => node === document.activeElement),
            true
        );
        await page.keyboard.press('Shift+Tab');
        assert.equal(
            await dialog
                .getByRole('button', { name: 'Close', exact: true })
                .evaluate((node) => node === document.activeElement),
            true
        );
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(
            await page
                .getByRole('button', { name: 'Open comments', exact: true })
                .evaluate((node) => node === document.activeElement),
            true
        );
        evidence.results.push({
            group: 'raw-send-focus-scroll-geometry',
            geometry,
        });
        await page
            .getByRole('button', { name: 'Open comments', exact: true })
            .click();
        await page.getByRole('textbox').waitFor();
        await page.screenshot({
            path: join(output, 'complete-record-comments-desktop.png'),
            fullPage: true,
        });

        await open('stable-invoker');
        assert.equal(
            await page
                .getByRole('button', { name: 'Open comments', exact: true })
                .count(),
            0
        );
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        assert.equal(
            await page
                .getByRole('button', { name: 'Record options', exact: true })
                .evaluate((node) => node === document.activeElement),
            true
        );
        evidence.results.push({
            group: 'temporary-activation-stable-return-focus',
        });

        await open('pending');
        await page.getByRole('textbox').fill('pending');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        assert.equal(await page.getByRole('textbox').isDisabled(), true);
        assert.equal(
            await page
                .getByRole('button', { name: 'Close', exact: true })
                .isEnabled(),
            true
        );
        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await page.evaluate(() => window.commentsProof.release());
        await page.waitForFunction(
            () => window.commentsProof.snapshot().invalidations.length === 1
        );
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(
            (await page.evaluate(() => window.commentsProof.snapshot())).writes
                .length,
            1
        );
        evidence.results.push({
            group: 'pending-dismissal-captured-settlement',
        });

        await open('refresh-failure');
        await page.getByRole('textbox').fill('accepted');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await page.getByRole('alert').waitFor();
        assert.equal(await page.getByRole('textbox').count(), 0);
        assert.equal(
            (await page.evaluate(() => window.commentsProof.snapshot())).writes
                .length,
            1
        );
        await page
            .getByRole('button', { name: 'Refresh', exact: true })
            .click();
        await page.getByRole('textbox').waitFor();
        assert.equal(await page.getByRole('textbox').inputValue(), '');
        evidence.results.push({
            group: 'accepted-send-refresh-failure-explicit-recovery',
        });

        await open('spanish', 375);
        assert.equal(
            await page
                .getByRole('dialog', { name: 'Comentarios', exact: true })
                .count(),
            1
        );
        assert.equal(
            await page
                .getByRole('textbox', {
                    name: 'Añadir comentario',
                    exact: true,
                })
                .count(),
            1
        );
        const narrow = await page
            .locator('.mx-sdk-comments-panel')
            .boundingBox();
        assert(
            narrow.x >= 0 &&
                narrow.x + narrow.width <= 375 &&
                narrow.height <= 640.5
        );
        await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
        evidence.results.push({
            group: 'literal-localization-narrow',
            geometry: narrow,
        });

        await open('literal');
        assert.equal(
            await page
                .getByRole('dialog', { name: '<Comentarios>', exact: true })
                .count(),
            1
        );
        assert.equal(
            await page
                .getByRole('heading', { name: '<Comentarios>', exact: true })
                .count(),
            1
        );
        assert.equal(await page.locator('Comentarios').count(), 0);
        evidence.results.push({ group: 'literal-label-escaping' });

        await open('inset');
        const inset = await page
            .locator('.mx-sdk-comments-panel')
            .boundingBox();
        assert(inset.x + inset.width <= 840 && inset.width <= 672.5);
        evidence.results.push({
            group: 'optional-desktop-inset',
            geometry: inset,
        });

        await open('normal');
        await page.evaluate(() => window.commentsProof.openSecond());
        assert.equal(await page.getByRole('dialog').count(), 2);
        await page.keyboard.press('Escape');
        assert.equal(await page.getByRole('dialog').count(), 1);
        assert.equal(
            await page
                .getByRole('dialog', { name: 'Comments', exact: true })
                .count(),
            1
        );
        await page
            .locator('.mx-sdk-comments-overlay')
            .click({ position: { x: 2, y: 2 } });
        assert.equal(await page.getByRole('dialog').count(), 0);
        evidence.results.push({ group: 'two-dialog-escape-backdrop' });
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.scope =
            'Installed public components and styles with trusted browser gestures and synthetic transport only; no hosted/native/provider/fixture acceptance.';
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page)
            await page
                .screenshot({
                    path: join(output, 'comments-failure.png'),
                    fullPage: true,
                })
                .catch(() => {});
    } finally {
        for (const [name, cleanup] of [
            ['context', () => context?.close()],
            [
                'server',
                () =>
                    new Promise((yes, no) => {
                        if (!server) return yes();
                        server.closeAllConnections();
                        server.close((error) => (error ? no(error) : yes()));
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
                await bounded('comments cleanup ' + name, cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                failure ??= error;
                evidence.status = 'failed';
                evidence.cleanup[name] = { error: error.message };
            }
        }
    }
    writeFileSync(
        join(output, 'complete-record-comments-proof.json'),
        JSON.stringify(evidence, null, 2) + '\n'
    );
    if (failure) throw failure;
}
