import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

/** Shared assertions can also run after a separate supported strict compile. */
export async function assertPortalChildSave({
    createPortalScreenOwner,
    createPortalChildSave,
    core,
    forms,
}) {
    async function fixture(access = { type: 'edit', recordId: 'rec_one' }) {
        const calls = { load: [], list: [], save: [] };
        const client = core.createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.example.test',
            fetch: async () => {
                throw Error('No network is permitted');
            },
        });
        client.loadExtension = async (input) => {
            calls.load.push(structuredClone(input));
            return input.childExtensionInfo
                ? fixtures.makeForm(input)
                : fixtures.makePortal();
        };
        client.portals.listLinkedRecords = async (input) => {
            calls.list.push(structuredClone(input));
            return fixtures.page([fixtures.record('rec_one', 'One')]);
        };
        let respond = (input) => ({
            type: 'saved',
            record: {
                id:
                    input.formRecord.type === 'edit'
                        ? input.formRecord.recordId
                        : 'rec_created',
                fields: structuredClone(input.formRecord.data),
            },
            tableId: 'tbl_children',
            loggedInUserRecord: { id: 'rec_user', fields: {} },
            context: { type: 'modal', newTableIdsToLinkedTableStates: {} },
            postSubmissionWarnings: [{ type: 'adminNotificationEmailFailed' }],
        });
        client.forms.save = async (input, options) => {
            calls.save.push({ input: structuredClone(input), options });
            return respond(input);
        };
        const owner = createPortalScreenOwner({
            client,
            initialOwnerId: 'synthetic-visitor',
            clearVisitorState() {},
            onScreen() {},
            onCollection() {},
            onRead() {},
        });
        await owner.load(
            {
                shareId: 'synthetic-share',
                recordId: null,
                context: { type: 'direct-url' },
                query: {},
            },
            {
                portalFieldId: 'fld_children',
                criteria: {
                    selectedCustomViewId: 'view_example',
                    searchTerm: null,
                    searchParamsMap: {},
                    sortFieldsByEndUser: null,
                    filtersByEndUser: null,
                    supportsEndUserSortCleanup: true,
                    supportsEndUserFilterCleanup: true,
                },
            }
        );
        await owner.readFirst({
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: true,
        });
        const journal = new forms.RecoveryJournal();
        const attempts = [];
        const begin = journal.begin.bind(journal);
        let onBegin;
        journal.begin = (...args) => {
            const attempt = begin(...args);
            attempts.push(attempt);
            onBegin?.();
            return attempt;
        };
        let version = 0;
        const adapters = [];
        const open = async () => {
            const child = await owner.openChild({
                access,
                configuredChildExtensionId: 'child_example',
                query: { child: 'captured' },
                deviceFingerprint: { version: 1, visitorId: 'synthetic' },
            });
            assert(child);
            const counts = () =>
                Object.values(calls).map((items) => items.length);
            const before = counts();
            const adapter = createPortalChildSave({
                client,
                child,
                journal,
                recoveryOwner: 'synthetic-stable-relationship',
                linkedTableId: 'tbl_children',
                loadVersion: ++version,
                getScope: owner.getScope,
                saveOptions: {
                    captchaVal: null,
                    isComputeMode: false,
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
            assert.deepEqual(counts(), before);
            adapters.push(adapter);
            return adapter;
        };
        return {
            calls,
            owner,
            journal,
            attempts,
            open,
            respond: (next) => {
                respond = next;
            },
            onBegin: (callback) => {
                onBegin = callback;
            },
            destroy: () => {
                for (const adapter of adapters) adapter.destroy();
                owner.destroy();
            },
        };
    }
    for (const access of [
        { type: 'create' },
        { type: 'edit', recordId: 'rec_one' },
    ]) {
        const f = await fixture(access);
        try {
            const a = await f.open();
            assert.equal(f.attempts.length, 0);
            assert.equal(f.calls.save.length, 0);
            assert(a.controller.write('fld_title', 'Explicit edit'));
            const result = await a.save();
            assert.equal(result.type, 'saved');
            assert.equal(result.postSubmissionWarnings.length, 1);
            assert.equal(f.calls.save.length, 1);
            const input = f.calls.save[0].input;
            assert.equal(input.formRecord.type, access.type);
            assert.equal(input.formRecord.data.fld_title, 'Explicit edit');
            assert.deepEqual(input.formRecord.data.fld_parent, ['rec_user']);
            assert.deepEqual(input.searchQuery, { child: 'captured' });
            assert.equal(input.context.type, 'modal');
            assert.deepEqual(input.deviceFingerprint, {
                version: 1,
                visitorId: 'synthetic',
            });
            assert.equal(f.attempts[0].outcome, 'saved');
            assert.equal(f.attempts[0].flight, false);
            assert.equal(f.attempts[0].scope.parentFieldId, 'fld_children');
            await assert.rejects(a.save());
            assert.equal(f.calls.save.length, 1); // warnings never replay Save
        } finally {
            f.destroy();
        }
    }
    const validation = await fixture();
    try {
        const a = await validation.open();
        a.controller.write('fld_title', 'Invalid');
        validation.respond(() => ({
            type: 'error',
            formValidationErrors: [
                {
                    fieldId: 'fld_title',
                    fieldTitle: 'Title',
                    errorMessage: 'Synthetic validation',
                },
            ],
            formErrors: {},
        }));
        assert.equal((await a.save()).type, 'error');
        assert.equal(validation.attempts[0].outcome, 'validation-error');
        assert.equal(a.controller.getState().draft.data.fld_title, 'Invalid');
        assert(a.controller.write('fld_title', 'Corrected'));
        assert.equal(validation.calls.save.length, 1);
        await a.save(); // another explicit action, never automatic
        assert.equal(validation.calls.save.length, 2);
    } finally {
        validation.destroy();
    }

    const uncertain = await fixture({ type: 'create' });
    try {
        const a = await uncertain.open();
        uncertain.respond(() => {
            throw Error('Synthetic lost response');
        });
        await assert.rejects(a.save());
        const attempt = uncertain.attempts[0];
        assert.equal(attempt.outcome, 'unknown');
        assert.equal(attempt.flight, false);
        a.destroy();
        const fresh = await uncertain.open();
        await assert.rejects(fresh.save());
        assert.equal(uncertain.calls.save.length, 1); // fresh load alone cannot bypass unknown
        uncertain.journal.acknowledgeNewIntent(attempt);
        assert.equal(attempt.outcome, 'unknown');
        assert.equal(uncertain.calls.save.length, 1); // acknowledgement does not dispatch
    } finally {
        uncertain.destroy();
    }

    for (const retirement of ['owner-ABA', 'new-child', 'cancel']) {
        const f = await fixture();
        try {
            const a = await f.open();
            const pending = fixtures.deferred();
            f.respond(() => pending.promise);
            a.controller.write('fld_title', 'Old child input');
            const flight = a.save();
            const rejection = assert.rejects(flight);
            assert.equal(f.calls.save.length, 1);
            if (retirement === 'owner-ABA') {
                f.owner.changeOwner('B');
                f.owner.changeOwner('synthetic-visitor');
            } else if (retirement === 'new-child') {
                const next = await f.open();
                next.controller.write('fld_title', 'Successor input');
                assert.equal(
                    next.controller.getState().draft.data.fld_title,
                    'Successor input'
                );
            } else a.controller.cancel();
            pending.resolve({
                type: 'saved',
                record: { id: 'rec_one', fields: {} },
                tableId: 'tbl_children',
                loggedInUserRecord: { id: 'rec_user', fields: {} },
                context: { type: 'modal', newTableIdsToLinkedTableStates: {} },
            });
            await rejection;
            assert.equal(f.attempts[0].outcome, 'unknown');
            assert.equal(f.attempts[0].flight, false);
            assert.equal(f.calls.save.length, 1);
        } finally {
            f.destroy();
        }
    }
    const refused = await fixture();
    try {
        const a = await refused.open();
        refused.onBegin(() => refused.owner.changeOwner('replacement'));
        await assert.rejects(a.save());
        assert.equal(refused.calls.save.length, 0);
        assert.equal(refused.attempts[0].outcome, 'not-dispatched');
        assert.equal(refused.attempts[0].flight, false);
    } finally {
        refused.destroy();
    }
}

export async function checkPortalChildSaveRecipe({
    consumerDirectory,
    guideSources,
}) {
    const installed = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk'
    );
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const compiled = {};
    for (const [name, marker] of [
        ['owner', 'createPortalScreenOwner'],
        ['save', 'createPortalChildSave'],
    ]) {
        const matches = guideSources.filter((path) =>
            readFileSync(join(consumerDirectory, path), 'utf8').includes(
                `export function ${marker}(`
            )
        );
        assert.equal(matches.length, 1);
        const text = readFileSync(join(consumerDirectory, matches[0]), 'utf8');
        assert(
            readFileSync(join(installed, 'docs/portals.md'), 'utf8').includes(
                text
            )
        );
        for (const format of ['esm', 'cjs']) {
            const { code } = await transform(text, {
                loader: 'ts',
                format,
                target: 'es2022',
            });
            const file = join(
                consumerDirectory,
                `portal-${name}-save-proof.${format === 'esm' ? 'mjs' : 'cjs'}`
            );
            writeFileSync(file, code);
            compiled[`${name}-${format}`] =
                format === 'esm'
                    ? await import(pathToFileURL(file).href)
                    : require(file);
        }
    }
    const loader = join(consumerDirectory, 'portal-save-public.mjs');
    writeFileSync(
        loader,
        "import * as core from '@miniextensions/sdk';\nimport * as forms from '@miniextensions/sdk/forms';\nexport {core,forms};\nexport const resolved=import.meta.resolve('@miniextensions/sdk/forms');\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    assert.equal(
        realpathSync(fileURLToPath(esm.resolved)),
        realpathSync(join(installed, 'dist/esm/forms/index.js'))
    );
    assert.equal(
        realpathSync(require.resolve('@miniextensions/sdk/forms')),
        realpathSync(join(installed, 'dist/cjs/forms/index.js'))
    );
    for (const [format, api] of [
        ['esm', esm],
        [
            'cjs',
            {
                core: require('@miniextensions/sdk'),
                forms: require('@miniextensions/sdk/forms'),
            },
        ],
    ]) {
        await assertPortalChildSave({
            ...api,
            createPortalScreenOwner:
                compiled[`owner-${format}`].createPortalScreenOwner,
            createPortalChildSave:
                compiled[`save-${format}`].createPortalChildSave,
        });
        console.log(
            `Installed Portal child Save recipe ${format}: synthetic controller/journal composition passed; no live persistence or browser wiring.`
        );
    }
    return 2;
}
