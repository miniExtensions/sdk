import assert from 'node:assert/strict';
import { it } from 'node:test';
import { projectSelectedRecordsPolicy } from '../src/forms/selectedRecordPolicy.js';
import type {
    AirtableRecord,
    RuntimeAirtableField,
} from '../src/runtime/types.js';

const field = (
    id: string,
    type = 'singleLineText',
    options: unknown = null
): RuntimeAirtableField =>
    ({
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type, options },
    }) as RuntimeAirtableField;
const row = (id: string, value?: unknown): AirtableRecord => ({
    id,
    fields: value === undefined ? {} : { value },
});
const sort = (type = 'asc') => ({
    idOrName: { type: 'id', id: 'value' },
    type,
});
const condition = (
    fieldType = 'singleLineText',
    type = 'is',
    value: unknown = 'keep'
) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'one',
            type: 'singleCondition',
            setting: {
                fieldType,
                type,
                value,
                idOrName: { type: 'id', id: 'value' },
            },
        },
    ],
});
const project = (
    config: unknown,
    records: AirtableRecord[],
    airtableFields: RuntimeAirtableField[] | null = [field('value')],
    waitingData = false
) =>
    projectSelectedRecordsPolicy({
        config,
        records,
        airtableFields,
        waitingData,
    });

it('selected policy distinguishes absent configuration, waiting data and applied projection', () => {
    assert.equal(project({}, [], null, true).policy.state, 'not-configured');
    assert.equal(
        project({ sortFields: [sort()] }, [], null, true).policy.state,
        'waiting-data'
    );
    assert.equal(project({ sortFields: [sort()] }, []).policy.state, 'applied');
});

it('direct scalar conditions filter before stable sorting without mutating records or configuration', () => {
    const config = {
        filterLinkedRecordsConditionFields: condition(),
        sortFields: [sort()],
    };
    const rows = [
        row('drop', 'remove'),
        row('second', 'keep'),
        row('first', 'keep'),
        row('second', 'keep'),
    ];
    const before = structuredClone({ config, rows });
    const result = project(config, rows);
    assert.deepEqual(
        result.records.map((r) => r.id),
        ['second', 'first', 'second']
    );
    assert.deepEqual(result.policy, {
        supported: true,
        reasons: [],
        state: 'applied',
        diagnostics: [],
    });
    assert.deepEqual({ config, rows }, before);
    result.records[0].fields.value = 'changed';
    assert.deepEqual({ config, rows }, before);
});

it('numeric selected sorting handles canonical empty values and stable equal occurrences', () => {
    const rows = [
        row('two', 2),
        row('empty'),
        row('null', null),
        row('one', 1),
        row('tie', 2),
    ];
    const asc = project({ sortFields: [sort()] }, rows, [
        field('value', 'number'),
    ]);
    assert.deepEqual(
        asc.records.map((r) => r.id),
        ['empty', 'null', 'one', 'two', 'tie']
    );
    const desc = project({ sortFields: [sort('desc')] }, rows, [
        field('value', 'number'),
    ]);
    assert.deepEqual(
        desc.records.map((r) => r.id),
        ['two', 'tie', 'one', 'empty', 'null']
    );
});

it('single select selected sorting follows configured choice order instead of lexical labels', () => {
    const fields = [
        field('value', 'singleSelect', {
            choices: [
                { id: 'z', name: 'Zulu' },
                { id: 'a', name: 'Alpha' },
            ],
        }),
    ];
    const result = project(
        { sortFields: [sort()] },
        [row('alpha', 'Alpha'), row('zulu', 'Zulu')],
        fields
    );
    assert.deepEqual(
        result.records.map((r) => r.id),
        ['zulu', 'alpha']
    );
});

it('missing record keys are canonical empty only when returned field metadata exists', () => {
    const config = {
        filterLinkedRecordsConditionFields: condition(
            'singleLineText',
            'isEmpty',
            null
        ),
    };
    assert.deepEqual(
        project(config, [
            row('missing'),
            row('null', null),
            row('text', 'x'),
        ]).records.map((r) => r.id),
        ['missing', 'null']
    );
    const result = project(config, [row('missing')], []);
    assert.equal(result.policy.state, 'unsupported');
    assert.deepEqual(result.policy.diagnostics, [
        { code: 'missing-dependency', fieldId: 'value' },
    ]);
    assert.deepEqual(result.records, []);
});

