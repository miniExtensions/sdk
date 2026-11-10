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

// The preserved zoom listener is armed after its opening transition. A fresh,
// window-targeted synthetic Tab only exercises its preventDefault branch: it
// cannot traverse the editor or perform native focus navigation. This predicate
// is specific to the isolated read-only fixture, not native Tab acceptance.
export function completeRichTextZoomKeyboardReady() {
    const event = new window.KeyboardEvent('keydown', {
        key: 'Tab',
        keyCode: 9,
        bubbles: true,
        cancelable: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
}

// An owned, in-memory consumer of the installed packed public API. No saved
// customer fixture, identity, provider, API transport or clipboard grant is used.
export async function checkCompleteRichTextBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, {
        status: 'running',
        phase: 'building',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    let directory, server, context, page, failure;
    const bounded = async (label, action) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(action),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`${label} timed out`)),
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
        directory = mkdtempSync(join(root, '.complete-rich-text-native-'));
        const source = `
import React,{createElement as h,createRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CompleteRichTextEditor} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/rich-text.css';
const editor=createRef(),writes=[],nativeEvents=[],handles=new Map(),observedEvents=new WeakMap();let nextHandle=0,current,update,clipboardStatus={state:'idle'},mounted=true;
const initial={value:'**Bold** and _italic_\\n\\n[ ] task',readOnly:false,owner:1,id:'rich-editor',label:'Synthetic Rich Text',ariaInvalid:false,clipboard:'**Pasted strong**'};
function describeTarget(target){return target instanceof Element?{id:target.id||null,tag:target.tagName,contentEditable:target.getAttribute('contenteditable'),isContentEditable:target instanceof HTMLElement?target.isContentEditable:null}:null;}
function nativeDocPosition(view,node,offset){if(!view||view.isDestroyed||!node||!view.dom.contains(node))return null;try{return view.posAtDOM(node,offset);}catch{return null;}}
function docEndPosition(view){if(!view||view.isDestroyed)return null;const doc=view.state.doc;return doc.lastChild?.isTextblock?doc.content.size-1:null;}
function clipboardObservation(event){const data=event.type==='paste'?event.clipboardData:null;return data?{types:Array.from(data.types),plain:data.getData('text/plain'),html:data.getData('text/html'),vscodeMetadata:data.getData('vscode-editor-data')}:null;}
function keyboardRuntime(){const handle=editor.current,view=handle?.view,input=view?.input;return{navigatorPlatform:navigator.platform,viewEditable:view?.editable??null,composing:view?.composing??null,input:input?{composing:input.composing??null,compositionEndedAt:input.compositionEndedAt??null,lastKeyCode:input.lastKeyCode??null,lastKeyCodeTime:input.lastKeyCodeTime??null}:null,selection:view?{from:view.state.selection.from,to:view.state.selection.to}:null,enabledExtensionNames:handle?.extensions?.extensions.map(extension=>extension.name)??[],pluginCount:view?.state.plugins.length??0,handleKeyDownPluginCount:view?.state.plugins.filter(plugin=>typeof plugin.props.handleKeyDown==='function').length??0,keymapCount:handle?.keymaps?.length??0};}
function observeEventMicrotask(event,observed){const runtime=keyboardRuntime();observed.microtasks.push({eventPhase:event.eventPhase,defaultPrevented:event.defaultPrevented,runtime});if(event.eventPhase===Event.NONE){observed.defaultPreventedAfterDispatch=event.defaultPrevented;observed.observedAfterDispatch=true;observed.runtimeAfterDispatch=runtime;}}
for(const type of ['keydown','beforeinput','paste','click']){
 document.addEventListener(type,event=>{const observed={type,trusted:event.isTrusted,key:event.key??null,inputType:event.inputType??null,ctrlKey:event.ctrlKey??null,metaKey:event.metaKey??null,shiftKey:event.shiftKey??null,altKey:event.altKey??null,keyCode:event.keyCode??null,code:event.code??null,which:event.which??null,isComposing:event.isComposing??null,timeStamp:event.timeStamp,target:describeTarget(event.target),activeElementAtCapture:describeTarget(document.activeElement),clipboard:clipboardObservation(event),eventPhaseAtCapture:event.eventPhase,defaultPreventedAtCapture:event.defaultPrevented,defaultPreventedAfterDispatch:null,observedAfterDispatch:false,runtimeAtCapture:keyboardRuntime(),runtimeAfterDispatch:null,bubble:null,microtasks:[]};observedEvents.set(event,observed);nativeEvents.push(observed);queueMicrotask(()=>observeEventMicrotask(event,observed));},true);
 document.addEventListener(type,event=>{const observed=observedEvents.get(event);if(!observed)return;observed.bubble={eventPhase:event.eventPhase,defaultPrevented:event.defaultPrevented,runtime:keyboardRuntime()};queueMicrotask(()=>observeEventMicrotask(event,observed));});
}
function captureHandle(){const handle=editor.current;if(handle&&!handles.has(handle))handles.set(handle,++nextHandle);return handle;}
function App(){
 const [state,setState]=useState(initial);current=state;update=next=>flushSync(()=>setState(old=>({...old,...next})));
 return h(React.Fragment,null,
  h('label',{id:'rich-label'},state.label),h('p',{id:'rich-help'},'Owned synthetic editor only'),
  h(CompleteRichTextEditor,{ref:editor,value:state.value,onValueChange:value=>{writes.push({owner:state.owner,value});setState(old=>({...old,value}));},readOnly:state.readOnly,placeholder:'Write owned text',identity:'owned-record-'+state.owner,id:state.id,ariaLabelledBy:'rich-label',ariaDescribedBy:'rich-help',ariaInvalid:state.ariaInvalid,emptyContent:h('b',null,'No owned value')}),
  h('button',{type:'button',id:'copy-owned-clipboard',onClick:async()=>{clipboardStatus={state:'copying'};try{await navigator.clipboard.writeText(state.clipboard);clipboardStatus={state:'copied',value:state.clipboard};}catch(error){clipboardStatus={state:'failed',error:error.name+': '+error.message};}}},'Copy owned clipboard'),
  h('button',{type:'button',id:'blur-target'},'Leave editor'));
}
const app=createRoot(document.querySelector('main'));flushSync(()=>app.render(h(React.StrictMode,null,h(App))));
window.completeRichTextProbe={
 update:next=>update(next),
 snapshot:()=>{const handle=captureHandle(),view=handle?.view,dom=view?.dom,selection=window.getSelection();return{reactVersion:React.version,state:{...current},writes:[...writes],nativeEvents:[...nativeEvents],keyboardRuntime:keyboardRuntime(),clipboard:{...clipboardStatus},handleId:handle?handles.get(handle):null,views:[...handles].map(([instance,id])=>({id,destroyed:!instance.view||instance.view.isDestroyed})),docEnd:docEndPosition(view),selection:view?{from:view.state.selection.from,to:view.state.selection.to}:null,nativeSelection:selection?{text:selection.toString(),collapsed:selection.isCollapsed,anchorOffset:selection.anchorOffset,focusOffset:selection.focusOffset,anchorDocPosition:nativeDocPosition(view,selection.anchorNode,selection.anchorOffset),focusDocPosition:nativeDocPosition(view,selection.focusNode,selection.focusOffset)}:null,focused:!!dom&&(document.activeElement===dom||dom.contains(document.activeElement)),roots:document.querySelectorAll('.ProseMirror').length,dom:dom?{id:dom.id,html:dom.innerHTML,text:dom.textContent,editable:dom.contentEditable,label:dom.getAttribute('aria-labelledby'),description:dom.getAttribute('aria-describedby'),invalid:dom.getAttribute('aria-invalid')}:null,bodyPortals:[...document.body.children].filter(node=>node.tagName==='DIV').length};},
 unmount:()=>{if(mounted){captureHandle();mounted=false;flushSync(()=>app.unmount());}}
};
`;
        const entry = join(directory, 'host.mjs');
        writeFileSync(entry, source);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            outfile: join(directory, 'proof.js'),
            write: false,
            metafile: true,
            minify: true,
            define: { 'process.env.NODE_ENV': '"production"' },
        });
        await assertBrowserInputs(bundle.metafile, root);
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const inputs = Object.keys(bundle.metafile.inputs).filter((path) =>
            path.includes('/sdk/dist/')
        );
        assert(
            inputs.some((path) =>
                path.endsWith('/react/CompleteRichTextEditor.js')
            )
        );
        assert(
            inputs.some((path) =>
                path.includes('/vendor/rich-markdown-editor/')
            )
        );
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const javascript = bundle.outputFiles.find((file) =>
            file.path.endsWith('.js')
        );
        const css = bundle.outputFiles.find((file) =>
            file.path.endsWith('.css')
        );
        assert(
            javascript && css,
            'The actual packed engine and opt-in styles must be bundled'
        );
        evidence.sdkInputs = inputs;
        evidence.harnessModuleSha256 = createHash('sha256')
            .update(readFileSync(new URL(import.meta.url)))
            .digest('hex');
        evidence.hostSha256 = createHash('sha256').update(source).digest('hex');
        evidence.bundleSha256 = createHash('sha256')
            .update(javascript.contents)
            .digest('hex');
        evidence.stylesSha256 = createHash('sha256')
            .update(css.contents)
            .digest('hex');
        const html =
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Owned complete Rich Text proof</title><link rel="stylesheet" href="/proof.css"><style>main{max-width:560px;margin:40px;font:16px/1.5 sans-serif}.me-rich-text{margin:12px 0}button{margin:4px}</style></head><body><main></main><script type="module" src="/proof.js"></script></body></html>';
        const image =
            '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#e0e7ff"/><circle cx="600" cy="400" r="220" fill="#6366f1"/><text x="600" y="420" text-anchor="middle" font-size="50" fill="white">Owned image</text></svg>';
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            const assets = {
                '/': ['text/html', html],
                '/proof.js': ['text/javascript', javascript.text],
                '/proof.css': ['text/css', css.text],
                '/owned-image.svg': ['image/svg+xml', image],
            };
            const asset = assets[request.url];
            if (asset) {
                response.setHeader('Content-Type', asset[0]);
                response.end(asset[1]);
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            'complete Rich Text server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({ serviceWorkers: 'block' });
        page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        await page.route('**/*', (route) =>
            new URL(route.request().url()).origin === origin
                ? route.continue()
                : (evidence.unexpectedRequests.push(
                      new URL(route.request().url()).origin
                  ),
                  route.abort())
        );
        const snapshot = () =>
            page.evaluate(() => window.completeRichTextProbe.snapshot());
        const update = (next) =>
            page.evaluate(
                (next) => window.completeRichTextProbe.update(next),
                next
            );
        const waitEditor = () => page.locator('.ProseMirror').waitFor();
        const reset = async (value, overrides = {}) => {
            const old = await snapshot();
            await update({
                value,
                readOnly: false,
                owner: old.state.owner + 1,
                ...overrides,
            });
            await waitEditor();
            await page.waitForFunction(
                (previous) =>
                    window.completeRichTextProbe.snapshot().handleId !==
                    previous,
                old.handleId
            );
            const next = await snapshot();
            assert.equal(next.roots, 1);
            assert(
                next.views
                    .filter((view) => view.id !== next.handleId)
                    .every((view) => view.destroyed)
            );
            return next;
        };
        const finish = async (name) => {
            const state = await snapshot();
            assert.deepEqual(evidence.pageErrors, []);
            assert.deepEqual(evidence.unexpectedRequests, []);
            evidence.reactVersion = state.reactVersion;
            evidence.results.push({
                name,
                status: 'passed',
                state,
                ax: await page.locator('body').ariaSnapshot(),
            });
            if (output)
                await page.screenshot({
                    path: join(output, 'complete-rich-text-' + name + '.png'),
                    fullPage: true,
                });
        };
        const nativePaste = async (text, focus) => {
            await update({ clipboard: text });
            await page
                .getByRole('button', {
                    name: 'Copy owned clipboard',
                    exact: true,
                })
                .click();
            await page.waitForFunction(() =>
                ['copied', 'failed'].includes(
                    window.completeRichTextProbe.snapshot().clipboard.state
                )
            );
            const copied = (await snapshot()).clipboard;
            assert.equal(
                copied.state,
                'copied',
                `Owned clipboard write unavailable: ${copied.error ?? 'unknown failure'}`
            );
            assert.equal(copied.value, text);
            await focus();
            await page.waitForFunction(() => {
                const state = window.completeRichTextProbe.snapshot();
                const native = state.nativeSelection;
                const selection = state.selection;
                if (
                    !state.focused ||
                    !native ||
                    !selection ||
                    native.anchorDocPosition === null ||
                    native.focusDocPosition === null
                )
                    return false;
                return (
                    Math.min(
                        native.anchorDocPosition,
                        native.focusDocPosition
                    ) === selection.from &&
                    Math.max(
                        native.anchorDocPosition,
                        native.focusDocPosition
                    ) === selection.to &&
                    native.collapsed === (selection.from === selection.to)
                );
            });
            const previousPastes = (await snapshot()).nativeEvents.filter(
                (event) => event.type === 'paste'
            ).length;
            await page.keyboard.press('ControlOrMeta+V');
            await page.waitForFunction(
                (previous) =>
                    window.completeRichTextProbe
                        .snapshot()
                        .nativeEvents.filter((event) => event.type === 'paste')
                        .length > previous,
                previousPastes
            );
            const paste = (await snapshot()).nativeEvents
                .filter((event) => event.type === 'paste')
                .at(-1);
            assert.equal(
                paste.trusted,
                true,
                'Clipboard coverage requires an actual native paste event'
            );
        };

        evidence.phase = 'formatted-editable-metadata';
        await page.goto(origin);
        await waitEditor();
        const editor = page.locator('.ProseMirror');
        let state = await snapshot();
        assert.equal(state.roots, 1);
        assert.equal(state.dom.editable, 'true');
        assert.equal(await editor.locator('strong').textContent(), 'Bold');
        assert.equal(await editor.locator('em').textContent(), 'italic');
        assert.equal(
            await editor.locator('input[type=checkbox]').isChecked(),
            false
        );
        assert.deepEqual(state.writes, []);
        await editor.focus();
        await page.keyboard.press('ControlOrMeta+End');
        await page.waitForFunction(() => {
            const state = window.completeRichTextProbe.snapshot();
            return (
                state.focused &&
                state.docEnd !== null &&
                state.selection?.from === state.docEnd &&
                state.selection.to === state.docEnd &&
                state.nativeSelection?.collapsed === true &&
                state.nativeSelection.anchorDocPosition === state.docEnd &&
                state.nativeSelection.focusDocPosition === state.docEnd
            );
        });
        const beforeEnd = await snapshot();
        evidence.beforeEnd = {
            handleId: beforeEnd.handleId,
            docEnd: beforeEnd.docEnd,
            nativeSelection: beforeEnd.nativeSelection,
            selection: beforeEnd.selection,
            focused: beforeEnd.focused,
            keyboardRuntime: beforeEnd.keyboardRuntime,
        };
        await page.keyboard.insertText(' tail');
        await page.waitForFunction(() =>
            window.completeRichTextProbe.snapshot().state.value.includes('tail')
        );
        const beforeMetadata = await snapshot();
        assert.equal(
            beforeMetadata.state.value,
            '**Bold** and *italic*\n\n[ ] task\n\n tail'
        );
        assert.equal(await editor.locator('p').last().textContent(), ' tail');
        await update({
            id: 'rich-editor-renamed',
            label: 'Renamed Synthetic Rich Text',
            ariaInvalid: true,
        });
        state = await snapshot();
        assert.equal(state.handleId, beforeMetadata.handleId);
        assert.deepEqual(state.selection, beforeMetadata.selection);
        assert.deepEqual(state.nativeSelection, beforeMetadata.nativeSelection);
        assert.equal(state.focused, true);
        assert.equal(state.dom.id, 'rich-editor-renamed');
        assert.equal(state.dom.invalid, 'true');
        await page.keyboard.insertText(' continued');
        await page.waitForFunction(() =>
            window.completeRichTextProbe
                .snapshot()
                .state.value.includes('tail continued')
        );
        assert.equal(
            (await snapshot()).state.value,
            '**Bold** and *italic*\n\n[ ] task\n\n tail continued'
        );
        assert.equal(
            await editor.locator('p').last().textContent(),
            ' tail continued'
        );
        await finish('formatted-editable-metadata');

        evidence.phase = 'keyboard-and-toolbar';
        await reset('Alpha word');
        await editor.focus();
        await page.keyboard.press('ControlOrMeta+Home');
        for (let index = 0; index < 5; index++)
            await page.keyboard.press('Shift+ArrowRight');
        await page.waitForFunction(() => {
            const state = window.completeRichTextProbe.snapshot();
            return (
                state.focused &&
                state.nativeSelection?.text === 'Alpha' &&
                state.selection?.from === 1 &&
                state.selection.to === 6 &&
                state.nativeSelection.anchorDocPosition === 1 &&
                state.nativeSelection.focusDocPosition === 6
            );
        });
        const beforeBold = await snapshot();
        assert.equal(beforeBold.nativeSelection.text, 'Alpha');
        assert.deepEqual(beforeBold.selection, { from: 1, to: 6 });
        evidence.beforeBold = {
            handleId: beforeBold.handleId,
            nativeSelection: beforeBold.nativeSelection,
            selection: beforeBold.selection,
            focused: beforeBold.focused,
            keyboardRuntime: beforeBold.keyboardRuntime,
        };
        await page.keyboard.press('ControlOrMeta+B');
        await page.waitForFunction(() =>
            window.completeRichTextProbe
                .snapshot()
                .state.value.includes('**Alpha**')
        );
        assert.equal(await editor.locator('strong').textContent(), 'Alpha');
        const bold = page.getByRole('button', { name: 'Bold', exact: true });
        await bold.waitFor();
        assert.equal(await bold.getAttribute('aria-pressed'), 'true');
        await bold.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(
            () =>
                !window.completeRichTextProbe
                    .snapshot()
                    .state.value.includes('**Alpha**')
        );
        assert.equal(await editor.locator('strong').count(), 0);
        assert(
            (await snapshot()).nativeEvents.some(
                (event) =>
                    event.type === 'keydown' &&
                    event.key === 'Enter' &&
                    event.trusted
            )
        );
        await finish('keyboard-and-toolbar');

        evidence.phase = 'native-paste';
        await reset('');
        await nativePaste('**Pasted strong**', () => editor.click());
        await page.waitForFunction(
            () =>
                window.completeRichTextProbe.snapshot().state.value ===
                '\\*\\*Pasted strong\\*\\*'
        );
        assert.equal(
            (await snapshot()).state.value,
            '\\*\\*Pasted strong\\*\\*'
        );
        assert.equal(await editor.textContent(), '**Pasted strong**');
        assert.equal(await editor.locator('strong').count(), 0);
        await reset('');
        await nativePaste('# Pasted heading\n\n**Pasted strong**', () =>
            editor.click()
        );
        await page.waitForFunction(() =>
            window.completeRichTextProbe
                .snapshot()
                .state.value.includes('**Pasted strong**')
        );
        assert.equal(
            await editor.locator('strong').textContent(),
            'Pasted strong'
        );
        assert.equal(
            await editor.locator('h1 .heading-content').textContent(),
            'Pasted heading'
        );
        assert.equal(
            (await snapshot()).state.value,
            '# Pasted heading\n\n**Pasted strong**'
        );
        await reset('```\ncode\n```');
        const code = editor.locator('pre code');
        await code.waitFor();
        await nativePaste(
            'https://example.invalid/owned-code-only',
            async () => {
                await code.click();
                await page.keyboard.press('End');
            }
        );
        await page.waitForFunction(() =>
            document
                .querySelector('.ProseMirror pre code')
                ?.textContent.includes(
                    'https://example.invalid/owned-code-only'
                )
        );
        assert.equal(await editor.locator('a').count(), 0);
        assert.match(
            (await snapshot()).state.value,
            /https:\/\/example\.invalid\/owned-code-only/
        );
        await finish('native-paste');

        evidence.phase = 'checkbox-storage-readonly';
        await reset('[ ] Owned task');
        const checkbox = editor.locator('input[type=checkbox]');
        await checkbox.click();
        await page.waitForFunction(() =>
            window.completeRichTextProbe
                .snapshot()
                .state.value.includes('[x] Owned task')
        );
        state = await snapshot();
        assert.doesNotMatch(state.state.value, /^- \[x\]/m);
        assert.equal(await checkbox.isChecked(), true);
        const beforeReadonly = state.writes.length;
        const readonlyHandle = state.handleId;
        await update({ readOnly: true });
        state = await snapshot();
        assert.equal(state.handleId, readonlyHandle);
        assert.equal(state.dom.editable, 'false');
        await editor.focus();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.type('Denied readonly edit');
        assert.equal((await snapshot()).writes.length, beforeReadonly);
        assert.equal((await snapshot()).state.value, state.state.value);
        assert.equal(await checkbox.isChecked(), true);
        await finish('checkbox-storage-readonly');

        evidence.phase = 'image-nodeview-caption-zoom';
        const ownedImageSrc = `${origin}/owned-image.svg`;
        await reset(`![Owned caption](${ownedImageSrc})`);
        const caption = editor.locator('.caption');
        // Chromium also renders a ProseMirror-separator IMG after this inline
        // NodeView. Keep the document asset distinct from that caret helper and
        // from the zoom portal; its source stays stable when the caption changes.
        const ownedImageSelector = `.image img[src="${ownedImageSrc}"]`;
        const ownedImage = editor.locator(ownedImageSelector);
        await ownedImage.waitFor();
        assert.equal(await editor.locator('.image img').count(), 1);
        assert.equal(await ownedImage.getAttribute('src'), ownedImageSrc);
        assert.equal(await ownedImage.getAttribute('alt'), 'Owned caption');
        await page.waitForFunction((selector) => {
            const images = document.querySelectorAll(
                `.ProseMirror ${selector}`
            );
            return (
                images.length === 1 &&
                images[0].complete &&
                images[0].naturalWidth > 0
            );
        }, ownedImageSelector);
        assert.equal(await caption.getAttribute('contenteditable'), 'true');
        await caption.fill('Edited owned caption');
        await page
            .getByRole('button', { name: 'Leave editor', exact: true })
            .click();
        await page.waitForFunction(() =>
            window.completeRichTextProbe
                .snapshot()
                .state.value.includes('![Edited owned caption]')
        );
        assert.equal(
            await ownedImage.getAttribute('alt'),
            'Edited owned caption'
        );
        await update({ readOnly: true });
        assert.equal(await caption.getAttribute('contenteditable'), 'false');
        const readonlyImageState = await snapshot();
        await caption.focus();
        await page.keyboard.type('Denied caption edit');
        assert.equal(await caption.textContent(), 'Edited owned caption');
        assert.equal(
            (await snapshot()).writes.length,
            readonlyImageState.writes.length
        );
        const beforeZoom = (await snapshot()).bodyPortals;
        await ownedImage.click();
        await page.waitForFunction(
            (baseline) =>
                window.completeRichTextProbe.snapshot().bodyPortals > baseline,
            beforeZoom
        );
        assert(
            (await page.locator('body > div img').count()) > 0,
            'Actual image zoom must own a body portal'
        );
        const beforeKeyboardReady = await snapshot();
        await page.waitForFunction(completeRichTextZoomKeyboardReady);
        const keyboardReady = await snapshot();
        for (const key of [
            'state',
            'writes',
            'handleId',
            'selection',
            'nativeSelection',
            'focused',
            'bodyPortals',
        ]) {
            assert.deepEqual(keyboardReady[key], beforeKeyboardReady[key]);
        }
        evidence.zoomKeyboardReadiness = {
            method: 'synthetic window-targeted Tab cancellation',
            nativeTabAcceptance: false,
            editorAndFocusUnchanged: true,
        };
        await page.keyboard.press('Escape');
        await page.waitForFunction(
            (baseline) =>
                window.completeRichTextProbe.snapshot().bodyPortals ===
                baseline,
            beforeZoom
        );
        assert.equal(await ownedImage.isVisible(), true);
        assert.equal(await caption.textContent(), 'Edited owned caption');
        const closedZoomState = await snapshot();
        assert.equal(
            closedZoomState.state.value,
            readonlyImageState.state.value
        );
        assert.deepEqual(closedZoomState.writes, readonlyImageState.writes);
        await finish('image-nodeview-caption-zoom');

        evidence.phase = 'owner-replacement-and-unmount';
        await ownedImage.click();
        await page.waitForFunction(
            (baseline) =>
                window.completeRichTextProbe.snapshot().bodyPortals > baseline,
            beforeZoom
        );
        await page.waitForFunction(completeRichTextZoomKeyboardReady);
        const oldImageOwner = (await snapshot()).handleId;
        await reset('**Fresh owner**');
        state = await snapshot();
        assert.notEqual(state.handleId, oldImageOwner);
        assert.equal(
            await editor.locator('strong').textContent(),
            'Fresh owner'
        );
        assert.equal(await page.locator('body > div img').count(), 0);
        await page.evaluate(() => window.completeRichTextProbe.unmount());
        await page.waitForFunction(
            () =>
                window.completeRichTextProbe.snapshot().roots === 0 &&
                window.completeRichTextProbe.snapshot().bodyPortals === 0
        );
        state = await snapshot();
        assert.equal(state.handleId, null);
        assert(
            state.views.length > 1 &&
                state.views.every((view) => view.destroyed)
        );
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.results.push({
            name: 'owner-replacement-and-unmount',
            status: 'passed',
            state,
        });
        assert.equal(evidence.results.length, 6);
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.completeRichTextProbe?.snapshot()
                );
                if (output)
                    await page.screenshot({
                        path: join(output, 'complete-rich-text-failure.png'),
                        fullPage: true,
                    });
            } catch (captureError) {
                evidence.failureCaptureError = captureError.message;
            }
        }
    } finally {
        for (const [name, cleanup] of [
            [
                'app',
                () =>
                    page?.evaluate(() =>
                        window.completeRichTextProbe?.unmount()
                    ),
            ],
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
                await bounded('complete Rich Text cleanup ' + name, cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.cleanup[name] = { error: error.message };
                evidence.status = 'failed';
                failure ??= error;
            }
        }
    }
    if (failure) throw failure;
}
