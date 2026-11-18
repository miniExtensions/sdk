import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    compileRuntimeConditions,
    compileSelectConditions,
    createFlatScalarFormRecordProjection,
    createNonLinkedFormRecordProjection,
    createScalarFormRecordProjection,
} from '../src/forms/index.js';
import type {
    AirtableValue,
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
    RuntimeFieldSchema,
    RuntimeFormRecord,
} from '../src/runtime/index.js';

// This deliberately exercises only the public forms barrel. The new entry is
// additive: neither a private policy import nor a legacy API policy switch.
type Input = Parameters<typeof createNonLinkedFormRecordProjection>[0];
type Result = ReturnType<typeof createNonLinkedFormRecordProjection>;
type Text = Extract<RuntimeFieldSchema, { fieldType: 'singleLineText' }>;
type PhysicalType =
    | 'singleSelect'
    | 'multipleSelects'
    | 'number'
    | 'percent'
    | 'currency'
    | 'rating';
type FormulaResult = 'singleLineText' | 'number' | 'percent' | 'currency';

const choices = [
    { id: 'choice-a', name: 'Alpha' },
    { id: 'choice-b', name: 'Beta' },
];

const text = (id: string, miniExtConfig: Text['miniExtConfig'] = {}): Text => ({
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

const physical = (type: PhysicalType): RuntimeAirtableField =>
    ({
        ...text('driver').airtableField,
        config: {
            type,
            options:
                type === 'singleSelect' || type === 'multipleSelects'
                    ? { choices: structuredClone(choices) }
                    : type === 'currency'
                      ? { precision: 2, symbol: '$' }
                      : type === 'rating'
                        ? { max: 10, icon: 'star', color: 'yellowBright' }
                        : { precision: 2 },
        },
    }) as RuntimeAirtableField;

const formula = (type: FormulaResult): RuntimeAirtableField =>
    ({
        ...text('driver').airtableField,
        isComputed: true,
        config: {
            type: 'formula',
            options: {
                isValid: true,
                // Only the accepted scalar is supplied. These sources are not
                // present, and this projection must not calculate the Formula.
                referencedFieldIds: ['unavailable-formula-source'],
                result: {
                    type,
                    options:
                        type === 'singleLineText'
                            ? null
                            : type === 'currency'
                              ? { precision: 2, symbol: '$' }
                              : { precision: 2 },
                },
            },
        },
    }) as RuntimeAirtableField;

const condition = (
    fieldType: string,
    operator: string,
    value: unknown,
    fieldId = 'driver'
): RuntimeConditionsDefinition =>
    ({
        logicalOperator: 'and',
        conditions: [
            {
                id: 'condition',
                type: 'singleCondition',
                setting: {
                    fieldType,
                    type: operator,
                    idOrName: { type: 'id', id: fieldId },
                    value,
                },
            },
        ],
    }) as RuntimeConditionsDefinition;

const schema = (field: RuntimeAirtableField): RuntimeFieldSchema =>
    ({
        fieldType: field.config.type,
        airtableField: field,
        miniExtConfig: {},
    }) as RuntimeFieldSchema;

const inputFor = (
    driver: RuntimeAirtableField,
    definition: RuntimeConditionsDefinition,
    value: AirtableValue
): Input => {
    const target = text('target', { conditionalFields: definition });
    return {
        compatibility: 'native-form-v1',
        formRecord: {
            type: 'edit',
            tableId: 'table-output',
            recordId: 'record-output',
            data: { driver: value, target: 'Retained answer' },
        },
        formFields: [schema(driver), target],
        airtableFields: [driver, target.airtableField],
    };
};

const available = (input: Input) => {
    const result = createNonLinkedFormRecordProjection(input);
    if (result.type !== 'available')
        assert.fail(`Expected available projection; received ${result.code}`);
    return result;
};

const expectVisibility = (input: Input, visible: boolean) => {
    const before = structuredClone(input);
    const expected = JSON.parse(
        JSON.stringify(input.formRecord)
    ) as RuntimeFormRecord;
    if (!visible) delete expected.data.target;
    const result = available(input);
    assert.deepEqual(result.formRecord, expected);
    assert.deepEqual(result.hiddenFieldIds, visible ? [] : ['target']);
    assert.deepEqual(input, before);
    assert.notEqual(result.formRecord, input.formRecord);
    assert.notEqual(result.formRecord.data, input.formRecord.data);
    return result;
};

const untrusted = (input: unknown): Result =>
    createNonLinkedFormRecordProjection(input as Input);

const blocked = (input: unknown, expectedCode?: string) => {
    const result = untrusted(input);
    assert.equal(result.type, 'blocked');
    if (result.type !== 'blocked') assert.fail('Expected whole-result refusal');
    if (expectedCode != null) assert.equal(result.code, expectedCode);
    assert.deepEqual(result.diagnostics, [{ code: result.code }]);
    assert.equal(Object.hasOwn(result, 'formRecord'), false);
    assert.equal(Object.hasOwn(result, 'record'), false);
    assert.equal(Object.hasOwn(result, 'hiddenFieldIds'), false);
    return result;
};

type Witness = {
    fieldType: PhysicalType;
    operator: string;
    operand: unknown;
    yes: AirtableValue;
    no: AirtableValue;
};

const physicalWitnesses: Witness[] = [
    ...[
        ['is', 'choice-a', 'Alpha', 'Beta'],
        ['isNot', 'choice-a', 'Beta', 'Alpha'],
        ['isAnyOf', ['choice-a'], 'Alpha', 'Beta'],
        ['isNoneOf', ['choice-a'], 'Beta', 'Alpha'],
        ['isEmpty', undefined, null, 'Alpha'],
        ['isNotEmpty', undefined, 'Alpha', null],
    ].map(([operator, operand, yes, no]) => ({
        fieldType: 'singleSelect' as const,
        operator: operator as string,
        operand,
        yes: yes as AirtableValue,
        no: no as AirtableValue,
    })),
    ...[
        ['hasAllOf', ['choice-a', 'choice-b'], ['Alpha', 'Beta'], ['Alpha']],
        ['hasAnyOf', ['choice-a'], ['Alpha', 'Beta'], ['Beta']],
        ['hasNoneOf', ['choice-a'], ['Beta'], ['Alpha']],
        ['isExactly', ['choice-a'], ['Alpha'], ['Alpha', 'Beta']],
        ['isEmpty', undefined, [], ['Alpha']],
        ['isNotEmpty', undefined, ['Alpha'], []],
    ].map(([operator, operand, yes, no]) => ({
        fieldType: 'multipleSelects' as const,
        operator: operator as string,
        operand,
        yes: yes as AirtableValue,
        no: no as AirtableValue,
    })),
    ...(['number', 'percent', 'currency', 'rating'] as const).flatMap(
        (fieldType) =>
            [
                ['equals', 5, 4],
                ['notEquals', 4, 5],
                ['greaterThan', 6, 5],
                ['lessThan', 4, 5],
                ['greaterThanOrEqualsTo', 5, 4],
                ['lessThanOrEqualsTo', 5, 6],
                ['isEmpty', fieldType === 'rating' ? 0 : null, 1],
                ['isNotEmpty', 1, fieldType === 'rating' ? 0 : null],
            ].map(([operator, yes, no]) => ({
                fieldType,
                operator: operator as string,
                operand: fieldType === 'percent' ? 500 : 5,
                yes: yes as AirtableValue,
                no: no as AirtableValue,
            }))
    ),
];

describe('public nonlinked native-form-v1 projection cohort', () => {
    it('names exactly the 44 qualified physical pairs without duplicates', () => {
        const pairs = physicalWitnesses.map(
            ({ fieldType, operator }) => `${fieldType}/${operator}`
        );
        assert.equal(pairs.length, 44);
        assert.equal(new Set(pairs).size, 44);
    });

    for (const { fieldType, operator, operand, yes, no } of physicalWitnesses) {
        it(`${fieldType}/${operator} preserves both native visibility outcomes`, () => {
            const driver = physical(fieldType);
            const definition = condition(fieldType, operator, operand);
            expectVisibility(inputFor(driver, definition, yes), true);
            expectVisibility(inputFor(driver, definition, no), false);
        });
    }

    for (const resultType of [
        'singleLineText',
        'number',
        'percent',
        'currency',
    ] as const) {
        it(`uses only the supplied Formula ${resultType} result`, () => {
            const isText = resultType === 'singleLineText';
            const definition = condition(
                resultType,
                isText ? 'is' : 'equals',
                isText ? 'ready' : resultType === 'percent' ? 50 : 5
            );
            const yes = isText ? 'ready' : resultType === 'percent' ? 0.5 : 5;
            const no = isText ? 'waiting' : 4;
            expectVisibility(
                inputFor(formula(resultType), definition, yes),
                true
            );
            expectVisibility(
                inputFor(formula(resultType), definition, no),
                false
            );
        });
    }

    it('retains direct TextIs as the legacy compiler control', () => {
        const driver = text('driver').airtableField;
        const definition = condition('singleLineText', 'is', 'ready');
        assert.deepEqual(compileSelectConditions(definition, [driver]), {
            type: 'native',
            reason: 'unqualified',
            formula: "{driver} = 'ready'",
        });
        expectVisibility(inputFor(driver, definition, 'ready'), true);
        expectVisibility(inputFor(driver, definition, 'waiting'), false);
    });

    it('preserves percent scaling and numeric versus Rating zero emptiness', () => {
        expectVisibility(
            inputFor(
                physical('percent'),
                condition('percent', 'equals', 50),
                0.5
            ),
            true
        );
        expectVisibility(
            inputFor(
                physical('percent'),
                condition('percent', 'equals', 50),
                50
            ),
            false
        );
        for (const fieldType of ['number', 'percent', 'currency'] as const)
            expectVisibility(
                inputFor(
                    physical(fieldType),
                    condition(fieldType, 'isEmpty', null),
                    0
                ),
                false
            );
        expectVisibility(
            inputFor(
                physical('rating'),
                condition('rating', 'isEmpty', null),
                0
            ),
            true
        );
    });

    it('keeps unknown choice compatibility instead of inventing new membership', () => {
        for (const [fieldType, operator, operand, answer, visible] of [
            ['singleSelect', 'is', 'deleted-choice', 'Alpha', false],
            ['singleSelect', 'isNot', 'deleted-choice', 'Alpha', false],
            [
                'singleSelect',
                'isAnyOf',
                ['choice-a', 'deleted-choice'],
                'Alpha',
                true,
            ],
            [
                'singleSelect',
                'isNoneOf',
                ['choice-a', 'deleted-choice'],
                'Beta',
                true,
            ],
            [
                'multipleSelects',
                'hasAllOf',
                ['choice-a', 'deleted-choice'],
                ['Alpha'],
                false,
            ],
            [
                'multipleSelects',
                'isExactly',
                ['choice-a', 'deleted-choice'],
                ['Alpha'],
                false,
            ],
            [
                'multipleSelects',
                'hasAnyOf',
                ['deleted-choice'],
                ['Alpha'],
                false,
            ],
            [
                'multipleSelects',
                'hasNoneOf',
                ['deleted-choice'],
                ['Alpha'],
                false,
            ],
        ] as const)
            expectVisibility(
                inputFor(
                    physical(fieldType),
                    condition(fieldType, operator, operand),
                    structuredClone(answer) as AirtableValue
                ),
                visible
            );
    });
});

describe('nonlinked native snapshot and section contract', () => {
    it('reads the full separate evaluation record while cloning the output record', () => {
        for (const visible of [true, false]) {
            const input = inputFor(
                physical('number'),
                condition('number', 'equals', 5),
                visible ? 0 : 5
            );
            const separate: Input = {
                ...input,
                formRecordForConditionEvaluation: {
                    type: 'create',
                    data: { driver: visible ? 5 : 0 },
                },
            };
            expectVisibility(separate, visible);
        }
    });

    it('decides later fields from an unpruned hidden driver', () => {
        const input = inputFor(
            physical('number'),
            condition('number', 'equals', 5),
            5
        );
        const driver = {
            ...schema(physical('number')),
            miniExtConfig: {
                conditionalFields: condition(
                    'singleLineText',
                    'is',
                    'show',
                    'gate'
                ),
            },
        } as RuntimeFieldSchema;
        const gate = text('gate');
        const result = available({
            ...input,
            formRecord: {
                ...input.formRecord,
                data: { ...input.formRecord.data, gate: 'hide' },
            },
            formFields: [gate, driver, input.formFields[1]!],
            airtableFields: [...input.airtableFields, gate.airtableField],
        });
        assert.deepEqual(result.hiddenFieldIds, ['driver']);
        assert.equal(result.formRecord.data.target, 'Retained answer');
        assert.equal(Object.hasOwn(result.formRecord.data, 'driver'), false);
    });

    it('honors complete raw section order even when a header is not displayed', () => {
        const driver = physical('number');
        const lead = text('lead', {
            headerSectionTitle: 'Conditional section',
            enableSectionHeader: false,
            applyFieldConditionsToSection: true,
            conditionalFields: condition('number', 'equals', 5),
        });
        const follower = text('follower');
        const reset = text('reset', { headerSectionTitle: 'Next section' });
        const last = text('last');
        const result = available({
            compatibility: 'native-form-v1',
            formRecord: {
                type: 'create',
                data: {
                    driver: 0,
                    lead: 'A',
                    follower: 'B',
                    reset: 'C',
                    last: 'D',
                },
            },
            formFields: [schema(driver), lead, follower, reset, last],
            airtableFields: [
                driver,
                ...[lead, follower, reset, last].map(
                    (field) => field.airtableField
                ),
            ],
        });
        assert.deepEqual(result.hiddenFieldIds, ['lead', 'follower']);
        assert.deepEqual(result.formRecord.data, {
            driver: 0,
            reset: 'C',
            last: 'D',
        });
    });

    it('JSON-normalizes detached native output and nested metadata without filtering retained values', () => {
        const base = inputFor(
            physical('number'),
            condition('number', 'equals', 5),
            5
        );
        const formRecord = {
            ...base.formRecord,
            omitted: undefined,
            metadata: { keep: ['original'], omitted: undefined },
            data: {
                ...base.formRecord.data,
                zero: -0,
                notFinite: NaN,
                untouchedLinks: ['unknown-record', 'unknown-record'],
            },
        };
        const result = available({ ...base, formRecord } as Input);
        assert.equal(Object.hasOwn(result.formRecord, 'omitted'), false);
        assert.equal(Object.is(result.formRecord.data.zero, -0), false);
        assert.equal(result.formRecord.data.notFinite, null);
        assert.deepEqual(result.formRecord.data.untouchedLinks, [
            'unknown-record',
            'unknown-record',
        ]);
        const metadata = Reflect.get(result.formRecord, 'metadata') as {
            keep: string[];
        };
        assert.deepEqual(metadata, { keep: ['original'] });
        metadata.keep.push('output-only');
        assert.deepEqual(formRecord.metadata.keep, ['original']);
        assert.equal(Object.is(formRecord.data.zero, -0), true);
        assert.equal(Number.isNaN(formRecord.data.notFinite), true);
    });

    it('preserves linked values when a field ID matches an inherited property', () => {
        const fieldId = '__proto__';
        const linkedField: RuntimeAirtableField = {
            ...text('Retained linked records').airtableField,
            id: fieldId,
            config: {
                type: 'multipleRecordLinks',
                options: {
                    linkedTableId: 'table-linked',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                },
            },
        };
        const base = inputFor(
            physical('number'),
            condition('number', 'equals', 5),
            0
        );
        const linkedRecords = ['record-linked'];
        const formRecord = {
            ...base.formRecord,
            data: { ...base.formRecord.data, [fieldId]: linkedRecords },
        };
        const result = available({
            ...base,
            formRecord,
            formFields: [...base.formFields, schema(linkedField)],
            airtableFields: [...base.airtableFields, linkedField],
        });
        assert.deepEqual(result.hiddenFieldIds, ['target']);
        assert(Object.hasOwn(result.formRecord.data, fieldId));
        assert.deepEqual(result.formRecord.data[fieldId], linkedRecords);
        assert.notEqual(result.formRecord.data[fieldId], linkedRecords);
        assert.deepEqual(formRecord.data[fieldId], ['record-linked']);
    });

    it('disables condition pruning without introducing linked filtering', () => {
        const base = inputFor(
            physical('number'),
            condition('number', 'equals', 5),
            0
        );
        expectVisibility({ ...base, evaluateConditionalFields: false }, true);
    });
});

describe('whole-result native fallback boundary', () => {
    const base = () =>
        inputFor(physical('number'), condition('number', 'equals', 5), 5);

    it('rejects linked-only inputs even if their supplied containers are empty', () => {
        for (const extra of [
            { linkedTableLoadingStates: {} },
            { linkedTableLoadingStates: { table: { type: 'loading' } } },
            { conditionalLinkedRecordFieldIdsToFilteringValues: {} },
        ])
            blocked({ ...base(), ...extra }, 'invalid-snapshot');
    });

    it('refuses active filtering but retains explicitly inactive filter metadata', () => {
        const withFilterConfiguration = (
            configuration: Record<string, unknown>
        ): Input => {
            const input = base();
            const target = text('target', {
                conditionalFields: condition('number', 'equals', 5),
            });
            for (const [key, value] of Object.entries(configuration))
                Reflect.set(target.miniExtConfig!, key, value);
            return {
                ...input,
                formFields: [input.formFields[0]!, target],
            };
        };
        const filtering = condition('number', 'equals', 5);
        for (const configuration of [
            {
                filterLinkedRecordsConditionFields: filtering,
                filterLinkedRecordsToggle: true,
            },
            { conditionalLinkedRecordFilterFields: ['driver'] },
        ])
            blocked(withFilterConfiguration(configuration), 'invalid-snapshot');
        for (const configuration of [
            {
                filterLinkedRecordsConditionFields: filtering,
                filterLinkedRecordsToggle: false,
            },
            {
                filterLinkedRecordsConditionFields: filtering,
                filterApplicationMode: 'record-finder-only',
            },
            { conditionalLinkedRecordFilterFields: [] },
        ])
            expectVisibility(withFilterConfiguration(configuration), true);
    });

    it('rejects named references and operators outside the finite cohort', () => {
        const named = condition('number', 'equals', 5);
        const namedLeaf = named.conditions[0];
        assert.equal(namedLeaf?.type, 'singleCondition');
        if (namedLeaf?.type !== 'singleCondition')
            assert.fail('Expected one direct condition');
        Reflect.set(namedLeaf.setting, 'idOrName', {
            type: 'name',
            name: 'driver',
        });
        blocked({
            ...base(),
            formFields: [
                schema(physical('number')),
                text('target', { conditionalFields: named }),
            ],
        });
        for (const [driver, definition, value] of [
            [
                physical('singleSelect'),
                condition('singleSelect', 'matchesRegex', '^Alpha'),
                'Alpha',
            ],
            [
                text('driver').airtableField,
                condition('singleLineText', 'contains', 'ready'),
                'ready',
            ],
            [physical('number'), condition('number', 'unknown-operator', 5), 5],
        ] as const)
            blocked(inputFor(driver, definition, value));
    });

    it('does not partially project an unsupported mixed group or a hidden unsupported field', () => {
        const supported = condition('number', 'equals', 5);
        const unsupported = condition('number', 'matchesRegex', '.*');
        const mixed: RuntimeConditionsDefinition = {
            logicalOperator: 'or',
            conditions: [...supported.conditions, ...unsupported.conditions],
        };
        blocked({
            ...base(),
            formFields: [text('target', { conditionalFields: mixed })],
        });
        blocked({
            ...base(),
            evaluateConditionalFields: false,
            formFields: [text('target', { conditionalFields: mixed })],
        });
        const hiddenSection = text('lead', {
            headerSectionTitle: 'Hidden',
            applyFieldConditionsToSection: true,
            conditionalFields: condition('number', 'equals', 0),
        });
        const bad = text('target', { conditionalFields: unsupported });
        blocked({
            ...base(),
            formFields: [hiddenSection, bad],
            airtableFields: [
                physical('number'),
                hiddenSection.airtableField,
                bad.airtableField,
            ],
        });
    });

    it('rejects invalid physical/Formula metadata and mismatched condition result types', () => {
        const malformedDrivers: Array<{
            driver: unknown;
            resultType: FormulaResult;
        }> = [
            {
                driver: { ...physical('number'), isComputed: true },
                resultType: 'number',
            },
            {
                driver: { ...physical('number'), isComputed: undefined },
                resultType: 'number',
            },
            {
                driver: { ...formula('number'), isComputed: false },
                resultType: 'number',
            },
            {
                driver: {
                    ...formula('number'),
                    config: {
                        type: 'formula',
                        options: {
                            isValid: false,
                            result: {
                                type: 'number',
                                options: { precision: 2 },
                            },
                        },
                    },
                },
                resultType: 'number',
            },
            {
                driver: {
                    ...formula('number'),
                    config: {
                        type: 'formula',
                        options: {
                            isValid: true,
                            result: {
                                type: 'number',
                                options: { precision: NaN },
                            },
                        },
                    },
                },
                resultType: 'number',
            },
            {
                driver: {
                    ...formula('currency'),
                    config: {
                        type: 'formula',
                        options: {
                            isValid: true,
                            result: {
                                type: 'currency',
                                options: { precision: 2 },
                            },
                        },
                    },
                },
                resultType: 'currency',
            },
        ];
        for (const { driver, resultType } of malformedDrivers)
            blocked(
                inputFor(
                    driver as RuntimeAirtableField,
                    condition(resultType, 'equals', 5),
                    5
                )
            );
        blocked(
            inputFor(formula('percent'), condition('number', 'equals', 5), 5)
        );
        const duplicate = base();
        blocked(
            {
                ...duplicate,
                airtableFields: [
                    ...duplicate.airtableFields,
                    duplicate.airtableFields[0],
                ],
            },
            'invalid-snapshot'
        );
        const duplicateName = {
            ...text('other').airtableField,
            name: 'driver',
        };
        blocked(
            {
                ...base(),
                airtableFields: [...base().airtableFields, duplicateName],
            },
            'invalid-snapshot'
        );
    });

    it('refuses wrong or nonfinite supplied Formula scalars and preserves missing values', () => {
        for (const resultType of [
            'singleLineText',
            'number',
            'percent',
            'currency',
        ] as const) {
            const isText = resultType === 'singleLineText';
            const definition = condition(
                resultType,
                isText ? 'is' : 'equals',
                isText ? 'ready' : 5
            );
            const invalid: unknown[] = isText
                ? [5, { text: 'ready' }]
                : ['5', NaN, Infinity, -Infinity];
            for (const value of invalid)
                blocked(
                    inputFor(
                        formula(resultType),
                        definition,
                        value as AirtableValue
                    ),
                    'unsupported-driver'
                );
            const input = inputFor(formula(resultType), definition, null);
            expectVisibility(input, false);
            expectVisibility(
                {
                    ...input,
                    formRecord: {
                        ...input.formRecord,
                        data: { target: 'Retained answer' },
                    },
                },
                false
            );
        }
    });

    it('refuses conflicting schema and physical configuration even with matching IDs and types', () => {
        const cases: Array<{
            driver: RuntimeAirtableField;
            definition: RuntimeConditionsDefinition;
            value: AirtableValue;
            options: unknown;
        }> = [];
        for (const fieldType of ['singleSelect', 'multipleSelects'] as const) {
            for (const changedChoice of [
                { id: 'changed-id', name: 'Alpha' },
                { id: 'choice-a', name: 'Changed name' },
            ])
                cases.push({
                    driver: physical(fieldType),
                    definition: condition(
                        fieldType,
                        fieldType === 'singleSelect' ? 'is' : 'hasAnyOf',
                        fieldType === 'singleSelect' ? 'choice-a' : ['choice-a']
                    ),
                    value: fieldType === 'singleSelect' ? 'Alpha' : ['Alpha'],
                    options: { choices: [changedChoice, choices[1]] },
                });
        }
        for (const fieldType of ['number', 'percent', 'currency'] as const)
            cases.push({
                driver: physical(fieldType),
                definition: condition(fieldType, 'equals', 5),
                value: 5,
                options:
                    fieldType === 'currency'
                        ? { precision: 2, symbol: '€' }
                        : { precision: 3 },
            });
        cases.push({
            driver: formula('number'),
            definition: condition('number', 'equals', 5),
            value: 5,
            options: {
                isValid: true,
                referencedFieldIds: ['unavailable-formula-source'],
                result: { type: 'number', options: { precision: 3 } },
            },
        });
        cases.push({
            driver: formula('number'),
            definition: condition('number', 'equals', 5),
            value: 5,
            options: {
                isValid: true,
                referencedFieldIds: ['unavailable-formula-source'],
                result: { type: 'percent', options: { precision: 2 } },
            },
        });
        for (const { driver, definition, value, options } of cases) {
            const input = inputFor(driver, definition, value);
            const fields = structuredClone(input.formFields);
            Reflect.set(fields[0]!.airtableField.config, 'options', options);
            blocked({ ...input, formFields: fields }, 'invalid-snapshot');
        }
    });

    it('accepts equivalent configuration with a different object key order', () => {
        const input = inputFor(
            physical('currency'),
            condition('currency', 'equals', 5),
            5
        );
        const fields = structuredClone(input.formFields);
        Reflect.set(fields[0]!.airtableField.config, 'options', {
            symbol: '$',
            precision: 2,
        });
        expectVisibility({ ...input, formFields: fields }, true);
    });

    it('rejects malformed typed operands and choice definitions without partial output', () => {
        for (const [fieldType, operator, operand, answer] of [
            ['number', 'equals', '5', 5],
            ['number', 'equals', Infinity, 5],
            ['singleSelect', 'is', 7, 'Alpha'],
            ['multipleSelects', 'hasAnyOf', ['choice-a', 7], ['Alpha']],
        ] as const)
            blocked(
                inputFor(
                    physical(fieldType),
                    condition(fieldType, operator, operand),
                    structuredClone(answer) as AirtableValue
                )
            );
        for (const invalidChoices of [
            [
                { id: 'same', name: 'Alpha' },
                { id: 'same', name: 'Beta' },
            ],
            [
                { id: 'a', name: 'same' },
                { id: 'b', name: 'same' },
            ],
            [{ id: '', name: 'Alpha' }],
        ]) {
            const driver = physical('singleSelect');
            Reflect.set(driver.config, 'options', { choices: invalidChoices });
            blocked(
                inputFor(driver, condition('singleSelect', 'is', 'a'), 'Alpha')
            );
        }
    });

    it('validates snapshot descriptors before reading accessors', () => {
        const input = base();
        let reads = 0;
        Object.defineProperty(input, 'formFields', {
            enumerable: true,
            get() {
                reads++;
                throw new Error('Snapshot accessor must not run');
            },
        });
        blocked(input, 'invalid-snapshot');
        assert.equal(reads, 0);
    });

    it('rejects sparse, cyclic, contradictory and wrongly tagged snapshots', () => {
        blocked(
            { ...base(), compatibility: 'future-native-form' },
            'invalid-snapshot'
        );
        const sparse = condition('number', 'equals', 5);
        delete sparse.conditions[0];
        blocked({
            ...base(),
            formFields: [text('target', { conditionalFields: sparse })],
        });
        const cyclic = condition('number', 'equals', 5);
        cyclic.conditions.push({
            ...cyclic,
            id: 'cycle',
            type: 'groupCondition',
        });
        blocked({
            ...base(),
            formFields: [text('target', { conditionalFields: cyclic })],
        });
        const inconsistent = base();
        blocked(
            {
                ...inconsistent,
                formFields: [text('driver'), inconsistent.formFields[1]],
            },
            'invalid-snapshot'
        );
    });

    it('leaves prior public scalar and compiler Formula/select policy unchanged', () => {
        for (const driver of [physical('singleSelect'), formula('number')]) {
            const isSelect = driver.config.type === 'singleSelect';
            const definition = condition(
                isSelect ? 'singleSelect' : 'number',
                isSelect ? 'is' : 'equals',
                isSelect ? 'choice-a' : 5
            );
            const input = inputFor(driver, definition, isSelect ? 'Alpha' : 5);
            const fieldIdsToSchemas = Object.fromEntries(
                input.formFields.map((field) => [
                    field.airtableField.id,
                    structuredClone(field),
                ])
            ) as Record<string, RuntimeFieldSchema>;
            const airtableFields = structuredClone(
                input.airtableFields
            ) as RuntimeAirtableField[];
            const legacyInput = {
                fieldIds: input.formFields.map(
                    (field) => field.airtableField.id
                ),
                fieldIdsToSchemas,
                airtableFields,
                data: structuredClone(
                    input.formRecord.data
                ) as RuntimeFormRecord['data'],
                recordId: 'record-output',
                invalidConditionMode: 'strict' as const,
            };
            assert.equal(
                createScalarFormRecordProjection(legacyInput).type,
                'blocked'
            );
            assert.equal(
                createFlatScalarFormRecordProjection(legacyInput).type,
                'blocked'
            );
            if (!isSelect)
                assert.equal(
                    compileRuntimeConditions({
                        conditions: definition,
                        airtableFields: [driver],
                        invalidConditionMode: 'strict',
                    }).type,
                    'unsupported'
                );
        }
    });
});
