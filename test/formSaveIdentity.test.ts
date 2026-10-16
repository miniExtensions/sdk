import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createFormController,
    normalizeFormSaveResult,
    RecoveryJournal,
    type FormSaveDisposition,
    type FormSaveLifecycle,
    type RecoveryAttempt,
} from '../src/forms/index.js';
import {
    createMiniExtensionsClient,
    type FormLoadedResult,
    type SaveFormInput,
    type SaveFormResult,
} from '../src/runtime/index.js';
import {
    formSaveOptions,
    invalidForm,
    loadedForm,
    savedForm,
} from './formsFixtures.js';

const recordId = 'record_target';
const tableId = 'table_projects';
type Context = SaveFormInput['context']['type'];
type Saved = Extract<SaveFormResult, { type: 'saved' }>;

const loaded = (mode: 'create' | 'edit' = 'edit'): FormLoadedResult => {
    const result = loadedForm();
    result.payload.publicFields.state.tableId = tableId;
    if (mode === 'edit') {
        result.payload.formRecord = {
            type: 'edit',
            recordId,
            tableId,
            data: result.payload.formRecord.data,
        };
    }
    return result;
};
const saved = (context: Context = 'modal', id = recordId): Saved => ({
    ...savedForm(),
    record: { id, fields: { fld_title: 'Server title' } },
    tableId,
    context:
        context === 'direct-url'
            ? { type: 'direct-url' }
            : { type: context, newTableIdsToLinkedTableStates: {} },
});
const deferred = () => {
    let resolve!: (result: unknown) => void;
    const promise = new Promise<unknown>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};

