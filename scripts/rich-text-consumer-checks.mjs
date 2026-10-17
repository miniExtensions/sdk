import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const mask = '••••••••';
export const richTextConsumerCheckCount = 62;

/** Accepted synthetic native strings, shared by package and browser proofs. */
export function richTextLoadedFixture() {
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
    const data = [
        ['source', '**Literal bold**\n  [a link](https://example.invalid)  Ω'],
        ['text', '<img src="https://secret.invalid/image">\n  **literal** Ω  '],
        ['url', 'https://example.invalid/supplied'],
        ['spacing', '  leading\t tab\r\nCRLF\ntrailing  '],
        ['blank', ''],
        ['null', null],
        ['missing', undefined],
        ['masked', 'PRIVATE_MASKED_RICH_TEXT'],
    ];
    loaded.payload.fieldIdsInForm = data.map(([id]) => id);
    for (const [id, value] of data) {
        if (value === undefined) delete loaded.payload.formRecord.data[id];
        else loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'richText',
            airtableField: {
                id,
                name: id === 'source' ? 'Rich text' : id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: { type: 'richText', options: null },
            },
            miniExtConfig: id === 'masked' ? { obscurePassword: true } : {},
        };
    }
    return {
        loaded,
        expected: data.map(([id, value]) => [
            id,
            id === 'masked' ? mask : (value ?? ''),
        ]),
    };
}

/**
 * Strict NodeNext/JSX declarations. Direct-module imports verify the dedicated
 * declaration file only; public-export mode verifies the supported React API.
 */
