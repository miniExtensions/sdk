import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const mask = '••••••••';
export const aiTextConsumerCheckCount = 134;

/** Accepted synthetic native objects shared by installed and browser proofs. */
export function aiTextLoadedFixture() {
    const loaded = fixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    loaded.payload.hasParentExtension = false;
    Object.assign(loaded.payload.publicFields.state, {
        multiPageFormMode: 'multi-page',
        promptUserBeforeSubmission: false,
        enableFormComputeMode: false,
        autoSubmitAfterPrefill: false,
    });
    const native = (state, value, isStale = false) => ({
        state,
        value,
        isStale,
    });
    const data = [
        [
            'source',
            native(
                'generated',
                '**Literal bold**\n  [a link](https://example.invalid)  Ω'
            ),
        ],
        [
            'text',
            native(
                'generated',
                '<img src="https://secret.invalid/image">\n  **literal** Ω  ',
                true
            ),
        ],
        ['url', native('generated', 'https://example.invalid/supplied')],
        [
            'spacing',
            native('generated', '  leading\t tab\r\nCRLF\ntrailing  ', true),
        ],
        ['empty', native('empty', '')],
        ['loading', native('loading', 'Supplied while loading', true)],
        [
            'error',
            {
                ...native('error', '<b>Supplied error value</b>'),
                errorType: 'PRIVATE_ERROR_TYPE',
            },
        ],
        ['blank', native('generated', '')],
        ['null', null],
        ['missing', undefined],
        ['masked', native('generated', 'PRIVATE_MASKED_AI_TEXT', true)],
        ...['empty', 'loading', 'generated', 'error'].flatMap((state) =>
            [false, true].map((isStale) => [
                `state-${state}-${isStale}`,
                native(
                    state,
                    `  Supplied ${state} / stale=${isStale}\n**literal**  `,
                    isStale
                ),
            ])
        ),
    ];
    loaded.payload.fieldIdsInForm = data.map(([id]) => id);
    for (const [id, value] of data) {
        if (value === undefined) delete loaded.payload.formRecord.data[id];
        else loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'aiText',
            airtableField: {
                id,
                name: id === 'source' ? 'AI text' : id,
                description: null,
                isComputed: true,
                isPrimaryField: false,
                config: { type: 'aiText', options: {} },
            },
            miniExtConfig: id === 'masked' ? { obscurePassword: true } : {},
        };
    }
    return {
        loaded,
        expected: data.map(([id, value]) => [
            id,
            id === 'masked' ? mask : (value?.value ?? ''),
        ]),
    };
}

/**
 * Strict NodeNext/JSX declarations. Direct-module imports verify the dedicated
 * declaration file only; public-export mode verifies the supported React API.
 */
