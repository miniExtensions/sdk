import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';

export const postgresFormAccessSource =
    'types/generated/postgres/form-access.ts';
export const postgresFormAccessProvenance =
    'types/generated/postgres/form-access.provenance.json';
const alias = 'PostgresFormRecordAccess';
// This contract has its own receipt. Historical scalar family closures stay frozen.
const sourcePaths = [
    '.prettierrc',
    'package.json',
    'pnpm-lock.yaml',
    'types/constants/extensionType.ts',
    'types/extensions/formRecordAccessFields.ts',
    'types/extensions/GetExtensionSectionsArgs.ts',
    'types/extensions/postgres/definitionContext.ts',
    'types/extensions/postgres/formAccessDefinition.ts',
    'types/extensions/postgres/projectSettings.ts',
    'types/extensions/postgres/settingBindings.ts',
    'types/extensions/settings/field.ts',
    'types/extensions/sourceRequirements.ts',
    'types/postgres/identifierBinding.ts',
    'types/postgres/recordSettings.ts',
    'types/postgres/types.ts',
    'types/scripts/postgres-configs/generate.ts',
    'types/scripts/postgres-form-access/emit.ts',
    'types/scripts/postgres-form-access/generate.ts',
].sort();
const definition = {
    contract: 'postgres-form-record-access',
    scope: 'private-workspace-member',
    absentAccess: 'create-and-read-without-editing',
    creationSettingId: 'disableCreatingRecords',
    editingSettingId: 'disableAccessingExistingRecords',
    editing: {
        enabledValue: false,
        disabledValue: true,
        identifierProperty: 'identifier',
        disabledIdentifier: 'retain-without-authority',
    },
    readRequirements: [
        { capability: 'record-read' },
        { capability: 'record-permissions' },
    ],
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) =>
    typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const record = (value) =>
    value != null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) =>
    record(value) &&
    isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const requireReceipt = (condition, reason) => {
    if (!condition)
        throw new Error(
            'Invalid canonical PostgreSQL Form access receipt: ' + reason
        );
};
const validateSources = (sources, snapshot) => {
    requireReceipt(
        Array.isArray(sources) &&
            sources.length === sourcePaths.length &&
            sources.every(
                (source, index) =>
                    exactKeys(source, ['path', 'sha256']) &&
                    source.path === sourcePaths[index] &&
                    digest(source.sha256)
            ) &&
            digest(snapshot) &&
            snapshot === hash(JSON.stringify(sources)),
        'source-closure'
    );
};

/** Provenance metadata only: no copied schema, setting parser or runtime resolver. */
export function verifyPostgresFormAccessReceipt({
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
        exactKeys(receipt, [
            'formatVersion',
            'contract',
            'scope',
            'sourceRepository',
            'sourceMode',
            'sources',
            'sourceSnapshotSha256',
            'definition',
            'storageProjectionSha256',
            'toolchain',
            'generated',
        ]),
        'receipt-fields'
    );
    requireReceipt(
        receipt.formatVersion === 1 &&
            receipt.contract === definition.contract &&
            receipt.scope === definition.scope &&
            receipt.sourceRepository === 'miniExtensions/monorepo' &&
            receipt.sourceMode === 'working-tree-content',
        'receipt-scope'
    );
    requireReceipt(
        isDeepStrictEqual(receipt.definition, definition) &&
            digest(receipt.storageProjectionSha256),
        'definition'
    );
    requireReceipt(
        exactKeys(receipt.toolchain, ['prettier']) &&
            typeof receipt.toolchain.prettier === 'string' &&
            /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(
                receipt.toolchain.prettier
            ),
        'toolchain'
    );
    validateSources(receipt.sources, receipt.sourceSnapshotSha256);
    for (const source of receipt.sources) {
        const bytes = readSource(source.path);
        requireReceipt(
            Buffer.isBuffer(bytes) && hash(bytes) === source.sha256,
            'source-bytes'
        );
    }
    requireReceipt(
        exactKeys(receipt.generated, ['path', 'sha256']) &&
            receipt.generated.path === postgresFormAccessSource &&
            digest(receipt.generated.sha256) &&
            receipt.generated.sha256 === hash(generatedBytes),
        'generated-output'
    );
    return {
        receiptVersion: 1,
        aliases: [alias],
        receiptSourceSha256: hash(receiptBytes),
        schemaSourceSha256: hash(generatedBytes),
        sources: receipt.sources,
        sourceSnapshotSha256: receipt.sourceSnapshotSha256,
        storageProjectionSha256: receipt.storageProjectionSha256,
    };
}

