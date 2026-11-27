import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { build } from 'esbuild';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const privateFailure = 'Synthetic private presentation detail';

// Assertions shared with the non-browser proof controls. These inspect the real
// starter's rendered state and intercepted dispatches, not an SDK owner mock.
export function assertFailedConfirmation(actual, expected) {
    assert.equal(actual.attempts, 1);
    assert.equal(actual.saves, 0);
    assert.equal(actual.reads, expected.reads);
    assert.equal(actual.dialogs, 0);
    assert.deepEqual(actual.banner, {
        text: 'Child Save was not accepted. Retry only after checking its state.',
        error: true,
    });
    assert.equal(actual.privateDetailVisible, false);
    assert.equal(actual.childTitle, expected.childTitle);
    assert.equal(actual.parentTitle, expected.parentTitle);
    assert.deepEqual(actual.parentLinks, expected.parentLinks);
}

export function assertEditedMultiPageReview(actual, expected) {
    assert.deepEqual(actual.reviewEnabled, [false, false, true]);
    assert.equal(actual.saves, 0);
    assert.equal(actual.reads, expected.reads);
    assert.equal(actual.dialogs, 0);
    assert.deepEqual(actual.banner, {
        text: 'Review cancelled. Continue editing the child Form.',
        error: false,
    });
    assert.deepEqual(actual.answers, expected.answers);
    assert.equal(actual.parentTitle, expected.parentTitle);
    assert.deepEqual(actual.parentLinks, expected.parentLinks);
}

export function assertMouseBlurCommit(actual, expected) {
    assert.equal(actual.focusedBefore, true);
    assert.equal(actual.focusedAfter, false);
    assert.equal(actual.changes, 1);
    assert.equal(actual.childTitle, expected.childTitle);
    assert.equal(actual.saves, 0);
    assert.equal(actual.reads, expected.reads);
}

export function assertChildSaveRouting(input, mode) {
    assert.equal(input.extensionAccessToken, 'synthetic_child_token');
    assert.equal(input.formRecord.type, mode);
    if (mode === 'edit') {
        assert.equal(input.formRecord.tableId, 'tbl_child');
        assert.equal(input.formRecord.recordId, 'rec_existing');
    } else {
        // Create is routed by the child token, not a caller-supplied identity.
        assert.equal('tableId' in input.formRecord, false);
        assert.equal('recordId' in input.formRecord, false);
    }
}

/** Build the unmodified, copied installed starter without launching a browser. */
export async function prepareStarterConfirmationProof({
    consumer,
    output,
    root,
    reactHost = false,
}) {
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    const app = join(consumer, 'confirmation-starter');
    cpSync(join(installed, 'examples/browser'), app, { recursive: true });
    const sourceHashes = {};
    for (const name of [
        'main.ts',
        'portal.ts',
        'linkedChildPanel.ts',
        'confirmation.ts',
    ]) {
        const bytes = readFileSync(join(app, 'src', name));
        assert.deepEqual(
            bytes,
            readFileSync(join(root, 'examples/browser/src', name))
        );
        sourceHashes[name] = hash(bytes);
    }
    const bundled = await build({
        absWorkingDir: app,
        ...(reactHost
            ? {
                  stdin: {
                      resolveDir: app,
                      contents: `
import { createElement, version } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
const main = document.querySelector('main');
const mount = document.createElement('div');
main.before(mount);
flushSync(() => createRoot(mount).render(createElement('div', {
    'data-sdk-react-host': version,
    ref: (host) => { if (host) host.append(main); },
})));
await import('./src/main.ts');
`,
                  },
              }
            : { entryPoints: ['src/main.ts'] }),
        bundle: true,
        platform: 'browser',
        format: 'esm',
        target: 'es2022',
        write: false,
        outfile: join(output, 'starter-confirmation.js'),
        metafile: true,
    });
    const sdkInputs = Object.keys(bundled.metafile.inputs).filter((name) =>
        name.includes('/@miniextensions/sdk/')
    );
    assert(sdkInputs.length > 0);
    for (const input of sdkInputs) {
        assert(input.includes('/dist/esm/'));
        const member = relative(installed, realpathSync(resolve(app, input)));
        assert(
            member &&
                !isAbsolute(member) &&
                member !== '..' &&
                !member.startsWith(`..${sep}`)
        );
    }
    for (const name of Object.keys(sourceHashes))
        assert(
            Object.keys(bundled.metafile.inputs).some((input) =>
                input.endsWith(`src/${name}`)
            )
        );
    const javascript = bundled.outputFiles[0].contents;
    writeFileSync(join(output, 'starter-confirmation.js'), javascript);
    const html = readFileSync(join(app, 'index.html'), 'utf8').replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/g,
        '<script type="module" src="/main.js"></script>'
    );
    return {
        sourceHashes,
        sdkInputs,
        bundleSha256: hash(javascript),
        assets: new Map([
            ['/', ['text/html', html]],
            ['/main.js', ['text/javascript', javascript]],
            [
                '/styles.css',
                ['text/css', readFileSync(join(app, 'styles.css'))],
            ],
            ['/favicon.ico', ['image/x-icon', Buffer.alloc(0)]],
        ]),
    };
}

