import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const lastModifiedByReactTypedConsumer = `
import type { ReactNode } from 'react';
import {
    LastModifiedByField, renderLastModifiedByField, AirtableForm, AirtableGrid, AirtableList,
    type LastModifiedByFieldProps, type LastModifiedByFieldOptions, type TextFieldOptions,
} from '@miniextensions/sdk/react';
import type { AirtableCollaborator } from '@miniextensions/sdk';
import type { FieldRendererProps, FieldRendererSlots, FormRenderScope, PortalRenderScope } from '@miniextensions/sdk/ui';
import '@miniextensions/sdk/react/text.css';
const options: LastModifiedByFieldOptions = { className: 'modifier-consumer', clearLabel: 'Clear modifier' };
const sharedOptions: TextFieldOptions = options;
const aliasOptions: LastModifiedByFieldOptions = sharedOptions;
// @ts-expect-error Appearance options cannot grant computed write authority.
const setter: LastModifiedByFieldOptions = { setValue: (value: AirtableCollaborator) => {} };
// @ts-expect-error The renderer does not accept an identity resolver.
const resolver: LastModifiedByFieldOptions = { resolveCollaborator: (id: string) => id };
// @ts-expect-error The supplied native name has no formatting option.
const formatter: LastModifiedByFieldOptions = { formatValue: (value: AirtableCollaborator) => value.email };
export const renderers: FieldRendererSlots<ReactNode> = {
    renderLastModifiedByField: props => renderLastModifiedByField(props, aliasOptions),
};
export function BoundModifier(props: LastModifiedByFieldProps) {
    return <LastModifiedByField {...props} {...options} />;
}
export function Override(props: LastModifiedByFieldProps) {
    return <LastModifiedByField {...props} render={({ snapshot }) => <span>{String(snapshot.value == null)}</span>} />;
}
export function checkKinds(modifier: FieldRendererProps<'lastModifiedBy'>, text: FieldRendererProps<'singleLineText'>, created: FieldRendererProps<'createdBy'>) {
    renderLastModifiedByField(modifier);
    const readonlyCapability: { type: 'readonly' } = modifier.capability;
    const native: AirtableCollaborator | null | undefined = modifier.value;
    const collaborator: FieldRendererProps<'lastModifiedBy'>['value'] = { id: 'usr_synthetic', email: 'synthetic@example.invalid', name: 'Synthetic Modifier' };
    // @ts-expect-error An editable text slot is not a Last Modified By slot.
    renderLastModifiedByField(text);
    // @ts-expect-error A shared native shape does not change physical field kind.
    renderLastModifiedByField(created);
    // @ts-expect-error Last Modified By cannot expose an editable capability.
    const editable: FieldRendererProps<'lastModifiedBy'>['capability'] = { type: 'editable', setValue: () => ({ accepted: true }) };
    // @ts-expect-error Last Modified By has no setter capability.
    modifier.capability.setValue;
    // @ts-expect-error Last Modified By has no selection capability.
    modifier.capability.selection;
    // @ts-expect-error Last Modified By has no scalar capability.
    modifier.capability.scalar;
    // @ts-expect-error The native SDK value is a collaborator object, not a label.
    const label: FieldRendererProps<'lastModifiedBy'>['value'] = 'Synthetic Modifier';
    // @ts-expect-error Canonical collaborators require a name as well as identity.
    const noName: FieldRendererProps<'lastModifiedBy'>['value'] = { id: 'usr_synthetic', email: 'synthetic@example.invalid' };
    return { readonlyCapability, native, collaborator };
}
export function Compositions({ form, portal }: { form: FormRenderScope; portal: PortalRenderScope }) {
    return <>
        <AirtableForm scope={form} renderers={renderers}>{state => state.fields.map(field => field.node)}</AirtableForm>
        <AirtableGrid scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableGrid>
        <AirtableList scope={portal} renderers={renderers}>{state => state.rows.flatMap(row => row.cells.map(cell => cell.node))}</AirtableList>
    </>;
}
`;

