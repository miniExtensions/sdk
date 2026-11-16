# Native-compatible saved progress

`useNativeFormProgress` and `FormProgressConflictAlert` from
`@miniextensions/sdk/react` own the committed writer lifecycle and the complete
warning. Import `@miniextensions/sdk/react/form-progress.css` for presentation.
This uses `createNativeFormProgressStorage` from `@miniextensions/sdk/forms`,
not the separate public token/value `createProgress` protocol.

The host keeps its canonical Form draft, Restore decision/loading, selectors,
eligibility and successful Submit cleanup. Publish the original, **unfiltered**
record reference, including hidden values, through the original publication
object. Keep ports stable for the mounted consumer. Invoke the hook in the
actual Form; do not make a second Form state/store.

```tsx
import { createElement } from 'react';
import { createNativeFormProgressStorage } from '@miniextensions/sdk/forms';
import {
    useNativeFormProgress,
    FormProgressConflictAlert,
    type NativeFormProgressOptions,
    type NativeFormProgressPorts,
} from '@miniextensions/sdk/react';

// The host retains its existing per-share session writer identity/fallback.
export function progressPorts(
    getWriterId: (shareId: string) => string
): NativeFormProgressPorts {
    const storage = (shareId: string, writerId = 'reader') =>
        createNativeFormProgressStorage({
            shareId,
            writerId,
            getStorage: () => localStorage,
            getLocks: () =>
                typeof navigator === 'undefined' ? undefined : navigator.locks,
        });
    return {
        getWriterId,
        readSnapshot: (shareId) => storage(shareId).read(),
        remove: (shareId) => storage(shareId).remove(),
        write: (args) => storage(args.shareId, args.writerId).write(args),
        subscribeStorage(listener) {
            window.addEventListener('storage', listener);
            return () => window.removeEventListener('storage', listener);
        },
    };
}
export function FormProgress(props: NativeFormProgressOptions) {
    const { hasConflict } = useNativeFormProgress(props);
    return hasConflict ? createElement(FormProgressConflictAlert) : null;
}
```

Constructing ports/storage and rendering on the server perform no browser I/O.
All globals above are accessed only by invoked ports after commit. A host with
no browser must provide non-browser ports. The storage write must forward the
hook's `isWriteStillEligible` callback into the storage operation; checking it
before calling `write` loses cancellation while a Web Lock is pending.

Pass `surfaceEnabled: false` for previews: the writer retires without removal.
Pass `shareId: null` for a non-direct share: no progress work is performed.
`configurationEligible` is the host's saving-enabled, non-login, non-Compute
condition. False retires the writer then performs the existing unconditional
removal. A record whose `type` is not `create` retires the writer and leaves
removal to Submit's `removeIfOwned`. Teardown never deletes a draft.

`progressRead: undefined` means there is no Restore witness. An explicit
`{shareId, revision: null, writerId: null}` witnesses absence. The hook compares
this with a fresh synchronous snapshot before acquiring writer authority;
legacy revision zero participates in that comparison and upgrades once. The
native-compatible read returns undefined for missing, unavailable, and invalid
bytes after best-effort removal; the pure parser does not remove bytes.

The persisted record, when present, is the baseline; otherwise current hydrated
values are the baseline. Equality is `JSON.stringify` value equality. Equal
publications are suppressed, except a legacy upgrade or a retry admitted by a
later publication. An edit returning to baseline still writes. Admitted record
references remain in original order. Only the latest generation of the current
writer can arm unavailable retry. There are no timers or automatic retry loops.
Cancelled storage work neither advances revision nor arms retry/conflict.

Storage events are raw `{key, newValue}` inputs. Only the exact share key is
admitted: `key: null` is ignored, malformed non-null bytes are not removal,
same-writer replacements are ignored, and foreign writers/removal latch a
reload-required conflict. A surviving subscription observes the current writer,
not a captured generation. Conflict remains latched for that mounted share
across eligibility OFF/ON; it does not remove current entries or block Submit.

SDK synthetic lifecycle tests and packed ESM/CJS React 18/19 consumers do not
establish installed native Form, localhost, Restore/Save, or hosted acceptance.
Those require the actual host's installed package and existing native controls.
