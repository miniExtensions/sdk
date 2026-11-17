import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    composeComputedPresentation,
    type ComputedPresentationEntry,
    type ComputedPresentationProjection,
} from '../src/react/computedPresentation.js';
import type {
    LookupPresentationOwner,
    LookupResultPresentation,
} from '../src/react/lookupFieldTypes.js';

const owner = { token: {}, isCurrent: () => true };
const ready = (...keys: string[]): ComputedPresentationProjection => ({
    status: 'ready',
    occurrences: keys.map((key) => ({ key })),
});
const literal = (
    text: string
): Extract<ComputedPresentationEntry, { kind: 'result' }> => ({
    kind: 'result',
    result: { kind: 'literal', text },
});

it('assembles original order and duplicate display references with their distinct keys', () => {
    const entry = literal('same');
    const state = composeComputedPresentation({
        projection: ready('lookup:0', 'lookup:2'),
        entries: new Map([
            ['lookup:0', entry],
            ['lookup:2', entry],
        ]),
        owner,
    });
    assert.equal(state.status, 'ready');
    if (state.status !== 'ready' || state.result.kind !== 'sequence')
        throw Error('sequence');
    assert.deepEqual(
        state.result.leaves.map((x) => x.key),
        ['lookup:0', 'lookup:2']
    );
    assert.equal(state.result.leaves[0].result, entry.result);
    assert.equal(state.result.leaves[1].result, entry.result);
});

it('keeps nested occurrence identities and presentation structure', () => {
    const state = composeComputedPresentation({
        projection: ready('outer:0'),
        owner,
        entries: new Map<string, ComputedPresentationEntry>([
            [
                'outer:0',
                { kind: 'nested', projection: ready('outer:0/lookup:1') },
            ],
            ['outer:0/lookup:1', literal('nested')],
        ]),
    });
    assert.deepEqual(state, {
        status: 'ready',
        result: {
            kind: 'sequence',
            layout: 'wrap',
            leaves: [
                {
                    key: 'outer:0',
                    result: {
                        kind: 'sequence',
                        layout: 'wrap',
                        leaves: [
                            {
                                key: 'outer:0/lookup:1',
                                result: { kind: 'literal', text: 'nested' },
                            },
                        ],
                    },
                },
            ],
        },
    });
});

it('distinguishes root emptiness from ready zero-occurrence results without reading entries', () => {
    for (const projection of [{ status: 'empty' } as const, ready()]) {
        const state = composeComputedPresentation({
            projection,
            owner,
            get entries(): ReadonlyMap<string, ComputedPresentationEntry> {
                throw Error('no leaf producer');
            },
        });
        assert.deepEqual(
            state,
            projection.status === 'empty'
                ? { status: 'empty' }
                : {
                      status: 'ready',
                      result: { kind: 'sequence', leaves: [], layout: 'wrap' },
                  }
        );
    }
});

it('maps nested empty/error states without flattening or discarding them', () => {
    const state = composeComputedPresentation({
        projection: ready('empty', 'error'),
        owner,
        entries: new Map([
            ['empty', { kind: 'nested', projection: { status: 'empty' } }],
            [
                'error',
                {
                    kind: 'nested',
                    projection: { status: 'native-error', message: '#ERROR!' },
                },
            ],
        ]),
    });
    assert.equal(state.status, 'ready');
    if (state.status !== 'ready' || state.result.kind !== 'sequence')
        throw Error('sequence');
    assert.deepEqual(
        state.result.leaves.map((x) => x.result.kind),
        ['text', 'error']
    );
});

for (const status of [
    'masked',
    'empty',
    'invalid-result',
    'unavailable',
] as const)
    it(`returns ${status} before reading owner or display entries`, () => {
        assert.deepEqual(
            composeComputedPresentation({
                projection: { status },
                get owner(): LookupPresentationOwner {
                    throw Error('no owner read');
                },
                get entries(): ReadonlyMap<string, ComputedPresentationEntry> {
                    throw Error('no entries read');
                },
            }),
            { status }
        );
    });

