import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const canonicalFixtureUrl = new URL(
    '../test/fixtures/singleSelectFormDrivers.json',
    import.meta.url
);
const canonicalCaseIds = [
    'is-matching',
    'is-nonmatching',
    'is-null',
    'is-empty',
    'isNot-matching',
    'isNot-nonmatching',
    'isNot-null',
    'isNot-empty',
    'isAnyOf-matching',
    'isAnyOf-nonmatching',
    'isAnyOf-null',
    'isAnyOf-empty',
    'isNoneOf-matching',
    'isNoneOf-nonmatching',
    'isNoneOf-null',
    'isNoneOf-empty',
    'isEmpty-matching',
    'isEmpty-nonmatching',
    'isEmpty-null',
    'isEmpty-empty',
    'isNotEmpty-matching',
    'isNotEmpty-nonmatching',
    'isNotEmpty-null',
    'isNotEmpty-empty',
    'is-unknown-choice-false',
    'isNot-unknown-choice-false',
    'isAnyOf-unknown-choice-false',
    'isNoneOf-unknown-choice-false',
    'isAnyOf-mixed-known-unknown',
    'isNoneOf-mixed-known-unknown',
    'is-missing-native',
    'isNot-missing-native',
    'isAnyOf-missing-native',
    'isNoneOf-missing-native',
    'isEmpty-missing-native',
    'isNotEmpty-missing-native',
    'renamed-choice-current-native',
    'renamed-choice-stale-native',
    'renamed-field-saved-id',
    'exact-native-case',
    'exact-native-whitespace',
    'escaped-native-choice-name',
    'retained-enabled-section-header-order',
    'retained-disabled-section-header-order',
    'hidden-driver-full-native-snapshot',
    'section-follower-own-select-rule',
    'nested-select-group',
    'readonly-validation-skips',
];
const pinnedCanonicalSources = {
    'components/PublicExtension/helpers/getFormRecordWithFieldsRemovedIfHiddenByConditionalFields.ts':
        '66c1ec59ca43900539406a24fd14764f2a36b3de6a58c2d196fc4d06a593b5ba',
    'utils/isFieldHiddenByConditionalFields.ts':
        'b0f31ce92fab137306cc54d2e79678d38421aa436913f9efdfd49acd8c96f3b7',
    'types/extensions/conditions/convertConditionalFields.ts':
        '397b3a1a35ae07d0235d6477078cc10e7cf02ba00e02269272b4b3946f0dd3e1',
    'types/airtableMock/formulas/index.ts':
        'e4169421073e02ce37ecbe0c5e142584634572020781ebeaeec6b6bb48704d7f',
    'types/airtableMock/formulas/interpreter/interpreter.ts':
        '5874a557ada2e1a860af6f8bf4953b9039b40e0fca84616c96fb74c77f700d3f',
    'components/PublicExtension/helpers/form-validation.ts':
        '768b7d657fd670c70918f540147fc6abbbd18513ba7605a0f4631999ad333810',
    'types/helpers/isEnableFieldValidationsForField.ts':
        '94e1ab19162424a0898db09a79cbbcf103b98047c33751bb34b09685c0f617b0',
};
const hash = (path) =>
    createHash('sha256').update(readFileSync(path)).digest('hex');
export function readSingleSelectFormDriverOracle() {
    const fixture = JSON.parse(readFileSync(canonicalFixtureUrl, 'utf8'));
    assert.equal(
        fixture.provenance.revision,
        '58f73d575ab10baa0a10693660d8002f204368e1'
    );
    assert.equal(
        fixture.provenance.tree,
        'b39e58ead46a311c497def57474cf5ca720542ae'
    );
    assert.equal(
        fixture.provenance.generator,
        'scripts/generate-single-select-form-driver-fixtures.mjs'
    );
    assert.equal(
        fixture.provenance.casesSource,
        'test/fixtures/singleSelectFormDriverCases.mjs'
    );
    assert.equal(
        fixture.provenance.generatorSha256,
        hash(new URL('../' + fixture.provenance.generator, import.meta.url))
    );
    assert.equal(
        fixture.provenance.casesSourceSha256,
        hash(new URL('../' + fixture.provenance.casesSource, import.meta.url))
    );
    assert.deepEqual(fixture.provenance.sources, pinnedCanonicalSources);
    assert.deepEqual(
        fixture.cases.map((c) => c.name),
        canonicalCaseIds
    );
    assert.equal(new Set(canonicalCaseIds).size, 48);
    return fixture;
}

