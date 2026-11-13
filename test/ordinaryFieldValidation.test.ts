import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    validateOrdinaryFormField,
    describeLoadedFormFields,
} from '../src/forms/index.js';
import { validatePageField } from '../src/forms/pageValidation.js';
import { loadedForm } from './formsFixtures.js';

const support = JSON.parse(
    readFileSync('test/fixtures/formPageValidationSupport.json', 'utf8')
);
const oracle = JSON.parse(readFileSync('test/fixtures/formPages.json', 'utf8'));

describe('public ordinary Form validation', () => {
    it('supports every historical canonical comparison without relabeling the corpus', () => {
        assert.equal(support.canonicalComparison.length, 413);
        for (const c of oracle.validation) {
            assert(support.canonicalComparison.includes(c.name), c.name);
            const result = validateOrdinaryFormField({
                fieldType: c.schema.fieldType,
                airtableFieldConfig: c.schema.airtableField.config,
                miniExtConfig: c.schema.miniExtConfig,
                value: c.value,
                storedValue: c.stored,
                isConditionallyHidden: c.hidden,
                isComputeMode: false,
            });
            assert.equal(result.status, 'supported', c.name);
            if (result.status === 'supported')
                assert.equal(result.diagnostic !== null, c.invalid, c.name);
        }
    });

    it('returns explicit fallback for all thirteen historical conservative refusals', () => {
        assert.equal(support.conservativeRefusal.length, 13);
        for (const c of oracle.conservativeRefusal) {
            const result = validateOrdinaryFormField({
                fieldType: c.schema.fieldType,
                airtableFieldConfig: c.schema.airtableField.config,
                miniExtConfig: c.schema.miniExtConfig,
                value: c.value,
                storedValue: c.stored,
                isConditionallyHidden: c.hidden,
                isComputeMode: false,
            });
            assert.equal(result.status, 'native-fallback', c.name);
        }
    });
});

const validate = (
    fieldType: string,
    value: unknown,
    miniExtConfig: Record<string, unknown> = {},
    extra: Partial<Parameters<typeof validateOrdinaryFormField>[0]> = {}
) =>
    validateOrdinaryFormField({
        fieldType,
        airtableFieldConfig: {
            type: fieldType,
            options: { choices: [{ id: 'one', name: 'One' }] },
        },
        miniExtConfig,
        value,
        storedValue: undefined,
        isConditionallyHidden: false,
        isComputeMode: false,
        ...extra,
    });

