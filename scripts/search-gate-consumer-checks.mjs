import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const searchGateTypedConsumer = `
import {createElement,type ComponentProps} from 'react';
import {PortalSearchGate,usePortalSearchGate,type PortalSearchGateDialogProps} from '@miniextensions/sdk/react';
import {getSearchPageQueryKeys,getSearchPageSubmissionUrl,hasSearchPageQueryParam,type PortalSearchGateField} from '@miniextensions/sdk/portals';
const field:PortalSearchGateField={fieldId:'fld_name',fieldName:'Customer name'};
type Props=ComponentProps<typeof PortalSearchGate>;
const props:Props={searchPageField:field,title:null,description:'Find {fieldName}',noResultsMessage:'',hasNoResults:true,getCurrentUrl:()=> 'https://example.test/?keep=yes#fragment',onNavigate(url){const next:string=url;void next;},onClearSearch(){},accentColor:'#4f46e5',focusColor:'#6366f1',reservedInlineEndWidth:'440px',headerActions:createElement('button',{type:'button'},'Settings')};
createElement(PortalSearchGate,props);
function shell({children,ariaLabel,descriptionId,initialFocus,description}:PortalSearchGateDialogProps){
 const current:HTMLInputElement|null=initialFocus.current;
 void current;void description;
 return createElement('section',{role:'dialog','aria-label':ariaLabel,'aria-describedby':descriptionId},children);
}
createElement(PortalSearchGate,{...props,renderDialog:shell});
function hook(){const state=usePortalSearchGate(props);const submitted:boolean=state.submit();state.clear();return submitted;}
const keys=getSearchPageQueryKeys(field);
const url:string=getSearchPageSubmissionUrl({currentUrl:'https://example.test',searchPageField:field,searchTerm:' value '});
const present:boolean=hasSearchPageQueryParam({searchParams:new URLSearchParams(),searchPageField:field});
// @ts-expect-error a native renderer is not the complete SDK gate
createElement(PortalSearchGate,{...props,renderPrompt:()=>null});
// @ts-expect-error field ID alone is not qualified display metadata
const badField:PortalSearchGateField={fieldId:'fld_name'};
// @ts-expect-error navigation requires an explicit host callback
const missing:Props={searchPageField:field,getCurrentUrl:()=> 'https://example.test'};
void hook;void keys;void url;void present;void badField;void missing;
`;

