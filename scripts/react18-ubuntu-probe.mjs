import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
    rmSync, writeFileSync,
} from 'node:fs';
import { arch, cpus, platform, tmpdir, totalmem } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cutoff = '2026-11-17T05:52:12.756Z';
const filename = 'miniextensions-sdk-0.1.0-alpha.0.tgz';
const archiveSha256 = '516ff8327a2aaf07e4323b9fb7e2d749492ab2a25b764943f4bb885bc415a15a';
const archiveIntegrity = 'sha512-1AbSFfL3INKjflUvsqxdBwq50W+rkJBv3GQBpslYSU1ZFluwLABMMbrCIMhCIRIwVqp17qfMW6oBhyVhUpa10A==';
const arms = [
    {
        name: 'original',
        head: '55a621b5d0586a6e8a0f5d2640d89ce3e91ec04f',
        tree: '62be4ef0803b27001553f84846c338f5a493a33b',
        installerSha256: '524ed1376f9852e11f54f6b20fa53ee0bebc9d27775f58d8e6595cc1b824a518',
    },
    {
        name: 'batched',
        head: '103e949477a2f973a8d4b120fed91052efd0e3be',
        tree: '7796c61b6709f78683d9f972c9ad12ae51ef813b',
        installerSha256: 'bf4a9ec6aa861775d2ebb5aa09ac80f3af2a2bee2a5c6b45ad935ea27c3412f8',
    },
];
const ageScriptSha256 = '4e330a48e58928531a0e78f2fad6d639a8a747bc248fd64ed0c131ab00919ad6';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const run = (command, args, cwd) =>
    execFileSync(command, args, { cwd, timeout: 20_000 });

function verifyInputs(checkout, kit) {
    const archive = readFileSync(join(kit, filename));
    const kitReceipt = readJson(join(kit, 'artifact-receipt.json'));
    assert.equal(sha256(archive), archiveSha256);
    assert.equal('sha512-' + createHash('sha512').update(archive).digest('base64'), archiveIntegrity);
    assert.deepEqual(kitReceipt.package, {
        name: '@miniextensions/sdk', version: '0.1.0-alpha.0',
        filename, bytes: archive.length, sha256: archiveSha256,
        integrity: archiveIntegrity, files: 2638,
    });
    assert.deepEqual(kitReceipt.source, { commit: arms[0].head, tree: arms[0].tree });
    assert.equal(kitReceipt.ci.repository, 'miniExtensions/sdk');
    assert.equal(kitReceipt.ci.runId, '44476524324');
    assert.equal(kitReceipt.ci.runAttempt, '1');
    assert.equal(kitReceipt.verification.outcome, 'passed');
    for (const arm of arms) {
        assert.equal(run('git', ['rev-parse', arm.head + '^{tree}'], checkout).toString().trim(), arm.tree);
    }
    const gitFile = (arm, path) => run('git', ['show', arm.head + ':' + path], checkout);
    const ageScript = gitFile(arms[0], 'scripts/npm-release-age.mjs');
    assert.equal(sha256(ageScript), ageScriptSha256);
    assert.deepEqual(gitFile(arms[1], 'scripts/npm-release-age.mjs'), ageScript);
    const sources = arms.map((arm) => {
        const source = gitFile(arm, 'scripts/age-qualified-consumer-install.mjs');
        assert.equal(sha256(source), arm.installerSha256);
        return source;
    });
    return { archive, kitReceipt, sources, ageScript };
}

