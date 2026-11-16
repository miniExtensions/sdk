import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const postgresFieldConfigSource =
    'types/generated/postgres/field-config.ts';
export const postgresFieldConfigProvenance =
    'types/generated/postgres/field-config.provenance.json';
export const postgresTextPresentationAuthorSource =
    'types/extensions/postgres/textColumnPresentation.ts';
export const postgresTextPresentationSource =
    'types/generated/postgres/text-presentation.ts';

const textFamily = {
    kind: 'text',
    schemaName: 'postgresTextColumnConfigSchema',
    typeName: 'PostgresTextColumnConfig',
};
const booleanFamily = {
    kind: 'boolean',
    schemaName: 'postgresBooleanColumnConfigSchema',
    typeName: 'PostgresBooleanColumnConfig',
};
const numericFamily = {
    kind: 'numeric',
    schemaName: 'postgresNumericColumnConfigSchema',
    typeName: 'PostgresNumericColumnConfig',
};
const dateFamily = {
    kind: 'date',
    schemaName: 'postgresDateColumnConfigSchema',
    typeName: 'PostgresDateColumnConfig',
};
const scalarFamilies = [textFamily, booleanFamily, numericFamily, dateFamily];
const enumFamily = {
    kind: 'enum',
    schemaName: 'postgresEnumColumnConfigSchema',
    typeName: 'PostgresEnumColumnConfig',
};
const allFamilies = [...scalarFamilies, enumFamily];
const historicalSources = [
    '.prettierrc',
    'package.json',
    'pnpm-lock.yaml',
    'types/extensions/miniExt-field-configs/constants.ts',
    'types/extensions/miniExt-field-configs/fields.ts',
    'types/extensions/miniExt-field-configs/formFieldsWithConfigs/constants.ts',
    'types/extensions/miniExt-field-configs/standardOptions.tsx',
    'types/extensions/postgres/projectSettings.ts',
    'types/extensions/postgres/textColumnFieldDefinitions.ts',
    'types/extensions/settings/field.ts',
    'types/extensions/sourceRequirements.ts',
    'types/postgres/attachmentDisplay.ts',
    'types/scripts/postgres-configs/emit.ts',
    'types/scripts/postgres-configs/generate.ts',
].sort();
const booleanSources = [
    ...historicalSources,
    'types/extensions/postgres/booleanColumnFieldDefinitions.ts',
    'types/postgres/columnTypes.ts',
].sort();
const numericDateSources = [
    ...booleanSources,
    'types/extensions/postgres/commonColumnFieldDefinitions.ts',
    'types/extensions/postgres/dateColumnFieldDefinitions.ts',
    'types/extensions/postgres/numericColumnFieldDefinitions.ts',
].sort();
const presentationSources = [
    ...numericDateSources,
    postgresTextPresentationAuthorSource,
].sort();
const enumSources = [
    ...presentationSources,
    'types/extensions/postgres/enumColumnFieldDefinitions.ts',
    'types/postgres/enumValue.ts',
].sort();
const receiptVersions = new Map([
    [1, { families: [textFamily], sources: historicalSources }],
    [2, { families: [textFamily, booleanFamily], sources: booleanSources }],
    [3, { families: scalarFamilies, sources: numericDateSources }],
    [4, { families: scalarFamilies, sources: presentationSources }],
    [5, { families: allFamilies, sources: enumSources }],
]);
const sharedReceiptKeys = [
    'formatVersion',
    'contract',
    'scope',
    'sourceRepository',
    'sourceMode',
    'sources',
    'sourceSnapshotSha256',
    'runtimeAdmission',
    'toolchain',
    'generated',
];
const editorRules = new Set([
    'visibility',
    'disabled',
    'validation',
    'dynamic-title',
    'dynamic-subtitle',
    'choice-filter',
    'choice-disabled',
    'renderer',
    'asset-validation',
    'suggestion',
]);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) =>
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = (value) =>
    value != null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) =>
    record(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
        JSON.stringify([...keys].sort());
const requireReceipt = (condition, reason) => {
    if (!condition)
        throw new Error(
            `Invalid canonical PostgreSQL configuration receipt: ${reason}`
        );
};
const safeSourcePath = (value) =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1024 &&
    !path.posix.isAbsolute(value) &&
    !value.includes('\\') &&
    !/[\u0000-\u001f:]/.test(value) &&
    value
        .split('/')
        .every((part) => part !== '' && part !== '.' && part !== '..');

const validateStorageReadiness = (value) => {
    requireReceipt(
        value.storageReadiness === 'complete' &&
            digest(value.storageProjectionSha256),
        'storage-readiness'
    );
    requireReceipt(
        Array.isArray(value.editorPending) &&
            value.editorPending.every(
                (issue) =>
                    exactKeys(issue, ['code', 'settingId', 'rule']) &&
                    issue.code === 'editor-rule-pending' &&
                    typeof issue.settingId === 'string' &&
                    issue.settingId.length > 0 &&
                    editorRules.has(issue.rule)
            ),
        'editor-pending'
    );
};

/** Metadata verification only. It neither defines nor parses column settings. */
export function verifyPostgresConfigReceipt({
    receiptBytes,
    generatedBytes,
    readSource,
}) {
    requireReceipt(
        Buffer.isBuffer(receiptBytes) &&
            Buffer.isBuffer(generatedBytes) &&
            typeof readSource === 'function',
        'input-bytes'
    );
    let receipt;
    try {
        receipt = JSON.parse(receiptBytes.toString('utf8'));
    } catch {
        requireReceipt(false, 'json');
    }
    requireReceipt(
        record(receipt) && receiptVersions.has(receipt.formatVersion),
        'format-version'
    );
    const version = receiptVersions.get(receipt.formatVersion);
    const historical = receipt.formatVersion === 1;
    const hasPresentation =
        receipt.formatVersion === 4 || receipt.formatVersion === 5;
    requireReceipt(
        exactKeys(receipt, [
            ...sharedReceiptKeys,
            ...(historical
                ? [
                      'storageProjectionSha256',
                      'storageReadiness',
                      'editorPending',
                  ]
                : ['families']),
            ...(hasPresentation ? ['presentation'] : []),
        ]),
        'receipt-fields'
    );
    requireReceipt(
        receipt.contract ===
            (historical
                ? 'postgres-text-column-config'
                : 'postgres-column-configs') &&
            receipt.scope ===
                (hasPresentation
                    ? 'scalar-storage-and-presentation'
                    : 'scalar-storage-only') &&
            receipt.sourceRepository === 'miniExtensions/monorepo' &&
            receipt.sourceMode === 'working-tree-content' &&
            receipt.runtimeAdmission === 'pending',
        'receipt-scope'
    );
    requireReceipt(
        exactKeys(receipt.toolchain, ['prettier']) &&
            typeof receipt.toolchain.prettier === 'string' &&
            /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(
                receipt.toolchain.prettier
            ),
        'toolchain'
    );
    let families;
    if (historical) {
        validateStorageReadiness(receipt);
        families = version.families;
    } else {
        requireReceipt(
            Array.isArray(receipt.families) &&
                receipt.families.length === version.families.length,
            'families'
        );
        const seen = new Set();
        for (const family of receipt.families) {
            requireReceipt(
                exactKeys(family, [
                    'kind',
                    'schemaName',
                    'typeName',
                    'storageProjectionSha256',
                    'storageReadiness',
                    'editorPending',
                ]),
                'family-fields'
            );
            const allowed = version.families.find(
                (candidate) => candidate.kind === family.kind
            );
            requireReceipt(
                allowed != null &&
                    family.schemaName === allowed.schemaName &&
                    family.typeName === allowed.typeName &&
                    !seen.has(family.kind),
                'family-identity'
            );
            seen.add(family.kind);
            validateStorageReadiness(family);
        }
        requireReceipt(
            version.families.every((family) => seen.has(family.kind)),
            'families'
        );
        // Metadata order never controls generated import names or alias order.
        families = version.families;
    }
    requireReceipt(
        Array.isArray(receipt.sources) &&
            receipt.sources.every(
                (source) =>
                    exactKeys(source, ['path', 'sha256']) &&
                    safeSourcePath(source.path) &&
                    digest(source.sha256)
            ),
        'sources'
    );
    const expectedSources = version.sources;
    requireReceipt(
        JSON.stringify(receipt.sources.map((source) => source.path)) ===
            JSON.stringify(expectedSources),
        'source-membership'
    );
    requireReceipt(
        digest(receipt.sourceSnapshotSha256) &&
            sha256(JSON.stringify(receipt.sources)) ===
                receipt.sourceSnapshotSha256,
        'source-snapshot'
    );
    requireReceipt(
        exactKeys(receipt.generated, ['path', 'sha256']) &&
            receipt.generated.path === postgresFieldConfigSource &&
            digest(receipt.generated.sha256) &&
            sha256(generatedBytes) === receipt.generated.sha256,
        'generated-integrity'
    );
    for (const source of receipt.sources) {
        const bytes = readSource(source.path);
        requireReceipt(
            Buffer.isBuffer(bytes) && sha256(bytes) === source.sha256,
            'source-integrity'
        );
    }
    if (hasPresentation) {
        const presentation = receipt.presentation;
        requireReceipt(
            exactKeys(presentation, [
                'kind',
                'sourcePath',
                'sourceSha256',
                'generated',
            ]) &&
                presentation.kind === 'text-column-presentation' &&
                presentation.sourcePath ===
                    postgresTextPresentationAuthorSource &&
                digest(presentation.sourceSha256) &&
                receipt.sources.some(
                    (source) =>
                        source.path === presentation.sourcePath &&
                        source.sha256 === presentation.sourceSha256
                ) &&
                exactKeys(presentation.generated, ['path', 'sha256']) &&
                presentation.generated.path ===
                    postgresTextPresentationSource &&
                digest(presentation.generated.sha256),
            'presentation-identity'
        );
        const bytes = readSource(postgresTextPresentationSource);
        requireReceipt(
            Buffer.isBuffer(bytes) &&
                sha256(bytes) === presentation.generated.sha256,
            'presentation-integrity'
        );
    }
    return {
        receiptVersion: receipt.formatVersion,
        aliases: families.map((family) => family.typeName),
        receiptSourceSha256: sha256(receiptBytes),
        schemaSourceSha256: sha256(generatedBytes),
        sourceSnapshotSha256: receipt.sourceSnapshotSha256,
        ...(hasPresentation ? { presentation: receipt.presentation } : {}),
    };
}

/** Only explicit native maintainer generation reads the canonical checkout. */
export function readPostgresConfigReceipt({ monorepo, revision }) {
    requireReceipt(/^[a-f0-9]{40}$/.test(revision), 'source-revision');
    const readPinned = (relative) => {
        requireReceipt(safeSourcePath(relative), 'source-path');
        const committed = execFileSync(
            'git',
            ['show', `${revision}:${relative}`],
            {
                cwd: monorepo,
                maxBuffer: 16 * 1024 * 1024,
            }
        );
        const absolute = path.join(monorepo, relative);
        requireReceipt(lstatSync(absolute).isFile(), 'source-file');
        const current = readFileSync(absolute);
        requireReceipt(current.equals(committed), 'canonical-source-drift');
        return current;
    };
    // Pin both fixed inputs before parsing receipt-controlled metadata.
    return verifyPostgresConfigReceipt({
        receiptBytes: readPinned(postgresFieldConfigProvenance),
        generatedBytes: readPinned(postgresFieldConfigSource),
        readSource: readPinned,
    });
}

/** Build checks local validator/input bindings without loading private sources. */
export function assertPostgresConfigReceiptProvenance(
    internal,
    validatorSha256
) {
    const proof = internal.configurationValidation;
    const hasPresentation =
        proof?.receiptVersion === 4 || proof?.receiptVersion === 5;
    requireReceipt(
        exactKeys(proof, [
            'receiptVersion',
            'aliases',
            'receiptSourceSha256',
            'schemaSourceSha256',
            'sourceSnapshotSha256',
            'validatorSha256',
            ...(hasPresentation ? ['presentation'] : []),
        ]) &&
            receiptVersions.has(proof.receiptVersion) &&
            digest(proof.sourceSnapshotSha256) &&
            digest(proof.validatorSha256) &&
            proof.validatorSha256 === validatorSha256 &&
            Array.isArray(internal.aliases) &&
            Array.isArray(internal.sources),
        'validator-provenance'
    );
    const aliases = receiptVersions
        .get(proof.receiptVersion)
        .families.map((family) => family.typeName);
    const knownAliases = allFamilies.map((family) => family.typeName);
    requireReceipt(
        JSON.stringify(proof.aliases) === JSON.stringify(aliases) &&
            JSON.stringify(
                internal.aliases.filter((name) => knownAliases.includes(name))
            ) === JSON.stringify(aliases),
        'alias-provenance'
    );
    for (const [relative, hash] of [
        [postgresFieldConfigProvenance, proof.receiptSourceSha256],
        [postgresFieldConfigSource, proof.schemaSourceSha256],
    ])
        requireReceipt(
            digest(hash) &&
                internal.sources.some(
                    (source) =>
                        source.path === relative && source.sha256 === hash
                ),
            'input-provenance'
        );
    if (hasPresentation) {
        const presentation = proof.presentation;
        requireReceipt(
            exactKeys(presentation, [
                'kind',
                'sourcePath',
                'sourceSha256',
                'generated',
            ]) &&
                presentation.kind === 'text-column-presentation' &&
                presentation.sourcePath ===
                    postgresTextPresentationAuthorSource &&
                digest(presentation.sourceSha256) &&
                exactKeys(presentation.generated, ['path', 'sha256']) &&
                presentation.generated.path ===
                    postgresTextPresentationSource &&
                digest(presentation.generated.sha256) &&
                [
                    [presentation.sourcePath, presentation.sourceSha256],
                    [
                        presentation.generated.path,
                        presentation.generated.sha256,
                    ],
                ].every(([path, sha256]) =>
                    internal.sources.some(
                        (source) =>
                            source.path === path && source.sha256 === sha256
                    )
                ) &&
                Array.isArray(internal.runtimeArtifacts) &&
                internal.runtimeArtifacts.some(
                    (artifact) =>
                        artifact.module ===
                            'postgresTextPresentation.generated' &&
                        artifact.sourcePath === presentation.generated.path &&
                        artifact.sourceSha256 === presentation.generated.sha256
                ),
            'presentation-provenance'
        );
    }
}
