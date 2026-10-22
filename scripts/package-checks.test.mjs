import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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
import { assertPublicDistribution } from './distribution-checks.mjs';
import { runPackedTailChecks } from './packed-tail-checks.mjs';
import { createProcessGroupObserver } from './process-group-observer.mjs';
import './process-group-observer.test.mjs';
import {
    assertPrivacyProofInventory,
    privacyScenarioInventory,
    privacyAuthScenarioInventory,
} from './privacy-proof-inventory.mjs';

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

test('documented source starter install refreshes a same-version archive lock', async (t) => {
    const root = await temporaryRoot(t);
    const consumer = join(root, 'examples/browser');
    const archiveName = 'miniextensions-sdk-0.1.0-alpha.0.tgz';
    const spec = `file:../../${archiveName}`;
    const name = '@miniextensions/sdk';
    const version = '0.1.0-alpha.0';
    // No registry dependencies or live API: exercise npm's actual local-archive
    // integrity handling with the same name/version/path as the shipped kit.
    await write(
        root,
        'payload/package/package.json',
        JSON.stringify({ name, version })
    );
    await write(root, 'payload/package/marker.txt', 'fresh archive');
    execFileSync('tar', [
        '-czf',
        join(root, archiveName),
        '-C',
        join(root, 'payload'),
        'package',
    ]);
    const manifest = {
        name: 'source-starter-consumer',
        version,
        dependencies: { [name]: spec },
    };
    await write(
        root,
        'examples/browser/package.json',
        JSON.stringify(manifest)
    );
    await write(
        root,
        'examples/browser/package-lock.json',
        JSON.stringify({
            name: manifest.name,
            version,
            lockfileVersion: 3,
            requires: true,
            packages: {
                '': manifest,
                [`node_modules/${name}`]: {
                    version,
                    resolved: spec,
                    integrity: `sha512-${createHash('sha512').update('older same-version archive').digest('base64')}`,
                },
            },
        })
    );
    const readme = await readFile(
        new URL('../examples/browser/README.md', import.meta.url),
        'utf8'
    );
    const section = readme
        .split('## Run from a source checkout\n')[1]
        ?.split('\n## ')[0];
    const commands = section?.match(/```sh\n([\s\S]*?)```/)?.[1];
    const install = commands
        ?.split('\n')
        .filter((line) => line.startsWith('npm install'));
    assert.equal(
        install?.length,
        1,
        'Expected one source-startup install command'
    );
    const options = {
        cwd: consumer,
        encoding: 'utf8',
        timeout: 30000,
        env: {
            ...process.env,
            npm_config_cache: join(root, 'npm-cache'),
            npm_config_offline: 'true',
            npm_config_audit: 'false',
            npm_config_fund: 'false',
            npm_config_ignore_scripts: 'true',
        },
    };
    execFileSync('npm', install[0].split(/\s+/).slice(1), options);
    const lock = JSON.parse(
        await readFile(join(consumer, 'package-lock.json'), 'utf8')
    );
    const integrity = `sha512-${createHash('sha512')
        .update(await readFile(join(root, archiveName)))
        .digest('base64')}`;
    assert.equal(lock.packages[`node_modules/${name}`].integrity, integrity);
    assert.equal(
        await readFile(
            join(consumer, `node_modules/${name}/marker.txt`),
            'utf8'
        ),
        'fresh archive'
    );
    // The refreshed lock must also support a clean reinstall of that archive.
    await rm(join(consumer, 'node_modules'), { recursive: true, force: true });
    execFileSync(
        'npm',
        ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        options
    );
    assert.equal(
        await readFile(
            join(consumer, `node_modules/${name}/marker.txt`),
            'utf8'
        ),
        'fresh archive'
    );
});

async function proofInventoryFixture(t) {
    const root = await temporaryRoot(t);
    const routes = [
        ...privacyScenarioInventory.map((scenario) => ['starter', scenario]),
        ...privacyAuthScenarioInventory.map((scenario) => ['auth', scenario]),
    ];
    const menu = routes
        .map(
            ([kind, scenario]) =>
                `<a href="${kind}/index.html?scenario=${scenario}">${scenario}</a>`
        )
        .join('\n');
    const readme = routes
        .map(
            ([kind, scenario]) =>
                `[${scenario}](${kind}/index.html?scenario=${scenario})`
        )
        .join('\n');
    const factory = `export function createPrivacyFixture(scenario) {
        return { fetch() { throw new Error('Inventory guard must never dispatch transport.'); },
            state: { scenario, calls: [], unexpected: [] } };
    }\n`;
    await Promise.all([
        write(root, 'package.json', '{"type":"module"}\n'),
        write(root, 'fixture.js', factory),
        write(
            root,
            'manifest.json',
            JSON.stringify({ scenarios: privacyScenarioInventory })
        ),
        write(root, 'index.html', menu),
        write(root, 'README.md', readme),
    ]);
    return { root, menu, readme };
}

