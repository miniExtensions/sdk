import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createNativeLinkedFinderCascadeDriver,
    type NativeLinkedFinderCascadeHost,
    type NativeLinkedFinderCascadePage,
    type NativeLinkedFinderCascadeQuery,
    type NativeLinkedFinderCascadeUrlValue,
    type NativeLinkedFinderCascadeValue,
} from '../src/ui/index.js';

const pair = (recordId: string, stringValue = recordId) => ({
    recordId,
    stringValue,
});
const page = (
    primaryValues: readonly NativeLinkedFinderCascadeValue[] = [],
    prefillValue: NativeLinkedFinderCascadeValue | null = null
): NativeLinkedFinderCascadePage => ({ primaryValues, prefillValue });
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function fixture(
    urlSearchValue: NativeLinkedFinderCascadeUrlValue = undefined,
    testing = true
) {
    const owner = {};
    let currentOwner = owner;
    let admitted = true;
    let publishHook = () => {};
    const requests: NativeLinkedFinderCascadeQuery[] = [];
    const pending: ReturnType<
        typeof deferred<NativeLinkedFinderCascadePage>
    >[] = [];
    const loading: boolean[] = [];
    const publications: (NativeLinkedFinderCascadeValue | null)[] = [];
    const clears: string[] = [];
    const errors: unknown[] = [];
    const values: Record<string, NativeLinkedFinderCascadeValue | null> = {
        driver: pair('initial'),
        sibling: pair('sibling'),
    };
    const host: NativeLinkedFinderCascadeHost<object> = {
        isCurrent: (expected) => expected === currentOwner,
        captureRead(expected, query) {
            requests.push(query);
            return {
                isCurrent: () => expected === currentOwner,
                query() {
                    const next = deferred<NativeLinkedFinderCascadePage>();
                    pending.push(next);
                    return next.promise;
                },
            };
        },
        publish(expected, id, value) {
            if (!admitted || expected !== currentOwner)
                return { status: 'refused' };
            values[id] = value;
            publications.push(value);
            publishHook();
            return { status: 'admitted' };
        },
        clear(expected, id) {
            if (!admitted || expected !== currentOwner)
                return { status: 'refused' };
            values[id] = null;
            clears.push(id);
            return { status: 'admitted' };
        },
        setPrefillLoading: (_expected, _field, value) => loading.push(value),
        reportOrdinaryError: (error) => errors.push(error),
        errorMessage: () => 'Native ordinary failure',
    };
    const driver = createNativeLinkedFinderCascadeDriver({
        owner,
        fieldId: 'driver',
        previousFieldId: 'previous',
        previousValue: pair('previous-A', 'Same'),
        urlSearchValue,
        host,
        testing,
    });
    return {
        driver,
        host,
        owner,
        requests,
        pending,
        loading,
        publications,
        clears,
        errors,
        values,
        replace() {
            currentOwner = {};
        },
        restore() {
            currentOwner = owner;
        },
        refuse() {
            admitted = false;
        },
        onPublish(callback: () => void) {
            publishHook = callback;
        },
    };
}

for (const order of ['prefill-first', 'ordinary-first']) {
    test(`native cascade keeps independent producers and separate pending identity: ${order}`, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const f = fixture('Raw North');
        const prefill = f.driver.prefillNow();
        f.driver.predecessorChanged();
        assert.equal(f.pending.length, 1);
        assert.deepEqual(f.loading, [true]);
        assert.equal(f.driver.getSnapshot().status, 'fetching-prefill');
        t.mock.timers.tick(10);
        assert.equal(f.pending.length, 2);
        assert.equal(f.driver.getSnapshot().status, 'loading');
        assert.deepEqual(
            f.driver.getSnapshot().pending.map((read) => read.kind),
            ['prefill', 'ordinary']
        );
        const chosen = pair('prefilled-ID', 'North');
        const options = [pair('option-ID', 'North')];
        if (order === 'ordinary-first') {
            f.pending[1].resolve(page(options, pair('ignored')));
            await Promise.resolve();
            await Promise.resolve();
            assert.equal(f.driver.getSnapshot().status, 'idle');
            assert.equal(f.driver.getSnapshot().pending.length, 1);
            assert.deepEqual(f.loading, [true]);
            assert.equal(f.values.driver?.recordId, 'initial');
        }
        f.pending[0].resolve(page([pair('prefill-options-ignored')], chosen));
        assert.deepEqual(await prefill, { status: 'published' });
        assert.equal(f.values.driver, chosen);
        assert.deepEqual(f.loading, [true, false]);
        if (order === 'prefill-first')
            f.pending[1].resolve(page(options, pair('ignored')));
        await Promise.resolve();
        await Promise.resolve();
        assert.equal(f.driver.getSnapshot().options, options);
        assert.equal(f.values.driver, chosen);
        assert.equal(f.values.sibling?.recordId, 'sibling');
        f.driver.destroy();
    });
}

