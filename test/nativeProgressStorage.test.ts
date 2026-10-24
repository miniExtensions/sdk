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
