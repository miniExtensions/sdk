import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

export const linkedRecordsTypedConsumer = `
import type { AirtableRecord } from '@miniextensions/sdk';
import type { FormFieldBindings } from '@miniextensions/sdk/forms';
import type { PortalListOwner } from '@miniextensions/sdk/portals';
import type { SelectionState } from '@miniextensions/sdk/ui';
declare const fields: FormFieldBindings;
declare const portal: PortalListOwner;
declare const selection: SelectionState;
const facet = fields.linkedRecords('fld_links');
const read: Promise<boolean> = facet.readSelected();
const rows: readonly AirtableRecord[] = facet.getSnapshot().selectedRecords;
const candidates: readonly AirtableRecord[] = selection.linkedRecords?.records ?? [];
const accepted = portal.getRecords(portal.getSnapshot().revision);
const records: readonly AirtableRecord[] = accepted?.records ?? [];
// @ts-expect-error native selection values are record IDs, never rich records
fields.field('fld_links').selection?.choose(rows);
// @ts-expect-error revisions are numbers
portal.getRecords('old');
void [read, rows, candidates, records];
`;

const complete = (field) => ({
    description: null,
    isComputed: false,
    isPrimaryField: false,
    ...field,
    config: {
        ...field.config,
        ...(['singleLineText'].includes(field.config.type)
            ? { options: null }
            : {}),
    },
});
const physical = [
    complete(fixtures.titleField),
    complete(fixtures.quantityField),
];
const row = (id, title = id) => fixtures.record(id, title, 2);
const table = (records, fields = physical) => ({
    airtableFields: structuredClone(fields),
    recordIdsToAirtableRecords: Object.fromEntries(
        records.map((record) => [record.id, structuredClone(record)])
    ),
});
const optionPage = (records, offset = null, fields = physical) => ({
    records,
    offset,
    linkedRecordFieldIdToDetailFields: null,
    tableIdsToLinkedTableStates: { tbl_children: table(records, fields) },
});
const tick = () => Promise.resolve();
const saveOptions = {
    captchaVal: null,
    isComputeMode: false,
    context: { type: 'direct-url' },
    searchQuery: {},
    conditionalLinkedRecordFieldIdsToFilteringValues: {},
};
function formFixture(projection = {}) {
    const loaded = fixtures.makeForm({
        childExtensionInfo: { accessType: { type: 'create' } },
    });
    loaded.payload.fieldIdsInForm.push('fld_parent');
    const schema = loaded.payload.fieldIdsToSchemas.fld_parent;
    schema.airtableField = complete(schema.airtableField);
    schema.airtableField.config.options.linkedTableId = 'tbl_children';
    schema.airtableField.config.options.prefersSingleRecordLink = false;
    schema.miniExtConfig = {};
    loaded.payload.formRecord.data.fld_parent = [
        'rec_one',
        'rec_missing',
        'rec_one',
    ];
    loaded.payload.linkedRecordFieldIdToDetailFields = projection;
    return loaded;
}

