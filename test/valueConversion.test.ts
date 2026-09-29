import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    AIRTABLE_FORMULA_ERROR_VALUE,
    AirtableFieldType,
    FormulaRunner,
    convertAirtableValueToPrimitive,
    formatAirtablePrimitive,
    getReadableStringFromAirtableValue,
    type AirtableField,
    type AirtableValue,
    type GetReadableStringSource,
    type TableIdsToLinkedTableLoadingStates,
} from '../src/formulas/index.js';
import {
    dateField,
    dateTimeField,
    linkedField,
    makeContext,
    makeLinkedState,
    numberField,
    selectField,
    syntheticLinkedRecordId,
    syntheticMissingRecordId,
    textField,
} from './fixtures.js';

type FieldConfig = AirtableField['config'];

const emptySource: GetReadableStringSource = {
    type: 'airtableMock',
    linkedTableStates: {},
};

const primitive = (
    config: FieldConfig,
    value: AirtableValue,
    source: GetReadableStringSource = emptySource
) =>
    convertAirtableValueToPrimitive({
        airtableFieldConfig: config,
        value,
        source,
        fieldName: 'Example field',
    });

const readable = (
    config: FieldConfig,
    value: AirtableValue,
    source: GetReadableStringSource = emptySource
) =>
    getReadableStringFromAirtableValue({
        airtableFieldConfig: config,
        value,
        source,
        fieldName: 'Example field',
    });

