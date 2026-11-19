import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const hostSource = (format) => `
${
    format === 'esm'
        ? `import {createElement as h, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AttachmentPreview, AttachmentSliderNavigation} from '@miniextensions/sdk/react';`
        : `const {createElement:h, useState}=require('react');
const {createRoot}=require('react-dom/client');
const {AttachmentPreview, AttachmentSliderNavigation}=require('@miniextensions/sdk/react');`
}
const first={filename:'Vue avant',url:'/front.svg',type:'image/svg+xml'};
const second={filename:'Vue arrière',url:'/rear.svg',type:'image/svg+xml'};
const calls={selection:[],save:0,upload:0,delete:0,fetch:0};
window.fetch=()=>{calls.fetch++;return Promise.reject(Error('Unexpected I/O'));};
function Host(){
    const [rows,setRows]=useState([first,second]);
    const [selectedIndex,setSelectedIndex]=useState(0);
    const [acceptsIntent,setAcceptsIntent]=useState(false);
    window.sliderProbe={calls,setSelectedIndex,setAcceptsIntent,
        duplicates(){setRows([first,{...second,filename:first.filename}]);},
        shrink(){setRows([first]);},
        retire(){setRows([]);}};
    const selected=rows[selectedIndex];
    return h('form',{onSubmit(event){event.preventDefault();calls.save++;}},
        h(AttachmentSliderNavigation,{
            rows,selectedIndex,labels:{navigation:'Pièces jointes',previous:'Précédent',next:'Suivant'},
            onSelect(index){calls.selection.push(index);if(acceptsIntent)setSelectedIndex(index);},
        },selected&&h(AttachmentPreview,{attachment:selected}),h('input',{'aria-label':'Détail'})),
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
        const assets = new Map([
            [
                '/',
                [
                    'text/html',
                    '<!doctype html><html lang="fr"><meta charset="utf-8"><main></main><script type="module" src="/host.js"></script></html>',
                ],
            ],
            ['/host.js', ['text/javascript', bundle.outputFiles[0].text]],
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
            assert.deepEqual(unexpectedRequests, []);
            assert.deepEqual(pageErrors, []);
            evidence.formats[format] = {
                selection: calls.selection,
                ownerCalls: calls,
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
}
