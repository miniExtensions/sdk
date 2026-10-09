import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import {
    conditionalField,
    conditionalRule,
} from '../test/fixtures/conditionalPageValidationCases.mjs';

export const crossPageChoiceTypedConsumer = `
import { createElement } from 'react';
import { AirtableForm } from '@miniextensions/sdk/react';
import type { FormRenderScope } from '@miniextensions/sdk/ui';
declare const scope: FormRenderScope;
createElement(AirtableForm, { scope, renderers: {
 renderSingleSelectField: p => createElement('button', {onClick: () => {if(p.capability.type === 'editable') p.capability.selection?.choose(['Alpha']);}}, p.value),
 renderMultipleSelectsField: p => createElement('button', {onClick: () => {if(p.capability.type === 'editable') p.capability.selection?.toggle('Alpha');}}, p.value?.join(',')),
 renderSingleLineTextField: p => createElement('button', {onClick: () => {if(p.capability.type === 'editable') p.capability.setValue('allow');}}, p.value)
}, children: state => createElement('section', null, ...state.fields.map(f => f.node)) });
`;

function fixture(forms, mode = 'multi-page', configure = () => {}) {
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
        context: { type: 'direct-url' },
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
const values = (f) =>
    ['single', 'multi'].map((id) =>
        f.fields
            .field(id)
            .selection.getState()
            .options.map((o) => o.value)
    );

/** Actual installed modules and AirtableForm slots; synthetic transport only. */
export async function checkCrossPageChoiceConsumer({
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
    const imports = await Promise.all(
        ['forms', 'ui', 'react'].map(
            (p) => import(pathToFileURL(join(esm, p, 'index.js')))
        )
    );
    let checks = 0;
    for (const [forms, ui, reactApi] of [
        imports,
        [
            require(`${packageName}/forms`),
            require(`${packageName}/ui`),
            require(`${packageName}/react`),
        ],
    ]) {
        const fixtures = [],
            scopes = [];
        const make = (mode, configure) => {
            const f = fixture(forms, mode, configure);
            fixtures.push(f);
            return f;
        };
        const scope = (f) => {
            const s = ui.createFormRenderScope(f.scopeOptions);
            scopes.push(s);
            return s;
        };
        try {
            const oracle = JSON.parse(
                readFileSync(
                    new URL(
                        '../test/fixtures/crossPageChoices.json',
                        import.meta.url
                    ),
                    'utf8'
                )
            );
            assert.equal(oracle.choices.length, 20);
            for (const c of oracle.choices) {
                const g = make(c.pageMode, (p) => {
                    p.payload.fieldIdsInForm = structuredClone(c.fieldIds);
                    p.payload.fieldIdsToSchemas = structuredClone(c.schemas);
                    p.payload.formRecord.data = structuredClone(c.data);
                });
                const metadata = Object.values(c.schemas).map(
                    (s) => s.airtableField
                );
                const projection = forms.createScalarFormRecordProjection({
                    fieldIds: c.fieldIds,
                    fieldIdsToSchemas: c.schemas,
                    airtableFields: metadata,
                    data: c.data,
                    recordId: '',
                    invalidConditionMode: 'strict',
                });
                assert.equal(projection.type, 'available', c.name);
                assert.deepEqual(
                    projection.record.fields,
                    c.canonical.projectedData,
                    c.name
                );
                assert.deepEqual(
                    projection.hiddenFieldIds,
                    c.canonical.hiddenFieldIds,
                    c.name
                );
                const available = ui.resolveSelectFieldAvailability({
                    field: c.schemas[c.fieldId],
                    airtableFields: metadata,
                    recordForConditionEvaluation: projection.record,
                    mode: 'runtime',
                    invalidConditionMode: 'compatibility',
                });
                // Canonical list renderers retain selected rows even when their predicate is false.
                // The SDK availability contract reports eligible NEW choices separately.
                const selected = Array.isArray(c.data[c.fieldId])
                    ? c.data[c.fieldId]
                    : [c.data[c.fieldId]];
                const eligible = available.options.map((o) => o.value);
                const canonicalNames =
                    c.rendererType === 'list'
                        ? c.schemas[
                              c.fieldId
                          ].airtableField.config.options.choices
                              .map((o) => o.name)
                              .filter(
                                  (name) =>
                                      eligible.includes(name) ||
                                      selected.includes(name)
                              )
                        : eligible;
                assert.deepEqual(
                    canonicalNames,
                    c.canonical.eligibleNames,
                    c.name
                );
                const binding = g.fields.field(c.fieldId),
                    model = binding.selection.getState();
                assert.deepEqual(
                    model.options.map((o) => o.value),
                    eligible,
                    c.name
                );
                assert.deepEqual(
                    model.selectedOptions.map((o) => o.value),
                    selected,
                    c.name
                );
                assert.deepEqual(
                    g.fields.controller.getState().draft.data,
                    c.canonical.nativeData,
                    c.name
                );
                assert.equal(g.saves.length, 0);
                assert.equal(g.io, 0);
                checks++;
            }
            const f = make(),
                s = scope(f);
            assert.deepEqual(values(f), [
                ['Alpha', 'Beta'],
                ['Alpha', 'Beta'],
            ]);
            assert.deepEqual(
                s.getSnapshot().fields.map((x) => x.fieldId),
                ['driver']
            );
            assert(s.getSnapshot().actions.next().accepted);
            assert.deepEqual(
                s.getSnapshot().fields.map((x) => x.fieldId),
                ['single', 'multi']
            );
            // Inactive page membership must not hide its native scalar driver.
            assert.deepEqual(values(f), [
                ['Alpha', 'Beta'],
                ['Alpha', 'Beta'],
            ]);
            checks++;
            await mount(f, s, reactApi, require);
            checks++;
            for (const replacement of ['replaceConfig', 'replaceOwner']) {
                const g = make(),
                    t = scope(g);
                t.getSnapshot().actions.next();
                const old = t.getSnapshot().actions;
                const selection = g.fields.field('single').selection;
                const before = structuredClone(
                    g.fields.controller.getState().draft.data
                );
                g[replacement]();
                assert.equal(old.back().accepted, false);
                assert.equal(old.next().accepted, false);
                await assert.rejects(old.submit());
                assert.equal(g.saves.length, 0);
                // Owner-bound native bindings remain the value authority.
                if (replacement === 'replaceConfig')
                    assert.deepEqual(
                        g.fields.controller.getState().draft.data,
                        before
                    );
                else assert.equal(g.fields.controller.getState().draft, null);
                void selection;
                checks++;
            }
            const one = make('one-page');
            assert.deepEqual(values(one), values(make()));
            checks++;
            const hidden = make(undefined, (p) => {
                p.payload.fieldIdsToSchemas.driver.miniExtConfig.conditionalFields =
                    conditionalRule('is', 'never');
            });
            assert.deepEqual(values(hidden), [['Alpha'], ['Alpha']]);
            assert.equal(
                hidden.fields.field('driver').getSnapshot().value,
                'allow'
            );
            checks++;
            const sections = make(undefined, (p) => {
                const schema = p.payload.fieldIdsToSchemas;
                schema.header = conditionalField('header', 'singleLineText', {
                    headerSectionTitle: 'Hidden driver',
                    applyFieldConditionsToSection: true,
                    conditionalFields: conditionalRule(
                        'is',
                        'never',
                        'singleLineText',
                        { type: 'id', id: 'reset' }
                    ),
                });
                schema.reset = conditionalField('reset', 'singleLineText', {
                    headerSectionTitle: 'Reset',
                });
                p.payload.fieldIdsInForm = [
                    'header',
                    'driver',
                    'reset',
                    'single',
                    'multi',
                ];
                p.payload.formRecord.data.header = 'Heading';
                p.payload.formRecord.data.reset = 'allow';
            });
            assert.deepEqual(values(sections), [['Alpha'], ['Alpha']]);
            checks++;
            for (const mode of ['unknown', 'wizard']) {
                const g = make(mode);
                assert.deepEqual(values(g), [[], []]);
                checks++;
            }
            for (const refusal of [
                'missing-schema',
                'duplicate-name',
                'malformed-native',
                'malformed-rule',
            ]) {
                const g = make(undefined, (p) => {
                    let rule = conditionalRule();
                    if (refusal === 'missing-schema')
                        rule = conditionalRule(
                            'is',
                            'allow',
                            'singleLineText',
                            { type: 'id', id: 'absent' }
                        );
                    if (refusal === 'duplicate-name') {
                        p.payload.fieldIdsToSchemas.alias = conditionalField(
                            'alias',
                            'singleLineText',
                            {},
                            { name: 'driver' }
                        );
                        rule = conditionalRule(
                            'is',
                            'allow',
                            'singleLineText',
                            { type: 'name', name: 'driver' }
                        );
                    }
                    if (refusal === 'malformed-native')
                        p.payload.formRecord.data.driver = { text: 'invalid' };
                    if (refusal === 'malformed-rule')
                        rule = {
                            logicalOperator: 'and',
                            conditions: [
                                {
                                    type: 'singleCondition',
                                    setting: {
                                        type: 'unknown',
                                        fieldType: 'singleLineText',
                                        idOrName: { type: 'id', id: 'driver' },
                                    },
                                },
                            ],
                        };
                    for (const id of ['single', 'multi'])
                        p.payload.fieldIdsToSchemas[
                            id
                        ].miniExtConfig.conditionsForOptions[0].config.conditionsForOption =
                            rule;
                });
                assert.deepEqual(values(g), [[], []], refusal);
                assert.equal(g.saves.length, 0);
                checks++;
            }
            for (const type of [
                'singleSelect',
                'multipleSelects',
                'date',
                'multipleRecordLinks',
                'formula',
            ]) {
                const g = make(undefined, (p) => {
                    p.payload.fieldIdsToSchemas.driver = conditionalField(
                        'driver',
                        type
                    );
                    for (const id of ['single', 'multi'])
                        p.payload.fieldIdsToSchemas[
                            id
                        ].miniExtConfig.conditionsForOptions[0].config.conditionsForOption =
                            conditionalRule('is', 'allow', type);
                });
                assert.deepEqual(values(g), [[], []]);
                checks++;
            }
        } finally {
            scopes.forEach((s) => s.destroy());
            fixtures.forEach((f) => f.fields.destroy());
        }
    }
    console.log(
        `Installed cross-page choices: ${checks} ESM/CJS checks; actual AirtableForm custom slots and synthetic Save.`
    );
    return checks;
}

async function mount(f, scope, api, require) {
    const { Window } = createRequire(import.meta.url)('happy-dom');
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((k) =>
        Object.getOwnPropertyDescriptor(globalThis, k)
    );
    keys.forEach((k) =>
        Object.defineProperty(globalThis, k, {
            configurable: true,
            writable: true,
            value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[k],
        })
    );
    const { createElement: h, StrictMode, act } = require('react');
    const { createRoot } = require('react-dom/client');
    const host = window.document.createElement('div');
    window.document.body.append(host);
    let root = createRoot(host),
        last;
    const slots = {};
    const select = (p) => {
        slots[p.field.id] = p;
        return h(
            'button',
            {
                id: p.field.id,
                type: 'button',
                onClick: () =>
                    p.capability.selection.choose(
                        p.field.id === 'single' ? ['Beta'] : ['Alpha', 'Beta']
                    ),
            },
            p.capability.selection.state.options.map((o) => o.value).join(',')
        );
    };
    const tree = () =>
        h(
            StrictMode,
            null,
            h(api.AirtableForm, {
                scope,
                renderers: {
                    renderSingleSelectField: select,
                    renderMultipleSelectsField: select,
                    renderSingleLineTextField: (p) => {
                        slots.driver = p;
                        return h(
                            'button',
                            {
                                id: 'driver',
                                onClick: () => p.capability.setValue('deny'),
                            },
                            p.value
                        );
                    },
                },
                children: (state) => {
                    last = state;
                    return h(
                        'section',
                        null,
                        ...state.fields.map((f) =>
                            h('div', { key: f.fieldId }, f.node)
                        )
                    );
                },
            })
        );
    try {
        await act(async () => root.render(tree()));
        assert.equal(f.io, 0);
        assert.equal(f.saves.length, 0);
        assert.equal(host.querySelector('#single').textContent, 'Alpha,Beta');
        await act(async () => host.querySelector('#single').click());
        await act(async () => host.querySelector('#multi').click());
        await act(async () => last.actions.back());
        await act(async () => host.querySelector('#driver').click());
        await act(async () => last.actions.next());
        assert.deepEqual(values(f), [['Alpha'], ['Alpha']]);
        assert.equal(host.querySelector('#multi').textContent, 'Alpha');
        assert.equal(f.fields.field('single').getSnapshot().value, 'Beta');
        assert.deepEqual(f.fields.field('multi').getSnapshot().value, [
            'Alpha',
            'Beta',
        ]);
        await act(async () => root.unmount());
        root = createRoot(host);
        await act(async () => root.render(tree()));
        assert.equal(f.saves.length, 0);
        assert.equal(f.io, 0);
        await act(async () => last.actions.submit());
        assert.deepEqual(f.saves, [
            {
                ...f.options,
                extensionAccessToken: f.loaded.payload.extensionAccessToken,
                formRecord: {
                    type: 'create',
                    data: {
                        driver: 'deny',
                        single: 'Beta',
                        multi: ['Alpha', 'Beta'],
                        native: { text: 'retained' },
                    },
                },
                formFieldIdsWithUnsavedChanges: [
                    'native',
                    'single',
                    'multi',
                    'driver',
                ],
            },
        ]);
        const oldSelection = slots.single.capability.selection,
            oldScalar = slots.driver.capability;
        await act(async () => f.replaceConfig());
        await act(async () => oldSelection.choose(['Alpha']));
        assert.equal(f.fields.field('single').getSnapshot().value, 'Beta');
        assert.equal(oldScalar.setValue('allow').accepted, false);
        const oldMultiple = slots.multi.capability.selection;
        await act(async () => f.replaceOwner());
        await act(async () => oldMultiple.choose(['Alpha']));
        assert.equal(f.fields.controller.getState().draft, null);
        assert.equal(f.fields.field('multi').getSnapshot().retired, true);
        assert.equal(f.saves.length, 1);
        assert.equal(f.io, 0);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        await window.happyDOM.abort();
        keys.forEach((k, i) => {
            if (previous[i]) Object.defineProperty(globalThis, k, previous[i]);
            else delete globalThis[k];
        });
    }
}
