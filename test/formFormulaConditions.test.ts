import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    compileRuntimeConditions,
    createFlatScalarFormRecordProjection,
    createFormFieldBindings,
    createScalarFormRecordProjection,
    describeLoadedFormFields,
    evaluateFormFieldVisibility,
} from '../src/forms/index.js';
import { createFormConditionRecordProjection } from '../src/forms/projection.js';
import { validatePageField } from '../src/forms/pageValidation.js';
import { resolveSelectFieldAvailability } from '../src/ui/selectAvailability.js';
import { evaluatePortalViewAvailability } from '../src/portals/index.js';
import {
    createMiniExtensionsClient,
    type AirtableValue,
    type RuntimeAirtableField,
    type RuntimeConditionsDefinition,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, invalidForm } from './formsFixtures.js';
import { portalPage } from './portalFixtures.js';

type ResultType = 'number' | 'percent' | 'currency' | 'singleLineText';
type TextSchema = Extract<RuntimeFieldSchema, { fieldType: 'singleLineText' }>;
const text = (
    id: string,
    miniExtConfig: TextSchema['miniExtConfig'] = {}
): TextSchema => ({
    fieldType: 'singleLineText',
    airtableField: {
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'singleLineText', options: null },
    },
    miniExtConfig,
});
const formula = (type: ResultType): RuntimeAirtableField =>
    ({
        ...text('formula').airtableField,
        name: 'Accepted formula',
        isComputed: true,
        config: {
            type: 'formula',
            options: {
                isValid: true,
                result: {
                    type,
                    options:
                        type === 'singleLineText'
                            ? null
                            : type === 'currency'
                              ? { precision: 2, symbol: '' }
                              : { precision: 2 },
                },
            },
        },
    }) as RuntimeAirtableField;
const rule = (
    fieldType: string,
    type: string,
    value?: unknown,
    reference: unknown = { type: 'id', id: 'formula' }
): RuntimeConditionsDefinition =>
    ({
        logicalOperator: 'and',
        conditions: [
            {
                id: 'synthetic-rule',
                type: 'singleCondition',
                setting: {
                    fieldType,
                    type,
                    value,
                    idOrName: reference,
                },
            },
        ],
    }) as RuntimeConditionsDefinition;
const evaluate = (
    driver: RuntimeAirtableField,
    definition: RuntimeConditionsDefinition,
    value?: AirtableValue
) =>
    evaluateFormFieldVisibility({
        field: text('target', { conditionalFields: definition }),
        airtableFields: [driver],
        data: value === undefined ? {} : { formula: value },
        formRecordType: 'edit',
        evaluationMode: 'runtime',
        invalidConditionMode: 'strict',
    });

