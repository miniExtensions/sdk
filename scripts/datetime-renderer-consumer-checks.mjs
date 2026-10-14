import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const dateTimeRendererReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    DateField, DateTimeField, renderDateTimeField,
    type DateTimeFieldProps, type DateTimeFieldOptions, type FieldProps,
} from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/datetime.css';

const options: DateTimeFieldOptions = { className: 'datetime-consumer', clearLabel: 'Clear timestamp' };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderDateTimeField: (props) => renderDateTimeField(props, options),
};
export function BoundDateTime(props: DateTimeFieldProps) {
    return <DateTimeField {...props} {...options} />;
}
export function ExistingOverrides(props: FieldProps) {
    return <><DateField {...props} /><DateTimeField {...props} /></>;
}
export function checkDateKinds(date: FieldRendererProps<'date'>, dateTime: FieldRendererProps<'dateTime'>) {
    renderDateTimeField(dateTime);
    // @ts-expect-error The timestamp renderer must not accept a calendar-date slot.
    renderDateTimeField(date);
}
`;

/** Installed ESM/CJS renderer APIs and CSS; all owners and drafts are synthetic. */
export async function checkDateTimeRendererConsumer({
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
        const css = require.resolve('@miniextensions/sdk/react/datetime.css');
        assert.match(
            readFileSync(css, 'utf8'),
            /\.mx-sdk-datetime:focus-visible/
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
            assert.equal(typeof react.renderDateTimeField, 'function');
            assert.equal(typeof react.DateField, 'function');
            assert.equal(typeof react.DateTimeField, 'function');
            assert.equal(react.DateTimeField, react.DateField);
            assert.equal(ui.renderDateTimeField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['date', 'time', 'zoned'];
            loaded.payload.formRecord.data.date = '2011-12-30';
            loaded.payload.formRecord.data.time =
                '2024-11-03T01:30:00.120-07:00';
            loaded.payload.formRecord.data.zoned = '2024-07-01T12:00:00Z';
            for (const [id, kind] of [
                ['date', 'date'],
                ['time', 'dateTime'],
                ['zoned', 'dateTime'],
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
                                          timeZone:
                                              id === 'zoned' ? 'client' : 'UTC',
                                      }
                                    : {}),
                            },
                        },
                    },
                    miniExtConfig: {},
                };
            let saves = 0;
            let zone = 'America/Los_Angeles';
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
                getScope: () => ({ ownerId: 'datetime-consumer', revision: 0 }),
                getClientTimeZone: () => zone,
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
                fieldId: 'time',
                isCurrent: () => true,
                configurationRevision: () => revision,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            try {
                const input = () => container.querySelector('input');
                const clear = () => container.querySelector('button');
                const binding = fields.field('time');
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
                                renderDateTimeField: react.renderDateTimeField,
                            },
                            fallback: () => null,
                        })
                    );
                await act(async () => root.render(tree()));
                const loadedNative = '2024-11-03T01:30:00.120-07:00';
                assert.equal(input().value, loadedNative);
                assert.equal(input().type, 'text');
                assert.equal(input().placeholder, 'YYYY-MM-DDTHH:mm:ssZ');
                assert.equal(binding.getSnapshot().dirty, false);
                await edit('2024-11-');
                assert.equal(input().value, '2024-11-');
                assert.equal(binding.getSnapshot().value, loadedNative);
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                await assert.rejects(fields.save());
                assert.equal(saves, 0);
                checks++;

                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(input().value, '2024-11-');
                for (const invalid of [
                    '2024-11-03T01:30:00.120',
                    '2024-02-30T12:00:00Z',
                ]) {
                    await edit(invalid);
                    assert.equal(binding.getSnapshot().value, loadedNative);
                    assert.equal(input().value, invalid);
                    assert.equal(input().getAttribute('aria-invalid'), 'true');
                }
                for (const native of [
                    '2024-11-03T01:30:00.120-08:00',
                    '2025-01-02T03:04:05.1+05:45',
                    '2025-01-02T03:04:05.12+05:45',
                    '2025-01-02T03:04:05.120Z',
                ]) {
                    await edit(native);
                    assert.equal(binding.getSnapshot().value, native);
                    assert.equal(input().value, native);
                    assert.equal(input().getAttribute('aria-invalid'), 'false');
                }
                checks++;

                assert.equal(clear().type, 'button');
                await act(async () => clear().click());
                assert.equal(binding.getSnapshot().value, null);
                assert.equal(window.document.activeElement, input());
                assert.equal(clear().disabled, true);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.DateTimeField, {
                            binding,
                            className: 'consumer',
                            clearLabel: 'Effacer la date et heure',
                        })
                    )
                );
                assert.ok(container.querySelector('.consumer'));
                assert.equal(
                    clear().getAttribute('aria-label'),
                    'Effacer la date et heure'
                );
                await edit('2025-01-02T03:04:05Z');
                assert.equal(
                    binding.getSnapshot().value,
                    '2025-01-02T03:04:05Z'
                );
                await edit('');
                assert.equal(binding.getSnapshot().value, null);
                await act(async () =>
                    root.render(
                        h(react.DateTimeField, {
                            binding,
                            render: ({ snapshot }) =>
                                h(
                                    'output',
                                    null,
                                    snapshot.date.input || 'Empty timestamp'
                                ),
                        })
                    )
                );
                assert.equal(input(), null);
                assert.equal(container.textContent, 'Empty timestamp');
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
                                kind: 'date',
                            },
                            setInput: () => {
                                throw Error('No mismatched model write');
                            },
                        },
                    },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderDateTimeField({ ...props, capability })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                    await edit('2025-02-03T12:00:00Z');
                    assert.equal(binding.getSnapshot().value, null);
                }
                checks++;

                await act(async () =>
                    root.render(
                        react.renderDateTimeField({
                            ...props,
                            value: loadedNative,
                            capability: { type: 'readonly' },
                            displayConfig: {
                                showTitle: false,
                                placeholderText: 'Timestamp with offset',
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
                assert.equal(input().placeholder, 'Timestamp with offset');
                assert.equal(input().getAttribute('aria-label'), 'Timestamp');
                assert.equal(input().getAttribute('aria-required'), 'true');
                assert.equal(container.querySelector('label'), null);
                assert.equal(input().value, loadedNative);
                assert.equal(
                    container.textContent.includes(loadedNative),
                    false
                );
                for (const restricted of [
                    { pending: true },
                    { computed: true },
                    { writeConfig: { readOnly: true } },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderDateTimeField({
                                ...props,
                                ...restricted,
                            })
                        )
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                }
                checks++;

                const date = fields.field('date');
                await act(async () =>
                    root.render(h(react.DateField, { binding: date }))
                );
                assert.equal(input().value, '2011-12-30');
                assert.equal(input().placeholder, 'YYYY-MM-DD');
                assert.equal(
                    clear().getAttribute('aria-label'),
                    'Clear Due date'
                );
                assert.equal(clear().type, 'button');
                assert.equal(clear().getAttribute('aria-controls'), input().id);
                await edit('2024-02-29');
                assert.equal(date.getSnapshot().value, '2024-02-29');
                checks++;

                const accepted = '2025-03-01T12:00:00.120+05:45';
                await act(async () => binding.date.setInput(accepted));
                const heldProps = host.getSnapshot().fields[0];
                await act(async () =>
                    root.render(react.renderDateTimeField(heldProps))
                );
                revision++;
                await edit('2025-03-04T12:00:00Z');
                await act(async () => clear().click());
                assert.equal(binding.getSnapshot().value, accepted);
                assert.equal(binding.getSnapshot().date.input, accepted);
                assert.equal(saves, 0);
                checks++;

                const zoned = fields.field('zoned');
                await act(async () =>
                    root.render(h(react.DateTimeField, { binding: zoned }))
                );
                assert.equal(input().value, '2024-07-01T12:00:00Z');
                zone = 'Asia/Kathmandu';
                await act(async () =>
                    root.render(h(react.DateTimeField, { binding: zoned }))
                );
                assert.equal(input(), null);
                assert.equal(
                    container.querySelector('[role="status"]').textContent,
                    'Load a fresh Form before editing this date.'
                );
                assert.equal(zoned.getSnapshot().date.retired, true);
                assert.equal(zoned.getSnapshot().value, '2024-07-01T12:00:00Z');
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
