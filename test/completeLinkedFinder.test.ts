import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createCompleteLinkedFinderCoordinator,
    type CompleteLinkedFinderAdmission,
    type CompleteLinkedFinderHost,
    type CompleteLinkedFinderPage,
} from '../src/ui/index.js';

type Row = { id: string; hidden: string };
type Filter = { search: string; raw?: object };
type Owner = { revision: number };
type Page = CompleteLinkedFinderPage<Row>;
const admitted = { status: 'admitted' } as const;
const refused = { status: 'refused' } as const;
const request = (search = '', resetOffset = true) => ({
    filter: { search },
    resetOffset,
});
const page = (ids: string[], offset: string | null = null): Page => ({
    records: ids.map((id) => ({ id, hidden: `private ${id}` })),
    offset,
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
const turn = async () => {
    await Promise.resolve();
    await Promise.resolve();
};
function fixture(testing = true) {
    let owner: Owner | null = { revision: 1 };
    let readRevision = 1;
    const canonical = ['hidden', 'chosen', 'hidden'];
    const listeners = new Set<() => void>();
    const allocated: ReturnType<typeof deferred<Page>>[] = [];
    const captures: { filter: Filter; offset: string | null }[] = [];
    const publications: Page[] = [];
    const toggles: { owner: Owner; id: string }[] = [];
    const closes: Owner[] = [];
    let publishHook = () => {};
    let toggleHook = (): CompleteLinkedFinderAdmission => admitted;
    let enabled = true;
    let auto = true;
    let preview = false;
    let publishAdmitted = true;
    let postCurrent = true;
    const host: CompleteLinkedFinderHost<Row, Filter, Owner> = {
        captureOwner: () => owner,
        isOwnerCurrent: (expected) => expected === owner,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        captureRead(expected, input) {
            const revision = readRevision;
            captures.push(input);
            return {
                mode: preview ? 'authenticated-preview' : 'public',
                isCurrent: (phase) =>
                    expected === owner &&
                    (phase === 'after-publication'
                        ? postCurrent
                        : revision === readRevision),
                query() {
                    const pending = deferred<Page>();
                    allocated.push(pending);
                    return pending.promise;
                },
                publish(result) {
                    publications.push(result);
                    publishHook();
                    return publishAdmitted ? admitted : refused;
                },
            };
        },
        selection: () => ({
            ids: canonical,
            enabled,
            autoSelectScannedRecord: auto,
        }),
        recordId: (row) => row.id,
        isOptionEnabled: (_expected, id) => id !== 'disabled',
        toggle(expected, id) {
            toggles.push({ owner: expected, id });
            const result = toggleHook();
            if (result.status === 'refused' || expected !== owner)
                return refused;
            if (canonical.includes(id)) {
                for (let i = canonical.length - 1; i >= 0; i--)
                    if (canonical[i] === id) canonical.splice(i, 1);
            } else canonical.push(id);
            return admitted;
        },
        close(expected) {
            if (expected !== owner) return refused;
            closes.push(expected);
            return admitted;
        },
        errorMessage: () => 'Admitted load error',
    };
    const coordinator = createCompleteLinkedFinderCoordinator(host, {
        testing,
    });
    return {
        coordinator,
        host,
        canonical,
        allocated,
        captures,
        publications,
        toggles,
        closes,
        currentOwner: () => owner!,
        notify: () => {
            for (const listener of [...listeners]) listener();
        },
        replace(next: Owner | null = { revision: 2 }) {
            owner = next;
            for (const listener of [...listeners]) listener();
        },
        retireRead() {
            readRevision++;
        },
        configure(values: {
            enabled?: boolean;
            auto?: boolean;
            preview?: boolean;
            publishAdmitted?: boolean;
            postCurrent?: boolean;
            publishHook?: () => void;
            toggleHook?: () => CompleteLinkedFinderAdmission;
        }) {
            enabled = values.enabled ?? enabled;
            auto = values.auto ?? auto;
            preview = values.preview ?? preview;
            publishAdmitted = values.publishAdmitted ?? publishAdmitted;
            postCurrent = values.postCurrent ?? postCurrent;
            publishHook = values.publishHook ?? publishHook;
            toggleHook = values.toggleHook ?? toggleHook;
        },
        listenerCount: () => listeners.size,
    };
}

test('direct receipt is the exact raw page; model deduplicates identities without labels or canonical normalization', async () => {
    const f = fixture();
    const input = { search: 'raw', raw: {} };
    const resultPromise = f.coordinator.queryNow({
        filter: input,
        resetOffset: true,
    });
    assert.equal(f.coordinator.getSnapshot().phase, 'loading');
    assert.equal(f.captures[0].filter, input);
    const raw = page(['b', 'a', 'b'], 'next');
    f.allocated[0].resolve(raw);
    const result = await resultPromise;
    assert.equal(result.status, 'accepted');
    if (result.status !== 'accepted') assert.fail();
    assert.equal(result.page, raw);
    assert.equal(f.publications[0], raw);
    assert.equal(f.coordinator.getSnapshot().rawRecords, raw.records);
    assert.equal(f.coordinator.getSnapshot().selectedIds, f.canonical);
    assert.deepEqual(f.canonical, ['hidden', 'chosen', 'hidden']);
    const model = f.coordinator.model.getState();
    assert.deepEqual(model.options, [
        { value: 'b', label: '' },
        { value: 'a', label: '' },
    ]);
    assert.equal(model.readOnly, true);
    assert.deepEqual(model.value, []);
    assert.equal(model.linkedRecords, undefined);
    assert.deepEqual(Object.keys(f.coordinator.model).sort(), [
        'getState',
        'subscribe',
    ]);
    f.coordinator.destroy();
});

for (const testing of [false, true]) {
    test(`scheduled search returns void and immediately loads; ${testing ? 10 : 800}ms debounce retains only latest request`, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
        const f = fixture(testing);
        assert.equal(f.coordinator.scheduleSearch(request('old')), undefined);
        assert.equal(f.coordinator.getSnapshot().phase, 'loading');
        t.mock.timers.tick(testing ? 5 : 400);
        f.coordinator.scheduleSearch(request('new'));
        t.mock.timers.tick(testing ? 9 : 799);
        assert.equal(f.allocated.length, 0);
        t.mock.timers.tick(1);
        assert.equal(f.allocated.length, 1);
        assert.equal(f.captures.at(-1)?.filter.search, 'new');
        f.allocated[0].resolve(page(['new']));
        await turn();
        assert.deepEqual(
            f.coordinator.getSnapshot().rawRecords.map((row) => row.id),
            ['new']
        );
        f.coordinator.destroy();
    });
}

test('direct query supersedes queued search without allocating its transport', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    f.coordinator.scheduleSearch(request('queued'));
    const pending = f.coordinator.queryNow(request('direct'));
    t.mock.timers.tick(10);
    assert.equal(f.allocated.length, 1);
    f.allocated[0].resolve(page(['direct']));
    assert.equal((await pending).status, 'accepted');
    f.coordinator.destroy();
});

