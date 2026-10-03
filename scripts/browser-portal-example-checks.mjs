import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

const { makePortal, makeForm, page, record, deferred } = portalRecipeFixtures;
const buttons = (root, title) =>
    [...root.querySelectorAll('button')].filter(
        (node) => node.textContent?.trim() === title
    );
const button = (root, title) => {
    const found = buttons(root, title)[0];
    assert(found, `Missing actual example button: ${title}`);
    return found;
};
const rowIds = (root) =>
    [...root.querySelectorAll('tbody tr')].map((row) => row.dataset.recordId);
const change = (window, node, type = 'change') =>
    node.dispatchEvent(new window.Event(type, { bubbles: true }));
const submit = (window, node) =>
    node.dispatchEvent(
        new window.Event('submit', { bubbles: true, cancelable: true })
    );
const waitFor = async (predicate) => {
    for (let turn = 0; turn < 100; turn++) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Actual packed example did not reach the expected state.');
};
const editablePortal = () => {
    const portal = makePortal();
    const config = portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
    config.disableInlineEdit = false;
    config.customViews = [
        { id: 'view_example', config: { name: 'Example view' } },
        { id: 'view_other', config: { name: 'Other view' } },
        {
            id: 'view_readonly',
            config: { name: 'Read only', disableEditingForCustomView: true },
        },
    ];
    return portal;
};

