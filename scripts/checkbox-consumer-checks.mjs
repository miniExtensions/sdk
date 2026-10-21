import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Exercise the installed ESM/CJS public APIs, never checkout aliases. */
export async function checkCheckboxConsumer({
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
        const css = require.resolve('@miniextensions/sdk/react/checkbox.css');
        assert.match(
            readFileSync(css, 'utf8'),
            /\.mx-sdk-checkbox:focus-visible/
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
            assert.equal(typeof react.renderCheckboxField, 'function');
            assert.equal(typeof react.CheckboxField, 'function');
            assert.equal(typeof react.CheckboxInput, 'function');
            assert.equal(ui.renderCheckboxField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['check'];
            loaded.payload.formRecord.data.check = null;
            loaded.payload.fieldIdsToSchemas.check = {
                fieldType: 'checkbox',
                airtableField: {
                    id: 'check',
                    name: 'Approved',
                    description: null,
                    isPrimaryField: false,
                    isComputed: false,
                    config: {
                        type: 'checkbox',
                        options: { icon: 'check', color: 'greenBright' },
                    },
                },
                miniExtConfig: {},
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
                getScope: () => ({ ownerId: 'checkbox-consumer', revision: 0 }),
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
                fieldId: 'check',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const binding = fields.field('check');
                const tree = () =>
                    h(
                        StrictMode,
                        null,
                        h(react.FieldRenderer, {
                            host,
                            renderers: {
                                renderCheckboxField: react.renderCheckboxField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().checked, false);
                assert.equal(binding.getSnapshot().value, null);
                await act(async () => input().click());
                assert.equal(binding.getSnapshot().value, true);
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().checked, true);
                await act(async () => input().click());
                assert.equal(binding.getSnapshot().value, false);
                checks++;
                const props = host.getSnapshot().fields[0];
                await act(async () =>
                    root.render(react.renderCheckboxField(props))
                );
                revision++;
                await act(async () => input().click());
                assert.equal(binding.getSnapshot().value, false);
                assert.equal(input().checked, false);
                await act(async () =>
                    root.render(
                        react.renderCheckboxField({
                            ...props,
                            capability: { type: 'readonly' },
                        })
                    )
                );
                assert.equal(input().disabled, true);
                await act(async () =>
                    root.render(
                        react.renderCheckboxField({
                            ...props,
                            writeConfig: { enableCalendlyIntegration: true },
                        })
                    )
                );
                assert.equal(input().disabled, true);
                checks++;
                await act(async () =>
                    root.render(
                        h(react.CheckboxField, {
                            binding,
                            className: 'consumer',
                        })
                    )
                );
                assert.ok(container.querySelector('.consumer'));
                await act(async () => input().click());
                assert.equal(binding.getSnapshot().value, true);
                checks++;

                const changes = [];
                let rowClicks = 0;
                const native = (checked) =>
                    h(
                        'div',
                        {
                            onClick: (event) => {
                                if (event.target === input()) rowClicks++;
                            },
                        },
                        h('label', { htmlFor: 'consumer-check' }, 'Consent'),
                        h('form', { id: 'consumer-form' }),
                        h('p', { id: 'consumer-help' }, 'Host help'),
                        h(react.CheckboxInput, {
                            checked,
                            id: 'consumer-check',
                            form: 'consumer-form',
                            'aria-describedby': 'consumer-help',
                            onChange: (event) => {
                                assert.equal(event.currentTarget, input());
                                changes.push(event.currentTarget.checked);
                            },
                        })
                    );
                await act(async () => root.render(native(false)));
                assert.equal(input().type, 'checkbox');
                assert.equal(input().form?.id, 'consumer-form');
                assert.equal(
                    input().getAttribute('aria-describedby'),
                    'consumer-help'
                );
                await act(async () => container.querySelector('label').click());
                assert.deepEqual(changes, [true]);
                assert.equal(rowClicks, 1);
                assert.equal(input().checked, false);
                await act(async () => root.render(native(true)));
                assert.equal(input().checked, true);
                await act(async () => input().click());
                assert.deepEqual(changes, [true, false]);
                assert.equal(rowClicks, 2);
                await act(async () => root.render(native(false)));
                assert.equal(input().checked, false);
                assert.equal(binding.getSnapshot().value, true);
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
