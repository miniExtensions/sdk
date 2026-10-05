import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
    AirtableFieldType,
    type AirtableValue,
    type PortalLoadedResult,
    type RuntimeAirtableField,
    type RuntimeFieldSchema,
} from '../src/runtime/index.js';
import { createPortalCollection } from '../src/portals/index.js';
import { portalFixture, portalPage } from './portalFixtures.js';

type Config = RuntimeAirtableField['config'];
const textConfig = {
    type: AirtableFieldType.SINGLE_LINE_TEXT,
    options: null,
} satisfies Config;
const query = ' ?prefill_Title=Exact%20Case&hide_Title=true ';
const collaborator = {
    id: 'usr_example',
    name: query,
    email: 'example@example.test',
};
const numberConfig = {
    type: AirtableFieldType.NUMBER,
    options: { precision: 0 },
} satisfies Config;

const pageWithSource = (config: Config, value: AirtableValue) => {
    const page = portalPage();
    // The selected config determines both discriminants in this fixture.
    page.payload.fieldIdsToSchemas.fld_prefill = {
        fieldType: config.type,
        airtableField: {
            id: 'fld_prefill',
            name: 'Renamed source field',
            description: null,
            isComputed: [
                AirtableFieldType.FORMULA,
                AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
                AirtableFieldType.ROLLUP,
                AirtableFieldType.CREATED_BY,
                AirtableFieldType.LAST_MODIFIED_BY,
                AirtableFieldType.CREATED_TIME,
                AirtableFieldType.LAST_MODIFIED_TIME,
            ].some((type) => type === config.type),
            isPrimaryField: false,
            config,
        },
    } as RuntimeFieldSchema;
    page.payload.formRecord.data.fld_prefill = value;
    return page;
};
const assertPlan = (page: PortalLoadedResult, expected: string | null) => {
    const fixture = portalFixture();
    const owner = { ownerId: 'visitor_A', revision: 1 };
    const collection = createPortalCollection({
        client: fixture.client,
        portal: page,
        portalFieldId: 'fld_children',
        criteria: {
            selectedCustomViewId: 'view_example',
            searchTerm: null,
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
        },
        getScope: () => owner,
    });
    const plan = collection.childFormRequest({
        access: { type: 'create' },
        configuredChildExtensionId: 'extension_child',
    });
    const prefill = {
        toLinkToParent: {
            reversedFieldIdToPrefill: 'fld_parent',
            parentFormRecordId: 'record_parent',
        },
        prefillQueryForChildExtension: expected,
    };
    assert.deepEqual(plan.input.context, {
        type: 'modal',
        linkedTableIdOfLinkedRecordField: 'table_children',
        prefillDataForLinkedRecordsForm: prefill,
    });
    assert.deepEqual(plan.saveContext, {
        type: 'modal',
        prefillData: prefill,
    });
    assert.notEqual(
        plan.input.context.prefillDataForLinkedRecordsForm,
        plan.saveContext.prefillData
    );
    assert.equal(plan.isCurrent(), true);
    assert.equal(fixture.calls.length, 0);
    assert.equal(fixture.mutations, 0);
    collection.destroy();
    assert.equal(plan.isCurrent(), false);
};

