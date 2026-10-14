import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const phoneNumberReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    PhoneNumberField, TextField, renderPhoneNumberField, AirtableForm, AirtableGrid, AirtableList,
    type PhoneNumberFieldProps, type PhoneNumberFieldOptions, type TextFieldProps, type TextFieldOptions,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

const options: PhoneNumberFieldOptions = { className: 'phone-number-consumer', clearLabel: 'Clear Phone number' };
const textOptions: TextFieldOptions = options;
export const renderers: FieldRendererSlots<ReactNode> = {
    renderPhoneNumberField: props => renderPhoneNumberField(props, options),
};
export function BoundPhoneNumber(props: PhoneNumberFieldProps) {
    const textProps: TextFieldProps = props;
    return <><PhoneNumberField {...props} {...options} /><TextField {...textProps} {...textOptions} /></>;
}
export function PhoneNumberOverride(props: PhoneNumberFieldProps) {
    return <PhoneNumberField {...props} render={({ snapshot }) => <span>{String(snapshot.value ?? '')}</span>} />;
}
export function checkPhoneNumberKinds(phone: FieldRendererProps<'phoneNumber'>, text: FieldRendererProps<'singleLineText'>) {
    renderPhoneNumberField(phone);
    // @ts-expect-error A single-line text slot is not a Phone number slot.
    renderPhoneNumberField(text);
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed ESM/CJS APIs with synthetic drafts; no dialing, navigation, requests or Save. */
export async function checkPhoneNumberConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let requests = 0;
    let openCalls = 0;
    window.open = () => {
        openCalls++;
        return null;
    };
    window.fetch = () => {
        requests++;
        throw Error('No Phone number requests');
    };
    const initialLocation = window.location.href;
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
    let checks = 0;
    try {
        const css = require.resolve('@miniextensions/sdk/react/text.css');
        assert.match(readFileSync(css, 'utf8'), /\.mx-sdk-text:focus-visible/);
        assert.throws(
            () => require.resolve('@miniextensions/sdk/react/phone-number.css'),
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
            assert.equal(typeof react.renderPhoneNumberField, 'function');
            assert.equal(typeof react.PhoneNumberField, 'function');
            assert.equal(ui.renderPhoneNumberField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['phoneNumber'];
            loaded.payload.formRecord.data.phoneNumber = null;
            loaded.payload.fieldIdsToSchemas.phoneNumber = {
                fieldType: 'phoneNumber',
                airtableField: {
                    id: 'phoneNumber',
                    name: 'Phone number',
                    description: null,
                    isPrimaryField: false,
                    isComputed: false,
                    config: { type: 'phoneNumber', options: null },
                },
                miniExtConfig: {
                    placeholderText: 'Enter a phone number',
                    showCountryCodes: true,
                    defaultCountryCode: 'US',
                },
            };
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            requests++;
                            throw Error('No implicit Save');
                        },
                    },
                },
                getScope: () => ({
                    ownerId: 'phone-number-consumer',
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
            let revision = 0;
            const host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'phoneNumber',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const binding = fields.field('phoneNumber');
                let writes = 0;
                const original = binding.setValue;
                binding.setValue = (value) => {
                    writes++;
                    return original(value);
                };
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
                const compose = async (type) =>
                    act(async () =>
                        input().dispatchEvent(
                            new window.CompositionEvent(type, { bubbles: true })
                        )
                    );
                const tree = () =>
                    h(
                        StrictMode,
                        null,
                        h(react.FieldRenderer, {
                            host,
                            renderers: {
                                renderPhoneNumberField:
                                    react.renderPhoneNumberField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().type, 'text');
                assert.equal(input().value, '');
                assert.equal(input().placeholder, 'Enter a phone number');
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(writes, 0);
                const literalValues = [
                    '  +001 (202) 555-0123 ext. 004  ',
                    '0000123',
                    '+44 (0)20 0000 0000',
                    '001-002.003;ext=004',
                    '+',
                    '(incomplete',
                    'not a phone number',
                    '１２３ ٤٥٦',
                    'tel:+12025550123;ext=004',
                    'sms:+12025550123',
                    '<img src=x>',
                ];
                for (const value of literalValues) {
                    await edit(value);
                    assert.equal(binding.getSnapshot().value, value);
                    assert.equal(input().value, value);
                    assert.equal(
                        container.querySelector(
                            '[href],[src],a,img,iframe,video,canvas,select,[role=combobox]'
                        ),
                        null
                    );
                }
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, literalValues.at(-1));
                assert.equal(writes, literalValues.length);
                checks++;

                assert.equal(container.querySelectorAll('button').length, 1);
                const clear = container.querySelector('button');
                assert.equal(clear.type, 'button');
                await act(async () => clear.click());
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(window.document.activeElement, input());
                assert.equal(writes, literalValues.length + 1);
                await compose('compositionstart');
                await edit('＋１２３ ٤٥٦');
                assert.equal(binding.getSnapshot().value, null);
                await compose('compositionend');
                assert.equal(binding.getSnapshot().value, '＋１２３ ٤٥٦');
                assert.equal(writes, literalValues.length + 2);
                await edit('＋１２３ ٤٥٦');
                assert.equal(writes, literalValues.length + 2);
                checks++;

                const props = host.getSnapshot().fields[0];
                await act(async () =>
                    root.render(react.renderPhoneNumberField(props))
                );
                revision++;
                await edit('+000 stale');
                assert.equal(binding.getSnapshot().value, '＋１２３ ٤٥٦');
                assert.equal(input().value, '＋１２３ ٤٥٦');
                await act(async () =>
                    container.querySelector('button').click()
                );
                assert.equal(binding.getSnapshot().value, '＋１２３ ٤٥٦');
                checks++;

                let directWrites = 0;
                const editable = {
                    type: 'editable',
                    setValue: () => {
                        directWrites++;
                        return { accepted: true };
                    },
                };
                for (const restrictions of [
                    { capability: { type: 'readonly' } },
                    { displayConfig: { readOnly: true } },
                    { writeConfig: { readOnly: true } },
                    { pending: true },
                    { computed: true },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderPhoneNumberField({
                                ...props,
                                capability: editable,
                                ...restrictions,
                            })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(
                        container.querySelector('button').disabled,
                        true
                    );
                    await edit('+000 blocked');
                }
                await act(async () =>
                    root.render(
                        react.renderPhoneNumberField({
                            ...props,
                            capability: { type: 'readonly' },
                            displayConfig: { showTitle: false },
                            writeConfig: { maskPasswordOnLoginScreen: true },
                            error: '<b>Phone number rejected</b>',
                        })
                    )
                );
                assert.equal(input().type, 'password');
                assert.equal(
                    input().getAttribute('aria-label'),
                    'Phone number'
                );
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                const feedback = window.document.getElementById(
                    input().getAttribute('aria-describedby')
                );
                assert.equal(
                    feedback.textContent,
                    '<b>Phone number rejected</b>'
                );
                assert.equal(container.querySelector('b,a,img'), null);
                assert.equal(directWrites, 0);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.PhoneNumberField, {
                            binding,
                            className: 'consumer',
                            clearLabel: 'Effacer',
                        })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-text-field')
                );
                assert.equal(
                    container
                        .querySelector('button')
                        .getAttribute('aria-label'),
                    'Effacer'
                );
                await edit('  +000 (123) 456-789 ext. 00  ');
                assert.equal(
                    binding.getSnapshot().value,
                    '  +000 (123) 456-789 ext. 00  '
                );
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                const beforeOverride = writes;
                await act(async () =>
                    root.render(
                        h(react.PhoneNumberField, {
                            binding,
                            render: ({ snapshot }) =>
                                h(
                                    'span',
                                    { 'data-custom': true },
                                    String(snapshot.value)
                                ),
                        })
                    )
                );
                assert.equal(input(), null);
                assert.equal(
                    container.querySelector('[data-custom]').textContent,
                    'null'
                );
                assert.equal(writes, beforeOverride);
                checks++;

                // The accepted host has retired after configuration replacement.
                await act(async () => root.render(tree()));
                assert.equal(input(), null);
                assert.equal(requests, 0);
                assert.equal(openCalls, 0);
                assert.equal(window.location.href, initialLocation);
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
