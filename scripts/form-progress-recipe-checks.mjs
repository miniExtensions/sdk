import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const held = () => {
    let release;
    const promise = new Promise((resolve) => {
        release = resolve;
    });
    return { promise, release };
};

export async function assertRootProgressActions(
    createRootProgressActions,
    createStorage
) {
    function fixture() {
        const bytes = new Map();
        const calls = {
            reads: 0,
            writes: 0,
            removes: 0,
            loads: 0,
            accepts: 0,
            discards: 0,
        };
        let ids = 0;
        let lockGate;
        let loadGate;
        let failRead = false;
        let failRemove = false;
        let failLock = false;
        let failLoad = false;
        let accepted = true;
        let afterRemove;
        let draft = { title: 'current draft' };
        const owner = { visitor: 'A' };
        const configuration = {};
        const state = {
            owner,
            configuration,
            revision: 0,
            kind: 'root-create',
            eligible: true,
            pristine: true,
        };
        const storage = {
            scope: 'synthetic-root-recipe',
            createId: () => `synthetic-${++ids}`,
            getStorage: () => ({
                getItem(key) {
                    calls.reads++;
                    if (failRead) throw Error('synthetic read failure');
                    return bytes.get(key) ?? null;
                },
                setItem(key, value) {
                    calls.writes++;
                    bytes.set(key, value);
                },
                removeItem(key) {
                    calls.removes++;
                    if (failRemove) throw Error('synthetic removal failure');
                    bytes.delete(key);
                    afterRemove?.();
                },
            }),
            getLocks: () => ({
                async request(_name, callback) {
                    if (lockGate) await lockGate.promise;
                    if (failLock) throw Error('synthetic lock failure');
                    return callback();
                },
            }),
        };
        const page = {
            extensionScreen: 'form_loaded',
            syntheticServerValues: { title: 'server canonical value' },
        };
        const actions = createRootProgressActions({
            owner,
            configuration,
            storage,
            state: () => state,
            select: (values) => ({ title: values.title }),
            async load(values) {
                calls.loads++;
                assert.deepEqual(values, { title: 'remembered value' });
                if (loadGate) await loadGate.promise;
                if (failLoad) throw Error('synthetic read rejection');
                return page;
            },
            accepts: (result) => accepted && result === page,
            accept(result, current) {
                if (!current()) return false;
                calls.accepts++;
                assert.equal(result, page);
                draft = result.syntheticServerValues;
                return true;
            },
            discard(current) {
                if (!current()) return false;
                calls.discards++;
                draft = { title: 'loaded draft' };
                return true;
            },
        });
        assert.deepEqual(Object.values(calls), Array(6).fill(0));
        assert.equal(bytes.size, 0);
        const writer = createStorage({ ...storage, isCurrent: () => true });
        return {
            actions,
            state,
            calls,
            bytes,
            writer,
            page,
            draft: () => draft,
            set: (patch) => {
                if ('lockGate' in patch) lockGate = patch.lockGate;
                if ('loadGate' in patch) loadGate = patch.loadGate;
                if ('failRead' in patch) failRead = patch.failRead;
                if ('failRemove' in patch) failRemove = patch.failRemove;
                if ('failLock' in patch) failLock = patch.failLock;
                if ('failLoad' in patch) failLoad = patch.failLoad;
                if ('accepted' in patch) accepted = patch.accepted;
                if ('afterRemove' in patch) afterRemove = patch.afterRemove;
            },
            async seed() {
                const result = await writer.write({
                    expected: null,
                    values: {
                        title: 'remembered value',
                        excluded: 'not selected',
                    },
                });
                assert.equal(result.status, 'written');
                return result.snapshot;
            },
        };
    }

    const restored = fixture();
    await restored.seed();
    assert.equal(await restored.actions.restore(), true);
    assert.equal(restored.draft(), restored.page.syntheticServerValues);
    assert.equal(restored.bytes.size, 0);
    assert.equal(restored.calls.loads, 1);
    assert.equal(restored.calls.accepts, 1);
    assert.equal(restored.calls.writes, 1); // seed only; no implicit write or Save

    for (const present of [false, true]) {
        const f = fixture();
        if (present) await f.seed();
        f.state.pristine = false;
        assert.equal(await f.actions.discard(), true);
        assert.equal(f.calls.loads, 0);
        assert.equal(f.calls.discards, 1);
        assert.equal(f.bytes.size, 0);
    }
    const absent = fixture();
    assert.equal(await absent.actions.restore(), false);
    assert.equal(absent.calls.loads + absent.calls.accepts, 0);

    for (const kind of ['root-edit', 'child-create', 'child-edit']) {
        for (const operation of ['restore', 'discard']) {
            const f = fixture();
            await f.seed();
            f.state.kind = kind;
            const before = { ...f.calls };
            assert.equal(await f.actions[operation](), false);
            assert.deepEqual(f.calls, before); // presentation/admission does no progress I/O
            assert.equal(f.bytes.size, 1);
        }
    }
    for (const patch of [
        { pristine: false },
        { eligible: false },
        { owner: {} },
        { configuration: {} },
    ]) {
        const f = fixture();
        await f.seed();
        Object.assign(f.state, patch);
        const before = { ...f.calls };
        assert.equal(await f.actions.restore(), false);
        assert.deepEqual(f.calls, before);
    }

    const changes = [
        (s) => {
            s.owner = {};
        },
        (s) => {
            s.revision += 2;
        }, // includes equal-value and edit-away-and-back intent
        (s) => {
            s.owner = { visitor: 'B' };
            s.owner = { visitor: 'A' };
        }, // observed A/B/A epoch never reused
        (s) => {
            s.configuration = {};
        },
        (s) => {
            s.configuration = { version: 'B' };
            s.configuration = { version: 'A' };
        },
        (s) => {
            s.eligible = false;
        },
        (s) => {
            s.kind = 'child-create';
        },
        (s) => {
            s.kind = 'child-edit';
        },
    ];
    for (const stage of ['load', 'cleanup']) {
        for (const operation of stage === 'load'
            ? ['restore']
            : ['restore', 'discard']) {
            for (const change of changes) {
                const f = fixture();
                await f.seed();
                const gate = held();
                f.set(
                    stage === 'load' ? { loadGate: gate } : { lockGate: gate }
                );
                const pending = f.actions[operation]();
                // load has entered synchronously; its resolved continuation reaches cleanup.
                await Promise.resolve();
                change(f.state);
                const before = [...f.bytes];
                gate.release();
                assert.equal(await pending, false);
                assert.deepEqual([...f.bytes], before);
                assert.deepEqual(f.draft(), { title: 'current draft' });
                assert.equal(
                    f.calls.accepts + f.calls.discards + f.calls.removes,
                    0
                );
            }
        }
    }

    for (const operation of ['restore', 'discard']) {
        for (const failure of ['failRead', 'failRemove', 'failLock']) {
            const f = fixture();
            await f.seed();
            f.set({ [failure]: true });
            const before = [...f.bytes];
            assert.equal(await f.actions[operation](), false);
            assert.deepEqual([...f.bytes], before);
            assert.deepEqual(f.draft(), { title: 'current draft' });
            assert.equal(f.calls.accepts + f.calls.discards, 0);
        }
        const f = fixture();
        const first = await f.seed();
        const gate = held();
        f.set({ lockGate: gate });
        const pending = f.actions[operation]();
        await Promise.resolve();
        // A cooperating successor writes before the captured removal acquires its lock.
        f.set({ lockGate: undefined });
        const next = await f.writer.write({
            expected: first.token,
            values: { title: 'successor' },
        });
        assert.equal(next.status, 'written');
        const before = [...f.bytes];
        gate.release();
        assert.equal(await pending, false);
        assert.deepEqual([...f.bytes], before);
        assert.deepEqual(f.draft(), { title: 'current draft' });
        assert.equal(f.calls.accepts + f.calls.discards, 0);
    }
    for (const patch of [{ failLoad: true }, { accepted: false }]) {
        const f = fixture();
        await f.seed();
        f.set(patch);
        assert.equal(await f.actions.restore(), false);
        assert.equal(f.bytes.size, 1);
        assert.equal(f.calls.loads, 1); // no retry
        assert.equal(f.calls.accepts + f.calls.removes, 0);
    }
    for (const change of changes) {
        const f = fixture();
        await f.seed();
        f.set({ afterRemove: () => change(f.state) });
        assert.equal(await f.actions.restore(), false);
        assert.equal(f.bytes.size, 0); // cleanup succeeded; publication still refused
        assert.deepEqual(f.draft(), { title: 'current draft' });
        assert.equal(f.calls.accepts, 0);
    }
    const rechecked = fixture();
    await rechecked.seed();
    rechecked.set({ afterRemove: () => rechecked.set({ accepted: false }) });
    assert.equal(await rechecked.actions.restore(), false);
    assert.equal(rechecked.calls.accepts, 0);
    const single = fixture();
    await single.seed();
    const gate = held();
    single.set({ loadGate: gate });
    const flight = single.actions.restore();
    assert.equal(await single.actions.restore(), false);
    assert.equal(await single.actions.discard(), false);
    gate.release();
    assert.equal(await flight, true);
    assert.equal(single.calls.loads, 1);
}

