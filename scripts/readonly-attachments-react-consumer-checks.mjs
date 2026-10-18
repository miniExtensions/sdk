import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';
import {
    multipleAttachmentsLoadedFixture,
    multipleAttachmentsSaveOptions,
} from './multiple-attachments-consumer-checks.mjs';

const unavailable = 'Attachment presentation unavailable';
const mask = '••••••••';
const rendererSelector = '.mx-sdk-readonly-attachments-field';

/** Closed snapshot adapter contract in strict ESM, CJS and JSX consumers. */
export function readonlyAttachmentsTypedConsumer({
    mode = 'public-export',
    moduleSpecifier,
    jsx = false,
} = {}) {
    assert(['direct-module', 'public-export'].includes(mode));
    if (mode === 'direct-module') assert(moduleSpecifier);
    const source =
        mode === 'public-export'
            ? '@miniextensions/sdk/react'
            : moduleSpecifier;
    return `
import {createElement,type ReactNode} from 'react';
import {ReadonlyAttachmentsField,renderReadonlyAttachmentsField,type ReadonlyAttachmentsFieldProps,type ReadonlyAttachmentsFieldOptions} from ${JSON.stringify(source)};
import type {AttachmentPresentation,FieldRendererProps,FieldRendererSlots} from '@miniextensions/sdk/ui';
const options:ReadonlyAttachmentsFieldOptions={className:'readonly-attachments'};
// @ts-expect-error Native values are not accepted as a display fallback.
const raw:ReadonlyAttachmentsFieldOptions={value:[]};
// @ts-expect-error No queue or File access is introduced.
const files:ReadonlyAttachmentsFieldOptions={files:[]};
// @ts-expect-error No write callback is introduced.
const change:ReadonlyAttachmentsFieldOptions={onChange:()=>{}};
// @ts-expect-error No save callback is introduced.
const save:ReadonlyAttachmentsFieldOptions={onSave:()=>{}};
// @ts-expect-error No upload transport is introduced.
const upload:ReadonlyAttachmentsFieldOptions={uploadFile:async()=>false};
// @ts-expect-error No preview, download, URL or controller fallback is introduced.
const url:ReadonlyAttachmentsFieldOptions={getAttachmentUrl:()=>''};
// @ts-expect-error A snapshot adapter cannot independently acquire a controller.
const controller:ReadonlyAttachmentsFieldOptions={controller:{}};
// @ts-expect-error The component belongs only to the optional React entry.
import {ReadonlyAttachmentsField as coreField} from '@miniextensions/sdk';
// @ts-expect-error The renderer is not a headless UI export.
import {renderReadonlyAttachmentsField as uiRenderer} from '@miniextensions/sdk/ui';
// @ts-expect-error Internal subpaths are not public exports.
import {ReadonlyAttachmentsField as privateField} from '@miniextensions/sdk/react/ReadonlyAttachmentsField';
const ready:AttachmentPresentation={status:'ready',rows:[{label:'duplicate'},{label:'duplicate'}]};
const masked:AttachmentPresentation={status:'masked'};
const missing:AttachmentPresentation={status:'unavailable'};
// @ts-expect-error The approved facet contains labels only.
const nativeFacet:AttachmentPresentation={status:'ready',rows:[{label:'label',url:'private'}]};
// @ts-expect-error Masking discloses neither rows nor count.
const maskedRows:AttachmentPresentation={status:'masked',rows:[]};
// @ts-expect-error Unavailability discloses neither rows nor count.
const unavailableCount:AttachmentPresentation={status:'unavailable',count:1};
export const renderers:FieldRendererSlots<ReactNode>={renderMultipleAttachmentsField:field=>renderReadonlyAttachmentsField(field,options)};
export function Field(field:FieldRendererProps<'multipleAttachments'>):ReactNode {
 const props:ReadonlyAttachmentsFieldProps={field,...options};
 const native:readonly {url:string;filename?:string}[]|null|undefined=field.value;
 const presentation:AttachmentPresentation|undefined=field.attachmentPresentation;
 // @ts-expect-error Direct component props cannot borrow a binding independently.
 const bound:ReadonlyAttachmentsFieldProps={binding:{}};
 // @ts-expect-error Native attachments keep the existing array contract.
 const text:FieldRendererProps<'multipleAttachments'>['value']='label';
 return createElement(ReadonlyAttachmentsField,props);
}
export function Other(text:FieldRendererProps<'singleLineText'>,links:FieldRendererProps<'multipleRecordLinks'>) {
 // @ts-expect-error Only the physical attachment slot is supported.
 renderReadonlyAttachmentsField(text);
 // @ts-expect-error Linked records have their own physical slot.
 renderReadonlyAttachmentsField(links);
}
${
    jsx
        ? `
import {AirtableForm,FieldRenderer} from '@miniextensions/sdk/react';
import type {FormRenderScope,FieldRendererHost} from '@miniextensions/sdk/ui';
export function JSX(props:ReadonlyAttachmentsFieldProps) {return <ReadonlyAttachmentsField {...props} className="labels"/>;}
// @ts-expect-error This display component has no editable callback.
export function InvalidJSX(props:ReadonlyAttachmentsFieldProps) {return <ReadonlyAttachmentsField {...props} onChange={()=>{}}/>;}
export function Screens({form,detail}:{form:FormRenderScope;detail:FieldRendererHost}) {return <>
 <AirtableForm scope={form} renderers={renderers}>{state=>state.fields.map(field=>field.node)}</AirtableForm>
 <FieldRenderer host={detail} renderers={renderers}/>
 </>;}
`
        : ''
}
`;
}

