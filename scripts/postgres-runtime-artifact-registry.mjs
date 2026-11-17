import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
    postgresAttachmentRuntimeModule,
    postgresAttachmentRuntimeSource,
    postgresRuntimeOutputHashes,
    rewritePostgresAttachmentRuntime,
} from './postgres-runtime-artifacts.mjs';
import {
    postgresPresentationRuntimeModule,
    postgresPresentationRuntimeSource,
    postgresPresentationRuntimeExports,
    postgresPresentationRuntimeOutputHashes,
    rewritePostgresPresentationRuntime,
} from './postgres-presentation-runtime-artifacts.mjs';

const attachment = {
    module: postgresAttachmentRuntimeModule,
    sourcePath: postgresAttachmentRuntimeSource,
    emitter: new URL('./postgres-runtime-artifacts.mjs', import.meta.url),
    exports: [
        'parsePostgresAttachmentDisplay',
        'PostgresAttachmentDisplayError',
        'POSTGRES_ATTACHMENT_DISPLAY_SYNTAX',
    ],
    rewrite: rewritePostgresAttachmentRuntime,
    outputHashes: postgresRuntimeOutputHashes,
};
const presentation = {
    module: postgresPresentationRuntimeModule,
    sourcePath: postgresPresentationRuntimeSource,
    emitter: new URL(
        './postgres-presentation-runtime-artifacts.mjs',
        import.meta.url
    ),
    exports: postgresPresentationRuntimeExports,
    rewrite: rewritePostgresPresentationRuntime,
    outputHashes: postgresPresentationRuntimeOutputHashes,
};
export const postgresRuntimeArtifactModules = [
    attachment.module,
    presentation.module,
];

export function postgresRuntimeArtifactSpecifications(configurationValidation) {
    const version = configurationValidation?.receiptVersion;
    assert(
        [1, 2, 3, 4, 5, 6, 7].includes(version),
        'Unknown PostgreSQL runtime receipt version'
    );
    return [4, 5, 6, 7].includes(version)
        ? [attachment, presentation]
        : [attachment];
}

/** Receipt version determines the exact set, never an artifact's presence/count. */
export function assertPostgresRuntimeArtifactSet(
    artifacts,
    configurationValidation
) {
    const specifications = postgresRuntimeArtifactSpecifications(
        configurationValidation
    );
    assert(
        Array.isArray(artifacts) && artifacts.length === specifications.length,
        'Missing PostgreSQL display runtime provenance'
    );
    specifications.forEach((specification, index) => {
        assert(
            artifacts[index].module === specification.module,
            'Unexpected PostgreSQL runtime module'
        );
        assert(
            artifacts[index].sourcePath === specification.sourcePath,
            'Unexpected PostgreSQL runtime source'
        );
    });
    return specifications;
}

export function assertPostgresRuntimeEmitter(
    artifact,
    configurationValidation
) {
    const specification = postgresRuntimeArtifactSpecifications(
        configurationValidation
    ).find((candidate) => candidate.module === artifact.module);
    assert(
        specification && artifact.sourcePath === specification.sourcePath,
        'Unexpected PostgreSQL runtime source'
    );
    assert.equal(
        artifact.emitterSha256,
        createHash('sha256')
            .update(readFileSync(specification.emitter))
            .digest('hex'),
        'PostgreSQL runtime emitter provenance is stale'
    );
    return specification;
}

export function postgresRuntimeRegistrySha256() {
    return createHash('sha256')
        .update(readFileSync(new URL(import.meta.url)))
        .digest('hex');
}

export function assertPostgresRuntimeRegistryProvenance(internal) {
    assert.equal(
        internal.runtimeRegistrySha256,
        postgresRuntimeRegistrySha256(),
        'PostgreSQL runtime registry provenance is stale'
    );
}

/** All contract files belong to fixed type snapshots or receipt-selected runtimes. */
export function assertPostgresRuntimeContractInventory(
    paths,
    configurationValidation
) {
    const modules = [
        'generated',
        'postgres.generated',
        ...postgresRuntimeArtifactSpecifications(configurationValidation).map(
            (specification) => specification.module
        ),
    ];
    const required = modules.flatMap((module) => [
        module + '.js',
        module + '.d.ts',
    ]);
    const allowed = new Set([
        ...required,
        'generated.provenance.json',
        'postgres.generated.provenance.json',
    ]);
    assert(
        paths.every((path) => allowed.has(path)),
        'Unexpected packaged PostgreSQL contract file'
    );
    assert(
        required.every((path) => paths.includes(path)),
        'Missing packaged PostgreSQL contract file'
    );
}

/** Compare provenance with the actual exported type inventory, not another manifest. */
export function assertPostgresContractDeclarationInventory(
    provenance,
    declarations
) {
    const fail = 'Invalid PostgreSQL contract declaration inventory';
    assert(Buffer.isBuffer(declarations), `${fail}: declaration bytes`);
    assert(
        Array.isArray(provenance?.aliases) &&
            provenance.aliases.length > 0 &&
            provenance.aliases.every(
                (name) =>
                    typeof name === 'string' &&
                    /^Postgres[A-Z][A-Za-z0-9]*$/.test(name)
            ) &&
            new Set(provenance.aliases).size === provenance.aliases.length,
        `${fail}: alias metadata`
    );
    const parsed = ts.createSourceFile(
        'postgres.generated.d.ts',
        declarations.toString('utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
    );
    assert.equal(parsed.parseDiagnostics.length, 0, `${fail}: syntax`);
    const exported = parsed.statements.filter((statement) => {
        // TypeScript emits this empty module marker after private helper types.
        // It declares no name; named re-exports and module references remain invalid.
        if (
            ts.isExportDeclaration(statement) &&
            statement.moduleSpecifier == null &&
            statement.attributes == null &&
            statement.exportClause != null &&
            ts.isNamedExports(statement.exportClause) &&
            statement.exportClause.elements.length === 0
        )
            return false;
        assert(
            ts.isTypeAliasDeclaration(statement),
            `${fail}: only generated type aliases may be declared`
        );
        return statement.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
        );
    });
    const actual = exported.map((statement) => statement.name.text).sort();
    const expected = provenance.aliases
        .map((name) => `Canonical${name}`)
        .sort();
    assert.deepEqual(actual, expected, `${fail}: exported aliases`);
}