describe('ordinary-only discriminators', () => {
    for (const [kind, value] of [
        ['singleLineText', ''],
        ['checkbox', false],
        ['rating', 0],
        ['barcode', { text: ' ' }],
        ['multipleRecordLinks', []],
    ] as const) {
        it(`Compute waives Required for ${kind}`, () => {
            assert.deepEqual(validate(kind, value, { required: true }), {
                status: 'supported',
                diagnostic: { code: 'required' },
            });
            assert.deepEqual(
                validate(
                    kind,
                    value,
                    { required: true },
                    { isComputeMode: true }
                ),
                { status: 'supported', diagnostic: null }
            );
        });
    }
    for (const [kind, value, config, code] of [
        ['singleLineText', 'x', { characterLimit: 0 }, 'character-limit'],
        ['email', ' x@example.test', {}, 'invalid-email'],
        ['url', 'javascript:alert(1)', {}, 'invalid-url'],
        ['number', -1, {}, 'negative-number'],
        ['currency', -1, {}, 'negative-number'],
        ['singleSelect', 'Unknown', {}, 'invalid-selection'],
        [
            'multipleRecordLinks',
            [],
            { customMinimumRecordsToSelect: 1 },
            'linked-minimum',
        ],
        [
            'multipleRecordLinks',
            ['a', 'b'],
            { customMaxRecordsToSelect: 1 },
            'linked-maximum',
        ],
    ] as const) {
        it(`Compute retains ${code} for ${kind}`, () => {
            const result = validate(
                kind,
                value,
                { ...config, required: true },
                { isComputeMode: true }
            );
            assert.equal(result.status, 'supported');
            if (result.status === 'supported')
                assert.equal(result.diagnostic?.code, code);
        });
    }
    it('carries the original zero limit and waives it only for hidden or ordinary readonly text', () => {
        assert.deepEqual(
            validate('singleLineText', 'x', { characterLimit: 0 }),
            {
                status: 'supported',
                diagnostic: { code: 'character-limit', limit: 0 },
            }
        );
        for (const extra of [
            { isConditionallyHidden: true },
            { miniExtConfig: { readOnly: true, characterLimit: 0 } },
        ])
            assert.deepEqual(
                validate('singleLineText', 'x', { characterLimit: 0 }, extra),
                { status: 'supported', diagnostic: null }
            );
    });
    it('keeps Required before visible linked minimum, including readonly minimum', () => {
        assert.deepEqual(
            validate('multipleRecordLinks', [], {
                required: true,
                customMinimumRecordsToSelect: 1,
            }),
            { status: 'supported', diagnostic: { code: 'required' } }
        );
        assert.deepEqual(
            validate('multipleRecordLinks', [], {
                readOnly: true,
                customMinimumRecordsToSelect: 1,
            }),
            { status: 'supported', diagnostic: { code: 'linked-minimum' } }
        );
        assert.deepEqual(
            validate(
                'multipleRecordLinks',
                [],
                { customMinimumRecordsToSelect: 1 },
                { isConditionallyHidden: true }
            ),
            { status: 'supported', diagnostic: null }
        );
    });
    it('leaves linked-open and date-range policy to the page adapter', () => {
        assert.deepEqual(
            validate('multipleRecordLinks', ['a'], {
                requireOpenLinkedRecords: true,
            }),
            { status: 'supported', diagnostic: null }
        );
        assert.deepEqual(
            validate('date', '2026-01-01', {
                dateRange: 'the next week',
            }),
            { status: 'supported', diagnostic: null }
        );
    });
    it('waives Required for a physical formula while retaining writable number rules', () => {
        assert.deepEqual(validate('formula', null, { required: true }), {
            status: 'supported',
            diagnostic: null,
        });
        assert.deepEqual(validate('number', -1), {
            status: 'supported',
            diagnostic: { code: 'negative-number' },
        });
    });
    it('explicitly falls back for unsupported, mismatched, malformed and unproven inputs', () => {
        for (const input of [
            validate('newKind', 'x'),
            validate(
                'singleLineText',
                'x',
                {},
                { airtableFieldConfig: { type: 'formula' } }
            ),
            validate('singleLineText', 'x', { characterLimit: '0' }),
            validate('singleLineText', 12),
            validate('singleLineText', [], { required: true }),
            validate('singleCollaborator', [], { required: true }),
            validate('number', '12'),
            validate(
                'singleSelect',
                'One',
                {},
                {
                    airtableFieldConfig: {
                        type: 'singleSelect',
                        options: { choices: null },
                    },
                }
            ),
        ])
            assert.equal(input.status, 'native-fallback');
    });
});

it('keeps page date and linked Review refusals separate from ordinary feedback', () => {
    const loaded = loadedForm();
    for (const schema of [
        {
            fieldType: 'date',
            airtableField: {
                id: 'answer',
                name: 'Answer',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'date',
                    options: {
                        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                    },
                },
            },
            miniExtConfig: { dateRange: 'the next week' },
        },
        {
            fieldType: 'multipleRecordLinks',
            airtableField: {
                id: 'answer',
                name: 'Answer',
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: {
                    type: 'multipleRecordLinks',
                    options: {
                        linkedTableId: 'table',
                        isReversed: false,
                        prefersSingleRecordLink: false,
                    },
                },
            },
            miniExtConfig: { requireOpenLinkedRecords: true },
        },
    ] as const) {
        loaded.payload.fieldIdsInForm = ['answer'];
        loaded.payload.fieldIdsToSchemas = { answer: schema };
        const field = describeLoadedFormFields(loaded)[0]!;
        const value = schema.fieldType === 'date' ? '1900-01-01' : ['rec_one'];
        assert.deepEqual(
            validateOrdinaryFormField({
                fieldType: schema.fieldType,
                airtableFieldConfig: schema.airtableField.config,
                miniExtConfig: schema.miniExtConfig,
                value,
                storedValue: undefined,
                isConditionallyHidden: false,
                isComputeMode: false,
            }),
            { status: 'supported', diagnostic: null }
        );
        assert.deepEqual(validatePageField(field, value, undefined, false), {
            fieldId: 'answer',
            code:
                schema.fieldType === 'date'
                    ? 'invalid-input'
                    : 'unsupported-validation',
        });
    }
});
it('keeps native empty-array gates and delegates unproven coercive shapes', () => {
    for (const kind of [
        'singleSelect',
        'multipleSelects',
        'multipleRecordLinks',
    ]) {
        assert.deepEqual(
            validate(kind, [], {
                maxNumberOfSelections: -1,
                customMaxRecordsToSelect: -1,
            }),
            { status: 'supported', diagnostic: null }
        );
        assert.equal(validate(kind, ['']).status, 'native-fallback');
    }
    for (const [kind, value] of [
        ['richText', {}],
        ['date', []],
        ['checkbox', 0],
        ['rating', '1'],
        ['barcode', { text: 1 }],
        ['multipleAttachments', [1]],
    ] as const)
        assert.equal(validate(kind, value).status, 'native-fallback');
});
