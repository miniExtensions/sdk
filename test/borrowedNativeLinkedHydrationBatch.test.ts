import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import test from 'node:test';
import {
    createBorrowedNativeLinkedHydrationBatch,
    type BorrowedNativeLinkedBatchPort,
    type BorrowedNativeLinkedBatchResult,
} from '../src/ui/borrowedNativeLinkedHydrationBatch.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void, reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const tick = () => Promise.resolve();
const fixture = (
    options: { sameTable?: boolean; unsubscribeError?: Error } = {}
) => {
    const row = {
        id: 'rec_native',
        fields: {
            label: 'Chosen label — 選択',
            file: new File(['native'], 'native.txt'),
            date: new Date('2026-10-22T00:00:00Z'),
        },
    };
    type Page = { tables: Record<string, typeof row> };
    const direct = ['rec_native', 'rec_missing', 'rec_native'];
    const nested = [direct, direct];
    const selections = {
        fld_direct: {
            nativeValue: direct,
            rows: [
                { nativePath: [0], recordId: row.id, data: row },
                { nativePath: [2], recordId: row.id, data: row },
            ],
            unresolved: [{ nativePath: [1], recordId: 'rec_missing' }],
        },
        fld_lookup: {
            nativeValue: nested,
            rows: [
                { nativePath: [0, 0], recordId: row.id, data: row },
                { nativePath: [1, 2], recordId: row.id, data: row },
            ],
            unresolved: [
                { nativePath: [0, 1], recordId: 'rec_missing' },
                { nativePath: [1, 1], recordId: 'rec_missing' },
            ],
        },
    };
    type Selection = (typeof selections)[keyof typeof selections];
    const native: Record<string, Selection> = selections;
    const fields = [
        { fieldId: 'fld_direct', linkedTableId: 'tbl_direct' },
        {
            fieldId: 'fld_lookup',
            linkedTableId: options.sameTable ? 'tbl_direct' : 'tbl_lookup',
        },
    ];
    const listeners = new Set<() => void>();
    const state = {
        version: 1,
        readable: true,
        masked: new Set<string>(),
        selectedCalls: [] as string[],
        fieldReadabilityCalls: 0,
        publicationAttempts: 0,
        pages: [] as Page[],
        onPublish: undefined as (() => void) | undefined,
    };
    const pending: {
        signal: AbortSignal;
        stamp: { version: number };
        resolve: (value: Page) => void;
        reject: (error: unknown) => void;
    }[] = [];
    const page: Page = { tables: { native: row } };
    const notify = () => {
        for (const listener of [...listeners]) listener();
    };
    const port: BorrowedNativeLinkedBatchPort<
        { version: number },
        Selection,
        typeof page
    > = {
        source: 'host-native',
        fields,
        capture: () => ({
            stamp: { version: state.version },
            readable: state.readable,
        }),
        isCurrent: (stamp) => state.readable && stamp.version === state.version,
        isFieldReadable: (_stamp, fieldId) => {
            state.fieldReadabilityCalls++;
            return !state.masked.has(fieldId);
        },
        selected: (_stamp, fieldId) => {
            state.selectedCalls.push(fieldId);
            const selection = native[fieldId];
            assert.ok(selection);
            return selection;
        },
        hydrateSelected: (stamp, signal) => {
            const request = deferred<typeof page>();
            pending.push({
                stamp,
                signal,
                resolve: request.resolve,
                reject: request.reject,
            });
            return request.promise;
        },
        publishIfCurrent: (stamp, result) => {
            state.publicationAttempts++;
            if (stamp.version !== state.version) return false;
            state.pages.push(result);
            state.onPublish?.();
            return true;
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
                if (options.unsubscribeError) throw options.unsubscribeError;
            };
        },
    };
    const source = createBorrowedNativeLinkedHydrationBatch(port);
    const open = () => {
        const lease = source.capture();
        assert.ok(lease);
        return lease;
    };
    return {
        row,
        direct,
        nested,
        selections,
        fields,
        port,
        source,
        state,
        pending,
        page,
        listeners,
        notify,
        open,
    };
};

