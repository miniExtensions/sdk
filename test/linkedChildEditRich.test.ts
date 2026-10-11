import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createFormLinkedRecordsOwner } from '../src/forms/linkedRecords.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import { createFormLinkedRecordLoader } from '../src/ui/loaders.js';
import { parentForm } from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';

for (const [supported, filtered] of [
    [true, false],
    [false, false],
    [true, true],
] as const) {
    it(`edited rich ${supported ? 'overlay' : 'tombstone'} survives binding notifications until a new accepted page (filtered=${filtered})`, async () => {
        const loaded = parentForm('edit');
        const id = 'fld_children_a';
        if (filtered)
            loaded.payload.fieldIdsToSchemas[id].miniExtConfig = {
                filterLinkedRecordsConditionFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'title',
                            type: 'singleCondition',
                            setting: {
                                fieldType: 'singleLineText',
                                type: 'is',
                                value: 'Fresh',
                                idOrName: { type: 'id', id: 'fld_title' },
                            },
                        },
                    ],
                },
            };
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
        const metadata =
            loaded.payload.fieldIdsToSchemas.fld_title.airtableField;
        let label = 'Old';
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw Error('Unexpected transport');
            },
        });
        client.linkedRecords.listFormOptions = async () => {
            const record = {
                id: 'rec_candidate',
                fields: { fld_title: label },
            };
            return {
                records: [record],
                offset: null,
                tableIdsToLinkedTableStates: {
                    tbl_child: {
                        airtableFields: [metadata],
                        recordIdsToAirtableRecords: { rec_candidate: record },
                    },
                },
                linkedRecordFieldIdToDetailFields: null,
            };
        };
        client.linkedRecords.loadSelectedRecords = async () => ({
            tbl_child: {
                airtableFields: [metadata],
                recordIdsToAirtableRecords: {
                    rec_existing: {
                        id: 'rec_existing',
                        fields: { fld_title: 'Original' },
                    },
                },
            },
        });
        const fields = createFormFieldBindings({
            loaded,
            client,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'synthetic', revision: 0 }),
        });
        fields.setLinkedLoader(
            id,
            createFormLinkedRecordLoader({
                client,
                linkedTableId: 'tbl_child',
                input: {
                    extensionAccessToken: loaded.payload.extensionAccessToken,
                    linkedRecordFieldId: id,
                    conditionalLinkedRecordFilteringValues: {},
                },
            })
        );
        const owner = createFormLinkedRecordsOwner({
            client,
            loaded,
            originalRecordData: loaded.payload.formRecord.data,
            field: (fieldId) => fields.field(fieldId),
            isCurrent: () => true,
        });
        try {
            const facet = owner.field(id);
            await facet.readSelected();
            const selection = fields.field(id).selection!;
            await selection.reload();
            assert.equal(
                fields.field(id).setValue(['rec_candidate']).accepted,
                true
            );
            // The page arrived before choosing; no facet listener is mounted.
            // Choosing must capture its accepted row even without a new page ticket.
            selection.setSearchInput('clear the current candidates');
            assert.deepEqual(facet.getSnapshot().unresolvedSelectedIds, []);
            assert.deepEqual(
                facet
                    .getSnapshot()
                    .selectedRecords.map((record) => record.fields.fld_title),
                filtered ? [] : ['Old']
            );
            await selection.reload();
            fields.controller.write(id, ['rec_candidate', 'rec_candidate']);
            const native = structuredClone(
                fields.controller.getState().draft?.data
            );
            if (supported && !filtered) {
                const created = owner.prepareCreated(
                    id,
                    {
                        id: 'rec_candidate',
                        fields: { fld_title: 'Created receipt' },
                    },
                    { airtableFields: [metadata] }
                );
                assert.ok(created);
                created();
                fields.controller.write(
                    'fld_title',
                    'Created presentation notification'
                );
                assert.deepEqual(
                    facet
                        .getSnapshot()
                        .selectedRecords.map(
                            (record) => record.fields.fld_title
                        ),
                    ['Created receipt', 'Created receipt']
                );
            }
            const install = owner.prepareEdited(
                id,
                {
                    id: 'rec_candidate',
                    fields: { fld_title: 'Edited', fld_private: 'Excluded' },
                },
                supported ? { airtableFields: [metadata] } : null
            );
            assert.ok(install);
            install();
            fields.controller.write('fld_title', 'Unrelated edit');
            const snapshot = facet.getSnapshot();
            assert.deepEqual(
                snapshot.unresolvedSelectedIds,
                supported ? [] : ['rec_candidate', 'rec_candidate']
            );
            assert.deepEqual(
                snapshot.selectedRecords,
                supported && !filtered
                    ? [
                          {
                              id: 'rec_candidate',
                              fields: { fld_title: 'Edited' },
                          },
                          {
                              id: 'rec_candidate',
                              fields: { fld_title: 'Edited' },
                          },
                      ]
                    : []
            );
            assert.deepEqual(
                snapshot.candidateRecords,
                supported
                    ? [{ id: 'rec_candidate', fields: { fld_title: 'Edited' } }]
                    : []
            );
            assert.equal(await facet.readSelected(), true);
            assert.deepEqual(
                facet.getSnapshot().unresolvedSelectedIds,
                snapshot.unresolvedSelectedIds
            );
            if (!supported) {
                fields.controller.write(id, []);
                assert.deepEqual(facet.getSnapshot().candidateRecords, []);
                label = 'Fresh unselected';
                await selection.reload();
                assert.deepEqual(facet.getSnapshot().candidateRecords, [
                    {
                        id: 'rec_candidate',
                        fields: { fld_title: 'Fresh unselected' },
                    },
                ]);
                assert.deepEqual(facet.getSnapshot().unresolvedSelectedIds, []);
                assert.deepEqual(facet.getSnapshot().selectedRecords, []);
                assert.equal(
                    fields.field(id).setValue(['rec_candidate']).accepted,
                    true
                );
                assert.deepEqual(facet.getSnapshot().selectedRecords, [
                    {
                        id: 'rec_candidate',
                        fields: { fld_title: 'Fresh unselected' },
                    },
                ]);
                fields.controller.write(id, ['rec_candidate', 'rec_candidate']);
            }
            label = 'Fresh';
            await selection.reload();
            assert.deepEqual(
                facet
                    .getSnapshot()
                    .selectedRecords.map((record) => record.fields.fld_title),
                ['Fresh', 'Fresh']
            );
            assert.deepEqual(
                fields.controller.getState().draft?.data[id],
                native?.[id]
            );
            assert.deepEqual(
                fields.controller.getState().draft?.data.fld_children_b,
                native?.fld_children_b
            );
        } finally {
            owner.destroy();
            fields.destroy();
        }
    });
}
