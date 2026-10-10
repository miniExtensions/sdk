import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
    assertModuleFormats,
    assertModuleFormatReceipt,
    moduleFormatReceiptPath,
} from './module-format-checks.mjs';
import { compilerMetadata } from './build-metadata.mjs';
import { withCommonJsSource } from './commonjs-source.mjs';

const write = (root, path, value) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), value);
};
const json = (root, path, value) => write(root, path, JSON.stringify(value));

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'sdk-module-format-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const manifest = {
        name: '@miniextensions/sdk',
        type: 'module',
        exports: {
            './formulas': {
                import: { default: './dist/esm/formulas/index.js' },
                require: { default: './dist/cjs/formulas/index.js' },
            },
        },
    };
    json(root, 'package.json', manifest);
    json(root, 'dist/cjs/package.json', { type: 'commonjs' });
    write(root, 'dist/esm/formulas/index.js', 'export const value = 1;\n');
    // The guard must parse, never execute package code.
    write(
        root,
        'dist/cjs/formulas/index.js',
        'throw new Error("Do not execute");\nexports.value = 1;\n'
    );
    return { root, manifest };
}

test('valid CJS is parsed without execution and produces a deterministic relative-only receipt', (t) => {
    const { root } = fixture(t);
    const receipt = assertModuleFormats(root);
    assert.deepEqual(assertModuleFormats(root), receipt);
    assert.equal(JSON.stringify(receipt).includes(root), false);
    assert.deepEqual(Object.keys(receipt), ['schemaVersion', 'entries']);
    for (const condition of ['import', 'require']) {
        const entry = receipt.entries[0][condition];
        assert.deepEqual(Object.keys(entry), ['path', 'size', 'sha256']);
        assert.equal(entry.size, readFileSync(join(root, entry.path)).length);
    }
    json(root, moduleFormatReceiptPath, receipt);
    assert.deepEqual(assertModuleFormatReceipt(root), receipt);
});

test('the exact 787-byte ESM-plus-use-strict entry is refused as CommonJS', (t) => {
    const { root } = fixture(t);
    // Frozen historical bytes; future formula exports must not change this case.
    const malformed = `"use strict";
export { default, default as FormulaRunner } from './runner.js';
export { default as Interpreter, FormulaFunctions, } from './interpreter/interpreter.js';
export { default as Lexer } from './lexer/lexer.js';
export { default as TokenTypes } from './lexer/tokenTypes.js';
export { default as Parser } from './parser/parser.js';
export { Binary, Literal, Unary, FunctionCall, Grouping, Identifier, } from './parser/ast.js';
export { extractIdentifiersFromExpr, extractIdentifiersFromFormula, } from './helpers/extractIdentifiersFromExpr.js';
export { AIRTABLE_FORMULA_ERROR_VALUE, AirtableFieldType, } from './types.js';
export { getReadableStringFromAirtableValue, convertAirtableValueToPrimitive, formatAirtablePrimitive, arrayJoinSeparator, } from './valueConversion.js';
`;
    assert.equal(Buffer.byteLength(malformed), 787);
    assert.equal(
        createHash('sha256').update(malformed).digest('hex'),
        '171e6d2808ede950b49285ea9efe071b973e4de6ef13446c7e7681fb7c37babd'
    );
    write(root, 'dist/cjs/formulas/index.js', malformed);
    assert.throws(
        () => assertModuleFormats(root),
        /Invalid CommonJS output: dist\/cjs\/formulas\/index.js/
    );
});

test('non-entry CommonJS modules are checked too', (t) => {
    const { root } = fixture(t);
    write(
        root,
        'dist/cjs/formulas/nested/broken.js',
        'export const invalid = 1;\n'
    );
    assert.throws(() => assertModuleFormats(root), /Invalid CommonJS output/);
});

test('an overriding export condition cannot redirect native require to ESM', (t) => {
    const { root, manifest } = fixture(t);
    manifest.exports['./formulas'] = {
        node: './dist/esm/formulas/index.js',
        ...manifest.exports['./formulas'],
    };
    json(root, 'package.json', manifest);
    assert.throws(
        () => assertModuleFormats(root),
        /Native require resolution must select/
    );
});

