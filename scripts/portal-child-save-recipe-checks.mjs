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
    const assertSaveCount = (actual, expected) =>
        assert.equal(actual, expected, 'Only explicit Save may dispatch');
    const assertRecovery = (attempt, expected) =>
        assert.deepEqual(
            {
                outcome: attempt.outcome,
                flight: attempt.flight,
                acknowledgment: attempt.acknowledgment,
                associatedRecordId: attempt.associatedRecordId,
            },
            expected,
            'Acknowledgment must preserve uncertainty and exact association'
        );
    const assertActiveRefusal = (operation) =>
        assert.throws(operation, /Wait for the browser action to stop/);
    const assertSuccessorDraft = (actual, expected) =>
        assert.deepEqual(
            actual,
            expected,
            'Late Save must preserve successor draft'
        );
    // Oracle controls corrupt observations/ports only; no installed runtime mutation.
    const settled = {
        outcome: 'unknown',
        flight: false,
        acknowledgment: 'existing-request',
        associatedRecordId: 'rec_inspected',
    };
    for (const patch of [
        { outcome: 'saved' },
        { flight: true },
        { acknowledgment: 'none' },
        { associatedRecordId: 'rec_wrong' },
    ]) {
        assert.throws(() => assertRecovery({ ...settled, ...patch }, settled), {
            code: 'ERR_ASSERTION',
            message: /Acknowledgment must preserve uncertainty/,
        });
    }
    for (const [actual, expected] of [
        [2, 1],
        [1, 2],
    ]) {
        assert.throws(() => assertSaveCount(actual, expected), {
            code: 'ERR_ASSERTION',
            message: /Only explicit Save may dispatch/,
        });
    }
    assert.throws(() => assertActiveRefusal(() => {}), {
        code: 'ERR_ASSERTION',
    });
    assert.throws(
        () =>
            assertSuccessorDraft(
                { fld_title: 'late' },
                { fld_title: 'successor' }
            ),
        {
            code: 'ERR_ASSERTION',
            message: /Late Save must preserve successor draft/,
        }
    );
    console.log(
        'Portal oracle controls: four recovery-state faults, extra/missing dispatch, absent refusal and successor corruption rejected (no runtime mutation).'
    );
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

    for (const access of [
        { type: 'create' },
        { type: 'edit', recordId: 'rec_one' },
    ]) {
        for (const acknowledgment of ['existing-request', 'new-intent']) {
            const f = await fixture(access);
            const pending = fixtures.deferred();
            try {
                const a = await f.open();
                f.respond(() =>
                    pending.promise.then(() => {
                        throw Error('Synthetic lost response');
                    })
                );
                const flight = assert.rejects(
                    a.save(),
                    /Synthetic lost response/
                );
                const attempt = f.attempts[0];
                const active = {
                    outcome: 'unknown',
                    flight: true,
                    acknowledgment: 'none',
                    associatedRecordId: null,
                };
                assertRecovery(attempt, active);
                for (const acknowledge of [
                    () =>
                        f.journal.acknowledgeExisting(attempt, 'rec_inspected'),
                    () => f.journal.acknowledgeNewIntent(attempt),
                ]) {
                    assertActiveRefusal(acknowledge);
                    assertRecovery(attempt, active);
                    assertSaveCount(f.calls.save.length, 1);
                }
                await assert.rejects(a.save());
                assert.equal(f.attempts.length, 1);
                assertSaveCount(f.calls.save.length, 1);
                pending.resolve();
                await flight;
                assertRecovery(attempt, { ...active, flight: false });
                a.destroy();
                const fresh = await f.open();
                await assert.rejects(fresh.save());
                assertSaveCount(f.calls.save.length, 1); // fresh load cannot bypass unknown
                if (acknowledgment === 'existing-request')
                    f.journal.acknowledgeExisting(attempt, 'rec_inspected');
                else f.journal.acknowledgeNewIntent(attempt);
                const acknowledged = {
                    outcome: 'unknown',
                    flight: false,
                    acknowledgment,
                    associatedRecordId:
                        acknowledgment === 'existing-request'
                            ? 'rec_inspected'
                            : null,
                };
                assertRecovery(attempt, acknowledged);
                assert.equal(f.attempts.length, 1);
                assertSaveCount(f.calls.save.length, 1); // acknowledgment never dispatches
                assert(
                    fresh.controller.write('fld_title', 'Explicit new intent')
                );
                assertSaveCount(f.calls.save.length, 1);
                f.respond((input) => ({
                    type: 'saved',
                    record: {
                        id:
                            access.type === 'create'
                                ? 'rec_new'
                                : access.recordId,
                        fields: input.formRecord.data,
                    },
                    tableId: 'tbl_children',
                    loggedInUserRecord: { id: 'rec_user', fields: {} },
                    context: {
                        type: 'modal',
                        newTableIdsToLinkedTableStates: {},
                    },
                }));
                assert.equal((await fresh.save()).type, 'saved');
                assertSaveCount(f.calls.save.length, 2);
                assert.equal(f.attempts.length, 2);
                assert.notEqual(f.attempts[1], attempt);
                assert.equal(f.attempts[1].outcome, 'saved');
                assert.equal(f.attempts[1].flight, false);
                assert(f.attempts[1].loadVersion > attempt.loadVersion);
                assertRecovery(attempt, acknowledged); // old unknown is never rewritten
                const input = f.calls.save[1].input;
                assert.equal(input.formRecord.type, access.type);
                if (access.type === 'edit')
                    assert.equal(input.formRecord.recordId, access.recordId);
                assert.equal(
                    input.formRecord.data.fld_title,
                    'Explicit new intent'
                );
                assert.deepEqual(input.formRecord.data.fld_parent, [
                    'rec_user',
                ]);
            } finally {
                pending.resolve();
                f.destroy();
            }
        }
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
            let successor;
            let successorDraft;
            if (retirement === 'owner-ABA') {
                f.owner.changeOwner('B');
                f.owner.changeOwner('synthetic-visitor');
            } else if (retirement === 'new-child') {
                const next = await f.open();
                next.controller.write('fld_title', 'Successor input');
                successor = next;
                successorDraft = structuredClone(
                    next.controller.getState().draft
                );
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
            if (successor)
                assertSuccessorDraft(
                    successor.controller.getState().draft,
                    successorDraft
                );
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
