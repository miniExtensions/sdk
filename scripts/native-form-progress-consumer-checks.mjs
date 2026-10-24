import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script, createContext } from 'node:vm';
import ts from 'typescript';

// Exact independent native oracle, not a second hand-written implementation.
// monorepo@25f5efdefaf482dea07af05d54fbeea8e3d92635
// components/PublicExtension/Form/formProgressStorage.ts
const nativeSource = readFileSync(
    new URL(
        '../test/fixtures/nativeFormProgressStorage.ts.txt',
        import.meta.url
    )
);
assert.equal(
    createHash('sha1')
        .update(`blob ${nativeSource.length}\0`)
        .update(nativeSource)
        .digest('hex'),
    '5e273f892f7a81cf8db31f60cc8afca60343eb19'
);
const nativeCode = ts.transpileModule(nativeSource.toString(), {
    compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
    },
}).outputText;
const detached = (value) => structuredClone(value);
const kind = 'miniExtensions-form-progress';
const envelope = (revision, writerId, record = {}) =>
    JSON.stringify({ kind, schemaVersion: 1, revision, writerId, record });
const rich = () => ({
    fld_hidden: 'keep while hidden',
    fld_linked: ['rec_one', 'rec_two'],
    fld_select: [{ id: 'sel_one', name: 'One', color: 'blue' }],
    fld_attachment: [
        {
            id: 'att_one',
            url: 'https://synthetic.invalid/file',
            filename: 'file.txt',
            thumbnails: {
                small: {
                    url: 'https://synthetic.invalid/thumb',
                    width: 1,
                    height: 1,
                },
            },
        },
    ],
    fld_collaborator: {
        id: 'usr_one',
        name: 'Synthetic',
        email: 'synthetic@example.test',
    },
    fld_empty: null,
    fld_false: false,
    fld_zero: 0,
});

function fixture(
    api,
    { locks = 'absent', shareId = 'synthetic / share' } = {}
) {
    const bytes = new Map();
    const trace = [];
    const warnings = [];
    const faults = {};
    let gate;
    let tail = Promise.resolve();
    let afterRead;
    const storage = {
        getItem(key) {
            trace.push(['get', key]);
            if (faults.read) throw Error('synthetic read');
            const value = bytes.get(key) ?? null;
            const callback = afterRead;
            afterRead = undefined;
            callback?.();
            return value;
        },
        setItem(key, value) {
            trace.push(['set', key, value]);
            if (faults.write) throw Error('synthetic quota');
            bytes.set(key, value);
        },
        removeItem(key) {
            trace.push(['remove', key]);
            if (faults.remove) throw Error('synthetic removal');
            bytes.delete(key);
        },
    };
    const getStorage = () => {
        trace.push(['storage']);
        if (faults.provider) throw Error('synthetic storage provider');
        return storage;
    };
    const manager = {
        request(name, callback) {
            trace.push(['lock', name]);
            if (faults.lock) return Promise.reject(Error('synthetic lock'));
            const held = gate;
            const result = tail.then(async () => {
                if (held) await held;
                return callback();
            });
            tail = result.then(
                () => {},
                () => {}
            );
            return result;
        },
    };
    const getLocks = () => {
        trace.push(['locks']);
        if (faults.lockProvider) throw Error('synthetic lock provider');
        return locks === 'none' ? undefined : manager;
    };
    let native;
    if (!api) {
        const context = createContext({
            exports: {},
            console: { warn: (text) => warnings.push(text) },
        });
        Object.defineProperty(context, 'localStorage', { get: getStorage });
        if (locks !== 'absent') {
            const navigator = {};
            Object.defineProperty(navigator, 'locks', { get: getLocks });
            context.navigator = navigator;
        }
        new Script(nativeCode, {
            filename: 'pinned-native-formProgressStorage.cjs',
        }).runInContext(context);
        native = context.exports;
    }
    const key = api
        ? api.makeNativeFormProgressKey(shareId)
        : native.makeFormProgressKey(shareId);
    const actor = (writerId) =>
        api
            ? api.createNativeFormProgressStorage({
                  shareId,
                  writerId,
                  getStorage,
                  ...(locks === 'absent' ? {} : { getLocks }),
                  onWarning: (op) =>
                      warnings.push(
                          `Unable to ${op} browser-local Form progress; continuing without it.`
                      ),
              })
            : {
                  read: () => native.readStoredFormProgressSnapshot(shareId),
                  write: (args) =>
                      native.writeStoredFormProgress({
                          ...args,
                          shareId,
                          writerId,
                      }),
                  remove: () => native.removeStoredFormProgress(shareId),
                  removeIfOwned: () =>
                      native.removeStoredFormProgressIfOwned({
                          shareId,
                          writerId,
                      }),
              };
    return {
        bytes,
        trace,
        warnings,
        faults,
        key,
        actor,
        parse: api
            ? api.parseNativeFormProgressValue
            : native.parseStoredFormProgressValue,
        afterRead: (callback) => {
            afterRead = callback;
        },
        hold() {
            let release;
            gate = new Promise((resolve) => {
                release = resolve;
            });
            return () => {
                gate = undefined;
                release();
            };
        },
    };
}

