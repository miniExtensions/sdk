import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import test from 'node:test';
import { projectNativeLinkedRecordRows } from '../src/ui/index.js';

test('native linked rows retain first effective occurrence without rewriting selected values', () => {
    const ids = Object.freeze([
        'rec_b',
        'rec_a',
        'rec_b',
        'rec_missing',
        'rec_a',
    ]);
    const calls: string[] = [];
    const rows = projectNativeLinkedRecordRows(ids, (id) => {
        calls.push(id);
        return { id };
    });
    assert.deepEqual(
        rows.map((row) => row.recordId),
        ['rec_b', 'rec_a', 'rec_missing']
    );
    assert.deepEqual(calls, ['rec_b', 'rec_a', 'rec_missing']);
    assert.deepEqual(ids, ['rec_b', 'rec_a', 'rec_b', 'rec_missing', 'rec_a']);
});

test('native linked rows preserve rich objects, selected labels and nested native identities', () => {
    const file = new File(['native'], 'native.txt');
    const date = new Date('2026-01-01T00:00:00Z');
    const fields = {
        primary: 'Chosen native label — 選択',
        date,
        files: [file],
    };
    const native = { id: 'rec_a', fields };
    const display = {
        type: 'loaded',
        data: {
            record: native,
            primaryDetailField: { stringValue: fields.primary },
            detailFields: [],
        },
    };
    const rows = projectNativeLinkedRecordRows(
        ['rec_a', 'rec_a'],
        () => display
    );
    assert.equal(rows[0].data, display);
    assert.equal(rows[0].data.data.record, native);
    assert.equal(rows[0].data.data.record.fields, fields);
    assert.equal(rows[0].data.data.record.fields.date, date);
    assert.equal(rows[0].data.data.record.fields.files[0], file);
    assert.equal(
        rows[0].data.data.primaryDetailField.stringValue,
        'Chosen native label — 選択'
    );
});

test('native linked rows do not eagerly inspect, clone, format or await caller data', () => {
    let reads = 0;
    const opaque = Object.defineProperties(
        {},
        Object.fromEntries(
            ['raw', 'label', 'then'].map((name) => [
                name,
                {
                    get() {
                        reads++;
                        throw new Error('opaque caller-owned value');
                    },
                },
            ])
        )
    );
    const rows = projectNativeLinkedRecordRows(['rec_a'], () => opaque);
    assert.equal(rows[0].data, opaque);
    assert.equal(reads, 0);
});

test('native linked rows retain caller loading/unavailable projections without ID label fallback', () => {
    const unavailable = Object.freeze({
        type: 'failed',
        errorMessage: 'Localized unavailable',
    });
    const loading = Object.freeze({ type: 'loading' });
    const rows = projectNativeLinkedRecordRows(
        ['rec_missing', 'rec_loading'],
        (id) => (id === 'rec_missing' ? unavailable : loading)
    );
    assert.equal(rows[0].data, unavailable);
    assert.equal(rows[1].data, loading);
});

test('native linked rows preserve empty/case/whitespace IDs without introducing normalization', () => {
    const ids = ['', 'rec_a', ' rec_a ', 'REC_A', ''];
    assert.deepEqual(
        projectNativeLinkedRecordRows(ids, (id) => id).map(
            (row) => row.recordId
        ),
        ['', 'rec_a', ' rec_a ', 'REC_A']
    );
});

test('native linked rows read each fresh host projection without a persistent cache', () => {
    const a = { primary: 'A' },
        b = { primary: 'B' };
    assert.equal(projectNativeLinkedRecordRows(['rec_a'], () => a)[0].data, a);
    assert.equal(projectNativeLinkedRecordRows(['rec_a'], () => b)[0].data, b);
    assert.equal(projectNativeLinkedRecordRows(['rec_a'], () => a)[0].data, a);
});

test('native linked rows follow manual/scanner/calendar caller subsets and order only', () => {
    for (const filter of [
        { viewType: 'list', searchSource: 'manual', searchTerm: 'text' },
        {
            viewType: 'list',
            searchSource: 'barcode-scanner',
            searchTerm: 'code',
        },
        {
            viewType: 'calendar',
            startDate: '2026-01-01',
            endDate: '2026-01-31',
        },
    ]) {
        const ids = Object.freeze([
            'rec_allowed_b',
            'rec_allowed_a',
            'rec_allowed_b',
        ]);
        const rows = projectNativeLinkedRecordRows(ids, (id) => {
            assert.notEqual(id, 'rec_hidden');
            return { id, filter };
        });
        assert.deepEqual(
            rows.map((row) => row.recordId),
            ['rec_allowed_b', 'rec_allowed_a']
        );
        assert.equal(rows[0].data.filter, filter);
    }
});

for (const failure of [new Error('host resolver failed'), null, undefined]) {
    test(`native linked rows propagate original resolver failure ${String(failure)}`, () => {
        const notThrown = Symbol('not thrown');
        let caught: unknown = notThrown;
        try {
            projectNativeLinkedRecordRows(['rec_a'], () => {
                throw failure;
            });
        } catch (error) {
            caught = error;
        }
        assert.equal(caught, failure);
    });
}

test('native linked rows preserve Array.reduce sparse-hole and entry-length behavior', () => {
    const sparse = new Array<string>(4);
    sparse[1] = 'rec_a';
    sparse[3] = 'rec_a';
    const calls: string[] = [];
    assert.deepEqual(
        projectNativeLinkedRecordRows(sparse, (id) => {
            calls.push(id);
            return id;
        }).map((row) => row.recordId),
        ['rec_a']
    );
    assert.deepEqual(calls, ['rec_a']);
    const ids = ['rec_a'];
    assert.deepEqual(
        projectNativeLinkedRecordRows(ids, (id) => {
            ids.push('rec_b');
            return id;
        }).map((row) => row.recordId),
        ['rec_a']
    );
});

test('empty native linked projection never invokes the caller resolver', () => {
    assert.deepEqual(
        projectNativeLinkedRecordRows([], () => {
            throw new Error('must not read');
        }),
        []
    );
});
