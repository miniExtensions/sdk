import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    composeFormFieldVisibility,
    evaluateFormFieldVisibility,
    type EvaluateFormFieldVisibilityInput,
} from '../src/forms/index.js';
import type {
    AirtableValue,
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
    RuntimeFieldSchema,
} from '../src/runtime/index.js';

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
const driver: RuntimeAirtableField = {
    ...text('driver').airtableField,
    config: {
        type: 'checkbox',
        options: { icon: 'check', color: 'greenBright' },
    },
};

// Tests cross the published JSON boundary, including invalid definitions.
const conditions = (
    id = 'driver',
    fieldType = 'checkbox',
    type = 'is',
    value: unknown = true
): RuntimeConditionsDefinition =>
    ({
        logicalOperator: 'and',
        conditions: [
            {
                id: 'private-editor-id',
                type: 'singleCondition',
                setting: {
                    type,
                    fieldType,
                    idOrName: { type: 'id', id },
                    value,
                },
            },
        ],
    }) as RuntimeConditionsDefinition;

const input = (
    field = text('target', { conditionalFields: conditions() }),
    data: Record<string, AirtableValue> = { driver: false }
): EvaluateFormFieldVisibilityInput => ({
    field,
    airtableFields: [driver, field.airtableField],
    data,
    formRecordType: 'edit',
    evaluationMode: 'runtime',
    invalidConditionMode: 'strict',
});

