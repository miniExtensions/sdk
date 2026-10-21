import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const multilineTextReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    MultilineTextField, TextField, renderMultilineTextField, AirtableForm, AirtableGrid, AirtableList,
    type MultilineTextFieldProps, type MultilineTextFieldOptions, type TextFieldProps, type TextFieldOptions,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';

const options: MultilineTextFieldOptions = { className: 'multiline-text-consumer', clearLabel: 'Clear notes' };
const textOptions: TextFieldOptions = options;
export const renderers: FieldRendererSlots<ReactNode> = {
    renderMultilineTextField: props => renderMultilineTextField(props, options),
};
export function BoundMultilineText(props: MultilineTextFieldProps) {
    const textProps: TextFieldProps = props;
    return <><MultilineTextField {...props} {...options} /><TextField {...textProps} {...textOptions} /></>;
}
export function MultilineTextOverride(props: MultilineTextFieldProps) {
    return <MultilineTextField {...props} render={({ snapshot }) => <span>{String(snapshot.value ?? '')}</span>} />;
}
export function checkMultilineTextKinds(notes: FieldRendererProps<'multilineText'>, text: FieldRendererProps<'singleLineText'>) {
    renderMultilineTextField(notes);
    // @ts-expect-error A single-line text slot is not a multiline text slot.
    renderMultilineTextField(text);
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed ESM/CJS APIs with synthetic drafts; no navigation, requests or Save. */
export async function checkMultilineTextConsumer({
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
        throw Error('No multiline requests');
    };
    const initialLocation = window.location.href;
    const keys = [
        'window',
        'document',
        'navigator',
        'fetch',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLTextAreaElement',
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
        assert.match(
            readFileSync(css, 'utf8'),
            /textarea\.mx-sdk-multiline-text/
        );
        assert.throws(
            () =>
                require.resolve('@miniextensions/sdk/react/multiline-text.css'),
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
            assert.equal(typeof react.renderMultilineTextField, 'function');
            assert.equal(typeof react.MultilineTextField, 'function');
            assert.equal(ui.renderMultilineTextField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['multilineText'];
            const initial = '  First line  \r\n\r\nLast line\r\n';
            loaded.payload.formRecord.data.multilineText = initial;
            loaded.payload.fieldIdsToSchemas.multilineText = {
                fieldType: 'multilineText',
                airtableField: {
                    id: 'multilineText',
                    name: 'Notes',
                    description: null,
                    isPrimaryField: false,
                    isComputed: false,
                    config: { type: 'multilineText', options: null },
                },
                miniExtConfig: {
                    placeholderText: 'Write notes',
                    preserveTrailingWhitespace: false,
                },
            };
            for (const [id, kind, config] of [
                ['addOnly', 'multilineText', { addOnlyMode: true }],
                [
                    'attachments',
                    'multilineText',
                    { displayAsAttachments: true },
                ],
                ['single', 'singleLineText', {}],
                ['replacement', 'multilineText', {}],
            ]) {
                loaded.payload.fieldIdsInForm.push(id);
                loaded.payload.formRecord.data[id] =
                    id === 'replacement'
                        ? 'Replacement owner\n'
                        : 'PRIVATE-MULTILINE\nvalue';
                loaded.payload.fieldIdsToSchemas[id] = {
                    fieldType: kind,
                    airtableField: {
                        id,
                        name: 'Notes',
                        description: null,
                        isPrimaryField: false,
                        isComputed: false,
                        config: { type: kind, options: null },
                    },
                    miniExtConfig: config,
                };
            }
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
                    ownerId: 'multiline-text-consumer',
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
                fieldId: 'multilineText',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('textarea');
                const clear = () => container.querySelector('button');
                const binding = fields.field('multilineText');
                let writes = 0;
                const original = binding.setValue;
                binding.setValue = (value) => {
                    writes++;
                    return original(value);
                };
                const edit = (value) =>
                    act(async () => {
                        Object.getOwnPropertyDescriptor(
                            window.HTMLTextAreaElement.prototype,
                            'value'
                        ).set.call(input(), value);
                        input().dispatchEvent(
                            new window.Event('input', { bubbles: true })
                        );
                    });
                const compose = (type) =>
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
                                renderMultilineTextField:
                                    react.renderMultilineTextField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().getAttribute('rows'), '4');
                assert.equal(input().placeholder, 'Write notes');
                assert.equal(container.querySelector('input'), null);
                assert.equal(binding.getSnapshot().value, initial);
                // Happy DOM does not model native textarea CRLF normalization.
                // Assert line content here; Chromium separately proves DOM normalization.
                assert.equal(
                    input().value.replace(/\r\n?/g, '\n'),
                    initial.replace(/\r\n?/g, '\n')
                );
                assert.equal(writes, 0);
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(binding.getSnapshot().value, initial);
                assert.equal(writes, 0);
                checks++;

                for (const value of [
                    '  Leading\n\nTrailing  \n',
                    '\n\n',
                    '0',
                    '**plain**\n<b>literal</b>',
                    'First line\nSecond line\n',
                ]) {
                    await edit(value);
                    assert.equal(binding.getSnapshot().value, value);
                    assert.equal(input().value, value);
                    assert.equal(
                        container.querySelector(
                            'b,a,img,iframe,[contenteditable]'
                        ),
                        null
                    );
                }
                checks++;

                assert.equal(clear().type, 'button');
                assert.equal(clear().getAttribute('aria-controls'), input().id);
                await act(async () => clear().click());
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(window.document.activeElement, input());
                const beforeComposition = writes;
                await compose('compositionstart');
                await edit('alpha\n日本\n');
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(clear().disabled, true);
                await compose('compositionend');
                assert.equal(binding.getSnapshot().value, 'alpha\n日本\n');
                assert.equal(writes, beforeComposition + 1);
                await edit('alpha\n日本\n');
                assert.equal(writes, beforeComposition + 1);
                checks++;

                const props = host.getSnapshot().fields[0];
                const nativeBeforeRestriction = binding.getSnapshot().value;
                for (const restriction of [
                    { capability: { type: 'readonly' } },
                    { displayConfig: { readOnly: true } },
                    { writeConfig: { readOnly: true } },
                    { pending: true },
                    { computed: true },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderMultilineTextField({
                                ...props,
                                ...restriction,
                            })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                    await edit('blocked\nchange');
                    assert.equal(
                        binding.getSnapshot().value,
                        nativeBeforeRestriction
                    );
                }
                await act(async () =>
                    root.render(
                        react.renderMultilineTextField({
                            ...props,
                            capability: { type: 'readonly' },
                            displayConfig: { showTitle: false, required: true },
                            error: '<b>Notes rejected</b>',
                        })
                    )
                );
                assert.equal(input().getAttribute('aria-label'), 'Notes');
                assert.equal(input().getAttribute('aria-required'), 'true');
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                assert.equal(container.querySelector('label,b'), null);
                const feedback = window.document.getElementById(
                    input().getAttribute('aria-describedby')
                );
                assert.equal(feedback.textContent, '<b>Notes rejected</b>');
                checks++;

                for (const key of [
                    'addOnlyMode',
                    'displayAsAttachments',
                    'obscurePassword',
                    'maskPasswordOnLoginScreen',
                ]) {
                    for (const side of ['displayConfig', 'writeConfig']) {
                        for (const signal of [true, null, 'false', 0]) {
                            await act(async () =>
                                root.render(
                                    react.renderMultilineTextField({
                                        ...props,
                                        value: 'PRIVATE-MULTILINE\nvalue',
                                        error: 'PRIVATE-MULTILINE feedback',
                                        [side]: { [key]: signal },
                                    })
                                )
                            );
                            assert.equal(
                                container.querySelector(
                                    'textarea,input,button,.mx-sdk-text-count'
                                ),
                                null
                            );
                            assert.match(
                                container.querySelector('[role=status]')
                                    .textContent,
                                /custom renderer/i
                            );
                            assert.equal(
                                container.innerHTML.includes(
                                    'PRIVATE-MULTILINE'
                                ),
                                false
                            );
                        }
                        await act(async () =>
                            root.render(
                                react.renderMultilineTextField({
                                    ...props,
                                    [side]: { [key]: false },
                                })
                            )
                        );
                        assert.ok(input());
                    }
                }
                checks++;

                await act(async () =>
                    root.render(
                        h(react.MultilineTextField, {
                            binding,
                            className: 'consumer',
                            clearLabel: 'Effacer les notes',
                        })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-text-field')
                );
                assert.equal(
                    clear().getAttribute('aria-label'),
                    'Effacer les notes'
                );
                await edit('  Bound text\n\n');
                assert.equal(binding.getSnapshot().value, '  Bound text\n\n');
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                for (const id of ['addOnly', 'attachments', 'single']) {
                    let unsupported;
                    await act(async () => {
                        unsupported = fields.field(id);
                    });
                    await act(async () =>
                        root.render(
                            h(react.MultilineTextField, {
                                binding: unsupported,
                            })
                        )
                    );
                    assert.equal(
                        container.querySelector('textarea,input,button'),
                        null
                    );
                    assert.ok(container.querySelector('[role=status]'));
                    assert.equal(
                        container.innerHTML.includes('PRIVATE-MULTILINE'),
                        false
                    );
                    await act(async () =>
                        root.render(
                            h(react.MultilineTextField, {
                                binding: unsupported,
                                render: () =>
                                    h('output', null, 'Custom presentation'),
                            })
                        )
                    );
                    assert.equal(container.textContent, 'Custom presentation');
                    assert.equal(
                        unsupported.getSnapshot().value,
                        'PRIVATE-MULTILINE\nvalue'
                    );
                }
                checks++;

                const limitedWrites = [];
                const limitedProps = {
                    ...props,
                    value: '',
                    displayConfig: { characterLimit: 5 },
                    writeConfig: { characterLimit: 3 },
                    capability: {
                        type: 'editable',
                        setValue: (value) => {
                            limitedWrites.push(value);
                            return { accepted: true };
                        },
                    },
                };
                await act(async () =>
                    root.render(react.renderMultilineTextField(limitedProps))
                );
                assert.equal(input().maxLength, 3);
                await edit('A\n😀Z');
                assert.deepEqual(limitedWrites, ['A\n']);
                await act(async () =>
                    root.render(
                        react.renderMultilineTextField({
                            ...limitedProps,
                            value: 'A\n',
                        })
                    )
                );
                await compose('compositionstart');
                await edit('あ\nい');
                assert.equal(limitedWrites.length, 1);
                await act(async () =>
                    root.render(
                        react.renderMultilineTextField({
                            ...limitedProps,
                            value: 'A\n',
                            pending: true,
                        })
                    )
                );
                await compose('compositionend');
                assert.equal(limitedWrites.length, 1);
                checks++;

                await act(async () =>
                    root.render(h(react.MultilineTextField, { binding }))
                );
                await edit('Current owner\n');
                const held = host.getSnapshot().fields[0];
                await act(async () =>
                    root.render(react.renderMultilineTextField(held))
                );
                revision++;
                await edit('Stale owner\n');
                await act(async () => clear().click());
                assert.equal(binding.getSnapshot().value, 'Current owner\n');
                assert.equal(input().value, 'Current owner\n');
                checks++;

                await act(async () =>
                    root.render(h(react.MultilineTextField, { binding }))
                );
                await compose('compositionstart');
                await edit('Uncommitted composition\n');
                let replacement;
                await act(async () => {
                    replacement = fields.field('replacement');
                });
                await act(async () =>
                    root.render(
                        h(react.MultilineTextField, { binding: replacement })
                    )
                );
                await compose('compositionend');
                assert.equal(input().value, 'Replacement owner\n');
                assert.equal(
                    replacement.getSnapshot().value,
                    'Replacement owner\n'
                );
                assert.equal(binding.getSnapshot().value, 'Current owner\n');
                checks++;

                await act(async () => root.render(tree()));
                assert.equal(input(), null);
                const beforeUnmount = writes;
                await act(async () => root.render(null));
                assert.equal(binding.getSnapshot().value, 'Current owner\n');
                assert.equal(writes, beforeUnmount);
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