test('batch borrows direct and nested lookup selections with exact arrays, native objects and unresolved paths', () => {
    const f = fixture();
    Object.defineProperty(f.selections.fld_lookup, 'opaque', {
        get() {
            assert.fail('Opaque selection property must not be traversed');
        },
    });
    const selected = f.open().selected();
    assert.ok(selected);
    assert.equal(selected.length, 2);
    assert.equal(selected[0].status, 'available');
    assert.equal(selected[1].status, 'available');
    if (
        selected[0].status !== 'available' ||
        selected[1].status !== 'available'
    )
        assert.fail('Expected native selections');
    assert.equal(selected[0].selection, f.selections.fld_direct);
    assert.equal(selected[1].selection, f.selections.fld_lookup);
    assert.equal(selected[0].selection.nativeValue, f.direct);
    assert.equal(selected[1].selection.nativeValue, f.nested);
    assert.equal(f.nested[0], f.nested[1]);
    assert.equal(selected[1].selection.rows[0].data, f.row);
    assert.equal(
        selected[1].selection.rows[0].data.fields.file,
        f.row.fields.file
    );
    assert.equal(
        selected[1].selection.rows[0].data.fields.date,
        f.row.fields.date
    );
    assert.equal(
        selected[1].selection.unresolved,
        f.selections.fld_lookup.unresolved
    );
    assert.deepEqual(f.state.selectedCalls, ['fld_direct', 'fld_lookup']);
    assert.equal(f.pending.length, 0);
    f.source.destroy();
});

test('different fields sharing a target table retain both native owners but allocate one batch request', async () => {
    const f = fixture({ sameTable: true });
    const lease = f.open();
    assert.equal(lease.selected()?.length, 2);
    const result = lease.hydrateSelected();
    await tick();
    assert.equal(f.pending.length, 1);
    assert.equal(f.pending[0].stamp.version, 1);
    f.pending[0].resolve(f.page);
    assert.deepEqual(await result, { status: 'published', page: f.page });
    assert.equal(f.state.pages[0], f.page);
    assert.equal(f.state.publicationAttempts, 1);
    assert.equal(
        f.source.fields[0].linkedTableId,
        f.source.fields[1].linkedTableId
    );
    assert.equal('client' in f.source, false);
    assert.equal('setValue' in lease, false);
    f.source.destroy();
});

test('hidden batch suppresses field readers and transport before capture', () => {
    const f = fixture();
    f.state.readable = false;
    assert.equal(f.source.capture(), null);
    assert.equal(f.state.fieldReadabilityCalls, 0);
    assert.equal(f.state.selectedCalls.length, 0);
    assert.equal(f.pending.length, 0);
    f.source.destroy();
});

test('unavailable field suppresses its raw reader while preserving the visible sibling', () => {
    const f = fixture();
    f.state.masked.add('fld_lookup');
    const original = f.port.selected;
    f.port.selected = (stamp, id) => {
        assert.notEqual(id, 'fld_lookup');
        return original(stamp, id);
    };
    const selected = f.open().selected();
    assert.ok(selected);
    assert.equal(selected[0].status, 'available');
    assert.deepEqual(selected[1], {
        field: f.source.fields[1],
        status: 'unavailable',
    });
    assert.deepEqual(f.state.selectedCalls, ['fld_direct']);
    f.source.destroy();
});

for (const mode of ['silent', 'notified', 'ABA'] as const)
    test(`batch retires ${mode} native ownership before publication and admits a fresh successor`, async () => {
        const f = fixture();
        const lease = f.open();
        const old = lease.hydrateSelected();
        await tick();
        assert.equal(f.pending.length, 1);
        f.state.version += mode === 'ABA' ? 2 : 1;
        if (mode !== 'silent') f.notify();
        f.pending[0].resolve(f.page);
        assert.deepEqual(await old, { status: 'retired' });
        assert.equal(f.state.publicationAttempts, 0);
        assert.equal(lease.selected(), null);
        const fresh = f.open().hydrateSelected();
        await tick();
        assert.equal(f.pending.length, 2);
        const current = { tables: { current: f.row } };
        f.pending[1].resolve(current);
        const result = await fresh;
        assert.equal(result.status, 'published');
        if (result.status === 'published') assert.equal(result.page, current);
        assert.equal(f.state.pages[0], current);
        f.source.destroy();
    });

