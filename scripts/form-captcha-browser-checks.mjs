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
import { formCaptchaFixture } from './form-captcha-consumer-checks.mjs';

/** Real local browser/SDK DOM, synthetic provider only; no challenge or backend. */
export async function checkFormCaptchaBrowser({
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
    let directory, server, context;
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.form-captcha-browser-'));
        const source = `import React,{createElement as h,useState}from'react';import{createRoot}from'react-dom/client';import{FormCaptcha}from'@miniextensions/sdk/react';
const fixture=(${formCaptchaFixture.toString()})(document);let patch;
function App(){const[state,setState]=useState({mounted:true,preview:false});patch=value=>setState(old=>({...old,...value}));return h(React.StrictMode,null,h('button',{id:'before',type:'button'},'Before'),state.mounted&&h(FormCaptcha,state.preview?{mode:'preview',labels:{preview:'Vista previa'}}:{mode:'controlled',host:fixture.host,labels:{title:'Prueba',loading:'Cargando'}}),h('button',{id:'after',type:'button'},'After'));}
const root=createRoot(document.querySelector('main'));root.render(h(App));window.captchaProof={fixture,patch:value=>patch(value),unmount:()=>root.unmount()};`;
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
        await assertBrowserInputs(bundle.metafile, root);
        const installed = realpathSync(
            join(root, 'node_modules/@miniextensions/sdk')
        );
        const inputs = Object.keys(bundle.metafile.inputs).filter((name) =>
            name.includes('@miniextensions/sdk')
        );
        assert(inputs.some((name) => name.endsWith('/react/FormCaptcha.js')));
        assert(inputs.some((name) => name.endsWith('/ui/formCaptcha.js')));
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/form-captcha.css')
        );
        Object.assign(evidence, {
            sdkInputs: inputs,
            harnessSha256: hash(readFileSync(new URL(import.meta.url))),
            fixtureSha256: hash(
                readFileSync(
                    new URL(
                        './form-captcha-consumer-checks.mjs',
                        import.meta.url
                    )
                )
            ),
            hostSha256: hash(source),
            bundleSha256: hash(bundle.outputFiles[0].contents),
            cssSha256: hash(css),
        });
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; form-action 'none'"
            );
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (path === '/captcha.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><title>Owned CAPTCHA synthetic acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/captcha.css"><main></main><script type="module" src="/proof.js"></script>'
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
            viewport: { width: 320, height: 700 },
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        await page.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (
                url.origin === origin &&
                ['/', '/proof.js', '/captcha.css'].includes(url.pathname)
            )
                return route.continue();
            evidence.unexpectedRequests.push(url.origin + url.pathname);
            return route.abort();
        });
        await page.goto(origin);
        assert.equal(await page.title(), 'Owned CAPTCHA synthetic acceptance');
        assert.equal(new URL(page.url()).origin, origin);
        const widget = page.getByRole('button', {
            name: 'Synthetic CAPTCHA',
            exact: true,
        });
        await widget.waitFor();
        await page.locator('#before').focus();
        await page.keyboard.press('Tab');
        assert.equal(
            await widget.evaluate((node) => node === document.activeElement),
            true
        );
        await page.keyboard.press('Enter');
        assert.equal(
            await page.evaluate(
                () => window.captchaProof.fixture.counts().writes
            ),
            1
        );
        await page.keyboard.press('Tab');
        assert.equal(
            await page
                .locator('#after')
                .evaluate((node) => node === document.activeElement),
            true
        );
        evidence.results.push('trusted-tab-enter-and-next-focus');
        await page.evaluate(() => window.captchaProof.fixture.clear());
        assert.equal(
            await page.evaluate(
                () => window.captchaProof.fixture.widgets.at(-1).resets
            ),
            1
        );
        assert.equal(
            await page.evaluate(
                () => window.captchaProof.fixture.counts().writes
            ),
            1
        );
        await widget.click();
        await page.evaluate(() =>
            window.captchaProof.fixture.update({
                configurationRevision: 1,
                options: { theme: 'dark' },
            })
        );
        await page.waitForFunction(
            () => window.captchaProof.fixture.widgets.length >= 2
        );
        assert.equal(
            await page.evaluate(
                () => window.captchaProof.fixture.counts().invalidations
            ),
            1
        );
        await page.evaluate(() =>
            window.captchaProof.fixture.widgets[0].callbacks.expired()
        );
        assert.equal(
            await page.evaluate(
                () => window.captchaProof.fixture.counts().writes
            ),
            2
        );
        evidence.results.push(
            'canonical-reset-invalidation-and-old-callback-retirement'
        );
        await page.evaluate(() =>
            window.captchaProof.fixture.update({ editable: false })
        );
        await widget.waitFor({ state: 'detached' });
        await page.evaluate(() => window.captchaProof.patch({ preview: true }));
        await page.getByText('Vista previa', { exact: true }).waitFor();
        assert.equal(
            await page
                .locator(
                    'section button,section iframe,section input,section script'
                )
                .count(),
            0
        );
        const geometry = await page.locator('section').evaluate((node) => ({
            width: node.getBoundingClientRect().width,
            viewport: innerWidth,
            scroll: document.documentElement.scrollWidth,
        }));
        assert(geometry.width <= geometry.viewport);
        assert(geometry.scroll <= geometry.viewport);
        evidence.results.push('inert-localized-preview-and-narrow-layout');
        await page.evaluate(() => window.captchaProof.unmount());
        assert.equal(
            await page.evaluate(
                () => window.captchaProof.fixture.counts().listeners
            ),
            0
        );
        assert.equal(await page.locator('main > *').count(), 0);
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
        evidence.externalNetworkContinuations = 0;
    } catch (error) {
        evidence.status = 'failed';
        evidence.error = error.message;
        throw error;
    } finally {
        try {
            if (context) {
                await context.close();
                evidence.cleanup.context = 'closed';
            }
        } finally {
            try {
                if (server) {
                    await new Promise((yes, no) =>
                        server.close((error) => (error ? no(error) : yes()))
                    );
                    evidence.cleanup.server = 'closed';
                }
            } finally {
                if (directory) {
                    rmSync(directory, { recursive: true, force: true });
                    evidence.cleanup.files = 'removed';
                }
                if (output)
                    writeFileSync(
                        output,
                        JSON.stringify(evidence, null, 2) + '\n'
                    );
            }
        }
    }
    return evidence;
}
