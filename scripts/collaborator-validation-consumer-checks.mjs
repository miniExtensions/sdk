import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const allowed = {
    id: 'usr_allowed',
    name: 'Synthetic allowed',
    email: 'allowed@example.test',
    profilePicUrl: 'https://images.example.test/allowed.png',
};
const second = {
    id: 'usr_second',
    name: 'Synthetic second',
    email: 'second@example.test',
};
const legacy = {
    id: 'usr_legacy',
    name: 'Synthetic retained',
    email: 'legacy@example.test',
};
const unknown = {
    id: 'usr_unknown',
    name: 'Synthetic unknown',
    email: 'unknown@example.test',
};
const saveOptions = {
    captchaVal: null,
    isComputeMode: false,
    searchQuery: { retained: 'synthetic' },
    context: { type: 'direct-url' },
    conditionalLinkedRecordFieldIdsToFilteringValues: {},
};
const nativeFor = (type, person) =>
    type === 'singleCollaborator' ? person : [person];
const emptyFor = (type) => (type === 'singleCollaborator' ? null : []);
const schema = (id, type, choices, miniExtConfig = {}) => ({
    fieldType: type,
    airtableField: {
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type,
            options:
                choices === undefined
                    ? {}
                    : { choices: structuredClone(choices) },
        },
    },
    miniExtConfig,
});
const gateSchema = {
    fieldType: 'singleLineText',
    airtableField: {
        id: 'gate',
        name: 'Gate',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'singleLineText', options: null },
    },
    miniExtConfig: {},
};

