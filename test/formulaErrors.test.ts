import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    AIRTABLE_FORMULA_ERROR_VALUE,
    AirtableFieldType,
    FormulaRunner,
    type AirtableField,
    type AirtableValue,
    type FormulaRunOutcome,
} from '../src/formulas/index.js';
import { dateField, makeContext, textField } from './fixtures.js';

const computedField = {
    id: 'fld_computed',
    name: 'Computed',
    config: {
        type: AirtableFieldType.FORMULA,
        options: { isValid: true, result: textField.config },
    },
} satisfies AirtableField;
const computedNumberField = {
    ...computedField,
    config: {
        type: AirtableFieldType.FORMULA,
        options: {
            isValid: true,
            result: {
                type: AirtableFieldType.NUMBER,
                options: { precision: 2 },
            },
        },
    },
} satisfies AirtableField;
const freeze = (value: object): void => {
    for (const member of Object.values(value)) {
        if (member !== null && typeof member === 'object') freeze(member);
    }
    Object.freeze(value);
};
const withComputed = (
    formula: string,
    value: AirtableValue,
    field: AirtableField = computedField
) => {
    const context = makeContext({ Computed: value }, [structuredClone(field)]);
    freeze(context);
    const runner = new FormulaRunner(formula);
    runner.context = context;
    return runner;
};

const invalidRegex = 'REGEX_MATCH("sample", "[")';
const runtimeFaultConsumers = [
    `AND(1, ${invalidRegex})`,
    `AND(0, ${invalidRegex})`,
    `OR(0, ${invalidRegex})`,
    `OR(1, ${invalidRegex})`,
    `NOT(${invalidRegex})`,
    `AND(1, OR(0, NOT(${invalidRegex})))`,
    `OR(0, AND(1, ${invalidRegex}))`,
    `${invalidRegex} + 1`,
    `1 - ${invalidRegex}`,
    `${invalidRegex} * 2`,
    `2 / ${invalidRegex}`,
    `${invalidRegex} = "#ERROR!"`,
    `${invalidRegex} != "other"`,
    `${invalidRegex} > ""`,
    `"prefix" & ${invalidRegex}`,
    `${invalidRegex} & "suffix"`,
    `-(${invalidRegex})`,
    `TRUE(${invalidRegex})`,
    `FALSE(1, ${invalidRegex})`,
];
const nonFiniteConsumers = [
    'AND(1, 1 / 0)',
    'AND(0, 1 / 0)',
    'OR(0, 0 / 0)',
    'OR(1, 0 / 0)',
    'NOT(1 / 0)',
    '(1 / 0) + 1',
    '(1 / 0) - (1 / 0)',
    '(0 / 0) * 2',
    '1 / (1 / 0)',
    '(1 / 0) = (1 / 0)',
    '(0 / 0) != (0 / 0)',
    'VALUE("not-a-number") > 0',
    '"prefix" & (1 / 0)',
    '(0 / 0) & "suffix"',
    '-(1 / 0)',
    'TRUE(1 / 0)',
    'FALSE(1, 0 / 0)',
];
const eagerRuntimeFaults = [
    `IF(1, 42, ${invalidRegex})`,
    `IF(0, ${invalidRegex}, 42)`,
    'IF(1, 42, LOWER(1))',
];
const eagerNonFiniteFaults = [
    'IF(1, 42, 1 / 0)',
    'IF(0, VALUE("not-a-number"), 42)',
];

