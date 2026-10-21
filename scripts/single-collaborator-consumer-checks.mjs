import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const singleCollaboratorConsumerCheckCount = 94;

export const singleCollaboratorReactTypedConsumer = `
import type { ReactNode } from 'react';
import { SingleCollaboratorField, renderSingleCollaboratorField, AirtableForm, AirtableGrid, AirtableList, type SingleCollaboratorFieldProps, type SingleCollaboratorFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
const options: SingleCollaboratorFieldOptions = {className:'singleCollaborator-consumer'};
// @ts-expect-error SingleCollaborator presentation grants no editor option.
const write: SingleCollaboratorFieldOptions = {setValue: (value: unknown) => {}};
// @ts-expect-error SingleCollaborator presentation has no Clear action.
const clear: SingleCollaboratorFieldOptions = {clearLabel:'Clear'};
// @ts-expect-error Name presentation does not search or look up identities.
const search: SingleCollaboratorFieldOptions = {search: () => {}};
// @ts-expect-error Identity metadata cannot enable avatar loading.
const avatar: SingleCollaboratorFieldOptions = {showAvatar:true};
// @ts-expect-error A supplied name is not a link.
const link: SingleCollaboratorFieldOptions = {href:'https://example.invalid'};
// @ts-expect-error SingleCollaboratorField is not a core export.
import { SingleCollaboratorField as coreSingleCollaborator } from '@miniextensions/sdk';
// @ts-expect-error SingleCollaborator renderer is not a headless UI export.
import { renderSingleCollaboratorField as headlessSingleCollaborator } from '@miniextensions/sdk/ui';
// @ts-expect-error The internal control is not a public React export.
import { SingleCollaboratorControl } from '@miniextensions/sdk/react';
export const renderers: FieldRendererSlots<ReactNode> = {renderSingleCollaboratorField: props => renderSingleCollaboratorField(props,options)};
export function Bound(props:SingleCollaboratorFieldProps) {return <SingleCollaboratorField {...props} {...options}/>;}
export function Override(props:SingleCollaboratorFieldProps) {return <SingleCollaboratorField {...props} render={({snapshot}) => <span>{String(snapshot.value == null)}</span>}/>;}
export function Kinds(singleCollaborator:FieldRendererProps<'singleCollaborator'>,text:FieldRendererProps<'singleLineText'>,multiple:FieldRendererProps<'multipleCollaborators'>) {
 const native: {id:string;email:string;name:string;profilePicUrl?:string}|null|undefined=singleCollaborator.value;
 const supplied: FieldRendererProps<'singleCollaborator'>['value']={id:'usr_test',email:'test@example.invalid',name:'Name'};
 const extraNative={id:'usr_test',email:'test@example.invalid',name:'Name',extra:{accepted:true}};
 const withExtra: FieldRendererProps<'singleCollaborator'>['value']=extraNative;
 // Display coverage must not narrow the existing editable native-object contract.
 const capability: FieldRendererProps<'singleCollaborator'>['capability']={type:'editable',setValue:value=>({accepted:true})};
 // @ts-expect-error A text field is not a SingleCollaborator physical slot.
 renderSingleCollaboratorField(text);
 // @ts-expect-error Multiple Collaborators is a different physical slot.
 renderSingleCollaboratorField(multiple);
 // @ts-expect-error Single Collaborator does not use scalar identity strings.
 const scalar: FieldRendererProps<'singleCollaborator'>['value']='usr_test';
 // @ts-expect-error A collaborator native name is required even when blank.
 const missingName: FieldRendererProps<'singleCollaborator'>['value']={id:'usr_test',email:'test@example.invalid'};
 // @ts-expect-error A collaborator native email is required.
 const missingEmail: FieldRendererProps<'singleCollaborator'>['value']={id:'usr_test',name:'Name'};
 // @ts-expect-error Profile image metadata is an optional string.
 const invalidAvatar: FieldRendererProps<'singleCollaborator'>['value']={id:'usr_test',email:'test@example.invalid',name:'Name',profilePicUrl:1};
 return {native,supplied,withExtra,capability};
}
export function Compositions({form,portal}:{form:FormRenderScope;portal:PortalRenderScope}) {return <>
 <AirtableForm scope={form} renderers={renderers}>{state=>state.fields.map(field=>field.node)}</AirtableForm>
 <AirtableGrid scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableGrid>
 <AirtableList scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableList>
 </>;}
`;

