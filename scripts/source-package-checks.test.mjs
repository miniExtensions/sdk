import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sourcePackageFailureReceipt } from './source-package-checks.mjs';

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
