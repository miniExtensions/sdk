import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    postgresCopyPlanningSource,
    postgresCopyPlanningProvenance,
    postgresCopyPlanningDraftSource,
    postgresCopyPlanningAliases,
    verifyPostgresCopyPlanningReceipt,
    readPostgresCopyPlanningReceipt,
    assertPostgresCopyPlanningReceiptProvenance,
} from './postgres-copy-planning-receipts.mjs';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const paths = [
    '.prettierrc',
    'package.json',
    'pnpm-lock.yaml',
    'types/constants/extensionType.ts',
    'types/extensions/GetExtensionSectionsArgs.ts',
    'types/extensions/postgres/copyFieldValueDefinition.ts',
    'types/extensions/postgres/copyFieldValueDraft.ts',
    'types/extensions/postgres/definitionContext.ts',
    'types/extensions/postgres/projectSettings.ts',
    'types/extensions/postgres/settingBindings.ts',
    'types/extensions/sections.tsx',
    'types/extensions/settings/field.ts',
    'types/extensions/sourceRequirements.ts',
    'types/scripts/postgres-configs/generate.ts',
    'types/scripts/postgres-copy-planning/emit.ts',
    'types/scripts/postgres-copy-planning/generate.ts',
].sort();
const definition = {
    contract: 'postgres-copy-field-value-planning',
    scope: 'private-workspace-member-read-only',
    extensionType: 'BULK_COPY_FIELD_VALUE',
    sourceSettingId: 'fieldsToCopy',
    destinationSettingId: 'destinationFields',
    columnNames: {
        minLength: 1,
        maxLength: 256,
        allowNul: false,
    },
    mappings: {
        minLength: 1,
        maxLength: 1600,
        equalLengths: true,
        uniqueDestinations: true,
        disjointSourcesAndDestinations: true,
    },
    preview: {
        pageSize: 25,
        maxOffset: 10000,
    },
    valuePolicy: 'exact-native-values',
    executionAdmission: 'pending',
};

const declarations = (aliases = postgresCopyPlanningAliases) =>
    Buffer.from(
        aliases
            .map((name) => `export type Canonical${name}=unknown;`)
            .join('\n')
    );
const fixture = () => {
    const bytes = new Map(paths.map((p) => [p, Buffer.from('synthetic ' + p)])),
        generatedBytes = Buffer.from('synthetic Copy schema');
    const sources = paths.map((p) => ({ path: p, sha256: hash(bytes.get(p)) }));
    const receipt = {
        formatVersion: 1,
        contract: definition.contract,
        scope: definition.scope,
        sourceRepository: 'miniExtensions/monorepo',
        sourceMode: 'working-tree-content',
        sources,
        sourceSnapshotSha256: hash(JSON.stringify(sources)),
        definition: structuredClone(definition),
        storageProjectionSha256: hash('synthetic Copy projection'),
        toolchain: { prettier: '3.6.2' },
        generated: {
            path: postgresCopyPlanningSource,
            sha256: hash(generatedBytes),
        },
    };
    const verify = () =>
        verifyPostgresCopyPlanningReceipt({
            receiptBytes: Buffer.from(JSON.stringify(receipt)),
            generatedBytes,
            readSource: (p) => bytes.get(p),
        });
    const internal = () => ({
        aliases: ['PostgresConnection', ...postgresCopyPlanningAliases],
        copyPlanningValidation: {
            ...verify(),
            validatorSha256: hash('synthetic validator'),
        },
        sources: [
            { path: postgresCopyPlanningSource, sha256: hash(generatedBytes) },
            {
                path: postgresCopyPlanningProvenance,
                sha256: hash(Buffer.from(JSON.stringify(receipt))),
            },
            {
                path: postgresCopyPlanningDraftSource,
                sha256: hash(bytes.get(postgresCopyPlanningDraftSource)),
            },
        ],
    });
    return { bytes, receipt, generatedBytes, verify, internal };
};
test('binds independent private Copy planning storage and all five authoring/read aliases', () => {
    const f = fixture(),
        proof = f.verify();
    assert.equal(proof.sources.length, 16);
    assert.deepEqual(proof.aliases, ['PostgresCopyPlanningConfig']);
    assertPostgresCopyPlanningReceiptProvenance(
        f.internal(),
        hash('synthetic validator'),
        declarations()
    );
});
for (const [name, mutate] of [
    ['version', (r) => (r.formatVersion = 2)],
    ['scope', (r) => (r.scope = 'public')],
    ['execution', (r) => (r.definition.executionAdmission = 'enabled')],
    ['bounds', (r) => r.definition.mappings.maxLength++],
    ['policy', (r) => (r.definition.skipEmpty = true)],
    ['projection', (r) => (r.storageProjectionSha256 = 'invalid')],
    ['missing source', (r) => r.sources.pop()],
    ['duplicate source', (r) => (r.sources[0] = r.sources[1])],
    ['output path', (r) => (r.generated.path = 'elsewhere.ts')],
    ['output bytes', (r) => (r.generated.sha256 = hash('changed'))],
    ['extra proof', (r) => (r.runtimeAdmission = 'enabled')],
])
    test('refuses Copy receipt ' + name, () => {
        const f = fixture();
        mutate(f.receipt);
        assert.throws(f.verify, /receipt/);
    });
