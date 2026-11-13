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

/** Synthetic presentation only: never calls a provider, Save or permissions API. */
export async function checkFormSubmitBrowser({
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
    let directory, server, context, page;
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.form-submit-browser-'));
        const source = `import React,{createElement as h,useState}from'react';import{createRoot}from'react-dom/client';import{FormSubmitButton}from'@miniextensions/sdk/react';
function App(){const[state,setState]=useState({label:'Save <literal>',mode:'save',saving:false,canSubmit:true});window.submitProof={patch:patch=>setState(old=>({...old,...patch})),count:window.submitProof?.count??0};return h(React.StrictMode,null,h('form',{id:'owned-form',noValidate:true,onSubmit:event=>{event.preventDefault();window.submitProof.count++;}},h('input',{id:'answer',name:'answer',required:true})),h(FormSubmitButton,{...state,formId:'owned-form'}));}createRoot(document.querySelector('main')).render(h(App));`;
        const entry = join(directory, 'proof.mjs');
        writeFileSync(entry, source);
        const bundle = await build({
            entryPoints: [entry],
            absWorkingDir: root,
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
            logLevel: 'silent',
        });
        assertBrowserInputs(bundle.metafile, root);
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const inputs = Object.keys(bundle.metafile.inputs).filter((name) =>
            name.includes('@miniextensions/sdk')
        );
        assert(
            inputs.some((name) => name.endsWith('/react/FormSubmitButton.js'))
        );
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/form-submit.css')
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
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'"
            );
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (path === '/form-submit.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/form-submit.css"><main></main><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await new Promise((yes, no) => {
            server.once('error', no);
            server.listen(0, '127.0.0.1', yes);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
            serviceWorkers: 'block',
            viewport: { width: 390, height: 844 },
        });
        page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        await page.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (
                url.origin === origin &&
                ['/', '/proof.js', '/form-submit.css'].includes(url.pathname)
            )
                return route.continue();
            evidence.unexpectedRequests.push(url.origin + url.pathname);
            return route.abort();
        });
        await page.goto(origin);
        const button = page.getByRole('button', {
            name: 'Save <literal>',
            exact: true,
        });
        await button.waitFor();
        assert.equal(await page.evaluate(() => window.submitProof.count), 0);
        assert.equal(await button.getAttribute('type'), 'submit');
        assert.equal(
            await button.evaluate((node) => node.form?.id),
            'owned-form'
        );
        assert.equal(await button.locator('literal').count(), 0);
        await button.click();
        assert.equal(await page.evaluate(() => window.submitProof.count), 1);
        await page.locator('#answer').focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.submitProof.count), 2);
        evidence.results.push({
            name: 'external-associated-form-click-and-real-enter',
            submits: 2,
        });
        for (const patch of [
            { saving: true },
            { saving: false, canSubmit: false },
        ]) {
            await page.evaluate(
                (patch) => window.submitProof.patch(patch),
                patch
            );
            await page.waitForFunction(
                () => document.querySelector('button').disabled
            );
            await page.locator('#answer').focus();
            await page.keyboard.press('Enter');
            assert.equal(
                await page.evaluate(() => window.submitProof.count),
                2
            );
        }
        await page.evaluate(() =>
            window.submitProof.patch({
                canSubmit: true,
                mode: 'review',
                label: 'Review',
            })
        );
        await page.waitForFunction(
            () => document.querySelector('button').textContent === 'Review'
        );
        const review = page.getByRole('button', {
            name: 'Review',
            exact: true,
        });
        assert.equal(
            await review.evaluate(
                (node) => getComputedStyle(node).backgroundColor
            ),
            'rgb(22, 163, 74)'
        );
        await review.focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => window.submitProof.count), 3);
        await page.evaluate(() =>
            window.submitProof.patch({
                mode: 'compute',
                label: 'Compute',
                saving: true,
            })
        );
        await page.waitForFunction(
            () => document.querySelector('button').textContent === 'Compute'
        );
        const compute = page.getByRole('button', {
            name: 'Compute',
            exact: true,
        });
        assert.equal(
            await compute.evaluate(
                (node) => getComputedStyle(node).backgroundColor
            ),
            'rgb(75, 85, 99)'
        );
        assert.equal(await compute.locator('svg[aria-hidden=true]').count(), 1);
        assert.equal(
            await compute
                .locator('svg')
                .evaluate((node) => getComputedStyle(node).color),
            'rgb(255, 255, 255)'
        );
        evidence.results.push({
            name: 'saving-admission-refusal-retry-and-native-modes',
            submits: 3,
        });
        await page.screenshot({
            path: join(output, 'form-submit-control.png'),
        });
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
    } finally {
        if (page) {
            await page.close();
            evidence.cleanup.page = 'closed';
        }
        if (context) {
            await context.close();
            evidence.cleanup.context = 'closed';
        }
        if (server) {
            await new Promise((yes, no) =>
                server.close((error) => (error ? no(error) : yes()))
            );
            evidence.cleanup.server = 'closed';
        }
        if (directory) {
            rmSync(directory, { recursive: true, force: true });
            evidence.cleanup.files = 'removed';
        }
    }
}
