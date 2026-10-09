import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
export const formPageTypedConsumer = `
import { createFormPageOwner, FormPageError, type FormFieldBindings, type FormPageOwner, type FormPageSnapshot, type FormPageAction, type FormSaveLifecycle } from '@miniextensions/sdk/forms';
declare const fields: FormFieldBindings;
declare const lifecycle: FormSaveLifecycle;
const owner: FormPageOwner = createFormPageOwner({fields, isCurrent: () => true, configurationRevision: () => 0});
const state: FormPageSnapshot = owner.getSnapshot();
const action: FormPageAction = owner.next(state.revision);
const save: ReturnType<FormFieldBindings['save']> = owner.submit(state.revision, {lifecycle});
const stop: () => void = owner.subscribe(snapshot => { const ids: string[] = snapshot.currentFieldIds; void ids; });
// @ts-expect-error revision must be numeric
owner.back('stale');
// @ts-expect-error an observed configuration revision is required
createFormPageOwner({fields, isCurrent: () => true});
// @ts-expect-error page navigation is not a native record writer
owner.setValue({a:'replacement'});
void [action, save, stop, FormPageError];
`;
/** Actual stock/custom React consumers share the retained owner across page mounts. */
async function checkPageRendererRemount(f, reactApi, consumer) {
    const { Window } = createRequire(import.meta.url)('happy-dom');
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
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
    const { createElement, StrictMode, act } = consumer('react');
    const { createRoot } = consumer('react-dom/client');
    const host = window.document.createElement('div');
    window.document.body.append(host);
    let root = createRoot(host),
        mounted = false;
    const tree = () =>
        createElement(
            StrictMode,
            null,
            createElement(reactApi.TextField, { binding: f.fields.field('b') }),
            createElement(reactApi.TextField, {
                binding: f.fields.field('b'),
                render: ({ snapshot, binding }) =>
                    createElement(
                        'section',
                        null,
                        createElement('input', {
                            'aria-label': 'Custom page answer',
                            disabled: !snapshot.canEdit,
                            value: snapshot.value,
                            onChange: (event) =>
                                binding.setValue(event.currentTarget.value),
                        }),
                        createElement(
                            'button',
                            {
                                type: 'button',
                                disabled: !snapshot.canEdit,
                                onClick: () =>
                                    assert(
                                        binding.setValue('Retained page answer')
                                            .accepted
                                    ),
                            },
                            'Edit custom page answer'
                        )
                    ),
            })
        );
    const assertViews = () => {
        const inputs = [...host.querySelectorAll('input')];
        assert.equal(inputs.length, 2);
        inputs.forEach((input) =>
            assert.equal(input.value, 'Retained page answer')
        );
    };
    try {
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        await act(async () => {
            root.render(tree());
        });
        mounted = true;
        await act(async () => {
            host.querySelector('button').click();
        });
        assertViews();
        await act(async () => root.unmount());
        mounted = false;
        assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
        assert.equal(
            f.fields.field('b').getSnapshot().value,
            'Retained page answer'
        );
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        root = createRoot(host);
        await act(async () => root.render(tree()));
        mounted = true;
        assertViews();
        assert.equal(f.fields.field('b').getSnapshot().dirty, true);
        assert.equal(f.calls.length, 0);
    } finally {
        if (mounted) await act(async () => root.unmount());
        host.remove();
        await window.happyDOM.abort();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else delete globalThis[key];
        });
    }
}
/** Installed package, renderer-independent synthetic transport only. */
export async function checkFormPageConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const esmForms = await import(pathToFileURL(join(esm, 'forms/index.js')));
    const esmRuntime = await import(
        pathToFileURL(join(esm, 'runtime/index.js'))
    );
    let checks = 0;
    const esmReact = await import(pathToFileURL(join(esm, 'react/index.js')));
    for (const [forms, runtime, reactApi] of [
        [esmForms, esmRuntime, esmReact],
        [
            require('@miniextensions/sdk/forms'),
            require('@miniextensions/sdk'),
            require('@miniextensions/sdk/react'),
        ],
    ]) {
        const make = (configure = () => {}) => {
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            loaded.payload.hasParentExtension = false;
            const field = (id, mini = {}) => ({
                fieldType: 'singleLineText',
                airtableField: {
                    id,
                    name: id,
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: { type: 'singleLineText', options: null },
                },
                miniExtConfig: mini,
            });
            loaded.payload.fieldIdsInForm = ['a', 'b', 'c'];
            loaded.payload.fieldIdsToSchemas = {
                a: field('a'),
                b: field('b', { headerSectionTitle: 'Second' }),
                c: field('c', { headerSectionTitle: 'Third' }),
            };
            loaded.payload.formRecord = {
                type: 'create',
                data: {
                    a: 'A',
                    b: 'B',
                    c: 'C',
                    unrendered: { text: 'native' },
                },
            };
            loaded.payload.formFieldIdsWithUnsavedChanges = ['unrendered'];
            loaded.payload.urlPrefilledFieldIds = [];
            loaded.payload.publicFields = { type: 'form', state: {} };
            Object.assign(loaded.payload.publicFields.state, {
                multiPageFormMode: 'multi-page',
                promptUserBeforeSubmission: false,
                enableFormComputeMode: false,
                autoSubmitAfterPrefill: false,
            });
            const seed = configure(loaded);
            let scope = { ownerId: 'A', revision: 0 },
                config = 0,
                predicate = () => true;
            const calls = [];
            const client = runtime.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                session: { visitor: 'A' },
                fetch: async () => {
                    throw Error('No request');
                },
            });
            client.forms.save = async (input) => {
                calls.push(structuredClone(input));
                return {
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                };
            };
            const store = new forms.FormDraftStore();
            store.open(
                {
                    extensionId: loaded.extensionId,
                    recordId: null,
                    parent: null,
                },
                seed?.data ?? loaded.payload.formRecord.data,
                loaded.payload.formFieldIdsWithUnsavedChanges
            );
            const fields = forms.createFormFieldBindings({
                client,
                loaded,
                store,
                getScope: () => scope,
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: seed?.isComputeMode ?? false,
                    searchQuery: { kept: 'exact' },
                    context: { type: 'direct-url' },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            const pages = forms.createFormPageOwner({
                fields,
                isCurrent: () => predicate(),
                configurationRevision: () => config,
            });
            return {
                loaded,
                client,
                calls,
                fields,
                pages,
                setPredicate: (fn) => (predicate = fn),
                setConfig: (v) => (config = v),
                setScope: (v) => (scope = v),
            };
        };
        const fixtures = [];
        const fixture = (fn) => {
            const f = make(fn);
            fixtures.push(f);
            return f;
        };
        try {
            {
                const f = fixture();
                const first = f.pages.getSnapshot();
                assert.deepEqual(
                    first.pages.map((p) => p.fieldIds),
                    [['a'], ['b'], ['c']]
                );
                const stock = f.pages.subscribe(() => {}),
                    custom = f.pages.subscribe(() => {});
                stock();
                custom();
                f.fields.field('b').setValue('Changed');
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
                assert.equal(
                    f.fields.field('b').getSnapshot().value,
                    'Changed'
                );
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert.equal(f.calls.length, 0);
                await f.pages.submit(f.pages.getSnapshot().revision);
                assert.equal(f.calls.length, 1);
                assert.deepEqual(f.calls[0].formRecord.data, {
                    a: 'A',
                    b: 'Changed',
                    c: 'C',
                    unrendered: { text: 'native' },
                });
                assert.deepEqual(f.calls[0].formFieldIdsWithUnsavedChanges, [
                    'unrendered',
                    'b',
                ]);
                assert.deepEqual(f.calls[0].searchQuery, { kept: 'exact' });
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.b.miniExtConfig.enableSectionHeader = false;
                });
                assert.deepEqual(
                    f.pages.getSnapshot().pages.map((p) => p.fieldIds),
                    [['a', 'b'], ['c']]
                );
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.publicFields.state.multiPageFormMode = 'one-page';
                });
                assert.equal(f.pages.getSnapshot().pages.length, 1);
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsInForm = [];
                    p.payload.fieldIdsToSchemas = {};
                });
                assert.equal(f.pages.getSnapshot().status, 'all-hidden');
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision),
                    { reason: 'no-page' }
                );
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.b.miniExtConfig.required = true;
                });
                f.fields.field('b').setValue('');
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert.deepEqual(f.pages.next(f.pages.getSnapshot().revision), {
                    accepted: false,
                    reason: 'validation',
                });
                assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture();
                const before = f.pages.getSnapshot().revision;
                f.setConfig(1);
                assert.equal(f.pages.getSnapshot().status, 'retired');
                f.setConfig(0);
                assert.deepEqual(f.pages.next(before), {
                    accepted: false,
                    reason: 'retired',
                });
                assert(f.fields.field('a').setValue('Live').accepted);
                checks++;
            }
            {
                const f = fixture();
                const before = f.pages.getSnapshot().revision;
                f.setScope({ ownerId: 'B', revision: 1 });
                assert.equal(f.pages.getSnapshot().status, 'retired');
                f.setScope({ ownerId: 'A', revision: 2 });
                assert.deepEqual(f.pages.next(before), {
                    accepted: false,
                    reason: 'retired',
                });
                checks++;
            }
            {
                const f = fixture();
                f.pages.dispose();
                assert(f.fields.field('a').setValue('Still owned').accepted);
                assert.equal(f.pages.getSnapshot().status, 'retired');
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.publicFields.state.promptUserBeforeSubmission = true;
                });
                assert.equal(f.pages.getSnapshot().status, 'blocked');
                assert.equal(
                    f.pages.next(f.pages.getSnapshot().revision).accepted,
                    false
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture();
                let reentered = false;
                f.pages.subscribe((s) => {
                    if (s.activePageIndex === 1 && !reentered) {
                        reentered = true;
                        f.setConfig(1);
                    }
                });
                assert.deepEqual(f.pages.next(f.pages.getSnapshot().revision), {
                    accepted: false,
                    reason: 'retired',
                });
                assert(
                    f.fields.field('a').setValue('Unchanged owner').accepted
                );
                checks++;
            }
            {
                const f = fixture();
                f.pages.next(f.pages.getSnapshot().revision);
                f.pages.next(f.pages.getSnapshot().revision);
                let resolve;
                f.client.forms.save = async (input) => {
                    f.calls.push(input);
                    return new Promise((r) => (resolve = r));
                };
                const saving = f.pages.submit(f.pages.getSnapshot().revision);
                assert.equal(f.pages.getSnapshot().canSubmit, false);
                assert.equal(f.pages.getSnapshot().canBack, false);
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(f.calls.length, 1);
                resolve({
                    type: 'error',
                    formErrors: {},
                    formValidationErrors: [],
                });
                await saving;
                checks++;
            }
            {
                const f = fixture();
                f.pages.next(f.pages.getSnapshot().revision);
                f.pages.next(f.pages.getSnapshot().revision);
                let resolve;
                f.client.forms.save = async (input) => {
                    f.calls.push(input);
                    return new Promise((r) => (resolve = r));
                };
                const journal = new forms.RecoveryJournal();
                const scope = {
                    owner: 'A',
                    parentFieldId: null,
                    tableId: null,
                    childExtensionId: 'form',
                    context: 'direct-url',
                };
                let attempt;
                const saving = f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: {
                        dispatch() {
                            attempt = journal.begin(scope, null, 'save', 1);
                            return {
                                accepted() {
                                    journal.accepted(
                                        attempt,
                                        'validation-error'
                                    );
                                },
                                finish() {
                                    journal.finishFlight(attempt);
                                },
                            };
                        },
                    },
                });
                f.fields.controller.cancel();
                resolve({
                    type: 'error',
                    formErrors: {},
                    formValidationErrors: [],
                });
                await assert.rejects(saving);
                assert.equal(f.calls.length, 1);
                assert.equal(journal.blocking(scope, null) != null, true);
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(f.calls.length, 1);
                const recovered = await f.fields.reload({
                    dirty: 'keep',
                    read: async () => f.loaded,
                });
                assert.equal(recovered, true);
                const replacement = forms.createFormPageOwner({
                    fields: f.fields,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                assert.equal(replacement.getSnapshot().status, 'ready');
                const stop = replacement.subscribe(() => {});
                stop();
                assert.equal(
                    f.calls.length,
                    1,
                    'Reload and renderer remount never replay uncertain Save'
                );
                assert.equal(journal.blocking(scope, null) != null, true);
                assert.equal(f.pages.getSnapshot().status, 'retired');
                replacement.dispose();
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.c.fieldType =
                        'singleCollaborator';
                    p.payload.fieldIdsToSchemas.c.airtableField.config = {
                        type: 'singleCollaborator',
                        options: {},
                    };
                    p.payload.formRecord.data.c = {
                        id: 'usr_synthetic',
                        email: 'synthetic@example.test',
                        name: 'Synthetic',
                    };
                });
                assert.equal(f.pages.getSnapshot().status, 'ready');
                assert.equal(
                    f.pages.next(f.pages.getSnapshot().revision).accepted,
                    true
                );
                assert.equal(
                    f.pages.next(f.pages.getSnapshot().revision).accepted,
                    true
                );
                assert.equal(f.pages.getSnapshot().status, 'blocked');
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.a.miniExtConfig.required = true;
                });
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.fields.field('a').setValue('').accepted);
                assert.equal(f.pages.getSnapshot().canSubmit, false);
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.a.miniExtConfig = {
                        required: true,
                        readOnly: true,
                        characterLimit: 1,
                    };
                    p.payload.formRecord.data.a = '';
                    p.payload.fieldIdsToSchemas.b.miniExtConfig.required = true;
                    p.payload.formRecord.data.b = '';
                });
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert.equal(
                    f.pages.next(f.pages.getSnapshot().revision).accepted,
                    false
                );
                const native = structuredClone(
                    f.fields.controller.getState().draft.data
                );
                assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
                assert.deepEqual(
                    f.fields.controller.getState().draft.data,
                    native
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                for (const flag of [
                    'promptUserBeforeSubmission',
                    'enableFormComputeMode',
                    'autoSubmitAfterPrefill',
                ]) {
                    const f = fixture((p) => {
                        p.payload.publicFields.state[flag] = true;
                    });
                    assert.equal(f.pages.getSnapshot().status, 'blocked');
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision)
                    );
                    assert.equal(f.calls.length, 0);
                }
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.c.fieldType =
                        'multipleRecordLinks';
                    p.payload.fieldIdsToSchemas.c.airtableField.config = {
                        type: 'multipleRecordLinks',
                        options: {
                            linkedTableId: 'tbl_children',
                            isReversed: false,
                            prefersSingleRecordLink: false,
                        },
                    };
                    p.payload.formRecord.data.c = ['rec_child'];
                    p.payload.fieldIdsToSchemas.c.miniExtConfig.requireOpenLinkedRecords = true;
                });
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert.equal(f.pages.getSnapshot().status, 'blocked');
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture();
                const revision = f.pages.getSnapshot().revision;
                f.setPredicate(() => {
                    f.pages.dispose();
                    return true;
                });
                assert.deepEqual(f.pages.next(revision), {
                    accepted: false,
                    reason: 'retired',
                });
                assert(
                    f.fields.field('a').setValue('Shared owner remains')
                        .accepted
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture();
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        isCurrent: () => {
                            f.pages.dispose();
                            return true;
                        },
                    })
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.a.fieldType = 'multipleSelects';
                    p.payload.fieldIdsToSchemas.a.airtableField.config = {
                        type: 'multipleSelects',
                        options: {
                            choices: [{ id: 'sel_alpha', name: 'Alpha' }],
                        },
                    };
                    p.payload.fieldIdsToSchemas.a.miniExtConfig = {
                        allowAddingNewOptions: true,
                    };
                    p.payload.formRecord.data.a = ['Alpha'];
                });
                let addCalls = 0;
                f.client.forms.addSelectOption = async () => {
                    addCalls++;
                    return { newChoice: { id: 'sel_beta', name: 'Beta' } };
                };
                const creator = f.fields.selectChoice('a', {
                    journal: new forms.RecoveryJournal(),
                    scope: {
                        owner: 'A',
                        parentFieldId: null,
                        tableId: null,
                        childExtensionId: f.loaded.extensionId,
                        context: 'direct-url',
                    },
                    loadVersion: 1,
                });
                assert.equal(await creator.create('Beta'), true);
                assert.equal(f.pages.getSnapshot().status, 'ready');
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert.equal(addCalls, 1);
                assert.equal(f.calls.length, 0);
                assert.deepEqual(f.fields.field('a').getSnapshot().value, [
                    'Alpha',
                    'Beta',
                ]);
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.b.airtableField.isComputed = true;
                    p.payload.fieldIdsToSchemas.b.miniExtConfig = {
                        headerSectionTitle: 'Second',
                        requireOpenLinkedRecords: true,
                    };
                });
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(
                    f.pages
                        .getSnapshot()
                        .problems.some(
                            (p) =>
                                p.fieldId === 'b' &&
                                p.code === 'unsupported-validation'
                        )
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            for (const inherited of [false, true]) {
                const f = fixture(() => ({ isComputeMode: inherited }));
                while (f.pages.getSnapshot().canNext)
                    assert(
                        f.pages.next(f.pages.getSnapshot().revision).accepted
                    );
                let attempts = 0;
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        options: inherited
                            ? undefined
                            : {
                                  captchaVal: null,
                                  isComputeMode: true,
                                  searchQuery: { kept: 'exact' },
                                  context: { type: 'direct-url' },
                                  conditionalLinkedRecordFieldIdsToFilteringValues:
                                      {},
                              },
                        lifecycle: {
                            dispatch() {
                                attempts++;
                                return { accepted() {}, finish() {} };
                            },
                        },
                    }),
                    { reason: 'blocked' }
                );
                assert.equal(attempts, 0);
                assert.equal(f.calls.length, 0);
                assert.equal(f.fields.controller.getState().status, 'ready');
                checks++;
            }
            {
                const f = fixture();
                await checkPageRendererRemount(f, reactApi, require);
                checks++;
            }
            const oracle = JSON.parse(
                readFileSync('test/fixtures/formPages.json', 'utf8')
            );
            const support = JSON.parse(
                readFileSync(
                    'test/fixtures/formPageValidationSupport.json',
                    'utf8'
                )
            );
            const classified = [
                ...support.canonicalComparison,
                ...support.unsupportedValidation,
            ];
            assert.equal(new Set(classified).size, classified.length);
            assert.deepEqual(
                classified.toSorted(),
                oracle.validation.map((c) => c.name).toSorted()
            );
            for (const c of oracle.validation) {
                const f = fixture((p) => {
                    p.payload.fieldIdsInForm = ['fld_answer'];
                    p.payload.fieldIdsToSchemas = {
                        fld_answer: structuredClone(c.schema),
                    };
                    p.payload.formRecord.data = { fld_answer: c.stored };
                    if (c.hidden) {
                        p.payload.fieldIdsToSchemas.gate = {
                            fieldType: 'singleLineText',
                            airtableField: {
                                id: 'gate',
                                name: 'gate',
                                description: null,
                                isComputed: false,
                                isPrimaryField: false,
                                config: {
                                    type: 'singleLineText',
                                    options: null,
                                },
                            },
                            miniExtConfig: {},
                        };
                        p.payload.fieldIdsToSchemas.fld_answer.miniExtConfig.conditionalFields =
                            {
                                logicalOperator: 'and',
                                conditions: [
                                    {
                                        id: 'hide',
                                        type: 'singleCondition',
                                        setting: {
                                            type: 'is',
                                            fieldType: 'singleLineText',
                                            idOrName: {
                                                type: 'id',
                                                id: 'gate',
                                            },
                                            value: 'yes',
                                        },
                                    },
                                ],
                            };
                    }
                    return { data: { fld_answer: c.value, gate: 'no' } };
                });
                const problems = f.pages
                    .getSnapshot()
                    .problems.filter((p) => p.fieldId === 'fld_answer');
                if (support.unsupportedValidation.includes(c.name))
                    assert.deepEqual(problems, [
                        {
                            fieldId: 'fld_answer',
                            code: 'unsupported-validation',
                        },
                    ]);
                else
                    assert.equal(
                        problems.length > 0,
                        c.invalid,
                        c.name + ': ' + JSON.stringify(problems)
                    );
                checks++;
            }
            console.log(
                `Installed Form page owner: ${checks} checks; local navigation and synthetic Save only.`
            );
        } finally {
            for (const f of fixtures) {
                f.pages.dispose();
                f.fields.destroy();
            }
        }
    }
    return checks;
}
