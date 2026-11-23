import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const hostSource = (format, nativeConfirm) => `
${
    format === 'esm'
        ? `import {createElement as h, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AttachmentSlider} from '@miniextensions/sdk/react/attachment-slider';
import {AttachmentPreview, AttachmentSliderActions, AttachmentSliderBody, AttachmentSliderNavigation, AttachmentSliderThumbnailRail, AttachmentTileOpenButton, useAttachmentDownload, useAttachmentGalleryNavigation} from '@miniextensions/sdk/react';`
        : `const {createElement:h, useRef, useState}=require('react');
const {createRoot}=require('react-dom/client');
const {AttachmentSlider}=require('@miniextensions/sdk/react/attachment-slider');
const {AttachmentPreview, AttachmentSliderActions, AttachmentSliderBody, AttachmentSliderNavigation, AttachmentSliderThumbnailRail, AttachmentTileOpenButton, useAttachmentDownload, useAttachmentGalleryNavigation}=require('@miniextensions/sdk/react');`
}
${
    nativeConfirm
        ? format === 'esm'
            ? "import {Dialog as NativeDialog} from 'native-dialog';"
            : "const {Dialog:NativeDialog}=require('native-dialog');"
        : 'const NativeDialog=null;'
}
const first={filename:'Vue avant',url:'/front.svg',type:'image/svg+xml'};
const second={filename:'Vue arrière',url:'/rear.svg',type:'image/svg+xml'};
const calls={selection:[],save:0,upload:0,delete:0,fetch:0};
const tileOpens=[];
const downloads={pending:[],finished:0};
let bodySelections=0;
const headerCalls={deletes:0, reads:[], errors:0, escapes:0};
const headerListeners=new Set();
let headerCurrent=true;
const headerOwner={isCurrent:()=>headerCurrent,subscribe(listener){
    headerListeners.add(listener);
    return ()=>headerListeners.delete(listener);
}};
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
    const [tile,setTile]=useState({resourceKey:'initial',label:'Pièce jointe'});
    const [bodyRows,setBodyRows]=useState([
        {...first,id:'front',thumbnailUrl:first.url},
        {...second,id:'rear',thumbnailUrl:second.url},
    ]);
    const bodyNav=useAttachmentGalleryNavigation(bodyRows);
    const bodyRail=useRef(null);
    const [header,setHeader]=useState('closed');
    function replace(owner){
        setRows([first,second]);
        setSelectedIndex(0);
        setCollectionOwner(owner);
        setPublication(owner);
    }
    window.sliderProbe={calls,downloads,setSelectedIndex,setAcceptsIntent,
        tileOpens,publishTile(resourceKey,label){setTile({resourceKey,label});},
        openBody(){bodyNav.handleAttachmentThumbnailClick(0);},
        shrinkBody(){setBodyRows((items)=>items.slice(0,1));},
        emptyBody(){setBodyRows([]);},
        bodySelections:()=>bodySelections,
        showHeader:()=>setHeader('active'),
        closeHeader:()=>setHeader('closed'),
        revokeHeader:()=>{headerCurrent=false;},
        settleHeader(){
            for (const notify of [...headerListeners]) notify();
            headerCalls.reads[0].resolve(new Response('retired header bytes'));
        },
        headerCalls:()=>({deletes:headerCalls.deletes,reads:headerCalls.reads.map(({url})=>url),errors:headerCalls.errors,escapes:headerCalls.escapes}),
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
        h('button',{type:'button',onClick(){calls.delete++;}},'Supprimer'),
        h('div',{className:'attachment-tile-proof'},h(AttachmentTileOpenButton,{
            ...tile,onOpen(){tileOpens.push(tile.label);},
        })),
        header==='active'&&h('section',{'aria-label':'Commandes de la pièce jointe'},
            h(AttachmentSliderActions,{
                attachment:second,downloadIdentity:'selected-row',
                labels:{delete:'Effacer',download:'Télécharger',open:'Ouvrir'},
                canDownload:true,canOpen:true,presentationOwner:headerOwner,
                onDelete(){headerCalls.deletes++;},
                readDownload(url){return new Promise((resolve)=>headerCalls.reads.push({url,resolve}));},
                onDownloadError(){headerCalls.errors++;},
            })),
        bodyNav.navigationOwner&&h('div',{
            role:'dialog','aria-label':'Visionneuse','data-body-owner':bodyNav.navigationOwner,
            className:'attachment-body-proof',
        },h(AttachmentSliderBody,{
            rows:bodyRows,
            currentIndex:bodyNav.currentSliderIndex,
            setCurrentIndex(next){bodySelections++;bodyNav.setCurrentSliderIndex(next);},
            navigationOwner:bodyNav.navigationOwner,
            thumbnailRailRef:bodyRail,
            labels:{attachments:'Aperçu des pièces jointes',previewNotAvailable:'Aucun aperçu',previous:'Précédent',next:'Suivant'},
        })));
}

const fullscreenStats={dismissals:[],deleteRequests:0,confirmed:0,confirmDismissals:0,selections:0};
const fullscreenRows=[
    {...first,id:'fullscreen-front',thumbnailUrl:first.url},
    {...second,id:'fullscreen-rear',thumbnailUrl:second.url},
];
const fullscreenLabels={
    attachments:'Pièces jointes plein écran',previewNotAvailable:'Aucun aperçu',
    previous:'Précédent',next:'Suivant',delete:'Effacer la pièce jointe',
    download:'Télécharger la pièce jointe',open:'Ouvrir la pièce jointe',
    close:'Fermer la visionneuse',
};
function FullscreenHost(){
    const [mode,setMode]=useState(null);
    const [index,setIndex]=useState(0);
    const [intercomOpen,setIntercomOpen]=useState(false);
    const [confirm,setConfirm]=useState(false);
    const cancel=useRef(null);
    function open(nextMode){setIndex(0);setMode(nextMode);}
    window.fullscreenProbe={
        intercom:setIntercomOpen,
        stats:()=>({...fullscreenStats,dismissals:[...fullscreenStats.dismissals]}),
    };
    return h('section',{className:'attachment-fullscreen-host'},
        h('button',{type:'button',onClick:()=>open('standalone')},'Ouvrir le plein écran'),
        NativeDialog&&h('button',{type:'button',onClick:()=>open('native')},'Ouvrir avec confirmation native'),
        mode&&h(AttachmentSlider,{
            rows:fullscreenRows,currentIndex:index,
            setCurrentIndex(next){fullscreenStats.selections++;setIndex(next);},
            navigationOwner:mode,downloadIdentity:index,
            canDownload:true,canOpen:true,
            readDownload(){calls.fetch++;throw Error('Unexpected fullscreen download');},
            onDelete(){fullscreenStats.deleteRequests++;if(mode==='native')setConfirm(true);},
            onDismiss(){fullscreenStats.dismissals.push(mode);setMode(null);},
            covered:confirm,intercomOpen,labels:fullscreenLabels,
        }),
        confirm&&NativeDialog&&h(NativeDialog,{
            open:true,initialFocus:cancel,className:'attachment-native-confirm-proof',
            onClose(){fullscreenStats.confirmDismissals++;setConfirm(false);},
        },h(NativeDialog.Panel,{className:'attachment-native-confirm-panel'},
            h(NativeDialog.Title,null,'Confirmer la suppression'),
            h('button',{type:'button',onClick(){
                fullscreenStats.confirmed++;setConfirm(false);
            }},'Confirmer'),
            h('button',{type:'button',ref:cancel,onClick(){setConfirm(false);}},'Annuler'),
        )),
    );
}
window.addEventListener('keydown',(event)=>{
    if(event.key==='Escape'&&!event.defaultPrevented) headerCalls.escapes++;
});
createRoot(document.querySelector('main')).render(h('div',null,h(Host),h(FullscreenHost)));
`;

