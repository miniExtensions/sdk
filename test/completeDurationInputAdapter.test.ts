import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createDurationInputAdapter } from '../src/ui/index.js';
import type { DurationFormat } from '../src/formulas/index.js';

type Owner = NonNullable<
    ReturnType<Parameters<typeof createDurationInputAdapter>[0]['read']>
>;

const formats: DurationFormat[] = [
    'h:mm',
    'h:mm:ss',
    'h:mm:ss.S',
    'h:mm:ss.SS',
    'h:mm:ss.SSS',
];

function fixture(format: DurationFormat = 'h:mm:ss.SSS') {
    let current = true;
    const writes: (number | null)[] = [];
    const owner: Owner = {
        format,
        value: 60,
        onChange(value) {
            writes.push(value);
            owner.value = value;
        },
    };
    let available: Owner | null = owner;
    const adapter = createDurationInputAdapter({
        read: () => available,
        isCurrent: () => current,
    });
    return {
        owner,
        writes,
        adapter,
        setAvailable(value: Owner | null) {
            available = value;
        },
        setCurrent(value: boolean) {
            current = value;
        },
    };
}

for (const format of formats)
    it(`portable native Duration preserves clock grammar and seconds for ${format}`, () => {
        const f = fixture(format);
        assert.equal(f.adapter.isCurrent(), true);
        assert.equal(f.adapter.canEdit(), true);
        assert.deepEqual(f.writes, []);
        // Literal native expectations, independent of the implementation's parser.
        const cases: [string, number | null][] = [
            ['7', format === 'h:mm' ? 420 : 7],
            ['-7', format === 'h:mm' ? -420 : -7],
            ['12:40', format === 'h:mm' ? 45600 : 760],
            ['25:72', format === 'h:mm' ? 94320 : 1572],
            ['-1:01:20.125', -3680.125],
            ['0', 0],
            // Native draft grammar deliberately permits Moment's zero coercion.
            ['-', 0],
            [':', 0],
            ['1:', 0],
            ['', null],
        ];
        for (const [input, expected] of cases) {
            const before = f.writes.length;
            assert.equal(f.adapter.setInput(input), true, input);
            assert.equal(f.writes.length, before + 1, input);
            assert.equal(f.writes.at(-1), expected, input);
            assert.equal(f.owner.value, expected, input);
        }
    });

it('portable native Duration refuses unsupported text and nonfinite conversion without a write', () => {
    const f = fixture();
    for (const input of [
        'invalid-clock',
        '.',
        '-.',
        ' 7',
        '7 ',
        '+7',
        '1e3',
        '1,5',
        '1.1234',
        '1:02.1234',
        'NaN',
        'Infinity',
        '9'.repeat(400),
    ]) {
        assert.equal(f.adapter.setInput(input), false, input);
        assert.equal(f.owner.value, 60, input);
        assert.deepEqual(f.writes, [], input);
    }
    assert.equal(f.adapter.setInput('1:20.125'), true);
    assert.deepEqual(f.writes, [80.125]);
});

it('portable native Duration reads current availability, readonly policy and controlled writer', () => {
    const f = fixture();
    f.setAvailable(null);
    assert.equal(f.adapter.canEdit(), false);
    assert.equal(f.adapter.setInput('7'), false);
    assert.deepEqual(f.writes, []);

    f.setAvailable(f.owner);
    f.owner.readOnly = true;
    assert.equal(f.adapter.canEdit(), false);
    assert.equal(f.adapter.setInput('7'), false);
    f.owner.readOnly = false;
    const successorWrites: (number | null)[] = [];
    f.owner.value = 12;
    f.owner.onChange = (value) => {
        successorWrites.push(value);
        f.owner.value = value;
    };
    assert.equal(f.adapter.canEdit(), true);
    assert.equal(f.adapter.setInput('8'), true);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(successorWrites, [8]);

    f.setCurrent(false);
    assert.equal(f.adapter.isCurrent(), false);
    assert.equal(f.adapter.canEdit(), false);
    assert.equal(f.adapter.setInput('9'), false);
    assert.deepEqual(successorWrites, [8]);
});

it('portable native Duration honors an explicit native refusal without allocating twice', () => {
    const f = fixture();
    let attempts = 0;
    f.owner.onChange = () => {
        attempts++;
        return false;
    };
    assert.equal(f.adapter.setInput('7'), false);
    assert.equal(attempts, 1);
    assert.equal(f.owner.value, 60);
    assert.deepEqual(f.writes, []);
});
