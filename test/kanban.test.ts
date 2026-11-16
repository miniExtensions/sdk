import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    projectKanbanColumns,
    getKanbanColumnAirtableValue,
    createKanbanCategoryOperation,
    uncategorizedKanbanColumnId,
    type KanbanProjectionInput,
    type KanbanCategoryInvocation,
    type KanbanMutationResult,
} from '../src/portals/kanban.js';

const field = {
    id: 'status',
    config: {
        type: 'singleSelect',
        options: {
            choices: [
                { id: 'open', name: 'Open' },
                { id: 'closed', name: 'Closed' },
                { id: 'waiting', name: 'Waiting' },
            ],
        },
    },
} satisfies KanbanProjectionInput['fields'][number];
function projection(
    categories: readonly (string | null | undefined | number)[],
    hideEmptyColumns = false,
    fields: KanbanProjectionInput['fields'] = [field]
) {
    return projectKanbanColumns({
        categoryFieldId: 'status',
        fields,
        recordIds: categories.map((_, index) => `r${index}`),
        readRecord: (id) => ({
            fields: {
                status: categories[Number(id.slice(1))],
                other: 'Closed',
            },
        }),
        uncategorizedLabel: 'Uncategorized',
        hideEmptyColumns,
    });
}
const labels = (columns: ReturnType<typeof projection>) =>
    columns.map((column) => column.label);

