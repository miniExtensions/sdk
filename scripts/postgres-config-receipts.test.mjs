import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
    assertPostgresConfigReceiptProvenance as assertProof,
    assertPostgresConfigDeclarationInventory,
    postgresFieldConfigProvenance,
    postgresFieldConfigSource,
    postgresTextPresentationAuthorSource,
    postgresTextPresentationSource,
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
const identities = {
    text: ['postgresTextColumnConfigSchema', 'PostgresTextColumnConfig'],
    boolean: [
        'postgresBooleanColumnConfigSchema',
        'PostgresBooleanColumnConfig',
    ],
    numeric: [
        'postgresNumericColumnConfigSchema',
        'PostgresNumericColumnConfig',
    ],
    date: ['postgresDateColumnConfigSchema', 'PostgresDateColumnConfig'],
    enum: ['postgresEnumColumnConfigSchema', 'PostgresEnumColumnConfig'],
    uuid: ['postgresUuidColumnConfigSchema', 'PostgresUuidColumnConfig'],
    timestamp: [
        'postgresTimestampColumnConfigSchema',
        'PostgresTimestampColumnConfig',
    ],
    timestamptz: [
        'postgresTimestamptzColumnConfigSchema',
        'PostgresTimestamptzColumnConfig',
    ],
    time: ['postgresTimeColumnConfigSchema', 'PostgresTimeColumnConfig'],
    timetz: ['postgresTimetzColumnConfigSchema', 'PostgresTimetzColumnConfig'],
    interval: [
        'postgresIntervalColumnConfigSchema',
        'PostgresIntervalColumnConfig',
    ],
};
const configurationDeclarations = (aliases) =>
    Buffer.from(
        aliases
            .filter((name) =>
                Object.values(identities).some(([, type]) => type === name)
            )
            .map((name) => `export type Canonical${name} = unknown;`)
            .join('\n')
    );
const assertPostgresConfigReceiptProvenance = (
    internal,
    validator,
    declarations = configurationDeclarations(internal.aliases)
) => assertProof(internal, validator, declarations);
const family = (kind) => {
    assert(Object.hasOwn(identities, kind));
    const [schemaName, typeName] = identities[kind];
    return {
        kind,
        schemaName,
        typeName,
        storageProjectionSha256: hash(`synthetic ${kind} projection`),
        storageReadiness: 'complete',
        editorPending: [
            {
                code: 'editor-rule-pending',
                settingId: 'readOnly',
                rule: 'visibility',
            },
        ],
    };
};

function fixture(version) {
    assert([1, 2, 3, 4, 5, 6, 7, 8, 9].includes(version));
    const paths =
        version === 1
            ? historicalInputs
            : [
                  ...historicalInputs,
                  'types/extensions/postgres/booleanColumnFieldDefinitions.ts',
                  'types/postgres/columnTypes.ts',
                  ...(version >= 3
                      ? [
                            'types/extensions/postgres/commonColumnFieldDefinitions.ts',
                            'types/extensions/postgres/dateColumnFieldDefinitions.ts',
                            'types/extensions/postgres/numericColumnFieldDefinitions.ts',
                        ]
                      : []),
                  ...(version >= 4
                      ? [postgresTextPresentationAuthorSource]
                      : []),
                  ...(version >= 5
                      ? [
                            'types/extensions/postgres/enumColumnFieldDefinitions.ts',
                            'types/postgres/enumValue.ts',
                        ]
                      : []),
                  ...(version >= 6
                      ? [
                            'types/extensions/postgres/uuidColumnFieldDefinitions.ts',
                        ]
                      : []),
                  ...(version >= 7
                      ? [
                            'types/extensions/postgres/timestampColumnFieldDefinitions.ts',
                        ]
                      : []),
                  ...(version >= 8
                      ? [
                            'types/extensions/postgres/timeColumnFieldDefinitions.ts',
                        ]
                      : []),
                  ...(version >= 9
                      ? [
                            'types/extensions/postgres/intervalColumnFieldDefinitions.ts',
                        ]
                      : []),
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
        scope:
            version >= 4
                ? 'scalar-storage-and-presentation'
                : 'scalar-storage-only',
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
            : {
                  families: [
                      text,
                      family('boolean'),
                      ...(version >= 3
                          ? [family('numeric'), family('date')]
                          : []),
                      ...(version >= 5 ? [family('enum')] : []),
                      ...(version >= 6 ? [family('uuid')] : []),
                      ...(version >= 7
                          ? [family('timestamp'), family('timestamptz')]
                          : []),
                      ...(version >= 8
                          ? [family('time'), family('timetz')]
                          : []),
                      ...(version >= 9 ? [family('interval')] : []),
                  ],
              }),
        runtimeAdmission: 'pending',
        toolchain: { prettier: '3.6.2' },
        generated: {
            path: postgresFieldConfigSource,
            sha256: hash(generatedBytes),
        },
    };
    if (version >= 4) {
        const presentationBytes = Buffer.from(
            'synthetic generated presentation bytes\n'
        );
        inputs.set(postgresTextPresentationSource, presentationBytes);
        receipt.presentation = {
            kind: 'text-column-presentation',
            sourcePath: postgresTextPresentationAuthorSource,
            sourceSha256: hash(
                inputs.get(postgresTextPresentationAuthorSource)
            ),
            generated: {
                path: postgresTextPresentationSource,
                sha256: hash(presentationBytes),
            },
        };
    }
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

