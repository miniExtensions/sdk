import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execPackageFileSync } from './package-manager-launch.mjs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const fixture = String.raw`
const stats={stores:[],rasters:[],writes:[],releases:[],recoveries:[],submits:0};
const hiddenDraw=new URLSearchParams(location.search).has('hiddenDraw');
let patch,resolveReceipt,referenceRef,adapterRef,capturedRaster,adapterEmpty=true;let canonical={owner:'A',value:hiddenDraw?[]:[{id:'old',url:'https://example.invalid/old'}]};
const all={allowTypedSignature:true,allowDrawnSignature:true,allowUploadedSignature:true};
const attachment={id:null,url:'https://example.invalid/signature.png',filename:'signature.png',type:'image/png'};
function App(){referenceRef=React.useRef();adapterRef=React.useRef();const [state,setState]=React.useState({owner:'A',config:hiddenDraw?{allowDrawnSignature:true}:all,value:canonical.value,mounted:true});
patch=next=>{Object.assign(canonical,next);flushSync(()=>setState(old=>({...old,...next})));};
const storage={async store(file,authority){stats.stores.push({name:file.name,type:file.type,size:file.size,authority});
const image=await createImageBitmap(file);const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();capturedRaster=c;const pixels=ctx.getImageData(0,0,c.width,c.height).data;let painted=0,transparent=0;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]===0)transparent++;if(pixels[i]<128&&pixels[i+3]>0)painted++;}stats.rasters.push({width:c.width,height:c.height,corner:[...pixels.slice(0,4)],painted,transparent});
return new Promise(resolve=>{resolveReceipt=()=>resolve({attachment,release:async()=>{stats.releases.push(authority.operationId);return 'released';}});});}};
return h('form',{onSubmit:e=>{e.preventDefault();stats.submits++;throw Error('Signature submitted form');}},
h('section',{id:'first',hidden:hiddenDraw},state.mounted&&h(SignatureField,{id:'first-canvas',ownerIdentity:state.owner,value:state.value,config:state.config,storage,onRecovery:r=>stats.recoveries.push(r.phase),appendCurrent(request){if(canonical.owner!==request.ownerIdentity)return 'retired';canonical.value=canonical.value.concat(request.attachment);stats.writes.push([...canonical.value]);flushSync(()=>setState(old=>({...old,value:canonical.value})));return 'appended';}})),
withReference&&h('section',{id:'adapter-reference'},h(SignatureCanvas,{ref:adapterRef,id:'adapter-canvas',label:'Adapter reference',onDraft:empty=>{adapterEmpty=empty;}})),
withReference&&h('section',{id:'wrapper-reference'},h(ReferencePad,{ref:referenceRef,canvasProps:{className:'mx-sdk-signature-canvas'}})),
h('section',{id:'second'},h(SignatureField,{id:'second-canvas',ownerIdentity:'independent',value:[],storage,onRecovery:r=>stats.recoveries.push(r.phase),appendCurrent(){throw Error('Second canvas unexpectedly appended');}})));
}
const root=createRoot(document.querySelector('main'));root.render(h(React.StrictMode,null,h(App)));
window.signatureProof={snapshot:()=>JSON.parse(JSON.stringify(stats)),raster:()=>capturedRaster,patch:next=>patch(next),resolve:()=>resolveReceipt(),destroy:()=>root.unmount(),parity:()=>({adapter:adapterRef.current.toDataURL(),wrapper:referenceRef.current.toDataURL(),adapterEmpty,wrapperEmpty:referenceRef.current.isEmpty()})};
`;

async function checkHiddenDraw(context, origin, ratio, evidence) {
    const page = await context.newPage();
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    const result = { ratio, case: 'draw after revealing the same hidden host' };
    evidence.results.push(result);
    try {
        await page.goto(`${origin}/?hiddenDraw`);
        const host = page.locator('#first');
        const canvas = host.locator('canvas');
        await canvas.waitFor({ state: 'attached' });
        const measure = () =>
            canvas.evaluate((node) => ({
                width: node.width,
                height: node.height,
                cssWidth: node.offsetWidth,
                cssHeight: node.offsetHeight,
                viewport: [innerWidth, innerHeight, devicePixelRatio],
            }));
        result.initial = await measure();
        assert.equal(result.initial.cssWidth, 0);
        assert.equal(result.initial.cssHeight, 0);
        assert.equal(result.initial.viewport[2], ratio);
        const original = await canvas.elementHandle();
        await page.evaluate(() => {
            window.signatureProof.resizeEvents = 0;
            window.addEventListener('resize', () => {
                window.signatureProof.resizeEvents++;
            });
        });
        const setHidden = (hidden) =>
            host.evaluate((node, hidden) => {
                node.hidden = hidden;
            }, hidden);
        await setHidden(false);
        result.revealed = await measure();
        assert(result.revealed.cssWidth > 0);
        assert(result.revealed.cssHeight > 0);
        await page.waitForFunction(
            () => {
                const node = document.querySelector('#first canvas');
                return (
                    node.width === node.offsetWidth * devicePixelRatio &&
                    node.height === node.offsetHeight * devicePixelRatio
                );
            },
            null,
            { timeout: 2500 }
        );
        result.scaled = await measure();
        assert.deepEqual(result.scaled.viewport, result.initial.viewport);
        assert.equal(
            await canvas.evaluate(
                (node, original) => node === original,
                original
            ),
            true
        );

        const bounds = await canvas.boundingBox();
        assert(bounds);
        const empty = await canvas.evaluate((node) => node.toDataURL());
        await page.mouse.move(bounds.x + 15, bounds.y + 20);
        await page.mouse.down();
        await page.mouse.move(bounds.x + 100, bounds.y + 80, { steps: 8 });
        await page.mouse.up();
        const ink = await canvas.evaluate((node) => node.toDataURL());
        assert.notEqual(ink, empty);
        await setHidden(true);
        // Leave the host hidden long enough for the installed resize debounce.
        await page.evaluate(
            () => new Promise((resolve) => setTimeout(resolve, 200))
        );
        await setHidden(false);
        await page.evaluate(
            () => new Promise((resolve) => setTimeout(resolve, 200))
        );
        assert.deepEqual(await measure(), result.scaled);
        assert.equal(await canvas.evaluate((node) => node.toDataURL()), ink);
        result.preservedInk = true;

        const sign = host.getByRole('button', { name: 'Sign', exact: true });
        assert.equal(await sign.isEnabled(), true);
        await sign.click();
        await page.waitForFunction(
            () => window.signatureProof.snapshot().rasters.length === 1
        );
        await page.evaluate(() => window.signatureProof.resolve());
        await page.waitForFunction(
            () => window.signatureProof.snapshot().writes.length === 1
        );
        const saved = await page.evaluate(() =>
            window.signatureProof.snapshot()
        );
        const [raster] = saved.rasters;
        assert.equal(raster.width, result.scaled.width);
        assert.equal(raster.height, result.scaled.height);
        assert(raster.painted > 0);
        assert(raster.transparent > 0);
        assert.equal(saved.stores.length, 1);
        assert.equal(saved.stores[0].type, 'image/png');
        assert.equal(saved.writes[0].length, 1);
        assert.equal(saved.writes[0][0].filename, 'signature.png');
        assert.equal(saved.submits, 0);
        assert.equal(
            await page.evaluate(() => window.signatureProof.resizeEvents),
            0
        );
        await page.evaluate(() => window.signatureProof.destroy());
        Object.assign(result, {
            raster,
            stores: 1,
            appends: 1,
            submits: 0,
            status: 'passed',
        });
    } finally {
        await page.close();
    }
}

async function checkTypedRaster(context, origin, evidence) {
    const page = await context.newPage();
    page.on('pageerror', (error) => evidence.pageErrors.push(error.message));
    try {
        for (const name of [
            'Ada',
            'Alexandria Montgomery Penelope Rutherford',
        ]) {
            await page.goto(origin);
            const field = page.locator('#first');
            const input = field.getByPlaceholder('Type your name here');
            await input.fill(name);
            assert.equal(await input.inputValue(), name);
            await field
                .getByRole('button', { name: 'Sign', exact: true })
                .click();
            await page.waitForFunction(
                () => window.signatureProof.snapshot().rasters.length === 1
            );
            await page.evaluate(() => window.signatureProof.resolve());
            await page.waitForFunction(
                () => window.signatureProof.snapshot().writes.length === 1
            );
            const result = await page.evaluate((value) => {
                const saved = window.signatureProof.raster();
                const savedPixels = saved
                    .getContext('2d')
                    .getImageData(0, 0, 600, 200).data;
                const font =
                    '48px "Brush Script MT", "Lucida Handwriting", cursive';
                const draw = (width, scale, text = value) => {
                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = 200;
                    const context = canvas.getContext('2d');
                    context.fillStyle = '#fff';
                    context.fillRect(0, 0, width, 200);
                    context.fillStyle = '#000';
                    context.font = font;
                    context.textAlign = 'center';
                    context.textBaseline = 'middle';
                    context.translate(width / 2, 100);
                    context.scale(scale, scale);
                    context.fillText(text, 0, 0);
                    return context;
                };
                const metrics = draw(600, 1, '').measureText(value);
                const maximumExtent = Math.max(
                    metrics.actualBoundingBoxLeft,
                    metrics.actualBoundingBoxRight
                );
                const fullWidth = Math.max(
                    604,
                    2 * Math.ceil(maximumExtent) + 4
                );
                const full = draw(fullWidth, 1);
                const cropLeft = (fullWidth - 600) / 2;
                const fullPixels = full.getImageData(0, 0, fullWidth, 200).data;
                const crop = full.getImageData(cropLeft, 0, 600, 200).data;
                const expected = draw(
                    600,
                    maximumExtent > 300 ? 299 / maximumExtent : 1
                ).getImageData(0, 0, 600, 200).data;
                let first = fullWidth;
                let last = -1;
                let clippedInk = 0;
                for (let pixel = 0; pixel < fullWidth * 200; pixel++) {
                    if (fullPixels[pixel * 4] >= 128) continue;
                    const x = pixel % fullWidth;
                    first = Math.min(first, x);
                    last = Math.max(last, x);
                    if (x < cropLeft || x >= cropLeft + 600) clippedInk++;
                }
                const snapshot = window.signatureProof.snapshot();
                return {
                    width: saved.width,
                    height: saved.height,
                    opaque: savedPixels.every(
                        (value, i) => i % 4 !== 3 || value === 255
                    ),
                    referenceInkWidth: last - first + 1,
                    clippedInk,
                    matchesCenterCrop: savedPixels.every(
                        (value, i) => value === crop[i]
                    ),
                    matchesWholeName: savedPixels.every(
                        (value, i) => value === expected[i]
                    ),
                    stores: snapshot.stores.length,
                    appends: snapshot.writes.length,
                    submits: snapshot.submits,
                };
            }, name);
            evidence.results.push({
                typedRaster: name === 'Ada' ? 'short' : 'long',
                ...result,
            });
            assert.deepEqual(
                [result.width, result.height, result.opaque],
                [600, 200, true]
            );
            assert.deepEqual(
                [result.stores, result.appends, result.submits],
                [1, 1, 0]
            );
            if (name === 'Ada') assert(result.matchesCenterCrop);
            else {
                assert(result.referenceInkWidth > 600);
                assert(result.clippedInk > 0);
            }
            assert(
                result.matchesWholeName,
                `Saved PNG differs from the fitted whole name: ${JSON.stringify(result)}`
            );
        }
    } finally {
        await page.close();
    }
}

async function checkSignatureTabs(page, field, width) {
    const type = field.getByRole('tab', { name: 'Type', exact: true });
    const upload = field.getByRole('tab', { name: 'Upload', exact: true });
    const selected = field.getByRole('tab', { selected: true });
    const read = (tab) =>
        tab.evaluate((button) => {
            const style = getComputedStyle(button);
            return {
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                lineHeight: style.lineHeight,
                color: style.color,
                underline: style.borderBottomColor,
                underlineWidth: style.borderBottomWidth,
            };
        });
    await type.waitFor();
    await field.evaluate((host) =>
        host.style.setProperty('--mx-sdk-accent', 'rgb(123, 45, 67)')
    );
    const previous = await page.evaluate(() =>
        window.signatureProof.snapshot()
    );
    assert.equal(await selected.count(), 1);
    assert.equal(await selected.textContent(), 'Type');
    assert.deepEqual(await read(type), {
        fontSize: '14px',
        fontWeight: '500',
        lineHeight: '20px',
        color: 'rgb(123, 45, 67)',
        underline: 'rgb(123, 45, 67)',
        underlineWidth: '2px',
    });
    assert.equal((await read(upload)).color, 'rgb(107, 114, 128)');
    if (width === 1280) {
        await upload.hover();
        assert.equal((await read(upload)).color, 'rgb(55, 65, 81)');
    }
    await field.evaluate((host) =>
        host.style.setProperty(
            '--mx-sdk-signature-tab-underline',
            'rgb(20, 184, 166)'
        )
    );
    await upload.click();
    assert.equal(await selected.count(), 1);
    assert.equal(await selected.textContent(), 'Upload');
    assert.equal((await read(upload)).color, 'rgb(123, 45, 67)');
    assert.equal((await read(upload)).underline, 'rgb(20, 184, 166)');
    assert.equal(await field.locator('input[type="file"]').count(), 1);
    await type.click();
    assert.equal(await selected.textContent(), 'Type');
    assert.deepEqual(
        await page.evaluate(() => window.signatureProof.snapshot()),
        previous
    );
}

/** Real raster, pointer, DPR, resize, and retired-engine isolation on packed bytes. */
export async function checkSignatureBrowser({
    browser,
    consumer,
    evidence,
    output,
    format = 'esm',
    reference = false,
}) {
    Object.assign(evidence, {
        status: 'running',
        format,
        results: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    const directory = mkdtempSync(join(consumer, '.signature-browser-'));
    let server;
    try {
        if (reference)
            execPackageFileSync(
                'npm',
                [
                    'install',
                    '--ignore-scripts',
                    '--strict-peer-deps',
                    '--no-audit',
                    '--no-fund',
                    '--package-lock=false',
                    '--cache',
                    join(directory, 'npm-cache'),
                    '--save-exact',
                    'react-signature-pad-wrapper@3.3.4',
                    'signature_pad@4.1.7',
                ],
                { cwd: consumer, stdio: 'inherit' }
            );
        if (reference)
            evidence.referenceDependencies = JSON.parse(
                execPackageFileSync('npm', ['ls', 'signature_pad', '--json'], {
                    cwd: consumer,
                    encoding: 'utf8',
                })
            );
        const entry = join(
            directory,
            format === 'esm' ? 'host.mjs' : 'host.cjs'
        );
        const imports =
            format === 'esm'
                ? `import React,{createElement as h}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{SignatureField,SignatureCanvas}from'@miniextensions/sdk/react';`
                : `const React=require('react'),{createElement:h}=React;const{createRoot}=require('react-dom/client');const{flushSync}=require('react-dom');const{SignatureField,SignatureCanvas}=require('@miniextensions/sdk/react');`;
        const referenceImport = reference
            ? format === 'esm'
                ? "import ReferencePad from 'react-signature-pad-wrapper';const withReference=true;"
                : "const ReferencePad=require('react-signature-pad-wrapper').default;const withReference=true;"
            : 'const withReference=false,ReferencePad=()=>null;';
        writeFileSync(entry, imports + referenceImport + fixture);
        const bundled = await build({
            absWorkingDir: consumer,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundled.metafile, consumer);
        const sdkRequire = createRequire(
            join(consumer, 'node_modules/@miniextensions/sdk/package.json')
        );
        const engineEntry = sdkRequire.resolve('signature_pad');
        const enginePackage = JSON.parse(
            readFileSync(
                sdkRequire.resolve('signature_pad/package.json'),
                'utf8'
            )
        );
        assert.equal(enginePackage.version, '4.1.7');
        evidence.engine = {
            version: enginePackage.version,
            umdSha256: createHash('sha256')
                .update(readFileSync(engineEntry))
                .digest('hex'),
        };
        const css = readFileSync(
            join(
                consumer,
                'node_modules/@miniextensions/sdk/dist/esm/react/signature.css'
            )
        );
        evidence.bundleSha256 = createHash('sha256')
            .update(bundled.outputFiles[0].contents)
            .digest('hex');
        evidence.cssSha256 = createHash('sha256').update(css).digest('hex');
        const assets = new Map([
            [
                '/',
                Buffer.from(
                    '<!doctype html><link rel="stylesheet" href="/signature.css"><main></main><script type="module" src="/signature.js"></script>'
                ),
            ],
            ['/signature.js', bundled.outputFiles[0].contents],
            ['/signature.css', css],
        ]);
        server = createServer((req, res) => {
            const path = new URL(req.url, 'http://localhost').pathname;
            res.setHeader(
                'Content-Type',
                path.endsWith('.js')
                    ? 'application/javascript'
                    : path.endsWith('.css')
                      ? 'text/css'
                      : 'text/html'
            );
            res.writeHead(assets.has(path) ? 200 : 404);
            res.end(assets.get(path));
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        for (const ratio of [1, 2]) {
            evidence.cleanup.contexts = 'pending';
            const context = await browser.newContext({
                viewport: { width: 900, height: 850 },
                deviceScaleFactor: ratio,
            });
            try {
                await context.route('**/*', (route) => {
                    const url = new URL(route.request().url());
                    if (url.origin === origin && assets.has(url.pathname))
                        return route.continue();
                    evidence.unexpectedRequests.push(url.origin + url.pathname);
                    return route.abort();
                });
                await checkHiddenDraw(context, origin, ratio, evidence);
                if (ratio === 1)
                    await checkTypedRaster(context, origin, evidence);
                const tabWidth = ratio === 1 ? 375 : 1280;
                const tabPage = await context.newPage();
                try {
                    tabPage.on('pageerror', (error) =>
                        evidence.pageErrors.push(error.message)
                    );
                    await tabPage.setViewportSize({
                        width: tabWidth,
                        height: 850,
                    });
                    await tabPage.goto(origin);
                    await checkSignatureTabs(
                        tabPage,
                        tabPage.locator('#first'),
                        tabWidth
                    );
                    evidence.results.push({
                        ratio,
                        tabWidth,
                        methodTabs: 'passed',
                    });
                } finally {
                    await tabPage.close();
                }
                const page = await context.newPage();
                page.on('pageerror', (error) =>
                    evidence.pageErrors.push(error.message)
                );
                await page.goto(origin);
                if (reference) {
                    await page.locator('#adapter-reference canvas').waitFor();
                    await page.locator('#wrapper-reference canvas').waitFor();
                    const parity = await page.evaluate(() => {
                        const OriginalDate = Date;
                        let clock = 1000000;
                        // The engine uses both Date.now() and new Date().getTime().
                        // Supply identical timestamps through the public time boundary.
                        globalThis.Date = class extends OriginalDate {
                            constructor(...args) {
                                if (args.length === 0) super(clock);
                                else super(...args);
                            }
                            static now() {
                                return clock;
                            }
                        };
                        try {
                            for (const selector of [
                                '#adapter-reference canvas',
                                '#wrapper-reference canvas',
                            ]) {
                                clock = 1000000;
                                const canvas = document.querySelector(selector),
                                    box = canvas.getBoundingClientRect();
                                for (const [index, [x, y]] of [
                                    [10, 10],
                                    [40, 35],
                                    [70, 60],
                                    [100, 30],
                                    [130, 80],
                                ].entries()) {
                                    clock += 20;
                                    canvas.dispatchEvent(
                                        new PointerEvent(
                                            index === 0
                                                ? 'pointerdown'
                                                : 'pointermove',
                                            {
                                                clientX: box.x + x,
                                                clientY: box.y + y,
                                                button: 0,
                                                buttons: 1,
                                                pressure: 0.5,
                                            }
                                        )
                                    );
                                }
                                clock += 20;
                                document.dispatchEvent(
                                    new PointerEvent('pointerup', {
                                        clientX: box.x + 150,
                                        clientY: box.y + 100,
                                        button: 0,
                                        buttons: 0,
                                        pressure: 0.5,
                                    })
                                );
                            }
                            return window.signatureProof.parity();
                        } finally {
                            globalThis.Date = OriginalDate;
                        }
                    });
                    for (const kind of ['adapter', 'wrapper'])
                        writeFileSync(
                            join(
                                output,
                                `parity-${format}-dpr${ratio}-${kind}.png`
                            ),
                            Buffer.from(parity[kind].split(',')[1], 'base64')
                        );
                    assert.equal(
                        createHash('sha256')
                            .update(parity.adapter)
                            .digest('hex'),
                        createHash('sha256')
                            .update(parity.wrapper)
                            .digest('hex'),
                        'Native wrapper and SDK raster/export parity'
                    );
                    assert.equal(parity.adapterEmpty, false);
                    assert.equal(parity.wrapperEmpty, false);
                    await page.evaluate(() =>
                        window.dispatchEvent(new Event('resize'))
                    );
                    await page.waitForTimeout(170);
                    const unchanged = await page.evaluate(() =>
                        window.signatureProof.parity()
                    );
                    assert.deepEqual(
                        unchanged,
                        {
                            adapter: parity.adapter,
                            wrapper: parity.wrapper,
                            adapterEmpty: parity.adapterEmpty,
                            wrapperEmpty: parity.wrapperEmpty,
                        },
                        'Unchanged-size resize preserves both pad exports'
                    );
                    evidence.results.push({
                        ratio,
                        reference: 'wrapper3.3.4/pad4.1.7',
                        rasterExportParity: 'passed',
                        unchangedResize: 'passed',
                    });
                }
                const first = page.locator('#first');
                const second = page.locator('#second');
                await page.evaluate(() => {
                    document.body.style.setProperty(
                        '--mx-sdk-accent',
                        'rgb(123, 45, 67)'
                    );
                    document.body.style.setProperty(
                        '--mx-sdk-button-foreground',
                        'rgb(0, 0, 0)'
                    );
                });
                const themed = await first
                    .locator('.mx-sdk-signature-primary')
                    .evaluate((node) => ({
                        background: getComputedStyle(node).backgroundColor,
                        color: getComputedStyle(node).color,
                    }));
                assert.deepEqual(themed, {
                    background: 'rgb(123, 45, 67)',
                    color: 'rgb(0, 0, 0)',
                });
                await first.getByPlaceholder('Type your name here').fill('Ada');
                await first
                    .getByRole('button', { name: 'Sign', exact: true })
                    .click();
                await page.waitForFunction(
                    () => window.signatureProof.snapshot().rasters.length === 1
                );
                await first
                    .getByPlaceholder('Type your name here')
                    .fill('Newer B');
                await page.evaluate(() =>
                    window.signatureProof.patch({ value: [] })
                );
                await page.evaluate(() => window.signatureProof.resolve());
                await page.waitForFunction(
                    () => window.signatureProof.snapshot().writes.length === 1
                );
                assert.equal(
                    await first
                        .getByPlaceholder('Type your name here')
                        .inputValue(),
                    'Newer B'
                );
                const typed = await page.evaluate(() =>
                    window.signatureProof.snapshot()
                );
                assert.equal(typed.writes[0].length, 1);
                assert.deepEqual(
                    [typed.rasters[0].width, typed.rasters[0].height],
                    [600, 200]
                );
                assert.deepEqual(typed.rasters[0].corner, [255, 255, 255, 255]);
                assert(typed.rasters[0].painted > 0);
                assert.equal(typed.rasters[0].transparent, 0);
                await page.screenshot({
                    path: join(
                        output,
                        `signature-${format}-dpr${ratio}-typed.png`
                    ),
                });
                // Keep a typed intake admitted while a different method's B
                // is edited. Tab navigation is not method disablement.
                await first
                    .getByRole('button', { name: 'Sign', exact: true })
                    .click();
                await page.waitForFunction(
                    () => window.signatureProof.snapshot().rasters.length === 2
                );
                await first
                    .getByRole('tab', { name: 'Draw', exact: true })
                    .click();
                const crossCanvas = first.locator('canvas');
                await crossCanvas.waitFor();
                const crossBounds = await crossCanvas.boundingBox();
                assert(crossBounds);
                await page.mouse.move(crossBounds.x + 15, crossBounds.y + 20);
                await page.mouse.down();
                await page.mouse.move(crossBounds.x + 90, crossBounds.y + 70, {
                    steps: 6,
                });
                await page.mouse.up();
                const beforeTransfer = await crossCanvas.evaluate((node) =>
                    node.toDataURL()
                );
                assert.equal(
                    await first
                        .getByRole('button', { name: 'Saving...', exact: true })
                        .isDisabled(),
                    true
                );
                await page.evaluate(() => window.signatureProof.resolve());
                await page.waitForFunction(
                    () => window.signatureProof.snapshot().writes.length === 2
                );
                assert.equal(
                    await crossCanvas.evaluate((node) => node.toDataURL()),
                    beforeTransfer
                );
                assert.equal(
                    await first
                        .getByRole('button', { name: 'Sign', exact: true })
                        .isEnabled(),
                    true
                );
                await first
                    .getByRole('tab', { name: 'Type', exact: true })
                    .click();
                assert.equal(
                    await first
                        .getByPlaceholder('Type your name here')
                        .inputValue(),
                    ''
                );
                await first
                    .getByRole('tab', { name: 'Draw', exact: true })
                    .click();
                const canvas = first.locator('canvas');
                await canvas.waitFor();
                const bounds = await canvas.boundingBox();
                assert(bounds);
                assert.equal(
                    await canvas.evaluate((node) => node.width),
                    Math.round(bounds.width * ratio)
                );
                await page.mouse.move(bounds.x + 15, bounds.y + 20);
                await page.mouse.down();
                await page.mouse.move(bounds.x + 100, bounds.y + 80, {
                    steps: 8,
                });
                await page.mouse.up();
                assert.equal(
                    await first
                        .getByRole('button', { name: 'Sign', exact: true })
                        .isEnabled(),
                    true
                );
                assert.equal(
                    await second
                        .getByRole('button', { name: 'Sign', exact: true })
                        .isDisabled(),
                    true
                );
                await first
                    .getByRole('button', { name: 'Sign', exact: true })
                    .click();
                await page.waitForFunction(
                    () => window.signatureProof.snapshot().rasters.length === 3
                );
                const drawn = await page.evaluate(
                    () => window.signatureProof.snapshot().rasters[2]
                );
                assert(drawn.painted > 0);
                assert(drawn.transparent > 0);
                assert.deepEqual(drawn.corner, [0, 0, 0, 0]);
                // A newer stroke B must survive completion of the captured image A.
                await page.mouse.move(bounds.x + 120, bounds.y + 40);
                await page.mouse.down();
                await page.mouse.move(bounds.x + 170, bounds.y + 100, {
                    steps: 4,
                });
                await page.mouse.up();
                await page.evaluate(() => window.signatureProof.resolve());
                await page.waitForFunction(
                    () => window.signatureProof.snapshot().writes.length === 3
                );
                assert.equal(
                    await first
                        .getByRole('button', { name: 'Sign', exact: true })
                        .isEnabled(),
                    true
                );
                await page.setViewportSize({ width: 820, height: 850 });
                await page.waitForFunction(
                    () =>
                        document.querySelector(
                            '#first button.mx-sdk-signature-primary'
                        )?.disabled === true
                );
                if (reference) {
                    const parity = await page.evaluate(() =>
                        window.signatureProof.parity()
                    );
                    assert.equal(parity.adapter, parity.wrapper);
                    assert.equal(parity.adapterEmpty, true);
                    assert.equal(parity.wrapperEmpty, true);
                }
                const resized = await canvas.evaluate((node) => {
                    const p = node
                        .getContext('2d')
                        .getImageData(0, 0, node.width, node.height).data;
                    return {
                        width: node.width,
                        css: node.offsetWidth,
                        painted: p.some((value) => value !== 0),
                    };
                });
                assert.equal(resized.width, resized.css * ratio);
                assert.equal(resized.painted, false);
                // Queue the installed vendor's trailing work, then retire before it
                // runs. Observe old raster mutation without touching engine internals.
                const trailing = await page.evaluate(async () => {
                    const old = document.querySelector('#first canvas');
                    const box = old.getBoundingClientRect();
                    const pointer = (type, x) =>
                        new PointerEvent(type, {
                            clientX: box.x + x,
                            clientY: box.y + x / 2,
                            buttons: 1,
                            button: 0,
                        });
                    old.dispatchEvent(pointer('pointerdown', 10));
                    old.dispatchEvent(pointer('pointermove', 40));
                    old.dispatchEvent(pointer('pointermove', 120));
                    const before = old.toDataURL();
                    window.signatureProof.patch({
                        owner: 'B',
                        config: { allowDrawnSignature: true },
                    });
                    const next = document.querySelector('#first canvas');
                    await new Promise((resolve) => setTimeout(resolve, 30));
                    return {
                        changed: before !== old.toDataURL(),
                        detached: !old.isConnected,
                        fresh: next != null && old !== next,
                    };
                });
                assert.deepEqual(trailing, {
                    changed: true,
                    detached: true,
                    fresh: true,
                });
                // The replacement owner has a fresh, empty drawing canvas.
                assert.equal(
                    await first
                        .getByRole('button', { name: 'Sign', exact: true })
                        .isDisabled(),
                    true
                );
                assert.equal(
                    await second
                        .getByRole('button', { name: 'Sign', exact: true })
                        .isDisabled(),
                    true
                );
                const final = await page.evaluate(() =>
                    window.signatureProof.snapshot()
                );
                assert.equal(final.releases.length, 0);
                assert.equal(final.recoveries.length, 0);
                await page.screenshot({
                    path: join(output, `signature-${format}-dpr${ratio}.png`),
                });
                evidence.results.push({
                    ratio,
                    typed,
                    drawn,
                    crossMethod: 'passed',
                    resized,
                    trailing,
                    status: 'passed',
                });
                await page.evaluate(() => window.signatureProof.destroy());
            } finally {
                await context.close();
                evidence.cleanup.contexts = 'completed';
            }
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
    } catch (error) {
        evidence.status = 'failed';
        evidence.error = error.message;
        throw error;
    } finally {
        if (server)
            await new Promise((resolve, reject) =>
                server.close((error) => (error ? reject(error) : resolve()))
            );
        rmSync(directory, { recursive: true, force: true });
        evidence.cleanup.server = 'completed';
        evidence.cleanup.fixture = 'completed';
    }
}
