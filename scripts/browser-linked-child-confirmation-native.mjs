import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
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
}) {
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    const app = join(consumer, 'confirmation-starter');
    cpSync(join(installed, 'examples/browser'), app, { recursive: true });
    const sourceHashes = {};
    for (const name of ['main.ts', 'linkedChildPanel.ts', 'confirmation.ts']) {
        const bytes = readFileSync(join(app, 'src', name));
        assert.deepEqual(
            bytes,
            readFileSync(join(root, 'examples/browser/src', name))
        );
        sourceHashes[name] = hash(bytes);
    }
    const bundled = await build({
        absWorkingDir: app,
        entryPoints: ['src/main.ts'],
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
        assert(realpathSync(resolve(app, input)).startsWith(installed + '/'));
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

/** Bounded Review paths in the copied installed app, with synthetic responses. */
export async function checkStarterConfirmationRecovery({
    browser,
    consumer,
    output,
    fixtures,
    root,
}) {
    const prepared = await prepareStarterConfirmationProof({
        consumer,
        output,
        root,
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
        for (const { mode, multiPage } of [
            { mode: 'create', multiPage: false },
            { mode: 'edit', multiPage: false },
            { mode: 'create', multiPage: true },
        ]) {
            const label = multiPage
                ? 'multi-page Review'
                : 'confirmation recovery';
            console.log(`Installed starter ${mode} ${label}: starting`);
            const calls = { reads: 0, saves: [] };
            const parent = fixtures.parentForm('edit');
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
                                loaded.payload.publicFields.state.promptUserBeforeSubmission = true;
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
                                                airtableFields: [
                                                    parent.payload
                                                        .fieldIdsToSchemas
                                                        .fld_title
                                                        .airtableField,
                                                ],
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
                if (mode === 'edit') {
                    await page
                        .getByRole('button', {
                            name: 'Load selected records',
                            exact: true,
                        })
                        .click();
                    await page
                        .getByRole('button', {
                            name: 'Edit linked record rec_existing',
                            exact: true,
                        })
                        .click();
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
                await childTitle.fill(expected.childTitle);
                await childTitle.press('Tab');
                expected.reads = calls.reads;
                const review = () =>
                    page.getByRole('button', {
                        name: 'Review child',
                        exact: true,
                    });
                let failed;
                let edited;
                const answers = { fld_title: expected.childTitle };
                if (multiPage) {
                    const reviewEnabled = [];
                    const checkPage = async (available) => {
                        const enabled = await review().isEnabled();
                        reviewEnabled.push(enabled);
                        assert.equal(enabled, available);
                        assert.equal(await page.locator('dialog').count(), 0);
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
                        dialogs: await page.locator('dialog').count(),
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
                                dialogs:
                                    document.querySelectorAll('dialog').length,
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
                assert.deepEqual(errors, []);
                assert.deepEqual(unexpectedRequests, []);
                report.cases.push({
                    mode,
                    scenario: multiPage
                        ? 'multi-page-edit-then-explicit-confirm'
                        : 'show-modal-failure-then-explicit-confirm',
                    ...(multiPage ? { edited } : { failed }),
                    recoveredSaves: calls.saves.length,
                    parentRetained: true,
                });
                console.log(`Installed starter ${mode} ${label}: passed`);
            } finally {
                await context.close();
            }
        }
        return report;
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}
