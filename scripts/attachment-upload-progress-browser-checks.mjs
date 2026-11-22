import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

const source = (format) => `
${
    format === 'esm'
        ? `import {createElement as h,StrictMode,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AttachmentDeviceInput,AttachmentUploadProgress} from '@miniextensions/sdk/react';`
        : `const {createElement:h,StrictMode,useState}=require('react');
const {createRoot}=require('react-dom/client');
const {AttachmentDeviceInput,AttachmentUploadProgress}=require('@miniextensions/sdk/react');`
}
const calls = {cancel: 0, submit: 0, fetch: 0};
const selections = [];
window.fetch = () => { calls.fetch++; return Promise.reject(Error('Unexpected I/O')); };
function Host() {
    const [percentage,setPercentage]=useState(0);
    const [mounted,setMounted]=useState(true);
    const [disabled,setDisabled]=useState(false);
    window.uploadProgressProbe={setPercentage,setMounted,calls,setDisabled,selections};
    return h('form',{id:'native-form',onSubmit(event){event.preventDefault();calls.submit++;}},
        h('button',{type:'submit'},'Save fixture'),
        h(AttachmentDeviceInput,{
            id:'device-picker', form:'native-form', disabled, accept:'text/plain',
            describedBy:'picker-help',
            labels:{chooseFiles:'Choisir les fichiers',dragAndDrop:'ou glisser-déposer'},
            onFiles(files){selections.push(files.map(file=>[file.name,file.size]));}
        }),
        h('span',{id:'picker-help'},'Choisissez des documents texte'),
        mounted && h(AttachmentUploadProgress,{
            percentage, labels:{uploading:'Téléversement',cancel:'Annuler'},
            onCancel(){calls.cancel++;}
        }));
}
createRoot(document.querySelector('main')).render(h(StrictMode,null,h(Host)));
`;

