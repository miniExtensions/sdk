import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import moment from 'moment-timezone';
import { validatePageDateRange } from '../src/forms/pageDateRange.js';
import type { LoadedFormFieldDescriptor } from '../src/forms/helpers.js';
import type { RuntimeFieldSchema } from '../src/runtime/types.js';

type Sample = {
    id: string;
    kind: 'date' | 'dateTime';
    timeZone: string | null;
    dateRange: unknown;
    value: string;
    now: string;
    canonical: { type: 'result'; withinRange: boolean } | { type: 'throws' };
};
const fixture = JSON.parse(
    readFileSync('test/fixtures/dateRanges.json', 'utf8')
) as { provenance: Record<string, unknown>; validation: Sample[] };
const hash = (path: string) =>
    createHash('sha256').update(readFileSync(path)).digest('hex');
const field = (
    sample: Sample,
    readOnly = false
): LoadedFormFieldDescriptor => ({
    fieldId: 'answer',
    title: 'Answer',
    fieldType: sample.kind,
    isComputed: false,
    readOnly,
    schema: {
        fieldType: sample.kind,
        airtableField: {
            id: 'answer',
            name: 'Answer',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: sample.kind,
                options: {
                    dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                    ...(sample.kind === 'dateTime'
                        ? {
                              timeFormat: { name: '24hour', format: 'HH:mm' },
                              timeZone: sample.timeZone,
                          }
                        : {}),
                },
            },
        },
        miniExtConfig: { dateRange: sample.dateRange, readOnly },
    } as RuntimeFieldSchema,
});

it('date range fixtures bind unchanged pinned predicate, inputs and generator', () => {
    assert.equal(
        fixture.provenance.revision,
        '58f73d575ab10baa0a10693660d8002f204368e1'
    );
    assert.equal(
        fixture.provenance.tree,
        'b39e58ead46a311c497def57474cf5ca720542ae'
    );
    assert.equal(
        fixture.provenance.generatorSha256,
        hash('scripts/generate-date-range-fixtures.mjs')
    );
    assert.equal(
        fixture.provenance.casesSourceSha256,
        hash('test/fixtures/dateRangeCases.mjs')
    );
    assert.equal(fixture.validation.length, 524);
    assert.equal(
        new Set(fixture.validation.map((sample) => sample.id)).size,
        524
    );
    assert.deepEqual(fixture.provenance.sources, {
        'range-predicate':
            '02e4995f46d9d2aa15865a98a9634eb7f6e4323e56466b62b72efc6fd6402cf5',
        'date-format':
            'a72e64e976dd4ead2df4670836535e24a6e58dc430635d7660575062c1df3726',
        'assert-unreachable':
            '4d028fb5576114f3840b4382de3d2a9062e95e6a9b9ffea4114401476f4d70c9',
        'airtable-field-types':
            '6426f0039a1dd4876c8dda07fd93e919c763b1418e3b2c4c75e1628c8d0726a4',
    });
});

it('date range feedback matches 523 canonical results and refuses the one thrown configuration generically', () => {
    const previous = moment.now;
    let results = 0,
        throws = 0;
    try {
        for (const sample of fixture.validation) {
            moment.now = () => Date.parse(sample.now);
            const original = structuredClone(sample);
            const actual = validatePageDateRange(
                field(sample),
                sample.value,
                null,
                false
            );
            if (sample.canonical.type === 'result') {
                assert.equal(
                    actual === null,
                    sample.canonical.withinRange,
                    sample.id
                );
                results++;
            } else {
                assert.equal(actual, 'invalid-metadata', sample.id);
                throws++;
            }
            assert.deepEqual(sample, original);
        }
        assert.equal(results, 523);
        assert.equal(throws, 1);
    } finally {
        moment.now = previous;
    }
});

it('date range feedback preserves exact exemptions and does not invent client-zone provenance', () => {
    for (const kind of ['date', 'dateTime'] as const) {
        const sample = fixture.validation.find((value) => value.kind === kind)!;
        const malformed = { ...sample, dateRange: { invalid: true } };
        for (const value of [null, undefined, ''])
            assert.equal(
                validatePageDateRange(field(malformed), value, 'other', false),
                null
            );
        assert.equal(
            validatePageDateRange(
                field(malformed),
                sample.value,
                sample.value,
                false
            ),
            null
        );
        assert.equal(
            validatePageDateRange(field(malformed), sample.value, null, true),
            null
        );
        assert.equal(
            validatePageDateRange(
                field(malformed, true),
                sample.value,
                null,
                false
            ),
            null
        );
        assert.equal(
            validatePageDateRange(field(malformed), sample.value, null, false),
            'invalid-metadata'
        );
    }
    const sample = fixture.validation.find(
        (value) => value.kind === 'dateTime'
    )!;
    assert.equal(
        validatePageDateRange(
            field({ ...sample, timeZone: 'client' }),
            sample.value,
            null,
            false
        ),
        null
    );
    for (const timeZone of ['Unknown/Zone', '', null])
        assert.equal(
            validatePageDateRange(
                field({ ...sample, timeZone }),
                sample.value,
                null,
                false
            ),
            'invalid-metadata'
        );
});
