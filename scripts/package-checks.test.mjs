import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    mkdtemp,
    mkdir,
    readFile,
    readdir,
    rm,
    symlink,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
    assertBrowserInputs,
    assertInstalledArchive,
    assertPackedDocLinks,
} from './package-checks.mjs';
import { retainCheckedPackage } from './retain-checked-package.mjs';

async function temporaryRoot(t) {
    const root = await mkdtemp(join(tmpdir(), 'sdk-package-guard-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    return root;
}

async function write(root, path, content) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
}

async function deliveryFixture(t) {
    const root = await temporaryRoot(t);
    const outputParent = await temporaryRoot(t);
    const installedPackage = join(root, 'node_modules/@miniextensions/sdk');
    const filename = 'miniextensions-sdk-0.1.0-alpha.0.tgz';
    const archivePath = join(root, filename);
    const archive = Buffer.from('the exact archive checked by consumers');
    const guide = '# Browser starter\nUse the supplied archive.\n';
    await writeFile(archivePath, archive);
    await write(installedPackage, 'docs/browser-lifecycle.md', guide);
    await write(installedPackage, '.private-fixture', 'must not be retained');
    return {
        archivePath,
        installedPackage,
        outputDirectory: join(outputParent, 'delivery'),
        packed: {
            name: '@miniextensions/sdk',
            version: '0.1.0-alpha.0',
            filename,
            integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
            files: [
                {
                    path: 'docs/browser-lifecycle.md',
                    size: Buffer.byteLength(guide),
                },
            ],
        },
        source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
        ci: {
            repository: 'miniExtensions/sdk',
            event: 'pull_request',
            runId: '123',
            runAttempt: '2',
            workflowSha: 'a'.repeat(40),
            pullRequestHeadSha: 'c'.repeat(40),
            token: 'never-upload-this-secret',
        },
        browserPortalChecks: 21,
    };
}

test('delivery preserves tested archive bytes and limits retained files and provenance', async (t) => {
    const fixture = await deliveryFixture(t);
    retainCheckedPackage(fixture);
    assert.deepEqual(
        (await readdir(fixture.outputDirectory)).sort(),
        [
            'SHA256SUMS',
            'artifact-receipt.json',
            fixture.packed.filename,
            'miniExtensions-SDK-INSTALL.md',
        ].sort()
    );
    const archive = await readFile(fixture.archivePath);
    assert.deepEqual(
        await readFile(join(fixture.outputDirectory, fixture.packed.filename)),
        archive
    );
    assert.deepEqual(
        await readFile(
            join(fixture.outputDirectory, 'miniExtensions-SDK-INSTALL.md')
        ),
        await readFile(
            join(fixture.installedPackage, 'docs/browser-lifecycle.md')
        )
    );
    const text = await readFile(
        join(fixture.outputDirectory, 'artifact-receipt.json'),
        'utf8'
    );
    const receipt = JSON.parse(text);
    assert.equal(
        receipt.package.sha256,
        createHash('sha256').update(archive).digest('hex')
    );
    assert.equal(receipt.package.integrity, fixture.packed.integrity);
    assert.equal(receipt.source.commit, fixture.source.commit);
    assert.equal(receipt.ci.pullRequestHeadSha, fixture.ci.pullRequestHeadSha);
    assert.notEqual(receipt.source.commit, receipt.ci.pullRequestHeadSha);
    assert.doesNotMatch(text, /never-upload-this-secret|private-fixture/);
    const sums = await readFile(
        join(fixture.outputDirectory, 'SHA256SUMS'),
        'utf8'
    );
    assert.equal(
        sums,
        `${receipt.package.sha256}  ${fixture.packed.filename}\n${receipt.guide.sha256}  miniExtensions-SDK-INSTALL.md\n`
    );
});

test('delivery rejects changed archive bytes before creating output', async (t) => {
    const fixture = await deliveryFixture(t);
    await writeFile(fixture.archivePath, 'a different archive');
    assert.throws(
        () => retainCheckedPackage(fixture),
        /Tested archive bytes changed/
    );
    await assert.rejects(readdir(fixture.outputDirectory), { code: 'ENOENT' });
});

test('delivery rejects symlinked input and output lost during consumer cleanup', async (t) => {
    const fixture = await deliveryFixture(t);
    const alias = join(await temporaryRoot(t), fixture.packed.filename);
    await symlink(fixture.archivePath, alias);
    assert.throws(
        () => retainCheckedPackage({ ...fixture, archivePath: alias }),
        /Archive must be a regular file/
    );
    assert.throws(
        () =>
            retainCheckedPackage({
                ...fixture,
                outputDirectory: join(fixture.archivePath, '..', 'delivery'),
            }),
        /survive consumer cleanup/
    );
    const guide = join(fixture.installedPackage, 'docs/browser-lifecycle.md');
    const original = join(fixture.installedPackage, 'guide.md');
    await writeFile(original, await readFile(guide));
    await rm(guide);
    await symlink(original, guide);
    assert.throws(
        () => retainCheckedPackage(fixture),
        /Guide must be a regular file/
    );
});

test('delivery refuses existing outputs and a mislabeled checkout commit', async (t) => {
    const fixture = await deliveryFixture(t);
    assert.throws(
        () =>
            retainCheckedPackage({
                ...fixture,
                ci: {
                    ...fixture.ci,
                    workflowSha: fixture.ci.pullRequestHeadSha,
                },
            }),
        /strictly equal/
    );
    await mkdir(fixture.outputDirectory);
    await writeFile(
        join(fixture.outputDirectory, 'keep.txt'),
        'existing output'
    );
    assert.throws(() => retainCheckedPackage(fixture), { code: 'EEXIST' });
    assert.equal(
        await readFile(join(fixture.outputDirectory, 'keep.txt'), 'utf8'),
        'existing output'
    );
    assert.deepEqual(await readdir(fixture.outputDirectory), ['keep.txt']);
});

test('shipped docs support local paths, heading anchors, and references', async (t) => {
    const root = await temporaryRoot(t);
    await write(
        root,
        'README.md',
        '# SDK\n[Guide](docs/runtime.md#save-a-form)\n[License][license]\n' +
            '[Runtime][]\n[Runtime]\n[license]: LICENSE\n' +
            '[Runtime]: docs/runtime.md#save-a-form-1\n' +
            '[Website](https://example.test/docs#unavailable)\n' +
            '`[inline code](missing.md)`\n```ts\n[code](missing.md)\n```\n'
    );
    await write(
        root,
        'docs/runtime.md',
        '# Runtime\n## Save a Form\n## Save a Form\n' +
            '[Readme](../README.md#sdk)\n[Here](#save-a-form)\n'
    );
    await write(root, 'LICENSE', 'MIT');
    await assertPackedDocLinks(root, [
        'README.md',
        'docs/runtime.md',
        'LICENSE',
    ]);
});

test('docs reject an existing checkout-only example outside the archive allowlist', async (t) => {
    const root = await temporaryRoot(t);
    await write(root, 'README.md', '[Example](examples/browser/README.md)');
    await write(root, 'examples/browser/README.md', '# Example');
    await assert.rejects(
        assertPackedDocLinks(root, ['README.md']),
        /Unshipped doc link/
    );
});

test('copied starter and sibling docs resolve without a source checkout', async (t) => {
    const root = await temporaryRoot(t);
    await write(
        root,
        'examples/browser/README.md',
        '# Starter\n[Lifecycle](../../docs/browser-lifecycle.md#copy-and-run)\n'
    );
    await write(
        root,
        'docs/browser-lifecycle.md',
        '# Lifecycle\n## Copy and run\n[Starter](../examples/browser/README.md)\n' +
            '[Recovery](../examples/browser/src/recovery.ts)\n'
    );
    await write(root, 'examples/browser/src/recovery.ts', 'export {};\n');
    await assertPackedDocLinks(root, [
        'examples/browser/README.md',
        'examples/browser/src/recovery.ts',
        'docs/browser-lifecycle.md',
    ]);
});

test('copied starter rejects omitted sibling documentation', async (t) => {
    const root = await temporaryRoot(t);
    await write(
        root,
        'examples/browser/README.md',
        '# Starter\n[Lifecycle](../../docs/browser-lifecycle.md)\n'
    );
    await write(root, 'docs/browser-lifecycle.md', '# Lifecycle\n');
    await assert.rejects(
        assertPackedDocLinks(root, ['examples/browser/README.md']),
        /Unshipped doc link/
    );
});

test('docs reject missing anchors and undefined references', async (t) => {
    const root = await temporaryRoot(t);
    await write(root, 'README.md', '# SDK\n[Guide](#wrong-heading)');
    await assert.rejects(
        assertPackedDocLinks(root, ['README.md']),
        /Missing doc anchor/
    );
    await write(root, 'README.md', '[Guide][missing-reference]');
    await assert.rejects(
        assertPackedDocLinks(root, ['README.md']),
        /Undefined Markdown reference/
    );
});

test('docs reject absolute paths, package traversal, and escaping symlinks', async (t) => {
    const root = await temporaryRoot(t);
    for (const target of [
        '/README.md',
        'C:\\README.md',
        '../README.md',
        '%2e%2e/README.md',
    ]) {
        await write(root, 'README.md', `[Escape](${target})`);
        await assert.rejects(
            assertPackedDocLinks(root, ['README.md']),
            /Absolute doc link|Unshipped doc link/
        );
    }
    const outside = await temporaryRoot(t);
    await write(outside, 'other.md', '# Other');
    await symlink(join(outside, 'other.md'), join(root, 'other.md'));
    await write(root, 'README.md', '[Escape](other.md)');
    await assert.rejects(
        assertPackedDocLinks(root, ['README.md', 'other.md']),
        /escapes package/
    );
});

async function installedFixture(t) {
    const root = await temporaryRoot(t);
    const archive = join(root, 'sdk.tgz');
    const consumer = join(root, 'consumer');
    const sdk = 'node_modules/@miniextensions/sdk';
    const packageJson = JSON.stringify({
        name: '@miniextensions/sdk',
        version: '0.1.0-alpha.0',
    });
    const archiveBytes = 'fresh packed bytes';
    const integrity = `sha512-${createHash('sha512')
        .update(archiveBytes)
        .digest('base64')}`;
    await writeFile(archive, archiveBytes);
    await write(consumer, `${sdk}/package.json`, packageJson);
    await write(consumer, `${sdk}/dist/esm/runtime/index.js`, 'export {};\n');
    const locked = { resolved: `file:${archive}`, integrity };
    const lock = { lockfileVersion: 3, packages: { [sdk]: locked } };
    const saveLock = () =>
        write(consumer, 'package-lock.json', JSON.stringify(lock));
    await saveLock();
    const packed = {
        name: '@miniextensions/sdk',
        version: '0.1.0-alpha.0',
        integrity,
        files: [
            { path: 'package.json', size: Buffer.byteLength(packageJson) },
            { path: 'dist/esm/runtime/index.js', size: 11 },
        ],
    };
    return { root, consumer, archive, packed, locked, saveLock, sdk };
}

test('archive provenance accepts the exact installed archive and pack file list', async (t) => {
    const { consumer, archive, packed, locked, saveLock } =
        await installedFixture(t);
    await assertInstalledArchive(consumer, archive, packed);
    locked.resolved = 'file:../sdk.tgz';
    await saveLock();
    await assertInstalledArchive(consumer, archive, packed);
});

test('archive provenance rejects a reused archive path even with identical bytes', async (t) => {
    const fixture = await installedFixture(t);
    const oldArchive = join(fixture.root, 'old-sdk.tgz');
    await writeFile(oldArchive, 'fresh packed bytes');
    fixture.locked.resolved = `file:${oldArchive}`;
    await fixture.saveLock();
    await assert.rejects(
        assertInstalledArchive(
            fixture.consumer,
            fixture.archive,
            fixture.packed
        ),
        /different SDK archive/
    );
});

test('archive provenance rejects stale lock integrity or modified archive bytes', async (t) => {
    const fixture = await installedFixture(t);
    fixture.locked.integrity = 'sha512-stale';
    await fixture.saveLock();
    await assert.rejects(
        assertInstalledArchive(
            fixture.consumer,
            fixture.archive,
            fixture.packed
        ),
        /Lockfile SDK integrity changed/
    );
    await writeFile(fixture.archive, 'replacement archive');
    await assert.rejects(
        assertInstalledArchive(
            fixture.consumer,
            fixture.archive,
            fixture.packed
        ),
        /Packed archive changed/
    );
});

test('archive provenance rejects a source checkout symlink', async (t) => {
    const fixture = await installedFixture(t);
    const installed = join(fixture.consumer, fixture.sdk);
    const outside = join(fixture.root, 'checkout');
    await mkdir(outside);
    await rm(installed, { recursive: true });
    await symlink(outside, installed);
    await assert.rejects(
        assertInstalledArchive(
            fixture.consumer,
            fixture.archive,
            fixture.packed
        ),
        /without symlinks/
    );
});

test('archive provenance rejects extra or changed installed files', async (t) => {
    const fixture = await installedFixture(t);
    const installed = join(fixture.consumer, fixture.sdk);
    await write(installed, 'extra.js', 'source import');
    await assert.rejects(
        assertInstalledArchive(
            fixture.consumer,
            fixture.archive,
            fixture.packed
        ),
        /file list differs/
    );
    await rm(join(installed, 'extra.js'));
    await write(installed, 'dist/esm/runtime/index.js', 'changed');
    await assert.rejects(
        assertInstalledArchive(
            fixture.consumer,
            fixture.archive,
            fixture.packed
        ),
        /file size differs/
    );
});

test('browser build requires bundled SDK dist inside the clean consumer', async (t) => {
    const fixture = await installedFixture(t);
    await write(
        fixture.consumer,
        'src/main.ts',
        'import "@miniextensions/sdk";'
    );
    await assertBrowserInputs(
        {
            inputs: {
                'src/main.ts': {},
                [`${fixture.sdk}/dist/esm/runtime/index.js`]: {},
            },
        },
        fixture.consumer
    );
    await assert.rejects(
        assertBrowserInputs(
            { inputs: { 'src/main.ts': {} } },
            fixture.consumer
        ),
        /did not bundle the installed SDK dist/
    );
});

test('browser build rejects source imports and paths escaping the consumer', async (t) => {
    const fixture = await installedFixture(t);
    const source = `${fixture.sdk}/src/runtime/index.ts`;
    await write(fixture.consumer, source, 'export {};');
    await assert.rejects(
        assertBrowserInputs({ inputs: { [source]: {} } }, fixture.consumer),
        /SDK source outside dist/
    );
    await write(fixture.root, 'repo/src/runtime/index.ts', 'export {};');
    await assert.rejects(
        assertBrowserInputs(
            { inputs: { '../repo/src/runtime/index.ts': {} } },
            fixture.consumer
        ),
        /escapes the clean consumer/
    );
});

test('browser input containment checks real paths rather than symlink names', async (t) => {
    const fixture = await installedFixture(t);
    await write(fixture.root, 'checkout/index.js', 'export {};');
    const installed = join(fixture.consumer, fixture.sdk);
    await rm(installed, { recursive: true });
    await symlink(join(fixture.root, 'checkout'), installed);
    await assert.rejects(
        assertBrowserInputs(
            { inputs: { [`${fixture.sdk}/index.js`]: {} } },
            fixture.consumer
        ),
        /escapes the clean consumer/
    );
});