/** Installed SDK only; all transports below are local synthetic promises. */
export async function checkLinkedRecordsConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const base = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk/dist/esm'
    );
    const esm = Object.fromEntries(
        await Promise.all(
            ['ui', 'forms', 'portals'].map(async (entry) => [
                entry,
                await import(pathToFileURL(join(base, entry, 'index.js'))),
            ])
        )
    );
    const cjs = Object.fromEntries(
        ['ui', 'forms', 'portals'].map((entry) => [
            entry,
            require(`@miniextensions/sdk/${entry}`),
        ])
    );
    let checks = 0;
    for (const api of [esm, cjs]) {
        let session = { visitor: 'synthetic' },
            current = true,
            configuration = 0;
        let optionCalls = 0,
            selectedCalls = 0,
            portalCalls = 0;
        let optionsHandler = async () => optionPage([row('rec_one')], 'next');
        let selectedHandler = async () => ({
            tbl_children: table([row('rec_one', 'Hydrated')]),
        });
        let portalHandler = async () =>
            fixtures.page([row('rec_one')], null, {
                tableIdsToLinkedTableStates: {
                    tbl_children: table([row('rec_one')]),
                },
            });
        const client = {
            getSession: () => ({ ...session }),
            linkedRecords: {
                listFormOptions: async (...args) => {
                    optionCalls++;
                    return optionsHandler(...args);
                },
                loadSelectedRecords: async (...args) => {
                    selectedCalls++;
                    return selectedHandler(...args);
                },
            },
            portals: {
                listLinkedRecords: async (...args) => {
                    portalCalls++;
                    return portalHandler(...args);
                },
            },
        };
        const resources = [];
        const makeFields = (
            loaded = formFixture(),
            receivingClient = client
        ) => {
            const owner = api.forms.createFormFieldBindings({
                loaded,
                client: receivingClient,
                getScope: () => ({ ownerId: 'synthetic', revision: 0 }),
                isCurrent: () => current,
                configurationRevision: () => configuration,
                saveOptions,
            });
            resources.push(() => owner.destroy());
            return owner;
        };
        const loader = () =>
            api.ui.createFormLinkedRecordLoader({
                client,
                input: {
                    extensionAccessToken: 'child_access_example',
                    linkedRecordFieldId: 'fld_parent',
                },
                linkedTableId: 'tbl_children',
            });
        try {
            const model = api.ui.createSelectionModel({
                multiple: true,
                loadOptions: loader(),
            });
            resources.push(() => model.destroy());
            assert.equal(model.getState().linkedRecords, undefined);
            await model.reload();
            assert.deepEqual(model.getState().linkedRecords.records, [
                row('rec_one'),
            ]);
            const detached = model.getState();
            detached.linkedRecords.records[0].fields.fld_title = 'mutated';
            assert.equal(
                model.getState().linkedRecords.records[0].fields.fld_title,
                'rec_one'
            );
            optionsHandler = async () => optionPage([row('rec_two')]);
            await model.loadMore();
            assert.deepEqual(
                model.getState().linkedRecords.records.map((r) => r.id),
                ['rec_one', 'rec_two']
            );
            const paged = api.ui.createSelectionModel({
                multiple: true,
                loadOptions: loader(),
            });
            resources.push(() => paged.destroy());
            optionsHandler = async () => optionPage([row('rec_m1')], 'more');
            await paged.reload();
            optionsHandler = async () =>
                optionPage(
                    [row('rec_m2')],
                    null,
                    physical.map((field) => ({
                        ...field,
                        name: `${field.name} changed`,
                    }))
                );
            await paged.loadMore();
            assert.deepEqual(
                paged
                    .getState()
                    .linkedRecords.records.map((record) => record.id),
                ['rec_m1', 'rec_m2']
            );
            assert.equal(paged.getState().linkedRecords.table, null);
            paged.choose(['rec_m1', 'rec_m2']);
            assert.deepEqual(paged.getState().value, ['rec_m1', 'rec_m2']);
            optionsHandler = async () => optionPage([], 'more', []);
            await paged.setSearchTerm('empty first');
            optionsHandler = async () => optionPage([row('rec_after_empty')]);
            await paged.loadMore();
            assert.deepEqual(
                paged.getState().linkedRecords.table.airtableFields,
                physical,
                'Unused empty first-page metadata does not override subsequent record source'
            );
            assert.deepEqual(paged.getState().value, ['rec_m1', 'rec_m2']);
            optionsHandler = async () => ({
                records: [row('rec_no_metadata')],
                offset: null,
                tableIdsToLinkedTableStates: {},
                linkedRecordFieldIdToDetailFields: null,
            });
            await model.setSearchTerm('missing metadata');
            assert.equal(model.getState().linkedRecords.table, null);
            assert.equal(model.getState().options[0].label, 'rec_no_metadata');
            const plain = api.ui.createSelectionModel({
                loadOptions: async () => ({
                    options: [{ value: 'rec_plain', label: 'Plain' }],
                    offset: null,
                    linkedRecords: {
                        linkedTableId: 'tbl_children',
                        records: [row('rec_injected')],
                        table: { airtableFields: physical },
                    },
                }),
            });
            resources.push(() => plain.destroy());
            await plain.reload();
            assert.equal(
                plain.getState().linkedRecords,
                undefined,
                'Unaccepted loader payload cannot mint rich-record provenance'
            );
            checks++;

            const held = fixtures.deferred();
            optionsHandler = () => held.promise;
            const old = model.setSearchTerm('old');
            await tick();
            optionsHandler = async () => optionPage([row('rec_new')], null, []);
            await model.setSearchTerm('new');
            held.resolve(optionPage([row('rec_old')]));
            await old;
            assert.deepEqual(
                model.getState().linkedRecords.records.map((r) => r.id),
                ['rec_new']
            );
            assert.deepEqual(
                model.getState().linkedRecords.table.airtableFields,
                []
            );
            model.setSearchInput('typing');
            assert.equal(model.getState().linkedRecords, undefined);
            const visitorHeld = fixtures.deferred();
            optionsHandler = () => visitorHeld.promise;
            const staleVisitorRead = model.reload();
            await tick();
            session = { visitor: 'other' };
            visitorHeld.resolve(optionPage([row('rec_wrong_visitor')]));
            await staleVisitorRead;
            assert.equal(model.getState().linkedRecords, undefined);
            assert.deepEqual(model.getState().options, []);
            session = { visitor: 'synthetic' };
            optionsHandler = async () =>
                optionPage([row('rec_cached_visitor')]);
            const capturedPage = await loader()({
                searchTerm: '',
                offset: null,
                signal: new AbortController().signal,
            });
            session = { visitor: 'replacement' };
            const replay = api.ui.createSelectionModel({
                loadOptions: async () => capturedPage,
            });
            resources.push(() => replay.destroy());
            await replay.reload();
            assert.equal(
                replay.getState().linkedRecords,
                undefined,
                'A stale SDK page replay cannot publish rich rows'
            );
            session = { visitor: 'synthetic' };
            checks++;

            const fields = makeFields();
            const facet = fields.linkedRecords('fld_parent');
            assert.equal(selectedCalls, 0);
            assert.deepEqual(facet.getSnapshot().unresolvedSelectedIds, [
                'rec_one',
                'rec_missing',
                'rec_one',
            ]);
            assert.equal(await facet.readSelected(), true);
            assert.deepEqual(
                facet.getSnapshot().selectedRecords.map((r) => r.id),
                ['rec_one', 'rec_one']
            );
            assert.deepEqual(facet.getSnapshot().unresolvedSelectedIds, [
                'rec_missing',
            ]);
            const snapshot = facet.getSnapshot();
            snapshot.selectedRecords[0].fields.fld_title = 'changed';
            assert.equal(
                facet.getSnapshot().selectedRecords[0].fields.fld_title,
                'Hydrated'
            );
            assert.deepEqual(fields.field('fld_parent').getSnapshot().value, [
                'rec_one',
                'rec_missing',
                'rec_one',
            ]);
            optionsHandler = async () => optionPage([row('rec_wrong_field')]);
            for (const input of [
                {
                    extensionAccessToken: 'child_access_example',
                    linkedRecordFieldId: 'fld_foreign',
                },
                {
                    extensionAccessToken: 'foreign_token',
                    linkedRecordFieldId: 'fld_parent',
                },
            ]) {
                const foreignFields = makeFields();
                foreignFields.setLinkedLoader(
                    'fld_parent',
                    api.ui.createFormLinkedRecordLoader({
                        client,
                        input,
                        linkedTableId: 'tbl_children',
                    })
                );
                await foreignFields.field('fld_parent').selection.reload();
                assert.deepEqual(
                    foreignFields.linkedRecords('fld_parent').getSnapshot()
                        .candidateRecords,
                    [],
                    'Foreign field/token loader cannot publish rich source data'
                );
                assert.equal(
                    foreignFields.field('fld_parent').selection.getState()
                        .options[0].value,
                    'rec_wrong_field'
                );
            }
            optionsHandler = async () =>
                optionPage([row('rec_foreign_client')]);
            const sameFieldPageLoader = loader();
            const sameFieldPage = await sameFieldPageLoader({
                searchTerm: '',
                offset: null,
                signal: new AbortController().signal,
            });
            for (const visitor of ['synthetic', 'another']) {
                const receivingClient = {
                    ...client,
                    getSession: () => ({ visitor }),
                };
                const receivingFields = makeFields(
                    formFixture(),
                    receivingClient
                );
                assert.equal(
                    sameFieldPageLoader.isCurrent(),
                    true,
                    'The producing client is still current'
                );
                receivingFields.setLinkedLoader(
                    'fld_parent',
                    async () => sameFieldPage
                );
                const receivingBinding = receivingFields.field('fld_parent');
                await receivingBinding.selection.reload();
                assert.equal(
                    receivingBinding.selection.getState().linkedRecords,
                    undefined
                );
                assert.deepEqual(
                    receivingFields.linkedRecords('fld_parent').getSnapshot()
                        .candidateRecords,
                    []
                );
                assert.equal(
                    receivingBinding.setValue(['rec_foreign_client']).accepted,
                    true
                );
                assert.deepEqual(
                    receivingFields.linkedRecords('fld_parent').getSnapshot()
                        .selectedRecords,
                    []
                );
                assert.deepEqual(
                    receivingFields.linkedRecords('fld_parent').getSnapshot()
                        .unresolvedSelectedIds,
                    ['rec_foreign_client']
                );
            }
            const candidateFields = makeFields();
            optionsHandler = async () =>
                optionPage([row('rec_candidate', 'Candidate detail')]);
            candidateFields.setLinkedLoader('fld_parent', loader());
            const candidateFacet = candidateFields.linkedRecords('fld_parent');
            const candidateSelection =
                candidateFields.field('fld_parent').selection;
            await candidateSelection.reload();
            assert.deepEqual(candidateFacet.getSnapshot().candidateRecords, [
                row('rec_candidate', 'Candidate detail'),
            ]);
            candidateSelection.choose(['rec_candidate']);
            assert.deepEqual(
                candidateFields.field('fld_parent').getSnapshot().value,
                ['rec_candidate']
            );
            assert.deepEqual(candidateFacet.getSnapshot().selectedRecords, [
                row('rec_candidate', 'Candidate detail'),
            ]);
            assert.equal(
                candidateFields.field('fld_parent').getSnapshot().dirty,
                true
            );
            for (const observer of ['never-mounted', 'unmounted']) {
                const retainedFields = makeFields();
                retainedFields.setLinkedLoader('fld_parent', loader());
                const retainedFacet =
                    retainedFields.linkedRecords('fld_parent');
                if (observer === 'unmounted')
                    retainedFacet.subscribe(() => {})();
                const selection = retainedFields.field('fld_parent').selection;
                await selection.reload();
                selection.choose(['rec_candidate']);
                selection.setSearchInput('next query');
                assert.deepEqual(
                    retainedFacet.getSnapshot().selectedRecords,
                    [row('rec_candidate', 'Candidate detail')],
                    `${observer}: selected rich data survives candidate-query retirement without a snapshot read`
                );
                assert.deepEqual(
                    retainedFields.field('fld_parent').getSnapshot().value,
                    ['rec_candidate']
                );
                retainedFields.destroy();
                assert.equal(retainedFacet.getSnapshot().phase, 'retired');
                assert.deepEqual(
                    retainedFacet.getSnapshot().selectedRecords,
                    []
                );
            }
            for (const replacement of ['loader', 'static']) {
                const replacedFields = makeFields();
                const oldFacet = replacedFields.linkedRecords('fld_parent');
                let installed = false;
                const newer = [{ value: 'rec_c', label: 'Newer C' }];
                oldFacet.subscribe((state) => {
                    if (state.phase !== 'retired' || installed) return;
                    installed = true;
                    if (replacement === 'loader')
                        replacedFields.setLinkedLoader(
                            'fld_parent',
                            async () => ({ options: newer, offset: null })
                        );
                    else replacedFields.setLinkedOptions('fld_parent', newer);
                });
                if (replacement === 'loader') {
                    replacedFields.setLinkedLoader('fld_parent', async () => ({
                        options: [{ value: 'rec_b', label: 'Older B' }],
                        offset: null,
                    }));
                    await replacedFields.field('fld_parent').selection.reload();
                } else
                    replacedFields.setLinkedOptions('fld_parent', [
                        { value: 'rec_b', label: 'Older B' },
                    ]);
                assert.equal(installed, true);
                assert.deepEqual(
                    replacedFields.field('fld_parent').selection.getState()
                        .options,
                    newer,
                    'Reentrant newer replacement wins over interrupted older replacement'
                );
            }
            const staticFields = makeFields();
            const oldStaticRead = fixtures.deferred();
            let oldSignal,
                oldDispatches = 0;
            staticFields.setLinkedLoader('fld_parent', (request) => {
                oldDispatches++;
                oldSignal = request.signal;
                return oldStaticRead.promise;
            });
            const staticSelection = staticFields.field('fld_parent').selection;
            const oldStaticFlight = staticSelection.reload();
            await tick();
            const staticNative = structuredClone(
                staticFields.field('fld_parent').getSnapshot().value
            );
            const staticOptions = [
                { value: 'rec_static_c', label: 'Static C' },
            ];
            staticFields.setLinkedOptions('fld_parent', staticOptions);
            assert.equal(oldSignal.aborted, true);
            assert.deepEqual(staticSelection.getState().options, staticOptions);
            assert.deepEqual(
                staticFields.field('fld_parent').getSnapshot().value,
                staticNative
            );
            oldStaticRead.resolve({
                options: [{ value: 'rec_old', label: 'Old' }],
                offset: null,
            });
            await oldStaticFlight;
            assert.deepEqual(staticSelection.getState().options, staticOptions);
            assert.deepEqual(
                staticFields.field('fld_parent').getSnapshot().value,
                staticNative
            );
            assert.equal(
                oldDispatches,
                1,
                'Static replacement performs no automatic read or save'
            );
            const emptyOriginal = formFixture();
            emptyOriginal.payload.formRecord.data.fld_parent = [];
            const emptyFields = makeFields(emptyOriginal);
            emptyFields.setLinkedLoader('fld_parent', loader());
            const emptyFacet = emptyFields.linkedRecords('fld_parent');
            selectedHandler = async () => ({ tbl_children: table([], []) });
            assert.equal(await emptyFacet.readSelected(), true);
            optionsHandler = async () => optionPage([row('rec_metadata')]);
            await emptyFields.field('fld_parent').selection.reload();
            assert.deepEqual(
                emptyFacet.getSnapshot().table.airtableFields,
                physical,
                'Empty original hydration cannot override returned candidate metadata'
            );

            const metadataM2 = physical.map((field) => ({
                ...field,
                name: `${field.name} changed`,
            }));
            const mixedFields = makeFields();
            mixedFields.setLinkedLoader('fld_parent', loader());
            const mixedFacet = mixedFields.linkedRecords('fld_parent');
            selectedHandler = async () => ({
                tbl_children: table([row('rec_one', 'M1 selected')]),
            });
            assert.equal(await mixedFacet.readSelected(), true);
            optionsHandler = async () =>
                optionPage([row('rec_m2', 'M2 candidate')], null, metadataM2);
            await mixedFields.field('fld_parent').selection.reload();
            assert.deepEqual(
                mixedFacet
                    .getSnapshot()
                    .selectedRecords.map((record) => record.fields.fld_title),
                ['M1 selected', 'M1 selected']
            );
            assert.equal(
                mixedFacet.getSnapshot().table,
                null,
                'Conflicting selected and candidate source metadata cannot be paired'
            );

            const retainedMetadataFields = makeFields(emptyOriginal);
            retainedMetadataFields.setLinkedLoader('fld_parent', loader());
            const retainedMetadataFacet =
                retainedMetadataFields.linkedRecords('fld_parent');
            const retainedMetadataSelection =
                retainedMetadataFields.field('fld_parent').selection;
            optionsHandler = async () =>
                optionPage([row('rec_m1', 'M1 retained')]);
            await retainedMetadataSelection.reload();
            retainedMetadataSelection.choose(['rec_m1']);
            optionsHandler = async () =>
                optionPage([row('rec_m2', 'M2 search')], null, metadataM2);
            await retainedMetadataSelection.setSearchTerm('M2');
            assert.deepEqual(
                retainedMetadataFacet.getSnapshot().selectedRecords,
                [row('rec_m1', 'M1 retained')]
            );
            assert.equal(
                retainedMetadataFacet.getSnapshot().table,
                null,
                'A later search cannot relabel a retained selected record with unrelated source metadata'
            );
            assert.deepEqual(
                retainedMetadataFields.field('fld_parent').getSnapshot().value,
                ['rec_m1']
            );
            selectedHandler = async () => ({
                tbl_children: table([row('rec_one', 'Hydrated')]),
            });
            checks++;

            for (const [projection, expected] of [
                [null, 'null'],
                [{}, 'missing'],
                [{ fld_parent: null }, 'null'],
                [{ fld_parent: [] }, 'present'],
            ]) {
                const projected = makeFields(formFixture(projection))
                    .linkedRecords('fld_parent')
                    .getSnapshot();
                assert.equal(projected.detailProjection, expected);
                assert.deepEqual(
                    projected.detailFields,
                    expected === 'present' ? [] : null
                );
            }
            const unsupported = formFixture();
            unsupported.payload.fieldIdsToSchemas.fld_parent.miniExtConfig = {
                sortFields: [{ fieldId: 'fld_title', direction: 'asc' }],
            };
            const policy = makeFields(unsupported).linkedRecords('fld_parent');
            await policy.readSelected();
            assert.equal(policy.getSnapshot().selectedPolicy.supported, false);
            assert.deepEqual(policy.getSnapshot().selectedPolicy.reasons, [
                'selected-sort',
            ]);
            assert.deepEqual(policy.getSnapshot().selectedRecords, []);
            selectedHandler = async () => ({
                tbl_children: table([row('rec_one')]),
                tbl_foreign: table([row('rec_one', 'Foreign')]),
            });
            const conflictFields = makeFields();
            const conflictFacet = conflictFields.linkedRecords('fld_parent');
            const conflictCalls = selectedCalls;
            assert.equal(await conflictFacet.readSelected(), false);
            assert.equal(conflictFacet.getSnapshot().phase, 'error');
            assert.equal(typeof conflictFacet.getSnapshot().error, 'string');
            assert.deepEqual(conflictFacet.getSnapshot().selectedRecords, []);
            assert.equal(conflictFacet.getSnapshot().table, null);
            assert.deepEqual(
                conflictFields.field('fld_parent').getSnapshot().value,
                ['rec_one', 'rec_missing', 'rec_one']
            );
            await tick();
            conflictFacet.getSnapshot();
            assert.equal(
                selectedCalls,
                conflictCalls + 1,
                'Snapshot reads never retry conflicting hydration'
            );
            checks++;

            const pending = fixtures.deferred();
            selectedHandler = () => pending.promise;
            const pendingFacet = makeFields().linkedRecords('fld_parent');
            const before = selectedCalls;
            const read = pendingFacet.readSelected();
            const duplicate = pendingFacet.readSelected();
            await tick();
            assert.equal(selectedCalls, before + 1);
            configuration++;
            pending.resolve({ tbl_children: table([row('rec_one', 'Stale')]) });
            assert.equal(await read, false);
            assert.equal(await duplicate, false);
            assert.equal(pendingFacet.getSnapshot().phase, 'retired');
            assert.equal(await pendingFacet.readSelected(), false);
            assert.equal(selectedCalls, before + 1);
            checks++;

            const portal = fixtures.makePortal();
            const owner = api.portals.createPortalListOwner({
                client,
                portal,
                portalFieldId: 'fld_children',
                criteria: {
                    selectedCustomViewId: 'view_example',
                    sortFieldsByEndUser: null,
                    supportsEndUserSortCleanup: true,
                    filtersByEndUser: null,
                    supportsEndUserFilterCleanup: true,
                    searchParamsMap: {},
                    searchTerm: null,
                },
                getScope: () => ({ ownerId: 'synthetic', revision: 0 }),
                isCurrent: () => current,
                configurationRevision: () => configuration,
            });
            resources.push(() => owner.destroy());
            assert.equal(owner.getRecords(owner.getSnapshot().revision), null);
            assert.equal(
                await owner.readFirst(owner.getSnapshot().revision, {
                    pagesToFetch: 1,
                    refreshLoggedInPortalRecord: false,
                }),
                true
            );
            const revision = owner.getSnapshot().revision;
            const accepted = owner.getRecords(revision);
            assert.deepEqual(accepted.records, [row('rec_one')]);
            assert.equal(accepted.detailProjection, 'null');
            accepted.records[0].fields.fld_title = 'mutated';
            assert.equal(
                owner.getRecords(revision).records[0].fields.fld_title,
                'rec_one'
            );
            assert.equal(owner.getRecords(revision - 1), null);
            session = { visitor: 'replacement' };
            assert.equal(owner.getRecords(revision), null);
            assert.equal(portalCalls, 1);
            assert.ok(optionCalls >= 3);
            checks++;
        } finally {
            resources.reverse().forEach((dispose) => dispose());
        }
    }
    return {
        checks,
        proof: 'synthetic installed ESM/CJS rich linked-record owners; no live API or browser claim',
    };
}
