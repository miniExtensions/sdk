import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createMiniExtensionsClient } from '../src/runtime/client.js';
import type { TriggerConfiguredButtonWebhookInput } from '../src/runtime/types.js';
import {
    RecoveryJournal,
    type RecoveryAttempt,
    type RecoveryScope,
} from '../src/forms/recovery.js';
import {
    createButtonFieldModel,
    type ButtonFieldData,
} from '../src/ui/buttonModel.js';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};
class TrackingJournal extends RecoveryJournal {
    readonly entries: RecoveryAttempt[] = [];
    override prepare(
        scope: RecoveryScope,
        recordId: string | null,
        loadVersion: number
    ): RecoveryAttempt {
        const attempt = super.prepare(scope, recordId, loadVersion);
        this.entries.push(attempt);
        return attempt;
    }
}
const fixture = (
    configure: (data: ButtonFieldData) => void = () => {},
    journal = new TrackingJournal()
) => {
    let data: ButtonFieldData | null = {
        field: {
            id: 'fld_button',
            name: 'Action',
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: { type: 'button', options: null },
        },
        value: { url: 'action.example.test/path', label: 'Run' },
        config: { openLinkType: 'triggerWebhookPOST' },
        language: 'en',
        source: { type: 'current-record', recordId: 'rec_current' },
        extensionAccessToken: 'fake_button_token',
        visible: true,
    };
    configure(data!);
    let current = true;
    let configuration = 1;
    const listeners = new Set<() => void>();
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'A' },
        fetch: async () => {
            throw Error('Unexpected network');
        },
    });
    const inputs: TriggerConfiguredButtonWebhookInput[] = [];
    client.buttons.triggerWebhook = async (input) => {
        inputs.push(structuredClone(input));
        return { success: true };
    };
    const scope: RecoveryScope = {
        owner: 'A',
        parentFieldId: null,
        tableId: 'tbl_current',
        childExtensionId: 'form',
        context: 'modal',
    };
    const options = {
        client,
        adapter: {
            read: () => data,
            isCurrent: () => current,
            configurationRevision: () => configuration,
            subscribe: (listener: () => void) => {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
        },
        recovery: { journal, scope, loadVersion: 1 },
    };
    const model = createButtonFieldModel(options);
    return {
        model,
        client,
        journal,
        scope,
        inputs,
        options,
        data: () => data!,
        notify: () => {
            for (const listener of listeners) listener();
        },
        stale: () => {
            current = false;
        },
        clear: () => {
            data = null;
        },
        configuration: (value: number) => {
            configuration = value;
        },
    };
};

