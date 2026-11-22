import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, stop, transformSync } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';
import { checkedKit } from './check-portal-view-loss-ci.mjs';

const [commit, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    {
        encoding: 'utf8',
    }
)
    .trim()
    .split('\n');
const managed = process.argv.length === 3 && process.argv[2] === '--ci';
const kit = managed
    ? checkedKit(process.env, process.env.SDK_NATIVE_PACKAGE_DIR)
    : undefined;
const [archiveArg, sha256, outputArg, chromeArg] = kit
    ? [
          kit.archive,
          kit.package.sha256,
          process.env.SDK_NATIVE_RESULT_DIR,
          '/usr/bin/google-chrome',
      ]
    : process.argv.slice(2);
assert(
    archiveArg && /^[a-f0-9]{64}$/.test(sha256 ?? '') && outputArg && chromeArg,
    'Pass <archive> <sha256> <new output directory> <sandboxed Chromium executable>'
);
const archive = realpathSync(archiveArg);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const archiveBytes = readFileSync(archive);
assert.equal(sha(archiveBytes), sha256);
const readMember = createArchiveMemberReader({
    archivePath: archive,
    expectedSha256: sha256,
});
const source = readFileSync(
    new URL(
        './readonly-portal-grid-collaborators-fixture.mjs',
        import.meta.url
    ),
    'utf8'
);
const report = {
    source: { commit, tree, fixtureSha256: sha(source) },
    ...(kit && { ci: kit.ci }),
    package: { sha256, bytes: archiveBytes.length },
    chromiumSandbox: true,
    profiles: [],
    cleanup: {},
};
const output = resolve(outputArg);
mkdirSync(output);
const scratch = mkdtempSync(join(realpathSync(tmpdir()), 'sdk-grid-collab-'));
const cssNames = [
    'readonly-portal-grid.css',
    'field-presentation.css',
    'html-description.css',
    'complete-readonly-text.css',
    'complete-checkbox.css',
    'complete-collaborators.css',
];
const assets = new Map();
const server = createServer((request, response) => {
    const asset = request.method === 'GET' && assets.get(request.url);
    if (!asset) return response.writeHead(404).end();
    response.writeHead(200, {
        'Content-Type': asset.type,
        'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'",
    });
    response.end(asset.bytes);
});
const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Readonly Grid collaborator badges</title><link rel="icon" href="data:,"><link rel="stylesheet" href="readonly-portal-grid.css"><link rel="stylesheet" href="complete-collaborators.css"><button type="button" id="before">Before records</button><div id="grid"></div><script defer src="fixture.js"></script></html>';

