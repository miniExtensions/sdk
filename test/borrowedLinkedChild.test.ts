import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createBorrowedLinkedChildController,
    type BorrowedLinkedChildScope,
} from '../src/forms/index.js';

const fixture = () => {
    let scope: BorrowedLinkedChildScope | null = {
        source: ['parent-A', 1],
        draft: null,
    };
    const owner = createBorrowedLinkedChildController({
        readScope: () => scope,
    });
    return {
        owner,
        set(next: BorrowedLinkedChildScope | null) {
            scope = next;
        },
    };
};
test('borrows actual native read acceptance and retains its draft identity', () => {
    const { owner, set } = fixture();
    assert.equal(owner.captureSave(), null);
    const read = owner.captureRead()!;
    const draft = {};
    let publications = 0;
    assert.equal(
        owner.acceptRead(read, (current) => {
            assert.equal(current(), true);
            publications++;
            set({ source: ['parent-A', 1], draft: [draft, 1] });
            return true;
        }),
        true
    );
    assert.equal(publications, 1);
    assert.equal(
        owner.acceptRead(read, () => {
            throw new Error('replay');
        }),
        false
    );
    set({ source: ['parent-A', 1], draft: [draft, 2] });
    assert.equal(owner.canPresent(read), true);
});
for (const replacement of [
    'parent',
    'publication ABA',
    'session',
    'field',
    'record',
    'view',
    'unmount',
] as const) {
    test(`retires captured native read and Save on ${replacement}`, async () => {
        const { owner, set } = fixture();
        const draft = {};
        set({ source: ['parent-A', 1], draft: [draft, 1] });
        assert.equal(
            owner.acceptRead(owner.captureRead()!, (current) => current()),
            true
        );
        const read = owner.captureRead()!;
        const save = owner.captureSave()!;
        if (replacement === 'unmount') owner.dispose();
        else
            set({
                source:
                    replacement === 'publication ABA'
                        ? ['parent-A', 3]
                        : [replacement, 2],
                draft: [draft, 1],
            });
        assert.equal(
            owner.acceptRead(read, () => {
                throw new Error('obsolete publication');
            }),
            false
        );
        assert.equal(owner.canPresent(read), false);
        assert.deepEqual(
            await owner.save(save, async () => {
                throw new Error('obsolete Save');
            }),
            { type: 'retired' }
        );
        if (replacement !== 'unmount') {
            const successor = owner.captureRead()!;
            assert.equal(
                owner.acceptRead(successor, (current) => current()),
                true
            );
            assert.equal(owner.canPresent(successor), true);
        }
    });
}
test('draft revisions including equal-value edits retire pending reads and Save intents', async () => {
    const { owner, set } = fixture();
    const draft = {};
    set({ source: ['parent-A', 1], draft: [draft, 1] });
    assert.equal(
        owner.acceptRead(owner.captureRead()!, (current) => current()),
        true
    );
    const read = owner.captureRead()!;
    const save = owner.captureSave()!;
    set({ source: ['parent-A', 1], draft: [draft, 2] });
    assert.equal(
        owner.acceptRead(read, () => {
            throw new Error('stale draft');
        }),
        false
    );
    assert.equal(owner.canPresent(read), false);
    assert.deepEqual(
        await owner.save(save, async () => {
            throw new Error('stale intent');
        }),
        { type: 'retired' }
    );
});
for (const outcome of ['success', 'failure'] as const) {
    test(`already allocated ${outcome} settles unchanged after replacement and disposal`, async () => {
        const { owner, set } = fixture();
        set({ source: ['parent-A', 1], draft: [{}, 1] });
        let resolve!: (value: object) => void;
        let reject!: (reason: Error) => void;
        const transport = new Promise<object>((yes, no) => {
            resolve = yes;
            reject = no;
        });
        let allocations = 0;
        assert.equal(
            owner.acceptRead(owner.captureRead()!, (current) => current()),
            true
        );
        const save = owner.captureSave()!;
        const pending = owner.save(save, () => {
            allocations++;
            return transport;
        });
        set({ source: ['parent-B', 2], draft: [{}, 2] });
        owner.dispose();
        assert.deepEqual(await owner.save(save, async () => ({})), {
            type: 'retired',
        });
        if (outcome === 'success') {
            const receipt = {};
            resolve(receipt);
            assert.deepEqual(await pending, {
                type: 'settled',
                value: receipt,
            });
        } else {
            const error = new Error('native unknown outcome');
            reject(error);
            await assert.rejects(pending, (cause) => cause === error);
        }
        assert.equal(allocations, 1);
    });
}
test('failed explicit Save never replays; an explicit fresh intent delegates the retry', async () => {
    const { owner, set } = fixture();
    set({ source: ['parent-A', 1], draft: [{}, 1] });
    let calls = 0;
    assert.equal(
        owner.acceptRead(owner.captureRead()!, (current) => current()),
        true
    );
    const intent = owner.captureSave()!;
    await assert.rejects(
        owner.save(intent, async () => {
            calls++;
            throw new Error('native failure');
        }),
        /native failure/
    );
    assert.deepEqual(
        await owner.save(intent, async () => {
            calls++;
        }),
        { type: 'retired' }
    );
    assert.deepEqual(
        await owner.save(owner.captureSave()!, async () => {
            calls++;
            return 'retried';
        }),
        { type: 'settled', value: 'retried' }
    );
    assert.equal(calls, 2);
});
test('refused acceptance stays hidden, and foreign tickets cannot cross controllers', () => {
    const a = fixture().owner;
    const b = fixture().owner;
    const read = a.captureRead()!;
    assert.equal(b.canPresent(read), false);
    assert.equal(
        b.acceptRead(read, () => true),
        false
    );
    assert.equal(
        a.acceptRead(read, () => false),
        false
    );
    assert.equal(a.canPresent(read), false);
});
test('native read faults and absent scope refuse admission without side effects', () => {
    const owner = createBorrowedLinkedChildController({
        readScope() {
            throw new Error('native scope unavailable');
        },
    });
    assert.equal(owner.captureRead(), null);
    assert.equal(owner.captureSave(), null);
    const { owner: absent, set } = fixture();
    set(null);
    assert.equal(absent.captureRead(), null);
});

