import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import {
    createFormFieldBindings,
    FormControllerError,
    RecoveryJournal,
    type RecoveryAttempt,
} from '../src/forms/index.js';
import { resolveLinkedChildEditPolicy } from '../src/forms/linkedChildPolicy.js';
import {
    createPortalCollection,
    loadPortalChildForm,
} from '../src/portals/index.js';
import {
    createMiniExtensionsClient,
    type LoadExtensionInput,
    type LoadSelectedRecordsInput,
    type SaveFormInput,
    type SaveFormResult,
} from '../src/runtime/index.js';
import { childForm, parentForm } from './formLinkedChildFixtures.js';
import { formSaveOptions } from './formsFixtures.js';
import {
    deferredPortal,
    portalListPage,
    portalPage,
} from './portalFixtures.js';

const apiOrigin = 'https://sdk.example.test';
const portalFieldId = 'fld_children';
const relatedFieldId = 'fld_children_a';
const projectId = 'rec_parent';
const projectTableId = 'table_children';
const relatedId = 'rec_existing';
const relatedTableId = 'tbl_child';
const projectFormId = 'extension_child';
const relatedFormId = 'form_child_synthetic';
const deeperId = 'rec_deeper';
const editedTitle = 'Edited Related';

class ObservedJournal extends RecoveryJournal {
    readonly observed: RecoveryAttempt[] = [];

    override prepare(...args: Parameters<RecoveryJournal['prepare']>) {
        const attempt = super.prepare(...args);
        this.observed.push(attempt);
        return attempt;
    }
}