// Keep this suite on the existing API so a missing additive method cannot
// mask the evaluator's actual baseline provenance/consumption failures.
describe('Formula error provenance through existing run', () => {
    for (const formula of runtimeFaultConsumers) {
        it(`propagates an invalid regex fault through ${formula}`, () => {
            assert.equal(
                new FormulaRunner(formula).run(),
                AIRTABLE_FORMULA_ERROR_VALUE
            );
        });
    }

    for (const formula of nonFiniteConsumers) {
        it(`does not turn a consumed non-finite value into data in ${formula}`, () => {
            assert.equal(
                new FormulaRunner(formula).run(),
                AIRTABLE_FORMULA_ERROR_VALUE
            );
        });
    }

    for (const formula of [...eagerRuntimeFaults, ...eagerNonFiniteFaults]) {
        it(`preserves eager IF argument fault propagation in ${formula}`, () => {
            assert.equal(
                new FormulaRunner(formula).run(),
                AIRTABLE_FORMULA_ERROR_VALUE
            );
        });
    }

    for (const formula of [
        invalidRegex,
        `AND(1, ${invalidRegex})`,
        `NOT(OR(0, ${invalidRegex}))`,
        '(1 / 0) = (1 / 0)',
        '"prefix" & (0 / 0)',
        '-(1 / 0)',
    ]) {
        it(`ISERROR handles the fault provenance in ${formula}`, () => {
            assert.equal(new FormulaRunner(`ISERROR(${formula})`).run(), 1);
        });
    }

    it('keeps literal error markers and near-marker strings as ordinary data', () => {
        for (const value of [
            '#ERROR!',
            ' #ERROR!',
            '#ERROR!suffix',
            '#ERROR',
            'NaN',
            'Infinity',
        ]) {
            const literal = JSON.stringify(value);
            assert.equal(new FormulaRunner(literal).run(), value);
            assert.equal(new FormulaRunner(`ISERROR(${literal})`).run(), 0);
            assert.equal(new FormulaRunner(`AND(1, ${literal})`).run(), 1);
            assert.equal(new FormulaRunner(`NOT(${literal})`).run(), 0);
        }
        assert.equal(new FormulaRunner('"#ERROR!" = "#ERROR!"').run(), 1);
        assert.equal(
            new FormulaRunner('"prefix" & "#ERROR!" & "suffix"').run(),
            'prefix#ERROR!suffix'
        );
    });

    it('preserves legacy top-level NaN and infinity as numeric values', () => {
        assert.equal(new FormulaRunner('1 / 0').run(), Infinity);
        assert.equal(new FormulaRunner('-1 / 0').run(), -Infinity);
        for (const formula of [
            '0 / 0',
            'VALUE("not-a-number")',
            '2 + "text"',
        ]) {
            assert.ok(Number.isNaN(new FormulaRunner(formula).run()));
        }
        for (const value of [NaN, Infinity, -Infinity]) {
            assert.equal(FormulaRunner.isErrorValue(value), true);
            assert.equal(FormulaRunner.isFalsyValue(value), true);
        }
        assert.equal(FormulaRunner.isErrorValue('#ERROR!'), false);
        assert.equal(FormulaRunner.isFalsyValue('#ERROR!'), false);
    });

    it('distinguishes creation of negative infinity from consuming infinity through unary minus', () => {
        assert.equal(new FormulaRunner('-1 / 0').run(), -Infinity);
        assert.equal(
            new FormulaRunner('-(1 / 0)').run(),
            AIRTABLE_FORMULA_ERROR_VALUE
        );
        assert.equal(new FormulaRunner('ISERROR(-(1 / 0))').run(), 1);
    });

    it('propagates consumed missing results and invalid converted dates', () => {
        for (const formula of [
            'IF(1) = ""',
            '"prefix" & IF(1)',
            '-IF(1)',
            'NOT(IF(1))',
            'TRUE(IF(1))',
            'IF(1, 42, IF(1))',
        ]) {
            assert.equal(
                new FormulaRunner(formula).run(),
                AIRTABLE_FORMULA_ERROR_VALUE
            );
        }
        assert.equal(new FormulaRunner('ISERROR(IF(1))').run(), 1);
        for (const formula of [
            '{Due date} != ""',
            '"prefix" & {Due date}',
            'NOT({Due date})',
            '-{Due date}',
        ]) {
            const runner = new FormulaRunner(formula);
            runner.context = makeContext({ 'Due date': '2040-99-99' }, [
                dateField,
            ]);
            assert.equal(runner.run(), AIRTABLE_FORMULA_ERROR_VALUE);
        }
        const classifier = new FormulaRunner('ISERROR({Due date})');
        classifier.context = makeContext({ 'Due date': '2040-99-99' }, [
            dateField,
        ]);
        assert.equal(classifier.run(), 1);
    });

    it('keeps eager later-field exceptions ahead of non-finite consumption and unknown callees throwing', () => {
        for (const formula of [
            'AND(1 / 0, {Unavailable})',
            'OR(1, {Unavailable})',
            'TRUE(1 / 0, {Unavailable})',
            'ISERROR(1 / 0, {Unavailable})',
            '(1 / 0) + {Unavailable}',
        ]) {
            const runner = new FormulaRunner(formula);
            runner.context = makeContext();
            assert.throws(
                () => runner.run(),
                /Field Unavailable does not exist/
            );
        }
        for (const formula of [
            'UNSUPPORTED_FUNCTION(1 / 0)',
            'ISERROR(UNSUPPORTED_FUNCTION(1 / 0))',
        ]) {
            assert.throws(
                () => new FormulaRunner(formula).run(),
                /Unexpected: UNSUPPORTED_FUNCTION/
            );
        }
        const firstFault = new FormulaRunner('AND(LOWER(1), {Unavailable})');
        firstFault.context = makeContext();
        assert.equal(firstFault.run(), AIRTABLE_FORMULA_ERROR_VALUE);
    });

    it('keeps RECORD_ID call-context exceptions after eager argument exceptions', () => {
        for (const formula of [
            'RECORD_ID(1 / 0)',
            'ISERROR(RECORD_ID(1 / 0))',
        ]) {
            assert.throws(
                () => new FormulaRunner(formula).run(),
                /context must be set for resolving record id/
            );
        }
        assert.equal(
            new FormulaRunner('RECORD_ID(LOWER(1))').run(),
            AIRTABLE_FORMULA_ERROR_VALUE
        );
        const contextual = new FormulaRunner('ISERROR(RECORD_ID(1 / 0))');
        contextual.context = makeContext();
        assert.equal(contextual.run(), 1);
    });

    it('handles faults in every actual ISERROR argument while preserving zero-argument behavior', () => {
        assert.equal(new FormulaRunner('ISERROR()').run(), 0);
        assert.equal(new FormulaRunner('ISERROR(1, "#ERROR!")').run(), 0);
        for (const formula of [
            'ISERROR(1, 1 / 0)',
            'ISERROR(0, 0 / 0)',
            'ISERROR(1, IF(1))',
            'ISERROR(1, LOWER(42))',
        ]) {
            assert.equal(new FormulaRunner(formula).run(), 1);
        }
    });

    it('retains native computed error provenance before shared string conversion', () => {
        for (const formula of [
            '{Computed}',
            'AND(1, {Computed})',
            '"prefix" & {Computed}',
        ]) {
            assert.equal(
                withComputed(formula, {
                    error: 'Synthetic computed failure',
                }).run(),
                AIRTABLE_FORMULA_ERROR_VALUE
            );
        }
        assert.equal(
            withComputed('ISERROR({Computed})', { error: '#ERROR!' }).run(),
            1
        );
        assert.equal(withComputed('ISERROR({Computed})', '#ERROR!').run(), 0);
        assert.equal(withComputed('{Computed}', '#ERROR!').run(), '#ERROR!');
        assert.equal(
            withComputed('ISERROR({Computed})', [
                '#ERROR!',
                { error: 'Synthetic computed failure' },
            ]).run(),
            1
        );
    });

    it('does not let actual computed-array numeric error members become joined text', () => {
        for (const member of [
            NaN,
            Infinity,
            -Infinity,
            { specialValue: 'NaN' },
            { specialValue: 'Infinity' },
            { specialValue: '-Infinity' },
        ] satisfies AirtableValue[]) {
            assert.equal(
                withComputed(
                    'ISERROR({Computed})',
                    [1, member],
                    computedNumberField
                ).run(),
                1
            );
            assert.equal(
                withComputed(
                    'AND(1, {Computed})',
                    [1, member],
                    computedNumberField
                ).run(),
                AIRTABLE_FORMULA_ERROR_VALUE
            );
        }
        assert.equal(
            withComputed(
                '{Computed}',
                { specialValue: 'Infinity' },
                computedNumberField
            ).run(),
            Infinity
        );
    });

    it('uses name-keyed precedence before inspecting native error provenance without mutating frozen context', () => {
        for (const [named, byId, expected] of [
            ['#ERROR!', { error: 'Synthetic ignored ID failure' }, '#ERROR!'],
            [
                { error: 'Synthetic named failure' },
                'Ignored ID text',
                AIRTABLE_FORMULA_ERROR_VALUE,
            ],
        ] as const) {
            const context = makeContext(
                { Computed: named, fld_computed: byId },
                [structuredClone(computedField)]
            );
            freeze(context);
            const runner = new FormulaRunner('{fld_computed}');
            runner.context = context;
            assert.equal(runner.run(), expected);
            const classifier = new FormulaRunner('ISERROR({fld_computed})');
            classifier.context = context;
            assert.equal(classifier.run(), typeof named === 'string' ? 0 : 1);
            assert.deepEqual(context.record.fields, {
                Computed: named,
                fld_computed: byId,
            });
            assert.ok(Object.isFrozen(context.record.fields));
        }
    });

    it('still throws for unknown fields, unsupported functions and unrelated syntax errors', () => {
        const unknown = new FormulaRunner('ISERROR({Unavailable})');
        unknown.context = makeContext();
        assert.throws(() => unknown.run(), /Field Unavailable does not exist/);
        assert.throws(
            () => new FormulaRunner('ISERROR(UNSUPPORTED_FUNCTION(1))').run(),
            /Unexpected: UNSUPPORTED_FUNCTION/
        );
        assert.throws(
            () =>
                new FormulaRunner(
                    'ISERROR(REGEX_REPLACE("sample", "[", "x"))'
                ).run(),
            SyntaxError
        );
        assert.throws(() => new FormulaRunner('AND('), Error);
    });
});

