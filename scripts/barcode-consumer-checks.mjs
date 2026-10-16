import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const barcodeReactTypedConsumer = `
import type { ReactNode } from 'react';
import { BarcodeField, renderBarcodeField, AirtableForm, AirtableGrid, AirtableList, type BarcodeFieldProps, type BarcodeFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
const options: BarcodeFieldOptions = {className:'barcode-consumer'};
// @ts-expect-error Barcode presentation grants no editor option.
const write: BarcodeFieldOptions = {setValue: (value: unknown) => {}};
// @ts-expect-error Barcode presentation has no Clear action.
const clear: BarcodeFieldOptions = {clearLabel:'Clear'};
// @ts-expect-error Barcode presentation has no scanner or camera option.
const scanner: BarcodeFieldOptions = {scan: () => {}};
// @ts-expect-error Supplied text is not normalized.
const normalize: BarcodeFieldOptions = {normalize: (value: string) => value};
// @ts-expect-error Supplied text is not a link.
const link: BarcodeFieldOptions = {href:'https://example.invalid'};
// @ts-expect-error BarcodeField is not a core export.
import { BarcodeField as coreBarcode } from '@miniextensions/sdk';
// @ts-expect-error Barcode renderer is not a headless UI export.
import { renderBarcodeField as headlessBarcode } from '@miniextensions/sdk/ui';
// @ts-expect-error The internal control is not a public React export.
import { BarcodeControl } from '@miniextensions/sdk/react';
export const renderers: FieldRendererSlots<ReactNode> = {renderBarcodeField: props => renderBarcodeField(props,options)};
export function Bound(props:BarcodeFieldProps) {return <BarcodeField {...props} {...options}/>;}
export function Override(props:BarcodeFieldProps) {return <BarcodeField {...props} render={({snapshot}) => <span>{String(snapshot.value == null)}</span>}/>;}
export function Kinds(barcode:FieldRendererProps<'barcode'>,text:FieldRendererProps<'singleLineText'>,formula:FieldRendererProps<'formula'>) {
 const native: {text?:string;type?:string}|null|undefined=barcode.value;
 const supplied: FieldRendererProps<'barcode'>['value']={text:'00001234',type:'ean13'};
 const typeOnly: FieldRendererProps<'barcode'>['value']={type:'qr'};
 // Display coverage must not narrow the existing editable native-object contract.
 const capability: FieldRendererProps<'barcode'>['capability']={type:'editable',setValue:value=>({accepted:true})};
 // @ts-expect-error A text field is not a Barcode physical slot.
 renderBarcodeField(text);
 // @ts-expect-error A Formula is not a Barcode physical slot.
 renderBarcodeField(formula);
 // @ts-expect-error Barcode does not use scalar string values.
 const scalar: FieldRendererProps<'barcode'>['value']='00001234';
 // @ts-expect-error Native Barcode text is a supplied string.
 const number: FieldRendererProps<'barcode'>['value']={text:1234};
 // @ts-expect-error Native Barcode type is a supplied string.
 const numericType: FieldRendererProps<'barcode'>['value']={text:'00001234',type:1};
 return {native,supplied,typeOnly,capability};
}
export function Compositions({form,portal}:{form:FormRenderScope;portal:PortalRenderScope}) {return <>
 <AirtableForm scope={form} renderers={renderers}>{state=>state.fields.map(field=>field.node)}</AirtableForm>
 <AirtableGrid scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableGrid>
 <AirtableList scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableList>
 </>;}
`;

/** Native synthetic objects shared by installed-package and browser proofs. */
export function barcodeLoadedFixture() {
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
    const data = [
        ['source', { text: '00001234', type: 'ean13' }, '00001234'],
        ['text', { text: literal, type: 'qr' }, literal],
        [
            'url',
            { text: 'https://example.invalid/supplied', type: 'qr' },
            'https://example.invalid/supplied',
        ],
        ['blank', { text: '', type: 'code128' }, ''],
        ['empty', {}, ''],
        ['type-only', { type: 'pdf417' }, ''],
        ['null', null, ''],
        ['missing', undefined, ''],
        [
            'masked',
            { text: 'PRIVATE_MASKED_BARCODE', type: 'PRIVATE_TYPE' },
            '••••••••',
        ],
    ];
    loaded.payload.fieldIdsInForm = data.map(([id]) => id);
    for (const [id, value] of data) {
        if (value === undefined) delete loaded.payload.formRecord.data[id];
        else loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'barcode',
            airtableField: {
                id,
                name: id === 'source' ? 'Barcode' : id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: { type: 'barcode', options: null },
            },
            miniExtConfig: id === 'masked' ? { obscurePassword: true } : {},
        };
    }
    return { loaded, expected: data.map(([id, , text]) => [id, text]) };
}

