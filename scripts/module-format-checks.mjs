import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { Script } from 'node:vm';

export const moduleFormatReceiptPath = 'dist/cjs/module-format-receipt.json';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const record = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const packagePath = (root, path) => {
    assert(
        typeof path === 'string' &&
            /^\.\/dist\/(?:cjs|esm)\/[A-Za-z0-9_./-]+\.js$/.test(path) &&
            !path.split('/').includes('..'),
        'Module export must target a relative built JavaScript file'
    );
    return join(root, path);
};

function packageType(root, file) {
    for (let directory = dirname(file); ; directory = dirname(directory)) {
        const manifest = join(directory, 'package.json');
        if (existsSync(manifest)) {
            assert(
                lstatSync(manifest).isFile(),
                'Package marker must be regular'
            );
            return readJson(manifest).type ?? 'commonjs';
        }
        assert(directory !== root, 'Module must have a package scope');
    }
}

function commonJsFiles(root, directory) {
    const files = [];
    for (const name of readdirSync(directory).sort()) {
        const path = join(directory, name);
        const stat = lstatSync(path);
        assert(
            !stat.isSymbolicLink(),
            'Built output must not contain symlinks'
        );
        if (stat.isDirectory()) files.push(...commonJsFiles(root, path));
        else if (name.endsWith('.js')) {
            assert(stat.isFile(), 'Built JavaScript must be a regular file');
            assert.equal(packageType(root, path), 'commonjs');
            try {
                // Parse without executing package code or loading optional peers.
                const source = readFileSync(path, 'utf8')
                    .replace(/^\uFEFF/, '')
                    .replace(/^#![^\n]*(?:\n|$)/, '');
                new Script(Module.wrap(source), {
                    filename: relative(root, path),
                });
            } catch {
                throw new Error(
                    `Invalid CommonJS output: ${relative(root, path)}`
                );
            }
            files.push(path);
        }
    }
    return files;
}

/** Build/package tooling only; does not execute distributed modules. */
export function assertModuleFormats(root) {
    root = resolve(root);
    const manifest = readJson(join(root, 'package.json'));
    assert.equal(manifest.name, '@miniextensions/sdk');
    assert.equal(manifest.type, 'module');
    assert(record(manifest.exports));
    assert(lstatSync(join(root, 'dist/cjs')).isDirectory());
    assert(lstatSync(join(root, 'dist/esm')).isDirectory());
    assert.equal(
        readJson(join(root, 'dist/cjs/package.json')).type,
        'commonjs'
    );
    const files = commonJsFiles(root, join(root, 'dist/cjs'));
    assert(files.length > 0, 'CommonJS output must not be empty');
    const entries = [];
    const require = createRequire(join(root, 'package.json'));
    for (const [subpath, mapping] of Object.entries(manifest.exports).sort()) {
        assert(subpath === '.' || /^\.\/[A-Za-z0-9_-]+$/.test(subpath));
        assert(
            record(mapping) && record(mapping.import) && record(mapping.require)
        );
        const entry = { subpath };
        for (const [condition, format, type] of [
            ['import', 'esm', 'module'],
            ['require', 'cjs', 'commonjs'],
        ]) {
            const path = mapping[condition].default;
            const file = packagePath(root, path);
            assert(path.startsWith(`./dist/${format}/`));
            assert(
                lstatSync(file).isFile(),
                'Module export target must be regular'
            );
            assert.equal(packageType(root, file), type);
            if (condition === 'require') {
                assert.equal(
                    require.resolve(
                        manifest.name +
                            (subpath === '.' ? '' : subpath.slice(1))
                    ),
                    file,
                    'Native require resolution must select the declared CommonJS entry'
                );
            }
            const bytes = readFileSync(file);
            entry[condition] = {
                path,
                size: bytes.length,
                sha256: createHash('sha256').update(bytes).digest('hex'),
            };
        }
        assert.equal(
            entry.import.path.slice('./dist/esm/'.length),
            entry.require.path.slice('./dist/cjs/'.length),
            'Import and require must expose matching built entry points'
        );
        entries.push(entry);
    }
    assert(entries.length > 0, 'Built package must expose entry points');
    return { schemaVersion: 1, entries };
}

/** Compare installed bytes with the deterministic post-build entry receipt. */
export function assertModuleFormatReceipt(root) {
    const actual = assertModuleFormats(root);
    assert.deepEqual(readJson(join(root, moduleFormatReceiptPath)), actual);
    return actual;
}
