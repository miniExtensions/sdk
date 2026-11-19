import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, relative } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { portalPagingControlsFixture } from './portal-paging-controls-fixture.mjs';
import { readonlyPortalListFixture } from './readonly-portal-list-fixture.mjs';

const browserProgram = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import * as api from '@miniextensions/sdk/react';
import * as ui from '@miniextensions/sdk/ui';
import {createPagingFixture} from './paging-fixture.mjs';
const root=createRoot(document.querySelector('main'));
const fixture=createPagingFixture({React,api,ui,layout:React.version==='18.3.1'?'list':'grid'});
const keyboard=[];
let submits=0;
document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();submits++;});
document.addEventListener('keydown',event=>{
 if(event.target instanceof HTMLButtonElement&&event.key==='Enter')keyboard.push({trusted:event.isTrusted,label:event.target.textContent});
});
const redraw=()=>root.render(fixture.element());
fixture.connect(redraw);
redraw();
window.pagingProof={
 fail:()=>fixture.fail(),
 succeed:()=>fixture.succeed(),
 replaceOffer:()=>fixture.replaceOffer(),
 firstFailure:()=>fixture.firstFailure(),
 configurationError:()=>fixture.configurationError(),
 snapshot:()=>({react:React.version,requests:fixture.requests,activations:fixture.activations,keyboard,submits,guard:fixture.guard()?.()??null}),
};
`;

export async function checkPortalPagingControlsBrowser({
    browser,
    consumer,
    evidence,
    expectedReactVersion,
}) {
    const directory = mkdtempSync(join(consumer, 'portal-paging-proof-'));
    let server;
    let context;
    const remote = [];
    const transports = [];
    const errors = [];
    try {
        writeFileSync(
            join(directory, 'list-fixture.mjs'),
            readonlyPortalListFixture
        );
        writeFileSync(
            join(directory, 'paging-fixture.mjs'),
            portalPagingControlsFixture
        );
        writeFileSync(join(directory, 'browser.mjs'), browserProgram);
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: [relative(consumer, join(directory, 'browser.mjs'))],
            bundle: true,
            platform: 'browser',
            format: 'iife',
            write: false,
            metafile: true,
            define: { 'process.env.NODE_ENV': '"production"' },
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        server = createServer((request, response) => {
            if (request.url === '/') {
                response.setHeader('content-type', 'text/html');
                response.end(
                    '<!doctype html><html><head><link rel="icon" href="data:,"><script defer src="/app.js"></script></head><body><form><main></main></form></body></html>'
                );
            } else if (request.url === '/app.js') {
                response.setHeader('content-type', 'text/javascript');
                response.end(bundle.outputFiles[0].contents);
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await new Promise((resolve, reject) =>
            server.once('error', reject).listen(0, '127.0.0.1', resolve)
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', (route) => {
            if (new URL(route.request().url()).origin === origin)
                return route.continue();
            remote.push(route.request().url());
            return route.abort();
        });
        context.on('request', (request) => {
            if (['fetch', 'xhr'].includes(request.resourceType()))
                transports.push(request.url());
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin);
        const loadMore = page.getByRole('button', { name: 'Más registros' });
        const retry = page.getByRole('button', { name: 'Reintentar' });
        const first = page.getByText('First', { exact: true });
        const status = () => page.evaluate(() => window.pagingProof.snapshot());
        await loadMore.waitFor();
        assert.equal((await status()).react, expectedReactVersion);
        assert.equal((await status()).requests.length, 0);
        await first.waitFor();
        await loadMore.hover();
        await page.mouse.down();
        await page.evaluate(async () => {
            window.pagingProof.replaceOffer();
            await new Promise((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
        });
        await page.mouse.up();
        assert.deepEqual((await status()).activations, []);
        await loadMore.click();
        assert.equal(await loadMore.isDisabled(), true);
        assert.equal(await first.isVisible(), true);
        assert.equal((await status()).requests.length, 1);

        await page.evaluate(() => window.pagingProof.fail());
        await retry.waitFor();
        assert.equal(await first.isVisible(), true);
        assert.equal(
            await page.getByRole('alert').textContent(),
            'Next page unavailable'
        );
        assert.equal((await status()).requests.length, 1);
        await retry.focus();
        await page.keyboard.press('Enter');
        assert.deepEqual((await status()).requests, [
            { intent: 'next-page', offset: 'page_2' },
            { intent: 'retry-next-page', offset: 'page_2' },
        ]);
        assert.deepEqual((await status()).keyboard, [
            { trusted: true, label: 'Reintentar' },
        ]);
        await retry.waitFor({ state: 'hidden' });
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.evaluate(() => window.pagingProof.succeed());
        await page.getByText('Second', { exact: true }).waitFor();
        assert.equal(await first.isVisible(), true);
        assert.equal(await loadMore.count(), 0);
        assert.equal(await retry.count(), 0);

        await page.evaluate(() => window.pagingProof.firstFailure());
        await retry.waitFor();
        await retry.click();
        assert.deepEqual((await status()).requests.at(-1), {
            intent: 'retry-first-page',
            offset: null,
        });
        await page.evaluate(() => window.pagingProof.configurationError());
        await page.getByText('View is unavailable', { exact: true }).waitFor();
        assert.equal(await retry.count(), 0);
        assert.equal((await status()).guard, false);
        const result = await status();
        assert.equal(result.requests.length, 3);
        assert.equal(result.submits, 0);
        assert.deepEqual(remote, []);
        assert.deepEqual(transports, []);
        assert.deepEqual(errors, []);
        Object.assign(evidence, result, {
            remote,
            transports,
            errors,
            retiredPointerRefused: true,
            passed: true,
        });
    } finally {
        try {
            if (context) {
                await context.close();
                evidence.contextClosed = true;
            }
        } finally {
            try {
                if (server?.listening) {
                    await new Promise((resolve, reject) =>
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        )
                    );
                    evidence.serverClosed = true;
                }
            } finally {
                rmSync(directory, { recursive: true, force: true });
                evidence.scratchRemoved = true;
            }
        }
    }
}
