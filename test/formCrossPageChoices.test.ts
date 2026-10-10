import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { formChoiceConditionRecord } from '../src/forms/choiceRecord.js';
import { createFormPageOwner } from '../src/forms/pages.js';
import { resolveSelectFieldAvailability } from '../src/ui/selectAvailability.js';
import {
    createMiniExtensionsClient,
    type RuntimeFieldSchema,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions } from './formsFixtures.js';

const rule = {
    logicalOperator: 'and' as const,
    conditions: [
        {
            id: 'driver_allowed',
            type: 'singleCondition' as const,
            setting: {
                type: 'contains' as const,
                fieldType: 'singleLineText' as const,
                idOrName: { type: 'id' as const, id: 'driver' },
                value: 'allowed',
            },
        },
    ],
};
const make = (multiple: boolean) => {
    const loaded = loadedForm();
    const driver: RuntimeFieldSchema = {
        fieldType: 'singleLineText',
        airtableField: {
            id: 'driver',
            name: 'Driver',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'singleLineText', options: null },
        },
        miniExtConfig: {
            headerSectionTitle: 'First',
            enableSectionHeader: true,
        },
    };
    const type = multiple ? 'multipleSelects' : 'singleSelect';
    const choice: RuntimeFieldSchema = {
        fieldType: type,
        airtableField: {
            id: 'choice',
            name: 'Choice',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type,
                options: {
                    choices: [
                        {
                            id: 'sel_always',
                            name: 'Always',
                            color: 'blueLight2',
                        },
                        {
                            id: 'sel_allowed',
                            name: 'Allowed',
                            color: 'blueLight2',
                        },
                    ],
                },
            },
        },
        miniExtConfig: {
            headerSectionTitle: 'Second',
            enableSectionHeader: true,
            enableConditionalOptions: true,
            conditionsForOptions: [
                {
                    id: 'rule_allowed',
                    config: {
                        optionForConditions: 'sel_allowed',
                        conditionsForOption: rule,
                    },
                },
            ],
        },
    } as RuntimeFieldSchema;
    loaded.payload.fieldIdsInForm = ['driver', 'choice'];
    loaded.payload.fieldIdsToSchemas = { driver, choice };
    loaded.payload.formRecord = {
        type: 'create',
        data: {
            driver: 'allowed',
            choice: multiple ? ['Allowed'] : 'Allowed',
            unrendered: { text: 'Full native value' },
        },
    };
    loaded.payload.formFieldIdsWithUnsavedChanges = ['unrendered'];
    loaded.payload.urlPrefilledFieldIds = [];
    Object.assign(loaded.payload.publicFields.state, {
        multiPageFormMode: 'multi-page',
        promptUserBeforeSubmission: false,
        enableFormComputeMode: false,
        autoSubmitAfterPrefill: false,
    });
    return loaded;
};

