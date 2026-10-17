import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const multipleCollaboratorsConsumerCheckCount = 86;
const mask = '••••••••';

/** Synthetic accepted native values shared with the dedicated browser proof. */
export function multipleCollaboratorsLoadedFixture() {
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
    const collaborator = (id, name, extra = {}) => ({
        id,
        email: `${id}@example.invalid`,
        name,
        ...extra,
    });
    const literal =
        '<img src="https://secret.invalid/image">\n  **literal** Ω  ';
    const data = [
        [
            'source',
            [
                collaborator('duplicate', 'Ada Lovelace', {
                    profilePicUrl: 'https://private.invalid/avatar',
                    suppliedMetadata: { preserved: true },
                }),
                collaborator('duplicate', 'Grace Hopper'),
                collaborator('blank-name', ''),
                collaborator('spacing', '  Ω\n '),
                collaborator('duplicate', 'Ada Lovelace'),
            ],
            'Ada Lovelace, Grace Hopper, ,   Ω\n , Ada Lovelace',
        ],
        ['text', [collaborator('literal', literal)], literal],
        [
            'url',
            [collaborator('url', 'https://example.invalid/supplied')],
            'https://example.invalid/supplied',
        ],
        ['blank', [collaborator('blank', '')], ''],
        ['empty', [], ''],
        ['null', null, ''],
        ['missing', undefined, ''],
        ['masked', [collaborator('PRIVATE_ID', 'PRIVATE_NAME')], mask],
    ];
    loaded.payload.fieldIdsInForm = data.map(([id]) => id);
    for (const [id, value] of data) {
        if (value === undefined) delete loaded.payload.formRecord.data[id];
        else loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'multipleCollaborators',
            airtableField: {
                id,
                name: id === 'source' ? 'Collaborators' : id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'multipleCollaborators',
                    options: { choices: [] },
                },
            },
            miniExtConfig: id === 'masked' ? { obscurePassword: true } : {},
        };
    }
    return { loaded, expected: data.map(([id, , text]) => [id, text]) };
}

