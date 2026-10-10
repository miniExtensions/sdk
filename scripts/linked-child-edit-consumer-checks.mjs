import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';

export const linkedChildEditTypedConsumer = `
import { RecoveryJournal, type FormFieldBindings, type FormLinkedChildSnapshot } from '@miniextensions/sdk/forms';
declare const parent: FormFieldBindings;
const owner = parent.linkedChild('children', { journal: new RecoveryJournal(), loadVersion: 1 });
const snapshot: FormLinkedChildSnapshot = owner.getSnapshot();
const editableIds: readonly string[] = snapshot.editableRecordIds;
owner.openEdit('record_selected', snapshot.revision, { clientTimeZone: 'UTC', signal: new AbortController().signal });
if (snapshot.intent?.type === 'edit') {
    const recordId: string = snapshot.intent.recordId;
    void recordId;
}
owner.save(snapshot.revision);
// @ts-expect-error an edit must capture the rendered revision
owner.openEdit('record_selected');
// @ts-expect-error completion receipts cannot be supplied by an application
owner.complete({ recordId: 'arbitrary' });
void editableIds;
`;

export const linkedChildEditConsumerCheckCount = 34;

const editChild = (fixtures, recordId) => {
    const child = fixtures.childForm('edit');
    child.payload.formRecord = {
        type: 'edit',
        recordId,
        tableId: 'tbl_child',
        data: structuredClone(child.payload.formRecord.data),
    };
    return child;
};