describe('canonical child-create readable query sources', () => {
    const sources: {
        config: Config;
        value: AirtableValue;
        expected: string;
    }[] = [
        { config: textConfig, value: query, expected: query },
        {
            config: { type: AirtableFieldType.MULTILINE_TEXT, options: null },
            value: query,
            expected: query,
        },
        {
            config: { type: AirtableFieldType.RICH_TEXT, options: null },
            value: '**prefill_Title**=Example',
            expected: 'prefill_Title=Example',
        },
        {
            config: { type: AirtableFieldType.URL, options: null },
            value: query,
            expected: query,
        },
        {
            config: { type: AirtableFieldType.EMAIL, options: null },
            value: query,
            expected: query,
        },
        {
            config: { type: AirtableFieldType.PHONE_NUMBER, options: null },
            value: query,
            expected: query,
        },
        {
            config: { type: AirtableFieldType.BARCODE, options: null },
            value: { text: query, type: 'code128' },
            expected: query,
        },
        {
            config: {
                type: AirtableFieldType.SINGLE_SELECT,
                options: { choices: [{ id: 'sel_example', name: query }] },
            },
            value: query,
            expected: query,
        },
        {
            config: {
                type: AirtableFieldType.CREATED_BY,
                options: { choices: [collaborator] },
            },
            value: collaborator,
            expected: query,
        },
        {
            config: {
                type: AirtableFieldType.LAST_MODIFIED_BY,
                options: { choices: [collaborator] },
            },
            value: collaborator,
            expected: query,
        },
    ];
    for (const { config, value, expected } of sources) {
        it(`uses current ${config.type} metadata and preserves the formatted load/save query`, () => {
            assertPlan(pageWithSource(config, value), expected);
        });
    }

    it('recurses through formula and lookup readable results without recomputing expressions', () => {
        const barcode: Config = {
            type: AirtableFieldType.BARCODE,
            options: null,
        };
        const formula: Config = {
            type: AirtableFieldType.FORMULA,
            options: { isValid: true, result: barcode },
        };
        assertPlan(pageWithSource(formula, { text: query }), query);
        assertPlan(
            pageWithSource(formula, [
                { text: 'prefill_A=One' },
                null,
                { text: 'prefill_B=Two' },
            ]),
            'prefill_A=One, prefill_B=Two'
        );
        const lookup: Config = {
            type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
            options: {
                isValid: true,
                recordLinkFieldId: 'fld_source_link',
                fieldIdInLinkedTable: 'fld_source_value',
                result: formula,
            },
        };
        assertPlan(
            pageWithSource(lookup, [
                { text: 'prefill_A=One' },
                null,
                { text: 'prefill_B=Two' },
            ]),
            'prefill_A=One, prefill_B=Two'
        );
    });

    it('does not accept native or computed non-string readable types just because the cell is text', () => {
        const excluded: Config[] = [
            numberConfig,
            { type: AirtableFieldType.PERCENT, options: { precision: 0 } },
            {
                type: AirtableFieldType.SINGLE_COLLABORATOR,
                options: { choices: [collaborator] },
            },
            {
                type: AirtableFieldType.MULTIPLE_SELECTS,
                options: { choices: [{ id: 'sel_example', name: query }] },
            },
            {
                type: AirtableFieldType.ROLLUP,
                options: { isValid: true, result: textConfig },
            },
            {
                type: AirtableFieldType.FORMULA,
                options: { isValid: true, result: numberConfig },
            },
            {
                type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
                options: {
                    isValid: true,
                    recordLinkFieldId: 'fld_source_link',
                    fieldIdInLinkedTable: 'fld_source_value',
                    result: numberConfig,
                },
            },
        ];
        for (const config of excluded) {
            assertPlan(pageWithSource(config, query), null);
            assertPlan(pageWithSource(config, { error: query }), null);
        }
    });

    it('preserves canonical global error ordering while ordinary invalid computed results are blank', () => {
        const invalid: Config[] = [
            { type: AirtableFieldType.FORMULA, options: { result: null } },
            {
                type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
                options: {
                    isValid: false,
                    recordLinkFieldId: 'fld_source_link',
                    fieldIdInLinkedTable: 'fld_source_value',
                    result: null,
                },
            },
        ];
        for (const config of invalid) {
            assertPlan(pageWithSource(config, query), null);
            assertPlan(pageWithSource(config, { error: query }), query);
            assertPlan(pageWithSource(config, { error: ' \t ' }), null);
        }
    });

    it('omits blank readable results and catches formatter failures without discarding inverse context', () => {
        assertPlan(pageWithSource(textConfig, null), null);
        assertPlan(pageWithSource(textConfig, 123), null);
        assertPlan(
            pageWithSource(
                { type: AirtableFieldType.BARCODE, options: null },
                { text: '' }
            ),
            null
        );
        assertPlan(
            pageWithSource(
                { type: AirtableFieldType.BARCODE, options: null },
                {}
            ),
            null
        );
        assertPlan(
            pageWithSource(
                {
                    type: AirtableFieldType.CREATED_BY,
                    options: { choices: [] },
                },
                { ...collaborator, name: ' \t ' }
            ),
            null
        );
        const lookup: Config = {
            type: AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
            options: {
                isValid: true,
                recordLinkFieldId: 'fld_source_link',
                fieldIdInLinkedTable: 'fld_source_value',
                result: textConfig,
            },
        };
        assertPlan(pageWithSource(lookup, [null]), null);
        assertPlan(pageWithSource(lookup, query), null);
        assertPlan(
            pageWithSource(
                {
                    type: AirtableFieldType.FORMULA,
                    options: { isValid: true, result: lookup },
                },
                [query]
            ),
            null
        );
    });

    it('requires an own current source schema with matching field identity rather than names or retained cells', () => {
        const missing = pageWithSource(textConfig, query);
        delete missing.payload.fieldIdsToSchemas.fld_prefill;
        assertPlan(missing, null);
        const renamed = pageWithSource(textConfig, query);
        renamed.payload.fieldIdsToSchemas.fld_prefill.airtableField.name =
            'Another current title';
        assertPlan(renamed, query);
        const mismatched = pageWithSource(textConfig, query);
        mismatched.payload.fieldIdsToSchemas.fld_prefill.airtableField.id =
            'fld_other';
        assertPlan(mismatched, null);
        const oldName = pageWithSource(textConfig, query);
        delete oldName.payload.formRecord.data.fld_prefill;
        oldName.payload.formRecord.data['Renamed source field'] = query;
        assertPlan(oldName, null);
    });

    it('uses local parsing for all four date families and computed dates in an isolated non-UTC process', () => {
        // Literals follow canonical frontend moment(value), then field formatting.
        // The process isolates TZ and moment.tz.guess() from the test runner.
        const script = `
            import assert from 'node:assert/strict';
            import { getReadableStringFromAirtableValue as readable } from ${JSON.stringify(new URL('../src/formulas/index.js', import.meta.url).href)};
            import { createPortalCollection } from ${JSON.stringify(new URL('../src/portals/index.js', import.meta.url).href)};
            import { portalPage, portalFixture } from ${JSON.stringify(new URL('./portalFixtures.js', import.meta.url).href)};
            const date = { type: 'date', options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } } };
            const dateTime = { type: 'dateTime', options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' }, timeFormat: { name: '24hour', format: 'HH:mm' }, timeZone: 'client' } };
            const formula = (result) => ({ type: 'formula', options: { isValid: true, result } });
            const lookup = (result) => ({ type: 'multipleLookupValues', options: { isValid: true, recordLinkFieldId: 'fld_source_link', fieldIdInLinkedTable: 'fld_source_value', result } });
            const cases = [
                [date, '2040-06-15', '2040-06-14', '2040-06-15'],
                [dateTime, '2040-06-15T08:30:00', '2040-06-15 04:30', '2040-06-15 08:30'],
                [{ type: 'createdTime', options: { result: date } }, '2040-06-15', '2040-06-14', '2040-06-15'],
                [{ type: 'createdTime', options: { result: dateTime } }, '2040-06-15T08:30:00', '2040-06-15 04:30', '2040-06-15 08:30'],
                [{ type: 'lastModifiedTime', options: { isValid: true, result: date } }, '2040-06-15', '2040-06-14', '2040-06-15'],
                [{ type: 'lastModifiedTime', options: { isValid: true, result: dateTime } }, '2040-06-15T08:30:00', '2040-06-15 04:30', '2040-06-15 08:30'],
                [formula(date), '2040-06-15', '2040-06-14', '2040-06-15'],
                [formula(dateTime), '2040-06-15T08:30:00', '2040-06-15 04:30', '2040-06-15 08:30'],
                [formula(date), ['2040-06-15', null, '2040-06-16'], '2040-06-14, 2040-06-15', '2040-06-15, 2040-06-16'],
                [lookup(date), ['2040-06-15', null, '2040-06-16'], '2040-06-14, 2040-06-15', '2040-06-15, 2040-06-16'],
                [lookup(dateTime), ['2040-06-15T08:30:00'], '2040-06-15 04:30', '2040-06-15 08:30'],
                [lookup(formula(date)), ['2040-06-15', null, '2040-06-16'], '2040-06-14, 2040-06-15', '2040-06-15, 2040-06-16'],
                [dateTime, '2040-06-15T08:30:00Z', '2040-06-15 04:30', '2040-06-15 04:30'],
                [{ ...dateTime, options: { ...dateTime.options, timeZone: 'utc' } }, '2040-06-15T08:30:00', '2040-06-15 08:30', '2040-06-15 12:30'],
                [date, '2040-99-99', 'Invalid date', 'Invalid date'],
            ];
            for (const [config, value, utc, local] of cases) {
                for (const [dateParsing, expected] of [[undefined, utc], ['utc', utc], ['local', local]]) {
                    assert.equal(readable({ value, airtableFieldConfig: config, fieldName: 'Date source', source: { type: 'airtableMock', linkedTableStates: {}, ...(dateParsing ? { dateParsing } : {}) } }), expected, config.type + ':' + dateParsing);
                }
                const page = portalPage();
                page.payload.fieldIdsToSchemas.fld_prefill = { fieldType: config.type, airtableField: { id: 'fld_prefill', name: 'Date source', description: null, isComputed: !['date', 'dateTime'].includes(config.type), isPrimaryField: false, config } };
                page.payload.formRecord.data.fld_prefill = value;
                const fixture = portalFixture();
                const collection = createPortalCollection({ client: fixture.client, portal: page, portalFieldId: 'fld_children', criteria: { selectedCustomViewId: 'view_example', searchTerm: null, searchParamsMap: {}, sortFieldsByEndUser: null, filtersByEndUser: null }, getScope: () => ({ ownerId: 'visitor_A', revision: 1 }) });
                const plan = collection.childFormRequest({ access: { type: 'create' }, configuredChildExtensionId: 'extension_child' });
                assert.equal(plan.input.context.prefillDataForLinkedRecordsForm.prefillQueryForChildExtension, local);
                assert.equal(plan.saveContext.prefillData.prefillQueryForChildExtension, local);
                assert.deepEqual(plan.saveContext.prefillData.toLinkToParent, { reversedFieldIdToPrefill: 'fld_parent', parentFormRecordId: 'record_parent' });
                assert.equal(fixture.calls.length, 0);
                assert.equal(fixture.mutations, 0);
                collection.destroy();
            }
            console.log(JSON.stringify({ cases: cases.length, timezone: process.env.TZ }));
        `;
        const output = execFileSync(
            process.execPath,
            ['--input-type=module', '--eval', script],
            {
                env: { ...process.env, TZ: 'America/New_York' },
                encoding: 'utf8',
                timeout: 15_000,
            }
        );
        assert.deepEqual(JSON.parse(output), {
            cases: 15,
            timezone: 'America/New_York',
        });
    });
});
