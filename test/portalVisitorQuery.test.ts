import assert from 'node:assert/strict';
import { it } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
    createPortalVisitorFilterDraft,
    createPortalVisitorQueryControls,
    createPortalVisitorSearchDraft,
    createPortalVisitorSortDraft,
} from '../src/portals/index.js';

type QueryPort = Parameters<typeof createPortalVisitorQueryControls>[0];
type QueryFrame = NonNullable<ReturnType<QueryPort['read']>>;
type QueryCommand = Parameters<QueryPort['apply']>[0];

const statusChoice = (value: string) =>
    ({
        fieldType: 'singleSelect',
        type: 'is',
        idOrName: { type: 'id', id: 'status' },
        value,
    }) as const;

it('separates accepted query criteria, native request starts, and explicit Retry', async () => {
    const initial: QueryFrame = {
        stamp: {
            sessionId: 'portal',
            fieldId: 'linked',
            viewId: 'grid',
            configurationRevision: 2,
            metadataRevision: 3,
            generation: 7,
        },
        search: { searchTerm: '  café  ', publicationRevision: 4 },
        filter: {
            fields: [
                {
                    id: 'status',
                    name: 'Status',
                    operators: [
                        {
                            label: 'Is',
                            setting: statusChoice('open'),
                            operand: {
                                kind: 'choice',
                                choices: [
                                    { value: 'open', label: 'Open' },
                                    { value: 'closed', label: 'Closed' },
                                ],
                            },
                        },
                    ],
                },
            ],
            criteria: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'status-rule',
                        type: 'singleCondition',
                        setting: statusChoice('open'),
                    },
                ],
            },
            dropdownFieldIds: ['status'],
        },
        sort: {
            fields: [{ id: 'name', name: 'Name' }],
            criteria: [{ idOrName: { type: 'id', id: 'name' }, type: 'asc' }],
        },
    };
    let frame = initial;
    const listeners = new Set<() => void>();
    const commands: QueryCommand[] = [];
    const criteriaPublications: {
        generation: number;
        criteria: QueryFrame['filter']['criteria'];
    }[] = [];
    const requestStarts: { requestId: string; generation: number }[] = [];
    const sends: QueryCommand['type'][] = [];
    const publish = (updated: QueryFrame) => {
        frame = updated;
        for (const listener of listeners) listener();
    };
    const send = (type: QueryCommand['type']) => {
        const started = {
            requestId: `native-${requestStarts.length + 1}`,
            generation: frame.stamp.generation,
        };
        requestStarts.push(started);
        sends.push(type);
        return started;
    };
    const port: QueryPort = {
        read: () => frame,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        apply(command) {
            commands.push(command);
            assert.deepEqual(command.stamp, frame.stamp);
            switch (command.type) {
                case 'search':
                    assert.equal(
                        command.expectedSearchTerm,
                        frame.search.searchTerm
                    );
                    assert.equal(
                        command.expectedPublicationRevision,
                        frame.search.publicationRevision
                    );
                    assert.equal(command.searchTerm, frame.search.searchTerm);
                    return { type: 'allocated', requestStart: send('search') };
                case 'filter': {
                    const generation = frame.stamp.generation + 1;
                    criteriaPublications.push({
                        generation,
                        criteria: command.criteria,
                    });
                    publish({
                        ...frame,
                        stamp: {
                            ...frame.stamp,
                            generation,
                        },
                        filter: { ...frame.filter, criteria: command.criteria },
                    });
                    sends.push('filter');
                    publish({ ...frame, retryId: 'failed-filter' });
                    return {
                        type: 'uncertain',
                        committedGeneration: generation,
                    };
                }
                case 'sort': {
                    const generation = frame.stamp.generation + 1;
                    publish({
                        ...frame,
                        stamp: { ...frame.stamp, generation },
                        sort: { ...frame.sort, criteria: command.criteria },
                    });
                    return { type: 'refused', committedGeneration: generation };
                }
                case 'view':
                    assert.equal(command.viewId, frame.stamp.viewId);
                    return { type: 'unchanged' };
                case 'retry': {
                    const { retryId, ...next } = frame;
                    assert.equal(command.retryId, retryId);
                    assert.ok(retryId);
                    const requestStart = send('retry');
                    publish(next);
                    return { type: 'allocated', requestStart };
                }
            }
        },
    };
    const controls = createPortalVisitorQueryControls(port);
    assert.deepEqual(requestStarts, []);

    const search = createPortalVisitorSearchDraft(controls.search);
    assert.ok(search);
    const term = {
        source: 'submit',
        searchTerm: initial.search.searchTerm,
    } as const;
    assert.deepEqual(await search.submit(term), {
        type: 'allocated',
        requestId: 'native-1',
        generation: 7,
    });
    assert.deepEqual(await search.submit(term), {
        type: 'allocated',
        requestId: 'native-2',
        generation: 7,
    });
    assert.deepEqual(requestStarts, [
        { requestId: 'native-1', generation: 7 },
        { requestId: 'native-2', generation: 7 },
    ]);
    assert.deepEqual(criteriaPublications, []);

    const unchangedFilter = createPortalVisitorFilterDraft(controls.filter);
    const unchangedSort = createPortalVisitorSortDraft(controls.sort);
    assert.ok(unchangedFilter);
    assert.ok(unchangedSort);
    assert.deepEqual(await unchangedFilter.commit(), { type: 'unchanged' });
    assert.deepEqual(await unchangedSort.commit(), { type: 'unchanged' });
    assert.deepEqual(await controls.selectView(initial.stamp, 'grid'), {
        type: 'unchanged',
    });
    assert.deepEqual(sends, ['search', 'search']);
    assert.deepEqual(criteriaPublications, []);

    const changed = createPortalVisitorFilterDraft(controls.filter);
    assert.ok(changed);
    assert.deepEqual(
        changed.dropdowns().map(({ fieldId }) => fieldId),
        ['status']
    );
    assert.equal(changed.setOperand('status-rule', 'closed'), true);
    const filterOutcome = await changed.commit();
    assert.deepEqual(filterOutcome, {
        type: 'uncertain',
        committedGeneration: 8,
    });
    assert.equal(changed.canReport(filterOutcome), true);
    await setImmediate();
    assert.deepEqual(criteriaPublications, [
        {
            generation: 8,
            criteria: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'status-rule',
                        type: 'singleCondition',
                        setting: statusChoice('closed'),
                    },
                ],
            },
        },
    ]);
    assert.deepEqual(sends, ['search', 'search', 'filter']);
    assert.equal(requestStarts.length, 2);

    const failedStamp = frame.stamp;
    const failedRetryId = frame.retryId;
    assert.ok(failedRetryId);
    assert.deepEqual(await controls.retry(initial.stamp, failedRetryId), {
        type: 'stale',
    });

    const replacementRetryId = 'replacement-filter-failure';
    publish({ ...frame, retryId: replacementRetryId });
    assert.equal(frame.stamp, failedStamp);
    const commandsBeforeRetry = commands.length;
    assert.deepEqual(await controls.retry(failedStamp, failedRetryId), {
        type: 'stale',
    });
    assert.equal(commands.length, commandsBeforeRetry);
    assert.equal(frame.retryId, replacementRetryId);
    assert.deepEqual(sends, ['search', 'search', 'filter']);
    assert.equal(requestStarts.length, 2);

    assert.deepEqual(await controls.retry(failedStamp, replacementRetryId), {
        type: 'allocated',
        requestStart: { requestId: 'native-3', generation: 8 },
    });
    assert.equal(commands.length, commandsBeforeRetry + 1);
    assert.deepEqual(commands.at(-1), {
        type: 'retry',
        stamp: failedStamp,
        retryId: replacementRetryId,
    });
    assert.deepEqual(requestStarts[2], {
        requestId: 'native-3',
        generation: 8,
    });
    assert.deepEqual(sends, ['search', 'search', 'filter', 'retry']);
    assert.equal(criteriaPublications.length, 1);
    assert.deepEqual(await controls.retry(failedStamp, replacementRetryId), {
        type: 'refused',
    });
    assert.equal(commands.length, commandsBeforeRetry + 1);
    assert.equal(sends.length, 4);

    const sort = createPortalVisitorSortDraft(controls.sort);
    assert.ok(sort);
    const [rule] = sort.snapshot().rules;
    assert.ok(rule);
    assert.equal(sort.setDirection(rule.key, 'desc'), true);
    const outcome = await sort.commit();
    assert.deepEqual(outcome, { type: 'refused', committedGeneration: 9 });
    assert.equal(sort.canReport(outcome), true);
    assert.equal(frame.search.publicationRevision, 4);
    assert.equal(requestStarts.length, 3);
    assert.equal(sends.length, 4);
});
