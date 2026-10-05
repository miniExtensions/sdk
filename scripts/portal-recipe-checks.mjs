import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const titleField = {
    id: 'fld_title',
    name: 'Title',
    config: { type: 'singleLineText' },
    isPrimaryField: true,
};
const quantityField = {
    id: 'fld_quantity',
    name: 'Quantity',
    config: { type: 'number', options: { precision: 2 } },
};
const linkField = {
    id: 'fld_children',
    name: 'Children',
    config: {
        type: 'multipleRecordLinks',
        options: {
            linkedTableId: 'tbl_children',
            inverseLinkFieldId: 'fld_parent',
            isReversed: false,
            prefersSingleRecordLink: false,
        },
    },
};
const prefillField = {
    id: 'fld_prefill',
    name: 'Child prefill',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: { type: 'singleLineText', options: null },
};
const linkSchema = {
    fieldType: 'multipleRecordLinks',
    airtableField: linkField,
    miniExtConfig: {
        allowCreatingRecords: true,
        allowEditingRecords: true,
        formsForEditingAndCreating: 'same-form',
        extensionIdForCreatingAndEditing: 'child_example',
        prefillChildFormForCreatingRecords: true,
        prefillFieldForCreatingChildExtension: 'fld_prefill',
        layout: 'grid',
        disableInlineEdit: true,
        allowUsersToUnlinkRecords: true,
        kanbanCategoryField: 'fld_quantity',
        customViews: [
            {
                id: 'view_example',
                config: {
                    name: 'Example view',
                    viewBehavior: 'custom',
                    layout: 'list',
                },
            },
        ],
    },
};
const detailFields = {
    fld_children: [
        {
            fieldId: 'fld_title',
            fieldName: 'Title',
            titleOverride: null,
            isHidden: false,
            fieldIsInEditingChildForm: true,
            childFormField: null,
        },
        {
            fieldId: 'fld_quantity',
            fieldName: 'Quantity',
            titleOverride: 'Count',
            isHidden: false,
            fieldIsInEditingChildForm: false,
            childFormField: null,
        },
    ],
};
const display = {
    baseId: 'base_example',
    loggedInUserCanEditExtension: false,
    showMiniExtensionsBranding: true,
    onFreePlan: true,
    trialExpiresAtUnixEpoch: null,
};
const envelope = {
    extensionId: 'portal_example',
    language: 'en',
    themeColor: 'blue',
    enableCommentsOnChildForms: false,
    workspaceId: 'workspace_example',
    extensionOwnerUID: 'owner_example',
    faviconUrl: null,
    googleAnalyticsMeasurementId: null,
    isStarterExtension: false,
};

// Complete synthetic public envelopes; no remote key, fixture or network.
const makePortal = () =>
    structuredClone({
        ...envelope,
        extensionScreen: 'portal_loaded',
        payload: {
            ...display,
            extensionType: 'portal',
            extensionName: 'Example Portal',
            extensionAccessToken: 'portal_access_example',
            viewIdsToAirtableViews: {},
            publicFields: {},
            formRecord: {
                type: 'edit',
                tableId: 'tbl_users',
                recordId: 'rec_user',
                data: {
                    fld_children: ['rec_one'],
                    fld_prefill: 'prefill_Title=Example',
                },
            },
            fieldNamesToSchemas: { Children: linkSchema },
            fieldIdsToSchemas: {
                fld_children: linkSchema,
                fld_prefill: {
                    fieldType: prefillField.config.type,
                    airtableField: prefillField,
                },
            },
            linkedRecordFieldIdToDetailFields: detailFields,
            linkedRecordFieldIdToFieldsTitles: {
                fld_children: { fld_title: 'Title', fld_quantity: 'Count' },
            },
            cookieKeyForLoginToken: null,
            fieldIdsInPortal: ['fld_children'],
            usersTableFields: [linkField, prefillField],
            initialLinkedTableStates: {
                tbl_children: {
                    airtableFields: [titleField, quantityField],
                    recordIdsToAirtableRecords: {
                        rec_nested: {
                            id: 'rec_nested',
                            fields: { fld_title: 'Nested label' },
                        },
                    },
                },
            },
        },
    });

const deferred = () => {
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });
    return { promise, resolve: resolvePromise, reject: rejectPromise };
};