test('publication rechecks actual scope and preserves native publisher faults', () => {
    const { owner, set } = fixture();
    const read = owner.captureRead()!;
    assert.equal(
        owner.acceptRead(read, (current) => {
            set({ source: ['parent-B', 2], draft: null });
            return current();
        }),
        false
    );
    assert.equal(owner.canPresent(read), false);
    const next = owner.captureRead()!;
    const error = new Error('native publisher failed');
    assert.throws(
        () =>
            owner.acceptRead(next, () => {
                throw error;
            }),
        (cause) => cause === error
    );
    assert.equal(owner.canPresent(next), false);
    owner.dispose();
    assert.equal(owner.captureRead(), null);
    assert.equal(owner.captureSave(), null);
});
test('foreign Save tickets cannot delegate another native owner', async () => {
    const a = fixture();
    const b = fixture();
    a.set({ source: ['same', 1], draft: [{}, 1] });
    b.set({ source: ['same', 1], draft: [{}, 1] });
    assert.equal(
        a.owner.acceptRead(a.owner.captureRead()!, (current) => current()),
        true
    );
    assert.equal(
        b.owner.acceptRead(b.owner.captureRead()!, (current) => current()),
        true
    );
    assert.deepEqual(
        await b.owner.save(a.owner.captureSave()!, async () => {
            throw new Error('foreign allocation');
        }),
        { type: 'retired' }
    );
});

test('a retained A draft cannot allocate a B Save before actual B read acceptance', async () => {
    const { owner, set } = fixture();
    const draft = {};
    set({ source: ['parent-A', 1], draft: [draft, 1] });
    assert.equal(owner.captureSave(), null);
    assert.equal(
        owner.acceptRead(owner.captureRead()!, (current) => current()),
        true
    );
    assert.ok(owner.captureSave());
    set({ source: ['parent-B', 2], draft: [draft, 1] });
    assert.equal(owner.captureSave(), null);
    const retained = owner.captureRead()!;
    assert.equal(
        owner.acceptRead(retained, () => false),
        false
    );
    assert.equal(owner.captureSave(), null);
    const fresh = owner.captureRead()!;
    assert.equal(
        owner.acceptRead(fresh, (current) => {
            if (!current()) return false;
            set({ source: ['parent-B', 2], draft: [{}, 2] });
            return true;
        }),
        true
    );
    assert.deepEqual(
        await owner.save(owner.captureSave()!, async () => 'native B'),
        { type: 'settled', value: 'native B' }
    );
});

