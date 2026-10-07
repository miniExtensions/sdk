import assert from 'node:assert/strict';
import { after, before, describe, it, type TestContext } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Window } from 'happy-dom';
import {
    AirtableFieldType,
    type ConditionalFilterPrimaryValue,
    type FormLoadedResult,
    type ListConditionalFilterPrimaryValuesInput,
    type ListConditionalFilterPrimaryValuesResult,
    type ListFormLinkedRecordOptionsInput,
    type ListLinkedRecordOptionsResult,
    type LoadExtensionInput,
    type LoadSelectedRecordsInput,
    type LoadSelectedRecordsResult,
    type RuntimeAirtableField,
    type RuntimeFieldSchema,
    type SaveFormInput,
} from '../src/runtime/index.js';
import { loadedForm } from './formsFixtures.js';

type DOMElement = InstanceType<Window['Element']>;
type DOMSelect = InstanceType<Window['HTMLSelectElement']>;
const root = resolve(process.cwd());
let directory: string;
let revision = 0;

before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sdk-browser-linked-filters-'));
    await build({
        entryPoints: [join(root, 'examples/browser/src/main.ts')],
        alias: {
            '@miniextensions/sdk/auth': join(root, 'src/auth/index.ts'),
            '@miniextensions/sdk/ui': join(root, 'src/ui/index.ts'),
            '@miniextensions/sdk/forms': join(root, 'src/forms/index.ts'),
            '@miniextensions/sdk/portals': join(root, 'src/portals/index.ts'),
            '@miniextensions/sdk/formulas': join(root, 'src/formulas/index.ts'),
            '@miniextensions/sdk': join(root, 'src/runtime/index.ts'),
        },
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(directory, 'main.mjs'),
        logLevel: 'silent',
    });
});
after(async () => rm(directory, { recursive: true, force: true }));

const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise<void>((done) => setImmediate(done));
    }
    assert.fail(
        'Actual linked-filter starter did not reach the expected state.'
    );
};
const settle = () => new Promise<void>((done) => setImmediate(done));
const change = (window: Window, node: DOMElement) =>
    node.dispatchEvent(new window.Event('change', { bubbles: true }));
const input = (window: Window, node: DOMElement) =>
    node.dispatchEvent(new window.Event('input', { bubbles: true }));
const submit = (window: Window, node: DOMElement) =>
    node.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
const button = (node: DOMElement, title: string) => {
    const found = Array.from(node.querySelectorAll('button')).find(
        (candidate) => candidate.textContent?.trim() === title
    );
    assert.ok(found, `Missing actual starter button: ${title}`);
    return found;
};
const idle = (window: Window) =>
    window.document.getElementById('screen')?.getAttribute('aria-busy') ===
    'false';

const definitions = [
    { id: 'fld_country', name: 'Current country', title: 'Country' },
    { id: 'fld_region', name: 'Current region', title: 'Region' },
    { id: 'fld_city', name: 'Current city', title: 'City' },
] as const;
const values: Record<string, ConditionalFilterPrimaryValue[]> = {
    fld_country: [
        { recordId: 'rec_country_north', stringValue: 'North, East' },
        { recordId: 'rec_country_south', stringValue: 'South' },
    ],
    fld_region: [
        { recordId: 'rec_region_one', stringValue: 'Duplicate label' },
        { recordId: 'rec_region_two', stringValue: 'Duplicate label' },
    ],
    fld_city: [{ recordId: 'rec_city', stringValue: 'City = "One"' }],
};
const linkField = (id: string, name: string) =>
    ({
        id,
        name,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
            options: {
                linkedTableId: 'tbl_projects',
                inverseLinkFieldId: 'fld_parent',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
    }) satisfies Extract<
        RuntimeFieldSchema,
        { fieldType: 'multipleRecordLinks' }
    >['airtableField'];
const primaryField: RuntimeAirtableField = {
    id: 'fld_project_name',
    name: 'Project name',
    description: null,
    isComputed: false,
    isPrimaryField: true,
    config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
};
const metadata = (): LoadSelectedRecordsResult => ({
    tbl_projects: {
        airtableFields: [
            primaryField,
            ...definitions.map((field) => linkField(field.id, field.name)),
        ],
        recordIdsToAirtableRecords: {},
    },
});
type Flags = {
    disableAddingIfConditionalFilterIsEmpty?: boolean;
    disableRemovingIfConditionalFilterIsEmpty?: boolean;
};
const makeForm = ({
    baseline = ['rec_retained'],
    flags = {},
    readOnly = false,
    secondOuter = false,
    hidden = false,
}: {
    baseline?: string[];
    flags?: Flags;
    readOnly?: boolean;
    secondOuter?: boolean;
    hidden?: boolean;
} = {}): FormLoadedResult => {
    const form = loadedForm();
    const linked: RuntimeFieldSchema = {
        fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
        airtableField: linkField('fld_projects', 'Projects'),
        miniExtConfig: {
            readOnly,
            dynamicFilteringToggle: true,
            conditionalLinkedRecordFilteringFieldsType: hidden
                ? 'hide'
                : 'show-in-form',
            conditionalLinkedRecordFilterFields: definitions.map((field) => ({
                idOrName: { type: 'id' as const, id: field.id },
                config: {
                    type: AirtableFieldType.MULTIPLE_RECORD_LINKS as const,
                    config: { title: field.title, ...flags },
                },
            })),
        },
    };
    const title = form.payload.fieldIdsToSchemas.fld_title;
    assert.ok(title);
    form.payload.fieldIdsInForm = ['fld_title', 'fld_projects'];
    form.payload.fieldIdsToSchemas = { fld_title: title, fld_projects: linked };
    form.payload.fieldNamesToSchemas = { Title: title, Projects: linked };
    form.payload.formRecord = {
        type: 'create',
        data: { fld_title: 'Initial title', fld_projects: baseline },
    };
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    if (secondOuter) {
        const extra = structuredClone(linked);
        extra.airtableField.id = 'fld_other_projects';
        extra.airtableField.name = 'Other projects';
        form.payload.fieldIdsInForm.push('fld_other_projects');
        form.payload.fieldIdsToSchemas.fld_other_projects = extra;
        form.payload.fieldNamesToSchemas['Other projects'] = extra;
        form.payload.formRecord.data.fld_other_projects = [];
    }
    return form;
};
const options = (
    offset: string | null = 'cursor_next'
): ListLinkedRecordOptionsResult => ({
    records: [
        {
            id: 'rec_retained',
            fields: { fld_project_name: 'Retained project' },
        },
        {
            id: 'rec_available',
            fields: { fld_project_name: 'Available project' },
        },
    ],
    offset,
    tableIdsToLinkedTableStates: metadata(),
});
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
};

