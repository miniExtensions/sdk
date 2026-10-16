import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runMeasured } from './ci153-process.mjs';

const A = {
    arm: 'A',
    commit: 'ea9f16e4e08d62a1f66a93d9a77f8ef5e93148f9',
    tree: 'f1e5e155f00211decafe7592e5816bd9723f85ce',
    guards: 98,
};
const B = {
    arm: 'B',
    commit: 'faac6a701dae92bb92a69e3fcd1e43b917d181b0',
    tree: '31c9fbe20187e25b498ccf5a11a15d79c3a6cc28',
    guards: 119,
};
const PACKAGE = {
    bytes: 623353,
    files: 492,
    sha256: 'cc21fbfdaacdb88f1ad22c3040e9a1bf590229ff4f048cf263fba9f578ad98e8',
    integrity: 'sha512-WbtLjSCQjsh1ERKKQA0SMeaBfVMTIw2iOhEoG+7cRQFm5xy0R1DlyhEFXgsr2/Tk3VRHWIVq/g28Kxl/pzwPMg==',
};
const changedPaths = [
    'scripts/check-package.mjs',
    'scripts/package-checks.test.mjs',
    'scripts/packed-tail-checks.mjs',
    'scripts/packed-tail-worker.mjs',
].sort();
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(readFileSync(join(scriptDirectory, 'ci153-corpus.json')));
const [samplesArgument, outputArgument] = process.argv.slice(2);
assert.equal(process.argv.length, 4, 'Expected sample checkout parent and output root');
assert(isAbsolute(samplesArgument) && isAbsolute(outputArgument));
const samplesRoot = realpathSync(samplesArgument);
const outputRoot = resolve(outputArgument);
assert.equal(realpathSync(dirname(outputRoot)), dirname(outputRoot));
assert(!existsSync(outputRoot), 'Refuse existing evidence root');
mkdirSync(outputRoot);
const workRoot = join(dirname(outputRoot), 'sdk-ci153-execution');
assert(!existsSync(workRoot), 'Refuse existing execution root');
mkdirSync(workRoot);
const abort = new AbortController();
for (const childSignal of ['SIGINT', 'SIGTERM']) {
    process.on(childSignal, () => abort.abort(childSignal));
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) =>
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const readCommand = (command, args, cwd) =>
    execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
const git = (cwd, args) => readCommand('git', args, cwd);
const controlRoot = resolve(scriptDirectory, '../..');
const sourceFiles = [
    '.github/workflows/check.yml',
    '.github/scripts/ci153-comparison.mjs',
    '.github/scripts/ci153-process.mjs',
    '.github/scripts/ci153-corpus.json',
];
const control = {
    commit: git(controlRoot, ['rev-parse', 'HEAD']),
    tree: git(controlRoot, ['rev-parse', 'HEAD^{tree}']),
    workflowEventSha: process.env.GITHUB_SHA ?? null,
    workflowEventRef: process.env.GITHUB_REF ?? null,
    pullRequestHeadRef: process.env.GITHUB_HEAD_REF ?? null,
    repository: process.env.GITHUB_REPOSITORY ?? null,
    event: process.env.GITHUB_EVENT_NAME ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    job: process.env.GITHUB_JOB ?? null,
    files: sourceFiles.map((path) => ({
        path,
        sha256: hash(readFileSync(join(controlRoot, path))),
    })),
};
const runtime = {
    node: process.version,
    npm: readCommand('npm', ['--version'], controlRoot),
    pnpm: readCommand('pnpm', ['--version'], controlRoot),
    chrome: readCommand('/usr/bin/google-chrome', ['--version'], controlRoot),
    kernel: readCommand('uname', ['-srmo'], controlRoot),
    cpu: readFileSync('/proc/cpuinfo', 'utf8')
        .split('\n').filter((line) => /^(model name|processor)\s*:/.test(line)),
    memory: readFileSync('/proc/meminfo', 'utf8')
        .split('\n').filter((line) => /^(MemTotal|MemAvailable|SwapTotal|SwapFree):/.test(line)),
    imageOS: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
    runnerOS: process.env.RUNNER_OS ?? null,
    runnerArch: process.env.RUNNER_ARCH ?? null,
    timezone: 'UTC',
    samplerCadenceMs: 200,
};
assert.match(runtime.node, /^v24\./);
assert.equal(runtime.pnpm, '10.28.2');
assert.equal(process.platform, 'linux');

