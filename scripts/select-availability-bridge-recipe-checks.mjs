import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import {
    conditionalField,
    conditionalRule,
} from '../test/fixtures/conditionalPageValidationCases.mjs';

/** Executes the actual shipped custom React renderer recipe against the archive. */
export async function checkSelectAvailabilityBridgeRecipe({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(join(consumer, 'package.json'));
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    assert.ok(
        realpathSync(require.resolve('@miniextensions/sdk/ui')).startsWith(
            `${installed}/dist/`
        )
    );
    const guide = readFileSync(
        join(installed, 'docs/field-bindings.md'),
        'utf8'
    );
    const recipes = [...guide.matchAll(/```tsx\n([\s\S]*?)\n```/g)].filter(
        ([, source]) =>
            source.includes('export function selectAvailabilityMessage(')
    );
    assert.equal(
        recipes.length,
        1,
        'Expected the actual shipped custom React select recipe'
    );
    const outfile = join(
        consumer,
        '.generated/select-availability-bridge-recipe.mjs'
    );
    await build({
        absWorkingDir: consumer,
        stdin: {
            contents: `import React from 'react';\n${recipes[0][1]}\nexport { createElement, act } from 'react';\nexport { createRoot } from 'react-dom/client';\nexport { mountCustomField } from './node_modules/@miniextensions/sdk/examples/browser/src/customFieldRenderer.ts';`,
            resolveDir: consumer,
            sourcefile: 'bridge-recipe.tsx',
            loader: 'tsx',
        },
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        logLevel: 'silent',
    });
    const { Window } = require(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'HTMLElement',
        'Event',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const old = new Map(
        keys.map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ])
    );
    for (const key of keys)
        globalThis[key] =
            key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key];
    let root;
    try {
        const {
            CustomFields,
            selectAvailabilityMessage,
            createElement,
            act,
            createRoot,
            mountCustomField,
        } = await import(pathToFileURL(outfile).href);
        assert.equal(selectAvailabilityMessage(undefined, '', 0), null);
        assert.equal(selectAvailabilityMessage(null, 'query', 0), null);
        for (const code of [
            'unavailable-record',
            'unsupported-condition',
            'invalid-condition',
            'evaluation-error',
        ]) {
            assert.ok(
                selectAvailabilityMessage(
                    { status: 'blocked', code },
                    'query',
                    0
                )
            );
        }
        const container = window.document.createElement('div');
        window.document.body.append(container);
        const forms = require('@miniextensions/sdk/forms');
        const ui = require('@miniextensions/sdk/ui');
        let io = 0;
        for (const multiple of [false, true]) {
            const loaded = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            const fieldType = multiple ? 'multipleSelects' : 'singleSelect';
            const schema = conditionalField(
                'single',
                fieldType,
                {
                    enableConditionalOptions: true,
                    conditionsForOptions: [
                        {
                            id: 'private-rule',
                            config: {
                                optionForConditions: 'alpha',
                                conditionsForOption: conditionalRule(),
                            },
                        },
                    ],
                },
                {
                    config: {
                        type: fieldType,
                        options: { choices: [{ id: 'alpha', name: 'Alpha' }] },
                    },
                }
            );
            Object.assign(loaded.payload, {
                hasParentExtension: false,
                fieldIdsInForm: ['driver', 'single'],
                fieldIdsToSchemas: {
                    driver: conditionalField('driver'),
                    single: schema,
                },
                formRecord: {
                    type: 'create',
                    data: {
                        driver: { text: 'private-driver-value' },
                        single: multiple ? ['Alpha'] : 'Alpha',
                    },
                },
                publicFields: {
                    type: 'form',
                    state: { multiPageFormMode: 'one-page' },
                },
            });
            const forbidden = () => {
                io++;
                throw new Error('Recipe must perform zero I/O');
            };
            const fields = forms.createFormFieldBindings({
                loaded,
                client: {
                    getSession: () => ({}),
                    forms: { save: forbidden },
                    request: forbidden,
                },
                getScope: () => ({ ownerId: 'recipe', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    searchQuery: {},
                    context: { type: 'direct-url' },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            const host = ui.createFormFieldRendererHost({
                fields,
                fieldId: 'single',
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            const native = structuredClone(
                fields.field('single').getSnapshot().value
            );
            let custom = mountCustomField(
                fields.field('single'),
                window.document
            );
            window.document.body.append(custom.node);
            const status = () =>
                custom.node.querySelector('[role="status"]').textContent;
            const safeDOM = () => {
                assert.equal(
                    container.outerHTML.includes('private-driver-value'),
                    false
                );
                assert.equal(
                    custom.node.outerHTML.includes('private-driver-value'),
                    false
                );
                assert.deepEqual(
                    fields.field('single').getSnapshot().value,
                    native
                );
            };
            const summary = () =>
                host.getSnapshot().fields[0].selectAvailability;
            assert.deepEqual(summary(), {
                status: 'blocked',
                code: 'unavailable-record',
            });
            assert.equal(
                JSON.stringify(summary()).includes('private-driver-value'),
                false
            );
            root = createRoot(container);
            await act(async () =>
                root.render(createElement(CustomFields, { host }))
            );
            assert.match(container.textContent, /temporarily unavailable/);
            assert.match(status(), /temporarily unavailable/);
            safeDOM();
            await act(async () => {
                fields.field('driver').setValue('deny');
            });
            assert.deepEqual(summary(), { status: 'ready' });
            assert.match(container.textContent, /No choices available/);
            assert.match(status(), /No choices available/);
            safeDOM();
            await act(async () => root.unmount());
            const beforeRemountButtons = [
                ...custom.node.querySelectorAll('button'),
            ];
            custom.destroy();
            for (const button of beforeRemountButtons) button.click();
            assert.deepEqual(
                fields.field('single').getSnapshot().value,
                native
            );
            custom = mountCustomField(fields.field('single'), window.document);
            window.document.body.append(custom.node);
            root = createRoot(container);
            await act(async () =>
                root.render(createElement(CustomFields, { host }))
            );
            assert.match(container.textContent, /No choices available/);
            assert.match(status(), /No choices available/);
            safeDOM();
            await act(async () =>
                fields.field('single').selection.setSearchInput('not found')
            );
            assert.match(container.textContent, /No matching choices/);
            assert.match(status(), /No matching choices/);
            safeDOM();
            const oldButtons = [...custom.node.querySelectorAll('button')];
            custom.destroy();
            for (const button of oldButtons) button.click();
            assert.deepEqual(
                fields.field('single').getSnapshot().value,
                native
            );
            assert.equal(
                selectAvailabilityMessage({ status: 'ready' }, '', 1),
                null
            );
            // The actual shipped React recipe removes retained ineligible native values.
            const retained = [...container.querySelectorAll('button')].find(
                (button) => button.getAttribute('aria-pressed') === 'true'
            );
            assert.ok(retained);
            assert.equal(retained.disabled, false);
            const nativeEdits = [];
            let previous = JSON.stringify(
                fields.field('single').getSnapshot().value
            );
            const unsubscribe = fields.field('single').subscribe((snapshot) => {
                const next = JSON.stringify(snapshot.value);
                if (next !== previous)
                    nativeEdits.push(structuredClone(snapshot.value));
                previous = next;
            });
            await act(async () => retained.click());
            unsubscribe();
            assert.deepEqual(nativeEdits, [multiple ? [] : null]);
            assert.deepEqual(
                fields.field('single').getSnapshot().value,
                multiple ? [] : null
            );
            assert.equal(
                container.querySelector('[aria-pressed="true"]'),
                null
            );
            assert.equal(io, 0);
            await act(async () => fields.destroy());
            assert.equal(host.getSnapshot().status, 'retired');
            assert.equal(container.textContent, '');
            assert.equal(container.children.length, 0);
            host.dispose();
            const hiddenLoaded = structuredClone(loaded);
            hiddenLoaded.payload.formRecord.data.driver =
                'private-driver-value';
            hiddenLoaded.payload.fieldIdsToSchemas.single.miniExtConfig.conditionalFields =
                conditionalRule();
            const hiddenFields = forms.createFormFieldBindings({
                loaded: hiddenLoaded,
                client: { getSession: () => ({}), forms: { save: forbidden } },
                getScope: () => ({ ownerId: 'hidden-recipe', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    searchQuery: {},
                    context: { type: 'direct-url' },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            const hiddenHost = ui.createFormFieldRendererHost({
                fields: hiddenFields,
                fieldId: 'single',
                isCurrent: () => true,
                configurationRevision: () => 0,
            });
            assert.equal(hiddenHost.getSnapshot().status, 'hidden');
            assert.equal(hiddenHost.getSnapshot().fields, undefined);
            assert.equal(
                hiddenFields.field('single').getSnapshot().selectAvailability,
                null
            );
            await act(async () =>
                root.render(createElement(CustomFields, { host: hiddenHost }))
            );
            assert.equal(container.children.length, 0);
            const hiddenCustom = mountCustomField(
                hiddenFields.field('single'),
                window.document
            );
            assert.equal(hiddenCustom.node.hidden, true);
            assert.equal(
                hiddenCustom.node.outerHTML.includes('private-driver-value'),
                false
            );
            hiddenCustom.destroy();
            hiddenHost.dispose();
            hiddenFields.destroy();
            await act(async () => root.unmount());
            root = undefined;
        }
        assert.equal(io, 0);
        return 8;
    } finally {
        if (root)
            await (
                await import(pathToFileURL(outfile).href)
            ).act(async () => root.unmount());
        await window.happyDOM.close();
        for (const [key, descriptor] of old) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    }
}
