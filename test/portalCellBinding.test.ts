import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createPortalCellBinding,
    type PortalCellBindingOptions,
} from '../src/portals/index.js';
import { FormDraftStore } from '../src/forms/drafts.js';
import type { AirtableValue } from '../src/runtime/types.js';
import { RecoveryJournal } from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/index.js';
import type {
    UpdateGridCellInput,
    UpdateGridCellResult,
    RuntimeFieldSchema,
} from '../src/runtime/types.js';
import { loadedForm } from './formsFixtures.js';

const fixture = (respond?: () => Promise<UpdateGridCellResult>) => {
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw new Error('No read');
        },
        session: { visitor: 'A' },
    });
    const calls: UpdateGridCellInput[] = [];
    client.portals.updateGridCell = async (input) => {
        calls.push(structuredClone(input));
        return respond
            ? respond()
            : ({
                  auditTrail: null,
                  auditTrails: [],
                  record: { id: 'rec_one', fields: { fld_title: input.value } },
              } as UpdateGridCellResult);
    };
    let owner = { ownerId: 'A', revision: 0 };
    let lease = true;
    const journal = new RecoveryJournal();
    const options = {
        client,
        input: {
            portalExtensionAccessToken: 'token',
            portalFieldId: 'fld_children',
            recordFieldId: 'fld_title',
            recordId: 'rec_one',
            selectedCustomViewId: 'view_one',
        },
        schema: loadedForm().payload.fieldIdsToSchemas.fld_title,
        value: 'Initial',
        getScope: () => owner,
        isCurrent: () => lease,
        recovery: {
            journal,
            scope: {
                owner: 'A',
                parentFieldId: 'fld_children',
                tableId: 'tbl_children',
                childExtensionId: '',
                context: 'modal' as const,
            },
            loadVersion: 1,
        },
    };
    return {
        client,
        calls,
        journal,
        options,
        replace: () => {
            owner = { ownerId: 'B', revision: 1 };
        },
        retire: () => {
            lease = false;
        },
    };
};

