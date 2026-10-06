import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    AirtableFieldType,
    type AirtableRecord,
    type AirtableValue,
    type RuntimeAirtableField,
    type RuntimeFieldSchema,
} from '../src/runtime/index.js';
import * as ui from '../src/ui/index.js';

type AvailabilityInput = {
    field: RuntimeFieldSchema;
    airtableFields: readonly RuntimeAirtableField[];
    recordForConditionEvaluation: AirtableRecord | null;
    mode: 'runtime' | 'configuration-preview';
    invalidConditionMode: 'compatibility' | 'strict';
};

// The fallback exercises the original static control on an unchanged source
// baseline. When the public helper is present, the same behavioral regression
// goes through it; an absent export cannot become a vacuous passing test.
const eligibleOptions = (input: AvailabilityInput) => {
    const resolve = Reflect.get(ui, 'resolveSelectFieldAvailability') as
        | ((input: AvailabilityInput) => {
              options: readonly ui.SelectionOption[];
          })
        | undefined;
    if (typeof resolve === 'function') return resolve(input).options;
    const policy = ui.getSelectFieldPolicy(input.field);
    return policy.options.filter(
        (option) =>
            policy.allowedOptionIds === null ||
            policy.allowedOptionIds.includes(option.id)
    );
};

const driverField = {
    id: 'fld_driver',
    name: 'Driver',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
} satisfies RuntimeAirtableField;

const choiceField = (multiple: boolean): RuntimeFieldSchema => {
    const metadata = {
        id: 'fld_choices',
        name: 'Choices',
        description: null,
        isComputed: false,
        isPrimaryField: false,
    };
    const options = {
        choices: [
            { id: 'sel_alpha', name: 'Alpha' },
            { id: 'sel_beta', name: 'Beta' },
        ],
    };
    const miniExtConfig = {
        enableConditionalOptions: true,
        singleOrMultiSelectLimitSelectionOptions: ['sel_alpha', 'sel_beta'],
        maxNumberOfSelections: 2,
        conditionsForOptions: [
            {
                id: 'rule_beta',
                config: {
                    optionForConditions: 'sel_beta',
                    name: 'Conditional Beta',
                    conditionsForOption: {
                        logicalOperator: 'and' as const,
                        conditions: [
                            {
                                id: 'driver_contains',
                                type: 'singleCondition' as const,
                                setting: {
                                    type: 'contains' as const,
                                    fieldType: 'singleLineText' as const,
                                    idOrName: {
                                        type: 'id' as const,
                                        id: driverField.id,
                                    },
                                    value: 'allowed',
                                },
                            },
                        ],
                    },
                },
            },
        ],
    };
    return multiple
        ? {
              fieldType: AirtableFieldType.MULTIPLE_SELECTS,
              airtableField: {
                  ...metadata,
                  config: { type: AirtableFieldType.MULTIPLE_SELECTS, options },
              },
              miniExtConfig,
          }
        : {
              fieldType: AirtableFieldType.SINGLE_SELECT,
              airtableField: {
                  ...metadata,
                  config: { type: AirtableFieldType.SINGLE_SELECT, options },
              },
              miniExtConfig,
          };
};

const environment = (test: TestContext) => {
    const window = new Window({ url: 'https://choice.example.test' });
    test.after(() => window.happyDOM.close());
    const document = window.document as unknown as Document;
    const dispatch = (element: HTMLElement): void => {
        element.dispatchEvent(
            new window.Event('change', { bubbles: true }) as unknown as Event
        );
    };
    return { document, dispatch };
};

