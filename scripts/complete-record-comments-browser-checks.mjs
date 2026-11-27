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
        const historyFixture = {
            cursor: 'synthetic older /+=',
            id: 'shared-comment-id',
            older: 'A – The flight is boarding.',
            newer: 'B – Meet me at Gate 4 after landing.',
            selected: 'Gate 4',
        };
        const source = `
import React,{createElement as h,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CompleteRecordCommentsDialog,recordCommentsLabels} from '@miniextensions/sdk/react';
import {createRecordCommentsController} from '@miniextensions/sdk/ui';
const mode=new URLSearchParams(location.search).get('mode');
const nativeAppearance=mode?.startsWith('native-');
const emptyHistory=mode?.endsWith('-empty')||mode==='native-send-error';
const comparePopulated=mode?.endsWith('-populated');
const historySelection=mode==='native-history-selection';
const historyFixture=${JSON.stringify(historyFixture)};
const stableInvoker=emptyHistory||comparePopulated||mode==='stable-invoker';
if (comparePopulated) document.body.style.lineHeight = '1.5';
const stats={reads:[],writes:[],invalidations:[],dismissals:0};let release,releaseOlder,openSecond,submits=0;
const labels=mode==='spanish'?{...recordCommentsLabels,title:'Comentarios',addComment:'Añadir comentario',send:'Enviar',close:'Cerrar'}:mode==='literal'?{...recordCommentsLabels,title:'<Comentarios>'}:recordCommentsLabels;
function commentText(index) {
    if (comparePopulated && index === 0) return 'W'.repeat(160);
    return 'Literal row ' + index + ' @[missing]';
}
function historyPage(text,createdTime) {
    return {
        readableVersionOfRecordPrimaryValue:'Ada',
        comments:[{id:historyFixture.id,text,createdTime,lastUpdatedTime:null,authorLabel:'Verified author',actor:{type:'public',extensionId:'synthetic'}}],
    };
}
function listHistory(input) {
    if (input.cursor===undefined)
        return {...historyPage(historyFixture.newer,'2024-01-02'),nextCursor:historyFixture.cursor};
    if (input.cursor!==historyFixture.cursor||releaseOlder)
        throw new Error('Unexpected synthetic history cursor');
    return new Promise(resolve=>{
        releaseOlder=()=>{
            releaseOlder=undefined;
            resolve(historyPage(historyFixture.older,'2024-01-01'));
        };
    });
}
function controller(token){return createRecordCommentsController({owner:{isCurrent:()=>true},childExtensionAccessToken:token,async list(input){stats.reads.push(input);if(historySelection)return listHistory(input);if(mode==='refresh-failure'&&stats.reads.length===2)throw new Error('Synthetic refresh failure');return {readableVersionOfRecordPrimaryValue:'Ada',comments:Array.from({length:emptyHistory?0:40},(_,index)=>({id:String(index),text:commentText(index),createdTime:'2024-01-01',lastUpdatedTime:null,authorLabel:'Verified author',actor:{type:'public',extensionId:'synthetic'}}))};},async append(input){stats.writes.push(input);if(mode==='native-send-error')throw new Error('Synthetic append failure');if(mode==='pending')await new Promise(resolve=>{release=resolve;});},invalidate(input){stats.invalidations.push(input);}});}
const first=controller('captured-A'),second=controller('captured-B');
function App(){const invoker=useRef(null);const [open,setOpen]=useState(false),[two,setTwo]=useState(false);openSecond=()=>flushSync(()=>setTwo(true));return h('div',null,stableInvoker?h('button',{ref:invoker},'Record options'):null,stableInvoker&&open?null:h('button',{type:'button',onClick:()=>setOpen(true)},'Open comments'),open?h(CompleteRecordCommentsDialog,{controller:first,labels,...(nativeAppearance?{appearance:'native'}:{}),returnFocusTo:stableInvoker?invoker:undefined,reservedInlineEndWidth:mode==='inset'?'440px':undefined,dismiss(){stats.dismissals++;setOpen(false);}}):null,two?h(CompleteRecordCommentsDialog,{controller:second,labels:{...recordCommentsLabels,title:'Second comments'},dismiss(){stats.dismissals++;setTwo(false);}}):null);}
const app=h(App);
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,historySelection?h('form',{onSubmit(event){event.preventDefault();submits++;}},app):app));
window.commentsProof={snapshot:()=>structuredClone(historySelection?{...stats,submits}:stats),release:()=>release(),openSecond:()=>openSecond(),hasPendingOlder:()=>releaseOlder!==undefined,releaseOlder:()=>releaseOlder()};
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
        async function open(mode, width = 1280, height = 800, forcedColors) {
            if (context) await context.close();
            context = await browser.newContext({
                viewport: { width, height },
                forcedColors,
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
            if (mode.endsWith('-empty') || mode.endsWith('-populated')) {
                await page.evaluate(() => {
                    window.commentsKeys = [];
                    window.addEventListener(
                        'keydown',
                        (event) => {
                            if (event.key === 'Tab' || event.key === 'Escape')
                                window.commentsKeys.push({
                                    key: event.key,
                                    trusted: event.isTrusted,
                                });
                        },
                        true
                    );
                });
            }
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

        for (const width of [375, 1280]) {
            for (const appearance of ['native', 'portable']) {
                await open(`${appearance}-empty`, width, 640);
                const dialog = page.getByRole('dialog', {
                    name: 'Comments',
                    exact: true,
                });
                const prompt = dialog.getByText('No comments on this record', {
                    exact: true,
                });
                const textarea = dialog.getByRole('textbox', {
                    name: 'Add a comment',
                });
                const send = dialog.getByRole('button', { name: 'Send' });
                await prompt.waitFor();
                assert.equal(await textarea.inputValue(), '');
                assert.equal(await send.isDisabled(), true);
                const geometry = await dialog.evaluate((node) => {
                    const panel = node.querySelector('.mx-sdk-comments-panel');
                    const prompt = node.querySelector('.mx-sdk-comments-empty');
                    const textarea = node.querySelector('textarea');
                    const send = node.querySelector('.mx-sdk-comments-send');
                    const style = getComputedStyle(textarea);
                    return {
                        appearance: node.getAttribute('data-appearance'),
                        panel: panel.getBoundingClientRect().toJSON(),
                        history:
                            prompt.parentElement.getBoundingClientRect().height,
                        promptLineHeight: getComputedStyle(prompt).lineHeight,
                        fontSize: style.fontSize,
                        lineHeight: style.lineHeight,
                        textareaHeight: textarea.getBoundingClientRect().height,
                        sendHeight: send.getBoundingClientRect().height,
                    };
                });
                if (appearance === 'native') {
                    assert.equal(geometry.history, 200);
                    assert.equal(geometry.appearance, 'native');
                    assert.equal(
                        geometry.panel.width,
                        width === 375 ? 311 : 672
                    );
                    assert.equal(geometry.promptLineHeight, '20px');
                    assert.equal(
                        geometry.fontSize,
                        width === 375 ? '16px' : '14px'
                    );
                    assert.equal(
                        geometry.lineHeight,
                        width === 375 ? '24px' : '20px'
                    );
                    assert.equal(
                        geometry.textareaHeight,
                        width === 375 ? 66 : 58
                    );
                    assert.equal(geometry.sendHeight, geometry.textareaHeight);
                } else {
                    assert.equal(geometry.appearance, null);
                    assert(geometry.history < 200);
                    assert.equal(
                        geometry.panel.width,
                        width === 375 ? 343 : 672
                    );
                    assert(geometry.sendHeight < geometry.textareaHeight);
                }
                await page.keyboard.press('Tab');
                await page.keyboard.press('Tab');
                const focus = await textarea.evaluate((node) => {
                    const style = getComputedStyle(node);
                    return {
                        active: node === document.activeElement,
                        visible: node.matches(':focus-visible'),
                        border: style.borderColor,
                        outline: style.outlineColor,
                        ring: style.boxShadow,
                    };
                });
                assert(focus.active && focus.visible);
                if (appearance === 'native') {
                    assert.equal(focus.border, 'rgb(59, 130, 246)');
                    assert.equal(focus.outline, 'rgba(0, 0, 0, 0)');
                    assert.match(focus.ring, /rgb\(59, 130, 246\).*1px/);
                } else {
                    assert.equal(focus.outline, 'rgb(79, 70, 229)');
                }
                await page.keyboard.press('Escape');
                assert.equal(await dialog.count(), 0);
                assert.equal(
                    await page
                        .getByRole('button', { name: 'Record options' })
                        .evaluate((node) => node === document.activeElement),
                    true
                );
                const keys = await page.evaluate(() => window.commentsKeys);
                assert.deepEqual(
                    keys.map(({ key }) => key),
                    ['Tab', 'Tab', 'Escape']
                );
                assert(keys.every(({ trusted }) => trusted));
                const stats = await page.evaluate(() =>
                    window.commentsProof.snapshot()
                );
                assert.equal(stats.reads.length, 1);
                assert.deepEqual(stats.writes, []);
                evidence.results.push({
                    group: 'empty-composer-appearance',
                    appearance,
                    width,
                    geometry,
                    focus,
                    keys,
                });
            }
        }

        const readOutline = (control) =>
            control.evaluate((node) => {
                const style = getComputedStyle(node);
                return {
                    active: node === document.activeElement,
                    visible: node.matches(':focus-visible'),
                    color: style.outlineColor,
                    offset: style.outlineOffset,
                    style: style.outlineStyle,
                    width: style.outlineWidth,
                };
            });
        const themedOutline = {
            active: true,
            visible: true,
            color: 'rgb(79, 70, 229)',
            offset: '2px',
            style: 'solid',
            width: '2px',
        };
        const draftText =
            'First draft line\nSecond draft line\nThird draft line';

        for (const [width, height, emptyHeight, draftHeight] of [
            [375, 780, 66, 90],
            [1280, 720, 58, 78],
        ]) {
            for (const [appearance, forcedColors] of [
                ['native', 'none'],
                ['native', 'active'],
                ['portable', 'none'],
            ]) {
                await open(`${appearance}-empty`, width, height, forcedColors);
                const dialog = page.getByRole('dialog', { name: 'Comments' });
                const textarea = dialog.getByRole('textbox', {
                    name: 'Add a comment',
                });
                const send = dialog.getByRole('button', { name: 'Send' });
                const invoker = page.getByRole('button', {
                    name: 'Record options',
                    exact: true,
                    includeHidden: true,
                });
                const invokerNode = await invoker.elementHandle({
                    timeout: 5000,
                });
                assert.equal(await send.isDisabled(), true);
                assert.equal(
                    await page.evaluate(
                        () => matchMedia('(forced-colors: active)').matches
                    ),
                    forcedColors === 'active'
                );

                await page.keyboard.press('Tab');
                if (forcedColors === 'none') {
                    assert.deepEqual(
                        await readOutline(
                            dialog.getByRole('button', { name: 'Refresh' })
                        ),
                        themedOutline
                    );
                    await page.keyboard.press('Shift+Tab');
                    assert.deepEqual(
                        await readOutline(
                            dialog.getByRole('button', { name: 'Close' })
                        ),
                        themedOutline
                    );
                    await page.keyboard.press('Tab');
                }
                await page.keyboard.press('Tab');
                assert((await readOutline(textarea)).active);
                await textarea.fill(draftText);
                assert.equal(await send.isEnabled(), true);
                const textareaBounds = await textarea.boundingBox();
                const sendBounds = await send.boundingBox();
                if (appearance === 'native') {
                    assert.equal(textareaBounds.height, draftHeight);
                    assert.equal(sendBounds.height, draftHeight);
                    assert.equal(sendBounds.y, textareaBounds.y);
                }
                await page.keyboard.press('Tab');
                const sendFocus = await readOutline(send);
                assert(sendFocus.active && sendFocus.visible);
                await dialog.locator('.mx-sdk-comments-panel').screenshot({
                    path: join(
                        output,
                        `comments-${appearance}-send-${width}-${forcedColors}.png`
                    ),
                    animations: 'disabled',
                    caret: 'hide',
                });

                await page.keyboard.press('Shift+Tab');
                assert((await readOutline(textarea)).active);
                assert.equal(await textarea.inputValue(), draftText);
                await textarea.clear();
                assert.equal(await textarea.inputValue(), '');
                assert.equal(await send.isDisabled(), true);
                if (appearance === 'native')
                    assert.equal(
                        (await textarea.boundingBox()).height,
                        emptyHeight
                    );
                await page.keyboard.press('Escape');
                assert.equal(await dialog.count(), 0);
                assert(
                    await invokerNode.evaluate(
                        (node) => node === document.activeElement
                    )
                );
                await invokerNode.dispose();

                const browserOutline = await readOutline(invoker);
                if (appearance === 'native') {
                    assert.deepEqual(sendFocus, browserOutline);
                    assert.equal(sendFocus.style, 'auto');
                    assert.equal(sendFocus.offset, '0px');
                    assert(parseFloat(sendFocus.width) > 0);
                } else {
                    assert.deepEqual(sendFocus, themedOutline);
                }
                const keys = await page.evaluate(() => window.commentsKeys);
                assert.deepEqual(
                    keys.map(({ key }) => key),
                    forcedColors === 'none'
                        ? ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Escape']
                        : ['Tab', 'Tab', 'Tab', 'Tab', 'Escape']
                );
                assert(keys.every(({ trusted }) => trusted));
                const stats = await page.evaluate(() =>
                    window.commentsProof.snapshot()
                );
                assert.deepEqual(stats.writes, []);
                assert.deepEqual(stats.invalidations, []);
                evidence.results.push({
                    group: 'unsent-draft-send-focus',
                    appearance,
                    forcedColors,
                    width,
                    height,
                    textareaBounds,
                    sendBounds,
                    sendFocus,
                    browserOutline,
                    keys,
                });
            }
        }

        for (const width of [375, 1280]) {
            for (const appearance of ['native', 'portable']) {
                await open(`${appearance}-populated`, width, 640);
                const dialog = page.getByRole('dialog', { name: 'Comments' });
                const row = dialog.locator('.mx-sdk-comments-row').filter({
                    hasText: 'W'.repeat(160),
                });
                const geometry = await row.evaluate((node) => {
                    const author = node.querySelector(
                        '.mx-sdk-comments-author'
                    );
                    const text = node.querySelector('.mx-sdk-comments-text');
                    const time = node.querySelector('.mx-sdk-comments-time');
                    const body = node.closest('.mx-sdk-comments-body');
                    return {
                        author: getComputedStyle(author).lineHeight,
                        text: getComputedStyle(text).lineHeight,
                        time: getComputedStyle(time).lineHeight,
                        wraps:
                            text.getBoundingClientRect().height >
                            parseFloat(getComputedStyle(text).lineHeight),
                        overflow: body.scrollWidth - body.clientWidth,
                    };
                });
                assert.deepEqual(geometry, {
                    author: appearance === 'native' ? '20px' : '21px',
                    text: appearance === 'native' ? '20px' : '21px',
                    time: appearance === 'native' ? '16px' : '18px',
                    wraps: true,
                    overflow: 0,
                });
                await page.keyboard.press('Escape');
                assert.equal(await dialog.count(), 0);
                assert.equal(
                    await page
                        .getByRole('button', { name: 'Record options' })
                        .evaluate((node) => node === document.activeElement),
                    true
                );
                const keys = await page.evaluate(() => window.commentsKeys);
                assert.deepEqual(keys, [{ key: 'Escape', trusted: true }]);
                const stats = await page.evaluate(() =>
                    window.commentsProof.snapshot()
                );
                assert.equal(stats.reads.length, 1);
                assert.deepEqual(stats.writes, []);
                evidence.results.push({
                    group: 'populated-history-typography',
                    appearance,
                    width,
                    geometry,
                    keys,
                });
            }
        }

        await open('native-send-error', 375, 640);
        const draft = page.getByRole('textbox', { name: 'Add a comment' });
        const send = page.getByRole('button', { name: 'Send' });
        await draft.fill('Retained draft');
        await send.click();
        const alert = page.getByRole('alert');
        await alert.waitFor();
        assert.equal(await alert.textContent(), 'Synthetic append failure');
        assert.equal(await draft.inputValue(), 'Retained draft');
        const draftBounds = await draft.boundingBox();
        const sendBounds = await send.boundingBox();
        const alertBounds = await alert.boundingBox();
        assert.equal(draftBounds.y, sendBounds.y);
        assert(alertBounds.y >= draftBounds.y + draftBounds.height);
        assert.equal(alertBounds.x, draftBounds.x);
        assert.equal(
            alertBounds.x + alertBounds.width,
            sendBounds.x + sendBounds.width
        );
        const failedSend = await page.evaluate(() =>
            window.commentsProof.snapshot()
        );
        assert.equal(failedSend.writes.length, 1);
        assert.deepEqual(failedSend.invalidations, []);
        evidence.results.push({ group: 'native-composer-append-error' });

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

        await open('native-history-selection');
        const newerComment = page.getByText(historyFixture.newer, {
            exact: true,
        });
        const olderComments = page.getByRole('button', {
            name: 'Load older comments',
            exact: true,
        });
        await newerComment.waitFor({ state: 'visible' });
        assert.deepEqual(
            await page.locator('.mx-sdk-comments-text').allTextContents(),
            [historyFixture.newer]
        );
        await olderComments.click();
        await page.waitForFunction(() =>
            window.commentsProof.hasPendingOlder()
        );
        await newerComment.waitFor({ state: 'visible' });
        const selectionEvidence = await page.evaluate(
            async ({ newer, selected }) => {
                const history = document.querySelector(
                    'dialog[open] .mx-sdk-comments-history'
                );
                const rows = () =>
                    Array.from(history.querySelectorAll('article'));
                const textNode = (row) =>
                    row?.querySelector('.mx-sdk-comments-text span')
                        ?.firstChild;
                const retainedArticle = rows()[0];
                const retainedText = textNode(retainedArticle);
                if (
                    !(retainedText instanceof Text) ||
                    retainedText.data !== newer ||
                    !window.commentsProof.hasPendingOlder()
                )
                    throw new Error(
                        'Expected visible B while older A is pending'
                    );
                const offset = retainedText.data.indexOf(selected);
                if (offset < 0) throw new Error('Missing selection text in B');
                const range = document.createRange();
                range.setStart(retainedText, offset);
                range.setEnd(retainedText, offset + selected.length);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                const snapshot = () => ({
                    text: selection.toString(),
                    anchorIsRetainedText: selection.anchorNode === retainedText,
                    focusIsRetainedText: selection.focusNode === retainedText,
                    anchorOffset: selection.anchorOffset,
                    focusOffset: selection.focusOffset,
                    rangeCount: selection.rangeCount,
                });
                const before = snapshot();
                let observer, timeout;
                try {
                    await new Promise((resolve, reject) => {
                        observer = new MutationObserver(() => {
                            if (rows().length === 2) resolve();
                        });
                        observer.observe(history, { childList: true });
                        timeout = window.setTimeout(
                            () =>
                                reject(
                                    new Error('Older comments did not render')
                                ),
                            5000
                        );
                        window.commentsProof.releaseOlder();
                    });
                } finally {
                    observer?.disconnect();
                    window.clearTimeout(timeout);
                }
                const currentRows = rows();
                return {
                    before,
                    after: snapshot(),
                    order: currentRows.map(
                        (row) =>
                            row.querySelector('.mx-sdk-comments-text')
                                .textContent
                    ),
                    sameArticle: currentRows[1] === retainedArticle,
                    sameTextNode: textNode(currentRows[1]) === retainedText,
                    retainedTextConnected: retainedText.isConnected,
                    retainedText: retainedText.data,
                };
            },
            historyFixture
        );
        const selectionStats = await page.evaluate(() =>
            window.commentsProof.snapshot()
        );
        evidence.historySelection = {
            ...selectionEvidence,
            sharedCommentId: historyFixture.id,
            cursor: historyFixture.cursor,
            ...selectionStats,
        };
        const anchorOffset = historyFixture.newer.indexOf(
            historyFixture.selected
        );
        const expectedSelection = {
            text: historyFixture.selected,
            anchorIsRetainedText: true,
            focusIsRetainedText: true,
            anchorOffset,
            focusOffset: anchorOffset + historyFixture.selected.length,
            rangeCount: 1,
        };
        assert.deepEqual(selectionEvidence.before, expectedSelection);
        assert.deepEqual(selectionEvidence.order, [
            historyFixture.older,
            historyFixture.newer,
        ]);
        assert.equal(selectionEvidence.sameArticle, true);
        assert.equal(selectionEvidence.sameTextNode, true);
        assert.equal(selectionEvidence.retainedTextConnected, true);
        assert.equal(selectionEvidence.retainedText, historyFixture.newer);
        assert.deepEqual(selectionEvidence.after, expectedSelection);
        assert.deepEqual(selectionStats, {
            reads: [
                { childExtensionAccessToken: 'captured-A' },
                {
                    childExtensionAccessToken: 'captured-A',
                    cursor: historyFixture.cursor,
                },
            ],
            writes: [],
            invalidations: [],
            dismissals: 0,
            submits: 0,
        });
        assert.equal(await olderComments.count(), 0);
        assert.equal(await page.getByRole('textbox').inputValue(), '');
        evidence.results.push({
            group: 'deferred-older-page-retains-selection',
        });

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