it('preserves native ordered declared/stale columns and only filters empty columns', () => {
    const input = Object.freeze(['Closed', null, 'Legacy', 'Open']);
    const all = projection(input);
    assert.deepEqual(labels(all), [
        'Uncategorized',
        'Open',
        'Closed',
        'Waiting',
        'Legacy',
    ]);
    assert.deepEqual(
        all.map((column) => column.recordIds),
        [['r1'], ['r3'], ['r0'], [], ['r2']]
    );
    assert.deepEqual(labels(projection(input, true)), [
        'Uncategorized',
        'Open',
        'Closed',
        'Legacy',
    ]);
    assert.deepEqual(
        labels(projection(['Closed', null, 'Legacy', 'Waiting'], true)),
        ['Uncategorized', 'Closed', 'Waiting', 'Legacy']
    );
    assert.deepEqual(input, ['Closed', null, 'Legacy', 'Open']);
});
it('preserves every empty declared column or filters all of them', () => {
    assert.deepEqual(labels(projection([])), [
        'Uncategorized',
        'Open',
        'Closed',
        'Waiting',
    ]);
    assert.deepEqual(projection([], true), []);
});
it('selects the configured category field ID instead of an earlier competing field', () => {
    const other = {
        ...field,
        id: 'other',
        config: {
            ...field.config,
            options: { choices: [{ id: 'wrong', name: 'Wrong' }] },
        },
    };
    const columns = projection(['Open'], false, [other, field]);
    assert.deepEqual(
        columns.find((column) => column.id === 'open')?.recordIds,
        ['r0']
    );
    assert.equal(
        columns.some((column) => column.id === 'wrong'),
        false
    );
});
it('retains declared order for numeric-looking labels', () => {
    const numeric = {
        ...field,
        config: {
            ...field.config,
            options: {
                choices: [
                    { id: 'ten', name: '10' },
                    { id: 'two', name: '2' },
                    { id: 'open', name: 'Open' },
                ],
            },
        },
    };
    assert.deepEqual(labels(projection([], false, [numeric])), [
        'Uncategorized',
        '10',
        '2',
        'Open',
    ]);
});
it('keeps a declared localized Uncategorized label distinct from empty category values', () => {
    const named = {
        ...field,
        config: {
            ...field.config,
            options: { choices: [{ id: 'named', name: 'Uncategorized' }] },
        },
    };
    const columns = projection([null, 'Uncategorized'], false, [named]);
    assert.deepEqual(
        columns.map((column) => [column.id, column.value, column.recordIds]),
        [
            [uncategorizedKanbanColumnId, null, ['r0']],
            ['named', 'Uncategorized', ['r1']],
        ]
    );
});
it('resolves IDs to their separate declared, empty and stale write values', () => {
    const columns = projection([null, 'Legacy', 'Open']);
    assert.equal(getKanbanColumnAirtableValue(columns, 'open'), 'Open');
    assert.equal(
        getKanbanColumnAirtableValue(columns, uncategorizedKanbanColumnId),
        null
    );
    assert.equal(
        getKanbanColumnAirtableValue(columns, 'kanban:stale:Legacy'),
        'Legacy'
    );
    assert.throws(
        () => getKanbanColumnAirtableValue(columns, 'Open'),
        /Could not find Kanban column/
    );
});
it('uses first declared duplicate labels, preserves row multiplicity and stale encounter order', () => {
    const duplicate = {
        ...field,
        config: {
            ...field.config,
            options: {
                choices: [
                    { id: 'first', name: 'Same' },
                    { id: 'second', name: 'Same' },
                ],
            },
        },
    };
    const original = { fields: { status: 'Same' } };
    const columns = projectKanbanColumns({
        categoryFieldId: 'status',
        fields: [duplicate],
        recordIds: ['same', 'b', 'same', 'a', 'null', 'undefined', 'number'],
        readRecord: (id) =>
            id === 'same'
                ? original
                : {
                      fields: {
                          status:
                              id === 'b'
                                  ? 'Z'
                                  : id === 'a'
                                    ? 'A'
                                    : id === 'number'
                                      ? 0
                                      : id === 'null'
                                        ? null
                                        : undefined,
                      },
                  },
        uncategorizedLabel: 'Uncategorized',
        hideEmptyColumns: false,
    });
    assert.deepEqual(labels(columns), [
        'Uncategorized',
        'Same',
        'Same',
        'Z',
        'A',
    ]);
    assert.deepEqual(
        columns.map((column) => column.recordIds),
        [['null', 'undefined', 'number'], ['same', 'same'], [], ['b'], ['a']]
    );
    assert.deepEqual(original, { fields: { status: 'Same' } });
});
it('fails on a missing configured field or record instead of fabricating data', () => {
    assert.throws(
        () => projection([], false, []),
        /Could not find airtable field/
    );
    assert.throws(
        () =>
            projectKanbanColumns({
                categoryFieldId: 'status',
                fields: [field],
                recordIds: ['missing'],
                readRecord: () => undefined,
                uncategorizedLabel: 'Uncategorized',
                hideEmptyColumns: false,
            }),
        /Could not find record/
    );
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
type Original = {
    fields: { status: string | null | undefined };
    sibling: string;
};
function harness(category: string | null | undefined = 'Open') {
    const events: unknown[] = [];
    const original: Original = {
        fields: { status: category },
        sibling: 'unchanged',
    };
    const pending = deferred<KanbanMutationResult<object>>();
    const invocation: KanbanCategoryInvocation<Original, object> = {
        originalRecord: original,
        columns: projection(['Open', 'Closed', 'Legacy']),
        readCategory: (record) => record.fields.status,
        publishOptimistic: (value) => {
            events.push(['optimistic', value]);
        },
        mutate: (value) => {
            events.push(['mutate', value]);
            return pending.promise;
        },
        publishLoggedIn: (record) => {
            events.push(['logged-in', record]);
        },
        restore: (record) => {
            assert.equal(record, original);
            events.push(['restore', record]);
        },
    };
    const operation = createKanbanCategoryOperation<Original, object>((id) => {
        events.push(['capture', id]);
        return invocation;
    });
    return { events, original, pending, invocation, operation };
}
it('strict-equal category is a no-op; undefined to null still allocates as native does', async () => {
    const same = harness();
    await same.operation('r', 'open');
    assert.deepEqual(same.events, [['capture', 'r']]);
    const blank = harness(null);
    await blank.operation('r', uncategorizedKanbanColumnId);
    assert.deepEqual(blank.events, [['capture', 'r']]);
    const absent = harness();
    absent.original.fields.status = undefined;
    const request = absent.operation('r', uncategorizedKanbanColumnId);
    assert.deepEqual(absent.events, [
        ['capture', 'r'],
        ['optimistic', null],
        ['mutate', null],
    ]);
    absent.pending.resolve({ type: 'no-login' });
    assert.equal(await request, undefined);
});
it('publishes optimistic state before transport immediately and preserves actual logged-in record identity', async () => {
    const h = harness();
    const request = h.operation('r', 'closed');
    assert.deepEqual(h.events, [
        ['capture', 'r'],
        ['optimistic', 'Closed'],
        ['mutate', 'Closed'],
    ]);
    const loggedIn = { opaque: 'native result' };
    h.pending.resolve({ type: 'logged-in', loggedInUserRecord: loggedIn });
    assert.equal(await request, undefined);
    const publication = h.events[3];
    assert.ok(Array.isArray(publication));
    assert.equal(publication[1], loggedIn);
    assert.deepEqual(h.original, {
        fields: { status: 'Open' },
        sibling: 'unchanged',
    });
});
it('no-login fulfillment does not publish logged-in state or imply a success receipt', async () => {
    const h = harness();
    const request = h.operation('r', 'closed');
    h.pending.resolve({ type: 'no-login' });
    assert.equal(await request, undefined);
    assert.equal(h.events.length, 3);
});
it('allocates overlapping requests immediately without coalescing or serialization', async () => {
    const first = harness(),
        second = harness();
    let captures = 0;
    const operation = createKanbanCategoryOperation<Original, object>((id) => {
        assert.equal(id, 'same-record');
        return captures++ === 0 ? first.invocation : second.invocation;
    });
    const a = operation('same-record', 'closed'),
        b = operation('same-record', 'kanban:stale:Legacy');
    assert.deepEqual(first.events, [
        ['optimistic', 'Closed'],
        ['mutate', 'Closed'],
    ]);
    assert.deepEqual(second.events, [
        ['optimistic', 'Legacy'],
        ['mutate', 'Legacy'],
    ]);
    second.pending.resolve({ type: 'no-login' });
    await b;
    first.pending.reject(new Error('transport'));
    await a;
    assert.equal(first.events.length, 3);
    assert.equal(second.events.length, 2);
});
it('optimistic publication throw rejects before transport and without rollback', async () => {
    const h = harness();
    const failure = new Error('optimistic');
    const operation = createKanbanCategoryOperation(() => ({
        ...h.invocation,
        publishOptimistic: () => {
            throw failure;
        },
    }));
    await assert.rejects(
        operation('r', 'closed'),
        (error) => error === failure
    );
    assert.deepEqual(h.events, []);
});
it('transport rejection restores the captured whole record and swallows the original failure', async () => {
    const h = harness();
    const request = h.operation('r', 'closed');
    h.pending.reject(new Error('transport'));
    assert.equal(await request, undefined);
    assert.deepEqual(h.events[3], ['restore', h.original]);
    assert.deepEqual(h.original, {
        fields: { status: 'Open' },
        sibling: 'unchanged',
    });
});
it('logged-in publication throw restores the captured record', async () => {
    const h = harness();
    const operation = createKanbanCategoryOperation(() => ({
        ...h.invocation,
        publishLoggedIn: () => {
            throw new Error('publication');
        },
    }));
    const request = operation('r', 'closed');
    h.pending.resolve({ type: 'logged-in', loggedInUserRecord: {} });
    assert.equal(await request, undefined);
    assert.deepEqual(h.events[2], ['restore', h.original]);
});
it('restore throw rejects with that error rather than swallowing it', async () => {
    const h = harness();
    const failure = new Error('restore');
    const operation = createKanbanCategoryOperation(() => ({
        ...h.invocation,
        restore: () => {
            throw failure;
        },
    }));
    const request = operation('r', 'closed');
    h.pending.reject(new Error('transport'));
    await assert.rejects(request, (error) => error === failure);
    assert.equal(h.events.length, 2);
});
it('missing column rejects before optimistic publication or transport', async () => {
    const h = harness();
    await assert.rejects(
        h.operation('r', 'missing'),
        /Could not find Kanban column/
    );
    assert.deepEqual(h.events, [['capture', 'r']]);
});
it('captured callbacks and whole-record rollback survive replaced current ports', async () => {
    const original = harness(),
        replacement = harness('Closed');
    let current = original.invocation;
    let captures = 0;
    const operation = createKanbanCategoryOperation(() => {
        captures++;
        return current;
    });
    const request = operation('r', 'closed');
    current = replacement.invocation;
    original.pending.reject(new Error('late original transport'));
    await request;
    assert.equal(captures, 1);
    assert.deepEqual(original.events[2], ['restore', original.original]);
    assert.deepEqual(replacement.events, []);
    const currentRequest = operation('r', 'open');
    assert.deepEqual(replacement.events, [
        ['optimistic', 'Open'],
        ['mutate', 'Open'],
    ]);
    replacement.pending.resolve({ type: 'no-login' });
    await currentRequest;
});

it('keeps empty and whitespace string categories literal', () => {
    const exact = {
        ...field,
        config: {
            ...field.config,
            options: {
                choices: [
                    { id: 'empty', name: '' },
                    { id: 'space', name: '  ' },
                ],
            },
        },
    };
    const columns = projection(['', '  ', null], false, [exact]);
    assert.deepEqual(
        columns.map((column) => [column.value, column.recordIds]),
        [
            [null, ['r2']],
            ['', ['r0']],
            ['  ', ['r1']],
        ]
    );
});
it('synchronous mutation throw restores the captured record without inventing a retry', async () => {
    const h = harness();
    const operation = createKanbanCategoryOperation(() => ({
        ...h.invocation,
        mutate: () => {
            h.events.push('sync mutation');
            throw new Error('transport');
        },
    }));
    await operation('r', 'closed');
    assert.deepEqual(h.events, [
        ['optimistic', 'Closed'],
        'sync mutation',
        ['restore', h.original],
    ]);
});
it('late logged-in settlement uses captured publication after caller replacement', async () => {
    const first = harness(),
        second = harness();
    let current = first.invocation;
    const operation = createKanbanCategoryOperation(() => current);
    const request = operation('r', 'closed');
    current = second.invocation;
    const result = { opaque: 'first session' };
    first.pending.resolve({ type: 'logged-in', loggedInUserRecord: result });
    await request;
    const event = first.events[2];
    assert.ok(Array.isArray(event));
    assert.equal(event[1], result);
    assert.deepEqual(second.events, []);
});

it('rejects wrong-type or missing single-select configuration at projection admission', () => {
    assert.throws(
        () =>
            projection([], false, [
                {
                    id: 'status',
                    config: { type: 'number', options: { precision: 2 } },
                },
            ]),
        TypeError
    );
    assert.throws(
        () =>
            projection([], false, [
                {
                    id: 'status',
                    config: { type: 'singleSelect', options: null },
                },
            ]),
        TypeError
    );
});
