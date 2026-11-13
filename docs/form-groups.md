# Form sections and groups

`FormGroup` owns collapsible section presentation for one-page Forms. The host
keeps canonical field values and writers, visibility, validation, settings,
page/Review routing and Save. Import the optional styles alongside the complete
field styles used by the supplied children:

```tsx
import { createElement } from 'react';
import {
    FormGroup,
    CompleteMultilineTextField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-group.css';
import '@miniextensions/sdk/react/complete-multiline.css';
import '@miniextensions/sdk/react/html-description.css';

export function ContactSection(props: {
    value: string | null;
    onValueChange: (value: string) => void;
    allFieldsHidden: boolean;
    hasError: boolean;
    isReadOnlyPage: boolean;
}) {
    return createElement(FormGroup, {
        title: 'Contact',
        description: '<p>Contact details</p>',
        isExpanded: false,
        isReadOnlyPage: props.isReadOnlyPage,
        allFieldsHidden: props.allFieldsHidden,
        hasError: props.hasError,
        children: createElement(CompleteMultilineTextField, {
            id: 'contact-email',
            value: props.value,
            readOnly: props.isReadOnlyPage,
            onChange: props.onValueChange,
        }),
    });
}
```

Use the existing `ThemeBoundary` and `@miniextensions/sdk/react/theme.css` for
configured palette tokens. Public and config-preview headers use the same
theme-100 background, theme-200 hover and gray focus ring. Descriptions reuse
the existing `CompleteQuillHTMLRenderer`; they are Quill HTML, not Markdown.
Titles remain literal text.

The initial open state is `isReadOnlyPage || isExpanded`. Later default or
readonly metadata changes preserve the user's toggle state. A closed panel
unmounts its field children; reopening renders the current host canonical value.
Keep that state outside the section. `allFieldsHidden` suppresses the entire
group, so showing it again mounts a fresh disclosure with the current defaults.

The native adapter computes visibility by Airtable field **name**, errors by
field **ID**, and readonly page state before passing these booleans. The SDK
does not inspect child nodes or evaluate either policy. Existing field nodes,
keys, controllers and writer authority remain with the host.

For config preview, pass `preview: { startFieldId, onSelectSection }`. The title
button calls `onSelectSection(startFieldId)`; the separate disclosure retains
the literal `Expand …` / `Collapse …` labels. The native wrapper maps selection
to its current settings action and retains authoring authority. A null start
field falls back to the ordinary public title disclosure.

`groupFormFieldsBySections` from `@miniextensions/sdk/forms` accepts readonly
`FormSectionField<Field>` descriptors containing the original `field` and an
optional `sectionHeader`. Header metadata is `enabled`, `title`, `description`
and `isExpanded`. The host maps its configuration into these portable values.
Explicitly disabled or blank titles do not start a section; nonblank title
bytes and nonnull description bytes are preserved. Missing descriptions become
null, and expansion defaults to false.

The projection returns ordered `kind: 'field'` entries for the ungrouped prefix
and `kind: 'group'` entries with the original `fieldsInSection` references.
Boundaries include their own field. It never clones, deduplicates, sorts or
reads field values.

Render collapsible groups only in one-page mode. In multipage mode, retain the
host's existing page construction and render page fields without `FormGroup`.
The projection supplies no page router. Existing field IDs/error fragment links
remain host-owned; this extraction adds no automatic expansion, focus or
navigation behavior for error anchors.
