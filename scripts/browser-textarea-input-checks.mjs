import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

// Installed public API, isolated browser context, synthetic drafts, no transport.
export async function checkTextareaInputBrowser({
    browser,
    consumer,
    evidence,
}) {
    evidence.status = 'running';
    evidence.results = [];
    evidence.pageErrors = [];
    evidence.unexpectedRequests = [];
    let directory, server, context;
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.textarea-input-'));
        const source = `
import React, {createElement as h, createRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {TextareaInput} from '@miniextensions/sdk/react';
const ref = createRef();
const root = createRoot(document.querySelector('main'));
let update;
const events = [];
const initial = {value:'',autoSize:{minRows:3,maxRows:30},boxSizing:'border-box',width:320,readOnly:false,disabled:false};
function App() {
    const [state,setState] = useState(initial); update = next => flushSync(()=>setState(old=>({...old,...next})));
    return h(TextareaInput,{value:state.value,autoSize:state.autoSize,readOnly:state.readOnly,disabled:state.disabled,placeholder:state.placeholder,wrap:state.wrap, ref, id:'notes', form:'host-form', name:'notes', rows:4,
        className:'host-style', 'aria-label':'Synthetic notes', 'aria-describedby':'help', maxLength:10000,
        style:{boxSizing:state.boxSizing,width:state.width,font:'16px/20px monospace',padding:4,border:'1px solid black',resize:'vertical',whiteSpace:state.whiteSpace,overflowWrap:state.overflowWrap},
        onChange:event=>{const value=event.currentTarget.value;events.push({type:'change',value});setState(old=>({...old,value}));},
        onCompositionStart:event=>events.push({type:event.type,data:event.data}),
        onCompositionEnd:event=>events.push({type:event.type,data:event.data}),
    });
}
window.textareaProbe = {update, events, current:()=>ref.current, snapshot:()=>({
    value:ref.current?.value,height:ref.current?.getBoundingClientRect().height,styleHeight:ref.current?.style.height,
    rows:ref.current?.rows,selection:[ref.current?.selectionStart,ref.current?.selectionEnd,ref.current?.selectionDirection],
    focused:document.activeElement===ref.current,form:ref.current?.form?.id, events:[...events],
    textareas:document.querySelectorAll('textarea').length,
}), unmount:()=>flushSync(()=>root.unmount())};
flushSync(()=>root.render(h(App)));
window.textareaProbe.update = next => update(next);
`;
        const entry = join(directory, 'host.mjs');
        writeFileSync(entry, source);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [entry],
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
        assert(inputs.some((p) => p.endsWith('/react/TextareaInput.js')));
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        evidence.bundleSha256 = createHash('sha256')
            .update(bundle.outputFiles[0].contents)
            .digest('hex');
        evidence.sdkInputs = inputs;
        const html =
            '<!doctype html><title>Synthetic textarea proof</title><form id="host-form"></form><p id="help">Synthetic help</p><main></main><script type="module" src="/proof.js"></script>';
        server = createServer((request, response) => {
            response.setHeader(
                'Content-Type',
                request.url === '/proof.js' ? 'text/javascript' : 'text/html'
            );
            response.end(
                request.url === '/proof.js' ? bundle.outputFiles[0].text : html
            );
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(String(error))
        );
        await page.route('**/*', (route) =>
            route
                .request()
                .url()
                .startsWith(origin + '/')
                ? route.continue()
                : (evidence.unexpectedRequests.push(route.request().url()),
                  route.abort())
        );
        await page.goto(origin);
        const snapshot = () =>
            page.evaluate(() => window.textareaProbe.snapshot());
        const update = (next) =>
            page.evaluate((next) => window.textareaProbe.update(next), next);
        const near = (actual, expected) =>
            assert(Math.abs(actual - expected) < 1, `${actual} != ${expected}`);
        near((await snapshot()).height, 70);
        assert.equal((await snapshot()).form, 'host-form');
        await update({ value: Array(8).fill('line').join('\n') });
        near((await snapshot()).height, 170);
        const long = Array(45).fill('preserve me').join('\n');
        await update({ value: long });
        near((await snapshot()).height, 610);
        assert.equal((await snapshot()).value, long);
        assert(
            await page
                .locator('textarea')
                .evaluate((node) => node.scrollHeight > node.clientHeight)
        );
        await update({ value: 'short' });
        near((await snapshot()).height, 70);
        await update({
            value: '',
            placeholder: Array(7).fill('hint').join('\n'),
        });
        near((await snapshot()).height, 150);
        evidence.results.push(
            'min/content/max rows, overflow, shrink and placeholder preserve literal draft'
        );
        await update({
            value: Array(60).fill('word').join(' '),
            placeholder: '',
        });
        const wide = (await snapshot()).height;
        await page.locator('textarea').evaluate((node) => {
            node.style.width = '140px';
            window.dispatchEvent(new Event('resize'));
        });
        assert((await snapshot()).height > wide);
        // Native rows=3 clone is an independent wrapping oracle; it has no SDK sizing.
        evidence.wrapping = [];
        const wrappingFailures = [];
        const spaced = Array(90).fill('word').join(' ');
        const unbroken = 'W'.repeat(180);
        for (const scenario of [
            {
                name: 'default-soft',
                value: spaced,
                wrap: 'soft',
                expected: true,
            },
            {
                name: 'native-hard',
                value: spaced,
                wrap: 'hard',
                expected: true,
            },
            { name: 'native-off', value: spaced, wrap: 'off', expected: false },
            {
                name: 'css-pre',
                value: spaced,
                wrap: 'soft',
                whiteSpace: 'pre',
                overflowWrap: 'normal',
                expected: false,
            },
            {
                name: 'css-normal-unbroken',
                value: unbroken,
                wrap: 'soft',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'normal',
                expected: false,
            },
            {
                name: 'css-anywhere-unbroken',
                value: unbroken,
                wrap: 'soft',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                expected: true,
            },
            {
                name: 'css-override-native-off',
                value: unbroken,
                wrap: 'off',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
            },
        ]) {
            await update({
                value: scenario.value,
                width: 160,
                wrap: scenario.wrap,
                whiteSpace: scenario.whiteSpace,
                overflowWrap: scenario.overflowWrap,
            });
            const actual = await page.locator('textarea').evaluate((node) => {
                const reference = node.cloneNode(false);
                reference.removeAttribute('id');
                reference.removeAttribute('form');
                reference.removeAttribute('name');
                reference.value = node.value;
                reference.rows = 3;
                reference.style.removeProperty('height');
                reference.style.position = 'absolute';
                reference.style.visibility = 'hidden';
                document.body.append(reference);
                try {
                    const style = getComputedStyle(node);
                    return {
                        height: node.getBoundingClientRect().height,
                        nativeMinimum: reference.getBoundingClientRect().height,
                        nativeWraps:
                            reference.scrollHeight > reference.clientHeight + 1,
                        horizontal: node.scrollWidth > node.clientWidth,
                        referenceHorizontal:
                            reference.scrollWidth > reference.clientWidth,
                        wrap: node.wrap,
                        whiteSpace: style.whiteSpace,
                        overflowWrap: style.overflowWrap,
                        value: node.value,
                    };
                } finally {
                    reference.remove();
                }
            });
            const { value, ...geometry } = actual;
            evidence.wrapping.push({ name: scenario.name, ...geometry });
            try {
                assert.equal(value, scenario.value);
                if (scenario.expected !== undefined)
                    assert.equal(
                        actual.nativeWraps,
                        scenario.expected,
                        scenario.name + ' native reference'
                    );
                if (actual.nativeWraps)
                    assert(
                        actual.height > actual.nativeMinimum,
                        scenario.name + ' should grow with native wrapping'
                    );
                else near(actual.height, actual.nativeMinimum);
            } catch (error) {
                wrappingFailures.push({
                    name: scenario.name,
                    error: String(error),
                });
            }
        }
        assert.deepEqual(
            wrappingFailures,
            [],
            'Autosizing must match native wrap and CSS wrapping'
        );
        evidence.results.push(
            'native wrap off/default and white-space/overflow-wrap overrides match an unsized native textarea'
        );
        await update({
            wrap: 'soft',
            whiteSpace: undefined,
            overflowWrap: undefined,
        });
        await update({ value: 'short', boxSizing: 'content-box' });
        near((await snapshot()).height, 70);
        // CSS height is content-only for content-box; borders/padding stay intact.
        near(parseFloat((await snapshot()).styleHeight), 60);
        await page.locator('textarea').evaluate((node) => {
            node.style.lineHeight = '24px';
            document.fonts.dispatchEvent(new Event('loadingdone'));
        });
        near(parseFloat((await snapshot()).styleHeight), 72);
        evidence.results.push(
            'window width and font-loading resize; border/content box geometry'
        );
        await update({
            value: 'abcdef',
            boxSizing: 'border-box',
            autoSize: undefined,
        });
        const native = await snapshot();
        assert.equal(native.rows, 4);
        assert.equal(native.styleHeight, '');
        await page.locator('textarea').focus();
        await page.locator('textarea').evaluate((node) => {
            window.originalTextarea = node;
            node.setSelectionRange(2, 4, 'backward');
        });
        await update({ autoSize: { minRows: 3, maxRows: 30 } });
        assert(
            await page
                .locator('textarea')
                .evaluate((node) => node === window.originalTextarea)
        );
        assert.deepEqual((await snapshot()).selection, [2, 4, 'backward']);
        assert((await snapshot()).focused);
        await page.keyboard.insertText('字');
        assert.equal((await snapshot()).value, 'ab字ef');
        await page.locator('textarea').evaluate((node) => {
            node.dispatchEvent(
                new CompositionEvent('compositionstart', {
                    bubbles: true,
                    data: '字',
                })
            );
            node.dispatchEvent(
                new CompositionEvent('compositionend', {
                    bubbles: true,
                    data: '字',
                })
            );
        });
        assert.deepEqual(
            (await snapshot()).events
                .slice(-2)
                .map((e) => ({ type: e.type, data: e.data })),
            [
                { type: 'compositionstart', data: '字' },
                { type: 'compositionend', data: '字' },
            ]
        );
        await page.locator('textarea').fill('  literal <b>\nsecond\n');
        assert.equal((await snapshot()).value, '  literal <b>\nsecond\n');
        const count = (await snapshot()).events.length;
        await update({ readOnly: true });
        await page.keyboard.insertText('denied');
        assert.equal((await snapshot()).events.length, count);
        await update({ disabled: true });
        assert(await page.locator('textarea').isDisabled());
        assert.equal((await snapshot()).textareas, 1);
        evidence.results.push(
            'same native ref, focus, backward selection, keyboard input, literal whitespace and DOM composition forwarding (not OS IME proof)'
        );
        await page.evaluate(() => window.textareaProbe.unmount());
        assert.equal(
            await page.evaluate(() => window.textareaProbe.current()),
            null
        );
        assert.equal(await page.locator('textarea').count(), 0);
        await page.evaluate(() => {
            window.dispatchEvent(new Event('resize'));
            document.fonts.dispatchEvent(new Event('loadingdone'));
        });
        assert.deepEqual(evidence.unexpectedRequests, []);
        assert.deepEqual(evidence.pageErrors, []);
        evidence.results.push(
            'default four rows, disabled/read-only policy, zero transport and clean unmount'
        );
        evidence.status = 'passed';
    } catch (error) {
        evidence.status = 'failed';
        evidence.error = String(error);
        throw error;
    } finally {
        try {
            await context?.close();
        } finally {
            try {
                if (server)
                    await new Promise((resolve, reject) =>
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        )
                    );
            } finally {
                if (directory)
                    rmSync(directory, { recursive: true, force: true });
            }
        }
        evidence.cleanup = 'context/server/temporary fixture removed';
    }
}