export function aiTextTypedConsumer({
    mode = 'public-export',
    moduleSpecifier,
    jsx = false,
} = {}) {
    assert(['direct-module', 'public-export'].includes(mode));
    if (mode === 'direct-module')
        assert(moduleSpecifier, 'Direct declarations need a module specifier');
    const source =
        mode === 'public-export'
            ? '@miniextensions/sdk/react'
            : moduleSpecifier;
    return `
import {createElement,type ReactNode} from 'react';
import {AiTextField,renderAiTextField,type AiTextFieldProps,type AiTextFieldOptions} from ${JSON.stringify(source)};
import type {FieldRendererProps,FieldRendererSlots} from '@miniextensions/sdk/ui';
const options:AiTextFieldOptions={className:'literal-ai-text'};
// @ts-expect-error Display options grant no setter.
const write:AiTextFieldOptions={setValue:()=>{}};
// @ts-expect-error No generation action is introduced.
const generate:AiTextFieldOptions={generate:()=>{}};
// @ts-expect-error No retry action is introduced.
const retry:AiTextFieldOptions={retry:()=>{}};
// @ts-expect-error Prompt inspection is not a display option.
const prompt:AiTextFieldOptions={prompt:'Generate something'};
// @ts-expect-error References are not part of the display API.
const references:AiTextFieldOptions={references:['field']};
// @ts-expect-error AI text is not parsed as Markdown.
const parser:AiTextFieldOptions={parseMarkdown:(value:string)=>value};
// @ts-expect-error Supplied strings are not normalized.
const normalize:AiTextFieldOptions={normalize:(value:string)=>value};
// @ts-expect-error Supplied links remain literal strings.
const link:AiTextFieldOptions={href:'https://example.invalid'};
// @ts-expect-error The component is not a core export.
import {AiTextField as coreField} from '@miniextensions/sdk';
// @ts-expect-error The renderer is not a headless UI export.
import {renderAiTextField as headlessRenderer} from '@miniextensions/sdk/ui';
// @ts-expect-error The internal control is not a public React export.
import {AiTextControl} from '@miniextensions/sdk/react';
// @ts-expect-error Internal files are not package export paths.
import {AiTextField as privateField} from '@miniextensions/sdk/react/AiTextField';
export const renderers:FieldRendererSlots<ReactNode>={renderAiTextField:props=>renderAiTextField(props,options)};
export function Bound(props:AiTextFieldProps):ReactNode {return createElement(AiTextField,{...props,...options});}
export function Override(props:AiTextFieldProps):ReactNode {return createElement(AiTextField,{...props,render:({snapshot})=>String(snapshot.retired)});}
export function Native(props:FieldRendererProps<'aiText'>,plain:FieldRendererProps<'multilineText'>,formula:FieldRendererProps<'formula'>,rich:FieldRendererProps<'richText'>) {
 const native:{state:'empty'|'loading'|'generated'|'error';value:string;isStale:boolean;errorType?:string}|null|undefined=props.value;
 const supplied:FieldRendererProps<'aiText'>['value']={state:'generated',value:'  **Literal**\\r\\n[link](https://example.invalid)  ',isStale:false};
 const empty:FieldRendererProps<'aiText'>['value']={state:'empty',value:'',isStale:true};
 const loading:FieldRendererProps<'aiText'>['value']={state:'loading',value:'Supplied',isStale:false};
 const error:FieldRendererProps<'aiText'>['value']={state:'error',value:'Supplied',isStale:true,errorType:'synthetic'};
 const nullValue:FieldRendererProps<'aiText'>['value']=null;
 const missing:FieldRendererProps<'aiText'>['value']=undefined;
 const capability:FieldRendererProps<'aiText'>['capability']={type:'readonly'};
 // @ts-expect-error Computed AI Text cannot receive an editable capability.
 const editable:FieldRendererProps<'aiText'>['capability']={type:'editable',setValue:()=>({accepted:true})};
 // @ts-expect-error Multiline Text is a different physical slot.
 renderAiTextField(plain);
 // @ts-expect-error Formula results do not change the physical slot.
 renderAiTextField(formula);
 // @ts-expect-error Rich Text retains its native string.
 renderAiTextField(rich);
 // @ts-expect-error AI Text is a native object, not a scalar string.
 const string:FieldRendererProps<'aiText'>['value']='text';
 // @ts-expect-error The runtime contract requires boolean isStale.
 const noStale:FieldRendererProps<'aiText'>['value']={state:'generated',value:'text'};
 // @ts-expect-error Staleness does not accept a string flag.
 const wrongStale:FieldRendererProps<'aiText'>['value']={state:'generated',value:'text',isStale:'true'};
 // @ts-expect-error Native state is restricted to the existing runtime states.
 const wrongState:FieldRendererProps<'aiText'>['value']={state:'complete',value:'text',isStale:false};
 // @ts-expect-error Supplied values are strings even for empty states.
 const noValue:FieldRendererProps<'aiText'>['value']={state:'empty',isStale:false};
 // @ts-expect-error AI Text does not coerce numbers.
 const number:FieldRendererProps<'aiText'>['value']={state:'generated',value:1,isStale:false};
 // @ts-expect-error Optional errorType must remain a string.
 const wrongError:FieldRendererProps<'aiText'>['value']={state:'error',value:'',isStale:false,errorType:1};
 return {native,supplied,empty,loading,error,nullValue,missing,capability};
}
${
    jsx
        ? `
import {AirtableForm,AirtableGrid,AirtableList} from '@miniextensions/sdk/react';
import type {FormRenderScope,PortalRenderScope} from '@miniextensions/sdk/ui';
export function JSX(props:AiTextFieldProps) {return <AiTextField {...props} className="literal-ai-text"/>;}
export function CustomJSX(props:AiTextFieldProps) {return <AiTextField {...props} render={({snapshot})=><span>{String(snapshot.retired)}</span>}/>;}
// @ts-expect-error JSX grants no editing callback.
export function InvalidJSX(props:AiTextFieldProps) {return <AiTextField {...props} onChange={()=>{}}/>;}
export function Compositions({form,portal}:{form:FormRenderScope;portal:PortalRenderScope}) {return <>
 <AirtableForm scope={form} renderers={renderers}>{state=>state.fields.map(field=>field.node)}</AirtableForm>
 <AirtableGrid scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableGrid>
 <AirtableList scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableList>
 </>;}
`
        : ''
}
`;
}