for (const mode of [undefined, '_self', '_blank', '_parent'] as const) {
    it(`link mode ${mode ?? 'default'} prepares a safe descriptor without a request`, async () => {
        const f = fixture((data) => {
            data.config = { openLinkType: mode };
        });
        const snapshot = f.model.getSnapshot();
        assert.equal(snapshot.canLink, true);
        assert.equal(snapshot.canTrigger, false);
        assert.deepEqual(f.model.prepareLink(snapshot.revision), {
            href: 'https://action.example.test/path',
            target: mode ?? '_blank',
            rel: 'noreferrer',
        });
        assert.equal(
            (await f.model.triggerWebhook(snapshot.revision)).type,
            'refused'
        );
        assert.equal(f.inputs.length, 0);
        assert.equal(f.journal.entries.length, 0);
        f.model.dispose();
    });
}
for (const url of [
    'https://example.test',
    'http://example.test',
    'mailto:person@example.test',
    'tel:12345',
    '/relative',
]) {
    it(`preserves canonical URL ${url}`, () => {
        const f = fixture((data) => {
            data.config = {};
            data.value!.url = url;
        });
        assert.equal(
            f.model.prepareLink(f.model.getSnapshot().revision)?.href,
            url
        );
        f.model.dispose();
    });
}
for (const reason of ['hidden', 'null-value', 'missing-source'] as const) {
    it(`${reason} refuses without creating journal or transport work`, async () => {
        const f = fixture((data) => {
            if (reason === 'hidden') data.visible = false;
            if (reason === 'null-value') data.value = null;
            if (reason === 'missing-source') data.source = null;
        });
        assert.equal(
            (await f.model.triggerWebhook(f.model.getSnapshot().revision)).type,
            'refused'
        );
        assert.equal(f.inputs.length, 0);
        assert.equal(f.journal.entries.length, 0);
        f.model.dispose();
    });
}
for (const mode of ['triggerWebhookGET', 'triggerWebhookPOST'] as const) {
    it(`${mode} dispatches canonical current-record source for computed readonly data`, async () => {
        const f = fixture((data) => {
            data.config = {
                openLinkType: mode,
                readOnly: true,
                triggerWebhookSuccessMessage: '',
            } as ButtonFieldData['config'] & { readOnly: boolean };
        });
        assert.equal(f.model.getSnapshot().canTrigger, true);
        assert.equal(f.model.prepareLink(f.model.getSnapshot().revision), null);
        assert.equal(
            (await f.model.triggerWebhook(f.model.getSnapshot().revision)).type,
            'reported-success'
        );
        assert.deepEqual(f.inputs, [
            {
                extensionAccessToken: 'fake_button_token',
                fieldId: 'fld_button',
                source: { type: 'current-record', recordId: 'rec_current' },
            },
        ]);
        assert.equal(f.journal.entries[0]!.operation, 'button');
        assert.equal(f.journal.entries[0]!.outcome, 'webhook-success');
        assert.deepEqual(f.model.getSnapshot().feedback, {
            kind: 'success',
            text: '',
        });
        f.model.dispose();
    });
}
it('linked-record context passes through without synthesizing a current record', async () => {
    const source = {
        type: 'linked-record' as const,
        linkedRecordId: 'rec_child',
        linkedTableId: 'tbl_children',
        parentLinkedRecordFieldId: 'fld_children',
        selectedCustomViewId: 'view_current',
    };
    const f = fixture((data) => {
        data.source = source;
    });
    await f.model.triggerWebhook(f.model.getSnapshot().revision);
    assert.deepEqual(f.inputs[0]!.source, source);
    f.model.dispose();
});
it('claims a single flight before publishing pending state, including reentrant clicks', async () => {
    const f = fixture();
    const held = deferred<{ success: boolean }>();
    f.client.buttons.triggerWebhook = (input) => {
        f.inputs.push(input);
        return held.promise;
    };
    const duplicates: Promise<unknown>[] = [];
    const stop = f.model.subscribe((state) => {
        if (state.phase === 'pending')
            duplicates.push(f.model.triggerWebhook(state.revision));
    });
    const running = f.model.triggerWebhook(f.model.getSnapshot().revision);
    assert.equal(f.inputs.length, 1);
    assert.equal(
        (await f.model.triggerWebhook(f.model.getSnapshot().revision)).type,
        'refused'
    );
    held.resolve({ success: true });
    assert.equal((await running).type, 'reported-success');
    for (const result of await Promise.all(duplicates))
        assert.equal((result as { type: string }).type, 'refused');
    assert.equal(f.journal.entries.length, 1);
    stop();
    f.model.dispose();
});
it('reentrant cancellation during pending publication proves no dispatch', async () => {
    const f = fixture();
    const stop = f.model.subscribe((state) => {
        if (state.phase === 'pending') f.model.cancel(state.revision);
    });
    await f.model.triggerWebhook(f.model.getSnapshot().revision);
    assert.equal(f.inputs.length, 0);
    assert.equal(f.journal.entries.length, 1);
    assert.equal(f.journal.entries[0]!.outcome, 'not-dispatched');
    assert.equal(f.journal.entries[0]!.flight, false);
    assert.equal(f.journal.blocking(f.scope, 'rec_current'), undefined);
    stop();
    f.model.dispose();
});
for (const ending of ['false', 'error', 'cancel'] as const) {
    it(`${ending} preserves uncertainty and requires settled explicit new intent`, async () => {
        const f = fixture((data) => {
            data.config!.triggerWebhookErrorMessage = '';
        });
        const held = deferred<{ success: boolean }>();
        f.client.buttons.triggerWebhook = (input) => {
            f.inputs.push(input);
            return held.promise;
        };
        const running = f.model.triggerWebhook(f.model.getSnapshot().revision);
        if (ending === 'cancel') {
            assert.equal(f.model.cancel(f.model.getSnapshot().revision), true);
            assert.equal(
                f.model.acknowledgeNewIntent(f.model.getSnapshot().revision),
                false
            );
        }
        if (ending === 'false') held.resolve({ success: false });
        else held.reject(Error('Lost response with fake_button_token'));
        assert.equal((await running).type, 'uncertain');
        assert.equal(f.model.getSnapshot().phase, 'uncertain');
        assert.deepEqual(f.model.getSnapshot().feedback, {
            kind: 'error',
            text: '',
        });
        assert.equal(f.journal.unknown('A').length, 1);
        assert.equal(f.journal.entries[0]!.flight, false);
        assert.equal(
            (await f.model.triggerWebhook(f.model.getSnapshot().revision)).type,
            'refused'
        );
        assert.equal(f.inputs.length, 1);
        assert.equal(
            f.model.acknowledgeNewIntent(f.model.getSnapshot().revision),
            true
        );
        assert.equal(f.journal.entries[0]!.outcome, 'unknown');
        assert.equal(f.journal.entries[0]!.acknowledgment, 'new-intent');
        f.client.buttons.triggerWebhook = async (input) => {
            f.inputs.push(input);
            return { success: true };
        };
        assert.equal(
            (await f.model.triggerWebhook(f.model.getSnapshot().revision)).type,
            'reported-success'
        );
        assert.equal(f.inputs.length, 2);
        f.model.dispose();
    });
}
for (const change of [
    'stale',
    'null',
    'token',
    'source',
    'value',
    'config',
    'configuration-aba',
    'session',
    'session-aba',
    'dispose',
] as const) {
    it(`observed ${change} permanently retires old intent and isolates late completion`, async () => {
        const f = fixture();
        const held = deferred<{ success: boolean }>();
        f.client.buttons.triggerWebhook = (input) => {
            f.inputs.push(input);
            return held.promise;
        };
        const old = f.model.getRenderProps();
        const running = f.model.triggerWebhook(f.model.getSnapshot().revision);
        if (change === 'stale') f.stale();
        if (change === 'null') f.clear();
        if (change === 'token') f.data().extensionAccessToken = 'replacement';
        if (change === 'source')
            f.data().source = { type: 'current-record', recordId: 'rec_other' };
        if (change === 'value')
            f.data().value!.url = 'replacement.example.test';
        if (change === 'config') f.data().config!.buttonColor = 'gray';
        if (change === 'configuration-aba') {
            f.configuration(2);
            f.notify();
            f.configuration(1);
        }
        if (change === 'session' || change === 'session-aba') {
            f.client.setSession({ visitor: 'B' });
            f.model.getSnapshot();
            if (change === 'session-aba') f.client.setSession({ visitor: 'A' });
        }
        if (change === 'dispose') f.model.dispose();
        else f.notify();
        assert.equal(f.model.getSnapshot().phase, 'retired');
        const successor = createButtonFieldModel(f.options);
        const before = successor.getSnapshot();
        held.resolve({ success: true });
        await running;
        assert.equal(f.model.getSnapshot().phase, 'retired');
        const after = successor.getSnapshot();
        assert.equal(after.phase, before.phase);
        assert.equal(after.revision, before.revision);
        assert.deepEqual(after.feedback, before.feedback);
        assert.deepEqual(after.field, before.field);
        assert.deepEqual(after.value, before.value);
        assert.deepEqual(after.config, before.config);
        assert.equal(
            (await f.model.triggerWebhook(old.revision)).type,
            'refused'
        );
        assert.equal(f.inputs.length, 1);
        successor.dispose();
        f.model.dispose();
    });
}
it('safe snapshots are detached and renderer remount preserves the shared pending intent', async () => {
    const f = fixture();
    const snapshot = f.model.getSnapshot();
    snapshot.value!.label = 'mutated';
    snapshot.config!.openLinkType = '_self';
    snapshot.field!.name = 'mutated';
    assert.equal(f.model.getSnapshot().value!.label, 'Run');
    assert.equal(f.model.getSnapshot().field!.name, 'Action');
    assert.equal(
        f.model.getSnapshot().config!.openLinkType,
        'triggerWebhookPOST'
    );
    const props = f.model.getRenderProps();
    assert.equal('extensionAccessToken' in props, false);
    assert.equal('source' in props, false);
    assert.equal(JSON.stringify(props).includes('fake_button_token'), false);
    const held = deferred<{ success: boolean }>();
    f.client.buttons.triggerWebhook = (input) => {
        f.inputs.push(input);
        return held.promise;
    };
    const stop = f.model.subscribe(() => {});
    const running = f.model.triggerWebhook(props.revision);
    stop();
    const remounted = f.model.getRenderProps();
    assert.equal(remounted.busy, true);
    assert.equal(
        (await f.model.triggerWebhook(remounted.revision)).type,
        'refused'
    );
    held.resolve({ success: true });
    await running;
    assert.equal(f.inputs.length, 1);
    assert.equal(f.model.prepareLink(props.revision), null);
    f.model.dispose();
});