for (const mode of ['retire', 'destroy', 'ownership', 'abort'] as const)
    test(`initiating-turn ${mode} prevents batch transport allocation`, async () => {
        const f = fixture();
        const lease = f.open();
        const abort = new AbortController();
        const result = lease.hydrateSelected(abort.signal);
        if (mode === 'retire') lease.retire();
        else if (mode === 'destroy') f.source.destroy();
        else if (mode === 'ownership') f.state.version++;
        else abort.abort();
        assert.deepEqual(await result, { status: 'retired' });
        assert.equal(f.pending.length, 0);
        assert.equal(f.state.publicationAttempts, 0);
        f.source.destroy();
    });

test('already-aborted signals never allocate or permanently retire the current owner', async () => {
    const f = fixture();
    const lease = f.open();
    const abort = new AbortController();
    abort.abort();
    assert.deepEqual(await lease.hydrateSelected(abort.signal), {
        status: 'retired',
    });
    assert.equal(lease.isCurrent(), true);
    assert.equal(f.pending.length, 0);
    f.source.destroy();
});

test('latest batch read wins while allocated stale completion and error remain retired', async () => {
    const f = fixture();
    const lease = f.open();
    const first = lease.hydrateSelected();
    await tick();
    const second = lease.hydrateSelected();
    await tick();
    assert.equal(f.pending.length, 2);
    assert.equal(f.pending[0].signal.aborted, true);
    f.pending[1].resolve(f.page);
    assert.deepEqual(await second, { status: 'published', page: f.page });
    f.pending[0].reject({ kind: 'original-stale-error' });
    assert.deepEqual(await first, { status: 'retired' });
    assert.equal(f.state.publicationAttempts, 1);
    f.source.destroy();
});

test('reentrant abort notification cannot displace the newest batch read', async () => {
    const f = fixture();
    const lease = f.open();
    const first = lease.hydrateSelected();
    await tick();
    let newest:
        | Promise<BorrowedNativeLinkedBatchResult<typeof f.page>>
        | undefined;
    f.pending[0].signal.addEventListener(
        'abort',
        () => {
            newest = lease.hydrateSelected();
        },
        { once: true }
    );
    const displaced = lease.hydrateSelected();
    await tick();
    assert.equal(f.pending.length, 2);
    assert.ok(newest);
    assert.deepEqual(await displaced, { status: 'retired' });
    f.pending[0].resolve(f.page);
    assert.deepEqual(await first, { status: 'retired' });
    f.pending[1].resolve(f.page);
    assert.deepEqual(await newest, { status: 'published', page: f.page });
    assert.equal(f.state.publicationAttempts, 1);
    f.source.destroy();
});

test('current original transport errors propagate by identity with no cache publication', async () => {
    const f = fixture();
    const result = f.open().hydrateSelected();
    await tick();
    const error = { kind: 'native-original-error' };
    f.pending[0].reject(error);
    await assert.rejects(result, (cause) => cause === error);
    assert.equal(f.state.publicationAttempts, 0);
    f.source.destroy();
});

test('stale transport errors do not replace the current batch state', async () => {
    const f = fixture();
    const result = f.open().hydrateSelected();
    await tick();
    f.state.version++;
    f.notify();
    f.pending[0].reject(new Error('Late native failure'));
    assert.deepEqual(await result, { status: 'retired' });
    assert.equal(f.state.publicationAttempts, 0);
    f.source.destroy();
});

test('final synchronous host refusal prevents publication even after SDK admission', async () => {
    const f = fixture();
    f.port.publishIfCurrent = () => {
        f.state.publicationAttempts++;
        return false;
    };
    const result = f.open().hydrateSelected();
    await tick();
    f.pending[0].resolve(f.page);
    assert.deepEqual(await result, { status: 'retired' });
    assert.equal(f.state.publicationAttempts, 1);
    assert.equal(f.state.pages.length, 0);
    f.source.destroy();
});

test('an accepted own cache publication keeps its exact result after notifying a new generation', async () => {
    const f = fixture();
    const lease = f.open();
    f.state.onPublish = () => {
        f.state.version++;
        f.notify();
    };
    const result = lease.hydrateSelected();
    await tick();
    f.pending[0].resolve(f.page);
    const accepted = await result;
    assert.equal(accepted.status, 'published');
    if (accepted.status === 'published') assert.equal(accepted.page, f.page);
    assert.equal(lease.isCurrent(), false);
    assert.equal(f.state.pages[0], f.page);
    f.source.destroy();
});