test('latest pagination wins logically without cancelling either allocated host transport', async () => {
    const f = fixture();
    const first = f.coordinator.queryNow(request());
    f.allocated[0].resolve(page(['base', 'base'], 'next'));
    await first;
    const slow = f.coordinator.queryNow(request('slow', false));
    const fast = f.coordinator.queryNow(request('fast', false));
    assert.deepEqual(
        f.captures.slice(1).map((input) => input.offset),
        ['next', 'next']
    );
    f.allocated[2].resolve(page(['winner', 'winner']));
    assert.equal((await fast).status, 'accepted');
    f.allocated[1].resolve(page(['loser']));
    assert.equal((await slow).status, 'retired');
    assert.equal(f.publications.length, 2);
    assert.deepEqual(
        f.coordinator.getSnapshot().rawRecords.map((row) => row.id),
        ['base', 'base', 'winner', 'winner']
    );
    f.coordinator.destroy();
});

test('public throttle applies to nonreset reads even without an offset and search scheduling does not reset its clock', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
    const f = fixture(false);
    const first = f.coordinator.queryNow(request());
    f.allocated[0].resolve(page(['base']));
    await first;
    assert.deepEqual(await f.coordinator.queryNow(request('', false)), {
        status: 'refused',
        reason: 'throttled',
    });
    f.coordinator.scheduleSearch(request('scheduled', false));
    t.mock.timers.tick(800);
    await turn();
    assert.equal(f.allocated.length, 1);
    t.mock.timers.tick(200);
    const next = f.coordinator.queryNow(request('', false));
    assert.equal(f.allocated.length, 2);
    f.allocated[1].resolve(page(['allowed']));
    assert.equal((await next).status, 'accepted');
    f.coordinator.destroy();
});

