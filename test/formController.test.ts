import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    createFormController,
    FormControllerError,
    FormDraftStore,
    openLoadedFormDraft,
    type FormController,
    type FormControllerOptions,
    type FormOwnerScope,
} from '../src/forms/index.js';
import {
    createMiniExtensionsClient,
    type AirtableValue,
    type RuntimeRequestOptions,
    type SaveFormInput,
    type SaveFormResult,
} from '../src/runtime/index.js';
import {
    formSaveOptions,
    invalidForm,
    loadedForm,
    savedForm,
} from './formsFixtures.js';

type Call = {
    input: SaveFormInput;
    options: RuntimeRequestOptions | undefined;
};
const fixture = (
    respond: (call: Call) => Promise<SaveFormResult> = async () => savedForm()
) => {
    const calls: Call[] = [];
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        publishableKey: 'publishable_example',
        session: { visitor: 'visitor_A' },
        fetch: async () => {
            throw new Error('Only the existing save method is expected.');
        },
    });
    client.forms.save = (input, options) => {
        const call = { input, options };
        calls.push(call);
        return respond(call);
    };
    let scope: FormOwnerScope = { ownerId: 'visitor_A', revision: 0 };
    const store = new FormDraftStore<AirtableValue>();
    const loaded = loadedForm();
    const saveOptions = formSaveOptions();
    const options: FormControllerOptions = {
        client,
        store,
        loaded,
        saveOptions,
        getScope: () => scope,
    };
    const controller = createFormController(options);
    return {
        controller,
        client,
        calls,
        store,
        loaded,
        saveOptions,
        options,
        setScope: (next: FormOwnerScope) => {
            scope = next;
        },
    };
};
const deferred = () => {
    let resolve!: (value: SaveFormResult) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<SaveFormResult>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
const errorCode = (code: FormControllerError['code']) => (error: unknown) =>
    error instanceof FormControllerError && error.code === code;

describe('headless Form controller', () => {
    it('submits a copied complete native draft through forms.save with captured visitor credentials', async () => {
        const f = fixture();
        const baseline = structuredClone(f.loaded.payload.formRecord.data);
        assert.equal(f.controller.write('fld_title', 'Draft title'), true);
        const attachment = [
            {
                url: 'https://files.example.test/new.txt',
                filename: 'new.txt',
                size: 0,
            },
        ];
        f.controller.write('fld_files', attachment);
        attachment[0].filename = 'Caller mutation';
        f.loaded.payload.extensionAccessToken = 'Caller token mutation';
        f.saveOptions.captchaVal = 'Caller captcha mutation';
        f.saveOptions.searchQuery.repeated = ['Caller query mutation'];
        const normalized = await f.controller.save();
        assert.equal(f.calls.length, 1);
        assert.deepEqual(f.calls[0].input, {
            ...formSaveOptions(),
            extensionAccessToken: 'access_example',
            formRecord: {
                type: 'create',
                data: {
                    ...baseline,
                    fld_title: 'Draft title',
                    fld_files: [
                        {
                            url: 'https://files.example.test/new.txt',
                            filename: 'new.txt',
                            size: 0,
                        },
                    ],
                },
            },
            formFieldIdsWithUnsavedChanges: [
                'fld_parent',
                'fld_prefill',
                'fld_title',
                'fld_files',
            ],
        });
        assert.deepEqual(f.calls[0].options?.session, { visitor: 'visitor_A' });
        assert.ok(f.calls[0].options?.signal instanceof AbortSignal);
        assert.equal(normalized.type, 'saved');
        assert.deepEqual(f.controller.getState().draft?.dirtyFieldIds, []);
        assert.equal(
            f.controller.getState().draft?.data.fld_title,
            'Draft title'
        );
        assert.equal(f.controller.getState().canSave, false);
        await assert.rejects(f.controller.save(), errorCode('reload-required'));
        assert.equal(f.calls.length, 1);
    });

    it('guards overlapping saves and preserves every draft edit made while a request is pending', async () => {
        const pending = deferred();
        const f = fixture(() => pending.promise);
        const handle = openLoadedFormDraft({
            store: f.store,
            loaded: f.loaded,
        });
        f.controller.write('fld_title', 'Submitted title');
        const saving = f.controller.save();
        await assert.rejects(
            f.controller.save(),
            errorCode('save-in-progress')
        );
        f.store.write(handle, 'fld_title', 'Newer title');
        pending.resolve(savedForm());
        await saving;
        const state = f.controller.getState();
        assert.equal(state.status, 'saved');
        assert.equal(state.hasNewerEdits, true);
        assert.equal(state.draft?.data.fld_title, 'Newer title');
        assert.deepEqual(state.draft?.dirtyFieldIds, [
            'fld_parent',
            'fld_prefill',
            'fld_title',
        ]);
        assert.equal(f.store.snapshot(handle)?.data.fld_title, 'Newer title');
        assert.equal(
            f.calls[0].input.formRecord.data.fld_title,
            'Submitted title'
        );
        assert.equal(f.calls.length, 1);
        await assert.rejects(f.controller.save(), errorCode('reload-required'));
    });

    it('keeps validation errors, concurrent errors and dirty values until an explicit corrected save', async () => {
        let number = 0;
        const f = fixture(async () =>
            ++number === 1 ? invalidForm() : savedForm()
        );
        f.controller.write('fld_title', null);
        const first = await f.controller.save();
        assert.equal(first.type, 'error');
        assert.equal(f.calls.length, 1);
        assert.equal(f.controller.getState().status, 'validation-error');
        assert.equal(f.controller.getState().canSave, true);
        assert.equal(f.controller.getState().validationErrors.length, 3);
        assert.equal(
            f.controller.getState().concurrentEditErrorMessage,
            'The record changed. Reload and review.'
        );
        assert.equal(f.controller.getState().draft?.data.fld_title, null);
        f.controller.write('fld_title', 'Corrected title');
        const second = await f.controller.save();
        assert.equal(second.type, 'saved');
        assert.equal(f.calls.length, 2);
        assert.deepEqual(f.controller.getState().validationErrors, []);
        assert.equal(
            f.controller.getState().result?.postSubmissionWarnings[0].type,
            'adminNotificationEmailFailed'
        );
    });

    it('makes an uncertain transport failure explicit and requires fresh load rather than retrying automatically', async () => {
        const failure = new Error('Synthetic connection interrupted');
        const f = fixture(async () => {
            throw failure;
        });
        f.controller.write('fld_title', 'Retained title');
        await assert.rejects(f.controller.save(), (error) => error === failure);
        assert.equal(f.controller.getState().status, 'transport-error');
        assert.equal(f.controller.getState().errorMessage, failure.message);
        assert.equal(
            f.controller.getState().draft?.data.fld_title,
            'Retained title'
        );
        await assert.rejects(f.controller.save(), errorCode('reload-required'));
        assert.equal(f.calls.length, 1);
    });

    it('rejects stale credentials before dispatch, clears old handles and starts a fresh visitor only by reset', async () => {
        const f = fixture();
        const oldHandle = openLoadedFormDraft({
            store: f.store,
            loaded: f.loaded,
        });
        f.controller.write('fld_title', 'Visitor A unsaved');
        f.client.setSession({ visitor: 'visitor_B' });
        await assert.rejects(f.controller.save(), errorCode('scope-changed'));
        assert.equal(f.calls.length, 0);
        assert.equal(f.store.snapshot(oldHandle), null);
        assert.equal(f.store.write(oldHandle, 'fld_files', []), false);
        assert.equal(f.controller.getState().draft, null);
        const next = loadedForm();
        next.payload.extensionAccessToken = 'visitor_B_access';
        next.payload.formRecord.data.fld_title = 'Visitor B baseline';
        f.setScope({ ownerId: 'visitor_B', revision: 1 });
        f.controller.reset({ ...f.options, loaded: next });
        assert.equal(
            f.controller.getState().draft?.data.fld_title,
            'Visitor B baseline'
        );
        await f.controller.save();
        assert.deepEqual(f.calls[0].options?.session, { visitor: 'visitor_B' });
        assert.equal(f.calls[0].input.extensionAccessToken, 'visitor_B_access');
    });

    it('rejects an old successful response after visitor scope changes even if the client ignores abort', async () => {
        const pending = deferred();
        const f = fixture(() => pending.promise);
        const saving = f.controller.save();
        f.setScope({ ownerId: 'visitor_B', revision: 1 });
        pending.resolve(savedForm());
        await assert.rejects(saving, errorCode('scope-changed'));
        const state = f.controller.getState();
        assert.equal(state.status, 'stale');
        assert.equal(state.result, null);
        assert.equal(state.draft, null);
        assert.equal(f.calls[0].options?.signal?.aborted, true);
    });

    it('uses owner revision for anonymous and A→B→A transitions that session-content checks cannot detect', () => {
        const f = fixture();
        f.client.setSession({});
        f.controller.reset(f.options);
        const handle = openLoadedFormDraft({
            store: f.store,
            loaded: f.loaded,
        });
        f.client.setSession({ visitor: 'visitor_B' });
        f.client.setSession({});
        f.setScope({ ownerId: 'visitor_A', revision: 2 });
        assert.equal(
            f.controller.write('fld_title', 'Old anonymous update'),
            false
        );
        assert.equal(f.controller.getState().status, 'stale');
        assert.equal(f.store.snapshot(handle), null);
        assert.equal(f.calls.length, 0);
    });

    it('does not let a stale controller erase a newer visitor draft already opened in the same store', () => {
        const f = fixture();
        f.store.clear();
        f.setScope({ ownerId: 'visitor_B', revision: 1 });
        const loaded = loadedForm();
        loaded.payload.formRecord.data.fld_title = 'New visitor baseline';
        const replacement = openLoadedFormDraft({ store: f.store, loaded });
        f.store.write(replacement, 'fld_title', 'New visitor draft');
        assert.equal(f.controller.getState().status, 'stale');
        assert.equal(
            f.store.read(replacement, 'fld_title'),
            'New visitor draft'
        );
        f.controller.reset({ ...f.options, loaded });
        assert.equal(
            f.store.read(replacement, 'fld_title'),
            'New visitor draft'
        );
        assert.equal(
            f.controller.getState().draft?.data.fld_title,
            'New visitor draft'
        );
    });

    it('invalidates an old save on same-scope reset while preserving native draft values', async () => {
        const pending = deferred();
        const f = fixture(() => pending.promise);
        f.controller.write('fld_title', 'Unsaved before reset');
        const saving = f.controller.save();
        f.controller.reset(f.options);
        pending.resolve(savedForm());
        await assert.rejects(saving, errorCode('scope-changed'));
        assert.equal(f.controller.getState().status, 'ready');
        assert.equal(
            f.controller.getState().draft?.data.fld_title,
            'Unsaved before reset'
        );
        assert.equal(f.controller.getState().result, null);
        assert.ok(
            f.controller.getState().draft?.dirtyFieldIds.includes('fld_title')
        );
    });

    it('does not dispatch a pre-aborted signal and preserves a cancelled in-flight draft without pretending rollback', async () => {
        const pending = deferred();
        const f = fixture(() => pending.promise);
        const aborted = new AbortController();
        aborted.abort();
        await assert.rejects(f.controller.save({ signal: aborted.signal }), {
            name: 'AbortError',
        });
        assert.equal(f.calls.length, 0);
        assert.equal(f.controller.getState().status, 'ready');
        f.controller.write('fld_title', 'Keep this draft');
        const saving = f.controller.save();
        f.controller.cancel();
        pending.resolve(savedForm());
        await assert.rejects(saving, errorCode('cancelled'));
        assert.equal(f.controller.getState().status, 'cancelled');
        assert.equal(
            f.controller.getState().draft?.data.fld_title,
            'Keep this draft'
        );
        assert.equal(f.controller.getState().result, null);
        await assert.rejects(f.controller.save(), errorCode('reload-required'));
        assert.equal(f.calls.length, 1);
    });

    it('forwards external cancellation and retires the uncertain save', async () => {
        const pending = deferred();
        const f = fixture(() => pending.promise);
        const external = new AbortController();
        const failure = new Error('Owner cancelled this synthetic save');
        const saving = f.controller.save({ signal: external.signal });
        external.abort(failure);
        assert.equal(f.calls[0].options?.signal?.aborted, true);
        assert.equal(f.calls[0].options?.signal?.reason, failure);
        pending.resolve(savedForm());
        await assert.rejects(saving, (error) => error === failure);
        assert.equal(f.controller.getState().status, 'cancelled');
        assert.equal(f.controller.getState().canSave, false);
    });

    it('blocks unknown, hidden, read-only and computed writes and copies every exposed state', () => {
        const f = fixture();
        for (const id of [
            'fld_unknown',
            'fld_parent',
            'fld_missing',
            'fld_readonly',
            'fld_computed',
        ]) {
            assert.equal(f.controller.write(id, 'Rejected update'), false);
        }
        const state = f.controller.getState();
        state.draft!.data.fld_parent = ['record_mutated'];
        state.fields[0].schema.airtableField.name = 'Mutated by renderer';
        assert.deepEqual(f.controller.getState().draft?.data.fld_parent, [
            'record_parent',
        ]);
        assert.equal(
            f.controller.getState().fields[0].schema.airtableField.name,
            'Title'
        );
    });

    it('validates constructor/reset before creating or clearing any visitor draft', () => {
        class CountingStore extends FormDraftStore<AirtableValue> {
            count = 0;
            override open(
                ...args: Parameters<FormDraftStore<AirtableValue>['open']>
            ) {
                this.count += 1;
                return super.open(...args);
            }
        }
        const f = fixture();
        const store = new CountingStore();
        const badOptions = {
            ...f.options,
            store,
            saveOptions: { ...f.saveOptions, isComputeMode: undefined },
        } as unknown as FormControllerOptions;
        assert.throws(() => createFormController(badOptions), TypeError);
        assert.equal(store.count, 0);
        const oldHandle = openLoadedFormDraft({
            store: f.store,
            loaded: f.loaded,
        });
        f.controller.write('fld_title', 'Keep through invalid reset');
        f.setScope({ ownerId: 'visitor_B', revision: 1 });
        assert.throws(
            () => f.controller.reset({ ...badOptions, store: f.store }),
            TypeError
        );
        assert.equal(
            f.store.read(oldHandle, 'fld_title'),
            'Keep through invalid reset'
        );
    });

    it('adopts a fresh loaded baseline after success when there are no newer writes', async () => {
        const f = fixture();
        const oldHandle = openLoadedFormDraft({
            store: f.store,
            loaded: f.loaded,
        });
        await f.controller.save();
        const fresh = loadedForm();
        fresh.payload.formRecord.data.fld_title = 'Canonical fresh load';
        fresh.payload.formFieldIdsWithUnsavedChanges = [];
        fresh.payload.urlPrefilledFieldIds = [];
        f.controller.reset({ ...f.options, loaded: fresh });
        assert.equal(f.store.snapshot(oldHandle), null);
        assert.equal(
            f.controller.getState().draft?.data.fld_title,
            'Canonical fresh load'
        );
        assert.deepEqual(f.controller.getState().draft?.dirtyFieldIds, []);
        assert.equal(f.controller.getState().canSave, true);
    });

    it('keeps reentrant abort-handler reset as the newest scope instead of overwriting it with cancel/reset state', async () => {
        for (const action of ['cancel', 'reset', 'scope'] as const) {
            const pending = deferred();
            let controller!: FormController;
            let f!: ReturnType<typeof fixture>;
            const fresh = loadedForm();
            fresh.payload.extensionAccessToken = `fresh_${action}`;
            fresh.payload.formRecord.data.fld_title =
                'Newest abort-handler scope';
            f = fixture((call) => {
                call.options?.signal?.addEventListener(
                    'abort',
                    () => {
                        controller.reset({ ...f.options, loaded: fresh });
                    },
                    { once: true }
                );
                return pending.promise;
            });
            controller = f.controller;
            const saving = controller.save();
            if (action === 'cancel') controller.cancel();
            else if (action === 'reset') controller.reset(f.options);
            else {
                f.setScope({ ownerId: 'visitor_B', revision: 1 });
                controller.getState();
            }
            pending.resolve(savedForm());
            await assert.rejects(saving);
            assert.equal(controller.getState().status, 'ready');
            assert.equal(
                controller.getState().draft?.data.fld_title,
                'Newest abort-handler scope'
            );
            assert.equal(controller.getState().result, null);
        }
    });

    it('rejects a success if a terminal-state subscriber changes owner scope before the awaiting caller resumes', async () => {
        const f = fixture();
        f.controller.subscribe((state) => {
            if (state.status === 'saved')
                f.setScope({ ownerId: 'visitor_B', revision: 1 });
        });
        await assert.rejects(f.controller.save(), errorCode('scope-changed'));
        assert.equal(f.controller.getState().status, 'stale');
        assert.equal(f.controller.getState().result, null);
        assert.equal(f.controller.getState().draft, null);
    });

    it('never gives a later subscriber an old draft/result after another subscriber changes owner or session', async () => {
        for (const change of ['owner', 'session'] as const) {
            for (const transition of ['write', 'saving', 'saved'] as const) {
                const f = fixture();
                let armed = false;
                let changed = false;
                const laterStates: ReturnType<FormController['getState']>[] =
                    [];
                f.controller.subscribe((state) => {
                    if (!armed || changed) return;
                    const match =
                        transition === 'write'
                            ? state.draft?.data.fld_title === 'Written title'
                            : state.status === transition;
                    if (!match) return;
                    changed = true;
                    if (change === 'owner')
                        f.setScope({ ownerId: 'visitor_B', revision: 1 });
                    else f.client.setSession({ visitor: 'visitor_B' });
                });
                f.controller.subscribe((state) => {
                    if (changed) laterStates.push(state);
                });
                armed = true;
                if (transition === 'write')
                    f.controller.write('fld_title', 'Written title');
                else
                    await assert.rejects(
                        f.controller.save(),
                        errorCode('scope-changed')
                    );
                assert.ok(laterStates.length > 0);
                assert.ok(
                    laterStates.every(
                        (state) =>
                            state.draft === null &&
                            state.result === null &&
                            state.fields.length === 0
                    )
                );
                assert.equal(f.controller.getState().status, 'stale');
            }
        }
    });

    it('stops an older emission when a subscriber performs a nested write or reset', () => {
        for (const action of ['write', 'reset'] as const) {
            const f = fixture();
            let changed = false;
            const laterTitles: unknown[] = [];
            f.controller.subscribe((state) => {
                if (changed || state.draft?.data.fld_title !== 'First write')
                    return;
                changed = true;
                if (action === 'write')
                    f.controller.write('fld_title', 'Newest write');
                else {
                    const fresh = loadedForm();
                    fresh.payload.extensionAccessToken = 'fresh_reset_token';
                    fresh.payload.formRecord.data.fld_title = 'Newest reset';
                    f.controller.reset({ ...f.options, loaded: fresh });
                }
            });
            f.controller.subscribe((state) => {
                if (changed) laterTitles.push(state.draft?.data.fld_title);
            });
            f.controller.write('fld_title', 'First write');
            assert.deepEqual(laterTitles, [
                action === 'write' ? 'Newest write' : 'Newest reset',
            ]);
        }
    });

    it('stops an old emission immediately when a subscriber destroys the controller', () => {
        const f = fixture();
        let disposed = false;
        let staleDelivery = false;
        f.controller.subscribe((state) => {
            if (state.draft?.data.fld_title === 'Dispose now') {
                disposed = true;
                f.controller.destroy();
            }
        });
        f.controller.subscribe((state) => {
            if (disposed && state.draft !== null) staleDelivery = true;
        });
        f.controller.write('fld_title', 'Dispose now');
        assert.equal(f.controller.getState().status, 'disposed');
        assert.equal(staleDelivery, false);
    });

    it('does not call a subscriber removed by an earlier callback in the same emission', () => {
        const f = fixture();
        let unsubscribeLater = () => {};
        let callbacksAfterUnsubscribe = 0;
        f.controller.subscribe((state) => {
            if (state.draft?.data.fld_title === 'Unsubscribe later')
                unsubscribeLater();
        });
        unsubscribeLater = f.controller.subscribe((state) => {
            if (state.draft?.data.fld_title === 'Unsubscribe later')
                callbacksAfterUnsubscribe += 1;
        });
        f.controller.write('fld_title', 'Unsubscribe later');
        assert.equal(callbacksAfterUnsubscribe, 0);
    });

    it('cannot revive a disposed controller through an abort handler or accept its old completion', async () => {
        const pending = deferred();
        const f = fixture((call) => {
            call.options?.signal?.addEventListener(
                'abort',
                () => {
                    assert.throws(
                        () => f.controller.reset(f.options),
                        errorCode('disposed')
                    );
                },
                { once: true }
            );
            return pending.promise;
        });
        const saving = f.controller.save();
        f.controller.destroy();
        pending.resolve(savedForm());
        await assert.rejects(saving, errorCode('disposed'));
        assert.equal(f.controller.getState().status, 'disposed');
        assert.equal(f.controller.getState().draft, null);
        assert.equal(f.controller.write('fld_title', 'Late write'), false);
        await assert.rejects(f.controller.save(), errorCode('disposed'));
    });
});
