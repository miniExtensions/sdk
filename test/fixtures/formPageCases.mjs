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
// Executed against the pinned email branch; values are never normalized.
const emailValues = [
    ['simple', 'person@example.test'],
    ['plus-tag', 'person+tag@example.test'],
    ['punctuation', "a!#$%&'*+-/=?^_`{|}~b@example.test"],
    ['unicode-local', 'é@example.test'],
    ['unicode-domain', 'person@例え.test'],
    ['punycode-domain', 'person@xn--r8jz45g.test'],
    ['leading-space', ' person@example.test'],
    ['trailing-space', 'person@example.test '],
    ['embedded-space', 'per son@example.test'],
    ['newline', 'person@example.test\n'],
    ['missing-domain', 'person@'],
    ['missing-local', '@example.test'],
    ['double-at', 'person@@example.test'],
    ['local-leading-dot', '.person@example.test'],
    ['local-trailing-dot', 'person.@example.test'],
    ['local-double-dot', 'per..son@example.test'],
    ['domain-double-dot', 'person@example..test'],
    ['domain-leading-hyphen', 'person@-example.test'],
    ['quoted-local', '"person"@example.test'],
    ['local-64', `${'a'.repeat(64)}@example.test`],
    ['local-65', `${'a'.repeat(65)}@example.test`],
    ['label-63', `person@${'a'.repeat(63)}.test`],
    ['label-64', `person@${'a'.repeat(64)}.test`],
    [
        'total-254',
        `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`,
    ],
    [
        'total-255',
        `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`,
    ],
];
for (const [name, value] of emailValues)
    add(`email-syntax-${name}`, 'email', value);
for (const [name, value] of [
    ['null', null],
    ['empty', ''],
    ['spaces', '  '],
    ['tab', '\t'],
])
    for (const required of [false, true])
        for (const hidden of [false, true])
            for (const readOnly of [false, true])
                add(
                    `email-empty-${name}-${required}-${hidden}-${readOnly}`,
                    'email',
                    value,
                    { required, readOnly },
                    null,
                    hidden
                );
