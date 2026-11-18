import assert from 'node:assert/strict';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

export const formBackgroundComputeTypedConsumer = `
import {
    createFormBackgroundComputeCoordinator,
    createFormBackgroundComputeFieldBinding,
    type FormBackgroundComputeClock,
    type FormBackgroundComputeCoordinator,
    type FormBackgroundComputeFieldBinding,
} from '@miniextensions/sdk/forms';
const backgroundComputes: FormBackgroundComputeCoordinator<symbol> = createFormBackgroundComputeCoordinator();
const backgroundSession = Symbol();
const backgroundClock: FormBackgroundComputeClock = {
    now: () => 0,
    schedule: (_run, _delay) => () => {},
};
const backgroundField = createFormBackgroundComputeFieldBinding<symbol>({clock: backgroundClock});
const typedFieldBinding: FormBackgroundComputeFieldBinding<symbol> = backgroundField;
typedFieldBinding.edited(Symbol(), captured => backgroundComputes.runBackground(backgroundSession, async () => void captured));
backgroundField.cancelScheduled();
// @ts-expect-error The opaque edit owner retains its host type.
backgroundField.edited('replacement', async () => {});
// @ts-expect-error The session key retains its host type.
void backgroundComputes.runForeground('wrong scope', async () => {});
`;

function deferred() {
    let resolve, reject;
    const promise = new Promise((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
    });
    return { promise, resolve, reject };
}

function makeClock() {
    let time = 0;
    const pending = new Map();
    return {
        clock: {
            now: () => time,
            schedule(run, delay) {
                const timer = Symbol();
                pending.set(timer, { run, due: time + delay });
                return () => pending.delete(timer);
            },
        },
        tick(at) {
            assert.ok(at >= time, 'the controlled clock only advances');
            time = at;
            const started = [];
            for (const [timer, { run, due }] of pending) {
                if (due <= time) {
                    pending.delete(timer);
                    started.push(run());
                }
            }
            return started;
        },
        due: () => [...pending.values()].map(({ due }) => due),
    };
}

function bindField(forms, { clock, compute }) {
    const field = forms.createFormBackgroundComputeFieldBinding({ clock });
    return {
        edited: (owner) => field.edited(owner, compute),
        cancelScheduled: field.cancelScheduled,
    };
}

function makeDraft(forms) {
    let loaded = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    const store = new forms.FormDraftStore();
    let handle = forms.openLoadedFormDraft({ store, loaded });
    return {
        write(field, value) {
            assert.equal(store.write(handle, field, value), true);
        },
        adopt(recordId) {
            const { data, dirtyFieldIds } = store.snapshot(handle);
            store.discard(handle);
            const formRecord = {
                type: 'edit',
                tableId: 'tbl_children',
                recordId,
                data,
            };
            loaded = {
                ...loaded,
                payload: {
                    ...loaded.payload,
                    formRecord,
                    formFieldIdsWithUnsavedChanges: dirtyFieldIds,
                },
            };
            handle = forms.openLoadedFormDraft({ store, loaded });
        },
        input(isComputeMode) {
            return forms.createFormSaveInput({
                loaded,
                draft: store.snapshot(handle),
                options: {
                    captchaVal: null,
                    isComputeMode,
                    searchQuery: {},
                    context: { type: 'modal', prefillData: null },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                },
            });
        },
    };
}

