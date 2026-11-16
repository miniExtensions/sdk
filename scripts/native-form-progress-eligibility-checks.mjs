import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import ts from 'typescript';

// Separate exact oracle: PR7699 head 25b72af, not the older default-parity pin.
const source = readFileSync(
    new URL(
        '../test/fixtures/nativeFormProgressEligibility.ts.txt',
        import.meta.url
    )
);
assert.equal(
    createHash('sha1')
        .update(`blob ${source.length}\0`)
        .update(source)
        .digest('hex'),
    '3ab4e410d113b5b991e5340d23ed79c804854847'
);
const code = ts.transpileModule(source.toString(), {
    compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
    },
}).outputText;
const envelope = (revision, writerId, record) =>
    JSON.stringify({
        kind: 'miniExtensions-form-progress',
        schemaVersion: 1,
        revision,
        writerId,
        record,
    });

function fixture(api, locked) {
    const bytes = new Map();
    const trace = [];
    const warnings = [];
    let release;
    const gate = new Promise((resolve) => {
        release = resolve;
    });
    const storage = {
        getItem(key) {
            trace.push(['get', key]);
            return bytes.get(key) ?? null;
        },
        setItem(key, value) {
            trace.push(['set', key, value]);
            bytes.set(key, value);
        },
        removeItem(key) {
            trace.push(['remove', key]);
            bytes.delete(key);
        },
    };
    const locks = {
        request(_name, callback) {
            return gate.then(callback);
        },
    };
    const getStorage = () => {
        trace.push(['storage']);
        return storage;
    };
    if (api) {
        const instance = api.createNativeFormProgressStorage({
            shareId: 'A',
            writerId: 'writer',
            getStorage,
            getLocks: () => (locked ? locks : undefined),
            onWarning: (op) => warnings.push(op),
        });
        return {
            bytes,
            trace,
            warnings,
            release,
            write: (args) => instance.write(args),
        };
    }
    const context = createContext({
        exports: {},
        console: { warn: () => warnings.push('write') },
    });
    Object.defineProperty(context, 'localStorage', { get: getStorage });
    context.navigator = { locks: locked ? locks : undefined };
    new Script(code, {
        filename: 'pr7699-native-formProgressStorage.cjs',
    }).runInContext(context);
    return {
        bytes,
        trace,
        warnings,
        release,
        write: (args) =>
            context.exports.writeStoredFormProgress({
                ...args,
                shareId: 'A',
                writerId: 'writer',
            }),
    };
}

export async function assertNativeFormProgressEligibilityParity(api) {
    let checks = 0;
    for (const initial of ['first', 'update', 'malformed']) {
        const observations = [];
        for (const implementation of [undefined, api]) {
            const f = fixture(implementation, true);
            const old = envelope(4, 'writer', { saved: 'original' });
            if (initial === 'update') f.bytes.set('form-progress-A', old);
            if (initial === 'malformed')
                f.bytes.set('form-progress-A', '{malformed');
            f.bytes.set('form-progress-B', 'adjacent bytes');
            const before = [...f.bytes];
            let eligible = true;
            const pending = f.write({
                expectedRevision: initial === 'update' ? 4 : null,
                record: { next: true },
                isWriteStillEligible: () => eligible,
            });
            eligible = false;
            f.release();
            const result = await pending;
            assert.equal(result.status, 'cancelled');
            assert.deepEqual(
                f.trace,
                [],
                'revocation must precede all storage access'
            );
            assert.deepEqual(
                [...f.bytes],
                before,
                'existing, malformed and adjacent bytes must remain unchanged'
            );
            assert.deepEqual(f.warnings, []);
            observations.push({
                status: result.status,
                bytes: [...f.bytes],
                trace: f.trace,
            });
        }
        assert.deepEqual(observations[1], observations[0]);
        checks++;
    }
    for (const mode of [
        'locked-true',
        'locked-omitted',
        'unlocked-true',
        'unlocked-false',
        'locked-throw',
        'unlocked-throw',
        'locked-undefined',
        'unlocked-null',
        'locked-zero',
    ]) {
        const observations = [];
        for (const implementation of [undefined, api]) {
            const locked = mode.startsWith('locked');
            const f = fixture(implementation, locked);
            const args = {
                expectedRevision: null,
                record: { value: 'synthetic' },
            };
            if (!mode.endsWith('omitted'))
                args.isWriteStillEligible = () => {
                    if (mode.endsWith('throw'))
                        throw Error('synthetic eligibility error');
                    if (mode.endsWith('undefined')) return undefined;
                    if (mode.endsWith('null')) return null;
                    if (mode.endsWith('zero')) return 0;
                    return !mode.endsWith('false');
                };
            const pending = f.write(args);
            f.release();
            let result;
            try {
                result = { status: (await pending).status };
            } catch (error) {
                result = { rejected: error.message };
            }
            if (mode.endsWith('throw')) {
                assert.deepEqual(
                    result,
                    locked
                        ? { status: 'unavailable' }
                        : { rejected: 'synthetic eligibility error' }
                );
                assert.deepEqual(f.trace, []);
                assert.deepEqual(f.warnings, locked ? ['write'] : []);
            } else if (mode.endsWith('false')) {
                assert.deepEqual(result, { status: 'cancelled' });
                assert.deepEqual(f.trace, []);
            } else {
                assert.deepEqual(result, { status: 'written' });
                assert.equal(
                    f.bytes.get('form-progress-A'),
                    envelope(1, 'writer', args.record)
                );
            }
            observations.push({
                result,
                bytes: [...f.bytes],
                trace: f.trace,
                warnings: f.warnings,
            });
        }
        assert.deepEqual(observations[1], observations[0], mode);
        checks++;
    }
    return checks;
}