async function prepare(directory, react, format) {
    const entry = format === 'esm' ? 'fixture.mjs' : 'fixture.cjs';
    writeFileSync(
        join(directory, entry),
        transformSync(source, { format, loader: 'js' }).code
    );
    const bundle = await build({
        absWorkingDir: directory,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        metafile: true,
        write: false,
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, directory);
    const sdk = realpathSync(
        join(directory, 'node_modules/@miniextensions/sdk')
    );
    const inputs = Object.keys(bundle.metafile.inputs).map((name) =>
        realpathSync(resolve(directory, name))
    );
    const expected = ['formulas', 'react', 'ui'].map(
        (surface) => `dist/${format}/${surface}/index.js`
    );
    for (const member of expected)
        assert(inputs.includes(join(sdk, member)), `Missing ${member}`);
    assert(
        !inputs.some((input) =>
            input.startsWith(
                join(sdk, 'dist', format === 'esm' ? 'cjs' : 'esm')
            )
        ),
        'Mixed SDK export modes'
    );
    const verified = [
        ...new Set(inputs.filter((path) => path.startsWith(sdk + '/'))),
    ];
    for (const path of verified) {
        assert.deepEqual(
            readFileSync(path),
            readMember(`package/${path.slice(sdk.length + 1)}`)
        );
    }
    const path = `/${react}-${format}/`;
    for (const name of cssNames) {
        const member = `dist/esm/react/${name}`;
        const content = readFileSync(join(sdk, member));
        assert.deepEqual(content, readMember(`package/${member}`));
        assets.set(path + name, { type: 'text/css', bytes: content });
    }
    const script = bundle.outputFiles[0].contents;
    assets.set(path, { type: 'text/html', bytes: html });
    assets.set(path + 'fixture.js', { type: 'text/javascript', bytes: script });
    return {
        react,
        format,
        path,
        sdkMembers: verified.length,
        bundleSha256: sha(script),
    };
}

const initialLabels = [
    'Zeta Person',
    'fallback@example.invalid',
    'Alpha Person',
    'Zeta Person',
];
const updatedLabels = [
    'fallback@example.invalid',
    'Zeta Person',
    'Zeta Person',
    'Alpha Person',
];
const recordIds = ['recTeam', 'recNull', 'recOmitted', 'recEmpty', 'recEmail'];
const titles = ['Team', 'Null', 'Omitted', 'Empty array', 'Email only'];
const idle = {
    opens: [],
    currentnessChecks: 0,
    requests: 0,
    writes: 0,
    submits: 0,
};
function verifyGrid(observation, react, republished, effects) {
    assert.equal(observation.react, react);
    assert.deepEqual(observation.effects, effects);
    assert.equal(observation.retained, 20);
    const ordered = recordIds.map((id, index) => [id, titles[index]]);
    if (republished) ordered.reverse();
    assert.deepEqual(
        observation.rows,
        ordered.map(([id, title]) => ({
            id,
            title,
            fields: ['fldName', 'fldTeam', 'fldNote'],
            note: `Keep ${title}`,
            badges:
                id === 'recTeam'
                    ? republished
                        ? updatedLabels
                        : initialLabels
                    : [],
            group: id === 'recTeam' ? 'Collaborators' : null,
            controls: 0,
            blank: id !== 'recTeam',
        }))
    );
}

async function verifyBrowser(browser, origin, profile) {
    const context = await browser.newContext({
        viewport: { width: 1250, height: 800 },
        serviceWorkers: 'block',
    });
    const errors = [];
    const refused = [];
    const requests = [];
    try {
        await context.route('**/*', (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (
                url.origin === origin &&
                url.pathname.startsWith(profile.path) &&
                !url.search &&
                request.method() === 'GET' &&
                assets.has(url.pathname)
            ) {
                requests.push(url.pathname);
                return route.continue();
            }
            refused.push([request.method(), url.origin, url.pathname]);
            return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin + profile.path);
        const row = page.locator('tr[data-record-id="recTeam"]');
        const team = row.locator('td[data-field-id="fldTeam"]');
        const group = team.getByRole('group', {
            name: 'Collaborators',
            exact: true,
        });
        await group.waitFor();
        const accessible = await group.ariaSnapshot();
        assert.match(accessible, /fallback@example\.invalid/);
        const initial = await page.evaluate(() =>
            window.collaboratorGrid.observe()
        );
        verifyGrid(initial, profile.react, false, idle);
        await page.evaluate(() => {
            window.collaboratorClicks = [];
            window.collaboratorOpenClicks = [];
            document.addEventListener(
                'click',
                (event) => {
                    const badge = event.target.closest(
                        '.mx-sdk-collaborator-name'
                    );
                    if (badge)
                        window.collaboratorClicks.push({
                            trusted: event.isTrusted,
                            label: badge.textContent,
                        });
                    const open = event.target.closest(
                        'button.mx-sdk-readonly-grid__open'
                    );
                    if (open)
                        window.collaboratorOpenClicks.push({
                            trusted: event.isTrusted,
                            recordId: open.closest('tr')?.dataset.recordId,
                        });
                },
                true
            );
        });
        await group.getByText('Zeta Person', { exact: true }).first().click();
        assert.equal(
            await team.evaluate((cell) =>
                cell.contains(document.activeElement)
            ),
            false
        );
        await page.keyboard.press('Enter');
        await page.keyboard.press('Space');
        const open = row.getByRole('button', {
            name: 'Open record Team',
            exact: true,
        });
        await page.locator('#before').focus();
        await page.keyboard.press('Tab');
        assert(
            await open.evaluate((button) => button === document.activeElement)
        );
        const inert = await page.evaluate(() =>
            window.collaboratorGrid.observe()
        );
        verifyGrid(inert, profile.react, false, idle);
        const pointer = await page.evaluate(() => window.collaboratorClicks);
        assert.deepEqual(pointer, [{ trusted: true, label: 'Zeta Person' }]);
        await page.evaluate(() => window.collaboratorGrid.republish());
        const republished = await page.evaluate(() =>
            window.collaboratorGrid.observe()
        );
        verifyGrid(republished, profile.react, true, idle);
        await open.focus();
        await page.keyboard.press('Enter');
        const activation = await page.evaluate(() =>
            window.collaboratorGrid.observe()
        );
        verifyGrid(activation, profile.react, true, {
            ...idle,
            opens: [{ action: 'open-row', recordId: 'recTeam' }],
        });
        const openClicks = await page.evaluate(
            () => window.collaboratorOpenClicks
        );
        assert.deepEqual(openClicks, [{ trusted: true, recordId: 'recTeam' }]);
        const teardown = await page.evaluate(() =>
            window.collaboratorGrid.dispose()
        );
        assert.deepEqual(teardown, { listeners: 0, children: 0 });
        assert.deepEqual(errors, []);
        assert.deepEqual(refused, []);
        assert(
            cssNames.every((name) => requests.includes(profile.path + name))
        );
        Object.assign(profile, {
            status: 'passed',
            initial,
            pointer,
            openClicks,
            republished,
            activation,
            teardown,
            accessible,
        });
    } finally {
        profile.network = { errors, refused, requests };
        await context.close();
        profile.contextClosed = true;
    }
}

let browser;
try {
    for (const react of ['18.3.1', '19.2.0']) {
        const directory = join(scratch, react);
        mkdirSync(directory);
        writeFileSync(
            join(directory, 'package.json'),
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
            directory,
            args: ['install', '--ignore-scripts'],
        });
        assert.equal(installation.archiveSha256, sha256);
        for (const format of ['esm', 'cjs']) {
            report.profiles.push(await prepare(directory, react, format));
        }
    }
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
        executablePath: realpathSync(chromeArg),
        headless: true,
        chromiumSandbox: true,
    });
    report.browser = browser.version();
    for (const profile of report.profiles)
        await verifyBrowser(browser, origin, profile);
    assert.equal(sha(readFileSync(archive)), sha256);
} catch (error) {
    report.failure = error.message;
    throw error;
} finally {
    try {
        if (browser) await browser.close();
        report.cleanup.browser = browser ? 'closed' : 'not-started';
    } finally {
        try {
            if (server.listening) {
                await new Promise((resolveClose, rejectClose) =>
                    server.close((error) =>
                        error ? rejectClose(error) : resolveClose()
                    )
                );
            }
            report.cleanup.loopbackClosed = !server.listening;
            await stop();
            report.cleanup.esbuildStopped = true;
        } finally {
            rmSync(scratch, { recursive: true, force: true });
            report.cleanup.scratchRemoved = !existsSync(scratch);
            writeFileSync(
                join(output, 'report.json'),
                JSON.stringify(report, null, 2) + '\n'
            );
        }
    }
}
