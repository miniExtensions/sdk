import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    getSelectOptionPresentationKey,
    makeSelectOptionPresentations,
    makeUnavailableSelectOptionPresentation,
} from '../src/ui/selectPresentation.js';
import { getSelectFieldPolicy } from '../src/ui/selectPolicy.js';
import type { RuntimeFieldSchema } from '../src/runtime/types.js';

it('retains pending native identity and distinguishes configured labels without mutating choices', () => {
    const choices = Object.freeze([
        Object.freeze({ id: '', name: 'Research' }),
        Object.freeze({ id: '', name: 'Review' }),
        Object.freeze({ id: 'published', name: 'Ready' }),
    ]);
    const options = makeSelectOptionPresentations({
        choices,
        miniExtFieldConfig: {
            enableConditionalOptions: true,
            conditionsForOptions: [
                {
                    config: {
                        optionForConditions: '',
                        name: '  Investigate  ',
                    },
                },
                {
                    config: {
                        optionForConditions: '',
                        name: 'Ignored later rule',
                    },
                },
                { config: { optionForConditions: 'published', name: '  ' } },
            ],
        },
    });
    assert.deepEqual(options, [
        {
            id: '',
            canonicalName: 'Research',
            displayName: 'Investigate (Research)',
        },
        {
            id: '',
            canonicalName: 'Review',
            displayName: 'Investigate (Review)',
        },
        { id: 'published', canonicalName: 'Ready', displayName: 'Ready' },
    ]);
    options[0]!.canonicalName = 'Local mutation';
    assert.equal(choices[0]!.name, 'Research');
    assert.equal(choices[0]!.id, '');
});

it('keeps disabled custom names, whitespace, literal markup and canonical collision suffixes', () => {
    const choices = [
        { id: '', name: '  native name  ' },
        { id: 'a', name: '<img src=x>' },
        { id: 'b', name: 'Review' },
    ];
    assert.deepEqual(
        makeSelectOptionPresentations({ choices }).map(
            (option) => option.displayName
        ),
        choices.map((choice) => choice.name)
    );
    assert.deepEqual(
        makeSelectOptionPresentations({
            choices,
            miniExtFieldConfig: {
                enableConditionalOptions: false,
                conditionsForOptions: [
                    { config: { optionForConditions: 'a', name: 'Wrong' } },
                ],
            },
        }).map((option) => option.displayName),
        choices.map((choice) => choice.name)
    );
    assert.deepEqual(makeSelectOptionPresentations({ choices: [] }), []);
});

it('uses separate UTF-16 DOM key namespaces through pending-to-published reconciliation', () => {
    const pending = {
        id: '',
        canonicalName: 'A😀\ud800',
        displayName: 'Visible',
    };
    assert.equal(
        getSelectOptionPresentationKey(pending),
        'pending-0041d83dde00d800'
    );
    const published = { ...pending, id: pending.canonicalName };
    assert.equal(
        getSelectOptionPresentationKey(published),
        'id-0041d83dde00d800'
    );
    assert.equal(
        getSelectOptionPresentationKey({
            ...pending,
            displayName: 'Translated',
        }),
        getSelectOptionPresentationKey(pending)
    );
    assert.notEqual(
        getSelectOptionPresentationKey({ ...pending, canonicalName: 'Other' }),
        getSelectOptionPresentationKey(pending)
    );
    assert.deepEqual(makeUnavailableSelectOptionPresentation('<Unavailable>'), {
        id: 'unavailable:<Unavailable>',
        canonicalName: '<Unavailable>',
        displayName: '<Unavailable>',
    });
});

it('does not relax strict published select policy to admit pending metadata', () => {
    const choices = [{ id: '', name: 'Research' }];
    const schema = {
        fieldType: 'singleSelect',
        airtableField: {
            id: 'field',
            name: 'Priority',
            config: {
                type: 'singleSelect',
                options: { choices },
            },
        },
    } as RuntimeFieldSchema;
    assert.throws(() => getSelectFieldPolicy(schema), /unique IDs and names/);
    assert.equal(
        makeSelectOptionPresentations({
            choices,
        })[0]!.id,
        ''
    );
});