test('v3 configuration receipts bind all four families and the complete shared-factory closure', () => {
    const value = fixture(3);
    value.receipt.families.reverse();
    const verified = value.verify();
    assert.deepEqual(verified.aliases, [
        'PostgresTextColumnConfig',
        'PostgresBooleanColumnConfig',
        'PostgresNumericColumnConfig',
        'PostgresDateColumnConfig',
    ]);
    assert.equal(verified.receiptVersion, 3);
    assert.deepEqual(value.readPaths, value.paths);
});

test('v4 binds the exact presentation authoring closure and generated sidecar', () => {
    const value = fixture(4);
    const verified = value.verify();
    assert.equal(value.paths.length, 20);
    assert.equal(verified.receiptVersion, 4);
    assert.deepEqual(
        verified.aliases,
        Object.values(identities)
            .slice(0, 4)
            .map(([, type]) => type)
    );
    assert.deepEqual(verified.presentation, value.receipt.presentation);
    assert.deepEqual(value.readPaths, [
        ...value.paths,
        postgresTextPresentationSource,
    ]);
});

test('v5 binds native enum configuration without rewriting historical family closures', () => {
    const value = fixture(5);
    value.receipt.families.reverse();
    const verified = value.verify();
    assert.equal(value.paths.length, 22);
    assert.equal(verified.receiptVersion, 5);
    assert.deepEqual(
        verified.aliases,
        Object.values(identities)
            .slice(0, 5)
            .map(([, type]) => type)
    );
    assert.deepEqual(verified.presentation, value.receipt.presentation);
    assert.deepEqual(value.readPaths, [
        ...value.paths,
        postgresTextPresentationSource,
    ]);
    for (const version of [2, 3, 4]) {
        const historical = fixture(version);
        historical.receipt.families[historical.receipt.families.length - 1] =
            family('enum');
        assert.throws(historical.verify, /family-identity/);
        assert.deepEqual(historical.readPaths, []);
    }
});

test('v6 binds UUID configuration with its exact closure while historical receipts refuse UUID substitution', () => {
    const value = fixture(6);
    value.receipt.families.reverse();
    const verified = value.verify();
    assert.equal(value.paths.length, 23);
    assert.equal(verified.receiptVersion, 6);
    assert.deepEqual(
        verified.aliases,
        Object.values(identities)
            .slice(0, 6)
            .map(([, type]) => type)
    );
    assert.deepEqual(verified.presentation, value.receipt.presentation);
    assert.deepEqual(value.readPaths, [
        ...value.paths,
        postgresTextPresentationSource,
    ]);
    for (const version of [2, 3, 4, 5]) {
        const historical = fixture(version);
        historical.receipt.families[historical.receipt.families.length - 1] =
            family('uuid');
        assert.throws(historical.verify, /family-identity/);
        assert.deepEqual(historical.readPaths, []);
    }
});

