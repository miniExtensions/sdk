export type ChatCommandResult =
    | 'accepted'
    | 'inactive'
    | 'unavailable'
    | 'failed';

/** Acceptance, availability and visibility are deliberately independent. */
export type CustomerChatState = Readonly<{
    loading: 'idle' | 'requested' | 'insertion-attempted' | 'failed';
    boot: 'idle' | 'accepted' | 'failed';
    available: boolean;
    visible: boolean | null;
}>;

export type CustomerChatConnection = {
    getState(): CustomerChatState;
    subscribe(listener: () => void): () => void;
    setLauncherHidden(hidden: boolean): ChatCommandResult;
    showNewMessage(message: string): ChatCommandResult;
    /** Retires callbacks; cannot cancel a dispatched script or provider command. */
    retire(shutdown: boolean): void;
};

export type CustomerChatAdapter<Configuration> = {
    connect(
        configuration: Configuration,
        context: {
            generation: number;
            isCurrent(): boolean;
            preserveConversation: boolean;
            launcherHidden: boolean;
        }
    ): CustomerChatConnection;
};

export type CustomerChatRegistration<Identity, Configuration> = Readonly<{
    identity: Identity;
    configuration: Configuration;
}>;

export type CustomerChatLease<Identity, Configuration> = {
    readonly id: object;
    isActive(): boolean;
    update(
        registration: CustomerChatRegistration<Identity, Configuration>
    ): void;
    showNewMessage(message: string): ChatCommandResult;
    release(): void;
};

export type CustomerChatSnapshot = Readonly<{
    generation: number;
    customerCount: number;
    activeRegistration: object | null;
    launcherHidden: boolean;
    state: CustomerChatState;
}>;

export type CustomerChatBroker<Identity, Configuration> = {
    register(
        registration: CustomerChatRegistration<Identity, Configuration>
    ): CustomerChatLease<Identity, Configuration>;
    acquireLauncherHide(): () => void;
    setDefaultLauncherHidden(hidden: boolean): void;
    getSnapshot(): CustomerChatSnapshot;
    subscribe(listener: () => void): () => void;
};

const idle: CustomerChatState = Object.freeze({
    loading: 'idle',
    boot: 'idle',
    available: false,
    visible: null,
});
const failed: CustomerChatState = Object.freeze({ ...idle, boot: 'failed' });

/**
 * Create exactly once in the host and pass the same object to every root/bundle.
 * No global lookup, admin identity, provider identity inference or retry policy.
 */