describe('Portal cell shared binding and journal', () => {
    it('subscribed stock/custom remount retains native draft and sends exactly one canonical cell write', async () => {
        const f = fixture();
        const cell = createPortalCellBinding(f.options);
        let observed: unknown;
        const stop = cell.binding.subscribe((s) => {
            observed = s.value;
        });
        cell.binding.setValue('Edited');
        stop();
        assert.equal(observed, 'Edited');
        assert.equal(cell.binding.getSnapshot().dirty, true);
        const next = cell.binding.subscribe((s) => {
            observed = s.value;
        });
        assert.equal(observed, 'Edited');
        await cell.save();
        assert.deepEqual(f.calls, [{ ...f.options.input, value: 'Edited' }]);
        assert.equal(cell.binding.getSnapshot().dirty, false);
        await assert.rejects(cell.save());
        assert.equal(f.calls.length, 1);
        next();
        cell.destroy();
    });
    it('unknown/cancelled outcome retains no replay across a fresh owner with the same native record', async () => {
        let resolve!: (r: UpdateGridCellResult) => void;
        const f = fixture(
            () =>
                new Promise((r) => {
                    resolve = r;
                })
        );
        const cell = createPortalCellBinding(f.options);
        const saving = cell.save();
        cell.cancel();
        resolve({
            auditTrail: null,
            auditTrails: [],
            record: { id: 'rec_one', fields: {} },
        } as UpdateGridCellResult);
        await assert.rejects(saving);
        assert.equal(f.journal.unknown('A').length, 1);
        const replacement = createPortalCellBinding(f.options);
        assert.equal(replacement.binding.getSnapshot().canEdit, false);
        await assert.rejects(replacement.save());
        assert.equal(f.calls.length, 1);
        cell.destroy();
        replacement.destroy();
    });
    it('late owner/session outcomes cannot accept the old attempt or change successor state', async () => {
        for (const kind of ['owner', 'session', 'lease']) {
            let resolve!: (r: UpdateGridCellResult) => void;
            const f = fixture(
                () =>
                    new Promise((r) => {
                        resolve = r;
                    })
            );
            const cell = createPortalCellBinding(f.options);
            const saving = cell.save();
            if (kind === 'owner') f.replace();
            else if (kind === 'session') f.client.setSession({ visitor: 'B' });
            else f.retire();
            assert.equal(cell.binding.setValue('old').accepted, false);
            resolve({
                auditTrail: null,
                auditTrails: [],
                record: { id: 'rec_one', fields: { fld_title: 'late' } },
            } as UpdateGridCellResult);
            await assert.rejects(saving);
            assert.equal(f.journal.unknown('A').length, 1);
            assert.equal(cell.binding.getSnapshot().retired, true);
            cell.destroy();
        }
    });
    it('accepted mutation stays accepted when a presentation subscriber throws', async () => {
        const f = fixture();
        const cell = createPortalCellBinding(f.options);
        let initial = true;
        cell.binding.subscribe(() => {
            if (!initial) throw new Error('renderer');
        });
        initial = false;
        await cell.save();
        assert.equal(f.journal.unknown('A').length, 0);
        await assert.rejects(cell.save());
        cell.destroy();
    });
    it('select atomic replacement reuses shared policy and native names, not labels', async () => {
        const f = fixture();
        const schema = {
            fieldType: 'multipleSelects',
            airtableField: {
                id: 'fld_title',
                name: 'Choices',
                isComputed: false,
                config: {
                    type: 'multipleSelects',
                    options: {
                        choices: [
                            { id: 'a', name: 'Alpha' },
                            { id: 'b', name: 'Beta' },
                        ],
                    },
                },
            },
            miniExtConfig: { maxNumberOfSelections: 1 },
        } as RuntimeFieldSchema;
        const cell = createPortalCellBinding({
            ...f.options,
            schema,
            value: ['Alpha'],
        });
        assert.equal(cell.binding.setValue(['Beta']).accepted, true);
        assert.equal(cell.binding.setValue(['Alpha', 'Beta']).accepted, false);
        await cell.save();
        assert.deepEqual(f.calls[0].value, ['Beta']);
        cell.destroy();
    });
    it('readonly, conditional and attachments never become an inline upload or mutation capability', async () => {
        const f = fixture();
        const readonly = structuredClone(f.options.schema);
        readonly.miniExtConfig = { readOnly: true };
        const cell = createPortalCellBinding({
            ...f.options,
            schema: readonly,
        });
        assert.equal(cell.binding.setValue('No').accepted, false);
        await assert.rejects(cell.save());
        assert.equal(f.calls.length, 0);
        cell.destroy();
        const invalid = structuredClone(f.options.schema);
        invalid.fieldType = 'multipleAttachments';
        assert.throws(() =>
            createPortalCellBinding({ ...f.options, schema: invalid })
        );
    });
});

const cellResult = (
    fields: UpdateGridCellResult['record']['fields'] = {},
    recordId = 'rec_one'
): UpdateGridCellResult => ({
    record: { id: recordId, fields },
    auditTrail: null,
    auditTrails: [],
});

const deferred = <Value>() => {
    let resolve!: (value: Value) => void;
    const promise = new Promise<Value>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

/** Real public client and tRPC adapter; only the synthetic HTTP boundary is injected. */
const wireFixture = (
    respond: (input: UpdateGridCellInput) => unknown | Promise<unknown>
) => {
    const calls: UpdateGridCellInput[] = [];
    const attempts: Array<ReturnType<RecoveryJournal['begin']>> = [];
    const started = deferred<void>();
    const journal = new RecoveryJournal();
    const recoveryScope = {
        owner: 'A',
        parentFieldId: 'fld_children',
        tableId: 'tbl_children',
        childExtensionId: '',
        context: 'modal' as const,
    };
    let owner = { ownerId: 'A', revision: 0 };
    let lease = true;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async (url, init) => {
            assert.equal(
                new URL(String(url)).pathname,
                '/api/trpc/airtable.updatePortalRecord'
            );
            assert.equal(init?.method, 'POST');
            assert.deepEqual(
                JSON.parse(new Headers(init?.headers).get('miniext-context')!),
                { miniExtStorageV4: { visitor: 'A' } }
            );
            const input = JSON.parse(String(init?.body)) as UpdateGridCellInput;
            calls.push(structuredClone(input));
            const attempt = journal.blocking(recoveryScope, 'rec_one');
            assert.ok(attempt);
            assert.equal(attempt.outcome, 'unknown');
            assert.equal(attempt.flight, true);
            attempts.push(attempt);
            started.resolve(undefined);
            const output = await respond(input);
            return new Response(JSON.stringify({ result: { data: output } }), {
                headers: { 'Content-Type': 'application/json' },
            });
        },
    });
    const options: PortalCellBindingOptions = {
        client,
        input: {
            portalExtensionAccessToken: 'token',
            portalFieldId: 'fld_children',
            recordFieldId: 'fld_title',
            recordId: 'rec_one',
            selectedCustomViewId: 'view_one',
        },
        schema: loadedForm().payload.fieldIdsToSchemas.fld_title,
        value: 'Initial',
        getScope: () => owner,
        isCurrent: () => lease,
        recovery: { journal, scope: recoveryScope, loadVersion: 1 },
    };
    return {
        client,
        options,
        calls,
        attempts,
        journal,
        started: started.promise,
        replace: () => {
            owner = { ownerId: 'B', revision: 1 };
        },
        revise: () => {
            owner = { ...owner, revision: owner.revision + 1 };
        },
        retire: () => {
            lease = false;
        },
    };
};