for (const raw of [undefined, null, '', ['North', 'South'], 'North']) {
    test(`native cascade forwards raw URL ${JSON.stringify(raw)} without normalization`, async () => {
        const f = fixture(raw);
        const expectedStatus = raw ? 'fetching-prefill' : 'idle';
        assert.equal(f.driver.getSnapshot().status, expectedStatus);
        const prefill = f.driver.prefillNow();
        if (raw == null) {
            assert.deepEqual(await prefill, { status: 'refused' });
            assert.equal(f.pending.length, 0);
        } else {
            assert.equal(f.requests[0].searchTerm, raw);
            assert.equal(f.requests[0].urlSearchValue, raw);
            f.pending[0].resolve(page());
            await prefill;
        }
        const ordinary = f.driver.ordinaryNow('typed');
        assert.equal(f.requests.at(-1)?.searchTerm, 'typed');
        assert.equal(f.requests.at(-1)?.urlSearchValue, raw);
        f.pending.at(-1)!.resolve(page());
        await ordinary;
        f.driver.destroy();
    });
}

test('ordinary completion order is retained independently of allocation order', async () => {
    const f = fixture();
    const slow = f.driver.ordinaryNow('old');
    const fast = f.driver.ordinaryNow('new');
    const newer = [pair('new')];
    f.pending[1].resolve(page(newer));
    await fast;
    assert.equal(f.driver.getSnapshot().options, newer);
    assert.equal(f.driver.getSnapshot().status, 'idle');
    assert.equal(f.driver.getSnapshot().pending.length, 1);
    const older = [pair('old')];
    f.pending[0].resolve(page(older));
    await slow;
    assert.equal(f.driver.getSnapshot().options, older);
    f.driver.destroy();
});

test('ordinary failure stays visible after a successful options read', async () => {
    const f = fixture();
    const cause = new Error('native transport');
    const failed = f.driver.ordinaryNow('bad');
    f.pending[0].reject(cause);
    assert.deepEqual(await failed, { status: 'failure', error: cause });
    assert.deepEqual(f.errors, [cause]);
    assert.equal(f.driver.getSnapshot().error, 'Native ordinary failure');
    const successful = f.driver.ordinaryNow('good');
    assert.equal(f.driver.getSnapshot().error, 'Native ordinary failure');
    const options = [pair('good')];
    f.pending[1].resolve(page(options));
    await successful;
    assert.equal(f.driver.getSnapshot().options, options);
    assert.equal(f.driver.getSnapshot().error, 'Native ordinary failure');
    assert.equal(f.driver.getSnapshot().status, 'idle');
    f.driver.destroy();
});

test('prefill rejection does not clear host loading or invent ordinary error/reset policy', async () => {
    const f = fixture('raw');
    const cause = new Error('prefill failed');
    const prefill = f.driver.prefillNow();
    const rejected = assert.rejects(prefill, (error) => error === cause);
    const ordinary = f.driver.ordinaryNow('');
    f.pending[0].reject(cause);
    await rejected;
    assert.deepEqual(f.loading, [true]);
    assert.deepEqual(f.errors, []);
    assert.equal(f.driver.getSnapshot().pending.length, 1);
    f.pending[1].resolve(page([pair('ordinary')]));
    await ordinary;
    assert.equal(f.driver.getSnapshot().status, 'idle');
    assert.equal(f.driver.getSnapshot().error, undefined);
    assert.deepEqual(f.loading, [true]);
    f.driver.destroy();
});