async function checkCreateAndCoalescing(forms, waitingMode) {
    const coordinator = forms.createFormBackgroundComputeCoordinator();
    const timer = makeClock();
    const draft = makeDraft(forms);
    const session = Symbol('form');
    const owner = Symbol('same draft owner');
    const releaseCreate = deferred();
    const selectedStarted = deferred();
    const releaseSelected = deferred();
    const allocated = [];
    const snapshot = (label, isComputeMode) => {
        const { formRecord, formFieldIdsWithUnsavedChanges } =
            draft.input(isComputeMode);
        allocated.push({
            label,
            isComputeMode,
            type: formRecord.type,
            recordId: formRecord.recordId,
            title: formRecord.data.fld_title,
            quantity: formRecord.data.fld_quantity,
            dirty: formFieldIdsWithUnsavedChanges,
        });
    };

    const start = coordinator.runBackground(session, async () => {
        snapshot('background create', true);
        draft.adopt(await releaseCreate.promise);
    });
    assert.deepEqual(
        allocated.map((entry) => entry.label),
        ['background create']
    );
    for (const mode of ['idle Save', 'idle foreground Compute']) {
        const idle = coordinator.runForeground(
            Symbol('independent session'),
            async () => {
                snapshot(mode, mode === 'idle foreground Compute');
            }
        );
        assert.equal(
            allocated.at(-1).label,
            mode,
            'idle foreground enters synchronously'
        );
        await idle;
    }

    const field = (label) =>
        bindField(forms, {
            clock: timer.clock,
            compute: (captured) =>
                coordinator.runBackground(session, async () => {
                    assert.equal(captured, owner);
                    snapshot(label, true);
                    selectedStarted.resolve();
                    await releaseSelected.promise;
                }),
        });
    const title = field('superseded title');
    const quantity = field('latest quantity');
    timer.tick(10);
    draft.write('fld_title', 'New title');
    title.edited(owner);
    timer.tick(20);
    draft.write('fld_quantity', 17);
    quantity.edited(owner);
    assert.deepEqual(timer.due(), [310, 320]);
    assert.deepEqual(timer.tick(309), []);
    const titlePending = timer.tick(310);
    const quantityPending = timer.tick(320);
    assert.equal(titlePending.length, 1);
    assert.equal(quantityPending.length, 1);
    assert.equal(allocated.length, 3);

    let completions = 0;
    const joined = [start, ...titlePending, ...quantityPending].map((pending) =>
        pending.then(() => {
            completions += 1;
        })
    );
    const foreground = coordinator.runForeground(session, async () => {
        snapshot(waitingMode, waitingMode === 'foreground Compute');
    });
    assert.equal(allocated.length, 3);
    releaseCreate.resolve('rec_adopted');
    await selectedStarted.promise;
    assert.deepEqual(allocated.at(-1), {
        label: 'latest quantity',
        isComputeMode: true,
        type: 'edit',
        recordId: 'rec_adopted',
        title: 'New title',
        quantity: 17,
        dirty: ['fld_parent', 'fld_title', 'fld_quantity'],
    });
    assert.equal(allocated.length, 4);
    assert.equal(completions, 0, 'all callers wait for the selected follow-up');
    draft.write('fld_title', 'Edited during follow-up');
    releaseSelected.resolve();
    await Promise.all([...joined, foreground]);
    assert.deepEqual(allocated.at(-1), {
        ...allocated.at(-2),
        label: waitingMode,
        isComputeMode: waitingMode === 'foreground Compute',
        title: 'Edited during follow-up',
    });
    assert.equal(allocated.length, 5);
    assert.equal(completions, 3);
    assert.deepEqual(timer.due(), []);
}

async function checkCapturedOwner(forms) {
    const coordinator = forms.createFormBackgroundComputeCoordinator();
    const timer = makeClock();
    const session = Symbol('form');
    const a = { record: 'same-record' };
    const b = { record: 'successor' };
    const nextA = { record: a.record };
    let current = a;
    let reads = 0;
    const effects = [];
    const release = deferred();
    const active = coordinator.runBackground(session, () => release.promise);
    const binding = bindField(forms, {
        clock: timer.clock,
        compute: (captured) =>
            coordinator.runBackground(session, async () => {
                reads += 1;
                if (captured === current) effects.push(captured);
            }),
    });
    binding.edited(a);
    assert.deepEqual(timer.tick(299), []);
    const queued = timer.tick(300);
    current = b;
    assert.equal(
        reads,
        0,
        'ownership is checked at allocation, after the wait'
    );
    current = nextA;
    assert.equal(current.record, a.record);
    release.resolve();
    await Promise.all([active, ...queued]);
    assert.equal(reads, 1);
    assert.deepEqual(
        effects,
        [],
        'same-record ABA cannot write the successor draft'
    );
    binding.edited(nextA);
    await Promise.all(timer.tick(600));
    assert.equal(reads, 2);
    assert.deepEqual(effects, [nextA]);
}

