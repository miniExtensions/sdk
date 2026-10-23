import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform } from 'esbuild';

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
};

// Synthetic native owner only. No SDK client, accepted Form or second draft.
function fixture(mount) {
    let generation = 1;
    let revision = 0;
    let draftOwner = generation;
    let draft = { title: 'Native draft' };
    let stamp = 1;
    const listeners = new Set();
    const calls = { accepts: 0, allocations: 0, queries: 0, publications: 0 };
    const page = { records: [{ id: 'rec_child' }], metadata: {} };
    const selected = {
        nativeValue: ['rec_child', 'rec_child', 'rec_missing'],
        rows: [{ recordId: 'rec_child', data: page.records[0] }],
        unresolved: [{ nativeIndex: 2, recordId: 'rec_missing' }],
    };
    const host = {
        load: async () => page,
        query: async () => page,
        hydrate: async () => page,
        schedule: (allocate) => allocate(),
        allocate: async () => page,
        onPublish: () => {},
    };
    const form = mount({
        linked: {
            source: 'host-native',
            fieldId: 'fld_children',
            linkedTableId: 'tbl_children',
            capture: () => ({ stamp, readable: true }),
            isCurrent: (captured) => captured === stamp,
            selected: () => selected,
            query: (_stamp, request) => {
                calls.queries++;
                return host.query(request);
            },
            hydrateSelected: (_stamp, signal) => host.hydrate(signal),
            publishIfCurrent: (captured, _kind, result) => {
                if (captured !== stamp) return false;
                assert.equal(result, page);
                calls.publications++;
                host.onPublish();
                return true;
            },
            subscribe: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
        },
        child: {
            readScope: () => ({
                source: ['native-parent', generation],
                draft: [draft, revision],
            }),
            load: (signal) => host.load(signal),
            accept: (result, current) => {
                calls.accepts++;
                assert.equal(result, page);
                if (draftOwner !== generation || !current()) return false;
                return true;
            },
            atSaveAllocation: (allocate) => host.schedule(allocate),
            allocateSave: () => {
                calls.allocations++;
                return host.allocate();
            },
        },
    });
    return {
        form,
        host,
        calls,
        page,
        selected,
        listeners,
        get draft() {
            return draft;
        },
        replace() {
            generation++;
            stamp++;
            for (const listener of listeners) listener();
        },
        edit() {
            revision++;
        },
        recover() {
            // Explicit host discard/reopen, never an automatic recipe action.
            draft = { title: 'Explicitly reopened native draft' };
            revision++;
            draftOwner = generation;
        },
        publishRevision() {
            stamp++;
            for (const listener of listeners) listener();
        },
        accept: () => form.loadChild(new AbortController().signal),
    };
}

