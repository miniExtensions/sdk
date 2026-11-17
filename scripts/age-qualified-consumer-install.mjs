import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const consumerAgePolicy = Object.freeze({
    nodeLinker: 'hoisted',
    minimumReleaseAge: 2880,
    minimumReleaseAgeExclude: Object.freeze([]),
    blockExoticSubdeps: true,
    strictPeerDependencies: true,
    ignoreScripts: true,
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function files(root, prefix = '') {
    return readdirSync(join(root, prefix), { withFileTypes: true })
        .flatMap((entry) => {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) return files(root, path);
            assert(entry.isFile(), 'Consumer SDK contains a non-file');
            return path;
        })
        .sort();
}

/** Preserve callers' cwd, capture, timeout and existing recipe assertions. */
export function runAgeQualifiedConsumerInstall(run, args) {
    const result = run(process.execPath, [
        fileURLToPath(import.meta.url),
        ...args,
    ]);
    if (typeof result === 'string') process.stdout.write(result);
    return result;
}

export function installAgeQualifiedConsumer({
    directory = process.cwd(),
    args,
    execute = (command, argv, cwd) =>
        execFileSync(command, argv, {
            cwd,
            encoding: 'utf8',
            timeout: 120000,
            env: {
                ...process.env,
                COREPACK_ENABLE_AUTO_PIN: '0',
                COREPACK_ENABLE_NETWORK: '0',
            },
        }),
}) {
    assert.equal(args[0], 'install');
    const root = realpathSync(directory);
    const fromTemp = relative(realpathSync(tmpdir()), root);
    assert(
        fromTemp &&
            !isAbsolute(fromTemp) &&
            fromTemp !== '..' &&
            !fromTemp.startsWith('../'),
        'Consumer must be an owned temporary directory'
    );
    const manifest = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8')
    );
    assert.equal(manifest.private, true);
    const dependencies = { ...manifest.dependencies };
    for (let index = 1; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--cache') {
            // Legacy npm scratch-cache selection has no pnpm equivalent here.
            // Consume only an owned child path; pnpm uses its normal store.
            assert(typeof args[index + 1] === 'string');
            const cache = relative(root, resolve(root, args[++index]));
            assert(
                cache &&
                    !isAbsolute(cache) &&
                    cache !== '..' &&
                    !cache.startsWith('../')
            );
            continue;
        }
        if (arg.startsWith('--')) {
            assert(
                [
                    '--ignore-scripts',
                    '--strict-peer-deps',
                    '--no-audit',
                    '--no-fund',
                    '--package-lock=false',
                    '--save-exact',
                ].includes(arg),
                `Unsupported consumer install option: ${arg}`
            );
            continue;
        }
        const at = arg.lastIndexOf('@');
        assert(at > 0, 'Consumer dependencies must use explicit versions');
        dependencies[arg.slice(0, at)] = arg.slice(at + 1);
    }
    const sdkSpec = dependencies['@miniextensions/sdk'];
    assert(
        sdkSpec?.startsWith('file:'),
        'Consumer must install the actual packed SDK'
    );
    const archivePath = realpathSync(resolve(root, sdkSpec.slice(5)));
    const sdkCopies = ['@miniextensions/sdk'];
    for (const [name, version] of Object.entries(dependencies)) {
        if (name === '@miniextensions/sdk') continue;
        if (version.startsWith('file:')) {
            // The HTML isolation proof deliberately installs a second actual
            // copy. Admit only a named SDK alias of this exact local archive.
            assert.match(name, /^@miniextensions\/sdk-[a-z0-9-]+$/);
            assert.equal(
                realpathSync(resolve(root, version.slice(5))),
                archivePath,
                'SDK alias must use the exact admitted archive'
            );
            sdkCopies.push(name);
            continue;
        }
        assert.match(
            version,
            /^(?:npm:(?:@[^/@]+\/)?[^/@]+@)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
            'Consumer dependencies require exact registry versions'
        );
    }
    assert(lstatSync(archivePath).isFile());
    const archive = readFileSync(archivePath);
    const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
    const npmLockPath = join(root, 'package-lock.json');
    const npmLock = existsSync(npmLockPath) ? readFileSync(npmLockPath) : null;
    const nextManifest = {
        ...manifest,
        packageManager: 'pnpm@10.28.2',
        dependencies,
    };
    const policyText =
        Object.entries(consumerAgePolicy)
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join('\n') + '\n';
    const policyPath = join(root, 'pnpm-workspace.yaml');
    if (existsSync(policyPath))
        assert.equal(readFileSync(policyPath, 'utf8'), policyText);
    writeFileSync(join(root, 'package.json'), JSON.stringify(nextManifest));
    writeFileSync(policyPath, policyText);
    const pnpm = (argv) => execute('pnpm', argv, root);
    assert.equal(pnpm(['--version']).trim(), '10.28.2');
    for (const [key, value] of Object.entries(consumerAgePolicy))
        assert.deepEqual(
            JSON.parse(pnpm(['config', 'get', key, '--json'])),
            value,
            `Consumer policy differs: ${key}`
        );
    const lockPath = join(root, 'pnpm-lock.yaml');
    const receiptsPath = join(root, 'consumer-age-install-receipts.json');
    const receipts = existsSync(receiptsPath)
        ? JSON.parse(readFileSync(receiptsPath, 'utf8'))
        : [];
    if (existsSync(lockPath)) {
        // These are fresh, owned matrix profiles, not retained-lock consumers.
        // Retire only the exact previous profile lock already proven here.
        assert.equal(
            sha(readFileSync(lockPath)),
            receipts.at(-1)?.lockSha256,
            'Unrecognized consumer lock requires separate retained-lock admission'
        );
        rmSync(lockPath);
    }
    const modules = join(root, 'node_modules');
    if (existsSync(modules)) {
        assert(lstatSync(modules).isDirectory());
        assert.equal(realpathSync(modules), modules);
        rmSync(modules, { recursive: true });
    }
    pnpm(['install', '--strict-peer-dependencies', '--ignore-scripts']);
    assert.equal(readFileSync(policyPath, 'utf8'), policyText);
    assert.deepEqual(
        JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
        nextManifest
    );
    assert.deepEqual(
        readFileSync(archivePath),
        archive,
        'Packed SDK archive changed'
    );
    if (npmLock)
        assert.deepEqual(
            readFileSync(npmLockPath),
            npmLock,
            'Earlier npm provenance changed'
        );
    else
        assert(!existsSync(npmLockPath), 'pnpm must not fabricate an npm lock');
    assert(lstatSync(lockPath).isFile());
    const lock = readFileSync(lockPath);
    assert(
        lock.toString().includes(integrity),
        'pnpm lock omitted SDK archive integrity'
    );
    const expected = mkdtempSync(join(root, 'sdk-archive-proof-'));
    try {
        const members = execFileSync('tar', ['-tzf', '-'], {
            input: archive,
            encoding: 'utf8',
        })
            .trim()
            .split('\n');
        for (const member of members)
            assert(
                member.startsWith('package/') &&
                    !member.includes('\\') &&
                    !member.split('/').includes('..')
            );
        execFileSync('tar', ['-xz', '-C', expected], { input: archive });
        const expectedRoot = join(expected, 'package');
        assert.equal(
            JSON.parse(readFileSync(join(expectedRoot, 'package.json'), 'utf8'))
                .name,
            '@miniextensions/sdk'
        );
        const expectedFiles = files(expectedRoot);
        for (const name of sdkCopies) {
            const installed = join(modules, name);
            assert(lstatSync(installed).isDirectory());
            assert.equal(realpathSync(installed), installed);
            assert.deepEqual(files(installed), expectedFiles);
            for (const path of expectedFiles)
                assert.deepEqual(
                    readFileSync(join(installed, path)),
                    readFileSync(join(expectedRoot, path)),
                    `Installed SDK archive bytes differ: ${name}/${path}`
                );
        }
        const receipt = {
            manifestSha256: sha(readFileSync(join(root, 'package.json'))),
            minimumReleaseAge: 2880,
            exclusions: [],
            lockSha256: sha(lock),
            archiveSha256: sha(archive),
            files: expectedFiles.length,
            sdkCopies,
            earlierNpmLockPreserved: npmLock !== null,
        };
        receipts.push(receipt);
        writeFileSync(receiptsPath, JSON.stringify(receipts, null, 2) + '\n');
        return receipt;
    } finally {
        rmSync(expected, { recursive: true });
    }
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    console.log(
        JSON.stringify(
            installAgeQualifiedConsumer({ args: process.argv.slice(2) })
        )
    );
