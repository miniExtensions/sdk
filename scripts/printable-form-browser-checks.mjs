import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const printableFormBrowserEntry = String.raw`
import React,{createElement as h,useLayoutEffect,StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {ReadonlyPrintDocumentView} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/printable-form.css';
const errors=[];let committed=0;
window.addEventListener('error',e=>errors.push(String(e.error||e.message)));
window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
const field=(key,title,facet,extra={})=>({key,title,fieldName:title,semanticTitle:title,showTitle:true,required:false,sameRow:false,enableSideBySideOnMobile:false,facet,...extra});
const image=new URL('/printable-form-image.svg',location.href).href;
const document={language:'en',fields:[
 field('name','Name',{kind:'text',value:'Synthetic Person',emptyLabel:'None'},{description:{html:'<p>Complete configured-order document.</p>',imageUrl:null,placement:'top',truncate:false}}),
 field('password','Password',{kind:'text',value:'••••••••',emptyLabel:'None'}),
 field('images','Synthetic images',{kind:'attachments',items:[{key:'first',label:'First synthetic image',kind:'image',url:image,imageSources:[image]},{key:'duplicate',label:'Second synthetic image',kind:'image',url:image,imageSources:[image]}],layout:'grid',columns:2,fit:'contain',thumbnailSize:'medium',showNames:true,emptyLabel:'None'}),
]};
const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,width:r.width,height:r.height};};
window.__nativeProbe={snapshot(){const fields=[...globalThis.document.querySelectorAll('.mx-sdk-print-field')],name=fields[0];return {react:React.version,committed,errors:[...errors],name:rect(name),help:rect(name?.querySelector('.mx-sdk-field-description')),value:rect(name?.querySelector('.mx-sdk-field-control')),next:rect(fields[1]),images:[...globalThis.document.querySelectorAll('.mx-sdk-print-attachment img')].map(n=>({complete:n.complete,naturalWidth:n.naturalWidth,...rect(n)})),labels:fields.map(n=>n.querySelector('.mx-sdk-field-title')?.textContent),imageLabels:[...globalThis.document.querySelectorAll('.mx-sdk-print-attachment figcaption')].map(n=>n.textContent)};}};
function Ready(){useLayoutEffect(()=>{committed++;},[]);return null;}
createRoot(globalThis.document.getElementById('root')).render(h(StrictMode,null,h(ReadonlyPrintDocumentView,{document}),h(Ready)));
`;

export async function preparePrintableFormBrowserFixtures({
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
    const entry = join(temporary, 'printable-form-layout.mjs');
    writeFileSync(entry, printableFormBrowserEntry);
    const bundle = await build({
        absWorkingDir: temporary,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        outfile: join(temporary, 'printable-form-layout.js'),
        write: false,
        metafile: true,
        legalComments: 'none',
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, temporary);
    const inputs = Object.keys(bundle.metafile.inputs);
    for (const suffix of [
        '/react/ReadonlyPrintDocumentView.js',
        '/react/printable-form.css',
        '/react/html-description.css',
    ])
        assert(
            inputs.some((p) => p.endsWith(suffix)),
            'Fixture must use installed ' + suffix
        );
    const proofInputs = [];
    for (const name of inputs) {
        const path = realpathSync(resolve(temporary, name)),
            bytes = regular(path);
        const item = {
            path: relative(temporary, path),
            sha256: hash(bytes),
            bytes: bytes.length,
        };
        if (path.startsWith(installed + '/')) {
            item.archiveMember =
                'package/' + relative(installed, path).replaceAll('\\', '/');
            assert.deepEqual(bytes, readArchiveMember(item.archiveMember));
        }
        proofInputs.push(item);
    }
    let script = false,
        css = false;
    for (const file of bundle.outputFiles) {
        if (file.path.endsWith('.js')) {
            allowed.set('/printable-form-layout.js', file.contents);
            script = true;
        } else if (file.path.endsWith('.css')) {
            allowed.set('/printable-form-layout.css', file.contents);
            css = true;
        } else assert.fail('Unexpected print fixture output');
    }
    assert(script && css, 'Bundle real print CSS with every relative import');
    allowed.set(
        '/printable-form-image.svg',
        Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><rect width="48" height="24" fill="#2563eb"/></svg>'
        )
    );
    allowed.set(
        '/printable-form-layout.html',
        Buffer.from(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Printable Form layout</title><link rel="stylesheet" href="/printable-form-layout.css"></head><body><div id="root"></div><script type="module" src="/printable-form-layout.js"></script></body></html>'
        )
    );
    report.printableForm = {
        sourceSha256: hash(printableFormBrowserEntry),
        bundleInputs: proofInputs,
        scriptSha256: hash(allowed.get('/printable-form-layout.js')),
        cssSha256: hash(allowed.get('/printable-form-layout.css')),
    };
}

export async function checkPrintableFormBrowser({ page, evidence }) {
    await page.waitForFunction(() => {
        const s = window.__nativeProbe?.snapshot();
        return (
            s?.committed > 0 &&
            s.images.length === 2 &&
            s.images.every((n) => n.complete && n.naturalWidth === 48)
        );
    });
    const groups = [];
    try {
        for (const media of ['screen', 'print']) {
            await page.emulateMedia({ media });
            const state = await page.evaluate(() =>
                window.__nativeProbe.snapshot()
            );
            assert.deepEqual(state.errors, []);
            assert.deepEqual(state.labels, [
                'Name',
                'Password',
                'Synthetic images',
            ]);
            assert.deepEqual(state.imageLabels, [
                'First synthetic image',
                'Second synthetic image',
            ]);
            for (const key of ['name', 'help', 'value', 'next']) {
                assert(
                    state[key] && state[key].width > 0 && state[key].height > 0,
                    media + ': positive ' + key + ' box'
                );
                for (const value of Object.values(state[key]))
                    assert(Number.isFinite(value));
            }
            assert(
                state.help.top >= state.name.top - 1,
                media + ': help begins inside Name'
            );
            assert(
                state.help.bottom <= state.value.top + 1,
                media + ': value follows help'
            );
            assert(
                state.value.bottom <= state.name.bottom + 1,
                media + ': value stays inside Name'
            );
            assert(
                state.next.top >=
                    Math.max(state.name.bottom, state.value.bottom) - 1,
                media + ': next field cannot overlap Name/value'
            );
            assert(
                state.images.every(
                    (n) =>
                        n.complete &&
                        n.naturalWidth === 48 &&
                        n.width > 0 &&
                        n.height > 0
                ),
                media + ': duplicate images render'
            );
            groups.push({ media, geometry: state });
        }
    } finally {
        await page.emulateMedia({ media: 'screen' });
    }
    evidence.groups = groups;
    evidence.limits = [
        'Packed renderer/CSS geometry and local synthetic images; no native print-dialog or hardcopy claim.',
    ];
}
