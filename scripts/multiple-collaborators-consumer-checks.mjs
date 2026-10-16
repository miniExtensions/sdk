import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

// This future public-export fixture is intentionally not registered in check-package.
export const multipleCollaboratorsReactTypedConsumer = `
import { createElement, type ReactNode } from 'react';
import { MultipleCollaboratorsField, renderMultipleCollaboratorsField, type MultipleCollaboratorsFieldProps, type MultipleCollaboratorsFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots } from '@miniextensions/sdk/ui';
const options: MultipleCollaboratorsFieldOptions = {className:'collaborators'};
export const renderers: FieldRendererSlots<ReactNode> = {renderMultipleCollaboratorsField: props => renderMultipleCollaboratorsField(props, options)};
export const Bound = (props:MultipleCollaboratorsFieldProps) => createElement(MultipleCollaboratorsField, props);
export const Override = (props:MultipleCollaboratorsFieldProps) => createElement(MultipleCollaboratorsField, {...props, render: ({snapshot}) => String(snapshot.retired)});
export function Native(props:FieldRendererProps<'multipleCollaborators'>, single:FieldRendererProps<'singleCollaborator'>) {
 const native: readonly {id:string;email:string;name:string;profilePicUrl?:string}[]|null|undefined=props.value;
 const supplied: FieldRendererProps<'multipleCollaborators'>['value']=[{id:'same',email:'',name:''},{id:'same',email:'',name:'  Ω\\n '}];
 const readonlyValues: readonly {id:string;email:string;name:string}[]=[];
 const readonlyNative: FieldRendererProps<'multipleCollaborators'>['value']=readonlyValues;
 const capability: FieldRendererProps<'multipleCollaborators'>['capability']={type:'editable',setValue:()=>({accepted:true})};
 // @ts-expect-error A single object is not the plural physical slot.
 renderMultipleCollaboratorsField(single);
 // @ts-expect-error Name is a required native string, including when blank.
 const missingName: FieldRendererProps<'multipleCollaborators'>['value']=[{id:'id',email:'mail'}];
 // @ts-expect-error A null member is not an empty native array.
 const nullMember: FieldRendererProps<'multipleCollaborators'>['value']=[null];
 // @ts-expect-error Native values are objects, not display-name strings.
 const names: FieldRendererProps<'multipleCollaborators'>['value']=['Ada'];
 // @ts-expect-error Optional avatar metadata must remain a string.
 const malformedAvatar: FieldRendererProps<'multipleCollaborators'>['value']=[{id:'id',email:'mail',name:'Ada',profilePicUrl:null}];
 return {native,supplied,readonlyNative,capability};
}
// @ts-expect-error Display options grant no setter.
const write: MultipleCollaboratorsFieldOptions={setValue:()=>{}};
// @ts-expect-error No picker or clear action is introduced.
const clear: MultipleCollaboratorsFieldOptions={clearLabel:'Clear'};
// @ts-expect-error No identity lookup is introduced.
const lookup: MultipleCollaboratorsFieldOptions={lookupUser:()=>{}};
// @ts-expect-error No avatar or email fallback options are introduced.
const fallback: MultipleCollaboratorsFieldOptions={showAvatar:true,emailFallback:true};
// @ts-expect-error No normalization is introduced.
const normalize: MultipleCollaboratorsFieldOptions={normalize:(name:string)=>name};
`;

