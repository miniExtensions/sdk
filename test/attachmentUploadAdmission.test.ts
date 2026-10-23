import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    captureAttachmentUploadAdmission,
    type AttachmentUploadAdmission,
    type AttachmentUploadAuthority,
} from '../src/ui/attachmentUploadAdmission.js';
const authority = (): AttachmentUploadAuthority => ({
    owner: 'native-host',
    revision: 1,
    visible: true,
    editable: true,
});
for (const change of [
    'owner',
    'revision',
    'hidden',
    'readonly',
    'unmounted',
    'unavailable',
] as const) {
    it(`refuses new upload allocation after ${change} during host validation`, () => {
        let now: AttachmentUploadAuthority | null = authority(),
            mounted = true,
            calls = 0;
        const admission = captureAttachmentUploadAdmission({
            getAuthority: () => now,
            isCurrent: () => mounted,
        });
        if (change === 'owner') now = { ...now, owner: 'successor' };
        if (change === 'revision') now = { ...now, revision: 2 };
        if (change === 'hidden') now = { ...now, visible: false };
        if (change === 'readonly') now = { ...now, editable: false };
        if (change === 'unmounted') mounted = false;
        if (change === 'unavailable') now = null;
        assert.deepEqual(
            admission.admit(() => ++calls),
            { accepted: false }
        );
        now = authority();
        mounted = true;
        assert.equal(admission.isCurrent(), false);
        assert.equal(calls, 0);
    });
}
it('uses the observed policy revision to reject A-B-A even when visible/editable return', () => {
    let now = authority();
    const admission = captureAttachmentUploadAdmission({
        getAuthority: () => now,
        isCurrent: () => true,
    });
    now = { ...now, revision: 3 };
    assert.deepEqual(
        admission.admit(() => assert.fail('stale allocation')),
        { accepted: false }
    );
});
it('preserves the original allocated promise/result and never retires its settlement', async () => {
    let finish!: (value: object) => void;
    const pending = new Promise<object>((resolve) => {
        finish = resolve;
    });
    let now = authority(),
        calls = 0;
    const admission = captureAttachmentUploadAdmission({
        getAuthority: () => now,
        isCurrent: () => true,
    });
    const allocated = admission.admit(() => {
        calls++;
        return pending;
    });
    assert.equal(allocated.accepted, true);
    if (!allocated.accepted) throw Error('allocation refused');
    assert.equal(allocated.value, pending);
    now = { ...now, revision: 2 };
    admission.retire();
    assert.deepEqual(
        admission.admit(() => ++calls),
        { accepted: false }
    );
    const native = { url: 'native' };
    finish(native);
    assert.equal(await allocated.value, native);
    assert.equal(calls, 1);
});
it('propagates original synchronous and asynchronous errors without replay or acknowledgement', async () => {
    const failure = new Error('host partial recovery already ran');
    const sync = captureAttachmentUploadAdmission({
        getAuthority: authority,
        isCurrent: () => true,
    });
    assert.throws(
        () =>
            sync.admit(() => {
                throw failure;
            }),
        (error) => error === failure
    );
    assert.equal(sync.isCurrent(), false);
    const asyncIntent = captureAttachmentUploadAdmission({
        getAuthority: authority,
        isCurrent: () => true,
    });
    const allocated = asyncIntent.admit(() => Promise.reject(failure));
    if (!allocated.accepted) throw Error('allocation refused');
    await assert.rejects(allocated.value, (error) => error === failure);
    assert.equal(asyncIntent.isCurrent(), false);
});
it('preserves equivalent host snapshots and exactly one reentrant handoff', () => {
    let admission!: AttachmentUploadAdmission,
        nested = 0;
    admission = captureAttachmentUploadAdmission({
        getAuthority: () => ({ ...authority() }),
        isCurrent: () => true,
    });
    assert.equal(admission.isCurrent(), true);
    assert.deepEqual(
        admission.admit(() => {
            assert.deepEqual(
                admission.admit(() => ++nested),
                { accepted: false }
            );
            return 'native-result';
        }),
        { accepted: true, value: 'native-result' }
    );
    assert.equal(nested, 0);
});
for (const method of ['isCurrent', 'admit'] as const) {
    it(`suppresses recursive ${method} without retiring unchanged upload authority`, async () => {
        const stable = Object.freeze(authority());
        let admission!: AttachmentUploadAdmission,
            recurse = true,
            allocations = 0,
            nestedAllocations = 0;
        const nestedResults: boolean[] = [];
        admission = captureAttachmentUploadAdmission({
            getAuthority: () => stable,
            isCurrent() {
                if (recurse) {
                    nestedResults.push(
                        method === 'isCurrent'
                            ? admission.isCurrent()
                            : admission.admit(() => ++nestedAllocations)
                                  .accepted
                    );
                }
                return true;
            },
        });
        assert.equal(admission.isCurrent(), true);
        assert.ok(nestedResults.length > 0);
        assert.ok(nestedResults.every((result) => result === false));
        assert.equal(nestedAllocations, 0);
        recurse = false;
        assert.equal(admission.isCurrent(), true);

        let finish!: (value: object) => void;
        const pending = new Promise<object>((resolve) => {
            finish = resolve;
        });
        recurse = true;
        const previousNestedChecks = nestedResults.length;
        const allocated = admission.admit(() => {
            allocations++;
            return pending;
        });
        assert.equal(allocated.accepted, true);
        if (!allocated.accepted) throw Error('allocation refused');
        assert.equal(allocated.value, pending);
        assert.ok(nestedResults.length > previousNestedChecks);
        assert.ok(nestedResults.every((result) => result === false));
        assert.equal(nestedAllocations, 0);
        admission.retire();
        assert.deepEqual(
            admission.admit(() => ++allocations),
            { accepted: false }
        );
        const native = { url: 'native' };
        finish(native);
        assert.equal(await allocated.value, native);
        assert.equal(allocations, 1);
    });
}
for (const change of ['owner', 'revision'] as const) {
    it(`permanently refuses genuine ${change} loss despite recursive validation`, () => {
        const original = authority();
        let now = original,
            admission!: AttachmentUploadAdmission,
            recurse = true,
            allocations = 0;
        const nestedResults: boolean[] = [];
        admission = captureAttachmentUploadAdmission({
            getAuthority: () => now,
            isCurrent() {
                if (recurse) nestedResults.push(admission.isCurrent());
                return true;
            },
        });
        now =
            change === 'owner'
                ? { ...original, owner: 'successor' }
                : { ...original, revision: 2 };
        assert.equal(admission.isCurrent(), false);
        assert.ok(nestedResults.length > 0);
        assert.ok(nestedResults.every((result) => result === false));
        now = original;
        recurse = false;
        assert.equal(admission.isCurrent(), false);
        assert.deepEqual(
            admission.admit(() => ++allocations),
            { accepted: false }
        );
        assert.equal(allocations, 0);
    });
}
it('fails closed on throwing authority and reentrant retirement before allocation', () => {
    let throwing = false;
    const admission = captureAttachmentUploadAdmission({
        getAuthority() {
            if (throwing) throw Error('unavailable');
            return authority();
        },
        isCurrent: () => true,
    });
    throwing = true;
    assert.equal(admission.isCurrent(), false);
    let next!: AttachmentUploadAdmission;
    next = captureAttachmentUploadAdmission({
        getAuthority: authority,
        isCurrent() {
            next.retire();
            return true;
        },
    });
    assert.deepEqual(
        next.admit(() => assert.fail('retired allocation')),
        { accepted: false }
    );
});
