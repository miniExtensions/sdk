import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Keep upstream contributor docs in source, outside the customer runtime kit. */
export const richTextRuntimeFilter = (source) =>
    !source.endsWith('.map') &&
    !source.endsWith('.stories.js') &&
    !source
        .replaceAll('\\', '/')
        .endsWith('/dependencies/styled-components/README.md');

/** Verify the immutable input and the explicitly recorded SDK compatibility patches. */
export function assertRichTextVendor(root = process.cwd()) {
    const directory = join(root, 'vendor/rich-markdown-editor');
    const json = (path) =>
        JSON.parse(readFileSync(join(directory, path), 'utf8'));
    const hash = (path) => {
        assert(
            /^[A-Za-z0-9_./-]+$/.test(path) && !path.split('/').includes('..')
        );
        const file = join(directory, path);
        assert(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink());
        return createHash('sha256').update(readFileSync(file)).digest('hex');
    };
    const upstream = json('UPSTREAM.json');
    const adaptations = json('ADAPTATIONS.json');
    assert.equal(upstream.revision, 'aa3bddd1d023739df9f673c22f950a67d8b6bbbf');
    assert.equal(adaptations.upstreamRevision, upstream.revision);
    assert.equal(
        hash('LICENSE'),
        '8fd8b0665b4c5be36b96355e4e3faa4bb2de514ea2bf6c61db738f80868a59a9'
    );
    const changed = new Map(
        adaptations.changedUpstreamFiles.map((file) => [file.path, file])
    );
    assert.equal(changed.size, adaptations.changedUpstreamFiles.length);
    const verifyInput = (prefix, entries) => {
        for (const file of entries) {
            const path = prefix + file.path;
            const patch = changed.get(path);
            if (patch) {
                assert.equal(
                    patch.originalSha256,
                    file.sha256,
                    `Wrong original hash: ${path}`
                );
                assert.equal(
                    hash(path),
                    patch.adaptedSha256,
                    `Unrecorded vendor change: ${path}`
                );
            } else
                assert.equal(
                    hash(path),
                    file.sha256,
                    `Changed immutable vendor input: ${path}`
                );
            if (file.path === 'package.json')
                assert.equal(
                    hash(prefix + 'upstream-package.json'),
                    file.sha256
                );
        }
    };
    verifyInput('', upstream.unmodifiedSourceSha256);
    for (const name of [
        'outline-icons',
        'prosemirror-utils',
        'styled-components',
    ]) {
        const prefix = `dependencies/${name}/`;
        verifyInput(
            prefix,
            json(prefix + 'UPSTREAM.json').unmodifiedSourceSha256
        );
    }
    const styled = 'dependencies/styled-components/';
    for (const file of json(styled + 'UPSTREAM.json').preservedOriginalRuntime)
        assert.equal(
            hash(styled + file.path),
            file.sha256,
            `Changed original styled-components runtime: ${file.path}`
        );
    const zoom = 'dependencies/react-medium-image-zoom/';
    verifyInput(
        zoom,
        Object.entries(json(zoom + 'UPSTREAM.json').sha256).map(
            ([path, sha256]) => ({ path, sha256 })
        )
    );
    for (const file of adaptations.changedUpstreamFiles)
        assert.equal(
            hash(file.path),
            file.adaptedSha256,
            `Changed adaptation: ${file.path}`
        );
    for (const file of [...adaptations.newOwnedFiles, ...adaptations.licenses])
        assert.equal(
            hash(file.path),
            file.sha256,
            `Changed vendor artifact: ${file.path}`
        );
    return {
        revision: upstream.revision,
        patches: changed.size,
        licenses: adaptations.licenses.length,
    };
}
