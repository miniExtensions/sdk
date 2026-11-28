import assert from 'node:assert/strict';
import { it } from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as forms from '../src/forms/index.js';

it('preserves pinned native rich storage, revision/writer, events, locks and failure behavior', async () => {
    const { assertNativeFormProgressParity } = await import(
        pathToFileURL(
            resolve('scripts/native-form-progress-consumer-checks.mjs')
        ).href
    );
    assert.equal(await assertNativeFormProgressParity(forms), 62);
});

it('keeps native warnings and construction free of ambient storage access', () => {
    let accesses = 0;
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => warnings.push(message);
    try {
        const storage = forms.createNativeFormProgressStorage({
            shareId: 'synthetic',
            writerId: 'writer',
            getStorage: () => {
                accesses++;
                throw Error('synthetic unavailable');
            },
        });
        assert.equal(accesses, 0);
        assert.equal(storage.read(), undefined);
        assert.equal(storage.remove(), false);
        assert.deepEqual(warnings, [
            'Unable to read browser-local Form progress; continuing without it.',
            'Unable to remove browser-local Form progress; continuing without it.',
        ]);
    } finally {
        console.warn = original;
    }
});

it('parity assertions reject stricter no-lock writes and unconditional owned cleanup', async () => {
    const { assertNativeFormProgressParity } = await import(
        pathToFileURL(
            resolve('scripts/native-form-progress-consumer-checks.mjs')
        ).href
    );
    await assert.rejects(
        assertNativeFormProgressParity({
            ...forms,
            createNativeFormProgressStorage: (
                options: forms.NativeFormProgressStorageOptions
            ) => ({
                ...forms.createNativeFormProgressStorage(options),
                write: async (): Promise<forms.NativeFormProgressWriteResult> => ({
                    status: 'unavailable',
                }),
            }),
        }),
        { code: 'ERR_ASSERTION' }
    );
    await assert.rejects(
        assertNativeFormProgressParity({
            ...forms,
            createNativeFormProgressStorage: (
                options: forms.NativeFormProgressStorageOptions
            ) => {
                const original = forms.createNativeFormProgressStorage(options);
                return {
                    ...original,
                    removeIfOwned:
                        async (): Promise<forms.NativeFormProgressRemovalResult> => {
                            original.remove();
                            return { status: 'removed' };
                        },
                };
            },
        }),
        { code: 'ERR_ASSERTION' }
    );
});

it('matches PR7699 post-lock eligibility and no-lock/error behavior', async () => {
    const { assertNativeFormProgressEligibilityParity } = await import(
        pathToFileURL(
            resolve('scripts/native-form-progress-eligibility-checks.mjs')
        ).href
    );
    assert.equal(await assertNativeFormProgressEligibilityParity(forms), 12);
});

it('uses the guard captured once inside the lock for admission and read failure', async () => {
    const operations: string[] = [];
    let guardReads = 0;
    const args = {
        expectedRevision: null,
        record: {},
        get isWriteStillEligible() {
            operations.push('guard access');
            return ++guardReads === 1
                ? function (this: unknown) {
                      operations.push(
                          this === args ? 'guard' : 'wrong receiver'
                      );
                      return true;
                  }
                : undefined;
        },
    };
    const storage = forms.createNativeFormProgressStorage({
        shareId: 'synthetic',
        writerId: 'writer',
        getStorage: () => ({
            getItem() {
                operations.push('read');
                throw Error('synthetic unavailable');
            },
            setItem() {
                operations.push('write');
            },
            removeItem() {
                operations.push('remove');
            },
        }),
        getLocks: () => ({
            async request(_name, callback) {
                await Promise.resolve();
                operations.push('lock');
                return callback();
            },
        }),
        onWarning(operation) {
            operations.push('warn:' + operation);
        },
    });
    const result = storage.write(args);
    assert.equal(operations.length, 0);
    assert.deepEqual(await result, { status: 'unavailable' });
    assert.deepEqual(operations, [
        'lock',
        'guard access',
        'guard',
        'read',
        'warn:read',
    ]);

    operations.length = 0;
    const cancelGuard = Object.assign(
        () => {
            operations.push('cancel guard');
            return false;
        },
        { call: () => true }
    );
    const cancelled = storage.write({
        expectedRevision: null,
        record: {},
        isWriteStillEligible: cancelGuard,
    });
    assert.equal(operations.length, 0);
    const outcome = await cancelled;
    assert.deepEqual(operations, ['lock', 'cancel guard']);
    assert.deepEqual(outcome, { status: 'cancelled' });

    operations.length = 0;
    assert.deepEqual(
        await storage.write({
            expectedRevision: null,
            expectedWriterId: null,
            record: {},
        }),
        { status: 'unavailable' }
    );
    assert.deepEqual(operations, ['lock', 'read', 'warn:read']);
});
