const schema = (type, mini = {}) => ({
    fieldType: type,
    airtableField: {
        id: 'fld_answer',
        name: 'Synthetic answer',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type,
            options:
                type === 'singleSelect' || type === 'multipleSelects'
                    ? {
                          choices: [
                              { id: 'a', name: 'Alpha' },
                              { id: 'b', name: 'Beta' },
                          ],
                      }
                    : null,
        },
    },
    miniExtConfig: mini,
});
export const formPageValidationCases = [];
const add = (name, type, value, mini = {}, stored = null, hidden = false) =>
    formPageValidationCases.push({
        name,
        schema: schema(type, mini),
        value,
        stored,
        hidden,
    });
for (const [name, type, value] of [
    ['null', 'singleLineText', null],
    ['blank', 'singleLineText', '  '],
    ['all-null', 'multipleAttachments', [null]],
    ['unchecked', 'checkbox', false],
    ['zero-rating', 'rating', 0],
    ['empty-barcode', 'barcode', { text: ' ' }],
])
    for (const hidden of [false, true])
        for (const readOnly of [false, true])
            add(
                `required-${name}-${hidden}-${readOnly}`,
                type,
                value,
                { required: true, readOnly },
                null,
                hidden
            );
for (const hidden of [false, true])
    for (const readOnly of [false, true]) {
        add(
            `length-${hidden}-${readOnly}`,
            'singleLineText',
            'long',
            { characterLimit: 2, readOnly },
            null,
            hidden
        );
        add(
            `negative-${hidden}-${readOnly}`,
            'number',
            -1,
            { readOnly },
            null,
            hidden
        );
        add(
            `select-invalid-${hidden}-${readOnly}`,
            'singleSelect',
            'Unknown',
            { readOnly },
            null,
            hidden
        );
        add(
            `select-count-${hidden}-${readOnly}`,
            'multipleSelects',
            ['Alpha', 'Beta'],
            { readOnly, maxNumberOfSelections: 1 },
            null,
            hidden
        );
        add(
            `linked-min-${hidden}-${readOnly}`,
            'multipleRecordLinks',
            [],
            { readOnly, customMinimumRecordsToSelect: 1 },
            null,
            hidden
        );
        add(
            `linked-max-${hidden}-${readOnly}`,
            'multipleRecordLinks',
            ['rec_a', 'rec_b'],
            { readOnly, customMaxRecordsToSelect: 1 },
            null,
            hidden
        );
    }
add('stored-unknown', 'singleSelect', 'Legacy', {}, 'Legacy');
add(
    'limited-stored',
    'multipleSelects',
    ['Beta'],
    { singleOrMultiSelectLimitSelectionOptions: ['a'] },
    ['Beta']
);
add(
    'limited-new',
    'multipleSelects',
    ['Beta'],
    { singleOrMultiSelectLimitSelectionOptions: ['a'] },
    []
);
add('add-new', 'singleSelect', 'New', { allowAddingNewOptions: true });
add('restricted-add-new', 'singleSelect', 'New', {
    allowAddingNewOptions: true,
    singleOrMultiSelectLimitSelectionOptions: ['a'],
});
add('negative-allowed', 'currency', -2, { allowNegativeNumbers: true });
add('linked-single-max', 'multipleRecordLinks', ['rec_a', 'rec_b'], {
    maxRecordsToSelectOrCreate: '1',
});
add('checkbox-true', 'checkbox', true, { required: true });
add('rating-one', 'rating', 1, { required: true });
add('percent-zero', 'percent', 0, { required: true });