/** Installed name-only presentation with synthetic owners and no external transport. */
export async function checkLastModifiedByConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = await import(pathToFileURL(happyDomModulePath));
    const window = new Window();
    let requests = 0;
    window.fetch = () => {
        requests++;
        throw Error('No modifier requests');
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
                require.resolve('@miniextensions/sdk/react/text.css'),
                'utf8'
            ),
            /\.mx-sdk-text:focus-visible/
        );
        assert.throws(
            () =>
                require.resolve(
                    '@miniextensions/sdk/react/last-modified-by.css'
                ),
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
            assert.equal(typeof react.LastModifiedByField, 'function');
            assert.equal(typeof react.renderLastModifiedByField, 'function');
            assert.equal(ui.renderLastModifiedByField, undefined);
            const nativeModifier = {
                id: 'usr_native',
                email: 'private-modifier@example.invalid',
                name: 'Native Modifier Ω',
                profilePicUrl: 'https://example.invalid/private-avatar.png',
            };
            const replacementModifier = {
                id: 'usr_replacement',
                email: 'replacement@example.invalid',
                name: 'Replacement Modifier',
            };
            const portalModifier = {
                id: 'usr_portal',
                email: 'private-portal@example.invalid',
                name: 'Portal Modifier Ω',
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
                'replacement',
                'created',
                'text',
            ];
            for (const [id, value] of [
                ['source', nativeModifier],
                ['empty', null],
                ['missing', undefined],
                ['replacement', replacementModifier],
                ['created', nativeModifier],
                ['text', 'Editable neighbor'],
            ]) {
                const kind =
                    id === 'text'
                        ? 'singleLineText'
                        : id === 'created'
                          ? 'createdBy'
                          : 'lastModifiedBy';
                if (value === undefined)
                    delete loaded.payload.formRecord.data[id];
                else loaded.payload.formRecord.data[id] = value;
                loaded.payload.fieldIdsToSchemas[id] = {
                    fieldType: kind,
                    airtableField: {
                        id,
                        name: id === 'text' ? 'Text' : 'Modifier',
                        description: null,
                        isPrimaryField: false,
                        isComputed: kind !== 'singleLineText',
                        config: {
                            type: kind,
                            options:
                                kind === 'singleLineText'
                                    ? null
                                    : {
                                          choices: [
                                              {
                                                  id: nativeModifier.id,
                                                  email: 'choice@example.invalid',
                                                  name: 'Metadata choice must not replace native name',
                                              },
                                          ],
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
                        throw Error('No modifier Save');
                    },
                },
            };
            const bindingOptions = {
                client,
                getScope: () => ({ ownerId: 'modifier-consumer', revision: 0 }),
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
                            'Readonly modifier setter must not be borrowed'
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
                                renderLastModifiedByField:
                                    react.renderLastModifiedByField,
                            },
                            fallback: () => null,
                        })
                    );
                const before = fields.controller.getState().draftRevision;
                await act(async () => root.render(tree()));
                assert.equal(input().value, nativeModifier.name);
                for (const privateValue of [
                    nativeModifier.id,
                    nativeModifier.email,
                    nativeModifier.profilePicUrl,
                ])
                    assert.equal(
                        container.innerHTML.includes(privateValue),
                        false
                    );
                assert.equal(input().disabled, true);
                assert.equal(clear().disabled, true);
                assert.equal(clear().type, 'button');
                assert.equal(binding.scalar, null);
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
                assert.equal(input().value, nativeModifier.name);
                await act(async () => root.render(null));
                await act(async () => root.render(tree()));
                assert.deepEqual(binding.getSnapshot().value, nativeModifier);
                assert.equal(
                    fields.controller.getState().draftRevision,
                    before
                );
                assert.equal(writes, 0);
                checks++;

                let props = host.getSnapshot().fields[0];
                for (const name of [
                    'Unknown Modifier',
                    'usr_native',
                    '  spaced Ω  ',
                    '<img src=x>',
                    'https://example.test/modifier',
                    '',
                ]) {
                    const value = { ...nativeModifier, name };
                    await act(async () =>
                        root.render(
                            react.renderLastModifiedByField({ ...props, value })
                        )
                    );
                    assert.equal(input().value, name);
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                    assert.equal(
                        container.querySelector('a,img,select,[role=combobox]'),
                        null
                    );
                    assert.equal(
                        container.textContent.includes(value.email),
                        false
                    );
                    assert.equal(
                        container.innerHTML.includes(value.profilePicUrl),
                        false
                    );
                    assert.deepEqual(
                        binding.getSnapshot().value,
                        nativeModifier
                    );
                }
                for (const value of [
                    null,
                    undefined,
                    '',
                    'Label only',
                    42,
                    false,
                    [],
                    [nativeModifier],
                    {},
                    { name: 'No identity' },
                    { ...nativeModifier, id: null },
                    { ...nativeModifier, email: null },
                    { ...nativeModifier, name: null },
                    { id: nativeModifier.id, email: nativeModifier.email },
                    { ...nativeModifier, profilePicUrl: 42 },
                ]) {
                    await act(async () =>
                        root.render(
                            react.renderLastModifiedByField({ ...props, value })
                        )
                    );
                    assert.equal(input().value, '');
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                }
                let objectCoercions = 0;
                await act(async () =>
                    root.render(
                        react.renderLastModifiedByField({
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
                ]) {
                    let empty;
                    await act(async () => {
                        empty = fields.field(id);
                    });
                    await act(async () =>
                        root.render(
                            h(react.LastModifiedByField, { binding: empty })
                        )
                    );
                    assert.equal(input().value, '');
                    await act(async () => root.render(null));
                    await act(async () =>
                        root.render(
                            h(react.LastModifiedByField, { binding: empty })
                        )
                    );
                    assert.equal(empty.getSnapshot().value, native);
                }
                checks++;

                const originalOwner = fields;
                for (const choices of [
                    [
                        {
                            id: nativeModifier.id,
                            email: 'choice@example.invalid',
                            name: 'Renamed choice',
                        },
                    ],
                    [],
                    [
                        {
                            id: 'usr_other',
                            email: nativeModifier.email,
                            name: 'Email match must not resolve a name',
                        },
                    ],
                ]) {
                    const next = fields.getLoaded();
                    next.payload.fieldIdsToSchemas.source.airtableField.config.options =
                        { choices };
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
                        root.render(h(react.LastModifiedByField, { binding }))
                    );
                    assert.equal(fields, originalOwner);
                    assert.equal(input().value, nativeModifier.name);
                    assert.deepEqual(
                        binding.getSnapshot().value,
                        nativeModifier
                    );
                    assert.equal(binding.scalar, null);
                    assert.equal(binding.selection, null);
                }
                props = host.getSnapshot().fields[0];
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
                        react.renderLastModifiedByField({
                            ...props,
                            value: nativeModifier,
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
                        h(react.LastModifiedByField, {
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
                assert.equal(input().value, nativeModifier.name);
                assert.equal(input().disabled, true);
                assert.equal(capabilityReads, 0);
                assert.equal(capabilityActions, 0);
                assert.equal(writes, 0);
                checks++;

                for (const side of ['displayConfig', 'writeConfig']) {
                    await act(async () =>
                        root.render(
                            react.renderLastModifiedByField(
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
                                    className: 'modifier-consumer',
                                    clearLabel: 'Clear supplied modifier',
                                }
                            )
                        )
                    );
                    assert.equal(input().type, 'password');
                    assert.equal(
                        input().getAttribute('aria-label'),
                        'Modifier'
                    );
                    assert.equal(
                        clear().getAttribute('aria-label'),
                        'Clear supplied modifier'
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
                            react.renderLastModifiedByField(props),
                            react.renderLastModifiedByField(props)
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
                        react.renderLastModifiedByField({
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
                    'Modifier'
                );
                assert.equal(
                    container.querySelector('[role=status]').textContent,
                    'First problem\nSecond problem'
                );
                await act(async () =>
                    root.render(
                        react.renderLastModifiedByField({
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
                        h(react.LastModifiedByField, {
                            binding,
                            className: 'consumer',
                        })
                    )
                );
                assert.ok(
                    container.querySelector('.consumer.mx-sdk-text-field')
                );
                let text;
                await act(async () => {
                    text = fields.field('text');
                });
                await act(async () =>
                    root.render(h(react.LastModifiedByField, { binding: text }))
                );
                assert.equal(input(), null);
                assert.ok(container.querySelector('[role=status]'));
                assert.equal(
                    container.textContent.includes('Editable neighbor'),
                    false
                );
                let created;
                await act(async () => {
                    created = fields.field('created');
                });
                await act(async () =>
                    root.render(
                        h(react.LastModifiedByField, { binding: created })
                    )
                );
                assert.equal(input(), null);
                assert.ok(container.querySelector('[role=status]'));
                assert.equal(
                    container.textContent.includes(nativeModifier.name),
                    false
                );
                assert.deepEqual(created.getSnapshot().value, nativeModifier);
                await act(async () =>
                    root.render(
                        h(react.LastModifiedByField, {
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
                assert.deepEqual(binding.getSnapshot().value, nativeModifier);
                checks++;

                await act(async () =>
                    root.render(h(react.LastModifiedByField, { binding }))
                );
                const heldInput = input();
                let replacement;
                await act(async () => {
                    replacement = fields.field('replacement');
                });
                await act(async () =>
                    root.render(
                        h(react.LastModifiedByField, {
                            binding: replacement,
                        })
                    )
                );
                await edit('Changed', heldInput);
                assert.equal(input().value, replacementModifier.name);
                assert.deepEqual(binding.getSnapshot().value, nativeModifier);
                assert.deepEqual(
                    replacement.getSnapshot().value,
                    replacementModifier
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
                            h(react.LastModifiedByField, {
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
                                    renderLastModifiedByField:
                                        react.renderLastModifiedByField,
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
                assert.equal(input().value, nativeModifier.name);
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
                assert.equal(falseBinding.selection, null);
                falseBinding.setValue = () => {
                    writes++;
                    throw Error(
                        'Computed metadata cannot grant wrapper editing'
                    );
                };
                await act(async () =>
                    root.render(
                        h(react.LastModifiedByField, {
                            binding: falseBinding,
                        })
                    )
                );
                assert.equal(input().disabled, true);
                await edit('Changed');
                assert.deepEqual(
                    falseBinding.getSnapshot().value,
                    nativeModifier
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
                        fieldName: 'Modifier',
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
                                            source: portalModifier,
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
                                                        source: portalModifier,
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
                            throw Error('No modifier inline write');
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
                        ownerId: 'modifier-portal',
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
                assert.deepEqual(detailProps.value, portalModifier);
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
                                        renderLastModifiedByField:
                                            react.renderLastModifiedByField,
                                    },
                                },
                                (state) =>
                                    state.rows.flatMap((row) =>
                                        row.cells.map((cell) => cell.node)
                                    )
                            )
                        )
                    );
                    assert.equal(input().value, portalModifier.name);
                    assert.equal(input().disabled, true);
                    assert.equal(clear().disabled, true);
                    await edit('Changed');
                    assert.equal(input().value, portalModifier.name);
                    assert.equal(reads, 1);
                    assert.equal(portalWrites, 0);
                    assert.deepEqual(detailProps.value, portalModifier);
                }
                await act(async () =>
                    root.render(h(react.LastModifiedByField, { binding }))
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