const page = (records, offset = null, overrides = {}) => ({
    airtableOffset: offset,
    recordIds: records.map(({ id }) => id),
    tableIdsToLinkedTableStates: {
        tbl_children: {
            airtableFields: structuredClone([titleField, quantityField]),
            recordIdsToAirtableRecords: Object.fromEntries(
                records.map((record) => [record.id, structuredClone(record)])
            ),
        },
    },
    customViewDetailFields: null,
    ...overrides,
});
const record = (id, title, quantity) => ({
    id,
    fields: {
        fld_title: title,
        ...(quantity === undefined ? {} : { fld_quantity: quantity }),
    },
});
const criteria = () => ({
    selectedCustomViewId: 'view_example',
    sortFieldsByEndUser: null,
    supportsEndUserSortCleanup: true,
    filtersByEndUser: null,
    supportsEndUserFilterCleanup: true,
    searchParamsMap: {},
    searchTerm: null,
});
const readOptions = { pagesToFetch: 1, refreshLoggedInPortalRecord: true };
const loadInput = () => ({
    shareId: 'share_example',
    recordId: null,
    query: {},
    context: { type: 'direct-url' },
});
const selection = () => ({
    portalFieldId: 'fld_children',
    criteria: criteria(),
});
const makeForm = (input) => {
    const access = input.childExtensionInfo.accessType;
    const parentField = {
        id: 'fld_parent',
        name: 'Parent',
        config: {
            type: 'multipleRecordLinks',
            options: {
                linkedTableId: 'tbl_users',
                inverseLinkFieldId: 'fld_children',
                isReversed: true,
                prefersSingleRecordLink: true,
            },
        },
    };
    const schemas = [titleField, quantityField, parentField].map((field) => ({
        fieldType: field.config.type,
        airtableField: structuredClone(field),
    }));
    const data = {
        fld_title: 'Initial child',
        fld_quantity: 2,
        fld_parent: ['rec_user'],
    };
    return {
        ...envelope,
        extensionId: 'child_example',
        extensionScreen: 'form_loaded',
        payload: {
            ...display,
            extensionType: 'form',
            extensionName: 'Child Form',
            extensionAccessToken: 'child_access_example',
            hasParentExtension: true,
            formRecord:
                access.type === 'create'
                    ? { type: 'create', data }
                    : {
                          type: 'edit',
                          recordId: access.childExtensionRecordId,
                          tableId: 'tbl_children',
                          data,
                      },
            formErrors: {},
            publicFields: {},
            fieldIdsInForm: ['fld_title', 'fld_quantity'],
            fieldNamesToSchemas: Object.fromEntries(
                schemas.map((schema) => [schema.airtableField.name, schema])
            ),
            fieldIdsToSchemas: Object.fromEntries(
                schemas.map((schema) => [schema.airtableField.id, schema])
            ),
            formFieldIdsWithUnsavedChanges: [],
            urlPrefilledFieldIds: ['fld_parent'],
            linkedRecordFieldIdToDetailFields: {},
            cookieKeyForLoginToken: null,
        },
    };
};
const childOptions = (access = { type: 'edit', recordId: 'rec_one' }) => ({
    access,
    configuredChildExtensionId: 'child_example',
    query: { child: 'example' },
    clientTimeZone: 'UTC',
    deviceFingerprint: { version: 1, visitorId: 'visitor_example' },
});

function makeClient(handlers = {}) {
    let session = {};
    const calls = [];
    const invoke = (operation, input, options, fallback) => {
        const call = { operation, input: structuredClone(input), options };
        calls.push(call);
        return Promise.resolve((handlers[operation] ?? fallback)(call));
    };
    const mutation = () => {
        throw new Error('Only an explicit guide action may dispatch mutations');
    };
    return {
        calls,
        getSession: () => ({ ...session }),
        setSession: (value) => {
            session = { ...value };
        },
        loadExtension: (input, options) =>
            invoke('load', input, options, ({ input }) =>
                input.childExtensionInfo ? makeForm(input) : makePortal()
            ),
        portals: {
            listLinkedRecords: (input, options) =>
                invoke('list', input, options, () => page([])),
            unlinkRecord: (input, options) =>
                invoke('unlink', input, options, () => undefined),
            updateGridCell: (input, options) =>
                invoke('grid', input, options, mutation),
            setKanbanCategory: (input, options) =>
                invoke('kanban', input, options, mutation),
        },
        forms: {
            save: (input, options) => invoke('save', input, options, mutation),
            deleteCurrentRecord: (input, options) =>
                invoke('delete', input, options, mutation),
        },
    };
}

