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

export async function checkLinkedChildCreateBrowser({
    archive,
    browser,
    fixtures,
    install,
    output,
    root,
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
                } else if (request.url === '/') {
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
                });
                console.log(
                    `Installed linked-child Create Chromium React ${react} passed`
                );
            } finally {
                await context?.close();
                await new Promise((resolve) => server.close(resolve));
            }
        } finally {
            rmSync(lane, { recursive: true });
        }
    }
    return results;
}
