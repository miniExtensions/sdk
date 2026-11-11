import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const recordCommentsTypedConsumer = `
import {createElement} from 'react';
import {createRecordCommentsController,presentRecordComment,type RecordCommentsControllerOptions} from '@miniextensions/sdk/ui';
import {CompleteRecordComments,CompleteRecordCommentsDialog,recordCommentsLabels,type RecordCommentsLabels} from '@miniextensions/sdk/react';
const options:RecordCommentsControllerOptions={owner:{isCurrent:()=>true},childExtensionAccessToken:'captured',async list(input){return {readableVersionOfRecordPrimaryValue:null,comments:[],nextCursor:input.cursor??undefined};},async append(input){const raw:string=input.comment;void raw;},invalidate(input){const token:string=input.childExtensionAccessToken;void token;}};
const controller=createRecordCommentsController(options);
const labels:RecordCommentsLabels={...recordCommentsLabels,title:'Comentarios'};
createElement(CompleteRecordComments,{controller,labels});
createElement(CompleteRecordCommentsDialog,{controller,labels,dismiss(){},reservedInlineEndWidth:'440px'});
presentRecordComment({id:'native',createdTime:'2024-01-01',lastUpdatedTime:null,text:'raw',actor:{type:'public',extensionId:'ext'},authorLabel:'Verified'});
// @ts-expect-error actual captured ownership is mandatory
createRecordCommentsController({...options,owner:'record-A'});
// @ts-expect-error failed transport must not be a synchronous catch-and-resolve wrapper
createRecordCommentsController({...options,append(){}});
// @ts-expect-error the complete UI has no host renderer injection
createElement(CompleteRecordComments,{controller,labels,renderRows(){return null;}});
// @ts-expect-error complete dialog dismissal authority is explicit
createElement(CompleteRecordCommentsDialog,{controller,labels});
// @ts-expect-error the React-free core does not export the dialog
import {CompleteRecordCommentsDialog as CoreDialog} from '@miniextensions/sdk';
void CoreDialog;
`;

