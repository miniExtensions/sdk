type Allocate = () => Promise<void>;

/** One instance coordinates background work for all fields of a host Form. */
export type FormBackgroundComputeCoordinator<Key> = {
    /**
     * Run the first operation synchronously and keep only the latest follow-up.
     * Callers join the chain. An escaped failure discards queued work.
     */
    runBackground(sessionKey: Key, allocate: Allocate): Promise<void>;
    /**
     * Enter synchronously when idle. Otherwise wait for this session's chain;
     * its escaped failure rejects the foreground call before allocation.
     */
    runForeground(sessionKey: Key, allocate: Allocate): Promise<void>;
};

type BackgroundChain = {
    completion: Promise<void>;
    queued?: Allocate;
};

/**
 * Coordinate when a host allocates Compute and foreground operations. A
 * background create may adopt a record ID before the queued and foreground
 * callbacks run. Read the live draft and check the captured owner in those
 * callbacks; the scheduler owns neither snapshots nor operation settlement.
 */
export function createFormBackgroundComputeCoordinator<
    Key,
>(): FormBackgroundComputeCoordinator<Key> {
    const active = new Map<Key, BackgroundChain>();

    const drain = async (key: Key, chain: BackgroundChain, first: Allocate) => {
        let allocate: Allocate | undefined = first;
        try {
            while (allocate != null) {
                await allocate();
                allocate = chain.queued;
                chain.queued = undefined;
            }
        } finally {
            chain.queued = undefined;
            active.delete(key);
        }
    };

    const runBackground = (sessionKey: Key, allocate: Allocate) => {
        const chain = active.get(sessionKey);
        if (chain != null) {
            chain.queued = allocate;
            return chain.completion;
        }

        // Register before calling the host, even when it schedules another
        // edit synchronously from within allocation.
        let start!: (chain: BackgroundChain) => void;
        const completion = new Promise<void>((resolve, reject) => {
            start = (created) => {
                void drain(sessionKey, created, allocate).then(resolve, reject);
            };
        });
        const created = { completion };
        active.set(sessionKey, created);
        start(created);
        return completion;
    };

    const runForeground = async (sessionKey: Key, allocate: Allocate) => {
        const chain = active.get(sessionKey);
        if (chain != null) await chain.completion;
        await allocate();
    };

    return { runBackground, runForeground };
}

/** A clock schedules a future callback and yields a cancel function. */
export type FormBackgroundComputeClock = {
    now(): number;
    schedule(run: () => Promise<void>, delayMs: number): () => void;
};

/** One binding per mounted field, independent of the shared session queue. */
export type FormBackgroundComputeFieldBinding<Owner> = {
    /** Accept an already-committed edit and retain its host owner for allocation. */
    edited(
        owner: Owner,
        compute: (expectedOwner: Owner) => Promise<void>
    ): void;
    /** Cancel an unstarted timer. Allocated work and its accepted edits may settle. */
    cancelScheduled(): void;
};

const defaultClock: FormBackgroundComputeClock = {
    now: () => Date.now(),
    schedule(run, delayMs) {
        const timer = setTimeout(run, delayMs);
        return () => clearTimeout(timer);
    },
};

/**
 * Debounce idle field edits for 300 ms, with an immediate scheduled follow-up
 * for a newer edit during a successful Compute. Cancellation is timer-only;
 * a host still checks the original owner when it actually allocates.
 */
export function createFormBackgroundComputeFieldBinding<Owner>({
    clock = defaultClock,
}: {
    clock?: FormBackgroundComputeClock;
} = {}): FormBackgroundComputeFieldBinding<Owner> {
    let pending:
        | {
              owner: Owner;
              compute: (owner: Owner) => Promise<void>;
          }
        | undefined;
    let lastEditAt = 0;
    let computing = false;
    let cancelTimer: (() => void) | undefined;

    const computePending = async () => {
        cancelTimer = undefined;
        const edit = pending;
        pending = undefined;
        if (edit == null) return;

        computing = true;
        const startedAt = clock.now();
        try {
            await edit.compute(edit.owner);
        } catch (error) {
            pending = undefined;
            throw error;
        } finally {
            computing = false;
        }

        if (lastEditAt > startedAt) {
            cancelTimer = clock.schedule(computePending, 0);
        } else {
            pending = undefined;
        }
    };

    return {
        edited(owner, compute) {
            pending = { owner, compute };
            lastEditAt = clock.now();
            if (computing) return;
            cancelTimer?.();
            cancelTimer = clock.schedule(computePending, 300);
        },
        cancelScheduled() {
            if (cancelTimer == null) return;
            cancelTimer();
            cancelTimer = undefined;
            pending = undefined;
        },
    };
}
