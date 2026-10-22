import assert from 'node:assert/strict';
import { File as NodeFile } from 'node:buffer';
import { test } from 'node:test';
import {
    iterateOrderedAttachmentUploads,
    type OrderedAttachmentUploadOptions,
} from '../src/ui/orderedAttachmentUploads.js';
const file = () =>
    new NodeFile(['synthetic'], 'same.txt', {
        type: 'text/plain',
    }) as unknown as File;
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
};

test('native duplicate File occurrences, result identity and caller progress order remain exact', async () => {
    const same = file(),
        other = file();
    const input = Object.freeze([same, same, other]);
    const calls: Array<[File, number]> = [],
        accepted: object[] = [],
        progress: number[] = [];
    let reads = 0;
    const values = [0, 1, 2].map(() =>
        Object.defineProperty({}, 'url', {
            get() {
                reads++;
                throw Error('opaque native data');
            },
        })
    );
    for await (const entry of iterateOrderedAttachmentUploads({
        files: input,
        shouldContinue: () => true,
        upload: async (selected, index) => {
            calls.push([selected, index]);
            return values[index];
        },
    })) {
        accepted.push(entry.attachment);
        progress.push(entry.index);
        assert.equal(entry.file, input[entry.index]);
    }
    assert.deepEqual(progress, [0, 1, 2]);
    assert.equal(calls[0][0], same);
    assert.equal(calls[1][0], same);
    assert.equal(calls[2][0], other);
    assert.equal(accepted[0], values[0]);
    assert.equal(accepted[1], values[1]);
    assert.equal(accepted[2], values[2]);
    assert.equal(reads, 0);
});

test('closing while next is allocated preserves that exact completion and allocates no next file', async () => {
    const held = deferred<object>();
    const native = file(),
        returned = {};
    let allocations = 0;
    const iterator = iterateOrderedAttachmentUploads({
        files: [native, file()],
        shouldContinue: () => true,
        upload: async () => {
            allocations++;
            return held.promise;
        },
    });
    const first = iterator.next();
    const closing = iterator.return(undefined);
    assert.equal(allocations, 1);
    held.resolve(returned);
    const accepted = await first;
    assert.equal(accepted.done, false);
    if (accepted.done) assert.fail('Expected allocated result');
    assert.equal(accepted.value.file, native);
    assert.equal(accepted.value.attachment, returned);
    assert.equal((await closing).done, true);
    assert.equal((await iterator.next()).done, true);
    assert.equal(allocations, 1);
});

for (const error of [new Error('synthetic canceled upload'), null, undefined]) {
    test(`the host keeps completed prefix and native ${String(error)} when a later upload rejects`, async () => {
        const first = {};
        const completed: object[] = [];
        let calls = 0,
            caught = false;
        try {
            for await (const entry of iterateOrderedAttachmentUploads({
                files: [file(), file(), file()],
                shouldContinue: () => true,
                upload: async () => {
                    if (++calls === 2) throw error;
                    return first;
                },
            }))
                completed.push(entry.attachment);
        } catch (observed) {
            caught = true;
            assert.equal(observed, error);
        }
        assert.equal(caught, true);
        assert.equal(completed.length, 1);
        assert.equal(completed[0], first);
        assert.equal(calls, 2);
    });
}

test('the existing cancellation flag stops before the next file without dropping an allocated success', async () => {
    const held = deferred<object>(),
        completed: object[] = [];
    const first = {};
    let continueBatch = true,
        calls = 0;
    const collecting = (async () => {
        for await (const entry of iterateOrderedAttachmentUploads({
            files: [file(), file()],
            shouldContinue: () => continueBatch,
            upload: async () => {
                calls++;
                return held.promise;
            },
        }))
            completed.push(entry.attachment);
    })();
    continueBatch = false;
    held.resolve(first);
    await collecting;
    assert.equal(calls, 1);
    assert.equal(completed[0], first);
});

