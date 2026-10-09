import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import {
    conditionalField,
    conditionalRule,
} from '../test/fixtures/conditionalPageValidationCases.mjs';

function fixture(forms, mode = 'multi-page', configure = () => {}, parent) {
    const loaded = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    const choice = (id, type) =>
        conditionalField(
            id,
            type,
            {
                ...(id === 'single' ? { headerSectionTitle: 'Choices' } : {}),
                enableConditionalOptions: true,
                conditionsForOptions: [
                    {
                        id: `rule-${id}`,
                        config: {
                            optionForConditions: 'beta',
                            conditionsForOption: conditionalRule(),
                        },
                    },
                ],
            },
            {
                config: {
                    type,
                    options: {
                        choices: [
                            { id: 'alpha', name: 'Alpha' },
                            { id: 'beta', name: 'Beta' },
                        ],
                    },
                },
            }
        );
    Object.assign(loaded.payload, {
        hasParentExtension: false,
        fieldIdsInForm: ['driver', 'single', 'multi'],
        fieldIdsToSchemas: {
            driver: conditionalField('driver'),
            single: choice('single', 'singleSelect'),
            multi: choice('multi', 'multipleSelects'),
        },
        formRecord: {
            type: 'create',
            data: {
                driver: 'allow',
                single: 'Alpha',
                multi: ['Alpha'],
                native: { text: 'retained' },
            },
        },
        formFieldIdsWithUnsavedChanges: ['native'],
        urlPrefilledFieldIds: [],
        publicFields: {
            type: 'form',
            state: {
                multiPageFormMode: mode,
                promptUserBeforeSubmission: false,
                enableFormComputeMode: false,
                autoSubmitAfterPrefill: false,
            },
        },
    });
    configure(loaded);
    let config = 0,
        owner = 0,
        io = 0;
    const saves = [];
    const options = {
        captchaVal: null,
        isComputeMode: false,
        searchQuery: { retained: 'exact' },
        context: parent
            ? {
                  type: 'modal',
                  prefillData: {
                      toLinkToParent: {
                          reversedFieldIdToPrefill: 'fld_parent',
                          parentFormRecordId: parent.recordId,
                      },
                      prefillQueryForChildExtension: null,
                  },
              }
            : { type: 'direct-url' },
        conditionalLinkedRecordFieldIdsToFilteringValues: {},
    };
    const client = {
        getSession: () => ({}),
        forms: {
            save: async (input) => {
                saves.push(structuredClone(input));
                return {
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                };
            },
            addSelectOption: async () => {
                io++;
                throw Error('Unexpected option I/O');
            },
        },
        attachments: {
            uploadFile: async () => {
                io++;
                throw Error('Unexpected upload');
            },
        },
    };
    const fields = forms.createFormFieldBindings({
        loaded,
        client,
        saveOptions: options,
        ...(parent ? { parent } : {}),
        getScope: () => ({ ownerId: `owner-${owner}`, revision: owner }),
    });
    return {
        loaded,
        fields,
        saves,
        options,
        get io() {
            return io;
        },
        scopeOptions: {
            fields,
            isCurrent: () => true,
            configurationRevision: () => config,
        },
        replaceConfig: () => config++,
        replaceOwner: () => {
            owner++;
            fields.refresh();
        },
    };
}
const kinds = [
    'singleLineText',
    'number',
    'email',
    'url',
    'multilineText',
    'percent',
    'currency',
    'singleSelect',
    'multipleSelects',
    'singleCollaborator',
    'multipleCollaborators',
    'multipleRecordLinks',
    'date',
    'dateTime',
    'phoneNumber',
    'multipleAttachments',
    'checkbox',
    'formula',
    'createdTime',
    'rollup',
    'count',
    'multipleLookupValues',
    'autoNumber',
    'barcode',
    'rating',
    'richText',
    'duration',
    'lastModifiedTime',
    'createdBy',
    'lastModifiedBy',
    'button',
    'externalSyncSource',
    'aiText',
];
export const selectAvailabilityBridgeTypedConsumer = `
import type { FieldRendererSlots, SelectAvailabilitySnapshot } from '@miniextensions/sdk/ui';
import type { FormFieldSnapshot } from '@miniextensions/sdk/forms';
declare const snapshot: FormFieldSnapshot;
const summary: SelectAvailabilitySnapshot | null | undefined = snapshot.selectAvailability;
const slots: FieldRendererSlots<string> = {
${kinds
    .map(
        (kind) => `render${kind[0].toUpperCase() + kind.slice(1)}Field: p => {
${
    ['singleSelect', 'multipleSelects'].includes(kind)
        ? `const summary: SelectAvailabilitySnapshot | undefined = p.selectAvailability;
// @ts-expect-error summary is readonly
if(summary) summary.status = 'ready';`
        : `// @ts-expect-error availability belongs only to select slots
const forbidden: SelectAvailabilitySnapshot = p.selectAvailability;`
}
// @ts-expect-error availability is outside capability
p.capability.selectAvailability;
return p.field.id;
}`
    )
    .join(',\n')}
};
void [summary, slots];
`;

