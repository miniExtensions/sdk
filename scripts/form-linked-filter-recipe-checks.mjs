import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

/** Execute the shipped custom renderer through the installed SDK and existing routes. */
export async function checkFormLinkedFilterRecipe({
    consumerDirectory,
    guideSources,
}) {
    const root = realpathSync(consumerDirectory);
    const require = createRequire(join(root, 'package.json'));
    const installed = realpathSync(
        join(root, 'node_modules/@miniextensions/sdk')
    );
    const matches = guideSources
        .map((source) => resolve(root, source))
        .filter((source) =>
            readFileSync(source, 'utf8').includes(
                'export function createConfiguredCascadeAdapter('
            )
        );
    assert.equal(matches.length, 1, 'Missing unique shipped cascade adapter');
    const { code } = await transform(readFileSync(matches[0], 'utf8'), {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
    });
    const compiled = `${matches[0]}.cascade.mjs`;
    writeFileSync(
        compiled,
        `${code}\nexport const recipeFormsUrl = import.meta.resolve('@miniextensions/sdk/forms');\n`
    );
    const { createConfiguredCascadeAdapter, recipeFormsUrl } = await import(
        pathToFileURL(compiled).href
    );
    assert(
        realpathSync(fileURLToPath(recipeFormsUrl)).startsWith(
            `${installed}/dist/esm/`
        )
    );
    for (const module of [
        '@miniextensions/sdk',
        '@miniextensions/sdk/forms',
        '@miniextensions/sdk/ui',
    ])
        assert(
            realpathSync(require.resolve(module)).startsWith(
                `${installed}/dist/`
            )
        );
    const { createMiniExtensionsClient } = require('@miniextensions/sdk');
    const {
        FormDraftStore,
        createFormLinkedFilterModel,
    } = require('@miniextensions/sdk/forms');
    const definitions = ['country', 'region', 'city'];
    const labels = ['North, East', 'Duplicate label', 'City = "One"'];
    const field = (id) => ({
        id,
        name: `Current ${id}`,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: 'multipleRecordLinks',
            options: {
                linkedTableId: 'tbl_places',
                inverseLinkFieldId: 'fld_parent',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
    });
    const response = (id) => ({
        primaryValues: [
            {
                recordId: `${id}_one`,
                stringValue: labels[definitions.indexOf(id)],
            },
            {
                recordId: `${id}_two`,
                stringValue: labels[definitions.indexOf(id)],
            },
        ],
        prefillValue: {
            recordId: `${id}_two`,
            stringValue: labels[definitions.indexOf(id)],
        },
    });
    const deferred = () => {
        let resolve, reject;
        const promise = new Promise((yes, no) => {
            resolve = yes;
            reject = no;
        });
        return { promise, resolve, reject };
    };
    function fixture({
        missing = false,
        removing = false,
        queryOverride,
    } = {}) {
        const loaded = portalRecipeFixtures.makeForm({
            childExtensionInfo: { accessType: { type: 'create' } },
        });
        const schema = {
            fieldType: 'multipleRecordLinks',
            airtableField: field('outer'),
            miniExtConfig: {
                conditionalLinkedRecordFilteringFieldsType: 'hide',
                conditionalLinkedRecordFilterFields: definitions.map((id) => ({
                    idOrName: { type: 'id', id },
                    config: {
                        type: 'multipleRecordLinks',
                        config: {
                            disableRemovingIfConditionalFilterIsEmpty: removing,
                        },
                    },
                })),
            },
        };
        loaded.payload.fieldIdsToSchemas.outer = schema;
        loaded.payload.fieldIdsInForm.push('outer');
        loaded.payload.formRecord.data.outer = ['rec_retained', 'rec_second'];
        const metadata = missing
            ? {}
            : {
                  tbl_places: {
                      airtableFields: definitions.map(field),
                      recordIdsToAirtableRecords: {},
                  },
              };
        const query =
            queryOverride ??
            Object.fromEntries(
                definitions.map((id, index) => [
                    `prefill_Current ${id}`,
                    labels[index],
                ])
            );
        const calls = [],
            saves = [],
            optionReads = [];
        let scope = { ownerId: 'A', revision: 0 };
        let filterResponse = (input) =>
            response(input.linkedRecordsFilterFieldId);
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://synthetic.example',
            fetch: async (url, init) => {
                const route = new URL(String(url)).searchParams.get('route');
                const input = JSON.parse(String(init.body));
                calls.push({ route, input: structuredClone(input) });
                assert.equal(init.method, 'POST');
                assert.equal(init.credentials, 'omit');
                if (
                    route ===
                    'fetchPrimaryValuesForConditionalLinkedRecordFilterField'
                )
                    return new Response(
                        JSON.stringify(await filterResponse(input))
                    );
                if (route === 'fetchRecordsForFormLinkedRecordsSelector') {
                    optionReads.push(structuredClone(input));
                    return new Response(
                        JSON.stringify({
                            records: [
                                {
                                    id:
                                        input.offset == null
                                            ? 'rec_allowed'
                                            : 'rec_next',
                                    fields: {},
                                },
                            ],
                            offset: input.offset == null ? 'next' : null,
                            tableIdsToLinkedTableStates: metadata,
                        })
                    );
                }
                if (route === 'saveForm') {
                    saves.push(structuredClone(input));
                    return new Response(
                        JSON.stringify({
                            type: 'error',
                            formErrors: {},
                            validationErrors: [],
                        })
                    );
                }
                throw new Error(`Unexpected route: ${route}`);
            },
        });
        const store = new FormDraftStore();
        const options = {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: structuredClone(query),
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {
                other_outer: { other_driver: null },
            },
        };
        const adapter = createConfiguredCascadeAdapter({
            client,
            loaded,
            fieldId: 'outer',
            metadata,
            query,
            store,
            getScope: () => scope,
            getSaveOptions: () => options,
        });
        return {
            adapter,
            loaded,
            schema,
            metadata,
            query,
            options,
            calls,
            saves,
            optionReads,
            client,
            store,
            scope: (next) => {
                scope = next;
            },
            respond: (work) => {
                filterResponse = work;
            },
        };
    }
    let checks = 0;
    const check = async (name, exercise) => {
        const f = fixture();
        try {
            await exercise(f);
            checks++;
        } catch (error) {
            throw new Error(name, { cause: error });
        } finally {
            f.adapter.dispose();
        }
    };
    for (const interruption of ['failed', 'cancelled', 'invalid']) {
        await check(
            `explicit hidden prefill retry after ${interruption}`,
            async (f) => {
                const initial = structuredClone(
                    f.loaded.payload.formRecord.data
                );
                const pending = deferred();
                const controller = new AbortController();
                f.respond((input) =>
                    input.linkedRecordsFilterFieldId === 'region'
                        ? pending.promise
                        : response(input.linkedRecordsFilterFieldId)
                );
                const first = f.adapter.loadPrefills(controller.signal);
                while (f.calls.length < 2)
                    await new Promise((resolve) => setTimeout(resolve, 0));
                if (interruption === 'failed')
                    pending.reject(new Error('interrupted'));
                else if (interruption === 'cancelled') {
                    controller.abort();
                    pending.resolve(response('region'));
                } else
                    pending.resolve({
                        primaryValues: [],
                        prefillValue: response('region').prefillValue,
                    });
                if (interruption === 'failed') await assert.rejects(first);
                else await first;
                assert.equal(f.calls.length, 2);
                assert.equal(f.saves.length, 0);
                assert.equal(f.adapter.state().hidden, true);
                assert.equal(
                    f.adapter.snapshot().country.recordId,
                    'country_two'
                );
                assert.equal(f.adapter.snapshot().region, null);
                f.respond((input) =>
                    response(input.linkedRecordsFilterFieldId)
                );
                await f.adapter.loadPrefills();
                assert.deepEqual(
                    f.calls.map(
                        (call) => call.input.linkedRecordsFilterFieldId
                    ),
                    ['country', 'region', 'region', 'city']
                );
                assert.deepEqual(f.calls[2].input.filterData, {
                    previousFilterFieldId: 'country',
                    previousFilterPrimaryValue: labels[0],
                });
                assert.deepEqual(f.calls[3].input.filterData, {
                    previousFilterFieldId: 'region',
                    previousFilterPrimaryValue: labels[1],
                });
                await f.adapter.saveOnce();
                assert.equal(f.saves.length, 1);
                assert.deepEqual(f.saves[0].formRecord.data, initial);
                assert.deepEqual(
                    f.saves[0].conditionalLinkedRecordFieldIdsToFilteringValues
                        .outer,
                    Object.fromEntries(
                        definitions.map((id) => [id, response(id).prefillValue])
                    )
                );
            }
        );
    }
    await check(
        'valid null prefill completion is skipped by explicit retry',
        async (f) => {
            f.respond((input) => ({ primaryValues: [], prefillValue: null }));
            await f.adapter.loadPrefills();
            await f.adapter.loadPrefills();
            assert.equal(f.calls.length, 3);
            assert.deepEqual(f.adapter.snapshot(), {
                country: null,
                region: null,
                city: null,
            });
            assert.equal(f.saves.length, 0);
        }
    );
    await check(
        'late interrupted prefill error cannot retire a newer explicit retry',
        async (f) => {
            const old = deferred(),
                next = deferred();
            let count = 0;
            f.respond(() => (++count === 1 ? old.promise : next.promise));
            const retired = f.adapter.readDriver('country', true);
            const retry = f.adapter.readDriver('country', true);
            old.reject(new Error('late old error'));
            assert.equal((await retired).status, 'stale');
            next.resolve(response('country'));
            assert.equal((await retry).status, 'accepted');
            assert.equal(
                (await f.adapter.readDriver('country', true)).status,
                'resolved'
            );
            assert.equal(f.calls.length, 2);
        }
    );
    await check(
        'user edit before explicit retry prevents old URL prefills',
        async (f) => {
            f.respond((input) => {
                if (input.linkedRecordsFilterFieldId === 'region')
                    throw new Error('interrupted');
                return response(input.linkedRecordsFilterFieldId);
            });
            await assert.rejects(f.adapter.loadPrefills());
            f.adapter.searchDriver('country', 'deliberate edit');
            await f.adapter.loadPrefills();
            assert.equal(f.calls.length, 2);
            assert.equal(f.saves.length, 0);
            assert.equal(f.adapter.snapshot().country.recordId, 'country_two');
        }
    );
    await check(
        'ordered hidden prefills, duplicate labels, fresh nested Save and unchanged native values',
        async (f) => {
            const initial = structuredClone(f.loaded.payload.formRecord.data);
            assert.equal(f.adapter.state().hidden, true);
            assert.equal(f.calls.length, 0);
            await f.adapter.loadPrefills();
            assert.equal(f.calls.length, 3);
            for (const [index, call] of f.calls.entries()) {
                assert.equal(
                    call.input.linkedRecordsFilterFieldId,
                    definitions[index]
                );
                assert.equal(call.input.urlSearchValue, labels[index]);
                assert.deepEqual(
                    call.input.filterData,
                    index === 0
                        ? null
                        : {
                              previousFilterFieldId: definitions[index - 1],
                              previousFilterPrimaryValue: labels[index - 1],
                          }
                );
            }
            assert.equal(f.adapter.snapshot().region.recordId, 'region_two');
            f.options.conditionalLinkedRecordFieldIdsToFilteringValues.outer = {
                stale: null,
            };
            await f.adapter.saveOnce();
            assert.equal(f.saves.length, 1);
            assert.deepEqual(f.saves[0].formRecord.data, initial);
            assert.deepEqual(
                f.saves[0].conditionalLinkedRecordFieldIdsToFilteringValues,
                {
                    other_outer: { other_driver: null },
                    outer: f.adapter.snapshot(),
                }
            );
            await f.adapter.saveOnce();
            assert.equal(f.saves.length, 1);
        }
    );
    await check(
        'pending child response cannot survive parent change',
        async (f) => {
            await f.adapter.loadPrefills();
            const held = deferred();
            f.respond(() => held.promise);
            const pending = f.adapter.readDriver('city');
            assert.equal(
                f.adapter.chooseDriver('country', 'country_one'),
                true
            );
            held.resolve(response('city'));
            assert.equal((await pending).status, 'stale');
            assert.deepEqual(f.adapter.snapshot(), {
                country: { recordId: 'country_one', stringValue: labels[0] },
                region: null,
                city: null,
            });
            assert.deepEqual(f.adapter.selection.getState().value, [
                'rec_retained',
                'rec_second',
            ]);
            assert.equal(f.saves.length, 0);
        }
    );
    await check(
        'overlapping identical searches reject out-of-order responses',
        async (f) => {
            const older = deferred(),
                newer = deferred();
            let count = 0;
            f.respond(() => (++count === 1 ? older.promise : newer.promise));
            const first = f.adapter.readDriver('country'),
                second = f.adapter.readDriver('country');
            newer.resolve(response('country'));
            assert.equal((await second).status, 'accepted');
            older.resolve({
                primaryValues: [
                    { recordId: 'obsolete', stringValue: 'Obsolete' },
                ],
                prefillValue: null,
            });
            assert.equal((await first).status, 'stale');
            assert.deepEqual(
                f.adapter
                    .state()
                    .filters[0].candidates.map((pair) => pair.recordId),
                ['country_one', 'country_two']
            );
        }
    );
    await check(
        'copied configuration, query, metadata, maps and pairs resist consumer mutation',
        async (f) => {
            f.schema.airtableField.id = 'mutated';
            f.metadata.tbl_places.airtableFields[0].name = 'mutated';
            f.query['prefill_Current country'] = 'mutated';
            await f.adapter.loadPrefills();
            const copy = f.adapter.snapshot();
            copy.country.stringValue = 'mutated';
            const state = f.adapter.state();
            state.filters[0].selected.recordId = 'mutated';
            assert.equal(f.adapter.snapshot().country.stringValue, labels[0]);
            assert.equal(
                f.calls[0].input.mainTableLinkedRecordsFieldId,
                'outer'
            );
            assert.equal(f.calls[0].input.urlSearchValue, labels[0]);
            const model = createFormLinkedFilterModel({
                schema: f.loaded.payload.fieldIdsToSchemas.outer,
                query: {},
            });
            // Mutated fixture schema still uses the same configured drivers; metadata is independent here.
            model.initialize({
                tbl_places: {
                    airtableFields: definitions.map(field),
                    recordIdsToAirtableRecords: {},
                },
            });
            const plan = model.prepareRead('country');
            assert.equal(plan.status, 'ready');
            const values = response('country');
            model.accept(plan.ticket, values);
            values.primaryValues[0].stringValue = 'mutated';
            assert.equal(
                model.state().filters[0].candidates[0].stringValue,
                labels[0]
            );
            model.dispose();
        }
    );
    await check(
        'malformed, duplicate and mismatched-prefill results reject atomically',
        async (f) => {
            const initial = f.adapter.snapshot();
            for (const invalid of [
                {
                    primaryValues: [
                        response('country').primaryValues[0],
                        response('country').primaryValues[0],
                    ],
                    prefillValue: null,
                },
                {
                    primaryValues: [{ recordId: 'one', stringValue: null }],
                    prefillValue: null,
                },
                {
                    primaryValues: response('country').primaryValues,
                    prefillValue: {
                        recordId: 'country_two',
                        stringValue: 'mismatch',
                    },
                },
            ]) {
                f.respond(() => invalid);
                assert.equal(
                    (await f.adapter.readDriver('country')).status,
                    'invalid'
                );
                assert.deepEqual(f.adapter.snapshot(), initial);
                assert.deepEqual(f.adapter.state().filters[0].candidates, []);
            }
        }
    );
    await check(
        'fresh loader snapshots reset paging and preserve native IDs after selection/search',
        async (f) => {
            await f.adapter.loadPrefills();
            await f.adapter.selection.reload();
            assert.equal(f.adapter.selection.getState().offset, 'next');
            const before = f.adapter.snapshot();
            f.adapter.searchDriver('country', 'Find');
            assert.deepEqual(f.adapter.snapshot(), before);
            assert.equal(f.adapter.selection.getState().offset, null);
            assert.deepEqual(f.adapter.selection.getState().value, [
                'rec_retained',
                'rec_second',
            ]);
            await f.adapter.selection.reload();
            assert.deepEqual(
                f.optionReads.at(-1).conditionalLinkedRecordFilteringValues,
                before
            );
            await f.adapter.readDriver('country');
            assert.equal(
                f.adapter.chooseDriver('country', 'country_one'),
                true
            );
            await f.adapter.selection.reload();
            assert.deepEqual(
                f.optionReads.at(-1).conditionalLinkedRecordFilteringValues,
                f.adapter.snapshot()
            );
            assert.equal(f.optionReads.at(-1).offset, null);
            assert.equal(f.adapter.snapshot().region, null);
        }
    );
    await check(
        'A to B to A rejects late response and late error without losing native baseline',
        async (f) => {
            const held = deferred();
            f.respond(() => held.promise);
            const pending = f.adapter.readDriver('country', true);
            f.scope({ ownerId: 'B', revision: 1 });
            f.scope({ ownerId: 'A', revision: 2 });
            held.resolve(response('country'));
            assert.equal((await pending).status, 'stale');
            assert.equal(await f.adapter.saveOnce(), null);
            assert.equal(f.saves.length, 0);
            const next = fixture();
            try {
                const error = deferred();
                next.respond(() => error.promise);
                const pendingError = next.adapter.readDriver('country', true);
                next.scope({ ownerId: 'B', revision: 1 });
                next.scope({ ownerId: 'A', revision: 2 });
                error.reject(new Error('Late synthetic failure'));
                assert.equal((await pendingError).status, 'stale');
            } finally {
                next.adapter.dispose();
            }
        }
    );
    await check(
        'disposed adapter rejects pending results and errors',
        async (f) => {
            const held = deferred();
            f.respond(() => held.promise);
            const pending = f.adapter.readDriver('country', true);
            f.adapter.dispose();
            held.reject(new Error('Late disposed failure'));
            assert.equal((await pending).status, 'stale');
            assert.equal(await f.adapter.saveOnce(), null);
        }
    );
    await check(
        'unavailable-but-unrestricted model permits ordinary authorized reads and unrelated Save',
        async () => {
            const f = fixture({ missing: true });
            try {
                assert.equal(f.adapter.state().status, 'unavailable');
                assert.equal(f.adapter.canChange(true), true);
                assert.equal(f.adapter.canChange(false), true);
                await f.adapter.selection.reload();
                assert.equal(f.optionReads.length, 1);
                assert.deepEqual(
                    f.optionReads[0].conditionalLinkedRecordFilteringValues,
                    {}
                );
                await f.adapter.saveOnce();
                assert.deepEqual(
                    f.saves[0].formRecord.data,
                    f.loaded.payload.formRecord.data
                );
                assert.deepEqual(
                    f.saves[0].conditionalLinkedRecordFieldIdsToFilteringValues
                        .outer,
                    {}
                );
            } finally {
                f.adapter.dispose();
            }
        }
    );
    await check(
        'removal-only access treats ID-bearing empty strings as empty',
        async () => {
            const f = fixture({ removing: true, queryOverride: {} });
            try {
                assert.equal(f.adapter.canChange(true), true);
                assert.equal(f.adapter.canChange(false), false);
                for (const id of definitions) {
                    f.respond(() => ({
                        primaryValues: [
                            { recordId: 'present', stringValue: '' },
                        ],
                        prefillValue: null,
                    }));
                    await f.adapter.readDriver(id);
                    f.adapter.chooseDriver(id, 'present');
                }
                assert.equal(f.adapter.canChange(false), false);
                assert.equal(f.adapter.canChange(true), true);
                assert.equal(f.adapter.snapshot().city.recordId, 'present');
                assert.equal(f.saves.length, 0);
            } finally {
                f.adapter.dispose();
            }
        }
    );
    await check(
        'no prefill replay after edits and repeated configured URL values rejected',
        async (f) => {
            f.adapter.searchDriver('country', 'Edit');
            await f.adapter.loadPrefills();
            assert.equal(f.calls.length, 0);
            const next = fixture({
                queryOverride: {
                    'prefill_Current country': ['First', 'Second'],
                },
            });
            try {
                const result = await next.adapter.readDriver('country', true);
                assert.equal(result.status, 'unavailable');
                assert.equal(next.calls.length, 0);
                assert.equal(next.adapter.canChange(true), true);
                await next.adapter.readDriver('country');
                assert.equal(next.calls.length, 1);
            } finally {
                next.adapter.dispose();
            }
        }
    );
    return { checks };
}