export async function checkAttachmentUploadProgressBrowser({
    browser,
    consumer,
    evidence,
}) {
    evidence.formats = {};
    for (const format of ['esm', 'cjs']) {
        const filename = `attachment-upload-progress-proof.${format === 'esm' ? 'mjs' : 'cjs'}`;
        writeFileSync(join(consumer, filename), source(format));
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: [filename],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        const require = createRequire(join(consumer, 'package.json'));
        const css = readFileSync(
            require.resolve(
                '@miniextensions/sdk/react/attachment-upload-progress.css'
            )
        );
        const deviceCss = readFileSync(
            require.resolve(
                '@miniextensions/sdk/react/attachment-device-input.css'
            )
        );
        const requests = [];
        const pageErrors = [];
        let context;
        const server = createServer((req, res) => {
            requests.push(req.url);
            res.setHeader(
                'content-security-policy',
                "default-src 'self'; connect-src 'none'; form-action 'none'"
            );
            if (req.url === '/host.js') {
                res.setHeader('content-type', 'text/javascript');
                res.end(bundle.outputFiles[0].text);
            } else if (req.url === '/progress.css') {
                res.setHeader('content-type', 'text/css');
                res.end(css);
            } else if (req.url === '/device.css') {
                res.setHeader('content-type', 'text/css');
                res.end(deviceCss);
            } else if (req.url === '/') {
                res.setHeader('content-type', 'text/html');
                res.end(
                    '<!doctype html><html lang="fr"><meta charset="utf-8"><link rel="stylesheet" href="/progress.css"><link rel="stylesheet" href="/device.css"><main></main><script type="module" src="/host.js"></script></html>'
                );
            } else {
                res.statusCode = 404;
                res.end();
            }
        });
        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            const origin = `http://127.0.0.1:${server.address().port}`;
            context = await browser.newContext({ serviceWorkers: 'block' });
            const external = [];
            await context.route('**/*', (route) => {
                const url = route.request().url();
                if (new URL(url).origin === origin) return route.continue();
                external.push(url);
                return route.abort();
            });
            const page = await context.newPage();
            page.on('pageerror', (error) => pageErrors.push(error.message));
            await page.goto(origin);
            const picker = page.getByLabel('Choisir les fichiers', {
                exact: true,
            });
            await picker.waitFor({ timeout: 5000 });
            assert.equal(
                await picker.getAttribute('aria-describedby'),
                'picker-help'
            );
            assert.equal(await picker.getAttribute('accept'), 'text/plain');
            assert.equal(
                await picker.evaluate((input) => input.form?.id),
                'native-form'
            );
            assert.equal(
                await picker.evaluate(
                    (input) =>
                        getComputedStyle(input.parentElement).borderTopStyle
                ),
                'dashed'
            );
            const dispatchDrag = (...types) =>
                picker.evaluate((input, types) => {
                    const transfer = new DataTransfer();
                    transfer.items.add(new File(['cd'], 'drop.txt'));
                    return types.map((type) =>
                        input.parentElement.dispatchEvent(
                            new DragEvent(type, {
                                bubbles: true,
                                cancelable: true,
                                dataTransfer: transfer,
                            })
                        )
                    );
                }, types);
            const readPickerPaint = () =>
                picker.evaluate(async (input) => {
                    const target = input.parentElement;
                    const glyph = target.querySelector('svg');
                    await new Promise((resolve) =>
                        requestAnimationFrame(() =>
                            requestAnimationFrame(resolve)
                        )
                    );
                    await Promise.all(
                        target
                            .getAnimations()
                            .map((animation) => animation.finished)
                    );
                    const { fill, stroke } = getComputedStyle(glyph);
                    return {
                        border: getComputedStyle(target).borderTopColor,
                        fill,
                        stroke,
                        hover: target.matches(':hover'),
                        focus: input.matches(':focus-visible'),
                        drag: target.hasAttribute('data-drag-active'),
                    };
                });
            await page.mouse.move(0, 0);
            const rest = await readPickerPaint();
            assert.deepEqual(rest, {
                border: 'rgb(209, 213, 219)',
                fill: 'rgb(156, 163, 175)',
                stroke: 'none',
                hover: false,
                focus: false,
                drag: false,
            });
            const accent = 'rgb(37, 99, 235)';
            assert.deepEqual(await dispatchDrag('dragenter', 'dragover'), [
                false,
                false,
            ]);
            assert.deepEqual(await readPickerPaint(), {
                ...rest,
                fill: accent,
                drag: true,
            });
            await picker.hover();
            assert.deepEqual(await readPickerPaint(), {
                ...rest,
                border: accent,
                fill: accent,
                hover: true,
                drag: true,
            });
            await page.mouse.move(0, 0);
            assert.deepEqual(await dispatchDrag('dragleave'), [false]);
            assert.deepEqual(await readPickerPaint(), rest);
            assert.deepEqual(
                await page.evaluate(
                    () => window.uploadProgressProbe.selections
                ),
                []
            );
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
            assert.deepEqual(await readPickerPaint(), {
                ...rest,
                border: accent,
                fill: accent,
                focus: true,
            });
            const payload = [
                {
                    name: 'one.txt',
                    mimeType: 'text/plain',
                    buffer: Buffer.from('a'),
                },
                {
                    name: 'two.txt',
                    mimeType: 'text/plain',
                    buffer: Buffer.from('bc'),
                },
            ];
            const [chooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5000 }),
                picker.click(),
            ]);
            await chooser.setFiles(payload);
            assert.equal(await picker.inputValue(), '');
            await picker.focus();
            const [keyboardChooser] = await Promise.all([
                page.waitForEvent('filechooser', { timeout: 5000 }),
                picker.press('Space'),
            ]);
            await keyboardChooser.setFiles(payload);
            assert.equal(await picker.inputValue(), '');
            assert.deepEqual(await dispatchDrag('drop'), [false]);
            await page.evaluate(() =>
                window.uploadProgressProbe.setDisabled(true)
            );
            await page.waitForFunction(
                () => document.querySelector('#device-picker')?.disabled
            );
            assert.deepEqual(await dispatchDrag('drop'), [false]);
            const selected = await page.evaluate(
                () => window.uploadProgressProbe.selections
            );
            assert.deepEqual(selected, [
                [
                    ['one.txt', 1],
                    ['two.txt', 2],
                ],
                [
                    ['one.txt', 1],
                    ['two.txt', 2],
                ],
                [['drop.txt', 2]],
            ]);
            const bar = page.getByRole('progressbar', {
                name: 'Téléversement',
            });
            const cancel = page.getByRole('button', {
                name: 'Annuler',
                exact: true,
            });
            const readCalls = () =>
                page.evaluate(() => window.uploadProgressProbe.calls);
            const assertPercentage = async (percentage) => {
                await page.waitForFunction(
                    (value) =>
                        document.querySelector('progress')?.value === value,
                    percentage,
                    { timeout: 5000 }
                );
                await bar.waitFor({ timeout: 5000 });
                await page
                    .getByText(`${percentage}%`, { exact: true })
                    .waitFor({ timeout: 5000 });
                assert.equal(await bar.getAttribute('max'), '100');
            };
            await assertPercentage(0);
            for (const percentage of [50, 100]) {
                await page.evaluate(
                    (value) => window.uploadProgressProbe.setPercentage(value),
                    percentage
                );
                await assertPercentage(percentage);
                assert.deepEqual(await readCalls(), {
                    cancel: 0,
                    submit: 0,
                    fetch: 0,
                });
            }
            assert.equal(await cancel.getAttribute('type'), 'button');
            await cancel.click();
            assert.deepEqual(await readCalls(), {
                cancel: 1,
                submit: 0,
                fetch: 0,
            });
            await page.evaluate(() =>
                window.uploadProgressProbe.setMounted(false)
            );
            await bar.waitFor({ state: 'detached' });
            assert.deepEqual(await readCalls(), {
                cancel: 1,
                submit: 0,
                fetch: 0,
            });
            await page.evaluate(() =>
                window.uploadProgressProbe.setMounted(true)
            );
            await cancel.press('Enter');
            assert.deepEqual(await readCalls(), {
                cancel: 2,
                submit: 0,
                fetch: 0,
            });
            await page.evaluate(() =>
                window.uploadProgressProbe.setMounted(false)
            );
            await bar.waitFor({ state: 'detached' });
            assert.deepEqual(await readCalls(), {
                cancel: 2,
                submit: 0,
                fetch: 0,
            });
            assert.deepEqual(external, []);
            assert.deepEqual(pageErrors, []);
            assert(
                requests.every((request) =>
                    [
                        '/',
                        '/host.js',
                        '/progress.css',
                        '/device.css',
                        '/favicon.ico',
                    ].includes(request)
                )
            );
            evidence.formats[format] = {
                percentages: [0, 50, 100],
                deviceSelections: selected,
                ...(await readCalls()),
            };
        } finally {
            try {
                await context?.close();
            } finally {
                if (server.listening) {
                    server.closeAllConnections();
                    await new Promise((resolve, reject) =>
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        )
                    );
                }
            }
        }
    }
}