const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>';

export async function checkAttachmentSliderNavigationBrowser({
    browser,
    consumer,
    evidence,
    nativeConfirm = false,
}) {
    evidence.formats = {};
    const staleGestures = [];
    const require = createRequire(join(consumer, 'package.json'));
    if (nativeConfirm) {
        assert.equal(require('react').version, '18.3.1');
        const manifest = JSON.parse(
            readFileSync(
                join(
                    dirname(require.resolve('native-dialog')),
                    '..',
                    'package.json'
                ),
                'utf8'
            )
        );
        assert.equal(manifest.name, '@headlessui/react');
        assert.equal(manifest.version, '1.7.2');
    }
    const styles = readFileSync(
        require.resolve('@miniextensions/sdk/react/attachment-preview.css')
    );
    for (const format of ['esm', 'cjs']) {
        const entry = `attachment-slider-navigation-proof.${format === 'esm' ? 'mjs' : 'cjs'}`;
        writeFileSync(join(consumer, entry), hostSource(format, nativeConfirm));
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
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentTileOpenButton.js')
            ),
            'The installed Attachment Tile Open Button must be bundled'
        );
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentSliderBody.js')
            ),
            'The installed Attachment Slider Body must be bundled'
        );
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentSliderActions.js')
            ),
            'The installed Attachment Slider Actions must be bundled'
        );
        assert(
            Object.keys(bundle.metafile.inputs).some((name) =>
                name.endsWith('/react/AttachmentSlider.js')
            ),
            'The installed fullscreen Attachment Slider must be bundled'
        );
        const assets = new Map([
            [
                '/',
                [
                    'text/html',
                    '<!doctype html><html lang="fr"><meta charset="utf-8"><link rel="stylesheet" href="/attachment-preview.css"><link rel="stylesheet" href="/host.css"><main></main><script type="module" src="/host.js"></script></html>',
                ],
            ],
            ['/host.js', ['text/javascript', bundle.outputFiles[0].text]],
            [
                '/host.css',
                [
                    'text/css',
                    '.attachment-tile-proof{position:relative;width:96px;height:48px}.attachment-body-proof{width:min(640px,100vw - 32px);height:360px}.attachment-fullscreen-host{box-sizing:border-box;min-height:180vh;padding-top:180px}.attachment-fullscreen-scroll-probe{height:1200px}.attachment-native-confirm-proof{position:fixed;inset:0;z-index:110;display:grid;place-items:center;background:#0008}.attachment-native-confirm-panel{background:white;padding:24px}',
                ],
            ],
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
            const tileOpen = await checkTileOpen(page);
            assert.equal((await probe()).save, 0);
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
            const sliderBody = await checkSliderBody(page);
            const sliderActions = await checkSliderActions(page);
            const fullscreenSlider = await checkFullscreenSlider(
                page,
                nativeConfirm
            );
            assert.equal(saves.length, 2);
            const { selection: _bodySelection, ...bodyOwnerCalls } =
                await probe();
            assert.deepEqual(bodyOwnerCalls, otherCalls);
            assert.deepEqual(unexpectedRequests, []);
            assert.deepEqual(pageErrors, []);
            evidence.formats[format] = {
                selection: calls.selection,
                ownerCalls: calls,
                gestures,
                tileOpen,
                sliderBody,
                sliderActions,
                fullscreenSlider,
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

const fullscreenClass = '.mx-sdk-attachment-slider';

async function waitForSliderFocus(page, locator) {
    const element = await locator.elementHandle();
    assert.ok(element);
    try {
        await page.waitForFunction(
            (node) => node.ownerDocument.activeElement === node,
            element
        );
    } finally {
        await element.dispose();
    }
}

async function checkFullscreenSlider(page, nativeConfirm) {
    const viewer = page.locator(fullscreenClass);
    const panel = viewer.getByTestId('dialog-test-id');
    const body = viewer.locator(fullscreenClass + '__body');
    const backdrop = viewer.getByTestId('dialog-overlay-test-id');
    const rail = viewer.locator('.mx-sdk-attachment-thumbnail-rail');
    const opener = page.getByRole('button', { name: 'Ouvrir le plein écran' });
    const close = viewer.getByRole('button', {
        name: 'Fermer la visionneuse',
    });
    const remove = viewer.getByRole('button', {
        name: 'Effacer la pièce jointe',
    });
    const stats = () => page.evaluate(() => window.fullscreenProbe.stats());
    const scroll = () =>
        page.evaluate(() => ({
            y: window.scrollY,
            overflow: document.documentElement.style.overflow,
        }));

    await page.setViewportSize({ width: 1280, height: 720 });
    const baseline = await page.evaluate(() => {
        const root = document.documentElement;
        const oldOverflow = root.style.overflow;
        root.style.overflow = 'auto';
        window.scrollTo(0, 80);
        return {
            oldOverflow,
            y: window.scrollY,
            overflow: root.style.overflow,
        };
    });
    assert.equal(baseline.y, 80);
    const restored = { y: baseline.y, overflow: baseline.overflow };
    const locked = { ...restored, overflow: 'hidden' };
    async function openViewer(trigger) {
        await trigger.click();
        await viewer.waitFor();
        assert.equal(await viewer.getAttribute('role'), 'dialog');
        assert.equal(await viewer.getAttribute('aria-modal'), 'true');
        await waitForSliderFocus(page, rail);
        assert.deepEqual(await scroll(), locked);
    }
    async function closedViewer(trigger, expectedDismissals) {
        await viewer.waitFor({ state: 'detached' });
        await waitForSliderFocus(page, trigger);
        assert.deepEqual((await stats()).dismissals, expectedDismissals);
        assert.deepEqual(await scroll(), restored);
    }
    const bounds = (node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return [x, y, width, height];
    };
    async function layout(width, intercom = false) {
        await page.setViewportSize({ width, height: 720 });
        await page.evaluate(
            (openIntercom) => window.fullscreenProbe.intercom(openIntercom),
            intercom
        );
        const right = intercom && width >= 1024 ? 440 : 16;
        const bottom = width >= 640 ? 8 : 80;
        const expectedPanel = [16, 16, width - 16 - right, 720 - 16 - bottom];
        await page.waitForFunction(
            ({ selector, expectedWidth }) =>
                document.querySelector(selector)?.getBoundingClientRect()
                    .width === expectedWidth,
            {
                selector: fullscreenClass + '__panel',
                expectedWidth: expectedPanel[2],
            }
        );
        const rootBox = await viewer.evaluate(bounds);
        const panelBox = await panel.evaluate(bounds);
        const bodyBox = await body.evaluate(bounds);
        assert.deepEqual(rootBox, [0, 0, width, 720]);
        assert.deepEqual(panelBox, expectedPanel);
        assert.equal(bodyBox[0], panelBox[0]);
        assert.equal(bodyBox[2], panelBox[2]);
        assert.ok(bodyBox[1] > panelBox[1]);
        assert.equal(bodyBox[1] + bodyBox[3], panelBox[1] + panelBox[3]);
        assert.equal(
            await body.evaluate((node) => getComputedStyle(node).overflowY),
            'auto'
        );
        return { root: rootBox, panel: panelBox, body: bodyBox };
    }

    try {
        await openViewer(opener);
        const desktop = await layout(1280);
        const narrow = await layout(375);
        const narrowIntercom = await layout(375, true);
        assert.deepEqual(narrowIntercom, narrow);
        const desktopIntercom = await layout(1280, true);
        await layout(1280);

        await close.focus();
        await page.keyboard.press('Tab');
        await waitForSliderFocus(page, remove);
        await page.keyboard.press('Shift+Tab');
        await waitForSliderFocus(page, close);
        assert.equal((await stats()).dismissals.length, 0);

        // Supply overflow to the real viewer body so a trusted wheel can prove
        // ownership even when the small image fits the viewport.
        await body.evaluate((node) => {
            const content = node.ownerDocument.createElement('div');
            content.className = 'attachment-fullscreen-scroll-probe';
            node.append(content);
        });
        const bodyBox = await body.boundingBox();
        assert.ok(bodyBox);
        await page.mouse.move(bodyBox.x + 5, bodyBox.y + bodyBox.height / 2);
        await page.mouse.wheel(0, 240);
        await page.waitForFunction(
            (selector) => document.querySelector(selector)?.scrollTop > 0,
            fullscreenClass + '__body'
        );
        assert.deepEqual(await scroll(), locked);
        await body
            .locator('.attachment-fullscreen-scroll-probe')
            .evaluate((node) => node.remove());

        await close.click();
        await closedViewer(opener, ['standalone']);
        await page.mouse.move(200, 620);
        await page.mouse.wheel(0, 180);
        await page.waitForFunction((y) => window.scrollY > y, baseline.y);
        await page.evaluate((y) => window.scrollTo(0, y), baseline.y);

        await openViewer(opener);
        await backdrop.click({ position: { x: 4, y: 80 } });
        await closedViewer(opener, ['standalone', 'standalone']);

        await openViewer(opener);
        await page.keyboard.press('Escape');
        await closedViewer(opener, ['standalone', 'standalone', 'standalone']);

        const legacyConfirm = nativeConfirm
            ? await checkLegacySliderConfirm({
                  page,
                  viewer,
                  rail,
                  remove,
                  close,
                  stats,
                  openViewer,
                  closedViewer,
                  locked,
                  scroll,
              })
            : null;
        return {
            desktop,
            narrow,
            desktopIntercom,
            narrowIntercom,
            initialRailFocus: true,
            tabWrap: true,
            dismissals: ['close', 'backdrop', 'escape'],
            openerFocusRestored: true,
            viewerWheelOwned: true,
            documentScrollRestored: true,
            legacyConfirm,
        };
    } finally {
        await page.evaluate((overflow) => {
            document.documentElement.style.overflow = overflow;
        }, baseline.oldOverflow);
    }
}

async function checkLegacySliderConfirm({
    page,
    viewer,
    rail,
    remove,
    close,
    stats,
    openViewer,
    closedViewer,
    locked,
    scroll,
}) {
    const opener = page.getByRole('button', {
        name: 'Ouvrir avec confirmation native',
    });
    const dialog = page.getByRole('dialog', {
        name: 'Confirmer la suppression',
    });
    const cancel = dialog.getByRole('button', { name: 'Annuler' });
    const confirm = dialog.getByRole('button', {
        name: 'Confirmer',
        exact: true,
    });
    const dismissals = ['standalone', 'standalone', 'standalone'];

    await openViewer(opener);
    await remove.click();
    await waitForSliderFocus(page, cancel);
    assert.equal(await dialog.getAttribute('aria-modal'), 'true');
    await page.mouse.move(6, 120);
    assert.deepEqual(await scroll(), locked);
    const selections = (await stats()).selections;
    await page.keyboard.press('Tab');
    await waitForSliderFocus(page, confirm);
    await page.keyboard.press('Shift+Tab');
    await waitForSliderFocus(page, cancel);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await waitForSliderFocus(page, cancel);
    assert.equal((await stats()).selections, selections);
    assert.equal(
        await rail.locator('button[data-selected="true"]').textContent(),
        'Vue avant'
    );

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
    await waitForSliderFocus(page, remove);
    assert.equal(await viewer.isVisible(), true);
    assert.deepEqual((await stats()).dismissals, dismissals);
    assert.equal((await stats()).confirmed, 0);
    assert.equal((await stats()).confirmDismissals, 1);
    assert.deepEqual(await scroll(), locked);
    await page.keyboard.press('Escape');
    await closedViewer(opener, [...dismissals, 'native']);

    await openViewer(opener);
    await remove.click();
    await waitForSliderFocus(page, cancel);
    await confirm.click();
    await dialog.waitFor({ state: 'detached' });
    await waitForSliderFocus(page, remove);
    assert.deepEqual(await stats(), {
        dismissals: [...dismissals, 'native'],
        deleteRequests: 2,
        confirmed: 1,
        confirmDismissals: 1,
        selections,
    });
    await close.click();
    await closedViewer(opener, [...dismissals, 'native', 'native']);
    return {
        headlessUi: '1.7.2',
        confirmFocusTrapped: true,
        coveredArrowsIgnored: true,
        firstEscapeRestoredDelete: true,
        secondEscapeRestoredOpener: true,
        confirmedCallbacks: 1,
        documentScrollRestored: true,
    };
}

async function checkSliderActions(page) {
    const scope = page.getByRole('region', {
        name: 'Commandes de la pièce jointe',
    });
    const remove = scope.getByRole('button', { name: 'Effacer', exact: true });
    const download = (name) => scope.getByRole('button', { name, exact: true });
    const open = scope.getByRole('link', { name: 'Ouvrir', exact: true });
    const tooltip = page.getByRole('tooltip');
    const calls = () => page.evaluate(() => window.sliderProbe.headerCalls());
    await page.evaluate(() => window.sliderProbe.showHeader());
    await open.waitFor();
    assert.equal(await open.getAttribute('href'), '/rear.svg');
    assert.equal(await open.getAttribute('target'), '_blank');
    const widths = {};
    for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 720 });
        const removeBox = await remove.boundingBox();
        const downloadBox = await download('Télécharger').boundingBox();
        assert.ok(removeBox && downloadBox);
        widths[width] = {
            control: [removeBox.width, removeBox.height],
            gap: downloadBox.x - removeBox.x - removeBox.width,
        };
        assert.deepEqual(widths[width], { control: [20, 20], gap: 16 });
    }
    await open.hover();
    await tooltip.waitFor();
    assert.equal(await tooltip.innerText(), 'Ouvrir');
    assert.equal(
        await open.getAttribute('aria-describedby'),
        await tooltip.getAttribute('id')
    );
    const openBox = await open.boundingBox();
    const tipBox = await tooltip.boundingBox();
    assert.ok(openBox && tipBox);
    assert.equal(tipBox.y - openBox.y - openBox.height, 8);
    await page.keyboard.press('Escape');
    await tooltip.waitFor({ state: 'detached' });
    assert.equal((await calls()).escapes, 0);

    await remove.click();
    assert.equal((await calls()).deletes, 1);
    await download('Télécharger').click();
    await download('0%').waitFor();
    assert.equal(await download('0%').isDisabled(), true);
    await page.evaluate(() => window.sliderProbe.revokeHeader());
    await scope.locator('a').click({ button: 'right' });
    assert.equal(await scope.locator('a').getAttribute('href'), null);
    await page.evaluate(() => window.sliderProbe.settleHeader());
    await download('Télécharger').waitFor();
    assert.deepEqual(await calls(), {
        deletes: 1,
        reads: ['/rear.svg'],
        errors: 0,
        escapes: 0,
    });
    await page.evaluate(() => window.sliderProbe.closeHeader());
    await scope.waitFor({ state: 'detached' });
    await tooltip.waitFor({ state: 'detached' });
    return {
        widths,
        tooltipOffset: 8,
        staleOpenRetired: true,
        retiredDownloadSaved: false,
    };
}

