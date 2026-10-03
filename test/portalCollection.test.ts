import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    AirtableFieldType,
    SDKError,
    type ListPortalLinkedRecordsResult,
    type RuntimeAirtableField,
    type RuntimeLinkedRecordDetailField,
    type RuntimeLinkedRecordDetailFields,
} from '../src/runtime/index.js';
import {
    createPortalCollection,
    PortalCollectionError,
    type PortalCollectionCriteria,
    type PortalCollectionOptions,
    type PortalReadOutcome,
} from '../src/portals/index.js';
import {
    deferredPortal,
    portalFixture,
    portalListPage,
    portalPage,
    type PortalReadCall,
} from './portalFixtures.js';

const criteria = (): PortalCollectionCriteria => ({
    selectedCustomViewId: 'view_example',
    searchTerm: 'Exact Search',
    searchParamsMap: { fld_title: 'Title search', fld_other: '' },
    sortFieldsByEndUser: [
        { idOrName: { type: 'id', id: 'fld_title' }, type: 'desc' },
        { idOrName: { type: 'name', name: 'Other' }, type: 'asc' },
    ],
    filtersByEndUser: {
        logicalOperator: 'and',
        conditions: [
            {
                id: 'condition_example',
                type: 'singleCondition',
                setting: {
                    type: 'contains',
                    idOrName: { type: 'id', id: 'fld_title' },
                    fieldType: AirtableFieldType.SINGLE_LINE_TEXT,
                    value: 'Exact filter',
                },
            },
        ],
    },
    supportsEndUserSortCleanup: true,
    supportsEndUserFilterCleanup: true,
    calendarLayoutFilter: {
        monthToFetchRecordsFor: '2026-10',
        clientUtcOffset: -300,
        clientTimeZone: 'America/New_York',
    },
});
const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: true };
const titleField: RuntimeAirtableField = {
    id: 'fld_title',
    name: 'Title',
    description: null,
    isComputed: false,
    isPrimaryField: true,
    config: { type: AirtableFieldType.SINGLE_LINE_TEXT, options: null },
};
const detail = (fieldId = 'fld_title'): RuntimeLinkedRecordDetailField => ({
    fieldId,
    fieldName: 'Title',
    titleOverride: null,
    isHidden: false,
    fieldIsInEditingChildForm: true,
    childFormField: null,
    miniExtConfig: {},
});
const rows = (
    recordIds = ['record_first'],
    offset: string | null = null
): ListPortalLinkedRecordsResult =>
    portalListPage({
        recordIds,
        airtableOffset: offset,
        tableIdsToLinkedTableStates: {
            table_children: {
                airtableFields: [titleField],
                recordIdsToAirtableRecords: Object.fromEntries(
                    recordIds.map((id) => [
                        id,
                        { id, fields: { fld_title: id, fld_old: 'Old value' } },
                    ])
                ),
            },
        },
    });
const loaded = (outcome: PortalReadOutcome | null) => {
    assert.ok(outcome);
    assert.equal(outcome.type, 'loaded');
    if (outcome.type !== 'loaded') throw new Error('Expected loaded fixture.');
    return outcome.snapshot;
};
const setup = (
    read?: (call: PortalReadCall) => Promise<ListPortalLinkedRecordsResult>,
    overrides: Partial<Omit<PortalCollectionOptions, 'client'>> = {}
) => {
    const fixture = portalFixture(read);
    const scope = { ownerId: 'visitor_A', revision: 1 };
    const options: PortalCollectionOptions = {
        client: fixture.client,
        portal: portalPage(),
        portalFieldId: 'fld_children',
        criteria: criteria(),
        getScope: () => scope,
        ...overrides,
    };
    return {
        ...fixture,
        fixture,
        scope,
        options,
        collection: createPortalCollection(options),
    };
};
const createRequest = {
    access: { type: 'create' as const },
    configuredChildExtensionId: 'extension_child',
};
const editRequest = (recordId: string) => ({
    access: { type: 'edit' as const, recordId },
    configuredChildExtensionId: 'extension_child',
});

