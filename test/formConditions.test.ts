import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    compileRuntimeConditions,
    type CompileRuntimeConditionsInput,
    type CompileRuntimeConditionsResult,
} from '../src/forms/index.js';
import {
    FormulaRunner,
    extractIdentifiersFromFormula,
} from '../src/formulas/index.js';
import type {
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
} from '../src/runtime/index.js';
import { makeContext, textField as formulaTextField } from './fixtures.js';

const runtimeTextField = {
    ...formulaTextField,
    description: null,
    isComputed: false,
    isPrimaryField: false,
} satisfies RuntimeAirtableField;

// Runtime fixtures intentionally cross the public JSON boundary, including
// malformed configurations that TypeScript correctly excludes for callers.
function compile(
    conditions: unknown,
    fields: unknown = [runtimeTextField],
    options: Partial<
        Pick<
            CompileRuntimeConditionsInput,
            'invalidConditionMode' | 'fieldReferenceMode'
        >
    > = {}
) {
    return compileRuntimeConditions({
        conditions,
        airtableFields: fields,
        invalidConditionMode: 'strict',
        ...options,
    } as CompileRuntimeConditionsInput);
}

function condition(
    operator = 'is',
    fieldType = 'singleLineText',
    value?: unknown,
    idOrName: unknown = { type: 'id', id: runtimeTextField.id }
) {
    return {
        id: 'condition-1',
        type: 'singleCondition',
        setting: {
            type: operator,
            fieldType,
            value: arguments.length < 3 ? 'Example' : value,
            idOrName,
        },
    };
}

const definition = (...conditions: unknown[]) => ({
    logicalOperator: 'and',
    conditions,
});

function compiled(result: CompileRuntimeConditionsResult) {
    assert.equal(result.type, 'compiled');
    if (result.type !== 'compiled') throw new Error('Expected compiled result');
    return result;
}

function blocked(
    result: CompileRuntimeConditionsResult,
    type: 'invalid' | 'unsupported',
    code: string
) {
    assert.equal(result.type, type);
    assert.equal(Object.hasOwn(result, 'formula'), false);
    assert.ok(
        result.diagnostics.some((diagnostic) => diagnostic.code === code)
    );
}

function field(type: string): RuntimeAirtableField {
    const options =
        type === 'number' || type === 'percent'
            ? { precision: 2 }
            : type === 'currency'
              ? { precision: 2, symbol: '$' }
              : type === 'rating'
                ? { max: 5, icon: 'star', color: 'yellowBright' }
                : type === 'checkbox'
                  ? { icon: 'check', color: 'greenBright' }
                  : null;
    return {
        ...runtimeTextField,
        config: { type, options },
    } as RuntimeAirtableField;
}

