import assert from 'node:assert/strict';

/** Three supplemental native cases; the 38 archived baseline cases remain separate. */
export async function exerciseCascadeCases({
    driver,
    origin,
    By,
    find,
    clickText,
    replaceInput,
    waitReady,
    waitSnapshot,
    capture,
    nativeChoice,
    exercise,
    saves,
    snapshot,
}) {
    const filterCalls = (state) =>
        state.calls.filter(
            (call) =>
                call.route ===
                'fetchPrimaryValuesForConditionalLinkedRecordFilterField'
        );
    const metadataCalls = (state) =>
        state.calls.filter(
            (call) =>
                call.route ===
                '/api/trpc/publicExtensions.fetchInitialTableIdsToLinkedTableStates'
        );
    const selected = (state, id) =>
        state.selects.find((select) => select.filterFieldId === id)?.value;
    const sibling = 'Native unrelated retained draft';
    const queryFor = (mode) =>
        new URLSearchParams({
            scenario: 'linked-filters',
            cascadeProof: mode,
            ...(mode === 'search-failure'
                ? {}
                : {
                      'prefill_Current country': 'North, East',
                      'prefill_Current region': 'Duplicate label',
                      'prefill_Current city': 'City = "One"',
                  }),
        });
    const open = async (mode) => {
        await driver.get(`${origin}/starter/index.html?${queryFor(mode)}`);
        await clickText('Connect and load');
        await waitReady(
            (state) => state.status === 'Loaded form loaded.',
            'Supplemental synthetic Form loaded.'
        );
        await replaceInput(
            await find('#screen input[data-field-id="fld_driver"]'),
            sibling,
            'text'
        );
        await clickText('Load conditional filters');
    };
    const unchangedDraft = async (state) => {
        assert.deepEqual(JSON.parse(state.linkedDraft), ['rec_retained']);
        assert.equal(
            await (
                await find('#screen input[data-field-id="fld_driver"]')
            ).getAttribute('value'),
            sibling
        );
    };
    const noAutomaticReadOrSave = async (state) => {
        // One bounded quiet interval; this is an oracle, never a retry loop.
        await driver.sleep(1000);
        const next = await snapshot();
        assert.deepEqual(next.calls, state.calls);
        assert.equal(saves(next).length, 0);
        assert.deepEqual(next.unexpected, []);
        return next;
    };
    await exercise(
        'starter-cascade-prefill-recovery',
        async (result) => {
            await open('interrupted-prefill');
            await waitSnapshot(
                (state) => state.pending?.fieldId === 'fld_region',
                'Country accepted then Region held.'
            );
            let state = await capture(
                result,
                'region-pending-upstream-retained'
            );
            assert.equal(selected(state, 'fld_country'), 'rec_country_north');
            assert.equal(selected(state, 'fld_region'), '');
            assert.equal(selected(state, 'fld_city'), '');
            assert.deepEqual(
                filterCalls(state).map(
                    (call) => call.input.linkedRecordsFilterFieldId
                ),
                ['fld_country', 'fld_region']
            );
            assert.equal(metadataCalls(state).length, 1);
            for (const id of ['fld_country', 'fld_region', 'fld_city'])
                assert.equal(
                    await (
                        await find(
                            `#screen select[data-filter-field-id="${id}"]`
                        )
                    ).isDisplayed(),
                    false
                );
            await unchangedDraft(state);
            await clickText('Fail pending cascade read');
            await waitReady(
                (value) =>
                    value.status?.includes(
                        'Use Load conditional filters to retry unresolved prefills.'
                    ),
                'Final rendered Load retry guidance.'
            );
            state = await capture(
                result,
                'failed-region-final-recovery-status'
            );
            assert.equal(
                state.events.filter(
                    (event) =>
                        event.type === 'cascade-response-delivered' &&
                        event.outcome === 'failure'
                ).length,
                1
            );
            state = await noAutomaticReadOrSave(state);
            assert.match(
                state.status,
                /Use Load conditional filters to retry unresolved prefills/
            );
            await unchangedDraft(state);
            await clickText('Load conditional filters');
            await waitReady(
                (value) => selected(value, 'fld_city') === 'rec_city',
                'Explicit Load resumes Region then City.'
            );
            state = await capture(
                result,
                'resumed-prefills-no-upstream-refetch'
            );
            const calls = filterCalls(state);
            assert.deepEqual(
                calls.map((call) => call.input.linkedRecordsFilterFieldId),
                ['fld_country', 'fld_region', 'fld_region', 'fld_city']
            );
            assert.equal(metadataCalls(state).length, 1);
            assert.equal(
                state.calls.filter(
                    (call) => call.route === 'fetchExtensionForEndUser'
                ).length,
                1
            );
            assert.deepEqual(
                calls.map((call) => ({
                    search: call.input.searchTerm,
                    url: call.input.urlSearchValue,
                    previous: call.input.filterData,
                })),
                [
                    {
                        search: 'North, East',
                        url: 'North, East',
                        previous: null,
                    },
                    ...Array.from({ length: 2 }, () => ({
                        search: 'Duplicate label',
                        url: 'Duplicate label',
                        previous: {
                            previousFilterFieldId: 'fld_country',
                            previousFilterPrimaryValue: 'North, East',
                        },
                    })),
                    {
                        search: 'City = "One"',
                        url: 'City = "One"',
                        previous: {
                            previousFilterFieldId: 'fld_region',
                            previousFilterPrimaryValue: 'Duplicate label',
                        },
                    },
                ]
            );
            await unchangedDraft(state);
            for (const id of ['fld_country', 'fld_region', 'fld_city'])
                assert.equal(
                    await (
                        await find(
                            `#screen select[data-filter-field-id="${id}"]`
                        )
                    ).isDisplayed(),
                    false
                );
            assert.equal(saves(state).length, 0);
            await clickText('Save');
            await waitReady(
                (value) =>
                    saves(value).length === 1 &&
                    value.status?.includes('The Form was not saved.'),
                'One deliberate native Save dispatch.'
            );
            state = await capture(result, 'exact-filter-map-full-native-save');
            const call = saves(state)[0];
            assert.deepEqual(call.input.formRecord, {
                type: 'edit',
                tableId: 'tbl_interaction_synthetic',
                recordId: 'rec_interaction_synthetic',
                data: { ...state.expected.initial, fld_driver: sibling },
            });
            assert.deepEqual(
                call.input.conditionalLinkedRecordFieldIdsToFilteringValues,
                {
                    fld_projects: {
                        fld_country: {
                            recordId: 'rec_country_north',
                            stringValue: 'North, East',
                        },
                        fld_region: {
                            recordId: 'rec_region_one',
                            stringValue: 'Duplicate label',
                        },
                        fld_city: {
                            recordId: 'rec_city',
                            stringValue: 'City = "One"',
                        },
                    },
                }
            );
            await driver.sleep(1000);
            const final = await snapshot();
            assert.deepEqual(final.calls, state.calls);
            assert.equal(saves(final).length, 1);
            assert(
                state.calls.every((call) => call.credentialsMode === 'omit')
            );
        },
        'interrupted-prefill'
    );

    await exercise(
        'starter-cascade-search-recovery',
        async (result) => {
            await open('search-failure');
            await waitReady(
                (state) =>
                    state.selects.some(
                        (select) => select.filterFieldId === 'fld_country'
                    ),
                'Controls initialized without URL reads.'
            );
            assert.equal(filterCalls(await snapshot()).length, 0);
            await clickText('Search Country');
            await waitSnapshot(
                (state) => state.pending?.fieldId === 'fld_country',
                'Ordinary Country search held.'
            );
            await clickText('Fail pending cascade read');
            await waitReady(
                (state) =>
                    state.status?.includes(
                        'Use Search Country to retry this filter read.'
                    ),
                'Final rendered Search retry guidance.'
            );
            let state = await capture(result, 'ordinary-search-final-guidance');
            assert.equal(filterCalls(state).length, 1);
            assert.equal(filterCalls(state)[0].input.urlSearchValue, null);
            state = await noAutomaticReadOrSave(state);
            assert.match(
                state.status,
                /Use Search Country to retry this filter read/
            );
            assert(!state.status.includes('Use Load conditional filters'));
            await unchangedDraft(state);
            await clickText('Search Country');
            await waitReady(
                (value) =>
                    value.selects.some(
                        (select) =>
                            select.filterFieldId === 'fld_country' &&
                            select.options.length > 1
                    ),
                'Only explicit Search retries the read.'
            );
            state = await capture(result, 'fresh-search-success-no-save');
            assert.deepEqual(
                filterCalls(state).map(
                    (call) => call.input.linkedRecordsFilterFieldId
                ),
                ['fld_country', 'fld_country']
            );
            assert.equal(metadataCalls(state).length, 1);
            assert.equal(saves(state).length, 0);
            await unchangedDraft(state);
        },
        'search-failure'
    );

    await exercise(
        'starter-cascade-owner-replacement',
        async (result) => {
            await open('owner-replacement');
            await waitSnapshot(
                (state) => state.pending?.fieldId === 'fld_region',
                'Old-owner Region prefill held.'
            );
            assert.equal(
                selected(await snapshot(), 'fld_country'),
                'rec_country_north'
            );
            await nativeChoice('#visitor', 'B');
            await nativeChoice('#visitor', 'A');
            await waitReady(() => true, 'Replacement owner ready.');
            const before = await capture(
                result,
                'replacement-owner-before-late-response'
            );
            await unchangedDraft(before);
            assert.equal(
                before.selects.filter((select) => select.filterFieldId).length,
                0
            );
            await clickText('Release pending cascade read');
            await waitReady(
                (state) =>
                    state.events.some(
                        (event) => event.type === 'cascade-response-delivered'
                    ),
                'Late old-owner response settled.'
            );
            let state = await capture(result, 'old-owner-response-rejected');
            assert.equal(
                state.events.find(
                    (event) => event.type === 'cascade-response-delivered'
                ).aborted,
                true
            );
            assert.deepEqual(state.selects, before.selects);
            assert.equal(state.status, before.status);
            assert.deepEqual(state.calls, before.calls);
            await unchangedDraft(state);
            state = await noAutomaticReadOrSave(state);
            assert.equal(filterCalls(state).length, 2);
            assert.equal(saves(state).length, 0);
        },
        'owner-replacement'
    );
}
