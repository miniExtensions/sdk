# Customer chat lifecycle

The host creates one broker and supplies that exact object to every React root,
bundle and overlay. The explicit policy is last-registered customer ownership.
Equal host-defined identities preserve the conversation; different identities
switch it. Releasing the active customer restores only the latest mounted
customer. Final release shuts down the owned customer without inventing an
admin identity. Inactive and repeated releases do no provider work.

```ts
import { createCustomerChatBroker } from '@miniextensions/sdk/customer-chat';
import {
    createIntercomCustomerChatAdapter,
    type IntercomCustomerConfiguration,
} from '@miniextensions/sdk/customer-chat/intercom';
import { loadIntercom, initIntercomWindow } from 'intercom-next'; // host pins 1.3.5

// Application ports: real provider availability is distinct from queue presence.
declare const host: {
    customerChatEnabled: boolean;
    platform?: {
        getCommand():
            | ((command: string, argument?: unknown) => unknown)
            | undefined;
        isAvailable(): boolean;
        subscribeAvailability(listener: () => void): () => void;
    };
};
const broker = createCustomerChatBroker({
    arbitration: 'last-registered',
    isSameConfiguration: (a, b) =>
        a.appId === b.appId &&
        a.user_id === b.user_id &&
        a.name === b.name &&
        a.email === b.email,
    environment: typeof window === 'undefined' ? 'server' : 'client',
    isSameIdentity: (a: IntercomCustomerConfiguration, b) =>
        a.appId === b.appId && a.user_id === b.user_id,
    adapter: createIntercomCustomerChatAdapter({
        enabled: host.customerChatEnabled,
        existingProvider: 'reject', // or an explicit host-authorized handoff
        platform: host.platform && {
            ...host.platform,
            loadIntercom,
            initIntercomWindow,
        },
    }),
});
```

The SDK does not install or activate a provider on import. The optional driver
accepts the actual historical `intercom-next@1.3.5` pair; it does not replace it
with a successor. The host owns dependency installation, consent/enablement,
the platform and any explicit existing-provider handoff. The external adapter
requires an explicit nonempty app ID before reading or operating the provider.
Do not use an unrelated widget's settings, native app identity, credentials or
cookies as a fallback. Use separate broker/adapter instances for server requests;
server brokers and React SSR allocate no registrations, scripts or commands.

```ts
import {
    CustomerChatProvider,
    useCustomerChat,
    useCustomerChatLauncherHidden,
} from '@miniextensions/sdk/customer-chat/react';

// Inside a component; supply configuration equality in the host broker.
const chat = useCustomerChat({
    broker,
    identity: configuration,
    configuration,
    enabled: visitorConsent,
    configurationPreview: false,
});
// This controls a draft/open command. 'accepted' never means message delivery.
chat.showNewMessage('Please help with this form.');
useCustomerChatLauncherHidden(broker, overlayOpen);
```

`CustomerChatProvider` owns the same registration hook and accepts children or
a render function receiving its result. It adds no DOM. There is deliberately
no module-local context or singleton registry that could split ownership across
bundles. Every consumer supplies the broker explicitly. Updated configuration
retains mount order. Retained hook actions reject a changed generation;
registration leases reject inactive or retired callers.

Hide leases compose across all overlays. Releasing one cannot reveal the
launcher while another remains. App switches boot with the current hide value.
`setDefaultLauncherHidden` changes the shared host default restored after the
last hide lease. The SDK has no automatic availability polling or load retry.

The state has separate evidence fields:

- `loading`: idle, requested, insertion-attempted or failed. The 1.3.5 callback
  proves an insertion attempt only, including when no script anchor existed.
- `boot`: explicit command acceptance, not provider readiness.
- `available`: supplied by the host, independently of function/queue existence.
- `visible`: unknown until both current-generation visibility listeners were
  accepted and a visibility event arrives. Partial listener setup remains inert.

Cleanup fences future owner commands/callbacks and requests best-effort shutdown.
It cannot cancel already dispatched script insertions, queued commands or boots.
StrictMode effect replay can dispatch a boot, shutdown and another boot. The host
must account for the provider's real behavior; no message delivery is certified.

## Native composition boundary

The native host adapter must map nullish IDs to `undefined` and preserve `''`,
with host-defined identity equality. Historical 1.3.5 remembers a module app ID:
undefined falls back to it while empty remains empty. The external adapter above
does not grant this fallback. Account retirement, cookie cleanup, admin boot,
authentication and support delivery remain host services. Native fixed permission
help may use the current customer then host fallback; generic SDK help remains
registration-bound. The native 250ms launcher availability retry is an explicit
host policy. Do not run a second native registration map or hide counter alongside
this broker. Native migration is complete only after public registrations and
overlay leases use the same broker and the old maps/counters are removed together.

## License and qualification

The actual delivered 1.3.5 LICENSE is MIT, Copyright A11yWatch LLC, although its
package metadata declares ISC. The full delivered notice is retained in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md), along with the unmodified
synthetic test fixture's original metadata and license. Installed-artifact
qualification does not establish npm tarball or deployed-byte equivalence.

Source composition tests use the real broker/hook/driver with that historical
artifact in a synthetic VM. Packed consumers exercise ESM/CJS, declarations,
server-safe imports and real React 18/19. No real provider, telemetry, account,
message, cookie or authenticated delivery operation is part of qualification.