export async function assertNativeFormProgressParity(api) {
    let checks = 0;
    const check = async (name, story, options) => {
        const observed = [];
        for (const implementation of [undefined, api]) {
            const f = fixture(implementation, options);
            const result = await story(f);
            observed.push(
                detached({
                    result,
                    bytes: [...f.bytes],
                    trace: f.trace,
                    warnings: f.warnings,
                })
            );
        }
        assert.deepEqual(observed[1], observed[0], `Native parity: ${name}`);
        checks++;
    };
    for (const locks of ['absent', 'none', 'present']) {
        await check(
            `legacy rich upgrade/${locks}`,
            async (f) => {
                const a = f.actor('writer_A');
                assert.deepEqual(f.trace, []);
                assert.equal(f.key, 'form-progress-synthetic / share');
                const record = rich();
                f.bytes.set(f.key, JSON.stringify(record));
                assert.deepEqual(detached(a.read()), {
                    record,
                    revision: 0,
                    writerId: null,
                });
                assert.deepEqual(
                    detached(await a.write({ expectedRevision: 0, record })),
                    { status: 'written', revision: 1 }
                );
                assert.equal(
                    f.bytes.get(f.key),
                    envelope(1, 'writer_A', record)
                );
                const read = a.read();
                read.record.fld_hidden = 'detached edit';
                assert.equal(a.read().record.fld_hidden, 'keep while hidden');
                return detached(await a.removeIfOwned());
            },
            { locks }
        );
        await check(
            `writer/revision/cleanup/${locks}`,
            async (f) => {
                const a = f.actor('A'),
                    b = f.actor('B');
                assert.deepEqual(
                    detached(
                        await a.write({ expectedRevision: null, record: {} })
                    ),
                    { status: 'written', revision: 1 }
                );
                assert.equal(
                    (await b.write({ expectedRevision: null, record: {} }))
                        .status,
                    'conflict'
                );
                // Native writes compare revision only, not current writer identity.
                assert.deepEqual(
                    detached(
                        await b.write({ expectedRevision: 1, record: rich() })
                    ),
                    { status: 'written', revision: 2 }
                );
                assert.equal(
                    (await a.removeIfOwned()).status,
                    'preserved-newer-progress'
                );
                assert.equal(
                    (await a.write({ expectedRevision: 1, record: {} })).status,
                    'conflict'
                );
                assert.equal(
                    (await a.write({ expectedRevision: 2, record: {} })).status,
                    'written'
                );
                assert.equal(
                    (await a.write({ expectedRevision: 3, record: rich() }))
                        .status,
                    'written'
                );
                // No captured-revision fence: newer data from this same writer is removed.
                assert.equal((await a.removeIfOwned()).status, 'removed');
                assert.equal(f.bytes.size, 0);
                f.bytes.set(f.key, envelope(9, 'B', rich()));
                const lockCount = f.trace.filter(
                    ([op]) => op === 'lock'
                ).length;
                assert.equal(a.remove(), true); // Discard is unconditional, including B's data.
                assert.equal(
                    f.trace.filter(([op]) => op === 'lock').length,
                    lockCount
                );
            },
            { locks }
        );
    }
    for (const stored of [
        '{',
        'null',
        '[]',
        '1',
        'true',
        '"text"',
        envelope(0, 'A'),
        envelope(-1, 'A'),
        envelope(1.5, 'A'),
        envelope(1, ''),
        ...[
            { revision: '1' },
            { revision: null },
            { writerId: 1 },
            { writerId: ['A'] },
            { writerId: null },
            { record: null },
            { record: 'text' },
            { schemaVersion: '1' },
        ].map((patch) =>
            JSON.stringify({ ...JSON.parse(envelope(1, 'A')), ...patch })
        ),
        JSON.stringify({
            kind,
            schemaVersion: 2,
            revision: 1,
            writerId: 'A',
            record: {},
        }),
        JSON.stringify({
            kind,
            schemaVersion: 1,
            revision: 1,
            writerId: 'A',
            record: [],
        }),
    ]) {
        await check(`malformed/${stored}`, async (f) => {
            f.bytes.set(f.key, stored);
            const a = f.actor('A');
            assert.equal(f.parse(stored), undefined);
            assert.deepEqual(f.trace, []);
            assert.equal(a.read(), undefined);
            assert.equal(f.bytes.has(f.key), false);
            assert.equal(f.warnings.length, 0);
            assert.equal(
                (await a.write({ expectedRevision: null, record: {} })).status,
                'written'
            );
        });
    }
    await check('native JSON normalization remains permissive', async (f) => {
        const a = f.actor('A');
        const record = {
            date: new Date('2026-01-01T00:00:00Z'),
            omitted: undefined,
            nan: NaN,
            infinite: Infinity,
            array: [undefined, NaN],
        };
        assert.equal(
            (await a.write({ expectedRevision: null, record })).status,
            'written'
        );
        assert.deepEqual(detached(a.read().record), {
            date: '2026-01-01T00:00:00.000Z',
            nan: null,
            infinite: null,
            array: [null, null],
        });
    });
    await check('legacy shape is not scalar schema validation', async (f) => {
        for (const record of [
            {},
            {
                kind: 'another-kind',
                schemaVersion: 999,
                nested: { values: [1, null, {}] },
            },
            rich(),
        ]) {
            const raw = JSON.stringify(record);
            assert.deepEqual(detached(f.parse(raw)), {
                record,
                revision: 0,
                writerId: null,
            });
        }
        const large = Number.MAX_SAFE_INTEGER + 1;
        assert.equal(f.parse(envelope(large, 'A')).revision, large); // integer, not safe-integer validation
        assert.equal(f.parse(null), undefined);
    });
    await check('storage-event projection leaves latch native', async (f) => {
        const events = [
            [f.key, null, true],
            [f.key, envelope(2, 'B', rich()), true],
            [f.key, envelope(2, 'A', rich()), false],
            [f.key, JSON.stringify(rich()), true],
            [f.key, '{', false],
            ['other-key', envelope(2, 'B'), false],
        ];
        const observations = [];
        for (const [key, newValue, expected] of events) {
            const replacement = f.parse(newValue);
            // Exact data predicate used by useFormProgress; no listener/latch in SDK.
            const conflict =
                key === f.key &&
                (newValue == null ||
                    (replacement != null && replacement.writerId !== 'A'));
            assert.equal(conflict, expected);
            observations.push({ replacement, conflict });
        }
        assert.deepEqual(f.trace, []);
        return observations;
    });
    await check(
        'cooperating locked writers and late record evaluation',
        async (f) => {
            const release = f.hold(),
                record = rich();
            const first = f
                .actor('A')
                .write({ expectedRevision: null, record });
            const second = f
                .actor('B')
                .write({ expectedRevision: null, record: {} });
            assert.equal(f.bytes.size, 0);
            record.fld_hidden = 'changed before lock callback';
            release();
            assert.equal((await first).status, 'written');
            assert.equal((await second).status, 'conflict');
            assert.equal(
                f.actor('A').read().record.fld_hidden,
                record.fld_hidden
            );
            assert(
                f.trace.some(
                    ([op, name]) =>
                        op === 'lock' &&
                        name === 'form-progress-lock-synthetic / share'
                )
            );
        },
        { locks: 'present' }
    );
    await check(
        'no-lock critical section remains synchronous and non-atomic',
        async (f) => {
            const a = f.actor('A');
            const first = a.write({ expectedRevision: null, record: {} });
            assert.equal(f.bytes.has(f.key), true);
            await first;
            f.afterRead(() => f.bytes.set(f.key, envelope(99, 'B', rich())));
            assert.equal(
                (await a.write({ expectedRevision: 1, record: {} })).status,
                'written'
            );
            assert.equal(f.bytes.get(f.key), envelope(2, 'A')); // no extra cross-tab CAS added
        }
    );
    for (const operation of ['read', 'write', 'remove', 'removeIfOwned']) {
        for (const fault of [
            'provider',
            'read',
            'write',
            'remove',
            'lock',
            'lockProvider',
        ]) {
            await check(
                `${operation}/${fault}`,
                async (f) => {
                    f.bytes.set(f.key, envelope(1, 'A', rich()));
                    f.faults[fault] = true;
                    const a = f.actor('A');
                    try {
                        return detached(
                            await (operation === 'write'
                                ? a.write({
                                      expectedRevision: 1,
                                      record: rich(),
                                  })
                                : a[operation]())
                        );
                    } catch (error) {
                        return { rejected: true, message: error.message };
                    }
                },
                { locks: 'present' }
            );
        }
    }
    await check(
        'unavailable read still permits native unconditional cleanup',
        async (f) => {
            f.bytes.set(f.key, envelope(1, 'B', rich()));
            f.faults.read = true;
            assert.equal(
                (await f.actor('A').removeIfOwned()).status,
                'removed'
            );
            assert.equal(f.bytes.size, 0);
        }
    );
    await check(
        'malformed cleanup failure does not invent write denial',
        async (f) => {
            f.bytes.set(f.key, '{');
            f.faults.remove = true;
            assert.equal(
                (
                    await f
                        .actor('A')
                        .write({ expectedRevision: null, record: {} })
                ).status,
                'written'
            );
            assert.equal(f.bytes.get(f.key), envelope(1, 'A'));
        }
    );
    await check('absent and legacy cleanup', async (f) => {
        const a = f.actor('A');
        assert.equal(a.read(), undefined);
        assert.equal((await a.removeIfOwned()).status, 'removed');
        f.bytes.set(f.key, JSON.stringify(rich()));
        assert.equal((await a.removeIfOwned()).status, 'removed');
    });
    await check('native serialization and quota failures', async (f) => {
        const a = f.actor('A');
        for (const record of [{ circular: null }, { big: 1n }]) {
            if ('circular' in record) record.circular = record;
            assert.equal(
                (await a.write({ expectedRevision: null, record })).status,
                'unavailable'
            );
            assert.equal(f.bytes.size, 0);
        }
        f.faults.write = true;
        assert.equal(
            (await a.write({ expectedRevision: null, record: rich() })).status,
            'unavailable'
        );
    });
    for (const shareId of ['', ' ', 'x/%?雪']) {
        await check(
            'native literal key/' + shareId,
            async (f) => {
                assert.equal(f.key, 'form-progress-' + shareId);
                assert.equal(
                    (
                        await f
                            .actor('')
                            .write({ expectedRevision: null, record: {} })
                    ).status,
                    'written'
                );
                assert.equal(f.actor('').read(), undefined); // native accepts empty writer on write, then cleans invalid envelope
            },
            { shareId }
        );
    }
    return checks;
}

