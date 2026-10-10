import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { reconcileLinkedChildCreate } from '../src/forms/linkedChildPolicy.js';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import { createFormLinkedRecordLoader } from '../src/ui/loaders.js';
import {
    RecoveryJournal,
    sameRecoveryRelationship,
    type RecoveryScope,
} from '../src/forms/recovery.js';
import type { AirtableRecord, AirtableValue } from '../src/runtime/types.js';
import { childForm, parentForm } from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';

type EditOracle = {
    revision: string;
    generator: string;
    generatorSha256: string;
    sourceHashes: Record<string, string>;
    reconciliationCases: Array<{
        name: string;
        parentMode: 'create' | 'edit';
        nativeIds: string[];
        savedId: string;
        inversePresent: boolean;
        inverseIds: string[] | null;
        expected: {
            nativeIds: string[];
            changed: boolean;
            createdExemption: false;
        };
    }>;
};
const oracle: EditOracle = JSON.parse(
    readFileSync('test/fixtures/linked-child-edit-canonical.json', 'utf8')
);
const fieldId = 'fld_children_a';
const relationship: RecoveryScope = {
    owner: 'synthetic_parent_owner',
    parentFieldId: fieldId,
    tableId: 'tbl_child',
    childExtensionId: 'form_child_synthetic',
    context: 'modal',
};

describe('pinned edit oracle and existing SDK create boundary', () => {
    it('binds the pure oracle to its generator without requiring a private source checkout', () => {
        assert.equal(
            oracle.revision,
            '4bf957c4830e6863972e45e52f2c371dc8ea9c77'
        );
        assert.equal(
            oracle.generator,
            'scripts/generate-linked-child-edit-fixture.mjs'
        );
        assert.equal(
            createHash('sha256')
                .update(readFileSync(oracle.generator))
                .digest('hex'),
            oracle.generatorSha256
        );
        // The generator owns source-byte verification and independent oracle
        // outputs. This metadata check grants no SDK edit or authorization credit.
        assert.ok(Object.keys(oracle.sourceHashes).length > 0);
        for (const digest of Object.values(oracle.sourceHashes))
            assert.match(digest, /^[a-f0-9]{64}$/);
    });

    it('refuses actual edit children for every canonical reconciliation branch without changing native or adjacent data', () => {
        const names = new Set<string>();
        for (const row of oracle.reconciliationCases) {
            assert.equal(names.has(row.name), false, row.name);
            names.add(row.name);
            const parent = parentForm(row.parentMode);
            // childForm(mode) describes the parent mode and always creates a
            // child. Install a genuine edit record explicitly for this contract.
            const child = childForm(row.parentMode);
            child.payload.formRecord = {
                type: 'edit',
                recordId: row.savedId,
                tableId: 'tbl_child',
                data: structuredClone(child.payload.formRecord.data),
            };
            const data: Record<string, AirtableValue> = {
                ...structuredClone(parent.payload.formRecord.data),
                [fieldId]: [...row.nativeIds],
            };
            const savedRecord: AirtableRecord = {
                id: row.savedId,
                fields: row.inversePresent
                    ? { fld_parent_a: row.inverseIds }
                    : {},
            };
            const before = structuredClone({
                parent,
                child,
                data,
                savedRecord,
            });
            assert.equal(row.expected.createdExemption, false, row.name);
            assert.deepEqual(
                reconcileLinkedChildCreate({
                    parent,
                    child,
                    data,
                    fieldId,
                    savedRecord,
                }),
                { type: 'unavailable', reason: 'invalid-metadata' },
                row.name
            );
            assert.deepEqual(
                { parent, child, data, savedRecord },
                before,
                row.name
            );
        }
        // This is a distinguishing create control, not an edit authority shim.
        assert.deepEqual(
            reconcileLinkedChildCreate({
                parent: parentForm('edit'),
                child: childForm('edit'),
                fieldId,
                data: { [fieldId]: ['rec_sibling'] },
                savedRecord: {
                    id: 'rec_created',
                    fields: { fld_parent_a: ['rec_parent'] },
                },
            }),
            {
                type: 'available',
                nativeIds: ['rec_sibling', 'rec_created'],
                changed: true,
                exemptCreatedRecord: true,
            }
        );
    });
});

