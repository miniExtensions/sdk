# CSV export

`CSVExportButton` owns the complete download control, localized confirmation,
feedback and export pipeline. Import its stylesheet alongside the component:

```tsx
import { CSVExportButton } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/csv-export.css';
import type { CSVExportInput } from '@miniextensions/sdk/portals';

const input: CSVExportInput = {
    admission: {
        cohort: 'portal-grid',
        allowed: true,
        borrowedRecords: false,
    },
    columns: [{ key: 'Name', title: 'Contact name' }],
    rows: [
        {
            status: 'loaded',
            viewType: 'list',
            fields: [
                {
                    field: {
                        id: 'name',
                        name: 'Name',
                        config: { type: 'singleLineText' },
                    },
                    value: 'Synthetic example',
                },
            ],
        },
    ],
};

const control = (
    <CSVExportButton
        request={{ input, filename: 'Displayed contacts' }}
        labels={{
            download: 'Download',
            warning: 'Only displayed records are included.',
            continue: 'Continue',
            cancel: 'Cancel',
            help: 'Help',
            pending: 'Preparing',
            errors: {
                denied: 'Export is unavailable.',
                failed: 'Some rows failed.',
                loading: 'Rows are loading.',
                schema: 'Fields changed.',
                unexpected: 'Could not prepare the file.',
            },
        }}
    />
);
```

The host must supply its current committed admission, effective visible columns,
and already-admitted row details. The cohort name does not create permission.
Borrowed record presentation is denied. Ordinary field readonly is a separate
host concern. This API does not fetch records, inspect the DOM, recover caches,
create clients or infer export rights from record rendering/opening.

Zero rows does nothing. Fewer than 100 rows exports directly; 100 or more opens
a warning. Continue reads current committed inputs, including policy, schemas,
rows and filename. Cancel and Escape allocate no export resources. Once
synchronous preflight and detached projection succeed, that captured attempt
continues through asynchronous serialization and delivery, including replacement
or unmount. Separate explicit invocations remain separate; there is no implicit
single-flight or automatic retry of uncertain delivery. Owner retirement does
not cancel an allocated attempt; its temporary object URL is still revoked after
the click attempt.

`projectCSVExport` and `createCSVExportController` are also public through
`@miniextensions/sdk/portals`. Projection preserves supplied order, repeated rows
and columns, literal lookup keys and duplicate titles. Schema checks use the
union of row descriptors; an absent cell in one row remains blank. The resulting
readonly document contains only column keys/titles and formatted cells with
raw-number classification, without live record/cache/transport authority.

The standalone default uses the public readable-value formatter and suppresses
unavailable linked-record IDs. A host with compatible display differences may
supply `formatField`, a synchronous formatter for the admitted field/value only.
It must resolve linked labels from already-admitted information and preserve the
no-ID-fallback policy. It is not a fetch port or replacement serializer.

`serializeCSVExportDocument` uses CSV Stringify 6.4.6's asynchronous callback API.
Browser bundlers select its explicit `browser/esm` entry through the package
browser mapping; Node uses the package's normal ESM/CommonJS entry. Formula-like
headers and nonnumeric cells are neutralized while genuine raw numeric values
retain numeric text. Headers never replace the original lookup keys. Unicode,
quotes, newlines and header-only documents are retained.

Delivery resolves platform resources lazily after serialization: one text/csv
Blob URL, one anchor click, and exact URL revocation in `finally`. The supplied
filename is preserved without adding an extension. An optional platform boundary
supports synthetic testing; the SDK retains orchestration and serialization.

Failures expose only classified reason, row/visible-column counts and safe error
type. `onFailure` is a narrow telemetry adapter and receives no source error,
rows, headers or tokens. Public import, server rendering and controller creation
perform no download, storage operation or resource allocation.

Native adoption, provider-backed data acceptance and hosted export qualification
are separate integration evidence; synthetic package checks do not establish them.
