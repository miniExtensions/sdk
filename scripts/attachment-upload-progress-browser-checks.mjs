import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const source = (format) => `
${
    format === 'esm'
        ? `import {createElement as h,StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AttachmentUploadProgress} from '@miniextensions/sdk/react';`
        : `const {createElement:h,StrictMode,useState}=require('react');
const {createRoot}=require('react-dom/client');
const {AttachmentUploadProgress}=require('@miniextensions/sdk/react');`
}
const calls = {cancel: 0, submit: 0, fetch: 0};
window.fetch = () => { calls.fetch++; return Promise.reject(Error('Unexpected I/O')); };
function Host() {
    const [percentage,setPercentage]=useState(0);
    const [mounted,setMounted]=useState(true);
    window.uploadProgressProbe={setPercentage,setMounted,calls};
    return h('form',{onSubmit(event){event.preventDefault();calls.submit++;}},
        h('button',{type:'submit'},'Save fixture'),
        mounted && h(AttachmentUploadProgress,{
            percentage, labels:{uploading:'Téléversement',cancel:'Annuler'},
            onCancel(){calls.cancel++;}
        }));
}
createRoot(document.querySelector('main')).render(h(StrictMode,null,h(Host)));
`;

export async function checkAttachmentUploadProgressBrowser({
    browser,
    consumer,
    evidence,
}) {
    evidence.formats = {};
    for (const format of ['esm', 'cjs']) {
        const filename = `attachment-upload-progress-proof.${format === 'esm' ? 'mjs' : 'cjs'}`;
        writeFileSync(join(consumer, filename), source(format));
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: [filename],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        const require = createRequire(join(consumer, 'package.json'));
        const css = readFileSync(
            require.resolve(
                '@miniextensions/sdk/react/attachment-upload-progress.css'
            )
        );
        const requests = [];
        const pageErrors = [];
        let context;
        const server = createServer((req, res) => {
            requests.push(req.url);
            res.setHeader(
                'content-security-policy',
                "default-src 'self'; connect-src 'none'; form-action 'none'"
            );
            if (req.url === '/host.js') {
                res.setHeader('content-type', 'text/javascript');
                res.end(bundle.outputFiles[0].text);
            } else if (req.url === '/progress.css') {
                res.setHeader('content-type', 'text/css');
                res.end(css);
            } else if (req.url === '/') {
                res.setHeader('content-type', 'text/html');
                res.end(
                    '<!doctype html><html lang="fr"><meta charset="utf-8"><link rel="stylesheet" href="/progress.css"><main></main><script type="module" src="/host.js"></script></html>'
                );
            } else {
                res.statusCode = 404;
                res.end();
            }
        });
        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            const origin = `http://127.0.0.1:${server.address().port}`;
            context = await browser.newContext({ serviceWorkers: 'block' });
            const external = [];
            await context.route('**/*', (route) => {
                const url = route.request().url();
                if (new URL(url).origin === origin) return route.continue();
                external.push(url);
                return route.abort();
            });
            const page = await context.newPage();
            page.on('pageerror', (error) => pageErrors.push(error.message));
            await page.goto(origin);
            const bar = page.getByRole('progressbar', {
                name: 'Téléversement',
            });
            const cancel = page.getByRole('button', {
                name: 'Annuler',
                exact: true,
            });
            const readCalls = () =>
                page.evaluate(() => window.uploadProgressProbe.calls);
            const assertPercentage = async (percentage) => {
                await page.waitForFunction(
                    (value) =>
                        document.querySelector('progress')?.value === value,
                    percentage,
                    { timeout: 5000 }
                );
                await bar.waitFor({ timeout: 5000 });
                await page
                    .getByText(`${percentage}%`, { exact: true })
                    .waitFor({ timeout: 5000 });
                assert.equal(await bar.getAttribute('max'), '100');
            };
            await assertPercentage(0);
            for (const percentage of [50, 100]) {
                await page.evaluate(
                    (value) => window.uploadProgressProbe.setPercentage(value),
                    percentage
                );
                await assertPercentage(percentage);
                assert.deepEqual(await readCalls(), {
                    cancel: 0,
                    submit: 0,
                    fetch: 0,
                });
            }
            assert.equal(await cancel.getAttribute('type'), 'button');
            await cancel.click();
            assert.deepEqual(await readCalls(), {
                cancel: 1,
                submit: 0,
                fetch: 0,
            });
            await page.evaluate(() =>
                window.uploadProgressProbe.setMounted(false)
            );
            await bar.waitFor({ state: 'detached' });
            assert.deepEqual(await readCalls(), {
                cancel: 1,
                submit: 0,
                fetch: 0,
            });
            await page.evaluate(() =>
                window.uploadProgressProbe.setMounted(true)
            );
            await cancel.press('Enter');
            assert.deepEqual(await readCalls(), {
                cancel: 2,
                submit: 0,
                fetch: 0,
            });
            await page.evaluate(() =>
                window.uploadProgressProbe.setMounted(false)
            );
            await bar.waitFor({ state: 'detached' });
            assert.deepEqual(await readCalls(), {
                cancel: 2,
                submit: 0,
                fetch: 0,
            });
            assert.deepEqual(external, []);
            assert.deepEqual(pageErrors, []);
            assert(
                requests.every((request) =>
                    ['/', '/host.js', '/progress.css', '/favicon.ico'].includes(
                        request
                    )
                )
            );
            evidence.formats[format] = {
                percentages: [0, 50, 100],
                ...(await readCalls()),
            };
        } finally {
            try {
                await context?.close();
            } finally {
                if (server.listening) {
                    server.closeAllConnections();
                    await new Promise((resolve, reject) =>
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        )
                    );
                }
            }
        }
    }
}
