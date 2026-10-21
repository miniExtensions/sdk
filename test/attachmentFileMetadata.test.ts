import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as forms from '../src/forms/index.js';

it('offers metadata admission without fabricating a loaded Form or upload owner', () => {
    const check = forms.checkAttachmentFileMetadata;
    assert.equal(typeof check, 'function');
    const files = Object.freeze([
        Object.freeze({ type: 'IMAGE/PNG; charset=binary', size: 4 }),
        Object.freeze({ type: 'text/plain', size: 99 }),
        Object.freeze({ type: 'image/png', size: 5 }),
        Object.freeze({ type: 'image/png', size: 4 }),
    ]);
    const policy = Object.freeze({
        currentCount: 1,
        maxFiles: 3,
        maxFileBytes: 4,
        allowedTypes: ['images'] as const,
    });
    assert.deepEqual(check({ ...policy, files }), {
        acceptedIndexes: [0, 3],
        rejected: [
            { index: 1, reason: 'type' },
            { index: 2, reason: 'size' },
        ],
        batchError: null,
    });
    assert.deepEqual(check({ ...policy, files, maxFiles: 2 }), {
        acceptedIndexes: [],
        rejected: [
            { index: 1, reason: 'type' },
            { index: 2, reason: 'size' },
        ],
        batchError: 'count',
    });
    assert.equal(
        check({ ...policy, files, maxFiles: Number.MAX_VALUE }).batchError,
        null
    );
    assert.equal(files.length, 4);
    assert.equal(policy.maxFiles, 3);
});

it('keeps empty, overfull, unlimited and zero-byte boundaries separate', () => {
    const check = forms.checkAttachmentFileMetadata;
    assert.equal(typeof check, 'function');
    const base = {
        files: [],
        currentCount: 2,
        maxFiles: 1,
        maxFileBytes: null,
        allowedTypes: null,
    };
    assert.deepEqual(check(base), {
        acceptedIndexes: [],
        rejected: [],
        batchError: 'count',
    });
    assert.deepEqual(check({ ...base, currentCount: 1 }), {
        acceptedIndexes: [],
        rejected: [],
        batchError: null,
    });
    assert.deepEqual(
        check({
            ...base,
            maxFiles: null,
            files: [
                { type: '', size: 0 },
                { type: 'application/octet-stream', size: 1 },
            ],
        }),
        { acceptedIndexes: [0, 1], rejected: [], batchError: null }
    );
    assert.deepEqual(
        check({
            ...base,
            currentCount: 0,
            maxFiles: null,
            maxFileBytes: 0,
            files: [
                { type: '', size: 0 },
                { type: '', size: 1 },
            ],
        }),
        {
            acceptedIndexes: [0],
            rejected: [{ index: 1, reason: 'size' }],
            batchError: null,
        }
    );
});

it('retains normalized metadata limits including an overflowed unlimited-size product', () => {
    const check = forms.checkAttachmentFileMetadata;
    assert.equal(typeof check, 'function');
    for (const configured of [
        undefined,
        null,
        0,
        -1,
        NaN,
        Infinity,
        0.000005,
        Number.MAX_VALUE,
    ]) {
        const size = forms.getEffectiveAttachmentSizeLimit(configured);
        for (const bytes of [0, 1, 5, 6, 1048576, Number.MAX_SAFE_INTEGER]) {
            const result = check({
                files: [{ type: 'text/plain', size: bytes }],
                currentCount: 0,
                maxFiles: null,
                maxFileBytes: size == null ? null : size * 1048576,
                allowedTypes: null,
            });
            assert.equal(
                result.acceptedIndexes.length === 1,
                size == null || bytes / 1048576 <= size
            );
        }
    }
});

it('rejects malformed descriptors with the existing Form error contract', () => {
    const check = Reflect.get(forms, 'checkAttachmentFileMetadata');
    assert.equal(typeof check, 'function');
    for (const files of [
        null,
        [null],
        [{ type: 1, size: 0 }],
        [{ type: '', size: -1 }],
        [{ type: '', size: NaN }],
        [{ type: '', size: Infinity }],
    ]) {
        assert.throws(
            () =>
                Reflect.apply(check, undefined, [
                    {
                        files,
                        currentCount: 0,
                        maxFiles: null,
                        maxFileBytes: null,
                        allowedTypes: null,
                    },
                ]),
            {
                name: 'TypeError',
                message:
                    'Expected string MIME types and finite nonnegative sizes.',
            }
        );
    }
});

it('does not accept malformed normalized policy metadata', () => {
    const check = Reflect.get(forms, 'checkAttachmentFileMetadata');
    assert.equal(typeof check, 'function');
    const base = {
        files: [],
        currentCount: 0,
        maxFiles: null,
        maxFileBytes: null,
        allowedTypes: null,
    };
    for (const patch of [
        { currentCount: -1 },
        { currentCount: NaN },
        { currentCount: 0.5 },
        { maxFiles: Infinity },
        { maxFiles: -1 },
        { maxFileBytes: NaN },
        { maxFileBytes: -1 },
        { allowedTypes: ['not-a-group'] },
    ]) {
        assert.throws(
            () => Reflect.apply(check, undefined, [{ ...base, ...patch }]),
            {
                name: 'TypeError',
                message: 'Expected normalized attachment metadata limits.',
            }
        );
    }
});
