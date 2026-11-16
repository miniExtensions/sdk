import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    createLinkedFormRecordProjection,
    type CreateLinkedFormRecordProjectionInput,
    type FormProjectionLinkedFilters,
    type FormProjectionLinkedTableStates,
} from '../src/forms/index.js';
import type {
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
    RuntimeFieldSchema,
    RuntimeFormRecord,
} from '../src/runtime/index.js';

type Text = Extract<RuntimeFieldSchema, { fieldType: 'singleLineText' }>;
const text = (id: string, config: Text['miniExtConfig'] = {}): Text => ({
    fieldType: 'singleLineText',
    airtableField: {
        id,
        name: id,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'singleLineText', options: null },
    },
    miniExtConfig: config,
});

const condition = (
    id = 'driver',
    value: unknown = 'yes',
    fieldType = 'singleLineText',
    operator = 'is'
): RuntimeConditionsDefinition =>
    ({
        logicalOperator: 'and',
        conditions: [
            {
                id: 'condition',
                type: 'singleCondition',
                setting: {
                    type: operator,
                    fieldType,
                    idOrName: { type: 'id', id },
                    value,
                },
            },
        ],
    }) as RuntimeConditionsDefinition;
const links: RuntimeFieldSchema = {
    fieldType: 'multipleRecordLinks',
    airtableField: {
        ...text('links').airtableField,
        config: {
            type: 'multipleRecordLinks',
            options: {
                linkedTableId: 'tbl_links',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
    },
    miniExtConfig: {},
};
const loaded: FormProjectionLinkedTableStates = {
    tbl_links: {
        type: 'loaded',
        data: {
            state: {
                airtableFields: [],
                recordIdsToAirtableRecords: {
                    rec_a: {
                        id: 'rec_a',
                        fields: { first: ['one'], second: ['two'] },
                    },
                    rec_b: {
                        id: 'rec_b',
                        fields: { first: ['one'], second: ['two'] },
                    },
                    rec_c: {
                        id: 'rec_c',
                        fields: { first: ['one'], second: ['other'] },
                    },
                },
            },
        },
    },
};
const defaults = (
    change: Partial<CreateLinkedFormRecordProjectionInput> = {}
): CreateLinkedFormRecordProjectionInput => ({
    compatibility: 'native-form-v1',
    formRecord: {
        type: 'edit',
        tableId: 'tbl_output',
        recordId: 'rec_output',
        data: {
            driver: 'yes',
            answer: 'keep',
            links: ['rec_b', 'rec_a', 'uncached', 'rec_b', 'rec_c'],
        },
    },
    formFields: [
        text('driver'),
        text('answer', { conditionalFields: condition() }),
        links,
    ],
    airtableFields: [
        text('driver').airtableField,
        text('answer').airtableField,
        links.airtableField,
    ],
    linkedTableLoadingStates: loaded,
    conditionalLinkedRecordFieldIdsToFilteringValues: {
        links: { first: { recordId: 'one', stringValue: 'One' } },
    },
    ...change,
});
const available = (input: CreateLinkedFormRecordProjectionInput) => {
    const result = createLinkedFormRecordProjection(input);
    if (result.type !== 'available') assert.fail(`Blocked: ${result.code}`);
    assert.equal(result.type, 'available');
    return result;
};

describe('portable linked/two-source Form projection contract', () => {
    it('preserves selected order/duplicates, ANDs driver pairs, prunes uncached IDs and leaves inputs intact', () => {
        const input = defaults({
            conditionalLinkedRecordFieldIdsToFilteringValues: {
                links: {
                    first: { recordId: 'one', stringValue: 'One' },
                    second: { recordId: 'two', stringValue: 'Two' },
                },
            },
        });
        const before = structuredClone(input);
        const result = available(input);
        assert.deepEqual(result.formRecord.data.links, [
            'rec_b',
            'rec_a',
            'rec_b',
        ]);
        assert.equal(result.formRecord.data.answer, 'keep');
        assert.deepEqual(result.hiddenFieldIds, []);
        assert.deepEqual(input, before);
        assert.notEqual(result.formRecord, input.formRecord);
        assert.notEqual(result.formRecord.data, input.formRecord.data);
    });

    it('distinguishes an absent/null outer filter from empty filters and null/blank pairs', () => {
        for (const filters of [
            {},
            { links: null },
        ] satisfies FormProjectionLinkedFilters[]) {
            assert.deepEqual(
                available(
                    defaults({
                        conditionalLinkedRecordFieldIdsToFilteringValues:
                            filters,
                    })
                ).formRecord.data.links,
                ['rec_b', 'rec_a', 'uncached', 'rec_b', 'rec_c']
            );
        }
        for (const pairs of [
            {},
            { first: null },
            { first: { recordId: 'absent', stringValue: '' } },
            { first: { recordId: 'absent', stringValue: null } },
        ]) {
            assert.deepEqual(
                available(
                    defaults({
                        conditionalLinkedRecordFieldIdsToFilteringValues: {
                            links: pairs,
                        },
                    })
                ).formRecord.data.links,
                ['rec_b', 'rec_a', 'rec_b', 'rec_c']
            );
        }
    });

    it('uses only accepted loaded cache, including retained-loaded data', () => {
        const unavailable: FormProjectionLinkedTableStates[] = [
            {},
            {
                other: {
                    type: 'loaded',
                    data: {
                        state: {
                            airtableFields: [],
                            recordIdsToAirtableRecords: {},
                        },
                    },
                },
            },
            { tbl_links: { type: 'notLoaded' } },
            { tbl_links: { type: 'failed', errorMessage: 'synthetic' } },
        ];
        for (const linkedTableLoadingStates of unavailable)
            assert.deepEqual(
                available(defaults({ linkedTableLoadingStates })).formRecord
                    .data.links,
                []
            );
        const loading = { tbl_links: { type: 'loading' as const } };
        const blocked = createLinkedFormRecordProjection(
            defaults({ linkedTableLoadingStates: loading })
        );
        assert.deepEqual(blocked, {
            type: 'blocked',
            code: 'native-loading-boundary',
            diagnostics: [{ code: 'native-loading-boundary' }],
        });
        assert.deepEqual(
            available(
                defaults({
                    linkedTableLoadingStates: loading,
                    evaluateConditionalFields: false,
                })
            ).formRecord.data.links,
            []
        );
        const state = loaded.tbl_links;
        assert.equal(state.type, 'loaded');
        if (state.type !== 'loaded') throw new Error('Expected fixture cache.');
        const retained = {
            tbl_links: {
                ...state,
                isReloading: true,
                isPaginating: true,
                errorMessage: 'retained',
            },
            other: { type: 'loading' as const },
        };
        assert.deepEqual(
            available(defaults({ linkedTableLoadingStates: retained }))
                .formRecord.data.links,
            ['rec_b', 'rec_a', 'rec_b', 'rec_c']
        );
    });

    it('evaluates the alternate record in both directions without replacing output metadata or data', () => {
        for (const [outputValue, evaluationValue, expectedHidden] of [
            ['yes', 'no', ['answer']],
            ['no', 'yes', []],
        ] as const) {
            const base = defaults();
            const formRecord = {
                ...base.formRecord,
                data: { ...base.formRecord.data, driver: outputValue },
                metadata: { retained: true },
            };
            const evaluation: RuntimeFormRecord = {
                type: 'edit',
                tableId: 'tbl_evaluation',
                recordId: 'rec_evaluation',
                data: { driver: evaluationValue },
            };
            const input = {
                ...base,
                formRecord,
                formRecordForConditionEvaluation: evaluation,
            };
            const before = structuredClone(input);
            const result = available(input);
            assert.equal(result.formRecord.type, 'edit');
            if (result.formRecord.type === 'edit') {
                assert.equal(result.formRecord.recordId, 'rec_output');
                assert.equal(result.formRecord.tableId, 'tbl_output');
            }
            assert.equal(result.formRecord.data.driver, outputValue);
            assert.equal(
                Object.hasOwn(result.formRecord.data, 'answer'),
                expectedHidden.length === 0
            );
            assert.deepEqual(result.hiddenFieldIds, expectedHidden);
            assert.deepEqual(
                (result.formRecord as typeof formRecord).metadata,
                { retained: true }
            );
            assert.deepEqual(input, before);
        }
    });

    it('makes all visibility decisions against the unpruned record and preserves section ordering', () => {
        const driver = text('driver', {
            conditionalFields: condition('gate', 'open'),
        });
        const answer = text('answer', {
            conditionalFields: condition('driver', 'yes'),
        });
        const input = defaults({
            formFields: [driver, answer],
            airtableFields: [
                driver.airtableField,
                answer.airtableField,
                text('gate').airtableField,
            ],
        });
        const result = available(input);
        assert.deepEqual(result.hiddenFieldIds, ['driver']);
        assert.equal(result.formRecord.data.answer, 'keep');
        const section = text('driver', {
            headerSectionTitle: ' Retained section ',
            enableSectionHeader: false,
            applyFieldConditionsToSection: true,
            conditionalFields: condition('gate', 'open'),
        });
        const sectionResult = available({
            ...input,
            formFields: [section, answer],
        });
        assert.deepEqual(sectionResult.hiddenFieldIds, ['driver', 'answer']);
    });

    it('disabled conditional visibility still applies linked pruning', () => {
        const input = defaults({
            formRecordForConditionEvaluation: {
                type: 'create',
                data: { driver: 'no' },
            },
            evaluateConditionalFields: false,
        });
        const result = available(input);
        assert.deepEqual(result.hiddenFieldIds, []);
        assert.equal(result.formRecord.data.answer, 'keep');
        assert.deepEqual(result.formRecord.data.links, [
            'rec_b',
            'rec_a',
            'rec_b',
            'rec_c',
        ]);
    });

    it('retains native JSON cloning behavior for the entire output', () => {
        const input = defaults();
        const formRecord = {
            ...input.formRecord,
            omitted: undefined,
            data: {
                ...input.formRecord.data,
                zero: -0,
                notFinite: NaN,
                nested: { omitted: undefined, keep: ['a'] },
            },
        };
        const result = available({
            ...input,
            formRecord,
        } as unknown as CreateLinkedFormRecordProjectionInput);
        assert.equal(Object.hasOwn(result.formRecord, 'omitted'), false);
        assert.equal(Object.is(result.formRecord.data.zero, -0), false);
        assert.equal(result.formRecord.data.notFinite, null);
        assert.deepEqual(result.formRecord.data.nested, { keep: ['a'] });
        assert.equal(Object.is(formRecord.data.zero, -0), true);
        assert.equal(Number.isNaN(formRecord.data.notFinite), true);
    });

    it('uses a supplied computed scalar without calculating its unavailable referenced fields', () => {
        const computed = {
            ...text('driver').airtableField,
            isComputed: true,
            config: {
                type: 'formula' as const,
                options: {
                    isValid: true,
                    referencedFieldIds: ['unavailable-source'],
                    result: { type: 'singleLineText' as const, options: null },
                },
            },
        } satisfies RuntimeAirtableField;
        for (const value of ['yes', 'no']) {
            const result = available(
                defaults({
                    airtableFields: [
                        computed,
                        text('answer').airtableField,
                        links.airtableField,
                    ],
                    formFields: [
                        text('answer', { conditionalFields: condition() }),
                        links,
                    ],
                    formRecordForConditionEvaluation: {
                        type: 'create',
                        data: { driver: value },
                    },
                })
            );
            assert.equal(
                Object.hasOwn(result.formRecord.data, 'answer'),
                value === 'yes'
            );
        }
    });

    it('returns no partial projection for unsupported drivers, evaluation faults or malformed snapshots', () => {
        const input = defaults();
        const unknown = {
            ...text('driver').airtableField,
            config: { type: 'duration', options: { durationFormat: 'h:mm' } },
        } as RuntimeAirtableField;
        const unsupported = createLinkedFormRecordProjection({
            ...input,
            airtableFields: [
                unknown,
                text('answer').airtableField,
                links.airtableField,
            ],
            formFields: [
                text('answer', { conditionalFields: condition() }),
                links,
            ],
        });
        assert.equal(unsupported.type, 'blocked');
        if (unsupported.type === 'blocked')
            assert.equal(unsupported.code, 'unsupported-driver');
        assert.equal(Object.hasOwn(unsupported, 'formRecord'), false);
        const failure = new Error('synthetic conversion error');
        const fault = createLinkedFormRecordProjection({
            ...input,
            interpreterOptions: {
                resolveFieldReference: () => {
                    throw failure;
                },
            },
        });
        assert.equal(fault.type, 'blocked');
        assert.equal(Object.hasOwn(fault, 'formRecord'), false);
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        assert.equal(
            createLinkedFormRecordProjection({
                ...input,
                formRecord: { type: 'create', data: cyclic },
            } as unknown as CreateLinkedFormRecordProjectionInput).type,
            'blocked'
        );
        assert.equal(
            createLinkedFormRecordProjection({
                ...input,
                airtableFields: [
                    ...input.airtableFields,
                    input.airtableFields[0],
                ],
            }).type,
            'blocked'
        );
        assert.equal(
            createLinkedFormRecordProjection({
                ...input,
                compatibility: 'unknown',
            } as unknown as CreateLinkedFormRecordProjectionInput).type,
            'blocked'
        );
        const sparse = condition();
        delete sparse.conditions[0];
        assert.equal(
            createLinkedFormRecordProjection({
                ...input,
                formFields: [
                    text('answer', { conditionalFields: sparse }),
                    links,
                ],
            }).type,
            'blocked'
        );
    });
});

const nativeFixture = JSON.parse(
    readFileSync('test/fixtures/linkedProjection.json', 'utf8')
) as {
    provenance: {
        revision: string;
        tree: string;
        installedSdkRevision: string;
        generatorSha256: string;
        casesSourceSha256: string;
        sources: Record<string, string>;
        bundleInputs: Record<string, string>;
    };
    passes: {
        order: string;
        cases: {
            name: string;
            nativeFallbackReason?: 'native-loading-boundary';
            input: CreateLinkedFormRecordProjectionInput;
            expected: {
                formRecord: RuntimeFormRecord;
                hiddenFieldIds: string[];
            };
        }[];
    }[];
};
describe('actual native linked/two-source projection differential', () => {
    it('binds cases, generator, native source and installed formula dependency provenance', () => {
        const provenance = nativeFixture.provenance;
        assert.equal(
            provenance.revision,
            'acc1f942ff9704d469be421de8af251f0a27d220'
        );
        assert.equal(
            provenance.tree,
            'f9e12725785f98e131085dbc507f675fb6b479d0'
        );
        assert.equal(
            provenance.installedSdkRevision,
            'bd9d1f42982380069fc6a027650e70eff8127b9a'
        );
        for (const [path, expected] of [
            [
                'scripts/generate-linked-projection-fixtures.mjs',
                provenance.generatorSha256,
            ],
            [
                'test/fixtures/linkedProjectionCases.mjs',
                provenance.casesSourceSha256,
            ],
        ])
            assert.equal(
                createHash('sha256').update(readFileSync(path)).digest('hex'),
                expected
            );
        assert.equal(Object.keys(provenance.sources).length, 22);
        assert.ok(
            provenance.bundleInputs[
                'installed-sdk/dist/esm/formulas/interpreter/interpreter.js'
            ]
        );
        assert.ok(
            provenance.bundleInputs[
                'native/utils/isFieldHiddenByConditionalFields.ts'
            ]
        );
        for (const value of [
            ...Object.values(provenance.sources),
            ...Object.values(provenance.bundleInputs),
        ])
            assert.match(value, /^[0-9a-f]{64}$/);
        assert.deepEqual(
            nativeFixture.passes.map((pass) => pass.order),
            ['cold-forward', 'warm-forward', 'reverse']
        );
        assert.equal(nativeFixture.passes[0].cases.length, 28);
    });
    for (const pass of nativeFixture.passes)
        for (const entry of pass.cases) {
            it(`matches native ${pass.order}: ${entry.name}`, () => {
                const before = structuredClone(entry.input);
                if (entry.nativeFallbackReason) {
                    assert.deepEqual(
                        createLinkedFormRecordProjection(entry.input),
                        {
                            type: 'blocked',
                            code: entry.nativeFallbackReason,
                            diagnostics: [{ code: entry.nativeFallbackReason }],
                        }
                    );
                    assert.equal(
                        Object.hasOwn(entry.expected.formRecord.data, 'answer'),
                        false
                    );
                } else {
                    const result = available(entry.input);
                    assert.deepEqual(
                        result.formRecord,
                        entry.expected.formRecord
                    );
                    assert.deepEqual(
                        result.hiddenFieldIds,
                        entry.expected.hiddenFieldIds
                    );
                }
                assert.deepEqual(entry.input, before);
            });
        }
});