it('dependency name aliases cannot replace or disagree with ID-keyed selected values', () => {
    const metadata = { ...field('value'), name: 'Label' };
    const values: AirtableRecord['fields'][] = [
        { value: 'excluded', Label: 'keep' },
        { Label: 'keep' },
        { value: 'keep', Label: 'keep' },
        { value: null, Label: null },
    ];
    for (const fields of values) {
        for (const config of [
            {
                filterLinkedRecordsConditionFields: condition(
                    'singleLineText',
                    'contains',
                    'keep'
                ),
            },
            { sortFields: [sort()] },
        ]) {
            const records = [{ id: 'selected', fields }];
            const before = structuredClone({ records, config });
            const result = project(config, records, [metadata]);
            assert.deepEqual(result.policy, {
                supported: false,
                reasons: [
                    'sortFields' in config
                        ? 'selected-sort'
                        : 'selected-condition',
                ],
                state: 'unsupported',
                diagnostics: [{ code: 'invalid-value', fieldId: 'value' }],
            });
            assert.deepEqual(result.records, []);
            assert.deepEqual({ records, config }, before);
        }
    }
});

it('ID-only dependencies preserve empty values and ignore unrelated names', () => {
    const metadata = { ...field('value'), name: 'Label' };
    const records: AirtableRecord[] = [
        { id: 'excluded', fields: { value: 'excluded', Other: 'keep' } },
        { id: 'included', fields: { value: 'keep' } },
        { id: 'missing', fields: {} },
        { id: 'null', fields: { value: null } },
    ];
    const result = project(
        {
            filterLinkedRecordsConditionFields: condition(
                'singleLineText',
                'contains',
                'keep'
            ),
        },
        records,
        [metadata]
    );
    assert.equal(result.policy.state, 'applied');
    assert.deepEqual(
        result.records.map((record) => record.id),
        ['included']
    );
    const empty = project(
        {
            filterLinkedRecordsConditionFields: condition(
                'singleLineText',
                'isEmpty',
                null
            ),
        },
        records,
        [metadata]
    );
    assert.deepEqual(
        empty.records.map((record) => record.id),
        ['missing', 'null']
    );
    assert.equal(
        project({ filterLinkedRecordsConditionFields: condition() }, [
            row('same-id-name', 'keep'),
        ]).policy.state,
        'applied'
    );
});

it('unsupported selected conditions and sort structures fail closed', () => {
    for (const config of [
        {
            filterLinkedRecordsConditionFields: {
                ...condition(),
                logicalOperator: 'xor',
            },
        },
        {
            filterLinkedRecordsConditionFields: {
                logicalOperator: 'and',
                conditions: [{ type: 'group', conditions: [] }],
            },
        },
        { sortFields: [{ fieldId: 'value', direction: 'asc' }] },
        { sortFields: [sort('sideways')] },
    ]) {
        const result = project(config, [row('one', 'keep')]);
        assert.equal(result.policy.state, 'unsupported');
        assert.equal(result.policy.supported, false);
        assert.deepEqual(result.records, []);
    }
});

it('date and computed sort dependencies remain unsupported', () => {
    for (const metadata of [
        field('value', 'date'),
        { ...field('value'), isComputed: true },
    ]) {
        const result = project(
            { sortFields: [sort()] },
            [row('one', '2026-01-01')],
            [metadata]
        );
        assert.equal(result.policy.state, 'unsupported');
        assert.equal(result.policy.diagnostics[0].code, 'unsupported-sort');
    }
});

it('disabled and finder-only conditions are ignored while selected sorting stays active', () => {
    for (const flags of [
        { filterLinkedRecordsToggle: false },
        { filterApplicationMode: 'record-finder-only' },
    ]) {
        const result = project(
            {
                ...flags,
                filterLinkedRecordsConditionFields: { malformed: true },
                sortFields: [sort()],
            },
            [row('z', 'z'), row('a', 'a')]
        );
        assert.equal(result.policy.state, 'applied');
        assert.deepEqual(
            result.records.map((r) => r.id),
            ['a', 'z']
        );
    }
});

