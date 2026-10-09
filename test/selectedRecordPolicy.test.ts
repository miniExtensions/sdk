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
