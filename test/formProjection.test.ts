import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createFlatScalarFormRecordProjection,
    type CreateFlatScalarFormRecordProjectionInput,
} from '../src/forms/index.js';
import type {
    AirtableValue,
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
    RuntimeFieldSchema,
} from '../src/runtime/index.js';

type TextSchema = Extract<RuntimeFieldSchema, { fieldType: 'singleLineText' }>;
const text = (
    id: string,
    miniExtConfig: TextSchema['miniExtConfig'] = {}
): TextSchema => ({
    fieldType: 'singleLineText',
    airtableField: {
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'singleLineText', options: null },
    },
    miniExtConfig,
});
const checkbox: RuntimeAirtableField = {
    ...text('gate').airtableField,
    config: {
        type: 'checkbox',
        options: { icon: 'check', color: 'greenBright' },
    },
};
// The returned JSON boundary may contain invalid or stale saved definitions.
const condition = (
    id = 'gate',
    fieldType = 'checkbox',
    operator = 'is',
    value: unknown = true,
    reference: 'id' | 'name' = 'id'
): RuntimeConditionsDefinition =>
    ({
        logicalOperator: 'and',
        conditions: [
            {
                id: 'private-editor-identity',
                type: 'singleCondition',
                setting: {
                    type: operator,
                    fieldType,
                    idOrName:
                        reference === 'id'
                            ? { type: 'id', id }
                            : { type: 'name', name: id },
                    value,
                },
            },
        ],
    }) as RuntimeConditionsDefinition;

const input = (
    fields: RuntimeFieldSchema[] = [
        text('target', { conditionalFields: condition() }),
    ],
    data: Record<string, AirtableValue> = {
        gate: false,
        target: 'Accepted answer',
    }
): CreateFlatScalarFormRecordProjectionInput => ({
    fieldIds: fields.map((field) => field.airtableField.id),
    fieldIdsToSchemas: Object.fromEntries(
        fields.map((field) => [field.airtableField.id, field])
    ),
    airtableFields: [checkbox, ...fields.map((field) => field.airtableField)],
    data,
    recordId: 'rec_current',
    invalidConditionMode: 'strict',
});