export async function checkRootReadonlyText({
    browser,
    fixtures,
    origin,
    evidence = {},
}) {
    const apiOrigin = 'https://synthetic-sdk.invalid';
    const readonlySelector = '#screen [data-field-id="fld_delivery_reference"]';
    const hiddenLabel = 'Conditional private note';
    const hiddenValue = 'Hidden note H13';
    const loaded = fixtures.parentForm('edit');
    const payload = loaded.payload;
    const editable = payload.fieldIdsToSchemas.fld_title;
    const textField = (id, name, config) => ({
        ...editable,
        airtableField: {
            ...editable.airtableField,
            id,
            name,
            isPrimaryField: false,
        },
        miniExtConfig: config,
    });
    payload.fieldIdsToSchemas = {
        fld_delivery_reference: textField(
            'fld_delivery_reference',
            'Delivery ID',
            {
                title: 'Delivery reference',
                readOnly: true,
            }
        ),
        fld_title: editable,
        fld_conditional_note: textField('fld_conditional_note', hiddenLabel, {
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'synthetic-note-visible',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'singleLineText',
                            idOrName: { type: 'id', id: 'fld_title' },
                            value: 'Reveal note',
                        },
                    },
                ],
            },
        }),
    };
    payload.fieldIdsInForm = Object.keys(payload.fieldIdsToSchemas);
    payload.fieldNamesToSchemas = Object.fromEntries(
        Object.values(payload.fieldIdsToSchemas).map((schema) => [
            schema.airtableField.name,
            structuredClone(schema),
        ])
    );
    payload.formRecord.data = {
        fld_delivery_reference: 'A17',
        fld_title: 'Editable sibling',
        fld_conditional_note: hiddenValue,
    };
    payload.formFieldIdsWithUnsavedChanges = [];

    const calls = { loads: 0, saves: 0 };
    const pageErrors = [];
    const unexpectedRequests = [];
    Object.assign(evidence, {
        mode: 'edit',
        scenario: 'root-readonly-text-accessibility',
        calls,
        pageErrors,
        unexpectedRequests,
    });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await context.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const method = request.method();
            if (
                url.origin === origin &&
                method === 'GET' &&
                ['/', '/main.js', '/styles.css', '/favicon.ico'].includes(
                    url.pathname
                )
            )
                return route.continue();
            const headers = {
                'access-control-allow-origin': origin,
                'access-control-allow-headers': '*',
                'access-control-allow-methods': 'POST, OPTIONS',
            };
            if (url.origin === apiOrigin) {
                if (method === 'OPTIONS')
                    return route.fulfill({ status: 204, headers });
                const operation = url.searchParams.get('route');
                if (
                    method === 'POST' &&
                    operation === 'fetchExtensionForEndUser'
                ) {
                    calls.loads++;
                    const {
                        shareId,
                        recordId,
                        context: loadContext,
                    } = request.postDataJSON();
                    assert.equal(shareId, 'share_synthetic_parent');
                    assert.equal(recordId, 'rec_parent');
                    assert.deepEqual(loadContext, { type: 'direct-url' });
                    return route.fulfill({ json: loaded, headers });
                }
                if (operation === 'saveForm') {
                    calls.saves++;
                    return route.fulfill({ status: 409, headers });
                }
            }
            unexpectedRequests.push(`${method} ${url.origin}${url.pathname}`);
            return route.abort();
        });
        await page.goto(origin);
        await page.locator('#api-origin').fill(apiOrigin);
        await page.locator('#share-id').fill('share_synthetic_parent');
        await page.locator('#record-id').fill('rec_parent');
        await page.locator('#connection-form button[type=submit]').click();
        const readOnly = page.locator(readonlySelector);
        await readOnly.waitFor();
        await page.waitForFunction(
            () =>
                document.querySelector('#screen')?.getAttribute('aria-busy') ===
                'false'
        );

        const cdp = await context.newCDPSession(page);
        const { root } = await cdp.send('DOM.getDocument');
        const { nodeId } = await cdp.send('DOM.querySelector', {
            nodeId: root.nodeId,
            selector: readonlySelector,
        });
        const { node } = await cdp.send('DOM.describeNode', { nodeId });
        const { nodes } = await cdp.send('Accessibility.getFullAXTree');
        const exposed = nodes.filter((node) => !node.ignored);
        const ax = exposed.find(
            (item) => item.backendDOMNodeId === node.backendNodeId
        );
        evidence.accessibility =
            ax == null
                ? null
                : {
                      role: ax.role?.value,
                      name: ax.name?.value,
                      value: ax.value?.value,
                  };
        evidence.hiddenField = {
            visible: await page
                .locator('#screen [data-field-id="fld_conditional_note"]')
                .isVisible(),
            exposed: exposed.some((item) =>
                [item.name?.value, item.value?.value].some(
                    (text) => text === hiddenLabel || text === hiddenValue
                )
            ),
        };
        await readOnly.focus();
        evidence.readOnlyFocused = await readOnly.evaluate(
            (node) => node === document.activeElement
        );
        if (evidence.readOnlyFocused) await page.keyboard.type('X');
        evidence.readOnlyEditable = await readOnly.isEditable();
        evidence.readOnlyValue = await readOnly.inputValue();
        const sibling = page.getByRole('textbox', {
            name: 'Title',
            exact: true,
        });
        assert.equal(await sibling.inputValue(), 'Editable sibling');
        await sibling.press('End');
        await page.keyboard.type(' edited');
        await page.keyboard.press('Tab');
        evidence.siblingValue = await sibling.inputValue();

        assert.deepEqual(evidence.accessibility, {
            role: 'textbox',
            name: 'Delivery reference',
            value: 'A17',
        });
        assert.deepEqual(evidence.hiddenField, {
            visible: false,
            exposed: false,
        });
        assert.equal(evidence.readOnlyEditable, false);
        assert.equal(evidence.readOnlyValue, 'A17');
        assert.equal(await readOnly.inputValue(), 'A17');
        assert.equal(evidence.siblingValue, 'Editable sibling edited');
        assert.deepEqual(calls, { loads: 1, saves: 0 });
        assert.deepEqual(pageErrors, []);
        assert.deepEqual(unexpectedRequests, []);
        return evidence;
    } finally {
        await context.close();
        evidence.cleanup = true;
    }
}

