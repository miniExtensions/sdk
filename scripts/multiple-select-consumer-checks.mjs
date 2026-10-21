import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const multipleSelectReactTypedConsumer = `
import * as React from 'react';
import { MultipleSelectField, renderMultipleSelectsField, AirtableForm, AirtableGrid, AirtableList, type MultipleSelectFieldProps, type MultipleSelectFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
import type { FormFieldBinding } from '@miniextensions/sdk/forms';
const options: MultipleSelectFieldOptions = {className: 'custom', clearLabel: 'Clear colors'};
const slots: FieldRendererSlots<React.ReactNode> = {renderMultipleSelectsField};
declare const binding: FormFieldBinding;
const props: MultipleSelectFieldProps = {binding, ...options};
export const field = <MultipleSelectField {...props} render={({snapshot, binding}) => <output>{String(snapshot.value)}{String(!!binding)}</output>} />;
export function Screens({form, portal}: {form: FormRenderScope; portal: PortalRenderScope}) {
 return <><AirtableForm scope={form} renderers={slots}>{state => <>{state.fields.map(field => field.node)}</>}</AirtableForm><AirtableGrid scope={portal} renderers={slots}>{state => <>{state.rows.map(row => row.cells.map(cell => cell.node))}</>}</AirtableGrid><AirtableList scope={portal} renderers={slots}>{state => <>{state.rows.map(row => row.cells.map(cell => cell.node))}</>}</AirtableList></>;
}
declare const single: FieldRendererProps<'singleSelect'>;
// @ts-expect-error Multiple Select never replaces the Single Select slot.
renderMultipleSelectsField(single);
// @ts-expect-error Native values are arrays of choice names.
const invalid: FieldRendererProps<'multipleSelects'>['value'] = 'Red';
`;

/** Public installed ESM/CJS consumers with real Form bindings and hosts. */
export async function checkMultipleSelectConsumer({
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
    const { createElement: h, act } = require('react');
    const { createRoot } = require('react-dom/client');
    let checks = 0;
    try {
        assert(
            readFileSync(
                require.resolve(
                    '@miniextensions/sdk/react/multiple-select.css'
                ),
                'utf8'
            ).length > 0
        );
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
            const [react, forms, ui] = await Promise.all(
                ['react', 'forms', 'ui'].map(load)
            );
            assert.equal(typeof react.MultipleSelectField, 'function');
            assert.equal(typeof react.renderMultipleSelectsField, 'function');
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['colors'];
            loaded.payload.formRecord.data.colors = ['Legacy', 'Red'];
            loaded.payload.fieldIdsToSchemas.colors = {
                fieldType: 'multipleSelects',
                airtableField: {
                    id: 'colors',
                    name: 'Colors',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: {
                        type: 'multipleSelects',
                        options: {
                            choices: [
                                { id: 'red', name: 'Red' },
                                { id: 'blue', name: 'Blue' },
                            ],
                        },
                    },
                },
                miniExtConfig: {},
            };
            let saves = 0;
            const owner = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            saves++;
                            throw Error('No implicit Save');
                        },
                    },
                },
                getScope: () => ({
                    ownerId: 'multiple-select-consumer',
                    revision: 0,
                }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            const binding = owner.field('colors');
            const host = ui.createFormFieldRendererHost({
                fields: owner,
                fieldId: 'colors',
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                await act(async () =>
                    root.render(h(react.MultipleSelectField, { binding }))
                );
                assert.deepEqual(binding.getSnapshot().value, [
                    'Legacy',
                    'Red',
                ]);
                const blue = [...container.querySelectorAll('label')]
                    .find((node) => node.textContent === 'Blue')
                    .querySelector('input');
                await act(async () => blue.click());
                assert.deepEqual(binding.getSnapshot().value, [
                    'Legacy',
                    'Red',
                    'Blue',
                ]);
                checks++;
                await act(async () =>
                    root.render(
                        h(react.FieldRenderer, {
                            host,
                            renderers: {
                                renderMultipleSelectsField:
                                    react.renderMultipleSelectsField,
                            },
                        })
                    )
                );
                const remove = container.querySelector(
                    'button[aria-label="Remove Legacy"]'
                );
                await act(async () => remove.click());
                assert.deepEqual(binding.getSnapshot().value, ['Red', 'Blue']);
                const clear = container.querySelector(
                    'button[aria-label="Clear Colors"]'
                );
                await act(async () => clear.click());
                assert.deepEqual(binding.getSnapshot().value, []);
                assert.equal(saves, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                host.dispose();
                owner.destroy();
                container.remove();
            }
        }
    } finally {
        keys.forEach((key, index) => {
            const original = originals[index];
            if (original) Object.defineProperty(globalThis, key, original);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
    return { checks };
}