async function setup(
    test: TestContext,
    journey: 'portal' | 'direct' | 'unowned-child',
    options: {
        projectLoad?: 'legacy' | 'clone';
        holdRelated?: boolean;
        holdSave?: boolean;
        includeDeeperLink?: boolean;
    } = {}
) {
    const portal = portalPage();
    const project = parentForm('edit');
    project.extensionId = projectFormId;
    project.workspaceId = portal.workspaceId;
    project.payload.baseId = portal.payload.baseId;
    project.payload.hasParentExtension = journey !== 'direct';
    project.payload.publicFields.state.tableId = projectTableId;
    project.payload.formRecord = {
        type: 'edit',
        recordId: projectId,
        tableId: projectTableId,
        data: {
            fld_title: 'Stored Project',
            [relatedFieldId]: [relatedId],
        },
    };

    const related = childForm('edit');
    related.workspaceId = project.workspaceId;
    related.payload.baseId = project.payload.baseId;
    related.payload.formRecord = {
        type: 'edit',
        recordId: relatedId,
        tableId: relatedTableId,
        data: { fld_title: 'Stored Related' },
    };
    const inverse = related.payload.fieldIdsToSchemas.fld_parent_a;
    assert.equal(inverse.airtableField.config.type, 'multipleRecordLinks');
    inverse.airtableField.config.options.linkedTableId = projectTableId;
    if (options.includeDeeperLink) {
        const field = structuredClone(
            project.payload.fieldIdsToSchemas[relatedFieldId]
        );
        assert.equal(field.fieldType, 'multipleRecordLinks');
        field.miniExtConfig = {
            ...field.miniExtConfig,
            extensionIdForCreatingAndEditing: 'form_deeper_synthetic',
        };
        related.payload.fieldIdsToSchemas[relatedFieldId] = field;
        related.payload.fieldNamesToSchemas[field.airtableField.name] = field;
        related.payload.fieldIdsInForm.push(relatedFieldId);
        related.payload.formRecord.data[relatedFieldId] = [deeperId];
    }

    const calls: string[] = [];
    const relatedRequested = deferredPortal<void>();
    const releaseRelated = deferredPortal<void>();
    const saveRequested = deferredPortal<void>();
    const releaseSave = deferredPortal<void>();
    test.after(() => {
        releaseRelated.resolve();
        releaseSave.resolve();
    });
    const client = createMiniExtensionsClient({
        apiOrigin,
        async fetch(resource, init) {
            const url = new URL(String(resource));
            assert.equal(url.origin, apiOrigin);
            const route = url.searchParams.get('route');
            if (route === 'fetchExtensionForEndUser') {
                assert.equal(init?.method, 'POST');
                const input: LoadExtensionInput = JSON.parse(String(init.body));
                if ('childExtensionInfo' in input) {
                    const { childExtensionId, accessType } =
                        input.childExtensionInfo;
                    assert.equal(input.context.type, 'modal');
                    assert.equal(accessType.type, 'edit');
                    if (childExtensionId === projectFormId) {
                        calls.push('load Portal Project');
                        assert.equal(
                            accessType.childExtensionRecordId,
                            projectId
                        );
                        assert.deepEqual(input.childExtensionAccessData, {
                            parentExtensionAccessToken:
                                portal.payload.extensionAccessToken,
                            fieldIdUsedToAccessExtension: portalFieldId,
                        });
                        return Response.json(project);
                    }
                    calls.push('load selected Related');
                    assert.equal(childExtensionId, relatedFormId);
                    assert.equal(accessType.childExtensionRecordId, relatedId);
                    assert.deepEqual(input.childExtensionAccessData, {
                        parentExtensionAccessToken:
                            project.payload.extensionAccessToken,
                        fieldIdUsedToAccessExtension: relatedFieldId,
                    });
                    relatedRequested.resolve();
                    if (options.holdRelated) await releaseRelated.promise;
                    return Response.json(related);
                }
                assert.equal(input.context.type, 'direct-url');
                if (journey === 'portal') {
                    calls.push('load Portal');
                    return Response.json(portal);
                }
                calls.push('load direct Project');
                return Response.json(project);
            }
            if (route === 'fetchRecordsForLinkedTableOnPortal') {
                calls.push('read Portal Projects');
                return Response.json(
                    portalListPage({
                        recordIds: [projectId],
                        tableIdsToLinkedTableStates: {
                            [projectTableId]: {
                                airtableFields: [
                                    project.payload.fieldIdsToSchemas.fld_title
                                        .airtableField,
                                ],
                                recordIdsToAirtableRecords: {
                                    [projectId]: {
                                        id: projectId,
                                        fields: project.payload.formRecord.data,
                                    },
                                },
                            },
                        },
                    })
                );
            }
            if (route === 'saveForm') {
                calls.push('save selected Related');
                assert.ok(
                    options.holdSave,
                    'Unexpected Related Save dispatch.'
                );
                assert.equal(init?.method, 'POST');
                const input: SaveFormInput = JSON.parse(String(init.body));
                assert.equal(
                    input.extensionAccessToken,
                    related.payload.extensionAccessToken
                );
                assert.equal(input.context.type, 'modal');
                assert.equal(input.formRecord.type, 'edit');
                assert.equal(input.formRecord.recordId, relatedId);
                assert.equal(input.formRecord.tableId, relatedTableId);
                assert.equal(input.formRecord.data.fld_title, editedTitle);
                saveRequested.resolve();
                await releaseSave.promise;
                const saved = {
                    id: relatedId,
                    fields: { fld_title: editedTitle, fld_parent_a: [] },
                };
                return Response.json({
                    type: 'saved',
                    tableId: relatedTableId,
                    record: saved,
                    loggedInUserRecord: null,
                    context: {
                        type: 'modal',
                        newTableIdsToLinkedTableStates: {
                            [relatedTableId]: {
                                airtableFields: [
                                    related.payload.fieldIdsToSchemas.fld_title
                                        .airtableField,
                                ],
                                recordIdsToAirtableRecords: {
                                    [relatedId]: saved,
                                },
                            },
                        },
                    },
                } satisfies SaveFormResult);
            }
            if (
                url.pathname ===
                '/api/trpc/publicExtensions.fetchInitialTableIdsToLinkedTableStates'
            ) {
                assert.equal(init?.method, 'GET');
                const input: LoadSelectedRecordsInput = JSON.parse(
                    url.searchParams.get('input') ?? 'null'
                );
                const deeper =
                    input.extensionAccessToken ===
                    related.payload.extensionAccessToken;
                if (deeper) assert.ok(options.includeDeeperLink);
                else
                    assert.equal(
                        input.extensionAccessToken,
                        project.payload.extensionAccessToken
                    );
                calls.push(
                    deeper
                        ? 'read selected deeper record'
                        : 'read selected Related'
                );
                const selectedId = deeper ? deeperId : relatedId;
                return Response.json({
                    result: {
                        data: {
                            [relatedTableId]: {
                                airtableFields: [
                                    related.payload.fieldIdsToSchemas.fld_title
                                        .airtableField,
                                ],
                                recordIdsToAirtableRecords: {
                                    [selectedId]: {
                                        id: selectedId,
                                        fields: deeper
                                            ? {
                                                  fld_title:
                                                      'Stored deeper record',
                                              }
                                            : related.payload.formRecord.data,
                                    },
                                },
                            },
                        },
                    },
                });
            }
            calls.push(`unexpected ${route ?? url.pathname}`);
            assert.fail('Only synthetic reads are allowed in this journey.');
        },
    });
    const getScope = () => ({ ownerId: 'synthetic-visitor', revision: 0 });
    const saveOptions = formSaveOptions();
    const directContext = { type: 'direct-url' as const };
    const entry = await client.loadExtension({
        shareId: journey === 'portal' ? 'share_portal' : 'share_project',
        recordId: journey === 'portal' ? null : projectId,
        context: directContext,
        query: {},
    });
    let loaded = entry;
    let parent;
    let collection: ReturnType<typeof createPortalCollection> | undefined;
    if (journey === 'portal') {
        assert.equal(entry.extensionScreen, 'portal_loaded');
        const portalCollection = createPortalCollection({
            client,
            portal: entry,
            portalFieldId,
            criteria: {
                selectedCustomViewId: 'view_example',
                searchTerm: null,
                searchParamsMap: {},
                sortFieldsByEndUser: null,
                filtersByEndUser: null,
            },
            getScope,
        });
        collection = portalCollection;
        test.after(() => portalCollection.destroy());
        await portalCollection.readFirst({
            pagesToFetch: 1,
            refreshLoggedInPortalRecord: true,
        });
        assert.deepEqual(portalCollection.getSnapshot()?.recordIds, [
            projectId,
        ]);
        const plan = portalCollection.childFormRequest({
            access: { type: 'edit', recordId: projectId },
            configuredChildExtensionId: projectFormId,
        });
        parent = plan.parent;
        saveOptions.context = plan.saveContext;
        assert.equal(plan.isCurrent(), true);
        if (options.projectLoad === 'legacy') {
            const before = calls.length;
            await assert.rejects(
                loadPortalChildForm({ ...plan }),
                /An SDK Portal child request is required/
            );
            assert.equal(calls.length, before);
        }
        loaded =
            options.projectLoad === 'legacy'
                ? await client.loadExtension(plan.input)
                : await loadPortalChildForm(plan);
        if (options.projectLoad === 'clone') loaded = structuredClone(loaded);
        assert.equal(plan.isCurrent(), true);
    }
    assert.equal(loaded.extensionScreen, 'form_loaded');
    assert.equal(loaded.payload.hasParentExtension, journey !== 'direct');
    assert.equal(loaded.payload.formRecord.type, 'edit');
    assert.equal(loaded.payload.formRecord.recordId, projectId);
    const fields = createFormFieldBindings({
        client,
        loaded,
        parent,
        getScope,
        saveOptions,
    });
    test.after(() => fields.destroy());
    const selection = fields.linkedRecords(relatedFieldId);
    assert.equal(await selection.readSelected(), true);
    assert.deepEqual(
        selection.getSnapshot().selectedRecords.map(({ id }) => id),
        [relatedId]
    );
    assert.deepEqual(fields.field('fld_title').setValue('Unsaved Project'), {
        accepted: true,
    });
    const draft = structuredClone(fields.controller.getState().draft);
    assert.ok(draft?.dirtyFieldIds.includes('fld_title'));
    const journal = new ObservedJournal();
    const owner = fields.linkedChild(relatedFieldId, {
        journal,
        loadVersion: 1,
    });
    const waitForRelatedRequest = (opening: Promise<boolean>) =>
        Promise.race([
            relatedRequested.promise,
            opening.then(() =>
                assert.fail('Edit settled before requesting Related.')
            ),
        ]);
    const waitForSaveRequest = (saving: ReturnType<typeof owner.save>) =>
        Promise.race([
            saveRequested.promise,
            saving.then(() =>
                assert.fail('Save settled before reaching transport.')
            ),
        ]);
    return {
        calls,
        client,
        journal,
        draft,
        fields,
        owner,
        selection,
        collection,
        waitForRelatedRequest,
        releaseRelated: releaseRelated.resolve,
        waitForSaveRequest,
        releaseSave: releaseSave.resolve,
    };
}

