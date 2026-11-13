import {
    createElement,
    Fragment,
    useEffect,
    useRef,
    useSyncExternalStore,
    type ReactElement,
    type ReactNode,
} from 'react';
import type {
    CustomerChatBroker,
    CustomerChatLease,
    CustomerChatRegistration,
} from './index.js';

export type CustomerChatOptions<Identity, Configuration> =
    CustomerChatRegistration<Identity, Configuration> & {
        /** The same host-supplied broker object across all roots and bundles. */
        broker: CustomerChatBroker<Identity, Configuration>;
        enabled: boolean;
        configurationPreview?: boolean;
    };

/** Effects allocate registrations only after commit; SSR is inert. */
export function useCustomerChat<Identity, Configuration>(
    options: CustomerChatOptions<Identity, Configuration>
) {
    const { broker, enabled, configurationPreview, identity, configuration } =
        options;
    const lease = useRef<CustomerChatLease<Identity, Configuration> | null>(
        null
    );
    const snapshot = useSyncExternalStore(
        broker.subscribe,
        broker.getSnapshot,
        broker.getSnapshot
    );
    useEffect(() => {
        if (!enabled || configurationPreview) return;
        const registration = broker.register({ identity, configuration });
        lease.current = registration;
        return () => {
            if (lease.current === registration) lease.current = null;
            registration.release();
        };
        // Identity/configuration are updated separately without changing mount order.
    }, [broker, enabled, configurationPreview]);
    useEffect(() => {
        lease.current?.update({ identity, configuration });
    }, [broker, enabled, configurationPreview, identity, configuration]);
    // Bind commands to this render's committed registration. A retained action
    // must never gain authority over a later registration after re-enablement.
    const current = lease.current;
    return {
        snapshot,
        active: current?.id === snapshot.activeRegistration,
        showNewMessage: (message: string) =>
            broker.getSnapshot().generation === snapshot.generation
                ? (current?.showNewMessage(message) ?? 'inactive')
                : 'inactive',
    };
}

/** Render prop avoids a module-local Context identity across separate bundles. */
export function CustomerChatProvider<Identity, Configuration>(
    props: CustomerChatOptions<Identity, Configuration> & {
        children:
            | ReactNode
            | ((
                  chat: ReturnType<
                      typeof useCustomerChat<Identity, Configuration>
                  >
              ) => ReactNode);
    }
): ReactElement {
    const chat = useCustomerChat(props);
    return createElement(
        Fragment,
        null,
        typeof props.children === 'function'
            ? props.children(chat)
            : props.children
    );
}

export function useCustomerChatLauncherHidden<Identity, Configuration>(
    broker: CustomerChatBroker<Identity, Configuration>,
    hidden: boolean
): void {
    useEffect(() => {
        if (hidden) return broker.acquireLauncherHide();
    }, [broker, hidden]);
}