describe('existing record-keyed child recovery journal', () => {
    it('keeps an uncertain edit guarded across child-extension changes while allowing another record', () => {
        const journal = new RecoveryJournal();
        const first = journal.begin(relationship, 'rec_existing', 'save', 1);
        const alternateForm = {
            ...relationship,
            childExtensionId: 'form_other_configured_child',
        };
        assert.equal(
            sameRecoveryRelationship(relationship, alternateForm),
            true
        );
        const before = structuredClone(first);
        assert.equal(journal.blocking(alternateForm, 'rec_existing'), first);
        assert.throws(
            () => journal.begin(alternateForm, 'rec_existing', 'save', 2),
            Error
        );
        assert.deepEqual(first, before);
        const other = journal.begin(relationship, 'rec_sibling', 'save', 2);
        assert.equal(journal.blocking(relationship, 'rec_sibling'), other);
        assert.equal(journal.blocking(relationship, 'rec_existing'), first);
        assert.equal(journal.blocking(relationship, null), undefined);
        journal.finishFlight(first);
        assert.equal(first.outcome, 'unknown');
        assert.equal(journal.blocking(relationship, 'rec_existing'), first);
        const siblingBefore = structuredClone(other);
        journal.acknowledgeExisting(first, 'rec_manually_found');
        assert.equal(first.outcome, 'unknown');
        assert.equal(first.recordId, 'rec_existing');
        assert.equal(first.associatedRecordId, 'rec_manually_found');
        assert.equal(journal.blocking(relationship, 'rec_existing'), undefined);
        assert.equal(journal.blocking(relationship, 'rec_sibling'), other);
        assert.deepEqual(other, siblingBefore);
    });

    it('does not expand an unknown record guard to another owner, field, table, or context', () => {
        const variants: RecoveryScope[] = [
            { ...relationship, owner: 'synthetic_other_owner' },
            { ...relationship, parentFieldId: 'fld_children_b' },
            { ...relationship, tableId: 'tbl_other_child' },
            { ...relationship, context: 'direct-url' },
        ];
        for (const scope of variants) {
            const journal = new RecoveryJournal();
            const original = journal.begin(
                relationship,
                'rec_existing',
                'save',
                1
            );
            const before = structuredClone(original);
            assert.equal(sameRecoveryRelationship(relationship, scope), false);
            assert.equal(journal.blocking(scope, 'rec_existing'), undefined);
            const independent = journal.begin(scope, 'rec_existing', 'save', 2);
            assert.notEqual(independent, original);
            assert.equal(journal.blocking(scope, 'rec_existing'), independent);
            assert.equal(
                journal.blocking(relationship, 'rec_existing'),
                original
            );
            assert.deepEqual(original, before);
        }
    });

    it('never repurposes a prepared attempt for a different record or relationship', () => {
        for (const scope of [
            relationship,
            { ...relationship, parentFieldId: 'fld_children_b' },
        ]) {
            const journal = new RecoveryJournal();
            const prepared = journal.prepare(relationship, 'rec_existing', 1);
            const before = structuredClone(prepared);
            const recordId =
                scope === relationship ? 'rec_sibling' : 'rec_existing';
            const active = journal.begin(
                scope,
                recordId,
                'save',
                2,
                null,
                prepared
            );
            assert.notEqual(active, prepared);
            assert.deepEqual(prepared, before);
            assert.equal(journal.blocking(scope, recordId), active);
            assert.equal(journal.notDispatched({ ...active }), false);
            assert.equal(active.outcome, 'unknown');
            assert.equal(journal.notDispatched(active), true);
            assert.equal(journal.blocking(scope, recordId), undefined);
        }
    });
});

