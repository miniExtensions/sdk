import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Execute the shipped TSX with installed React and the installed SDK, never source aliases. */
export async function checkMultipleSelectFormDriverRecipe({
    consumerDirectory,
    flavor = 'esm',
}) {
    assert(['esm', 'cjs'].includes(flavor));
    const directory = realpathSync(consumerDirectory),
        consumer = createRequire(join(directory, 'package.json'));
    const installed = realpathSync(
        join(directory, 'node_modules/@miniextensions/sdk')
    );
    for (const name of ['forms', 'ui', 'react'])
        assert(
            realpathSync(
                consumer.resolve(`@miniextensions/sdk/${name}`)
            ).startsWith(`${installed}/dist/`)
        );
    const recipes = [
        ...readFileSync(join(installed, 'docs/forms.md'), 'utf8').matchAll(
            /```tsx\n([\s\S]*?)\n```/g
        ),
    ].filter(([, code]) =>
        code.includes('export function MultipleSelectRequestField(')
    );
    assert.equal(
        recipes.length,
        1,
        'Missing unique shipped multiple-select Form recipe'
    );
    assert(recipes[0][1].includes('SelectField'));
    const generated = join(directory, '.generated');
    mkdirSync(generated, { recursive: true });
    const source = join(generated, 'multi-select-form-driver-recipe.tsx');
    writeFileSync(
        source,
        recipes[0][1] +
            `
import type { ReactNode } from 'react';
import { AirtableForm } from '@miniextensions/sdk/react';
import type { FormRenderScope, FieldRendererSlots } from '@miniextensions/sdk/ui';
// Only the application page layout is synthetic. The select is the exact shipped recipe.
export function MultipleSelectRequestForm({ scope, fields }: { scope: FormRenderScope; fields: FormFieldBindings }) {
    const renderers: FieldRendererSlots<ReactNode> = {
        renderMultipleSelectsField: field => <MultipleSelectRequestField field={field} fields={fields} />,
        renderSingleLineTextField: field => <section aria-label={field.title}><input value={field.value ?? ''} disabled={field.capability.type !== 'editable'} onInput={event => { if (field.capability.type === 'editable') field.capability.setValue(event.currentTarget.value); }} /></section>,
    };
    return <AirtableForm scope={scope} renderers={renderers}>{state => <form onSubmit={event => { event.preventDefault(); void state.actions.submit().catch(() => {}); }}>
        {state.fields.map(({ fieldId, node }) => <div key={fieldId}>{node}</div>)}
        <button type="button" disabled={!state.page.canBack} onClick={() => state.actions.back()}>Back</button>
        <button type="button" disabled={!state.page.canNext} onClick={() => state.actions.next()}>Next</button>
        <button type="submit" disabled={!state.page.canSubmit}>Save</button>
    </form>}</AirtableForm>;
}
`
    );
    execFileSync(
        process.execPath,
        [
            createRequire(import.meta.url).resolve('typescript/bin/tsc'),
            '--noEmit',
            '--strict',
            '--skipLibCheck',
            '--target',
            'ES2022',
            '--module',
            'NodeNext',
            '--moduleResolution',
            'NodeNext',
            '--jsx',
            'react-jsx',
            source,
        ],
        { cwd: directory, stdio: 'pipe' }
    );
    const outfile = join(
        generated,
        `multi-select-form-driver-recipe.${flavor === 'esm' ? 'mjs' : 'cjs'}`
    );
    await build({
        entryPoints: [source],
        bundle: true,
        platform: 'node',
        format: flavor,
        jsx: 'automatic',
        external: [
            'react',
            'react/*',
            'react-dom',
            'react-dom/*',
            '@miniextensions/sdk/*',
        ],
        outfile,
        logLevel: 'silent',
    });
    const load = async (name) =>
        flavor === 'cjs'
            ? consumer(`@miniextensions/sdk/${name}`)
            : import(
                  pathToFileURL(join(installed, `dist/esm/${name}/index.js`))
              );
    const forms = await load('forms'),
        ui = await load('ui');
    const { Window } = createRequire(import.meta.url)('happy-dom'),
        window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLSelectElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    const { createElement, act } = consumer('react'),
        { createRoot } = consumer('react-dom/client');
    const { MultipleSelectRequestForm } =
        flavor === 'cjs'
            ? consumer(outfile)
            : await import(pathToFileURL(outfile));
    const fixture = (mode, configure = () => {}) => {
        const loaded = portalRecipeFixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        const field = (id, name, miniExtConfig = {}) => ({
            fieldType: 'singleLineText',
            airtableField: {
                id,
                name,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: { type: 'singleLineText', options: null },
            },
            miniExtConfig,
        });
        const rule = {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'other-details',
                    type: 'singleCondition',
                    setting: {
                        fieldType: 'multipleSelects',
                        type: 'hasAnyOf',
                        idOrName: { type: 'id', id: 'fld_request_type' },
                        value: ['opt_other'],
                    },
                },
            ],
        };
        const request = field('fld_request_type', 'Request type');
        request.fieldType = 'multipleSelects';
        request.airtableField.config = {
            type: 'multipleSelects',
            options: {
                choices: [
                    { id: 'opt_standard', name: 'Standard' },
                    { id: 'opt_other', name: 'Other' },
                ],
            },
        };
        Object.assign(loaded.payload, {
            hasParentExtension: false,
            fieldIdsInForm: ['fld_request_type', 'fld_details'],
            fieldIdsToSchemas: {
                fld_request_type: request,
                fld_details: field('fld_details', 'Details', {
                    required: true,
                    enableSectionHeader: true,
                    headerSectionTitle: 'Details',
                    conditionalFields: rule,
                }),
            },
            formRecord: {
                type: 'create',
                data: {
                    fld_request_type: ['Standard', 'Standard'],
                    fld_details: '',
                    hidden_native: ['Keep', 'Native', 'Keep'],
                    unrelated: { text: '001' },
                },
            },
            formFieldIdsWithUnsavedChanges: ['hidden_native'],
            urlPrefilledFieldIds: [],
            publicFields: {
                type: 'form',
                state: {
                    multiPageFormMode: mode,
                    promptUserBeforeSubmission: false,
                    enableFormComputeMode: false,
                    autoSubmitAfterPrefill: false,
                },
            },
        });
        configure(loaded);
        let owner = { ownerId: 'A', revision: 0 },
            configuration = 0,
            attempts = 0;
        const calls = [],
            journal = new forms.RecoveryJournal();
        const journalScope = {
            owner: 'A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: loaded.extensionId,
            context: 'direct-url',
        };
        const lifecycle = {
            dispatch() {
                attempts++;
                const attempt = journal.begin(journalScope, null, 'save', 1);
                return {
                    accepted() {
                        journal.accepted(attempt, 'validation-error');
                    },
                    finish() {
                        journal.finishFlight(attempt);
                    },
                };
            },
        };
        const options = {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: { kept: 'exact' },
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        };
        const client = {
            getSession: () => ({}),
            forms: {
                save: async (input) => {
                    calls.push(structuredClone(input));
                    return {
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    };
                },
            },
        };
        const fields = forms.createFormFieldBindings({
            loaded,
            client,
            getScope: () => owner,
            saveOptions: options,
        });
        const ownership = {
            fields,
            isCurrent: () => true,
            configurationRevision: () => configuration,
        };
        const pages = forms.createFormPageOwner(ownership),
            scope = ui.createFormRenderScope({
                ...ownership,
                pages,
                saveOptions: { lifecycle },
            });
        return {
            fields,
            pages,
            scope,
            calls,
            journal,
            journalScope,
            loaded,
            options,
            get attempts() {
                return attempts;
            },
            replaceConfiguration() {
                configuration++;
            },
            aba() {
                owner = { ownerId: 'B', revision: 1 };
                fields.refresh();
                owner = { ownerId: 'A', revision: 2 };
                fields.refresh();
            },
            close() {
                scope.destroy();
                pages.dispose();
                fields.destroy();
            },
        };
    };
    const refresh = (select) => {
        const option = window.document.createElement('option');
        select.append(option);
        option.remove();
    };
    let checks = 0;
    try {
        // Admitting Form drivers does not admit select-driven option filtering.
        for (const type of ['multipleSelects', 'singleSelect']) {
            const f = fixture('one-page');
            try {
                const driver = structuredClone(
                    f.loaded.payload.fieldIdsToSchemas.fld_request_type
                        .airtableField
                );
                driver.config.type = type;
                const target = structuredClone(
                    f.loaded.payload.fieldIdsToSchemas.fld_request_type
                );
                target.miniExtConfig = {
                    enableConditionalOptions: true,
                    conditionsForOptions: [
                        {
                            id: 'option-rule',
                            config: {
                                optionForConditions: 'opt_other',
                                conditionsForOption: {
                                    logicalOperator: 'and',
                                    conditions: [
                                        {
                                            id: 'select-driver',
                                            type: 'singleCondition',
                                            setting: {
                                                fieldType: type,
                                                type:
                                                    type === 'multipleSelects'
                                                        ? 'hasAnyOf'
                                                        : 'is',
                                                idOrName: {
                                                    type: 'id',
                                                    id: 'fld_request_type',
                                                },
                                                value:
                                                    type === 'multipleSelects'
                                                        ? ['opt_other']
                                                        : 'opt_other',
                                            },
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                };
                const result = ui.resolveSelectFieldAvailability({
                    field: target,
                    airtableFields: [driver],
                    recordForConditionEvaluation: {
                        id: 'rec_synthetic',
                        fields: {
                            fld_request_type:
                                type === 'multipleSelects'
                                    ? ['Other']
                                    : 'Other',
                        },
                    },
                    mode: 'runtime',
                    invalidConditionMode: 'strict',
                });
                assert.equal(result.status, 'blocked');
                assert.deepEqual(result.options, []);
                assert.equal(f.calls.length, 0);
                checks++;
            } finally {
                f.close();
            }
        }
        for (const mode of ['one-page', 'multi-page']) {
            const f = fixture(mode),
                host = window.document.createElement('div');
            window.document.body.append(host);
            let root = createRoot(host);
            const mount = () =>
                act(async () =>
                    root.render(
                        createElement(MultipleSelectRequestForm, {
                            scope: f.scope,
                            fields: f.fields,
                        })
                    )
                );
            const choose = (names) =>
                act(async () => {
                    const select = host.querySelector('select');
                    assert.equal(select.multiple, true);
                    for (const option of select.options)
                        option.selected = names.includes(option.value);
                    refresh(select);
                    select.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                });
            const submit = () =>
                act(async () =>
                    host.querySelector('form').dispatchEvent(
                        new window.Event('submit', {
                            bubbles: true,
                            cancelable: true,
                        })
                    )
                );
            const click = (text) =>
                act(async () =>
                    [...host.querySelectorAll('button')]
                        .find((b) => b.textContent === text)
                        .click()
                );
            try {
                await mount();
                assert.equal(host.querySelector('input'), null);
                assert.deepEqual(
                    f.fields.field('fld_request_type').getSnapshot().value,
                    ['Standard', 'Standard']
                );
                const stale = f.scope.getSnapshot().actions;
                await choose(['Other']);
                await choose(['Standard']);
                await assert.rejects(stale.submit());
                assert.equal(stale.next().accepted, false);
                await choose(['Other']);
                assert.deepEqual(
                    f.fields.field('fld_request_type').getSnapshot().value,
                    ['Other']
                );
                assert.equal(stale.next().accepted, false);
                await assert.rejects(stale.submit());
                if (mode === 'multi-page') {
                    assert.equal(host.querySelector('input'), null);
                    await click('Next');
                }
                assert(host.querySelector('section[aria-label="Details"]'));
                await submit();
                assert.equal(f.calls.length, 0);
                assert.equal(f.attempts, 0);
                assert.equal(
                    f.journal.blocking(f.journalScope, null),
                    undefined
                );
                await act(async () => {
                    const input = host.querySelector('input');
                    input.value = 'Native details';
                    input.dispatchEvent(
                        new window.Event('input', { bubbles: true })
                    );
                });
                await act(async () => root.unmount());
                root = createRoot(host);
                await mount();
                assert.equal(
                    host.querySelector('input').value,
                    'Native details'
                );
                assert.deepEqual(
                    f.fields.field('fld_request_type').getSnapshot().value,
                    ['Other']
                );
                if (mode === 'multi-page') await click('Back');
                assert.deepEqual(
                    [...host.querySelector('select').selectedOptions].map(
                        (o) => o.value
                    ),
                    ['Other']
                );
                await choose(['Standard']);
                assert.equal(host.querySelector('input'), null);
                assert.equal(
                    f.fields.field('fld_details').getSnapshot().value,
                    'Native details'
                );
                if (mode === 'multi-page') await click('Next');
                assert.equal(f.calls.length, 0);
                await submit();
                assert.equal(f.calls.length, 1);
                assert.equal(f.attempts, 1);
                assert.deepEqual(f.calls[0], {
                    ...f.options,
                    extensionAccessToken: f.loaded.payload.extensionAccessToken,
                    formRecord: {
                        type: 'create',
                        data: {
                            fld_request_type: ['Standard'],
                            fld_details: 'Native details',
                            hidden_native: ['Keep', 'Native', 'Keep'],
                            unrelated: { text: '001' },
                        },
                    },
                    formFieldIdsWithUnsavedChanges: [
                        'hidden_native',
                        'fld_request_type',
                        'fld_details',
                    ],
                });
                const retained = f.scope.getSnapshot().actions;
                await act(async () => f.aba());
                await assert.rejects(retained.submit());
                assert.equal(retained.next().accepted, false);
                assert.equal(host.querySelector('form'), null);
                assert.equal(f.calls.length, 1);
                assert.equal(f.attempts, 1);
                checks += 14;
            } finally {
                await act(async () => root.unmount());
                f.close();
                host.remove();
            }
        }
        for (const kind of ['readonly', 'deleted', 'renamed']) {
            const f = fixture('one-page', (loaded) => {
                loaded.payload.formRecord.data.fld_request_type = [
                    'Other',
                    'Other',
                    'Standard',
                ];
                loaded.payload.formRecord.data.fld_details = 'Retained details';
                const schema =
                    loaded.payload.fieldIdsToSchemas.fld_request_type;
                if (kind === 'readonly') schema.miniExtConfig.readOnly = true;
                if (kind === 'deleted')
                    schema.airtableField.config.options.choices.pop();
                if (kind === 'renamed')
                    schema.airtableField.config.options.choices[1].name =
                        'Renamed Other';
            });
            const before = structuredClone(
                    f.fields.controller.getState().draft
                ),
                host = window.document.createElement('div');
            window.document.body.append(host);
            let root = createRoot(host);
            const mount = () =>
                act(async () =>
                    root.render(
                        createElement(MultipleSelectRequestForm, {
                            scope: f.scope,
                            fields: f.fields,
                        })
                    )
                );
            try {
                await mount();
                const assertRetained = () => {
                    const select = host.querySelector('select');
                    assert.equal(select.multiple, true);
                    assert.deepEqual(
                        new Set(
                            [...select.selectedOptions].map((o) => o.value)
                        ),
                        new Set(['Other', 'Standard'])
                    );
                    assert.equal(select.disabled, kind === 'readonly');
                    assert.deepEqual(
                        f.fields.controller.getState().draft,
                        before
                    );
                };
                assertRetained();
                await act(async () => root.unmount());
                root = createRoot(host);
                await mount();
                assertRetained();
                await act(async () =>
                    host.querySelector('form').dispatchEvent(
                        new window.Event('submit', {
                            bubbles: true,
                            cancelable: true,
                        })
                    )
                );
                assert.equal(f.calls.length, 1);
                assert.deepEqual(f.calls[0].formRecord, {
                    type: 'create',
                    data: before.data,
                });
                assert.deepEqual(
                    f.calls[0].formFieldIdsWithUnsavedChanges,
                    before.dirtyFieldIds
                );
                if (kind === 'readonly') {
                    await act(async () => {
                        const select = host.querySelector('select');
                        for (const option of select.options)
                            option.selected = option.value === 'Standard';
                        refresh(select);
                        select.dispatchEvent(
                            new window.Event('change', { bubbles: true })
                        );
                    });
                    assert.deepEqual(
                        f.fields.controller.getState().draft,
                        before
                    );
                } else {
                    // A retained deleted/renamed value may remain selected.
                    // Remove it through the actual control before testing new admission.
                    await act(async () => {
                        const select = host.querySelector('select');
                        for (const option of select.options)
                            option.selected = option.value === 'Standard';
                        refresh(select);
                        select.dispatchEvent(
                            new window.Event('change', { bubbles: true })
                        );
                    });
                    assert.deepEqual(
                        f.fields.field('fld_request_type').getSnapshot().value,
                        ['Standard']
                    );
                    assert.equal(
                        f.fields
                            .field('fld_request_type')
                            .selection.canChoose(['Other']),
                        false
                    );
                    assert.equal(
                        [...host.querySelector('select').options].some(
                            (option) => option.value === 'Other'
                        ),
                        false,
                        'Removed unknown names are not offered as new choices'
                    );
                    assert.equal(f.calls.length, 1);
                }
                checks += 5;
            } finally {
                await act(async () => root.unmount());
                f.close();
                host.remove();
            }
        }
        // Keep the actual old DOM host and its callback across configuration replacement.
        {
            const f = fixture('one-page'),
                host = window.document.createElement('div');
            window.document.body.append(host);
            const root = createRoot(host);
            try {
                await act(async () =>
                    root.render(
                        createElement(MultipleSelectRequestForm, {
                            scope: f.scope,
                            fields: f.fields,
                        })
                    )
                );
                const select = host.querySelector('select'),
                    before = structuredClone(
                        f.fields.controller.getState().draft
                    ),
                    retained = f.scope.getSnapshot().actions;
                f.replaceConfiguration();
                await act(async () => {
                    for (const option of select.options)
                        option.selected = option.value === 'Other';
                    refresh(select);
                    select.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                });
                assert.deepEqual(f.fields.controller.getState().draft, before);
                await assert.rejects(retained.submit());
                assert.equal(f.scope.getSnapshot().retired, true);
                assert.equal(f.calls.length, 0);
                assert.equal(f.attempts, 0);
                checks++;
            } finally {
                await act(async () => root.unmount());
                f.close();
                host.remove();
            }
        }
        return { checks };
    } finally {
        await window.happyDOM.abort();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else delete globalThis[key];
        });
    }
}