test('current final-publication exceptions retain their original identity', async () => {
    const f = fixture();
    const error = new Error('Native cache merge failure');
    f.port.publishIfCurrent = () => {
        throw error;
    };
    const result = f.open().hydrateSelected();
    await tick();
    f.pending[0].resolve(f.page);
    await assert.rejects(result, (cause) => cause === error);
    f.source.destroy();
});

test('reentrant ownership destruction prevents transport and partial selected snapshots', async () => {
    const f = fixture();
    const lease = f.open();
    f.port.isCurrent = () => {
        f.source.destroy();
        return true;
    };
    assert.deepEqual(await lease.hydrateSelected(), { status: 'retired' });
    assert.equal(f.pending.length, 0);
    const g = fixture();
    const snapshot = g.open();
    g.port.isFieldReadable = (_stamp, id) => {
        if (id === 'fld_lookup') {
            g.state.version++;
            g.notify();
        }
        return true;
    };
    assert.equal(snapshot.selected(), null);
    assert.deepEqual(g.state.selectedCalls, ['fld_direct']);
    g.source.destroy();
});

test('field predicate failure never reads unavailable native data', () => {
    const f = fixture();
    f.port.isFieldReadable = () => {
        throw new Error('Cannot prove privacy');
    };
    const selected = f.open().selected();
    assert.ok(selected);
    assert.ok(selected.every((field) => field.status === 'unavailable'));
    assert.equal(f.state.selectedCalls.length, 0);
    f.source.destroy();
});

test('current selected reader errors retain identity', () => {
    const f = fixture();
    const error = new Error('Native selection failure');
    f.port.selected = () => {
        throw error;
    };
    assert.throws(
        () => f.open().selected(),
        (cause) => cause === error
    );
    f.source.destroy();
});

test('field metadata replacement retires the batch without altering immutable public descriptors', async () => {
    const f = fixture();
    const lease = f.open();
    const result = lease.hydrateSelected();
    await tick();
    assert.equal(Object.isFrozen(f.source.fields), true);
    assert.equal(Object.isFrozen(f.source.fields[0]), true);
    assert.equal(Reflect.set(f.source.fields[0], 'fieldId', 'forged'), false);
    f.fields[0].linkedTableId = 'tbl_replaced';
    f.notify();
    f.pending[0].resolve(f.page);
    assert.deepEqual(await result, { status: 'retired' });
    assert.equal(f.source.capture(), null);
    assert.equal(f.state.publicationAttempts, 0);
    f.source.destroy();
});

test('external cancellation retires only the pending read and a current successor still works', async () => {
    const f = fixture();
    const lease = f.open();
    const abort = new AbortController();
    const old = lease.hydrateSelected(abort.signal);
    await tick();
    abort.abort();
    assert.equal(f.pending[0].signal.aborted, true);
    f.pending[0].resolve(f.page);
    assert.deepEqual(await old, { status: 'retired' });
    assert.equal(lease.isCurrent(), true);
    const next = lease.hydrateSelected();
    await tick();
    f.pending[1].resolve(f.page);
    assert.deepEqual(await next, { status: 'published', page: f.page });
    f.source.destroy();
});

test('unsubscribe failure still retires every pending lease and destroy remains idempotent', async () => {
    const error = new Error('Native subscription cleanup failure');
    const f = fixture({ unsubscribeError: error });
    const a = f.open(),
        b = f.open();
    const first = a.hydrateSelected(),
        second = b.hydrateSelected();
    await tick();
    assert.throws(
        () => f.source.destroy(),
        (cause) => cause === error
    );
    assert.equal(f.listeners.size, 0);
    assert.ok(f.pending.every((read) => read.signal.aborted));
    for (const read of f.pending) read.resolve(f.page);
    assert.deepEqual(await first, { status: 'retired' });
    assert.deepEqual(await second, { status: 'retired' });
    assert.equal(f.source.capture(), null);
    f.source.destroy();
});

