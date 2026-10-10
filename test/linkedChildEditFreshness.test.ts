import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type {
    ListLinkedRecordOptionsResult,
    LoadSelectedRecordsInput,
    RuntimeTableStates,
    SaveFormInput,
    SaveFormResult,
} from '../src/runtime/types.js';
import { createFormLinkedRecordLoader } from '../src/ui/loaders.js';
import {
    childForm,
    childSaved,
    parentForm,
} from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';

const fieldId = 'fld_children_a';
const otherFieldId = 'fld_children_b';
const recordId = 'rec_existing';
type Outcome = 'overlay' | 'tombstone' | 'filtered';
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return { promise, resolve };
};

// Canonical synthetic fixtures and public owner/transport boundaries only.
// In particular, an Edit result is installed by child Save, never prepareEdited.
const fixture = (outcome: Outcome = 'overlay', originallySelected = true) => {
    const loaded = parentForm('edit');
    loaded.payload.formRecord.data[fieldId] = originallySelected
        ? [recordId, recordId]
        : [];
    loaded.payload.formRecord.data[otherFieldId] = [recordId];
    for (const id of [fieldId, otherFieldId]) {
        loaded.payload.linkedRecordFieldIdToDetailFields[id] = [
            {
                fieldId: 'fld_title',
                fieldName: 'Title',
                titleOverride: null,
                miniExtConfig: {},
                isHidden: false,
                fieldIsInEditingChildForm: false,
                childFormField: null,
            },
        ];
    }
    if (outcome === 'filtered') {
        Object.assign(
            loaded.payload.fieldIdsToSchemas[fieldId].miniExtConfig!,
            {
                filterLinkedRecordsConditionFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'title',
                            type: 'singleCondition',
                            setting: {
                                fieldType: 'singleLineText',
                                type: 'is',
                                value: 'Old',
                                idOrName: { type: 'id', id: 'fld_title' },
                            },
                        },
                    ],
                },
            }
        );
    }
    const metadata = loaded.payload.fieldIdsToSchemas.fld_title.airtableField;
    const states = (
        title: string,
        includeTarget = true
    ): RuntimeTableStates => {
        const records: Array<{ id: string; fields: { fld_title: string } }> = [
            { id: 'rec_unrelated', fields: { fld_title: 'Unrelated' } },
            ...(includeTarget
                ? [{ id: recordId, fields: { fld_title: title } }]
                : []),
        ];
        return {
            tbl_child: {
                airtableFields: [metadata],
                recordIdsToAirtableRecords: Object.fromEntries(
                    records.map((row) => [row.id, row])
                ),
            },
        };
    };
    const page = (
        title: string,
        includeTarget = true
    ): ListLinkedRecordOptionsResult => {
        const tables = states(title, includeTarget);
        return {
            records: Object.values(tables.tbl_child.recordIdsToAirtableRecords),
            offset: null,
            tableIdsToLinkedTableStates: tables,
        };
    };
    const saved = (
        title = 'Edited'
    ): Extract<SaveFormResult, { type: 'saved' }> => {
        const result = childSaved('edit');
        result.record = {
            id: recordId,
            fields: {
                fld_title: title,
                fld_parent_a: ['rec_parent'],
                fld_private: 'Excluded',
            },
        };
        assert.equal(result.context.type, 'modal');
        if (result.context.type === 'modal') {
            result.context.newTableIdsToLinkedTableStates = {
                tbl_child: {
                    airtableFields: outcome === 'tombstone' ? [] : [metadata],
                    recordIdsToAirtableRecords: { [recordId]: result.record },
                },
            };
        }
        return result;
    };
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'synthetic-A' },
        fetch: async () => {
            throw Error('Unexpected real transport');
        },
    });
    const reads: LoadSelectedRecordsInput[] = [];
    const saves: SaveFormInput[] = [];
    let optionReads = 0;
    const handlers = {
        options: async () => page('Old'),
        selected: async () => states('Old'),
        save: async (): Promise<SaveFormResult> => saved(),
    };
    client.linkedRecords.listFormOptions = async () => {
        optionReads++;
        return handlers.options();
    };
    client.linkedRecords.loadSelectedRecords = async (input) => {
        reads.push(structuredClone(input));
        return handlers.selected();
    };
    client.loadExtension = async () => {
        const child = childForm('edit');
        child.payload.formRecord = {
            type: 'edit',
            recordId,
            tableId: 'tbl_child',
            data: structuredClone(child.payload.formRecord.data),
        };
        return child;
    };
    client.forms.save = async (input) => {
        saves.push(structuredClone(input));
        return handlers.save();
    };
    const fields = createFormFieldBindings({
        loaded,
        client,
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'synthetic-parent', revision: 0 }),
    });
    const loader = (id = fieldId) =>
        createFormLinkedRecordLoader({
            client,
            linkedTableId: 'tbl_child',
            input: {
                extensionAccessToken: loaded.payload.extensionAccessToken,
                linkedRecordFieldId: id,
                conditionalLinkedRecordFilteringValues: {},
            },
        });
    const journal = new RecoveryJournal();
    let owner = fields.linkedChild(fieldId, { journal, loadVersion: 1 });
    const snapshot = () => fields.linkedRecords(fieldId).getSnapshot();
    const expectEdit = (title = 'Edited') => {
        const value = snapshot();
        assert.deepEqual(
            value.selectedRecords,
            outcome === 'overlay'
                ? [
                      { id: recordId, fields: { fld_title: title } },
                      { id: recordId, fields: { fld_title: title } },
                  ]
                : []
        );
        assert.deepEqual(
            value.unresolvedSelectedIds,
            outcome === 'tombstone' ? [recordId, recordId] : []
        );
        if (outcome === 'filtered')
            assert.equal(value.selectedPolicy.state, 'applied');
    };
    const open = async () => {
        assert.equal(
            await owner.openEdit(recordId, owner.getSnapshot().revision),
            true
        );
        const child = owner.getSnapshot().child;
        assert.ok(child);
        assert.equal(
            child.field('fld_title').setValue('Edited').accepted,
            true
        );
    };
    const save = () => owner.save(owner.getSnapshot().revision);
    const edit = async () => {
        await open();
        assert.equal((await save()).type, 'saved');
    };
    const optionFlight = async () => {
        const started = deferred<void>();
        const response = deferred<ListLinkedRecordOptionsResult>();
        handlers.options = async () => {
            started.resolve();
            return response.promise;
        };
        const selection = fields.field(fieldId).selection;
        assert.ok(selection);
        const completion = selection.reload();
        await started.promise;
        return { completion, resolve: response.resolve };
    };
    const saveFlight = async () => {
        const started = deferred<void>();
        const response = deferred<SaveFormResult>();
        handlers.save = async () => {
            started.resolve();
            return response.promise;
        };
        const completion = save();
        await started.promise;
        return { completion, resolve: response.resolve };
    };
    const hydrationFlight = async () => {
        const started = deferred<void>();
        const response = deferred<RuntimeTableStates>();
        handlers.selected = async () => {
            started.resolve();
            return response.promise;
        };
        const completion = fields.linkedRecords(fieldId).readSelected();
        await started.promise;
        return { completion, resolve: response.resolve };
    };
    return {
        loaded,
        fields,
        handlers,
        reads,
        saves,
        page,
        states,
        saved,
        loader,
        snapshot,
        expectEdit,
        open,
        save,
        edit,
        optionFlight,
        saveFlight,
        hydrationFlight,
        owner: () => owner,
        recreateChild: () => {
            owner = fields.linkedChild(fieldId, { journal, loadVersion: 2 });
        },
        optionReads: () => optionReads,
        hydrate: () => fields.linkedRecords(fieldId).readSelected(),
        reload: async () => {
            const selection = fields.field(fieldId).selection;
            assert.ok(selection);
            await selection.reload();
        },
        native: () => structuredClone(fields.controller.getState().draft),
        close: () => {
            owner.close();
            fields.destroy();
        },
    };
};