test('onboarding documents stored Share ID discovery without invented setup UI', async () => {
    const root = new URL('../', import.meta.url);
    const manifest = JSON.parse(
        await readFile(new URL('package.json', root), 'utf8')
    );
    for (const path of manifest.files.filter((path) => path.endsWith('.md'))) {
        const doc = await readFile(new URL(path, root), 'utf8');
        assert.doesNotMatch(
            doc,
            /SDK[\s*-]+setup[\s*]+card|getSdkSetup|workspace[\s*]+SDK[\s*]+setup/i,
            `${path} must not direct customers to nonexistent setup UI or endpoints`
        );
    }
    const readme = await readFile(new URL('README.md', root), 'utf8');
    const configuration = readme
        .split('## Obtain the actual runtime configuration\n')[1]
        ?.split('\n## ')[0];
    assert.ok(
        configuration,
        'Runtime configuration prerequisites must be present'
    );
    assert.match(configuration, /extension\.shareId/);
    assert.match(configuration, /default-domain/);
    assert.match(configuration, /custom-domain slug is not the Share ID/);
    assert.match(configuration, /no public SDK discovery endpoint/);
    assert.match(configuration, /workspace administrator or deployment owner/);
    const starter = await readFile(
        new URL('examples/browser/README.md', root),
        'utf8'
    );
    assert.match(starter, /README\.md#obtain-the-actual-runtime-configuration/);
});

test('privacy proof inventory accepts complete declarations without dispatching fixture transport', async (t) => {
    const fixture = await proofInventoryFixture(t);
    assert.deepEqual(await assertPrivacyProofInventory(fixture.root), {
        scenarios: 33,
        authScenarios: 5,
    });
});

test('privacy proof inventory rejects a supported teardown omitted from the manifest', async (t) => {
    const fixture = await proofInventoryFixture(t);
    await write(
        fixture.root,
        'manifest.json',
        JSON.stringify({
            scenarios: privacyScenarioInventory.filter(
                (scenario) => scenario !== 'teardown-logout'
            ),
        })
    );
    await assert.rejects(
        assertPrivacyProofInventory(fixture.root),
        /Generated manifest: supported scenario inventory differs/
    );
});

test('privacy proof inventory rejects the merged address IME route omitted from the manifest', async (t) => {
    const fixture = await proofInventoryFixture(t);
    await write(
        fixture.root,
        'manifest.json',
        JSON.stringify({
            scenarios: privacyScenarioInventory.filter(
                (scenario) => scenario !== 'address-ime'
            ),
        })
    );
    await assert.rejects(
        assertPrivacyProofInventory(fixture.root),
        /Generated manifest: supported scenario inventory differs/
    );
});

test('privacy proof inventory rejects a supported teardown omitted from the generated menu', async (t) => {
    const fixture = await proofInventoryFixture(t);
    await write(
        fixture.root,
        'index.html',
        fixture.menu
            .split('\n')
            .filter((line) => !line.includes('teardown-disconnect'))
            .join('\n')
    );
    await assert.rejects(
        assertPrivacyProofInventory(fixture.root),
        /Generated menu starter: supported scenario inventory differs/
    );
});

test('privacy proof inventory rejects an unsupported route declared in the README', async (t) => {
    const fixture = await proofInventoryFixture(t);
    await write(
        fixture.root,
        'README.md',
        fixture.readme.replace(
            'scenario=teardown-logout',
            'scenario=unsupported-route'
        )
    );
    await assert.rejects(
        assertPrivacyProofInventory(fixture.root),
        /Generated README starter: supported scenario inventory differs/
    );
});

test('privacy proof inventory rejects a factory that returns another scenario for a declared route', async (t) => {
    const fixture = await proofInventoryFixture(t);
    await write(
        fixture.root,
        'fixture.js',
        `export function createPrivacyFixture(scenario) {
        return { fetch() { throw new Error('No transport.'); },
            state: { scenario: scenario === 'teardown-logout' ? 'portal' : scenario, calls: [], unexpected: [] } };
    }\n`
    );
    await assert.rejects(
        assertPrivacyProofInventory(fixture.root),
        /teardown-logout: unsupported generated route/
    );
});

test('privacy proof inventory rejects a factory that does not support a declared route', async (t) => {
    const fixture = await proofInventoryFixture(t);
    await write(
        fixture.root,
        'fixture.js',
        `export function createPrivacyFixture(scenario) {
        if (scenario === 'teardown-disconnect') throw new Error('Unsupported synthetic route.');
        return { fetch() { throw new Error('No transport.'); }, state: { scenario, calls: [], unexpected: [] } };
    }\n`
    );
    await assert.rejects(
        assertPrivacyProofInventory(fixture.root),
        /teardown-disconnect: unsupported generated route/
    );
});

async function distributionFixture(t) {
    const root = await temporaryRoot(t);
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    const internal = {
        sourceRepository: 'synthetic/private-source',
        sourceRevision: 'a'.repeat(40),
        sources: [{ path: 'synthetic/internal-source.ts' }],
        compilerVersion: '5.9.3',
        generatorSha256: hash('fixture-generator'),
        transport: 'plain JSON',
        declarationCount: 1,
        generatedSha256: hash('fixture-generated-source'),
        dependencies: ['@trpc/server', 'airtable', 'zod', '@types/node'].map(
            (name) => ({ path: name + '/fixture.d.ts', sha256: hash(name) })
        ),
        operations: [
            {
                operation: 'loadExtension',
                input: 'Input',
                output: 'Output',
                route: 'syntheticPublicRoute',
                kind: 'POST',
                transport: 'v1',
                module: 'synthetic/private-module.ts',
            },
        ],
    };
    const declaration = 'export type Fixture = string;\n';
    const provenance = {
        schemaVersion: 1,
        compilerVersion: internal.compilerVersion,
        generatorSha256: internal.generatorSha256,
        transport: internal.transport,
        declarationCount: 1,
        generatedSha256: internal.generatedSha256,
        contractDeclarationsSha256: hash(declaration),
        operations: [
            {
                operation: 'loadExtension',
                input: 'Input',
                output: 'Output',
                route: 'syntheticPublicRoute',
                kind: 'POST',
                transport: 'v1',
            },
        ],
        dependencies: ['@trpc/server', 'airtable', 'zod', '@types/node'].map(
            (name) => ({ package: name, inputSha256: [hash(name)] })
        ),
    };
    const header =
        '// Generated by scripts/generate-runtime-contracts.mjs; do not edit.\n' +
        '// Enum values are emitted as their JSON string/number literals.\n';
    const files = {
        'dist/esm/runtime/contracts/generated.js': header + 'export {};\n',
        'dist/cjs/runtime/contracts/generated.js':
            '"use strict";\n' +
            header +
            'Object.defineProperty(exports, "__esModule", { value: true });\n',
        'docs/runtime.md':
            'Packaged declaration SHA256 `' + hash(declaration) + '`.\n',
        'THIRD_PARTY_NOTICES.md': await readFile(
            new URL('../THIRD_PARTY_NOTICES.md', import.meta.url)
        ),
    };
    for (const format of ['esm', 'cjs']) {
        files[`dist/${format}/runtime/contracts/generated.d.ts`] = declaration;
        files[`dist/${format}/runtime/contracts/generated.provenance.json`] =
            JSON.stringify(provenance);
    }
    for (const [path, content] of Object.entries(files))
        await write(root, path, content);
    return {
        root,
        internal,
        provenance,
        paths: Object.keys(files),
        check: () =>
            assertPublicDistribution(root, Object.keys(files), internal),
    };
}

test('public distribution accepts captured contracts and complete notices', async (t) => {
    const fixture = await distributionFixture(t);
    await fixture.check();
});

test('public distribution rejects unrecorded backend paths and accepts public helper descriptions', async (t) => {
    const fixture = await distributionFixture(t);
    const original = await readFile(
        join(fixture.root, 'docs/runtime.md'),
        'utf8'
    );
    await write(
        fixture.root,
        'docs/runtime.md',
        original + 'Canonical `backend-src/trpc/publicRuntimeCors.ts` helper.\n'
    );
    await assert.rejects(
        fixture.check,
        /Private source provenance shipped in docs\/runtime.md/
    );
    await write(
        fixture.root,
        'docs/runtime.md',
        original + 'Canonical public-runtime CORS transport helper.\n'
    );
    await fixture.check();
});

test('public distribution rejects private paths in an otherwise unrelated guide', async (t) => {
    const fixture = await distributionFixture(t);
    await write(
        fixture.root,
        'docs/runtime.md',
        'Copied internal path: ' + fixture.internal.sources[0].path
    );
    await assert.rejects(fixture.check(), /Private source provenance shipped/);
});

test('public distribution rejects extra internal metadata even without a known private value', async (t) => {
    const fixture = await distributionFixture(t);
    await write(
        fixture.root,
        'dist/esm/runtime/contracts/generated.provenance.json',
        JSON.stringify({
            ...fixture.provenance,
            sourceRevision: 'b'.repeat(40),
        })
    );
    await assert.rejects(
        fixture.check(),
        /Unexpected public provenance fields/
    );
});

test('public distribution rejects declaration bytes that differ from the receipt', async (t) => {
    const fixture = await distributionFixture(t);
    for (const format of ['esm', 'cjs']) {
        await write(
            fixture.root,
            `dist/${format}/runtime/contracts/generated.d.ts`,
            'export type ChangedFixture = number;\n'
        );
    }
    await assert.rejects(
        fixture.check(),
        /does not identify packaged declarations/
    );
});

test('public distribution rejects a different captured dependency hash', async (t) => {
    const fixture = await distributionFixture(t);
    const changed = structuredClone(fixture.provenance);
    changed.dependencies[0].inputSha256 = ['0'.repeat(64)];
    await write(
        fixture.root,
        'dist/esm/runtime/contracts/generated.provenance.json',
        JSON.stringify(changed)
    );
    await assert.rejects(fixture.check(), /differs from captured inputs/);
});

test('public distribution rejects an abbreviated dependency permission notice', async (t) => {
    const fixture = await distributionFixture(t);
    const notices = await readFile(
        join(fixture.root, 'THIRD_PARTY_NOTICES.md'),
        'utf8'
    );
    await write(
        fixture.root,
        'THIRD_PARTY_NOTICES.md',
        notices.replace(
            /```text\n[\s\S]*?\n```/,
            '```text\nMIT summary only\n```'
        )
    );
    await assert.rejects(
        fixture.check(),
        /Missing or modified full dependency license/
    );
});

async function deliveryFixture(t) {
    const root = await temporaryRoot(t);
    const outputParent = await temporaryRoot(t);
    const installedPackage = join(root, 'node_modules/@miniextensions/sdk');
    const filename = 'miniextensions-sdk-0.1.0-alpha.0.tgz';
    const archivePath = join(root, filename);
    const guide = '# Browser starter\nUse the supplied archive.\n';
    await write(installedPackage, 'docs/browser-lifecycle.md', guide);
    await write(root, 'package/docs/browser-lifecycle.md', guide);
    execFileSync('tar', ['-czf', archivePath, '-C', root, 'package']);
    const archive = await readFile(archivePath);
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

test('delivery rejects same-length installed guide drift', async (t) => {
    const fixture = await deliveryFixture(t);
    const guidePath = join(
        fixture.installedPackage,
        'docs/browser-lifecycle.md'
    );
    const guide = await readFile(guidePath, 'utf8');
    await writeFile(guidePath, guide.replace('supplied', 'modified'));
    assert.throws(
        () => retainCheckedPackage(fixture),
        /Installed guide bytes differ from the tested archive/
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

const packedTailResults = {
    attachment: { checks: 104, browserChecks: 90 },
    review: { checks: 51 },
};

async function waitForTailFile(root, name) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        try {
            return await readFile(join(root, name), 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`Packed tail fixture did not create ${name}`);
}

function assertTailGroupGone(pid) {
    assert.throws(() => process.kill(-Number(pid), 0), { code: 'ESRCH' });
}

async function packedTailFixture(t, plan = {}) {
    const root = await mkdtemp(join(tmpdir(), 'sdk-package-tail-guard-'));
    const observers = new Map();
    const createObserver = ({ pid }) => {
        const observer = createProcessGroupObserver({ pid });
        observers.set(pid, observer);
        return observer;
    };
    const groupState = async (pid) => {
        try {
            process.kill(-pid, 0);
        } catch (error) {
            if (error.code === 'ESRCH')
                return { state: 'gone', pid, members: [] };
            return {
                state: 'unresolved',
                pid,
                members: [],
                reason: `Process-group probe ${error.code ?? 'unknown'}`,
            };
        }
        const observer = observers.get(pid);
        if (!observer) return { state: 'unresolved', pid, members: [] };
        return observer.inspect();
    };
    const pidDrained = async (pid) => {
        try {
            process.kill(pid, 0);
        } catch (error) {
            return error.code === 'ESRCH';
        }
        for (const observer of observers.values()) {
            const state = await observer.inspectMember(pid);
            if (state.state === 'gone' || state.state === 'exited') return true;
        }
        return false;
    };
    // One owner handles termination, confirmed drain and eventual removal.
    // Preserve the PID evidence and root if any cleanup cannot be confirmed.
    t.after(async () => {
        const groups = [];
        const pids = [];
        for (const name of await readdir(root)) {
            if (
                !/^(?:(attachment|review)(\.grandchild)?|supervisor)\.pid$/.test(
                    name
                )
            )
                continue;
            const pid = Number(await readFile(join(root, name), 'utf8'));
            assert.ok(
                Number.isSafeInteger(pid) && pid > 1,
                `Invalid owned PID; retained fixture ${root}`
            );
            pids.push(pid);
            if (!name.includes('.grandchild.')) groups.push(pid);
        }
        for (const pid of observers.keys())
            if (!groups.includes(pid)) groups.push(pid);
        for (const pid of groups) {
            const state = await groupState(pid);
            if (state.state === 'gone' || state.state === 'exited') continue;
            const observer = observers.get(pid);
            if (observer) await observer.signal('SIGKILL');
        }
        const deadline = performance.now() + 3000;
        while (true) {
            const remaining = [];
            const states = await Promise.all(groups.map(groupState));
            for (const state of states)
                if (state.state !== 'gone' && state.state !== 'exited')
                    remaining.push(-state.pid);
            for (const pid of pids)
                if (!(await pidDrained(pid))) remaining.push(pid);
            if (remaining.length === 0) {
                await rm(root, { recursive: true, force: true });
                return;
            }
            assert.ok(
                performance.now() < deadline,
                `Cleanup unconfirmed for ${remaining.join(', ')} (${JSON.stringify(states)}); retained fixture ${root}`
            );
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
    });
    await write(root, 'plan.json', JSON.stringify(plan));
    await write(root, 'happy-dom-fixture.mjs', 'export {};\n');
    await write(
        root,
        'worker.mjs',
        `import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const [suite, directory, happyDomModulePath, ...extra] = process.argv.slice(2);
assert.deepEqual(extra, []);
assert.ok(suite === 'attachment' || suite === 'review');
assert.equal(happyDomModulePath, join(directory, 'happy-dom-fixture.mjs'));
const plan = JSON.parse(readFileSync(join(directory, 'plan.json'), 'utf8'));
const config = plan[suite] ?? {};
const file = (name) => join(directory, suite + '.' + name);
const wait = async (name) => {
    while (!existsSync(join(directory, name))) await delay(10);
};
const result = suite === 'attachment'
    ? { checks: 104, browserChecks: 90 } : { checks: 51 };
const report = { schemaVersion: 1, suite, result };
const send = (message) => new Promise((resolve, reject) => {
    process.send(message, (error) => error ? reject(error) : resolve());
});
const observe = (phase) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('fixture handshake timeout')), 10000);
    const finish = (error) => {
        clearTimeout(timer);
        process.off('message', acknowledged);
        if (error) reject(error); else resolve();
    };
    const acknowledged = (message) => {
        try { assert.deepEqual(message, { schemaVersion: 1, suite, phase, accepted: true }); finish(); }
        catch (error) { finish(error); }
    };
    process.on('message', acknowledged);
    void send({ schemaVersion: 1, suite, phase }).catch(finish);
});
if (config.exitSoon) setTimeout(() => process.exit(0), config.exitSoon);
writeFileSync(file('pid'), String(process.pid));
await observe('start');
if (config.mode === 'hang') {
    process.on('SIGTERM', async () => {
        writeFileSync(file('term'), 'SIGTERM');
        if (config.ignoreTerm) return;
        if (config.holdTerm) await wait(suite + '.release-term');
        writeFileSync(file('exited'), 'cooperative SIGTERM');
        process.exit(0);
    });
}
writeFileSync(file('ready'), 'ready');
await wait((suite === 'attachment' ? 'review' : 'attachment') + '.ready');
if (config.mode === 'hang') await new Promise(() => setInterval(() => {}, 1000));
if (config.mode === 'survivor') {
    const code = [
        "const fs = require('node:fs');",
        "fs.writeFileSync(process.argv[1] + '.pid', String(process.pid));",
        "process.on('SIGTERM', () => {",
        "fs.writeFileSync(process.argv[1] + '.term', 'SIGTERM');",
        "process.exit(0); });",
        "fs.writeFileSync(process.argv[1] + '.ready', 'ready');",
        "setInterval(() => {}, 1000);",
    ].join('');
    const child = spawn(process.execPath, ['-e', code, file('grandchild')], {
        stdio: 'ignore',
    });
    child.unref();
    await wait(suite + '.grandchild.ready');
}
if (!config.skipFinish) {
    await observe('finish');
    writeFileSync(file('finish-accepted'), 'accepted');
}
if (config.duplicateFinish) await observe('finish');
for (const message of config.reports ?? [report]) await send(message);
writeFileSync(file('reported'), 'reported');
if (config.hold) await wait(suite + '.release');
if (config.mode === 'throw') assert.fail('real packed tail fixture assertion');
if (config.mode === 'exit') process.exit(17);
process.disconnect();
`
    );
    const options = {
        consumerDirectory: root,
        happyDomModulePath: join(root, 'happy-dom-fixture.mjs'),
        workerFile: join(root, 'worker.mjs'),
        timeoutMs: 10000,
        terminationGraceMs: 100,
        drainTimeoutMs: 2000,
        createObserver,
    };
    return {
        root,
        options,
        async assertGroupsGone() {
            const states = [];
            for (const suite of ['attachment', 'review']) {
                const state = await groupState(
                    Number(await waitForTailFile(root, `${suite}.pid`))
                );
                assert.ok(
                    state.state === 'gone' || state.state === 'exited',
                    JSON.stringify(state)
                );
                states.push(state);
            }
            await write(
                root,
                'drain-observations.json',
                JSON.stringify(states)
            );
            return states;
        },
        async assertPidDrained(pid) {
            const states = await this.assertGroupsGone();
            assert.equal(await pidDrained(pid), true);
        },
        async registerSupervisor(pid) {
            const observer = createObserver({ pid });
            const deadline = performance.now() + 3000;
            let state;
            do {
                state = await observer.capture();
                if (state.state === 'live') return;
                await new Promise((resolve) => setTimeout(resolve, 25));
            } while (performance.now() < deadline);
            assert.equal(state.state, 'live', JSON.stringify(state));
        },
    };
}

function assertTailFailure(error, suite, cleanupSafe = true) {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.cleanupSafe, cleanupSafe);
    assert.match(
        error.errors.map((failure) => failure.message).join('\n'),
        new RegExp(suite)
    );
    return true;
}

test('packed tail maps both real workers and waits for close after valid IPC', async (t) => {
    const fixture = await packedTailFixture(t, {
        attachment: { hold: true },
        review: { hold: true },
    });
    let settled = false;
    const running = runPackedTailChecks(fixture.options).then(
        (result) => ({ result }),
        (error) => ({ error })
    );
    void running.then(() => {
        settled = true;
    });
    await Promise.race([
        Promise.all(
            ['attachment', 'review'].map((suite) =>
                waitForTailFile(fixture.root, `${suite}.reported`)
            )
        ),
        running.then((outcome) => {
            if (outcome.error) throw outcome.error;
            assert.fail('Workers completed before their explicit releases');
        }),
    ]);
    assert.equal(settled, false, 'valid IPC cannot stand in for child close');
    await write(fixture.root, 'attachment.release', 'release');
    assert.equal(settled, false, 'both owned children must close');
    await write(fixture.root, 'review.release', 'release');
    const outcome = await running;
    assert.equal(outcome.error, undefined);
    assert.deepEqual(outcome.result, packedTailResults);
    await fixture.assertGroupsGone();
});

test('packed tail rejects missing, malformed, mismatched and duplicate IPC', async (t) => {
    const report = {
        schemaVersion: 1,
        suite: 'attachment',
        result: packedTailResults.attachment,
    };
    const cases = [
        ['missing', []],
        ['malformed', ['not a report']],
        ['schema', [{ ...report, schemaVersion: 2 }]],
        ['suite', [{ ...report, suite: 'review' }]],
        ['result', [{ ...report, result: { checks: 104, browserChecks: 89 } }]],
        ['extra report field', [{ ...report, extra: true }]],
        [
            'extra result field',
            [{ ...report, result: { ...report.result, extra: true } }],
        ],
        ['duplicate', [report, report]],
    ];
    for (const [name, reports] of cases) {
        await t.test(name, async (t) => {
            const fixture = await packedTailFixture(t, {
                attachment: { reports },
            });
            await assert.rejects(
                runPackedTailChecks(fixture.options),
                (error) => {
                    assertTailFailure(error, 'attachment');
                    assert.match(
                        error.errors.map((item) => item.message).join('\n'),
                        name === 'missing'
                            ? /Missing single valid result/
                            : /Invalid worker result/
                    );
                    return true;
                }
            );
            assert.equal(
                await waitForTailFile(fixture.root, 'attachment.ready'),
                'ready'
            );
            assert.equal(
                await waitForTailFile(
                    fixture.root,
                    'attachment.finish-accepted'
                ),
                'accepted'
            );
            await fixture.assertGroupsGone();
        });
    }
});

test('packed tail rejects real assertion and nonzero exits after valid IPC and drains its peer', async (t) => {
    for (const mode of ['throw', 'exit']) {
        await t.test(mode, async (t) => {
            const fixture = await packedTailFixture(t, {
                attachment: { mode },
                review: { mode: 'hang', holdTerm: true },
            });
            let settled = false;
            const running = runPackedTailChecks({
                ...fixture.options,
                terminationGraceMs: 2000,
            }).then(
                () => ({ succeeded: true }),
                (error) => ({ error })
            );
            void running.then(() => {
                settled = true;
            });
            await waitForTailFile(fixture.root, 'review.term');
            assert.equal(settled, false, 'failure must drain the active peer');
            await write(fixture.root, 'review.release-term', 'release');
            const outcome = await running;
            assertTailFailure(outcome.error, 'attachment');
            assert.match(
                outcome.error.errors.map((item) => item.message).join('\n'),
                new RegExp(
                    `Worker exit code ${mode === 'throw' ? 1 : 17}, signal null`
                )
            );
            assert.equal(
                await waitForTailFile(
                    fixture.root,
                    'attachment.finish-accepted'
                ),
                'accepted'
            );
            assert.equal(
                await waitForTailFile(fixture.root, 'attachment.reported'),
                'reported'
            );
            assert.equal(
                await readFile(join(fixture.root, 'review.exited'), 'utf8'),
                'cooperative SIGTERM'
            );
            await fixture.assertGroupsGone();
        });
    }
});

test('packed tail times out and reaps children after SIGTERM or forced SIGKILL', async (t) => {
    for (const ignoreTerm of [false, true]) {
        await t.test(
            ignoreTerm ? 'SIGKILL escalation' : 'SIGTERM',
            async (t) => {
                const fixture = await packedTailFixture(t, {
                    attachment: { mode: 'hang', ignoreTerm },
                    review: { mode: 'hang', ignoreTerm },
                });
                await assert.rejects(
                    runPackedTailChecks({
                        ...fixture.options,
                        timeoutMs: 1000,
                    }),
                    (error) => {
                        assertTailFailure(error, 'attachment|review');
                        assert.match(
                            error.errors
                                .map((failure) => failure.message)
                                .join('\n'),
                            /Worker timed out/
                        );
                        return true;
                    }
                );
                for (const suite of ['attachment', 'review']) {
                    assert.equal(
                        await waitForTailFile(fixture.root, `${suite}.ready`),
                        'ready'
                    );
                    assert.equal(
                        await readFile(
                            join(fixture.root, `${suite}.term`),
                            'utf8'
                        ),
                        'SIGTERM'
                    );
                    if (ignoreTerm) {
                        await assert.rejects(
                            readFile(join(fixture.root, `${suite}.exited`)),
                            { code: 'ENOENT' }
                        );
                    } else {
                        assert.equal(
                            await readFile(
                                join(fixture.root, `${suite}.exited`),
                                'utf8'
                            ),
                            'cooperative SIGTERM'
                        );
                    }
                }
                await fixture.assertGroupsGone();
            }
        );
    }
});

test('packed tail rejects a zero-exit worker with an owned live grandchild and proves operational group drain', async (t) => {
    const fixture = await packedTailFixture(t, {
        attachment: { mode: 'survivor' },
    });
    let drainFailure;
    await assert.rejects(runPackedTailChecks(fixture.options), (error) => {
        drainFailure = error;
        assertTailFailure(error, 'attachment');
        assert.match(
            error.errors.map((item) => item.message).join('\n'),
            /Process group survived worker close/
        );
        return true;
    });
    assert.equal(
        await waitForTailFile(fixture.root, 'attachment.finish-accepted'),
        'accepted'
    );
    assert.equal(
        await readFile(
            join(fixture.root, 'attachment.grandchild.term'),
            'utf8'
        ).catch((error) => {
            // Preserve the actual signal/refusal evidence if the marker is absent.
            error.cause = drainFailure;
            throw error;
        }),
        'SIGTERM'
    );
    const grandchildPid = Number(
        await readFile(join(fixture.root, 'attachment.grandchild.pid'), 'utf8')
    );
    await fixture.assertPidDrained(grandchildPid);
    await fixture.assertGroupsGone();
});

test('packed tail retries transient TERM admission and preserves fail-closed escalation', async (t) => {
    for (const permanent of [false, true]) {
        await t.test(
            permanent ? 'persistent refusal' : 'transient refusal',
            async (t) => {
                const fixture = await packedTailFixture(t, {
                    attachment: { mode: 'survivor' },
                });
                const attempts = [];
                const createObserver = (options) => {
                    const observer = fixture.options.createObserver(options);
                    let refused = false;
                    return {
                        ...observer,
                        async signal(name) {
                            if (name === 'SIGTERM' && (permanent || !refused)) {
                                refused = true;
                                attempts.push({ name, admitted: false });
                                return {
                                    state: 'unresolved',
                                    reason: 'Transient proc stat disappeared during ownership proof',
                                    pid: options.pid,
                                    members: [],
                                };
                            }
                            const state = await observer.signal(name);
                            attempts.push({
                                name,
                                admitted: state.state === 'live',
                            });
                            return state;
                        },
                    };
                };
                await assert.rejects(
                    runPackedTailChecks({ ...fixture.options, createObserver }),
                    (error) => {
                        assertTailFailure(error, 'attachment');
                        assert.match(
                            error.errors.map((item) => item.message).join('\n'),
                            /Cannot safely send SIGTERM/
                        );
                        return true;
                    }
                );
                const marker = readFile(
                    join(fixture.root, 'attachment.grandchild.term'),
                    'utf8'
                );
                if (permanent) {
                    await assert.rejects(marker, { code: 'ENOENT' });
                    assert.equal(
                        attempts.filter(
                            (event) =>
                                event.name === 'SIGTERM' && event.admitted
                        ).length,
                        0
                    );
                    assert.equal(
                        attempts.filter(
                            (event) =>
                                event.name === 'SIGKILL' && event.admitted
                        ).length,
                        1
                    );
                } else {
                    assert.equal(await marker, 'SIGTERM');
                    assert.deepEqual(attempts, [
                        { name: 'SIGTERM', admitted: false },
                        { name: 'SIGTERM', admitted: true },
                    ]);
                }
                const grandchildPid = Number(
                    await readFile(
                        join(fixture.root, 'attachment.grandchild.pid'),
                        'utf8'
                    )
                );
                await fixture.assertPidDrained(grandchildPid);
                await fixture.assertGroupsGone();
            }
        );
    }
});

test('packed tail rejects missing or repeated finish acknowledgement before accepting a result', async (t) => {
    for (const plan of [{ skipFinish: true }, { duplicateFinish: true }]) {
        await t.test(JSON.stringify(plan), async (t) => {
            const fixture = await packedTailFixture(t, { attachment: plan });
            await assert.rejects(
                runPackedTailChecks(fixture.options),
                (error) => {
                    assertTailFailure(error, 'attachment');
                    assert.match(
                        error.errors.map((item) => item.message).join('\n'),
                        plan.skipFinish
                            ? /Invalid worker result/
                            : /Invalid worker cohort handshake/
                    );
                    return true;
                }
            );
            assert.equal(
                await waitForTailFile(fixture.root, 'attachment.ready'),
                'ready'
            );
            if (plan.duplicateFinish)
                assert.equal(
                    await waitForTailFile(
                        fixture.root,
                        'attachment.finish-accepted'
                    ),
                    'accepted'
                );
            await fixture.assertGroupsGone();
        });
    }
});

test('an observer constructor failure after fork retains unsafe cleanup without signalling an unobserved child', async (t) => {
    const fixture = await packedTailFixture(t, {
        attachment: { exitSoon: 1000 },
        review: { exitSoon: 1000 },
    });
    const pids = [];
    await assert.rejects(
        runPackedTailChecks({
            ...fixture.options,
            terminationGraceMs: 20,
            drainTimeoutMs: 50,
            createObserver(options) {
                fixture.options.createObserver(options);
                pids.push(options.pid);
                throw new Error(
                    'Expected observer constructor failure after fork'
                );
            },
        }),
        (error) => {
            assertTailFailure(error, 'attachment', false);
            assert.match(
                error.errors.map((item) => item.message).join('\n'),
                /launch failed/
            );
            return true;
        }
    );
    assert.equal(pids.length, 2);
    for (const pid of pids) process.kill(pid, 0);
    // The owned fixture children self-exit; teardown observes ESRCH before rm.
    assert.ok((await readdir(fixture.root)).includes('plan.json'));
});

test('packed tail reports spawn errors with suite identity and safely drains both attempts', async (t) => {
    const fixture = await packedTailFixture(t);
    await assert.rejects(
        runPackedTailChecks({
            ...fixture.options,
            execPath: join(fixture.root, 'missing-node-executable'),
        }),
        (error) => {
            assertTailFailure(error, 'attachment');
            assert.match(
                error.errors.map((failure) => failure.message).join('\n'),
                /review/
            );
            return true;
        }
    );
});

test('packed tail drains real workers before a signalled child supervisor rejects', async (t) => {
    for (const signal of ['SIGINT', 'SIGTERM']) {
        await t.test(signal, { timeout: 15000 }, async (t) => {
            const fixture = await packedTailFixture(t, {
                attachment: { mode: 'hang' },
                review: { mode: 'hang' },
            });
            const helperUrl = new URL(
                './packed-tail-checks.mjs',
                import.meta.url
            );
            await write(
                fixture.root,
                'supervisor.mjs',
                `import { runPackedTailChecks } from ${JSON.stringify(helperUrl.href)};
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const options = ${JSON.stringify(fixture.options)};
const gone = (target) => {
    try { process.kill(target, 0); return false; }
    catch (error) { if (error.code === 'ESRCH') return true; throw error; }
};
let outcome;
try {
    await runPackedTailChecks(options);
    outcome = { succeeded: true };
} catch (error) {
    outcome = {
        name: error.name,
        cleanupSafe: error.cleanupSafe,
        messages: error.errors.map((failure) => failure.message),
        workers: Object.fromEntries(['attachment', 'review'].map((suite) => {
            const pid = Number(readFileSync(join(options.consumerDirectory, suite + '.pid'), 'utf8'));
            return [suite, { pidGone: gone(pid), groupGone: gone(-pid) }];
        })),
    };
    process.exitCode = 23;
}
writeFileSync(join(options.consumerDirectory, 'supervisor.outcome.json'), JSON.stringify(outcome));
`
            );
            const supervisor = spawn(
                process.execPath,
                [join(fixture.root, 'supervisor.mjs')],
                { detached: true, stdio: 'ignore' }
            );
            const completion = new Promise((resolve) => {
                supervisor.once('error', (error) => resolve({ error }));
                supervisor.once('close', (code, exitSignal) =>
                    resolve({ code, exitSignal })
                );
            });
            assert.ok(supervisor.pid);
            await write(fixture.root, 'supervisor.pid', String(supervisor.pid));
            await fixture.registerSupervisor(supervisor.pid);
            await Promise.all(
                ['attachment', 'review'].map((suite) =>
                    waitForTailFile(fixture.root, `${suite}.ready`)
                )
            );
            process.kill(supervisor.pid, signal);
            const exit = await completion;
            assert.equal(exit.error, undefined);
            assert.equal(exit.code, 23);
            assert.equal(exit.exitSignal, null);
            const outcome = JSON.parse(
                await readFile(
                    join(fixture.root, 'supervisor.outcome.json'),
                    'utf8'
                )
            );
            assert.equal(outcome.name, 'AggregateError');
            assert.equal(outcome.cleanupSafe, true);
            assert.match(
                outcome.messages.join('\n'),
                new RegExp(`Parent received ${signal}`)
            );
            assert.deepEqual(outcome.workers, {
                attachment: { pidGone: true, groupGone: true },
                review: { pidGone: true, groupGone: true },
            });
            await fixture.assertGroupsGone();
            assertTailGroupGone(supervisor.pid);
        });
    }
});

test('packed tail allows healthy cohort capture beyond termination grace within the worker deadline', async (t) => {
    const fixture = await packedTailFixture(t, {
        attachment: { hold: true },
        review: { hold: true },
    });
    assert.equal(fixture.options.terminationGraceMs, 100);
    assert.equal(fixture.options.timeoutMs, 10000);
    const captures = [];
    let completed = false;
    const running = runPackedTailChecks({
        ...fixture.options,
        createObserver(options) {
            const observer = fixture.options.createObserver(options);
            return {
                ...observer,
                async capture() {
                    const started = performance.now();
                    await new Promise((resolve) => setTimeout(resolve, 150));
                    const observation = await observer.capture();
                    captures.push({
                        pid: options.pid,
                        elapsedMs: performance.now() - started,
                        state: observation.state,
                    });
                    return observation;
                },
            };
        },
    }).then(
        (result) => {
            completed = true;
            return { result };
        },
        (error) => {
            completed = true;
            return { error };
        }
    );
    const reported = (async () => {
        while (!completed) {
            try {
                await Promise.all(
                    ['attachment', 'review'].map((suite) =>
                        readFile(
                            join(fixture.root, `${suite}.reported`),
                            'utf8'
                        )
                    )
                );
                return { reported: true };
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return null;
    })();
    const first = await Promise.race([running, reported]);
    if (first === null || !Object.hasOwn(first, 'reported')) {
        const outcome = first ?? (await running);
        if (outcome.error) throw outcome.error;
        assert.fail('Healthy held workers completed before both reports.');
    }
    assert.equal(
        completed,
        false,
        'Valid IPC must not bypass held worker close.'
    );
    const workerPids = [];
    for (const suite of ['attachment', 'review']) {
        const pid = Number(
            await readFile(join(fixture.root, `${suite}.pid`), 'utf8')
        );
        process.kill(pid, 0);
        workerPids.push(pid);
    }
    const acceptedCaptures = captures.filter(
        (capture) => capture.state === 'live'
    );
    assert.equal(acceptedCaptures.length, 4);
    for (const pid of workerPids) {
        const owned = acceptedCaptures.filter((capture) => capture.pid === pid);
        assert.equal(
            owned.length,
            2,
            'Both start and finish must be captured.'
        );
        assert.ok(owned.every((capture) => capture.elapsedMs > 100));
    }
    await Promise.all(
        ['attachment', 'review'].map((suite) =>
            write(fixture.root, `${suite}.release`, 'explicit close release')
        )
    );
    const outcome = await running;
    if (outcome.error) throw outcome.error;
    assert.deepEqual(outcome.result, packedTailResults);
    await fixture.assertGroupsGone();
});
