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
