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
export async function checkFormTrackingBrowser({
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
        directory = mkdtempSync(join(root, '.tracking-browser-'));
        const source = `import React,{createElement as h,useState}from'react';import{createRoot}from'react-dom/client';import{CompleteFormTrackingDisclosure}from'@miniextensions/sdk/react';import{captureFormTrackingPolicy}from'@miniextensions/sdk/forms';
function App(){const[state,setState]=useState({readOnly:false,preview:false,isLastPage:true,enabled:true,ip:true,location:true});window.trackingProof={patch:patch=>setState(old=>({...old,...patch}))};return h('form',{onSubmit:event=>event.preventDefault()},h('button',{type:'button',id:'before'},'Before disclosure'),h('section',{id:'notices',style:{textAlign:'right'}},h(CompleteFormTrackingDisclosure,{...state,policy:captureFormTrackingPolicy({enableTracking:state.enabled,userIPAddressField:state.ip?'ip':null,userLatitudeField:state.location?'lat':null}),labels:{ipAddress:'Adresse IP collectée',location:'位置情報が収集されます <literal>'}})),h('button',{type:'button',id:'after'},'After disclosure'));}createRoot(document.querySelector('main')).render(h(App));`;
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
            inputs.some((name) =>
                name.endsWith('/react/CompleteFormTrackingDisclosure.js')
            )
        );
        assert(inputs.some((name) => name.endsWith('/forms/tracking.js')));
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/form-tracking.css')
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
            } else if (path === '/tracking.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/tracking.css"><main></main><script type="module" src="/proof.js"></script>'
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
        // A counted denial sentinel, never an actual platform location request.
        await context.addInitScript(() => {
            window.trackingLocationReads = 0;
            Object.defineProperty(navigator, 'geolocation', {
                configurable: true,
                get() {
                    window.trackingLocationReads++;
                    throw new Error('unexpected location access');
                },
            });
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
                ['/', '/proof.js', '/tracking.css'].includes(url.pathname)
            )
                return route.continue();
            evidence.unexpectedRequests.push(url.origin + url.pathname);
            return route.abort();
        });
        await page.goto(origin);
        await page.getByRole('alert').first().waitFor();
        assert.equal(await page.getByRole('alert').count(), 2);
        assert.equal(await page.locator('#notices b').count(), 0);
        assert.equal(
            await page.getByRole('alert').nth(1).textContent(),
            '位置情報が収集されます <literal>'
        );
        await page.locator('#before').focus();
        await page.keyboard.press('Tab');
        assert.equal(
            await page
                .locator('#after')
                .evaluate((node) => node === document.activeElement),
            true
        );
        const geometry = await page
            .getByRole('alert')
            .first()
            .evaluate((node) => {
                const rect = node.getBoundingClientRect(),
                    style = getComputedStyle(node),
                    icon = node.querySelector('svg').getBoundingClientRect();
                return {
                    width: rect.width,
                    height: rect.height,
                    color: style.color,
                    background: style.backgroundColor,
                    icon: icon.width,
                    overflow: document.documentElement.scrollWidth > innerWidth,
                };
            });
        assert(geometry.width > 300 && geometry.height >= 56);
        assert.equal(geometry.icon, 24);
        assert.equal(geometry.overflow, false);
        assert.equal(geometry.background, 'rgb(239, 246, 255)');
        evidence.results.push({
            name: 'localized-portable-style-and-adjacent-tab',
            geometry,
        });
        for (const patch of [
            { readOnly: true },
            { readOnly: false, preview: true },
            { preview: false, isLastPage: false },
            { isLastPage: true, enabled: false },
        ]) {
            await page.evaluate(
                (patch) => window.trackingProof.patch(patch),
                patch
            );
            await page.waitForFunction(
                () => document.querySelectorAll('[role=alert]').length === 0
            );
        }
        await page.evaluate(() =>
            window.trackingProof.patch({ enabled: true, ip: false })
        );
        await page.waitForFunction(
            () => document.querySelectorAll('[role=alert]').length === 1
        );
        assert.equal(
            await page.getByRole('alert').textContent(),
            '位置情報が収集されます <literal>'
        );
        assert.equal(
            await page.evaluate(() => window.trackingLocationReads),
            0
        );
        evidence.results.push({
            name: 'visibility-gates-and-location-only',
            browserLocationReads: 0,
        });
        await page.screenshot({
            path: join(output, 'form-tracking-disclosure.png'),
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
