import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const hostSource = (format) => `
${
    format === 'esm'
        ? `import {createElement as h, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AttachmentPreview, AttachmentSliderNavigation, AttachmentSliderThumbnailRail, useAttachmentDownload} from '@miniextensions/sdk/react';`
        : `const {createElement:h, useState}=require('react');
const {createRoot}=require('react-dom/client');
const {AttachmentPreview, AttachmentSliderNavigation, AttachmentSliderThumbnailRail, useAttachmentDownload}=require('@miniextensions/sdk/react');`
}
const first={filename:'Vue avant',url:'/front.svg',type:'image/svg+xml'};
const second={filename:'Vue arrière',url:'/rear.svg',type:'image/svg+xml'};
const calls={selection:[],save:0,upload:0,delete:0,fetch:0};
const downloads={pending:[],finished:0};
const downloadListeners=new Set();
const downloadOwner={token:0,isCurrent:()=>true,subscribe(listener){
    downloadListeners.add(listener);
    return ()=>downloadListeners.delete(listener);
}};
window.fetch=()=>{calls.fetch++;return Promise.reject(Error('Unexpected I/O'));};
function Host(){
    const [rows,setRows]=useState([first,second]);
    const [selectedIndex,setSelectedIndex]=useState(0);
    const [acceptsIntent,setAcceptsIntent]=useState(false);
    const [collectionOwner,setCollectionOwner]=useState('initial');
    const [publication,setPublication]=useState('initial');
    function replace(owner){
        setRows([first,second]);
        setSelectedIndex(0);
        setCollectionOwner(owner);
        setPublication(owner);
    }
    window.sliderProbe={calls,downloads,setSelectedIndex,setAcceptsIntent,
        replace,
        rotateDownloadOwner(){downloadOwner.token++;for(const listener of [...downloadListeners])listener();},
        reset(owner){calls.selection.length=0;replace(owner);},
        remap(marker){setRows((items)=>items.map((item)=>({...item})));setPublication(marker);},
        duplicates(){setRows([first,{...second,filename:first.filename}]);setPublication('duplicates');},
        shrink(){setRows([first]);},
        retire(){setRows([]);setCollectionOwner(null);setPublication('retired');}};
    const selected=rows[selectedIndex];
    const download=useAttachmentDownload({
        url:selected?.url??null,
        filename:selected?.filename+'.svg',
        identity:collectionOwner+':'+selectedIndex,
        owner:downloadOwner,
        read(url){return new Promise((resolve)=>downloads.pending.push({url,resolve}));},
    });
    return h('form',{'data-publication':publication,onSubmit(event){event.preventDefault();calls.save++;}},
        h(AttachmentSliderNavigation,{
            rows,selectedIndex,collectionOwner,labels:{navigation:'Pièces jointes',previous:'Précédent',next:'Suivant'},
            onSelect(index){calls.selection.push(index);if(acceptsIntent)setSelectedIndex(index);},
        },selected&&h(AttachmentPreview,{attachment:selected}),h('input',{'aria-label':'Détail'})),
        collectionOwner&&h(AttachmentSliderThumbnailRail,{
            rows:rows.map((row,index)=>({
                key:collectionOwner+':'+index,
                filename:row.filename,
                thumbnailUrl:index===0?row.url:null,
            })),
            selectedIndex,
            onSelect(index){calls.selection.push(index);if(acceptsIntent)setSelectedIndex(index);},
        }),
        selected&&h('button',{type:'button','data-download':true,disabled:download.progress!=null,
            onClick(){void download.start().then(()=>downloads.finished++);}},
            download.progress==null?'Télécharger la pièce jointe':download.progress+'%'),
        h('button',{type:'submit'},'Enregistrer'),
        h('button',{type:'button',onClick(){calls.upload++;}},'Téléverser'),
        h('button',{type:'button',onClick(){calls.delete++;}},'Supprimer'));
}
createRoot(document.querySelector('main')).render(h(Host));
`;

