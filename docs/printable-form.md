# Printable Form

`PrintableForm` owns the readonly document renderer, retained print job,
preparation, unique frame and bounded controls. The host supplies already
admitted display facts and opaque committed ownership through `PrintableFormSource`.
Load `@miniextensions/sdk/react/printable-form.css` in the consuming document.

```ts
import { PrintableForm } from '@miniextensions/sdk/react';
import {
    captureReadonlyPrintDocument,
    getDocumentPrintableFormAdmission,
} from '@miniextensions/sdk/ui';
```

The source has three synchronous ports:

- `readAuthority()` returns the committed opaque owner/read revision, separate
  explicit and keyboard gates, and a host-designated keyboard lease.
- `isCurrent(expected)` compares that exact owner/read revision with current
  canonical state. It must reject owner replacement and ABA, including changes
  to visibility or configured display authority.
- `capture(expected)` projects one complete flat configured-order document.
  Mask passwords and filter hidden values before constructing it. Preserve
  duplicate display occurrences, custom labels, errors and rich presentation.

The SDK copies and freezes whitelisted data. It never receives a store, client,
raw schema grant or action owner. An unsupported field or descendant refuses the
whole SDK document. The native integration may retain a whole native fallback;
it must use the same document admission and lifecycle protections. Passing a
native whole-field renderer is not required by the public component.

Use `getDocumentPrintableFormAdmission(actualDocument)` for every SDK/native
print route in that document. The host explicitly selects a keyboard lease with
`setKeyboardOwner(expectedLease, nextLease)`. Mounted order and
`preventDefault()` are not arbitration. Only the selected current source handles
the existing lowercase Ctrl+p gesture. Explicit button permission remains a
separate host gate.

Requests synchronously return `admitted`, `busy` or a bounded refusal. Busy is
established before private capture. There is no queue or automatic retry. An
admitted job retains its own immutable data and source DOM through asynchronous
rich content, image decoding, stylesheets, fonts and live input/canvas copying.
Preparation failure removes only its exact resources. Parent retirement before
invocation cancels and fences late work; busy admission remains held until
preparation and owned cleanup drain.

The default browser engine uses the platform print method in a unique iframe;
it does not use the legacy shared-ID `react-to-print` runtime. No additional
runtime dependency or peer override is needed. Browser rendering, media and print
dialog acceptance still require real browser qualification. Unsupported embedded
players/frames fail the stage rather than producing an unqualified blank player.

`afterPrintObserved` is only a browser lifecycle notification. `invoked` records
entry into the print method, while `unknown` conservatively retains an uncertain
invocation. Neither proves hardcopy, cancellation or dialog closure. The retained
SDK controls outlive the parent Form after invocation. Supply localized labels,
including an explicit acknowledgement such as “I have closed the print dialog.”
Only that acknowledgement calls `job.finish('explicit-dialog-closed')` and releases
the job after exact cleanup. An uncertain invocation is never automatically
retried. A custom engine is responsible for equivalent preparation/cleanup and
for placing its actual browser call inside the provided invocation fence.

`ReadonlyPrintDocumentView` can render the same admitted document independently,
including on the server. General imports and SSR do not allocate DOM, register
keyboard listeners, capture values or initialize ReactDOM. The complete external
example is `examples/react-printable-form`.

This implementation remains a work in progress until native production wiring,
all required package/React matrices and actual owned-browser print-preview,
Cancel, media, style and pagination acceptance are recorded. Synthetic DOM and
print-method spies do not establish those results.