const fixture = (form = makeForm()) => {
    const loads: LoadExtensionInput[] = [];
    const bootstraps: LoadSelectedRecordsInput[] = [];
    const filters: ListConditionalFilterPrimaryValuesInput[] = [];
    const reads: ListFormLinkedRecordOptionsInput[] = [];
    const saves: SaveFormInput[] = [];
    const unexpected: string[] = [];
    const handlers = {
        metadata: async (): Promise<LoadSelectedRecordsResult> => metadata(),
        filter: async (
            request: ListConditionalFilterPrimaryValuesInput
        ): Promise<ListConditionalFilterPrimaryValuesResult> => ({
            primaryValues: structuredClone(
                values[request.linkedRecordsFilterFieldId] ?? []
            ),
            prefillValue: null,
        }),
        options: async (
            _request: ListFormLinkedRecordOptionsInput
        ): Promise<ListLinkedRecordOptionsResult> => options(),
    };
    const fetch: typeof globalThis.fetch = async (resource, init) => {
        const url = new URL(String(resource));
        assert.equal(url.origin, 'https://sdk.example.test');
        assert.equal(init?.credentials, 'omit');
        const route = url.searchParams.get('route');
        if (route === 'fetchExtensionForEndUser') {
            loads.push(JSON.parse(String(init?.body)));
            return new Response(JSON.stringify(form));
        }
        if (
            url.pathname ===
            '/api/trpc/publicExtensions.fetchInitialTableIdsToLinkedTableStates'
        ) {
            assert.equal(init?.method, 'GET');
            const payload: LoadSelectedRecordsInput = JSON.parse(
                url.searchParams.get('input') ?? 'null'
            );
            bootstraps.push(payload);
            assert.deepEqual(payload, {
                extensionAccessToken: form.payload.extensionAccessToken,
            });
            return new Response(
                JSON.stringify({ result: { data: await handlers.metadata() } })
            );
        }
        if (
            route === 'fetchPrimaryValuesForConditionalLinkedRecordFilterField'
        ) {
            assert.equal(init?.method, 'POST');
            const payload: ListConditionalFilterPrimaryValuesInput = JSON.parse(
                String(init?.body)
            );
            filters.push(payload);
            return new Response(JSON.stringify(await handlers.filter(payload)));
        }
        if (route === 'fetchRecordsForFormLinkedRecordsSelector') {
            const payload: ListFormLinkedRecordOptionsInput = JSON.parse(
                String(init?.body)
            );
            reads.push(payload);
            return new Response(
                JSON.stringify(await handlers.options(payload))
            );
        }
        if (route === 'saveForm') {
            saves.push(JSON.parse(String(init?.body)));
            return new Response(
                JSON.stringify({
                    type: 'error',
                    formValidationErrors: [],
                    formErrors: {},
                })
            );
        }
        unexpected.push(`${url.pathname}?route=${route}`);
        throw new Error('Unexpected linked-filter fixture request.');
    };
    return {
        loads,
        bootstraps,
        filters,
        reads,
        saves,
        unexpected,
        handlers,
        fetch,
    };
};