async function checkUnmountAndFailure(forms) {
    const timer = makeClock();
    const releaseField = deferred();
    const owners = [];
    const field = bindField(forms, {
        clock: timer.clock,
        compute: async (owner) => {
            owners.push(owner);
            if (owners.length === 1) await releaseField.promise;
        },
    });
    field.edited('cancelled before debounce');
    field.cancelScheduled();
    assert.deepEqual(timer.tick(300), []);
    assert.deepEqual(owners, []);

    field.edited('already allocated');
    const activeField = timer.tick(600);
    assert.deepEqual(owners, ['already allocated']);
    timer.tick(601);
    field.edited('first pending');
    field.edited('latest pending');
    field.cancelScheduled();
    assert.deepEqual(timer.due(), []);
    releaseField.resolve();
    await Promise.all(activeField);
    assert.deepEqual(
        timer.due(),
        [601],
        'allocated pending edit follows at zero delay'
    );
    await Promise.all(timer.tick(601));
    assert.deepEqual(owners, ['already allocated', 'latest pending']);

    const coordinator = forms.createFormBackgroundComputeCoordinator();
    const release = deferred();
    const failure = new Error('synthetic host failure');
    const session = Symbol();
    const effects = [];
    const failed = coordinator.runBackground(session, () => release.promise);
    const superseded = coordinator.runBackground(session, async () => {
        effects.push('older');
    });
    const queued = coordinator.runBackground(session, async () => {
        effects.push('latest');
    });
    const waiting = coordinator.runForeground(session, async () => {
        effects.push('waiting Save');
    });
    const rejections = [failed, superseded, queued, waiting].map((pending) =>
        assert.rejects(pending, (error) => error === failure)
    );
    release.reject(failure);
    await Promise.all(rejections);
    assert.deepEqual(effects, []);
    await coordinator.runBackground(session, async () => {
        effects.push('new compute');
    });
    await coordinator.runForeground(session, async () => {
        effects.push('new Save');
    });
    assert.deepEqual(effects, ['new compute', 'new Save']);

    const fieldFailure = deferred();
    let calls = 0;
    const failedField = bindField(forms, {
        clock: timer.clock,
        compute: async () => {
            calls += 1;
            if (calls === 1) await fieldFailure.promise;
        },
    });
    failedField.edited('fails');
    const [failedTimer] = timer.tick(901);
    timer.tick(902);
    failedField.edited('discarded pending edit');
    const rejected = assert.rejects(failedTimer, (error) => error === failure);
    fieldFailure.reject(failure);
    await rejected;
    assert.deepEqual(timer.due(), []);
    failedField.edited('explicit next edit');
    assert.deepEqual(timer.due(), [1202]);
    await Promise.all(timer.tick(1202));
    assert.equal(calls, 2);
}

export async function runFormBackgroundComputeScenarios(forms) {
    await checkCreateAndCoalescing(forms, 'Save');
    await checkCreateAndCoalescing(forms, 'foreground Compute');
    await checkCapturedOwner(forms);
    await checkUnmountAndFailure(forms);
    return 4;
}

/** A host notification can enqueue another edit during synchronous allocation. */
export async function checkBackgroundComputeReentry(forms) {
    const coordinator = forms.createFormBackgroundComputeCoordinator();
    const session = Symbol();
    const finish = deferred();
    const order = [];
    let joined;
    const active = coordinator.runBackground(session, async () => {
        order.push('first');
        joined = coordinator.runBackground(session, async () => {
            order.push('second');
        });
        await finish.promise;
    });
    assert.deepEqual(order, ['first']);
    assert.ok(joined);
    finish.resolve();
    await Promise.all([active, joined]);
    assert.deepEqual(order, ['first', 'second']);
}
