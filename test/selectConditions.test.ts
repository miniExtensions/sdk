import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    compileRuntimeConditions,
    type CompileRuntimeConditionsInput,
} from '../src/forms/index.js';
const choices = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
];
const field = (type: string) => ({
    id: 'choice',
    name: 'Choice',
    isComputed: false,
    isPrimaryField: false,
    description: null,
    config: { type, options: { choices } },
});
const definition = (type: string, operator: string, value: unknown) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'one',
            type: 'singleCondition',
            setting: {
                fieldType: type,
                type: operator,
                value,
                idOrName: { type: 'id', id: 'choice' },
            },
        },
    ],
});
const compile = (
    type: string,
    operator: string,
    value: unknown,
    fields: unknown = [field(type)],
    mode = 'strict'
) =>
    compileRuntimeConditions({
        conditions: definition(type, operator, value),
        airtableFields: fields,
        invalidConditionMode: mode,
    } as CompileRuntimeConditionsInput);
describe('additive twelve canonical select pairs', () => {
    for (const type of ['singleSelect', 'multipleSelects'])
        for (const operator of type === 'singleSelect'
            ? ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty']
            : [
                  'hasAnyOf',
                  'hasAllOf',
                  'hasNoneOf',
                  'isExactly',
                  'isEmpty',
                  'isNotEmpty',
              ]) {
            it(`${type}/${operator} compiles exact ID operands without mutation`, () => {
                const value =
                    operator === 'is' || operator === 'isNot'
                        ? 'a'
                        : ['a', 'b', 'a'];
                const fields = [field(type)];
                const before = JSON.stringify(fields);
                const result = compile(type, operator, value, fields);
                assert.equal(result.type, 'compiled');
                assert.equal(JSON.stringify(fields), before);
            });
        }
    it('keeps canonical unknown-choice differences', () => {
        for (const [type, operator, value, expected] of [
            ['singleSelect', 'is', 'deleted', 'FALSE()'],
            ['singleSelect', 'isNot', 'deleted', 'FALSE()'],
            [
                'singleSelect',
                'isAnyOf',
                ['a', 'deleted'],
                "OR({choice} = 'Alpha')",
            ],
            [
                'singleSelect',
                'isNoneOf',
                ['a', 'deleted'],
                "NOT(OR({choice} = 'Alpha'))",
            ],
            ['multipleSelects', 'hasAllOf', ['a', 'deleted'], 'FALSE()'],
            ['multipleSelects', 'isExactly', ['a', 'deleted'], 'FALSE()'],
            ['multipleSelects', 'hasAnyOf', ['deleted'], 'FALSE()'],
            ['multipleSelects', 'hasNoneOf', ['deleted'], 'FALSE()'],
        ] as const) {
            const result = compile(type, operator, value);
            assert.equal(result.type, 'compiled');
            if (result.type === 'compiled')
                assert.equal(result.formula, expected);
        }
    });
    it('preserves strict/compatibility incomplete and unsupported precedence', () => {
        for (const type of ['singleSelect', 'multipleSelects']) {
            const op = type === 'singleSelect' ? 'isAnyOf' : 'hasAnyOf';
            for (const mode of ['strict', 'compatibility'])
                assert.equal(
                    compile(type, op, [], undefined, mode).type,
                    'invalid'
                );
        }
        assert.equal(
            compile('singleSelect', 'matchesRegex', '.*').type,
            'unsupported'
        );
    });
    it('never aliases IDs to native names or ignores select type drift', () => {
        const result = compile('singleSelect', 'is', 'Alpha');
        assert.equal(result.type, 'compiled');
        if (result.type === 'compiled') assert.equal(result.formula, 'FALSE()');
        for (const saved of [
            'singleSelect',
            'multipleSelects',
            'singleLineText',
        ])
            for (const current of [
                'singleSelect',
                'multipleSelects',
                'singleLineText',
            ])
                if (saved !== current)
                    assert.equal(
                        compile(saved, 'isEmpty', null, [field(current)]).type,
                        'unsupported'
                    );
    });
    it('validates every operand and metadata member including sparse arrays', () => {
        for (const type of ['singleSelect', 'multipleSelects']) {
            const op = type === 'singleSelect' ? 'isAnyOf' : 'hasAnyOf';
            for (const value of [new Array(1), [null], [''], [1]])
                assert.equal(compile(type, op, value).type, 'invalid');
            for (const malformed of [
                new Array(1),
                [null],
                [
                    { id: 'a', name: 'A' },
                    { id: 'a', name: 'B' },
                ],
                [
                    { id: 'a', name: 'A' },
                    { id: 'b', name: 'A' },
                ],
            ])
                assert.equal(
                    compile(
                        type,
                        op,
                        ['a'],
                        [
                            {
                                ...field(type),
                                config: {
                                    type,
                                    options: { choices: malformed },
                                },
                            },
                        ]
                    ).type,
                    'invalid'
                );
        }
    });
});

it('matches executed pinned converter fixtures or refuses unsafe literal representation', () => {
    const fixture = JSON.parse(
        readFileSync('test/fixtures/selectConditions.json', 'utf8')
    );
    assert.equal(
        fixture.provenance.revision,
        '58f73d575ab10baa0a10693660d8002f204368e1'
    );
    assert.equal(
        fixture.provenance.generatorSha256,
        createHash('sha256')
            .update(readFileSync(fixture.provenance.generator))
            .digest('hex')
    );
    assert.equal(fixture.cases.length, 432);
    for (const { input, formula } of fixture.cases) {
        const result = compileRuntimeConditions({
            conditions: input.conditions,
            airtableFields: [input.field],
            invalidConditionMode: 'strict',
        });
        if (result.type === 'compiled')
            assert.equal(result.formula, formula, input.name);
        else {
            assert.equal(result.type, 'invalid', input.name);
            assert(
                result.diagnostics.some((d) => d.code === 'literal-roundtrip'),
                input.name
            );
            assert(/back|quote|literal/.test(input.name), input.name);
        }
    }
});
