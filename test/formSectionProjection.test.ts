import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    createFlatScalarFormRecordProjection,
    createScalarFormRecordProjection,
    composeFormFieldVisibility,
    type CreateScalarFormRecordProjectionInput,
} from '../src/forms/index.js';
import type { AirtableRecord } from '../src/runtime/index.js';

const fixture = JSON.parse(
    readFileSync('test/fixtures/sectionProjection.json', 'utf8')
) as {
    provenance: {
        revision: string;
        tree: string;
        generatorSha256: string;
        casesSourceSha256: string;
        sources: Record<string, string>;
    };
    cases: {
        name: string;
        input: CreateScalarFormRecordProjectionInput;
        expected: { hiddenFieldIds: string[]; record: AirtableRecord };
    }[];
};
const fresh = () => structuredClone(fixture.cases[0]!.input);
const blocked = (
    input: CreateScalarFormRecordProjectionInput,
    code: string
) => {
    const before = structuredClone(input);
    const result = createScalarFormRecordProjection(input);
    assert.equal(result.type, 'blocked');
    if (result.type === 'blocked') assert.equal(result.code, code);
    assert.deepEqual(input, before);
};

describe('canonical ordered scalar section projection', () => {
    it('binds fixtures to pinned executed canonical source and exact input bytes', () => {
        assert.equal(
            fixture.provenance.revision,
            '58f73d575ab10baa0a10693660d8002f204368e1'
        );
        assert.equal(
            createHash('sha256')
                .update(
                    readFileSync('test/fixtures/sectionProjectionCases.mjs')
                )
                .digest('hex'),
            fixture.provenance.casesSourceSha256
        );
        assert.equal(
            fixture.provenance.tree,
            'b39e58ead46a311c497def57474cf5ca720542ae'
        );
        assert.equal(
            createHash('sha256')
                .update(
                    readFileSync(
                        'scripts/generate-section-projection-fixtures.mjs'
                    )
                )
                .digest('hex'),
            fixture.provenance.generatorSha256
        );
        assert.equal(Object.keys(fixture.provenance.sources).length, 3);
        for (const hash of Object.values(fixture.provenance.sources))
            assert.match(hash, /^[0-9a-f]{64}$/);
    });
    for (const entry of fixture.cases) {
        it(`matches executed canonical output: ${entry.name}`, () => {
            const before = structuredClone(entry.input);
            const result = createScalarFormRecordProjection(entry.input);
            assert.equal(result.type, 'available');
            if (result.type !== 'available')
                throw new Error('Expected supported canonical fixture');
            assert.deepEqual(
                result.hiddenFieldIds,
                entry.expected.hiddenFieldIds
            );
            assert.deepEqual(result.record, entry.expected.record);
            assert.deepEqual(entry.input, before);
        });
    }
    it('returns detached nested writable copies, never a native Save replacement', () => {
        const input = structuredClone(
            fixture.cases.find((c) => c.name.includes('nested unrendered'))!
                .input
        );
        const before = structuredClone(input);
        const result = createScalarFormRecordProjection(input);
        assert.equal(result.type, 'available');
        if (result.type !== 'available') throw new Error('Expected projection');
        const nested = result.record.fields.outside;
        assert.ok(Array.isArray(nested));
        assert.ok(nested[0] && typeof nested[0] === 'object');
        Object.assign(nested[0], { filename: 'copy-only.txt' });
        nested.push('copy-only');
        result.record.fields.empty = 'copy-only';
        assert.deepEqual(input, before);
    });
    it('refuses duplicate, nonstring and sparse order only on the additive path', () => {
        for (const ids of [['header', 'header'], [0], new Array(1), 'a'])
            blocked(
                { ...fresh(), fieldIds: ids as string[] },
                'invalid-field-order'
            );
        // Completeness cannot be inferred: callers must pass fieldIdsInForm verbatim.
        assert.equal(
            createScalarFormRecordProjection({ ...fresh(), fieldIds: [] }).type,
            'available'
        );
    });
    it('rejects a string order even when its indexed ID resolves', () => {
        const input = fresh();
        const schema = structuredClone(input.fieldIdsToSchemas.gate!);
        Object.assign(schema.airtableField, { id: 'a' });
        input.fieldIds = 'a' as unknown as string[];
        input.fieldIdsToSchemas = { a: schema };
        input.airtableFields = [structuredClone(schema.airtableField)];
        blocked(input, 'invalid-field-order');
        assert.equal(
            createFlatScalarFormRecordProjection(input).type,
            'available'
        );
        input.fieldIds = ['a'];
        Object.assign(schema.airtableField, { isComputed: 'true' });
        Object.assign(input.airtableFields[0]!, { isComputed: 'true' });
        blocked(input, 'invalid-metadata');
        assert.equal(
            createFlatScalarFormRecordProjection(input).type,
            'available'
        );
    });
    it('refuses duplicate physical IDs and contradictory metadata', () => {
        const input = fresh();
        blocked(
            {
                ...input,
                airtableFields: [
                    ...input.airtableFields,
                    input.airtableFields[0]!,
                ],
            },
            'invalid-metadata'
        );
        for (const key of ['fieldType', 'physicalType', 'physicalName']) {
            const changed = fresh();
            const schema = changed.fieldIdsToSchemas.header!;
            if (key === 'fieldType')
                Object.assign(schema, { fieldType: 'number' });
            else if (key === 'physicalType')
                Object.assign(
                    changed.airtableFields.find((f) => f.id === 'header')!
                        .config,
                    { type: 'number' }
                );
            else
                Object.assign(
                    changed.airtableFields.find((f) => f.id === 'header')!,
                    { name: 'Contradiction' }
                );
            blocked(changed, 'invalid-metadata');
        }
    });
    it('refuses malformed metadata containers on the section path', () => {
        const input = fresh();
        const schema = structuredClone(input.fieldIdsToSchemas.gate!);
        Object.assign(schema.airtableField, { id: '0' });
        const arrayMap = {
            ...input,
            fieldIds: ['0'],
            fieldIdsToSchemas: [
                schema,
            ] as unknown as typeof input.fieldIdsToSchemas,
            airtableFields: [structuredClone(schema.airtableField)],
        };
        blocked(JSON.parse(JSON.stringify(arrayMap)), 'invalid-metadata');
        assert.equal(
            createFlatScalarFormRecordProjection(arrayMap).type,
            'available'
        );
        for (const map of [null, 'schemas', 1])
            blocked(
                {
                    ...input,
                    fieldIdsToSchemas:
                        map as unknown as typeof input.fieldIdsToSchemas,
                },
                'invalid-metadata'
            );
        for (const fields of [null, {}, 'fields'])
            blocked(
                {
                    ...input,
                    airtableFields:
                        fields as unknown as typeof input.airtableFields,
                },
                'invalid-metadata'
            );
        for (const field of [null, 'field', 1, []])
            blocked(
                {
                    ...input,
                    airtableFields: [
                        field,
                    ] as unknown as typeof input.airtableFields,
                },
                'invalid-metadata'
            );
        for (const config of [null, 'config', 1, []]) {
            const changed = fresh();
            Object.assign(
                changed.airtableFields.find((f) => f.id === 'gate')!,
                { config }
            );
            Object.assign(changed.fieldIdsToSchemas.gate!.airtableField, {
                config,
            });
            blocked(changed, 'invalid-metadata');
        }
    });
    it('accepts omitted and explicitly undefined optional computed flags', () => {
        for (const explicit of [false, true]) {
            const input = fresh();
            const physical = input.airtableFields.find((f) => f.id === 'gate')!;
            const schemaField = input.fieldIdsToSchemas.gate!.airtableField;
            for (const field of [physical, schemaField]) {
                if (explicit) Object.assign(field, { isComputed: undefined });
                else Reflect.deleteProperty(field, 'isComputed');
            }
            const result = createScalarFormRecordProjection(input);
            assert.equal(result.type, 'available');
            if (result.type === 'available') {
                assert.deepEqual(
                    result.record,
                    fixture.cases[0]!.expected.record
                );
                assert.deepEqual(
                    result.hiddenFieldIds,
                    fixture.cases[0]!.expected.hiddenFieldIds
                );
            }
        }
    });
    it('refuses equally malformed schema and physical primitives', () => {
        for (const patch of [
            { isComputed: 'true' },
            { isComputed: null },
            { isComputed: 1 },
            { name: 123 },
            { id: 123 },
            { config: { type: 'not-a-canonical-type' } },
        ]) {
            const input = fresh();
            const physical = input.airtableFields.find((f) => f.id === 'gate')!;
            Object.assign(input.fieldIdsToSchemas.gate!.airtableField, patch);
            Object.assign(physical, patch);
            if (patch.config != null)
                Object.assign(input.fieldIdsToSchemas.gate!, {
                    fieldType: patch.config.type,
                });
            blocked(input, 'invalid-metadata');
        }
    });
    it('refuses malformed section metadata instead of guessing boundaries', () => {
        for (const patch of [
            { headerSectionTitle: 123 },
            { enableSectionHeader: 'false' },
            { applyFieldConditionsToSection: 1 },
        ]) {
            const input = fresh();
            Object.assign(
                input.fieldIdsToSchemas.header!.miniExtConfig!,
                patch
            );
            blocked(input, 'invalid-metadata');
        }
    });
    it('refuses malformed conditions even under a hidden section and rejects cyclic definitions', () => {
        const input = fresh();
        Object.assign(input.fieldIdsToSchemas.inside!.miniExtConfig!, {
            conditionalFields: { logicalOperator: 'bogus', conditions: [] },
        });
        blocked(input, 'unsupported');
        const cyclic: { logicalOperator: string; conditions: unknown[] } = {
            logicalOperator: 'and',
            conditions: [],
        };
        cyclic.conditions.push({ type: 'groupCondition', ...cyclic });
        Object.assign(input.fieldIdsToSchemas.inside!.miniExtConfig!, {
            conditionalFields: cyclic,
        });
        blocked(input, 'invalid');
    });
    it('keeps presentation distinct: enabled hides, disabled does not inherit, edit empty hiding stays blocked', () => {
        const input = fresh();
        const present = () =>
            composeFormFieldVisibility({
                ...input,
                formRecordType: 'edit',
                evaluationMode: 'runtime',
            });
        assert.equal(present().inside!.type, 'hidden');
        Object.assign(input.fieldIdsToSchemas.header!.miniExtConfig!, {
            enableSectionHeader: false,
        });
        assert.equal(present().inside!.type, 'visible');
        assert.equal(createScalarFormRecordProjection(input).type, 'available');
        Object.assign(input.fieldIdsToSchemas.inside!.miniExtConfig!, {
            hideFieldIfEmpty: true,
        });
        assert.equal(present().inside!.type, 'blocked');
    });
    it('does not apply new order or physical validation to the legacy flat export', () => {
        const input = fresh();
        for (const schema of Object.values(input.fieldIdsToSchemas)) {
            if (schema?.miniExtConfig) {
                Reflect.deleteProperty(
                    schema.miniExtConfig,
                    'headerSectionTitle'
                );
                Reflect.deleteProperty(
                    schema.miniExtConfig,
                    'applyFieldConditionsToSection'
                );
            }
        }
        const duplicates = {
            ...input,
            fieldIds: ['gate', 'gate'],
            airtableFields: [...input.airtableFields, input.airtableFields[0]!],
        };
        assert.equal(
            createFlatScalarFormRecordProjection(duplicates).type,
            'available'
        );
        blocked(duplicates, 'invalid-field-order');
        const metadataOnly = {
            ...input,
            airtableFields: [...input.airtableFields, input.airtableFields[0]!],
        };
        assert.equal(
            createFlatScalarFormRecordProjection(metadataOnly).type,
            'available'
        );
        blocked(metadataOnly, 'invalid-metadata');
    });
    it('preserves the exact flat rejection scan outside order including untitled propagation', () => {
        for (const config of [
            { applyFieldConditionsToSection: true },
            { headerSectionTitle: 'Retained', enableSectionHeader: false },
        ]) {
            const input = fresh();
            input.fieldIds = [];
            const outside = structuredClone(input.fieldIdsToSchemas.header!);
            Object.assign(outside.airtableField, { id: 'outside' });
            Object.assign(outside, { miniExtConfig: config });
            input.fieldIdsToSchemas = { outside };
            assert.deepEqual(createFlatScalarFormRecordProjection(input), {
                type: 'blocked',
                code: 'unsupported-sections',
                diagnostics: [],
            });
        }
    });
});
