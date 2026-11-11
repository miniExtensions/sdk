/** Each controller belongs to one presenter; dispatch is consumed before calling out. */
export type FormCompletionCountdownSnapshot = {
    count: number;
    status: 'idle' | 'running' | 'stopped' | 'completed' | 'retired';
};

export type FormCompletionClock = {
    now(): number;
    setTimeout(callback: () => void, milliseconds: number): unknown;
    clearTimeout(handle: unknown): void;
};

export type FormCompletionCountdownOptions = {
    start?: number;
    onComplete: () => void;
    clock?: FormCompletionClock;
    /** React attaches only after commit. Headless callers are attached by default. */
    attached?: boolean;
};

export function createFormCompletionCountdown(
    options: FormCompletionCountdownOptions
) {
    const clock: FormCompletionClock = options.clock ?? {
        now: () => Date.now(),
        setTimeout: (callback, milliseconds) =>
            setTimeout(callback, milliseconds),
        clearTimeout: (handle) =>
            clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    let initial = options.start ?? 2;
    let complete = options.onComplete;
    let snapshot: FormCompletionCountdownSnapshot = {
        count: initial,
        status: 'idle',
    };
    let attached = options.attached ?? true;
    let lease = 0;
    let epoch = 0;
    let deadline = 0;
    let timer: unknown;
    const listeners = new Set<() => void>();
    const publish = (next: FormCompletionCountdownSnapshot) => {
        snapshot = next;
        for (const listener of listeners) listener();
    };
    const clear = () => {
        epoch++;
        if (timer !== undefined) clock.clearTimeout(timer);
        timer = undefined;
    };
    const schedule = () => {
        if (!attached || snapshot.status !== 'running') return;
        const capturedEpoch = epoch;
        const remaining = Math.max(0, deadline - clock.now());
        timer = clock.setTimeout(
            () => {
                if (
                    !attached ||
                    capturedEpoch !== epoch ||
                    snapshot.status !== 'running'
                )
                    return;
                timer = undefined;
                const count = Math.max(
                    0,
                    Math.ceil((deadline - clock.now()) / 1000)
                );
                if (count === 0) {
                    clear();
                    publish({ count: 0, status: 'completed' });
                    complete();
                } else {
                    publish({ count, status: 'running' });
                    schedule();
                }
            },
            Math.min(1000, remaining)
        );
    };
    const start = (duration = initial) => {
        if (
            snapshot.status === 'running' ||
            snapshot.status === 'completed' ||
            snapshot.status === 'retired'
        )
            return;
        if (!Number.isFinite(duration) || duration < 0)
            throw new RangeError('Invalid countdown duration');
        clear();
        deadline = clock.now() + duration * 1000;
        publish({ count: duration, status: 'running' });
        if (duration === 0 && attached) {
            publish({ count: 0, status: 'completed' });
            complete();
        } else {
            schedule();
        }
    };
    const stop = () => {
        if (snapshot.status === 'retired') return;
        clear();
        publish({ ...snapshot, status: 'stopped' });
    };
    return {
        getSnapshot: () => snapshot,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        update: (
            next: Pick<FormCompletionCountdownOptions, 'start' | 'onComplete'>
        ) => {
            initial = next.start ?? 2;
            complete = next.onComplete;
        },
        start,
        stop,
        reset: (duration: number) => {
            if (snapshot.status === 'retired') return;
            stop();
            start(duration);
        },
        /** Effect reconnection keeps the same deadline, including StrictMode rehearsal. */
        attach: () => {
            const owner = ++lease;
            if (snapshot.status === 'retired') return () => {};
            attached = true;
            clear();
            schedule();
            return () => {
                if (lease !== owner) return;
                attached = false;
                clear();
            };
        },
        retire: () => {
            attached = false;
            clear();
            publish({ ...snapshot, status: 'retired' });
        },
    };
}

export type FormCompletionCountdown = ReturnType<
    typeof createFormCompletionCountdown
>;

export type FormCompletionDispatchReceipt = {
    status: 'dispatched' | 'revoked' | 'failed';
    /** Invocation is an attempt; it does not acknowledge navigation or closure. */
    attempted: number;
    error?: unknown;
};

/** Execute a fresh plan once. A thrown or uncertain adapter is never retried. */
export function dispatchFormCompletionCommands<Command>(
    commands: readonly Command[],
    adapter: {
        dispatch(command: Command): void | Promise<void>;
        isCurrent(): boolean;
    }
): FormCompletionDispatchReceipt | Promise<FormCompletionDispatchReceipt> {
    let attempted = 0;
    const next = (
        index: number
    ):
        | FormCompletionDispatchReceipt
        | Promise<FormCompletionDispatchReceipt> => {
        for (let position = index; position < commands.length; position++) {
            try {
                if (!adapter.isCurrent())
                    return { status: 'revoked', attempted };
                attempted++;
                const result = adapter.dispatch(commands[position]!);
                if (result != null)
                    return result.then(
                        () => next(position + 1),
                        (error: unknown) => ({
                            status: 'failed' as const,
                            attempted,
                            error,
                        })
                    );
            } catch (error) {
                return { status: 'failed', attempted, error };
            }
        }
        return { status: 'dispatched', attempted };
    };
    return next(0);
}
