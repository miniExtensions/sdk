import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    aggregate,
    enforce,
    hasRuntimeStatements,
    sourceCoverage,
} from './coverage-policy.mjs';

test('source remapping rejects duplicate entries rather than hiding one result', () => {
    assert.throws(
        () =>
            sourceCoverage('/sdk', {
                '/sdk/src/react/index.ts': {},
                '/sdk/dist/coverage-test/src/react/index.js': {},
            }),
        /Duplicate coverage for src\/react\/index.ts/
    );
});

test('type-only recognition cannot hide constants, imports, functions, or re-exports', () => {
    assert.equal(hasRuntimeStatements('// generated types\nexport {};'), false);
    for (const source of [
        'export const disabled = false;',
        'export function neverCalled() {}',
        'import "./side-effect.js"; export {};',
        'export * from "./module.js";',
        'export {} from "./side-effect.js";',
        'class Unused {}',
    ])
        assert.equal(hasRuntimeStatements(source), true, source);
});

test('uncovered source lowers weighted coverage and fails the gate', () => {
    const file = (covered, total) =>
        Object.fromEntries(
            ['lines', 'branches', 'functions', 'statements'].map((metric) => [
                metric,
                { covered, total },
            ])
        );
    const before = aggregate([file(99, 100)]);
    assert.deepEqual(enforce('source', before, { lines: 95 }), []);
    const after = aggregate([file(99, 100), file(0, 10)]);
    assert.equal(after.lines, 90);
    assert.equal(enforce('source', after, { lines: 95 }).length, 1);
    assert.equal(
        enforce('invalid report', { lines: NaN }, { lines: 95 }).length,
        1
    );
});