describe('configured select availability through the current native control', () => {
    for (const multiple of [false, true]) {
        it(`${multiple ? 'multi' : 'single'} retains a selected newly denied native name, permits removal, and denies re-add`, (test) => {
            const { document, dispatch } = environment(test);
            const field = choiceField(multiple);
            const record: AirtableRecord = {
                id: 'rec00000000000001',
                fields: { [driverField.id]: 'denied' },
            };
            const changes: AirtableValue[] = [];
            const control = ui.createSelectControl({
                field,
                document,
                value: multiple ? [] : null,
                onChange: (value) => changes.push(value),
            });
            test.after(() => control.destroy());
            const driver = document.createElement('input');
            driver.value = 'denied';
            const recompute = () =>
                control.model.setOptions(
                    eligibleOptions({
                        field,
                        airtableFields: [driverField, field.airtableField],
                        recordForConditionEvaluation: record,
                        mode: 'runtime',
                        invalidConditionMode: 'compatibility',
                    })
                );
            driver.addEventListener('change', () => {
                record.fields[driverField.id] = driver.value;
                recompute();
            });
            document.body.append(driver, control.element);
            recompute();

            // The unchanged implementation admits Beta at this real control
            // sink, even though the current visible scalar driver denies it.
            control.model.choose(['Beta']);
            assert.deepEqual(control.model.getState().value, []);
            assert.deepEqual(changes, []);
            assert.deepEqual(
                control.model.getState().options.map((option) => option.value),
                ['Alpha']
            );

            driver.value = 'allowed';
            dispatch(driver);
            const select =
                control.element.querySelector<HTMLSelectElement>(
                    '[data-ui="select"]'
                );
            assert.ok(select);
            const beta = Array.from(select.options).find(
                (option) => option.value === 'Beta'
            );
            assert.ok(beta);
            assert.equal(beta.textContent, 'Conditional Beta');
            beta.selected = true;
            dispatch(select);
            assert.deepEqual(control.model.getState().value, ['Beta']);
            assert.deepEqual(changes, [multiple ? ['Beta'] : 'Beta']);

            driver.value = 'denied again';
            dispatch(driver);
            assert.deepEqual(control.model.getState().value, ['Beta']);
            assert.deepEqual(
                control.model.getState().options.map((option) => option.value),
                ['Alpha']
            );
            assert.deepEqual(
                control.model.getState().selectedOptions.map((option) => ({
                    value: option.value,
                    label: option.label,
                })),
                [{ value: 'Beta', label: 'Conditional Beta' }]
            );
            assert.deepEqual(changes, [multiple ? ['Beta'] : 'Beta']);
            control.model.clear();
            control.model.choose(['Beta']);
            assert.deepEqual(control.model.getState().value, []);
            assert.deepEqual(changes, [
                multiple ? ['Beta'] : 'Beta',
                multiple ? [] : null,
            ]);
        });
    }
});

const inputFor = (
    field = choiceField(false),
    value: AirtableValue = 'allowed'
): ui.SelectFieldAvailabilityInput => ({
    field,
    airtableFields: [driverField, field.airtableField],
    recordForConditionEvaluation: {
        id: 'rec00000000000001',
        fields: { [driverField.id]: value },
    },
    mode: 'runtime',
    invalidConditionMode: 'compatibility',
});

const configured = (field: RuntimeFieldSchema) => {
    const config = field.miniExtConfig;
    assert.ok(config && 'conditionsForOptions' in config);
    return config;
};

const withConditions = (conditions: unknown) => {
    const input = inputFor();
    const rule = configured(input.field).conditionsForOptions?.[0]?.config;
    assert.ok(rule);
    // Exercise malformed published JSON at the same runtime boundary, rather
    // than pretending TypeScript permits an invalid saved configuration.
    Reflect.set(rule, 'conditionsForOption', conditions);
    return input;
};

const leaf = (overrides: Record<string, unknown> = {}) => ({
    id: 'private-condition-id',
    type: 'singleCondition',
    setting: {
        type: 'contains',
        fieldType: 'singleLineText',
        idOrName: { type: 'id', id: driverField.id },
        value: 'allowed',
        ...overrides,
    },
});
const group = (...conditions: unknown[]) => ({
    logicalOperator: 'and',
    conditions,
});
const names = (result: ui.SelectFieldAvailability) =>
    result.options.map((option) => option.value);
const assertBlocked = (
    input: ui.SelectFieldAvailabilityInput,
    code: ui.SelectFieldAvailabilityDiagnostic['code']
) => {
    const result = ui.resolveSelectFieldAvailability(input);
    assert.equal(result.status, 'blocked');
    assert.deepEqual(result.options, []);
    assert.deepEqual(result.diagnostics, [{ code }]);
    return result;
};