test('refuses canonical source drift without executing any authored callbacks', () => {
    const f = fixture();
    f.bytes.set(paths[0], Buffer.from('changed source'));
    assert.throws(f.verify, /source-bytes/);
});
test('keeps historical absence coherent without accepting Copy authoring under it', () => {
    const old = { aliases: ['PostgresConnection'], sources: [] };
    assertPostgresCopyPlanningReceiptProvenance(
        old,
        hash('validator'),
        declarations([])
    );
    assert.throws(
        () =>
            assertPostgresCopyPlanningReceiptProvenance(
                old,
                hash('validator'),
                declarations()
            ),
        /declaration-inventory/
    );
    const f = fixture(),
        dropped = f.internal();
    dropped.aliases = ['PostgresConnection'];
    delete dropped.copyPlanningValidation;
    dropped.sources = [];
    assert.throws(
        () =>
            assertPostgresCopyPlanningReceiptProvenance(
                dropped,
                hash('synthetic validator'),
                declarations()
            ),
        /declaration-inventory/
    );
});
for (const alias of postgresCopyPlanningAliases) {
    test('refuses partial alias/proof state ' + alias, () => {
        const f = fixture(),
            i = f.internal();
        i.aliases = i.aliases.filter((n) => n !== alias);
        assert.throws(
            () =>
                assertPostgresCopyPlanningReceiptProvenance(
                    i,
                    hash('synthetic validator'),
                    declarations()
                ),
            /validator-provenance/
        );
    });
    test('refuses missing or duplicate declaration ' + alias, () => {
        const f = fixture();
        assert.throws(
            () =>
                assertPostgresCopyPlanningReceiptProvenance(
                    f.internal(),
                    hash('synthetic validator'),
                    declarations(
                        postgresCopyPlanningAliases.filter((n) => n !== alias)
                    )
                ),
            /declaration-inventory/
        );
        assert.throws(
            () =>
                assertPostgresCopyPlanningReceiptProvenance(
                    f.internal(),
                    hash('synthetic validator'),
                    declarations([...postgresCopyPlanningAliases, alias])
                ),
            /declaration-inventory/
        );
    });
}
for (const [name, mutate] of [
    ['missing proof', (i) => delete i.copyPlanningValidation],
    [
        'validator substitution',
        (i) => (i.copyPlanningValidation.validatorSha256 = hash('wrong')),
    ],
    [
        'authoring omission',
        (i) =>
            (i.sources = i.sources.filter(
                (s) => s.path !== postgresCopyPlanningDraftSource
            )),
    ],
    [
        'artifact omission',
        (i) =>
            (i.sources = i.sources.filter(
                (s) => s.path !== postgresCopyPlanningProvenance
            )),
    ],
    [
        'contradictory source',
        (i) => i.sources.push({ path: paths[0], sha256: hash('wrong') }),
    ],
    ['alias duplication', (i) => i.aliases.push('PostgresCopyPlanningConfig')],
])
    test('refuses Copy build/archive ' + name, () => {
        const f = fixture(),
            i = f.internal();
        mutate(i);
        assert.throws(
            () =>
                assertPostgresCopyPlanningReceiptProvenance(
                    i,
                    hash('synthetic validator'),
                    declarations()
                ),
            /receipt/
        );
    });