describe('Portal cell response identity through the public client', () => {
    const invalid: Array<{ name: string; result: unknown }> = [
        {
            name: 'foreign record ID',
            result: cellResult({ fld_title: 'Foreign' }, 'rec_other'),
        },
        {
            name: 'missing record',
            result: { auditTrail: null, auditTrails: [] },
        },
        { name: 'null record', result: { ...cellResult(), record: null } },
        { name: 'array record', result: { ...cellResult(), record: [] } },
        {
            name: 'missing record ID',
            result: { ...cellResult(), record: { fields: {} } },
        },
        { name: 'blank record ID', result: cellResult({}, ' \t ') },
        {
            name: 'nonstring record ID',
            result: { ...cellResult(), record: { id: 1, fields: {} } },
        },
        {
            name: 'missing fields',
            result: { ...cellResult(), record: { id: 'rec_one' } },
        },
        {
            name: 'null fields',
            result: {
                ...cellResult(),
                record: { id: 'rec_one', fields: null },
            },
        },
        {
            name: 'array fields',
            result: { ...cellResult(), record: { id: 'rec_one', fields: [] } },
        },
        {
            name: 'primitive fields',
            result: {
                ...cellResult(),
                record: { id: 'rec_one', fields: 'Foreign' },
            },
        },
        { name: 'null result', result: null },
        { name: 'array result', result: [] },
        { name: 'primitive result', result: 'not a cell receipt' },
    ];
    for (const example of invalid) {
        it(`refuses ${example.name} without acknowledging, pruning or replaying the native draft`, async () => {
            const f = wireFixture(() => example.result);
            const cell = createPortalCellBinding(f.options);
            let replacement:
                | ReturnType<typeof createPortalCellBinding>
                | undefined;
            try {
                assert.equal(cell.binding.setValue('Edited').accepted, true);
                const before = cell.binding.getSnapshot();
                await assert.rejects(cell.save());
                assert.deepEqual(f.calls, [
                    { ...f.options.input, value: 'Edited' },
                ]);
                const after = cell.binding.getSnapshot();
                assert.equal(after.value, before.value);
                assert.equal(after.revision, before.revision);
                assert.equal(after.dirty, true);
                assert.equal(after.pending, false);
                assert.equal(after.canEdit, false);
                assert.match(after.error ?? '', /unknown/i);
                assert.equal(f.attempts.length, 1);
                const attempt = f.attempts[0]!;
                assert.equal(attempt.recordId, 'rec_one');
                assert.equal(attempt.fieldId, 'fld_title');
                assert.equal(attempt.outcome, 'unknown');
                assert.equal(attempt.flight, false);
                assert.equal(attempt.acknowledgment, 'none');
                assert.equal(attempt.associatedRecordId, null);
                assert.deepEqual(f.journal.unknown('A'), [attempt]);
                await assert.rejects(cell.save());
                replacement = createPortalCellBinding(f.options);
                assert.equal(replacement.binding.getSnapshot().canEdit, false);
                assert.equal(
                    replacement.binding.setValue('Replay').accepted,
                    false
                );
                await assert.rejects(replacement.save());
                assert.equal(f.calls.length, 1);
                assert.equal(f.attempts.length, 1);
                assert.equal(cell.binding.getSnapshot().value, 'Edited');
                assert.equal(cell.binding.getSnapshot().dirty, true);
            } finally {
                replacement?.destroy();
                cell.destroy();
            }
        });
    }

    const valid: Array<{
        name: string;
        value: string | null;
        fields: UpdateGridCellResult['record']['fields'];
    }> = [
        {
            name: 'matching ordinary record',
            value: 'Edited',
            fields: { fld_title: 'Edited' },
        },
        { name: 'sparse cleared cell', value: null, fields: {} },
        {
            name: 'server-normalized cell and additional computed fields',
            value: 'Edited',
            fields: { fld_title: 'Server normalized', fld_total: 42 },
        },
    ];
    for (const example of valid) {
        it(`accepts a ${example.name} without requiring a submitted-value echo`, async () => {
            const f = wireFixture(() => cellResult(example.fields));
            const cell = createPortalCellBinding(f.options);
            try {
                assert.equal(
                    cell.binding.setValue(example.value).accepted,
                    true
                );
                const result = await cell.save();
                assert.deepEqual(result, cellResult(example.fields));
                assert.deepEqual(f.calls, [
                    { ...f.options.input, value: example.value },
                ]);
                assert.equal(cell.binding.getSnapshot().value, example.value);
                assert.equal(cell.binding.getSnapshot().dirty, false);
                assert.equal(f.attempts.length, 1);
                assert.equal(f.attempts[0]!.outcome, 'saved');
                assert.equal(f.attempts[0]!.flight, false);
                assert.equal(f.attempts[0]!.acknowledgment, 'none');
                assert.equal(f.journal.unknown('A').length, 0);
                await assert.rejects(cell.save());
                assert.equal(f.calls.length, 1);
            } finally {
                cell.destroy();
            }
        });
    }

    it('keeps real-client late owner, revision, session and lifecycle responses unknown', async () => {
        for (const kind of [
            'owner',
            'revision',
            'session',
            'lease',
            'cancel',
            'external-abort',
            'destroy',
        ] as const) {
            const reply = deferred<unknown>();
            const f = wireFixture(() => reply.promise);
            const cell = createPortalCellBinding(f.options);
            const abort = new AbortController();
            try {
                assert.equal(cell.binding.setValue('Edited').accepted, true);
                const revision = cell.binding.getSnapshot().revision;
                const saving = cell.save({ signal: abort.signal });
                const rejection = assert.rejects(saving);
                await f.started;
                assert.equal(cell.binding.setValue('Overtake').accepted, false);
                assert.equal(cell.binding.getSnapshot().revision, revision);
                if (kind === 'owner') f.replace();
                else if (kind === 'revision') f.revise();
                else if (kind === 'session')
                    f.client.setSession({ visitor: 'B' });
                else if (kind === 'lease') f.retire();
                else if (kind === 'cancel') cell.cancel();
                else if (kind === 'external-abort') abort.abort(null);
                else cell.destroy();
                reply.resolve(cellResult({ fld_title: 'Late' }));
                await rejection;
                assert.equal(f.calls.length, 1, kind);
                assert.equal(f.attempts.length, 1, kind);
                assert.equal(f.attempts[0]!.outcome, 'unknown', kind);
                assert.equal(f.attempts[0]!.flight, false, kind);
                assert.equal(f.attempts[0]!.acknowledgment, 'none', kind);
                assert.equal(f.journal.unknown('A').length, 1, kind);
                await assert.rejects(cell.save());
                assert.equal(f.calls.length, 1, kind);
                if (kind === 'cancel' || kind === 'external-abort') {
                    assert.equal(cell.binding.getSnapshot().value, 'Edited');
                    assert.equal(cell.binding.getSnapshot().dirty, true);
                } else assert.equal(cell.binding.getSnapshot().retired, true);
            } finally {
                reply.resolve(cellResult());
                cell.destroy();
            }
        }
    });

    it('a pre-aborted Save preserves the draft without a transport or unknown attempt', async () => {
        const f = wireFixture(() => cellResult());
        const cell = createPortalCellBinding(f.options);
        const abort = new AbortController();
        abort.abort(null);
        try {
            assert.equal(cell.binding.setValue('Edited').accepted, true);
            const before = cell.binding.getSnapshot();
            await assert.rejects(cell.save({ signal: abort.signal }));
            assert.equal(f.calls.length, 0);
            assert.equal(f.attempts.length, 0);
            assert.equal(f.journal.unknown('A').length, 0);
            assert.equal(cell.binding.getSnapshot().value, before.value);
            assert.equal(cell.binding.getSnapshot().revision, before.revision);
            assert.equal(cell.binding.getSnapshot().dirty, true);
            assert.equal(cell.binding.getSnapshot().canEdit, true);
        } finally {
            cell.destroy();
        }
    });

    it('compares the response with the target copied at construction, not later caller mutations', async () => {
        const f = wireFixture(() => cellResult({ fld_title: 'Edited' }));
        const expected = structuredClone(f.options.input);
        const cell = createPortalCellBinding(f.options);
        try {
            f.options.input.recordId = 'rec_other';
            f.options.input.recordFieldId = 'fld_other';
            f.options.schema.airtableField.id = 'fld_other';
            assert.equal(cell.binding.setValue('Edited').accepted, true);
            assert.equal((await cell.save()).record.id, 'rec_one');
            assert.deepEqual(f.calls, [{ ...expected, value: 'Edited' }]);
            assert.equal(cell.binding.getSnapshot().dirty, false);
            assert.equal(f.attempts[0]!.outcome, 'saved');
        } finally {
            cell.destroy();
        }
    });
});

