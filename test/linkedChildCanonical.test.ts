import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    reconcileLinkedChildCreate,
    resolveLinkedChildCreatePolicy,
} from '../src/forms/linkedChildPolicy.js';
import { childForm, parentForm } from './formLinkedChildFixtures.js';
import type { AirtableValue, FormLoadedResult } from '../src/runtime/types.js';

type Config = Record<string, unknown>;
type Fixture = {
    revision: string;
    generator: string;
    generatorSha256: string;
    createCases: Array<{
        name: string;
        config: Config;
        expected: string | null;
    }>;
    capacityCases: Array<{
        name: string;
        config: Config;
        physicalSingle: boolean;
        selectedCount: number;
        expected: {
            prefersSingleRecordLink: boolean;
            canAddMoreRecordsToCell: boolean;
        };
    }>;
    reconciliationCases: Array<{
        name: string;
        parentMode: 'create' | 'edit';
        nativeIds: string[];
        savedId: string;
        inverseIds: string[];
        expected: {
            nativeIds: string[];
            changed: boolean;
            exemptCreatedRecord: boolean;
        };
    }>;
    prefillCases: Array<{
        name: string;
        value: string | null;
        expected: string | null;
    }>;
    emptyCases: Array<{
        name: string;
        value: string | null;
        expected: boolean;
    }>;
};
const fixture: Fixture = JSON.parse(
    readFileSync('test/fixtures/linked-child-canonical.json', 'utf8')
);
const fieldId = 'fld_children_a';
const configure = (page: FormLoadedResult, config: unknown) => {
    const field = page.payload.fieldIdsToSchemas[fieldId];
    assert.equal(field.fieldType, 'multipleRecordLinks');
    Object.assign(field, { miniExtConfig: config });
};
const resolve = (page: FormLoadedResult, data: Record<string, AirtableValue>) =>
    resolveLinkedChildCreatePolicy({ loaded: page, fieldId, data });

describe('canonical linked child pure creation policy', () => {
    it('compares configured create IDs and capacity with source-executed canonical results', () => {
        assert.equal(
            fixture.revision,
            '4bf957c4830e6863972e45e52f2c371dc8ea9c77'
        );
        assert.equal(
            createHash('sha256')
                .update(readFileSync(fixture.generator))
                .digest('hex'),
            fixture.generatorSha256
        );
        for (const row of fixture.createCases) {
            const page = parentForm();
            configure(page, row.config);
            const data = { [fieldId]: [] };
            const before = structuredClone({ page, data });
            const result = resolve(page, data);
            if (row.expected === null)
                assert.deepEqual(
                    result,
                    { type: 'unavailable', reason: 'create-disabled' },
                    row.name
                );
            else {
                assert.equal(result.type, 'available', row.name);
                if (result.type === 'available')
                    assert.equal(
                        result.childExtensionId,
                        row.expected,
                        row.name
                    );
            }
            assert.deepEqual({ page, data }, before, row.name);
        }
        for (const row of fixture.capacityCases) {
            const page = parentForm();
            configure(page, row.config);
            const field = page.payload.fieldIdsToSchemas[fieldId];
            if (field.airtableField.config.type !== 'multipleRecordLinks')
                throw new Error('Synthetic physical link required.');
            field.airtableField.config.options.prefersSingleRecordLink =
                row.physicalSingle;
            const result = resolve(page, {
                [fieldId]: Array.from(
                    { length: row.selectedCount },
                    (_, i) => `rec_${i}`
                ),
            });
            if (!row.expected.canAddMoreRecordsToCell)
                assert.deepEqual(
                    result,
                    { type: 'unavailable', reason: 'capacity-reached' },
                    row.name
                );
            else {
                assert.equal(result.type, 'available', row.name);
                if (result.type === 'available') {
                    assert.equal(
                        result.selectedCount,
                        row.selectedCount,
                        row.name
                    );
                    if (row.expected.prefersSingleRecordLink)
                        assert.equal(result.maximum, 1, row.name);
                }
            }
        }
    });
    it('preserves source-executed inverse membership decisions and native occurrence order', () => {
        for (const row of fixture.reconciliationCases) {
            const parent = parentForm(row.parentMode);
            const child = childForm(row.parentMode);
            const data = { [fieldId]: [...row.nativeIds] };
            const savedRecord = {
                id: row.savedId,
                fields: { fld_parent_a: row.inverseIds },
            };
            const before = structuredClone({
                parent,
                child,
                data,
                savedRecord,
            });
            assert.deepEqual(
                reconcileLinkedChildCreate({
                    parent,
                    child,
                    data,
                    fieldId,
                    savedRecord,
                }),
                { type: 'available', ...row.expected },
                row.name
            );
            assert.deepEqual(
                { parent, child, data, savedRecord },
                before,
                row.name
            );
        }
    });
    it('captures canonical current text prefills once and recognizes empty native cells', () => {
        for (const row of fixture.prefillCases) {
            const page = parentForm('edit');
            const config = {
                allowCreatingRecords: true,
                extensionIdForCreating: 'form_child_synthetic',
                prefillChildFormForCreatingRecords: true,
                prefillFieldForCreatingChildExtension: 'fld_title',
            };
            configure(page, config);
            const data: Record<string, AirtableValue> = {
                [fieldId]: [],
                fld_title: row.value,
            };
            const result = resolve(page, data);
            assert.equal(result.type, 'available', row.name);
            if (result.type === 'available') {
                assert.equal(
                    result.prefill.prefillQueryForChildExtension,
                    row.expected,
                    row.name
                );
                assert.deepEqual(result.prefill.toLinkToParent, {
                    reversedFieldIdToPrefill: 'fld_parent_a',
                    parentFormRecordId: 'rec_parent',
                });
                data.fld_title = 'prefill_Title=later';
                assert.equal(
                    result.prefill.prefillQueryForChildExtension,
                    row.expected,
                    row.name
                );
            }
        }
        for (const row of fixture.emptyCases) {
            assert.equal(row.expected, true);
            const result = resolve(parentForm(), { [fieldId]: row.value });
            assert.equal(result.type, 'available', row.name);
            if (result.type === 'available')
                assert.deepEqual(result.nativeIds, [], row.name);
        }
    });
    it('refuses malformed policy containers and missing inverse evidence without guessing unlink', () => {
        for (const config of [[], 'invalid', 1]) {
            const page = parentForm();
            configure(page, config);
            assert.deepEqual(resolve(page, { [fieldId]: [] }), {
                type: 'unavailable',
                reason: 'invalid-metadata',
            });
        }
        for (const value of [['list'], { toString: () => 'list' }]) {
            const page = parentForm();
            configure(page, {
                allowCreatingRecords: true,
                extensionIdForCreating: 'form_child_synthetic',
                layout: value,
            });
            assert.deepEqual(resolve(page, { [fieldId]: [] }), {
                type: 'unavailable',
                reason: 'unsupported-configuration',
            });
        }
        const missingInverseFields: Record<string, AirtableValue>[] = [
            {},
            { fld_parent_a: null },
            { fld_parent_a: '' },
        ];
        for (const fields of missingInverseFields) {
            assert.deepEqual(
                reconcileLinkedChildCreate({
                    parent: parentForm('edit'),
                    child: childForm('edit'),
                    fieldId,
                    data: { [fieldId]: ['rec_new', 'rec_new'] },
                    savedRecord: { id: 'rec_new', fields },
                }),
                { type: 'unavailable', reason: 'unavailable-inverse' }
            );
        }
    });
});