for (const journey of ['portal', 'direct'] as const) {
    it(`opens the selected Related Edit once from the ${journey} Project without changing its draft`, async (test) => {
        const { owner, calls, draft, fields, selection } = await setup(
            test,
            journey
        );
        const before = [...calls];
        const revision = owner.getSnapshot().revision;
        assert.equal(await owner.openEdit('rec_unselected', revision), false);
        if (journey === 'portal') assert.equal(await owner.openCreate(), false);
        assert.deepEqual(calls, before);

        assert.equal(await owner.openEdit(relatedId, revision), true);
        const next = owner.getSnapshot();
        assert.equal(next.phase, 'ready');
        assert.deepEqual(next.intent, { type: 'edit', recordId: relatedId });
        assert.deepEqual(next.child?.getLoaded().payload.formRecord, {
            type: 'edit',
            recordId: relatedId,
            tableId: relatedTableId,
            data: { fld_title: 'Stored Related' },
        });
        assert.deepEqual(calls.slice(before.length), ['load selected Related']);
        assert.deepEqual(fields.controller.getState().draft, draft);
        assert.deepEqual(
            selection.getSnapshot().selectedRecords.map(({ id }) => id),
            [relatedId]
        );
        owner.close();
        assert.equal(owner.getSnapshot().child, null);
        await assert.rejects(
            owner.save(next.revision),
            /This child submission is unavailable/
        );
        assert.deepEqual(calls.slice(before.length), ['load selected Related']);
        assert.deepEqual(fields.controller.getState().draft, draft);
    });
}

