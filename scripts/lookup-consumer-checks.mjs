import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const lookupReactTypedConsumer = `
import type { ReactNode } from 'react';
import { LookupField, renderLookupField, AirtableForm, AirtableGrid, AirtableList, type LookupFieldProps, type LookupFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
const options: LookupFieldOptions = {className:'lookup-consumer'};
// @ts-expect-error Lookup grants no editor option.
const write: LookupFieldOptions = {setValue: (value: unknown) => {}};
// @ts-expect-error Lookup has no Clear action.
const clear: LookupFieldOptions = {clearLabel:'Clear'};
// @ts-expect-error Lookup grants no hydration option.
const hydrate: LookupFieldOptions = {readSelected: () => {}};
// @ts-expect-error LookupField is not a core export.
import { LookupField as coreLookup } from '@miniextensions/sdk';
// @ts-expect-error Lookup renderer is not a headless UI export.
import { renderLookupField as headlessLookup } from '@miniextensions/sdk/ui';
// @ts-expect-error The internal control is not a public React export.
import { LookupControl } from '@miniextensions/sdk/react';
export const renderers: FieldRendererSlots<ReactNode> = {renderMultipleLookupValuesField: props => renderLookupField(props,options)};
export function Bound(props:LookupFieldProps) {return <LookupField {...props} {...options}/>;}
export function Override(props:LookupFieldProps) {return <LookupField {...props} render={({snapshot}) => <span>{String(snapshot.value ?? '')}</span>}/>;}
export function Kinds(lookup:FieldRendererProps<'multipleLookupValues'>,rollup:FieldRendererProps<'rollup'>,formula:FieldRendererProps<'formula'>) {
 const readonly: {type:'readonly'}=lookup.capability;
 // @ts-expect-error Physical Rollup has a different scalar/array contract.
 renderLookupField(rollup);
 // @ts-expect-error Physical Formula is not a Lookup.
 renderLookupField(formula);
 // @ts-expect-error Lookup scalar values are not admitted.
 const scalar: FieldRendererProps<'multipleLookupValues'>['value']=1;
 // @ts-expect-error Lookup has no editable capability.
 const editable: FieldRendererProps<'multipleLookupValues'>['capability']={type:'editable',setValue:()=>({accepted:true})};
 return readonly;
}
export function Compositions({form,portal}:{form:FormRenderScope;portal:PortalRenderScope}) {return <>
 <AirtableForm scope={form} renderers={renderers}>{state=>state.fields.map(field=>field.node)}</AirtableForm>
 <AirtableGrid scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableGrid>
 <AirtableList scope={portal} renderers={renderers}>{state=>state.rows.flatMap(row=>row.cells.map(cell=>cell.node))}</AirtableList>
 </>;}
`;

