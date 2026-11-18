import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { richTextDocumentNavigationKeys } from './browser-complete-rich-text-checks.mjs';

// Native input through the installed canonical API. The host owns one draft and
// explicit submit; this fixture never supplies an SDK client or editor renderer.
export async function checkCanonicalRichTextBrowser({
    browser,
    consumer,
    evidence,
}) {
    Object.assign(evidence, {
        status: 'running',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    const root = realpathSync(consumer);
    const directory = mkdtempSync(join(root, '.canonical-rich-text-native-'));
    let server, context, page, failure;
    let caretEvidence = evidence;
    const source = `
import React,{createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {RichTextField} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/rich-text.css';
const writes=[],saves=[];let update,current,previous;
let stopCaretNavigation;
function startCaretNavigationTrace(withholdFirstSelectionChange) {
    const editor = document.querySelector('.ProseMirror');
    const events = [];
    const eventTypes = ['focusin', 'focusout', 'selectionchange', 'keydown', 'keyup'];
    let dropped = 0;
    let firstArrow = 'pending';
    let withheldSelectionChange = null;
    const position = () => {
        const selection = document.getSelection();
        return {
            active: document.activeElement === editor,
            connected: editor.isConnected,
            anchorInEditor: editor.contains(selection?.anchorNode),
            focusInEditor: editor.contains(selection?.focusNode),
            collapsed: selection?.isCollapsed,
            anchorOffset: selection?.anchorOffset,
            focusOffset: selection?.focusOffset,
        };
    };
    const initial = position();
    const capture = event => {
        if (event.type !== 'selectionchange' && !editor.contains(event.target))
            return;
        const sample = { event, at: performance.now(), position: position() };
        if (events.length === 64) dropped++;
        else events.push(sample);

        // Test-only stress: withhold just the first trusted movement's
        // notification while ArrowLeft is down. Leave the browser's actual
        // selection and all later native events alone.
        if (!withholdFirstSelectionChange || !event.isTrusted) return;
        if (firstArrow === 'pending' && event.type === 'keydown' && event.key === 'ArrowLeft') {
            firstArrow = 'down';
            return;
        }
        if (firstArrow !== 'down') return;
        if (event.type === 'keyup' && event.key === 'ArrowLeft') {
            firstArrow = 'released';
            return;
        }
        const native = sample.position;
        if (
            !withheldSelectionChange &&
            event.type === 'selectionchange' &&
            native.active &&
            native.connected &&
            native.collapsed &&
            native.anchorInEditor &&
            native.focusInEditor &&
            native.anchorOffset === 9 &&
            native.focusOffset === 9
        ) {
            withheldSelectionChange = { at: sample.at, position: native };
            event.stopImmediatePropagation();
        }
    };
    for (const type of eventTypes) document.addEventListener(type, capture, true);
    return () => {
        for (const type of eventTypes) document.removeEventListener(type, capture, true);
        return {
            initial,
            final: position(),
            dropped,
            withheldSelectionChange,
            events: events.map(({ event, at, position }) => ({
                type: event.type,
                key: event.key,
                trusted: event.isTrusted,
                defaultPrevented: event.defaultPrevented,
                at,
                position,
            })),
        };
    };
}
function App(){const [state,setState]=useState({value:'**Bold** and _italic_\\n\\n[ ] task',readOnly:false,identity:'record:notes',id:'notes',invalid:false,sibling:'untouched'});current=state;update=next=>flushSync(()=>setState(old=>({...old,...next})));
return h('form',{id:'owned-form',onSubmit:event=>{event.preventDefault();saves.push({...state});}},
h('label',{id:'notes-label',htmlFor:state.id},'Notes'),h('p',{id:'notes-help'},'Markdown details'),h('p',{id:'notes-error'},state.invalid?'Review notes':''),
h(RichTextField,{value:state.value,onValueChange:value=>{writes.push({identity:state.identity,value});setState(old=>({...old,value}));},readOnly:state.readOnly,identity:state.identity,id:state.id,ariaLabelledBy:'notes-label',ariaDescribedBy:'notes-help notes-error',ariaInvalid:state.invalid,placeholder:'Write notes',emptyContent:h('span',{id:'empty-notes'},'No notes')}),
h('label',null,'Neighbor',h('input',{id:'neighbor',value:state.sibling,onChange:event=>setState(old=>({...old,sibling:event.target.value}))})),h('button',{type:'submit',id:'save'},'Save'));
}
const app=createRoot(document.querySelector('main'));flushSync(()=>app.render(h(React.StrictMode,null,h(App))));
window.canonicalRichText={update,snapshot:()=>({state:{...current},writes:[...writes],saves:[...saves]}),remember:()=>{previous=document.querySelector('.ProseMirror');},same:()=>previous===document.querySelector('.ProseMirror'),staleEvent:()=>{previous?.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'stale'}));},startCaretNavigation:withhold=>{stopCaretNavigation=startCaretNavigationTrace(withhold);},finishCaretNavigation:()=>{const trace=stopCaretNavigation?.();stopCaretNavigation=undefined;return trace;},unmount:()=>{stopCaretNavigation?.();stopCaretNavigation=undefined;flushSync(()=>app.unmount());}};
`;
    try {
        const entry = join(directory, 'host.mjs');
        writeFileSync(entry, source);
        const bundle = await build({
            entryPoints: [entry],
            absWorkingDir: root,
            bundle: true,
            platform: 'browser',
            format: 'esm',
            outfile: join(directory, 'proof.js'),
            write: false,
            metafile: true,
            define: { 'process.env.NODE_ENV': '"production"' },
        });
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const inputs = Object.keys(bundle.metafile.inputs).filter((name) =>
            name.includes('/sdk/dist/')
        );
        assert(inputs.some((name) => name.endsWith('/react/RichTextField.js')));
        assert(
            inputs.some((name) =>
                name.includes('/vendor/rich-markdown-editor/')
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
        assert(javascript && css);
        evidence.sdkInputs = inputs;
        evidence.bundleSha256 = createHash('sha256')
            .update(javascript.contents)
            .digest('hex');
        evidence.stylesSha256 = createHash('sha256')
            .update(css.contents)
            .digest('hex');
        const assets = {
            '/': [
                'text/html',
                '<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="/proof.css"><style>main{max-width:640px;margin:32px;font:16px sans-serif}</style></head><body><main></main><script type="module" src="/proof.js"></script></body></html>',
            ],
            '/proof.js': ['text/javascript', javascript.text],
            '/proof.css': ['text/css', css.text],
        };
        server = createServer((request, response) => {
            const asset = assets[request.url];
            response.setHeader('Cache-Control', 'no-store');
            if (asset) {
                response.setHeader('Content-Type', asset[0]);
                response.end(asset[1]);
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
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
                : (evidence.unexpectedRequests.push(route.request().url()),
                  route.abort())
        );
        await page.goto(origin);
        const documentKeys = richTextDocumentNavigationKeys(
            await page.evaluate(() => navigator.platform)
        );
        const editor = page.getByRole('textbox', { name: 'Notes' });
        await editor.waitFor();
        const snapshot = () =>
            page.evaluate(() => window.canonicalRichText.snapshot());
        const update = (next) =>
            page.evaluate(
                (next) => window.canonicalRichText.update(next),
                next
            );
        assert.equal(await editor.locator('strong').innerText(), 'Bold');
        assert.equal(await editor.locator('em').innerText(), 'italic');
        assert.equal(await editor.locator('input[type=checkbox]').count(), 1);
        assert.equal(
            await editor.getAttribute('aria-describedby'),
            'notes-help notes-error'
        );
        assert.equal(
            await editor.evaluate((node) => node.closest('form')?.id),
            'owned-form'
        );
        assert.deepEqual((await snapshot()).writes, []);
        evidence.results.push(
            'formatted Markdown, checkbox, label/help/error and form ancestry'
        );
        await editor.click();
        await editor.press(documentKeys.end);
        await page.keyboard.type(' typed');
        await page.waitForFunction(() =>
            window.canonicalRichText.snapshot().state.value.includes('typed')
        );
        await editor.press('ControlOrMeta+b');
        await page.keyboard.type(' bold');
        await editor.press('ControlOrMeta+b');
        await page.waitForFunction(() =>
            window.canonicalRichText.snapshot().state.value.includes('**bold**')
        );
        assert.equal((await snapshot()).saves.length, 0);
        assert.equal(await page.locator('#neighbor').inputValue(), 'untouched');
        await page.evaluate(() => window.canonicalRichText.remember());
        await update({ id: 'notes-renamed', invalid: true });
        assert.equal(
            await page.evaluate(() => window.canonicalRichText.same()),
            true
        );
        assert.equal(await editor.getAttribute('aria-invalid'), 'true');
        await page.keyboard.type(' caret');
        await page.waitForFunction(() =>
            window.canonicalRichText.snapshot().state.value.includes('caret')
        );
        evidence.results.push(
            'native typing, formatting, metadata continuity and sibling isolation without submit'
        );
        await page.locator('#save').click();
        const saved = await snapshot();
        assert.equal(saved.saves.length, 1);
        assert.equal(saved.saves[0].value, saved.state.value);
        assert.equal(saved.saves[0].sibling, 'untouched');
        await update({ readOnly: true });
        const writes = (await snapshot()).writes.length;
        await editor.click();
        await page.keyboard.type(' refused');
        assert.equal((await snapshot()).writes.length, writes);
        assert.equal(await editor.getAttribute('contenteditable'), 'false');
        await update({ readOnly: false, identity: 'replacement:notes' });
        await editor.waitFor();
        assert.equal(
            await page.evaluate(() => window.canonicalRichText.same()),
            false
        );
        await page.evaluate(() => window.canonicalRichText.staleEvent());
        assert.equal((await snapshot()).writes.length, writes);
        await editor.click();
        await editor.press(documentKeys.end);
        await page.keyboard.type(' current');
        await page.waitForFunction(
            () =>
                window.canonicalRichText.snapshot().writes.at(-1)?.identity ===
                'replacement:notes'
        );
        evidence.results.push(
            'one explicit Save, readonly refusal, equal-value owner replacement and current writer'
        );

        // Keep the original formatted Save proof above. These additional cases
        // exercise native selection through the ordinary public controlled API.
        const nativeCaret = () =>
            editor.evaluate((node) => {
                const native = document.getSelection();
                return {
                    active: document.activeElement === node,
                    contained:
                        !!native?.anchorNode &&
                        node.contains(native.anchorNode),
                    collapsed: native?.isCollapsed,
                    anchorText: native?.anchorNode?.textContent,
                    anchorOffset: native?.anchorOffset,
                    focusOffset: native?.focusOffset,
                };
            });

        const checkMetadataCaret = async (
            result,
            identity,
            firstArrowDelayMs
        ) => {
            caretEvidence = result;
            await update({ identity, value: 'Alpha Beta' });
            await editor.waitFor();
            await page.waitForFunction(
                () =>
                    window.canonicalRichText.snapshot().state.value ===
                        'Alpha Beta' &&
                    document.querySelector('.ProseMirror')?.textContent ===
                        'Alpha Beta'
            );
            assert.equal(await page.locator('.ProseMirror').count(), 1);
            await page.evaluate(
                (withhold) =>
                    window.canonicalRichText.startCaretNavigation(withhold),
                result.withholdFirstSelectionChange === true
            );
            await editor.click();
            await editor.press(documentKeys.end);
            await page.waitForFunction(() => {
                const node = document.querySelector('.ProseMirror');
                const native = document.getSelection();
                return (
                    node?.textContent === 'Alpha Beta' &&
                    native?.isCollapsed &&
                    node.contains(native.anchorNode) &&
                    native.anchorNode?.textContent === 'Alpha Beta' &&
                    native.anchorOffset === 10
                );
            });
            for (let step = 0; step < 8; step++) {
                if (step === 0 && firstArrowDelayMs)
                    await editor.press('ArrowLeft', {
                        delay: firstArrowDelayMs,
                    });
                else await editor.press('ArrowLeft');
            }
            const beforeMetadata = await nativeCaret();
            result.caretNavigationBeforeMetadata = beforeMetadata;
            assert.equal(beforeMetadata.active, true);
            assert.equal(beforeMetadata.contained, true);
            assert.equal(beforeMetadata.collapsed, true);
            assert.equal(beforeMetadata.anchorText, 'Alpha Beta');
            assert.equal(beforeMetadata.anchorOffset, 2);
            assert.equal(beforeMetadata.focusOffset, 2);
            await page.evaluate(() => window.canonicalRichText.remember());
            const beforeCaretMetadata = await snapshot();
            await update({ id: 'notes-caret', invalid: false });
            assert.equal((await nativeCaret()).anchorOffset, 2);
            await page.locator('#neighbor').click();
            await update({ id: 'notes-caret-renamed', invalid: true });
            await editor.focus();
            await page.keyboard.type('Z');
            await page.waitForFunction(
                () =>
                    window.canonicalRichText.snapshot().state.value ===
                    'AlZpha Beta'
            );
            const afterCaretMetadata = await snapshot();
            assert.equal(await editor.innerText(), 'AlZpha Beta');
            assert.equal(
                await page.evaluate(() => window.canonicalRichText.same()),
                true
            );
            assert.equal(
                afterCaretMetadata.writes.length,
                beforeCaretMetadata.writes.length + 1
            );
            assert.deepEqual(afterCaretMetadata.writes.at(-1), {
                identity,
                value: 'AlZpha Beta',
            });
            assert.equal(afterCaretMetadata.saves.length, 1);
            assert.equal(
                await page.locator('#neighbor').inputValue(),
                'untouched'
            );
            result.caretNavigation = await page.evaluate(() =>
                window.canonicalRichText.finishCaretNavigation()
            );
            if (result.withholdFirstSelectionChange) {
                assert.ok(
                    result.caretNavigation.withheldSelectionChange,
                    'The delayed-observer comparison intercepted the first trusted caret movement'
                );
            }
            result.nativeMetadataCaret = {
                beforeMetadata,
                after: await nativeCaret(),
            };
        };
        await checkMetadataCaret(evidence, 'metadata-caret:notes');
        evidence.results.push(
            'trusted navigation caret survives accessibility updates, metadata blur and refocus with exact insertion'
        );

        // One additional native gesture probes the pinned ProseMirror focus
        // reconciliation window. Each case still starts from offset 10
        // and requires eight trusted movements and the same exact edit.
        const heldFirstArrow = { delayMs: 35, status: 'running' };
        evidence.heldFirstArrow = heldFirstArrow;
        await checkMetadataCaret(
            heldFirstArrow,
            'metadata-caret-held:notes',
            heldFirstArrow.delayMs
        );
        heldFirstArrow.status = 'passed';

        // The key hold alone allowed native observation before reconciliation.
        // Repeat it with only the first selectionchange withheld to test the
        // stale-model ordering without moving the caret from the fixture.
        const delayedFirstSelectionChange = {
            delayMs: heldFirstArrow.delayMs,
            withholdFirstSelectionChange: true,
            status: 'running',
        };
        evidence.delayedFirstSelectionChange = delayedFirstSelectionChange;
        await checkMetadataCaret(
            delayedFirstSelectionChange,
            'metadata-caret-delayed-observation:notes',
            delayedFirstSelectionChange.delayMs
        );
        delayedFirstSelectionChange.status = 'passed';
        caretEvidence = evidence;

        // A real pointer choice at the start must take precedence over the
        // retained non-start caret. Keep click-to-type adjacent, as above.
        await update({
            identity: 'pointer-caret:notes',
            value: 'Alpha Beta',
            id: 'notes-pointer',
            invalid: false,
        });
        await editor.waitFor();
        await page.waitForFunction(
            () =>
                window.canonicalRichText.snapshot().state.value ===
                    'Alpha Beta' &&
                document.querySelector('.ProseMirror')?.textContent ===
                    'Alpha Beta'
        );
        await editor.click();
        await editor.press(documentKeys.end);
        for (let step = 0; step < 8; step++) await editor.press('ArrowLeft');
        const beforePointerBlur = await nativeCaret();
        assert.equal(beforePointerBlur.active, true);
        assert.equal(beforePointerBlur.contained, true);
        assert.equal(beforePointerBlur.collapsed, true);
        assert.equal(beforePointerBlur.anchorOffset, 2);
        assert.equal(beforePointerBlur.focusOffset, 2);
        await page.evaluate(() => window.canonicalRichText.remember());
        const beforePointer = await snapshot();
        await page.locator('#neighbor').click();
        await update({ id: 'notes-pointer-renamed', invalid: true });
        const pointerPoint = await editor.evaluate((node) => {
            const text = node.querySelector('p')?.firstChild;
            if (
                text?.nodeType !== Node.TEXT_NODE ||
                text.textContent !== 'Alpha Beta'
            )
                throw new Error(
                    'Expected the real plain-text editor paragraph'
                );
            // This Range measures the first glyph only. It is never installed
            // in the document Selection; the trusted mouse chooses the caret.
            const range = document.createRange();
            range.setStart(text, 0);
            range.setEnd(text, 1);
            const rect = range.getBoundingClientRect();
            if (!(rect.width > 0 && rect.height > 0))
                throw new Error('Expected a visible first glyph');
            window.canonicalRichText.pointerGesture = null;
            node.addEventListener(
                'pointerdown',
                (event) => {
                    window.canonicalRichText.pointerGesture = {
                        trusted: event.isTrusted,
                        connected: node.isConnected,
                    };
                },
                { capture: true, once: true }
            );
            return {
                x: rect.left + Math.min(0.5, rect.width / 8),
                y: rect.top + rect.height / 2,
            };
        });
        await page.mouse.click(pointerPoint.x, pointerPoint.y);
        await page.keyboard.type('Z');
        await page.waitForFunction(
            () =>
                window.canonicalRichText.snapshot().state.value ===
                'ZAlpha Beta'
        );
        const afterPointer = await snapshot();
        assert.equal(await editor.innerText(), 'ZAlpha Beta');
        assert.equal(
            await page.evaluate(() => window.canonicalRichText.same()),
            true
        );
        assert.equal(
            afterPointer.writes.length,
            beforePointer.writes.length + 1
        );
        assert.deepEqual(afterPointer.writes.at(-1), {
            identity: 'pointer-caret:notes',
            value: 'ZAlpha Beta',
        });
        assert.equal(afterPointer.saves.length, 1);
        assert.equal(await page.locator('#neighbor').inputValue(), 'untouched');
        const pointerGesture = await page.evaluate(
            () => window.canonicalRichText.pointerGesture
        );
        assert.deepEqual(pointerGesture, { trusted: true, connected: true });
        evidence.nativePointerFocus = {
            beforePointerBlur,
            pointerPoint,
            pointerGesture,
            after: await nativeCaret(),
        };

        const precedingOwner = await editor.elementHandle();
        assert(precedingOwner);
        await update({
            identity: 'formatted-replacement:notes',
            value: '**Stored B**\n\n[x] B task',
        });
        await editor.waitFor();
        await editor
            .locator('strong')
            .filter({ hasText: 'Stored B' })
            .waitFor();
        assert.equal(await editor.locator('input[type=checkbox]').count(), 1);
        assert.equal(
            await editor.locator('input[type=checkbox]').isChecked(),
            true
        );
        assert.equal(
            (await snapshot()).state.value,
            '**Stored B**\n\n[x] B task'
        );
        assert.equal(await editor.locator('strong').innerText(), 'Stored B');
        assert((await editor.textContent())?.includes('B task'));
        assert.equal(await page.locator('.ProseMirror').count(), 1);
        assert.equal(
            await page.evaluate(() => window.canonicalRichText.same()),
            false
        );
        assert.equal(
            await precedingOwner.evaluate((node) => node.isConnected),
            false
        );
        await precedingOwner.dispose();
        await editor.focus();
        await editor.press('ControlOrMeta+a');
        const wholeFormattedRange = await editor.evaluate((node) => {
            const native = document.getSelection();
            if (
                document.activeElement !== node ||
                !native ||
                native.rangeCount !== 1 ||
                native.isCollapsed
            )
                return false;
            const range = native.getRangeAt(0);
            return (
                node.contains(range.startContainer) &&
                node.contains(range.endContainer) &&
                range.cloneContents().textContent === node.textContent
            );
        });
        assert.equal(wholeFormattedRange, true);
        await page.evaluate(() => window.canonicalRichText.remember());
        const beforeFirstEdit = await snapshot();
        assert.equal(beforeFirstEdit.state.value, '**Stored B**\n\n[x] B task');
        assert.equal(beforeFirstEdit.writes.length, afterPointer.writes.length);
        await page.keyboard.type('B first edit survives');
        await page.waitForFunction(
            () =>
                window.canonicalRichText.snapshot().state.value ===
                'B first edit survives'
        );
        const afterFirstEdit = await snapshot();
        const replacementWrites = afterFirstEdit.writes.slice(
            beforeFirstEdit.writes.length
        );
        assert.equal(await editor.innerText(), 'B first edit survives');
        assert.equal(
            await editor.locator('strong, em, input[type=checkbox]').count(),
            0
        );
        assert.equal(
            await page.evaluate(() => window.canonicalRichText.same()),
            true
        );
        assert(replacementWrites.length > 0);
        assert(
            replacementWrites.every(
                (write) => write.identity === 'formatted-replacement:notes'
            )
        );
        assert.deepEqual(replacementWrites.at(-1), {
            identity: 'formatted-replacement:notes',
            value: 'B first edit survives',
        });
        assert.equal(afterFirstEdit.saves.length, 1);
        assert.equal(await page.locator('#neighbor').inputValue(), 'untouched');
        evidence.formattedReplacementFirstEdit = {
            wholeFormattedRange,
            writes: replacementWrites.length,
            exactText: afterFirstEdit.state.value,
            sameEditor: await page.evaluate(() =>
                window.canonicalRichText.same()
            ),
        };
        evidence.results.push(
            'ready formatted owner accepts trusted select-all and immediate first typing as exact replacement'
        );

        const mixedPayload =
            '[x] Complete\n[ ] Pending\n\n- Item one\n- Item two';
        const mixedStored =
            '[x] Complete\n[ ] Pending\n\n* Item one\n* Item two\n\n\n';
        await update({
            identity: 'mixed-list:notes',
            value: 'Sentinel before mixed list',
        });
        await editor.waitFor();
        await editor.click();
        await editor.press('ControlOrMeta+a');
        assert.equal(
            await editor.evaluate(() => document.getSelection()?.toString()),
            'Sentinel before mixed list'
        );
        await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
            origin,
        });
        await page.evaluate(
            (text) => navigator.clipboard.writeText(text),
            mixedPayload
        );
        assert.deepEqual(
            await page.evaluate(async () => {
                const items = await navigator.clipboard.read();
                return Promise.all(
                    items.map(async (item) => ({
                        types: item.types,
                        text: await (await item.getType('text/plain')).text(),
                    }))
                );
            }),
            [{ types: ['text/plain'], text: mixedPayload }]
        );
        const beforeMixed = await snapshot();
        await editor.press('ControlOrMeta+v');
        await page.waitForFunction(
            (expected) =>
                window.canonicalRichText.snapshot().state.value === expected,
            mixedStored
        );
        const afterMixed = await snapshot();
        assert.equal(afterMixed.writes.length, beforeMixed.writes.length + 1);
        assert.deepEqual(afterMixed.writes.at(-1), {
            identity: 'mixed-list:notes',
            value: mixedStored,
        });
        assert.equal(
            await editor.evaluate((node) => node.textContent),
            'CompletePendingItem oneItem two'
        );
        assert.deepEqual(
            await editor
                .locator('input[type=checkbox]')
                .evaluateAll((inputs) => inputs.map((input) => input.checked)),
            [true, false]
        );
        assert.equal(
            await editor.locator('ul:not(.checkbox_list) > li').count(),
            2
        );
        assert.equal(afterMixed.saves.length, 1);
        assert.equal(await page.locator('#neighbor').inputValue(), 'untouched');
        evidence.results.push(
            'trusted plain-only mixed checklist/bullet clipboard replaces selected document with exact stored content and no implicit Save'
        );
        await update({ readOnly: true, value: null });
        await page.locator('#empty-notes').waitFor();
        assert.equal(await page.locator('.ProseMirror').count(), 0);
        assert.equal((await snapshot()).saves.length, 1);
        await page.evaluate(() => window.canonicalRichText.unmount());
        assert.equal(await page.locator('.ProseMirror').count(), 0);
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.results.push(
            'localized null preview and unmount cleanup without provider traffic'
        );
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (caretEvidence !== evidence) {
            caretEvidence.status = 'failed';
            caretEvidence.error = error.message;
        }
        if (page && !caretEvidence.caretNavigation)
            caretEvidence.caretNavigation = await page
                .evaluate(() =>
                    window.canonicalRichText?.finishCaretNavigation()
                )
                .catch(() => undefined);
        if (page)
            evidence.failureState = await page
                .evaluate(() => window.canonicalRichText?.snapshot())
                .catch(() => undefined);
    } finally {
        for (const [name, cleanup] of [
            [
                'app',
                () => page?.evaluate(() => window.canonicalRichText?.unmount()),
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
                () => rmSync(directory, { recursive: true, force: true }),
            ],
        ]) {
            try {
                await cleanup();
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