test('native CommonJS BOM and hashbang stripping is retained', (t) => {
    const { root } = fixture(t);
    write(
        root,
        'dist/cjs/formulas/index.js',
        '\uFEFF#!/usr/bin/env node\nexports.value = 1;\n'
    );
    assertModuleFormats(root);
});

for (const [path, type] of [
    ['dist/cjs/formulas/package.json', 'module'],
    ['dist/esm/formulas/package.json', 'commonjs'],
    ['dist/cjs/package.json', 'module'],
]) {
    test(`conflicting package scope is refused: ${path}`, (t) => {
        const { root } = fixture(t);
        json(root, path, { type });
        assert.throws(() => assertModuleFormats(root));
    });
}

for (const target of [
    './dist/esm/formulas/index.js',
    './dist/cjs/formulas/missing.js',
    './dist/cjs/../esm/formulas/index.js',
    '/tmp/index.js',
    './dist/cjs/formulas/other.js',
]) {
    test(`invalid require export is refused: ${target}`, (t) => {
        const { root, manifest } = fixture(t);
        if (target.endsWith('other.js'))
            write(root, target, 'exports.value = 2;\n');
        manifest.exports['./formulas'].require.default = target;
        json(root, 'package.json', manifest);
        assert.throws(() => assertModuleFormats(root));
    });
}

test('symlinked CommonJS output is refused', (t) => {
    const { root } = fixture(t);
    symlinkSync('index.js', join(root, 'dist/cjs/formulas/alias.js'));
    assert.throws(() => assertModuleFormats(root), /symlinks/);
});

test('post-build parseable entry changes fail the receipt comparison', (t) => {
    const { root } = fixture(t);
    json(root, moduleFormatReceiptPath, assertModuleFormats(root));
    write(root, 'dist/cjs/formulas/index.js', 'exports.changed = true;\n');
    assert.throws(() => assertModuleFormatReceipt(root));
});

function diagnostic(callback) {
    let error;
    try {
        callback();
    } catch (caught) {
        error = caught;
    }
    assert(error instanceof Error);
    assert.equal(error.stack, `Error: ${error.message}`);
    return JSON.parse(error.message.split('; ')[1]);
}

test('parse diagnostics fingerprint original bytes and report static ESM without exposing source', (t) => {
    const { root } = fixture(t);
    const source =
        '\uFEFF#!/usr/bin/env node\nexport const PRIVATE_MARKER = "never disclose";\n';
    write(root, 'dist/cjs/formulas/index.js', source);
    const result = diagnostic(() => assertModuleFormats(root));
    assert.deepEqual(result, {
        stage: 'parse',
        path: 'dist/cjs/formulas/index.js',
        exceptionClass: 'SyntaxError',
        size: Buffer.byteLength(source),
        sha256: createHash('sha256').update(source).digest('hex'),
        esmSyntax: true,
    });
    assert.equal(JSON.stringify(result).includes(root), false);
    assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER'), false);
});

for (const [source, expected] of [
    [
        '// export const ignored = 1;\nconst text = "import private from secret";\nexports.x = ;',
        false,
    ],
    ['const promise = import("PRIVATE_MARKER");\nexports.x = ;', false],
    ['exports.x = import.meta.url;', true],
    ['export default 1;', true],
    ['import x from "PRIVATE_MARKER";', true],
]) {
    test(`native parse refusal retains explanatory syntax classification ${expected}: ${source.slice(0, 16)}`, (t) => {
        const { root } = fixture(t);
        write(root, 'dist/cjs/formulas/index.js', source);
        const result = diagnostic(() => assertModuleFormats(root));
        assert.equal(result.stage, 'parse');
        assert.equal(result.exceptionClass, 'SyntaxError');
        assert.equal(result.esmSyntax, expected);
        assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER'), false);
    });
}

