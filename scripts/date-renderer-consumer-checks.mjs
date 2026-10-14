import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const dateRendererReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    DateField, DateTimeField, renderDateField,
    type DateFieldProps, type DateFieldOptions, type FieldProps,
} from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/date.css';

const options: DateFieldOptions = { className: 'date-consumer', clearLabel: 'Clear date' };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderDateField: (props) => renderDateField(props, options),
};
export function BoundDate(props: DateFieldProps) {
    return <DateField {...props} {...options} />;
}
export function ExistingOverrides(props: FieldProps) {
    return <><DateField {...props} /><DateTimeField {...props} /></>;
}
export function checkDateKinds(date: FieldRendererProps<'date'>, dateTime: FieldRendererProps<'dateTime'>) {
    renderDateField(date);
    // @ts-expect-error The calendar renderer must not accept a dateTime slot.
    renderDateField(dateTime);
}
`;

/** Installed ESM/CJS renderer APIs and CSS; all owners and drafts are synthetic. */
export async function checkDateRendererConsumer({
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
        const css = require.resolve('@miniextensions/sdk/react/date.css');
        assert.match(readFileSync(css, 'utf8'), /\.mx-sdk-date:focus-visible/);
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
            assert.equal(typeof react.renderDateField, 'function');
            assert.equal(typeof react.DateField, 'function');
            assert.equal(typeof react.DateTimeField, 'function');
            assert.equal(ui.renderDateField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['date', 'time'];
            loaded.payload.formRecord.data.date = '2011-12-30';
            loaded.payload.formRecord.data.time =
                '2024-11-03T01:30:00.120-07:00';
            for (const [id, kind] of [
                ['date', 'date'],
                ['time', 'dateTime'],
            ])
                loaded.payload.fieldIdsToSchemas[id] = {
                    fieldType: kind,
                    airtableField: {
                        id,
                        name: id === 'date' ? 'Due date' : 'Timestamp',
                        description: null,
                        isPrimaryField: false,
                        isComputed: false,
                        config: {
                            type: kind,
                            options: {
                                dateFormat: {
                                    name: 'iso',
                                    format: 'YYYY-MM-DD',
                                },
                                ...(kind === 'dateTime'
                                    ? {
                                          timeFormat: {
                                              name: '24hour',
                                              format: 'HH:mm',
                                          },
                                          timeZone: 'UTC',
                                      }
                                    : {}),
                            },
                        },
                    },
                    miniExtConfig: {},
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
                getScope: () => ({ ownerId: 'date-consumer', revision: 0 }),
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
                fieldId: 'date',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const clear = () => container.querySelector('button');
                const binding = fields.field('date');
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
                                renderDateField: react.renderDateField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                assert.equal(input().value, '2011-12-30');
                assert.equal(input().type, 'text');
                assert.equal(input().placeholder, 'YYYY-MM-DD');
                assert.equal(binding.getSnapshot().dirty, false);
                await edit('2024-');
                assert.equal(input().value, '2024-');
                assert.equal(binding.getSnapshot().value, '2011-12-30');
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                await assert.rejects(fields.save());
                assert.equal(saves, 0);
                checks++;

                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, '2024-');
                await edit('2024-02-30');
                assert.equal(binding.getSnapshot().value, '2011-12-30');
                assert.equal(input().value, '2024-02-30');
                await edit('2024-02-29');
                assert.equal(binding.getSnapshot().value, '2024-02-29');
                assert.equal(input().getAttribute('aria-invalid'), 'false');
                checks++;

                assert.equal(clear().type, 'button');
                await act(async () => clear().click());
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(window.document.activeElement, input());
                assert.equal(clear().disabled, true);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.DateField, {
                            binding,
                            className: 'consumer',
                            clearLabel: 'Effacer la date',
                        })
                    )
                );
                assert.ok(container.querySelector('.consumer'));
                assert.equal(
                    clear().getAttribute('aria-label'),
                    'Effacer la date'
                );
                await edit('2025-01-02');
                assert.equal(binding.getSnapshot().value, '2025-01-02');
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                await act(async () =>
                    root.render(
                        h(react.DateField, {
                            binding,
                            render: ({ snapshot }) =>
                                h(
                                    'output',
                                    null,
                                    snapshot.date.input || 'Empty date'
                                ),
                        })
                    )
                );
                assert.equal(input(), null);
                assert.equal(container.textContent, 'Empty date');
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
                        date: {
                            ...props.capability.date,
                            state: {
                                ...props.capability.date.state,
                                kind: 'dateTime',
                            },
                            setInput: () => {
                                throw Error('No mismatched model write');
                            },
                        },
                    },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderDateField({ ...props, capability })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                    await edit('2025-02-03');
                    assert.equal(binding.getSnapshot().value, null);
                }
                checks++;

                await act(async () =>
                    root.render(
                        react.renderDateField({
                            ...props,
                            pending: true,
                            displayConfig: {
                                showTitle: false,
                                placeholderText: 'Calendar date',
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
                assert.equal(input().placeholder, 'Calendar date');
                assert.equal(input().getAttribute('aria-label'), 'Due date');
                assert.equal(input().getAttribute('aria-required'), 'true');
                assert.equal(container.querySelector('label'), null);
                checks++;

                const time = fields.field('time');
                await act(async () =>
                    root.render(h(react.DateTimeField, { binding: time }))
                );
                assert.equal(input().value, '2024-11-03T01:30:00.120-07:00');
                assert.equal(input().placeholder, 'YYYY-MM-DDTHH:mm:ssZ');
                assert.equal(clear().textContent, 'Clear date');
                await edit('2024-11-03T01:30:00.120-08:00');
                assert.equal(
                    time.getSnapshot().value,
                    '2024-11-03T01:30:00.120-08:00'
                );
                checks++;

                await act(async () =>
                    root.render(react.renderDateField(props))
                );
                revision++;
                await edit('2025-03-04');
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(binding.getSnapshot().date.input, '');
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
