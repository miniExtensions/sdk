import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createFormProgressStorage,
    makeFormProgressKey,
    parseStoredFormProgressValue,
    type FormProgressLockManager,
    type FormProgressStorageAdapter,
    type FormProgressStorageOptions,
} from '../src/forms/index.js';

class MemoryStorage implements FormProgressStorageAdapter {
    readonly values = new Map<string, string>();
    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
    removeItem(key: string): void {
        this.values.delete(key);
    }
}

// Synthetic external Web Locks boundary with held, per-name admission.
class QueuedLocks implements FormProgressLockManager {
    readonly names: string[] = [];
    private readonly tails = new Map<string, Promise<void>>();
    hold(name: string): () => void {
        let release = () => {};
        this.tails.set(
            name,
            new Promise<void>((resolve) => (release = resolve))
        );
        return release;
    }
    request<Result>(name: string, callback: () => Result): Promise<Result> {
        this.names.push(name);
        const previous = this.tails.get(name) ?? Promise.resolve();
        let release = () => {};
        const next = new Promise<void>((resolve) => (release = resolve));
        this.tails.set(name, next);
        return previous.then(callback).finally(release);
    }
}

const setup = (overrides: Partial<FormProgressStorageOptions> = {}) => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    const unavailable: string[] = [];
    let nextId = 0;
    const owner = createFormProgressStorage({
        getLocalStorage: () => local,
        getSessionStorage: () => session,
        createWriterId: () => `writer-${++nextId}`,
        onUnavailable: (operation) => unavailable.push(operation),
        ...overrides,
    });
    return { owner, local, session, unavailable };
};

const envelope = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
        kind: 'miniExtensions-form-progress',
        schemaVersion: 1,
        revision: 1,
        writerId: 'writer-a',
        record: { fld_name: 'Draft' },
        ...overrides,
    });