/** Execute the exact installed guide fence; no browser or live backend. */
export async function checkFormProgressRecipe({
    consumerDirectory,
    guideSources,
    typescriptBin,
}) {
    const installed = join(
        consumerDirectory,
        'node_modules/@miniextensions/sdk'
    );
    const matches = guideSources.filter((name) =>
        readFileSync(join(consumerDirectory, name), 'utf8').includes(
            'export function createRootProgressActions('
        )
    );
    assert.equal(
        matches.length,
        1,
        'Missing unique installed root progress recipe'
    );
    const source = readFileSync(join(consumerDirectory, matches[0]), 'utf8');
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const [extension, module] of [
        ['mts', 'NodeNext'],
        ['cts', 'NodeNext'],
    ]) {
        const filename = `form-progress-recipe.${extension}`;
        writeFileSync(join(consumerDirectory, filename), source);
        execFileSync(
            process.execPath,
            [
                typescriptBin,
                '--strict',
                '--target',
                'ES2022',
                '--module',
                module,
                '--moduleResolution',
                'NodeNext',
                '--outDir',
                'progress-recipe-output',
                filename,
            ],
            { cwd: consumerDirectory, stdio: 'pipe' }
        );
        const path = join(
            consumerDirectory,
            'progress-recipe-output',
            `form-progress-recipe.${extension === 'mts' ? 'mjs' : 'cjs'}`
        );
        const recipe =
            extension === 'mts'
                ? await import(pathToFileURL(path).href)
                : require(path);
        const sdkPath =
            extension === 'mts'
                ? join(consumerDirectory, 'form-progress-recipe-sdk.mjs')
                : null;
        let sdk;
        if (sdkPath) {
            writeFileSync(
                sdkPath,
                "export * from '@miniextensions/sdk/forms';\nexport const resolved = import.meta.resolve('@miniextensions/sdk/forms');\n"
            );
            sdk = await import(pathToFileURL(sdkPath).href);
            assert.equal(
                realpathSync(fileURLToPath(sdk.resolved)),
                realpathSync(join(installed, 'dist/esm/forms/index.js'))
            );
        } else {
            assert.equal(
                realpathSync(require.resolve('@miniextensions/sdk/forms')),
                realpathSync(join(installed, 'dist/cjs/forms/index.js'))
            );
            sdk = require('@miniextensions/sdk/forms');
        }
        await assertRootProgressActions(
            recipe.createRootProgressActions,
            sdk.createFormProgressStorage
        );
        console.log(
            `Installed Form progress recipe ${extension === 'mts' ? 'ESM' : 'CommonJS'}: strict compile and synthetic root Restore/Discard ownership passed; child lifecycle remains with its existing owner.`
        );
    }
    return 2;
}
