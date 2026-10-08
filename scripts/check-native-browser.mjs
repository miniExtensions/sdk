import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
    readdirSync,
    lstatSync,
    realpathSync,
    existsSync,
} from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createReviewFixture } from './build-privacy-browser-proof.mjs';
import { addAttachmentReviewAnswers } from './attachment-review-recipe-checks.mjs';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const regular = (path) => {
    assert(lstatSync(path).isFile() && realpathSync(path) === resolve(path));
    return readFileSync(path);
};
const packageDirectory = resolve(process.env.SDK_NATIVE_PACKAGE_DIR ?? '');
const proofDirectory = resolve(process.env.SDK_NATIVE_PROOF_DIR ?? '');
const output = resolve(process.env.SDK_NATIVE_RESULT_DIR ?? '');
assert(
    process.env.SDK_NATIVE_PACKAGE_DIR &&
        process.env.SDK_NATIVE_PROOF_DIR &&
        process.env.SDK_NATIVE_RESULT_DIR,
    'Explicit artifact/result directories required'
);
assert(!existsSync(output), 'Refuse existing result directory');
mkdirSync(output, { recursive: true });
try {
    const receipt = JSON.parse(
        regular(join(packageDirectory, 'artifact-receipt.json'))
    );
    const manifestBytes = regular(join(proofDirectory, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes);
    const tgzs = readdirSync(packageDirectory).filter((name) =>
        name.endsWith('.tgz')
    );
    assert.equal(tgzs.length, 1);
    const archive = join(packageDirectory, tgzs[0]);
    assert.equal(hash(regular(archive)), manifest.package.sha256);
    assert.deepEqual(receipt.source, manifest.source);
    const allowed = new Map();
    for (const entry of manifest.outputs) {
        assert(
            !entry.path.startsWith('/') && !entry.path.split('/').includes('..')
        );
        const bytes = regular(join(proofDirectory, entry.path));
        assert.equal(bytes.length, entry.bytes);
        assert.equal(hash(bytes), entry.sha256);
        allowed.set('/' + entry.path, bytes);
    }
    let temporary;
    const results = [];
    const network = [];
    let browser;
    let server;
    const report = {
        schemaVersion: 1,
        source: manifest.source,
        ci: manifest.ci,
        package: manifest.package,
        fixtureManifestSha256: hash(manifestBytes),
        harnessSha256: hash(regular('scripts/check-native-browser.mjs')),
        hostSha256: hash(regular('scripts/native-browser-fixture.mjs')),
        node: process.version,
        playwright: JSON.parse(
            regular(realpathSync('node_modules/playwright/package.json'))
        ).version,
        command: 'pnpm check:browser',
        fixtureSources: [
            'scripts/build-privacy-browser-proof.mjs',
            'scripts/attachment-review-recipe-checks.mjs',
            'scripts/portal-recipe-checks.mjs',
        ].map((path) => ({ path, sha256: hash(regular(path)) })),
        channel: 'chrome',
        chromiumSandbox: true,
        results,
        network,
        cleanup: {},
        limits: [
            'Native Chromium with synthetic local responses only; no live auth/backend/persistence.',
            'File chooser interception/empty completion and browser-supplied events are not OS picker Cancel/Escape or focus certification.',
            'Default/off and remembered session cases use only fake opaque credentials.',
            'Representative bounded scenarios; not all manual-kit routes or full parity.',
        ],
    };
    try {
        temporary = mkdtempSync(join(tmpdir(), 'sdk-native-consumer-'));
        writeFileSync(
            join(temporary, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: {
                    '@miniextensions/sdk': `file:${archive}`,
                    react: '19.2.0',
                    'react-dom': '19.2.0',
                },
            })
        );
        execFileSync(
            'npm',
            [
                'install',
                '--ignore-scripts',
                '--no-audit',
                '--no-fund',
                '--cache',
                join(temporary, 'npm-cache'),
            ],
            { cwd: temporary, stdio: 'pipe' }
        );
        const form = createReviewFixture('review-answers').page();
        addAttachmentReviewAnswers(form);
        // Reuse complete public verification envelopes; no new schema/operator authority.
        const authFixture = await import(
            'file://' + join(proofDirectory, 'fixture.js')
        );
        const auth = authFixture.createPrivacyFixture('password').loginPage();
        const portal = fixtures.makePortal();
        const data = {
            form,
            auth,
            portal,
            oldPage: fixtures.page(
                [fixtures.record('rec_old', 'Old result', 1)],
                'old_offset'
            ),
            newPage: fixtures.page([
                fixtures.record('rec_new', 'New result', 2),
            ]),
            criteria: {
                selectedCustomViewId: 'view_example',
                sortFieldsByEndUser: null,
                supportsEndUserSortCleanup: true,
                filtersByEndUser: null,
                supportsEndUserFilterCleanup: true,
                searchParamsMap: {},
                searchTerm: null,
            },
        };
        const entry = join(temporary, 'native-browser-fixture.mjs');
        writeFileSync(entry, regular('scripts/native-browser-fixture.mjs'));
        const bundled = await build({
            absWorkingDir: temporary,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            outfile: join(temporary, 'native.js'),
            write: false,
            metafile: true,
            legalComments: 'none',
            define: {
                __FIXTURES__: JSON.stringify(data),
                'process.env.NODE_ENV': '"production"',
            },
        });
        const installed = realpathSync(
            join(temporary, 'node_modules/@miniextensions/sdk')
        );
        report.fixtureDataSha256 = hash(JSON.stringify(data));
        report.bundleInputs = [];
        for (const name of Object.keys(bundled.metafile.inputs)) {
            if (name === '<define:__FIXTURES__>') {
                report.bundleInputs.push({
                    path: name,
                    virtual: true,
                    sha256: report.fixtureDataSha256,
                });
                continue;
            }
            const path = realpathSync(resolve(temporary, name));
            assert(
                path.startsWith(temporary + '/'),
                'No source aliases or workspace dependency allowed'
            );
            const bytes = regular(path);
            const item = {
                path: relative(temporary, path),
                sha256: hash(bytes),
                bytes: bytes.length,
            };
            if (path.startsWith(installed + '/')) {
                const member =
                    'package/' +
                    relative(installed, path).replaceAll('\\', '/');
                const original = execFileSync('tar', ['-xOf', archive, member]);
                assert.deepEqual(
                    bytes,
                    original,
                    'Installed SDK input differs from original TGZ'
                );
                item.archiveMember = member;
            }
            report.bundleInputs.push(item);
        }
        const code = bundled.outputFiles[0].contents;
        report.bundleSha256 = hash(code);
        allowed.set('/native.js', code);
        const html = Buffer.from(
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Native synthetic SDK consumer</title></head><body><main></main><script type="module" src="/native.js"></script></body></html>`
        );
        allowed.set('/native.html', html);
        server = createServer((request, response) => {
            const url = new URL(request.url, 'http://127.0.0.1');
            const bytes = allowed.get(url.pathname);
            if (!bytes || request.method !== 'GET') {
                response.writeHead(404);
                response.end();
                return;
            }
            response.setHeader(
                'Content-Type',
                url.pathname.endsWith('.js')
                    ? 'text/javascript'
                    : url.pathname.endsWith('.css')
                      ? 'text/css'
                      : 'text/html'
            );
            response.end(bytes);
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const executablePath = realpathSync('/opt/google/chrome/chrome');
        report.browserExecutable = {
            path: executablePath,
            version: execFileSync(executablePath, ['--version'], {
                encoding: 'utf8',
            }).trim(),
        };
        browser = await chromium.launch({
            channel: 'chrome',
            headless: true,
            chromiumSandbox: true,
        });
        report.chromium = browser.version();
        const run = async (name, exercise) => {
            const context = await browser.newContext({
                serviceWorkers: 'block',
            });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await context.route('**/*', async (route) => {
                if (new URL(route.request().url()).origin === origin)
                    await route.continue();
                else {
                    network.push({
                        case: name,
                        url: new URL(route.request().url()).origin,
                    });
                    await route.abort();
                }
            });
            const item = { name, status: 'running' };
            results.push(item);
            try {
                await exercise(page, origin);
                assert.deepEqual(errors, []);
                const state = await page.evaluate(
                    () =>
                        window.__nativeProbe?.snapshot() ??
                        window.__privacyBrowserProof?.snapshot()
                );
                assert.deepEqual(state.errors ?? state.unexpected, []);
                item.state = state;
                item.ax = await page.locator('body').ariaSnapshot();
                await page.screenshot({
                    path: join(output, name + '.png'),
                    fullPage: true,
                });
                item.status = 'passed';
                console.log(`Native Chromium ${name}: passed`);
            } catch (error) {
                item.status = 'failed';
                item.error = error.message;
                item.pageErrors = errors;
                try {
                    item.state = await page.evaluate(
                        () =>
                            window.__nativeProbe?.snapshot() ??
                            window.__privacyBrowserProof?.snapshot()
                    );
                } catch (captureError) {
                    item.stateCaptureError = captureError.message;
                }
                try {
                    item.ax = await page.locator('body').ariaSnapshot();
                } catch (captureError) {
                    item.axCaptureError = captureError.message;
                }
                await page
                    .screenshot({
                        path: join(output, name + '-failed.png'),
                        fullPage: true,
                    })
                    .catch(() => {});
                throw error;
            } finally {
                await context.close();
            }
        };
        const idle = (page) =>
            page.waitForFunction(
                () =>
                    document
                        .querySelector('#screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
        const connect = async (page, origin, scenario) => {
            await page.goto(
                `${origin}/starter/index.html?scenario=${scenario}`
            );
            await page
                .getByRole('button', { name: 'Connect and load', exact: true })
                .click();
            await idle(page);
        };
        for (const scenario of ['teardown-logout', 'teardown-disconnect'])
            await run(scenario, async (page, origin) => {
                await connect(page, origin, scenario);
                await page
                    .locator('[data-field-id="fld_title"]')
                    .fill('Previous visitor private narrative');
                await page
                    .getByRole('button', { name: 'Save', exact: true })
                    .click();
                await idle(page);
                await page
                    .getByRole('button', { name: 'Reload', exact: true })
                    .click();
                await idle(page);
                if (scenario.endsWith('logout')) {
                    await page
                        .getByRole('button', {
                            name: "Clear this visitor's session",
                            exact: true,
                        })
                        .click();
                    await page
                        .getByRole('button', { name: 'Reload', exact: true })
                        .click();
                } else {
                    await page
                        .getByRole('button', {
                            name: 'Disconnect',
                            exact: true,
                        })
                        .click();
                    await page
                        .getByRole('button', {
                            name: 'Connect and load',
                            exact: true,
                        })
                        .click();
                }
                await idle(page);
                assert.equal(
                    await page
                        .locator('[data-field-id="fld_title"]')
                        .inputValue(),
                    'Fresh public baseline'
                );
                const html = await page
                    .locator('#screen')
                    .evaluate((node) => node.outerHTML);
                for (const secret of [
                    'Previous visitor private narrative',
                    'Previous visitor private field label',
                    'previous-visitor-private-attachment.pdf',
                ])
                    assert(!html.includes(secret));
                const state = await page.evaluate(() =>
                    window.__privacyBrowserProof.snapshot()
                );
                assert.equal(
                    state.calls.filter((c) => c.route === 'saveForm').length,
                    1
                );
                assert.equal(
                    await page
                        .getByRole('button', { name: 'Save', exact: true })
                        .isDisabled(),
                    true
                );
            });
        await run('invalid-number', async (page, origin) => {
            await connect(page, origin, 'review-answers');
            const input = page.locator('[data-field-id="fld_review_number"]');
            await input.fill('7');
            await input.press('ControlOrMeta+A');
            await input.press('-');
            assert.equal(
                await input.evaluate((node) => node.validity.badInput),
                true
            );
            await page
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await idle(page);
            assert.equal(await page.locator('dialog[open]').count(), 0);
            let state = await page.evaluate(() =>
                window.__privacyBrowserProof.snapshot()
            );
            assert.equal(
                state.calls.filter((c) => c.route === 'saveForm').length,
                0
            );
            await page.locator('#visitor').selectOption('B');
            await page.locator('#visitor').selectOption('A');
            await input.waitFor();
            assert.equal(
                await input.inputValue(),
                '7',
                'Invalid native buffer must not replace the retained draft across a visitor remount'
            );
            await input.fill('9');
            await page
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await page
                .getByRole('button', { name: 'Confirm', exact: true })
                .click();
            await idle(page);
            state = await page.evaluate(() =>
                window.__privacyBrowserProof.snapshot()
            );
            const calls = state.calls.filter((c) => c.route === 'saveForm');
            assert.equal(calls.length, 1);
            assert.equal(calls[0].input.formRecord.data.fld_review_number, 9);
            assert(
                calls[0].input.formFieldIdsWithUnsavedChanges.includes(
                    'fld_review_number'
                )
            );
        });
        await run('attachment-picker', async (page, origin) => {
            await page.goto(`${origin}/native.html?mode=attachment`);
            await page.locator('dialog[open]').waitFor();
            const text = page.locator('dialog input[type=password]');
            await text.fill('Retained dirty text');
            const choose = page.getByRole('button', {
                name: 'Choose files',
                exact: true,
            });
            await choose.focus();
            let pending = page.waitForEvent('filechooser');
            await page.keyboard.press('Enter');
            const chooser = await pending;
            await chooser.setFiles({
                name: 'FAKE_QUEUED.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('fake'),
            });
            const before = await page.evaluate(() =>
                window.__nativeProbe.snapshot()
            );
            pending = page.waitForEvent('filechooser');
            await choose.press('Enter');
            await (await pending).setFiles([]);
            assert.equal(await page.locator('dialog[open]').count(), 1);
            let state = await page.evaluate(() =>
                window.__nativeProbe.snapshot()
            );
            assert.deepEqual(state.draft, before.draft);
            assert.deepEqual(state.pending, ['FAKE_QUEUED.txt']);
            assert.equal(state.calls.length, 0);
            // Explicitly supplied cancel event tests bubbling target guard only.
            await page
                .locator('dialog input[type=file]')
                .dispatchEvent('cancel', { bubbles: true, cancelable: true });
            state = await page.evaluate(() => window.__nativeProbe.snapshot());
            assert.deepEqual(state.draft, before.draft);
            assert.deepEqual(state.pending, before.pending);
            assert.equal(await page.locator('dialog[open]').count(), 1);
            await page.keyboard.press('Escape');
            await page.locator('dialog').waitFor({ state: 'detached' });
            await page
                .getByRole('button', { name: 'Open attachment editor' })
                .click();
            await page.locator('dialog[open]').waitFor();
            assert.deepEqual(
                (await page.evaluate(() => window.__nativeProbe.snapshot()))
                    .pending,
                before.pending
            );
            await page
                .getByRole('button', { name: 'Clear pending files' })
                .click();
            await page
                .getByRole('button', { name: 'Save synthetic Form' })
                .click();
            await page.waitForFunction(
                () => window.__nativeProbe.snapshot().calls.length === 1
            );
            state = await page.evaluate(() => window.__nativeProbe.snapshot());
            assert.deepEqual(
                state.calls[0].input.formRecord.data,
                before.draft.data
            );
        });
        await run('portal-late-criteria', async (page, origin) => {
            await page.goto(`${origin}/native.html?mode=portal`);
            await page.getByRole('button', { name: 'Load records' }).click();
            await page.waitForFunction(
                () => window.__nativeProbe.snapshot().calls.length === 1
            );
            await page
                .getByRole('button', { name: 'Apply new search' })
                .click();
            assert.equal(
                (await page.evaluate(() => window.__nativeProbe.snapshot()))
                    .calls.length,
                1
            );
            await page
                .getByRole('button', { name: 'Release old response' })
                .click();
            assert.equal(await page.locator('li').count(), 0);
            await page.getByRole('button', { name: 'Load records' }).click();
            await page.getByText('rec_new', { exact: true }).waitFor();
            let state = await page.evaluate(() =>
                window.__nativeProbe.snapshot()
            );
            assert.equal(state.calls.length, 2);
            assert.equal(state.calls[1].input.searchTerm, 'new query');
            assert.equal(state.calls[1].input.airtableOffset, null);
            assert.deepEqual(state.state.page.recordIds, ['rec_new']);
            await page.getByRole('button', { name: 'Replace visitor' }).click();
            await page.getByRole('button', { name: 'Load records' }).click();
            state = await page.evaluate(() => window.__nativeProbe.snapshot());
            assert.equal(state.calls.length, 2);
            assert.equal(state.state.phase, 'retired');
        });
        for (const mode of ['session-off', 'session-on'])
            await run(mode, async (page, origin) => {
                await page.goto(`${origin}/native.html?mode=${mode}`);
                await page
                    .getByRole('button', { name: 'Login fake visitor' })
                    .click();
                await page
                    .getByRole('status')
                    .getByText('Fake session applied', { exact: true })
                    .waitFor();
                let state = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                assert.equal(state.sessionEntries, 1);
                assert.equal(state.calls.length, 0);
                assert.equal(
                    state.storageEntries,
                    mode === 'session-on' ? 1 : 0
                );
                assert(
                    !(
                        await page.evaluate(() => JSON.stringify(localStorage))
                    ).includes('FAKE_RAW_NOT_PERSISTED')
                );
                await page.reload();
                await page
                    .getByRole('button', { name: 'Restore fake visitor' })
                    .waitFor();
                state = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                assert.equal(state.sessionEntries, 0);
                assert.equal(state.calls.length, 0);
                await page
                    .getByRole('button', { name: 'Restore fake visitor' })
                    .click();
                await page
                    .getByRole('status')
                    .getByText(
                        mode === 'session-on'
                            ? 'Fresh fake load accepted'
                            : 'No remembered session',
                        { exact: true }
                    )
                    .waitFor();
                state = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                assert.equal(state.calls.length, mode === 'session-on' ? 1 : 0);
                if (mode === 'session-on') {
                    assert.equal(state.calls[0].credentialMatched, true);
                    assert.equal(state.sessionEntries, 1);
                }
                await page
                    .getByRole('button', { name: 'Logout fake visitor' })
                    .click();
                await page
                    .getByRole('status')
                    .getByText('Logged out', { exact: true })
                    .waitFor();
                assert.equal(
                    (await page.evaluate(() => window.__nativeProbe.snapshot()))
                        .storageEntries,
                    0
                );
                await page.reload();
                await page
                    .getByRole('button', { name: 'Restore fake visitor' })
                    .click();
                await page
                    .getByRole('status')
                    .getByText('No remembered session', { exact: true })
                    .waitFor();
                assert.equal(
                    (await page.evaluate(() => window.__nativeProbe.snapshot()))
                        .calls.length,
                    0
                );
            });
        assert.equal(results.length, 7);
        assert.deepEqual(network, []);
        report.status = 'passed';
    } catch (error) {
        report.status = 'failed';
        report.error = error.message;
        process.exitCode = 1;
        console.error(error);
    } finally {
        for (const [name, cleanup] of [
            [
                'browser',
                async () => {
                    if (browser) await browser.close();
                },
            ],
            [
                'server',
                async () => {
                    if (server) {
                        server.closeAllConnections();
                        await new Promise((resolve, reject) =>
                            server.close((error) =>
                                error ? reject(error) : resolve()
                            )
                        );
                    }
                },
            ],
            [
                'consumer',
                async () => {
                    if (temporary) {
                        rmSync(temporary, { recursive: true, force: true });
                        assert(!existsSync(temporary));
                    }
                },
            ],
        ]) {
            try {
                await cleanup();
                report.cleanup[name] =
                    (name === 'browser' && !browser) ||
                    (name === 'server' && !server) ||
                    (name === 'consumer' && !temporary)
                        ? 'not-started'
                        : 'completed';
            } catch (error) {
                report.cleanup[name] = { error: error.message };
                report.status = 'failed';
                process.exitCode = 1;
            }
        }
        writeFileSync(
            join(output, 'native-receipt.json'),
            JSON.stringify(report, null, 2) + '\n'
        );
        const members = readdirSync(output).sort();
        writeFileSync(
            join(output, 'SHA256SUMS'),
            members
                .map((name) => `${hash(regular(join(output, name)))}  ${name}`)
                .join('\n') + '\n'
        );
    }
} catch (error) {
    // Artifact validation failures have no consumer/browser/server to clean up.
    const failure = {
        schemaVersion: 1,
        status: 'failed',
        stage: 'artifact-preflight',
        node: process.version,
        error: error.message,
        cleanup: {
            consumer: 'not-started',
            browser: 'not-started',
            server: 'not-started',
        },
    };
    writeFileSync(
        join(output, 'native-receipt.json'),
        JSON.stringify(failure, null, 2) + '\n'
    );
    writeFileSync(
        join(output, 'SHA256SUMS'),
        `${hash(regular(join(output, 'native-receipt.json')))}  native-receipt.json\n`
    );
    console.error(error);
    process.exitCode = 1;
}
