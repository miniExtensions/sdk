import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import { readSingleSelectFormDriverOracle } from './single-select-form-driver-consumer-checks.mjs';
import { readMultipleSelectFormDriverOracle } from './multi-select-form-driver-consumer-checks.mjs';
import {
    conditionalField,
    conditionalRule,
} from '../test/fixtures/conditionalPageValidationCases.mjs';

const select = (id, type = 'singleSelect', mini = {}) =>
    conditionalField(id, type, mini, {
        config: {
            type,
            options: {
                choices: [
                    { id: 'a', name: 'Alpha' },
                    { id: 'b', name: 'Beta' },
                ],
            },
        },
    });
const rule = (type = 'is', value = 'b', fieldType = 'singleSelect') =>
    conditionalRule(type, value, fieldType);
const target = (id = 'single', type = 'singleSelect', conditions = rule()) =>
    select(id, type, {
        headerSectionTitle: 'Choices',
        enableConditionalOptions: true,
        conditionsForOptions: [
            {
                id: 'option-rule',
                config: {
                    optionForConditions: 'b',
                    name: ' Friendly Beta ',
                    conditionsForOption: conditions,
                },
            },
        ],
    });

/** Exercises the published resolver and actual native Form owners, never a copied policy. */
export async function checkSelectOptionDriverModules(
    forms,
    runtime,
    ui,
    makeLoaded
) {
    let checks = 0;
    const resolve = (field, fields, data) =>
        ui.resolveSelectFieldAvailability({
            field,
            airtableFields: fields,
            recordForConditionEvaluation: { id: '', fields: data },
            mode: 'runtime',
            invalidConditionMode: 'strict',
        });
    // Canonical predicate outcomes are reused from the independently pinned frontend oracle.
    for (const oracle of [
        readSingleSelectFormDriverOracle(),
        readMultipleSelectFormDriverOracle(),
    ]) {
        for (const c of oracle.cases) {
            const result = resolve(
                target('single', 'singleSelect', c.rule),
                c.input.airtableFields,
                c.input.data
            );
            assert.equal(result.status, 'ready', c.name);
            assert.deepEqual(
                result.options.map((o) => o.value),
                c.expected.conditionMet ? ['Alpha', 'Beta'] : ['Alpha'],
                c.name
            );
            checks++;
        }
    }
    for (const [kind, operators, unsafe] of [
        [
            'singleSelect',
            ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
            [[], ['Beta'], {}, 1, true],
        ],
        [
            'multipleSelects',
            [
                'hasAnyOf',
                'hasAllOf',
                'hasNoneOf',
                'isExactly',
                'isEmpty',
                'isNotEmpty',
            ],
            ['Beta', {}, [1], [null], new Array(1)],
        ],
    ]) {
        for (const operator of operators) {
            const operand =
                kind === 'multipleSelects' ||
                ['isAnyOf', 'isNoneOf'].includes(operator)
                    ? ['deleted']
                    : 'deleted';
            for (const native of unsafe) {
                const result = resolve(
                    target(
                        'single',
                        'singleSelect',
                        rule(operator, operand, kind)
                    ),
                    [select('driver', kind).airtableField],
                    { driver: native }
                );
                assert.equal(
                    result.status,
                    'blocked',
                    `${kind}/${operator}: original AST admission before FALSE folding`
                );
                assert.deepEqual(result.options, []);
                checks++;
            }
        }
    }
    // Mixed rules retain the existing scalar ID/name ambiguity refusals.
    const scalar = conditionalField('scalar', 'singleLineText').airtableField;
    const scalarRule = conditionalRule('is', 'keep', 'singleLineText', {
        type: 'id',
        id: 'scalar',
    });
    const mixed = {
        logicalOperator: 'and',
        conditions: [...rule().conditions, ...scalarRule.conditions],
    };
    for (const fields of [
        [
            select('driver').airtableField,
            { ...scalar, name: 'shadow' },
            { ...scalar, id: 'shadow', name: 'Other' },
        ],
        [
            select('driver').airtableField,
            scalar,
            { ...scalar, id: 'other', name: 'scalar' },
        ],
    ]) {
        const result = resolve(
            target('single', 'singleSelect', mixed),
            fields,
            {
                driver: 'Beta',
                scalar: 'keep',
            }
        );
        assert.equal(result.status, 'blocked');
        assert.equal(result.diagnostics[0].code, 'unsupported-condition');
        checks++;
    }
    const validMixed = resolve(
        target('single', 'singleSelect', mixed),
        [select('driver').airtableField, scalar],
        { driver: 'Beta', scalar: 'keep' }
    );
    assert.equal(validMixed.status, 'ready');
    assert.deepEqual(
        validMixed.options.map((o) => o.value),
        ['Alpha', 'Beta']
    );
    checks++;
    const firstRule = target();
    firstRule.miniExtConfig.conditionsForOptions.unshift({
        id: 'first-unrestricted',
        config: { optionForConditions: 'b', conditionsForOption: null },
    });
    assert.deepEqual(
        resolve(firstRule, [select('driver').airtableField], {
            driver: 'Alpha',
        }).options.map((o) => o.value),
        ['Alpha', 'Beta'],
        'First matching null rule wins over a later rejecting rule'
    );
    checks++;
    const make = (configure = () => {}) => {
        const loaded = makeLoaded();
        Object.assign(loaded.payload, {
            hasParentExtension: false,
            fieldIdsInForm: ['driver', 'single', 'multi'],
            fieldIdsToSchemas: {
                driver: select('driver'),
                single: target(),
                multi: target('multi', 'multipleSelects'),
            },
            formRecord: {
                type: 'create',
                data: {
                    driver: 'Alpha',
                    single: 'Beta',
                    multi: ['Beta', 'Beta', 'Alpha'],
                    native: { retained: ['exact'] },
                },
            },
            formFieldIdsWithUnsavedChanges: ['native'],
            urlPrefilledFieldIds: [],
            publicFields: {
                type: 'form',
                state: {
                    multiPageFormMode: 'multi-page',
                    promptUserBeforeSubmission: false,
                    enableFormComputeMode: false,
                    autoSubmitAfterPrefill: false,
                },
            },
        });
        configure(loaded);
        let config = 0,
            owner = 0;
        const saves = [];
        const client = runtime.createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            session: { visitor: 'A' },
            fetch: async () => {
                throw Error('Unexpected I/O');
            },
        });
        client.forms.save = async (input) => {
            saves.push(structuredClone(input));
            return { type: 'error', formValidationErrors: [], formErrors: {} };
        };
        const saveOptions = {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: { exact: 'kept' },
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        };
        const fields = forms.createFormFieldBindings({
            loaded,
            client,
            saveOptions,
            getScope: () => ({ ownerId: `owner-${owner}`, revision: owner }),
        });
        const hostOptions = {
            fields,
            fieldId: 'single',
            isCurrent: () => true,
            configurationRevision: () => config,
        };
        return {
            loaded,
            fields,
            saves,
            saveOptions,
            hostOptions,
            retireConfig: () => config++,
            retireOwner: () => {
                owner++;
                fields.refresh();
            },
            close: () => fields.destroy(),
        };
    };
    const options = (f, id = 'single') =>
        f.fields
            .field(id)
            .selection.getState()
            .options.map((o) => o.value);
    const f = make();
    try {
        const before = structuredClone(
            f.fields.controller.getState().draft.data
        );
        assert.deepEqual(options(f), ['Alpha']);
        assert.equal(f.fields.field('single').getSnapshot().value, 'Beta');
        assert.deepEqual(
            f.fields.field('multi').getSnapshot().value,
            before.multi
        );
        await f.fields.save();
        assert.deepEqual(f.saves[0], {
            ...f.saveOptions,
            extensionAccessToken: f.loaded.payload.extensionAccessToken,
            formRecord: { type: 'create', data: before },
            formFieldIdsWithUnsavedChanges: ['native'],
        });
        f.fields.field('single').selection.clear();
        f.fields.field('single').selection.choose(['Beta']);
        assert.equal(f.fields.field('single').getSnapshot().value, null);
        assert(f.fields.field('driver').setValue('Beta').accepted);
        assert.deepEqual(
            options(f),
            ['Alpha', 'Beta'],
            'driver changes refresh a target on another page'
        );
        f.fields.field('single').selection.choose(['Beta']);
        assert.equal(f.fields.field('single').getSnapshot().value, 'Beta');
        assert.equal(
            f.fields.field('single').selection.getState().options[1].label,
            'Friendly Beta'
        );
        await f.fields.save();
        assert.deepEqual(f.saves[1], {
            ...f.saveOptions,
            extensionAccessToken: f.loaded.payload.extensionAccessToken,
            formRecord: { type: 'create', data: { ...before, driver: 'Beta' } },
            formFieldIdsWithUnsavedChanges: ['native', 'single', 'driver'],
        });
        checks++;
    } finally {
        f.close();
    }
    const hidden = make((p) => {
        p.payload.formRecord.data.driver = 'Beta';
        p.payload.fieldIdsToSchemas.driver.miniExtConfig.conditionalFields =
            rule('is', 'a');
    });
    try {
        assert.deepEqual(options(hidden), ['Alpha']);
        assert.equal(hidden.fields.field('driver').getSnapshot().value, 'Beta');
        checks++;
    } finally {
        hidden.close();
    }
    for (const configure of [
        (p) => {
            p.payload.fieldIdsToSchemas.driver.airtableField.isComputed = true;
        },
        ...[
            'multipleRecordLinks',
            'date',
            'formula',
            'multipleLookupValues',
        ].map((kind) => (p) => {
            p.payload.fieldIdsToSchemas.driver = conditionalField(
                'driver',
                kind
            );
            p.payload.fieldIdsToSchemas.single = target(
                'single',
                'singleSelect',
                rule('is', 'b', kind)
            );
        }),
        (p) => {
            p.payload.fieldIdsToSchemas.single = target(
                'single',
                'singleSelect',
                conditionalRule('is', 'b', 'singleSelect', {
                    type: 'name',
                    name: 'driver',
                })
            );
        },
    ]) {
        const refused = make(configure);
        try {
            assert.equal(
                refused.fields.field('single').getSnapshot().selectAvailability
                    .status,
                'blocked'
            );
            assert.deepEqual(options(refused), []);
            assert.equal(refused.saves.length, 0);
            checks++;
        } finally {
            refused.close();
        }
    }
    const limited = make((p) => {
        p.payload.formRecord.data.driver = 'Beta';
        p.payload.formRecord.data.multi = ['Alpha'];
        p.payload.fieldIdsToSchemas.multi.miniExtConfig.singleOrMultiSelectLimitSelectionOptions =
            ['a'];
        p.payload.fieldIdsToSchemas.multi.miniExtConfig.maxNumberOfSelections = 1;
        p.payload.fieldIdsToSchemas.single.miniExtConfig.readOnly = true;
    });
    try {
        assert.deepEqual(options(limited, 'multi'), ['Alpha']);
        const before = structuredClone(
            limited.fields.controller.getState().draft
        );
        limited.fields.field('single').selection.clear();
        limited.fields.field('multi').selection.choose(['Alpha', 'Beta']);
        assert.deepEqual(limited.fields.controller.getState().draft, before);
        checks++;
    } finally {
        limited.close();
    }
    const maximum = make((p) => {
        p.payload.formRecord.data.driver = 'Beta';
        p.payload.formRecord.data.multi = ['Alpha'];
        p.payload.fieldIdsToSchemas.multi.miniExtConfig.maxNumberOfSelections = 1;
    });
    try {
        assert.deepEqual(options(maximum, 'multi'), ['Alpha', 'Beta']);
        const before = structuredClone(
            maximum.fields.controller.getState().draft
        );
        maximum.fields.field('multi').selection.choose(['Alpha', 'Beta']);
        assert.deepEqual(maximum.fields.controller.getState().draft, before);
        checks++;
    } finally {
        maximum.close();
    }
    for (const retirement of ['retireConfig', 'retireOwner']) {
        const stale = make();
        const host = ui.createFormFieldRendererHost(stale.hostOptions);
        try {
            const old = host.getSnapshot().fields[0].capability;
            stale[retirement]();
            const before = structuredClone(
                stale.fields.controller.getState().draft
            );
            old.selection.choose(['Alpha']);
            assert.equal(old.setValue('Alpha').accepted, false);
            assert.deepEqual(stale.fields.controller.getState().draft, before);
            assert.equal(host.getSnapshot().status, 'retired');
            // A real owner replacement needs new bindings; remounting a
            // renderer must not revive the retired native Form owner.
            const successor = retirement === 'retireOwner' ? make() : stale;
            const fresh = ui.createFormFieldRendererHost(successor.hostOptions);
            try {
                assert.equal(
                    fresh.getSnapshot().fields[0].selectAvailability.status,
                    'ready'
                );
            } finally {
                fresh.dispose();
                if (successor !== stale) successor.close();
            }
            assert.equal(stale.saves.length, 0);
            checks++;
        } finally {
            host.dispose();
            stale.close();
        }
    }
    return checks;
}

export async function checkSelectOptionDriverConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const load = (module) =>
        import(
            pathToFileURL(
                join(
                    consumerDirectory,
                    'node_modules/@miniextensions/sdk/dist/esm',
                    module,
                    'index.js'
                )
            )
        );
    const makeLoaded = () =>
        portalRecipeFixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
    const [forms, runtime, ui] = await Promise.all(
        ['forms', 'runtime', 'ui'].map(load)
    );
    let checks = await checkSelectOptionDriverModules(
        forms,
        runtime,
        ui,
        makeLoaded
    );
    checks += await checkSelectOptionDriverModules(
        require('@miniextensions/sdk/forms'),
        require('@miniextensions/sdk'),
        require('@miniextensions/sdk/ui'),
        makeLoaded
    );
    return checks;
}
