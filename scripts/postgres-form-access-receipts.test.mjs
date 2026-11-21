import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    assertPostgresFormAccessReceiptProvenance as assertProof,
    postgresFormAccessProvenance,
    postgresFormAccessSource,
    readPostgresFormAccessReceipt,
    verifyPostgresFormAccessReceipt,
} from './postgres-form-access-receipts.mjs';

const assertPostgresFormAccessReceiptProvenance = (
    internal,
    validator,
    declarations = Buffer.from(
        'export type CanonicalPostgresFormRecordAccess = unknown;'
    )
) => assertProof(internal, validator, declarations);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const paths = [
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
const fixture = () => {
    const bytes = new Map(
        paths.map((filename) => [
            filename,
            Buffer.from('synthetic source ' + filename),
        ])
    );
    const generatedBytes = Buffer.from('synthetic generated type bytes');
    const sources = paths.map((filename) => ({
        path: filename,
        sha256: hash(bytes.get(filename)),
    }));
    const receipt = {
        formatVersion: 1,
        contract: 'postgres-form-record-access',
        scope: 'private-workspace-member',
        sourceRepository: 'miniExtensions/monorepo',
        sourceMode: 'working-tree-content',
        sources,
        sourceSnapshotSha256: hash(JSON.stringify(sources)),
        definition: {
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
        },
        storageProjectionSha256: hash('synthetic projection'),
        toolchain: { prettier: '3.6.2' },
        generated: {
            path: postgresFormAccessSource,
            sha256: hash(generatedBytes),
        },
    };
    const verify = () =>
        verifyPostgresFormAccessReceipt({
            receiptBytes: Buffer.from(JSON.stringify(receipt)),
            generatedBytes,
            readSource: (filename) => bytes.get(filename),
        });
    const proof = () => ({
        ...verify(),
        validatorSha256: hash('synthetic validator'),
    });
    const internal = () => ({
        aliases: ['PostgresConnection', 'PostgresFormRecordAccess'],
        formAccessValidation: proof(),
        sources: [
            { path: postgresFormAccessSource, sha256: hash(generatedBytes) },
            {
                path: postgresFormAccessProvenance,
                sha256: hash(Buffer.from(JSON.stringify(receipt))),
            },
        ],
    });
    return { bytes, receipt, generatedBytes, verify, internal };
};

test('validates the independent native Form access closure without admitting runtime schema exports', () => {
    const f = fixture(),
        proof = f.verify();
    assert.deepEqual(proof.aliases, ['PostgresFormRecordAccess']);
    assert.equal(proof.sources.length, 18);
    assert.equal(Object.hasOwn(proof, 'runtimeAdmission'), false);
    assertPostgresFormAccessReceiptProvenance(
        f.internal(),
        hash('synthetic validator')
    );
});

for (const [name, mutate] of [
    [
        'version',
        (r) => {
            r.formatVersion = 2;
        },
    ],
    [
        'scalar scope',
        (r) => {
            r.contract = 'postgres-column-configs';
            r.scope = 'scalar-storage-and-presentation';
        },
    ],
    [
        'public scope',
        (r) => {
            r.scope = 'public';
        },
    ],
    [
        'scalar runtime metadata',
        (r) => {
            r.runtimeAdmission = 'pending';
        },
    ],
    [
        'identifier policy',
        (r) => {
            r.definition.editing.disabledIdentifier = 'editable';
        },
    ],
    [
        'absence policy',
        (r) => {
            r.definition.absentAccess = 'editing-enabled';
        },
    ],
    [
        'projection digest',
        (r) => {
            r.storageProjectionSha256 = 'invalid';
        },
    ],
    [
        'extra source',
        (r) => {
            r.sources.push({ path: 'private/secret', sha256: hash('x') });
        },
    ],
    [
        'missing source',
        (r) => {
            r.sources.pop();
        },
    ],
    [
        'duplicate source',
        (r) => {
            r.sources[1] = r.sources[0];
        },
    ],
    [
        'source order',
        (r) => {
            r.sources.reverse();
            r.sourceSnapshotSha256 = hash(JSON.stringify(r.sources));
        },
    ],
    [
        'source traversal',
        (r) => {
            r.sources[0].path = '../secret';
            r.sourceSnapshotSha256 = hash(JSON.stringify(r.sources));
        },
    ],
    [
        'output name',
        (r) => {
            r.generated.path = 'types/generated/postgres/field-config.ts';
        },
    ],
    [
        'output hash',
        (r) => {
            r.generated.sha256 = hash('other bytes');
        },
    ],
    [
        'toolchain',
        (r) => {
            r.toolchain = { prettier: 'latest' };
        },
    ],
])
    test('rejects changed Form access receipt ' + name, () => {
        const f = fixture();
        mutate(f.receipt);
        assert.throws(f.verify);
    });

test('checks every source byte rather than trusting receipt hashes', () => {
    for (const filename of paths) {
        const f = fixture();
        f.bytes.set(filename, Buffer.from('drift'));
        assert.throws(f.verify);
    }
});

for (const [name, mutate] of [
    [
        'missing proof',
        (p) => {
            delete p.formAccessValidation;
        },
    ],
    [
        'wrong helper',
        (p) => {
            p.formAccessValidation.validatorSha256 = hash('changed');
        },
    ],
    [
        'wrong version',
        (p) => {
            p.formAccessValidation.receiptVersion = 5;
        },
    ],
    [
        'scalar proof',
        (p) => {
            p.formAccessValidation = {
                receiptVersion: 5,
                aliases: ['PostgresEnumColumnConfig'],
            };
        },
    ],
    [
        'missing enabled alias',
        (p) => {
            p.formAccessValidation.aliases = [];
        },
    ],
    [
        'duplicate alias',
        (p) => {
            p.aliases.push('PostgresFormRecordAccess');
        },
    ],
    [
        'unknown proof key',
        (p) => {
            p.formAccessValidation.runtimeAdmission = 'pending';
        },
    ],
    [
        'schema substitution',
        (p) => {
            p.sources[0].path = 'types/generated/postgres/field-config.ts';
        },
    ],
    [
        'schema hash',
        (p) => {
            p.sources[0].sha256 = hash('changed');
        },
    ],
    [
        'receipt hash',
        (p) => {
            p.sources[1].sha256 = hash('changed');
        },
    ],
    [
        'missing receipt',
        (p) => {
            p.sources.pop();
        },
    ],
    [
        'duplicate output',
        (p) => {
            p.sources.push(p.sources[0]);
        },
    ],
    [
        'nested snapshot',
        (p) => {
            p.formAccessValidation.sources[0].sha256 = hash('changed');
        },
    ],
])
    test('rejects build/archive Form access proof ' + name, () => {
        const p = fixture().internal();
        mutate(p);
        assert.throws(() =>
            assertPostgresFormAccessReceiptProvenance(
                p,
                hash('synthetic validator')
            )
        );
    });

test('removing the alias and proof cannot reinterpret new Form artifacts as historical absence', () => {
    const internal = fixture().internal();
    internal.aliases = ['PostgresConnection'];
    delete internal.formAccessValidation;
    assert.throws(() =>
        assertPostgresFormAccessReceiptProvenance(
            internal,
            hash('synthetic validator')
        )
    );
});

test('retains old alias sets only with absent independent proof', () => {
    assertPostgresFormAccessReceiptProvenance(
        { aliases: ['PostgresConnection'], sources: [] },
        hash('helper'),
        Buffer.from('export type CanonicalPostgresConnection = unknown;')
    );
    assert.throws(() =>
        assertPostgresFormAccessReceiptProvenance(
            { ...fixture().internal(), aliases: ['PostgresConnection'] },
            hash('synthetic validator')
        )
    );
});

test('distinguishes coherent historical absence, partial artifacts and committed-source drift', () => {
    const directory = mkdtempSync(
        path.join(tmpdir(), 'sdk-form-access-proof-')
    );
    const git = (...args) =>
        execFileSync('git', args, {
            cwd: directory,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
            .toString()
            .trim();
    const commit = (message) => {
        git('add', '.');
        git(
            '-c',
            'user.name=Synthetic proof',
            '-c',
            'user.email=proof@example.invalid',
            'commit',
            '--allow-empty',
            '-m',
            message
        );
        return git('rev-parse', 'HEAD');
    };
    const write = (filename, bytes) => {
        mkdirSync(path.dirname(path.join(directory, filename)), {
            recursive: true,
        });
        writeFileSync(path.join(directory, filename), bytes);
    };
    try {
        git('init');
        const absent = commit('Historical source');
        assert.equal(
            readPostgresFormAccessReceipt({
                monorepo: directory,
                revision: absent,
            }),
            null
        );
        const f = fixture();
        write(postgresFormAccessSource, f.generatedBytes);
        const partial = commit('Partial artifact');
        assert.throws(() =>
            readPostgresFormAccessReceipt({
                monorepo: directory,
                revision: partial,
            })
        );
        for (const [filename, bytes] of f.bytes) write(filename, bytes);
        write(postgresFormAccessProvenance, JSON.stringify(f.receipt));
        const complete = commit('Complete artifact');
        assert.deepEqual(
            readPostgresFormAccessReceipt({
                monorepo: directory,
                revision: complete,
            }),
            f.verify()
        );
        write('types/extensions/formRecordAccessFields.ts', 'source drift');
        assert.throws(() =>
            readPostgresFormAccessReceipt({
                monorepo: directory,
                revision: complete,
            })
        );
        assert.equal(
            readPostgresFormAccessReceipt({
                monorepo: directory,
                revision: absent,
            }),
            null
        );
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

test('removing all Form metadata cannot hide its actual exported declaration', () => {
    const internal = fixture().internal();
    internal.aliases = ['PostgresConnection'];
    internal.sources = [];
    delete internal.formAccessValidation;
    assert.throws(() =>
        assertPostgresFormAccessReceiptProvenance(
            internal,
            hash('synthetic validator')
        )
    );
});

test('nested source hashes must agree with every overlapping native source', () => {
    const internal = fixture().internal();
    const source = internal.formAccessValidation.sources.find(
        (source) => source.path === 'types/postgres/types.ts'
    );
    internal.sources.push({ ...source });
    source.sha256 = hash('contradictory model bytes');
    internal.formAccessValidation.sourceSnapshotSha256 = hash(
        JSON.stringify(internal.formAccessValidation.sources)
    );
    assert.throws(() =>
        assertPostgresFormAccessReceiptProvenance(
            internal,
            hash('synthetic validator')
        )
    );
});
