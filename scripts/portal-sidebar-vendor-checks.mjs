import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const expected = {
    LICENSE: 'ccff072c393e25ef1466f6206e87eba6dfab128cab2697b7d247767cea506658',
    'index.js':
        '051e56db20d3d0e0b18db45e25bcf9ce5e450cd64bb184e23cdda22e85ce1d61',
    'index.d.ts':
        'aa5b8b738978b89adf301110fc4e6b0ef0f545eb6c74ef3019312183cbf68d11',
    'resizer.d.ts':
        '51be228ebfa38f9becf290a3ee150343f5cc8050b8d2a2899c7c4c026d74df71',
    'package.json':
        '22a0fbf1ac73ff06d00b2ff434553bb46cfe2a8f210616f1481b1284673b07d5',
    'upstream.package.json':
        '6394facc78efe6d40a0e899e0fe7ab2a0662296d1797128525d5dc906a6f0860',
};

/** Unmodified upstream engine; renderers are external consumer peers. */
export function assertPortalSidebarVendor(
    root = process.cwd(),
    relativeDirectory = 'vendor/portal-sidebar'
) {
    const directory = join(root, relativeDirectory);
    assert(
        lstatSync(directory).isDirectory() &&
            !lstatSync(directory).isSymbolicLink()
    );
    assert.deepEqual(
        readdirSync(directory).sort(),
        [...Object.keys(expected), 'UPSTREAM.json'].sort()
    );
    for (const name of [...Object.keys(expected), 'UPSTREAM.json']) {
        const stat = lstatSync(join(directory, name));
        assert(
            stat.isFile() && !stat.isSymbolicLink(),
            `Unexpected sidebar vendor entry: ${name}`
        );
    }
    const receipt = JSON.parse(readFileSync(join(directory, 'UPSTREAM.json')));
    assert.equal(receipt.package, 're-resizable');
    assert.equal(receipt.version, '6.11.2');
    assert.equal(
        receipt.integrity,
        'sha512-2xI2P3OHs5qw7K0Ud1aLILK6MQxW50TcO+DetD9eIV58j84TqYeHoZcL9H4GXFXXIh7afhH8mv5iUCXII7OW7A=='
    );
    assert.deepEqual(receipt.sha256, expected);
    for (const [name, digest] of Object.entries(expected))
        assert.equal(
            createHash('sha256')
                .update(readFileSync(join(directory, name)))
                .digest('hex'),
            digest,
            name
        );
    const external = [
        ...readFileSync(join(directory, 'index.js'), 'utf8').matchAll(
            /require\('([^']+)'\)/g
        ),
    ]
        .map((match) => match[1])
        .sort();
    assert.deepEqual(external, ['react', 'react-dom', 'react/jsx-runtime']);
    assert.deepEqual(receipt.externalPeers, external);
    return {
        version: receipt.version,
        files: Object.keys(expected).length + 1,
        runtimeSHA256: expected['index.js'],
        externalPeers: external,
    };
}