describe('configured select availability policy and error boundaries', () => {
    it('preserves readonly and computed choices outside static limits at the native control sink', (test) => {
        const { document, dispatch } = environment(test);
        for (const mode of ['readonly', 'computed'] as const) {
            const input = inputFor();
            const config = configured(input.field);
            config.singleOrMultiSelectLimitSelectionOptions = ['sel_alpha'];
            if (mode === 'readonly') config.readOnly = true;
            else input.field.airtableField.isComputed = true;
            input.recordForConditionEvaluation = null;
            const changes: AirtableValue[] = [];
            const control = ui.createSelectControl({
                field: input.field,
                document,
                value: 'Alpha',
                onChange: (value) => changes.push(value),
            });
            test.after(() => control.destroy());
            control.model.setOptions(
                ui.resolveSelectFieldAvailability(input).options
            );
            assert.deepEqual(
                control.model.getState().options.map((option) => option.value),
                ['Alpha', 'Beta']
            );
            const select =
                control.element.querySelector<HTMLSelectElement>(
                    '[data-ui="select"]'
                );
            assert.ok(select);
            const beta = Array.from(select.options).find(
                (option) => option.value === 'Beta'
            );
            assert.ok(
                beta,
                'Readonly presentation must retain the unselected excluded choice'
            );
            assert.equal(beta.selected, false);
            assert.equal(select.disabled, true);
            control.model.choose(['Beta']);
            control.model.clear();
            select.value = 'Beta';
            dispatch(select);
            assert.deepEqual(control.model.getState().value, ['Alpha']);
            assert.deepEqual(changes, []);
        }
        const preview = inputFor();
        configured(preview.field).singleOrMultiSelectLimitSelectionOptions = [
            'sel_alpha',
        ];
        preview.mode = 'configuration-preview';
        preview.recordForConditionEvaluation = null;
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(preview)), [
            'Alpha',
        ]);
    });

    it('intersects static choice IDs and ignores excluded and deleted rule targets', () => {
        const input = inputFor();
        const config = configured(input.field);
        config.singleOrMultiSelectLimitSelectionOptions = ['sel_alpha'];
        Reflect.set(
            config.conditionsForOptions![0]!.config!,
            'conditionsForOption',
            group(leaf({ type: 'hasAnyOf', fieldType: 'multipleSelects' }))
        );
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
            'Alpha',
        ]);
        config.singleOrMultiSelectLimitSelectionOptions = ['Alpha'];
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), []);
        config.singleOrMultiSelectLimitSelectionOptions = [];
        config.conditionsForOptions![0]!.config!.optionForConditions =
            'deleted_id';
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
            'Alpha',
            'Beta',
        ]);
    });

    it('uses the first matching stable ID rule, including absent or null conditions', () => {
        const input = inputFor();
        const config = configured(input.field);
        const first = config.conditionsForOptions![0]!;
        config.conditionsForOptions!.push(structuredClone(first));
        Reflect.set(first.config!, 'conditionsForOption', null);
        Reflect.set(
            config.conditionsForOptions![1]!.config!,
            'conditionsForOption',
            group(leaf({ type: 'hasAnyOf', fieldType: 'multipleSelects' }))
        );
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
            'Alpha',
            'Beta',
        ]);
        Reflect.deleteProperty(first.config!, 'conditionsForOption');
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
            'Alpha',
            'Beta',
        ]);
        for (const malformed of [false, 0, '', 'private malformed AST']) {
            Reflect.set(first.config!, 'conditionsForOption', malformed);
            input.recordForConditionEvaluation =
                inputFor().recordForConditionEvaluation;
            assertBlocked(input, 'invalid-condition');
        }
    });

    it('bypasses dynamic evaluation for disabled, readonly, computed and preview modes', () => {
        for (const mode of [
            'disabled',
            'readonly',
            'computed',
            'preview',
        ] as const) {
            const input = withConditions(
                group(leaf({ type: 'hasAnyOf', fieldType: 'multipleSelects' }))
            );
            const config = configured(input.field);
            input.recordForConditionEvaluation = null;
            if (mode === 'disabled') config.enableConditionalOptions = false;
            if (mode === 'readonly') config.readOnly = true;
            if (mode === 'computed')
                input.field.airtableField.isComputed = true;
            if (mode === 'preview') input.mode = 'configuration-preview';
            const result = ui.resolveSelectFieldAvailability(input);
            assert.equal(result.status, 'ready');
            assert.deepEqual(names(result), ['Alpha', 'Beta']);
            assert.equal(
                result.options[1]?.label,
                mode === 'disabled' ? 'Beta' : 'Conditional Beta'
            );
            assert.deepEqual(result.diagnostics, []);
        }
    });

    it('blocks the whole dynamic field for missing record without silently clearing retained values', (test) => {
        const input = inputFor(choiceField(true));
        input.recordForConditionEvaluation = null;
        const result = assertBlocked(input, 'unavailable-record');
        const { document } = environment(test);
        const changes: AirtableValue[] = [];
        const control = ui.createSelectControl({
            field: input.field,
            document,
            value: ['Alpha', 'Beta'],
            onChange: (value) => changes.push(value),
        });
        test.after(() => control.destroy());
        control.model.setOptions(result.options);
        assert.deepEqual(control.model.getState().value, ['Alpha', 'Beta']);
        assert.deepEqual(changes, []);
        control.model.toggle('Beta');
        assert.deepEqual(control.model.getState().value, ['Alpha']);
        control.model.toggle('Beta');
        assert.deepEqual(control.model.getState().value, ['Alpha']);
        assert.deepEqual(changes, [['Alpha']]);
        configured(input.field).conditionsForOptions = [];
        assertBlocked(input, 'unavailable-record');
    });

    it('blocks unsupported siblings, malformed groups and invalid regex or literal bytes', () => {
        assertBlocked(
            withConditions({
                logicalOperator: 'or',
                conditions: [
                    leaf(),
                    leaf({ type: 'hasAnyOf', fieldType: 'multipleSelects' }),
                ],
            }),
            'unsupported-condition'
        );
        for (const conditions of [
            group(leaf({ type: 'matchesRegex', value: '[' })),
            group(leaf({ value: 'trailing\\' })),
        ])
            assertBlocked(withConditions(conditions), 'invalid-condition');
        assertBlocked(
            withConditions({ logicalOperator: 'xor', conditions: [leaf()] }),
            'unsupported-condition'
        );
    });

    it('keeps missing-field FALSE leaves and compatibility omissions local to their group', () => {
        const missing = leaf({ idOrName: { type: 'id', id: 'deleted_field' } });
        const nested = {
            type: 'groupCondition',
            logicalOperator: 'or',
            conditions: [missing, leaf()],
        };
        const input = withConditions(group(nested));
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
            'Alpha',
            'Beta',
        ]);
        input.invalidConditionMode = 'strict';
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
            'Alpha',
            'Beta',
        ]);
        assert.deepEqual(
            names(
                ui.resolveSelectFieldAvailability(
                    withConditions(group(missing))
                )
            ),
            ['Alpha']
        );
        const incomplete = leaf({ value: null });
        const compatibility = withConditions(group(incomplete, leaf()));
        assert.deepEqual(
            names(ui.resolveSelectFieldAvailability(compatibility)),
            ['Alpha', 'Beta']
        );
        compatibility.invalidConditionMode = 'strict';
        assertBlocked(compatibility, 'invalid-condition');
        assertBlocked(withConditions(group(incomplete)), 'invalid-condition');
    });

    it('blocks saved ID/name aliases and native value shadows in either metadata order', () => {
        const boolean = (id: string, name: string): RuntimeAirtableField => ({
            ...driverField,
            id,
            name,
            config: {
                type: 'checkbox',
                options: { icon: 'check', color: 'greenBright' },
            },
        });
        const cases = [
            {
                a: boolean('fld_a', 'fld_b'),
                b: boolean('fld_b', 'Other'),
                reference: { type: 'id', id: 'fld_a' },
            },
            {
                a: boolean('fld_a', 'Driver A'),
                b: boolean('fld_b', 'fld_a'),
                reference: { type: 'id', id: 'fld_a' },
            },
            {
                a: boolean('fld_a', 'fld_b'),
                b: boolean('fld_b', 'Other'),
                reference: { type: 'name', name: 'fld_b' },
            },
        ];
        for (const { a, b, reference } of cases) {
            for (const metadata of [
                [a, b],
                [b, a],
            ]) {
                const input = withConditions(
                    group(
                        leaf({
                            type: 'is',
                            fieldType: 'checkbox',
                            value: true,
                            idOrName: reference,
                        })
                    )
                );
                input.airtableFields = [...metadata, input.field.airtableField];
                input.recordForConditionEvaluation!.fields = {
                    fld_a: true,
                    fld_b: false,
                };
                assertBlocked(input, 'unsupported-condition');
                input.mode = 'configuration-preview';
                assert.deepEqual(
                    names(ui.resolveSelectFieldAvailability(input)),
                    ['Alpha', 'Beta']
                );
                input.mode = 'runtime';
                configured(input.field).enableConditionalOptions = false;
                assert.deepEqual(
                    names(ui.resolveSelectFieldAvailability(input)),
                    ['Alpha', 'Beta']
                );
                configured(input.field).enableConditionalOptions = true;
                configured(input.field).readOnly = true;
                assert.deepEqual(
                    names(ui.resolveSelectFieldAvailability(input)),
                    ['Alpha', 'Beta']
                );
            }
        }
        for (const reference of [
            { type: 'id', id: 'fld_a' },
            { type: 'name', name: 'Driver A' },
        ]) {
            const input = withConditions(
                group(
                    leaf({
                        type: 'is',
                        fieldType: 'checkbox',
                        value: true,
                        idOrName: reference,
                    })
                )
            );
            input.airtableFields = [
                boolean('fld_a', 'Driver A'),
                boolean('fld_b', 'Other'),
                input.field.airtableField,
            ];
            input.recordForConditionEvaluation!.fields = {
                fld_a: true,
                fld_b: false,
            };
            assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
                'Alpha',
                'Beta',
            ]);
            input.recordForConditionEvaluation!.fields.fld_a = false;
            assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
                'Alpha',
            ]);
        }
    });

    it('does not reject ambiguous references omitted by compatibility or missing-field FALSE compilation', () => {
        const input = withConditions({
            logicalOperator: 'or',
            conditions: [
                leaf({ idOrName: { type: 'id', id: 'deleted_field' } }),
                leaf({
                    idOrName: { type: 'id', id: 'fld_alias' },
                    value: null,
                }),
                leaf(),
            ],
        });
        input.airtableFields = [
            driverField,
            { ...driverField, id: 'fld_alias', name: 'fld_shadow' },
            { ...driverField, id: 'fld_shadow', name: 'deleted_field' },
            input.field.airtableField,
        ];
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
            'Alpha',
            'Beta',
        ]);
    });

    it('returns finite diagnostics for native nonfinite values and thrown conversion errors, then recovers', () => {
        const input = withConditions(
            group(leaf({ type: 'greaterThan', fieldType: 'number', value: 1 }))
        );
        const number = {
            ...driverField,
            config: { type: 'number', options: { precision: 2 } },
        } satisfies RuntimeAirtableField;
        input.airtableFields = [number, input.field.airtableField];
        for (const fault of [
            Infinity,
            NaN,
            { url: 'private conversion value' },
        ] as AirtableValue[]) {
            input.recordForConditionEvaluation!.fields[driverField.id] = fault;
            const result = assertBlocked(input, 'evaluation-error');
            const serialized = JSON.stringify(result.diagnostics);
            assert.equal(serialized.includes('private'), false);
            assert.equal(serialized.includes('conditions'), false);
            assert.equal(serialized.includes('formula'), false);
        }
        input.recordForConditionEvaluation!.fields[driverField.id] = 2;
        assert.deepEqual(names(ui.resolveSelectFieldAvailability(input)), [
            'Alpha',
            'Beta',
        ]);
        const ordinaryErrorText = withConditions(
            group(leaf({ value: '#ERROR!' }))
        );
        ordinaryErrorText.recordForConditionEvaluation!.fields[driverField.id] =
            '#ERROR!';
        assert.deepEqual(
            names(ui.resolveSelectFieldAvailability(ordinaryErrorText)),
            ['Alpha', 'Beta']
        );
    });

    it('preserves current names, label disambiguation, native record bytes and schema identity', () => {
        const input = inputFor();
        const config = configured(input.field);
        if (input.field.airtableField.config.type !== 'singleSelect')
            assert.fail('Expected select');
        input.field.airtableField.config.options.choices[1]!.name =
            'Renamed Beta';
        config.conditionsForOptions!.push({
            id: 'label_alpha',
            config: {
                ...structuredClone(config.conditionsForOptions![0]!.config!),
                optionForConditions: 'sel_alpha',
                name: 'Conditional Beta',
            },
        });
        const before = JSON.stringify(input);
        const freeze = (value: object): void => {
            for (const member of Object.values(value))
                if (member !== null && typeof member === 'object')
                    freeze(member);
            Object.freeze(value);
        };
        freeze(input);
        const result = ui.resolveSelectFieldAvailability(input);
        assert.deepEqual(
            result.options.map(({ id, value, label }) => ({
                id,
                value,
                label,
            })),
            [
                {
                    id: 'sel_alpha',
                    value: 'Alpha',
                    label: 'Conditional Beta (Alpha)',
                },
                {
                    id: 'sel_beta',
                    value: 'Renamed Beta',
                    label: 'Conditional Beta (Renamed Beta)',
                },
            ]
        );
        assert.equal(JSON.stringify(input), before);
        assert.equal(result.policy.maxSelections, 2);
        assert.equal(result.policy.allowAddingNewOptions, false);
    });
});
