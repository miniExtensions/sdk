import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
    cpSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    symlinkSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function declarationFiles(root) {
    return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.d.ts'))
        .map((entry) => relative(root, join(entry.parentPath, entry.name)))
        .sort();
}

function sourcePackageTree(root) {
    const entries = [];
    function visit(directory) {
        for (const name of readdirSync(directory).sort()) {
            const path = join(directory, name);
            const info = lstatSync(path);
            assert(
                !info.isSymbolicLink(),
                'Source-package Map input must not contain symbolic links'
            );
            const member = relative(root, path).replaceAll('\\', '/');
            if (info.isDirectory()) {
                entries.push({ path: member, kind: 'directory' });
                visit(path);
            } else {
                assert(
                    info.isFile(),
                    'Source-package Map input must be a regular file'
                );
                const bytes = readFileSync(path);
                entries.push({
                    path: member,
                    kind: 'file',
                    bytes: bytes.length,
                    sha256: createHash('sha256').update(bytes).digest('hex'),
                });
            }
        }
    }
    visit(root);
    return entries;
}

/** Fixture-only materialization; no install, lifecycle script or vendor import. */
export function materializeSourcePackageDependencies(root, nested) {
    const modules = join(root, 'node_modules');
    const destination = join(nested, 'node_modules');
    mkdirSync(destination);
    const selected = JSON.parse(
        readFileSync(join(root, 'vendor/portal-map/UPSTREAM.json'))
    ).physicalPackages;
    assert.deepEqual(selected.map(({ name }) => name).sort(), [
        '@googlemaps/js-api-loader',
        '@react-google-maps/api',
    ]);
    const require = createRequire(join(root, 'package.json'));
    const selectedByName = new Map();
    const declaredBindings = new Map();
    for (const item of selected) {
        const manifestPath = realpathSync(
            require.resolve(item.name + '/package.json')
        );
        const packageRoot = dirname(manifestPath);
        const bytes = readFileSync(manifestPath);
        const manifest = JSON.parse(bytes);
        assert.equal(manifest.name, item.name);
        assert.equal(manifest.version, item.version);
        assert.equal(
            createHash('sha256').update(bytes).digest('hex'),
            item.packageJsonSha256
        );
        const inventory = sourcePackageTree(packageRoot);
        selectedByName.set(item.name, { packageRoot, manifest, inventory });
        const packageRequire = createRequire(manifestPath);
        for (const [name, version] of Object.entries(
            manifest.dependencies ?? {}
        )) {
            // These selected manifests declare exact versions. Reuse their
            // actual physical binding, never install or choose a new version.
            const path = realpathSync(
                packageRequire.resolve(name + '/package.json')
            );
            const dependency = JSON.parse(readFileSync(path));
            assert.equal(dependency.name, name);
            assert.equal(dependency.version, version);
            const dependencyRoot = dirname(path);
            if (declaredBindings.has(name))
                assert.equal(
                    declaredBindings.get(name),
                    dependencyRoot,
                    'Source-package dependency has conflicting physical bindings'
                );
            declaredBindings.set(name, dependencyRoot);
        }
    }
    for (const [name, item] of selectedByName)
        if (declaredBindings.has(name))
            assert.equal(
                declaredBindings.get(name),
                item.packageRoot,
                'Source-package selected dependency has conflicting physical bindings'
            );
    const realScopes = new Set(
        [...selectedByName.keys(), ...declaredBindings.keys()]
            .filter((name) => name.startsWith('@'))
            .map((name) => name.split('/')[0])
    );
    for (const entry of readdirSync(modules)) {
        if (entry === '.bin') continue;
        const source = join(modules, entry),
            target = join(destination, entry);
        if (realScopes.has(entry)) {
            mkdirSync(target);
            for (const child of readdirSync(source)) {
                if (selectedByName.has(entry + '/' + child)) continue;
                symlinkSync(join(source, child), join(target, child));
            }
        } else if (!selectedByName.has(entry)) symlinkSync(source, target);
    }
    const materializedPackages = [];
    for (const [name, item] of selectedByName) {
        const target = join(destination, name);
        mkdirSync(dirname(target), { recursive: true });
        cpSync(item.packageRoot, target, {
            recursive: true,
            dereference: false,
            errorOnExist: true,
            force: false,
        });
        assert(!lstatSync(target).isSymbolicLink());
        assert.deepEqual(
            sourcePackageTree(target),
            item.inventory,
            'Source-package materialization changed a selected package'
        );
        assert.deepEqual(
            sourcePackageTree(item.packageRoot),
            item.inventory,
            'Original selected package changed during materialization'
        );
        materializedPackages.push({
            name,
            version: item.manifest.version,
            files: item.inventory.filter((entry) => entry.kind === 'file')
                .length,
        });
    }
    // Moving the selected package out of pnpm's physical store also moves it
    // away from its declaration dependencies. Preserve those existing bindings
    // at fixture top level, without links inside either byte-identical copy.
    for (const [name, binding] of declaredBindings) {
        if (selectedByName.has(name)) continue;
        const target = join(destination, name);
        let present = true;
        try {
            lstatSync(target);
        } catch (error) {
            if (error.code === 'ENOENT') present = false;
            else throw error;
        }
        if (present)
            assert.equal(
                realpathSync(target),
                binding,
                'Source-package declaration binding conflicts with an existing dependency'
            );
        else {
            mkdirSync(dirname(target), { recursive: true });
            symlinkSync(binding, target);
        }
    }
    return {
        materializedPackages,
        reusedDeclaredDependencies: [...declaredBindings.keys()]
            .filter((name) => !selectedByName.has(name))
            .sort(),
    };
}

