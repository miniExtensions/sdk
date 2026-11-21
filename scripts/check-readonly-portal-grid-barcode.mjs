// Standalone loopback consumer. Open the reported profile URLs in Chromium.
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
import { join, resolve } from 'node:path';
import { build, stop, transformSync } from 'esbuild';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

const [archiveArg, expectedSha256, outputArg, ...requested] =
    process.argv.slice(2);
assert(
    archiveArg && outputArg && /^[0-9a-f]{64}$/.test(expectedSha256 ?? ''),
    'Usage: node scripts/check-readonly-portal-grid-barcode.mjs archive.tgz sha256 output [profile ...]'
);
const supported = ['18.3.1-esm', '18.3.1-cjs', '19.2.0-esm', '19.2.0-cjs'];
const selected = requested.length ? requested : supported;
assert.equal(new Set(selected).size, selected.length);
assert(
    selected.every((id) => supported.includes(id)),
    'Unknown profile'
);
const archive = realpathSync(archiveArg);
const sha = (data) => createHash('sha256').update(data).digest('hex');
assert.equal(sha(readFileSync(archive)), expectedSha256);
const member = createArchiveMemberReader({
    archivePath: archive,
    expectedSha256,
});
const output = resolve(outputArg);
mkdirSync(output);
const temporary = mkdtempSync(
    join(realpathSync(tmpdir()), 'sdk-barcode-grid-')
);
const fixture = readFileSync(
    new URL('./readonly-portal-grid-barcode-fixture.mjs', import.meta.url),
    'utf8'
);
const [commit, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    { encoding: 'utf8' }
)
    .trim()
    .split('\n');
const report = {
    source: { commit, tree, fixtureSha256: sha(fixture) },
    archiveSha256: expectedSha256,
    profiles: [],
    cleanup: null,
    requests: [],
};
const save = () =>
    writeFileSync(
        join(output, 'install-report.json'),
        JSON.stringify(report, null, 2) + '\n'
    );
const cssRoots = ['readonly-portal-grid.css', 'barcode.css'];
const cssFiles = [
    ...cssRoots,
    'field-presentation.css',
    'html-description.css',
    'complete-readonly-text.css',
    'complete-checkbox.css',
    'complete-clearable-text-input.css',
    'complete-barcode-scanner.css',
];
const page = Buffer.from(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Installed readonly Barcode Grid</title>${cssRoots.map((file) => `<link rel="stylesheet" href="${file}">`).join('')}<h1>Installed readonly Barcode Grid</h1><div id="grid"></div><button id="republish">Republish Grid</button><button id="dispose">Dispose Grid</button><pre id="receipt"></pre><script defer src="probe.js"></script></html>`
);
const assets = new Map();
const server = createServer((req, res) => {
    const asset = req.method === 'GET' && assets.get(req.url);
    report.requests.push({
        method: req.method,
        path: req.url,
        status: asset ? 200 : 404,
    });
    if (!asset) return res.writeHead(404).end();
    res.setHeader('Content-Type', asset.type);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"
    );
    res.end(asset.bytes);
});
const consumers = new Map();
const end = new Promise((done) => {
    process.once('SIGTERM', done);
    process.once('SIGINT', done);
});

async function addProfile(id, origin) {
    const [react, format] = id.split('-');
    let consumer = consumers.get(react);
    if (!consumer) {
        const path = join(temporary, react);
        mkdirSync(path);
        writeFileSync(
            join(path, 'package.json'),
            JSON.stringify({
                private: true,
                dependencies: {
                    '@miniextensions/sdk': 'file:' + archive,
                    react,
                    'react-dom': react,
                },
            })
        );
        const installation = installAgeQualifiedConsumer({
            directory: path,
            args: ['install', '--ignore-scripts'],
        });
        assert.equal(installation.archiveSha256, expectedSha256);
        for (const dependency of ['react', 'react-dom']) {
            assert.equal(
                JSON.parse(
                    readFileSync(
                        join(path, 'node_modules', dependency, 'package.json'),
                        'utf8'
                    )
                ).version,
                react
            );
        }
        consumer = { path, installation };
        consumers.set(react, consumer);
    }
    const { path, installation } = consumer;
    const entry = 'probe.' + (format === 'esm' ? 'mjs' : 'cjs');
    writeFileSync(
        join(path, entry),
        transformSync(fixture, { format, loader: 'js', target: 'es2022' }).code
    );
    const bundle = await build({
        absWorkingDir: path,
        entryPoints: [entry],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        metafile: true,
        write: false,
    });
    await assertBrowserInputs(bundle.metafile, path);
    const sdk = realpathSync(join(path, 'node_modules/@miniextensions/sdk'));
    const inputs = Object.keys(bundle.metafile.inputs).map((file) =>
        realpathSync(resolve(path, file))
    );
    const entries = ['react', 'ui'].map(
        (name) => 'dist/' + format + '/' + name + '/index.js'
    );
    for (const file of entries) {
        assert(
            inputs.includes(realpathSync(join(sdk, file))),
            'Wrong packed export ' + file
        );
        assert.deepEqual(
            readFileSync(join(sdk, file)),
            member('package/' + file)
        );
    }
    const opposite = format === 'esm' ? 'cjs' : 'esm';
    assert(
        !inputs.some((file) =>
            file.startsWith(join(sdk, 'dist', opposite) + '/')
        ),
        'Mixed SDK formats'
    );
    const prefix = '/' + id + '/';
    const css = Object.fromEntries(
        cssFiles.map((name) => {
            const file = 'dist/esm/react/' + name;
            const bytes = readFileSync(join(sdk, file));
            assert.deepEqual(bytes, member('package/' + file));
            assets.set(prefix + name, { type: 'text/css', bytes });
            return [file, sha(bytes)];
        })
    );
    const js = bundle.outputFiles[0].contents;
    assets.set(prefix, { type: 'text/html; charset=utf-8', bytes: page });
    assets.set(prefix + 'probe.js', { type: 'text/javascript', bytes: js });
    report.profiles.push({
        id,
        react,
        format,
        entries,
        installation,
        css,
        bundleSha256: sha(js),
    });
    save();
    console.log(
        JSON.stringify({
            id,
            url: origin + prefix,
            archiveSha256: expectedSha256,
        })
    );
}

try {
    await new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(0, '127.0.0.1', done);
    });
    const origin = 'http://127.0.0.1:' + server.address().port;
    writeFileSync(join(output, 'origin.txt'), origin + '\n');
    console.log(origin, 'PID', process.pid);
    for (const id of selected) await addProfile(id, origin);
    await end;
} finally {
    await new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
    });
    await stop();
    rmSync(temporary, { recursive: true });
    report.cleanup = { loopback: 'closed', consumers: 'removed' };
    save();
}