describe('bounded canonical flat scalar conditional projection', () => {
    it('removes only condition-hidden IDs and evaluates every predicate against the same complete native record', () => {
        const hidden = text('driver', { conditionalFields: condition() });
        const witness = text('witness', {
            conditionalFields: condition(
                'driver',
                'singleLineText',
                'is',
                'accepted'
            ),
        });
        const options = input([hidden, witness], {
            gate: false,
            driver: 'accepted',
            witness: 'Still included',
            outside: ['rec_preserved'],
        });
        const before = structuredClone(options.data);
        for (const fieldIds of [
            ['driver', 'witness'],
            ['witness', 'driver'],
        ]) {
            const outcome = createFlatScalarFormRecordProjection({
                ...options,
                fieldIds,
            });
            assert.equal(outcome.type, 'available');
            if (outcome.type !== 'available')
                throw new Error('Expected scalar projection.');
            assert.deepEqual(outcome.hiddenFieldIds, ['driver']);
            assert.deepEqual(outcome.record, {
                id: 'rec_current',
                fields: {
                    gate: false,
                    witness: 'Still included',
                    outside: ['rec_preserved'],
                },
            });
            assert.deepEqual(options.data, before);
        }
        const repaired = createFlatScalarFormRecordProjection({
            ...options,
            data: { ...options.data, gate: true },
        });
        assert.equal(repaired.type, 'available');
        if (repaired.type === 'available') {
            assert.deepEqual(repaired.hiddenFieldIds, []);
            assert.equal(repaired.record.fields.driver, 'accepted');
        }
    });

    it('retains readonly/empty-hidden values, ordinary select targets and unreferenced nested native values', () => {
        const field = text('answer', {
            readOnly: true,
            hideFieldIfEmpty: true,
        });
        const select: RuntimeFieldSchema = {
            fieldType: 'multipleSelects',
            airtableField: {
                ...text('colors').airtableField,
                config: {
                    type: 'multipleSelects',
                    options: { choices: [{ id: 'sel_blue', name: 'Blue' }] },
                },
            },
        };
        const options = input([field, select], {
            answer: '',
            colors: ['Blue'],
            barcode: { text: '001', type: 'code39' },
            unrendered: ['rec_current'],
        });
        const before = structuredClone(options.data);
        const outcome = createFlatScalarFormRecordProjection(options);
        assert.equal(outcome.type, 'available');
        if (outcome.type !== 'available')
            throw new Error('Expected scalar projection.');
        assert.deepEqual(outcome.hiddenFieldIds, []);
        assert.deepEqual(outcome.record.fields, before);
        assert.notEqual(outcome.record.fields.colors, options.data.colors);
        assert.notEqual(outcome.record.fields.barcode, options.data.barcode);
        outcome.record.fields.colors = [];
        const native = outcome.record.fields.unrendered;
        assert.ok(Array.isArray(native));
        native.push('rec_copy_only');
        assert.deepEqual(options.data, before);

        // Readonly display does not exempt a target from conditional pruning.
        field.miniExtConfig = {
            ...field.miniExtConfig,
            conditionalFields: condition(),
        };
        const readonlyData = {
            ...options.data,
            gate: false,
            answer: 'Accepted readonly answer',
        };
        const readonlyBefore = structuredClone(readonlyData);
        const hiddenReadonly = createFlatScalarFormRecordProjection({
            ...options,
            data: readonlyData,
        });
        assert.equal(hiddenReadonly.type, 'available');
        if (hiddenReadonly.type === 'available') {
            assert.deepEqual(hiddenReadonly.hiddenFieldIds, ['answer']);
            assert.equal(
                Object.hasOwn(hiddenReadonly.record.fields, 'answer'),
                false
            );
        }
        assert.deepEqual(readonlyData, readonlyBefore);
    });

    it('blocks retained section titles and section rules without substituting frontend header enablement', () => {
        for (const miniExtConfig of [
            { headerSectionTitle: ' Section ', enableSectionHeader: false },
            { headerSectionTitle: ' Section ' },
            { applyFieldConditionsToSection: true },
        ]) {
            const options = input();
            options.fieldIdsToSchemas = {
                ...options.fieldIdsToSchemas,
                outside: text('outside', miniExtConfig),
            };
            assert.deepEqual(createFlatScalarFormRecordProjection(options), {
                type: 'blocked',
                code: 'unsupported-sections',
                diagnostics: [],
            });
        }
        assert.equal(
            createFlatScalarFormRecordProjection(
                input([
                    text('target', {
                        headerSectionTitle: '  ',
                        enableSectionHeader: true,
                    }),
                ])
            ).type,
            'available'
        );
    });

    it('blocks active linked filters even when that published field is not rendered', () => {
        const links: RuntimeFieldSchema = {
            fieldType: 'multipleRecordLinks',
            airtableField: {
                ...text('links').airtableField,
                config: {
                    type: 'multipleRecordLinks',
                    options: {
                        linkedTableId: 'table_linked',
                        isReversed: false,
                        prefersSingleRecordLink: false,
                    },
                },
            },
            miniExtConfig: { filterLinkedRecordsConditionFields: condition() },
        };
        const options = input();
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                fieldIdsToSchemas: { ...options.fieldIdsToSchemas, links },
            }).type,
            'blocked'
        );
        links.miniExtConfig = {
            filterLinkedRecordsConditionFields: condition(),
            filterLinkedRecordsToggle: false,
        };
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                fieldIdsToSchemas: { ...options.fieldIdsToSchemas, links },
            }).type,
            'available'
        );
        links.miniExtConfig = {
            filterLinkedRecordsConditionFields: condition(),
            filterApplicationMode: 'record-finder-only',
        };
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                fieldIdsToSchemas: { ...options.fieldIdsToSchemas, links },
            }).type,
            'available'
        );
        links.miniExtConfig = { conditionalLinkedRecordFilterFields: [] };
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                fieldIdsToSchemas: { ...options.fieldIdsToSchemas, links },
            }).type,
            'available'
        );
    });

    it('blocks missing or mismatched returned schema identity without changing adjacent accepted data', () => {
        const options = input();
        const before = structuredClone(options.data);
        for (const fieldIdsToSchemas of [{}, { target: text('different') }]) {
            assert.deepEqual(
                createFlatScalarFormRecordProjection({
                    ...options,
                    fieldIdsToSchemas,
                }),
                {
                    type: 'blocked',
                    code: 'missing-schema',
                    diagnostics: [],
                }
            );
            assert.deepEqual(options.data, before);
        }
    });

    it('rejects referenced duplicate names and ID/name aliases, while leaving unreferenced metadata duplicates usable', () => {
        const first = { ...text('a').airtableField, name: 'Duplicate' };
        const second = { ...text('b').airtableField, name: 'Duplicate' };
        const field = text('target', {
            conditionalFields: condition(
                'Duplicate',
                'singleLineText',
                'is',
                'one',
                'name'
            ),
        });
        const options = {
            ...input([field], { a: 'one', b: 'two', target: 'Kept native' }),
            airtableFields: [first, second],
        };
        assert.deepEqual(createFlatScalarFormRecordProjection(options), {
            type: 'blocked',
            code: 'ambiguous-reference',
            diagnostics: [],
        });
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                fieldIdsToSchemas: { target: text('target') },
            }).type,
            'available'
        );
        field.miniExtConfig = {
            conditionalFields: condition('a', 'singleLineText', 'is', 'one'),
        };
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                airtableFields: [first, { ...second, name: 'a' }],
            }).type,
            'blocked'
        );
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                airtableFields: [
                    { ...first, name: 'b' },
                    { ...second, name: 'Other' },
                ],
            }).type,
            'blocked'
        );
    });

    it('reuses native scalar/error guards and refuses computed or linked condition drivers', () => {
        const target = text('target', {
            conditionalFields: condition('value', 'number', 'equals', 2),
        });
        const numeric: RuntimeAirtableField = {
            ...text('value').airtableField,
            config: { type: 'number', options: { precision: 0 } },
        };
        const options = { ...input([target]), airtableFields: [numeric] };
        for (const [value, expected] of [
            [2, 'available'],
            ['2', 'blocked'],
            [Infinity, 'blocked'],
            [{ error: 'VALUE' }, 'blocked'],
            [{ specialValue: 'Infinity' }, 'blocked'],
        ] as const) {
            assert.equal(
                createFlatScalarFormRecordProjection({
                    ...options,
                    data: { value },
                }).type,
                expected
            );
        }
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                airtableFields: [{ ...numeric, isComputed: true }],
                data: { value: 2 },
            }).type,
            'blocked'
        );
        const linked: RuntimeAirtableField = {
            ...numeric,
            config: {
                type: 'multipleRecordLinks',
                options: {
                    linkedTableId: 'table_linked',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                },
            },
        };
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                airtableFields: [linked],
                data: { value: ['rec_linked'] },
            }).type,
            'blocked'
        );
        target.miniExtConfig = {
            conditionalFields: condition('value', 'singleLineText', 'isEmpty'),
        };
        const absentNativeValue = createFlatScalarFormRecordProjection({
            ...options,
            airtableFields: [text('value').airtableField],
            data: { target: 'Still included' },
        });
        assert.equal(absentNativeValue.type, 'available');
        if (absentNativeValue.type === 'available') {
            assert.deepEqual(absentNativeValue.hiddenFieldIds, []);
            assert.equal(
                absentNativeValue.record.fields.target,
                'Still included'
            );
        }
        target.miniExtConfig = {
            conditionalFields: condition(
                'value',
                'singleLineText',
                'is',
                '#ERROR!'
            ),
        };
        assert.equal(
            createFlatScalarFormRecordProjection({
                ...options,
                airtableFields: [text('value').airtableField],
                data: { value: '#ERROR!' },
            }).type,
            'available'
        );
    });

    it('keeps compiler policy and safe missing-reference diagnostics without returning private inputs', () => {
        const target = text('target', {
            conditionalFields: condition('missing'),
        });
        const options = input([target]);
        const outcome = createFlatScalarFormRecordProjection(options);
        assert.equal(outcome.type, 'available');
        if (outcome.type === 'available') {
            assert.deepEqual(outcome.hiddenFieldIds, ['target']);
            assert.deepEqual(outcome.diagnostics, [
                { code: 'missing-field', severity: 'warning', path: [0] },
            ]);
        }
        target.miniExtConfig = {
            conditionalFields: {
                logicalOperator: 'or',
                conditions: [
                    ...condition('missing').conditions,
                    ...condition('gate').conditions,
                ],
            },
        };
        const withValidSibling = createFlatScalarFormRecordProjection({
            ...options,
            data: { ...options.data, gate: true },
        });
        assert.equal(withValidSibling.type, 'available');
        if (withValidSibling.type === 'available') {
            assert.deepEqual(withValidSibling.hiddenFieldIds, []);
            assert.equal(
                withValidSibling.record.fields.target,
                'Accepted answer'
            );
        }
        target.miniExtConfig = {
            // Explicit null is an incomplete saved operand. Passing undefined
            // would activate this fixture helper's default value of true.
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    ...condition('gate', 'checkbox', 'is', null).conditions,
                    // Compatibility skips the incomplete sibling, but still
                    // requires a complete predicate. Gate is false here.
                    ...condition('gate', 'checkbox', 'is', false).conditions,
                ],
            },
        };
        const strict = createFlatScalarFormRecordProjection(options);
        assert.equal(strict.type, 'blocked');
        if (strict.type === 'blocked') {
            assert.equal(strict.code, 'invalid');
            assert.ok(
                strict.diagnostics.some(
                    (diagnostic) =>
                        diagnostic.code === 'incomplete-condition' &&
                        diagnostic.severity === 'error'
                )
            );
        }
        const compatible = createFlatScalarFormRecordProjection({
            ...options,
            invalidConditionMode: 'compatibility',
        });
        assert.equal(compatible.type, 'available');
        if (compatible.type === 'available') {
            assert.deepEqual(compatible.hiddenFieldIds, []);
            assert.equal(compatible.record.fields.target, 'Accepted answer');
            assert.ok(
                compatible.diagnostics.some(
                    (diagnostic) =>
                        diagnostic.code === 'incomplete-condition' &&
                        diagnostic.severity === 'warning'
                )
            );
        }
        const serialized = JSON.stringify(
            createFlatScalarFormRecordProjection(options)
        );
        assert.equal(serialized.includes('private-editor-identity'), false);
        assert.equal(serialized.includes('Accepted answer'), false);
    });
});
