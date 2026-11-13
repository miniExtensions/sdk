# Configured Single-line text

`SingleLineTextField` from `@miniextensions/sdk/react` renders a complete
configured native field. Import `@miniextensions/sdk/react/single-line-text.css`
for standalone styling. It composes the shared clearable/deferred input,
barcode scanner, Address autocomplete, read-only text and resource controls.
The caller owns canonical values, authority and explicit Save.

```tsx
import { useState } from 'react';
import { SingleLineTextField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/single-line-text.css';

export function Name() {
    const [value, setValue] = useState<string | null>(null);
    return (
        <SingleLineTextField
            mode="controlled"
            value={value}
            onChange={setValue}
            language="en"
            title="Name"
            characterLimit={60}
            initialMobile={false}
            form="existing-form"
            describedBy="name-help"
        />
    );
}
```

Strings display literally. Null displays as an empty input. Changes and Clear
write strings, including `''`, and retain trailing whitespace. Character limits
use the native `string.slice(0, limit)` operation and UTF-16 length counter,
including a slice that ends inside a surrogate pair. Loaded external values are
never truncated. Configured `readOnly` disables the editor and removes its limit
and counter; the distinct `mode="readOnly"` renders display presentation.

The ordinary input captures selection when its parent change handler executes.
Immediate changes capture then; deferred changes capture at blur, ordinary
Enter, or dirty unmount settlement. Deferred input keeps its existing IME/Enter
handlers. Its later value-echo reconciliation is separate from parent caret
restoration and can move selection to the end, as in the native field. Address
has its own forwarded input ref and never uses the ordinary caret-capture ref.

Deferred editing requires a genuine captured host owner:

```tsx
import {
    SingleLineTextField,
    type SingleLineTextEditOwner,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/single-line-text.css';

export function InlineName(props: {
    value: string | null;
    onChange(value: string): void;
    owner: SingleLineTextEditOwner;
}) {
    return (
        <SingleLineTextField
            mode="controlled"
            {...props}
            enableInlineEdit
            language="en"
            title="Inline name"
            initialMobile={false}
        />
    );
}
```

The opaque token follows the host's record, field and policy generation.
`isCurrent()` must synchronously return true at admission. Replacement retires
old unfinished work, including observed A-B-A and disable/re-enable. A genuine
current-owner dirty unmount retains the deferred input's original writer.
Switching to the distinct read-only mode retires the pending editor while the
field remains mounted; returning to editing creates a fresh generation.
Allocated host work keeps its existing settlement; the field neither cancels
it nor replays it against a replacement. Scanner sessions and new Address reads
are also checked before provider allocation. Scanner auto-start remains an
initial configured action and does not replay on re-enable.

`address: {mode: 'autocomplete', identity, reads, labels}` borrows the existing
authorized Address read ports. The identity contains the actual session, field
and read scope. Selection and formatted-detail values pass through the same
native slice as typing and scanner values. `address: {mode: 'preview',
explanation: 'Suggestions require the standalone form'}` has no read ports and
associates its explanation with the manual input. Password mode keeps any
retained Address configuration dormant. Importing or rendering a field performs
no camera/provider request; configured scanner auto-start runs after commit.

```tsx
import { SingleLineTextField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/single-line-text.css';

export function ReadOnlyName({ value }: { value: string | null }) {
    return (
        <SingleLineTextField
            mode="readOnly"
            value={value}
            language="en"
            obscurePassword
            displayAsAttachments
            displayAsButton
        />
    );
}
```

Read-only dispatch masks nonempty password text before resource selection.
Otherwise a valid HTTP attachment wins over button mode when both flags are
retained; button mode follows, then readable text. Empty password values retain
the ordinary empty/resource behavior. The existing safe URL policy and complete
resource controls handle links, previews and downloads. Native dispatchers still
validate string/null shape before projecting this presentation.

## Binding compatibility

`TextField` and `renderSingleLineTextField` remain the binding component and
renderer exports with their existing semantics. They still clear to null and
keep their binding-owned IME and surrogate-safe truncation policy. The new
`SingleLineTextField` uses explicit controlled/read-only modes; it does not
silently replace a binding or accept a whole-field renderer callback. Choose
the API that matches the caller's actual ownership contract.
