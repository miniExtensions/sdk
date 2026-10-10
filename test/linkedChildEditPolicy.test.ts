import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { AirtableRecord } from '../src/runtime/types.js';
import {
    resolveLinkedChildEditPolicy,
    reconcileLinkedChildEdit,
} from '../src/forms/linkedChildPolicy.js';
import type { FormLinkedRecordsSnapshot } from '../src/forms/linkedRecords.js';
import { childForm, parentForm } from './formLinkedChildFixtures.js';

const fieldId = 'fld_children_a';
const recordId = 'rec_existing';
const snapshot = (): FormLinkedRecordsSnapshot => ({
    phase: 'ready',
    pending: false,
    error: null,
    linkedTableId: 'tbl_child',
    selectedRecords: [
        { id: recordId, fields: {} },
        { id: recordId, fields: {} },
        { id: 'rec_sibling', fields: {} },
    ],
    unresolvedSelectedIds: [],
    candidateRecords: [],
    table: { airtableFields: [] },
    detailFields: null,
    detailProjection: 'null',
    selectedPolicy: {
        supported: true,
        reasons: [],
        state: 'not-configured',
        diagnostics: [],
    },
});
const plan = (parent = parentForm('edit'), facet = snapshot(), id = recordId) =>
    resolveLinkedChildEditPolicy({
        loaded: parent,
        fieldId,
        recordId: id,
        data: parent.payload.formRecord.data,
        linkedRecords: facet,
    });
const editChild = () => {
    const child = childForm('edit');
    child.payload.formRecord = {
        type: 'edit',
        recordId,
        tableId: 'tbl_child',
        data: child.payload.formRecord.data,
    };
    return child;
};

