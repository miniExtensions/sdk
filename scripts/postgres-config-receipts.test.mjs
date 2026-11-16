import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    assertPostgresConfigReceiptProvenance,
    postgresFieldConfigProvenance,
    postgresFieldConfigSource,
    readPostgresConfigReceipt,
    verifyPostgresConfigReceipt,
} from './postgres-config-receipts.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const historicalInputs = [
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
const family = (kind) => ({
    kind,
    schemaName:
        kind === 'text'
            ? 'postgresTextColumnConfigSchema'
            : 'postgresBooleanColumnConfigSchema',
    typeName:
        kind === 'text'
            ? 'PostgresTextColumnConfig'
            : 'PostgresBooleanColumnConfig',
    storageProjectionSha256: hash(`synthetic ${kind} projection`),
    storageReadiness: 'complete',
    editorPending: [
        {
            code: 'editor-rule-pending',
            settingId: 'readOnly',
            rule: 'visibility',
        },
    ],
});

function fixture(version) {
    const paths =
        version === 1
            ? historicalInputs
            : [
                  ...historicalInputs,
                  'types/extensions/postgres/booleanColumnFieldDefinitions.ts',
                  'types/postgres/columnTypes.ts',
              ].sort();
    const inputs = new Map(
        paths.map((name) => [name, Buffer.from(`synthetic input: ${name}\n`)])
    );
    const sources = paths.map((name) => ({
        path: name,
        sha256: hash(inputs.get(name)),
    }));
    const generatedBytes = Buffer.from(
        'synthetic generated scalar storage bytes\n'
    );
    const text = family('text');
    const receipt = {
        formatVersion: version,
        contract:
            version === 1
                ? 'postgres-text-column-config'
                : 'postgres-column-configs',
        scope: 'scalar-storage-only',
        sourceRepository: 'miniExtensions/monorepo',
        sourceMode: 'working-tree-content',
        sources,
        sourceSnapshotSha256: hash(JSON.stringify(sources)),
        ...(version === 1
            ? {
                  storageProjectionSha256: text.storageProjectionSha256,
                  storageReadiness: text.storageReadiness,
                  editorPending: text.editorPending,
              }
            : { families: [text, family('boolean')] }),
        runtimeAdmission: 'pending',
        toolchain: { prettier: '3.6.2' },
        generated: {
            path: postgresFieldConfigSource,
            sha256: hash(generatedBytes),
        },
    };
    const readPaths = [];
    const verify = () =>
        verifyPostgresConfigReceipt({
            receiptBytes: Buffer.from(JSON.stringify(receipt)),
            generatedBytes,
            readSource: (name) => {
                readPaths.push(name);
                assert(
                    inputs.has(name),
                    'The verifier requested an unlisted source.'
                );
                return inputs.get(name);
            },
        });
    return { paths, inputs, generatedBytes, receipt, readPaths, verify };
}

test('historical v1 configuration receipts verify the complete text-only closure', () => {
    const value = fixture(1);
    const verified = value.verify();
    assert.deepEqual(verified.aliases, ['PostgresTextColumnConfig']);
    assert.equal(verified.receiptVersion, 1);
    assert.equal(verified.schemaSourceSha256, hash(value.generatedBytes));
    assert.deepEqual(value.readPaths, value.paths);
});

test('v2 configuration receipts require text and Boolean, with deterministic alias order', () => {
    const value = fixture(2);
    value.receipt.families.reverse();
    const verified = value.verify();
    assert.deepEqual(verified.aliases, [
        'PostgresTextColumnConfig',
        'PostgresBooleanColumnConfig',
    ]);
    assert.equal(verified.receiptVersion, 2);
    assert.deepEqual(value.readPaths, value.paths);
});

test('configuration receipts refuse unreviewed versions, family identities and admission', async (t) => {
    for (const [name, mutate, reason] of [
        ['version', (r) => (r.formatVersion = 3), 'format-version'],
        [
            'contract',
            (r) => (r.contract = 'postgres-text-column-config'),
            'receipt-scope',
        ],
        [
            'runtime admission',
            (r) => (r.runtimeAdmission = 'ready'),
            'receipt-scope',
        ],
        ['missing family', (r) => r.families.pop(), 'families'],
        [
            'duplicate family',
            (r) => (r.families[1] = structuredClone(r.families[0])),
            'family-identity',
        ],
        [
            'unknown family',
            (r) => (r.families[1].kind = 'number'),
            'family-identity',
        ],
        [
            'schema mismatch',
            (r) => (r.families[1].schemaName = r.families[0].schemaName),
            'family-identity',
        ],
        [
            'type mismatch',
            (r) => (r.families[1].typeName = r.families[0].typeName),
            'family-identity',
        ],
        [
            'expanded family',
            (r) => (r.families[1].allowWrites = true),
            'family-fields',
        ],
        [
            'incomplete storage',
            (r) => (r.families[1].storageReadiness = 'incomplete'),
            'storage-readiness',
        ],
        [
            'invalid projection digest',
            (r) => (r.families[1].storageProjectionSha256 = 'invalid'),
            'storage-readiness',
        ],
        [
            'unknown editor rule',
            (r) => (r.families[1].editorPending[0].rule = 'execute'),
            'editor-pending',
        ],
    ]) {
        await t.test(name, () => {
            const value = fixture(2);
            mutate(value.receipt);
            assert.throws(value.verify, new RegExp(reason));
            assert.deepEqual(value.readPaths, []);
        });
    }
});

