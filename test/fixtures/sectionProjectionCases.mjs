// Synthetic supported inputs shared by canonical generation and SDK tests.
const field = (id, config = {}) => ({
    fieldType: 'singleLineText',
    airtableField: {
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'singleLineText', options: null },
    },
    miniExtConfig: config,
});
const condition = (id, value = 'yes') => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'synthetic-condition',
            type: 'singleCondition',
            setting: {
                type: 'is',
                fieldType: 'singleLineText',
                idOrName: { type: 'id', id },
                value,
            },
        },
    ],
});
const make = (name, fields, data = {}) => ({
    name,
    input: {
        fieldIds: fields.map((f) => f.airtableField.id),
        fieldIdsToSchemas: Object.fromEntries(
            fields.map((f) => [f.airtableField.id, f])
        ),
        airtableFields: fields.map((f) => f.airtableField),
        data: {
            gate: 'no',
            other: 'yes',
            ...Object.fromEntries(
                fields.map((f) => [f.airtableField.id, 'native'])
            ),
            ...data,
        },
        recordId: 'rec_synthetic',
        invalidConditionMode: 'strict',
    },
});
const header = (config = {}) =>
    field('header', {
        headerSectionTitle: ' Delivery ',
        applyFieldConditionsToSection: true,
        conditionalFields: condition('gate'),
        ...config,
    });
const driver = () => field('gate');
export const sectionProjectionCases = [
    make(
        'enabled hidden section with untitled propagation and reset',
        [
            driver(),
            header({ enableSectionHeader: true }),
            field('inside', {
                applyFieldConditionsToSection: true,
                conditionalFields: condition('other'),
            }),
            field('next', {
                headerSectionTitle: 'Independent',
                applyFieldConditionsToSection: false,
                conditionalFields: condition('gate'),
            }),
            field('independent'),
            field('other'),
        ],
        { gate: 'no', other: 'yes' }
    ),
    make('legacy title-only section', [driver(), header(), field('inside')], {
        gate: 'no',
    }),
    make(
        'retained disabled header projects',
        [driver(), header({ enableSectionHeader: false }), field('inside')],
        { gate: 'no' }
    ),
    make(
        'conditionless apply true header resets',
        [
            driver(),
            header(),
            field('inside'),
            field('reset', {
                headerSectionTitle: 'Next',
                applyFieldConditionsToSection: true,
            }),
            field('independent'),
        ],
        { gate: 'no' }
    ),
    make(
        'removed title does not propagate stale flag',
        [driver(), header({ headerSectionTitle: undefined }), field('inside')],
        { gate: 'no' }
    ),
    make(
        'blank title does not start section',
        [driver(), header({ headerSectionTitle: ' \t ' }), field('inside')],
        { gate: 'no' }
    ),
    make(
        'no propagation keeps independent children',
        [
            driver(),
            header({ applyFieldConditionsToSection: false }),
            field('inside'),
        ],
        { gate: 'no' }
    ),
    make(
        'visible section failing own follower',
        [
            driver(),
            header(),
            field('inside', { conditionalFields: condition('gate', 'no') }),
        ],
        { gate: 'yes' }
    ),
    make(
        'visible section visible follower',
        [
            driver(),
            header(),
            field('inside', { conditionalFields: condition('gate') }),
        ],
        { gate: 'yes' }
    ),
    make(
        'hidden driver still controls later visibility',
        [
            driver(),
            field('hiddenDriver', { conditionalFields: condition('gate') }),
            field('dependent', {
                conditionalFields: condition('hiddenDriver', 'yes'),
            }),
        ],
        { gate: 'no', hiddenDriver: 'yes' }
    ),
    make(
        'self and mutual references use full snapshot',
        [
            field('a', { conditionalFields: condition('b') }),
            field('b', { conditionalFields: condition('a') }),
            field('self', { conditionalFields: condition('self') }),
        ],
        { a: 'yes', b: 'yes', self: 'no' }
    ),
    make(
        'readonly empty and nested unrendered data preserved',
        [
            field('readonly', { readOnly: true }),
            field('empty', { hideFieldIfEmpty: true }),
        ],
        {
            readonly: 'private synthetic',
            empty: '',
            outside: [
                {
                    id: 'att_synthetic',
                    url: 'https://example.test/file',
                    filename: 'synthetic.txt',
                },
            ],
        }
    ),
    make(
        'nested section predicate',
        [
            driver(),
            header({
                conditionalFields: {
                    logicalOperator: 'or',
                    conditions: [
                        {
                            type: 'groupCondition',
                            id: 'nested',
                            logicalOperator: 'and',
                            conditions: condition('gate').conditions,
                        },
                        ...condition('other').conditions,
                    ],
                },
            }),
            field('inside'),
            field('other'),
        ],
        { gate: 'no', other: 'yes' }
    ),
];
