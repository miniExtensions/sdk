import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const linkedRecordsReactTypedConsumer = `
import * as React from 'react';
import { renderMultipleRecordLinksField, AirtableForm, AirtableGrid, AirtableList, type LinkedRecordsFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
const options: LinkedRecordsFieldOptions = {className: 'custom'};
const slots: FieldRendererSlots<React.ReactNode> = {renderMultipleRecordLinksField};
export function Direct(props: FieldRendererProps<'multipleRecordLinks'>) {return renderMultipleRecordLinksField(props, options);}
export function Screens({form, portal}: {form: FormRenderScope; portal: PortalRenderScope}) {
 return <><AirtableForm scope={form} renderers={slots}>{state => <>{state.fields.map(field => field.node)}</>}</AirtableForm><AirtableGrid scope={portal} renderers={slots}>{state => <>{state.rows.map(row => row.cells.map(cell => cell.node))}</>}</AirtableGrid><AirtableList scope={portal} renderers={slots}>{state => <>{state.rows.map(row => row.cells.map(cell => cell.node))}</>}</AirtableList></>;
}
declare const single: FieldRendererProps<'singleSelect'>;
// @ts-expect-error Linked Records never replaces a select slot.
renderMultipleRecordLinksField(single);
// @ts-expect-error Linked Records values are native ID arrays, not rich records.
const invalid: FieldRendererProps<'multipleRecordLinks'>['value'] = [{id: 'rec_one', fields: {}}];
`;

