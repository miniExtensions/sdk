import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { RuntimeAirtableField } from '../src/runtime/types.js';
import {
    getCalendarFieldUtcOffset,
    getPortalCalendarDateKeys,
    isCalendarDateField,
    parseCalendarFieldDate,
    projectCalendarRecordPickerDays,
    projectPortalCalendarDays,
} from '../src/ui/calendarDateProjection.js';

const date: RuntimeAirtableField = {
    id: 'date',
    name: 'Date',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'date',
        options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
    },
};
const computed: RuntimeAirtableField = {
    ...date,
    config: {
        type: 'formula',
        options: { isValid: true, result: date.config },
    },
};
const datetime = (
    timeZone: 'America/Los_Angeles' | 'client'
): RuntimeAirtableField => ({
    ...date,
    config: {
        type: 'dateTime',
        options: {
            dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
            timeFormat: { name: '24hour', format: 'HH:mm' },
            timeZone,
        },
    },
});

it('preserves distinct picker UTC and Portal parsed-zone computed DATE days', () => {
    const value = '2026-09-01T00:00:00.000+14:00';
    assert.equal(
        parseCalendarFieldDate({ field: computed, value })?.format(
            'YYYY-MM-DD'
        ),
        '2026-08-31'
    );
    assert.deepEqual(
        getPortalCalendarDateKeys({
            field: computed,
            value,
            fallbackClientUtcOffset: -480,
        }),
        ['2026-09-01']
    );
    const record = { id: 'record', fields: { start: value, end: value } };
    assert.deepEqual(
        [
            ...projectCalendarRecordPickerDays({
                records: [record],
                startField: { ...computed, id: 'start' },
                endField: { ...computed, id: 'end' },
                queryMonth: '2026-08',
            }).keys(),
        ],
        ['2026-08-31']
    );
    assert.deepEqual(
        [
            ...projectPortalCalendarDays({
                records: [record],
                field: { ...computed, id: 'start' },
                fallbackClientUtcOffset: -480,
            }).keys(),
        ],
        ['2026-09-01']
    );
});

it('keeps field zones and DST endpoint offsets distinct from the Portal viewer zone', () => {
    const field = datetime('America/Los_Angeles');
    const value = '2026-09-01T06:30:00.000Z';
    assert.equal(
        parseCalendarFieldDate({ field, value })?.format('YYYY-MM-DD'),
        '2026-08-31'
    );
    assert.deepEqual(
        getPortalCalendarDateKeys({
            field,
            value,
            clientTimeZone: 'Pacific/Kiritimati',
            fallbackClientUtcOffset: 0,
        }),
        ['2026-09-01']
    );
    assert.deepEqual(
        getPortalCalendarDateKeys({
            field,
            value,
            clientTimeZone: 'invalid',
            fallbackClientUtcOffset: -480,
        }),
        ['2026-08-31']
    );
    for (const [boundaryDate, offset] of [
        ['2026-11-01', -420],
        ['2026-12-01', -480],
    ] as const) {
        assert.equal(
            getCalendarFieldUtcOffset({
                field,
                boundaryDate,
                fallbackClientUtcOffset: 123,
            }),
            offset
        );
    }
    assert.equal(
        getCalendarFieldUtcOffset({
            field: datetime('client'),
            boundaryDate: '2026-12-01',
            fallbackClientUtcOffset: 123,
        }),
        123
    );
    assert.equal(
        getCalendarFieldUtcOffset({
            field: datetime('client'),
            boundaryDate: '2026-12-01',
            clientTimeZone: 'America/Los_Angeles',
            fallbackClientUtcOffset: 123,
        }),
        -480
    );
    assert.equal(
        getCalendarFieldUtcOffset({
            field: computed,
            boundaryDate: '2026-12-01',
            fallbackClientUtcOffset: 123,
        }),
        0
    );
});

it('clips inclusive picker ranges to the query month and rejects malformed pairs independently', () => {
    const records = [
        { id: 'span', fields: { start: '2026-08-30', end: '2026-09-02' } },
        { id: 'invalid', fields: { start: '2026-09-01', end: undefined } },
        { id: 'array', fields: { start: ['2026-09-01'], end: '2026-09-01' } },
        { id: 'reverse', fields: { start: '2026-09-02', end: '2026-09-01' } },
        { id: 'same', fields: { start: '2026-09-02', end: '2026-09-02' } },
    ];
    const options = {
        records,
        startField: { ...date, id: 'start' },
        endField: { ...date, id: 'end' },
        queryMonth: '2026-09',
    };
    const days = projectCalendarRecordPickerDays(options);
    assert.deepEqual([...days.keys()], ['2026-09-01', '2026-09-02']);
    assert.deepEqual(
        days.get('2026-09-02')?.map((record) => record.id),
        ['span', 'same']
    );
    assert.equal(days.get('2026-09-01')?.[0], records[0]);
    records[1].fields.end = '2026-09-01';
    assert.deepEqual(
        projectCalendarRecordPickerDays(options)
            .get('2026-09-01')
            ?.map((record) => record.id),
        ['span', 'invalid']
    );
    assert.equal(
        projectCalendarRecordPickerDays({ ...options, queryMonth: '2026-13' })
            .size,
        0
    );
    assert.equal(
        projectCalendarRecordPickerDays({ ...options, startField: null }).size,
        0
    );
});

it('keeps Portal array day order, one record per key, and no dates from nonstrings', () => {
    const value = [
        '2026-09-03',
        '2026-09-01',
        '2026-09-03',
        false,
        0,
        null,
        'bad',
        '2026-02-30',
    ];
    assert.deepEqual(
        getPortalCalendarDateKeys({
            field: computed,
            value,
            fallbackClientUtcOffset: 0,
        }),
        ['2026-09-03', '2026-09-01']
    );
    const records = [
        { id: 'a', fields: { date: value } },
        { id: 'b', fields: { date: '2026-09-01' } },
    ];
    const result = projectPortalCalendarDays({
        records,
        field: date,
        fallbackClientUtcOffset: 0,
    });
    assert.deepEqual([...result.keys()], ['2026-09-03', '2026-09-01']);
    assert.deepEqual(
        result.get('2026-09-01')?.map((record) => record.id),
        ['a', 'b']
    );
    const text: RuntimeAirtableField = {
        ...date,
        config: { type: 'singleLineText', options: null },
    };
    assert.equal(isCalendarDateField(text), false);
    assert.equal(isCalendarDateField(computed), true);
    assert.deepEqual(
        getPortalCalendarDateKeys({
            field: text,
            value: '2026-09-01',
            fallbackClientUtcOffset: 0,
        }),
        []
    );
    assert.equal(
        parseCalendarFieldDate({ field: text, value: '2026-09-01' }),
        null
    );
    assert.equal(
        parseCalendarFieldDate({ field: date, value: '2026-02-30' }),
        null
    );
});
