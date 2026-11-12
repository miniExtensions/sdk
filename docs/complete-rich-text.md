# Rich Text field and complete editor

The controlled `RichTextField` owns its Markdown engine, formatting toolbar, paste
handling, checkbox node views, formatted read-only presentation and styles. It
requires React and React DOM 18.3.1 or 19, and does not require Tailwind or a
caller-supplied editor.

```tsx
import { RichTextField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/rich-text.css';

<RichTextField
    value={storedMarkdown}
    onValueChange={setStoredMarkdown}
    identity={`${recordId}:${fieldId}`}
    id="notes"
    ariaLabelledBy="notes-label"
    placeholder="Write notes"
/>;
```

Values are nullable stored Markdown strings. Writes preserve the native stored
checkbox syntax (`[x] task`), while the editor displays real checkbox nodes.
Display normalization does not itself propose a write. Cosmetic newline updates
retain the editor; a semantic external replacement retires the previous document.
Change `identity` when the record or field owner changes, even when its value is
equal. Accessibility metadata updates preserve the current document and caret.

`readOnly` renders formatted Markdown and prevents editor writes. For a read-only
null value, supply localized `emptyContent`. `placeholder`, `accentColor`,
`linkColor` and `linkHoverColor` let a host provide its language and theme. The
browser engine loads after mounting; importing the public React entry or server
rendering does not initialize DOM state. Engine loading errors reach the caller's
React error boundary.

The component has no backend, upload provider, raw HTML expansion or Save
operation. The host retains permissions, canonical draft state and persistence.
Supply both `value` and `onValueChange` for the controlled editor contract. The
public `ControlledRichTextFieldProps` and `BindingRichTextFieldProps` types make
these two modes explicit and reject mixed controlled/binding props. The historical
`RichTextFieldProps` type retains its binding shape. Supplying
`binding` retains the existing escaped literal display, privacy rules and optional
`render` override; it does not acquire editor, write or Save behavior. The physical
`renderRichTextField` renderer also retains its literal display contract.

`CompleteRichTextEditor` remains compatible with its existing controlled props and
editor handle ref. `NativeRichTextEditor` retains its separate editor-slot API.

The private engine is adapted from the immutable revision recorded in the
distributed vendor `UPSTREAM.json`; original licenses and per-file source hashes
are retained alongside documented compatibility changes. It is not a public
vendor-module import surface.