describe('accepted Formula scalar conditions in Form workflows', () => {
    for (const type of ['number', 'percent', 'currency'] as const) {
        const scale = type === 'percent' ? 100 : 1;
        for (const [operator, yes, no] of [
            ['equals', 5, 4],
            ['notEquals', 4, 5],
            ['greaterThan', 6, 5],
            ['lessThan', 4, 5],
            ['greaterThanOrEqualsTo', 5, 4],
            ['lessThanOrEqualsTo', 5, 6],
            ['isEmpty', null, 0],
            ['isNotEmpty', 0, null],
        ] as const) {
            it(`matches canonical ${type}/${operator} true and false results`, () => {
                const definition = rule(type, operator, 5 * scale);
                assert.equal(
                    evaluate(formula(type), definition, yes).type,
                    'visible'
                );
                assert.equal(
                    evaluate(formula(type), definition, no).type,
                    'hidden'
                );
            });
        }
    }
    for (const [operator, operand, yes, no] of [
        ['matchesRegex', '^ready', 'ready now', 'waiting'],
        ['is', 'ready', 'ready', 'waiting'],
        ['isNot', 'ready', 'waiting', 'ready'],
        ['contains', 'ready', 'READY now', 'waiting'],
        ['doesNotContain', 'ready', 'waiting', 'ready'],
        ['isOfLength', 5, 'ready', 'waiting'],
        ['isEmpty', undefined, '', 'ready'],
        ['isNotEmpty', undefined, 'ready', ''],
    ] as const) {
        it(`matches canonical text/${operator} true and false results`, () => {
            const definition = rule('singleLineText', operator, operand);
            assert.equal(
                evaluate(formula('singleLineText'), definition, yes).type,
                'visible'
            );
            assert.equal(
                evaluate(formula('singleLineText'), definition, no).type,
                'hidden'
            );
        });
    }
    for (const [type, operator, operand, yes, no] of [
        ['number', 'greaterThan', 4, 5, 3],
        ['percent', 'equals', 50, 0.5, 50],
        ['currency', 'equals', 5, 5, 6],
        ['singleLineText', 'contains', 'ready', 'READY now', 'waiting'],
    ] as const) {
        it(`uses the accepted ${type} result for true and false conditions`, () => {
            const driver = formula(type),
                definition = rule(type, operator, operand);
            const before = structuredClone({ driver, definition });
            assert.equal(evaluate(driver, definition, yes).type, 'visible');
            assert.equal(evaluate(driver, definition, no).type, 'hidden');
            assert.deepEqual({ driver, definition }, before);
        });
    }
    for (const type of [
        'number',
        'percent',
        'currency',
        'singleLineText',
    ] as const) {
        it(`preserves ${type} null/missing/zero or empty semantics`, () => {
            const driver = formula(type),
                empty = rule(type, 'isEmpty');
            assert.equal(evaluate(driver, empty).type, 'visible');
            assert.equal(evaluate(driver, empty, null).type, 'visible');
            assert.equal(
                evaluate(driver, empty, type === 'singleLineText' ? '' : 0)
                    .type,
                type === 'singleLineText' ? 'visible' : 'hidden'
            );
        });
    }
    it('keeps text error-marker strings literal and numeric currency values symbol-free', () => {
        assert.equal(
            evaluate(
                formula('singleLineText'),
                rule('singleLineText', 'is', '#ERROR!'),
                '#ERROR!'
            ).type,
            'visible'
        );
        assert.equal(
            evaluate(formula('currency'), rule('currency', 'equals', 0), 0)
                .type,
            'visible'
        );
    });
    for (const type of [
        'number',
        'percent',
        'currency',
        'singleLineText',
    ] as const) {
        it(`refuses malformed native ${type} results without exposing data`, () => {
            const invalid: AirtableValue[] = [
                [],
                [1],
                {},
                { error: 'private failure' },
                { specialValue: 'Infinity' },
                true,
                ...(type === 'singleLineText' ? [1] : ['5', '', Infinity, NaN]),
            ];
            for (const value of invalid) {
                const result = evaluate(
                    formula(type),
                    rule(type, 'isNotEmpty'),
                    value
                );
                assert.equal(result.type, 'blocked');
                assert.equal(JSON.stringify(result).includes('private'), false);
            }
        });
    }
    it('refuses invalid, richer, nested and contradictory Formula metadata', () => {
        const valid = formula('number');
        const configs = [
            { type: 'formula', options: null },
            {
                type: 'formula',
                options: {
                    isValid: false,
                    result: { type: 'number', options: { precision: 2 } },
                },
            },
            {
                type: 'formula',
                options: {
                    isValid: 'true',
                    result: { type: 'number', options: { precision: 2 } },
                },
            },
            { type: 'formula', options: { isValid: true } },
            { type: 'formula', options: { isValid: true, result: null } },
            { type: 'formula', options: { isValid: true, result: [] } },
            {
                type: 'formula',
                options: { isValid: true, result: { type: 'number' } },
            },
            {
                type: 'formula',
                options: {
                    isValid: true,
                    result: { type: 'number', options: { precision: NaN } },
                },
            },
            {
                type: 'formula',
                options: {
                    isValid: true,
                    result: { type: 'currency', options: { precision: 2 } },
                },
            },
            {
                type: 'formula',
                options: {
                    isValid: true,
                    result: { type: 'singleLineText', options: {} },
                },
            },
            {
                type: 'formula',
                options: {
                    isValid: true,
                    result: { type: 'formula', options: valid.config.options },
                },
            },
            {
                type: 'formula',
                options: {
                    isValid: true,
                    result: { type: 'singleSelect', options: { choices: [] } },
                },
            },
            { type: 'rollup', options: valid.config.options },
            { type: 'count', options: { isValid: true } },
        ];
        for (const config of configs)
            assert.equal(
                evaluate(
                    { ...valid, config } as RuntimeAirtableField,
                    rule('number', 'equals', 5),
                    5
                ).type,
                'blocked'
            );
        assert.equal(
            evaluate(
                { ...valid, isComputed: false },
                rule('number', 'equals', 5),
                5
            ).type,
            'blocked'
        );
        assert.equal(
            evaluate(formula('percent'), rule('number', 'equals', 50), 0.5)
                .type,
            'blocked'
        );
        assert.equal(
            evaluate(formula('number'), rule('singleLineText', 'is', '5'), 5)
                .type,
            'blocked'
        );
    });
    it('validates raw Formula drivers even when compatibility drops an incomplete branch', () => {
        const definition = rule('number', 'equals', null);
        definition.conditions.push({
            id: 'complete-neighbor',
            type: 'singleCondition',
            setting: {
                fieldType: 'singleLineText',
                type: 'is',
                value: 'ready',
                idOrName: { type: 'id', id: 'target' },
            },
        });
        const target = text('target', { conditionalFields: definition });
        const options = {
            field: target,
            airtableFields: [formula('number'), target.airtableField],
            data: { formula: [5], target: 'ready' },
            formRecordType: 'create',
            evaluationMode: 'runtime',
            invalidConditionMode: 'compatibility',
        } as const;
        assert.equal(evaluateFormFieldVisibility(options).type, 'blocked');
        assert.equal(
            evaluateFormFieldVisibility({
                ...options,
                data: { formula: 5, target: 'ready' },
            }).type,
            'visible'
        );
    });
    it('refuses Formula aliases and duplicate references instead of choosing a native value', () => {
        const driver = formula('number'),
            target = text('target', {
                conditionalFields: rule('number', 'equals', 5),
            });
        const options = {
            field: target,
            airtableFields: [driver],
            data: { formula: 5 },
            formRecordType: 'edit',
            evaluationMode: 'runtime',
            invalidConditionMode: 'strict',
        } as const;
        assert.equal(
            evaluateFormFieldVisibility({
                ...options,
                data: { ...options.data, [driver.name]: 0 },
            }).type,
            'blocked'
        );
        assert.equal(
            evaluateFormFieldVisibility({
                ...options,
                airtableFields: [
                    driver,
                    { ...text('other').airtableField, name: driver.id },
                ],
            }).type,
            'blocked'
        );
        assert.equal(
            evaluateFormFieldVisibility({
                ...options,
                airtableFields: [driver, { ...driver }],
            }).type,
            'blocked'
        );
    });
    it('resolves an unambiguous tagged Formula name in nested conditions', () => {
        const driver = formula('singleLineText');
        const named = rule('singleLineText', 'is', 'ready', {
            type: 'name',
            name: driver.name,
        });
        const definition = {
            logicalOperator: 'or',
            conditions: [{ type: 'groupCondition', ...named }],
        } as RuntimeConditionsDefinition;
        assert.equal(evaluate(driver, definition, 'ready').type, 'visible');
        assert.equal(evaluate(driver, definition, 'waiting').type, 'hidden');
    });
    it('keeps the public compiler and both public scalar projections conservative', () => {
        const driver = formula('number'),
            definition = rule('number', 'equals', 5);
        assert.equal(
            compileRuntimeConditions({
                conditions: definition,
                airtableFields: [driver],
                invalidConditionMode: 'strict',
            }).type,
            'unsupported'
        );
        const target = text('target', { conditionalFields: definition });
        const options = {
            fieldIds: ['target'],
            fieldIdsToSchemas: { target },
            airtableFields: [driver, target.airtableField],
            data: { formula: 5, target: 'Preserved answer' },
            recordId: 'synthetic-record',
            invalidConditionMode: 'strict',
        } as const;
        assert.equal(
            createFlatScalarFormRecordProjection(options).type,
            'blocked'
        );
        assert.equal(createScalarFormRecordProjection(options).type, 'blocked');
        const form = createFormConditionRecordProjection(options);
        assert.equal(form.type, 'available');
        if (form.type === 'available')
            assert.deepEqual(form.record.fields, options.data);
        const hidden = createFormConditionRecordProjection({
            ...options,
            data: { ...options.data, formula: 0 },
        });
        assert.equal(hidden.type, 'available');
        if (hidden.type === 'available') {
            assert.deepEqual(hidden.hiddenFieldIds, ['target']);
            assert.equal(hidden.record.fields.formula, 0);
        }
        assert.equal(options.data.target, 'Preserved answer');
        const choice = {
            fieldType: 'singleSelect',
            airtableField: {
                ...text('choice').airtableField,
                config: {
                    type: 'singleSelect',
                    options: { choices: [{ id: 'ready', name: 'Ready' }] },
                },
            },
            miniExtConfig: {
                enableConditionalOptions: true,
                conditionsForOptions: [
                    {
                        id: 'synthetic-option',
                        config: {
                            optionForConditions: 'ready',
                            conditionsForOption: definition,
                        },
                    },
                ],
            },
        } as RuntimeFieldSchema;
        const availability = resolveSelectFieldAvailability({
            field: choice,
            airtableFields: [driver],
            recordForConditionEvaluation: {
                id: 'synthetic',
                fields: { formula: 5 },
            },
            mode: 'runtime',
            invalidConditionMode: 'strict',
        });
        assert.equal(availability.status, 'blocked');
    });
    it('keeps computed Formula hide-empty targets outside the supported boundary', () => {
        const driver = formula('number');
        const target = {
            fieldType: 'formula',
            airtableField: driver,
            miniExtConfig: { hideFieldIfEmpty: true },
        } as RuntimeFieldSchema;
        assert.equal(
            evaluateFormFieldVisibility({
                field: target,
                airtableFields: [driver],
                data: { formula: 5 },
                formRecordType: 'edit',
                evaluationMode: 'runtime',
                invalidConditionMode: 'strict',
            }).type,
            'blocked'
        );
    });
    it('evaluates Portal field and view predicates against accepted Formula snapshots', () => {
        const definition = rule('percent', 'greaterThanOrEqualsTo', 50);
        const view = {
            id: 'synthetic-eligible',
            config: { customViewConditions: definition },
        };
        const portal = portalPage({ customViews: [view] });
        portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig = {
            ...portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig,
            conditionalFields: definition,
        };
        portal.payload.usersTableFields = [formula('percent')];
        portal.payload.formRecord.data.formula = 0.5;
        assert.deepEqual(
            evaluatePortalViewAvailability({
                portal,
                portalFieldId: 'fld_children',
            }).views,
            [view]
        );
        portal.payload.formRecord.data.formula = 0.49;
        assert.deepEqual(
            evaluatePortalViewAvailability({
                portal,
                portalFieldId: 'fld_children',
            }),
            { views: [], legacy: false, unavailable: false }
        );
        portal.payload.formRecord.data.formula = { error: 'private' };
        assert.deepEqual(
            evaluatePortalViewAvailability({
                portal,
                portalFieldId: 'fld_children',
            }),
            { views: [], legacy: false, unavailable: true }
        );
    });
    it('retains an unconditional Portal neighbor when one Formula view is unavailable', () => {
        const neighbor = { id: 'synthetic-neighbor', config: {} };
        const portal = portalPage({
            customViews: [
                {
                    id: 'synthetic-bad',
                    config: {
                        customViewConditions: rule('number', 'equals', 5),
                    },
                },
                neighbor,
            ],
        });
        portal.payload.usersTableFields = [formula('number')];
        portal.payload.formRecord.data.formula = [5];
        assert.deepEqual(
            evaluatePortalViewAvailability({
                portal,
                portalFieldId: 'fld_children',
            }),
            { views: [neighbor], legacy: false, unavailable: true }
        );
    });
    it('supports advanced validation without making computed targets writable', () => {
        const loaded = loadedForm();
        loaded.payload.fieldIdsInForm = ['target'];
        loaded.payload.fieldIdsToSchemas = {
            target: text('target', {
                fieldValidationConditionalFields: rule('number', 'equals', 5),
            }),
            formula: {
                fieldType: 'formula',
                airtableField: formula('number'),
            } as RuntimeFieldSchema,
        };
        const descriptor = describeLoadedFormFields(loaded)[0];
        const context = {
            data: { formula: 5 },
            fieldIdsToSchemas: loaded.payload.fieldIdsToSchemas,
        };
        assert.equal(
            validatePageField(descriptor, 'Answer', 'Answer', false, context),
            null
        );
        assert.deepEqual(
            validatePageField(descriptor, 'Answer', 'Answer', false, {
                ...context,
                data: { formula: 4 },
            }),
            { fieldId: 'target', code: 'conditional-validation' }
        );
        assert.deepEqual(
            validatePageField(descriptor, 'Answer', 'Answer', false, {
                ...context,
                data: { formula: [5] },
            }),
            { fieldId: 'target', code: 'unsupported-validation' }
        );
        assert.equal(
            validatePageField(
                { ...descriptor, isComputed: true },
                'Answer',
                'Answer',
                false,
                { ...context, data: { formula: 4 } }
            ),
            null
        );
    });
    it('preserves Formula snapshots through dependency edits and native Save until an explicit accepted reload', async () => {
        const loaded = loadedForm(),
            driver = formula('number');
        loaded.payload.fieldIdsInForm = ['dependency', 'target', 'formula'];
        loaded.payload.fieldIdsToSchemas = {
            dependency: text('dependency'),
            target: text('target', {
                conditionalFields: rule('number', 'greaterThan', 5),
            }),
            formula: {
                fieldType: 'formula',
                airtableField: driver,
            } as RuntimeFieldSchema,
        };
        loaded.payload.formRecord = {
            type: 'create',
            data: {
                dependency: 'Initial',
                formula: 5,
                target: 'Hidden native answer',
            },
        };
        loaded.payload.formFieldIdsWithUnsavedChanges = [];
        loaded.payload.urlPrefilledFieldIds = [];
        const calls: SaveFormInput[] = [];
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw Error('No implicit request');
            },
        });
        client.forms.save = async (input) => {
            calls.push(input);
            return invalidForm();
        };
        const owner = createFormFieldBindings({
            client,
            loaded,
            saveOptions: formSaveOptions(),
            getScope: () => ({ ownerId: 'synthetic', revision: 0 }),
        });
        try {
            assert.equal(
                owner.field('target').getSnapshot().visibility.type,
                'hidden'
            );
            assert.equal(
                owner.field('dependency').setValue('Edited').accepted,
                true
            );
            assert.equal(
                owner.field('target').getSnapshot().visibility.type,
                'hidden'
            );
            assert.equal(owner.controller.write('formula', 6), false);
            assert.equal(owner.field('formula').setValue(6).accepted, false);
            assert.deepEqual(owner.controller.getState().draft?.dirtyFieldIds, [
                'dependency',
            ]);
            assert.equal(calls.length, 0);
            await owner.save();
            assert.equal(calls.length, 1);
            assert.deepEqual(calls[0].formRecord.data, {
                dependency: 'Edited',
                formula: 5,
                target: 'Hidden native answer',
            });
            const fresh = structuredClone(loaded);
            fresh.payload.formRecord.data.formula = 6;
            assert.equal(
                await owner.reload({ dirty: 'keep', read: async () => fresh }),
                true
            );
            assert.equal(
                owner.field('target').getSnapshot().visibility.type,
                'visible'
            );
            assert.equal(owner.controller.getState().draft?.data.formula, 6);
            assert.equal(
                owner.controller.getState().draft?.data.dependency,
                'Edited'
            );
        } finally {
            owner.destroy();
        }
    });
});