it('a nested Project without an admitted Portal opening cannot load Related', async (test) => {
    const { calls, draft, fields, owner } = await setup(test, 'unowned-child');
    const before = [...calls];
    const snapshot = owner.getSnapshot();
    assert.deepEqual(snapshot.editableRecordIds, []);
    assert.equal(await owner.openEdit(relatedId, snapshot.revision), false);
    assert.deepEqual(calls, before);
    assert.deepEqual(fields.controller.getState().draft, draft);
});

for (const projectLoad of ['legacy', 'clone'] as const) {
    it(`does not grant Related Edit to a ${projectLoad} load of the same Portal Project`, async (test) => {
        const { calls, draft, fields, owner } = await setup(test, 'portal', {
            projectLoad,
        });
        const before = [...calls];
        const snapshot = owner.getSnapshot();
        assert.deepEqual(snapshot.editableRecordIds, []);
        assert.equal(await owner.openEdit(relatedId, snapshot.revision), false);
        assert.deepEqual(calls, before);
        assert.deepEqual(fields.controller.getState().draft, draft);
    });
}

for (const change of ['disposed', 'superseded'] as const) {
    it(`refuses the pending Related response after its Portal collection is ${change}`, async (test) => {
        const {
            calls,
            collection,
            draft,
            fields,
            owner,
            waitForRelatedRequest,
            releaseRelated,
        } = await setup(test, 'portal', { holdRelated: true });
        assert.ok(collection);
        const before = calls.length;
        const opening = owner.openEdit(relatedId, owner.getSnapshot().revision);
        await waitForRelatedRequest(opening);
        assert.equal(owner.getSnapshot().phase, 'loading');

        if (change === 'disposed') collection.destroy();
        else
            await collection.readFirst({
                pagesToFetch: 1,
                refreshLoggedInPortalRecord: true,
            });
        releaseRelated();
        assert.equal(await opening, false);
        const snapshot = owner.getSnapshot();
        assert.equal(snapshot.phase, 'retired');
        assert.equal(snapshot.child, null);
        assert.equal(snapshot.intent, null);
        assert.deepEqual(fields.controller.getState().draft, draft);
        assert.deepEqual(
            calls.slice(before),
            change === 'disposed'
                ? ['load selected Related']
                : ['load selected Related', 'read Portal Projects']
        );
    });
}