it('recreated model observes unresolved journal work without replaying it', async () => {
    const f = fixture();
    f.client.buttons.triggerWebhook = async (input) => {
        f.inputs.push(input);
        return { success: false };
    };
    await f.model.triggerWebhook(f.model.getSnapshot().revision);
    f.model.dispose();
    const recreated = createButtonFieldModel(f.options);
    assert.equal(
        (await recreated.triggerWebhook(recreated.getSnapshot().revision)).type,
        'refused'
    );
    assert.equal(f.inputs.length, 1);
    assert.equal(f.journal.entries.length, 1);
    assert.equal(
        recreated.acknowledgeNewIntent(recreated.getSnapshot().revision),
        true
    );
    f.client.buttons.triggerWebhook = async (input) => {
        f.inputs.push(input);
        return { success: true };
    };
    assert.equal(
        (await recreated.triggerWebhook(recreated.getSnapshot().revision)).type,
        'reported-success'
    );
    assert.equal(f.inputs.length, 2);
    recreated.dispose();
});

it('render actions bind the captured revision and never retain a live successor lease', async () => {
    const f = fixture((data) => {
        data.config = {};
    });
    const props = f.model.getRenderProps();
    assert.equal(props.prepareLink()?.target, '_blank');
    f.configuration(2);
    f.notify();
    assert.equal(props.prepareLink(), null);
    assert.equal((await props.triggerWebhook()).type, 'refused');
    assert.equal(props.cancel(), false);
    assert.equal(props.acknowledgeNewIntent(), false);
    assert.equal(f.inputs.length, 0);
    assert.equal(f.journal.entries.length, 0);
    f.model.dispose();
});