const gitFixture = (t, files) => {
    const root = mkdtempSync(path.join(tmpdir(), 'sdk-copy-proof-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const [name, value] of files) {
        mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        writeFileSync(path.join(root, name), value);
    }
    const git = (...args) =>
        execFileSync('git', args, {
            cwd: root,
            encoding: 'utf8',
            env: {
                ...process.env,
                GIT_AUTHOR_NAME: 'Synthetic',
                GIT_AUTHOR_EMAIL: 'synthetic@example.invalid',
                GIT_COMMITTER_NAME: 'Synthetic',
                GIT_COMMITTER_EMAIL: 'synthetic@example.invalid',
            },
        });
    git('init', '--quiet');
    if (files.size === 0)
        git('commit', '--allow-empty', '--no-gpg-sign', '-m', 'synthetic');
    else {
        git('add', '.');
        git('commit', '--no-gpg-sign', '-m', 'synthetic');
    }
    return { root, revision: git('rev-parse', 'HEAD').trim() };
};
test('reader permits old revisions but refuses half artifacts or authoring without a receipt', (t) => {
    const old = gitFixture(t, new Map());
    assert.equal(
        readPostgresCopyPlanningReceipt({
            monorepo: old.root,
            revision: old.revision,
        }),
        null
    );
    for (const filename of [
        postgresCopyPlanningSource,
        postgresCopyPlanningProvenance,
        postgresCopyPlanningDraftSource,
    ]) {
        const half = gitFixture(
            t,
            new Map([[filename, Buffer.from('synthetic')]])
        );
        assert.throws(
            () =>
                readPostgresCopyPlanningReceipt({
                    monorepo: half.root,
                    revision: half.revision,
                }),
            /receipt/
        );
    }
});
test('reader pins committed Copy sources and rejects later working-tree bytes', (t) => {
    const f = fixture(),
        files = new Map(f.bytes);
    files.set(postgresCopyPlanningSource, f.generatedBytes);
    files.set(
        postgresCopyPlanningProvenance,
        Buffer.from(JSON.stringify(f.receipt))
    );
    const g = gitFixture(t, files);
    assert.equal(
        readPostgresCopyPlanningReceipt({
            monorepo: g.root,
            revision: g.revision,
        }).sources.length,
        16
    );
    writeFileSync(path.join(g.root, paths[0]), 'changed after commit');
    assert.throws(
        () =>
            readPostgresCopyPlanningReceipt({
                monorepo: g.root,
                revision: g.revision,
            }),
        /canonical-source-drift/
    );
});

test('historical absence rejects a Copy arm hidden behind an internal NativeDraft helper', () => {
    const old = { aliases: ['PostgresNativeDraft'], sources: [] };
    const bytes =
        Buffer.from(`interface HiddenCopy { type: 'BULK_COPY_FIELD_VALUE'; state: { fieldsToCopy: string[] } }
type InternalArm=HiddenCopy;
export type CanonicalPostgresNativeDraft={type:'FORM'}|InternalArm;`);
    assert.throws(
        () =>
            assertPostgresCopyPlanningReceiptProvenance(
                old,
                hash('validator'),
                bytes
            ),
        /unverified-copy-declaration/
    );
    const harmless =
        Buffer.from(`type UnusedAirtable={type:'BULK_COPY_FIELD_VALUE'};
export type CanonicalPostgresNativeDraft={type:'FORM'};`);
    assertPostgresCopyPlanningReceiptProvenance(
        old,
        hash('validator'),
        harmless
    );
});
