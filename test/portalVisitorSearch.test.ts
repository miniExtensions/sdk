import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createPortalVisitorSearchDraft,
    type PortalVisitorSearchCommand,
    type PortalVisitorSearchFrame,
    type PortalVisitorSearchOutcome,
    type PortalVisitorSearchPort,
} from '../src/portals/index.js';

function owner() {
    let frame: PortalVisitorSearchFrame | null = {
        stamp: {
            sessionId: 'portal-session',
            fieldId: 'linked-records',
            viewId: 'current-view',
            configurationRevision: 'configuration',
            metadataRevision: 'metadata',
            generation: 3,
        },
        searchTerm: '  café  ',
    };
    const commands: PortalVisitorSearchCommand[] = [];
    const port: PortalVisitorSearchPort = {
        read: () => frame,
        apply(command) {
            commands.push(command);
            return {
                type: 'allocated',
                requestId: `request-${commands.length}`,
                generation: 4,
            };
        },
    };
    return {
        commands,
        port,
        publish(next: PortalVisitorSearchFrame | null) {
            frame = next;
        },
    };
}

it('leaves the host untouched until a gesture and submits exact, repeated terms', async () => {
    const host = owner();
    const draft = createPortalVisitorSearchDraft(host.port);
    assert.ok(draft);
    assert.deepEqual(host.commands, []);
    assert.equal(draft.frame.searchTerm, '  café  ');

    const intent = { source: 'submit', searchTerm: '  café  ' } as const;
    assert.deepEqual(await draft.submit(intent), {
        type: 'allocated',
        requestId: 'request-1',
        generation: 4,
    });
    assert.deepEqual(await draft.submit(intent), {
        type: 'allocated',
        requestId: 'request-2',
        generation: 4,
    });
    assert.deepEqual(host.commands, [
        { ...intent, stamp: draft.frame.stamp, expectedSearchTerm: '  café  ' },
        { ...intent, stamp: draft.frame.stamp, expectedSearchTerm: '  café  ' },
    ]);
});

it('sends one exact command for clear and one for the scanner result', async () => {
    const host = owner();
    const draft = createPortalVisitorSearchDraft(host.port);
    assert.ok(draft);
    await draft.submit({ source: 'clear' });
    await draft.submit({ source: 'scan', searchTerm: '  001-α\n' });
    assert.deepEqual(host.commands, [
        {
            source: 'clear',
            stamp: draft.frame.stamp,
            expectedSearchTerm: '  café  ',
            searchTerm: '',
        },
        {
            source: 'scan',
            stamp: draft.frame.stamp,
            expectedSearchTerm: '  café  ',
            searchTerm: '  001-α\n',
        },
    ]);
});

it('refuses stale typing and scanner results across scope, change and ABA transitions', async () => {
    const host = owner();
    const draft = createPortalVisitorSearchDraft(host.port);
    assert.ok(draft);
    const { frame } = draft;
    const retiredFrames = [
        null,
        { ...frame, searchTerm: 'updated elsewhere' },
        { ...frame, stamp: { ...frame.stamp, viewId: 'other-view' } },
        { ...frame, stamp: { ...frame.stamp, metadataRevision: 'new' } },
        { ...frame, stamp: { ...frame.stamp, generation: 5 } },
    ];
    for (const next of retiredFrames) {
        host.publish(next);
        assert.equal(draft.current(), false);
        assert.deepEqual(await draft.submit({ source: 'clear' }), {
            type: 'stale',
        });
        assert.deepEqual(
            await draft.submit({ source: 'scan', searchTerm: 'old scan' }),
            { type: 'stale' }
        );
    }
    assert.deepEqual(host.commands, []);
});

it('keeps the frame immutable and classifies a thrown or malformed receipt as uncertain', async () => {
    const host = owner();
    const unavailable = createPortalVisitorSearchDraft({
        ...host.port,
        read: () => {
            throw new Error('read failed');
        },
    });
    assert.equal(unavailable, null);

    let attempts = 0;
    const draft = createPortalVisitorSearchDraft({
        ...host.port,
        apply() {
            attempts += 1;
            if (attempts === 1) throw new Error('transport state unknown');
            return { type: 'allocated', requestId: '', generation: 2 };
        },
    });
    assert.ok(draft);
    assert.ok(Object.isFrozen(draft.frame));
    assert.ok(Object.isFrozen(draft.frame.stamp));
    const intent = { source: 'submit', searchTerm: 'lookup' } as const;
    assert.deepEqual(await draft.submit(intent), { type: 'uncertain' });
    assert.equal(attempts, 1);
    assert.deepEqual(await draft.submit(intent), { type: 'uncertain' });
    assert.equal(attempts, 2);
});

it('preserves a host refusal or stale outcome', async () => {
    const host = owner();
    for (const type of ['refused', 'stale'] as const) {
        const outcome: PortalVisitorSearchOutcome = { type };
        const draft = createPortalVisitorSearchDraft({
            ...host.port,
            apply: async () => outcome,
        });
        assert.ok(draft);
        assert.deepEqual(await draft.submit({ source: 'clear' }), outcome);
    }
});
