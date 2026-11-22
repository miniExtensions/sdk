import { portalGalleryPagingAppearanceEntry } from './portal-gallery-paging-appearance-checks.mjs';
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGalleryUnlinkPresentation } from './portal-gallery-unlink-browser-checks.mjs';

export const portalGalleryBrowserEntry = String.raw`
import React,{createElement as h,StrictMode,useLayoutEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PortalGallery} from '@miniextensions/sdk/react';
import {mountPagingAppearance} from './portal-gallery-paging-appearance.mjs';
import '@miniextensions/sdk/react/portal-gallery.css';
let set,committed=0,opens=0,unlinks=0,pages=0,submits=0;const errors=[];
window.addEventListener('error',e=>errors.push(String(e.error||e.message)));
window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const image=id=>({id,url:new URL('/gallery-'+id+'.svg',location.href).href,filename:'Image '+id});
const baseImages=Array.from({length:7},(_,i)=>image(String(i+1)));
const triggers=new Map();const registrations=Array.from({length:12},(_,id)=>element=>{const lease={element};triggers.set(id,lease);return()=>{if(triggers.get(id)===lease)triggers.delete(id);};});
function App(){
 const [state,change]=useState({columns:undefined,width:'full',height:112,fit:'cover',phase:'initial',titles:true,fields:1,status:'rows',empty:false,reload:false,pending:null,detail:'broken',filename:'Broken document.pdf',unlinkParity:false});set=patch=>change(old=>({...old,...patch}));
 useLayoutEffect(()=>{committed++;});
 const images=state.phase==='shrink'?[baseImages[1]]:state.phase==='reorder'?[baseImages[1],baseImages[0]]:state.phase==='all-broken'?baseImages.map((item,index)=>index<6?{...item,url:new URL('/gallery-broken.svg#'+index,location.href).href}:item):baseImages;
 const rows=state.empty?[]:Array.from({length:12},(_,i)=>({key:'row-'+i,recordId:'row-'+i,accessibleLabel:'Record '+i,testId:'synthetic-gallery-row',projection:{status:'present',layout:'gallery',primary:i===1?'Unnamed':'Project '+i,primaryIsEmpty:i===1,fields:[{key:'detail',title:state.titles?'Detail':null,leaf:{kind:'literal',text:i===2?'Long detail '.repeat(100):'Short detail'}},{key:'files',title:state.titles?'Files':null,leaf:{kind:'attachmentImages',images:[],entries:[{id:'missing',thumbnailUrl:null,filename:'Missing document.pdf'},{id:'broken',thumbnailUrl:state.detail==='missing'?null:new URL(state.detail==='valid'?'/gallery-3.svg':'/gallery-broken.svg',location.href).href,filename:state.filename}],empty:'none',emptyLabel:'No files'}}],language:'en',images:i===0?images:[],shouldRenderThumbnail:true,imageHeight:state.height,imageFit:state.fit,thumbnailLocation:'left',fieldsPerCardRow:state.fields,labels:{previousImage:'Previous image',nextImage:'Next image',viewImage:'View image {index}',noImage:'No image'}},open:{label:'Open '+i,registerTrigger:registrations[i],activate:()=>{opens++;document.getElementById('before').focus();}},requestUnlink:i===0?{label:'Unlink first',description:'Unlink membership',activate:()=>{unlinks++;}}:null,needsReviewLabel:null}));
 const displayedRows = state.unlinkParity ? rows.slice(0, 2).map(row => ({
    ...row,
    projection: { ...row.projection, language: 'es', images: [], shouldRenderThumbnail: false, fields: [] },
    requestUnlink: row.requestUnlink && { ...row.requestUnlink, label: 'Eliminar registro vinculado', description: 'Desvincular registro' },
 })) : rows;
 return h('form',{onSubmit:e=>{e.preventDefault();submits++;}},h('button',{type:'button',id:'before'},'Before Gallery'),h(PortalGallery,{label:'Synthetic Gallery',content:state.status==='rows'?{status:'rows',rows:displayedRows,emptyLabel:state.empty?'No records':null}:{status:state.status,label:state.status==='loading'?'Loading records':'Unavailable records'},columns:state.columns,width:state.width,unlinkingRecordId:state.pending,reloading:state.reload?{label:'Refreshing'}:null,paging:{canRequestMore:true,showSpinner:false,requestLabel:'Load more',loadingLabel:'Loading more',requestMore:()=>{pages++;}}}));
}
window.__nativeProbe={change:patch=>set(patch),returnFocus:()=>triggers.get(0)?.element.focus(),snapshot:()=>({react:React.version,registered:triggers.size,committed,opens,unlinks,pages,submits,errors})};
const root = createRoot(document.querySelector('#root'));
const pagingLanguage = new URLSearchParams(location.search).get('paging');
if (pagingLanguage) mountPagingAppearance(root, pagingLanguage);
else root.render(h(StrictMode,null,h(App)));
`;