it('a reentrant owner replacement before transport settles only the exact attempt as not-dispatched', async () => {
    const f = fixture();
    const stop = f.model.subscribe((state) => {
        if (state.phase === 'pending') {
            f.stale();
            f.notify();
        }
    });
    assert.equal(
        (await f.model.triggerWebhook(f.model.getSnapshot().revision)).type,
        'refused'
    );
    assert.equal(f.model.getSnapshot().phase, 'retired');
    assert.equal(f.inputs.length, 0);
    assert.equal(f.journal.entries.length, 1);
    assert.equal(f.journal.entries[0]!.outcome, 'not-dispatched');
    assert.equal(f.journal.entries[0]!.flight, false);
    assert.equal(f.journal.entries[0]!.retainedInput.length, 0);
    stop();
    f.model.dispose();
});

it('recovery metadata never retains URLs, labels, session credentials, or error contents', async () => {
    const f = fixture();
    f.client.buttons.triggerWebhook = async () => {
        throw Error('fake_button_token action.example.test/path');
    };
    await f.model.triggerWebhook(f.model.getSnapshot().revision);
    const retained = JSON.stringify(f.journal.entries);
    for (const sensitive of [
        'fake_button_token',
        'action.example.test',
        'Run',
        'visitor',
    ])
        assert.equal(retained.includes(sensitive), false);
    assert.deepEqual(f.model.getSnapshot().feedback, {
        kind: 'error',
        text: null,
    });
    f.model.dispose();
});

