import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    checkCreatedTimeConsumer,
    createdTimeReactTypedConsumer,
} from './created-time-consumer-checks.mjs';

const typedConsumer = `
import {createElement} from 'react';
import {CreatedTimeField,BindingCreatedTimeField,type CreatedTimeFieldProps,type BindingCreatedTimeFieldProps,type ControlledCreatedTimeFieldProps,type DocumentThumbnailOptions,type DocumentThumbnailSource} from '@miniextensions/sdk/react';
const controlled:ControlledCreatedTimeFieldProps={value:'2026-11-12T12:30:00Z',language:'en',dateConfig:{type:'dateTime',options:{dateFormat:{format:'YYYY-MM-DD'},timeFormat:{format:'HH:mm'},timeZone:'UTC'}},displayAsAttachments:true,displayAsButton:true,attachmentOptions:{isInGrid:true,disableDownloadFiles:true},owner:{token:{},isCurrent:()=>true}};
createElement(CreatedTimeField,controlled);
declare const old:CreatedTimeFieldProps;
const alias:BindingCreatedTimeFieldProps=old;
const original:CreatedTimeFieldProps=alias;
const binding=original.binding;
createElement(CreatedTimeField,original);
createElement(BindingCreatedTimeField,alias);
// @ts-expect-error The legacy props still require a binding.
const missing:CreatedTimeFieldProps=controlled;
// @ts-expect-error The explicit alias cannot receive controlled data.
createElement(BindingCreatedTimeField,controlled);
// @ts-expect-error No mixed binding/controlled inputs.
createElement(CreatedTimeField,{...controlled,binding});
// @ts-expect-error No writer authority on computed display.
createElement(CreatedTimeField,{...controlled,setValue:()=>{}});
// @ts-expect-error No injected native renderer.
createElement(CreatedTimeField,{...controlled,render:()=>null});
void missing;
const preloaded:DocumentThumbnailSource={kind:'bytes',bytes:new Uint8Array([65]),mimeType:'text/plain',revision:{}};
const preview:DocumentThumbnailOptions={source:preloaded};
const pdf:DocumentThumbnailOptions={source:{kind:'uri'},pdfWorkerUrl:'/assets/pdf.worker.min.mjs',pdfResourceBaseUrl:'/assets/'};
createElement(CreatedTimeField,{...controlled,attachmentOptions:{documentPreview:preview}});
createElement(CreatedTimeField,{...controlled,attachmentOptions:{documentPreview:pdf}});
// @ts-expect-error Preloaded content requires an explicit MIME and revision.
const untypedBytes:DocumentThumbnailSource={kind:'bytes',bytes:new Uint8Array()};
// @ts-expect-error Versioned PDF worker and resource URLs must be supplied together.
const incompleteAssets:DocumentThumbnailOptions={source:{kind:'uri'},pdfWorkerUrl:'/worker.mjs'};
// @ts-expect-error The document boundary accepts data, not native React rendering.
const injectedPreview:DocumentThumbnailOptions={source:preloaded,render:()=>null};
void untypedBytes;void incompleteAssets;void injectedPreview;
`;

const initial = {
    value: '2026-11-12T12:30:00Z',
    language: 'en',
    dateConfig: {
        type: 'dateTime',
        options: {
            dateFormat: { format: 'YYYY-MM-DD' },
            timeFormat: { format: 'HH:mm' },
            timeZone: 'America/New_York',
        },
    },
};

async function load(consumer, format) {
    return format === 'cjs'
        ? consumer('@miniextensions/sdk/react')
        : import(
              pathToFileURL(
                  consumer
                      .resolve('@miniextensions/sdk/react')
                      .replace('/cjs/', '/esm/')
              ).href
          );
}

