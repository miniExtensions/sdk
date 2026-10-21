import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const dateInputCompatibilityTypedConsumer = `
import {getDateInputPickerValue,getDateInputValueOnChange,getDateInputValueOnBlur,isDateInputValueWithinRange,formatDateInputValue,getDateInputMomentLocale,type DateInputCompatibilityConfig,type DateInputRange,type DateInputBlurResult} from '@miniextensions/sdk/ui';
const dateInputConfig:DateInputCompatibilityConfig={type:'date',options:{dateFormat:{format:'YYYY-MM-DD'}}};
const dateInputRange:DateInputRange='this week';
const dateInputBlur:DateInputBlurResult=getDateInputValueOnBlur({inputValue:'2024-02-29',config:dateInputConfig});
if(dateInputBlur.isValid){const nativeDate:string|null=dateInputBlur.value;void nativeDate;}
const datePicker=getDateInputPickerValue('2024-02-29');
if(typeof datePicker!=='string')getDateInputValueOnChange(datePicker,'date');
const dateInRange:boolean=isDateInputValueWithinRange({airtableFieldConfig:dateInputConfig,airtableValue:'2024-02-29',dateRange:dateInputRange});
const formattedDate:string=formatDateInputValue({airtableValue:'2024-02-29',airtableFieldConfig:dateInputConfig,language:'zh-Hans'});
// @ts-expect-error preserve the finite host range contract
const unsupportedDateRange:DateInputRange='tomorrow';
// @ts-expect-error native input bytes are strings
getDateInputValueOnBlur({inputValue:123,config:dateInputConfig});
// @ts-expect-error locales use the canonical language contract
getDateInputMomentLocale('zh');
void dateInRange;void formattedDate;void unsupportedDateRange;
`;

export async function checkDateInputCompatibilityConsumer({
    consumerDirectory,
}) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/ui/index.js'
            )
        )
    );
    const moment = consumer('moment-timezone');
    const previousLocale = moment.locale();
    consumer('moment/locale/fr');
    try {
        let groups = 0;
        for (const api of [esm, consumer('@miniextensions/sdk/ui')]) {
            const date = {
                type: 'date',
                options: { dateFormat: { format: 'YYYY-MM-DD' } },
            };
            const datetime = {
                type: 'dateTime',
                options: {
                    dateFormat: { format: 'YYYY-MM-DD' },
                    timeFormat: { format: 'HH:mm' },
                    timeZone: 'Asia/Kathmandu',
                },
            };
            assert.equal(api.getDateInputPickerValue(null), '');
            const picker = moment.parseZone('2024-02-29T23:58:59.987-08:00');
            assert.equal(
                api.getDateInputValueOnChange(picker, 'date'),
                '2024-02-29'
            );
            assert.equal(
                api.getDateInputValueOnChange(picker, 'dateTime'),
                '2024-03-01T07:58:00.000Z'
            );
            assert.deepEqual(
                api.getDateInputValueOnBlur({ inputValue: '', config: date }),
                { isValid: true, value: null }
            );
            assert.deepEqual(
                api.getDateInputValueOnBlur({
                    inputValue: '2023-02-29',
                    config: date,
                }),
                { isValid: false }
            );
            assert.deepEqual(
                api.getDateInputValueOnBlur({
                    inputValue: '2024-02-29 23:58',
                    config: datetime,
                }),
                { isValid: true, value: '2024-02-29T18:13:00.000Z' }
            );
            assert.equal(api.isDateInputTimeZone('not/a-zone'), false);
            assert.equal(api.getDateInputTimeZone(datetime), 'Asia/Kathmandu');
            assert.equal(api.getDateInputFormat(datetime), 'YYYY-MM-DD HH:mm');
            assert.equal(
                api.resolveDateInputRangeTimeZone({
                    airtableFieldConfig: {
                        ...datetime,
                        options: { ...datetime.options, timeZone: 'client' },
                    },
                    clientTimeZone: 'not/a-zone',
                }),
                'UTC'
            );
            assert.equal(
                api.isDateInputValueWithinRange({
                    airtableFieldConfig: date,
                    airtableValue: '2025-06-16',
                    dateRange: 'this week',
                    now: moment.utc('2025-06-16T12:00:00Z'),
                }),
                true
            );
            assert.equal(
                api.isDateInputWithinRange(
                    moment.utc('2025-06-15T23:59:59.999Z'),
                    'the next week',
                    { now: moment.utc('2025-06-16T12:00:00Z'), timeZone: 'UTC' }
                ),
                false
            );
            assert.equal(api.isDateInputRange('the next week'), true);
            assert.equal(api.isDateInputRange('tomorrow'), false);
            assert.equal(api.getDateInputMomentLocale('en'), null);
            assert.equal(api.getDateInputMomentLocale('zh-Hans'), 'zh-cn');
            assert.equal(
                api.formatDateInputValue({
                    airtableValue: '2024-01-02',
                    airtableFieldConfig: {
                        type: 'date',
                        options: { dateFormat: { format: 'LL' } },
                    },
                    language: 'fr',
                }),
                '2 janvier 2024'
            );
            groups++;
        }
        return groups;
    } finally {
        moment.locale(previousLocale);
    }
}