test('v7 binds distinct temporal configurations and refuses their substitution into historical receipts', () => {
    const value = fixture(7);
    value.receipt.families.reverse();
    const verified = value.verify();
    assert.equal(value.paths.length, 24);
    assert.deepEqual(
        verified.aliases,
        Object.values(identities)
            .slice(0, 8)
            .map(([, name]) => name)
    );
    for (const version of [2, 3, 4, 5, 6])
        for (const kind of ['timestamp', 'timestamptz']) {
            const historical = fixture(version);
            historical.receipt.families[
                historical.receipt.families.length - 1
            ] = family(kind);
            assert.throws(historical.verify, /family-identity/);
            assert.deepEqual(historical.readPaths, []);
        }
});

test('actual temporal declarations reject paired removal or a v6 downgrade', () => {
    const aliases = Object.values(identities)
        .slice(0, 8)
        .map(([, name]) => name);
    const declarations = configurationDeclarations(aliases);
    const internal = {
        aliases,
        configurationValidation: { receiptVersion: 7 },
    };
    assertPostgresConfigDeclarationInventory(internal, declarations);
    const previous = {
        aliases: aliases.slice(0, 6),
        configurationValidation: { receiptVersion: 6 },
    };
    assertPostgresConfigDeclarationInventory(
        previous,
        configurationDeclarations(previous.aliases)
    );
    assert.throws(
        () => assertPostgresConfigDeclarationInventory(previous, declarations),
        /declaration-inventory/
    );
    for (const name of aliases.slice(6))
        assert.throws(
            () =>
                assertPostgresConfigDeclarationInventory(
                    internal,
                    configurationDeclarations(
                        aliases.filter((alias) => alias !== name)
                    )
                ),
            /declaration-inventory/
        );
});

test('actual configuration declarations reject paired UUID removal and version downgrade', () => {
    const aliases = Object.values(identities)
        .slice(0, 6)
        .map(([, name]) => name);
    const declarations = configurationDeclarations(aliases);
    const internal = {
        aliases,
        configurationValidation: { receiptVersion: 6 },
    };
    assertPostgresConfigDeclarationInventory(internal, declarations);
    const downgraded = {
        aliases: aliases.filter((name) => name !== 'PostgresUuidColumnConfig'),
        configurationValidation: { receiptVersion: 5 },
    };
    assertPostgresConfigDeclarationInventory(
        downgraded,
        configurationDeclarations(downgraded.aliases)
    );
    assert.throws(
        () =>
            assertPostgresConfigDeclarationInventory(downgraded, declarations),
        /declaration-inventory/
    );
    assert.throws(
        () =>
            assertPostgresConfigDeclarationInventory(
                internal,
                configurationDeclarations(downgraded.aliases)
            ),
        /declaration-inventory/
    );
    assert.throws(
        () =>
            assertPostgresConfigDeclarationInventory(
                internal,
                Buffer.concat([
                    declarations,
                    Buffer.from(
                        '\nexport type CanonicalPostgresUuidColumnConfig = unknown;\n'
                    ),
                ])
            ),
        /declaration-inventory/
    );
    assert.throws(
        () => assertPostgresConfigDeclarationInventory(internal),
        /declaration-bytes/
    );
});

test("receipt versions cannot substitute later families or another version's source closure", async (t) => {
    for (const kind of [
        'numeric',
        'date',
        'enum',
        'uuid',
        'timestamp',
        'timestamptz',
    ])
        await t.test(`v2 refuses the known ${kind} family`, () => {
            const value = fixture(2);
            value.receipt.families[1] = family(kind);
            assert.throws(value.verify, /family-identity/);
            assert.deepEqual(value.readPaths, []);
        });
    for (const [from, to] of [
        [2, 3],
        [3, 2],
        [4, 5],
        [5, 4],
        [5, 6],
        [6, 5],
        [7, 8],
        [8, 7],
        [8, 9],
        [9, 8],
    ]) {
        await t.test(`relabel v${from} as v${to}`, () => {
            const value = fixture(from);
            value.receipt.formatVersion = to;
            assert.throws(value.verify, /families/);
            assert.deepEqual(value.readPaths, []);
        });
        await t.test(
            `v${to} refuses the rehashed v${from} source closure`,
            () => {
                const value = fixture(to);
                value.receipt.sources = fixture(from).receipt.sources;
                value.receipt.sourceSnapshotSha256 = hash(
                    JSON.stringify(value.receipt.sources)
                );
                assert.throws(value.verify, /source-membership/);
                assert.deepEqual(value.readPaths, []);
            }
        );
    }
});