it('invalid dependency cell values and ambiguous metadata fail closed', () => {
    const invalid = project({ sortFields: [sort()] }, [
        row('bad', { text: 'x' }),
    ]);
    assert.equal(invalid.policy.state, 'unsupported');
    assert.equal(invalid.policy.diagnostics[0].code, 'invalid-value');
    const ambiguous = project(
        { sortFields: [sort()] },
        [row('one', 'a')],
        [field('value'), field('value')]
    );
    assert.equal(ambiguous.policy.state, 'unsupported');
    assert.equal(ambiguous.policy.diagnostics[0].code, 'ambiguous-metadata');
});

it('constant-false select predicates still require a valid returned dependency and native value', () => {
    const config = {
        filterLinkedRecordsConditionFields: condition(
            'singleSelect',
            'is',
            'deleted-choice'
        ),
    };
    const absent = project(config, [row('one', 'Alpha')], []);
    assert.equal(absent.policy.state, 'unsupported');
    assert.equal(absent.policy.diagnostics[0].code, 'missing-dependency');
    const metadata = field('value', 'singleSelect', {
        choices: [{ id: 'a', name: 'Alpha' }],
    });
    const valid = project(config, [row('one', 'Alpha')], [metadata]);
    assert.equal(valid.policy.state, 'applied');
    assert.deepEqual(valid.records, []);
    const malformed = project(config, [row('one', ['Alpha'])], [metadata]);
    assert.equal(malformed.policy.state, 'unsupported');
    assert.equal(malformed.policy.diagnostics[0].code, 'invalid-value');
});

it('editable calendar ordering remains explicitly unsupported without configured sortFields', () => {
    const result = project({ recordFinderMode: 'calendar' }, [row('one', 'A')]);
    assert.equal(result.policy.state, 'unsupported');
    assert.deepEqual(result.policy.reasons, ['selected-sort']);
    assert.deepEqual(result.policy.diagnostics, [{ code: 'unsupported-sort' }]);
    assert.equal(
        project({ recordFinderMode: 'calendar', readOnly: true }, [
            row('one', 'A'),
        ]).policy.state,
        'not-configured'
    );
});

const calendarConfig = {
    recordFinderMode: 'calendar',
    calendarModeStartDate: 'start',
    calendarModeEndDate: 'end',
};
const calendarOptions = {
    dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
    timeFormat: { name: '24hour', format: 'HH:mm' },
    timeZone: 'utc',
};
const calendarFields = [
    field('start', 'dateTime', calendarOptions),
    field('end', 'dateTime', calendarOptions),
];
const formulaCalendarField = (id: string): RuntimeAirtableField => ({
    ...field(id, 'formula', {
        isValid: true,
        result: {
            type: 'date',
            options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
        },
    }),
    isComputed: true,
});
const calendarRow = (id: string, start?: unknown): AirtableRecord => ({
    id,
    fields: start === undefined ? {} : { start },
});

it('calendar accepts valid formula date metadata while retaining stable instant ordering', () => {
    const records = [
        calendarRow('late', '2027-01-01T00:00:01Z'),
        calendarRow('equal-a', '2026-12-31T19:00:00-05:00'),
        calendarRow('missing'),
        calendarRow('equal-b', '2027-01-01T01:00:00+01:00'),
        calendarRow('null', null),
    ];
    for (const fields of [
        [formulaCalendarField('start'), calendarFields[1]],
        [calendarFields[0], formulaCalendarField('end')],
        [formulaCalendarField('start'), formulaCalendarField('end')],
    ]) {
        const result = project(calendarConfig, records, fields);
        assert.equal(result.policy.state, 'applied');
        assert.deepEqual(
            result.records.map((record) => record.id),
            ['missing', 'null', 'equal-a', 'equal-b', 'late']
        );
    }
});

