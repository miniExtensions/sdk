import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
    consumerAgePolicy,
    installAgeQualifiedConsumer,
    runAgeQualifiedConsumerInstall,
} from './age-qualified-consumer-install.mjs';

function fixture(
    t,
    {
        policy = {},
        version = '10.28.2',
        afterInstall,
        npmLock = false,
        alias = false,
    } = {}
) {
    const root = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-consumer-age-test-'))
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const source = join(root, 'package');
    mkdirSync(source);
    const contents = {
        'package.json': JSON.stringify({
            name: '@miniextensions/sdk',
            version: '0.1.0',
        }),
        'index.js': 'export const value = 1;\n',
    };
    for (const [path, bytes] of Object.entries(contents))
        writeFileSync(join(source, path), bytes);
    const archive = join(root, 'sdk.tgz');
    execFileSync('tar', ['-czf', archive, '-C', root, 'package']);
    const integrity = `sha512-${createHash('sha512').update(readFileSync(archive)).digest('base64')}`;
    const directory = join(root, 'consumer');
    mkdirSync(directory);
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
            private: true,
            type: 'module',
            dependencies: {
                '@miniextensions/sdk': `file:${archive}`,
                'host-moment': 'npm:moment@2.30.1',
            },
        })
    );
    if (alias) {
        const path = join(directory, 'package.json');
        const manifest = JSON.parse(readFileSync(path, 'utf8'));
        manifest.dependencies['@miniextensions/sdk-html-second-copy'] =
            `file:${archive}`;
        writeFileSync(path, JSON.stringify(manifest));
    }
    if (npmLock)
        writeFileSync(
            join(directory, 'package-lock.json'),
            'original npm provenance'
        );
    const installed = join(directory, 'node_modules/@miniextensions/sdk');
    mkdirSync(join(installed, '..'), { recursive: true });
    cpSync(source, installed, { recursive: true });
    let installs = 0;
    const calls = [];
    const execute = (command, args, cwd) => {
        assert.equal(command, 'pnpm');
        assert.equal(cwd, directory);
        calls.push(args);
        if (args[0] === '--version') return version;
        if (args[0] === 'config')
            return JSON.stringify({ ...consumerAgePolicy, ...policy }[args[2]]);
        assert.deepEqual(args, [
            'install',
            '--strict-peer-dependencies',
            '--ignore-scripts',
        ]);
        assert(!existsSync(join(directory, 'node_modules')));
        assert(!existsSync(join(directory, 'pnpm-lock.yaml')));
        installs++;
        mkdirSync(join(installed, '..'), { recursive: true });
        cpSync(source, installed, { recursive: true });
        if (alias)
            cpSync(
                source,
                join(
                    directory,
                    'node_modules/@miniextensions/sdk-html-second-copy'
                ),
                { recursive: true }
            );
        writeFileSync(
            join(directory, 'pnpm-lock.yaml'),
            `lockfileVersion: '9.0'\npackages:\n  '@miniextensions/sdk@file:${archive}':\n    resolution: {integrity: ${integrity}, tarball: 'file:${archive}'}\n`
        );
        afterInstall?.({ archive, installed, directory, root });
        return '';
    };
    return {
        directory,
        args: [
            'install',
            '--ignore-scripts',
            '--package-lock=false',
            'react@19.2.0',
            '@types/react@19.2.2',
        ],
        execute,
        installed,
        archive,
        calls,
        get installs() {
            return installs;
        },
    };
}

test('consumer adapter preserves the caller execution boundary and arguments', () => {
    const args = ['install', 'react@19.2.0'];
    const value = runAgeQualifiedConsumerInstall((command, forwarded) => {
        assert.equal(command, process.execPath);
        assert.match(forwarded[0], /age-qualified-consumer-install\.mjs$/);
        assert.deepEqual(forwarded.slice(1), args);
        return 'receipt';
    }, args);
    assert.equal(value, 'receipt');
});
for (const npmLock of [false, true])
    test(`consumer installation verifies policy before install and preserves provenance (${npmLock})`, (t) => {
        const f = fixture(t, { npmLock });
        const receipt = installAgeQualifiedConsumer(f);
        assert.equal(f.installs, 1);
        assert.equal(receipt.earlierNpmLockPreserved, npmLock);
        assert.equal(receipt.files, 2);
        const manifest = JSON.parse(
            readFileSync(join(f.directory, 'package.json'), 'utf8')
        );
        assert.equal(manifest.dependencies['host-moment'], 'npm:moment@2.30.1');
        assert.equal(manifest.dependencies.react, '19.2.0');
        assert.equal(manifest.dependencies['@types/react'], '19.2.2');
        assert.deepEqual(
            f.calls.slice(1, -1),
            Object.keys(consumerAgePolicy).map((key) => [
                'config',
                'get',
                key,
                '--json',
            ])
        );
    });
