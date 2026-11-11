import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
    mkdtempSync,
    readFileSync,
    writeFileSync,
    rmSync,
    realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

/** Real SDK dialog/video/controls, synthetic canvas media, decoder boundary only. */
export async function checkCompleteBarcodeBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    let server, context, directory, page, nativeParentRoot, primaryFailure;
    Object.assign(evidence, {
        status: 'running',
        profiles: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    try {
        const root = realpathSync(consumer);
        const consumerRequire = createRequire(join(root, 'package.json'));
        const installedReact = JSON.parse(
            readFileSync(consumerRequire.resolve('react/package.json'), 'utf8')
        ).version;
        const nativeParent = installedReact.startsWith('18.');
        if (nativeParent) {
            nativeParentRoot = root;
            execFileSync(
                'npm',
                [
                    'install',
                    '--ignore-scripts',
                    '--strict-peer-deps',
                    '--no-audit',
                    '--no-fund',
                    '--package-lock=false',
                    'native-dialog@npm:@headlessui/react@1.7.2',
                ],
                { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] }
            );
        }
        directory = mkdtempSync(join(root, '.barcode-proof-'));
        const source = `
import React,{createElement as h,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {BrowserMultiFormatReader,NotFoundException} from '@zxing/library';
__API__
__PARENT__
const params=new URLSearchParams(location.search);let mode=params.get('mode')||'waiting';
const stats={react:React.version,acquisitions:0,enumerations:0,decodes:0,writes:[],submits:0,settled:0,parentDismissed:0};const tracks=[];let held,patch;
const canvas=document.createElement('canvas');canvas.width=160;canvas.height=100;const ctx=canvas.getContext('2d');let frame=0;
const interval=setInterval(()=>{ctx.fillStyle=frame++%2?'#fff':'#eee';ctx.fillRect(0,0,160,100);},25);
Object.defineProperty(navigator,'mediaDevices',{value:{async enumerateDevices(){stats.enumerations++;return mode==='no-device'?[]:[{kind:'videoinput',deviceId:'synthetic',label:'Synthetic canvas camera',groupId:'synthetic'}];},async getUserMedia(){stats.acquisitions++;if(mode==='denied')throw new DOMException('Synthetic denial','NotAllowedError');const stream=canvas.captureStream(20);tracks.push(...stream.getTracks());if(mode==='late-media')await new Promise(resolve=>{held=resolve;});return stream;}}});
BrowserMultiFormatReader.prototype.decode=function(){stats.decodes++;if(mode==='failure')throw Error('Synthetic decoder failure');if(mode==='waiting'||mode==='late-media')throw new NotFoundException();return{getText:()=>'<SCANNED-123>'};};
function App(){const[parentOpen,setParentOpen]=useState(true);const[state,setState]=useState({kind:params.get('kind')||'barcode',enabled:params.get('enabled')!=='false',readOnly:false,owner:'A',value:'manual-original'});patch=change=>flushSync(()=>setState(old=>({...old,...change})));
 const setValue=async text=>{stats.writes.push(text);setState(old=>({...old,value:text}));if(mode==='held')await new Promise(resolve=>{held=()=>{stats.settled++;resolve();};});};
 const options={autoStartCamera:params.get('auto')==='true',setValue,ownerKey:state.owner,desktopViewportOffset:440,style:{'--theme-500':'10 120 90'}};
 const scanner=params.get('loop')==='true'?useBarcodeScannerButton({...options,hideButton:!state.enabled||state.readOnly,runInLoop:true}):useBarcodeScannerButtonInField({...options,fieldType:state.kind,readOnly:state.readOnly,enableQRCodeScannerForFormField:state.enabled});
 const content=h('form',{onSubmit:event=>{event.preventDefault();stats.submits++;}},h('label',null,'Original value',h('input',{value:state.value,readOnly:true})),scanner.barcodeScannerButton,scanner.scannerComponent);
 return params.get('nested')==='true'?h(NativeDialog,{open:parentOpen,onClose(){stats.parentDismissed++;setParentOpen(false);},style:{position:'fixed',inset:0,zIndex:50,padding:'80px',background:'#ddd'}},h('div',null,h(NativeDialog.Title,null,'Native finder'),content)):content;
}
createRoot(document.querySelector('main')).render(h(React.StrictMode,null,h(App)));
window.barcodeProof={mode:value=>{mode=value;},patch:change=>patch(change),release:()=>held?.(),snapshot:()=>({...stats,writes:[...stats.writes],tracks:tracks.map(track=>track.readyState)}),cleanup:()=>{clearInterval(interval);for(const track of tracks)track.stop();}};
`;
        for (const format of ['esm', 'cjs']) {
            const api =
                format === 'esm'
                    ? "import {useBarcodeScannerButton,useBarcodeScannerButtonInField} from '@miniextensions/sdk/react';"
                    : "const {useBarcodeScannerButton,useBarcodeScannerButtonInField}=require('@miniextensions/sdk/react');";
            writeFileSync(
                join(directory, `${format}.js`),
                source
                    .replace('__API__', api)
                    .replace(
                        '__PARENT__',
                        nativeParent
                            ? "import {Dialog as NativeDialog} from 'native-dialog';"
                            : 'const NativeDialog=()=>null;'
                    )
            );
            const bundle = await build({
                absWorkingDir: root,
                entryPoints: [join(directory, `${format}.js`)],
                bundle: true,
                platform: 'browser',
                format: 'esm',
                write: false,
                metafile: true,
            });
            await assertBrowserInputs(bundle.metafile, root);
            writeFileSync(
                join(directory, `${format}.bundle.js`),
                bundle.outputFiles[0].contents
            );
        }
        const css = readFileSync(
            join(
                root,
                'node_modules/@miniextensions/sdk/dist/esm/react/complete-barcode-scanner.css'
            )
        );
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            const url = new URL(request.url, 'http://localhost');
            if (url.pathname.endsWith('.js')) {
                response.setHeader('Content-Type', 'text/javascript');
                response.end(
                    readFileSync(join(directory, url.pathname.slice(1)))
                );
            } else if (url.pathname === '/scanner.css') {
                response.setHeader('Content-Type', 'text/css');
                response.end(css);
            } else {
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    `<html><head><link rel="stylesheet" href="/scanner.css"></head><body><main></main><script type="module" src="/${url.searchParams.get('format') === 'cjs' ? 'cjs' : 'esm'}.bundle.js"></script></body></html>`
                );
            }
        });
        await new Promise((yes, no) => {
            server.once('error', no);
            server.listen(0, '127.0.0.1', yes);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
            viewport: { width: 1280, height: 900 },
        });
        page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        page.on('request', (request) => {
            if (!request.url().startsWith(origin + '/'))
                evidence.unexpectedRequests.push(request.url());
        });
        const visit = async (format, query = '') => {
            if (
                await page
                    .evaluate(() => Boolean(window.barcodeProof))
                    .catch(() => false)
            )
                await page.evaluate(() => window.barcodeProof.cleanup());
            await page.goto(`${origin}/?format=${format}&${query}`);
            await page.waitForFunction(() => Boolean(window.barcodeProof));
        };
        const snapshot = () =>
            page.evaluate(() => window.barcodeProof.snapshot());
        for (const format of ['esm', 'cjs']) {
            await visit(format);
            const button = page.getByRole('button', {
                name: 'Scan barcode or QR code',
            });
            await button.click();
            await page.getByRole('dialog').waitFor();
            await page.waitForFunction(
                () => window.barcodeProof.snapshot().acquisitions === 1
            );
            await page
                .getByRole('button', { name: 'Close', exact: true })
                .focus();
            await page.keyboard.press('Tab');
            assert(
                await page
                    .getByRole('dialog')
                    .evaluate((node) => node.contains(document.activeElement))
            );
            await page.keyboard.press('Escape');
            await page.getByRole('dialog').waitFor({ state: 'detached' });
            await button.waitFor();
            assert(
                await button.evaluate((node) => node === document.activeElement)
            );
            assert(
                (await snapshot()).tracks.every((state) => state === 'ended')
            );
            for (const dismissal of ['backdrop', 'close']) {
                await button.click();
                await page.getByRole('dialog').waitFor();
                if (dismissal === 'backdrop')
                    await page
                        .locator('.mx-sdk-scanner-overlay')
                        .click({ position: { x: 4, y: 4 } });
                else
                    await page
                        .getByRole('button', { name: 'Close', exact: true })
                        .click();
                await page.getByRole('dialog').waitFor({ state: 'detached' });
                assert(
                    await button.evaluate(
                        (node) => node === document.activeElement
                    )
                );
                assert(
                    (await snapshot()).tracks.every(
                        (state) => state === 'ended'
                    )
                );
            }
            for (const failure of ['no-device', 'denied', 'failure']) {
                await visit(format, `mode=${failure}`);
                await button.click();
                await page.getByRole('alert').waitFor();
                assert.equal(
                    await page.getByLabel('Original value').inputValue(),
                    'manual-original'
                );
                assert.deepEqual((await snapshot()).writes, []);
                await page.evaluate(() => window.barcodeProof.mode('success'));
                await page.getByRole('button', { name: 'Try again' }).click();
                await page.waitForFunction(
                    () => window.barcodeProof.snapshot().writes.length === 1
                );
                await page.getByRole('dialog').waitFor({ state: 'detached' });
                assert.deepEqual((await snapshot()).writes, ['<SCANNED-123>']);
                assert(
                    (await snapshot()).tracks.every(
                        (state) => state === 'ended'
                    )
                );
            }
            for (const kind of ['barcode', 'email', 'url', 'singleLineText']) {
                await visit(format, `kind=${kind}&enabled=false&auto=true`);
                if (kind === 'barcode') {
                    await page.getByRole('dialog').waitFor();
                    await page
                        .getByRole('button', { name: 'Close', exact: true })
                        .click();
                } else {
                    assert.equal(await button.count(), 0);
                    assert.equal((await snapshot()).acquisitions, 0);
                }
                await page.evaluate(() =>
                    window.barcodeProof.patch({ enabled: true })
                );
                assert.equal(await page.locator('video').count(), 0);
                await button.click();
                await page.getByRole('dialog').waitFor();
                await page.waitForFunction(() =>
                    window.barcodeProof
                        .snapshot()
                        .tracks.some((state) => state === 'live')
                );
                await page.evaluate(() =>
                    window.barcodeProof.patch({ readOnly: true })
                );
                await page.getByRole('dialog').waitFor({ state: 'detached' });
                assert.equal(await button.count(), 0);
                assert(
                    (await snapshot()).tracks.every(
                        (state) => state === 'ended'
                    )
                );
                await page.evaluate(() =>
                    window.barcodeProof.patch({ readOnly: false })
                );
                assert.equal(await page.locator('video').count(), 0);
                await page.evaluate(() => window.barcodeProof.mode('success'));
                await button.click();
                await page.waitForFunction(
                    () => window.barcodeProof.snapshot().writes.length === 1
                );
            }
            await visit(format, 'mode=late-media');
            await button.click();
            await page.waitForFunction(
                () => window.barcodeProof.snapshot().acquisitions === 1
            );
            await page
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await page.evaluate(() => window.barcodeProof.release());
            await page.waitForFunction(() =>
                window.barcodeProof
                    .snapshot()
                    .tracks.every((state) => state === 'ended')
            );
            assert.deepEqual((await snapshot()).writes, []);
            await visit(format, 'mode=held&loop=true');
            await button.click();
            await page.waitForFunction(
                () => window.barcodeProof.snapshot().writes.length === 1
            );
            await page
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            await page.evaluate(() => window.barcodeProof.mode('waiting'));
            await button.click();
            await page.waitForFunction(
                () => window.barcodeProof.snapshot().acquisitions === 2
            );
            await page.evaluate(() => window.barcodeProof.release());
            await page.waitForTimeout(550);
            assert.equal(await page.locator('video').count(), 1);
            assert.equal((await snapshot()).acquisitions, 2);
            assert.equal((await snapshot()).settled, 1);
            assert.equal((await snapshot()).writes.length, 1);
            await page
                .getByRole('button', { name: 'Close', exact: true })
                .click();
            assert(
                (await snapshot()).tracks.every((state) => state === 'ended')
            );
            assert.equal((await snapshot()).submits, 0);
            if (nativeParent) {
                for (const dismissal of ['Escape', 'Close', 'backdrop']) {
                    await visit(format, 'nested=true&loop=true&mode=held');
                    const parent = page.getByRole('dialog', {
                        name: 'Native finder',
                    });
                    await parent.waitFor();
                    await page
                        .getByRole('button', {
                            name: 'Scan barcode or QR code',
                        })
                        .click();
                    const scanner = page.getByRole('dialog', {
                        name: 'Scan barcode or QR code',
                    });
                    await scanner.waitFor();
                    await page.waitForFunction(
                        () => window.barcodeProof.snapshot().writes.length === 1
                    );
                    if (dismissal === 'Escape')
                        await page.keyboard.press('Escape');
                    else if (dismissal === 'Close')
                        await page
                            .getByRole('button', { name: 'Close', exact: true })
                            .click();
                    else
                        await page
                            .locator('.mx-sdk-scanner-overlay')
                            .click({ position: { x: 4, y: 4 } });
                    await scanner.waitFor({ state: 'detached' });
                    assert.equal(
                        (await snapshot()).parentDismissed,
                        0,
                        'scanner dismissal closed the native finder'
                    );
                    assert(await parent.isVisible());
                    await page.evaluate(() => window.barcodeProof.release());
                    await page.waitForTimeout(550);
                    assert.equal((await snapshot()).writes.length, 1);
                    assert.equal((await snapshot()).settled, 1);
                    assert.equal(await page.locator('video').count(), 0);
                    assert(
                        await page
                            .getByRole('button', {
                                name: 'Scan barcode or QR code',
                            })
                            .evaluate((node) => node === document.activeElement)
                    );
                }
                evidence.nativeParent = {
                    react: '18.3.1',
                    dialog: '1.7.2',
                    status: 'passed',
                    dismissals: ['Escape', 'Close', 'backdrop'],
                };
            }
            evidence.profiles.push({
                format,
                react: (await snapshot()).react,
                status: 'passed',
                proof: 'synthetic canvas media / controlled decoder; no hardware camera',
            });
        }
        await visit('esm', 'mode=no-device');
        await page
            .getByRole('button', { name: 'Scan barcode or QR code' })
            .click();
        await page.getByRole('alert').waitFor();
        await page.screenshot({
            path: join(output, 'complete-barcode-scanner.png'),
        });
        await page.getByRole('button', { name: 'Enter manually' }).click();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
    } catch (error) {
        primaryFailure = error;
        evidence.status = 'failed';
        evidence.error = String(error);
        if (page)
            try {
                await page.screenshot({
                    path: join(output, 'complete-barcode-failure.png'),
                });
            } catch {}
        throw error;
    } finally {
        // Match the existing browser proofs: attempt every acquired resource and
        // preserve both the primary failure and any cleanup failures.
        const cleanupErrors = [];
        const steps = [
            [
                'nativeParentPackage',
                nativeParentRoot,
                () =>
                    execFileSync(
                        'npm',
                        [
                            'uninstall',
                            '--ignore-scripts',
                            '--no-audit',
                            '--no-fund',
                            '--package-lock=false',
                            'native-dialog',
                        ],
                        {
                            cwd: nativeParentRoot,
                            stdio: ['ignore', 'pipe', 'inherit'],
                            timeout: 30000,
                        }
                    ),
            ],
            ['context', context, () => context.close()],
            [
                'server',
                server,
                () =>
                    new Promise((yes, no) =>
                        server.close((error) => (error ? no(error) : yes()))
                    ),
            ],
            [
                'directory',
                directory,
                () => rmSync(directory, { recursive: true, force: true }),
            ],
        ];
        for (const [name, available, cleanup] of steps) {
            if (!available) {
                evidence.cleanup[name] = 'not-acquired';
                continue;
            }
            try {
                await cleanup();
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.cleanup[name] = {
                    status: 'failed',
                    error: String(error),
                };
                cleanupErrors.push(error);
            }
        }
        if (cleanupErrors.length) {
            evidence.status = 'failed';
            throw new AggregateError(
                primaryFailure === undefined
                    ? cleanupErrors
                    : [primaryFailure, ...cleanupErrors],
                'Scanner browser proof and cleanup did not complete'
            );
        }
    }
}
