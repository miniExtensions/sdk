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

test('single-link close follows an admitted addition and preserves removal and ordinary toggle behavior', async () => {
    const f = fixture();
    const owner = f.currentOwner();
    assert.equal(
        (await f.coordinator.toggle(owner, 'new', { closeAfterAddition: true }))
            .status,
        'admitted'
    );
    assert.deepEqual(f.closes, [owner]);
    await f.coordinator.toggle(owner, 'new', { closeAfterAddition: true });
    await f.coordinator.toggle(owner, 'ordinary');
    assert.deepEqual(f.closes, [owner]);
    assert.deepEqual(f.canonical, ['hidden', 'chosen', 'hidden', 'ordinary']);
    f.coordinator.destroy();
});

for (const supersession of ['direct', 'scheduled', 'refused'] as const) {
    test(`deferred admitted toggle cannot close a newer same-owner ${supersession} search`, async () => {
        const f = fixture();
        const completion = deferred<CompleteLinkedFinderAdmission>();
        const toggle = f.host.toggle;
        f.host.toggle = async (owner, id) => {
            await completion.promise;
            return toggle(owner, id);
        };
        const result = f.coordinator.toggle(f.currentOwner(), 'new', {
            closeAfterAddition: true,
        });
        if (supersession === 'scheduled')
            f.coordinator.scheduleSearch(request('newer'));
        else {
            if (supersession === 'refused') f.host.captureRead = () => null;
            const pending = f.coordinator.queryNow(request('newer'));
            if (supersession === 'direct')
                f.allocated[0].resolve(page(['newer']));
            assert.equal(
                (await pending).status,
                supersession === 'direct' ? 'accepted' : 'refused'
            );
        }
        completion.resolve(admitted);
        assert.equal((await result).status, 'admitted');
        assert.equal(f.canonical.includes('new'), true);
        assert.deepEqual(f.closes, []);
        f.coordinator.destroy();
    });
}

test('reentrant native toggle publication cannot close the newer search', async () => {
    const f = fixture();
    const toggle = f.host.toggle;
    f.host.toggle = (owner, id) => {
        const result = toggle(owner, id);
        f.coordinator.scheduleSearch(request('reentrant'));
        return result;
    };
    assert.equal(
        (
            await f.coordinator.toggle(f.currentOwner(), 'new', {
                closeAfterAddition: true,
            })
        ).status,
        'admitted'
    );
    assert.deepEqual(f.closes, []);
    f.coordinator.destroy();
});

test('reentrant current-membership inspection cannot grant close for an older selection', async () => {
    const f = fixture();
    const selection = f.host.selection;
    let calls = 0;
    f.host.selection = (owner) => {
        if (++calls === 2)
            f.coordinator.scheduleSearch(request('membership-reentrant'));
        return selection(owner);
    };
    await f.coordinator.toggle(f.currentOwner(), 'new', {
        closeAfterAddition: true,
    });
    assert.equal(calls, 2);
    assert.deepEqual(f.closes, []);
    f.coordinator.destroy();
});

test('the final owner predicate cannot reentrantly grant close for an older selection', async () => {
    const f = fixture();
    const selection = f.host.selection;
    const isOwnerCurrent = f.host.isOwnerCurrent;
    let calls = 0;
    let armed = false;
    f.host.selection = (owner) => {
        if (++calls === 2) armed = true;
        return selection(owner);
    };
    f.host.isOwnerCurrent = (owner) => {
        if (armed) {
            armed = false;
            f.coordinator.scheduleSearch(request('owner-reentrant'));
        }
        return isOwnerCurrent(owner);
    };
    await f.coordinator.toggle(f.currentOwner(), 'new', {
        closeAfterAddition: true,
    });
    assert.equal(calls, 2);
    assert.deepEqual(f.closes, []);
    f.coordinator.destroy();
});

test('a removal followed by a reentrant canonical re-add does not become single-link addition intent', async () => {
    const f = fixture();
    const toggle = f.host.toggle;
    f.host.toggle = (owner, id) => {
        const result = toggle(owner, id);
        f.canonical.push(id);
        return result;
    };
    await f.coordinator.toggle(f.currentOwner(), 'chosen', {
        closeAfterAddition: true,
    });
    assert.equal(f.canonical.includes('chosen'), true);
    assert.deepEqual(f.closes, []);
    f.coordinator.destroy();
});

test('single-link close survives its admitted own write stamp while a separate close failure preserves toggle admission', async () => {
    const f = fixture();
    const pending = f.coordinator.queryNow(request());
    f.allocated[0].resolve(page(['new']));
    await pending;
    f.configure({
        toggleHook: () => {
            f.configure({ postCurrent: false });
            return admitted;
        },
    });
    assert.equal(
        (
            await f.coordinator.toggle(f.currentOwner(), 'new', {
                closeAfterAddition: true,
            })
        ).status,
        'admitted'
    );
    assert.equal(f.closes.length, 1);
    f.host.close = () => {
        throw new Error('Synthetic separate close refusal');
    };
    assert.equal(
        (
            await f.coordinator.toggle(f.currentOwner(), 'another', {
                closeAfterAddition: true,
            })
        ).status,
        'admitted'
    );
    f.coordinator.destroy();
});