describe('opt-in Form progress storage', () => {
    it('constructs without resolving SSR adapters, locks or an identity', () => {
        let accesses = 0;
        const denied = () => {
            accesses++;
            throw new Error('Browser capability unavailable during SSR');
        };
        const owner = createFormProgressStorage({
            getLocalStorage: denied,
            getSessionStorage: denied,
            getLocks: denied,
            createWriterId: denied,
        });
        assert.equal(accesses, 0);
        assert.equal(makeFormProgressKey('shr_ssr'), 'form-progress-shr_ssr');
        assert.equal(parseStoredFormProgressValue(null), undefined);
        assert.equal(accesses, 0);
        assert.equal(owner.readStoredFormProgress('shr_ssr'), undefined);
        assert.equal(accesses, 1);
    });

    it('resolves the currently chosen adapters at operation time', async () => {
        let current: MemoryStorage | undefined;
        const { owner, unavailable } = setup({
            getLocalStorage: () => current,
        });
        assert.equal(owner.readStoredFormProgress('shr_lazy'), undefined);
        assert.deepEqual(unavailable, ['read']);
        current = new MemoryStorage();
        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: null,
                record: { fld_name: 'First edit' },
                shareId: 'shr_lazy',
                writerId: 'writer-a',
            }),
            { status: 'written', revision: 1 }
        );
        assert.deepEqual(owner.readStoredFormProgress('shr_lazy'), {
            fld_name: 'First edit',
        });
    });

    it('restores legacy drafts and upgrades them without dropping hidden values', async () => {
        const { owner, local } = setup();
        const record = { fld_visible: 'Visible', fld_hidden: 'Keep this' };
        local.setItem(
            makeFormProgressKey('shr_legacy'),
            JSON.stringify(record)
        );
        assert.deepEqual(owner.readStoredFormProgressSnapshot('shr_legacy'), {
            record,
            revision: 0,
            writerId: null,
        });
        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: 0,
                record,
                shareId: 'shr_legacy',
                writerId: 'writer-a',
            }),
            { status: 'written', revision: 1 }
        );
        assert.deepEqual(owner.readStoredFormProgressSnapshot('shr_legacy'), {
            record,
            revision: 1,
            writerId: 'writer-a',
        });
        assert.deepEqual(record, {
            fld_visible: 'Visible',
            fld_hidden: 'Keep this',
        });
    });

    it('does not treat a legacy revision as absent or remove another share', async () => {
        const { owner, local } = setup();
        local.setItem(makeFormProgressKey('shr_legacy'), '{}');
        local.setItem(makeFormProgressKey('shr_adjacent'), envelope());
        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: null,
                record: { fld_name: 'Stale edit' },
                shareId: 'shr_legacy',
                writerId: 'writer-b',
            }),
            { status: 'conflict' }
        );
        assert.equal(local.getItem(makeFormProgressKey('shr_legacy')), '{}');
        assert.equal(owner.removeStoredFormProgress('shr_legacy'), true);
        assert.equal(
            local.getItem(makeFormProgressKey('shr_adjacent')),
            envelope()
        );
    });

    for (const stored of [
        '{broken',
        'null',
        'true',
        '[]',
        '42',
        envelope({ schemaVersion: 2 }),
        envelope({ revision: 0 }),
        envelope({ revision: -1 }),
        envelope({ revision: 1.5 }),
        envelope({ revision: '1' }),
        envelope({ writerId: '' }),
        envelope({ writerId: null }),
        envelope({ record: null }),
        envelope({ record: [] }),
    ]) {
        it(`discards invalid progress without treating it as field data: ${stored}`, () => {
            const { owner, local } = setup();
            local.setItem(makeFormProgressKey('shr_invalid'), stored);
            local.setItem(makeFormProgressKey('shr_adjacent'), '{}');
            assert.equal(
                owner.readStoredFormProgress('shr_invalid'),
                undefined
            );
            assert.equal(
                local.getItem(makeFormProgressKey('shr_invalid')),
                null
            );
            assert.equal(
                local.getItem(makeFormProgressKey('shr_adjacent')),
                '{}'
            );
        });
    }

    it('preserves historical plain objects with a different kind as legacy drafts', () => {
        const record = { kind: 'A native field value', fld_count: 2 };
        assert.deepEqual(parseStoredFormProgressValue(JSON.stringify(record)), {
            record,
            revision: 0,
            writerId: null,
        });
    });

    it('keeps writer identities per share through session-storage denial and recovery', () => {
        let allowed = false;
        const session = new MemoryStorage();
        const { owner } = setup({
            getSessionStorage: () => {
                if (!allowed) throw new Error('Storage denied');
                return session;
            },
        });
        const first = owner.getFormProgressWriterId('shr_first');
        assert.equal(owner.getFormProgressWriterId('shr_first'), first);
        assert.notEqual(owner.getFormProgressWriterId('shr_second'), first);
        allowed = true;
        assert.equal(owner.getFormProgressWriterId('shr_first'), first);
        assert.equal(session.getItem('form-progress-writer-shr_first'), first);
        const freshOwner = createFormProgressStorage({
            getLocalStorage: () => undefined,
            getSessionStorage: () => session,
            createWriterId: () => 'must-not-replace-stored-identity',
        });
        assert.equal(freshOwner.getFormProgressWriterId('shr_first'), first);
    });

    it('retains the historical fallback identity when storing a new identity is denied', () => {
        const session = new MemoryStorage();
        const { owner } = setup({
            getSessionStorage: () => ({
                getItem: (key) => session.getItem(key),
                setItem: () => {
                    throw new Error('Session quota denied');
                },
                removeItem: (key) => session.removeItem(key),
            }),
        });
        // The original protocol allocates its fallback after the failed write.
        assert.equal(owner.getFormProgressWriterId('shr_quota'), 'writer-2');
        assert.equal(owner.getFormProgressWriterId('shr_quota'), 'writer-2');
    });

    it('keeps missing session storage optional and reuses one owner fallback', () => {
        const { owner } = setup({ getSessionStorage: () => undefined });
        assert.equal(owner.getFormProgressWriterId('shr_missing'), 'writer-1');
        assert.equal(owner.getFormProgressWriterId('shr_missing'), 'writer-1');
    });

    it('serializes overlapping writers and owned cleanup under the same share lock', async () => {
        const locks = new QueuedLocks();
        const release = locks.hold('form-progress-lock-shr_race');
        const { owner, local } = setup({ getLocks: () => locks });
        const otherOwner = setup({
            getLocalStorage: () => local,
            getLocks: () => locks,
        }).owner;
        const first = owner.writeStoredFormProgress({
            expectedRevision: null,
            record: { fld_name: 'First writer' },
            shareId: 'shr_race',
            writerId: 'writer-a',
        });
        const competing = otherOwner.writeStoredFormProgress({
            expectedRevision: null,
            record: { fld_name: 'Stale competing writer' },
            shareId: 'shr_race',
            writerId: 'writer-b',
        });
        const staleCleanup = otherOwner.removeStoredFormProgressIfOwned({
            shareId: 'shr_race',
            writerId: 'writer-b',
        });
        assert.equal(local.getItem(makeFormProgressKey('shr_race')), null);
        release();
        assert.deepEqual(await first, { status: 'written', revision: 1 });
        assert.deepEqual(await competing, { status: 'conflict' });
        assert.deepEqual(await staleCleanup, {
            status: 'preserved-newer-progress',
        });
        assert.deepEqual(owner.readStoredFormProgress('shr_race'), {
            fld_name: 'First writer',
        });
        assert.deepEqual(
            locks.names,
            Array(3).fill('form-progress-lock-shr_race')
        );
        assert.deepEqual(
            await otherOwner.writeStoredFormProgress({
                expectedRevision: 1,
                record: { fld_name: 'Accepted newer writer' },
                shareId: 'shr_race',
                writerId: 'writer-b',
            }),
            { status: 'written', revision: 2 }
        );
        assert.deepEqual(
            await owner.removeStoredFormProgressIfOwned({
                shareId: 'shr_race',
                writerId: 'writer-a',
            }),
            { status: 'preserved-newer-progress' }
        );
        assert.deepEqual(
            await otherOwner.removeStoredFormProgressIfOwned({
                shareId: 'shr_race',
                writerId: 'writer-b',
            }),
            { status: 'removed' }
        );
    });

    it('keeps no-lock revision checks and removes legacy or absent progress', async () => {
        const { owner, local } = setup();
        const input = {
            expectedRevision: null,
            record: { fld_name: 'Initial' },
            shareId: 'shr_no_locks',
            writerId: 'writer-a',
        };
        assert.deepEqual(await owner.writeStoredFormProgress(input), {
            status: 'written',
            revision: 1,
        });
        assert.deepEqual(await owner.writeStoredFormProgress(input), {
            status: 'conflict',
        });
        local.setItem(makeFormProgressKey('shr_legacy'), '{}');
        for (const shareId of ['shr_legacy', 'shr_absent']) {
            assert.deepEqual(
                await owner.removeStoredFormProgressIfOwned({
                    shareId,
                    writerId: 'writer-a',
                }),
                { status: 'removed' }
            );
            assert.equal(local.getItem(makeFormProgressKey(shareId)), null);
        }
    });

    it('does not run an unlocked write or cleanup after lock acquisition rejects', async () => {
        const { owner, local, unavailable } = setup({
            getLocks: () => ({
                request: async () => {
                    throw new Error('Lock denied');
                },
            }),
        });
        local.setItem(makeFormProgressKey('shr_lock_denied'), envelope());
        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: 1,
                record: { fld_name: 'Rejected' },
                shareId: 'shr_lock_denied',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.deepEqual(
            await owner.removeStoredFormProgressIfOwned({
                shareId: 'shr_lock_denied',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.equal(
            local.getItem(makeFormProgressKey('shr_lock_denied')),
            envelope()
        );
        assert.deepEqual(unavailable, ['write', 'remove']);
    });

    it('contains denied storage operations without forwarding private data or errors', async () => {
        const { owner, unavailable } = setup({
            getLocalStorage: () => {
                throw new Error('private browser detail');
            },
        });
        assert.equal(owner.readStoredFormProgress('shr_denied'), undefined);
        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: null,
                record: { fld_private: 'Private draft' },
                shareId: 'shr_denied',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.deepEqual(
            await owner.removeStoredFormProgressIfOwned({
                shareId: 'shr_denied',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.deepEqual(unavailable, [
            'read',
            'read',
            'write',
            'read',
            'remove',
        ]);
    });

    it('preserves revision-only comparison when a browser read fails independently', async () => {
        const local = new MemoryStorage();
        const { owner, unavailable } = setup({
            getLocalStorage: () => ({
                getItem: () => {
                    throw new Error('Read denied');
                },
                setItem: (key, value) => local.setItem(key, value),
                removeItem: (key) => local.removeItem(key),
            }),
        });
        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: null,
                record: { fld_name: 'Historical behavior' },
                shareId: 'shr_read_denied',
                writerId: 'writer-a',
            }),
            { status: 'written', revision: 1 }
        );
        assert.deepEqual(unavailable, ['read']);
        assert.equal(
            parseStoredFormProgressValue(
                local.getItem(makeFormProgressKey('shr_read_denied'))
            )?.revision,
            1
        );
    });

    it('contains quota and native-value serialization failure without replacing existing progress', async () => {
        const local = new MemoryStorage();
        local.setItem(makeFormProgressKey('shr_quota'), envelope());
        const { owner, unavailable } = setup({
            getLocalStorage: () => ({
                getItem: (key) => local.getItem(key),
                setItem: () => {
                    throw new Error('Quota exceeded');
                },
                removeItem: (key) => local.removeItem(key),
            }),
        });
        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: 1,
                record: { fld_name: 'Cannot replace' },
                shareId: 'shr_quota',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.equal(
            local.getItem(makeFormProgressKey('shr_quota')),
            envelope()
        );
        assert.deepEqual(unavailable, ['write']);
        const healthy = setup();
        const record = {
            fld_value: {
                specialValue: 'NaN' as const,
                toJSON() {
                    throw new Error('Private serialization failure');
                },
            },
        };
        assert.deepEqual(
            await healthy.owner.writeStoredFormProgress({
                expectedRevision: null,
                record,
                shareId: 'shr_serialization',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.equal(
            healthy.local.getItem(makeFormProgressKey('shr_serialization')),
            null
        );
        assert.deepEqual(healthy.unavailable, ['write']);
    });

    it('serializes only the record and local concurrency metadata, never caller credentials', async () => {
        const { owner, local } = setup();
        const input = {
            expectedRevision: null,
            record: { fld_name: 'Chosen draft only' },
            shareId: 'shr_private',
            writerId: 'writer-a',
            extensionAccessToken: 'synthetic-access-credential',
            session: { login: 'synthetic-login-credential' },
        };
        await owner.writeStoredFormProgress(input);
        assert.deepEqual(
            JSON.parse(local.getItem(makeFormProgressKey('shr_private'))!),
            {
                kind: 'miniExtensions-form-progress',
                schemaVersion: 1,
                revision: 1,
                writerId: 'writer-a',
                record: input.record,
            }
        );
    });
});
