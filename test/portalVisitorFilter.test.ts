import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createPortalVisitorFilterDraft,
    type PortalVisitorFilterCommand,
    type PortalVisitorFilterFrame,
    type PortalVisitorFilterOutcome,
    type PortalVisitorFilterPort,
} from '../src/portals/visitorFilter.js';
import type {
    RuntimeConditionSetting,
    RuntimeConditionsDefinition,
} from '../src/runtime/types.js';

const title = (value: string): RuntimeConditionSetting => ({
    fieldType: 'singleLineText',
    type: 'contains',
    idOrName: { type: 'id', id: 'title' },
    value,
});
const leaf = (id: string, setting: RuntimeConditionSetting) => ({
    type: 'singleCondition' as const,
    id,
    setting,
});
const known = leaf('known', title('First'));
const missing = leaf('missing', {
    ...title('Legacy'),
    idOrName: { type: 'name', name: 'Deleted' },
});
const former = leaf('former', {
    ...title('Keep'),
    idOrName: { type: 'name', name: 'Former title' },
});
const criteria: RuntimeConditionsDefinition = {
    logicalOperator: 'and',
    conditions: [
        known,
        {
            type: 'groupCondition',
            id: 'group',
            logicalOperator: 'or',
            conditions: [missing, former],
        },
    ],
};

function host() {
    let frame: PortalVisitorFilterFrame = {
        stamp: {
            sessionId: 'owner',
            fieldId: 'linked',
            viewId: 'a',
            configurationRevision: 1,
            metadataRevision: 1,
            generation: 1,
        },
        fields: [
            {
                id: 'title',
                name: 'Title',
                operators: [
                    {
                        label: 'contains',
                        setting: title(''),
                        operand: { kind: 'text' },
                    },
                ],
            },
        ],
        criteria: structuredClone(criteria),
        effectiveSettings: { former: title('Keep') },
    };
    const calls: PortalVisitorFilterCommand[] = [];
    let apply: PortalVisitorFilterPort['apply'] = () => ({
        type: 'allocated',
        requestId: 'request-1',
        generation: 2,
    });
    const port: PortalVisitorFilterPort = {
        read: () => frame,
        subscribe: () => () => {},
        apply(command) {
            calls.push(command);
            return apply(command);
        },
    };
    return {
        port,
        calls,
        read: () => frame,
        update(next: PortalVisitorFilterFrame) {
            frame = next;
        },
        apply(next: PortalVisitorFilterPort['apply']) {
            apply = next;
        },
    };
}

test('a targeted nested edit preserves unresolved siblings, wire ids and order', async () => {
    const owner = host();
    const draft = createPortalVisitorFilterDraft(owner.port)!;
    assert.deepEqual(draft.settingForEditor('former'), title('Keep'));
    assert.equal(draft.setOperand('missing', 'Can’t replace'), false);
    assert.equal(draft.setOperand('former', 'Changed'), true);
    assert.equal(owner.calls.length, 0);
    assert.deepEqual(owner.read().criteria, criteria);
    assert.deepEqual(await draft.commit(), {
        type: 'allocated',
        requestId: 'request-1',
        generation: 2,
    });
    assert.deepEqual(owner.calls, [
        {
            stamp: owner.read().stamp,
            criteria: {
                logicalOperator: 'and',
                conditions: [
                    known,
                    {
                        type: 'groupCondition',
                        id: 'group',
                        logicalOperator: 'or',
                        conditions: [missing, leaf('former', title('Changed'))],
                    },
                ],
            },
        },
    ]);
    await draft.commit();
    assert.equal(owner.calls.length, 1);
});

test('removal applies the host effective projection only to untouched survivors', async () => {
    const owner = host();
    const draft = createPortalVisitorFilterDraft(owner.port)!;
    assert.equal(draft.setOperand('known', 'Own edit'), true);
    assert.equal(draft.remove('missing'), true);
    await draft.commit();
    assert.deepEqual(owner.calls[0].criteria, {
        logicalOperator: 'and',
        conditions: [
            leaf('known', title('Own edit')),
            {
                type: 'groupCondition',
                id: 'group',
                logicalOperator: 'or',
                conditions: [leaf('former', title('Keep'))],
            },
        ],
    });
});

test('same-tree Apply is inert, including a detached snapshot mutation', async () => {
    const owner = host();
    const draft = createPortalVisitorFilterDraft(owner.port)!;
    draft.snapshot().criteria!.conditions.pop();
    assert.equal(draft.setField('known', 'title'), false);
    assert.equal(draft.setOperator('known', 'contains'), false);
    assert.deepEqual(await draft.commit(), { type: 'unchanged' });
    assert.equal(owner.calls.length, 0);
});

