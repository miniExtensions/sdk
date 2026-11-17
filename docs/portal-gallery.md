# Controlled Portal Gallery

`PortalGallery` renders the collection, rich cards, Open and Unlink controls,
inherited review indicators and manual paging. Import its packaged stylesheet;
it includes the shared card and HTML leaf styles.

```tsx
import { createElement } from 'react';
import {
    PortalGallery,
    type PortalGalleryRow,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/portal-gallery.css';

const rows: readonly PortalGalleryRow[] = [
    {
        key: 'example-occurrence',
        recordId: 'example-record',
        accessibleLabel: 'Example project',
        projection: {
            status: 'present',
            primary: 'Example project',
            primaryIsEmpty: false,
            language: 'en',
            layout: 'gallery',
            fields: [
                {
                    key: 'progress',
                    title: 'Progress',
                    leaf: { kind: 'literal', text: '0%' },
                },
            ],
            images: [],
            shouldRenderThumbnail: false,
            imageFit: 'contain',
            imageHeight: 160,
            thumbnailLocation: 'left',
            fieldsPerCardRow: 1,
            labels: {
                previousImage: 'Previous image',
                nextImage: 'Next image',
                noImage: 'No image',
                viewImage: 'View image {index}',
            },
        },
    },
];

createElement(PortalGallery, {
    label: 'Projects',
    columns: 5,
    width: 'fixed',
    content: { status: 'rows', rows, emptyLabel: 'No projects' },
});
```

Rows are ordered readonly projections. The presenter does not deduplicate, sort,
hydrate, query or keep a canonical collection. A native host can reuse
`projectNativeLinkedRecordRows` for its first-distinct model while preserving
raw occurrences and paging counts separately. Missing schemas and field metadata
do not confer action authority. The host supplies already admitted, filtered and
masked leaf values; the card does not recover hidden data from metadata or caches.

The responsive grid has a 200px minimum, 16px gaps and a one-to-six column cap;
the default cap is five. `resolvePortalGalleryColumns` accepts these numeric or
string configurations and defaults other inputs to five. Fixed width caps at
56rem; full width follows its host. Card height follows its content. Primary
empty styling uses explicit `primaryIsEmpty`, never a comparison with a localized
placeholder. Available titles have associated term/definition roles; withheld
titles remain unnamed value groups, without deriving labels from schemas.

The shared image controller preserves identity within the first six Gallery
thumbnails; failed images do not promote a seventh. List image fallback remains
an independent full-array policy. A temporary loading publication retains only
carousel selection/failure hints and resolves them against the next current image
vector; it retains no previous card values or actions. Unavailable, empty images
and List presentation retire these carousel hints. Attachment leaves accept ordered `entries`
with resolved `thumbnailUrl` or null and a filename. Missing/failed thumbnails
render an inert filename/document fallback. Omitted entries retain legacy images;
explicit empty entries do not recover those images. There is no original-URL
rewrite, document fetch, preview, download or retry authority in this leaf.

Supply `open` and `requestUnlink` only from actual current host capabilities.
Their captured functions are requests returning void; no returned Promise or
value is treated as admission or success. Open can register its real source
button with `registerTrigger`, whose cleanup retires only that registration.
The host retains child permissions, URL auto-open, neighbours and return focus.
Optional `testId` on a row, Open or Unlink control preserves a host's existing
automation association on the visible SDK leaf; it grants no action capability.
Unlink confirmation, current canonical membership, allocation, error handling,
reload and final settlement remain with the native host. `unlinkingRecordId`
controls all visible Unlink buttons and the matching spinner. Allocated work is
not canceled by component retirement. Review dots require an explicit inherited
label; the presenter has no review command.

`paging` exposes independent controlled request/spinner facts and one explicit
manual request. It remains visible when the host projects zero rows. The host
owns offsets, raw-count gates, scheduling and error continuation; mounting and
StrictMode allocate no reads or mutations. A controlled `reloading` overlay keeps
rows, image selection and Open registrations mounted. Loading and unavailable
content are explicit host presentations, with no automatic retry.