describe('bounded one-page conditional visibility', () => {
    it('blocks ID/name aliases that could evaluate another native field value', () => {
        const first = { ...driver, id: 'fld_a', name: 'fld_b' };
        const second = { ...driver, id: 'fld_b', name: 'Other' };
        const target = text('target', {
            conditionalFields: conditions('fld_a'),
        });
        const options = {
            ...input(target),
            airtableFields: [first, second],
            data: { fld_a: true, fld_b: false },
        };
        assert.deepEqual(evaluateFormFieldVisibility(options), {
            type: 'blocked',
            code: 'ambiguous-reference',
            diagnostics: [],
        });
        assert.equal(
            evaluateFormFieldVisibility({
                ...options,
                airtableFields: [{ ...first, name: 'Driver' }, second],
            }).type,
            'visible'
        );
        assert.deepEqual(
            evaluateFormFieldVisibility({
                ...options,
                airtableFields: [
                    { ...second, name: 'fld_a' },
                    { ...first, name: 'Driver' },
                ],
            }),
            { type: 'blocked', code: 'ambiguous-reference', diagnostics: [] }
        );
    });
    it('evaluates readonly conditions and reverses without changing native input', () => {
        const options = input(
            text('target', {
                readOnly: true,
                conditionalFields: conditions(),
            })
        );
        const before = structuredClone(options);
        assert.equal(evaluateFormFieldVisibility(options).type, 'hidden');
        assert.equal(
            evaluateFormFieldVisibility({
                ...options,
                data: { driver: true },
            }).type,
            'visible'
        );
        assert.equal(evaluateFormFieldVisibility(options).type, 'hidden');
        assert.deepEqual(options, before);
        assert.deepEqual(evaluateFormFieldVisibility(input(text('target'))), {
            type: 'visible',
            diagnostics: [],
        });
    });

    it('uses the complete unfiltered accepted draft for every predicate', () => {
        const hidden = text('hidden', { conditionalFields: conditions() });
        const dependent = text('dependent', {
            conditionalFields: conditions(
                'hidden',
                'singleLineText',
                'is',
                'kept'
            ),
        });
        const data = { driver: false, hidden: 'kept', dependent: 'also kept' };
        const result = composeFormFieldVisibility({
            ...input(),
            fieldIds: ['hidden', 'dependent'],
            fieldIdsToSchemas: { hidden, dependent },
            airtableFields: [
                driver,
                hidden.airtableField,
                dependent.airtableField,
            ],
            data,
        });
        assert.equal(result.hidden.type, 'hidden');
        assert.equal(result.dependent.type, 'visible');
        assert.deepEqual(data, {
            driver: false,
            hidden: 'kept',
            dependent: 'also kept',
        });
    });

    it('composes frontend sections with explicit disabled headers and resets at the next header', () => {
        const fields = [
            text('before'),
            text('lead', {
                headerSectionTitle: 'First',
                applyFieldConditionsToSection: true,
                conditionalFields: conditions(),
            }),
            text('follower', {
                conditionalFields: conditions(
                    'driver',
                    'checkbox',
                    'unsupported'
                ),
            }),
            text('disabled', {
                enableSectionHeader: false,
                headerSectionTitle: 'Retained title',
            }),
            text('blank', { headerSectionTitle: '  ' }),
            text('next', {
                headerSectionTitle: 'Next',
                applyFieldConditionsToSection: true,
            }),
            text('own', { conditionalFields: conditions() }),
        ];
        const result = composeFormFieldVisibility({
            ...input(),
            fieldIds: fields.map((field) => field.airtableField.id),
            fieldIdsToSchemas: Object.fromEntries(
                fields.map((field) => [field.airtableField.id, field])
            ),
            airtableFields: [
                driver,
                ...fields.map((field) => field.airtableField),
            ],
        });
        assert.deepEqual(
            Object.fromEntries(
                Object.entries(result).map(([id, value]) => [id, value.type])
            ),
            {
                before: 'visible',
                lead: 'hidden',
                follower: 'hidden',
                disabled: 'hidden',
                blank: 'hidden',
                next: 'visible',
                own: 'hidden',
            }
        );
    });

    it('propagates a blocked section lead and keeps nonpropagating followers independent', () => {
        const lead = text('lead', {
            headerSectionTitle: 'Blocked section',
            applyFieldConditionsToSection: true,
            conditionalFields: conditions('driver', 'checkbox', 'unsupported'),
        });
        const follower = text('follower');
        const next = text('next', { headerSectionTitle: 'Reset' });
        const result = composeFormFieldVisibility({
            ...input(),
            fieldIds: ['lead', 'follower', 'next'],
            fieldIdsToSchemas: { lead, follower, next },
        });
        assert.equal(result.lead.type, 'blocked');
        assert.deepEqual(result.follower, result.lead);
        assert.equal(result.next.type, 'visible');
        lead.miniExtConfig = {
            headerSectionTitle: 'Blocked section',
            applyFieldConditionsToSection: false,
            conditionalFields: conditions('driver', 'checkbox', 'unsupported'),
        };
        assert.equal(
            composeFormFieldVisibility({
                ...input(),
                fieldIds: ['lead', 'follower'],
                fieldIdsToSchemas: { lead, follower },
            }).follower.type,
            'visible'
        );
    });

    it('hides canonical empty edit scalars before the preview condition bypass and retains native input', () => {
        const empty = input(text('target', { hideFieldIfEmpty: true }));
        assert.deepEqual(evaluateFormFieldVisibility(empty), {
            type: 'hidden',
            diagnostics: [],
        });
        for (const readOnly of [false, true]) {
            const field = text('target', { hideFieldIfEmpty: true, readOnly });
            for (const value of [null, '', ' \t\n ']) {
                const options = {
                    ...empty,
                    field,
                    data: { target: value, other: ['retained'] },
                };
                const before = structuredClone(options);
                for (const evaluationMode of ['runtime', 'preview'] as const)
                    assert.deepEqual(
                        evaluateFormFieldVisibility({
                            ...options,
                            evaluationMode,
                        }),
                        { type: 'hidden', diagnostics: [] }
                    );
                assert.deepEqual(options, before);
            }
            assert.equal(
                evaluateFormFieldVisibility({
                    ...empty,
                    field,
                    data: { target: 'Kept' },
                }).type,
                'visible'
            );
        }
        assert.equal(
            evaluateFormFieldVisibility({ ...empty, formRecordType: 'create' })
                .type,
            'visible'
        );
        assert.equal(
            evaluateFormFieldVisibility({ ...empty, evaluationMode: 'preview' })
                .type,
            'hidden'
        );
        for (const hideFieldIfEmpty of [false, undefined])
            assert.equal(
                evaluateFormFieldVisibility({
                    ...empty,
                    field: text('target', { hideFieldIfEmpty }),
                }).type,
                'visible'
            );
        assert.equal(
            evaluateFormFieldVisibility({
                ...input(),
                evaluationMode: 'preview',
            }).type,
            'visible'
        );
        const unsupportedCondition = text('target', {
            hideFieldIfEmpty: true,
            conditionalFields: conditions('driver', 'checkbox', 'unsupported'),
        });
        assert.equal(
            evaluateFormFieldVisibility({
                ...empty,
                field: unsupportedCondition,
            }).type,
            'hidden'
        );
        assert.equal(
            evaluateFormFieldVisibility({
                ...empty,
                field: unsupportedCondition,
                data: { target: 'Kept' },
            }).type,
            'blocked'
        );
        assert.equal(
            evaluateFormFieldVisibility({
                ...empty,
                field: unsupportedCondition,
                data: { target: 'Kept' },
                evaluationMode: 'preview',
            }).type,
            'visible'
        );
    });

    it('continues supported conditions for a populated empty-hiding target across reversal and preview', () => {
        const field = text('target', {
            hideFieldIfEmpty: true,
            readOnly: true,
            conditionalFields: conditions(),
        });
        const data: Record<string, AirtableValue> = {
            driver: false,
            target: 'Retained populated answer',
            unrelated: ['retained native value'],
        };
        const options = input(field, data);
        for (const enabled of [false, true, false]) {
            data.driver = enabled;
            const before = structuredClone(options);
            assert.deepEqual(evaluateFormFieldVisibility(options), {
                type: enabled ? 'visible' : 'hidden',
                diagnostics: [],
            });
            assert.deepEqual(
                evaluateFormFieldVisibility({
                    ...options,
                    evaluationMode: 'preview',
                }),
                { type: 'visible', diagnostics: [] }
            );
            assert.deepEqual(options, before);
            assert.equal(data.target, 'Retained populated answer');
            assert.deepEqual(data.unrelated, ['retained native value']);
        }
    });

    it('keeps default lookup empty hiding unsupported in both create and edit mode', () => {
        const lookup: RuntimeFieldSchema = {
            fieldType: 'multipleLookupValues',
            airtableField: {
                ...text('lookup').airtableField,
                isComputed: true,
                config: {
                    type: 'multipleLookupValues',
                    options: {
                        isValid: true,
                        recordLinkFieldId: 'links',
                        fieldIdInLinkedTable: 'value',
                        result: { type: 'singleLineText', options: null },
                    },
                },
            },
        };
        for (const formRecordType of ['create', 'edit'] as const)
            assert.equal(
                evaluateFormFieldVisibility({
                    ...input(),
                    field: lookup,
                    formRecordType,
                }).type,
                'blocked'
            );
        lookup.miniExtConfig = { hideFieldIfEmpty: false };
        assert.equal(
            evaluateFormFieldVisibility({ ...input(), field: lookup }).type,
            'visible'
        );
    });

    it('uses the canonical direct scalar empty rules without coercing populated zero values', () => {
        const common = text('target').airtableField;
        const cases: {
            field: RuntimeAirtableField;
            empty: AirtableValue;
            populated: AirtableValue;
        }[] = [
            {
                field: {
                    ...common,
                    config: { type: 'singleLineText', options: null },
                },
                empty: '  ',
                populated: 'kept',
            },
            {
                field: {
                    ...common,
                    config: { type: 'email', options: null },
                },
                empty: '  ',
                populated: 'kept',
            },
            {
                field: {
                    ...common,
                    config: { type: 'url', options: null },
                },
                empty: '  ',
                populated: 'kept',
            },
            {
                field: {
                    ...common,
                    config: { type: 'multilineText', options: null },
                },
                empty: '  ',
                populated: 'kept',
            },
            {
                field: {
                    ...common,
                    config: { type: 'phoneNumber', options: null },
                },
                empty: '  ',
                populated: 'kept',
            },
            {
                field: {
                    ...common,
                    config: { type: 'richText', options: null },
                },
                empty: '  ',
                populated: 'kept',
            },
            {
                field: {
                    ...common,
                    config: { type: 'number', options: { precision: 2 } },
                },
                empty: null,
                populated: 0,
            },
            {
                field: {
                    ...common,
                    config: { type: 'percent', options: { precision: 2 } },
                },
                empty: null,
                populated: 0,
            },
            {
                field: {
                    ...common,
                    config: {
                        type: 'currency',
                        options: { precision: 2, symbol: '$' },
                    },
                },
                empty: null,
                populated: 0,
            },
            {
                field: {
                    ...common,
                    config: {
                        type: 'rating',
                        options: {
                            max: 5,
                            icon: 'star',
                            color: 'yellowBright',
                        },
                    },
                },
                empty: 0,
                populated: 1,
            },
            {
                field: {
                    ...common,
                    config: {
                        type: 'checkbox',
                        options: { icon: 'check', color: 'greenBright' },
                    },
                },
                empty: false,
                populated: true,
            },
            {
                field: {
                    ...common,
                    config: { type: 'barcode', options: null },
                },
                empty: { text: '  ', type: 'code128' },
                populated: { text: '001', type: 'code128' },
            },
        ];
        for (const { field: airtableField, empty, populated } of cases) {
            // This follows the returned wire schema's physical discriminator.
            const field = {
                fieldType: airtableField.config.type,
                airtableField,
                miniExtConfig: { hideFieldIfEmpty: true },
            } as RuntimeFieldSchema;
            for (const evaluationMode of ['runtime', 'preview'] as const) {
                const options = { ...input(), field, evaluationMode };
                for (const value of [null, ' \t ', empty])
                    assert.equal(
                        evaluateFormFieldVisibility({
                            ...options,
                            data: { target: value },
                        }).type,
                        'hidden',
                        `${airtableField.config.type} canonical empty value`
                    );
                assert.equal(
                    evaluateFormFieldVisibility({
                        ...options,
                        data: { target: populated },
                    }).type,
                    'visible',
                    `${airtableField.config.type} populated native value`
                );
            }
        }
    });

    it('blocks unproven empty-value shapes and physical/computed/section contexts', () => {
        const target = text('target', { hideFieldIfEmpty: true });
        const malformedValues: AirtableValue[] = [
            [],
            [''],
            { error: 'private-target-error' },
            { specialValue: 'NaN' },
            false,
            0,
        ];
        for (const value of malformedValues) {
            const outcome = evaluateFormFieldVisibility({
                ...input(target),
                data: { target: value },
            });
            assert.deepEqual(outcome, {
                type: 'blocked',
                code: 'invalid-native-value',
                diagnostics: [],
            });
            assert.equal(JSON.stringify(outcome).includes('private'), false);
        }
        const number: RuntimeFieldSchema = {
            fieldType: 'number',
            airtableField: {
                ...target.airtableField,
                config: { type: 'number', options: { precision: 2 } },
            },
            miniExtConfig: { hideFieldIfEmpty: true },
        };
        for (const value of [NaN, Infinity, -Infinity])
            assert.deepEqual(
                evaluateFormFieldVisibility({
                    ...input(),
                    field: number,
                    data: { target: value },
                }),
                {
                    type: 'blocked',
                    code: 'non-finite-result',
                    diagnostics: [],
                }
            );
        const checkbox: RuntimeFieldSchema = {
            fieldType: 'checkbox',
            airtableField: {
                ...target.airtableField,
                config: {
                    type: 'checkbox',
                    options: { icon: 'check', color: 'greenBright' },
                },
            },
            miniExtConfig: { hideFieldIfEmpty: true },
        };
        for (const [field, value] of [
            [number, '1'],
            [checkbox, 'false'],
        ] as const)
            assert.deepEqual(
                evaluateFormFieldVisibility({
                    ...input(),
                    field,
                    data: { target: value },
                }),
                {
                    type: 'blocked',
                    code: 'invalid-native-value',
                    diagnostics: [],
                }
            );
        assert.deepEqual(
            evaluateFormFieldVisibility({
                ...input(target),
                data: { target: '#ERROR!' },
            }),
            { type: 'visible', diagnostics: [] }
        );
        const barcode: RuntimeFieldSchema = {
            fieldType: 'barcode',
            airtableField: {
                ...target.airtableField,
                config: { type: 'barcode', options: null },
            },
            miniExtConfig: { hideFieldIfEmpty: true },
        };
        const malformedBarcodes: unknown[] = [
            'plain text',
            { text: 7 },
            { text: '001', type: 7 },
            { error: 'private-target-error' },
            { text: ' ', error: 'private-target-error' },
            { text: ' ', specialValue: 'NaN' },
        ];
        for (const value of malformedBarcodes) {
            const outcome = evaluateFormFieldVisibility({
                ...input(),
                field: barcode,
                // Exercise malformed returned JSON at the native boundary.
                data: { target: value as AirtableValue },
            });
            assert.deepEqual(outcome, {
                type: 'blocked',
                code: 'invalid-native-value',
                diagnostics: [],
            });
            assert.equal(JSON.stringify(outcome).includes('private'), false);
        }
        for (const value of [{ text: null }, { text: undefined }])
            assert.deepEqual(
                evaluateFormFieldVisibility({
                    ...input(),
                    field: barcode,
                    // Legacy JSON may contain nullish text outside the typed
                    // barcode contract; exercise the canonical empty guard.
                    data: { target: value as unknown as AirtableValue },
                }),
                { type: 'hidden', diagnostics: [] }
            );
        const linked: RuntimeFieldSchema = {
            fieldType: 'multipleRecordLinks',
            airtableField: {
                ...target.airtableField,
                config: {
                    type: 'multipleRecordLinks',
                    options: {
                        linkedTableId: 'table_linked',
                        isReversed: false,
                        prefersSingleRecordLink: false,
                    },
                },
            },
            miniExtConfig: { hideFieldIfEmpty: true },
        };
        const date: RuntimeFieldSchema = {
            fieldType: 'date',
            airtableField: {
                ...target.airtableField,
                config: {
                    type: 'date',
                    options: {
                        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                    },
                },
            },
            miniExtConfig: { hideFieldIfEmpty: true },
        };
        for (const field of [linked, date])
            for (const evaluationMode of ['runtime', 'preview'] as const)
                assert.deepEqual(
                    evaluateFormFieldVisibility({
                        ...input(),
                        field,
                        evaluationMode,
                        data: { target: null },
                    }),
                    {
                        type: 'blocked',
                        code: 'unsupported-hide-empty',
                        diagnostics: [],
                    }
                );
        const computed = structuredClone(target);
        computed.airtableField.isComputed = true;
        // Deliberately malformed returned JSON crosses the declared schema
        // boundary so the runtime physical-discriminator guard is exercised.
        const mismatched = {
            ...number,
            fieldType: 'singleLineText',
        } as unknown as RuntimeFieldSchema;
        for (const field of [
            computed,
            mismatched,
            text('target', {
                hideFieldIfEmpty: true,
                enableSectionHeader: false,
                headerSectionTitle: 'Retained canonical section',
            }),
        ])
            assert.deepEqual(
                evaluateFormFieldVisibility({ ...input(), field }),
                {
                    type: 'blocked',
                    code: 'unsupported-hide-empty',
                    diagnostics: [],
                }
            );
        for (const section of [
            text('section', { headerSectionTitle: 'Details' }),
            text('section', {
                enableSectionHeader: false,
                headerSectionTitle: 'Retained canonical section',
            }),
            text('section', { applyFieldConditionsToSection: true }),
        ]) {
            const composed = composeFormFieldVisibility({
                ...input(),
                fieldIds: ['target', 'section'],
                fieldIdsToSchemas: { target, section },
            });
            assert.deepEqual(composed.target, {
                type: 'blocked',
                code: 'unsupported-hide-empty',
                diagnostics: [],
            });
            assert.equal(composed.section.type, 'visible');
        }
        assert.equal(
            composeFormFieldVisibility({
                ...input(),
                fieldIds: ['target', 'blank'],
                fieldIdsToSchemas: {
                    target,
                    blank: text('blank', {
                        headerSectionTitle: '  ',
                        applyFieldConditionsToSection: false,
                    }),
                },
            }).target.type,
            'hidden'
        );
    });

    it('returns safe explicit errors and recovers when accepted driver data is repaired', () => {
        const target = text('target', {
            conditionalFields: conditions(
                'value',
                'singleLineText',
                'is',
                '#ERROR!'
            ),
        });
        const options = {
            ...input(target),
            airtableFields: [text('value').airtableField],
        };
        assert.equal(
            evaluateFormFieldVisibility({
                ...options,
                data: { value: '#ERROR!' },
            }).type,
            'visible'
        );
        for (const value of [
            { error: 'private runtime error' },
            ['bad shape'],
            1,
        ]) {
            const outcome = evaluateFormFieldVisibility({
                ...options,
                data: { value },
            });
            assert.equal(outcome.type, 'blocked');
            assert.equal(JSON.stringify(outcome).includes('private'), false);
        }
        assert.equal(
            evaluateFormFieldVisibility({
                ...options,
                data: { value: '#ERROR!' },
            }).type,
            'visible'
        );
        const invalid = evaluateFormFieldVisibility(
            input(
                text('bad', {
                    conditionalFields: conditions(
                        'driver',
                        'checkbox',
                        'unsupported',
                        'secret'
                    ),
                })
            )
        );
        assert.equal(invalid.type, 'blocked');
        assert.equal(JSON.stringify(invalid).includes('secret'), false);
        assert.equal(
            JSON.stringify(invalid).includes('private-editor-id'),
            false
        );
    });

    it('uses physical scalar metadata and native percent/rating/barcode values without coercion', () => {
        const percent: RuntimeAirtableField = {
            ...text('value').airtableField,
            config: { type: 'percent', options: { precision: 2 } },
        };
        const options = {
            ...input(
                text('target', {
                    conditionalFields: conditions(
                        'value',
                        'percent',
                        'equals',
                        50
                    ),
                })
            ),
            airtableFields: [percent],
        };
        assert.equal(
            evaluateFormFieldVisibility({ ...options, data: { value: 0.5 } })
                .type,
            'visible'
        );
        assert.equal(
            evaluateFormFieldVisibility({ ...options, data: { value: '0.5' } })
                .type,
            'blocked'
        );
        for (const value of [
            Infinity,
            NaN,
            { specialValue: 'Infinity' },
        ] as AirtableValue[])
            assert.equal(
                evaluateFormFieldVisibility({ ...options, data: { value } })
                    .type,
                'blocked'
            );
        assert.equal(
            evaluateFormFieldVisibility({
                ...options,
                airtableFields: [{ ...percent, isComputed: true }],
                data: { value: 0.5 },
            }).type,
            'blocked'
        );
        const linked: RuntimeAirtableField = {
            ...text('value').airtableField,
            config: {
                type: 'multipleRecordLinks',
                options: {
                    linkedTableId: 'table_linked',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                },
            },
        };
        assert.equal(
            evaluateFormFieldVisibility({
                ...input(
                    text('target', {
                        conditionalFields: conditions(
                            'value',
                            'singleLineText',
                            'is',
                            'display'
                        ),
                    })
                ),
                airtableFields: [linked],
                data: { value: ['record_linked'] },
            }).type,
            'blocked'
        );
        const rating: RuntimeAirtableField = {
            ...text('value').airtableField,
            config: {
                type: 'rating',
                options: { max: 5, icon: 'star', color: 'yellowBright' },
            },
        };
        const ratingTarget = text('target', {
            conditionalFields: conditions('value', 'rating', 'isEmpty'),
        });
        assert.equal(
            evaluateFormFieldVisibility({
                ...input(ratingTarget),
                airtableFields: [rating],
                data: { value: 0 },
            }).type,
            'visible'
        );
        const barcode: RuntimeAirtableField = {
            ...text('value').airtableField,
            config: { type: 'barcode', options: null },
        };
        const barcodeTarget = text('target', {
            conditionalFields: conditions('value', 'barcode', 'is', '001'),
        });
        assert.equal(
            evaluateFormFieldVisibility({
                ...input(barcodeTarget),
                airtableFields: [barcode],
                data: { value: { text: '001' } },
            }).type,
            'visible'
        );
        assert.equal(
            evaluateFormFieldVisibility({
                ...input(barcodeTarget),
                airtableFields: [barcode],
                data: { value: { text: 1 } } as unknown as Record<
                    string,
                    AirtableValue
                >,
            }).type,
            'blocked'
        );
    });

    it('retains safe missing-field warnings and the compiler strict/compatibility policy', () => {
        const missing = evaluateFormFieldVisibility({
            ...input(),
            airtableFields: [],
            data: { driver: true },
        });
        assert.deepEqual(missing, {
            type: 'hidden',
            diagnostics: [
                { code: 'missing-field', severity: 'warning', path: [0] },
            ],
        });
        const definition = conditions();
        definition.conditions.push(
            ...conditions('driver', 'checkbox', 'is', null).conditions
        );
        const options = input(
            text('target', { conditionalFields: definition }),
            { driver: true }
        );
        assert.equal(evaluateFormFieldVisibility(options).type, 'blocked');
        const compatibility = evaluateFormFieldVisibility({
            ...options,
            invalidConditionMode: 'compatibility',
        });
        assert.equal(compatibility.type, 'visible');
        assert.deepEqual(compatibility.diagnostics, [
            { code: 'incomplete-condition', severity: 'warning', path: [1] },
        ]);
        assert.deepEqual(
            composeFormFieldVisibility({
                ...input(),
                fieldIds: ['missing'],
                fieldIdsToSchemas: {},
            }).missing,
            {
                type: 'blocked',
                code: 'missing-schema',
                diagnostics: [],
            }
        );
    });
});
