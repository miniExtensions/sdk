import assert from 'node:assert/strict';
import test from 'node:test';
import { enforceNpmReleaseAge } from './npm-release-age.mjs';

const now = Date.parse('2026-11-17T10:00:00Z');
test('fresh npm filter is at least 48 hours old and preserves a stricter inherited cutoff', () => {
    for (const [environment, expected] of [
        [{}, '2026-11-15T10:00:00.000Z'],
        [
            { NPM_CONFIG_BEFORE: '2026-11-17T09:00:00Z' },
            '2026-11-15T10:00:00.000Z',
        ],
        [
            { NPM_CONFIG_BEFORE: '2026-11-14T00:00:00Z' },
            '2026-11-14T00:00:00.000Z',
        ],
    ]) {
        const before = enforceNpmReleaseAge({
            environment,
            now,
            execute(command, args, options) {
                assert.equal(command, 'npm');
                assert.deepEqual(args, ['config', 'list', '--json']);
                assert.equal(options.env.npm_config_before, expected);
                assert(!('NPM_CONFIG_BEFORE' in options.env));
                return JSON.stringify({
                    before: expected,
                    'min-release-age-exclude': [],
                });
            },
        });
        assert.equal(before, expected);
    }
});
test('fresh npm filter refuses invalid or ineffective cutoffs and exclusions', () => {
    assert.throws(
        () =>
            enforceNpmReleaseAge({
                environment: { npm_config_before: 'invalid' },
                now,
            }),
        /Invalid inherited/
    );
    for (const config of [
        { before: null },
        { before: '2026-11-17T10:00:00Z' },
        {
            before: '2026-11-15T10:00:00Z',
            'min-release-age-exclude': ['csstype'],
        },
    ])
        assert.throws(() =>
            enforceNpmReleaseAge({
                environment: {},
                now,
                execute: () => JSON.stringify(config),
            })
        );
});
test('older npm without exclusion support still verifies its effective cutoff', () => {
    assert.equal(
        enforceNpmReleaseAge({
            environment: {},
            now,
            execute: () => JSON.stringify({ before: '2026-11-15T10:00:00Z' }),
        }),
        '2026-11-15T10:00:00.000Z'
    );
});