/** Coherent absence is supported for old canonical revisions; a half receipt is never absence. */
export function readPostgresFormAccessReceipt({ monorepo, revision }) {
    requireReceipt(
        typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision),
        'source-revision'
    );
    const fixed = [postgresFormAccessSource, postgresFormAccessProvenance];
    const present = execFileSync(
        'git',
        ['ls-tree', '-z', '--name-only', revision, '--', ...fixed],
        { cwd: monorepo }
    )
        .toString('utf8')
        .split('\0')
        .filter(Boolean);
    if (present.length === 0) return null;
    requireReceipt(
        present.length === fixed.length &&
            fixed.every((filename) => present.includes(filename)),
        'incomplete-artifacts'
    );
    const allowed = new Set([...sourcePaths, ...fixed]);
    const readPinned = (relative) => {
        requireReceipt(allowed.has(relative), 'source-path');
        const committed = execFileSync(
            'git',
            ['show', `${revision}:${relative}`],
            { cwd: monorepo, maxBuffer: 16 * 1024 * 1024 }
        );
        const absolute = path.join(monorepo, relative);
        requireReceipt(lstatSync(absolute).isFile(), 'source-file');
        const current = readFileSync(absolute);
        requireReceipt(current.equals(committed), 'canonical-source-drift');
        return current;
    };
    return verifyPostgresFormAccessReceipt({
        receiptBytes: readPinned(postgresFormAccessProvenance),
        generatedBytes: readPinned(postgresFormAccessSource),
        readSource: readPinned,
    });
}

/** Build/archive verification uses the private proof, never a canonical checkout. */
export function assertPostgresFormAccessReceiptProvenance(
    internal,
    validatorSha256,
    declarations
) {
    requireReceipt(
        Array.isArray(internal.aliases) && Array.isArray(internal.sources),
        'native-provenance'
    );
    const count = internal.aliases.filter((name) => name === alias).length;
    const proof = internal.formAccessValidation;
    const assertDeclaration = (expected) => {
        requireReceipt(Buffer.isBuffer(declarations), 'declaration-bytes');
        const parsed = ts.createSourceFile(
            'native.d.ts',
            declarations.toString('utf8'),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
        );
        const declared = parsed.statements.filter(
            (statement) =>
                ts.isTypeAliasDeclaration(statement) &&
                statement.name.text === 'Canonical' + alias &&
                statement.modifiers?.some(
                    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
                )
        );
        requireReceipt(
            parsed.parseDiagnostics.length === 0 &&
                declared.length === expected,
            'declaration-inventory'
        );
    };
    if (count === 0) {
        requireReceipt(
            proof == null &&
                !internal.sources.some(
                    (source) =>
                        source.path === postgresFormAccessSource ||
                        source.path === postgresFormAccessProvenance
                ),
            'unexpected-proof'
        );
        assertDeclaration(0);
        return;
    }
    requireReceipt(
        count === 1 &&
            exactKeys(proof, [
                'receiptVersion',
                'aliases',
                'receiptSourceSha256',
                'schemaSourceSha256',
                'sources',
                'sourceSnapshotSha256',
                'storageProjectionSha256',
                'validatorSha256',
            ]) &&
            proof.receiptVersion === 1 &&
            isDeepStrictEqual(proof.aliases, [alias]) &&
            digest(proof.validatorSha256) &&
            proof.validatorSha256 === validatorSha256 &&
            digest(proof.storageProjectionSha256),
        'validator-provenance'
    );
    validateSources(proof.sources, proof.sourceSnapshotSha256);
    for (const [filename, sha256] of [
        [postgresFormAccessSource, proof.schemaSourceSha256],
        [postgresFormAccessProvenance, proof.receiptSourceSha256],
    ])
        requireReceipt(
            digest(sha256) &&
                internal.sources.filter(
                    (source) =>
                        source.path === filename && source.sha256 === sha256
                ).length === 1 &&
                internal.sources.filter((source) => source.path === filename)
                    .length === 1,
            'input-provenance'
        );
    for (const source of proof.sources) {
        const overlapping = internal.sources.filter(
            (candidate) => candidate.path === source.path
        );
        requireReceipt(
            overlapping.length === 0 ||
                (overlapping.length === 1 &&
                    overlapping[0].sha256 === source.sha256),
            'overlapping-source'
        );
    }
    assertDeclaration(1);
}