/** The same public boundaries without JSX, for strict NodeNext .mts/.cts checks. */
export const singleCollaboratorNodeTypedConsumer = `
import {createElement,type ReactNode} from 'react';
import {SingleCollaboratorField,renderSingleCollaboratorField,type SingleCollaboratorFieldProps,type SingleCollaboratorFieldOptions} from '@miniextensions/sdk/react';
import type {FieldRendererProps,FieldRendererSlots} from '@miniextensions/sdk/ui';
const options:SingleCollaboratorFieldOptions={className:'single-collaborator-consumer'};
// @ts-expect-error Name presentation grants no editor option.
const write:SingleCollaboratorFieldOptions={setValue:(value:unknown)=>{}};
// @ts-expect-error Name presentation has no Clear action.
const clear:SingleCollaboratorFieldOptions={clearLabel:'Clear'};
// @ts-expect-error Name presentation does not look up identities.
const search:SingleCollaboratorFieldOptions={search:()=>{}};
// @ts-expect-error Identity metadata cannot enable avatar loading.
const avatar:SingleCollaboratorFieldOptions={showAvatar:true};
// @ts-expect-error A supplied name is not a link.
const link:SingleCollaboratorFieldOptions={href:'https://example.invalid'};
// @ts-expect-error The component is not a core export.
import {SingleCollaboratorField as coreField} from '@miniextensions/sdk';
// @ts-expect-error The renderer is not a headless UI export.
import {renderSingleCollaboratorField as headlessRenderer} from '@miniextensions/sdk/ui';
// @ts-expect-error The internal control is not a public React export.
import {SingleCollaboratorControl} from '@miniextensions/sdk/react';
export const renderers:FieldRendererSlots<ReactNode>={renderSingleCollaboratorField:props=>renderSingleCollaboratorField(props,options)};
export function Bound(props:SingleCollaboratorFieldProps):ReactNode {
 return createElement(SingleCollaboratorField,{...props,...options});
}
export function Override(props:SingleCollaboratorFieldProps):ReactNode {
 return createElement(SingleCollaboratorField,{...props,render:({snapshot})=>createElement('span',null,String(snapshot.value==null))});
}
export function Kinds(single:FieldRendererProps<'singleCollaborator'>,text:FieldRendererProps<'singleLineText'>,multiple:FieldRendererProps<'multipleCollaborators'>,created:FieldRendererProps<'createdBy'>) {
 const node:ReactNode=renderSingleCollaboratorField(single,options);
 const native:{id:string;email:string;name:string;profilePicUrl?:string}|null|undefined=single.value;
 const supplied:FieldRendererProps<'singleCollaborator'>['value']={id:'usr_test',email:'test@example.invalid',name:'Name'};
 const extraNative={id:'usr_test',email:'test@example.invalid',name:'Name',extra:{accepted:true}};
 const withExtra:FieldRendererProps<'singleCollaborator'>['value']=extraNative;
 const capability:FieldRendererProps<'singleCollaborator'>['capability']={type:'editable',setValue:value=>({accepted:true})};
 // @ts-expect-error Text is a different physical slot.
 renderSingleCollaboratorField(text);
 // @ts-expect-error Multiple Collaborators is a different physical slot.
 renderSingleCollaboratorField(multiple);
 // @ts-expect-error A shared native object shape does not change physical kind.
 renderSingleCollaboratorField(created);
 // @ts-expect-error Scalar identity strings are not native collaborator objects.
 const scalar:FieldRendererProps<'singleCollaborator'>['value']='usr_test';
 // @ts-expect-error The name remains required even when blank.
 const missingName:FieldRendererProps<'singleCollaborator'>['value']={id:'usr_test',email:'test@example.invalid'};
 // @ts-expect-error Native email is required.
 const missingEmail:FieldRendererProps<'singleCollaborator'>['value']={id:'usr_test',name:'Name'};
 // @ts-expect-error Native id is required.
 const missingId:FieldRendererProps<'singleCollaborator'>['value']={email:'test@example.invalid',name:'Name'};
 // @ts-expect-error Native name is a string.
 const numericName:FieldRendererProps<'singleCollaborator'>['value']={id:'usr_test',email:'test@example.invalid',name:1};
 // @ts-expect-error Profile image metadata is an optional string.
 const invalidAvatar:FieldRendererProps<'singleCollaborator'>['value']={id:'usr_test',email:'test@example.invalid',name:'Name',profilePicUrl:1};
 return {node,native,supplied,withExtra,capability};
}
`;