for (const property of [
    'isCurrent',
    'isFieldReadable',
    'publishIfCurrent',
] as const)
    test(`${property} requires explicit synchronous true`, async () => {
        const f = fixture();
        Reflect.set(f.port, property, () => Promise.resolve(true));
        if (property === 'isCurrent') assert.equal(f.source.capture(), null);
        else if (property === 'isFieldReadable') {
            assert.ok(
                f
                    .open()
                    .selected()
                    ?.every((field) => field.status === 'unavailable')
            );
            assert.equal(f.state.selectedCalls.length, 0);
        } else {
            const result = f.open().hydrateSelected();
            await tick();
            f.pending[0].resolve(f.page);
            assert.deepEqual(await result, { status: 'retired' });
        }
        assert.equal(f.state.pages.length, 0);
        f.source.destroy();
    });

for (const fields of [
    [],
    [{ fieldId: '', linkedTableId: 'tbl_a' }],
    [{ fieldId: 'fld_a', linkedTableId: ' ' }],
    [
        { fieldId: 'fld_a', linkedTableId: 'tbl_a' },
        { fieldId: 'fld_a', linkedTableId: 'tbl_b' },
    ],
    Array(1),
] as const)
    test(`malformed batch field metadata fails before native reads: ${JSON.stringify(fields)}`, () => {
        const f = fixture();
        Reflect.set(f.port, 'fields', fields);
        assert.throws(
            () => createBorrowedNativeLinkedHydrationBatch(f.port),
            TypeError
        );
        assert.equal(f.state.selectedCalls.length, 0);
        assert.equal(f.pending.length, 0);
        f.source.destroy();
    });

test('foreign source and false/null capture never receive native read authority', () => {
    const f = fixture();
    Reflect.set(f.port, 'source', 'client');
    assert.throws(
        () => createBorrowedNativeLinkedHydrationBatch(f.port),
        TypeError
    );
    Reflect.set(f.port, 'source', 'host-native');
    f.port.capture = () => null;
    assert.equal(f.source.capture(), null);
    assert.equal(f.state.selectedCalls.length, 0);
    f.source.destroy();
});

for (const value of [null, undefined])
    test(`opaque native selection ${String(value)} remains available without normalization`, () => {
        const f = fixture();
        const source = createBorrowedNativeLinkedHydrationBatch({
            ...f.port,
            selected: () => value,
        });
        const selected = source.capture()?.selected();
        assert.ok(selected);
        assert.equal(selected[0].status, 'available');
        if (selected[0].status === 'available')
            assert.equal(selected[0].selection, value);
        assert.equal(f.pending.length, 0);
        source.destroy();
        f.source.destroy();
    });

test('failed ownership proof retires the lease without native readers or transport', async () => {
    const f = fixture();
    const lease = f.open();
    f.port.isCurrent = () => {
        throw new Error('Cannot prove native generation');
    };
    assert.equal(lease.selected(), null);
    assert.deepEqual(await lease.hydrateSelected(), { status: 'retired' });
    assert.equal(f.pending.length, 0);
    assert.equal(f.state.selectedCalls.length, 0);
    f.source.destroy();
});

test('reentrant capture cleanup never creates a native lease', () => {
    const f = fixture();
    f.port.capture = () => {
        f.source.destroy();
        return { stamp: { version: 1 }, readable: true };
    };
    assert.equal(f.source.capture(), null);
    assert.equal(f.listeners.size, 0);
    assert.equal(f.pending.length, 0);
});

test('retirement inside a native selected reader rejects the entire mixed snapshot', () => {
    const f = fixture();
    const lease = f.open();
    const original = f.port.selected;
    f.port.selected = (stamp, id) => {
        const value = original(stamp, id);
        f.state.version++;
        f.notify();
        return value;
    };
    assert.equal(lease.selected(), null);
    assert.deepEqual(f.state.selectedCalls, ['fld_direct']);
    f.source.destroy();
});

for (const fields of [
    null,
    {},
    [{ fieldId: 42, linkedTableId: 'tbl_a' }],
    [{ fieldId: 'fld_a', linkedTableId: 42 }],
])
    test(`non-native batch metadata is refused: ${JSON.stringify(fields)}`, () => {
        const f = fixture();
        Reflect.set(f.port, 'fields', fields);
        assert.throws(
            () => createBorrowedNativeLinkedHydrationBatch(f.port),
            TypeError
        );
        assert.equal(f.pending.length, 0);
        f.source.destroy();
    });