/** Actual installed public entrypoints, synthetic native values and transport; no directory lookup. */
export async function checkCollaboratorValidationConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const base = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const esm = Object.fromEntries(
        await Promise.all(
            ['forms', 'ui', 'react', 'runtime'].map(async (name) => [
                name,
                await import(pathToFileURL(join(base, name, 'index.js'))),
            ])
        )
    );
    const cjs = Object.fromEntries(
        ['forms', 'ui', 'react', 'runtime'].map((name) => [
            name,
            require(
                `@miniextensions/sdk${name === 'runtime' ? '' : '/' + name}`
            ),
        ])
    );
    let checks = 0;
    const groups = [];
    const checked = (name) => {
        checks++;
        groups.push(name);
    };
    function make(api, options = {}) {
        const {
            type = 'singleCollaborator',
            stored = emptyFor(type),
            readOnly = false,
            hidden = false,
            required = false,
            multiPage = false,
        } = options;
        const choices = Object.hasOwn(options, 'choices')
            ? options.choices
            : [allowed, second];
        const draft = Object.hasOwn(options, 'draft') ? options.draft : stored;
        const loaded = fixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        loaded.payload.hasParentExtension = false;
        loaded.payload.fieldIdsInForm = ['answer', 'gate'];
        const mini = { readOnly, required };
        if (hidden)
            mini.conditionalFields = {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'synthetic-hide',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'singleLineText',
                            idOrName: { type: 'id', id: 'gate' },
                            value: 'show',
                        },
                    },
                ],
            };
        loaded.payload.fieldIdsToSchemas = {
            answer: schema('answer', type, choices, mini),
            gate: structuredClone(gateSchema),
        };
        if (multiPage)
            loaded.payload.fieldIdsToSchemas.gate.miniExtConfig.headerSectionTitle =
                'Final page';
        loaded.payload.formRecord = {
            type: 'create',
            data: {
                answer: structuredClone(stored),
                gate: 'no',
                unrendered: { text: 'retained native' },
            },
        };
        loaded.payload.formFieldIdsWithUnsavedChanges = ['unrendered'];
        loaded.payload.urlPrefilledFieldIds = [];
        loaded.payload.publicFields = {
            type: 'form',
            state: {
                multiPageFormMode: multiPage ? 'multi-page' : 'one-page',
                promptUserBeforeSubmission: false,
                enableFormComputeMode: false,
                autoSubmitAfterPrefill: false,
            },
        };
        let scope = { ownerId: 'A', revision: 0 },
            config = 0,
            predicate = () => true;
        const calls = [],
            io = [],
            journal = new api.forms.RecoveryJournal();
        let attempts = 0;
        const recoveryScope = {
            owner: 'A',
            parentFieldId: 'synthetic',
            tableId: 'tbl_synthetic',
            childExtensionId: '',
            context: 'modal',
        };
        const lifecycle = {
            dispatch() {
                attempts++;
                const attempt = journal.begin(
                    recoveryScope,
                    'rec_synthetic',
                    'save',
                    1
                );
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
        const client = api.runtime.createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            session: { visitor: 'A' },
            fetch: async () => {
                io.push('unexpected');
                throw Error('No directory or network lookup');
            },
        });
        client.forms.save = async (input) => {
            calls.push(structuredClone(input));
            return { type: 'error', formValidationErrors: [], formErrors: {} };
        };
        const store = new api.forms.FormDraftStore();
        store.open(
            { extensionId: loaded.extensionId, recordId: null, parent: null },
            {
                ...loaded.payload.formRecord.data,
                answer: structuredClone(draft),
            },
            loaded.payload.formFieldIdsWithUnsavedChanges
        );
        const fields = api.forms.createFormFieldBindings({
            client,
            loaded,
            store,
            getScope: () => scope,
            saveOptions,
        });
        const pages = api.forms.createFormPageOwner({
            fields,
            isCurrent: () => predicate(),
            configurationRevision: () => config,
        });
        return {
            loaded,
            fields,
            pages,
            client,
            calls,
            io,
            lifecycle,
            journal,
            recoveryScope,
            get attempts() {
                return attempts;
            },
            setPredicate: (value) => {
                predicate = value;
            },
            retire: (reason) => {
                if (reason === 'owner') scope = { ownerId: 'B', revision: 1 };
                else if (reason === 'configuration') config++;
                else if (reason === 'session')
                    client.setSession({ visitor: 'B' });
            },
            config: () => config,
            destroy: () => {
                pages.dispose();
                fields.destroy();
            },
        };
    }
    const assertNoDispatch = (f) => {
        assert.equal(f.calls.length, 0);
        assert.equal(f.attempts, 0);
        assert.deepEqual(f.journal.unknown('A'), []);
        assert.equal(
            f.journal.blocking(f.recoveryScope, 'rec_synthetic'),
            undefined
        );
        assert.deepEqual(f.io, []);
    };
    const assertEnvelope = (f, value, dirty = ['unrendered', 'answer']) =>
        assert.deepEqual(f.calls, [
            {
                ...saveOptions,
                extensionAccessToken: f.loaded.payload.extensionAccessToken,
                formRecord: {
                    ...f.loaded.payload.formRecord,
                    data: {
                        ...f.loaded.payload.formRecord.data,
                        answer: value,
                    },
                },
                formFieldIdsWithUnsavedChanges: dirty,
            },
        ]);
    for (const [name, api] of [
        ['ESM', esm],
        ['CJS', cjs],
    ]) {
        for (const type of ['singleCollaborator', 'multipleCollaborators']) {
            const value =
                type === 'singleCollaborator'
                    ? {
                          ...allowed,
                          name: 'Native display retained',
                          email: 'not-an-email',
                          extraNativeMetadata: { retained: true },
                      }
                    : [
                          second,
                          {
                              ...allowed,
                              name: 'Native display retained',
                              email: 'not-an-email',
                              extraNativeMetadata: { retained: true },
                          },
                          second,
                      ];
            const f = make(api, { type });
            try {
                assert.equal(f.pages.getSnapshot().canSubmit, true);
                assert.equal(
                    f.fields.field('answer').setValue(value).accepted,
                    true
                );
                assert.deepEqual(
                    f.fields.field('answer').getSnapshot().value,
                    value
                );
                assert.equal(
                    f.fields.field('answer').getSnapshot().dirty,
                    true
                );
                assert.deepEqual(f.pages.getSnapshot().problems, []);
                await f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: f.lifecycle,
                });
                assertEnvelope(f, value);
                assert.equal(f.attempts, 1);
                assert.deepEqual(f.io, []);
                checked(
                    `${name}: ${type} loaded choice full-native metadata/order/duplicate Save`
                );
            } finally {
                f.destroy();
            }
            const retained = make(api, {
                type,
                stored: nativeFor(type, legacy),
                draft: nativeFor(type, {
                    ...legacy,
                    email: 'display-only',
                    name: 'Changed metadata, exact retained ID',
                }),
            });
            try {
                assert.deepEqual(retained.pages.getSnapshot().problems, []);
                await retained.pages.submit(
                    retained.pages.getSnapshot().revision,
                    { lifecycle: retained.lifecycle }
                );
                assertEnvelope(
                    retained,
                    nativeFor(type, {
                        ...legacy,
                        email: 'display-only',
                        name: 'Changed metadata, exact retained ID',
                    }),
                    ['unrendered']
                );
                assert.deepEqual(retained.io, []);
                checked(`${name}: ${type} legacy ID excluded from choices`);
            } finally {
                retained.destroy();
            }
            for (const [label, draft, choices, code] of [
                [
                    'unknown ID',
                    nativeFor(type, unknown),
                    [allowed],
                    'invalid-selection',
                ],
                [
                    'exact ID whitespace mismatch',
                    nativeFor(type, { ...allowed, id: ' usr_allowed' }),
                    [allowed],
                    'invalid-selection',
                ],
                [
                    'missing ID',
                    nativeFor(type, {
                        email: allowed.email,
                        name: allowed.name,
                    }),
                    [allowed],
                    'invalid-selection',
                ],
                [
                    'numeric ID',
                    nativeFor(type, { id: 7 }),
                    [allowed],
                    'invalid-selection',
                ],
                ['bare ID', 'usr_allowed', [allowed], 'invalid-selection'],
                [
                    'wrong container',
                    type === 'singleCollaborator' ? [allowed] : allowed,
                    [allowed],
                    'invalid-selection',
                ],
                [
                    'missing choices',
                    nativeFor(type, allowed),
                    undefined,
                    'invalid-metadata',
                ],
                [
                    'malformed choices',
                    nativeFor(type, allowed),
                    [{ name: 'No ID' }],
                    'invalid-metadata',
                ],
            ]) {
                const sample = make(api, { type, draft, choices });
                try {
                    assert.deepEqual(sample.pages.getSnapshot().problems, [
                        { fieldId: 'answer', code },
                    ]);
                    assert.equal(sample.pages.getSnapshot().canSubmit, false);
                    await assert.rejects(
                        sample.pages.submit(
                            sample.pages.getSnapshot().revision,
                            { lifecycle: sample.lifecycle }
                        ),
                        {
                            reason:
                                code === 'invalid-metadata'
                                    ? 'blocked'
                                    : 'validation',
                        }
                    );
                    assert.deepEqual(
                        sample.fields.field('answer').getSnapshot().value,
                        draft
                    );
                    assertNoDispatch(sample);
                    checked(`${name}: ${type} ${label} refuses dispatch`);
                } finally {
                    sample.destroy();
                }
            }
            for (const policy of ['hidden', 'readOnly']) {
                const sample = make(api, {
                    type,
                    draft: nativeFor(type, unknown),
                    [policy]: true,
                });
                try {
                    if (policy === 'hidden')
                        assert.equal(
                            sample.fields.field('answer').getSnapshot()
                                .visibility.type,
                            'hidden'
                        );
                    else
                        assert.equal(
                            sample.fields.field('answer').getSnapshot()
                                .readOnly,
                            true
                        );
                    assert.deepEqual(sample.pages.getSnapshot().problems, [
                        { fieldId: 'answer', code: 'invalid-selection' },
                    ]);
                    await assert.rejects(
                        sample.pages.submit(
                            sample.pages.getSnapshot().revision,
                            { lifecycle: sample.lifecycle }
                        )
                    );
                    assertNoDispatch(sample);
                    checked(`${name}: ${type} ${policy} unknown still invalid`);
                } finally {
                    sample.destroy();
                }
            }
            for (const empty of [
                null,
                undefined,
                '',
                ...(type === 'multipleCollaborators' ? [[]] : []),
            ]) {
                const sample = make(api, { type, draft: empty, choices: null });
                try {
                    assert.deepEqual(sample.pages.getSnapshot().problems, []);
                    assert.equal(sample.pages.getSnapshot().canSubmit, true);
                    assertNoDispatch(sample);
                    checked(
                        `${name}: ${type} canonical empty skips choice metadata`
                    );
                } finally {
                    sample.destroy();
                }
            }
            for (const policy of ['visible', 'hidden', 'readOnly']) {
                const sample = make(api, {
                    type,
                    draft: emptyFor(type),
                    choices: null,
                    required: true,
                    hidden: policy === 'hidden',
                    readOnly: policy === 'readOnly',
                });
                try {
                    assert.deepEqual(
                        sample.pages.getSnapshot().problems,
                        policy === 'visible'
                            ? [{ fieldId: 'answer', code: 'required' }]
                            : []
                    );
                    assert.equal(
                        sample.pages.getSnapshot().canSubmit,
                        policy !== 'visible'
                    );
                    if (policy === 'visible')
                        await assert.rejects(
                            sample.pages.submit(
                                sample.pages.getSnapshot().revision,
                                { lifecycle: sample.lifecycle }
                            )
                        );
                    assertNoDispatch(sample);
                    checked(
                        `${name}: ${type} required empty ${policy} preserves existing exemption`
                    );
                } finally {
                    sample.destroy();
                }
            }
            const cleared = make(api, {
                type,
                stored: nativeFor(type, legacy),
            });
            try {
                const empty = emptyFor(type);
                assert.equal(
                    cleared.fields.field('answer').setValue(empty).accepted,
                    true
                );
                assert.deepEqual(cleared.pages.getSnapshot().problems, []);
                await cleared.pages.submit(
                    cleared.pages.getSnapshot().revision,
                    { lifecycle: cleared.lifecycle }
                );
                assertEnvelope(cleared, empty);
                checked(`${name}: ${type} explicit native clear Save`);
            } finally {
                cleared.destroy();
            }
        }
        for (const reason of ['owner', 'configuration', 'session']) {
            const sample = make(api, { multiPage: true });
            try {
                const nextRevision = sample.pages.getSnapshot().revision;
                const capturedNext = () => sample.pages.next(nextRevision);
                assert.equal(capturedNext().accepted, true);
                const submitRevision = sample.pages.getSnapshot().revision;
                const capturedSubmit = () =>
                    sample.pages.submit(submitRevision, {
                        lifecycle: sample.lifecycle,
                    });
                sample.retire(reason);
                assert.equal(capturedNext().accepted, false);
                await assert.rejects(capturedSubmit());
                assert.equal(sample.pages.getSnapshot().status, 'retired');
                assertNoDispatch(sample);
                checked(`${name}: ${reason} retires captured Next/Submit`);
            } finally {
                sample.destroy();
            }
        }
        for (const action of ['next', 'submit']) {
            const sample = make(api, { multiPage: true });
            try {
                if (action === 'submit')
                    assert.equal(
                        sample.pages.next(sample.pages.getSnapshot().revision)
                            .accepted,
                        true
                    );
                const revision = sample.pages.getSnapshot().revision;
                let armed = true,
                    ownershipChecks = 0,
                    replaced = false;
                sample.setPredicate(() => {
                    if (armed && ++ownershipChecks === 2) {
                        armed = false;
                        replaced = true;
                        assert.equal(
                            sample.fields.controller.write('answer', unknown),
                            true
                        );
                    }
                    return true;
                });
                if (action === 'next')
                    assert.equal(sample.pages.next(revision).accepted, false);
                else
                    await assert.rejects(
                        sample.pages.submit(revision, {
                            lifecycle: sample.lifecycle,
                        })
                    );
                assert.equal(replaced, true);
                assert.deepEqual(
                    sample.fields.field('answer').getSnapshot().value,
                    unknown
                );
                assert.deepEqual(sample.pages.getSnapshot().problems, [
                    { fieldId: 'answer', code: 'invalid-selection' },
                ]);
                assertNoDispatch(sample);
                checked(
                    `${name}: reentrant ${action} invalidates captured membership`
                );
            } finally {
                sample.destroy();
            }
        }
    }
    const { Window } = createRequire(import.meta.url)(
        happyDomModulePath ?? 'happy-dom'
    );
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
    const { createElement: h, StrictMode, act } = require('react');
    const { createRoot } = require('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container),
        f,
        renderScope;
    try {
        for (const reactType of [
            'singleCollaborator',
            'multipleCollaborators',
        ]) {
            f = make(esm, { type: reactType });
            renderScope = esm.ui.createFormRenderScope({
                fields: f.fields,
                pages: f.pages,
                isCurrent: () => true,
                configurationRevision: f.config,
            });
            let latest;
            const renderPerson = (props) =>
                h(
                    'section',
                    { 'data-field': props.fieldId },
                    h(
                        'span',
                        null,
                        (Array.isArray(props.value)
                            ? props.value
                                  .map((person) => person.name)
                                  .join(', ')
                            : props.value?.name) || 'Empty collaborator'
                    ),
                    h(
                        'button',
                        {
                            type: 'button',
                            onClick: () => {
                                assert.equal(props.capability.type, 'editable');
                                assert.equal(
                                    props.capability.setValue(
                                        nativeFor(reactType, unknown)
                                    ).accepted,
                                    true
                                );
                            },
                        },
                        'Set unknown'
                    ),
                    h(
                        'button',
                        {
                            type: 'button',
                            onClick: () => {
                                assert.equal(props.capability.type, 'editable');
                                assert.equal(
                                    props.capability.setValue(
                                        nativeFor(reactType, allowed)
                                    ).accepted,
                                    true
                                );
                            },
                        },
                        'Set allowed'
                    )
                );
            const tree = () =>
                h(
                    StrictMode,
                    null,
                    h(esm.react.AirtableForm, {
                        scope: renderScope,
                        renderers: {
                            renderSingleCollaboratorField: renderPerson,
                            renderMultipleCollaboratorsField: renderPerson,
                            renderSingleLineTextField: (props) =>
                                h('span', null, props.value),
                        },
                        children: (state) => {
                            latest = state;
                            return h(
                                'main',
                                null,
                                ...state.fields.map((field) => field.node),
                                h(
                                    'p',
                                    { role: 'status' },
                                    state.page.problems
                                        .map((problem) => problem.code)
                                        .join(', ')
                                )
                            );
                        },
                    })
                );
            await act(async () => root.render(tree()));
            assertNoDispatch(f);
            assert.match(container.textContent, /Empty collaborator/);
            const capturedSubmit = latest.actions.submit;
            await act(async () => container.querySelector('button').click());
            assert.match(container.textContent, /invalid-selection/);
            assert.match(container.textContent, /Synthetic unknown/);
            assert.deepEqual(
                f.fields.field('answer').getSnapshot().value,
                nativeFor(reactType, unknown)
            );
            await assert.rejects(capturedSubmit({ lifecycle: f.lifecycle }));
            await assert.rejects(
                latest.actions.submit({ lifecycle: f.lifecycle })
            );
            assertNoDispatch(f);
            checked(
                `React: ${reactType} actual AirtableForm/custom slot edit yields membership feedback`
            );
            await act(async () => root.unmount());
            root = createRoot(container);
            await act(async () => root.render(tree()));
            assert.match(container.textContent, /invalid-selection/);
            assert.deepEqual(
                f.fields.field('answer').getSnapshot().value,
                nativeFor(reactType, unknown)
            );
            assertNoDispatch(f);
            checked(
                `React: ${reactType} remount retains invalid native value without I/O`
            );
            await act(async () =>
                container.querySelectorAll('button')[1].click()
            );
            assert.doesNotMatch(
                container.querySelector('[role=status]').textContent,
                /invalid-selection/
            );
            assert.deepEqual(
                f.fields.field('answer').getSnapshot().value,
                nativeFor(reactType, allowed)
            );
            assertNoDispatch(f);
            await act(async () =>
                latest.actions.submit({ lifecycle: f.lifecycle })
            );
            assertEnvelope(f, nativeFor(reactType, allowed));
            assert.equal(f.attempts, 1);
            assert.deepEqual(f.io, []);
            checked(
                `React: ${reactType} fresh manual Submit preserves allowed native metadata and envelope`
            );
            await act(async () => root.unmount());
            renderScope.destroy();
            f.destroy();
            renderScope = null;
            f = null;
            root = createRoot(container);
        }
    } finally {
        await act(async () => root.unmount());
        renderScope?.destroy();
        f?.destroy();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else delete globalThis[key];
        });
        await window.happyDOM.close();
    }
    return { checks, groups };
}