function inspectSource(spec, id) {
    const cwd = realpathSync(join(samplesRoot, id));
    assert.equal(relative(samplesRoot, cwd), id);
    assert.equal(git(cwd, ['rev-parse', 'HEAD']), spec.commit);
    assert.equal(git(cwd, ['rev-parse', 'HEAD^{tree}']), spec.tree);
    assert.equal(git(cwd, ['status', '--porcelain']), '', 'Fresh checkout required');
    for (const name of ['node_modules', 'dist', 'coverage']) {
        assert(!existsSync(join(cwd, name)), 'Refuse preexisting ' + name);
    }
    const entries = Object.fromEntries(
        git(cwd, ['ls-tree', '-r', 'HEAD']).split('\n').map((line) => {
            const [object, path] = line.split('\t');
            assert(path && !path.includes('\n'));
            return [path, object];
        })
    );
    return { id, ...spec, cwd, entries };
}
const samples = [
    inspectSource(A, 'A1'),
    inspectSource(B, 'B1'),
    inspectSource(B, 'B2'),
    inspectSource(A, 'A2'),
];
assert.deepEqual(samples[0].entries, samples[3].entries);
assert.deepEqual(samples[1].entries, samples[2].entries);
const differences = [...new Set([
    ...Object.keys(samples[0].entries),
    ...Object.keys(samples[1].entries),
])].filter((path) => samples[0].entries[path] !== samples[1].entries[path]).sort();
assert.deepEqual(differences, changedPaths, 'Unexpected source difference');
for (const sample of samples) {
    assert.equal(
        hash(readFileSync(join(sample.cwd, '.github/workflows/check.yml'))),
        '7c705774e06f0dcb35a5368e1b1551c80dd4fd46c9bf4cbd57ae694d82b68c1b'
    );
}
write(join(outputRoot, 'inputs.json'), {
    schemaVersion: 1,
    control,
    runtime,
    package: PACKAGE,
    order: samples.map(({ id, arm, commit, tree, guards }) => ({ id, arm, commit, tree, guards })),
    changedPaths,
    childEnvironmentPolicy: {
        removed: ['GITHUB_SHA', 'SDK_PR_HEAD_SHA', 'SDK_ATTACHMENT_NATIVE_PLAYWRIGHT'],
        explanation: 'The control event SHA/PR head are not the tested source. They remain above; unchanged arm receipts use real git source and omit unrelated workflowSha/pullRequestHeadSha.',
        caches: 'Independent empty npm cache/pnpm store/TMPDIR per sample; normal helper-created caches remain fresh.',
    },
    limits: [
        'Same VM ABBA pilot, two repetitions per arm; no statistically reliable population estimate.',
        'Fresh stores do not flush OS caches or control registry/network latency and host scheduling.',
        'Full validation excludes shared provisioning/checkout, evidence staging and artifact upload; no independent whole-job/billed-minute claim.',
    ],
});