for (const hostile of [false, true]) {
    test(`read failure is distinct, has no invented fingerprint, and suppresses hostile exceptions: ${hostile}`, (t) => {
        const { root } = fixture(t);
        const original = fs.readFileSync;
        t.mock.method(fs, 'readFileSync', function (path, ...args) {
            if (path === join(root, 'dist/cjs/formulas/index.js')) {
                if (hostile)
                    throw new Proxy(
                        {},
                        {
                            getPrototypeOf() {
                                throw new Error('PRIVATE_MARKER');
                            },
                        }
                    );
                const error = new Error(`PRIVATE_MARKER ${root}`);
                Object.defineProperty(error, 'name', {
                    get() {
                        throw new Error('PRIVATE_MARKER');
                    },
                });
                throw error;
            }
            return original.call(this, path, ...args);
        });
        assert.deepEqual(
            diagnostic(() => assertModuleFormats(root)),
            {
                stage: 'read',
                path: 'dist/cjs/formulas/index.js',
                exceptionClass: hostile ? 'unknown' : 'Error',
                size: null,
                sha256: null,
                esmSyntax: null,
            }
        );
    });
}

test('compiler metadata invokes the resolved executable with public CLI flags and suppresses arbitrary output', () => {
    const require = createRequire(import.meta.url);
    const compiler = require.resolve('typescript/bin/tsc');
    const calls = [];
    const result = compilerMetadata(
        compiler,
        'tsconfig.cjs.json',
        (binary, args, options) => {
            calls.push({ binary, args, options });
            return {
                status: 0,
                stdout: args.includes('--version')
                    ? 'Version 5.9.3\n'
                    : JSON.stringify({
                          compilerOptions: {
                              module: 'commonjs',
                              moduleResolution: 'node10',
                              PRIVATE_MARKER: '/private/path',
                          },
                      }),
                stderr: 'PRIVATE_MARKER',
            };
        },
        '--require=/private/PRIVATE_MARKER'
    );
    assert.deepEqual(
        calls.map((call) => call.args),
        [
            [compiler, '--version'],
            [compiler, '--project', 'tsconfig.cjs.json', '--showConfig'],
        ]
    );
    assert(
        calls.every(
            (call) =>
                call.options.timeout === 30000 &&
                call.options.maxBuffer === 1024 * 1024
        )
    );
    assert.equal(result.compilerEntry, 'typescript/bin/tsc');
    assert.equal(result.compilerVersion, '5.9.3');
    assert.equal(result.module, 'commonjs');
    assert.equal(result.moduleResolution, 'node10');
    assert.equal(result.inheritedPreloadHint, true);
    assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER'), false);
    assert.equal(JSON.stringify(result).includes(compiler), false);
});

test('compiler diagnostic failures stay finite without replacing the build or disclosing errors', () => {
    const compiler = createRequire(import.meta.url).resolve(
        'typescript/bin/tsc'
    );
    for (const execute of [
        () => {
            throw new Error('PRIVATE_MARKER');
        },
        () => ({
            status: 1,
            stdout: 'PRIVATE_MARKER',
            stderr: 'PRIVATE_MARKER',
        }),
        () => ({ status: 0, stdout: 'PRIVATE_MARKER' }),
    ]) {
        const result = compilerMetadata(compiler, 'tsconfig.json', execute, '');
        assert.equal(result.compilerVersion, 'unknown');
        assert.equal(result.configuration, 'unavailable');
        assert.equal(result.module, 'unknown');
        assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER'), false);
    }
});

test('an unexpected but recognized effective module is reported rather than hidden as unknown', () => {
    const compiler = createRequire(import.meta.url).resolve(
        'typescript/bin/tsc'
    );
    const metadata = compilerMetadata(
        compiler,
        'tsconfig.cjs.json',
        (_binary, args) => ({
            status: 0,
            stdout: args.includes('--version')
                ? 'Version 5.9.3\n'
                : JSON.stringify({
                      compilerOptions: {
                          module: 'esnext',
                          moduleResolution: 'bundler',
                      },
                  }),
        }),
        ''
    );
    assert.equal(metadata.module, 'esnext');
    assert.equal(metadata.moduleResolution, 'bundler');
});

test('actual resolved compiler reports inherited effective ESM and explicit CJS options', () => {
    const compiler = createRequire(import.meta.url).resolve(
        'typescript/bin/tsc'
    );
    for (const [project, module, resolution] of [
        ['tsconfig.json', 'nodenext', 'nodenext'],
        ['tsconfig.cjs.json', 'commonjs', 'node10'],
    ]) {
        const metadata = compilerMetadata(compiler, project);
        assert.equal(metadata.compilerVersion, '5.9.3');
        assert.equal(metadata.compilerEntry, 'typescript/bin/tsc');
        assert.equal(metadata.configuration, 'available');
        assert.equal(metadata.module, module);
        assert.equal(metadata.moduleResolution, resolution);
    }
});