it('refuses missing leaf admission without showing a partial sequence', () => {
    assert.deepEqual(
        composeComputedPresentation({
            projection: ready('present', 'missing'),
            entries: new Map([['present', literal('A')]]),
            owner,
        }),
        { status: 'unavailable' }
    );
});

it('does not inspect entries for a stale or throwing owner', () => {
    for (const current of [
        () => false,
        () => {
            throw Error('unknown owner');
        },
    ])
        assert.deepEqual(
            composeComputedPresentation({
                projection: ready('A'),
                owner: { token: {}, isCurrent: current },
                get entries(): ReadonlyMap<string, ComputedPresentationEntry> {
                    throw Error('stale leaf inspection');
                },
            }),
            { status: 'unavailable' }
        );
});

it('refuses mid-composition retirement before inspecting a successor leaf', () => {
    let current = true;
    let reads = 0;
    const entries = new Map<string, ComputedPresentationEntry>([
        ['first', literal('A')],
        ['second', literal('B')],
    ]);
    const get = entries.get.bind(entries);
    entries.get = (key) => {
        reads++;
        current = false;
        return get(key);
    };
    assert.deepEqual(
        composeComputedPresentation({
            projection: ready('first', 'second'),
            entries,
            owner: { token: {}, isCurrent: () => current },
        }),
        { status: 'unavailable' }
    );
    assert.equal(reads, 1);
});

it('rejects duplicate, malformed and sparse occurrence keys', () => {
    const sparse: { key: string }[] = [];
    sparse[1] = { key: 'A' };
    for (const projection of [
        ready('A', 'A'),
        ready(''),
        { status: 'ready', occurrences: sparse },
        { status: 'ready', occurrences: [{ key: {} }] },
    ])
        assert.deepEqual(
            composeComputedPresentation({
                projection: projection as ComputedPresentationProjection,
                entries: new Map([['A', literal('A')]]),
                owner,
            }),
            { status: 'unavailable' }
        );
});

it('rejects cyclic nested projections and malformed rich DTOs', () => {
    const projection = ready('loop');
    assert.deepEqual(
        composeComputedPresentation({
            projection,
            entries: new Map([['loop', { kind: 'nested', projection }]]),
            owner,
        }),
        { status: 'unavailable' }
    );
    assert.deepEqual(
        composeComputedPresentation({
            projection: ready('bad'),
            entries: new Map([
                [
                    'bad',
                    {
                        kind: 'result',
                        result: {
                            kind: 'html',
                            html: { type: 'div' },
                        } as unknown as LookupResultPresentation,
                    },
                ],
            ]),
            owner,
        }),
        { status: 'unavailable' }
    );
});

it('preserves complete Formula and Rollup DTOs rather than flattening their modes', () => {
    const formula: LookupResultPresentation = {
        kind: 'formula',
        display: {
            mode: 'controlled',
            language: 'en',
            isValid: true,
            resultType: 'singleLineText',
            value: '<b>literal</b>',
            formattedValue: '<b>literal</b>',
            renderFormulaAsHTML: true,
        },
    };
    const rollup: LookupResultPresentation = {
        kind: 'rollup',
        display: {
            mode: 'controlled',
            language: 'en',
            isValid: true,
            value: '0.00',
        },
    };
    const state = composeComputedPresentation({
        projection: ready('formula', 'rollup'),
        entries: new Map([
            ['formula', { kind: 'result', result: formula }],
            ['rollup', { kind: 'result', result: rollup }],
        ]),
        owner,
    });
    assert.equal(state.status, 'ready');
    if (state.status !== 'ready' || state.result.kind !== 'sequence')
        throw Error('sequence');
    assert.equal(state.result.leaves[0].result, formula);
    assert.equal(state.result.leaves[1].result, rollup);
});