describe('optional Portal collections', () => {
    it('rejects mismatched returned field/view metadata and credentials in criteria before dispatch', () => {
        const fixture = portalFixture();
        const options = {
            client: fixture.client,
            portal: portalPage(),
            portalFieldId: 'fld_children',
            criteria: criteria(),
            getScope: () => ({ ownerId: 'visitor_A', revision: 1 }),
        };
        assert.throws(
            () =>
                createPortalCollection({
                    ...options,
                    portalFieldId: 'fld_not_returned',
                }),
            TypeError
        );
        assert.throws(
            () =>
                createPortalCollection({
                    ...options,
                    criteria: {
                        ...criteria(),
                        selectedCustomViewId: 'unconfigured_view',
                    },
                }),
            TypeError
        );
        assert.throws(
            () =>
                createPortalCollection({
                    ...options,
                    criteria: {
                        ...criteria(),
                        extensionAccessToken: 'accidental_token',
                    } as PortalCollectionCriteria,
                }),
            TypeError
        );
        assert.throws(
            () =>
                createPortalCollection({
                    ...options,
                    getScope: () => ({ ownerId: 'visitor_A', revision: -1 }),
                }),
            TypeError
        );
        assert.equal(fixture.calls.length, 0);
        assert.equal(fixture.mutations, 0);
    });

    it('preserves the empty legacy selected-view ID when no custom views were returned', async () => {
        const s = setup(async () => rows(), {
            portal: portalPage({ customViews: [] }),
            criteria: { ...criteria(), selectedCustomViewId: '' },
        });
        await s.collection.readFirst(readOptions);
        assert.equal(s.calls[0].input.selectedCustomViewId, '');
    });

    it('does not return current when an application scope getter retires the collection reentrantly', () => {
        let retireDuringCheck = false;
        let collection: ReturnType<typeof createPortalCollection> | null = null;
        const fixture = portalFixture();
        collection = createPortalCollection({
            client: fixture.client,
            portal: portalPage(),
            portalFieldId: 'fld_children',
            criteria: criteria(),
            getScope: () => {
                if (retireDuringCheck) collection!.destroy();
                return { ownerId: 'visitor_A', revision: 1 };
            },
        });
        const plan = collection.childFormRequest(createRequest);
        retireDuringCheck = true;
        assert.equal(collection.isCurrent(), false);
        assert.equal(plan.isCurrent(), false);
        assert.equal(collection.getSnapshot(), null);
        assert.equal(fixture.calls.length, 0);
    });

    it('rejects malformed page data without committing or automatically retrying it', async () => {
        const page = rows();
        page.tableIdsToLinkedTableStates.table_children.recordIdsToAirtableRecords.record_first.id =
            'wrong_record';
        const s = setup(async () => page);
        await assert.rejects(s.collection.readFirst(readOptions), TypeError);
        assert.equal(s.collection.getSnapshot(), null);
        assert.throws(
            () => s.collection.childFormRequest(createRequest),
            PortalCollectionError
        );
        assert.equal(s.calls.length, 1);
        assert.equal(s.fixture.mutations, 0);
    });

    it('forwards the complete copied criteria and explicit read options without mutations', async () => {
        const originalCriteria = criteria();
        const originalPortal = portalPage();
        const s = setup(async () => rows(), {
            criteria: originalCriteria,
            portal: originalPortal,
        });
        const expected = structuredClone(originalCriteria);
        originalCriteria.searchTerm = 'Changed';
        originalCriteria.searchParamsMap.fld_title = 'Changed';
        originalCriteria.sortFieldsByEndUser!.reverse();
        originalPortal.payload.extensionAccessToken = 'changed_token';
        await s.collection.readFirst({
            pagesToFetch: null,
            refreshLoggedInPortalRecord: false,
        });
        assert.deepEqual(s.calls[0].input, {
            ...expected,
            extensionAccessToken: 'portal_access_example',
            portalFieldId: 'fld_children',
            alreadyLoadedRecordIds: [],
            airtableOffset: null,
            pagesToFetch: null,
            refreshLoggedInPortalRecord: false,
        });
        assert.equal(s.fixture.mutations, 0);
        assert.equal(
            s.collection.criteriaKey.includes('portal_access_example'),
            false
        );
        assert.equal(s.collection.criteriaKey.includes('visitor_A'), false);
    });

    it('keys object order consistently but preserves search and sort-array meaning', () => {
        const one = setup();
        const two = setup(undefined, {
            criteria: {
                ...criteria(),
                searchParamsMap: { fld_other: '', fld_title: 'Title search' },
            },
        });
        assert.equal(one.collection.criteriaKey, two.collection.criteriaKey);
        const changed = criteria();
        changed.searchTerm = 'exact search';
        assert.notEqual(
            one.collection.criteriaKey,
            setup(undefined, { criteria: changed }).collection.criteriaKey
        );
        changed.searchTerm = 'Exact Search';
        changed.sortFieldsByEndUser!.reverse();
        assert.notEqual(
            one.collection.criteriaKey,
            setup(undefined, { criteria: changed }).collection.criteriaKey
        );
    });

    it('deduplicates ordered page IDs and replaces incoming records and schema arrays wholesale', async () => {
        const first = rows(['record_first', 'record_second'], 'cursor_next');
        first.tableIdsToLinkedTableStates.table_nested = {
            airtableFields: [titleField],
            recordIdsToAirtableRecords: {
                nested: { id: 'nested', fields: { fld_title: 'Nested label' } },
            },
        };
        const next = rows(['record_second', 'record_third', 'record_second']);
        next.tableIdsToLinkedTableStates.table_children.airtableFields = [];
        next.tableIdsToLinkedTableStates.table_children.recordIdsToAirtableRecords.record_second.fields =
            {};
        const returned = [first, next];
        const s = setup(async () => returned.shift()!);
        await s.collection.readFirst(readOptions);
        const snapshot = loaded(
            await s.collection.readNext({
                pagesToFetch: 2,
                refreshLoggedInPortalRecord: false,
            })
        );
        assert.deepEqual(snapshot.recordIds, [
            'record_first',
            'record_second',
            'record_third',
        ]);
        assert.deepEqual(
            snapshot.tableIdsToLinkedTableStates.table_children.airtableFields,
            []
        );
        assert.deepEqual(
            snapshot.tableIdsToLinkedTableStates.table_children
                .recordIdsToAirtableRecords.record_second.fields,
            {}
        );
        assert.deepEqual(
            snapshot.tableIdsToLinkedTableStates.table_children
                .recordIdsToAirtableRecords.record_first.fields,
            { fld_title: 'record_first', fld_old: 'Old value' }
        );
        assert.equal(
            snapshot.tableIdsToLinkedTableStates.table_nested
                .recordIdsToAirtableRecords.nested.fields.fld_title,
            'Nested label'
        );
        assert.deepEqual(s.calls[1].input.alreadyLoadedRecordIds, [
            'record_first',
            'record_second',
        ]);
        assert.equal(s.calls[1].input.airtableOffset, 'cursor_next');
        assert.equal(s.calls[1].input.pagesToFetch, 2);
        assert.deepEqual(next.recordIds, [
            'record_second',
            'record_third',
            'record_second',
        ]);
        assert.equal(
            Object.hasOwn(next.tableIdsToLinkedTableStates, 'table_nested'),
            false
        );
        snapshot.recordIds.length = 0;
        snapshot.tableIdsToLinkedTableStates.table_children.recordIdsToAirtableRecords.record_first.fields.fld_title =
            'Changed externally';
        assert.deepEqual(s.collection.getSnapshot()?.recordIds, [
            'record_first',
            'record_second',
            'record_third',
        ]);
        assert.equal(
            s.collection.getSnapshot()?.tableIdsToLinkedTableStates
                .table_children.recordIdsToAirtableRecords.record_first.fields
                .fld_title,
            'record_first'
        );
    });

    it('handles empty pages with opaque empty cursors and stops exactly at null', async () => {
        const returned = [rows([], ''), rows([], 'another_cursor'), rows([])];
        const s = setup(async () => returned.shift()!);
        await assert.rejects(
            s.collection.readNext(readOptions),
            PortalCollectionError
        );
        assert.equal(s.calls.length, 0);
        await s.collection.readFirst(readOptions);
        await s.collection.readNext(readOptions);
        assert.equal(s.calls[1].input.airtableOffset, '');
        await s.collection.readNext(readOptions);
        assert.equal(s.calls[2].input.airtableOffset, 'another_cursor');
        assert.equal(await s.collection.readNext(readOptions), null);
        assert.equal(s.calls.length, 3);
        assert.deepEqual(s.collection.getSnapshot()?.recordIds, []);
    });

    it('clears all prior rows, nested maps and child plans when a fresh first read dispatches', async () => {
        const pending = deferredPortal<ListPortalLinkedRecordsResult>();
        const first = rows(['record_old'], 'cursor_old');
        first.tableIdsToLinkedTableStates.table_nested = {
            airtableFields: [],
            recordIdsToAirtableRecords: {},
        };
        let calls = 0;
        const s = setup(async () => (++calls === 1 ? first : pending.promise));
        await s.collection.readFirst(readOptions);
        const plan = s.collection.childFormRequest(editRequest('record_old'));
        const reread = s.collection.readFirst(readOptions);
        assert.equal(s.collection.getSnapshot(), null);
        assert.equal(plan.isCurrent(), false);
        assert.throws(
            () => s.collection.childFormRequest(editRequest('record_old')),
            PortalCollectionError
        );
        pending.resolve(rows(['record_new']));
        const snapshot = loaded(await reread);
        assert.deepEqual(snapshot.recordIds, ['record_new']);
        assert.equal(
            Object.hasOwn(snapshot.tableIdsToLinkedTableStates, 'table_nested'),
            false
        );
        assert.deepEqual(s.calls[1].input.alreadyLoadedRecordIds, []);
        assert.equal(s.calls[1].input.airtableOffset, null);
        assert.throws(
            () => s.collection.childFormRequest(editRequest('record_old')),
            PortalCollectionError
        );
    });

    it('does not revive the old first-read state when a dispatched reread fails', async () => {
        const failure = new SDKError('Synthetic read failure', {
            kind: 'api',
            code: 'fixture_error',
        });
        let calls = 0;
        const s = setup(async () => {
            if (++calls === 1) return rows(['record_old'], 'cursor_old');
            throw failure;
        });
        await s.collection.readFirst(readOptions);
        await assert.rejects(
            s.collection.readFirst(readOptions),
            (error) => error === failure
        );
        assert.equal(s.collection.getSnapshot(), null);
        assert.throws(
            () => s.collection.childFormRequest(createRequest),
            PortalCollectionError
        );
        await assert.rejects(
            s.collection.readNext(readOptions),
            PortalCollectionError
        );
        assert.equal(s.calls.length, 2);
    });

    it('surfaces both canonical cleanup replacements and requires explicit acceptance in a new instance', async () => {
        const cleanup = portalListPage({
            endUserSortCleanup: { sortFields: [] },
            endUserFilterCleanup: { filters: null },
        });
        const s = setup(async () => cleanup);
        const outcome = await s.collection.readFirst(readOptions);
        assert.equal(outcome.type, 'criteria-cleanup-required');
        assert.deepEqual(outcome.raw, cleanup);
        assert.equal(s.collection.isCurrent(), true);
        assert.equal(s.collection.getSnapshot(), null);
        assert.throws(
            () => s.collection.childFormRequest(createRequest),
            PortalCollectionError
        );
        await assert.rejects(
            s.collection.readNext(readOptions),
            PortalCollectionError
        );
        await assert.rejects(
            s.collection.readFirst(readOptions),
            PortalCollectionError
        );
        assert.equal(s.calls.length, 1);
        s.collection.destroy();
        const accepted = criteria();
        accepted.sortFieldsByEndUser =
            outcome.raw.endUserSortCleanup!.sortFields;
        accepted.filtersByEndUser = outcome.raw.endUserFilterCleanup!.filters;
        s.client.portals.listLinkedRecords = async (input) => {
            assert.deepEqual(input.sortFieldsByEndUser, []);
            assert.equal(input.filtersByEndUser, null);
            return rows(['record_after_acceptance']);
        };
        const replacement = createPortalCollection({
            ...s.options,
            criteria: accepted,
        });
        assert.deepEqual(
            loaded(await replacement.readFirst(readOptions)).recordIds,
            ['record_after_acceptance']
        );
        assert.equal(s.fixture.mutations, 0);
    });

    it('clears accepted rows and edit eligibility on cleanup during next page', async () => {
        let calls = 0;
        const s = setup(async () =>
            ++calls === 1
                ? rows(['record_first'], 'cursor')
                : portalListPage({ endUserFilterCleanup: { filters: null } })
        );
        await s.collection.readFirst(readOptions);
        const plan = s.collection.childFormRequest(editRequest('record_first'));
        const cleanup = await s.collection.readNext(readOptions);
        assert.equal(cleanup?.type, 'criteria-cleanup-required');
        assert.equal(s.collection.getSnapshot(), null);
        assert.equal(plan.isCurrent(), false);
        assert.throws(
            () => s.collection.childFormRequest(editRequest('record_first')),
            PortalCollectionError
        );
    });

    for (const map of [
        {},
        { fld_children: [] },
    ] as RuntimeLinkedRecordDetailFields[]) {
        it(`keeps an authoritative ${Object.keys(map).length === 0 ? 'omitted' : 'empty'} custom projection empty`, async () => {
            const page = portalPage();
            page.payload.linkedRecordFieldIdToDetailFields.fld_children = [
                detail(),
            ];
            const response = rows();
            response.customViewDetailFields = map;
            const s = setup(async () => response, { portal: page });
            assert.deepEqual(
                loaded(await s.collection.readFirst(readOptions)).detailFields,
                []
            );
        });
    }

    it('limits null legacy detail fallback to actual returned non-hidden fields', async () => {
        const page = portalPage();
        page.payload.linkedRecordFieldIdToDetailFields.fld_children = [
            detail(),
            { ...detail('fld_hidden'), isHidden: true },
        ];
        const s = setup(async () => rows(), { portal: page });
        assert.deepEqual(
            loaded(await s.collection.readFirst(readOptions)).detailFields,
            [detail()]
        );
        const noDetails = setup(async () => rows());
        assert.deepEqual(
            loaded(await noDetails.collection.readFirst(readOptions))
                .detailFields,
            []
        );
    });

    it('replaces custom layout settings including omitted keys without reviving root defaults', async () => {
        const page = portalPage({
            disableInlineEdit: true,
            allowUsersToUnlinkRecords: true,
            kanbanCategoryField: 'fld_category',
            customViews: [
                {
                    id: 'view_example',
                    config: {
                        viewBehavior: 'custom',
                        layout: 'gallery',
                        disableEditingForCustomView: true,
                    },
                },
            ],
        });
        const s = setup(async () => rows(), { portal: page });
        const snapshot = loaded(await s.collection.readFirst(readOptions));
        assert.deepEqual(snapshot.layoutSettings, {
            layout: 'gallery',
            disableInlineEdit: undefined,
            allowUsersToUnlinkRecords: undefined,
            kanbanCategoryField: undefined,
        });
        assert.throws(
            () => s.collection.childFormRequest(editRequest('record_first')),
            PortalCollectionError
        );
        assert.equal(
            s.collection.childFormRequest(createRequest).input
                .childExtensionInfo.childExtensionId,
            'extension_child'
        );
    });

    it('constructs copied create input with identical inverse/prefill save context and no dispatch', () => {
        const s = setup();
        const query = { repeated: ['First', 'Second'], blank: '' };
        const fingerprint = {
            version: 1 as const,
            visitorId: 'synthetic_visitor',
        };
        const plan = s.collection.childFormRequest({
            ...createRequest,
            query,
            clientTimeZone: 'Etc/UTC',
            deviceFingerprint: fingerprint,
        });
        query.repeated.reverse();
        fingerprint.visitorId = 'Changed';
        const prefill = {
            toLinkToParent: {
                reversedFieldIdToPrefill: 'fld_parent',
                parentFormRecordId: 'record_parent',
            },
            prefillQueryForChildExtension: 'prefill_Title=Example',
        };
        assert.deepEqual(plan.input, {
            childExtensionAccessData: {
                parentExtensionAccessToken: 'portal_access_example',
                fieldIdUsedToAccessExtension: 'fld_children',
            },
            childExtensionInfo: {
                childExtensionId: 'extension_child',
                accessType: { type: 'create' },
            },
            context: {
                type: 'modal',
                linkedTableIdOfLinkedRecordField: 'table_children',
                prefillDataForLinkedRecordsForm: prefill,
            },
            query: { repeated: ['First', 'Second'], blank: '' },
            clientTimeZone: 'Etc/UTC',
            deviceFingerprint: { version: 1, visitorId: 'synthetic_visitor' },
        });
        assert.deepEqual(plan.saveContext, {
            type: 'modal',
            prefillData: prefill,
        });
        assert.deepEqual(plan.parent, {
            portalId: 'extension_example',
            recordId: 'record_parent',
            portalFieldId: 'fld_children',
        });
        assert.equal(plan.isCurrent(), true);
        assert.equal(s.calls.length, 0);
        assert.equal(s.fixture.mutations, 0);
        plan.input.context.prefillDataForLinkedRecordsForm!.toLinkToParent!.parentFormRecordId =
            'Changed';
        assert.equal(
            plan.saveContext.prefillData?.toLinkToParent?.parentFormRecordId,
            'record_parent'
        );
    });

    it('uses the shared editing child in form layout while creation keeps its separate child', async () => {
        const s = setup(async () => rows(), {
            portal: portalPage({
                layout: 'form',
                allowCreatingRecords: true,
                allowEditingRecords: true,
                formsForEditingAndCreating: 'same-form',
                extensionIdForCreatingAndEditing: 'extension_shared_child',
                extensionIdForEditing: 'extension_legacy_edit_child',
                extensionIdForCreating: 'extension_create_child',
            }),
        });
        await s.collection.readFirst(readOptions);
        assert.equal(
            s.collection.childFormRequest({
                access: { type: 'edit', recordId: 'record_first' },
                configuredChildExtensionId: 'extension_shared_child',
            }).input.childExtensionInfo.childExtensionId,
            'extension_shared_child'
        );
        const create = s.collection.childFormRequest({
            access: { type: 'create' },
            configuredChildExtensionId: 'extension_create_child',
        });
        assert.equal(
            create.input.childExtensionInfo.childExtensionId,
            'extension_create_child'
        );
        assert.deepEqual(create.input.query, {});
        assert.throws(
            () =>
                s.collection.childFormRequest({
                    access: { type: 'edit', recordId: 'record_first' },
                    configuredChildExtensionId: 'extension_legacy_edit_child',
                }),
            PortalCollectionError
        );
        assert.equal(s.calls.length, 1);
        assert.equal(s.fixture.mutations, 0);
    });

    it('preserves missing inverse links and ignores non-string configured prefill values', () => {
        const page = portalPage();
        const config =
            page.payload.fieldIdsToSchemas.fld_children.airtableField.config;
        assert.equal(config.type, AirtableFieldType.MULTIPLE_RECORD_LINKS);
        if (config.type !== AirtableFieldType.MULTIPLE_RECORD_LINKS)
            throw new Error('Fixture link required.');
        delete config.options.inverseLinkFieldId;
        page.payload.formRecord.data.fld_prefill = ['not', 'a', 'query'];
        const s = setup(undefined, { portal: page });
        assert.deepEqual(
            s.collection.childFormRequest(createRequest).saveContext,
            {
                type: 'modal',
                prefillData: {
                    toLinkToParent: null,
                    prefillQueryForChildExtension: null,
                },
            }
        );
    });

    it('checks child edit main-read membership rather than initial or nested label records', async () => {
        const page = portalPage();
        page.payload.initialLinkedTableStates = rows([
            'initial_only',
        ]).tableIdsToLinkedTableStates;
        const response = rows(['record_first']);
        response.tableIdsToLinkedTableStates.table_nested = {
            airtableFields: [],
            recordIdsToAirtableRecords: {
                nested_only: { id: 'nested_only', fields: {} },
            },
        };
        response.tableIdsToLinkedTableStates.table_children.recordIdsToAirtableRecords.cached_only =
            { id: 'cached_only', fields: {} };
        const s = setup(async () => response, { portal: page });
        assert.throws(
            () => s.collection.childFormRequest(editRequest('record_first')),
            PortalCollectionError
        );
        await s.collection.readFirst(readOptions);
        for (const id of [
            'initial_only',
            'nested_only',
            'cached_only',
            'arbitrary',
        ])
            assert.throws(
                () => s.collection.childFormRequest(editRequest(id)),
                PortalCollectionError
            );
        const plan = s.collection.childFormRequest(editRequest('record_first'));
        assert.deepEqual(plan.input.childExtensionInfo.accessType, {
            type: 'edit',
            childExtensionRecordId: 'record_first',
            childExtensionFieldId: null,
        });
        assert.deepEqual(plan.saveContext, {
            type: 'modal',
            prefillData: null,
        });
        assert.equal(plan.input.context.prefillDataForLinkedRecordsForm, null);
        assert.equal(s.fixture.mutations, 0);
    });

    it('checks the exact published child ID and existing creation/editing flags', async () => {
        const s = setup(async () => rows());
        assert.throws(
            () =>
                s.collection.childFormRequest({
                    ...createRequest,
                    configuredChildExtensionId: 'arbitrary_extension',
                }),
            PortalCollectionError
        );
        const disabled = setup(undefined, {
            portal: portalPage({
                allowCreatingRecords: false,
                allowEditingRecords: false,
            }),
        });
        assert.throws(
            () => disabled.collection.childFormRequest(createRequest),
            PortalCollectionError
        );
        const separate = setup(async () => rows(), {
            portal: portalPage({
                formsForEditingAndCreating: 'different-forms',
                extensionIdForCreating: 'extension_create',
                extensionIdForEditing: 'extension_edit',
            }),
        });
        assert.equal(
            separate.collection.childFormRequest({
                ...createRequest,
                configuredChildExtensionId: 'extension_create',
            }).input.childExtensionInfo.childExtensionId,
            'extension_create'
        );
        await separate.collection.readFirst(readOptions);
        assert.equal(
            separate.collection.childFormRequest({
                ...editRequest('record_first'),
                configuredChildExtensionId: 'extension_edit',
            }).input.childExtensionInfo.childExtensionId,
            'extension_edit'
        );
    });

    it('preserves prior state and child plans when a read is pre-aborted', async () => {
        const s = setup(async () => rows(['record_first'], 'cursor'));
        await s.collection.readFirst(readOptions);
        const plan = s.collection.childFormRequest(editRequest('record_first'));
        const aborted = new AbortController();
        const reason = new Error('Pre-aborted fixture');
        aborted.abort(reason);
        await assert.rejects(
            s.collection.readFirst({ ...readOptions, signal: aborted.signal }),
            (error) => error === reason
        );
        await assert.rejects(
            s.collection.readNext({ ...readOptions, signal: aborted.signal }),
            (error) => error === reason
        );
        assert.equal(s.calls.length, 1);
        assert.equal(plan.isCurrent(), true);
        assert.deepEqual(s.collection.getSnapshot()?.recordIds, [
            'record_first',
        ]);
    });

    it('rejects overlapping reads without adding requests or reviving stale child plans', async () => {
        const pending = deferredPortal<ListPortalLinkedRecordsResult>();
        const s = setup(async () => pending.promise);
        const read = s.collection.readFirst(readOptions);
        await assert.rejects(
            s.collection.readFirst(readOptions),
            PortalCollectionError
        );
        await assert.rejects(
            s.collection.readNext(readOptions),
            PortalCollectionError
        );
        assert.equal(s.calls.length, 1);
        pending.resolve(rows());
        await read;
    });

    it('discards a dispatched cancelled first response even when transport ignores abort', async () => {
        const pending = deferredPortal<ListPortalLinkedRecordsResult>();
        const s = setup(async () => pending.promise);
        const controller = new AbortController();
        const reason = new Error('Cancelled fixture');
        const read = s.collection.readFirst({
            ...readOptions,
            signal: controller.signal,
        });
        controller.abort(reason);
        assert.equal(s.calls[0].options?.signal?.aborted, true);
        pending.resolve(rows(['late_record']));
        await assert.rejects(read, (error) => error === reason);
        assert.equal(s.collection.getSnapshot(), null);
        assert.throws(
            () => s.collection.childFormRequest(createRequest),
            PortalCollectionError
        );
        assert.equal(s.fixture.mutations, 0);
    });

    it('requires a fresh first read after cancelled next-page uncertainty without accepting late rows', async () => {
        const pending = deferredPortal<ListPortalLinkedRecordsResult>();
        let calls = 0;
        const s = setup(async () =>
            ++calls === 1
                ? rows(['record_first'], 'cursor')
                : calls === 2
                  ? pending.promise
                  : rows(['fresh_record'])
        );
        await s.collection.readFirst(readOptions);
        const plan = s.collection.childFormRequest(editRequest('record_first'));
        const controller = new AbortController();
        const read = s.collection.readNext({
            ...readOptions,
            signal: controller.signal,
        });
        controller.abort();
        pending.resolve(rows(['late_record']));
        await assert.rejects(read);
        assert.equal(plan.isCurrent(), false);
        assert.deepEqual(s.collection.getSnapshot()?.recordIds, [
            'record_first',
        ]);
        assert.throws(
            () => s.collection.childFormRequest(editRequest('record_first')),
            PortalCollectionError
        );
        await assert.rejects(
            s.collection.readNext(readOptions),
            PortalCollectionError
        );
        assert.deepEqual(
            loaded(await s.collection.readFirst(readOptions)).recordIds,
            ['fresh_record']
        );
    });

    for (const transition of ['owner', 'session'] as const) {
        it(`latches an observed ${transition} change and rejects late results after ABA restoration`, async () => {
            const pending = deferredPortal<ListPortalLinkedRecordsResult>();
            const s = setup(async () => pending.promise);
            const plan = s.collection.childFormRequest(createRequest);
            const read = s.collection.readFirst(readOptions);
            if (transition === 'owner') s.scope.ownerId = 'visitor_B';
            else s.client.setSession({ visitor: 'visitor_B' });
            assert.equal(s.collection.isCurrent(), false);
            if (transition === 'owner') s.scope.ownerId = 'visitor_A';
            else s.client.setSession({ visitor: 'visitor_A' });
            assert.equal(s.collection.isCurrent(), false);
            assert.equal(plan.isCurrent(), false);
            pending.resolve(rows(['late_record']));
            await assert.rejects(read, PortalCollectionError);
            assert.equal(s.collection.getSnapshot(), null);
            assert.equal(s.fixture.mutations, 0);
        });
    }

    it('rejects owner revision ABA even when no intermediate session check observed it', async () => {
        const pending = deferredPortal<ListPortalLinkedRecordsResult>();
        const s = setup(async () => pending.promise);
        const read = s.collection.readFirst(readOptions);
        s.scope.ownerId = 'visitor_B';
        s.scope.revision += 1;
        s.scope.ownerId = 'visitor_A';
        s.scope.revision += 1;
        pending.resolve(rows(['late_record']));
        await assert.rejects(read, PortalCollectionError);
        assert.equal(s.collection.isCurrent(), false);
    });

    it('allows the caller to reject accepted-but-now-stale results before rendering', async () => {
        const s = setup(async () => rows());
        const outcome = await s.collection.readFirst(readOptions);
        assert.equal(outcome.type, 'loaded');
        s.scope.revision += 1;
        assert.equal(s.collection.isCurrent(), false);
        assert.equal(s.collection.getSnapshot(), null);
    });

    it('retires before abort callbacks and blocks reentrant reads and old child contexts', async () => {
        const pending = deferredPortal<ListPortalLinkedRecordsResult>();
        let callbackCurrent: boolean | undefined;
        let reentrant: Promise<unknown> | undefined;
        const s = setup(async (call) => {
            call.options?.signal?.addEventListener('abort', () => {
                callbackCurrent = s.collection.isCurrent();
                const request = s.collection.readFirst(readOptions);
                reentrant = request;
                void request.catch(() => undefined);
            });
            return pending.promise;
        });
        const plan = s.collection.childFormRequest(createRequest);
        const read = s.collection.readFirst(readOptions);
        s.collection.destroy();
        assert.equal(callbackCurrent, false);
        assert.equal(plan.isCurrent(), false);
        assert.equal(s.collection.isCurrent(), false);
        await assert.rejects(reentrant!, PortalCollectionError);
        assert.equal(s.calls.length, 1);
        pending.resolve(rows(['late_record']));
        await assert.rejects(read);
        s.collection.destroy();
        assert.equal(s.fixture.mutations, 0);
    });
});
