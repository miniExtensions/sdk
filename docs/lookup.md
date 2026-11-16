# Controlled Lookup presentation

`LookupField` from `@miniextensions/sdk/react` has an additive controlled mode.
The host supplies immutable result presentation and an actual captured owner;
the SDK renders complete readonly controls. The original binding-based Lookup
and `renderLookupField` API retain their inert native-array presentation.

```tsx
import { createElement } from 'react';
import {
    LookupField,
    type ControlledLookupFieldProps,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/lookup.css';

// Capture this from the real record/field/configuration/visibility lifetime.
declare const owner: ControlledLookupFieldProps['owner'];
declare const identity: unknown;
const props: ControlledLookupFieldProps = {
    mode: 'controlled',
    owner,
    identity,
    state: {
        status: 'ready',
        result: {
            kind: 'sequence',
            leaves: [
                { key: '0', result: { kind: 'literal', text: 'First' } },
                { key: '1', result: { kind: 'literal', text: 'First' } },
            ],
        },
    },
};
createElement(LookupField, props);
```

`projectLookupValues` from `/ui` admits the physical Lookup metadata and the
already-flat native array. It preserves the original result configuration,
member references, order, multiplicity and occurrence indexes. Scalar results
omit native-empty members. Attachments, multiple collaborators, nested Lookup,
linked records and multiple Select results receive the original whole array.
An empty scalar array differs from a nonempty array whose members are all empty.
Numeric zero remains visible; false Checkbox and zero Rating members are empty.
Masking precedes metadata and value access. Invalid metadata, native errors and
malformed wire values remain distinct states. No provenance is reconstructed.

The controlled result union covers text, sanitized HTML/Quill, readonly rich
text/Markdown, computed numeric/date/time/phone/duration/barcode/Checkbox/Rating,
Select pills or lists, supplied collaborators and avatars, Formula/Rollup,
attachment collections and URL galleries, and complete linked list/gallery or
table projections. Recursive sequences use unique occurrence keys. A linked
table supplies actual ordered cells; it does not need an invented list card.
List/gallery cards use the public rich-card projection. Rich values are not
flattened into generic labels.

Canonical value/configuration, localization and formatting/masking policy stay
with the host. The host passes the original computed status and its existing
readonly formatting. For rich linked/attachment results it supplies data-only
projections plus existing captured resource and child-open ports. Child Open
receives the actual SDK button, allowing the native owner to retain focus return.
Selection, linking/unlinking, Save, routing, filtering, record fetching and write
controllers are not duplicated in Lookup. No renderer callback, editor ref,
field binding, setter or metadata publisher is accepted in controlled mode.

`owner.token` identifies the actual capture, not a serialized value or record ID.
`isCurrent()` is rechecked before actions/resources; optional `subscribe` enables
immediate retirement. Equal values after a record/configuration A→B→A transition
do not renew old callbacks. Replacing `identity`, retiring the owner or unmounting
removes obsolete resources and invalidates callbacks. Resource dialogs retain
Close while stale. New resource navigation, carousel actions and image fallbacks
are refused after retirement. Already-admitted media cannot be retroactively
unrequested without a retirement notification; provide `subscribe` when the
native owner has one. Optional gallery/Word owner support is additive and leaves
owner-omitted legacy resource behavior intact.

Runtime admission rejects malformed flags, sparse/cyclic projections, duplicate
occurrence keys, undeclared image handlers, editor refs and React elements in
string-only metadata before rendering the affected cohort. A public DTO is not
an authorization credential. A native adapter must preserve genuinely current
source/resource authority and fail closed when it is absent or stale.

`lookup.css` composes the delivered rich-leaf styles and scoped Lookup layout.
The installed package check covers React 18/19, ESM/CJS, cold SSR, hydration,
strict public types and CSS/browser bundling. Focused source tests separately
exercise the real readonly Rich Text runtime, document rendering and cancellation.
Actual browser and native acceptance remain distinct qualification stages.
