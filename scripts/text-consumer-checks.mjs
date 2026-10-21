import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Exercise the installed ESM/CJS public APIs, never checkout aliases. */
export async function checkTextConsumer({
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
        const css = require.resolve('@miniextensions/sdk/react/text.css');
        assert.match(readFileSync(css, 'utf8'), /\.mx-sdk-text:focus-visible/);
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
            assert.equal(typeof react.renderSingleLineTextField, 'function');
            assert.equal(typeof react.TextField, 'function');
            assert.equal(ui.renderSingleLineTextField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['text'];
            loaded.payload.formRecord.data.text = null;
            loaded.payload.fieldIdsToSchemas.text = {
                fieldType: 'singleLineText',
                airtableField: {
                    id: 'text',
                    name: 'Project',
                    description: null,
                    isPrimaryField: false,
                    isComputed: false,
                    config: { type: 'singleLineText', options: null },
                },
                miniExtConfig: {
                    characterLimit: 6,
                    placeholderText: 'Type here',
                },
            };
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: {
                        save: async () => {
                            throw Error('No implicit Save');
                        },
                    },
                },
                getScope: () => ({ ownerId: 'text-consumer', revision: 0 }),
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
                fieldId: 'text',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const binding = fields.field('text');
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
                                renderSingleLineTextField:
                                    react.renderSingleLineTextField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().value, '');
                assert.equal(input().placeholder, 'Type here');
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(writes, 0);
                await edit('  Ab  ');
                assert.equal(binding.getSnapshot().value, '  Ab  ');
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, '  Ab  ');
                assert.equal(writes, 1);
                await act(async () =>
                    container.querySelector('button').click()
                );
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(window.document.activeElement, input());
                assert.equal(writes, 2);
                checks++;

                await compose('compositionstart');
                await edit('にほんご');
                assert.equal(binding.getSnapshot().value, null);
                await compose('compositionend');
                assert.equal(binding.getSnapshot().value, 'にほんご');
                assert.equal(writes, 3);
                await edit('にほんご');
                assert.equal(writes, 3);
                checks++;

                const props = host.getSnapshot().fields[0];
                await act(async () =>
                    root.render(react.renderSingleLineTextField(props))
                );
                revision++;
                await edit('stale');
                assert.equal(binding.getSnapshot().value, 'にほんご');
                assert.equal(input().value, 'にほんご');
                await act(async () =>
                    container.querySelector('button').click()
                );
                assert.equal(binding.getSnapshot().value, 'にほんご');
                await act(async () =>
                    root.render(
                        react.renderSingleLineTextField({
                            ...props,
                            capability: { type: 'readonly' },
                            writeConfig: { obscurePassword: true },
                        })
                    )
                );
                assert.equal(input().disabled, true);
                assert.equal(input().type, 'password');
                checks++;

                await act(async () =>
                    root.render(
                        h(react.TextField, {
                            binding,
                            className: 'consumer',
                            clearLabel: 'Effacer',
                        })
                    )
                );
                assert.ok(container.querySelector('.consumer'));
                assert.equal(
                    container
                        .querySelector('button')
                        .getAttribute('aria-label'),
                    'Effacer'
                );
                await edit('123456789');
                assert.equal(binding.getSnapshot().value, '123456');
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
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