const observedScope = () => {
    const scope = { source: ['parent-A', 1], draft: [{}, 1] };
    let observe: (() => void) | null = null;
    const owner = createBorrowedLinkedChildController({
        readScope: () => {
            const callback = observe;
            observe = null;
            callback?.();
            return scope;
        },
    });
    return {
        owner,
        nextRead(callback: () => void) {
            observe = callback;
        },
        accept() {
            assert.equal(
                owner.acceptRead(owner.captureRead()!, (current) => current()),
                true
            );
        },
    };
};

test('same-ticket observed read reentry delegates only the outer publication', () => {
    const f = observedScope();
    const read = f.owner.captureRead()!;
    let publications = 0;
    let inner: boolean | undefined;
    f.nextRead(() => {
        inner = f.owner.acceptRead(read, () => {
            publications++;
            return true;
        });
    });
    const outer = f.owner.acceptRead(read, () => {
        publications++;
        return true;
    });
    assert.equal(publications, 1);
    assert.equal(inner, false);
    assert.equal(outer, true);
});

test('same-ticket observed Save reentry allocates only the outer native promise', async () => {
    const f = observedScope();
    f.accept();
    const save = f.owner.captureSave()!;
    const receipt = {};
    const native = Promise.resolve(receipt);
    let allocations = 0;
    const allocate = () => {
        allocations++;
        return native;
    };
    let inner: ReturnType<typeof f.owner.save> | undefined;
    f.nextRead(() => {
        inner = f.owner.save(save, allocate);
    });
    const outer = await f.owner.save(save, allocate);
    assert.equal(allocations, 1);
    assert.deepEqual(await inner, { type: 'retired' });
    assert.equal(outer.type, 'settled');
    if (outer.type === 'settled') assert.equal(outer.value, receipt);
});

test('observed refusal cannot resurrect an unused read presentation', () => {
    const f = observedScope();
    const read = f.owner.captureRead()!;
    let publications = 0;
    f.nextRead(() => {
        assert.equal(
            f.owner.acceptRead(read, () => {
                publications++;
                return false;
            }),
            false
        );
    });
    const outer = f.owner.canPresent(read);
    assert.equal(publications, 1);
    assert.equal(outer, false);
    assert.equal(f.owner.canPresent(read), false);
});

test('disposal observed by the final Save scope prevents native allocation', async () => {
    const f = observedScope();
    f.accept();
    const save = f.owner.captureSave()!;
    f.nextRead(() => f.owner.dispose());
    let allocations = 0;
    const result = await f.owner.save(save, async () => {
        allocations++;
    });
    assert.equal(allocations, 0);
    assert.deepEqual(result, { type: 'retired' });
});

test('disposal observed during read admission prevents publication and presentation', () => {
    const f = observedScope();
    const read = f.owner.captureRead()!;
    f.nextRead(() => f.owner.dispose());
    let publications = 0;
    const accepted = f.owner.acceptRead(read, () => {
        publications++;
        return true;
    });
    assert.equal(publications, 0);
    assert.equal(accepted, false);
    assert.equal(f.owner.canPresent(read), false);
});

test('disposal observed during presentation retires the current observation', () => {
    const f = observedScope();
    const read = f.owner.captureRead()!;
    f.nextRead(() => f.owner.dispose());
    assert.equal(f.owner.canPresent(read), false);
});

for (const boundary of [
    'readScope',
    'source getter',
    'draft getter',
    'source iteration',
    'draft iteration',
] as const) {
    for (const capture of ['captureRead', 'captureSave'] as const) {
        test(`disposal during ${boundary} refuses ${capture}`, () => {
            let armed = false;
            const retire = () => {
                if (armed) owner.dispose();
            };
            const source: unknown[] = ['parent-A', 1];
            const draft: unknown[] = [{}, 1];
            for (const [name, tuple] of [
                ['source iteration', source],
                ['draft iteration', draft],
            ] as const) {
                const iterator = tuple[Symbol.iterator].bind(tuple);
                tuple[Symbol.iterator] = () => {
                    if (boundary === name) retire();
                    return iterator();
                };
            }
            const owner = createBorrowedLinkedChildController({
                readScope: () => {
                    if (boundary === 'readScope') retire();
                    return {
                        get source() {
                            if (boundary === 'source getter') retire();
                            return source;
                        },
                        get draft() {
                            if (boundary === 'draft getter') retire();
                            return draft;
                        },
                    };
                },
            });
            assert.equal(
                owner.acceptRead(owner.captureRead()!, (current) => current()),
                true
            );
            armed = true;
            assert.equal(owner[capture](), null);
            assert.equal(owner.captureRead(), null);
            assert.equal(owner.captureSave(), null);
        });
    }
}
