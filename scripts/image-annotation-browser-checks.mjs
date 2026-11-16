import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import {
    lstatSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import { imageAnnotationBrowserFixture } from './image-annotation-browser-fixture.mjs';

const toolNames = [
    'ArrowMarker',
    'CalloutMarker',
    'EllipseMarker',
    'FrameMarker',
    'FreehandMarker',
    'HighlightMarker',
    'LineMarker',
    'TextMarker',
];
const gitBlob = (bytes) =>
    createHash('sha1')
        .update('blob ' + bytes.length + '\0')
        .update(bytes)
        .digest('hex');
function assertReleasedUrls(records, selectedFiles = 1) {
    const created = records.created.map((item) => item.url);
    assert.equal(new Set(created).size, created.length);
    assert.deepEqual([...records.revoked].sort(), [...created].sort());
    assert.equal(new Set(records.revoked).size, records.revoked.length);
    const selected = records.created.filter((item) => item.selectedFile);
    assert.equal(selected.length, selectedFiles);
    for (const item of selected)
        assert.equal(
            records.revoked.filter((url) => url === item.url).length,
            1
        );
}
const regular = (path) => {
    const stat = lstatSync(path);
    assert(
        stat.isFile() && !stat.isSymbolicLink(),
        'Proof input must be an ordinary owned file'
    );
    return readFileSync(path);
};
async function bounded(name, action) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(action),
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(Error(name + ' did not settle')),
                    10000
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

/** Actual installed markerjs2/canvas/PNG UI. Only temporary storage is deferred.
 * Synthetic host authority/list state is not native Form or persistence proof.
 */
export async function checkImageAnnotationBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    let directory, server, context, page, failure;
    Object.assign(evidence, {
        status: 'running',
        profiles: [],
        pageErrors: [],
        unexpectedRequests: [],
        cleanup: {},
    });
    try {
        const root = realpathSync(consumer);
        const require = createRequire(join(root, 'package.json'));
        const packageRoot = join(root, 'node_modules/@miniextensions/sdk');
        const metadata = JSON.parse(regular(join(packageRoot, 'package.json')));
        assert.equal(metadata.dependencies?.markerjs2, '2.32.7');
        const vendor = JSON.parse(
            readFileSync(require.resolve('markerjs2/package.json'), 'utf8')
        );
        assert.equal(vendor.name, 'markerjs2');
        assert.equal(vendor.version, '2.32.7');
        assert.equal(
            gitBlob(
                regular(
                    join(
                        packageRoot,
                        'docs/image-annotation-markerjs2-license.txt'
                    )
                )
            ),
            '0709c250e344a56c87fba438c93f08892238b939'
        );
        const react = JSON.parse(
            readFileSync(require.resolve('react/package.json'), 'utf8')
        ).version;
        assert(
            ['18.3.1', '19.2.0'].includes(react),
            'Use the normal registered React18/19 matrix'
        );
        const image = regular(
            new URL(
                '../test/fixtures/image-annotation-64x32.png',
                import.meta.url
            )
        );
        assert.equal(
            gitBlob(image),
            'ebbc85a3917269326ec3ae04ebe0c3238ce217ea'
        );
        assert.equal(image.readUInt32BE(16), 64);
        assert.equal(image.readUInt32BE(20), 32);
        directory = mkdtempSync(join(root, '.image-annotation-proof-'));
        const responses = new Map();
        for (const format of ['esm', 'cjs']) {
            const api =
                format === 'esm'
                    ? "import { ImageAnnotationField } from '@miniextensions/sdk/react';"
                    : "const { ImageAnnotationField } = require('@miniextensions/sdk/react');";
            const entry = join(directory, format + '.js');
            writeFileSync(
                entry,
                imageAnnotationBrowserFixture.replace('__ANNOTATION_API__', api)
            );
            const bundle = await build({
                absWorkingDir: root,
                entryPoints: [entry],
                bundle: true,
                platform: 'browser',
                format: 'esm',
                write: false,
                metafile: true,
            });
            await assertBrowserInputs(bundle.metafile, root);
            assert(
                Object.keys(bundle.metafile.inputs).some((path) =>
                    path.includes('/markerjs2/')
                ),
                'Real selected vendor must be in the consumer bundle'
            );
            responses.set('/' + format + '.bundle.js', {
                type: 'text/javascript',
                bytes: bundle.outputFiles[0].contents,
            });
        }
        const css = await build({
            absWorkingDir: root,
            entryPoints: [
                require.resolve(
                    '@miniextensions/sdk/react/complete-image-annotation.css'
                ),
            ],
            bundle: true,
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(css.metafile, root);
        responses.set('/annotation.css', {
            type: 'text/css',
            bytes: css.outputFiles[0].contents,
        });
        responses.set('/source.png', { type: 'image/png', bytes: image });
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            const url = new URL(request.url, 'http://localhost');
            if (request.method !== 'GET') {
                response.writeHead(405).end();
                return;
            }
            if (url.pathname === '/') {
                const format =
                    url.searchParams.get('format') === 'cjs' ? 'cjs' : 'esm';
                response.setHeader('Content-Type', 'text/html');
                response.end(
                    '<!doctype html><html><head><link rel="stylesheet" href="/annotation.css"></head><body><main></main><script type="module" src="/' +
                        format +
                        '.bundle.js"></script></body></html>'
                );
                return;
            }
            if (url.pathname === '/favicon.ico') {
                response.writeHead(204).end();
                return;
            }
            const asset = responses.get(url.pathname);
            if (!asset) {
                response.writeHead(404).end();
                return;
            }
            response.setHeader('Content-Type', asset.type);
            response.end(asset.bytes);
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = 'http://127.0.0.1:' + server.address().port;
        context = await browser.newContext({
            viewport: { width: 1440, height: 1000 },
        });
        await context.route('**/*', async (route) => {
            const request = route.request(),
                url = new URL(request.url());
            if (
                url.origin === origin &&
                request.method() === 'GET' &&
                (url.pathname === '/' ||
                    url.pathname === '/favicon.ico' ||
                    responses.has(url.pathname))
            ) {
                await route.continue();
            } else {
                evidence.unexpectedRequests.push(request.url());
                await route.abort();
            }
        });
        page = await context.newPage();
        page.setDefaultTimeout(10000);
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        const snapshot = () =>
            page.evaluate(() => window.imageAnnotationProof.snapshot());
        const waitPending = (kind) =>
            page.waitForFunction(
                (key) => window.imageAnnotationProof.pending()[key] === 1,
                kind
            );
        const visit = async (format, query = '') => {
            if (
                await page
                    .evaluate(() => Boolean(window.imageAnnotationProof))
                    .catch(() => false)
            )
                await page.evaluate(() =>
                    window.imageAnnotationProof.dispose()
                );
            await page.goto(origin + '/?format=' + format + query);
            await page
                .getByLabel('Choose synthetic image', { exact: true })
                .waitFor();
            await page.waitForFunction(() =>
                Boolean(window.imageAnnotationProof)
            );
            assert.equal((await snapshot()).react, react);
            assert.deepEqual((await snapshot()).uploads, []);
            assert.deepEqual((await snapshot()).appends, []);
            assert.equal(await page.getByRole('dialog').count(), 0);
        };
        const dialog = () =>
            page.getByRole('dialog', {
                name: 'Annotate synthetic image',
                exact: true,
            });
        const openLocal = async () => {
            await page
                .getByLabel('Choose synthetic image', { exact: true })
                .setInputFiles({
                    name: 'camera.original.jpeg',
                    mimeType: 'image/png',
                    buffer: image,
                });
            await dialog().waitFor({ state: 'visible' });
        };
        const render = async () => {
            const finish = dialog().getByRole('button', {
                name: 'Finish annotation',
                exact: true,
            });
            await finish.focus();
            await page.keyboard.press('Enter');
            await dialog().waitFor({ state: 'detached' });
            await waitPending('uploads');
        };
        const releaseUpload = async () => {
            await page.evaluate(() =>
                window.imageAnnotationProof.releaseUpload()
            );
            await waitPending('urls');
        };
        const finishCurrent = async () => {
            await releaseUpload();
            await page.evaluate(() => window.imageAnnotationProof.releaseUrl());
            await page.waitForFunction(
                () =>
                    window.imageAnnotationProof.snapshot().appends.length === 1
            );
        };
        for (const format of ['esm', 'cjs']) {
            const cases = [];
            evidence.phase =
                format + ':actual-toolbar-render-close-and-latest-list';
            await visit(format);
            assert.equal(
                await page
                    .getByLabel('Choose synthetic image', { exact: true })
                    .getAttribute('form'),
                'annotation-form'
            );
            assert.equal(
                await page.locator('label[for="annotation-file"]').count(),
                1
            );
            assert.equal(
                await page
                    .locator('.mx-sdk-image-annotation-credit a')
                    .isVisible(),
                true
            );
            assert.equal(
                await page
                    .locator('.mx-sdk-image-annotation-credit a')
                    .getAttribute('href'),
                'https://markerjs.com'
            );
            await openLocal();
            assert.deepEqual(
                await dialog()
                    .locator('[data-type-name]')
                    .evaluateAll((nodes) =>
                        nodes
                            .map((node) => node.getAttribute('data-type-name'))
                            .sort()
                    ),
                [...toolNames].sort()
            );
            for (const tool of toolNames) {
                const control = dialog().locator(
                    '[data-type-name="' + tool + '"]'
                );
                assert.equal(await control.getAttribute('role'), 'button');
                assert.equal(await control.getAttribute('tabindex'), '0');
                assert.equal(
                    await control.getAttribute('aria-label'),
                    'Tool ' + tool
                );
            }
            const logo = dialog().locator(
                'a[href="https://markerjs.com/"][title="Powered by marker.js"]'
            );
            assert.equal(await logo.isVisible(), true);
            const logoBox = await logo.boundingBox();
            assert(logoBox && logoBox.width > 0 && logoBox.height > 0);
            const originalDialog = await dialog().elementHandle();
            await page.evaluate(() => window.imageAnnotationProof.echo());
            assert.equal(
                await originalDialog.evaluate((node) => node.isConnected),
                true
            );
            const arrow = dialog().getByRole('button', {
                name: 'Tool ArrowMarker',
                exact: true,
            });
            await arrow.focus();
            await page.keyboard.press('Space');
            const drawing = dialog().locator(
                'svg[viewBox][style*="pointer-events: auto"]'
            );
            assert.equal(await drawing.count(), 1);
            const viewBox = await drawing.evaluate((node) => ({
                width: node.viewBox.baseVal.width,
                height: node.viewBox.baseVal.height,
            }));
            assert(viewBox.width > 0 && viewBox.height > 0);
            assert(Math.abs(viewBox.width / viewBox.height - 2) < 0.01);
            const beforeGroups = await drawing.locator('g').count();
            const box = await drawing.boundingBox();
            assert(box && box.width > 0 && box.height > 0);
            await page.mouse.move(
                box.x + box.width * 0.15,
                box.y + box.height * 0.2
            );
            await page.mouse.down();
            await page.mouse.move(
                box.x + box.width * 0.8,
                box.y + box.height * 0.75,
                { steps: 8 }
            );
            await page.mouse.up();
            assert(
                (await drawing.locator('g').count()) > beforeGroups,
                'Real pointer drawing must create a vendor marker'
            );
            await render();
            const pending = await snapshot();
            assert.deepEqual(pending.urlReads, []);
            assert.deepEqual(pending.appends, []);
            assert.equal(pending.closes, 1);
            assert(
                pending.events.indexOf('upload-called') <
                    pending.events.indexOf('editor-closed')
            );
            assert.equal(pending.uploads.length, 1);
            assert.equal(pending.uploads[0].type, 'image/png');
            assert.equal(
                pending.uploads[0].filename,
                'camera.original-annotated.png'
            );
            assert.equal(pending.uploads[0].width, 64);
            assert.equal(pending.uploads[0].height, 32);
            assert(
                pending.uploads[0].changedBytes > 0,
                'Decoded PNG must contain actual annotation pixels'
            );
            assert.equal(
                await page
                    .getByLabel('Choose synthetic image', { exact: true })
                    .isDisabled(),
                true
            );
            await page
                .getByRole('textbox', { name: 'Neighbor note', exact: true })
                .fill('Kept neighboring draft');
            await page
                .getByRole('button', {
                    name: 'Append concurrent attachment',
                    exact: true,
                })
                .click();
            await finishCurrent();
            const complete = await snapshot();
            assert.equal(complete.notes, 'Kept neighboring draft');
            assert.equal(complete.attachments.length, 2);
            assert.equal(complete.attachments[0].filename, 'concurrent.png');
            assert.equal(
                complete.attachments[1].filename,
                'camera.original-annotated.png'
            );
            assert.equal(complete.uploads.length, 1);
            assert.deepEqual(complete.urlReads, [1]);
            assert.equal(complete.submits, 0);
            assert.deepEqual(complete.errors, []);
            assertReleasedUrls(complete);
            cases.push(
                'real-eight-tool-keyboard-pointer-PNG-render-close-latest-list'
            );

            evidence.phase = format + ':owner-ABA-cuts-late-upload';
            await visit(format);
            await openLocal();
            await render();
            await page.evaluate(() => window.imageAnnotationProof.ownerABA());
            await page.evaluate(() =>
                window.imageAnnotationProof.releaseUpload()
            );
            await page.waitForFunction(
                () => window.imageAnnotationProof.pending().tasks === 0
            );
            const retired = await snapshot();
            assert.equal(retired.uploadSettled, 1);
            assert.deepEqual(retired.urlReads, []);
            assert.deepEqual(retired.appends, []);
            await openLocal();
            await render();
            await finishCurrent();
            const successor = await snapshot();
            assert.equal(successor.uploads.length, 2);
            assert.deepEqual(successor.urlReads, [2]);
            assert.equal(successor.appends[0].id, 2);
            assert.equal(successor.attachments.length, 1);
            assertReleasedUrls(successor, 2);
            cases.push('retired-upload-owner-ABA-and-fresh-successor');

            evidence.phase = format + ':unmount-cuts-late-URL';
            await visit(format);
            await openLocal();
            await render();
            await releaseUpload();
            const beforeUnmount = await snapshot();
            assert.equal(beforeUnmount.ownerCurrent, true);
            assert.equal(beforeUnmount.uploads.length, 1);
            assert.deepEqual(beforeUnmount.urlReads, [1]);
            assert.equal(
                await page.evaluate(
                    () => window.imageAnnotationProof.pending().urls
                ),
                1
            );
            await page.evaluate(() => window.imageAnnotationProof.unmount());
            await page
                .getByLabel('Choose synthetic image', { exact: true })
                .waitFor({ state: 'detached' });
            assert.equal((await snapshot()).ownerCurrent, true);
            await page.evaluate(() => window.imageAnnotationProof.releaseUrl());
            await page.waitForFunction(
                () => window.imageAnnotationProof.pending().tasks === 0
            );
            const unmounted = await snapshot();
            assert.equal(unmounted.ownerCurrent, true);
            assert.equal(unmounted.uploads.length, 1);
            assert.deepEqual(unmounted.urlReads, [1]);
            assert.equal(unmounted.urlSettled, 1);
            assert.deepEqual(unmounted.appends, []);
            assert.deepEqual(unmounted.errors, []);
            assertReleasedUrls(unmounted);
            cases.push('unmount-refuses-real-rendered-late-URL');

            evidence.phase = format + ':borrowed-source-close-and-gates';
            await visit(format);
            await page.evaluate(() => window.imageAnnotationProof.remote());
            await dialog().waitFor({ state: 'visible' });
            await dialog()
                .getByRole('button', { name: 'Close editor', exact: true })
                .focus();
            await page.keyboard.press('Space');
            await dialog().waitFor({ state: 'detached' });
            const borrowed = await snapshot();
            assert.equal(borrowed.closes, 1);
            assert.deepEqual(borrowed.uploads, []);
            assert.deepEqual(borrowed.created, []);
            assert.deepEqual(borrowed.revoked, []);
            for (const gate of ['readonly', 'disabled']) {
                await visit(format, '&' + gate);
                assert.equal(
                    await page
                        .getByLabel('Choose synthetic image', { exact: true })
                        .isDisabled(),
                    true
                );
                assert.equal(await dialog().count(), 0);
                assert.deepEqual((await snapshot()).uploads, []);
            }
            cases.push(
                'borrowed-URL-preserved-keyboard-close-readonly-disabled'
            );

            evidence.phase = format + ':real-decode-refusal';
            await visit(format);
            await page
                .getByLabel('Choose synthetic image', { exact: true })
                .setInputFiles({
                    name: 'invalid.png',
                    mimeType: 'image/png',
                    buffer: Buffer.from('not a PNG'),
                });
            await page.getByRole('alert').waitFor({ state: 'visible' });
            assert.equal(
                await page.getByRole('alert').textContent(),
                'Synthetic image cannot be decoded'
            );
            assert.equal(await dialog().count(), 0);
            const rejected = await snapshot();
            assert.deepEqual(rejected.errors, ['decode']);
            assert.deepEqual(rejected.uploads, []);
            assertReleasedUrls(rejected);
            assert.equal(rejected.submits, 0);
            cases.push('real-browser-invalid-image-decoder-and-private-error');

            evidence.phase =
                format + ':storage-failure-feedback-and-fresh-retry';
            for (const stage of ['upload', 'url']) {
                await visit(format);
                await openLocal();
                await render();
                if (stage === 'url') await releaseUpload();
                await page.evaluate((kind) => {
                    if (kind === 'upload')
                        window.imageAnnotationProof.failUpload();
                    else window.imageAnnotationProof.failUrl();
                }, stage);
                const alert = page.getByRole('alert');
                await alert.waitFor({ state: 'visible' });
                await page.waitForFunction(
                    () => window.imageAnnotationProof.pending().tasks === 0
                );
                assert.equal(
                    await alert.textContent(),
                    'Synthetic storage failed'
                );
                assert.equal(await page.getByRole('status').count(), 0);
                assert.equal(
                    await page
                        .getByLabel('Choose synthetic image', { exact: true })
                        .isDisabled(),
                    false
                );
                assert.equal(await dialog().count(), 0);
                assert(
                    !(await page.locator('body').textContent()).includes(
                        'PRIVATE_ANNOTATION_'
                    )
                );
                const failed = await snapshot();
                assert.equal(failed.uploads.length, 1);
                assert.equal(failed.uploadRejected, stage === 'upload' ? 1 : 0);
                assert.equal(failed.urlRejected, stage === 'url' ? 1 : 0);
                assert.deepEqual(
                    failed.urlReads,
                    stage === 'upload' ? [] : [1]
                );
                assert.deepEqual(failed.appends, []);
                assert.deepEqual(failed.errors, ['storage']);
                assert.equal(failed.submits, 0);
                assertReleasedUrls(failed);
                // A retry is a fresh actual selection/editor/render. It never
                // retries or cancels the already allocated first transport.
                await openLocal();
                assert.equal(await page.getByRole('alert').count(), 0);
                await render();
                await finishCurrent();
                const recovered = await snapshot();
                assert.equal(recovered.uploads.length, 2);
                assert.deepEqual(
                    recovered.urlReads,
                    stage === 'upload' ? [2] : [1, 2]
                );
                assert.equal(recovered.appends.length, 1);
                assert.equal(recovered.appends[0].id, 2);
                assert.equal(recovered.attachments.length, 1);
                assert.equal(
                    recovered.attachments[0].filename,
                    'camera.original-annotated.png'
                );
                assert.equal(recovered.submits, 0);
                assert.deepEqual(recovered.errors, ['storage']);
                assert.equal(await page.getByRole('alert').count(), 0);
                assertReleasedUrls(recovered, 2);
            }
            cases.push(
                'real-render-upload-and-URL-failures-private-feedback-fresh-editor-retry'
            );

            evidence.phase = format + ':retired-storage-failure-feedback';
            for (const stage of ['upload', 'url']) {
                await visit(format);
                await openLocal();
                await render();
                if (stage === 'url') await releaseUpload();
                await page.evaluate(() =>
                    window.imageAnnotationProof.ownerABA()
                );
                await page.evaluate((kind) => {
                    if (kind === 'upload')
                        window.imageAnnotationProof.failUpload();
                    else window.imageAnnotationProof.failUrl();
                }, stage);
                await page.waitForFunction(
                    () => window.imageAnnotationProof.pending().tasks === 0
                );
                const staleFailure = await snapshot();
                assert.equal(
                    staleFailure.uploadRejected,
                    stage === 'upload' ? 1 : 0
                );
                assert.equal(staleFailure.urlRejected, stage === 'url' ? 1 : 0);
                assert.deepEqual(
                    staleFailure.urlReads,
                    stage === 'upload' ? [] : [1]
                );
                assert.deepEqual(staleFailure.appends, []);
                assert.deepEqual(staleFailure.errors, []);
                assert.equal(await page.getByRole('alert').count(), 0);
                assert.equal(await page.getByRole('status').count(), 0);
                assert(
                    !(await page.locator('body').textContent()).includes(
                        'PRIVATE_ANNOTATION_'
                    )
                );
                assertReleasedUrls(staleFailure);
                await openLocal();
                await render();
                await finishCurrent();
                const afterFailure = await snapshot();
                assert.deepEqual(afterFailure.errors, []);
                assert.deepEqual(
                    afterFailure.urlReads,
                    stage === 'upload' ? [2] : [1, 2]
                );
                assert.equal(afterFailure.appends.length, 1);
                assert.equal(afterFailure.appends[0].id, 2);
                assertReleasedUrls(afterFailure, 2);
            }
            cases.push(
                'retired-upload-and-URL-rejections-cannot-leak-feedback-to-fresh-successor'
            );
            evidence.profiles.push({ format, react, cases, status: 'passed' });
        }
        assert.deepEqual(evidence.pageErrors, []);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.scope =
            'Actual packed ESM/CJS component, selected markerjs2 2.32.7 UI/canvas/PNG and StrictMode; synthetic host current-owner/list and deferred storage only. No native Form, provider upload, Save or persistence acceptance.';
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.phaseError = error.message;
        if (page) {
            try {
                evidence.failureState = await page.evaluate(() =>
                    window.imageAnnotationProof?.snapshot()
                );
                await page.screenshot({
                    path: join(output, 'image-annotation-failure.png'),
                });
            } catch (capture) {
                evidence.captureError = capture.message;
            }
        }
    } finally {
        const errors = [];
        for (const [name, acquired, cleanup] of [
            [
                'fixtureTasks',
                page,
                () =>
                    page.evaluate(() => window.imageAnnotationProof?.dispose()),
            ],
            ['context', context, () => context.close()],
            [
                'server',
                server,
                () =>
                    new Promise((resolve, reject) => {
                        server.closeAllConnections();
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        );
                    }),
            ],
        ]) {
            if (!acquired) {
                evidence.cleanup[name] = 'not-acquired';
                continue;
            }
            try {
                await bounded('Annotation cleanup ' + name, cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                errors.push(error);
                evidence.cleanup[name] = { error: error.message };
            }
        }
        if (
            directory &&
            evidence.cleanup.context === 'completed' &&
            evidence.cleanup.server === 'completed'
        ) {
            try {
                rmSync(directory, { recursive: true, force: true });
                evidence.cleanup.directory = 'completed';
            } catch (error) {
                errors.push(error);
                evidence.cleanup.directory = { error: error.message };
            }
        } else
            evidence.cleanup.directory = directory
                ? 'retained-for-uncertain-cleanup'
                : 'not-acquired';
        if (errors.length) {
            evidence.status = 'failed';
            failure = new AggregateError(
                failure ? [failure, ...errors] : errors,
                'Annotation proof/cleanup incomplete'
            );
        }
        writeFileSync(
            join(output, 'image-annotation.json'),
            JSON.stringify(evidence, null, 2)
        );
    }
    if (failure) throw failure;
}
