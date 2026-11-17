import { runAgeQualifiedConsumerInstall } from './age-qualified-consumer-install.mjs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const formulaReactTypedConsumer = `
import type { ReactNode } from 'react';
import { FormulaField, renderFormulaField, AirtableForm, AirtableGrid, AirtableList, type FormulaFieldProps, type FormulaFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
const options: FormulaFieldOptions = { className: 'formula-consumer' };
// @ts-expect-error Formula has no editor or write option.
const write: FormulaFieldOptions = { setValue: (value: number) => {} };
// @ts-expect-error Formula has no Clear button.
const clear: FormulaFieldOptions = { clearLabel: 'Clear' };
export const renderers: FieldRendererSlots<ReactNode> = { renderFormulaField: props => renderFormulaField(props, options) };
export function Bound(props: FormulaFieldProps) { return <FormulaField {...props} {...options} />; }
export function Override(props: FormulaFieldProps) { return <FormulaField {...props} render={({snapshot}) => <span>{String(snapshot.value ?? '')}</span>} />; }
export function Kinds(formula: FieldRendererProps<'formula'>, rollup: FieldRendererProps<'rollup'>) {
    const readonly: { type: 'readonly' } = formula.capability;
    // @ts-expect-error Rollup remains a separate physical slot.
    renderFormulaField(rollup);
    // @ts-expect-error Formula has no editable capability.
    const editable: FieldRendererProps<'formula'>['capability'] = { type: 'editable', setValue: () => ({accepted: true}) };
    return readonly;
}
export function Compositions({form, portal}: {form: FormRenderScope; portal: PortalRenderScope}) { return <>
    <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
    <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
    <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
</>; }
`;

/** Additive controlled contract; the legacy binding recipe above stays intact. */
export const controlledFormulaTypedConsumer = `
import { createElement } from 'react';
import { FormulaField, type FormulaFieldProps, type ControlledFormulaFieldProps, type ReadOnlyURLGalleryProps } from '@miniextensions/sdk/react';
const accepted: ControlledFormulaFieldProps = {mode:'controlled',isValid:true,resultType:'singleLineText',value:'answer',formattedValue:'answer',language:'en',inputId:'formula',formId:'host',labelledBy:'title',describedBy:'help'};
createElement(FormulaField, accepted);
createElement(FormulaField, {mode:'controlled',isValid:false,language:'en'});
const gallery: ReadOnlyURLGalleryProps = {entries:[{url:'/one.png',filename:'One',id:'one'},{url:'/one.png',filename:'Repeated'}],labels:{attachments:'Files'},thumbFitType:'contain',thumbnailSize:'small',hideAttachmentName:false,disableOpenFiles:false,disableDownloadFiles:true};
createElement(FormulaField, {...accepted,renderFormulaAsAttachment:true,gallery});
createElement(FormulaField, {...accepted,resultType:'singleSelect',select:{choices:[{id:'Ready',name:'Ready',color:'greenLight2'}],isInGrid:true}});
// @ts-expect-error controlled Formula never borrows a physical field writer
const writer: ControlledFormulaFieldProps = {...accepted,setValue:()=>{}};
// @ts-expect-error controlled Formula never borrows a native renderer
const renderer: ControlledFormulaFieldProps = {...accepted,render:()=>null};
// @ts-expect-error binding is a separate legacy contract
const fabricatedBinding: ControlledFormulaFieldProps = {...accepted,binding:{}};
declare const binding: FormulaFieldProps['binding'];
// @ts-expect-error the public facade also rejects mixed binding/controlled contracts
createElement(FormulaField, {...accepted,binding});
// @ts-expect-error invalid metadata cannot carry a result answer
const invalidAnswer: ControlledFormulaFieldProps = {mode:'controlled',isValid:false,language:'en',value:1};
// @ts-expect-error readonly URL entries require an explicit resource URL
const labelOnly: ReadOnlyURLGalleryProps = {entries:[{filename:'Only a label'}]};
// @ts-expect-error gallery grants no upload authority
const upload: ReadOnlyURLGalleryProps = {...gallery,onUpload:()=>{}};
void [writer,renderer,fabricatedBinding,invalidAnswer,labelOnly,upload];
`;

/** Cold, installed controlled modes in both module formats and React versions. */
export function checkControlledFormulaReactMatrix({
    archivePath,
    typescriptBin,
}) {
    archivePath = resolve(archivePath);
    const parent = mkdtempSync(
        join(tmpdir(), 'sdk-controlled-formula-consumers-')
    );
    const profiles = [];
    try {
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            const directory = mkdtempSync(join(parent, version.react + '-'));
            writeFileSync(
                join(directory, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    dependencies: {
                        '@miniextensions/sdk': `file:${archivePath}`,
                        react: version.react,
                        'react-dom': version.react,
                        '@types/react': version.types,
                        '@types/react-dom': version.domTypes,
                        '@types/node': '22.20.5',
                    },
                })
            );
            const run = (command, args) =>
                execFileSync(command, args, {
                    cwd: directory,
                    env: {
                        ...process.env,
                        npm_config_cache: join(directory, 'npm-cache'),
                    },
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 120000,
                });
            runAgeQualifiedConsumerInstall(run, [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
            ]);
            for (const format of ['esm', 'cjs']) {
                const extension = format === 'esm' ? 'mts' : 'cts';
                writeFileSync(
                    join(directory, `consumer.${extension}`),
                    controlledFormulaTypedConsumer
                );
                run(process.execPath, [
                    typescriptBin,
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--noEmit',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    '--target',
                    'ES2022',
                    `consumer.${extension}`,
                ]);
                const imports =
                    format === 'esm'
                        ? `import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {FormulaField} from '@miniextensions/sdk/react';`
                        : `const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {FormulaField}=require('@miniextensions/sdk/react');`;
                writeFileSync(
                    join(directory, 'runtime.mjs'),
                    `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
assert.equal(typeof globalThis.document,'undefined');
${imports}
const base={mode:'controlled',isValid:true,resultType:'singleLineText',language:'en',value:'literal',formattedValue:'literal'};
const render=props=>renderToStaticMarkup(React.createElement(FormulaField,{...base,...props}));
assert.match(render({value:0,formattedValue:'0'}),/>0</);
assert.match(render({value:false,formattedValue:'false'}),/>false</);
assert.match(render({value:null,formattedValue:null}),/No Value/);
assert.match(render({value:{error:'#ERROR!'},formattedValue:'#ERROR!'}),/#ERROR!/);
assert.match(render({value:{specialValue:'Infinity'},formattedValue:'Infinity'}),/Infinity/);
assert.ok(render({value:'<strong>Literal</strong>',formattedValue:'<strong>Literal</strong>'}).includes('&lt;strong&gt;Literal&lt;/strong&gt;'));
const html=render({value:'<strong>Sanitized</strong><script>unsafe()</script>',renderFormulaAsHTML:true,renderFormulaAsAttachment:true,displayAsButton:true,gallery:{entries:[{url:'/ignored.png'}]}});
assert.ok(html.includes('<strong>Sanitized</strong>'));assert.doesNotMatch(html,/<script|url-gallery|ignored.png/);
const select=render({resultType:'singleSelect',value:'Ready',formattedValue:'Ready',select:{choices:[{id:'Ready',name:'Ready',color:'greenLight2'}]},renderFormulaAsHTML:true,renderFormulaAsAttachment:true,displayAsButton:true});
assert.match(select,/Ready/);assert.doesNotMatch(select,/url-gallery|<iframe|<input/);
const gallery=render({value:'admitted URLs',renderFormulaAsAttachment:true,displayAsButton:true,gallery:{entries:[{url:'/one.png',filename:'One'},{url:'/one.png',filename:'Again'}],hideAttachmentName:false,disableDownloadFiles:true}});
assert.match(gallery,/mx-sdk-url-gallery/);assert.match(gallery,/Again/);assert.equal(gallery.split('aria-label="/one.png"').length-1,2);
assert.ok(render({value:'https://example.invalid/formula',displayAsButton:true,validUrlButtonLabel:'Open result'}).includes('href="https://example.invalid/formula"'));
assert.match(render({value:42,displayAsButton:true,invalidUrlButtonLabel:'Unavailable result'}),/Unavailable result/);
const masked=render({value:'PRIVATE_FORMULA',formattedValue:'PRIVATE_FORMULA',obscurePassword:true,renderFormulaAsHTML:true,renderFormulaAsAttachment:true});assert.doesNotMatch(masked,/PRIVATE_FORMULA|url-gallery/);assert.match(masked,/••••••••/);
for(const props of [{value:null,renderFormulaAsHTML:true},{value:0,renderFormulaAsAttachment:true}])assert.match(render(props),/role="alert"/);
assert.match(renderToStaticMarkup(React.createElement(FormulaField,{mode:'controlled',isValid:false,language:'en'})),/invalid value/);
for(const css of ['attachment-preview.css','readonly-url-gallery.css','complete-readonly-text.css','single-line-text.css','single-select.css'])assert.ok(require.resolve('@miniextensions/sdk/react/'+css));
console.log(JSON.stringify({react:React.version,format:'${format}',coldSSR:true,controlledModes:7}));
`
                );
                const result = JSON.parse(
                    run(process.execPath, [
                        ...(format === 'cjs'
                            ? ['--no-experimental-require-module']
                            : []),
                        'runtime.mjs',
                    ]).trim()
                );
                assert.equal(result.react, version.react);
                const installed = readFileSync(
                    join(
                        directory,
                        `node_modules/@miniextensions/sdk/dist/${format}/react/FormulaField.js`
                    )
                );
                const packed = execFileSync('tar', [
                    '-xOf',
                    archivePath,
                    `package/dist/${format}/react/FormulaField.js`,
                ]);
                assert.ok(installed.equals(packed));
                profiles.push({
                    ...result,
                    strictTypes: true,
                    moduleSha256: createHash('sha256')
                        .update(installed)
                        .digest('hex'),
                });
            }
        }
        return { profiles, synthetic: true };
    } finally {
        rmSync(parent, { recursive: true, force: true });
    }
}

/** Synthetic accepted Form shared by installed and packed-browser checks. */
export function formulaLoadedFixture() {
    const loaded = fixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    loaded.payload.hasParentExtension = false;
    loaded.payload.publicFields.state = {
        ...loaded.payload.publicFields.state,
        multiPageFormMode: 'multi-page',
        promptUserBeforeSubmission: false,
        enableFormComputeMode: false,
        autoSubmitAfterPrefill: false,
    };
    const number = { type: 'number', options: { precision: 2 } };
    const text = { type: 'singleLineText', options: null };
    const data = [
        ['amount', number, -1234.567, '-1234.57'],
        ['array', number, [1.234, null, 2.345], '1.23, 2.35'],
        [
            'text',
            text,
            '<img src="https://secret.invalid/image">\n**literal**',
            '<img src="https://secret.invalid/image">\n**literal**',
        ],
        ['empty', number, null, ''],
        ['missing', number, undefined, ''],
        ['error', number, { error: '#ERROR!' }, '#ERROR!'],
        ['special', number, { specialValue: 'Infinity' }, 'Infinity'],
        [
            'choices',
            { type: 'multipleSelects', options: { choices: [] } },
            ['a', 'b'],
            'a, b',
        ],
        [
            'currency',
            { type: 'currency', options: { symbol: '$', precision: 2 } },
            -1234.567,
            '-$1,234.57',
        ],
        ['masked', text, 'PRIVATE_MASKED_ANSWER', '••••••••'],
        ['invalid', null, 123, ''],
        [
            'linked',
            {
                type: 'multipleRecordLinks',
                options: {
                    linkedTableId: 'private',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                },
            },
            ['rec12345678901234', 'Supplied label'],
            'Unavailable, Supplied label',
        ],
    ];
    loaded.payload.fieldIdsInForm = data.map(([id]) => id);
    for (const [id, result, value] of data) {
        if (value === undefined) delete loaded.payload.formRecord.data[id];
        else loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'formula',
            airtableField: {
                id,
                name: id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'formula',
                    options: result
                        ? { isValid: true, result }
                        : { isValid: false, result: null },
                },
            },
            miniExtConfig:
                id === 'masked'
                    ? { obscurePassword: true }
                    : {
                          renderFormulaAsHTML: true,
                          renderFormulaAsAttachment: true,
                          displayAsButton: true,
                      },
        };
    }
    return {
        loaded,
        expected: data.map(([id, , , expected]) => [id, expected]),
    };
}

export async function checkFormulaConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const { createElement: h, act, StrictMode } = require('react');
    const { createRoot } = require('react-dom/client');
    let checks = 0;
    try {
        for (const format of ['esm', 'cjs']) {
            const load = (name) =>
                format === 'cjs'
                    ? require(`@miniextensions/sdk/${name}`)
                    : import(
                          pathToFileURL(
                              join(
                                  consumerDirectory,
                                  `node_modules/@miniextensions/sdk/dist/esm/${name}/index.js`
                              )
                          )
                      );
            const [ui, forms, react] = await Promise.all(
                ['ui', 'forms', 'react'].map(load)
            );
            assert.equal(ui.renderFormulaField, undefined);
            assert.equal(typeof react.FormulaField, 'function');
            const { loaded, expected } = formulaLoadedFixture();
            let requests = 0;
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error('No Formula Save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'formula-consumer', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            const scope = ui.createFormRenderScope({
                fields,
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const renderers = {
                    renderFormulaField: (props) =>
                        h(
                            'div',
                            { 'data-field': props.fieldId },
                            react.renderFormulaField(props)
                        ),
                };
                await act(async () =>
                    root.render(
                        h(
                            StrictMode,
                            null,
                            h(
                                react.AirtableForm,
                                { scope, renderers },
                                (state) =>
                                    state.fields.map((field) => field.node)
                            )
                        )
                    )
                );
                for (const [id, expectedText] of expected) {
                    assert.equal(
                        container.querySelector(`[data-field="${id}"] output`)
                            .textContent,
                        expectedText
                    );
                    assert.equal(fields.field(id).getSnapshot().canEdit, false);
                    checks++;
                }
                assert.equal(
                    container.querySelector('input,button,a,img,iframe'),
                    null
                );
                assert.equal(
                    container.innerHTML.includes('PRIVATE_MASKED_ANSWER'),
                    false
                );
                assert.equal(
                    container.innerHTML.includes('rec12345678901234'),
                    false
                );
                assert.equal(requests, 0);
                const binding = fields.field('amount');
                const before = binding.getSnapshot();
                binding.setValue = () => {
                    throw Error('Do not borrow a Formula setter');
                };
                await act(async () =>
                    root.render(h(react.FormulaField, { binding }))
                );
                assert.equal(
                    container.querySelector('output').textContent,
                    '-1234.57'
                );
                assert.deepEqual(binding.getSnapshot().value, before.value);
                assert.equal(binding.getSnapshot().dirty, before.dirty);
                await act(async () => fields.destroy());
                assert.equal(container.querySelector('output'), null);
                checks++;
            } finally {
                await act(async () => root.unmount());
                scope.destroy();
                fields.destroy();
                container.remove();
            }
        }
    } finally {
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
    return { checks };
}