test('configuration receipts refuse unreviewed versions, family identities and admission', async (t) => {
    for (const [name, mutate, reason] of [
        ['version', (r) => (r.formatVersion = 10), 'format-version'],
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
        for (const version of [2, 3, 4, 5, 6, 7, 8, 9])
            await t.test(`v${version}: ${name}`, () => {
                const value = fixture(version);
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
        for (const version of [2, 3, 4, 5, 6, 7, 8, 9])
            await t.test(`v${version}: ${name}`, () => {
                const value = fixture(version);
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
        for (const version of [2, 3, 4, 5, 6, 7, 8, 9])
            await t.test(`v${version}: ${name}`, () => {
                const value = fixture(version);
                mutate(value);
                assert.throws(value.verify, new RegExp(reason));
            });
    }
});

test('build provenance binds the validator and both canonical configuration inputs without source access', async (t) => {
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
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
                ...(version >= 4
                    ? {
                          runtimeArtifacts: [
                              {
                                  module: 'postgresTextPresentation.generated',
                                  sourcePath:
                                      verified.presentation.generated.path,
                                  sourceSha256:
                                      verified.presentation.generated.sha256,
                              },
                          ],
                      }
                    : {}),
            };
            if (version >= 4)
                internal.sources.push(
                    {
                        path: verified.presentation.sourcePath,
                        sha256: verified.presentation.sourceSha256,
                    },
                    {
                        path: verified.presentation.generated.path,
                        sha256: verified.presentation.generated.sha256,
                    }
                );
            assertPostgresConfigReceiptProvenance(internal, validatorSha256);
            if (version === 6) {
                const actualDeclarations = configurationDeclarations(
                    internal.aliases
                );
                const downgraded = structuredClone(internal);
                downgraded.configurationValidation.receiptVersion = 5;
                downgraded.configurationValidation.aliases =
                    downgraded.configurationValidation.aliases.filter(
                        (name) => name !== 'PostgresUuidColumnConfig'
                    );
                downgraded.aliases = downgraded.aliases.filter(
                    (name) => name !== 'PostgresUuidColumnConfig'
                );
                assert.throws(
                    () =>
                        assertProof(
                            downgraded,
                            validatorSha256,
                            actualDeclarations
                        ),
                    /declaration-inventory/
                );
            }
            const commonAlias = structuredClone(internal);
            commonAlias.aliases.unshift('PostgresValue');
            assertPostgresConfigReceiptProvenance(commonAlias, validatorSha256);
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
            const duplicateAlias = structuredClone(internal);
            duplicateAlias.aliases.push(verified.aliases[0]);
            assert.throws(
                () =>
                    assertPostgresConfigReceiptProvenance(
                        duplicateAlias,
                        validatorSha256
                    ),
                /alias-provenance/
            );
            for (const [, typeName] of Object.values(identities)) {
                if (verified.aliases.includes(typeName)) continue;
                const expanded = structuredClone(internal);
                expanded.aliases.push(typeName);
                assert.throws(
                    () =>
                        assertPostgresConfigReceiptProvenance(
                            expanded,
                            validatorSha256
                        ),
                    /alias-provenance/
                );
            }
            if (version !== 1) {
                const reordered = structuredClone(internal);
                reordered.aliases.reverse();
                reordered.configurationValidation.aliases.reverse();
                assert.throws(
                    () =>
                        assertPostgresConfigReceiptProvenance(
                            reordered,
                            validatorSha256
                        ),
                    /alias-provenance/
                );
            }
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
    for (const version of [2, 3, 4, 5, 6, 7, 8, 9])
        await t.test(`version ${version}`, (t) => {
            const root = mkdtempSync(
                path.join(tmpdir(), 'sdk-config-receipt-git-')
            );
            t.after(() => rmSync(root, { recursive: true, force: true }));
            const value = fixture(version);
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
            if (version >= 4) {
                write(
                    postgresTextPresentationSource,
                    'changed uncommitted policy'
                );
                assert.throws(
                    () =>
                        readPostgresConfigReceipt({ monorepo: root, revision }),
                    /canonical-source-drift/
                );
                write(
                    postgresTextPresentationSource,
                    value.inputs.get(postgresTextPresentationSource)
                );
            }
            write(value.paths[0], 'changed uncommitted input');
            assert.throws(
                () => readPostgresConfigReceipt({ monorepo: root, revision }),
                /canonical-source-drift/
            );
        });
});

test('presentation receipts refuse missing, expanded or substituted identities and bytes', async (t) => {
    for (const [name, mutate, reason] of [
        [
            'missing policy',
            (v) => delete v.receipt.presentation,
            'receipt-fields',
        ],
        [
            'expanded policy',
            (v) => (v.receipt.presentation.allowWrites = true),
            'presentation-identity',
        ],
        [
            'kind',
            (v) => (v.receipt.presentation.kind = 'form-execution'),
            'presentation-identity',
        ],
        [
            'authored path',
            (v) => (v.receipt.presentation.sourcePath = 'other.ts'),
            'presentation-identity',
        ],
        [
            'authored hash',
            (v) => (v.receipt.presentation.sourceSha256 = hash('other source')),
            'presentation-identity',
        ],
        [
            'generated path',
            (v) => (v.receipt.presentation.generated.path = 'other.ts'),
            'presentation-identity',
        ],
        [
            'expanded output',
            (v) => (v.receipt.presentation.generated.ready = true),
            'presentation-identity',
        ],
        [
            'generated hash',
            (v) =>
                (v.receipt.presentation.generated.sha256 =
                    hash('other output')),
            'presentation-integrity',
        ],
        [
            'generated bytes',
            (v) =>
                v.inputs.set(
                    postgresTextPresentationSource,
                    Buffer.from('changed output')
                ),
            'presentation-integrity',
        ],
        [
            'old scope',
            (v) => (v.receipt.scope = 'scalar-storage-only'),
            'receipt-scope',
        ],
    ])
        for (const version of [4, 5, 6, 7, 8, 9])
            await t.test(`v${version}: ${name}`, () => {
                const value = fixture(version);
                mutate(value);
                assert.throws(value.verify, new RegExp(reason));
                assert(
                    value.readPaths.every(
                        (path) =>
                            value.paths.includes(path) ||
                            path === postgresTextPresentationSource
                    )
                );
            });
    for (const version of [1, 2, 3]) {
        const value = fixture(version);
        value.receipt.presentation = fixture(4).receipt.presentation;
        assert.throws(value.verify, /receipt-fields/);
    }
});

for (const version of [4, 5, 6, 7, 8, 9])
    test(`v${version} build proof binds both policy sources and the generated runtime input`, () => {
        const verified = fixture(version).verify();
        const validatorSha256 = hash('synthetic validator');
        const internal = {
            aliases: verified.aliases,
            configurationValidation: { ...verified, validatorSha256 },
            sources: [
                {
                    path: postgresFieldConfigSource,
                    sha256: verified.schemaSourceSha256,
                },
                {
                    path: postgresFieldConfigProvenance,
                    sha256: verified.receiptSourceSha256,
                },
                {
                    path: verified.presentation.sourcePath,
                    sha256: verified.presentation.sourceSha256,
                },
                {
                    path: verified.presentation.generated.path,
                    sha256: verified.presentation.generated.sha256,
                },
            ],
            runtimeArtifacts: [
                {
                    module: 'postgresTextPresentation.generated',
                    sourcePath: verified.presentation.generated.path,
                    sourceSha256: verified.presentation.generated.sha256,
                },
            ],
        };
        assertPostgresConfigReceiptProvenance(internal, validatorSha256);
        for (const mutate of [
            (v) => v.sources.pop(),
            (v) => (v.sources[2].sha256 = hash('changed author')),
            (v) =>
                (v.configurationValidation.presentation.generated.sha256 =
                    hash('changed sidecar')),
            (v) =>
                (v.runtimeArtifacts[0].sourcePath =
                    verified.presentation.sourcePath),
            (v) =>
                (v.runtimeArtifacts[0].sourceSha256 =
                    verified.presentation.sourceSha256),
            (v) => (v.runtimeArtifacts = []),
        ]) {
            const changed = structuredClone(internal);
            mutate(changed);
            assert.throws(
                () =>
                    assertPostgresConfigReceiptProvenance(
                        changed,
                        validatorSha256
                    ),
                /presentation-provenance/
            );
        }
    });

test('v8 binds both native time families and its exact25-source closure', () => {
    const value = fixture(8);
    value.receipt.families.reverse();
    const verified = value.verify();
    assert.equal(value.paths.length, 25);
    assert.deepEqual(
        verified.aliases,
        Object.values(identities)
            .slice(0, 10)
            .map(([, name]) => name)
    );
    const older = fixture(7);
    older.receipt.families.push(family('time'), family('timetz'));
    assert.throws(older.verify, /families/);
    assert.deepEqual(older.readPaths, []);
});

test('actual v8 declarations reject paired time-family removal and a v7 downgrade', () => {
    const aliases = Object.values(identities)
        .slice(0, 10)
        .map(([, name]) => name);
    const declarations = configurationDeclarations(aliases);
    const internal = {
        aliases,
        configurationValidation: { receiptVersion: 8 },
    };
    assertPostgresConfigDeclarationInventory(internal, declarations);
    const historicalAliases = aliases.slice(0, 8);
    const downgraded = {
        aliases: historicalAliases,
        configurationValidation: { receiptVersion: 7 },
    };
    assertPostgresConfigDeclarationInventory(
        downgraded,
        configurationDeclarations(historicalAliases)
    );
    assert.throws(
        () =>
            assertPostgresConfigDeclarationInventory(downgraded, declarations),
        /declaration-inventory/
    );
    for (const name of aliases.slice(8)) {
        assert.throws(
            () =>
                assertPostgresConfigDeclarationInventory(
                    internal,
                    configurationDeclarations(aliases.filter((n) => n !== name))
                ),
            /declaration-inventory/
        );
        assert.throws(
            () =>
                assertPostgresConfigDeclarationInventory(
                    internal,
                    Buffer.concat([
                        declarations,
                        configurationDeclarations([name]),
                    ])
                ),
            /declaration-inventory/
        );
    }
});

test('v9 binds native interval and exact26-source closure without changing v8', () => {
    const value = fixture(9);
    assert.equal(value.paths.length, 26);
    assert.deepEqual(
        value.verify().aliases,
        Object.values(identities).map(([, name]) => name)
    );
    const historical = fixture(8);
    assert.equal(historical.paths.length, 25);
    historical.receipt.families.push(family('interval'));
    assert.throws(historical.verify, /families/);
    assert.deepEqual(historical.readPaths, []);
});
test('actual v9 interval declarations reject removal, duplicate and metadata downgrade', () => {
    const aliases = Object.values(identities).map(([, name]) => name),
        declarations = configurationDeclarations(aliases),
        internal = { aliases, configurationValidation: { receiptVersion: 9 } };
    assertPostgresConfigDeclarationInventory(internal, declarations);
    const older = aliases.slice(0, 10),
        downgraded = {
            aliases: older,
            configurationValidation: { receiptVersion: 8 },
        };
    assertPostgresConfigDeclarationInventory(
        downgraded,
        configurationDeclarations(older)
    );
    assert.throws(
        () =>
            assertPostgresConfigDeclarationInventory(downgraded, declarations),
        /declaration-inventory/
    );
    assert.throws(
        () =>
            assertPostgresConfigDeclarationInventory(
                internal,
                configurationDeclarations(older)
            ),
        /declaration-inventory/
    );
    assert.throws(
        () =>
            assertPostgresConfigDeclarationInventory(
                internal,
                Buffer.concat([
                    declarations,
                    configurationDeclarations(['PostgresIntervalColumnConfig']),
                ])
            ),
        /declaration-inventory/
    );
});