async function profile(directory, format, happyDomModulePath) {
    const consumer = createRequire(join(directory, 'package.json'));
    const React = consumer('react');
    const { createElement: h, act } = React;
    assert.equal(consumer('react-dom/package.json').version, React.version);
    assert.equal(typeof document, 'undefined');
    const api = await load(consumer, format);
    const server = consumer('react-dom/server');
    const html = server.renderToString(h(api.CreatedTimeField, initial));
    assert.match(html, /2026-11-12 07:30/);
    assert.doesNotMatch(html, /<input|<button|<iframe/);
    assert.equal(typeof document, 'undefined');
    assert.equal(typeof api.BindingCreatedTimeField, 'function');
    for (const style of [
        'datetime',
        'complete-readonly-text',
        'button',
        'html-description',
        'field-presentation',
    ]) {
        const css = readFileSync(
            consumer.resolve(`@miniextensions/sdk/react/${style}.css`),
            'utf8'
        );
        assert.match(css, /mx-/);
    }
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window({
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
            disableIframePageLoading: true,
        },
    });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLDialogElement',
        'Node',
        'Event',
        'MouseEvent',
        'IS_REACT_ACT_ENVIRONMENT',
        'fetch',
    ];
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    let requests = 0,
        submits = 0;
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'fetch'
                      ? () => {
                            requests++;
                            throw Error('No implicit Created-time request');
                        }
                      : window[key],
        });
    // Synthetic DOM implements lifecycle only; native browser focus is separate proof.
    window.HTMLDialogElement.prototype.showModal = function () {
        this.open = true;
    };
    window.HTMLDialogElement.prototype.close = function () {
        this.open = false;
    };
    let root;
    const container = window.document.createElement('div');
    window.document.body.append(container);
    try {
        container.innerHTML = html;
        const errors = [];
        const { hydrateRoot } = consumer('react-dom/client');
        await act(async () => {
            root = hydrateRoot(container, h(api.CreatedTimeField, initial), {
                onRecoverableError: (error) => errors.push(error),
            });
        });
        assert.deepEqual(errors, []);
        let current = true;
        const token = {};
        const owner = { token, isCurrent: () => current };
        const association = {
            kind: 'group',
            controlId: 'created-control',
            labelId: 'created-label',
            descriptionId: 'created-help',
            errorId: 'created-error',
            formId: 'created-form',
        };
        const render = async (props) =>
            act(async () =>
                root.render(
                    h(
                        'form',
                        {
                            id: 'created-form',
                            onSubmit: (event) => {
                                event.preventDefault();
                                submits++;
                            },
                        },
                        h('span', { id: association.labelId }, 'Created'),
                        h('span', { id: association.descriptionId }, 'Help'),
                        h('span', { id: association.errorId }, 'Feedback'),
                        h(api.CreatedTimeField, {
                            ...initial,
                            owner,
                            identity: 'record-a',
                            presentation: { association, chromeOwner: 'shell' },
                            ...props,
                        })
                    )
                )
            );
        await render({});
        const group = container.querySelector('#created-control');
        assert.equal(group.getAttribute('aria-labelledby'), 'created-label');
        assert.equal(
            group.getAttribute('aria-describedby'),
            'created-error created-help'
        );
        assert.equal(group.getAttribute('aria-invalid'), 'true');
        assert.equal(container.querySelector('input,select,textarea'), null);
        await render({ value: null, language: 'es' });
        assert.match(container.textContent, /Sin Valor/);
        let coercions = 0;
        await render({
            value: {
                toString() {
                    coercions++;
                    throw Error('No coercion');
                },
            },
            invalidValueLabel: 'Malformed value',
        });
        assert.equal(coercions, 0);
        assert.equal(
            container.querySelector('[role=alert]').textContent,
            'Malformed value'
        );
        await render({
            displayContext: 'editable',
            displayAsAttachments: true,
            displayAsButton: true,
        });
        assert.match(container.textContent, /2026-11-12 07:30/);
        assert.equal(container.querySelector('a,button,img'), null);
        await render({
            value: 'https://example.invalid/a.png',
            displayAsAttachments: true,
            displayAsButton: true,
            attachmentOptions: { disableDownloadFiles: true },
        });
        assert.equal(
            container.querySelector('a'),
            null,
            'Attachments win both readonly flags'
        );
        assert.equal(
            container.querySelector('img'),
            null,
            'No image before visibility intent'
        );
        const held = container.querySelector('button');
        assert.equal(held.type, 'button');
        current = false;
        await act(async () =>
            held.dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
        assert.equal(
            container.querySelector('dialog'),
            null,
            'Latent retired owner cannot open'
        );
        await render({
            value: 'https://example.invalid/a.png',
            displayAsAttachments: true,
        });
        assert.equal(container.querySelector('#created-control'), null);
        current = true;
        await render({
            value: 'https://example.invalid/a',
            displayAsButton: true,
            buttonLabel: 'Open A',
        });
        const a = container.querySelector('a');
        assert.equal(a.href, 'https://example.invalid/a');
        await render({
            value: 'https://example.invalid/b',
            displayAsButton: true,
            buttonLabel: 'Open B',
            identity: 'record-b',
        });
        assert.equal(a.getAttribute('href'), null);
        await render({
            value: 'https://example.invalid/a',
            displayAsButton: true,
            buttonLabel: 'Open A',
        });
        assert.equal(
            a.getAttribute('href'),
            null,
            'An old A node stays retired after A-B-A'
        );
        const active = container.querySelector('a');
        assert.equal(active.href, 'https://example.invalid/a');
        owner.token = {};
        const event = new window.MouseEvent('click', {
            bubbles: true,
            cancelable: true,
        });
        await act(async () => active.dispatchEvent(event));
        assert.equal(
            event.defaultPrevented,
            true,
            'Latent token changes retire old navigation'
        );
        await render({ value: 'javascript:alert(1)', displayAsButton: true });
        assert.equal(container.querySelector('a'), null);
        assert.equal(container.querySelector('button').disabled, true);
        await render({
            value: 'https://example.invalid/a.png',
            displayAsAttachments: true,
            inert: true,
        });
        assert.equal(container.querySelector('img,iframe,a'), null);
        for (const button of container.querySelectorAll('button'))
            assert.equal(button.disabled, true);
        // Deterministic visibility for installed DOM lifecycle proof. Actual
        // viewport admission, workers and pixels use the maintained Chromium run.
        window.IntersectionObserver = class {
            constructor(callback) {
                this.callback = callback;
            }
            observe(target) {
                this.callback([{ target, isIntersecting: true }]);
            }
            disconnect() {}
        };
        owner.token = {};
        const displayDocument = async (mimeType, text, ready, extra = {}) => {
            await render({
                value: 'https://example.invalid/opaque-document',
                displayAsAttachments: true,
                attachmentOptions: {
                    documentPreview: {
                        source: {
                            kind: 'bytes',
                            mimeType,
                            bytes: new TextEncoder().encode(text),
                            revision: {},
                        },
                    },
                },
                ...extra,
            });
            const deadline = Date.now() + 3000;
            while (!ready() && Date.now() < deadline)
                await act(
                    async () => new Promise((resolve) => setTimeout(resolve, 5))
                );
            assert.ok(ready(), 'Installed document content must settle');
        };
        await displayDocument(
            'text/plain',
            'Installed literal <b>text</b>',
            () => container.textContent.includes('Installed literal')
        );
        assert.match(container.textContent, /Installed literal <b>text<\/b>/);
        assert.equal(container.querySelector('b'), null);
        await displayDocument(
            'text/csv',
            'Title,Value\n"<img src=x>","a,b"',
            () => container.querySelector('td') !== null
        );
        assert.equal(container.querySelector('th').textContent, 'Title');
        assert.equal(container.querySelector('td').textContent, '<img src=x>');
        assert.equal(
            container.querySelector('td:last-child').textContent,
            'a,b'
        );
        assert.equal(container.querySelector('img'), null);
        await displayDocument(
            'text/html',
            '<h2>Owned heading</h2><img src="https://example.invalid/tracker"><iframe src="https://example.invalid/provider"></iframe><a href="https://example.invalid/navigation">Literal link</a><form><input></form>',
            () => container.querySelector('h2') !== null
        );
        assert.equal(
            container.querySelector('h2').textContent,
            'Owned heading'
        );
        assert.equal(container.querySelector('img,iframe,a[href],input'), null);
        const retainedDocument = container.querySelector('h2');
        await render({
            value: 'https://example.invalid/opaque-document',
            displayAsAttachments: true,
            inert: true,
            attachmentOptions: {
                documentPreview: { source: { kind: 'uri' } },
            },
        });
        assert.equal(retainedDocument.isConnected, false);
        assert.equal(
            container.querySelector('h2,table,canvas,iframe,img'),
            null
        );
        await act(async () => root.unmount());
        root = null;
        assert.equal(requests, 0);
        assert.equal(submits, 0);
        return {
            react: React.version,
            format,
            groups: 12,
            ssr: true,
            hydration: true,
            requests,
            submits,
            styles: 5,
        };
    } finally {
        if (root) await act(async () => root.unmount());
        keys.forEach((key, index) =>
            originals[index]
                ? Object.defineProperty(globalThis, key, originals[index])
                : Reflect.deleteProperty(globalThis, key)
        );
        await window.happyDOM.close();
    }
}