describe('Portal cell custom-response snapshot boundary', () => {
    // JSON transport responses cannot retain accessors or aliases. These cases
    // exercise only an application-supplied client adapter at that boundary.
    it('returns the same detached result that was validated, without nested aliases to the adapter', async () => {
        const raw = cellResult({ fld_title: 'Server', fld_total: 42 });
        const f = fixture(async () => raw);
        const cell = createPortalCellBinding(f.options);
        try {
            assert.equal(cell.binding.setValue('Edited').accepted, true);
            const result = await cell.save();
            assert.deepEqual(result, raw);
            assert.notStrictEqual(result, raw);
            assert.notStrictEqual(result.record, raw.record);
            assert.notStrictEqual(result.record.fields, raw.record.fields);
            assert.notStrictEqual(result.auditTrails, raw.auditTrails);
            raw.record.id = 'rec_other';
            raw.record.fields.fld_title = 'Changed after acceptance';
            raw.auditTrails.push({
                linkedRecordsFieldToAudit: 'fld_audit',
                recordId: 'rec_audit',
            });
            assert.deepEqual(
                result,
                cellResult({ fld_title: 'Server', fld_total: 42 })
            );
            result.record.fields.fld_total = 99;
            assert.equal(raw.record.fields.fld_total, 42);
            assert.equal(cell.binding.getSnapshot().value, 'Edited');
            assert.equal(cell.binding.getSnapshot().dirty, false);
            assert.equal(f.calls.length, 1);
        } finally {
            cell.destroy();
        }
    });

    for (const kind of [
        'owner',
        'revision',
        'session',
        'lease',
        'cancel',
    ] as const) {
        it(`rechecks ${kind} after reading a response accessor and refuses the retired acknowledgment`, async () => {
            const raw = cellResult({ fld_title: 'Backend' });
            const record = raw.record;
            const f = fixture(async () => raw);
            const cell = createPortalCellBinding(f.options);
            let reads = 0;
            Object.defineProperty(raw, 'record', {
                enumerable: true,
                get() {
                    reads++;
                    if (kind === 'owner') f.replace();
                    else if (kind === 'revision') {
                        const scope = f.options.getScope();
                        scope.revision++;
                    } else if (kind === 'session')
                        f.client.setSession({ visitor: 'B' });
                    else if (kind === 'lease') f.retire();
                    else cell.cancel();
                    return record;
                },
            });
            try {
                assert.equal(cell.binding.setValue('Edited').accepted, true);
                await assert.rejects(cell.save());
                assert.equal(reads, 1);
                assert.equal(f.calls.length, 1);
                const [attempt] = f.journal.unknown('A');
                assert.ok(attempt);
                assert.equal(attempt.outcome, 'unknown');
                assert.equal(attempt.flight, false);
                assert.equal(attempt.acknowledgment, 'none');
                if (kind === 'cancel') {
                    assert.equal(cell.binding.getSnapshot().value, 'Edited');
                    assert.equal(cell.binding.getSnapshot().dirty, true);
                } else assert.equal(cell.binding.getSnapshot().retired, true);
                await assert.rejects(cell.save());
                assert.equal(f.calls.length, 1);
            } finally {
                cell.destroy();
            }
        });
    }

    for (const kind of ['throwing-accessor', 'uncloneable-payload'] as const) {
        it(`keeps a ${kind} unknown and preserves the native draft`, async () => {
            const raw = cellResult({ fld_title: 'Backend' });
            let reads = 0;
            if (kind === 'throwing-accessor')
                Object.defineProperty(raw.record, 'fields', {
                    enumerable: true,
                    get() {
                        reads++;
                        throw new Error('Synthetic response accessor failed');
                    },
                });
            else Object.assign(raw, { extra: () => 'not cloneable' });
            const f = fixture(async () => raw);
            const cell = createPortalCellBinding(f.options);
            try {
                assert.equal(cell.binding.setValue('Edited').accepted, true);
                const before = cell.binding.getSnapshot();
                await assert.rejects(cell.save());
                assert.equal(reads, kind === 'throwing-accessor' ? 1 : 0);
                assert.equal(cell.binding.getSnapshot().value, 'Edited');
                assert.equal(
                    cell.binding.getSnapshot().revision,
                    before.revision
                );
                assert.equal(cell.binding.getSnapshot().dirty, true);
                assert.equal(cell.binding.getSnapshot().pending, false);
                const [attempt] = f.journal.unknown('A');
                assert.ok(attempt);
                assert.equal(attempt.flight, false);
                assert.equal(attempt.acknowledgment, 'none');
                await assert.rejects(cell.save());
                assert.equal(f.calls.length, 1);
            } finally {
                cell.destroy();
            }
        });
    }
});

