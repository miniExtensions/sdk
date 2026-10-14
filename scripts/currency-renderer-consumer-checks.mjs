import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const currencyRendererReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    CurrencyField, NumberField, renderCurrencyField, AirtableForm, AirtableGrid, AirtableList,
    type CurrencyFieldProps, type CurrencyFieldOptions, type FieldProps,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/currency.css';

const options: CurrencyFieldOptions = { className: 'currency-consumer', clearLabel: 'Clear amount' };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderCurrencyField: (props) => renderCurrencyField(props, options),
};
export function BoundCurrency(props: CurrencyFieldProps) {
    return <CurrencyField {...props} {...options} />;
}
export function ExistingOverrides(props: FieldProps) {
    return <><CurrencyField {...props} /><NumberField {...props} /></>;
}
export function checkCurrencyKinds(currency: FieldRendererProps<'currency'>, number: FieldRendererProps<'number'>) {
    renderCurrencyField(currency);
    // @ts-expect-error Currency metadata must not be inferred from a numeric slot.
    renderCurrencyField(number);
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed ESM/CJS public renderer APIs; synthetic owners and drafts only. */
export async function checkCurrencyRendererConsumer({
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
        const css = require.resolve('@miniextensions/sdk/react/currency.css');
        assert.match(
            readFileSync(css, 'utf8'),
            /\.mx-sdk-currency:focus-visible/
        );
        for (const moduleFormat of ['esm', 'cjs']) {
            const load = (name) =>
                moduleFormat === 'cjs'
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
            assert.equal(typeof react.renderCurrencyField, 'function');
            assert.equal(typeof react.CurrencyField, 'function');
            assert.equal(ui.renderCurrencyField, undefined);
            const native = 1234.56789;
            const symbol = '<img src=x>';
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['currency', 'number'];
            loaded.payload.formRecord.data.currency = native;
            loaded.payload.formRecord.data.number = 12.25;
            for (const kind of ['currency', 'number'])
                loaded.payload.fieldIdsToSchemas[kind] = {
                    fieldType: kind,
                    airtableField: {
                        id: kind,
                        name: kind === 'currency' ? 'Amount' : 'Quantity',
                        description: null,
                        isPrimaryField: false,
                        isComputed: false,
                        config: {
                            type: kind,
                            options:
                                kind === 'currency'
                                    ? { precision: 2, symbol }
                                    : { precision: 2 },
                        },
                    },
                    miniExtConfig: {
                        numberSeparator: 'period-comma',
                        showThousandsSeparator: true,
                    },
                };
            let saves = 0;
            const fields = forms.createFormFieldBindings({
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
                getScope: () => ({ ownerId: 'currency-consumer', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            let configurationRevision = 0;
            const host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'currency',
                isCurrent: () => true,
                configurationRevision: () => configurationRevision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const clear = () => container.querySelector('button');
                const binding = fields.field('currency');
                const describedText = () =>
                    (input().getAttribute('aria-describedby') ?? '')
                        .split(/\s+/)
                        .filter(Boolean)
                        .map(
                            (id) =>
                                window.document.getElementById(id)
                                    ?.textContent ?? ''
                        )
                        .join(' ');
                const edit = async (value) =>
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
                                renderCurrencyField: react.renderCurrencyField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().value, String(native));
                assert.equal(input().type, 'text');
                assert.equal(input().inputMode, 'decimal');
                assert.equal(binding.getSnapshot().dirty, false);
                assert.equal(container.querySelector('img'), null);
                assert.ok(container.textContent.includes(symbol));
                assert.ok(describedText().includes(symbol));
                const initialRevision =
                    fields.controller.getState().draftRevision;
                await act(async () => input().focus());
                await act(async () => input().blur());
                assert.equal(input().value, String(native));
                assert.equal(
                    fields.controller.getState().draftRevision,
                    initialRevision
                );
                assert.equal(binding.getSnapshot().value, native);
                assert.equal(saves, 0);
                checks++;

                await edit('-');
                assert.equal(binding.getSnapshot().value, native);
                assert.equal(input().value, '-');
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                await assert.rejects(fields.save());
                assert.equal(saves, 0);
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, '-');
                await edit('1.234,56');
                assert.equal(binding.getSnapshot().value, native);
                assert.equal(input().value, '1.234,56');
                await edit('1e3');
                assert.equal(binding.getSnapshot().value, 1000);
                await edit('-123.456789');
                assert.equal(binding.getSnapshot().value, -123.456789);
                assert.equal(input().value, '-123.456789');
                assert.equal(input().getAttribute('aria-invalid'), 'false');
                checks++;

                assert.equal(clear().type, 'button');
                await act(async () => clear().click());
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(window.document.activeElement, input());
                assert.equal(clear().disabled, true);
                await edit('0');
                assert.equal(binding.getSnapshot().value, 0);
                assert.equal(clear().disabled, false);
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.CurrencyField, {
                            binding,
                            className: 'consumer',
                            clearLabel: 'Effacer le montant',
                        })
                    )
                );
                assert.ok(container.querySelector('.consumer'));
                assert.equal(
                    clear().getAttribute('aria-label'),
                    'Effacer le montant'
                );
                await edit('12.3400');
                assert.equal(binding.getSnapshot().value, 12.34);
                assert.equal(input().value, '12.3400');
                await act(async () => input().focus());
                await act(async () => input().blur());
                assert.equal(input().value, '12.3400');
                await act(async () =>
                    root.render(
                        h(react.CurrencyField, {
                            binding,
                            render: ({ snapshot }) =>
                                h(
                                    'output',
                                    null,
                                    `Custom amount ${snapshot.value}`
                                ),
                        })
                    )
                );
                assert.equal(input(), null);
                assert.equal(container.textContent, 'Custom amount 12.34');
                checks++;

                const props = host.getSnapshot().fields[0];
                for (const capability of [
                    { type: 'readonly' },
                    {
                        type: 'editable',
                        setValue: () => {
                            throw Error('No direct write fallback');
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
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderCurrencyField({
                                ...props,
                                value: native,
                                capability,
                            })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                    assert.equal(input().value, String(native));
                    await edit('8');
                    assert.equal(binding.getSnapshot().value, 12.34);
                }
                checks++;

                for (const value of [null, undefined, NaN, Infinity, '1234']) {
                    await act(async () =>
                        root.render(
                            react.renderCurrencyField({
                                ...props,
                                value,
                                capability: { type: 'readonly' },
                            })
                        )
                    );
                    assert.equal(input().value, '');
                    assert.equal(input().disabled, true);
                }
                for (const precision of [0, 7]) {
                    await act(async () =>
                        root.render(
                            react.renderCurrencyField({
                                ...props,
                                field: {
                                    ...props.field,
                                    config: {
                                        type: 'currency',
                                        options: { precision, symbol },
                                    },
                                },
                                displayConfig: {
                                    numberSeparator: 'space-comma',
                                    showThousandsSeparator: true,
                                },
                                value: native,
                                capability: { type: 'readonly' },
                            })
                        )
                    );
                    assert.equal(input().value, String(native));
                }
                checks++;

                await act(async () =>
                    root.render(
                        react.renderCurrencyField({
                            ...props,
                            value: native,
                            capability: { type: 'readonly' },
                            displayConfig: {
                                showTitle: false,
                                placeholderText: 'Native amount',
                            },
                            writeConfig: {
                                obscurePassword: true,
                                required: true,
                            },
                        })
                    )
                );
                assert.equal(input().type, 'password');
                assert.equal(input().disabled, true);
                assert.equal(input().placeholder, 'Native amount');
                assert.equal(input().getAttribute('aria-label'), 'Amount');
                assert.equal(input().getAttribute('aria-required'), 'true');
                assert.equal(container.querySelector('label'), null);
                assert.equal(
                    container.textContent.includes(String(native)),
                    false
                );
                assert.ok(describedText().includes(symbol));
                for (const restriction of [
                    { pending: true },
                    { computed: true },
                    { displayConfig: { readOnly: true } },
                    { writeConfig: { readOnly: true } },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderCurrencyField({
                                ...props,
                                ...restriction,
                            })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                }
                checks++;

                for (const nextSymbol of ['$', 'USD ', '¥', '<svg>']) {
                    await act(async () =>
                        root.render(
                            react.renderCurrencyField({
                                ...props,
                                field: {
                                    ...props.field,
                                    config: {
                                        type: 'currency',
                                        options: {
                                            precision: 2,
                                            symbol: nextSymbol,
                                        },
                                    },
                                },
                                capability: { type: 'readonly' },
                            })
                        )
                    );
                    assert.ok(describedText().includes(nextSymbol));
                    assert.equal(container.querySelector('svg'), null);
                    assert.equal(input().value, '12.34');
                }
                checks++;

                const number = fields.field('number');
                await act(async () =>
                    root.render(h(react.NumberField, { binding: number }))
                );
                assert.equal(input().value, '12.25');
                assert.equal(input().inputMode, 'decimal');
                await edit('1e2');
                assert.equal(number.getSnapshot().value, 100);
                await act(async () =>
                    root.render(h(react.NumberField, { binding }))
                );
                assert.equal(input().value, '12.3400');
                assert.ok(describedText().includes(symbol));
                await act(async () =>
                    root.render(
                        h(react.NumberField, {
                            binding,
                            render: () =>
                                h(
                                    'output',
                                    null,
                                    'Custom currency through NumberField'
                                ),
                        })
                    )
                );
                assert.equal(
                    container.textContent,
                    'Custom currency through NumberField'
                );
                checks++;

                await act(async () => binding.setValue(native));
                const heldProps = host.getSnapshot().fields[0];
                await act(async () =>
                    root.render(react.renderCurrencyField(heldProps))
                );
                configurationRevision++;
                const beforeStale = fields.controller.getState().draftRevision;
                await edit('999');
                await act(async () => clear().click());
                assert.equal(binding.getSnapshot().value, native);
                assert.equal(
                    fields.controller.getState().draftRevision,
                    beforeStale
                );
                assert.equal(host.getSnapshot().status, 'retired');
                assert.equal(saves, 0);
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
