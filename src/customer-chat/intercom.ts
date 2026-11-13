import type {
    ChatCommandResult,
    CustomerChatAdapter,
    CustomerChatState,
} from './index.js';

export type IntercomCustomerConfiguration = Readonly<{
    appId: string;
    name?: string;
    email?: string;
    user_id?: string;
}>;

export type IntercomCommand = (command: string, argument?: unknown) => unknown;

/** Host explicitly composes the actual intercom-next 1.3.5 exports here. */
export type IntercomPlatform = {
    loadIntercom(
        options: IntercomCustomerConfiguration & {
            initWindow: false;
            callBack(): void;
        }
    ): unknown;
    initIntercomWindow(
        options: IntercomCustomerConfiguration & {
            hide_default_launcher: boolean;
        }
    ): unknown;
    getCommand(): IntercomCommand | undefined;
    /** Must distinguish the real provider from its queued placeholder. */
    isAvailable(): boolean;
    /** An explicit host signal; the SDK never polls or automatically retries. */
    subscribeAvailability?(listener: () => void): () => void;
};

/**
 * Optional external driver. Importing or constructing it does no browser work.
 * Missing/empty IDs are refused, independent of native legacy fallback policy.
 */
export function createIntercomCustomerChatAdapter(options: {
    enabled: boolean;
    platform?: IntercomPlatform;
    existingProvider: 'reject' | 'host-handoff';
}): CustomerChatAdapter<IntercomCustomerConfiguration> {
    let acquired = false;
    let bootAccepted = false;
    let owner: object | null = null;
    let loading: CustomerChatState['loading'] = 'idle';
    return {
        connect(configuration, context) {
            const platform = options.platform;
            const token = {};
            let retired = false;
            let hidden = context.launcherHidden;
            let command: IntercomCommand | undefined;
            let removeAvailability: (() => void) | undefined;
            let visibilityListenersAccepted = false;
            const listeners = new Set<() => void>();
            let state: CustomerChatState = {
                loading: context.preserveConversation ? loading : 'idle',
                boot: 'idle',
                available: false,
                visible: null,
            };
            const current = () =>
                !retired && owner === token && context.isCurrent();
            const publish = (change: Partial<CustomerChatState>) => {
                state = Object.freeze({ ...state, ...change });
                for (const listener of [...listeners]) listener();
            };
            const send = (
                name: string,
                argument?: unknown
            ): ChatCommandResult => {
                if (!current()) return 'inactive';
                try {
                    command = platform?.getCommand();
                    if (!current()) return 'inactive';
                    if (!command || !bootAccepted) return 'unavailable';
                    command(name, argument);
                    return 'accepted';
                } catch {
                    return 'failed';
                }
            };
            const refreshAvailability = () => {
                if (!current() || !platform || !bootAccepted) return;
                const available = platform.isAvailable();
                if (!current()) return;
                publish({
                    available,
                    visible: available ? state.visible : null,
                });
                if (!available || visibilityListenersAccepted) return;
                const provider = platform.getCommand();
                if (!provider || !current()) return;
                // Intercom has no listener removal API. A partial registration
                // is inert; its captured generation is permanently retired.
                let pairAccepted = false;
                const visible = (value: boolean) => {
                    if (pairAccepted && current()) publish({ visible: value });
                };
                try {
                    provider('onShow', () => visible(true));
                    if (!current()) return;
                    provider('onHide', () => visible(false));
                    if (!current()) return;
                    pairAccepted = true;
                    visibilityListenersAccepted = true;
                } catch {
                    publish({ visible: null });
                }
            };
            const admitted =
                options.enabled &&
                platform !== undefined &&
                typeof configuration.appId === 'string' &&
                configuration.appId.trim().length > 0;
            if (admitted && context.isCurrent()) {
                owner = token;
                try {
                    command = platform.getCommand();
                    if (!current())
                        return {
                            getState: () => state,
                            subscribe: () => () => {},
                            setLauncherHidden: () => 'inactive',
                            showNewMessage: () => 'inactive',
                            retire() {
                                retired = true;
                            },
                        };
                    if (
                        command &&
                        !acquired &&
                        options.existingProvider !== 'host-handoff'
                    ) {
                        publish({ boot: 'failed' });
                    } else {
                        // Supply only these fields: caller bags cannot override
                        // initWindow, ssr, callbacks, identity or native defaults.
                        const settings: IntercomCustomerConfiguration = {
                            appId: configuration.appId,
                            name: configuration.name,
                            email: configuration.email,
                            user_id: configuration.user_id,
                        };
                        if (!context.preserveConversation || !bootAccepted) {
                            publish({ loading: 'requested' });
                            loading = 'requested';
                            platform.loadIntercom({
                                ...settings,
                                initWindow: false,
                                callBack() {
                                    if (current()) {
                                        loading = 'insertion-attempted';
                                        publish({ loading });
                                    }
                                },
                            });
                            // Existing-function load never calls callBack.
                            // Function/queue presence means acceptance only.
                            if (current()) command = platform.getCommand();
                            if (current() && command) {
                                acquired = true;
                                // Mark the pending boot before calling a host
                                // boundary that can synchronously replace us.
                                bootAccepted = true;
                                try {
                                    platform.initIntercomWindow({
                                        ...settings,
                                        hide_default_launcher: hidden,
                                    });
                                } catch (error) {
                                    if (current()) bootAccepted = false;
                                    throw error;
                                }
                            }
                        }
                        if (current()) {
                            publish({
                                boot: bootAccepted ? 'accepted' : 'idle',
                            });
                            send('update', { hide_default_launcher: hidden });
                            refreshAvailability();
                            const remove = platform.subscribeAvailability?.(
                                () => {
                                    if (!current()) return;
                                    try {
                                        refreshAvailability();
                                        send('update', {
                                            hide_default_launcher: hidden,
                                        });
                                    } catch {
                                        publish({
                                            available: false,
                                            visible: null,
                                        });
                                    }
                                }
                            );
                            if (current()) removeAvailability = remove;
                            else remove?.();
                        }
                    }
                } catch {
                    if (current())
                        publish({
                            loading: 'failed',
                            boot: bootAccepted ? 'accepted' : 'failed',
                            available: false,
                        });
                }
            }
            return {
                getState: () => state,
                subscribe(listener) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                setLauncherHidden(value) {
                    hidden = value;
                    return admitted
                        ? send('update', { hide_default_launcher: hidden })
                        : 'unavailable';
                },
                showNewMessage(message) {
                    return admitted
                        ? send('showNewMessage', message)
                        : 'unavailable';
                },
                retire(shutdown) {
                    if (retired) return;
                    retired = true;
                    const owned = owner === token;
                    if (owned) owner = null;
                    const shouldShutdown = owned && shutdown && bootAccepted;
                    if (owned && shutdown) bootAccepted = false;
                    try {
                        if (shouldShutdown) {
                            // Best effort only: queued/dispatched commands and
                            // script insertions cannot be recalled by cleanup.
                            try {
                                const retiringCommand = platform?.getCommand();
                                if (owner === null)
                                    retiringCommand?.('shutdown');
                            } catch {
                                // The broker has already retired ownership.
                            }
                        }
                    } finally {
                        listeners.clear();
                        removeAvailability?.();
                    }
                },
            };
        },
    };
}
