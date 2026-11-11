import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The original picker artifact is frozen, including its actual peer requires. */
export function assertDateVendor(
    root = process.cwd(),
    relativeDirectory = 'vendor/date-time'
) {
    const directory = join(root, relativeDirectory);
    const receipt = JSON.parse(readFileSync(join(directory, 'UPSTREAM.json')));
    assert.equal(receipt.revision, '6fb5a547de6328f4103b4c5928c79a05473aea85');
    assert.deepEqual(
        readdirSync(directory).sort(),
        [...Object.keys(receipt.sha256), 'UPSTREAM.json'].sort()
    );
    for (const [name, expected] of Object.entries(receipt.sha256))
        assert.equal(
            createHash('sha256')
                .update(readFileSync(join(directory, name)))
                .digest('hex'),
            expected,
            name
        );
    const source = readFileSync(join(directory, 'upstream.cjs'), 'utf8');
    assert.deepEqual(
        [...source.matchAll(/require\("([^"]+)"\)/g)]
            .map((match) => match[1])
            .sort(),
        [...receipt.externalDependencies].sort()
    );
    const bytes = readFileSync(join(directory, 'upstream.cjs'));
    assert.equal(
        createHash('sha1')
            .update(`blob ${bytes.length}\0`)
            .update(bytes)
            .digest('hex'),
        receipt.distBlob
    );
}
