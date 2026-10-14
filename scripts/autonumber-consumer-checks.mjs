import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const autoNumberReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    AutoNumberField, renderAutoNumberField, AirtableForm, AirtableGrid, AirtableList,
    type AutoNumberFieldProps, type AutoNumberFieldOptions,
} from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/number.css';

const options: AutoNumberFieldOptions = { className: 'autonumber-consumer' };
// @ts-expect-error AutoNumber has no Clear control.
const unsupportedClear: AutoNumberFieldOptions = { clearLabel: 'Clear ID' };
// @ts-expect-error The owner supplies the value; options do not grant write authority.
const unsupportedSetter: AutoNumberFieldOptions = { setValue: (value: number) => {} };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderAutoNumberField: props => renderAutoNumberField(props, options),
};
export function BoundAutoNumber(props: AutoNumberFieldProps) {
    return <AutoNumberField {...props} {...options} />;
}
export function AutoNumberOverride(props: AutoNumberFieldProps) {
    return <AutoNumberField {...props} render={({ snapshot }) => <span>{String(snapshot.value ?? '')}</span>} />;
}
export function checkAutoNumberKinds(autoNumber: FieldRendererProps<'autoNumber'>, number: FieldRendererProps<'number'>, rating: FieldRendererProps<'rating'>) {
    renderAutoNumberField(autoNumber);
    const readonlyCapability: { type: 'readonly' } = autoNumber.capability;
    // @ts-expect-error Number is not an AutoNumber slot.
    renderAutoNumberField(number);
    // @ts-expect-error Rating is not an AutoNumber slot.
    renderAutoNumberField(rating);
    // @ts-expect-error AutoNumber slots cannot expose an editable capability.
    const editable: FieldRendererProps<'autoNumber'>['capability'] = { type: 'editable', setValue: () => ({ accepted: true }) };
    return readonlyCapability;
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed read-only presentation with real synthetic Form owners and no transport. */
export async function checkAutoNumberConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let requests = 0;
    window.fetch = () => {
        requests++;
        throw Error('No AutoNumber requests');
    };
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
    const { createElement: h, act, StrictMode, Fragment } = require('react');
    const { createRoot } = require('react-dom/client');
    let checks = 0;
    try {
        assert.match(
            readFileSync(
                require.resolve('@miniextensions/sdk/react/number.css'),
                'utf8'
            ),
            /\.mx-sdk-number:focus-visible/
        );
        assert.throws(
            () => require.resolve('@miniextensions/sdk/react/autonumber.css'),
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
            assert.equal(typeof react.AutoNumberField, 'function');
            assert.equal(typeof react.renderAutoNumberField, 'function');
            assert.equal(ui.renderAutoNumberField, undefined);
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = [
                'autoNumber',
                'empty',
                'missing',
                'replacement',
                'number',
            ];
            for (const [id, value] of [
                ['autoNumber', 42.125],
                ['empty', null],
                ['missing', undefined],
                ['replacement', -9.25],
                ['number', 17],
            ]) {
                const kind = id === 'number' ? 'number' : 'autoNumber';
                if (value === undefined)
                    delete loaded.payload.formRecord.data[id];
                else loaded.payload.formRecord.data[id] = value;
                loaded.payload.fieldIdsToSchemas[id] = {
                    fieldType: kind,
                    airtableField: {
                        id,
                        name: 'Sequence',
                        description: null,
                        isPrimaryField: false,
                        isComputed: kind === 'autoNumber',
                        config: {
                            type: kind,
                            options:
                                kind === 'number' ? { precision: 2 } : null,
                        },
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
                            throw Error('No AutoNumber Save');
                        },
                    },
                },
                getScope: () => ({
                    ownerId: 'autonumber-consumer',
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
            let current = true;
            const host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'autoNumber',
                isCurrent: () => current,
                configurationRevision: () => 0,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            let destroyed = false;
            try {
                const binding = fields.field('autoNumber');
                let writes = 0;
                binding.setValue = () => {
                    writes++;
                    throw Error(
                        'Read-only binding setter must not be borrowed'
                    );
                };
                const input = () => container.querySelector('input');
                const edit = async (value, node = input()) =>
                    act(async () => {
                        Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype,
                            'value'
                        ).set.call(node, value);
                        node.dispatchEvent(
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
                                renderAutoNumberField:
                                    react.renderAutoNumberField,
                            },
                            fallback: () => null,
                        })
                    );
                const before = fields.controller.getState().draftRevision;
                await act(async () => root.render(tree()));
                assert.equal(input().value, '42.125');
                assert.equal(input().disabled, true);
                assert.equal(binding.scalar, null);
                assert.deepEqual(host.getSnapshot().fields[0].capability, {
                    type: 'readonly',
                });
                await edit('100');
                assert.equal(input().value, '42.125');
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.equal(binding.getSnapshot().value, 42.125);
                assert.equal(
                    fields.controller.getState().draftRevision,
                    before
                );
                assert.equal(writes, 0);
                checks++;

                const props = host.getSnapshot().fields[0];
                for (const value of [
                    0,
                    -0,
                    -3.75,
                    1e21,
                    1e-7,
                    1234.56789,
                    null,
                    undefined,
                    NaN,
                    Infinity,
                    -Infinity,
                    '12',
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderAutoNumberField({ ...props, value })
                        )
                    );
                    assert.equal(
                        input().value,
                        typeof value === 'number' && Number.isFinite(value)
                            ? String(value)
                            : ''
                    );
                    assert.equal(input().disabled, true);
                    assert.equal(
                        container.querySelector(
                            'button,progress,[role=slider],input[type=number]'
                        ),
                        null
                    );
                    assert.equal(binding.getSnapshot().value, 42.125);
                }
                for (const [id, native] of [
                    ['empty', null],
                    ['missing', undefined],
                ]) {
                    let empty;
                    await act(async () => {
                        empty = fields.field(id);
                    });
                    await act(async () =>
                        root.render(
                            h(react.AutoNumberField, { binding: empty })
                        )
                    );
                    assert.equal(input().value, '');
                    await act(async () => root.render(null));
                    await act(async () =>
                        root.render(
                            h(react.AutoNumberField, { binding: empty })
                        )
                    );
                    assert.equal(empty.getSnapshot().value, native);
                    assert.equal(input().value, '');
                }
                checks++;

                let capabilityReads = 0;
                let capabilityActions = 0;
                const forged = {
                    type: 'editable',
                    setValue: () => {
                        capabilityActions++;
                        throw Error('No raw write');
                    },
                };
                Object.defineProperty(forged, 'scalar', {
                    get() {
                        capabilityReads++;
                        throw Error('No scalar authority');
                    },
                });
                await act(async () =>
                    root.render(
                        react.renderAutoNumberField({
                            ...props,
                            value: 7.125,
                            computed: false,
                            capability: forged,
                        })
                    )
                );
                await edit('8');
                await act(async () => {
                    input().dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                    input().dispatchEvent(
                        new window.CompositionEvent('compositionstart', {
                            bubbles: true,
                        })
                    );
                    input().dispatchEvent(
                        new window.CompositionEvent('compositionend', {
                            bubbles: true,
                        })
                    );
                    input().dispatchEvent(
                        new window.KeyboardEvent('keydown', {
                            key: 'ArrowUp',
                            bubbles: true,
                        })
                    );
                    input().dispatchEvent(
                        new window.Event('blur', { bubbles: true })
                    );
                });
                assert.equal(input().value, '7.125');
                assert.equal(input().disabled, true);
                assert.equal(capabilityReads, 0);
                assert.equal(capabilityActions, 0);
                assert.equal(writes, 0);
                checks++;

                for (const side of ['displayConfig', 'writeConfig']) {
                    await act(async () =>
                        root.render(
                            react.renderAutoNumberField({
                                ...props,
                                displayConfig: { showTitle: false },
                                [side]: {
                                    showTitle: false,
                                    maskPasswordOnLoginScreen: true,
                                },
                                error: '<b>Unavailable</b>',
                            })
                        )
                    );
                    assert.equal(input().type, 'password');
                    assert.equal(
                        input().getAttribute('aria-label'),
                        'Sequence'
                    );
                    assert.equal(container.querySelector('label,b'), null);
                    assert.equal(
                        container.textContent.includes('42.125'),
                        false
                    );
                    assert.equal(
                        window.document.getElementById(
                            input().getAttribute('aria-describedby')
                        ).textContent,
                        '<b>Unavailable</b>'
                    );
                }
                await act(async () =>
                    root.render(
                        h(
                            Fragment,
                            null,
                            react.renderAutoNumberField(props),
                            react.renderAutoNumberField(props)
                        )
                    )
                );
                const inputs = [...container.querySelectorAll('input')];
                assert.equal(new Set(inputs.map((node) => node.id)).size, 2);
                for (const node of inputs)
                    assert.ok(
                        container.querySelector(`label[for="${node.id}"]`)
                    );
                checks++;

                await act(async () =>
                    root.render(
                        react.renderAutoNumberField({
                            ...props,
                            title: '  ',
                            pending: true,
                            error: null,
                            validation: [
                                { errorMessage: 'First problem' },
                                { errorMessage: 'Second problem' },
                            ],
                        })
                    )
                );
                assert.equal(input().getAttribute('aria-busy'), 'true');
                assert.equal(input().getAttribute('aria-invalid'), 'true');
                assert.equal(input().disabled, true);
                assert.equal(
                    container.querySelector('label').textContent,
                    'Sequence'
                );
                assert.equal(
                    container.querySelector('[role=status]').textContent,
                    'First problem\nSecond problem'
                );
                await act(async () =>
                    root.render(
                        react.renderAutoNumberField({
                            ...props,
                            error: '',
                            validation: [
                                {
                                    errorMessage:
                                        'Suppressed by explicit empty error',
                                },
                            ],
                        })
                    )
                );
                assert.equal(
                    container.querySelector('[role=status]').textContent,
                    ''
                );
                assert.equal(input().getAttribute('aria-describedby'), null);
                checks++;

                await act(async () =>
                    root.render(
                        h(react.AutoNumberField, {
                            binding,
                            className: 'consumer',
                        })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-number-field')
                );
                assert.equal(input().disabled, true);
                let wrong;
                await act(async () => {
                    wrong = fields.field('number');
                });
                await act(async () =>
                    root.render(h(react.AutoNumberField, { binding: wrong }))
                );
                assert.equal(input(), null);
                assert.ok(container.querySelector('[role=status]'));
                assert.equal(container.textContent.includes('17'), false);
                await act(async () =>
                    root.render(
                        h(react.AutoNumberField, {
                            binding: wrong,
                            render: ({ snapshot }) =>
                                h('output', null, `Custom ${snapshot.value}`),
                        })
                    )
                );
                assert.equal(container.textContent, 'Custom 17');
                assert.equal(wrong.getSnapshot().value, 17);
                checks++;

                await act(async () =>
                    root.render(h(react.AutoNumberField, { binding }))
                );
                const heldInput = input();
                let replacement;
                await act(async () => {
                    replacement = fields.field('replacement');
                });
                await act(async () =>
                    root.render(
                        h(react.AutoNumberField, { binding: replacement })
                    )
                );
                assert.equal(input().value, '-9.25');
                await edit('100', heldInput);
                assert.equal(input().value, '-9.25');
                assert.equal(binding.getSnapshot().value, 42.125);
                assert.equal(replacement.getSnapshot().value, -9.25);
                const finalRevision =
                    fields.controller.getState().draftRevision;
                await act(async () => root.render(null));
                await edit('101', heldInput);
                assert.equal(
                    fields.controller.getState().draftRevision,
                    finalRevision
                );
                assert.equal(binding.getSnapshot().retired, false);
                assert.equal(replacement.getSnapshot().retired, false);
                checks++;

                const hidden = {
                    ...binding,
                    getSnapshot: () => ({
                        ...binding.getSnapshot(),
                        visibility: { type: 'hidden' },
                    }),
                    subscribe: (notify) =>
                        binding.subscribe((snapshot) =>
                            notify({
                                ...snapshot,
                                visibility: { type: 'hidden' },
                            })
                        ),
                };
                await act(async () =>
                    root.render(h(react.AutoNumberField, { binding: hidden }))
                );
                assert.equal(container.textContent, '');
                await act(async () => root.render(tree()));
                current = false;
                await act(async () => root.render(tree()));
                assert.equal(input(), null);
                await act(async () =>
                    root.render(h(react.AutoNumberField, { binding }))
                );
                await act(async () => {
                    fields.destroy();
                    destroyed = true;
                });
                assert.equal(input(), null);
                assert.equal(writes, 0);
                assert.equal(capabilityReads, 0);
                assert.equal(capabilityActions, 0);
                assert.equal(requests, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                host.dispose();
                if (!destroyed) fields.destroy();
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
