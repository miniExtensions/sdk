import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
} from 'node:fs';
import { availableParallelism, tmpdir, totalmem } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const browserScript = fileURLToPath(
    new URL('./check-native-browser.mjs', import.meta.url)
);
const lanes = [
    { name: 'react19', version: '19.2.0' },
    { name: 'react18', version: '18.3.1' },
];

// Baseline native Chromium receipts from SDK main run 44438421662.
// The browser runner can add cases. Each baseline case must still pass.
const commonCases = [
    'native-file-selection',
    'recoverable-native-image',
    'native-rich-editor-slot-abi',
    'native-select-choice-projection',
    'person-badge-native-presentation',
    'calendly-frame-lifecycle',
    'action-button-native-form',
    'complete-readonly-text',
    'complete-clearable-input',
    'complete-multiline',
    'field-presentation',
    'kanban',
    'readonly-portal-grid',
    'portal-gallery-layout',
    'printable-form-layout',
    'csv-export',
    'form-group',
    'complete-portal-chart-esm',
    'complete-portal-chart-cjs',
    'complete-collaborators-esm',
    'complete-collaborators-cjs',
    'html-descriptions',
    'literal-text-display',
    'uncontrolled-text-ref-reset',
    'rating-trusted-keyboard-clear',
    'rating-keyboard-icons-grid',
    'rating-explicit-repair-print',
    'rating-callback-retirement-empty',
    'teardown-logout',
    'teardown-disconnect',
    'invalid-number',
    'attachment-picker',
    'portal-late-criteria',
    'session-off',
    'session-on',
    'session-event-session-clear',
    'session-event-session-key',
    'session-event-local-clear',
    'session-event-local-key',
];

export function baselineNativeCases(lane) {
    const cases = [...commonCases];
    if (lane === 'react18')
        cases.splice(
            cases.indexOf('literal-text-display'),
            0,
            'html-description-editor-coexistence'
        );
    return cases;
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readRegular(path) {
    assert(existsSync(path), `Missing qualification input or receipt: ${path}`);
    assert(lstatSync(path).isFile(), `Expected a regular file: ${path}`);
    assert.equal(realpathSync(path), resolve(path), `Refuse symlinks: ${path}`);
    return readFileSync(path);
}

function readDirectory(env, name) {
    assert(isAbsolute(env[name] ?? ''), `Explicit absolute ${name} required`);
    return resolve(env[name]);
}

function verifyInputs(env, packageDirectory, proofDirectory) {
    const kit = JSON.parse(
        readRegular(join(packageDirectory, 'artifact-receipt.json'))
    );
    const manifestBytes = readRegular(join(proofDirectory, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes);
    assert.equal(kit.schemaVersion, 1);
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(kit.verification?.outcome, 'passed');
    assert.match(env.GITHUB_SHA ?? '', /^[a-f0-9]{40}$/);
    assert.match(env.GITHUB_RUN_ID ?? '', /^\d+$/);
    assert.match(env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9]\d*$/);
    assert.equal(kit.source?.commit, env.GITHUB_SHA);
    assert.match(kit.source?.tree ?? '', /^[a-f0-9]{40}$/);
    assert.deepEqual(manifest.source, kit.source);
    assert.equal(kit.ci?.workflowSha, env.GITHUB_SHA);
    assert.equal(kit.ci.runId, env.GITHUB_RUN_ID);
    assert.equal(
        kit.ci.runAttempt,
        env.GITHUB_RUN_ATTEMPT,
        'Qualified package run attempt mismatch'
    );
    // The customer kit records the build's Node version in addition to the
    // CI identity fields shared by the synthetic browser fixture.
    const { node, ...fixtureCi } = kit.ci;
    assert.equal(node, process.version);
    assert.deepEqual(manifest.ci, fixtureCi);

    const filename = kit.package?.filename;
    assert.equal(kit.package?.name, '@miniextensions/sdk');
    assert.equal(typeof filename, 'string');
    assert.equal(basename(filename), filename);
    assert(filename.endsWith('.tgz'));
    assert.deepEqual(
        readdirSync(packageDirectory).filter((name) => name.endsWith('.tgz')),
        [filename],
        'Expected exactly the original qualified archive'
    );
    const archive = join(packageDirectory, filename);
    const archiveBytes = readRegular(archive);
    const expectedPackage = {
        name: kit.package.name,
        version: kit.package.version,
        filename,
        sha256: hash(archiveBytes),
        bytes: archiveBytes.length,
    };
    for (const [key, expected] of Object.entries(expectedPackage)) {
        assert.equal(
            kit.package[key],
            expected,
            `Qualified package ${key} mismatch`
        );
        assert.equal(
            manifest.package?.[key],
            expected,
            `Fixture package ${key} mismatch`
        );
    }
    return {
        archive,
        manifest,
        fixtureManifestSha256: hash(manifestBytes),
    };
}

function verifyLaneReceipt(lane, output, qualified) {
    const receiptName = 'native-receipt.json';
    const bytes = readRegular(join(output, receiptName));
    const lines = readRegular(join(output, 'SHA256SUMS'))
        .toString('utf8')
        .trimEnd()
        .split('\n');
    assert(
        lines.includes(`${hash(bytes)}  ${receiptName}`),
        'Native Chromium receipt checksum mismatch'
    );
    const receipt = JSON.parse(bytes);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.reactVersion, lane.version);
    assert.deepEqual(receipt.source, qualified.manifest.source);
    assert.deepEqual(receipt.ci, qualified.manifest.ci);
    assert.deepEqual(receipt.package, qualified.manifest.package);
    assert.equal(
        receipt.fixtureManifestSha256,
        qualified.fixtureManifestSha256
    );
    assert.deepEqual(receipt.cleanup, {
        consumer: 'completed',
        browser: 'completed',
        server: 'completed',
    });
    assert.deepEqual(receipt.network, []);
    const cases = receipt.results.map(({ name, status }) => {
        assert.equal(status, 'passed', `Native Chromium case ${name} failed`);
        assert(typeof name === 'string' && name.length > 0);
        return name;
    });
    assert.equal(new Set(cases).size, cases.length, 'Duplicate browser case');
    const baseline = baselineNativeCases(lane.name);
    assert.deepEqual(
        cases.filter((name) => baseline.includes(name)),
        baseline,
        'Native Chromium baseline case coverage changed'
    );
    return cases;
}

