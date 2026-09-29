import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    AIRTABLE_FORMULA_ERROR_VALUE,
    FormulaRunner,
    extractIdentifiersFromExpr,
    extractIdentifiersFromFormula,
} from '../src/formulas/index.js';
import { makeContext, numberField, textField } from './fixtures.js';

describe('FormulaRunner', () => {
    const arithmetic: [string, string | number][] = [
        ['2 + 3 * 4', 14],
        ['(2 + 3) * 4', 20],
        ['12 / 3 - 2', 2],
        ['-2 * -3', 6],
        ['--4', 4],
        ['1.4 + 1.4', 3],
        ['5 / 2', 3],
        ['1.5 * 3', 5],
        ['"Example " & (2 + 3)', 'Example 5'],
        ['4 & 4 + 4', 48],
        ['"4" + 2', 6],
        ['"Line\\nnext"', 'Line\nnext'],
        ["'It\\'s an example'", "It's an example"],
    ];

    for (const [formula, expected] of arithmetic) {
        it(`evaluates ${formula}`, () => {
            assert.equal(new FormulaRunner(formula).run(), expected);
        });
    }

    const comparisons: [string, number][] = [
        ['4 = 4', 1],
        ['4 = 5', 0],
        ['4 != 5', 1],
        ['4 != 4', 0],
        ['5 > 4', 1],
        ['4 > 4', 0],
        ['4 >= 4', 1],
        ['3 >= 4', 0],
        ['3 < 4', 1],
        ['4 < 4', 0],
        ['4 <= 4', 1],
        ['5 <= 4', 0],
        ['"4" = 4', 1],
        ['"Example" = "example"', 0],
    ];

    for (const [formula, expected] of comparisons) {
        it(`evaluates comparison ${formula}`, () => {
            assert.equal(new FormulaRunner(formula).run(), expected);
        });
    }

    it('distinguishes invalid numeric arithmetic from typed runtime errors', () => {
        assert.ok(Number.isNaN(new FormulaRunner('2 + "example"').run()));
        assert.equal(
            new FormulaRunner('2 * "3"').run(),
            AIRTABLE_FORMULA_ERROR_VALUE
        );
        assert.equal(
            new FormulaRunner('"6" / 2').run(),
            AIRTABLE_FORMULA_ERROR_VALUE
        );
        assert.equal(new FormulaRunner('1 / 0').run(), Infinity);
        assert.ok(Number.isNaN(new FormulaRunner('0 / 0').run()));
    });

    for (const source of [
        '',
        '2 | 3',
        '1..2',
        "'unfinished",
        '{unfinished',
        '2 +',
        '(2 + 3',
        '2 3',
        '!2',
    ]) {
        it(`rejects malformed source ${JSON.stringify(source)}`, () => {
            assert.throws(() => new FormulaRunner(source), Error);
        });
    }

    it('resolves names and IDs, preserving name-keyed record precedence', () => {
        const context = makeContext({
            Title: 'Named example',
            fld_title: 'ID example',
        });
        for (const formula of ['{Title}', '{fld_title}']) {
            const runner = new FormulaRunner(formula);
            runner.context = context;
            assert.equal(runner.run(), 'Named example');
        }

        const runner = new FormulaRunner('{Title}');
        runner.context = makeContext({ fld_title: 'Only ID present' });
        assert.equal(runner.run(), 'Only ID present');
        runner.context = makeContext({
            Title: '',
            fld_title: 'Ignored fallback',
        });
        assert.equal(runner.run(), '');
        runner.context = makeContext({
            Title: null,
            fld_title: 'Ignored null fallback',
        });
        assert.equal(runner.run(), '');
    });

    it('reuses a parsed formula with replacement contexts without retaining old records', () => {
        const runner = new FormulaRunner('{Quantity} + 1');
        const first = makeContext({ [numberField.id]: 4 });
        runner.context = first;
        assert.equal(runner.run(), 5);
        runner.context = makeContext({ [numberField.name]: 9 });
        assert.equal(runner.run(), 10);
        runner.context = first;
        assert.equal(runner.run(), 5);

        const independent = new FormulaRunner('{Quantity} + 1');
        independent.context = makeContext({ [numberField.id]: 20 });
        assert.equal(independent.run(), 21);
        assert.equal(runner.run(), 5);
    });

    it('requires context for identifiers and does not swallow unknown fields by default', () => {
        assert.throws(() => new FormulaRunner('{Title}').run(), Error);
        const runner = new FormulaRunner('{Unavailable}');
        runner.context = makeContext();
        assert.throws(() => runner.run(), Error);

        const permissive = new FormulaRunner(
            '{Unavailable} & " example"',
            true
        );
        permissive.context = makeContext();
        assert.equal(permissive.run(), ' example');
    });

    it('preserves identifier traversal order and duplicate references', () => {
        const formula = 'IF({Quantity} > 0, -({Quantity} + 1), LEN({Title}))';
        const identifiers = [
            numberField.name,
            numberField.name,
            textField.name,
        ];
        assert.deepEqual(extractIdentifiersFromFormula(formula), identifiers);
        assert.deepEqual(
            extractIdentifiersFromExpr(new FormulaRunner(formula).expr),
            identifiers
        );
        assert.deepEqual(
            extractIdentifiersFromFormula('2 + LEN("example")'),
            []
        );
        assert.throws(
            () => extractIdentifiersFromFormula('{unfinished'),
            Error
        );
    });

    it('classifies numeric errors and formula falsy values without treating strings as errors', () => {
        for (const value of [NaN, Infinity, -Infinity]) {
            assert.equal(FormulaRunner.isErrorValue(value), true);
            assert.equal(FormulaRunner.isFalsyValue(value), true);
        }
        for (const value of [0, false, '', []]) {
            assert.equal(FormulaRunner.isErrorValue(value), false);
            assert.equal(FormulaRunner.isFalsyValue(value), true);
        }
        for (const value of [
            1,
            true,
            '0',
            'NaN',
            'Infinity',
            AIRTABLE_FORMULA_ERROR_VALUE,
            [0],
            null,
            undefined,
        ]) {
            assert.equal(FormulaRunner.isErrorValue(value), false);
            assert.equal(FormulaRunner.isFalsyValue(value), false);
        }
    });
});
