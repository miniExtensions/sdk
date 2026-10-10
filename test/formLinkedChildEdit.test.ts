import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import {
    RecoveryJournal,
    type RecoveryAttempt,
} from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type {
    FormLoadedResult,
    LoadExtensionInput,
    SaveFormInput,
    SaveFormResult,
    LoadSelectedRecordsInput,
} from '../src/runtime/types.js';
import {
    childForm,
    childSaved,
    parentForm,
} from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';

const fieldId = 'fld_children_a';
const existingId = 'rec_existing';
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};
const editChild = (recordId = existingId) => {
    const loaded = childForm('edit');
    loaded.payload.formRecord = {
        type: 'edit',
        recordId,
        tableId: 'tbl_child',
        data: structuredClone(loaded.payload.formRecord.data),
    };
    return loaded;
};
const editSaved = (recordId = existingId, inverse = ['rec_parent']) => {
    const result = childSaved('edit');
    result.record.id = recordId;
    result.record.fields.fld_parent_a = inverse;
    return result;
};
class ObservedJournal extends RecoveryJournal {
    readonly observed: RecoveryAttempt[] = [];
    afterAccepted: (() => void) | null = null;
    override prepare(...args: Parameters<RecoveryJournal['prepare']>) {
        const attempt = super.prepare(...args);
        this.observed.push(attempt);
        return attempt;
    }
    override accepted(...args: Parameters<RecoveryJournal['accepted']>) {
        super.accepted(...args);
        this.afterAccepted?.();
    }
}
const fixture = (
    options: {
        parent?: FormLoadedResult;
        load?: (input: LoadExtensionInput) => Promise<FormLoadedResult>;
        save?: () => Promise<SaveFormResult>;
        canWriteField?: (id: string) => boolean;
    } = {}
) => {
    const loaded = options.parent ?? parentForm('edit');
    const loads: LoadExtensionInput[] = [];
    const saves: SaveFormInput[] = [];
    const reads: LoadSelectedRecordsInput[] = [];
    const journal = new ObservedJournal();
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'synthetic-A' },
        fetch: async () => {
            throw Error('Unexpected real transport');
        },
    });
    client.linkedRecords.loadSelectedRecords = async (input) => {
        reads.push(structuredClone(input));
        const title = loaded.payload.fieldIdsToSchemas.fld_title.airtableField;
        return {
            tbl_child: {
                airtableFields: [title],
                recordIdsToAirtableRecords: Object.fromEntries(
                    [existingId, 'rec_sibling', 'rec_other_field'].map((id) => [
                        id,
                        { id, fields: { fld_title: 'Allowed' } },
                    ])
                ),
            },
        };
    };
    client.loadExtension = async (input) => {
        loads.push(structuredClone(input));
        if (options.load) return options.load(input);
        const access =
            'childExtensionInfo' in input
                ? input.childExtensionInfo.accessType
                : undefined;
        assert.equal(access?.type, 'edit');
        return editChild(
            access?.type === 'edit' ? access.childExtensionRecordId : existingId
        );
    };
    client.forms.save = async (input) => {
        saves.push(structuredClone(input));
        return options.save ? options.save() : editSaved();
    };
    const fields = createFormFieldBindings({
        loaded,
        client,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'synthetic-parent', revision: 0 }),
        canWriteField: options.canWriteField,
    });
    const owner = fields.linkedChild(fieldId, { journal, loadVersion: 1 });
    return {
        loaded,
        fields,
        owner,
        client,
        journal,
        loads,
        saves,
        reads,
        hydrate: () => fields.linkedRecords(fieldId).readSelected(),
        open: (id = existingId) =>
            owner.openEdit(id, owner.getSnapshot().revision),
        save: () => owner.save(owner.getSnapshot().revision),
        native: () => fields.controller.getState().draft!.data[fieldId],
        close: () => {
            owner.close();
            fields.destroy();
        },
    };
};
const configured = (config: Record<string, unknown>) => {
    const parent = parentForm('edit');
    Object.assign(
        parent.payload.fieldIdsToSchemas[fieldId].miniExtConfig!,
        config
    );
    return parent;
};

