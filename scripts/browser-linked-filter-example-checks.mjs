import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const waitFor = async (predicate) => {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise((done) => setImmediate(done));
    }
    assert.fail(
        'Packed linked-filter starter did not reach the expected state.'
    );
};
const settle = () => new Promise((done) => setImmediate(done));
const change = (window, node) =>
    node.dispatchEvent(new window.Event('change', { bubbles: true }));
const input = (window, node) =>
    node.dispatchEvent(new window.Event('input', { bubbles: true }));
const submit = (window, node) =>
    node.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
const button = (node, title) => {
    const found = [...node.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === title
    );
    assert(found, `Missing packed starter button: ${title}`);
    return found;
};
const idle = (window) =>
    window.document.getElementById('screen').getAttribute('aria-busy') ===
    'false';
const definitions = [
    { id: 'fld_country', name: 'Current country', title: 'Country' },
    { id: 'fld_region', name: 'Current region', title: 'Region' },
    { id: 'fld_city', name: 'Current city', title: 'City' },
];
const values = {
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
const prefillMap = {
    fld_country: values.fld_country[0],
    fld_region: values.fld_region[0],
    fld_city: values.fld_city[0],
};
const linkField = (id, name) => ({
    id,
    name,
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: 'multipleRecordLinks',
        options: {
            linkedTableId: 'tbl_projects',
            inverseLinkFieldId: 'fld_parent',
            isReversed: false,
            prefersSingleRecordLink: false,
        },
    },
});
const metadata = () => ({
    tbl_projects: {
        airtableFields: [
            {
                id: 'fld_project_name',
                name: 'Project name',
                description: null,
                isComputed: false,
                isPrimaryField: true,
                config: { type: 'singleLineText', options: null },
            },
            ...definitions.map((field) => linkField(field.id, field.name)),
        ],
        recordIdsToAirtableRecords: {},
    },
});
const linkedOptions = (offset = 'cursor_next') => ({
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
const primaryDetail = () => ({
    fieldId: 'fld_project_name',
    fieldName: 'Project name',
    titleOverride: null,
    isHidden: false,
    fieldIsInEditingChildForm: false,
    childFormField: null,
    miniExtConfig: {},
});
const captionScenarios = [
    { name: 'visible primary captions', lifecycle: true },
    {
        name: 'empty More retires existing captions across visible/hidden/visible display policy',
        emptyMorePolicyChange: true,
    },
    {
        name: 'hidden primary captions',
        detail: { isHidden: true },
        caption: 'Linked record',
    },
    {
        name: 'missing primary display authority',
        missing: true,
        caption: 'Linked record',
    },
    {
        name: 'missing returned table metadata',
        missingTableMap: true,
        caption: 'Linked record',
    },
    {
        name: 'ambiguous primary display authority',
        duplicate: true,
        caption: 'Linked record',
    },
    {
        name: 'malformed primary display authority',
        detail: { isHidden: 'false' },
        caption: 'Linked record',
    },
    ...['obscurePassword', 'maskPasswordOnLoginScreen'].map((flag) => ({
        name: `${flag} primary captions`,
        detail: { miniExtConfig: { [flag]: true } },
        caption: '••••••••',
    })),
    {
        name: 'malformed primary masking',
        detail: { miniExtConfig: { obscurePassword: 'false' } },
        caption: 'Linked record',
    },
    {
        name: 'own blank ID takes precedence over name',
        value: '',
        nameValue: 'Must not leak the name fallback',
        caption: 'Linked record',
    },
    { name: 'own unambiguous name fallback', nameOnly: true },
    { name: 'zero primary caption', value: 0, type: 'number', caption: '0' },
    {
        name: 'false primary caption',
        value: false,
        type: 'checkbox',
        caption: 'false',
    },
];
const makeForm = (scenario) => {
    const form = portalRecipeFixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    const title = form.payload.fieldIdsToSchemas.fld_title;
    const projects = {
        fieldType: 'multipleRecordLinks',
        airtableField: linkField('fld_projects', 'Projects'),
        miniExtConfig: {
            dynamicFilteringToggle: scenario.captionPolicy == null,
            conditionalLinkedRecordFilteringFieldsType: scenario.ordered
                ? 'hide'
                : 'show-in-form',
            conditionalLinkedRecordFilterFields: definitions.map((field) => ({
                idOrName: { type: 'id', id: field.id },
                config: {
                    type: 'multipleRecordLinks',
                    config: {
                        title: field.title,
                        disableAddingIfConditionalFilterIsEmpty:
                            scenario.add === true,
                        disableRemovingIfConditionalFilterIsEmpty:
                            scenario.remove === true,
                    },
                },
            })),
        },
    };
    form.payload.hasParentExtension = false;
    form.payload.fieldIdsInForm = ['fld_title', 'fld_projects'];
    form.payload.fieldIdsToSchemas = {
        fld_title: title,
        fld_projects: projects,
    };
    form.payload.fieldNamesToSchemas = { Title: title, Projects: projects };
    form.payload.formRecord = {
        type: 'create',
        data: { fld_title: 'Initial title', fld_projects: ['rec_retained'] },
    };
    form.payload.linkedRecordFieldIdToDetailFields = {
        fld_projects: [primaryDetail()],
    };
    const captionPolicy = scenario.captionPolicy;
    if (captionPolicy != null) {
        const details =
            form.payload.linkedRecordFieldIdToDetailFields.fld_projects;
        Object.assign(details[0], captionPolicy.detail);
        if (captionPolicy.missing)
            delete form.payload.linkedRecordFieldIdToDetailFields.fld_projects;
        if (captionPolicy.duplicate) details.push(structuredClone(details[0]));
    }
    form.payload.formFieldIdsWithUnsavedChanges = [];
    form.payload.urlPrefilledFieldIds = [];
    return form;
};
const outer = (window) => {
    const raw = window.document.querySelector(
        'textarea[data-field-id="fld_projects"]'
    );
    assert(raw);
    return raw.closest('div');
};
const rawIds = (window) =>
    JSON.parse(
        window.document.querySelector('textarea[data-field-id="fld_projects"]')
            .value
    );
const select = (window, id) => {
    const found = outer(window).querySelector(
        `select[data-filter-field-id="${id}"]`
    );
    assert(found, `Missing returned filter control: ${id}`);
    return found;
};
const choose = (window, id, recordId) => {
    const node = select(window, id);
    node.value = recordId;
    change(window, node);
};
const checkbox = (window, title) => {
    const label = [...outer(window).querySelectorAll('label')].find(
        (candidate) => candidate.textContent?.trim() === title
    );
    assert(label, `Missing packed linked choice: ${title}`);
    const node = label.querySelector('input[type="checkbox"]');
    assert(node);
    return node;
};
const loadFilters = async (window) => {
    button(outer(window), 'Load conditional filters').click();
    await waitFor(
        () =>
            outer(window).querySelector(
                'select[data-filter-field-id="fld_country"]'
            ) !== null && idle(window)
    );
};
const searchOptions = async (window) => {
    button(outer(window), 'Search choices').click();
    await waitFor(() => idle(window));
};

/** Local synthetic dispatch of copied main.ts against the installed tested SDK. */
export async function checkBrowserLinkedFilterExample({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const outfile = join(
        consumer,
        '.generated',
        'linked-filter-main-checks.mjs'
    );
    const bundled = await build({
        absWorkingDir: consumer,
        entryPoints: [join(consumer, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        logLevel: 'silent',
        metafile: true,
        plugins: [
            {
                name: 'linked-caption-accepted-page-observer',
                setup(bundle) {
                    bundle.onLoad({ filter: /\/src\/main\.ts$/ }, (args) => ({
                        loader: 'ts',
                        // Observe the real accepted page; client, owner and loaders remain unchanged.
                        contents:
                            readFileSync(args.path, 'utf8') +
                            '\nexport const linkedCaptionPageForTest = () => visitors[activeVisitor].screen;\n',
                    }));
                },
            },
        ],
    });
    await assertBrowserInputs(bundled.metafile, consumer);
    const scenarios = [
        ...captionScenarios.map((captionPolicy) => ({
            name: `${captionPolicy.name} preserve native selection, dirty state, Save and read counts`,
            captionPolicy,
        })),
        {
            name: 'hidden selectors resolve three ordered server-prefills, native IDs, inner reads and nested save',
            ordered: true,
        },
        {
            name: 'empty filters block adding independently, retain raw baseline and never auto-save',
            add: true,
            remove: false,
        },
        {
            name: 'empty filters block removing independently and never auto-save',
            add: false,
            remove: true,
        },
        {
            name: 'unavailable filter metadata preserves unrestricted reads and additions',
            unavailable: true,
        },
        {
            name: 'unavailable filter drivers block restricted add/remove while allowing unrelated save',
            unavailable: true,
            add: true,
            remove: true,
        },
        {
            name: 'delayed conditional-filter discovery cannot cross A→B→A or dispose boundaries',
            stale: true,
        },
    ];
    let revision = 0;
    for (const scenario of scenarios) {
        const query = scenario.ordered
            ? '?prefill_Current%20country=North%2C%20East&prefill_Current%20region=Duplicate%20label&prefill_Current%20city=City%20%3D%20%22One%22&prefill_Country=old%20name'
            : '';
        const window = new Window({
            url: `https://app.example.test/${query}`,
            settings: {
                disableCSSFileLoading: true,
                disableJavaScriptFileLoading: true,
            },
        });
        window.document.write(
            readFileSync(join(consumer, 'index.html'), 'utf8').replace(
                /<script\b[^>]*>[\s\S]*?<\/script>/g,
                ''
            )
        );
        const form = makeForm(scenario);
        const bootstraps = [];
        const filters = [];
        const reads = [];
        const saves = [];
        const unexpected = [];
        let resolveOptions;
        const pendingOptions = new Promise((done) => {
            resolveOptions = done;
        });
        let resolveFilter;
        const pendingFilter = new Promise((done) => {
            resolveFilter = done;
        });
        const fetch = async (resource, init) => {
            const url = new URL(String(resource));
            assert.equal(url.origin, 'https://sdk.example.test');
            assert.equal(init?.credentials, 'omit');
            const route = url.searchParams.get('route');
            if (route === 'fetchExtensionForEndUser')
                return new Response(JSON.stringify(form));
            if (
                url.pathname ===
                '/api/trpc/publicExtensions.fetchInitialTableIdsToLinkedTableStates'
            ) {
                assert.equal(init?.method, 'GET');
                const payload = JSON.parse(
                    url.searchParams.get('input') ?? 'null'
                );
                bootstraps.push(payload);
                assert.deepEqual(payload, {
                    extensionAccessToken: form.payload.extensionAccessToken,
                });
                return new Response(
                    JSON.stringify({
                        result: {
                            data: scenario.unavailable ? {} : metadata(),
                        },
                    })
                );
            }
            if (
                route ===
                'fetchPrimaryValuesForConditionalLinkedRecordFilterField'
            ) {
                assert.equal(init?.method, 'POST');
                const payload = JSON.parse(String(init?.body));
                filters.push(payload);
                if (scenario.ordered) {
                    assert.equal(
                        select(window, 'fld_country').closest('div').hidden,
                        true,
                        'Selectors stay hidden throughout prefill resolution'
                    );
                    assert.equal(
                        button(
                            outer(window),
                            'Load conditional filters'
                        ).closest('[hidden]'),
                        null
                    );
                }
                const response = scenario.stale
                    ? await pendingFilter
                    : {
                          primaryValues:
                              values[payload.linkedRecordsFilterFieldId],
                          prefillValue: scenario.ordered
                              ? (values[
                                    payload.linkedRecordsFilterFieldId
                                ].find(
                                    (value) =>
                                        value.stringValue ===
                                        payload.urlSearchValue
                                ) ?? null)
                              : null,
                      };
                return new Response(JSON.stringify(response));
            }
            if (route === 'fetchRecordsForFormLinkedRecordsSelector') {
                reads.push(JSON.parse(String(init?.body)));
                const options = linkedOptions();
                const policy = scenario.captionPolicy;
                if (policy != null) {
                    if (reads.at(-1).offset != null) {
                        options.records = [
                            {
                                id: 'rec_more',
                                fields: { fld_project_name: 'More project' },
                            },
                        ];
                        options.offset = null;
                        if (policy.emptyMorePolicyChange) {
                            options.records = [];
                            options.offset =
                                reads.length === 2 ? 'cursor_again' : null;
                        }
                    }
                    if (policy.type)
                        options.tableIdsToLinkedTableStates.tbl_projects.airtableFields[0].config.type =
                            policy.type;
                    for (const record of options.records) {
                        if (Object.hasOwn(policy, 'value'))
                            record.fields.fld_project_name = policy.value;
                        if (policy.nameOnly) {
                            record.fields['Project name'] =
                                record.fields.fld_project_name;
                            delete record.fields.fld_project_name;
                        }
                        if (policy.nameValue)
                            record.fields['Project name'] = policy.nameValue;
                    }
                    if (policy.missingTableMap)
                        delete options.tableIdsToLinkedTableStates;
                    if (policy.lifecycle && reads.length === 4)
                        await pendingOptions;
                }
                return new Response(JSON.stringify(options));
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
            throw new Error(
                'Packed linked-filter fixture attempted an unexpected call.'
            );
        };
        function Option(text = '', value = '') {
            const option = window.document.createElement('option');
            option.textContent = text;
            option.value = value;
            return option;
        }
        const globals = {
            document: window.document,
            Node: window.Node,
            location: window.location,
            HTMLElement: window.HTMLElement,
            HTMLInputElement: window.HTMLInputElement,
            HTMLSelectElement: window.HTMLSelectElement,
            HTMLButtonElement: window.HTMLButtonElement,
            HTMLTextAreaElement: window.HTMLTextAreaElement,
            Option,
            fetch,
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        try {
            const starter = await import(
                `${pathToFileURL(outfile).href}?case=${++revision}`
            );
            window.document.getElementById('api-origin').value =
                'https://sdk.example.test';
            window.document.getElementById('share-id').value = 'share_example';
            submit(window, window.document.getElementById('connection-form'));
            await waitFor(
                () =>
                    window.document.querySelector(
                        'textarea[data-field-id="fld_projects"]'
                    ) !== null && idle(window)
            );
            assert.equal(bootstraps.length, 0);
            assert.equal(saves.length, 0);
            if (scenario.captionPolicy != null) {
                const policy = scenario.captionPolicy;
                const choices = () => [
                    ...outer(window).querySelectorAll('.choice-list label'),
                ];
                const captions = () =>
                    choices().map((label) => label.textContent.trim());
                const expected = (labels) =>
                    policy.caption == null
                        ? labels
                        : labels.map(() => policy.caption);
                await searchOptions(window);
                assert.deepEqual(
                    captions(),
                    expected(['Retained project', 'Available project'])
                );
                assert.equal(choices()[0].querySelector('input').checked, true);
                assert.equal(
                    choices()[1].querySelector('input').checked,
                    false
                );
                assert.deepEqual(rawIds(window), ['rec_retained']);
                assert.equal(saves.length, 0);
                const search = outer(window).querySelector(
                    'input[placeholder="Search available linked records"]'
                );
                if (policy.emptyMorePolicyChange) {
                    const retained = choices()[0].querySelector('input');
                    const available = choices()[1].querySelector('input');
                    const accepted = starter.linkedCaptionPageForTest();
                    assert.notEqual(
                        accepted,
                        form,
                        'Mutate the accepted page, not the serialized fixture'
                    );
                    const detail =
                        accepted.payload.linkedRecordFieldIdToDetailFields
                            .fld_projects[0];
                    for (const [index, hidden] of [true, false].entries()) {
                        detail.isHidden = hidden;
                        button(outer(window), 'More choices').click();
                        await waitFor(
                            () => reads.length === index + 2 && idle(window)
                        );
                        assert.deepEqual(
                            captions(),
                            ['Linked record', 'Linked record'],
                            'Empty More must retire earlier captions and restoring display authority must not revive them'
                        );
                        assert.equal(
                            choices()[0].querySelector('input'),
                            retained
                        );
                        assert.equal(
                            choices()[1].querySelector('input'),
                            available
                        );
                        assert.equal(retained.checked, true);
                        assert.equal(available.checked, false);
                        assert.deepEqual(rawIds(window), ['rec_retained']);
                        assert.equal(saves.length, 0);
                    }
                    assert.deepEqual(
                        reads.map((read) => read.offset),
                        [null, 'cursor_next', 'cursor_again']
                    );
                    assert.equal(
                        button(outer(window), 'More choices').disabled,
                        true
                    );
                } else {
                    button(outer(window), 'More choices').click();
                    await waitFor(() => reads.length === 2 && idle(window));
                    assert.deepEqual(
                        captions(),
                        expected([
                            'Retained project',
                            'Available project',
                            'More project',
                        ])
                    );
                    assert.equal(
                        button(outer(window), 'More choices').disabled,
                        true
                    );
                    assert.equal(reads[1].offset, 'cursor_next');
                    const detached = choices()[1].querySelector('input');
                    search.value = 'Replacement';
                    input(window, search);
                    assert.deepEqual(captions(), []);
                    detached.checked = true;
                    change(window, detached);
                    assert.deepEqual(rawIds(window), ['rec_retained']);
                    await searchOptions(window);
                    assert.deepEqual(
                        captions(),
                        expected(['Retained project', 'Available project'])
                    );
                    assert.equal(reads[2].offset, null);
                    assert.equal(reads[2].filter.searchTerm, 'Replacement');
                }
                submit(window, outer(window).closest('form'));
                await waitFor(() => saves.length === 1 && idle(window));
                assert.deepEqual(saves[0].formRecord.data.fld_projects, [
                    'rec_retained',
                ]);
                assert.deepEqual(
                    saves[0].formFieldIdsWithUnsavedChanges,
                    [],
                    'Caption reads and replacement must not dirty the native draft'
                );
                const available = choices()[1].querySelector('input');
                available.checked = true;
                change(window, available);
                assert.deepEqual(rawIds(window), [
                    'rec_retained',
                    'rec_available',
                ]);
                submit(window, outer(window).closest('form'));
                await waitFor(() => saves.length === 2 && idle(window));
                assert.deepEqual(saves[1].formRecord.data.fld_projects, [
                    'rec_retained',
                    'rec_available',
                ]);
                assert.deepEqual(saves[1].formFieldIdsWithUnsavedChanges, [
                    'fld_projects',
                ]);
                if (policy.lifecycle) {
                    search.value = 'Late result';
                    input(window, search);
                    button(outer(window), 'Search choices').click();
                    await waitFor(() => reads.length === 4);
                    const visitor = window.document.getElementById('visitor');
                    visitor.value = 'B';
                    change(window, visitor);
                    visitor.value = 'A';
                    change(window, visitor);
                    resolveOptions();
                    await settle();
                    await settle();
                    assert.equal(available.isConnected, false);
                    assert.deepEqual(
                        captions(),
                        [],
                        'An A→B→A render must not resurrect retired candidate captions'
                    );
                    available.checked = false;
                    change(window, available);
                    assert.deepEqual(rawIds(window), [
                        'rec_retained',
                        'rec_available',
                    ]);
                    assert.equal(reads.length, 4);
                } else assert.equal(reads.length, 3);
                assert.equal(bootstraps.length, 0);
                assert.equal(filters.length, 0);
                assert.equal(saves.length, 2);
            } else if (scenario.unavailable) {
                button(outer(window), 'Load conditional filters').click();
                await waitFor(() => bootstraps.length === 1 && idle(window));
                assert.match(
                    window.document.getElementById('status').textContent,
                    /unavailable/i
                );
                assert.equal(
                    outer(window).querySelector('select[data-filter-field-id]'),
                    null
                );
                const search = button(outer(window), 'Search choices');
                search.disabled = false;
                search.click();
                await waitFor(() => reads.length === 1 && idle(window));
                assert.deepEqual(
                    reads[0].conditionalLinkedRecordFilteringValues,
                    {}
                );
                const add = checkbox(window, 'Available project');
                add.checked = true;
                change(window, add);
                if (scenario.remove) {
                    const remove = checkbox(window, 'Retained project');
                    remove.checked = false;
                    change(window, remove);
                }
                assert.deepEqual(
                    rawIds(window),
                    scenario.add
                        ? ['rec_retained']
                        : ['rec_retained', 'rec_available']
                );
                assert.equal(saves.length, 0);
                const title = window.document.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                title.value = 'Unrelated edit';
                input(window, title);
            } else {
                await loadFilters(window);
                assert.equal(bootstraps.length, 1);
                if (scenario.stale) {
                    button(outer(window), 'Search Country').click();
                    await waitFor(() => filters.length === 1);
                    const captured = select(window, 'fld_country');
                    const visitor = window.document.getElementById('visitor');
                    visitor.value = 'B';
                    change(window, visitor);
                    visitor.value = 'A';
                    change(window, visitor);
                    resolveFilter({
                        primaryValues: values.fld_country,
                        prefillValue: values.fld_country[0],
                    });
                    await settle();
                    await settle();
                    assert.equal(captured.isConnected, false);
                    assert.equal(
                        outer(window).querySelector(
                            'select[data-filter-field-id]'
                        ),
                        null
                    );
                    captured.value = 'rec_country_north';
                    change(window, captured);
                    assert.deepEqual(rawIds(window), ['rec_retained']);
                    assert.equal(saves.length, 0);
                    assert.equal(reads.length, 0);
                    const disconnect =
                        window.document.getElementById('disconnect');
                    disconnect.click();
                    change(window, captured);
                    assert.equal(saves.length, 0);
                } else {
                    if (scenario.ordered) {
                        assert.equal(
                            select(window, 'fld_country').closest('div').hidden,
                            true
                        );
                        assert.equal(
                            button(outer(window), 'Load conditional filters')
                                .hidden,
                            false
                        );
                        assert.equal(
                            button(
                                outer(window),
                                'Load conditional filters'
                            ).closest('[hidden]'),
                            null
                        );
                        assert.deepEqual(
                            filters.map((call) => ({
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
                                        previousFilterPrimaryValue:
                                            'North, East',
                                    },
                                },
                                {
                                    id: 'fld_city',
                                    search: 'City = "One"',
                                    url: 'City = "One"',
                                    previous: {
                                        previousFilterFieldId: 'fld_region',
                                        previousFilterPrimaryValue:
                                            'Duplicate label',
                                    },
                                },
                            ]
                        );
                        assert.equal(
                            select(window, 'fld_region').value,
                            'rec_region_one'
                        );
                        const duplicates = [
                            ...select(window, 'fld_region').options,
                        ].filter((option) =>
                            option.textContent?.startsWith('Duplicate label')
                        );
                        assert.deepEqual(
                            duplicates.map((option) => option.value).sort(),
                            ['rec_region_one', 'rec_region_two']
                        );
                    } else assert.equal(filters.length, 0);
                    await searchOptions(window);
                    assert.deepEqual(
                        reads[0].conditionalLinkedRecordFilteringValues,
                        scenario.ordered
                            ? prefillMap
                            : {
                                  fld_country: null,
                                  fld_region: null,
                                  fld_city: null,
                              }
                    );
                    const add = checkbox(window, 'Available project');
                    add.checked = true;
                    change(window, add);
                    if (!scenario.ordered) {
                        const remove = checkbox(window, 'Retained project');
                        remove.checked = false;
                        change(window, remove);
                    }
                    assert.equal(saves.length, 0);
                }
            }
            if (!scenario.stale && scenario.captionPolicy == null) {
                submit(window, outer(window).closest('form'));
                await waitFor(() => saves.length === 1 && idle(window));
                const expectedIds = scenario.ordered
                    ? ['rec_retained', 'rec_available']
                    : scenario.unavailable
                      ? scenario.add
                          ? ['rec_retained']
                          : ['rec_retained', 'rec_available']
                      : scenario.add
                        ? []
                        : ['rec_retained', 'rec_available'];
                assert.deepEqual(
                    saves[0].formRecord.data.fld_projects,
                    expectedIds
                );
                if (scenario.unavailable) {
                    assert.equal(
                        saves[0].formRecord.data.fld_title,
                        'Unrelated edit'
                    );
                    assert.deepEqual(
                        saves[0]
                            .conditionalLinkedRecordFieldIdsToFilteringValues,
                        { fld_projects: {} }
                    );
                } else
                    assert.deepEqual(
                        saves[0]
                            .conditionalLinkedRecordFieldIdsToFilteringValues,
                        {
                            fld_projects: scenario.ordered
                                ? prefillMap
                                : {
                                      fld_country: null,
                                      fld_region: null,
                                      fld_city: null,
                                  },
                        }
                    );
                if (scenario.ordered) {
                    const captured = checkbox(window, 'Available project');
                    choose(window, 'fld_country', 'rec_country_south');
                    assert.equal(select(window, 'fld_region').value, '');
                    assert.equal(select(window, 'fld_city').value, '');
                    assert.equal(
                        button(outer(window), 'More choices').disabled,
                        true
                    );
                    assert.equal(
                        outer(window).querySelectorAll('input[type="checkbox"]')
                            .length,
                        0
                    );
                    captured.checked = false;
                    change(window, captured);
                    assert.deepEqual(rawIds(window), [
                        'rec_retained',
                        'rec_available',
                    ]);
                    await searchOptions(window);
                    assert.equal(reads[1].offset, null);
                    assert.deepEqual(
                        reads[1].conditionalLinkedRecordFilteringValues,
                        {
                            fld_country: values.fld_country[1],
                            fld_region: null,
                            fld_city: null,
                        }
                    );
                    assert.equal(
                        saves.length,
                        1,
                        'Filter changes cannot replay the earlier save'
                    );
                }
                assert.equal(bootstraps.length, 1);
            }
            assert.deepEqual(unexpected, []);
            console.log(
                `[packed linked filters ${revision}/${scenarios.length}] ${scenario.name}: passed`
            );
        } catch (error) {
            throw new Error(
                `Packed linked-filter scenario failed: ${scenario.name}`,
                { cause: error }
            );
        } finally {
            for (const [key, descriptor] of previous) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    }
    return { checks: scenarios.length };
}

export const linkedFilterExampleFixtures = {
    definitions,
    values,
    prefillMap,
    metadata,
    makeForm,
};