describe('existing field-local accepted options and token-only hydration', () => {
    for (const filtered of [false, true]) {
        it(`refreshes accepted rich data only in its field and preserves selected policy (filtered=${filtered})`, async () => {
            const loaded = parentForm('edit');
            const field = loaded.payload.fieldIdsToSchemas[fieldId];
            if (filtered) {
                field.miniExtConfig = {
                    filterLinkedRecordsConditionFields: {
                        logicalOperator: 'and',
                        conditions: [
                            {
                                id: 'selected-title',
                                type: 'singleCondition',
                                setting: {
                                    fieldType: 'singleLineText',
                                    type: 'is',
                                    value: 'Allowed',
                                    idOrName: { type: 'id', id: 'fld_title' },
                                },
                            },
                        ],
                    },
                };
            }
            const metadata =
                loaded.payload.fieldIdsToSchemas.fld_title.airtableField;
            const selectedReads: unknown[] = [];
            let title = 'Before child edit';
            let optionReads = 0;
            const client = createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    throw Error('Unexpected transport call');
                },
            });
            client.linkedRecords.loadSelectedRecords = async (input) => {
                selectedReads.push(structuredClone(input));
                return {
                    tbl_child: {
                        airtableFields: [metadata],
                        recordIdsToAirtableRecords: {
                            rec_existing: {
                                id: 'rec_existing',
                                fields: { fld_title: 'Allowed' },
                            },
                            rec_sibling: {
                                id: 'rec_sibling',
                                fields: { fld_title: 'Allowed' },
                            },
                        },
                    },
                };
            };
            client.linkedRecords.listFormOptions = async () => {
                optionReads++;
                const record = {
                    id: 'rec_candidate',
                    fields: { fld_title: title },
                };
                return {
                    records: [record],
                    offset: null,
                    tableIdsToLinkedTableStates: {
                        tbl_child: {
                            airtableFields: [metadata],
                            recordIdsToAirtableRecords: {
                                rec_candidate: record,
                            },
                        },
                    },
                    linkedRecordFieldIdToDetailFields: null,
                };
            };
            const fields = createFormFieldBindings({
                loaded,
                client,
                saveOptions: formSaveOptions(),
                getScope: () => ({
                    ownerId: 'synthetic_parent_owner',
                    revision: 0,
                }),
            });
            try {
                fields.setLinkedLoader(
                    fieldId,
                    createFormLinkedRecordLoader({
                        client,
                        linkedTableId: 'tbl_child',
                        input: {
                            extensionAccessToken:
                                loaded.payload.extensionAccessToken,
                            linkedRecordFieldId: fieldId,
                            conditionalLinkedRecordFilteringValues: {},
                        },
                    })
                );
                const facet = fields.linkedRecords(fieldId);
                assert.equal(selectedReads.length, 0);
                assert.equal(optionReads, 0);
                assert.equal(await facet.readSelected(), true);
                const selection = fields.field(fieldId).selection;
                assert.ok(selection);
                await selection.reload();
                assert.equal(
                    fields.field(fieldId).setValue(['rec_candidate']).accepted,
                    true
                );
                fields.controller.write('fld_children_b', ['rec_candidate']);
                const sibling = fields.linkedRecords('fld_children_b');
                assert.deepEqual(sibling.getSnapshot().unresolvedSelectedIds, [
                    'rec_candidate',
                ]);
                const nativeBefore = structuredClone(
                    fields.controller.getState().draft?.data
                );
                title = 'After child edit';
                await selection.reload();
                assert.deepEqual(
                    facet.getSnapshot().selectedRecords,
                    filtered
                        ? []
                        : [
                              {
                                  id: 'rec_candidate',
                                  fields: { fld_title: 'After child edit' },
                              },
                          ]
                );
                assert.equal(
                    facet.getSnapshot().selectedPolicy.state,
                    filtered ? 'applied' : 'not-configured'
                );
                assert.deepEqual(facet.getSnapshot().unresolvedSelectedIds, []);
                assert.deepEqual(sibling.getSnapshot().selectedRecords, []);
                assert.deepEqual(sibling.getSnapshot().unresolvedSelectedIds, [
                    'rec_candidate',
                ]);
                assert.deepEqual(
                    fields.controller.getState().draft?.data,
                    nativeBefore
                );
                fields.setLinkedOptions(fieldId, []);
                assert.equal(facet.getSnapshot().phase, 'retired');
                const replacement = fields.linkedRecords(fieldId);
                assert.deepEqual(
                    replacement.getSnapshot().unresolvedSelectedIds,
                    ['rec_candidate']
                );
                assert.equal(await replacement.readSelected(), true);
                assert.deepEqual(replacement.getSnapshot().selectedRecords, []);
                assert.deepEqual(
                    replacement.getSnapshot().unresolvedSelectedIds,
                    ['rec_candidate']
                );
                assert.deepEqual(selectedReads, [
                    {
                        extensionAccessToken:
                            loaded.payload.extensionAccessToken,
                    },
                ]);
                assert.equal(optionReads, 2);
                assert.deepEqual(
                    fields.controller.getState().draft?.data,
                    nativeBefore
                );
            } finally {
                fields.destroy();
            }
        });
    }
});