/** Synthetic accepted arrays; no collection hydration or invented provenance. */
export function lookupLoadedFixture() {
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
    const number = { type: 'number', options: { precision: 2 } },
        text = { type: 'singleLineText', options: null };
    const data = [
        ['amount', number, [-1234.567], '-1234.57'],
        [
            'text',
            text,
            ['<img src="https://secret.invalid/image">\n**literal**'],
            '<img src="https://secret.invalid/image">\n**literal**',
        ],
        ['empty', number, [], ''],
        ['null', number, null, ''],
        ['missing', number, undefined, ''],
        ['error', number, { error: '#ERROR!' }, '#ERROR!'],
        [
            'special',
            number,
            [0, { specialValue: 'Infinity' }, null, 0],
            '0.00, Infinity, 0.00',
        ],
        [
            'choices',
            { type: 'multipleSelects', options: { choices: [] } },
            ['a', 'a', 'b'],
            'a, a, b',
        ],
        [
            'attachments',
            { type: 'multipleAttachments', options: { isReversed: false } },
            [{ filename: 'file.txt', url: 'https://files.invalid/supplied' }],
            'file.txt (https://files.invalid/supplied)',
        ],
        [
            'button',
            { type: 'button', options: null },
            [{ url: 'https://example.invalid/supplied', label: 'Go' }],
            'https://example.invalid/supplied',
        ],
        [
            'linked',
            {
                type: 'multipleRecordLinks',
                options: {
                    linkedTableId: 'private_target_table',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                },
            },
            ['rec12345678901234', 'Supplied label', 'rec12345678901234'],
            'Unavailable, Supplied label, Unavailable',
        ],
        [
            'nested',
            {
                type: 'multipleLookupValues',
                options: {
                    isValid: true,
                    recordLinkFieldId: 'source_link',
                    fieldIdInLinkedTable: 'foreign_field',
                    result: number,
                },
            },
            [1, 2],
            '1.00, 2.00',
        ],
        ['invalid', null, { error: '#REF!' }, '#REF!'],
        ['invalid-empty', null, [1], ''],
        [
            'masked',
            text,
            ['PRIVATE_MASKED_VALUE https://private.invalid'],
            '••••••••',
        ],
        ['masked-error', null, { error: 'PRIVATE_NATIVE_ERROR' }, '••••••••'],
    ];
    loaded.payload.fieldIdsInForm = data.map(([id]) => id);
    for (const [id, result, value] of data) {
        if (value === undefined) delete loaded.payload.formRecord.data[id];
        else loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'multipleLookupValues',
            airtableField: {
                id,
                name: id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'multipleLookupValues',
                    options: {
                        isValid: result !== null,
                        result,
                        recordLinkFieldId: 'private_source_link',
                        fieldIdInLinkedTable: 'private_source_field',
                    },
                },
            },
            miniExtConfig: {
                hideFieldIfEmpty: false,
                ...(id.startsWith('masked')
                    ? { obscurePassword: true }
                    : {
                          renderLookupAsHTML: true,
                          renderLookupAsAttachment: true,
                          displayAsButton: true,
                      }),
            },
        };
    }
    return {
        loaded,
        expected: data.map(([id, , , expected]) => [id, expected]),
    };
}

export async function checkLookupConsumer({
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
            assert.equal(ui.renderLookupField, undefined);
            assert.equal(typeof react.LookupField, 'function');
            const { loaded, expected } = lookupLoadedFixture();
            let requests = 0,
                amountProps;
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error('No Lookup Save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'lookup-consumer', revision: 0 }),
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
                    renderMultipleLookupValuesField: (props) => {
                        if (props.fieldId === 'amount') amountProps = props;
                        return h(
                            'div',
                            { 'data-field': props.fieldId },
                            react.renderLookupField(props)
                        );
                    },
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
                assert.equal(container.innerHTML.includes('PRIVATE_'), false);
                assert.equal(
                    container.innerHTML.includes('rec12345678901234'),
                    false
                );
                assert.equal(requests, 0);
                assert(amountProps);
                for (const value of [
                    1,
                    [[1]],
                    new Array(1),
                    [{ linkedRecordId: 'rec12345678901234', value: 1 }],
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderLookupField({ ...amountProps, value })
                        )
                    );
                    assert.equal(
                        container.querySelector('output').textContent,
                        'Unavailable'
                    );
                    checks++;
                }
                const bad = {
                    ...amountProps,
                    field: {
                        ...amountProps.field,
                        config: {
                            ...amountProps.field.config,
                            options: {
                                ...amountProps.field.config.options,
                                result: { type: 'manualSort', options: null },
                            },
                        },
                    },
                };
                await act(async () =>
                    root.render(react.renderLookupField(bad))
                );
                assert.equal(
                    container.querySelector('output').textContent,
                    'Unavailable'
                );
                checks++;
                const binding = fields.field('amount');
                const before = binding.getSnapshot();
                binding.setValue = () => {
                    throw Error('Do not borrow a Lookup setter');
                };
                await act(async () =>
                    root.render(h(react.LookupField, { binding }))
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