describe('internal linked child EDIT policy', () => {
    it('admits readonly full-capacity displayed rows and keeps native duplicate occurrences', () => {
        const parent = parentForm('edit');
        const schema = parent.payload.fieldIdsToSchemas[fieldId];
        schema.miniExtConfig = {
            ...schema.miniExtConfig,
            readOnly: true,
            customMaxRecordsToSelect: 1,
        };
        const result = plan(parent);
        assert.equal(result.type, 'available');
        if (result.type !== 'available') return;
        assert.deepEqual(result.nativeIds, [recordId, recordId, 'rec_sibling']);
        assert.deepEqual(result.displayedRecordIds, [recordId, 'rec_sibling']);
        assert.equal(result.prefill.prefillQueryForChildExtension, null);
        assert.equal(result.prefill.toLinkToParent, null);
    });
    it('rejects finder-only, filtered-out and unresolved selected targets', () => {
        const facet = snapshot();
        facet.selectedRecords = [];
        facet.candidateRecords = [{ id: recordId, fields: {} }];
        assert.deepEqual(plan(parentForm('edit'), facet), {
            type: 'unavailable',
            reason: 'unavailable-edit-record',
        });
        facet.selectedRecords = snapshot().selectedRecords;
        facet.unresolvedSelectedIds = [recordId];
        assert.deepEqual(plan(parentForm('edit'), facet), {
            type: 'unavailable',
            reason: 'unavailable-selected-policy',
        });
        assert.equal(
            plan(parentForm('edit'), snapshot(), 'rec_finder').type,
            'unavailable'
        );
    });
    it('accepts an idle accepted table and a resolved target despite unresolved siblings', () => {
        const parent = parentForm('edit');
        parent.payload.formRecord.data[fieldId] = [
            recordId,
            recordId,
            'rec_unresolved',
        ];
        const facet = snapshot();
        facet.phase = 'idle';
        facet.selectedRecords = [
            { id: recordId, fields: {} },
            { id: recordId, fields: {} },
        ];
        facet.unresolvedSelectedIds = ['rec_unresolved'];
        assert.equal(plan(parent, facet).type, 'available');
        facet.pending = true;
        assert.equal(plan(parent, facet).type, 'unavailable');
        facet.pending = false;
        facet.selectedPolicy.state = 'waiting-data';
        assert.equal(plan(parent, facet).type, 'unavailable');
    });
    it('executes pinned configured edit-extension cases', () => {
        const oracle: {
            editExtensionCases: Array<{
                name: string;
                config: Record<string, unknown>;
                expected: string | null;
            }>;
        } = JSON.parse(
            readFileSync(
                'test/fixtures/linked-child-edit-canonical.json',
                'utf8'
            )
        );
        for (const row of oracle.editExtensionCases) {
            const parent = parentForm('edit');
            parent.payload.fieldIdsToSchemas[fieldId].miniExtConfig =
                row.config;
            const result = plan(parent);
            if (row.expected === null)
                assert.equal(result.type, 'unavailable', row.name);
            else {
                assert.equal(result.type, 'available', row.name);
                if (result.type === 'available')
                    assert.equal(
                        result.childExtensionId,
                        row.expected,
                        row.name
                    );
            }
        }
    });
    it('preserves applicable relationship context on EDIT without create query', () => {
        const parent = parentForm('edit');
        const schema = parent.payload.fieldIdsToSchemas[fieldId];
        schema.miniExtConfig = {
            ...schema.miniExtConfig,
            loggedInUserRecordsViewMode: 'only-record-linked-to-user',
            prefillChildFormForCreatingRecords: true,
        };
        const result = plan(parent);
        assert.equal(result.type, 'available');
        if (result.type === 'available')
            assert.deepEqual(result.prefill, {
                toLinkToParent: {
                    reversedFieldIdToPrefill: 'fld_parent_a',
                    parentFormRecordId: 'rec_parent',
                },
                prefillQueryForChildExtension: null,
            });
        assert.equal(plan(parentForm('create')).type, 'available');
    });
    it('reconciles retain, append and remove with exact EDIT identity and no created exemption', () => {
        const parent = parentForm('edit');
        const child = editChild();
        const reconcile = (
            nativeIds: string[],
            inverse: string[],
            maximum: number | null = null,
            selectedCount = nativeIds.length
        ) =>
            reconcileLinkedChildEdit({
                parent,
                fieldId,
                data: { [fieldId]: nativeIds },
                child,
                recordId,
                savedRecord: {
                    id: recordId,
                    fields: { fld_parent_a: inverse },
                },
                maximum,
                selectedCount,
            });
        assert.deepEqual(reconcile([recordId, recordId], ['rec_parent'], 1), {
            type: 'available',
            nativeIds: [recordId, recordId],
            changed: false,
            exemptCreatedRecord: false,
        });
        assert.deepEqual(reconcile(['rec_sibling'], ['rec_parent'], 2), {
            type: 'available',
            nativeIds: ['rec_sibling', recordId],
            changed: true,
            exemptCreatedRecord: false,
        });
        assert.deepEqual(reconcile(['rec_sibling'], ['rec_parent'], 1), {
            type: 'unavailable',
            reason: 'capacity-reached',
        });
        assert.deepEqual(
            reconcile([recordId, 'rec_sibling', recordId], [], 1),
            {
                type: 'available',
                nativeIds: ['rec_sibling'],
                changed: true,
                exemptCreatedRecord: false,
            }
        );
        assert.deepEqual(reconcile([], [], 0), {
            type: 'available',
            nativeIds: [],
            changed: false,
            exemptCreatedRecord: false,
        });
        child.payload.formRecord = { type: 'create', data: {} };
        assert.equal(reconcile([recordId], ['rec_parent']).type, 'unavailable');
    });
    it('fails closed on wrong record and missing or null inverse evidence', () => {
        const parent = parentForm('edit');
        const cases: AirtableRecord[] = [
            { id: 'rec_wrong', fields: { fld_parent_a: ['rec_parent'] } },
            { id: recordId, fields: {} },
            { id: recordId, fields: { fld_parent_a: null } },
        ];
        for (const savedRecord of cases) {
            assert.equal(
                reconcileLinkedChildEdit({
                    parent,
                    child: editChild(),
                    fieldId,
                    data: parent.payload.formRecord.data,
                    savedRecord,
                    recordId,
                    maximum: null,
                    selectedCount: 3,
                }).type,
                'unavailable'
            );
        }
    });
});