function compilerFixture(root) {
    json(root, 'package.json', {
        name: '@miniextensions/sdk',
        type: 'module',
        exports: {
            './formulas': {
                import: { default: './dist/esm/formulas/index.js' },
                require: { default: './dist/cjs/formulas/index.js' },
            },
        },
    });
    json(root, 'tsconfig.json', {
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            strict: true,
            declaration: true,
            rootDir: 'src',
            outDir: 'dist/esm',
            types: [],
        },
        include: ['src/**/*.ts'],
    });
    json(root, 'tsconfig.cjs.json', {
        extends: './tsconfig.json',
        compilerOptions: {
            module: 'CommonJS',
            moduleResolution: 'Node',
            outDir: 'dist/cjs',
        },
    });
    write(root, 'src/formulas/value.ts', 'export const value = 7;\n');
    write(
        root,
        'src/formulas/index.ts',
        "export { value } from './value.js';\n"
    );
    write(
        root,
        'src/auth/flow.ts',
        "import { value } from '../formulas/value.js';\nexport const read = () => value;\n"
    );
    json(root, 'dist/cjs/package.json', { type: 'commonjs' });
}

function fileBytes(root) {
    const entries = readdirSync(root, { recursive: true, withFileTypes: true });
    return Object.fromEntries(
        entries
            .filter((entry) => entry.isFile())
            .map((entry) => {
                const path = join(entry.parentPath, entry.name);
                return [
                    relative(root, path),
                    readFileSync(path).toString('hex'),
                ];
            })
            .sort(([left], [right]) => left.localeCompare(right))
    );
}

const stages = (root) =>
    readdirSync(join(root, 'dist')).filter((name) =>
        name.startsWith('.cjs-source-')
    );

