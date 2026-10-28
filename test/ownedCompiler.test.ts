import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type { BuildOptions } from 'esbuild';
import {
    installCompilerSpawnFence,
    createOwnedCompiler,
    trackCompilerChild,
    assertCompilerSpawn,
    assertFreshEsbuild,
    type CompilerDriver,
    type SpawnSlot,
} from './ownedCompiler.js';

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeChild() {
    const events = new EventEmitter();
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    let references = 0;
    const child: ChildProcess = Object.assign(events, {
        stdout,
        stdin,
        ref() {
            references++;
            return child;
        },
    }) as unknown as ChildProcess;
    return {
        child,
        stdout,
        stdin,
        get references() {
            return references;
        },
        close(code: number | null = 0, signal: NodeJS.Signals | null = null) {
            events.emit('close', code, signal);
        },
        error(error: Error) {
            events.emit('error', error);
        },
        exit(code: number | null = 0, signal: NodeJS.Signals | null = null) {
            events.emit('exit', code, signal);
        },
    };
}

function fakeSpawnSlot() {
    const calls: unknown[][] = [];
    const children: ReturnType<typeof fakeChild>[] = [];
    const original = ((...args: unknown[]) => {
        calls.push(args);
        const fake = fakeChild();
        const command = args[0] as string;
        const spawnArgs = Array.isArray(args[1]) ? args[1] : [];
        Object.assign(fake.child, {
            spawnfile: command,
            spawnargs: [command, ...spawnArgs],
        });
        children.push(fake);
        return fake.child;
    }) as unknown as ReturnType<SpawnSlot['get']>;
    let current = original;
    const slot: SpawnSlot = {
        get: () => current,
        set: (next) => {
            current = next;
        },
    };
    return { slot, original, calls, children };
}

function settledState(promise: Promise<unknown>) {
    let settled = false;
    void promise.then(
        () => (settled = true),
        () => (settled = true)
    );
    return () => settled;
}

