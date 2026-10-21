import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const selectProjectionTypedConsumer = `
import {projectSelectChoices as projectNativeChoices,type SelectChoiceProjectionInput as NativeChoicesInput,type SelectChoiceEvaluation as NativeChoiceEvaluation} from '@miniextensions/sdk/ui';
const nativeChoices=[{id:'opt_one',name:'One'},{id:'',name:'Pending Beta'},{id:'',name:'Pending Gamma'}] as const;
type NativeChoice=typeof nativeChoices[number];
const nativeChoiceInput:NativeChoicesInput<NativeChoice>={choices:nativeChoices,selectedValues:['Pending Beta'],getValue:choice=>choice.name,allowedOptionIds:['opt_one'],retainSelected:true,evaluation:{type:'evaluate',matches:choice=>choice.id==='opt_one'}};
const nativeProjection=projectNativeChoices(nativeChoiceInput);const projectedChoices:readonly NativeChoice[]=nativeProjection.choices;void projectedChoices;
// @ts-expect-error native IDs remain strings, including pending empty strings
const numericChoice:NativeChoicesInput<{id:number}>={...nativeChoiceInput,choices:[{id:42}]};
// @ts-expect-error eligibility is synchronous and does not launch requests
const asynchronousChoice:NativeChoiceEvaluation<NativeChoice>={type:'evaluate',matches:async()=>true};
// @ts-expect-error canonical native values are supplied as strings
const numericChoiceValue:NativeChoicesInput<NativeChoice>={...nativeChoiceInput,getValue:()=>42};
void numericChoice;void asynchronousChoice;void numericChoiceValue;
`;

export async function checkSelectChoiceProjectionConsumer({
    consumerDirectory,
}) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/ui/index.js'
            )
        )
    );
    let checks = 0;
    for (const api of [esm, consumer('@miniextensions/sdk/ui')]) {
        const choices = [
            { id: 'opt_one', name: 'One' },
            { id: '', name: 'Pending Beta', newOption: true },
            { id: '', name: 'Pending Gamma', newOption: true },
        ];
        const selected = ['Pending Beta'];
        const visited = [];
        const args = {
            choices,
            selectedValues: selected,
            getValue: (choice) => choice.name,
            allowedOptionIds: ['opt_one'],
            retainSelected: true,
            evaluation: {
                type: 'evaluate',
                matches: (choice) => {
                    visited.push(choice.name);
                    return true;
                },
            },
        };
        const list = api.projectSelectChoices(args);
        assert.deepEqual(list.choices, [choices[0], choices[1]]);
        assert.deepEqual(visited, ['One']);
        assert.equal(list.choices[1], choices[1]);
        assert.equal(list.choices[1].id, '');
        assert.deepEqual(selected, ['Pending Beta']);
        const dropdown = api.projectSelectChoices({
            ...args,
            retainSelected: false,
        });
        assert.deepEqual(dropdown.choices, [choices[0]]);
        assert.deepEqual(selected, ['Pending Beta']);
        const unavailable = api.projectSelectChoices({
            ...args,
            evaluation: { type: 'unavailable' },
        });
        assert.equal(unavailable.status, 'retained-selected');
        assert.deepEqual(unavailable.choices, [choices[1]]);
        const failed = api.projectSelectChoices({
            ...args,
            evaluation: {
                type: 'evaluate',
                matches() {
                    throw Error('private synthetic context');
                },
            },
        });
        assert.equal(failed.status, 'retained-selected');
        assert.equal(failed.reason, 'evaluation-error');
        assert(!JSON.stringify(failed).includes('private synthetic context'));
        const policyField = {
            fieldType: 'singleSelect',
            airtableField: {
                id: 'fld_choices',
                name: 'Choices',
                isComputed: false,
                isPrimaryField: false,
                description: null,
                config: { type: 'singleSelect', options: { choices } },
            },
            miniExtConfig: {},
        };
        assert.throws(
            () => api.getSelectFieldPolicy(policyField),
            /unique IDs and names/
        );
        const evaluator = {
            type: 'evaluate',
            allowed: 'Pending Gamma',
            matches(choice) {
                return choice.name === this.allowed;
            },
        };
        assert.deepEqual(
            api.projectSelectChoices({
                ...args,
                allowedOptionIds: null,
                retainSelected: false,
                evaluation: evaluator,
            }).choices,
            [choices[2]]
        );
        checks++;
    }
    return checks;
}
