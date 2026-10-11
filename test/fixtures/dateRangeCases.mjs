import moment from 'moment-timezone';

const ranges = [
    'the past year',
    'the past month',
    'the past week',
    'the next week',
    'the next month',
    'the next year',
    'this week',
    'today or in the past',
    'today or in the future',
];
const configurations = [
    { kind: 'date', timeZone: null },
    { kind: 'dateTime', timeZone: 'UTC' },
    { kind: 'dateTime', timeZone: 'utc' },
    { kind: 'dateTime', timeZone: 'America/Los_Angeles' },
    { kind: 'dateTime', timeZone: 'Asia/Kathmandu' },
];
// These construct inputs only. Every expected result comes from the pinned
// canonical export, never from these endpoint calculations.
const endpoints = (now, range) => {
    const end = (value) => value.endOf('day');
    if (range.startsWith('the past ')) {
        const unit = range.slice('the past '.length);
        return [
            end(now.clone().add({ [unit]: -1, days: -1 })),
            end(now.clone()),
        ];
    }
    if (range.startsWith('the next ')) {
        const unit = range.slice('the next '.length);
        return [
            end(now.clone().add(-1, 'days')),
            end(now.clone().add(1, unit)),
        ];
    }
    if (range === 'this week')
        return [now.clone().startOf('isoWeek'), end(now.clone())];
    return range === 'today or in the past'
        ? [now.clone().add(1, 'days').startOf('day')]
        : [end(now.clone().subtract(1, 'days'))];
};
const cases = [];
const appendBoundaries = (config, dateRange, now, label) => {
    const localNow = moment.utc(now).tz(config.timeZone ?? 'UTC');
    for (const [boundary, endpoint] of endpoints(
        localNow,
        dateRange
    ).entries()) {
        for (const offset of [-1, 0, 1]) {
            const input = endpoint.clone().add(offset, 'milliseconds');
            cases.push({
                id: `${label}:${config.kind}:${config.timeZone ?? 'date-only'}:${dateRange}:${boundary}:${offset}`,
                ...config,
                dateRange,
                value:
                    config.kind === 'date'
                        ? input.format('YYYY-MM-DD')
                        : input
                              .clone()
                              .utc()
                              .format('YYYY-MM-DDTHH:mm:ss.SSS[Z]'),
                now,
            });
        }
    }
};
for (const [label, now] of [
    ['leap-month-end', '2024-02-29T23:45:00.000Z'],
    ['spring-DST-cross-zone', '2024-03-10T07:30:00.000Z'],
]) {
    for (const config of configurations)
        for (const range of ranges) appendBoundaries(config, range, now, label);
}
for (const range of ['the past month', 'the next month', 'this week']) {
    appendBoundaries(
        { kind: 'dateTime', timeZone: 'America/Los_Angeles' },
        range,
        '2024-11-03T09:30:00.000Z',
        'fall-DST'
    );
    appendBoundaries(
        { kind: 'dateTime', timeZone: 'Asia/Kathmandu' },
        range,
        '2025-01-31T20:30:00.000Z',
        'month-clamp-cross-zone'
    );
}
for (const [id, kind, value, dateRange] of [
    ['invalid-date', 'date', '2024-02-30', 'the next week'],
    ['invalid-date-time', 'dateTime', 'not-a-date', 'the next week'],
    ['date-has-time', 'date', '2024-03-10T00:00:00.000Z', 'this week'],
    ['null-range', 'date', '2024-03-10', null],
    ['unknown-range', 'date', '2024-03-10', 'unknown range'],
    ['invalid-before-unknown', 'date', 'bad-date', 'unknown range'],
    [
        'offset-instant',
        'dateTime',
        '2024-03-10T00:30:00.000-08:00',
        'this week',
    ],
    ['date-only-ISO-time', 'dateTime', '2024-03-10', 'this week'],
]) {
    cases.push({
        id,
        kind,
        timeZone: kind === 'date' ? null : 'America/Los_Angeles',
        dateRange,
        value,
        now: '2024-03-10T07:30:00.000Z',
    });
}
export const dateRangeCases = cases;