/** Strict NodeNext declarations, using direct files until exports are serialized. */
export function checkMultipleCollaboratorsDirectTypes({
    directory = repository,
} = {}) {
    const require = createRequire(join(directory, 'package.json'));
    const temporary = mkdtempSync(
        join(directory, 'node_modules', '.multiple-collaborators-types-')
    );
    try {
        const directSource = (format) =>
            multipleCollaboratorsReactTypedConsumer
                .replaceAll(
                    "'@miniextensions/sdk/react'",
                    JSON.stringify(
                        relative(
                            temporary,
                            join(
                                directory,
                                'dist',
                                format,
                                'react/MultipleCollaboratorsField.js'
                            )
                        ).replaceAll('\\', '/')
                    )
                )
                .replaceAll(
                    "'@miniextensions/sdk/ui'",
                    JSON.stringify(
                        relative(
                            temporary,
                            join(directory, 'dist', format, 'ui/index.js')
                        ).replaceAll('\\', '/')
                    )
                );
        writeFileSync(join(temporary, 'package.json'), '{"type":"module"}\n');
        writeFileSync(join(temporary, 'consumer.mts'), directSource('esm'));
        writeFileSync(join(temporary, 'consumer.cts'), directSource('cjs'));
        writeFileSync(
            join(temporary, 'consumer.tsx'),
            directSource('esm') +
                `
export function JSX(props:MultipleCollaboratorsFieldProps) { return <MultipleCollaboratorsField {...props} className="native-names"/>; }
// @ts-expect-error JSX accepts no picker callback.
export function InvalidJSX(props:MultipleCollaboratorsFieldProps) { return <MultipleCollaboratorsField {...props} onSelect={()=>{}}/>; }
`
        );
        writeFileSync(
            join(temporary, 'tsconfig.json'),
            JSON.stringify({
                compilerOptions: {
                    target: 'ES2022',
                    module: 'NodeNext',
                    moduleResolution: 'NodeNext',
                    strict: true,
                    noEmit: true,
                    skipLibCheck: false,
                    jsx: 'react-jsx',
                    types: ['react', 'react-dom'],
                },
                include: ['consumer.mts', 'consumer.cts', 'consumer.tsx'],
            })
        );
        const result = spawnSync(
            process.execPath,
            [
                require.resolve('typescript/bin/tsc'),
                '--project',
                join(temporary, 'tsconfig.json'),
            ],
            { cwd: directory, encoding: 'utf8' }
        );
        if (result.error) throw result.error;
        assert.equal(result.status, 0, result.stdout + result.stderr);
        return {
            files: ['NodeNext ESM', 'NodeNext CommonJS', 'JSX'],
            scope: 'direct compiled declarations',
        };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}

/** Direct compiled-module runtime proof. This is not an installed-package claim. */
export async function checkMultipleCollaboratorsDirectModules({
    directory = repository,
} = {}) {
    const require = createRequire(join(directory, 'package.json'));
    const { Window } = await import(
        pathToFileURL(require.resolve('happy-dom'))
    );
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
    try {
        for (const format of ['esm', 'cjs']) {
            const load = (name) => {
                const path = join(directory, 'dist', format, name + '.js');
                return format === 'cjs'
                    ? require(path)
                    : import(pathToFileURL(path));
            };
            const [forms, portals, ui, react, component] = await Promise.all(
                [
                    'forms/index',
                    'portals/index',
                    'ui/index',
                    'react/index',
                    'react/MultipleCollaboratorsField',
                ].map(load)
            );
            assert.equal(
                typeof component.MultipleCollaboratorsField,
                'function'
            );
            assert.equal(
                typeof component.renderMultipleCollaboratorsField,
                'function'
            );
            assert.equal(component.MultipleCollaboratorsControl, undefined);
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
                        component.renderMultipleCollaboratorsField(props)
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
                            component.renderMultipleCollaboratorsField({
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
                                    component.renderMultipleCollaboratorsField(
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
                        component.renderMultipleCollaboratorsField(
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
                        component.renderMultipleCollaboratorsField(noActions)
                    )
                );
                assert.equal(output().textContent, expected[0][1]);
                assert.equal(protectedReads, 0);
                checks++;

                await act(async () =>
                    root.render(
                        component.renderMultipleCollaboratorsField({
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
                            component.renderMultipleCollaboratorsField(
                                sourceProps
                            ),
                            component.renderMultipleCollaboratorsField(
                                sourceProps
                            )
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
                            h(component.MultipleCollaboratorsField, { binding })
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
                        h(component.MultipleCollaboratorsField, {
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
                            h(component.MultipleCollaboratorsField, {
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
                        h(component.MultipleCollaboratorsField, {
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
                                                    component.renderMultipleCollaboratorsField,
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
                        h(component.MultipleCollaboratorsField, { binding })
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
        return {
            checks,
            formats: ['esm', 'cjs'],
            react: require('react').version,
            scope: 'direct compiled modules',
            installedPublicExports: 'pending shared integration',
            aggregatePackageRegistration: 'pending shared integration',
        };
    } finally {
        globals.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    const types = checkMultipleCollaboratorsDirectTypes();
    const runtime = await checkMultipleCollaboratorsDirectModules();
    console.log(JSON.stringify({ types, runtime }, null, 2));
}
