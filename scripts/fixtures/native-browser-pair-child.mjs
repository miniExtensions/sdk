import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { baselineNativeCases } from '../check-native-browser-pair.mjs';

const lane =
    process.env.SDK_NATIVE_REACT_VERSION === '19.2.0' ? 'react19' : 'react18';
const output = process.env.SDK_NATIVE_RESULT_DIR;
const barrier = process.env.PAIR_FIXTURE_BARRIER;
assert.equal(basename(output), lane);
assert.equal(basename(tmpdir()), lane);
assert.equal(process.env.npm_config_cache, join(tmpdir(), 'npm-cache'));
assert.equal(process.env.XDG_CONFIG_HOME, join(tmpdir(), 'config'));

writeFileSync(join(barrier, lane), tmpdir(), { flag: 'wx' });
const names = ['react19', 'react18'];
const deadline = Date.now() + 5000;
while (!names.every((name) => existsSync(join(barrier, name)))) {
    assert(
        Date.now() < deadline,
        'Both browser children must start concurrently'
    );
    await delay(10);
}
assert.notEqual(
    ...names.map((name) => readFileSync(join(barrier, name), 'utf8'))
);

if (process.env.PAIR_FIXTURE_MISSING !== lane) {
    const manifest = readFileSync(
        join(process.env.SDK_NATIVE_PROOF_DIR, 'manifest.json')
    );
    const input = JSON.parse(manifest);
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const cases = baselineNativeCases(lane);
    if (lane === 'react19') cases.push('added-browser-case');
    const receipt = JSON.stringify({
        schemaVersion: 1,
        source: input.source,
        ci: input.ci,
        package: input.package,
        fixtureManifestSha256: hash(manifest),
        reactVersion: process.env.SDK_NATIVE_REACT_VERSION,
        status: 'passed',
        cleanup: {
            consumer: 'completed',
            browser: 'completed',
            server: 'completed',
        },
        network: [],
        results: cases.map((name) => ({ name, status: 'passed' })),
    });
    mkdirSync(output);
    writeFileSync(join(output, 'native-receipt.json'), receipt);
    writeFileSync(
        join(output, 'SHA256SUMS'),
        `${hash(receipt)}  native-receipt.json\n`
    );
}
if (process.env.PAIR_FIXTURE_FAILURE === lane) process.exitCode = 7;
