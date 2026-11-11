import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const barcodeTypedConsumer = `
import {createElement} from 'react';
import {CompleteBarcodeScanner,useBarcodeScannerButton,useBarcodeScannerButtonInField,type CompleteBarcodeScannerProps} from '@miniextensions/sdk/react';
const props:CompleteBarcodeScannerProps={onUpdate(text){const exact:string=text;void exact;},onDismiss(){},ownerKey:'record-A',desktopViewportOffset:440,style:{color:'black'}};
createElement(CompleteBarcodeScanner,props);
function Scanner(){const scan=useBarcodeScannerButton({autoStartCamera:false,hideButton:false,runInLoop:true,setValue:async text=>{void text;}});return scan.scannerComponent;}
function Field(){return useBarcodeScannerButtonInField({fieldType:'email',enableQRCodeScannerForFormField:true,setValue(text){void text;}}).barcodeScannerButton;}
// @ts-expect-error camera scanner needs an explicit writer
createElement(CompleteBarcodeScanner,{onDismiss(){}});
// @ts-expect-error supported field policies are explicit
useBarcodeScannerButtonInField({fieldType:'phoneNumber',setValue(){}});
// @ts-expect-error a native modal renderer is not part of the portable API
const injected:CompleteBarcodeScannerProps={...props,renderModal(){}};
void Scanner;void Field;void injected;
`;

async function installed(directory, happyDomModulePath, ssr) {
    const require = createRequire(join(directory, 'package.json'));
    if (ssr) {
        Reflect.deleteProperty(globalThis, 'navigator');
        assert.equal(typeof navigator, 'undefined');
        const React = require('react');
        const { renderToString } = require('react-dom/server');
        for (const api of [
            require('@miniextensions/sdk/react'),
            await import(
                pathToFileURL(
                    join(
                        directory,
                        'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
                    )
                )
            ),
        ]) {
            const html = renderToString(
                React.createElement(api.CompleteBarcodeScanner, {
                    onUpdate() {
                        assert.fail('SSR write');
                    },
                    onDismiss() {},
                })
            );
            assert(!html.includes('<video')); // dialog camera work is a client effect
            function Field() {
                const scanner = api.useBarcodeScannerButtonInField({
                    fieldType: 'email',
                    autoStartCamera: true,
                    setValue() {
                        assert.fail('SSR write');
                    },
                });
                return scanner.barcodeScannerButton;
            }
            assert.equal(renderToString(React.createElement(Field)), '');
            assert.equal(typeof api.CompleteBarcodeScanner, 'function');
        }
        return { ssr: true };
    }
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'Window',
        'Document',
        'DocumentFragment',
        'EventTarget',
        'Node',
        'NodeFilter',
        'Element',
        'HTMLElement',
        'SVGElement',
        'ShadowRoot',
        'Event',
        'CustomEvent',
        'MouseEvent',
        'PointerEvent',
        'KeyboardEvent',
        'FocusEvent',
        'HTMLInputElement',
        'HTMLTextAreaElement',
        'HTMLSelectElement',
        'HTMLAnchorElement',
        'HTMLIFrameElement',
        'HTMLButtonElement',
        'HTMLFieldSetElement',
        'HTMLLegendElement',
        'HTMLFormElement',
        'HTMLVideoElement',
        'HTMLImageElement',
        'MutationObserver',
        'ResizeObserver',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'getComputedStyle',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'Window'
                      ? Window
                      : [
                              'requestAnimationFrame',
                              'cancelAnimationFrame',
                              'getComputedStyle',
                          ].includes(key)
                        ? window[key].bind(window)
                        : window[key],
        });
    const React = require('react');
    const { createRoot } = require('react-dom/client');
    const zxing = require('@zxing/library');
    let media = 0,
        stops = 0,
        decodes = 0;
    zxing.BrowserMultiFormatReader.prototype.listVideoInputDevices =
        async () => [{ kind: 'videoinput' }];
    zxing.BrowserMultiFormatReader.prototype.decodeOnceFromStream =
        async () => {
            decodes++;
            return { getText: () => '<decoded>' };
        };
    Object.defineProperty(window.navigator, 'mediaDevices', {
        value: {
            async getUserMedia() {
                media++;
                return {
                    getTracks: () => [
                        {
                            stop() {
                                stops++;
                            },
                        },
                    ],
                };
            },
        },
    });
    const css = readFileSync(
        require.resolve(
            '@miniextensions/sdk/react/complete-barcode-scanner.css'
        ),
        'utf8'
    );
    assert(css.includes('.mx-sdk-scanner-panel'));
    const profiles = [];
    try {
        for (const [format, api] of [
            ['cjs', require('@miniextensions/sdk/react')],
            [
                'esm',
                await import(
                    pathToFileURL(
                        join(
                            directory,
                            'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
                        )
                    )
                ),
            ],
        ]) {
            const host = window.document.createElement('main');
            window.document.body.append(host);
            const root = createRoot(host);
            let writes = [];
            function Host() {
                const scan = api.useBarcodeScannerButtonInField({
                    fieldType: 'barcode',
                    autoStartCamera: false,
                    setValue: (value) => {
                        writes.push(value);
                    },
                });
                return React.createElement(
                    'form',
                    {
                        onSubmit() {
                            assert.fail('implicit submit');
                        },
                    },
                    scan.barcodeScannerButton,
                    scan.scannerComponent
                );
            }
            await React.act(async () =>
                root.render(
                    React.createElement(
                        React.StrictMode,
                        null,
                        React.createElement(Host)
                    )
                )
            );
            assert.equal(window.document.querySelector('video'), null);
            const before = media;
            await React.act(async () => host.querySelector('button').click());
            assert.deepEqual(writes, ['<decoded>']);
            assert.equal(media, before + 1);
            assert.equal(window.document.querySelector('video'), null);
            await React.act(async () => root.unmount());
            host.remove();
            profiles.push({
                format,
                react: React.version,
                writes: writes.length,
            });
        }
        assert.equal(media, decodes);
        assert.equal(stops, media);
        return { profiles, media, stops };
    } finally {
        await window.happyDOM.close();
    }
}
export function checkCompleteBarcodeReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-barcode-consumer-'));
    const versions = [];
    const run = (command, args) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: ['ignore', 'pipe', 'inherit'],
            env: {
                ...process.env,
                NODE_OPTIONS: [
                    process.env.NODE_OPTIONS,
                    '--no-experimental-require-module',
                ]
                    .filter(Boolean)
                    .join(' '),
            },
        });
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({ private: true, type: 'module' })
        );
        for (const [react, types, domTypes] of [
            ['18.3.1', '18.3.12', '18.3.1'],
            ['19.2.0', '19.2.2', '19.2.2'],
        ]) {
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                archivePath,
                `react@${react}`,
                `react-dom@${react}`,
                `@types/react@${types}`,
                `@types/react-dom@${domTypes}`,
            ]);
            for (const extension of ['mts', 'cts']) {
                const name = `barcode.${extension}`;
                writeFileSync(join(directory, name), barcodeTypedConsumer);
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    name,
                ]);
            }
            const results = [];
            for (const mode of ['ssr', 'dom'])
                results.push(
                    JSON.parse(
                        run(process.execPath, [
                            fileURLToPath(import.meta.url),
                            '--consumer',
                            directory,
                            happyDomModulePath,
                            mode,
                        ]).toString()
                    )
                );
            versions.push({ react, results });
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
if (process.argv[2] === '--consumer')
    process.stdout.write(
        JSON.stringify(
            await installed(
                process.argv[3],
                process.argv[4],
                process.argv[5] === 'ssr'
            )
        )
    );
