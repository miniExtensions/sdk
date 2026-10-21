import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const dropdownFilterTypedConsumer = `
import {getFiltersAfterDropdownChange,type DropdownFilterChangeInput} from '@miniextensions/sdk/ui';
import type {RuntimeConditionsDefinition} from '@miniextensions/sdk';
const dropdownFilterInput:DropdownFilterChangeInput={airtableFields:[{id:'status',name:'Status'}],conditionsDefinition:null,dropdownCondition:{id:'replacement',type:'singleCondition',setting:{type:'is',fieldType:'singleSelect',idOrName:{type:'id',id:'status'},value:'selected'}},fieldId:'status'};
const nextDropdownFilters:RuntimeConditionsDefinition=getFiltersAfterDropdownChange(dropdownFilterInput);
// @ts-expect-error native target field identity remains a string
getFiltersAfterDropdownChange({...dropdownFilterInput,fieldId:1});
// @ts-expect-error the replacement is one explicit predicate, not a group
getFiltersAfterDropdownChange({...dropdownFilterInput,dropdownCondition:{id:'group',type:'groupCondition',logicalOperator:'and',conditions:[]}});
void nextDropdownFilters;
`;

export async function checkDropdownFilterConsumer({ consumerDirectory }) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/ui/index.js'
            )
        )
    );
    let groups = 0;
    for (const api of [esm, consumer('@miniextensions/sdk/ui')]) {
        const predicate = (id, reference) => ({
            id,
            type: 'singleCondition',
            setting: {
                fieldType: 'singleSelect',
                type: 'is',
                idOrName: reference,
                value: 'selected',
            },
        });
        const stale = predicate('stale', { type: 'name', name: 'Deleted' });
        const retained = predicate('other', { type: 'id', id: 'other' });
        const replacement = predicate('new', { type: 'id', id: 'status' });
        const original = {
            logicalOperator: 'or',
            conditions: [
                predicate('old', { type: 'name', name: 'Status' }),
                {
                    id: 'mixed',
                    type: 'groupCondition',
                    logicalOperator: 'and',
                    conditions: [
                        predicate('nested', { type: 'id', id: 'status' }),
                        retained,
                    ],
                },
                stale,
                {
                    id: 'empty',
                    type: 'groupCondition',
                    logicalOperator: 'and',
                    conditions: [],
                },
            ],
        };
        const before = structuredClone(original);
        const next = api.getFiltersAfterDropdownChange({
            airtableFields: [{ id: 'status', name: 'Status' }],
            conditionsDefinition: original,
            dropdownCondition: replacement,
            fieldId: 'status',
        });
        assert.deepEqual(next, {
            logicalOperator: 'or',
            conditions: [
                replacement,
                {
                    id: 'mixed',
                    type: 'groupCondition',
                    logicalOperator: 'and',
                    conditions: [retained],
                },
                stale,
            ],
        });
        assert.deepEqual(original, before);
        assert.equal(next.conditions[2], stale);
        assert.equal(next.conditions[1].conditions[0], retained);
        assert.deepEqual(
            api.getFiltersAfterDropdownChange({
                airtableFields: [],
                conditionsDefinition: null,
                dropdownCondition: null,
                fieldId: 'status',
            }),
            { logicalOperator: 'and', conditions: [] }
        );
        groups++;
    }
    return groups;
}
