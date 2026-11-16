import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
        [1, 2, 3, 4].includes(version),
        'Unknown PostgreSQL runtime receipt version'
    );
    return version === 4 ? [attachment, presentation] : [attachment];
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
