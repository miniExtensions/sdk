import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import moment from 'moment-timezone';
import 'moment/locale/fr.js';
import {
    isDateInputRange,
    formatDateInputValue,
    getDateInputFormat,
    getDateInputMomentLocale,
    getDateInputPickerValue,
    getDateInputTimeZone,
    getDateInputValueOnBlur,
    getDateInputValueOnChange,
    isDateInputTimeZone,
    isDateInputValueWithinRange,
    isDateInputWithinRange,
    resolveDateInputRangeTimeZone,
    type DateInputCompatibilityConfig,
    type DateInputRange,
} from '../src/ui/dateInputCompatibility.js';

const date: DateInputCompatibilityConfig = {
    type: 'date',
    options: { dateFormat: { format: 'YYYY-MM-DD' } },
};
const datetime = (timeZone: string): DateInputCompatibilityConfig => ({
    type: 'dateTime',
    options: {
        dateFormat: { format: 'YYYY-MM-DD' },
        timeFormat: { format: 'HH:mm' },
        timeZone,
    },
});

it('retains picker drafts, calendar dates and UTC minute writes without mutating the picker', () => {
    assert.equal(getDateInputPickerValue(null), '');
    assert.equal(getDateInputPickerValue(''), '');
    assert.equal(getDateInputPickerValue('2024-02-30'), '');
    const value = moment.parseZone('2024-02-29T23:58:59.987-08:00');
    const before = value.format();
    assert.equal(getDateInputValueOnChange(value, 'date'), '2024-02-29');
    assert.equal(
        getDateInputValueOnChange(value, 'dateTime'),
        '2024-03-01T07:58:00.000Z'
    );
    assert.equal(value.format(), before);
    const picker = getDateInputPickerValue('2024-02-29T23:58:59.987Z');
    assert(moment.isMoment(picker));
    assert.equal(picker.valueOf(), Date.parse('2024-02-29T23:58:59.987Z'));
});

it('strict blur parsing preserves clear, invalid-draft recovery, offsets and leap dates', () => {
    assert.deepEqual(
        getDateInputValueOnBlur({ inputValue: '', config: date }),
        { isValid: true, value: null }
    );
    for (const inputValue of ['2024-02', '2023-02-29', '2024-02-29x', ' ']) {
        assert.deepEqual(
            getDateInputValueOnBlur({ inputValue, config: date }),
            { isValid: false }
        );
    }
    assert.deepEqual(
        getDateInputValueOnBlur({ inputValue: '2024-02-29', config: date }),
        { isValid: true, value: '2024-02-29' }
    );
    assert.deepEqual(
        getDateInputValueOnBlur({
            inputValue: '2024-02-29 23:58',
            config: datetime('Asia/Kathmandu'),
        }),
        { isValid: true, value: '2024-02-29T18:13:00.000Z' }
    );
    assert.deepEqual(
        getDateInputValueOnBlur({
            inputValue: '2024-02-29',
            config: datetime('UTC'),
        }),
        { isValid: false }
    );
});

it('shares the frozen canonical calendar/range outcomes without changing input moments', () => {
    const fixture = JSON.parse(
        readFileSync('test/fixtures/dateRanges.json', 'utf8')
    ) as {
        validation: {
            id: string;
            kind: 'date' | 'dateTime';
            timeZone: string | null;
            dateRange: unknown;
            value: string;
            now: string;
            canonical:
                | { type: 'result'; withinRange: boolean }
                | { type: 'throws' };
        }[];
    };
    let comparisons = 0;
    for (const sample of fixture.validation) {
        if (sample.canonical.type !== 'result') continue;
        const range =
            sample.dateRange == null
                ? undefined
                : (sample.dateRange as DateInputRange);
        const now = moment.utc(sample.now);
        const nowBefore = now.valueOf();
        const actual = isDateInputValueWithinRange({
            airtableFieldConfig:
                sample.kind === 'date' ? date : datetime(sample.timeZone!),
            airtableValue: sample.value,
            dateRange: range,
            now,
        });
        assert.equal(actual, sample.canonical.withinRange, sample.id);
        assert.equal(now.valueOf(), nowBefore, sample.id);
        comparisons++;
    }
    assert.equal(comparisons, 523);
});