for (const scheduled of [false, true]) {
    test(`authenticated preview ${scheduled ? 'scheduled' : 'direct'} reads publish exact host page without model or loading emissions`, async () => {
        const f = fixture();
        f.configure({ preview: true });
        let emissions = 0;
        let modelEmissions = 0;
        f.coordinator.subscribe(() => emissions++);
        const unsubscribe = f.coordinator.model.subscribe(
            () => modelEmissions++
        );
        const initialModelEmissions = modelEmissions;
        const pending = scheduled
            ? f.coordinator.scheduleSearch(request())
            : f.coordinator.queryNow(request());
        assert.equal(f.allocated.length, 1);
        assert.equal(f.coordinator.getSnapshot().phase, 'idle');
        const raw = page(['preview']);
        f.allocated[0].resolve(raw);
        await pending;
        await turn();
        assert.equal(f.publications[0], raw);
        assert.equal(emissions, 0);
        assert.equal(modelEmissions, initialModelEmissions);
        assert.deepEqual(f.coordinator.getSnapshot().rawRecords, []);
        assert.deepEqual(f.coordinator.model.getState().options, []);
        unsubscribe();
        f.coordinator.destroy();
    });
}

test('unavailable preview has no transport or loading flash', async () => {
    const f = fixture();
    f.host.captureRead = () => null;
    assert.deepEqual(await f.coordinator.queryNow(request()), {
        status: 'refused',
        reason: 'unavailable',
    });
    f.coordinator.scheduleSearch(request());
    assert.equal(f.allocated.length, 0);
    assert.equal(f.coordinator.getSnapshot().phase, 'idle');
    f.coordinator.destroy();
});

test('authenticated preview retains only paging metadata, without candidate/model/loading publication', async () => {
    const f = fixture();
    f.configure({ preview: true });
    let emissions = 0;
    f.coordinator.subscribe(() => emissions++);
    const first = f.coordinator.queryNow(request('preview'));
    f.allocated[0].resolve(page(['first'], 'preview-next'));
    assert.equal((await first).status, 'accepted');
    const next = f.coordinator.queryNow(request('preview', false));
    assert.equal(f.captures[1].offset, 'preview-next');
    f.allocated[1].resolve(page(['second']));
    assert.equal((await next).status, 'accepted');
    assert.equal(emissions, 0);
    assert.equal(f.coordinator.getSnapshot().offset, null);
    assert.deepEqual(f.coordinator.getSnapshot().rawRecords, []);
    assert.deepEqual(f.coordinator.model.getState().options, []);
    f.coordinator.destroy();
});

test('failed public candidate projection does not advance the next request beyond its published candidate offset', async () => {
    const f = fixture();
    const first = f.coordinator.queryNow(request());
    f.allocated[0].resolve(page(['first'], 'accepted-next'));
    await first;
    f.host.recordId = (row) => {
        if (row.id === 'bad') throw new TypeError('Invalid admitted row');
        return row.id;
    };
    const failed = f.coordinator.queryNow(request('bad'));
    f.allocated[1].resolve(page(['bad'], 'unaccepted-next'));
    assert.equal((await failed).status, 'failure');
    const next = f.coordinator.queryNow(request('', false));
    assert.equal(f.captures[2].offset, 'accepted-next');
    f.allocated[2].resolve(page(['valid']));
    assert.equal((await next).status, 'accepted');
    f.coordinator.destroy();
});

for (const preview of [false, true])
    test(`captured paging metadata cannot cross a reentrant post-publication owner replacement (preview=${preview})`, async () => {
        const f = fixture();
        f.configure({ preview });
        let reads = 0;
        const pending = f.coordinator.queryNow(request('retired'));
        f.allocated[0].resolve({
            records: page(['old']).records,
            get offset() {
                reads++;
                f.replace();
                return 'obsolete-cursor';
            },
        });
        assert.equal((await pending).status, 'retired');
        assert.equal(reads, 1);
        const current = f.coordinator.queryNow(request('current', false));
        assert.equal(f.captures[1].offset, null);
        f.allocated[1].resolve(page(['current']));
        assert.equal((await current).status, 'accepted');
        f.coordinator.destroy();
    });

