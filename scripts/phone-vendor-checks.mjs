import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Private Phone runtime only; maps/tests are not customer inputs. */
export const phoneRuntimeFilter = (source) =>
    !source.endsWith('.map') && !source.endsWith('.test.js');

export function assertPhoneVendor(
    directory = join(process.cwd(), 'vendor/phone-number-input')
) {
    const safe = (path) => {
        assert(
            /^[A-Za-z0-9_./-]+$/.test(path) && !path.split('/').includes('..'),
            'Unsafe Phone vendor path'
        );
        return join(directory, path);
    };
    const bytes = (path) => {
        const file = safe(path);
        const stat = lstatSync(file);
        assert(
            stat.isFile() && !stat.isSymbolicLink(),
            'Unsafe Phone vendor file: ' + path
        );
        return readFileSync(file);
    };
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    const json = (path) => JSON.parse(bytes(path).toString('utf8'));
    const upstream = json('UPSTREAM.json');
    const adaptations = json('ADAPTATIONS.json');
    assert.equal(upstream.schemaVersion, 1);
    assert.equal(adaptations.schemaVersion, 2);
    for (const [name, version] of [
        ['react-phone-number-input', '3.3.9'],
        ['libphonenumber-js', '1.10.57'],
        ['input-format', '0.3.9'],
    ]) {
        assert.equal(
            upstream.packages.find((item) => item.name === name)?.version,
            version
        );
    }
    assert.deepEqual(adaptations.externalRuntimeModules, ['react']);
    assert.deepEqual(adaptations.unsupportedRequires, []);
    const reverseSemantic = (current, edits, expectedBefore) => {
        let before = current;
        let previousStart = Infinity;
        for (const edit of [...edits].reverse()) {
            assert(
                Number.isInteger(edit.adaptedStartByte) &&
                    Number.isInteger(edit.adaptedEndByte)
            );
            assert(
                edit.adaptedStartByte >= 0 &&
                    edit.adaptedEndByte >= edit.adaptedStartByte
            );
            assert(
                edit.adaptedEndByte <= previousStart &&
                    edit.adaptedEndByte <= before.length
            );
            assert.equal(
                before
                    .subarray(edit.adaptedStartByte, edit.adaptedEndByte)
                    .toString('utf8'),
                edit.adaptedLiteral,
                'Changed semantic Phone adaptation'
            );
            before = Buffer.concat([
                before.subarray(0, edit.adaptedStartByte),
                Buffer.from(edit.originalLiteral),
                before.subarray(edit.adaptedEndByte),
            ]);
            previousStart = edit.adaptedStartByte;
        }
        assert.equal(
            hash(before),
            expectedBefore,
            'Wrong semantic Phone preimage'
        );
        return before;
    };
    const changed = new Map(
        adaptations.changedUpstreamFiles.map((file) => [file.path, file])
    );
    assert.equal(changed.size, adaptations.changedUpstreamFiles.length);
    const expected = new Set(['UPSTREAM.json', 'ADAPTATIONS.json']);
    for (const file of upstream.files) {
        assert(!expected.has(file.path), 'Duplicate Phone upstream path');
        expected.add(file.path);
        const current = bytes(file.path);
        const patch = changed.get(file.path);
        assert.equal(
            hash(current),
            patch?.adaptedSha256 ?? file.sha256,
            'Changed Phone vendor file: ' + file.path
        );
        if (patch) {
            assert.equal(patch.originalSha256, file.sha256);
            let original = patch.semanticEdits
                ? reverseSemantic(
                      current,
                      patch.semanticEdits,
                      patch.importAdaptedSha256
                  )
                : current;
            for (const rewrite of [...patch.rewrites].reverse()) {
                assert.equal(
                    original
                        .subarray(
                            rewrite.adaptedStartByte,
                            rewrite.adaptedEndByte
                        )
                        .toString('utf8'),
                    rewrite.adaptedLiteral,
                    'Changed Phone import adaptation'
                );
                original = Buffer.concat([
                    original.subarray(0, rewrite.adaptedStartByte),
                    Buffer.from(rewrite.originalLiteral),
                    original.subarray(rewrite.adaptedEndByte),
                ]);
            }
            assert.equal(
                hash(original),
                file.sha256,
                'Wrong original Phone source'
            );
        }
    }
    for (const patch of adaptations.changedUpstreamFiles) {
        expected.add(patch.path);
        assert.equal(
            hash(bytes(patch.path)),
            patch.adaptedSha256,
            'Changed Phone vendor file: ' + patch.path
        );
        if (patch.kind === 'scoped-css') {
            assert.equal(hash(bytes(patch.originalPath)), patch.originalSha256);
            assert(
                patch.selectors.every((item) =>
                    item.to.startsWith('.mx-sdk-complete-phone')
                )
            );
        }
    }
    const ownedChanges = new Map(
        adaptations.ownedFileChanges.map((file) => [file.path, file])
    );
    assert.equal(ownedChanges.size, adaptations.ownedFileChanges.length);
    assert.deepEqual(
        [...ownedChanges.keys()].sort(),
        ['sdk-runtime.d.ts'],
        'Missing required owned Phone evolution'
    );
    // Fixed facade preimage from the preserved import-only closure packet.
    assert.equal(
        ownedChanges.get('sdk-runtime.d.ts').previousSha256,
        '654b6b45baae8e32097b8b3acce659e557e13fd275a0e294b40c9377bf8072cc',
        'Wrong owned Phone history preimage'
    );
    for (const file of adaptations.newOwnedFiles) {
        assert(!expected.has(file.path), 'Duplicate owned Phone path');
        expected.add(file.path);
        assert.equal(
            hash(bytes(file.path)),
            file.sha256,
            'Changed Phone vendor file: ' + file.path
        );
        const evolution = ownedChanges.get(file.path);
        if (evolution) {
            assert.equal(evolution.adaptedSha256, file.sha256);
            reverseSemantic(
                bytes(file.path),
                evolution.semanticEdits,
                evolution.previousSha256
            );
            ownedChanges.delete(file.path);
        }
    }
    assert.equal(ownedChanges.size, 0, 'Unlisted owned Phone evolution');
    const prefix = 'vendor/phone-number-input/';
    const relative = (path) => {
        assert(path.startsWith(prefix), 'Phone edge outside private runtime');
        return path.slice(prefix.length);
    };
    const external = new Set();
    for (const edge of adaptations.runtimeEdges) {
        assert(expected.has(relative(edge.from)), 'Missing Phone source edge');
        if (edge.external) external.add(edge.specifier);
        else {
            assert(
                expected.has(relative(edge.target)),
                'Missing Phone dependency edge'
            );
            bytes(relative(edge.target));
        }
    }
    assert.deepEqual([...external].sort(), ['react']);
    const actual = [];
    const visit = (path, prefix = '') => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const relativePath = prefix + entry.name;
            assert(!entry.isSymbolicLink(), 'Unsafe Phone vendor symlink');
            if (entry.isDirectory())
                visit(join(path, entry.name), relativePath + '/');
            else {
                assert(entry.isFile(), 'Unsupported Phone vendor entry');
                actual.push(relativePath);
            }
        }
    };
    visit(directory);
    assert.deepEqual(
        actual.sort(),
        [...expected].sort(),
        'Unexpected Phone vendor file'
    );
    return {
        packages: upstream.packages.length,
        runtimeFiles: upstream.files.filter((file) => file.kind === 'runtime')
            .length,
        privateFiles: expected.size,
        rewrites: adaptations.changedUpstreamFiles.reduce(
            (count, file) => count + (file.rewrites?.length ?? 0),
            0
        ),
        external: ['react'],
    };
}
