import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    assertRuntimeCorsPolicy,
    canonicalCorsPolicyPath,
} from './runtime-cors-check.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const before = readFileSync(
    new URL('./fixtures/runtime-cors/before-58f73d5.ts', import.meta.url),
    'utf8'
);
const after = readFileSync(
    new URL('./fixtures/runtime-cors/after-pr7583-7c092c9.ts', import.meta.url),
    'utf8'
);
const operations = JSON.parse(
    readFileSync(
        new URL(
            '../src/runtime/contracts/generated.provenance.json',
            import.meta.url
        )
    )
).operations;
const publicOperations = operations.filter(
    ({ transport }) => transport === 'trpc'
);

test('actual pre-fix canonical source rejects exactly the three omitted SDK operations', () => {
    assert.equal(publicOperations.length, 13);
    assert.throws(
        () => assertRuntimeCorsPolicy(before, operations),
        (error) => {
            const lines = error.message.split('\n').slice(1);
            assert.equal(
                lines.length,
                6,
                'only preflight and actual grant failures for three omissions'
            );
            for (const [operation, method, route] of [
                [
                    'addresses.listPredictions',
                    'GET',
                    'publicExtensions.autoCompleteAddressField',
                ],
                [
                    'addresses.getFormattedAddress',
                    'GET',
                    'publicExtensions.getFormattedAddressFromPlaceId',
                ],
                [
                    'buttons.triggerWebhook',
                    'POST',
                    'publicExtensions.triggerWebhook',
                ],
            ])
                for (const phase of ['preflight', 'actual'])
                    assert(
                        lines.some((line) =>
                            line.startsWith(
                                `${operation} ${method} ${route} ${phase}:`
                            )
                        )
                    );
            return true;
        }
    );
});

test('actual PR7583 policy admits every generated operation with SDK context and preserves denials', () => {
    assert.equal(
        assertRuntimeCorsPolicy(after, operations).publicOperations,
        13
    );
});

test('a newly generated operation missing from canonical policy fails without a test allowlist update', () => {
    assert.throws(
        () =>
            assertRuntimeCorsPolicy(after, [
                ...operations,
                {
                    operation: 'future.publicQuery',
                    route: 'publicExtensions.newPublicQuery',
                    kind: 'query',
                    transport: 'trpc',
                },
            ]),
        /future\.publicQuery GET publicExtensions\.newPublicQuery preflight/
    );
});

test('global grants fail private and mixed selectors in both orders', () => {
    const broadened = after.replace(
        'publicRuntimeProcedures.has(path)',
        'true'
    );
    assert.notEqual(broadened, after);
    assert.throws(
        () => assertRuntimeCorsPolicy(broadened, operations),
        (error) => {
            assert(error.message.includes('"workspaces.byId"'));
            assert(
                error.message.includes('airtable.deleteRecord,workspaces.byId')
            );
            assert(
                error.message.includes('workspaces.byId,airtable.deleteRecord')
            );
            return true;
        }
    );
});

test('normalizing singleton-public and all-public arrays fails canonical selector denial', () => {
    const normalized = after.replace(
        'const paths = req.query.trpc;',
        "const paths = Array.isArray(req.query.trpc) ? req.query.trpc.join(',') : req.query.trpc;"
    );
    assert.notEqual(normalized, after);
    const first = publicOperations[0];
    const second = publicOperations.find(
        (entry) => entry.route !== first.route
    );
    assert(second);
    assert.throws(
        () => assertRuntimeCorsPolicy(normalized, operations),
        (error) => {
            for (const selector of [[first.route], [first.route, second.route]])
                assert(
                    error.message.includes(
                        `${first.operation} denied selector ${JSON.stringify(selector)}:`
                    ),
                    `Normalization must fail the exact array probe ${JSON.stringify(selector)}.`
                );
            return true;
        }
    );
});

test('prefix broadening fails exact-route denial', () => {
    const broadened = after.replace(
        'publicRuntimeProcedures.has(path)',
        "publicRuntimeProcedures.has(path.split('.').slice(0, 2).join('.'))"
    );
    assert.notEqual(broadened, after);
    assert.throws(
        () => assertRuntimeCorsPolicy(broadened, operations),
        /airtable\.deleteRecord\.extra/
    );
});

