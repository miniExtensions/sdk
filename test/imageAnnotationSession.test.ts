import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    buildAnnotatedImageFilename,
    createImageAnnotationSession,
    type AnnotatedImage,
    type ImageAnnotationAppend,
    type ImageAnnotationFailure,
    type ImageAnnotationStorage,
} from '../src/react/imageAnnotationSession.js';

function deferred<T>() {
    let resolve: (value: T) => void = () => { throw new Error('not initialized'); };
    let reject: (error: unknown) => void = () => { throw new Error('not initialized'); };
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function fixture() {
    const ownerToken = {};
    let current = true;
    let value: AnnotatedImage[] = [];
    const upload = deferred<{ temporary: true }>();
    const url = deferred<string>();
    const uploads: Array<Parameters<ImageAnnotationStorage<{ temporary: true }>['createTemporaryPng']>[0]> = [];
    const reads: Array<{ temporary: true }> = [];
    const appended: Array<Parameters<ImageAnnotationAppend>[0]> = [];
    const operations = new WeakSet<object>();
    const released: string[] = [];
    const closed: object[] = [];
    const saving: boolean[] = [];
    const failures: ImageAnnotationFailure[] = [];
    const owner = { token: ownerToken, isCurrent: () => current };
    const session = createImageAnnotationSession({
        owner,
        storage: {
            createTemporaryPng(input) { uploads.push(input); return upload.promise; },
            resolveUrl(handle) { reads.push(handle); return url.promise; },
        },
        appendCurrent(input) {
            if (!current || input.owner !== ownerToken || operations.has(input.operation)) return 'retired';
            operations.add(input.operation);
            appended.push(input);
            value = value.concat(input.attachment);
            return 'appended';
        },
        releaseObjectUrl: (source) => released.push(source),
        onClose: (source) => closed.push(source),
        onSavingChange: (next) => saving.push(next),
        onFailure: (phase) => failures.push(phase),
    });
    const begin = (url = 'blob:owned', filename = 'source.jpeg', ownedObjectUrl = true) => {
        const lease = session.beginSource({ url, filename, ownedObjectUrl });
        assert.ok(lease);
        return lease;
    };
    return {
        session, owner, begin, upload, url, uploads, reads, appended,
        released, closed, saving, failures,
        retireOwner() { current = false; },
        republishOwner() { current = true; },
        addNeighbor(attachment: AnnotatedImage) { value = value.concat(attachment); },
        value: () => value,
    };
}

// Session tests assert transport/ownership, not browser PNG decoding or dimensions.
const png = () => new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });

it('preserves native annotated filenames including missing extension/name', () => {
    assert.equal(buildAnnotatedImageFilename('photo.jpeg'), 'photo-annotated.png');
    assert.equal(buildAnnotatedImageFilename('image'), 'image-annotated.png');
    assert.equal(buildAnnotatedImageFilename(''), 'image-annotated.png');
    assert.equal(buildAnnotatedImageFilename('one.two.png'), 'one.two-annotated.png');
});

it('allocates nothing on source selection, focus-independent setup or UI close', () => {
    const f = fixture();
    const lease = f.begin();
    lease.close();
    assert.deepEqual(f.uploads, []);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.appended, []);
    assert.deepEqual(f.released, ['blob:owned']);
    assert.deepEqual(f.closed, [lease.token]);
});

it('consumes duplicate render events before allocation and never retries a render', async () => {
    const f = fixture();
    const lease = f.begin();
    const task = lease.render(png());
    assert.ok(task);
    assert.equal(lease.render(png()), null);
    assert.equal(f.uploads.length, 1);
    f.upload.resolve({ temporary: true });
    await Promise.resolve();
    f.url.resolve('https://synthetic.invalid/annotation.png');
    await task;
    assert.equal(f.appended.length, 1);
    assert.equal(lease.render(png()), null);
});

it('normal render-close before upload settlement preserves exactly one URL read and append', async () => {
    const f = fixture();
    const lease = f.begin();
    const task = lease.render(png());
    assert.ok(task);
    lease.close();
    assert.equal(lease.isCurrent(), false);
    assert.deepEqual(f.released, ['blob:owned']);
    assert.deepEqual(f.closed, [lease.token]);
    assert.equal(f.reads.length, 0);
    f.upload.resolve({ temporary: true });
    await Promise.resolve();
    assert.equal(f.reads.length, 1);
    f.url.resolve('https://synthetic.invalid/annotation.png');
    await task;
    assert.equal(f.appended.length, 1);
    assert.equal(f.appended[0]?.attachment.filename, 'source-annotated.png');
    assert.equal(f.appended[0]?.attachment.type, 'image/png');
    assert.equal(f.appended[0]?.owner, f.owner.token);
    assert.equal(f.appended[0]?.operation, f.uploads[0]?.operation);
    assert.equal(f.saving.at(-1), false);
});

it('source replacement retires an allocated upload before URL resolution starts', async () => {
    const f = fixture();
    const old = f.begin();
    const task = old.render(png());
    assert.ok(task);
    const successor = f.begin('blob:successor');
    f.upload.resolve({ temporary: true });
    await task;
    assert.equal(successor.isCurrent(), true);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.appended, []);
    assert.deepEqual(f.released, ['blob:owned']);
});

