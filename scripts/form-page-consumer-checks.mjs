import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
export const formPageTypedConsumer = `
import { createFormPageOwner, FormPageError, type FormFieldBindings, type FormPageOwner, type FormPageSnapshot, type FormPageAction, type FormSaveLifecycle, type FormPageReviewRequest, type FormPageReviewDecision } from '@miniextensions/sdk/forms';
declare const fields: FormFieldBindings;
declare const lifecycle: FormSaveLifecycle;
const owner: FormPageOwner = createFormPageOwner({fields, isCurrent: () => true, configurationRevision: () => 0});
const reviewOwner = createFormPageOwner({fields, isCurrent: () => true, configurationRevision: () => 0,
    review: async (request: FormPageReviewRequest): Promise<FormPageReviewDecision> => {
        const signal: AbortSignal = request.signal;
        const current: boolean = request.isCurrent();
        const revision: number = request.revision;
        void [signal, current, revision, request.loaded, request.draft.data, request.draft.dirtyFieldIds];
        return {type: 'confirm', isCurrent: () => true};
    }});
const pendingFiles: boolean = fields.hasPendingFiles();
const reviewing: boolean = reviewOwner.getSnapshot().reviewing;
const canReview: boolean = reviewOwner.getSnapshot().canReview;
const cancelled: FormPageError = new FormPageError('review-cancelled');
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
void [action, save, stop, FormPageError, reviewing, canReview, cancelled, pendingFiles];
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
    const esmUi = await import(pathToFileURL(join(esm, 'ui/index.js')));
    const esmReact = await import(pathToFileURL(join(esm, 'react/index.js')));
    for (const [forms, runtime, reactApi, ui] of [
        [esmForms, esmRuntime, esmReact, esmUi],
        [
            require('@miniextensions/sdk/forms'),
            require('@miniextensions/sdk'),
            require('@miniextensions/sdk/react'),
            require('@miniextensions/sdk/ui'),
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
                canWriteField: (id) => seed?.canWriteField?.(id) ?? true,
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: seed?.isComputeMode ?? false,
                    searchQuery: { kept: 'exact' },
                    context: { type: 'direct-url' },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            seed?.beforePages?.(fields);
            const pages = forms.createFormPageOwner({
                fields,
                isCurrent: () => predicate(),
                configurationRevision: () => config,
                review: seed?.review,
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
                const f = fixture();
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                const guide = readFileSync('docs/forms.md', 'utf8');
                const code = guide.match(
                    /function renderPage\(snapshot: FormPageSnapshot\) \{[\s\S]*?\n\}\nconst unsubscribe = pages.subscribe\(renderPage\);/
                )?.[0];
                assert(
                    code,
                    'Extract the shipped guide callback implementation'
                );
                let actions;
                let attempts = 0;
                const renderPage = new Function(
                    'pages',
                    'lifecycle',
                    'renderPages',
                    code.replace('snapshot: FormPageSnapshot', 'snapshot') +
                        '\nreturn { renderPage, unsubscribe };'
                )(
                    f.pages,
                    {
                        dispatch() {
                            attempts++;
                            return { accepted() {}, finish() {} };
                        },
                    },
                    (_snapshot, renderedActions) => {
                        actions = renderedActions;
                    }
                );
                renderPage.renderPage(f.pages.getSnapshot());
                const retainedSubmit = actions.submit;
                assert(
                    f.fields.field('b').setValue('Native edit after render')
                        .accepted
                );
                await assert.rejects(retainedSubmit(), {
                    reason: 'stale-revision',
                });
                await assert.rejects(retainedSubmit(), {
                    reason: 'stale-revision',
                });
                assert.equal(attempts, 0);
                assert.equal(
                    f.calls.length,
                    0,
                    'Retained guide Submit never saves or replays'
                );
                renderPage.unsubscribe();
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.b.miniExtConfig.required = true;
                });
                const received = [[], []];
                let edited = false;
                f.pages.subscribe((snapshot) => {
                    received[0].push(snapshot);
                    if (snapshot.activePageIndex === 1 && !edited) {
                        edited = true;
                        assert(f.fields.field('b').setValue('').accepted);
                    }
                });
                f.pages.subscribe((snapshot) => received[1].push(snapshot));
                assert.deepEqual(f.pages.next(f.pages.getSnapshot().revision), {
                    accepted: false,
                    reason: 'stale-revision',
                });
                const newest = f.pages.getSnapshot();
                for (const snapshots of received) {
                    assert(snapshots.length > 0);
                    assert.deepEqual(snapshots.at(-1), newest);
                }
                assert.equal(received[0][0].canNext, true);
                assert.equal(newest.canNext, false);
                assert.equal(f.fields.field('b').getSnapshot().value, '');
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.a.miniExtConfig.required = true;
                });
                let armed = false;
                let edited = false;
                f.setPredicate(() => {
                    if (armed && !edited) {
                        edited = true;
                        assert.equal(f.fields.controller.write('a', ''), true);
                    }
                    return true;
                });
                const received = [[], []];
                f.pages.subscribe((snapshot) => received[0].push(snapshot));
                f.pages.subscribe((snapshot) => received[1].push(snapshot));
                const before = f.pages.getSnapshot();
                assert.equal(before.canNext, true);
                armed = true;
                const newest = f.pages.getSnapshot();
                assert(
                    edited,
                    'Snapshot ownership read edits the native draft once'
                );
                assert(newest.revision > before.revision);
                assert.equal(newest.canNext, false);
                for (const snapshots of received) {
                    assert(
                        snapshots.length > 0,
                        'Reentrant native edit during a snapshot read notifies every page listener'
                    );
                    assert.deepEqual(snapshots.at(-1), newest);
                }
                assert.deepEqual(f.pages.getSnapshot(), newest);
                assert.equal(f.fields.field('a').getSnapshot().value, '');
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                for (const subscriberCount of [0, 2]) {
                    const f = fixture();
                    let armed = false;
                    let ownershipChecks = 0;
                    f.setPredicate(() => {
                        if (armed) {
                            ownershipChecks++;
                            assert(
                                ownershipChecks <= 20,
                                'Continuously editing ownership predicate must not spin'
                            );
                            assert.equal(
                                f.fields.controller.write(
                                    'a',
                                    `Owner edit ${ownershipChecks}`
                                ),
                                true
                            );
                        }
                        return true;
                    });
                    const received = Array.from(
                        { length: subscriberCount },
                        () => []
                    );
                    received.forEach((snapshots) =>
                        f.pages.subscribe((snapshot) =>
                            snapshots.push(snapshot)
                        )
                    );
                    assert.equal(f.pages.getSnapshot().canNext, true);
                    armed = true;
                    const unstable = f.pages.getSnapshot();
                    assert(ownershipChecks > 0);
                    assert(
                        ownershipChecks <= 4,
                        'Snapshot read bounds ownership revalidation'
                    );
                    assert.equal(unstable.canNext, false);
                    assert.equal(unstable.canSubmit, false);
                    for (const snapshots of received) {
                        assert(snapshots.length > 0);
                        assert.deepEqual(snapshots.at(-1), unstable);
                    }
                    assert.equal(f.calls.length, 0);
                    const checksAfterRead = ownershipChecks;
                    await Promise.resolve();
                    assert.equal(
                        ownershipChecks,
                        checksAfterRead,
                        'Unstable snapshot never schedules an automatic retry'
                    );
                    armed = false;
                    const recovered = f.pages.getSnapshot();
                    assert.equal(recovered.canNext, true);
                    assert(recovered.revision > unstable.revision);
                    assert(
                        f.fields
                            .field('a')
                            .setValue('Ordinary edit after recovery').accepted
                    );
                    assert.equal(f.pages.getSnapshot().canNext, true);
                    assert.equal(
                        f.fields.field('a').getSnapshot().value,
                        'Ordinary edit after recovery'
                    );
                    assert.equal(f.calls.length, 0);
                }
                checks++;
            }
            {
                const f = fixture();
                let armed = false;
                let ownershipChecks = 0;
                f.setPredicate(() => {
                    if (armed) {
                        ownershipChecks++;
                        assert(ownershipChecks <= 20);
                        assert.equal(
                            f.fields.controller.write(
                                'a',
                                `Recovery edit ${ownershipChecks}`
                            ),
                            true
                        );
                    }
                    return true;
                });
                const received = [[], []];
                let recovered;
                f.pages.subscribe((snapshot) => {
                    received[0].push(snapshot);
                    if (armed && !snapshot.canNext) {
                        armed = false;
                        recovered = f.pages.getSnapshot();
                    }
                });
                f.pages.subscribe((snapshot) => received[1].push(snapshot));
                assert.equal(f.pages.getSnapshot().canNext, true);
                armed = true;
                const returned = f.pages.getSnapshot();
                assert(
                    recovered,
                    'First listener explicitly reads a recovered snapshot'
                );
                assert(ownershipChecks > 0 && ownershipChecks <= 4);
                assert.equal(received[0][0].canNext, false);
                assert.equal(recovered.canNext, true);
                assert(recovered.revision > received[0][0].revision);
                assert.deepEqual(returned, recovered);
                for (const snapshots of received) {
                    assert(snapshots.length > 0);
                    assert.deepEqual(
                        snapshots.at(-1),
                        recovered,
                        'Every listener converges after recovery inside the first listener'
                    );
                }
                assert.deepEqual(f.pages.getSnapshot(), recovered);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            for (const kind of ['number', 'date']) {
                const nativeValue = kind === 'number' ? 1 : '2024-01-01';
                const invalidInput = kind === 'number' ? '-' : '2024-02-30';
                const f = fixture((p) => {
                    const schema = p.payload.fieldIdsToSchemas.a;
                    schema.fieldType = kind;
                    schema.airtableField.config =
                        kind === 'number'
                            ? { type: 'number', options: { precision: 0 } }
                            : {
                                  type: 'date',
                                  options: {
                                      dateFormat: {
                                          name: 'iso',
                                          format: 'YYYY-MM-DD',
                                      },
                                  },
                              };
                    p.payload.formRecord.data.a = nativeValue;
                });
                let armed = false;
                let ownershipChecks = 0;
                let edited = false;
                f.setPredicate(() => {
                    if (armed && ++ownershipChecks === 2) {
                        edited = true;
                        const binding = f.fields.field('a');
                        const input =
                            kind === 'number' ? binding.scalar : binding.date;
                        assert(input, `${kind} uses its installed input model`);
                        assert.equal(input.setInput(invalidInput), false);
                    }
                    return true;
                });
                const received = [[], []];
                f.pages.subscribe((snapshot) => received[0].push(snapshot));
                f.pages.subscribe((snapshot) => received[1].push(snapshot));
                const before = f.pages.getSnapshot();
                const nativeBefore = structuredClone(
                    f.fields.controller.getState().draft.data
                );
                const draftRevision =
                    f.fields.controller.getState().draftRevision;
                assert.equal(before.canNext, true);
                armed = true;
                const action = f.pages.next(before.revision);
                assert(
                    edited,
                    `${kind} input changes after captured validation`
                );
                assert.equal(action.accepted, false);
                const newest = f.pages.getSnapshot();
                assert.equal(newest.activePageIndex, 0);
                assert.equal(newest.canNext, false);
                assert(newest.revision > before.revision);
                assert(
                    newest.problems.some(
                        (problem) =>
                            problem.fieldId === 'a' &&
                            problem.code === 'invalid-input'
                    )
                );
                for (const snapshots of received) {
                    assert(snapshots.length > 0);
                    assert.deepEqual(snapshots.at(-1), newest);
                }
                assert.equal(
                    f.fields.field('a').getSnapshot().value,
                    nativeValue
                );
                assert.deepEqual(
                    f.fields.controller.getState().draft.data,
                    nativeBefore
                );
                assert.equal(
                    f.fields.controller.getState().draftRevision,
                    draftRevision
                );
                assert.equal(f.calls.length, 0);
                assert.deepEqual(f.pages.next(newest.revision), {
                    accepted: false,
                    reason: 'validation',
                });
                assert.equal(f.calls.length, 0);
                checks++;
            }
            for (const kind of ['number', 'date']) {
                const nativeValue = kind === 'number' ? 1 : '2024-01-01';
                const f = fixture((p) => {
                    const schema = p.payload.fieldIdsToSchemas.a;
                    schema.fieldType = kind;
                    schema.airtableField.config =
                        kind === 'number'
                            ? { type: 'number', options: { precision: 0 } }
                            : {
                                  type: 'date',
                                  options: {
                                      dateFormat: {
                                          name: 'iso',
                                          format: 'YYYY-MM-DD',
                                      },
                                  },
                              };
                    p.payload.formRecord.data.a = nativeValue;
                });
                let armed = false;
                let ownershipChecks = 0;
                let capReached = false;
                f.setPredicate(() => {
                    if (armed) {
                        ownershipChecks++;
                        if (ownershipChecks > 20) {
                            capReached = true;
                            throw new Error(
                                'Raw input ownership revalidation sentinel'
                            );
                        }
                        const binding = f.fields.field('a');
                        const input =
                            kind === 'number' ? binding.scalar : binding.date;
                        const raw =
                            kind === 'number'
                                ? '-'.repeat(ownershipChecks)
                                : `2024-13-${String(ownershipChecks).padStart(2, '0')}`;
                        assert(input, `${kind} uses its installed input model`);
                        assert.equal(input.setInput(raw), false);
                    }
                    return true;
                });
                const received = [[], []];
                f.pages.subscribe((snapshot) => received[0].push(snapshot));
                f.pages.subscribe((snapshot) => received[1].push(snapshot));
                const before = f.pages.getSnapshot();
                const nativeBefore = structuredClone(
                    f.fields.controller.getState().draft.data
                );
                const draftRevision =
                    f.fields.controller.getState().draftRevision;
                assert.equal(before.canNext, true);
                armed = true;
                const unstable = f.pages.getSnapshot();
                assert.equal(
                    capReached,
                    false,
                    `${kind} snapshot returns before sentinel cap`
                );
                assert(ownershipChecks > 0 && ownershipChecks <= 4);
                assert.equal(unstable.canNext, false);
                assert.equal(unstable.canSubmit, false);
                assert.equal(unstable.activePageIndex, 0);
                for (const snapshots of received) {
                    assert(snapshots.length > 0 && snapshots.length <= 4);
                    assert.deepEqual(snapshots.at(-1), unstable);
                }
                assert.equal(
                    f.fields.field('a').getSnapshot().value,
                    nativeValue
                );
                assert.deepEqual(
                    f.fields.controller.getState().draft.data,
                    nativeBefore
                );
                assert.equal(
                    f.fields.controller.getState().draftRevision,
                    draftRevision
                );
                assert.equal(f.calls.length, 0);
                const checksAfterRead = ownershipChecks;
                await Promise.resolve();
                assert.equal(
                    ownershipChecks,
                    checksAfterRead,
                    'Raw input edits do not schedule retries'
                );
                ownershipChecks = 0;
                capReached = false;
                const action = f.pages.next(unstable.revision);
                assert.equal(action.accepted, false);
                assert.equal(
                    capReached,
                    false,
                    `${kind} Next refuses before sentinel cap`
                );
                assert(ownershipChecks > 0 && ownershipChecks <= 4);
                const latest = received[0].at(-1);
                assert.equal(latest.activePageIndex, 0);
                assert.equal(latest.canNext, false);
                assert.equal(latest.canSubmit, false);
                assert.deepEqual(received[1].at(-1), latest);
                assert.equal(
                    f.fields.field('a').getSnapshot().value,
                    nativeValue
                );
                assert.deepEqual(
                    f.fields.controller.getState().draft.data,
                    nativeBefore
                );
                assert.equal(
                    f.fields.controller.getState().draftRevision,
                    draftRevision
                );
                assert.equal(f.calls.length, 0);
                armed = false;
                checks++;
            }
            {
                let pages;
                let stop;
                const f = fixture(() => ({
                    beforePages(fields) {
                        stop = fields
                            .field('b')
                            .subscribe(() => pages?.getSnapshot());
                    },
                }));
                pages = f.pages;
                const received = [];
                pages.subscribe((snapshot) => received.push(snapshot));
                const before = pages.getSnapshot().revision;
                assert(
                    f.fields.field('b').setValue('Read before notification')
                        .accepted
                );
                assert(
                    received.length > 0,
                    'Earlier field subscriber reads do not consume page notifications'
                );
                assert.deepEqual(received.at(-1), pages.getSnapshot());
                assert(received.at(-1).revision > before);
                assert.equal(f.calls.length, 0);
                stop();
                checks++;
            }
            {
                const f = fixture((p) => {
                    p.payload.fieldIdsToSchemas.a.miniExtConfig.required = true;
                });
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                let armed = false;
                let ownershipChecks = 0;
                let edited = false;
                let attempts = 0;
                f.setPredicate(() => {
                    // The second ownership check follows validation of the captured draft.
                    if (armed && ++ownershipChecks === 2) {
                        edited = true;
                        assert.equal(f.fields.controller.write('a', ''), true);
                    }
                    return true;
                });
                const revision = f.pages.getSnapshot().revision;
                assert.equal(f.pages.getSnapshot().canSubmit, true);
                armed = true;
                await assert.rejects(
                    f.pages.submit(revision, {
                        lifecycle: {
                            dispatch() {
                                attempts++;
                                return { accepted() {}, finish() {} };
                            },
                        },
                    })
                );
                assert(
                    edited,
                    'Required answer changes during final page ownership check'
                );
                assert.equal(f.fields.field('a').getSnapshot().value, '');
                assert.equal(f.pages.getSnapshot().canSubmit, false);
                assert.equal(attempts, 0);
                assert.equal(f.calls.length, 0);
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(
                    f.calls.length,
                    0,
                    'Failed validation never replays Save'
                );
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
                const dispositions = [];
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
                                finish(disposition) {
                                    dispositions.push(disposition);
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
                assert.deepEqual(dispositions, ['dispatched']);
                assert.equal(attempt.outcome, 'unknown');
                assert.equal(attempt.flight, false);
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
            // Configured Review remains an explicit opt-in around the native Save.
            const reviewFixture = (review, configure = () => {}) =>
                fixture((p) => {
                    p.payload.publicFields.state.promptUserBeforeSubmission = true;
                    const seed = configure(p);
                    return { ...seed, review };
                });
            const finalPage = (f) => {
                while (f.pages.getSnapshot().canNext)
                    assert(
                        f.pages.next(f.pages.getSnapshot().revision).accepted
                    );
                assert.equal(f.pages.getSnapshot().activePageIndex, 2);
            };
            const trackedLifecycle = () => {
                const counts = { dispatch: 0, accepted: 0, finish: 0 };
                return {
                    counts,
                    lifecycle: {
                        dispatch() {
                            counts.dispatch++;
                            return {
                                accepted() {
                                    counts.accepted++;
                                },
                                finish() {
                                    counts.finish++;
                                },
                            };
                        },
                    },
                };
            };
            for (const callback of [
                'scope-native',
                'session-native',
                'scope-configuration',
            ]) {
                const f = fixture();
                let armed = false;
                let changed = false;
                let checksAfterHook = 0;
                let configurationEpoch = 0;
                let controller;
                const mutate = () => {
                    if (!armed) return;
                    checksAfterHook++;
                    assert(
                        checksAfterHook <= 20,
                        'Reentrant controller ownership checks are bounded'
                    );
                    if (changed) return;
                    changed = true;
                    if (callback === 'scope-configuration')
                        configurationEpoch++;
                    else assert.equal(controller.write('a', ''), true);
                };
                const getSession = f.client.getSession.bind(f.client);
                if (callback === 'session-native')
                    f.client.getSession = () => {
                        mutate();
                        return getSession();
                    };
                controller = forms.createFormController({
                    client: f.client,
                    loaded: f.loaded,
                    getScope() {
                        if (callback !== 'session-native') mutate();
                        return { ownerId: 'A', revision: 0 };
                    },
                    saveOptions: {
                        captchaVal: null,
                        isComputeMode: false,
                        searchQuery: { kept: 'exact' },
                        context: { type: 'direct-url' },
                        conditionalLinkedRecordFieldIdsToFilteringValues: {},
                    },
                });
                const counts = { dispatch: 0, accepted: 0, finish: [] };
                try {
                    await assert.rejects(
                        controller.save({
                            isCurrent: () => configurationEpoch === 0,
                            lifecycle: {
                                dispatch(input) {
                                    counts.dispatch++;
                                    assert.equal(input.formRecord.data.a, 'A');
                                    armed = true;
                                    return {
                                        accepted() {
                                            counts.accepted++;
                                        },
                                        finish(disposition) {
                                            counts.finish.push(disposition);
                                        },
                                    };
                                },
                            },
                        })
                    );
                    assert(
                        changed,
                        `${callback} changes captured input ownership after lifecycle`
                    );
                    assert(checksAfterHook > 0 && checksAfterHook <= 20);
                    assert.equal(f.calls.length, 0);
                    assert.deepEqual(counts, {
                        dispatch: 1,
                        accepted: 0,
                        finish: ['not-dispatched'],
                    });
                    if (callback !== 'scope-configuration')
                        assert.equal(controller.getState().draft.data.a, '');
                    checks++;
                } finally {
                    controller.destroy();
                }
            }
            // These checks execute against each installed ESM/CJS package above.
            for (const reviewed of [false, true]) {
                for (const mutation of ['native', 'configuration']) {
                    let armed = false;
                    let changed = false;
                    let request;
                    let f;
                    const configure = (p) => {
                        p.payload.fieldIdsToSchemas.a.miniExtConfig.required = true;
                        return {
                            canWriteField() {
                                if (armed && !changed) {
                                    changed = true;
                                    if (mutation === 'native')
                                        assert.equal(
                                            f.fields.controller.write('a', ''),
                                            true
                                        );
                                    else f.setConfig(1);
                                }
                                return true;
                            },
                        };
                    };
                    f = reviewed
                        ? reviewFixture(async (r) => {
                              request = r;
                              assert.equal(r.draft.data.a, 'A');
                              return { type: 'confirm', isCurrent: () => true };
                          }, configure)
                        : fixture(configure);
                    finalPage(f);
                    const journal = new forms.RecoveryJournal();
                    const scope = {
                        owner: 'A',
                        parentFieldId: null,
                        tableId: null,
                        childExtensionId: f.loaded.extensionId,
                        context: 'direct-url',
                    };
                    const counts = { dispatch: 0, accepted: 0, finish: [] };
                    let attempt;
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision, {
                            lifecycle: {
                                dispatch(input) {
                                    counts.dispatch++;
                                    assert.equal(input.formRecord.data.a, 'A');
                                    attempt = journal.begin(
                                        scope,
                                        null,
                                        'save',
                                        1
                                    );
                                    armed = true;
                                    return {
                                        accepted() {
                                            counts.accepted++;
                                        },
                                        finish(disposition) {
                                            counts.finish.push(disposition);
                                            if (
                                                disposition === 'not-dispatched'
                                            )
                                                assert.equal(
                                                    journal.notDispatched(
                                                        attempt
                                                    ),
                                                    true
                                                );
                                            else journal.finishFlight(attempt);
                                        },
                                    };
                                },
                            },
                        })
                    );
                    assert(
                        changed,
                        'First post-lifecycle field ownership check mutates once'
                    );
                    assert.equal(Boolean(request), reviewed);
                    assert.equal(
                        f.calls.length,
                        0,
                        `${mutation} known before transport never dispatches`
                    );
                    assert.deepEqual(counts, {
                        dispatch: 1,
                        accepted: 0,
                        finish: ['not-dispatched'],
                    });
                    assert.equal(attempt.outcome, 'not-dispatched');
                    assert.equal(attempt.flight, false);
                    assert.equal(journal.blocking(scope, null), undefined);
                    if (mutation === 'native')
                        assert.equal(
                            f.fields.controller.getState().draft.data.a,
                            ''
                        );
                    checks++;
                }
            }
            {
                let reviews = 0;
                const f = reviewFixture(async () => {
                    reviews++;
                    return { type: 'edit' };
                });
                assert.equal(f.pages.getSnapshot().status, 'ready');
                finalPage(f);
                const snapshot = f.pages.getSnapshot();
                assert.equal(snapshot.canReview, true);
                const tracked = trackedLifecycle();
                await assert.rejects(
                    f.pages.submit(snapshot.revision, {
                        lifecycle: tracked.lifecycle,
                    }),
                    { reason: 'review-cancelled' }
                );
                assert.equal(reviews, 1);
                assert.equal(f.pages.getSnapshot().reviewing, false);
                assert.equal(f.pages.getSnapshot().canReview, true);
                assert.equal(tracked.counts.dispatch, 0);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                let request;
                const f = reviewFixture(async (r) => {
                    request = r;
                    r.loaded.payload.formRecord.data.a =
                        'Detached loaded mutation';
                    r.loaded.payload.fieldIdsToSchemas.a.airtableField.name =
                        'Detached name';
                    r.draft.data.b = 'Detached draft mutation';
                    r.draft.dirtyFieldIds.push('detached');
                    return { type: 'confirm', isCurrent: () => true };
                });
                assert(f.fields.field('b').setValue('Native changed').accepted);
                finalPage(f);
                const snapshot = f.pages.getSnapshot();
                const native = structuredClone(
                    f.fields.controller.getState().draft.data
                );
                const dirty = [
                    ...f.fields.controller.getState().draft.dirtyFieldIds,
                ];
                const tracked = trackedLifecycle();
                await f.pages.submit(snapshot.revision, {
                    lifecycle: tracked.lifecycle,
                });
                assert.equal(request.revision, snapshot.revision);
                assert.equal(request.signal instanceof AbortSignal, true);
                assert.equal(f.calls.length, 1);
                assert.deepEqual(f.calls[0].formRecord.data, native);
                assert.deepEqual(
                    f.calls[0].formFieldIdsWithUnsavedChanges,
                    dirty
                );
                assert.equal(f.loaded.payload.formRecord.data.a, 'A');
                assert.equal(
                    f.loaded.payload.fieldIdsToSchemas.a.airtableField.name,
                    'a'
                );
                assert.equal(tracked.counts.dispatch, 1);
                assert.equal(tracked.counts.finish, 1);
                checks++;
            }
            for (const decision of ['edit', 'confirm']) {
                let reviews = 0;
                const f = reviewFixture(
                    async () => {
                        reviews++;
                        return decision === 'edit'
                            ? { type: 'edit' }
                            : { type: 'confirm', isCurrent: () => true };
                    },
                    (p) => {
                        p.payload.fieldIdsToSchemas.a.miniExtConfig.required = true;
                    }
                );
                finalPage(f);
                assert(f.fields.field('a').setValue('').accepted);
                assert.equal(f.pages.getSnapshot().canSubmit, false);
                assert.equal(f.pages.getSnapshot().canReview, true);
                const tracked = trackedLifecycle();
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: tracked.lifecycle,
                    }),
                    {
                        reason:
                            decision === 'edit'
                                ? 'review-cancelled'
                                : 'validation',
                    }
                );
                assert.equal(
                    reviews,
                    1,
                    'Required errors remain readable in Review'
                );
                assert.equal(tracked.counts.dispatch, 0);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            for (const kind of ['number', 'date']) {
                let reviews = 0;
                const f = reviewFixture(
                    async () => {
                        reviews++;
                        return { type: 'confirm', isCurrent: () => true };
                    },
                    (p) => {
                        const schema = p.payload.fieldIdsToSchemas.a;
                        schema.fieldType = kind;
                        schema.airtableField.config =
                            kind === 'number'
                                ? { type: 'number', options: { precision: 0 } }
                                : {
                                      type: 'date',
                                      options: {
                                          dateFormat: {
                                              name: 'iso',
                                              format: 'YYYY-MM-DD',
                                          },
                                      },
                                  };
                        p.payload.formRecord.data.a =
                            kind === 'number' ? 1 : '2024-01-01';
                    }
                );
                finalPage(f);
                const binding = f.fields.field('a');
                assert.equal(
                    (kind === 'number'
                        ? binding.scalar
                        : binding.date
                    ).setInput(kind === 'number' ? '-' : '2024-02-30'),
                    false
                );
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(
                    reviews,
                    0,
                    'Unfinished raw input cannot open prepared Review'
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            for (const cancel of ['edit', 'escape', 'abort']) {
                let release;
                let request;
                const f = reviewFixture((r) => {
                    request = r;
                    return new Promise((resolve) => {
                        release = resolve;
                    });
                });
                finalPage(f);
                const tracked = trackedLifecycle();
                const controller = new AbortController();
                const flight = f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: tracked.lifecycle,
                    signal: controller.signal,
                });
                await Promise.resolve(); // The adapter opens in its queued microtask.
                assert(request);
                assert.equal(f.pages.getSnapshot().reviewing, true);
                assert.equal(f.pages.getSnapshot().canBack, false);
                assert.equal(f.pages.getSnapshot().canNext, false);
                assert.equal(
                    f.pages.back(f.pages.getSnapshot().revision).accepted,
                    false
                );
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(tracked.counts.dispatch, 0);
                assert.equal(f.calls.length, 0);
                if (cancel === 'abort') controller.abort();
                else release({ type: 'edit' }); // Escape adapters also resolve Edit.
                await assert.rejects(flight, { reason: 'review-cancelled' });
                if (cancel === 'abort') {
                    assert.equal(request.signal.aborted, true);
                    release({ type: 'confirm', isCurrent: () => true });
                    await Promise.resolve();
                }
                assert.equal(f.pages.getSnapshot().reviewing, false);
                assert.equal(tracked.counts.dispatch, 0);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            for (const transition of [
                'native',
                'raw',
                'configuration',
                'owner',
                'presentation',
            ]) {
                let release;
                let request;
                let presentationRevision = 0;
                const capturedPresentationRevision = presentationRevision;
                const f = reviewFixture(
                    (r) => {
                        request = r;
                        return new Promise((resolve) => {
                            release = resolve;
                        });
                    },
                    (p) => {
                        if (transition === 'raw') {
                            p.payload.fieldIdsToSchemas.a.fieldType = 'number';
                            p.payload.fieldIdsToSchemas.a.airtableField.config =
                                { type: 'number', options: { precision: 0 } };
                            p.payload.formRecord.data.a = 1;
                        }
                    }
                );
                finalPage(f);
                const native = structuredClone(
                    f.fields.controller.getState().draft.data
                );
                const tracked = trackedLifecycle();
                const flight = f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: tracked.lifecycle,
                });
                await Promise.resolve(); // Mutate only after Review captures its request.
                assert(request);
                if (transition === 'native') {
                    assert(
                        f.fields.field('a').setValue('ABA changed').accepted
                    );
                    assert(f.fields.field('a').setValue(native.a).accepted);
                } else if (transition === 'raw') {
                    assert.equal(
                        f.fields.field('a').scalar.setInput('-'),
                        false
                    );
                    f.fields.field('a').scalar.setInput('1');
                } else if (transition === 'configuration') {
                    f.setConfig(1);
                    f.pages.getSnapshot();
                    f.setConfig(0);
                } else if (transition === 'owner') {
                    f.setScope({ ownerId: 'B', revision: 1 });
                    f.pages.getSnapshot();
                    f.setScope({ ownerId: 'A', revision: 2 });
                } else {
                    // A→B→A presentation retains a monotonic adapter epoch.
                    presentationRevision++;
                    presentationRevision++;
                }
                if (transition !== 'presentation')
                    assert.equal(request.isCurrent(), false);
                release({
                    type: 'confirm',
                    isCurrent: () =>
                        presentationRevision === capturedPresentationRevision,
                });
                await assert.rejects(flight);
                assert.equal(tracked.counts.dispatch, 0);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                let guardCalls = 0;
                const f = reviewFixture(async () => ({
                    type: 'confirm',
                    isCurrent: () => {
                        guardCalls++;
                        assert(guardCalls <= 8, 'Decision guard is bounded');
                        assert(
                            f.fields
                                .field('a')
                                .setValue(`Reentrant guard ${guardCalls}`)
                                .accepted
                        );
                        return true;
                    },
                }));
                finalPage(f);
                const tracked = trackedLifecycle();
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: tracked.lifecycle,
                    })
                );
                assert(guardCalls > 0 && guardCalls <= 4);
                assert.equal(tracked.counts.dispatch, 0);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                let release;
                let request;
                const f = reviewFixture((r) => {
                    request = r;
                    return new Promise((resolve) => {
                        release = resolve;
                    });
                });
                finalPage(f);
                const flight = f.pages.submit(f.pages.getSnapshot().revision);
                await Promise.resolve(); // Dispose an opened Review, preserving its late completion.
                assert(request);
                f.pages.dispose();
                const successor = forms.createFormPageOwner({
                    fields: f.fields,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                    review: async () => ({ type: 'edit' }),
                });
                const stop = successor.subscribe(() => {});
                assert(
                    f.fields.field('a').setValue('Successor answer').accepted
                );
                const expected = successor.getSnapshot();
                release({ type: 'confirm', isCurrent: () => true });
                await assert.rejects(flight);
                assert.equal(request.signal.aborted, true);
                assert.deepEqual(successor.getSnapshot(), expected);
                assert.equal(
                    f.fields.field('a').getSnapshot().value,
                    'Successor answer'
                );
                assert.equal(f.calls.length, 0);
                stop();
                successor.dispose();
                checks++;
            }
            for (const queuedWhen of ['before-review', 'during-review']) {
                let reviews = 0;
                let request;
                let release;
                const f = reviewFixture(
                    (r) => {
                        reviews++;
                        request = r;
                        return new Promise((resolve) => {
                            release = resolve;
                        });
                    },
                    (p) => {
                        p.payload.fieldIdsToSchemas.b.fieldType =
                            'multipleAttachments';
                        p.payload.fieldIdsToSchemas.b.airtableField.config = {
                            type: 'multipleAttachments',
                            options: {},
                        };
                        p.payload.formRecord.data.b = [];
                    }
                );
                let uploads = 0;
                f.client.attachments.uploadFile = async () => {
                    uploads++;
                    throw new Error('Queued file test must never upload');
                };
                const journal = new forms.RecoveryJournal();
                const scope = {
                    owner: 'A',
                    parentFieldId: null,
                    tableId: null,
                    childExtensionId: f.loaded.extensionId,
                    context: 'direct-url',
                };
                const attachment = f.fields.attachment('b', {
                    journal,
                    scope,
                    loadVersion: 1,
                });
                finalPage(f);
                const native = structuredClone(
                    f.fields.controller.getState().draft.data
                );
                const draftRevision =
                    f.fields.controller.getState().draftRevision;
                const tracked = trackedLifecycle();
                let flight;
                if (queuedWhen === 'during-review') {
                    flight = f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: tracked.lifecycle,
                    });
                    await Promise.resolve(); // Queue files after the held adapter has opened.
                    assert(request);
                    assert.equal(reviews, 1);
                    assert.equal(f.pages.getSnapshot().reviewing, true);
                }
                assert.equal(
                    attachment.select([
                        new File(['queued'], 'queued.txt', {
                            type: 'text/plain',
                        }),
                    ]),
                    true
                );
                assert.equal(f.fields.hasPendingFiles(), true);
                assert.equal(f.pages.getSnapshot().canReview, false);
                assert.equal(journal.blocking(scope, null), undefined);
                if (queuedWhen === 'before-review') {
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision, {
                            lifecycle: tracked.lifecycle,
                        })
                    );
                    assert.equal(reviews, 0);
                } else {
                    assert.equal(
                        request.isCurrent(),
                        false,
                        'Queued files invalidate held prepared Review'
                    );
                    release({ type: 'confirm', isCurrent: () => true });
                    await assert.rejects(flight);
                }
                assert.equal(tracked.counts.dispatch, 0);
                assert.equal(f.calls.length, 0);
                assert.equal(uploads, 0);
                assert.deepEqual(
                    f.fields.controller.getState().draft.data,
                    native
                );
                assert.equal(
                    f.fields.controller.getState().draftRevision,
                    draftRevision
                );
                attachment.clear();
                assert.equal(f.fields.hasPendingFiles(), false);
                assert.equal(f.pages.getSnapshot().reviewing, false);
                assert.equal(f.pages.getSnapshot().canReview, true);
                assert.equal(journal.blocking(scope, null), undefined);
                assert.equal(f.calls.length, 0);
                assert.equal(uploads, 0);
                checks++;
            }
            {
                let reviews = 0;
                const f = reviewFixture(async () => {
                    reviews++;
                    return { type: 'confirm', isCurrent: () => true };
                });
                finalPage(f);
                const tracked = trackedLifecycle();
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: tracked.lifecycle,
                        isCurrent: () => false,
                    })
                );
                assert.equal(
                    reviews,
                    0,
                    'False caller lease refuses before opening Review'
                );
                assert.equal(tracked.counts.dispatch, 0);
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                for (const mutation of ['native', 'raw']) {
                    let reviews = 0;
                    let edited = false;
                    let callerChecks = 0;
                    const f = reviewFixture(
                        async () => {
                            reviews++;
                            return { type: 'confirm', isCurrent: () => true };
                        },
                        (p) => {
                            p.payload.fieldIdsToSchemas.a.fieldType = 'number';
                            p.payload.fieldIdsToSchemas.a.airtableField.config =
                                {
                                    type: 'number',
                                    options: { precision: 0 },
                                };
                            p.payload.formRecord.data.a = 1;
                        }
                    );
                    finalPage(f);
                    const tracked = trackedLifecycle();
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision, {
                            lifecycle: tracked.lifecycle,
                            isCurrent() {
                                callerChecks++;
                                assert(
                                    callerChecks <= 8,
                                    'Caller lease revalidation is bounded'
                                );
                                if (!edited) {
                                    edited = true;
                                    if (mutation === 'native')
                                        assert(
                                            f.fields.field('a').setValue(2)
                                                .accepted
                                        );
                                    else
                                        assert.equal(
                                            f.fields
                                                .field('a')
                                                .scalar.setInput('-'),
                                            false
                                        );
                                }
                                return true;
                            },
                        })
                    );
                    assert(edited);
                    assert(callerChecks > 0 && callerChecks <= 4);
                    assert.equal(
                        reviews,
                        0,
                        'Reentrant caller edit refuses before opening Review'
                    );
                    assert.equal(tracked.counts.dispatch, 0);
                    assert.equal(f.calls.length, 0);
                    assert.equal(f.pages.getSnapshot().reviewing, false);
                }
                checks++;
            }
            const checkEmailComposition = async (
                f,
                renderer = 'renderEmailField',
                problem = 'invalid-email',
                valid = 'Composition+tag@EXAMPLE.test'
            ) => {
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
                const { createElement, act } = require('react');
                const { createRoot } = require('react-dom/client');
                const scope = ui.createFormRenderScope({
                    fields: f.fields,
                    pages: f.pages,
                    isCurrent: () => true,
                    configurationRevision: () => 0,
                });
                const host = window.document.createElement('div');
                window.document.body.append(host);
                const root = createRoot(host);
                let last, capability;
                try {
                    await act(async () =>
                        root.render(
                            createElement(reactApi.AirtableForm, {
                                scope,
                                renderers: {
                                    [renderer]: (p) => {
                                        capability = p.capability;
                                        return createElement(
                                            'output',
                                            { id: 'email' },
                                            p.value
                                        );
                                    },
                                    renderSingleLineTextField: (p) =>
                                        createElement('output', null, p.value),
                                },
                                children: (state) => {
                                    last = state;
                                    return createElement(
                                        'section',
                                        null,
                                        ...state.fields.map((field) =>
                                            createElement(
                                                'div',
                                                { key: field.fieldId },
                                                field.node
                                            )
                                        ),
                                        createElement(
                                            'output',
                                            { id: 'feedback' },
                                            JSON.stringify(state.page.problems)
                                        )
                                    );
                                },
                            })
                        )
                    );
                    const retainedNext = last.actions.next;
                    await act(async () => {
                        assert(
                            capability.setValue('composition-invalid').accepted
                        );
                    });
                    assert(
                        host
                            .querySelector('#feedback')
                            .textContent.includes(problem)
                    );
                    assert.equal(last.page.canNext, false);
                    assert.equal(retainedNext().accepted, false);
                    await act(async () => {
                        assert(capability.setValue(valid).accepted);
                    });
                    await act(async () => {
                        assert(last.actions.next().accepted);
                    });
                    await act(async () => {
                        assert(last.actions.next().accepted);
                    });
                    const retainedSubmit = last.actions.submit;
                    await act(async () => {
                        assert(
                            f.fields
                                .field('a')
                                .setValue('composition-final-invalid').accepted
                        );
                    });
                    await assert.rejects(retainedSubmit());
                    await assert.rejects(last.actions.submit());
                    assert.equal(f.calls.length, 0);
                    await act(async () => {
                        assert(f.fields.field('a').setValue(valid).accepted);
                    });
                    await act(async () => {
                        await last.actions.submit();
                    });
                    assert.equal(f.calls.length, 1);
                    assert.equal(f.calls[0].formRecord.data.a, valid);
                } finally {
                    await act(async () => root.unmount());
                    scope.destroy();
                    host.remove();
                    await window.happyDOM.abort();
                    keys.forEach((key, index) => {
                        if (previous[index])
                            Object.defineProperty(
                                globalThis,
                                key,
                                previous[index]
                            );
                        else delete globalThis[key];
                    });
                }
            };
            // Exercise ordinary email rules through each installed ESM/CJS owner.
            const emailFixture = (value = 'Initial@example.test', mini = {}) =>
                fixture((p) => {
                    const schema = p.payload.fieldIdsToSchemas.a;
                    schema.fieldType = 'email';
                    schema.airtableField.config = {
                        type: 'email',
                        options: null,
                    };
                    schema.miniExtConfig = mini;
                    p.payload.formRecord.data.a = value;
                });
            const emailProblems = (f) =>
                f.pages.getSnapshot().problems.filter((p) => p.fieldId === 'a');
            const journalFor = (f) => {
                const journal = new forms.RecoveryJournal();
                const scope = {
                    owner: 'A',
                    parentFieldId: null,
                    tableId: null,
                    childExtensionId: f.loaded.extensionId,
                    context: 'direct-url',
                };
                let attempts = 0;
                return {
                    journal,
                    scope,
                    get attempts() {
                        return attempts;
                    },
                    lifecycle: {
                        dispatch() {
                            attempts++;
                            const attempt = journal.begin(
                                scope,
                                null,
                                'save',
                                1
                            );
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
                };
            };
            {
                const f = emailFixture();
                const native = 'Case.Sensitive+tag@EXAMPLE.test';
                assert(f.fields.field('a').setValue(native).accepted);
                assert.deepEqual(emailProblems(f), []);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert.equal(
                    f.calls.length,
                    0,
                    'Explicit Next never sends email'
                );
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                const recovery = journalFor(f);
                await f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: recovery.lifecycle,
                });
                assert.equal(f.calls.length, 1);
                assert.equal(recovery.attempts, 1);
                assert.equal(
                    recovery.journal.blocking(recovery.scope, null),
                    undefined
                );
                assert.deepEqual(f.calls[0].formRecord, {
                    type: 'create',
                    data: {
                        a: native,
                        b: 'B',
                        c: 'C',
                        unrendered: { text: 'native' },
                    },
                });
                assert.deepEqual(f.calls[0].formFieldIdsWithUnsavedChanges, [
                    'unrendered',
                    'a',
                ]);
                assert.deepEqual(f.calls[0].searchQuery, { kept: 'exact' });
                checks++;
            }
            for (const required of [false, true]) {
                for (const [value, code] of [
                    [null, required ? 'required' : null],
                    [undefined, required ? 'required' : null],
                    ['', required ? 'required' : null],
                    ['   ', required ? 'required' : 'invalid-email'],
                    ['not-an-email', 'invalid-email'],
                    [' user@example.test ', 'invalid-email'],
                ]) {
                    const f = emailFixture(value, { required });
                    // Undefined is a canonical empty too; avoid the helper's default argument.
                    if (value === undefined)
                        f.fields.controller.write('a', undefined);
                    assert.deepEqual(
                        emailProblems(f),
                        code ? [{ fieldId: 'a', code }] : []
                    );
                    if (code) {
                        const recovery = journalFor(f);
                        assert.equal(
                            f.pages.next(f.pages.getSnapshot().revision)
                                .accepted,
                            false
                        );
                        await assert.rejects(
                            f.pages.submit(f.pages.getSnapshot().revision, {
                                lifecycle: recovery.lifecycle,
                            })
                        );
                        assert.equal(f.calls.length, 0);
                        assert.equal(recovery.attempts, 0);
                        assert.equal(
                            recovery.journal.blocking(recovery.scope, null),
                            undefined
                        );
                    }
                    checks++;
                }
            }
            for (const readOnly of [false, true]) {
                const f = fixture((p) => {
                    const schema = p.payload.fieldIdsToSchemas.a;
                    schema.fieldType = 'email';
                    schema.airtableField.config = {
                        type: 'email',
                        options: null,
                    };
                    schema.miniExtConfig = {
                        readOnly,
                        required: true,
                        conditionalFields: {
                            logicalOperator: 'and',
                            conditions: [
                                {
                                    id: 'hide-email',
                                    type: 'singleCondition',
                                    setting: {
                                        type: 'is',
                                        fieldType: 'singleLineText',
                                        idOrName: { type: 'id', id: 'b' },
                                        value: 'show',
                                    },
                                },
                            ],
                        },
                    };
                    p.payload.formRecord.data.a = 'hidden-invalid-email';
                });
                assert.equal(
                    f.fields.field('a').getSnapshot().visibility.type,
                    'hidden'
                );
                // Hiding skips this structural page, but final Submit still
                // validates its native email under the rule-specific exemption.
                while (f.pages.getSnapshot().canNext)
                    assert(
                        f.pages.next(f.pages.getSnapshot().revision).accepted
                    );
                assert.deepEqual(
                    emailProblems(f),
                    readOnly ? [] : [{ fieldId: 'a', code: 'invalid-email' }]
                );
                const recovery = journalFor(f);
                if (readOnly) {
                    await f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: recovery.lifecycle,
                    });
                    assert.equal(
                        f.calls[0].formRecord.data.a,
                        'hidden-invalid-email'
                    );
                } else {
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision, {
                            lifecycle: recovery.lifecycle,
                        })
                    );
                    assert.equal(f.calls.length, 0);
                    assert.equal(recovery.attempts, 0);
                }
                checks++;
            }
            {
                const f = emailFixture({
                    text: 'private-malformed-email-value',
                });
                assert.deepEqual(emailProblems(f), [
                    { fieldId: 'a', code: 'invalid-input' },
                ]);
                assert.equal(
                    JSON.stringify(f.pages.getSnapshot().problems).includes(
                        'private-malformed'
                    ),
                    false
                );
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = emailFixture();
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                const oldRevision = f.pages.getSnapshot().revision;
                let reentered = false;
                f.pages.subscribe(() => {
                    if (!reentered) {
                        reentered = true;
                        f.fields.controller.write(
                            'a',
                            'callback-invalid-email'
                        );
                    }
                });
                assert(
                    f.fields.field('a').setValue('New@example.test').accepted
                );
                assert(reentered);
                const recovery = journalFor(f);
                await assert.rejects(
                    f.pages.submit(oldRevision, {
                        lifecycle: recovery.lifecycle,
                    })
                );
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: recovery.lifecycle,
                    })
                );
                assert.deepEqual(emailProblems(f), [
                    { fieldId: 'a', code: 'invalid-email' },
                ]);
                assert.equal(f.calls.length, 0);
                assert.equal(recovery.attempts, 0);
                checks++;
            }
            {
                const f = emailFixture();
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                let armed = false,
                    ownershipChecks = 0;
                f.setPredicate(() => {
                    if (armed && ++ownershipChecks === 2)
                        f.fields.controller.write(
                            'a',
                            'ownership-invalid-email'
                        );
                    return true;
                });
                const revision = f.pages.getSnapshot().revision;
                const recovery = journalFor(f);
                armed = true;
                await assert.rejects(
                    f.pages.submit(revision, { lifecycle: recovery.lifecycle })
                );
                assert.deepEqual(emailProblems(f), [
                    { fieldId: 'a', code: 'invalid-email' },
                ]);
                assert.equal(f.calls.length, 0);
                assert.equal(recovery.attempts, 0);
                checks++;
            }
            {
                await checkEmailComposition(emailFixture());
                checks++;
            }
            // Exercise ordinary url rules through each installed ESM/CJS owner.
            const urlFixture = (value = 'initial.example.test', mini = {}) =>
                fixture((p) => {
                    const schema = p.payload.fieldIdsToSchemas.a;
                    schema.fieldType = 'url';
                    schema.airtableField.config = {
                        type: 'url',
                        options: null,
                    };
                    schema.miniExtConfig = mini;
                    p.payload.formRecord.data.a = value;
                });
            const urlProblems = (f) =>
                f.pages.getSnapshot().problems.filter((p) => p.fieldId === 'a');
            {
                const f = urlFixture();
                const native = 'EXAMPLE.test/Case?kept=Exact';
                assert(f.fields.field('a').setValue(native).accepted);
                assert.deepEqual(urlProblems(f), []);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert.equal(
                    f.calls.length,
                    0,
                    'Explicit Next never sends url'
                );
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                const recovery = journalFor(f);
                await f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: recovery.lifecycle,
                });
                assert.equal(f.calls.length, 1);
                assert.equal(recovery.attempts, 1);
                assert.equal(
                    recovery.journal.blocking(recovery.scope, null),
                    undefined
                );
                assert.deepEqual(f.calls[0].formRecord, {
                    type: 'create',
                    data: {
                        a: native,
                        b: 'B',
                        c: 'C',
                        unrendered: { text: 'native' },
                    },
                });
                assert.deepEqual(f.calls[0].formFieldIdsWithUnsavedChanges, [
                    'unrendered',
                    'a',
                ]);
                assert.deepEqual(f.calls[0].searchQuery, { kept: 'exact' });
                checks++;
            }
            for (const required of [false, true]) {
                for (const [value, code] of [
                    [null, required ? 'required' : null],
                    [undefined, required ? 'required' : null],
                    ['', required ? 'required' : null],
                    ['   ', required ? 'required' : 'invalid-url'],
                    ['not-an-url', 'invalid-url'],
                    [' https://example.test ', 'invalid-url'],
                ]) {
                    const f = urlFixture(value, { required });
                    // Undefined is a canonical empty too; avoid the helper's default argument.
                    if (value === undefined)
                        f.fields.controller.write('a', undefined);
                    assert.deepEqual(
                        urlProblems(f),
                        code ? [{ fieldId: 'a', code }] : []
                    );
                    if (code) {
                        const recovery = journalFor(f);
                        assert.equal(
                            f.pages.next(f.pages.getSnapshot().revision)
                                .accepted,
                            false
                        );
                        await assert.rejects(
                            f.pages.submit(f.pages.getSnapshot().revision, {
                                lifecycle: recovery.lifecycle,
                            })
                        );
                        assert.equal(f.calls.length, 0);
                        assert.equal(recovery.attempts, 0);
                        assert.equal(
                            recovery.journal.blocking(recovery.scope, null),
                            undefined
                        );
                    }
                    checks++;
                }
            }
            for (const readOnly of [false, true]) {
                const f = fixture((p) => {
                    const schema = p.payload.fieldIdsToSchemas.a;
                    schema.fieldType = 'url';
                    schema.airtableField.config = {
                        type: 'url',
                        options: null,
                    };
                    schema.miniExtConfig = {
                        readOnly,
                        required: true,
                        conditionalFields: {
                            logicalOperator: 'and',
                            conditions: [
                                {
                                    id: 'hide-url',
                                    type: 'singleCondition',
                                    setting: {
                                        type: 'is',
                                        fieldType: 'singleLineText',
                                        idOrName: { type: 'id', id: 'b' },
                                        value: 'show',
                                    },
                                },
                            ],
                        },
                    };
                    p.payload.formRecord.data.a = 'hidden-invalid-url';
                });
                assert.equal(
                    f.fields.field('a').getSnapshot().visibility.type,
                    'hidden'
                );
                // Hiding skips this structural page, but final Submit still
                // validates its native url under the rule-specific exemption.
                while (f.pages.getSnapshot().canNext)
                    assert(
                        f.pages.next(f.pages.getSnapshot().revision).accepted
                    );
                assert.deepEqual(
                    urlProblems(f),
                    readOnly ? [] : [{ fieldId: 'a', code: 'invalid-url' }]
                );
                const recovery = journalFor(f);
                if (readOnly) {
                    await f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: recovery.lifecycle,
                    });
                    assert.equal(
                        f.calls[0].formRecord.data.a,
                        'hidden-invalid-url'
                    );
                } else {
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision, {
                            lifecycle: recovery.lifecycle,
                        })
                    );
                    assert.equal(f.calls.length, 0);
                    assert.equal(recovery.attempts, 0);
                }
                checks++;
            }
            {
                const f = urlFixture({
                    text: 'private-malformed-url-value',
                });
                assert.deepEqual(urlProblems(f), [
                    { fieldId: 'a', code: 'invalid-input' },
                ]);
                assert.equal(
                    JSON.stringify(f.pages.getSnapshot().problems).includes(
                        'private-malformed'
                    ),
                    false
                );
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision)
                );
                assert.equal(f.calls.length, 0);
                checks++;
            }
            {
                const f = urlFixture();
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                const oldRevision = f.pages.getSnapshot().revision;
                let reentered = false;
                f.pages.subscribe(() => {
                    if (!reentered) {
                        reentered = true;
                        f.fields.controller.write('a', 'callback-invalid-url');
                    }
                });
                assert(
                    f.fields.field('a').setValue('new.example.test').accepted
                );
                assert(reentered);
                const recovery = journalFor(f);
                await assert.rejects(
                    f.pages.submit(oldRevision, {
                        lifecycle: recovery.lifecycle,
                    })
                );
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: recovery.lifecycle,
                    })
                );
                assert.deepEqual(urlProblems(f), [
                    { fieldId: 'a', code: 'invalid-url' },
                ]);
                assert.equal(f.calls.length, 0);
                assert.equal(recovery.attempts, 0);
                checks++;
            }
            {
                const f = urlFixture();
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                let armed = false,
                    ownershipChecks = 0;
                f.setPredicate(() => {
                    if (armed && ++ownershipChecks === 2)
                        f.fields.controller.write('a', 'ownership-invalid-url');
                    return true;
                });
                const revision = f.pages.getSnapshot().revision;
                const recovery = journalFor(f);
                armed = true;
                await assert.rejects(
                    f.pages.submit(revision, { lifecycle: recovery.lifecycle })
                );
                assert.deepEqual(urlProblems(f), [
                    { fieldId: 'a', code: 'invalid-url' },
                ]);
                assert.equal(f.calls.length, 0);
                assert.equal(recovery.attempts, 0);
                checks++;
            }
            {
                await checkEmailComposition(
                    urlFixture(),
                    'renderUrlField',
                    'invalid-url',
                    'EXAMPLE.test/Composition?kept=Exact'
                );
                checks++;
            }
            for (const native of [
                'mailto:Case+tag@EXAMPLE.test',
                'example.test:8443/Path',
            ]) {
                const f = urlFixture();
                assert(f.fields.field('a').setValue(native).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert.equal(f.calls.length, 0);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                await f.pages.submit(f.pages.getSnapshot().revision);
                assert.equal(f.calls.length, 1);
                assert.equal(f.calls[0].formRecord.data.a, native);
                checks++;
            }
            for (const value of [
                'https://example.test/\npath',
                'https://example.test/%0apath',
                'https://example.test/%7Fpath',
                'javascript:alert(1)',
                'data:text/plain,unsafe',
                'ftp://example.test',
                'https://user:secret@example.test',
                'mailto://person@example.test',
            ]) {
                const f = urlFixture();
                assert(f.fields.field('a').setValue(value).accepted);
                const native = structuredClone(f.fields.controller.getState());
                assert.deepEqual(urlProblems(f), [
                    { fieldId: 'a', code: 'invalid-url' },
                ]);
                assert.equal(
                    f.pages.next(f.pages.getSnapshot().revision).accepted,
                    false
                );
                const recovery = journalFor(f);
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: recovery.lifecycle,
                    })
                );
                assert.equal(f.calls.length, 0);
                assert.equal(recovery.attempts, 0);
                assert.equal(
                    recovery.journal.blocking(recovery.scope, null),
                    undefined
                );
                assert.deepEqual(f.fields.controller.getState(), native);
                checks++;
            }
            for (const allowInvalidUrls of [true, false, 'true', 1, {}, null]) {
                const f = urlFixture('javascript:alert(1)', {
                    allowInvalidUrls,
                });
                assert.deepEqual(
                    urlProblems(f),
                    allowInvalidUrls === true
                        ? []
                        : [{ fieldId: 'a', code: 'invalid-url' }]
                );
                const recovery = journalFor(f);
                if (allowInvalidUrls === true) {
                    assert(
                        f.pages.next(f.pages.getSnapshot().revision).accepted
                    );
                    assert(
                        f.pages.next(f.pages.getSnapshot().revision).accepted
                    );
                    await f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: recovery.lifecycle,
                    });
                    assert.equal(f.calls.length, 1);
                    assert.equal(
                        f.calls[0].formRecord.data.a,
                        'javascript:alert(1)'
                    );
                } else {
                    assert.equal(
                        f.pages.next(f.pages.getSnapshot().revision).accepted,
                        false
                    );
                    await assert.rejects(
                        f.pages.submit(f.pages.getSnapshot().revision, {
                            lifecycle: recovery.lifecycle,
                        })
                    );
                    assert.equal(f.calls.length, 0);
                    assert.equal(recovery.attempts, 0);
                }
                checks++;
            }
            {
                const f = urlFixture();
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                let armed = false,
                    configurationChecks = 0;
                f.setPredicate(() => {
                    if (armed && ++configurationChecks === 2) f.setConfig(1);
                    return true;
                });
                const revision = f.pages.getSnapshot().revision;
                const recovery = journalFor(f);
                armed = true;
                await assert.rejects(
                    f.pages.submit(revision, { lifecycle: recovery.lifecycle })
                );
                assert.equal(f.calls.length, 0);
                assert.equal(recovery.attempts, 0);
                assert.equal(
                    recovery.journal.blocking(recovery.scope, null),
                    undefined
                );
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
            assert.deepEqual(
                support.conservativeRefusal.toSorted(),
                oracle.conservativeRefusal.map((c) => c.name).toSorted()
            );
            for (const c of [
                ...oracle.validation,
                ...oracle.conservativeRefusal,
            ]) {
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
                if (support.conservativeRefusal.includes(c.name))
                    assert.deepEqual(problems, [
                        { fieldId: 'fld_answer', code: c.expectedCode },
                    ]);
                else if (support.unsupportedValidation.includes(c.name))
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