describe('compileRuntimeConditions bounded scalar contract', () => {
    it('preserves null and top-level empty canonical definitions', () => {
        assert.deepEqual(compile(null), {
            type: 'compiled',
            formula: '1',
            diagnostics: [],
        });
        assert.equal(compiled(compile(definition())).formula, '1');
    });

    it('accepts deeply readonly aliases without mutating configuration or metadata', () => {
        const conditions = Object.freeze({
            logicalOperator: 'and',
            conditions: Object.freeze([
                Object.freeze({
                    id: 'frozen',
                    type: 'singleCondition',
                    setting: Object.freeze({
                        type: 'is',
                        fieldType: 'singleLineText',
                        value: 'Example',
                        idOrName: Object.freeze({
                            type: 'id',
                            id: 'fld_title',
                        }),
                    } as const),
                } as const),
            ]),
        } as const);
        const fields = Object.freeze([Object.freeze(runtimeTextField)]);
        const before = JSON.stringify({ conditions, fields });
        assert.equal(
            compiled(
                compileRuntimeConditions({
                    conditions,
                    airtableFields: fields,
                    invalidConditionMode: 'strict',
                })
            ).formula,
            "{fld_title} = 'Example'"
        );
        assert.equal(JSON.stringify({ conditions, fields }), before);
    });

    const t7 = [
        'singleLineText',
        'email',
        'url',
        'multilineText',
        'phoneNumber',
        'barcode',
        'richText',
    ];
    const t6 = t7.filter((type) => type !== 'richText');
    const n4 = ['number', 'percent', 'currency', 'rating'];
    // Expected pairs come from the separately audited v105 declarations,
    // not the production compiler's support table.
    const matrix: [string, string[], unknown][] = [
        ['matchesRegex', t7, '^Example$'],
        ['is', [...t6, 'checkbox'], 'Example'],
        ['isNot', t6, 'Other'],
        ['contains', t7, 'EX'],
        ['doesNotContain', t7, 'absent'],
        ['isOfLength', t7, 7],
        ['isEmpty', [...t7, ...n4], null],
        ['isNotEmpty', [...t7, ...n4], null],
        ['equals', n4, 2],
        ['notEquals', n4, 3],
        ['greaterThan', n4, 1],
        ['lessThan', n4, 3],
        ['greaterThanOrEqualsTo', n4, 2],
        ['lessThanOrEqualsTo', n4, 2],
    ];
    assert.equal(matrix.length, 14);
    assert.equal(new Set(matrix.flatMap(([, types]) => types)).size, 12);
    assert.equal(
        matrix.reduce((total, [, types]) => total + types.length, 0),
        87
    );
    for (const [operator, types, rawValue] of matrix) {
        for (const type of types) {
            it(`compiles and evaluates declared pair ${operator}/${type}`, () => {
                const metadata = field(type);
                const value = type === 'checkbox' ? true : rawValue;
                const result = compiled(
                    compile(definition(condition(operator, type, value)), [
                        metadata,
                    ])
                );
                assert.deepEqual(result.diagnostics, []);
                assert.deepEqual(
                    extractIdentifiersFromFormula(result.formula),
                    [runtimeTextField.id]
                );
                const runner = new FormulaRunner(result.formula);
                const empty = operator === 'isEmpty';
                const recordValue = empty
                    ? type === 'rating'
                        ? 0
                        : null
                    : type === 'checkbox'
                      ? true
                      : n4.includes(type)
                        ? type === 'percent'
                            ? 0.02
                            : 2
                        : type === 'barcode'
                          ? { text: 'Example' }
                          : 'Example';
                runner.context = makeContext(
                    { [runtimeTextField.id]: recordValue },
                    [metadata]
                );
                assert.equal(runner.run(), 1);
                const oppositeEmpty = operator === 'isNotEmpty';
                const oppositeNumber =
                    operator === 'greaterThan' ||
                    operator === 'greaterThanOrEqualsTo'
                        ? 1
                        : 3;
                const oppositeText =
                    operator === 'doesNotContain' ? 'absent Example' : 'Other';
                const oppositeValue = oppositeEmpty
                    ? type === 'rating'
                        ? 0
                        : null
                    : type === 'checkbox'
                      ? false
                      : n4.includes(type)
                        ? type === 'percent'
                            ? oppositeNumber / 100
                            : oppositeNumber
                        : type === 'barcode'
                          ? { text: oppositeText }
                          : oppositeText;
                // Same formula, fresh native context, a meaningful false twin.
                const falseTwin = new FormulaRunner(result.formula);
                falseTwin.context = makeContext(
                    { [runtimeTextField.id]: oppositeValue },
                    [metadata]
                );
                assert.equal(falseTwin.run(), 0);
            });
        }
    }

    const directTypes = [...t7, ...n4, 'checkbox'];
    let deniedPairs = 0;
    for (const [operator, allowedTypes, value] of matrix) {
        for (const type of directTypes) {
            if (allowedTypes.includes(type)) continue;
            deniedPairs++;
            it(`denies undeclared direct pair ${operator}/${type} in saved and current metadata`, () => {
                const deniedField = { ...field(type), id: 'fld_denied' };
                for (const invalidConditionMode of [
                    'strict',
                    'compatibility',
                ] as const) {
                    blocked(
                        compile(
                            definition(
                                condition(),
                                condition(operator, type, value, {
                                    type: 'id',
                                    id: deniedField.id,
                                })
                            ),
                            [runtimeTextField, deniedField],
                            { invalidConditionMode }
                        ),
                        'unsupported',
                        'unsupported-field-type'
                    );
                    blocked(
                        compile(
                            definition(
                                condition(operator, allowedTypes[0], value)
                            ),
                            [field(type)],
                            { invalidConditionMode }
                        ),
                        'unsupported',
                        'unsupported-field-type'
                    );
                }
            });
        }
    }
    assert.equal(deniedPairs, 81);

    it('retains FIND positions and distinguishes numeric zero from saved rating emptiness', () => {
        const substring = compiled(
            compile(definition(condition('contains', 'singleLineText', 'AMP')))
        );
        const runner = new FormulaRunner(substring.formula);
        runner.context = makeContext({ fld_title: 'Example' });
        assert.equal(runner.run(), 3);
        for (const type of n4) {
            const metadata = field(type);
            for (const [operator, expected] of [
                ['isEmpty', Number(type === 'rating')],
                ['isNotEmpty', Number(type !== 'rating')],
            ] as const) {
                const result = compiled(
                    compile(definition(condition(operator, type)), [metadata])
                );
                const zero = new FormulaRunner(result.formula);
                zero.context = makeContext({ fld_title: 0 }, [metadata]);
                assert.equal(zero.run(), expected);
            }
        }
        const unchecked = compiled(
            compile(definition(condition('is', 'checkbox', false)), [
                field('checkbox'),
            ])
        );
        for (const [value, expected] of [
            [false, 1],
            [true, 0],
        ] as const) {
            const checkbox = new FormulaRunner(unchecked.formula);
            checkbox.context = makeContext({ fld_title: value }, [
                field('checkbox'),
            ]);
            assert.equal(checkbox.run(), expected);
        }
    });

    it('preserves nested AND/OR and actual negative operators instead of inventing a NOT group', () => {
        const result = compiled(
            compile({
                logicalOperator: 'and',
                conditions: [
                    condition('doesNotContain', 'singleLineText', 'absent'),
                    {
                        id: 'nested',
                        type: 'groupCondition',
                        logicalOperator: 'or',
                        conditions: [
                            condition('is', 'singleLineText', 'Other'),
                            condition('isNotEmpty', 'singleLineText'),
                        ],
                    },
                ],
            })
        );
        assert.equal(
            result.formula,
            "AND(NOT(FIND(LOWER('absent'), LOWER({fld_title} & ''))), OR({fld_title} = 'Other', LEN('' & {fld_title}) != 0))"
        );
        const runner = new FormulaRunner(result.formula);
        runner.context = makeContext({ fld_title: 'Example' });
        assert.equal(runner.run(), 1);
        blocked(
            compile({ logicalOperator: 'not', conditions: [condition()] }),
            'unsupported',
            'unsupported-group'
        );
    });

    it('keeps missing supported fields as FALSE leaves even in strict OR', () => {
        const result = compiled(
            compile({
                logicalOperator: 'or',
                conditions: [
                    condition('is', 'singleLineText', 'Example', {
                        type: 'id',
                        id: 'fld_missing',
                    }),
                    condition(),
                ],
            })
        );
        assert.equal(result.formula, "OR(FALSE(), {fld_title} = 'Example')");
        assert.deepEqual(result.diagnostics, [
            {
                code: 'missing-field',
                severity: 'warning',
                path: [0],
                conditionId: 'condition-1',
            },
        ]);
        const runner = new FormulaRunner(result.formula);
        runner.context = makeContext({ fld_title: 'Example' });
        assert.equal(runner.run(), 1);
    });

    it('requires explicit strict or compatibility mode', () => {
        const input = {
            conditions: definition(condition()),
            airtableFields: [runtimeTextField],
        };
        blocked(
            compileRuntimeConditions(
                input as unknown as CompileRuntimeConditionsInput
            ),
            'invalid',
            'invalid-definition'
        );
    });

    for (const value of [null, undefined, '']) {
        it(`blocks strict incomplete equality ${String(value)} and explicitly omits it in compatibility with a surviving sibling`, () => {
            const input = definition(
                condition('is', 'singleLineText', value),
                condition('contains', 'singleLineText', 'amp')
            );
            blocked(compile(input), 'invalid', 'incomplete-condition');
            const result = compiled(
                compile(input, [runtimeTextField], {
                    invalidConditionMode: 'compatibility',
                })
            );
            assert.equal(
                result.formula,
                "FIND(LOWER('amp'), LOWER({fld_title} & ''))"
            );
            assert.ok(
                result.diagnostics.some(
                    ({ code, severity, path }) =>
                        code === 'incomplete-condition' &&
                        severity === 'warning' &&
                        path[0] === 0
                )
            );
        });
    }

    it('does not confuse valid empty substring or regex operands with incomplete equality', () => {
        for (const operator of ['contains', 'doesNotContain', 'matchesRegex']) {
            assert.equal(
                compile(definition(condition(operator, 'singleLineText', '')))
                    .type,
                'compiled'
            );
        }
        assert.equal(
            compiled(
                compile(definition(condition('is', 'checkbox', false)), [
                    field('checkbox'),
                ])
            ).formula,
            '{fld_title} = 0'
        );
    });

    it('blocks strict empty nested groups; compatibility omits an empty group with a surviving sibling', () => {
        const empty = {
            id: 'empty-group',
            type: 'groupCondition',
            logicalOperator: 'or',
            conditions: [],
        };
        blocked(
            compile(definition(empty, condition())),
            'invalid',
            'empty-group'
        );
        const result = compiled(
            compile(definition(empty, condition()), [runtimeTextField], {
                invalidConditionMode: 'compatibility',
            })
        );
        assert.equal(result.formula, "{fld_title} = 'Example'");
        assert.ok(
            result.diagnostics.some(
                ({ code, severity }) =>
                    code === 'empty-group' && severity === 'warning'
            )
        );
    });

    it('never returns AND(), OR() or 1 when a nonempty compatibility group loses every condition', () => {
        for (const logicalOperator of ['and', 'or']) {
            blocked(
                compile(
                    {
                        logicalOperator,
                        conditions: [condition('is', 'singleLineText', null)],
                    },
                    [runtimeTextField],
                    { invalidConditionMode: 'compatibility' }
                ),
                'invalid',
                'no-complete-conditions'
            );
        }
        const nested = {
            id: 'all-omitted',
            type: 'groupCondition',
            logicalOperator: 'and',
            conditions: [condition('is', 'singleLineText', null)],
        };
        blocked(
            compile(definition(condition(), nested), [runtimeTextField], {
                invalidConditionMode: 'compatibility',
            }),
            'invalid',
            'no-complete-conditions'
        );
    });

    for (const type of [
        'date',
        'dateTime',
        'singleSelect',
        'multipleSelects',
        'multipleRecordLinks',
        'multipleAttachments',
        'singleCollaborator',
        'multipleCollaborators',
        'formula',
        'multipleLookupValues',
        'rollup',
        'duration',
        'aiText',
    ]) {
        it(`blocks the entire definition for richer saved/current ${type}, including compatibility`, () => {
            for (const invalidConditionMode of [
                'strict',
                'compatibility',
            ] as const) {
                blocked(
                    compile(
                        definition(condition(), condition('isEmpty', type)),
                        [runtimeTextField],
                        { invalidConditionMode }
                    ),
                    'unsupported',
                    'unsupported-field-type'
                );
                blocked(
                    compile(
                        definition(condition('isEmpty', 'singleLineText')),
                        [field(type)],
                        { invalidConditionMode }
                    ),
                    'unsupported',
                    'unsupported-field-type'
                );
            }
        });
    }

    it('blocks unsupported operators instead of omitting them from compatible OR', () => {
        blocked(
            compile(
                {
                    logicalOperator: 'or',
                    conditions: [
                        condition(),
                        condition('isAnyOf', 'singleSelect', ['choice-1']),
                    ],
                },
                [runtimeTextField],
                { invalidConditionMode: 'compatibility' }
            ),
            'unsupported',
            'unsupported-operator'
        );
        blocked(
            compile(definition(condition('is', 'richText'))),
            'unsupported',
            'unsupported-field-type'
        );
        blocked(
            compile(definition(condition('isNot', 'checkbox', true))),
            'unsupported',
            'unsupported-field-type'
        );
    });

    it('preserves supported saved/current type transitions and current percent scaling', () => {
        assert.equal(
            compiled(
                compile(definition(condition('equals', 'number', 50)), [
                    field('percent'),
                ])
            ).formula,
            '{fld_title} = 0.5'
        );
        assert.equal(
            compiled(
                compile(definition(condition('equals', 'percent', 50)), [
                    field('number'),
                ])
            ).formula,
            '{fld_title} = 50'
        );
        assert.equal(
            compiled(
                compile(definition(condition('isEmpty', 'rating')), [
                    runtimeTextField,
                ])
            ).formula,
            '{fld_title} = 0'
        );
        assert.equal(
            compiled(
                compile(definition(condition('isEmpty', 'singleLineText')), [
                    field('rating'),
                ])
            ).formula,
            "LEN('' & {fld_title}) = 0"
        );
        assert.equal(
            compiled(
                compile(definition(condition('is', 'email')), [
                    runtimeTextField,
                ])
            ).formula,
            "{fld_title} = 'Example'"
        );
    });

    it('uses first exact ID/name metadata match and explicit current-name reference mode', () => {
        const renamed = { ...runtimeTextField, name: 'Renamed title' };
        assert.equal(
            compiled(compile(definition(condition()), [renamed])).formula,
            "{fld_title} = 'Example'"
        );
        assert.equal(
            compiled(
                compile(definition(condition()), [renamed], {
                    fieldReferenceMode: 'name',
                })
            ).formula,
            "{Renamed title} = 'Example'"
        );
        assert.equal(
            compiled(
                compile(
                    definition(
                        condition('is', 'singleLineText', 'Example', {
                            type: 'name',
                            name: 'Title',
                        })
                    ),
                    [renamed]
                )
            ).formula,
            'FALSE()'
        );
        assert.equal(
            compiled(
                compile(definition(condition()), [field('email'), renamed], {
                    fieldReferenceMode: 'name',
                })
            ).formula,
            "{Title} = 'Example'"
        );
        blocked(
            compile(definition(condition()), [field('number'), renamed]),
            'unsupported',
            'unsupported-field-type'
        );
    });

    it('roundtrips quotes, literal newlines and braces without executing formula-like operand text', () => {
        const value = "It's\n{a} 'OR(FALSE(), TRUE())'";
        const name = 'A } brace { name';
        const metadata = { ...runtimeTextField, name };
        const result = compiled(
            compile(
                definition(
                    condition('is', 'singleLineText', value, {
                        type: 'name',
                        name,
                    })
                ),
                [metadata]
            )
        );
        assert.deepEqual(extractIdentifiersFromFormula(result.formula), [name]);
        const runner = new FormulaRunner(result.formula);
        runner.context = makeContext({ fld_title: value }, [metadata]);
        assert.equal(runner.run(), 1);
    });

    it('rejects canonical escape hazards instead of silently changing saved literals/references', () => {
        for (const value of [
            String.raw`line\nnext`,
            String.raw`two\\slashes`,
        ]) {
            blocked(
                compile(
                    definition(condition('contains', 'singleLineText', value))
                ),
                'invalid',
                'literal-roundtrip'
            );
        }
        const name = String.raw`two\\slashes`;
        blocked(
            compile(
                definition(
                    condition('is', 'singleLineText', 'Example', {
                        type: 'name',
                        name,
                    })
                ),
                [{ ...runtimeTextField, name }]
            ),
            'invalid',
            'field-reference-roundtrip'
        );
        blocked(
            compile(
                definition(
                    condition('is', 'singleLineText', 'Example', {
                        type: 'id',
                        id: 'fld_}bad',
                    })
                ),
                []
            ),
            'invalid',
            'field-reference-roundtrip'
        );
        const validRegex = compiled(
            compile(
                definition(
                    condition(
                        'matchesRegex',
                        'singleLineText',
                        String.raw`^\d+$`
                    )
                )
            )
        );
        const regexRunner = new FormulaRunner(validRegex.formula);
        regexRunner.context = makeContext({ fld_title: '42' });
        assert.equal(regexRunner.run(), 1);
        regexRunner.context = makeContext({ fld_title: 'letters' });
        assert.equal(regexRunner.run(), 0);
        blocked(
            compile(
                definition(
                    condition('contains', 'singleLineText', 'trailing\\')
                )
            ),
            'invalid',
            'invalid-formula'
        );
        blocked(
            compile(
                definition(
                    condition(),
                    condition('is', 'singleLineText', null, {
                        type: 'id',
                        id: 'fld_}bad',
                    })
                ),
                [runtimeTextField],
                { invalidConditionMode: 'compatibility' }
            ),
            'invalid',
            'field-reference-roundtrip'
        );
    });

    it('statically blocks invalid regex even if a matching OR sibling or missing driver would hide it', () => {
        for (const fields of [[runtimeTextField], []]) {
            blocked(
                compile(
                    {
                        logicalOperator: 'or',
                        conditions: [
                            condition(),
                            condition('matchesRegex', 'singleLineText', '['),
                        ],
                    },
                    fields
                ),
                'invalid',
                'invalid-regex'
            );
        }
        assert.equal(
            compile(definition(condition('is', 'singleLineText', '#ERROR!')))
                .type,
            'compiled'
        );
    });

    it('rejects nonfinite/wrong-type operands and formula syntax that the existing parser cannot represent', () => {
        for (const value of [NaN, Infinity, -Infinity, '2']) {
            blocked(
                compile(definition(condition('equals', 'number', value)), [
                    field('number'),
                ]),
                'invalid',
                'invalid-operand'
            );
        }
        blocked(
            compile(
                definition(condition('isOfLength', 'singleLineText', false))
            ),
            'invalid',
            'invalid-operand'
        );
        blocked(
            compile(definition(condition('is', 'checkbox', 1)), [
                field('checkbox'),
            ]),
            'invalid',
            'invalid-operand'
        );
        blocked(
            compile(definition(condition('equals', 'number', 1e21)), [
                field('number'),
            ]),
            'invalid',
            'invalid-formula'
        );
        for (const operator of ['equals', 'isOfLength']) {
            blocked(
                compile(
                    definition(
                        condition(
                            operator,
                            operator === 'equals' ? 'number' : 'singleLineText',
                            1e21
                        )
                    ),
                    []
                ),
                'invalid',
                'invalid-formula'
            );
        }
        assert.equal(
            compiled(
                compile(definition(condition('equals', 'number', -2.5)), [
                    field('number'),
                ])
            ).formula,
            '{fld_title} = -2.5'
        );
    });

    it('returns finite sanitized diagnostics for malformed/cyclic definitions without leaking values or exceptions', () => {
        // Point a real group back to itself; repeated acyclic group use is legal.
        const group: {
            id: string;
            type: string;
            logicalOperator: string;
            conditions: unknown[];
        } = {
            id: 'cycle',
            type: 'groupCondition',
            logicalOperator: 'and',
            conditions: [],
        };
        group.conditions.push(group);
        blocked(compile(definition(group)), 'invalid', 'cyclic-definition');
        for (const input of [
            undefined,
            {},
            { conditions: [null], logicalOperator: 'and' },
            definition({ type: 'singleCondition' }),
        ]) {
            blocked(compile(input), 'invalid', 'invalid-definition');
        }
        const operand = 'PRIVATE_OPERAND_[';
        const result = compile(
            definition(condition('matchesRegex', 'singleLineText', operand))
        );
        blocked(result, 'invalid', 'invalid-regex');
        assert.equal(JSON.stringify(result).includes(operand), false);
        const repeated = {
            id: 'repeated',
            type: 'groupCondition',
            logicalOperator: 'or',
            conditions: [condition()],
        };
        assert.equal(compile(definition(repeated, repeated)).type, 'compiled');
    });

    it('keeps the public runtime definition alias usable without adding a second AST schema', () => {
        const typed: RuntimeConditionsDefinition = {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'typed',
                    type: 'singleCondition',
                    setting: {
                        type: 'is',
                        fieldType: 'singleLineText',
                        idOrName: { type: 'id', id: 'fld_title' },
                        value: 'Example',
                    },
                },
            ],
        };
        assert.equal(
            compileRuntimeConditions({
                conditions: typed,
                airtableFields: [runtimeTextField],
                invalidConditionMode: 'strict',
            }).type,
            'compiled'
        );
    });
});