test('a caller progress exception retains its pushed file and closes before another allocation', async () => {
    const completed: object[] = [],
        first = {},
        failure = new Error('caller presentation failed');
    let calls = 0;
    try {
        for await (const entry of iterateOrderedAttachmentUploads({
            files: [file(), file()],
            shouldContinue: () => true,
            upload: async () => {
                calls++;
                return first;
            },
        })) {
            completed.push(entry.attachment);
            throw failure;
        }
        assert.fail('Expected caller failure');
    } catch (error) {
        assert.equal(error, failure);
    }
    assert.equal(completed[0], first);
    assert.equal(calls, 1);
});

test('empty or initially stopped input invokes no upload and performs no native write', async () => {
    let uploads = 0,
        writes = 0;
    for (const files of [[], [file()]]) {
        for await (const _entry of iterateOrderedAttachmentUploads({
            files,
            shouldContinue: () => false,
            upload: async () => {
                uploads++;
                return {};
            },
        }))
            writes++;
    }
    assert.equal(uploads, 0);
    assert.equal(writes, 0);
});

test('new allocations remain demand-driven after the current result settles', async () => {
    const held = deferred<object>(),
        first = {},
        second = {};
    let calls = 0;
    const iterator = iterateOrderedAttachmentUploads({
        files: [file(), file()],
        shouldContinue: () => true,
        upload: () => (++calls === 1 ? held.promise : Promise.resolve(second)),
    });
    assert.equal(calls, 0);
    const pending = iterator.next();
    assert.equal(calls, 1);
    held.resolve(first);
    const accepted = await pending;
    assert.equal(accepted.done, false);
    if (accepted.done) assert.fail('Expected first result');
    assert.equal(accepted.value.attachment, first);
    await Promise.resolve();
    assert.equal(calls, 1);
    const next = await iterator.next();
    assert.equal(next.done, false);
    if (next.done) assert.fail('Expected second result');
    assert.equal(next.value.attachment, second);
    assert.equal(calls, 2);
    assert.equal((await iterator.next()).done, true);
});

test('closing an unstarted iterator invokes no callback', async () => {
    let calls = 0;
    const iterator = iterateOrderedAttachmentUploads({
        files: [file()],
        shouldContinue: () => {
            calls++;
            return true;
        },
        upload: async () => {
            calls++;
            return {};
        },
    });
    assert.equal((await iterator.return(undefined)).done, true);
    assert.equal((await iterator.next()).done, true);
    assert.equal(calls, 0);
});

test('a stop callback exception preserves the caller prefix and allocates no next file', async () => {
    const first = {},
        completed: object[] = [],
        failure = new Error('stop read failed');
    let reads = 0,
        calls = 0,
        caught = false;
    try {
        for await (const entry of iterateOrderedAttachmentUploads({
            files: [file(), file()],
            shouldContinue: () => {
                if (++reads === 2) throw failure;
                return true;
            },
            upload: async () => {
                calls++;
                return first;
            },
        }))
            completed.push(entry.attachment);
    } catch (error) {
        caught = true;
        assert.equal(error, failure);
    }
    assert.equal(caught, true);
    assert.equal(completed[0], first);
    assert.equal(calls, 1);
});

test('synchronous upload failure propagates unchanged without allocating a successor', async () => {
    const failure = new Error('synchronous host failure');
    let calls = 0;
    const iterator = iterateOrderedAttachmentUploads({
        files: [file(), file()],
        shouldContinue: () => true,
        upload: () => {
            calls++;
            throw failure;
        },
    });
    await assert.rejects(iterator.next(), (error) => error === failure);
    assert.equal((await iterator.next()).done, true);
    assert.equal(calls, 1);
});

test('option methods retain their receiver while preserving native return identity', async () => {
    const native = file();
    const options: OrderedAttachmentUploadOptions<File> = {
        files: [native],
        shouldContinue() {
            assert.equal(this, options);
            return true;
        },
        async upload(selected, index) {
            assert.equal(this, options);
            assert.equal(this.files[index], selected);
            return selected;
        },
    };
    const iterator = iterateOrderedAttachmentUploads(options);
    const result = await iterator.next();
    assert.equal(result.done, false);
    if (result.done) assert.fail('Expected native result');
    assert.equal(result.value.attachment, native);
    assert.equal((await iterator.next()).done, true);
});
