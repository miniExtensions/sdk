import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const unavailable = 'Attachment presentation unavailable';
const mask = '••••••••';
export const multipleAttachmentsConsumerCheckCount = 134;

export const multipleAttachmentsSaveOptions = {
    captchaVal: null,
    isComputeMode: false,
    context: { type: 'direct-url' },
    searchQuery: {},
    conditionalLinkedRecordFieldIdsToFilteringValues: {},
};

/** Synthetic native input belongs to the owner; the renderer only gets filtered rows. */
export function multipleAttachmentsLoadedFixture({ config = {}, values } = {}) {
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
    const duplicate = {
        id: 'att_synthetic_duplicate',
        filename: '  <strong>Literal duplicate</strong> Ω  ',
        url: 'https://files.example.invalid/PRIVATE_native_url',
        type: 'PRIVATE_native_type',
        size: 17,
        thumbnails: {
            small: {
                url: 'https://files.example.invalid/PRIVATE_thumbnail',
                width: 1,
                height: 1,
            },
        },
    };
    const native = values ?? [
        duplicate,
        structuredClone(duplicate),
        {
            filename: 'https://example.invalid/literal-label.txt',
            url: 'https://files.example.invalid/PRIVATE_other_url',
        },
    ];
    loaded.payload.fieldIdsInForm = ['files'];
    loaded.payload.formRecord.data.files = structuredClone(native);
    loaded.payload.fieldIdsToSchemas.files = {
        fieldType: 'multipleAttachments',
        airtableField: {
            id: 'files',
            name: 'Files',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'multipleAttachments',
                options: { isReversed: false },
            },
        },
        miniExtConfig: { hideAttachmentName: false, ...config },
    };
    return { loaded, native: structuredClone(native) };
}

