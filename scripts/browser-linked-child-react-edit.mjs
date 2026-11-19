import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const recordId = 'rec_existing';
const links = ['rec_existing', 'rec_existing', 'rec_sibling'];
const sibling = ['rec_other_field'];

export async function checkInstalledReactLinkedChildEdit({
    browser,
    consumer,
    fixtures,
    root,
}) {
    const parent = fixtures.parentForm('edit');
    const child = fixtures.childForm('edit');
    child.payload.formRecord = {
        ...child.payload.formRecord,
        type: 'edit',
        recordId,
        tableId: 'tbl_child',
    };
    child.payload.formFieldIdsWithUnsavedChanges = [];
    const saved = fixtures.childSaved('edit');
    saved.record.id = recordId;
    const selected = {
        tbl_child: {
            airtableFields: [
                parent.payload.fieldIdsToSchemas.fld_title.airtableField,
            ],
            recordIdsToAirtableRecords: Object.fromEntries(
                [recordId, 'rec_sibling'].map((id) => [
                    id,
                    { id, fields: { fld_title: id } },
                ])
            ),
        },
    };
    const bundle = await build({
        absWorkingDir: consumer,
        stdin: {
            contents: readFileSync(
                join(
                    root,
                    'scripts/linked-child-react-edit-browser-fixture.mjs'
                ),
                'utf8'
            ),
            sourcefile: 'linked-child-react-edit-browser-fixture.mjs',
            resolveDir: consumer,
        },
        define: {
            __REACT_EDIT_FIXTURE__: JSON.stringify({
                parent,
                child,
                saved,
                selected,
            }),
        },
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        metafile: true,
        write: false,
    });
    assert(
        Object.keys(bundle.metafile.inputs).some((input) =>
            input
                .replaceAll('\\', '/')
                .endsWith(
                    'node_modules/@miniextensions/sdk/dist/esm/react/FormLinkedChildEditDialog.js'
                )
        ),
        'Browser must bundle the installed public Edit dialog'
    );
    const server = createServer((request, response) => {
        if (request.url === '/proof.js') {
            response.setHeader('Content-Type', 'text/javascript');
            response.end(bundle.outputFiles[0].contents);
            return;
        }
        if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end(
                '<!doctype html><title>Installed React Edit proof</title><main id="app"></main><script type="module" src="/proof.js"></script>'
            );
            return;
        }
        response.writeHead(404).end();
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    let context;
    try {
        context = await browser.newContext({ serviceWorkers: 'block' });
        const origin = 'http://127.0.0.1:' + server.address().port;
        const unexpected = [];
        await context.route('**/*', (route) => {
            if (new URL(route.request().url()).origin === origin)
                return route.continue();
            unexpected.push('external transport');
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', (error) => unexpected.push(error.message));
        const dialog = page.getByRole('dialog', {
            name: 'Edit linked record',
            exact: true,
        });
        const button = (name) =>
            dialog.getByRole('button', { name, exact: true });
        const title = dialog.getByRole('textbox', {
            name: 'Child title',
            exact: true,
        });
        const focus = (target) =>
            target.evaluate(
                (node) => node.ownerDocument.activeElement === node
            );
        const read = () => page.evaluate(() => window.readReactEditProof());
        const open = async () => {
            const locator = page.getByRole('button', {
                name: 'Edit selected record',
                exact: true,
            });
            await locator.waitFor();
            const opening = await locator.elementHandle();
            assert(opening);
            await opening.press('Enter');
            await dialog.waitFor();
            assert.equal(
                await dialog.evaluate(
                    (node) =>
                        node.matches(':modal') &&
                        node.parentElement === node.ownerDocument.body
                ),
                true
            );
            return opening;
        };
        const unchangedParent = (receipt, title = 'Parent native title') => {
            assert.equal(receipt.calls.parentSubmits, 0);
            assert.equal(receipt.parentTitle, title);
            assert.deepEqual(receipt.links, links);
            assert.deepEqual(receipt.sibling, sibling);
        };

        await page.goto(origin);
        const opener = await open();
        assert.equal(await focus(button('Close')), true);
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focus(button('Save')), true);
        await page.keyboard.press('Tab');
        assert.equal(await focus(button('Close')), true);
        await title.fill('Resume this selected record');
        await title.press('Enter');
        assert.equal((await read()).calls.saves.length, 0);
        await page.keyboard.press('Escape');
        assert.equal(await focus(button('Keep editing')), true);
        await button('Close without saving').click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await focus(opener), true);
        await open();
        assert.equal(await title.inputValue(), 'Resume this selected record');
        const resumed = await read();
        unchangedParent(resumed);
        assert.equal(resumed.calls.reads.length, 1);
        assert.equal(resumed.calls.loads.length, 1);
        assert.equal(resumed.calls.saves.length, 0);
        await button('Save').click();
        await dialog.waitFor({ state: 'hidden' });
        const savedOnce = await read();
        unchangedParent(savedOnce);
        assert.equal(savedOnce.calls.saves.length, 1);
        assert.equal(savedOnce.accepted, 1);
        const [input] = savedOnce.calls.saves;
        assert.equal(input.extensionAccessToken, 'synthetic_child_token');
        assert.equal(input.formRecord.type, 'edit');
        assert.equal(input.formRecord.tableId, 'tbl_child');
        assert.equal(input.formRecord.recordId, recordId);
        assert.equal(
            input.formRecord.data.fld_title,
            'Resume this selected record'
        );
        assert.equal(await focus(opener), true);

        await page.goto(origin);
        const retired = await open();
        await title.fill('Old held edit');
        await page.evaluate(() => window.holdNextReactEditSave());
        await button('Save').click();
        await page.waitForFunction(
            () => typeof window.releaseReactEditSave === 'function'
        );
        await page.evaluate(() => window.replaceReactEditParent());
        await dialog.waitFor({ state: 'hidden' });
        const successor = await open();
        assert.equal(await retired.evaluate((node) => node.isConnected), false);
        assert.equal(
            await successor.evaluate((node) => node.isConnected),
            true
        );
        await title.fill('New same-record draft');
        await title.focus();
        await page.evaluate(() => window.releaseReactEditSave());
        await page.waitForFunction(() => {
            const settled = window.readReactEditProof();
            return (
                settled.previousAccepted === 1 &&
                settled.previousCompletion === 'saved-not-reconciled'
            );
        });
        const replacement = await read();
        unchangedParent(replacement, 'Replacement parent title');
        assert.equal(replacement.phase, 'ready');
        assert.equal(replacement.accepted, 0);
        assert.deepEqual(replacement.childDirty, ['fld_title']);
        assert.equal(replacement.childTitle, 'New same-record draft');
        assert.equal(await title.inputValue(), 'New same-record draft');
        assert.equal(await focus(title), true);
        assert.equal(replacement.calls.saves.length, 1);
        assert.deepEqual(unexpected, []);

        return {
            selectedReads: 1,
            childLoads: 1,
            confirmedChildSaves: 1,
            parentSubmits: 0,
            successorPreserved: true,
        };
    } finally {
        try {
            await context?.close();
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    }
}