// URL expectations execute the pinned ordinary URL branch and its shared helper.
const urlValues = [
    ['http', 'http://example.test'],
    ['https', 'https://example.test/path'],
    ['mixed-case', 'HTTPS://EXAMPLE.TEST'],
    ['bare-host', 'example.test'],
    ['bare-port', 'example.test:8080/path'],
    ['http-port', 'https://example.test:443/path'],
    ['invalid-port', 'example.test:65536'],
    ['empty-port', 'https://example.test:'],
    ['mailto', 'mailto:person@example.test'],
    ['mailto-multiple', 'mailto:first@example.test,second@example.test'],
    ['mailto-encoded', 'mailto:person%2Btag%40example.test'],
    ['mailto-query', 'mailto:person@example.test?subject=Synthetic%20subject'],
    ['mailto-empty', 'mailto:'],
    ['mailto-empty-recipient', 'mailto:person@example.test,'],
    ['mailto-invalid-recipient', 'mailto:person@example.test,invalid'],
    ['mailto-authority', 'mailto://person@example.test'],
    ['mailto-bad-escape', 'mailto:%ZZ@example.test'],
    ['unicode-idn', 'https://例え.test/道'],
    ['punycode-idn', 'xn--r8jz45g.test'],
    [
        'path-query-punctuation',
        "https://example.test/a!$&'()*+,;=:@/?q=a%20b#fragment",
    ],
    ['encoded-slash', 'https://example.test/a%2Fb'],
    ['trailing-dot', 'https://example.test.'],
    ['leading-space', ' https://example.test'],
    ['trailing-space', 'https://example.test '],
    ['embedded-space', 'https://example.test/a b'],
    ['newline', 'https://example.test\n'],
    ['tab', 'https://example.test/\t'],
    ['nul', 'https://example.test/\u0000'],
    ['del', 'https://example.test/\u007f'],
    ['encoded-nul', 'https://example.test/%00'],
    ['encoded-newline', 'https://example.test/%0A'],
    ['encoded-del', 'https://example.test/%7f'],
    ['double-encoded-control', 'https://example.test/%250A'],
    ['backslash', 'https://example.test\\path'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/plain,Synthetic'],
    ['ftp', 'ftp://example.test'],
    ['file', 'file:///synthetic'],
    ['custom-scheme', 'synthetic:example.test'],
    ['http-missing-slashes', 'http:example.test'],
    ['protocol-relative', '//example.test'],
    ['userinfo', 'https://person@example.test'],
    ['password', 'https://person:secret@example.test'],
    ['localhost', 'http://localhost'],
    ['single-label', 'https://synthetic'],
    ['ipv4', 'https://192.0.2.1'],
    ['ipv4-short', 'https://127.1'],
    ['ipv4-invalid', 'https://999.0.2.1'],
    ['ipv6', 'https://[2001:db8::1]'],
    ['ipv6-malformed', 'https://[2001:db8::1'],
    ['empty-label', 'https://example..test'],
    ['leading-hyphen', 'https://-example.test'],
    ['underscore', 'https://some_host.test'],
    ['label-63', `https://${'a'.repeat(63)}.test`],
    ['label-64', `https://${'a'.repeat(64)}.test`],
    ['missing-host', 'https://'],
    ['path-only', '/synthetic/path'],
    ['malformed-percent-http', 'https://example.test/%ZZ'],
];
for (const [name, value] of urlValues) add(`url-syntax-${name}`, 'url', value);
for (const [name, value] of [
    ['null', null],
    ['empty', ''],
    ['spaces', '  '],
    ['tab', '\t'],
])
    for (const required of [false, true])
        for (const hidden of [false, true])
            for (const readOnly of [false, true])
                add(
                    `url-empty-${name}-${required}-${hidden}-${readOnly}`,
                    'url',
                    value,
                    { required, readOnly },
                    null,
                    hidden
                );
for (const [name, allowInvalidUrls] of [
    ['true', true],
    ['false', false],
    ['string', 'true'],
    ['number', 1],
    ['null', null],
])
    for (const hidden of [false, true])
        for (const readOnly of [false, true])
            add(
                `url-config-${name}-${hidden}-${readOnly}`,
                'url',
                'javascript:alert(1)',
                { allowInvalidUrls, readOnly },
                null,
                hidden
            );
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
// Collaborator page rules authorize native object IDs from loaded choices plus
// immutable stored values. Display metadata is not selection authority.
const allowedCollaborator = {
    id: 'usr_allowed',
    email: 'allowed@example.test',
    name: 'Allowed',
};
const storedCollaborator = {
    id: 'usr_legacy',
    email: 'legacy@example.test',
    name: 'Legacy',
};
const injectedCollaborator = {
    id: 'usr_injected',
    email: 'injected@example.test',
    name: 'Injected',
};
const collaboratorValue = (type, person) =>
    type === 'multipleCollaborators' ? [person] : person;
const addCollaborator = (
    name,
    type,
    value,
    mini = {},
    stored = null,
    hidden = false,
    choices = [allowedCollaborator]
) => {
    add(name, type, value, mini, stored, hidden);
    formPageValidationCases.at(-1).schema.airtableField.config.options = {
        choices: structuredClone(choices),
    };
};
for (const type of ['singleCollaborator', 'multipleCollaborators']) {
    for (const [emptyName, value] of [
        ['null', null],
        ['empty', ''],
        ['spaces', '  '],
        ['tab', '\t'],
    ])
        for (const required of [false, true])
            for (const hidden of [false, true])
                for (const readOnly of [false, true])
                    addCollaborator(
                        `collaborator-empty-${type}-${emptyName}-${required}-${hidden}-${readOnly}`,
                        type,
                        value,
                        { required, readOnly },
                        null,
                        hidden
                    );
    const native = (person) => collaboratorValue(type, person);
    for (const [shapeName, value, stored] of [
        ['id-only', native({ id: 'usr_allowed' }), null],
        [
            'display-ignored',
            native({
                id: 'usr_allowed',
                email: 'not-an-email',
                name: 42,
                profilePicUrl: false,
            }),
            null,
        ],
        ['id-number', native({ id: 7 }), null],
        ['missing-id', native({ name: 'Allowed' }), null],
        [
            'wrong-container',
            type === 'singleCollaborator'
                ? [allowedCollaborator]
                : allowedCollaborator,
            null,
        ],
        ['bare-id', 'usr_allowed', null],
        ['email-only', native({ email: 'allowed@example.test' }), null],
        [
            'duplicate-id',
            type === 'multipleCollaborators'
                ? [allowedCollaborator, allowedCollaborator]
                : {
                      ...allowedCollaborator,
                      duplicateMetadata: ['usr_allowed', 'usr_allowed'],
                  },
            null,
        ],
        [
            'mixed-unknown',
            type === 'multipleCollaborators'
                ? [allowedCollaborator, storedCollaborator]
                : storedCollaborator,
            null,
        ],
        [
            'stored-wrong-shape',
            native(storedCollaborator),
            type === 'multipleCollaborators'
                ? storedCollaborator
                : [storedCollaborator],
        ],
        [
            'stored-id-only',
            native(storedCollaborator),
            native({ id: 'usr_legacy' }),
        ],
        ['blank-id-unlisted', native({ id: '' }), null],
    ])
        addCollaborator(
            `collaborator-shape-${type}-${shapeName}`,
            type,
            value,
            {},
            stored
        );
    addCollaborator(
        `collaborator-shape-${type}-empty-id-allowed`,
        type,
        native({ id: '' }),
        {},
        null,
        false,
        [{ id: '' }]
    );
    for (const [choiceName, value, stored, choices] of [
        ['empty-clear', null, null, []],
        ['empty-known-refused', native(allowedCollaborator), null, []],
        [
            'empty-stored-retained',
            native(storedCollaborator),
            native(storedCollaborator),
            [],
        ],
        [
            'empty-stored-mixed-injected',
            type === 'multipleCollaborators'
                ? [storedCollaborator, injectedCollaborator]
                : injectedCollaborator,
            native(storedCollaborator),
            [],
        ],
        [
            'duplicates',
            native(allowedCollaborator),
            null,
            [allowedCollaborator, allowedCollaborator],
        ],
    ])
        addCollaborator(
            `collaborator-choices-${type}-${choiceName}`,
            type,
            value,
            {},
            stored,
            false,
            choices
        );
}
// Conservative SDK refusals are a distinct supported-boundary partition, not
// canonical equality claims. Malformed/missing choices cannot supply selection
// authority; malformed native values may be skipped by canonical's coercive
// value != '' gate. Keep these out of executed canonical validation cases.
export const formPageConservativeRefusalCases = [];
for (const type of ['singleCollaborator', 'multipleCollaborators']) {
    for (const [authorityName, options] of [
        ['missing', {}],
        ['null', { choices: null }],
        ['nonarray', { choices: {} }],
        ['malformed-id', { choices: [{ id: 7 }] }],
    ]) {
        const field = schema(type);
        field.airtableField.config.options = options;
        formPageConservativeRefusalCases.push({
            name: `collaborator-refusal-${type}-choices-${authorityName}`,
            schema: field,
            value: collaboratorValue(type, allowedCollaborator),
            stored: null,
            hidden: false,
            expectedCode: 'invalid-metadata',
            reason: 'Loaded choices do not provide valid bounded selection authority.',
        });
    }
}
for (const [type, shapeName, value] of [
    ['singleCollaborator', 'empty-array', []],
    ['singleCollaborator', 'null-array', [null]],
    ['multipleCollaborators', 'null-array', [null]],
    ['multipleCollaborators', 'false', false],
    ['multipleCollaborators', 'zero', 0],
]) {
    const field = schema(type);
    field.airtableField.config.options = { choices: [allowedCollaborator] };
    formPageConservativeRefusalCases.push({
        name: `collaborator-refusal-${type}-coercive-${shapeName}`,
        schema: field,
        value,
        stored: null,
        hidden: false,
        expectedCode: 'invalid-selection',
        reason: 'Invalid native shape is conservatively refused where canonical loose empty comparison skips membership validation.',
    });
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