for (const restore of [false, true]) {
    it(`refuses the pending Related response after its selected ID is ${restore ? 'removed and restored' : 'removed'}`, async (test) => {
        const {
            calls,
            fields,
            owner,
            selection,
            waitForRelatedRequest,
            releaseRelated,
        } = await setup(test, 'portal', { holdRelated: true });
        const before = calls.length;
        const opening = owner.openEdit(relatedId, owner.getSnapshot().revision);
        await waitForRelatedRequest(opening);
        assert.equal(owner.getSnapshot().phase, 'loading');
        assert.deepEqual(fields.field(relatedFieldId).setValue([]), {
            accepted: true,
        });
        const afterRemoval = structuredClone(
            fields.controller.getState().draft
        );
        assert.equal(afterRemoval?.data.fld_title, 'Unsaved Project');
        assert.deepEqual(afterRemoval?.data[relatedFieldId], []);
        assert.deepEqual(selection.getSnapshot().selectedRecords, []);

        if (restore) {
            fields.setLinkedOptions(relatedFieldId, [
                { value: relatedId, label: 'Stored Related' },
            ]);
            assert.deepEqual(
                fields.field(relatedFieldId).setValue([relatedId]),
                {
                    accepted: true,
                }
            );
            const restoredSelection = fields.linkedRecords(relatedFieldId);
            assert.equal(await restoredSelection.readSelected(), true);
            assert.deepEqual(
                restoredSelection
                    .getSnapshot()
                    .selectedRecords.map(({ id }) => id),
                [relatedId]
            );
        }
        const currentDraft = structuredClone(
            fields.controller.getState().draft
        );
        releaseRelated();
        assert.equal(await opening, false);
        const snapshot = owner.getSnapshot();
        assert.equal(snapshot.child, null);
        assert.equal(snapshot.intent, null);
        assert.notEqual(snapshot.phase, 'loading');
        if (!restore) assert.deepEqual(snapshot.editableRecordIds, []);
        assert.deepEqual(fields.controller.getState().draft, currentDraft);
        assert.deepEqual(calls.slice(before), ['load selected Related']);
    });
}