/** Native synthetic objects shared by installed-package and browser proofs. */
export function singleCollaboratorLoadedFixture() {
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
    const literal =
        '<img src="https://secret.invalid/image">\n  **literal** Ω  ';
    const native = (name) => ({
        id: 'usr_PRIVATE_SOURCE',
        email: 'private-source@example.invalid',
        name,
        profilePicUrl: 'https://private.invalid/avatar.png',
    });
    const data = [
        ['source', native('Ada Lovelace'), 'Ada Lovelace'],
        ['text', native(literal), literal],
        [
            'url',
            native('https://example.invalid/supplied'),
            'https://example.invalid/supplied',
        ],
        ['blank', native(''), ''],
        ['space', native('  \nΩ  '), '  \nΩ  '],
        ['null', null, ''],
        ['missing', undefined, ''],
        [
            'extra',
            {
                ...native('Extra metadata'),
                extra: { source: 'PRIVATE_EXTRA', enabled: true },
            },
            'Extra metadata',
        ],
        ['masked', native('PRIVATE_MASKED_COLLABORATOR'), '••••••••'],
    ];
    loaded.payload.fieldIdsInForm = data.map(([id]) => id);
    for (const [id, value] of data) {
        if (value === undefined) delete loaded.payload.formRecord.data[id];
        else loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'singleCollaborator',
            airtableField: {
                id,
                name: id === 'source' ? 'Collaborator' : id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'singleCollaborator',
                    options: { choices: [] },
                },
            },
            miniExtConfig: id === 'masked' ? { obscurePassword: true } : {},
        };
    }
    return { loaded, expected: data.map(([id, , text]) => [id, text]) };
}

