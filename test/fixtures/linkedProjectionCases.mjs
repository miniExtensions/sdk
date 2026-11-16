// Synthetic JSON-compatible snapshots for the actual native helper oracle.
const physical = (id, type = 'singleLineText', options = null) => ({
    id,
    name: id,
    description: '',
    isComputed: type === 'formula',
    isPrimaryField: false,
    config: { type, options },
});
const schema = (airtableField, miniExtConfig = {}) => ({
    fieldType: airtableField.config.type,
    airtableField,
    miniExtConfig,
});
const condition = (
    id,
    fieldType = 'singleLineText',
    type = 'is',
    value = 'yes'
) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'synthetic',
            type: 'singleCondition',
            setting: { idOrName: { type: 'id', id }, fieldType, type, value },
        },
    ],
});
const gate = physical('gate');
const answer = physical('answer');
const links = physical('links', 'multipleRecordLinks', {
    linkedTableId: 'tbl_links',
    isReversed: false,
    prefersSingleRecordLink: false,
});
const rows = {
    rec_a: { id: 'rec_a', fields: { first: ['one'], second: ['two'] } },
    rec_b: { id: 'rec_b', fields: { first: ['one'], second: ['two'] } },
    rec_c: { id: 'rec_c', fields: { first: ['one'], second: ['other'] } },
};
const loaded = {
    type: 'loaded',
    data: {
        state: {
            airtableFields: [],
            recordIdsToAirtableRecords: rows,
        },
    },
};
const input = (change = {}) => ({
    compatibility: 'native-form-v1',
    formRecord: {
        type: 'edit',
        tableId: 'tbl_output',
        recordId: 'rec_output',
        data: {
            gate: 'yes',
            answer: 'retain',
            links: ['rec_b', 'rec_a', 'uncached', 'rec_b', 'rec_c'],
            unrelated: { retain: true },
        },
    },
    formFields: [
        schema(gate),
        schema(answer, { conditionalFields: condition('gate') }),
        schema(links),
    ],
    airtableFields: [gate, answer, links],
    linkedTableLoadingStates: { tbl_links: loaded },
    conditionalLinkedRecordFieldIdsToFilteringValues: {
        links: { first: { recordId: 'one', stringValue: 'One' } },
    },
    ...change,
});
const cases = [];
const add = (name, change, nativeFallbackReason) =>
    cases.push({
        name,
        input: input(change),
        ...(nativeFallbackReason ? { nativeFallbackReason } : {}),
    });
add(
    'loaded linked pairs AND, original order and duplicates, missing-cache pruning',
    {
        conditionalLinkedRecordFieldIdsToFilteringValues: {
            links: {
                first: { recordId: 'one', stringValue: 'One' },
                second: { recordId: 'two', stringValue: 'Two' },
            },
        },
    }
);
for (const [name, filters] of Object.entries({
    absent: {},
    outerNull: { links: null },
    empty: { links: {} },
    pairNull: { links: { first: null } },
    blank: { links: { first: { recordId: 'missing', stringValue: '' } } },
    whitespace: { links: { first: { recordId: 'missing', stringValue: ' ' } } },
}))
    add(`filter publication: ${name}`, {
        conditionalLinkedRecordFieldIdsToFilteringValues: filters,
    });
for (const [name, state] of Object.entries({
    empty: {},
    missing: { another: { type: 'loading' } },
    notLoaded: { tbl_links: { type: 'notLoaded' } },
    allLoading: { tbl_links: { type: 'loading' } },
    failed: { tbl_links: { type: 'failed' } },
    mixed: { tbl_links: { type: 'loading' }, another: loaded },
    retainedLoaded: {
        tbl_links: { ...loaded, isLoading: true, paginationError: 'synthetic' },
    },
}))
    add(
        `linked pruning state: ${name}`,
        { linkedTableLoadingStates: state },
        name === 'missing' || name === 'allLoading'
            ? 'native-loading-boundary'
            : undefined
    );
for (const value of ['yes', 'no']) {
    add(`separate authoritative source ${value}`, {
        formRecordForConditionEvaluation: {
            type: 'edit',
            recordId: 'rec_authoritative',
            tableId: 'tbl_other',
            data: { gate: value },
        },
    });
}
add('disabled visibility still prunes linked selections', {
    evaluateConditionalFields: false,
    formRecordForConditionEvaluation: { type: 'create', data: { gate: 'no' } },
});
add('section inheritance reads hidden driver from whole alternate source', {
    formFields: [
        schema(gate, {
            conditionalFields: condition('gate', 'singleLineText', 'is', 'no'),
        }),
        schema(answer, {
            headerSectionTitle: 'Retained title',
            enableSectionHeader: false,
            applyFieldConditionsToSection: true,
            conditionalFields: condition('gate'),
        }),
        schema(links),
    ],
    formRecordForConditionEvaluation: { type: 'create', data: { gate: 'yes' } },
});
const choices = [
    { id: 'selAlpha', name: 'Alpha' },
    { id: 'selBeta', name: 'Beta' },
];
for (const [name, driver, fieldType, operator, operand, values] of [
    [
        'number equality',
        physical('gate', 'number', { precision: 0 }),
        'number',
        'equals',
        1,
        [1, 2],
    ],
    [
        'percent native scaling',
        physical('gate', 'percent', { precision: 2 }),
        'percent',
        'equals',
        25,
        [0.25, 25],
    ],
    [
        'single select choice identity',
        physical('gate', 'singleSelect', { choices }),
        'singleSelect',
        'is',
        'selAlpha',
        ['Alpha', 'Beta'],
    ],
    [
        'multiple select identity',
        physical('gate', 'multipleSelects', { choices }),
        'multipleSelects',
        'hasAllOf',
        ['selAlpha', 'selBeta'],
        [['Alpha', 'Beta'], ['Alpha']],
    ],
    [
        'supplied computed text',
        physical('gate', 'formula', {
            isValid: true,
            referencedFieldIds: ['unavailable'],
            result: { type: 'singleLineText', options: null },
        }),
        'singleLineText',
        'is',
        'yes',
        ['yes', 'no'],
    ],
])
    for (const [index, value] of values.entries())
        add(`${name}: ${index}`, {
            airtableFields: [driver, answer, links],
            formFields: [
                schema(answer, {
                    conditionalFields: condition(
                        'gate',
                        fieldType,
                        operator,
                        operand
                    ),
                }),
                schema(links),
            ],
            formRecordForConditionEvaluation: {
                type: 'edit',
                tableId: 'tbl_evaluation',
                recordId: 'rec_evaluation',
                data: { gate: value },
            },
        });
export const linkedProjectionCases = cases;