export const aiTextNodeTypedConsumer = aiTextTypedConsumer();
export const aiTextReactTypedConsumer = aiTextTypedConsumer({ jsx: true });

/**
 * Test ESM/CJS with accepted Form/Portal owners from an installed SDK package.
 * Before shared export integration, choose direct-module explicitly and supply
 * absolute built-module paths. This does not verify the public React exports.
 */
export async function checkAiTextConsumer({
    consumerDirectory,
    happyDomModulePath,
    mode = 'public-export',
    modulePaths,
}) {
    assert(['direct-module', 'public-export'].includes(mode));
    if (mode === 'direct-module')
        for (const format of ['esm', 'cjs'])
            assert(
                modulePaths?.[format] && isAbsolute(modulePaths[format]),
                `Direct-module mode requires an absolute ${format} module path`
            );
    else
        assert.equal(
            modulePaths,
            undefined,
            'Public mode uses package exports'
        );
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let network = 0;
    window.fetch = () => {
        network++;
        throw Error('AI Text presentation must not fetch');
    };
    const globals = [
        'window',
        'document',
        'navigator',
        'fetch',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const originals = globals.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of globals)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const { createElement: h, act, StrictMode, Fragment } = require('react');
    const { createRoot } = require('react-dom/client');
    const forbidden =
        'input,textarea,select,button,a,img,canvas,video,audio,iframe,object,embed,svg,strong,b,em,pre,code,[contenteditable=true]';
    let checks = 0;
    const formats = [];
    const temporary = mkdtempSync(
        join(consumerDirectory, '.ai-text-consumer-')
    );
    const esmLoader = join(temporary, 'public-imports.mjs');
    try {
        writeFileSync(
            esmLoader,
            `
import * as core from '@miniextensions/sdk';
import * as forms from '@miniextensions/sdk/forms';
import * as portals from '@miniextensions/sdk/portals';
import * as ui from '@miniextensions/sdk/ui';
import * as react from '@miniextensions/sdk/react';
export {core, forms, portals, ui, react};
export const importPackage = (name) => import(name);
`
        );
        for (const format of ['esm', 'cjs']) {
            const { core, forms, portals, ui, react, importPackage } =
                format === 'esm'
                    ? await import(pathToFileURL(esmLoader))
                    : {
                          core: require('@miniextensions/sdk'),
                          forms: require('@miniextensions/sdk/forms'),
                          portals: require('@miniextensions/sdk/portals'),
                          ui: require('@miniextensions/sdk/ui'),
                          react: require('@miniextensions/sdk/react'),
                      };
            const renderer =
                mode === 'public-export'
                    ? react
                    : format === 'esm'
                      ? await import(pathToFileURL(modulePaths.esm))
                      : require(modulePaths.cjs);
            assert.equal(typeof renderer.AiTextField, 'function');
            assert.equal(typeof renderer.renderAiTextField, 'function');
            for (const namespace of [core, forms, portals, ui]) {
                assert.equal(namespace.AiTextField, undefined);
                assert.equal(namespace.renderAiTextField, undefined);
            }
            assert.equal(renderer.AiTextControl, undefined);
            for (const subpath of [
                'react/AiTextField',
                `dist/${format}/react/AiTextField.js`,
            ]) {
                const name = `@miniextensions/sdk/${subpath}`;
                if (format === 'esm')
                    await assert.rejects(importPackage(name), {
                        code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
                    });
                else
                    assert.throws(() => require(name), {
                        code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
                    });
            }
            checks++;
            const { loaded, expected } = aiTextLoadedFixture();
            let writes = 0,
                saves = 0,
                rowEvents = 0,
                protectedReads = 0,
                sourceProps;
            const bindingOptions = {
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            saves++;
                            throw Error('No display saves');
                        },
                    },
                },
                getScope: () => ({
                    ownerId: 'ai-text-consumer',
                    revision: 0,
                }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            };
            const fields = forms.createFormFieldBindings({
                loaded,
                ...bindingOptions,
            });
            const scope = ui.createFormRenderScope({
                fields,
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            const binding = fields.field('source');
            const before = structuredClone(fields.controller.getState());
            binding.setValue = () => {
                writes++;
                throw Error('No display setter');
            };
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const cleanup = [];
            const output = () => container.querySelector('output');
            const isolate = (node) =>
                h(
                    'div',
                    Object.fromEntries(
                        [
                            'onClick',
                            'onAuxClick',
                            'onDoubleClick',
                            'onPointerDown',
                            'onKeyDown',
                            'onKeyUp',
                        ].map((event) => [event, () => rowEvents++])
                    ),
                    node
                );
            const fire = async (node) =>
                act(async () => {
                    for (const type of [
                        'click',
                        'auxclick',
                        'dblclick',
                        'pointerdown',
                        'keydown',
                        'keyup',
                    ]) {
                        const event = new window.Event(type, {
                            bubbles: true,
                            cancelable: true,
                        });
                        node.dispatchEvent(event);
                        assert.equal(event.defaultPrevented, false);
                    }
                });
            const renderers = {
                renderAiTextField: (props) => {
                    if (props.fieldId === 'source') sourceProps = props;
                    return h(
                        'section',
                        { 'data-field': props.fieldId },
                        renderer.renderAiTextField(props)
                    );
                },
            };
            const poison = () => {
                protectedReads++;
                throw Error('Private native value or write action was read');
            };
            try {
                await act(async () =>
                    root.render(
                        h(
                            StrictMode,
                            null,
                            isolate(
                                h(
                                    react.AirtableForm,
                                    { scope, renderers },
                                    (state) =>
                                        state.fields.map((field) => field.node)
                                )
                            )
                        )
                    )
                );
                for (const [id, text] of expected) {
                    const node = container.querySelector(
                        `[data-field="${id}"] output`
                    );
                    assert(node, `${format}: accepted Form AI Text ${id}`);
                    assert.equal(node.textContent, text);
                    assert.equal(node.style.whiteSpace, 'pre-wrap');
                    assert.equal(node.getAttribute('aria-invalid'), 'false');
                    // Native loading/error/stale flags do not invent host status.
                    assert.equal(node.getAttribute('aria-busy'), 'false');
                    assert(container.querySelector(`label[for="${node.id}"]`));
                    assert.deepEqual(
                        fields.field(id).getSnapshot().value,
                        loaded.payload.formRecord.data[id]
                    );
                    checks++;
                }
                assert.equal(container.querySelector(forbidden), null);
                assert.equal(container.innerHTML.includes('PRIVATE_'), false);
                assert.deepEqual(sourceProps.capability, {
                    type: 'readonly',
                });
                assert.equal(binding.getSnapshot().canEdit, false);
                await fire(output());
                assert.equal(rowEvents, 0);
                assert.deepEqual(fields.controller.getState(), before);
                checks++;

                for (const value of [
                    0,
                    false,
                    [],
                    {},
                    'plain string',
                    { state: 'generated', value: 'text' },
                    { state: 'unknown', value: 'text', isStale: false },
                    { state: 'generated', value: 1, isStale: false },
                    { state: 'empty', value: null, isStale: false },
                    { state: 'generated', value: 'text', isStale: 'false' },
                    { state: 'error', value: '', isStale: false, errorType: 1 },
                    {
                        state: new String('generated'),
                        value: 'text',
                        isStale: false,
                    },
                    Object.assign(Object.create({ inherited: true }), {
                        state: 'generated',
                        value: 'text',
                        isStale: false,
                    }),
                    new String('text'),
                    Symbol('text'),
                    new Proxy(
                        {},
                        {
                            get() {
                                throw Error('Malformed direct native getter');
                            },
                        }
                    ),
                    {
                        state: 'generated',
                        get value() {
                            throw Error('Malformed text getter');
                        },
                        isStale: false,
                    },
                ]) {
                    await act(async () =>
                        root.render(
                            renderer.renderAiTextField({
                                ...sourceProps,
                                value,
                            })
                        )
                    );
                    assert.equal(output().textContent, 'Unavailable');
                    assert.equal(output().getAttribute('aria-invalid'), 'true');
                    assert.equal(container.querySelector(forbidden), null);
                    checks++;
                }
                const unreadable = { ...sourceProps };
                Object.defineProperty(unreadable, 'value', {
                    get() {
                        throw Error('Malformed native reference');
                    },
                });
                await act(async () =>
                    root.render(renderer.renderAiTextField(unreadable))
                );
                assert.equal(output().textContent, 'Unavailable');
                assert.equal(output().getAttribute('aria-invalid'), 'true');
                checks++;
                for (const side of ['displayConfig', 'writeConfig'])
                    for (const flag of [
                        'obscurePassword',
                        'maskPasswordOnLoginScreen',
                    ]) {
                        const props = {
                            ...sourceProps,
                            displayConfig: { showTitle: false, [flag]: false },
                            writeConfig: { [flag]: false },
                            [side]: { showTitle: false, [flag]: true },
                        };
                        Object.defineProperties(props, {
                            value: { get: poison },
                            capability: { get: poison },
                        });
                        await act(async () =>
                            root.render(renderer.renderAiTextField(props))
                        );
                        assert.equal(output().textContent, mask);
                        assert.equal(
                            output().getAttribute('aria-label'),
                            'AI text'
                        );
                        assert.equal(protectedReads, 0);
                        checks++;
                        const nativeMasked = {
                            ...sourceProps,
                            displayConfig: props.displayConfig,
                            writeConfig: props.writeConfig,
                            value: new Proxy({}, { get: poison }),
                        };
                        await act(async () =>
                            root.render(
                                renderer.renderAiTextField(nativeMasked)
                            )
                        );
                        assert.equal(output().textContent, mask);
                        assert.equal(protectedReads, 0);
                        checks++;
                    }
                const noActions = { ...sourceProps };
                Object.defineProperty(noActions, 'capability', { get: poison });
                await act(async () =>
                    root.render(renderer.renderAiTextField(noActions))
                );
                assert.equal(output().textContent, expected[0][1]);
                assert.equal(protectedReads, 0);
                checks++;
                const uninterpreted = {
                    state: 'generated',
                    value: '  Supplied literal\n<em>text</em>  ',
                    isStale: true,
                    errorType: 'PRIVATE_NONSTATUS',
                };
                for (const key of ['prompt', 'references', 'generate', 'retry'])
                    Object.defineProperty(uninterpreted, key, { get: poison });
                await act(async () =>
                    root.render(
                        renderer.renderAiTextField(
                            { ...sourceProps, value: uninterpreted },
                            { className: 'consumer-class' }
                        )
                    )
                );
                assert.equal(output().textContent, uninterpreted.value);
                assert.equal(output().getAttribute('aria-busy'), 'false');
                assert.equal(output().getAttribute('aria-invalid'), 'false');
                assert(container.querySelector('.consumer-class'));
                assert.equal(container.innerHTML.includes('PRIVATE_'), false);
                assert.equal(container.querySelector(forbidden), null);
                assert.equal(protectedReads, 0);
                checks++;

                // AI metadata is under Airtable config.options, not the native value.
                for (const metadata of ['options-getter', 'nested-getters']) {
                    const config = { type: 'aiText' };
                    if (metadata === 'options-getter')
                        Object.defineProperty(config, 'options', {
                            get: poison,
                        });
                    else {
                        const options = {};
                        for (const key of ['prompt', 'referencedFieldIds'])
                            Object.defineProperty(options, key, {
                                get: poison,
                            });
                        config.options = options;
                    }
                    await act(async () =>
                        root.render(
                            renderer.renderAiTextField({
                                ...sourceProps,
                                field: { ...sourceProps.field, config },
                            })
                        )
                    );
                    assert.equal(output().textContent, expected[0][1]);
                    assert.equal(
                        output().getAttribute('aria-invalid'),
                        'false'
                    );
                    assert.equal(protectedReads, 0);
                    checks++;
                    const accepted = binding.getSnapshot();
                    const snapshot = {
                        ...accepted,
                        field: {
                            ...accepted.field,
                            schema: {
                                ...accepted.field.schema,
                                airtableField: {
                                    ...accepted.field.schema.airtableField,
                                    config,
                                },
                            },
                        },
                    };
                    await act(async () =>
                        root.render(
                            h(renderer.AiTextField, {
                                key: `metadata-${metadata}`,
                                binding: {
                                    ...binding,
                                    getSnapshot: () => snapshot,
                                    subscribe: () => () => {},
                                },
                            })
                        )
                    );
                    assert.equal(output().textContent, expected[0][1]);
                    assert.equal(
                        output().getAttribute('aria-invalid'),
                        'false'
                    );
                    assert.equal(protectedReads, 0);
                    checks++;
                }

                await act(async () =>
                    root.render(
                        renderer.renderAiTextField({
                            ...sourceProps,
                            pending: true,
                            error: '<b>feedback</b>',
                            displayConfig: { showTitle: false },
                        })
                    )
                );
                assert.equal(output().getAttribute('aria-busy'), 'true');
                assert.equal(output().getAttribute('aria-invalid'), 'true');
                assert.equal(
                    window.document.getElementById(
                        output().getAttribute('aria-describedby')
                    ).textContent,
                    '<b>feedback</b>'
                );
                assert.equal(container.querySelector('b'), null);
                await act(async () =>
                    root.render(
                        h(
                            Fragment,
                            null,
                            renderer.renderAiTextField(sourceProps),
                            renderer.renderAiTextField(sourceProps)
                        )
                    )
                );
                const outputs = [...container.querySelectorAll('output')];
                assert.equal(new Set(outputs.map((node) => node.id)).size, 2);
                for (const node of outputs)
                    assert(container.querySelector(`label[for="${node.id}"]`));
                checks++;

                await act(async () =>
                    root.render(isolate(h(renderer.AiTextField, { binding })))
                );
                assert.equal(output().textContent, expected[0][1]);
                await fire(output());
                assert.equal(rowEvents, 0);
                const noWriteBinding = {
                    ...binding,
                    getSnapshot: () => binding.getSnapshot(),
                    subscribe: () => () => {},
                };
                for (const key of [
                    'setValue',
                    'selection',
                    'choices',
                    'generate',
                    'retry',
                    'prompt',
                    'references',
                ])
                    Object.defineProperty(noWriteBinding, key, { get: poison });
                await act(async () =>
                    root.render(
                        h(renderer.AiTextField, {
                            key: 'no-actions',
                            binding: noWriteBinding,
                        })
                    )
                );
                assert.equal(output().textContent, expected[0][1]);
                assert.equal(protectedReads, 0);
                checks++;
                for (const [key, properties] of [
                    [
                        'hidden',
                        { visibility: { type: 'hidden', diagnostics: [] } },
                    ],
                    [
                        'blocked',
                        {
                            visibility: {
                                type: 'blocked',
                                code: 'invalid',
                                diagnostics: [],
                            },
                        },
                    ],
                    ['retired', { retired: true }],
                ]) {
                    const snapshot = {
                        ...binding.getSnapshot(),
                        ...properties,
                    };
                    Object.defineProperties(snapshot, {
                        value: { get: poison },
                        field: { get: poison },
                    });
                    const hidden = {
                        ...binding,
                        getSnapshot: () => snapshot,
                        subscribe: () => () => {},
                    };
                    await act(async () =>
                        root.render(
                            h(renderer.AiTextField, { key, binding: hidden })
                        )
                    );
                    assert.equal(output(), null);
                    assert.equal(protectedReads, 0);
                    checks++;
                    await act(async () =>
                        root.render(
                            h(renderer.AiTextField, {
                                key: `${key}-custom`,
                                binding: hidden,
                                render: () =>
                                    h(
                                        'span',
                                        { 'data-custom': key },
                                        'Custom presentation'
                                    ),
                            })
                        )
                    );
                    assert.equal(
                        container.querySelector('[data-custom]').textContent,
                        'Custom presentation'
                    );
                    assert.equal(output(), null);
                    assert.equal(protectedReads, 0);
                    checks++;
                }
                const wrongSnapshot = {
                    ...binding.getSnapshot(),
                    field: {
                        ...binding.getSnapshot().field,
                        schema: {
                            ...binding.getSnapshot().field.schema,
                            fieldType: 'richText',
                        },
                    },
                };
                Object.defineProperty(wrongSnapshot, 'value', { get: poison });
                await act(async () =>
                    root.render(
                        h(renderer.AiTextField, {
                            key: 'wrong-physical-kind',
                            binding: {
                                ...binding,
                                getSnapshot: () => wrongSnapshot,
                                subscribe: () => () => {},
                            },
                        })
                    )
                );
                assert.equal(output(), null);
                assert.match(container.textContent, /supports AI Text/);
                assert.equal(protectedReads, 0);
                checks++;
                const malformedSnapshot = {
                    ...binding.getSnapshot(),
                    value: 'unaccepted scalar',
                };
                await act(async () =>
                    root.render(
                        h(renderer.AiTextField, {
                            key: 'malformed-native',
                            binding: {
                                ...binding,
                                getSnapshot: () => malformedSnapshot,
                                subscribe: () => () => {},
                            },
                        })
                    )
                );
                assert.equal(output().textContent, 'Unavailable');
                assert.equal(output().getAttribute('aria-invalid'), 'true');
                checks++;
                const maskedSnapshot = {
                    ...fields.field('masked').getSnapshot(),
                };
                Object.defineProperty(maskedSnapshot, 'value', { get: poison });
                const maskedBinding = {
                    ...binding,
                    getSnapshot: () => maskedSnapshot,
                    subscribe: () => () => {},
                };
                Object.defineProperty(maskedBinding, 'setValue', {
                    get: poison,
                });
                await act(async () =>
                    root.render(
                        h(renderer.AiTextField, {
                            key: 'masked',
                            binding: maskedBinding,
                        })
                    )
                );
                assert.equal(output().textContent, mask);
                assert.equal(protectedReads, 0);
                checks++;

                const portal = fixtures.makePortal();
                const sourceField =
                    loaded.payload.fieldIdsToSchemas.source.airtableField;
                const native = loaded.payload.formRecord.data.source;
                portal.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [sourceField];
                const details = [
                    {
                        fieldId: 'source',
                        fieldName: 'AI text',
                        titleOverride: null,
                        isHidden: false,
                        fieldIsInEditingChildForm: false,
                        childFormField: null,
                        miniExtConfig: {},
                    },
                ];
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children =
                    details;
                let reads = 0;
                const record = {
                    id: 'rec_rich_text',
                    fields: { source: native },
                };
                const portalClient = {
                    getSession: () => ({}),
                    portals: {
                        listLinkedRecords: async () => {
                            reads++;
                            return fixtures.page([record], null, {
                                customViewDetailFields: {
                                    fld_children: details,
                                },
                                tableIdsToLinkedTableStates: {
                                    tbl_children: {
                                        airtableFields: [sourceField],
                                        recordIdsToAirtableRecords: {
                                            rec_rich_text: record,
                                        },
                                    },
                                },
                            });
                        },
                        updateGridCell: async () => {
                            writes++;
                            throw Error('No display writes');
                        },
                    },
                };
                const owner = portals.createPortalListOwner({
                    client: portalClient,
                    portal,
                    portalFieldId: 'fld_children',
                    criteria: {
                        selectedCustomViewId: 'view_example',
                        searchTerm: null,
                        searchParamsMap: {},
                        sortFieldsByEndUser: null,
                        filtersByEndUser: null,
                        supportsEndUserSortCleanup: true,
                        supportsEndUserFilterCleanup: true,
                    },
                    getScope: () => ({
                        ownerId: 'ai-text-portal',
                        revision: 0,
                    }),
                });
                cleanup.push(() => owner.destroy());
                const portalScope = ui.createPortalRenderScope({
                    owner,
                    client: portalClient,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                cleanup.push(() => portalScope.destroy());
                assert.equal(
                    await portalScope.getSnapshot().actions.load({
                        pagesToFetch: 1,
                        refreshLoggedInPortalRecord: false,
                    }),
                    true
                );
                for (const Component of [
                    react.AirtableGrid,
                    react.AirtableList,
                ]) {
                    await act(async () =>
                        root.render(
                            h(
                                StrictMode,
                                null,
                                isolate(
                                    h(
                                        Component,
                                        {
                                            scope: portalScope,
                                            renderers: {
                                                renderAiTextField:
                                                    renderer.renderAiTextField,
                                            },
                                        },
                                        (state) =>
                                            state.rows.flatMap((row) =>
                                                row.cells.map(
                                                    (cell) => cell.node
                                                )
                                            )
                                    )
                                )
                            )
                        )
                    );
                    assert.equal(output().textContent, native.value);
                    assert.deepEqual(
                        portalScope
                            .getSnapshot()
                            .rows[0].cells[0].host.getSnapshot().fields[0]
                            .capability,
                        { type: 'readonly' }
                    );
                    assert.equal(container.querySelector(forbidden), null);
                    await fire(output());
                    assert.equal(rowEvents, 0);
                    assert.equal(reads, 1);
                    assert.deepEqual(
                        portalScope
                            .getSnapshot()
                            .rows[0].cells[0].host.getSnapshot().fields[0]
                            .value,
                        native
                    );
                    checks++;
                }
                await act(async () => owner.destroy());
                assert.equal(output(), null);
                await act(async () =>
                    root.render(h(renderer.AiTextField, { binding }))
                );
                assert.equal(output().textContent, expected[0][1]);
                assert.deepEqual(fields.controller.getState(), before);
                await act(async () => fields.destroy());
                assert.equal(output(), null);
                assert.equal(writes, 0);
                assert.equal(saves, 0);
                assert.equal(network, 0);
                assert.equal(protectedReads, 0);
                checks++;
                formats.push({
                    format,
                    rendererModule:
                        mode === 'public-export'
                            ? '@miniextensions/sdk/react'
                            : resolve(modulePaths[format]),
                    writes,
                    saves,
                    network,
                    rowEvents,
                    protectedReads,
                    ownerReads: reads,
                });
            } finally {
                await act(async () => root.unmount());
                for (const dispose of cleanup.reverse()) dispose();
                scope.destroy();
                fields.destroy();
                container.remove();
            }
        }
        assert.equal(checks, aiTextConsumerCheckCount);
        return {
            mode,
            publicExportVerified: mode === 'public-export',
            checks,
            formats,
        };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
        globals.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