for (const boundary of [
    'before',
    'publication',
    'model',
    'observer',
] as const) {
    test(`owner replacement at ${boundary} prevents acceptance and erases stale presentation`, async () => {
        const f = fixture();
        const pending = f.coordinator.queryNow(request());
        if (boundary === 'before') f.replace();
        if (boundary === 'publication')
            f.configure({ publishHook: () => f.replace() });
        if (boundary === 'model') {
            f.coordinator.model.subscribe((state) => {
                if (state.options.length) f.replace();
            });
        }
        if (boundary === 'observer') {
            f.coordinator.subscribe(() => {
                if (f.coordinator.getSnapshot().phase === 'ready') f.replace();
            });
        }
        f.allocated[0].resolve(page(['retired']));
        assert.equal((await pending).status, 'retired');
        assert.equal(f.publications.length, boundary === 'before' ? 0 : 1);
        assert.deepEqual(f.coordinator.getSnapshot().rawRecords, []);
        assert.deepEqual(f.coordinator.model.getState().options, []);
        f.coordinator.destroy();
    });
}

test('observed owner A/B/A cannot revive queued or allocated A work', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const a = f.currentOwner();
    const pending = f.coordinator.queryNow(request());
    f.replace();
    f.replace(a);
    f.coordinator.scheduleSearch(request());
    t.mock.timers.tick(10);
    f.allocated[0].resolve(page(['old A']));
    assert.equal((await pending).status, 'retired');
    assert.equal(f.allocated.length, 1);
    assert.equal(f.publications.length, 0);
    assert.equal(f.coordinator.getSnapshot().owner, null);
    f.coordinator.destroy();
});

test('read identity is checked before publication and separately after an own-row merge', async () => {
    const stale = fixture();
    const stalePending = stale.coordinator.queryNow(request());
    stale.retireRead();
    stale.allocated[0].resolve(page(['stale']));
    assert.equal((await stalePending).status, 'retired');
    assert.equal(stale.publications.length, 0);
    assert.equal(stale.coordinator.getSnapshot().phase, 'retired');
    stale.coordinator.destroy();

    for (const postCurrent of [true, false]) {
        const f = fixture();
        f.configure({ postCurrent, publishHook: () => f.retireRead() });
        const pending = f.coordinator.queryNow(request());
        f.allocated[0].resolve(page(['own-row']));
        assert.equal(
            (await pending).status,
            postCurrent ? 'accepted' : 'retired'
        );
        assert.equal(f.publications.length, 1);
        f.coordinator.destroy();
    }
});

test('publication refusal is explicit and never supplies an accepted page or model', async () => {
    const f = fixture();
    f.configure({ publishAdmitted: false });
    const pending = f.coordinator.queryNow(request());
    f.allocated[0].resolve(page(['refused']));
    assert.deepEqual(await pending, {
        status: 'refused',
        reason: 'publication',
    });
    assert.deepEqual(f.coordinator.model.getState().options, []);
    f.coordinator.destroy();
});

test('current failures retain exact identity and stale failures cannot replace current loading/data', async () => {
    const f = fixture();
    const old = f.coordinator.queryNow(request('old'));
    const next = f.coordinator.queryNow(request('next'));
    const oldError = new Error('old');
    f.allocated[0].reject(oldError);
    assert.equal((await old).status, 'retired');
    assert.equal(f.coordinator.getSnapshot().phase, 'loading');
    const currentError = new Error('current');
    f.allocated[1].reject(currentError);
    assert.deepEqual(await next, { status: 'failure', error: currentError });
    assert.equal(f.coordinator.getSnapshot().error, 'Admitted load error');
    f.coordinator.destroy();
});

test('capture failures are explicit and a throwing error presenter cannot reject query receipts', async () => {
    const f = fixture();
    const cause = new Error('capture');
    f.host.captureRead = () => {
        throw cause;
    };
    assert.deepEqual(await f.coordinator.queryNow(request()), {
        status: 'failure',
        error: cause,
    });
    f.coordinator.destroy();

    const g = fixture();
    g.host.errorMessage = () => {
        throw new Error('presenter');
    };
    const pending = g.coordinator.queryNow(request());
    g.allocated[0].reject(cause);
    assert.deepEqual(await pending, { status: 'failure', error: cause });
    assert.equal(
        g.coordinator.getSnapshot().error,
        'Unable to load linked records. Please try again.'
    );
    g.coordinator.destroy();
});

test('reentrant capture reserves newer query intent before the outer request can start', async () => {
    const f = fixture();
    const original = f.host.captureRead;
    let inner: ReturnType<typeof f.coordinator.queryNow> | undefined;
    f.host.captureRead = (expected, input) => {
        if (input.filter.search === 'outer')
            inner = f.coordinator.queryNow(request('inner'));
        return original(expected, input);
    };
    assert.equal(
        (await f.coordinator.queryNow(request('outer'))).status,
        'retired'
    );
    assert.equal(f.allocated.length, 1);
    f.allocated[0].resolve(page(['inner']));
    assert.equal((await inner)?.status, 'accepted');
    f.coordinator.destroy();
});

