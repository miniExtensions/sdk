import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const durationRendererReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    DurationField, NumberField, renderDurationField, AirtableForm, AirtableGrid, AirtableList,
    type DurationFieldProps, type DurationFieldOptions, type FieldProps,
} from '@miniextensions/sdk/react';
import type {
    FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope,
} from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/duration.css';

const options: DurationFieldOptions = { className: 'duration-consumer', clearLabel: 'Clear elapsed time' };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderDurationField: (props) => renderDurationField(props, options),
};
export function BoundDuration(props: DurationFieldProps) {
    return <DurationField {...props} {...options} />;
}
export function ExistingOverrides(props: FieldProps) {
    return <><DurationField {...props} /><NumberField {...props} /></>;
}
export function checkDurationKinds(duration: FieldRendererProps<'duration'>, number: FieldRendererProps<'number'>) {
    renderDurationField(duration);
    // @ts-expect-error A duration renderer must not accept a numeric slot.
    renderDurationField(number);
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
export async function checkDurationRendererConsumer({
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
        const css = require.resolve('@miniextensions/sdk/react/duration.css');
        assert.match(
            readFileSync(css, 'utf8'),
            /\.mx-sdk-duration:focus-visible/
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
            assert.equal(typeof react.renderDurationField, 'function');
            assert.equal(typeof react.DurationField, 'function');
            assert.equal(typeof react.NumberField, 'function');
            assert.equal(ui.renderDurationField, undefined);
            for (const [format, displayedNative] of [
                ['h:mm', '1:00'],
                ['h:mm:ss', '1:00:00'],
                ['h:mm:ss.S', '1:00:00.1'],
                ['h:mm:ss.SS', '1:00:00.12'],
                ['h:mm:ss.SSS', '1:00:00.123'],
            ]) {
                const native = 3600.123456;
                const loaded = portalRecipeFixtures.makeForm({
                    childExtensionInfo: { accessType: { type: 'create' } },
                });
                loaded.payload.hasParentExtension = false;
                loaded.payload.fieldIdsInForm = ['duration', 'number'];
                loaded.payload.formRecord.data.duration = native;
                loaded.payload.formRecord.data.number = 12.25;
                for (const kind of ['duration', 'number'])
                    loaded.payload.fieldIdsToSchemas[kind] = {
                        fieldType: kind,
                        airtableField: {
                            id: kind,
                            name:
                                kind === 'duration'
                                    ? 'Elapsed time'
                                    : 'Quantity',
                            description: null,
                            isPrimaryField: false,
                            isComputed: false,
                            config: {
                                type: kind,
                                options:
                                    kind === 'duration'
                                        ? { durationFormat: format }
                                        : { precision: 2 },
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
                    getScope: () => ({
                        ownerId: 'duration-consumer',
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
                let configurationRevision = 0;
                const host = ui.createFormFieldRendererHost({
                    fields,
                    fieldId: 'duration',
                    isCurrent: () => true,
                    configurationRevision: () => configurationRevision,
                });
                const container = window.document.createElement('div');
                window.document.body.append(container);
                const root = createRoot(container);
                try {
                    const input = () => container.querySelector('input');
                    const clear = () => container.querySelector('button');
                    const binding = fields.field('duration');
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
                                    renderDurationField:
                                        react.renderDurationField,
                                },
                                fallback: () => null,
                            })
                        );
                    await act(async () => root.render(tree()));
                    assert.equal(input().value, displayedNative, format);
                    assert.equal(input().type, 'text');
                    assert.equal(input().placeholder, format);
                    assert.equal(binding.getSnapshot().dirty, false);
                    const draftRevision =
                        fields.controller.getState().draftRevision;
                    await act(async () => input().focus());
                    assert.equal(binding.getSnapshot().scalar.focused, true);
                    await act(async () => input().blur());
                    assert.equal(binding.getSnapshot().scalar.focused, false);
                    assert.equal(binding.getSnapshot().value, native);
                    assert.equal(
                        fields.controller.getState().draftRevision,
                        draftRevision
                    );
                    assert.equal(binding.getSnapshot().dirty, false);
                    assert.equal(input().value, displayedNative);
                    assert.equal(saves, 0);
                    checks++;

                    await act(async () => input().focus());
                    await edit('1.5');
                    assert.equal(
                        binding.getSnapshot().value,
                        format === 'h:mm' ? 90 : 1.5
                    );
                    await edit('01:02');
                    assert.equal(
                        binding.getSnapshot().value,
                        format === 'h:mm' ? 3720 : 62
                    );
                    assert.equal(input().value, '01:02');
                    await edit('01:02:03.500');
                    assert.equal(binding.getSnapshot().value, 3723.5);
                    assert.equal(input().value, '01:02:03.500');
                    const committedRevision =
                        fields.controller.getState().draftRevision;
                    await act(async () => input().blur());
                    assert.notEqual(input().value, '01:02:03.500');
                    assert.equal(binding.getSnapshot().value, 3723.5);
                    assert.equal(
                        fields.controller.getState().draftRevision,
                        committedRevision
                    );
                    checks++;

                    await act(async () => input().focus());
                    await edit('1:');
                    assert.equal(input().value, '1:');
                    assert.equal(binding.getSnapshot().value, 3723.5);
                    assert.equal(input().getAttribute('aria-invalid'), 'true');
                    await assert.rejects(fields.save());
                    assert.equal(saves, 0);
                    await act(async () => root.render(null));
                    await act(async () => root.render(tree()));
                    assert.equal(input().value, '1:');
                    assert.equal(binding.getSnapshot().scalar.focused, true);
                    assert.equal(binding.getSnapshot().value, 3723.5);
                    checks++;

                    await act(async () =>
                        root.render(
                            h(react.DurationField, {
                                binding,
                                className: 'consumer',
                                clearLabel: 'Effacer la durée',
                            })
                        )
                    );
                    assert.ok(container.querySelector('.consumer'));
                    assert.equal(
                        clear().getAttribute('aria-label'),
                        'Effacer la durée'
                    );
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
                    await act(async () =>
                        root.render(
                            h(react.DurationField, {
                                binding,
                                render: ({ snapshot }) =>
                                    h(
                                        'output',
                                        null,
                                        snapshot.scalar.input ||
                                            'Empty duration'
                                    ),
                            })
                        )
                    );
                    assert.equal(input(), null);
                    assert.equal(container.textContent, 'Empty duration');
                    checks++;

                    const props = host.getSnapshot().fields[0];
                    for (const capability of [
                        { type: 'readonly' },
                        {
                            type: 'editable',
                            setValue: () => {
                                throw Error('No value fallback');
                            },
                        },
                        {
                            ...props.capability,
                            scalar: {
                                ...props.capability.scalar,
                                state: {
                                    ...props.capability.scalar.state,
                                    kind: 'number',
                                },
                            },
                        },
                        {
                            ...props.capability,
                            scalar: {
                                ...props.capability.scalar,
                                setFocused: undefined,
                            },
                        },
                    ]) {
                        await act(async () =>
                            root.render(
                                react.renderDurationField({
                                    ...props,
                                    value: native,
                                    capability,
                                })
                            )
                        );
                        assert.equal(input().disabled, true);
                        assert.equal(clear().disabled, true);
                        assert.equal(input().value, displayedNative, format);
                        await edit('5');
                        assert.equal(binding.getSnapshot().value, null);
                    }
                    checks++;

                    await act(async () =>
                        root.render(
                            react.renderDurationField({
                                ...props,
                                value: native,
                                capability: { type: 'readonly' },
                                displayConfig: {
                                    showTitle: false,
                                    placeholderText: 'Clock duration',
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
                    assert.equal(input().placeholder, 'Clock duration');
                    assert.equal(
                        input().getAttribute('aria-label'),
                        'Elapsed time'
                    );
                    assert.equal(input().getAttribute('aria-required'), 'true');
                    assert.equal(container.querySelector('label'), null);
                    assert.equal(
                        container.textContent.includes(displayedNative),
                        false
                    );
                    for (const restriction of [
                        { pending: true },
                        { computed: true },
                        { displayConfig: { readOnly: true } },
                        { writeConfig: { readOnly: true } },
                    ]) {
                        await act(async () =>
                            root.render(
                                react.renderDurationField({
                                    ...props,
                                    ...restriction,
                                })
                            )
                        );
                        assert.equal(input().disabled, true);
                        assert.equal(clear().disabled, true);
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
                        root.render(
                            h(react.NumberField, {
                                binding,
                                render: () =>
                                    h(
                                        'output',
                                        null,
                                        'Custom duration through NumberField'
                                    ),
                            })
                        )
                    );
                    assert.equal(
                        container.textContent,
                        'Custom duration through NumberField'
                    );
                    checks++;

                    await act(async () => binding.setValue(native));
                    const heldProps = host.getSnapshot().fields[0];
                    await act(async () =>
                        root.render(react.renderDurationField(heldProps))
                    );
                    // Accepted configuration replacement advances the host revision.
                    configurationRevision++;
                    const beforeStale =
                        fields.controller.getState().draftRevision;
                    await act(async () => input().focus());
                    await edit('9:59');
                    await act(async () => clear().click());
                    await act(async () => input().blur());
                    assert.equal(binding.getSnapshot().value, native);
                    assert.equal(
                        fields.controller.getState().draftRevision,
                        beforeStale
                    );
                    assert.equal(host.getSnapshot().status, 'retired');
                    assert.equal(saves, 0);
                    // A custom accepted bridge also refuses retained actions when
                    // its own format changes, without writing or rounding seconds.
                    let modelFormat = format;
                    let modelNative = native;
                    const model = ui.createDurationFieldModel({
                        getValue: () => modelNative,
                        getDurationFormat: () => modelFormat,
                        canEdit: () => true,
                        isCurrent: () => true,
                        write: (value) => {
                            modelNative = value;
                            return true;
                        },
                    });
                    try {
                        await act(async () =>
                            root.render(
                                react.renderDurationField({
                                    ...heldProps,
                                    capability: {
                                        type: 'editable',
                                        setValue: () => {
                                            throw Error(
                                                'No direct write fallback'
                                            );
                                        },
                                        scalar: {
                                            state: model.getState(),
                                            setInput: model.setInput,
                                            setChecked: model.setChecked,
                                            setFocused: model.setFocused,
                                        },
                                    },
                                })
                            )
                        );
                        modelFormat =
                            format === 'h:mm' ? 'h:mm:ss.SSS' : 'h:mm';
                        await act(async () => input().focus());
                        await edit('9:59');
                        await act(async () => clear().click());
                        await act(async () => input().blur());
                        assert.equal(modelNative, native);
                        assert.equal(model.getState().retired, true);
                    } finally {
                        model.destroy();
                    }
                    checks++;
                } finally {
                    await act(async () => root.unmount());
                    host.dispose();
                    fields.destroy();
                    container.remove();
                }
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