it('keeps range-zone provenance distinct from display guessing, with UTC client fallback', () => {
    assert.equal(isDateInputRange('this week'), true);
    assert.equal(isDateInputRange('unsupported'), false);
    assert.equal(isDateInputRange(null), false);
    const now = moment.utc('2025-06-16T00:30:00Z');
    const value = '2025-06-15T14:00:00.000Z';
    assert.equal(
        resolveDateInputRangeTimeZone({
            airtableFieldConfig: date,
            clientTimeZone: 'America/Los_Angeles',
        }),
        'UTC'
    );
    for (const zone of [undefined, 'not/a-zone', '']) {
        assert.equal(
            resolveDateInputRangeTimeZone({
                airtableFieldConfig: datetime('client'),
                clientTimeZone: zone,
            }),
            'UTC'
        );
        assert.equal(isDateInputTimeZone(zone), false);
    }
    assert.equal(isDateInputTimeZone('Asia/Kathmandu'), true);
    for (const [config, clientTimeZone, expected] of [
        [datetime('UTC'), 'America/Los_Angeles', false],
        [datetime('America/Anguilla'), 'Asia/Tokyo', true],
        [datetime('client'), 'America/Los_Angeles', true],
    ] as const) {
        assert.equal(
            isDateInputValueWithinRange({
                airtableFieldConfig: config,
                airtableValue: value,
                dateRange: 'the next week',
                clientTimeZone,
                now,
            }),
            expected
        );
    }
    assert.equal(
        isDateInputValueWithinRange({
            airtableFieldConfig: date,
            airtableValue: '2024-02-30',
            now,
        }),
        false
    );
    const invalid = moment.invalid();
    assert.equal(isDateInputWithinRange(invalid), true);
    assert.throws(
        () => isDateInputWithinRange(now, 'unsupported' as DateInputRange),
        Error
    );
});

it('preserves localized formatting and Moment locale mappings without changing global locale', () => {
    const previous = moment.locale();
    try {
        moment.locale('en');
        const friendly: DateInputCompatibilityConfig = {
            type: 'date',
            options: { dateFormat: { format: 'LL' } },
        };
        assert.equal(
            formatDateInputValue({
                airtableValue: '2024-01-02',
                airtableFieldConfig: friendly,
                language: 'fr',
            }),
            '2 janvier 2024'
        );
        assert.equal(
            formatDateInputValue({
                airtableValue: '2024-01-02',
                airtableFieldConfig: friendly,
            }),
            'January 2, 2024'
        );
        assert.equal(
            formatDateInputValue({
                airtableValue: null,
                airtableFieldConfig: friendly,
            }),
            ''
        );
        assert.equal(
            formatDateInputValue({
                airtableValue: new Date('2024-01-02T03:04:05Z'),
                airtableFieldConfig: datetime('Asia/Kathmandu'),
            }),
            '2024-01-02 08:49'
        );
        assert.equal(getDateInputMomentLocale('en'), null);
        assert.throws(
            () => getDateInputMomentLocale('unsupported' as 'en'),
            Error
        );
        assert.equal(getDateInputMomentLocale('zh-Hans'), 'zh-cn');
        for (const language of [
            'es',
            'fr',
            'vi',
            'nl',
            'de',
            'ja',
            'ko',
            'pt',
            'cs',
            'he',
            'it',
            'ka',
            'ca',
        ] as const) {
            assert.equal(getDateInputMomentLocale(language), language);
        }
        assert.equal(moment.locale(), 'en');
        assert.equal(getDateInputFormat(date), 'YYYY-MM-DD');
        assert.equal(
            getDateInputTimeZone({
                type: 'dateTime',
                options: {
                    dateFormat: { format: 'YYYY-MM-DD' },
                    timeFormat: { format: 'HH:mm' },
                    timeZone: 'client',
                },
            }),
            moment.tz.guess()
        );
        const config = datetime('UTC');
        assert.equal(getDateInputFormat(config), 'YYYY-MM-DD HH:mm');
        assert.equal(
            getDateInputTimeZone(
                config as Extract<
                    DateInputCompatibilityConfig,
                    { type: 'dateTime' }
                >
            ),
            'UTC'
        );
    } finally {
        moment.locale(previous);
    }
});
