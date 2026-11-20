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

test('text length starts unset without weakening numeric or malformed operands', async () => {
    const owner = host();
    const setting = {
        fieldType: 'singleLineText',
        type: 'isOfLength',
        idOrName: { type: 'id', id: 'name' },
        value: null,
    } as const;
    const initial: PortalVisitorFilterFrame = {
        ...owner.read(),
        fields: [
            {
                id: 'name',
                name: 'Name',
                operators: [
                    {
                        label: 'Is of length',
                        setting,
                        operand: { kind: 'text-length' },
                    },
                ],
            },
        ],
        criteria: null,
        effectiveSettings: {},
    };
    for (const operator of [
        { label: 'Is of length', setting, operand: { kind: 'number' } },
        {
            label: 'Contains',
            setting: { ...setting, type: 'contains', value: '' },
            operand: { kind: 'text-length' },
        },
        {
            label: 'Is of length',
            setting: { ...setting, value: Number.NaN },
            operand: { kind: 'text-length' },
        },
    ] as const) {
        owner.update({
            ...initial,
            fields: [{ ...initial.fields[0], operators: [operator] }],
        });
        assert.equal(createPortalVisitorFilterDraft(owner.port), null);
    }
    owner.update(initial);
    const draft = createPortalVisitorFilterDraft(owner.port);
    assert.ok(draft);
    const id = draft.addCondition(null);
    assert.ok(id);
    assert.deepEqual(draft.settingForEditor(id), setting);
    assert.equal(draft.setOperand(id, 3), true);
    for (const malformed of [null, undefined, '', '3', false, NaN, Infinity]) {
        assert.equal(draft.setOperand(id, malformed), false);
        assert.deepEqual(draft.settingForEditor(id), { ...setting, value: 3 });
    }
    assert.equal(draft.setOperand(id, -2.5), true);
    assert.equal(draft.setOperand(id, 0), true);
    assert.deepEqual(draft.settingForEditor(id), { ...setting, value: 0 });
    assert.equal(owner.calls.length, 0);
    assert.equal((await draft.commit()).type, 'allocated');
    assert.deepEqual(owner.calls[0].criteria, {
        logicalOperator: 'and',
        conditions: [leaf(id, { ...setting, value: 0 })],
    });

    const defaultBlank = createPortalVisitorFilterDraft(owner.port);
    assert.ok(defaultBlank);
    const blankId = defaultBlank.addCondition(null);
    assert.ok(blankId);
    assert.equal((await defaultBlank.commit()).type, 'allocated');
    assert.deepEqual(owner.calls[1].criteria, {
        logicalOperator: 'and',
        conditions: [leaf(blankId, setting)],
    });
});

test('opted-in unset text length is omitted before comparing and sending criteria', async () => {
    const owner = host();
    const contains = {
        fieldType: 'singleLineText',
        type: 'contains',
        idOrName: { type: 'id', id: 'name' },
        value: 'Original',
    } as const;
    const unset = { ...contains, type: 'isOfLength', value: null } as const;
    const sibling = leaf('tags', {
        fieldType: 'multipleSelects',
        type: 'isExactly',
        idOrName: { type: 'name', name: 'Former Tags' },
        value: ['blue'],
    });
    const oldName = leaf('name-rule', contains);
    const unsupported = leaf('unknown', {
        ...unset,
        idOrName: { type: 'id', id: 'unknown' },
    });
    const saved: RuntimeConditionsDefinition = {
        logicalOperator: 'and',
        conditions: [
            {
                type: 'groupCondition',
                id: 'outer',
                logicalOperator: 'or',
                conditions: [
                    {
                        type: 'groupCondition',
                        id: 'inner',
                        logicalOperator: 'and',
                        conditions: [oldName],
                    },
                    sibling,
                    unsupported,
                ],
            },
        ],
    };
    const outer = saved.conditions[0];
    assert.equal(outer.type, 'groupCondition');
    const retained = {
        ...saved,
        conditions: [{ ...outer, conditions: [sibling, unsupported] }],
    };
    const tags = {
        fieldType: 'multipleSelects',
        type: 'isExactly',
        idOrName: { type: 'id', id: 'tags' },
        value: ['blue'],
    } as const;
    const frame: PortalVisitorFilterFrame = {
        ...owner.read(),
        fields: [
            {
                id: 'name',
                name: 'Name',
                operators: [
                    {
                        label: 'Contains',
                        setting: contains,
                        operand: { kind: 'text' },
                    },
                    {
                        label: 'Is of length',
                        setting: unset,
                        operand: { kind: 'text-length', omitIfUnset: true },
                    },
                ],
            },
            {
                id: 'tags',
                name: 'Tags',
                operators: [
                    {
                        label: 'Is exactly',
                        setting: { ...tags, value: ['blue'] },
                        operand: {
                            kind: 'choices',
                            choices: [
                                { value: 'blue', label: 'Blue' },
                                { value: 'green', label: 'Green' },
                            ],
                        },
                    },
                ],
            },
        ],
        criteria: saved,
        effectiveSettings: { tags: { ...tags, value: ['blue'] } },
    };
    owner.update(frame);
    const changed = createPortalVisitorFilterDraft(owner.port);
    assert.ok(changed);
    assert.equal(changed.setOperator('name-rule', 'isOfLength'), true);
    assert.deepEqual(changed.settingForEditor('name-rule'), unset);
    assert.equal(owner.calls.length, 0);
    owner.apply((command) => {
        const generation = command.stamp.generation + 1;
        owner.update({
            ...owner.read(),
            stamp: { ...frame.stamp, generation },
            criteria: command.criteria,
        });
        return {
            type: 'allocated',
            generation,
            requestId: 'first-' + generation,
        };
    });
    const allocated = await changed.commit();
    assert.equal(allocated.type, 'allocated');
    assert.deepEqual(owner.calls[0]?.criteria, retained);
    assert.equal(changed.canReport(allocated), true);

    const added = createPortalVisitorFilterDraft(owner.port);
    assert.ok(added);
    const id = added.addCondition('outer');
    assert.ok(id);
    assert.equal(added.setOperator(id, 'isOfLength'), true);
    assert.deepEqual(await added.commit(), { type: 'unchanged' });
    assert.equal(owner.calls.length, 1);

    const zero = createPortalVisitorFilterDraft(owner.port);
    assert.ok(zero);
    const zeroId = zero.addCondition('outer');
    assert.ok(zeroId);
    assert.equal(zero.setOperator(zeroId, 'isOfLength'), true);
    assert.equal(zero.setOperand(zeroId, 0), true);
    assert.equal((await zero.commit()).type, 'allocated');
    assert.deepEqual(zero.settingForEditor(zeroId), { ...unset, value: 0 });
    const sent = owner.calls[1]?.criteria?.conditions[0];
    assert.equal(sent?.type, 'groupCondition');
    assert.deepEqual(sent.conditions, [
        sibling,
        unsupported,
        leaf(zeroId, { ...unset, value: 0 }),
    ]);

    const blank = leaf('blank', unset);
    const protectedRaw = leaf('effective-number', unset);
    const live = owner.read();
    owner.update({
        ...live,
        criteria: {
            ...saved,
            conditions: [
                {
                    ...outer,
                    conditions: [sibling, unsupported, blank, protectedRaw],
                },
            ],
        },
        effectiveSettings: {
            ...live.effectiveSettings,
            'effective-number': { ...unset, value: 3 },
        },
    });
    const mixed = createPortalVisitorFilterDraft(owner.port);
    assert.ok(mixed);
    assert.equal(mixed.setOperand('tags', ['green']), true);
    assert.equal(owner.calls.length, 2);
    const mixedOutcome = await mixed.commit();
    assert.equal(mixedOutcome.type, 'allocated');
    assert.equal(mixed.canReport(mixedOutcome), true);
    assert.deepEqual(owner.calls[2]?.criteria, {
        ...saved,
        conditions: [
            {
                ...outer,
                conditions: [
                    leaf('tags', { ...tags, value: ['green'] }),
                    unsupported,
                    protectedRaw,
                ],
            },
        ],
    });

    owner.update({ ...frame, criteria: null, effectiveSettings: {} });
    const empty = createPortalVisitorFilterDraft(owner.port);
    assert.ok(empty);
    const emptyId = empty.addCondition(null);
    assert.ok(emptyId);
    assert.equal(empty.setOperator(emptyId, 'isOfLength'), true);
    assert.deepEqual(await empty.commit(), { type: 'unchanged' });
    assert.equal(owner.calls.length, 3);
});

