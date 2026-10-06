import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Execute the shipped typed recipe with the actual installed archive. */
export async function checkFormAttachmentRecipe({
    consumerDirectory,
    guideSources,
}) {
    const root = realpathSync(consumerDirectory);
    const require = createRequire(join(root, 'package.json'));
    const installed = realpathSync(
        join(root, 'node_modules/@miniextensions/sdk')
    );
    const matches = guideSources
        .map((source) => resolve(root, source))
        .filter((source) =>
            readFileSync(source, 'utf8').includes(
                'export function createFormAttachmentActions('
            )
        );
    assert.equal(matches.length, 1, 'Missing unique shipped attachment recipe');
    const { code } = await transform(readFileSync(matches[0], 'utf8'), {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
    });
    const compiled = `${matches[0]}.attachments.mjs`;
    writeFileSync(
        compiled,
        `${code}\nexport const recipeFormsUrl = import.meta.resolve('@miniextensions/sdk/forms');\n`
    );
    const { createFormAttachmentActions, recipeFormsUrl } = await import(
        pathToFileURL(compiled).href
    );
    assert(
        realpathSync(fileURLToPath(recipeFormsUrl)).startsWith(
            `${installed}/dist/esm/`
        )
    );
    assert(
        realpathSync(require.resolve('@miniextensions/sdk/forms')).startsWith(
            `${installed}/dist/`
        )
    );
    const {
        FormDraftStore,
        openLoadedFormDraft,
        createFormSaveInput,
        getFormAttachmentPolicy,
    } = require('@miniextensions/sdk/forms');
    const persisted = {
        id: 'att_existing',
        url: 'https://files.example/existing',
        filename: 'existing.png',
        type: 'image/png',
        size: 10,
        thumbnails: {
            small: { url: 'https://files.example/thumb', width: 2, height: 3 },
        },
    };
    const added = {
        id: 'att_prefill',
        url: 'https://files.example/new',
        filename: 'new.png',
        size: 20,
    };
    function fixture() {
        const loaded = portalRecipeFixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        loaded.payload.fieldIdsInForm.push('fld_files');
        loaded.payload.fieldIdsToSchemas.fld_files = {
            fieldType: 'multipleAttachments',
            airtableField: {
                id: 'fld_files',
                name: 'Files',
                config: { type: 'multipleAttachments' },
            },
            miniExtConfig: {
                addOnlyMode: true,
                showExistingValuesForAddOnlyMode: true,
                allowedFiles: 3,
                allowedAttachmentTypes: ['images'],
                sizeLimit: 1,
            },
        };
        loaded.payload.formRecord.data.fld_files = [persisted, added];
        loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {
            fld_files: [persisted],
        };
        const store = new FormDraftStore();
        const handle = openLoadedFormDraft({ store, loaded });
        let current = true;
        const actions = createFormAttachmentActions({
            loaded,
            store,
            handle,
            fieldId: 'fld_files',
            isCurrent: () => current,
        });
        return {
            loaded,
            store,
            handle,
            actions,
            leave: () => {
                current = false;
            },
        };
    }
    let checks = 0;
    const check = (exercise) => {
        exercise(fixture());
        checks++;
    };
    check(({ actions, store, handle, loaded }) => {
        const before = store.snapshot(handle);
        const view = actions.view();
        assert.deepEqual(
            view.policy.rows.map((row) => [row.nativeIndex, row.visible]),
            [
                [0, false],
                [1, true],
            ]
        );
        assert.equal(view.policy.upload.remainingSlots, 1);
        assert.deepEqual(store.snapshot(handle), before);
        const save = createFormSaveInput({
            loaded,
            draft: before,
            options: {
                captchaVal: null,
                isComputeMode: false,
                searchQuery: {},
                context: { type: 'direct-url' },
                conditionalLinkedRecordFieldIdsToFilteringValues: {},
            },
        });
        assert.deepEqual(save.formRecord.data, before.data);
        assert.deepEqual(save.formRecord.data.fld_files, [persisted, added]);
    });
    check(({ actions, store, handle }) => {
        const view = actions.view();
        assert.equal(actions.remove(view.revision, 0), false);
        assert.equal(actions.remove(view.revision, 1), true);
        assert.deepEqual(store.read(handle, 'fld_files'), [persisted]);
        assert.deepEqual(
            store.snapshot(handle).dirtyFieldIds.includes('fld_files'),
            true
        );
        assert.equal(actions.remove(view.revision, 1), false);
    });
    check(({ actions, store, handle }) => {
        const old = actions.view();
        store.write(handle, 'fld_files', [added, persisted]);
        assert.equal(actions.remove(old.revision, 1), false);
        assert.deepEqual(store.read(handle, 'fld_files'), [added, persisted]);
        assert.equal(actions.remove(actions.view().revision, 0), true);
        assert.deepEqual(store.read(handle, 'fld_files'), [persisted]);
    });
    check(({ actions, store, handle, loaded, leave }) => {
        const old = actions.view();
        leave();
        assert.equal(actions.remove(old.revision, 1), false);
        assert.equal(actions.checkFiles([]), null);
        store.clear();
        const replacement = openLoadedFormDraft({ store, loaded });
        assert.notEqual(replacement, handle);
        assert.equal(actions.view(), null);
        assert.deepEqual(store.read(replacement, 'fld_files'), [
            persisted,
            added,
        ]);
    });
    check(({ actions, loaded, store, handle }) => {
        const old = actions.view();
        store.clear();
        const replacement = openLoadedFormDraft({ store, loaded });
        assert.equal(replacement.scope, handle.scope);
        assert.notEqual(replacement, handle);
        assert.equal(actions.view(), null);
        assert.equal(actions.remove(old.revision, 1), false);
        assert.deepEqual(store.read(replacement, 'fld_files'), [
            persisted,
            added,
        ]);
    });
    check(({ actions, loaded, store, handle }) => {
        const old = actions.view();
        loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig.readOnly = true;
        assert.equal(actions.remove(old.revision, 1), false);
        assert.equal(actions.checkFiles([]).batchError, 'read-only');
        const config = loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig;
        config.disableOpenFiles = true;
        config.disableDownloadFiles = false;
        const policy = getFormAttachmentPolicy({
            loaded,
            fieldId: 'fld_files',
            value: store.read(handle, 'fld_files'),
        });
        assert.equal(policy.openAllowed, false);
        assert.equal(policy.downloadAllowed, true);
    });
    check(({ actions, loaded, store, handle }) => {
        const before = store.snapshot(handle);
        delete loaded.payload.persistedAddOnlyAttachmentValuesByFieldId;
        assert.equal(actions.view().policy.status, 'unavailable');
        assert.equal(actions.remove(actions.view().revision, 1), false);
        assert.equal(actions.checkFiles([]).batchError, 'unavailable-policy');
        assert.deepEqual(store.snapshot(handle), before);
        loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {};
        assert.equal(
            actions
                .view()
                .policy.rows.every((row) => row.removeAllowed && row.visible),
            true
        );
    });
    check(({ actions, loaded, store, handle }) => {
        const before = store.snapshot(handle);
        for (const value of [null, undefined]) {
            loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {
                fld_files: value,
            };
            assert.throws(() => actions.view(), TypeError);
            assert.throws(
                () => actions.remove(store.revision(handle), 1),
                TypeError
            );
            assert.throws(() => actions.checkFiles([]), TypeError);
            assert.deepEqual(store.snapshot(handle), before);
        }
        loaded.payload.persistedAddOnlyAttachmentValuesByFieldId = {};
        assert.equal(
            actions.view().policy.rows.every((row) => row.removeAllowed),
            true
        );
    });
    check(({ actions, loaded }) => {
        const files = [
            { type: 'image/png', size: 1 },
            { type: 'text/plain', size: 1 },
            { type: 'image/png', size: 1048577 },
        ];
        assert.deepEqual(actions.checkFiles(files), {
            acceptedIndexes: [0],
            rejected: [
                { index: 1, reason: 'type' },
                { index: 2, reason: 'size' },
            ],
            batchError: null,
        });
        assert.equal(
            actions.checkFiles([...files, files[0]]).batchError,
            'count'
        );
        assert.deepEqual(
            actions.checkFiles([...files, files[0]]).acceptedIndexes,
            []
        );
        loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig.allowedFiles = 1;
        assert.equal(actions.checkFiles([]).batchError, 'count');
        loaded.payload.fieldIdsToSchemas.fld_files.miniExtConfig.fieldMode =
            'upload-url';
        assert.equal(actions.checkFiles([]).batchError, 'unsupported-mode');
    });
    check(({ actions, loaded, store, handle }) => {
        const before = store.snapshot(handle);
        delete loaded.payload.persistedAddOnlyAttachmentValuesByFieldId;
        const pending = new AbortController();
        assert.equal(actions.view().policy.status, 'unavailable');
        pending.abort();
        assert.equal(pending.signal.aborted, true);
        assert.deepEqual(store.snapshot(handle), before);
    });
    return { checks };
}
