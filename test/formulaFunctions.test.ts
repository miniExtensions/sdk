import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    AIRTABLE_FORMULA_ERROR_VALUE,
    FormulaRunner,
} from '../src/formulas/index.js';
import { makeContext, syntheticRecordId } from './fixtures.js';

describe('formula functions', () => {
    const cases: [string, string | number][] = [
        ['LOWER("MiXeD Example")', 'mixed example'],
        ['TRIM("  example  ")', 'example'],
        ['FIND("a", "banana")', 2],
        ['FIND("a", "banana", 2)', 4],
        ['FIND("z", "banana")', 0],
        ['SEARCH("a", "banana")', 2],
        ['SEARCH("z", "banana")', ''],
        ['SEARCH("A", "banana")', ''],
        ['AND(TRUE(), 2 > 1)', 1],
        ['AND(TRUE(), FALSE())', 0],
        ['AND()', 1],
        ['OR(FALSE(), "example")', 1],
        ['OR(FALSE(), 0)', 0],
        ['OR()', 0],
        ['LEN("example")', 7],
        ['NOT(TRUE())', 0],
        ['NOT(0)', 1],
        ['TRUE()', 1],
        ['FALSE()', 0],
        ['REGEX_MATCH("item42", "item[0-9]+")', 1],
        ['REGEX_MATCH("item", "item[0-9]+")', 0],
        ['REGEX_REPLACE("a1 b2", "[0-9]", "!")', 'a! b!'],
        ['IS_BEFORE("2040-06-15", "2040-06-16")', 1],
        ['IS_BEFORE("2040-06-16", "2040-06-15")', 0],
        ['IS_AFTER("2040-06-16", "2040-06-15")', 1],
        ['IS_AFTER("2040-06-15", "2040-06-16")', 0],
        ['DATESTR("2040-06-15T23:00:00-02:00")', '2040-06-16'],
        ['DATESTR("")', ''],
        ['WEEKDAY("2040-06-17")', 0],
        ['WEEKDAY("2040-06-18")', 1],
        ['DATEADD("2040-06-15", 2, "days")', '2040-06-17'],
        ['DATESTR(DATEADD("2040-06-15", -1, "months"))', '2040-05-15'],
        ['DATEADD("2040-06-15T09:00:00Z", 30, "minutes")', '2040-06-15 9:30am'],
        [
            'DATETIME_FORMAT("2040-06-15T09:30:00Z", "YYYY/MM/DD HH:mm")',
            '2040/06/15 09:30',
        ],
        ['VALUE("42.5")', 42.5],
        ['VALUE("")', 0],
        ['IF(TRUE(), "yes", "no")', 'yes'],
        ['IF(FALSE(), "yes", "no")', 'no'],
        ['ISERROR(1 / 0)', 1],
        ['ISERROR(0 / 0)', 1],
        ['ISERROR(LOWER(42))', 1],
        ['ISERROR("NaN")', 0],
        ['ISERROR("#ERROR!")', 0],
    ];

    for (const [formula, expected] of cases) {
        it(`evaluates ${formula}`, () => {
            assert.equal(new FormulaRunner(formula).run(), expected);
        });
    }

    const typeErrors = [
        'LOWER(42)',
        'TRIM(42)',
        'FIND(42, "example")',
        'FIND("example", 42)',
        'SEARCH(42, "example")',
        'LEN(42)',
        'REGEX_MATCH(42, "example")',
        'REGEX_MATCH("example", "[")',
        'REGEX_REPLACE("example", 42, "replacement")',
        'REGEX_REPLACE("example", "e", 42)',
        'IS_BEFORE(42, "2040-06-15")',
        'IS_AFTER("2040-06-15", 42)',
        'DATESTR(42)',
        'DATESTR("invalid example")',
        'DATEADD(42, 1, "days")',
        'DATEADD("2040-06-15", "1", "days")',
        'DATEADD("2040-06-15", 1, "fortnights")',
        'DATETIME_FORMAT("2040-06-15", 42)',
        'WEEKDAY(42)',
        'VALUE(42)',
    ];

    for (const formula of typeErrors) {
        it(`returns the formula error value for ${formula}`, () => {
            assert.equal(
                new FormulaRunner(formula).run(),
                AIRTABLE_FORMULA_ERROR_VALUE
            );
        });
    }

    it('reads record identity from the current context', () => {
        assert.throws(() => new FormulaRunner('RECORD_ID()').run(), Error);
        const runner = new FormulaRunner('RECORD_ID() & ":" & LOWER({Title})');
        runner.context = makeContext({ Title: 'Example' });
        assert.equal(runner.run(), `${syntheticRecordId}:example`);
        runner.context = makeContext(
            { Title: 'Other' },
            undefined,
            undefined,
            'rec00000000000004'
        );
        assert.equal(runner.run(), 'rec00000000000004:other');
    });

    it('evaluates TODAY against the local calendar day', (t) => {
        t.mock.method(Date, 'now', () => new Date(2040, 5, 15, 12).valueOf());
        assert.equal(new FormulaRunner('TODAY()').run(), '2040-06-15');
    });

    it('preserves numeric conversion errors and runtime exception distinctions', () => {
        assert.ok(Number.isNaN(new FormulaRunner('VALUE("example")').run()));
        assert.throws(
            () => new FormulaRunner('REGEX_REPLACE("example", "[", "x")').run(),
            SyntaxError
        );
        assert.throws(
            () => new FormulaRunner('UNSUPPORTED_FUNCTION(1)').run(),
            Error
        );
        assert.equal(
            new FormulaRunner('IF(TRUE(), "yes", LOWER(42))').run(),
            AIRTABLE_FORMULA_ERROR_VALUE
        );
    });
});