// Ordinary validation has rule-specific hidden/read-only exceptions.
for (const hidden of [false, true])
    for (const readOnly of [false, true]) {
        add(
            `email-invalid-${hidden}-${readOnly}`,
            'email',
            'invalid',
            { readOnly },
            null,
            hidden
        );
        add(
            `url-invalid-${hidden}-${readOnly}`,
            'url',
            'invalid',
            { readOnly },
            null,
            hidden
        );
        add(
            `url-invalid-allowed-${hidden}-${readOnly}`,
            'url',
            'invalid',
            { readOnly, allowInvalidUrls: true },
            null,
            hidden
        );
        add(
            `rich-text-required-${hidden}-${readOnly}`,
            'richText',
            '  ',
            { required: true, readOnly },
            null,
            hidden
        );
    }
const computedValues = [
    ['formula', 'Computed'],
    ['rollup', 1],
    ['multipleLookupValues', ['Computed']],
    ['count', 1],
    ['autoNumber', 1],
    ['createdTime', '2026-01-01T00:00:00.000Z'],
    ['lastModifiedTime', '2026-01-01T00:00:00.000Z'],
    [
        'createdBy',
        { id: 'usr_example', email: 'synthetic@example.test', name: 'Example' },
    ],
    [
        'lastModifiedBy',
        { id: 'usr_example', email: 'synthetic@example.test', name: 'Example' },
    ],
    ['externalSyncSource', 'Synthetic source'],
    ['aiText', { state: 'generated', value: 'Synthetic', isStale: false }],
];
for (const [type, value] of computedValues)
    for (const hidden of [false, true])
        for (const readOnly of [false, true]) {
            add(
                `computed-pass-${type}-${hidden}-${readOnly}`,
                type,
                value,
                {
                    required: true,
                    readOnly,
                    ...(type === 'multipleLookupValues'
                        ? { hideFieldIfEmpty: false }
                        : {}),
                },
                null,
                hidden
            );
            formPageValidationCases.at(-1).schema.airtableField.isComputed =
                true;
        }
for (const hidden of [false, true])
    for (const readOnly of [false, true])
        add(
            `button-pass-${hidden}-${readOnly}`,
            'button',
            { url: 'https://example.test', label: 'Synthetic' },
            { readOnly },
            null,
            hidden
        );
for (const type of ['singleCollaborator', 'multipleCollaborators'])
    for (const hidden of [false, true])
        for (const readOnly of [false, true])
            for (const mode of ['allowed', 'unknown', 'stored']) {
                const person = {
                    id: mode === 'allowed' ? 'usr_allowed' : 'usr_legacy',
                    email: 'synthetic@example.test',
                    name: 'Synthetic',
                };
                add(
                    `collaborator-${type}-${mode}-${hidden}-${readOnly}`,
                    type,
                    type === 'multipleCollaborators' ? [person] : person,
                    { readOnly },
                    mode === 'stored'
                        ? type === 'multipleCollaborators'
                            ? [person]
                            : person
                        : null,
                    hidden
                );
                formPageValidationCases.at(
                    -1
                ).schema.airtableField.config.options = {
                    choices: [
                        {
                            id: 'usr_allowed',
                            email: 'synthetic@example.test',
                            name: 'Allowed',
                        },
                    ],
                };
            }
export const formPageStructureCases = [
    {
        name: 'leading-and-sections',
        fields: [
            schema('singleLineText'),
            schema('singleLineText', { headerSectionTitle: ' First ' }),
            schema('singleLineText', {
                enableSectionHeader: false,
                headerSectionTitle: 'Retained',
            }),
            schema('singleLineText', { headerSectionTitle: 'Last' }),
        ],
    },
    {
        name: 'blank-title',
        fields: [schema('singleLineText', { headerSectionTitle: ' ' })],
    },
    {
        name: 'legacy-header',
        fields: [schema('singleLineText', { headerSectionTitle: 'Legacy' })],
    },
    { name: 'empty', fields: [] },
].map((c) => ({
    ...c,
    fields: c.fields.map((f, i) => ({
        ...f,
        airtableField: {
            ...f.airtableField,
            id: `fld_${i}`,
            name: `Field ${i}`,
        },
    })),
}));