async function checkPortalRelatedEdit({ browser, fixtures, origin }) {
    const apiOrigin = 'https://synthetic-sdk.invalid';
    const linkFieldId = 'fld_children_a';
    const projectId = 'rec_parent';
    const relatedId = 'rec_existing';
    const portal = fixtures.portalPage();
    const project = fixtures.parentForm('edit');
    project.extensionId = 'extension_child';
    project.workspaceId = portal.workspaceId;
    project.payload.baseId = portal.payload.baseId;
    project.payload.extensionName = 'Project';
    project.payload.hasParentExtension = true;
    project.payload.publicFields.state.tableId = 'table_children';
    project.payload.formRecord = {
        type: 'edit',
        tableId: 'table_children',
        recordId: projectId,
        data: { fld_title: 'Stored Project title', [linkFieldId]: [relatedId] },
    };
    project.payload.fieldIdsInForm = ['fld_title', linkFieldId];
    project.payload.fieldIdsToSchemas[
        linkFieldId
    ].miniExtConfig.recordFinderMode = 'hide-finder';
    const related = fixtures.childForm('edit');
    related.workspaceId = project.workspaceId;
    related.payload.baseId = project.payload.baseId;
    related.payload.formRecord = {
        type: 'edit',
        tableId: 'tbl_child',
        recordId: relatedId,
        data: {
            ...related.payload.formRecord.data,
            fld_title: 'Stored Related title',
        },
    };
    related.payload.formFieldIdsWithUnsavedChanges = [];
    const titleField =
        project.payload.fieldIdsToSchemas.fld_title.airtableField;
    const calls = [];
    const errors = [];
    const unexpectedRequests = [];
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(() => {
            window.portalRelatedEditEvents = {
                activations: [],
                escapes: [],
                projectSubmits: 0,
            };
            document.addEventListener(
                'submit',
                (event) => {
                    if (
                        event.target instanceof HTMLFormElement &&
                        event.target.querySelector(
                            '[data-field-id="fld_children_a"]'
                        )
                    )
                        window.portalRelatedEditEvents.projectSubmits++;
                },
                true
            );
        });
        await context.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin === origin) return route.continue();
            const headers = {
                'access-control-allow-origin': origin,
                'access-control-allow-headers': '*',
                'access-control-allow-methods': 'GET, POST, OPTIONS',
            };
            const reply = (json) => route.fulfill({ headers, json });
            if (url.origin === apiOrigin) {
                if (request.method() === 'OPTIONS')
                    return route.fulfill({ status: 204, headers });
                const operation = url.searchParams.get('route');
                if (operation === 'fetchExtensionForEndUser') {
                    assert.equal(request.method(), 'POST');
                    const input = request.postDataJSON();
                    if (!('childExtensionInfo' in input)) {
                        calls.push('load Portal');
                        assert.equal(input.context.type, 'direct-url');
                        return reply(portal);
                    }
                    const { childExtensionId, accessType } =
                        input.childExtensionInfo;
                    assert.equal(input.context.type, 'modal');
                    assert.equal(accessType.type, 'edit');
                    if (childExtensionId === project.extensionId) {
                        calls.push('load Portal Project');
                        assert.equal(
                            accessType.childExtensionRecordId,
                            projectId
                        );
                        assert.equal(
                            input.context.linkedTableIdOfLinkedRecordField,
                            'table_children'
                        );
                        assert.deepEqual(input.childExtensionAccessData, {
                            parentExtensionAccessToken:
                                portal.payload.extensionAccessToken,
                            fieldIdUsedToAccessExtension: 'fld_children',
                        });
                        return reply(project);
                    }
                    calls.push('load selected Related');
                    assert.equal(childExtensionId, related.extensionId);
                    assert.equal(accessType.childExtensionRecordId, relatedId);
                    assert.equal(
                        input.context.linkedTableIdOfLinkedRecordField,
                        'tbl_child'
                    );
                    assert.deepEqual(input.childExtensionAccessData, {
                        parentExtensionAccessToken:
                            project.payload.extensionAccessToken,
                        fieldIdUsedToAccessExtension: linkFieldId,
                    });
                    return reply(related);
                }
                if (operation === 'fetchRecordsForLinkedTableOnPortal') {
                    calls.push('read Portal Projects');
                    assert.equal(request.method(), 'POST');
                    return reply(
                        fixtures.portalListPage({
                            recordIds: [projectId],
                            tableIdsToLinkedTableStates: {
                                table_children: {
                                    airtableFields: [titleField],
                                    recordIdsToAirtableRecords: {
                                        [projectId]: {
                                            id: projectId,
                                            fields: project.payload.formRecord
                                                .data,
                                        },
                                    },
                                },
                            },
                        })
                    );
                }
                if (
                    url.pathname ===
                    '/api/trpc/publicExtensions.fetchInitialTableIdsToLinkedTableStates'
                ) {
                    calls.push('read selected Related');
                    assert.equal(request.method(), 'GET');
                    return reply({
                        result: {
                            data: {
                                tbl_child: {
                                    airtableFields: [titleField],
                                    recordIdsToAirtableRecords: {
                                        [relatedId]: {
                                            id: relatedId,
                                            fields: {
                                                fld_title:
                                                    'Stored Related title',
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    });
                }
                if (operation === 'saveForm') calls.push('attempted Save');
            }
            unexpectedRequests.push(`${request.method()} ${url.pathname}`);
            return route.abort();
        });

        await page.goto(origin);
        await page.locator('#api-origin').fill(apiOrigin);
        await page.locator('#share-id').fill('share_synthetic_portal');
        await page
            .locator('#connection-form button[type=submit]')
            .press('Enter');
        const screen = page.locator('#screen');
        const button = (name) =>
            screen.getByRole('button', { name, exact: true });
        const idle = () =>
            page.waitForFunction(
                () =>
                    document
                        .querySelector('#screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
        await idle();
        await button('Load records').press('Enter');
        await idle();
        await button('Open Form').press('Enter');
        await idle();
        const projectTitle = screen.locator('[data-field-id="fld_title"]');
        const projectLinks = screen.locator(`[data-field-id="${linkFieldId}"]`);
        assert(
            await projectTitle.evaluate((node) =>
                Boolean(
                    node.form?.querySelector('[data-field-id="fld_children_a"]')
                )
            )
        );
        await projectTitle.fill('Unsaved Project title');
        await projectTitle.press('Tab');
        assert.deepEqual(JSON.parse(await projectLinks.inputValue()), [
            relatedId,
        ]);
        await button('Load selected records').press('Enter');
        await idle();
        const edit = button(`Edit linked record ${relatedId}`);
        await edit.waitFor();
        assert.equal(await button('Create linked record').count(), 0);
        const opener = await edit.elementHandle();
        assert(opener);
        await opener.evaluate((node) => {
            node.addEventListener('click', (event) => {
                window.portalRelatedEditEvents.activations.push({
                    trusted: event.isTrusted,
                    detail: event.detail,
                });
            });
        });
        await opener.focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('dialog', {
            name: 'Edit linked record',
            exact: true,
        });
        await idle();
        await dialog.waitFor();
        assert(
            await dialog.evaluate(
                (node) =>
                    node.matches(':modal') &&
                    node.contains(document.activeElement)
            )
        );
        await dialog.evaluate((node) => {
            node.addEventListener('cancel', (event) => {
                window.portalRelatedEditEvents.escapes.push(event.isTrusted);
            });
        });
        const relatedTitle = dialog.locator('[data-field-id="fld_title"]');
        assert.equal(await relatedTitle.inputValue(), 'Stored Related title');
        await relatedTitle.fill('Unsaved Related title');
        await relatedTitle.press('Tab');
        await page.keyboard.press('Escape');
        const confirmation = page.getByRole('alertdialog', {
            name: 'Close linked record?',
        });
        await confirmation.waitFor();
        assert(
            await confirmation
                .getByRole('button', { name: 'Keep editing' })
                .evaluate((node) => node === document.activeElement)
        );
        await confirmation
            .getByRole('button', { name: 'Confirm close' })
            .press('Enter');
        await dialog.waitFor({ state: 'hidden' });
        assert(
            await opener.evaluate(
                (node) => node === document.activeElement && node.isConnected
            ),
            'Focus must return to the same Related Edit opener'
        );
        assert.equal(await projectTitle.inputValue(), 'Unsaved Project title');
        assert.deepEqual(JSON.parse(await projectLinks.inputValue()), [
            relatedId,
        ]);

        await page.keyboard.press('Enter');
        await idle();
        await dialog.waitFor();
        assert.equal(await relatedTitle.inputValue(), 'Unsaved Related title');
        const events = await page.evaluate(
            () => window.portalRelatedEditEvents
        );
        assert.deepEqual(events, {
            activations: [
                { trusted: true, detail: 0 },
                { trusted: true, detail: 0 },
            ],
            escapes: [true],
            projectSubmits: 0,
        });
        assert.deepEqual(calls, [
            'load Portal',
            'read Portal Projects',
            'load Portal Project',
            'read selected Related',
            'load selected Related',
        ]);
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpectedRequests, []);
        return {
            mode: 'edit',
            scenario: 'portal-project-related-edit',
            calls,
            events,
            exactFocusRestored: true,
            draftsRetained: true,
            saves: 0,
        };
    } finally {
        await context.close();
    }
}

/** Bounded Review paths in the copied installed app, with synthetic responses. */
export async function checkStarterConfirmationRecovery({
    browser,
    consumer,
    output,
    fixtures,
    root,
    onlyClose = false,
    onlySelectedEditDialog = false,
    reactVersion,
}) {
    const prepared = await prepareStarterConfirmationProof({
        consumer,
        output,
        root,
        reactHost: reactVersion != null,
    });
    const report = {
        scope: 'Copied installed starter; synthetic responses only, not hosted acceptance',
        sourceHashes: prepared.sourceHashes,
        sdkInputs: prepared.sdkInputs,
        bundleSha256: prepared.bundleSha256,
        cases: [],
    };
    const server = createServer((request, response) => {
        const asset = prepared.assets.get(
            new URL(request.url, 'http://127.0.0.1').pathname
        );
        if (!asset) {
            response.writeHead(404);
            response.end();
            return;
        }
        response.setHeader('Content-Type', asset[0]);
        response.end(asset[1]);
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        const closeCase = { mode: 'edit', close: true };
        const scenarios = onlySelectedEditDialog
            ? [{ ...closeCase, editDialog: true }]
            : onlyClose
              ? [closeCase]
              : [
                    { mode: 'create', multiPage: false },
                    { mode: 'edit', multiPage: false },
                    { mode: 'create', multiPage: true },
                    { mode: 'create', multiPage: false, mouseBlur: true },
                    closeCase,
                ];
        for (const {
            mode,
            multiPage,
            mouseBlur,
            close,
            editDialog,
        } of scenarios) {
            const label = editDialog
                ? 'selected Edit dialog'
                : close
                  ? 'dirty Close and explicit resume'
                  : mouseBlur
                    ? 'first-click Review with a focused Title'
                    : multiPage
                      ? 'multi-page Review'
                      : 'confirmation recovery';
            console.log(`Installed starter ${mode} ${label}: starting`);
            const calls = {
                reads: 0,
                childLoads: 0,
                childRecords: [],
                saves: [],
            };
            const parent = fixtures.parentForm('edit');
            const selectedTableFields = editDialog
                ? fixtures.childSaved('edit').context
                      .newTableIdsToLinkedTableStates.tbl_child.airtableFields
                : [parent.payload.fieldIdsToSchemas.fld_title.airtableField];
            if (editDialog)
                parent.payload.linkedRecordFieldIdToDetailFields.fld_children_a =
                    [
                        {
                            fieldId: 'fld_title',
                            fieldName: 'Title',
                            titleOverride: null,
                            miniExtConfig: {},
                            isHidden: false,
                            fieldIsInEditingChildForm: false,
                            childFormField: null,
                        },
                    ];
            parent.payload.fieldIdsInForm = ['fld_title', 'fld_children_a'];
            parent.payload.fieldIdsToSchemas.fld_children_a.miniExtConfig.recordFinderMode =
                'hide-finder';
            const context = await browser.newContext({
                serviceWorkers: 'block',
            });
            const errors = [];
            const unexpectedRequests = [];
            try {
                const page = await context.newPage();
                page.setDefaultTimeout(10000);
                page.on('pageerror', (error) => errors.push(error.message));
                if (editDialog || mouseBlur)
                    await page.addInitScript(() => {
                        let parentSubmits = 0;
                        document.addEventListener(
                            'submit',
                            (event) => {
                                if (
                                    event.target instanceof HTMLFormElement &&
                                    event.target.querySelector(
                                        '[data-field-id="fld_children_a"]'
                                    )
                                )
                                    parentSubmits++;
                            },
                            true
                        );
                        window.linkedChildParentSubmits = () => parentSubmits;
                    });
                await context.route('**/*', async (route) => {
                    const request = route.request();
                    const url = new URL(request.url());
                    if (url.origin === origin) return route.continue();
                    const headers = {
                        'access-control-allow-origin': origin,
                        'access-control-allow-headers': '*',
                        'access-control-allow-methods': 'GET, POST, OPTIONS',
                    };
                    if (url.origin === 'https://synthetic-sdk.invalid') {
                        if (request.method() === 'OPTIONS')
                            return route.fulfill({ status: 204, headers });
                        const operation = url.searchParams.get('route');
                        if (operation === 'fetchExtensionForEndUser') {
                            const input = request.postDataJSON();
                            const loaded =
                                'childExtensionInfo' in input
                                    ? multiPage
                                        ? fixtures.pagedChildForm()
                                        : fixtures.childForm('edit')
                                    : structuredClone(parent);
                            if ('childExtensionInfo' in input) {
                                calls.childLoads++;
                                if (editDialog)
                                    calls.childRecords.push(
                                        input.childExtensionInfo.accessType
                                            .childExtensionRecordId
                                    );
                                loaded.payload.publicFields.state.promptUserBeforeSubmission = true;
                                if (close)
                                    loaded.payload.formFieldIdsWithUnsavedChanges =
                                        [];
                                if (mouseBlur)
                                    loaded.payload.fieldIdsToSchemas.fld_title.miniExtConfig.required = true;
                                if (mode === 'edit')
                                    loaded.payload.formRecord = {
                                        ...loaded.payload.formRecord,
                                        type: 'edit',
                                        tableId: 'tbl_child',
                                        recordId:
                                            input.childExtensionInfo.accessType
                                                .childExtensionRecordId,
                                    };
                            }
                            return route.fulfill({ json: loaded, headers });
                        }
                        if (
                            url.pathname ===
                            '/api/trpc/publicExtensions.fetchInitialTableIdsToLinkedTableStates'
                        ) {
                            calls.reads++;
                            return route.fulfill({
                                headers,
                                json: {
                                    result: {
                                        data: {
                                            tbl_child: {
                                                airtableFields:
                                                    selectedTableFields,
                                                recordIdsToAirtableRecords:
                                                    Object.fromEntries(
                                                        [
                                                            'rec_existing',
                                                            'rec_sibling',
                                                        ].map((id) => [
                                                            id,
                                                            {
                                                                id,
                                                                fields: {
                                                                    fld_title:
                                                                        id,
                                                                },
                                                            },
                                                        ])
                                                    ),
                                            },
                                        },
                                    },
                                },
                            });
                        }
                        if (operation === 'saveForm') {
                            const input = request.postDataJSON();
                            calls.saves.push(input);
                            const saved = fixtures.childSaved('edit');
                            saved.record.fields = structuredClone(
                                input.formRecord.data
                            );
                            if (input.formRecord.type === 'edit')
                                saved.record.id = input.formRecord.recordId;
                            saved.context.newTableIdsToLinkedTableStates.tbl_child.recordIdsToAirtableRecords =
                                {
                                    [saved.record.id]: structuredClone(
                                        saved.record
                                    ),
                                };
                            return route.fulfill({ json: saved, headers });
                        }
                    }
                    unexpectedRequests.push(
                        'Unexpected synthetic proof request'
                    );
                    return route.abort();
                });
                await page.goto(origin);
                if (reactVersion != null)
                    assert.equal(
                        await page
                            .locator('[data-sdk-react-host]')
                            .getAttribute('data-sdk-react-host'),
                        reactVersion
                    );
                await page
                    .locator('#api-origin')
                    .fill('https://synthetic-sdk.invalid');
                await page.locator('#share-id').fill('share_synthetic_parent');
                await page.locator('#record-id').fill('rec_parent');
                await page
                    .locator('#connection-form button[type=submit]')
                    .click();
                const idle = () =>
                    page.waitForFunction(
                        () =>
                            document
                                .querySelector('#screen')
                                ?.getAttribute('aria-busy') === 'false'
                    );
                await idle();
                const parentTitle = page
                    .locator('#screen [data-field-id="fld_title"]')
                    .first();
                if (editDialog || mouseBlur)
                    assert(
                        await parentTitle.evaluate((node) =>
                            Boolean(
                                node.form?.querySelector(
                                    '[data-field-id="fld_children_a"]'
                                )
                            )
                        ),
                        'The parent form submit observer must match the loaded Form'
                    );
                await parentTitle.fill('Parent draft retained');
                // Native change on blur refreshes the action controls. Commit
                // the edit before Playwright resolves the next action button.
                await parentTitle.press('Tab');
                const parentLinks = page
                    .locator('#screen [data-field-id="fld_children_a"]')
                    .first();
                const expected = {
                    childTitle: '<strong>Child draft retained</strong>',
                    parentTitle: 'Parent draft retained',
                    parentLinks: JSON.parse(await parentLinks.inputValue()),
                    reads: 0,
                };
                let editOpener;
                if (mode === 'edit') {
                    await page
                        .getByRole('button', {
                            name: 'Load selected records',
                            exact: true,
                        })
                        .click();
                    if (editDialog) await idle();
                    const edit = page.getByRole('button', {
                        name: 'Edit linked record rec_existing',
                        exact: true,
                    });
                    if (editDialog) {
                        editOpener = await edit.elementHandle();
                        assert(editOpener);
                        await editOpener.focus();
                        await page.keyboard.press('Enter');
                    } else await edit.click();
                } else
                    await page
                        .getByRole('button', {
                            name: 'Create linked record',
                            exact: true,
                        })
                        .click();
                await idle();
                const childTitle = page.locator(
                    '[data-linked-child-pane] [data-field-id="fld_title"]'
                );
                const editor = page.getByRole('dialog', {
                    name: 'Edit linked record',
                    exact: true,
                });
                const capture = () => [
                    calls.reads,
                    calls.childLoads,
                    calls.saves.length,
                ];
                const assertEditorFocus = async () => {
                    assert(
                        await editor.evaluate((dialog) =>
                            dialog.contains(document.activeElement)
                        ),
                        'Focus left the selected Edit dialog'
                    );
                };
                expected.reads = calls.reads;
                if (editDialog) {
                    await childTitle.waitFor();
                    assert.deepEqual(capture(), [1, 1, 0]);
                    assert.deepEqual(calls.childRecords, ['rec_existing']);
                    assert.equal(
                        await editor.count(),
                        1,
                        'Keyboard Edit loaded the selected child with one read, one load and zero Saves, but did not open a named dialog'
                    );
                    assert(
                        await editor.evaluate((node) => node.matches(':modal'))
                    );
                    await assertEditorFocus();
                    await page.keyboard.press('Tab');
                    await assertEditorFocus();
                    await page.keyboard.press('Shift+Tab');
                    await assertEditorFocus();
                    await parentTitle.evaluate((node) => node.focus());
                    await assertEditorFocus();
                }
                await childTitle.fill(expected.childTitle);
                if (close) {
                    const closeButton = page.getByRole('button', {
                        name: 'Close child',
                        exact: true,
                    });
                    const dialog = page.getByRole('alertdialog', {
                        name: 'Close linked record?',
                    });
                    const focus = (locator) =>
                        locator.evaluate(
                            (node) => document.activeElement === node
                        );
                    await closeButton.click();
                    await dialog.waitFor();
                    const keep = dialog.getByRole('button', {
                        name: 'Keep editing',
                    });
                    assert.equal(await focus(keep), true);
                    await keep.click();
                    await dialog.waitFor({ state: 'detached' });
                    assert.equal(await focus(closeButton), true);
                    assert.equal(
                        await childTitle.inputValue(),
                        expected.childTitle
                    );
                    const kept = capture();
                    assert.deepEqual(kept, [1, 1, 0]);

                    await closeButton.press('Enter');
                    await dialog
                        .getByRole('button', { name: 'Confirm close' })
                        .click();
                    await childTitle.waitFor({ state: 'detached' });
                    if (editDialog) await editor.waitFor({ state: 'hidden' });
                    const reopen = page.getByRole('button', {
                        name: 'Edit linked record rec_existing',
                        exact: true,
                    });
                    assert.equal(await focus(reopen), true);
                    if (editDialog)
                        assert(
                            await focus(editOpener),
                            'Confirmed Close must restore the original Edit opener'
                        );
                    const confirmed = capture();
                    assert.deepEqual(confirmed, [1, 1, 0]);
                    if (editDialog) await page.keyboard.press('Enter');
                    else await reopen.press('Enter');
                    await idle();
                    assert.equal(
                        await childTitle.inputValue(),
                        expected.childTitle
                    );
                    const resumed = capture();
                    assert.deepEqual(resumed, [1, 1, 0]);

                    if (editDialog) {
                        await editor.waitFor();
                        await assertEditorFocus();
                        await editor
                            .getByRole('button', {
                                name: 'Review child',
                                exact: true,
                            })
                            .press('Enter');
                        const review = page.getByRole('dialog', {
                            name: 'Review child answers',
                            exact: true,
                        });
                        await review.waitFor();
                        assert.deepEqual(capture(), [1, 1, 0]);
                        const [response] = await Promise.all([
                            page.waitForResponse((response) => {
                                const url = new URL(response.url());
                                return (
                                    url.origin ===
                                        'https://synthetic-sdk.invalid' &&
                                    url.searchParams.get('route') ===
                                        'saveForm' &&
                                    response.request().method() === 'POST'
                                );
                            }),
                            review
                                .getByRole('button', {
                                    name: 'Confirm',
                                    exact: true,
                                })
                                .press('Enter'),
                        ]);
                        assert(response.ok());
                        await idle();
                        await editor.waitFor({ state: 'hidden' });
                        assert(
                            await focus(editOpener),
                            'Confirmed Save must restore the original Edit opener'
                        );
                        assert.deepEqual(capture(), [1, 1, 1]);
                        assertChildSaveRouting(calls.saves[0], 'edit');
                        assert.equal(
                            calls.saves[0].formRecord.data.fld_title,
                            expected.childTitle
                        );
                        assert.equal(
                            await parentTitle.inputValue(),
                            expected.parentTitle
                        );
                        assert.deepEqual(
                            JSON.parse(await parentLinks.inputValue()),
                            expected.parentLinks
                        );
                        const parentSubmits = await page.evaluate(() =>
                            window.linkedChildParentSubmits()
                        );
                        assert.equal(parentSubmits, 0);
                        assert.deepEqual(errors, []);
                        assert.deepEqual(unexpectedRequests, []);
                        report.cases.push({
                            mode,
                            scenario: 'selected-edit-dialog',
                            kept,
                            confirmed,
                            resumed,
                            saved: capture(),
                            parentSubmits,
                        });
                        continue;
                    }

                    await closeButton.click();
                    await dialog
                        .getByRole('button', { name: 'Confirm close' })
                        .click();
                    const sibling = page.getByRole('button', {
                        name: 'Edit linked record rec_sibling',
                        exact: true,
                    });
                    await sibling.click();
                    await idle();
                    await childTitle.waitFor();
                    await closeButton.press('Enter');
                    await childTitle.waitFor({ state: 'detached' });
                    assert.equal(await dialog.count(), 0);
                    assert.equal(await focus(sibling), true);
                    const clean = capture();
                    assert.deepEqual(clean, [1, 2, 0]);
                    assert.equal(
                        await parentTitle.inputValue(),
                        expected.parentTitle
                    );
                    assert.deepEqual(
                        JSON.parse(await parentLinks.inputValue()),
                        expected.parentLinks
                    );
                    assert.deepEqual(errors, []);
                    assert.deepEqual(unexpectedRequests, []);
                    report.cases.push({
                        mode,
                        close,
                        kept,
                        confirmed,
                        resumed,
                        clean,
                    });
                    continue;
                }
                const review = () =>
                    page.getByRole('button', {
                        name: 'Review child',
                        exact: true,
                    });
                let mouseCommitted;
                if (mouseBlur) {
                    await review().scrollIntoViewIfNeeded();
                    const focusedBefore = await childTitle.evaluate((node) => {
                        window.childMouseChanges = 0;
                        node.addEventListener(
                            'change',
                            () => window.childMouseChanges++
                        );
                        return document.activeElement === node;
                    });
                    assert.equal(await review().isEnabled(), true);
                    const target = await review().boundingBox();
                    assert(target, 'Review is visible before the first click');
                    const point = {
                        x: target.x + target.width / 2,
                        y: target.y + target.height / 2,
                    };
                    assert(
                        await review().evaluate(
                            (node, { x, y }) =>
                                node.contains(document.elementFromPoint(x, y)),
                            point
                        ),
                        'The first physical click hits Review'
                    );
                    await page.mouse.click(point.x, point.y);
                    mouseCommitted = {
                        focusedBefore,
                        focusedAfter: await childTitle.evaluate(
                            (node) => document.activeElement === node
                        ),
                        changes: await page.evaluate(
                            () => window.childMouseChanges
                        ),
                        childTitle: await childTitle.inputValue(),
                        saves: calls.saves.length,
                        reads: calls.reads,
                    };
                    assertMouseBlurCommit(mouseCommitted, expected);
                    const firstReview = page.getByRole('dialog', {
                        name: 'Review child answers',
                    });
                    await firstReview.waitFor({
                        state: 'visible',
                        timeout: 2000,
                    });
                    mouseCommitted.dialogs = await page
                        .locator('dialog[data-form-review]')
                        .count();
                    mouseCommitted.reviewedTitle = await firstReview
                        .getByText(expected.childTitle, { exact: true })
                        .textContent();
                    mouseCommitted.childLoads = calls.childLoads;
                    mouseCommitted.parentSubmits = await page.evaluate(() =>
                        window.linkedChildParentSubmits()
                    );
                    assert.equal(mouseCommitted.dialogs, 1);
                    assert.equal(
                        mouseCommitted.reviewedTitle,
                        expected.childTitle
                    );
                    assert.equal(mouseCommitted.childLoads, 1);
                    assert.equal(mouseCommitted.parentSubmits, 0);
                    await firstReview
                        .getByRole('button', { name: 'Edit', exact: true })
                        .click();
                    await firstReview.waitFor({ state: 'detached' });
                    assert.equal(
                        await childTitle.inputValue(),
                        expected.childTitle
                    );
                    await childTitle.press('Tab');
                } else await childTitle.press('Tab');
                let failed;
                let edited;
                const answers = { fld_title: expected.childTitle };
                if (multiPage) {
                    const reviewEnabled = [];
                    const checkPage = async (available) => {
                        const enabled = await review().isEnabled();
                        reviewEnabled.push(enabled);
                        assert.equal(enabled, available);
                        assert.equal(
                            await page
                                .locator('dialog[data-form-review]')
                                .count(),
                            0
                        );
                        assert.equal(calls.saves.length, 0);
                    };
                    await checkPage(false);
                    for (const [fieldId, answer, final] of [
                        ['fld_note', 'Second page answer retained', false],
                        ['fld_last', 'Final page answer retained', true],
                    ]) {
                        await page
                            .getByRole('button', {
                                name: 'Child Next',
                                exact: true,
                            })
                            .click();
                        const field = page.locator(
                            `[data-linked-child-pane] [data-field-id="${fieldId}"]`
                        );
                        await field.waitFor({ state: 'visible' });
                        await field.fill(answer);
                        await field.press('Tab');
                        answers[fieldId] = answer;
                        await checkPage(final);
                    }
                    await review().click();
                    const dialog = page.getByRole('dialog', {
                        name: 'Review child answers',
                    });
                    await dialog.waitFor();
                    assert.equal(calls.saves.length, 0);
                    assert.equal(await dialog.locator('strong').count(), 0);
                    for (const answer of Object.values(answers))
                        assert((await dialog.innerText()).includes(answer));
                    await dialog
                        .getByRole('button', { name: 'Edit', exact: true })
                        .click();
                    await idle();
                    edited = {
                        reviewEnabled,
                        saves: calls.saves.length,
                        reads: calls.reads,
                        dialogs: await page
                            .locator('dialog[data-form-review]')
                            .count(),
                        banner: await page
                            .locator('#status')
                            .evaluate((node) => ({
                                text: node.textContent,
                                error: node.classList.contains('error'),
                            })),
                        answers: Object.fromEntries(
                            await Promise.all(
                                Object.keys(answers).map(async (fieldId) => [
                                    fieldId,
                                    await page
                                        .locator(
                                            `[data-linked-child-pane] [data-field-id="${fieldId}"]`
                                        )
                                        .inputValue(),
                                ])
                            )
                        ),
                        parentTitle: await parentTitle.inputValue(),
                        parentLinks: JSON.parse(await parentLinks.inputValue()),
                    };
                    assertEditedMultiPageReview(edited, {
                        ...expected,
                        answers,
                    });
                } else {
                    await page.evaluate((message) => {
                        const prototype = HTMLDialogElement.prototype;
                        const descriptor = Object.getOwnPropertyDescriptor(
                            prototype,
                            'showModal'
                        );
                        window.confirmationFailureProbe = {
                            attempts: 0,
                            restore: () =>
                                Object.defineProperty(
                                    prototype,
                                    'showModal',
                                    descriptor
                                ),
                        };
                        Object.defineProperty(prototype, 'showModal', {
                            ...descriptor,
                            value() {
                                window.confirmationFailureProbe.attempts++;
                                throw new Error(message);
                            },
                        });
                    }, privateFailure);
                    await review().click();
                    await idle();
                    failed = {
                        ...(await page.evaluate(
                            (message) => ({
                                attempts:
                                    window.confirmationFailureProbe.attempts,
                                dialogs: document.querySelectorAll(
                                    'dialog[data-form-review]'
                                ).length,
                                banner: {
                                    text: document.querySelector('#status')
                                        .textContent,
                                    error: document
                                        .querySelector('#status')
                                        .classList.contains('error'),
                                },
                                privateDetailVisible:
                                    document.body.textContent.includes(message),
                            }),
                            privateFailure
                        )),
                        saves: calls.saves.length,
                        reads: calls.reads,
                        childTitle: await childTitle.inputValue(),
                        parentTitle: await parentTitle.inputValue(),
                        parentLinks: JSON.parse(await parentLinks.inputValue()),
                    };
                    assertFailedConfirmation(failed, expected);
                    await page.evaluate(() =>
                        window.confirmationFailureProbe.restore()
                    );
                }
                // Only a new deliberate Review and Confirm may allocate Save.
                await review().click();
                const dialog = page.getByRole('dialog', {
                    name: 'Review child answers',
                });
                await dialog.waitFor();
                assert.equal(calls.saves.length, 0);
                assert.equal(await dialog.locator('strong').count(), 0);
                assert(
                    (await dialog.innerText()).includes(expected.childTitle)
                );
                if (multiPage)
                    for (const answer of Object.values(answers))
                        assert((await dialog.innerText()).includes(answer));
                await dialog
                    .getByRole('button', { name: 'Confirm', exact: true })
                    .click();
                await idle();
                assert.equal(calls.saves.length, 1);
                assertChildSaveRouting(calls.saves[0], mode);
                assert.equal(
                    calls.saves[0].formRecord.data.fld_title,
                    expected.childTitle
                );
                if (multiPage)
                    for (const [fieldId, answer] of Object.entries(answers))
                        assert.equal(
                            calls.saves[0].formRecord.data[fieldId],
                            answer
                        );
                assert.equal(
                    await parentTitle.inputValue(),
                    expected.parentTitle
                );
                assert.deepEqual(
                    JSON.parse(await parentLinks.inputValue()),
                    mode === 'edit'
                        ? expected.parentLinks
                        : [...expected.parentLinks, 'rec_created']
                );
                assert.equal(calls.reads, expected.reads);
                if (mouseBlur) {
                    assert.equal(calls.childLoads, 1);
                    assert.equal(
                        await page.evaluate(() =>
                            window.linkedChildParentSubmits()
                        ),
                        0
                    );
                }
                assert.deepEqual(errors, []);
                assert.deepEqual(unexpectedRequests, []);
                report.cases.push({
                    mode,
                    scenario: mouseBlur
                        ? 'first-click-mouse-blur-edit-and-explicit-confirm'
                        : multiPage
                          ? 'multi-page-edit-then-explicit-confirm'
                          : 'show-modal-failure-then-explicit-confirm',
                    ...(multiPage ? { edited } : { failed }),
                    ...(mouseBlur ? { mouseCommitted } : {}),
                    recoveredSaves: calls.saves.length,
                    parentRetained: true,
                });
                console.log(`Installed starter ${mode} ${label}: passed`);
            } finally {
                await context.close();
            }
        }
        if (!onlyClose && !onlySelectedEditDialog) {
            console.log(
                'Installed starter Portal Project Related Edit: starting'
            );
            report.cases.push(
                await checkPortalRelatedEdit({ browser, fixtures, origin })
            );
            console.log(
                'Installed starter Portal Project Related Edit: passed'
            );
            if (reactVersion == null) {
                report.cases.push(
                    await checkRootReadonlyText({ browser, fixtures, origin })
                );
                console.log(
                    'Installed starter root read-only text accessibility: passed'
                );
            }
        }
        return report;
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}
