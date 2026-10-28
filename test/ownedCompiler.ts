import childProcess, { type ChildProcess, type SpawnOptions } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import type { BuildOptions } from 'esbuild';

export type CompilerClose = {
    code: number | null;
    signal: NodeJS.Signals | null;
    error?: Error;
};

export type TrackedCompilerChild = {
    closed: Promise<CompilerClose>;
    errored: Promise<Error>;
    terminated: Promise<Error>;
    isClosed(): boolean;
    isExited(): boolean;
    onError(listener: (error: Error) => void): void;
    ref(): void;
};

// Install these listeners as soon as spawn returns, before handing the child
// back to esbuild. In particular, an error is not a substitute for close.
export function trackCompilerChild(child: ChildProcess): TrackedCompilerChild {
    let error: Error | undefined;
    const errors: Error[] = [];
    let listener: ((error: Error) => void) | undefined;
    let closed = false;
    let exited = false;
    let reportError!: (error: Error) => void;
    const errored = new Promise<Error>((resolve) => {
        reportError = resolve;
    });
    let reportTermination!: (error: Error) => void;
    const terminated = new Promise<Error>((resolve) => {
        reportTermination = resolve;
    });
    const terminal = new Promise<CompilerClose>((resolve) => {
        const remember = (next: Error) => {
            if (!errors.includes(next)) {
                errors.push(next);
                listener?.(next);
            }
            if (!error) {
                error = next;
                reportError(next);
            }
        };
        child.on('error', remember);
        child.stdin?.on('error', remember);
        child.stdout?.on('error', remember);
        child.on('exit', () => {
            exited = true;
            reportTermination(new Error('Compiler exited before owned shutdown'));
        });
        child.on('close', (code, signal) => {
            closed = true;
            reportTermination(new Error('Compiler closed before owned shutdown'));
            resolve(error ? { code, signal, error } : { code, signal });
        });
    });
    return {
        closed: terminal,
        errored,
        terminated,
        isClosed: () => closed,
        isExited: () => exited,
        onError: (next) => {
            listener = next;
            for (const error of errors) next(error);
        },
        ref: () => child.ref(),
    };
}

export type CompilerDriver = {
    start(): {
        child?: TrackedCompilerChild;
        ready: Promise<void>;
        ambiguous?: boolean;
        isAmbiguous?: () => boolean;
        restore?: () => void;
    };
    build(options: BuildOptions): Promise<unknown>;
    stop(): Promise<void> | void;
};

const require = createRequire(import.meta.url);
// Normal node --test runs each fixture in its own process. The cache and owner
// checks below assume that isolation; they cannot prevent another consumer in
// the same process from using the cached esbuild instance during a build.
let defaultOwner: symbol | undefined;
const version = '0.25.10';

export function assertFreshEsbuild(cached: unknown): void {
    if (cached) throw new Error('esbuild was loaded before compiler ownership');
}

export function assertCompilerSpawn(
    command: string,
    args: readonly string[] | undefined,
    options: SpawnOptions | undefined,
    expectedBinary: string,
    expectedCwd: string,
    alreadyTracked: boolean,
    resolvePath: (path: string) => string = realpathSync
): void {
    if (
        alreadyTracked ||
        resolvePath(command) !== expectedBinary ||
        args?.length !== 2 ||
        args[0] !== `--service=${version}` ||
        args[1] !== '--ping' ||
        !options ||
        options.cwd !== expectedCwd ||
        options.windowsHide !== true ||
        !Array.isArray(options.stdio) ||
        options.stdio.length !== 3 ||
        options.stdio[0] !== 'pipe' ||
        options.stdio[1] !== 'pipe' ||
        options.stdio[2] !== 'inherit'
    )
        throw new Error('Unverified compiler spawn');
}

export type SpawnSlot = {
    get(): typeof childProcess.spawn;
    set(value: typeof childProcess.spawn): void;
};