export const nativeFormProgressTypedConsumer = `
import {createNativeFormProgressStorage,makeNativeFormProgressKey,parseNativeFormProgressValue,type NativeFormProgressStorageOptions,type NativeFormProgressStorage,type NativeFormProgressSnapshot,type NativeFormProgressWriteResult,type NativeFormProgressRemovalResult,type NativeFormProgressStorageAdapter,type NativeFormProgressLockManager} from '@miniextensions/sdk/forms';
const nativeAdapter:NativeFormProgressStorageAdapter={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const nativeLocks:NativeFormProgressLockManager={request:async <R,>(_name:string,cb:()=>R):Promise<R>=>cb()};
const nativeOptions:NativeFormProgressStorageOptions={shareId:'synthetic',writerId:'writer',getStorage:()=>nativeAdapter,getLocks:()=>nativeLocks};
const nativeProgress:NativeFormProgressStorage=createNativeFormProgressStorage(nativeOptions);
const nativeSnapshot:NativeFormProgressSnapshot|undefined=nativeProgress.read();
const nativeWrite:Promise<NativeFormProgressWriteResult>=nativeProgress.write({expectedRevision:null,record:{links:['rec_one'],hidden:'preserved',attachment:[{id:'att_one',url:'https://synthetic.invalid',filename:'file'}]}});
const nativeRemove:boolean=nativeProgress.remove();
const nativeCleanup:Promise<NativeFormProgressRemovalResult>=nativeProgress.removeIfOwned();
createNativeFormProgressStorage({...nativeOptions,getLocks:undefined});
createNativeFormProgressStorage({...nativeOptions,getLocks:()=>undefined});
const nativeBrowserPorts:NativeFormProgressStorageOptions={shareId:'x',writerId:'w',getStorage:()=>localStorage,getLocks:()=>navigator.locks};
void [nativeSnapshot,nativeWrite,nativeRemove,nativeCleanup,nativeBrowserPorts,makeNativeFormProgressKey('x'),parseNativeFormProgressValue(null)];
// @ts-expect-error revision expectation must be explicit
nativeProgress.write({record:{}});
// @ts-expect-error writer identity belongs to the injected host
createNativeFormProgressStorage({shareId:'x',getStorage:()=>nativeAdapter});
`;

export async function checkNativeFormProgressConsumer({ consumerDirectory }) {
    const require = createRequire(join(consumerDirectory, 'package.json'));
    const loader = join(consumerDirectory, 'native-progress-exports.mjs');
    writeFileSync(
        loader,
        "export * from '@miniextensions/sdk/forms';\nexport const resolved=import.meta.resolve('@miniextensions/sdk/forms');\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const installed = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk'
    );
    assert.equal(
        realpathSync(fileURLToPath(esm.resolved)),
        realpathSync(join(installed, 'dist/esm/forms/index.js'))
    );
    assert.equal(
        realpathSync(require.resolve('@miniextensions/sdk/forms')),
        realpathSync(join(installed, 'dist/cjs/forms/index.js'))
    );
    for (const [format, api] of [
        ['ESM', esm],
        ['CJS', require('@miniextensions/sdk/forms')],
    ]) {
        const checks = await assertNativeFormProgressParity(api);
        assert(checks > 0);
        console.log(
            `Installed native Form progress ${format}: ${checks} pinned-native parity sequences passed; synthetic storage/locks only, no host latch/Restore/Save integration.`
        );
    }
    return 2;
}