async function installed(directory, happyDomModulePath) {
    const consumer = createRequire(join(directory, 'package.json'));
    const React = consumer('react');
    const server = consumer('react-dom/server');
    assert.equal(typeof document, 'undefined');
    let groups = 0;
    for (const format of ['esm', 'cjs']) {
        const load = async (entry) =>
            format === 'cjs'
                ? consumer(entry)
                : import(
                      pathToFileURL(
                          consumer.resolve(entry).replace('/cjs/', '/esm/')
                      ).href
                  );
        const ui = await load('@miniextensions/sdk/ui');
        const api = await load('@miniextensions/sdk/react');
        const css = consumer.resolve(
            '@miniextensions/sdk/react/complete-record-comments.css'
        );
        assert(readFileSync(css, 'utf8').includes('.mx-sdk-comments-panel'));
        assert(
            readFileSync(css.replace('/esm/', '/cjs/'), 'utf8').includes(
                '.mx-sdk-comments-panel'
            )
        );
        const requests = [];
        const writes = [];
        const invalidations = [];
        const errors = [];
        const controller = ui.createRecordCommentsController({
            owner: { isCurrent: () => true },
            childExtensionAccessToken: 'private-captured',
            async list(input) {
                requests.push(input);
                return {
                    readableVersionOfRecordPrimaryValue: 'Ada',
                    comments: [],
                };
            },
            async append(input) {
                writes.push(input);
            },
            invalidate(input) {
                invalidations.push(input);
            },
        });
        const labels = {
            ...api.recordCommentsLabels,
            title: 'Comentarios',
            empty: 'Sin comentarios',
            addComment: 'Añadir',
            send: 'Enviar',
            close: 'Cerrar',
        };
        let dismissals = 0;
        const element = (displayLabels = labels) =>
            React.createElement(api.CompleteRecordCommentsDialog, {
                controller,
                labels: displayLabels,
                dismiss() {
                    dismissals++;
                },
            });
        const literalHtml = server.renderToString(
            element({ ...labels, title: '<Comentarios>' })
        );
        assert(literalHtml.includes('&lt;Comentarios&gt;'));
        const html = server.renderToString(element());
        assert(!html.includes('private-captured'));
        assert.equal(requests.length, 0);
        const { Window } = createRequire(import.meta.url)(happyDomModulePath);
        const window = new Window();
        const keys = [
            'window',
            'document',
            'navigator',
            'HTMLElement',
            'HTMLDialogElement',
            'HTMLTextAreaElement',
            'Node',
            'IS_REACT_ACT_ENVIRONMENT',
        ];
        const originals = keys.map((key) =>
            Object.getOwnPropertyDescriptor(globalThis, key)
        );
        let root;
        try {
            for (const key of keys)
                Object.defineProperty(globalThis, key, {
                    configurable: true,
                    writable: true,
                    value:
                        key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
                });
            const client = consumer('react-dom/client');
            const host = window.document.createElement('main');
            window.document.body.append(host);
            host.innerHTML = html;
            const act = React.act ?? consumer('react-dom/test-utils').act;
            await act(async () => {
                root = client.hydrateRoot(host, element(), {
                    onRecoverableError: (error) => errors.push(error),
                });
            });
            assert.equal(errors.length, 0);
            assert.equal(requests.length, 1);
            assert.equal(
                host.querySelectorAll('dialog,[role=dialog]').length,
                1
            );
            assert.equal(
                host.querySelector('dialog').getAttribute('aria-label'),
                labels.title
            );
            assert(host.textContent.includes(labels.empty));
            // happy-dom leaves entities encoded in parsed attributes. Keep
            // escaped SSR serialization and literal DOM update as separate
            // oracles, alongside hydration of the actual localized component.
            await act(async () => {
                root.render(element({ ...labels, title: '<Comentarios>' }));
            });
            assert.equal(
                host.querySelector('dialog').getAttribute('aria-label'),
                '<Comentarios>'
            );
            assert.equal(host.querySelector('Comentarios'), null);
            await act(async () => controller.setDraft('  raw @[unknown] '));
            const button = (label) =>
                [...host.querySelectorAll('button')].find(
                    (node) =>
                        node.getAttribute('aria-label') === label ||
                        node.textContent === label
                );
            await act(async () => {
                button(labels.send).click();
                button(labels.send).click();
            });
            assert.deepEqual(writes, [
                {
                    childExtensionAccessToken: 'private-captured',
                    comment: '{{Ada}}:   raw @[unknown] ',
                },
            ]);
            assert.deepEqual(invalidations, [
                { childExtensionAccessToken: 'private-captured' },
            ]);
            assert.equal(requests.length, 2);
            assert.equal(host.querySelector('textarea').value, '');
            await act(async () => button(labels.close).click());
            assert.equal(dismissals, 1);
            await act(async () => root.unmount());
            root = null;
            assert.equal(host.childElementCount, 0);
            groups++;
        } finally {
            if (root)
                await (React.act ?? consumer('react-dom/test-utils').act)(
                    async () => root.unmount()
                );
            keys.forEach((key, index) => {
                if (originals[index])
                    Object.defineProperty(globalThis, key, originals[index]);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    }
    return { react: React.version, groups };
}

export function checkRecordCommentsReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-record-comments-'));
    const versions = [];
    const run = (command, args) =>
        execFileSync(command, args, { cwd: directory, stdio: 'inherit' });
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: { '@miniextensions/sdk': `file:${archivePath}` },
            })
        );
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            run('npm', [
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
            ]);
            for (const extension of ['mts', 'cts']) {
                const name = `record-comments.${extension}`;
                writeFileSync(
                    join(directory, name),
                    recordCommentsTypedConsumer
                );
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
            const result = JSON.parse(
                execFileSync(
                    process.execPath,
                    [
                        fileURLToPath(import.meta.url),
                        '--run-consumer',
                        directory,
                        happyDomModulePath,
                    ],
                    {
                        cwd: directory,
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'inherit'],
                    }
                )
            );
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            versions.push(result);
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
if (process.argv[2] === '--run-consumer')
    console.log(
        JSON.stringify(await installed(process.argv[3], process.argv[4]))
    );
