import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const selectPresentationTypedConsumer = `
import {getSelectAddOptionPresentation,type SelectAddOptionPresentation,makeSelectOptionPresentations,getSelectOptionPresentationKey,makeUnavailableSelectOptionPresentation,type SelectOptionPresentation,type SelectPresentationConfig} from '@miniextensions/sdk/ui';
const presentationConfig:SelectPresentationConfig={enableConditionalOptions:true,conditionsForOptions:[{config:{optionForConditions:'',name:'Visible'}}]};
const pendingPresentations:SelectOptionPresentation[]=makeSelectOptionPresentations({choices:[{id:'',name:'Native'}],miniExtFieldConfig:presentationConfig});
const pendingKey:string=getSelectOptionPresentationKey(pendingPresentations[0]!);
const unavailablePresentation:SelectOptionPresentation=makeUnavailableSelectOptionPresentation('Archived');
// @ts-expect-error native choice names remain strings
makeSelectOptionPresentations({choices:[{id:'',name:1}]});
// @ts-expect-error presentation keys require canonical native identity
getSelectOptionPresentationKey({id:'',displayName:'Visible'});
const addPresentation:SelectAddOptionPresentation=getSelectAddOptionPresentation({options:pendingPresentations,searchTerm:' visible ',resultCount:0,allowAddingNewOptions:true,hasAddOptionCallback:true,getOptionTextValues:option=>[option.canonicalName,option.displayName]});
void addPresentation;void pendingKey;void unavailablePresentation;
`;

export async function checkSelectPresentationConsumer({ consumerDirectory }) {
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
        const choices = Object.freeze([
            Object.freeze({ id: '', name: 'A😀\ud800' }),
            Object.freeze({ id: '', name: 'Review' }),
        ]);
        const options = api.makeSelectOptionPresentations({
            choices,
            miniExtFieldConfig: {
                enableConditionalOptions: true,
                conditionsForOptions: [
                    { config: { optionForConditions: '', name: ' Inspect ' } },
                ],
            },
        });
        assert.deepEqual(options, [
            {
                id: '',
                canonicalName: 'A😀\ud800',
                displayName: 'Inspect (A😀\ud800)',
            },
            {
                id: '',
                canonicalName: 'Review',
                displayName: 'Inspect (Review)',
            },
        ]);
        assert.equal(
            api.getSelectOptionPresentationKey(options[0]),
            'pending-0041d83dde00d800'
        );
        assert.equal(
            api.getSelectOptionPresentationKey({
                ...options[0],
                id: choices[0].name,
            }),
            'id-0041d83dde00d800'
        );
        assert.equal(choices[0].id, '');
        const field = {
            fieldType: 'singleSelect',
            airtableField: {
                id: 'field',
                name: 'Priority',
                config: { type: 'singleSelect', options: { choices } },
            },
        };
        assert.throws(
            () => api.getSelectFieldPolicy(field),
            /unique IDs and names/
        );
        assert.deepEqual(
            api.makeUnavailableSelectOptionPresentation('Archived'),
            {
                id: 'unavailable:Archived',
                canonicalName: 'Archived',
                displayName: 'Archived',
            }
        );
        assert.deepEqual(
            api.getSelectAddOptionPresentation({
                options,
                searchTerm: ' inspect (review) ',
                resultCount: 0,
                allowAddingNewOptions: true,
                hasAddOptionCallback: true,
                getOptionTextValues: (option) => [
                    option.canonicalName,
                    option.displayName,
                ],
            }),
            {
                kind: 'no-results',
                searchTerm: 'inspect (review)',
                showSeparator: false,
            }
        );
        assert.deepEqual(
            api.getSelectAddOptionPresentation({
                options: [],
                searchTerm: ' New ',
                resultCount: 2,
                allowAddingNewOptions: true,
                hasAddOptionCallback: true,
            }),
            { kind: 'add', searchTerm: 'New', showSeparator: true }
        );
        groups++;
    }
    return groups;
}