export async function preparePortalGalleryBrowserFixtures({
    temporary,
    readArchiveMember,
    installed,
    allowed,
    report,
    build,
    assertBrowserInputs,
    regular,
    hash,
}) {
    const entry = join(temporary, 'portal-gallery-layout.mjs');
    writeFileSync(entry, portalGalleryBrowserEntry);
    writeFileSync(
        join(temporary, 'portal-gallery-paging-appearance.mjs'),
        portalGalleryPagingAppearanceEntry
    );
    const bundled = await build({
        absWorkingDir: temporary,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outfile: join(temporary, 'portal-gallery-layout.js'),
        write: false,
        metafile: true,
        legalComments: 'none',
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundled.metafile, temporary);
    const inputs = Object.keys(bundled.metafile.inputs);
    for (const name of [
        '/react/PortalGallery.js',
        '/react/LinkedFinderCard.js',
        '/react/RecoverableImage.js',
        '/react/portal-gallery.css',
        '/react/complete-linked-finder.css',
        '/react/html-description.css',
    ])
        assert(
            inputs.some((p) => p.endsWith(name)),
            'Actual installed Gallery input ' + name
        );
    const proofInputs = inputs.map((name) => {
        const path = realpathSync(resolve(temporary, name)),
            bytes = regular(path),
            item = {
                path: relative(temporary, path),
                sha256: hash(bytes),
                bytes: bytes.length,
            };
        if (path.startsWith(installed + '/')) {
            item.archiveMember =
                'package/' + relative(installed, path).replaceAll('\\', '/');
            assert.deepEqual(bytes, readArchiveMember(item.archiveMember));
        }
        return item;
    });
    for (const file of bundled.outputFiles) {
        if (file.path.endsWith('.js'))
            allowed.set('/portal-gallery-layout.js', file.contents);
        else if (file.path.endsWith('.css'))
            allowed.set('/portal-gallery-layout.css', file.contents);
        else assert.fail('Unexpected Gallery fixture output');
    }
    assert(
        allowed.has('/portal-gallery-layout.js') &&
            allowed.has('/portal-gallery-layout.css')
    );
    for (let i = 1; i <= 7; i++)
        allowed.set(
            '/gallery-' + i + '.svg',
            Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="48" height="24" fill="#2563eb"/></svg>'
            )
        );
    allowed.set(
        '/gallery-broken.svg',
        Buffer.from('synthetic invalid image bytes')
    );
    allowed.set(
        '/portal-gallery-layout.html',
        Buffer.from(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>One synthetic Portal Gallery</title><link rel="stylesheet" href="/portal-gallery-layout.css"><style>body{margin:16px;font:16px system-ui}</style></head><body><div id="root"></div><script type="module" src="/portal-gallery-layout.js"></script></body></html>'
        )
    );
    report.portalGallery = {
        sourceSha256: hash(portalGalleryBrowserEntry),
        checkerSha256: hash(regular(fileURLToPath(import.meta.url))),
        pagingAppearanceSha256: hash(
            regular(
                fileURLToPath(
                    new URL(
                        './portal-gallery-paging-appearance-checks.mjs',
                        import.meta.url
                    )
                )
            )
        ),
        react: JSON.parse(
            regular(join(temporary, 'node_modules/react/package.json'))
        ).version,
        bundleInputs: proofInputs,
        scriptSha256: hash(allowed.get('/portal-gallery-layout.js')),
        cssSha256: hash(allowed.get('/portal-gallery-layout.css')),
    };
}