test('changing and returning to a view with a later generation retires the old draft', async () => {
    const owner = host();
    const draft = createPortalVisitorFilterDraft(owner.port)!;
    draft.clear();
    owner.update({
        ...owner.read(),
        stamp: { ...owner.read().stamp, viewId: 'b', generation: 2 },
    });
    owner.update({
        ...owner.read(),
        stamp: { ...owner.read().stamp, viewId: 'a', generation: 3 },
    });
    assert.deepEqual(await draft.commit(), { type: 'stale' });
    assert.equal(owner.calls.length, 0);
});

test('one unconfirmed Apply never auto-retries and cannot report over newer ownership', async () => {
    const owner = host();
    let resolve!: (value: PortalVisitorFilterOutcome) => void;
    owner.apply(
        () =>
            new Promise((_resolve) => {
                resolve = _resolve;
            })
    );
    const draft = createPortalVisitorFilterDraft(owner.port)!;
    draft.clear();
    const result = draft.commit();
    assert.equal(owner.calls.length, 1);
    owner.update({
        ...owner.read(),
        criteria: null,
        effectiveSettings: undefined,
        stamp: { ...owner.read().stamp, generation: 2 },
    });
    resolve({ type: 'uncertain', committedGeneration: 2 });
    const outcome = await result;
    assert.equal(draft.canReport(outcome), true);
    owner.update({
        ...owner.read(),
        stamp: { ...owner.read().stamp, generation: 3 },
    });
    assert.equal(draft.canReport(outcome), false);
    assert.equal(owner.calls.length, 1);
});

test('adding a group starts an empty nested group; clearing emits one null tree', async () => {
    const owner = host();
    const draft = createPortalVisitorFilterDraft(owner.port)!;
    const added = draft.addGroup('group');
    assert.ok(added);
    const group = draft.snapshot().criteria?.conditions[1];
    assert.equal(group?.type, 'groupCondition');
    assert.deepEqual(group.conditions.at(-1), {
        type: 'groupCondition',
        id: added,
        logicalOperator: 'and',
        conditions: [],
    });
    assert.ok(draft.addCondition(added));
    assert.equal(draft.setLogicalOperator(added, 'or'), true);
    assert.equal(draft.clear(), true);
    assert.equal(owner.calls.length, 0);
    await draft.commit();
    assert.equal(owner.calls.length, 1);
    assert.equal(owner.calls[0].criteria, null);
});

test('editing a projected leaf and restoring its original display keeps the raw tree', async () => {
    const owner = host();
    const draft = createPortalVisitorFilterDraft(owner.port)!;
    assert.equal(draft.setOperand('former', 'Changed'), true);
    assert.equal(draft.setOperand('former', 'Keep'), true);
    assert.deepEqual(await draft.commit(), { type: 'unchanged' });
    assert.equal(owner.calls.length, 0);
    assert.deepEqual(draft.snapshot().criteria, criteria);
});

for (const deleteWhileEdited of [false, true]) {
    test(`deletion keeps effective normalization when a leaf is reverted ${deleteWhileEdited ? 'after' : 'before'} the deletion`, async () => {
        const owner = host();
        const draft = createPortalVisitorFilterDraft(owner.port)!;
        assert.equal(draft.setOperand('former', 'Changed'), true);
        if (deleteWhileEdited) assert.equal(draft.remove('missing'), true);
        assert.equal(draft.setOperand('former', 'Keep'), true);
        if (!deleteWhileEdited) assert.equal(draft.remove('missing'), true);
        await draft.commit();
        assert.equal(owner.calls.length, 1);
        assert.deepEqual(owner.calls[0].criteria, {
            logicalOperator: 'and',
            conditions: [
                known,
                {
                    type: 'groupCondition',
                    id: 'group',
                    logicalOperator: 'or',
                    conditions: [leaf('former', title('Keep'))],
                },
            ],
        });
    });
}

test('only the first two group levels can be created', () => {
    const owner = host();
    const draft = createPortalVisitorFilterDraft(owner.port)!;
    const first = draft.addGroup(null);
    assert.ok(first);
    const second = draft.addGroup(first);
    assert.ok(second);
    assert.equal(draft.addGroup(second), null);
    assert.ok(draft.addCondition(second));
});

test('a retained deeper subtree survives an unrelated deletion exactly', async () => {
    const owner = host();
    const retained = {
        id: 'outer',
        type: 'groupCondition' as const,
        logicalOperator: 'and' as const,
        conditions: [
            {
                id: 'middle',
                type: 'groupCondition' as const,
                logicalOperator: 'or' as const,
                conditions: [
                    {
                        id: 'unsupported',
                        type: 'groupCondition' as const,
                        logicalOperator: 'and' as const,
                        conditions: [former],
                    },
                ],
            },
        ],
    };
    owner.update({
        ...owner.read(),
        criteria: { logicalOperator: 'or', conditions: [known, retained] },
    });
    const draft = createPortalVisitorFilterDraft(owner.port)!;
    assert.equal(draft.remove('known'), true);
    await draft.commit();
    assert.deepEqual(owner.calls[0].criteria, {
        logicalOperator: 'or',
        conditions: [retained],
    });
});
