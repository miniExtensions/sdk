import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build, stop } from 'esbuild';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';
import {
    assertBrowserInputs,
    createArchiveMemberReader,
} from './package-checks.mjs';

const initialPath = '/form/recSource?screen=2&campaign=test';
const targetPath = '/form?campaign=test&recordIdToCopyFrom=recSource';
const documentPaths = [initialPath, targetPath];
const fixture = readFileSync(
    new URL('./readonly-child-form-copy-fixture.mjs', import.meta.url)
);
const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Installed child Form Copy</title><link rel="icon" href="/favicon.ico"><link rel="stylesheet" href="/app.css"><main id="root"></main><pre id="receipt" hidden></pre><script defer src="/app.js"></script></html>';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function regularFile(path) {
    const absolute = resolve(path);
    assert(lstatSync(absolute).isFile());
    assert.equal(realpathSync(absolute), absolute, 'Refuse redirected input');
    return absolute;
}

const { values } = parseArgs({
    options: {
        archive: { type: 'string' },
        receipt: { type: 'string' },
        output: { type: 'string' },
    },
});
assert(
    values.archive && values.receipt && values.output,
    'Pass --archive, --receipt and --output'
);
const archive = regularFile(values.archive);
const kit = JSON.parse(readFileSync(regularFile(values.receipt), 'utf8'));
const archiveBytes = readFileSync(archive);
assert.equal(kit.schemaVersion, 1);
assert.equal(kit.verification.outcome, 'passed');
assert.equal(kit.package.name, '@miniextensions/sdk');
assert.equal(kit.package.filename, basename(archive));
assert.equal(kit.package.bytes, archiveBytes.length);
assert.equal(kit.package.sha256, hash(archiveBytes));
assert.equal(kit.ci.repository, 'miniExtensions/sdk');
assert.equal(kit.ci.workflowSha, kit.source.commit);
assert.match(kit.source.tree, /^[a-f0-9]{40}$/);
const readMember = createArchiveMemberReader({
    archivePath: archive,
    expectedSha256: kit.package.sha256,
});
const output = resolve(values.output);
mkdirSync(output);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'sdk-child-copy-')));
const report = {
    source: kit.source,
    package: kit.package,
    kitCI: kit.ci,
    fixtureSha256: hash(fixture),
    profiles: [],
    cleanup: {},
};
const saveReport = () =>
    writeFileSync(
        join(output, 'report.json'),
        JSON.stringify(report, null, 2) + '\n'
    );

async function prepare(evidence) {
    const directory = join(scratch, evidence.react);
    mkdirSync(directory);
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
            private: true,
            type: 'module',
            dependencies: {
                '@miniextensions/sdk': `file:${archive}`,
                react: evidence.react,
                'react-dom': evidence.react,
            },
        })
    );
    evidence.installation = installAgeQualifiedConsumer({
        directory,
        args: ['install'],
    });
    const require = createRequire(join(directory, 'package.json'));
    assert.equal(require('react/package.json').version, evidence.react);
    assert.equal(require('react-dom/package.json').version, evidence.react);
    const installed = realpathSync(
        join(directory, 'node_modules/@miniextensions/sdk')
    );
    writeFileSync(join(directory, 'fixture.mjs'), fixture);
    const bundle = await build({
        absWorkingDir: directory,
        entryPoints: ['fixture.mjs'],
        outfile: 'app.js',
        bundle: true,
        write: false,
        metafile: true,
        define: { 'process.env.NODE_ENV': '"production"' },
    });
    await assertBrowserInputs(bundle.metafile, directory);
    evidence.installedMembers = Object.keys(bundle.metafile.inputs).flatMap(
        (name) => {
            const path = realpathSync(resolve(directory, name));
            if (!path.startsWith(installed + '/')) return [];
            const member = 'package/' + relative(installed, path);
            const content = readFileSync(path);
            assert.deepEqual(content, readMember(member));
            return [{ member, sha256: hash(content) }];
        }
    );
    for (const name of [
        'react/CompleteFormReadonlyFooterActions.js',
        'react/CompleteFormCompletion.js',
        'react/form-completion.css',
        'forms/completion.js',
        'forms/completionCountdown.js',
    ]) {
        assert(
            evidence.installedMembers.some(
                ({ member }) => member === 'package/dist/esm/' + name
            ),
            'Expected installed ' + name
        );
    }
    evidence.bundle = Object.fromEntries(
        bundle.outputFiles.map(({ path, contents }) => [
            basename(path),
            hash(contents),
        ])
    );
    return new Map([
        ...documentPaths.map((path) => [
            path,
            ['text/html; charset=utf-8', html],
        ]),
        ['/favicon.ico', ['image/x-icon', Buffer.alloc(0)]],
        ...bundle.outputFiles.map(({ path, contents }) => [
            '/' + basename(path),
            [path.endsWith('.css') ? 'text/css' : 'text/javascript', contents],
        ]),
    ]);
}

const servers = [];
const stopped = new Promise((done) => {
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
});
try {
    const prepared = [];
    for (const react of ['18.3.1', '19.2.0']) {
        const evidence = { react, documents: [], unexpected: [] };
        report.profiles.push(evidence);
        prepared.push([evidence, await prepare(evidence)]);
    }
    for (const [evidence, assets] of prepared) {
        const server = createServer((request, response) => {
            const { method, url } = request;
            const destination = request.headers['sec-fetch-dest'] ?? null;
            const mode = request.headers['sec-fetch-mode'] ?? null;
            const user = request.headers['sec-fetch-user'] ?? null;
            const asset = method === 'GET' && assets.get(url);
            if (documentPaths.includes(url) || destination === 'document')
                evidence.documents.push({
                    method,
                    url,
                    destination,
                    mode,
                    user,
                });
            if (!asset)
                evidence.unexpected.push({ method, url, destination, mode });
            saveReport();
            if (!asset) return response.writeHead(404).end();
            response
                .writeHead(200, {
                    'Content-Type': asset[0],
                    'Cache-Control': 'no-store',
                    'Content-Security-Policy':
                        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'",
                })
                .end(asset[1]);
        });
        servers.push(server);
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        evidence.origin = `http://127.0.0.1:${server.address().port}`;
    }
    const urls = report.profiles.map(({ react, origin }) => ({
        react,
        start: origin + initialPath,
        target: origin + targetPath,
    }));
    saveReport();
    writeFileSync(
        join(output, 'urls.json'),
        JSON.stringify(urls, null, 2) + '\n'
    );
    console.log(JSON.stringify({ pid: process.pid, urls }));
    await stopped;
    for (const evidence of report.profiles) {
        assert.deepEqual(evidence.unexpected, []);
        assert.deepEqual(
            evidence.documents.map(({ method, url, destination, mode }) => ({
                method,
                url,
                destination,
                mode,
            })),
            documentPaths.map((url) => ({
                method: 'GET',
                url,
                destination: 'document',
                mode: 'navigate',
            }))
        );
    }
    assert.equal(hash(readFileSync(archive)), kit.package.sha256);
} catch (error) {
    report.failure = error.message;
    throw error;
} finally {
    try {
        await Promise.all(
            servers.map(async (server) => {
                if (!server.listening) return;
                const closed = once(server, 'close');
                server.close();
                server.closeAllConnections();
                await closed;
            })
        );
        report.cleanup.loopbackClosed = servers.every(
            (server) => !server.listening
        );
    } finally {
        await stop();
        rmSync(scratch, { recursive: true });
        report.cleanup.consumersRemoved = !existsSync(scratch);
        saveReport();
    }
}