test('configuration receipts refuse missing, reordered or unsafe source membership even when rehashed', async (t) => {
    for (const [name, mutate] of [
        ['self-consistent subset', (r) => r.sources.pop()],
        [
            'duplicate source',
            (r) => (r.sources[1] = structuredClone(r.sources[0])),
        ],
        ['source order', (r) => r.sources.reverse()],
        ['parent traversal', (r) => (r.sources[0].path = '../outside')],
        ['absolute path', (r) => (r.sources[0].path = '/outside')],
        ['Windows separator', (r) => (r.sources[0].path = 'types\\outside')],
        [
            'receipt self-reference',
            (r) => (r.sources[0].path = postgresFieldConfigProvenance),
        ],
    ]) {
        await t.test(name, () => {
            const value = fixture(2);
            mutate(value.receipt);
            value.receipt.sourceSnapshotSha256 = hash(
                JSON.stringify(value.receipt.sources)
            );
            assert.throws(value.verify, /sources|source-membership/);
            assert.deepEqual(value.readPaths, []);
        });
    }
});

test('configuration receipts bind source snapshots, individual inputs and generated bytes', async (t) => {
    for (const [name, mutate, reason] of [
        [
            'snapshot',
            (v) => (v.receipt.sourceSnapshotSha256 = hash('changed snapshot')),
            'source-snapshot',
        ],
        [
            'source bytes',
            (v) => v.inputs.set(v.paths[0], Buffer.from('changed input')),
            'source-integrity',
        ],
        [
            'generated bytes',
            (v) => v.generatedBytes.fill(120),
            'generated-integrity',
        ],
        [
            'generated path',
            (v) => (v.receipt.generated.path = 'other.ts'),
            'generated-integrity',
        ],
    ]) {
        await t.test(name, () => {
            const value = fixture(2);
            mutate(value);
            assert.throws(value.verify, new RegExp(reason));
        });
    }
});

test('build provenance binds the validator and both canonical configuration inputs without source access', async (t) => {
    for (const version of [1, 2]) {
        await t.test(`version ${version}`, () => {
            const verified = fixture(version).verify();
            const validatorSha256 = hash('synthetic validator bytes');
            const internal = {
                aliases: [...verified.aliases],
                sources: [
                    {
                        path: postgresFieldConfigSource,
                        sha256: verified.schemaSourceSha256,
                    },
                    {
                        path: postgresFieldConfigProvenance,
                        sha256: verified.receiptSourceSha256,
                    },
                ],
                configurationValidation: { ...verified, validatorSha256 },
            };
            assertPostgresConfigReceiptProvenance(internal, validatorSha256);
            assert.throws(
                () =>
                    assertPostgresConfigReceiptProvenance(
                        internal,
                        hash('changed validator')
                    ),
                /validator-provenance/
            );
            const missingAlias = structuredClone(internal);
            missingAlias.aliases.pop();
            assert.throws(
                () =>
                    assertPostgresConfigReceiptProvenance(
                        missingAlias,
                        validatorSha256
                    ),
                /alias-provenance/
            );
            const driftedInput = structuredClone(internal);
            driftedInput.sources[0].sha256 = hash('changed schema');
            assert.throws(
                () =>
                    assertPostgresConfigReceiptProvenance(
                        driftedInput,
                        validatorSha256
                    ),
                /input-provenance/
            );
        });
    }
});

test('canonical configuration inputs must match the selected Git revision before verification', async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'sdk-config-receipt-git-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const value = fixture(2);
    const write = (relative, bytes) => {
        const file = path.join(root, relative);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, bytes);
    };
    for (const [name, bytes] of value.inputs) write(name, bytes);
    write(postgresFieldConfigSource, value.generatedBytes);
    write(postgresFieldConfigProvenance, JSON.stringify(value.receipt));
    const git = (...args) =>
        execFileSync('git', args, {
            cwd: root,
            encoding: 'utf8',
            timeout: 10_000,
        });
    git('init', '--quiet');
    git('add', '.');
    git(
        '-c',
        'user.name=SDK synthetic fixture',
        '-c',
        'user.email=sdk-fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'synthetic receipt inputs'
    );
    const revision = git('rev-parse', 'HEAD').trim();
    assert.deepEqual(
        readPostgresConfigReceipt({ monorepo: root, revision }),
        value.verify()
    );
    write(postgresFieldConfigProvenance, '{}');
    assert.throws(
        () => readPostgresConfigReceipt({ monorepo: root, revision }),
        /canonical-source-drift/
    );
    write(postgresFieldConfigProvenance, JSON.stringify(value.receipt));
    write(value.paths[0], 'changed uncommitted input');
    assert.throws(
        () => readPostgresConfigReceipt({ monorepo: root, revision }),
        /canonical-source-drift/
    );
});