export async function checkPortalGalleryBrowser({ page, evidence, output }) {
    const patch = async (value) => {
        const previous = await page.evaluate(
            () => window.__nativeProbe.snapshot().committed
        );
        await page.evaluate((p) => window.__nativeProbe.change(p), value);
        await page.waitForFunction(
            (old) => window.__nativeProbe.snapshot().committed > old,
            previous
        );
    };
    const snapshot = () => page.evaluate(() => window.__nativeProbe.snapshot());
    const geometry = () =>
        page.evaluate(() => {
            const grid = document.querySelector('.mx-sdk-portal-gallery-grid'),
                frame = document.querySelector('.mx-sdk-portal-gallery'),
                rows = [
                    ...document.querySelectorAll('.mx-sdk-portal-gallery-row'),
                ];
            return {
                actualColumns:
                    getComputedStyle(grid).gridTemplateColumns.split(' ')
                        .length,
                gap: getComputedStyle(grid).gap,
                width: frame.getBoundingClientRect().width,
                overflow:
                    document.documentElement.scrollWidth >
                    document.documentElement.clientWidth,
                gridClientWidth: grid.clientWidth,
                gridScrollWidth: grid.scrollWidth,
                left: frame.getBoundingClientRect().left,
                right: frame.getBoundingClientRect().right,
                rows: rows.map((n) => ({
                    width: n.getBoundingClientRect().width,
                    left: n.getBoundingClientRect().left,
                    right: n.getBoundingClientRect().right,
                    height: n.getBoundingClientRect().height,
                })),
            };
        });
    await page.waitForFunction(
        () => window.__nativeProbe?.snapshot().committed > 0
    );
    assert.deepEqual(
        { ...(await snapshot()), committed: 0 },
        {
            react: evidence.react,
            registered: 12,
            committed: 0,
            opens: 0,
            unlinks: 0,
            pages: 0,
            submits: 0,
            errors: [],
        }
    );
    const groups = [];
    await page.setViewportSize({ width: 1600, height: 1000 });
    assert.equal(
        (await geometry()).actualColumns,
        5,
        'Current default cap is five'
    );
    for (const width of [1600, 1024, 768, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        for (let columns = 1; columns <= 6; columns++) {
            await patch({ columns });
            const current = await geometry();
            assert.equal(
                current.actualColumns,
                Math.min(columns, Math.floor((width - 32 + 16) / 216))
            );
            assert.equal(current.overflow, false);
            assert(
                current.rows.every(
                    (r) =>
                        r.left >= current.left - 1 &&
                        r.right <= current.right + 1
                )
            );
            assert.equal(current.gap, '16px');
            assert(current.rows.every((r) => r.width >= 199 && r.height > 0));
            groups.push({
                viewport: width,
                configuredColumns: columns,
                ...current,
            });
        }
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await patch({ width: 'fixed', columns: 1 });
    assert(Math.abs((await geometry()).width - 896) < 1);
    const heights = (await geometry()).rows.map((r) => r.height);
    assert(heights[2] > heights[1], 'Content-dependent card height');
    await patch({ width: 'full', columns: 5 });
    assert((await geometry()).width > 896);
    const first = page.locator('.mx-sdk-portal-gallery-row').first();
    await page.waitForFunction(() => {
        const n = document.querySelector(
            '.mx-sdk-finder-carousel img[data-visible="true"]'
        );
        return n?.complete && n.naturalWidth === 48;
    });
    assert.equal(
        await first.locator('.mx-sdk-finder-carousel-dots button').count(),
        6,
        'First six Gallery images'
    );
    await first
        .getByRole('button', { name: 'View image 2', exact: true })
        .click();
    assert.equal((await snapshot()).opens, 0, 'Carousel dots do not Open');
    for (const phase of ['shrink', 'reorder']) {
        await patch({ phase });
        assert.equal(
            await first
                .locator('.mx-sdk-finder-carousel img[data-visible="true"]')
                .getAttribute('alt'),
            'Image 2'
        );
    }
    await first
        .locator('.mx-sdk-finder-carousel img[data-visible="true"]')
        .evaluate((n) => (window.__galleryRetainedImage = n));
    await patch({ reload: true });
    assert.equal(
        await page.evaluate(
            () =>
                window.__galleryRetainedImage ===
                document.querySelector(
                    '.mx-sdk-finder-carousel img[data-visible="true"]'
                )
        ),
        true
    );
    assert.equal((await snapshot()).registered, 12);
    await patch({ reload: false, phase: 'all-broken' });
    await first
        .locator('.mx-sdk-finder-image-placeholder')
        .waitFor({ state: 'visible' });
    assert.equal(
        await first.locator('.mx-sdk-finder-carousel img').count(),
        0,
        'Seventh image is never promoted after first-six failures'
    );
    await patch({ phase: 'reorder' });
    for (const height of [112, 160, 240]) {
        await patch({ height, fit: 'contain' });
        const box = await first
            .locator('.mx-sdk-finder-carousel')
            .boundingBox();
        assert(box && Math.abs(box.height - height) < 1);
        assert.equal(
            await first
                .locator('.mx-sdk-finder-carousel img')
                .first()
                .evaluate((n) => getComputedStyle(n).objectFit),
            'contain'
        );
    }
    await page.waitForFunction(() =>
        [...document.querySelectorAll('.mx-sdk-portal-gallery-row')].every(
            (n) =>
                n.textContent.includes('Missing document.pdf') &&
                n.textContent.includes('Broken document.pdf')
        )
    );
    assert(
        (await page
            .getByRole('img', { name: 'No image', exact: true })
            .count()) > 0
    );
    await first
        .getByText('Missing document.pdf', { exact: true })
        .waitFor({ state: 'visible' });
    await first
        .getByText('Broken document.pdf', { exact: true })
        .waitFor({ state: 'visible' });
    await patch({ detail: 'valid', filename: 'Recovered document.svg' });
    await page.waitForFunction(() => {
        const image = document.querySelector(
            '.mx-sdk-finder-attachment-thumbnail img[alt="Recovered document.svg"]'
        );
        return image?.complete && image.naturalWidth === 48;
    });
    await patch({ detail: 'broken', filename: 'Replacement document.pdf' });
    await first
        .getByText('Replacement document.pdf', { exact: true })
        .waitFor({ state: 'visible' });
    await patch({ detail: 'missing' });
    await first
        .getByText('Replacement document.pdf', { exact: true })
        .waitFor({ state: 'visible' });
    await patch({ detail: 'valid' });
    await first
        .locator(
            '.mx-sdk-finder-attachment-thumbnail img[alt="Replacement document.pdf"]'
        )
        .waitFor({ state: 'visible' });

    assert.equal(
        await first
            .locator('.mx-sdk-finder-card-primary')
            .evaluate((n) => getComputedStyle(n).fontSize),
        '16px'
    );
    const cardFrame = await first
        .locator('.mx-sdk-portal-gallery-card-content')
        .evaluate((card) => {
            const readFrame = () => {
                const style = getComputedStyle(card);
                return {
                    borderColor: style.borderTopColor,
                    borderWidth: style.borderTopWidth,
                    radius: style.borderTopLeftRadius,
                    shadow: style.boxShadow,
                };
            };
            const standalone = readFrame();
            const gallery = card.closest('.mx-sdk-portal-gallery');
            gallery.style.setProperty(
                '--mx-sdk-portal-gallery-card-border',
                'rgb(80, 100, 120)'
            );
            const hosted = readFrame();
            gallery.style.removeProperty('--mx-sdk-portal-gallery-card-border');
            return { standalone, hosted };
        });
    assert.deepEqual(cardFrame.standalone, {
        borderColor: 'rgb(226, 232, 240)',
        borderWidth: '3px',
        radius: '6px',
        shadow: 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px',
    });
    assert.deepEqual(cardFrame.hosted, {
        ...cardFrame.standalone,
        borderColor: 'rgb(80, 100, 120)',
    });
    await patch({ titles: false, fields: 2 });
    assert.equal(await page.getByRole('term').count(), 0);
    assert.equal(
        await first
            .locator('.mx-sdk-finder-card-fields')
            .evaluate(
                (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length
            ),
        2
    );
    await patch({ titles: true });
    assert.equal(await page.getByRole('term').count(), 24);
    assert.equal(await page.getByRole('definition').count(), 24);
    await page
        .getByRole('button', { name: 'Before Gallery', exact: true })
        .focus();
    const keyboardOrder = [];
    for (let index = 0; index < 10; index++) {
        await page.keyboard.press('Tab');
        const label = await page.evaluate(() =>
            document.activeElement?.getAttribute('aria-label')
        );
        keyboardOrder.push(label);
        if (label === 'Open 0') break;
    }
    assert.equal(
        keyboardOrder.at(-1),
        'Open 0',
        'Open is reachable through sequential browser Tab navigation'
    );
    await page.keyboard.press('Enter');
    assert.equal((await snapshot()).opens, 1);
    assert.equal(
        await page.evaluate(() => document.activeElement?.id),
        'before'
    );
    await page.evaluate(() => window.__nativeProbe.returnFocus());
    assert.equal(
        await page.evaluate(() =>
            document.activeElement?.getAttribute('aria-label')
        ),
        'Open 0',
        'Host registration receives the actual source trigger'
    );
    await page.keyboard.press('Tab');
    assert.equal(
        await page.evaluate(() =>
            document.activeElement?.getAttribute('aria-label')
        ),
        'Unlink first'
    );

    await page.keyboard.press('Space');
    assert.equal((await snapshot()).unlinks, 1);
    await patch({ pending: 'row-0' });
    assert.equal(
        await first
            .getByRole('button', { name: 'Unlink first', exact: true })
            .isDisabled(),
        true
    );
    await patch({ pending: null, empty: true });
    assert.equal(
        (await snapshot()).registered,
        0,
        'Removing rows retires trigger registrations'
    );
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    assert.equal((await snapshot()).pages, 1);
    assert.equal(
        await page.getByText('No records', { exact: true }).count(),
        1
    );
    for (const status of ['loading', 'unavailable']) {
        await patch({ status });
        assert.equal(
            await page
                .getByText(
                    status === 'loading'
                        ? 'Loading records'
                        : 'Unavailable records',
                    { exact: true }
                )
                .count(),
            1
        );
    }
    const end = await snapshot();
    assert.deepEqual(end.errors, []);
    assert.equal(end.submits, 0);
    assert.equal(end.opens, 1);
    assert.equal(end.unlinks, 1);
    assert.equal(end.pages, 1);
    const unlinkPresentation = await checkGalleryUnlinkPresentation({
        page,
        patch,
        snapshot,
        output,
        react: end.react,
    });
    Object.assign(evidence, {
        groups,
        keyboardOrder,
        actualReact: end.react,
        commands: {
            opens: end.opens,
            unlinks: end.unlinks,
            pages: end.pages,
            submits: end.submits,
        },
        errors: end.errors,
        unlinkPresentation,
        limits: [
            'Portable installed SDK only; native ownership, child modal and transport acceptance are separately required.',
        ],
    });
}
