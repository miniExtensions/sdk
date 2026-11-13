// The same installed public preview in an independent app, with local media.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assertBrowserInputs } from './package-checks.mjs';

const directory = resolve(process.argv[2] ?? 'dist/attachment-preview-browser');
mkdirSync(directory, { recursive: true });
const temporary = mkdtempSync(
    join(tmpdir(), 'sdk-attachment-preview-browser-')
);
const run = (args, cwd = temporary) =>
    execFileSync('npm', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
    });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const profiles = [];
let browser, server;
try {
    let archive;
    if (process.env.SDK_NATIVE_PACKAGE_DIR) {
        const root = resolve(process.env.SDK_NATIVE_PACKAGE_DIR);
        const archives = readdirSync(root).filter((name) =>
            name.endsWith('.tgz')
        );
        assert.equal(archives.length, 1);
        archive = join(root, archives[0]);
        const receipt = JSON.parse(
            readFileSync(join(root, 'artifact-receipt.json'))
        );
        assert.equal(sha256(readFileSync(archive)), receipt.package.sha256);
    } else {
        const packed = JSON.parse(
            run(
                [
                    'pack',
                    '--ignore-scripts',
                    '--json',
                    '--pack-destination',
                    temporary,
                ],
                process.cwd()
            )
        )[0];
        archive = join(temporary, packed.filename);
    }
    const assets = new Map();
    for (const name of ['A', 'B'])
        assets.set(
            `/${name}.docx`,
            readFileSync(`test/fixtures/attachment-preview/${name}.docx`)
        );
    assets.set(
        '/pixel.svg',
        Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="red"/></svg>'
        )
    );
    server = createServer((request, response) => {
        const path = new URL(request.url, 'http://localhost').pathname;
        if (path === '/') {
            response.setHeader('content-type', 'text/html');
            response.end(
                '<!doctype html><link rel="stylesheet" href="/main.css"><form id="app"></form><div id="sibling">Sibling</div><script type="module" src="/main.js"></script>'
            );
        } else if (assets.has(path)) {
            response.setHeader(
                'content-type',
                path.endsWith('.js')
                    ? 'text/javascript'
                    : path.endsWith('.css')
                      ? 'text/css'
                      : path.endsWith('.svg')
                        ? 'image/svg+xml'
                        : 'application/octet-stream'
            );
            response.end(assets.get(path));
        } else {
            response.statusCode = 404;
            response.end();
        }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
        ...(process.env.SDK_NATIVE_CHROMIUM
            ? { executablePath: process.env.SDK_NATIVE_CHROMIUM }
            : { channel: 'chrome' }),
        headless: true,
        chromiumSandbox: true,
    });
    for (const react of ['18.3.1', '19.2.0']) {
        const root = join(temporary, react);
        mkdirSync(root);
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({ private: true, type: 'module' })
        );
        run(
            [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                archive,
                `react@${react}`,
                `react-dom@${react}`,
            ],
            root
        );
        for (const format of ['esm', 'cjs']) {
            const imports =
                format === 'esm'
                    ? `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {AttachmentPreview} from '@miniextensions/sdk/react';`
                    : `const React=require('react');const {createRoot}=require('react-dom/client');const {flushSync}=require('react-dom');const {AttachmentPreview}=require('@miniextensions/sdk/react');`;
            writeFileSync(
                join(root, 'main.js'),
                imports +
                    `import '@miniextensions/sdk/react/attachment-preview.css';
const root=createRoot(document.querySelector('#app'));const state={submits:0,errors:[],held:null,target:null,hold:false};
document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();state.submits++});
window.addEventListener('unhandledrejection',e=>state.errors.push(String(e.reason)));
const read=FileReader.prototype.readAsArrayBuffer;
FileReader.prototype.readAsArrayBuffer=function(blob){if(state.hold){state.hold=false;state.held=()=>read.call(this,blob);}else return read.call(this,blob)};
const word=name=>({url:'/'+name+'.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
function render(attachment,labels){flushSync(()=>root.render(React.createElement(AttachmentPreview,{attachment,labels})))}
window.preview={state,render,word,retire(){state.target=document.querySelector('.mx-sdk-attachment-preview__word>div');},release(){state.held();state.held=null;},close(){flushSync(()=>root.render(null))}};
render({url:'/pixel.svg',type:'image/svg+xml'});`
            );
            const bundled = await build({
                absWorkingDir: root,
                entryPoints: ['main.js'],
                bundle: true,
                platform: 'browser',
                format: 'esm',
                target: 'es2022',
                outdir: join(root, 'bundle'),
                write: false,
                metafile: true,
                minify: true,
                define: { 'process.env.NODE_ENV': '"production"' },
            });
            await assertBrowserInputs(bundled.metafile, root);
            for (const file of bundled.outputFiles)
                assets.set('/' + file.path.split('/').at(-1), file.contents);
            const context = await browser.newContext();
            const external = [],
                errors = [];
            await context.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (url.origin === origin || url.protocol === 'blob:')
                    return route.continue();
                external.push(url.href);
                return route.abort();
            });
            const page = await context.newPage();
            page.on('pageerror', (e) => errors.push(e.message));
            try {
                await page.goto(origin);
                await page.waitForFunction(
                    () => document.querySelector('img')?.naturalWidth === 12
                );
                assert.equal(
                    await page
                        .locator('img')
                        .evaluate((node) => getComputedStyle(node).objectFit),
                    'contain'
                );
                await page.evaluate(() => {
                    window.preview.state.hold = true;
                    window.preview.render(window.preview.word('A'));
                });
                await page.waitForFunction(() => !!window.preview.state.held);
                await page.evaluate(() => {
                    window.preview.retire();
                    window.preview.render(window.preview.word('B'));
                });
                await page.waitForFunction(() =>
                    document
                        .querySelector('#app')
                        .textContent.includes('Controlled attachment B')
                );
                await page.waitForFunction(
                    () =>
                        document.querySelector('#app .docx img')
                            ?.naturalWidth === 1
                );
                const font = await page.evaluate(async () => {
                    await document.fonts.load('16px AttachmentSmoke');
                    return (
                        document.fonts.check('16px AttachmentSmoke') &&
                        [...document.fonts].some(
                            (f) =>
                                f.family === 'AttachmentSmoke' &&
                                f.status === 'loaded'
                        )
                    );
                });
                assert.equal(font, true);
                await page.evaluate(() => window.preview.release());
                await page.waitForFunction(() =>
                    window.preview.state.target.textContent.includes(
                        'Controlled attachment A'
                    )
                );
                assert.equal(
                    await page.evaluate(
                        () => window.preview.state.target.isConnected
                    ),
                    false
                );
                assert.ok(
                    (await page.locator('#app').textContent()).includes(
                        'Controlled attachment B'
                    )
                );
                const stable = await page
                    .locator('#app .docx-wrapper')
                    .evaluate((node) => {
                        node.dataset.stable = 'yes';
                        return true;
                    });
                assert.equal(stable, true);
                await page.evaluate(() =>
                    window.preview.render(
                        { ...window.preview.word('B'), filename: 'Renamed' },
                        { attachments: '添付ファイル' }
                    )
                );
                assert.equal(
                    await page
                        .locator('#app .docx-wrapper')
                        .getAttribute('data-stable'),
                    'yes'
                );
                await page.screenshot({
                    path: join(directory, `${react}-${format}-word.png`),
                    fullPage: true,
                });
                await page.evaluate(() =>
                    window.preview.render(
                        {
                            url: '/unsupported',
                            type: 'application/octet-stream',
                        },
                        { previewNotAvailable: 'Vista previa no disponible' }
                    )
                );
                assert.equal(
                    await page.locator('#app p').textContent(),
                    'Vista previa no disponible'
                );
                assert.equal(
                    await page
                        .locator('#app svg')
                        .evaluate((node) => getComputedStyle(node).width),
                    '96px'
                );
                await page.evaluate(() => window.preview.close());
                assert.equal(
                    await page.evaluate(() => window.preview.state.submits),
                    0
                );
                assert.deepEqual(
                    await page.evaluate(() => window.preview.state.errors),
                    []
                );
                assert.deepEqual(errors, []);
                assert.deepEqual(external, []);
                profiles.push({
                    react,
                    format,
                    productionBuild: true,
                    text: true,
                    decodedEmbeddedImage: true,
                    loadedEmbeddedFont: true,
                    retiredTargetIsolation: true,
                    stableRerender: true,
                    submits: 0,
                    externalRequests: 0,
                });
                await page.screenshot({
                    path: join(directory, `${react}-${format}.png`),
                });
            } finally {
                await context.close();
            }
        }
    }
    writeFileSync(
        join(directory, 'receipt.json'),
        JSON.stringify(
            {
                packageSha256: sha256(readFileSync(archive)),
                profiles,
                cleanup: 'completed',
            },
            null,
            2
        ) + '\n'
    );
    console.log(JSON.stringify({ profiles, cleanup: 'completed' }));
} finally {
    if (browser) await browser.close();
    if (server) await new Promise((done) => server.close(done));
    rmSync(temporary, { recursive: true, force: true });
}
