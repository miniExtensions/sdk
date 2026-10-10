import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
    assertModuleFormats,
    assertModuleFormatReceipt,
    moduleFormatReceiptPath,
} from './module-format-checks.mjs';

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
