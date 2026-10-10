// Synthetic native names; expected outputs are executed by the pinned frontend.
const choices = [
    { id: 'choice-allow', name: 'Allow', color: 'blueLight2' },
    { id: 'choice-other', name: 'Other', color: 'redLight2' },
];
const text = (id, miniExtConfig = {}) => ({
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
const ruleFor = (type, value) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'synthetic-multi-select-rule',
            type: 'singleCondition',
            setting: {
                type,
                fieldType: 'multipleSelects',
                idOrName: { type: 'id', id: 'driver' },
                ...(!['isEmpty', 'isNotEmpty'].includes(type) ? { value } : {}),
            },
        },
    ],
});
const make = (name, type, native, options = {}) => {
    const rule =
        options.rule ?? ruleFor(type, options.operand ?? ['choice-allow']);
    const driver = {
        ...text('driver', options.driverConfig),
        fieldType: 'multipleSelects',
        airtableField: {
            ...text('driver').airtableField,
            name: options.fieldName ?? 'Decisions',
            config: {
                type: 'multipleSelects',
                options: { choices: options.choices ?? choices },
            },
        },
    };
    const target = text('target', {
        conditionalFields: rule,
        ...options.targetConfig,
    });
    const validationTarget = text('validationTarget', {
        fieldValidationConditionalFields: rule,
        ...options.validationConfig,
    });
    const fields = options.fields?.({
        driver,
        target,
        validationTarget,
        rule,
    }) ?? [driver, target, text('follower'), validationTarget];
    const data = {
        ...Object.fromEntries(
            fields.map((f) => [f.airtableField.id, 'Answer'])
        ),
        driver: native,
        unrendered: { nested: ['synthetic', { retained: true }] },
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
            recordId: 'rec_synthetic_multi_select',
            invalidConditionMode: 'strict',
        },
    };
};
const operators = [
    'hasAnyOf',
    'hasAllOf',
    'hasNoneOf',
    'isExactly',
    'isEmpty',
    'isNotEmpty',
];
export const multipleSelectFormDriverCases = [
    ...operators.flatMap((type) =>
        [
            ['matching', ['Allow']],
            ['nonmatching', ['Other']],
            ['null', null],
            ['empty', []],
            ['duplicate-native', ['Allow', 'Allow']],
            ['unknown-native', ['Deleted']],
        ].map(([shape, value]) => make(`${type}-${shape}`, type, value))
    ),
    ...operators.map((type) =>
        make(`${type}-missing-native`, type, null, { omitDriver: true })
    ),
    ...['hasAnyOf', 'hasAllOf', 'hasNoneOf', 'isExactly'].flatMap((type) => [
        make(`${type}-unknown-choice`, type, ['Allow'], {
            operand: ['choice-deleted'],
        }),
        make(`${type}-partial-unknown`, type, ['Allow'], {
            operand: ['choice-deleted', 'choice-allow', 'choice-allow'],
        }),
    ]),
    make('reordered-native-exact', 'isExactly', ['Other', 'Allow'], {
        operand: ['choice-allow', 'choice-other'],
    }),
    make('duplicate-operand-exact', 'isExactly', ['Allow'], {
        operand: ['choice-allow', 'choice-allow'],
    }),
    make('renamed-current-name', 'hasAnyOf', ['Approved'], {
        choices: [{ ...choices[0], name: 'Approved' }, choices[1]],
    }),
    make('renamed-stale-name', 'hasAnyOf', ['Allow'], {
        choices: [{ ...choices[0], name: 'Approved' }, choices[1]],
    }),
    make('exact-case', 'hasAnyOf', ['allow']),
    make('exact-whitespace', 'hasAnyOf', [' Allow ']),
    make('whitespace-choice', 'isExactly', [' Allow '], {
        choices: [{ ...choices[0], name: ' Allow ' }],
    }),
    make('empty-native-member', 'isEmpty', ['']),
    ...[
        ['comma', 'Comma, value'],
        ['double-quote', 'Quote "value"'],
        ['regex', '(a)+[b].*?'],
        ['emoji', 'Choice 🧭'],
    ].map(([label, value]) =>
        make(`serialized-${label}`, 'isExactly', [value], {
            choices: [{ ...choices[0], name: value }],
        })
    ),
    make('hidden-driver-full-native', 'hasAnyOf', ['Allow'], {
        driverConfig: {
            conditionalFields: ruleFor('hasNoneOf', ['choice-allow']),
        },
    }),
    make('readonly-target-validation', 'hasAnyOf', ['Other'], {
        validationConfig: { readOnly: true },
    }),
    make('hidden-target-validation', 'hasAnyOf', ['Other'], {
        validationConfig: {
            conditionalFields: ruleFor('hasAnyOf', ['choice-allow']),
        },
    }),
    make('empty-custom-message', 'hasAnyOf', ['Other'], {
        validationConfig: { customErrorMessageForFieldValidation: '' },
    }),
    make('enabled-section-order', 'hasAnyOf', ['Other'], {
        targetConfig: {
            enableSectionHeader: true,
            headerSectionTitle: 'Details',
            applyFieldConditionsToSection: true,
        },
    }),
    make('disabled-section-order', 'hasAnyOf', ['Other'], {
        targetConfig: {
            enableSectionHeader: false,
            headerSectionTitle: 'Details',
            applyFieldConditionsToSection: true,
        },
    }),
];
