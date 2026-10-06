import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const operationFields = [
    'operation',
    'input',
    'output',
    'route',
    'kind',
    'transport',
];
const dependencyPackages = ['@trpc/server', 'airtable', 'zod', '@types/node'];
const provenanceFields = [
    'schemaVersion',
    'compilerVersion',
    'generatorSha256',
    'transport',
    'declarationCount',
    'generatedSha256',
    'contractDeclarationsSha256',
    'operations',
    'dependencies',
];
const requiredNoticeHashes = [
    'e714dd84c8fa242600844b05d317a31003423723178c1f1603dbfad1bc68d906',
    'de6cc263f206fe7559bf1c9ec13a0c37699ab16d04e2741267915d6b6337be4e',
    '3f1189b28e3866e0d979968d466b78f813f76827cfdca1fbb124cc0a5c8841f8',
    'c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383',
    'da6d3703ed11cbe42bd212c725957c98da23cbff1998c05fa4b3d976d1a58e93',
];
// Independent exact CI artifact evidence: these type-only modules differ from
// the reviewed output solely by removal of the private revision comment.
const publicModuleHashes = {
    esm: 'b566ab9cef9925e1c747c9295f76ac7732c5361ad669564f38d2b3b0d640c028',
    cjs: 'aef4061114ce2ca779b4ff8b939dd6e2d6e39a3a61d0457064a39af7b7dc8df9',
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function exactKeys(value, keys) {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        JSON.stringify(Object.keys(value).sort()) ===
            JSON.stringify([...keys].sort())
    );
}

// Called after archive-to-install byte verification, so this examines the
// actual customer TGZ rather than a checkout or independently repacked tree.
export async function assertPublicDistribution(
    packageRoot,
    packedPaths,
    internal
) {
    const contents = new Map();
    const privateValues = [
        // The private backend source namespace must not leak through new
        // documentation paths absent from the generated contract manifest.
        'backend-src/',
        internal.sourceRepository,
        internal.sourceRevision,
        ...internal.sources.map(({ path }) => path),
        ...internal.dependencies.map(({ path }) => path),
        ...internal.operations.map(({ module }) => module),
    ].filter((value) => typeof value === 'string' && value.length > 0);
    for (const path of packedPaths) {
        assert(
            !path.endsWith('.map'),
            'Source map shipped in customer package'
        );
        const bytes = await readFile(join(packageRoot, path));
        contents.set(path, bytes);
        const text = bytes.toString('utf8');
        assert(
            privateValues.every((value) => !text.includes(value)),
            `Private source provenance shipped in ${path}`
        );
    }
    const declarations = contents.get(
        'dist/esm/runtime/contracts/generated.d.ts'
    );
    assert(declarations, 'Missing customer contract declarations');
    assert(
        declarations.equals(
            contents.get('dist/cjs/runtime/contracts/generated.d.ts')
        ),
        'Customer module formats have different contract declarations'
    );
    const declarationDigest = sha256(declarations);
    const expectedDependencies = dependencyPackages.map((name) => ({
        package: name,
        inputSha256: [
            ...new Set(
                internal.dependencies
                    .filter(({ path }) => path.startsWith(name + '/'))
                    .map(({ sha256 }) => sha256)
            ),
        ].sort(),
    }));
    assert(
        internal.dependencies.every(({ path }) =>
            dependencyPackages.some((name) => path.startsWith(name + '/'))
        ),
        'Unrecognized recorded contract dependency'
    );
    for (const format of ['esm', 'cjs']) {
        const prefix = `dist/${format}/runtime/contracts/generated`;
        const provenance = JSON.parse(
            contents.get(prefix + '.provenance.json')
        );
        assert(
            exactKeys(provenance, provenanceFields),
            'Unexpected public provenance fields'
        );
        assert(
            provenance.schemaVersion === 1,
            'Invalid public provenance schema'
        );
        for (const field of [
            'compilerVersion',
            'generatorSha256',
            'transport',
            'declarationCount',
            'generatedSha256',
        ]) {
            assert(
                provenance[field] === internal[field],
                `Public provenance changed recorded ${field}`
            );
        }
        assert(
            provenance.contractDeclarationsSha256 === declarationDigest,
            'Public provenance does not identify packaged declarations'
        );
        assert(
            Array.isArray(provenance.operations) &&
                provenance.operations.length === internal.operations.length,
            'Public provenance lost operation coverage'
        );
        provenance.operations.forEach((operation, index) => {
            assert(
                exactKeys(operation, operationFields),
                'Private operation metadata shipped'
            );
            for (const field of operationFields) {
                assert(
                    operation[field] === internal.operations[index][field],
                    'Public operation differs from recorded contract'
                );
            }
        });
        assert(
            JSON.stringify(provenance.dependencies) ===
                JSON.stringify(expectedDependencies),
            'Public dependency provenance differs from captured inputs'
        );
        assert(
            sha256(contents.get(prefix + '.js')) === publicModuleHashes[format],
            'Contract runtime bytes changed beyond the private comment'
        );
    }
    assert(
        contents
            .get('docs/runtime.md')
            .toString('utf8')
            .includes('`' + declarationDigest + '`'),
        'Runtime guide does not identify the packaged declaration snapshot'
    );
    const notices = contents.get('THIRD_PARTY_NOTICES.md').toString('utf8');
    const newSection = notices.indexOf('\n## tRPC ');
    assert(newSection >= 0, 'Missing bundled tRPC notice');
    assert(
        sha256(notices.slice(0, newSection).trimEnd() + '\n') ===
            '89b7984b40a97bc23a161359c4e03b1bff003ab94f4931af68adc0cdd4d365b0',
        'Existing remove-markdown notice changed'
    );
    const noticeHashes = new Set(
        [...notices.matchAll(/```text\n([\s\S]*?)\n```/g)].map(([, text]) =>
            sha256(text + '\n')
        )
    );
    assert(
        requiredNoticeHashes.every((hash) => noticeHashes.has(hash)),
        'Missing or modified full dependency license notice'
    );
    assert(
        notices.includes('## React, React DOM, and Scheduler'),
        'Shared React/Scheduler notice coverage is missing'
    );
}
