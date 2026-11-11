# Complete Form header, cover, and footer description

The default components own presentation and source selection. Pass only the
current accepted, condition-filtered value and its matching field metadata.
They do not read records, fetch linked values, evaluate conditions, or own Form
state. The footer here is descriptive content; it has no Save or completion
behavior.

```tsx
import { createElement } from 'react';
import {
    CompleteFormHeader,
    CompleteFormCover,
    CompleteFormFooterDescription,
} from '@miniextensions/sdk/react';
import type { FormDisplaySource } from '@miniextensions/sdk/forms';
import '@miniextensions/sdk/react/form-header.css';
import '@miniextensions/sdk/react/html-description.css';

const identity = {
    owner: 'my-form',
    configuration: 'published-1',
    record: 'create',
};
const title: FormDisplaySource = {
    type: 'static',
    value: 'Project fieldnotes',
};
const description: FormDisplaySource = {
    type: 'static',
    value: '<p>Share your observations.</p>',
};
export function FormIntroduction() {
    return createElement(
        'div',
        null,
        createElement(CompleteFormCover, { identity, src: null }),
        createElement(CompleteFormHeader, {
            identity,
            title,
            extensionName: 'Fieldnotes',
            description: { enabled: true, source: description, truncate: true },
            language: 'en',
        }),
        createElement(CompleteFormFooterDescription, {
            identity,
            enabled: true,
            source: {
                type: 'static',
                value: '<p>Thank you for your time.</p>',
            },
        })
    );
}
```

Source facts distinguish `{ type: 'none' }`, static bytes, missing field/schema,
and a resolved field with an empty, null, or absent value. A blank static title
falls back to the extension name; a missing dynamic field does too. A valid blank
field stays blank. Formula title values remain plain multiline text after the
existing Markdown removal. Linked labels are optional admitted display metadata;
unresolved record IDs never become visible labels.

For field sources, provide `{ type: 'field', field: { status: 'resolved', field,
value, linkedRecordLabels } }`, or `{ type: 'field', field: { status: 'missing' } }`.
The label map contains only linked record IDs referenced by the selected current
value. Do not pass a global cache or recover values omitted by conditional
visibility. Logo field sources must contain an actual attachment array; the first
attachment URL is used, with decorative alt text and the stock logo dimensions.
Child mode suppresses legacy logos; child and modal cover policy is independent.

Description and footer master switches outrank retained source data. Both use the
public safe semantic HTML components, so sanitized empty content is absent and
meaningful media-only content remains. Pass a current record identity such as
`tableId:recordId` (or `create`); truncation resets across record A → B → A even
when content is identical. The owner scopes record identity, including create
drafts; configuration-only changes retain expansion when record and content are
unchanged. Owner/configuration identity must change when accepted authority changes.

Public consumers omit `preview`. An optional host preview capability provides
placeholder visibility, field-source visibility, and explicit settings commands;
it does not grant record, Save, navigation, or builder state authority. Callbacks
retire with their presentation identity and remain inert when capability is absent.
The `labels` input customizes presentation text; `language` selects the supported
stock disclosure translations.

See `examples/react-form-header` for a complete standalone consumer with local
images, source and record transitions, child mode, truncation, media-only HTML,
and optional preview controls.