/** Real v1 client adapter; every response and request is synthetic and local. */
const fixture = (
    response: unknown = saved(),
    options: {
        mode?: 'create' | 'edit';
        context?: Context;
        isComputeMode?: boolean;
    } = {}
) => {
    const page = loaded(options.mode);
    const context = options.context ?? 'modal';
    const calls: Array<{
        url: string;
        init: RequestInit;
        input: SaveFormInput & { miniExtStorageV4: { visitor: string } };
    }> = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'visitor_identity' },
        fetch: async (url, init) => {
            assert(init && typeof init.body === 'string');
            calls.push({
                url: String(url),
                init,
                input: JSON.parse(init.body),
            });
            return new Response(JSON.stringify(await response), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });
    const controllerOptions = {
        client,
        loaded: page,
        saveOptions: {
            ...formSaveOptions(),
            isComputeMode: options.isComputeMode ?? false,
            context:
                context === 'direct-url'
                    ? { type: 'direct-url' as const }
                    : { type: context, prefillData: null },
        },
        getScope: () => ({ ownerId: 'identity_owner', revision: 0 }),
    };
    const controller = createFormController(controllerOptions);
    const scope = {
        owner: 'identity_owner',
        parentFieldId: context === 'direct-url' ? null : 'fld_children',
        tableId,
        childExtensionId: page.extensionId,
        context,
    };
    const journal = new RecoveryJournal();
    const dispositions: FormSaveDisposition[] = [];
    let attempt: RecoveryAttempt | undefined;
    let acceptances = 0;
    const lifecycle: FormSaveLifecycle = {
        dispatch(input) {
            const captured = journal.begin(
                scope,
                input.formRecord.type === 'edit'
                    ? input.formRecord.recordId
                    : null,
                'save',
                1
            );
            attempt = captured;
            captured.retainedInput = [
                { title: 'Request title', value: 'Native draft' },
            ];
            return {
                accepted(result) {
                    acceptances++;
                    journal.accepted(
                        captured,
                        result.type === 'saved' ? 'saved' : 'validation-error'
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
    assert.equal(controller.write('fld_title', 'Native draft'), true);
    assert.equal(
        controller.write('fld_files', [
            {
                id: 'attachment_synthetic',
                url: 'https://files.example.test/retained.txt',
                filename: 'retained.txt',
                size: 0,
            },
        ]),
        true
    );
    return {
        page,
        client,
        controller,
        controllerOptions,
        calls,
        journal,
        scope,
        dispositions,
        lifecycle,
        get attempt() {
            assert(attempt);
            return attempt;
        },
        get acceptances() {
            return acceptances;
        },
    };
};

const invalidResponses: Array<[string, (response: Saved) => unknown]> = [
    [
        'another record',
        (response) => ({
            ...response,
            record: { ...response.record, id: 'record_other' },
        }),
    ],
    ['another table', (response) => ({ ...response, tableId: 'table_other' })],
    [
        'a missing record ID',
        (response) => ({
            ...response,
            record: { fields: response.record.fields },
        }),
    ],
    [
        'an empty record ID',
        (response) => ({
            ...response,
            record: { ...response.record, id: '' },
        }),
    ],
    [
        'a non-string record ID',
        (response) => ({
            ...response,
            record: { ...response.record, id: 7 },
        }),
    ],
    ['a missing table ID', (response) => ({ ...response, tableId: undefined })],
    ['an empty table ID', (response) => ({ ...response, tableId: '  ' })],
    ['a non-string table ID', (response) => ({ ...response, tableId: false })],
    ['a malformed record', (response) => ({ ...response, record: null })],
    [
        'malformed record fields',
        (response) => ({
            ...response,
            record: { ...response.record, fields: [] },
        }),
    ],
];

describe('Form Save response identity acceptance', () => {
    for (const [name, change] of invalidResponses) {
        it(`does not accept an edit response with ${name}, retains native dirty input and blocks replay`, async () => {
            const f = fixture(change(saved()));
            const before = f.controller.getState().draft;
            try {
                await assert.rejects(
                    f.controller.save({ lifecycle: f.lifecycle }),
                    TypeError
                );
                assert.equal(f.calls.length, 1);
                assert.equal(
                    f.calls[0].url,
                    'https://sdk.example.test/api/v1?route=saveForm'
                );
                assert.equal(f.calls[0].init.method, 'POST');
                assert.equal(f.calls[0].init.credentials, 'omit');
                assert.deepEqual(f.calls[0].input.formRecord, {
                    ...f.page.payload.formRecord,
                    data: before!.data,
                });
                assert.deepEqual(
                    f.calls[0].input.formFieldIdsWithUnsavedChanges,
                    before!.dirtyFieldIds
                );
                assert.deepEqual(f.calls[0].input.miniExtStorageV4, {
                    visitor: 'visitor_identity',
                });
                const state = f.controller.getState();
                assert.equal(state.status, 'transport-error');
                assert.equal(state.result, null);
                assert.equal(state.canSave, false);
                assert.deepEqual(state.draft, before);
                assert.equal(f.acceptances, 0);
                assert.deepEqual(f.dispositions, ['dispatched']);
                assert.equal(f.attempt.outcome, 'unknown');
                assert.equal(f.attempt.flight, false);
                assert.equal(f.attempt.acknowledgment, 'none');
                assert.deepEqual(f.attempt.retainedInput, [
                    { title: 'Request title', value: 'Native draft' },
                ]);
                assert.equal(f.journal.blocking(f.scope, recordId), f.attempt);
                await assert.rejects(
                    f.controller.save({ lifecycle: f.lifecycle }),
                    { code: 'reload-required' }
                );
                assert.equal(f.calls.length, 1);
                assert.deepEqual(f.dispositions, ['dispatched']);
            } finally {
                f.controller.destroy();
            }
        });
    }

    for (const context of [
        'direct-url',
        'modal',
        'side-panel',
        'form-layout',
    ] as const) {
        it(`accepts the exact edit identity in ${context} and clears only the submitted dirty revision`, async () => {
            const response = saved(context);
            const f = fixture(response, { context });
            try {
                const result = await f.controller.save({
                    lifecycle: f.lifecycle,
                });
                assert.equal(result.type, 'saved');
                assert.deepEqual(result.raw, response);
                assert.equal(f.calls.length, 1);
                assert.equal(f.calls[0].input.context.type, context);
                assert.equal(f.controller.getState().status, 'saved');
                assert.deepEqual(
                    f.controller.getState().draft?.dirtyFieldIds,
                    []
                );
                assert.equal(f.acceptances, 1);
                assert.equal(f.attempt.outcome, 'saved');
                assert.deepEqual(f.dispositions, ['dispatched']);
            } finally {
                f.controller.destroy();
            }
        });
    }

    it('accepts an edit validation response without saved record or table identities and retains dirty input', async () => {
        // Match the actual JSON response: optional undefined members are not on the wire.
        const response = JSON.parse(
            JSON.stringify(invalidForm())
        ) as ReturnType<typeof invalidForm>;
        const f = fixture(response);
        const before = f.controller.getState().draft;
        try {
            const result = await f.controller.save({ lifecycle: f.lifecycle });
            assert.equal(result.type, 'error');
            assert.deepEqual(result.raw, response);
            assert.equal(f.controller.getState().status, 'validation-error');
            assert.equal(f.controller.getState().canSave, true);
            assert.deepEqual(f.controller.getState().draft, before);
            assert.equal(f.controller.getState().validationErrors.length, 3);
            assert.equal(f.acceptances, 1);
            assert.equal(f.attempt.outcome, 'validation-error');
            assert.equal(f.attempt.flight, false);
            assert.equal(f.journal.blocking(f.scope, recordId), undefined);
            assert.deepEqual(f.dispositions, ['dispatched']);
            assert.equal(f.calls.length, 1);
        } finally {
            f.controller.destroy();
        }
    });

    it('accepts a newly assigned create record ID without manufacturing an expected record ID', async () => {
        const response = saved('modal', 'record_newly_assigned');
        const f = fixture(response, { mode: 'create' });
        try {
            const result = await f.controller.save({ lifecycle: f.lifecycle });
            assert.equal(f.calls[0].input.formRecord.type, 'create');
            assert.equal('recordId' in f.calls[0].input.formRecord, false);
            assert.equal('tableId' in f.calls[0].input.formRecord, false);
            assert.equal(result.type, 'saved');
            assert.deepEqual(result.raw, response);
            assert.deepEqual(f.controller.getState().draft?.dirtyFieldIds, []);
            assert.equal(f.attempt.recordId, null);
            assert.equal(f.attempt.outcome, 'saved');
            assert.equal(f.calls.length, 1);
        } finally {
            f.controller.destroy();
        }
    });

    it('binds a create response to the configured table while retaining an unknown attempt on mismatch', async () => {
        const f = fixture(
            {
                ...saved('modal', 'record_created_elsewhere'),
                tableId: 'table_other',
            },
            { mode: 'create' }
        );
        const before = f.controller.getState().draft;
        try {
            await assert.rejects(
                f.controller.save({ lifecycle: f.lifecycle }),
                TypeError
            );
            assert.equal(f.calls[0].input.formRecord.type, 'create');
            assert.deepEqual(f.controller.getState().draft, before);
            assert.equal(f.controller.getState().result, null);
            assert.equal(f.acceptances, 0);
            assert.equal(f.attempt.recordId, null);
            assert.equal(f.attempt.outcome, 'unknown');
            assert.equal(f.attempt.flight, false);
            assert.equal(f.journal.blocking(f.scope, null), f.attempt);
            assert.deepEqual(f.dispositions, ['dispatched']);
            await assert.rejects(f.controller.save(), {
                code: 'reload-required',
            });
            assert.equal(f.calls.length, 1);
        } finally {
            f.controller.destroy();
        }
    });

    for (const mode of ['edit', 'create'] as const) {
        it(`preserves valid ${mode} compute-mode response contracts`, async () => {
            const response = saved(
                'side-panel',
                mode === 'edit' ? recordId : 'record_computed_create'
            );
            const f = fixture(response, {
                mode,
                context: 'side-panel',
                isComputeMode: true,
            });
            try {
                assert.equal(
                    (await f.controller.save({ lifecycle: f.lifecycle })).type,
                    'saved'
                );
                assert.equal(f.calls[0].input.isComputeMode, true);
                assert.equal(f.calls[0].input.formRecord.type, mode);
                assert.equal(f.attempt.outcome, 'saved');
                assert.equal(f.calls.length, 1);
            } finally {
                f.controller.destroy();
            }
        });
    }

    it('keeps newer native edits dirty after an exact successful response', async () => {
        const response = deferred();
        const f = fixture(response.promise);
        try {
            const pending = f.controller.save({ lifecycle: f.lifecycle });
            assert.equal(f.calls.length, 1);
            assert.equal(
                f.controller.write('fld_title', 'Newer native title'),
                true
            );
            const newer = f.controller.getState().draft;
            response.resolve(saved());
            await pending;
            assert.equal(f.controller.getState().status, 'saved');
            assert.equal(f.controller.getState().hasNewerEdits, true);
            assert.deepEqual(f.controller.getState().draft, newer);
            assert.equal(
                f.calls[0].input.formRecord.data.fld_title,
                'Native draft'
            );
            assert.equal(f.calls.length, 1);
        } finally {
            f.controller.destroy();
        }
    });

    for (const resultId of [recordId, 'record_other']) {
        it(`does not let a held ${resultId === recordId ? 'matching' : 'mismatching'} response accept or clean a replacement owner`, async () => {
            const response = deferred();
            const f = fixture(response.promise);
            try {
                const pending = f.controller.save({ lifecycle: f.lifecycle });
                const rejected = assert.rejects(pending);
                assert.equal(f.calls.length, 1);
                const successor = loaded();
                successor.payload.extensionAccessToken = 'successor_access';
                successor.payload.formRecord.data.fld_title =
                    'Successor baseline';
                f.controller.reset({
                    ...f.controllerOptions,
                    loaded: successor,
                    getScope: () => ({ ownerId: 'successor', revision: 1 }),
                });
                assert.equal(
                    f.controller.write('fld_title', 'Successor dirty'),
                    true
                );
                const before = f.controller.getState();
                response.resolve(saved('modal', resultId));
                await rejected;
                assert.deepEqual(f.controller.getState(), before);
                assert.equal(f.acceptances, 0);
                assert.equal(f.attempt.outcome, 'unknown');
                assert.equal(f.attempt.flight, false);
                assert.deepEqual(f.dispositions, ['dispatched']);
                assert.equal(f.calls.length, 1);
            } finally {
                f.controller.destroy();
            }
        });
    }

    it('keeps the accepted output detached from transport, lifecycle and snapshot consumers', async () => {
        const response = saved();
        const f = fixture(response);
        const lifecycle: FormSaveLifecycle = {
            dispatch(input, revision) {
                const operation = f.lifecycle.dispatch(input, revision);
                return {
                    ...operation,
                    accepted(result) {
                        operation.accepted(result);
                        if (result.type === 'saved') {
                            result.raw.record.id = 'record_lifecycle_mutation';
                            result.raw.record.fields.fld_title =
                                'Lifecycle mutation';
                        }
                    },
                };
            },
        };
        try {
            const result = await f.controller.save({ lifecycle });
            assert.equal(result.type, 'saved');
            if (result.type !== 'saved') return;
            assert.deepEqual(result.raw, response);
            result.raw.record.id = 'record_caller_mutation';
            result.raw.record.fields.fld_title = 'Caller mutation';
            const snapshot = f.controller.getState().result;
            assert.equal(snapshot?.type, 'saved');
            if (snapshot?.type !== 'saved') return;
            assert.deepEqual(snapshot.raw, response);
            snapshot.raw.record.fields.fld_title = 'Snapshot mutation';
            assert.deepEqual(f.controller.getState().result?.raw, response);
            assert.equal(response.record.id, recordId);
            assert.equal(f.acceptances, 1);
            assert.equal(f.calls.length, 1);
        } finally {
            f.controller.destroy();
        }
    });

    it('returns the exact detached record snapshot whose identity was validated when the source has an accessor', () => {
        const response = saved();
        let first = true;
        Object.defineProperty(response, 'record', {
            enumerable: true,
            get() {
                const id = first
                    ? recordId
                    : 'record_changed_after_observation';
                first = false;
                return { id, fields: { fld_title: 'Server title' } };
            },
        });
        const normalized = normalizeFormSaveResult(response, loaded());
        assert.equal(normalized.type, 'saved');
        if (normalized.type !== 'saved') return;
        assert.equal(normalized.raw.record.id, recordId);
        assert.deepEqual(normalized.raw.record.fields, {
            fld_title: 'Server title',
        });
    });

    it('snapshots loaded identity before a response accessor can replace its authority', () => {
        const page = loaded();
        const response = saved('modal', 'record_replaced_authority');
        response.tableId = 'table_replaced_authority';
        Object.defineProperty(response, 'type', {
            enumerable: true,
            get() {
                page.payload.publicFields.state.tableId = response.tableId;
                if (page.payload.formRecord.type === 'edit') {
                    page.payload.formRecord.recordId = response.record.id;
                    page.payload.formRecord.tableId = response.tableId;
                }
                return 'saved';
            },
        });
        assert.throws(() => normalizeFormSaveResult(response, page), TypeError);
    });

    for (const [name, change] of invalidResponses.slice(0, 2)) {
        it(`keeps shape-only normalization compatible, while loaded edit normalization rejects ${name}`, () => {
            const response = change(saved()) as SaveFormResult;
            assert.equal(normalizeFormSaveResult(response).type, 'saved');
            assert.throws(
                () => normalizeFormSaveResult(response, loaded()),
                TypeError
            );
        });
    }

    it('fails closed on missing or contradictory loaded target identities without weakening shape-only normalization', () => {
        const edit = loaded();
        const create = loaded('create');
        const contradictory = loaded();
        contradictory.payload.publicFields.state.tableId = 'table_other';
        const emptyEdit = loaded();
        if (emptyEdit.payload.formRecord.type === 'edit') {
            emptyEdit.payload.formRecord.recordId = '';
        }
        for (const page of [edit, create]) {
            const malformed = structuredClone(page) as unknown as {
                payload: { publicFields: unknown };
            };
            malformed.payload.publicFields = {};
            assert.throws(
                () =>
                    normalizeFormSaveResult(
                        saved(),
                        malformed as FormLoadedResult
                    ),
                TypeError
            );
        }
        for (const page of [contradictory, emptyEdit]) {
            assert.throws(
                () => normalizeFormSaveResult(saved(), page),
                TypeError
            );
        }
        assert.equal(normalizeFormSaveResult(saved()).type, 'saved');
    });
});