it('an injected cell draft belongs to its caller across binding teardown', () => {
    const f = fixture();
    const store = new FormDraftStore<AirtableValue>();
    const handle = store.open(
        { extensionId: 'portal', recordId: 'rec_one', parent: null },
        { fld_title: 'External' },
        []
    );
    const cell = createPortalCellBinding({
        ...f.options,
        draft: {
            read: () => store.read(handle, 'fld_title'),
            write: (value) => store.write(handle, 'fld_title', value),
            revision: () => store.revision(handle),
            dirty: () =>
                store.snapshot(handle)?.dirtyFieldIds.includes('fld_title') ??
                false,
            markSaved: (revision) => store.markSaved(handle, revision),
        },
    });
    assert.equal(cell.binding.getSnapshot().value, 'External');
    cell.binding.setValue('Owned by caller');
    cell.destroy();
    assert.equal(store.read(handle, 'fld_title'), 'Owned by caller');
    const successor = createPortalCellBinding({
        ...f.options,
        draft: {
            read: () => store.read(handle, 'fld_title'),
            write: (value) => store.write(handle, 'fld_title', value),
            revision: () => store.revision(handle),
            dirty: () =>
                store.snapshot(handle)?.dirtyFieldIds.includes('fld_title') ??
                false,
            markSaved: (revision) => store.markSaved(handle, revision),
        },
    });
    assert.equal(successor.binding.getSnapshot().value, 'Owned by caller');
    store.clear();
    assert.equal(successor.binding.getSnapshot().retired, true);
    assert.equal(successor.binding.setValue('Retired').accepted, false);
    successor.destroy();
});

it('refuses a retired caller draft before binding or transport admission', () => {
    const f = fixture();
    const store = new FormDraftStore<AirtableValue>();
    const handle = store.open(
        { extensionId: 'portal', recordId: 'rec_one', parent: null },
        { fld_title: 'Initial' },
        []
    );
    store.discard(handle);
    assert.throws(() =>
        createPortalCellBinding({
            ...f.options,
            draft: {
                read: () => store.read(handle, 'fld_title'),
                write: (value) => store.write(handle, 'fld_title', value),
                revision: () => store.revision(handle),
                dirty: () =>
                    store
                        .snapshot(handle)
                        ?.dirtyFieldIds.includes('fld_title') ?? false,
                markSaved: (revision) => store.markSaved(handle, revision),
            },
        })
    );
    assert.equal(f.calls.length, 0);
});