export function createCustomerChatBroker<Identity, Configuration>(options: {
    arbitration: 'last-registered';
    environment: 'client' | 'server';
    adapter: CustomerChatAdapter<Configuration>;
    isSameIdentity(previous: Identity, next: Identity): boolean;
    isSameConfiguration(previous: Configuration, next: Configuration): boolean;
    defaultLauncherHidden?: boolean;
}): CustomerChatBroker<Identity, Configuration> {
    if (options.arbitration !== 'last-registered')
        throw new Error('Explicit last-registered arbitration is required.');
    type Entry = {
        id: object;
        registration: CustomerChatRegistration<Identity, Configuration>;
    };
    const entries: Entry[] = [];
    const listeners = new Set<() => void>();
    const hideLeases = new Set<object>();
    let defaultHidden = options.defaultLauncherHidden === true;
    let generation = 0;
    let active: Entry | undefined;
    let connection: CustomerChatConnection | undefined;
    let unsubscribe: (() => void) | undefined;
    let state = idle;
    let snapshot: CustomerChatSnapshot;
    const hidden = () => defaultHidden || hideLeases.size > 0;
    const publish = () => {
        snapshot = Object.freeze({
            generation,
            customerCount: entries.length,
            activeRegistration: active?.id ?? null,
            launcherHidden: hidden(),
            state,
        });
        // One failed consumer must not strand other roots or lease cleanup.
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch {
                // Consumer errors do not change provider ownership.
            }
        }
    };
    const transition = (
        next: Entry | undefined,
        previousRegistration?: CustomerChatRegistration<Identity, Configuration>
    ) => {
        const previous = active;
        const preserveConversation =
            previous !== undefined &&
            next !== undefined &&
            options.isSameIdentity(
                (previousRegistration ?? previous.registration).identity,
                next.registration.identity
            );
        // Retire the old generation before any externally supplied cleanup.
        const ownGeneration = ++generation;
        active = next;
        const isCurrent = () => active === next && generation === ownGeneration;
        const previousConnection = connection;
        connection = undefined;
        const previousUnsubscribe = unsubscribe;
        unsubscribe = undefined;
        try {
            previousConnection?.retire(!preserveConversation);
        } catch {
            // A provider cleanup failure cannot resurrect an old lease.
        }
        try {
            previousUnsubscribe?.();
        } catch {
            // The generation fence remains effective even if removal fails.
        }
        if (!isCurrent()) return;
        state = idle;
        if (next) {
            let created: CustomerChatConnection | undefined;
            try {
                created = options.adapter.connect(
                    next.registration.configuration,
                    {
                        generation: ownGeneration,
                        isCurrent,
                        preserveConversation,
                        launcherHidden: hidden(),
                    }
                );
                if (!isCurrent()) {
                    created.retire(false);
                    return;
                }
                connection = created;
                const initialState = created.getState();
                if (!isCurrent()) {
                    created.retire(false);
                    return;
                }
                state = initialState;
                const remove = created.subscribe(() => {
                    if (!isCurrent()) return;
                    const nextState = created!.getState();
                    if (!isCurrent()) return;
                    state = nextState;
                    publish();
                });
                if (!isCurrent()) {
                    remove();
                    created.retire(false);
                    return;
                }
                unsubscribe = remove;
            } catch {
                const stillCurrent = isCurrent();
                if (stillCurrent) {
                    connection = undefined;
                    state = failed;
                }
                try {
                    created?.retire(stillCurrent);
                } catch {
                    // Ownership has already been retired.
                }
                if (!stillCurrent) return;
            }
        }
        publish();
    };
    const applyHidden = () => {
        try {
            connection?.setLauncherHidden(hidden());
        } catch {
            // The hide lease still has to be releasable after provider failure.
        }
        publish();
    };
    publish();
    return {
        register(registration) {
            const entry: Entry = { id: Object.freeze({}), registration };
            let released = options.environment === 'server';
            if (!released) {
                entries.push(entry);
                transition(entry);
            }
            return {
                id: entry.id,
                isActive: () => !released && active === entry,
                update(next) {
                    if (released) return;
                    const previousRegistration = entry.registration;
                    if (
                        options.isSameIdentity(
                            previousRegistration.identity,
                            next.identity
                        ) &&
                        options.isSameConfiguration(
                            previousRegistration.configuration,
                            next.configuration
                        )
                    )
                        return;
                    entry.registration = next;
                    if (active === entry)
                        transition(entry, previousRegistration);
                },
                showNewMessage(message) {
                    if (released || active !== entry) return 'inactive';
                    try {
                        return (
                            connection?.showNewMessage(message) ?? 'unavailable'
                        );
                    } catch {
                        return 'failed';
                    }
                },
                release() {
                    if (released) return;
                    released = true;
                    entries.splice(entries.indexOf(entry), 1);
                    if (active === entry) transition(entries.at(-1));
                    else publish();
                },
            };
        },
        acquireLauncherHide() {
            if (options.environment === 'server') return () => {};
            const token = {};
            hideLeases.add(token);
            applyHidden();
            return () => {
                if (!hideLeases.delete(token)) return;
                applyHidden();
            };
        },
        setDefaultLauncherHidden(value) {
            defaultHidden = value;
            applyHidden();
        },
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