it('formula calendar refuses malformed metadata and error, array or offsetless values', () => {
    const good = formulaCalendarField('start');
    for (const bad of [
        { ...good, isComputed: false },
        field('start', 'formula', { isValid: false, result: null }),
        {
            ...good,
            config: {
                type: 'formula',
                options: { isValid: true, result: { type: 'date' } },
            },
        },
        {
            ...good,
            config: {
                type: 'formula',
                options: {
                    isValid: true,
                    result: { type: 'dateTime', options: calendarOptions },
                },
            },
        },
    ] as unknown as RuntimeAirtableField[]) {
        const result = project(
            calendarConfig,
            [calendarRow('one', '2027-01-01T00:00:00Z')],
            [bad, calendarFields[1]]
        );
        assert.equal(result.policy.state, 'unsupported');
        assert.deepEqual(result.records, []);
    }
    for (const value of [
        { error: '#ERROR!' },
        ['2027-01-01T00:00:00Z'],
        '2027-01-01',
        '2027-01-01T00:00:00',
    ]) {
        const result = project(
            calendarConfig,
            [calendarRow('bad', value)],
            [good, calendarFields[1]]
        );
        assert.equal(result.policy.state, 'unsupported');
        assert.deepEqual(result.policy.diagnostics, [
            { code: 'invalid-value', fieldId: 'start' },
        ]);
        assert.deepEqual(result.records, []);
    }
});

it('editable calendar selected records sort by start instant, with stable duplicates and empty values', () => {
    const records = [
        calendarRow('late', '2027-01-01T00:00:01.000Z'),
        calendarRow('equal', '2026-12-31T19:00:00-05:00'),
        calendarRow('missing'),
        calendarRow('early', '1969-12-31T23:59:59Z'),
        calendarRow('equal', '2027-01-01T01:00:00+01:00'),
        calendarRow('null', null),
    ];
    const config = { ...calendarConfig, sortFields: [{ malformed: true }] };
    const before = structuredClone({ records, config });
    const result = project(config, records, calendarFields);
    assert.equal(result.policy.state, 'applied');
    assert.deepEqual(
        result.records.map((record) => record.id),
        ['missing', 'null', 'early', 'equal', 'equal', 'late']
    );
    assert.deepEqual({ records, config }, before);
    result.records[0].fields.start = 'changed';
    assert.deepEqual({ records, config }, before);
});

it('calendar filtering precedes sorting and leaves native records untouched', () => {
    const records = [
        {
            id: 'drop',
            fields: { value: 'drop', start: '2026-01-01T00:00:00Z' },
        },
        {
            id: 'late',
            fields: { value: 'keep', start: '2027-01-01T00:00:00Z' },
        },
        {
            id: 'early',
            fields: { value: 'keep', start: '2026-01-01T00:00:00Z' },
        },
    ];
    const before = structuredClone(records);
    const result = project(
        { ...calendarConfig, filterLinkedRecordsConditionFields: condition() },
        records,
        [...calendarFields, field('value')]
    );
    assert.equal(result.policy.state, 'applied');
    assert.deepEqual(
        result.records.map((record) => record.id),
        ['early', 'late']
    );
    assert.deepEqual(records, before);
});

it('calendar requires both settings and accepted unambiguous direct date-time metadata', () => {
    for (const config of [
        { ...calendarConfig, calendarModeStartDate: '' },
        { ...calendarConfig, calendarModeEndDate: null },
        { ...calendarConfig, readOnly: 'false' },
    ])
        assert.equal(
            project(config, [], calendarFields).policy.state,
            'unsupported'
        );
    assert.equal(
        project(calendarConfig, [], null, true).policy.state,
        'waiting-data'
    );
    for (const fields of [
        [calendarFields[0]],
        [calendarFields[1]],
        [...calendarFields, calendarFields[0]],
        [
            field('start', 'formula', {
                isValid: true,
                result: { type: 'date' },
            }),
            calendarFields[1],
        ],
        [{ ...calendarFields[0], isComputed: true }, calendarFields[1]],
        [calendarFields[0], field('end', 'date')],
        [field('start', 'dateTime', null), calendarFields[1]],
        [
            calendarFields[0],
            field('end', 'dateTime', {
                ...calendarOptions,
                timeZone: 'not/a-zone',
            }),
        ],
        [
            field('start', 'dateTime', {
                ...calendarOptions,
                dateFormat: { name: 'iso', format: 'wrong' },
            }),
            calendarFields[1],
        ],
    ]) {
        const result = project(
            calendarConfig,
            [calendarRow('one', '2026-01-01T00:00:00Z')],
            fields
        );
        assert.equal(result.policy.state, 'unsupported');
        assert.deepEqual(result.records, []);
    }
});

