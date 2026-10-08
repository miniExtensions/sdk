import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Installed ESM/CJS, stock/custom React and synthetic dispatch; no persistence/browser claim. */
export async function checkSelectChoiceConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLSelectElement',
        'Event',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const old = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    let owner, root;
    let checks = 0;
    try {
        const esm = (part) =>
            import(
                pathToFileURL(
                    join(
                        consumerDirectory,
                        `node_modules/@miniextensions/sdk/dist/esm/${part}/index.js`
                    )
                )
            );
        const forms = await esm('forms');
        const runtime = await esm('runtime');
        const api = await esm('react');
        const { createElement, StrictMode, act } = require('react');
        const { createRoot } = require('react-dom/client');
        const fixture = (config = {}, single = false) => {
            const page = portalRecipeFixtures.makeForm({
                childExtensionInfo: { accessType: { type: 'create' } },
            });
            page.payload.hasParentExtension = false;
            const type = single ? 'singleSelect' : 'multipleSelects';
            const schema = {
                fieldType: type,
                airtableField: {
                    id: 'fld_choice',
                    name: 'Choice',
                    isComputed: false,
                    isPrimaryField: false,
                    description: null,
                    config: {
                        type,
                        options: {
                            choices: [{ id: 'sel_alpha', name: 'Alpha' }],
                        },
                    },
                },
                miniExtConfig: { allowAddingNewOptions: true, ...config },
            };
            page.payload.fieldIdsInForm = ['fld_choice'];
            page.payload.fieldIdsToSchemas = { fld_choice: schema };
            page.payload.formRecord = {
                type: 'create',
                data: {
                    fld_choice: single ? 'Alpha' : ['Alpha'],
                    fld_hidden: 'Retained native',
                },
            };
            page.payload.formFieldIdsWithUnsavedChanges = ['fld_hidden'];
            page.payload.urlPrefilledFieldIds = [];
            let ownerRevision = 0,
                configuration = 0;
            let calls = 0,
                saves = [];
            const client = runtime.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                session: { visitor: 'A' },
                fetch: async () => {
                    throw Error('No automatic I/O');
                },
            });
            client.forms.addSelectOption = async () => {
                calls++;
                return { newChoice: { id: 'sel_beta', name: 'Beta' } };
            };
            client.forms.save = async (input) => {
                saves.push(structuredClone(input));
                return {
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                };
            };
            owner = forms.createFormFieldBindings({
                client,
                loaded: page,
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    context: { type: 'direct-url' },
                    searchQuery: {},
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
                getScope: () => ({ ownerId: 'A', revision: ownerRevision }),
            });
            const journal = new forms.RecoveryJournal();
            const scope = {
                owner: 'A',
                parentFieldId: null,
                tableId: null,
                childExtensionId: page.extensionId,
                context: 'direct-url',
            };
            const creator = owner.selectChoice(
                'fld_choice',
                { journal, scope, loadVersion: 1 },
                {
                    getLoaded: () => page,
                    configurationRevision: () => configuration,
                }
            );
            return {
                client,
                page,
                creator,
                journal,
                scope,
                calls: () => calls,
                saves,
                owner,
                replace: () => {
                    ownerRevision++;
                    owner.refresh();
                },
                observe: () => {
                    configuration++;
                    creator.getSnapshot();
                },
            };
        };
        for (const config of [
            { allowAddingNewOptions: false },
            { readOnly: true },
            { singleOrMultiSelectLimitSelectionOptions: ['sel_alpha'] },
            { maxNumberOfSelections: 1 },
        ]) {
            const f = fixture(config);
            assert.equal(await f.creator.create('Beta'), false);
            assert.equal(f.calls(), 0);
            assert.deepEqual(f.journal.unknown('A'), []);
            owner.destroy();
            checks++;
        }
        for (const single of [false, true]) {
            const f = fixture({}, single);
            assert.equal(await f.creator.create(' '), false);
            assert.equal(f.calls(), 0);
            checks++;
            assert.equal(await f.creator.create('User text'), true);
            assert.deepEqual(
                owner.field('fld_choice').getSnapshot().value,
                single ? 'Beta' : ['Alpha', 'Beta']
            );
            assert.equal(f.saves.length, 0);
            checks++;
            await owner.save();
            assert.deepEqual(f.saves[0].formRecord, {
                type: 'create',
                data: {
                    fld_choice: single ? 'Beta' : ['Alpha', 'Beta'],
                    fld_hidden: 'Retained native',
                },
            });
            assert.deepEqual(
                new Set(f.saves[0].formFieldIdsWithUnsavedChanges),
                new Set(['fld_hidden', 'fld_choice'])
            );
            checks++;
            owner.destroy();
        }
        for (const change of [
            'owner',
            'token',
            'configuration-aba',
            'session',
            'draft',
            'cancel',
        ]) {
            const f = fixture();
            let resolve;
            let count = 0;
            f.client.forms.addSelectOption = async () => {
                count++;
                return new Promise((yes) => (resolve = yes));
            };
            const creating = f.creator.create('Beta');
            assert.equal(await f.creator.create('Duplicate'), false);
            assert.equal(count, 1);
            if (change === 'owner') f.replace();
            if (change === 'token') {
                f.page.payload.extensionAccessToken = 'synthetic_replacement';
                f.creator.getSnapshot();
            }
            if (change === 'configuration-aba') {
                f.observe();
                f.observe();
            }
            if (change === 'session') f.client.setSession({ visitor: 'B' });
            if (change === 'draft') owner.controller.write('fld_choice', []);
            if (change === 'cancel') f.creator.cancel();
            resolve({ newChoice: { id: 'sel_beta', name: 'Beta' } });
            assert.equal(await creating, false);
            assert.equal(f.journal.unknown('A').length, 1);
            assert.equal(f.creator.getSnapshot().choice, null);
            owner.destroy();
            checks++;
        }
        {
            const lost = fixture();
            let calls = 0;
            lost.client.forms.addSelectOption = async () => {
                calls++;
                throw Error('Synthetic lost response');
            };
            assert.equal(await lost.creator.create('Beta'), false);
            assert.equal(lost.creator.getSnapshot().phase, 'uncertain');
            assert.equal(await lost.creator.create('Retry'), false);
            assert.equal(calls, 1);
            await assert.rejects(owner.save());
            checks++;
            lost.journal.acknowledgeNewIntent(lost.journal.unknown('A')[0]);
            lost.client.forms.addSelectOption = async () => {
                calls++;
                return { newChoice: { id: 'sel_gamma', name: 'Gamma' } };
            };
            assert.equal(calls, 1);
            assert.equal(
                await lost.creator.create('Separate explicit intent'),
                true
            );
            assert.equal(calls, 2);
            checks++;
            owner.destroy();
        }
        const f = fixture();
        const binding = owner.field('fld_choice');
        let heldCustom;
        const container = window.document.createElement('div');
        window.document.body.append(container);
        const tree = () =>
            createElement(
                StrictMode,
                null,
                createElement(
                    'section',
                    { id: 'stock' },
                    createElement(api.SelectField, { binding })
                ),
                createElement(
                    'section',
                    { id: 'custom' },
                    createElement(api.SelectField, {
                        binding,
                        render: ({ snapshot, binding: current }) => {
                            if (
                                snapshot.retired ||
                                snapshot.choiceCreation == null
                            )
                                return createElement(
                                    'p',
                                    null,
                                    'Custom retired'
                                );
                            const creator = current.choiceCreation;
                            heldCustom = () => creator.create('Custom intent');
                            return createElement(
                                'div',
                                null,
                                createElement(
                                    'p',
                                    null,
                                    `Custom ${snapshot.choiceCreation.phase}`
                                ),
                                createElement(
                                    'button',
                                    {
                                        type: 'button',
                                        disabled:
                                            !snapshot.choiceCreation.canCreate,
                                        onClick: heldCustom,
                                    },
                                    'Custom create'
                                )
                            );
                        },
                    })
                )
            );
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.equal(f.calls(), 0);
        checks++;
        let resolve;
        let count = 0;
        f.client.forms.addSelectOption = async () => {
            count++;
            return new Promise((yes) => (resolve = yes));
        };
        await act(async () =>
            container.querySelector('#custom button').click()
        );
        assert.equal(binding.getSnapshot().choiceCreation.busy, true);
        assert.equal(container.querySelector('#stock button').disabled, true);
        assert.equal(container.querySelector('#custom button').disabled, true);
        assert(container.textContent.includes('Custom creating'));
        checks++;
        await act(async () =>
            resolve({ newChoice: { id: 'sel_beta', name: 'Beta' } })
        );
        assert.equal(count, 1);
        assert(container.textContent.includes('Choice created and selected'));
        assert(container.textContent.includes('Custom created-selected'));
        assert.deepEqual(
            [...container.querySelectorAll('select')].map((node) =>
                [...node.selectedOptions].map((option) => option.value)
            ),
            [['Alpha', 'Beta']]
        );
        checks++;
        await act(async () => root.unmount());
        root = createRoot(container);
        await act(async () => root.render(tree()));
        assert.equal(count, 1);
        assert(container.textContent.includes('Custom created-selected'));
        checks++;
        const stockInput = container.querySelector('#stock input');
        await act(async () => {
            Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            ).set.call(stockInput, 'Stock intent');
            stockInput.dispatchEvent(
                new window.Event('input', { bubbles: true })
            );
            stockInput.dispatchEvent(
                new window.Event('change', { bubbles: true })
            );
        });
        assert.equal(container.querySelector('#stock button').disabled, false);
        f.client.forms.addSelectOption = async (input) => {
            count++;
            assert.equal(input.newChoiceText, 'Stock intent');
            return { newChoice: { id: 'sel_gamma', name: 'Gamma' } };
        };
        await act(async () => container.querySelector('#stock button').click());
        assert.equal(count, 2);
        assert.deepEqual(binding.getSnapshot().value, [
            'Alpha',
            'Beta',
            'Gamma',
        ]);
        assert(container.textContent.includes('Custom created-selected'));
        checks++;
        const oldAction = heldCustom;
        await act(async () => f.replace());
        assert.equal(await oldAction(), false);
        assert.equal(count, 2);
        checks++;
        // CJS shares the same owner/action contract; imports do not request anything.
        assert.equal(
            typeof require('@miniextensions/sdk/forms').createFormFieldBindings,
            'function'
        );
        checks++;
        console.log(
            `[installed Add Choice] ${checks} checkpoints passed; synthetic dispatch only`
        );
        return checks;
    } finally {
        if (root) {
            const { act } = require('react');
            await act(async () => root.unmount());
        }
        owner?.destroy();
        keys.forEach((key, index) => {
            if (old[index]) Object.defineProperty(globalThis, key, old[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
