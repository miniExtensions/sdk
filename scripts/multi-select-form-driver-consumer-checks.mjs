import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import { readSingleSelectFormDriverOracle } from './single-select-form-driver-consumer-checks.mjs';

// The literal case inventory is independent of the fixture and its generator.
const canonicalCaseIds = [
    'hasAnyOf-matching',
    'hasAnyOf-nonmatching',
    'hasAnyOf-null',
    'hasAnyOf-empty',
    'hasAnyOf-duplicate-native',
    'hasAnyOf-unknown-native',
    'hasAllOf-matching',
    'hasAllOf-nonmatching',
    'hasAllOf-null',
    'hasAllOf-empty',
    'hasAllOf-duplicate-native',
    'hasAllOf-unknown-native',
    'hasNoneOf-matching',
    'hasNoneOf-nonmatching',
    'hasNoneOf-null',
    'hasNoneOf-empty',
    'hasNoneOf-duplicate-native',
    'hasNoneOf-unknown-native',
    'isExactly-matching',
    'isExactly-nonmatching',
    'isExactly-null',
    'isExactly-empty',
    'isExactly-duplicate-native',
    'isExactly-unknown-native',
    'isEmpty-matching',
    'isEmpty-nonmatching',
    'isEmpty-null',
    'isEmpty-empty',
    'isEmpty-duplicate-native',
    'isEmpty-unknown-native',
    'isNotEmpty-matching',
    'isNotEmpty-nonmatching',
    'isNotEmpty-null',
    'isNotEmpty-empty',
    'isNotEmpty-duplicate-native',
    'isNotEmpty-unknown-native',
    'hasAnyOf-missing-native',
    'hasAllOf-missing-native',
    'hasNoneOf-missing-native',
    'isExactly-missing-native',
    'isEmpty-missing-native',
    'isNotEmpty-missing-native',
    'hasAnyOf-unknown-choice',
    'hasAnyOf-partial-unknown',
    'hasAllOf-unknown-choice',
    'hasAllOf-partial-unknown',
    'hasNoneOf-unknown-choice',
    'hasNoneOf-partial-unknown',
    'isExactly-unknown-choice',
    'isExactly-partial-unknown',
    'reordered-native-exact',
    'duplicate-operand-exact',
    'renamed-current-name',
    'renamed-stale-name',
    'exact-case',
    'exact-whitespace',
    'whitespace-choice',
    'empty-native-member',
    'serialized-comma',
    'serialized-double-quote',
    'serialized-regex',
    'serialized-emoji',
    'hidden-driver-full-native',
    'readonly-target-validation',
    'hidden-target-validation',
    'empty-custom-message',
    'enabled-section-order',
    'disabled-section-order',
];
const hash = (path) =>
    createHash('sha256').update(readFileSync(path)).digest('hex');
