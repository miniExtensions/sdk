import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPortalInlineEditQueue } from '../src/portals/index.js';

const deferred = <Value>() => {
    let resolve!: (value: Value) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<Value>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const cell = { tableId: 'table', recordId: 'record', fieldId: 'field' };
const fixture = (
    commit: (request: { value: string; view: string }) => Promise<string>
) => {
    const queue = createPortalInlineEditQueue({
        commit,
        committedValue: (result: string) => result,
    });
    let visible = 'Initial';
    const errors: unknown[] = [];
    const committed: string[] = [];
    const edit = (value: string, view = 'view-A', coordinates = cell) => ({
        cell: coordinates,
        committedValue: visible,
        value,
        request: { value, view },
        applyValue: (next: string) => {
            visible = next;
        },
        onCommitted: (result: string) => {
            committed.push(result);
        },
        onError: (error: unknown) => {
            errors.push(error);
        },
        onBatchSettled: () => {},
        onIdle: () => {},
    });
    return { queue, edit, errors, committed, visible: () => visible };
};

describe('injectable Portal inline edit draft queue', () => {
    it('keeps a successful write and original completion when committed-value projection throws', async () => {
        const receipt = { value: 'Canonical A' };
        const projection = new Error('Projection failed');
        const committed: unknown[] = [];
        const errors: unknown[] = [];
        let visible = 'Initial';
        let batches = 0;
        let idle = 0;
        const queue = createPortalInlineEditQueue({
            commit: async () => receipt,
            committedValue: (): string => {
                throw projection;
            },
        });
        queue.enqueue({
            cell,
            committedValue: visible,
            value: 'A',
            request: {},
            applyValue: (value) => {
                visible = value;
            },
            onCommitted: (result) => committed.push(result),
            onError: (error) => errors.push(error),
            onBatchSettled: () => {
                batches++;
            },
            onIdle: () => {
                idle++;
            },
        });
        await queue.flush();
        assert.equal(visible, 'A');
        assert.equal(committed[0], receipt);
        assert.deepEqual(errors, [projection]);
        assert.equal(batches, 1);
        assert.equal(idle, 1);
        assert.equal(queue.hasPending(), false);
        queue.dispose();
    });
    for (const outcome of ['success', 'failure'] as const) {
        it(`keeps A → B → A generations while the first A settles with ${outcome}`, async () => {
            const held = deferred<string>();
            const calls: Array<{ value: string; view: string }> = [];
            const f = fixture(async (request) => {
                calls.push(request);
                return calls.length === 1 ? held.promise : request.value;
            });
            f.queue.enqueue(f.edit('A'));
            const saving = f.queue.flush();
            f.queue.enqueue(f.edit('B'));
            f.queue.enqueue(f.edit('A', 'view-B'));
            assert.equal(f.visible(), 'A');
            if (outcome === 'success') held.resolve('Server A');
            else held.reject(new Error('request failed'));
            await saving;
            assert.equal(calls.length, 1);
            assert.equal(f.visible(), 'A');
            assert.equal(f.queue.hasPending(), true);
            await f.queue.flush();
            assert.deepEqual(calls, [
                { value: 'A', view: 'view-A' },
                { value: 'A', view: 'view-B' },
            ]);
            assert.equal(f.visible(), 'A');
            assert.equal(f.errors.length, outcome === 'failure' ? 1 : 0);
            assert.equal(f.queue.hasPending(), false);
            f.queue.dispose();
        });
    }
    it('rolls a failed successor back to the last successful baseline and retries only a new explicit intent', async () => {
        const held = deferred<string>();
        const requests: string[] = [];
        const f = fixture(async ({ value }) => {
            requests.push(value);
            if (requests.length === 1) return held.promise;
            if (requests.length === 2 || requests.length === 4)
                throw new Error('failed successor');
            return value;
        });
        f.queue.enqueue(f.edit('A'));
        const saving = f.queue.flush();
        f.queue.enqueue(f.edit('B'));
        held.resolve('Canonical A');
        await saving;
        await f.queue.flush();
        assert.equal(f.visible(), 'Canonical A');
        assert.deepEqual(requests, ['A', 'B']);
        await f.queue.flush();
        assert.deepEqual(requests, ['A', 'B']);
        f.queue.enqueue(f.edit('B'));
        await f.queue.flush();
        assert.equal(f.visible(), 'B');
        assert.deepEqual(requests, ['A', 'B', 'B']);
        // A clean cell takes the caller's refreshed baseline on its next edit.
        f.queue.enqueue({ ...f.edit('C'), committedValue: 'Refreshed' });
        await f.queue.flush();
        assert.equal(f.visible(), 'Refreshed');
        assert.deepEqual(requests, ['A', 'B', 'B', 'C']);
        f.queue.dispose();
        assert.equal(f.queue.hasPending(), false);
    });
    it('isolates record/field/table drafts and captures each request context', async () => {
        const calls: Array<{ value: string; view: string }> = [];
        const f = fixture(async (request) => {
            calls.push(request);
            return request.value;
        });
        f.queue.enqueue(f.edit('A'));
        f.queue.enqueue(
            f.edit('record', 'view-B', { ...cell, recordId: 'other' })
        );
        f.queue.enqueue(
            f.edit('field', 'view-C', { ...cell, fieldId: 'other' })
        );
        f.queue.enqueue(
            f.edit('table', 'view-D', { ...cell, tableId: 'other' })
        );
        await f.queue.flush();
        assert.deepEqual(
            calls.map(({ value }) => value),
            ['A', 'record', 'field', 'table']
        );
        f.queue.dispose();
    });
    it('session replacement leaves the old flight with its original callbacks and no successor effects', async () => {
        const held = deferred<string>();
        const old = fixture(async () => held.promise);
        const next = fixture(async ({ value }) => value);
        old.queue.enqueue(old.edit('Old A'));
        const saving = old.queue.flush();
        old.queue.dispose();
        next.queue.enqueue(next.edit('New B'));
        await next.queue.flush();
        held.reject(new Error('old session failure'));
        await saving;
        assert.equal(old.visible(), 'Initial');
        assert.equal(next.visible(), 'New B');
        assert.deepEqual(next.committed, ['New B']);
        assert.equal(next.errors.length, 0);
        next.queue.dispose();
    });
    it('detaches queued native values and request coordinates from the editor', async () => {
        const calls: Array<{ value: string; view: string }> = [];
        const f = fixture(async (request) => {
            calls.push(request);
            return request.value;
        });
        const edit = f.edit('A');
        f.queue.enqueue(edit);
        edit.request.value = 'Replaced';
        edit.request.view = 'Replaced';
        edit.cell = { ...cell, recordId: 'other' };
        await f.queue.flush();
        assert.deepEqual(calls, [{ value: 'A', view: 'view-A' }]);
        f.queue.dispose();
    });
    it('disposal rejects future edits and drops undispatched entries but permits already-started settlement', async () => {
        const held = deferred<string>();
        const calls: string[] = [];
        const f = fixture(async ({ value }) => {
            calls.push(value);
            return held.promise;
        });
        f.queue.enqueue(f.edit('A'));
        f.queue.enqueue(
            f.edit('Not started', 'view-B', { ...cell, fieldId: 'other' })
        );
        const saving = f.queue.flush();
        f.queue.dispose();
        assert.equal(f.queue.enqueue(f.edit('B')), false);
        held.resolve('Canonical A');
        await saving;
        assert.deepEqual(calls, ['A']);
        assert.deepEqual(f.committed, ['Canonical A']);
        assert.equal(f.queue.hasPending(), false);
    });
    it('feedback failure cannot roll back a committed mutation or strand a sibling', async () => {
        const f = fixture(async ({ value }) => value);
        f.queue.enqueue({
            ...f.edit('A'),
            onCommitted: () => {
                throw new Error('presentation');
            },
        });
        f.queue.enqueue(f.edit('B', 'view-B', { ...cell, fieldId: 'other' }));
        await f.queue.flush();
        assert.deepEqual(f.committed, ['B']);
        assert.equal(f.errors.length, 0);
        assert.equal(f.queue.hasPending(), false);
        f.queue.dispose();
    });
});