test('date-only operands reject invalid days and accept leap days and clearing', async () => {
    const owner = host();
    const setting = {
        fieldType: 'date',
        type: 'isBefore',
        idOrName: { type: 'id', id: 'date' },
        value: '2024-02-01',
    } as const;
    owner.update({
        ...owner.read(),
        fields: [
            {
                id: 'date',
                name: 'Date',
                operators: [
                    { label: 'Is before', setting, operand: { kind: 'date' } },
                ],
            },
        ],
        criteria: {
            logicalOperator: 'and',
            conditions: [leaf('date', setting)],
        },
        effectiveSettings: {},
    });
    const draft = createPortalVisitorFilterDraft(owner.port);
    assert.ok(draft);
    for (const invalid of [
        '2023-02-29',
        '2024-13-01',
        '2024-2-01',
        '2024-02-01T00:00:00Z',
        20240201,
    ]) {
        assert.equal(draft.setOperand('date', invalid), false, String(invalid));
    }
    assert.deepEqual(draft.settingForEditor('date'), setting);
    assert.equal(draft.setOperand('date', '2024-02-29'), true);
    assert.deepEqual(draft.settingForEditor('date'), {
        ...setting,
        value: '2024-02-29',
    });
    assert.equal(draft.setOperand('date', null), true);
    assert.equal(owner.calls.length, 0);
    assert.equal((await draft.commit()).type, 'allocated');
    assert.deepEqual(owner.calls[0].criteria?.conditions, [
        leaf('date', { ...setting, value: null }),
    ]);
});

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

for (const keepSiblings of [false, true]) {
    test(`removing a last nested predicate prunes only newly emptied ancestors ${keepSiblings ? 'with sibling predicates' : 'through to null'}`, async () => {
        const owner = host();
        const group = (
            id: string,
            ...conditions: RuntimeConditionsDefinition['conditions']
        ) => ({
            id,
            type: 'groupCondition' as const,
            logicalOperator: 'or' as const,
            conditions,
        });
        const before = leaf('before', title('Before'));
        const after = leaf('after', title('After'));
        const opaque = group(
            'retained',
            group('retained-2', group('unsupported'))
        );
        const nested = group('outer', group('inner', known));
        owner.update({
            ...owner.read(),
            criteria: {
                logicalOperator: 'and',
                conditions: keepSiblings
                    ? [before, nested, opaque, after]
                    : [nested],
            },
            effectiveSettings: undefined,
        });
        const draft = createPortalVisitorFilterDraft(owner.port)!;
        assert.equal(draft.remove('known'), true);
        const expected = keepSiblings
            ? { logicalOperator: 'and', conditions: [before, opaque, after] }
            : null;
        assert.deepEqual(draft.snapshot().criteria, expected);
        assert.equal(owner.calls.length, 0);
        await draft.commit();
        assert.equal(owner.calls.length, 1);
        assert.deepEqual(owner.calls[0].criteria, expected);
    });
}
