import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { FormDraftStore } from '../src/forms/drafts.js';
import type { AirtableValue } from '../src/runtime/types.js';
import {
    createMiniExtensionsClient,
    type SaveFormResult,
    type SaveFormInput,
    type FormLoadedResult,
} from '../src/runtime/index.js';
import {
    loadedForm,
    formSaveOptions,
    invalidForm,
    savedForm,
} from './formsFixtures.js';
import type { FormOwnerScope } from '../src/forms/controller.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const fixture = (
    response: () => Promise<SaveFormResult> = async () => invalidForm()
) => {
    const loaded = loadedForm();
    const calls: SaveFormInput[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            throw new Error('No implicit request');
        },
    });
    client.forms.save = async (input) => {
        calls.push(input);
        return response();
    };
    let scope: FormOwnerScope = { ownerId: 'A', revision: 0 };
    const options = {
        client,
        loaded,
        saveOptions: formSaveOptions(),
        getScope: () => scope,
    };
    const owner = createFormFieldBindings(options);
    return {
        owner,
        options,
        calls,
        loaded,
        client,
        setScope: (next: FormOwnerScope) => {
            scope = next;
        },
    };
};

describe('Form field binding ownership', () => {
    it('a held reload blocks shared writes and Save before journal dispatch', async () => {
        const f = fixture();
        const held = deferred<FormLoadedResult>();
        const field = f.owner.field('fld_title');
        const loading = f.owner.reload({
            dirty: 'keep',
            read: () => held.promise,
        });
        assert.equal(field.getSnapshot().canEdit, false);
        assert.equal(field.setValue('Forbidden').accepted, false);
        let dispatched = false;
        await assert.rejects(
            f.owner.save({
                lifecycle: {
                    dispatch: () => {
                        dispatched = true;
                        return { accepted() {}, finish() {} };
                    },
                },
            })
        );
        assert.equal(dispatched, false);
        assert.equal(f.calls.length, 0);
        held.resolve(f.loaded);
        await loading;
        f.owner.destroy();
    });
    it('retained selection actions cannot write during reload or retire a successor', async () => {
        const f = fixture();
        const loaded = structuredClone(f.loaded);
        loaded.payload.fieldIdsInForm.push('fld_parent');
        loaded.payload.fieldIdsToSchemas.fld_parent = {
            fieldType: 'multipleRecordLinks',
            airtableField: {
                id: 'fld_parent',
                name: 'Parent',
                isComputed: false,
                isPrimaryField: false,
                description: null,
                config: {
                    type: 'multipleRecordLinks',
                    options: {
                        linkedTableId: 'tbl_parent',
                        inverseLinkFieldId: 'fld_children',
                        isReversed: false,
                        prefersSingleRecordLink: false,
                    },
                },
            },
        };
        let writable = true;
        const owner = createFormFieldBindings({
            ...f.options,
            loaded,
            canWrite: () => writable,
        });
        const linked = owner.field('fld_parent');
        owner.setLinkedOptions('fld_parent', [
            { value: 'record_parent', label: 'Parent' },
            { value: 'record_new', label: 'New' },
        ]);
        owner.setLinkedLoader('fld_parent', async () => ({
            options: [
                { value: 'record_parent', label: 'Parent' },
                { value: 'record_new', label: 'New' },
            ],
            offset: null,
        }));
        await linked.selection!.reload();
        writable = false;
        linked.selection!.choose(['record_parent', 'record_new']);
        assert.deepEqual(linked.getSnapshot().value, ['record_parent']);
        assert.deepEqual(linked.selection!.getState().value, ['record_parent']);
        writable = true;
        owner.refresh();
        const held = deferred<FormLoadedResult>();
        const loading = owner.reload({
            dirty: 'keep',
            read: () => held.promise,
        });
        linked.selection!.choose(['record_parent', 'record_new']);
        linked.selection!.toggle('record_new');
        assert.deepEqual(linked.getSnapshot().value, ['record_parent']);
        held.resolve(loaded);
        assert.equal(await loading, true);
        const successor = owner.field('fld_parent');
        owner.setLinkedOptions('fld_parent', [
            { value: 'record_parent', label: 'Parent' },
            { value: 'record_new', label: 'New' },
        ]);
        successor.selection!.choose(['record_parent', 'record_new']);
        linked.selection!.clear();
        assert.deepEqual(successor.getSnapshot().value, [
            'record_parent',
            'record_new',
        ]);
        owner.destroy();
        f.owner.destroy();
    });
    it('a recovery lease blocks Save before journal dispatch or I/O', async () => {
        const f = fixture();
        f.owner.destroy();
        const owner = createFormFieldBindings({
            ...f.options,
            canWrite: () => false,
        });
        let dispatched = false;
        await assert.rejects(
            owner.save({
                lifecycle: {
                    dispatch: () => {
                        dispatched = true;
                        return { accepted() {}, finish() {} };
                    },
                },
            })
        );
        assert.equal(dispatched, false);
        assert.equal(f.calls.length, 0);
        owner.destroy();
    });

    it('subscriptions are render leases; remount retains full native value and dirty state', () => {
        const f = fixture();
        const field = f.owner.field('fld_title');
        let first = '';
        const stop = field.subscribe((state) => {
            first = String(state.value);
        });
        assert(field.setValue('Edited').accepted);
        assert.equal(first, 'Edited');
        stop();
        assert(field.setValue('Remounted').accepted);
        let second = '';
        const unmount = field.subscribe((state) => {
            second = String(state.value);
        });
        assert.equal(second, 'Remounted');
        assert.equal(field.getSnapshot().dirty, true);
        const detached = field.getSnapshot();
        detached.field!.schema.airtableField.name = 'Mutated';
        assert.equal(
            field.getSnapshot().field!.schema.airtableField.name,
            'Title'
        );
        assert.equal(f.calls.length, 0);
        unmount();
        f.owner.destroy();
    });
    it('keeps readonly/computed and hidden native fields in the complete Save', async () => {
        const f = fixture();
        assert(!f.owner.field('fld_readonly').setValue('BAD').accepted);
        assert(!f.owner.field('fld_computed').setValue('BAD').accepted);
        assert(f.owner.field('fld_title').setValue('Edited').accepted);
        await f.owner.save();
        assert.equal(f.calls.length, 1);
        assert.deepEqual(f.calls[0]!.formRecord.data, {
            ...f.loaded.payload.formRecord.data,
            fld_title: 'Edited',
        });
        assert(
            f.calls[0]!.formFieldIdsWithUnsavedChanges.includes('fld_title')
        );
        f.owner.destroy();
    });
    it('explicit keep reload preserves edits and invalidates held old bindings without retiring successor', async () => {
        const f = fixture();
        const old = f.owner.field('fld_title');
        old.setValue('Keep');
        const fresh = structuredClone(f.loaded);
        fresh.payload.formRecord.data.fld_title = 'Server';
        let retired = false;
        old.subscribe((state) => {
            retired ||= state.retired;
        });
        assert(
            await f.owner.reload({ dirty: 'keep', read: async () => fresh })
        );
        const successor = f.owner.field('fld_title');
        assert.equal(successor.getSnapshot().value, 'Keep');
        assert(retired);
        assert.equal(old.getSnapshot().value, undefined);
        assert(!old.setValue('Late').accepted);
        assert(successor.setValue('Successor').accepted);
        assert.equal(successor.getSnapshot().value, 'Successor');
        f.owner.destroy();
    });
    it('an old overlapping reload success/error cannot clear successor state', async () => {
        const f = fixture();
        const slow = deferred<FormLoadedResult>();
        const first = f.owner.reload({
            dirty: 'discard',
            read: () => slow.promise,
        });
        const fresh = structuredClone(f.loaded);
        fresh.payload.formRecord.data.fld_title = 'New';
        assert(
            await f.owner.reload({ dirty: 'discard', read: async () => fresh })
        );
        const successor = f.owner.field('fld_title');
        successor.setValue('Owned');
        slow.resolve(f.loaded);
        assert.equal(await first, false);
        assert.equal(successor.getSnapshot().value, 'Owned');
        assert.equal(successor.getSnapshot().retired, false);
        const failed = deferred<FormLoadedResult>();
        const oldError = f.owner.reload({
            dirty: 'keep',
            read: () => failed.promise,
        });
        assert(
            await f.owner.reload({ dirty: 'keep', read: async () => fresh })
        );
        const newer = f.owner.field('fld_title');
        failed.reject(new Error('old private error'));
        assert.equal(await oldError, false);
        assert.equal(newer.getSnapshot().error, null);
        assert.equal(newer.getSnapshot().value, 'Owned');
        f.owner.destroy();
    });
    it('late old Save cannot retire a reset controller successor or overwrite its native edits', async () => {
        const delayed = deferred<SaveFormResult>();
        const f = fixture(() => delayed.promise);
        const save = f.owner.save();
        const rejection = assert.rejects(save);
        f.owner.controller.reset({
            ...f.options,
            loaded: structuredClone(f.loaded),
        });
        assert(f.owner.controller.write('fld_title', 'Successor'));
        delayed.resolve(savedForm());
        await rejection;
        assert.equal(f.owner.controller.getState().status, 'ready');
        assert.equal(
            f.owner.controller.getState().draft!.data.fld_title,
            'Successor'
        );
        f.owner.destroy();
    });
    it('journal dispatch precedes I/O, unknown outcomes retain no-replay and completion belongs to old attempt only', async () => {
        const delayed = deferred<SaveFormResult>();
        const f = fixture(() => delayed.promise);
        const events: string[] = [];
        const save = f.owner.save({
            lifecycle: {
                dispatch: () => {
                    events.push('begin');
                    return {
                        accepted: () => events.push('accepted'),
                        finish: () => events.push('finish'),
                    };
                },
            },
        });
        assert.deepEqual(events, ['begin']);
        assert.equal(f.calls.length, 1);
        delayed.reject(new Error('lost response'));
        await assert.rejects(save);
        assert.deepEqual(events, ['begin', 'finish']);
        await assert.rejects(f.owner.save());
        assert.equal(f.calls.length, 1);
        assert(!f.owner.field('fld_title').setValue('Untracked').accepted);
        f.owner.destroy();
    });
    it('pre-aborted Save creates no attempt and zero I/O', async () => {
        const f = fixture();
        const signal = AbortSignal.abort();
        let attempts = 0;
        await assert.rejects(
            f.owner.save({
                signal,
                lifecycle: {
                    dispatch: () => {
                        attempts++;
                        return { accepted() {}, finish() {} };
                    },
                },
            })
        );
        assert.equal(attempts, 0);
        assert.equal(f.calls.length, 0);
        f.owner.destroy();
    });
    it('renderer failures after accepted validation cannot change journal acceptance or replay the previous dispatch', async () => {
        const f = fixture();
        const events: string[] = [];
        f.owner.controller.subscribe((state) => {
            if (state.status === 'validation-error') throw new Error('render');
        });
        await f.owner.save({
            lifecycle: {
                dispatch: () => ({
                    accepted: () => events.push('accepted'),
                    finish: () => events.push('finish'),
                }),
            },
        });
        assert.deepEqual(events, ['accepted', 'finish']);
        assert.equal(f.calls.length, 1);
        assert.equal(f.owner.controller.getState().status, 'validation-error');
        f.owner.destroy();
    });
    it('late old actions cannot clear a shared successor draft', () => {
        const f = fixture();
        const store = new FormDraftStore<AirtableValue>();
        let oldCurrent = true;
        const old = createFormFieldBindings({
            ...f.options,
            store,
            isCurrent: () => oldCurrent,
        });
        const retained = old.field('fld_title');
        retained.setValue('Kept');
        oldCurrent = false;
        const successor = createFormFieldBindings({
            ...f.options,
            store,
            isCurrent: () => true,
        });
        assert.equal(successor.field('fld_title').getSnapshot().value, 'Kept');
        successor.field('fld_title').setValue('Successor');
        assert.equal(retained.setValue('Late').accepted, false);
        assert.equal(
            successor.field('fld_title').getSnapshot().value,
            'Successor'
        );
        old.destroy();
        assert.equal(
            successor.field('fld_title').getSnapshot().value,
            'Successor'
        );
        successor.destroy();
        f.owner.destroy();
    });
    it('owner A→B→A and session replacement never revive old field actions', () => {
        const f = fixture();
        const old = f.owner.field('fld_title');
        f.setScope({ ownerId: 'B', revision: 1 });
        assert(old.getSnapshot().retired);
        f.setScope({ ownerId: 'A', revision: 2 });
        assert(!old.setValue('Late').accepted);
        assert.equal(old.getSnapshot().value, undefined);
        f.owner.destroy();
        const other = fixture();
        const held = other.owner.field('fld_title');
        other.client.setSession({ visitor: 'B' });
        assert(held.getSnapshot().retired);
        other.client.setSession({ visitor: 'A' });
        assert(!held.setValue('Late').accepted);
        other.owner.destroy();
    });
});
it('commit-hook errors still publish committed native data without retrying', () => {
    const f = fixture();
    let observed: unknown;
    const stop = f.owner.field('fld_title').subscribe((snapshot) => {
        observed = snapshot.value;
    });
    assert.throws(
        () =>
            f.owner.controller.write('fld_title', 'Committed', () => {
                throw Error('Hook failed');
            }),
        /Hook failed/
    );
    assert.equal(observed, 'Committed');
    assert.equal(f.owner.field('fld_title').getSnapshot().value, 'Committed');
    assert.equal(f.calls.length, 0);
    stop();
    f.owner.destroy();
});
it('an old commit hook cannot publish bookkeeping over a reset successor', () => {
    const f = fixture();
    assert.equal(
        f.owner.controller.write('fld_title', 'Old committed', () => {
            const loaded = loadedForm();
            loaded.payload.formRecord.data.fld_title = 'Successor';
            f.owner.controller.reset({
                ...f.options,
                loaded,
                getScope: () => ({ ownerId: 'B', revision: 1 }),
            });
        }),
        true
    );
    assert.equal(
        f.owner.controller.getState().draft?.data.fld_title,
        'Successor'
    );
    assert.equal(f.owner.controller.getState().status, 'ready');
    assert.equal(f.calls.length, 0);
    f.owner.destroy();
});