const environment = async (
    test: TestContext,
    fetch: typeof globalThis.fetch,
    query = ''
) => {
    const window = new Window({
        url: `https://app.example.test/${query}`,
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
        },
    });
    window.document.write(
        (
            await readFile(join(root, 'examples/browser/index.html'), 'utf8')
        ).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    );
    function Option(text = '', value = '') {
        const option = window.document.createElement('option');
        option.textContent = text;
        option.value = value;
        return option;
    }
    const globals = {
        document: window.document,
        location: window.location,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLSelectElement: window.HTMLSelectElement,
        HTMLButtonElement: window.HTMLButtonElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        Option,
        fetch,
    };
    const previous = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    Object.assign(globalThis, globals);
    test.after(async () => {
        for (const [key, descriptor] of previous) {
            if (descriptor === undefined)
                Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        }
        await window.happyDOM.close();
    });
    await import(
        `${pathToFileURL(join(directory, 'main.mjs')).href}?case=${++revision}`
    );
    const origin = window.document.getElementById('api-origin');
    const share = window.document.getElementById('share-id');
    assert.ok(origin instanceof window.HTMLInputElement);
    assert.ok(share instanceof window.HTMLInputElement);
    origin.value = 'https://sdk.example.test';
    share.value = 'share_example';
    const connection = window.document.getElementById('connection-form');
    assert.ok(connection);
    submit(window, connection);
    await waitFor(
        () =>
            window.document.querySelector('[data-field-id="fld_projects"]') !==
                null && idle(window)
    );
    return window;
};
const outer = (window: Window, id = 'fld_projects') => {
    const raw = window.document.querySelector(`[data-field-id="${id}"]`);
    assert.ok(raw instanceof window.HTMLTextAreaElement);
    const node = raw.closest('div');
    assert.ok(node);
    return node;
};
const rawIds = (window: Window, id = 'fld_projects') => {
    const raw = window.document.querySelector(`[data-field-id="${id}"]`);
    assert.ok(raw instanceof window.HTMLTextAreaElement);
    return JSON.parse(raw.value) as string[];
};
const filterSelect = (window: Window, id: string): DOMSelect => {
    const found = outer(window).querySelector(
        `select[data-filter-field-id="${id}"]`
    );
    assert.ok(found instanceof window.HTMLSelectElement);
    return found;
};
const choose = (window: Window, id: string, recordId: string) => {
    const select = filterSelect(window, id);
    select.value = recordId;
    change(window, select);
};
const loadFilters = async (window: Window) => {
    button(outer(window), 'Load conditional filters').click();
    await waitFor(
        () =>
            outer(window).querySelector(
                '[data-filter-field-id="fld_country"]'
            ) !== null && idle(window)
    );
};
const searchFilter = async (window: Window, title: string) => {
    button(outer(window), `Search ${title}`).click();
    await waitFor(() => idle(window));
};
const chooseAll = async (window: Window) => {
    await searchFilter(window, 'Country');
    choose(window, 'fld_country', 'rec_country_north');
    await searchFilter(window, 'Region');
    choose(window, 'fld_region', 'rec_region_two');
    await searchFilter(window, 'City');
    choose(window, 'fld_city', 'rec_city');
};
const expectedMap = {
    fld_country: values.fld_country[0],
    fld_region: values.fld_region[1],
    fld_city: values.fld_city[0],
};
const prefillMap = {
    fld_country: values.fld_country[0],
    fld_region: values.fld_region[0],
    fld_city: values.fld_city[0],
};
const confirmedPrefill = (
    request: ListConditionalFilterPrimaryValuesInput
): ListConditionalFilterPrimaryValuesResult => {
    const primaryValues = structuredClone(
        values[request.linkedRecordsFilterFieldId] ?? []
    );
    return {
        primaryValues,
        prefillValue:
            primaryValues.find(
                (value) => value.stringValue === request.urlSearchValue
            ) ?? null,
    };
};
const searchOptions = async (window: Window) => {
    button(outer(window), 'Search choices').click();
    await waitFor(() => idle(window));
};
const choiceCheckbox = (window: Window, title: string) => {
    const label = Array.from(outer(window).querySelectorAll('label')).find(
        (entry) => entry.textContent?.trim() === title
    );
    assert.ok(label, `Missing linked choice label: ${title}`);
    const checkbox = label.querySelector('input[type="checkbox"]');
    assert.ok(checkbox instanceof window.HTMLInputElement);
    return checkbox;
};
const save = async (window: Window, calls: SaveFormInput[], count = 1) => {
    const card = outer(window).closest('form');
    assert.ok(card);
    submit(window, card);
    await waitFor(() => calls.length === count && idle(window));
};