async function checkInstalled(directory, happyDomModulePath) {
    const consumer = createRequire(join(directory, 'package.json'));
    const React = consumer('react');
    const { renderToString } = consumer('react-dom/server');
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const cjs = consumer('@miniextensions/sdk/react');
    const esm = await import(
        pathToFileURL(
            join(
                directory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    const policy = consumer('@miniextensions/sdk/portals');
    const css = readFileSync(
        consumer.resolve('@miniextensions/sdk/react/search-gate.css'),
        'utf8'
    );
    assert(css.includes('.mx-sdk-search-gate'));
    let groups = 0;
    for (const api of [esm, cjs]) {
        assert.equal(typeof api.PortalSearchGate, 'function');
        assert.equal(typeof api.usePortalSearchGate, 'function');
        const navigations = [];
        let clears = 0,
            reads = 0;
        let props = {
            searchPageField: { fieldId: 'fld_name', fieldName: 'Name 東京' },
            description: 'Find {fieldName}, then {fieldName}.',
            hasNoResults: true,
            getCurrentUrl() {
                reads++;
                return 'https://example.test/portal?keep=yes&search_fld_name=old#fragment';
            },
            onNavigate(url) {
                navigations.push(url);
            },
            onClearSearch() {
                clears++;
            },
        };
        const element = () =>
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(api.PortalSearchGate, props)
            );
        assert.equal(typeof document, 'undefined');
        const html = renderToString(element());
        assert(html.includes('<dialog'));
        assert(html.includes('Find Name 東京, then Name 東京.'));
        assert(html.includes('Enter name 東京'));
        assert.equal(reads, 0);
        assert.deepEqual(navigations, []);
        const window = new Window();
        const keys = [
            'window',
            'document',
            'navigator',
            'HTMLElement',
            'HTMLInputElement',
            'HTMLDialogElement',
            'IS_REACT_ACT_ENVIRONMENT',
        ];
        const originals = keys.map((key) =>
            Object.getOwnPropertyDescriptor(globalThis, key)
        );
        keys.forEach((key) =>
            Object.defineProperty(globalThis, key, {
                configurable: true,
                writable: true,
                value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
            })
        );
        window.document.documentElement.style.fontSize = '16px';
        const stylesheet = window.document.createElement('style');
        stylesheet.textContent = css;
        window.document.head.append(stylesheet);
        const host = window.document.createElement('div');
        host.innerHTML = html;
        window.document.body.append(host);
        let root;
        const recoverable = [];
        const { act } = React;
        try {
            const { hydrateRoot } = consumer('react-dom/client');
            await act(async () => {
                root = hydrateRoot(host, element(), {
                    onRecoverableError(error) {
                        recoverable.push(error);
                    },
                });
            });
            assert.deepEqual(recoverable, []);
            const input = host.querySelector('input');
            const dialog = host.querySelector('dialog');
            assert(input && dialog && dialog.open);
            assert.equal(window.document.activeElement, input);
            assert.equal(host.querySelector('label').htmlFor, input.id);
            const change = async (text) => {
                await act(async () => {
                    Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype,
                        'value'
                    ).set.call(input, text);
                    input.dispatchEvent(
                        new window.Event('input', { bubbles: true })
                    );
                });
            };
            const submit = async () => {
                await act(async () => {
                    host.querySelector('form').dispatchEvent(
                        new window.Event('submit', {
                            bubbles: true,
                            cancelable: true,
                        })
                    );
                });
            };
            assert(host.querySelector('.mx-sdk-search-gate-error'));
            await change(' \t ');
            await submit();
            assert.equal(reads, 0);
            await change('  Alice & 東京  ');
            assert(
                host.querySelector('.mx-sdk-search-gate-error'),
                'typing retains the error'
            );
            await submit();
            assert.equal(reads, 1);
            assert.equal(navigations.length, 1);
            const url = new URL(navigations[0]);
            assert.equal(
                url.searchParams.get('search_Name 東京'),
                'Alice & 東京'
            );
            assert.equal(url.searchParams.has('search_fld_name'), false);
            assert.equal(url.searchParams.get('keep'), 'yes');
            assert.equal(url.hash, '#fragment');
            assert.equal(host.querySelector('.mx-sdk-search-gate-error'), null);
            assert.equal(
                policy.hasSearchPageQueryParam({
                    searchParams: url.searchParams,
                    searchPageField: props.searchPageField,
                }),
                true
            );
            const cancel = new window.Event('cancel', { cancelable: true });
            await act(async () => {
                dialog.dispatchEvent(cancel);
            });
            assert.equal(cancel.defaultPrevented, true);
            assert.equal(dialog.open, true);
            props = {
                ...props,
                searchPageField: { fieldId: 'fld_new', fieldName: 'Other' },
            };
            await act(async () => root.render(element()));
            assert.equal(
                input.value,
                '  Alice & 東京  ',
                'metadata rerender preserves the native draft'
            );
            assert.equal(input.placeholder, 'Enter other');
            const clear = host.querySelector('button[type=button]');
            assert(clear);
            await act(async () => clear.click());
            assert.equal(input.value, '');
            assert.equal(clears, 1);
            assert.equal(navigations.length, 1);
            assert.equal(
                host.querySelector('button[type=submit]').textContent,
                'Search Again'
            );
            props = {
                ...props,
                renderDialog({ children, ariaLabel, descriptionId }) {
                    return React.createElement(
                        'section',
                        {
                            role: 'dialog',
                            'aria-label': ariaLabel,
                            'aria-describedby': descriptionId,
                        },
                        children
                    );
                },
            };
            await act(async () => root.render(element()));
            assert.equal(host.querySelector('dialog'), null);
            assert.equal(host.querySelectorAll('form').length, 1);
            assert.equal(host.querySelectorAll('input').length, 1);
            assert.equal(
                host.querySelector('[role=dialog]').getAttribute('aria-label'),
                'Search'
            );
            const actions = host.querySelector('.mx-sdk-search-gate-actions');
            assert(actions);
            assert.equal(window.getComputedStyle(actions).marginTop, '16px');
            const shellInput = host.querySelector('input');
            await act(async () => {
                Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set.call(shellInput, '  shell value  ');
                shellInput.dispatchEvent(
                    new window.Event('input', { bubbles: true })
                );
            });
            await submit();
            assert.equal(navigations.length, 2);
            assert.equal(
                new URL(navigations[1]).searchParams.get('search_Other'),
                'shell value'
            );
            assert.equal(reads, 2);
            await act(async () => root.unmount());
            root = undefined;
            assert.equal(host.querySelector('dialog'), null);
            assert.equal(reads, 2);
            assert.equal(clears, 1);
            groups++;
        } finally {
            if (root) await act(async () => root.unmount());
            keys.forEach((key, index) => {
                if (originals[index])
                    Object.defineProperty(globalThis, key, originals[index]);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
    }
    return {
        react: React.version,
        groups,
        scope: 'Installed ESM/CJS complete Search gate, SSR/hydration/DOM and public URL policy; not browser focus containment or native Portal acceptance.',
    };
}

export function checkSearchGateReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-search-gate-'));
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
                const name = `search-gate.${extension}`;
                writeFileSync(join(directory, name), searchGateTypedConsumer);
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
                    { cwd: directory, encoding: 'utf8' }
                )
            );
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            versions.push(result);
            console.log(
                `Installed complete Search gate React${result.react}: ESM/CJS, types, SSR/hydration, exact URL writes and DOM checks passed.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

if (process.argv[2] === '--run-consumer')
    console.log(
        JSON.stringify(await checkInstalled(process.argv[3], process.argv[4]))
    );
