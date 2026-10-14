import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const percentReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    PercentField, NumberField, renderPercentField, AirtableForm, AirtableGrid, AirtableList,
    type PercentFieldProps, type PercentFieldOptions, type NumberFieldProps, type NumberFieldOptions,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/number.css';

const options: PercentFieldOptions = { className: 'percent-consumer' };
const numberOptions: NumberFieldOptions = options;
// @ts-expect-error Percent reuses Number options; it adds no Clear button.
const unsupported: PercentFieldOptions = { clearLabel: 'Clear percent' };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderPercentField: props => renderPercentField(props, options),
};
export function BoundPercent(props: PercentFieldProps) {
    const numberProps: NumberFieldProps = props;
    return <><PercentField {...props} {...options} /><NumberField {...numberProps} {...numberOptions} /></>;
}
export function PercentOverride(props: PercentFieldProps) {
    return <PercentField {...props} render={({ snapshot }) => <span>{snapshot.scalar?.input}</span>} />;
}
export function checkPercentKinds(percent: FieldRendererProps<'percent'>, number: FieldRendererProps<'number'>, currency: FieldRendererProps<'currency'>) {
    renderPercentField(percent);
    // @ts-expect-error A numeric slot is not the percent slot.
    renderPercentField(number);
    // @ts-expect-error Currency metadata does not authorize a percent slot.
    renderPercentField(currency);
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed ESM/CJS APIs and real synthetic scalar owners; no live services. */
export async function checkPercentConsumer({
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
    let requests = 0;
    try {
        const css = require.resolve('@miniextensions/sdk/react/number.css');
        assert.match(
            readFileSync(css, 'utf8'),
            /\.mx-sdk-number:focus-visible/
        );
        assert.throws(
            () => require.resolve('@miniextensions/sdk/react/percent.css'),
            { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }
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
            const [ui, forms, react] = await Promise.all(
                ['ui', 'forms', 'react'].map(load)
            );
            assert.equal(typeof react.PercentField, 'function');
            assert.equal(typeof react.renderPercentField, 'function');
            assert.equal(ui.renderPercentField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = [
                'percent',
                'number',
                'currency',
                'duration',
            ];
            for (const [kind, value, options] of [
                ['percent', 0.25, { precision: 0 }],
                ['number', 12.5, { precision: 2 }],
                ['currency', 1234.56, { precision: 2, symbol: '$' }],
                ['duration', 60, { durationFormat: 'h:mm:ss' }],
            ]) {
                loaded.payload.formRecord.data[kind] = value;
                loaded.payload.fieldIdsToSchemas[kind] = {
                    fieldType: kind,
                    airtableField: {
                        id: kind,
                        name: kind === 'percent' ? 'Ratio' : kind,
                        description: null,
                        isPrimaryField: false,
                        isComputed: false,
                        config: { type: kind, options },
                    },
                    miniExtConfig:
                        kind === 'percent'
                            ? {
                                  placeholderText: 'Native fraction',
                                  showAsProgressBar: true,
                                  numberSeparator: 'period-comma',
                                  showThousandsSeparator: true,
                              }
                            : {},
                };
            }
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error('No transport or implicit Save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'percent-consumer', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            let revision = 0;
            const host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'percent',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const binding = fields.field('percent');
                const scalar = binding.scalar;
                const input = () => container.querySelector('input');
                const edit = (value) =>
                    act(async () => {
                        Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype,
                            'value'
                        ).set.call(input(), value);
                        input().dispatchEvent(
                            new window.Event('input', { bubbles: true })
                        );
                    });
                const tree = () =>
                    h(
                        StrictMode,
                        null,
                        h(react.FieldRenderer, {
                            host,
                            renderers: {
                                renderPercentField: react.renderPercentField,
                            },
                            fallback: () => null,
                        })
                    );
                const initialRevision = scalar.getState().revision;
                await act(async () => root.render(tree()));
                assert.equal(scalar.getState().revision, initialRevision);
                assert.equal(input().value, '0.25');
                assert.equal(input().type, 'text');
                assert.equal(input().inputMode, 'decimal');
                assert.equal(input().placeholder, 'Native fraction');
                assert.equal(
                    container.querySelector(
                        'progress,[role=progressbar],button'
                    ),
                    null
                );
                assert.equal(container.textContent.includes('%'), false);
                for (const [text, native] of [
                    ['-0.5', -0.5],
                    ['1.25', 1.25],
                    ['1e2', 100],
                    ['0.123456789', 0.123456789],
                    ['0.2500', 0.25],
                ]) {
                    await edit(text);
                    assert.equal(input().value, text);
                    assert.equal(binding.getSnapshot().value, native);
                }
                const blurRevision = scalar.getState().revision;
                await act(async () => input().focus());
                await act(async () => input().blur());
                assert.equal(input().value, '0.2500');
                assert.equal(scalar.getState().revision, blurRevision);
                checks++;

                await edit('1e');
                assert.equal(input().value, '1e');
                assert.equal(binding.getSnapshot().value, 0.25);
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                await act(async () => {
                    await assert.rejects(() => fields.save());
                });
                const partialRevision = scalar.getState().revision;
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, '1e');
                assert.equal(binding.scalar, scalar);
                assert.equal(scalar.getState().revision, partialRevision);
                await edit('-');
                assert.equal(binding.getSnapshot().value, 0.25);
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                await edit('0');
                assert.equal(binding.getSnapshot().value, 0);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.PercentField, {
                            binding,
                            className: 'consumer',
                        })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-number-field')
                );
                await edit('0.7654321');
                assert.equal(binding.getSnapshot().value, 0.7654321);
                await act(async () =>
                    root.render(h(react.NumberField, { binding }))
                );
                assert.ok(container.querySelector('.mx-sdk-number-field'));
                assert.equal(input().value, '0.7654321');
                assert.equal(container.querySelector('button,progress'), null);
                await act(async () =>
                    root.render(
                        h(react.PercentField, {
                            binding,
                            render: ({ snapshot }) =>
                                h(
                                    'output',
                                    null,
                                    `Custom ratio ${snapshot.scalar.input}`
                                ),
                        })
                    )
                );
                assert.equal(input(), null);
                assert.equal(container.textContent, 'Custom ratio 0.7654321');
                await act(async () =>
                    root.render(
                        h(react.NumberField, {
                            binding: fields.field('number'),
                        })
                    )
                );
                assert.ok(container.querySelector('.mx-sdk-number-field'));
                await edit('7.125');
                assert.equal(fields.field('number').getSnapshot().value, 7.125);
                assert.equal(binding.getSnapshot().value, 0.7654321);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.NumberField, {
                            binding: fields.field('currency'),
                        })
                    )
                );
                assert.ok(container.querySelector('.mx-sdk-currency-field'));
                assert.ok(container.textContent.includes('$'));
                assert.equal(input().value, '1234.56');
                await edit('7.5');
                assert.equal(fields.field('currency').getSnapshot().value, 7.5);
                await act(async () =>
                    root.render(
                        h(react.NumberField, {
                            binding: fields.field('duration'),
                        })
                    )
                );
                assert.ok(container.querySelector('.mx-sdk-duration-field'));
                assert.equal(input().inputMode, 'text');
                await edit('1:02:03');
                assert.equal(
                    fields.field('duration').getSnapshot().value,
                    3723
                );
                assert.equal(binding.getSnapshot().value, 0.7654321);
                checks++;

                const props = host.getSnapshot().fields[0];
                for (const capability of [
                    { type: 'readonly' },
                    {
                        type: 'editable',
                        setValue: () => {
                            throw Error('No raw numeric write fallback');
                        },
                    },
                    {
                        ...props.capability,
                        scalar: {
                            ...props.capability.scalar,
                            state: {
                                ...props.capability.scalar.state,
                                kind: 'duration',
                            },
                        },
                    },
                    {
                        ...props.capability,
                        scalar: {
                            ...props.capability.scalar,
                            state: {
                                ...props.capability.scalar.state,
                                canEdit: false,
                            },
                        },
                    },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderPercentField({ ...props, capability })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(input().value, '0.7654321');
                    await edit('5');
                    assert.equal(binding.getSnapshot().value, 0.7654321);
                }
                for (const restriction of [
                    { displayConfig: { readOnly: true } },
                    { writeConfig: { readOnly: true } },
                    { pending: true },
                    { computed: true },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderPercentField({
                                ...props,
                                ...restriction,
                            })
                        )
                    );
                    assert.equal(input().disabled, true);
                    await edit('5');
                    assert.equal(binding.getSnapshot().value, 0.7654321);
                }
                checks++;

                await act(async () =>
                    root.render(
                        react.renderPercentField({
                            ...props,
                            capability: { type: 'readonly' },
                            displayConfig: {
                                showTitle: false,
                                placeholderText: 'Native ratio',
                            },
                            writeConfig: {
                                maskPasswordOnLoginScreen: true,
                                required: true,
                            },
                            error: '<b>Ratio rejected</b>',
                        })
                    )
                );
                assert.equal(input().type, 'password');
                assert.equal(input().getAttribute('aria-label'), 'Ratio');
                assert.equal(input().getAttribute('aria-required'), 'true');
                assert.equal(input().placeholder, 'Native ratio');
                assert.equal(container.querySelector('label,b'), null);
                const feedback = window.document.getElementById(
                    input().getAttribute('aria-describedby')
                );
                assert.equal(feedback.textContent, '<b>Ratio rejected</b>');
                assert.equal(
                    container.textContent.includes('0.7654321'),
                    false
                );
                for (const value of [null, undefined, NaN, Infinity, '0.25']) {
                    await act(async () =>
                        root.render(
                            react.renderPercentField({
                                ...props,
                                value,
                                capability: { type: 'readonly' },
                                error: '',
                            })
                        )
                    );
                    assert.equal(input().value, '');
                    assert.equal(
                        container.querySelector('[role=status]').textContent,
                        ''
                    );
                }
                checks++;

                await act(async () =>
                    root.render(react.renderPercentField(props))
                );
                revision++;
                await edit('99');
                assert.equal(binding.getSnapshot().value, 0.7654321);
                assert.equal(input().value, '0.7654321');
                checks++;

                await act(async () => root.render(tree()));
                assert.equal(input(), null);
                await act(async () =>
                    root.render(
                        react.renderPercentField({
                            ...props,
                            capability: {
                                ...props.capability,
                                scalar: {
                                    ...props.capability.scalar,
                                    state: {
                                        ...props.capability.scalar.state,
                                        retired: true,
                                    },
                                },
                            },
                        })
                    )
                );
                assert.equal(input(), null);
                await act(async () =>
                    root.render(h(react.PercentField, { binding }))
                );
                assert.equal(input().value, '0.7654321');
                const finalRevision = scalar.getState().revision;
                await act(async () => root.render(null));
                assert.equal(scalar.getState().revision, finalRevision);
                assert.equal(scalar.getState().retired, false);
                assert.equal(requests, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                host.dispose();
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
