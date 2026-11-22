import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {
    compilePostgresRuntime,
    postgresRuntimeOutputHashes,
    rewritePostgresAttachmentRuntime,
} from './postgres-runtime-artifacts.mjs';

const canonical = `import type { PostgresValue } from './types';
export const expose = (value: PostgresValue): PostgresValue => value;
`;

test('portable runtime generation preserves authored behavior in ESM and CommonJS', async () => {
    const generated = await rewritePostgresAttachmentRuntime(canonical, {});
    assert.equal(
        await rewritePostgresAttachmentRuntime(canonical, {}),
        generated
    );
    const output = compilePostgresRuntime(generated);
    const esm = await import(
        'data:text/javascript;base64,' +
            Buffer.from(output.esm).toString('base64')
    );
    const commonjs = { exports: {} };
    vm.runInNewContext(output.cjs, commonjs);
    for (const runtime of [esm, commonjs.exports]) {
        assert.equal(runtime.expose('9007199254740993'), '9007199254740993');
        assert.equal(runtime.expose(null), null);
    }
    assert.match(output.declaration, /CanonicalPostgresValue as PostgresValue/);
    assert(!output.declaration.includes('types/postgres/'));
    assert.deepEqual(
        postgresRuntimeOutputHashes(generated),
        postgresRuntimeOutputHashes(generated)
    );
});

test('portable generation refuses changed imports and runtime module dependencies', async () => {
    for (const source of [
        canonical.replace('import type', 'import'),
        canonical.replace("'./types'", "'./private-types'"),
        canonical.replace(
            '{ PostgresValue }',
            '{ PostgresValue, PostgresRecord }'
        ),
        canonical + "export { privateHelper } from './private-helper';\n",
        canonical + "export const dependency = import('./private-helper');\n",
        canonical + "export const dependency = require('./private-helper');\n",
        canonical +
            "export type Dependency = import('./private-helper').PrivateType;\n",
    ])
        await assert.rejects(
            rewritePostgresAttachmentRuntime(source, {}),
            /imports|portable/
        );
    await assert.rejects(
        rewritePostgresAttachmentRuntime('export const = ;', {}),
        /invalid syntax/
    );
});
