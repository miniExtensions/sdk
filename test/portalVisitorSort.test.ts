import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    createPortalVisitorSortDraft,
    type PortalVisitorSortCommand,
    type PortalVisitorSortFrame,
    type PortalVisitorSortOutcome,
    type PortalVisitorSortPort,
} from '../src/portals/index.js';

const stamp = {
    sessionId: 'session-a',
    fieldId: 'linked',
    viewId: 'view-a',
    configurationRevision: 3,
    metadataRevision: 4,
    generation: 7,
};
const fields = [
    { id: 'title', name: 'Title' },
    { id: 'status', name: 'Status' },
    { id: 'priority', name: 'Priority' },
];
const title = {
    type: 'asc',
    idOrName: { type: 'id', id: 'title' },
} as const;
const stale = {
    type: 'desc',
    idOrName: { type: 'id', id: 'lost' },
} as const;
const named = {
    type: 'desc',
    idOrName: { type: 'name', name: 'Status' },
} as const;

function fixture(initial: PortalVisitorSortFrame['criteria'] = []) {
    const commands: PortalVisitorSortCommand[] = [];
    const allocated = {
        type: 'allocated',
        requestId: 'request-1',
        generation: 8,
    } as const;
    let frame: PortalVisitorSortFrame | null = {
        stamp,
        fields,
        criteria: initial,
    };
    let apply = (
        _command: PortalVisitorSortCommand
    ): PortalVisitorSortOutcome | Promise<PortalVisitorSortOutcome> =>
        allocated;
    const port: PortalVisitorSortPort = {
        read: () => frame,
        subscribe: () => () => undefined,
        apply(command) {
            commands.push(command);
            return apply(command);
        },
    };
    const draft = () => {
        const model = createPortalVisitorSortDraft(port);
        assert.ok(model);
        return model;
    };
    return {
        commands,
        allocated,
        port,
        draft,
        setFrame(next: PortalVisitorSortFrame | null) {
            frame = next;
        },
        onApply(next: typeof apply) {
            apply = next;
        },
    };
}

it('appends, edits in place and deletes without changing the remaining rule order', async () => {
    const f = fixture([title, named]);
    const draft = f.draft();
    assert.equal(draft.setField(1, 'title'), false);
    assert.equal(draft.setField(1, 'status'), false);
    assert.equal(draft.add(), 2);
    assert.equal(draft.add(), null);
    assert.deepEqual(
        draft.snapshot().rules.map((rule) => [rule.key, rule.fieldId]),
        [
            [0, 'title'],
            [1, 'status'],
            [2, 'priority'],
        ]
    );
    assert.equal(draft.setDirection(2, 'desc'), true);
    assert.equal(draft.remove(0), true);
    assert.equal(draft.setField(2, 'title'), true);
    assert.deepEqual(
        draft.snapshot().rules.map((rule) => [rule.key, rule.fieldId]),
        [
            [1, 'status'],
            [2, 'title'],
        ]
    );
    assert.deepEqual(f.commands, []);
    assert.deepEqual(await draft.commit(), f.allocated);
    assert.deepEqual(f.commands, [
        {
            stamp,
            criteria: [
                named,
                { type: 'desc', idOrName: { type: 'id', id: 'title' } },
            ],
        },
    ]);
    assert.deepEqual(await draft.commit(), { type: 'stale' });
    assert.equal(f.commands.length, 1);
});

it('keeps missing fields through equal dismissal and unrelated edits until explicitly deleted', async () => {
    const f = fixture([title, stale, named]);
    const unchanged = f.draft();
    assert.deepEqual(
        unchanged.snapshot().rules.map((item) => item.fieldId),
        ['title', null, 'status']
    );
    assert.equal(unchanged.setField(1, 'priority'), false);
    assert.deepEqual(await unchanged.commit(), { type: 'unchanged' });
    assert.equal(f.commands.length, 0);
    const changed = f.draft();
    assert.ok(changed.setDirection(0, 'desc'));
    await changed.commit();
    assert.deepEqual(f.commands[0].criteria, [
        { ...title, type: 'desc' },
        stale,
        named,
    ]);
    const remove = f.draft();
    assert.ok(remove.remove(1));
    await remove.commit();
    assert.deepEqual(f.commands[1].criteria, [title, named]);
});

it('refuses view ABA, metadata change, detached owner and changed criteria before submission', async () => {
    for (const current of [
        { stamp: { ...stamp, generation: 9 }, fields, criteria: [title] },
        { stamp: { ...stamp, metadataRevision: 5 }, fields, criteria: [title] },
        { stamp, fields: fields.slice(0, 2), criteria: [title] },
        { stamp, fields, criteria: [title, named] },
        null,
    ]) {
        const f = fixture([title]);
        const draft = f.draft();
        draft.add();
        f.setFrame(current);
        assert.deepEqual(await draft.commit(), { type: 'stale' });
        assert.deepEqual(f.commands, []);
    }
});

it('retains and displays both existing aliases of the same field without offering duplicates', async () => {
    const alias = {
        ...title,
        idOrName: { type: 'name', name: 'Title' },
    } as const;
    const f = fixture([title, alias]);
    const draft = f.draft();
    const rules = draft.snapshot().rules;
    assert.deepEqual(
        rules.map((rule) => rule.fieldId),
        ['title', 'title']
    );
    for (const rule of rules)
        assert.ok(rule.availableFields.some((field) => field.id === 'title'));
    assert.equal(draft.add(), 2);
    assert.equal(draft.setField(1, 'status'), false);
    assert.equal(draft.snapshot().rules[2].fieldId, 'status');
    assert.ok(draft.remove(2));
    assert.deepEqual(await draft.commit(), { type: 'unchanged' });
    assert.equal(f.commands.length, 0);
});

it('distinguishes definite refusal and lost receipts, with no retry or invented allocation', async () => {
    for (const type of ['refused', 'stale', 'unchanged'] as const) {
        const f = fixture();
        f.onApply(() => ({ type }));
        const draft = f.draft();
        draft.add();
        assert.deepEqual(await draft.commit(), { type });
        assert.equal(f.commands.length, 1);
    }
    const f = fixture();
    f.onApply(async () => {
        throw new Error('lost receipt');
    });
    const draft = f.draft();
    draft.add();
    assert.deepEqual(await draft.commit(), { type: 'uncertain' });
    assert.deepEqual(await draft.commit(), { type: 'stale' });
    assert.equal(f.commands.length, 1);
    const malformed = fixture();
    malformed.onApply(() => ({
        type: 'allocated',
        requestId: '',
        generation: 8,
    }));
    const invalidReceipt = malformed.draft();
    invalidReceipt.add();
    assert.deepEqual(await invalidReceipt.commit(), { type: 'uncertain' });
});