it('retirement during URL read refuses append without pretending to cancel the read', async () => {
    const f = fixture();
    const old = f.begin();
    const task = old.render(png());
    assert.ok(task);
    f.upload.resolve({ temporary: true });
    await Promise.resolve();
    assert.equal(f.reads.length, 1);
    f.begin('blob:replacement');
    f.url.resolve('https://synthetic.invalid/late.png');
    await task;
    assert.equal(f.reads.length, 1);
    assert.deepEqual(f.appended, []);
});

it('same URL source A to B to A never revives the original render lease', async () => {
    const f = fixture();
    const a = f.begin('https://synthetic.invalid/A.png', 'A.png', false);
    const task = a.render(png());
    assert.ok(task);
    f.begin('https://synthetic.invalid/B.png', 'B.png', false);
    const nextA = f.begin('https://synthetic.invalid/A.png', 'A.png', false);
    assert.notEqual(nextA.token, a.token);
    f.upload.resolve({ temporary: true });
    await task;
    assert.equal(a.isCurrent(), false);
    assert.equal(nextA.isCurrent(), true);
    assert.deepEqual(f.reads, []);
});

it('owner retirement refuses URL allocation and suppresses stale failure feedback', async () => {
    const f = fixture();
    const task = f.begin().render(png());
    assert.ok(task);
    f.retireOwner();
    f.upload.reject(new Error('late synthetic failure'));
    await task;
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.appended, []);
    assert.deepEqual(f.failures, []);
});

it('dispose is irreversible even if the old host token later appears current again', async () => {
    const f = fixture();
    const old = f.begin();
    const task = old.render(png());
    assert.ok(task);
    f.retireOwner();
    f.session.dispose();
    f.republishOwner();
    f.upload.resolve({ temporary: true });
    await task;
    assert.equal(old.isCurrent(), false);
    assert.equal(f.session.beginSource({ url: 'blob:late', filename: '', ownedObjectUrl: true }), null);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.released, ['blob:owned', 'blob:late']);
});

it('releases owned URLs exactly once across close, replacement and repeated disposal', () => {
    const f = fixture();
    const old = f.begin();
    old.close();
    old.close();
    f.begin('blob:second');
    f.session.dispose();
    f.session.dispose();
    assert.deepEqual(f.released, ['blob:owned', 'blob:second']);
});

it('never revokes a borrowed remote URL', () => {
    const f = fixture();
    const lease = f.begin('https://synthetic.invalid/remote.png', 'remote.png', false);
    lease.close();
    f.session.dispose();
    assert.deepEqual(f.released, []);
});

it('a stale close/failure cannot clear or report against its successor', () => {
    const f = fixture();
    const old = f.begin();
    const next = f.begin('blob:next');
    old.close();
    old.fail('decode', new Error('stale'));
    assert.equal(next.isCurrent(), true);
    assert.deepEqual(f.closed, []);
    assert.deepEqual(f.failures, []);
});

it('original append port reads latest canonical value and preserves concurrent additions', async () => {
    const f = fixture();
    const task = f.begin().render(png());
    assert.ok(task);
    const neighbor: AnnotatedImage = {
        url: 'https://synthetic.invalid/concurrent.png',
        filename: 'concurrent.png', size: 1, type: 'image/png',
    };
    f.addNeighbor(neighbor);
    f.upload.resolve({ temporary: true });
    await Promise.resolve();
    f.url.resolve('https://synthetic.invalid/annotation.png');
    await task;
    assert.equal(f.value().length, 2);
    assert.equal(f.value()[0], neighbor);
    assert.equal(f.value()[1], f.appended[0]?.attachment);
});

it('current storage rejection reports once without URL read, append, delete or automatic retry', async () => {
    const f = fixture();
    const lease = f.begin();
    const task = lease.render(png());
    assert.ok(task);
    f.upload.reject(new Error('synthetic storage rejection'));
    await task;
    assert.deepEqual(f.failures, ['storage']);
    assert.equal(f.uploads.length, 1);
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.appended, []);
    assert.equal(lease.render(png()), null);
});


it('a throwing UI-close notification cannot interrupt editor cleanup', () => {
    const failures: ImageAnnotationFailure[] = [];
    const releases: string[] = [];
    let ownerCurrent = true;
    const session = createImageAnnotationSession({
        owner: { token: {}, isCurrent: () => ownerCurrent },
        storage: {
            async createTemporaryPng() { return {}; },
            async resolveUrl() { return 'https://synthetic.invalid/unused'; },
        },
        appendCurrent() { return 'retired'; },
        releaseObjectUrl: (url) => releases.push(url),
        onClose() { throw new Error('synthetic host callback'); },
        onFailure: (phase) => failures.push(phase),
    });
    const lease = session.beginSource({ url: 'blob:close', filename: '', ownedObjectUrl: true });
    assert.ok(lease);
    let nativeDetached = false;
    const nativeClose = () => { lease.close(); nativeDetached = true; };
    nativeClose();
    assert.equal(nativeDetached, true);
    assert.deepEqual(releases, ['blob:close']);
    assert.deepEqual(failures, ['editor']);
    ownerCurrent = false;
    session.dispose();
});