test('context preflight restrictions and actual no-store remain generation obligations', () => {
    for (const [needle, replacement, expected] of [
        ["'miniext-context'", "'unsupported-context'", /miniext-context/],
        ["'GET, POST, OPTIONS'", "'OPTIONS'", /method omitted/],
        ["'private, no-store'", "'public, max-age=60'", /actual/],
        ['allowedRequestHeaders.has(', 'Boolean(', /denied headers/],
    ]) {
        const changed = after.replace(needle, replacement);
        assert.notEqual(changed, after);
        assert.throws(
            () => assertRuntimeCorsPolicy(changed, operations),
            expected
        );
    }
});

test('runtime dependencies fail clearly instead of importing canonical server modules', () => {
    assert.throws(
        () =>
            assertRuntimeCorsPolicy(
                "import { backend } from './backend';\n" + after,
                operations
            ),
        /standalone with type-only imports/
    );
});

test('unsupported generated tRPC methods fail clearly', () => {
    assert.throws(
        () =>
            assertRuntimeCorsPolicy(after, [
                {
                    operation: 'future.subscription',
                    route: 'publicExtensions.subscribe',
                    kind: 'subscription',
                    transport: 'trpc',
                },
            ]),
        /unsupported tRPC kind subscription/
    );
});

function canonicalFixture(t, source) {
    const checkout = mkdtempSync(
        path.join(tmpdir(), 'sdk-cors-canonical-fixture-')
    );
    t.after(() => rmSync(checkout, { recursive: true, force: true }));
    mkdirSync(path.dirname(path.join(checkout, canonicalCorsPolicyPath)), {
        recursive: true,
    });
    writeFileSync(path.join(checkout, canonicalCorsPolicyPath), source);
    const git = (...args) =>
        execFileSync('git', args, {
            cwd: checkout,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    git('init', '--quiet');
    git('add', canonicalCorsPolicyPath);
    git(
        '-c',
        'user.name=SDK fixture',
        '-c',
        'user.email=sdk-fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--quiet',
        '-m',
        'Canonical source fixture'
    );
    return { checkout, revision: git('rev-parse', 'HEAD').trim() };
}

function invokeGenerator({ checkout, revision }) {
    return spawnSync(
        process.execPath,
        [
            'scripts/generate-runtime-contracts.mjs',
            '--monorepo',
            checkout,
            '--revision',
            revision,
            '--check',
        ],
        { cwd: root, encoding: 'utf8' }
    );
}

const contractHashes = () =>
    ['generated.ts', 'generated.provenance.json'].map((name) =>
        createHash('sha256')
            .update(
                readFileSync(path.join(root, 'src/runtime/contracts', name))
            )
            .digest('hex')
    );

test('real generator rejects omitted routes before contract compilation or output writes', (t) => {
    const original = contractHashes();
    const result = invokeGenerator(canonicalFixture(t, before));
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(
        result.stderr,
        /Generated public tRPC operations do not match canonical CORS policy/
    );
    assert.match(result.stderr, /addresses\.listPredictions/);
    assert.doesNotMatch(result.stderr, /Cannot read file.*tsconfig/);
    assert.deepEqual(contractHashes(), original);
});

test('real generator allows the fixed policy through to canonical type compilation', (t) => {
    const result = invokeGenerator(canonicalFixture(t, after));
    assert.equal(result.error, undefined);
    // This deliberately minimal source fixture has no canonical contracts or
    // tsconfig. Reaching that existing boundary proves CORS did not reject it,
    // not that a full monorepo regeneration was executed.
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cannot read file.*tsconfig/);
    assert.doesNotMatch(
        result.stderr,
        /operations do not match canonical CORS/
    );
});

test('policy checkout drift is rejected against the explicitly selected revision', (t) => {
    const fixture = canonicalFixture(t, after);
    writeFileSync(path.join(fixture.checkout, canonicalCorsPolicyPath), before);
    const result = invokeGenerator(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Canonical source drifted/);
});