export function normalizeArchiveReferences(bytes, archivePath, consumerPath) {
    const marker = 'file:<sdk-archive>';
    const text = bytes.toString('utf8');
    assert(!text.includes(marker));
    const reference = (path) => new RegExp(
        'file:' + path.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&') + '(?=[\\s\'"(),}]|$)',
        'g',
    );
    return text
        .replace(reference(archivePath), marker)
        .replace(reference(relative(consumerPath, archivePath)), marker);
}

const captureNames = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'consumer-age-install-receipts.json',
];

export function validateCapture(directory, receipt, archivePath, consumerPath) {
    const files = captureNames.map((name) => readFileSync(join(directory, name)));
    const [manifest, lock, , rawReceipt] = files;
    assert.deepEqual(JSON.parse(rawReceipt), [receipt]);
    assert.equal(JSON.parse(manifest).dependencies['@miniextensions/sdk'], 'file:' + archivePath);
    assert.deepEqual(receipt, {
        manifestSha256: sha256(manifest), lockSha256: sha256(lock),
        archiveSha256, minimumReleaseAge: 2880, exclusions: [], files: 2638,
        sdkCopies: ['@miniextensions/sdk'], earlierNpmLockPreserved: false,
    });
    assert(lock.includes(archiveIntegrity));
    const normalized = [manifest, lock].map((bytes) => {
        const contents = normalizeArchiveReferences(bytes, archivePath, consumerPath);
        assert(contents.includes('file:<sdk-archive>'));
        return contents;
    });
    return { files, normalized };
}

export function createInstallTimer(now = () => performance.now()) {
    const report = {
        clock: 'monotonic performance.now()',
        unit: 'milliseconds',
        boundary: 'Synchronous installAgeQualifiedConsumer call from entry to return. Includes policy checks, fresh pnpm install, installed-archive verification, receipt writing and internal archive-proof cleanup. Excludes driver setup, evidence capture and comparison, and consumer/cache teardown.',
        arms: [],
    };
    return {
        report,
        measure(name, install) {
            const start = now();
            const receipt = install();
            report.arms.push({ name, durationMs: now() - start });
            return receipt;
        },
    };
}

async function measure(inputs, destination) {
    assert.equal(platform(), 'linux', 'Use an isolated Ubuntu executor');
    assert.equal(arch(), 'x64');
    assert.match(readFileSync('/etc/os-release', 'utf8'), /^ID="?ubuntu"?$/m);
    assert.equal(process.version, 'v24.22.2');
    const output = resolve(destination);
    mkdirSync(output, { mode: 0o700 });
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sdk-react18-lock-probe-')));
    const environmentKeys = [
        'npm_config_before', 'npm_config_cache', 'npm_config_store_dir',
        'npm_config_userconfig', 'npm_config_globalconfig', 'XDG_CACHE_HOME',
        'COREPACK_ENABLE_AUTO_PIN', 'COREPACK_ENABLE_NETWORK',
        ...Object.keys(process.env).filter((key) => key.toLowerCase() === 'npm_config_before'),
    ];
    const previous = new Map(environmentKeys.map((key) => [key, process.env[key]]));
    let result;
    try {
        const consumer = join(root, 'consumer');
        const cache = join(root, 'cache');
        const archive = join(root, filename);
        writeFileSync(archive, inputs.archive, { mode: 0o400 });
        writeFileSync(join(root, 'npm-release-age.mjs'), inputs.ageScript);
        const { enforceNpmReleaseAge } = await import(pathToFileURL(join(root, 'npm-release-age.mjs')));
        assert(
            environmentKeys.filter((key) => key.toLowerCase() === 'npm_config_before')
                .every((key) => previous.get(key) === undefined || Date.parse(previous.get(key)) >= Date.parse(cutoff)),
            'An inherited stricter or invalid npm cutoff must not be overridden',
        );
        for (const key of previous.keys()) {
            if (key.toLowerCase() === 'npm_config_before') delete process.env[key];
        }
        Object.assign(process.env, {
            npm_config_before: cutoff,
            npm_config_cache: join(cache, 'npm'),
            npm_config_store_dir: join(cache, 'store'),
            npm_config_userconfig: join(cache, 'user.npmrc'),
            npm_config_globalconfig: join(cache, 'global.npmrc'),
            XDG_CACHE_HOME: join(cache, 'xdg'),
            COREPACK_ENABLE_AUTO_PIN: '0',
            COREPACK_ENABLE_NETWORK: '0',
        });
        const captures = [];
        const installTimer = createInstallTimer();
        for (const [index, arm] of arms.entries()) {
            for (const directory of [consumer, cache]) {
                assert(!existsSync(directory));
                mkdirSync(directory, { mode: 0o700 });
            }
            writeFileSync(process.env.npm_config_userconfig, '');
            writeFileSync(process.env.npm_config_globalconfig, '');
            assert.equal(enforceNpmReleaseAge(), cutoff);
            assert.equal(run('pnpm', ['--version'], consumer).toString().trim(), '10.28.2');
            const store = JSON.parse(run('pnpm', ['config', 'get', 'store-dir', '--json'], consumer));
            assert.equal(store, process.env.npm_config_store_dir, 'Effective pnpm store is outside the cold arm');
            assert(!existsSync(store));
            const installSource = join(root, arm.name + '.mjs');
            writeFileSync(installSource, inputs.sources[index]);
            const { installAgeQualifiedConsumer } = await import(pathToFileURL(installSource));
            writeFileSync(join(consumer, 'package.json'), JSON.stringify({
                private: true,
                type: 'module',
                dependencies: {
                    '@miniextensions/sdk': 'file:' + archive,
                    react: '18.3.1',
                    'react-dom': '18.3.1',
                    '@types/react': '18.3.12',
                    '@types/react-dom': '18.3.1',
                },
            }));
            const receipt = installTimer.measure(arm.name, () =>
                installAgeQualifiedConsumer({ directory: consumer, args: ['install'] })
            );
            const evidence = join(output, arm.name);
            mkdirSync(evidence, { mode: 0o700 });
            for (const name of captureNames) {
                const from = join(consumer, name);
                assert(lstatSync(from).isFile());
                writeFileSync(join(evidence, name), readFileSync(from), { flag: 'wx' });
            }
            captures.push(validateCapture(evidence, receipt, archive, consumer));
            assert.equal(sha256(readFileSync(archive)), archiveSha256);
            for (const directory of [consumer, cache]) {
                rmSync(directory, { recursive: true });
                assert(!existsSync(directory));
            }
        }
        assert.deepEqual(captures[0].files, captures[1].files, 'Raw same-layout evidence differs');
        assert.deepEqual(captures[0].normalized, captures[1].normalized, 'Normalized evidence differs');
        result = {
            outcome: 'passed', arms, archiveSha256, archiveIntegrity, cutoff,
            kit: inputs.kitReceipt.ci, react: '18.3.1', node: process.version, pnpm: '10.28.2',
            os: readFileSync('/etc/os-release', 'utf8'), arch: arch(),
            imageOS: process.env.ImageOS ?? null, imageVersion: process.env.ImageVersion ?? null,
            cpus: cpus().length, memoryBytes: totalmem(),
            rawEqual: true, normalizedEqual: true,
            normalizedLockSha256: sha256(captures[0].normalized[1]),
            installTiming: installTimer.report,
        };
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        rmSync(root, { recursive: true });
        assert(!existsSync(root));
    }
    writeFileSync(join(output, 'comparison.json'), JSON.stringify({ ...result, cleanup: 'completed' }, null, 2) + '\n', { flag: 'wx' });
}

if (process.argv[1] && existsSync(process.argv[1]) &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [mode, checkout, kit, output, ...extra] = process.argv.slice(2);
    assert(
        checkout && kit && extra.length === 0 && (
            (mode === '--verify' && !output) || (mode === '--run' && output)
        ),
        'Usage: node react18-ubuntu-probe.mjs --verify SDK_CHECKOUT BASELINE_KIT | --run SDK_CHECKOUT BASELINE_KIT NEW_OUTPUT',
    );
    const inputs = verifyInputs(checkout, kit);
    if (mode === '--verify') {
        console.log(JSON.stringify({ archiveSha256, archiveIntegrity, cutoff, arms, installs: 0 }));
    } else {
        await measure(inputs, output);
    }
}