// Shared only by repository verification scripts; these are complete synthetic
// public envelopes, never production fixtures or a replacement renderer.
export const portalRecipeFixtures = {
    makePortal,
    makeForm,
    page,
    record,
    deferred,
    titleField,
    quantityField,
};

/** Execute the actual shipped Portal recipe beside its installed archive. */
export async function checkPortalRecipe({ consumerDirectory, guideSources }) {
    const consumerRoot = realpathSync(consumerDirectory);
    const consumerRequire = createRequire(join(consumerRoot, 'package.json'));
    const installedRoot = realpathSync(
        join(consumerRoot, 'node_modules/@miniextensions/sdk')
    );
    assert(
        realpathSync(
            consumerRequire.resolve('@miniextensions/sdk/portals')
        ).startsWith(`${installedRoot}/dist/cjs/`),
        'Portal CommonJS must resolve the installed archive'
    );
    const actualFences = [
        ...readFileSync(
            join(installedRoot, 'docs/portals.md'),
            'utf8'
        ).matchAll(/```ts\n([\s\S]*?)\n```/g),
    ].map(([, text]) => text);
    const sources = guideSources.map((filename) => {
        const path = resolve(consumerRoot, filename);
        assert.equal(dirname(path), consumerRoot);
        assert.equal(realpathSync(path), path);
        return { path, text: readFileSync(path, 'utf8') };
    });
    assert.deepEqual(
        sources.map(({ text }) => text),
        actualFences,
        'Executed Portal recipes must match the installed archive docs'
    );
    const matches = sources.filter(({ text }) =>
        text.includes('export function createPortalScreenOwner(')
    );
    assert.equal(matches.length, 1, 'Missing unique Portal owner recipe');
    const { code } = await transform(matches[0].text, {
        loader: 'ts',
        format: 'esm',
        target: 'es2022',
    });
    const compiled = `${matches[0].path}.portal-recipe.mjs`;
    // Leave imports unbundled so all helpers resolve the installed package.
    writeFileSync(
        compiled,
        `${code}\nexport const portalRecipeSdkUrl = import.meta.resolve('@miniextensions/sdk/portals');\n`
    );
    const recipe = await import(pathToFileURL(compiled).href);
    assert(
        realpathSync(fileURLToPath(recipe.portalRecipeSdkUrl)).startsWith(
            `${installedRoot}/dist/esm/`
        ),
        'Executed Portal recipe must resolve installed ESM dist'
    );
    const failures = [];
    const check = async (name, exercise) => {
        try {
            await exercise();
        } catch (cause) {
            failures.push(new Error(name, { cause }));
        }
    };

    const owners = [];
    const createOwner = (client, callbacks = {}) => {
        const events = { screens: [], snapshots: [], reads: [], clears: 0 };
        const owner = recipe.createPortalScreenOwner({
            client,
            initialOwnerId: 'visitor_example',
            clearVisitorState() {
                events.clears++;
                callbacks.clear?.();
            },
            onScreen: (...args) => events.screens.push(args),
            onCollection(snapshot) {
                events.snapshots.push(snapshot);
                callbacks.collection?.(snapshot);
            },
            onRead: (outcome) => events.reads.push(outcome),
        });
        owners.push(owner);
        return { owner, events };
    };
    const lists = (client) =>
        client.calls.filter(({ operation }) => operation === 'list');
    const mutations = (client) =>
        client.calls.filter(({ operation }) =>
            ['unlink', 'save', 'grid', 'kanban', 'delete'].includes(operation)
        );

    try {
        await check(
            'Paging replaces projected records and schemas, deduplicates IDs and respects empty/final cursors',
            async () => {
                const first = page(
                    [
                        record('rec_one', 'One', 7),
                        record('rec_nested', 'Nested'),
                    ],
                    'cursor_two'
                );
                first.recordIds = ['rec_one'];
                const second = page(
                    [record('rec_one', 'Updated'), record('rec_two', 'Two', 0)],
                    'cursor_empty',
                    {
                        customViewDetailFields: {
                            fld_children: [detailFields.fld_children[0]],
                        },
                    }
                );
                second.recordIds = ['rec_one', 'rec_two', 'rec_two'];
                second.tableIdsToLinkedTableStates.tbl_children.airtableFields =
                    [structuredClone(titleField)];
                const pages = [
                    first,
                    second,
                    page([], 'cursor_final', { customViewDetailFields: {} }),
                    page([], null, {
                        customViewDetailFields: { fld_children: [] },
                    }),
                ];
                const client = makeClient({ list: () => pages.shift() });
                const { owner } = createOwner(client);
                await owner.load(loadInput(), selection());
                const initial = await owner.readFirst(readOptions);
                assert.equal(initial.type, 'loaded');
                assert.deepEqual(initial.snapshot.recordIds, ['rec_one']);
                assert.equal(initial.snapshot.detailFields.length, 2);
                assert.equal(initial.snapshot.layoutSettings.layout, 'list');
                assert.equal(
                    initial.snapshot.layoutSettings.disableInlineEdit,
                    undefined
                );
                assert.equal(
                    initial.snapshot.layoutSettings.allowUsersToUnlinkRecords,
                    undefined
                );
                const next = await owner.readNext(readOptions);
                assert.deepEqual(next.snapshot.recordIds, [
                    'rec_one',
                    'rec_two',
                ]);
                const table =
                    next.snapshot.tableIdsToLinkedTableStates.tbl_children;
                assert.deepEqual(
                    table.recordIdsToAirtableRecords.rec_one.fields,
                    { fld_title: 'Updated' }
                );
                assert.equal(
                    table.recordIdsToAirtableRecords.rec_two.fields
                        .fld_quantity,
                    0
                );
                assert.equal(
                    table.recordIdsToAirtableRecords.rec_nested.fields
                        .fld_title,
                    'Nested'
                );
                assert.deepEqual(
                    table.airtableFields.map(({ id }) => id),
                    ['fld_title']
                );
                assert.deepEqual(
                    next.snapshot.detailFields.map(({ fieldId }) => fieldId),
                    ['fld_title']
                );
                assert.deepEqual(
                    lists(client)[1].input.alreadyLoadedRecordIds,
                    ['rec_one']
                );
                const empty = await owner.readNext(readOptions);
                assert.equal(empty.snapshot.airtableOffset, 'cursor_final');
                assert.deepEqual(empty.snapshot.detailFields, []);
                assert.equal(lists(client).length, 3);
                const final = await owner.readNext(readOptions);
                assert.equal(final.snapshot.airtableOffset, null);
                assert.deepEqual(final.snapshot.detailFields, []);
                assert.equal(await owner.readNext(readOptions), null);
                assert.equal(lists(client).length, 4);
                assert.equal(mutations(client).length, 0);
            }
        );

        await check(
            'Duplicate reads preserve the accepted first callback and cleanup requires an explicit new collection/read',
            async () => {
                const response = deferred();
                let index = 0;
                const client = makeClient({
                    list: () => {
                        if (index++ === 0) return response.promise;
                        if (index === 2)
                            return page([], null, {
                                endUserSortCleanup: { sortFields: [] },
                                endUserFilterCleanup: { filters: null },
                            });
                        return page([record('rec_one', 'Fresh')]);
                    },
                });
                const { owner, events } = createOwner(client);
                await owner.load(loadInput(), selection());
                const first = owner.readFirst(readOptions);
                await assert.rejects(
                    owner.readFirst(readOptions),
                    /already|pending|progress/
                );
                assert.equal(lists(client).length, 1);
                response.resolve(
                    page([record('rec_one', 'One')], 'cursor_two')
                );
                assert.equal((await first).type, 'loaded');
                assert.equal(events.reads.length, 1);
                assert.equal(events.reads[0].type, 'loaded');
                const cleanup = await owner.readFirst(readOptions);
                assert.equal(cleanup.type, 'criteria-cleanup-required');
                assert.deepEqual(cleanup.raw.endUserSortCleanup.sortFields, []);
                assert.equal(lists(client).length, 2);
                await assert.rejects(owner.readNext(readOptions));
                const accepted = criteria();
                accepted.sortFieldsByEndUser = [];
                assert.equal(owner.acceptCleanup(accepted), null);
                assert.equal(lists(client).length, 2);
                assert.equal(
                    (await owner.readFirst(readOptions)).type,
                    'loaded'
                );
                assert.equal(lists(client).length, 3);
                assert.deepEqual(
                    lists(client)[2].input.sortFieldsByEndUser,
                    []
                );
                assert.deepEqual(
                    lists(client)[2].input.alreadyLoadedRecordIds,
                    []
                );
                assert.equal(mutations(client).length, 0);
            }
        );

        await check(
            'Child requests use current membership and preserve captured Form baseline and save context',
            async () => {
                const portalResponse = deferred();
                const childResponse = deferred();
                let childInput;
                const client = makeClient({
                    load: ({ input }) => {
                        if (!input.childExtensionInfo)
                            return portalResponse.promise;
                        childInput = input;
                        return childResponse.promise;
                    },
                    list: () => {
                        const result = page(
                            [
                                record('rec_one', 'One'),
                                record('rec_nested', 'Cached'),
                            ],
                            'cursor_next'
                        );
                        result.recordIds = ['rec_one'];
                        return result;
                    },
                });
                const { owner } = createOwner(client);
                const input = loadInput();
                const selected = selection();
                const pendingLoad = owner.load(input, selected);
                input.shareId = 'mutated_share';
                selected.portalFieldId = 'mutated_field';
                selected.criteria.searchTerm = 'mutated search';
                const portal = makePortal();
                portalResponse.resolve(portal);
                await pendingLoad;
                portal.payload.extensionAccessToken = 'mutated_token';
                await owner.readFirst(readOptions);
                assert.equal(
                    lists(client)[0].input.portalFieldId,
                    'fld_children'
                );
                assert.equal(lists(client)[0].input.searchTerm, null);
                assert.equal(
                    lists(client)[0].input.extensionAccessToken,
                    'portal_access_example'
                );
                await assert.rejects(
                    owner.openChild(
                        childOptions({ type: 'edit', recordId: 'rec_nested' })
                    )
                );
                assert.equal(
                    client.calls.filter(({ operation }) => operation === 'load')
                        .length,
                    1
                );
                const chosen = childOptions();
                const pendingChild = owner.openChild(chosen);
                chosen.access.recordId = 'mutated_record';
                chosen.configuredChildExtensionId = 'mutated_child';
                chosen.query.child = 'mutated query';
                childResponse.resolve(makeForm(childInput));
                const child = await pendingChild;
                assert(child?.isCurrent());
                assert.equal(
                    childInput.childExtensionAccessData
                        .parentExtensionAccessToken,
                    'portal_access_example'
                );
                assert.equal(
                    childInput.childExtensionAccessData
                        .fieldIdUsedToAccessExtension,
                    'fld_children'
                );
                assert.equal(
                    childInput.context.linkedTableIdOfLinkedRecordField,
                    'tbl_children'
                );
                assert.equal(
                    childInput.childExtensionInfo.accessType
                        .childExtensionRecordId,
                    'rec_one'
                );
                assert.deepEqual(child.saveContext, {
                    type: 'modal',
                    prefillData: null,
                });
                const { FormDraftStore, openLoadedFormDraft } = consumerRequire(
                    '@miniextensions/sdk/forms'
                );
                const store = new FormDraftStore();
                const handle = openLoadedFormDraft({
                    store,
                    loaded: child.loaded,
                    parent: child.parent,
                });
                store.write(handle, 'fld_title', 'Edited child');
                child.loaded.payload.extensionAccessToken =
                    'mutated_child_token';
                child.saveContext.type = 'direct-url';
                const draft = store.snapshot(handle);
                const save = child.makeSaveInput(draft, {
                    captchaVal: null,
                    isComputeMode: false,
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                });
                assert.equal(save.extensionAccessToken, 'child_access_example');
                assert.equal(save.formRecord.data.fld_title, 'Edited child');
                assert.deepEqual(save.formRecord.data.fld_parent, ['rec_user']);
                assert.deepEqual(save.formFieldIdsWithUnsavedChanges, [
                    'fld_parent',
                    'fld_title',
                ]);
                assert.deepEqual(save.context, {
                    type: 'modal',
                    prefillData: null,
                });
                assert.deepEqual(save.searchQuery, { child: 'example' });
                assert.deepEqual(save.deviceFingerprint, {
                    version: 1,
                    visitorId: 'visitor_example',
                });
                assert.equal(mutations(client).length, 0);
                await owner.readFirst(readOptions);
                assert(!child.isCurrent());
                assert.throws(
                    () =>
                        child.makeSaveInput(draft, {
                            captchaVal: null,
                            isComputeMode: false,
                            conditionalLinkedRecordFieldIdsToFilteringValues:
                                {},
                        }),
                    /Stale/
                );
                store.clear();
            }
        );

        await check(
            'ABA and dispatched cancellation block old callbacks and mutation eligibility; pre-abort does not dispatch',
            async () => {
                const cancelled = deferred();
                let index = 0;
                const client = makeClient({
                    list: () =>
                        index++ === 1
                            ? cancelled.promise
                            : page([record('rec_one', 'One')], 'cursor_next'),
                });
                const { owner, events } = createOwner(client);
                await owner.load(loadInput(), selection());
                await owner.readFirst(readOptions);
                const preAborted = new AbortController();
                preAborted.abort();
                await assert.rejects(
                    owner.readNext({
                        ...readOptions,
                        signal: preAborted.signal,
                    })
                );
                assert.equal(lists(client).length, 1);
                const signal = new AbortController();
                const pending = owner.readNext({
                    ...readOptions,
                    signal: signal.signal,
                });
                const rejected = assert.rejects(pending);
                signal.abort();
                cancelled.resolve(page([record('rec_two', 'Late')]));
                await rejected;
                await assert.rejects(owner.unlink('rec_one'), /fresh|read/i);
                assert.equal(mutations(client).length, 0);
                await owner.readFirst(readOptions);
                const last = deferred();
                client.portals.listLinkedRecords = (input, options) => {
                    client.calls.push({
                        operation: 'list',
                        input: structuredClone(input),
                        options,
                    });
                    return last.promise;
                };
                const stale = owner.readNext(readOptions);
                const staleRejected = assert.rejects(stale);
                const readCount = events.reads.length;
                const revision = owner.getScope().revision;
                owner.changeOwner('visitor_other');
                owner.changeOwner('visitor_example');
                assert.equal(owner.getScope().revision, revision + 2);
                last.resolve(page([record('rec_retired', 'Retired')]));
                await staleRejected;
                assert.equal(events.reads.length, readCount);
                assert.equal(mutations(client).length, 0);
            }
        );

        await check(
            'Accepted responses and reentrant application callbacks cannot render or mutate a retired owner',
            async () => {
                const response = deferred();
                const client = makeClient({ list: () => response.promise });
                const { owner, events } = createOwner(client);
                await owner.load(loadInput(), selection());
                const readSession = client.getSession;
                let armed = false;
                let queued = false;
                let activeAtTransition = false;
                client.getSession = () => {
                    if (armed && !queued) {
                        queued = true;
                        queueMicrotask(() => {
                            activeAtTransition =
                                !lists(client)[0].options.signal.aborted;
                            owner.changeOwner('visitor_example');
                        });
                    }
                    return readSession();
                };
                const pending = owner.readFirst(readOptions);
                const before = events.snapshots.length;
                const raw = page([record('rec_one', 'Never accepted by app')]);
                let projectionReads = 0;
                Object.defineProperty(raw, 'customViewDetailFields', {
                    enumerable: true,
                    get() {
                        projectionReads++;
                        armed = true;
                        return null;
                    },
                });
                response.resolve(raw);
                assert.equal(await pending, null);
                assert.equal(projectionReads, 1);
                assert(
                    queued && activeAtTransition,
                    'The owner changed after the helper accepted the projected response'
                );
                assert(
                    !lists(client)[0].options.signal.aborted,
                    'The accepted helper attempt had already detached'
                );
                assert.equal(events.snapshots.length, before);
                assert.equal(events.reads.length, 0);
                assert.equal(mutations(client).length, 0);

                const nextClient = makeClient({
                    list: () => page([record('rec_one', 'One')]),
                });
                let nextOwner;
                const next = createOwner(nextClient, {
                    collection(snapshot) {
                        if (snapshot) nextOwner.changeOwner('visitor_other');
                    },
                });
                nextOwner = next.owner;
                await nextOwner.load(loadInput(), selection());
                assert.equal(await nextOwner.readFirst(readOptions), null);
                assert.equal(next.events.reads.length, 0);
                assert.equal(mutations(nextClient).length, 0);
            }
        );
    } finally {
        for (const owner of owners) owner.destroy();
    }
    if (failures.length)
        throw new AggregateError(
            failures,
            'Shipped Portal recipe checks failed'
        );
    return { checks: 5 };
}
