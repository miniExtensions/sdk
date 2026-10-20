import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
    isDurationInputText,
    parseDurationInputSeconds,
    getFormattedDuration,
} from '../src/formulas/index.js';
import type { DurationFormat } from '../src/formulas/types.js';

const formats: DurationFormat[] = [
    'h:mm',
    'h:mm:ss',
    'h:mm:ss.S',
    'h:mm:ss.SS',
    'h:mm:ss.SSS',
];

it('preserves accepted partial clock drafts and rejects unsupported characters/precision', () => {
    for (const input of [
        '',
        '-',
        ':',
        '::',
        '7',
        '-7',
        '25:72',
        '-1:01:20.125',
        '12.',
        '12.123',
    ])
        assert.equal(isDurationInputText(input), true, input);
    for (const input of [
        '.',
        '-.',
        ' ',
        ' 7',
        '7 ',
        'abc',
        '+7',
        '1e3',
        '1,5',
        '1.1234',
        '1:02.1234',
        '--1',
    ])
        assert.equal(isDurationInputText(input), false, input);
});

for (const format of formats) {
    it(`keeps bare units, overflow, fractions and partial conversion for ${format}`, () => {
        const scale = format === 'h:mm' ? 60 : 1;
        for (const [input, seconds] of [
            ['0', 0],
            ['7', 7],
            ['-7', -7],
            ['212.25', 212.25],
            ['-212.25', -212.25],
            ['5000.25', 5000.25],
        ] as const)
            assert.equal(
                parseDurationInputSeconds(input, format),
                seconds * scale,
                input
            );
        assert.equal(parseDurationInputSeconds('', format), null);
        assert.equal(parseDurationInputSeconds('-', format), 0);
        assert.equal(parseDurationInputSeconds(':', format), 0);
        assert.equal(
            parseDurationInputSeconds('12:40', format),
            format === 'h:mm' ? 45600 : 760
        );
        assert.equal(
            parseDurationInputSeconds('-12:40', format),
            format === 'h:mm' ? -45600 : -760
        );
        assert.equal(
            parseDurationInputSeconds('25:72', format),
            format === 'h:mm' ? 94320 : 1572
        );
        assert.equal(
            parseDurationInputSeconds('-25:72', format),
            format === 'h:mm' ? -94320 : -1572
        );
        assert.equal(
            parseDurationInputSeconds('2777:46:40.000', format),
            10000000
        );
        assert.equal(
            parseDurationInputSeconds('-1:01:20.125', format),
            -3680.125
        );
    });
}

it('retains unvalidated conversion behavior separately from editor admission', () => {
    for (const input of ['.', 'abc']) {
        assert.equal(isDurationInputText(input), false);
        assert.equal(parseDurationInputSeconds(input, 'h:mm:ss'), 0);
    }
});

it('keeps native seconds explicit and leaves display normalization to the existing formatter', () => {
    assert.equal(parseDurationInputSeconds('7', 'h:mm'), 420);
    assert.equal(getFormattedDuration('420', 'h:mm', true), '0:07');
    assert.equal(parseDurationInputSeconds('1:20.125', 'h:mm:ss.SSS'), 80.125);
    assert.equal(
        getFormattedDuration('80.125', 'h:mm:ss.SSS', true),
        '1:20.125'
    );
});