describe(
    'actual Form starter conditional linked-record filters',
    { concurrency: false },
    () => {
        it('uses ordered discovery, native duplicate-label IDs, an inner candidate map and nested save map', async (test) => {
            const api = fixture();
            const window = await environment(test, api.fetch);
            assert.equal(api.bootstraps.length, 0);
            await loadFilters(window);
            await chooseAll(window);
            const duplicateOptions = Array.from(
                filterSelect(window, 'fld_region').options
            ).filter((option) =>
                option.textContent?.startsWith('Duplicate label')
            );
            assert.deepEqual(
                duplicateOptions.map((option) => option.value).sort(),
                ['rec_region_one', 'rec_region_two']
            );
            assert.deepEqual(
                api.filters.map((call) => ({
                    id: call.linkedRecordsFilterFieldId,
                    previous: call.filterData,
                })),
                [
                    { id: 'fld_country', previous: null },
                    {
                        id: 'fld_region',
                        previous: {
                            previousFilterFieldId: 'fld_country',
                            previousFilterPrimaryValue: 'North, East',
                        },
                    },
                    {
                        id: 'fld_city',
                        previous: {
                            previousFilterFieldId: 'fld_region',
                            previousFilterPrimaryValue: 'Duplicate label',
                        },
                    },
                ]
            );
            await searchOptions(window);
            assert.equal(api.reads.length, 1);
            assert.deepEqual(
                api.reads[0].conditionalLinkedRecordFilteringValues,
                expectedMap
            );
            assert.equal(api.reads[0].linkedRecordFieldId, 'fld_projects');
            assert.equal(api.reads[0].offset, null);
            assert.equal(api.saves.length, 0);
            const available = choiceCheckbox(window, 'Available project');
            available.checked = true;
            change(window, available);
            await save(window, api.saves);
            assert.deepEqual(
                api.saves[0].conditionalLinkedRecordFieldIdsToFilteringValues,
                { fld_projects: expectedMap }
            );
            assert.deepEqual(api.saves[0].formRecord.data.fld_projects, [
                'rec_retained',
                'rec_available',
            ]);
            assert.equal(api.bootstraps.length, 1);
            assert.deepEqual(api.unexpected, []);
        });

        it('clears downstream filters, stale options and paging when an earlier selection changes without losing baseline IDs', async (test) => {
            const api = fixture();
            const window = await environment(test, api.fetch);
            await loadFilters(window);
            await chooseAll(window);
            await searchOptions(window);
            const captured = choiceCheckbox(window, 'Available project');
            button(outer(window), 'More choices').click();
            await waitFor(() => api.reads.length === 2 && idle(window));
            assert.equal(api.reads[1].offset, 'cursor_next');
            choose(window, 'fld_country', 'rec_country_south');
            assert.equal(filterSelect(window, 'fld_region').value, '');
            assert.equal(filterSelect(window, 'fld_city').value, '');
            assert.equal(
                outer(window).querySelectorAll('input[type="checkbox"]').length,
                0
            );
            assert.equal(button(outer(window), 'More choices').disabled, true);
            captured.checked = true;
            change(window, captured);
            assert.deepEqual(rawIds(window), ['rec_retained']);
            await searchOptions(window);
            assert.equal(api.reads[2].offset, null);
            assert.deepEqual(
                api.reads[2].conditionalLinkedRecordFilteringValues,
                {
                    fld_country: values.fld_country[1],
                    fld_region: null,
                    fld_city: null,
                }
            );
            await save(window, api.saves);
            assert.deepEqual(api.saves[0].formRecord.data.fld_projects, [
                'rec_retained',
            ]);
            assert.deepEqual(api.unexpected, []);
        });

        it('rejects fabricated filter options and uses only the server-confirmed URL prefill under current schema names', async (test) => {
            const api = fixture();
            api.handlers.filter = async (request) => confirmedPrefill(request);
            const query =
                '?prefill_Current%20country=North%2C%20East&prefill_Country=Old%20name&prefill_Current%20region=unmatched&unrelated=ignored';
            const window = await environment(test, api.fetch, query);
            await loadFilters(window);
            assert.equal(
                filterSelect(window, 'fld_country').value,
                'rec_country_north'
            );
            assert.equal(filterSelect(window, 'fld_region').value, '');
            assert.deepEqual(
                api.filters.map((call) => ({
                    id: call.linkedRecordsFilterFieldId,
                    url: call.urlSearchValue,
                })),
                [
                    { id: 'fld_country', url: 'North, East' },
                    { id: 'fld_region', url: 'unmatched' },
                ]
            );
            const select = filterSelect(window, 'fld_region');
            const fabricated = window.document.createElement('option');
            fabricated.value = 'rec_fabricated';
            fabricated.textContent = 'Duplicate label';
            select.append(fabricated);
            select.value = fabricated.value;
            change(window, select);
            assert.equal(select.value, '');
            await searchOptions(window);
            assert.deepEqual(
                api.reads[0].conditionalLinkedRecordFilteringValues,
                {
                    fld_country: values.fld_country[0],
                    fld_region: null,
                    fld_city: null,
                }
            );
            assert.equal(api.saves.length, 0);
            assert.deepEqual(api.unexpected, []);
        });

        it('resolves three URL prefills sequentially on explicit Load and preserves decoded query bytes for load and save', async (test) => {
            const api = fixture();
            api.handlers.filter = async (request) => confirmedPrefill(request);
            const query =
                '?prefill_Current%20country=North%2C%20East&prefill_Current%20region=Duplicate%20label&prefill_Current%20city=City%20%3D%20%22One%22&prefill_Unconfigured=%20Raw%2Bvalue%20&prefill_Repeated=%20First%20&prefill_Repeated=Second%2B&tracking=ignored';
            const window = await environment(test, api.fetch, query);
            const expectedQuery = {
                'prefill_Current country': 'North, East',
                'prefill_Current region': 'Duplicate label',
                'prefill_Current city': 'City = "One"',
                prefill_Unconfigured: ' Raw+value ',
                prefill_Repeated: [' First ', 'Second+'],
            };
            assert.deepEqual(api.loads[0].query, expectedQuery);
            assert.equal(api.filters.length, 0);
            assert.equal(api.bootstraps.length, 0);
            await loadFilters(window);
            assert.deepEqual(
                api.filters.map((call) => ({
                    id: call.linkedRecordsFilterFieldId,
                    search: call.searchTerm,
                    url: call.urlSearchValue,
                    previous: call.filterData,
                })),
                [
                    {
                        id: 'fld_country',
                        search: 'North, East',
                        url: 'North, East',
                        previous: null,
                    },
                    {
                        id: 'fld_region',
                        search: 'Duplicate label',
                        url: 'Duplicate label',
                        previous: {
                            previousFilterFieldId: 'fld_country',
                            previousFilterPrimaryValue: 'North, East',
                        },
                    },
                    {
                        id: 'fld_city',
                        search: 'City = "One"',
                        url: 'City = "One"',
                        previous: {
                            previousFilterFieldId: 'fld_region',
                            previousFilterPrimaryValue: 'Duplicate label',
                        },
                    },
                ]
            );
            assert.equal(
                filterSelect(window, 'fld_country').value,
                'rec_country_north'
            );
            assert.equal(
                filterSelect(window, 'fld_region').value,
                'rec_region_one'
            );
            assert.equal(filterSelect(window, 'fld_city').value, 'rec_city');
            assert.equal(api.saves.length, 0);
            await save(window, api.saves);
            assert.deepEqual(api.saves[0].searchQuery, expectedQuery);
            assert.deepEqual(
                api.saves[0].conditionalLinkedRecordFieldIdsToFilteringValues,
                { fld_projects: prefillMap }
            );
            assert.deepEqual(api.unexpected, []);
        });

        it('preserves repeated URL keys as arrays and refuses to guess a filter selection from them', async (test) => {
            const api = fixture();
            const window = await environment(
                test,
                api.fetch,
                '?prefill_Current%20country=First&prefill_Current%20country=Second&unrelated=ignored'
            );
            const expectedQuery = {
                'prefill_Current country': ['First', 'Second'],
            };
            assert.deepEqual(api.loads[0].query, expectedQuery);
            await loadFilters(window);
            assert.equal(filterSelect(window, 'fld_country').value, '');
            assert.match(
                window.document.getElementById('status')?.textContent ?? '',
                /Repeated.*unsupported/i
            );
            assert.equal(api.filters.length, 0);
            await searchOptions(window);
            assert.deepEqual(
                api.reads[0].conditionalLinkedRecordFilteringValues,
                { fld_country: null, fld_region: null, fld_city: null }
            );
            await save(window, api.saves);
            assert.deepEqual(api.saves[0].searchQuery, expectedQuery);
            assert.deepEqual(api.unexpected, []);
        });

        it('explicit Load resumes hidden prefills after failure without metadata refetch or native draft loss', async (test) => {
            const api = fixture(makeForm({ hidden: true }));
            let failed = false;
            api.handlers.filter = async (request) => {
                if (
                    request.linkedRecordsFilterFieldId === 'fld_region' &&
                    !failed
                ) {
                    failed = true;
                    throw new Error('interrupted region');
                }
                return confirmedPrefill(request);
            };
            const query =
                '?prefill_Current%20country=North%2C%20East&prefill_Current%20region=Duplicate%20label&prefill_Current%20city=City%20%3D%20%22One%22';
            const window = await environment(test, api.fetch, query);
            await loadFilters(window);
            assert.equal(api.filters.length, 2);
            assert.equal(api.saves.length, 0);
            assert.match(
                window.document.getElementById('status')?.textContent ?? '',
                /Use Load conditional filters to retry unresolved prefills/
            );
            await new Promise((resolve) => setTimeout(resolve, 10));
            assert.equal(api.filters.length, 2);
            const metadataReads = api.bootstraps.length;
            await loadFilters(window);
            assert.equal(api.bootstraps.length, metadataReads);
            assert.deepEqual(
                api.filters.map((call) => call.linkedRecordsFilterFieldId),
                ['fld_country', 'fld_region', 'fld_region', 'fld_city']
            );
            const fields = filterSelect(window, 'fld_country').closest('div');
            assert.ok(fields instanceof window.HTMLElement);
            assert.equal(fields.hidden, true);
            assert.deepEqual(rawIds(window), ['rec_retained']);
            await save(window, api.saves);
            assert.deepEqual(api.saves[0].formRecord.data.fld_projects, [
                'rec_retained',
            ]);
        });

        it('renders Search retry guidance for failed and invalid ordinary reads without automatically retrying', async (test) => {
            const api = fixture(makeForm());
            const window = await environment(test, api.fetch);
            await loadFilters(window);
            api.handlers.filter = async () => {
                throw new Error('ordinary failed');
            };
            await searchFilter(window, 'Country');
            assert.match(
                window.document.getElementById('status')?.textContent ?? '',
                /Use Search Country to retry this filter read/
            );
            assert.equal(api.filters.length, 1);
            api.handlers.filter = async () => ({
                primaryValues: [],
                prefillValue: { recordId: 'missing', stringValue: 'invalid' },
            });
            await searchFilter(window, 'Country');
            assert.match(
                window.document.getElementById('status')?.textContent ?? '',
                /unresolved prefill.*Use Search Country to retry this filter read/
            );
            await new Promise((resolve) => setTimeout(resolve, 10));
            assert.equal(api.filters.length, 2);
            assert.equal(api.saves.length, 0);
            assert.deepEqual(rawIds(window), ['rec_retained']);
        });

        it('keeps hidden-mode selectors hidden throughout server-prefill resolution and explicit Load visible', async (test) => {
            const api = fixture(makeForm({ hidden: true }));
            const last = deferred<ListConditionalFilterPrimaryValuesResult>();
            api.handlers.filter = async (request) =>
                request.linkedRecordsFilterFieldId === 'fld_city'
                    ? last.promise
                    : confirmedPrefill(request);
            const query =
                '?prefill_Current%20country=North%2C%20East&prefill_Current%20region=Duplicate%20label&prefill_Current%20city=City%20%3D%20%22One%22';
            const window = await environment(test, api.fetch, query);
            const load = button(outer(window), 'Load conditional filters');
            assert.equal(api.filters.length, 0);
            assert.equal(api.bootstraps.length, 0);
            assert.equal(load.closest('[hidden]'), null);
            load.click();
            await waitFor(() => api.filters.length === 3);
            const fields = filterSelect(window, 'fld_country').closest('div');
            assert.ok(fields instanceof window.HTMLElement);
            assert.equal(
                fields.hidden,
                true,
                'Selectors stay hidden while the last sequential prefill is unresolved'
            );
            assert.equal(
                filterSelect(window, 'fld_country').value,
                'rec_country_north'
            );
            assert.equal(
                filterSelect(window, 'fld_region').value,
                'rec_region_one'
            );
            assert.equal(filterSelect(window, 'fld_city').value, '');
            assert.deepEqual(
                api.filters.map((call) => call.filterData),
                [
                    null,
                    {
                        previousFilterFieldId: 'fld_country',
                        previousFilterPrimaryValue: 'North, East',
                    },
                    {
                        previousFilterFieldId: 'fld_region',
                        previousFilterPrimaryValue: 'Duplicate label',
                    },
                ]
            );
            last.resolve({
                primaryValues: values.fld_city,
                prefillValue: values.fld_city[0],
            });
            await waitFor(() => idle(window));
            assert.equal(fields.hidden, true);
            assert.equal(filterSelect(window, 'fld_city').value, 'rec_city');
            assert.equal(load.isConnected, true);
            assert.equal(load.hidden, false);
            assert.equal(load.closest('[hidden]'), null);
            assert.equal(api.saves.length, 0);
            await searchOptions(window);
            assert.deepEqual(
                api.reads[0].conditionalLinkedRecordFilteringValues,
                prefillMap
            );
            await save(window, api.saves);
            assert.deepEqual(
                api.saves[0].conditionalLinkedRecordFieldIdsToFilteringValues,
                { fld_projects: prefillMap }
            );
            assert.deepEqual(api.unexpected, []);
        });

        for (const scenario of [
            { add: true, remove: false },
            { add: false, remove: true },
            { add: true, remove: true },
        ]) {
            it(`enforces empty filter add=${scenario.add} / remove=${scenario.remove} independently before dispatch`, async (test) => {
                const api = fixture(
                    makeForm({
                        flags: {
                            disableAddingIfConditionalFilterIsEmpty:
                                scenario.add,
                            disableRemovingIfConditionalFilterIsEmpty:
                                scenario.remove,
                        },
                    })
                );
                const window = await environment(test, api.fetch);
                await loadFilters(window);
                await searchOptions(window);
                const add = choiceCheckbox(window, 'Available project');
                const remove = choiceCheckbox(window, 'Retained project');
                add.checked = true;
                change(window, add);
                remove.checked = false;
                change(window, remove);
                const expected = [
                    ...(scenario.remove ? ['rec_retained'] : []),
                    ...(scenario.add ? [] : ['rec_available']),
                ];
                assert.deepEqual(rawIds(window), expected);
                assert.equal(api.saves.length, 0);
                assert.equal(api.filters.length, 0);
                await save(window, api.saves);
                assert.deepEqual(
                    api.saves[0].formRecord.data.fld_projects,
                    expected
                );
                assert.deepEqual(api.unexpected, []);
            });
        }

        it('treats an accepted empty primary string as empty even when its record ID is present', async (test) => {
            const api = fixture(
                makeForm({
                    flags: {
                        disableAddingIfConditionalFilterIsEmpty: true,
                        disableRemovingIfConditionalFilterIsEmpty: true,
                    },
                })
            );
            api.handlers.filter = async (request) => ({
                primaryValues:
                    request.linkedRecordsFilterFieldId === 'fld_country'
                        ? [{ recordId: 'rec_country_north', stringValue: '' }]
                        : structuredClone(
                              values[request.linkedRecordsFilterFieldId]
                          ),
                prefillValue: null,
            });
            const window = await environment(test, api.fetch);
            await loadFilters(window);
            await chooseAll(window);
            await searchOptions(window);
            const add = choiceCheckbox(window, 'Available project');
            const remove = choiceCheckbox(window, 'Retained project');
            add.checked = true;
            change(window, add);
            remove.checked = false;
            change(window, remove);
            assert.deepEqual(rawIds(window), ['rec_retained']);
            assert.equal(api.saves.length, 0);
            assert.deepEqual(
                api.reads[0].conditionalLinkedRecordFilteringValues.fld_country,
                { recordId: 'rec_country_north', stringValue: '' }
            );
            await save(window, api.saves);
            assert.deepEqual(api.saves[0].formRecord.data.fld_projects, [
                'rec_retained',
            ]);
            assert.deepEqual(api.unexpected, []);
        });

        it('shares one token-only metadata bootstrap across empty outer fields and allows an explicit retry after failure', async (test) => {
            const api = fixture(makeForm({ baseline: [], secondOuter: true }));
            let failures = 1;
            api.handlers.metadata = async () => {
                if (failures-- > 0)
                    throw new Error('Synthetic metadata failure');
                return metadata();
            };
            const window = await environment(test, api.fetch);
            button(outer(window), 'Load conditional filters').click();
            await waitFor(() => api.bootstraps.length === 1 && idle(window));
            assert.equal(
                outer(window).querySelector('select[data-filter-field-id]'),
                null
            );
            await loadFilters(window);
            button(
                outer(window, 'fld_other_projects'),
                'Load conditional filters'
            ).click();
            await waitFor(
                () =>
                    outer(window, 'fld_other_projects').querySelector(
                        'select[data-filter-field-id]'
                    ) !== null && idle(window)
            );
            assert.equal(
                api.bootstraps.length,
                2,
                'One failed attempt, then one successful shared bootstrap'
            );
            assert.deepEqual(rawIds(window), []);
            assert.deepEqual(rawIds(window, 'fld_other_projects'), []);
            assert.equal(api.saves.length, 0);
            assert.deepEqual(api.unexpected, []);
        });

        for (const invalid of [
            'missing table',
            'missing configured field',
            'empty current field name',
        ] as const) {
            it(`makes ${invalid} explicitly unavailable while preserving unrestricted linked choices and unrelated edits`, async (test) => {
                const api = fixture();
                api.handlers.metadata = async () => {
                    const result = metadata();
                    if (invalid === 'missing table') delete result.tbl_projects;
                    else if (invalid === 'missing configured field')
                        result.tbl_projects.airtableFields =
                            result.tbl_projects.airtableFields.filter(
                                (field) => field.id !== 'fld_country'
                            );
                    else {
                        const field = result.tbl_projects.airtableFields.find(
                            (entry) => entry.id === 'fld_country'
                        );
                        assert.ok(field);
                        field.name = '';
                    }
                    return result;
                };
                const window = await environment(test, api.fetch);
                button(outer(window), 'Load conditional filters').click();
                await waitFor(
                    () => api.bootstraps.length === 1 && idle(window)
                );
                assert.match(
                    window.document.getElementById('status')?.textContent ?? '',
                    /unavailable/i
                );
                assert.equal(
                    outer(window).querySelector('select[data-filter-field-id]'),
                    null
                );
                const search = button(outer(window), 'Search choices');
                search.disabled = false;
                search.click();
                await waitFor(() => api.reads.length === 1 && idle(window));
                assert.deepEqual(
                    api.reads[0].conditionalLinkedRecordFilteringValues,
                    {}
                );
                const available = choiceCheckbox(window, 'Available project');
                available.checked = true;
                change(window, available);
                assert.deepEqual(rawIds(window), [
                    'rec_retained',
                    'rec_available',
                ]);
                const title = window.document.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                assert.ok(title instanceof window.HTMLInputElement);
                title.value = 'Unrelated edit';
                input(window, title);
                await save(window, api.saves);
                assert.deepEqual(api.saves[0].formRecord.data.fld_projects, [
                    'rec_retained',
                    'rec_available',
                ]);
                assert.equal(
                    api.saves[0].formRecord.data.fld_title,
                    'Unrelated edit'
                );
                assert.deepEqual(
                    api.saves[0]
                        .conditionalLinkedRecordFieldIdsToFilteringValues,
                    { fld_projects: {} }
                );
                assert.deepEqual(api.unexpected, []);
            });
        }

        it('keeps unavailable drivers empty for independent add/remove restrictions without blocking unrelated save', async (test) => {
            const api = fixture(
                makeForm({
                    flags: {
                        disableAddingIfConditionalFilterIsEmpty: true,
                        disableRemovingIfConditionalFilterIsEmpty: true,
                    },
                })
            );
            api.handlers.metadata = async () => ({});
            const window = await environment(test, api.fetch);
            button(outer(window), 'Load conditional filters').click();
            await waitFor(() => api.bootstraps.length === 1 && idle(window));
            assert.match(
                window.document.getElementById('status')?.textContent ?? '',
                /unavailable/i
            );
            await searchOptions(window);
            assert.deepEqual(
                api.reads[0].conditionalLinkedRecordFilteringValues,
                {}
            );
            const add = choiceCheckbox(window, 'Available project');
            const remove = choiceCheckbox(window, 'Retained project');
            add.checked = true;
            change(window, add);
            remove.checked = false;
            change(window, remove);
            assert.deepEqual(rawIds(window), ['rec_retained']);
            assert.equal(api.saves.length, 0);
            const title = window.document.querySelector(
                'input[data-field-id="fld_title"]'
            );
            assert.ok(title instanceof window.HTMLInputElement);
            title.value = 'Unrelated restricted edit';
            input(window, title);
            await save(window, api.saves);
            assert.deepEqual(api.saves[0].formRecord.data.fld_projects, [
                'rec_retained',
            ]);
            assert.equal(
                api.saves[0].formRecord.data.fld_title,
                'Unrelated restricted edit'
            );
            assert.deepEqual(
                api.saves[0].conditionalLinkedRecordFieldIdsToFilteringValues,
                { fld_projects: {} }
            );
            assert.deepEqual(api.unexpected, []);
        });

        for (const unsupported of [
            'duplicate configured ID',
            'duplicate metadata ID',
            'name reference',
        ] as const) {
            for (const restricted of [false, true]) {
                it(`preserves original add/remove flags=${restricted} when presentation has ${unsupported}`, async (test) => {
                    const form = makeForm({
                        flags: {
                            disableAddingIfConditionalFilterIsEmpty: restricted,
                            disableRemovingIfConditionalFilterIsEmpty:
                                restricted,
                        },
                    });
                    const schema = form.payload.fieldIdsToSchemas.fld_projects;
                    assert.ok(
                        schema?.fieldType ===
                            AirtableFieldType.MULTIPLE_RECORD_LINKS
                    );
                    const config = schema.miniExtConfig;
                    assert.ok(
                        config != null &&
                            'conditionalLinkedRecordFilterFields' in config
                    );
                    const configured =
                        config.conditionalLinkedRecordFilterFields;
                    assert.ok(configured);
                    if (unsupported === 'duplicate configured ID')
                        configured.push(structuredClone(configured[0]));
                    else if (unsupported === 'name reference')
                        configured[0].idOrName = {
                            type: 'name',
                            name: 'Current country',
                        };
                    const api = fixture(form);
                    if (unsupported === 'duplicate metadata ID')
                        api.handlers.metadata = async () => {
                            const result = metadata();
                            result.tbl_projects.airtableFields.push(
                                structuredClone(
                                    result.tbl_projects.airtableFields[1]
                                )
                            );
                            return result;
                        };
                    const window = await environment(test, api.fetch);
                    button(outer(window), 'Load conditional filters').click();
                    await waitFor(
                        () =>
                            idle(window) &&
                            /unavailable/i.test(
                                window.document.getElementById('status')
                                    ?.textContent ?? ''
                            )
                    );
                    assert.equal(
                        outer(window).querySelector(
                            'select[data-filter-field-id]'
                        ),
                        null
                    );
                    assert.equal(
                        api.bootstraps.length,
                        unsupported === 'duplicate metadata ID' ? 1 : 0
                    );
                    assert.equal(api.filters.length, 0);
                    await searchOptions(window);
                    assert.deepEqual(
                        api.reads[0].conditionalLinkedRecordFilteringValues,
                        {}
                    );
                    const add = choiceCheckbox(window, 'Available project');
                    const remove = choiceCheckbox(window, 'Retained project');
                    add.checked = true;
                    change(window, add);
                    remove.checked = false;
                    change(window, remove);
                    const expected = restricted
                        ? ['rec_retained']
                        : ['rec_available'];
                    assert.deepEqual(rawIds(window), expected);
                    assert.equal(api.saves.length, 0);
                    await save(window, api.saves);
                    assert.deepEqual(
                        api.saves[0].formRecord.data.fld_projects,
                        expected
                    );
                    assert.deepEqual(
                        api.saves[0]
                            .conditionalLinkedRecordFieldIdsToFilteringValues,
                        { fld_projects: {} }
                    );
                    assert.deepEqual(api.unexpected, []);
                });
            }
        }

        it('renders read-only links without active filter, candidate or mutation controls', async (test) => {
            const api = fixture(makeForm({ readOnly: true }));
            const window = await environment(test, api.fetch);
            assert.equal(
                outer(window).querySelector('select[data-filter-field-id]'),
                null
            );
            assert.equal(outer(window).querySelector('button'), null);
            await save(window, api.saves);
            assert.deepEqual(api.saves[0].formRecord.data.fld_projects, [
                'rec_retained',
            ]);
            assert.equal(api.bootstraps.length, 0);
            assert.equal(api.reads.length, 0);
            assert.deepEqual(api.unexpected, []);
        });

        it('rejects delayed filter discovery after search changes and after an A→B→A render cycle', async (test) => {
            const api = fixture();
            const pending =
                deferred<ListConditionalFilterPrimaryValuesResult>();
            api.handlers.filter = () => pending.promise;
            const window = await environment(test, api.fetch);
            await loadFilters(window);
            button(outer(window), 'Search Country').click();
            await waitFor(() => api.filters.length === 1);
            const oldSelect = filterSelect(window, 'fld_country');
            const search = outer(window).querySelector(
                'input[data-filter-search-field-id="fld_country"]'
            );
            assert.ok(search instanceof window.HTMLInputElement);
            search.value = 'New request';
            input(window, search);
            const visitor = window.document.getElementById('visitor');
            assert.ok(visitor instanceof window.HTMLSelectElement);
            visitor.value = 'B';
            change(window, visitor);
            visitor.value = 'A';
            change(window, visitor);
            pending.resolve({
                primaryValues: values.fld_country,
                prefillValue: values.fld_country[0],
            });
            await settle();
            await settle();
            assert.equal(oldSelect.isConnected, false);
            assert.equal(
                outer(window).querySelector('select[data-filter-field-id]'),
                null
            );
            oldSelect.value = 'rec_country_north';
            change(window, oldSelect);
            assert.deepEqual(rawIds(window), ['rec_retained']);
            assert.equal(api.saves.length, 0);
            assert.deepEqual(api.unexpected, []);
        });

        it('rejects delayed discovery after its search changes without requiring an owner switch', async (test) => {
            const api = fixture();
            const pending =
                deferred<ListConditionalFilterPrimaryValuesResult>();
            api.handlers.filter = () => pending.promise;
            const window = await environment(test, api.fetch);
            await loadFilters(window);
            button(outer(window), 'Search Country').click();
            await waitFor(() => api.filters.length === 1);
            const search = outer(window).querySelector(
                'input[data-filter-search-field-id="fld_country"]'
            );
            assert.ok(search instanceof window.HTMLInputElement);
            search.value = 'Later search';
            input(window, search);
            pending.resolve({
                primaryValues: values.fld_country,
                prefillValue: null,
            });
            await waitFor(() => idle(window));
            assert.deepEqual(
                Array.from(filterSelect(window, 'fld_country').options).map(
                    (option) => option.value
                ),
                ['']
            );
            assert.deepEqual(rawIds(window), ['rec_retained']);
            assert.equal(api.saves.length, 0);
            assert.deepEqual(api.unexpected, []);
        });

        it('rejects delayed metadata after A→B→A and performs a fresh bootstrap for the new render', async (test) => {
            const api = fixture(makeForm({ baseline: [] }));
            const pending = deferred<LoadSelectedRecordsResult>();
            api.handlers.metadata = () => pending.promise;
            const window = await environment(test, api.fetch);
            button(outer(window), 'Load conditional filters').click();
            await waitFor(() => api.bootstraps.length === 1);
            const visitor = window.document.getElementById('visitor');
            assert.ok(visitor instanceof window.HTMLSelectElement);
            visitor.value = 'B';
            change(window, visitor);
            visitor.value = 'A';
            change(window, visitor);
            pending.resolve(metadata());
            await settle();
            await settle();
            assert.equal(
                outer(window).querySelector('select[data-filter-field-id]'),
                null
            );
            api.handlers.metadata = async () => metadata();
            await loadFilters(window);
            assert.equal(api.bootstraps.length, 2);
            assert.deepEqual(rawIds(window), []);
            assert.equal(api.saves.length, 0);
            assert.deepEqual(api.unexpected, []);
        });

        it('rejects delayed linked candidates after a parent change, and detached choices after disposal', async (test) => {
            const api = fixture();
            const pending = deferred<ListLinkedRecordOptionsResult>();
            api.handlers.options = () => pending.promise;
            const window = await environment(test, api.fetch);
            await loadFilters(window);
            await chooseAll(window);
            button(outer(window), 'Search choices').click();
            await waitFor(() => api.reads.length === 1);
            choose(window, 'fld_country', 'rec_country_south');
            pending.resolve(options());
            await waitFor(() => idle(window));
            assert.equal(
                outer(window).querySelectorAll('input[type="checkbox"]').length,
                0
            );
            assert.equal(button(outer(window), 'More choices').disabled, true);
            api.handlers.options = async () => options(null);
            await searchOptions(window);
            const captured = choiceCheckbox(window, 'Available project');
            const disconnect = window.document.getElementById('disconnect');
            assert.ok(disconnect instanceof window.HTMLButtonElement);
            disconnect.click();
            captured.checked = true;
            change(window, captured);
            await settle();
            assert.equal(captured.isConnected, false);
            assert.equal(api.saves.length, 0);
            assert.equal(api.reads.length, 2);
            assert.deepEqual(api.unexpected, []);
        });

        it('rejects delayed linked candidates after the candidate search changes without a filter or owner change', async (test) => {
            const api = fixture();
            const pending = deferred<ListLinkedRecordOptionsResult>();
            api.handlers.options = () => pending.promise;
            const window = await environment(test, api.fetch);
            await loadFilters(window);
            button(outer(window), 'Search choices').click();
            await waitFor(() => api.reads.length === 1);
            const search = outer(window).querySelector(
                'input[placeholder="Search available linked records"]'
            );
            assert.ok(search instanceof window.HTMLInputElement);
            search.value = 'Later candidate search';
            input(window, search);
            pending.resolve(options());
            await waitFor(() => idle(window));
            assert.equal(
                outer(window).querySelectorAll('input[type="checkbox"]').length,
                0
            );
            assert.equal(button(outer(window), 'More choices').disabled, true);
            assert.deepEqual(rawIds(window), ['rec_retained']);
            assert.equal(api.saves.length, 0);
            assert.deepEqual(api.unexpected, []);
        });
    }
);
