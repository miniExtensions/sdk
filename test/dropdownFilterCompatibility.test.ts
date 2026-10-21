import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    getFiltersAfterDropdownChange,
    type DropdownFilterChangeInput,
} from '../src/ui/dropdownFilterCompatibility.js';
import type { RuntimeConditionItem } from '../src/runtime/types.js';

const predicate = (
    id: string,
    reference: { type: 'id'; id: string } | { type: 'name'; name: string }
) => ({
    id,
    type: 'singleCondition' as const,
    setting: {
        fieldType: 'singleSelect' as const,
        type: 'is' as const,
        idOrName: reference,
        value: 'sel_active',
    },
});
const fields = [
    { id: 'status', name: 'Status' },
    { id: 'other', name: 'Other' },
];

it('replaces every target predicate across nested groups and preserves other logic without mutation', () => {
    const keep = predicate('keep', { type: 'id', id: 'other' });
    const replacement = predicate('new', { type: 'id', id: 'status' });
    const definition: NonNullable<
        DropdownFilterChangeInput['conditionsDefinition']
    > = {
        logicalOperator: 'or',
        conditions: [
            predicate('old', { type: 'id', id: 'status' }),
            {
                id: 'mixed',
                type: 'groupCondition',
                logicalOperator: 'and',
                conditions: [
                    predicate('named', { type: 'name', name: 'Status' }),
                    keep,
                ],
            },
            {
                id: 'empty-after',
                type: 'groupCondition',
                logicalOperator: 'or',
                conditions: [predicate('nested', { type: 'id', id: 'status' })],
            },
        ],
    };
    const original = structuredClone(definition);
    const result = getFiltersAfterDropdownChange({
        airtableFields: fields,
        conditionsDefinition: definition,
        dropdownCondition: replacement,
        fieldId: 'status',
    });
    assert.deepEqual(result, {
        logicalOperator: 'or',
        conditions: [
            replacement,
            {
                id: 'mixed',
                type: 'groupCondition',
                logicalOperator: 'and',
                conditions: [keep],
            },
        ],
    });
    assert.deepEqual(definition, original);
    assert.equal(result.conditions[0], replacement);
    assert.equal(
        (
            result.conditions[1] as Extract<
                RuntimeConditionItem,
                { type: 'groupCondition' }
            >
        ).conditions[0],
        keep
    );
});

it('clears one field while retaining unresolved predicates and unrelated groups', () => {
    const stale = predicate('stale', { type: 'name', name: 'Deleted field' });
    const byId = predicate('stale-id', { type: 'id', id: 'deleted' });
    const group = {
        id: 'retained',
        type: 'groupCondition' as const,
        logicalOperator: 'or' as const,
        conditions: [stale, byId],
    };
    const result = getFiltersAfterDropdownChange({
        airtableFields: fields,
        conditionsDefinition: {
            logicalOperator: 'and',
            conditions: [
                predicate('remove', { type: 'id', id: 'status' }),
                group,
            ],
        },
        dropdownCondition: null,
        fieldId: 'status',
    });
    assert.deepEqual(result.conditions, [group]);
    assert.equal((result.conditions[0] as typeof group).conditions[0], stale);
});

it('keeps exact first-name resolution and field-ID precedence', () => {
    const named = predicate('named', { type: 'name', name: 'Status' });
    const exactId = predicate('id', { type: 'id', id: 'status' });
    const result = getFiltersAfterDropdownChange({
        airtableFields: [{ id: 'first', name: 'Status' }, ...fields],
        conditionsDefinition: {
            logicalOperator: 'and',
            conditions: [named, exactId],
        },
        dropdownCondition: null,
        fieldId: 'status',
    });
    assert.deepEqual(result.conditions, [named]);
});

it('creates an empty default or explicit replacement without adding evaluation effects', () => {
    const args: DropdownFilterChangeInput = {
        airtableFields: [],
        conditionsDefinition: null,
        dropdownCondition: null,
        fieldId: 'status',
    };
    assert.deepEqual(getFiltersAfterDropdownChange(args), {
        logicalOperator: 'and',
        conditions: [],
    });
    const replacement = predicate('replacement', { type: 'id', id: 'status' });
    assert.deepEqual(
        getFiltersAfterDropdownChange({
            ...args,
            dropdownCondition: replacement,
        }),
        { logicalOperator: 'and', conditions: [replacement] }
    );
});
