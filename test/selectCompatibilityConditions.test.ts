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