describe('owned compiler lifecycle', () => {
    it('fences compiler startup and forwards unrelated spawns unchanged', async () => {
        const fake = fakeSpawnSlot();
        const binary = '/trusted/esbuild';
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        const fence = installCompilerSpawnFence(
            binary,
            '/checkout',
            fake.slot,
            (path) => {
                assert.equal(path, binary);
                return path;
            }
        );
        const unrelatedArgs = ['--ordinary'];
        const unrelatedOptions: SpawnOptions = { cwd: '/different' };
        const unrelated = fake.slot.get()('other-command', unrelatedArgs, unrelatedOptions);
        assert.equal(unrelated, fake.children[0]!.child);
        assert.equal(fake.calls[0]![1], unrelatedArgs);
        assert.equal(fake.calls[0]![2], unrelatedOptions);
        const serviceArgs = ['--service=0.25.10', '--ping'];
        const service = fake.slot.get()(binary, serviceArgs, options);
        assert.equal(service, fake.children[1]!.child);
        assert.ok(fence.child());
        fence.finishStartup();
        const secondUnrelated = fake.slot.get()('other-command', unrelatedArgs, unrelatedOptions);
        assert.equal(secondUnrelated, fake.children[2]!.child);
        assert.equal(fake.calls[2]![1], unrelatedArgs);
        assert.equal(fake.calls[2]![2], unrelatedOptions);
        const redisArgs = ['--service=redis'];
        const redis = fake.slot.get()('other-command', redisArgs, unrelatedOptions);
        assert.equal(redis, fake.children[3]!.child);
        assert.equal(fake.calls[3]![1], redisArgs);
        assert.equal(fake.calls[3]![2], unrelatedOptions);
        assert.equal(fence.isAmbiguous(), false);
        fake.children[1]!.close(0);
        assert.equal((await fence.child()!.closed).code, 0);
        fence.restore();
        assert.equal(fake.slot.get(), fake.original);
    });

    it('rejects a duplicate service during startup without spawning it', async () => {
        const fake = fakeSpawnSlot();
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        const fence = installCompilerSpawnFence(
            '/trusted/esbuild',
            '/checkout',
            fake.slot,
            (path) => path
        );
        const args = ['--service=0.25.10', '--ping'];
        fake.slot.get()('/trusted/esbuild', args, options);
        assert.throws(() => fake.slot.get()('/trusted/esbuild', args, options));
        assert.equal(fake.calls.length, 1);
        assert.equal(fence.isAmbiguous(), true);
        fence.restore();
        assert.notEqual(fake.slot.get(), fake.original);
        fake.children[0]!.close(0);
        await turn();
        assert.equal(fake.slot.get(), fake.original);
    });

    it('forwards an unrelated numeric service during and after startup', async () => {
        const fake = fakeSpawnSlot();
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        const fence = installCompilerSpawnFence(
            '/trusted/esbuild', '/checkout', fake.slot, (path) => path
        );
        const otherArgs = ['--service=1.2.3', '--ping'];
        const startupOther = fake.slot.get()('other-server', otherArgs, options);
        assert.equal(startupOther, fake.children[0]!.child);
        assert.equal(fake.calls[0]![1], otherArgs);
        assert.equal(fake.calls[0]![2], options);
        assert.equal(fence.isAmbiguous(), false);
        fake.slot.get()('/trusted/esbuild', ['--service=0.25.10', '--ping'], options);
        fence.finishStartup();
        const laterOther = fake.slot.get()('other-server', otherArgs, options);
        assert.equal(laterOther, fake.children[2]!.child);
        assert.equal(fake.calls[2]![1], otherArgs);
        assert.equal(fake.calls[2]![2], options);
        assert.equal(fence.isAmbiguous(), false);
        fake.children[1]!.close(0);
        fence.restore();
        await turn();
        assert.equal(fake.slot.get(), fake.original);
    });

    it('fails closed on a mismatched esbuild service executable', () => {
        const fake = fakeSpawnSlot();
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        const fence = installCompilerSpawnFence(
            '/trusted/esbuild', '/checkout', fake.slot, (path) => path
        );
        assert.throws(() =>
            fake.slot.get()('/untrusted/esbuild', ['--service=1.2.3', '--ping'], options)
        );
        assert.equal(fake.calls.length, 0);
        assert.equal(fence.isAmbiguous(), true);
        fence.restore();
        assert.equal(fake.slot.get(), fake.original);
    });

    it('marks a mismatched esbuild service ambiguous after startup', async () => {
        const fake = fakeSpawnSlot();
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        const fence = installCompilerSpawnFence(
            '/trusted/esbuild', '/checkout', fake.slot, (path) => path
        );
        fake.slot.get()('/trusted/esbuild', ['--service=0.25.10', '--ping'], options);
        fence.finishStartup();
        const mismatchArgs = ['--service=1.2.3', '--ping'];
        const other = fake.slot.get()('/untrusted/esbuild', mismatchArgs, options);
        assert.equal(other, fake.children[1]!.child);
        assert.equal(fake.calls[1]![1], mismatchArgs);
        assert.equal(fake.calls[1]![2], options);
        assert.equal(fence.isAmbiguous(), true);
        fence.restore();
        fake.children[0]!.close(0);
        await turn();
        assert.notEqual(fake.slot.get(), fake.original);
        fake.children[1]!.close(0);
        await turn();
        assert.equal(fake.slot.get(), fake.original);
    });

    it('detects fence replacement and does not overwrite the replacement', () => {
        const fake = fakeSpawnSlot();
        const fence = installCompilerSpawnFence(
            '/trusted/esbuild',
            '/checkout',
            fake.slot,
            (path) => path
        );
        const replacement = (() => fakeChild().child) as unknown as ReturnType<SpawnSlot['get']>;
        fake.slot.set(replacement);
        assert.equal(fence.isAmbiguous(), true);
        fence.restore();
        assert.equal(fake.slot.get(), replacement);
    });

    it('does not stop if ref introduces ownership ambiguity', async () => {
        const fake = fakeChild();
        let ambiguous = false;
        const tracked = {
            ...trackCompilerChild(fake.child),
            ref: () => {
                ambiguous = true;
            },
        };
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({
                child: tracked,
                ready: Promise.resolve(),
                isAmbiguous: () => ambiguous,
            }),
            build: async () => {},
            stop: () => {
                stops++;
            },
        });
        await assert.rejects(compiler.build({ entryPoints: ['example.ts'] }));
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('does not stop if the child exits and closes during ref', async () => {
        const fake = fakeChild();
        const tracked = {
            ...trackCompilerChild(fake.child),
            ref: () => {
                fake.exit(1);
                fake.close(1);
            },
        };
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build: async () => {},
            stop: () => {
                stops++;
            },
        });
        await assert.rejects(compiler.build({ entryPoints: ['example.ts'] }));
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('keeps the fence until owned close, then restores the spawn slot', async () => {
        const fake = fakeSpawnSlot();
        const pending = deferred<unknown>();
        const args = ['--service=0.25.10', '--ping'];
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        let stops = 0;
        let fence: ReturnType<typeof installCompilerSpawnFence> | undefined;
        const compiler = createOwnedCompiler({
            start: () => {
                fence = installCompilerSpawnFence(
                    '/trusted/esbuild', '/checkout', fake.slot, (path) => path
                );
                fake.slot.get()('/trusted/esbuild', args, options);
                fence.finishStartup();
                return {
                    child: fence.child(),
                    ready: Promise.resolve(),
                    isAmbiguous: fence.isAmbiguous,
                    restore: fence.restore,
                };
            },
            build: () => pending.promise,
            stop: () => {
                stops++;
            },
        });
        const result = compiler.build({ entryPoints: ['example.ts'] });
        const settled = settledState(result);
        await turn();
        assert.notEqual(fake.slot.get(), fake.original);
        pending.resolve(undefined);
        await turn();
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.notEqual(fake.slot.get(), fake.original);
        assert.equal(compiler.canCleanup(), false);
        fake.children[0]!.close(0);
        await result;
        assert.equal(fake.slot.get(), fake.original);
        assert.equal(fence?.isAmbiguous(), false);
        assert.equal(compiler.canCleanup(), true);
    });

    it('fails closed if a foreign service restarts while a build is active', async () => {
        const fake = fakeSpawnSlot();
        const pending = deferred<unknown>();
        const args = ['--service=0.25.10', '--ping'];
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => {
                const fence = installCompilerSpawnFence(
                    '/trusted/esbuild', '/checkout', fake.slot, (path) => path
                );
                fake.slot.get()('/trusted/esbuild', args, options);
                fence.finishStartup();
                return {
                    child: fence.child(),
                    ready: Promise.resolve(),
                    isAmbiguous: fence.isAmbiguous,
                    restore: fence.restore,
                };
            },
            build: () => pending.promise,
            stop: () => {
                stops++;
            },
        });
        const result = compiler.build({ entryPoints: ['example.ts'] });
        void settledState(result);
        await turn();
        // Another service request is forwarded but its ownership is unknown.
        const foreign = fake.slot.get()('/trusted/esbuild', args, options);
        assert.equal(foreign, fake.children[1]!.child);
        assert.equal(fake.calls.length, 2);
        pending.resolve(undefined);
        await assert.rejects(result);
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
        assert.notEqual(fake.slot.get(), fake.original);
        fake.children[0]!.close(0);
        fake.children[1]!.close(0);
        await turn();
        assert.equal(fake.slot.get(), fake.original);
        assert.equal(compiler.canCleanup(), false);
    });

    it('does not stop or clean up after foreign stop and restart', async () => {
        const fake = fakeSpawnSlot();
        const pending = deferred<unknown>();
        const args = ['--service=0.25.10', '--ping'];
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => {
                const fence = installCompilerSpawnFence(
                    '/trusted/esbuild', '/checkout', fake.slot, (path) => path
                );
                fake.slot.get()('/trusted/esbuild', args, options);
                fence.finishStartup();
                return {
                    child: fence.child(),
                    ready: Promise.resolve(),
                    isAmbiguous: fence.isAmbiguous,
                    restore: fence.restore,
                };
            },
            build: () => pending.promise,
            stop: () => {
                stops++;
            },
        });
        const result = compiler.build({ entryPoints: ['example.ts'] });
        void settledState(result);
        await turn();
        fake.children[0]!.exit(1);
        fake.slot.get()('/trusted/esbuild', args, options);
        pending.resolve(undefined);
        await assert.rejects(result);
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
        fake.children[0]!.close(1);
        fake.children[1]!.close(0);
        await turn();
        assert.equal(compiler.canCleanup(), false);
        assert.equal(fake.slot.get(), fake.original);
    });

    it('keeps the fence after release until every observed service closes', async () => {
        const fake = fakeSpawnSlot();
        const args = ['--service=0.25.10', '--ping'];
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        const fence = installCompilerSpawnFence(
            '/trusted/esbuild', '/checkout', fake.slot, (path) => path
        );
        fake.slot.get()('/trusted/esbuild', args, options);
        fence.finishStartup();
        fake.slot.get()('/trusted/esbuild', args, options);
        fence.restore();
        assert.equal(fence.isAmbiguous(), true);
        assert.notEqual(fake.slot.get(), fake.original);
        fake.children[0]!.close(0);
        await turn();
        assert.notEqual(fake.slot.get(), fake.original);
        fake.children[1]!.close(0);
        await turn();
        assert.equal(fake.slot.get(), fake.original);
        assert.equal(fence.isAmbiguous(), true);
    });

    it('keeps the fence after an unconfirmed close until the child closes', async () => {
        const fake = fakeSpawnSlot();
        const failure = new Error('close not confirmed');
        const args = ['--service=0.25.10', '--ping'];
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        let stops = 0;
        const compiler = createOwnedCompiler(
            {
                start: () => {
                    const fence = installCompilerSpawnFence(
                        '/trusted/esbuild', '/checkout', fake.slot, (path) => path
                    );
                    fake.slot.get()('/trusted/esbuild', args, options);
                    fence.finishStartup();
                    return {
                        child: fence.child(),
                        ready: Promise.resolve(),
                        isAmbiguous: fence.isAmbiguous,
                        restore: fence.restore,
                    };
                },
                build: async () => {},
                stop: () => {
                    stops++;
                },
            },
            async () => {
                throw failure;
            }
        );
        await assert.rejects(
            compiler.build({ entryPoints: ['example.ts'] }),
            failure
        );
        assert.equal(stops, 1);
        assert.equal(compiler.canCleanup(), false);
        assert.notEqual(fake.slot.get(), fake.original);
        fake.children[0]!.close(0);
        await turn();
        assert.equal(fake.slot.get(), fake.original);
        assert.equal(compiler.canCleanup(), false);
    });

    for (const phase of ['before stop', 'after stop'] as const) {
        it(`fails closed when the spawn fence is replaced ${phase}`, async () => {
            const fake = fakeSpawnSlot();
            const pending = deferred<unknown>();
            const args = ['--service=0.25.10', '--ping'];
            const options: SpawnOptions = {
                cwd: '/checkout',
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'inherit'],
            };
            const replacement = (() => fakeChild().child) as unknown as ReturnType<SpawnSlot['get']>;
            let stops = 0;
            const compiler = createOwnedCompiler({
                start: () => {
                    const fence = installCompilerSpawnFence(
                        '/trusted/esbuild', '/checkout', fake.slot, (path) => path
                    );
                    fake.slot.get()('/trusted/esbuild', args, options);
                    fence.finishStartup();
                    return {
                        child: fence.child(),
                        ready: Promise.resolve(),
                        isAmbiguous: fence.isAmbiguous,
                        restore: fence.restore,
                    };
                },
                build: () => pending.promise,
                stop: () => {
                    stops++;
                },
            });
            const result = compiler.build({ entryPoints: ['example.ts'] });
            void settledState(result);
            await turn();
            if (phase === 'before stop') fake.slot.set(replacement);
            pending.resolve(undefined);
            await turn();
            assert.equal(stops, phase === 'before stop' ? 0 : 1);
            if (phase === 'after stop') fake.slot.set(replacement);
            fake.children[0]!.close(0);
            await assert.rejects(result);
            assert.equal(fake.slot.get(), replacement);
            assert.equal(compiler.canCleanup(), false);
        });
    }

    it('retains output when restoring the spawn slot fails after close', async () => {
        const fake = fakeSpawnSlot();
        const failure = new Error('restore failed');
        const slot: SpawnSlot = {
            get: fake.slot.get,
            set: (next) => {
                if (next === fake.original) throw failure;
                fake.slot.set(next);
            },
        };
        const args = ['--service=0.25.10', '--ping'];
        const options: SpawnOptions = {
            cwd: '/checkout',
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => {
                const fence = installCompilerSpawnFence(
                    '/trusted/esbuild', '/checkout', slot, (path) => path
                );
                slot.get()('/trusted/esbuild', args, options);
                fence.finishStartup();
                return {
                    child: fence.child(),
                    ready: Promise.resolve(),
                    isAmbiguous: fence.isAmbiguous,
                    restore: fence.restore,
                };
            },
            build: async () => {},
            stop: () => {
                stops++;
            },
        });
        const result = compiler.build({ entryPoints: ['example.ts'] });
        void settledState(result);
        await turn();
        assert.equal(stops, 1);
        fake.children[0]!.close(0);
        await assert.rejects(result, (error: unknown) => error === failure);
        assert.equal(compiler.canCleanup(), false);
    });

    it('reports distinct sibling, lifecycle, stop, terminal and restore failures together', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const first = deferred<unknown>();
        const sibling = deferred<unknown>();
        const buildFailure = new Error('first build failed');
        const processFailure = new Error('child failed');
        const streamFailure = new Error('stdin failed');
        const nestedFailure = new AggregateError([processFailure], 'sibling failed');
        const stopFailure = new Error('stop failed');
        const restoreFailure = new Error('restore failed');
        let builds = 0;
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({
                child: tracked,
                ready: Promise.resolve(),
                restore: () => { throw restoreFailure; },
            }),
            build: () => (++builds === 1 ? first.promise : sibling.promise),
            stop: () => {
                stops++;
                throw stopFailure;
            },
        });
        const result = compiler.buildAll([
            { entryPoints: ['first.ts'] },
            { entryPoints: ['second.ts'] },
        ]);
        const settled = settledState(result);
        await turn();
        first.reject(buildFailure);
        fake.error(processFailure);
        fake.stdin.emit('error', streamFailure);
        await turn();
        assert.equal(stops, 0);
        sibling.reject(nestedFailure);
        await turn();
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(1);
        await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            for (const original of [
                buildFailure, nestedFailure, processFailure, streamFailure,
                stopFailure, restoreFailure,
            ]) assert.ok(error.errors.includes(original));
            assert.deepEqual(nestedFailure.errors, [processFailure]);
            const terminalIndex = error.errors.findIndex((entry: unknown) =>
                entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
            );
            assert.ok(terminalIndex >= 0);
            assert.ok(error.errors.indexOf(streamFailure) < error.errors.indexOf(stopFailure));
            assert.ok(error.errors.indexOf(stopFailure) < terminalIndex);
            assert.ok(terminalIndex < error.errors.indexOf(restoreFailure));
            assert.equal(new Set(error.errors).size, error.errors.length);
            return true;
        });
        assert.equal(compiler.canCleanup(), false);
    });

    it('deduplicates the same failure object across builds, streams, stop and restore', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const pending = deferred<unknown>();
        const shared = new Error('shared failure');
        let builds = 0;
        const compiler = createOwnedCompiler({
            start: () => ({
                child: tracked,
                ready: Promise.resolve(),
                restore: () => { throw shared; },
            }),
            build: () => (++builds === 1 ? Promise.reject(shared) : pending.promise),
            stop: () => { throw shared; },
        });
        const result = compiler.buildAll([
            { entryPoints: ['first.ts'] },
            { entryPoints: ['second.ts'] },
        ]);
        void settledState(result);
        await turn();
        fake.error(shared);
        fake.stdin.emit('error', shared);
        fake.stdout.emit('error', shared);
        pending.reject(shared);
        await turn();
        fake.close(0);
        await assert.rejects(result, (error: unknown) => error === shared);
        assert.equal(compiler.canCleanup(), false);
    });

    it('reports unconfirmed close and restore failures without releasing output', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const closeFailure = new Error('close not confirmed');
        const restoreFailure = new Error('restore failed');
        const compiler = createOwnedCompiler(
            {
                start: () => ({
                    child: tracked,
                    ready: Promise.resolve(),
                    restore: () => { throw restoreFailure; },
                }),
                build: async () => {},
                stop: () => {},
            },
            async () => { throw closeFailure; }
        );
        await assert.rejects(compiler.build({ entryPoints: ['example.ts'] }), (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.deepEqual(error.errors, [closeFailure, restoreFailure]);
            return true;
        });
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('rejects a pre-existing esbuild module instead of claiming its service', () => {
        assert.doesNotThrow(() => assertFreshEsbuild(undefined));
        assert.throws(() => assertFreshEsbuild({ exports: {} }));
    });

    it('accepts only the expected first compiler spawn', () => {
        const binary = '/trusted/package/bin/esbuild';
        const cwd = '/checkout';
        const args = ['--service=0.25.10', '--ping'];
        const options: SpawnOptions = {
            cwd,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'inherit'],
        };
        const resolvePath = (path: string) => path;
        const check = (
            command: string,
            nextArgs: readonly string[] | undefined,
            nextOptions: SpawnOptions | undefined,
            alreadyTracked = false
        ) =>
            assertCompilerSpawn(
                command,
                nextArgs,
                nextOptions,
                binary,
                cwd,
                alreadyTracked,
                resolvePath
            );
        assert.doesNotThrow(() => check(binary, args, options));
        assert.throws(() => check(binary, args, options, true));
        assert.throws(() => check('/other/esbuild', args, options));
        assert.throws(() =>
            check(binary, ['--service=0.25.9', '--ping'], options)
        );
        assert.throws(() => check(binary, undefined, options));
        assert.throws(() => check(binary, args, { ...options, cwd: '/other' }));
        assert.throws(() => check(binary, args, { ...options, stdio: 'pipe' }));
        assert.throws(() => check(binary, args, undefined));
    });

    it('records an error but waits for close, not exit or stdout end', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const settled = settledState(tracked.closed);
        const failure = new Error('spawn failed');
        fake.error(failure);
        fake.exit(1);
        fake.stdout.emit('end');
        await turn();
        assert.equal(settled(), false);
        fake.close(1);
        assert.deepEqual(await tracked.closed, {
            code: 1,
            signal: null,
            error: failure,
        });
    });

    it('retains a close that arrives before a caller awaits it', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        fake.close(null, 'SIGTERM');
        const terminal = await tracked.closed;
        assert.equal(terminal.code, null);
        assert.equal(terminal.signal, 'SIGTERM');
        assert.equal(terminal.error, undefined);
    });

    for (const stream of ['stdin', 'stdout'] as const) {
        it(`records a ${stream} error without settling before close`, async () => {
            const fake = fakeChild();
            const tracked = trackCompilerChild(fake.child);
            const settled = settledState(tracked.closed);
            const failure = new Error(`${stream} failed`);
            fake[stream].emit('error', failure);
            fake.exit(1);
            await turn();
            assert.equal(settled(), false);
            fake.close(1);
            assert.deepEqual(await tracked.closed, {
                code: 1,
                signal: null,
                error: failure,
            });
        });
    }

    it('returns a successful build only after the stopped child closes', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const options: BuildOptions = {
            stdin: {
                contents: 'export const x = 1',
                loader: 'ts',
                resolveDir: '/example',
                sourcefile: 'owner.ts',
            },
            absWorkingDir: '/example',
            alias: { example: '/example/index.ts' },
            bundle: true,
            external: ['react'],
            outfile: '/example/out.mjs',
            platform: 'node',
            format: 'esm',
            logLevel: 'silent',
            plugins: [{ name: 'example', setup() {} }],
        };
        let received: BuildOptions | undefined;
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build: async (value) => {
                received = value;
            },
            stop: () => {
                stops++;
            },
        });
        const result = compiler.build(options);
        const settled = settledState(result);
        await turn();
        assert.equal(received, options);
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        // The helper's own stop may cause a signal exit.
        fake.exit(null, 'SIGTERM');
        await turn();
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(null, 'SIGTERM');
        await result;
        assert.equal(compiler.canCleanup(), true);
    });

    it('returns an asynchronous service action result after shutdown and close', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const action = deferred<{ value: string }>();
        const value = { value: 'result' };
        let builds = 0;
        let stops = 0;
        let actions = 0;
        const compiler = createOwnedCompiler({
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build: async () => {
                builds++;
            },
            stop: () => {
                stops++;
            },
        });
        const result = compiler.withService(() => {
            actions++;
            return action.promise;
        });
        const settled = settledState(result);
        await turn();
        assert.equal(actions, 1);
        assert.equal(builds, 0);
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
        action.resolve(value);
        await turn();
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
        assert.equal(await result, value);
        assert.equal(compiler.canCleanup(), true);
    });

    it('preserves an asynchronous service action failure after close', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const action = deferred<unknown>();
        const failure = new Error('action failed');
        let builds = 0;
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build: async () => {
                builds++;
            },
            stop: () => {
                stops++;
            },
        });
        const result = compiler.withService(() => action.promise);
        const settled = settledState(result);
        await turn();
        action.reject(failure);
        await turn();
        assert.equal(builds, 0);
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
        await assert.rejects(result, (error: unknown) => error === failure);
        assert.equal(compiler.canCleanup(), true);
    });

    it('requires each sequential build to close its own captured child', async () => {
        const first = fakeChild();
        const second = fakeChild();
        const children = [
            trackCompilerChild(first.child),
            trackCompilerChild(second.child),
        ];
        let starts = 0;
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({ child: children[starts++], ready: Promise.resolve() }),
            build: async () => {},
            stop: () => {
                stops++;
            },
        });
        const firstBuild = compiler.build({ entryPoints: ['first.ts'] });
        const firstSettled = settledState(firstBuild);
        await turn();
        assert.equal(starts, 1);
        assert.equal(stops, 1);
        assert.equal(firstSettled(), false);
        assert.equal(compiler.canCleanup(), false);
        first.close(0);
        await firstBuild;
        assert.equal(compiler.canCleanup(), true);

        const secondBuild = compiler.build({ entryPoints: ['second.ts'] });
        const secondSettled = settledState(secondBuild);
        await turn();
        assert.equal(starts, 2);
        assert.equal(stops, 2);
        assert.equal(secondSettled(), false);
        assert.equal(compiler.canCleanup(), false);
        second.close(0);
        await secondBuild;
        assert.equal(compiler.canCleanup(), true);
    });

    it('rejects overlapping groups without releasing active ownership', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const pending = deferred<unknown>();
        let starts = 0;
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => {
                starts++;
                return { child: tracked, ready: Promise.resolve() };
            },
            build: () => pending.promise,
            stop: () => {
                stops++;
            },
        });
        const firstBuild = compiler.build({ entryPoints: ['first.ts'] });
        const settled = settledState(firstBuild);
        await turn();
        await assert.rejects(
            compiler.buildAll([{ entryPoints: ['second.ts'] }])
        );
        assert.equal(starts, 1);
        assert.equal(stops, 0);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        pending.resolve(undefined);
        await turn();
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
        await firstBuild;
        assert.equal(compiler.canCleanup(), true);
    });

    for (const terminal of [
        { code: 1, signal: null },
        { code: null, signal: 'SIGKILL' as const },
    ]) {
        it(`reports abnormal close after shutdown: ${terminal.signal ?? terminal.code}`, async () => {
            const fake = fakeChild();
            const tracked = trackCompilerChild(fake.child);
            let stops = 0;
            const compiler = createOwnedCompiler({
                start: () => ({ child: tracked, ready: Promise.resolve() }),
                build: async () => {},
                stop: () => {
                    stops++;
                },
            });
            const result = compiler.build({ entryPoints: ['example.ts'] });
            const settled = settledState(result);
            await turn();
            assert.equal(stops, 1);
            assert.equal(settled(), false);
            fake.close(terminal.code, terminal.signal);
            await assert.rejects(result);
            assert.equal(compiler.canCleanup(), true);
        });

        it(`retains the first build failure after abnormal close: ${terminal.signal ?? terminal.code}`, async () => {
            const fake = fakeChild();
            const tracked = trackCompilerChild(fake.child);
            const failure = new Error('first build failed');
            const compiler = createOwnedCompiler({
                start: () => ({ child: tracked, ready: Promise.resolve() }),
                build: async () => {
                    throw failure;
                },
                stop: () => {},
            });
            const result = compiler.build({ entryPoints: ['example.ts'] });
            const settled = settledState(result);
            await turn();
            assert.equal(settled(), false);
            fake.close(terminal.code, terminal.signal);
            await assert.rejects(result, (error: unknown) => {
                assert.ok(error instanceof AggregateError);
                assert.ok(error.errors.includes(failure));
                assert.ok(error.errors.some((entry: unknown) =>
                    entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
                ));
                return true;
            });
            assert.equal(compiler.canCleanup(), true);
        });
    }

    it('retains output after exit before shutdown, even after close', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const pending = deferred<unknown>();
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build: () => pending.promise,
            stop: () => {
                stops++;
            },
        });
        const result = compiler.build({ entryPoints: ['example.ts'] });
        const settled = settledState(result);
        await turn();
        fake.exit(1);
        pending.resolve(undefined);
        await turn();
        assert.equal(stops, 0);
        assert.equal(settled(), true);
        assert.equal(compiler.canCleanup(), false);
        fake.close(1);
        await assert.rejects(result);
        assert.equal(compiler.canCleanup(), false);
    });

    it('fails after an unexpected compiler close while a build is active', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const pending = deferred<unknown>();
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build: () => pending.promise,
            stop: () => {
                stops++;
            },
        });
        const result = compiler.build({ entryPoints: ['example.ts'] });
        const settled = settledState(result);
        await turn();
        fake.close(1);
        await turn();
        assert.equal(settled(), false);
        pending.resolve(undefined);
        await assert.rejects(result);
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('reports a child error only after terminal close', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const failure = new Error('compiler process error');
        const compiler = createOwnedCompiler({
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build: async () => {},
            stop: () => {},
        });
        const result = compiler.build({ entryPoints: ['example.ts'] });
        const settled = settledState(result);
        await turn();
        fake.error(failure);
        await turn();
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(1);
        await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.ok(error.errors.includes(failure));
            assert.ok(error.errors.some((entry: unknown) =>
                entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
            ));
            return true;
        });
        assert.equal(compiler.canCleanup(), true);
    });

    it('drains a captured child after startup fails', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const failure = new Error('startup failed');
        let builds = 0;
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({ child: tracked, ready: Promise.reject(failure) }),
            build: async () => {
                builds++;
            },
            stop: () => {
                stops++;
            },
        });
        const result = compiler.build({ entryPoints: ['example.ts'] });
        const settled = settledState(result);
        await turn();
        assert.equal(builds, 0);
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(1);
        await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.ok(error.errors.includes(failure));
            assert.ok(error.errors.some((entry: unknown) =>
                entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
            ));
            return true;
        });
        assert.equal(compiler.canCleanup(), true);
    });

    it('waits for child close even if stopping the service fails', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const failure = new Error('stop failed');
        const compiler = createOwnedCompiler({
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build: async () => {},
            stop: () => {
                throw failure;
            },
        });
        const result = compiler.build({ entryPoints: ['example.ts'] });
        const settled = settledState(result);
        await turn();
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(1);
        await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.ok(error.errors.includes(failure));
            assert.ok(error.errors.some((entry: unknown) =>
                entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
            ));
            return true;
        });
        assert.equal(compiler.canCleanup(), true);
    });

    it('retains output when close observation times out', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const failure = new Error('close was not confirmed');
        let stops = 0;
        const observed: typeof tracked[] = [];
        const compiler = createOwnedCompiler(
            {
                start: () => ({ child: tracked, ready: Promise.resolve() }),
                build: async () => {},
                stop: () => {
                    stops++;
                },
            },
            async (child) => {
                observed.push(child);
                throw failure;
            }
        );
        await assert.rejects(
            compiler.build({ entryPoints: ['example.ts'] }),
            failure
        );
        assert.deepEqual(observed, [tracked]);
        assert.equal(stops, 1);
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('rejects a close observer that returns before the child closes', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        let stops = 0;
        const compiler = createOwnedCompiler(
            {
                start: () => ({ child: tracked, ready: Promise.resolve() }),
                build: async () => {},
                stop: () => {
                    stops++;
                },
            },
            async () => ({ code: 0, signal: null })
        );
        await assert.rejects(
            compiler.build({ entryPoints: ['example.ts'] }),
            /observer returned before terminal close/
        );
        assert.equal(stops, 1);
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('reports both build failure and unconfirmed close', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const buildFailure = new Error('build failed');
        const closeFailure = new Error('close was not confirmed');
        const compiler = createOwnedCompiler(
            {
                start: () => ({ child: tracked, ready: Promise.resolve() }),
                build: async () => {
                    throw buildFailure;
                },
                stop: () => {},
            },
            async () => {
                throw closeFailure;
            }
        );
        await assert.rejects(
            compiler.build({ entryPoints: ['example.ts'] }),
            (error: unknown) => {
                assert.ok(error instanceof AggregateError);
                assert.deepEqual(error.errors, [buildFailure, closeFailure]);
                return true;
            }
        );
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
    });

    it('waits for sibling builds and child close before exposing failure or cleanup', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const first = deferred<unknown>();
        const sibling = deferred<unknown>();
        const failure = new Error('first build failed');
        const options: BuildOptions[] = [
            { entryPoints: ['first.ts'], outfile: 'first.mjs' },
            { entryPoints: ['second.ts'], outfile: 'second.mjs' },
        ];
        const received: BuildOptions[] = [];
        let stops = 0;
        const driver: CompilerDriver = {
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build(option) {
                received.push(option);
                return received.length === 1 ? first.promise : sibling.promise;
            },
            stop() {
                stops++;
            },
        };
        const compiler = createOwnedCompiler(driver);
        const result = compiler.buildAll(options);
        const settled = settledState(result);
        await turn();
        assert.deepEqual(received, options);
        assert.equal(received[0], options[0]);
        assert.equal(received[1], options[1]);
        assert.equal(compiler.canCleanup(), false);
        first.reject(failure);
        await turn();
        assert.equal(stops, 0);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        sibling.resolve(undefined);
        await turn();
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.exit(0);
        fake.stdout.emit('end');
        await turn();
        assert.equal(settled(), false);
        fake.close(0);
        await assert.rejects(result, failure);
        assert.equal(compiler.canCleanup(), true);
        assert.ok(fake.references > 0);
    });

    for (const source of ['child', 'stdin', 'stdout'] as const) {
        it(`fails closed when builds do not drain after a ${source} error`, async () => {
            const fake = fakeChild();
            const tracked = trackCompilerChild(fake.child);
            const build = deferred<unknown>();
            const deadline = deferred<void>();
            const processFailure = new Error(`${source} failed`);
            const deadlineFailure = new Error('builds did not drain');
            let stops = 0;
            let observedError: Error | undefined;
            const compiler = createOwnedCompiler(
                {
                    start: () => ({ child: tracked, ready: Promise.resolve() }),
                    build: () => build.promise,
                    stop: () => {
                        stops++;
                    },
                },
                undefined,
                (_settled, error) => {
                    observedError = error;
                    return deadline.promise;
                }
            );
            const result = compiler.build({ entryPoints: ['example.ts'] });
            const settled = settledState(result);
            await turn();
            if (source === 'child') fake.error(processFailure);
            else fake[source].emit('error', processFailure);
            await turn();
            assert.equal(observedError, processFailure);
            assert.equal(settled(), false);
            assert.equal(stops, 0);
            assert.equal(compiler.canCleanup(), false);
            deadline.reject(deadlineFailure);
            await assert.rejects(result, (error: unknown) => {
                assert.ok(error instanceof AggregateError);
                assert.deepEqual(error.errors, [processFailure, deadlineFailure]);
                return true;
            });
            assert.equal(stops, 0);
            assert.equal(compiler.canCleanup(), false);
        });
    }

    it('retains the first build failure when error drainage times out', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const first = deferred<unknown>();
        const sibling = deferred<unknown>();
        const deadline = deferred<void>();
        const buildFailure = new Error('build failed first');
        const processFailure = new Error('stdout failed');
        const deadlineFailure = new Error('builds did not drain');
        let builds = 0;
        let stops = 0;
        const compiler = createOwnedCompiler(
            {
                start: () => ({ child: tracked, ready: Promise.resolve() }),
                build: () => (++builds === 1 ? first.promise : sibling.promise),
                stop: () => {
                    stops++;
                },
            },
            undefined,
            () => deadline.promise
        );
        const result = compiler.buildAll([
            { entryPoints: ['first.ts'] },
            { entryPoints: ['second.ts'] },
        ]);
        void settledState(result);
        await turn();
        first.reject(buildFailure);
        await turn();
        fake.stdout.emit('error', processFailure);
        await turn();
        deadline.reject(deadlineFailure);
        await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.deepEqual(error.errors, [
                buildFailure,
                processFailure,
                deadlineFailure,
            ]);
            return true;
        });
        assert.equal(builds, 2);
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('drains siblings after a stream error before stopping and waiting for close', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const first = deferred<unknown>();
        const sibling = deferred<unknown>();
        const buildFailure = new Error('build failed first');
        const processFailure = new Error('stdin failed');
        let builds = 0;
        let stops = 0;
        let observedError: Error | undefined;
        const compiler = createOwnedCompiler(
            {
                start: () => ({ child: tracked, ready: Promise.resolve() }),
                build: () => (++builds === 1 ? first.promise : sibling.promise),
                stop: () => {
                    stops++;
                },
            },
            undefined,
            async (settled, error) => {
                observedError = error;
                await settled;
            }
        );
        const result = compiler.buildAll([
            { entryPoints: ['first.ts'] },
            { entryPoints: ['second.ts'] },
        ]);
        const settled = settledState(result);
        await turn();
        first.reject(buildFailure);
        fake.stdin.emit('error', processFailure);
        await turn();
        assert.equal(observedError, processFailure);
        assert.equal(stops, 0);
        assert.equal(settled(), false);
        sibling.resolve(undefined);
        await turn();
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
        await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.ok(error.errors.includes(buildFailure));
            assert.ok(error.errors.includes(processFailure));
            assert.equal(error.errors.length, 2);
            return true;
        });
        assert.equal(compiler.canCleanup(), true);
    });

    it('does not stop if a drain observer returns before all builds settle', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const first = deferred<unknown>();
        const sibling = deferred<unknown>();
        const failure = new Error('stdout failed');
        let builds = 0;
        let stops = 0;
        let observations = 0;
        const compiler = createOwnedCompiler(
            {
                start: () => ({ child: tracked, ready: Promise.resolve() }),
                build: () => (++builds === 1 ? first.promise : sibling.promise),
                stop: () => {
                    stops++;
                },
            },
            undefined,
            async () => {
                observations++;
            }
        );
        const result = compiler.buildAll([
            { entryPoints: ['first.ts'] },
            { entryPoints: ['second.ts'] },
        ]);
        const settled = settledState(result);
        await turn();
        fake.stdout.emit('error', failure);
        await turn();
        assert.equal(observations, 1);
        assert.equal(stops, 0);
        first.resolve(undefined);
        await turn();
        assert.equal(stops, 0);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        sibling.resolve(undefined);
        await turn();
        assert.equal(stops, 1);
        assert.equal(settled(), false);
        assert.equal(compiler.canCleanup(), false);
        fake.close(0);
        await assert.rejects(result, failure);
        assert.equal(compiler.canCleanup(), true);
    });

    for (const source of ['child', 'stdin', 'stdout', 'exit', 'close'] as const) {
        it(`preserves a build failure after an earlier ${source} event`, async () => {
            const fake = fakeChild();
            const tracked = trackCompilerChild(fake.child);
            const first = deferred<unknown>();
            const sibling = deferred<unknown>();
            const lifecycleFailure = new Error(`${source} failed first`);
            const buildFailure = new Error('original build failure');
            let builds = 0;
            let stops = 0;
            let observed = false;
            const compiler = createOwnedCompiler(
                {
                    start: () => ({ child: tracked, ready: Promise.resolve() }),
                    build: () => (++builds === 1 ? first.promise : sibling.promise),
                    stop: () => {
                        stops++;
                    },
                },
                undefined,
                async (settled) => {
                    observed = true;
                    await settled;
                }
            );
            const result = compiler.buildAll([
                { entryPoints: ['first.ts'] },
                { entryPoints: ['second.ts'] },
            ]);
            const settled = settledState(result);
            await turn();
            if (source === 'child') fake.error(lifecycleFailure);
            else if (source === 'exit') fake.exit(1);
            else if (source === 'close') fake.close(1);
            else fake[source].emit('error', lifecycleFailure);
            await turn();
            assert.equal(observed, true);
            first.reject(buildFailure);
            await turn();
            assert.equal(stops, 0);
            assert.equal(settled(), false);
            assert.equal(compiler.canCleanup(), false);
            sibling.resolve(undefined);
            await turn();
            const ownershipLost = source === 'exit' || source === 'close';
            assert.equal(stops, ownershipLost ? 0 : 1);
            assert.equal(settled(), ownershipLost);
            if (source !== 'close') fake.close(1);
            await assert.rejects(result, (error: unknown) => {
                assert.ok(error instanceof AggregateError);
                assert.ok(error.errors.includes(buildFailure));
                if (ownershipLost) {
                    assert.ok(error.errors.some((entry: unknown) =>
                        entry instanceof Error && /Compiler (exited|closed) before owned shutdown/.test(entry.message)
                    ));
                    if (source === 'close') {
                        assert.ok(error.errors.some((entry: unknown) =>
                            entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
                        ));
                    }
                } else {
                    assert.ok(error.errors.includes(lifecycleFailure));
                    assert.ok(error.errors.some((entry: unknown) =>
                        entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
                    ));
                }
                assert.equal(new Set(error.errors).size, error.errors.length);
                return true;
            });
            assert.equal(compiler.canCleanup(), !ownershipLost);
        });
    }

    it('retains termination after a child error wins the race during sibling drain', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const first = deferred<unknown>();
        const sibling = deferred<unknown>();
        const processFailure = new Error('child failed first');
        const buildFailure = new Error('sibling build failed');
        let builds = 0;
        let stops = 0;
        let observed: Error | undefined;
        const compiler = createOwnedCompiler(
            {
                start: () => ({ child: tracked, ready: Promise.resolve() }),
                build: () => (++builds === 1 ? first.promise : sibling.promise),
                stop: () => { stops++; },
            },
            undefined,
            async (settled, error) => {
                observed = error;
                await settled;
            }
        );
        const result = compiler.buildAll([
            { entryPoints: ['first.ts'] },
            { entryPoints: ['second.ts'] },
        ]);
        const settled = settledState(result);
        await turn();
        fake.error(processFailure);
        await turn();
        assert.equal(observed, processFailure);
        assert.equal(settled(), false);
        fake.exit(1);
        fake.close(1);
        const termination = await tracked.terminated;
        first.resolve(undefined);
        sibling.reject(buildFailure);
        await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.ok(error.errors.includes(processFailure));
            assert.ok(error.errors.includes(termination));
            assert.ok(error.errors.includes(buildFailure));
            assert.ok(error.errors.some((entry: unknown) =>
                entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
            ));
            assert.equal(new Set(error.errors).size, error.errors.length);
            return true;
        });
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
    });

    for (const event of ['exit', 'close'] as const) {
        it(`drains siblings after unexpected ${event} without stopping`, async () => {
            const fake = fakeChild();
            const tracked = trackCompilerChild(fake.child);
            const first = deferred<unknown>();
            const sibling = deferred<unknown>();
            let builds = 0;
            let stops = 0;
            let termination: Error | undefined;
            const compiler = createOwnedCompiler(
                {
                    start: () => ({ child: tracked, ready: Promise.resolve() }),
                    build: () => (++builds === 1 ? first.promise : sibling.promise),
                    stop: () => {
                        stops++;
                    },
                },
                undefined,
                async (settled, error) => {
                    termination = error;
                    await settled;
                }
            );
            const result = compiler.buildAll([
                { entryPoints: ['first.ts'] },
                { entryPoints: ['second.ts'] },
            ]);
            const settled = settledState(result);
            await turn();
            first.resolve(undefined);
            fake[event](1);
            await turn();
            assert.equal(
                termination?.message,
                `Compiler ${event === 'exit' ? 'exited' : 'closed'} before owned shutdown`
            );
            assert.equal(stops, 0);
            assert.equal(settled(), false);
            assert.equal(compiler.canCleanup(), false);
            sibling.resolve(undefined);
            await turn();
            assert.equal(stops, 0);
            if (event === 'exit') {
                assert.equal(settled(), true);
                assert.equal(compiler.canCleanup(), false);
                fake.close(1);
            }
            await assert.rejects(result, (error: unknown) => {
                if (event === 'exit') return error === termination;
                assert.ok(error instanceof AggregateError);
                assert.ok(error.errors.includes(termination));
                assert.ok(error.errors.some((entry: unknown) =>
                    entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
                ));
                return true;
            });
            assert.equal(compiler.canCleanup(), false);
        });

        it(`retains output when builds remain stalled after unexpected ${event}`, async () => {
            const fake = fakeChild();
            const tracked = trackCompilerChild(fake.child);
            const first = deferred<unknown>();
            const sibling = deferred<unknown>();
            const deadline = deferred<void>();
            const buildFailure = new Error('build failed first');
            const deadlineFailure = new Error('builds did not drain');
            let builds = 0;
            let stops = 0;
            let termination: Error | undefined;
            const compiler = createOwnedCompiler(
                {
                    start: () => ({ child: tracked, ready: Promise.resolve() }),
                    build: () => (++builds === 1 ? first.promise : sibling.promise),
                    stop: () => {
                        stops++;
                    },
                },
                undefined,
                (_settled, error) => {
                    termination = error;
                    return deadline.promise;
                }
            );
            const result = compiler.buildAll([
                { entryPoints: ['first.ts'] },
                { entryPoints: ['second.ts'] },
            ]);
            const settled = settledState(result);
            await turn();
            first.reject(buildFailure);
            await turn();
            fake[event](1);
            if (event === 'exit') fake.close(1);
            await turn();
            assert.equal(
                termination?.message,
                `Compiler ${event === 'exit' ? 'exited' : 'closed'} before owned shutdown`
            );
            assert.equal(settled(), false);
            assert.equal(stops, 0);
            assert.equal(compiler.canCleanup(), false);
            deadline.reject(deadlineFailure);
            await assert.rejects(result, (error: unknown) => {
                assert.ok(error instanceof AggregateError);
                assert.ok(error.errors.includes(buildFailure));
                assert.ok(error.errors.includes(termination));
                assert.ok(error.errors.includes(deadlineFailure));
                assert.ok(error.errors.some((entry: unknown) =>
                    entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
                ));
                assert.equal(new Set(error.errors).size, error.errors.length);
                return true;
            });
            assert.equal(stops, 0);
            assert.equal(compiler.canCleanup(), false);
        });
    }

    it('keeps output until close after an stdin error', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const failure = new Error('stdin write failed');
        let stops = 0;
        const driver: CompilerDriver = {
            start: () => ({ child: tracked, ready: Promise.resolve() }),
            build: async () => {},
            stop: () => {
                stops++;
            },
        };
        const compiler = createOwnedCompiler(driver);
        const options: BuildOptions = {
            stdin: { contents: 'export const x = 1', resolveDir: '/example' },
            bundle: true,
            platform: 'node',
            format: 'esm',
        };
        const result = compiler.build(options);
        const settled = settledState(result);
        await turn();
        assert.equal(stops, 1);
        fake.stdin.emit('error', failure);
        await turn();
        assert.equal(compiler.canCleanup(), false);
        assert.equal(settled(), false);
        fake.close(1);
        await assert.rejects(result, (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.ok(error.errors.includes(failure));
            assert.ok(error.errors.some((entry: unknown) =>
                entry instanceof Error && /Compiler closed unexpectedly/.test(entry.message)
            ));
            return true;
        });
        assert.equal(compiler.canCleanup(), true);
    });

    it('fails closed when startup does not provide an owned compiler child', async () => {
        let builds = 0;
        let stops = 0;
        const driver: CompilerDriver = {
            start: () => ({ ready: Promise.resolve() }),
            build: async () => {
                builds++;
            },
            stop: () => {
                stops++;
            },
        };
        const compiler = createOwnedCompiler(driver);
        await assert.rejects(compiler.build({ entryPoints: ['example.ts'] }));
        assert.equal(builds, 0);
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('fails closed without stopping after an uncaptured startup rejection', async () => {
        const failure = new Error('startup failed');
        let builds = 0;
        let stops = 0;
        const driver: CompilerDriver = {
            start: () => ({
                ready: Promise.reject(failure),
            }),
            build: async () => {
                builds++;
            },
            stop: () => {
                stops++;
            },
        };
        const compiler = createOwnedCompiler(driver);
        await assert.rejects(compiler.build({ entryPoints: ['example.ts'] }), (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.ok(error.errors.includes(failure));
            assert.ok(error.errors.some((entry: unknown) =>
                entry instanceof Error && /ownership was not established/.test(entry.message)
            ));
            return true;
        });
        assert.equal(builds, 0);
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('does not stop a captured child when its identity is ambiguous', async () => {
        const fake = fakeChild();
        const tracked = trackCompilerChild(fake.child);
        const failure = new Error('compiler identity mismatch');
        let builds = 0;
        let stops = 0;
        const compiler = createOwnedCompiler({
            start: () => ({
                child: tracked,
                ambiguous: true,
                ready: Promise.reject(failure),
            }),
            build: async () => {
                builds++;
            },
            stop: () => {
                stops++;
            },
        });
        await assert.rejects(compiler.build({ entryPoints: ['example.ts'] }), (error: unknown) => {
            assert.ok(error instanceof AggregateError);
            assert.ok(error.errors.includes(failure));
            assert.ok(error.errors.some((entry: unknown) =>
                entry instanceof Error && /ownership was not established/.test(entry.message)
            ));
            return true;
        });
        assert.equal(builds, 0);
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
        // Close the fake only to exercise that an ambiguous identity remains
        // unsafe even if one observed child has closed.
        fake.close(0);
        assert.equal(compiler.canCleanup(), false);
    });

    it('fails closed when startup throws before capture', async () => {
        const failure = new Error('startup refused');
        let builds = 0;
        let stops = 0;
        const driver: CompilerDriver = {
            start: () => {
                throw failure;
            },
            build: async () => {
                builds++;
            },
            stop: () => {
                stops++;
            },
        };
        const compiler = createOwnedCompiler(driver);
        await assert.rejects(
            compiler.build({ entryPoints: ['example.ts'] }),
            failure
        );
        assert.equal(builds, 0);
        assert.equal(stops, 0);
        assert.equal(compiler.canCleanup(), false);
    });

    for (const reason of ['duplicate', 'mismatch', 'pre-existing'] as const) {
        it(`does not build, stop, or permit cleanup for ${reason} identity`, async () => {
            let builds = 0;
            let stops = 0;
            const options: SpawnOptions = {
                cwd: '/checkout',
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'inherit'],
            };
            const compiler = createOwnedCompiler({
                start() {
                    if (reason === 'pre-existing')
                        assertFreshEsbuild({ exports: {} });
                    assertCompilerSpawn(
                        reason === 'mismatch' ? '/untrusted' : '/trusted',
                        ['--service=0.25.10', '--ping'],
                        options,
                        '/trusted',
                        '/checkout',
                        reason === 'duplicate',
                        (path) => path
                    );
                    return { ready: Promise.resolve() };
                },
                build: async () => {
                    builds++;
                },
                stop: () => {
                    stops++;
                },
            });
            await assert.rejects(
                compiler.build({ entryPoints: ['example.ts'] })
            );
            assert.equal(builds, 0);
            assert.equal(stops, 0);
            assert.equal(compiler.canCleanup(), false);
        });
    }
});
