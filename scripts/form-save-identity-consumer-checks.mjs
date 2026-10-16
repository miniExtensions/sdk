import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const recordId = 'rec_identity_target';
const tableId = 'tbl_children';
const saved = (id = recordId) => ({
    type: 'saved',
    record: { id, fields: { fld_title: 'Server native title' } },
    loggedInUserRecord: {
        id: 'rec_distinct_parent',
        fields: { fld_children: [id] },
    },
    context: { type: 'modal', newTableIdsToLinkedTableStates: {} },
    tableId,
});
const makePage = (mode = 'edit') => {
    const page = fixtures.makeForm({
        childExtensionInfo: {
            accessType:
                mode === 'edit'
                    ? {
                          type: 'edit',
                          childExtensionRecordId: recordId,
                          childExtensionFieldId: 'fld_children',
                      }
                    : { type: 'create' },
        },
    });
    page.payload.publicFields = { type: 'form', state: { tableId } };
    return page;
};

/** Installed public modules, real SDK transport, synthetic HTTP responses only. */
export async function checkFormSaveIdentityConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const esmRoot = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const modules = [
        {
            format: 'ESM',
            runtime: await import(
                pathToFileURL(join(esmRoot, 'runtime/index.js'))
            ),
            forms: await import(pathToFileURL(join(esmRoot, 'forms/index.js'))),
        },
        {
            format: 'CommonJS',
            runtime: require('@miniextensions/sdk'),
            forms: require('@miniextensions/sdk/forms'),
        },
    ];
    let checks = 0;
    for (const { format, runtime, forms } of modules) {
        const make = (
            response = saved(),
            mode = 'edit',
            isComputeMode = false
        ) => {
            const page = makePage(mode);
            const calls = [];
            const client = runtime.createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                session: { visitor: 'synthetic_identity_owner' },
                fetch: async (url, init) => {
                    assert.equal(
                        String(url),
                        'https://sdk.example.test/api/v1?route=saveForm',
                        format
                    );
                    assert.equal(init.method, 'POST', format);
                    assert.equal(init.credentials, 'omit', format);
                    calls.push(JSON.parse(init.body));
                    return new Response(JSON.stringify(await response), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' },
                    });
                },
            });
            const options = {
                client,
                loaded: page,
                getScope: () => ({ ownerId: 'A', revision: 0 }),
                saveOptions: {
                    captchaVal: null,
                    isComputeMode,
                    searchQuery: { retained: 'exact' },
                    context: { type: 'modal', prefillData: null },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            };
            const controller = forms.createFormController(options);
            const journal = new forms.RecoveryJournal();
            const scope = {
                owner: 'A',
                parentFieldId: 'fld_children',
                tableId,
                childExtensionId: page.extensionId,
                context: 'modal',
            };
            const dispositions = [];
            let attempt,
                acceptances = 0;
            const lifecycle = {
                dispatch(input) {
                    attempt = journal.begin(
                        scope,
                        input.formRecord.type === 'edit' ? recordId : null,
                        'save',
                        1
                    );
                    const captured = attempt;
                    captured.retainedInput = [
                        { title: 'Title', value: 'Local native title' },
                    ];
                    return {
                        accepted(result) {
                            acceptances++;
                            journal.accepted(
                                captured,
                                result.type === 'saved'
                                    ? 'saved'
                                    : 'validation-error'
                            );
                        },
                        finish(disposition) {
                            dispositions.push(disposition);
                            if (disposition === 'not-dispatched')
                                journal.notDispatched(captured);
                            else journal.finishFlight(captured);
                        },
                    };
                },
            };
            assert.equal(
                controller.write('fld_title', 'Local native title'),
                true
            );
            assert.equal(controller.write('fld_quantity', 0), true);
            return {
                page,
                options,
                controller,
                calls,
                journal,
                scope,
                dispositions,
                lifecycle,
                get attempt() {
                    return attempt;
                },
                get acceptances() {
                    return acceptances;
                },
            };
        };
        const invalid = [
            { ...saved(), record: { ...saved().record, id: 'rec_other' } },
            { ...saved(), tableId: 'tbl_other' },
            { ...saved(), record: { fields: {} } },
            { ...saved(), record: { id: '', fields: {} } },
            { ...saved(), record: { id: 1, fields: {} } },
            { ...saved(), tableId: undefined },
            { ...saved(), tableId: '' },
            { ...saved(), tableId: false },
            { ...saved(), record: null },
            { ...saved(), record: { id: recordId, fields: [] } },
        ];
        for (const response of invalid) {
            const f = make(response);
            const before = f.controller.getState().draft;
            try {
                await assert.rejects(
                    f.controller.save({ lifecycle: f.lifecycle }),
                    TypeError
                );
                assert.equal(f.calls.length, 1, format);
                assert.deepEqual(
                    f.calls[0].formRecord,
                    { ...f.page.payload.formRecord, data: before.data },
                    format
                );
                assert.deepEqual(
                    f.calls[0].formFieldIdsWithUnsavedChanges,
                    before.dirtyFieldIds,
                    format
                );
                assert.deepEqual(
                    f.calls[0].miniExtStorageV4,
                    { visitor: 'synthetic_identity_owner' },
                    format
                );
                assert.deepEqual(f.controller.getState().draft, before, format);
                assert.equal(
                    f.controller.getState().status,
                    'transport-error',
                    format
                );
                assert.equal(f.controller.getState().result, null, format);
                assert.equal(f.acceptances, 0, format);
                assert.equal(f.attempt.outcome, 'unknown', format);
                assert.equal(f.attempt.flight, false, format);
                assert.equal(
                    f.journal.blocking(f.scope, recordId),
                    f.attempt,
                    format
                );
                assert.deepEqual(
                    f.attempt.retainedInput,
                    [{ title: 'Title', value: 'Local native title' }],
                    format
                );
                assert.deepEqual(f.dispositions, ['dispatched'], format);
                await assert.rejects(f.controller.save(), {
                    code: 'reload-required',
                });
                assert.equal(f.calls.length, 1, format);
                checks++;
            } finally {
                f.controller.destroy();
            }
        }
        for (const mode of ['create', 'edit']) {
            const response = saved(
                mode === 'create' ? 'rec_created_by_server' : recordId
            );
            const f = make(response, mode);
            try {
                const result = await f.controller.save({
                    lifecycle: f.lifecycle,
                });
                assert.equal(result.type, 'saved', format);
                assert.deepEqual(result.raw, response, format);
                assert.equal(f.calls[0].formRecord.type, mode, format);
                if (mode === 'create') {
                    assert.equal(
                        'recordId' in f.calls[0].formRecord,
                        false,
                        format
                    );
                    assert.equal(
                        'tableId' in f.calls[0].formRecord,
                        false,
                        format
                    );
                }
                assert.deepEqual(
                    f.controller.getState().draft.dirtyFieldIds,
                    [],
                    format
                );
                assert.equal(f.acceptances, 1, format);
                assert.equal(f.attempt.outcome, 'saved', format);
                result.raw.record.id = 'rec_caller_mutation';
                assert.deepEqual(
                    f.controller.getState().result.raw,
                    response,
                    format
                );
                assert.equal(f.calls.length, 1, format);
                checks++;
            } finally {
                f.controller.destroy();
            }
        }
        {
            const response = {
                type: 'error',
                formErrors: { fld_title: 'Review the title.' },
                formValidationErrors: [],
            };
            const f = make(response);
            const before = f.controller.getState().draft;
            try {
                const result = await f.controller.save({
                    lifecycle: f.lifecycle,
                });
                assert.equal(result.type, 'error', format);
                assert.deepEqual(result.raw, response, format);
                assert.equal(
                    f.controller.getState().status,
                    'validation-error',
                    format
                );
                assert.equal(f.controller.getState().canSave, true, format);
                assert.deepEqual(f.controller.getState().draft, before, format);
                assert.equal(f.acceptances, 1, format);
                assert.equal(f.attempt.outcome, 'validation-error', format);
                assert.equal(
                    f.journal.blocking(f.scope, recordId),
                    undefined,
                    format
                );
                assert.deepEqual(f.dispositions, ['dispatched'], format);
                assert.equal(f.calls.length, 1, format);
                checks++;
            } finally {
                f.controller.destroy();
            }
        }
        {
            const f = make(
                { ...saved('rec_new'), tableId: 'tbl_other' },
                'create'
            );
            const before = f.controller.getState().draft;
            try {
                await assert.rejects(
                    f.controller.save({ lifecycle: f.lifecycle }),
                    TypeError
                );
                assert.deepEqual(f.controller.getState().draft, before, format);
                assert.equal(f.acceptances, 0, format);
                assert.equal(f.attempt.recordId, null, format);
                assert.equal(
                    f.journal.blocking(f.scope, null),
                    f.attempt,
                    format
                );
                assert.equal(f.calls.length, 1, format);
                checks++;
            } finally {
                f.controller.destroy();
            }
        }
        {
            const f = make(saved('rec_compute_create'), 'create', true);
            try {
                assert.equal((await f.controller.save()).type, 'saved', format);
                assert.equal(f.calls[0].isComputeMode, true, format);
                assert.equal(f.calls[0].formRecord.type, 'create', format);
                assert.equal(f.calls.length, 1, format);
                checks++;
            } finally {
                f.controller.destroy();
            }
        }
        {
            let release;
            const response = new Promise((resolve) => {
                release = resolve;
            });
            const f = make(response);
            try {
                const pending = f.controller.save({ lifecycle: f.lifecycle });
                const rejected = assert.rejects(pending);
                assert.equal(f.calls.length, 1, format);
                const successor = makePage();
                successor.payload.extensionAccessToken =
                    'synthetic_successor_access';
                f.controller.reset({
                    ...f.options,
                    loaded: successor,
                    getScope: () => ({ ownerId: 'B', revision: 1 }),
                });
                assert.equal(
                    f.controller.write('fld_title', 'Successor dirty'),
                    true,
                    format
                );
                const before = f.controller.getState();
                release(saved());
                await rejected;
                assert.deepEqual(f.controller.getState(), before, format);
                assert.equal(f.acceptances, 0, format);
                assert.equal(f.attempt.outcome, 'unknown', format);
                assert.equal(f.attempt.flight, false, format);
                assert.deepEqual(f.dispositions, ['dispatched'], format);
                assert.equal(f.calls.length, 1, format);
                checks++;
            } finally {
                f.controller.destroy();
            }
        }
        {
            const response = { ...saved(), tableId: 'tbl_other' };
            assert.equal(
                forms.normalizeFormSaveResult(response).type,
                'saved',
                format
            );
            assert.throws(
                () => forms.normalizeFormSaveResult(response, makePage()),
                TypeError
            );
            checks++;
        }
    }
    console.log(
        `Installed Form Save identity: ${checks} checkpoints across ESM/CommonJS; synthetic transport only.`
    );
    return checks;
}