async function checkSliderBody(page) {
    const body = page.getByRole('dialog', { name: 'Visionneuse' });
    const navigation = body.getByRole('group', {
        name: 'Aperçu des pièces jointes',
    });
    const rail = body.locator('.mx-sdk-attachment-thumbnail-rail');
    const front = navigation.getByText('Vue avant', { exact: true });
    const rear = navigation.getByText('Vue arrière', { exact: true });
    const open = () => page.evaluate(() => window.sliderProbe.openBody());
    const selections = () =>
        page.evaluate(() => window.sliderProbe.bodySelections());

    await open();
    await front.waitFor();
    const widths = {};
    for (const width of [1280, 375]) {
        await page.setViewportSize({ width, height: 720 });
        const panel = await body.boundingBox();
        const navigationBox = await navigation.boundingBox();
        const railBox = await rail.boundingBox();
        assert.ok(panel && navigationBox && railBox);
        widths[width] = {
            panel: [panel.width, panel.height],
            navigation: [navigationBox.width, navigationBox.height],
            rail: [railBox.width, railBox.height],
        };
        const expectedWidth = Math.min(640, width - 32);
        assert.deepEqual(widths[width], {
            panel: [expectedWidth, 360],
            navigation: [expectedWidth, 316],
            rail: [expectedWidth, 44],
        });
    }

    const owner = await body.getAttribute('data-body-owner');
    await rail.focus();
    await page.keyboard.down('ArrowRight');
    try {
        await rear.waitFor();
        assert.equal(await selections(), 1);
        await open();
        await front.waitFor();
        assert.notEqual(await body.getAttribute('data-body-owner'), owner);
        await page.keyboard.down('ArrowRight');
        assert.equal(await selections(), 1);
        assert.equal(await front.isVisible(), true);
    } finally {
        await page.keyboard.up('ArrowRight');
    }
    await page.keyboard.press('ArrowRight');
    await rear.waitFor();
    assert.equal(await selections(), 2);
    await rail.getByRole('button', { name: 'Vue arrière' }).focus();
    await page.evaluate(() => window.sliderProbe.shrinkBody());
    await navigation.waitFor({ state: 'detached' });
    await rail
        .getByRole('button', { name: 'Vue avant' })
        .waitFor({ state: 'visible' });
    assert.equal(
        await rail.evaluate(
            (node) => node.ownerDocument.activeElement === node
        ),
        true
    );
    await page.evaluate(() => window.sliderProbe.emptyBody());
    await body.waitFor({ state: 'detached' });
    return {
        widths,
        retiredHeldArrow: true,
        freshArrowSelected: true,
        restoredRailFocus: true,
        retiredEmptyGallery: true,
    };
}

