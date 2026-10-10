import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
    assertModuleFormats,
    moduleFormatReceiptPath,
} from './module-format-checks.mjs';

const require = createRequire(import.meta.url);
const compiler = require.resolve('typescript/bin/tsc');

for (const directory of ['dist/esm', 'dist/cjs']) {
    rmSync(directory, { recursive: true, force: true });
}

for (const project of ['tsconfig.json', 'tsconfig.cjs.json']) {
    const result = spawnSync(
        process.execPath,
        [compiler, '--project', project],
        {
            stdio: 'inherit',
        }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
}

mkdirSync('dist/cjs', { recursive: true });
writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');

// The detailed source manifest remains the generator's internal --check input.
const internal = JSON.parse(
    readFileSync('src/runtime/contracts/generated.provenance.json', 'utf8')
);
const declarations = readFileSync('dist/esm/runtime/contracts/generated.d.ts');
assert(
    declarations.equals(
        readFileSync('dist/cjs/runtime/contracts/generated.d.ts')
    ),
    'Module formats must distribute identical contract declarations'
);
const publicOperationFields = [
    'operation',
    'input',
    'output',
    'route',
    'kind',
    'transport',
];
const dependencyPackages = ['@trpc/server', 'airtable', 'zod', '@types/node'];
const dependencyHashes = new Map(
    dependencyPackages.map((name) => [name, new Set()])
);
for (const { path, sha256 } of internal.dependencies) {
    const name = dependencyPackages.find((name) => path.startsWith(name + '/'));
    assert(name, 'Unrecognized generated contract dependency');
    dependencyHashes.get(name).add(sha256);
}
const publicProvenance = {
    schemaVersion: 1,
    compilerVersion: internal.compilerVersion,
    generatorSha256: internal.generatorSha256,
    transport: internal.transport,
    declarationCount: internal.declarationCount,
    generatedSha256: internal.generatedSha256,
    contractDeclarationsSha256: createHash('sha256')
        .update(declarations)
        .digest('hex'),
    operations: internal.operations.map((operation) =>
        Object.fromEntries(
            publicOperationFields.map((field) => [field, operation[field]])
        )
    ),
    dependencies: dependencyPackages.map((name) => ({
        package: name,
        inputSha256: [...dependencyHashes.get(name)].sort(),
    })),
};
for (const format of ['esm', 'cjs']) {
    const modulePath = `dist/${format}/runtime/contracts/generated.js`;
    const module = readFileSync(modulePath, 'utf8');
    const privateComment = `// Canonical monorepo revision: ${internal.sourceRevision}\n`;
    assert.equal(
        module.split(privateComment).length,
        2,
        'Expected one generated revision comment'
    );
    // Remove only this comment; emitted code and other comments stay intact.
    writeFileSync(modulePath, module.replace(privateComment, ''));
    writeFileSync(
        `dist/${format}/runtime/contracts/generated.provenance.json`,
        JSON.stringify(publicProvenance, null, 4) + '\n'
    );
}

// Prepack inherits this boundary: malformed output must never become a TGZ.
writeFileSync(
    moduleFormatReceiptPath,
    JSON.stringify(assertModuleFormats(process.cwd()), null, 4) + '\n'
);