describe('field value conversion', () => {
    it('treats missing cells as blank and missing ratings as zero', () => {
        for (const value of [null, undefined]) {
            assert.equal(primitive(textField.config, value), '');
            assert.equal(primitive(numberField.config, value), '');
            assert.equal(
                primitive({ type: AirtableFieldType.RATING }, value),
                0
            );
        }
    });

    it('preserves Airtable error and special numeric values', () => {
        assert.equal(
            primitive(numberField.config, {
                error: AIRTABLE_FORMULA_ERROR_VALUE,
            }),
            AIRTABLE_FORMULA_ERROR_VALUE
        );
        assert.ok(
            Number.isNaN(primitive(numberField.config, { specialValue: 'NaN' }))
        );
        assert.equal(
            primitive(numberField.config, { specialValue: 'Infinity' }),
            Infinity
        );
        assert.equal(
            primitive(numberField.config, { specialValue: '-Infinity' }),
            -Infinity
        );
        assert.ok(Number.isNaN(primitive(numberField.config, NaN)));
    });

    const numericConfigs: FieldConfig[] = [
        numberField.config,
        { type: AirtableFieldType.PERCENT, options: { precision: 1 } },
        {
            type: AirtableFieldType.CURRENCY,
            options: { precision: 2, symbol: '$' },
        },
        {
            type: AirtableFieldType.DURATION,
            options: { durationFormat: 'h:mm' },
        },
        { type: AirtableFieldType.RATING },
        { type: AirtableFieldType.AUTO_NUMBER },
        { type: AirtableFieldType.COUNT, options: { isValid: true } },
    ];

    for (const config of numericConfigs) {
        it(`keeps numeric primitives and rejects strings for ${config.type}`, () => {
            assert.equal(primitive(config, -2.75), -2.75);
            assert.equal(primitive(config, 0), 0);
            assert.throws(() => primitive(config, '2.75'), Error);
        });
    }

    it('converts checkbox values to the formula numeric representation', () => {
        const config: FieldConfig = { type: AirtableFieldType.CHECKBOX };
        assert.equal(primitive(config, true), 1);
        assert.equal(primitive(config, false), 0);
        assert.equal(readable(config, true), 'true');
        assert.equal(readable(config, false), '');
        assert.throws(() => primitive(config, 1), Error);
    });

    const stringTypes = [
        AirtableFieldType.SINGLE_LINE_TEXT,
        AirtableFieldType.MULTILINE_TEXT,
        AirtableFieldType.EMAIL,
        AirtableFieldType.URL,
        AirtableFieldType.PHONE_NUMBER,
        AirtableFieldType.SINGLE_SELECT,
        AirtableFieldType.EXTERNAL_SYNC_SOURCE,
        AirtableFieldType.MANUAL_SORT,
    ] as const;

    for (const type of stringTypes) {
        it(`keeps strings and rejects numeric cells for ${type}`, () => {
            const config: FieldConfig = { type };
            assert.equal(primitive(config, 'Example'), 'Example');
            assert.throws(() => primitive(config, 42), Error);
        });
    }

    it('removes rich-text markdown unless preservation is requested', () => {
        const config: FieldConfig = { type: AirtableFieldType.RICH_TEXT };
        assert.equal(
            primitive(config, '# Example\n\n**bold** text'),
            'Example\n\nbold text'
        );
        assert.equal(
            convertAirtableValueToPrimitive({
                airtableFieldConfig: config,
                value: '**bold** text',
                source: emptySource,
                fieldName: 'Example field',
                doNotRemoveMarkdownFormatting: true,
            }),
            '**bold** text'
        );
        assert.throws(() => primitive(config, 42), Error);
    });

    it('converts dates in UTC and preserves absolute datetime offsets', () => {
        assert.deepEqual(
            primitive(dateField.config, '2040-06-15'),
            new Date('2040-06-15T00:00:00Z')
        );
        assert.deepEqual(
            primitive(dateTimeField.config, '2040-06-15T10:30:00+02:00'),
            new Date('2040-06-15T08:30:00Z')
        );
        for (const field of [dateField, dateTimeField]) {
            assert.throws(() => primitive(field.config, 42), Error);
        }
        const runner = new FormulaRunner('{Due date} & ""');
        runner.context = makeContext({ [dateField.id]: '2040-06-15' });
        assert.equal(runner.run(), '2040-06-15T00:00:00.000Z');
    });

    it('normalizes array cells without mutating caller data', () => {
        const values = ['First', null, 'Second', undefined];
        assert.deepEqual(primitive(selectField.config, values), [
            'First',
            'Second',
        ]);
        assert.deepEqual(values, ['First', null, 'Second', undefined]);
        assert.equal(readable(selectField.config, values), 'First, Second');
        assert.deepEqual(primitive(selectField.config, []), []);
        assert.throws(
            () => primitive(selectField.config, ['First', 42]),
            Error
        );
    });

    it('quotes commas and embedded quotes only in formula multiple-select references', () => {
        const values = ['Simple', 'Two, parts', 'A "quote"'];
        assert.equal(
            readable(selectField.config, values),
            'Simple, Two, parts, A "quote"'
        );
        const runner = new FormulaRunner('{Labels}');
        runner.context = makeContext({ [selectField.id]: values });
        assert.equal(runner.run(), 'Simple, "Two, parts", "A ""quote"""');
    });

    it('converts attachment, collaborator, barcode, button, and AI cells', () => {
        const collaborator = {
            id: 'user_example',
            name: 'Example person',
            email: 'person@example.test',
        };
        assert.deepEqual(
            primitive({ type: AirtableFieldType.MULTIPLE_ATTACHMENTS }, [
                {
                    filename: 'example.txt',
                    url: 'https://example.test/example.txt',
                },
            ]),
            ['example.txt (https://example.test/example.txt)']
        );
        assert.deepEqual(
            primitive({ type: AirtableFieldType.MULTIPLE_COLLABORATORS }, [
                collaborator,
            ]),
            ['Example person']
        );
        for (const type of [
            AirtableFieldType.SINGLE_COLLABORATOR,
            AirtableFieldType.CREATED_BY,
            AirtableFieldType.LAST_MODIFIED_BY,
        ] as const) {
            assert.equal(primitive({ type }, collaborator), 'Example person');
        }
        assert.equal(
            primitive(
                { type: AirtableFieldType.BARCODE },
                { text: 'EXAMPLE-42' }
            ),
            'EXAMPLE-42'
        );
        assert.equal(
            primitive({ type: AirtableFieldType.BARCODE }, { text: '' }),
            ''
        );
        assert.equal(
            primitive(
                { type: AirtableFieldType.BUTTON },
                { label: 'Example', url: 'https://example.test' }
            ),
            'https://example.test'
        );
        assert.equal(
            primitive(
                { type: AirtableFieldType.BUTTON },
                { label: 'Empty', url: null }
            ),
            ''
        );
        assert.equal(
            primitive(
                { type: AirtableFieldType.AI_TEXT },
                { state: 'generated', value: 'Generated example' }
            ),
            'Generated example'
        );
        assert.equal(
            primitive(
                { type: AirtableFieldType.AI_TEXT },
                { state: 'empty', value: '' }
            ),
            ''
        );
    });

    for (const type of [
        AirtableFieldType.MULTIPLE_ATTACHMENTS,
        AirtableFieldType.MULTIPLE_COLLABORATORS,
        AirtableFieldType.SINGLE_COLLABORATOR,
        AirtableFieldType.CREATED_BY,
        AirtableFieldType.LAST_MODIFIED_BY,
        AirtableFieldType.BARCODE,
        AirtableFieldType.BUTTON,
        AirtableFieldType.AI_TEXT,
    ] as const) {
        it(`rejects an incompatible ${type} cell`, () => {
            assert.throws(() => primitive({ type }, 'Example'), Error);
        });
    }

    for (const type of [
        AirtableFieldType.FORMULA,
        AirtableFieldType.ROLLUP,
    ] as const) {
        it(`uses the effective result type for scalar and array ${type} values`, () => {
            const config: FieldConfig = {
                type,
                options: { isValid: true, result: numberField.config },
            };
            assert.equal(primitive(config, 1.25), 1.25);
            assert.deepEqual(primitive(config, [1.25, null, 2]), [
                '1.25',
                '2.00',
            ]);
            assert.equal(readable(config, [1.25, 2]), '1.25, 2.00');
            assert.equal(
                primitive({ type, options: { isValid: false } }, 'Ignored'),
                ''
            );
            assert.throws(() => primitive(config, 'Wrong result type'), Error);
        });
    }

    it('formats lookup scalar results and accepts flattened array result fields', () => {
        const numericLookup: FieldConfig = {
            type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
            options: { isValid: true, result: numberField.config },
        };
        assert.deepEqual(primitive(numericLookup, [1.25, null, 2]), [
            '1.25',
            '2.00',
        ]);
        assert.equal(readable(numericLookup, [1.25, 2]), '1.25, 2.00');
        const selectLookup: FieldConfig = {
            type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
            options: { isValid: true, result: selectField.config },
        };
        assert.deepEqual(primitive(selectLookup, ['First', 'Second']), [
            'First',
            'Second',
        ]);
        assert.throws(() => primitive(numericLookup, 42), Error);
        assert.equal(
            primitive(
                {
                    type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
                    options: { isValid: false },
                },
                ['Ignored']
            ),
            ''
        );
    });

    it('formats nested computed result arrays after removing missing entries', () => {
        const currencyFormula: FieldConfig = {
            type: AirtableFieldType.FORMULA,
            options: {
                isValid: true,
                result: {
                    type: AirtableFieldType.CURRENCY,
                    options: { precision: 2, symbol: '$' },
                },
            },
        };
        const lookup: FieldConfig = {
            type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
            options: { isValid: true, result: currencyFormula },
        };
        assert.deepEqual(primitive(lookup, [12.5, null, 0, undefined]), [
            '$12.50',
            '$0.00',
        ]);
        const durationFormula: FieldConfig = {
            type: AirtableFieldType.FORMULA,
            options: {
                isValid: true,
                result: {
                    type: AirtableFieldType.DURATION,
                    options: { durationFormat: 'h:mm' },
                },
            },
        };
        assert.deepEqual(primitive(durationFormula, [60, null, 3660]), [
            '0:01',
            '1:01',
        ]);
        const formulaReturningLookup: FieldConfig = {
            type: AirtableFieldType.FORMULA,
            options: { isValid: true, result: lookup },
        };
        assert.throws(() => primitive(formulaReturningLookup, [12.5]), Error);
    });

    it('converts created and last-modified timestamps through their result configuration', () => {
        const timestamp = '2040-06-15T08:30:00Z';
        const result = dateTimeField.config;
        const created: FieldConfig = {
            type: AirtableFieldType.CREATED_TIME,
            options: { result },
        };
        const modified: FieldConfig = {
            type: AirtableFieldType.LAST_MODIFIED_TIME,
            options: { isValid: true, result },
        };
        assert.deepEqual(primitive(created, timestamp), new Date(timestamp));
        assert.deepEqual(primitive(modified, timestamp), new Date(timestamp));
        assert.equal(
            primitive(
                {
                    type: AirtableFieldType.LAST_MODIFIED_TIME,
                    options: { isValid: false, result },
                },
                timestamp
            ),
            ''
        );
        assert.equal(
            primitive(
                { type: AirtableFieldType.COUNT, options: { isValid: false } },
                42
            ),
            ''
        );
    });
});

