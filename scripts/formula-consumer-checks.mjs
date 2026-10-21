import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const formulaReactTypedConsumer = `
import type { ReactNode } from 'react';
import { FormulaField, renderFormulaField, AirtableForm, AirtableGrid, AirtableList, type FormulaFieldProps, type FormulaFieldOptions } from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
const options: FormulaFieldOptions = { className: 'formula-consumer' };
// @ts-expect-error Formula has no editor or write option.
const write: FormulaFieldOptions = { setValue: (value: number) => {} };
// @ts-expect-error Formula has no Clear button.
const clear: FormulaFieldOptions = { clearLabel: 'Clear' };
export const renderers: FieldRendererSlots<ReactNode> = { renderFormulaField: props => renderFormulaField(props, options) };
export function Bound(props: FormulaFieldProps) { return <FormulaField {...props} {...options} />; }
export function Override(props: FormulaFieldProps) { return <FormulaField {...props} render={({snapshot}) => <span>{String(snapshot.value ?? '')}</span>} />; }
export function Kinds(formula: FieldRendererProps<'formula'>, rollup: FieldRendererProps<'rollup'>) {
    const readonly: { type: 'readonly' } = formula.capability;
    // @ts-expect-error Rollup remains a separate physical slot.
    renderFormulaField(rollup);
    // @ts-expect-error Formula has no editable capability.
    const editable: FieldRendererProps<'formula'>['capability'] = { type: 'editable', setValue: () => ({accepted: true}) };
    return readonly;
}
export function Compositions({form, portal}: {form: FormRenderScope; portal: PortalRenderScope}) { return <>
    <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
    <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
    <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
</>; }
`;

/** Synthetic accepted Form shared by installed and packed-browser checks. */
export function formulaLoadedFixture() {
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
    const number = { type: 'number', options: { precision: 2 } };
    const text = { type: 'singleLineText', options: null };
    const data = [
        ['amount', number, -1234.567, '-1234.57'],
        ['array', number, [1.234, null, 2.345], '1.23, 2.35'],
        [
            'text',
            text,
            '<img src="https://secret.invalid/image">\n**literal**',
            '<img src="https://secret.invalid/image">\n**literal**',
        ],
        ['empty', number, null, ''],
        ['missing', number, undefined, ''],
        ['error', number, { error: '#ERROR!' }, '#ERROR!'],
        ['special', number, { specialValue: 'Infinity' }, 'Infinity'],
        [
            'choices',
            { type: 'multipleSelects', options: { choices: [] } },
            ['a', 'b'],
            'a, b',
        ],
        [
            'currency',
            { type: 'currency', options: { symbol: '$', precision: 2 } },
            -1234.567,
            '-$1,234.57',
        ],
        ['masked', text, 'PRIVATE_MASKED_ANSWER', '••••••••'],
        ['invalid', null, 123, ''],
        [
            'linked',
            {
                type: 'multipleRecordLinks',
                options: {
                    linkedTableId: 'private',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                },
            },
            ['rec12345678901234', 'Supplied label'],
            'Unavailable, Supplied label',
        ],
    ];
    loaded.payload.fieldIdsInForm = data.map(([id]) => id);
    for (const [id, result, value] of data) {
        if (value === undefined) delete loaded.payload.formRecord.data[id];
        else loaded.payload.formRecord.data[id] = value;
        loaded.payload.fieldIdsToSchemas[id] = {
            fieldType: 'formula',
            airtableField: {
                id,
                name: id,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'formula',
                    options: result
                        ? { isValid: true, result }
                        : { isValid: false, result: null },
                },
            },
            miniExtConfig:
                id === 'masked'
                    ? { obscurePassword: true }
                    : {
                          renderFormulaAsHTML: true,
                          renderFormulaAsAttachment: true,
                          displayAsButton: true,
                      },
        };
    }
    return {
        loaded,
        expected: data.map(([id, , , expected]) => [id, expected]),
    };
}

export async function checkFormulaConsumer({
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
            assert.equal(ui.renderFormulaField, undefined);
            assert.equal(typeof react.FormulaField, 'function');
            const { loaded, expected } = formulaLoadedFixture();
            let requests = 0;
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error('No Formula Save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'formula-consumer', revision: 0 }),
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
                    renderFormulaField: (props) =>
                        h(
                            'div',
                            { 'data-field': props.fieldId },
                            react.renderFormulaField(props)
                        ),
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
                assert.equal(
                    container.innerHTML.includes('PRIVATE_MASKED_ANSWER'),
                    false
                );
                assert.equal(
                    container.innerHTML.includes('rec12345678901234'),
                    false
                );
                assert.equal(requests, 0);
                const binding = fields.field('amount');
                const before = binding.getSnapshot();
                binding.setValue = () => {
                    throw Error('Do not borrow a Formula setter');
                };
                await act(async () =>
                    root.render(h(react.FormulaField, { binding }))
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
