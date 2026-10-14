import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const emailReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    EmailField, TextField, renderEmailField, AirtableForm, AirtableGrid, AirtableList,
    type EmailFieldProps, type EmailFieldOptions, type TextFieldProps, type TextFieldOptions,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

const options: EmailFieldOptions = { className: 'email-consumer', clearLabel: 'Clear address' };
const textOptions: TextFieldOptions = options;
export const renderers: FieldRendererSlots<ReactNode> = {
    renderEmailField: props => renderEmailField(props, options),
};
export function BoundEmail(props: EmailFieldProps) {
    const textProps: TextFieldProps = props;
    return <><EmailField {...props} {...options} /><TextField {...textProps} {...textOptions} /></>;
}
export function EmailOverride(props: EmailFieldProps) {
    return <EmailField {...props} render={({ snapshot }) => <span>{String(snapshot.value ?? '')}</span>} />;
}
export function checkEmailKinds(email: FieldRendererProps<'email'>, text: FieldRendererProps<'singleLineText'>) {
    renderEmailField(email);
    // @ts-expect-error A single-line text slot is not an Email slot.
    renderEmailField(text);
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed ESM/CJS APIs with synthetic drafts; no mail, verification or Save. */
export async function checkEmailConsumer({
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
        const css = require.resolve('@miniextensions/sdk/react/text.css');
        assert.match(readFileSync(css, 'utf8'), /\.mx-sdk-text:focus-visible/);
        assert.throws(
            () => require.resolve('@miniextensions/sdk/react/email.css'),
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
            assert.equal(typeof react.renderEmailField, 'function');
            assert.equal(typeof react.EmailField, 'function');
            assert.equal(ui.renderEmailField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['email'];
            loaded.payload.formRecord.data.email = null;
            loaded.payload.fieldIdsToSchemas.email = {
                fieldType: 'email',
                airtableField: {
                    id: 'email',
                    name: 'Email address',
                    description: null,
                    isPrimaryField: false,
                    isComputed: false,
                    config: { type: 'email', options: null },
                },
                miniExtConfig: {
                    placeholderText: 'person@example.test',
                    emailLetterCase: 'lowercase',
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
                getScope: () => ({ ownerId: 'email-consumer', revision: 0 }),
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
                fieldId: 'email',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const binding = fields.field('email');
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
                                renderEmailField: react.renderEmailField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().type, 'text');
                assert.equal(input().value, '');
                assert.equal(input().placeholder, 'person@example.test');
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(writes, 0);
                for (const value of [
                    '  MiXeD+tag@Example.TEST  ',
                    '日本語@例え.test',
                    'not an address',
                    '<img src=x>@example.test',
                ]) {
                    await edit(value);
                    assert.equal(binding.getSnapshot().value, value);
                    assert.equal(input().value, value);
                    assert.equal(container.querySelector('a,img,iframe'), null);
                }
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, '<img src=x>@example.test');
                assert.equal(writes, 4);
                checks++;

                const clear = container.querySelector('button');
                assert.equal(clear.type, 'button');
                await act(async () => clear.click());
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(window.document.activeElement, input());
                assert.equal(writes, 5);
                await compose('compositionstart');
                await edit('にほんご@');
                assert.equal(binding.getSnapshot().value, null);
                await compose('compositionend');
                assert.equal(binding.getSnapshot().value, 'にほんご@');
                assert.equal(writes, 6);
                await edit('にほんご@');
                assert.equal(writes, 6);
                checks++;

                const props = host.getSnapshot().fields[0];
                await act(async () =>
                    root.render(react.renderEmailField(props))
                );
                revision++;
                await edit('stale@example.test');
                assert.equal(binding.getSnapshot().value, 'にほんご@');
                assert.equal(input().value, 'にほんご@');
                await act(async () =>
                    container.querySelector('button').click()
                );
                assert.equal(binding.getSnapshot().value, 'にほんご@');
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
                            react.renderEmailField({
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
                    await edit('blocked@example.test');
                }
                await act(async () =>
                    root.render(
                        react.renderEmailField({
                            ...props,
                            capability: { type: 'readonly' },
                            displayConfig: { showTitle: false },
                            writeConfig: { maskPasswordOnLoginScreen: true },
                            error: '<b>Address rejected</b>',
                        })
                    )
                );
                assert.equal(input().type, 'password');
                assert.equal(
                    input().getAttribute('aria-label'),
                    'Email address'
                );
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                const feedback = window.document.getElementById(
                    input().getAttribute('aria-describedby')
                );
                assert.equal(feedback.textContent, '<b>Address rejected</b>');
                assert.equal(container.querySelector('b,a,img'), null);
                assert.equal(directWrites, 0);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.EmailField, {
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
                await edit('  Still.Mixed@Example.TEST  ');
                assert.equal(
                    binding.getSnapshot().value,
                    '  Still.Mixed@Example.TEST  '
                );
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                const beforeOverride = writes;
                await act(async () =>
                    root.render(
                        h(react.EmailField, {
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
