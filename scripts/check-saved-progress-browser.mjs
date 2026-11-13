import ts from 'typescript';
// Installed SDK, local real Chrome, synthetic storage/locks. Never native acceptance.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    cpSync,
    mkdtempSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { assertBrowserInputs } from './package-checks.mjs';

const output = resolve(process.argv[2] ?? 'dist/saved-progress-browser');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'sdk-progress-browser-'));
const run = (args, cwd = temporary) =>
    execFileSync('npm', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
    });
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = {
    scope: 'Installed public SDK and local Chrome; synthetic storage/locks only, not native Form acceptance',
    host: hostname(),
    head: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
    }).trim(),
    profiles: [],
};
let browser, server;
try {
    let archive;
    if (process.env.SDK_NATIVE_PACKAGE_DIR) {
        const root = resolve(process.env.SDK_NATIVE_PACKAGE_DIR);
        const names = readdirSync(root).filter((name) => name.endsWith('.tgz'));
        assert.equal(names.length, 1);
        archive = join(root, names[0]);
        const receipt = JSON.parse(
            readFileSync(join(root, 'artifact-receipt.json'))
        );
        assert.equal(digest(readFileSync(archive)), receipt.package.sha256);
    } else {
        const packed = JSON.parse(
            run(
                [
                    'pack',
                    '--ignore-scripts',
                    '--json',
                    '--pack-destination',
                    temporary,
                ],
                process.cwd()
            )
        )[0];
        archive = join(temporary, packed.filename);
    }
    report.packageSha256 = digest(readFileSync(archive));
    const assets = new Map();
    const html =
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Saved progress synthetic consumer</title><link rel="stylesheet" href="/main.css"><style>body{font:16px system-ui;margin:32px;max-width:760px}button{padding:8px;margin:4px}</style><h1>Saved progress</h1><p>Synthetic canonical answers, with held storage locks.</p><nav><button id="edit">Edit answer</button><button id="baseline">Return to baseline</button><button id="release">Release write</button><button id="off">Saving off</button><button id="on">Saving on</button><button id="save">Adopt saved record</button><button id="foreign">Foreign tab event</button></nav><main id="app"></main><script type="module" src="/main.js"></script></html>';
    server = createServer((req, res) => {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path === '/') {
            res.setHeader('content-type', 'text/html');
            res.end(html);
        } else if (assets.has(path)) {
            res.setHeader(
                'content-type',
                path.endsWith('.css') ? 'text/css' : 'text/javascript'
            );
            res.end(assets.get(path));
        } else {
            res.statusCode = 404;
            res.end();
        }
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
        ...(process.env.SDK_NATIVE_CHROMIUM
            ? { executablePath: process.env.SDK_NATIVE_CHROMIUM }
            : { channel: 'chrome' }),
        headless: true,
        chromiumSandbox: true,
    });
    report.chrome = browser.version();
    for (const react of ['18.3.1', '19.2.0']) {
        const directory = join(temporary, react);
        mkdirSync(directory);
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({ private: true, type: 'module' })
        );
        run(
            [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                archive,
                `react@${react}`,
                `react-dom@${react}`,
            ],
            directory
        );
        for (const format of ['esm', 'cjs']) {
            let fixture = readFileSync(
                new URL(
                    './saved-progress-browser-fixture.mjs',
                    import.meta.url
                ),
                'utf8'
            );
            if (format === 'cjs')
                fixture = ts.transpileModule(fixture, {
                    compilerOptions: {
                        target: ts.ScriptTarget.ES2022,
                        module: ts.ModuleKind.CommonJS,
                        esModuleInterop: true,
                    },
                }).outputText;
            const entry = format === 'cjs' ? 'main.cjs' : 'main.mjs';
            writeFileSync(join(directory, entry), fixture);
            const bundled = await build({
                absWorkingDir: directory,
                entryPoints: [entry],
                bundle: true,
                platform: 'browser',
                format: 'esm',
                target: 'es2022',
                outdir: join(directory, 'bundle'),
                write: false,
                metafile: true,
                minify: true,
                define: { 'process.env.NODE_ENV': '"production"' },
            });
            await assertBrowserInputs(bundled.metafile, directory);
            assert(
                Object.keys(bundled.metafile.inputs).some((name) =>
                    name.includes(
                        `/sdk/dist/${format}/react/useNativeFormProgress.js`
                    )
                ),
                'Browser must execute the selected installed module format'
            );
            for (const file of bundled.outputFiles)
                assets.set('/' + file.path.split('/').at(-1), file.contents);
            const context = await browser.newContext(),
                external = [],
                errors = [];
            await context.route('**/*', (route) => {
                const url = new URL(route.request().url());
                if (url.origin === origin) return route.continue();
                external.push(url.href);
                return route.abort();
            });
            const page = await context.newPage();
            page.on('pageerror', (error) => errors.push(error.message));
            try {
                await page.goto(origin);
                await page.waitForFunction(() => !!window.progress);
                assert.equal(
                    await page.evaluate(() => window.progress.react),
                    react
                );
                assert.equal(
                    await page.evaluate(() => window.progress.jobs.length),
                    0
                );
                await page
                    .getByRole('button', { name: 'Edit answer', exact: true })
                    .click();
                await page.waitForFunction(
                    () => window.progress.jobs.length === 1
                );
                await page
                    .getByRole('button', {
                        name: 'Return to baseline',
                        exact: true,
                    })
                    .click();
                await page
                    .getByRole('button', { name: 'Release write', exact: true })
                    .click();
                await page.waitForFunction(
                    () => window.progress.jobs.length === 1
                );
                await page
                    .getByRole('button', { name: 'Release write', exact: true })
                    .click();
                await page.waitForFunction(
                    () => window.progress.snapshot?.revision === 2
                );
                assert.deepEqual(
                    await page.evaluate(() => window.progress.snapshot.record),
                    {
                        visible: 'Hydrated answer',
                        hidden: 'Retained hidden answer',
                    }
                );
                for (const cutoff of [
                    'surface',
                    'config',
                    'adopt',
                    'unmount',
                ]) {
                    await page.evaluate(() => window.progress.reset());
                    await page
                        .getByRole('button', {
                            name: 'Edit answer',
                            exact: true,
                        })
                        .click();
                    await page.waitForFunction(
                        () => window.progress.jobs.length === 1
                    );
                    const result = await page.evaluate((cutoff) => {
                        const p = window.progress;
                        if (cutoff === 'surface') p.surface(false);
                        else if (cutoff === 'config') p.config(false);
                        else if (cutoff === 'adopt') p.adopt();
                        else p.unmount();
                        const count = p.trace.length;
                        p.release();
                        return count;
                    }, cutoff);
                    await page.waitForFunction(
                        () => window.progress.jobs.length === 0
                    );
                    assert.equal(
                        await page.evaluate(() => window.progress.trace.length),
                        result
                    );
                    assert.equal(
                        await page.evaluate(() => window.progress.bytes.size),
                        0
                    );
                    if (cutoff === 'unmount')
                        await page.evaluate(() => window.progress.mount());
                }
                await page.evaluate(() => {
                    window.progress.reset();
                    window.progress.deny(true);
                    window.progress.publish({
                        visible: 'Retry answer',
                        hidden: 'Retained hidden answer',
                    });
                });
                await page.waitForFunction(
                    () => window.progress.jobs.length === 1
                );
                await page.evaluate(() => window.progress.release());
                await page.waitForFunction(
                    () => window.progress.jobs.length === 0
                );
                await page.evaluate(() => {
                    window.progress.deny(false);
                    window.progress.publish({
                        visible: 'Retry answer',
                        hidden: 'Retained hidden answer',
                    });
                    window.progress.publish({
                        visible: 'Retry answer',
                        hidden: 'Retained hidden answer',
                    });
                });
                await page.waitForFunction(
                    () => window.progress.jobs.length === 1
                );
                await page.evaluate(() => window.progress.release());
                await page.waitForFunction(
                    () => window.progress.snapshot?.revision === 1
                );
                await page.evaluate(() => {
                    window.progress.emit(null, null);
                    window.progress.emit('form-progress-synthetic', '{');
                    window.progress.emit(
                        'form-progress-synthetic',
                        JSON.stringify({
                            kind: 'miniExtensions-form-progress',
                            schemaVersion: 1,
                            revision: 8,
                            writerId: 'writer',
                            record: {},
                        })
                    );
                });
                assert.equal(await page.getByRole('alert').count(), 0);
                await page
                    .getByRole('button', {
                        name: 'Foreign tab event',
                        exact: true,
                    })
                    .click();
                await page.getByRole('alert').waitFor();
                assert.equal(
                    await page.locator('#entries').textContent(),
                    'Retry answer'
                );
                const styles = await page
                    .getByRole('alert')
                    .evaluate((node) => ({
                        background: getComputedStyle(node).backgroundColor,
                        padding: getComputedStyle(node).padding,
                        color: getComputedStyle(node.querySelector('h3')).color,
                        iconWidth: getComputedStyle(node.querySelector('svg'))
                            .width,
                    }));
                assert.deepEqual(styles, {
                    background: 'rgb(254, 252, 232)',
                    padding: '16px',
                    color: 'rgb(133, 77, 14)',
                    iconWidth: '24px',
                });
                await page
                    .getByRole('button', { name: 'Saving off', exact: true })
                    .click();
                assert.equal(await page.getByRole('alert').count(), 0);
                await page
                    .getByRole('button', { name: 'Saving on', exact: true })
                    .click();
                await page.getByRole('alert').waitFor();
                assert.equal(
                    await page.evaluate(() => window.progress.jobs.length),
                    0
                );
                await page.screenshot({
                    path: join(output, `conflict-${react}-${format}.png`),
                    fullPage: true,
                });
                await page.evaluate(() => window.progress.unmount());
                assert.equal(
                    await page.evaluate(
                        () =>
                            window.localStorage.length +
                            window.sessionStorage.length
                    ),
                    0
                );
                assert.deepEqual(external, []);
                assert.deepEqual(errors, []);
                report.profiles.push({
                    react,
                    format,
                    styles,
                    orderedWrites: true,
                    cutoffs: 4,
                    laterRetry: true,
                    conflict: true,
                    externalRequests: 0,
                });
            } finally {
                await context.close();
            }
        }
    }
    writeFileSync(
        join(output, 'result.json'),
        JSON.stringify(report, null, 2) + '\n'
    );
    console.log(JSON.stringify(report));
} catch (error) {
    writeFileSync(
        join(output, 'failure.json'),
        JSON.stringify(
            { ...report, error: String(error.stack ?? error) },
            null,
            2
        ) + '\n'
    );
    throw error;
} finally {
    await browser?.close();
    await new Promise((done) => (server ? server.close(done) : done()));
    rmSync(temporary, { recursive: true, force: true });
}
