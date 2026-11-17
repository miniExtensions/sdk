import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
    copyFileSync,
    cpSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    symlinkSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertPortalMapVendor } from './portal-map-vendor-checks.mjs';
import {
    materializeSourcePackageDependencies,
    sourcePackageFailureReceipt,
} from './source-package-checks.mjs';

test('source-package failure metadata preserves useful owned locations without compiler values or absolute paths', () => {
    const result = sourcePackageFailureReceipt(
        {
            status: 1,
            signal: null,
            stdout: '/private/temporary/src/react/PrintableForm.ts(12,4): error TS2742: synthetic-private-value\n/private/other/secret.ts(9,1): error TS2345: more-private-data',
            stderr: '[sdk-build-compiler] {"project":"tsconfig.json","private":"do-not-copy"}\nENOSPC',
        },
        new Set(['src/react/PrintableForm.ts'])
    );
    assert.deepEqual(result.diagnostics, [
        {
            code: 'TS2742',
            path: 'src/react/PrintableForm.ts',
            line: 12,
            column: 4,
        },
    ]);
    assert.deepEqual(result.codes, ['TS2742', 'TS2345']);
    assert.deepEqual(result.stages, ['tsconfig.json']);
    assert.deepEqual(result.failures, ['ENOSPC']);
    for (const secret of [
        '/private',
        'temporary',
        'synthetic-private-value',
        'more-private-data',
        'do-not-copy',
        'secret.ts',
    ])
        assert.equal(JSON.stringify(result).includes(secret), false);
});

test('source-package failure metadata remains bounded and never repeats an unknown signal', () => {
    const result = sourcePackageFailureReceipt(
        {
            status: 2,
            signal: 'private-signal',
            stdout: Array.from(
                { length: 30 },
                (_, index) =>
                    `src/a.ts(${index + 1},1): error TS${2000 + index}: private`
            ).join('\n'),
            stderr: '',
        },
        new Set(['src/a.ts'])
    );
    assert.equal(result.codes.length, 8);
    assert.equal(result.diagnostics.length, 8);
    assert.equal(result.signal, null);
    assert.equal(JSON.stringify(result).includes('private'), false);
});

const fixtureSdkRoot = fileURLToPath(new URL('../', import.meta.url));
const fixtureRequire = createRequire(join(fixtureSdkRoot, 'package.json'));
const mapPackages = ['@react-google-maps/api', '@googlemaps/js-api-loader'];
function byteInventory(root) {
    const result = [];
    function visit(directory) {
        for (const entry of readdirSync(directory, {
            withFileTypes: true,
        }).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = join(directory, entry.name);
            assert(!entry.isSymbolicLink());
            if (entry.isDirectory()) visit(path);
            else {
                assert(entry.isFile());
                result.push([
                    relative(root, path).replaceAll('\\', '/'),
                    createHash('sha256')
                        .update(readFileSync(path))
                        .digest('hex'),
                ]);
            }
        }
    }
    visit(root);
    return result;
}
function materializationFixture(t) {
    const temporary = mkdtempSync(
        join(tmpdir(), 'sdk-source-package-materialization-')
    );
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const source = join(temporary, 'source'),
        nested = join(temporary, 'nested');
    mkdirSync(join(source, 'node_modules'), { recursive: true });
    mkdirSync(nested);
    for (const target of [source, nested]) {
        copyFileSync(
            join(fixtureSdkRoot, 'package.json'),
            join(target, 'package.json')
        );
        cpSync(
            join(fixtureSdkRoot, 'vendor/portal-map'),
            join(target, 'vendor/portal-map'),
            { recursive: true }
        );
    }
    const selectedScopes = new Set(
        mapPackages.map((name) => name.split('/')[0])
    );
    for (const entry of readdirSync(join(fixtureSdkRoot, 'node_modules'))) {
        if (entry === '.bin') continue;
        const original = join(fixtureSdkRoot, 'node_modules', entry);
        const target = join(source, 'node_modules', entry);
        if (selectedScopes.has(entry)) {
            const ownedScope = join(temporary, 'owned-scopes', entry);
            mkdirSync(ownedScope, { recursive: true });
            // Exercise the old fixture's whole-scope symlink topology without
            // adding or changing anything in the original installed scope.
            symlinkSync(ownedScope, target);
            for (const child of readdirSync(original))
                symlinkSync(join(original, child), join(ownedScope, child));
        } else symlinkSync(original, target);
    }
    const neighbor = join(source, 'node_modules/@googlemaps/fixture-neighbor');
    mkdirSync(neighbor);
    writeFileSync(
        join(neighbor, 'README'),
        'Owned ordinary sibling; never executed.'
    );
    return { temporary, source, nested, neighbor };
}