const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';

export async function checkAttachmentSliderNavigationBrowser({
    browser,
    consumer,
    evidence,
}) {
    evidence.formats = {};
    const staleGestures = [];
    const require = createRequire(join(consumer, 'package.json'));
    const styles = readFileSync(
        require.resolve('@miniextensions/sdk/react/attachment-preview.css')
    );
    for (const format of ['esm', 'cjs']) {
        const entry = `attachment-slider-navigation-proof.${format === 'esm' ? 'mjs' : 'cjs'}`;
        writeFileSync(join(consumer, entry), hostSource(format));
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentSliderThumbnailRail.js')
            ),
            'The installed Slider Thumbnail Rail must be bundled'
        );
        const assets = new Map([
            [
                '/',
                [
                    'text/html',
                    '<!doctype html><html lang="fr"><meta charset="utf-8"><link rel="stylesheet" href="/attachment-preview.css"><main></main><script type="module" src="/host.js"></script></html>',
                ],
            ],
            ['/host.js', ['text/javascript', bundle.outputFiles[0].text]],
            ['/attachment-preview.css', ['text/css', styles]],
            ['/favicon.ico', ['image/svg+xml', svg]],
            ['/front.svg', ['image/svg+xml', svg]],
            ['/rear.svg', ['image/svg+xml', svg]],
        ]);
        const unexpectedRequests = [];
        const pageErrors = [];
        const server = createServer((request, response) => {
            const asset = request.method === 'GET' && assets.get(request.url);
            if (!asset) {
                unexpectedRequests.push(request.url);
                response.writeHead(404).end();
                return;
            }
            response
                .writeHead(200, {
                    'content-type': asset[0],
                    'content-security-policy':
                        "default-src 'self'; connect-src 'none'; form-action 'none'",
                })
                .end(asset[1]);
        });
        let context;
        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            const origin = `http://127.0.0.1:${server.address().port}`;
            context = await browser.newContext({ serviceWorkers: 'block' });
            await context.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (url.origin === origin && assets.has(url.pathname))
                    return route.continue();
                unexpectedRequests.push(url.href);
                return route.abort();
            });
            const page = await context.newPage();
            page.on('pageerror', (error) => pageErrors.push(error.message));
            await page.goto(origin);
            const navigation = page.getByRole('group', {
                name: 'Pièces jointes',
            });
            const previous = navigation.getByRole('button', {
                name: 'Précédent',
            });
            const next = navigation.getByRole('button', { name: 'Suivant' });
            const filename = navigation.locator('[aria-live]');
            const preview = navigation.locator('img');
            const probe = () => page.evaluate(() => window.sliderProbe.calls);
            const committed = (marker) =>
                page.locator(`form[data-publication="${marker}"]`).waitFor();
            await next.waitFor();
            assert.equal(await filename.innerText(), 'Vue avant');
            assert.equal(await previous.getAttribute('aria-disabled'), 'true');
            await next.click();
            assert.deepEqual((await probe()).selection, [1]);
            assert.equal(await filename.innerText(), 'Vue avant');
            await page.evaluate(() => {
                window.sliderProbe.setAcceptsIntent(true);
                window.sliderProbe.setSelectedIndex(1);
            });
            await navigation
                .getByText('Vue arrière', { exact: true })
                .waitFor();
            assert.equal(await next.getAttribute('aria-disabled'), 'true');
            await next.press('ArrowRight');
            assert.deepEqual((await probe()).selection, [1]);
            await next.press('ArrowLeft');
            await navigation.getByText('Vue avant', { exact: true }).waitFor();
            const detail = navigation.getByRole('textbox', { name: 'Détail' });
            await detail.press('ArrowRight');
            assert.deepEqual((await probe()).selection, [1, 0]);
            await page.evaluate(() => window.sliderProbe.duplicates());
            await committed('duplicates');
            await next.press('Enter');
            await navigation.locator('img[src="/rear.svg"]').waitFor();
            assert.equal(await filename.innerText(), 'Vue avant');
            assert.equal(await preview.getAttribute('src'), '/rear.svg');
            await page.evaluate(() => window.sliderProbe.shrink());
            await navigation.waitFor({ state: 'detached' });
            await page.evaluate(() => window.sliderProbe.retire());
            await page.keyboard.press('ArrowLeft');
            const calls = await probe();
            assert.deepEqual(calls, {
                selection: [1, 0, 1],
                save: 0,
                upload: 0,
                delete: 0,
                fetch: 0,
            });

            async function heldGesture(input, replaceOwner) {
                const initial = `${input}-initial`;
                const successor = `${input}-successor`;
                await page.evaluate(
                    (owner) => window.sliderProbe.reset(owner),
                    initial
                );
                await committed(initial);
                await next.waitFor();
                if (input === 'pointer') {
                    const position = await next.boundingBox();
                    assert.ok(position);
                    await page.mouse.move(
                        position.x + position.width / 2,
                        position.y + position.height / 2
                    );
                    await page.mouse.down();
                } else {
                    await next.focus();
                    await page.keyboard.down('Space');
                }
                const originalButton = await next.elementHandle();
                assert.ok(originalButton);
                await page.evaluate(
                    ({ marker, replace }) => {
                        if (replace) window.sliderProbe.replace(marker);
                        else window.sliderProbe.remap(marker);
                    },
                    { marker: successor, replace: replaceOwner }
                );
                await committed(successor);
                const sameControl = await next.evaluate(
                    (button, original) => button === original,
                    originalButton
                );
                await originalButton.dispose();
                if (input === 'pointer') await page.mouse.up();
                else await page.keyboard.up('Space');
                const held = (await probe()).selection;
                if (!replaceOwner) {
                    assert.deepEqual(held, [1]);
                    return { held, sameControl };
                }
                if (held.length)
                    staleGestures.push(
                        `${format}/${input}: ${JSON.stringify(held)}`
                    );
                await page.evaluate(() =>
                    window.sliderProbe.setSelectedIndex(0)
                );
                await navigation
                    .getByText('Vue avant', { exact: true })
                    .waitFor();
                if (input === 'pointer') await next.click();
                else await next.press('Space');
                const fresh = (await probe()).selection.slice(held.length);
                assert.deepEqual(fresh, [1]);
                return { held, fresh, sameControl };
            }

            const gestures = {
                replacedPointer: await heldGesture('pointer', true),
                replacedSpace: await heldGesture('space', true),
                remappedPointer: await heldGesture('pointer', false),
                remappedSpace: await heldGesture('space', false),
            };
            await page.evaluate(() =>
                window.sliderProbe.reset('thumbnail-rail')
            );
            await committed('thumbnail-rail');
            const rail = page.locator('.mx-sdk-attachment-thumbnail-rail');
            const frontTile = rail.getByRole('button', { name: 'Vue avant' });
            const rearTile = rail.getByRole('button', { name: 'Vue arrière' });
            await frontTile.waitFor();
            assert.equal(await frontTile.getAttribute('data-selected'), 'true');
            assert.equal(
                await rail.locator('img').getAttribute('src'),
                '/front.svg'
            );
            assert.equal(
                await rail.locator('svg').getAttribute('aria-hidden'),
                'true'
            );
            const railBounds = await rail.boundingBox();
            const tileBounds = await frontTile.boundingBox();
            const rearBounds = await rearTile.boundingBox();
            assert.ok(railBounds && tileBounds && rearBounds);
            const railGeometry = {
                height: railBounds.height,
                tile: [tileBounds.width, tileBounds.height],
                gap: rearBounds.x - tileBounds.x - tileBounds.width,
            };
            assert.deepEqual(railGeometry, {
                height: 44,
                tile: [40, 40],
                gap: 8,
            });
            await rearTile.click();
            await rail
                .locator('button[data-selected="true"]')
                .getByText('Vue arrière')
                .waitFor({ state: 'attached' });
            await frontTile.press('Space');
            await rail
                .locator('button[data-selected="true"]')
                .getByText('Vue avant')
                .waitFor({ state: 'attached' });
            const railSelection = (await probe()).selection;
            assert.deepEqual(railSelection, [1, 0]);
            const { selection: _selection, ...otherCalls } = await probe();
            assert.deepEqual(otherCalls, {
                save: 0,
                upload: 0,
                delete: 0,
                fetch: 0,
            });
            const download = page.locator('[data-download]');
            const saves = [];
            page.on('download', (file) => saves.push(file));
            const finish = (index, value) =>
                page.evaluate(
                    ({ index, value }) =>
                        window.sliderProbe.downloads.pending[index].resolve(
                            new Response(value, {
                                headers: {
                                    'Content-Length': String(value.length),
                                },
                            })
                        ),
                    { index, value }
                );
            const settled = (count) =>
                page.waitForFunction(
                    (expected) =>
                        window.sliderProbe.downloads.finished === expected,
                    count
                );
            const saveCurrent = async (index, contents) => {
                const [saved] = await Promise.all([
                    page.waitForEvent('download'),
                    finish(index, contents),
                ]);
                try {
                    assert.equal(saved.suggestedFilename(), 'Vue arrière.svg');
                    assert.equal(
                        readFileSync(await saved.path(), 'utf8'),
                        contents
                    );
                    return saved.suggestedFilename();
                } finally {
                    await saved.delete();
                }
            };
            await download.click();
            assert.equal(await download.innerText(), '0%');
            await rearTile.press('Space');
            await rail
                .locator('button[data-selected="true"]')
                .getByText('Vue arrière')
                .waitFor({ state: 'attached' });
            assert.equal(await download.isEnabled(), true);
            await download.click();
            await finish(0, 'old');
            await settled(1);
            assert.equal(await download.innerText(), '0%');
            assert.equal(saves.length, 0);
            const downloadFilename = await saveCurrent(1, 'current');
            await settled(2);

            await download.click();
            assert.equal(await download.innerText(), '0%');
            await page.evaluate(() => window.sliderProbe.rotateDownloadOwner());
            await page
                .getByRole('button', { name: 'Télécharger la pièce jointe' })
                .waitFor();
            assert.equal(await download.isEnabled(), true);
            await download.click();
            await finish(2, 'retired-generation');
            await settled(3);
            assert.equal(await download.innerText(), '0%');
            assert.equal(saves.length, 1);
            await saveCurrent(3, 'successor-generation');
            await settled(4);

            await download.click();
            await page.evaluate(() => window.sliderProbe.retire());
            await committed('retired');
            await finish(4, 'dismissed');
            await settled(5);
            assert.equal(saves.length, 2);
            const readUrls = await page.evaluate(() =>
                window.sliderProbe.downloads.pending.map(({ url }) => url)
            );
            assert.deepEqual(readUrls, [
                '/front.svg',
                '/rear.svg',
                '/rear.svg',
                '/rear.svg',
                '/rear.svg',
            ]);
            assert.deepEqual(unexpectedRequests, []);
            assert.deepEqual(pageErrors, []);
            evidence.formats[format] = {
                selection: calls.selection,
                ownerCalls: calls,
                gestures,
                thumbnailRail: {
                    geometry: railGeometry,
                    selection: railSelection,
                },
                download: {
                    readUrls,
                    filename: downloadFilename,
                    saves: saves.length,
                    notifiedOwnerRotation: true,
                },
                unexpectedRequests,
                pageErrors,
            };
        } finally {
            try {
                await context?.close();
            } finally {
                server.closeAllConnections();
                if (server.listening)
                    await new Promise((resolve, reject) => {
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        );
                    });
            }
        }
    }
    assert.deepEqual(
        staleGestures,
        [],
        'A retired owner’s held gesture selected in its successor'
    );
}