/** Public declarations without JSX, for strict NodeNext .mts/.cts checks. */
export const multipleCollaboratorsNodeTypedConsumer = `
import {createElement,type ReactNode} from 'react';
import {MultipleCollaboratorsField,renderMultipleCollaboratorsField,type MultipleCollaboratorsFieldProps,type MultipleCollaboratorsFieldOptions} from '@miniextensions/sdk/react';
import type {FieldRendererProps,FieldRendererSlots} from '@miniextensions/sdk/ui';
const options:MultipleCollaboratorsFieldOptions={className:'collaborators'};
// @ts-expect-error Display options grant no setter.
const write:MultipleCollaboratorsFieldOptions={setValue:()=>{}};
// @ts-expect-error No picker or clear action is introduced.
const clear:MultipleCollaboratorsFieldOptions={clearLabel:'Clear'};
// @ts-expect-error No identity lookup is introduced.
const lookup:MultipleCollaboratorsFieldOptions={lookupUser:()=>{}};
// @ts-expect-error No avatar loading is introduced.
const avatar:MultipleCollaboratorsFieldOptions={showAvatar:true};
// @ts-expect-error Empty supplied names have no email fallback.
const fallback:MultipleCollaboratorsFieldOptions={emailFallback:true};
// @ts-expect-error No normalization is introduced.
const normalize:MultipleCollaboratorsFieldOptions={normalize:(name:string)=>name};
// @ts-expect-error Supplied names are not links.
const link:MultipleCollaboratorsFieldOptions={href:'https://example.invalid'};
// @ts-expect-error The component is not a core export.
import {MultipleCollaboratorsField as coreField} from '@miniextensions/sdk';
// @ts-expect-error The renderer is not a headless UI export.
import {renderMultipleCollaboratorsField as headlessRenderer} from '@miniextensions/sdk/ui';
// @ts-expect-error The internal control is not a public React export.
import {MultipleCollaboratorsControl} from '@miniextensions/sdk/react';
// @ts-expect-error Internal files are not package export paths.
import {MultipleCollaboratorsField as privateField} from '@miniextensions/sdk/react/MultipleCollaboratorsField';
export const renderers:FieldRendererSlots<ReactNode>={renderMultipleCollaboratorsField:props=>renderMultipleCollaboratorsField(props,options)};
export function Bound(props:MultipleCollaboratorsFieldProps):ReactNode {
 return createElement(MultipleCollaboratorsField,{...props,...options});
}
export function Override(props:MultipleCollaboratorsFieldProps):ReactNode {
 return createElement(MultipleCollaboratorsField,{...props,render:({snapshot})=>String(snapshot.retired)});
}
export function Native(props:FieldRendererProps<'multipleCollaborators'>,single:FieldRendererProps<'singleCollaborator'>,text:FieldRendererProps<'singleLineText'>,select:FieldRendererProps<'multipleSelects'>) {
 const node:ReactNode=renderMultipleCollaboratorsField(props,options);
 const native:readonly {id:string;email:string;name:string;profilePicUrl?:string}[]|null|undefined=props.value;
 const supplied:FieldRendererProps<'multipleCollaborators'>['value']=[{id:'same',email:'',name:''},{id:'same',email:'',name:'  Ω\\n '}];
 const readonlyValues:readonly {id:string;email:string;name:string}[]=[];
 const readonlyNative:FieldRendererProps<'multipleCollaborators'>['value']=readonlyValues;
 const extraNative=[{id:'same',email:'',name:'Name',extra:{accepted:true}}];
 const withExtra:FieldRendererProps<'multipleCollaborators'>['value']=extraNative;
 // Display coverage must not narrow the existing editable native-array contract.
 const capability:FieldRendererProps<'multipleCollaborators'>['capability']={type:'editable',setValue:value=>({accepted:true})};
 // @ts-expect-error A single object is not the plural physical slot.
 renderMultipleCollaboratorsField(single);
 // @ts-expect-error A text field is not the plural physical slot.
 renderMultipleCollaboratorsField(text);
 // @ts-expect-error A different native-array field does not share this physical slot.
 renderMultipleCollaboratorsField(select);
 // @ts-expect-error Native values remain readonly at the renderer boundary.
 props.value?.push({id:'id',email:'',name:'Name'});
 // @ts-expect-error Name is a required native string, including when blank.
 const missingName:FieldRendererProps<'multipleCollaborators'>['value']=[{id:'id',email:'mail'}];
 // @ts-expect-error Native email remains required even when blank.
 const missingEmail:FieldRendererProps<'multipleCollaborators'>['value']=[{id:'id',name:'Name'}];
 // @ts-expect-error Native id remains required.
 const missingId:FieldRendererProps<'multipleCollaborators'>['value']=[{email:'mail',name:'Name'}];
 // @ts-expect-error Native names remain strings.
 const numericName:FieldRendererProps<'multipleCollaborators'>['value']=[{id:'id',email:'mail',name:1}];
 // @ts-expect-error A null member is not an empty native array.
 const nullMember:FieldRendererProps<'multipleCollaborators'>['value']=[null];
 // @ts-expect-error Native values are objects, not display-name strings.
 const names:FieldRendererProps<'multipleCollaborators'>['value']=['Ada'];
 // @ts-expect-error Optional avatar metadata must remain a string.
 const malformedAvatar:FieldRendererProps<'multipleCollaborators'>['value']=[{id:'id',email:'mail',name:'Ada',profilePicUrl:null}];
 return {node,native,supplied,readonlyNative,withExtra,capability};
}
`;

/** JSX composition uses the same public native-array and display-only boundaries. */
export const multipleCollaboratorsReactTypedConsumer =
    multipleCollaboratorsNodeTypedConsumer +
    `
import {AirtableForm,AirtableGrid,AirtableList} from '@miniextensions/sdk/react';
import type {FormRenderScope,PortalRenderScope} from '@miniextensions/sdk/ui';
export function JSX(props:MultipleCollaboratorsFieldProps) {return <MultipleCollaboratorsField {...props} className="native-names"/>;}
export function CustomJSX(props:MultipleCollaboratorsFieldProps) {return <MultipleCollaboratorsField {...props} render={({snapshot})=><span>{String(snapshot.retired)}</span>}/>;}
// @ts-expect-error JSX accepts no picker callback.
export function InvalidJSX(props:MultipleCollaboratorsFieldProps) {return <MultipleCollaboratorsField {...props} onSelect={()=>{}}/>;}
export function Compositions({form,portal}:{form:FormRenderScope;portal:PortalRenderScope}) {return <>
 <AirtableForm scope={form} renderers={renderers}>{state=>state.fields.map(field=>field.node)}</AirtableForm>
 <AirtableGrid scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableGrid>
 <AirtableList scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableList>
 </>;}
`;

