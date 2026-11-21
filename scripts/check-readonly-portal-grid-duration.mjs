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
import { checkReadonlyPortalGridDurationConsumer } from './readonly-portal-grid-duration-checks.mjs';

// node scripts/check-readonly-portal-grid-duration.mjs <archive> <sha256>
const [archive, expectedSha256] = process.argv.slice(2);
assert.equal(process.argv.length, 4);
assert.match(expectedSha256, /^[0-9a-f]{64}$/);
const archivePath = realpathSync(archive);
const archiveBytes = readFileSync(archivePath);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(archiveBytes), expectedSha256, 'Unexpected SDK archive');
const source = readFileSync(
    new URL('./readonly-portal-grid-duration-checks.mjs', import.meta.url)
);
const dom = readFileSync(
    new URL('../test/fixtures/htmlPresentationFixture.ts', import.meta.url),
    'utf8'
);
const git = (args) => execFileSync('git', args, { encoding: 'utf8' });
const [commit, tree] = git(['rev-parse', 'HEAD', 'HEAD^{tree}'])
    .trim()
    .split('\n');
const dirty = git(['status', '--porcelain']) !== '';
const profiles = [];
for (const react of ['18.3.1', '19.2.0']) {
    const root = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-grid-duration-'))
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
        const run = (command, args) =>
            execFileSync(command, args, {
                cwd: root,
                encoding: 'utf8',
                timeout: 120000,
            });
        for (const [format, extension] of [
            ['esm', 'mjs'],
            ['cjs', 'cjs'],
        ]) {
            writeFileSync(
                join(root, `grid-fixture.${extension}`),
                transformSync(dom, {
                    loader: 'ts',
                    format,
                    target: 'es2022',
                }).code
            );
            const proof = checkReadonlyPortalGridDurationConsumer({
                root,
                format,
                extension,
                react,
                run,
            });
            profiles.push({ react, format, cases: 1, installation, proof });
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
                dirty,
                witnessSha256: hash(source),
                domFixtureSha256: hash(dom),
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