for (const replacement of ['owner', 'ABA', 'dispose'] as const) {
    test(`late admission after ${replacement} cannot close a retired selection`, async () => {
        const f = fixture();
        const owner = f.currentOwner();
        const completion = deferred<void>();
        const toggle = f.host.toggle;
        f.host.toggle = async (expected, id) => {
            const result = toggle(expected, id);
            await completion.promise;
            return result;
        };
        const result = f.coordinator.toggle(owner, 'new', {
            closeAfterAddition: true,
        });
        assert.equal(f.canonical.includes('new'), true);
        if (replacement === 'dispose') f.coordinator.destroy();
        else {
            f.replace();
            if (replacement === 'ABA') f.replace(owner);
        }
        completion.resolve();
        assert.equal((await result).status, 'admitted');
        assert.deepEqual(f.closes, []);
        f.coordinator.destroy();
    });
}

test('read identity changes before refused preparation and never exposes host read ports', async () => {
    const f = fixture();
    assert.equal(f.coordinator.getSnapshot().readIdentity, null);
    const pending = f.coordinator.queryNow(request('initial'));
    const identity = f.coordinator.getSnapshot().readIdentity;
    assert(identity);
    assert.equal(Object.isFrozen(identity), true);
    assert.deepEqual(Object.keys(identity), []);
    f.allocated[0].resolve(page(['initial'], 'next'));
    await pending;
    assert.equal(f.coordinator.getSnapshot().readIdentity, identity);
    f.host.captureRead = () => {
        assert.equal(f.coordinator.getSnapshot().readIdentity, null);
        return null;
    };
    assert.equal(
        (await f.coordinator.queryNow(request('refused'))).status,
        'refused'
    );
    assert.equal(f.coordinator.getSnapshot().readIdentity, null);
    f.coordinator.destroy();
});

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
    let didAcceptHook = (_page: Page) => {};
    const acceptedPages: Page[] = [];
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
                didAccept(result) {
                    acceptedPages.push(result);
                    didAcceptHook(result);
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
        acceptedPages,
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
            didAcceptHook?: (page: Page) => void;
            toggleHook?: () => CompleteLinkedFinderAdmission;
        }) {
            enabled = values.enabled ?? enabled;
            auto = values.auto ?? auto;
            preview = values.preview ?? preview;
            publishAdmitted = values.publishAdmitted ?? publishAdmitted;
            postCurrent = values.postCurrent ?? postCurrent;
            publishHook = values.publishHook ?? publishHook;
            didAcceptHook = values.didAcceptHook ?? didAcceptHook;
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

for (const next of ['scheduled', 'refused'] as const) {
    test(`a scan cannot close a newer ${next} search started by the final owner predicate`, async () => {
        const f = fixture();
        const isOwnerCurrent = f.host.isOwnerCurrent;
        let armed = false;
        f.configure({
            toggleHook: () => {
                armed = true;
                return admitted;
            },
        });
        f.host.isOwnerCurrent = (owner) => {
            if (armed) {
                armed = false;
                if (next === 'refused') f.host.captureRead = () => null;
                f.coordinator.scheduleSearch(request('newer'));
            }
            return isOwnerCurrent(owner);
        };
        const result = f.coordinator.scan(request('scan'));
        f.allocated[0].resolve(page(['only']));
        assert.deepEqual(await result, { status: 'unchanged' });
        assert.equal(f.toggles.length, 1);
        assert.equal(f.canonical.includes('only'), true);
        assert.equal(f.closes.length, 0);
        f.coordinator.destroy();
    });
}

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

for (const preview of [false, true]) {
    test(`post-accept receipt qualifies exact page after publication (${preview ? 'preview' : 'public'})`, async () => {
        const f = fixture();
        const exact = page(['a', 'a'], 'next');
        let emissions = 0;
        f.coordinator.subscribe(() => emissions++);
        f.configure({
            preview,
            didAcceptHook(result) {
                assert.equal(result, exact);
                assert.equal(f.publications.at(-1), exact);
                assert.deepEqual(
                    f.coordinator.getSnapshot().rawRecords,
                    preview ? [] : exact.records
                );
                assert.equal(
                    f.coordinator.model.getState().options.length,
                    preview ? 0 : 1
                );
            },
        });
        const pending = f.coordinator.queryNow(request());
        f.allocated[0].resolve(exact);
        assert.equal((await pending).status, 'accepted');
        assert.deepEqual(f.acceptedPages, [exact]);
        if (preview) assert.equal(emissions, 0);
        f.configure({ didAcceptHook() {} });
        const next = f.coordinator.queryNow(request('next', false));
        assert.equal(f.captures.at(-1)?.offset, 'next');
        f.allocated[1].resolve(page([]));
        await next;
        f.coordinator.destroy();
    });
}

for (const mode of ['refused', 'retired', 'projection failure'] as const) {
    test(`post-accept receipt is absent for ${mode}`, async () => {
        const f = fixture();
        if (mode === 'refused') f.configure({ publishAdmitted: false });
        if (mode === 'retired') f.configure({ publishHook: () => f.replace() });
        if (mode === 'projection failure')
            f.host.recordId = () => {
                throw new Error('bad ID');
            };
        const pending = f.coordinator.queryNow(request());
        f.allocated[0].resolve(page(['a']));
        assert.equal(
            (await pending).status,
            mode === 'refused'
                ? 'refused'
                : mode === 'retired'
                  ? 'retired'
                  : 'failure'
        );
        assert.deepEqual(f.acceptedPages, []);
        f.coordinator.destroy();
    });
}

for (const mode of [
    'owner replacement',
    'successor read',
    'destroy',
] as const) {
    test(`post-accept callback rechecks ${mode}`, async () => {
        const f = fixture();
        let successor: ReturnType<typeof f.coordinator.queryNow> | undefined;
        f.configure({
            didAcceptHook() {
                if (mode === 'owner replacement') f.replace();
                else if (mode === 'destroy') f.coordinator.destroy();
                else {
                    f.configure({ didAcceptHook() {} });
                    successor = f.coordinator.queryNow(request('successor'));
                }
            },
        });
        const pending = f.coordinator.queryNow(request());
        f.allocated[0].resolve(page(['old']));
        assert.equal((await pending).status, 'retired');
        assert.equal(f.acceptedPages.length, 1);
        if (successor) {
            f.allocated[1].resolve(page(['new']));
            assert.equal((await successor).status, 'accepted');
            assert.equal(f.coordinator.getSnapshot().rawRecords[0].id, 'new');
        }
        f.coordinator.destroy();
    });
}

test('post-accept callback failure does not roll back an already accepted cursor/model', async () => {
    const f = fixture();
    f.configure({
        didAcceptHook() {
            throw new Error('presentation failure');
        },
    });
    const pending = f.coordinator.queryNow(request());
    f.allocated[0].resolve(page(['a'], 'next'));
    assert.equal((await pending).status, 'failure');
    assert.equal(f.coordinator.getSnapshot().rawRecords[0].id, 'a');
    f.configure({ didAcceptHook() {} });
    const next = f.coordinator.queryNow(request('', false));
    assert.equal(f.captures.at(-1)?.offset, 'next');
    f.allocated[1].resolve(page(['b']));
    await next;
    f.coordinator.destroy();
});

for (const preview of [false, true]) {
    test(`owner-bound scheduling receipt shares cursor, queue and latest intent (${preview ? 'preview' : 'public'})`, async (t) => {
        t.mock.timers.enable({ apis: ['setTimeout'] });
        const f = fixture();
        f.configure({ preview });
        const first = f.coordinator.queryNow(request());
        f.allocated[0].resolve(page(['a'], 'next'));
        await first;
        const owner = f.currentOwner();
        const receipt = f.coordinator.admitScheduledSearch(
            owner,
            request('scheduled', false)
        );
        assert.equal(receipt.status, 'admitted');
        if (receipt.status !== 'admitted') throw new Error('Expected intent');
        assert.equal(receipt.owner, owner);
        assert.equal(typeof receipt.nonce, 'object');
        assert.equal(receipt.isCurrent(), true);
        assert.equal(f.captures.at(-1)?.offset, 'next');
        if (!preview) {
            assert.equal(f.coordinator.getSnapshot().loadingMore, true);
            assert.equal(f.allocated.length, 1);
            t.mock.timers.tick(10);
        }
        assert.equal(f.allocated.length, 2);
        assert.equal(f.coordinator.scheduleSearch(request('new')), undefined);
        assert.equal(receipt.isCurrent(), false);
        f.allocated[1].resolve(page(['retired']));
        if (!preview) t.mock.timers.tick(10);
        f.allocated[2].resolve(page(['new']));
        await turn();
        assert.equal(f.publications.length, 2);
        assert.equal(
            f.coordinator.admitScheduledSearch({ revision: 999 }, request())
                .status,
            'refused'
        );
        assert.equal(f.captures.length, 3);
        f.coordinator.destroy();
    });
}

test('owner precheck reentrancy cannot let an older scheduling admission supersede a newer query', async () => {
    const f = fixture();
    const owner = f.currentOwner();
    const original = f.host.isOwnerCurrent;
    let entered = false;
    let inner: ReturnType<typeof f.coordinator.queryNow> | undefined;
    f.host.isOwnerCurrent = (expected) => {
        if (!entered) {
            entered = true;
            inner = f.coordinator.queryNow(request('inner'));
        }
        return original(expected);
    };
    assert.equal(
        f.coordinator.admitScheduledSearch(owner, request('outer')).status,
        'refused'
    );
    assert.equal(f.allocated.length, 1);
    assert.equal(f.captures[0].filter.search, 'inner');
    f.allocated[0].resolve(page(['inner']));
    assert.equal((await inner)?.status, 'accepted');
    assert.equal(f.coordinator.getSnapshot().rawRecords[0].id, 'inner');
    f.coordinator.destroy();
});