test('host canonical toggles preserve hidden membership; captured stale callbacks refuse a replacement owner', async () => {
    const f = fixture();
    const expected = f.currentOwner();
    assert.equal(
        (await f.coordinator.toggle(expected, 'new')).status,
        'admitted'
    );
    assert.deepEqual(f.canonical, ['hidden', 'chosen', 'hidden', 'new']);
    assert.equal(
        (await f.coordinator.toggle(expected, 'chosen')).status,
        'admitted'
    );
    assert.deepEqual(f.canonical, ['hidden', 'hidden', 'new']);
    f.replace();
    assert.deepEqual(await f.coordinator.toggle(expected, 'new'), refused);
    assert.equal(f.toggles.length, 2);
    f.coordinator.destroy();
});

for (const ids of [
    [],
    ['only'],
    ['dup', 'dup'],
    ['a', 'b'],
    ['chosen'],
    ['disabled'],
]) {
    test(`scan ${JSON.stringify(ids)} uses raw uniqueness and current canonical selection`, async () => {
        const f = fixture();
        const pending = f.coordinator.scan(request());
        f.allocated[0].resolve(page(ids));
        const unique = ids.length === 1 && ids[0] === 'only';
        assert.deepEqual(
            await pending,
            unique
                ? { status: 'selected', id: 'only' }
                : { status: 'unchanged' }
        );
        assert.equal(f.toggles.length, unique ? 1 : 0);
        assert.equal(f.closes.length, unique ? 1 : 0);
        f.coordinator.destroy();
    });
}

for (const condition of [
    'disabled',
    'auto-off',
    'refused',
    'replaced',
] as const) {
    test(`scan ${condition} never closes a refused/replaced owner`, async () => {
        const f = fixture();
        if (condition === 'disabled') f.configure({ enabled: false });
        if (condition === 'auto-off') f.configure({ auto: false });
        if (condition === 'refused') f.configure({ toggleHook: () => refused });
        if (condition === 'replaced')
            f.configure({
                toggleHook: () => {
                    f.replace();
                    return admitted;
                },
            });
        const pending = f.coordinator.scan(request());
        f.allocated[0].resolve(page(['only']));
        assert.deepEqual(await pending, { status: 'unchanged' });
        assert.equal(f.closes.length, 0);
        f.coordinator.destroy();
    });
}

test('destroy removes subscriptions/queued work while allocated transport settles without publication', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture();
    const pending = f.coordinator.queryNow(request());
    f.coordinator.scheduleSearch(request('queued'));
    f.coordinator.destroy();
    t.mock.timers.tick(10);
    f.allocated[0].resolve(page(['late']));
    assert.equal((await pending).status, 'retired');
    assert.equal(f.allocated.length, 1);
    assert.equal(f.listenerCount(), 0);
    assert.equal(f.publications.length, 0);
});

test('error presentation reentrancy cannot write the old error into a newer query', async () => {
    const f = fixture();
    let next: ReturnType<typeof f.coordinator.queryNow> | undefined;
    f.host.errorMessage = () => {
        next = f.coordinator.queryNow(request('new'));
        return 'old error';
    };
    const old = f.coordinator.queryNow(request('old'));
    f.allocated[0].reject(new Error('old'));
    assert.equal((await old).status, 'retired');
    assert.equal(f.coordinator.getSnapshot().phase, 'loading');
    assert.equal(f.coordinator.getSnapshot().error, null);
    f.allocated[1].resolve(page(['new']));
    assert.equal((await next)?.status, 'accepted');
    f.coordinator.destroy();
});

test('a scan superseded during an admitted toggle cannot close the newer search', async () => {
    const f = fixture();
    let next: ReturnType<typeof f.coordinator.queryNow> | undefined;
    f.configure({
        toggleHook() {
            next = f.coordinator.queryNow(request('newer search'));
            return admitted;
        },
    });
    const scan = f.coordinator.scan(request('scan'));
    f.allocated[0].resolve(page(['only']));
    assert.deepEqual(await scan, { status: 'unchanged' });
    assert.equal(f.toggles.length, 1);
    assert.equal(f.closes.length, 0);
    f.allocated[1].resolve(page(['newer']));
    await next;
    f.coordinator.destroy();
});

