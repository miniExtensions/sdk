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
        it(`ignores invalid progress without modifying storage: ${stored}`, () => {
            const { owner, local } = setup();
            local.setItem(makeFormProgressKey('shr_invalid'), stored);
            local.setItem(makeFormProgressKey('shr_adjacent'), '{}');
            assert.equal(
                owner.readStoredFormProgress('shr_invalid'),
                undefined
            );
            assert.equal(
                local.getItem(makeFormProgressKey('shr_invalid')),
                stored
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

    it('replaces an empty session writer identity with a restorable draft owner', async () => {
        const { owner, session } = setup();
        const shareId = 'shr_empty_session_writer';
        const writerKey = `form-progress-writer-${shareId}`;
        const record = { fld_name: 'Draft with a recovered writer' };
        session.setItem(writerKey, '');

        const writerId = owner.getFormProgressWriterId(shareId);
        assert.equal(writerId, 'writer-1');
        assert.equal(session.getItem(writerKey), writerId);
        assert.equal(owner.getFormProgressWriterId(shareId), writerId);
        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: null,
                record,
                shareId,
                writerId,
            }),
            { status: 'written', revision: 1 }
        );
        assert.deepEqual(owner.readStoredFormProgressSnapshot(shareId), {
            record,
            revision: 1,
            writerId,
        });
    });

    it('refuses an empty explicit writer identity before resolving any browser capability', async () => {
        let accesses = 0;
        const unavailable: string[] = [];
        const denied = () => {
            accesses++;
            throw new Error('Browser capability must not be resolved');
        };
        const owner = createFormProgressStorage({
            getLocalStorage: denied,
            getSessionStorage: denied,
            getLocks: denied,
            createWriterId: denied,
            onUnavailable: (operation) => unavailable.push(operation),
        });

        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: null,
                record: { fld_name: 'Must not become an unreadable draft' },
                shareId: 'shr_empty_explicit_writer',
                writerId: '',
            }),
            { status: 'unavailable' }
        );
        assert.equal(accesses, 0);
        assert.deepEqual(unavailable, ['write']);
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

    it('keeps a queued write on its original share, writer, revision and native record reference', async () => {
        const shareId = 'shr_queued_write';
        const adjacentShareId = 'shr_queued_write_adjacent';
        const locks = new QueuedLocks();
        const release = locks.hold(`form-progress-lock-${shareId}`);
        const record = { fld_name: 'Chosen draft', fld_hidden: 'Keep hidden' };
        const args = {
            expectedRevision: 3,
            record,
            shareId,
            writerId: 'writer-a',
        };
        const { owner, local } = setup({
            getLocks: () => {
                args.expectedRevision = 900;
                return locks;
            },
        });
        const original = envelope({ revision: 3 });
        const adjacent = envelope({ revision: 8, writerId: 'writer-b' });
        local.setItem(makeFormProgressKey(shareId), original);
        local.setItem(makeFormProgressKey(adjacentShareId), adjacent);

        const pending = owner.writeStoredFormProgress(args);
        assert.deepEqual(locks.names, [`form-progress-lock-${shareId}`]);
        assert.equal(local.getItem(makeFormProgressKey(shareId)), original);
        args.shareId = adjacentShareId;
        args.writerId = '';
        args.expectedRevision = 8;
        args.record = { fld_name: 'Redirected draft', fld_hidden: 'Wrong' };
        record.fld_name = 'Updated chosen native reference';
        release();

        assert.deepEqual(await pending, { status: 'written', revision: 4 });
        assert.deepEqual(owner.readStoredFormProgressSnapshot(shareId), {
            record,
            revision: 4,
            writerId: 'writer-a',
        });
        assert.equal(
            local.getItem(makeFormProgressKey(adjacentShareId)),
            adjacent
        );
        assert.deepEqual(args.record, {
            fld_name: 'Redirected draft',
            fld_hidden: 'Wrong',
        });
    });

    it('keeps queued owned cleanup on its original share and writer', async () => {
        const shareId = 'shr_queued_cleanup';
        const adjacentShareId = 'shr_queued_cleanup_adjacent';
        const locks = new QueuedLocks();
        const release = locks.hold(`form-progress-lock-${shareId}`);
        const args = { shareId, writerId: 'writer-a' };
        const { owner, local } = setup({
            getLocks: () => {
                args.writerId = 'writer-b';
                return locks;
            },
        });
        const original = envelope();
        const adjacent = envelope({ writerId: 'writer-b' });
        local.setItem(makeFormProgressKey(shareId), original);
        local.setItem(makeFormProgressKey(adjacentShareId), adjacent);

        const pending = owner.removeStoredFormProgressIfOwned(args);
        assert.deepEqual(locks.names, [`form-progress-lock-${shareId}`]);
        assert.equal(local.getItem(makeFormProgressKey(shareId)), original);
        args.shareId = adjacentShareId;
        args.writerId = 'writer-b';
        release();

        assert.deepEqual(await pending, { status: 'removed' });
        assert.equal(local.getItem(makeFormProgressKey(shareId)), null);
        assert.equal(
            local.getItem(makeFormProgressKey(adjacentShareId)),
            adjacent
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
        assert.deepEqual(unavailable, ['read', 'write', 'remove']);
    });

    it('returns unavailable when a failed browser read cannot establish the current revision', async () => {
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
                record: { fld_name: 'Unverified absence' },
                shareId: 'shr_read_denied',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.deepEqual(unavailable, ['write']);
        assert.equal(
            parseStoredFormProgressValue(
                local.getItem(makeFormProgressKey('shr_read_denied'))
            )?.revision,
            undefined
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

describe('Form progress storage review regressions', () => {
    it('uses one local adapter for a locked compare-and-swap operation', async () => {
        const first = new MemoryStorage();
        const second = new MemoryStorage();
        const key = makeFormProgressKey('shr_adapter_cas');
        first.setItem(key, envelope({ record: { fld_name: 'First adapter' } }));
        const foreignProgress = envelope({
            revision: 6,
            writerId: 'writer-b',
            record: { fld_name: 'Second adapter foreign draft' },
        });
        second.setItem(key, foreignProgress);
        let adapterResolutions = 0;
        const locks = new QueuedLocks();
        const { owner } = setup({
            getLocalStorage: () =>
                ++adapterResolutions === 1 ? first : second,
            getLocks: () => locks,
        });

        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: 1,
                record: { fld_name: 'Accepted edit' },
                shareId: 'shr_adapter_cas',
                writerId: 'writer-a',
            }),
            { status: 'written', revision: 2 }
        );
        assert.equal(second.getItem(key), foreignProgress);
        assert.deepEqual(parseStoredFormProgressValue(first.getItem(key)), {
            record: { fld_name: 'Accepted edit' },
            revision: 2,
            writerId: 'writer-a',
        });
        assert.equal(adapterResolutions, 1);
        assert.deepEqual(locks.names, ['form-progress-lock-shr_adapter_cas']);
    });

    it('preserves foreign progress when owned cleanup cannot read its owner', async () => {
        const local = new MemoryStorage();
        const key = makeFormProgressKey('shr_cleanup_denied');
        const foreignProgress = envelope({
            writerId: 'writer-b',
            record: { fld_name: 'Foreign draft remains' },
        });
        local.setItem(key, foreignProgress);
        let removals = 0;
        const locks = new QueuedLocks();
        const { owner, unavailable } = setup({
            getLocalStorage: () => ({
                getItem: () => {
                    throw new Error('Read denied');
                },
                setItem: (itemKey, value) => local.setItem(itemKey, value),
                removeItem: (itemKey) => {
                    removals++;
                    local.removeItem(itemKey);
                },
            }),
            getLocks: () => locks,
        });

        assert.deepEqual(
            await owner.removeStoredFormProgressIfOwned({
                shareId: 'shr_cleanup_denied',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.equal(local.getItem(key), foreignProgress);
        assert.equal(removals, 0);
        assert.ok(unavailable.length > 0);
        assert.deepEqual(unavailable, ['remove']);
    });

    it('rejects unsafe integer revisions as invalid concurrency metadata', () => {
        for (const revision of [
            Number.MAX_SAFE_INTEGER + 1,
            Number.MAX_SAFE_INTEGER + 2,
            1e30,
        ]) {
            assert.equal(
                parseStoredFormProgressValue(envelope({ revision })),
                undefined,
                `Unsafe revision ${revision} must not become a snapshot`
            );
        }
    });

    it('does not overwrite foreign progress when a compare-and-swap read fails', async () => {
        const local = new MemoryStorage();
        const key = makeFormProgressKey('shr_write_denied');
        const foreignProgress = envelope({
            writerId: 'writer-b',
            record: { fld_name: 'Foreign draft remains' },
        });
        local.setItem(key, foreignProgress);
        let writes = 0;
        const locks = new QueuedLocks();
        const { owner, unavailable } = setup({
            getLocalStorage: () => ({
                getItem: () => {
                    throw new Error('Read denied');
                },
                setItem: (itemKey, value) => {
                    writes++;
                    local.setItem(itemKey, value);
                },
                removeItem: (itemKey) => local.removeItem(itemKey),
            }),
            getLocks: () => locks,
        });

        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: null,
                record: { fld_name: 'Cannot establish absence' },
                shareId: 'shr_write_denied',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.equal(local.getItem(key), foreignProgress);
        assert.equal(writes, 0);
        assert.deepEqual(unavailable, ['write']);
    });

    it('uses one session adapter when assigning a writer identity', () => {
        const first = new MemoryStorage();
        const second = new MemoryStorage();
        const key = 'form-progress-writer-shr_session_adapter';
        second.setItem(key, 'writer-b');
        let adapterResolutions = 0;
        const { owner } = setup({
            getSessionStorage: () =>
                ++adapterResolutions === 1 ? first : second,
        });

        assert.equal(
            owner.getFormProgressWriterId('shr_session_adapter'),
            'writer-1'
        );
        assert.equal(first.getItem(key), 'writer-1');
        assert.equal(second.getItem(key), 'writer-b');
        assert.equal(adapterResolutions, 1);
    });

    it('does not advance a valid revision beyond the safe integer range', async () => {
        const { owner, local } = setup();
        const key = makeFormProgressKey('shr_revision_exhausted');
        const progress = envelope({ revision: Number.MAX_SAFE_INTEGER });
        local.setItem(key, progress);

        assert.deepEqual(
            await owner.writeStoredFormProgress({
                expectedRevision: Number.MAX_SAFE_INTEGER,
                record: { fld_name: 'Cannot safely advance' },
                shareId: 'shr_revision_exhausted',
                writerId: 'writer-a',
            }),
            { status: 'unavailable' }
        );
        assert.equal(local.getItem(key), progress);
    });

    it('does not let a stale invalid read remove a newer draft written under the share lock', async () => {
        const local = new MemoryStorage();
        const key = makeFormProgressKey('shr_invalid_read_race');
        local.setItem(key, '{broken');
        const locks: FormProgressLockManager = {
            request: async (_name, callback) => callback(),
        };
        const newerOwner = setup({
            getLocalStorage: () => local,
            getLocks: () => locks,
        }).owner;
        let acceptedWrite:
            | ReturnType<typeof newerOwner.writeStoredFormProgress>
            | undefined;
        let removals = 0;
        const staleOwner = setup({
            getLocalStorage: () => ({
                getItem: (itemKey) => {
                    const staleValue = local.getItem(itemKey);
                    // Deterministic second-context handoff: return the bytes
                    // captured before the cooperating writer acquired its lock.
                    acceptedWrite = newerOwner.writeStoredFormProgress({
                        expectedRevision: null,
                        record: { fld_name: 'Newer valid draft' },
                        shareId: 'shr_invalid_read_race',
                        writerId: 'writer-b',
                    });
                    return staleValue;
                },
                setItem: (itemKey, value) => local.setItem(itemKey, value),
                removeItem: (itemKey) => {
                    removals++;
                    local.removeItem(itemKey);
                },
            }),
            getLocks: () => locks,
        }).owner;

        assert.equal(
            staleOwner.readStoredFormProgressSnapshot('shr_invalid_read_race'),
            undefined
        );
        assert.ok(acceptedWrite);
        assert.deepEqual(await acceptedWrite, {
            status: 'written',
            revision: 1,
        });
        assert.equal(removals, 0);
        assert.deepEqual(parseStoredFormProgressValue(local.getItem(key)), {
            record: { fld_name: 'Newer valid draft' },
            revision: 1,
            writerId: 'writer-b',
        });
    });
});