export const readonlyAttachmentsNodeTypedConsumer =
    readonlyAttachmentsTypedConsumer();
export const readonlyAttachmentsReactTypedConsumer =
    readonlyAttachmentsTypedConsumer({ jsx: true });

/** Synthetic accepted owners only. Never contacts a backend or opens files. */
export async function runReadonlyAttachmentsReactConsumerChecks({
    consumerDirectory,
    happyDomModulePath,
    mode = 'public-export',
    modulePaths,
}) {
    assert(['direct-module', 'public-export'].includes(mode));
    if (mode === 'direct-module') {
        for (const format of ['esm', 'cjs'])
            assert(modulePaths?.[format] && isAbsolute(modulePaths[format]));
    } else assert.equal(modulePaths, undefined);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let network = 0;
    window.fetch = () => {
        network++;
        throw Error('No external attachment requests');
    };
    const keys = [
        'window',
        'document',
        'navigator',
        'fetch',
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
    const { createElement: h, act, StrictMode, Fragment } = require('react');
    const { createRoot } = require('react-dom/client');
    const temporary = mkdtempSync(
        join(consumerDirectory, '.readonly-attachments-react-consumer-')
    );
    const loader = join(temporary, 'imports.mjs');
    const formats = [];
    let checks = 0;
    try {
        writeFileSync(
            loader,
            `
import * as core from '@miniextensions/sdk';
import * as forms from '@miniextensions/sdk/forms';
import * as portals from '@miniextensions/sdk/portals';
import * as ui from '@miniextensions/sdk/ui';
import * as react from '@miniextensions/sdk/react';
export {core,forms,portals,ui,react};
export const importPackage = name => import(name);
`
        );
        for (const format of ['esm', 'cjs']) {
            const { core, forms, portals, ui, react, importPackage } =
                format === 'esm'
                    ? await import(pathToFileURL(loader))
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
            const scenarios = [];
            const check = async (name, exercise) => {
                try {
                    await exercise();
                } catch (error) {
                    error.message = `${format} ${name}: ${error.message}`;
                    throw error;
                }
                checks++;
                scenarios.push(name);
            };
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const cleanup = [];
            let protectedReads = 0,
                rowEvents = 0,
                writes = 0,
                saves = 0,
                uploads = 0,
                ownerReads = 0;
            const poison = () => {
                protectedReads++;
                throw Error('Protected attachment member was accessed');
            };
            const labels = () =>
                [...container.querySelectorAll(`${rendererSelector} li`)].map(
                    (node) => node.textContent
                );
            const noResources = () => {
                assert.equal(
                    container.querySelector(
                        'a,img,video,audio,canvas,iframe,object,embed,svg,input,button,select,textarea,[contenteditable=true]'
                    ),
                    null
                );
                assert.equal(container.innerHTML.includes('PRIVATE_'), false);
            };
            const inert = (expected = unavailable) => {
                assert.equal(
                    container.querySelector('output')?.textContent,
                    expected
                );
                assert.equal(
                    container.querySelector('ul,ol,li,[role=list]'),
                    null
                );
                assert.equal(
                    container.textContent.includes('No attachments'),
                    false
                );
                noResources();
            };
            const isolate = (node) =>
                h(
                    'div',
                    Object.fromEntries(
                        [
                            'onClick',
                            'onAuxClick',
                            'onDoubleClick',
                            'onPointerDown',
                            'onPointerUp',
                            'onKeyDown',
                            'onKeyUp',
                        ].map((name) => [name, () => rowEvents++])
                    ),
                    node
                );
            // React 19 profiling traverses prior props. Separate direct hostile
            // snapshots so diagnostics cannot read the previous poisoned object.
            let snapshotKey = 0;
            const render = async (field, component = false) =>
                act(async () =>
                    root.render(
                        h(
                            Fragment,
                            { key: ++snapshotKey },
                            isolate(
                                component
                                    ? h(renderer.ReadonlyAttachmentsField, {
                                          field,
                                          className: 'installed-labels',
                                      })
                                    : renderer.renderReadonlyAttachmentsField(
                                          field,
                                          { className: 'installed-labels' }
                                      )
                            )
                        )
                    )
                );
            const protect = (field, members = []) => {
                for (const key of [
                    'value',
                    'capability',
                    'pending',
                    'error',
                    'validation',
                    ...members,
                ])
                    Object.defineProperty(field, key, { get: poison });
                return field;
            };
            const mountedHost = (host, renderers) =>
                h(
                    StrictMode,
                    null,
                    isolate(
                        h(react.FieldRenderer, {
                            host,
                            renderers: renderers ?? {
                                renderMultipleAttachmentsField:
                                    renderer.renderReadonlyAttachmentsField,
                            },
                            fallback: () => null,
                        })
                    )
                );
            const form = ({
                config = { readOnly: true, hideAttachmentName: false },
                values,
                recovery = false,
                forbidController = true,
            } = {}) => {
                const { loaded, native } = multipleAttachmentsLoadedFixture({
                    config,
                    values,
                });
                loaded.payload.fieldIdsInForm = ['fld_title', 'files'];
                loaded.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {};
                let current = true,
                    epoch = 0,
                    ownerRevision = 0;
                const client = core.createMiniExtensionsClient({
                    apiOrigin: 'https://sdk.example.invalid',
                    fetch: async () => {
                        network++;
                        throw Error('External network forbidden');
                    },
                });
                client.forms.save = async () => {
                    saves++;
                    throw Error('Readonly rendering never saves');
                };
                client.attachments.uploadFile = async () => {
                    uploads++;
                    throw Error('Readonly rendering never uploads');
                };
                const ownerId = `labels-${format}-${cleanup.length}`;
                const owner = forms.createFormFieldBindings({
                    loaded,
                    client,
                    getScope: () => ({
                        ownerId,
                        revision: ownerRevision,
                    }),
                    saveOptions: multipleAttachmentsSaveOptions,
                });
                cleanup.push(() => owner.destroy());
                if (forbidController) owner.attachment = poison;
                const recoveryOptions = {
                    journal: new forms.RecoveryJournal(),
                    loadVersion: 1,
                    scope: {
                        owner: 'labels',
                        parentFieldId: null,
                        tableId: null,
                        childExtensionId: 'form',
                        context: 'modal',
                    },
                };
                const host = ui.createFormFieldRendererHost({
                    fields: owner,
                    fieldId: 'files',
                    isCurrent: () => current,
                    configurationRevision: () => epoch,
                    ...(recovery
                        ? { attachmentRecovery: recoveryOptions }
                        : {}),
                });
                cleanup.push(() => host.dispose());
                const props = () => {
                    const snapshot = host.getSnapshot();
                    assert.equal(snapshot.status, 'ready');
                    return snapshot.fields[0];
                };
                return {
                    owner,
                    host,
                    client,
                    loaded,
                    native,
                    props,
                    recoveryOptions,
                    configure: (value) => {
                        epoch = value;
                        owner.refresh();
                    },
                    replaceOwner: (value) => {
                        ownerRevision = value;
                        owner.refresh();
                    },
                    retire: () => {
                        current = false;
                        owner.refresh();
                    },
                };
            };
            const portal = async ({
                returned = { hideAttachmentName: false },
                child,
                hidden = false,
            } = {}) => {
                const { loaded, native } = multipleAttachmentsLoadedFixture();
                const schema =
                    loaded.payload.fieldIdsToSchemas.files.airtableField;
                const page = fixtures.makePortal();
                page.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [schema];
                const details = [
                    {
                        fieldId: 'files',
                        fieldName: 'Files',
                        titleOverride: null,
                        isHidden: hidden,
                        fieldIsInEditingChildForm: true,
                        childFormField:
                            child === undefined
                                ? null
                                : {
                                      idOrName: { type: 'id', id: 'files' },
                                      config: {
                                          type: 'multipleAttachments',
                                          config: child,
                                      },
                                  },
                        miniExtConfig: returned,
                    },
                ];
                page.payload.linkedRecordFieldIdToDetailFields.fld_children =
                    details;
                const record = { id: 'rec_labels', fields: { files: native } };
                const client = {
                    getSession: () => ({}),
                    portals: {
                        listLinkedRecords: async () => {
                            ownerReads++;
                            return fixtures.page([record], null, {
                                customViewDetailFields: {
                                    fld_children: details,
                                },
                                tableIdsToLinkedTableStates: {
                                    tbl_children: {
                                        airtableFields: [schema],
                                        recordIdsToAirtableRecords: {
                                            rec_labels: record,
                                        },
                                    },
                                },
                            });
                        },
                        updateGridCell: async () => {
                            writes++;
                            throw Error('No attachment presentation writes');
                        },
                    },
                };
                const owner = portals.createPortalListOwner({
                    client,
                    portal: page,
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
                    getScope: () => ({ ownerId: 'labels-portal', revision: 0 }),
                });
                cleanup.push(() => owner.destroy());
                assert.equal(
                    await owner.readFirst(owner.getSnapshot().revision, {
                        pagesToFetch: 1,
                        refreshLoggedInPortalRecord: false,
                    }),
                    true
                );
                let epoch = 0;
                const options = {
                    owner,
                    client,
                    recordId: record.id,
                    isCurrent: () => true,
                    configurationRevision: () => epoch,
                };
                const host = ui.createPortalDetailRendererHost(options);
                cleanup.push(() => host.dispose());
                return {
                    owner,
                    host,
                    client,
                    options,
                    native,
                    configure: (value) => {
                        epoch = value;
                    },
                };
            };
            try {
                await check(
                    'public exports remain confined to the React entry',
                    async () => {
                        assert.equal(
                            typeof renderer.ReadonlyAttachmentsField,
                            'function'
                        );
                        assert.equal(
                            typeof renderer.renderReadonlyAttachmentsField,
                            'function'
                        );
                        for (const namespace of [core, forms, portals, ui]) {
                            assert.equal(
                                namespace.ReadonlyAttachmentsField,
                                undefined
                            );
                            assert.equal(
                                namespace.renderReadonlyAttachmentsField,
                                undefined
                            );
                        }
                        for (const subpath of [
                            'react/ReadonlyAttachmentsField',
                            `dist/${format}/react/ReadonlyAttachmentsField.js`,
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
                    }
                );
                const f = form();
                const base = f.props();
                const before = structuredClone(f.owner.controller.getState());
                const expected = f.native.map((row) => row.filename);
                for (const context of ['form', 'portal-detail'])
                    await check(
                        `direct ${context} uses only ordered literal labels`,
                        async () => {
                            await render(
                                protect({ ...base, context }),
                                context === 'form'
                            );
                            assert.deepEqual(labels(), expected);
                            assert.equal(
                                container.querySelector('li strong'),
                                null
                            );
                            assert(
                                container.querySelector('.installed-labels')
                            );
                            noResources();
                            assert.equal(protectedReads, 0);
                        }
                    );
                await check(
                    'ready empty labels have an explicit empty presentation',
                    async () => {
                        await render(
                            protect({
                                ...base,
                                attachmentPresentation: {
                                    status: 'ready',
                                    rows: [],
                                },
                            })
                        );
                        assert.deepEqual(labels(), []);
                        assert(container.querySelector('ul'));
                        assert(
                            container.textContent.includes('No attachments')
                        );
                        noResources();
                    }
                );
                await check(
                    'supplied blank and Unicode labels are not normalized',
                    async () => {
                        const values = [
                            '',
                            '  ',
                            'line one\nline two Ω',
                            '<script>literal</script>',
                        ];
                        await render(
                            protect({
                                ...base,
                                attachmentPresentation: {
                                    status: 'ready',
                                    rows: values.map((label) => ({ label })),
                                },
                            })
                        );
                        assert.deepEqual(labels(), values);
                        assert.equal(container.querySelector('script'), null);
                        noResources();
                    }
                );
                for (const side of ['displayConfig', 'writeConfig'])
                    for (const flag of [
                        'obscurePassword',
                        'maskPasswordOnLoginScreen',
                    ])
                        for (const value of [true, 'malformed'])
                            await check(
                                `mask precedes facet access: ${side}.${flag}=${value}`,
                                async () => {
                                    const field = protect(
                                        {
                                            ...base,
                                            displayConfig: {},
                                            writeConfig: {},
                                            [side]: { [flag]: value },
                                        },
                                        ['attachmentPresentation']
                                    );
                                    await render(field);
                                    inert(mask);
                                    assert.equal(protectedReads, 0);
                                }
                            );
                for (const status of ['masked', 'unavailable'])
                    await check(
                        `inert ${status} facet never reads rows or discloses count`,
                        async () => {
                            const facet = { status };
                            Object.defineProperty(facet, 'rows', {
                                get: poison,
                            });
                            await render(
                                protect({
                                    ...base,
                                    attachmentPresentation: facet,
                                })
                            );
                            inert(status === 'masked' ? mask : unavailable);
                            assert.equal(protectedReads, 0);
                        }
                    );
                for (const context of ['portal-cell', 'linked-detail'])
                    await check(
                        `unsupported ${context} never reads a supplied facet`,
                        async () => {
                            await render(
                                protect({ ...base, context }, [
                                    'attachmentPresentation',
                                ])
                            );
                            inert();
                            assert.equal(protectedReads, 0);
                        }
                    );
                for (const [name, patch] of [
                    ['computed', { computed: true }],
                    ['wrong physical kind', { physicalKind: 'singleLineText' }],
                    [
                        'wrong field config',
                        {
                            field: {
                                ...base.field,
                                config: { type: 'singleLineText' },
                            },
                        },
                    ],
                    [
                        'computed result',
                        {
                            presentation: {
                                type: 'computed-result',
                                config: base.field.config,
                            },
                        },
                    ],
                    [
                        'wrong presentation config',
                        {
                            presentation: {
                                type: 'physical',
                                config: { type: 'singleLineText' },
                            },
                        },
                    ],
                ])
                    await check(
                        `${name} fails closed before facet read`,
                        async () => {
                            await render(
                                protect({ ...base, ...patch }, [
                                    'attachmentPresentation',
                                ])
                            );
                            inert();
                            assert.equal(protectedReads, 0);
                        }
                    );
                for (const [name, facet] of [
                    ['absent', undefined],
                    ['null', null],
                    ['array', []],
                    ['unknown status', { status: 'PRIVATE_unknown' }],
                    ['missing rows', { status: 'ready' }],
                    ['nonarray rows', { status: 'ready', rows: {} }],
                    ['sparse rows', { status: 'ready', rows: new Array(1) }],
                    ['null row', { status: 'ready', rows: [null] }],
                    ['string row', { status: 'ready', rows: ['PRIVATE_raw'] }],
                    ['nonstrings', { status: 'ready', rows: [{ label: 1 }] }],
                    ['missing label', { status: 'ready', rows: [{}] }],
                    [
                        'native URL row',
                        {
                            status: 'ready',
                            rows: [
                                { label: 'PRIVATE_leak', url: 'PRIVATE_url' },
                            ],
                        },
                    ],
                    [
                        'native ID row',
                        {
                            status: 'ready',
                            rows: [{ label: 'PRIVATE_leak', id: 'PRIVATE_id' }],
                        },
                    ],
                    ['facet count', { status: 'ready', rows: [], count: 4 }],
                    [
                        'masked rows',
                        { status: 'masked', rows: [{ label: 'PRIVATE_leak' }] },
                    ],
                    ['unavailable count', { status: 'unavailable', count: 3 }],
                    [
                        'partial valid rows',
                        {
                            status: 'ready',
                            rows: [{ label: 'PRIVATE_partial' }, {}],
                        },
                    ],
                ])
                    await check(
                        `malformed facet has no fallback or partial output: ${name}`,
                        async () => {
                            await render(
                                protect({
                                    ...base,
                                    attachmentPresentation: facet,
                                })
                            );
                            inert();
                        }
                    );
                for (const key of ['status', 'rows', 'label'])
                    await check(
                        `throwing ${key} getter fails closed`,
                        async () => {
                            const row = { label: 'PRIVATE_label' };
                            const facet = { status: 'ready', rows: [row] };
                            Object.defineProperty(
                                key === 'label' ? row : facet,
                                key,
                                {
                                    get: () => {
                                        throw Error('Malformed facet getter');
                                    },
                                }
                            );
                            await render(
                                protect({
                                    ...base,
                                    attachmentPresentation: facet,
                                })
                            );
                            inert();
                        }
                    );
                for (const [name, patch] of [
                    [
                        'no policy',
                        { displayConfig: null, writeConfig: undefined },
                    ],
                    ['array display policy', { displayConfig: [] }],
                    ['scalar write policy', { writeConfig: 'bad' }],
                    ...['displayConfig', 'writeConfig'].flatMap((side) =>
                        [
                            'hideAttachmentName',
                            'readOnly',
                            'addOnlyMode',
                            'showExistingValuesForAddOnlyMode',
                        ].map((key) => [
                            `${side}.${key}`,
                            { [side]: { [key]: 'bad' } },
                        ])
                    ),
                ])
                    await check(
                        `malformed policy precedes label access: ${name}`,
                        async () => {
                            await render(
                                protect({ ...base, ...patch }, [
                                    'attachmentPresentation',
                                ])
                            );
                            inert();
                            assert.equal(protectedReads, 0);
                        }
                    );
                await check(
                    'label getter is captured once without metadata or actions',
                    async () => {
                        let reads = 0;
                        const row = {
                            get label() {
                                reads++;
                                return 'Once';
                            },
                        };
                        for (const key of [
                            'url',
                            'id',
                            'file',
                            'download',
                            'preview',
                        ])
                            Object.defineProperty(row, key, { get: poison });
                        await render(
                            protect({
                                ...base,
                                attachmentPresentation: {
                                    status: 'ready',
                                    rows: [row],
                                },
                            })
                        );
                        assert.deepEqual(labels(), ['Once']);
                        assert.equal(reads, 1);
                        assert.equal(protectedReads, 0);
                    }
                );
                for (const first of ['Accepted title', { private: true }])
                    await check(
                        `changing title metadata is captured once: ${typeof first}`,
                        async () => {
                            let reads = 0;
                            const field = {
                                ...base,
                                title: '',
                                field: { ...base.field },
                            };
                            Object.defineProperty(field.field, 'name', {
                                get: () =>
                                    ++reads === 1 ? first : { private: true },
                            });
                            await render(protect(field));
                            assert.deepEqual(labels(), expected);
                            assert.equal(reads, 1);
                            assert.equal(
                                container.querySelector('strong').textContent,
                                typeof first === 'string'
                                    ? first
                                    : 'Attachments'
                            );
                            noResources();
                        }
                    );
                await check(
                    'ready and inert displays retain accessible names and unique IDs',
                    async () => {
                        await act(async () =>
                            root.render(
                                h(
                                    Fragment,
                                    { key: ++snapshotKey },
                                    renderer.renderReadonlyAttachmentsField(
                                        base
                                    ),
                                    renderer.renderReadonlyAttachmentsField({
                                        ...base,
                                        displayConfig: { showTitle: false },
                                        attachmentPresentation: {
                                            status: 'masked',
                                        },
                                    }),
                                    renderer.renderReadonlyAttachmentsField({
                                        ...base,
                                        attachmentPresentation: {
                                            status: 'unavailable',
                                        },
                                    })
                                )
                            )
                        );
                        const list = container.querySelector('ul');
                        assert.equal(
                            window.document.getElementById(
                                list.getAttribute('aria-labelledby')
                            ).textContent,
                            base.title
                        );
                        assert.equal(
                            container
                                .querySelector('section')
                                .getAttribute('aria-labelledby'),
                            list.getAttribute('aria-labelledby')
                        );
                        const outputs = [
                            ...container.querySelectorAll('output'),
                        ];
                        assert.equal(
                            outputs[0].getAttribute('aria-label'),
                            base.title
                        );
                        assert(
                            container.querySelector(
                                `label[for="${outputs[1].id}"]`
                            )
                        );
                        const ids = [...container.querySelectorAll('[id]')].map(
                            (node) => node.id
                        );
                        assert.equal(new Set(ids).size, ids.length);
                        noResources();
                    }
                );
                for (const status of ['ready', 'masked', 'unavailable'])
                    await check(
                        `events remain isolated in ${status} presentation`,
                        async () => {
                            const attachmentPresentation =
                                status === 'ready'
                                    ? base.attachmentPresentation
                                    : { status };
                            await render(
                                protect({ ...base, attachmentPresentation })
                            );
                            for (const node of container.querySelectorAll(
                                `${rendererSelector},${rendererSelector} li,${rendererSelector} output`
                            )) {
                                for (const type of [
                                    'click',
                                    'auxclick',
                                    'dblclick',
                                    'pointerdown',
                                    'pointerup',
                                    'keyup',
                                ]) {
                                    const event = new window.Event(type, {
                                        bubbles: true,
                                        cancelable: true,
                                    });
                                    await act(async () =>
                                        node.dispatchEvent(event)
                                    );
                                    assert.equal(event.defaultPrevented, false);
                                }
                                for (const key of ['Enter', ' ', 'a']) {
                                    const event = new window.KeyboardEvent(
                                        'keydown',
                                        { key, bubbles: true, cancelable: true }
                                    );
                                    await act(async () =>
                                        node.dispatchEvent(event)
                                    );
                                    assert.equal(
                                        event.defaultPrevented,
                                        key === 'Enter'
                                    );
                                }
                            }
                            assert.equal(rowEvents, 0);
                            noResources();
                        }
                    );
                await check(
                    'real read-only Form host renders without an attachment controller',
                    async () => {
                        await act(async () => root.render(mountedHost(f.host)));
                        assert.deepEqual(labels(), expected);
                        assert.equal(f.props().capability.type, 'readonly');
                        assert.deepEqual(f.props().value, f.native);
                        assert.deepEqual(f.owner.controller.getState(), before);
                        assert.equal(f.owner.hasPendingFiles(), false);
                        noResources();
                    }
                );
                await check(
                    'real AirtableForm composition retains custom slot precedence',
                    async () => {
                        const scope = ui.createFormRenderScope({
                            fields: f.owner,
                            isCurrent: () => true,
                            configurationRevision: () => 0,
                        });
                        cleanup.push(() => scope.destroy());
                        let customCalls = 0;
                        const renderers = {
                            renderMultipleAttachmentsField: () => {
                                customCalls++;
                                return h(
                                    'span',
                                    { 'data-custom': true },
                                    'Custom labels'
                                );
                            },
                        };
                        await act(async () =>
                            root.render(
                                h(
                                    react.AirtableForm,
                                    { scope, renderers },
                                    (state) =>
                                        state.fields.map((field) => field.node)
                                )
                            )
                        );
                        assert.equal(
                            container.querySelector('[data-custom]')
                                .textContent,
                            'Custom labels'
                        );
                        assert(customCalls > 0);
                        assert.equal(
                            container.querySelector(rendererSelector),
                            null
                        );
                        await act(async () =>
                            root.render(
                                h(
                                    react.AirtableForm,
                                    {
                                        scope,
                                        renderers: {
                                            renderMultipleAttachmentsField:
                                                renderer.renderReadonlyAttachmentsField,
                                        },
                                    },
                                    (state) =>
                                        state.fields.map((field) => field.node)
                                )
                            )
                        );
                        assert.deepEqual(labels(), expected);
                        noResources();
                    }
                );
                await check(
                    'no attachment renderer is installed implicitly',
                    async () => {
                        await act(async () =>
                            root.render(mountedHost(f.host, {}))
                        );
                        assert.equal(
                            container.querySelector(rendererSelector),
                            null
                        );
                        assert.equal(container.textContent, '');
                        assert.deepEqual(f.props().value, f.native);
                    }
                );
                await check(
                    'host subscription reflects accepted edits without renderer writes',
                    async () => {
                        const editable = form({
                            config: { hideAttachmentName: false },
                        });
                        await act(async () =>
                            root.render(mountedHost(editable.host))
                        );
                        const next = [
                            {
                                url: 'https://files.example.invalid/PRIVATE_replacement',
                                filename: 'New accepted label',
                            },
                        ];
                        await act(async () =>
                            assert.equal(
                                editable.owner.field('files').setValue(next)
                                    .accepted,
                                true
                            )
                        );
                        assert.deepEqual(labels(), ['New accepted label']);
                        assert.deepEqual(editable.props().value, next);
                        assert.equal(editable.owner.hasPendingFiles(), false);
                        noResources();
                    }
                );
                await check(
                    'conditional hide and reshow update the mounted accepted host',
                    async () => {
                        const conditional = form({
                            config: {
                                readOnly: true,
                                hideAttachmentName: false,
                                conditionalFields: {
                                    logicalOperator: 'and',
                                    conditions: [
                                        {
                                            id: 'visible-title',
                                            type: 'singleCondition',
                                            setting: {
                                                type: 'is',
                                                fieldType: 'singleLineText',
                                                idOrName: {
                                                    type: 'id',
                                                    id: 'fld_title',
                                                },
                                                value: 'Initial child',
                                            },
                                        },
                                    ],
                                },
                            },
                        });
                        await act(async () =>
                            root.render(mountedHost(conditional.host))
                        );
                        assert.deepEqual(labels(), expected);
                        await act(async () =>
                            assert.equal(
                                conditional.owner
                                    .field('fld_title')
                                    .setValue('Hidden').accepted,
                                true
                            )
                        );
                        assert.equal(
                            conditional.host.getSnapshot().status,
                            'hidden'
                        );
                        assert.equal(
                            container.querySelector(rendererSelector),
                            null
                        );
                        await act(async () =>
                            assert.equal(
                                conditional.owner
                                    .field('fld_title')
                                    .setValue('Initial child').accepted,
                                true
                            )
                        );
                        assert.deepEqual(labels(), expected);
                        assert.deepEqual(
                            conditional.props().value,
                            conditional.native
                        );
                    }
                );
                for (const lifecycle of ['configuration', 'owner', 'current'])
                    await check(
                        `${lifecycle} retirement removes mounted labels and cannot revive`,
                        async () => {
                            const retiring = form();
                            await act(async () =>
                                root.render(mountedHost(retiring.host))
                            );
                            assert.deepEqual(labels(), expected);
                            await act(async () => {
                                if (lifecycle === 'configuration')
                                    retiring.configure(1);
                                else if (lifecycle === 'owner')
                                    retiring.replaceOwner(1);
                                else retiring.retire();
                                root.render(mountedHost(retiring.host));
                            });
                            assert.equal(
                                retiring.host.getSnapshot().status,
                                'retired'
                            );
                            assert.equal(
                                container.querySelector(rendererSelector),
                                null
                            );
                            await act(async () => {
                                if (lifecycle === 'configuration')
                                    retiring.configure(0);
                                else if (lifecycle === 'owner')
                                    retiring.replaceOwner(0);
                                root.render(mountedHost(retiring.host));
                            });
                            assert.equal(
                                container.querySelector(rendererSelector),
                                null
                            );
                        }
                    );
                await check(
                    'remount and accepted owner replacement retain separate leases',
                    async () => {
                        await act(async () => root.render(mountedHost(f.host)));
                        await act(async () => root.render(null));
                        assert.deepEqual(f.props().value, f.native);
                        await act(async () => root.render(mountedHost(f.host)));
                        assert.deepEqual(labels(), expected);
                        const replacement = form({
                            values: [
                                {
                                    url: 'https://files.example.invalid/PRIVATE_new',
                                    filename: 'Replacement owner',
                                },
                            ],
                        });
                        await act(async () =>
                            root.render(mountedHost(replacement.host))
                        );
                        await act(async () => f.retire());
                        assert.deepEqual(labels(), ['Replacement owner']);
                        await act(async () => replacement.owner.destroy());
                        assert.equal(
                            container.querySelector(rendererSelector),
                            null
                        );
                    }
                );
                for (const [name, options, expectedLabels, expectedStatus] of [
                    ['literal', {}, expected, 'ready'],
                    [
                        'returned name hiding',
                        {
                            returned: { hideAttachmentName: true },
                            child: { hideAttachmentName: false },
                        },
                        ['Attachment', 'Attachment', 'Attachment'],
                        'ready',
                    ],
                    [
                        'child name hiding',
                        {
                            returned: { hideAttachmentName: false },
                            child: { hideAttachmentName: true },
                        },
                        ['Attachment', 'Attachment', 'Attachment'],
                        'ready',
                    ],
                    [
                        'returned mask',
                        {
                            returned: { obscurePassword: true },
                            child: {
                                obscurePassword: false,
                                hideAttachmentName: false,
                            },
                        },
                        [],
                        'masked',
                    ],
                    [
                        'child mask',
                        { child: { maskPasswordOnLoginScreen: true } },
                        [],
                        'masked',
                    ],
                    [
                        'add-only returned policy',
                        {
                            returned: {
                                hideAttachmentName: false,
                                addOnlyMode: true,
                            },
                        },
                        [],
                        'unavailable',
                    ],
                    [
                        'malformed returned policy',
                        { returned: { hideAttachmentName: 'bad' } },
                        [],
                        'unavailable',
                    ],
                ])
                    await check(
                        `accepted Portal-detail policy: ${name}`,
                        async () => {
                            const p = await portal(options);
                            await act(async () =>
                                root.render(mountedHost(p.host))
                            );
                            const props = p.host.getSnapshot().fields[0];
                            assert.equal(props.context, 'portal-detail');
                            assert.equal(
                                props.attachmentPresentation.status,
                                expectedStatus
                            );
                            assert.deepEqual(props.value, p.native);
                            assert.deepEqual(labels(), expectedLabels);
                            if (expectedStatus !== 'ready')
                                inert(
                                    expectedStatus === 'masked'
                                        ? mask
                                        : unavailable
                                );
                            noResources();
                        }
                    );
                await check(
                    'hidden Portal detail renders no attachment presentation',
                    async () => {
                        const p = await portal({ hidden: true });
                        await act(async () => root.render(mountedHost(p.host)));
                        assert.deepEqual(p.host.getSnapshot(), {
                            status: 'ready',
                            fields: [],
                        });
                        assert.equal(
                            container.querySelector(rendererSelector),
                            null
                        );
                    }
                );
                await check(
                    'linked-detail remains unsupported with no label fallback',
                    async () => {
                        const p = await portal();
                        const host = ui.createPortalDetailRendererHost({
                            ...p.options,
                            context: 'linked-detail',
                        });
                        cleanup.push(() => host.dispose());
                        await act(async () => root.render(mountedHost(host)));
                        assert.equal(
                            host.getSnapshot().fields[0].attachmentPresentation,
                            undefined
                        );
                        inert();
                    }
                );
                for (const Component of [
                    react.AirtableGrid,
                    react.AirtableList,
                ])
                    await check(
                        `${Component.name} read-only display preserves its accepted detail context`,
                        async () => {
                            const p = await portal();
                            const scope = ui.createPortalRenderScope({
                                owner: p.owner,
                                client: p.client,
                                isCurrent: () => true,
                                configurationRevision: () => 0,
                            });
                            cleanup.push(() => scope.destroy());
                            const readsBefore = ownerReads;
                            await act(async () =>
                                root.render(
                                    h(
                                        Component,
                                        {
                                            scope,
                                            renderers: {
                                                renderMultipleAttachmentsField:
                                                    renderer.renderReadonlyAttachmentsField,
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
                            );
                            const cell = scope
                                .getSnapshot()
                                .rows[0].cells[0].host.getSnapshot().fields[0];
                            assert.equal(cell.context, 'portal-detail');
                            assert.equal(
                                cell.attachmentPresentation.status,
                                'ready'
                            );
                            assert.deepEqual(cell.capability, {
                                type: 'readonly',
                            });
                            assert.deepEqual(cell.value, p.native);
                            assert.deepEqual(labels(), expected);
                            noResources();
                            assert.equal(ownerReads, readsBefore);
                            await act(async () => p.owner.destroy());
                            assert.equal(
                                container.querySelector(rendererSelector),
                                null
                            );
                        }
                    );
                await check(
                    'Portal-detail replacement retires permanently and owner disposal notifies',
                    async () => {
                        const p = await portal();
                        await act(async () => root.render(mountedHost(p.host)));
                        assert.deepEqual(labels(), expected);
                        await act(async () => {
                            p.configure(1);
                            root.render(mountedHost(p.host));
                        });
                        assert.equal(p.host.getSnapshot().status, 'retired');
                        assert.equal(
                            container.querySelector(rendererSelector),
                            null
                        );
                        await act(async () => {
                            p.configure(0);
                            root.render(mountedHost(p.host));
                        });
                        assert.equal(
                            container.querySelector(rendererSelector),
                            null
                        );
                        const next = await portal();
                        await act(async () =>
                            root.render(mountedHost(next.host))
                        );
                        assert.deepEqual(labels(), expected);
                        await act(async () => next.owner.destroy());
                        assert.equal(
                            container.querySelector(rendererSelector),
                            null
                        );
                    }
                );
                await check(
                    'existing editable adapter keeps its owner queue across display switching',
                    async () => {
                        const editable = form({
                            config: { hideAttachmentName: false },
                            recovery: true,
                            forbidController: false,
                        });
                        const controller = editable.owner.attachment(
                            'files',
                            editable.recoveryOptions
                        );
                        await act(async () =>
                            root.render(
                                mountedHost(editable.host, {
                                    renderMultipleAttachmentsField:
                                        react.renderMultipleAttachmentsField,
                                })
                            )
                        );
                        assert(container.querySelector('input[type=file]'));
                        const file = new window.File(
                            ['synthetic'],
                            'PRIVATE_local_file.txt',
                            { type: 'text/plain' }
                        );
                        await act(async () =>
                            assert.equal(controller.select([file]), true)
                        );
                        assert.deepEqual(controller.getSnapshot().files, [
                            file,
                        ]);
                        const draft = structuredClone(
                            editable.owner.controller.getState().draft
                        );
                        await act(async () =>
                            root.render(mountedHost(editable.host))
                        );
                        assert.deepEqual(labels(), expected);
                        noResources();
                        assert.deepEqual(controller.getSnapshot().files, [
                            file,
                        ]);
                        assert.deepEqual(
                            editable.owner.controller.getState().draft,
                            draft
                        );
                        await act(async () =>
                            root.render(
                                mountedHost(editable.host, {
                                    renderMultipleAttachmentsField:
                                        react.renderMultipleAttachmentsField,
                                })
                            )
                        );
                        assert(container.querySelector('input[type=file]'));
                        assert.deepEqual(controller.getSnapshot().files, [
                            file,
                        ]);
                        assert.equal(uploads, 0);
                        assert.equal(saves, 0);
                    }
                );
                await check(
                    'all protected surfaces and external effects remain untouched',
                    async () => {
                        assert.equal(protectedReads, 0);
                        assert.equal(rowEvents, 0);
                        assert.equal(writes, 0);
                        assert.equal(saves, 0);
                        assert.equal(uploads, 0);
                        assert.equal(network, 0);
                    }
                );
                formats.push({
                    format,
                    rendererModule:
                        mode === 'public-export'
                            ? '@miniextensions/sdk/react'
                            : resolve(modulePaths[format]),
                    scenarios,
                    protectedReads,
                    rowEvents,
                    writes,
                    saves,
                    uploads,
                    network,
                    ownerReads,
                });
            } finally {
                await act(async () => root.unmount());
                for (const dispose of cleanup.reverse()) dispose();
                container.remove();
            }
        }
        assert.equal(checks, readonlyAttachmentsReactConsumerCheckCount);
        return {
            mode,
            publicExportVerified: mode === 'public-export',
            checks,
            formats,
        };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}

export const readonlyAttachmentsReactConsumerCheckCount = 166;
