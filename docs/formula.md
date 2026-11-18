# FormulaField

`FormulaField` from `@miniextensions/sdk/react` accepts the existing binding
props or the additive `mode: 'controlled'` contract. `FormulaFieldProps` retains
the published binding type, including its indexed `binding` property. Binding
rendering and `renderFormulaField` remain inert, escaped computed text.

Controlled callers supply current metadata validity, the effective result type,
the raw accepted value and their existing formatted text. The SDK chooses
SingleSelect, explicit sanitized HTML, a readonly URL gallery, a URL button,
then formatted text, in that order. Nonstring HTML/gallery values show the
existing unexpected-value error. Invalid metadata shows the invalid-field
error. Masking prevents rich presentation and resource activation.

The host can pass display-only Select choices, localized labels and an explicit
ordered gallery collection. It supplies no binding, renderer, store, writer,
upload, delete or annotation action. URL extraction remains the host's admitted
HTTP(S) policy; the gallery preserves duplicate entries and selected occurrences.
Replacement retains URL/optional-ID occurrences, then unique IDs, then clamps;
empty replacement closes the preview synchronously. Navigation reuses the
public singular `AttachmentPreview` and its media lifetimes.

Import the styles used by configured modes:

```ts
import '@miniextensions/sdk/react/controlled-select.css';
import '@miniextensions/sdk/react/html-description.css';
import '@miniextensions/sdk/react/complete-readonly-text.css';
import '@miniextensions/sdk/react/attachment-preview.css';
import '@miniextensions/sdk/react/readonly-url-gallery.css';
```

`ReadOnlyURLGallery` is also public for explicit readonly URL collections. Its
options control grid/Form layout, thumbnail fit/size, filename visibility and
open/download controls. These are display settings, not download authorization.
Image thumbnails in the list and dialog picker try the supplied `thumbnailUrl`,
full preview URL and original image URL in order, skipping duplicate URLs. If
all fail, `labels.previewNotAvailable` provides the failure text and
`labels.retry` customizes the **Try again** button. Retry restarts the same
granted sources and keeps the current selection. Non-image entries keep any
explicit image poster and otherwise use a glyph. Their original URL is reserved
for preview, Open and Download. Formula text alone does not supply a media URL.

The enclosing Form remains the label/help/Save owner; `inputId`, `labelledBy`
and `describedBy` associate controlled Formula presentation with that shell.