// This fence covers service spawns made through this child_process binding
// until the owned service reaches a terminal disposition. Other spawns retain
// their original arguments and behavior. It assumes no foreign esbuild use or
// monkeypatching in the per-file test process; it cannot detect a foreign build
// that reuses an existing service without spawning.
export function installCompilerSpawnFence(
    expectedBinary: string,
    cwd: string,
    slot: SpawnSlot = {
        get: () => childProcess.spawn,
        set: (value) => { childProcess.spawn = value; },
    },
    resolvePath: (path: string) => string = realpathSync
) {
    const original = slot.get();
    const spawn = original as unknown as (...args: unknown[]) => ChildProcess;
    let startup = true;
    let ambiguous = false;
    let restored = false;
    let restoreRequested = false;
    let tracked: TrackedCompilerChild | undefined;
    const pending = new Set<ChildProcess>();
    const maybeRestore = () => {
        if (!restoreRequested || restored || pending.size !== 0) return;
        if (slot.get() === wrapper) slot.set(original);
        else ambiguous = true;
        restored = true;
    };
    const watchClose = (child: ChildProcess) => {
        pending.add(child);
        child.on('close', () => {
            pending.delete(child);
            try {
                maybeRestore();
            } catch {
                ambiguous = true;
            }
        });
    };
    const wrapper = ((...callArgs: unknown[]) => {
        const [command, args, options] = callArgs;
        const argumentsList = Array.isArray(args) ? args : [];
        const serviceFlag = argumentsList.some(
            (arg: unknown) => typeof arg === 'string' && arg.startsWith('--service=')
        );
        let expectedCommand = false;
        if (serviceFlag && typeof command === 'string') {
            try {
                expectedCommand = resolvePath(command) === expectedBinary;
            } catch {
                // Unrelated commands need not exist at fence-inspection time.
            }
        }
        const service = serviceFlag && (
            expectedCommand ||
            (typeof command === 'string' &&
            ['esbuild', 'esbuild.exe'].includes(basename(command).toLowerCase()) &&
            argumentsList.includes('--ping') && argumentsList.some(
                (arg: unknown) => typeof arg === 'string' && /^--service=\d+\.\d+\.\d+$/.test(arg)
            ))
        );
        if (!service) return spawn(...callArgs);
        if (!startup) {
            ambiguous = true;
            const child = spawn(...callArgs);
            watchClose(child);
            return child;
        }
        try {
            if (typeof command !== 'string') throw new Error('Invalid compiler command');
            assertCompilerSpawn(
                command,
                args as string[],
                options as SpawnOptions | undefined,
                expectedBinary,
                cwd,
                !!tracked,
                resolvePath
            );
            const child = spawn(...callArgs);
            tracked = trackCompilerChild(child);
            watchClose(child);
            if (
                resolvePath(child.spawnfile) !== expectedBinary ||
                child.spawnargs.length !== 3 ||
                child.spawnargs[0] !== command ||
                child.spawnargs[1] !== `--service=${version}` ||
                child.spawnargs[2] !== '--ping'
            )
                throw new Error('Spawned compiler identity mismatch');
            return child;
        } catch (error) {
            ambiguous = true;
            throw error;
        }
    }) as typeof childProcess.spawn;
    slot.set(wrapper);
    return {
        child: () => tracked,
        finishStartup: () => { startup = false; },
        isAmbiguous: () => ambiguous || (!restored && slot.get() !== wrapper),
        restore: () => {
            if (restored) return;
            restoreRequested = true;
            maybeRestore();
        },
    };
}

// Trust the pinned npm package provenance. This checks the installed package's
// version and direct native path, not the binary's independent attestation.
// Custom binary overrides, downloaded fallbacks and WASM launchers are not
// accepted because their descendant process ownership cannot be established.
function nativeBinary(esbuildPath: string): string {
    if (process.env.ESBUILD_BINARY_PATH)
        throw new Error('Owned compiler does not accept ESBUILD_BINARY_PATH');
    const nativePlatforms: Record<string, readonly string[]> = {
        aix: ['ppc64'],
        android: ['arm64'],
        darwin: ['arm64', 'x64'],
        freebsd: ['arm64', 'x64'],
        linux: ['arm', 'arm64', 'ia32', 'loong64', 'mips64el', 'ppc64', 'riscv64', 's390x', 'x64'],
        netbsd: ['arm64', 'x64'],
        openbsd: ['arm64', 'x64'],
        sunos: ['x64'],
        win32: ['arm64', 'ia32', 'x64'],
    };
    if (!nativePlatforms[process.platform]?.includes(process.arch))
        throw new Error('Owned compiler has no verified native package for this platform');
    const packageName = `@esbuild/${process.platform}-${process.arch}`;
    const fromEsbuild = createRequire(esbuildPath);
    const packageJson = fromEsbuild.resolve(`${packageName}/package.json`);
    const manifest = fromEsbuild(packageJson) as { version?: string };
    if (manifest.version !== version)
        throw new Error(`Owned compiler requires ${packageName}@${version}`);
    const binary = fromEsbuild.resolve(
        `${packageName}/${process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'}`
    );
    // The resolved file must be the package's actual native executable, not a
    // separately configured script or a downloaded fallback.
    const expected = join(
        realpathSync(packageJson).replace(/[/\\]package\.json$/, ''),
        process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'
    );
    if (realpathSync(binary) !== realpathSync(expected))
        throw new Error('Owned compiler native package path mismatch');
    return realpathSync(binary);
}