export function readMultipleSelectFormDriverOracle() {
    const fixture = JSON.parse(
        readFileSync(
            new URL(
                '../test/fixtures/multipleSelectFormDrivers.json',
                import.meta.url
            ),
            'utf8'
        )
    );
    const single = readSingleSelectFormDriverOracle();
    for (const key of ['revision', 'tree'])
        assert.deepEqual(fixture.provenance[key], single.provenance[key]);
    assert.deepEqual(fixture.provenance.sources, {
        ...single.provenance.sources,
        'utils/formatMultiSelectValue.ts':
            '5b6ac632bb001cd1ade2b752f4a91f9508bf34fd1fd1c30594fc291c8ba86838',
        'types/airtable/getReadableStringFromAirtableValue.ts':
            'ef3513f1c8a1b773436a1f23600b48e2665f3ed4bf3a3d11e6aeff656991d426',
        'components/PublicExtension/Form/FormFieldSections.ts':
            'bd127e74177448e81ee99cdd086b304d54bb51aa837d6ce121d32244d3b8e076',
        'components/PublicExtension/Form/checkIfFieldIsHidden.ts':
            'e9877e1c7afbdc9287160e390a000578b4a072be859c683bb8768b8b1582992a',
        'components/PublicExtension/redux/selectors/selectFormFieldVisibility.ts':
            '4304986367ad63a91c9676f2ec1735a4a4b6afcb616283097e3648a2ced5f177',
    });
    assert.equal(
        fixture.provenance.generator,
        'scripts/generate-multi-select-form-driver-fixtures.mjs'
    );
    assert.equal(
        fixture.provenance.casesSource,
        'test/fixtures/multipleSelectFormDriverCases.mjs'
    );
    for (const [pathKey, digestKey] of [
        ['generator', 'generatorSha256'],
        ['casesSource', 'casesSourceSha256'],
    ])
        assert.equal(
            fixture.provenance[digestKey],
            hash(new URL('../' + fixture.provenance[pathKey], import.meta.url))
        );
    assert.deepEqual(
        fixture.cases.map((c) => c.name),
        canonicalCaseIds
    );
    assert.equal(new Set(canonicalCaseIds).size, canonicalCaseIds.length);
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
    ...text('request'),
    fieldType: 'multipleSelects',
    airtableField: {
        ...text('request').airtableField,
        name: 'Request type',
        config: {
            type: 'multipleSelects',
            options: {
                choices: [
                    { id: 'general', name: 'General' },
                    { id: 'other', name: 'Other' },
                ],
            },
        },
    },
});
const condition = (type = 'hasAnyOf', value = ['other']) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'driver',
            type: 'singleCondition',
            setting: {
                type,
                fieldType: 'multipleSelects',
                value,
                idOrName: { type: 'id', id: 'request' },
            },
        },
    ],
});
export async function runMultipleSelectFormDriverChecks(
    forms,
    runtime,
    makeLoaded,
    project,
    ui
) {
    let checks = 0;
    const evaluate = (rule, native, fields = [choice().airtableField]) =>
        forms.evaluateFormFieldVisibility({
            field: text('probe', { conditionalFields: rule }),
            airtableFields: fields,
            data: { request: native },
            formRecordType: 'create',
            evaluationMode: 'runtime',
            invalidConditionMode: 'strict',
        });
    // Array shape is admitted by indexed own values, never inherited members
    // or values fabricated by an iterator.
    const inheritedMember = new Array(1);
    const inheritedPrototype = Object.create(Array.prototype);
    inheritedPrototype[0] = 'Other';
    Object.setPrototypeOf(inheritedMember, inheritedPrototype);
    const fabricatedIterator = [1];
    fabricatedIterator[Symbol.iterator] = function* () {
        yield 'Other';
    };
    const replacedIterator = ['Other'];
    replacedIterator[Symbol.iterator] = function* () {
        yield 'Allow';
    };
    const replacedFilter = ['Other'];
    replacedFilter.filter = () => ['Allow'];
    const accessorMember = ['Other'];
    Object.defineProperty(accessorMember, '0', { get: () => 'Allow' });
    const unsafe = [
        'Other',
        {},
        { name: 'Other' },
        1,
        true,
        [null],
        [1],
        ['Other', undefined],
        new Array(1),
        inheritedMember,
        fabricatedIterator,
        replacedIterator,
        replacedFilter,
        accessorMember,
    ];
    for (const operator of ['hasAnyOf', 'hasAllOf', 'isExactly', 'hasNoneOf']) {
        const rule = condition(operator, ['deleted']);
        const compiled = forms.compileRuntimeConditions({
            conditions: rule,
            airtableFields: [choice().airtableField],
            invalidConditionMode: 'strict',
        });
        assert.equal(compiled.type, 'compiled');
        assert.equal(compiled.formula, 'FALSE()');
        for (const native of unsafe)
            assert.equal(
                evaluate(rule, native).type,
                'blocked',
                `${operator}: original AST admission`
            );
        for (const native of [null, [], ['Other', 'Other'], [' Other ']])
            assert.equal(evaluate(rule, native).type, 'hidden');
        checks++;
    }
    for (const operator of [
        'hasAnyOf',
        'hasAllOf',
        'hasNoneOf',
        'isExactly',
        'isEmpty',
        'isNotEmpty',
    ])
        for (const native of unsafe) {
            assert.equal(evaluate(condition(operator), native).type, 'blocked');
            checks++;
        }
    for (const mutate of [
        (f) => {
            f.isComputed = true;
        },
        (f) => {
            f.config.type = 'singleSelect';
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
            evaluate(condition('hasAnyOf', ['deleted']), ['Other'], [physical])
                .type,
            'blocked'
        );
        checks++;
    }
    const alias = text('alias').airtableField;
    alias.name = 'request';
    for (const metadata of [
        [],
        [choice().airtableField, alias],
        [choice().airtableField, choice().airtableField],
    ])
        assert.equal(
            evaluate(condition(), ['Other'], metadata).type,
            'blocked'
        );
    const named = condition();
    named.conditions[0].setting.idOrName = {
        type: 'name',
        name: 'Request type',
    };
    assert.equal(evaluate(named, ['Other']).type, 'blocked');

    const make = (configure = () => {}) => {
        const loaded = makeLoaded();
        Object.assign(loaded.payload, {
            hasParentExtension: false,
            fieldIdsInForm: ['request', 'details', 'tail'],
            fieldIdsToSchemas: {
                request: choice(),
                details: text('details', {
                    headerSectionTitle: 'Details',
                    required: true,
                    conditionalFields: condition(),
                }),
                tail: text('tail', { headerSectionTitle: 'Finish' }),
            },
            formRecord: {
                type: 'create',
                data: {
                    request: ['General', 'General'],
                    details: '',
                    tail: 'Kept',
                    untouched: ['Native', 'Native', 'Order'],
                },
            },
            formFieldIdsWithUnsavedChanges: ['untouched'],
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
            config: () => {
                config++;
            },
            owner: () => {
                owner = false;
            },
            aba: () => {
                scope = { ownerId: 'B', revision: 1 };
                fields.refresh();
                scope = { ownerId: 'A', revision: 2 };
                fields.refresh();
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
    for (const c of readMultipleSelectFormDriverOracle().cases) {
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
        assert.equal(
            forms.evaluateFormFieldVisibility({
                ...context,
                field: text('probe', { conditionalFields: c.rule }),
            }).type,
            c.expected.conditionMet ? 'visible' : 'hidden',
            c.name
        );
        const visibility = forms.composeFormFieldVisibility(context),
            projected = project(c.input);
        assert.equal(projected.type, 'available', c.name);
        assert.deepEqual(
            projected.hiddenFieldIds,
            c.expected.hiddenFieldIds,
            c.name
        );
        assert.deepEqual(projected.record, c.expected.record, c.name);
        assert.deepEqual(
            c.input.fieldIds.filter((id) => visibility[id].type === 'hidden'),
            c.expected.screen.hiddenFieldIds,
            c.name
        );
        for (const method of [
            'createScalarFormRecordProjection',
            'createFlatScalarFormRecordProjection',
        ])
            assert.equal(forms[method](c.input).type, 'blocked', c.name);
        // Canonical conditions accept ['']; the existing rendered select model
        // independently refuses empty choice names. Keep the exact native value
        // and schema while exercising page validation with an unrendered driver.
        const emptyNativeMember = c.name === 'empty-native-member';
        const f = make((p) => {
            p.payload.fieldIdsInForm = structuredClone(c.input.fieldIds).filter(
                (id) => !emptyNativeMember || id !== 'driver'
            );
            p.payload.fieldIdsToSchemas = structuredClone(
                c.input.fieldIdsToSchemas
            );
            p.payload.formRecord.data = structuredClone(c.input.data);
            p.payload.formFieldIdsWithUnsavedChanges = [];
            p.payload.publicFields.state.multiPageFormMode = 'one-page';
        });
        try {
            if (emptyNativeMember) {
                assert.throws(
                    () =>
                        ui.createSelectFieldModel({
                            field: c.input.fieldIdsToSchemas.driver,
                            value: c.input.data.driver,
                        }),
                    /A multiple select value must be an array of names\./
                );
                assert.equal(f.calls.length, 0);
            }
            assert.deepEqual(
                f.pages
                    .getSnapshot()
                    .problems.filter((p) => p.fieldId === 'validationTarget')
                    .map((p) => p.code),
                c.expected.screen.validation.invalid
                    ? ['conditional-validation']
                    : [],
                c.name
            );
            for (const id of f.loaded.payload.fieldIdsInForm)
                assert.equal(
                    f.fields.field(id).getSnapshot().visibility.type,
                    visibility[id].type,
                    `${c.name}/${id}`
                );
            if (c.expected.screen.validation.invalid) await noSave(f);
            assert.deepEqual(
                f.fields.controller.getState().draft.data,
                c.input.data,
                c.name
            );
            assert.equal(f.calls.length, 0);
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
        assert(
            f.fields.field('request').setValue(['Other', 'General', 'Other'])
                .accepted
        );
        assert.equal(f.pages.next(retained).accepted, false);
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        await noSave(f);
        assert(f.fields.field('details').setValue('Explain').accepted);
        assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
        assert(
            f.fields.field('request').setValue(['General', 'General']).accepted
        );
        assert.equal(f.fields.field('details').getSnapshot().value, 'Explain');
        assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
        assert.equal(f.calls.length, 0);
        await f.pages.submit(f.pages.getSnapshot().revision);
        assert.deepEqual(f.calls, [
            {
                ...f.options,
                extensionAccessToken: f.loaded.payload.extensionAccessToken,
                formRecord: {
                    type: 'create',
                    data: {
                        // Explicit selection uses the existing model's deduplication.
                        // Untouched native arrays are not normalized by conditions.
                        request: ['General'],
                        details: 'Explain',
                        tail: 'Kept',
                        untouched: ['Native', 'Native', 'Order'],
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
        (f) => f.config(),
        (f) => f.owner(),
        (f) => f.aba(),
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
    return checks;
}
export async function checkMultipleSelectFormDriverConsumer({
    consumerDirectory,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const load = (module) =>
        import(
            pathToFileURL(
                join(
                    consumerDirectory,
                    'node_modules/@miniextensions/sdk/dist/esm',
                    module
                )
            )
        );
    const [forms, runtime, projection, ui] = await Promise.all([
        load('forms/index.js'),
        load('runtime/index.js'),
        load('forms/projection.js'),
        load('ui/index.js'),
    ]);
    const makeLoaded = () =>
        portalRecipeFixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
    let checks = 0;
    for (const [f, r, p, u] of [
        [forms, runtime, projection, ui],
        [
            require('@miniextensions/sdk/forms'),
            require('@miniextensions/sdk'),
            require(
                join(
                    consumerDirectory,
                    'node_modules/@miniextensions/sdk/dist/cjs/forms/projection.js'
                )
            ),
            require('@miniextensions/sdk/ui'),
        ],
    ])
        checks += await runMultipleSelectFormDriverChecks(
            f,
            r,
            makeLoaded,
            p.createFormConditionRecordProjection,
            u
        );
    return checks;
}
