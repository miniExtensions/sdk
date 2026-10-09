import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

// Installed public APIs and actual React callers; transport responses are synthetic.
export async function checkDateRangeConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const fixture = JSON.parse(
        readFileSync(
            new URL('../test/fixtures/dateRanges.json', import.meta.url),
            'utf8'
        )
    );
    assert(fixture.provenance);
    const specialIds = new Set([
        'invalid-date',
        'invalid-date-time',
        'date-has-time',
        'null-range',
        'unknown-range',
        'invalid-before-unknown',
        'offset-instant',
        'date-only-ISO-time',
    ]);
    const special = fixture.validation.filter((c) => specialIds.has(c.id));
    assert.deepEqual(new Set(special.map((c) => c.id)), specialIds);
    const cases = fixture.validation
        .filter((c) => !specialIds.has(c.id))
        .map((c) => {
            assert.equal(c.canonical.type, 'result', c.id);
            assert.equal(typeof c.canonical.withinRange, 'boolean', c.id);
            return { ...c, canonical: c.canonical.withinRange };
        });
    assert.equal(cases.length + special.length, fixture.validation.length);
    assert.equal(new Set(cases.map((c) => c.dateRange)).size, 9);
    const formats = [
        await Promise.all(
            ['forms', 'ui', 'react'].map(
                (name) => import(pathToFileURL(join(esm, name, 'index.js')))
            )
        ),
        ['forms', 'ui', 'react'].map((name) =>
            require(`@miniextensions/sdk/${name}`)
        ),
    ];
    const moment = require(
        require.resolve('moment-timezone', {
            paths: [require.resolve('@miniextensions/sdk/forms')],
        })
    );
    const realDateNow = Date.now,
        realMomentNow = moment.now;
    let checks = 0;
    const clock = (now) => {
        Date.now = moment.now = () => new Date(now).getTime();
    };
    try {
        for (const [forms, ui, api] of formats) {
            const live = new Set();
            const dispose = (f) => {
                f.pages.dispose();
                f.fields.destroy();
                live.delete(f);
            };
            const make = (
                sample,
                {
                    stored = null,
                    mini = {},
                    hidden = false,
                    owner = 'create',
                } = {}
            ) => {
                const loaded = portalRecipeFixtures.makeForm({
                    childExtensionInfo: { accessType: { type: 'create' } },
                });
                const schema = (id, type, config, miniExtConfig) => ({
                    fieldType: type,
                    airtableField: {
                        id,
                        name: id,
                        description: null,
                        isComputed: false,
                        isPrimaryField: false,
                        config,
                    },
                    miniExtConfig,
                });
                const options = {
                    dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                    ...(sample.kind === 'dateTime'
                        ? {
                              timeFormat: { name: '24hour', format: 'HH:mm' },
                              timeZone: sample.timeZone,
                          }
                        : {}),
                };
                Object.assign(loaded.payload, {
                    hasParentExtension: false,
                    fieldIdsInForm: ['answer', 'next'],
                    fieldIdsToSchemas: {
                        answer: schema(
                            'answer',
                            sample.kind,
                            { type: sample.kind, options },
                            {
                                dateRange: sample.dateRange,
                                ...mini,
                                ...(hidden
                                    ? {
                                          conditionalFields: {
                                              logicalOperator: 'and',
                                              conditions: [
                                                  {
                                                      id: 'hide',
                                                      type: 'singleCondition',
                                                      setting: {
                                                          type: 'is',
                                                          fieldType:
                                                              'singleLineText',
                                                          idOrName: {
                                                              type: 'id',
                                                              id: 'next',
                                                          },
                                                          value: 'show',
                                                      },
                                                  },
                                              ],
                                          },
                                      }
                                    : {}),
                            }
                        ),
                        next: schema(
                            'next',
                            'singleLineText',
                            { type: 'singleLineText', options: null },
                            { headerSectionTitle: 'Next page' }
                        ),
                    },
                    formRecord: {
                        type: 'create',
                        data: {
                            answer: stored,
                            next: 'retained',
                            unrendered: { exact: ['native'] },
                        },
                    },
                    formFieldIdsWithUnsavedChanges: ['unrendered'],
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
                const context =
                    owner === 'child'
                        ? {
                              type: 'modal',
                              prefillData: {
                                  toLinkToParent: {
                                      reversedFieldIdToPrefill: 'fld_parent',
                                      parentFormRecordId: 'rec_parent',
                                  },
                                  prefillQueryForChildExtension: null,
                              },
                          }
                        : { type: 'direct-url' };
                if (owner === 'edit')
                    loaded.payload.formRecord = {
                        ...loaded.payload.formRecord,
                        type: 'edit',
                        recordId: 'rec_range',
                        tableId: 'tbl_range',
                    };
                loaded.payload.hasParentExtension = owner === 'child';
                const saveOptions = {
                    captchaVal: 'captcha-range',
                    isComputeMode: false,
                    searchQuery: { retained: 'exact' },
                    context,
                    conditionalLinkedRecordFieldIdsToFilteringValues: {
                        retained: { answer: 'filter-exact' },
                    },
                    deviceFingerprint: {
                        version: 1,
                        visitorId: 'range-visitor',
                    },
                    longitude: 12.5,
                    latitude: -4.25,
                };
                const expectedEnvelope = {
                    captchaVal: 'captcha-range',
                    isComputeMode: false,
                    searchQuery: { retained: 'exact' },
                    context: structuredClone(context),
                    conditionalLinkedRecordFieldIdsToFilteringValues: {
                        retained: { answer: 'filter-exact' },
                    },
                    deviceFingerprint: {
                        version: 1,
                        visitorId: 'range-visitor',
                    },
                    longitude: 12.5,
                    latitude: -4.25,
                    extensionAccessToken: 'child_access_example',
                    formRecord:
                        owner === 'edit'
                            ? {
                                  type: 'edit',
                                  recordId: 'rec_range',
                                  tableId: 'tbl_range',
                                  data: null,
                              }
                            : { type: 'create', data: null },
                    formFieldIdsWithUnsavedChanges: null,
                };
                const calls = [];
                let configuration = 0,
                    ownerRevision = 0,
                    predicate = () => true;
                const fields = forms.createFormFieldBindings({
                    loaded,
                    client: {
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
                    },
                    getScope: () => ({
                        ownerId: 'range',
                        revision: ownerRevision,
                    }),
                    getClientTimeZone: () => 'America/Los_Angeles',
                    saveOptions,
                    ...(owner === 'child'
                        ? {
                              parent: {
                                  portalId: 'portal_range',
                                  recordId: 'rec_parent',
                                  portalFieldId: 'fld_children',
                              },
                          }
                        : {}),
                });
                const pageOptions = {
                    fields,
                    isCurrent: () => predicate(),
                    configurationRevision: () => configuration,
                };
                const pages = forms.createFormPageOwner(pageOptions);
                const journal = new forms.RecoveryJournal();
                const recoveryScope = {
                    owner: 'range',
                    parentFieldId: owner === 'child' ? 'fld_children' : null,
                    tableId: owner === 'edit' ? 'tbl_range' : null,
                    childExtensionId: loaded.extensionId,
                    context: owner === 'child' ? 'modal' : 'direct-url',
                };
                let attempts = 0;
                const lifecycle = {
                    dispatch() {
                        attempts++;
                        const attempt = journal.begin(
                            recoveryScope,
                            null,
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
                const f = {
                    loaded,
                    expectedEnvelope,
                    fields,
                    pages,
                    pageOptions,
                    calls,
                    lifecycle,
                    journal,
                    recoveryScope,
                    get attempts() {
                        return attempts;
                    },
                    setPredicate(fn) {
                        predicate = fn;
                    },
                    bumpConfig() {
                        configuration++;
                    },
                    bumpOwner() {
                        ownerRevision++;
                        fields.refresh();
                    },
                };
                live.add(f);
                return f;
            };
            const problems = (f) =>
                f.pages
                    .getSnapshot()
                    .problems.filter((p) => p.fieldId === 'answer');
            const refuse = async (f, code) => {
                const native = structuredClone(f.fields.controller.getState());
                if (code)
                    assert.deepEqual(problems(f), [
                        { fieldId: 'answer', code },
                    ]);
                assert.equal(
                    f.pages.next(f.pages.getSnapshot().revision).accepted,
                    false
                );
                await assert.rejects(
                    f.pages.submit(f.pages.getSnapshot().revision, {
                        lifecycle: f.lifecycle,
                    })
                );
                assert.equal(f.calls.length, 0);
                assert.equal(f.attempts, 0);
                assert.equal(
                    f.journal.blocking(f.recoveryScope, null),
                    undefined
                );
                assert.deepEqual(f.fields.controller.getState(), native);
            };
            const save = async (f) => {
                while (f.pages.getSnapshot().canNext)
                    assert(
                        f.pages.next(f.pages.getSnapshot().revision).accepted
                    );
                const native = structuredClone(f.fields.controller.getState());
                await f.pages.submit(f.pages.getSnapshot().revision, {
                    lifecycle: f.lifecycle,
                });
                assert.equal(f.calls.length, 1);
                assert.equal(f.attempts, 1);
                assert.deepEqual(f.calls[0], {
                    ...f.expectedEnvelope,
                    formRecord: {
                        ...f.expectedEnvelope.formRecord,
                        data: native.draft.data,
                    },
                    formFieldIdsWithUnsavedChanges: native.draft.dirtyFieldIds,
                });
            };
            try {
                for (const sample of cases) {
                    clock(sample.now);
                    const f = make(sample);
                    assert.equal(
                        f.fields.field('answer').date.setInput(sample.value),
                        true,
                        sample.id
                    );
                    assert.equal(
                        f.fields.field('answer').getSnapshot().value,
                        sample.value
                    );
                    if (sample.canonical) {
                        assert.deepEqual(problems(f), [], sample.id);
                        await save(f);
                    } else await refuse(f, 'invalid-input');
                    checks++;
                    dispose(f);
                }
                const goodOwner = cases.find(
                    (c) => c.canonical && c.kind === 'date'
                );
                const badOwner = cases.find(
                    (c) =>
                        !c.canonical &&
                        c.kind === goodOwner.kind &&
                        c.timeZone === goodOwner.timeZone &&
                        c.dateRange === goodOwner.dateRange &&
                        c.now === goodOwner.now
                );
                assert(goodOwner && badOwner);
                clock(goodOwner.now);
                for (const owner of ['edit', 'child']) {
                    const f = make(goodOwner, { owner });
                    assert(
                        f.fields.field('answer').date.setInput(badOwner.value)
                    );
                    await refuse(f, 'invalid-input');
                    assert(
                        f.fields.field('answer').date.setInput(goodOwner.value)
                    );
                    await save(f);
                    checks++;
                    dispose(f);
                }
                const exact = cases.find(
                    (c) =>
                        !c.canonical &&
                        c.kind === 'dateTime' &&
                        c.value.endsWith('Z')
                );
                assert(exact);
                clock(exact.now);
                const equivalent = exact.value.slice(0, -1) + '+00:00';
                assert.equal(
                    new Date(equivalent).getTime(),
                    new Date(exact.value).getTime()
                );
                for (const stored of [exact.value, equivalent]) {
                    const f = make(exact, { stored });
                    f.fields.controller.write('answer', exact.value);
                    if (stored === exact.value) await save(f);
                    else await refuse(f, 'invalid-input');
                    checks++;
                    dispose(f);
                }
                const day = {
                    kind: 'date',
                    timeZone: 'UTC',
                    dateRange: 'today or in the future',
                    value: '2024-03-10',
                    now: '2024-03-10T12:00:00Z',
                };
                clock(day.now);
                const transition = make(day);
                assert(
                    transition.fields.field('answer').date.setInput(day.value)
                );
                assert.deepEqual(problems(transition), []);
                const heldRevision = transition.pages.getSnapshot().revision;
                clock('2024-03-11T12:00:00Z');
                assert.equal(
                    transition.pages.next(heldRevision).accepted,
                    false
                );
                await assert.rejects(
                    transition.pages.submit(heldRevision, {
                        lifecycle: transition.lifecycle,
                    })
                );
                await refuse(transition, 'invalid-input');
                checks++;
                dispose(transition);
                for (const sample of special) {
                    clock(sample.now);
                    const f = make(sample);
                    if (sample.id === 'offset-instant') {
                        assert.equal(sample.canonical.type, 'result');
                        assert(
                            ui.isDateFieldNativeValue(sample.kind, sample.value)
                        );
                        assert(
                            f.fields.field('answer').date.setInput(sample.value)
                        );
                        if (sample.canonical.withinRange) await save(f);
                        else await refuse(f, 'invalid-input');
                    } else if (sample.id === 'null-range') {
                        assert(
                            ui.isDateFieldNativeValue(sample.kind, sample.value)
                        );
                        assert(
                            f.fields.field('answer').date.setInput(sample.value)
                        );
                        assert.deepEqual(problems(f), []);
                        await save(f);
                    } else if (sample.id === 'unknown-range') {
                        assert(
                            ui.isDateFieldNativeValue(sample.kind, sample.value)
                        );
                        assert(
                            f.fields.field('answer').date.setInput(sample.value)
                        );
                        await refuse(f, 'invalid-metadata');
                    } else {
                        assert(
                            [
                                'invalid-date',
                                'invalid-date-time',
                                'date-has-time',
                                'invalid-before-unknown',
                                'date-only-ISO-time',
                            ].includes(sample.id)
                        );
                        assert.equal(
                            ui.isDateFieldNativeValue(
                                sample.kind,
                                sample.value
                            ),
                            false,
                            sample.id
                        );
                        const native = structuredClone(
                            f.fields.controller.getState().draft
                        );
                        assert.equal(
                            f.fields
                                .field('answer')
                                .date.setInput(sample.value),
                            false,
                            sample.id
                        );
                        assert.deepEqual(
                            f.fields.controller.getState().draft,
                            native
                        );
                        await refuse(f, 'invalid-input');
                    }
                    assert(
                        !JSON.stringify(problems(f)).includes(
                            String(sample.value)
                        ) || String(sample.value).length < 5
                    );
                    checks++;
                    dispose(f);
                }
                const bad = cases.find(
                    (c) => !c.canonical && c.kind === 'date'
                );
                assert(bad);
                clock(bad.now);
                for (const kind of ['date', 'dateTime']) {
                    const sample = cases.find(
                        (c) =>
                            !c.canonical &&
                            c.kind === kind &&
                            c.timeZone !== 'client'
                    );
                    assert(sample);
                    clock(sample.now);
                    for (const required of [true, false]) {
                        for (const empty of [null, undefined, '']) {
                            const f = make(sample, { mini: { required } });
                            f.fields.controller.write('answer', empty);
                            if (required) await refuse(f, 'required');
                            else await save(f);
                            checks++;
                            dispose(f);
                        }
                    }
                    for (const exemption of [
                        { hidden: true },
                        { mini: { readOnly: true } },
                        {},
                    ]) {
                        const unchanged = !exemption.hidden && !exemption.mini;
                        const f = make(
                            { ...sample, dateRange: { malformed: true } },
                            {
                                ...exemption,
                                stored: unchanged ? sample.value : null,
                            }
                        );
                        if (!unchanged)
                            f.fields.controller.write('answer', sample.value);
                        // Hidden, readonly and unchanged stored values waive even malformed range metadata.
                        assert.deepEqual(problems(f), []);
                        await save(f);
                        checks++;
                        dispose(f);
                    }
                }
                clock(bad.now);
                const malformed = make({
                    ...bad,
                    dateRange: 'private-invalid-range',
                });
                assert(
                    malformed.fields.field('answer').date.setInput(bad.value)
                );
                await refuse(malformed, 'invalid-metadata');
                assert(
                    !JSON.stringify(problems(malformed)).includes(
                        'private-invalid'
                    )
                );
                checks++;
                dispose(malformed);
                const client = cases.find((c) => c.kind === 'dateTime');
                assert(client);
                clock(client.now);
                const invalidZone = make({
                    ...client,
                    timeZone: 'private-invalid-zone',
                });
                invalidZone.fields.controller.write('answer', client.value);
                assert(
                    problems(invalidZone).some(
                        (p) =>
                            p.code === 'invalid-metadata' ||
                            p.code === 'invalid-input'
                    )
                );
                await refuse(invalidZone);
                assert(
                    !JSON.stringify(problems(invalidZone)).includes(
                        'private-invalid-zone'
                    )
                );
                checks++;
                dispose(invalidZone);
                const backendOnly = make({ ...client, timeZone: 'client' });
                assert(
                    backendOnly.fields
                        .field('answer')
                        .date.setInput(client.value)
                );
                assert.deepEqual(problems(backendOnly), []);
                await save(backendOnly);
                checks++;
                dispose(backendOnly);
                // No accepted-load client-zone provenance: neither browser zone nor presentation callback establishes local parity.
                for (const mutation of ['native', 'input', 'configuration']) {
                    const good = cases.find(
                        (c) => c.canonical && c.kind === 'date'
                    );
                    assert(good);
                    const outside = cases.find(
                        (c) =>
                            !c.canonical &&
                            c.kind === good.kind &&
                            c.timeZone === good.timeZone &&
                            c.dateRange === good.dateRange &&
                            c.now === good.now
                    );
                    assert(outside);
                    clock(good.now);
                    const f = make(good);
                    assert(f.fields.field('answer').date.setInput(good.value));
                    let armed = false,
                        reads = 0;
                    f.setPredicate(() => {
                        if (armed && ++reads === 2) {
                            if (mutation === 'native')
                                f.fields.controller.write(
                                    'answer',
                                    outside.value
                                );
                            if (mutation === 'input')
                                f.fields.field('answer').date.setInput('2024-');
                            if (mutation === 'configuration') f.bumpConfig();
                        }
                        return true;
                    });
                    const revision = f.pages.getSnapshot().revision;
                    armed = true;
                    await assert.rejects(
                        f.pages.submit(revision, { lifecycle: f.lifecycle })
                    );
                    assert.equal(f.calls.length, 0);
                    assert.equal(f.attempts, 0);
                    checks++;
                    dispose(f);
                }
                for (const kind of ['date', 'dateTime']) {
                    const sample = cases.find(
                        (c) =>
                            c.kind === kind &&
                            !c.canonical &&
                            c.timeZone !== 'client'
                    );
                    assert(sample);
                    clock(sample.now);
                    const good = cases.find(
                        (c) =>
                            c.kind === kind &&
                            c.canonical &&
                            c.timeZone === sample.timeZone &&
                            c.dateRange === sample.dateRange &&
                            c.now === sample.now
                    );
                    assert(good);
                    const f = make(sample);
                    await checkReactCaller(
                        f,
                        sample,
                        good.value,
                        ui,
                        api,
                        require,
                        refuse
                    );
                    checks++;
                    dispose(f);
                }
            } finally {
                for (const f of live) dispose(f);
            }
        }
    } finally {
        Date.now = realDateNow;
        moment.now = realMomentNow;
    }
    console.log(
        `Installed date ranges: ${checks} checks; canonical fixtures, retained pages and actual React callers; synthetic saves only.`
    );
    return checks;
}

async function checkReactCaller(
    f,
    sample,
    goodValue,
    ui,
    api,
    require,
    refuse
) {
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
    const { createElement: h, StrictMode, act } = require('react');
    const { createRoot } = require('react-dom/client');
    const scope = ui.createFormRenderScope({
        ...f.pageOptions,
        pages: f.pages,
    });
    const host = window.document.createElement('div');
    window.document.body.append(host);
    let root = createRoot(host),
        last,
        edit,
        nextResult,
        submitResult;
    const renderDate = (p) => {
        edit = p.capability.date.setInput;
        return h(
            'button',
            {
                id: 'edit-date',
                type: 'button',
                onClick: () => assert(edit(sample.value)),
            },
            p.capability.date.state.input
        );
    };
    const tree = () =>
        h(
            StrictMode,
            null,
            h(api.AirtableForm, {
                scope,
                renderers: {
                    renderDateField: renderDate,
                    renderDateTimeField: renderDate,
                },
                children: (snapshot) => {
                    last = snapshot;
                    return h(
                        'section',
                        null,
                        ...snapshot.fields.map((f) =>
                            h('div', { key: f.fieldId }, f.node)
                        ),
                        h(
                            'button',
                            {
                                id: 'next',
                                type: 'button',
                                onClick: () => {
                                    nextResult = snapshot.actions.next();
                                },
                            },
                            'Next'
                        ),
                        h(
                            'button',
                            {
                                id: 'submit',
                                type: 'button',
                                onClick: () => {
                                    submitResult = snapshot.actions.submit({
                                        lifecycle: f.lifecycle,
                                    });
                                    // Keep the browser event handler from emitting an unhandled rejection.
                                    submitResult.catch(() => {});
                                },
                            },
                            'Submit'
                        )
                    );
                },
            })
        );
    try {
        await act(async () => root.render(tree()));
        const staleActions = last.actions;
        await act(async () => host.querySelector('#edit-date').click());
        assert.equal(
            f.fields.field('answer').getSnapshot().value,
            sample.value
        );
        await act(async () => host.querySelector('#next').click());
        assert.equal(nextResult.accepted, false);
        await act(async () => host.querySelector('#submit').click());
        await assert.rejects(submitResult);
        await refuse(f, 'invalid-input');
        assert.equal(staleActions.next().accepted, false);
        await assert.rejects(staleActions.submit({ lifecycle: f.lifecycle }));
        await act(async () => root.unmount());
        root = createRoot(host);
        await act(async () => root.render(tree()));
        assert.equal(
            host.querySelector('#edit-date').textContent,
            f.fields.field('answer').date.getState().input
        );
        await act(async () => assert(edit(goodValue)));
        assert.deepEqual(f.pages.getSnapshot().problems, []);
        await act(async () => host.querySelector('#next').click());
        assert(nextResult.accepted);
        await act(async () => {
            host.querySelector('#submit').click();
            await submitResult;
        });
        assert.equal(f.calls.length, 1);
        assert.equal(f.attempts, 1);
        assert.deepEqual(f.calls[0], {
            ...f.expectedEnvelope,
            formRecord: {
                ...f.expectedEnvelope.formRecord,
                data: {
                    answer: goodValue,
                    next: 'retained',
                    unrendered: { exact: ['native'] },
                },
            },
            formFieldIdsWithUnsavedChanges: ['unrendered', 'answer'],
        });
        assert.equal(f.calls[0].formRecord.data.answer, goodValue);
        assert.deepEqual(f.calls[0].formRecord.data.unrendered, {
            exact: ['native'],
        });
        assert.deepEqual(
            new Set(f.calls[0].formFieldIdsWithUnsavedChanges),
            new Set(['unrendered', 'answer'])
        );
        const staleEdit = edit;
        await act(async () => f.bumpOwner());
        assert.equal(staleEdit(sample.value), false);
        assert.equal(f.calls.length, 1);
        assert.equal(f.attempts, 1);
    } finally {
        await act(async () => root.unmount());
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