describe('accepted Form linked child Edit rich-data freshness', () => {
    for (const outcome of ['overlay', 'tombstone', 'filtered'] as const) {
        for (const replacement of ['options', 'loader'] as const) {
            it(`${outcome} survives ${replacement} facade recreation and cached hydration`, async () => {
                const f = fixture(outcome);
                try {
                    await f.hydrate();
                    const native = f.native();
                    await f.edit();
                    f.expectEdit();
                    const old = f.fields.linkedRecords(fieldId);
                    if (replacement === 'options')
                        f.fields.setLinkedOptions(fieldId, []);
                    else f.fields.setLinkedLoader(fieldId, f.loader());
                    assert.equal(old.getSnapshot().phase, 'retired');
                    f.expectEdit();
                    assert.equal(await f.hydrate(), true);
                    f.expectEdit();
                    f.recreateChild();
                    f.expectEdit();
                    assert.deepEqual(
                        f.owner().getSnapshot().editableRecordIds,
                        outcome === 'overlay' ? [recordId] : []
                    );
                    assert.deepEqual(f.native(), native);
                    assert.equal(f.saves.length, 1);
                    assert.equal(f.reads.length, 1);
                    assert.equal(f.optionReads(), 0);
                } finally {
                    f.close();
                }
            });
        }

        for (const timing of ['before Save', 'during pending Save'] as const) {
            it(`${outcome} rejects stale rich data from options dispatched ${timing}`, async () => {
                const f = fixture(outcome);
                try {
                    f.fields.setLinkedLoader(fieldId, f.loader());
                    await f.hydrate();
                    const native = f.native();
                    await f.open();
                    if (timing === 'before Save') {
                        const options = await f.optionFlight();
                        assert.equal((await f.save()).type, 'saved');
                        f.expectEdit();
                        options.resolve(f.page('Old'));
                        await options.completion;
                    } else {
                        const save = await f.saveFlight();
                        const options = await f.optionFlight();
                        save.resolve(f.saved());
                        assert.equal((await save.completion).type, 'saved');
                        f.expectEdit();
                        options.resolve(f.page('Old'));
                        await options.completion;
                    }
                    f.expectEdit();
                    assert.deepEqual(f.native(), native);
                    assert.equal(f.optionReads(), 1);
                    assert.equal(f.reads.length, 1);
                    assert.equal(f.saves.length, 1);
                } finally {
                    f.close();
                }
            });
        }

        it(`${outcome} retains an omitted target and accepts a target from an explicit post-barrier option read`, async () => {
            const f = fixture(outcome);
            try {
                f.fields.setLinkedLoader(fieldId, f.loader());
                await f.hydrate();
                const native = f.native();
                await f.edit();
                f.handlers.options = async () => f.page('Fresh', false);
                await f.reload();
                f.expectEdit();
                assert.ok(
                    f
                        .snapshot()
                        .candidateRecords.some(
                            (row) => row.id === 'rec_unrelated'
                        )
                );
                f.handlers.options = async () =>
                    f.page(outcome === 'filtered' ? 'Old' : 'Fresh');
                await f.reload();
                assert.deepEqual(
                    f
                        .snapshot()
                        .selectedRecords.map((row) => row.fields.fld_title),
                    outcome === 'filtered' ? ['Old', 'Old'] : ['Fresh', 'Fresh']
                );
                assert.deepEqual(f.snapshot().unresolvedSelectedIds, []);
                f.fields.setLinkedOptions(fieldId, []);
                f.recreateChild();
                assert.deepEqual(
                    f
                        .snapshot()
                        .selectedRecords.map((row) => row.fields.fld_title),
                    outcome === 'filtered' ? ['Old', 'Old'] : ['Fresh', 'Fresh']
                );
                assert.deepEqual(f.snapshot().unresolvedSelectedIds, []);
                assert.deepEqual(f.native(), native);
                assert.equal(f.saves.length, 1);
                assert.equal(f.optionReads(), 2);
                assert.equal(f.reads.length, 1);
            } finally {
                f.close();
            }
        });

        for (const timing of [
            'before Save',
            'during pending Save',
            'after Edit',
        ] as const) {
            it(`${outcome} compares first token hydration dispatched ${timing} to the Edit barrier`, async () => {
                const f = fixture(outcome);
                try {
                    // Accepted SDK options give Edit eligibility without consuming
                    // the single token-selected hydration read.
                    f.fields.setLinkedLoader(fieldId, f.loader());
                    await f.reload();
                    assert.equal(f.reads.length, 0);
                    const native = f.native();
                    if (timing === 'before Save') {
                        await f.open();
                        const hydration = await f.hydrationFlight();
                        assert.equal((await f.save()).type, 'saved');
                        hydration.resolve(f.states('Old'));
                        assert.equal(await hydration.completion, true);
                        f.expectEdit();
                    } else if (timing === 'during pending Save') {
                        await f.open();
                        const save = await f.saveFlight();
                        const hydration = await f.hydrationFlight();
                        save.resolve(f.saved());
                        assert.equal((await save.completion).type, 'saved');
                        hydration.resolve(f.states('Old'));
                        assert.equal(await hydration.completion, true);
                        f.expectEdit();
                    } else {
                        await f.edit();
                        f.expectEdit();
                        f.handlers.selected = async () =>
                            f.states(
                                outcome === 'filtered'
                                    ? 'Old'
                                    : 'Hydrated fresh'
                            );
                        assert.equal(await f.hydrate(), true);
                        assert.deepEqual(
                            f
                                .snapshot()
                                .selectedRecords.map(
                                    (row) => row.fields.fld_title
                                ),
                            outcome === 'filtered'
                                ? ['Old', 'Old']
                                : ['Hydrated fresh', 'Hydrated fresh']
                        );
                        assert.deepEqual(
                            f.snapshot().unresolvedSelectedIds,
                            []
                        );
                    }
                    assert.equal(await f.hydrate(), true);
                    assert.deepEqual(f.reads, [
                        {
                            extensionAccessToken:
                                f.loaded.payload.extensionAccessToken,
                        },
                    ]);
                    assert.equal(f.optionReads(), 1);
                    assert.equal(f.saves.length, 1);
                    assert.deepEqual(f.native(), native);
                } finally {
                    f.close();
                }
            });
        }
    }

    for (const first of ['hydration', 'options'] as const) {
        it(`keeps the later dispatched post-Edit target when ${first} finishes last`, async () => {
            const f = fixture();
            try {
                f.fields.setLinkedLoader(fieldId, f.loader());
                await f.reload();
                const native = f.native();
                await f.edit();
                if (first === 'hydration') {
                    const earlier = await f.hydrationFlight();
                    const later = await f.optionFlight();
                    later.resolve(f.page('Later options'));
                    await later.completion;
                    earlier.resolve(f.states('Earlier hydration'));
                    assert.equal(await earlier.completion, true);
                    f.expectEdit('Later options');
                } else {
                    const earlier = await f.optionFlight();
                    const later = await f.hydrationFlight();
                    later.resolve(f.states('Later hydration'));
                    assert.equal(await later.completion, true);
                    earlier.resolve(f.page('Earlier options'));
                    await earlier.completion;
                    f.expectEdit('Later hydration');
                }
                f.fields.setLinkedOptions(fieldId, []);
                f.expectEdit(
                    first === 'hydration' ? 'Later options' : 'Later hydration'
                );
                assert.deepEqual(f.native(), native);
                assert.equal(f.saves.length, 1);
                assert.equal(f.reads.length, 1);
                assert.equal(f.optionReads(), 2);
            } finally {
                f.close();
            }
        });
    }

    it('does not grant token hydration authority for a target selected after the original Form load', async () => {
        const f = fixture('overlay', false);
        try {
            f.fields.setLinkedLoader(fieldId, f.loader());
            await f.reload();
            assert.equal(
                f.fields.field(fieldId).setValue([recordId]).accepted,
                true
            );
            const native = f.native();
            await f.edit();
            assert.deepEqual(f.snapshot().selectedRecords, [
                { id: recordId, fields: { fld_title: 'Edited' } },
            ]);
            f.handlers.selected = async () =>
                f.states('Token response for another original field');
            assert.equal(await f.hydrate(), true);
            assert.deepEqual(f.snapshot().selectedRecords, [
                { id: recordId, fields: { fld_title: 'Edited' } },
            ]);
            // The same record was originally selected in the other field, but
            // that token response does not expand this field's original IDs.
            assert.deepEqual(
                f.fields.linkedRecords(otherFieldId).getSnapshot()
                    .selectedRecords,
                [
                    {
                        id: recordId,
                        fields: {
                            fld_title:
                                'Token response for another original field',
                        },
                    },
                ]
            );
            f.fields.setLinkedOptions(fieldId, []);
            assert.deepEqual(f.snapshot().selectedRecords, [
                { id: recordId, fields: { fld_title: 'Edited' } },
            ]);
            assert.deepEqual(f.native(), native);
            assert.equal(f.saves.length, 1);
            assert.equal(f.reads.length, 1);
            assert.equal(f.optionReads(), 1);
        } finally {
            f.close();
        }
    });

    it('replaces each successive Edit barrier independently of an intervening accepted read', async () => {
        const f = fixture();
        try {
            f.fields.setLinkedLoader(fieldId, f.loader());
            await f.hydrate();
            const native = f.native();
            await f.edit();
            f.handlers.options = async () => f.page('Between edits');
            await f.reload();
            assert.deepEqual(
                f.snapshot().selectedRecords.map((row) => row.fields.fld_title),
                ['Between edits', 'Between edits']
            );
            await f.open();
            const options = await f.optionFlight();
            f.handlers.save = async () => f.saved('Second edit');
            assert.equal((await f.save()).type, 'saved');
            options.resolve(f.page('Between edits'));
            await options.completion;
            f.expectEdit('Second edit');
            f.fields.setLinkedOptions(fieldId, []);
            f.expectEdit('Second edit');
            assert.equal(f.saves.length, 2);
            assert.equal(f.optionReads(), 2);
            assert.equal(f.reads.length, 1);
            assert.deepEqual(f.native(), native);
        } finally {
            f.close();
        }
    });

    it('keeps Edit state and accepted option freshness local to each field sharing a table', async () => {
        const f = fixture();
        try {
            f.fields.setLinkedLoader(fieldId, f.loader());
            f.fields.setLinkedLoader(otherFieldId, f.loader(otherFieldId));
            await f.hydrate();
            const other = f.fields.linkedRecords(otherFieldId);
            const native = f.native();
            await f.edit();
            f.expectEdit();
            assert.deepEqual(
                other
                    .getSnapshot()
                    .selectedRecords.map((row) => row.fields.fld_title),
                ['Old']
            );
            f.handlers.options = async () => f.page('Other field fresh');
            const selection = f.fields.field(otherFieldId).selection;
            assert.ok(selection);
            await selection.reload();
            assert.deepEqual(
                other
                    .getSnapshot()
                    .selectedRecords.map((row) => row.fields.fld_title),
                ['Other field fresh']
            );
            f.expectEdit();
            f.fields.setLinkedOptions(fieldId, []);
            f.expectEdit();
            assert.deepEqual(
                other
                    .getSnapshot()
                    .selectedRecords.map((row) => row.fields.fld_title),
                ['Other field fresh']
            );
            assert.deepEqual(f.native(), native);
            assert.equal(f.saves.length, 1);
            assert.equal(f.reads.length, 1);
            assert.equal(f.optionReads(), 1);
        } finally {
            f.close();
        }
    });

    it('retires pending reads with their accepted owner and does not transfer Edit state to a successor', async () => {
        const f = fixture();
        const successor = fixture();
        try {
            f.fields.setLinkedLoader(fieldId, f.loader());
            await f.reload();
            await f.open();
            const hydration = await f.hydrationFlight();
            assert.equal((await f.save()).type, 'saved');
            f.expectEdit();
            const oldFacet = f.fields.linkedRecords(fieldId);
            const options = await f.optionFlight();
            f.fields.destroy();
            hydration.resolve(f.states('Old'));
            options.resolve(f.page('Old'));
            assert.equal(await hydration.completion, false);
            await options.completion;
            assert.equal(oldFacet.getSnapshot().phase, 'retired');
            assert.deepEqual(oldFacet.getSnapshot().selectedRecords, []);
            await successor.hydrate();
            assert.deepEqual(
                successor
                    .snapshot()
                    .selectedRecords.map((row) => row.fields.fld_title),
                ['Old', 'Old']
            );
            assert.equal(f.saves.length, 1);
            assert.equal(f.reads.length, 1);
            assert.equal(f.optionReads(), 2);
            assert.equal(successor.saves.length, 0);
        } finally {
            f.close();
            successor.close();
        }
    });
});
