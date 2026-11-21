import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformSync } from 'esbuild';
import { installAgeQualifiedConsumer } from './age-qualified-consumer-install.mjs';

// Run from the SDK root with a tarball built by the normal package recipe.
// node scripts/check-readonly-portal-grid-currency.mjs <archive> <sha256>
const [archive, expectedSha256] = process.argv.slice(2);
assert.equal(process.argv.length, 4);
assert.match(expectedSha256, /^[0-9a-f]{64}$/);
const archivePath = realpathSync(archive);
const archiveBytes = readFileSync(archivePath);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(archiveBytes), expectedSha256, 'Unexpected SDK archive');
const source = readFileSync(
    new URL('./readonly-portal-grid-currency-checks.mjs', import.meta.url),
    'utf8'
);
const dom = readFileSync(
    new URL('../test/fixtures/htmlPresentationFixture.ts', import.meta.url),
    'utf8'
);
const [commit, tree] = execFileSync(
    'git',
    ['rev-parse', 'HEAD', 'HEAD^{tree}'],
    {
        encoding: 'utf8',
    }
)
    .trim()
    .split('\n');

const profiles = [];
for (const react of ['18.3.1', '19.2.0']) {
    const root = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-grid-currency-'))
    );
    try {
        writeFileSync(
            join(root, 'package.json'),
            JSON.stringify({
                private: true,
                dependencies: {
                    '@miniextensions/sdk': `file:${archivePath}`,
                    react,
                    'react-dom': react,
                    'happy-dom': '20.0.11',
                },
            })
        );
        const installation = installAgeQualifiedConsumer({
            directory: root,
            args: ['install', '--ignore-scripts'],
        });
        assert.equal(installation.archiveSha256, expectedSha256);
        for (const [format, extension] of [
            ['esm', 'mjs'],
            ['cjs', 'cjs'],
        ]) {
            const witness = `currency-grid.test.${extension}`;
            const compile = (name, input, loader) =>
                writeFileSync(
                    join(root, name),
                    transformSync(input, {
                        loader,
                        format,
                        target: 'es2022',
                    }).code
                );
            compile(`htmlPresentationFixture.${extension}`, dom, 'ts');
            compile(
                witness,
                source.replace(
                    './htmlPresentationFixture.mjs',
                    `./htmlPresentationFixture.${extension}`
                ),
                'js'
            );
            const output = execFileSync(
                process.execPath,
                ['--test', '--test-reporter=tap', witness],
                {
                    cwd: root,
                    encoding: 'utf8',
                    env: { ...process.env, SDK_GRID_CURRENCY_REACT: react },
                    timeout: 120000,
                }
            );
            assert.match(output, /^# tests 1$/m);
            assert.match(output, /^# pass 1$/m);
            assert.match(output, /^# fail 0$/m);
            profiles.push({ react, format, cases: 1, installation });
        }
    } finally {
        rmSync(root, { recursive: true });
    }
}
console.log(
    JSON.stringify(
        {
            checkout: {
                commit,
                tree,
                witnessSha256: sha(source),
                domFixtureSha256: sha(dom),
            },
            package: {
                archive: archivePath,
                bytes: archiveBytes.length,
                sha256: expectedSha256,
            },
            profiles,
            cleanup: { temporaryConsumersRemoved: true },
        },
        null,
        2
    )
);