/** Actual packed ESM/CommonJS using synthetic accepted Form/Portal owners. */
export async function checkSingleCollaboratorConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let requests = 0;
    window.fetch = () => {
        requests++;
        throw Error('SingleCollaborator presentation must not fetch');
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
    const forbidden =
        'input,button,a,img,canvas,video,audio,iframe,object,embed,svg,[contenteditable=true]';
    let checks = 0;
    try {
        for (const format of ['esm', 'cjs']) {
            const load = (name) =>
                format === 'cjs'
                    ? require(
                          name
                              ? `@miniextensions/sdk/${name}`
                              : '@miniextensions/sdk'
                      )
                    : import(
                          pathToFileURL(
                              join(
                                  consumerDirectory,
                                  `node_modules/@miniextensions/sdk/dist/esm/${name || 'runtime'}/index.js`
                              )
                          )
                      );
            const [core, ui, forms, portals, react] = await Promise.all(
                ['', 'ui', 'forms', 'portals', 'react'].map(load)
            );
            assert.equal(typeof react.SingleCollaboratorField, 'function');
            assert.equal(
                typeof react.renderSingleCollaboratorField,
                'function'
            );
            assert.equal(core.SingleCollaboratorField, undefined);
            assert.equal(ui.renderSingleCollaboratorField, undefined);
            assert.equal(react.SingleCollaboratorControl, undefined);
            checks++;

            const { loaded, expected } = singleCollaboratorLoadedFixture();
            const bindingOptions = {
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error(
                                'SingleCollaborator presentation must not save'
                            );
                        },
                    },
                },
                getScope: () => ({
                    ownerId: 'singleCollaborator-consumer',
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
            let writes = 0,
                rowEvents = 0,
                sourceProps;
            binding.setValue = () => {
                writes++;
                throw Error(
                    'SingleCollaborator wrapper must not borrow its setter'
                );
            };
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const cleanup = [];
            const output = () => container.querySelector('output');
            const renderers = {
                renderSingleCollaboratorField: (props) => {
                    if (props.fieldId === 'source') sourceProps = props;
                    return h(
                        'section',
                        { 'data-field': props.fieldId },
                        react.renderSingleCollaboratorField(props)
                    );
                },
            };
            const isolate = (child) =>
                h(
                    'div',
                    {
                        onClick: () => rowEvents++,
                        onAuxClick: () => rowEvents++,
                        onDoubleClick: () => rowEvents++,
                        onPointerDown: () => rowEvents++,
                        onKeyDown: () => rowEvents++,
                        onKeyUp: () => rowEvents++,
                    },
                    child
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
                for (const [id, expectedText] of expected) {
                    const node = container.querySelector(
                        `[data-field="${id}"] output`
                    );
                    assert(
                        node,
                        `${format}: accepted Form SingleCollaborator ${id}`
                    );
                    assert.equal(node.textContent, expectedText);
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
                for (const metadata of [
                    'private-source@example.invalid',
                    'https://private.invalid/avatar.png',
                ])
                    assert.equal(container.innerHTML.includes(metadata), false);
                assert(sourceProps);
                // SingleCollaborator itself remains editable in the existing contract.
                assert.equal(sourceProps.capability.type, 'editable');
                assert.equal(binding.getSnapshot().canEdit, true);
                await fire(
                    container.querySelector('[data-field="source"] output')
                );
                assert.equal(rowEvents, 0);
                assert.deepEqual(fields.controller.getState(), before);
                checks++;

                const supplied = loaded.payload.formRecord.data.source;
                for (const value of [
                    'usr_PRIVATE_SOURCE',
                    1234,
                    false,
                    [],
                    {},
                    { id: supplied.id, email: supplied.email },
                    { id: supplied.id, name: supplied.name },
                    { email: supplied.email, name: supplied.name },
                    { ...supplied, id: 1 },
                    { ...supplied, email: null },
                    { ...supplied, name: false },
                    { ...supplied, profilePicUrl: 1 },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderSingleCollaboratorField({
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
                let nativeReads = 0,
                    capabilityReads = 0;
                const inaccessible = {};
                for (const key of ['id', 'email', 'name', 'profilePicUrl'])
                    Object.defineProperty(inaccessible, key, {
                        enumerable: true,
                        get() {
                            nativeReads++;
                            throw Error(
                                'Masked native SingleCollaborator must not be read'
                            );
                        },
                    });
                for (const side of ['displayConfig', 'writeConfig']) {
                    for (const flag of [
                        'obscurePassword',
                        'maskPasswordOnLoginScreen',
                    ]) {
                        const props = {
                            ...sourceProps,
                            value: inaccessible,
                            displayConfig: { showTitle: false },
                            [side]: { showTitle: false, [flag]: true },
                        };
                        Object.defineProperty(props, 'capability', {
                            get() {
                                capabilityReads++;
                                throw Error(
                                    'SingleCollaborator presentation needs no capability'
                                );
                            },
                        });
                        // Direct component-boundary checks; accepted owners may
                        // have validated their native values before this call.
                        for (const boundary of ['properties', 'reference']) {
                            if (boundary === 'reference')
                                Object.defineProperty(props, 'value', {
                                    get() {
                                        nativeReads++;
                                        throw Error(
                                            'Masked native reference must not be read'
                                        );
                                    },
                                });
                            await act(async () =>
                                root.render(
                                    react.renderSingleCollaboratorField(props)
                                )
                            );
                            assert.equal(output().textContent, '••••••••');
                            assert.equal(
                                output().getAttribute('aria-label'),
                                'Collaborator'
                            );
                            assert.equal(
                                container.querySelector('label'),
                                null
                            );
                            assert.equal(nativeReads, 0);
                            assert.equal(capabilityReads, 0);
                            checks++;
                        }
                    }
                }
                const inertProps = { ...sourceProps };
                Object.defineProperty(inertProps, 'capability', {
                    get() {
                        capabilityReads++;
                        throw Error(
                            'Name presentation cannot read capabilities'
                        );
                    },
                });
                await act(async () =>
                    root.render(
                        isolate(react.renderSingleCollaboratorField(inertProps))
                    )
                );
                assert.equal(output().textContent, supplied.name);
                await fire(output());
                assert.equal(capabilityReads, 0);
                assert.equal(rowEvents, 0);
                checks++;
                await act(async () =>
                    root.render(
                        react.renderSingleCollaboratorField({
                            ...sourceProps,
                            pending: true,
                            displayConfig: { showTitle: false },
                            error: '<b>Supplied feedback</b>',
                        })
                    )
                );
                assert.equal(output().getAttribute('aria-busy'), 'true');
                assert.equal(output().getAttribute('aria-invalid'), 'true');
                assert.equal(
                    window.document.getElementById(
                        output().getAttribute('aria-describedby')
                    ).textContent,
                    '<b>Supplied feedback</b>'
                );
                assert.equal(container.querySelector('b'), null);
                await act(async () =>
                    root.render(
                        h(
                            Fragment,
                            null,
                            react.renderSingleCollaboratorField(sourceProps),
                            react.renderSingleCollaboratorField(sourceProps)
                        )
                    )
                );
                const outputs = [...container.querySelectorAll('output')];
                assert.equal(new Set(outputs.map((node) => node.id)).size, 2);
                for (const node of outputs)
                    assert(container.querySelector(`label[for="${node.id}"]`));
                checks++;

                let actionReads = 0;
                const guardedBinding = Object.create(binding);
                for (const key of [
                    'setValue',
                    'scalar',
                    'date',
                    'selection',
                    'attachments',
                    'choiceCreation',
                    'linkedRecords',
                ])
                    Object.defineProperty(guardedBinding, key, {
                        get() {
                            actionReads++;
                            throw Error('Name wrapper cannot read actions');
                        },
                    });
                await act(async () =>
                    root.render(
                        isolate(
                            h(react.SingleCollaboratorField, {
                                key: 'guarded-actions',
                                binding: guardedBinding,
                            })
                        )
                    )
                );
                assert.equal(output().textContent, supplied.name);
                await fire(output());
                assert.equal(rowEvents, 0);
                assert.equal(writes, 0);
                assert.equal(actionReads, 0);
                assert.deepEqual(fields.controller.getState(), before);
                checks++;
                for (const flag of [
                    'obscurePassword',
                    'maskPasswordOnLoginScreen',
                ]) {
                    const snapshot = binding.getSnapshot();
                    snapshot.field.schema.miniExtConfig = { [flag]: true };
                    Object.defineProperty(snapshot, 'value', {
                        get() {
                            nativeReads++;
                            throw Error(
                                'Masked wrapper native reference must not be read'
                            );
                        },
                    });
                    const maskedBinding = Object.create(guardedBinding);
                    maskedBinding.getSnapshot = () => snapshot;
                    maskedBinding.subscribe = () => () => {};
                    // These accessors test the component boundary. React 19's
                    // development prop diff can itself read previous actions
                    // when comparing this synthetic binding with another one.
                    // A distinct mount keeps framework introspection separate.
                    await act(async () =>
                        root.render(
                            h(react.SingleCollaboratorField, {
                                key: `masked-${flag}`,
                                binding: maskedBinding,
                            })
                        )
                    );
                    assert.equal(output().textContent, '••••••••');
                    assert.equal(nativeReads, 0);
                    assert.equal(actionReads, 0);
                    checks++;
                }
                for (const visibility of [
                    { type: 'hidden', diagnostics: [] },
                    { type: 'blocked', code: 'invalid', diagnostics: [] },
                ]) {
                    const hidden = {
                        ...binding,
                        getSnapshot: () => ({
                            ...binding.getSnapshot(),
                            visibility,
                        }),
                        subscribe: (notify) =>
                            binding.subscribe((snapshot) =>
                                notify({ ...snapshot, visibility })
                            ),
                    };
                    await act(async () =>
                        root.render(
                            h(react.SingleCollaboratorField, {
                                binding: hidden,
                            })
                        )
                    );
                    assert.equal(output(), null);
                    checks++;
                }
                for (const mode of ['create', 'edit']) {
                    for (const value of [supplied, null]) {
                        const hiddenLoaded = structuredClone(loaded);
                        hiddenLoaded.payload.formRecord = {
                            ...hiddenLoaded.payload.formRecord,
                            type: mode,
                            ...(mode === 'edit'
                                ? {
                                      tableId: 'tbl_children',
                                      recordId: 'rec_hidden_collaborator',
                                  }
                                : {}),
                            data: {
                                ...hiddenLoaded.payload.formRecord.data,
                                source: value,
                            },
                        };
                        hiddenLoaded.payload.fieldIdsToSchemas.source.miniExtConfig =
                            { hideFieldIfEmpty: true };
                        const hiddenFields = forms.createFormFieldBindings({
                            loaded: hiddenLoaded,
                            ...bindingOptions,
                        });
                        cleanup.push(() => hiddenFields.destroy());
                        const hiddenBinding = hiddenFields.field('source');
                        assert.equal(
                            hiddenBinding.getSnapshot().visibility.type,
                            mode === 'edit' ? 'blocked' : 'visible'
                        );
                        await act(async () =>
                            root.render(
                                h(react.SingleCollaboratorField, {
                                    binding: hiddenBinding,
                                })
                            )
                        );
                        if (mode === 'edit') assert.equal(output(), null);
                        else
                            assert.equal(
                                output().textContent,
                                value?.name ?? ''
                            );
                        assert.deepEqual(
                            hiddenBinding.getSnapshot().value,
                            value
                        );
                        checks++;
                    }
                }
                for (const mismatch of ['schema', 'physical']) {
                    const snapshot = binding.getSnapshot();
                    if (mismatch === 'schema')
                        snapshot.field.schema.fieldType =
                            'multipleCollaborators';
                    else
                        snapshot.field.schema.airtableField.config.type =
                            'multipleCollaborators';
                    const wrongBinding = {
                        ...binding,
                        getSnapshot: () => snapshot,
                        subscribe: () => () => {},
                    };
                    await act(async () =>
                        root.render(
                            h(react.SingleCollaboratorField, {
                                binding: wrongBinding,
                            })
                        )
                    );
                    assert.equal(output(), null);
                    assert(container.querySelector('[role=status]'));
                    await act(async () =>
                        root.render(
                            h(react.SingleCollaboratorField, {
                                binding: wrongBinding,
                                render: (state) => {
                                    assert.equal(state.binding, wrongBinding);
                                    assert.deepEqual(
                                        state.snapshot.value,
                                        supplied
                                    );
                                    return h(
                                        'span',
                                        { 'data-custom': true },
                                        'Custom display'
                                    );
                                },
                            })
                        )
                    );
                    assert.equal(container.textContent, 'Custom display');
                    checks++;
                }

                const sourceField =
                    loaded.payload.fieldIdsToSchemas.source.airtableField;
                const portal = fixtures.makePortal();
                portal.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [sourceField];
                const details = [
                    {
                        fieldId: 'source',
                        fieldName: 'Collaborator',
                        titleOverride: null,
                        isHidden: false,
                        fieldIsInEditingChildForm: false,
                        childFormField: null,
                        miniExtConfig: {},
                    },
                ];
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children =
                    details;
                const native = {
                    ...supplied,
                    name: '  Portal Ω\nName  ',
                    extra: { preserved: true },
                };
                let reads = 0,
                    portalWrites = 0;
                const portalClient = {
                    getSession: () => ({}),
                    portals: {
                        listLinkedRecords: async () => {
                            reads++;
                            return fixtures.page(
                                [
                                    {
                                        id: 'rec_singleCollaborator',
                                        fields: { source: native },
                                    },
                                ],
                                null,
                                {
                                    customViewDetailFields: {
                                        fld_children: details,
                                    },
                                    tableIdsToLinkedTableStates: {
                                        tbl_children: {
                                            airtableFields: [sourceField],
                                            recordIdsToAirtableRecords: {
                                                rec_singleCollaborator: {
                                                    id: 'rec_singleCollaborator',
                                                    fields: { source: native },
                                                },
                                            },
                                        },
                                    },
                                }
                            );
                        },
                        updateGridCell: async () => {
                            portalWrites++;
                            throw Error(
                                'SingleCollaborator presentation must not write'
                            );
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
                        ownerId: 'singleCollaborator-portal',
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
                assert.equal(reads, 0);
                assert.equal(
                    await portalScope.getSnapshot().actions.load({
                        pagesToFetch: 1,
                        refreshLoggedInPortalRecord: false,
                    }),
                    true
                );
                const detailProps = portalScope
                    .getSnapshot()
                    .rows[0].cells[0].host.getSnapshot().fields[0];
                assert.equal(detailProps.context, 'portal-detail');
                assert.deepEqual(detailProps.value, native);
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
                                                renderSingleCollaboratorField:
                                                    react.renderSingleCollaboratorField,
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
                    assert.equal(output().textContent, native.name);
                    assert.equal(container.querySelector(forbidden), null);
                    await fire(output());
                    assert.equal(rowEvents, 0);
                    assert.equal(reads, 1);
                    assert.equal(portalWrites, 0);
                    assert.deepEqual(detailProps.value, native);
                    checks++;
                }
                await act(async () => owner.destroy());
                assert.equal(output(), null);
                await act(async () =>
                    root.render(h(react.SingleCollaboratorField, { binding }))
                );
                assert.equal(output().textContent, supplied.name);
                assert.deepEqual(fields.controller.getState(), before);
                await act(async () => fields.destroy());
                assert.equal(output(), null);
                assert.equal(writes, 0);
                assert.equal(requests, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                for (const dispose of cleanup.reverse()) dispose();
                scope.destroy();
                fields.destroy();
                container.remove();
            }
        }
        assert.equal(checks, singleCollaboratorConsumerCheckCount);
        return { checks };
    } finally {
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
