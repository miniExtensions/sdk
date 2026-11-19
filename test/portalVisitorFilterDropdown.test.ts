import assert from 'node:assert/strict';
import test from 'node:test';
import { createPortalVisitorFilterDraft } from '../src/portals/visitorFilter.js';
import {
    displayed,
    group,
    leaf,
    quickFilterOwner as owner,
    statusChoice,
    title,
} from './fixtures/portalVisitorQuickFilterFixture.js';

const untouched = group('untouched', group('nested', group('opaque-empty')));

test('quick Filter displays configured order and preserves a formerly named field on unchanged selection', async () => {
    const criteria = {
        logicalOperator: 'and' as const,
        conditions: [displayed],
    };
    const host = owner(criteria);
    const draft = createPortalVisitorFilterDraft(host.port);
    assert.ok(draft);
    assert.deepEqual(
        draft.dropdowns().map(({ fieldId, label, selected }) => ({
            fieldId,
            label,
            selected,
        })),
        [
            { fieldId: 'labels', label: 'Labels', selected: [] },
            { fieldId: 'status', label: 'Current status', selected: ['red'] },
        ]
    );
    assert.equal(draft.setDropdown('status', ['red']), false);
    assert.deepEqual(draft.snapshot().criteria, criteria);
    assert.deepEqual(await draft.commit(), { type: 'unchanged' });
    assert.deepEqual(host.calls, []);
});

test('changing one quick Filter reconciles its leaves and preserves unrelated order and opaque groups', async () => {
    const criteria = {
        logicalOperator: 'or' as const,
        conditions: [
            displayed,
            group('mixed', leaf('nested-status', statusChoice('blue')), title),
            untouched,
        ],
    };
    const host = owner(criteria);
    const draft = createPortalVisitorFilterDraft(host.port);
    assert.ok(draft);
    assert.equal(draft.setDropdown('status', ['blue']), true);
    assert.equal(host.calls.length, 0);
    assert.equal((await draft.commit()).type, 'allocated');
    assert.equal(host.calls.length, 1);
    const actual = host.calls[0].criteria;
    assert.equal(actual?.logicalOperator, 'or');
    assert.equal(actual.conditions[0].type, 'singleCondition');
    assert.deepEqual(actual.conditions[0].setting, statusChoice('blue'));
    assert.deepEqual(actual.conditions.slice(1), [
        group('mixed', title),
        untouched,
    ]);
    assert.equal(criteria.conditions[0], displayed);
});

test('quick Filter Clear preserves other criteria and reduces the last predicate to null', async () => {
    for (const keep of [false, true]) {
        const host = owner({
            logicalOperator: 'and',
            conditions: keep ? [displayed, title] : [displayed],
        });
        const draft = createPortalVisitorFilterDraft(host.port);
        assert.ok(draft);
        assert.equal(draft.setDropdown('status', []), true);
        assert.equal((await draft.commit()).type, 'allocated');
        assert.equal(host.calls.length, 1);
        assert.deepEqual(
            host.calls[0].criteria,
            keep ? { logicalOperator: 'and', conditions: [title] } : null
        );
    }
});

test('quick Filter rejects unknown choices and submits admitted multiple choice IDs in intent order', async () => {
    const host = owner(null);
    const draft = createPortalVisitorFilterDraft(host.port);
    assert.ok(draft);
    assert.equal(draft.setDropdown('status', ['red', 'blue']), false);
    assert.equal(draft.setDropdown('labels', ['red', 'red']), false);
    assert.equal(draft.setDropdown('labels', ['unknown']), false);
    assert.equal(draft.setDropdown('unadmitted', ['blue']), false);
    assert.equal(draft.setDropdown('labels', ['blue', 'red']), true);
    assert.equal((await draft.commit()).type, 'allocated');
    const condition = host.calls[0].criteria?.conditions[0];
    assert.equal(condition?.type, 'singleCondition');
    assert.deepEqual(condition.setting, {
        fieldType: 'multipleSelects',
        type: 'hasAnyOf',
        idOrName: { type: 'id', id: 'labels' },
        value: ['blue', 'red'],
    });
    assert.equal(host.calls.length, 1);
});

test('quick Filter refuses invalid configuration and retires the retained draft after a view return', async () => {
    assert.equal(
        createPortalVisitorFilterDraft(owner(null, ['missing']).port),
        null
    );
    const malformed = owner(null, ['status']);
    const initial = malformed.port.read();
    assert.ok(initial);
    const status = initial.fields[0];
    const is = status.operators[0];
    assert.equal(is.operand.kind, 'choice');
    const duplicate = is.operand.choices[0];
    malformed.update({
        fields: [
            {
                ...status,
                operators: [
                    {
                        ...is,
                        operand: {
                            kind: 'choice',
                            choices: [duplicate, duplicate],
                        },
                    },
                ],
            },
        ],
    });
    assert.equal(createPortalVisitorFilterDraft(malformed.port), null);
    assert.equal(malformed.calls.length, 0);
    const host = owner(null);
    const draft = createPortalVisitorFilterDraft(host.port);
    assert.ok(draft);
    assert.equal(draft.setDropdown('status', ['blue']), true);
    const admitted = host.port.read();
    assert.ok(admitted);
    host.update({
        stamp: { ...admitted.stamp, viewId: 'view-b', generation: 2 },
    });
    host.update({ stamp: { ...admitted.stamp, generation: 3 } });
    assert.deepEqual(await draft.commit(), { type: 'stale' });
    assert.deepEqual(host.calls, []);
});