/** Actual packed ESM/CommonJS using synthetic accepted Form/Portal owners. */
export async function checkBarcodeConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let requests = 0;
    window.fetch = () => {
        requests++;
        throw Error('Barcode presentation must not fetch');
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
            assert.equal(typeof react.BarcodeField, 'function');
            assert.equal(typeof react.renderBarcodeField, 'function');
            assert.equal(core.BarcodeField, undefined);
            assert.equal(ui.renderBarcodeField, undefined);
            assert.equal(react.BarcodeControl, undefined);
            checks++;

            const { loaded, expected } = barcodeLoadedFixture();
            const bindingOptions = {
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error('Barcode presentation must not save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'barcode-consumer', revision: 0 }),
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
                throw Error('Barcode wrapper must not borrow its setter');
            };
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const cleanup = [];
            const output = () => container.querySelector('output');
            const renderers = {
                renderBarcodeField: (props) => {
                    if (props.fieldId === 'source') sourceProps = props;
                    return h(
                        'section',
                        { 'data-field': props.fieldId },
                        react.renderBarcodeField(props)
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
                    assert(node, `${format}: accepted Form Barcode ${id}`);
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
                assert(sourceProps);
                // Barcode itself remains editable in the existing contract.
                assert.equal(sourceProps.capability.type, 'editable');
                assert.equal(binding.getSnapshot().canEdit, true);
                await fire(
                    container.querySelector('[data-field="source"] output')
                );
                assert.equal(rowEvents, 0);
                assert.deepEqual(fields.controller.getState(), before);
                checks++;

                for (const value of [
                    '00001234',
                    1234,
                    false,
                    [],
                    { text: 1234 },
                    { text: null },
                    { text: '00001234', type: 12 },
                    { text: '00001234', url: 'https://private.invalid' },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderBarcodeField({ ...sourceProps, value })
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
                for (const key of ['text', 'type'])
                    Object.defineProperty(inaccessible, key, {
                        enumerable: true,
                        get() {
                            nativeReads++;
                            throw Error(
                                'Masked native Barcode must not be read'
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
                                    'Barcode presentation needs no capability'
                                );
                            },
                        });
                        await act(async () =>
                            root.render(react.renderBarcodeField(props))
                        );
                        assert.equal(output().textContent, '••••••••');
                        assert.equal(
                            output().getAttribute('aria-label'),
                            'Barcode'
                        );
                        assert.equal(container.querySelector('label'), null);
                        assert.equal(nativeReads, 0);
                        assert.equal(capabilityReads, 0);
                        checks++;
                    }
                }
                await act(async () =>
                    root.render(
                        react.renderBarcodeField({
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
                            react.renderBarcodeField(sourceProps),
                            react.renderBarcodeField(sourceProps)
                        )
                    )
                );
                const outputs = [...container.querySelectorAll('output')];
                assert.equal(new Set(outputs.map((node) => node.id)).size, 2);
                for (const node of outputs)
                    assert(container.querySelector(`label[for="${node.id}"]`));
                checks++;

                await act(async () =>
                    root.render(isolate(h(react.BarcodeField, { binding })))
                );
                assert.equal(output().textContent, '00001234');
                await fire(output());
                assert.equal(rowEvents, 0);
                assert.equal(writes, 0);
                assert.deepEqual(fields.controller.getState(), before);
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
                        root.render(h(react.BarcodeField, { binding: hidden }))
                    );
                    assert.equal(output(), null);
                    checks++;
                }
                const hiddenLoaded = structuredClone(loaded);
                hiddenLoaded.payload.formRecord = {
                    type: 'edit',
                    tableId: 'tbl_children',
                    recordId: 'rec_hidden_barcode',
                    data: {
                        ...hiddenLoaded.payload.formRecord.data,
                        source: { text: '  ', type: 'qr' },
                    },
                };
                hiddenLoaded.payload.fieldIdsToSchemas.source.miniExtConfig = {
                    hideFieldIfEmpty: true,
                };
                const hiddenFields = forms.createFormFieldBindings({
                    loaded: hiddenLoaded,
                    ...bindingOptions,
                });
                cleanup.push(() => hiddenFields.destroy());
                const hiddenBinding = hiddenFields.field('source');
                assert.equal(
                    hiddenBinding.getSnapshot().visibility.type,
                    'hidden'
                );
                await act(async () =>
                    root.render(
                        h(react.BarcodeField, { binding: hiddenBinding })
                    )
                );
                assert.equal(output(), null);
                assert.deepEqual(hiddenBinding.getSnapshot().value, {
                    text: '  ',
                    type: 'qr',
                });
                checks++;

                const sourceField =
                    loaded.payload.fieldIdsToSchemas.source.airtableField;
                const portal = fixtures.makePortal();
                portal.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [sourceField];
                const details = [
                    {
                        fieldId: 'source',
                        fieldName: 'Barcode',
                        titleOverride: null,
                        isHidden: false,
                        fieldIsInEditingChildForm: false,
                        childFormField: null,
                        miniExtConfig: {},
                    },
                ];
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children =
                    details;
                const native = { text: ' 00009876\nΩ ', type: 'code128' };
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
                                        id: 'rec_barcode',
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
                                                rec_barcode: {
                                                    id: 'rec_barcode',
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
                            throw Error('Barcode presentation must not write');
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
                        ownerId: 'barcode-portal',
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
                                                renderBarcodeField:
                                                    react.renderBarcodeField,
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
                    assert.equal(output().textContent, native.text);
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
                    root.render(h(react.BarcodeField, { binding }))
                );
                assert.equal(output().textContent, '00001234');
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
