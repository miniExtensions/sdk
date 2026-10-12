import type {
    LoadExtensionInput,
    LoadExtensionResult,
    MiniExtensionsClient,
} from '@miniextensions/sdk';
import {
    createSessionRestoration,
    type AuthPage,
    type SessionRestoration,
    type SessionRestorationLease,
    type SessionRestorationStorage,
} from '@miniextensions/sdk/auth';

/** App-owned tab storage, isolated between the starter's two synthetic visitors. */
export function createRememberedSession(options: {
    client: MiniExtensionsClient;
    apiOrigin: string;
    input: Extract<LoadExtensionInput, { shareId: string }>;
    visitor: string;
    context: string;
    storage(): Storage;
}) {
    const prefix = `miniExtensions-starter:${JSON.stringify([options.visitor, options.apiOrigin, options.context, options.input.shareId])}:`;
    let revision = 0;
    let held: SessionRestoration | SessionRestorationLease | null = null;
    const getScope = () => ({ ownerId: options.visitor, revision });
    const storage: SessionRestorationStorage = {
        mode: 'tab',
        getItem: (key) => options.storage().getItem(prefix + key),
        setItem: (key, value) => options.storage().setItem(prefix + key, value),
        removeItem: (key) => options.storage().removeItem(prefix + key),
    };
    return {
        prepare(page: AuthPage): SessionRestoration {
            held?.destroy();
            revision++;
            const adapter = createSessionRestoration({
                client: options.client,
                page,
                apiOrigin: options.apiOrigin,
                context: options.context,
                loadInput: options.input,
                getScope,
                storage,
            });
            held = adapter;
            return adapter;
        },
        accept(page: LoadExtensionResult, isCurrent: () => boolean): void {
            if (
                !held ||
                (page.extensionScreen !== 'form_loaded' &&
                    page.extensionScreen !== 'portal_loaded')
            )
                return;
            const previous = held;
            revision++;
            const lease = previous.handoff(page, getScope(), isCurrent);
            if (!lease) {
                previous.destroy();
                held = null;
                throw new Error(
                    'Session ownership changed. Choose Reload to try again.'
                );
            }
            held = lease;
        },
        clear(forgetOnly = false): boolean {
            // Explicit Logout also forgets this connection's entry after a
            // cancelled restoration retired its helper. Never clear all storage
            // or another visitor/origin/share's remembered credentials.
            try {
                const target = options.storage();
                const keys: string[] = [];
                for (let index = 0; index < target.length; index++) {
                    const key = target.key(index);
                    if (key?.startsWith(prefix)) keys.push(key);
                }
                for (const key of keys) target.removeItem(key);
                if (!keys.every((key) => target.getItem(key) === null))
                    return false;
                // Reconnect preflight may forget storage without retiring the
                // active in-memory visitor until every scope passes.
                if (forgetOnly) return true;
                held?.clear();
                held?.destroy();
                held = null;
                revision++;
                return true;
            } catch {
                return false;
            }
        },
        destroy(): void {
            held?.destroy();
            held = null;
            revision++;
        },
    };
}