describe('linked-record conversion', () => {
    it('resolves loaded primary fields with ID precedence and legacy name fallback', () => {
        const source: GetReadableStringSource = {
            type: 'airtableMock',
            linkedTableStates: makeLinkedState(undefined, {
                [textField.id]: 'ID title',
                [textField.name]: 'Name title',
            }),
        };
        assert.deepEqual(
            primitive(
                linkedField.config,
                [syntheticLinkedRecordId, 'Already readable'],
                source
            ),
            ['ID title', 'Already readable']
        );
        source.linkedTableStates = makeLinkedState(undefined, {
            [textField.name]: 'Legacy title',
        });
        assert.equal(
            readable(linkedField.config, [syntheticLinkedRecordId], source),
            'Legacy title'
        );
        source.linkedTableStates = makeLinkedState(undefined, {
            [textField.id]: '',
            [textField.name]: 'Ignored name',
        });
        assert.deepEqual(
            primitive(linkedField.config, [syntheticLinkedRecordId], source),
            ['']
        );
    });

    const unavailableStates: [string, TableIdsToLinkedTableLoadingStates][] = [
        ['absent', {}],
        ['not loaded', { tbl_related_items: { type: 'notLoaded' } }],
        ['loading', { tbl_related_items: { type: 'loading' } }],
        [
            'failed',
            {
                tbl_related_items: {
                    type: 'failed',
                    errorMessage: 'Synthetic failure',
                },
            },
        ],
        ['record missing', makeLinkedState()],
    ];

    for (const [label, states] of unavailableStates) {
        it(`preserves IDs or applies the requested placeholder when ${label}`, () => {
            const source: GetReadableStringSource = {
                type: 'airtableMock',
                linkedTableStates: states,
            };
            assert.deepEqual(
                primitive(
                    linkedField.config,
                    [syntheticMissingRecordId],
                    source
                ),
                [syntheticMissingRecordId]
            );
            assert.deepEqual(
                primitive(
                    linkedField.config,
                    [syntheticMissingRecordId, 'Readable'],
                    { ...source, doNotReturnRecordIdsForLinkedRecords: true }
                ),
                ['Readable']
            );
            assert.deepEqual(
                primitive(linkedField.config, [syntheticMissingRecordId], {
                    ...source,
                    doNotReturnRecordIdsForLinkedRecords: true,
                    unavailableLinkedRecordPlaceholder: 'Unavailable',
                }),
                ['Unavailable']
            );
        });
    }

    it('formats a loaded numeric primary value and joins linked formula references', () => {
        const states = makeLinkedState(
            { ...numberField, isPrimaryField: true },
            { [numberField.id]: 1.5 }
        );
        const source: GetReadableStringSource = {
            type: 'airtableMock',
            linkedTableStates: states,
        };
        assert.equal(
            readable(linkedField.config, [syntheticLinkedRecordId], source),
            '1.50'
        );
        const runner = new FormulaRunner('{Related items}');
        runner.context = makeContext(
            { [linkedField.id]: [syntheticLinkedRecordId, 'Example'] },
            undefined,
            states
        );
        assert.equal(runner.run(), '1.50, Example');
        assert.throws(() => primitive(linkedField.config, [42]), Error);
    });

    it('rejects loaded linked tables with no primary field to resolve', () => {
        const source: GetReadableStringSource = {
            type: 'airtableMock',
            linkedTableStates: {
                tbl_related_items: {
                    type: 'loaded',
                    data: {
                        state: {
                            airtableFields: [],
                            recordIdsToAirtableRecords: {},
                        },
                    },
                },
            },
        };
        assert.throws(
            () =>
                primitive(
                    linkedField.config,
                    [syntheticMissingRecordId],
                    source
                ),
            Error
        );
    });
});

