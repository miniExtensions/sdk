// Synthetic full native records; expected results come only from the pinned UI.
const choices = [
    { id: 'choice-allow', name: 'Allow', color: 'blueLight2' },
    { id: 'choice-other', name: 'Other', color: 'redLight2' },
];
const textField = (id, miniExtConfig = {}) => ({
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
const selectField = (metadata = choices, name = 'Decision') => ({
    ...textField('driver'),
    fieldType: 'singleSelect',
    airtableField: {
        ...textField('driver').airtableField,
        name,
        config: { type: 'singleSelect', options: { choices: metadata } },
    },
});
const ruleFor = (type, value) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'synthetic-select-rule',
            type: 'singleCondition',
            setting: {
                type,
                fieldType: 'singleSelect',
                idOrName: { type: 'id', id: 'driver' },
                ...(!['isEmpty', 'isNotEmpty'].includes(type) ? { value } : {}),
            },
        },
    ],
});
const make = (name, type, nativeValue, options = {}) => {
    const value =
        options.operand ??
        (['isAnyOf', 'isNoneOf'].includes(type)
            ? ['choice-allow']
            : 'choice-allow');
    const rule = options.rule ?? ruleFor(type, value);
    const driver = selectField(options.choices, options.fieldName);
    const target = textField('target', {
        conditionalFields: rule,
        ...options.targetConfig,
    });
    const validationTarget = textField('validationTarget', {
        fieldValidationConditionalFields: rule,
        ...options.validationConfig,
    });
    const fields = options.fields?.({
        driver,
        target,
        validationTarget,
        rule,
    }) ?? [driver, target, textField('follower'), validationTarget];
    const data = {
        ...Object.fromEntries(
            fields.map((f) => [f.airtableField.id, 'Answer'])
        ),
        driver: nativeValue,
        unrendered: {
            nested: ['synthetic', { retained: true }],
        },
        ...options.data,
    };
    if (options.omitDriver) delete data.driver;
    return {
        name,
        rule,
        input: {
            fieldIds: fields.map((f) => f.airtableField.id),
            fieldIdsToSchemas: Object.fromEntries(
                fields.map((f) => [f.airtableField.id, f])
            ),
            airtableFields: fields.map((f) => f.airtableField),
            data,
            recordId: 'rec_synthetic_select',
            invalidConditionMode: 'strict',
        },
    };
};
const predicates = [
    'is',
    'isNot',
    'isAnyOf',
    'isNoneOf',
    'isEmpty',
    'isNotEmpty',
];
export const singleSelectFormDriverCases = [
    ...predicates.flatMap((type) =>
        [
            ['matching', 'Allow'],
            ['nonmatching', 'Other'],
            ['null', null],
            ['empty', ''],
        ].map(([shape, native]) => make(`${type}-${shape}`, type, native))
    ),
    ...['is', 'isNot', 'isAnyOf', 'isNoneOf'].map((type) =>
        make(`${type}-unknown-choice-false`, type, 'Allow', {
            operand: ['isAnyOf', 'isNoneOf'].includes(type)
                ? ['choice-removed']
                : 'choice-removed',
        })
    ),
    ...['isAnyOf', 'isNoneOf'].map((type) =>
        make(`${type}-mixed-known-unknown`, type, 'Allow', {
            operand: ['choice-removed', 'choice-allow', 'choice-allow'],
        })
    ),
    ...predicates.map((type) =>
        make(`${type}-missing-native`, type, null, {
            omitDriver: true,
        })
    ),
    make('renamed-choice-current-native', 'is', 'Approved', {
        choices: [{ ...choices[0], name: 'Approved' }, choices[1]],
    }),
    make('renamed-choice-stale-native', 'is', 'Allow', {
        choices: [{ ...choices[0], name: 'Approved' }, choices[1]],
    }),
    make('renamed-field-saved-id', 'isAnyOf', 'Allow', {
        fieldName: 'Renamed Decision',
    }),
    make('exact-native-case', 'is', 'allow'),
    make('exact-native-whitespace', 'is', ' Allow '),
    make('escaped-native-choice-name', 'is', "Owner's } approval", {
        choices: [{ ...choices[0], name: "Owner's } approval" }, choices[1]],
    }),
    ...[true, false].map((enabled) =>
        make(
            `retained-${enabled ? 'enabled' : 'disabled'}-section-header-order`,
            'is',
            'Other',
            {
                targetConfig: {
                    headerSectionTitle: ' Decision section ',
                    enableSectionHeader: enabled,
                    applyFieldConditionsToSection: true,
                },
                fields: ({ driver, target, validationTarget }) => [
                    textField('before'),
                    driver,
                    target,
                    textField('follower'),
                    textField('reset', { headerSectionTitle: 'Next section' }),
                    textField('after'),
                    validationTarget,
                ],
            }
        )
    ),
    make('hidden-driver-full-native-snapshot', 'is', 'Allow', {
        fields: ({ driver, target, validationTarget }) => [
            {
                ...driver,
                miniExtConfig: {
                    conditionalFields: ruleFor('is', 'choice-other'),
                },
            },
            target,
            textField('follower'),
            validationTarget,
        ],
    }),
    make('section-follower-own-select-rule', 'is', 'Allow', {
        targetConfig: {
            headerSectionTitle: 'Decision section',
            applyFieldConditionsToSection: true,
        },
        fields: ({ driver, target, validationTarget }) => [
            driver,
            target,
            textField('follower', {
                conditionalFields: ruleFor('is', 'choice-other'),
            }),
            textField('reset', { headerSectionTitle: 'Next section' }),
            validationTarget,
        ],
    }),
    make('nested-select-group', 'is', 'Other', {
        rule: {
            logicalOperator: 'or',
            conditions: [
                {
                    id: 'synthetic-nested',
                    type: 'groupCondition',
                    ...ruleFor('is', 'choice-allow'),
                },
                ...ruleFor('is', 'choice-other').conditions,
            ],
        },
    }),
    make('readonly-validation-skips', 'is', 'Other', {
        validationConfig: { readOnly: true },
    }),
];
