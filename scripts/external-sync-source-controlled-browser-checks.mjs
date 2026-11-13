import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const bounded = async (action) => {
    let timer;
    try {
        return await Promise.race([
            action(),
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(Error('Source proof timeout')),
                    10000
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
};

/** Installed ESM/CJS readonly field; only task-owned loopback navigation is allowed. */
export async function checkExternalSyncSourceControlledBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    const root = realpathSync(consumer);
    const installed = realpathSync(
        join(root, 'node_modules/@miniextensions/sdk')
    );
    const directory = mkdtempSync(join(root, '.external-source-proof-'));
    let server, context;
    evidence.results = [];
    evidence.inputs = {};
    evidence.pageErrors = [];
    evidence.unexpectedRequests = [];
    try {
        const assets = new Map([
            [
                '/source.css',
                readFileSync(
                    join(installed, 'dist/esm/react/complete-readonly-text.css')
                ),
            ],
        ]);
        for (const format of ['esm', 'cjs']) {
            const imports =
                format === 'esm'
                    ? "import React from 'react';import {createRoot} from 'react-dom/client';import {ExternalSyncSourceField} from '@miniextensions/sdk/react';"
                    : "const React=require('react');const {createRoot}=require('react-dom/client');const {ExternalSyncSourceField}=require('@miniextensions/sdk/react');";
            const source =
                imports +
                `
const {createElement:h,useState}=React;
let rowClicks=0,submits=0;
function App(){const [value,setValue]=useState('Native Ω '+location.origin+'/link-target');
return h('form',{onSubmit:e=>{e.preventDefault();submits++;},style:{maxWidth:320}},
h('button',{type:'button',onClick:()=>setValue(null)},'Empty source'),
h('div',{onClick:()=>rowClicks++,'data-source':''},h(ExternalSyncSourceField,{mode:'controlled',value,language:'fr',textSize:'small',layout:'cell-fit-content'})),
h('button',{type:'button',onClick:()=>setValue('Replacement Ω plain source')},'Replace source'),
h('label',null,'Adjacent draft',h('input',{defaultValue:'Keep draft'})),h('button',{type:'submit'},'Explicit Save'));}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.sourceProof=()=>({react:React.version,rowClicks,submits});`;
            const entry = join(
                directory,
                'host.' + (format === 'esm' ? 'mjs' : 'cjs')
            );
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
            const inputs = Object.keys(bundle.metafile.inputs).filter((path) =>
                path.includes('/sdk/dist/')
            );
            assert(
                inputs.some((path) =>
                    path.endsWith('/react/ExternalSyncSourceField.js')
                )
            );
            for (const input of inputs)
                assert(
                    realpathSync(resolve(root, input)).startsWith(
                        installed + '/'
                    )
                );
            evidence.inputs[format] = inputs;
            evidence[format + 'HostSha256'] = createHash('sha256')
                .update(source)
                .digest('hex');
            assets.set('/' + format + '.js', bundle.outputFiles[0].contents);
        }
        server = createServer((request, response) => {
            const url = new URL(request.url, 'http://localhost');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; form-action 'none'"
            );
            if (url.pathname === '/') {
                const format = url.searchParams.get('format');
                assert(['esm', 'cjs'].includes(format));
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>External source proof</title><link rel="stylesheet" href="/source.css"><main></main><script type="module" src="/' +
                        format +
                        '.js"></script>'
                );
            } else if (url.pathname === '/link-target') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><title>Owned link target</title>Local synthetic destination'
                );
            } else if (assets.has(url.pathname)) {
                response.setHeader(
                    'Content-Type',
                    url.pathname.endsWith('.css')
                        ? 'text/css'
                        : 'text/javascript'
                );
                response.end(assets.get(url.pathname));
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = 'http://127.0.0.1:' + server.address().port;
        for (const format of ['esm', 'cjs']) {
            context = await browser.newContext({
                serviceWorkers: 'block',
                viewport: { width: 390, height: 844 },
            });
            await context.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (
                    url.origin === origin &&
                    [
                        '/',
                        '/link-target',
                        '/source.css',
                        '/esm.js',
                        '/cjs.js',
                    ].includes(url.pathname)
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            const page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            await page.goto(origin + '/?format=' + format);
            const display = page.locator('[data-source]');
            const link = display.getByRole('link');
            await link.waitFor();
            assert.equal(
                await display.locator('input,button,select,textarea').count(),
                0
            );
            await display
                .locator('p.read-only-text')
                .click({ position: { x: 3, y: 3 } });
            assert.equal(
                (await page.evaluate(() => window.sourceProof())).rowClicks,
                1
            );
            await page
                .getByRole('button', { name: 'Empty source', exact: true })
                .focus();
            await page.keyboard.press('Tab');
            assert.equal(
                await link.evaluate((node) => node === document.activeElement),
                true
            );
            const [popup] = await Promise.all([
                context.waitForEvent('page', { timeout: 5000 }),
                link.press('Enter'),
            ]);
            await popup.waitForLoadState();
            assert.equal(popup.url(), origin + '/link-target');
            await popup.close();
            assert.equal(
                (await page.evaluate(() => window.sourceProof())).rowClicks,
                1
            );
            assert.equal(
                (await page.evaluate(() => window.sourceProof())).submits,
                0
            );
            await page
                .getByRole('button', { name: 'Empty source', exact: true })
                .click();
            assert.equal(await display.textContent(), 'Pas de Valeur');
            assert.equal(await display.getByRole('link').count(), 0);
            await page
                .getByRole('button', { name: 'Replace source', exact: true })
                .click();
            assert.equal(
                await display.textContent(),
                'Replacement Ω plain source'
            );
            assert.equal(await display.getByRole('link').count(), 0);
            assert.equal(
                await page
                    .getByRole('textbox', { name: 'Adjacent draft' })
                    .inputValue(),
                'Keep draft'
            );
            await page
                .getByRole('button', { name: 'Explicit Save', exact: true })
                .click();
            assert.equal(
                (await page.evaluate(() => window.sourceProof())).submits,
                1
            );
            await page.screenshot({
                path: join(output, 'external-source-' + format + '.png'),
                fullPage: true,
            });
            evidence.results.push({
                format,
                ...(await page.evaluate(() => window.sourceProof())),
            });
            await context.close();
            context = null;
        }
        assert.deepEqual(evidence.unexpectedRequests, []);
        assert.deepEqual(evidence.pageErrors, []);
        evidence.scope =
            'Synthetic installed readonly field; no provider, sync or native acceptance';
    } finally {
        const errors = [];
        const cleanup = {
            contextClosed: !context,
            serverClosed: !server?.listening,
            sourceDirectoryRemoved: false,
        };
        try {
            if (context) {
                await bounded(() => context.close());
                cleanup.contextClosed = true;
            }
        } catch (error) {
            errors.push(error);
        }
        try {
            if (server?.listening) {
                await bounded(
                    () =>
                        new Promise((resolve, reject) =>
                            server.close((error) =>
                                error ? reject(error) : resolve()
                            )
                        )
                );
                cleanup.serverClosed = true;
            }
        } catch (error) {
            errors.push(error);
        }
        try {
            rmSync(directory, { recursive: true, force: true });
            cleanup.sourceDirectoryRemoved = !existsSync(directory);
        } catch (error) {
            errors.push(error);
        }
        evidence.cleanup = cleanup;
        if (errors.length)
            throw new AggregateError(
                errors,
                'External source proof cleanup failed'
            );
    }
}