describe('primitive display formatting', () => {
    const cases: [FieldConfig, number, string][] = [
        [numberField.config, 1.5, '1.50'],
        [
            { type: AirtableFieldType.PERCENT, options: { precision: 1 } },
            0.125,
            '12.5%',
        ],
        [
            {
                type: AirtableFieldType.CURRENCY,
                options: { precision: 2, symbol: '$' },
            },
            -12.5,
            '-$12.50',
        ],
        [
            {
                type: AirtableFieldType.DURATION,
                options: { durationFormat: 'h:mm' },
            },
            3660,
            '1:01',
        ],
        [
            {
                type: AirtableFieldType.DURATION,
                options: { durationFormat: 'h:mm:ss.SSS' },
            },
            3661.125,
            '1:01:01.125',
        ],
        [{ type: AirtableFieldType.COUNT, options: { isValid: true } }, 2, '2'],
        [{ type: AirtableFieldType.AUTO_NUMBER }, 2, '2'],
        [{ type: AirtableFieldType.RATING }, 2, '2'],
    ];

    for (const [config, value, expected] of cases) {
        it(`formats ${config.type} for display`, () => {
            assert.equal(readable(config, value), expected);
        });
    }

    it('formats date fields on the local calendar and datetime fields in their configured timezone', () => {
        const localMidnight = new Date(2040, 5, 15).toISOString();
        assert.equal(readable(dateField.config, localMidnight), '2040-06-15');
        assert.equal(
            readable(dateTimeField.config, '2040-06-15T08:30:00Z'),
            '2040-06-15 08:30'
        );
        const formula: FieldConfig = {
            type: AirtableFieldType.FORMULA,
            options: { isValid: true, result: dateField.config },
        };
        assert.equal(readable(formula, localMidnight), '2040-06-15');
    });

    it('keeps nonfinite values observable and validates direct primitive formatting', () => {
        for (const [value, expected] of [
            [NaN, 'NaN'],
            [Infinity, 'Infinity'],
        ] as const) {
            assert.equal(
                formatAirtablePrimitive({
                    value,
                    airtableFieldConfig: numberField.config,
                    fieldName: 'Example',
                }),
                expected
            );
        }
        assert.throws(
            () =>
                formatAirtablePrimitive({
                    value: 'Wrong',
                    airtableFieldConfig: numberField.config,
                    fieldName: 'Example',
                }),
            Error
        );
        assert.throws(
            () =>
                formatAirtablePrimitive({
                    value: 'Wrong',
                    airtableFieldConfig: dateField.config,
                    fieldName: 'Example',
                }),
            Error
        );
    });
});
