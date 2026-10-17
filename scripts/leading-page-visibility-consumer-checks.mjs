import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

// Explicit qualification against an already packed/installed SDK. The child
// processes import only normal public package exports from the consumer cwd.
export function checkLeadingPageVisibilityConsumer({ consumerDirectory }) {
    const cwd = realpathSync(consumerDirectory);
    const installed = join(cwd, 'node_modules/@miniextensions/sdk');
    assert.equal(
        realpathSync(installed),
        installed,
        'Use a regular installed package, not a source symlink'
    );
    const loaded = portalRecipeFixtures.makeForm({
        childExtensionInfo: {
            accessType: { type: 'edit', childExtensionRecordId: 'rec_leading' },
        },
    });
    const run = async (forms, runtime, template) => {
        const make = (value = '', configure = () => {}) => {
            const loaded = structuredClone(template);
            loaded.payload.hasParentExtension = false;
            loaded.payload.fieldIdsInForm = ['a', 'b', 'c'];
            loaded.payload.fieldIdsToSchemas = Object.fromEntries(
                ['a', 'b', 'c'].map((id, i) => [
                    id,
                    {
                        fieldType: 'singleLineText',
                        airtableField: {
                            id,
                            name: id,
                            description: null,
                            isComputed: false,
                            isPrimaryField: false,
                            config: { type: 'singleLineText', options: null },
                        },
                        miniExtConfig:
                            i === 0
                                ? { hideFieldIfEmpty: true, required: true }
                                : {
                                      headerSectionTitle:
                                          i === 1 ? 'Second' : 'Third',
                                  },
                    },
                ])
            );
            loaded.payload.formRecord.data = {
                a: value,
                b: 'B',
                c: 'C',
                untouched: { text: 'native' },
            };
            loaded.payload.formFieldIdsWithUnsavedChanges = ['untouched'];
            loaded.payload.urlPrefilledFieldIds = [];
            Object.assign(loaded.payload.publicFields.state, {
                multiPageFormMode: 'multi-page',
                promptUserBeforeSubmission: false,
                enableFormComputeMode: false,
                autoSubmitAfterPrefill: false,
            });
            configure(loaded);
            const calls = [];
            let current = true;
            const client = runtime.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                fetch: async () => {
                    throw Error('Unexpected network');
                },
            });
            client.forms.save = async (input) => {
                calls.push(structuredClone(input));
                return {
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                };
            };
            const fields = forms.createFormFieldBindings({
                client,
                loaded,
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    searchQuery: {},
                    context: { type: 'direct-url' },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
                getScope: () => ({ ownerId: 'leading-page', revision: 0 }),
            });
            const pages = forms.createFormPageOwner({
                fields,
                isCurrent: () => current,
                configurationRevision: () => 0,
            });
            return {
                loaded,
                fields,
                pages,
                calls,
                retire: () => {
                    current = false;
                },
                dispose: () => {
                    pages.dispose();
                    fields.destroy();
                },
            };
        };
        let checks = 0;
        for (const value of ['', '  ', null]) {
            const f = make(value);
            try {
                const before = structuredClone(
                    f.fields.controller.getState().draft
                );
                assert.equal(f.pages.getSnapshot().activePageIndex, 1);
                assert.equal(f.pages.getSnapshot().canBack, false);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
                assert.equal(f.pages.getSnapshot().activePageIndex, 1);
                assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
                await f.pages.submit(f.pages.getSnapshot().revision);
                assert.equal(f.calls.length, 1);
                assert.deepEqual(f.calls[0].formRecord.data, before.data);
                assert.deepEqual(
                    f.calls[0].formFieldIdsWithUnsavedChanges,
                    before.dirtyFieldIds
                );
                checks++;
            } finally {
                f.dispose();
            }
        }
        const f = make('Kept');
        try {
            assert.equal(f.pages.getSnapshot().activePageIndex, 0);
            const stale = f.pages.getSnapshot().revision;
            assert(f.fields.field('a').setValue('').accepted);
            assert.equal(f.pages.getSnapshot().activePageIndex, 1);
            assert.deepEqual(f.pages.next(stale), {
                accepted: false,
                reason: 'stale-revision',
            });
            assert(f.fields.controller.write('a', 'Restored'));
            assert(f.pages.back(f.pages.getSnapshot().revision).accepted);
            assert.equal(f.pages.getSnapshot().activePageIndex, 0);
            assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
            assert(f.pages.next(f.pages.getSnapshot().revision).accepted);
            assert.equal(f.pages.getSnapshot().canSubmit, true);
            f.retire();
            await assert.rejects(
                f.pages.submit(f.pages.getSnapshot().revision)
            );
            assert.equal(f.calls.length, 0);
            checks++;
        } finally {
            f.dispose();
        }
        for (const disabled of [false, true]) {
            const f = make('', (loaded) => {
                loaded.payload.fieldIdsInForm = ['b', 'a', 'c'];
                loaded.payload.fieldIdsToSchemas.b.miniExtConfig.applyFieldConditionsToSection = true;
                loaded.payload.fieldIdsToSchemas.b.miniExtConfig.enableSectionHeader =
                    !disabled;
            });
            try {
                assert.equal(
                    f.fields.field('a').getSnapshot().visibility.type,
                    'blocked'
                );
                assert.equal(f.pages.getSnapshot().canNext, false);
                assert.equal(f.calls.length, 0);
                checks++;
            } finally {
                f.dispose();
            }
        }
        return checks;
    };
    let checks = 0;
    for (const mode of ['module', 'commonjs']) {
        const imports =
            mode === 'module'
                ? "import assert from 'node:assert/strict'; import * as forms from '@miniextensions/sdk/forms'; import * as runtime from '@miniextensions/sdk';"
                : "const assert = require('node:assert/strict'); const forms = require('@miniextensions/sdk/forms'); const runtime = require('@miniextensions/sdk');";
        const program = `${imports}\n(async () => { const checks = await (${run.toString()})(forms, runtime, ${JSON.stringify(loaded)}); console.log(JSON.stringify({mode:${JSON.stringify(mode)},checks})); })().catch(error => { console.error(error); process.exitCode = 1; });`;
        const result = spawnSync(
            process.execPath,
            [`--input-type=${mode}`, '--eval', program],
            { cwd, encoding: 'utf8' }
        );
        if (result.error) throw result.error;
        assert.equal(
            result.status,
            0,
            `${mode} consumer failed:\n${result.stdout}\n${result.stderr}`
        );
        const receipt = JSON.parse(result.stdout);
        assert.deepEqual(receipt, { mode, checks: 6 });
        checks += receipt.checks;
        process.stdout.write(result.stdout);
    }
    return checks;
}
if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    if (process.argv.length !== 3)
        throw Error('Pass an existing packed SDK consumer directory.');
    checkLeadingPageVisibilityConsumer({ consumerDirectory: process.argv[2] });
}
