// Dedicated installed-package real-Chromium proof; no hosted settings or live Saves.
// Usage: node scripts/check-linked-child-review-browser.mjs [fresh-output-directory]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    realpathSync,
    rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const output = process.argv[2]
    ? resolve(process.argv[2])
    : mkdtempSync(join(tmpdir(), 'sdk-child-review-browser-'));
if (process.argv[2]) mkdirSync(output);
const run = (cmd, args, cwd = root) =>
    execFileSync(cmd, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
const report = {
    scope: 'Installed SDK, real Chromium, synthetic backend only; not persistence evidence',
    head: run('git', ['rev-parse', 'HEAD']).trim(),
    tree: run('git', ['rev-parse', 'HEAD^{tree}']).trim(),
    status: run('git', ['status', '--porcelain']),
    cases: [],
};
let browser;
let server;
try {
    run('pnpm', ['build']);
    const packed = JSON.parse(
        run('npm', [
            'pack',
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            output,
        ])
    )[0];
    const archive = join(output, packed.filename);
    report.packageSha256 = createHash('sha256')
        .update(readFileSync(archive))
        .digest('hex');
    const consumer = join(output, 'consumer');
    mkdirSync(consumer);
    writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({
            private: true,
            type: 'module',
            dependencies: { '@miniextensions/sdk': `file:${archive}` },
        })
    );
    run(
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
        consumer
    );
    await build({
        entryPoints: [join(root, 'test/formLinkedChildFixtures.ts')],
        bundle: true,
        platform: 'node',
        format: 'esm',
        outfile: join(output, 'fixtures.mjs'),
    });
    const fixtures = await import(pathToFileURL(join(output, 'fixtures.mjs')));
    const child = (record) => {
        const f = fixtures.pagedChildForm(record);
        f.payload.publicFields.state.promptUserBeforeSubmission = true;
        return f;
    };
    const source = readFileSync(
        join(root, 'scripts/linked-child-review-browser-fixture.mjs'),
        'utf8'
    );
    writeFileSync(join(consumer, 'proof.mjs'), source);
    const bundle = await build({
        entryPoints: [join(consumer, 'proof.mjs')],
        bundle: true,
        platform: 'browser',
        format: 'esm',
        metafile: true,
        outfile: join(output, 'proof.js'),
        define: {
            __FIXTURES__: JSON.stringify({
                parent: fixtures.parentForm('edit'),
                create: child(),
                edit: child('rec_existing'),
                saved: fixtures.childSaved('edit'),
                validation: fixtures.validationError,
            }),
        },
    });
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    const sdkInputs = Object.keys(bundle.metafile.inputs).filter((p) =>
        p.includes('/sdk/dist/')
    );
    assert(sdkInputs.length > 0);
    for (const input of sdkInputs)
        assert(realpathSync(resolve(root, input)).startsWith(installed + '/'));
    report.installedSdkInputs = sdkInputs;
    const buttons = (ids) =>
        ids.map((id) => `<button id="${id}">${id}</button>`).join('');
    const html = `<!doctype html><title>Linked-child Review synthetic proof</title><style>body{font:16px system-ui;margin:32px}dialog{max-width:720px;border:1px solid #777;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{margin:4px;padding:6px}label{display:block;margin:12px 0}label[hidden]{display:none}</style><main><h1>Synthetic child adapter acceptance</h1><label id="row-title">Child title <input id="title"></label><label id="row-note">Second answer <input id="note"></label><label id="row-last">Last answer <input id="last"></label>${buttons(['open', 'next', 'back', 'save', 'retry', 'invalidate', 'retained-confirm'])}<output id="status"></output><dialog><h2>Review child</h2><pre id="answers"></pre>${buttons(['confirm', 'edit', 'cancel', 'close', 'retire', 'stale', 'reentrant', 'parent-edit'])}</dialog></main><script type="module" src="/proof.js"></script>`;
    writeFileSync(join(output, 'index.html'), html);
    server = createServer((req, res) => {
        res.setHeader(
            'Content-Type',
            req.url === '/proof.js' ? 'text/javascript' : 'text/html'
        );
        res.end(
            req.url === '/proof.js'
                ? readFileSync(join(output, 'proof.js'))
                : html
        );
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
        executablePath: process.env.SDK_NATIVE_CHROMIUM ?? '/usr/bin/chromium',
        headless: true,
        chromiumSandbox: process.env.SDK_CHILD_REVIEW_NO_SANDBOX !== '1',
    });
    report.chromium = browser.version();
    report.chromiumSandbox = process.env.SDK_CHILD_REVIEW_NO_SANDBOX !== '1';
    for (const edit of [false, true]) {
        for (const scenario of [
            'success-one',
            'success-multi',
            'edit',
            'cancel',
            'escape',
            'close',
            'retire',
            'stale',
            'reentrant',
            'validation',
            'backend-validation',
            'unknown',
        ]) {
            const page = await browser.newPage();
            page.setDefaultTimeout(10000);
            const errors = [];
            const unexpectedRequests = [];
            page.on('pageerror', (error) => errors.push(String(error)));
            await page.route('**/*', (route) =>
                route
                    .request()
                    .url()
                    .startsWith(origin + '/')
                    ? route.continue()
                    : (unexpectedRequests.push(route.request().url()),
                      route.abort())
            );
            await page.goto(
                `${origin}/?edit=${edit}&multipage=${scenario !== 'success-one'}&scenario=${scenario}`
            );
            await page.locator('#open').click();
            await page.waitForFunction(() => window.opened);
            await page.locator('#title').fill('Mounted child edit');
            await page.locator('#title').press('Tab');
            if (scenario !== 'success-one')
                assert(await page.locator('#save').isDisabled());
            while (await page.locator('#next').isEnabled())
                await page.locator('#next').click();
            if (scenario === 'validation')
                await page.locator('#invalidate').click();
            await page.locator('#save').click();
            await page.locator('dialog[open]').waitFor();
            assert((await page.locator('#answers').textContent()).length > 0);
            assert.equal(
                (await page.evaluate(() => window.proof())).saves.length,
                0
            );
            if (scenario.startsWith('success')) {
                await page.locator('#parent-edit').click();
                await page.screenshot({
                    path: join(
                        output,
                        `${edit ? 'edit' : 'create'}-${scenario}.png`
                    ),
                });
                await page.locator('#confirm').click();
            } else if (scenario === 'escape')
                await page.keyboard.press('Escape');
            else if (
                ['validation', 'backend-validation', 'unknown'].includes(
                    scenario
                )
            )
                await page.locator('#confirm').click();
            else await page.locator(`#${scenario}`).click();
            await page.waitForFunction(() => window.proof().settled === 1);
            if (scenario === 'stale') {
                const cancelled = await page.evaluate(() => window.proof());
                assert.equal(cancelled.aborted, true);
                assert.equal(cancelled.lateConfirmDeliveries, 0);
                await page.locator('#retained-confirm').click();
                // Let the resolved adapter promise drain after the SDK's abort won.
                await page.evaluate(
                    () => new Promise((resolve) => setTimeout(resolve, 0))
                );
            }
            const actual = await page.evaluate(() => window.proof());
            if (scenario === 'stale') {
                assert.equal(actual.lateConfirmDeliveries, 1);
                assert.equal(actual.lateGuardCalls, 0);
                assert.deepEqual(actual.events, [
                    { event: 'review-aborted' },
                    { event: 'save-settled' },
                    { event: 'late-confirm-delivered', aborted: true },
                ]);
            }
            assert.equal(
                actual.reconciledTransitions,
                scenario.startsWith('success') ? 1 : 0
            );
            assert.deepEqual(errors, []);
            assert.deepEqual(unexpectedRequests, []);
            assert.deepEqual(actual.errors, []);
            const dispatch =
                scenario.startsWith('success') ||
                ['backend-validation', 'unknown'].includes(scenario);
            assert.equal(actual.saves.length, dispatch ? 1 : 0);
            assert.equal(actual.begins, dispatch ? 1 : 0);
            if (scenario.startsWith('success')) {
                assert.equal(actual.completion, 'reconciled');
                assert.equal(actual.parent.fld_title, 'Unrelated parent edit');
                assert.equal(
                    actual.saves[0].formRecord.data.fld_title,
                    'Mounted child edit'
                );
                assert.deepEqual(
                    actual.parent.fld_children_a,
                    edit
                        ? ['rec_existing', 'rec_existing', 'rec_sibling']
                        : [
                              'rec_existing',
                              'rec_existing',
                              'rec_sibling',
                              'rec_created',
                          ]
                );
                await page.locator('#retry').click();
                await page.waitForFunction(() => window.proof().settled === 2);
                assert.equal(
                    (await page.evaluate(() => window.proof())).saves.length,
                    1
                );
                assert.equal(
                    (await page.evaluate(() => window.proof()))
                        .reconciledTransitions,
                    scenario.startsWith('success') ? 1 : 0
                );
            } else {
                assert.equal(actual.completion, 'none');
                assert.deepEqual(actual.parent.fld_children_a, [
                    'rec_existing',
                    'rec_existing',
                    'rec_sibling',
                ]);
            }
            if (scenario === 'unknown') {
                assert.equal(actual.phase, 'unknown');
                await page.locator('#retry').click();
                await page.waitForFunction(() => window.proof().settled === 2);
                assert.equal(
                    (await page.evaluate(() => window.proof())).saves.length,
                    1
                );
                assert.equal(
                    (await page.evaluate(() => window.proof()))
                        .reconciledTransitions,
                    scenario.startsWith('success') ? 1 : 0
                );
            }
            if (['close', 'retire'].includes(scenario))
                assert.equal(actual.aborted, true);
            if (
                ['edit', 'cancel', 'escape', 'backend-validation'].includes(
                    scenario
                )
            )
                assert.equal(actual.phase, 'ready');
            report.cases.push({ edit, scenario, ...actual });
            console.log(`${edit ? 'Edit' : 'Create'} ${scenario}: passed`);
            await page.close();
        }
    }
    report.passed = true;
} catch (error) {
    report.error = String(error.stack ?? error);
    process.exitCode = 1;
} finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    writeFileSync(
        join(output, 'evidence.json'),
        JSON.stringify(report, null, 2)
    );
    rmSync(join(output, 'consumer'), { recursive: true, force: true });
    console.log(`Evidence: ${join(output, 'evidence.json')}`);
    if (report.error) console.error(report.error);
}