describe('owner-held selected linked child EDIT', () => {
    for (const readOnly of [false, true]) {
        it(`opens selected records at full capacity with parent readOnly=${readOnly} and creation disabled`, async () => {
            const f = fixture({
                parent: configured({
                    readOnly,
                    allowCreatingRecords: false,
                    extensionIdForEditing: 'form_child_synthetic',
                    customMaxRecordsToSelect: 1,
                }),
            });
            try {
                assert.deepEqual(f.owner.getSnapshot().editableRecordIds, []);
                assert.deepEqual(f.loads, []);
                assert.equal(await f.hydrate(), true);
                assert.deepEqual(f.owner.getSnapshot().editableRecordIds, [
                    existingId,
                    'rec_sibling',
                ]);
                assert.equal(f.owner.getSnapshot().canCreate, false);
                assert.equal(await f.open(), true);
                assert.deepEqual(f.owner.getSnapshot().intent, {
                    type: 'edit',
                    recordId: existingId,
                });
                assert.equal(f.loads.length, 1);
                assert.equal(f.saves.length, 0);
                assert.deepEqual(f.native(), [
                    existingId,
                    existingId,
                    'rec_sibling',
                ]);
            } finally {
                f.close();
            }
        });
    }

    it('uses captured edit access, no creation query, applicable parent relation, native data and dirty IDs', async () => {
        const parent = configured({
            prefillChildFormForCreatingRecords: true,
            prefillFieldForCreatingChildExtension: 'fld_title',
            loggedInUserRecordsViewMode: 'only-record-linked-to-user',
        });
        parent.payload.formRecord.data.fld_title =
            'prefill_Title=Create%20only';
        const f = fixture({ parent });
        try {
            await f.hydrate();
            assert.equal(await f.open(), true);
            assert.deepEqual(f.loads, [
                {
                    childExtensionAccessData: {
                        parentExtensionAccessToken: 'synthetic_parent_token',
                        fieldIdUsedToAccessExtension: fieldId,
                    },
                    childExtensionInfo: {
                        childExtensionId: 'form_child_synthetic',
                        accessType: {
                            type: 'edit',
                            childExtensionRecordId: existingId,
                            childExtensionFieldId: null,
                        },
                    },
                    context: {
                        type: 'modal',
                        linkedTableIdOfLinkedRecordField: 'tbl_child',
                        prefillDataForLinkedRecordsForm: {
                            toLinkToParent: {
                                reversedFieldIdToPrefill: 'fld_parent_a',
                                parentFormRecordId: 'rec_parent',
                            },
                            prefillQueryForChildExtension: null,
                        },
                    },
                    query: {},
                },
            ]);
            const child = f.owner.getSnapshot().child;
            assert.ok(child);
            assert.equal(
                child.field('fld_title').setValue('Edited child title')
                    .accepted,
                true
            );
            const childData = structuredClone(
                child.controller.getState().draft!.data
            );
            const parentBefore = structuredClone(
                f.fields.controller.getState().draft
            );
            assert.equal((await f.save()).type, 'saved');
            assert.deepEqual(f.saves, [
                {
                    extensionAccessToken: 'synthetic_child_token',
                    formRecord: {
                        type: 'edit',
                        recordId: existingId,
                        tableId: 'tbl_child',
                        data: childData,
                    },
                    formFieldIdsWithUnsavedChanges: ['fld_title'],
                    captchaVal: null,
                    isComputeMode: false,
                    searchQuery: {},
                    context: {
                        type: 'modal',
                        prefillData:
                            f.loads[0].context.type === 'modal'
                                ? f.loads[0].context
                                      .prefillDataForLinkedRecordsForm
                                : null,
                    },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            ]);
            assert.deepEqual(
                f.fields.controller.getState().draft,
                parentBefore
            );
            assert.equal(f.owner.getSnapshot().completion, 'reconciled');
            assert.equal(f.journal.observed[0].recordId, existingId);
            assert.equal(f.journal.observed[0].outcome, 'saved');
        } finally {
            f.close();
        }
    });

    it('refuses stale renders, filtered selections and finder-only records before loading', async () => {
        const parent = configured({
            filterLinkedRecordsConditionFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'selected-title',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'singleLineText',
                            value: 'Denied',
                            idOrName: { type: 'id', id: 'fld_title' },
                        },
                    },
                ],
            },
        });
        const filtered = fixture({ parent });
        const normal = fixture();
        try {
            await filtered.hydrate();
            assert.deepEqual(
                filtered.owner.getSnapshot().editableRecordIds,
                []
            );
            assert.equal(await filtered.open(), false);
            await normal.hydrate();
            const rendered = normal.owner.getSnapshot().revision;
            normal.fields.controller.write('fld_children_a', [existingId]);
            assert.equal(
                await normal.owner.openEdit(existingId, rendered),
                false
            );
            assert.equal(await normal.open('rec_finder_only'), false);
            assert.deepEqual(filtered.loads, []);
            assert.deepEqual(normal.loads, []);
            assert.deepEqual(normal.saves, []);
        } finally {
            filtered.close();
            normal.close();
        }
    });

    it('does not expose edit actions when editing is disabled, even with selected rich records', async () => {
        const f = fixture({
            parent: configured({ allowEditingRecords: false }),
        });
        try {
            await f.hydrate();
            assert.deepEqual(f.owner.getSnapshot().editableRecordIds, []);
            assert.equal(await f.open(), false);
            assert.equal(f.loads.length, 0);
            assert.equal(f.saves.length, 0);
        } finally {
            f.close();
        }
    });

    it('requires the current child render revision before dispatching an edit Save', async () => {
        const f = fixture();
        try {
            await f.hydrate();
            assert.equal(await f.open(), true);
            const rendered = f.owner.getSnapshot().revision;
            const child = f.owner.getSnapshot().child;
            assert.ok(child);
            assert.equal(
                child.field('fld_title').setValue('New child draft').accepted,
                true
            );
            await assert.rejects(f.owner.save(rendered));
            assert.equal(f.saves.length, 0);
            assert.equal(f.journal.observed.length, 0);
        } finally {
            f.close();
        }
    });

    for (const inverse of [['rec_parent'], []]) {
        it(`reconciles current native order and every duplicate with inverse=${JSON.stringify(inverse)}`, async () => {
            const pending = deferred<SaveFormResult>();
            const f = fixture({ save: () => pending.promise });
            try {
                await f.hydrate();
                assert.equal(await f.open(), true);
                const flight = f.save();
                await Promise.resolve();
                const latest = [
                    'rec_new_sibling',
                    existingId,
                    'rec_middle',
                    existingId,
                ];
                f.fields.controller.write(fieldId, latest);
                f.fields.controller.write('fld_title', 'Newer parent title');
                f.fields.controller.write('fld_children_b', [
                    'rec_new_other_field',
                ]);
                const before = structuredClone(
                    f.fields.controller.getState().draft!.data
                );
                pending.resolve(editSaved(existingId, inverse));
                assert.equal((await flight).type, 'saved');
                assert.deepEqual(f.fields.controller.getState().draft!.data, {
                    ...before,
                    [fieldId]: inverse.length
                        ? latest
                        : ['rec_new_sibling', 'rec_middle'],
                });
                assert.equal(f.owner.getSnapshot().completion, 'reconciled');
                assert.equal(f.saves.length, 1);
            } finally {
                f.close();
            }
        });
    }

    for (const capacityFull of [false, true]) {
        it(`readds a locally removed edited record only when spare capacity remains (${capacityFull})`, async () => {
            const pending = deferred<SaveFormResult>();
            const f = fixture({
                parent: configured({ customMaxRecordsToSelect: 3 }),
                save: () => pending.promise,
            });
            try {
                await f.hydrate();
                assert.equal(await f.open(), true);
                const flight = f.save();
                await Promise.resolve();
                const latest = capacityFull
                    ? ['rec_sibling', 'rec_new_a', 'rec_new_b']
                    : ['rec_sibling'];
                f.fields.controller.write(fieldId, latest);
                pending.resolve(editSaved());
                assert.equal((await flight).type, 'saved');
                assert.deepEqual(
                    f.native(),
                    capacityFull ? latest : [...latest, existingId]
                );
                assert.equal(
                    f.owner.getSnapshot().completion,
                    capacityFull ? 'saved-not-reconciled' : 'reconciled'
                );
                assert.equal(f.journal.observed[0].outcome, 'saved');
                assert.equal(f.saves.length, 1);
            } finally {
                f.close();
            }
        });
    }

    for (const changed of [false, true]) {
        it(`parent read-only accepts known edit receipt and reconciles only a native no-op (${changed})`, async () => {
            const f = fixture({
                parent: configured({ readOnly: true }),
                save: async () =>
                    editSaved(existingId, changed ? [] : ['rec_parent']),
            });
            try {
                await f.hydrate();
                assert.equal(await f.open(), true);
                const before = structuredClone(
                    f.fields.controller.getState().draft
                );
                assert.equal((await f.save()).type, 'saved');
                assert.deepEqual(f.fields.controller.getState().draft, before);
                assert.equal(
                    f.owner.getSnapshot().completion,
                    changed ? 'saved-not-reconciled' : 'reconciled'
                );
                assert.equal(f.journal.observed[0].outcome, 'saved');
            } finally {
                f.close();
            }
        });
    }

    for (const mismatch of [
        'id',
        'type',
        'extension',
        'table',
        'record-table',
    ] as const) {
        it(`refuses a mismatched ${mismatch} load without exposing a child draft`, async () => {
            const loaded = editChild();
            if (mismatch === 'id' && loaded.payload.formRecord.type === 'edit')
                loaded.payload.formRecord.recordId = 'rec_wrong';
            if (mismatch === 'type')
                loaded.payload.formRecord = { type: 'create', data: {} };
            if (mismatch === 'extension') loaded.extensionId = 'form_wrong';
            if (mismatch === 'table')
                loaded.payload.publicFields.state.tableId = 'tbl_wrong';
            if (
                mismatch === 'record-table' &&
                loaded.payload.formRecord.type === 'edit'
            )
                loaded.payload.formRecord.tableId = 'tbl_wrong';
            const f = fixture({ load: async () => loaded });
            try {
                await f.hydrate();
                const before = structuredClone(
                    f.fields.controller.getState().draft
                );
                assert.equal(await f.open(), false);
                assert.equal(f.owner.getSnapshot().child, null);
                assert.equal(f.owner.getSnapshot().pages, null);
                assert.deepEqual(f.fields.controller.getState().draft, before);
                assert.equal(f.loads.length, 1);
                assert.equal(f.saves.length, 0);
                assert.equal(f.journal.observed.length, 0);
            } finally {
                f.close();
            }
        });
    }

    for (const mismatch of ['id', 'table', 'context'] as const) {
        it(`mismatched ${mismatch} receipt remains unknown and cannot mutate parent links`, async () => {
            const result = editSaved();
            if (mismatch === 'id') result.record.id = 'rec_wrong';
            if (mismatch === 'table') result.tableId = 'tbl_wrong';
            if (mismatch === 'context') result.context = { type: 'direct-url' };
            const f = fixture({ save: async () => result });
            try {
                await f.hydrate();
                assert.equal(await f.open(), true);
                const before = structuredClone(
                    f.fields.controller.getState().draft
                );
                await assert.rejects(f.save());
                assert.deepEqual(f.fields.controller.getState().draft, before);
                assert.equal(f.journal.observed[0].outcome, 'unknown');
                f.owner.close();
                assert.equal(await f.open(), false);
                assert.equal(f.loads.length, 1);
                assert.equal(f.saves.length, 1);
            } finally {
                f.close();
            }
        });
    }

    it('closing an in-flight edit preserves record-keyed uncertainty without replay or sibling expansion', async () => {
        const pending = deferred<SaveFormResult>();
        const f = fixture({ save: () => pending.promise });
        try {
            await f.hydrate();
            assert.equal(await f.open(), true);
            const before = structuredClone(
                f.fields.controller.getState().draft
            );
            const flight = f.save();
            await Promise.resolve();
            assert.equal(f.saves.length, 1);
            f.owner.close();
            pending.resolve(editSaved());
            await assert.rejects(flight);
            assert.equal(f.journal.observed[0].outcome, 'unknown');
            assert.deepEqual(f.fields.controller.getState().draft, before);
            assert.equal(await f.open(), false);
            assert.equal(await f.open('rec_sibling'), true);
            assert.equal(f.loads.length, 2);
            assert.equal(f.saves.length, 1);
            assert.equal(f.journal.observed.length, 1);
        } finally {
            f.close();
        }
    });

    it('cancels a pending edit load and refuses its late draft without saving', async () => {
        const pending = deferred<FormLoadedResult>();
        const f = fixture({ load: () => pending.promise });
        try {
            await f.hydrate();
            const abort = new AbortController();
            const opening = f.owner.openEdit(
                existingId,
                f.owner.getSnapshot().revision,
                { signal: abort.signal }
            );
            abort.abort();
            pending.resolve(editChild());
            assert.equal(await opening, false);
            assert.equal(f.owner.getSnapshot().child, null);
            assert.equal(f.saves.length, 0);
            assert.equal(f.journal.observed.length, 0);
        } finally {
            f.close();
        }
    });

    it('a native edit from the final permission callback survives known child unlink reconciliation', async () => {
        let afterReceipt = false;
        let committing = false;
        let edited = false;
        let writeLatest: (() => void) | null = null;
        const latest = ['rec_latest', existingId, existingId];
        const f = fixture({
            save: async () => editSaved(existingId, []),
            canWriteField: (id) => {
                if (id === fieldId && afterReceipt && committing && !edited) {
                    edited = true;
                    writeLatest?.();
                }
                return true;
            },
        });
        const originalWrite = f.fields.controller.write;
        f.fields.controller.write = (id, value, afterCommit) => {
            if (afterReceipt && id === fieldId) committing = true;
            try {
                return originalWrite(id, value, afterCommit);
            } finally {
                committing = false;
            }
        };
        writeLatest = () => {
            assert.equal(originalWrite(fieldId, latest), true);
        };
        f.journal.afterAccepted = () => {
            afterReceipt = true;
        };
        try {
            await f.hydrate();
            assert.equal(await f.open(), true);
            assert.equal((await f.save()).type, 'saved');
            assert.equal(edited, true);
            assert.deepEqual(f.native(), latest);
            assert.equal(
                f.owner.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.equal(f.journal.observed[0].outcome, 'saved');
            assert.equal(f.saves.length, 1);
        } finally {
            f.close();
        }
    });
});
