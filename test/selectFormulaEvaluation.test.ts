import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createSelectFormulaEvaluation,
    createSelectConditionEvaluation,
} from '../src/ui/selectFormulaEvaluation.js';
import type { InterpreterContext } from '../src/formulas/interpreter/interpreter.js';

const context: InterpreterContext = {
    record: { id: 'rec_original', fields: {} },
    airtableFields: [],
    linkedTableLoadingStates: {},
};
describe('portable Select formula evaluation', () => {
    it('keeps skip and unavailable distinct without compiling', () => {
        const formulaForChoice = () => {
            throw new Error('must stay lazy');
        };
        assert.equal(
            createSelectFormulaEvaluation({
                enabled: false,
                context,
                formulaForChoice,
            }).type,
            'skip'
        );
        assert.equal(
            createSelectFormulaEvaluation({
                enabled: true,
                readOnly: true,
                context,
                formulaForChoice,
            }).type,
            'skip'
        );
        assert.equal(
            createSelectFormulaEvaluation({
                enabled: true,
                context: null,
                formulaForChoice,
            }).type,
            'unavailable'
        );
    });
    it('executes lazily against the original record identity and propagates compiler errors', () => {
        const visited: string[] = [];
        const result = createSelectFormulaEvaluation({
            enabled: true,
            context,
            formulaForChoice(choice: string) {
                visited.push(choice);
                if (choice === 'bad') throw new Error('compile failed');
                return "RECORD_ID() = 'rec_original'";
            },
        });
        assert.deepEqual(visited, []);
        assert.equal(result.type, 'evaluate');
        if (result.type !== 'evaluate') throw new Error('missing evaluator');
        assert.equal(result.matches('good'), true);
        assert.throws(() => result.matches('bad'), /compile failed/);
        assert.deepEqual(visited, ['good', 'bad']);
    });
    it('distinguishes empty linked state from all-loading without eager conversion', () => {
        const linkedContext: InterpreterContext = {
            record: context.record,
            airtableFields: [
                {
                    id: 'fld_link',
                    name: 'Links',
                    config: {
                        type: 'multipleRecordLinks',
                        options: { linkedTableId: 'tbl_link' },
                    },
                },
            ],
            linkedTableLoadingStates: {},
        };
        let converted = 0;
        const result = createSelectFormulaEvaluation({
            enabled: true,
            context: linkedContext,
            formulaForChoice: () => "{fld_link} = 'linked'",
            interpreterOptions: {
                resolveFieldReference: () => ({
                    nativeValue: 'linked',
                    toPrimitive: () => {
                        converted += 1;
                        return 'linked';
                    },
                }),
            },
        });
        if (result.type !== 'evaluate') throw new Error('missing evaluator');
        assert.equal(result.matches(null), true);
        assert.equal(converted, 1);
        linkedContext.linkedTableLoadingStates = {
            tbl_link: { type: 'loading' },
        };
        assert.equal(result.matches(null), false);
        assert.equal(converted, 1);
        linkedContext.linkedTableLoadingStates = {
            tbl_link: { type: 'notLoaded' },
        };
        assert.equal(result.matches(null), true);
        assert.equal(converted, 2);
    });
    it('throws an unknown field only when its option is visited', () => {
        const result = createSelectFormulaEvaluation({
            enabled: true,
            context,
            formulaForChoice: () => '{missing}',
        });
        if (result.type !== 'evaluate') throw new Error('missing evaluator');
        assert.throws(() => result.matches(null), /Unknown field missing/);
    });

    it('does not match an absent rule target to a pending blank choice ID', () => {
        const result = createSelectConditionEvaluation({
            enabled: true,
            context,
            conditionFields: [],
            rules: [
                {
                    optionId: undefined,
                    conditions: {
                        logicalOperator: 'and',
                        conditions: [
                            {
                                id: 'rule',
                                type: 'singleCondition',
                                setting: {
                                    type: 'is',
                                    fieldType: 'singleLineText',
                                    idOrName: { type: 'id', id: 'missing' },
                                    value: 'x',
                                },
                            },
                        ],
                    },
                },
            ],
        });
        if (result.type !== 'evaluate') throw new Error('missing evaluator');
        assert.equal(result.matches({ id: '' }), true);
    });
});
