import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createFormFieldBindings } from '../src/forms/bindings.js';
import { FormDraftStore } from '../src/forms/drafts.js';
import { openLoadedFormDraft } from '../src/forms/helpers.js';
import {
    RecoveryJournal,
    type RecoveryAttempt,
} from '../src/forms/recovery.js';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type {
    AirtableValue,
    FormLoadedResult,
    SaveFormInput,
    SaveFormResult,
    LoadExtensionInput,
} from '../src/runtime/types.js';
import { formSaveOptions } from './formsFixtures.js';
import {
    parentForm,
    childForm,
    childLoadInput,
    childSaveOptions,
    childSaved,
    validationError,
} from './formLinkedChildFixtures.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
class ObservedJournal extends RecoveryJournal {
    readonly observed: RecoveryAttempt[] = [];
    afterBegin: (() => void) | null = null;
    afterAccepted: (() => void) | null = null;
    override prepare(...args: Parameters<RecoveryJournal['prepare']>) {
        const attempt = super.prepare(...args);
        this.observed.push(attempt);
        return attempt;
    }
    override begin(...args: Parameters<RecoveryJournal['begin']>) {
        const attempt = super.begin(...args);
        this.afterBegin?.();
        return attempt;
    }
    override accepted(...args: Parameters<RecoveryJournal['accepted']>) {
        super.accepted(...args);
        this.afterAccepted?.();
    }
}
const fixture = (
    options: {
        mode?: 'create' | 'edit';
        parent?: FormLoadedResult;
        child?: FormLoadedResult;
        save?: () => Promise<SaveFormResult>;
        load?: () => Promise<FormLoadedResult>;
        canWriteField?: (fieldId: string) => boolean;
    } = {}
) => {
    const mode = options.mode ?? 'create';
    const loaded = options.parent ?? parentForm(mode);
    const childLoaded = options.child ?? childForm(mode);
    const loads: LoadExtensionInput[] = [];
    const saves: SaveFormInput[] = [];
    const journal = new ObservedJournal();
    const store = new FormDraftStore<AirtableValue>();
    const handle = openLoadedFormDraft({ store, loaded });
    let owner = { ownerId: 'synthetic-root', revision: 0 };
    let configuration = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'synthetic-A' },
        fetch: async () => {
            throw Error('Unexpected real transport');
        },
    });
    client.loadExtension = async (input) => {
        loads.push(structuredClone(input));
        return options.load ? options.load() : structuredClone(childLoaded);
    };
    client.forms.save = async (input) => {
        saves.push(structuredClone(input));
        return options.save ? options.save() : childSaved(mode);
    };
    const fields = createFormFieldBindings({
        loaded,
        client,
        store,
        saveOptions: formSaveOptions(),
        getScope: () => owner,
        configurationRevision: () => configuration,
        canWriteField: options.canWriteField,
    });
    const parentWrites: string[] = [];
    const write = store.write.bind(store);
    store.write = (handle, id, value) => {
        parentWrites.push(id);
        return write(handle, id, value);
    };
    const coordinator = fields.linkedChild('fld_children_a', {
        journal,
        loadVersion: 1,
    });
    return {
        loaded,
        childLoaded,
        fields,
        coordinator,
        client,
        loads,
        saves,
        journal,
        store,
        handle,
        parentWrites,
        expireParent: () => {
            configuration++;
        },
        expireOwner: () => {
            owner = { ownerId: 'synthetic-root', revision: owner.revision + 1 };
            fields.refresh();
        },
        close: () => {
            coordinator.close();
            fields.destroy();
        },
    };
};
const child = (f: ReturnType<typeof fixture>) => {
    const current = f.coordinator.getSnapshot();
    assert.ok(current.child);
    assert.ok(current.pages);
    return current.child;
};
const native = (f: ReturnType<typeof fixture>, id = 'fld_children_a') =>
    (f.fields.controller.getState().draft ?? f.store.snapshot(f.handle))!.data[
        id
    ];
const save = (f: ReturnType<typeof fixture>) =>
    f.coordinator.save(f.coordinator.getSnapshot().revision);