async function checkTileOpen(page) {
    const tile = page.locator('.attachment-tile-proof');
    const button = (label) =>
        tile.getByRole('button', { name: label, exact: true });
    const publish = (resourceKey, label) =>
        page.evaluate(
            ([key, text]) => window.sliderProbe.publishTile(key, text),
            [resourceKey, label]
        );
    const opened = () => page.evaluate(() => window.sliderProbe.tileOpens);
    const signature = await button('Pièce jointe').evaluate((control) => {
        const style = getComputedStyle(control);
        const bounds = control.getBoundingClientRect();
        const tileBounds = control.parentElement.getBoundingClientRect();
        const label = control.firstElementChild;
        const labelStyle = getComputedStyle(label);
        return {
            type: control.type,
            position: style.position,
            inset: style.inset,
            zIndex: style.zIndex,
            cursor: style.cursor,
            background: style.backgroundColor,
            padding: style.padding,
            borderWidth: style.borderWidth,
            geometry: [
                bounds.x - tileBounds.x,
                bounds.y - tileBounds.y,
                bounds.width,
                bounds.height,
            ],
            hiddenLabel: [
                label.textContent,
                labelStyle.width,
                labelStyle.height,
                labelStyle.overflow,
            ],
        };
    });
    assert.deepEqual(signature, {
        type: 'button',
        position: 'absolute',
        inset: '0px',
        zIndex: '10',
        cursor: 'pointer',
        background: 'rgba(0, 0, 0, 0)',
        padding: '0px',
        borderWidth: '0px',
        geometry: [0, 0, 96, 48],
        hiddenLabel: ['Open attachment', '1px', '1px', 'hidden'],
    });

    async function gesture(input, replaceResource) {
        const resource = `${input}-${replaceResource ? 'replace' : 'relabel'}`;
        const before = `${resource} initial`;
        const after = `${resource} courant`;
        await publish(resource, before);
        const original = await button(before).elementHandle();
        assert.ok(original);
        const count = (await opened()).length;
        if (input === 'pointer') {
            const bounds = await original.boundingBox();
            assert.ok(bounds);
            await page.mouse.move(
                bounds.x + bounds.width / 2,
                bounds.y + bounds.height / 2
            );
            await page.mouse.down();
        } else {
            await original.focus();
            await page.keyboard.down('Space');
        }
        await publish(
            replaceResource ? `${resource}-successor` : resource,
            after
        );
        const current = button(after);
        const state = await current.evaluate(
            (control, previous) => ({
                sameControl: control === previous,
                focused: control.ownerDocument.activeElement === control,
            }),
            original
        );
        await original.dispose();
        assert.deepEqual(state, {
            sameControl: !replaceResource,
            focused: true,
        });
        if (input === 'pointer') await page.mouse.up();
        else {
            if (replaceResource) await page.keyboard.down('Space');
            await page.keyboard.up('Space');
        }
        const held = (await opened()).slice(count);
        assert.deepEqual(held, replaceResource ? [] : [after]);
        if (!replaceResource) return { ...state, held };

        if (input === 'pointer') await current.click();
        else await current.press('Space');
        const fresh = (await opened()).slice(count);
        assert.deepEqual(fresh, [after]);
        return { ...state, held, fresh };
    }

    return {
        signature,
        replacedPointer: await gesture('pointer', true),
        replacedSpace: await gesture('space', true),
        relabeledPointer: await gesture('pointer', false),
        relabeledSpace: await gesture('space', false),
    };
}
