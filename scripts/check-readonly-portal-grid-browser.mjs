import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execPackageFileSync } from './package-manager-launch.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
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
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { stop as stopBuildService } from 'esbuild';
import { createArchiveMemberReader } from './package-checks.mjs';
import { checkReadonlyPortalGridProfile } from './readonly-portal-grid-browser-checks.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index],
        value = process.argv[index + 1];
    assert(
        ['--archive', '--receipt', '--output', '--chromium'].includes(name) &&
            value &&
            !args.has(name),
        'Expected explicit archive, receipt, output and Chromium arguments'
    );
    args.set(name, value);
}
assert.equal(args.size, 4);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const regular = (path) => {
    const absolute = resolve(path);
    assert(lstatSync(absolute).isFile());
    assert.equal(realpathSync(absolute), absolute, 'Refuse redirected input');
    return readFileSync(absolute);
};
const archive = resolve(args.get('--archive')),
    output = resolve(args.get('--output')),
    executablePath = resolve(args.get('--chromium'));
assert(!existsSync(output), 'Refuse existing result directory');
mkdirSync(output);
const report = {
    schemaVersion: 1,
    node: process.version,
    profiles: [],
    cleanup: {},
    startedAt: new Date().toISOString(),
    status: 'running',
    stage: 'preflight',
};
let browser, consumer, failure;
try {
    const receipt = JSON.parse(regular(args.get('--receipt')));
    assert.equal(regular(archive).length, receipt.package.bytes);
    assert.equal(sha(regular(archive)), receipt.package.sha256);
    assert.equal(
        receipt.qualification.stage,
        'focused-readonly-portal-grid-only'
    );
    assert.equal(
        receipt.qualification.completePackage,
        false,
        'Focused proof must not imply complete package qualification'
    );
    const [commit, tree] = execFileSync(
        'git',
        ['rev-parse', 'HEAD', 'HEAD^{tree}'],
        { encoding: 'utf8' }
    )
        .trim()
        .split('\n');
    assert.equal(commit, receipt.source.commit);
    assert.equal(tree, receipt.source.tree);
    assert.equal(
        execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }),
        '',
        'Require a clean committed harness/source checkout'
    );
    regular(executablePath);
    const readArchiveMember = createArchiveMemberReader({
        archivePath: archive,
        expectedSha256: receipt.package.sha256,
    });
    report.source = receipt.source;
    report.package = receipt.package;
    report.harness = {
        entry: sha(regular('scripts/check-readonly-portal-grid-browser.mjs')),
        helper: sha(regular('scripts/readonly-portal-grid-browser-checks.mjs')),
        host: sha(regular('scripts/readonly-portal-grid-consumer-checks.mjs')),
    };
    report.stage = 'browser';
    report.browserExecutable = {
        path: executablePath,
        version: execFileSync(executablePath, ['--version'], {
            encoding: 'utf8',
        }).trim(),
    };
    browser = await chromium.launch({
        executablePath,
        headless: true,
        chromiumSandbox: true,
    });
    report.browser = browser.version();
    for (const version of ['18.3.1', '19.2.0']) {
        consumer = realpathSync(
            mkdtempSync(join(tmpdir(), 'sdk-readonly-grid-browser-'))
        );
        writeFileSync(
            join(consumer, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                packageManager: 'pnpm@10.28.2',
                dependencies: {
                    '@miniextensions/sdk': 'file:' + archive,
                    react: version,
                    'react-dom': version,
                },
            })
        );
        const policy = {
            nodeLinker: 'hoisted',
            minimumReleaseAge: 2880,
            minimumReleaseAgeExclude: [],
            blockExoticSubdeps: true,
            strictPeerDependencies: true,
            ignoreScripts: true,
        };
        const policyText =
            Object.entries(policy)
                .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                .join('\n') + '\n';
        writeFileSync(join(consumer, 'pnpm-workspace.yaml'), policyText);
        const pnpm = (args) =>
            execPackageFileSync('corepack', ['pnpm', ...args], {
                cwd: consumer,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'inherit'],
                timeout: 120000,
            });
        assert.equal(pnpm(['--version']).trim(), '10.28.2');
        for (const [key, value] of Object.entries(policy))
            assert.deepEqual(
                JSON.parse(pnpm(['config', 'get', key, '--json'])),
                value
            );
        pnpm(['install', '--ignore-scripts', '--strict-peer-dependencies']);
        assert.equal(
            readFileSync(join(consumer, 'pnpm-workspace.yaml'), 'utf8'),
            policyText
        );
        assert.equal(
            createRequire(join(consumer, 'package.json'))('react/package.json')
                .version,
            version
        );
        const profile = { react: version, policy };
        report.profiles.push(profile);
        const profileOutput = join(output, 'react-' + version);
        mkdirSync(profileOutput);
        await checkReadonlyPortalGridProfile({
            browser,
            consumer,
            evidence: profile,
            output: profileOutput,
            readArchiveMember,
        });
        assert.equal(profile.status, 'passed');
        assert.equal(sha(regular(archive)), receipt.package.sha256);
        rmSync(consumer, { recursive: true, force: true });
        consumer = null;
        profile.consumerCleanup = 'completed';
    }
    report.status = 'passed';
} catch (error) {
    failure = error;
    report.status = 'failed';
    report.error = error.message;
} finally {
    let bundlerTimer;
    try {
        await Promise.race([
            stopBuildService(),
            new Promise((_, reject) => {
                bundlerTimer = setTimeout(
                    () => reject(Error('Grid bundler cleanup timed out')),
                    5000
                );
            }),
        ]);
        report.cleanup.bundler = 'completed';
    } catch (error) {
        failure ??= error;
        report.status = 'failed';
        report.cleanup.bundler = { error: error.message };
    } finally {
        clearTimeout(bundlerTimer);
    }
    try {
        if (browser) {
            let timer;
            try {
                await Promise.race([
                    browser.close(),
                    new Promise((_, reject) => {
                        timer = setTimeout(
                            () =>
                                reject(Error('Grid browser cleanup timed out')),
                            5000
                        );
                    }),
                ]);
            } finally {
                clearTimeout(timer);
            }
        }
        report.cleanup.browser = 'completed';
    } catch (error) {
        failure ??= error;
        report.status = 'failed';
        report.cleanup.browser = { error: error.message };
    }
    try {
        if (consumer) rmSync(consumer, { recursive: true, force: true });
        report.cleanup.consumer = 'completed';
    } catch (error) {
        failure ??= error;
        report.status = 'failed';
        report.cleanup.consumer = { error: error.message };
    }
    report.finishedAt = new Date().toISOString();
    writeFileSync(
        join(output, 'readonly-portal-grid-browser-receipt.json'),
        JSON.stringify(report, null, 2) + '\n'
    );
    console.log(
        JSON.stringify({
            source: report.source,
            status: report.status,
            profiles: report.profiles.map((profile) => ({
                react: profile.react,
                status: profile.status,
                groups: profile.results?.length,
                origin: profile.origin,
                cleanup: profile.cleanup,
            })),
            cleanup: report.cleanup,
            error: report.error,
        })
    );
}
if (failure) throw failure;