it('calendar rejects malformed or offsetless date-time values without partial presentation', () => {
    for (const value of [
        'bad',
        '2026-02-30T00:00:00Z',
        '2026-01-01T24:00:00Z',
        '2026-01-01T00:00:00',
        '2026-01-01T00:00:00+24:99',
        42,
        ['2026-01-01T00:00:00Z'],
    ]) {
        const result = project(
            calendarConfig,
            [
                calendarRow('valid', '2026-01-01T00:00:00Z'),
                calendarRow('bad', value),
            ],
            calendarFields
        );
        assert.equal(result.policy.state, 'unsupported');
        assert.deepEqual(result.policy.diagnostics, [
            { code: 'invalid-value', fieldId: 'start' },
        ]);
        assert.deepEqual(result.records, []);
    }
    const explicitUndefined = {
        id: 'bad',
        fields: { start: undefined } as unknown as AirtableRecord['fields'],
    };
    const result = project(calendarConfig, [explicitUndefined], calendarFields);
    assert.equal(result.policy.state, 'unsupported');
    assert.deepEqual(result.policy.diagnostics, [
        { code: 'invalid-value', fieldId: 'start' },
    ]);
});

it('read-only calendar keeps ordinary sort behavior and general date sorts remain unsupported', () => {
    const result = project(
        { ...calendarConfig, readOnly: true, sortFields: [sort()] },
        [row('z', 'z'), row('a', 'a')]
    );
    assert.equal(result.policy.state, 'applied');
    assert.deepEqual(
        result.records.map((record) => record.id),
        ['a', 'z']
    );
    assert.equal(
        project(
            {
                sortFields: [
                    { idOrName: { type: 'id', id: 'start' }, type: 'asc' },
                ],
            },
            [calendarRow('one', '2026-01-01T00:00:00Z')],
            calendarFields
        ).policy.state,
        'unsupported'
    );
});

it('calendar sorts explicit offsets consistently across a non-UTC DST transition', () => {
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
        const result = project(
            calendarConfig,
            [
                calendarRow('later', '2026-11-01T01:30:00-08:00'),
                calendarRow('earlier', '2026-11-01T01:30:00-07:00'),
                calendarRow('same', '2026-11-01T08:30:00Z'),
            ],
            calendarFields
        );
        assert.equal(result.policy.state, 'applied');
        assert.deepEqual(
            result.records.map((record) => record.id),
            ['earlier', 'same', 'later']
        );
        assert.equal(
            project(
                calendarConfig,
                [calendarRow('ambiguous', '2026-11-01T01:30:00')],
                calendarFields
            ).policy.state,
            'unsupported'
        );
    } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
    }
});

it('calendar keeps created-record filter exemption before ordering', () => {
    const config = {
        ...calendarConfig,
        filterLinkedRecordsConditionFields: condition(),
    };
    const records = [
        {
            id: 'created',
            fields: { value: 'drop', start: '2026-01-01T00:00:00Z' },
        },
        {
            id: 'keep',
            fields: { value: 'keep', start: '2027-01-01T00:00:00Z' },
        },
        {
            id: 'drop',
            fields: { value: 'drop', start: '2025-01-01T00:00:00Z' },
        },
    ];
    const result = projectSelectedRecordsPolicy({
        config,
        records,
        airtableFields: [...calendarFields, field('value')],
        waitingData: false,
        createdRecordIds: new Set(['created']),
    });
    assert.equal(result.policy.state, 'applied');
    assert.deepEqual(
        result.records.map((record) => record.id),
        ['created', 'keep']
    );
});