const outcome = (runner: FormulaRunner): FormulaRunOutcome =>
    runner.runWithOutcome();

describe('FormulaRunner typed outcomes', () => {
    for (const formula of [
        invalidRegex,
        'REGEX_MATCH(42, "sample")',
        ...runtimeFaultConsumers,
        ...eagerRuntimeFaults,
    ]) {
        it(`distinguishes runtime fault provenance for ${formula}`, () => {
            assert.deepEqual(outcome(new FormulaRunner(formula)), {
                type: 'error',
                code: 'runtime-error',
            });
        });
    }

    for (const formula of [
        '1 / 0',
        '-1 / 0',
        '0 / 0',
        'VALUE("not-a-number")',
        ...nonFiniteConsumers,
        ...eagerNonFiniteFaults,
    ]) {
        it(`reports non-finite provenance for ${formula}`, () => {
            assert.deepEqual(outcome(new FormulaRunner(formula)), {
                type: 'error',
                code: 'non-finite-result',
            });
        });
    }

    it('returns literal markers and finite results as typed values', () => {
        for (const value of [
            '#ERROR!',
            ' #ERROR!',
            '#ERROR!suffix',
            '#ERROR',
            'NaN',
            'Infinity',
        ]) {
            assert.deepEqual(
                outcome(new FormulaRunner(JSON.stringify(value))),
                { type: 'value', value }
            );
        }
        for (const [formula, value] of [
            ['2 + 3', 5],
            ['IF(1, "#ERROR!", "other")', '#ERROR!'],
            [`ISERROR(${invalidRegex})`, 1],
            ['ISERROR(1 / 0)', 1],
        ] as const) {
            assert.deepEqual(outcome(new FormulaRunner(formula)), {
                type: 'value',
                value,
            });
        }
    });

    it('does not retain an old error outcome across replacement contexts', () => {
        const patternField = {
            ...textField,
            id: 'fld_pattern',
            name: 'Pattern',
        };
        const fields = [textField, patternField];
        const runner = new FormulaRunner('REGEX_MATCH({Title}, {Pattern})');
        runner.context = makeContext({ Title: 'sample', Pattern: '[' }, fields);
        assert.deepEqual(outcome(runner), {
            type: 'error',
            code: 'runtime-error',
        });
        runner.context = makeContext(
            { Title: 'sample', Pattern: '^sample$' },
            fields
        );
        assert.deepEqual(outcome(runner), { type: 'value', value: 1 });
        runner.context = makeContext({ Title: 'sample', Pattern: '[' }, fields);
        assert.deepEqual(outcome(runner), {
            type: 'error',
            code: 'runtime-error',
        });
    });

    it('evaluates the current expression exactly once for each typed outcome', () => {
        let reads = 0;
        const context = makeContext();
        Object.defineProperty(context.record.fields, 'Title', {
            enumerable: true,
            get: () => {
                reads++;
                return 'sample';
            },
        });
        const runner = new FormulaRunner('LEN({Title})');
        runner.context = context;
        assert.deepEqual(outcome(runner), { type: 'value', value: 6 });
        assert.equal(reads, 1);
        assert.deepEqual(outcome(runner), { type: 'value', value: 6 });
        assert.equal(reads, 2);
    });

    it('keeps consumed null/undefined failures separate from later unknown-field exceptions', () => {
        for (const formula of [
            'IF(1) = ""',
            '"prefix" & IF(1)',
            '-IF(1)',
            'NOT(IF(1))',
            'TRUE(IF(1))',
        ]) {
            assert.deepEqual(outcome(new FormulaRunner(formula)), {
                type: 'error',
                code: 'runtime-error',
            });
        }
        const invalidDate = new FormulaRunner('"prefix" & {Due date}');
        invalidDate.context = makeContext({ 'Due date': '2040-99-99' }, [
            dateField,
        ]);
        assert.deepEqual(outcome(invalidDate), {
            type: 'error',
            code: 'runtime-error',
        });
        for (const formula of [
            'AND(1 / 0, {Unavailable})',
            'TRUE(1 / 0, {Unavailable})',
            '(1 / 0) + {Unavailable}',
        ]) {
            const runner = new FormulaRunner(formula);
            runner.context = makeContext();
            assert.throws(
                () => outcome(runner),
                /Field Unavailable does not exist/
            );
        }
        assert.throws(
            () => outcome(new FormulaRunner('UNSUPPORTED_FUNCTION(1 / 0)')),
            /Unexpected: UNSUPPORTED_FUNCTION/
        );
        const firstFault = new FormulaRunner('AND(LOWER(1), {Unavailable})');
        firstFault.context = makeContext();
        assert.deepEqual(outcome(firstFault), {
            type: 'error',
            code: 'runtime-error',
        });
    });

    it('preserves call-context exceptions and all actual eager ISERROR arguments', () => {
        for (const formula of [
            'RECORD_ID(1 / 0)',
            'ISERROR(RECORD_ID(1 / 0))',
        ]) {
            assert.throws(
                () => outcome(new FormulaRunner(formula)),
                /context must be set for resolving record id/
            );
        }
        assert.deepEqual(outcome(new FormulaRunner('RECORD_ID(LOWER(1))')), {
            type: 'error',
            code: 'runtime-error',
        });
        assert.deepEqual(outcome(new FormulaRunner('ISERROR()')), {
            type: 'value',
            value: 0,
        });
        assert.deepEqual(outcome(new FormulaRunner('ISERROR(1, "#ERROR!")')), {
            type: 'value',
            value: 0,
        });
        for (const formula of [
            'ISERROR(1, 1 / 0)',
            'ISERROR(0, 0 / 0)',
            'ISERROR(1, IF(1))',
        ]) {
            assert.deepEqual(outcome(new FormulaRunner(formula)), {
                type: 'value',
                value: 1,
            });
        }
    });

    it('distinguishes native error objects and their array members from literal data', () => {
        for (const value of [
            { error: '#ERROR!' },
            ['#ERROR!', { error: 'Synthetic computed failure' }],
        ] satisfies AirtableValue[]) {
            assert.deepEqual(outcome(withComputed('{Computed}', value)), {
                type: 'error',
                code: 'runtime-error',
            });
        }
        for (const value of [
            '#ERROR!',
            ['#ERROR!', 'suffix'],
        ] satisfies AirtableValue[]) {
            assert.deepEqual(outcome(withComputed('{Computed}', value)), {
                type: 'value',
                value: Array.isArray(value) ? '#ERROR!, suffix' : value,
            });
        }
        for (const member of [
            NaN,
            Infinity,
            -Infinity,
            { specialValue: 'NaN' },
            { specialValue: 'Infinity' },
            { specialValue: '-Infinity' },
        ] satisfies AirtableValue[]) {
            assert.deepEqual(
                outcome(
                    withComputed('{Computed}', [1, member], computedNumberField)
                ),
                { type: 'error', code: 'non-finite-result' }
            );
        }
    });

    it('rejects invalid converted dates and missing results without changing legacy top-level returns', () => {
        const invalidDate = new FormulaRunner('{Due date}');
        invalidDate.context = makeContext({ 'Due date': '2040-99-99' }, [
            dateField,
        ]);
        assert.equal(invalidDate.run(), null);
        assert.deepEqual(outcome(invalidDate), {
            type: 'error',
            code: 'runtime-error',
        });
        const missing = new FormulaRunner('IF(1)');
        assert.equal(missing.run(), undefined);
        assert.deepEqual(outcome(missing), {
            type: 'error',
            code: 'runtime-error',
        });
    });

    it('does not convert unrelated thrown errors into typed outcomes', () => {
        const unknown = new FormulaRunner('ISERROR({Unavailable})');
        unknown.context = makeContext();
        assert.throws(
            () => outcome(unknown),
            /Field Unavailable does not exist/
        );
        assert.throws(
            () =>
                outcome(new FormulaRunner('ISERROR(UNSUPPORTED_FUNCTION(1))')),
            /Unexpected: UNSUPPORTED_FUNCTION/
        );
        assert.throws(
            () =>
                outcome(
                    new FormulaRunner(
                        'ISERROR(REGEX_REPLACE("sample", "[", "x"))'
                    )
                ),
            SyntaxError
        );
    });
});
