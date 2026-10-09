import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import {
    conditionalField,
    conditionalRule,
} from '../test/fixtures/conditionalPageValidationCases.mjs';

export async function checkConditionalPageValidationConsumer({
    consumerDirectory,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const imports = await Promise.all(
        ['forms', 'runtime', 'react', 'ui'].map(
            (name) => import(pathToFileURL(join(esm, name, 'index.js')))
        )
    );
    const oracle = JSON.parse(
        readFileSync('test/fixtures/conditionalPageValidation.json', 'utf8')
    );
    const guideSource = [
        ...readFileSync(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/docs/field-bindings.md'
            ),
            'utf8'
        ).matchAll(/```tsx\n([\s\S]*?)\n```/g),
    ]
        .map((match) => match[1])
        .find((source) => source.includes('export function CustomForm('));
    assert(guideSource, 'Missing shipped CustomForm recipe');
    const guideModule = { exports: {} };
    const guideCode = (
        await transform(guideSource, {
            loader: 'tsx',
            format: 'cjs',
            jsx: 'automatic',
        })
    ).code;
    new Function('require', 'module', 'exports', guideCode)(
        require,
        guideModule,
        guideModule.exports
    );
    const { CustomForm } = guideModule.exports;
    let checks = 0;
    for (const [forms, runtime, reactApi, ui] of [
        imports,
        [
            require('@miniextensions/sdk/forms'),
            require('@miniextensions/sdk'),
            require('@miniextensions/sdk/react'),
            require('@miniextensions/sdk/ui'),
        ],
    ]) {
        const fixtures = [];
        const make = (
            c = oracle.validation.find((c) => c.name === 'text-false')
        ) => {
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            const schemas = structuredClone(c.schemas);
            schemas.driver.miniExtConfig.conditionalFields = conditionalRule(
                'is',
                'never-show',
                'singleLineText',
                { type: 'id', id: 'target' }
            );
            schemas.later = conditionalField('later', 'singleLineText', {
                headerSectionTitle: 'Later',
            });
            if (c.hidden)
                schemas.target.miniExtConfig.conditionalFields =
                    conditionalRule('is', 'show');
            Object.assign(loaded.payload, {
                hasParentExtension: false,
                // Refused dependencies still belong to the returned schema/native
                // record. They need no editable control (which would independently
                // reject a deliberately malformed value before this rule runs).
                fieldIdsInForm:
                    c.comparison === 'refusal'
                        ? ['target', 'later']
                        : ['target', 'later', 'driver'],
                fieldIdsToSchemas: schemas,
                formRecord: {
                    type: 'create',
                    data: {
                        ...structuredClone(c.data),
                        later: 'Later',
                        native: { text: 'retained' },
                    },
                },
                formFieldIdsWithUnsavedChanges: ['native'],
                urlPrefilledFieldIds: [],
                publicFields: {
                    type: 'form',
                    state: {
                        multiPageFormMode: 'multi-page',
                        promptUserBeforeSubmission: false,
                        enableFormComputeMode: false,
                        autoSubmitAfterPrefill: false,
                    },
                },
            });
            let config = 0,
                scope = { ownerId: 'synthetic-owner', revision: 0 },
                predicate = () => true;
            const calls = [];
            let fetchAttempts = 0;
            const client = runtime.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                session: { visitor: 'synthetic' },
                fetch: async () => {
                    fetchAttempts++;
                    throw Error('Unexpected request');
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
                loaded.payload.formRecord.data,
                ['native']
            );
            const fields = forms.createFormFieldBindings({
                client,
                loaded,
                store,
                getScope: () => scope,
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    searchQuery: { retained: 'exact' },
                    context: { type: 'direct-url' },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            const pages = forms.createFormPageOwner({
                fields,
                isCurrent: () => predicate(),
                configurationRevision: () => config,
            });
            const f = {
                loaded,
                calls,
                get fetchAttempts() {
                    return fetchAttempts;
                },
                fields,
                pages,
                setConfig: (value) => {
                    config = value;
                },
                setScope: (value) => {
                    scope = value;
                },
                setPredicate: (value) => {
                    predicate = value;
                },
            };
            fixtures.push(f);
            return f;
        };
        const problems = (f) =>
            f.pages
                .getSnapshot()
                .problems.filter((p) => p.fieldId === 'target');
        const journal = (f) => {
            let attempts = 0;
            const recovery = new forms.RecoveryJournal();
            const scope = {
                owner: 'synthetic-owner',
                parentFieldId: null,
                tableId: null,
                childExtensionId: f.loaded.extensionId,
                context: 'direct-url',
            };
            const lifecycle = {
                dispatch: () => {
                    attempts++;
                    const attempt = recovery.begin(scope, null, 'save', 1);
                    return {
                        accepted: () =>
                            recovery.accepted(attempt, 'validation-error'),
                        finish: () => recovery.finishFlight(attempt),
                    };
                },
            };
            // Keep the journal empty: validation must precede any lifecycle callback.
            return {
                recovery,
                scope,
                lifecycle,
                get attempts() {
                    return attempts;
                },
            };
        };
        try {
            for (const c of oracle.validation) {
                const f = make(c);
                const actual = problems(f);
                assert.deepEqual(
                    actual,
                    c.expectedCode
                        ? [{ fieldId: 'target', code: c.expectedCode }]
                        : [],
                    c.name
                );
                if (c.comparison === 'parity') {
                    assert.equal(c.canonical.type, 'result', c.name);
                    assert.equal(
                        actual.length > 0,
                        c.canonical.invalid,
                        c.name
                    );
                }
                assert.equal(
                    JSON.stringify(actual).includes('Synthetic custom text'),
                    false
                );
                assert.equal(f.calls.length, 0);
                if (actual.length) {
                    const j = journal(f);
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision, {
                            lifecycle: j.lifecycle,
                        })
                    );
                    assert.equal(j.attempts, 0);
                    assert.equal(f.calls.length, 0);
                    assert.equal(j.recovery.blocking(j.scope, null), undefined);
                }
                checks++;
            }
            {
                const f = make();
                const initial = f.pages.getSnapshot();
                assert.equal(
                    f.fields.field('driver').getSnapshot().value,
                    'deny'
                );
                assert.equal(
                    f.fields.field('driver').getSnapshot().visibility.type,
                    'hidden'
                );
                assert.equal(f.pages.next(initial.revision).accepted, false);
                assert(f.fields.controller.write('driver', 'allow'));
                assert.deepEqual(problems(f), []);
                assert.equal(f.pages.next(initial.revision).accepted, false);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.fields.controller.write('driver', 'deny'));
                assert.deepEqual(problems(f), [
                    { fieldId: 'target', code: 'conditional-validation' },
                ]);
                const j = journal(f);
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: j.lifecycle,
                    })
                );
                assert.equal(j.attempts, 0);
                assert.equal(f.calls.length, 0);
                assert(f.fields.controller.write('driver', 'allow'));
                const successJournal = journal(f);
                const freshOptions = {
                    captchaVal: 'synthetic-fresh-captcha',
                    isComputeMode: false,
                    searchQuery: { fresh: 'exact' },
                    context: { type: 'direct-url' },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {
                        driver: { retained: 'synthetic' },
                    },
                };
                await f.pages.submit(f.pages.getSnapshot().revision, {
                    options: freshOptions,
                    lifecycle: successJournal.lifecycle,
                });
                assert.equal(successJournal.attempts, 1);
                assert.equal(
                    successJournal.recovery.blocking(
                        successJournal.scope,
                        null
                    ),
                    undefined
                );
                assert.equal(f.calls.length, 1);
                assert.deepEqual(f.calls[0], {
                    ...freshOptions,
                    extensionAccessToken: f.loaded.payload.extensionAccessToken,
                    formRecord: {
                        type: 'create',
                        data: {
                            target: 'Answer',
                            driver: 'allow',
                            later: 'Later',
                            native: { text: 'retained' },
                        },
                    },
                    formFieldIdsWithUnsavedChanges: ['native', 'driver'],
                });
                checks++;
            }
            for (const mode of [
                'config',
                'owner',
                'aba',
                'owner-aba',
                'reentrant',
            ]) {
                const f = make(
                    oracle.validation.find((c) => c.name === 'text-true')
                );
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                const old = f.pages.getSnapshot().revision;
                if (mode === 'config') f.setConfig(1);
                if (mode === 'owner')
                    f.setScope({ ownerId: 'other', revision: 1 });
                if (mode === 'aba') {
                    f.setConfig(1);
                    f.pages.getSnapshot();
                    f.setConfig(0);
                }
                if (mode === 'owner-aba') {
                    f.setScope({ ownerId: 'other', revision: 1 });
                    f.fields.controller.getState();
                    f.setScope({ ownerId: 'synthetic-owner', revision: 0 });
                }
                if (mode === 'reentrant') {
                    let once = false;
                    f.pages.subscribe(() => {
                        if (!once) {
                            once = true;
                            f.fields.controller.write('driver', 'deny');
                        }
                    });
                    assert(
                        f.fields.field('target').setValue('Changed').accepted
                    );
                }
                const j = journal(f);
                await assert.rejects(
                    f.pages.submit(old, { lifecycle: j.lifecycle })
                );
                assert.equal(f.calls.length, 0);
                assert.equal(j.attempts, 0);
                checks++;
            }
            {
                const f = make(
                    oracle.validation.find((c) => c.name === 'text-true')
                );
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                let armed = false,
                    checksOfOwner = 0;
                f.setPredicate(() => {
                    if (armed && ++checksOfOwner === 2)
                        f.fields.controller.write('driver', 'deny');
                    return true;
                });
                const revision = f.pages.getSnapshot().revision,
                    j = journal(f);
                armed = true;
                await assert.rejects(
                    f.pages.submit(revision, { lifecycle: j.lifecycle })
                );
                assert(checksOfOwner >= 2);
                assert.deepEqual(problems(f), [
                    { fieldId: 'target', code: 'conditional-validation' },
                ]);
                assert.equal(j.attempts, 0);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = make();
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
                        value:
                            key === 'IS_REACT_ACT_ENVIRONMENT'
                                ? true
                                : window[key],
                    })
                );
                const { createElement: h, StrictMode, act } = require('react');
                const { createRoot } = require('react-dom/client');
                const scope = ui.createFormRenderScope({
                    fields: f.fields,
                    pages: f.pages,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                const host = window.document.createElement('div');
                window.document.body.append(host);
                let root = createRoot(host),
                    last,
                    mounted = false;
                const tree = () =>
                    h(
                        StrictMode,
                        null,
                        h(reactApi.AirtableForm, {
                            scope,
                            renderers: {
                                renderSingleLineTextField: (p) =>
                                    h('output', null, p.value),
                            },
                            children: (state) => {
                                last = state;
                                return h(
                                    'section',
                                    null,
                                    ...state.fields.map((field) =>
                                        h(
                                            'div',
                                            { key: field.fieldId },
                                            field.node
                                        )
                                    ),
                                    h(
                                        'output',
                                        { id: 'feedback' },
                                        JSON.stringify(state.page.problems)
                                    ),
                                    h(
                                        'button',
                                        {
                                            type: 'button',
                                            onClick: () => state.actions.next(),
                                        },
                                        'Next'
                                    )
                                );
                            },
                        })
                    );
                try {
                    await act(async () => root.render(tree()));
                    mounted = true;
                    assert(
                        host
                            .querySelector('#feedback')
                            .textContent.includes('conditional-validation')
                    );
                    const stale = last.actions.next;
                    await act(async () => {
                        assert(f.fields.controller.write('driver', 'allow'));
                    });
                    assert.equal(stale().accepted, false);
                    await act(async () => root.unmount());
                    mounted = false;
                    root = createRoot(host);
                    await act(async () => root.render(tree()));
                    mounted = true;
                    assert.equal(
                        f.fields.field('driver').getSnapshot().value,
                        'allow'
                    );
                    assert.equal(f.calls.length, 0);
                    await act(async () => {
                        assert(last.actions.next().accepted);
                    });
                    const staleSave = last.actions.submit;
                    await act(async () => {
                        assert(f.fields.controller.write('driver', 'deny'));
                    });
                    await assert.rejects(staleSave());
                    await assert.rejects(last.actions.submit());
                    assert.equal(f.calls.length, 0);
                    checks++;
                    await act(async () => root.unmount());
                    mounted = false;
                    const recipeCase = structuredClone(
                        oracle.validation.find((c) => c.name === 'text-false')
                    );
                    recipeCase.data.driver = 'PRIVATE_HIDDEN_DRIVER_VALUE';
                    recipeCase.schemas.driver.airtableField.name =
                        'PRIVATE_HIDDEN_DRIVER_TITLE';
                    recipeCase.schemas.target.miniExtConfig.customErrorMessageForFieldValidation =
                        'PRIVATE_CONFIGURED_VALIDATION_MESSAGE';
                    const recipeFixture = make(recipeCase);
                    const recipeJournal = journal(recipeFixture);
                    const recipeScope = ui.createFormRenderScope({
                        fields: recipeFixture.fields,
                        pages: recipeFixture.pages,
                        isCurrent: () => true,
                        configurationRevision: () => 0,
                        saveOptions: { lifecycle: recipeJournal.lifecycle },
                    });
                    root = createRoot(host);
                    try {
                        const recipeTree = () =>
                            h(
                                StrictMode,
                                null,
                                h(CustomForm, {
                                    scope: recipeScope,
                                    formatPageProblem: ({ fieldId, code }) =>
                                        fieldId === 'target' &&
                                        code === 'conditional-validation'
                                            ? 'Answer: Check this answer before continuing.'
                                            : 'Check this Form before continuing.',
                                    renderers: {
                                        renderSingleLineTextField: (p) =>
                                            h('output', null, p.value),
                                    },
                                })
                            );
                        await act(async () => root.render(recipeTree()));
                        mounted = true;
                        const button = (text) =>
                            [...host.querySelectorAll('button')].find(
                                (node) => node.textContent === text
                            );
                        const feedback = () =>
                            host.querySelector('li[data-field-id="target"]');
                        const assertPrivate = () => {
                            for (const text of [
                                'PRIVATE_HIDDEN_DRIVER_VALUE',
                                'PRIVATE_HIDDEN_DRIVER_TITLE',
                                'PRIVATE_CONFIGURED_VALIDATION_MESSAGE',
                            ])
                                assert.equal(
                                    host.outerHTML.includes(text),
                                    false,
                                    'Feedback must not reveal hidden data or configured messages'
                                );
                        };
                        assert.equal(
                            feedback()?.textContent,
                            'Answer: Check this answer before continuing.',
                            'The actual shipped recipe must explain its blocked actions'
                        );
                        assertPrivate();
                        assert.equal(button('Next').disabled, true);
                        assert.equal(button('Submit').disabled, true);
                        button('Next').click();
                        button('Submit').click();
                        assert.equal(recipeFixture.calls.length, 0);
                        assert.equal(recipeFixture.fetchAttempts, 0);
                        assert.equal(recipeJournal.attempts, 0);
                        await act(async () => {
                            assert(
                                recipeFixture.fields.controller.write(
                                    'driver',
                                    'allow'
                                )
                            );
                        });
                        assert.equal(feedback(), null);
                        assert.equal(button('Next').disabled, false);
                        await act(async () => button('Next').click());
                        assert.equal(button('Submit').disabled, false);
                        await act(async () => {
                            assert(
                                recipeFixture.fields.controller.write(
                                    'driver',
                                    'deny'
                                )
                            );
                        });
                        assert.equal(
                            feedback()?.textContent,
                            'Answer: Check this answer before continuing.'
                        );
                        assertPrivate();
                        assert.equal(button('Submit').disabled, true);
                        await act(async () => root.unmount());
                        mounted = false;
                        root = createRoot(host);
                        await act(async () => root.render(recipeTree()));
                        mounted = true;
                        assert.equal(
                            recipeFixture.fields.controller.getState().draft
                                .data.driver,
                            'deny'
                        );
                        assert.equal(button('Submit').disabled, true);
                        assert.equal(recipeFixture.calls.length, 0);
                        assert.equal(recipeFixture.fetchAttempts, 0);
                        assert.equal(recipeJournal.attempts, 0);
                        assert.equal(
                            feedback()?.textContent,
                            'Answer: Check this answer before continuing.'
                        );
                        assertPrivate();
                        await act(async () => {
                            assert(
                                recipeFixture.fields.controller.write(
                                    'driver',
                                    'allow'
                                )
                            );
                        });
                        assert.equal(feedback(), null);
                        assert.equal(button('Submit').disabled, false);
                        await act(async () => button('Submit').click());
                        assert.equal(recipeFixture.calls.length, 1);
                        assert.equal(recipeJournal.attempts, 1);
                        assert.deepEqual(recipeFixture.calls[0], {
                            captchaVal: null,
                            isComputeMode: false,
                            searchQuery: { retained: 'exact' },
                            context: { type: 'direct-url' },
                            conditionalLinkedRecordFieldIdsToFilteringValues:
                                {},
                            extensionAccessToken:
                                recipeFixture.loaded.payload
                                    .extensionAccessToken,
                            formRecord: {
                                type: 'create',
                                data: {
                                    target: 'Answer',
                                    driver: 'allow',
                                    later: 'Later',
                                    native: { text: 'retained' },
                                },
                            },
                            formFieldIdsWithUnsavedChanges: [
                                'native',
                                'driver',
                            ],
                        });
                        assert.equal(recipeFixture.fetchAttempts, 0);
                        checks++;
                    } finally {
                        if (mounted) await act(async () => root.unmount());
                        mounted = false;
                        recipeScope.destroy();
                    }
                } finally {
                    if (mounted) await act(async () => root.unmount());
                    scope.destroy();
                    host.remove();
                    await window.happyDOM.abort();
                    keys.forEach((key, i) => {
                        if (previous[i])
                            Object.defineProperty(globalThis, key, previous[i]);
                        else delete globalThis[key];
                    });
                }
            }
        } finally {
            fixtures.forEach((f) => {
                f.pages.dispose();
                f.fields.destroy();
            });
            fixtures.forEach((f) =>
                assert.equal(
                    f.fetchAttempts,
                    0,
                    'Mount/render/validation must perform zero reads'
                )
            );
        }
    }
    return checks;
}