it('a late reported success after cancellation settles the old journal without success feedback', async () => {
    const f = fixture();
    const held = deferred<{ success: boolean }>();
    f.client.buttons.triggerWebhook = (input) => {
        f.inputs.push(input);
        return held.promise;
    };
    const running = f.model.triggerWebhook(f.model.getSnapshot().revision);
    assert.equal(f.model.cancel(f.model.getSnapshot().revision), true);
    assert.equal(f.model.getSnapshot().phase, 'uncertain');
    assert.equal(f.model.getSnapshot().busy, true);
    assert.equal(f.journal.entries[0]!.outcome, 'unknown');
    held.resolve({ success: true });
    assert.equal((await running).type, 'uncertain');
    assert.equal(f.journal.entries[0]!.outcome, 'webhook-success');
    assert.equal(f.journal.entries[0]!.flight, false);
    assert.equal(f.model.getSnapshot().phase, 'uncertain');
    assert.notEqual(f.model.getSnapshot().feedback?.kind, 'success');
    assert.equal(
        f.model.acknowledgeNewIntent(f.model.getSnapshot().revision),
        false
    );
    f.model.dispose();
});

for (const callback of [
    'isCurrent',
    'read',
    'configurationRevision',
    'session',
] as const) {
    it(`cancellation inside final ${callback} lease callback is proven not dispatched`, async () => {
        const f = fixture();
        let armed = false,
            pendingRevision = -1;
        const stop = f.model.subscribe((state) => {
            if (state.phase === 'pending') {
                armed = true;
                pendingRevision = state.revision;
            }
        });
        const cancel = () => {
            if (!armed) return;
            armed = false;
            assert.equal(f.model.cancel(pendingRevision), true);
        };
        if (callback === 'session') {
            const original = f.client.getSession;
            f.client.getSession = () => {
                cancel();
                return original();
            };
        } else {
            const original = f.options.adapter[callback];
            // Test each correctly typed callback independently, without changing host data.
            if (callback === 'isCurrent')
                f.options.adapter.isCurrent = () => {
                    cancel();
                    return (original as () => boolean)();
                };
            if (callback === 'read')
                f.options.adapter.read = () => {
                    cancel();
                    return (original as () => ButtonFieldData | null)();
                };
            if (callback === 'configurationRevision')
                f.options.adapter.configurationRevision = () => {
                    cancel();
                    return (original as () => number)();
                };
        }
        const result = await f.model.triggerWebhook(
            f.model.getSnapshot().revision
        );
        assert.equal(result.type, 'refused');
        assert.equal(f.inputs.length, 0);
        assert.equal(f.journal.entries.length, 1);
        assert.equal(f.journal.entries[0]!.outcome, 'not-dispatched');
        assert.equal(f.journal.entries[0]!.flight, false);
        assert.equal(f.model.getSnapshot().phase, 'idle');
        assert.equal(f.model.getSnapshot().busy, false);
        stop();
        f.model.dispose();
    });
}