const deferred = () => {
    let resolve;
    const promise = new Promise((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};

function setup(forms, fixtures, readOnly = false, options = {}) {
    const loaded = options.parent ?? fixtures.parentForm('edit');
    let configuration = 0;
    let session = { visitor: 'synthetic-A' };
    Object.assign(
        loaded.payload.fieldIdsToSchemas.fld_children_a.miniExtConfig,
        {
            readOnly,
            allowCreatingRecords: false,
            extensionIdForEditing: 'form_child_synthetic',
            customMaxRecordsToSelect: 1,
            ...options.config,
        }
    );
    const calls = { reads: [], loads: [], saves: [] };
    const client = {
        getSession: () => ({ ...session }),
        linkedRecords: {
            loadSelectedRecords: async (input) => {
                calls.reads.push(structuredClone(input));
                return {
                    tbl_child: {
                        airtableFields: [
                            loaded.payload.fieldIdsToSchemas.fld_title
                                .airtableField,
                        ],
                        recordIdsToAirtableRecords: {
                            rec_existing: {
                                id: 'rec_existing',
                                fields: { fld_title: 'Existing' },
                            },
                            rec_sibling: {
                                id: 'rec_sibling',
                                fields: { fld_title: 'Sibling' },
                            },
                        },
                    },
                };
            },
        },
        loadExtension: async (input) => {
            calls.loads.push(structuredClone(input));
            if (options.load) return options.load(input);
            return editChild(
                fixtures,
                input.childExtensionInfo.accessType.childExtensionRecordId
            );
        },
        forms: {
            save: async (input) => {
                calls.saves.push(structuredClone(input));
                if (options.save) return options.save(input);
                const saved = fixtures.childSaved('edit');
                saved.record = {
                    id: input.formRecord.recordId,
                    fields: structuredClone(input.formRecord.data),
                };
                return saved;
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
    const fields = forms.createFormFieldBindings({
        loaded,
        client,
        getScope: () => ({ ownerId: 'synthetic-parent', revision: 0 }),
        configurationRevision: () => configuration,
        canWriteField: options.canWriteField,
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
        loaded,
        fields,
        owner,
        calls,
        client,
        journal,
        retireParent: () => {
            configuration++;
        },
        retireSession: () => {
            session = { visitor: 'synthetic-B' };
        },
    };
}

async function checkOwner(forms, fixtures) {
    let checks = 0;
    for (const readOnly of [false, true]) {
        const f = setup(forms, fixtures, readOnly);
        try {
            assert.deepEqual(f.calls, { reads: [], loads: [], saves: [] });
            assert.equal(
                await f.fields.linkedRecords('fld_children_a').readSelected(),
                true
            );
            assert.deepEqual(f.owner.getSnapshot().editableRecordIds, [
                'rec_existing',
                'rec_sibling',
            ]);
            assert.equal(f.owner.getSnapshot().canCreate, false);
            const rendered = f.owner.getSnapshot().revision;
            assert.equal(
                await f.owner.openEdit('rec_finder_only', rendered),
                false
            );
            assert.equal(f.calls.loads.length, 0);
            assert.equal(
                await f.owner.openEdit(
                    'rec_existing',
                    f.owner.getSnapshot().revision
                ),
                true
            );
            assert.deepEqual(f.owner.getSnapshot().intent, {
                type: 'edit',
                recordId: 'rec_existing',
            });
            assert.deepEqual(f.calls.loads[0].childExtensionInfo.accessType, {
                type: 'edit',
                childExtensionRecordId: 'rec_existing',
                childExtensionFieldId: null,
            });
            assert.deepEqual(f.calls.loads[0].query, {});
            assert.equal(
                f.calls.loads[0].context.prefillDataForLinkedRecordsForm
                    .prefillQueryForChildExtension,
                null
            );
            assert.equal(
                f.calls.loads[0].context.prefillDataForLinkedRecordsForm
                    .toLinkToParent,
                null
            );
            const child = f.owner.getSnapshot().child;
            assert(child);
            assert.equal(
                child.field('fld_title').setValue('Installed edit').accepted,
                true
            );
            const native = structuredClone(
                f.fields.controller.getState().draft.data
            );
            assert.equal(
                (await f.owner.save(f.owner.getSnapshot().revision)).type,
                'saved'
            );
            assert.equal(f.calls.saves[0].formRecord.type, 'edit');
            assert.equal(f.calls.saves[0].formRecord.recordId, 'rec_existing');
            assert.equal(
                f.calls.saves[0].formRecord.data.fld_title,
                'Installed edit'
            );
            assert.equal(
                f.calls.saves[0].formRecord.data.fld_unrendered,
                'Unrendered child synthetic value'
            );
            assert.deepEqual(f.calls.saves[0].formFieldIdsWithUnsavedChanges, [
                'fld_title',
            ]);
            assert.deepEqual(f.fields.controller.getState().draft.data, native);
            assert.equal(f.owner.getSnapshot().completion, 'reconciled');
            assert.deepEqual(f.calls.reads, [
                { extensionAccessToken: f.loaded.payload.extensionAccessToken },
            ]);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }
    return checks;
}

async function checkBoundedEditCases(forms, fixtures, ui) {
    let checks = 0;
    const saved = (id = 'rec_existing', inverse = ['rec_parent']) => {
        const result = fixtures.childSaved('edit');
        result.record = {
            id,
            fields: { fld_title: 'Edited existing', fld_parent_a: inverse },
        };
        return result;
    };
    const open = async (f, id = 'rec_existing') => {
        assert.equal(
            await f.fields.linkedRecords('fld_children_a').readSelected(),
            true
        );
        assert.equal(
            await f.owner.openEdit(id, f.owner.getSnapshot().revision),
            true
        );
    };
    const submit = (f) => f.owner.save(f.owner.getSnapshot().revision);

    {
        const f = setup(forms, fixtures, false, {
            save: async () => saved('rec_existing', []),
        });
        try {
            await open(f);
            const siblingBefore = structuredClone(
                f.fields.controller.getState().draft.data.fld_children_b
            );
            assert.equal((await submit(f)).type, 'saved');
            assert.deepEqual(
                f.fields.controller.getState().draft.data.fld_children_a,
                ['rec_sibling']
            );
            assert.deepEqual(
                f.fields.controller.getState().draft.data.fld_children_b,
                siblingBefore
            );
            assert.equal(f.owner.getSnapshot().completion, 'reconciled');
            assert.equal(f.journal.observed[0].outcome, 'saved');
            checks++;
        } finally {
            f.fields.destroy();
        }
    }

    for (const full of [false, true]) {
        const pending = deferred();
        const f = setup(forms, fixtures, false, {
            config: { customMaxRecordsToSelect: 3 },
            save: () => pending.promise,
        });
        try {
            await open(f);
            const flight = submit(f);
            await Promise.resolve();
            assert.equal(f.calls.saves.length, 1);
            const latest = full
                ? ['rec_sibling', 'rec_local_a', 'rec_local_b']
                : ['rec_sibling'];
            assert.equal(
                f.fields.controller.write('fld_children_a', latest),
                true
            );
            assert.equal(
                f.fields.controller.write('fld_title', 'Latest parent'),
                true
            );
            pending.resolve(saved());
            assert.equal((await flight).type, 'saved');
            assert.deepEqual(
                f.fields.controller.getState().draft.data.fld_children_a,
                full
                    ? ['rec_sibling', 'rec_local_a', 'rec_local_b']
                    : ['rec_sibling', 'rec_existing']
            );
            assert.equal(
                f.fields.controller.getState().draft.data.fld_title,
                'Latest parent'
            );
            assert.deepEqual(
                f.fields.controller.getState().draft.data.fld_children_b,
                ['rec_other_field']
            );
            assert.equal(
                f.owner.getSnapshot().completion,
                full ? 'saved-not-reconciled' : 'reconciled'
            );
            assert.equal(f.journal.observed[0].outcome, 'saved');
            assert.equal(f.calls.saves.length, 1);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }

    {
        const f = setup(forms, fixtures, true, {
            save: async () => saved('rec_existing', []),
        });
        try {
            await open(f);
            const before = structuredClone(
                f.fields.controller.getState().draft
            );
            assert.equal((await submit(f)).type, 'saved');
            assert.deepEqual(f.fields.controller.getState().draft, before);
            assert.equal(
                f.owner.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.equal(f.journal.observed[0].outcome, 'saved');
            checks++;
        } finally {
            f.fields.destroy();
        }
    }

    {
        const f = setup(forms, fixtures, false, {
            load: async () => editChild(fixtures, 'rec_wrong'),
        });
        try {
            await f.fields.linkedRecords('fld_children_a').readSelected();
            const before = structuredClone(
                f.fields.controller.getState().draft
            );
            assert.equal(
                await f.owner.openEdit(
                    'rec_existing',
                    f.owner.getSnapshot().revision
                ),
                false
            );
            assert.equal(f.owner.getSnapshot().child, null);
            assert.equal(f.owner.getSnapshot().pages, null);
            assert.deepEqual(f.fields.controller.getState().draft, before);
            assert.equal(f.calls.loads.length, 1);
            assert.equal(f.calls.saves.length, 0);
            assert.equal(f.journal.observed.length, 0);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }

    {
        const f = setup(forms, fixtures, false, {
            save: async () => saved('rec_wrong'),
        });
        try {
            await open(f);
            const before = structuredClone(
                f.fields.controller.getState().draft
            );
            await assert.rejects(submit(f));
            assert.deepEqual(f.fields.controller.getState().draft, before);
            assert.equal(f.journal.observed[0].outcome, 'unknown');
            f.owner.close();
            assert.equal(
                await f.owner.openEdit(
                    'rec_existing',
                    f.owner.getSnapshot().revision
                ),
                false
            );
            assert.equal(f.calls.loads.length, 1);
            assert.equal(f.calls.saves.length, 1);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }

    {
        const pending = deferred();
        const f = setup(forms, fixtures, false, {
            save: () => pending.promise,
        });
        try {
            await open(f);
            const before = structuredClone(
                f.fields.controller.getState().draft
            );
            const flight = submit(f);
            await Promise.resolve();
            assert.equal(f.calls.saves.length, 1);
            f.owner.close();
            pending.resolve(saved());
            await assert.rejects(flight);
            assert.deepEqual(f.fields.controller.getState().draft, before);
            assert.equal(f.journal.observed[0].recordId, 'rec_existing');
            assert.equal(f.journal.observed[0].outcome, 'unknown');
            assert.equal(
                await f.owner.openEdit(
                    'rec_existing',
                    f.owner.getSnapshot().revision
                ),
                false
            );
            assert.equal(
                await f.owner.openEdit(
                    'rec_sibling',
                    f.owner.getSnapshot().revision
                ),
                true
            );
            assert.equal(f.calls.loads.length, 2);
            assert.equal(f.calls.saves.length, 1);
            assert.equal(f.journal.observed.length, 1);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }

    for (const loss of ['session', 'configuration']) {
        for (const stage of ['before-load', 'before-save']) {
            const f = setup(forms, fixtures);
            try {
                await f.fields.linkedRecords('fld_children_a').readSelected();
                if (stage === 'before-save')
                    assert.equal(
                        await f.owner.openEdit(
                            'rec_existing',
                            f.owner.getSnapshot().revision
                        ),
                        true
                    );
                const rendered = f.owner.getSnapshot().revision;
                if (loss === 'session') f.retireSession();
                else f.retireParent();
                if (stage === 'before-load') {
                    assert.equal(
                        await f.owner.openEdit('rec_existing', rendered),
                        false
                    );
                    assert.equal(f.calls.loads.length, 0);
                } else {
                    await assert.rejects(f.owner.save(rendered));
                    assert.equal(f.calls.loads.length, 1);
                }
                assert.equal(f.calls.saves.length, 0);
                assert.equal(f.journal.observed.length, 0);
                checks++;
            } finally {
                f.fields.destroy();
            }
        }
    }

    {
        const pending = deferred();
        const f = setup(forms, fixtures, false, {
            save: () => pending.promise,
        });
        try {
            await open(f);
            const before = structuredClone(
                f.fields.controller.getState().draft.data
            );
            const flight = submit(f);
            await Promise.resolve();
            assert.equal(f.calls.saves.length, 1);
            f.retireParent();
            f.owner.getSnapshot();
            pending.resolve(saved('rec_existing', []));
            assert.equal((await flight).type, 'saved');
            assert.deepEqual(f.fields.controller.getState().draft.data, before);
            assert.equal(
                f.owner.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.equal(f.journal.observed[0].outcome, 'saved');
            assert.equal(f.calls.saves.length, 1);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }

    {
        let afterReceipt = false;
        let committing = false;
        let edited = false;
        let writeLatest;
        const f = setup(forms, fixtures, false, {
            save: async () => saved('rec_existing', []),
            afterAccepted: () => {
                afterReceipt = true;
            },
            canWriteField: (id) => {
                if (
                    id === 'fld_children_a' &&
                    afterReceipt &&
                    committing &&
                    !edited
                ) {
                    edited = true;
                    writeLatest();
                }
                return true;
            },
        });
        const originalWrite = f.fields.controller.write;
        f.fields.controller.write = (...args) => {
            if (afterReceipt && args[0] === 'fld_children_a') committing = true;
            try {
                return originalWrite(...args);
            } finally {
                committing = false;
            }
        };
        writeLatest = () => {
            assert.equal(
                originalWrite('fld_children_a', [
                    'rec_latest',
                    'rec_existing',
                    'rec_existing',
                ]),
                true
            );
        };
        try {
            await open(f);
            assert.equal((await submit(f)).type, 'saved');
            assert.equal(edited, true);
            assert.deepEqual(
                f.fields.controller.getState().draft.data.fld_children_a,
                ['rec_latest', 'rec_existing', 'rec_existing']
            );
            assert.equal(
                f.owner.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.equal(f.journal.observed[0].outcome, 'saved');
            assert.equal(f.calls.saves.length, 1);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }

    {
        const f = setup(forms, fixtures, false, {
            config: { customMaxRecordsToSelect: 4 },
        });
        f.client.linkedRecords.listFormOptions = async () => ({
            records: [
                { id: 'rec_candidate', fields: { fld_title: 'Candidate' } },
            ],
            offset: null,
            tableIdsToLinkedTableStates: {
                tbl_child: {
                    airtableFields: [
                        f.loaded.payload.fieldIdsToSchemas.fld_title
                            .airtableField,
                    ],
                    recordIdsToAirtableRecords: {
                        rec_candidate: {
                            id: 'rec_candidate',
                            fields: { fld_title: 'Candidate' },
                        },
                    },
                },
            },
            linkedRecordFieldIdToDetailFields: null,
        });
        try {
            f.fields.setLinkedLoader(
                'fld_children_a',
                ui.createFormLinkedRecordLoader({
                    client: f.client,
                    linkedTableId: 'tbl_child',
                    input: {
                        extensionAccessToken:
                            f.loaded.payload.extensionAccessToken,
                        linkedRecordFieldId: 'fld_children_a',
                        conditionalLinkedRecordFilteringValues: {},
                    },
                })
            );
            const selection = f.fields.field('fld_children_a').selection;
            assert(selection);
            await selection.reload();
            assert.equal(
                f.fields.field('fld_children_a').setValue(['rec_candidate'])
                    .accepted,
                true
            );
            assert.deepEqual(f.owner.getSnapshot().editableRecordIds, [
                'rec_candidate',
            ]);
            assert.equal(
                await f.owner.openEdit(
                    'rec_candidate',
                    f.owner.getSnapshot().revision
                ),
                true
            );
            assert.deepEqual(f.calls.reads, []);
            assert.equal(f.calls.loads.length, 1);
            assert.equal(
                f.calls.loads[0].childExtensionInfo.accessType
                    .childExtensionRecordId,
                'rec_candidate'
            );
            assert.equal(f.calls.saves.length, 0);
            checks++;
        } finally {
            f.fields.destroy();
        }
    }
    return checks;
}

async function checkBorrowedReactOwner(forms, fixtures, require, recipe) {
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
    const React = require('react');
    const { act, createElement: h, StrictMode } = React;
    const { createRoot } = require('react-dom/client');
    const f = setup(forms, fixtures);
    const Panel = recipe.createLinkedChildPanel(
        f.owner,
        f.fields.field('fld_children_a')
    );
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container);
    let mounted = false;
    const mount = async () => {
        await act(async () => root.render(h(StrictMode, null, h(Panel))));
        mounted = true;
    };
    try {
        await mount();
        assert.deepEqual(f.calls, { reads: [], loads: [], saves: [] });
        assert.equal(container.querySelector('#edit-child-rec_existing'), null);
        await act(async () =>
            f.fields.linkedRecords('fld_children_a').readSelected()
        );
        const editTrigger = container.querySelector('#edit-child-rec_existing');
        assert(editTrigger);
        await act(async () => editTrigger.click());
        assert.equal(f.calls.loads.length, 1);
        const child = f.owner.getSnapshot().child;
        assert(child);
        const staleRevision = f.owner.getSnapshot().revision;
        await act(async () => container.querySelector('#edit').click());
        await assert.rejects(f.owner.save(staleRevision));
        assert.equal(f.calls.saves.length, 0);
        await act(async () => root.unmount());
        mounted = false;
        assert.equal(f.owner.getSnapshot().child, child);
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
        assert.equal(f.calls.loads.length, 1);
        assert.equal(f.calls.reads.length, 1);
        assert.equal(f.calls.saves.length, 0);
        const nativeChild = structuredClone(
            child.controller.getState().draft.data
        );
        await act(async () => container.querySelector('#save').click());
        assert.equal(f.calls.saves.length, 1);
        assert.deepEqual(f.calls.saves[0].formRecord, {
            type: 'edit',
            recordId: 'rec_existing',
            tableId: 'tbl_child',
            data: nativeChild,
        });
        assert.deepEqual(f.calls.saves[0].formFieldIdsWithUnsavedChanges, [
            'fld_title',
        ]);
        assert.equal(f.calls.saves[0].formRecord.recordId, 'rec_existing');
        assert.equal(
            f.calls.saves[0].formRecord.data.fld_title,
            'Edited child'
        );
        assert.equal(
            f.calls.saves[0].formRecord.data.fld_unrendered,
            'Unrendered child synthetic value'
        );
        assert.deepEqual(
            f.fields.controller.getState().draft.data.fld_children_a,
            ['rec_existing', 'rec_existing', 'rec_sibling']
        );
        return 1;
    } finally {
        if (mounted) await act(async () => root.unmount());
        f.fields.destroy();
        container.remove();
        await window.happyDOM.abort();
        keys.forEach((key, index) =>
            previous[index]
                ? Object.defineProperty(globalThis, key, previous[index])
                : delete globalThis[key]
        );
    }
}

export async function checkLinkedChildEditConsumer({ consumerDirectory }) {
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
    const installedForms = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm/forms/index.js'
    );
    const esm = await import(pathToFileURL(installedForms));
    const esmUi = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/ui/index.js'
            )
        )
    );
    const guide = readFileSync(
        join(
            consumerDirectory,
            'node_modules/@miniextensions/sdk/docs/forms.md'
        ),
        'utf8'
    );
    const recipes = [...guide.matchAll(/```tsx\n([\s\S]*?)\n```/g)]
        .map(([, code]) => code)
        .filter((code) =>
            code.includes('export function createLinkedChildPanel(')
        );
    assert.equal(
        recipes.length,
        1,
        'Unique installed linked child panel recipe'
    );
    let checks = 0;
    for (const forms of [esm, require('@miniextensions/sdk/forms')]) {
        checks += await checkOwner(forms, fixtures);
        checks += await checkBoundedEditCases(
            forms,
            fixtures,
            forms === esm ? esmUi : require('@miniextensions/sdk/ui')
        );
        const format = forms === esm ? 'esm' : 'cjs';
        const transformed = await transform(recipes[0], {
            loader: 'tsx',
            format,
            target: 'es2022',
        });
        const recipePath = join(
            consumerDirectory,
            `installed-linked-child-edit.${format === 'esm' ? 'mjs' : 'cjs'}`
        );
        writeFileSync(recipePath, transformed.code);
        const recipe =
            format === 'esm'
                ? await import(pathToFileURL(recipePath))
                : require(recipePath);
        checks += await checkBorrowedReactOwner(
            forms,
            fixtures,
            require,
            recipe
        );
    }
    assert.equal(checks, linkedChildEditConsumerCheckCount);
    return checks;
}
