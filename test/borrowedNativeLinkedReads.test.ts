import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import test from 'node:test';
import {
    createBorrowedNativeLinkedReadSource,
    type BorrowedNativeLinkedReadPort,
    type BorrowedNativeLinkedPage,
    type BorrowedNativeLinkedSelection,
} from '../src/ui/index.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const turn = () => Promise.resolve();
type Row = { id: string; fields: { label: string; file: File; date: Date } };
type Filter = { source: 'manual' | 'barcode' | 'calendar'; native: object };
type Page = BorrowedNativeLinkedPage<Row, { offset: string | null }>;
function fixture() {
    let revision = 1;
    let readable = true;
    let captures = 0;
    let selectedReads = 0;
    let publicationAttempts = 0;
    const listeners = new Set<() => void>();
    const file = new File(['native'], 'native.txt');
    const row = {
        id: 'rec_a',
        fields: { label: 'Native chosen label — 選択', file, date: new Date() },
    };
    const page: Page = { records: [row], metadata: { offset: 'next' } };
    const value = Object.freeze(['rec_a', 'rec_unknown', 'rec_a']);
    const selected = {
        nativeValue: value,
        rows: [{ recordId: 'rec_a', data: row }],
        unresolved: [{ nativeIndex: 1, recordId: 'rec_unknown' }],
    };
    const queries: {
        filter: Filter;
        offset: string | null;
        signal: AbortSignal;
    }[] = [];
    const hydrations: AbortSignal[] = [];
    const publications: { kind: 'query' | 'selected'; page: Page }[] = [];
    const pending = deferred<Page>();
    const port: BorrowedNativeLinkedReadPort<
        Row,
        Filter,
        Row,
        number,
        Page['metadata']
    > = {
        source: 'host-native',
        fieldId: 'fld_linked',
        linkedTableId: 'tbl_linked',
        capture() {
            captures++;
            return { stamp: revision, readable };
        },
        isCurrent: (stamp) => stamp === revision && readable,
        selected() {
            selectedReads++;
            return selected;
        },
        async query(_stamp, request) {
            queries.push(request);
            return pending.promise;
        },
        async hydrateSelected(_stamp, signal) {
            hydrations.push(signal);
            return pending.promise;
        },
        publishIfCurrent(stamp, kind, result) {
            publicationAttempts++;
            if (!port.isCurrent(stamp)) return false;
            publications.push({ kind, page: result });
            return true;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const source = createBorrowedNativeLinkedReadSource(port);
    return {
        source,
        port,
        row,
        page,
        selected,
        pending,
        queries,
        hydrations,
        publications,
        reads: () => selectedReads,
        attempts: () => publicationAttempts,
        captures: () => captures,
        listeners: () => listeners.size,
        replace(notify = true) {
            revision++;
            if (notify) for (const listener of [...listeners]) listener();
        },
        hide() {
            readable = false;
        },
        notify() {
            for (const listener of [...listeners]) listener();
        },
    };
}
const request = (): { filter: Filter; offset: string | null } => ({
    filter: { source: 'barcode', native: { query: 'raw native criteria' } },
    offset: 'native-page',
});

test('borrowed selection retains exact values, duplicates, labels, unresolved indexes and native identities', () => {
    const f = fixture();
    const lease = f.source.capture()!;
    const selected = lease.selected()!;
    assert.equal(selected, f.selected);
    assert.equal(selected.nativeValue, f.selected.nativeValue);
    assert.deepEqual(selected.nativeValue, ['rec_a', 'rec_unknown', 'rec_a']);
    assert.equal(selected.rows[0].data, f.row);
    assert.equal(selected.rows[0].data.fields.file, f.row.fields.file);
    assert.equal(selected.rows[0].data.fields.date, f.row.fields.date);
    assert.equal(
        selected.rows[0].data.fields.label,
        'Native chosen label — 選択'
    );
    assert.equal(selected.unresolved, f.selected.unresolved);
    assert.equal(f.reads(), 1);
    f.source.destroy();
});

test('hidden/null captures skip selected getters and every transport/publication', () => {
    const f = fixture();
    f.port.selected = () => {
        throw new Error('must not read hidden data');
    };
    f.hide();
    assert.equal(f.source.capture(), null);
    f.port.capture = () => null;
    assert.equal(f.source.capture(), null);
    assert.equal(
        f.queries.length + f.hydrations.length + f.publications.length,
        0
    );
    f.source.destroy();
});

test('borrowed snapshots are never inspected or assimilated as promises', () => {
    const f = fixture();
    const snapshot = Object.defineProperties(f.selected, {
        nativeValue: {
            get() {
                throw new Error('opaque native values');
            },
        },
        then: {
            get() {
                throw new Error('not a promise');
            },
        },
    });
    assert.equal(f.source.capture()!.selected(), snapshot);
    f.source.destroy();
});

test('a reentrant selected read cannot expose a retired snapshot', () => {
    const f = fixture();
    f.port.selected = () => {
        f.replace(false);
        return f.selected;
    };
    assert.equal(f.source.capture()!.selected(), null);
    f.source.destroy();
});

for (const kind of ['query', 'selected'] as const) {
    test(`${kind} preserves opaque input/page identity and delegates exactly one host publication`, async () => {
        const f = fixture();
        const lease = f.source.capture()!;
        const input = request();
        const result =
            kind === 'query' ? lease.query(input) : lease.hydrateSelected();
        await turn();
        assert.equal(f.queries.length + f.hydrations.length, 1);
        if (kind === 'query') {
            assert.equal(f.queries[0].filter, input.filter);
            assert.equal(f.queries[0].offset, input.offset);
        }
        f.pending.resolve(f.page);
        const settled = await result;
        assert.equal(settled.status, 'published');
        if (settled.status === 'published') assert.equal(settled.page, f.page);
        assert.equal(f.publications.length, 1);
        assert.equal(f.publications[0].page, f.page);
        assert.equal(f.publications[0].kind, kind);
        f.source.destroy();
    });

    for (const replacement of ['silent', 'notification', 'ABA'] as const) {
        test(`${kind} rejects pending ${replacement} publication before cache allocation`, async () => {
            const f = fixture();
            const lease = f.source.capture()!;
            const result =
                kind === 'query'
                    ? lease.query(request())
                    : lease.hydrateSelected();
            await turn();
            const signal =
                kind === 'query' ? f.queries[0].signal : f.hydrations[0];
            f.replace(replacement !== 'silent');
            if (replacement === 'ABA') f.replace();
            if (replacement !== 'silent') assert.equal(signal.aborted, true);
            f.pending.resolve(f.page);
            assert.deepEqual(await result, { status: 'retired' });
            assert.equal(f.publications.length, 0);
            assert.equal(f.attempts(), 0);
            assert.equal(lease.selected(), null);
            assert.equal(f.reads(), 0);
            f.source.destroy();
        });
    }

    test(`${kind} retires in the initiating turn without allocating transport`, async () => {
        const f = fixture();
        const lease = f.source.capture()!;
        const result =
            kind === 'query' ? lease.query(request()) : lease.hydrateSelected();
        lease.retire();
        assert.deepEqual(await result, { status: 'retired' });
        assert.equal(f.queries.length + f.hydrations.length, 0);
        f.source.destroy();
    });
}

test('latest query wins without cancelling selected hydration, and unchanged notifications preserve both', async () => {
    const f = fixture();
    const second = deferred<Page>();
    const originalQuery = f.port.query;
    let calls = 0;
    f.port.query = async (stamp, input) =>
        ++calls === 1 ? originalQuery(stamp, input) : second.promise;
    const lease = f.source.capture()!;
    const first = lease.query(request());
    const hydration = lease.hydrateSelected();
    await turn();
    const next = lease.query(request());
    await turn();
    f.notify();
    assert.equal(f.queries[0].signal.aborted, true);
    assert.equal(f.hydrations[0].aborted, false);
    second.resolve(f.page);
    f.pending.resolve(f.page);
    assert.deepEqual(await first, { status: 'retired' });
    assert.equal((await next).status, 'published');
    assert.equal((await hydration).status, 'published');
    assert.deepEqual(
        f.publications.map((p) => p.kind),
        ['selected', 'query']
    );
    f.source.destroy();
});

test('same-kind abort notification cannot displace a reentrant newer query', async () => {
    const f = fixture();
    const lease = f.source.capture()!;
    const first = lease.query(request());
    await turn();
    let newest: ReturnType<typeof lease.query> | undefined;
    f.queries[0].signal.addEventListener('abort', () => {
        newest = lease.query(request());
    });
    const displaced = lease.query(request());
    await turn();
    f.pending.resolve(f.page);
    assert.deepEqual(await first, { status: 'retired' });
    assert.deepEqual(await displaced, { status: 'retired' });
    assert.equal((await newest!).status, 'published');
    assert.equal(f.queries.length, 2);
    assert.equal(f.publications.length, 1);
    f.source.destroy();
});

test('current original transport errors propagate; retired original errors cannot publish', async () => {
    for (const retire of [false, true]) {
        const f = fixture();
        const error = { kind: 'native-provider-failure' };
        const result = f.source.capture()!.hydrateSelected();
        await turn();
        if (retire) f.replace(false);
        f.pending.reject(error);
        if (retire) assert.deepEqual(await result, { status: 'retired' });
        else await assert.rejects(result, (cause) => cause === error);
        assert.equal(f.publications.length, 0);
        assert.equal(f.attempts(), 0);
        f.source.destroy();
    }
});

test('host final fence can refuse or accept while publishing a new native revision', async () => {
    for (const accepted of [false, true]) {
        const f = fixture();
        f.port.publishIfCurrent = (_stamp, _kind, page) => {
            assert.equal(page, f.page);
            f.replace();
            return accepted;
        };
        const result = f.source.capture()!.hydrateSelected();
        await turn();
        f.pending.resolve(f.page);
        assert.equal((await result).status, accepted ? 'published' : 'retired');
        f.source.destroy();
    }
});

test('external abort gates initial allocation and suppresses pending read publication', async () => {
    for (const before of [true, false]) {
        const f = fixture();
        const signal = new AbortController();
        if (before) signal.abort();
        const result = f.source.capture()!.hydrateSelected(signal.signal);
        await turn();
        signal.abort();
        f.pending.resolve(f.page);
        assert.deepEqual(await result, { status: 'retired' });
        assert.equal(f.hydrations.length, before ? 0 : 1);
        if (!before) assert.equal(f.hydrations[0].aborted, true);
        assert.equal(f.publications.length, 0);
        assert.equal(f.attempts(), 0);
        f.source.destroy();
    }
});

test('privacy changes and failed freshness predicates retire before selected reads', () => {
    for (const throws of [false, true]) {
        const f = fixture();
        const lease = f.source.capture()!;
        if (throws)
            f.port.isCurrent = () => {
                throw new Error('no authority');
            };
        else f.hide();
        assert.equal(lease.selected(), null);
        assert.equal(f.reads(), 0);
        assert.equal(lease.isCurrent(), false);
        f.source.destroy();
    }
});

test('destroy unsubscribes and retires all leases before reentrant cleanup can capture', async () => {
    const f = fixture();
    const a = f.source.capture()!,
        b = f.source.capture()!;
    const pending = a.hydrateSelected();
    await turn();
    f.hydrations[0].addEventListener('abort', () =>
        assert.equal(f.source.capture(), null)
    );
    assert.equal(f.listeners(), 1);
    f.source.destroy();
    f.source.destroy();
    assert.equal(f.listeners(), 0);
    assert.equal(a.isCurrent(), false);
    assert.equal(b.selected(), null);
    assert.equal(f.source.capture(), null);
    f.pending.resolve(f.page);
    assert.deepEqual(await pending, { status: 'retired' });
    assert.equal(f.publications.length, 0);
    assert.equal(f.attempts(), 0);
});

test('invalid source identifiers are rejected before subscribing', () => {
    const f = fixture();
    for (const change of [
        { fieldId: '' },
        { linkedTableId: ' ' },
        { source: 'accepted-sdk' },
    ]) {
        assert.throws(
            () =>
                createBorrowedNativeLinkedReadSource({
                    ...f.port,
                    ...change,
                } as typeof f.port),
            TypeError
        );
    }
    assert.equal(f.listeners(), 1);
    f.source.destroy();
});

test('read admission and publication require explicit synchronous true', async () => {
    const f = fixture();
    f.port.isCurrent = () => 'truthy' as unknown as boolean;
    assert.equal(f.source.capture(), null);
    f.port.isCurrent = () => true;
    f.port.publishIfCurrent = () => Promise.resolve(true) as unknown as boolean;
    const read = f.source.capture()!.hydrateSelected();
    await turn();
    f.pending.resolve(f.page);
    assert.deepEqual(await read, { status: 'retired' });
    assert.equal(f.publications.length, 0);
    assert.equal(f.attempts(), 0);
    f.source.destroy();
});

test('publication exceptions preserve identity and release the read for a current retry', async () => {
    const f = fixture();
    const error = { kind: 'native-cache-error' };
    const publish = f.port.publishIfCurrent;
    f.port.publishIfCurrent = () => {
        throw error;
    };
    const lease = f.source.capture()!;
    const failed = lease.hydrateSelected();
    await turn();
    f.pending.resolve(f.page);
    await assert.rejects(failed, (cause) => cause === error);
    f.port.publishIfCurrent = publish;
    const retry = await lease.hydrateSelected();
    assert.equal(retry.status, 'published');
    assert.equal(f.publications.length, 1);
    f.source.destroy();
});

test('destroy retires pending leases even when host unsubscribe throws', async () => {
    const f = fixture();
    const subscribe = f.port.subscribe;
    const error = new Error('host unsubscribe failed');
    f.port.subscribe = function (listener) {
        const unsubscribe = subscribe.call(this, listener);
        return () => {
            unsubscribe();
            throw error;
        };
    };
    const extra = createBorrowedNativeLinkedReadSource(f.port);
    const lease = extra.capture()!;
    const pending = lease.hydrateSelected();
    await turn();
    assert.throws(
        () => extra.destroy(),
        (cause) => cause === error
    );
    assert.equal(f.hydrations[0].aborted, true);
    assert.equal(lease.selected(), null);
    assert.equal(extra.capture(), null);
    f.pending.resolve(f.page);
    assert.deepEqual(await pending, { status: 'retired' });
    f.source.destroy();
});

test('a reentrant freshness predicate cannot displace its newer query', async () => {
    const f = fixture();
    const lease = f.source.capture()!;
    const isCurrent = f.port.isCurrent;
    let newer: ReturnType<typeof lease.query> | undefined;
    f.port.isCurrent = (stamp) => {
        if (!newer) {
            // Enter only once; the newer query is admitted in a later microtask.
            f.port.isCurrent = isCurrent;
            newer = lease.query(request());
        }
        return isCurrent(stamp);
    };
    const older = lease.query(request());
    await turn();
    await turn();
    assert.equal(f.queries.length, 1);
    f.pending.resolve(f.page);
    assert.deepEqual(await older, { status: 'retired' });
    assert.equal((await newer!).status, 'published');
    assert.equal(f.publications.length, 1);
    f.source.destroy();
});

test('empty native null and undefined values remain distinct from an empty array', () => {
    const f = fixture();
    for (const nativeValue of [null, undefined, Object.freeze([])]) {
        const selected: BorrowedNativeLinkedSelection<Row> = {
            nativeValue,
            rows: [],
            unresolved: [],
        };
        f.port.selected = () => selected;
        const lease = f.source.capture()!;
        assert.equal(lease.selected(), selected);
        assert.equal(lease.selected()?.nativeValue, nativeValue);
        lease.retire();
    }
    f.source.destroy();
});
