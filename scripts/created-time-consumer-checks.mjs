import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const createdTimeReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    CreatedTimeField, renderCreatedTimeField, AirtableForm, AirtableGrid, AirtableList,
    type CreatedTimeFieldProps, type CreatedTimeFieldOptions, type DateTimeFieldOptions,
} from '@miniextensions/sdk/react';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/datetime.css';
const options: CreatedTimeFieldOptions = { className: 'created-time-consumer', clearLabel: 'Clear timestamp' };
const sharedOptions: DateTimeFieldOptions = options;
const aliasOptions: CreatedTimeFieldOptions = sharedOptions;
// @ts-expect-error Appearance options cannot grant computed write authority.
const setter: CreatedTimeFieldOptions = { setValue: (value: string) => {} };
// @ts-expect-error Raw timestamp presentation has no formatter option.
const formatter: CreatedTimeFieldOptions = { formatValue: (value: string) => value };
// @ts-expect-error The renderer does not resolve a display timezone.
const zone: CreatedTimeFieldOptions = { timeZone: 'Europe/Paris' };
// @ts-expect-error The renderer does not parse supplied native strings.
const parser: CreatedTimeFieldOptions = { parse: (value: string) => new Date(value) };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderCreatedTimeField: props => renderCreatedTimeField(props, aliasOptions),
};
export function BoundCreatedTime(props: CreatedTimeFieldProps) {
    return <CreatedTimeField {...props} {...options} />;
}
export function Override(props: CreatedTimeFieldProps) {
    return <CreatedTimeField {...props} render={({ snapshot }) => <span>{String(snapshot.value == null)}</span>} />;
}
export function checkKinds(created: FieldRendererProps<'createdTime'>, date: FieldRendererProps<'date'>, dateTime: FieldRendererProps<'dateTime'>, modified: FieldRendererProps<'lastModifiedTime'>) {
    renderCreatedTimeField(created);
    const readonlyCapability: { type: 'readonly' } = created.capability;
    const native: string | null | undefined = created.value;
    // @ts-expect-error A calendar date is not a Created Time physical slot.
    renderCreatedTimeField(date);
    // @ts-expect-error The shared control does not make editable dateTime interchangeable.
    renderCreatedTimeField(dateTime);
    // @ts-expect-error A shared native string shape does not change physical kind.
    renderCreatedTimeField(modified);
    // @ts-expect-error Created Time cannot expose an editable capability.
    const editable: FieldRendererProps<'createdTime'>['capability'] = { type: 'editable', setValue: () => ({ accepted: true }) };
    // @ts-expect-error Created Time has no setter capability.
    created.capability.setValue;
    // @ts-expect-error Created Time has no date capability.
    created.capability.date;
    // @ts-expect-error Created Time has no scalar capability.
    created.capability.scalar;
    // @ts-expect-error The native SDK value is a string, not a JavaScript Date.
    const object: FieldRendererProps<'createdTime'>['value'] = new Date();
    // @ts-expect-error Epoch numbers are not native Created Time answers.
    const epoch: FieldRendererProps<'createdTime'>['value'] = 123;
    return { readonlyCapability, native };
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed raw timestamp presentation with synthetic owners and no external transport. */
export async function checkCreatedTimeConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let requests = 0;
    window.fetch = () => {
        requests++;
        throw Error('No timestamp requests');
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
                require.resolve('@miniextensions/sdk/react/datetime.css'),
                'utf8'
            ),
            /\.mx-sdk-datetime:focus-visible/
        );
        assert.throws(
            () => require.resolve('@miniextensions/sdk/react/created-time.css'),
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
            const [ui, forms, portals, react] = await Promise.all(
                ['ui', 'forms', 'portals', 'react'].map(load)
            );
            assert.equal(typeof react.CreatedTimeField, 'function');
            assert.equal(typeof react.renderCreatedTimeField, 'function');
            assert.equal(ui.renderCreatedTimeField, undefined);
            const nativeTimestamp = '2024-11-03T01:30:00.120-07:00';
            const replacementTimestamp = '2026-10-15T12:34:56.789Z';
            const portalTimestamp = '2024-03-10T02:30:00-05:00';
            const timestampConfig = {
                type: 'dateTime',
                options: {
                    dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                    timeFormat: { name: '24hour', format: 'HH:mm' },
                    timeZone: 'utc',
                },
            };
            const loaded = fixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            loaded.payload.publicFields.state = {
                ...loaded.payload.publicFields.state,
                multiPageFormMode: 'multi-page',
                promptUserBeforeSubmission: false,
                enableFormComputeMode: false,
                autoSubmitAfterPrefill: false,
            };
            loaded.payload.fieldIdsInForm = [
                'source',
                'empty',
                'missing',
                'blank',
                'naive',
                'invalid',
                'linebreak',
                'replacement',
                'modified',
                'text',
            ];
            for (const [id, value] of [
                ['source', nativeTimestamp],
                ['empty', null],
                ['missing', undefined],
                ['blank', ''],
                ['naive', '2024-11-03T01:30:00'],
                ['invalid', '2024-02-30T25:61:61Z'],
                ['linebreak', '2024-07-01T12:00:00\r\nZ'],
                ['replacement', replacementTimestamp],
                ['modified', nativeTimestamp],
                ['text', 'Editable neighbor'],
            ]) {
                const kind =
                    id === 'text'
                        ? 'singleLineText'
                        : id === 'modified'
                          ? 'dateTime'
                          : 'createdTime';
                if (value === undefined)
                    delete loaded.payload.formRecord.data[id];
                else loaded.payload.formRecord.data[id] = value;
                loaded.payload.fieldIdsToSchemas[id] = {
                    fieldType: kind,
                    airtableField: {
                        id,
                        name: id === 'text' ? 'Text' : 'Timestamp',
                        description: null,
                        isPrimaryField: false,
                        isComputed: kind === 'createdTime',
                        config: {
                            type: kind,
                            options:
                                kind === 'singleLineText'
                                    ? null
                                    : kind === 'dateTime'
                                      ? structuredClone(timestampConfig.options)
                                      : {
                                            result: structuredClone(
                                                timestampConfig
                                            ),
                                        },
                        },
                    },
                    miniExtConfig: {},
                };
            }
            const client = {
                getSession: () => ({}),
                forms: {
                    save: async () => {
                        requests++;
                        throw Error('No timestamp Save');
                    },
                },
            };
            const bindingOptions = {
                client,
                getScope: () => ({
                    ownerId: 'timestamp-consumer',
                    revision: 0,
                }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            };
            const fields = forms.createFormFieldBindings({
                loaded,
                ...bindingOptions,
            });
            let current = true;
            let host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'source',
                isCurrent: () => current,
                configurationRevision: () => 0,
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            const root = createRoot(container);
            const cleanup = [];
            let destroyed = false;
            try {
                let binding = fields.field('source');
                let writes = 0,
                    capabilityReads = 0,
                    capabilityActions = 0;
                const trapSetter = () => {
                    binding.setValue = () => {
                        writes++;
                        throw Error(
                            'Readonly timestamp setter must not be borrowed'
                        );
                    };
                };
                trapSetter();
                const input = () => container.querySelector('input');
                const clear = () => container.querySelector('button');
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
                                renderCreatedTimeField:
                                    react.renderCreatedTimeField,
                            },
                            fallback: () => null,
                        })
                    );
                const before = fields.controller.getState().draftRevision;
                await act(async () => root.render(tree()));
                assert.equal(input().value, nativeTimestamp);
                assert.equal(input().disabled, true);
                assert.equal(clear().disabled, true);
                assert.equal(clear().type, 'button');
                assert.equal(binding.scalar, null);
                assert.equal(binding.date, null);
                assert.equal(binding.selection, null);
                assert.deepEqual(host.getSnapshot().fields[0].capability, {
                    type: 'readonly',
                });
                await edit('Replacement');
                await act(async () =>
                    clear().dispatchEvent(
                        new window.MouseEvent('click', { bubbles: true })
                    )
                );
                assert.equal(input().value, nativeTimestamp);
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.deepEqual(binding.getSnapshot().value, nativeTimestamp);
                assert.equal(
                    fields.controller.getState().draftRevision,
                    before
                );
                assert.equal(writes, 0);
                checks++;

                let props = host.getSnapshot().fields[0];
                for (const value of [
                    nativeTimestamp,
                    '2024-07-01T12:00:00Z',
                    '2024-11-03T01:30:00',
                    '2024-02-30T25:61:61Z',
                    'not a date',
                    '  raw Ω  ',
                    '<img src=x>',
                    'https://example.invalid/timestamp',
                    '',
                    'line\r\nbreak',
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderCreatedTimeField({ ...props, value })
                        )
                    );
                    assert.equal(input().value, value.replace(/[\r\n]/g, ''));
                    assert.equal(input().disabled, true);
                    assert.equal(input().getAttribute('aria-invalid'), 'false');
                    assert.equal(clear().disabled, true);
                    assert.equal(
                        container.querySelector('a,img,select,[role=combobox]'),
                        null
                    );
                    assert.equal(binding.getSnapshot().value, nativeTimestamp);
                }
                for (const value of [
                    null,
                    undefined,
                    42,
                    false,
                    [],
                    ['timestamp'],
                    {},
                    { value: nativeTimestamp },
                    new Date('2024-07-01T12:00:00Z'),
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderCreatedTimeField({ ...props, value })
                        )
                    );
                    assert.equal(input().value, '');
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                }
                let objectCoercions = 0;
                await act(async () =>
                    root.render(
                        react.renderCreatedTimeField({
                            ...props,
                            value: {
                                toString() {
                                    objectCoercions++;
                                    throw Error('No object coercion');
                                },
                            },
                        })
                    )
                );
                assert.equal(input().value, '');
                assert.equal(objectCoercions, 0);
                for (const [id, native] of [
                    ['empty', null],
                    ['missing', undefined],
                    ['blank', ''],
                    ['naive', '2024-11-03T01:30:00'],
                    ['invalid', '2024-02-30T25:61:61Z'],
                    ['linebreak', '2024-07-01T12:00:00\r\nZ'],
                ]) {
                    let empty;
                    await act(async () => {
                        empty = fields.field(id);
                    });
                    await act(async () =>
                        root.render(
                            h(react.CreatedTimeField, { binding: empty })
                        )
                    );
                    const visible =
                        typeof native === 'string'
                            ? native.replace(/[\r\n]/g, '')
                            : '';
                    assert.equal(input().value, visible);
                    await edit('Changed');
                    await act(async () =>
                        clear().dispatchEvent(
                            new window.MouseEvent('click', { bubbles: true })
                        )
                    );
                    assert.equal(input().value, visible);
                    assert.equal(empty.getSnapshot().value, native);
                    await act(async () => root.render(null));
                    await act(async () =>
                        root.render(
                            h(react.CreatedTimeField, { binding: empty })
                        )
                    );
                    assert.equal(input().value, visible);
                    assert.equal(empty.getSnapshot().value, native);
                }
                checks++;

                const originalOwner = fields;
                for (const result of [
                    {
                        type: 'date',
                        options: {
                            dateFormat: { name: 'us', format: 'M/D/YYYY' },
                        },
                    },
                    {
                        type: 'dateTime',
                        options: {
                            dateFormat: {
                                name: 'european',
                                format: 'D/M/YYYY',
                            },
                            timeFormat: { name: '12hour', format: 'h:mma' },
                            timeZone: 'Europe/Paris',
                        },
                    },
                    timestampConfig,
                ]) {
                    const next = fields.getLoaded();
                    next.payload.fieldIdsToSchemas.source.airtableField.config.options =
                        { result };
                    await act(async () => {
                        assert.equal(
                            await fields.reload({
                                dirty: 'discard',
                                read: async () => next,
                            }),
                            true
                        );
                    });
                    await act(async () => {
                        host.dispose();
                        host = ui.createFormFieldRendererHost({
                            fields,
                            fieldId: 'source',
                            isCurrent: () => current,
                            configurationRevision: () => 0,
                        });
                        binding = fields.field('source');
                        trapSetter();
                    });
                    assert.equal(host.getSnapshot().status, 'ready');
                    await act(async () =>
                        root.render(h(react.CreatedTimeField, { binding }))
                    );
                    assert.equal(fields, originalOwner);
                    assert.equal(input().value, nativeTimestamp);
                    assert.deepEqual(
                        binding.getSnapshot().value,
                        nativeTimestamp
                    );
                    assert.equal(binding.scalar, null);
                    assert.equal(binding.date, null);
                    assert.equal(binding.selection, null);
                }
                props = host.getSnapshot().fields[0];
                let metadataReads = 0;
                await act(async () =>
                    root.render(
                        react.renderCreatedTimeField({
                            ...props,
                            field: {
                                ...props.field,
                                config: {
                                    type: 'createdTime',
                                    get options() {
                                        metadataReads++;
                                        throw Error('No result formatting');
                                    },
                                },
                            },
                        })
                    )
                );
                assert.equal(input().value, nativeTimestamp);
                assert.equal(metadataReads, 0);
                checks++;

                const forged = { type: 'editable' };
                for (const key of ['scalar', 'selection', 'date', 'setValue'])
                    Object.defineProperty(forged, key, {
                        get() {
                            capabilityReads++;
                            throw Error(`No borrowed ${key}`);
                        },
                    });
                await act(async () =>
                    root.render(
                        react.renderCreatedTimeField({
                            ...props,
                            value: nativeTimestamp,
                            computed: false,
                            capability: forged,
                        })
                    )
                );
                await edit('Changed');
                await act(async () => {
                    clear().dispatchEvent(
                        new window.MouseEvent('click', { bubbles: true })
                    );
                    for (const type of ['change', 'blur'])
                        input().dispatchEvent(
                            new window.Event(type, { bubbles: true })
                        );
                    for (const type of ['compositionstart', 'compositionend'])
                        input().dispatchEvent(
                            new window.CompositionEvent(type, { bubbles: true })
                        );
                    input().dispatchEvent(
                        new window.KeyboardEvent('keydown', {
                            key: 'Enter',
                            bubbles: true,
                        })
                    );
                });
                const forgedBinding = {
                    ...binding,
                    getSnapshot: () => binding.getSnapshot(),
                    subscribe: (notify) => binding.subscribe(notify),
                };
                for (const key of ['scalar', 'selection', 'date'])
                    Object.defineProperty(forgedBinding, key, {
                        get() {
                            capabilityReads++;
                            throw Error(`No binding model ${key}`);
                        },
                    });
                forgedBinding.setValue = () => {
                    capabilityActions++;
                    throw Error('No direct binding write');
                };
                await act(async () =>
                    root.render(
                        h(react.CreatedTimeField, {
                            binding: forgedBinding,
                        })
                    )
                );
                await edit('Changed');
                await act(async () =>
                    clear().dispatchEvent(
                        new window.MouseEvent('click', { bubbles: true })
                    )
                );
                assert.equal(input().value, nativeTimestamp);
                assert.equal(input().disabled, true);
                assert.equal(capabilityReads, 0);
                assert.equal(capabilityActions, 0);
                assert.equal(writes, 0);
                checks++;

                for (const side of ['displayConfig', 'writeConfig']) {
                    await act(async () =>
                        root.render(
                            react.renderCreatedTimeField(
                                {
                                    ...props,
                                    displayConfig: { showTitle: false },
                                    [side]: {
                                        showTitle: false,
                                        maskPasswordOnLoginScreen: true,
                                    },
                                    error: '<b>Unavailable</b>',
                                },
                                {
                                    className: 'timestamp-consumer',
                                    clearLabel: 'Clear supplied timestamp',
                                }
                            )
                        )
                    );
                    assert.equal(input().type, 'password');
                    assert.equal(
                        input().getAttribute('aria-label'),
                        'Timestamp'
                    );
                    assert.equal(
                        clear().getAttribute('aria-label'),
                        'Clear supplied timestamp'
                    );
                    assert.equal(clear().disabled, true);
                    assert.equal(container.querySelector('label,b'), null);
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
                            react.renderCreatedTimeField(props),
                            react.renderCreatedTimeField(props)
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
                        react.renderCreatedTimeField({
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
                assert.equal(clear().disabled, true);
                assert.equal(
                    container.querySelector('label').textContent,
                    'Timestamp'
                );
                assert.equal(
                    container.querySelector('[role=status]').textContent,
                    'First problem\nSecond problem'
                );
                await act(async () =>
                    root.render(
                        react.renderCreatedTimeField({
                            ...props,
                            error: '',
                            validation: [{ errorMessage: 'Suppressed' }],
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
                        h(react.CreatedTimeField, {
                            binding,
                            className: 'consumer',
                        })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-datetime-field')
                );
                let text;
                await act(async () => {
                    text = fields.field('text');
                });
                await act(async () =>
                    root.render(h(react.CreatedTimeField, { binding: text }))
                );
                assert.equal(input(), null);
                assert.ok(container.querySelector('[role=status]'));
                assert.equal(
                    container.textContent.includes('Editable neighbor'),
                    false
                );
                let modified;
                await act(async () => {
                    modified = fields.field('modified');
                });
                await act(async () =>
                    root.render(
                        h(react.CreatedTimeField, { binding: modified })
                    )
                );
                assert.equal(input(), null);
                assert.ok(container.querySelector('[role=status]'));
                assert.equal(
                    container.textContent.includes(nativeTimestamp),
                    false
                );
                assert.deepEqual(modified.getSnapshot().value, nativeTimestamp);
                await act(async () =>
                    root.render(
                        h(react.CreatedTimeField, {
                            binding: text,
                            render: ({ snapshot }) =>
                                h('output', null, `Custom ${snapshot.value}`),
                        })
                    )
                );
                assert.equal(container.textContent, 'Custom Editable neighbor');
                await act(async () =>
                    root.render(h(react.TextField, { binding: text }))
                );
                assert.equal(input().disabled, false);
                assert.equal(clear().disabled, false);
                await edit('Edited neighbor');
                assert.equal(text.getSnapshot().value, 'Edited neighbor');
                assert.deepEqual(binding.getSnapshot().value, nativeTimestamp);
                await act(async () =>
                    root.render(h(react.DateTimeField, { binding: modified }))
                );
                assert.equal(input().disabled, false);
                await edit('2026-10-15T09:00:00.123+02:00');
                assert.equal(
                    modified.getSnapshot().value,
                    '2026-10-15T09:00:00.123+02:00'
                );
                assert.equal(binding.getSnapshot().value, nativeTimestamp);
                checks++;

                await act(async () =>
                    root.render(h(react.CreatedTimeField, { binding }))
                );
                const heldInput = input();
                let replacement;
                await act(async () => {
                    replacement = fields.field('replacement');
                });
                await act(async () =>
                    root.render(
                        h(react.CreatedTimeField, {
                            binding: replacement,
                        })
                    )
                );
                await edit('Changed', heldInput);
                assert.equal(input().value, replacementTimestamp);
                assert.deepEqual(binding.getSnapshot().value, nativeTimestamp);
                assert.deepEqual(
                    replacement.getSnapshot().value,
                    replacementTimestamp
                );
                for (const visibility of [
                    { type: 'hidden' },
                    { type: 'blocked', code: 'invalid', diagnostics: [] },
                ]) {
                    const hidden = {
                        ...binding,
                        getSnapshot: () => ({
                            ...binding.getSnapshot(),
                            visibility,
                        }),
                        subscribe: (notify) =>
                            binding.subscribe((snapshot) =>
                                notify({ ...snapshot, visibility })
                            ),
                    };
                    await act(async () =>
                        root.render(
                            h(react.CreatedTimeField, {
                                binding: hidden,
                            })
                        )
                    );
                    assert.equal(input(), null);
                }
                await act(async () => root.render(tree()));
                current = false;
                await act(async () => root.render(tree()));
                assert.equal(input(), null);
                current = true;
                checks++;

                let formScope;
                await act(async () => {
                    formScope = ui.createFormRenderScope({
                        fields,
                        isCurrent: () => true,
                        configurationRevision: () => 0,
                    });
                });
                cleanup.push(() => formScope.destroy());
                await act(async () =>
                    root.render(
                        h(
                            react.AirtableForm,
                            {
                                scope: formScope,
                                renderers: {
                                    renderCreatedTimeField:
                                        react.renderCreatedTimeField,
                                },
                            },
                            (state) =>
                                state.fields
                                    .filter(
                                        (field) => field.fieldId === 'source'
                                    )
                                    .map((field) => field.node)
                        )
                    )
                );
                assert.equal(input().value, nativeTimestamp);
                assert.equal(input().disabled, true);
                const falseComputed = structuredClone(loaded);
                falseComputed.payload.fieldIdsToSchemas.source.airtableField.isComputed = false;
                let falseFields, falseBinding, falseHost;
                await act(async () => {
                    falseFields = forms.createFormFieldBindings({
                        loaded: falseComputed,
                        ...bindingOptions,
                    });
                    falseBinding = falseFields.field('source');
                    falseHost = ui.createFormFieldRendererHost({
                        fields: falseFields,
                        fieldId: 'source',
                        isCurrent: () => true,
                        configurationRevision: () => 0,
                    });
                });
                cleanup.push(
                    () => falseFields.destroy(),
                    () => falseHost.dispose()
                );
                assert.equal(falseHost.getSnapshot().status, 'ready');
                assert.deepEqual(falseHost.getSnapshot().fields[0].capability, {
                    type: 'readonly',
                });
                assert.equal(falseBinding.getSnapshot().canEdit, false);
                assert.equal(falseBinding.scalar, null);
                assert.equal(falseBinding.date, null);
                assert.equal(falseBinding.selection, null);
                falseBinding.setValue = () => {
                    writes++;
                    throw Error(
                        'Computed metadata cannot grant wrapper editing'
                    );
                };
                await act(async () =>
                    root.render(
                        h(react.CreatedTimeField, {
                            binding: falseBinding,
                        })
                    )
                );
                assert.equal(input().disabled, true);
                await edit('Changed');
                assert.deepEqual(
                    falseBinding.getSnapshot().value,
                    nativeTimestamp
                );
                assert.equal(requests, 0);
                checks++;

                const sourceField =
                    loaded.payload.fieldIdsToSchemas.source.airtableField;
                const portal = fixtures.makePortal();
                portal.payload.initialLinkedTableStates.tbl_children.airtableFields =
                    [sourceField];
                const details = [
                    {
                        fieldId: 'source',
                        fieldName: 'Timestamp',
                        titleOverride: null,
                        isHidden: false,
                        fieldIsInEditingChildForm: false,
                        childFormField: null,
                        miniExtConfig: {},
                    },
                ];
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children =
                    details;
                let reads = 0,
                    portalWrites = 0;
                const portalClient = {
                    getSession: () => ({}),
                    portals: {
                        listLinkedRecords: async () => {
                            reads++;
                            return fixtures.page(
                                [
                                    {
                                        id: 'rec_source',
                                        fields: {
                                            source: portalTimestamp,
                                        },
                                    },
                                ],
                                null,
                                {
                                    customViewDetailFields: {
                                        fld_children: details,
                                    },
                                    tableIdsToLinkedTableStates: {
                                        tbl_children: {
                                            airtableFields: [sourceField],
                                            recordIdsToAirtableRecords: {
                                                rec_source: {
                                                    id: 'rec_source',
                                                    fields: {
                                                        source: portalTimestamp,
                                                    },
                                                },
                                            },
                                        },
                                    },
                                }
                            );
                        },
                        updateGridCell: async () => {
                            portalWrites++;
                            throw Error('No timestamp inline write');
                        },
                    },
                };
                const owner = portals.createPortalListOwner({
                    client: portalClient,
                    portal,
                    portalFieldId: 'fld_children',
                    criteria: {
                        selectedCustomViewId: 'view_example',
                        searchTerm: null,
                        searchParamsMap: {},
                        sortFieldsByEndUser: null,
                        filtersByEndUser: null,
                        supportsEndUserSortCleanup: true,
                        supportsEndUserFilterCleanup: true,
                    },
                    getScope: () => ({
                        ownerId: 'timestamp-portal',
                        revision: 0,
                    }),
                });
                cleanup.push(() => owner.destroy());
                const portalScope = ui.createPortalRenderScope({
                    owner,
                    client: portalClient,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                cleanup.push(() => portalScope.destroy());
                assert.equal(reads, 0);
                assert.equal(
                    await portalScope.getSnapshot().actions.load({
                        pagesToFetch: 1,
                        refreshLoggedInPortalRecord: false,
                    }),
                    true
                );
                const detailProps = portalScope
                    .getSnapshot()
                    .rows[0].cells[0].host.getSnapshot().fields[0];
                assert.equal(detailProps.context, 'portal-detail');
                assert.deepEqual(detailProps.value, portalTimestamp);
                assert.deepEqual(detailProps.capability, { type: 'readonly' });
                for (const Component of [
                    react.AirtableGrid,
                    react.AirtableList,
                ]) {
                    await act(async () =>
                        root.render(
                            h(
                                Component,
                                {
                                    scope: portalScope,
                                    renderers: {
                                        renderCreatedTimeField:
                                            react.renderCreatedTimeField,
                                    },
                                },
                                (state) =>
                                    state.rows.flatMap((row) =>
                                        row.cells.map((cell) => cell.node)
                                    )
                            )
                        )
                    );
                    assert.equal(input().value, portalTimestamp);
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                    await edit('Changed');
                    assert.equal(input().value, portalTimestamp);
                    assert.equal(reads, 1);
                    assert.equal(portalWrites, 0);
                    assert.deepEqual(detailProps.value, portalTimestamp);
                }
                await act(async () =>
                    root.render(h(react.CreatedTimeField, { binding }))
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
                for (const dispose of cleanup.reverse()) dispose();
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