test('source-package fixture materializes complete pinned Map packages while retaining scoped siblings and exact declaration bindings', (t) => {
    const fixture = materializationFixture(t);
    const before = new Map(
        mapPackages.map((name) => {
            const root = dirname(
                realpathSync(fixtureRequire.resolve(name + '/package.json'))
            );
            return [name, { root, files: byteInventory(root) }];
        })
    );
    assert(
        lstatSync(
            join(fixture.source, 'node_modules/@googlemaps')
        ).isSymbolicLink()
    );
    const receipt = materializeSourcePackageDependencies(
        fixture.source,
        fixture.nested
    );
    for (const name of mapPackages) {
        const target = join(fixture.nested, 'node_modules', name);
        assert(lstatSync(target).isDirectory());
        assert(!lstatSync(target).isSymbolicLink());
        assert.deepEqual(byteInventory(target), before.get(name).files);
        assert.deepEqual(
            byteInventory(before.get(name).root),
            before.get(name).files
        );
        assert.equal(
            receipt.materializedPackages.find((item) => item.name === name)
                .files,
            before.get(name).files.length
        );
        const manifest = JSON.parse(readFileSync(join(target, 'package.json')));
        const originalRequire = createRequire(
            join(before.get(name).root, 'package.json')
        );
        const copiedRequire = createRequire(join(target, 'package.json'));
        for (const [dependency, version] of Object.entries(
            manifest.dependencies ?? {}
        )) {
            const reached = realpathSync(
                copiedRequire.resolve(dependency + '/package.json')
            );
            assert.equal(JSON.parse(readFileSync(reached)).version, version);
            if (mapPackages.includes(dependency))
                assert.equal(
                    dirname(reached),
                    realpathSync(
                        join(fixture.nested, 'node_modules', dependency)
                    )
                );
            else
                assert.equal(
                    reached,
                    realpathSync(
                        originalRequire.resolve(dependency + '/package.json')
                    )
                );
        }
    }
    const targetScope = join(fixture.nested, 'node_modules/@googlemaps');
    assert(!lstatSync(targetScope).isSymbolicLink());
    const targetNeighbor = join(targetScope, 'fixture-neighbor');
    assert(lstatSync(targetNeighbor).isSymbolicLink());
    assert.equal(realpathSync(targetNeighbor), realpathSync(fixture.neighbor));
    assert.equal(
        readFileSync(join(fixture.neighbor, 'README'), 'utf8'),
        'Owned ordinary sibling; never executed.'
    );
    // This calls the unchanged read-only production validator, not a fake
    // vendor entry or package lifecycle script. Its containment/hash/source/
    // license assertions must accept the real in-fixture package copies.
    const verified = assertPortalMapVendor(fixture.nested);
    assert.equal(verified.physicalPackages.length, 2);
    assert.equal(verified.licenseFiles.length, 13);
});

test('source-package materialization refuses an internal package symlink without touching its external target or original install', (t) => {
    const fixture = materializationFixture(t);
    const name = '@react-google-maps/api';
    const original = dirname(
        realpathSync(fixtureRequire.resolve(name + '/package.json'))
    );
    const before = byteInventory(original);
    const owned = join(fixture.source, 'node_modules', name);
    unlinkSync(owned); // Only the owned fixture's alias, never the original.
    cpSync(original, owned, { recursive: true });
    const outside = join(fixture.temporary, 'outside.txt');
    writeFileSync(outside, 'Must stay unchanged.');
    symlinkSync(outside, join(owned, 'unexpected-link'));
    assert.throws(
        () =>
            materializeSourcePackageDependencies(
                fixture.source,
                fixture.nested
            ),
        /Map input must not contain symbolic links/
    );
    assert.equal(readFileSync(outside, 'utf8'), 'Must stay unchanged.');
    assert.deepEqual(byteInventory(original), before);
});
