import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReviewFixture } from './build-privacy-browser-proof.mjs';
export function addDateReviewAnswers(page) {
    for (const [id, type, value] of [
        ['fld_review_date', 'date', '2024-02-29'],
        ['fld_review_datetime', 'dateTime', '2026-03-08T10:30:00.000Z'],
    ]) {
        page.payload.fieldIdsInForm.push(id);
        page.payload.fieldIdsToSchemas[id] = {
            fieldType: type,
            airtableField: {
                id,
                name: 'Date answer',
                isComputed: false,
                isPrimaryField: false,
                description: null,
                config: {
                    type,
                    options: {
                        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
                        ...(type === 'dateTime'
                            ? {
                                  timeFormat: {
                                      name: '24hour',
                                      format: 'HH:mm',
                                  },
                                  timeZone: 'utc',
                              }
                            : {}),
                    },
                },
            },
            miniExtConfig: { readOnly: true },
        };
        page.payload.formRecord.data[id] = value;
    }
    return ['2024-02-29', '2026-03-08 10:30'];
}
export function assertDateReviewMatrix(prepareFormReviewRows) {
    const fixture = JSON.parse(
        readFileSync('test/fixtures/reviewDates.json', 'utf8')
    );
    assert.equal(
        fixture.provenance.revision,
        '58f73d575ab10baa0a10693660d8002f204368e1'
    );
    const oldTZ = process.env.TZ;
    let checks = 0;
    try {
        for (const item of fixture.cases) {
            process.env.TZ = item.localZone;
            const page = createReviewFixture('review-answers').page();
            addDateReviewAnswers(page);
            const id =
                item.config.type === 'date'
                    ? 'fld_review_date'
                    : 'fld_review_datetime';
            page.payload.fieldIdsInForm = [id];
            page.payload.fieldIdsToSchemas[id].airtableField.config =
                structuredClone(item.config);
            const data = { [id]: item.value };
            const before = structuredClone(data);
            const run = () =>
                prepareFormReviewRows(page, data, undefined, {
                    clientTimeZone: item.localZone,
                });
            if (item.normalized) assert.throws(run, /Review is unavailable/);
            else assert.equal(run()[0].value, item.expected);
            assert.deepEqual(data, before);
            checks++;
        }
        process.env.TZ = 'UTC';
        const page = createReviewFixture('review-answers').page();
        addDateReviewAnswers(page);
        for (const id of ['fld_review_date', 'fld_review_datetime']) {
            page.payload.fieldIdsInForm = [id];
            for (const value of [undefined, null, '', ' \t ']) {
                assert.deepEqual(
                    prepareFormReviewRows(page, { [id]: value }),
                    []
                );
                checks++;
            }
            const invalid = [
                [],
                {},
                true,
                0,
                '2023-02-29',
                '2026-13-01',
                ' 2026-01-01',
            ];
            if (id.endsWith('datetime'))
                invalid.push(
                    '2026-01-01',
                    '2026-01-01T10:00:00',
                    '2026-01-01 10:00:00Z',
                    '2026-W01-1T10:00:00Z',
                    '2026-001T10:00:00Z',
                    '2026-01-01T24:00:00Z',
                    '2026-01-01T00:60:00Z',
                    '2026-01-01T00:00:60Z',
                    '2026-01-01T00:00:00+24:00',
                    '2026-01-01T00:00:00+01:60',
                    '2026-01-01T00:00:00.1234Z'
                );
            else invalid.push('2026-01-01T00:00:00Z');
            for (const value of invalid) {
                assert.throws(
                    () => prepareFormReviewRows(page, { [id]: value }),
                    /Review is unavailable/
                );
                checks++;
            }
            const good = page.payload.formRecord.data[id];
            const schema = page.payload.fieldIdsToSchemas[id];
            const original = structuredClone(schema);
            for (const dateFormat of [
                null,
                { name: 'iso', format: 'LL' },
                { name: 'wrong', format: 'YYYY-MM-DD' },
                { name: 'wrong' },
                { name: 'iso' },
            ]) {
                schema.airtableField.config.options.dateFormat = dateFormat;
                assert.throws(() =>
                    prepareFormReviewRows(page, { [id]: good })
                );
                checks++;
            }
            page.payload.fieldIdsToSchemas[id] = structuredClone(original);
            for (const flag of [
                'obscurePassword',
                'displayAsAttachments',
                'displayAsButton',
            ]) {
                page.payload.fieldIdsToSchemas[id].miniExtConfig[flag] = true;
                assert.throws(() =>
                    prepareFormReviewRows(page, { [id]: good })
                );
                delete page.payload.fieldIdsToSchemas[id].miniExtConfig[flag];
                checks++;
            }
            if (id.endsWith('datetime')) {
                for (const zone of [null, 'Not/AZone', '', 'client']) {
                    page.payload.fieldIdsToSchemas[
                        id
                    ].airtableField.config.options.timeZone = zone;
                    assert.throws(() =>
                        prepareFormReviewRows(page, { [id]: good })
                    );
                    checks++;
                }
                page.payload.fieldIdsToSchemas[id] = structuredClone(original);
                page.payload.fieldIdsToSchemas[
                    id
                ].airtableField.config.options.timeFormat = {
                    name: '24hour',
                    format: 'h:mma',
                };
                assert.throws(() =>
                    prepareFormReviewRows(page, { [id]: good })
                );
                checks++;
            }
            page.payload.fieldIdsToSchemas[id] = original;
        }
    } finally {
        if (oldTZ === undefined) delete process.env.TZ;
        else process.env.TZ = oldTZ;
    }
    return checks;
}