describe('owner-held Form linked-child creation', () => {
    for (const mode of ['create', 'edit'] as const)
        it(`${mode} derives modal access, native Save and field-local reconciliation`, async () => {
            const f = fixture({ mode });
            try {
                assert.equal(f.coordinator.getSnapshot().phase, 'idle');
                assert.equal(f.loads.length, 0);
                assert.equal(f.saves.length, 0);
                assert.equal(
                    f.coordinator,
                    f.fields.linkedChild('fld_children_a', {
                        journal: f.journal,
                        loadVersion: 1,
                    })
                );
                assert.equal(await f.coordinator.openCreate(), true);
                assert.deepEqual(f.loads, [childLoadInput(mode)]);
                assert.equal(f.coordinator.getSnapshot().phase, 'ready');
                const before = structuredClone(
                    f.fields.controller.getState().draft!.data
                );
                const childData = structuredClone(
                    child(f).controller.getState().draft!.data
                );
                assert.equal((await save(f)).type, 'saved');
                assert.deepEqual(f.saves, [
                    {
                        ...childSaveOptions(mode),
                        extensionAccessToken: 'synthetic_child_token',
                        formRecord: { type: 'create', data: childData },
                        formFieldIdsWithUnsavedChanges: ['fld_title'],
                    },
                ]);
                assert.equal(
                    f.coordinator.getSnapshot().completion,
                    'reconciled'
                );
                assert.deepEqual(f.fields.controller.getState().draft!.data, {
                    ...before,
                    fld_children_a: [
                        'rec_existing',
                        'rec_existing',
                        'rec_sibling',
                        'rec_created',
                    ],
                });
                assert.deepEqual(
                    f.fields.controller.getState().draft!.dirtyFieldIds,
                    ['fld_title', 'fld_children_a']
                );
                assert.equal(f.journal.observed.at(-1)?.outcome, 'saved');
            } finally {
                f.close();
            }
        });

    it('reconciles latest native siblings and preserves already-present duplicate occurrences without a write', async () => {
        for (const alreadyPresent of [false, true]) {
            const f = fixture();
            try {
                assert(await f.coordinator.openCreate());
                const latest = alreadyPresent
                    ? ['rec_created', 'rec_created', 'rec_sibling']
                    : ['rec_new_sibling', 'rec_existing', 'rec_existing'];
                assert(f.fields.controller.write('fld_children_a', latest));
                const revision = f.fields.controller.getState().draftRevision;
                await save(f);
                assert.deepEqual(
                    native(f),
                    alreadyPresent ? latest : [...latest, 'rec_created']
                );
                if (alreadyPresent)
                    assert.equal(
                        f.fields.controller.getState().draftRevision,
                        revision
                    );
                assert.equal(
                    f.coordinator.getSnapshot().completion,
                    'reconciled'
                );
            } finally {
                f.close();
            }
        }
    });

    it('edit inverse mismatch removes every matching child occurrence; missing inverse is not inferred', async () => {
        for (const missing of [false, true]) {
            const response = childSaved('edit');
            if (missing) delete response.record.fields.fld_parent_a;
            else response.record.fields.fld_parent_a = ['rec_elsewhere'];
            const f = fixture({ mode: 'edit', save: async () => response });
            try {
                f.fields.controller.write('fld_children_a', [
                    'rec_created',
                    'rec_created',
                    'rec_sibling',
                ]);
                assert(await f.coordinator.openCreate());
                await save(f);
                assert.deepEqual(
                    native(f),
                    missing
                        ? ['rec_created', 'rec_created', 'rec_sibling']
                        : ['rec_sibling']
                );
                assert.equal(
                    f.coordinator.getSnapshot().completion,
                    missing ? 'saved-not-reconciled' : 'reconciled'
                );
            } finally {
                f.close();
            }
        }
    });

    it('parent-only post-dispatch lease expiry preserves known child Save without reconciliation', async () => {
        const pending = deferred<SaveFormResult>();
        const f = fixture({ save: () => pending.promise });
        try {
            assert(await f.coordinator.openCreate());
            const before = structuredClone(native(f));
            const flight = save(f);
            await Promise.resolve();
            assert.equal(f.saves.length, 1);
            f.expireParent();
            f.coordinator.getSnapshot();
            pending.resolve(childSaved());
            assert.equal((await flight).type, 'saved');
            assert.equal(f.journal.observed.at(-1)?.outcome, 'saved');
            assert.equal(
                f.coordinator.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.deepEqual(native(f), before);
        } finally {
            f.close();
        }
    });

    for (const loss of ['session', 'owner', 'close'] as const)
        it(`${loss} loss after dispatch leaves unknown and never writes the parent`, async () => {
            const pending = deferred<SaveFormResult>();
            const f = fixture({ save: () => pending.promise });
            try {
                assert(await f.coordinator.openCreate());
                const before = structuredClone(native(f));
                const flight = save(f);
                await Promise.resolve();
                assert.equal(f.saves.length, 1);
                if (loss === 'session')
                    f.client.setSession({ visitor: 'synthetic-B' });
                else if (loss === 'owner') f.expireOwner();
                else f.coordinator.close();
                f.coordinator.getSnapshot();
                pending.resolve(childSaved());
                await assert.rejects(flight);
                assert.equal(f.journal.observed.at(-1)?.outcome, 'unknown');
                if (loss !== 'close')
                    assert.equal(f.fields.controller.getState().draft, null);
                if (loss === 'close') assert.deepEqual(native(f), before);
                else assert.deepEqual(f.parentWrites, []);
                assert.equal(await f.coordinator.openCreate(), false);
                assert.equal(f.loads.length, 1);
            } finally {
                f.close();
            }
        });

    it('transport uncertainty blocks a subsequent create without an automatic retry', async () => {
        const f = fixture({
            save: async () => {
                throw Error('Synthetic disconnected transport');
            },
        });
        try {
            assert(await f.coordinator.openCreate());
            const before = structuredClone(native(f));
            await assert.rejects(save(f));
            assert.equal(f.coordinator.getSnapshot().phase, 'unknown');
            assert.equal(f.journal.observed.at(-1)?.outcome, 'unknown');
            assert.equal(await f.coordinator.openCreate(), false);
            assert.deepEqual(native(f), before);
            assert.equal(f.loads.length, 1);
            assert.equal(f.saves.length, 1);
        } finally {
            f.close();
        }
    });

    it('validation errors remain local and allow a fresh explicit Save', async () => {
        let attempt = 0;
        const f = fixture({
            save: async () =>
                ++attempt === 1 ? validationError : childSaved(),
        });
        try {
            assert(await f.coordinator.openCreate());
            const before = structuredClone(native(f));
            assert.equal((await save(f)).type, 'error');
            assert.deepEqual(native(f), before);
            assert.equal(
                f.journal.observed.at(-1)?.outcome,
                'validation-error'
            );
            assert.equal(f.coordinator.getSnapshot().completion, 'none');
            assert.equal((await save(f)).type, 'saved');
            assert.equal(f.saves.length, 2);
        } finally {
            f.close();
        }
    });

    it('stale render, required child field and pre-dispatch parent expiry admit zero transport', async () => {
        for (const refusal of [
            'stale',
            'required',
            'parent',
            'dispatch-hook',
        ] as const) {
            const loaded = childForm();
            if (refusal === 'required')
                loaded.payload.fieldIdsToSchemas.fld_title!.miniExtConfig = {
                    required: true,
                };
            const f = fixture({ child: loaded });
            try {
                assert(await f.coordinator.openCreate());
                const rendered = f.coordinator.getSnapshot().revision;
                if (refusal === 'required')
                    child(f).field('fld_title').setValue('');
                if (refusal === 'stale')
                    child(f).field('fld_title').setValue('New native title');
                if (refusal === 'parent') f.expireParent();
                if (refusal === 'dispatch-hook')
                    f.journal.afterBegin = f.expireParent;
                await assert.rejects(
                    f.coordinator.save(
                        refusal === 'stale'
                            ? rendered
                            : f.coordinator.getSnapshot().revision
                    )
                );
                assert.equal(f.saves.length, 0);
                if (refusal === 'dispatch-hook')
                    assert.equal(
                        f.journal.observed.at(-1)?.outcome,
                        'not-dispatched'
                    );
                else assert.equal(f.journal.observed.length, 0);
            } finally {
                f.close();
            }
        }
    });

    it('new child intent gets a fresh draft rather than reusing the saved create', async () => {
        const f = fixture();
        try {
            assert(await f.coordinator.openCreate());
            const first = child(f);
            first.field('fld_title').setValue('First child edit');
            await save(f);
            f.coordinator.close();
            assert(await f.coordinator.openCreate());
            const second = child(f);
            assert.notEqual(second, first);
            assert.equal(
                second.field('fld_title').getSnapshot().value,
                'Child native title'
            );
            assert.equal(
                first.field('fld_title').setValue('Stale child write').accepted,
                false
            );
            assert.equal(f.loads.length, 2);
        } finally {
            f.close();
        }
    });

    it('wrong saved table or non-modal context never grants parent reconciliation', async () => {
        for (const mismatch of ['table', 'context'] as const) {
            const response = childSaved();
            if (mismatch === 'table') response.tableId = 'tbl_foreign';
            else response.context = { type: 'direct-url' };
            const f = fixture({ save: async () => response });
            try {
                assert(await f.coordinator.openCreate());
                const before = structuredClone(native(f));
                await assert.rejects(save(f));
                assert.deepEqual(native(f), before);
                assert.equal(f.journal.observed.at(-1)?.outcome, 'unknown');
            } finally {
                f.close();
            }
        }
    });

    it('independent unsaved parents and sibling fields never share reconciliation authority', async () => {
        const a = fixture(),
            b = fixture();
        try {
            assert(await a.coordinator.openCreate());
            await save(a);
            assert.deepEqual(native(a, 'fld_children_b'), ['rec_other_field']);
            assert.deepEqual(native(b), [
                'rec_existing',
                'rec_existing',
                'rec_sibling',
            ]);
            assert.equal(b.loads.length, 0);
            assert.equal(b.saves.length, 0);
        } finally {
            a.close();
            b.close();
        }
    });

    it('capacity filled during Save retains the known child result without selecting it', async () => {
        const parent = parentForm();
        const schema = parent.payload.fieldIdsToSchemas.fld_children_a!;
        if (schema.fieldType !== 'multipleRecordLinks')
            throw Error('Expected synthetic link');
        schema.miniExtConfig = {
            ...schema.miniExtConfig,
            customMaxRecordsToSelect: 4,
        };
        const pending = deferred<SaveFormResult>();
        const f = fixture({ parent, save: () => pending.promise });
        try {
            assert(await f.coordinator.openCreate());
            const flight = save(f);
            await Promise.resolve();
            f.fields.controller.write('fld_children_a', [
                'rec_existing',
                'rec_existing',
                'rec_sibling',
                'rec_latest',
            ]);
            pending.resolve(childSaved());
            assert.equal((await flight).type, 'saved');
            assert.equal(
                f.coordinator.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.equal(f.journal.observed.at(-1)?.outcome, 'saved');
            assert.deepEqual(native(f), [
                'rec_existing',
                'rec_existing',
                'rec_sibling',
                'rec_latest',
            ]);
        } finally {
            f.close();
        }
    });

    it('captures readable prefill at open rather than recomputing it for Save', async () => {
        const parent = parentForm('edit');
        const schema = parent.payload.fieldIdsToSchemas.fld_children_a!;
        if (schema.fieldType !== 'multipleRecordLinks')
            throw Error('Expected synthetic link');
        schema.miniExtConfig = {
            ...schema.miniExtConfig,
            prefillChildFormForCreatingRecords: true,
            prefillFieldForCreatingChildExtension: 'fld_title',
        };
        const frozenQuery = 'prefill_Title=Frozen%20child&same=one&same=two';
        parent.payload.formRecord.data.fld_title = frozenQuery;
        const pending = deferred<FormLoadedResult>();
        const f = fixture({
            mode: 'edit',
            parent,
            load: () => pending.promise,
        });
        try {
            const opening = f.coordinator.openCreate();
            await Promise.resolve();
            assert.equal(f.loads.length, 1);
            f.fields
                .field('fld_title')
                .setValue('Parent changed after opening');
            pending.resolve(childForm('edit'));
            assert(await opening);
            const expected = childLoadInput('edit');
            if (expected.context.type !== 'modal')
                throw Error('Expected modal');
            expected.context.prefillDataForLinkedRecordsForm!.prefillQueryForChildExtension =
                frozenQuery;
            expected.query = { prefill_Title: 'Frozen child', same: 'two' };
            assert.deepEqual(f.loads[0], expected);
            await save(f);
            assert.equal(f.saves[0]!.context.type, 'modal');
            if (f.saves[0]!.context.type === 'modal')
                assert.deepEqual(
                    f.saves[0]!.context.prefillData,
                    expected.context.prefillDataForLinkedRecordsForm
                );
            assert.deepEqual(f.saves[0]!.searchQuery, expected.query);
        } finally {
            f.close();
        }
    });

    it('loading close and reentrant open never mount a late child or dispatch twice', async () => {
        const pending = deferred<FormLoadedResult>();
        const f = fixture({ load: () => pending.promise });
        try {
            const opening = f.coordinator.openCreate();
            await Promise.resolve();
            assert.equal(f.coordinator.getSnapshot().phase, 'loading');
            assert.equal(await f.coordinator.openCreate(), false);
            await assert.rejects(f.fields.save());
            assert.equal(f.saves.length, 0);
            f.coordinator.close();
            pending.resolve(childForm());
            assert.equal(await opening, false);
            assert.equal(f.coordinator.getSnapshot().child, null);
            assert.equal(f.loads.length, 1);
            assert.equal(f.journal.observed.length, 0);
        } finally {
            f.close();
        }
    });

    it('active child Save blocks parent Save and a reentrant child Save', async () => {
        const pending = deferred<SaveFormResult>();
        const f = fixture({ save: () => pending.promise });
        try {
            assert(await f.coordinator.openCreate());
            await assert.rejects(f.fields.save());
            const flight = save(f);
            await Promise.resolve();
            await assert.rejects(save(f));
            await assert.rejects(f.fields.save());
            assert.equal(f.saves.length, 1);
            pending.resolve(childSaved());
            await flight;
            assert.equal(f.journal.observed.length, 1);
        } finally {
            f.close();
        }
    });

    it('unsupported parent configuration refuses before loading', async () => {
        for (const config of [
            { allowCreatingRecords: false },
            { readOnly: true },
            { layout: 'form' },
            { dynamicFilteringToggle: true },
            { recordFinderMode: 'calendar' },
        ]) {
            const parent = parentForm();
            const schema = parent.payload.fieldIdsToSchemas.fld_children_a!;
            schema.miniExtConfig = {
                ...schema.miniExtConfig,
                ...config,
            } as typeof schema.miniExtConfig;
            const f = fixture({ parent });
            try {
                assert.equal(await f.coordinator.openCreate(), false);
                assert.equal(f.loads.length, 0);
                assert.equal(f.saves.length, 0);
                assert.equal(f.journal.observed.length, 0);
            } finally {
                f.close();
            }
        }
    });

    it('configured Review and compute child forms never become Save authority', async () => {
        for (const key of [
            'promptUserBeforeSubmission',
            'enableFormComputeMode',
        ] as const) {
            const loaded = childForm();
            loaded.payload.publicFields.state[key] = true;
            const f = fixture({ child: loaded });
            try {
                assert.equal(await f.coordinator.openCreate(), false);
                assert.equal(f.loads.length, 1);
                assert.equal(f.coordinator.getSnapshot().child, null);
                assert.equal(f.coordinator.getSnapshot().pages, null);
                assert.equal(f.saves.length, 0);
                assert.equal(f.journal.observed.length, 0);
            } finally {
                f.close();
            }
        }
    });

    it('reentrant native edit during final canWriteField handoff is preserved without an append', async () => {
        let afterReceipt = false;
        let handoffReads = 0;
        let committing = false;
        let edited = false;
        let writeLatest: (() => void) | null = null;
        const latest = ['rec_latest_sibling', 'rec_existing', 'rec_existing'];
        const f = fixture({
            canWriteField: (id) => {
                if (
                    afterReceipt &&
                    id === 'fld_children_a' &&
                    ++handoffReads > 0 &&
                    committing &&
                    !edited
                ) {
                    edited = true;
                    writeLatest?.();
                }
                return true;
            },
        });
        const originalWrite = f.fields.controller.write;
        f.fields.controller.write = (id, value, afterCommit) => {
            if (afterReceipt && id === 'fld_children_a') committing = true;
            try {
                return originalWrite(id, value, afterCommit);
            } finally {
                committing = false;
            }
        };
        writeLatest = () => {
            assert(originalWrite('fld_children_a', latest));
        };
        f.journal.afterAccepted = () => {
            afterReceipt = true;
        };
        try {
            assert(await f.coordinator.openCreate());
            assert.equal((await save(f)).type, 'saved');
            assert(handoffReads >= 2);
            assert.deepEqual(native(f), latest);
            assert.equal(
                f.coordinator.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.equal(f.journal.observed.at(-1)?.outcome, 'saved');
            assert.equal(f.saves.length, 1);
        } finally {
            f.close();
        }
    });

    it('accepted known receipt survives reentrant close without parent reconciliation', async () => {
        const f = fixture();
        f.journal.afterAccepted = () => f.coordinator.close();
        try {
            assert(await f.coordinator.openCreate());
            const before = structuredClone(native(f));
            assert.equal((await save(f)).type, 'saved');
            assert.equal(f.journal.observed.at(-1)?.outcome, 'saved');
            assert.equal(
                f.coordinator.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.deepEqual(native(f), before);
            assert.equal(f.saves.length, 1);
        } finally {
            f.close();
        }
    });

    it('closing a replaced coordinator cannot cancel the new owner intent', async () => {
        const f = fixture();
        try {
            assert(await f.coordinator.openCreate());
            f.coordinator.close();
            const replacement = f.fields.linkedChild('fld_children_a', {
                journal: f.journal,
                loadVersion: 2,
            });
            assert.notEqual(replacement, f.coordinator);
            assert(await replacement.openCreate());
            const current = replacement.getSnapshot().child;
            assert.ok(current);
            f.coordinator.close();
            assert.equal(replacement.getSnapshot().phase, 'ready');
            assert.equal(
                current.field('fld_title').setValue('New owner child').accepted,
                true
            );
            assert.equal(
                (await replacement.save(replacement.getSnapshot().revision))
                    .type,
                'saved'
            );
            assert.equal(f.saves.length, 1);
            assert.deepEqual(native(f), [
                'rec_existing',
                'rec_existing',
                'rec_sibling',
                'rec_created',
            ]);
            replacement.close();
        } finally {
            f.close();
        }
    });

    it('setup subscriber replacing a candidate leaves the newer load authoritative', async () => {
        const firstLoad = deferred<FormLoadedResult>();
        const newerLoad = deferred<FormLoadedResult>();
        let loadCount = 0;
        const f = fixture({
            load: () =>
                ++loadCount === 1 ? firstLoad.promise : newerLoad.promise,
        });
        let replaced = false;
        let newerOpening: Promise<boolean> | null = null;
        const notificationsAfterReplacement: string[] = [];
        const stop = f.coordinator.subscribe((snapshot) => {
            if (replaced) notificationsAfterReplacement.push(snapshot.phase);
            if (
                !replaced &&
                snapshot.phase === 'loading' &&
                snapshot.child !== null
            ) {
                replaced = true;
                f.coordinator.close();
                newerOpening = f.coordinator.openCreate();
            }
        });
        try {
            const oldOpening = f.coordinator.openCreate();
            firstLoad.resolve(childForm());
            assert.equal(await oldOpening, false);
            assert.equal(replaced, true);
            assert.equal(f.loads.length, 2);
            assert.equal(f.coordinator.getSnapshot().phase, 'loading');
            assert.equal(f.coordinator.getSnapshot().child, null);
            assert.equal(f.coordinator.getSnapshot().pages, null);
            assert.equal(
                notificationsAfterReplacement.includes('ready'),
                false
            );
            assert.ok(newerOpening);
            newerLoad.resolve(childForm());
            assert.equal(await newerOpening, true);
            assert.equal(f.coordinator.getSnapshot().phase, 'ready');
            assert.ok(f.coordinator.getSnapshot().child);
            assert.equal(f.saves.length, 0);
            assert.equal(f.journal.observed.length, 0);
        } finally {
            stop();
            f.close();
        }
    });

    it('permission callback close during reconciliation retains the known Save without appending', async () => {
        let afterReceipt = false;
        let closedInPermission = false;
        let closeCandidate: (() => void) | null = null;
        const f = fixture({
            canWriteField: (id) => {
                if (
                    afterReceipt &&
                    id === 'fld_children_a' &&
                    !closedInPermission
                ) {
                    closedInPermission = true;
                    closeCandidate?.();
                }
                return true;
            },
        });
        closeCandidate = () => f.coordinator.close();
        f.journal.afterAccepted = () => {
            afterReceipt = true;
        };
        try {
            assert(await f.coordinator.openCreate());
            const before = structuredClone(native(f));
            assert.equal((await save(f)).type, 'saved');
            assert.equal(closedInPermission, true);
            assert.equal(f.journal.observed.at(-1)?.outcome, 'saved');
            assert.equal(
                f.coordinator.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.deepEqual(native(f), before);
            assert.equal(f.saves.length, 1);
        } finally {
            f.close();
        }
    });

    it('parent configuration retirement releases the child owner after retaining its known receipt', async () => {
        const pending = deferred<SaveFormResult>();
        const f = fixture({ save: () => pending.promise });
        try {
            assert(await f.coordinator.openCreate());
            const capturedChild = child(f);
            const before = structuredClone(native(f));
            const flight = save(f);
            await Promise.resolve();
            assert.equal(f.saves.length, 1);
            f.expireParent();
            f.coordinator.getSnapshot();
            pending.resolve(childSaved());
            assert.equal((await flight).type, 'saved');
            assert.equal(f.journal.observed.at(-1)?.outcome, 'saved');
            assert.equal(
                f.coordinator.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.equal(
                capturedChild.controller.getState().status,
                'disposed'
            );
            assert.equal(
                capturedChild.field('fld_title').setValue('Retired child edit')
                    .accepted,
                false
            );
            assert.deepEqual(native(f), before);
        } finally {
            f.close();
        }
    });

    it('a replacement journal and load version cannot bypass an owned unknown create', async () => {
        const f = fixture({
            save: async () => {
                throw Error('Synthetic uncertain create');
            },
        });
        try {
            assert(await f.coordinator.openCreate());
            await assert.rejects(save(f));
            const uncertainAttempt = f.journal.observed.at(-1);
            assert.ok(uncertainAttempt);
            assert.equal(uncertainAttempt.outcome, 'unknown');
            const replacementJournal = new ObservedJournal();
            const replacement = f.fields.linkedChild('fld_children_a', {
                journal: replacementJournal,
                loadVersion: 2,
            });
            assert.equal(replacement.getSnapshot().canCreate, false);
            assert.equal(await replacement.openCreate(), false);
            assert.equal(f.loads.length, 1);
            assert.equal(f.saves.length, 1);
            assert.equal(replacementJournal.observed.length, 0);
            assert.equal(uncertainAttempt.outcome, 'unknown');
            assert.equal(uncertainAttempt.acknowledgment, 'none');
            replacement.close();
        } finally {
            f.close();
        }
    });

    it('accepted parent reload releases a disposed known local block after capacity prevented reconciliation', async () => {
        const parent = parentForm();
        const schema = parent.payload.fieldIdsToSchemas.fld_children_a!;
        if (schema.fieldType !== 'multipleRecordLinks')
            throw Error('Expected synthetic link');
        schema.miniExtConfig = {
            ...schema.miniExtConfig,
            customMaxRecordsToSelect: 4,
        };
        const pending = deferred<SaveFormResult>();
        const f = fixture({ parent, save: () => pending.promise });
        try {
            assert(await f.coordinator.openCreate());
            const flight = save(f);
            await Promise.resolve();
            f.fields.controller.write('fld_children_a', [
                'rec_existing',
                'rec_existing',
                'rec_sibling',
                'rec_latest',
            ]);
            pending.resolve(childSaved());
            assert.equal((await flight).type, 'saved');
            const knownAttempt = f.journal.observed.at(-1);
            assert.ok(knownAttempt);
            assert.equal(knownAttempt.outcome, 'saved');
            assert.equal(
                f.coordinator.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.equal(f.coordinator.getSnapshot().canCreate, false);
            assert.equal(
                await f.fields.reload({
                    dirty: 'discard',
                    read: async () => structuredClone(parent),
                }),
                true
            );
            const replacement = f.fields.linkedChild('fld_children_a', {
                journal: f.journal,
                loadVersion: 2,
            });
            assert.equal(replacement.getSnapshot().canCreate, true);
            assert.equal(await replacement.openCreate(), true);
            assert.equal(f.loads.length, 2);
            assert.equal(f.saves.length, 1);
            assert.equal(knownAttempt.outcome, 'saved');
            assert.equal(knownAttempt.acknowledgment, 'none');
            replacement.close();
        } finally {
            f.close();
        }
    });

    it('nested open from the initial permission callback owns the only child load', async () => {
        const pending = deferred<FormLoadedResult>();
        let armed = false;
        let nestedOpen: (() => Promise<boolean>) | null = null;
        let nestedOpening: Promise<boolean> | null = null;
        const f = fixture({
            load: () => pending.promise,
            canWriteField: (id) => {
                if (armed && id === 'fld_children_a') {
                    armed = false;
                    nestedOpening = nestedOpen!();
                }
                return true;
            },
        });
        nestedOpen = () => f.coordinator.openCreate();
        try {
            armed = true;
            assert.equal(await f.coordinator.openCreate(), false);
            assert.ok(nestedOpening);
            assert.equal(f.loads.length, 1);
            assert.equal(f.coordinator.getSnapshot().phase, 'loading');
            pending.resolve(childForm());
            assert.equal(await nestedOpening, true);
            assert.equal(f.coordinator.getSnapshot().phase, 'ready');
            assert.equal(f.loads.length, 1);
            assert.equal(f.saves.length, 0);
            assert.equal(f.journal.observed.length, 0);
        } finally {
            f.close();
        }
    });

    it('parent capacity and visibility edits publish canCreate revisions without snapshot polling', () => {
        const parent = parentForm();
        parent.payload.formRecord.data.fld_title = 'Show';
        const schema = parent.payload.fieldIdsToSchemas.fld_children_a!;
        if (schema.fieldType !== 'multipleRecordLinks')
            throw Error('Expected synthetic link');
        schema.miniExtConfig = {
            ...schema.miniExtConfig,
            customMaxRecordsToSelect: 4,
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'synthetic-parent-visibility',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'singleLineText',
                            value: 'Show',
                            idOrName: { type: 'id', id: 'fld_title' },
                        },
                    },
                ],
            },
        };
        const f = fixture({ parent });
        const reports: Array<{ revision: number; canCreate: boolean }> = [];
        const stop = f.coordinator.subscribe((snapshot) => {
            reports.push({
                revision: snapshot.revision,
                canCreate: snapshot.canCreate,
            });
        });
        const expectNotification = (edit: () => void, expected: boolean) => {
            const previous = reports.at(-1);
            assert.ok(previous);
            const count = reports.length;
            edit();
            assert(reports.length > count);
            assert.equal(reports.at(-1)!.canCreate, expected);
            assert(reports.at(-1)!.revision > previous.revision);
        };
        try {
            assert.equal(reports.at(-1)?.canCreate, true);
            expectNotification(() => {
                assert(
                    f.fields.controller.write('fld_children_a', [
                        'rec_existing',
                        'rec_existing',
                        'rec_sibling',
                        'rec_full',
                    ])
                );
            }, false);
            expectNotification(() => {
                assert(
                    f.fields.controller.write('fld_children_a', [
                        'rec_existing',
                        'rec_existing',
                        'rec_sibling',
                    ])
                );
            }, true);
            expectNotification(() => {
                assert.equal(
                    f.fields.field('fld_title').setValue('Hide').accepted,
                    true
                );
            }, false);
            expectNotification(() => {
                assert.equal(
                    f.fields.field('fld_title').setValue('Show').accepted,
                    true
                );
            }, true);
            assert.equal(f.loads.length, 0);
            assert.equal(f.saves.length, 0);
            assert.equal(f.journal.observed.length, 0);
        } finally {
            stop();
            f.close();
        }
    });
});
