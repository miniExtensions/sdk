import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createFormController,
    RecoveryJournal,
    type FormSaveDisposition,
    type RecoveryAttempt,
} from '../src/forms/index.js';
import {
    createMiniExtensionsClient,
    type SaveFormResult,
} from '../src/runtime/index.js';
import { loadedForm, formSaveOptions, savedForm } from './formsFixtures.js';

const scope = {
    owner: 'A',
    parentFieldId: null,
    tableId: null,
    childExtensionId: 'form',
    context: 'modal' as const,
};
const fixture = () => {
    let calls = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        fetch: async () => {
            throw Error('No network');
        },
    });
    let respond: () => Promise<SaveFormResult> = async () => savedForm();
    client.forms.save = async () => {
        calls++;
        return respond();
    };
    const options = {
        client,
        loaded: loadedForm(),
        saveOptions: formSaveOptions(),
        getScope: () => ({ ownerId: 'A', revision: 0 }),
    };
    const controller = createFormController(options);
    const journal = new RecoveryJournal();
    const dispositions: FormSaveDisposition[] = [];
    let attempt: RecoveryAttempt | undefined;
    const lifecycle = (hook: () => void = () => {}) => ({
        dispatch() {
            attempt = journal.begin(scope, null, 'save', 1);
            attempt.retainedInput = [{ title: 'Reference', value: 'Draft' }];
            hook();
            return {
                accepted: () => journal.accepted(attempt!, 'saved'),
                finish: (disposition: FormSaveDisposition) => {
                    dispositions.push(disposition);
                    if (disposition === 'not-dispatched')
                        journal.notDispatched(attempt!);
                    else journal.finishFlight(attempt!);
                },
            };
        },
    });
    return {
        client,
        options,
        controller,
        journal,
        dispositions,
        lifecycle,
        get attempt() {
            return attempt;
        },
        get calls() {
            return calls;
        },
        respond: (next: typeof respond) => {
            respond = next;
        },
    };
};
it('withdrawal after hook proves no dispatch, preserves native draft and permits only a new explicit Save', async () => {
    const f = fixture();
    let live = true;
    f.controller.write('fld_title', 'Owned draft');
    const before = f.controller.getState().draft;
    await assert.rejects(
        f.controller.save({
            isCurrent: () => live,
            lifecycle: f.lifecycle(() => {
                live = false;
            }),
        })
    );
    assert.equal(f.calls, 0);
    assert.deepEqual(f.dispositions, ['not-dispatched']);
    assert.equal(f.attempt!.outcome, 'not-dispatched');
    assert.equal(f.attempt!.acknowledgment, 'none');
    assert.deepEqual(f.attempt!.retainedInput, []);
    assert.equal(f.journal.blocking(scope, null), undefined);
    assert.deepEqual(f.controller.getState().draft, before);
    assert.equal(f.controller.getState().status, 'ready');
    const old = f.attempt!;
    live = true;
    await f.controller.save({ lifecycle: f.lifecycle() });
    assert.equal(f.calls, 1);
    assert.notEqual(f.attempt!.id, old.id);
    assert.deepEqual(f.dispositions, ['not-dispatched', 'dispatched']);
    f.controller.destroy();
});
it('hook reset preserves successor B and retires only the old no-dispatch operation', async () => {
    const f = fixture();
    const b = loadedForm();
    b.payload.extensionAccessToken = 'token_B';
    b.payload.formRecord.data.fld_title = 'Successor';
    await assert.rejects(
        f.controller.save({
            lifecycle: f.lifecycle(() =>
                f.controller.reset({ ...f.options, loaded: b })
            ),
        })
    );
    assert.equal(f.calls, 0);
    assert.deepEqual(f.dispositions, ['not-dispatched']);
    assert.equal(f.attempt!.outcome, 'not-dispatched');
    assert.equal(f.journal.blocking(scope, null), undefined);
    assert.equal(f.controller.getState().status, 'ready');
    assert.equal(f.controller.getState().draft!.data.fld_title, 'Successor');
    f.controller.destroy();
});
it('hook cancellation has no remote uncertainty, with old binding generation still retired', async () => {
    const f = fixture();
    await assert.rejects(
        f.controller.save({
            lifecycle: f.lifecycle(() => f.controller.cancel()),
        })
    );
    assert.equal(f.calls, 0);
    assert.deepEqual(f.dispositions, ['not-dispatched']);
    assert.equal(f.journal.blocking(scope, null), undefined);
    assert.equal(f.controller.getState().status, 'cancelled');
    await assert.rejects(f.controller.save());
    assert.equal(f.calls, 0);
    f.controller.destroy();
});
it('invoked transport that throws synchronously remains dispatched and unknown with no retry', async () => {
    const f = fixture();
    f.client.forms.save = () => {
        throw Error('Transport rejected');
    };
    await assert.rejects(f.controller.save({ lifecycle: f.lifecycle() }));
    assert.deepEqual(f.dispositions, ['dispatched']);
    assert.equal(f.attempt!.outcome, 'unknown');
    assert.equal(f.attempt!.flight, false);
    assert.equal(f.journal.blocking(scope, null), f.attempt);
    assert.equal(f.journal.notDispatched(f.attempt!), false);
    await assert.rejects(f.controller.save());
    f.controller.destroy();
});
it('real dispatched cancellation and late response retain uncertainty without touching successor', async () => {
    const f = fixture();
    let release!: (v: SaveFormResult) => void;
    f.respond(
        () =>
            new Promise((resolve) => {
                release = resolve;
            })
    );
    const saving = f.controller.save({ lifecycle: f.lifecycle() });
    const rejected = assert.rejects(saving);
    assert.equal(f.calls, 1);
    f.controller.cancel();
    const b = loadedForm();
    b.payload.extensionAccessToken = 'token_B';
    b.payload.formRecord.data.fld_title = 'New owner';
    f.controller.reset({ ...f.options, loaded: b });
    release(savedForm());
    await rejected;
    assert.deepEqual(f.dispositions, ['dispatched']);
    assert.equal(f.attempt!.outcome, 'unknown');
    assert.equal(f.journal.blocking(scope, null), f.attempt);
    assert.equal(f.controller.getState().status, 'ready');
    assert.equal(f.controller.getState().draft!.data.fld_title, 'New owner');
    f.controller.destroy();
});
it('known-no-dispatch finish callback reentry cannot clear or mark a successor failed', async () => {
    const f = fixture();
    let live = true;
    const base = f.lifecycle(() => {
        live = false;
    });
    await assert.rejects(
        f.controller.save({
            isCurrent: () => live,
            lifecycle: {
                dispatch() {
                    const operation = base.dispatch();
                    return {
                        ...operation,
                        finish(disposition: FormSaveDisposition) {
                            operation.finish(disposition);
                            const b = loadedForm();
                            b.payload.extensionAccessToken = 'token_B';
                            b.payload.formRecord.data.fld_title =
                                'Finish successor';
                            f.controller.reset({ ...f.options, loaded: b });
                            throw Error('Renderer cleanup');
                        },
                    };
                },
            },
        })
    );
    assert.equal(f.calls, 0);
    assert.equal(f.attempt!.outcome, 'not-dispatched');
    assert.equal(
        f.controller.getState().draft!.data.fld_title,
        'Finish successor'
    );
    assert.equal(f.controller.getState().status, 'ready');
    f.controller.destroy();
});
it('journal disposition fails closed for foreign, settled, acknowledged or completed attempts', () => {
    const a = new RecoveryJournal(),
        b = new RecoveryJournal();
    const foreign = b.begin(scope, null, 'save', 1);
    assert.equal(a.notDispatched(foreign), false);
    const pending = a.begin(scope, null, 'save', 1);
    a.finishFlight(pending);
    assert.equal(a.notDispatched(pending), false);
    a.acknowledgeNewIntent(pending);
    assert.equal(a.notDispatched(pending), false);
    const accepted = a.begin(scope, null, 'save', 2);
    a.accepted(accepted, 'saved');
    assert.equal(a.notDispatched(accepted), false);
    const noSend = a.begin(scope, null, 'save', 3);
    assert.equal(a.notDispatched(noSend), true);
    assert.equal(a.notDispatched(noSend), false);
    const next = a.begin(scope, null, 'save', 4, null, noSend);
    assert.notEqual(next.id, noSend.id);
});
