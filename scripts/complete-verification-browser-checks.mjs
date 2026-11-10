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

export async function checkCompleteVerificationBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    Object.assign(evidence, {
        status: 'running',
        phase: 'build',
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    let directory, server, context, page, failure;
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const bounded = async (label, operation) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`${label} timed out`)),
                        5000
                    );
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.complete-verification-browser-'));
        const source = `
import React,{createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {CompleteVerificationScreen} from '@miniextensions/sdk/react';
const mode=new URLSearchParams(location.search).get('mode')||'retry';
const labels={sentCodeTo:'Code sent to',enterCode:'Verification code',continue:'Continue',reload:'Reload',attemptsExhausted:'Attempts exhausted',loading:'Loading'};
const french={sentCodeTo:'Code envoyé à',enterCode:'Code de vérification',continue:'Continuer',reload:'Recharger',attemptsExhausted:'Essais épuisés',loading:'Chargement'};
const stats={confirms:0,continues:0,secondConfirms:0,secondContinues:0,reloads:0,identities:[],writers:[],challenges:[],codeLengths:[],observedErrors:[],trustedInputs:[]};
const results=new WeakSet();let confirmHeld,loadHeld,change,committed,secondRoot;
function App(){const [state,setState]=useState({mounted:true,challenge:'A',writer:'initial',french:mode==='french'});committed=state;change=patch=>flushSync(()=>setState(old=>({...old,...patch})));
 const text=state.french?french:labels;
 const props={verificationId:state.challenge,maskedDestination:'s***@example.invalid',labels:text,accentColor:'#0f766e',
  async confirm(input){stats.confirms++;stats.challenges.push(input.verificationId);stats.codeLengths.push(input.verificationCode.length);const result=Object.freeze({syntheticPrivateResult:'must-not-render'});results.add(result);
   if(mode==='held-confirm')return new Promise(resolve=>{confirmHeld=()=>resolve(result);});
   if(mode==='limit'||mode==='french')throw new Error(text.attemptsExhausted);
   if(mode==='invalid'&&stats.confirms===1)throw new Error('Invalid synthetic code');
   return result;},
  async continueWithResult(result){stats.continues++;stats.identities.push(results.has(result));stats.writers.push(state.writer);
   if(mode==='held-load')return new Promise((resolve,reject)=>{loadHeld={resolve,reject};});
   if((mode==='retry'||mode==='two')&&stats.continues===1)throw new Error('Synthetic load failure');},
  reload(){stats.reloads++;},onError(error){stats.observedErrors.push(error.message);}};
 return h('section',{'data-proof':'first'},state.mounted?h(CompleteVerificationScreen,props):null);
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
if(mode==='two'){secondRoot=createRoot(document.querySelector('[data-proof-root=second]'));secondRoot.render(h(React.StrictMode,null,h(CompleteVerificationScreen,{verificationId:'independent',maskedDestination:'***42',labels,async confirm(){stats.secondConfirms++;const result=Object.freeze({});results.add(result);return result;},async continueWithResult(result){stats.identities.push(results.has(result));if(++stats.secondContinues===1)throw new Error('Second synthetic load failure');},reload(){stats.reloads++;}})));}
document.addEventListener('input',event=>{if(event.target.closest?.('.mx-sdk-verification'))stats.trustedInputs.push(event.isTrusted);});
window.verificationProof={snapshot:()=>({react:React.version,...stats,identities:[...stats.identities],writers:[...stats.writers],challenges:[...stats.challenges],codeLengths:[...stats.codeLengths],observedErrors:[...stats.observedErrors],trustedInputs:[...stats.trustedInputs],mounted:committed?.mounted,writer:committed?.writer,challenge:committed?.challenge}),patch:patch=>change(patch),unmountSecond:()=>secondRoot.unmount(),resolveConfirmation:()=>confirmHeld(),rejectLoad:()=>loadHeld.reject('Late synthetic load failure'),resolveLoad:()=>loadHeld.resolve()};
`;
        writeFileSync(join(directory, 'host.mjs'), source);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [join(directory, 'host.mjs')],
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
        assert(
            inputs.some((p) =>
                p.endsWith('/react/CompleteVerificationScreen.js')
            )
        );
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/complete-verification.css')
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
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; img-src 'none'"
            );
            const path = new URL(request.url, 'http://localhost').pathname;
            if (path === '/proof.js') {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(bundle.outputFiles[0].text);
            } else if (path === '/verification.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic verification proof</title><link rel="stylesheet" href="/verification.css"><main></main><aside data-proof-root="second"></aside><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await bounded(
            'verification server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        const first = () => page.locator('[data-proof=first]');
        const open = async (mode, narrow = false) => {
            if (context) await context.close();
            context = await browser.newContext({
                serviceWorkers: 'block',
                viewport: narrow
                    ? { width: 390, height: 844 }
                    : { width: 1024, height: 768 },
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
                    ['/', '/proof.js', '/verification.css'].includes(
                        url.pathname
                    )
                )
                    return route.continue();
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            evidence.phase = mode;
            await page.goto(origin + '?mode=' + mode);
            await first().getByRole('textbox').waitFor();
            return first().getByRole('textbox');
        };
        const snapshot = () =>
            page.evaluate(() => window.verificationProof.snapshot());
        const finish = async (name) => {
            const state = await snapshot();
            assert.deepEqual(evidence.pageErrors, []);
            assert.deepEqual(evidence.unexpectedRequests, []);
            assert(
                state.trustedInputs.length > 0 &&
                    state.trustedInputs.every(Boolean)
            );
            assert(state.identities.every(Boolean));
            assert.equal(
                await page
                    .locator('body')
                    .textContent()
                    .then((text) => text.includes('must-not-render')),
                false
            );
            assert.equal(
                await page.evaluate(
                    () => localStorage.length + sessionStorage.length
                ),
                0
            );
            evidence.reactVersion = state.react;
            evidence.results.push({
                name,
                state,
                ax: await page.locator('body').ariaSnapshot(),
            });
            await page.screenshot({
                path: join(output, 'verification-' + name + '.png'),
                fullPage: true,
            });
        };
        let input = await open('retry');
        const submit = first().getByRole('button', {
            name: 'Continue',
            exact: true,
        });
        assert.equal(await submit.isDisabled(), true);
        assert.equal(await input.getAttribute('pattern'), '\\d*');
        assert.equal(await input.getAttribute('type'), 'text');
        assert.equal(await submit.getAttribute('type'), 'submit');
        const id = await input.getAttribute('id');
        assert.equal(await first().locator('label').getAttribute('for'), id);
        await input.fill('not-digits');
        await input.press('Enter');
        assert.equal((await snapshot()).confirms, 0);
        await input.fill('123456');
        await input.press('Enter');
        await first()
            .getByRole('alert')
            .filter({ hasText: 'Synthetic load failure' })
            .waitFor();
        assert.equal((await snapshot()).confirms, 1);
        await input.fill('654321');
        assert.equal(
            await first().getByRole('alert').textContent(),
            'Synthetic load failure'
        );
        await page.evaluate(() =>
            window.verificationProof.patch({ writer: 'replacement' })
        );
        await input.press('Enter');
        await first().getByRole('status').waitFor();
        await page.waitForFunction(
            () => window.verificationProof.snapshot().continues === 2
        );
        let state = await snapshot();
        assert.equal(state.confirms, 1);
        assert.deepEqual(state.writers, ['initial', 'replacement']);
        await finish('enter-and-cached-continuation-retry');

        input = await open('invalid');
        await input.fill('000000');
        await first().getByRole('button').click();
        await first().getByRole('alert').waitFor();
        assert.equal((await snapshot()).continues, 0);
        await input.fill('001234');
        await input.press('Enter');
        await first().getByRole('status').waitFor();
        state = await snapshot();
        assert.equal(state.confirms, 2);
        assert.equal(state.continues, 1);
        await finish('corrected-confirmation');

        for (const mode of ['limit', 'french']) {
            input = await open(mode, mode === 'french');
            await input.fill('000000');
            await input.press('Enter');
            await first().getByRole('alert').waitFor();
            const reload = first().getByRole('button', {
                name: mode === 'french' ? 'Recharger' : 'Reload',
                exact: true,
            });
            await reload.waitFor();
            if (mode === 'french') {
                assert.equal(
                    await input.getAttribute('placeholder'),
                    'Code de vérification'
                );
                await input.press('Enter');
            } else await reload.click();
            await page.waitForFunction(
                () => window.verificationProof.snapshot().reloads === 1
            );
            state = await snapshot();
            assert.equal(state.confirms, 1);
            assert.equal(state.continues, 0);
            await finish('reload-' + mode);
        }

        input = await open('held-confirm');
        await input.fill('123456');
        await input.press('Enter');
        await first().getByRole('status').waitFor();
        assert.equal(await first().getByRole('textbox').count(), 0);
        await page.evaluate(() =>
            window.verificationProof.patch({
                challenge: 'B',
                writer: 'replacement',
            })
        );
        await page.evaluate(() =>
            window.verificationProof.resolveConfirmation()
        );
        await page.waitForFunction(
            () => window.verificationProof.snapshot().continues === 1
        );
        state = await snapshot();
        assert.deepEqual(state.challenges, ['A']);
        assert.deepEqual(state.writers, ['initial']);
        await finish('pending-confirmation-captured-callback');

        input = await open('held-load');
        await input.fill('123456');
        await input.press('Enter');
        await first().getByRole('status').waitFor();
        await page.waitForFunction(
            () => window.verificationProof.snapshot().continues === 1
        );
        await page.evaluate(() =>
            window.verificationProof.patch({ writer: 'replacement' })
        );
        await page.evaluate(() => window.verificationProof.rejectLoad());
        await first().getByRole('alert').waitFor();
        assert.equal(await input.inputValue(), '123456');
        await input.press('Enter');
        await first().getByRole('status').waitFor();
        await page.waitForFunction(
            () => window.verificationProof.snapshot().continues === 2
        );
        await page.evaluate(() => window.verificationProof.resolveLoad());
        assert.equal((await snapshot()).confirms, 1);
        assert.deepEqual((await snapshot()).writers, [
            'initial',
            'replacement',
        ]);
        await finish('pending-continuation-and-retry');

        input = await open('held-confirm');
        await input.fill('123456');
        await input.press('Enter');
        await first().getByRole('status').waitFor();
        await page.evaluate(() =>
            window.verificationProof.patch({ mounted: false })
        );
        await page.evaluate(() =>
            window.verificationProof.resolveConfirmation()
        );
        await page.waitForFunction(
            () => window.verificationProof.snapshot().continues === 1
        );
        assert.equal(await first().textContent(), '');
        await finish('unmount-is-not-transport-cancellation');

        input = await open('two', true);
        const second = page.locator('[data-proof-root=second]');
        await second.getByRole('textbox').waitFor({ state: 'visible' });
        const ids = await page
            .locator('input')
            .evaluateAll((nodes) => nodes.map((node) => node.id));
        assert.equal(new Set(ids).size, 2);
        const box = await input.boundingBox();
        assert(box && box.width > 200 && box.x + box.width <= 390);
        await input.fill('123456');
        await input.press('Enter');
        await first().getByRole('alert').waitFor();
        await input.press('Enter');
        await first().getByRole('status').waitFor();
        assert.equal(await second.getByRole('button').isDisabled(), true);
        await second.getByRole('textbox').fill('654321');
        await second.getByRole('textbox').press('Enter');
        await second.getByRole('alert').waitFor();
        await second.getByRole('textbox').press('Enter');
        await second.getByRole('status').waitFor();
        state = await snapshot();
        assert.equal(state.secondConfirms, 1);
        assert.equal(state.secondContinues, 2);
        assert.equal(state.confirms, 1);
        assert.equal(state.continues, 2);
        await page.evaluate(() => window.verificationProof.unmountSecond());
        assert.equal(await second.textContent(), '');
        assert.equal(await first().getByRole('status').count(), 1);
        await finish('independent-roots-and-narrow-style');
        assert.equal(evidence.results.length, 8);
        evidence.scope =
            'Installed complete verification with synthetic host callbacks only. No code delivery, provider/auth/session/storage/native-host acceptance.';
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
        if (page)
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.verificationProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'verification-failure.png'),
                    fullPage: true,
                });
            } catch (capture) {
                evidence.failureCaptureError = capture.message;
            }
    } finally {
        for (const [name, cleanup] of [
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
                () => {
                    if (directory)
                        rmSync(directory, { recursive: true, force: true });
                },
            ],
        ]) {
            try {
                await bounded('verification cleanup ' + name, cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.cleanup[name] = { error: error.message };
                evidence.status = 'failed';
                evidence.error ??= error.message;
                failure ??= error;
            }
        }
    }
    try {
        writeFileSync(
            join(output, 'complete-verification-proof.json'),
            JSON.stringify(evidence, null, 2) + '\n'
        );
    } catch (error) {
        evidence.status = 'failed';
        evidence.error ??= error.message;
        failure ??= error;
    }
    if (failure) throw failure;
}