export function richTextTypedConsumer({
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
import {RichTextField,renderRichTextField,type RichTextFieldProps,type RichTextFieldOptions} from ${JSON.stringify(source)};
import type {FieldRendererProps,FieldRendererSlots} from '@miniextensions/sdk/ui';
const options:RichTextFieldOptions={className:'literal-rich-text'};
// @ts-expect-error Display options grant no setter.
const write:RichTextFieldOptions={setValue:()=>{}};
// @ts-expect-error No editor or clear action is introduced.
const clear:RichTextFieldOptions={clearLabel:'Clear'};
// @ts-expect-error This stage does not parse Markdown.
const parser:RichTextFieldOptions={parseMarkdown:(value:string)=>value};
// @ts-expect-error Native Markdown is not normalized or stripped.
const normalize:RichTextFieldOptions={normalize:(value:string)=>value};
// @ts-expect-error Supplied links remain literal strings.
const link:RichTextFieldOptions={href:'https://example.invalid'};
// @ts-expect-error Resource loading is not part of display options.
const image:RichTextFieldOptions={loadImage:()=>{}};
// @ts-expect-error The component is not a core export.
import {RichTextField as coreField} from '@miniextensions/sdk';
// @ts-expect-error The renderer is not a headless UI export.
import {renderRichTextField as headlessRenderer} from '@miniextensions/sdk/ui';
// @ts-expect-error The internal control is not a public React export.
import {RichTextControl} from '@miniextensions/sdk/react';
// @ts-expect-error Internal files are not package export paths.
import {RichTextField as privateField} from '@miniextensions/sdk/react/RichTextField';
export const renderers:FieldRendererSlots<ReactNode>={renderRichTextField:props=>renderRichTextField(props,options)};
export function Bound(props:RichTextFieldProps):ReactNode {return createElement(RichTextField,{...props,...options});}
export function Override(props:RichTextFieldProps):ReactNode {return createElement(RichTextField,{...props,render:({snapshot})=>String(snapshot.retired)});}
export function Native(props:FieldRendererProps<'richText'>,plain:FieldRendererProps<'multilineText'>,formula:FieldRendererProps<'formula'>,ai:FieldRendererProps<'aiText'>) {
 const native:string|null|undefined=props.value;
 const supplied:FieldRendererProps<'richText'>['value']='  **Literal**\\r\\n[link](https://example.invalid)  ';
 const empty:FieldRendererProps<'richText'>['value']='';
 const nullValue:FieldRendererProps<'richText'>['value']=null;
 const missing:FieldRendererProps<'richText'>['value']=undefined;
 // Display coverage must not narrow the existing editable native-string contract.
 const capability:FieldRendererProps<'richText'>['capability']={type:'editable',setValue:value=>({accepted:true})};
 // @ts-expect-error Multiline Text is a different physical slot.
 renderRichTextField(plain);
 // @ts-expect-error Formula results do not change the physical slot.
 renderRichTextField(formula);
 // @ts-expect-error AI Text retains its native state/value object.
 renderRichTextField(ai);
 // @ts-expect-error Rich Text is a native string, not a Markdown object.
 const object:FieldRendererProps<'richText'>['value']={text:'**text**'};
 // @ts-expect-error Rich Text is not a string array.
 const array:FieldRendererProps<'richText'>['value']=['text'];
 // @ts-expect-error Rich Text does not coerce numbers.
 const number:FieldRendererProps<'richText'>['value']=1;
 return {native,supplied,empty,nullValue,missing,capability};
}
${
    jsx
        ? `
import {AirtableForm,AirtableGrid,AirtableList} from '@miniextensions/sdk/react';
import type {FormRenderScope,PortalRenderScope} from '@miniextensions/sdk/ui';
export function JSX(props:RichTextFieldProps) {return <RichTextField {...props} className="literal-rich-text"/>;}
export function CustomJSX(props:RichTextFieldProps) {return <RichTextField {...props} render={({snapshot})=><span>{String(snapshot.retired)}</span>}/>;}
// @ts-expect-error JSX grants no editing callback.
export function InvalidJSX(props:RichTextFieldProps) {return <RichTextField {...props} onChange={()=>{}}/>;}
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

export const richTextNodeTypedConsumer = richTextTypedConsumer();
export const richTextReactTypedConsumer = richTextTypedConsumer({ jsx: true });

/**
 * Test ESM/CJS with accepted Form/Portal owners from an installed SDK package.
 * Before shared export integration, choose direct-module explicitly and supply
 * absolute built-module paths. This does not verify the public React exports.
 */
export async function checkRichTextConsumer({
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
        throw Error('Rich Text presentation must not fetch');
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
        join(consumerDirectory, '.rich-text-consumer-')
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
            assert.equal(typeof renderer.RichTextField, 'function');
            assert.equal(typeof renderer.renderRichTextField, 'function');
            for (const namespace of [core, forms, portals, ui]) {
                assert.equal(namespace.RichTextField, undefined);
                assert.equal(namespace.renderRichTextField, undefined);
            }
            assert.equal(renderer.RichTextControl, undefined);
            for (const subpath of [
                'react/RichTextField',
                `dist/${format}/react/RichTextField.js`,
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
            const { loaded, expected } = richTextLoadedFixture();
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
                    ownerId: 'rich-text-consumer',
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
                    ])
                        node.dispatchEvent(
                            new window.Event(type, { bubbles: true })
                        );
                });
            const renderers = {
                renderRichTextField: (props) => {
                    if (props.fieldId === 'source') sourceProps = props;
                    return h(
                        'section',
                        { 'data-field': props.fieldId },
                        renderer.renderRichTextField(props)
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
                    assert(node, `${format}: accepted Form Rich Text ${id}`);
                    assert.equal(node.textContent, text);
                    assert.equal(node.style.whiteSpace, 'pre-wrap');
                    assert.equal(node.getAttribute('aria-invalid'), 'false');
                    assert(container.querySelector(`label[for="${node.id}"]`));
                    assert.equal(
                        fields.field(id).getSnapshot().value,
                        loaded.payload.formRecord.data[id]
                    );
                    checks++;
                }
                assert.equal(container.querySelector(forbidden), null);
                assert.equal(container.innerHTML.includes('PRIVATE_'), false);
                assert.equal(sourceProps.capability.type, 'editable');
                assert.equal(binding.getSnapshot().canEdit, true);
                await fire(output());
                assert.equal(rowEvents, 0);
                assert.deepEqual(fields.controller.getState(), before);
                checks++;

                for (const value of [
                    0,
                    false,
                    [],
                    {},
                    { text: '**text**' },
                    new String('text'),
                    Symbol('text'),
                ]) {
                    await act(async () =>
                        root.render(
                            renderer.renderRichTextField({
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
                            root.render(renderer.renderRichTextField(props))
                        );
                        assert.equal(output().textContent, mask);
                        assert.equal(
                            output().getAttribute('aria-label'),
                            'Rich text'
                        );
                        assert.equal(protectedReads, 0);
                        checks++;
                    }
                const noActions = { ...sourceProps };
                Object.defineProperty(noActions, 'capability', { get: poison });
                await act(async () =>
                    root.render(renderer.renderRichTextField(noActions))
                );
                assert.equal(output().textContent, expected[0][1]);
                assert.equal(protectedReads, 0);
                checks++;

                await act(async () =>
                    root.render(
                        renderer.renderRichTextField({
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
                            renderer.renderRichTextField(sourceProps),
                            renderer.renderRichTextField(sourceProps)
                        )
                    )
                );
                const outputs = [...container.querySelectorAll('output')];
                assert.equal(new Set(outputs.map((node) => node.id)).size, 2);
                for (const node of outputs)
                    assert(container.querySelector(`label[for="${node.id}"]`));
                checks++;

                await act(async () =>
                    root.render(isolate(h(renderer.RichTextField, { binding })))
                );
                assert.equal(output().textContent, expected[0][1]);
                await fire(output());
                assert.equal(rowEvents, 0);
                const noWriteBinding = {
                    ...binding,
                    getSnapshot: () => binding.getSnapshot(),
                    subscribe: () => () => {},
                };
                for (const key of ['setValue', 'selection', 'choices'])
                    Object.defineProperty(noWriteBinding, key, { get: poison });
                await act(async () =>
                    root.render(
                        h(renderer.RichTextField, {
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
                            h(renderer.RichTextField, { key, binding: hidden })
                        )
                    );
                    assert.equal(output(), null);
                    assert.equal(protectedReads, 0);
                    checks++;
                }
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
                        h(renderer.RichTextField, {
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
                        fieldName: 'Rich text',
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
                        ownerId: 'rich-text-portal',
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
                                                renderRichTextField:
                                                    renderer.renderRichTextField,
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
                    assert.equal(output().textContent, native);
                    assert.equal(container.querySelector(forbidden), null);
                    await fire(output());
                    assert.equal(rowEvents, 0);
                    assert.equal(reads, 1);
                    assert.equal(
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
                    root.render(h(renderer.RichTextField, { binding }))
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
        assert.equal(checks, richTextConsumerCheckCount);
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
