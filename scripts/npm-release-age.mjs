import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const minimumAgeMs = 2880 * 60 * 1000;

/** npm's documented `before` filter applies to fresh transitive resolutions.
 * https://docs.npmjs.com/cli/v11/using-npm/config#before
 * This does not admit a retained lock: its exact closure needs separate proof.
 */
export function enforceNpmReleaseAge({
    environment = process.env,
    now = Date.now(),
    execute = execFileSync,
} = {}) {
    assert(Number.isFinite(now));
    let cutoff = now - minimumAgeMs;
    for (const [key, value] of Object.entries(environment)) {
        if (key.toLowerCase() !== 'npm_config_before') continue;
        const inherited = Date.parse(value);
        assert(
            Number.isFinite(inherited),
            'Invalid inherited npm release cutoff'
        );
        cutoff = Math.min(cutoff, inherited);
    }
    const before = new Date(cutoff).toISOString();
    // Avoid conflicting case-insensitive npm environment aliases. Preserve a
    // stricter inherited cutoff; never relax it as the job proceeds.
    for (const key of Object.keys(environment))
        if (key.toLowerCase() === 'npm_config_before') delete environment[key];
    environment.npm_config_before = before;
    const config = JSON.parse(
        execute('npm', ['config', 'list', '--json'], {
            env: environment,
            encoding: 'utf8',
            timeout: 15000,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    );
    assert.equal(
        Date.parse(config.before),
        cutoff,
        'Effective npm release cutoff differs'
    );
    // Older npm versions have no exclusion feature. If supported, it must be
    // empty: exclusions also bypass npm's absolute `before` filter.
    assert.deepEqual(config['min-release-age-exclude'] ?? [], []);
    return before;
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    assert.equal(process.argv[2], '--github-env');
    assert.equal(process.argv.length, 4);
    const before = enforceNpmReleaseAge();
    appendFileSync(process.argv[3], `npm_config_before=${before}\n`);
    console.log(
        `Fresh npm resolutions require publication by ${before} (48 hours).`
    );
}
