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

/** Actual installed public component and trusted keyboard/pointer interaction. */
export async function checkSearchGateBrowser({
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
        focusChecks: [],
        cleanup: {},
    });
    let directory, server, context, failure;
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
        directory = mkdtempSync(join(root, '.search-gate-browser-'));
        const source = `
import React,{createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PortalSearchGate} from '@miniextensions/sdk/react';
import {hasSearchPageQueryParam} from '@miniextensions/sdk/portals';
let navigations=[],clears=0,urlReads=0;
function App(){
 const [mounted,setMounted]=useState(false),[noResults,setNoResults]=useState(false),[field,setField]=useState({fieldId:'fld_name',fieldName:'Name 東京'}),[second,setSecond]=useState(false);
 const actions=h('span',null,
  h('button',{type:'button',onClick:()=>setNoResults(true)},'Show no results'),
  h('button',{type:'button',onClick:()=>setField({fieldId:'fld_new',fieldName:'Other'})},'Replace field'),
  h('button',{type:'button',onClick:()=>setSecond(true)},'Open second gate'),
  h('button',{type:'button',onClick:()=>setMounted(false)},'Unmount gate'));
 return h(React.Fragment,null,
  h('button',{type:'button','data-search-proof-control':'open-gate',onClick:()=>setMounted(true)},'Open gate'),
  h('button',{type:'button','data-search-proof-control':'outside-control'},'Outside control'),
  mounted?h(PortalSearchGate,{searchPageField:field,title:'Search one',hasNoResults:noResults,getCurrentUrl(){urlReads++;return 'https://example.test/portal?keep=yes&search_fld_name=old#fragment';},onNavigate(url){navigations.push({url,recognized:hasSearchPageQueryParam({searchParams:new URL(url).searchParams,searchPageField:field})});},onClearSearch(){clears++;},headerActions:actions,accentColor:'#4f46e5',focusColor:'#6366f1'}):null,
  second?h(PortalSearchGate,{searchPageField:{fieldId:'fld_second',fieldName:'Second'},title:'Search two',getCurrentUrl:()=> 'https://example.test',onNavigate(url){navigations.push({url});},headerActions:h('button',{type:'button',onClick:()=>setSecond(false)},'Unmount second gate')}):null);
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.searchGateProof={snapshot:()=>({react:React.version,navigations:[...navigations],clears,urlReads})};
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
        assert(inputs.some((p) => p.endsWith('/react/PortalSearchGate.js')));
        assert(inputs.some((p) => p.endsWith('/portals/searchGate.js')));
        for (const input of inputs)
            assert(
                realpathSync(resolve(root, input)).startsWith(installed + '/')
            );
        const css = readFileSync(
            join(installed, 'dist/esm/react/search-gate.css')
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
            } else if (path === '/gate.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else if (path === '/') {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Portable Search gate proof</title><link rel="stylesheet" href="/gate.css"><main></main><script type="module" src="/proof.js"></script>'
                );
            } else {
                response.statusCode = path === '/favicon.ico' ? 204 : 404;
                response.end();
            }
        });
        await bounded(
            'search gate server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        evidence.phase = 'interaction';
        for (const mobile of [false, true]) {
            context = await browser.newContext({
                serviceWorkers: 'block',
                viewport: mobile
                    ? { width: 390, height: 844 }
                    : { width: 1280, height: 800 },
            });
            await context.route('**/*', async (route) => {
                if (
                    !route
                        .request()
                        .url()
                        .startsWith(origin + '/')
                ) {
                    evidence.unexpectedRequests.push('non-fixture request');
                    await route.abort();
                } else await route.continue();
            });
            const page = await context.newPage();
            page.setDefaultTimeout(5000);
            page.on('pageerror', (error) =>
                evidence.pageErrors.push(error.message)
            );
            await page.goto(origin);
            const open = page.getByRole('button', {
                name: 'Open gate',
                exact: true,
            });
            await open.click();
            const dialog = page.getByRole('dialog', {
                name: 'Search one',
                exact: true,
            });
            const input = dialog.getByLabel('Name 東京', { exact: true });
            await input.waitFor({ state: 'visible' });
            assert.equal(
                await input.evaluate(
                    (node) => node.ownerDocument.activeElement === node
                ),
                true
            );
            assert.equal(
                await dialog
                    .getByRole('button', { name: 'Continue', exact: true })
                    .isDisabled(),
                true
            );
            const initial = await page.evaluate(() =>
                window.searchGateProof.snapshot()
            );
            assert.equal(initial.urlReads, 0);
            assert.deepEqual(initial.navigations, []);
            await input.fill(' \t ');
            await input.press('Enter');
            assert.equal(
                (await page.evaluate(() => window.searchGateProof.snapshot()))
                    .urlReads,
                0
            );
            await input.fill('  Alice & 東京  ');
            await input.press('Enter');
            const snapshot = await page.evaluate(() =>
                window.searchGateProof.snapshot()
            );
            assert.equal(snapshot.navigations.length, 1);
            assert.equal(snapshot.urlReads, 1);
            assert.equal(snapshot.navigations[0].recognized, true);
            const destination = new URL(snapshot.navigations[0].url);
            assert.equal(
                destination.searchParams.get('search_Name 東京'),
                'Alice & 東京'
            );
            assert.equal(
                destination.searchParams.has('search_fld_name'),
                false
            );
            assert.equal(destination.searchParams.get('keep'), 'yes');
            assert.equal(destination.hash, '#fragment');
            await page.keyboard.press('Escape');
            assert.equal(await dialog.isVisible(), true);
            await dialog
                .locator('.mx-sdk-search-gate-overlay')
                .click({ position: { x: 3, y: 3 } });
            assert.equal(await dialog.isVisible(), true);
            await input.focus();
            const focusInside = async (target, direction, iteration) => {
                // One synchronous checkpoint computes the original predicate
                // first, then bounded facts; no extra wait or second oracle.
                const observation = await target.evaluate((node) => {
                    const doc = node.ownerDocument;
                    const active = doc.activeElement;
                    const inside = node.contains(active);
                    return {
                        inside,
                        activeTag: [
                            'BODY',
                            'HTML',
                            'INPUT',
                            'BUTTON',
                            'DIALOG',
                        ].includes(active?.tagName)
                            ? active.tagName
                            : 'OTHER',
                        activeIsBody: active === doc.body,
                        activeIsDocumentElement: active === doc.documentElement,
                        activeIsDialog: active === node,
                        nearestDialogIsThis:
                            active?.closest('dialog,[role="dialog"]') === node,
                        hostControl:
                            active?.getAttribute('data-search-proof-control') ??
                            null,
                        documentHasFocus: doc.hasFocus(),
                        openDialogCount:
                            doc.querySelectorAll('dialog[open]').length,
                    };
                });
                evidence.focusChecks.push({
                    mobile,
                    direction,
                    iteration,
                    ...observation,
                });
                return observation.inside;
            };
            for (let i = 0; i < 10; i++) {
                await page.keyboard.press('Tab');
                assert.equal(
                    await focusInside(dialog, 'forward', i),
                    true,
                    'native modal Tab must not reach outside controls'
                );
            }
            for (let i = 0; i < 10; i++) {
                await page.keyboard.press('Shift+Tab');
                assert.equal(
                    await focusInside(dialog, 'backward', i),
                    true,
                    'native modal Shift+Tab must not reach outside controls'
                );
            }
            const geometry = await dialog.evaluate((node) => {
                const panel = node.querySelector('.mx-sdk-search-gate-panel');
                const bounds = panel.getBoundingClientRect();
                return {
                    left: bounds.left,
                    right: bounds.right,
                    width: bounds.width,
                    viewport: innerWidth,
                    backdrop: getComputedStyle(node, '::backdrop')
                        .backgroundColor,
                    button: getComputedStyle(
                        node.querySelector('button[type=submit]')
                    ).backgroundColor,
                };
            });
            assert(geometry.left >= 0 && geometry.right <= geometry.viewport);
            assert(geometry.width <= 512 && geometry.width > 250);
            assert.equal(geometry.backdrop, 'rgb(17, 24, 39)');
            assert.equal(geometry.button, 'rgb(79, 70, 229)');
            await dialog
                .getByRole('button', { name: 'Show no results', exact: true })
                .click();
            assert.equal(
                await dialog.locator('.mx-sdk-search-gate-error').isVisible(),
                true
            );
            await input.fill('retry');
            assert.equal(
                await dialog.locator('.mx-sdk-search-gate-error').isVisible(),
                true
            );
            await dialog
                .getByRole('button', { name: 'Clear', exact: true })
                .click();
            assert.equal(await input.inputValue(), '');
            assert.equal(
                await dialog.locator('.mx-sdk-search-gate-error').count(),
                0
            );
            assert.equal(
                await dialog
                    .getByRole('button', { name: 'Search Again', exact: true })
                    .isDisabled(),
                true
            );
            const afterClear = await page.evaluate(() =>
                window.searchGateProof.snapshot()
            );
            assert.equal(afterClear.clears, 1);
            assert.equal(afterClear.navigations.length, 1);
            await input.fill('retained draft');
            await dialog
                .getByRole('button', { name: 'Replace field', exact: true })
                .click();
            assert.equal(
                await dialog.getByLabel('Other', { exact: true }).inputValue(),
                'retained draft'
            );
            await dialog
                .getByRole('button', { name: 'Open second gate', exact: true })
                .click();
            const second = page.getByRole('dialog', {
                name: 'Search two',
                exact: true,
            });
            assert.equal(
                await second.getByLabel('Second', { exact: true }).inputValue(),
                ''
            );
            assert.equal(
                await second
                    .getByLabel('Second', { exact: true })
                    .evaluate(
                        (node) => node.ownerDocument.activeElement === node
                    ),
                true
            );
            await page.keyboard.press('Escape');
            assert.equal(await second.isVisible(), true);
            for (const direction of ['forward', 'backward']) {
                for (let i = 0; i < 6; i++) {
                    await page.keyboard.press(
                        direction === 'forward' ? 'Tab' : 'Shift+Tab'
                    );
                    assert.equal(
                        await focusInside(second, `second-${direction}`, i),
                        true,
                        'the active second gate owns its keyboard loop'
                    );
                }
            }
            await second
                .getByRole('button', {
                    name: 'Unmount second gate',
                    exact: true,
                })
                .click();
            assert.equal(await second.count(), 0);
            assert.equal(await dialog.isVisible(), true);
            await dialog
                .getByRole('button', { name: 'Unmount gate', exact: true })
                .click();
            assert.equal(await dialog.count(), 0);
            assert.equal(
                await open.evaluate(
                    (node) => node.ownerDocument.activeElement === node
                ),
                true,
                'unmount restores the opener focus'
            );
            await open.click();
            assert.equal(
                await dialog.getByLabel('Other', { exact: true }).inputValue(),
                '',
                'new mount has its own empty draft'
            );
            await page.screenshot({
                path: join(
                    output,
                    `search-gate-${mobile ? 'mobile' : 'wide'}.png`
                ),
            });
            evidence.results.push({
                mobile,
                react: snapshot.react,
                geometry,
                navigations: 1,
                clears: 1,
                focus: 'initial/trapped/restored',
                escapeAndBackdrop: 'blocked',
                multipleInstances: 'independent',
            });
            await context.close();
            context = undefined;
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
        evidence.scope =
            'Styled installed public SDK Search gate, synthetic URL callbacks only; not native maker portal compatibility, parent admission, records or hosted acceptance.';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.failure = error.message;
    } finally {
        try {
            if (context)
                await bounded('search gate context close', () =>
                    context.close()
                );
            evidence.cleanup.context = 'closed';
        } catch (error) {
            failure ??= error;
            evidence.cleanup.context = 'failed';
        }
        try {
            if (server)
                await bounded(
                    'search gate server close',
                    () =>
                        new Promise((resolve, reject) =>
                            server.close((error) =>
                                error ? reject(error) : resolve()
                            )
                        )
                );
            evidence.cleanup.server = 'closed';
        } catch (error) {
            failure ??= error;
            evidence.cleanup.server = 'failed';
        }
        if (directory) rmSync(directory, { recursive: true, force: true });
        evidence.cleanup.directory = 'removed';
        if (failure) {
            evidence.status = 'failed';
            evidence.failure = failure.message;
        }
        writeFileSync(
            join(output, 'search-gate.json'),
            JSON.stringify(evidence, null, 2)
        );
    }
    if (failure) throw failure;
}
