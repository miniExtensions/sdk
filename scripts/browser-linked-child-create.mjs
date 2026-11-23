import assert from 'node:assert/strict';
import {
    cpSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { build } from 'esbuild';

// Match the recognized native Form message, including its formatted wrapper.
const permissionError =
    'Could not complete the operation. Please verify that the correct permission levels are set in Airtable.';

async function checkBorrowedErrorHelp(page, origin, output, react) {
    const initialViewport = page.viewportSize();
    const cases = [
        { name: 'permission', error: permissionError, hasHelp: true },
        {
            name: 'wrapped-permission',
            error: 'Airtable API Error: ' + permissionError,
            hasHelp: true,
        },
        { name: 'provider', error: 'Synthetic provider unavailable' },
        { name: 'invalid-json', error: 'Response is not valid JSON' },
        { name: 'child-limit', error: 'Connected child Form limit reached' },
    ];
    const results = [];
    for (const viewport of [
        { width: 375, height: 780 },
        { width: 1280, height: 720 },
    ]) {
        await page.setViewportSize(viewport);
        for (const { name, error, hasHelp } of cases) {
            await page.goto(origin + '/?borrowed');
            await page
                .getByRole('button', { name: 'Open native child' })
                .press('Enter');
            const dialog = page.getByRole('dialog', {
                name: 'Create linked record',
            });
            const input = dialog.getByRole('textbox', {
                name: 'Native child title',
            });
            const save = dialog.getByRole('button', {
                name: 'Save',
                exact: true,
            });
            const help = dialog.getByRole('button', {
                name: 'How can I fix permissions-related issues?',
                exact: true,
            });
            const read = () => page.evaluate(() => window.readBorrowedCreate());
            const draft = 'Keep child draft after opening Help';
            await input.fill(draft);
            await page.evaluate((message) => {
                window.nextBorrowedSaveError = message;
            }, error);
            await save.press('Enter');
            const alert = dialog.getByRole('alert');
            await alert.waitFor();
            assert.equal(await alert.textContent(), error);
            const rejected = await read();
            assert.deepEqual(rejected.saves, [draft]);
            assert.deepEqual(rejected.links, ['rec_initial']);
            assert.deepEqual(rejected.outcome, { type: 'rejected' });
            await input.focus();
            await page.keyboard.press('Tab');
            const focus = (locator) =>
                locator.evaluate((node) => node === document.activeElement);
            if (hasHelp) {
                await page.screenshot({
                    path: join(
                        output,
                        `child-help-${react}-${viewport.width}-${name}.png`
                    ),
                });
                assert.equal(
                    await help.count(),
                    1,
                    `Missing Help for ${name} at ${viewport.width}px`
                );
                assert(await focus(help));
                assert.equal(await help.getAttribute('type'), 'button');
                await page.keyboard.press('Enter');
                assert(await focus(help));
            } else {
                assert.equal(await help.count(), 0);
                assert(await focus(save));
            }
            assert.equal(await input.inputValue(), draft);
            assert.deepEqual(await read(), {
                ...rejected,
                permissionHelpOpens: hasHelp ? 1 : 0,
            });
            const checkRetainedError =
                name === 'permission' && viewport.width === 375;
            if (checkRetainedError) {
                const helpInDom = dialog.locator('button').filter({
                    hasText: 'How can I fix permissions-related issues?',
                });
                await dialog
                    .getByRole('button', { name: 'Close', exact: true })
                    .press('Enter');
                const keep = dialog.getByRole('button', {
                    name: 'Keep editing',
                });
                await keep.waitFor();
                assert.equal(await helpInDom.count(), 0);
                await keep.press('Enter');
                await help.waitFor();
                assert.equal(await input.inputValue(), draft);

                await page.evaluate(() => {
                    window.holdBorrowedSave = true;
                    window.nextBorrowedSaveUnknown = true;
                });
                await save.press('Enter');
                await page.waitForFunction(() => window.releaseBorrowedSave);
                assert.equal(await helpInDom.count(), 0);
                await page.evaluate(() => window.releaseBorrowedSave());
                await page.waitForFunction(
                    () => window.readBorrowedCreate().phase === 'unknown'
                );
                assert.equal(await helpInDom.count(), 0);
                assert.equal(await input.inputValue(), draft);
                const unresolved = await read();
                assert.equal(unresolved.permissionHelpOpens, 1);
                assert.deepEqual(unresolved.saves, [draft, draft]);
                assert.deepEqual(unresolved.links, rejected.links);
                assert.equal(unresolved.parentSubmits, 0);
            }
            results.push({
                width: viewport.width,
                name,
                helpOpens: hasHelp ? 1 : 0,
                ...(checkRetainedError && { retainedErrorLifecycle: true }),
            });
        }
    }
    if (initialViewport) await page.setViewportSize(initialViewport);
    return results;
}

async function checkBorrowedCreate(page, origin) {
    await page.goto(origin + '/?borrowed');
    const opener = page.getByRole('button', { name: 'Open native child' });
    const dialog = page.getByRole('dialog', { name: 'Create linked record' });
    const input = dialog.getByRole('textbox', { name: 'Native child title' });
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    const discard = dialog.getByRole('button', {
        name: 'Close without saving',
    });
    const keep = dialog.getByRole('button', { name: 'Keep editing' });
    const read = () => page.evaluate(() => window.readBorrowedCreate());
    const focus = (locator) =>
        locator.evaluate((node) => node === document.activeElement);

    await opener.press('Enter');
    await input.fill('Dirty native draft');
    await page.keyboard.press('Escape');
    await keep.waitFor();
    assert.equal(await dialog.getByRole('alert').count(), 1);
    assert(await focus(keep));
    await keep.press('Enter');
    assert.equal(await input.inputValue(), 'Dirty native draft');
    assert.deepEqual((await read()).saves, []);
    assert.equal((await read()).dismisses, 0);
    await page.keyboard.press('Escape');
    await discard.waitFor();
    assert.equal(await dialog.getByRole('alert').count(), 1);
    await discard.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    assert(await focus(opener));
    assert.equal((await read()).dismisses, 1);
    assert.deepEqual((await read()).saves, []);

    await opener.press('Enter');
    await input.fill('Retired confirmation');
    await page.keyboard.press('Escape');
    await discard.waitFor();
    const focusBeforeReplacement = (await read()).openerFocuses;
    await discard.evaluate((button) => window.replaceBorrowedParent(button));
    await input.waitFor();
    assert.equal(await input.inputValue(), '');
    assert.equal((await read()).dismisses, 1);
    assert.equal(await discard.count(), 0);
    assert.equal((await read()).openerFocuses, focusBeforeReplacement);

    await input.fill('Held original child');
    await page.evaluate(() => {
        window.holdBorrowedSave = true;
    });
    await save.evaluate((button) => {
        button.click();
        button.click();
    });
    await page.waitForFunction(() => window.releaseBorrowedSave);
    assert(await save.isDisabled());
    assert.deepEqual((await read()).saves, ['Held original child']);
    await page.evaluate(() => window.replaceBorrowedParent());
    await input.fill('Fresh successor child');
    await page.evaluate(() => window.releaseBorrowedSave());
    await page.waitForFunction(
        () => window.borrowedSaveOutcome?.link === 'superseded'
    );
    assert.equal(await input.inputValue(), 'Fresh successor child');
    assert(await focus(input));
    assert.deepEqual((await read()).links, ['rec_successor']);
    await save.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    assert(await focus(opener));
    const result = await read();
    assert.deepEqual(result.saves, [
        'Held original child',
        'Fresh successor child',
    ]);
    assert.deepEqual(result.links, ['rec_successor', 'rec_created_2']);
    assert.equal(result.parentSubmits, 0);

    await opener.press('Enter');
    await input.fill('Unresolved native child');
    await page.evaluate(() => {
        window.nextBorrowedSaveUnknown = true;
    });
    await save.press('Enter');
    await page.waitForFunction(
        () => window.readBorrowedCreate().phase === 'unknown'
    );
    assert(await save.isDisabled());
    const unresolved = (await read()).outcome;
    assert.equal(unresolved.type, 'unknown');
    assert.equal(typeof unresolved.attemptId, 'string');
    await page.keyboard.press('Escape');
    await discard.press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    assert(await focus(opener));
    assert.equal((await read()).saves.length, 3);
    assert.deepEqual((await read()).links, result.links);
    assert.equal((await read()).dismisses, 2);
    assert.deepEqual((await read()).outcome, unresolved);
    assert.equal((await read()).parentSubmits, 0);

    await opener.press('Enter');
    await input.fill('Saved without the parent link');
    const beforeUnlinked = await read();
    await page.evaluate(() => {
        window.nextBorrowedSaveUnlinked = true;
    });
    await save.press('Enter');
    await dialog
        .getByRole('alert')
        .filter({
            hasText:
                'The record was saved but could not be linked to this Form.',
        })
        .waitFor();
    assert.equal(await input.count(), 0);
    assert(await save.isDisabled());
    await save.evaluate((button) => button.click());
    const unlinked = await read();
    assert.deepEqual(unlinked.outcome, {
        type: 'saved',
        recordId: 'rec_created_4',
        link: 'unlinked',
    });
    assert.equal(unlinked.saves.length, beforeUnlinked.saves.length + 1);
    assert.deepEqual(unlinked.links, beforeUnlinked.links);
    assert.equal(unlinked.dismisses, beforeUnlinked.dismisses);
    assert.equal(unlinked.openerFocuses, beforeUnlinked.openerFocuses);
    assert.equal(await discard.count(), 0);
    await dialog
        .getByRole('button', { name: 'Close', exact: true })
        .press('Enter');
    await dialog.waitFor({ state: 'hidden' });
    assert(await focus(opener));
    assert.deepEqual((await read()).outcome, unlinked.outcome);
    assert.deepEqual((await read()).saves, unlinked.saves);
    assert.equal((await read()).dismisses, beforeUnlinked.dismisses + 1);
    assert.equal((await read()).parentSubmits, 0);
    return {
        savedUnlinkedExitsOnlyOnExplicitClose: true,
        unresolvedSaveRetainedOnDismiss: true,
        keyboardOpen: true,
        keepAndDiscard: true,
        staleDismissalRefused: true,
        duplicateSaveRefused: true,
        supersededSaveUnlinked: true,
        freshSaveLinkedOnce: true,
        parentSubmits: 0,
    };
}

async function checkBorrowedActivationAcrossOpening(page, origin, activation) {
    await page.goto(origin + '/?borrowed');
    const opener = page.getByRole('button', { name: 'Open native child' });
    const dialog = page.getByRole('dialog', { name: 'Create linked record' });
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    const read = () => page.evaluate(() => window.readBorrowedCreate());
    const moveToSave = async () => {
        const box = await save.boundingBox();
        assert(box, 'Save must have a reachable pointer target');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    };

    await opener.press('Enter');
    await save.waitFor();
    const first = await read();
    if (activation === 'pointer') {
        await moveToSave();
        await page.mouse.down();
    } else {
        await save.focus();
        await page.keyboard.down('Space');
    }

    await page.evaluate(() => window.replaceBorrowedParent());
    await page
        .locator(`form[data-native-opening="${first.opening + 1}"]`)
        .waitFor({ state: 'attached' });
    const successor = await read();
    assert.notEqual(successor.opening, first.opening);
    assert.equal(successor.phase, 'ready');
    if (activation === 'pointer') {
        await moveToSave();
        await page.mouse.up();
    } else {
        await save.focus();
        await page.keyboard.up('Space');
    }
    assert.deepEqual(
        (await read()).saveRefs,
        [],
        `Releasing A's held ${activation} must not Save B`
    );
    assert.deepEqual((await read()).links, ['rec_successor']);
    await save.waitFor();

    await dialog
        .getByRole('textbox', { name: 'Native child title' })
        .fill('Fresh successor activation');
    const expected = await read();
    if (activation === 'pointer') await save.click();
    else await save.press('Space');
    await dialog.waitFor({ state: 'hidden' });
    const result = await read();
    assert.deepEqual(result.saveRefs, [
        { opening: expected.opening, revision: expected.revision },
    ]);
    assert.deepEqual(result.saves, ['Fresh successor activation']);
    assert.deepEqual(result.links, ['rec_successor', 'rec_created_1']);
    assert.equal(result.parentSubmits, 0);
}

export async function checkLinkedChildCreateBrowser({
    archive,
    browser,
    fixtures,
    install,
    output,
    root,
    checkInstalledEdit,
}) {
    const results = [];
    const child = fixtures.childForm('edit');
    child.payload.formRecord.data.fld_title = '';
    child.payload.formFieldIdsWithUnsavedChanges = [];
    child.payload.fieldIdsToSchemas.fld_title.miniExtConfig.required = true;
    child.payload.fieldNamesToSchemas.Title.miniExtConfig.required = true;
    const parent = fixtures.parentForm('edit');
    const initialLinks = parent.payload.formRecord.data.fld_children_a;
    const html =
        '<!doctype html><title>Installed linked record Create</title><main id="app"></main><script type="module" src="/proof.js"></script>';
    for (const react of ['18.3.1', '19.2.0']) {
        const lane = mkdtempSync(join(output, `create-react-${react}-`));
        try {
            writeFileSync(
                join(lane, 'package.json'),
                JSON.stringify({
                    private: true,
                    dependencies: {
                        '@miniextensions/sdk':
                            'file:' + archive.replaceAll('\\', '/'),
                        react,
                        'react-dom': react,
                    },
                })
            );
            install(lane);
            const installed = realpathSync(
                join(lane, 'node_modules/@miniextensions/sdk')
            );
            const resolved = JSON.parse(
                readFileSync(join(lane, 'package-lock.json'))
            ).packages;
            assert.equal(resolved['node_modules/react'].version, react);
            assert.equal(resolved['node_modules/react-dom'].version, react);
            const shippedExample = join(
                installed,
                'examples/react-linked-child-create/main.ts'
            );
            assert.deepEqual(
                readFileSync(shippedExample),
                readFileSync(
                    join(root, 'examples/react-linked-child-create/main.ts')
                )
            );
            cpSync(shippedExample, join(lane, 'installed-create-example.ts'));
            cpSync(
                join(root, 'scripts/linked-child-create-browser-fixture.mjs'),
                join(lane, 'fixture.mjs')
            );
            const bundle = await build({
                absWorkingDir: lane,
                entryPoints: ['fixture.mjs'],
                bundle: true,
                format: 'esm',
                platform: 'browser',
                target: 'es2022',
                metafile: true,
                write: false,
                define: {
                    __LINKED_CHILD_CREATE_FIXTURES__: JSON.stringify({
                        parent,
                        child,
                        permissionError,
                        saved: fixtures.childSaved('edit'),
                    }),
                },
            });
            const component = Object.keys(bundle.metafile.inputs).find(
                (input) =>
                    input.endsWith(
                        '/dist/esm/react/FormLinkedChildCreateDialog.js'
                    )
            );
            assert(
                component,
                'Browser must bundle the actual installed React dialog'
            );
            const member = relative(
                installed,
                realpathSync(resolve(lane, component))
            );
            assert(
                member &&
                    !isAbsolute(member) &&
                    !member.startsWith(`..${sep}`) &&
                    member !== '..'
            );
            const server = createServer((request, response) => {
                if (request.url === '/proof.js') {
                    response.setHeader('Content-Type', 'text/javascript');
                    response.end(bundle.outputFiles[0].contents);
                } else if (
                    request.url === '/' ||
                    request.url === '/?borrowed'
                ) {
                    response.setHeader('Content-Type', 'text/html');
                    response.end(html);
                } else {
                    response.writeHead(204);
                    response.end();
                }
            });
            await new Promise((resolve) =>
                server.listen(0, '127.0.0.1', resolve)
            );
            let context;
            try {
                context = await browser.newContext({ serviceWorkers: 'block' });
                const origin = `http://127.0.0.1:${server.address().port}`;
                const errors = [];
                const external = [];
                await context.route('**/*', (route) => {
                    const url = new URL(route.request().url());
                    if (url.origin === origin) return route.continue();
                    external.push(url.origin);
                    return route.abort();
                });
                const page = await context.newPage();
                page.setDefaultTimeout(10000);
                page.on('pageerror', (error) => errors.push(String(error)));
                const permissionHelp = await checkBorrowedErrorHelp(
                    page,
                    origin,
                    output,
                    react
                );
                const read = () =>
                    page.evaluate(() => window.readCreateProof());
                const dialog = page.getByRole('dialog', {
                    name: 'Create linked record',
                    exact: true,
                });
                const create = page.getByRole('button', {
                    name: 'Create linked record',
                    exact: true,
                });
                const close = dialog.getByRole('button', {
                    name: 'Close',
                    exact: true,
                });
                const save = dialog.getByRole('button', {
                    name: 'Save',
                    exact: true,
                });
                const title = dialog.getByRole('textbox', {
                    name: 'Child title',
                    exact: true,
                });
                const focused = (locator) =>
                    locator.evaluate(
                        (node) => node.ownerDocument.activeElement === node
                    );
                const open = async () => {
                    await page.goto(origin);
                    await create.waitFor();
                    const opener = await create.elementHandle();
                    assert(opener);
                    await opener.press('Enter');
                    await dialog.waitFor();
                    assert.deepEqual((await read()).calls.loads, [
                        fixtures.childLoadInput('edit'),
                    ]);
                    return opener;
                };

                await page.goto(origin);
                await create.waitFor();
                const pendingOpener = await create.elementHandle();
                assert(pendingOpener);
                await page.evaluate(() => window.holdNextCreateLoad());
                await pendingOpener.press('Enter');
                await page.waitForFunction(() => window.releaseCreateLoad);
                assert(await create.isDisabled());
                await page.evaluate(() =>
                    window.setParentPresentationCurrent(false)
                );
                await page
                    .locator('form[data-parent-current="false"]')
                    .waitFor();
                await page.evaluate(() => window.releaseCreateLoad());
                await page.waitForFunction(() => {
                    const { canCreate, phase } = window.readCreateProof();
                    return canCreate || phase !== 'loading';
                });
                await page.evaluate(() =>
                    window.setParentPresentationCurrent(true)
                );
                try {
                    await page.waitForFunction(
                        (opener) => !opener.disabled,
                        pendingOpener,
                        { timeout: 3000 }
                    );
                } catch (error) {
                    if (error.name !== 'TimeoutError') throw error;
                    assert.fail(
                        `Retained Create opener stayed disabled after its stale load settled: ${JSON.stringify(
                            {
                                connected: await pendingOpener.evaluate(
                                    (node) => node.isConnected
                                ),
                                disabled: await pendingOpener.evaluate(
                                    (node) => node.disabled
                                ),
                                ...(await read()),
                            }
                        )}`
                    );
                }
                assert.equal(await dialog.count(), 0);
                const loadInput = fixtures.childLoadInput('edit');
                assert.deepEqual((await read()).calls, {
                    loads: [loadInput],
                    saves: [],
                    parentSubmits: 0,
                });
                await pendingOpener.press('Enter');
                try {
                    await dialog.waitFor();
                } catch (error) {
                    if (error.name !== 'TimeoutError') throw error;
                    assert.fail(
                        `Fresh Create did not open after stale settlement: ${JSON.stringify(await read())}`
                    );
                }
                await title.fill('Fresh Create after a retired load');
                await save.click();
                await dialog.waitFor({ state: 'hidden' });
                const afterFreshClick = await read();
                assert.equal(afterFreshClick.phase, 'saved');
                assert.deepEqual(afterFreshClick.calls.loads, [
                    loadInput,
                    loadInput,
                ]);
                assert.equal(afterFreshClick.calls.saves.length, 1);
                assert.equal(
                    afterFreshClick.calls.saves[0].extensionAccessToken,
                    'synthetic_child_token'
                );
                assert.equal(
                    afterFreshClick.calls.saves[0].formRecord.data.fld_title,
                    'Fresh Create after a retired load'
                );
                assert.equal(afterFreshClick.calls.parentSubmits, 0);
                assert.deepEqual(afterFreshClick.links, [
                    ...initialLinks,
                    'rec_created',
                ]);

                const exactOpener = await open();
                assert(await focused(close));
                await page.keyboard.press('Shift+Tab');
                assert(await focused(save));
                await page.keyboard.press('Tab');
                assert(await focused(close));
                await page
                    .locator('#parent-submit')
                    .evaluate((button) => button.focus());
                assert(await focused(close));
                await save.click();
                await dialog.getByRole('alert').waitFor();
                assert.deepEqual((await read()).calls.saves, []);
                assert.equal((await read()).calls.parentSubmits, 0);
                await title.fill('A synthetic child');
                await page.keyboard.press('Escape');
                const keep = dialog.getByRole('button', {
                    name: 'Keep editing',
                    exact: true,
                });
                await keep.waitFor();
                assert(await focused(keep));
                await keep.press('Enter');
                assert.equal(await title.inputValue(), 'A synthetic child');
                assert.deepEqual((await read()).calls.saves, []);
                await save.click();
                await dialog.waitFor({ state: 'hidden' });
                await page.waitForFunction(
                    (opener) => opener === document.activeElement,
                    exactOpener
                );
                const saved = await read();
                assert.equal(saved.phase, 'saved');
                assert.deepEqual(saved.calls.loads, [
                    fixtures.childLoadInput('edit'),
                ]);
                assert.deepEqual(saved.links, [...initialLinks, 'rec_created']);
                assert.equal(
                    saved.parentTitle,
                    parent.payload.formRecord.data.fld_title
                );
                assert.deepEqual(
                    saved.sibling,
                    parent.payload.formRecord.data.fld_children_b
                );
                assert.equal(saved.calls.parentSubmits, 0);
                assert.equal(
                    saved.calls.saves.filter(
                        (call) =>
                            call.extensionAccessToken ===
                            'synthetic_parent_token'
                    ).length,
                    0
                );
                assert.equal(saved.calls.saves.length, 1);
                assert.equal(
                    saved.calls.saves[0].extensionAccessToken,
                    'synthetic_child_token'
                );
                assert.equal(saved.calls.saves[0].formRecord.type, 'create');
                assert.equal(
                    saved.calls.saves[0].formRecord.data.fld_title,
                    'A synthetic child'
                );

                const cleanOpener = await open();
                await page.keyboard.press('Escape');
                await dialog.waitFor({ state: 'hidden' });
                await page.waitForFunction(
                    (opener) => opener === document.activeElement,
                    cleanOpener
                );
                assert.equal((await read()).phase, 'closed');
                assert.deepEqual((await read()).calls, {
                    loads: [fixtures.childLoadInput('edit')],
                    saves: [],
                    parentSubmits: 0,
                });

                await open();
                await title.fill('Current child retained');
                await page.keyboard.press('Escape');
                await dialog
                    .getByRole('button', {
                        name: 'Close without saving',
                        exact: true,
                    })
                    .evaluate((button) => window.retireCreateView(button));
                await dialog.waitFor({ state: 'hidden' });
                assert.equal((await read()).phase, 'ready');
                assert.equal(
                    (await read()).childTitle,
                    'Current child retained'
                );
                assert.deepEqual((await read()).calls.saves, []);
                assert.deepEqual((await read()).calls.loads, [
                    fixtures.childLoadInput('edit'),
                ]);
                assert.equal((await read()).calls.parentSubmits, 0);
                assert.equal(await focused(create), false);

                const retiredOpener = await open();
                await title.fill('Save settling after opener replacement');
                await page.evaluate(() => window.holdNextCreateSave());
                await save.click();
                await page.waitForFunction(() => window.releaseCreateSave);
                await page.evaluate(() => window.retireCreateView());
                await dialog.waitFor({ state: 'hidden' });
                assert.equal(
                    await retiredOpener.evaluate((node) => node.isConnected),
                    false
                );
                const outside = page.locator('#outside-focus');
                await outside.focus();
                await page.evaluate(() => window.releaseCreateSave());
                await page.waitForFunction(
                    () => window.readCreateProof().phase === 'saved'
                );
                assert(await focused(outside));
                assert.equal(await focused(create), false);
                assert.equal((await read()).calls.saves.length, 1);
                assert.deepEqual((await read()).calls.loads, [
                    fixtures.childLoadInput('edit'),
                ]);
                assert.equal((await read()).calls.parentSubmits, 0);

                const sameMountedOpener = await open();
                await title.fill(
                    'Keep current native child after the view retires'
                );
                await page.evaluate(() =>
                    window.setParentPresentationCurrent(false)
                );
                await dialog.waitFor({ state: 'hidden' });
                assert.equal(
                    await sameMountedOpener.evaluate(
                        (node) => node.isConnected
                    ),
                    true
                );
                await outside.focus();
                assert(await focused(outside));
                await page.evaluate(() =>
                    window.setParentPresentationCurrent(true)
                );
                await page.waitForFunction(
                    (opener) => !opener.disabled,
                    sameMountedOpener
                );
                assert.equal(await dialog.count(), 0);
                const retired = await read();
                assert.equal(
                    retired.childTitle,
                    'Keep current native child after the view retires'
                );
                assert.deepEqual(retired.calls, {
                    loads: [fixtures.childLoadInput('edit')],
                    saves: [],
                    parentSubmits: 0,
                });

                await open();
                await title.fill('Held by the old native parent');
                await page.evaluate(() => window.holdNextCreateSave());
                await save.click();
                await page.waitForFunction(() => window.releaseCreateSave);
                const replacementLinks = [
                    'rec_replacement_a',
                    'rec_replacement_a',
                    'rec_replacement_b',
                ];
                await page.evaluate(
                    (links) => window.replaceNativeParent(links),
                    replacementLinks
                );
                await dialog.waitFor({ state: 'hidden' });
                assert.deepEqual((await read()).links, replacementLinks);
                await outside.focus();
                await page.evaluate(() => window.releaseCreateSave());
                await page.waitForFunction(
                    () =>
                        window.previousCreateCompletion() ===
                        'saved-not-reconciled'
                );
                const replacement = await read();
                assert.deepEqual(replacement.links, replacementLinks);
                assert.equal(replacement.parentTitle, 'Replacement parent');
                assert.deepEqual(
                    replacement.sibling,
                    parent.payload.formRecord.data.fld_children_b
                );
                assert.equal(replacement.calls.saves.length, 1);
                assert.equal(
                    replacement.calls.saves[0].extensionAccessToken,
                    'synthetic_child_token'
                );
                assert.equal(replacement.calls.parentSubmits, 0);
                assert(await focused(outside));
                const borrowedCreate = await checkBorrowedCreate(page, origin);
                for (const activation of ['pointer', 'keyboard']) {
                    await checkBorrowedActivationAcrossOpening(
                        page,
                        origin,
                        activation
                    );
                }
                borrowedCreate.heldPointerOwnership = true;
                borrowedCreate.heldSpaceOwnership = true;
                assert.deepEqual(errors, []);
                assert.deepEqual(external, []);
                results.push({
                    react,
                    oneLoadPerOpening: true,
                    childSaves: 1,
                    parentSaves: 0,
                    parentSubmits: 0,
                    exactFocus: true,
                    invalidSaves: 0,
                    staleDismissalRefused: true,
                    settledSaveDidNotFocusReplacement: true,
                    sameMountedParentRetirement: true,
                    freshCreateAfterRetiredLoad: true,
                    staleSavePreservedReplacementLinks: true,
                    borrowedCreate,
                    permissionHelp,
                });
                console.log(
                    `Installed linked-child Create Chromium React ${react} passed`
                );
            } finally {
                await context?.close();
                await new Promise((resolve) => server.close(resolve));
            }
            await checkInstalledEdit?.({ consumer: lane, reactVersion: react });
        } finally {
            rmSync(lane, { recursive: true });
        }
    }
    return results;
}
