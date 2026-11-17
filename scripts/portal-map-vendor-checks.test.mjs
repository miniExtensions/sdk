import assert from 'node:assert/strict';
import test from 'node:test';
import {
    copyFileSync,
    cpSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    assertPortalMapVendor,
    bundlePortalMap,
} from './portal-map-vendor-checks.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const upstream = JSON.parse(
    readFileSync(join(root, 'vendor/portal-map/UPSTREAM.json'))
);
function fixture(t) {
    const target = mkdtempSync(join(tmpdir(), 'sdk-portal-map-vendor-'));
    t.after(() => rmSync(target, { recursive: true, force: true }));
    copyFileSync(join(root, 'package.json'), join(target, 'package.json'));
    cpSync(join(root, 'vendor/portal-map'), join(target, 'vendor/portal-map'), {
        recursive: true,
    });
    for (const selected of upstream.physicalPackages) {
        const files = new Set([
            'package.json',
            ...selected.entries.map((item) => item.path),
            ...selected.licenseFiles.map((item) => item.path),
            ...upstream.prebundledSourceMaps
                .filter((item) => item.package === selected.name)
                .map((item) => item.path),
            ...upstream.selectedSourceProof
                .filter((item) => item.package === selected.name)
                .map((item) => item.path),
        ]);
        for (const file of files) {
            const destination = join(
                target,
                'node_modules',
                selected.name,
                file
            );
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(
                join(root, 'node_modules', selected.name, file),
                destination
            );
        }
    }
    assertPortalMapVendor(target);
    return target;
}
test('pinned installed Map graph, reached source blobs, maps and all notices verify', () => {
    const verified = assertPortalMapVendor(root);
    assert.equal(
        verified.selectedApiReleaseCommit,
        '093860a4b25c4ed5a9d94316a2587f2c375eced3'
    );
    assert.equal(verified.licenseFiles.length, 13);
    assert.equal(verified.sourceMapContentVerification.compared, 58);
    assert.equal(verified.sourceMapContentVerification.nullContents, 1);
});
test('Map guard refuses commercial/latest version drift without installing it', (t) => {
    const target = fixture(t);
    const path = join(target, 'package.json');
    const manifest = JSON.parse(readFileSync(path));
    manifest.devDependencies['@react-google-maps/api'] = '3.0.0';
    writeFileSync(path, JSON.stringify(manifest));
    assert.throws(() => assertPortalMapVendor(target));
});
for (const [name, packageName, file] of [
    ['selected API ESM', '@react-google-maps/api', 'dist/esm.js'],
    [
        'selected direct Loader ESM',
        '@googlemaps/js-api-loader',
        'dist/index.mjs',
    ],
    ['API source map', '@react-google-maps/api', 'dist/esm.js.map'],
    ['reached Map source', '@react-google-maps/api', 'src/GoogleMap.tsx'],
    ['upstream license', '@googlemaps/js-api-loader', 'LICENSE'],
])
    test(`Map guard refuses changed ${name} bytes`, (t) => {
        const target = fixture(t);
        const path = join(target, 'node_modules', packageName, file);
        writeFileSync(path, readFileSync(path, 'utf8') + '\nchanged');
        assert.throws(() => assertPortalMapVendor(target));
    });
test('Map guard refuses missing or changed preserved third-party notices', (t) => {
    const target = fixture(t);
    const notice = join(
        target,
        'vendor/portal-map',
        upstream.licenseFiles.at(-1).path
    );
    writeFileSync(notice, 'incomplete notice');
    assert.throws(() => assertPortalMapVendor(target));
});
test('Map guard refuses package symlinks outside its installed root even with exact bytes', (t) => {
    const target = fixture(t);
    const inside = join(target, 'node_modules/@googlemaps/js-api-loader');
    const outside = join(target, 'outside-loader');
    cpSync(inside, outside, { recursive: true });
    rmSync(inside, { recursive: true });
    symlinkSync(outside, inside);
    assert.throws(
        () => assertPortalMapVendor(target),
        /escaped installed root/
    );
});
test('Map bundler refuses a new unreviewed physical dependency before writing output', async (t) => {
    const target = fixture(t);
    const directory = join(target, 'node_modules/unreviewed-map-input');
    mkdirSync(directory, { recursive: true });
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify({
            name: 'unreviewed-map-input',
            version: '1.0.0',
            type: 'module',
            main: 'index.js',
        })
    );
    writeFileSync(
        join(directory, 'index.js'),
        'globalThis.__mustNeverExecute = true;'
    );
    const sourceEntry = 'dist/esm/react/map/GoogleMapsRuntime.js';
    const source = join(target, sourceEntry);
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(
        source,
        "import {GoogleMap} from '@react-google-maps/api';\nimport {Loader} from '@googlemaps/js-api-loader';\nimport 'unreviewed-map-input';\nexport const selected = () => [GoogleMap, Loader];\n"
    );
    await assert.rejects(
        bundlePortalMap(target, {
            sourceEntry,
            outputs: [{ format: 'esm', child: sourceEntry }],
        }),
        /Unreviewed Map physical input/
    );
    assert.equal(globalThis.__mustNeverExecute, undefined);
});
