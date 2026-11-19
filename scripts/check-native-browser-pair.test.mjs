import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkNativeBrowserPair } from './check-native-browser-pair.mjs';

const fixture = fileURLToPath(
    new URL('./fixtures/native-browser-pair-child.mjs', import.meta.url)
);
const workflow = readFileSync(
    new URL('../.github/workflows/check.yml', import.meta.url),
    'utf8'
);
const requiredCheck = workflow.match(
    /    check:\n\s+name: check \(24\)\n\s+needs: \[source, package\][\s\S]*?run: \|\n\s+(test [^\n]+)/
)?.[1];
assert(workflow.includes('run: node scripts/check-native-browser-pair.mjs'));
assert(requiredCheck, 'Expected the real required check to depend on package');

function setup(t) {
    const root = mkdtempSync(
        join(realpathSync(tmpdir()), 'sdk-native-pair-test-')
    );
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const dirs = {
        SDK_NATIVE_PACKAGE_DIR: join(root, 'package'),
        SDK_NATIVE_PROOF_DIR: join(root, 'proof'),
        SDK_NATIVE_RESULT_DIR: join(root, 'results'),
        SDK_NATIVE_SCRATCH_DIR: join(root, 'scratch'),
        PAIR_FIXTURE_BARRIER: join(root, 'barrier'),
    };
    for (const [name, dir] of Object.entries(dirs))
        if (
            name !== 'SDK_NATIVE_RESULT_DIR' &&
            name !== 'SDK_NATIVE_SCRATCH_DIR'
        )
            mkdirSync(dir);
    const archive = 'synthetic fixture archive';
    const filename = 'miniextensions-sdk-fixture.tgz';
    const sha256 = createHash('sha256').update(archive).digest('hex');
    const source = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
    const ci = { runId: '1234', runAttempt: '1', workflowSha: source.commit };
    const evidence = {
        schemaVersion: 1,
        source,
        ci,
        package: {
            name: '@miniextensions/sdk',
            filename,
            version: 'fixture',
            sha256,
            bytes: archive.length,
        },
    };
    writeFileSync(join(dirs.SDK_NATIVE_PACKAGE_DIR, filename), archive);
    writeFileSync(
        join(dirs.SDK_NATIVE_PACKAGE_DIR, 'artifact-receipt.json'),
        JSON.stringify({
            ...evidence,
            ci: { ...ci, node: process.version },
            verification: { outcome: 'passed' },
        })
    );
    writeFileSync(
        join(dirs.SDK_NATIVE_PROOF_DIR, 'manifest.json'),
        JSON.stringify(evidence)
    );
    return {
        env: {
            ...process.env,
            ...dirs,
            GITHUB_SHA: source.commit,
            GITHUB_RUN_ID: ci.runId,
            GITHUB_RUN_ATTEMPT: ci.runAttempt,
        },
        sha256,
    };
}

function aggregate(packageResult) {
    return spawnSync('/bin/sh', ['-c', requiredCheck], {
        env: {
            ...process.env,
            SOURCE_RESULT: 'success',
            PACKAGE_RESULT: packageResult,
        },
    }).status;
}

function assertCleaned(env) {
    for (const lane of ['react19', 'react18']) {
        const scratch = readFileSync(
            join(env.PAIR_FIXTURE_BARRIER, lane),
            'utf8'
        );
        assert(!existsSync(scratch), `${lane} scratch retained`);
    }
    assert(!existsSync(env.SDK_NATIVE_SCRATCH_DIR));
}

it('starts both isolated consumers, keeps both complete receipts and passes the required check', async (t) => {
    const { env, sha256 } = setup(t);
    await checkNativeBrowserPair({ env, script: fixture });
    assert.equal(aggregate('success'), 0);
    for (const lane of ['react19', 'react18']) {
        const result = JSON.parse(
            readFileSync(
                join(env.SDK_NATIVE_RESULT_DIR, lane, 'native-receipt.json')
            )
        );
        assert.equal(result.package.sha256, sha256);
    }
    assertCleaned(env);
});

for (const lane of ['react19', 'react18']) {
    for (const [mode, field, expected] of [
        ['failed child', 'PAIR_FIXTURE_FAILURE', /Browser child ended with 7/],
        [
            'missing receipt',
            'PAIR_FIXTURE_MISSING',
            /Missing qualification input or receipt/,
        ],
    ]) {
        it(`fails the required check for ${lane} ${mode} with the other lane passing`, async (t) => {
            const { env } = setup(t);
            env[field] = lane;
            let packageResult = 'success';
            try {
                await checkNativeBrowserPair({ env, script: fixture });
            } catch (error) {
                assert.match(error.message, new RegExp(lane));
                assert.match(error.message, expected);
                packageResult = 'failure';
            }
            assert.equal(aggregate(packageResult), 1);
            const peer = lane === 'react19' ? 'react18' : 'react19';
            assert(
                existsSync(
                    join(env.SDK_NATIVE_RESULT_DIR, peer, 'native-receipt.json')
                )
            );
            assertCleaned(env);
        });
    }
}

it('refuses the wrong run attempt or changed archive before either browser starts', async (t) => {
    const { env } = setup(t);
    await assert.rejects(
        checkNativeBrowserPair({
            env: { ...env, GITHUB_RUN_ATTEMPT: '2' },
            script: fixture,
        }),
        /Qualified package run attempt mismatch/
    );
    writeFileSync(
        join(env.SDK_NATIVE_PACKAGE_DIR, 'miniextensions-sdk-fixture.tgz'),
        'different archive'
    );
    await assert.rejects(
        checkNativeBrowserPair({ env, script: fixture }),
        /Qualified package sha256 mismatch/
    );
    assert(!existsSync(env.SDK_NATIVE_RESULT_DIR));
});