function checkCounts(log, guards) {
    const clean = log.replace(/\u001b\[[0-9;]*m/g, '');
    const counts = (name) => [...clean.matchAll(
        new RegExp('^(?:#|ℹ)\\s+' + name + '\\s+(\\d+)\\s*$', 'gm')
    )].map((match) => Number(match[1]));
    const expected = [3, 2299, 624, guards];
    assert.deepEqual(counts('tests'), expected, 'Node test totals');
    assert.deepEqual(counts('pass'), expected, 'Node pass totals');
    for (const name of ['fail', 'cancelled', 'skipped', 'todo']) {
        assert.deepEqual(counts(name), [0, 0, 0, 0], 'Unexpected ' + name);
    }
    const attachment = clean.split('\n').map((line) => line.trim())
        .filter((line) => /^Packed attachment (upload|Review): .+ passed$/.test(line));
    const review = clean.split('\n').map((line) => line.trim())
        .filter((line) => /^\[packed review \d+\/51\] .+: passed$/.test(line));
    assert.deepEqual(attachment, corpus.attachmentCases, 'Original attachment corpus');
    assert.deepEqual(review, corpus.reviewCases, 'Original prepared-review corpus');
    for (const text of [
        '104 installed attachment-review checkpoints and 90 copied-starter attachment-review cases',
        '51 actual packed browser prepared-review cases',
        'Installed select compiler: 1318 checks passed.',
        'full browser/UI examples typecheck/build passed (' + PACKAGE.integrity + ')',
    ]) {
        assert(clean.includes(text), 'Missing required final summary: ' + text);
    }
    assert.equal(clean.split('\n').filter(
        (line) => line.trim() === '2 actual packed browser combined empty-hiding/Review cases'
    ).length, 1);
    return { expected, attachmentCases: attachment.length, reviewCases: review.length, combined: 2 };
}

function checksums(directory) {
    const content = readFileSync(join(directory, 'SHA256SUMS'), 'utf8');
    const entries = content.trim().split('\n');
    assert(entries.length > 0);
    const paths = new Set();
    for (const line of entries) {
        const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(line);
        assert(match, 'Malformed checksum line');
        const [, expected, path] = match;
        assert(!isAbsolute(path) && !path.split('/').includes('..'));
        assert(!paths.has(path));
        paths.add(path);
        const file = join(directory, path);
        assert(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
        assert.equal(hash(readFileSync(file)), expected, 'Checksum changed: ' + path);
    }
    return [...paths];
}

function verifyArtifacts(sample, paths, log) {
    const receipt = json(join(paths.package, 'artifact-receipt.json'));
    assert.deepEqual(receipt.source, { commit: sample.commit, tree: sample.tree });
    assert.equal(receipt.ci.workflowSha, undefined);
    assert.equal(receipt.ci.pullRequestHeadSha, undefined);
    assert.equal(receipt.verification.outcome, 'passed');
    assert.equal(receipt.verification.browserPortalChecks, 85);
    for (const [key, expected] of Object.entries(PACKAGE)) {
        assert.equal(receipt.package[key], expected, 'Package ' + key);
    }
    const archive = readFileSync(join(paths.package, receipt.package.filename));
    assert.equal(archive.length, PACKAGE.bytes);
    assert.equal(hash(archive), PACKAGE.sha256);
    assert.equal('sha512-' + createHash('sha512').update(archive).digest('base64'), PACKAGE.integrity);
    checksums(paths.package);
    const manifestBytes = readFileSync(join(paths.proof, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes);
    assert.deepEqual(manifest.source, receipt.source);
    assert.equal(manifest.package.sha256, PACKAGE.sha256);
    const native = json(join(paths.native, 'native-receipt.json'));
    assert.equal(native.schemaVersion, 1);
    assert.equal(native.status, 'passed');
    assert.deepEqual(native.source, receipt.source);
    assert.equal(native.package.sha256, PACKAGE.sha256);
    assert.equal(native.package.bytes, PACKAGE.bytes);
    assert.equal(native.fixtureManifestSha256, hash(manifestBytes));
    assert.deepEqual(native.results.map(({ name }) => name), corpus.nativeCases);
    assert(native.results.every(({ status }) => status === 'passed'));
    assert.deepEqual(native.network, []);
    assert.deepEqual(native.cleanup, { browser: 'completed', server: 'completed', consumer: 'completed' });
    assert.equal(native.fileChooserOwnerRegressions.checks, 20);
    assert.equal(native.fixtureDeclarationCheck.status, 'passed');
    assert.equal(native.fixtureDeclarationCheck.missingScopeRegression, 'rejected');
    assert.equal(native.attachmentPresentation.status, 'passed');
    assert.deepEqual(native.attachmentPresentation.errors, []);
    assert.deepEqual(native.attachmentPresentation.external, []);
    assert.deepEqual(native.attachmentPresentation.captures.map(({ name }) => name),
        ['selected', 'uploading', 'accepted', 'uncertain', 'narrow']);
    assert(checksums(paths.native).includes('native-receipt.json'));
    const linked = json(join(paths.native, 'linked-records/receipt.json'));
    assert.equal(linked.head, sample.commit);
    assert.equal(linked.sha256, PACKAGE.sha256);
    assert.equal(linked.integrity, PACKAGE.integrity);
    assert.deepEqual(linked.cases, corpus.linkedCases);
    for (const [key, expected] of Object.entries({
        reads: 1, searches: 2, pages: 1, saves: 0, rowActivations: 0, submits: 0,
    })) assert.equal(linked[key], expected, 'Linked counter ' + key);
    for (const key of ['externalRequests', 'transports', 'errors']) assert.deepEqual(linked[key], []);
    const coverage = json(join(sample.cwd, 'coverage/source-metrics.json'));
    assert.deepEqual(Object.keys(coverage.groups).sort(), ['combined', 'component', 'unit']);
    for (const group of Object.values(coverage.groups)) {
        assert(Object.keys(group.scopes).length > 0);
        for (const scope of Object.values(group.scopes)) {
            for (const [metric, minimum] of Object.entries(scope.minimum)) {
                assert(Number.isFinite(scope.actual[metric]) && scope.actual[metric] >= minimum);
            }
        }
    }
    return { ...checkCounts(log, sample.guards), package: receipt.package, native: 7, linked: 11 };
}

function copyEvidence(source, destination) {
    if (!existsSync(source)) return;
    function regularTree(path) {
        const entry = lstatSync(path);
        assert(!entry.isSymbolicLink(), 'Refuse evidence symlink');
        if (entry.isDirectory()) {
            for (const name of readdirSync(path)) regularTree(join(path, name));
        } else assert(entry.isFile(), 'Evidence must be regular files');
    }
    regularTree(source);
    cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
}

const results = [];
let failure = null;
const experimentBegan = performance.now();
for (const sample of samples) {
    if (failure || abort.signal.aborted) break;
    const output = join(outputRoot, sample.id);
    mkdirSync(output);
    const execution = join(workRoot, sample.id);
    mkdirSync(execution);
    for (const name of ['tmp', 'npm-cache', 'pnpm-store', 'outputs']) mkdirSync(join(execution, name));
    const paths = {
        package: join(execution, 'outputs/customer-kit'),
        proof: join(execution, 'outputs/browser-proof'),
        native: join(execution, 'outputs/native'),
    };
    const env = {
        ...process.env,
        CI: 'true',
        TZ: 'UTC',
        NO_COLOR: '1',
        TMPDIR: join(execution, 'tmp'),
        npm_config_cache: join(execution, 'npm-cache'),
        SDK_CHECKED_ARTIFACT_DIR: paths.package,
        SDK_BROWSER_PROOF_ARTIFACT_DIR: paths.proof,
        SDK_NATIVE_PACKAGE_DIR: paths.package,
        SDK_NATIVE_PROOF_DIR: paths.proof,
        SDK_NATIVE_RESULT_DIR: paths.native,
        SDK_NATIVE_CHROMIUM: '/usr/bin/google-chrome',
        SDK_LINKED_RECORDS_CHROMIUM: '/usr/bin/google-chrome',
    };
    delete env.GITHUB_SHA;
    delete env.SDK_PR_HEAD_SHA;
    delete env.SDK_ATTACHMENT_NATIVE_PLAYWRIGHT;
    const result = {
        id: sample.id, arm: sample.arm, commit: sample.commit, tree: sample.tree,
        status: 'running', commands: [], correctness: null, cleanup: null,
    };
    const began = performance.now();
    let drainConfirmed = true;
    try {
        console.log('Starting ' + sample.id + ' at ' + sample.commit);
        for (const [name, command, args, timeoutMs] of [
            ['install', 'pnpm', ['install', '--frozen-lockfile', '--store-dir', join(execution, 'pnpm-store')], 300000],
            ['check', 'pnpm', ['check'], 1200000],
            ['native', 'pnpm', ['check:browser'], 600000],
            ['linked', process.execPath, ['scripts/check-linked-records-browser.mjs', join(paths.native, 'linked-records')], 180000],
        ]) {
            if (abort.signal.aborted) throw new Error('Parent interrupted');
            try {
                result.commands.push(await runMeasured({
                    name, command, args, cwd: sample.cwd, env, output,
                    timeoutMs, signal: abort.signal,
                }));
            } catch (error) {
                drainConfirmed = error.commandResult?.drainConfirmed === true;
                if (error.commandResult) result.commands.push(error.commandResult);
                throw error;
            }
        }
        result.validationCommandsMs = performance.now() - began;
        result.correctness = verifyArtifacts(sample, paths,
            readFileSync(join(output, 'check.combined.log'), 'utf8'));
        result.status = 'passed';
    } catch (error) {
        failure = error;
        result.status = 'failed';
        result.error = { message: error.message, stack: error.stack };
    } finally {
        const stagingStart = performance.now();
        try {
            for (const [name, path] of Object.entries(paths)) {
                copyEvidence(path, join(output, name));
            }
            copyEvidence(join(sample.cwd, 'coverage'), join(output, 'coverage'));
        } catch (error) {
            failure ??= error;
            result.status = 'failed';
            result.stagingError = error.message;
        }
        result.evidenceStagingMs = performance.now() - stagingStart;
        const cleanupStart = performance.now();
        if (drainConfirmed && !result.stagingError) {
            try {
                const targets = [
                    execution,
                    ...['node_modules', 'dist', 'coverage'].map((name) => join(sample.cwd, name)),
                ];
                for (const target of targets) {
                    rmSync(target, { recursive: true, force: true });
                    assert(!existsSync(target), 'Cleanup failed: ' + target);
                }
                assert.equal(git(sample.cwd, ['status', '--porcelain']), '',
                    'Unexpected generated checkout files after cleanup');
                result.cleanup = { status: 'completed', drainConfirmed: true, targets };
            } catch (error) {
                failure ??= error;
                result.status = 'failed';
                result.cleanup = { status: 'failed', drainConfirmed: true, error: error.message };
            }
        } else {
            result.cleanup = {
                status: drainConfirmed
                    ? 'retained-evidence-staging-failed'
                    : 'retained-unconfirmed-drain',
                drainConfirmed,
                retainedExecution: execution,
                retainedCheckout: sample.cwd,
            };
        }
        result.cleanupMs = performance.now() - cleanupStart;
        result.primaryValidationMs =
            result.commands.reduce((sum, command) => sum + command.elapsedMs, 0) + result.cleanupMs;
        result.validationWithoutInstallMs = result.primaryValidationMs -
            (result.commands.find(({ name }) => name === 'install')?.elapsedMs ?? 0);
        result.totalObservedSampleMs = performance.now() - began;
        result.peakSampledRssKiB = Math.max(0, ...result.commands.map((command) => command.peakSampledRssKiB));
        write(join(output, 'sample-receipt.json'), result);
        results.push(result);
    }
}
if (!failure && !abort.signal.aborted) {
    assert.equal(results.length, 4);
    assert(results.every(({ status, cleanup }) => status === 'passed' && cleanup.status === 'completed'));
    rmSync(workRoot, { recursive: true });
    assert(!existsSync(workRoot));
}
const means = {};
for (const arm of ['A', 'B']) {
    const own = results.filter((sample) => sample.arm === arm && sample.status === 'passed');
    const values = own.map(({ primaryValidationMs }) => primaryValidationMs);
    if (values.length === 2) {
        const sorted = [...values].sort((x, y) => x - y);
        means[arm] = {
            samples: own.map(({ id }) => id),
            valuesMs: values,
            meanMs: (values[0] + values[1]) / 2,
            medianMs: (sorted[0] + sorted[1]) / 2,
            rangeMs: sorted,
        };
    }
}
const paired = [['A1', 'B1'], ['A2', 'B2']].map(([a, b]) => {
    const x = results.find(({ id, status }) => id === a && status === 'passed');
    const y = results.find(({ id, status }) => id === b && status === 'passed');
    return x && y ? { a, b, savedMs: x.primaryValidationMs - y.primaryValidationMs } : null;
}).filter(Boolean);
write(join(outputRoot, 'comparison.json'), {
    schemaVersion: 1,
    status: failure || abort.signal.aborted ? 'failed' : 'passed',
    error: failure?.message ?? null,
    interrupted: abort.signal.aborted,
    elapsedMs: performance.now() - experimentBegan,
    primaryBoundary: 'Sum of real install/check/native/linked launch-through-close-and-drain durations plus verified cleanup; excludes correctness parsing, evidence staging and shared job setup/uploads.',
    samples: results,
    means,
    paired,
    meanSavedMs: means.A && means.B ? means.A.meanMs - means.B.meanMs : null,
    meanReductionPercent: means.A && means.B ? 100 * (1 - means.B.meanMs / means.A.meanMs) : null,
    interpretation: 'Descriptive same-VM ABBA validation pilot only. Report all rows, memory and failures. No automatic merge gate or independent whole-job saving.',
});
function files(directory, prefix = '') {
    const members = [];
    for (const name of readdirSync(directory).sort()) {
        const path = join(directory, name);
        const entry = lstatSync(path);
        assert(!entry.isSymbolicLink());
        if (entry.isDirectory()) members.push(...files(path, prefix + name + '/'));
        else {
            assert(entry.isFile());
            const bytes = readFileSync(path);
            members.push({ path: prefix + name, bytes: bytes.length, sha256: hash(bytes) });
        }
    }
    return members;
}
write(join(outputRoot, 'files.json'), {
    schemaVersion: 1,
    excludes: ['files.json (self-reference)'],
    files: files(outputRoot),
});
if (failure || abort.signal.aborted) process.exitCode = 1;
console.log('Comparison ' + (process.exitCode ? 'FAILED' : 'PASSED') +
    '; completed samples=' + results.length + '; artifacts=' + outputRoot);
