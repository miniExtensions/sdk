import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    isAttachmentUploadUrlCompatible,
    getAttachmentFilenameFromUrl,
    getUploadProgressWeight,
    getAggregateUploadProgress,
} from '../src/ui/attachmentInputCompatibility.js';

it('preserves hosted HTTP(S) syntax admission without accepting relative or non-HTTP inputs', () => {
    for (const value of [
        'http://fixture.invalid/file',
        'https://fixture.invalid/file?x=1#part',
    ])
        assert.equal(isAttachmentUploadUrlCompatible(value), true);
    for (const value of [
        '',
        '/file',
        'not a URL',
        'data:text/plain,file',
        'file:///tmp/file',
        'ftp://fixture.invalid/file',
    ])
        assert.equal(isAttachmentUploadUrlCompatible(value), false);
});

it('preserves filename path bytes, one decoding pass and hostname fallback', () => {
    const cases = [
        ['https://fixture.invalid/', 'fixture.invalid'],
        ['https://fixture.invalid/folder/?name=ignored', 'fixture.invalid'],
        ['https://fixture.invalid/a%20b.pdf?name=ignored#part', 'a b.pdf'],
        ['https://fixture.invalid/a%2520b', 'a%20b'],
        ['https://fixture.invalid/%E0%A4%A', '%E0%A4%A'],
        ['https://fixture.invalid/%2F', '/'],
        ['https://fixture.invalid/%F0%9F%98%80.txt', '😀.txt'],
    ];
    for (const [url, expected] of cases)
        assert.equal(getAttachmentFilenameFromUrl(url!), expected);
    assert.throws(() => getAttachmentFilenameFromUrl('relative'), TypeError);
});

it('gives zero-byte files a nonzero progress weight and retains numeric compatibility', () => {
    assert.equal(getUploadProgressWeight(0), 1);
    assert.equal(getUploadProgressWeight(-1), 1);
    assert.equal(getUploadProgressWeight(5), 5);
    assert.equal(getUploadProgressWeight(Infinity), Infinity);
    assert.equal(Number.isNaN(getUploadProgressWeight(NaN)), true);
});

it('weights ordered batches, clamps partial progress and retains empty-batch completion', () => {
    const progress = (
        completed: number,
        current: number,
        size: number,
        total: number
    ) =>
        getAggregateUploadProgress({
            completedUploadWeight: completed,
            currentFileUploadedWeight: current,
            currentFileTotalWeight: size,
            totalUploadWeight: total,
        });
    assert.equal(progress(0, 0, 0, 0), 100);
    assert.equal(progress(1, 1, 1, 2), 100);
    assert.equal(progress(0, 10, 1, 100), 1);
    assert.equal(progress(25, 50, 50, 100), 75);
    assert.equal(progress(-25, -50, 50, 100), 0);
    assert.equal(progress(150, 50, 50, 100), 100);
    assert.equal(progress(0, 1, 3, 3), 33);
    assert.equal(Number.isNaN(progress(NaN, 0, 1, 2)), true);
});