describe('cross-page scalar conditional choices', () => {
    it('binds the local canonical oracle and all twenty source cases', () => {
        const fixture = JSON.parse(
            readFileSync('test/fixtures/crossPageChoices.json', 'utf8')
        );
        const sha256 = (file: string) =>
            createHash('sha256').update(readFileSync(file)).digest('hex');
        assert.equal(
            fixture.provenance.revision,
            '58f73d575ab10baa0a10693660d8002f204368e1'
        );
        assert.equal(
            fixture.provenance.tree,
            'b39e58ead46a311c497def57474cf5ca720542ae'
        );
        assert.equal(
            fixture.provenance.generatorSha256,
            sha256(fixture.provenance.generator)
        );
        assert.equal(
            fixture.provenance.casesSourceSha256,
            sha256('test/fixtures/crossPageChoicesCases.mjs')
        );
        assert.equal(
            fixture.provenance.casesHelpersSourceSha256,
            sha256('test/fixtures/conditionalPageValidationCases.mjs')
        );
        assert.equal(fixture.choices.length, 20);
        assert.equal(
            new Set(fixture.choices.map((item: { name: string }) => item.name))
                .size,
            20
        );
        for (const type of ['singleSelect', 'multipleSelects']) {
            assert.equal(
                fixture.choices.filter((item: { name: string }) =>
                    item.name.startsWith(`${type}/`)
                ).length,
                10
            );
        }
        for (const item of fixture.choices)
            assert.deepEqual(item.canonical.nativeData, item.data);
    });
    for (const multiple of [false, true]) {
        it(`${multiple ? 'multiple' : 'single'} retains native values while Back/edit/Next changes eligible choices`, () => {
            const loaded = make(multiple);
            const before = structuredClone(loaded.payload.formRecord.data);
            const client = createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    throw Error('No implicit request');
                },
            });
            const fields = createFormFieldBindings({
                client,
                loaded,
                saveOptions: formSaveOptions(),
                getScope: () => ({ ownerId: 'A', revision: 0 }),
            });
            const pages = createFormPageOwner({
                fields,
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            try {
                const selection = fields.field('choice').selection!;
                assert.deepEqual(
                    selection.getState().options.map((option) => option.value),
                    ['Always', 'Allowed']
                );
                assert.equal(
                    pages.next(pages.getSnapshot().revision).accepted,
                    true
                );
                assert.equal(pages.getSnapshot().activePageIndex, 1);
                assert.equal(
                    pages.back(pages.getSnapshot().revision).accepted,
                    true
                );
                assert.equal(
                    fields.field('driver').setValue('denied').accepted,
                    true
                );
                assert.equal(
                    pages.next(pages.getSnapshot().revision).accepted,
                    true
                );
                assert.deepEqual(
                    selection.getState().options.map((option) => option.value),
                    ['Always']
                );
                assert.deepEqual(
                    fields.field('choice').getSnapshot().value,
                    before.choice
                );
                assert.deepEqual(fields.controller.getState().draft?.data, {
                    ...before,
                    driver: 'denied',
                });
            } finally {
                pages.dispose();
                fields.destroy();
            }
        });
    }

    it('retains one-page equivalence and refuses unknown page modes', () => {
        const loaded = make(false);
        const choice = loaded.payload.fieldIdsToSchemas.choice!;
        const get = () =>
            formChoiceConditionRecord(
                loaded,
                choice,
                loaded.payload.formRecord.data
            );
        const multipage = get();
        assert.ok(multipage);
        loaded.payload.publicFields.state.multiPageFormMode = 'one-page';
        assert.deepEqual(get(), multipage);
        loaded.payload.publicFields.state.multiPageFormMode =
            'unknown' as never;
        assert.equal(get(), null);
    });

    it('admits a direct select driver with deleted operands without pruning native values', () => {
        const loaded = make(true);
        const choice = loaded.payload.fieldIdsToSchemas.choice!;
        const config = choice.miniExtConfig;
        assert.ok(config && 'conditionsForOptions' in config);
        config.conditionsForOptions![0]!.config!.conditionsForOption = {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'select_driver',
                    type: 'singleCondition',
                    setting: {
                        type: 'isExactly',
                        fieldType: 'multipleSelects',
                        idOrName: { type: 'id', id: 'choice' },
                        value: ['missing_choice'],
                    },
                },
            ],
        };
        const record = formChoiceConditionRecord(
            loaded,
            choice,
            loaded.payload.formRecord.data
        );
        assert.deepEqual(record, {
            id: '',
            fields: loaded.payload.formRecord.data,
        });
        assert.equal(
            resolveSelectFieldAvailability({
                field: choice,
                airtableFields: Object.values(
                    loaded.payload.fieldIdsToSchemas
                ).map((schema) => schema.airtableField),
                recordForConditionEvaluation: record,
                mode: 'runtime',
                invalidConditionMode: 'compatibility',
            }).status,
            'ready'
        );
        assert.deepEqual(loaded.payload.formRecord.data.choice, ['Allowed']);
    });
});
