// Standalone installed Grid witness. Pass --serve to use an existing browser
// on this isolated loopback fixture. Otherwise pass the Chromium executable.
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
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { build, stop, transformSync } from 'esbuild';
import { chromium } from 'playwright';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

const [archiveArg, archiveSha, outputArg, browserArg, ...requested] =
    process.argv.slice(2);
assert(
    archiveArg && outputArg && browserArg,
    'Expected archive, SHA-256, new output directory and Chromium executable or --serve'
);
assert.match(archiveSha, /^[0-9a-f]{64}$/);
const supported = ['18.3.1-esm', '18.3.1-cjs', '19.2.0-esm', '19.2.0-cjs'];
const selected = requested.length ? requested : supported;
assert.equal(new Set(selected).size, selected.length);
assert(
    selected.every((id) => supported.includes(id)),
    'Unknown React/module profile'
);
const archive = realpathSync(archiveArg);
const output = resolve(outputArg);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const archiveBytes = readFileSync(archive);
assert.equal(digest(archiveBytes), archiveSha);
const readArchive = createArchiveMemberReader({
    archivePath: archive,
    expectedSha256: archiveSha,
});
const fixture = readFileSync(
    new URL('./readonly-portal-grid-percent-fixture.mjs', import.meta.url),
    'utf8'
);
const [commit, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    { encoding: 'utf8' }
)
    .trim()
    .split('\n');
mkdirSync(output);
const managedScratch = process.env.SDK_PORTAL_PERCENT_SCRATCH_ROOT;
if (managedScratch) {
    assert(
        isAbsolute(managedScratch),
        'Absolute Percent scratch root required'
    );
    assert.equal(
        realpathSync(dirname(managedScratch)),
        dirname(managedScratch)
    );
    mkdirSync(managedScratch, { recursive: true });
    assert.equal(realpathSync(managedScratch), managedScratch);
}
const temporary = realpathSync(
    mkdtempSync(join(managedScratch ?? tmpdir(), 'sdk-portal-grid-percent-'))
);
if (managedScratch)
    Object.assign(process.env, {
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
        XDG_CACHE_HOME: join(temporary, 'cache'),
        XDG_CONFIG_HOME: join(temporary, 'config'),
        npm_config_cache: join(temporary, 'npm-cache'),
    });
