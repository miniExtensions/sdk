// Local usage: node scripts/check-readonly-portal-grid-phone.mjs <tgz> <sha256> <new results dir> <chromium>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { build, stop, transformSync } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import { checkedKit } from './check-portal-view-loss-ci.mjs';
import { assertBrowserInputs } from './package-checks.mjs';

const args = process.argv.slice(2);
const managed = args.length === 1 && args[0] === '--ci';
if (managed) {
    assert.equal(process.env.GITHUB_ACTIONS, 'true');
    assert.equal(process.platform, 'linux');
    for (const name of [
        'SDK_NATIVE_PACKAGE_DIR',
        'SDK_NATIVE_RESULT_DIR',
        'SDK_NATIVE_SCRATCH_DIR',
    ])
        assert(isAbsolute(process.env[name] ?? ''), `Missing absolute ${name}`);
}
const kit = managed
    ? checkedKit(process.env, process.env.SDK_NATIVE_PACKAGE_DIR)
    : null;
const [archiveArg, expectedSha256, outputArg, chromeArg] = managed
    ? [
          kit.archive,
          kit.package.sha256,
          process.env.SDK_NATIVE_RESULT_DIR,
          '/usr/bin/google-chrome',
      ]
    : args;
assert(
    archiveArg &&
        outputArg &&
        chromeArg &&
        /^[a-f0-9]{64}$/.test(expectedSha256 ?? '')
);
const archive = realpathSync(archiveArg);
const executablePath = realpathSync(chromeArg);
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
assert.equal(sha256(readFileSync(archive)), expectedSha256);
const fixture = readFileSync(
    new URL('./readonly-portal-grid-phone-fixture.mjs', import.meta.url),
    'utf8'
);
const [commit, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    { encoding: 'utf8' }
)
    .trim()
    .split('\n');
const output = resolve(outputArg);
mkdirSync(output);
const scratch = managed
    ? process.env.SDK_NATIVE_SCRATCH_DIR
    : realpathSync(tmpdir());
