import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

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
    const source = `
import React,{createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {RichTextField} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/rich-text.css';
const writes=[],saves=[];let update,current,previous;
function App(){const [state,setState]=useState({value:'**Bold** and _italic_\\n\\n[ ] task',readOnly:false,identity:'record:notes',id:'notes',invalid:false,sibling:'untouched'});current=state;update=next=>flushSync(()=>setState(old=>({...old,...next})));
return h('form',{id:'owned-form',onSubmit:event=>{event.preventDefault();saves.push({...state});}},
h('label',{id:'notes-label',htmlFor:state.id},'Notes'),h('p',{id:'notes-help'},'Markdown details'),h('p',{id:'notes-error'},state.invalid?'Review notes':''),
h(RichTextField,{value:state.value,onValueChange:value=>{writes.push({identity:state.identity,value});setState(old=>({...old,value}));},readOnly:state.readOnly,identity:state.identity,id:state.id,ariaLabelledBy:'notes-label',ariaDescribedBy:'notes-help notes-error',ariaInvalid:state.invalid,placeholder:'Write notes',emptyContent:h('span',{id:'empty-notes'},'No notes')}),
h('label',null,'Neighbor',h('input',{id:'neighbor',value:state.sibling,onChange:event=>setState(old=>({...old,sibling:event.target.value}))})),h('button',{type:'submit',id:'save'},'Save'));
}
const app=createRoot(document.querySelector('main'));flushSync(()=>app.render(h(React.StrictMode,null,h(App))));
window.canonicalRichText={update,snapshot:()=>({state:{...current},writes:[...writes],saves:[...saves]}),remember:()=>{previous=document.querySelector('.ProseMirror');},same:()=>previous===document.querySelector('.ProseMirror'),staleEvent:()=>{previous?.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'stale'}));},unmount:()=>flushSync(()=>app.unmount())};
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
        await editor.press('ControlOrMeta+End');
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
        await editor.press('ControlOrMeta+End');
        await page.keyboard.type(' current');
        await page.waitForFunction(
            () =>
                window.canonicalRichText.snapshot().writes.at(-1)?.identity ===
                'replacement:notes'
        );
        evidence.results.push(
            'one explicit Save, readonly refusal, equal-value owner replacement and current writer'
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
