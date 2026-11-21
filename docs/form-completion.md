# Complete Form completion

`CompleteFormCompletion` is the stock post-submission success UI. It owns the
message spinner, local action countdown, localized status and new/copy controls.
The host supplies current projected data, initial submit eligibility and
explicit effect adapters. It does not submit or create a Form, install a session,
read account storage, or navigate by itself.

```tsx
import { createElement } from 'react';
import {
    projectFormCompletion,
    type FormCompletionConfiguration,
} from '@miniextensions/sdk/forms';
import { CompleteFormCompletion } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-completion.css';

const configuration: FormCompletionConfiguration = {
    afterFormSubmission: 'stay',
    successAction: true,
    successMessageStatic: '<p>Thank you for your response.</p>',
    successMessageCanCreateNewRecord: true,
    allowCopySubmittedToNewForm: true,
};
const projection = projectFormCompletion({
    configuration,
    language: 'en',
    filteredValues: {},
    unfilteredValues: {},
    fields: {},
    linkedTableStates: {},
});
const completion = createElement(CompleteFormCompletion, {
    configuration,
    projection,
    canSubmit: true,
    onCommand(command) {
        // Connect to the host's existing authorized effects.
        console.log(command);
    },
});
void completion;
```

The [standalone example](../examples/react-form-completion/README.md) includes
all outcomes and records navigation plans through a synthetic effect boundary.

Each actual mounted presenter has its own lifecycle. Its first eligible start
fixes the countdown duration, including explicit zero. Later committed renders
project current callbacks, configuration and values while keeping that schedule.
A new mount starts a new lifecycle; there is no global or per-record completion
token. Message delay is an independent mounted-body clock.

For headless use, `createFormCompletionCountdown` exposes `start`, `stop`,
`reset`, `retire`, subscription and a snapshot. Starting an active or completed
schedule is idempotent; explicit reset replaces the schedule. Stop cancels
pending timers. Retirement is permanent. `useFormCompletionCountdown` adapts the
same state to React and preserves the deadline through StrictMode effect
reconnection. It clears pending work when disconnected and never repeats an
already dispatched callback.

`projectFormCompletion` keeps the native policies distinct: static messages use
the public semantic sanitized HTML renderer, dynamic messages read filtered
values as plain text, and dynamic redirects intentionally read unfiltered
values using schema IDs and singleton lookup/error/blank rules. Labels include
all supported runtime languages and retain the custom-label fallback behavior.

`projectFormCompletionNavigation` returns ordered logout/navigation commands.
`projectFormCompletionClose` returns a close command. Raw relative redirect
strings stay relative and include an explicit self, parent or generated-parent
route. Generated embeds retain their actual iframe ID; their existing receiver
owns iframe/source/origin/protocol validation. Hosts must not invent a shared
URL base or infer successful navigation/closure from dispatch.

`dispatchFormCompletionCommands` checks current authority before every command,
including after an asynchronous adapter settles. It reports attempted count and
dispatched, revoked or failed status. A throw or uncertain dispatch is never
retried automatically. The native host retains accepted Save/record authority,
logout storage and actual browser effects.

The stylesheet includes the shared HTML presentation and supports
`--mx-sdk-completion-color` and `--mx-sdk-completion-background` for host themes.

## Read-only Form footer

`CompleteFormReadonlyFooterActions` renders the manual buttons as siblings in
the host's footer. The host owns placement, the adjacent record-actions menu,
and navigation using its current record and URL.

```tsx
import { createElement } from 'react';
import { CompleteFormReadonlyFooterActions } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/form-completion.css';

const footer = createElement(CompleteFormReadonlyFooterActions, {
    configuration: {
        successMessageCanCreateNewRecord: true,
        allowCopySubmittedToNewForm: true,
        enableLockingFormAfterSubmission: false,
    },
    language: 'en',
    mode: 'readonly',
    context: 'side-panel',
    hasParentExtension: true,
    hasExistingRecord: true,
    onCommand(command) {
        // Pass the intent to the host's authorized navigation handler.
        console.log(command);
    },
});
void footer;
```

In a read-only Form outside a modal, Submit another requires its own flag,
root ownership, and access other than through a login page. Copy requires its
own flag, an existing record, and locking off. With both actions eligible,
Submit another comes first. Editable and configuration-preview surfaces render
no footer buttons. Mounting emits no commands, and a button activates only its
own manual intent. `disabled` keeps visible buttons inert, and
`buttonClassName` applies the host's class to each button. If that class
supplies the complete button appearance, set `unstyled` to use it with
the footer's icon sizing and spacing.

Submit another uses the localized default for blank configured text. Copy uses
the localized default for null or missing text and preserves configured empty
text. Copy with visually blank text still has a localized accessible name.

The post-save presenter applies its own success-action eligibility. A root
Form in stay mode can expose both actions when enabled. Children, login-page
access, logout, other submission modes, and disabled success actions suppress
those manual actions. An empty configured Copy label suppresses the post-save
Copy button.