const text = (id, miniExtConfig = {}) => ({
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
const choice = () => ({
    fieldType: 'singleSelect',
    airtableField: {
        id: 'request',
        name: 'Request type',
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: 'singleSelect',
            options: {
                choices: [
                    { id: 'general', name: 'General' },
                    { id: 'other', name: 'Other' },
                ],
            },
        },
    },
    miniExtConfig: {},
});
const condition = (type = 'is', value = 'other') => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'driver',
            type: 'singleCondition',
            setting: {
                type,
                fieldType: 'singleSelect',
                value,
                idOrName: { type: 'id', id: 'request' },
            },
        },
    ],
});

/** Shared source and genuinely installed ESM/CJS behavior; synthetic transport only. */
export async function runSingleSelectFormDriverChecks(
    forms,
    runtime,
    makeLoaded,
    createFormConditionRecordProjection
) {
    let checks = 0;
    const evaluate = (definition, native, fields = [choice().airtableField]) =>
        forms.evaluateFormFieldVisibility({
            field: text('details', { conditionalFields: definition }),
            airtableFields: fields,
            data: { request: native },
            formRecordType: 'create',
            evaluationMode: 'runtime',
            invalidConditionMode: 'strict',
        });
    // Explicit expectations mirror canonical native-name comparisons, including null.
    const semantics = [
        ['is', 'other', ['visible', 'hidden', 'hidden']],
        ['isNot', 'other', ['hidden', 'visible', 'visible']],
        ['isAnyOf', ['other', 'other'], ['visible', 'hidden', 'hidden']],
        ['isNoneOf', ['other', 'other'], ['hidden', 'visible', 'visible']],
        ['isEmpty', null, ['hidden', 'hidden', 'visible']],
        ['isNotEmpty', null, ['visible', 'visible', 'hidden']],
    ];
    for (const [operator, operand, expected] of semantics) {
        for (const [index, native] of ['Other', 'General', null].entries()) {
            assert.equal(
                evaluate(condition(operator, operand), native).type,
                expected[index],
                `${operator}/${native}`
            );
            checks++;
        }
    }
    for (const operator of ['is', 'isNot', 'isAnyOf', 'isNoneOf']) {
        const definition = condition(
            operator,
            operator.includes('Of') ? ['deleted'] : 'deleted'
        );
        const compiled = forms.compileRuntimeConditions({
            conditions: definition,
            airtableFields: [choice().airtableField],
            invalidConditionMode: 'strict',
        });
        assert.equal(compiled.type, 'compiled');
        assert.equal(compiled.formula, 'FALSE()');
        assert.equal(evaluate(definition, 'Other').type, 'hidden');
        // Original AST admission must survive elimination of every formula identifier.
        for (const native of [[], ['Other'], {}, { name: 'Other' }])
            assert.equal(evaluate(definition, native).type, 'blocked');
        checks++;
    }
    for (const native of [[], ['Other'], {}, { id: 'other' }, 1, true]) {
        assert.equal(evaluate(condition(), native).type, 'blocked');
        checks++;
    }
    for (const mutate of [
        (f) => {
            f.isComputed = true;
        },
        (f) => {
            f.config.type = 'multipleSelects';
        },
        (f) => {
            f.config.options = null;
        },
        (f) => {
            f.config.options.choices.push({ id: 'other', name: 'Duplicate' });
        },
        (f) => {
            f.config.options.choices.push({ id: 'third', name: 'Other' });
        },
    ]) {
        const physical = choice().airtableField;
        mutate(physical);
        assert.equal(
            evaluate(condition('is', 'deleted'), 'Other', [physical]).type,
            'blocked'
        );
        checks++;
    }
    assert.equal(
        evaluate(condition('is', 'deleted'), 'Other', []).type,
        'blocked'
    );
    const alias = text('alias').airtableField;
    alias.name = 'request';
    assert.equal(
        evaluate(condition('is', 'deleted'), 'Other', [
            choice().airtableField,
            alias,
        ]).type,
        'blocked'
    );
    assert.equal(
        evaluate(condition(), 'Other', [
            choice().airtableField,
            choice().airtableField,
        ]).type,
        'blocked'
    );
    const named = condition();
    named.conditions[0].setting.idOrName = {
        type: 'name',
        name: 'Request type',
    };
    assert.equal(evaluate(named, 'Other').type, 'blocked');
    const multi = choice().airtableField;
    multi.config.type = 'multipleSelects';
    multi.isComputed = true;
    const multiDefinition = condition('hasAnyOf', ['other']);
    multiDefinition.conditions[0].setting.fieldType = 'multipleSelects';
    assert.equal(evaluate(multiDefinition, ['Other'], [multi]).type, 'blocked');

    const make = (configure = () => {}) => {
        const loaded = makeLoaded();
        loaded.payload.hasParentExtension = false;
        loaded.payload.fieldIdsInForm = ['request', 'details', 'tail'];
        loaded.payload.fieldIdsToSchemas = {
            request: choice(),
            details: text('details', {
                headerSectionTitle: 'Details',
                required: true,
                conditionalFields: condition(),
            }),
            tail: text('tail', { headerSectionTitle: 'Finish' }),
        };
        loaded.payload.formRecord = {
            type: 'create',
            data: {
                request: 'General',
                details: '',
                tail: 'Kept',
                untouched: { text: 'native' },
            },
        };
        loaded.payload.formFieldIdsWithUnsavedChanges = ['untouched'];
        loaded.payload.urlPrefilledFieldIds = [];
        loaded.payload.publicFields = {
            type: 'form',
            state: {
                multiPageFormMode: 'multi-page',
                promptUserBeforeSubmission: false,
                enableFormComputeMode: false,
                autoSubmitAfterPrefill: false,
            },
        };
        configure(loaded);
        let config = 0,
            owner = true,
            scope = { ownerId: 'A', revision: 0 };
        const calls = [];
        const client = runtime.createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            session: { visitor: 'A' },
            fetch: async () => {
                throw Error('Unexpected request');
            },
        });
        client.forms.save = async (input) => {
            calls.push(structuredClone(input));
            return { type: 'error', formValidationErrors: [], formErrors: {} };
        };
        const options = {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: { kept: 'exact' },
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
        };
        const fields = forms.createFormFieldBindings({
            client,
            loaded,
            saveOptions: options,
            getScope: () => scope,
        });
        const pages = forms.createFormPageOwner({
            fields,
            isCurrent: () => owner,
            configurationRevision: () => config,
        });
        return {
            loaded,
            fields,
            pages,
            client,
            calls,
            options,
            config: (value) => {
                config = value;
            },
            owner: (value) => {
                owner = value;
            },
            scope: (value) => {
                scope = value;
            },
            close() {
                pages.dispose();
                fields.destroy();
            },
        };
    };
    const noSave = async (f, revision = f.pages.getSnapshot().revision) => {
        let attempts = 0;
        await assert.rejects(
            f.pages.submit(revision, {
                lifecycle: {
                    dispatch() {
                        attempts++;
                        return { accepted() {}, finish() {} };
                    },
                },
            })
        );
        assert.equal(attempts, 0);
        assert.equal(f.calls.length, 0);
    };
    for (const c of readSingleSelectFormDriverOracle().cases) {
        const before = structuredClone(c.input);
        const compiled = forms.compileRuntimeConditions({
            conditions: c.rule,
            airtableFields: c.input.airtableFields,
            invalidConditionMode: 'strict',
        });
        assert.equal(compiled.type, 'compiled', c.name);
        assert.equal(compiled.formula, c.expected.formula, c.name);
        const context = {
            ...c.input,
            formRecordType: 'edit',
            evaluationMode: 'runtime',
        };
        const decision = forms.evaluateFormFieldVisibility({
            ...context,
            field: text('probe', { conditionalFields: c.rule }),
        });
        assert.equal(
            decision.type,
            c.expected.conditionMet ? 'visible' : 'hidden',
            c.name
        );
        const visibility = forms.composeFormFieldVisibility(context);
        const projected = createFormConditionRecordProjection(c.input);
        assert.equal(projected.type, 'available', c.name);
        assert.deepEqual(
            projected.hiddenFieldIds,
            c.expected.hiddenFieldIds,
            c.name
        );
        assert.deepEqual(projected.record, c.expected.record, c.name);
        const screenHidden = c.input.fieldIds.filter(
            (id) => visibility[id].type === 'hidden'
        );
        const expectedScreenHidden =
            c.name === 'retained-disabled-section-header-order'
                ? ['target']
                : c.expected.hiddenFieldIds;
        assert.deepEqual(screenHidden, expectedScreenHidden, c.name);
        if (c.name === 'retained-disabled-section-header-order') {
            assert.equal(visibility.target.type, 'hidden');
            assert.equal(visibility.follower.type, 'visible');
        }
        assert.equal(
            forms.createScalarFormRecordProjection(c.input).type,
            'blocked',
            c.name
        );
        assert.equal(
            forms.createFlatScalarFormRecordProjection(c.input).type,
            'blocked',
            c.name
        );
        const f = make((p) => {
            p.payload.fieldIdsInForm = structuredClone(c.input.fieldIds);
            p.payload.fieldIdsToSchemas = structuredClone(
                c.input.fieldIdsToSchemas
            );
            p.payload.formRecord.data = structuredClone(c.input.data);
            p.payload.formFieldIdsWithUnsavedChanges = [];
            p.payload.publicFields.state.multiPageFormMode = 'one-page';
        });
        try {
            const snapshot = f.pages.getSnapshot();
            const actual = snapshot.problems.filter(
                (p) => p.fieldId === 'validationTarget'
            );
            assert.deepEqual(
                actual.map((p) => p.code),
                c.expected.validation.invalid ? ['conditional-validation'] : [],
                c.name
            );
            assert.deepEqual(
                f.fields.controller.getState().draft.data,
                c.input.data,
                c.name
            );
            for (const id of c.input.fieldIds)
                assert.equal(
                    f.fields.field(id).getSnapshot().visibility.type,
                    visibility[id].type,
                    `${c.name}/${id}`
                );
            if (c.expected.validation.invalid) await noSave(f);
            assert.deepEqual(
                f.fields.controller.getState().draft.data,
                c.input.data,
                c.name
            );
            assert.equal(f.calls.length, 0, c.name);
        } finally {
            f.close();
        }
        assert.equal(c.expected.inputUnchanged, true);
        assert.deepEqual(c.input, before, c.name);
        checks++;
    }
    const f = make();
    try {
        const retained = f.pages.getSnapshot().revision;
        assert.equal(f.pages.getSnapshot().pages[1].hidden, true);
        assert(f.fields.field('request').setValue('Other').accepted);
        assert.equal(f.pages.getSnapshot().pages[1].hidden, false);
        assert.deepEqual(f.pages.next(retained), {
            accepted: false,
            reason: 'stale-revision',
        });
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().canNext, false);
        await noSave(f);
        assert(
            f.pages
                .getSnapshot()
                .problems.some(
                    (p) => p.fieldId === 'details' && p.code === 'required'
                )
        );
        assert(f.fields.field('details').setValue('Explain').accepted);
        assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
        assert(f.fields.field('request').setValue('General').accepted);
        assert.equal(f.fields.field('details').getSnapshot().value, 'Explain');
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.pages.getSnapshot().activePageIndex, 2);
        await f.pages.submit(f.pages.getSnapshot().revision);
        assert.deepEqual(f.calls, [
            {
                ...f.options,
                extensionAccessToken: f.loaded.payload.extensionAccessToken,
                formRecord: {
                    type: 'create',
                    data: {
                        request: 'General',
                        details: 'Explain',
                        tail: 'Kept',
                        untouched: { text: 'native' },
                    },
                },
                formFieldIdsWithUnsavedChanges: [
                    'untouched',
                    'request',
                    'details',
                ],
            },
        ]);
        checks++;
    } finally {
        f.close();
    }
    for (const retire of [
        (f) => f.config(1),
        (f) => f.owner(false),
        (f) => {
            f.scope({ ownerId: 'B', revision: 1 });
            f.pages.getSnapshot();
            f.scope({ ownerId: 'A', revision: 0 });
        },
        (f) => {
            f.client.setSession({ visitor: 'B' });
            f.pages.getSnapshot();
            f.client.setSession({ visitor: 'A' });
        },
    ]) {
        const f = make();
        try {
            const revision = f.pages.getSnapshot().revision;
            retire(f);
            await noSave(f, revision);
            checks++;
        } finally {
            f.close();
        }
    }
    for (const [operator, operand, expected] of semantics) {
        for (const [index, native] of ['Other', 'General', null].entries()) {
            const f = make((p) => {
                p.payload.formRecord.data.request = native;
                p.payload.fieldIdsToSchemas.details.miniExtConfig = {
                    headerSectionTitle: 'Details',
                    fieldValidationConditionalFields: condition(
                        operator,
                        operand
                    ),
                    customErrorMessageForFieldValidation:
                        'Configured validation failed',
                };
            });
            try {
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                const valid = expected[index] === 'visible';
                assert.equal(
                    f.pages.getSnapshot().canNext,
                    valid,
                    `validation ${operator}/${native}`
                );
                assert.deepEqual(
                    f.pages
                        .getSnapshot()
                        .problems.filter((p) => p.fieldId === 'details')
                        .map((p) => p.code),
                    valid ? [] : ['conditional-validation']
                );
                if (!valid) await noSave(f);
                checks++;
            } finally {
                f.close();
            }
        }
    }
    for (const [mode, expectedCode] of [
        ['ordinary', 'required'],
        ['advanced', 'conditional-validation'],
        ['readonly', null],
        ['hidden', null],
    ]) {
        const f = make((p) => {
            p.payload.fieldIdsToSchemas.details.miniExtConfig = {
                headerSectionTitle: 'Details',
                required: mode === 'ordinary',
                readOnly: mode === 'readonly',
                conditionalFields: mode === 'hidden' ? condition() : null,
                fieldValidationConditionalFields: condition(),
            };
        });
        try {
            if (mode !== 'hidden')
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
            const problems = f.pages
                .getSnapshot()
                .problems.filter((p) => p.fieldId === 'details');
            assert.deepEqual(
                problems.map((p) => p.code),
                expectedCode == null ? [] : [expectedCode]
            );
            if (expectedCode != null) await noSave(f);
            checks++;
        } finally {
            f.close();
        }
    }
    for (const readOnly of [true, false]) {
        const f = make((p) => {
            p.payload.formRecord.data.request = 'Other';
            p.payload.fieldIdsToSchemas.request.miniExtConfig = {
                readOnly,
                conditionalFields: {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'hide-driver',
                            type: 'singleCondition',
                            setting: {
                                type: 'is',
                                fieldType: 'singleLineText',
                                idOrName: { type: 'id', id: 'tail' },
                                value: 'Never',
                            },
                        },
                    ],
                },
            };
        });
        try {
            assert.equal(f.pages.getSnapshot().pages[1].hidden, false);
            assert.equal(
                f.fields.field('request').getSnapshot().value,
                'Other'
            );
            checks++;
        } finally {
            f.close();
        }
    }
    const sectionDriver = choice(),
        section = text('details', {
            headerSectionTitle: 'Details',
            applyFieldConditionsToSection: true,
            conditionalFields: condition(),
        }),
        member = text('member');
    const projectionInput = {
        fieldIds: ['request', 'details', 'member'],
        fieldIdsToSchemas: { request: sectionDriver, details: section, member },
        airtableFields: [
            sectionDriver.airtableField,
            section.airtableField,
            member.airtableField,
        ],
        data: {
            request: 'General',
            details: 'Retained',
            member: 'Retained member',
        },
        recordId: '',
        invalidConditionMode: 'strict',
    };
    const sectionResult = forms.composeFormFieldVisibility({
        ...projectionInput,
        formRecordType: 'create',
        evaluationMode: 'runtime',
    });
    assert.equal(sectionResult.request.type, 'visible');
    assert.equal(sectionResult.details.type, 'hidden');
    assert.equal(sectionResult.member.type, 'hidden');
    assert.equal(
        forms.createScalarFormRecordProjection(projectionInput).type,
        'blocked',
        'Public scalar section projection retains its select refusal'
    );
    assert.deepEqual(projectionInput.data, {
        request: 'General',
        details: 'Retained',
        member: 'Retained member',
    });
    const flatInput = structuredClone(projectionInput);
    delete flatInput.fieldIdsToSchemas.details.miniExtConfig.headerSectionTitle;
    delete flatInput.fieldIdsToSchemas.details.miniExtConfig
        .applyFieldConditionsToSection;
    assert.equal(
        forms.createFlatScalarFormRecordProjection(flatInput).type,
        'blocked',
        'Legacy flat scalar projection keeps its select refusal'
    );
    return checks;
}

export async function checkSingleSelectFormDriverConsumer({
    consumerDirectory,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const forms = await import(pathToFileURL(join(esm, 'forms/index.js')));
    const runtime = await import(pathToFileURL(join(esm, 'runtime/index.js')));
    const esmProjection = await import(
        pathToFileURL(join(esm, 'forms/projection.js'))
    );
    const cjsProjection = require(
        join(
            consumerDirectory,
            'node_modules/@miniextensions/sdk/dist/cjs/forms/projection.js'
        )
    );
    const makeLoaded = () =>
        portalRecipeFixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
    let checks = 0;
    for (const [f, r, projection] of [
        [forms, runtime, esmProjection],
        [
            require('@miniextensions/sdk/forms'),
            require('@miniextensions/sdk'),
            cjsProjection,
        ],
    ])
        checks += await runSingleSelectFormDriverChecks(
            f,
            r,
            makeLoaded,
            projection.createFormConditionRecordProjection
        );
    return checks;
}
