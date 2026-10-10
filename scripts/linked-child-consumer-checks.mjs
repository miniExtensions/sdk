import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

export const linkedChildTypedConsumer = `
import { RecoveryJournal, type FormFieldBindings, type FormLinkedChildSnapshot } from '@miniextensions/sdk/forms';
declare const parent: FormFieldBindings;
const owner = parent.linkedChild('children', {journal:new RecoveryJournal(),loadVersion:1});
const snapshot: FormLinkedChildSnapshot = owner.getSnapshot();
owner.openCreate();
owner.save(snapshot.revision);
owner.close();
// @ts-expect-error completion receipts cannot be supplied by an application
owner.complete({recordId:'arbitrary'});
// @ts-expect-error a rendered revision is required
owner.save();
void [snapshot.child,snapshot.pages,snapshot.completion];
`;

const deferred = () => {
    let resolve;
    const promise = new Promise((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};

async function checkCoordinator(forms, fixtures) {
    let checks = 0;
    const setup = (options = {}) => {
        const mode = options.mode ?? 'create';
        const loaded = options.parent ?? fixtures.parentForm(mode);
        let configuration = 0,
            session = { visitor: 'synthetic-A' };
        const calls = { loads: [], saves: [] };
        const client = {
            getSession: () => session,
            loadExtension: async (input) => {
                calls.loads.push(structuredClone(input));
                return options.load ? options.load() : fixtures.childForm(mode);
            },
            forms: {
                save: async (input) => {
                    calls.saves.push(structuredClone(input));
                    return options.save
                        ? options.save()
                        : fixtures.childSaved(mode);
                },
            },
            attachments: {
                uploadFile: async () => {
                    throw Error('Unexpected upload');
                },
            },
        };
        class ObservedJournal extends forms.RecoveryJournal {
            observed = [];
            prepare(...args) {
                const attempt = super.prepare(...args);
                this.observed.push(attempt);
                return attempt;
            }
            accepted(...args) {
                super.accepted(...args);
                options.afterAccepted?.();
            }
        }
        const journal = new ObservedJournal();
        let fields;
        fields = forms.createFormFieldBindings({
            loaded,
            client,
            getScope: () => ({ ownerId: 'synthetic', revision: 0 }),
            configurationRevision: () => configuration,
            canWriteField: (fieldId) =>
                fields && options.canWriteField
                    ? options.canWriteField(fieldId, fields, journal)
                    : true,
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                searchQuery: {},
                context: { type: 'direct-url' },
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        const owner = fields.linkedChild('fld_children_a', {
            journal,
            loadVersion: 1,
        });
        return {
            fields,
            owner,
            journal,
            calls,
            native: () =>
                fields.controller.getState().draft?.data.fld_children_a,
            retireParent: () => {
                configuration++;
            },
            retireSession: () => {
                session = { visitor: 'synthetic-B' };
            },
        };
    };
    {
        let armed = true,
            reentries = 0,
            hiddenOwner,
            reentryError;
        const f = setup({
            canWriteField(fieldId, fields, journal) {
                if (armed && fieldId === 'fld_children_a') {
                    armed = false;
                    reentries++;
                    try {
                        hiddenOwner = fields.linkedChild(fieldId, {
                            journal,
                            loadVersion: 1,
                        });
                    } catch (error) {
                        reentryError = error;
                    }
                }
                return true;
            },
        });
        try {
            assert.equal(reentries, 1);
            assert.equal(hiddenOwner, undefined);
            assert.match(reentryError?.message ?? '', /being initialized/);
            assert.equal(
                f.fields.linkedChild('fld_children_a', {
                    journal: f.journal,
                    loadVersion: 1,
                }),
                f.owner
            );
            assert.deepEqual(f.calls, { loads: [], saves: [] });
            assert(await f.owner.openCreate());
            assert.equal(
                (await f.owner.save(f.owner.getSnapshot().revision)).type,
                'saved'
            );
            assert.equal(f.owner.getSnapshot().completion, 'reconciled');
            assert.equal(f.calls.loads.length, 1);
            assert.equal(f.calls.saves.length, 1);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }
    for (const present of [false, true]) {
        const f = setup();
        try {
            assert(await f.owner.openCreate());
            const latest = present
                ? ['rec_created', 'rec_created', 'rec_sibling']
                : ['rec_new_sibling', 'rec_existing', 'rec_existing'];
            assert(f.fields.controller.write('fld_children_a', latest));
            const draftRevision = f.fields.controller.getState().draftRevision;
            const dirtyFieldIds = structuredClone(
                f.fields.controller.getState().draft.dirtyFieldIds
            );
            assert.equal(
                (await f.owner.save(f.owner.getSnapshot().revision)).type,
                'saved'
            );
            assert.deepEqual(
                f.native(),
                present ? latest : [...latest, 'rec_created']
            );
            if (present)
                assert.equal(
                    f.fields.controller.getState().draftRevision,
                    draftRevision
                );
            if (present)
                assert.deepEqual(
                    f.fields.controller.getState().draft.dirtyFieldIds,
                    dirtyFieldIds
                );
            assert.equal(f.owner.getSnapshot().completion, 'reconciled');
            checks++;
        } finally {
            f.fields.destroy();
        }
    }
    for (const loss of ['parent', 'session', 'close', 'capacity']) {
        const pending = deferred(),
            parent = fixtures.parentForm();
        if (loss === 'capacity')
            parent.payload.fieldIdsToSchemas.fld_children_a.miniExtConfig.customMaxRecordsToSelect = 4;
        const f = setup({ parent, save: () => pending.promise });
        try {
            assert(await f.owner.openCreate());
            const flight = f.owner.save(f.owner.getSnapshot().revision);
            await Promise.resolve();
            assert.equal(f.calls.saves.length, 1);
            if (loss === 'parent') f.retireParent();
            if (loss === 'session') f.retireSession();
            if (loss === 'close') f.owner.close();
            const latest = [
                'rec_existing',
                'rec_existing',
                'rec_sibling',
                'rec_latest',
            ];
            if (loss === 'capacity')
                f.fields.controller.write('fld_children_a', latest);
            f.owner.getSnapshot();
            pending.resolve(fixtures.childSaved());
            if (loss === 'session' || loss === 'close')
                await assert.rejects(flight);
            else {
                assert.equal((await flight).type, 'saved');
                assert.equal(
                    f.owner.getSnapshot().completion,
                    'saved-not-reconciled'
                );
            }
            if (loss === 'capacity') assert.deepEqual(f.native(), latest);
            if (loss === 'close')
                assert.deepEqual(
                    f.native(),
                    parent.payload.formRecord.data.fld_children_a
                );
            assert.equal(await f.owner.openCreate(), false);
            assert.equal(f.calls.loads.length, 1);
            assert.equal(f.calls.saves.length, 1);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }
    // Descriptor shape matches the generated runtime contract and typed fixture.
    const filterDescriptor = {
        idOrName: { type: 'id', id: 'fld_parent_a' },
        config: { type: 'multipleRecordLinks', config: { title: 'Parent' } },
    };
    for (const configuration of [
        { dynamicFilteringToggle: true },
        { conditionalLinkedRecordFilterFields: [filterDescriptor] },
        {
            dynamicFilteringToggle: false,
            conditionalLinkedRecordFilterFields: [filterDescriptor],
        },
    ]) {
        const child = fixtures.childForm();
        Object.assign(
            child.payload.fieldIdsToSchemas.fld_parent_a.miniExtConfig,
            configuration
        );
        const f = setup({ load: () => child });
        try {
            const before = structuredClone(f.fields.controller.getState());
            const snapshots = [];
            const unsubscribe = f.owner.subscribe((snapshot) =>
                snapshots.push(snapshot)
            );
            try {
                assert.equal(await f.owner.openCreate(), false);
            } finally {
                unsubscribe();
            }
            assert.equal(f.owner.getSnapshot().child, null);
            assert.equal(f.owner.getSnapshot().pages, null);
            assert(
                snapshots.every(
                    (snapshot) =>
                        snapshot.child === null &&
                        snapshot.pages === null &&
                        snapshot.phase !== 'ready'
                )
            );
            assert.equal(f.calls.loads.length, 1);
            assert.equal(f.calls.saves.length, 0);
            assert.equal(f.journal.observed.length, 0);
            assert.deepEqual(f.fields.controller.getState(), before);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }
    for (const configuration of [
        {},
        { conditionalLinkedRecordFilterFields: null },
        { conditionalLinkedRecordFilterFields: [] },
        { dynamicFilteringToggle: false },
        {
            dynamicFilteringToggle: false,
            conditionalLinkedRecordFilterFields: [],
        },
    ]) {
        const child = fixtures.childForm();
        Object.assign(
            child.payload.fieldIdsToSchemas.fld_parent_a.miniExtConfig,
            configuration
        );
        const f = setup({ load: () => child });
        try {
            assert(await f.owner.openCreate());
            assert.equal(f.owner.getSnapshot().phase, 'ready');
            assert(f.owner.getSnapshot().child);
            assert(f.owner.getSnapshot().pages);
            assert.equal(
                (await f.owner.save(f.owner.getSnapshot().revision)).type,
                'saved'
            );
            assert.equal(f.owner.getSnapshot().completion, 'reconciled');
            assert.equal(f.journal.observed.at(-1)?.outcome, 'saved');
            assert.equal(f.calls.saves.length, 1);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }
    for (const stage of ['policy', 'final-canAccept']) {
        const parent = fixtures.parentForm();
        parent.payload.formRecord.data.fld_children_a = [
            'rec_created',
            'rec_sibling',
        ];
        let afterReceipt = false,
            inPolicy = false,
            policyRead = false,
            reentries = 0;
        const f = setup({
            parent,
            afterAccepted() {
                afterReceipt = true;
            },
            canWriteField(fieldId, fields) {
                if (
                    afterReceipt &&
                    fieldId === 'fld_children_a' &&
                    reentries === 0 &&
                    (stage === 'policy' ? inPolicy : policyRead && !inPolicy)
                ) {
                    reentries++;
                    assert(fields.controller.write(fieldId, ['rec_reentrant']));
                }
                return true;
            },
        });
        const facet = f.fields.linkedRecords('fld_children_a');
        const getSnapshot = facet.getSnapshot;
        facet.getSnapshot = () => {
            inPolicy = true;
            try {
                return getSnapshot();
            } finally {
                inPolicy = false;
                if (afterReceipt) policyRead = true;
            }
        };
        const completions = [];
        const stop = f.owner.subscribe((snapshot) =>
            completions.push(snapshot.completion)
        );
        try {
            assert(await f.owner.openCreate());
            const receipt = await f.owner.save(f.owner.getSnapshot().revision);
            assert.equal(receipt.type, 'saved');
            assert.equal(receipt.raw.record.id, 'rec_created');
            assert.equal(reentries, 1, stage);
            assert.equal(
                f.owner.getSnapshot().completion,
                'saved-not-reconciled',
                stage
            );
            assert(!completions.includes('reconciled'));
            assert.deepEqual(f.native(), ['rec_reentrant']);
            assert.equal(f.journal.observed.length, 1);
            assert.equal(f.journal.observed[0].outcome, 'saved');
            const linked = facet.getSnapshot();
            assert.deepEqual(linked.selectedRecords, []);
            assert.deepEqual(linked.unresolvedSelectedIds, ['rec_reentrant']);
            assert(
                !linked.candidateRecords.some(
                    (record) => record.id === 'rec_created'
                )
            );
            assert.equal(f.calls.saves.length, 1);
            checks++;
        } finally {
            stop();
            f.fields.destroy();
        }
    }
    for (const invalid of [
        'table',
        'extension',
        'review',
        'compute',
        'multipage',
    ]) {
        const child = fixtures.childForm();
        if (invalid === 'table')
            child.payload.publicFields.state.tableId = 'tbl_wrong';
        if (invalid === 'extension') child.extensionId = 'form_wrong';
        if (invalid === 'review')
            child.payload.publicFields.state.promptUserBeforeSubmission = true;
        if (invalid === 'compute')
            child.payload.publicFields.state.enableFormComputeMode = true;
        if (invalid === 'multipage')
            child.payload.publicFields.state.multiPageFormMode = 'multi-page';
        const f = setup({ load: async () => child });
        try {
            assert.equal(await f.owner.openCreate(), false);
            assert.equal(f.owner.getSnapshot().child, null);
            assert.equal(f.calls.saves.length, 0);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }
    {
        const parent = fixtures.parentForm('edit'),
            pending = deferred();
        const query = 'prefill_Title=Frozen%20child&same=one&same=two';
        Object.assign(
            parent.payload.fieldIdsToSchemas.fld_children_a.miniExtConfig,
            {
                prefillChildFormForCreatingRecords: true,
                prefillFieldForCreatingChildExtension: 'fld_title',
            }
        );
        parent.payload.formRecord.data.fld_title = query;
        const f = setup({ mode: 'edit', parent, load: () => pending.promise });
        try {
            const opening = f.owner.openCreate();
            await Promise.resolve();
            f.fields.field('fld_title').setValue('Changed after open');
            pending.resolve(fixtures.childForm('edit'));
            assert(await opening);
            await f.owner.save(f.owner.getSnapshot().revision);
            assert.deepEqual(f.calls.loads[0].query, {
                prefill_Title: 'Frozen child',
                same: 'two',
            });
            assert.deepEqual(
                f.calls.saves[0].searchQuery,
                f.calls.loads[0].query
            );
            assert.deepEqual(
                f.calls.saves[0].context.prefillData,
                f.calls.loads[0].context.prefillDataForLinkedRecordsForm
            );
            checks++;
        } finally {
            f.fields.destroy();
        }
    }
    return checks;
}

export async function checkLinkedChildConsumer({ consumerDirectory }) {
    const bundled = await build({
        entryPoints: [
            new URL('../test/formLinkedChildFixtures.ts', import.meta.url)
                .pathname,
        ],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
    });
    const fixtures = await import(
        `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
    );
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const apis = await Promise.all(
        ['forms', 'ui', 'react'].map(
            (e) => import(pathToFileURL(join(esm, e, 'index.js')))
        )
    );
    const guide = readFileSync(
        join(
            consumerDirectory,
            'node_modules/@miniextensions/sdk/docs/forms.md'
        ),
        'utf8'
    );
    const blocks = [...guide.matchAll(/```tsx\n([\s\S]*?)\n```/g)]
        .map(([, code]) => code)
        .filter((code) =>
            code.includes('export function createLinkedChildPanel(')
        );
    assert.equal(blocks.length, 1, 'Unique installed linked child recipe');
    let checks = 0;
    for (const [forms, ui, react] of [
        apis,
        ['forms', 'ui', 'react'].map((e) =>
            require(`@miniextensions/sdk/${e}`)
        ),
    ]) {
        checks += await checkCoordinator(forms, fixtures);
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
        const previous = keys.map((k) =>
            Object.getOwnPropertyDescriptor(globalThis, k)
        );
        keys.forEach((k) =>
            Object.defineProperty(globalThis, k, {
                configurable: true,
                writable: true,
                value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[k],
            })
        );
        const React = require('react');
        const { act, createElement: h, StrictMode } = React;
        const { createRoot } = require('react-dom/client');
        const calls = { loads: [], saves: [] };
        let result = fixtures.validationError;
        let context = { ownerId: 'synthetic-parent', revision: 0 };
        const client = {
            getSession: () => ({}),
            loadExtension: async (input) => {
                calls.loads.push(structuredClone(input));
                return fixtures.childForm();
            },
            forms: {
                save: async (input) => {
                    calls.saves.push(structuredClone(input));
                    return structuredClone(result);
                },
            },
            attachments: {
                uploadFile: async () => {
                    throw Error('Unexpected upload');
                },
            },
        };
        const loaded = fixtures.parentForm();
        loaded.payload.fieldIdsToSchemas.fld_children_a.miniExtConfig.conditionalFields =
            {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'synthetic-visible',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'singleLineText',
                            idOrName: { type: 'id', id: 'fld_title' },
                            value: 'Parent native title',
                        },
                    },
                ],
            };
        const fields = forms.createFormFieldBindings({
            loaded,
            client,
            getScope: () => context,
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                searchQuery: {},
                context: { type: 'direct-url' },
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        // Acquired before mounting; React borrows rather than owns this coordinator.
        const owner = fields.linkedChild('fld_children_a', {
            journal: new forms.RecoveryJournal(),
            loadVersion: 1,
        });
        const format = forms === apis[0] ? 'esm' : 'cjs';
        const transformed = await transform(blocks[0], {
            loader: 'tsx',
            format,
            target: 'es2022',
        });
        const recipePath = join(
            consumerDirectory,
            `installed-linked-child.${format === 'esm' ? 'mjs' : 'cjs'}`
        );
        writeFileSync(recipePath, transformed.code);
        const recipe =
            format === 'esm'
                ? await import(pathToFileURL(recipePath))
                : require(recipePath);
        const Component = recipe.createLinkedChildPanel(
            owner,
            fields.field('fld_children_a')
        );
        const container = window.document.createElement('div');
        window.document.body.append(container);
        let root = createRoot(container),
            mounted = false;
        const mount = async () => {
            await act(async () =>
                root.render(h(StrictMode, null, h(Component)))
            );
            mounted = true;
        };
        try {
            await mount();
            assert.deepEqual(calls, { loads: [], saves: [] });
            await act(async () => container.querySelector('#create').click());
            assert.equal(calls.loads.length, 1);
            assert.deepEqual(calls.loads[0], fixtures.childLoadInput());
            const child = owner.getSnapshot().child;
            const stale = owner.getSnapshot().revision;
            await act(async () => container.querySelector('#edit').click());
            await assert.rejects(owner.save(stale));
            assert.equal(calls.saves.length, 0);
            await act(async () => root.unmount());
            mounted = false;
            assert.equal(owner.getSnapshot().child, child);
            assert.equal(
                child.field('fld_title').getSnapshot().value,
                'Edited child'
            );
            root = createRoot(container);
            await mount();
            assert.equal(
                container.querySelector('#edit').textContent,
                'Edited child'
            );
            assert.equal(calls.loads.length, 1);
            await act(async () => container.querySelector('#save').click());
            assert.equal(calls.saves.length, 1);
            assert.equal(owner.getSnapshot().phase, 'ready');
            assert.equal(
                child.controller.getState().draft.data.fld_unrendered,
                'Unrendered child synthetic value'
            );
            assert.equal(
                calls.saves[0].formRecord.data.fld_title,
                'Edited child'
            );
            assert(
                calls.saves[0].formFieldIdsWithUnsavedChanges.includes(
                    'fld_title'
                )
            );
            result = fixtures.childSaved();
            await act(async () => container.querySelector('#save').click());
            assert.equal(calls.saves.length, 2);
            assert.equal(owner.getSnapshot().completion, 'reconciled');
            assert.deepEqual(
                fields.field('fld_children_a').getSnapshot().value,
                ['rec_existing', 'rec_existing', 'rec_sibling', 'rec_created']
            );
            assert.equal(
                fields.field('fld_children_a').getSnapshot().dirty,
                true
            );
            assert.equal(
                fields.controller.getState().draft.data.fld_unrendered,
                'Unrendered synthetic value'
            );
            await act(async () => container.querySelector('#close').click());
            assert.equal(owner.getSnapshot().child, null);
            await act(async () =>
                fields.field('fld_title').setValue('Hidden parent')
            );
            assert.equal(container.textContent, '');
            assert.equal(await owner.openCreate(), false);
            assert.equal(calls.loads.length, 1);
            await act(async () => {
                context = { ownerId: 'retired', revision: 1 };
                fields.refresh();
            });
            assert.equal(owner.getSnapshot().phase, 'retired');
            assert.equal(container.textContent, '');
            assert.equal(await owner.openCreate(), false);
            assert.equal(calls.loads.length, 1);
            checks++;
        } finally {
            if (mounted) await act(async () => root.unmount());
            fields.destroy();
            container.remove();
            await window.happyDOM.abort();
            keys.forEach((k, i) =>
                previous[i]
                    ? Object.defineProperty(globalThis, k, previous[i])
                    : delete globalThis[k]
            );
        }
    }
    console.log(
        `Installed linked child CREATE: ${checks} ESM/CJS React recipes; synthetic transport only, no persistence proof.`
    );
    return checks;
}
