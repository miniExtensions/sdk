import { checkPortalFilterCases } from './browser-portal-filter-checks.mjs';
import { checkPortalAttachmentCases } from './browser-portal-attachment-checks.mjs';
import { checkPortalSortCases } from './browser-portal-sort-checks.mjs';
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
const lookupPortal = () => {
    const portal = editablePortal();
    const schema = portal.payload.fieldIdsToSchemas.fld_children;
    const result = structuredClone(schema.airtableField.config);
    schema.fieldType = 'multipleLookupValues';
    schema.airtableField.isComputed = true;
    schema.airtableField.config = {
        type: 'multipleLookupValues',
        options: {
            isValid: true,
            recordLinkFieldId: 'fld_lookup_driver',
            fieldIdInLinkedTable: 'fld_lookup_source',
            result,
        },
    };
    return portal;
};
const kanbanPortal = () => {
    const portal = editablePortal();
    const config = portal.payload.fieldIdsToSchemas.fld_children.miniExtConfig;
    config.layout = 'kanban';
    config.kanbanCategoryField = 'fld_quantity';
    return portal;
};
const kanbanPage = (offset = null) => {
    const result = page([record('rec_one', 'Current', 'Todo')], offset);
    result.tableIdsToLinkedTableStates.tbl_children.airtableFields[1].config = {
        type: 'singleSelect',
        options: {
            choices: [
                { id: 'sel_todo', name: 'Todo' },
                { id: 'sel_done', name: 'Done' },
            ],
        },
    };
    return result;
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
    for (const name of ['portal', 'main', 'portalSort', 'portalFilter']) {
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
    const mount = async ({
        portal = editablePortal(),
        handlers = {},
        initialCriteria,
        confirm = async () => true,
    } = {}) => {
        const { window, close } = await environment();
        const { createPortalView } = await loadExample('portal');
        const calls = [];
        const handoffs = [];
        const failures = [];
        const statuses = [];
        const actions = [];
        let scopeRevision = 0;
        let scopeOwner = 'visitor_A';
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
            initialCriteria,
            getScope: () => ({ ownerId: scopeOwner, revision: scopeRevision }),
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
            confirm,
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
            client,
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
            switchOwner: (ownerId) => {
                scopeOwner = ownerId;
                scopeRevision += 1;
                view.retireCollection();
            },
        };
    };
    const failures = [];
    let checks = 0;
    const recoveryMain = async ({
        attachments = false,
        delayedEdit = null,
        deletable = false,
        failedUpload = false,
        obscurePassword = false,
    } = {}) => {
        const portal = editablePortal();
        const calls = [];
        let ownerId = 'rec_user';
        let latest = page(
            [record('rec_same_title', 'Same title')],
            'offset_more'
        );
        let delayedEditUsed = false;
        let childTitle = null;
        const fetch = async (input, init) => {
            const url = new URL(String(input));
            const route = url.searchParams.get('route') ?? url.pathname;
            if (init?.method === 'PUT') {
                assert.equal(url.origin, 'https://upload.example.test');
                calls.push({ route: 'synthetic-put', init });
                return new Response(null, { status: 204 });
            }
            const body = JSON.parse(String(init?.body ?? '{}'));
            calls.push({ route, body });
            if (route === 'fetchExtensionForEndUser') {
                if (!body.childExtensionInfo) {
                    const fresh = structuredClone(portal);
                    fresh.payload.formRecord.recordId = ownerId;
                    return new Response(JSON.stringify(fresh));
                }
                if (
                    body.childExtensionInfo.accessType.type === 'edit' &&
                    delayedEdit != null &&
                    !delayedEditUsed
                ) {
                    delayedEditUsed = true;
                    await delayedEdit.promise;
                }
                const form = makeForm(body);
                if (childTitle != null)
                    form.payload.formRecord.data.fld_title = childTitle;
                if (deletable) {
                    form.payload.publicFields = {
                        state: { allowDeletingRecords: true },
                    };
                    form.enableCommentsOnChildForms = true;
                }
                if (obscurePassword) {
                    const schema = {
                        fieldType: 'singleLineText',
                        airtableField: {
                            id: 'fld_password',
                            name: 'Private input',
                            config: { type: 'singleLineText' },
                        },
                        miniExtConfig: { obscurePassword: true },
                    };
                    form.payload.fieldIdsInForm.push('fld_password');
                    form.payload.fieldIdsToSchemas.fld_password = schema;
                    form.payload.fieldNamesToSchemas['Private input'] = schema;
                    form.payload.formRecord.data.fld_password = '';
                }
                if (attachments) {
                    const schema = {
                        fieldType: 'multipleAttachments',
                        airtableField: {
                            id: 'fld_files',
                            name: 'Files',
                            config: { type: 'multipleAttachments' },
                        },
                    };
                    form.payload.fieldIdsInForm.push('fld_files');
                    form.payload.fieldIdsToSchemas.fld_files = schema;
                    form.payload.fieldNamesToSchemas.Files = schema;
                    form.payload.formRecord.data.fld_files = [];
                }
                return new Response(JSON.stringify(form));
            }
            if (route === 'fetchRecordsForLinkedTableOnPortal')
                return new Response(JSON.stringify(latest));
            if (route === '/api/trpc/airtable.getUserRecord')
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                id: ownerId,
                                fields: portal.payload.formRecord.data,
                            },
                        },
                    })
                );
            if (route === '/api/trpc/publicExtensions.createPublicUploadLink') {
                if (failedUpload)
                    throw new Error(
                        'Synthetic upload signing response lost after request dispatch.'
                    );
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                signedUrl:
                                    'https://upload.example.test/synthetic-object',
                                publicUrl:
                                    'https://files.example.test/old-upload',
                            },
                        },
                    })
                );
            }
            if (route === 'saveForm')
                throw new Error(
                    'Synthetic connection lost after dispatch; outcome is unknown.'
                );
            throw new Error(`Unexpected packed recovery route: ${route}`);
        };
        const { window, close } = await environment(fetch);
        await loadExample('main');
        const document = window.document;
        const count = (route) =>
            calls.filter((call) => call.route === route).length;
        const connect = async () => {
            document.getElementById('api-origin').value =
                'https://sdk.example.test';
            document.getElementById('share-id').value = 'share_example';
            submit(window, document.getElementById('connection-form'));
            await waitFor(() => buttons(document, 'Load records').length === 1);
        };
        const aba = () => {
            const visitor = document.getElementById('visitor');
            visitor.value = 'B';
            change(window, visitor);
            visitor.value = 'A';
            change(window, visitor);
        };
        const unknownCreate = async () => {
            button(document, 'Create record').click();
            await waitFor(
                () => buttons(document, 'Back to Portal').length === 1
            );
            const title = document.querySelector(
                'input[data-field-id="fld_title"]'
            );
            title.value = 'Same title';
            change(window, title, 'input');
            if (attachments) {
                const file = document.querySelector('input[type="file"]');
                Object.defineProperty(file, 'files', {
                    configurable: true,
                    value: [
                        new File(['old uploaded bytes'], 'old.txt', {
                            type: 'text/plain',
                        }),
                    ],
                });
                button(document, 'Upload selected file').click();
                await waitFor(
                    () =>
                        count('synthetic-put') === 1 &&
                        document.getElementById('screen').inert === false
                );
                assert.match(
                    document.querySelector(
                        '[data-form-attachment-field-id="fld_files"]'
                    ).textContent,
                    /^Attachment$/
                );
                assert.equal(
                    file.value,
                    '',
                    'Successful upload dequeues its native file selection.'
                );
                Object.defineProperty(file, 'files', {
                    configurable: true,
                    value: [
                        new File(['unsubmitted bytes'], 'never-uploaded.txt', {
                            type: 'text/plain',
                        }),
                    ],
                });
            }
            const form = title.closest('form');
            submit(window, form);
            submit(window, form);
            await waitFor(
                () =>
                    count('saveForm') === 1 &&
                    document.getElementById('screen').inert === false
            );
            assert.equal(button(document, 'Save').disabled, true);
            assert.match(
                document.getElementById('screen').textContent,
                /Earlier outcome not confirmed/
            );
            return form;
        };
        await connect();
        return {
            window,
            document,
            calls,
            count,
            connect,
            aba,
            unknownCreate,
            close,
            owner: (value) => {
                ownerId = value;
            },
            latest: (value) => {
                latest = value;
            },
            childTitle: (value) => {
                childTitle = value;
            },
        };
    };
    const assertReference = (root, retainedText) => {
        const panel = [
            ...root.querySelectorAll(
                'details[aria-label="Earlier local input (reference only)"]'
            ),
        ].find((node) => node.textContent.includes(retainedText));
        assert(
            panel,
            `Earlier local input must retain ${retainedText} separately from the active Form.`
        );
        assert.equal(
            panel.querySelector('input, select, textarea'),
            null,
            'Earlier input is a read-only reference, never an editable or automatically merged draft.'
        );
        return panel;
    };
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
    const mountSelectPrefillInteraction = async (
        initiallyFormatted = false
    ) => {
        const colorField = {
            id: 'fld_colors',
            name: 'Colors',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type: 'multipleSelects',
                options: {
                    choices: [
                        { id: 'sel_red', name: 'Red' },
                        { id: 'sel_blue', name: 'Blue' },
                    ],
                },
            },
        };
        let nativeColors = ['Legacy', 'Red'];
        let parentQuery = ['**prefill_Title**=Red'];
        let formatted = initiallyFormatted;
        let parentLoads = 0;
        let reads = 0;
        let parentRefreshes = 0;
        const gridWrites = [];
        const childLoads = [];
        const saves = [];
        const unexpected = [];
        const freshPortal = () => {
            const portal = editablePortal();
            portal.payload.formRecord.data.fld_prefill =
                structuredClone(parentQuery);
            portal.payload.fieldIdsToSchemas.fld_prefill = {
                fieldType: 'multipleLookupValues',
                airtableField: {
                    id: 'fld_prefill',
                    name: 'Current parent lookup',
                    description: null,
                    isPrimaryField: false,
                    isComputed: true,
                    config: {
                        type: 'multipleLookupValues',
                        options: {
                            isValid: true,
                            recordLinkFieldId: 'fld_children',
                            fieldIdInLinkedTable: 'fld_query',
                            result: formatted
                                ? { type: 'richText', options: null }
                                : { type: 'singleLineText', options: null },
                        },
                    },
                },
            };
            portal.payload.linkedRecordFieldIdToDetailFields.fld_children = [
                {
                    fieldId: 'fld_colors',
                    fieldName: 'Colors',
                    titleOverride: null,
                    isHidden: false,
                    fieldIsInEditingChildForm: true,
                    childFormField: null,
                    miniExtConfig: {
                        singleOrMultiSelectLimitSelectionOptions: ['sel_blue'],
                        maxNumberOfSelections: 2,
                    },
                },
            ];
            return portal;
        };
        const fetch = async (input, init) => {
            const url = new URL(String(input));
            const route = url.searchParams.get('route') ?? url.pathname;
            const body = JSON.parse(String(init?.body ?? '{}'));
            if (route === 'fetchExtensionForEndUser') {
                if (body.childExtensionInfo) {
                    childLoads.push(structuredClone(body));
                    return new Response(JSON.stringify(makeForm(body)));
                }
                parentLoads += 1;
                return new Response(JSON.stringify(freshPortal()));
            }
            if (route === 'fetchRecordsForLinkedTableOnPortal') {
                reads += 1;
                const result = page([
                    { id: 'rec_one', fields: { fld_colors: nativeColors } },
                ]);
                result.tableIdsToLinkedTableStates.tbl_children.airtableFields =
                    [colorField];
                return new Response(JSON.stringify(result));
            }
            if (route === '/api/trpc/airtable.updatePortalRecord') {
                gridWrites.push(structuredClone(body));
                nativeColors = structuredClone(body.value);
                // These are synthetic server-returned values and metadata.
                // No lookup expression or query grammar is evaluated here.
                parentQuery = ['**prefill_Title**=Blue'];
                formatted = true;
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                record: {
                                    id: 'rec_one',
                                    fields: { fld_colors: nativeColors },
                                },
                                auditTrail: null,
                                auditTrails: [],
                            },
                        },
                    })
                );
            }
            if (route === '/api/trpc/airtable.getUserRecord') {
                parentRefreshes += 1;
                return new Response(
                    JSON.stringify({
                        result: {
                            data: {
                                id: 'rec_user',
                                fields: { fld_prefill: parentQuery },
                            },
                        },
                    })
                );
            }
            if (route === 'saveForm') {
                saves.push(structuredClone(body));
                return new Response(
                    JSON.stringify({
                        type: 'error',
                        formValidationErrors: [],
                        formErrors: {},
                    })
                );
            }
            unexpected.push(route);
            throw new Error(
                'Unexpected packed select-prefill interaction route.'
            );
        };
        const { window } = await environment(fetch);
        await loadExample('main');
        const document = window.document;
        document.getElementById('api-origin').value =
            'https://sdk.example.test';
        document.getElementById('share-id').value = 'share_example';
        const idle = () =>
            document.getElementById('screen').getAttribute('aria-busy') ===
            'false';
        submit(window, document.getElementById('connection-form'));
        await waitFor(() => parentLoads === 1 && idle());
        const load = async () => {
            const before = reads;
            button(document, 'Load records').click();
            await waitFor(() => reads === before + 1 && idle());
        };
        const reload = async () => {
            const before = parentLoads;
            document.getElementById('reload').click();
            await waitFor(() => parentLoads === before + 1 && idle());
        };
        const create = async () => {
            const before = childLoads.length;
            button(document, 'Create record').click();
            await waitFor(() => childLoads.length === before + 1 && idle());
        };
        return {
            window,
            document,
            idle,
            load,
            reload,
            create,
            gridWrites,
            childLoads,
            saves,
            unexpected,
            parentRefreshes: () => parentRefreshes,
        };
    };
    const interactionPrefill = (query) => ({
        toLinkToParent: {
            reversedFieldIdToPrefill: 'fld_parent',
            parentFormRecordId: 'rec_user',
        },
        prefillQueryForChildExtension: query,
    });
    try {
        await check(
            'composed Portal select save and explicit Reload bind current formatted lookup prefill at actual child load and Save',
            async () => {
                const h = await mountSelectPrefillInteraction();
                await h.load();
                assert.equal(h.gridWrites.length, 0);
                assert.equal(h.childLoads.length, 0);
                assert.equal(h.saves.length, 0);
                button(h.document, 'Edit cell').click();
                const select = h.document.querySelector(
                    'select[data-field-id="fld_colors"]'
                );
                assert(select);
                for (const option of select.options)
                    option.selected = option.value === 'Blue';
                change(h.window, select);
                for (const value of ['Red', 'sel_blue']) {
                    const injected = h.document.createElement('option');
                    injected.value = value;
                    injected.selected = true;
                    select.append(injected);
                    change(h.window, select);
                }
                submit(h.window, select.closest('form'));
                await waitFor(() => h.gridWrites.length === 1 && h.idle());
                assert.deepEqual(h.gridWrites[0], {
                    portalExtensionAccessToken: 'portal_access_example',
                    portalFieldId: 'fld_children',
                    recordFieldId: 'fld_colors',
                    recordId: 'rec_one',
                    value: ['Blue'],
                    selectedCustomViewId: 'view_example',
                });
                assert.equal(h.parentRefreshes(), 1);
                assert.equal(
                    button(h.document, 'Create record').disabled,
                    true
                );
                assert.equal(h.childLoads.length, 0);
                assert.equal(h.saves.length, 0);
                await h.reload();
                assert.equal(
                    h.gridWrites.length,
                    1,
                    'Reload must never replay the Grid update.'
                );
                await h.load();
                await h.create();
                const expected = interactionPrefill('prefill_Title=Blue');
                assert.deepEqual(h.childLoads[0].context, {
                    type: 'modal',
                    linkedTableIdOfLinkedRecordField: 'tbl_children',
                    prefillDataForLinkedRecordsForm: expected,
                });
                assert.deepEqual(h.childLoads[0].childExtensionAccessData, {
                    parentExtensionAccessToken: 'portal_access_example',
                    fieldIdUsedToAccessExtension: 'fld_children',
                });
                assert.equal(
                    h.saves.length,
                    0,
                    'Opening a child Form cannot automatically save it.'
                );
                const title = h.document.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                assert(title);
                title.value = 'Explicit packed composed request';
                change(h.window, title, 'input');
                submit(h.window, title.closest('form'));
                await waitFor(() => h.saves.length === 1 && h.idle());
                assert.deepEqual(h.saves[0].context, {
                    type: 'modal',
                    prefillData: expected,
                });
                assert.equal(
                    h.saves[0].formRecord.data.fld_title,
                    'Explicit packed composed request'
                );
                assert.equal(h.gridWrites.length, 1);
                assert.deepEqual(h.unexpected, []);
            }
        );
        await check(
            'composed Portal A-to-B-to-A select draft sends no writes and fresh child load preserves current lookup and parent context',
            async () => {
                const h = await mountSelectPrefillInteraction(true);
                await h.load();
                button(h.document, 'Edit cell').click();
                const select = h.document.querySelector(
                    'select[data-field-id="fld_colors"]'
                );
                assert(select);
                for (const option of select.options)
                    option.selected = option.value === 'Blue';
                change(h.window, select);
                const editor = select.closest('form');
                const visitor = h.document.getElementById('visitor');
                visitor.value = 'B';
                change(h.window, visitor);
                submit(h.window, editor);
                visitor.value = 'A';
                change(h.window, visitor);
                assert.equal(
                    h.document.querySelector(
                        'select[data-field-id="fld_colors"]'
                    ),
                    select
                );
                assert.deepEqual(
                    [...select.options]
                        .filter((option) => option.selected)
                        .map((option) => option.value),
                    ['Blue']
                );
                submit(h.window, editor);
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(h.gridWrites.length, 0);
                assert.equal(h.childLoads.length, 0);
                assert.equal(h.saves.length, 0);
                await h.reload();
                await h.load();
                await h.create();
                assert.deepEqual(h.childLoads[0].context, {
                    type: 'modal',
                    linkedTableIdOfLinkedRecordField: 'tbl_children',
                    prefillDataForLinkedRecordsForm:
                        interactionPrefill('prefill_Title=Red'),
                });
                assert.deepEqual(h.childLoads[0].childExtensionAccessData, {
                    parentExtensionAccessToken: 'portal_access_example',
                    fieldIdUsedToAccessExtension: 'fld_children',
                });
                assert.equal(h.gridWrites.length, 0);
                assert.equal(h.saves.length, 0);
                assert.deepEqual(h.unexpected, []);
            }
        );
        await check(
            'lookup tables retain the outer field across paging and existing-child edits without create or parent unlink controls',
            async () => {
                let reads = 0;
                const h = await mount({
                    portal: lookupPortal(),
                    handlers: {
                        list: () =>
                            ++reads === 1
                                ? page(
                                      [record('rec_one', 'Lookup first')],
                                      'lookup_cursor'
                                  )
                                : page([
                                      record(
                                          'rec_one',
                                          'Lookup first refreshed'
                                      ),
                                      record('rec_two', 'Lookup second'),
                                  ]),
                    },
                });
                const table = h.view.node.querySelector('select');
                assert.deepEqual(
                    [...table.options].map((option) => option.value),
                    ['fld_children']
                );
                assert.equal(
                    button(h.view.node, 'Create record').disabled,
                    true
                );
                await h.click('Create record');
                assert.equal(h.calls.length, 0);
                await h.click('Load records');
                assert.deepEqual(rowIds(h.view.node), ['rec_one']);
                assert.match(h.view.node.textContent, /Lookup first/);
                await h.click('Next page');
                assert.deepEqual(rowIds(h.view.node), ['rec_one', 'rec_two']);
                const listCalls = h.calls.filter(
                    (call) => call.operation === 'list'
                );
                assert.equal(listCalls.length, 2);
                for (const call of listCalls) {
                    assert.equal(call.input.portalFieldId, 'fld_children');
                    assert.equal(
                        call.input.extensionAccessToken,
                        'portal_access_example'
                    );
                    assert.equal(
                        call.input.selectedCustomViewId,
                        'view_example'
                    );
                }
                assert.equal(
                    listCalls[1].input.airtableOffset,
                    'lookup_cursor'
                );
                assert.deepEqual(listCalls[1].input.alreadyLoadedRecordIds, [
                    'rec_one',
                ]);
                assert.equal(
                    button(h.view.node, 'Create record').disabled,
                    true
                );
                assert.equal(buttons(h.view.node, 'Unlink').length, 0);
                await h.click('Create record');
                assert.equal(h.calls.length, 2);
                await h.click('Open Form');
                const edit = h.calls.findLast(
                    (call) => call.operation === 'child'
                ).input;
                assert.deepEqual(edit.childExtensionAccessData, {
                    parentExtensionAccessToken: 'portal_access_example',
                    fieldIdUsedToAccessExtension: 'fld_children',
                });
                assert.deepEqual(edit.childExtensionInfo, {
                    childExtensionId: 'child_example',
                    accessType: {
                        type: 'edit',
                        childExtensionRecordId: 'rec_one',
                        childExtensionFieldId: null,
                    },
                });
                assert.deepEqual(edit.context, {
                    type: 'modal',
                    linkedTableIdOfLinkedRecordField: 'tbl_children',
                    prefillDataForLinkedRecordsForm: null,
                });
                assert.deepEqual(h.handoffs[0][1], {
                    type: 'modal',
                    prefillData: null,
                });
                assert.equal(h.failures.length, 0);
                assert.equal(
                    h.calls.some((call) =>
                        ['grid', 'unlink', 'save'].includes(call.operation)
                    ),
                    false
                );
                await h.dispose();
            }
        );

        await check(
            'invalid or non-linked lookup results are absent from the actual table selector and dispatch no read or child load',
            async () => {
                for (const result of [
                    null,
                    { type: 'number', options: { precision: 0 } },
                    {
                        type: 'multipleRecordLinks',
                        options: { linkedTableId: '' },
                    },
                ]) {
                    const portal = lookupPortal();
                    portal.payload.fieldIdsToSchemas.fld_children.airtableField.config.options.result =
                        result;
                    const h = await mount({ portal });
                    assert.equal(
                        h.view.node.querySelector('select').options.length,
                        0
                    );
                    assert.equal(
                        button(h.view.node, 'Create record').disabled,
                        true
                    );
                    await h.click('Load records');
                    await h.click('Create record');
                    assert.equal(h.calls.length, 0);
                    assert.deepEqual(rowIds(h.view.node), []);
                    await h.dispose();
                }
            }
        );

        await check(
            'resolved child password config masks cells before and after native Grid saves',
            async () => {
                const portal = editablePortal();
                const detail =
                    portal.payload.linkedRecordFieldIdToDetailFields
                        .fld_children[0];
                detail.miniExtConfig = { obscurePassword: false };
                detail.childFormField = {
                    idOrName: { type: 'id', id: 'fld_title' },
                    config: {
                        type: 'singleLineText',
                        config: { obscurePassword: true },
                    },
                };
                const original = 'Case-Sensitive Original';
                const saved = 'Different-length Saved Value';
                const h = await mount({
                    portal,
                    handlers: {
                        list: () => page([record('rec_one', original, 4)]),
                        grid: ({ input }) => ({
                            record: record(input.recordId, input.value, 4),
                            auditTrail: null,
                            auditTrails: [],
                        }),
                    },
                });
                await h.click('Load records');
                const cell = () => h.view.node.querySelector('tbody td');
                assert.equal(cell().textContent, '••••••••Edit cell');
                assert.equal(cell().title, '');
                assert.equal(h.view.node.textContent.includes(original), false);
                await h.click('Edit cell');
                let input = h.view.node.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                assert.equal(input.type, 'password');
                assert.equal(input.value, original);
                input.value = saved;
                change(h.window, input, 'input');
                submit(h.window, input.closest('form'));
                await h.settle();
                assert.equal(cell().textContent, '••••••••Edit cell');
                assert.equal(h.view.node.textContent.includes(saved), false);
                assert.deepEqual(
                    h.calls
                        .filter(({ operation }) => operation === 'grid')
                        .map(({ input }) => input.value),
                    [saved]
                );
                await h.click('Edit cell');
                input = h.view.node.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                assert.equal(input.type, 'password');
                assert.equal(input.value, saved);
                assert.deepEqual(h.failures, []);
                await h.dispose();
            }
        );

        await check(
            'published detail password config masks nonempty cells while empty values stay empty',
            async () => {
                const portal = editablePortal();
                portal.payload.linkedRecordFieldIdToDetailFields.fld_children[0].miniExtConfig =
                    { obscurePassword: true };
                const h = await mount({
                    portal,
                    handlers: {
                        list: () =>
                            page([
                                record('rec_secret', 'Private content'),
                                record('rec_empty', ''),
                                record('rec_null', null),
                            ]),
                    },
                });
                await h.click('Load records');
                assert.deepEqual(
                    [...h.view.node.querySelectorAll('tbody tr')].map(
                        (row) => row.querySelector('td').textContent
                    ),
                    ['••••••••Edit cell', 'Edit cell', 'Edit cell']
                );
                assert.equal(
                    h.view.node.textContent.includes('Private content'),
                    false
                );
                assert.equal(
                    h.calls.filter(({ operation }) => operation === 'grid')
                        .length,
                    0
                );
                await h.dispose();
            }
        );

        await check(
            'ordinary cells and authoritative nonmasked child config preserve their display values',
            async () => {
                const portal = editablePortal();
                const detail =
                    portal.payload.linkedRecordFieldIdToDetailFields
                        .fld_children[0];
                detail.miniExtConfig = { obscurePassword: true };
                detail.childFormField = {
                    idOrName: { type: 'id', id: 'fld_title' },
                    config: {
                        type: 'singleLineText',
                        config: { obscurePassword: false },
                    },
                };
                const h = await mount({
                    portal,
                    handlers: {
                        list: () =>
                            page([record('rec_one', 'Ordinary title', 42)]),
                    },
                });
                await h.click('Load records');
                assert.deepEqual(
                    [...h.view.node.querySelectorAll('tbody td')]
                        .slice(0, 2)
                        .map((cell) => cell.textContent),
                    ['Ordinary titleEdit cell', '42Edit cell']
                );
                assert.equal(
                    h.calls.filter(({ operation }) => operation === 'grid')
                        .length,
                    0
                );
                await h.dispose();
            }
        );

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
                await h.click('Review criteria cleanup');
                await waitFor(() =>
                    h.statuses.some(([text]) =>
                        text.includes('Cleanup accepted')
                    )
                );
                assert.equal(h.calls.length, 2);
                assert.equal(
                    button(h.view.node, 'Create record').disabled,
                    true
                );
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

        for (const scenario of [
            'disabled',
            'absent',
            'stale source',
            'missing source',
            'missing source schema',
            'non-readable source schema',
            'invalid value',
            'missing value',
            'empty value',
            'blank value',
        ]) {
            await check(
                `actual packed create child omits query prefill for ${scenario}`,
                async () => {
                    const portal = editablePortal();
                    const config =
                        portal.payload.fieldIdsToSchemas.fld_children
                            .miniExtConfig;
                    if (scenario === 'disabled')
                        config.prefillChildFormForCreatingRecords = false;
                    else if (scenario === 'absent')
                        delete config.prefillChildFormForCreatingRecords;
                    else if (scenario === 'stale source')
                        config.prefillFieldForCreatingChildExtension =
                            'fld_removed';
                    else if (scenario === 'missing source')
                        delete config.prefillFieldForCreatingChildExtension;
                    else if (scenario === 'missing source schema')
                        delete portal.payload.fieldIdsToSchemas.fld_prefill;
                    else if (scenario === 'non-readable source schema') {
                        const schema =
                            portal.payload.fieldIdsToSchemas.fld_prefill;
                        schema.fieldType = 'number';
                        schema.airtableField.config = {
                            type: 'number',
                            options: { precision: 0 },
                        };
                    } else if (scenario === 'invalid value')
                        portal.payload.formRecord.data.fld_prefill = [
                            'not-a-query',
                        ];
                    else if (scenario === 'missing value')
                        delete portal.payload.formRecord.data.fld_prefill;
                    else
                        portal.payload.formRecord.data.fld_prefill =
                            scenario === 'empty value' ? '' : ' \t\n ';
                    const h = await mount({ portal });
                    await h.click('Create record');
                    assert.deepEqual(
                        h.calls.map((call) => call.operation),
                        ['child'],
                        'Opening the child loads once and never writes.'
                    );
                    assert.equal(h.failures.length, 0);
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
                        prefillQueryForChildExtension: null,
                    };
                    assert.deepEqual(create.context, {
                        type: 'modal',
                        linkedTableIdOfLinkedRecordField: 'tbl_children',
                        prefillDataForLinkedRecordsForm: prefill,
                    });
                    assert.equal(h.handoffs.length, 1);
                    assert.deepEqual(h.handoffs[0][1], {
                        type: 'modal',
                        prefillData: prefill,
                    });
                    await h.dispose();
                }
            );
        }

        await check(
            'actual packed child query formats barcode and rich-text sources with native load/save context',
            async () => {
                for (const [config, value, expected] of [
                    [
                        { type: 'barcode', options: null },
                        { text: ' ?prefill_Title=Barcode%20Value ' },
                        ' ?prefill_Title=Barcode%20Value ',
                    ],
                    [
                        { type: 'richText', options: null },
                        '**prefill_Title**=Readable',
                        'prefill_Title=Readable',
                    ],
                ]) {
                    const portal = editablePortal();
                    const schema = portal.payload.fieldIdsToSchemas.fld_prefill;
                    schema.fieldType = config.type;
                    schema.airtableField.config = config;
                    portal.payload.formRecord.data.fld_prefill = value;
                    const h = await mount({ portal });
                    await h.click('Create record');
                    assert.deepEqual(
                        h.calls.map((call) => call.operation),
                        ['child']
                    );
                    assert.equal(h.failures.length, 0);
                    const prefill = {
                        toLinkToParent: {
                            reversedFieldIdToPrefill: 'fld_parent',
                            parentFormRecordId: 'rec_user',
                        },
                        prefillQueryForChildExtension: expected,
                    };
                    assert.deepEqual(h.calls[0].input.context, {
                        type: 'modal',
                        linkedTableIdOfLinkedRecordField: 'tbl_children',
                        prefillDataForLinkedRecordsForm: prefill,
                    });
                    assert.deepEqual(h.handoffs[0][1], {
                        type: 'modal',
                        prefillData: prefill,
                    });
                    await h.dispose();
                }
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
            'readonly attachment preview preserves accepted read/child context without dispatch',
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
                const preview = [...h.view.node.querySelectorAll('form')].find(
                    (form) =>
                        form.textContent.includes(
                            'Use the child Form to change attachments.'
                        )
                );
                assert(preview);
                assert.equal(
                    preview.querySelector('input, textarea, select'),
                    null
                );
                assert.equal(buttons(preview, 'Save cell').length, 0);
                const calls = h.calls.length;
                submit(h.window, preview);
                await h.settle();
                assert.equal(
                    h.calls.filter((call) => call.operation === 'grid').length,
                    0
                );
                assert.equal(h.calls.length, calls);
                assert.equal(h.failures.length, 0);
                assert(preview.isConnected);
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
            'actual main uncertain Kanban moves preserve choices and require Portal Reload without replay',
            async () => {
                for (const mode of ['cancel', 'rejected', 'no-login']) {
                    const portal = kanbanPortal();
                    const lateMove = deferred();
                    const calls = [];
                    let moves = 0;
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
                                JSON.stringify(kanbanPage('offset_one'))
                            );
                        if (
                            route ===
                            '/api/trpc/airtable.updateRecordKanbanCategory'
                        ) {
                            moves += 1;
                            serverPrefill = 'prefill_Title=Committed';
                            if (mode === 'cancel') return lateMove.promise;
                            if (mode === 'no-login')
                                return new Response(
                                    JSON.stringify({
                                        result: { data: { type: 'no-login' } },
                                    })
                                );
                            throw new Error(
                                'Synthetic move response lost after server commit.'
                            );
                        }
                        throw new Error(
                            `Unexpected packed Kanban recovery route: ${route}`
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
                    assert.equal(moves, 0);
                    button(document, 'Load records').click();
                    await waitFor(
                        () => buttons(document, 'Move category').length === 1
                    );
                    const category = document.querySelector(
                        'select[aria-label="Category for rec_one"]'
                    );
                    assert(category);
                    category.value = 'Done';
                    change(window, category);
                    assert.equal(
                        moves,
                        0,
                        'Choosing a category is only a local draft.'
                    );
                    button(document, 'Move category').click();
                    await waitFor(() => moves === 1);
                    if (mode === 'cancel') {
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
                            'select[aria-label="Category for rec_one"]'
                        ),
                        category
                    );
                    assert.equal(category.value, 'Done');
                    assert.equal(button(document, 'Next page').disabled, true);
                    assert.equal(
                        button(document, 'Create record').disabled,
                        true
                    );
                    const before = calls.length;
                    button(document, 'Move category').click();
                    button(document, 'Open Form').click();
                    button(document, 'Load records').click();
                    await new Promise((resolve) => setImmediate(resolve));
                    assert.equal(
                        calls.length,
                        before,
                        'An uncertain move cannot dispatch a second Move, child, or collection read.'
                    );
                    assert.equal(moves, 1);
                    const visitor = document.getElementById('visitor');
                    visitor.value = 'B';
                    change(window, visitor);
                    visitor.value = 'A';
                    change(window, visitor);
                    assert.equal(
                        document.querySelector(
                            'select[aria-label="Category for rec_one"]'
                        ),
                        category
                    );
                    assert.equal(category.value, 'Done');
                    button(document, 'Move category').click();
                    await new Promise((resolve) => setImmediate(resolve));
                    assert.equal(
                        calls.length,
                        before,
                        'Visitor switches cannot lift uncertain-write recovery.'
                    );
                    if (mode === 'cancel') {
                        lateMove.resolve(
                            new Response(
                                JSON.stringify({
                                    result: {
                                        data: {
                                            type: 'logged-in',
                                            loggedInUserRecord: {
                                                id: 'rec_user',
                                                fields: {
                                                    fld_prefill: serverPrefill,
                                                },
                                            },
                                        },
                                    },
                                })
                            )
                        );
                        await new Promise((resolve) => setImmediate(resolve));
                        assert.equal(calls.length, before);
                        assert.equal(
                            button(document, 'Create record').disabled,
                            true
                        );
                    }
                    document.getElementById('reload').click();
                    await waitFor(
                        () =>
                            document.querySelector(
                                'select[aria-label="Category for rec_one"]'
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
                        moves,
                        1,
                        'Reload never replays a category move.'
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
            'actual main accepted Kanban moves retain cached choices and refresh child prefills without automatic reads',
            async () => {
                const portal = kanbanPortal();
                const calls = [];
                const fetch = async (input, init) => {
                    const url = new URL(String(input));
                    const route = url.searchParams.get('route') ?? url.pathname;
                    const body = JSON.parse(String(init?.body ?? '{}'));
                    calls.push({ route, body });
                    if (route === 'fetchExtensionForEndUser')
                        return new Response(
                            JSON.stringify(
                                body.childExtensionInfo
                                    ? makeForm(body)
                                    : portal
                            )
                        );
                    if (route === 'fetchRecordsForLinkedTableOnPortal')
                        return new Response(
                            JSON.stringify(kanbanPage('offset_one'))
                        );
                    if (
                        route ===
                        '/api/trpc/airtable.updateRecordKanbanCategory'
                    )
                        return new Response(
                            JSON.stringify({
                                result: {
                                    data: {
                                        type: 'logged-in',
                                        loggedInUserRecord: {
                                            id: 'rec_user',
                                            fields: {
                                                fld_prefill:
                                                    'prefill_Title=Updated',
                                            },
                                        },
                                    },
                                },
                            })
                        );
                    throw new Error(
                        `Unexpected accepted Kanban route: ${route}`
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
                    () => buttons(document, 'Move category').length === 1
                );
                const category = document.querySelector(
                    'select[aria-label="Category for rec_one"]'
                );
                category.value = 'Done';
                change(window, category);
                const before = calls.length;
                const visitor = document.getElementById('visitor');
                visitor.value = 'B';
                change(window, visitor);
                visitor.value = 'A';
                change(window, visitor);
                assert.equal(
                    document.querySelector(
                        'select[aria-label="Category for rec_one"]'
                    ),
                    category
                );
                assert.equal(category.value, 'Done');
                assert.equal(
                    calls.length,
                    before,
                    'Cached category choices never write during visitor switches.'
                );
                button(document, 'Move category').click();
                await waitFor(
                    () =>
                        rowIds(document).length === 0 &&
                        document.getElementById('screen').inert === false
                );
                const move = calls.find(
                    (call) =>
                        call.route ===
                        '/api/trpc/airtable.updateRecordKanbanCategory'
                );
                assert(move);
                assert.deepEqual(move.body, {
                    extensionAccessToken: 'portal_access_example',
                    portalFieldId: 'fld_children',
                    recordId: 'rec_one',
                    categoryFieldValue: 'Done',
                    selectedCustomViewId: 'view_example',
                });
                assert.equal(
                    calls.filter(
                        (call) =>
                            call.route === 'fetchRecordsForLinkedTableOnPortal'
                    ).length,
                    1
                );
                assert.equal(button(document, 'Next page').disabled, true);
                assert.equal(button(document, 'Create record').disabled, false);
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
                    'prefill_Title=Updated'
                );
                assert.equal(
                    calls.filter(
                        (call) =>
                            call.route === 'fetchExtensionForEndUser' &&
                            !call.body.childExtensionInfo
                    ).length,
                    1
                );
                button(document, 'Back to Portal').click();
                button(document, 'Load records').click();
                await waitFor(
                    () => buttons(document, 'Move category').length === 1
                );
                assert.equal(
                    calls.filter(
                        (call) =>
                            call.route === 'fetchRecordsForLinkedTableOnPortal'
                    ).length,
                    2
                );
                assert.equal(
                    calls.filter(
                        (call) =>
                            call.route ===
                            '/api/trpc/airtable.updateRecordKanbanCategory'
                    ).length,
                    1
                );
                button(document, 'Disconnect').click();
                await close();
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
        await check(
            'actual main unknown create survives criteria, owner changes, logout, Reload and new clients without candidate inference',
            async () => {
                const h = await recoveryMain();
                const { document, window } = h;
                await h.unknownCreate();
                button(document, 'Back to Portal').click();
                const unknown = () =>
                    assert.match(
                        document.getElementById('screen').textContent,
                        /Earlier outcome not confirmed/
                    );
                unknown();
                button(document, 'Check latest requests').click();
                await waitFor(() =>
                    rowIds(document).includes('rec_same_title')
                );
                unknown();
                assert.equal(h.count('saveForm'), 1);
                assert.equal(
                    buttons(document, 'Inspect earlier request').length,
                    1
                );
                assert.match(
                    document.getElementById('screen').textContent,
                    /more available/i
                );
                assert.doesNotMatch(
                    document.getElementById('status').textContent,
                    /Saved record/
                );
                const view = document.querySelectorAll('.toolbar select')[1];
                assert(view);
                view.value = 'view_other';
                change(window, view);
                unknown();
                h.latest(page([]));
                button(document, 'Check latest requests').click();
                await waitFor(
                    () =>
                        h.count('fetchRecordsForLinkedTableOnPortal') === 2 &&
                        document.getElementById('screen').inert === false
                );
                unknown();
                assert.deepEqual(rowIds(document), []);
                assert.equal(button(document, 'Next page').disabled, true);
                assert.equal(
                    h.calls.findLast(
                        (call) =>
                            call.route === 'fetchRecordsForLinkedTableOnPortal'
                    ).body.selectedCustomViewId,
                    'view_other'
                );
                h.aba();
                unknown();
                const visitor = document.getElementById('visitor');
                visitor.value = 'B';
                change(window, visitor);
                h.owner('rec_other');
                document.getElementById('reload').click();
                await waitFor(
                    () =>
                        buttons(document, 'Load records').length === 1 &&
                        document.getElementById('screen').inert === false
                );
                assert.doesNotMatch(
                    document.getElementById('screen').textContent,
                    /Earlier outcome not confirmed/
                );
                visitor.value = 'A';
                change(window, visitor);
                h.owner('rec_user');
                unknown();
                document.getElementById('logout').click();
                document.getElementById('reload').click();
                await waitFor(
                    () =>
                        buttons(document, 'Load records').length === 1 &&
                        document.getElementById('screen').inert === false
                );
                unknown();
                await h.connect();
                unknown();
                assert.equal(
                    h.count('saveForm'),
                    1,
                    'Session, view and client transitions cannot replay the old create.'
                );
                button(document, 'Disconnect').click();
                await h.close();
            }
        );
        await check(
            'actual main separate-request warning cancels without writes and accepted fresh blank drops old draft, files and uploaded references',
            async () => {
                const h = await recoveryMain({ attachments: true });
                const { document, window } = h;
                const oldForm = await h.unknownCreate();
                const oldAttemptId = document
                    .getElementById('screen')
                    .textContent.match(/attempt-\d+/)?.[0];
                assert(oldAttemptId);
                const save = h.calls.find((call) => call.route === 'saveForm');
                assert.match(JSON.stringify(save.body), /Same title/);
                assert.match(JSON.stringify(save.body), /old-upload/);
                button(document, 'Back to Portal').click();
                const childrenBefore = h.calls.filter(
                    (call) =>
                        call.route === 'fetchExtensionForEndUser' &&
                        call.body.childExtensionInfo
                ).length;
                button(document, 'Create record').click();
                await waitFor(() => document.querySelector('dialog') != null);
                assert.match(
                    document.querySelector('dialog').textContent,
                    /duplicate/i
                );
                button(document.querySelector('dialog'), 'Cancel').click();
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(h.count('saveForm'), 1);
                assert.equal(
                    h.calls.filter(
                        (call) =>
                            call.route === 'fetchExtensionForEndUser' &&
                            call.body.childExtensionInfo
                    ).length,
                    childrenBefore
                );
                button(document, 'Create record').click();
                await waitFor(() => document.querySelector('dialog') != null);
                const start = button(
                    document.querySelector('dialog'),
                    'Start separate request'
                );
                start.click();
                start.click();
                await waitFor(
                    () => buttons(document, 'Back to Portal').length === 1
                );
                assert.equal(
                    h.calls.filter(
                        (call) =>
                            call.route === 'fetchExtensionForEndUser' &&
                            call.body.childExtensionInfo
                    ).length,
                    childrenBefore + 1,
                    'Double activation starts one fresh child load.'
                );
                assert.equal(
                    document.querySelector('input[data-field-id="fld_title"]')
                        .value,
                    'Initial child'
                );
                assert.doesNotMatch(
                    document.querySelector(
                        '[data-form-attachment-field-id="fld_files"]'
                    ).textContent,
                    /old-upload|old\.txt/
                );
                assert.equal(
                    document.querySelector('input[type="file"]').files.length,
                    0
                );
                assert.equal(button(document, 'Save').disabled, false);
                const newAttemptId = document
                    .getElementById('screen')
                    .textContent.match(/New local attempt: (attempt-\d+)/)?.[1];
                assert(newAttemptId);
                assert.notEqual(
                    newAttemptId,
                    oldAttemptId,
                    'A separate request has a distinct local intent ID.'
                );
                assert.equal(
                    h.count('saveForm'),
                    1,
                    'Acknowledging a new request does not autosave it.'
                );
                assert.equal(
                    h.count(
                        '/api/trpc/publicExtensions.createPublicUploadLink'
                    ),
                    1
                );
                assert.equal(h.count('synthetic-put'), 1);
                submit(window, oldForm);
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(
                    h.count('saveForm'),
                    1,
                    'A detached old form cannot replay its save.'
                );
                assert.equal(h.count('synthetic-put'), 1);
                button(document, 'Back to Portal').click();
                assert.match(
                    document.getElementById('screen').textContent,
                    /Earlier outcome not confirmed/
                );
                assert(
                    document
                        .getElementById('screen')
                        .textContent.includes(oldAttemptId),
                    'The original unknown attempt remains in the journal.'
                );
                button(document, 'Disconnect').click();
                await h.close();
            }
        );
        await check(
            'actual main expired recovery candidates cannot open an editor and manual association leaves the original outcome unknown',
            async () => {
                const delayedEdit = deferred();
                const h = await recoveryMain({ delayedEdit, deletable: true });
                const { document, window } = h;
                await h.unknownCreate();
                button(document, 'Back to Portal').click();
                button(document, 'Check latest requests').click();
                await waitFor(
                    () =>
                        buttons(document, 'Inspect earlier request').length ===
                        1
                );
                button(document, 'Inspect earlier request').click();
                await waitFor(() =>
                    h.calls.some(
                        (call) =>
                            call.body?.childExtensionInfo?.accessType?.type ===
                            'edit'
                    )
                );
                h.aba();
                delayedEdit.resolve();
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(
                    buttons(document, 'Back to Portal').length,
                    0,
                    'A child response from an expired collection cannot become an editor.'
                );
                assert.equal(h.count('saveForm'), 1);
                button(document, 'Check latest requests').click();
                await waitFor(
                    () =>
                        buttons(document, 'Inspect earlier request').length ===
                            1 &&
                        document.getElementById('screen').inert === false
                );
                button(document, 'Inspect earlier request').click();
                await waitFor(
                    () => buttons(document, 'Use this request').length === 1
                );
                assert.equal(button(document, 'Save').disabled, true);
                const candidateDelete = button(document, 'Delete this record');
                assert.equal(candidateDelete.disabled, true);
                candidateDelete.dispatchEvent(new window.Event('click'));
                button(document, 'Load comments').dispatchEvent(
                    new window.Event('click')
                );
                const candidateComment = document.querySelector(
                    'textarea[placeholder="Write a comment"]'
                );
                candidateComment.value = 'Unacknowledged candidate comment';
                button(document, 'Add comment').dispatchEvent(
                    new window.Event('click')
                );
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(document.querySelector('dialog'), null);
                assert.equal(h.count('/api/trpc/airtable.deleteRecord'), 0);
                assert.equal(
                    h.count('/api/trpc/airtable.getAirtableCommentsForRecord'),
                    0
                );
                assert.equal(
                    h.count('/api/trpc/airtable.addAirtableCommentForRecord'),
                    0
                );
                button(document, 'Use this request').click();
                await waitFor(() => document.querySelector('dialog') != null);
                button(
                    document.querySelector('dialog'),
                    'Use this request'
                ).click();
                await waitFor(
                    () => button(document, 'Save').disabled === false
                );
                assert.doesNotMatch(
                    document.getElementById('status').textContent,
                    /Saved record/
                );
                assert.equal(
                    h.count('saveForm'),
                    1,
                    'Choosing an existing request is not a save or proof of the original create.'
                );
                button(document, 'Back to Portal').click();
                assert.match(
                    document.getElementById('screen').textContent,
                    /Earlier outcome not confirmed/
                );
                button(document, 'Disconnect').click();
                await h.close();
            }
        );
        await check(
            'actual main ordinary reopen of an uncertain edit inspects fresh server values and cannot silently replay the retained dirty draft',
            async () => {
                const h = await recoveryMain();
                const { document, window } = h;
                button(document, 'Load records').click();
                await waitFor(() =>
                    rowIds(document).includes('rec_same_title')
                );
                button(document, 'Open Form').click();
                await waitFor(
                    () => buttons(document, 'Back to Portal').length === 1
                );
                const oldTitle = document.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                oldTitle.value = 'Retained dirty edit';
                change(window, oldTitle, 'input');
                const oldForm = oldTitle.closest('form');
                submit(window, oldForm);
                await waitFor(
                    () =>
                        h.count('saveForm') === 1 &&
                        document.getElementById('screen').inert === false
                );
                assert.equal(button(document, 'Save').disabled, true);
                assert.equal(
                    h.calls.find((call) => call.route === 'saveForm').body
                        .formRecord.data.fld_title,
                    'Retained dirty edit'
                );
                // An independent server change must not be mistaken for the failed local draft.
                h.childTitle('Fresh server title after uncertain edit');
                h.latest(
                    page([
                        record(
                            'rec_same_title',
                            'Fresh server title after uncertain edit'
                        ),
                    ])
                );
                button(document, 'Back to Portal').click();
                button(document, 'Load records').click();
                await waitFor(
                    () =>
                        buttons(document, 'Open Form').length === 1 &&
                        document.getElementById('screen').inert === false
                );
                // Deliberately use the ordinary path rather than Inspect earlier request.
                button(document, 'Open Form').click();
                await waitFor(
                    () => buttons(document, 'Use this request').length === 1
                );
                assert.equal(button(document, 'Save').disabled, true);
                assert.equal(
                    h.count('saveForm'),
                    1,
                    'A fresh read must never save automatically.'
                );
                const inspectedTitle = document.querySelector(
                    'input[data-field-id="fld_title"]'
                ).value;
                assertReference(document, 'Retained dirty edit');
                button(document, 'Use this request').click();
                await waitFor(() => document.querySelector('dialog') != null);
                button(
                    document.querySelector('dialog'),
                    'Use this request'
                ).click();
                await waitFor(
                    () => button(document, 'Save').disabled === false
                );
                assert.equal(
                    h.count('saveForm'),
                    1,
                    'Acknowledgment is not a retry or save.'
                );
                const acceptedTitle = document.querySelector(
                    'input[data-field-id="fld_title"]'
                ).value;
                assertReference(document, 'Retained dirty edit');
                submit(window, button(document, 'Save').closest('form'));
                await waitFor(
                    () =>
                        h.count('saveForm') === 2 &&
                        document.getElementById('screen').inert === false
                );
                const saves = h.calls.filter(
                    (call) => call.route === 'saveForm'
                );
                // Exercise the whole unsafe path before asserting, so the failure receipt
                // proves both misleading inspection and the resulting silent replay.
                assert.deepEqual(
                    {
                        inspectedTitle,
                        acceptedTitle,
                        submittedTitle: saves[1].body.formRecord.data.fld_title,
                    },
                    {
                        inspectedTitle:
                            'Fresh server title after uncertain edit',
                        acceptedTitle:
                            'Fresh server title after uncertain edit',
                        submittedTitle:
                            'Fresh server title after uncertain edit',
                    },
                    'Fresh inspection/acknowledgment must not unlock the old dirty values as a new edit.'
                );
                assert.equal(
                    saves[1].body.formRecord.recordId,
                    'rec_same_title'
                );
                button(document, 'Disconnect').click();
                await h.close();
            }
        );
        await check(
            'actual main ordinary reopen after uncertain edit upload uses fresh server values and retains only a generic attachment notice without replay',
            async () => {
                const h = await recoveryMain({
                    attachments: true,
                    failedUpload: true,
                });
                const { document, window } = h;
                button(document, 'Load records').click();
                await waitFor(() =>
                    rowIds(document).includes('rec_same_title')
                );
                button(document, 'Open Form').click();
                await waitFor(
                    () => buttons(document, 'Upload selected file').length === 1
                );
                const oldTitle = document.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                oldTitle.value = 'Retained dirty edit before upload';
                change(window, oldTitle, 'input');
                const oldFile = document.querySelector('input[type="file"]');
                Object.defineProperty(oldFile, 'files', {
                    configurable: true,
                    value: [
                        new File(
                            ['Synthetic uncertain upload bytes'],
                            'uncertain-upload.txt',
                            { type: 'text/plain' }
                        ),
                    ],
                });
                const oldUpload = button(document, 'Upload selected file');
                oldUpload.click();
                const signRoute =
                    '/api/trpc/publicExtensions.createPublicUploadLink';
                await waitFor(
                    () =>
                        h.count(signRoute) === 1 &&
                        document.getElementById('screen').inert === false
                );
                assert.equal(button(document, 'Save').disabled, true);
                assert.equal(
                    h.count('synthetic-put'),
                    0,
                    'The synthetic signing response is lost before any PUT.'
                );
                assert.equal(h.count('saveForm'), 0);
                h.childTitle('Fresh server title after uncertain upload');
                h.latest(
                    page([
                        record(
                            'rec_same_title',
                            'Fresh server title after uncertain upload'
                        ),
                    ])
                );
                button(document, 'Back to Portal').click();
                button(document, 'Load records').click();
                await waitFor(
                    () =>
                        buttons(document, 'Open Form').length === 1 &&
                        document.getElementById('screen').inert === false
                );
                button(document, 'Open Form').click();
                await waitFor(
                    () => buttons(document, 'Use this request').length === 1
                );
                assert.equal(
                    document.querySelector('input[data-field-id="fld_title"]')
                        .value,
                    'Fresh server title after uncertain upload'
                );
                assertReference(document, 'Retained dirty edit before upload');
                const reference = assertReference(
                    document,
                    'Attachment details are not retained.'
                );
                assert.doesNotMatch(
                    reference.textContent,
                    /Synthetic uncertain upload bytes|uncertain-upload\.txt|https:\/\//,
                    'Attachment recovery retains a generic notice without filenames, bytes or transport capabilities.'
                );
                assert.equal(
                    document.querySelector('input[type="file"]').files.length,
                    0
                );
                assert.doesNotMatch(
                    document.querySelector(
                        '[data-form-attachment-field-id="fld_files"]'
                    ).textContent,
                    /uncertain-upload/
                );
                button(document, 'Use this request').click();
                await waitFor(() => document.querySelector('dialog') != null);
                button(
                    document.querySelector('dialog'),
                    'Use this request'
                ).click();
                await waitFor(
                    () => button(document, 'Save').disabled === false
                );
                assert.equal(
                    document.querySelector('input[data-field-id="fld_title"]')
                        .value,
                    'Fresh server title after uncertain upload'
                );
                assertReference(document, 'Retained dirty edit before upload');
                assertReference(
                    document,
                    'Attachment details are not retained.'
                );
                // Neither a retained old upload action nor a fresh empty picker may replay the file.
                oldUpload.dispatchEvent(new window.Event('click'));
                button(document, 'Upload selected file').click();
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(h.count(signRoute), 1);
                assert.equal(h.count('synthetic-put'), 0);
                assert.equal(h.count('saveForm'), 0);
                button(document, 'Disconnect').click();
                await h.close();
            }
        );
        await check(
            'actual main obscured dirty Form input stays masked and never becomes plaintext recovery reference text',
            async () => {
                const h = await recoveryMain({ obscurePassword: true });
                const { document, window } = h;
                button(document, 'Load records').click();
                await waitFor(() =>
                    rowIds(document).includes('rec_same_title')
                );
                button(document, 'Open Form').click();
                await waitFor(
                    () =>
                        document.querySelector(
                            'input[data-field-id="fld_password"]'
                        ) != null
                );
                const title = document.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                title.value = 'Safe ordinary input reference';
                change(window, title, 'input');
                const password = document.querySelector(
                    'input[data-field-id="fld_password"]'
                );
                const secret = 'SYNTHETIC-PRIVATE-INPUT-DO-NOT-DISPLAY';
                assert.equal(
                    password.type,
                    'password',
                    'The exact published obscurePassword descriptor masks the native input.'
                );
                password.value = secret;
                change(window, password, 'input');
                assert.equal(password.type, 'password');
                assert.equal(
                    password.value,
                    secret,
                    'Masking preserves the native Form input value before dispatch.'
                );
                submit(window, password.closest('form'));
                await waitFor(
                    () =>
                        h.count('saveForm') === 1 &&
                        document.getElementById('screen').inert === false
                );
                assert.equal(
                    h.calls.find((call) => call.route === 'saveForm').body
                        .formRecord.data.fld_password,
                    secret,
                    'The synthetic save uses the native value; this test is about recovery presentation.'
                );
                const reference = assertReference(
                    document,
                    'Safe ordinary input reference'
                );
                assert.equal(password.type, 'password');
                assert.equal(password.value, secret);
                assert.equal(
                    reference.textContent.includes(secret),
                    false,
                    'An obscured dirty field must not be rendered in plaintext in the recovery reference.'
                );
                assert.equal(
                    document
                        .getElementById('screen')
                        .textContent.includes(secret),
                    false
                );
                h.childTitle('Fresh server title for obscured input');
                h.latest(
                    page([
                        record(
                            'rec_same_title',
                            'Fresh server title for obscured input'
                        ),
                    ])
                );
                button(document, 'Back to Portal').click();
                button(document, 'Load records').click();
                await waitFor(
                    () =>
                        buttons(document, 'Open Form').length === 1 &&
                        document.getElementById('screen').inert === false
                );
                button(document, 'Open Form').click();
                await waitFor(
                    () => buttons(document, 'Use this request').length === 1
                );
                assert.equal(
                    document.querySelector(
                        'input[data-field-id="fld_password"]'
                    ).type,
                    'password'
                );
                assert.equal(
                    document.querySelector(
                        'input[data-field-id="fld_password"]'
                    ).value,
                    ''
                );
                assert.equal(
                    assertReference(
                        document,
                        'Safe ordinary input reference'
                    ).textContent.includes(secret),
                    false
                );
                assert.equal(h.count('saveForm'), 1);
                button(document, 'Disconnect').click();
                await h.close();
            }
        );
        await check(
            'actual main previously uploaded noneditable attachments retain a generic notice after uncertain save and fresh inspection without replay',
            async () => {
                const h = await recoveryMain({ attachments: true });
                const { document, window } = h;
                button(document, 'Load records').click();
                await waitFor(() =>
                    rowIds(document).includes('rec_same_title')
                );
                button(document, 'Open Form').click();
                await waitFor(
                    () => buttons(document, 'Upload selected file').length === 1
                );
                const title = document.querySelector(
                    'input[data-field-id="fld_title"]'
                );
                title.value = 'Retained uploaded-file note';
                change(window, title, 'input');
                const originalFile =
                    document.querySelector('input[type="file"]');
                Object.defineProperty(originalFile, 'files', {
                    configurable: true,
                    value: [
                        new File(
                            ['SYNTHETIC-UPLOADED-FILE-BYTES'],
                            'retained-upload.txt',
                            { type: 'text/plain' }
                        ),
                    ],
                });
                const originalUpload = button(document, 'Upload selected file');
                originalUpload.click();
                const signRoute =
                    '/api/trpc/publicExtensions.createPublicUploadLink';
                await waitFor(
                    () =>
                        h.count('synthetic-put') === 1 &&
                        document.getElementById('screen').inert === false
                );
                const originalAttachments = document.querySelector(
                    '[data-form-attachment-field-id="fld_files"]'
                );
                assert.equal(originalAttachments.tagName, 'P');
                assert.match(originalAttachments.textContent, /^Attachment$/);
                assert.doesNotMatch(
                    originalAttachments.textContent,
                    /retained-upload|https:\/\//
                );
                submit(window, title.closest('form'));
                await waitFor(
                    () =>
                        h.count('saveForm') === 1 &&
                        document.getElementById('screen').inert === false
                );
                const firstSave = h.calls.find(
                    (call) => call.route === 'saveForm'
                );
                assert.equal(
                    firstSave.body.formRecord.data.fld_files[0].filename,
                    'retained-upload.txt'
                );
                assert.match(
                    JSON.stringify(firstSave.body.formRecord.data.fld_files),
                    /https:\/\/files\.example\.test\/old-upload/
                );
                h.childTitle('Fresh server title with no uploaded attachment');
                h.latest(
                    page([
                        record(
                            'rec_same_title',
                            'Fresh server title with no uploaded attachment'
                        ),
                    ])
                );
                button(document, 'Back to Portal').click();
                button(document, 'Load records').click();
                await waitFor(
                    () =>
                        buttons(document, 'Open Form').length === 1 &&
                        document.getElementById('screen').inert === false
                );
                button(document, 'Open Form').click();
                await waitFor(
                    () => buttons(document, 'Use this request').length === 1
                );
                assert.equal(
                    document.querySelector('input[data-field-id="fld_title"]')
                        .value,
                    'Fresh server title with no uploaded attachment'
                );
                const freshAttachments = document.querySelector(
                    '[data-form-attachment-field-id="fld_files"]'
                );
                assert.equal(freshAttachments.tagName, 'P');
                assert.equal(freshAttachments.textContent, '');
                assert.equal(
                    document.querySelector('input[type="file"]').files.length,
                    0
                );
                const reference = assertReference(
                    document,
                    'Attachment details are not retained.'
                );
                assert.doesNotMatch(
                    reference.textContent,
                    /https:\/\/|old-upload|retained-upload\.txt|SYNTHETIC-UPLOADED-FILE-BYTES/,
                    'Retained attachment input exposes no filename, upload URL, reference or file bytes.'
                );
                assert.equal(h.count('saveForm'), 1);
                assert.equal(h.count(signRoute), 1);
                assert.equal(h.count('synthetic-put'), 1);
                button(document, 'Use this request').click();
                await waitFor(() => document.querySelector('dialog') != null);
                button(
                    document.querySelector('dialog'),
                    'Use this request'
                ).click();
                await waitFor(
                    () => button(document, 'Save').disabled === false
                );
                assertReference(
                    document,
                    'Attachment details are not retained.'
                );
                assert.equal(
                    h.count('saveForm'),
                    1,
                    'Acknowledgment does not save attachment refs or replay the upload.'
                );
                originalUpload.dispatchEvent(new window.Event('click'));
                button(document, 'Upload selected file').click();
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(h.count(signRoute), 1);
                assert.equal(h.count('synthetic-put'), 1);
                submit(window, button(document, 'Save').closest('form'));
                await waitFor(
                    () =>
                        h.count('saveForm') === 2 &&
                        document.getElementById('screen').inert === false
                );
                assert.deepEqual(
                    h.calls.filter((call) => call.route === 'saveForm')[1].body
                        .formRecord.data.fld_files,
                    [],
                    'A separate explicit edit starts from the fresh native attachment baseline.'
                );
                assert.equal(h.count(signRoute), 1);
                assert.equal(h.count('synthetic-put'), 1);
                button(document, 'Disconnect').click();
                await h.close();
            }
        );
        await check(
            'actual main expired edit blocks Delete, comments and retained controls without dispatch',
            async () => {
                const h = await recoveryMain({ deletable: true });
                const { document, window } = h;
                button(document, 'Load records').click();
                await waitFor(() =>
                    rowIds(document).includes('rec_same_title')
                );
                button(document, 'Open Form').click();
                await waitFor(
                    () => buttons(document, 'Delete this record').length === 1
                );
                const originalDelete = button(document, 'Delete this record');
                const originalForm = originalDelete.closest('form');
                const originalLoadComments = button(document, 'Load comments');
                const originalAddComment = button(document, 'Add comment');
                document.querySelector(
                    'textarea[placeholder="Write a comment"]'
                ).value = 'Retained old comment';
                assert.equal(originalDelete.disabled, false);
                originalDelete.click();
                await waitFor(() => document.querySelector('dialog') != null);
                const retainedConfirmation = button(
                    document.querySelector('dialog'),
                    'Delete record'
                );
                assert.equal(h.count('/api/trpc/airtable.deleteRecord'), 0);
                h.aba();
                const expiredDelete = button(document, 'Delete this record');
                assert.equal(expiredDelete.disabled, true);
                assert.equal(button(document, 'Save').disabled, true);
                const expiredLoadComments = button(document, 'Load comments');
                const expiredAddComment = button(document, 'Add comment');
                assert.equal(expiredLoadComments.disabled, true);
                assert.equal(expiredAddComment.disabled, true);
                document.querySelector(
                    'textarea[placeholder="Write a comment"]'
                ).value = 'Expired current comment';
                assert.equal(document.querySelector('dialog'), null);
                // Programmatic events bypass disabled native-button behavior;
                // the actual owner/plan gate must still prevent dispatch.
                retainedConfirmation.dispatchEvent(new window.Event('click'));
                originalDelete.dispatchEvent(new window.Event('click'));
                expiredDelete.dispatchEvent(new window.Event('click'));
                for (const retained of [
                    originalLoadComments,
                    originalAddComment,
                    expiredLoadComments,
                    expiredAddComment,
                ])
                    retained.dispatchEvent(new window.Event('click'));
                submit(window, originalForm);
                submit(window, expiredDelete.closest('form'));
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(document.querySelector('dialog'), null);
                assert.equal(
                    h.count('/api/trpc/airtable.deleteRecord'),
                    0,
                    'An expired edit or retained confirmation cannot authorize Delete.'
                );
                assert.equal(h.count('saveForm'), 0);
                assert.equal(
                    h.count('/api/trpc/airtable.getAirtableCommentsForRecord'),
                    0
                );
                assert.equal(
                    h.count('/api/trpc/airtable.addAirtableCommentForRecord'),
                    0
                );
                button(document, 'Disconnect').click();
                await h.close();
            }
        );
        await check(
            'actual main standalone unknown create keeps its conservative latch across Reload and new clients without inventing a request list',
            async () => {
                let saves = 0;
                let loads = 0;
                const fetch = async (input) => {
                    const route = new URL(String(input)).searchParams.get(
                        'route'
                    );
                    if (route === 'fetchExtensionForEndUser') {
                        loads += 1;
                        const form = makeForm({
                            childExtensionInfo: {
                                accessType: { type: 'create' },
                            },
                        });
                        form.payload.hasParentExtension = false;
                        return new Response(JSON.stringify(form));
                    }
                    if (route === 'saveForm') {
                        saves += 1;
                        throw new Error(
                            'Synthetic standalone response lost after dispatch.'
                        );
                    }
                    throw new Error(
                        `Unexpected standalone recovery route: ${route}`
                    );
                };
                const { window, close } = await environment(fetch);
                await loadExample('main');
                const document = window.document;
                const connect = async () => {
                    document.getElementById('api-origin').value =
                        'https://sdk.example.test';
                    document.getElementById('share-id').value =
                        'standalone_share';
                    submit(window, document.getElementById('connection-form'));
                    await waitFor(
                        () =>
                            buttons(document, 'Save').length === 1 &&
                            document.getElementById('screen').inert === false
                    );
                };
                const assertBlocked = () => {
                    assert.equal(button(document, 'Save').disabled, true);
                    assert.match(
                        document.getElementById('screen').textContent,
                        /Earlier outcome not confirmed/
                    );
                    assert.match(
                        document.getElementById('screen').textContent,
                        /usual request access|form owner/
                    );
                    assert.equal(
                        buttons(document, 'Check latest requests').length,
                        0
                    );
                    assert.equal(buttons(document, 'Create record').length, 0);
                    submit(window, document.querySelector('#screen form'));
                };
                await connect();
                submit(window, document.querySelector('#screen form'));
                await waitFor(
                    () =>
                        saves === 1 &&
                        document.getElementById('screen').inert === false
                );
                assertBlocked();
                document.getElementById('reload').click();
                await waitFor(
                    () =>
                        loads === 2 &&
                        document.getElementById('screen').inert === false
                );
                assertBlocked();
                await connect();
                assertBlocked();
                await new Promise((resolve) => setImmediate(resolve));
                assert.equal(
                    saves,
                    1,
                    'The standalone latch cannot be bypassed by Reload or replacing the client.'
                );
                button(document, 'Disconnect').click();
                await close();
            }
        );
        for (const teardown of ['Logout', 'Disconnect']) {
            await check(
                `actual packed main ${teardown} scrubs private recovery reference input while keeping unknown-create replay blocked`,
                async () => {
                    const privateText = 'Previous visitor private narrative';
                    const privateFilename =
                        'previous-visitor-private-attachment.pdf';
                    const privateTitle = 'Previous visitor private field label';
                    const first = makeForm({
                        childExtensionInfo: { accessType: { type: 'create' } },
                    });
                    first.payload.hasParentExtension = false;
                    first.payload.fieldIdsInForm = ['fld_title', 'fld_files'];
                    first.payload.fieldIdsToSchemas.fld_title.airtableField.name =
                        privateTitle;
                    first.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
                        title: privateTitle,
                    };
                    first.payload.fieldIdsToSchemas.fld_files = {
                        fieldType: 'multipleAttachments',
                        airtableField: {
                            id: 'fld_files',
                            name: 'Files',
                            config: { type: 'multipleAttachments' },
                        },
                    };
                    first.payload.formRecord.data.fld_files = [
                        {
                            url: 'https://files.example.test/private-reference',
                            filename: privateFilename,
                        },
                    ];
                    first.payload.formFieldIdsWithUnsavedChanges = [
                        'fld_files',
                    ];
                    first.payload.urlPrefilledFieldIds = [];
                    const fresh = structuredClone(first);
                    fresh.payload.fieldIdsToSchemas.fld_title.airtableField.name =
                        'Current public title';
                    fresh.payload.fieldIdsToSchemas.fld_title.miniExtConfig = {
                        title: 'Current public title',
                    };
                    fresh.payload.formRecord.data.fld_title =
                        'Fresh public baseline';
                    fresh.payload.formRecord.data.fld_files = [];
                    fresh.payload.formFieldIdsWithUnsavedChanges = [];
                    const saves = [];
                    let loads = 0;
                    const fetch = async (input, init) => {
                        const route = new URL(String(input)).searchParams.get(
                            'route'
                        );
                        if (route === 'fetchExtensionForEndUser') {
                            loads += 1;
                            return new Response(
                                JSON.stringify(loads === 1 ? first : fresh)
                            );
                        }
                        assert.equal(route, 'saveForm');
                        saves.push(JSON.parse(String(init?.body)));
                        throw new Error(
                            'Synthetic standalone response lost after dispatch.'
                        );
                    };
                    const { window, close } = await environment(fetch);
                    await loadExample('main');
                    const document = window.document;
                    const idle = () =>
                        document
                            .getElementById('screen')
                            .getAttribute('aria-busy') === 'false';
                    const reference = () =>
                        document.querySelector(
                            'details[aria-label="Earlier local input (reference only)"]'
                        );
                    const connect = async () => {
                        document.getElementById('api-origin').value =
                            'https://sdk.example.test';
                        document.getElementById('share-id').value =
                            'privacy_standalone_share';
                        submit(
                            window,
                            document.getElementById('connection-form')
                        );
                        await waitFor(
                            () =>
                                document.querySelector(
                                    '[data-field-id="fld_title"]'
                                ) != null && idle()
                        );
                    };
                    await connect();
                    const oldTitle = document.querySelector(
                        '[data-field-id="fld_title"]'
                    );
                    oldTitle.value = privateText;
                    change(window, oldTitle, 'input');
                    const oldCard = oldTitle.closest('form');
                    submit(window, oldCard);
                    await waitFor(() => saves.length === 1 && idle());
                    assert.deepEqual(saves[0].formRecord.data, {
                        ...first.payload.formRecord.data,
                        fld_title: privateText,
                    });
                    assert(!reference().textContent.includes(privateFilename));
                    assert(
                        reference().textContent.includes(
                            'Attachment details are not retained.'
                        )
                    );
                    for (const secret of [privateText, privateTitle])
                        assert(reference().textContent.includes(secret));
                    document.getElementById('reload').click();
                    await waitFor(() => loads === 2 && idle());
                    assert.equal(
                        document.querySelector('[data-field-id="fld_title"]')
                            .value,
                        'Fresh public baseline'
                    );
                    assert.equal(
                        document.querySelector(
                            '[data-form-attachment-field-id="fld_files"]'
                        ).textContent,
                        ''
                    );
                    assert(!reference().textContent.includes(privateFilename));
                    assert(
                        reference().textContent.includes(
                            'Attachment details are not retained.'
                        )
                    );
                    for (const secret of [privateText, privateTitle])
                        assert(
                            reference().textContent.includes(secret),
                            'Same-person Reload retains reference-only input.'
                        );
                    document
                        .getElementById(
                            teardown === 'Logout' ? 'logout' : 'disconnect'
                        )
                        .click();
                    if (teardown === 'Logout') {
                        document.getElementById('reload').click();
                        await waitFor(() => loads === 3 && idle());
                    } else await connect();
                    assert.equal(loads, 3);
                    assert.equal(
                        reference() === null,
                        true,
                        'Explicit privacy teardown must remove earlier reference input after anonymous reconnect.'
                    );
                    for (const secret of [
                        privateText,
                        privateFilename,
                        privateTitle,
                    ])
                        assert.equal(
                            document.body.textContent.includes(secret),
                            false
                        );
                    assert.match(
                        document.getElementById('session-summary').textContent,
                        /Anonymous/
                    );
                    assert.equal(
                        document.querySelector('[data-field-id="fld_title"]')
                            .value,
                        'Fresh public baseline'
                    );
                    assert.equal(
                        document.querySelector(
                            '[data-form-attachment-field-id="fld_files"]'
                        ).textContent,
                        ''
                    );
                    assert.equal(button(document, 'Save').disabled, true);
                    assert.match(
                        document.getElementById('screen').textContent,
                        /Earlier outcome not confirmed/
                    );
                    submit(window, oldCard);
                    submit(window, document.querySelector('#screen form'));
                    await new Promise((resolve) => setImmediate(resolve));
                    assert.equal(
                        saves.length,
                        1,
                        'Privacy teardown must retain the uncertain-create operation guard.'
                    );
                    document.getElementById('disconnect').click();
                    await close();
                }
            );
        }
        await checkPortalAttachmentCases({ check, mount, editablePortal });
        const baselineChecks = checks;
        await checkPortalSortCases({
            check,
            mount,
            environment,
            loadExample,
            editablePortal,
        });
        const sortChecks = checks - baselineChecks;
        const beforeFilters = checks;
        await checkPortalFilterCases({
            check,
            mount,
            environment,
            loadExample,
            editablePortal,
            consumer,
        });
        const filterChecks = checks - beforeFilters;
        if (failures.length)
            throw new AggregateError(
                failures,
                'Packed browser Portal example regressions failed.'
            );
        return { checks: baselineChecks, sortChecks, filterChecks };
    } finally {
        while (environments.length) await environments.pop()();
    }
}
