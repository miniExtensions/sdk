import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
} from 'node:path';

/** Preserve the single archive that already passed the packed consumer checks. */
export function retainCheckedPackage({
    archivePath,
    packed,
    installedPackage,
    outputDirectory,
    source,
    ci = {},
    browserPortalChecks,
}) {
    assert.equal(packed.name, '@miniextensions/sdk');
    assert.equal(packed.filename, `miniextensions-sdk-${packed.version}.tgz`);
    assert.equal(basename(packed.filename), packed.filename);
    assert.equal(basename(archivePath), packed.filename);
    assert(lstatSync(archivePath).isFile(), 'Archive must be a regular file');
    const archive = readFileSync(archivePath);
    const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`;
    assert.equal(integrity, packed.integrity, 'Tested archive bytes changed');
    const sha256 = createHash('sha256').update(archive).digest('hex');

    const guidePath = join(installedPackage, 'docs/browser-lifecycle.md');
    assert(lstatSync(guidePath).isFile(), 'Guide must be a regular file');
    assert.equal(
        realpathSync(guidePath),
        resolve(guidePath),
        'Guide must not traverse symlinks'
    );
    const guide = execFileSync(
        'tar',
        ['-xzOf', '-', 'package/docs/browser-lifecycle.md'],
        { input: archive, timeout: 10000, maxBuffer: 1024 * 1024 }
    );
    assert.deepEqual(
        readFileSync(guidePath),
        guide,
        'Installed guide bytes differ from the tested archive'
    );
    const packedGuide = packed.files.find(
        ({ path }) => path === 'docs/browser-lifecycle.md'
    );
    assert(packedGuide, 'Guide must be shipped in the tested archive');
    assert.equal(
        guide.length,
        packedGuide.size,
        'Installed guide size changed'
    );
    const guideSha256 = createHash('sha256').update(guide).digest('hex');
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    assert.match(source.tree, /^[a-f0-9]{40}$/);
    if (ci.workflowSha) assert.equal(source.commit, ci.workflowSha);
    assert(isAbsolute(outputDirectory), 'Artifact output must be absolute');
    const output = resolve(outputDirectory);
    assert.equal(
        join(realpathSync(dirname(output)), basename(output)),
        output,
        'Artifact output parent must not contain symlinks'
    );
    const fromConsumer = relative(dirname(realpathSync(archivePath)), output);
    assert(
        fromConsumer === '..' ||
            fromConsumer.startsWith('../') ||
            isAbsolute(fromConsumer),
        'Artifact output must survive consumer cleanup'
    );
    mkdirSync(output); // Refuse existing output; never merge unrelated files.
    try {
        writeFileSync(join(output, packed.filename), archive, { flag: 'wx' });
        assert.deepEqual(readFileSync(join(output, packed.filename)), archive);
        writeFileSync(join(output, 'miniExtensions-SDK-INSTALL.md'), guide, {
            flag: 'wx',
        });
        writeFileSync(
            join(output, 'SHA256SUMS'),
            `${sha256}  ${packed.filename}\n${guideSha256}  miniExtensions-SDK-INSTALL.md\n`,
            { flag: 'wx' }
        );
        writeFileSync(
            join(output, 'artifact-receipt.json'),
            JSON.stringify(
                {
                    schemaVersion: 1,
                    package: {
                        name: packed.name,
                        version: packed.version,
                        filename: packed.filename,
                        bytes: archive.length,
                        sha256,
                        integrity,
                        files: packed.files.length,
                    },
                    guide: {
                        filename: 'miniExtensions-SDK-INSTALL.md',
                        packedPath: 'docs/browser-lifecycle.md',
                        bytes: guide.length,
                        sha256: guideSha256,
                    },
                    source: { commit: source.commit, tree: source.tree },
                    ci: {
                        repository: ci.repository,
                        event: ci.event,
                        runId: ci.runId,
                        runAttempt: ci.runAttempt,
                        workflowSha: ci.workflowSha,
                        pullRequestHeadSha: ci.pullRequestHeadSha,
                        node: process.version,
                    },
                    verification: {
                        command: 'node scripts/check-package.mjs',
                        outcome: 'passed',
                        browserPortalChecks,
                    },
                },
                null,
                2
            ) + '\n',
            { flag: 'wx' }
        );
    } catch (error) {
        rmSync(output, { recursive: true, force: true });
        throw error;
    }
}
