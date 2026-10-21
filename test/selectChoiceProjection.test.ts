import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    projectSelectChoices,
    getSelectFieldPolicy,
    type SelectChoiceProjectionInput,
} from '../src/ui/index.js';
import FormulaRunner from '../src/formulas/index.js';
import {
    AirtableFieldType,
    type RuntimeAirtableField,
    type RuntimeFieldSchema,
} from '../src/runtime/index.js';

const choices = [
    { id: 'opt_alpha', name: 'Alpha', nativeHint: 'retain-native-metadata' },
    { id: '', name: 'Draft Beta', newOption: true },
    { id: '', name: 'Draft Gamma', newOption: true },
];
const base: SelectChoiceProjectionInput<(typeof choices)[number]> = {
    choices,
    selectedValues: [],
    getValue: (choice) => choice.name,
    allowedOptionIds: null,
    retainSelected: false,
    evaluation: { type: 'skip' },
};

it('keeps native object/array identity, order and independent pending empty IDs without creating published metadata', () => {
    const result = projectSelectChoices(base);
    assert.equal(result.status, 'ready');
    assert.equal(result.choices, choices);
    assert.equal(result.choices[1], choices[1]);
    assert.equal(result.choices[2], choices[2]);
    assert.equal(result.choices[1]!.id, '');
    assert.notEqual(result.choices[1]!.name, result.choices[2]!.name);
});
it('applies limits but retains selected list choices and bypasses their condition callback', () => {
    const visited: string[] = [];
    const result = projectSelectChoices({
        ...base,
        allowedOptionIds: ['opt_alpha'],
        selectedValues: ['Draft Beta'],
        retainSelected: true,
        evaluation: {
            type: 'evaluate',
            matches: (choice) => {
                visited.push(choice.name);
                return true;
            },
        },
    });
    assert.deepEqual(result.choices, [choices[0], choices[1]]);
    assert.deepEqual(visited, ['Alpha']);
});
it('filters dropdown eligibility without clearing a selected native value outside the available choices', () => {
    const selected = ['Draft Beta'];
    const result = projectSelectChoices({
        ...base,
        selectedValues: selected,
        allowedOptionIds: ['opt_alpha'],
        evaluation: { type: 'evaluate', matches: () => true },
    });
    assert.deepEqual(result.choices, [choices[0]]);
    assert.deepEqual(selected, ['Draft Beta']);
    assert.equal(choices[1]!.id, '');
});
it('retains full selected choices outside limits while evaluation is unavailable', () => {
    const result = projectSelectChoices({
        ...base,
        allowedOptionIds: ['opt_alpha'],
        selectedValues: ['Draft Beta', 'Draft Gamma'],
        evaluation: { type: 'unavailable' },
    });
    assert.equal(result.status, 'retained-selected');
    assert.deepEqual(result.choices, [choices[1], choices[2]]);
    assert.equal(
        result.status === 'retained-selected' && result.reason,
        'unavailable-evaluation'
    );
});
it('returns an explicit safe fallback on evaluator failure without returning private exception contents', () => {
    const result = projectSelectChoices({
        ...base,
        selectedValues: ['Draft Gamma'],
        evaluation: {
            type: 'evaluate',
            matches() {
                throw Error('private synthetic context');
            },
        },
    });
    assert.equal(result.status, 'retained-selected');
    assert.equal(
        result.status === 'retained-selected' && result.reason,
        'evaluation-error'
    );
    assert.deepEqual(result.choices, [choices[2]]);
    assert(!JSON.stringify(result).includes('private synthetic context'));
});
it('uses the actual hydrated FormulaRunner context without rewriting linked IDs or selected choices', () => {
    const linkedField = {
        id: 'fld_links',
        name: 'Links',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
            options: {
                linkedTableId: 'tbl_links',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
    } satisfies RuntimeAirtableField;
    const primary = {
        id: 'fld_primary',
        name: 'Name',
        description: null,
        isComputed: false,
        isPrimaryField: true,
        config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
    } satisfies RuntimeAirtableField;
    const record = {
        id: 'recbbbbbbbbbbbbbb',
        fields: { fld_links: ['recaaaaaaaaaaaaaa'] },
    };
    const linkedRecord = {
        id: 'recaaaaaaaaaaaaaa',
        fields: { fld_primary: 'Approved region' },
    };
    const runner = new FormulaRunner("REGEX_MATCH({fld_links}, 'Approved')");
    const evaluate = () => {
        runner.context = {
            record,
            airtableFields: [linkedField],
            linkedTableLoadingStates: {
                tbl_links: {
                    type: 'loaded',
                    data: {
                        state: {
                            airtableFields: [primary],
                            recordIdsToAirtableRecords: {
                                [linkedRecord.id]: linkedRecord,
                            },
                        },
                    },
                },
            },
        };
        return !FormulaRunner.isFalsyValue(runner.run());
    };
    const input = {
        ...base,
        evaluation: { type: 'evaluate' as const, matches: evaluate },
    };
    assert.deepEqual(projectSelectChoices(input).choices, choices);
    linkedRecord.fields.fld_primary = 'Denied region';
    assert.deepEqual(projectSelectChoices(input).choices, []);
    assert.deepEqual(record.fields.fld_links, ['recaaaaaaaaaaaaaa']);
});
it('does not weaken canonical published choice metadata guards for pending native choices', () => {
    const field = {
        fieldType: AirtableFieldType.SINGLE_SELECT,
        airtableField: {
            id: 'fld_choices',
            name: 'Choices',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: AirtableFieldType.SINGLE_SELECT,
                options: { choices },
            },
        },
        miniExtConfig: {},
    } satisfies RuntimeFieldSchema;
    assert.throws(() => getSelectFieldPolicy(field), /unique IDs and names/);
    assert.equal(projectSelectChoices(base).choices, choices);
});

it('calls a real evaluator method with its own current state intact', () => {
    const evaluation = {
        type: 'evaluate' as const,
        allowed: 'Alpha',
        matches(choice: (typeof choices)[number]): boolean {
            return choice.name === this.allowed;
        },
    };
    assert.deepEqual(projectSelectChoices({ ...base, evaluation }).choices, [
        choices[0],
    ]);
    evaluation.allowed = 'Draft Gamma';
    assert.deepEqual(projectSelectChoices({ ...base, evaluation }).choices, [
        choices[2],
    ]);
});