mkdirSync(scratch, { recursive: true });
assert.equal(realpathSync(scratch), scratch);
const temporary = mkdtempSync(join(scratch, 'sdk-grid-phone-'));
const report = {
    source: { commit, tree, fixtureSha256: sha256(fixture) },
    ...(kit && { ci: kit.ci }),
    packageSha256: expectedSha256,
    chromiumSandbox: true,
    profiles: [],
    cleanup: {},
};
const assets = new Map();
const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Installed Phone Grid</title><link rel="icon" href="data:,"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script defer src="fixture.js"></script>';
const server = createServer((request, response) => {
    const asset = request.method === 'GET' && assets.get(request.url);
    if (!asset) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, {
        'Content-Type': asset.type,
        'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    response.end(asset.body);
});

async function prepare(react, format, consumer) {
    const entry = format === 'esm' ? 'fixture.mjs' : 'fixture.cjs';
    writeFileSync(
        join(consumer, entry),
        transformSync(fixture, { format, loader: 'js' }).code
    );
    const bundle = await build({
        absWorkingDir: consumer,
        entryPoints: [entry],
        outfile: 'fixture.js',
        bundle: true,
        write: false,
        metafile: true,
        platform: 'browser',
        format: 'iife',
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, consumer);
    const sdkPrefix = 'node_modules/@miniextensions/sdk/dist/';
    const inputs = Object.keys(bundle.metafile.inputs).filter((input) =>
        input.startsWith(sdkPrefix)
    );
    for (const name of ['react', 'ui'])
        assert(inputs.includes(`${sdkPrefix}${format}/${name}/index.js`));
    // Both module formats use the same public stylesheets.
    const alternate = `${sdkPrefix}${format === 'esm' ? 'cjs' : 'esm'}/`;
    assert.deepEqual(
        inputs.filter(
            (path) => path.startsWith(alternate) && path.endsWith('.js')
        ),
        []
    );
    for (const name of ['complete-phone.css', 'readonly-portal-grid.css'])
        assert(inputs.some((path) => path.endsWith(`/react/${name}`)));
    const path = `/${react}-${format}/`;
    assets.set(path, {
        body: html,
        type: 'text/html',
        resourceType: 'document',
    });
    for (const file of bundle.outputFiles) {
        const script = file.path.endsWith('.js');
        assets.set(path + (script ? 'fixture.js' : 'fixture.css'), {
            body: file.contents,
            type: script ? 'text/javascript' : 'text/css',
            resourceType: script ? 'script' : 'stylesheet',
        });
    }
    return path;
}

const noActions = { opens: [], edits: 0, writes: 0, submits: 0, hostClicks: 0 };
const first = '+1 (202) 555-0103';
const second = '(202) 555-0117 ext. 34';
const changed = '+1 202 555 0120 ext. 7';
const expectedCall = (record, value, detail) => ({
    href: `tel:${value}`,
    record,
    detail,
    trusted: true,
    prevented: true,
});

async function measure(browser, origin, path, profile) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const requests = [];
    const pageErrors = [];
    profile.refused = [];
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                url.origin === origin &&
                url.pathname.startsWith(path) &&
                !url.search &&
                request.method() === 'GET' &&
                request.resourceType() ===
                    assets.get(url.pathname)?.resourceType
            ) {
                requests.push(url.pathname);
                return route.continue();
            }
            profile.refused.push([request.method(), request.url()]);
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await page.goto(origin + path);
        const grid = page.getByRole('table', { name: 'Records' });
        const row = (record) => grid.locator(`tr[data-record-id="${record}"]`);
        const cell = (record, field) =>
            row(record).locator(`td[data-field-id="${field}"]`);
        const link = (record) => cell(record, 'fldPhone').getByRole('link');
        const capture = () => page.evaluate(() => window.phoneGrid.observe());
        const verifyPhone = async (record, value) => {
            const anchor = link(record);
            await anchor.waitFor({ state: 'visible' });
            assert.equal(await anchor.getAttribute('href'), `tel:${value}`);
            assert.equal(await anchor.textContent(), value);
        };
        const verifyBlanks = async () => {
            for (const record of ['recFirst', 'recSecond']) {
                for (const field of ['fldCleared', 'fldOmitted']) {
                    const blank = cell(record, field);
                    assert.equal(await blank.textContent(), '');
                    assert.equal(await blank.getByRole('link').count(), 0);
                }
            }
            assert.equal(
                await grid
                    .locator(
                        'input, select, textarea, [contenteditable="true"]'
                    )
                    .count(),
                0
            );
        };
        await verifyPhone('recFirst', first);
        await verifyPhone('recSecond', second);
        await verifyBlanks();
        assert.equal(
            await cell('recFirst', 'fldTitle').getAttribute('data-primary'),
            'true'
        );
        assert.equal(
            await cell('recFirst', 'fldTitle').textContent(),
            'First contact'
        );
        profile.initial = await capture();
        assert.equal(profile.initial.react, profile.react);
        assert.deepEqual(profile.initial.actions, noActions);
        assert.deepEqual(profile.initial.calls, []);
        assert(
            profile.initial.records.every(
                ({ fields }) =>
                    fields.fldCleared === null &&
                    !Object.hasOwn(fields, 'fldOmitted')
            )
        );

        await link('recFirst').click();
        profile.pointer = await capture();
        assert.deepEqual(profile.pointer.calls, [
            expectedCall('recFirst', first, 1),
        ]);
        assert.deepEqual(profile.pointer.actions, noActions);
        await link('recSecond').focus();
        assert.equal(
            await link('recSecond').evaluate(
                (anchor) => anchor === document.activeElement
            ),
            true
        );
        await page.keyboard.press('Enter');
        profile.keyboard = await capture();
        const originalCalls = [
            expectedCall('recFirst', first, 1),
            expectedCall('recSecond', second, 0),
        ];
        assert.deepEqual(profile.keyboard.calls, originalCalls);
        assert.deepEqual(profile.keyboard.actions, noActions);

        await page.evaluate((value) => window.phoneGrid.renew(value), changed);
        await cell('recFirst', 'fldPhone')
            .getByRole('link', { name: changed, exact: true })
            .waitFor();
        await verifyPhone('recFirst', changed);
        await verifyPhone('recSecond', second);
        await verifyBlanks();
        await link('recFirst').click();
        profile.republished = await capture();
        assert(profile.republished.revision > profile.initial.revision);
        assert.deepEqual(profile.republished.calls, [
            ...originalCalls,
            expectedCall('recFirst', changed, 1),
        ]);
        assert.deepEqual(profile.republished.actions, noActions);

        await row('recFirst')
            .getByRole('button', {
                name: 'Open record First contact',
                exact: true,
            })
            .click();
        profile.opened = await capture();
        assert.deepEqual(profile.opened.actions, {
            ...noActions,
            opens: ['recFirst'],
        });
        assert.deepEqual(profile.opened.calls, profile.republished.calls);
        assert.equal(await grid.locator('[aria-selected="true"]').count(), 0);
        assert.equal(page.url(), origin + path);
        assert.equal(context.pages().length, 1);
        assert.deepEqual(requests.sort(), [
            path,
            path + 'fixture.css',
            path + 'fixture.js',
        ]);
        assert.deepEqual(profile.refused, []);
        assert.deepEqual(pageErrors, []);
        profile.cleanup = await page.evaluate(() => window.phoneGrid.dispose());
        assert.deepEqual(profile.cleanup, {
            afterUnmount: 1,
            afterDestroy: 0,
            rows: 0,
        });
    } finally {
        profile.pageErrors = pageErrors;
        await context.close();
        profile.contextClosed = !browser.contexts().includes(context);
    }
}

let browser;
try {
    await new Promise((ready, reject) =>
        server.listen(0, '127.0.0.1', ready).once('error', reject)
    );
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath, chromiumSandbox: true });
    report.chromium = browser.version();
    for (const react of ['18.3.1', '19.2.0']) {
        const consumer = join(temporary, react);
        mkdirSync(consumer);
        writeFileSync(
            join(consumer, 'package.json'),
            JSON.stringify({
                private: true,
                dependencies: {
                    '@miniextensions/sdk': `file:${archive}`,
                    react,
                    'react-dom': react,
                },
            })
        );
        const installation = installAgeQualifiedConsumer({
            directory: consumer,
            args: ['install', '--ignore-scripts'],
        });
        assert.equal(installation.archiveSha256, expectedSha256);
        for (const format of ['esm', 'cjs']) {
            const profile = { react, format };
            report.profiles.push(profile);
            const path = await prepare(react, format, consumer);
            await measure(browser, origin, path, profile);
            assert.equal(profile.contextClosed, true);
        }
    }
    report.outcome = 'passed';
} catch (error) {
    report.outcome = 'failed';
    report.error = error.stack;
    throw error;
} finally {
    try {
        await browser?.close();
        report.cleanup.browserClosed = !browser?.isConnected();
    } finally {
        await new Promise((done) => server.close(done));
        report.cleanup.serverClosed = !server.listening;
        await stop();
        rmSync(temporary, { recursive: true, force: true });
        report.cleanup.consumerRemoved = true;
        writeFileSync(
            join(output, 'result.json'),
            JSON.stringify(report, null, 2) + '\n'
        );
    }
}