/** Actual packed public ESM/CommonJS imports with synthetic Form/Portal owners. */
export async function checkMultipleCollaboratorsConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let network = 0;
    window.fetch = () => {
        network++;
        throw Error('Display must not fetch');
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
        'input,button,a,img,canvas,video,audio,iframe,object,embed,svg,[contenteditable=true]';
    let checks = 0;
    const temporary = mkdtempSync(
        join(consumerDirectory, '.multiple-collaborators-consumer-')
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
            assert.equal(typeof react.MultipleCollaboratorsField, 'function');
            assert.equal(
                typeof react.renderMultipleCollaboratorsField,
                'function'
            );
            for (const namespace of [core, forms, portals, ui]) {
                assert.equal(namespace.MultipleCollaboratorsField, undefined);
                assert.equal(
                    namespace.renderMultipleCollaboratorsField,
                    undefined
                );
            }
            assert.equal(react.MultipleCollaboratorsControl, undefined);
            for (const subpath of [
                'react/MultipleCollaboratorsField',
                `dist/${format}/react/MultipleCollaboratorsField.js`,
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
            const { loaded, expected } = multipleCollaboratorsLoadedFixture();
            let writes = 0,
                saves = 0,
                rowEvents = 0,
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
                    ownerId: 'multiple-collaborators-consumer',
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
            const eventTypes = [
                'click',
                'auxclick',
                'dblclick',
                'pointerdown',
                'keydown',
                'keyup',
            ];
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
                    for (const type of eventTypes)
                        node.dispatchEvent(
                            new window.Event(type, { bubbles: true })
                        );
                });
            const renderers = {
                renderMultipleCollaboratorsField: (props) => {
                    if (props.fieldId === 'source') sourceProps = props;
                    return h(
                        'section',
                        { 'data-field': props.fieldId },
                        react.renderMultipleCollaboratorsField(props)
                    );
                },
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
                    assert(node, `${format}: accepted Form ${id}`);
                    assert.equal(node.textContent, text);
                    assert.equal(node.getAttribute('aria-invalid'), 'false');
                    assert(container.querySelector(`label[for="${node.id}"]`));
                    assert.deepEqual(
                        fields.field(id).getSnapshot().value,
                        loaded.payload.formRecord.data[id]
                    );
                    checks++;
                }
                assert.equal(container.querySelector(forbidden), null);
                assert.equal(container.innerHTML.includes('PRIVATE_'), false);
                assert.equal(sourceProps.capability.type, 'editable');
                await fire(output());
                assert.equal(rowEvents, 0);
                assert.deepEqual(fields.controller.getState(), before);
                checks++;

                const good = { id: 'id', email: '', name: 'Ada' };
                const sparse = [good, good];
                delete sparse[0];
                for (const value of [
                    'Ada',
                    good,
                    [good, null],
                    [good, undefined],
                    [good, 'Ada'],
                    [good, { id: 'id', email: '' }],
                    [good, { ...good, name: null }],
                    [good, { ...good, profilePicUrl: null }],
                    [[good]],
                    sparse,
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderMultipleCollaboratorsField({
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
                let protectedReads = 0;
                const poison = () => {
                    protectedReads++;
                    throw Error('Masked data or actions read');
                };
                const poisonedArray = new Proxy([], { get: poison });
                const poisonedMember = Object.defineProperties(
                    {},
                    Object.fromEntries(
                        ['name', 'id', 'email', 'profilePicUrl'].map((key) => [
                            key,
                            { enumerable: true, get: poison },
                        ])
                    )
                );
                for (const side of ['displayConfig', 'writeConfig'])
                    for (const flag of [
                        'obscurePassword',
                        'maskPasswordOnLoginScreen',
                    ])
                        for (const value of [
                            poisonedArray,
                            [poisonedMember],
                            [],
                        ]) {
                            const props = {
                                ...sourceProps,
                                value,
                                displayConfig: {
                                    showTitle: false,
                                    [flag]: false,
                                },
                                writeConfig: { [flag]: false },
                                [side]: { showTitle: false, [flag]: true },
                            };
                            Object.defineProperty(props, 'capability', {
                                get: poison,
                            });
                            await act(async () =>
                                root.render(
                                    react.renderMultipleCollaboratorsField(
                                        props
                                    )
                                )
                            );
                            assert.equal(output().textContent, mask);
                            assert.equal(
                                output().getAttribute('aria-label'),
                                'Collaborators'
                            );
                            assert.equal(protectedReads, 0);
                            checks++;
                        }
                const inaccessibleValue = {
                    ...sourceProps,
                    displayConfig: { obscurePassword: true },
                };
                Object.defineProperty(inaccessibleValue, 'value', {
                    get: poison,
                });
                await act(async () =>
                    root.render(
                        react.renderMultipleCollaboratorsField(
                            inaccessibleValue
                        )
                    )
                );
                assert.equal(output().textContent, mask);
                assert.equal(protectedReads, 0);
                checks++;

                const noActions = { ...sourceProps };
                Object.defineProperty(noActions, 'capability', { get: poison });
                await act(async () =>
                    root.render(
                        react.renderMultipleCollaboratorsField(noActions)
                    )
                );
                assert.equal(output().textContent, expected[0][1]);
                assert.equal(protectedReads, 0);
                checks++;

                await act(async () =>
                    root.render(
                        react.renderMultipleCollaboratorsField({
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
                            react.renderMultipleCollaboratorsField(sourceProps),
                            react.renderMultipleCollaboratorsField(sourceProps)
                        )
                    )
                );
                const outputs = [...container.querySelectorAll('output')];
                assert.equal(new Set(outputs.map((node) => node.id)).size, 2);
                for (const node of outputs)
                    assert(container.querySelector(`label[for="${node.id}"]`));
                checks++;

                await act(async () =>
                    root.render(
                        isolate(
                            h(react.MultipleCollaboratorsField, { binding })
                        )
                    )
                );
                assert.equal(output().textContent, expected[0][1]);
                await fire(output());
                assert.equal(rowEvents, 0);
                const readOnlySnapshot = { ...binding.getSnapshot() };
                Object.defineProperty(readOnlySnapshot, 'selection', {
                    get: poison,
                });
                const noSelection = {
                    ...binding,
                    getSnapshot: () => readOnlySnapshot,
                    subscribe: () => () => {},
                };
                for (const key of ['setValue', 'selection', 'choices'])
                    Object.defineProperty(noSelection, key, { get: poison });
                await act(async () =>
                    root.render(
                        h(react.MultipleCollaboratorsField, {
                            key: 'no-selection',
                            binding: noSelection,
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
                    // A distinct key avoids React's development prop comparison touching fixture getters.
                    await act(async () =>
                        root.render(
                            h(react.MultipleCollaboratorsField, {
                                key,
                                binding: hidden,
                            })
                        )
                    );
                    assert.equal(output(), null);
                    assert.equal(protectedReads, 0);
                    checks++;
                }

                const hiddenLoaded = structuredClone(loaded);
                hiddenLoaded.payload.formRecord = {
                    type: 'edit',
                    tableId: 'tbl_children',
                    recordId: 'rec_hidden_collaborators',
                    data: { source: [] },
                };
                hiddenLoaded.payload.fieldIdsToSchemas.source.miniExtConfig = {
                    hideFieldIfEmpty: true,
                };
                const hiddenFields = forms.createFormFieldBindings({
                    loaded: hiddenLoaded,
                    ...bindingOptions,
                });
                cleanup.push(() => hiddenFields.destroy());
                assert.equal(
                    hiddenFields.field('source').getSnapshot().visibility.type,
                    'blocked'
                );
                await act(async () =>
                    root.render(
                        h(react.MultipleCollaboratorsField, {
                            binding: hiddenFields.field('source'),
                        })
                    )
                );
                assert.equal(output(), null);
                assert.deepEqual(
                    hiddenFields.field('source').getSnapshot().value,
                    []
                );
                checks++;

                const portal = fixtures.makePortal();
                const sourceField =
                    loaded.payload.fieldIdsToSchemas.source.airtableField;
                const native = structuredClone(
                    loaded.payload.formRecord.data.source
                );
                portal.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [sourceField];
                const details = [
                    {
                        fieldId: 'source',
                        fieldName: 'Collaborators',
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
                    id: 'rec_collaborators',
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
                                            rec_collaborators: record,
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
                        ownerId: 'multiple-collaborators-portal',
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
                                                renderMultipleCollaboratorsField:
                                                    react.renderMultipleCollaboratorsField,
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
                    assert.equal(output().textContent, expected[0][1]);
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
                    root.render(
                        h(react.MultipleCollaboratorsField, { binding })
                    )
                );
                assert.equal(output().textContent, expected[0][1]);
                assert.deepEqual(fields.controller.getState(), before);
                await act(async () => fields.destroy());
                assert.equal(output(), null);
                assert.equal(writes, 0);
                assert.equal(saves, 0);
                assert.equal(network, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                for (const dispose of cleanup.reverse()) dispose();
                scope.destroy();
                fields.destroy();
                container.remove();
            }
        }
        assert.equal(checks, multipleCollaboratorsConsumerCheckCount);
        return { checks };
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