test('predecessor reset depends on string only, retains IDs/equal labels and clears only its own driver', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    f.driver.predecessorChanged();
    assert.deepEqual(f.clears, ['driver']);
    t.mock.timers.tick(10);
    f.pending[0].resolve(page());
    await Promise.resolve();
    f.values.driver = pair('current');
    f.driver.setPredecessor('previous', pair('previous-B', 'Same'));
    f.driver.predecessorChanged();
    t.mock.timers.tick(10);
    assert.equal(f.pending.length, 1);
    assert.equal(f.values.driver?.recordId, 'current');
    f.driver.setPredecessor('previous', pair('previous-B', ''));
    f.driver.predecessorChanged();
    assert.equal(f.values.driver, null);
    assert.equal(f.values.sibling?.recordId, 'sibling');
    t.mock.timers.tick(10);
    assert.deepEqual(f.requests[1].filterData, {
        previousFilterFieldId: 'previous',
        previousFilterPrimaryValue: '',
    });
    f.pending[1].resolve(page());
    await Promise.resolve();
    f.driver.destroy();
});

for (const testing of [false, true]) {
    test(`ordinary typing debounces ${testing ? 10 : 800}ms with immediate loading and queued-only cleanup`, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const f = fixture(undefined, testing);
        f.driver.search('old');
        assert.equal(f.driver.getSnapshot().status, 'loading');
        f.driver.search('latest');
        t.mock.timers.tick(testing ? 9 : 799);
        assert.equal(f.pending.length, 0);
        t.mock.timers.tick(1);
        assert.equal(f.pending.length, 1);
        assert.equal(f.requests[0].searchTerm, 'latest');
        f.driver.search('queued');
        f.driver.destroy();
        t.mock.timers.tick(1000);
        f.pending[0].resolve(page([pair('late')]));
        await Promise.resolve();
        assert.equal(f.pending.length, 1);
        assert.deepEqual(f.driver.getSnapshot().options, []);
        assert.equal(f.driver.getSnapshot().status, 'retired');
    });
}

test('owner replacement before/after prefill publication fences canonical writes and cannot revive through ABA', async () => {
    const before = fixture('raw');
    const pending = before.driver.prefillNow();
    before.replace();
    before.driver.getSnapshot();
    before.restore();
    before.pending[0].resolve(page([], pair('old')));
    assert.deepEqual(await pending, { status: 'retired' });
    assert.deepEqual(before.publications, []);
    assert.equal(before.values.driver?.recordId, 'initial');
    assert.deepEqual(before.driver.choose(pair('new')), { status: 'refused' });

    const after = fixture('raw');
    after.onPublish(() => after.replace());
    const prefill = after.driver.prefillNow();
    after.pending[0].resolve(page([], pair('published-before-replacement')));
    assert.deepEqual(await prefill, { status: 'retired' });
    assert.deepEqual(after.loading, [true]);
    assert.equal(after.publications.length, 1);
    after.driver.destroy();
});

test('host refusal never becomes canonical driver state or a successful prefill receipt', async () => {
    const f = fixture('raw');
    f.refuse();
    assert.deepEqual(f.driver.choose(pair('same-label-A', 'Same')), {
        status: 'refused',
    });
    const prefill = f.driver.prefillNow();
    f.pending[0].resolve(page([], pair('same-label-B', 'Same')));
    assert.deepEqual(await prefill, { status: 'refused' });
    assert.equal(f.values.driver?.recordId, 'initial');
    assert.deepEqual(f.publications, []);
    f.driver.destroy();
});

test('reentrant scheduled input keeps exactly the newer queued search', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    let reentered = false;
    f.driver.subscribe(() => {
        if (!reentered && f.driver.getSnapshot().status === 'loading') {
            reentered = true;
            f.driver.search('newer');
        }
    });
    f.driver.search('older');
    t.mock.timers.tick(10);
    assert.deepEqual(
        f.requests.map((query) => query.searchTerm),
        ['newer']
    );
    f.pending[0].resolve(page());
    await Promise.resolve();
    f.driver.destroy();
});

