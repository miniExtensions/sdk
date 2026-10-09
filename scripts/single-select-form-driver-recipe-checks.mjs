import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Typecheck and execute the actual shipped TSX, using installed React peers. */
export async function checkSingleSelectFormDriverRecipe({ consumerDirectory }) {
    const directory = realpathSync(consumerDirectory);
    const consumer = createRequire(join(directory, 'package.json'));
    const installed = realpathSync(
        join(directory, 'node_modules/@miniextensions/sdk')
    );
    for (const name of ['forms', 'ui', 'react'])
        assert(
            realpathSync(
                consumer.resolve(`@miniextensions/sdk/${name}`)
            ).startsWith(`${installed}/dist/`)
        );
    const recipes = [
        ...readFileSync(join(installed, 'docs/forms.md'), 'utf8').matchAll(
            /```tsx\n([\s\S]*?)\n```/g
        ),
    ].filter(([, code]) =>
        code.includes('export function SingleSelectRequestForm(')
    );
    assert.equal(
        recipes.length,
        1,
        'Missing unique shipped single-select Form recipe'
    );
    const generated = join(directory, '.generated');
    mkdirSync(generated, { recursive: true });
    const source = join(generated, 'single-select-form-driver-recipe.tsx');
    writeFileSync(source, recipes[0][1]);
    // Standalone recipe typecheck, with the installed public declarations.
    execFileSync(
        process.execPath,
        [
            createRequire(import.meta.url).resolve('typescript/bin/tsc'),
            '--noEmit',
            '--strict',
            '--skipLibCheck',
            '--target',
            'ES2022',
            '--module',
            'NodeNext',
            '--moduleResolution',
            'NodeNext',
            '--jsx',
            'react-jsx',
            source,
        ],
        { cwd: directory, stdio: 'pipe' }
    );
    const outfile = join(generated, 'single-select-form-driver-recipe.mjs');
    await build({
        entryPoints: [source],
        bundle: true,
        platform: 'node',
        format: 'esm',
        jsx: 'automatic',
        external: [
            'react',
            'react/*',
            'react-dom',
            'react-dom/*',
            '@miniextensions/sdk/*',
        ],
        outfile,
        logLevel: 'silent',
    });
    const forms = await import(
        pathToFileURL(join(installed, 'dist/esm/forms/index.js'))
    );
    const ui = await import(
        pathToFileURL(join(installed, 'dist/esm/ui/index.js'))
    );
    const { Window } = createRequire(import.meta.url)('happy-dom');
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLInputElement',
        'HTMLSelectElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    const { createElement, act } = consumer('react');
    const { createRoot } = consumer('react-dom/client');
    const { SingleSelectRequestForm } = await import(pathToFileURL(outfile));
    let checks = 0;
    const fixture = (mode, allHidden = false) => {
        const loaded = portalRecipeFixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        loaded.payload.hasParentExtension = false;
        const field = (id, name, config = {}) => ({
            fieldType: 'singleLineText',
            airtableField: {
                id,
                name,
                description: null,
                isComputed: false,
                isPrimaryField: false,
                config: { type: 'singleLineText', options: null },
            },
            miniExtConfig: config,
        });
        const conditionalFields = {
            logicalOperator: 'and',
            conditions: [
                {
                    id: 'other-details',
                    type: 'singleCondition',
                    setting: {
                        fieldType: 'singleSelect',
                        type: 'is',
                        idOrName: { type: 'id', id: 'fld_request_type' },
                        value: 'opt_other',
                    },
                },
            ],
        };
        const request = field('fld_request_type', 'Request type');
        request.fieldType = 'singleSelect';
        request.airtableField.config = {
            type: 'singleSelect',
            options: {
                choices: [
                    { id: 'opt_standard', name: 'Standard' },
                    { id: 'opt_other', name: 'Other' },
                ],
            },
        };
        if (allHidden)
            request.miniExtConfig.conditionalFields = conditionalFields;
        Object.assign(loaded.payload, {
            fieldIdsInForm: ['fld_request_type', 'fld_details'],
            fieldIdsToSchemas: {
                fld_request_type: request,
                fld_details: field('fld_details', 'Details', {
                    required: true,
                    enableSectionHeader: true,
                    headerSectionTitle: 'Details',
                    conditionalFields,
                }),
            },
            formRecord: {
                type: 'create',
                data: {
                    fld_request_type: 'Standard',
                    fld_details: '',
                    hidden_native: ['Keep', 'Native'],
                    unrelated: { text: '001' },
                },
            },
            formFieldIdsWithUnsavedChanges: ['hidden_native'],
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
        let owner = { ownerId: 'A', revision: 0 },
            configuration = 0,
            attempts = 0;
        const calls = [],
            journal = new forms.RecoveryJournal();
        const journalScope = {
            owner: 'A',
            parentFieldId: null,
            tableId: null,
            childExtensionId: loaded.extensionId,
            context: 'direct-url',
        };
        const lifecycle = {
            dispatch() {
                attempts++;
                const attempt = journal.begin(journalScope, null, 'save', 1);
                return {
                    accepted() {
                        journal.accepted(attempt, 'validation-error');
                    },
                    finish() {
                        journal.finishFlight(attempt);
                    },
                };
            },
        };
        const client = {
            getSession: () => ({}),
            forms: {
                save: async (input) => {
                    calls.push(structuredClone(input));
                    return {
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    };
                },
            },
        };
        const fields = forms.createFormFieldBindings({
            loaded,
            client,
            getScope: () => owner,
            saveOptions: {
                captchaVal: null,
                isComputeMode: false,
                searchQuery: { kept: 'exact' },
                context: { type: 'direct-url' },
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        const options = {
            fields,
            isCurrent: () => true,
            configurationRevision: () => configuration,
        };
        const pages = forms.createFormPageOwner(options);
        const scope = ui.createFormRenderScope({
            ...options,
            pages,
            saveOptions: { lifecycle },
        });
        return {
            fields,
            pages,
            scope,
            calls,
            journal,
            journalScope,
            get attempts() {
                return attempts;
            },
            aba() {
                owner = { ownerId: 'B', revision: 1 };
                fields.refresh();
                owner = { ownerId: 'A', revision: 2 };
                fields.refresh();
            },
            retire() {
                configuration += 2;
                scope.getSnapshot();
            },
        };
    };
    try {
        for (const mode of ['one-page', 'multi-page']) {
            const f = fixture(mode),
                host = window.document.createElement('div');
            window.document.body.append(host);
            let root = createRoot(host);
            const mount = () =>
                act(async () =>
                    root.render(
                        createElement(SingleSelectRequestForm, {
                            scope: f.scope,
                        })
                    )
                );
            const choose = async (name) =>
                act(async () => {
                    const select = host.querySelector('select');
                    select.value = name;
                    select.dispatchEvent(
                        new window.Event('change', { bubbles: true })
                    );
                });
            const submitUI = () =>
                act(async () => {
                    host.querySelector('form').dispatchEvent(
                        new window.Event('submit', {
                            bubbles: true,
                            cancelable: true,
                        })
                    );
                });
            try {
                await mount();
                assert.equal(host.querySelector('input'), null);
                assert.equal(
                    host.querySelector('section[aria-label="Details"]'),
                    null
                );
                assert.equal(f.scope.pages, f.pages);
                assert.equal(f.scope.ownsPages, false);
                const stale = f.scope.getSnapshot().actions;
                await choose('Other');
                assert.equal(
                    f.fields.field('fld_request_type').getSnapshot().value,
                    'Other'
                );
                assert.equal(stale.next().accepted, false);
                await assert.rejects(stale.submit());
                if (mode === 'multi-page') {
                    assert.equal(host.querySelector('input'), null);
                    await act(async () =>
                        [...host.querySelectorAll('button')]
                            .find((b) => b.textContent === 'Next')
                            .click()
                    );
                }
                assert(host.querySelector('section[aria-label="Details"]'));
                assert(
                    host.textContent.includes('Complete the required answer.')
                );
                await submitUI();
                assert.equal(f.calls.length, 0);
                assert.equal(f.attempts, 0);
                assert.equal(
                    f.journal.blocking(f.journalScope, null),
                    undefined
                );
                await act(async () => {
                    const input = host.querySelector('input');
                    input.value = 'Native details';
                    input.dispatchEvent(
                        new window.Event('input', { bubbles: true })
                    );
                });
                assert.equal(
                    f.fields.field('fld_details').getSnapshot().value,
                    'Native details'
                );
                assert(
                    !host.textContent.includes('Complete the required answer.')
                );
                await act(async () => root.unmount());
                root = createRoot(host);
                await mount();
                assert.equal(
                    host.querySelector('input').value,
                    'Native details'
                );
                assert.equal(
                    f.fields.field('fld_details').getSnapshot().dirty,
                    true
                );
                await submitUI();
                assert.equal(f.calls.length, 1);
                assert.equal(f.attempts, 1);
                assert.deepEqual(f.calls[0].formRecord.data, {
                    fld_request_type: 'Other',
                    fld_details: 'Native details',
                    hidden_native: ['Keep', 'Native'],
                    unrelated: { text: '001' },
                });
                assert.deepEqual(
                    new Set(f.calls[0].formFieldIdsWithUnsavedChanges),
                    new Set([
                        'hidden_native',
                        'fld_request_type',
                        'fld_details',
                    ])
                );
                if (mode === 'multi-page')
                    await act(async () =>
                        [...host.querySelectorAll('button')]
                            .find((b) => b.textContent === 'Back')
                            .click()
                    );
                await choose('Standard');
                assert.equal(host.querySelector('input'), null);
                assert.equal(
                    f.fields.field('fld_details').getSnapshot().value,
                    'Native details'
                );
                const retained = f.scope.getSnapshot().actions;
                await act(async () => f.aba());
                await assert.rejects(retained.submit());
                assert.equal(retained.next().accepted, false);
                assert.equal(host.querySelector('form'), null);
                assert.equal(f.calls.length, 1);
                assert.equal(f.attempts, 1);
                checks += 12;
            } finally {
                await act(async () => root.unmount());
                f.scope.destroy();
                f.pages.dispose();
                f.fields.destroy();
                host.remove();
            }
        }
        // Actual all-hidden rendering exposes no controls or admitted submission.
        const hidden = fixture('one-page', true);
        const host = window.document.createElement('div');
        window.document.body.append(host);
        const root = createRoot(host);
        try {
            await act(async () =>
                root.render(
                    createElement(SingleSelectRequestForm, {
                        scope: hidden.scope,
                    })
                )
            );
            assert.equal(host.querySelector('input, select'), null);
            assert.equal(
                host.querySelector('button[type="submit"]').disabled,
                true
            );
            await assert.rejects(hidden.scope.getSnapshot().actions.submit());
            assert.equal(hidden.calls.length, 0);
            assert.equal(hidden.attempts, 0);
            checks++;
        } finally {
            await act(async () => root.unmount());
            hidden.scope.destroy();
            hidden.pages.dispose();
            hidden.fields.destroy();
            host.remove();
        }
        // Configuration ABA retires actions without transport or a journal attempt.
        const f = fixture('one-page');
        const retained = f.scope.getSnapshot().actions;
        f.retire();
        await assert.rejects(retained.submit());
        assert.equal(f.scope.getSnapshot().fields.length, 0);
        assert.equal(f.calls.length, 0);
        assert.equal(f.attempts, 0);
        f.scope.destroy();
        f.pages.dispose();
        f.fields.destroy();
        checks++;
        return { checks };
    } finally {
        await window.happyDOM.abort();
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]);
            else delete globalThis[key];
        });
    }
}
