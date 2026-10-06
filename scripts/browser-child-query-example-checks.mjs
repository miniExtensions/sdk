import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';
import { linkedFilterExampleFixtures as linked } from './browser-linked-filter-example-checks.mjs';

const waitFor = async (predicate) => {
    for (let turn = 0; turn < 200; turn++) {
        if (predicate()) return;
        await new Promise((done) => setImmediate(done));
    }
    assert.fail(
        'Packed Portal child query starter did not reach expected state.'
    );
};
const settle = () => new Promise((done) => setImmediate(done));
const button = (root, title, index = 0) => {
    const found = [...root.querySelectorAll('button')].filter(
        (x) => x.textContent?.trim() === title
    )[index];
    assert(found, `Missing child starter button: ${title}`);
    return found;
};
const event = (w, n, type) =>
    n.dispatchEvent(new w.Event(type, { bubbles: true, cancelable: true }));
const country = 'prefill_Current%20country';
const region = 'prefill_Current%20region';
const city = 'prefill_Current%20city';
const dynamic = `${country}=South&${region}=Duplicate%20label&${city}=City%20%3D%20%22One%22&dynamicOnly=Kept`;
const staticNorth = `${country}=North%2C%20East&staticOnly=Child`;

/** Closed synthetic transport, complete copied starter, actual installed SDK. */
export async function checkBrowserChildQueryExample({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const { Window } = createRequire(import.meta.url)(happyDomModulePath);
    const outfile = join(consumer, '.generated', 'child-query-main-checks.mjs');
    const built = await build({
        absWorkingDir: consumer,
        entryPoints: [join(consumer, 'src/main.ts')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        outfile,
        logLevel: 'silent',
        metafile: true,
    });
    await assertBrowserInputs(built.metafile, consumer);
    const scenarios = [
        'two-children',
        'toggle-false',
        'edit-empty',
        'dynamic-duplicates-overridden',
        'dynamic-duplicates-refused',
        'static-duplicates-refused',
        'malformed-static',
        'region-retry',
        'edit-before-retry',
        'late-child-aba',
        'late-filter-aba',
    ];
    let sequence = 0;
    for (const scenario of scenarios) {
        const w = new Window({
            url: `https://app.example.test/?${country}=ROOT&parentOnly=Never`,
            settings: {
                disableCSSFileLoading: true,
                disableJavaScriptFileLoading: true,
            },
        });
        w.document.write(
            readFileSync(join(consumer, 'index.html'), 'utf8').replace(
                /<script\b[^>]*>[\s\S]*?<\/script>/g,
                ''
            )
        );
        const portal = portalRecipeFixtures.makePortal();
        portal.payload.formRecord.data.fld_prefill = dynamic;
        if (scenario.startsWith('dynamic-duplicates'))
            portal.payload.formRecord.data.fld_prefill = `${country}=Old&${country}=South&${region}=Duplicate%20label&${city}=City%20%3D%20%22One%22`;
        if (scenario === 'toggle-false')
            portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig.prefillChildFormForCreatingRecords = false;
        const second = structuredClone(
            portal.payload.fieldIdsToSchemas.fld_children
        );
        second.airtableField.id = 'fld_other';
        second.airtableField.name = 'Other children';
        second.miniExtConfig.extensionIdForCreatingAndEditing = 'other_child';
        second.miniExtConfig.prefillFieldForCreatingChildExtension =
            'fld_other_prefill';
        portal.payload.fieldIdsToSchemas.fld_other = second;
        portal.payload.fieldIdsInPortal.push('fld_other');
        portal.payload.linkedRecordFieldIdToDetailFields.fld_other =
            structuredClone(
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children
            );
        portal.payload.formRecord.data.fld_other = ['rec_one'];
        portal.payload.formRecord.data.fld_other_prefill = `${country}=South&secondOnly=Yes`;
        const prefillSchema = structuredClone(
            portal.payload.fieldIdsToSchemas.fld_prefill
        );
        prefillSchema.airtableField.id = 'fld_other_prefill';
        prefillSchema.airtableField.name = 'Other prefill';
        portal.payload.fieldIdsToSchemas.fld_other_prefill = prefillSchema;
        const calls = [];
        const children = [];
        const returnedChildren = [];
        const filters = [];
        const metadata = [];
        const saves = [];
        let failures = 0;
        let resolveChild;
        let resolveFilter;
        const heldChild = new Promise((done) => {
            resolveChild = done;
        });
        const heldFilter = new Promise((done) => {
            resolveFilter = done;
        });
        const makeChild = (data) => {
            const child = linked.makeForm({
                ordered: scenario !== 'edit-before-retry',
            });
            child.extensionId = data.childExtensionInfo.childExtensionId;
            child.payload.extensionAccessToken = `token_${child.extensionId}`;
            child.payload.hasParentExtension = true;
            child.payload.formRecord.data.fld_parent = ['rec_user'];
            child.payload.formRecord.data.unrendered = { untouched: true };
            if (data.childExtensionInfo.accessType.type === 'edit')
                child.payload.formRecord = {
                    type: 'edit',
                    tableId: 'tbl_children',
                    recordId:
                        data.childExtensionInfo.accessType
                            .childExtensionRecordId,
                    data: child.payload.formRecord.data,
                };
            let staticText =
                child.extensionId === 'other_child' ? null : staticNorth;
            if (scenario === 'dynamic-duplicates-refused') staticText = null;
            if (scenario === 'static-duplicates-refused')
                staticText = `${country}=North%2C%20East&${country}=South`;
            if (scenario === 'malformed-static') staticText = 123;
            if (scenario === 'toggle-false')
                staticText = `${country}=North%2C%20East&${region}=Duplicate%20label&${city}=City%20%3D%20%22One%22`;
            child.payload.publicFields = {
                state: { prefillURLParamsForAddingRecords: staticText },
            };
            return child;
        };
        const fetch = async (resource, init) => {
            const url = new URL(String(resource));
            assert.equal(url.origin, 'https://sdk.example.test');
            assert.equal(init?.credentials, 'omit');
            const route = url.searchParams.get('route');
            const data = init?.body ? JSON.parse(String(init.body)) : null;
            calls.push({ route, path: url.pathname, data });
            if (route === 'fetchExtensionForEndUser') {
                if (!data.childExtensionInfo)
                    return new Response(JSON.stringify(portal));
                assert.deepEqual(
                    data.query,
                    {},
                    'No root query is forwarded to child load'
                );
                children.push(data);
                const child = makeChild(data);
                returnedChildren.push(child);
                if (scenario === 'late-child-aba')
                    return new Response(JSON.stringify(await heldChild));
                const response = new Response(JSON.stringify(child));
                response.json = async () => child;
                return response;
            }
            if (route === 'fetchRecordsForLinkedTableOnPortal')
                return new Response(
                    JSON.stringify(
                        portalRecipeFixtures.page([
                            portalRecipeFixtures.record(
                                'rec_one',
                                'Existing',
                                2
                            ),
                        ])
                    )
                );
            if (
                url.pathname ===
                '/api/trpc/publicExtensions.fetchInitialTableIdsToLinkedTableStates'
            ) {
                const data = JSON.parse(url.searchParams.get('input'));
                metadata.push(data);
                return new Response(
                    JSON.stringify({ result: { data: linked.metadata() } })
                );
            }
            if (
                route ===
                'fetchPrimaryValuesForConditionalLinkedRecordFilterField'
            ) {
                filters.push(data);
                assert(!JSON.stringify(data).includes('ROOT'));
                assert.equal(
                    data.extensionAccessToken,
                    `token_${children.at(-1).childExtensionInfo.childExtensionId}`
                );
                if (
                    ['region-retry', 'edit-before-retry'].includes(scenario) &&
                    data.linkedRecordsFilterFieldId === 'fld_region' &&
                    failures++ === 0
                )
                    throw new Error('Controlled Region failure');
                const result = {
                    primaryValues:
                        linked.values[data.linkedRecordsFilterFieldId],
                    prefillValue:
                        linked.values[data.linkedRecordsFilterFieldId].find(
                            (x) => x.stringValue === data.urlSearchValue
                        ) ?? null,
                };
                if (scenario === 'late-filter-aba')
                    return new Response(JSON.stringify(await heldFilter));
                return new Response(JSON.stringify(result));
            }
            if (route === 'saveForm') {
                saves.push(data);
                return new Response(
                    JSON.stringify({
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    })
                );
            }
            throw new Error(
                `Unexpected child query fixture network: ${url.pathname} ${route}`
            );
        };
        function Option(text = '', value = '') {
            const n = w.document.createElement('option');
            n.textContent = text;
            n.value = value;
            return n;
        }
        const globals = {
            document: w.document,
            location: w.location,
            HTMLElement: w.HTMLElement,
            HTMLInputElement: w.HTMLInputElement,
            HTMLSelectElement: w.HTMLSelectElement,
            HTMLButtonElement: w.HTMLButtonElement,
            HTMLTextAreaElement: w.HTMLTextAreaElement,
            Option,
            fetch,
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        const idle = () =>
            w.document.getElementById('screen').getAttribute('aria-busy') ===
            'false';
        const aba = () => {
            const n = w.document.getElementById('visitor');
            n.value = 'B';
            event(w, n, 'change');
            n.value = 'A';
            event(w, n, 'change');
        };
        const open = async (index = 0) => {
            button(w.document, 'Create record', index).click();
            await waitFor(
                () =>
                    w.document.querySelector(
                        'textarea[data-field-id="fld_projects"]'
                    ) && idle()
            );
        };
        const load = async () => {
            button(w.document, 'Load conditional filters').click();
            await waitFor(idle);
        };
        const save = async () => {
            const n = w.document.querySelector(
                'input[data-field-id="fld_title"]'
            );
            n.value = 'Deliberate unrelated edit';
            event(w, n, 'input');
            event(
                w,
                w.document
                    .querySelector('textarea[data-field-id="fld_projects"]')
                    .closest('form'),
                'submit'
            );
            await waitFor(() => saves.length > 0 && idle());
        };
        try {
            await import(`${pathToFileURL(outfile).href}?case=${++sequence}`);
            w.document.getElementById('api-origin').value =
                'https://sdk.example.test';
            w.document.getElementById('share-id').value = 'share_example';
            event(w, w.document.getElementById('connection-form'), 'submit');
            await waitFor(
                () =>
                    [...w.document.querySelectorAll('button')].some(
                        (x) => x.textContent === 'Create record'
                    ) && idle()
            );
            assert.equal(children.length, 0);
            assert.equal(metadata.length, 0);
            assert.equal(filters.length, 0);
            assert.equal(saves.length, 0);
            if (scenario === 'late-child-aba') {
                button(w.document, 'Create record').click();
                await waitFor(() => children.length === 1);
                aba();
                resolveChild(makeChild(children[0]));
                await settle();
                await settle();
                assert.equal(
                    w.document.querySelector(
                        'textarea[data-field-id="fld_projects"]'
                    ),
                    null
                );
                assert.equal(metadata.length, 0);
                assert.equal(filters.length, 0);
                assert.equal(saves.length, 0);
                console.log(`Packed child-query case: ${scenario} passed`);
                continue;
            }
            if (scenario === 'edit-empty') {
                button(w.document, 'Load records').click();
                await waitFor(
                    () => w.document.querySelector('tbody tr') && idle()
                );
                button(w.document, 'Open Form').click();
                await waitFor(
                    () =>
                        w.document.querySelector(
                            'textarea[data-field-id="fld_projects"]'
                        ) && idle()
                );
            } else await open();
            assert.equal(metadata.length, 0);
            assert.equal(filters.length, 0);
            assert.equal(saves.length, 0);
            // A parent/configuration mutation after handoff cannot replace snapshots.
            returnedChildren.at(
                -1
            ).payload.publicFields.state.prefillURLParamsForAddingRecords =
                `${country}=Mutated`;

            portal.payload.formRecord.data.fld_prefill = `${country}=Mutated`;
            portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig.prefillChildFormForCreatingRecords = false;
            if (scenario === 'late-filter-aba') {
                button(w.document, 'Load conditional filters').click();
                await waitFor(() => filters.length === 1);
                aba();
                resolveFilter({
                    primaryValues: linked.values.fld_country,
                    prefillValue: linked.values.fld_country[0],
                });
                await settle();
                await settle();
                assert.equal(filters.length, 1);
                assert.equal(saves.length, 0);
                assert(
                    !w.document
                        .getElementById('status')
                        .textContent.includes('resolved')
                );
                console.log(`Packed child-query case: ${scenario} passed`);
                continue;
            }
            await load();
            assert.equal(metadata.length, 1);
            assert.equal(saves.length, 0);
            if (['region-retry', 'edit-before-retry'].includes(scenario)) {
                assert.deepEqual(
                    filters.map((x) => x.linkedRecordsFilterFieldId),
                    ['fld_country', 'fld_region']
                );
                assert.match(
                    w.document.getElementById('status').textContent,
                    /Load conditional filters to retry/
                );
                await settle();
                assert.equal(filters.length, 2);
                if (scenario === 'edit-before-retry') {
                    const n = w.document.querySelector(
                        'input[data-filter-search-field-id="fld_country"]'
                    );
                    assert(n);
                    n.value = 'User search';
                    event(w, n, 'input');
                    await load();
                    assert.equal(metadata.length, 1);
                    assert.equal(filters.length, 2);
                    assert.match(
                        w.document.getElementById('status').textContent,
                        /not replayed after a user edit/
                    );
                } else {
                    await load();
                    assert.equal(metadata.length, 1);
                    assert.deepEqual(
                        filters.map((x) => x.linkedRecordsFilterFieldId),
                        ['fld_country', 'fld_region', 'fld_region', 'fld_city']
                    );
                    assert.equal(
                        filters[2].conditionalLinkedRecordFilterValues,
                        undefined
                    );
                    assert.equal(
                        filters[2].filterData.previousFilterPrimaryValue,
                        'North, East'
                    );
                    assert.equal(
                        filters[3].filterData.previousFilterPrimaryValue,
                        'Duplicate label'
                    );
                    assert.match(
                        w.document.getElementById('status').textContent,
                        /resolved|loaded/i
                    );
                }
            } else if (
                [
                    'dynamic-duplicates-refused',
                    'static-duplicates-refused',
                ].includes(scenario)
            ) {
                assert.equal(filters.length, 0);
                assert.match(
                    w.document.getElementById('status').textContent,
                    /Repeated conditional filter/
                );
            } else if (scenario === 'malformed-static') {
                assert.equal(filters.length, 0);
                assert.match(
                    w.document.querySelector('.child-query-diagnostic')
                        .textContent,
                    /could not be reconstructed/
                );
            } else if (scenario === 'edit-empty') {
                assert.equal(filters.length, 0);
            } else {
                assert.equal(filters[0].urlSearchValue, 'North, East');
                assert.equal(
                    filters[1]?.filterData?.previousFilterPrimaryValue,
                    'North, East'
                );
                if (scenario === 'two-children') {
                    button(w.document, 'Back to Portal').click();
                    const table = [
                        ...w.document.querySelectorAll('select'),
                    ].find((n) =>
                        [...n.options].some((o) => o.value === 'fld_other')
                    );
                    assert(table);
                    table.value = 'fld_other';
                    event(w, table, 'change');
                    await open();
                    await load();
                    assert.equal(metadata.length, 2);
                    assert.equal(filters.at(-1).urlSearchValue, 'South');
                    assert.equal(
                        filters.at(-1).extensionAccessToken,
                        'token_other_child'
                    );
                    assert.equal(filters.length, 4);
                }
            }
            assert.deepEqual(
                JSON.parse(
                    w.document.querySelector(
                        'textarea[data-field-id="fld_projects"]'
                    ).value
                ),
                ['rec_retained']
            );
            await save();
            assert.equal(saves.length, 1);
            const saved = saves[0];
            const last = children.at(-1);
            const baseline = makeChild(last).payload.formRecord;
            assert.deepEqual(saved.formRecord, {
                ...baseline,
                data: {
                    ...baseline.data,
                    fld_title: 'Deliberate unrelated edit',
                },
            });
            assert.deepEqual(saved.formFieldIdsWithUnsavedChanges, [
                'fld_title',
            ]);
            assert.deepEqual(saved.context, {
                type: 'modal',
                prefillData: last.context.prefillDataForLinkedRecordsForm,
            });
            if (scenario !== 'edit-empty')
                assert.equal(
                    saved.context.prefillData?.toLinkToParent
                        ?.parentFormRecordId,
                    'rec_user'
                );
            const expectedDynamic =
                scenario === 'edit-empty'
                    ? {}
                    : Object.fromEntries(
                          new URLSearchParams(
                              last.context.prefillDataForLinkedRecordsForm
                                  ?.prefillQueryForChildExtension ?? ''
                          ).entries()
                      );
            assert.deepEqual(saved.searchQuery, expectedDynamic);
            assert(!Object.hasOwn(saved.searchQuery, 'staticOnly'));
            assert(!JSON.stringify(saved.searchQuery).includes('ROOT'));
            assert(!Object.hasOwn(saved.searchQuery, 'parentOnly'));
            if (scenario === 'region-retry')
                assert.deepEqual(
                    saved.conditionalLinkedRecordFieldIdsToFilteringValues,
                    { fld_projects: linked.prefillMap }
                );
            await settle();
            assert.equal(saves.length, 1);
        } finally {
            for (const [key, descriptor] of previous)
                if (descriptor === undefined)
                    Reflect.deleteProperty(globalThis, key);
                else Object.defineProperty(globalThis, key, descriptor);
            await w.happyDOM.close();
        }
        console.log(`Packed child-query case: ${scenario} passed`);
    }
    return { checks: scenarios.length };
}