it('keeps an accepted Related Edit bound to its record after the Project selection changes', async (test) => {
    const { calls, fields, owner, selection, waitForSaveRequest, releaseSave } =
        await setup(test, 'portal', { holdSave: true });
    const before = calls.length;
    assert.equal(
        await owner.openEdit(relatedId, owner.getSnapshot().revision),
        true
    );
    const { child, pages } = owner.getSnapshot();
    assert.ok(child && pages);
    const title = child.field('fld_title');
    assert.deepEqual(title.setValue(editedTitle), { accepted: true });

    assert.deepEqual(fields.field(relatedFieldId).setValue([]), {
        accepted: true,
    });
    const { draft, draftRevision } = fields.controller.getState();
    assert.equal(draft?.data.fld_title, 'Unsaved Project');
    assert.deepEqual(draft?.data[relatedFieldId], []);
    assert.deepEqual(selection.getSnapshot().selectedRecords, []);
    const ready = owner.getSnapshot();
    assert.equal(ready.phase, 'ready');
    assert.deepEqual(ready.editableRecordIds, []);
    assert.equal(ready.child, child);
    assert.equal(ready.pages, pages);
    assert.deepEqual(ready.intent, { type: 'edit', recordId: relatedId });
    assert.equal(
        child.controller.getState().draft?.data.fld_title,
        editedTitle
    );
    assert.deepEqual(calls.slice(before), ['load selected Related']);

    const saving = owner.save(ready.revision);
    await waitForSaveRequest(saving);
    releaseSave();
    const result = await saving;
    assert.equal(result.type, 'saved');
    assert.equal(result.raw.record.id, relatedId);
    assert.equal(owner.getSnapshot().completion, 'reconciled');
    assert.deepEqual(fields.controller.getState().draft, draft);
    assert.equal(fields.controller.getState().draftRevision, draftRevision);
    assert.deepEqual(selection.getSnapshot().selectedRecords, []);
    assert.deepEqual(calls.slice(before), [
        'load selected Related',
        'save selected Related',
    ]);
});

it('does not turn a successful Related Edit into authority for a further hop', async (test) => {
    const { calls, owner } = await setup(test, 'portal', {
        includeDeeperLink: true,
    });
    const before = calls.length;
    assert.equal(
        await owner.openEdit(relatedId, owner.getSnapshot().revision),
        true
    );
    const child = owner.getSnapshot().child;
    assert.ok(child);
    const selected = child.linkedRecords(relatedFieldId);
    assert.equal(await selected.readSelected(), true);
    const loaded = child.getLoaded();
    assert.equal(
        resolveLinkedChildEditPolicy({
            loaded,
            fieldId: relatedFieldId,
            recordId: deeperId,
            data: loaded.payload.formRecord.data,
            linkedRecords: selected.getSnapshot(),
        }).type,
        'available'
    );
    const deeper = child.linkedChild(relatedFieldId, {
        journal: new RecoveryJournal(),
        loadVersion: 1,
    });
    const snapshot = deeper.getSnapshot();
    assert.deepEqual(snapshot.editableRecordIds, []);
    assert.equal(await deeper.openEdit(deeperId, snapshot.revision), false);
    assert.deepEqual(calls.slice(before), [
        'load selected Related',
        'read selected deeper record',
    ]);
});

for (const retained of [
    'field',
    'page',
    'controller write',
    'controller Save',
] as const) {
    it(`refuses a retained ready Related ${retained} callback after the Portal retires`, async (test) => {
        const { calls, collection, draft, fields, owner, journal } =
            await setup(test, 'portal');
        assert.ok(collection);
        assert.equal(
            await owner.openEdit(relatedId, owner.getSnapshot().revision),
            true
        );
        const { child, pages } = owner.getSnapshot();
        assert.ok(child && pages);
        const field = child.field('fld_title');
        assert.deepEqual(field.setValue(editedTitle), { accepted: true });
        const page = pages.getSnapshot();
        assert.equal(field.getSnapshot().canEdit, true);
        assert.equal(page.canSubmit, true);
        const before = [...calls];

        collection.destroy();
        if (retained === 'field')
            assert.equal(
                field.setValue('Retired Related edit').accepted,
                false
            );
        else if (retained === 'page')
            await assert.rejects(
                pages.submit(page.revision),
                /Form page action refused: retired/
            );
        else if (retained === 'controller write')
            assert.equal(
                child.controller.write('fld_title', 'Retired Related edit'),
                false
            );
        else await assert.rejects(child.controller.save());

        assert.equal(pages.getSnapshot().status, 'retired');
        assert.equal(owner.getSnapshot().phase, 'retired');
        assert.equal(owner.getSnapshot().child, null);
        assert.deepEqual(calls, before);
        assert.deepEqual(journal.observed, []);
        assert.deepEqual(fields.controller.getState().draft, draft);
    });
}

