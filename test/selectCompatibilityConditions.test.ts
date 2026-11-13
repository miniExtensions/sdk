import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileSelectConditions } from '../src/forms/selectConditions.js';
import { compileSelectCompatibilityConditions } from '../src/forms/selectCompatibilityConditions.js';
import type {
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
    RuntimeConditionSetting,
} from '../src/runtime/types.js';

const text: RuntimeAirtableField = {
    id: 'fld_text',
    name: 'Text}',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: { type: 'singleLineText', options: null },
};
const select: RuntimeAirtableField = {
    ...text,
    id: 'fld_select',
    name: 'Select',
    config: {
        type: 'singleSelect',
        options: { choices: [{ id: 'sel_a', name: 'Alpha' }] },
    },
};
const group = (
    ...settings: RuntimeConditionSetting[]
): RuntimeConditionsDefinition => ({
    logicalOperator: 'and',
    conditions: settings.map((setting, index) => ({
        id: String(index),
        type: 'singleCondition',
        setting,
    })),
});
const alpha: RuntimeConditionSetting = {
    type: 'is',
    fieldType: 'singleSelect',
    idOrName: { type: 'id', id: 'fld_select' },
    value: 'sel_a',
};
const contains: RuntimeConditionSetting = {
    type: 'contains',
    fieldType: 'singleLineText',
    idOrName: { type: 'name', name: 'Text}' },
    value: "O'Brien",
};

describe('portable whole-AST Select compatibility compilation', () => {
    it('retains the qualified Select cohort and full native-formula fallback', () => {
        assert.equal(
            compileSelectConditions(group(alpha), [select]).type,
            'sdk'
        );
        const mixed = group(alpha, contains);
        const result = compileSelectConditions(mixed, [text, select]);
        assert.equal(result.type, 'native');
        assert.equal(
            result.formula,
            compileSelectCompatibilityConditions(mixed, [text, select])
        );
        assert.equal(
            result.formula,
            "AND({fld_select} = 'Alpha', FIND(LOWER('O\\'Brien'), LOWER({Text\\}} & '')))"
        );
    });
    it('retains null, missing field, incomplete group and fail-closed behavior', () => {
        assert.equal(compileSelectConditions(null, []).formula, '1');
        assert.equal(
            compileSelectCompatibilityConditions(group(alpha), []),
            'FALSE()'
        );
        const incomplete = group({ ...alpha, value: '' });
        assert.equal(
            compileSelectCompatibilityConditions(incomplete, [select]),
            'AND()'
        );
        assert.equal(
            compileSelectCompatibilityConditions(incomplete, [select], {
                failClosedOnInvalidCondition: true,
            }),
            'FALSE()'
        );
    });
    it('preserves name-mode whole-AST fallback and field escaping', () => {
        const result = compileSelectConditions(group(alpha), [select], {
            fieldReferenceMode: 'name',
        });
        assert.equal(result.type, 'native');
        assert.equal(result.formula, "{Select} = 'Alpha'");
    });
    it('keeps date conditions outside the cohort without rejecting their formula', () => {
        const date: RuntimeAirtableField = {
            ...text,
            id: 'fld_date',
            name: 'Date',
            config: {
                type: 'date',
                options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
            },
        };
        const result = compileSelectConditions(
            group({
                type: 'isBefore',
                fieldType: 'date',
                idOrName: { type: 'id', id: 'fld_date' },
                value: '2026-11-13',
            }),
            [date]
        );
        assert.equal(result.type, 'native');
        assert.equal(
            result.formula,
            "IF(LEN('' & {fld_date}) > 0, IS_BEFORE(DATESTR({fld_date}), DATESTR('2026-11-13')), FALSE())"
        );
    });
});

// These fixtures deliberately include malformed saved JSON as well as valid
// configurations. The compatibility entry point must preserve native outcomes.
function savedSetting(
    type: string,
    value?: unknown,
    fieldType = 'singleLineText'
): RuntimeConditionSetting {
    return {
        type,
        value,
        fieldType,
        idOrName: { type: 'id', id: 'fld_text' },
    } as RuntimeConditionSetting;
}
const emit = (
    type: string,
    value?: unknown,
    field: RuntimeAirtableField = text,
    fieldType = field.config.type
) =>
    compileSelectCompatibilityConditions(
        group(savedSetting(type, value, fieldType)),
        [field]
    );