for (const policy of [
    { minimumReleaseAge: 0 },
    { minimumReleaseAgeExclude: ['csstype'] },
    { blockExoticSubdeps: false },
    { strictPeerDependencies: false },
    { ignoreScripts: false },
    { nodeLinker: 'isolated' },
])
    test(`consumer refuses weakened ${Object.keys(policy)[0]} before retiring modules or installing`, (t) => {
        const f = fixture(t, { policy });
        assert.throws(
            () => installAgeQualifiedConsumer(f),
            /Consumer policy differs/
        );
        assert.equal(f.installs, 0);
        assert(existsSync(f.installed));
    });
test('consumer refuses an unverified installer version before install', (t) => {
    const f = fixture(t, { version: '10.29.0' });
    assert.throws(() => installAgeQualifiedConsumer(f), /10.28.2/);
    assert.equal(f.installs, 0);
    assert(existsSync(f.installed));
});
for (const [name, change, reason] of [
    [
        'archive replacement',
        ({ archive }) => writeFileSync(archive, 'replacement'),
        /Packed SDK archive changed/,
    ],
    [
        'same-size installed mutation',
        ({ installed }) =>
            writeFileSync(
                join(installed, 'index.js'),
                'export const value = 2;\n'
            ),
        /Installed SDK archive bytes differ/,
    ],
    [
        'installed symlink',
        ({ installed, root }) => {
            rmSync(installed, { recursive: true });
            symlinkSync(join(root, 'package'), installed);
        },
        /false|directory/i,
    ],
    [
        'nested installed symlink',
        ({ installed }) => {
            const bin = join(installed, 'node_modules/.bin');
            mkdirSync(bin, { recursive: true });
            symlinkSync(join(installed, 'index.js'), join(bin, 'sdk-fixture'));
        },
        /installed SDK copy @miniextensions\/sdk, lock SHA-256 [a-f0-9]{64}: "node_modules\/\.bin\/sdk-fixture" \(symbolic link\)/,
    ],
    [
        'policy rewrite',
        ({ directory }) =>
            writeFileSync(
                join(directory, 'pnpm-workspace.yaml'),
                'minimumReleaseAge: 0\n'
            ),
        /strictly equal/,
    ],
])
    test(`consumer rejects ${name} after installation`, (t) => {
        const f = fixture(t, { afterInstall: change });
        assert.throws(() => installAgeQualifiedConsumer(f), reason);
        assert.equal(f.installs, 1);
    });
test('consumer refuses unsupported install flags before installation', (t) => {
    const f = fixture(t);
    f.args.push('--force');
    assert.throws(() => installAgeQualifiedConsumer(f), /Unsupported/);
    assert.equal(f.installs, 0);
});

test('fresh matrix profile retires only its already-proven prior lock', (t) => {
    const f = fixture(t);
    const first = installAgeQualifiedConsumer(f);
    f.args = ['install', 'react@18.3.1', '@types/react@18.3.12'];
    const second = installAgeQualifiedConsumer(f);
    assert.equal(f.installs, 2);
    assert.notEqual(first.manifestSha256, second.manifestSha256);
    const receipts = JSON.parse(
        readFileSync(
            join(f.directory, 'consumer-age-install-receipts.json'),
            'utf8'
        )
    );
    assert.equal(receipts.length, 2);
});
test('consumer does not reuse an unadmitted retained lock', (t) => {
    const f = fixture(t);
    writeFileSync(
        join(f.directory, 'pnpm-lock.yaml'),
        'unadmitted retained lock'
    );
    assert.throws(
        () => installAgeQualifiedConsumer(f),
        /separate retained-lock admission/
    );
    assert.equal(f.installs, 0);
    assert(existsSync(f.installed));
});
test('legacy scratch cache flag is consumed without changing registry dependencies', (t) => {
    const f = fixture(t);
    f.args.push('--cache', join(f.directory, 'npm-cache'));
    installAgeQualifiedConsumer(f);
    assert.equal(f.installs, 1);
});
test('consumer refuses a direct exotic dependency before install', (t) => {
    const f = fixture(t);
    f.args.push('other@github:someone/repo');
    assert.throws(
        () => installAgeQualifiedConsumer(f),
        /exact registry versions/
    );
    assert.equal(f.installs, 0);
});

test('consumer verifies a deliberate second named SDK archive copy', (t) => {
    const f = fixture(t, { alias: true });
    const receipt = installAgeQualifiedConsumer(f);
    assert.deepEqual(receipt.sdkCopies, [
        '@miniextensions/sdk',
        '@miniextensions/sdk-html-second-copy',
    ]);
    assert.equal(f.installs, 1);
});
test('consumer refuses a different archive under an SDK alias before install', (t) => {
    const f = fixture(t, { alias: true });
    const other = join(f.directory, 'other.tgz');
    writeFileSync(other, readFileSync(f.archive));
    const manifestPath = join(f.directory, 'package.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.dependencies['@miniextensions/sdk-html-second-copy'] =
        `file:${other}`;
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(
        () => installAgeQualifiedConsumer(f),
        /exact admitted archive/
    );
    assert.equal(f.installs, 0);
});