export async function checkCreatedTimeReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const temporary = mkdtempSync(join(tmpdir(), 'sdk-created-time-'));
    const versions = [];
    try {
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            const directory = join(temporary, version.react);
            mkdirSync(directory);
            writeFileSync(
                join(directory, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                    },
                })
            );
            execFileSync(
                'npm',
                [
                    'install',
                    '--ignore-scripts',
                    '--strict-peer-deps',
                    '--no-audit',
                    '--no-fund',
                    '--package-lock=false',
                    `react@${version.react}`,
                    `react-dom@${version.react}`,
                    `@types/react@${version.types}`,
                    `@types/react-dom@${version.domTypes}`,
                ],
                { cwd: directory, stdio: 'inherit', timeout: 120000 }
            );
            for (const extension of ['mts', 'cts', 'tsx']) {
                const name = `created-time.${extension}`;
                writeFileSync(
                    join(directory, name),
                    extension === 'tsx'
                        ? createdTimeReactTypedConsumer +
                              "\nimport {createElement} from 'react';\nimport type {DocumentThumbnailOptions,DocumentThumbnailSource} from '@miniextensions/sdk/react';\n" +
                              typedConsumer.slice(
                                  typedConsumer.indexOf('const preloaded:')
                              )
                        : typedConsumer
                );
                execFileSync(
                    process.execPath,
                    [
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
                        '--jsx',
                        'react-jsx',
                        name,
                    ],
                    { cwd: directory, stdio: 'inherit' }
                );
            }
            const legacy = JSON.parse(
                execFileSync(
                    process.execPath,
                    [
                        fileURLToPath(import.meta.url),
                        '--legacy',
                        directory,
                        happyDomModulePath,
                    ],
                    { cwd: directory, encoding: 'utf8' }
                )
            );
            assert.equal(legacy.checks, 20);
            const profiles = [];
            for (const format of ['esm', 'cjs']) {
                const result = JSON.parse(
                    execFileSync(
                        process.execPath,
                        [
                            fileURLToPath(import.meta.url),
                            '--profile',
                            directory,
                            format,
                            happyDomModulePath,
                        ],
                        { cwd: directory, encoding: 'utf8' }
                    )
                );
                assert.equal(result.react, version.react);
                assert.equal(result.groups, 12);
                profiles.push(result);
            }
            versions.push({ react: version.react, legacy, profiles });
            console.log(
                `Installed Created Time React${version.react}: legacy20 groups and controlled ESM/CJS/types/JSX/CSS/SSR/hydration/owner checks passed.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}
if (process.argv[2] === '--profile')
    console.log(
        JSON.stringify(
            await profile(process.argv[3], process.argv[4], process.argv[5])
        )
    );
if (process.argv[2] === '--legacy')
    console.log(
        JSON.stringify(
            await checkCreatedTimeConsumer({
                consumerDirectory: process.argv[3],
                happyDomModulePath: process.argv[4],
            })
        )
    );