/** Execute the exact installed documentation fence in both module formats. */
export async function checkBorrowedNativeFormRecipe({
    consumerDirectory,
    guideSources,
}) {
    const root = realpathSync(consumerDirectory);
    const installed = realpathSync(
        join(root, 'node_modules/@miniextensions/sdk')
    );
    const require = createRequire(join(root, 'package.json'));
    for (const entry of ['forms', 'ui']) {
        assert(
            realpathSync(
                require.resolve(`@miniextensions/sdk/${entry}`)
            ).startsWith(`${installed}/dist/cjs/`)
        );
    }
    const matches = guideSources
        .map((source) => resolve(root, source))
        .filter((source) => {
            assert.equal(dirname(source), root);
            return readFileSync(source, 'utf8').includes(
                'export function attachBorrowedNativeForm<'
            );
        });
    assert.equal(
        matches.length,
        1,
        'Missing unique shipped borrowed Form recipe'
    );
    const source = readFileSync(matches[0], 'utf8');
    let checks = 0;
    for (const format of ['esm', 'cjs']) {
        const provenance =
            format === 'esm'
                ? "export const recipeUrls = ['forms', 'ui'].map(entry => import.meta.resolve('@miniextensions/sdk/' + entry));"
                : "module.exports.recipeUrls = ['forms', 'ui'].map(entry => require.resolve('@miniextensions/sdk/' + entry));";
        const { code } = await transform(source, {
            loader: 'ts',
            format,
            target: 'es2022',
        });
        const compiled = join(
            root,
            `borrowed-native-form-recipe.${format === 'esm' ? 'mjs' : 'cjs'}`
        );
        writeFileSync(compiled, `${code}\n${provenance}\n`);
        // No bundle or aliases: imports resolve beside the installed archive.
        const api =
            format === 'esm'
                ? await import(pathToFileURL(compiled).href)
                : require(compiled);
        for (const url of api.recipeUrls) {
            assert(
                realpathSync(
                    format === 'esm' ? fileURLToPath(url) : url
                ).startsWith(`${installed}/dist/${format}/`)
            );
        }
        const check = async (name, run) => {
            const f = fixture(api.attachBorrowedNativeForm);
            try {
                await run(f);
                checks++;
                console.log(
                    `Borrowed native Form recipe ${format}: ${name} passed`
                );
            } finally {
                f.form.destroy();
                assert.equal(f.listeners.size, 0);
            }
        };
        await check(
            'native selection and published-page identities',
            async (f) => {
                const lease = f.form.linked.capture();
                assert.equal(lease.selected(), f.selected);
                const filter = {};
                f.host.query = async (request) => {
                    assert.equal(request.filter, filter);
                    return f.page;
                };
                f.host.onPublish = () => f.publishRevision();
                const result = await lease.query({ filter, offset: null });
                assert.equal(result.status, 'published');
                assert.equal(result.page, f.page);
                assert.equal(lease.isCurrent(), false);
                assert.equal(f.calls.accepts, 0);
                assert.deepEqual(await f.form.save(), { type: 'retired' });
                assert.equal(f.calls.allocations, 0);
                const hydration = await f.form.linked
                    .capture()
                    .hydrateSelected();
                assert.equal(hydration.page, f.page);
            }
        );
        await check(
            'retired read cannot publish or clear native selection',
            async (f) => {
                const pending = deferred();
                f.host.query = () => pending.promise;
                const lease = f.form.linked.capture();
                const result = lease.query({ filter: {}, offset: null });
                await Promise.resolve();
                assert.equal(f.calls.queries, 1);
                f.replace();
                pending.resolve(f.page);
                assert.deepEqual(await result, { status: 'retired' });
                assert.equal(f.calls.publications, 0);
                assert.equal(f.selected.nativeValue.length, 3);
            }
        );
        await check(
            'child acceptance, edited presentation and explicit Save',
            async (f) => {
                assert.deepEqual(await f.form.save(), { type: 'retired' });
                const read = await f.accept();
                assert.equal(read.type, 'accepted');
                assert.equal(read.page, f.page);
                f.edit();
                assert.equal(read.canPresent(), true);
                const saved = await f.form.save();
                assert.equal(saved.type, 'settled');
                assert.equal(saved.value, f.page);
                assert.equal(f.calls.allocations, 1);
                f.replace();
                assert.equal(read.canPresent(), false);
            }
        );
        await check(
            'child replacement and cancellation refuse acceptance',
            async (f) => {
                const pending = deferred();
                f.host.load = () => pending.promise;
                const read = f.accept();
                f.replace();
                pending.resolve(f.page);
                assert.deepEqual(await read, { type: 'retired' });
                assert.equal(f.calls.accepts, 0);
                f.recover();
                const abort = new AbortController();
                const canceled = f.form.loadChild(abort.signal);
                abort.abort();
                assert.deepEqual(await canceled, { type: 'retired' });
                assert.equal(f.calls.accepts, 0);
            }
        );
        await check(
            'dirty A preservation never admits B Save; explicit recovery',
            async (f) => {
                await f.accept();
                f.edit();
                const draft = f.draft;
                f.replace();
                assert.deepEqual(await f.accept(), { type: 'retired' });
                assert.equal(f.draft, draft);
                assert.deepEqual(await f.form.save(), { type: 'retired' });
                assert.equal(f.calls.allocations, 0);
                f.recover();
                assert.equal((await f.accept()).type, 'accepted');
                assert.equal((await f.form.save()).value, f.page);
            }
        );
        for (const wait of ['pending Compute', 'active Save']) {
            for (const change of ['replacement/ABA', 'edit', 'disposal']) {
                await check(
                    `${wait} queued intent refuses ${change}`,
                    async (f) => {
                        await f.accept();
                        const ready = deferred();
                        f.host.schedule = async (allocate) => {
                            await ready.promise;
                            return allocate();
                        };
                        const pending = f.form.save();
                        assert.equal(f.calls.allocations, 0);
                        if (change === 'edit') f.edit();
                        else if (change === 'disposal') f.form.destroy();
                        else {
                            f.replace();
                            f.replace();
                        }
                        ready.resolve();
                        assert.deepEqual(await pending, { type: 'retired' });
                        assert.equal(f.calls.allocations, 0);
                    }
                );
            }
        }
        for (const reject of [false, true]) {
            await check(
                `allocated ${reject ? 'error' : 'result'} identity survives retirement`,
                async (f) => {
                    await f.accept();
                    const native = deferred();
                    f.host.allocate = () => native.promise;
                    const pending = f.form.save();
                    assert.equal(f.calls.allocations, 1);
                    f.replace();
                    f.form.destroy();
                    const outcome = reject
                        ? new Error('Native Save failure')
                        : {};
                    if (reject) {
                        native.reject(outcome);
                        await assert.rejects(
                            pending,
                            (error) => error === outcome
                        );
                    } else {
                        native.resolve(outcome);
                        assert.equal((await pending).value, outcome);
                    }
                    assert.equal(f.calls.allocations, 1);
                }
            );
        }
        await check(
            'native read and scheduling errors retain identity',
            async (f) => {
                const error = new Error('Native failure');
                f.host.load = async () => {
                    throw error;
                };
                await assert.rejects(f.accept(), (cause) => cause === error);
                f.host.query = async () => {
                    throw error;
                };
                await assert.rejects(
                    f.form.linked.capture().query({ filter: {}, offset: null }),
                    (cause) => cause === error
                );
                f.host.load = async () => f.page;
                await f.accept();
                f.host.schedule = async () => {
                    throw error;
                };
                await assert.rejects(f.form.save(), (cause) => cause === error);
                assert.equal(f.calls.allocations, 0);
            }
        );
    }
    return { checks };
}