const profiles = new Map();
const consumers = new Map();
const assets = new Map();
const report = {
    source: { checkout: commit, tree, fixtureSha256: digest(fixture) },
    archive: { sha256: archiveSha, bytes: archiveBytes.length },
    scratch: managedScratch ? 'managed' : 'system temporary directory',
    profiles: [],
    cleanup: {},
};
const cssMembers = ['readonly-portal-grid.css', 'localized-numeric.css'].map(
    (name) => `dist/esm/react/${name}`
);
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Installed readonly Percent Grid</title>
    <link rel="stylesheet" href="proof.css"><h1>Installed readonly Percent Grid</h1>
    <div id="grid"></div><button id="republish">Republish Grid</button>
    <button id="dispose">Dispose Grid</button><pre id="receipt"></pre><script defer src="proof.js"></script></html>`;
const server = createServer((req, res) => {
    const item = assets.get(req.url);
    if (req.method !== 'GET' || !item) return res.writeHead(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'"
    );
    res.setHeader('Content-Type', item.type);
    res.end(item.bytes);
});
async function buildProfile(id) {
    const [react, format] = id.split('-');
    let installed = consumers.get(react);
    if (!installed) {
        const path = join(temporary, react);
        mkdirSync(path);
        writeFileSync(
            join(path, 'package.json'),
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
            directory: path,
            args: ['install', '--ignore-scripts'],
        });
        assert.equal(installation.archiveSha256, archiveSha);
        for (const peer of ['react', 'react-dom']) {
            const manifest = JSON.parse(
                readFileSync(
                    join(path, 'node_modules', peer, 'package.json'),
                    'utf8'
                )
            );
            assert.equal(manifest.version, react, `${peer} version`);
        }
        installed = { path, installation };
        consumers.set(react, installed);
    }
    const { path, installation } = installed;
    const entry = `fixture-${format}.${format === 'esm' ? 'mjs' : 'cjs'}`;
    writeFileSync(
        join(path, entry),
        transformSync(fixture, { format, loader: 'js', target: 'es2022' }).code
    );
    const bundle = await build({
        entryPoints: [entry],
        absWorkingDir: path,
        bundle: true,
        platform: 'browser',
        format: 'iife',
        metafile: true,
        write: false,
    });
    await assertBrowserInputs(bundle.metafile, path);
    const installedSdk = join(path, 'node_modules/@miniextensions/sdk');
    const inputs = Object.keys(bundle.metafile.inputs).map((input) =>
        realpathSync(resolve(path, input))
    );
    const entries = ['react', 'ui'].map(
        (part) => `dist/${format}/${part}/index.js`
    );
    for (const member of entries) {
        assert(
            inputs.includes(realpathSync(join(installedSdk, member))),
            `Bundle did not resolve ${member}`
        );
        assert.deepEqual(
            readFileSync(join(installedSdk, member)),
            readArchive(`package/${member}`)
        );
    }
    const other = format === 'esm' ? 'cjs' : 'esm';
    assert(
        !inputs.some((input) =>
            input.startsWith(join(realpathSync(installedSdk), `dist/${other}/`))
        ),
        'Mixed SDK export conditions'
    );
    const styles = Buffer.concat(
        cssMembers.map((member) => {
            const bytes = readFileSync(join(installedSdk, member));
            assert.deepEqual(bytes, readArchive(`package/${member}`));
            return bytes;
        })
    );
    const content = bundle.outputFiles[0].contents;
    const pathPrefix = `/${id}/`;
    assets.set(pathPrefix, { type: 'text/html; charset=utf-8', bytes: html });
    assets.set(pathPrefix + 'proof.js', {
        type: 'text/javascript',
        bytes: content,
    });
    assets.set(pathPrefix + 'proof.css', { type: 'text/css', bytes: styles });
    const profile = {
        id,
        react,
        format,
        installation,
        entries,
        cssMembers,
        cssSha256: digest(styles),
        bundleSha256: digest(content),
    };
    profiles.set(id, profile);
    report.profiles.push(profile);
    writeReport();
    console.log(
        JSON.stringify({
            installed: id,
            archiveSha256: archiveSha,
            receipt: `${output}/report.json`,
        })
    );
}
function writeReport() {
    writeFileSync(
        join(output, 'report.json'),
        JSON.stringify(report, null, 2) + '\n'
    );
}
async function verifyIdleGrid(page, after) {
    const controls = page.locator(
        '#grid :is(input, button, textarea, select, a[href], [role="button"], [role="link"], [contenteditable="true"], [aria-selected="true"]), dialog[open], [role="dialog"], [role="menu"], [aria-modal="true"]'
    );
    assert.equal(
        await controls.count(),
        0,
        `Interactive controls after ${after}`
    );
    const focus = await page.evaluate(() => {
        if (document.activeElement === document.body) return 'page';
        if (document.activeElement?.matches('td[data-field-id="fldProgress"]'))
            return 'percent cell';
        return 'unexpected';
    });
    assert.notEqual(focus, 'unexpected', `Focus moved after ${after}`);
    return { after, controls: 0, focus };
}
async function verifyBrowser(origin) {
    const browser = await chromium.launch({
        executablePath: realpathSync(browserArg),
        headless: true,
        chromiumSandbox: true,
    });
    report.browser = browser.version();
    try {
        for (const [id, profile] of profiles) {
            const context = await browser.newContext({
                viewport: { width: 1000, height: 760 },
                serviceWorkers: 'block',
            });
            const unexpected = [],
                errors = [];
            try {
                await context.route('**/*', (route) => {
                    const request = route.request();
                    const url = new URL(request.url());
                    if (
                        url.origin === origin &&
                        request.method() === 'GET' &&
                        assets.has(url.pathname) &&
                        !['fetch', 'xhr'].includes(request.resourceType())
                    )
                        return route.continue();
                    unexpected.push({
                        method: request.method(),
                        path: url.pathname,
                    });
                    return route.abort();
                });
                const page = await context.newPage();
                page.on('pageerror', (error) => errors.push(error.message));
                await page.goto(`${origin}/${id}/`);
                const receipt = async () =>
                    JSON.parse(await page.locator('#receipt').textContent());
                await page
                    .locator('tbody tr[data-record-id="recMixed"]')
                    .waitFor();
                assert.equal(
                    await page
                        .getByRole('columnheader', {
                            name: 'Progress',
                            exact: true,
                        })
                        .count(),
                    1
                );
                assert.equal(
                    await page
                        .getByRole('columnheader', {
                            name: 'Percent',
                            exact: true,
                        })
                        .count(),
                    1
                );
                const knownCells = page.getByRole('cell', {
                    name: '42,50%',
                    exact: true,
                });
                assert.equal(await knownCells.count(), 2);
                const interactionCheckpoints = [];
                await knownCells.first().click();
                interactionCheckpoints.push(
                    await verifyIdleGrid(page, 'click')
                );
                await page.keyboard.press('Enter');
                interactionCheckpoints.push(
                    await verifyIdleGrid(page, 'Enter')
                );
                await page.keyboard.press('Escape');
                interactionCheckpoints.push(
                    await verifyIdleGrid(page, 'Escape')
                );
                await page
                    .getByRole('button', {
                        name: 'Republish Grid',
                        exact: true,
                    })
                    .click();
                await page.screenshot({
                    path: join(output, `${id}.png`),
                    fullPage: true,
                });
                await page
                    .getByRole('button', { name: 'Dispose Grid', exact: true })
                    .click();
                profile.browser = await receipt();
                assert.equal(profile.browser.react, profile.react);
                assert.equal(profile.browser.error, null);
                assert(
                    profile.browser.initial &&
                        profile.browser.republished &&
                        profile.browser.disposed
                );
                assert.deepEqual(unexpected, []);
                assert.deepEqual(errors, []);
                profile.browser.interactionCheckpoints = interactionCheckpoints;
                profile.status = 'passed';
            } finally {
                await context.close();
            }
        }
    } finally {
        await browser.close();
    }
}
try {
    await new Promise((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(0, '127.0.0.1', resolveListen);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    writeFileSync(join(output, 'origin.txt'), origin + '\n');
    console.log(`${origin} (PID ${process.pid})`);
    for (const id of selected) await buildProfile(id);
    if (browserArg === '--serve') {
        await new Promise((resolveStop) => {
            process.once('SIGINT', resolveStop);
            process.once('SIGTERM', resolveStop);
        });
    } else {
        await verifyBrowser(origin);
    }
} finally {
    await new Promise((resolveClose) => {
        server.close(resolveClose);
        server.closeAllConnections();
    });
    report.cleanup.loopback = 'closed';
    await stop();
    rmSync(temporary, { recursive: true });
    report.cleanup.temporaryConsumers = 'removed';
    writeReport();
}