function runBrowser(script, env) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script], {
            env,
            stdio: 'inherit',
        });
        child.once('error', reject);
        child.once('close', (status, signal) => {
            if (status === 0) resolve();
            else
                reject(
                    new Error(`Browser child ended with ${signal ?? status}`)
                );
        });
    });
}

export async function checkNativeBrowserPair({
    env = process.env,
    script = browserScript,
} = {}) {
    const packageDirectory = readDirectory(env, 'SDK_NATIVE_PACKAGE_DIR');
    const proofDirectory = readDirectory(env, 'SDK_NATIVE_PROOF_DIR');
    const resultsDirectory = readDirectory(env, 'SDK_NATIVE_RESULT_DIR');
    const qualified = verifyInputs(env, packageDirectory, proofDirectory);
    assert(!existsSync(resultsDirectory), 'Refuse existing browser results');
    mkdirSync(resultsDirectory, { recursive: true });
    console.log(
        'Native Chromium runner:',
        JSON.stringify({
            availableParallelism: availableParallelism(),
            memoryBytes: totalmem(),
        })
    );
    const scratch = mkdtempSync(
        join(realpathSync(tmpdir()), 'sdk-native-pair-')
    );
    try {
        const results = await Promise.allSettled(
            lanes.map(async (lane) => {
                const laneScratch = join(scratch, lane.name);
                mkdirSync(laneScratch);
                const output = join(resultsDirectory, lane.name);
                const startedAt = new Date().toISOString();
                let cases;
                try {
                    await runBrowser(script, {
                        ...env,
                        SDK_NATIVE_PACKAGE_DIR: packageDirectory,
                        SDK_NATIVE_PROOF_DIR: proofDirectory,
                        SDK_NATIVE_RESULT_DIR: output,
                        SDK_NATIVE_REACT_VERSION: lane.version,
                        TMPDIR: laneScratch,
                        TMP: laneScratch,
                        TEMP: laneScratch,
                        XDG_CACHE_HOME: join(laneScratch, 'cache'),
                        XDG_CONFIG_HOME: join(laneScratch, 'config'),
                        npm_config_cache: join(laneScratch, 'npm-cache'),
                    });
                    cases = verifyLaneReceipt(lane, output, qualified);
                } catch (error) {
                    throw new Error(
                        `${lane.name} qualification failed: ${error.message}`,
                        {
                            cause: error,
                        }
                    );
                } finally {
                    rmSync(laneScratch, { recursive: true, force: true });
                    assert(
                        !existsSync(laneScratch),
                        `Could not clean ${lane.name} scratch`
                    );
                    console.log(
                        'Native Chromium lane:',
                        JSON.stringify({
                            reactVersion: lane.version,
                            startedAt,
                            completedAt: new Date().toISOString(),
                            outcome: cases ? 'passed' : 'failed',
                            archiveSha256: qualified.manifest.package.sha256,
                            cases,
                        })
                    );
                }
            })
        );
        const failures = results
            .filter(({ status }) => status === 'rejected')
            .map(({ reason }) => reason);
        if (failures.length > 0)
            throw new AggregateError(
                failures,
                failures.map((error) => error.message).join('\n')
            );
        assert.equal(
            hash(readRegular(qualified.archive)),
            qualified.manifest.package.sha256,
            'Qualified archive changed during browser execution'
        );
    } finally {
        rmSync(scratch, { recursive: true, force: true });
        assert(!existsSync(scratch), 'Could not clean browser pair scratch');
    }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
    await checkNativeBrowserPair();