test('queued search captures predecessor arguments while a direct read uses current arguments', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    f.driver.predecessorChanged();
    f.driver.search('queued');
    f.driver.setPredecessor(
        'replacement-field',
        pair('replacement-ID', 'Same')
    );
    f.driver.predecessorChanged();
    t.mock.timers.tick(10);
    assert.deepEqual(f.requests[0].filterData, {
        previousFilterFieldId: 'previous',
        previousFilterPrimaryValue: 'Same',
    });
    const direct = f.driver.ordinaryNow('direct');
    assert.deepEqual(f.requests[1].filterData, {
        previousFilterFieldId: 'replacement-field',
        previousFilterPrimaryValue: 'Same',
    });
    f.pending[0].resolve(page());
    f.pending[1].resolve(page());
    await direct;
    f.driver.destroy();
});

test('nullable explicit choice uses the update producer rather than reset clear', () => {
    const f = fixture();
    assert.deepEqual(f.driver.choose(null), { status: 'admitted' });
    assert.deepEqual(f.publications, [null]);
    assert.deepEqual(f.clears, []);
    f.driver.destroy();
});

test('prefill allocation and completion both notify separate pending state', async () => {
    const f = fixture('raw');
    const pendingCounts: number[] = [];
    f.driver.subscribe(() =>
        pendingCounts.push(f.driver.getSnapshot().pending.length)
    );
    const prefill = f.driver.prefillNow();
    assert.deepEqual(pendingCounts, [1]);
    f.pending[0].resolve(page([], pair('chosen')));
    await prefill;
    assert.deepEqual(pendingCounts, [1, 0]);
    f.driver.destroy();
});

test('expired or unreadable read authority retires data while native ordinary visual settlement idles', async () => {
    for (const throws of [false, true]) {
        const f = fixture();
        let valid = true;
        const capture = f.host.captureRead;
        f.host.captureRead = (owner, query) => {
            const read = capture(owner, query)!;
            return {
                ...read,
                isCurrent() {
                    if (!valid && throws)
                        throw new Error('read fence unavailable');
                    return valid;
                },
            };
        };
        const pending = f.driver.ordinaryNow('current');
        valid = false;
        f.pending[0].resolve(page([pair('unqualified')]));
        assert.deepEqual(await pending, { status: 'retired' });
        assert.equal(f.driver.getSnapshot().status, 'idle');
        assert.deepEqual(f.driver.getSnapshot().pending, []);
        assert.deepEqual(f.driver.getSnapshot().options, []);
        f.driver.destroy();
    }
});

test('ordinary final notification can retire its result before returning a receipt', async () => {
    const f = fixture();
    f.driver.subscribe(() => {
        if (f.driver.getSnapshot().status === 'idle') f.driver.destroy();
    });
    const pending = f.driver.ordinaryNow('read');
    f.pending[0].resolve(page([pair('replaced')]));
    assert.deepEqual(await pending, { status: 'retired' });
    assert.deepEqual(f.driver.getSnapshot().options, []);
});

test('first driver ignores a supplied previous value when there is no previous field', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    f.driver.setPredecessor(null, pair('irrelevant', 'A'));
    f.driver.predecessorChanged();
    t.mock.timers.tick(10);
    assert.equal(f.requests[0].filterData, null);
    f.driver.setPredecessor(null, pair('irrelevant', 'B'));
    f.driver.predecessorChanged();
    t.mock.timers.tick(10);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.clears, ['driver']);
    f.pending[0].resolve(page());
    await Promise.resolve();
    f.driver.destroy();
});

test('predecessor clear cannot overwrite a newer reentrant user search', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const clear = f.host.clear;
    f.host.clear = (owner, id) => {
        const result = clear(owner, id);
        f.driver.search('newer');
        return result;
    };
    f.driver.predecessorChanged();
    t.mock.timers.tick(10);
    assert.deepEqual(
        f.requests.map((request) => request.searchTerm),
        ['newer']
    );
    f.pending[0].resolve(page());
    await Promise.resolve();
    f.driver.destroy();
});

test('predecessor reset captures its effect arguments before canonical clear reenters', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const clear = f.host.clear;
    f.host.clear = (owner, id) => {
        const result = clear(owner, id);
        f.driver.setPredecessor('new', pair('new', 'Different'));
        return result;
    };
    f.driver.predecessorChanged();
    t.mock.timers.tick(10);
    assert.deepEqual(f.requests[0].filterData, {
        previousFilterFieldId: 'previous',
        previousFilterPrimaryValue: 'Same',
    });
    f.pending[0].resolve(page());
    await Promise.resolve();
    f.driver.destroy();
});