for (const retire of [false, true]) {
    it(`settles one dispatched Related Save with the Portal ${retire ? 'retired' : 'current'}`, async (test) => {
        const {
            calls,
            collection,
            draft,
            fields,
            journal,
            owner,
            selection,
            waitForSaveRequest,
            releaseSave,
        } = await setup(test, 'portal', { holdSave: true });
        assert.ok(collection);
        const before = calls.length;
        assert.equal(
            await owner.openEdit(relatedId, owner.getSnapshot().revision),
            true
        );
        const child = owner.getSnapshot().child;
        assert.ok(child);
        assert.deepEqual(child.field('fld_title').setValue(editedTitle), {
            accepted: true,
        });
        const revision = owner.getSnapshot().revision;
        const saving = owner.save(revision);
        await waitForSaveRequest(saving);
        assert.equal(journal.observed.length, 1);
        assert.equal(journal.observed[0]?.outcome, 'unknown');
        assert.equal(journal.observed[0]?.flight, true);
        if (retire) {
            collection.destroy();
            assert.equal(
                child.controller.write('fld_title', 'Retired during Save'),
                false
            );
        }
        releaseSave();

        const result = await saving;
        assert.equal(result.type, 'saved');
        assert.equal(result.raw.record.id, relatedId);
        assert.equal(result.raw.record.fields.fld_title, editedTitle);
        assert.equal(journal.observed.length, 1);
        assert.equal(journal.observed[0]?.outcome, 'saved');
        assert.equal(journal.observed[0]?.flight, false);
        if (retire) {
            assert.equal(owner.getSnapshot().phase, 'retired');
            assert.equal(
                owner.getSnapshot().completion,
                'saved-not-reconciled'
            );
            assert.deepEqual(fields.controller.getState().draft, draft);
            assert.deepEqual(
                selection.getSnapshot().selectedRecords.map(({ id }) => id),
                [relatedId]
            );
        } else {
            assert.equal(owner.getSnapshot().completion, 'reconciled');
            assert.deepEqual(
                fields.controller.getState().draft?.data[relatedFieldId],
                []
            );
            assert.equal(
                fields.controller.getState().draft?.data.fld_title,
                'Unsaved Project'
            );
        }
        await assert.rejects(
            owner.save(revision),
            /This child submission is unavailable/
        );
        assert.deepEqual(calls.slice(before), [
            'load selected Related',
            'save selected Related',
        ]);
    });
}

it('does not dispatch a Related Save if the transport getter retires its Portal', async (test) => {
    const { calls, client, collection, draft, fields, journal, owner } =
        await setup(test, 'portal');
    assert.ok(collection);
    assert.equal(
        await owner.openEdit(relatedId, owner.getSnapshot().revision),
        true
    );
    const child = owner.getSnapshot().child;
    assert.ok(child);
    assert.deepEqual(child.field('fld_title').setValue(editedTitle), {
        accepted: true,
    });
    const transport = client.forms;
    const descriptor = Object.getOwnPropertyDescriptor(transport, 'save');
    assert.ok(descriptor?.configurable);
    const save = transport.save;
    let getters = 0;
    Object.defineProperty(transport, 'save', {
        configurable: true,
        get() {
            getters++;
            collection.destroy();
            return save;
        },
    });
    test.after(() => Object.defineProperty(transport, 'save', descriptor));
    const before = [...calls];

    await assert.rejects(
        owner.save(owner.getSnapshot().revision),
        (error) =>
            error instanceof FormControllerError &&
            error.code === 'scope-changed'
    );
    assert.equal(getters, 1);
    assert.equal(journal.observed.length, 1);
    assert.equal(journal.observed[0]?.outcome, 'not-dispatched');
    assert.equal(journal.observed[0]?.flight, false);
    assert.deepEqual(calls, before);
    assert.deepEqual(fields.controller.getState().draft, draft);
});