// Internal aggregates can be flattened when a later stage also fails. An
// AggregateError supplied by a caller remains an opaque original failure.
const internalAggregates = new WeakSet<AggregateError>();
function combinedFailures(errors: unknown[]): unknown {
    if (errors.length === 1) return errors[0];
    const combined = new AggregateError(errors, 'Owned compiler encountered multiple failures');
    internalAggregates.add(combined);
    return combined;
}

type EsbuildModule = typeof import('esbuild');

function nativeDriver(): CompilerDriver {
    const owner = Symbol('owned compiler');
    let compiler: EsbuildModule | undefined;
    let binary: string | undefined;
    let workingDirectory: string | undefined;
    return {
        start() {
            if (defaultOwner && defaultOwner !== owner)
                throw new Error('An owned compiler already has exclusive ownership');
            defaultOwner = owner;
            const esbuildPath = require.resolve('esbuild');
            if (!compiler) {
                assertFreshEsbuild(require.cache[esbuildPath]);
                binary = nativeBinary(esbuildPath);
                workingDirectory = process.cwd();
            } else if (require.cache[esbuildPath]?.exports !== compiler) {
                throw new Error('Owned esbuild module identity changed');
            }
            if (!binary || !workingDirectory)
                throw new Error('Missing compiler identity');
            const fence = installCompilerSpawnFence(binary, workingDirectory);
            let ready: Promise<void>;
            try {
                if (!compiler) {
                    compiler = require(esbuildPath) as EsbuildModule;
                    if (compiler.version !== version)
                        throw new Error(`Owned compiler requires esbuild@${version}`);
                }
                ready = compiler.initialize({});
            } catch (error) {
                ready = Promise.reject(error);
            } finally {
                fence.finishStartup();
            }
            // esbuild unrefs the service. Hold a reference until terminal close.
            void ready.catch(() => {});
            try {
                fence.child()?.ref();
            } catch (error) {
                const failures: unknown[] = [error];
                try {
                    fence.restore();
                } catch (restoreError) {
                    if (!failures.includes(restoreError)) failures.push(restoreError);
                }
                // Ownership remains unsafe and no stop is attempted. Observe
                // initialization too, so its rejection cannot be masked by ref.
                return {
                    child: fence.child(),
                    ambiguous: true,
                    ready: ready.then(
                        () => { throw combinedFailures(failures); },
                        (readyError: unknown) => {
                            if (!failures.includes(readyError)) failures.push(readyError);
                            throw combinedFailures(failures);
                        }
                    ),
                    isAmbiguous: fence.isAmbiguous,
                };
            }
            return {
                child: fence.child(),
                ready,
                isAmbiguous: fence.isAmbiguous,
                restore: fence.restore,
            };
        },
        build(options) {
            if (!compiler) throw new Error('Compiler was not initialized');
            return compiler.build(options);
        },
        stop() {
            if (!compiler) throw new Error('Compiler was not initialized');
            return compiler.stop();
        },
    };
}

export type CloseObserver = (child: TrackedCompilerChild) => Promise<CompilerClose>;
export type ErrorDrainObserver = (
    settled: Promise<unknown>,
    error: Error
) => Promise<void>;

// This deadline only bounds observation; it never signals the child. On
// timeout the caller must retain the output because closure is unconfirmed.
export const observeCompilerClose: CloseObserver = (child) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('Compiler close was not confirmed within 30 seconds')),
            30_000
        );
        child.closed.then(
            (result) => {
                clearTimeout(timer);
                resolve(result);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });

// No general build deadline is imposed. A process or stream error, or an
// unexpected termination, starts a bounded drain. Timeout leaves ownership
// unsafe and never stops the service.
export const observeErrorDrain: ErrorDrainObserver = (settled) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('Compiler builds did not settle within 30 seconds after compiler failure')),
            30_000
        );
        settled.then(
            () => {
                clearTimeout(timer);
                resolve();
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });

export function createOwnedCompiler(
    driver: CompilerDriver = nativeDriver(),
    observeClose: CloseObserver = observeCompilerClose,
    observeDrain: ErrorDrainObserver = observeErrorDrain
) {
    let unsafe = false;
    let active = false;

    async function runActions(actions: Array<() => Promise<unknown>>): Promise<void> {
        if (active) throw new Error('Owned compiler is already running');
        if (unsafe) throw new Error('Compiler ownership is unconfirmed');
        active = true;
        let child: TrackedCompilerChild | undefined;
        let confirmedClosed = false;
        const errors: unknown[] = [];
        const seen = new Set<unknown>();
        let started: ReturnType<CompilerDriver['start']> | undefined;
        let terminationObserved = false;
        const ambiguity = new Error('Compiler ownership became ambiguous');
        const record = (error: unknown): void => {
            if (error instanceof AggregateError && internalAggregates.has(error)) {
                for (const nested of error.errors) record(nested);
            } else if (!seen.has(error)) {
                seen.add(error);
                errors.push(error);
            }
        };
        const ownershipLost = async () => {
            unsafe = true;
            // A real tracked child resolves terminated when either event is
            // observed, even if an earlier stream error won the race.
            if (!terminationObserved && child) record(await child.terminated);
        };
        const recordTerminal = (terminal: CompilerClose) => {
            if (terminal.error) record(terminal.error);
            if (
                (terminal.signal && terminal.signal !== 'SIGTERM') ||
                (!terminal.signal && terminal.code !== 0)
            )
                record(
                    new Error(
                        `Compiler closed unexpectedly (code ${terminal.code}, signal ${terminal.signal})`
                    )
                );
        };
        try {
            let drainFailed = false;
            try {
                started = driver.start();
            } catch (error) {
                unsafe = true;
                throw error;
            }
            child = started.child;
            child?.onError(record);
            if (!child || started.ambiguous || started.isAmbiguous?.()) {
                unsafe = true;
                record(new Error('Compiler child ownership was not established'));
                // Avoid an unhandled rejection while refusing to stop an
                // unowned service or start any builds.
                await started.ready;
                return;
            }
            try {
                await started.ready;
                if (started.isAmbiguous?.())
                    throw ambiguity;
                if (child.isClosed() || child.isExited())
                    throw new Error('Compiler exited before building');
                const builds = actions.map((action) =>
                    Promise.resolve()
                        .then(action)
                        .catch((error: unknown) => {
                            record(error);
                            throw error;
                        })
                );
                const settled = Promise.allSettled(builds);
                const outcome = await Promise.race([
                    settled.then(() => ({ kind: 'settled' as const })),
                    child.errored.then((error) => ({ kind: 'error' as const, error })),
                    child.terminated.then((error) => ({ kind: 'termination' as const, error })),
                ]);
                if (outcome.kind !== 'settled') {
                    terminationObserved = outcome.kind === 'termination';
                    record(outcome.error);
                    try {
                        await observeDrain(settled, outcome.error);
                        // An observer cannot authorize shutdown before every
                        // started build has actually settled.
                        await settled;
                    } catch (error) {
                        drainFailed = true;
                        record(error);
                    }
                }
            } catch (error) {
                record(error);
            }
            if (drainFailed) return;
            if (started.isAmbiguous?.()) {
                unsafe = true;
                record(ambiguity);
                return;
            }
            if (child.isClosed() || child.isExited()) {
                // The cached global service may no longer refer to this child.
                // Do not stop it or release the fixture without ownership proof.
                await ownershipLost();
                return;
            }
            // The service may unref itself when builds finish. Keep the process
            // referenced while waiting for close, including after stop errors.
            child.ref();
            if (started.isAmbiguous?.()) {
                unsafe = true;
                record(ambiguity);
                return;
            }
            if (child.isClosed() || child.isExited()) {
                await ownershipLost();
                return;
            }
            try {
                await driver.stop();
            } catch (error) {
                record(error);
            }
            let terminal: CompilerClose;
            try {
                terminal = await observeClose(child);
                if (!child.isClosed())
                    throw new Error('Compiler observer returned before terminal close');
            } catch (error) {
                record(error);
                return;
            }
            confirmedClosed = true;
            recordTerminal(terminal);
            if (started.isAmbiguous?.()) {
                unsafe = true;
                record(ambiguity);
            }
        } catch (error) {
            record(error);
        } finally {
            // An already closed child has a resolved terminal result. Inspect
            // it without changing the unsafe/cleanup decision or waiting for
            // a child whose close has not been observed.
            try {
                if (child && !confirmedClosed && child.isClosed())
                    recordTerminal(await child.closed);
            } catch (error) {
                record(error);
            }
            try {
                if (started?.isAmbiguous?.()) {
                    unsafe = true;
                    record(ambiguity);
                }
            } catch (error) {
                unsafe = true;
                record(error);
            }
            try {
                started?.restore?.();
            } catch (error) {
                unsafe = true;
                record(error);
            }
            try {
                if (started?.isAmbiguous?.()) {
                    unsafe = true;
                    record(ambiguity);
                }
            } catch (error) {
                unsafe = true;
                record(error);
            }
            if (!confirmedClosed) unsafe = true;
            active = false;
            if (errors.length) throw combinedFailures(errors);
        }
    }

    return {
        build: (options: BuildOptions) => runActions([() => driver.build(options)]),
        buildAll: (options: BuildOptions[]) =>
            runActions(options.map((option) => () => driver.build(option))),
        // Only for importing assertion modules that themselves import esbuild;
        // the callback must not invoke esbuild outside this owner's build API.
        withService: async <T>(action: () => Promise<T>): Promise<T> => {
            let result!: T;
            await runActions([async () => { result = await action(); }]);
            return result;
        },
        canCleanup: () => !unsafe && !active,
    };
}