/** Both module formats run through installed exports and an actual Form host. */
export async function checkLinkedRecordsRendererConsumer({
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
    const additionResults = [];
    try {
        assert.match(
            readFileSync(
                require.resolve('@miniextensions/sdk/react/linked-records.css'),
                'utf8'
            ),
            /\.mx-sdk-linked-records-field/
        );
        const cases = ['esm', 'cjs'].flatMap((format) =>
            ['presentation', 'one-record', 'unlimited'].map((scenario) => ({
                format,
                scenario,
            }))
        );
        for (const { format, scenario } of cases) {
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
            assert.equal(
                typeof react.renderMultipleRecordLinksField,
                'function'
            );
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['links'];
            loaded.payload.formRecord.data.links =
                scenario === 'presentation'
                    ? ['rec_one', 'rec_hidden', 'rec_one']
                    : ['rec_one'];
            const primary = {
                id: 'name',
                name: 'Name',
                description: null,
                isComputed: false,
                isPrimaryField: true,
                config: { type: 'singleLineText', options: null },
            };
            loaded.payload.fieldIdsToSchemas.links = {
                fieldType: 'multipleRecordLinks',
                airtableField: {
                    ...primary,
                    id: 'links',
                    name: 'Projects',
                    isPrimaryField: false,
                    config: {
                        type: 'multipleRecordLinks',
                        options: {
                            linkedTableId: 'labels',
                            isReversed: false,
                            prefersSingleRecordLink: false,
                        },
                    },
                },
                miniExtConfig:
                    scenario === 'one-record'
                        ? { maxRecordsToSelectOrCreate: '1' }
                        : {},
            };
            loaded.payload.linkedRecordFieldIdToDetailFields.links = [
                {
                    fieldId: 'name',
                    fieldName: 'Name',
                    titleOverride: null,
                    isHidden: false,
                    fieldIsInEditingChildForm: false,
                    childFormField: null,
                    miniExtConfig: {},
                },
            ];
            let reads = 0,
                saves = 0;
            const client = {
                getSession: () => ({}),
                linkedRecords: {
                    loadSelectedRecords: async () => {
                        reads++;
                        return {
                            labels: {
                                airtableFields: [primary],
                                recordIdsToAirtableRecords: {
                                    rec_one: {
                                        id: 'rec_one',
                                        fields: { name: 'Visible' },
                                    },
                                },
                            },
                        };
                    },
                },
                forms: {
                    save: async () => {
                        saves++;
                        throw Error('No implicit Save');
                    },
                },
            };
            const owner = forms.createFormFieldBindings({
                loaded,
                client,
                getScope: () => ({
                    ownerId: 'linked-renderer-consumer',
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
            const host = ui.createFormFieldRendererHost({
                fields: owner,
                fieldId: 'links',
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const button = (name) => {
                const button = [...container.querySelectorAll('button')].find(
                    (n) =>
                        n.getAttribute('aria-label') === name ||
                        n.textContent === name
                );
                assert.ok(button, name);
                return button;
            };
            try {
                await act(async () =>
                    root.render(
                        h(
                            StrictMode,
                            null,
                            h(react.FieldRenderer, {
                                host,
                                renderers: {
                                    renderMultipleRecordLinksField:
                                        react.renderMultipleRecordLinksField,
                                },
                            })
                        )
                    )
                );
                assert.equal(reads, 0);
                if (scenario !== 'presentation') {
                    await act(async () => button('Load selected').click());
                    assert.equal(reads, 1);
                    assert.equal(
                        container.querySelector(
                            '.mx-sdk-linked-records-values li span'
                        )?.textContent,
                        'Visible'
                    );
                    await act(async () =>
                        owner.setLinkedOptions('links', [
                            { value: 'rec_new', label: 'New record' },
                        ])
                    );
                    const value = () =>
                        owner.field('links').getSnapshot().value;
                    const add = button('New record');
                    const initiallyDisabled = add.disabled;
                    await act(async () => add.click());
                    const afterFirstAdd = value();
                    let afterRemove = null;
                    let replacement = null;
                    if (scenario === 'one-record') {
                        await act(async () =>
                            button('Remove selected record 1').click()
                        );
                        afterRemove = value();
                        if (afterRemove.length === 0) {
                            assert.equal(button('New record').disabled, false);
                            await act(async () => button('New record').click());
                            replacement = value();
                        }
                    }
                    additionResults.push({
                        format,
                        scenario,
                        initiallyDisabled,
                        afterFirstAdd,
                        afterRemove,
                        replacement,
                        saves,
                    });
                    checks++;
                    continue;
                }
                assert.equal(
                    container.querySelectorAll(
                        '.mx-sdk-linked-records-values li'
                    ).length,
                    3
                );
                assert.doesNotMatch(container.innerHTML, /rec_one|rec_hidden/);
                checks++;
                await act(async () => button('Load selected').click());
                assert.equal(reads, 1);
                assert.equal(
                    [
                        ...container.querySelectorAll(
                            '.mx-sdk-linked-records-values li span'
                        ),
                    ]
                        .map((n) => n.textContent)
                        .join('|'),
                    'Visible|Linked record unavailable|Visible'
                );
                checks++;
                await act(async () =>
                    owner.setLinkedOptions('links', [
                        { value: 'rec_new', label: 'New record' },
                        { value: 'rec_id_fallback', label: 'rec_id_fallback' },
                    ])
                );
                assert.doesNotMatch(container.innerHTML, /rec_id_fallback/);
                assert.ok(button('Unnamed linked record'));
                await act(async () => button('New record').click());
                assert.deepEqual(owner.field('links').getSnapshot().value, [
                    'rec_one',
                    'rec_hidden',
                    'rec_new',
                ]);
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
        keys.forEach((key, i) => {
            if (originals[i])
                Object.defineProperty(globalThis, key, originals[i]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
    assert.deepEqual(
        additionResults,
        ['esm', 'cjs'].flatMap((format) => [
            {
                format,
                scenario: 'one-record',
                initiallyDisabled: true,
                afterFirstAdd: ['rec_one'],
                afterRemove: [],
                replacement: ['rec_new'],
                saves: 0,
            },
            {
                format,
                scenario: 'unlimited',
                initiallyDisabled: false,
                afterFirstAdd: ['rec_one', 'rec_new'],
                afterRemove: null,
                replacement: null,
                saves: 0,
            },
        ])
    );
    return { checks, additionResults };
}