/** Public React API and closed options in strict MTS, CTS and JSX consumers. */
export function multipleAttachmentsTypedConsumer({
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
import {MultipleAttachmentsField,renderMultipleAttachmentsField,type MultipleAttachmentsFieldProps,type MultipleAttachmentsFieldOptions} from ${JSON.stringify(source)};
import type {FieldRendererProps,FieldRendererSlots} from '@miniextensions/sdk/ui';
const options:MultipleAttachmentsFieldOptions={className:'attachments'};
// @ts-expect-error The renderer cannot replace the owner's attachment queue.
const queue:MultipleAttachmentsFieldOptions={files:[]};
// @ts-expect-error No native write callback is exposed.
const setter:MultipleAttachmentsFieldOptions={setValue:()=>{}};
// @ts-expect-error Save remains a separate owner action.
const save:MultipleAttachmentsFieldOptions={onSave:()=>{}};
// @ts-expect-error No upload transport is introduced.
const upload:MultipleAttachmentsFieldOptions={uploadFile:async()=>false};
// @ts-expect-error No URL recovery, preview or download capability.
const preview:MultipleAttachmentsFieldOptions={getAttachmentUrl:()=>''};
// @ts-expect-error A snapshot adapter does not acquire an independent controller.
const controller:MultipleAttachmentsFieldOptions={controller:{}};
// @ts-expect-error The component belongs to the optional React entry.
import {MultipleAttachmentsField as coreField} from '@miniextensions/sdk';
// @ts-expect-error The renderer is not a headless UI export.
import {renderMultipleAttachmentsField as headlessRenderer} from '@miniextensions/sdk/ui';
// @ts-expect-error Internal module paths are not public exports.
import {MultipleAttachmentsField as privateField} from '@miniextensions/sdk/react/MultipleAttachmentsField';
export const renderers:FieldRendererSlots<ReactNode>={renderMultipleAttachmentsField:props=>renderMultipleAttachmentsField(props,options)};
export function Field(field:FieldRendererProps<'multipleAttachments'>):ReactNode {
 const props:MultipleAttachmentsFieldProps={field,...options};
 const native:readonly {url:string;filename?:string}[]|null|undefined=field.value;
 const absent:FieldRendererProps<'multipleAttachments'>['capability']={type:'editable',setValue:()=>({accepted:true})};
 const readonly:FieldRendererProps<'multipleAttachments'>['capability']={type:'readonly'};
 // @ts-expect-error Direct adapter props do not accept a binding.
 const bound:MultipleAttachmentsFieldProps={binding:{}};
 // @ts-expect-error Native attachments retain an array contract.
 const string:FieldRendererProps<'multipleAttachments'>['value']='file.txt';
 return createElement(MultipleAttachmentsField,props);
}
export function Other(text:FieldRendererProps<'singleLineText'>,links:FieldRendererProps<'multipleRecordLinks'>) {
 // @ts-expect-error This is the physical attachment slot only.
 renderMultipleAttachmentsField(text);
 // @ts-expect-error Linked records use a different physical slot.
 renderMultipleAttachmentsField(links);
}
${
    jsx
        ? `
import {AirtableForm,AirtableGrid,AirtableList} from '@miniextensions/sdk/react';
import type {FormRenderScope,PortalRenderScope} from '@miniextensions/sdk/ui';
export function JSX(props:MultipleAttachmentsFieldProps) {return <MultipleAttachmentsField {...props} className="attachments"/>;}
// @ts-expect-error The adapter cannot save or replace native attachments.
export function InvalidJSX(props:MultipleAttachmentsFieldProps) {return <MultipleAttachmentsField {...props} onChange={()=>{}}/>;}
export function Screens({form,portal}:{form:FormRenderScope;portal:PortalRenderScope}) {return <>
 <AirtableForm scope={form} renderers={renderers}>{state=>state.fields.map(field=>field.node)}</AirtableForm>
 <AirtableGrid scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableGrid>
 <AirtableList scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableList>
 </>;}
`
        : ''
}
`;
}

export const multipleAttachmentsNodeTypedConsumer =
    multipleAttachmentsTypedConsumer();
export const multipleAttachmentsReactTypedConsumer =
    multipleAttachmentsTypedConsumer({ jsx: true });

/** Installed ESM/CJS only; all upload/save implementations are in-memory stubs. */
export async function checkMultipleAttachmentsConsumer({
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
        throw Error('No external attachment request');
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
    const { createElement: h, act, StrictMode } = require('react');
    const { createRoot } = require('react-dom/client');
    const temporary = mkdtempSync(
        join(consumerDirectory, '.multiple-attachments-consumer-')
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
            await check('public exports and private subpaths', async () => {
                assert.equal(
                    typeof renderer.MultipleAttachmentsField,
                    'function'
                );
                assert.equal(
                    typeof renderer.renderMultipleAttachmentsField,
                    'function'
                );
                for (const namespace of [core, forms, portals, ui]) {
                    assert.equal(namespace.MultipleAttachmentsField, undefined);
                    assert.equal(
                        namespace.renderMultipleAttachmentsField,
                        undefined
                    );
                }
                for (const subpath of [
                    'react/MultipleAttachmentsField',
                    `dist/${format}/react/MultipleAttachmentsField.js`,
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
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            let root = createRoot(container);
            const owners = [],
                hosts = [],
                scopes = [];
            let protectedReads = 0,
                genericWrites = 0,
                rowEvents = 0,
                saves = 0,
                uploadCalls = 0;
            const poison = () => {
                protectedReads++;
                throw Error('Protected native metadata was read');
            };
            const button = (name) =>
                [...container.querySelectorAll('button')].find(
                    (node) => node.textContent === name
                );
            const noResources = () => {
                assert.equal(
                    container.querySelector(
                        'a,img,video,audio,canvas,iframe,object,embed,svg,[contenteditable=true]'
                    ),
                    null
                );
                assert.equal(container.innerHTML.includes('PRIVATE_'), false);
                assert.equal(button('Save'), undefined);
            };
            const inert = () => {
                assert(container.textContent.includes(unavailable));
                assert.equal(container.querySelector('input,button'), null);
                noResources();
            };
            const render = async (props) =>
                act(async () =>
                    root.render(renderer.renderMultipleAttachmentsField(props))
                );
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
                            'onChange',
                        ].map((key) => [key, () => rowEvents++])
                    ),
                    node
                );
            const make = ({
                config = {},
                values,
                recovery = true,
                hidden = false,
                persisted,
            } = {}) => {
                const { loaded, native } = multipleAttachmentsLoadedFixture({
                    config,
                    values,
                });
                if (persisted !== undefined)
                    loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {
                        files: structuredClone(persisted),
                    };
                const requests = [],
                    saveInputs = [];
                let current = true,
                    permitted = !hidden,
                    ownerScope = {
                        ownerId: `attachments-${format}-${owners.length}`,
                        revision: 0,
                    };
                const client = core.createMiniExtensionsClient({
                    apiOrigin: 'https://sdk.example.invalid',
                    fetch: async () => {
                        network++;
                        throw Error('External network forbidden');
                    },
                });
                client.forms.save = async (input) => {
                    saves++;
                    saveInputs.push(structuredClone(input));
                    return {
                        type: 'error',
                        formErrors: {},
                        formValidationErrors: [],
                    };
                };
                client.attachments.uploadFile = async (input, options) => {
                    uploadCalls++;
                    requests.push({ input, options });
                    return {
                        url: 'https://files.example.invalid/PRIVATE_uploaded',
                        filename: 'Accepted synthetic upload',
                        type: input.file.type,
                        size: input.file.size,
                        id: null,
                    };
                };
                const owner = forms.createFormFieldBindings({
                    client,
                    loaded,
                    getScope: () => ownerScope,
                    canWriteField: () => permitted,
                    saveOptions: multipleAttachmentsSaveOptions,
                });
                owners.push(owner);
                const journal = new forms.RecoveryJournal();
                const recoveryOptions = {
                    journal,
                    loadVersion: 1,
                    scope: {
                        owner: ownerScope.ownerId,
                        parentFieldId: null,
                        tableId: null,
                        childExtensionId: 'form',
                        context: 'modal',
                    },
                };
                const controller = recovery
                    ? owner.attachment('files', recoveryOptions)
                    : null;
                const host = ui.createFormFieldRendererHost({
                    fields: owner,
                    fieldId: 'files',
                    isCurrent: () => current,
                    configurationRevision: () => 0,
                    ...(recovery
                        ? { attachmentRecovery: recoveryOptions }
                        : {}),
                });
                hosts.push(host);
                const props = () => {
                    const state = host.getSnapshot();
                    assert.equal(state.status, 'ready');
                    return state.fields[0];
                };
                const tree = () =>
                    h(
                        StrictMode,
                        null,
                        isolate(
                            h(react.FieldRenderer, {
                                host,
                                renderers: {
                                    renderMultipleAttachmentsField:
                                        renderer.renderMultipleAttachmentsField,
                                },
                                fallback: () => null,
                            })
                        )
                    );
                return {
                    loaded,
                    native,
                    owner,
                    client,
                    controller,
                    journal,
                    recoveryOptions,
                    host,
                    props,
                    tree,
                    requests,
                    saveInputs,
                    retire: () => {
                        current = false;
                        owner.refresh();
                    },
                    hide: () => {
                        permitted = false;
                        owner.refresh();
                    },
                    replaceScope: () => {
                        ownerScope = { ownerId: 'replacement', revision: 1 };
                        owner.refresh();
                    },
                };
            };
            try {
                const f = make();
                const base = f.props();
                const before = structuredClone(
                    f.owner.controller.getState().draft
                );
                await check(
                    'accepted Form rows retain literal order and duplicate occurrences',
                    async () => {
                        await act(async () => root.render(f.tree()));
                        const labels = f.controller
                            .getSnapshot()
                            .rows.map((row) => row.label);
                        assert.deepEqual(
                            labels,
                            f.native.map((row) => row.filename)
                        );
                        const list =
                            container.querySelector('ul,ol,[role=list]');
                        assert(list);
                        assert.deepEqual(
                            [
                                ...list.querySelectorAll('li,[role=listitem]'),
                            ].map((node) =>
                                node.textContent.replace(
                                    'Remove attachment',
                                    ''
                                )
                            ),
                            labels
                        );
                        assert.equal(list.querySelector('strong'), null);
                        assert.equal(
                            container.querySelectorAll('input[type=file]')
                                .length,
                            1
                        );
                        assert.equal(
                            container.querySelector('input[type=file]')
                                .multiple,
                            true
                        );
                        const section = container.querySelector('section');
                        assert.equal(
                            section.getAttribute('aria-label'),
                            'Files'
                        );
                        const feedback = window.document.getElementById(
                            section.getAttribute('aria-describedby')
                        );
                        assert.equal(feedback.getAttribute('role'), 'status');
                        for (const control of container.querySelectorAll(
                            'button'
                        ))
                            assert.equal(control.type, 'button');
                        assert(button('Upload next file').disabled);
                        noResources();
                        assert.deepEqual(
                            f.owner.controller.getState().draft,
                            before
                        );
                    }
                );
                await check(
                    'direct component uses filtered labels and never native value or generic setter',
                    async () => {
                        const props = {
                            ...base,
                            capability: { ...base.capability },
                        };
                        Object.defineProperty(props, 'value', { get: poison });
                        Object.defineProperty(props.capability, 'setValue', {
                            get: () => {
                                genericWrites++;
                                throw Error('Generic setter read');
                            },
                        });
                        await act(async () =>
                            root.render(
                                h(renderer.MultipleAttachmentsField, {
                                    field: props,
                                    className: 'installed-attachment-adapter',
                                })
                            )
                        );
                        assert(
                            container.querySelector(
                                '.installed-attachment-adapter'
                            )
                        );
                        assert(
                            container.textContent.includes(f.native[0].filename)
                        );
                        assert.equal(protectedReads, 0);
                        assert.equal(genericWrites, 0);
                        noResources();
                    }
                );
                for (const side of ['displayConfig', 'writeConfig'])
                    for (const flag of [
                        'obscurePassword',
                        'maskPasswordOnLoginScreen',
                    ]) {
                        await check(
                            `mask before capability and native access: ${side}.${flag}`,
                            async () => {
                                const props = {
                                    ...base,
                                    displayConfig: {},
                                    writeConfig: {},
                                    [side]: { [flag]: true },
                                };
                                Object.defineProperties(props, {
                                    value: { get: poison },
                                    capability: { get: poison },
                                });
                                await render(props);
                                assert(container.textContent.includes(mask));
                                assert.equal(
                                    container.querySelector('input,button'),
                                    null
                                );
                                assert.equal(protectedReads, 0);
                                noResources();
                            }
                        );
                    }
                for (const context of [
                    'portal-cell',
                    'portal-detail',
                    'linked-detail',
                ])
                    await check(
                        `inert ${context} never reads capability or native value`,
                        async () => {
                            const props = { ...base, context };
                            Object.defineProperties(props, {
                                value: { get: poison },
                                capability: { get: poison },
                            });
                            await render(props);
                            inert();
                            assert.equal(protectedReads, 0);
                        }
                    );
                await check(
                    'computed attachment slot is inert before capability access',
                    async () => {
                        const props = { ...base, computed: true };
                        Object.defineProperties(props, {
                            value: { get: poison },
                            capability: { get: poison },
                        });
                        await render(props);
                        inert();
                        assert.equal(protectedReads, 0);
                    }
                );
                for (const capability of [
                    { type: 'readonly' },
                    { type: 'editable', setValue: poison },
                    { type: 'editable', setValue: poison, attachment: null },
                ])
                    await check(
                        `missing safe facet ${JSON.stringify({ type: capability.type, facet: capability.attachment === null })}`,
                        async () => {
                            const props = { ...base, capability };
                            Object.defineProperty(props, 'value', {
                                get: poison,
                            });
                            await render(props);
                            inert();
                            assert.equal(protectedReads, 0);
                        }
                    );
                await check(
                    'real editable host without recovery has no attachment actions',
                    async () => {
                        const absent = make({ recovery: false });
                        assert.equal(
                            absent.props().capability.type,
                            'editable'
                        );
                        assert.equal(
                            absent.props().capability.attachment,
                            undefined
                        );
                        await act(async () => root.render(absent.tree()));
                        inert();
                    }
                );
                await check(
                    'real readonly Form exposes no native presentation or attachment actions',
                    async () => {
                        const readonly = make({ config: { readOnly: true } });
                        assert.equal(
                            readonly.props().capability.type,
                            'readonly'
                        );
                        await act(async () => root.render(readonly.tree()));
                        inert();
                        assert.equal(
                            container.textContent.includes('Literal duplicate'),
                            false
                        );
                    }
                );
                await check(
                    'opaque pending Files and irrelevant metadata remain unread',
                    async () => {
                        const files = [];
                        Object.defineProperty(files, 0, {
                            get: poison,
                            enumerable: true,
                        });
                        const row = {
                            nativeIndex: 6,
                            label: 'Filtered safe row',
                            removeAllowed: true,
                            openAllowed: true,
                            downloadAllowed: true,
                        };
                        for (const key of [
                            'url',
                            'filename',
                            'size',
                            'type',
                            'thumbnails',
                            'attachment',
                            'openAllowed',
                            'downloadAllowed',
                        ])
                            Object.defineProperty(row, key, { get: poison });
                        const state = {
                            ...base.capability.attachment.state,
                            rows: [row],
                            files,
                        };
                        Object.defineProperty(state, 'value', { get: poison });
                        await render({
                            ...base,
                            capability: {
                                ...base.capability,
                                attachment: {
                                    ...base.capability.attachment,
                                    state,
                                },
                            },
                        });
                        assert(
                            container.textContent.includes('Filtered safe row')
                        );
                        assert(
                            container.textContent.includes('1 pending file')
                        );
                        assert.equal(protectedReads, 0);
                        noResources();
                    }
                );
                const safeState = base.capability.attachment.state;
                const malformed = [
                    ['null', null],
                    ['array', []],
                    ['rows missing', { ...safeState, rows: undefined }],
                    ['sparse rows', { ...safeState, rows: Array(1) }],
                    ['null row', { ...safeState, rows: [null] }],
                    [
                        'object label',
                        {
                            ...safeState,
                            rows: [
                                {
                                    ...safeState.rows[0],
                                    label: { toString: poison },
                                },
                            ],
                        },
                    ],
                    [
                        'negative native index',
                        {
                            ...safeState,
                            rows: [{ ...safeState.rows[0], nativeIndex: -1 }],
                        },
                    ],
                    [
                        'fractional native index',
                        {
                            ...safeState,
                            rows: [{ ...safeState.rows[0], nativeIndex: 0.5 }],
                        },
                    ],
                    [
                        'coerced native index',
                        {
                            ...safeState,
                            rows: [{ ...safeState.rows[0], nativeIndex: '0' }],
                        },
                    ],
                    [
                        'malformed remove permission',
                        {
                            ...safeState,
                            rows: [
                                { ...safeState.rows[0], removeAllowed: 'yes' },
                            ],
                        },
                    ],
                    ['files missing', { ...safeState, files: undefined }],
                    ['files not array', { ...safeState, files: { length: 2 } }],
                    ['sparse files', { ...safeState, files: Array(1) }],
                    [
                        'repeated native index',
                        {
                            ...safeState,
                            rows: [safeState.rows[0], safeState.rows[0]],
                        },
                    ],
                    [
                        'decreasing native indexes',
                        {
                            ...safeState,
                            rows: [safeState.rows[1], safeState.rows[0]],
                        },
                    ],
                    [
                        'negative snapshot revision',
                        { ...safeState, revision: -1 },
                    ],
                    [
                        'unsafe values revision',
                        { ...safeState, valuesRevision: Infinity },
                    ],
                    ['malformed busy', { ...safeState, busy: 'true' }],
                    ['malformed retired', { ...safeState, retired: 'false' }],
                    ['unknown phase', { ...safeState, phase: 'retry-now' }],
                    [
                        'unknown presentation',
                        { ...safeState, presentation: 'visible' },
                    ],
                    [
                        'malformed error',
                        { ...safeState, error: { toString: poison } },
                    ],
                ];
                for (const [name, state] of malformed)
                    await check(
                        `malformed filtered state fails closed: ${name}`,
                        async () => {
                            await render({
                                ...base,
                                capability: {
                                    ...base.capability,
                                    attachment: {
                                        ...base.capability.attachment,
                                        state,
                                    },
                                },
                            });
                            inert();
                            assert.equal(protectedReads, 0);
                        }
                    );
                for (const member of ['files', 'rows'])
                    await check(
                        `hostile ${member} length fails closed without coercion`,
                        async () => {
                            const array = new Proxy([], {
                                get(target, key, receiver) {
                                    return key === 'length'
                                        ? { valueOf: poison, toString: poison }
                                        : Reflect.get(target, key, receiver);
                                },
                            });
                            await render({
                                ...base,
                                capability: {
                                    ...base.capability,
                                    attachment: {
                                        ...base.capability.attachment,
                                        state: {
                                            ...safeState,
                                            [member]: array,
                                        },
                                    },
                                },
                            });
                            inert();
                            assert.equal(protectedReads, 0);
                        }
                    );
                for (const member of [
                    'state',
                    'select',
                    'clear',
                    'remove',
                    'upload',
                    'cancel',
                ])
                    await check(
                        `throwing facet member fails closed: ${member}`,
                        async () => {
                            const attachment = {
                                ...base.capability.attachment,
                            };
                            Object.defineProperty(attachment, member, {
                                get: () => {
                                    throw Error('Hostile facet member');
                                },
                            });
                            await render({
                                ...base,
                                capability: { ...base.capability, attachment },
                            });
                            inert();
                        }
                    );
                await check(
                    'retired filtered state does not render rows or queue',
                    async () => {
                        const state = {
                            ...safeState,
                            retired: true,
                            phase: 'retired',
                        };
                        Object.defineProperties(state, {
                            rows: { get: poison },
                            files: { get: poison },
                        });
                        await render({
                            ...base,
                            capability: {
                                ...base.capability,
                                attachment: {
                                    ...base.capability.attachment,
                                    state,
                                },
                            },
                        });
                        assert.equal(
                            container.querySelector('input,button'),
                            null
                        );
                        assert.equal(
                            container.textContent.includes(
                                f.native[0].filename
                            ),
                            false
                        );
                        assert.equal(protectedReads, 0);
                    }
                );
                await check(
                    'filtered unavailable presentation cannot expose rows',
                    async () => {
                        let clears = 0,
                            cancels = 0,
                            forbiddenActions = 0;
                        const state = {
                            ...safeState,
                            presentation: 'unavailable',
                            files: [
                                Object.defineProperty({}, 'name', {
                                    get: poison,
                                }),
                            ],
                            busy: true,
                            phase: 'uploading',
                        };
                        Object.defineProperty(state, 'rows', { get: poison });
                        await render({
                            ...base,
                            capability: {
                                ...base.capability,
                                attachment: {
                                    ...base.capability.attachment,
                                    state,
                                    select: () => {
                                        forbiddenActions++;
                                        return false;
                                    },
                                    upload: async () => {
                                        forbiddenActions++;
                                        return false;
                                    },
                                    clear: () => {
                                        clears++;
                                    },
                                    cancel: () => {
                                        cancels++;
                                    },
                                },
                            },
                        });
                        assert(container.textContent.includes(unavailable));
                        assert.equal(container.querySelector('li'), null);
                        assert(button('Choose files').disabled);
                        assert(button('Upload next file').disabled);
                        await act(async () =>
                            button('Clear pending files').click()
                        );
                        await act(async () => button('Cancel upload').click());
                        assert.equal(clears, 1);
                        assert.equal(cancels, 1);
                        assert.equal(forbiddenActions, 0);
                        noResources();
                        assert.equal(protectedReads, 0);
                    }
                );
                await check(
                    'private error details are replaced by generic feedback',
                    async () => {
                        await render({
                            ...base,
                            error: 'PRIVATE_owner_error',
                            capability: {
                                ...base.capability,
                                attachment: {
                                    ...base.capability.attachment,
                                    state: {
                                        ...safeState,
                                        error: 'PRIVATE_controller_error',
                                    },
                                },
                            },
                        });
                        assert.equal(
                            container
                                .querySelector('section')
                                .getAttribute('aria-invalid'),
                            'true'
                        );
                        assert(container.querySelector('[role=status]'));
                        noResources();
                    }
                );
                await check(
                    'render events stay inside the adapter without native default cancellation',
                    async () => {
                        const attachment = {
                            state: safeState,
                            select: () => true,
                            clear: () => {},
                            remove: () => true,
                            upload: async () => true,
                            cancel: () => {},
                        };
                        await act(async () =>
                            root.render(
                                isolate(
                                    renderer.renderMultipleAttachmentsField({
                                        ...base,
                                        capability: {
                                            type: 'editable',
                                            setValue: poison,
                                            attachment,
                                        },
                                    })
                                )
                            )
                        );
                        for (const node of container.querySelectorAll(
                            'section,label,li,input,button,output'
                        ))
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
                                await act(async () =>
                                    node.dispatchEvent(event)
                                );
                                assert.equal(event.defaultPrevented, false);
                            }
                        assert.equal(rowEvents, 0);
                        assert.equal(protectedReads, 0);
                    }
                );
                await check(
                    'picker selection is local and empty completion preserves queue',
                    async () => {
                        await act(async () => root.render(f.tree()));
                        const input =
                            container.querySelector('input[type=file]');
                        const first = new window.File(
                            ['one'],
                            'PRIVATE_first.txt',
                            { type: 'text/plain' }
                        );
                        const second = new window.File(
                            ['two'],
                            'PRIVATE_second.txt',
                            { type: 'text/plain' }
                        );
                        Object.defineProperty(input, 'files', {
                            configurable: true,
                            value: [first, second],
                        });
                        await act(async () =>
                            input.dispatchEvent(
                                new window.Event('change', { bubbles: true })
                            )
                        );
                        assert.deepEqual(f.controller.getSnapshot().files, [
                            first,
                            second,
                        ]);
                        assert.equal(uploadCalls, 0);
                        assert.equal(saves, 0);
                        assert.equal(rowEvents, 0);
                        noResources();
                        Object.defineProperty(input, 'files', {
                            configurable: true,
                            value: [],
                        });
                        await act(async () =>
                            input.dispatchEvent(
                                new window.Event('change', { bubbles: true })
                            )
                        );
                        await act(async () =>
                            input.dispatchEvent(
                                new window.Event('cancel', {
                                    bubbles: true,
                                    cancelable: true,
                                })
                            )
                        );
                        assert.deepEqual(f.controller.getSnapshot().files, [
                            first,
                            second,
                        ]);
                    }
                );
                await check(
                    'StrictMode unmount and remount retain owner queue and draft',
                    async () => {
                        const pending = f.controller.getSnapshot().files;
                        await act(async () => root.unmount());
                        root = createRoot(container);
                        await act(async () => root.render(f.tree()));
                        assert.deepEqual(
                            f.controller.getSnapshot().files,
                            pending
                        );
                        assert.deepEqual(
                            f.owner.controller.getState().draft,
                            before
                        );
                        assert(
                            container.textContent.includes('2 pending files')
                        );
                        assert.equal(uploadCalls, 0);
                        assert.equal(saves, 0);
                        noResources();
                    }
                );
                await check(
                    'explicit Upload processes only first File and never Save',
                    async () => {
                        const pending = f.controller.getSnapshot().files;
                        await act(async () =>
                            button('Upload next file').click()
                        );
                        assert.equal(f.requests.length, 1);
                        assert.equal(f.requests[0].input.file, pending[0]);
                        assert.deepEqual(f.controller.getSnapshot().files, [
                            pending[1],
                        ]);
                        assert.equal(
                            f.owner.field('files').getSnapshot().value.length,
                            f.native.length + 1
                        );
                        assert.equal(saves, 0);
                        assert.equal(
                            f.journal.unknown(f.recoveryOptions.scope.owner)
                                .length,
                            0
                        );
                        noResources();
                    }
                );
                await check(
                    'pending queue blocks Save until separate clear and owner Save',
                    async () => {
                        await assert.rejects(f.owner.save());
                        assert.equal(saves, 0);
                        await act(async () =>
                            button('Clear pending files').click()
                        );
                        assert.deepEqual(f.controller.getSnapshot().files, []);
                        const nativeBeforeSave = structuredClone(
                            f.owner.field('files').getSnapshot().value
                        );
                        await act(async () => f.owner.save());
                        assert.equal(saves, 1);
                        assert.equal(f.saveInputs.length, 1);
                        assert.deepEqual(
                            f.saveInputs[0].formRecord.data.files,
                            nativeBeforeSave
                        );
                        assert.equal(f.requests.length, 1);
                    }
                );
                await check(
                    'remove uses native occurrence index and stale retained action refuses replay',
                    async () => {
                        await act(async () => root.render(f.tree()));
                        const stale = f.props().capability.attachment;
                        const beforeRemoval = structuredClone(
                            f.owner.field('files').getSnapshot().value
                        );
                        const removals = [
                            ...container.querySelectorAll('button'),
                        ].filter(
                            (node) => node.textContent === 'Remove attachment'
                        );
                        assert.equal(removals.length, beforeRemoval.length);
                        await act(async () => removals[1].click());
                        assert.deepEqual(
                            f.owner.field('files').getSnapshot().value,
                            beforeRemoval.filter((_, index) => index !== 1)
                        );
                        const after = structuredClone(
                            f.owner.field('files').getSnapshot().value
                        );
                        assert.equal(stale.remove(0), false);
                        assert.deepEqual(
                            f.owner.field('files').getSnapshot().value,
                            after
                        );
                        assert.equal(f.requests.length, 1);
                    }
                );
                await check(
                    'missing add-only persisted baseline cannot be guessed',
                    async () => {
                        const privateRow = {
                            url: 'https://files.example.invalid/PRIVATE_persisted',
                            filename: 'PRIVATE_persisted_name',
                        };
                        const visibleRow = {
                            url: 'https://files.example.invalid/PRIVATE_new',
                            filename: 'Visible synthetic label',
                        };
                        const add = make({
                            config: {
                                addOnlyMode: true,
                                showExistingValuesForAddOnlyMode: false,
                            },
                            values: [privateRow, visibleRow],
                        });
                        // The missing persisted baseline is intentionally unavailable; it cannot be guessed by the adapter.
                        await act(async () => root.render(add.tree()));
                        inert();
                        assert.deepEqual(
                            add.owner.field('files').getSnapshot().value,
                            [privateRow, visibleRow]
                        );
                    }
                );
                await check(
                    'add-only filtered rows keep original native indexes without exposing hidden positions',
                    async () => {
                        const hidden = {
                            url: 'https://files.example.invalid/PRIVATE_persisted',
                            filename: 'PRIVATE_persisted_name',
                        };
                        const visible = {
                            url: 'https://files.example.invalid/PRIVATE_new',
                            filename: 'Visible synthetic label',
                        };
                        const add = make({
                            config: {
                                addOnlyMode: true,
                                showExistingValuesForAddOnlyMode: false,
                            },
                            values: [hidden, hidden, visible],
                            persisted: [hidden],
                        });
                        await act(async () => root.render(add.tree()));
                        assert.deepEqual(
                            add.controller
                                .getSnapshot()
                                .rows.map((row) => [
                                    row.nativeIndex,
                                    row.label,
                                ]),
                            [[2, visible.filename]]
                        );
                        const remove = button('Remove attachment');
                        assert.equal(
                            remove.getAttribute('aria-label'),
                            'Remove attachment 1'
                        );
                        noResources();
                        await act(async () => remove.click());
                        assert.deepEqual(
                            add.owner.field('files').getSnapshot().value,
                            [hidden, hidden]
                        );
                        assert.equal(
                            container.textContent.includes(visible.filename),
                            false
                        );
                        noResources();
                    }
                );
                await check(
                    'owner privacy default hides native filenames even though values retain them',
                    async () => {
                        const privacy = make({
                            config: { hideAttachmentName: true },
                        });
                        await act(async () => root.render(privacy.tree()));
                        assert.deepEqual(
                            privacy.controller
                                .getSnapshot()
                                .rows.map((row) => row.label),
                            ['Attachment', 'Attachment', 'Attachment']
                        );
                        assert.equal(
                            container.textContent.includes('Literal duplicate'),
                            false
                        );
                        noResources();
                    }
                );
                await check(
                    'uncertain upload never retries, appends or saves automatically',
                    async () => {
                        const uncertain = make();
                        uncertain.client.attachments.uploadFile = async () => {
                            uploadCalls++;
                            throw Error('Synthetic unknown result');
                        };
                        await act(async () => root.render(uncertain.tree()));
                        const file = new window.File(
                            ['x'],
                            'PRIVATE_unknown.txt',
                            { type: 'text/plain' }
                        );
                        await act(async () =>
                            uncertain.controller.select([file])
                        );
                        const beforeCalls = uploadCalls;
                        await act(async () =>
                            button('Upload next file').click()
                        );
                        assert.equal(uploadCalls, beforeCalls + 1);
                        assert.equal(
                            uncertain.controller.getSnapshot().phase,
                            'uncertain'
                        );
                        assert(button('Upload next file').disabled);
                        assert.equal(
                            uncertain.journal.unknown(
                                uncertain.recoveryOptions.scope.owner
                            ).length,
                            1
                        );
                        assert.deepEqual(
                            uncertain.owner.field('files').getSnapshot().value,
                            uncertain.native
                        );
                        await act(async () =>
                            button('Upload next file').click()
                        );
                        assert.equal(uploadCalls, beforeCalls + 1);
                        await act(async () =>
                            button('Clear pending files').click()
                        );
                        assert.deepEqual(
                            uncertain.controller.getSnapshot().files,
                            []
                        );
                        assert.equal(
                            uncertain.controller.getSnapshot().phase,
                            'uncertain'
                        );
                        assert.equal(
                            uncertain.journal.unknown(
                                uncertain.recoveryOptions.scope.owner
                            ).length,
                            1
                        );
                        await assert.rejects(uncertain.owner.save());
                        assert.equal(saves, 1);
                        noResources();
                    }
                );
                await check(
                    'cancel late completion cannot append or clear uncertainty',
                    async () => {
                        const cancel = make();
                        let settle;
                        cancel.client.attachments.uploadFile = (
                            input,
                            options
                        ) => {
                            uploadCalls++;
                            cancel.requests.push({ input, options });
                            return new Promise((resolve) => {
                                settle = resolve;
                            });
                        };
                        await act(async () => root.render(cancel.tree()));
                        const file = new window.File(
                            ['x'],
                            'PRIVATE_cancel.txt',
                            { type: 'text/plain' }
                        );
                        await act(async () => cancel.controller.select([file]));
                        await act(async () =>
                            button('Upload next file').click()
                        );
                        assert.equal(
                            cancel.controller.getSnapshot().busy,
                            true
                        );
                        assert(button('Cancel upload'));
                        await act(async () => button('Cancel upload').click());
                        assert.equal(
                            cancel.requests[0].options.signal.aborted,
                            true
                        );
                        await act(async () =>
                            settle({
                                url: 'https://files.example.invalid/PRIVATE_late',
                                filename: 'PRIVATE_late',
                                size: file.size,
                                type: file.type,
                            })
                        );
                        assert.equal(
                            cancel.controller.getSnapshot().phase,
                            'uncertain'
                        );
                        assert.equal(
                            cancel.controller.getSnapshot().busy,
                            false
                        );
                        assert.deepEqual(
                            cancel.owner.field('files').getSnapshot().value,
                            cancel.native
                        );
                        assert.equal(saves, 1);
                        noResources();
                    }
                );
                await check(
                    'retired lease rejects retained select clear remove upload and cancel actions',
                    async () => {
                        const retired = make();
                        await act(async () => root.render(retired.tree()));
                        const file = new window.File(
                            ['x'],
                            'PRIVATE_retained.txt',
                            { type: 'text/plain' }
                        );
                        await act(async () =>
                            retired.controller.select([file])
                        );
                        const held = retired.props().capability.attachment;
                        const pending = retired.controller.getSnapshot().files;
                        await act(async () => retired.retire());
                        assert.equal(
                            container.querySelector('input,button'),
                            null
                        );
                        assert.equal(
                            held.select([new window.File(['y'], 'new.txt')]),
                            false
                        );
                        held.clear();
                        held.cancel();
                        assert.equal(held.remove(0), false);
                        assert.equal(await held.upload(), false);
                        assert.deepEqual(
                            retired.controller.getSnapshot().files,
                            pending
                        );
                        assert.deepEqual(
                            retired.owner.field('files').getSnapshot().value,
                            retired.native
                        );
                    }
                );
                await check(
                    'hidden host renders no private rows or attachment input',
                    async () => {
                        const hidden = make();
                        await act(async () => root.render(hidden.tree()));
                        await act(async () => hidden.hide());
                        assert.equal(
                            container.querySelector('input,button'),
                            null
                        );
                        assert.equal(
                            container.textContent.includes('Literal duplicate'),
                            false
                        );
                        noResources();
                    }
                );
                await check(
                    'owner scope replacement retires old renderer and guarded actions',
                    async () => {
                        const replacement = make();
                        await act(async () => root.render(replacement.tree()));
                        const held = replacement.props().capability.attachment;
                        await act(async () => replacement.replaceScope());
                        assert.equal(
                            container.querySelector('input,button'),
                            null
                        );
                        assert.equal(
                            held.select([
                                new window.File(
                                    ['x'],
                                    'PRIVATE_replacement.txt'
                                ),
                            ]),
                            false
                        );
                        assert.equal(held.remove(0), false);
                        assert.equal(await held.upload(), false);
                        noResources();
                    }
                );
                const portal = fixtures.makePortal();
                const field =
                    f.loaded.payload.fieldIdsToSchemas.files.airtableField;
                const details = [
                    {
                        fieldId: 'files',
                        fieldName: 'Files',
                        titleOverride: null,
                        isHidden: false,
                        fieldIsInEditingChildForm: false,
                        childFormField: null,
                        miniExtConfig: { hideAttachmentName: false },
                    },
                ];
                portal.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [field];
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children =
                    details;
                let portalReads = 0;
                const record = {
                    id: 'rec_attachments',
                    fields: { files: f.native },
                };
                const portalClient = {
                    getSession: () => ({}),
                    portals: {
                        listLinkedRecords: async () => {
                            portalReads++;
                            return fixtures.page([record], null, {
                                customViewDetailFields: {
                                    fld_children: details,
                                },
                                tableIdsToLinkedTableStates: {
                                    tbl_children: {
                                        airtableFields: [field],
                                        recordIdsToAirtableRecords: {
                                            rec_attachments: record,
                                        },
                                    },
                                },
                            });
                        },
                        updateGridCell: poison,
                    },
                };
                const portalOwner = portals.createPortalListOwner({
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
                        ownerId: 'attachment-portal',
                        revision: 0,
                    }),
                });
                owners.push(portalOwner);
                const portalScope = ui.createPortalRenderScope({
                    owner: portalOwner,
                    client: portalClient,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                scopes.push(portalScope);
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
                ])
                    await check(
                        `accepted readonly Portal ${Component === react.AirtableGrid ? 'Grid' : 'List'} is strictly inert`,
                        async () => {
                            await act(async () =>
                                root.render(
                                    h(
                                        Component,
                                        {
                                            scope: portalScope,
                                            renderers: {
                                                renderMultipleAttachmentsField:
                                                    renderer.renderMultipleAttachmentsField,
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
                            inert();
                            assert.equal(portalReads, 1);
                            assert.equal(
                                container.textContent.includes(
                                    'Literal duplicate'
                                ),
                                false
                            );
                            assert.deepEqual(
                                portalScope
                                    .getSnapshot()
                                    .rows[0].cells[0].host.getSnapshot()
                                    .fields[0].value,
                                f.native
                            );
                        }
                    );
                await check(
                    'retired Portal disappears and no work escaped synthetic owners',
                    async () => {
                        await act(async () => portalOwner.destroy());
                        assert.equal(container.textContent, '');
                        assert.equal(network, 0);
                        assert.equal(protectedReads, 0);
                        assert.equal(genericWrites, 0);
                        assert.equal(rowEvents, 0);
                    }
                );
                formats.push({
                    format,
                    rendererModule:
                        mode === 'public-export'
                            ? '@miniextensions/sdk/react'
                            : resolve(modulePaths[format]),
                    checks: scenarios.length,
                    scenarios,
                    uploadCalls,
                    explicitSaveCalls: saves,
                    network,
                    protectedReads,
                    genericWrites,
                    rowEvents,
                    portalReads,
                });
            } finally {
                await act(async () => root.unmount());
                for (const scope of scopes.reverse()) scope.destroy();
                for (const host of hosts.reverse()) host.dispose();
                for (const owner of owners.reverse()) owner.destroy();
                container.remove();
            }
        }
        assert.equal(checks, multipleAttachmentsConsumerCheckCount);
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