const dateField: RuntimeAirtableField = {
    ...text,
    config: {
        type: 'date',
        options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
    },
};
const numberField: RuntimeAirtableField = {
    ...text,
    config: { type: 'number', options: { precision: 2 } },
};
const percentField: RuntimeAirtableField = {
    ...text,
    config: { type: 'percent', options: { precision: 2 } },
};
const multiField: RuntimeAirtableField = {
    ...text,
    config: {
        type: 'multipleSelects',
        options: {
            choices: [
                { id: 'a', name: 'A' },
                { id: 'b', name: 'B' },
                { id: 'punctuation', name: 'a-b.c' },
                { id: 'quoted', name: 'A, "B"' },
            ],
        },
    },
};
const singleField: RuntimeAirtableField = { ...select, id: 'fld_text' };
const guard = (formula: string) =>
    `IF(LEN('' & {fld_text}) > 0, ${formula}, FALSE())`;

describe('whole-AST compatibility operator regressions', () => {
    it('preserves text, regex, boolean and attachment operators and incomplete operands', () => {
        assert.equal(
            emit('matchesRegex', "a'b.*"),
            "REGEX_MATCH({fld_text}, 'a\\'b.*')"
        );
        assert.equal(emit('isNot', 'Text'), "{fld_text} != 'Text'");
        assert.equal(emit('is', true), '{fld_text} = 1');
        assert.equal(emit('isNot', false), '{fld_text} != 0');
        assert.equal(emit('isOfLength', 0), 'LEN({fld_text}) = 0');
        assert.equal(
            emit('doesNotContain', "O'Brien"),
            "NOT(FIND(LOWER('O\\'Brien'), LOWER({fld_text} & '')))"
        );
        assert.equal(
            emit('filenamesContains', "a'b.pdf"),
            "FIND(LOWER('a\\'b.pdf'), LOWER({fld_text}))"
        );
        for (const type of [
            'matchesRegex',
            'is',
            'isNot',
            'isOfLength',
            'contains',
            'doesNotContain',
            'filenamesContains',
        ]) {
            assert.equal(emit(type, null), 'AND()', `${type}: missing operand`);
        }
        assert.equal(emit('is', ''), 'AND()');
    });

    it('uses rating zero emptiness but string length for ordinary fields', () => {
        assert.equal(emit('isEmpty'), "LEN('' & {fld_text}) = 0");
        assert.equal(emit('isNotEmpty'), "LEN('' & {fld_text}) != 0");
        assert.equal(
            emit('isEmpty', undefined, text, 'rating'),
            '{fld_text} = 0'
        );
        assert.equal(
            emit('isNotEmpty', undefined, text, 'rating'),
            '{fld_text} != 0'
        );
    });

    it('preserves all numeric signs, zero and percent scaling without coercing strings', () => {
        const signs = {
            equals: '=',
            notEquals: '!=',
            greaterThan: '>',
            lessThan: '<',
            greaterThanOrEqualsTo: '>=',
            lessThanOrEqualsTo: '<=',
        };
        for (const [operator, sign] of Object.entries(signs)) {
            assert.equal(
                emit(operator, 12, numberField),
                `{fld_text} ${sign} 12`
            );
            assert.equal(
                emit(operator, 25, percentField),
                `{fld_text} ${sign} 0.25`
            );
            assert.equal(emit(operator, '12', numberField), 'AND()');
        }
        assert.equal(emit('equals', 0, percentField), '{fld_text} = 0');
    });

    it('resolves saved single choice IDs, deduplicates operands and retains missing-choice refusals', () => {
        assert.equal(
            emit('isNot', 'sel_a', singleField),
            "{fld_text} != 'Alpha'"
        );
        assert.equal(emit('is', 'gone', singleField), 'FALSE()');
        assert.equal(
            emit('isAnyOf', ['sel_a', 'sel_a', 'gone'], singleField),
            "OR({fld_text} = 'Alpha')"
        );
        assert.equal(
            emit('isNoneOf', ['sel_a'], singleField),
            "NOT(OR({fld_text} = 'Alpha'))"
        );
        assert.equal(emit('isAnyOf', ['gone'], singleField), 'FALSE()');
        assert.equal(emit('isAnyOf', ['sel_a'], text), 'FALSE()');
        assert.equal(emit('isAnyOf', [], singleField), 'AND()');
        assert.equal(emit('isNoneOf', null, singleField), 'AND()');
    });

    it('preserves multiple-choice ALL/ANY/NONE/exact semantics, ordering and regex escaping', () => {
        const a = "REGEX_MATCH({fld_text}, '(^|, )A(,|$)')";
        const b = "REGEX_MATCH({fld_text}, '(^|, )B(,|$)')";
        assert.equal(
            emit('hasAllOf', ['a', 'b', 'a'], multiField),
            `AND(${a},${b})`
        );
        assert.equal(emit('hasAnyOf', ['a', 'gone'], multiField), `OR(${a})`);
        assert.equal(emit('hasNoneOf', ['b'], multiField), `NOT(OR(${b}))`);
        assert.equal(
            emit('isExactly', ['a', 'b'], multiField),
            `AND(LEN({fld_text}) = 4, ${a},${b})`
        );
        for (const operator of ['hasAllOf', 'isExactly']) {
            assert.equal(emit(operator, ['a', 'gone'], multiField), 'FALSE()');
        }
        assert.equal(emit('hasAnyOf', ['gone'], multiField), 'FALSE()');
        assert.equal(emit('hasAllOf', ['a'], text), 'FALSE()');
        assert.equal(emit('hasAllOf', [], multiField), 'AND()');
        assert.equal(emit('hasNoneOf', null, multiField), 'AND()');
        assert.equal(
            emit('hasAnyOf', ['punctuation'], multiField),
            "OR(REGEX_MATCH({fld_text}, '(^|, )a\\x2db\\.c(,|$)'))"
        );
        assert.equal(
            emit('isExactly', ['quoted'], multiField),
            'AND(LEN({fld_text}) = 10, REGEX_MATCH({fld_text}, \'(^|, )"A, ""B"""(,|$)\'))'
        );
    });

    it('unwraps computed result metadata once but does not unwrap lookup choices', () => {
        const formula: RuntimeAirtableField = {
            ...text,
            config: {
                type: 'formula',
                options: { isValid: true, result: singleField.config },
            },
        } as RuntimeAirtableField;
        const lookup: RuntimeAirtableField = {
            ...text,
            config: {
                type: 'multipleLookupValues',
                options: { isValid: true, result: singleField.config },
            },
        } as RuntimeAirtableField;
        assert.equal(
            emit('is', 'sel_a', formula, 'singleSelect'),
            "{fld_text} = 'Alpha'"
        );
        assert.equal(
            emit('isAnyOf', ['sel_a'], lookup, 'singleSelect'),
            'FALSE()'
        );
        assert.equal(
            emit('is', 'sel_a', lookup, 'singleSelect'),
            "{fld_text} = 'sel_a'"
        );
    });

    it('retains guarded date equality and all four ordering boundaries', () => {
        assert.equal(
            emit('is', '2026-11-13', dateField),
            guard("DATESTR({fld_text}) = DATESTR('2026-11-13')")
        );
        assert.equal(
            emit('isNot', '2026-11-13', dateField),
            guard("DATESTR({fld_text}) != DATESTR('2026-11-13')")
        );
        assert.equal(emit('is', false, dateField), 'AND()');
        for (const [operator, functionName, inclusive] of [
            ['isAfter', 'IS_AFTER', false],
            ['isBefore', 'IS_BEFORE', false],
            ['isOnOrAfter', 'IS_AFTER', true],
            ['isOnOrBefore', 'IS_BEFORE', true],
        ] as const) {
            const comparison = `${functionName}(DATESTR({fld_text}), DATESTR('2026-11-13'))`;
            assert.equal(
                emit(operator, '2026-11-13', dateField),
                guard(
                    inclusive
                        ? `OR(DATESTR({fld_text}) = DATESTR('2026-11-13'), ${comparison})`
                        : comparison
                )
            );
            assert.equal(emit(operator, null, dateField), 'AND()');
        }
    });

    it('retains relative date inclusivity and start-of-week formula instead of strict-mode rejection', () => {
        for (const [range, units] of [
            ['the past year', 'years'],
            ['the past month', 'months'],
            ['the past week', 'weeks'],
        ] as const) {
            assert.equal(
                emit('IsWithin', range, dateField),
                guard(
                    `AND(IS_BEFORE(DATESTR({fld_text}), DATEADD(TODAY(), 1, "days")), IS_AFTER(DATESTR({fld_text}), DATEADD(DATEADD(TODAY(), -1, "${units}"), -1, "days")))`
                )
            );
        }
        for (const [range, units] of [
            ['the next year', 'years'],
            ['the next month', 'months'],
            ['the next week', 'weeks'],
        ] as const) {
            assert.equal(
                emit('IsWithin', range, dateField),
                guard(
                    `AND(IS_AFTER(DATESTR({fld_text}), DATEADD(TODAY(), -1, "days")), IS_BEFORE(DATESTR({fld_text}), DATEADD(DATEADD(TODAY(), 1, "${units}"), 1, "days")))`
                )
            );
        }
        assert.equal(
            emit('IsWithin', 'today or in the past', dateField),
            guard(
                'AND(IS_BEFORE(DATESTR({fld_text}), DATEADD(TODAY(), 1, "days")))'
            )
        );
        assert.equal(
            emit('IsWithin', 'today or in the future', dateField),
            guard(
                'AND(IS_AFTER(DATESTR({fld_text}), DATEADD(TODAY(), -1, "days")))'
            )
        );
        assert.equal(
            emit('IsWithin', 'this week', dateField).replace(/\s+/g, ''),
            guard(
                'AND(IS_AFTER(DATESTR({fld_text}), DATEADD(TODAY(), -1 * IF(WEEKDAY(TODAY()) = 0, 7, WEEKDAY(TODAY())), "days")), IS_BEFORE(DATESTR({fld_text}), DATEADD(TODAY(), 1, "days")))'
            ).replace(/\s+/g, '')
        );
        assert.equal(emit('IsWithin', 'not-a-range', dateField), 'AND()');
        assert.equal(emit('IsWithin', null, dateField), 'AND()');
        for (const [operator, offset] of [
            ['isToday', 0],
            ['isTomorrow', 1],
            ['isYesterday', -1],
        ] as const) {
            assert.equal(
                emit(operator, undefined, dateField),
                guard(
                    `DATESTR({fld_text}) = DATESTR(DATEADD(TODAY(), ${offset}, "days"))`
                )
            );
        }
        assert.equal(
            emit('isBeforeToday', undefined, dateField),
            guard('IS_BEFORE(DATESTR({fld_text}), DATESTR(TODAY()))')
        );
        assert.equal(
            emit('isAfterToday', undefined, dateField),
            guard('IS_AFTER(DATESTR({fld_text}), DATESTR(TODAY()))')
        );
    });

    it('preserves nested OR, empty groups and strict exception handling for malformed persisted definitions', () => {
        const nested: RuntimeConditionsDefinition = {
            logicalOperator: 'or',
            conditions: [
                {
                    id: 'nested',
                    type: 'groupCondition',
                    ...group(alpha, alpha),
                },
                {
                    id: 'empty',
                    type: 'groupCondition',
                    logicalOperator: 'and',
                    conditions: [],
                },
                ...group(alpha).conditions,
            ],
        };
        assert.equal(
            compileSelectCompatibilityConditions(nested, [select]),
            "OR(AND({fld_select} = 'Alpha', {fld_select} = 'Alpha'), {fld_select} = 'Alpha')"
        );
        assert.equal(
            compileSelectCompatibilityConditions(nested, [select], {
                failClosedOnInvalidCondition: true,
            }),
            'FALSE()'
        );
        assert.equal(
            compileSelectCompatibilityConditions(
                { logicalOperator: 'or', conditions: [] },
                []
            ),
            '1'
        );
        const invalid = group(savedSetting('unrecognized'));
        assert.throws(
            () => compileSelectCompatibilityConditions(invalid, [text]),
            /Unexpected:/
        );
        assert.equal(
            compileSelectCompatibilityConditions(invalid, [text], {
                failClosedOnInvalidCondition: true,
            }),
            'FALSE()'
        );
        const invalidGroup = {
            ...group(alpha, alpha),
            logicalOperator: 'unrecognized',
        } as unknown as RuntimeConditionsDefinition;
        assert.throws(
            () => compileSelectCompatibilityConditions(invalidGroup, [select]),
            /Unexpected:/
        );
    });
});
