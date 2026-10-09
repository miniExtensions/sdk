/** Public synthetic cases; canonical oracle records only result categories. */
export const conditionalField = (
    id,
    type = 'singleLineText',
    miniExtConfig = {},
    extra = {}
) => ({
    fieldType: type,
    airtableField: {
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type, options: null },
        ...extra,
    },
    miniExtConfig,
});
export const conditionalRule = (
    type = 'is',
    value = 'allow',
    fieldType = 'singleLineText',
    reference = { type: 'id', id: 'driver' }
) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'synthetic-rule',
            type: 'singleCondition',
            setting: { type, fieldType, idOrName: reference, value },
        },
    ],
});
const make = (
    name,
    {
        rule = conditionalRule(),
        data = {
            target: 'Answer',
            driver: 'deny',
            native: { text: 'retained' },
        },
        mini = {},
        driverType = 'singleLineText',
        expectedCode = 'conditional-validation',
        hidden = false,
        targetType = 'singleLineText',
        targetExtra = {},
        comparison = 'parity',
        drivers,
        ...rest
    } = {}
) => ({
    name,
    schemas: {
        target: conditionalField(
            'target',
            targetType,
            { fieldValidationConditionalFields: rule, ...mini },
            targetExtra
        ),
        driver: conditionalField('driver', driverType),
        ...drivers,
    },
    data,
    hidden,
    expectedCode,
    comparison,
    ...rest,
});
export const conditionalPageValidationCases = [
    make('text-false'),
    make('text-true', {
        data: { target: 'Answer', driver: 'allow' },
        expectedCode: null,
    }),
    make('exact-empty-custom-suppresses', {
        mini: { customErrorMessageForFieldValidation: '' },
        expectedCode: null,
    }),
    ...[null, 'Synthetic custom text'].map((v, i) =>
        make(`custom-generic-${i}`, {
            mini: { customErrorMessageForFieldValidation: v },
        })
    ),
    make('required-first', {
        data: { target: '', driver: 'deny' },
        mini: { required: true },
        expectedCode: 'required',
    }),
    make('character-limit-first', {
        mini: { characterLimit: 2 },
        expectedCode: 'character-limit',
    }),
    make('negative-first', {
        targetType: 'number',
        data: { target: -2, driver: 'deny' },
        mini: { allowNegativeNumbers: false },
        expectedCode: 'negative-number',
    }),
    make('email-first', {
        targetType: 'email',
        data: { target: 'invalid-email', driver: 'deny' },
        expectedCode: 'invalid-email',
    }),
    make('url-first', {
        targetType: 'url',
        data: { target: 'invalid-url', driver: 'deny' },
        expectedCode: 'invalid-url',
    }),
    make('readonly-skips', { mini: { readOnly: true }, expectedCode: null }),
    make('hidden-skips', { hidden: true, expectedCode: null }),
    make('computed-skips', {
        targetType: 'formula',
        targetExtra: {
            isComputed: true,
            config: {
                type: 'formula',
                options: { result: { type: 'singleLineText', options: null } },
            },
        },
        expectedCode: null,
    }),
    make('no-rules', {
        rule: { logicalOperator: 'and', conditions: [] },
        expectedCode: null,
    }),
    ...[
        'is',
        'isNot',
        'contains',
        'doesNotContain',
        'isEmpty',
        'isNotEmpty',
    ].map((type) =>
        make(`text-${type}`, {
            rule: conditionalRule(type, 'allow'),
            expectedCode: ['isNot', 'doesNotContain', 'isNotEmpty'].includes(
                type
            )
                ? null
                : 'conditional-validation',
        })
    ),
    ...['number', 'percent', 'currency', 'rating', 'duration'].flatMap(
        (driverType) => [
            make(`${driverType}-true`, {
                driverType,
                rule: conditionalRule('equals', 3, driverType),
                data: {
                    target: 'Answer',
                    driver: driverType === 'percent' ? 0.03 : 3,
                },
                expectedCode:
                    driverType === 'duration' ? 'unsupported-validation' : null,
                comparison: driverType === 'duration' ? 'refusal' : 'parity',
            }),
            make(`${driverType}-false`, {
                driverType,
                rule: conditionalRule('equals', 3, driverType),
                data: { target: 'Answer', driver: 2 },
                expectedCode:
                    driverType === 'duration'
                        ? 'unsupported-validation'
                        : 'conditional-validation',
                comparison: driverType === 'duration' ? 'refusal' : 'parity',
            }),
        ]
    ),
    make('checkbox-true', {
        driverType: 'checkbox',
        rule: conditionalRule('is', true, 'checkbox'),
        data: { target: 'Answer', driver: true },
        expectedCode: null,
    }),
    make('checkbox-false', {
        driverType: 'checkbox',
        rule: conditionalRule('is', true, 'checkbox'),
        data: { target: 'Answer', driver: false },
    }),
    make('nested-or-group', {
        rule: {
            logicalOperator: 'or',
            conditions: [
                {
                    id: 'nested',
                    type: 'groupCondition',
                    ...conditionalRule('is', 'allow'),
                },
                ...conditionalRule('is', 'deny').conditions,
            ],
        },
        expectedCode: null,
    }),
    make('name-reference', {
        rule: conditionalRule('is', 'allow', 'singleLineText', {
            type: 'name',
            name: 'driver',
        }),
    }),
    ...[
        'singleSelect',
        'multipleSelects',
        'date',
        'dateTime',
        'multipleRecordLinks',
        'formula',
    ].map((driverType) =>
        make(`unsupported-${driverType}`, {
            driverType,
            rule: conditionalRule('is', 'missing-choice', driverType),
            comparison: 'refusal',
            expectedCode: 'unsupported-validation',
        })
    ),
    ...['singleSelect', 'multipleSelects'].flatMap((driverType) =>
        ['known', 'missing'].flatMap((operand) =>
            ['null', 'native'].map((shape) =>
                make(`select-boundary-${driverType}-${operand}-${shape}`, {
                    driverType,
                    rule: conditionalRule(
                        driverType === 'singleSelect' ? 'is' : 'hasAnyOf',
                        driverType === 'singleSelect'
                            ? operand === 'known'
                                ? 'choice-known'
                                : 'choice-missing'
                            : [
                                  operand === 'known'
                                      ? 'choice-known'
                                      : 'choice-missing',
                              ],
                        driverType
                    ),
                    data: {
                        target: 'Answer',
                        driver:
                            shape === 'null'
                                ? null
                                : driverType === 'singleSelect'
                                  ? { id: 'choice-known', name: 'Known' }
                                  : [{ id: 'choice-known', name: 'Known' }],
                    },
                    drivers: {
                        driver: conditionalField(
                            'driver',
                            driverType,
                            {},
                            {
                                config: {
                                    type: driverType,
                                    options: {
                                        choices: [
                                            {
                                                id: 'choice-known',
                                                name: 'Known',
                                                color: 'blueLight2',
                                            },
                                        ],
                                    },
                                },
                            }
                        ),
                    },
                    comparison: 'refusal',
                    expectedCode: 'unsupported-validation',
                })
            )
        )
    ),
    make('missing-schema', {
        rule: conditionalRule('is', 'allow', 'singleLineText', {
            type: 'id',
            id: 'absent',
        }),
        comparison: 'refusal',
        expectedCode: 'unsupported-validation',
    }),
    make('duplicate-name-alias', {
        rule: conditionalRule('is', 'allow', 'singleLineText', {
            type: 'name',
            name: 'driver',
        }),
        drivers: {
            alias: conditionalField(
                'alias',
                'singleLineText',
                {},
                { name: 'driver' }
            ),
        },
        comparison: 'refusal',
        expectedCode: 'unsupported-validation',
    }),
    make('schema-id-alias', {
        drivers: { alias: conditionalField('driver') },
        comparison: 'refusal',
        expectedCode: 'unsupported-validation',
    }),
    make('malformed-native', {
        data: { target: 'Answer', driver: { text: 'synthetic-invalid' } },
        comparison: 'refusal',
        expectedCode: 'unsupported-validation',
    }),
    make('malformed-rule', {
        rule: {
            logicalOperator: 'and',
            conditions: [
                {
                    type: 'singleCondition',
                    setting: {
                        type: 'unknown',
                        fieldType: 'singleLineText',
                        idOrName: { type: 'id', id: 'driver' },
                    },
                },
            ],
        },
        comparison: 'refusal',
        expectedCode: 'unsupported-validation',
    }),
    make('empty-custom-does-not-suppress-refusal', {
        rule: conditionalRule('is', 'allow', 'singleSelect'),
        driverType: 'singleSelect',
        mini: { customErrorMessageForFieldValidation: '' },
        comparison: 'refusal',
        expectedCode: 'unsupported-validation',
    }),
];