test('an admitted scan toggle may advance its consumed selection read stamp while independently current close remains admitted', async () => {
    const f = fixture();
    const toggle = f.host.toggle;
    f.host.toggle = async (owner, id) => {
        const result = await toggle(owner, id);
        f.configure({ postCurrent: false });
        return result;
    };
    const pending = f.coordinator.scan(request('scan'));
    f.allocated[0].resolve(page(['new']));
    assert.deepEqual(await pending, { status: 'selected', id: 'new' });
    assert.equal(f.closes.length, 1);
    f.coordinator.destroy();
});

test('throwing scan eligibility reports failure without toggle or close', async () => {
    const f = fixture();
    const cause = new Error('eligibility');
    f.host.isOptionEnabled = () => {
        throw cause;
    };
    const scan = f.coordinator.scan(request());
    f.allocated[0].resolve(page(['only']));
    assert.deepEqual(await scan, { status: 'failure', error: cause });
    assert.equal(f.toggles.length, 0);
    assert.equal(f.closes.length, 0);
    f.coordinator.destroy();
});

test('destruction clears previously accepted candidate presentation but never canonical host IDs', async () => {
    const f = fixture();
    const pending = f.coordinator.queryNow(request());
    f.allocated[0].resolve(page(['private-candidate'], 'next'));
    await pending;
    f.coordinator.destroy();
    assert.equal(f.coordinator.getSnapshot().owner, null);
    assert.equal(f.coordinator.getSnapshot().phase, 'retired');
    assert.deepEqual(f.coordinator.getSnapshot().rawRecords, []);
    assert.deepEqual(f.coordinator.model.getState().options, []);
    assert.deepEqual(f.canonical, ['hidden', 'chosen', 'hidden']);
});

test('read replacement during loading notification refuses allocation and does not consume public throttle', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 10000 });
    const f = fixture(false);
    let retire = true;
    f.coordinator.subscribe(() => {
        if (retire && f.coordinator.getSnapshot().phase === 'loading') {
            retire = false;
            f.retireRead();
        }
    });
    assert.equal((await f.coordinator.queryNow(request())).status, 'retired');
    assert.equal(f.allocated.length, 0);
    const pending = f.coordinator.queryNow(request('', false));
    assert.equal(f.allocated.length, 1);
    f.allocated[0].resolve(page(['new']));
    assert.equal((await pending).status, 'accepted');
    f.coordinator.destroy();
});

for (const previous of ['queued', 'allocated'] as const) {
    for (const preparation of ['refused', 'failed'] as const) {
        test(`newer ${preparation} preparation retires older ${previous} rights without cancelling transport`, async (t) => {
            t.mock.timers.enable({ apis: ['setTimeout'] });
            const f = fixture();
            const old =
                previous === 'allocated'
                    ? f.coordinator.queryNow(request('old'))
                    : undefined;
            if (previous === 'queued')
                f.coordinator.scheduleSearch(request('old'));
            f.host.captureRead = () => {
                if (preparation === 'failed')
                    throw Error('Capture unavailable');
                return null;
            };
            assert.equal(
                (await f.coordinator.queryNow(request('new'))).status,
                preparation === 'failed' ? 'failure' : 'refused'
            );
            t.mock.timers.tick(10);
            assert.equal(f.allocated.length, previous === 'allocated' ? 1 : 0);
            if (old) {
                f.allocated[0].resolve(page(['old-private']));
                assert.equal((await old).status, 'retired');
            }
            assert.equal(f.publications.length, 0);
            assert.deepEqual(f.coordinator.getSnapshot().rawRecords, []);
            assert.equal(f.coordinator.getSnapshot().phase, 'idle');
            f.coordinator.destroy();
        });
    }
}

for (const completion of ['refused', 'throw'] as const) {
    test(`reentrant ${completion} capture reports retired after a newer accepted intent`, async () => {
        const f = fixture();
        const capture = f.host.captureRead;
        let newer: ReturnType<typeof f.coordinator.queryNow> | undefined;
        f.host.captureRead = (owner, input) => {
            f.host.captureRead = capture;
            newer = f.coordinator.queryNow(request('newer'));
            if (completion === 'throw') throw Error('Old capture failure');
            return null;
        };
        assert.equal(
            (await f.coordinator.queryNow(request('old'))).status,
            'retired'
        );
        f.allocated[0].resolve(page(['newer']));
        assert.equal((await newer)?.status, 'accepted');
        f.coordinator.destroy();
    });
}
