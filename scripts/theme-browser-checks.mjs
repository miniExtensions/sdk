import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { browserMain } from './build-theme-browser-proof.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

/** Installed SDK proof only. Native accepted-state and Modal tests live in the monorepo. */
export async function checkThemeBrowser({
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
    });
    const root = realpathSync(consumer);
    const directory = mkdtempSync(join(root, '.theme-browser-'));
    let server, context;
    try {
        for (const format of ['esm', 'cjs']) {
            const entry = join(directory, 'entry.js');
            writeFileSync(
                entry,
                `import React from 'react';import {createRoot} from 'react-dom/client';import {createPortal,flushSync} from 'react-dom';import * as SDK from '${join(root, `node_modules/@miniextensions/sdk/dist/${format}/react/index.js`)}';import * as UI from '${join(root, `node_modules/@miniextensions/sdk/dist/${format}/ui/index.js`)}';(${browserMain.toString()})();`
            );
            const bundle = await build({
                absWorkingDir: root,
                entryPoints: [entry],
                bundle: true,
                platform: 'browser',
                format: 'esm',
                target: 'es2022',
                write: false,
                metafile: true,
                outfile: 'theme.js',
                define: { 'process.env.NODE_ENV': '"development"' },
            });
            await assertBrowserInputs(bundle.metafile, root);
            const installed = join(
                root,
                'node_modules/@miniextensions/sdk/dist/esm/react'
            );
            const base =
                ['button', 'text', 'localized-numeric', 'complete-duration']
                    .map((n) =>
                        readFileSync(join(installed, n + '.css'), 'utf8')
                    )
                    .join('\n') +
                '\n.native-numeric{--mx-sdk-accent:rgb(var(--theme-600));}.native-complete-duration{--mx-sdk-accent:rgb(var(--theme-500));}';
            const theme = readFileSync(join(installed, 'theme.css'), 'utf8');
            server = createServer((request, response) => {
                const url = new URL(request.url, 'http://localhost');
                response.setHeader('Cache-Control', 'no-store');
                if (url.pathname === '/theme.js') {
                    response.setHeader('Content-Type', 'text/javascript');
                    response.end(bundle.outputFiles[0].contents);
                } else if (url.pathname === '/style.css') {
                    response.setHeader('Content-Type', 'text/css');
                    response.end(
                        base + (url.searchParams.has('no-css') ? '' : theme)
                    );
                } else if (url.pathname === '/') {
                    const noCSS = url.searchParams.has('no-css');
                    response.setHeader('Content-Type', 'text/html');
                    response.end(
                        `<!doctype html><html><head><link rel="stylesheet" href="/style.css${noCSS ? '?no-css' : ''}"></head><body data-format="${format}" data-no-css="${noCSS}"><button id="run">Run style checks</button><select id="palette" aria-label="Palette"><option>green</option><option>rose</option><option>blue</option><option>yellow-light</option></select><button id="custom">Toggle custom tokens</button><button id="teardown">Toggle preview</button><p id="results" role="status">Ready</p><div id="preview"></div><div id="editor"></div><div id="portal"></div><script type="module" src="/theme.js"></script></body></html>`
                    );
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
            context = await browser.newContext({
                viewport: { width: 1180, height: 940 },
            });
            await context.route('**/*', (route) => {
                if (new URL(route.request().url()).origin === origin)
                    return route.continue();
                evidence.unexpectedRequests.push(route.request().url());
                return route.abort();
            });
            const page = await context.newPage();
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            for (const noCSS of [false, true]) {
                await page.goto(origin + (noCSS ? '/?no-css' : ''));
                await page
                    .getByRole('button', {
                        name: 'Run style checks',
                        exact: true,
                    })
                    .click();
                await page.waitForFunction(
                    () =>
                        document.getElementById('results').dataset.state !==
                        undefined,
                    {},
                    { timeout: 10000 }
                );
                assert.equal(
                    await page.locator('#results').getAttribute('data-state'),
                    'passed',
                    await page.locator('#results').textContent()
                );
                if (!noCSS) {
                    await page.locator('#inherited-button button').hover();
                    assert.equal(
                        await page
                            .locator('#inherited-button button')
                            .evaluate(
                                (node) => getComputedStyle(node).backgroundColor
                            ),
                        'rgb(21, 128, 61)'
                    );
                }
                await page.locator('#numeric').click();
                await page.keyboard.press('Tab');
                assert.equal(
                    await page.locator(':focus').getAttribute('id'),
                    'duration'
                );
                await page.screenshot({
                    path: join(
                        output,
                        `theme-${format}${noCSS ? '-no-css' : ''}.png`
                    ),
                    fullPage: true,
                });
                evidence.results.push({ format, noCSS, status: 'passed' });
            }
            await context.close();
            context = null;
            await new Promise((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
            server = null;
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
    } catch (error) {
        evidence.status = 'failed';
        evidence.error = String(error);
        throw error;
    } finally {
        if (context) await context.close();
        if (server) await new Promise((resolve) => server.close(resolve));
        rmSync(directory, { recursive: true, force: true });
    }
}
