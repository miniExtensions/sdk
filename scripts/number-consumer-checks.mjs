import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Installed ESM/CJS public APIs and real scalar owners; synthetic data only. */
export async function checkNumberConsumer({
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
            assert.equal(typeof react.renderNumberField, 'function');
            assert.equal(typeof react.NumberField, 'function');
            assert.equal(ui.renderNumberField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['number', 'duration'];
            for (const [kind, value, options] of [
                ['number', 12.5, { precision: 2 }],
                ['duration', 60, { durationFormat: 'h:mm:ss' }],
            ]) {
                loaded.payload.formRecord.data[kind] = value;
                loaded.payload.fieldIdsToSchemas[kind] = {
                    fieldType: kind,
                    airtableField: {
                        id: kind,
                        name: kind === 'number' ? 'Quantity' : 'Time',
                        description: null,
                        isPrimaryField: false,
                        isComputed: false,
                        config: { type: kind, options },
                    },
                    miniExtConfig: {},
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
                getScope: () => ({ ownerId: 'number-consumer', revision: 0 }),
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
                fieldId: 'number',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const binding = fields.field('number');
                const duration = fields.field('duration');
                const scalar = binding.scalar;
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
                                renderNumberField: react.renderNumberField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().value, '12.5');
                assert.equal(input().type, 'text');
                assert.equal(input().inputMode, 'decimal');
                await edit('1e');
                assert.equal(input().value, '1e');
                assert.equal(binding.getSnapshot().value, 12.5);
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                await act(async () => {
                    await assert.rejects(() => fields.save());
                });
                const ticket = scalar.getState().revision;
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, '1e');
                assert.equal(binding.scalar, scalar);
                assert.equal(scalar.getState().revision, ticket);
                await edit('-2.75');
                assert.equal(binding.getSnapshot().value, -2.75);
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                await edit('0');
                assert.equal(binding.getSnapshot().value, 0);
                checks++;

                const props = host.getSnapshot().fields[0];
                await act(async () =>
                    root.render(react.renderNumberField(props))
                );
                revision++;
                await edit('99');
                assert.equal(binding.getSnapshot().value, 0);
                assert.equal(input().value, '0');
                checks++;

                await act(async () =>
                    root.render(
                        react.renderNumberField({
                            ...props,
                            value: 8,
                            error: '',
                            displayConfig: { showTitle: false },
                            capability: {
                                type: 'editable',
                                setValue: () => {
                                    throw Error(
                                        'Missing scalar must stay inert'
                                    );
                                },
                            },
                        })
                    )
                );
                assert.equal(input().disabled, true);
                assert.equal(input().value, '8');
                assert.equal(input().getAttribute('aria-label'), 'Quantity');
                assert.equal(
                    container.querySelector('[role=status]').textContent,
                    ''
                );
                await act(async () =>
                    root.render(
                        h(react.NumberField, { binding, className: 'consumer' })
                    )
                );
                assert.ok(
                    container.querySelector('.mx-sdk-number-field.consumer')
                );
                await edit('1.234567');
                assert.equal(binding.getSnapshot().value, 1.234567);
                await act(async () =>
                    root.render(
                        h(react.NumberField, {
                            binding,
                            render: ({ snapshot }) =>
                                h('output', null, snapshot.scalar.input),
                        })
                    )
                );
                assert.equal(container.querySelector('input'), null);
                assert.equal(
                    container.querySelector('output').textContent,
                    '1.234567'
                );
                checks++;

                await act(async () =>
                    root.render(h(react.DurationField, { binding: duration }))
                );
                assert.equal(input().inputMode, 'text');
                assert.equal(input().placeholder, 'h:mm:ss');
                assert.equal(
                    container.querySelector('.mx-sdk-number-field'),
                    null
                );
                await edit('1:02:03');
                assert.equal(duration.getSnapshot().value, 3723);
                await edit('1:');
                assert.equal(input().value, '1:');
                assert.equal(duration.getSnapshot().value, 3723);
                await act(async () => root.render(null));
                await act(async () =>
                    root.render(h(react.DurationField, { binding: duration }))
                );
                assert.equal(input().value, '1:');
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