/** Failure-only metadata; compiler messages and absolute paths stay private. */
export function sourcePackageFailureReceipt(result, ownedSourcePaths) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const diagnostics = [];
    for (const match of output.matchAll(
        /^(.+?)\((\d+),(\d+)\): error (TS\d{4,6}):/gm
    )) {
        const path = match[1].replaceAll('\\', '/');
        const start = path.lastIndexOf('/src/');
        const relative = start < 0 ? path : path.slice(start + 1);
        if (!ownedSourcePaths.has(relative)) continue;
        diagnostics.push({
            code: match[4],
            path: relative,
            line: Number(match[2]),
            column: Number(match[3]),
        });
        if (diagnostics.length === 8) break;
    }
    return {
        status: result.status,
        signal: ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT'].includes(
            result.signal
        )
            ? result.signal
            : null,
        codes: [...new Set(output.match(/\bTS\d{4,6}\b/g) ?? [])].slice(0, 8),
        stages: [
            ...new Set(
                [
                    ...output.matchAll(
                        /"project":"(tsconfig(?:\.cjs)?\.json)"/g
                    ),
                ].map((match) => match[1])
            ),
        ],
        failures: [
            ...new Set(
                output.match(
                    /\b(?:ENOSPC|ENOMEM|EACCES|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ERR_ASSERTION)\b/g
                ) ?? []
            ),
        ],
        diagnostics,
    };
}

/** Git preparation compiles source beneath node_modules, unlike a checkout. */
export function assertSourcePackageBuild(root) {
    const temporary = realpathSync(
        mkdtempSync(join(tmpdir(), 'sdk-source-package-'))
    );
    try {
        const nested = join(
            temporary,
            'node_modules',
            '@miniextensions',
            'sdk'
        );
        mkdirSync(nested, { recursive: true });
        for (const entry of [
            'src',
            'types',
            'scripts',
            'vendor',
            'package.json',
            'tsconfig.json',
            'tsconfig.cjs.json',
        ]) {
            cpSync(join(root, entry), join(nested, entry), { recursive: true });
        }
        // Keep both directories real; reuse resolved dependencies without an
        // install, network request or mutation of the checkout's dependencies.
        materializeSourcePackageDependencies(root, nested);
        const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
            cwd: nested,
            encoding: 'utf8',
            timeout: 120000,
            maxBuffer: 1024 * 1024,
        });
        assert.ifError(result.error);
        // A failed preparation stays failed. Emit bounded codes/owned source
        // positions, never raw compiler messages or weaker compiler settings.
        const ownedSources = new Set(
            readdirSync(join(root, 'src'), {
                recursive: true,
                withFileTypes: true,
            })
                .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
                .map((entry) =>
                    relative(
                        root,
                        join(entry.parentPath, entry.name)
                    ).replaceAll('\\', '/')
                )
        );
        assert.equal(
            result.status,
            0,
            `SDK source package build failed: ${JSON.stringify(sourcePackageFailureReceipt(result, ownedSources))}`
        );
        let declarations = 0;
        for (const format of ['esm', 'cjs']) {
            const built = join(nested, 'dist', format);
            const control = join(root, 'dist', format);
            const paths = declarationFiles(control);
            assert(paths.length > 0, 'Missing checkout declarations');
            assert.deepEqual(
                declarationFiles(built),
                paths,
                'Source package declaration inventory changed'
            );
            for (const path of paths) {
                assert(
                    readFileSync(join(built, path)).equals(
                        readFileSync(join(control, path))
                    ),
                    `Source package declaration differs: ${format}/${path}`
                );
                declarations++;
            }
        }
        return { formats: 2, declarations };
    } finally {
        rmSync(temporary, { recursive: true, force: true });
    }
}