/** Shared regression exercised against source and both installed module formats. */
export async function checkSelectAvailabilityBridgeModules(
    forms,
    ui,
    createRendererProps
) {
    let checks = 0;
    const fixtures = [];
    const scopes = [];
    const make = (mode, configure) => {
        const f = fixture(forms, mode, configure);
        fixtures.push(f);
        return f;
    };
    const summary = (f, id = 'single') =>
        f.fields.field(id).getSnapshot().selectAvailability;
    const options = (f, id = 'single') =>
        f.fields
            .field(id)
            .selection.getState()
            .options.map((o) => o.value);
    try {
        for (const mode of ['one-page', 'multi-page']) {
            const f = make(mode);
            const before = structuredClone(
                f.fields.controller.getState().draft
            );
            assert.deepEqual(summary(f), { status: 'ready' });
            assert.equal(summary(f, 'driver'), null);
            const s = ui.createFormRenderScope(f.scopeOptions);
            scopes.push(s);
            if (mode === 'multi-page') s.getSnapshot().actions.next();
            assert.deepEqual(options(f), ['Alpha', 'Beta']);
            const stale = summary(f);
            if (!Object.isFrozen(stale)) stale.status = 'blocked';
            assert.deepEqual(summary(f), { status: 'ready' });
            f.fields
                .field('single')
                .selection.setSearchInput('no matching option');
            assert.deepEqual(summary(f), { status: 'ready' });
            assert.deepEqual(f.fields.controller.getState().draft, before);
            assert.equal(f.io, 0);
            checks++;
        }
        const f = make('one-page', (f) => {
            f.payload.formRecord.data.driver = { text: 'invalid native text' };
        });
        assert.deepEqual(summary(f), {
            status: 'blocked',
            code: 'unavailable-record',
        });
        assert.deepEqual(options(f), []);
        const before = structuredClone(f.fields.controller.getState().draft);
        const reports = [];
        const unsub = f.fields.field('single').selection.subscribe(() => {
            reports.push({ summary: summary(f), options: options(f) });
        });
        assert.equal(f.fields.field('driver').setValue('allow').accepted, true);
        assert.deepEqual(summary(f), { status: 'ready' });
        assert.deepEqual(options(f), ['Alpha', 'Beta']);
        for (const report of reports)
            assert.deepEqual(
                report.options,
                report.summary.status === 'ready' ? ['Alpha', 'Beta'] : []
            );
        assert(reports.some((r) => r.summary.status === 'ready'));
        unsub();
        assert.deepEqual(f.fields.controller.getState().draft.data, {
            ...before.data,
            driver: 'allow',
        });
        await f.fields.save();
        assert.equal(f.saves.length, 1);
        assert.deepEqual(f.saves[0].formRecord, {
            type: 'create',
            data: { ...before.data, driver: 'allow' },
        });
        assert.deepEqual(f.saves[0].formFieldIdsWithUnsavedChanges, [
            'native',
            'driver',
        ]);
        checks++;
        const empty = make('one-page', (f) => {
            f.payload.formRecord.data.driver = { text: 'invalid native text' };
            for (const id of ['single', 'multi']) {
                const config = f.payload.fieldIdsToSchemas[id].miniExtConfig;
                config.conditionsForOptions = ['alpha', 'beta'].map(
                    (option) => ({
                        id: `private-${option}`,
                        config: {
                            optionForConditions: option,
                            conditionsForOption: conditionalRule('is', 'never'),
                        },
                    })
                );
            }
        });
        assert.deepEqual(summary(empty), {
            status: 'blocked',
            code: 'unavailable-record',
        });
        const notifications = [];
        const off = empty.fields.field('single').subscribe((s) => {
            assert.deepEqual(s.selection.options, []);
            notifications.push(s.selectAvailability);
        });
        assert.equal(
            empty.fields.field('driver').setValue('allow').accepted,
            true
        );
        assert.deepEqual(options(empty), []);
        assert.deepEqual(summary(empty), { status: 'ready' });
        assert(notifications.some((s) => s?.status === 'ready'));
        assert.equal(
            empty.fields.controller.write('driver', {
                text: 'private invalid text',
            }),
            true
        );
        assert.deepEqual(summary(empty), {
            status: 'blocked',
            code: 'unavailable-record',
        });
        assert.deepEqual(options(empty), []);
        assert.equal(notifications.at(-1).status, 'blocked');
        off();
        checks++;
        const hiddenDriver = make('one-page', (f) => {
            f.payload.fieldIdsToSchemas.driver.miniExtConfig.conditionalFields =
                conditionalRule('is', 'never');
        });
        assert.deepEqual(summary(hiddenDriver), { status: 'ready' });
        assert.deepEqual(options(hiddenDriver), ['Alpha']);
        assert.equal(
            hiddenDriver.fields.field('driver').getSnapshot().value,
            'allow'
        );
        checks++;
        const hiddenSelect = make('one-page', (f) => {
            f.payload.fieldIdsToSchemas.single.miniExtConfig.conditionalFields =
                conditionalRule('is', 'never');
        });
        assert.equal(summary(hiddenSelect), null);
        checks++;
        const readonly = make('unknown', (f) => {
            f.payload.fieldIdsToSchemas.single.miniExtConfig.readOnly = true;
        });
        assert.deepEqual(summary(readonly), { status: 'ready' });
        const retained = structuredClone(
            readonly.fields.controller.getState().draft
        );
        readonly.fields.field('single').selection.choose(['Beta']);
        assert.deepEqual(readonly.fields.controller.getState().draft, retained);
        checks++;
        for (const id of ['single', 'multi']) {
            const f = make('one-page', (f) => {
                f.payload.formRecord.data.driver = {
                    text: 'private malformed text',
                };
            });
            const host = ui.createFormFieldRendererHost({
                ...f.scopeOptions,
                fieldId: id,
            });
            try {
                const blocked = host.getSnapshot().fields[0];
                assert.deepEqual(blocked.selectAvailability, {
                    status: 'blocked',
                    code: 'unavailable-record',
                });
                assert.equal(
                    f.fields.field('driver').setValue('allow').accepted,
                    true
                );
                const ready = host.getSnapshot().fields[0];
                assert.deepEqual(ready.selectAvailability, { status: 'ready' });
                assert.deepEqual(
                    ready.capability.selection.state.options.map(
                        (o) => o.value
                    ),
                    ['Alpha', 'Beta']
                );
                ready.selectAvailability.status = 'blocked';
                assert.deepEqual(
                    host.getSnapshot().fields[0].selectAvailability,
                    { status: 'ready' }
                );
                checks++;
            } finally {
                host.dispose();
            }
        }
        for (const replacement of ['replaceConfig', 'replaceOwner']) {
            const f = make('one-page');
            const host = ui.createFormFieldRendererHost({
                ...f.scopeOptions,
                fieldId: 'single',
            });
            const old = host.getSnapshot().fields[0].capability;
            f[replacement]();
            const before = structuredClone(
                f.fields.controller.getState().draft
            );
            old.selection.choose(['Beta']);
            assert.equal(old.setValue('Beta').accepted, false);
            assert.deepEqual(f.fields.controller.getState().draft, before);
            assert.equal(host.getSnapshot().status, 'retired');
            assert.equal(f.saves.length, 0);
            assert.equal(f.io, 0);
            host.dispose();
            checks++;
        }
        const retainedChoices = make('one-page', (f) => {
            f.payload.formRecord.data.driver = 'deny';
            f.payload.formRecord.data.single = 'Beta';
            f.payload.formRecord.data.multi = ['Alpha', 'Beta'];
        });
        const retainedDraft = structuredClone(
            retainedChoices.fields.controller.getState().draft
        );
        assert.deepEqual(options(retainedChoices), ['Alpha']);
        assert.equal(
            retainedChoices.fields.field('single').getSnapshot().value,
            'Beta'
        );
        assert.deepEqual(
            retainedChoices.fields.field('multi').getSnapshot().value,
            ['Alpha', 'Beta']
        );
        await retainedChoices.fields.save();
        assert.deepEqual(retainedChoices.saves[0].formRecord, {
            type: 'create',
            data: retainedDraft.data,
        });
        assert.deepEqual(
            retainedChoices.saves[0].formFieldIdsWithUnsavedChanges,
            ['native']
        );
        retainedChoices.fields.field('single').selection.clear();
        retainedChoices.fields.field('multi').selection.toggle('Beta');
        assert.equal(
            retainedChoices.fields.field('single').getSnapshot().value,
            null
        );
        assert.deepEqual(
            retainedChoices.fields.field('multi').getSnapshot().value,
            ['Alpha']
        );
        retainedChoices.fields.field('single').selection.choose(['Beta']);
        retainedChoices.fields.field('multi').selection.toggle('Beta');
        assert.equal(
            retainedChoices.fields.field('single').getSnapshot().value,
            null
        );
        assert.deepEqual(
            retainedChoices.fields.field('multi').getSnapshot().value,
            ['Alpha']
        );
        await retainedChoices.fields.save();
        assert.deepEqual(retainedChoices.saves[1].formRecord, {
            type: 'create',
            data: { ...retainedDraft.data, single: null, multi: ['Alpha'] },
        });
        assert.deepEqual(
            retainedChoices.saves[1].formFieldIdsWithUnsavedChanges,
            ['native', 'single', 'multi']
        );
        checks++;
        const parent = {
            portalId: 'portal_range',
            recordId: 'rec_parent',
            portalFieldId: 'fld_children',
        };
        const child = fixture(
            forms,
            'one-page',
            (f) => {
                f.payload.hasParentExtension = true;
                f.payload.formRecord.data.driver = {
                    text: 'private child native text',
                };
            },
            parent
        );
        fixtures.push(child);
        const independentRoot = make('one-page');
        const childHost = ui.createFormFieldRendererHost({
            ...child.scopeOptions,
            fieldId: 'single',
        });
        try {
            assert.deepEqual(
                childHost.getSnapshot().fields[0].selectAvailability,
                { status: 'blocked', code: 'unavailable-record' }
            );
            const rootBefore = structuredClone(
                independentRoot.fields.controller.getState().draft
            );
            assert.equal(
                child.fields.field('driver').setValue('allow').accepted,
                true
            );
            assert.deepEqual(
                childHost.getSnapshot().fields[0].selectAvailability,
                { status: 'ready' }
            );
            assert.deepEqual(
                independentRoot.fields.controller.getState().draft,
                rootBefore
            );
            assert.equal(
                independentRoot.fields.field('driver').setValue('deny')
                    .accepted,
                true
            );
            assert.deepEqual(options(independentRoot), ['Alpha']);
            assert.deepEqual(
                childHost
                    .getSnapshot()
                    .fields[0].capability.selection.state.options.map(
                        (o) => o.value
                    ),
                ['Alpha', 'Beta']
            );
            assert.equal(
                child.fields.field('driver').getSnapshot().value,
                'allow'
            );
            await child.fields.save();
            assert.deepEqual(child.saves[0].context, child.options.context);
            assert.deepEqual(child.saves[0].formRecord, {
                type: 'create',
                data: {
                    driver: 'allow',
                    single: 'Alpha',
                    multi: ['Alpha'],
                    native: { text: 'retained' },
                },
            });
            assert.deepEqual(child.saves[0].formFieldIdsWithUnsavedChanges, [
                'native',
                'driver',
            ]);
            assert.equal(independentRoot.saves.length, 0);
            assert.equal(child.io, 0);
            assert.equal(independentRoot.io, 0);
            checks++;
        } finally {
            childHost.dispose();
        }
        const metadata = make('one-page');
        for (const id of ['single', 'multi']) {
            const type = id === 'single' ? 'singleSelect' : 'multipleSelects';
            const input = {
                physicalKind: type,
                fieldId: id,
                title: id,
                field: metadata.loaded.payload.fieldIdsToSchemas[id]
                    .airtableField,
                displayConfig: null,
                value: id === 'single' ? 'Alpha' : ['Alpha'],
                context: 'form',
                computed: false,
                dirty: false,
                pending: false,
                validation: [],
                error: null,
                capability: { type: 'readonly' },
            };
            const absent = createRendererProps(input);
            assert(absent);
            assert.equal(Object.hasOwn(absent, 'selectAvailability'), false);
            for (const availability of [
                { status: 'ready' },
                ...[
                    'unavailable-record',
                    'unsupported-condition',
                    'invalid-condition',
                    'evaluation-error',
                ].map((code) => ({ status: 'blocked', code })),
            ]) {
                const props = createRendererProps({
                    ...input,
                    selectAvailability: availability,
                });
                assert(props);
                assert.deepEqual(props.selectAvailability, availability);
                props.selectAvailability.status = 'private mutation';
                assert.notEqual(availability.status, 'private mutation');
                assert.deepEqual(
                    createRendererProps({
                        ...input,
                        selectAvailability: availability,
                    }).selectAvailability,
                    availability
                );
                checks++;
            }
            for (const availability of [
                null,
                Object.defineProperty({ secret: 'private' }, 'status', {
                    value: 'ready',
                }),
                Object.defineProperties(
                    { secret: 'private', driver: 'private driver' },
                    {
                        status: { value: 'blocked' },
                        code: { value: 'unavailable-record' },
                    }
                ),
                { status: 'unknown' },
                { status: 'blocked', code: 'private-code' },
                { status: 'blocked' },
                { status: 'ready', code: 'evaluation-error' },
                { status: 'ready', formula: 'private formula' },
                {
                    status: 'blocked',
                    code: 'evaluation-error',
                    driver: 'private driver',
                },
            ]) {
                assert.equal(
                    createRendererProps({
                        ...input,
                        selectAvailability: availability,
                    }),
                    null
                );
            }
            for (const context of [
                'portal-cell',
                'portal-detail',
                'linked-detail',
            ]) {
                assert.equal(
                    createRendererProps({
                        ...input,
                        context,
                        selectAvailability: { status: 'ready' },
                    }),
                    null
                );
            }
            assert.equal(
                createRendererProps({
                    ...input,
                    physicalKind: 'singleLineText',
                    field: metadata.loaded.payload.fieldIdsToSchemas.driver
                        .airtableField,
                    value: 'allow',
                    selectAvailability: { status: 'ready' },
                }),
                null
            );
        }
        const cache = make('one-page');
        const cachedRule =
            cache.loaded.payload.fieldIdsToSchemas.single.miniExtConfig
                .conditionsForOptions[0].config;
        const conditions = cachedRule.conditionsForOption;
        let evaluations = 0;
        Object.defineProperty(cachedRule, 'conditionsForOption', {
            configurable: true,
            get: () => {
                evaluations++;
                return conditions;
            },
        });
        cache.fields.refresh();
        const reads = evaluations;
        for (let i = 0; i < 5; i++) {
            assert.deepEqual(summary(cache), { status: 'ready' });
            cache.fields.field('single').getSnapshot();
        }
        assert.equal(
            evaluations,
            reads,
            'snapshot reads must not evaluate conditions'
        );
        assert.equal(JSON.stringify(summary(f)).includes('private'), false);
        checks++;
        const retired = make('one-page');
        const old = retired.fields.field('single');
        retired.replaceOwner();
        assert.equal(old.getSnapshot().selectAvailability, null);
        assert.equal(old.getSnapshot().retired, true);
        assert.deepEqual(summary(make('one-page')), { status: 'ready' });
        checks++;
        return checks;
    } finally {
        scopes.forEach((s) => s.destroy());
        fixtures.forEach((f) => f.fields.destroy());
    }
}

export async function checkSelectAvailabilityBridgeConsumer({
    consumerDirectory,
    packageName = '@miniextensions/sdk',
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esm = join(
        consumerDirectory,
        'node_modules',
        packageName,
        'dist/esm'
    );
    const modules = await Promise.all(
        ['forms', 'ui'].map(
            (p) => import(pathToFileURL(join(esm, p, 'index.js')))
        )
    );
    const registry = await import(
        pathToFileURL(join(esm, 'ui', 'rendererRegistry.js'))
    );
    let checks = await checkSelectAvailabilityBridgeModules(
        ...modules,
        registry.createRendererProps
    );
    checks += await checkSelectAvailabilityBridgeModules(
        require(`${packageName}/forms`),
        require(`${packageName}/ui`),
        require(
            join(
                consumerDirectory,
                'node_modules',
                packageName,
                'dist/cjs/ui/rendererRegistry.js'
            )
        ).createRendererProps
    );
    return checks;
}