test('real TypeScript under node_modules: old output is refused; detached source scope matches plain CJS and declarations', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'sdk-source-scope-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const plain = join(root, 'plain');
    const nested = join(root, 'node_modules', 'sdk');
    const compiler = createRequire(import.meta.url).resolve(
        'typescript/bin/tsc'
    );
    const compile = (project, cwd) => {
        const result = spawnSync(process.execPath, [compiler, '-p', project], {
            cwd,
            encoding: 'utf8',
            timeout: 30000,
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    for (const location of [plain, nested]) {
        compilerFixture(location);
        compile('tsconfig.json', location);
        compile('tsconfig.cjs.json', location);
    }
    assertModuleFormats(plain);
    assert.throws(() => assertModuleFormats(nested), /Invalid CommonJS output/);
    assert.deepEqual(
        fileBytes(join(nested, 'dist/esm')),
        fileBytes(join(plain, 'dist/esm'))
    );
    assert.equal(
        readFileSync(join(nested, 'dist/cjs/formulas/index.js'), 'utf8'),
        '"use strict";\n' +
            readFileSync(join(nested, 'dist/esm/formulas/index.js'), 'utf8')
    );
    const originals = {
        source: fileBytes(join(nested, 'src')),
        manifest: readFileSync(join(nested, 'package.json')),
        config: readFileSync(join(nested, 'tsconfig.cjs.json')),
    };
    withCommonJsSource(nested, (project) => {
        assert.equal(
            JSON.parse(
                readFileSync(join(project, '..', 'package.json'), 'utf8')
            ).type,
            'commonjs'
        );
        assert.deepEqual(
            Object.fromEntries(
                Object.entries(fileBytes(join(project, '..'))).filter(
                    ([path]) => path.endsWith('.ts')
                )
            ),
            originals.source
        );
        const configs = [join(nested, 'tsconfig.cjs.json'), project].map(
            (path) => {
                const result = spawnSync(
                    process.execPath,
                    [compiler, '-p', path, '--showConfig'],
                    { encoding: 'utf8', timeout: 30000 }
                );
                assert.ifError(result.error);
                assert.equal(result.status, 0);
                const config = JSON.parse(result.stdout);
                delete config.compilerOptions.rootDir;
                delete config.compilerOptions.outDir;
                return config.compilerOptions;
            }
        );
        assert.deepEqual(configs[0], configs[1]);
        const calls = [];
        const metadata = compilerMetadata(
            compiler,
            'tsconfig.cjs.json',
            (binary, args, options) => {
                calls.push(args);
                return spawnSync(binary, args, options);
            },
            '',
            project
        );
        assert.equal(metadata.module, 'commonjs');
        assert.equal(metadata.moduleResolution, 'node10');
        assert.equal(metadata.project, 'tsconfig.cjs.json');
        assert.equal(calls[1][2], project);
        assert.equal(JSON.stringify(metadata).includes(root), false);
        compile(project, nested);
    });
    assert.deepEqual(stages(nested), []);
    assertModuleFormats(nested);
    assert.deepEqual(
        fileBytes(join(nested, 'dist/cjs')),
        fileBytes(join(plain, 'dist/cjs'))
    );
    assert.deepEqual(fileBytes(join(nested, 'src')), originals.source);
    assert.deepEqual(
        readFileSync(join(nested, 'package.json')),
        originals.manifest
    );
    assert.deepEqual(
        readFileSync(join(nested, 'tsconfig.cjs.json')),
        originals.config
    );
});

test('owned source staging is removed on compiler nonzero, thrown spawn/probe failure and source copy failure', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'sdk-source-cleanup-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    compilerFixture(root);
    assert.deepEqual(
        withCommonJsSource(root, () => ({ status: 2 })),
        { status: 2 }
    );
    assert.deepEqual(stages(root), []);
    const error = new Error('controlled compiler failure');
    assert.throws(
        () =>
            withCommonJsSource(root, () => {
                throw error;
            }),
        (caught) => caught === error
    );
    assert.deepEqual(stages(root), []);
    const source = fileBytes(join(root, 'src'));
    assert.throws(() =>
        withCommonJsSource(join(root, 'missing-source'), () =>
            assert.fail('no compile after failed copy')
        )
    );
    assert.deepEqual(stages(join(root, 'missing-source')), []);
    assert.deepEqual(fileBytes(join(root, 'src')), source);
});

test('real compiler rejection cleans staging and preserves the original invalid source', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'sdk-source-invalid-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    compilerFixture(root);
    const invalid = 'export const value: string = 7;\n';
    write(root, 'src/formulas/value.ts', invalid);
    const compiler = createRequire(import.meta.url).resolve(
        'typescript/bin/tsc'
    );
    const result = withCommonJsSource(root, (project) =>
        spawnSync(process.execPath, [compiler, '-p', project], {
            encoding: 'utf8',
            timeout: 30000,
        })
    );
    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    assert.deepEqual(stages(root), []);
    assert.equal(
        readFileSync(join(root, 'src/formulas/value.ts'), 'utf8'),
        invalid
    );
});

for (const name of ['package.json', 'tsconfig.json']) {
    test(`failed staged ${name} write cleans only the owned copy`, (t) => {
        const root = mkdtempSync(join(tmpdir(), 'sdk-source-write-failure-'));
        t.after(() => rmSync(root, { recursive: true, force: true }));
        compilerFixture(root);
        mkdirSync(join(root, 'src', name));
        assert.throws(() =>
            withCommonJsSource(root, () =>
                assert.fail('no compiler after failed setup')
            )
        );
        assert.deepEqual(stages(root), []);
        assert.equal(fs.statSync(join(root, 'src', name)).isDirectory(), true);
    });
}

test('exclusive staging preserves preexisting matching directories and symlinks', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'sdk-source-existing-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    compilerFixture(root);
    write(root, 'dist/.cjs-source-existing/sentinel', 'preserve');
    symlinkSync('.cjs-source-existing', join(root, 'dist/.cjs-source-linked'));
    const expected = ['.cjs-source-existing', '.cjs-source-linked'];
    withCommonJsSource(root, () => {});
    assert.deepEqual(stages(root).sort(), expected);
    assert.throws(() =>
        withCommonJsSource(root, () => {
            throw new Error('failure');
        })
    );
    assert.deepEqual(stages(root).sort(), expected);
    assert.equal(
        readFileSync(join(root, 'dist/.cjs-source-linked/sentinel'), 'utf8'),
        'preserve'
    );
});