/** Run the copied browser sources with only the installed archive as their SDK. */
export async function checkBrowserPortalExample({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(import.meta.url);
    const { Window } = require(happyDomModulePath);
    const consumerRequire = createRequire(join(consumer, 'package.json'));
    const { createMiniExtensionsClient } = consumerRequire(
        '@miniextensions/sdk'
    );
    for (const name of ['portal', 'main']) {
        const bundled = await build({
            absWorkingDir: consumer,
            entryPoints: [join(consumer, 'src', `${name}.ts`)],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            outfile: join(consumer, '.generated', `${name}-checks.mjs`),
            logLevel: 'silent',
            metafile: true,
        });
        await assertBrowserInputs(bundled.metafile, consumer);
    }
    let revision = 0;
    const loadExample = (name) =>
        import(
            `${pathToFileURL(join(consumer, '.generated', `${name}-checks.mjs`)).href}?case=${++revision}`
        );
    const environments = [];
    const environment = async (fetch) => {
        const window = new Window({
            url: 'https://example.test',
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
            Option,
            fetch:
                fetch ??
                (async () => {
                    throw new Error('Packed example attempted live network.');
                }),
        };
        const previous = Object.keys(globals).map((key) => [
            key,
            Object.getOwnPropertyDescriptor(globalThis, key),
        ]);
        Object.assign(globalThis, globals);
        let closed = false;
        const close = async () => {
            if (closed) return;
            closed = true;
            for (const [key, descriptor] of previous) {
                if (descriptor === undefined)
                    Reflect.deleteProperty(globalThis, key);
                else Object.defineProperty(globalThis, key, descriptor);
            }
            await window.happyDOM.close();
        };
        environments.push(close);
        return { window, close };
    };
    const mount = async ({ portal = editablePortal(), handlers = {} } = {}) => {
        const { window, close } = await environment();
        const { createPortalView } = await loadExample('portal');
        const calls = [];
        const handoffs = [];
        const failures = [];
        const statuses = [];
        const actions = [];
        let scopeRevision = 0;
        let controller;
        const client = createMiniExtensionsClient({
            apiOrigin: 'https://sdk.example.test',
            fetch: async () => {
                throw new Error('Unexpected packed fixture network.');
            },
        });
        const invoke = async (operation, input, options, fallback) => {
            const call = { operation, input: structuredClone(input), options };
            calls.push(call);
            return (handlers[operation] ?? fallback)(call);
        };
        client.portals.listLinkedRecords = (input, options) =>
            invoke('list', input, options, () => page([]));
        client.loadExtension = (input, options) =>
            invoke('child', input, options, ({ input }) => makeForm(input));
        client.portals.updateGridCell = (input, options) =>
            invoke('grid', input, options, () => {
                throw new Error('Unexpected grid write.');
            });
        client.portals.getUserRecord = (input, options) =>
            invoke('parent', input, options, () => null);
        client.portals.unlinkRecord = (input, options) =>
            invoke('unlink', input, options, () => {
                throw new Error('Unexpected unlink write.');
            });
        const view = createPortalView({
            page: portal,
            client,
            getScope: () => ({ ownerId: 'visitor_A', revision: scopeRevision }),
            run: (_description, action) => {
                controller = new AbortController();
                const ownController = controller;
                const ownRevision = scopeRevision;
                const pending = Promise.resolve()
                    .then(() =>
                        action({
                            client,
                            signal: ownController.signal,
                            current: () =>
                                !ownController.signal.aborted &&
                                ownRevision === scopeRevision,
                        })
                    )
                    .catch((error) => failures.push(error));
                actions.push(pending);
                return pending;
            },
            status: (...args) => statuses.push(args),
            confirm: async () => true,
            openChild: (...args) => handoffs.push(args),
        });
        window.document.getElementById('screen').append(view.node);
        const settle = async () => Promise.all(actions);
        const click = async (title) => {
            button(view.node, title).click();
            await settle();
        };
        const dispose = async () => {
            view.destroy();
            await close();
        };
        return {
            window,
            view,
            portal,
            calls,
            handoffs,
            failures,
            statuses,
            settle,
            click,
            dispose,
            abort: () => controller.abort(),
            retire: () => {
                scopeRevision += 1;
                view.retireCollection();
            },
        };
    };
    const failures = [];
    let checks = 0;
    const check = async (name, exercise) => {
        try {
            await exercise();
            checks += 1;
            console.log(`Packed browser Portal ${checks}: ${name} passed`);
        } catch (cause) {
            failures.push(
                new Error(`Packed browser Portal: ${name}`, { cause })
            );
        } finally {
            // Each real example instance gets its own DOM and global restoration.
            while (environments.length) await environments.pop()();
        }
    };
    try {
        await check(
            'explicit first/next pages and immutable fixed criteria',
            async () => {
                const first = page(
                    [
                        record('rec_one', 'First', 4),
                        record('rec_two', 'Second', 7),
                    ],
                    'offset_one'
                );
                first.tableIdsToLinkedTableStates.tbl_nested = {
                    airtableFields: [],
                    recordIdsToAirtableRecords: {
                        rec_nested: {
                            id: 'rec_nested',
                            fields: { fld_label: 'Nested' },
                        },
                    },
                };
                first.recordIds.push('rec_one');
                const second = page([
                    record('rec_one', 'Replacement'),
                    record('rec_three', 'Third', 9),
                ]);
                const pages = [first, second];
                const h = await mount({
                    handlers: { list: () => pages.shift() },
                });
                assert.equal(
                    h.calls.length,
                    0,
                    'Rendering must not read or write.'
                );
                await h.click('Load records');
                assert.deepEqual(rowIds(h.view.node), ['rec_one', 'rec_two']);
                await h.click('Next page');
                assert.deepEqual(rowIds(h.view.node), [
                    'rec_one',
                    'rec_two',
                    'rec_three',
                ]);
                const replaced = h.view.node.querySelector(
                    '[data-record-id="rec_one"]'
                );
                assert.equal(
                    replaced.querySelectorAll('td')[0].textContent,
                    'ReplacementEdit cell'
                );
                assert.equal(
                    replaced.querySelectorAll('td')[1].textContent,
                    'Edit cell'
                );
                assert.equal(
                    h.view.node.querySelector('[data-record-id="rec_nested"]'),
                    null
                );
                assert.equal(button(h.view.node, 'Next page').disabled, true);
                for (const call of h.calls) {
                    assert.equal(call.operation, 'list');
                    assert.equal(call.input.portalFieldId, 'fld_children');
                    assert.equal(
                        call.input.selectedCustomViewId,
                        'view_example'
                    );
                    assert.equal(call.input.searchTerm, null);
                    assert.equal(call.input.sortFieldsByEndUser, null);
                    assert.equal(call.input.filtersByEndUser, null);
                    assert.deepEqual(call.input.searchParamsMap, {});
                    assert.equal(call.input.pagesToFetch, 1);
                }
                assert.deepEqual(h.calls[0].input.alreadyLoadedRecordIds, []);
                assert.equal(h.calls[0].input.airtableOffset, null);
                assert.equal(
                    h.calls[0].input.refreshLoggedInPortalRecord,
                    true
                );
                assert.deepEqual(h.calls[1].input.alreadyLoadedRecordIds, [
                    'rec_one',
                    'rec_two',
                ]);
                assert.equal(h.calls[1].input.airtableOffset, 'offset_one');
                assert.equal(
                    h.calls[1].input.refreshLoggedInPortalRecord,
                    false
                );
                assert.equal(h.failures.length, 0);
                await h.dispose();
            }
        );

        await check(
            'field/view/search changes retire late reads without auto dispatch',
            async () => {
                for (const kind of ['field', 'view', 'search']) {
                    const late = deferred();
                    const portal = editablePortal();
                    const alternate = structuredClone(
                        portal.payload.fieldIdsToSchemas.fld_children
                    );
                    alternate.airtableField.id = 'fld_alternate';
                    alternate.airtableField.name = 'Alternate';
                    portal.payload.fieldIdsToSchemas.fld_alternate = alternate;
                    portal.payload.fieldIdsInPortal.push('fld_alternate');
                    portal.payload.linkedRecordFieldIdToDetailFields.fld_alternate =
                        structuredClone(
                            portal.payload.linkedRecordFieldIdToDetailFields
                                .fld_children
                        );
                    let reads = 0;
                    const h = await mount({
                        portal,
                        handlers: {
                            list: () =>
                                ++reads === 1
                                    ? late.promise
                                    : page([record('rec_fresh', 'Fresh')]),
                        },
                    });
                    button(h.view.node, 'Load records').click();
                    await waitFor(() => reads === 1);
                    const selects =
                        h.view.node.querySelectorAll('.toolbar select');
                    if (kind === 'field') {
                        selects[0].value = 'fld_alternate';
                        change(h.window, selects[0]);
                    } else if (kind === 'view') {
                        selects[1].value = 'view_other';
                        change(h.window, selects[1]);
                    } else {
                        const search = h.view.node.querySelector(
                            'input[placeholder="Search this table"]'
                        );
                        search.value = 'new query';
                        change(h.window, search, 'input');
                    }
                    assert.equal(reads, 1);
                    assert.deepEqual(rowIds(h.view.node), []);
                    assert.equal(
                        button(h.view.node, 'Next page').disabled,
                        true
                    );
                    late.resolve(
                        page([record('rec_stale', 'Stale')], 'stale_offset')
                    );
                    await h.settle();
                    assert.deepEqual(rowIds(h.view.node), []);
                    await h.click('Load records');
                    assert.deepEqual(rowIds(h.view.node), ['rec_fresh']);
                    const input = h.calls.filter(
                        (call) => call.operation === 'list'
                    )[1].input;
                    assert.equal(
                        input.portalFieldId,
                        kind === 'field' ? 'fld_alternate' : 'fld_children'
                    );
                    assert.equal(
                        input.selectedCustomViewId,
                        kind === 'view' ? 'view_other' : 'view_example'
                    );
                    assert.equal(
                        input.searchTerm,
                        kind === 'search' ? 'new query' : null
                    );
                    assert.deepEqual(input.alreadyLoadedRecordIds, []);
                    assert.equal(input.airtableOffset, null);
                    await h.dispose();
                }
            }
        );

        await check(
            'cleanup clears rows/cursor/child eligibility and empty detail projection stays empty',
            async () => {
                const pages = [
                    page([record('rec_one', 'First')], 'offset_one'),
                    page([], null, {
                        endUserSortCleanup: { sortFields: [] },
                        endUserFilterCleanup: { filters: null },
                    }),
                    page([record('rec_fresh', 'Hidden fallback')], null, {
                        customViewDetailFields: {},
                    }),
                ];
                const h = await mount({
                    handlers: { list: () => pages.shift() },
                });
                await h.click('Load records');
                const oldChild = button(h.view.node, 'Open Form');
                await h.click('Next page');
                assert.deepEqual(rowIds(h.view.node), []);
                assert.equal(button(h.view.node, 'Next page').disabled, true);
                assert.equal(
                    button(h.view.node, 'Create record').disabled,
                    true
                );
                oldChild.click();
                await h.settle();
                await h.click('Load records');
                assert.equal(
                    h.calls.length,
                    2,
                    'Cleanup requires explicit Portal recovery, never a silent read.'
                );
                assert.equal(h.handoffs.length, 0);
                h.view.refreshRequired();
                await h.click('Load records');
                assert.deepEqual(rowIds(h.view.node), ['rec_fresh']);
                assert.deepEqual(
                    [...h.view.node.querySelectorAll('thead th')].map(
                        (node) => node.textContent
                    ),
                    ['Actions']
                );
                assert.doesNotMatch(h.view.node.textContent, /Hidden fallback/);
                await h.dispose();
            }
        );

        await check(
            'create/edit canonical plans and only current main-view records can edit',
            async () => {
                let reads = 0;
                const h = await mount({
                    handlers: {
                        list: () => {
                            reads += 1;
                            if (reads === 1)
                                return page([
                                    record('rec_one', 'Main'),
                                    record('rec_nested', 'Initially main'),
                                ]);
                            const next = page([
                                record('rec_current', 'Current'),
                            ]);
                            next.tableIdsToLinkedTableStates.tbl_children.recordIdsToAirtableRecords.rec_one =
                                record('rec_one', 'Cache only');
                            next.tableIdsToLinkedTableStates.tbl_nested = {
                                airtableFields: [],
                                recordIdsToAirtableRecords: {
                                    rec_nested: record(
                                        'rec_nested',
                                        'Nested only'
                                    ),
                                },
                            };
                            return next;
                        },
                    },
                });
                await h.click('Create record');
                assert.equal(
                    h.calls.length,
                    1,
                    'Create may load a Form before a list, without creating a record.'
                );
                const create = h.calls[0].input;
                assert.deepEqual(create.childExtensionAccessData, {
                    parentExtensionAccessToken: 'portal_access_example',
                    fieldIdUsedToAccessExtension: 'fld_children',
                });
                assert.deepEqual(create.childExtensionInfo, {
                    childExtensionId: 'child_example',
                    accessType: { type: 'create' },
                });
                const prefill = {
                    toLinkToParent: {
                        reversedFieldIdToPrefill: 'fld_parent',
                        parentFormRecordId: 'rec_user',
                    },
                    prefillQueryForChildExtension: 'prefill_Title=Example',
                };
                assert.deepEqual(create.context, {
                    type: 'modal',
                    linkedTableIdOfLinkedRecordField: 'tbl_children',
                    prefillDataForLinkedRecordsForm: prefill,
                });
                assert.deepEqual(h.handoffs[0][1], {
                    type: 'modal',
                    prefillData: prefill,
                });
                assert.deepEqual(h.handoffs[0][2], {
                    portalId: 'portal_example',
                    recordId: 'rec_user',
                    portalFieldId: 'fld_children',
                });
                await h.click('Load records');
                const oldChildren = buttons(h.view.node, 'Open Form');
                await h.click('Open Form');
                const edit = h.calls.findLast(
                    (call) => call.operation === 'child'
                ).input;
                assert.deepEqual(edit.childExtensionInfo.accessType, {
                    type: 'edit',
                    childExtensionRecordId: 'rec_one',
                    childExtensionFieldId: null,
                });
                assert.deepEqual(edit.context, {
                    type: 'modal',
                    linkedTableIdOfLinkedRecordField: 'tbl_children',
                    prefillDataForLinkedRecordsForm: null,
                });
                assert.deepEqual(h.handoffs[1][1], {
                    type: 'modal',
                    prefillData: null,
                });
                await h.click('Load records');
                assert.deepEqual(rowIds(h.view.node), ['rec_current']);
                const childCalls = h.calls.filter(
                    (call) => call.operation === 'child'
                ).length;
                for (const old of oldChildren) {
                    old.click();
                    await h.settle();
                }
                assert.equal(
                    h.calls.filter((call) => call.operation === 'child').length,
                    childCalls
                );
                assert.equal(h.failures.length, 2);
                assert(
                    h.failures.every(
                        (error) => error.code === 'record-not-listed'
                    )
                );
                await h.click('Open Form');
                assert.equal(h.handoffs.length, 3);
                assert.equal(
                    h.handoffs[2][0].payload.formRecord.recordId,
                    'rec_current'
                );
                await h.dispose();
            }
        );

        await check(
            'failed/cancelled next pages require a fresh first read, and retirement drops child responses',
            async () => {
                for (const cancelled of [false, true]) {
                    const late = deferred();
                    let reads = 0;
                    const h = await mount({
                        handlers: {
                            list: () => {
                                reads += 1;
                                if (reads === 2) return late.promise;
                                return page(
                                    [record('rec_one', 'Accepted')],
                                    'offset_one'
                                );
                            },
                        },
                    });
                    await h.click('Load records');
                    const child = button(h.view.node, 'Open Form');
                    button(h.view.node, 'Next page').click();
                    await waitFor(() => reads === 2);
                    if (cancelled) {
                        h.abort();
                        late.resolve(page([record('rec_late', 'Late')]));
                    } else
                        late.reject(new Error('Synthetic next-page failure.'));
                    await h.settle();
                    assert.deepEqual(rowIds(h.view.node), ['rec_one']);
                    assert.equal(
                        button(h.view.node, 'Next page').disabled,
                        true
                    );
                    assert.equal(
                        button(h.view.node, 'Create record').disabled,
                        true
                    );
                    child.click();
                    await h.settle();
                    assert.equal(
                        h.calls.filter((call) => call.operation === 'child')
                            .length,
                        0
                    );
                    await h.click('Load records');
                    await h.click('Open Form');
                    assert.equal(h.handoffs.length, 1);
                    await h.dispose();
                }
                const lateChild = deferred();
                const h = await mount({
                    handlers: { child: () => lateChild.promise },
                });
                button(h.view.node, 'Create record').click();
                await waitFor(() => h.calls.length === 1);
                h.retire();
                lateChild.resolve(makeForm(h.calls[0].input));
                await h.settle();
                assert.equal(h.handoffs.length, 0);
                assert.equal(
                    button(h.view.node, 'Create record').disabled,
                    true
                );
                await h.dispose();
            }
        );

        await check(
            'view/config permissions and returned child identity gate handoff',
            async () => {
                const h = await mount({
                    handlers: { list: () => page([record('rec_one', 'Main')]) },
                });
                await h.click('Load records');
                const oldChild = button(h.view.node, 'Open Form');
                const viewSelect =
                    h.view.node.querySelectorAll('.toolbar select')[1];
                viewSelect.value = 'view_readonly';
                change(h.window, viewSelect);
                await h.click('Load records');
                assert.equal(buttons(h.view.node, 'Open Form').length, 0);
                oldChild.click();
                await h.settle();
                assert.equal(
                    h.calls.filter((call) => call.operation === 'child').length,
                    0
                );
                assert.equal(h.failures[0]?.code, 'child-not-configured');
                await h.dispose();

                const portal = editablePortal();
                portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig.allowCreatingRecords = false;
                const forbidden = await mount({ portal });
                assert.equal(
                    button(forbidden.view.node, 'Create record').disabled,
                    true
                );
                assert.equal(forbidden.calls.length, 0);
                await forbidden.dispose();

                for (const invalid of ['extension', 'record', 'table']) {
                    const mismatch = await mount({
                        handlers: {
                            list: () => page([record('rec_one', 'Main')]),
                            child: ({ input }) => {
                                const form = makeForm(input);
                                if (invalid === 'extension')
                                    form.extensionId = 'wrong_child';
                                if (invalid === 'record')
                                    form.payload.formRecord.recordId =
                                        'wrong_record';
                                if (invalid === 'table')
                                    form.payload.formRecord.tableId =
                                        'wrong_table';
                                return form;
                            },
                        },
                    });
                    await mismatch.click('Load records');
                    await mismatch.click('Open Form');
                    assert.equal(mismatch.handoffs.length, 0);
                    assert.equal(mismatch.failures.length, 1);
                    assert.match(
                        mismatch.failures[0].message,
                        /does not match this request/
                    );
                    await mismatch.dispose();
                }
            }
        );

        await check(
            'parent refresh rebinds create prefills; a failed refresh blocks child reuse',
            async () => {
                for (const failed of [false, true]) {
                    const h = await mount({
                        handlers: {
                            list: () =>
                                page([record('rec_one', 'Editable', 1)]),
                            grid: ({ input }) => ({
                                record: {
                                    id: input.recordId,
                                    fields: {
                                        [input.recordFieldId]: input.value,
                                    },
                                },
                                auditTrail: null,
                                auditTrails: [],
                            }),
                            parent: () => {
                                if (failed)
                                    throw new Error(
                                        'Synthetic parent refresh failure.'
                                    );
                                return {
                                    id: 'rec_user',
                                    fields: {
                                        fld_prefill: 'prefill_Title=Updated',
                                    },
                                };
                            },
                        },
                    });
                    await h.click('Load records');
                    const oldChild = button(h.view.node, 'Open Form');
                    button(h.view.node, 'Edit cell').click();
                    const control = h.view.node.querySelector(
                        'input[data-field-id="fld_title"]'
                    );
                    assert(control);
                    control.value = 'Saved title';
                    change(h.window, control);
                    submit(h.window, control.closest('form'));
                    await h.settle();
                    assert.equal(
                        h.calls.filter((call) => call.operation === 'grid')
                            .length,
                        1
                    );
                    oldChild.click();
                    await h.settle();
                    assert.equal(
                        h.calls.filter((call) => call.operation === 'child')
                            .length,
                        0
                    );
                    assert.equal(
                        button(h.view.node, 'Create record').disabled,
                        true
                    );
                    await h.click('Load records');
                    if (failed) {
                        assert.equal(
                            h.calls.filter((call) => call.operation === 'list')
                                .length,
                            1
                        );
                        assert.equal(h.failures.length, 1);
                    } else {
                        await h.click('Create record');
                        assert.equal(h.handoffs.length, 1);
                        assert.equal(
                            h.handoffs[0][1].prefillData
                                .prefillQueryForChildExtension,
                            'prefill_Title=Updated'
                        );
                    }
                    await h.dispose();
                }
            }
        );

        await check(
            'local invalid Grid values preserve accepted read/child context without dispatch',
            async () => {
                const result = page(
                    [
                        {
                            id: 'rec_one',
                            fields: {
                                fld_title: [
                                    {
                                        id: 'att_example',
                                        url: 'https://files.example.test/example',
                                        filename: 'example.txt',
                                    },
                                ],
                            },
                        },
                    ],
                    'offset_one'
                );
                result.tableIdsToLinkedTableStates.tbl_children.airtableFields[0] =
                    {
                        id: 'fld_title',
                        name: 'Attachments',
                        config: { type: 'multipleAttachments' },
                    };
                const h = await mount({ handlers: { list: () => result } });
                await h.click('Load records');
                button(h.view.node, 'Edit cell').click();
                const control = h.view.node.querySelector(
                    'textarea[data-field-id="fld_title"]'
                );
                assert(control);
                submit(h.window, control.closest('form'));
                await h.settle();
                assert.equal(
                    h.calls.filter((call) => call.operation === 'grid').length,
                    0
                );
                assert.equal(h.failures.length, 1);
                assert.match(
                    h.failures[0].message,
                    /Use the child Form for this complex field type/
                );
                assert.equal(
                    h.view.node.querySelector(
                        'textarea[data-field-id="fld_title"]'
                    ),
                    control
                );
                assert.equal(button(h.view.node, 'Next page').disabled, false);
                assert.equal(
                    button(h.view.node, 'Create record').disabled,
                    false
                );
                await h.click('Create record');
                assert.equal(h.handoffs.length, 1);
                await h.dispose();
            }
        );

        await check(
            'actual main cancelled/rejected Grid writes preserve drafts and require Portal Reload without replay',
            async () => {
                for (const cancelled of [true, false]) {
                    const portal = editablePortal();
                    const lateGrid = deferred();
                    const calls = [];
                    let gridWrites = 0;
                    let serverPrefill = 'prefill_Title=Example';
                    const fetch = async (input, init) => {
                        const url = new URL(String(input));
                        const route =
                            url.searchParams.get('route') ?? url.pathname;
                        const body = JSON.parse(String(init?.body ?? '{}'));
                        calls.push({ route, body });
                        if (route === 'fetchExtensionForEndUser') {
                            if (body.childExtensionInfo)
                                return new Response(
                                    JSON.stringify(makeForm(body))
                                );
                            const fresh = structuredClone(portal);
                            fresh.payload.formRecord.data.fld_prefill =
                                serverPrefill;
                            return new Response(JSON.stringify(fresh));
                        }
                        if (route === 'fetchRecordsForLinkedTableOnPortal')
                            return new Response(
                                JSON.stringify(
                                    page(
                                        [record('rec_one', 'Current', 1)],
                                        'offset_one'
                                    )
                                )
                            );
                        if (route === '/api/trpc/airtable.updatePortalRecord') {
                            gridWrites += 1;
                            serverPrefill = 'prefill_Title=Committed';
                            if (cancelled) return lateGrid.promise;
                            throw new Error(
                                'Synthetic connection lost after server commit.'
                            );
                        }
                        throw new Error(
                            `Unexpected packed Grid recovery route: ${route}`
                        );
                    };
                    const { window, close } = await environment(fetch);
                    await loadExample('main');
                    const document = window.document;
                    document.getElementById('api-origin').value =
                        'https://sdk.example.test';
                    document.getElementById('share-id').value = 'share_example';
                    submit(window, document.getElementById('connection-form'));
                    await waitFor(
                        () => buttons(document, 'Load records').length === 1
                    );
                    button(document, 'Load records').click();
                    await waitFor(
                        () => buttons(document, 'Edit cell').length > 0
                    );
                    button(document, 'Edit cell').click();
                    const control = document.querySelector(
                        'input[data-field-id="fld_title"]'
                    );
                    assert(control);
                    control.value = 'Saved draft';
                    change(window, control, 'input');
                    const editor = control.closest('form');
                    submit(window, editor);
                    await waitFor(() => gridWrites === 1);
                    if (cancelled) {
                        assert.equal(
                            document.getElementById('screen').inert,
                            true
                        );
                        assert.equal(
                            document.getElementById('cancel').disabled,
                            false
                        );
                        document.getElementById('cancel').click();
                    }
                    await waitFor(
                        () => document.getElementById('screen').inert === false
                    );
                    assert.equal(
                        document.querySelector(
                            'input[data-field-id="fld_title"]'
                        ),
                        control
                    );
                    assert.equal(control.value, 'Saved draft');
                    assert.equal(button(document, 'Next page').disabled, true);
                    assert.equal(
                        button(document, 'Create record').disabled,
                        true
                    );
                    const before = calls.length;
                    button(document, 'Open Form').click();
                    button(document, 'Load records').click();
                    submit(window, editor);
                    await new Promise((resolve) => setImmediate(resolve));
                    assert.equal(
                        calls.length,
                        before,
                        'An uncertain write cannot authorize reads, children, or a repeat Save.'
                    );
                    assert.equal(gridWrites, 1);
                    const visitor = document.getElementById('visitor');
                    visitor.value = 'B';
                    change(window, visitor);
                    visitor.value = 'A';
                    change(window, visitor);
                    assert.equal(
                        document.querySelector(
                            'input[data-field-id="fld_title"]'
                        ),
                        control
                    );
                    assert.equal(control.value, 'Saved draft');
                    assert.equal(
                        button(document, 'Create record').disabled,
                        true
                    );
                    if (cancelled) {
                        lateGrid.resolve(
                            new Response(
                                JSON.stringify({
                                    result: {
                                        data: {
                                            record: {
                                                id: 'rec_one',
                                                fields: {
                                                    fld_title: 'Saved draft',
                                                },
                                            },
                                            auditTrail: null,
                                            auditTrails: [],
                                        },
                                    },
                                })
                            )
                        );
                        await new Promise((resolve) => setImmediate(resolve));
                        assert.equal(
                            calls.length,
                            before,
                            'A late cancelled response cannot refresh or recover the Portal.'
                        );
                        assert.equal(
                            button(document, 'Create record').disabled,
                            true
                        );
                    }
                    document.getElementById('reload').click();
                    await waitFor(
                        () =>
                            document.querySelector(
                                'input[data-field-id="fld_title"]'
                            ) === null &&
                            document.getElementById('screen').inert === false
                    );
                    assert.equal(
                        calls.filter(
                            (call) =>
                                call.route === 'fetchExtensionForEndUser' &&
                                !call.body.childExtensionInfo
                        ).length,
                        2
                    );
                    assert.equal(
                        gridWrites,
                        1,
                        'Reload reads; it never replays the Grid write.'
                    );
                    button(document, 'Create record').click();
                    await waitFor(
                        () => buttons(document, 'Back to Portal').length === 1
                    );
                    const child = calls.findLast(
                        (call) =>
                            call.route === 'fetchExtensionForEndUser' &&
                            call.body.childExtensionInfo
                    );
                    assert.equal(
                        child.body.context.prefillDataForLinkedRecordsForm
                            .prefillQueryForChildExtension,
                        'prefill_Title=Committed'
                    );
                    assert.equal(
                        calls.filter(
                            (call) =>
                                call.route ===
                                '/api/trpc/airtable.getUserRecord'
                        ).length,
                        0
                    );
                    button(document, 'Disconnect').click();
                    await close();
                }
            }
        );

        await check(
            'actual main A→B→A discards delayed reads/children and preserves accepted Form drafts',
            async () => {
                const portal = editablePortal();
                const lateRead = deferred();
                const lateChild = deferred();
                const lists = [];
                const children = [];
                let writes = 0;
                const fetch = async (input, init) => {
                    const route = new URL(String(input)).searchParams.get(
                        'route'
                    );
                    const body = JSON.parse(String(init?.body ?? '{}'));
                    if (
                        route === 'fetchExtensionForEndUser' &&
                        !body.childExtensionInfo
                    )
                        return new Response(JSON.stringify(portal));
                    if (route === 'fetchRecordsForLinkedTableOnPortal') {
                        lists.push(body);
                        const result =
                            lists.length === 1
                                ? await lateRead.promise
                                : page(
                                      [record('rec_one', 'Current')],
                                      'offset_one'
                                  );
                        return new Response(JSON.stringify(result));
                    }
                    if (
                        route === 'fetchExtensionForEndUser' &&
                        body.childExtensionInfo
                    ) {
                        children.push(body);
                        const result =
                            children.length === 1
                                ? await lateChild.promise
                                : makeForm(body);
                        return new Response(JSON.stringify(result));
                    }
                    writes += 1;
                    throw new Error(`Unexpected packed main route: ${route}`);
                };
                const { window, close } = await environment(fetch);
                await loadExample('main');
                const document = window.document;
                document.getElementById('api-origin').value =
                    'https://sdk.example.test';
                document.getElementById('share-id').value = 'share_example';
                submit(window, document.getElementById('connection-form'));
                await waitFor(
                    () => buttons(document, 'Load records').length === 1
                );
                const visitor = document.getElementById('visitor');
                const aba = () => {
                    visitor.value = 'B';
                    change(window, visitor);
                    visitor.value = 'A';
                    change(window, visitor);
                };
                button(document, 'Load records').click();
                await waitFor(() => lists.length === 1);
                aba();
                lateRead.resolve(
                    page([record('rec_stale', 'Stale')], 'stale_offset')
                );
                await new Promise((resolve) => setImmediate(resolve));
                assert.deepEqual(rowIds(document), []);
                assert.equal(button(document, 'Next page').disabled, true);
                button(document, 'Load records').click();
                await waitFor(() => rowIds(document).includes('rec_one'));
                button(document, 'Open Form').click();
                await waitFor(() => children.length === 1);
                aba();
                lateChild.resolve(makeForm(children[0]));
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(buttons(document, 'Back to Portal').length, 0);
                assert.equal(button(document, 'Create record').disabled, true);
                button(document, 'Load records').click();
                await waitFor(
                    () => button(document, 'Create record').disabled === false
                );
                button(document, 'Open Form').click();
                await waitFor(
                    () => buttons(document, 'Back to Portal').length === 1
                );
                const title = document.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                assert(title);
                title.value = 'Accepted draft';
                change(window, title);
                aba();
                assert.equal(
                    document.querySelector('input[data-field-id="fld_title"]')
                        .value,
                    'Accepted draft'
                );
                assert.equal(children.length, 2);
                assert.equal(
                    writes,
                    0,
                    'No transition or read may submit a write.'
                );
                button(document, 'Disconnect').click();
                await close();
            }
        );
        if (failures.length)
            throw new AggregateError(
                failures,
                'Packed browser Portal example regressions failed.'
            );
        return { checks };
    } finally {
        while (environments.length) await environments.pop()();
    }
}
