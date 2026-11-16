# Controlled Portal application shell

`CompletePortalShell` owns the stock responsive sidebar, topbar, mobile drawer,
group disclosures, hidden-header navigation, profile menu, welcome dialog,
logout confirmation, embedded iframe, styles and accessibility. Import
`@miniextensions/sdk/react/portal-shell.css` and the existing
`@miniextensions/sdk/react/html-description.css` for rich HTML titles and descriptions.
There are no host-rendered menu/header slots. `children` is only the host's
existing table/collection body.

`header.title` is plain text and is escaped. A host with an existing HTML-title
configuration may provide `header.titleHtml`; the shell renders it through
`CompleteHTMLRenderer` and its existing sanitizer and stylesheet. An explicitly
empty or fully sanitized title stays blank instead of showing `title`. Evaluate
formula values and choose the native logo/title presentation in the host snapshot;
the shell does not evaluate formulas or accept a rendered header callback.

For the native resizable desktop sidebar, supply `header.sidebarWidth` and
`onSidebarWidthCommit`. The shell uses the existing `re-resizable` engine,
previews the width while dragging, and reports the measured width only at drag
completion. Width is bounded to 120–600 pixels; absent or nonfinite width uses 288. Without this optional API the existing fixed sidebar is preserved. The
keyboard separator supports Left/Right in ten-pixel steps and Home/End. Mobile,
topbar and hidden-header presentations have no resize control.

The width remains canonical in the host. Validate each commit's scope/revision,
persist once using the existing portal-specific key, and publish the accepted
width. Revision, callback, owner, layout and mobile changes retire old gestures;
withdrawal restores the accepted presentation. Unmount discards an unfinished
gesture. Resizing never emits a navigation intent or remounts the record body.
The separate optional callback preserves existing `PortalShellIntent` handlers.
SSR includes the accepted width; the handle appears after mount. The resize
engine is loaded only for a configured mounted sidebar, so importing the public
SDK leaves other React hosts free to initialize their own browser environment.

```tsx
import { createElement } from 'react';
import {
    CompletePortalShell,
    type PortalShellSnapshot,
    type PortalShellSidebarWidthCommit,
} from '@miniextensions/sdk/react';

let revision = 1;
let snapshot: PortalShellSnapshot = {
    scope: 'portal:user',
    revision,
    items: [{ type: 'table', id: 'orders', label: 'Orders' }],
    selection: { type: 'table', itemId: 'orders', viewId: null },
    header: { layout: 'sidebar', title: 'Customer portal', sidebarWidth: 288 },
};
function acceptWidth(change: PortalShellSidebarWidthCommit) {
    if (
        change.scope !== snapshot.scope ||
        change.revision !== snapshot.revision
    )
        return;
    // Persist through the existing authorized host storage adapter, then publish:
    snapshot = {
        ...snapshot,
        revision: ++revision,
        header: { ...snapshot.header, sidebarWidth: change.width },
    };
}
createElement(
    CompletePortalShell,
    {
        snapshot,
        onIntent() {},
        onSidebarWidthCommit: acceptWidth,
    },
    'Host collection'
);
```

The host supplies an immutable `PortalShellSnapshot`. Evaluate existing menu and
custom-view predicates in the host, using its accepted record/configuration and
the existing condition compiler. Supply only eligible menu items and views;
an explicitly empty view list makes that table unavailable. The shell never
evaluates permissions, reads records, restores storage, reads the URL, logs out,
or closes a native sidepanel. A `scope` identifies the portal/user presentation;
its revision identifies the accepted configuration. Neither contains credentials.

```tsx
import { createElement } from 'react';
import {
    resolvePortalShellSelection,
    type PortalShellIntent,
    type PortalShellMenuItem,
    type PortalShellSelection,
} from '@miniextensions/sdk/portals';
import {
    CompletePortalShell,
    type PortalShellSnapshot,
} from '@miniextensions/sdk/react';

const items: readonly PortalShellMenuItem[] = [
    {
        type: 'table',
        id: 'orders',
        label: 'Orders',
        views: [
            { id: 'open-orders', label: 'Open orders' },
            { id: 'all-orders', label: 'All orders' },
        ],
    },
    {
        type: 'group',
        id: 'resources',
        label: 'Resources',
        items: [
            {
                type: 'embedded',
                id: 'guide',
                label: 'Guide',
                url: 'https://example.com/guide',
            },
            {
                type: 'external',
                id: 'docs',
                label: 'Documentation',
                url: 'https://example.com/docs',
            },
        ],
    },
];
// Run once at the host page boundary, after its URL/storage reads are accepted.
let selection: PortalShellSelection | null = resolvePortalShellSelection({
    items,
    phase: 'initial',
    initialSelection: { viewId: 'open-orders' },
    restoredSelection: null,
});
function acceptIntent(intent: PortalShellIntent) {
    if (intent.scope !== 'portal:user' || intent.revision !== 1) return;
    if (intent.type === 'navigate') {
        selection = intent.selection;
        // One host transaction: persist selection, close the sidepanel, and
        // invoke existing record loading only when the selected view requires it.
        // Then publish a new immutable snapshot and revision to React.
    }
    // Persist dismiss-welcome by portal/user/welcome ID, then publish dismissed.
    // user-settings opens the host profile UI; logout invokes host auth only
    // after the SDK confirmation. search-again invokes the existing host flow.
}
const snapshot: PortalShellSnapshot = {
    scope: 'portal:user',
    revision: 1,
    items,
    selection,
    header: { layout: 'sidebar', title: 'Customer portal' },
    user: { name: 'Customer', settingsEnabled: true, logoutEnabled: true },
    welcome: {
        id: 'welcome-v1',
        title: 'Welcome',
        messageHtml: '<p>Hello!</p>',
        dismissed: false,
    },
};
createElement(
    CompletePortalShell,
    { snapshot, onIntent: acceptIntent },
    'Host collection'
);
```

On later configuration changes call the pure resolver with `phase: 'reconcile'`
and the current accepted selection. It preserves a visible stable item/view ID,
falls back to the table's valid default/first view, then the first selectable
item, or returns `null`. The host commits any changed fallback once before
rendering its record body. URL parameters and older restored choices are ignored
in this phase. Keep that selection and the consumed initial URL state above any
shell/record-body remount; reconfiguration is not a new initial visit.

A valid initial view ID takes precedence over the initial table ID, followed by
eligible saved selection and the first selectable item. Ambiguous item/view IDs,
empty groups and invalid URLs are omitted. Embedded/external destinations must be
absolute HTTPS URLs without embedded credentials. Resolve dynamic URL values in
the host first. An accepted embedded selection carries its captured URL until
reselection; a now-invalid/removed menu item revokes it. The shell owns iframe
markup; browser iframe navigation naturally loads its destination. It never
loads collection records. External links are native anchors with isolated opener
and no second navigation callback; `_self` is an explicit host option.

Mount, SSR, hydration, hover, focus, group expansion and remount emit no intents.
One menu activation emits one scoped `navigate` intent; selecting the already
accepted item/view emits none. The shell suppresses repeated identical navigation, welcome dismissal and logout
confirmation intents until a new immutable snapshot is supplied. Settings/search
commands can be repeated after the host closes their UI. Hosts must still admit each intent
against their current owner/revision and preserve existing async guards. Do not
add a second selection effect in a menu item or a duplicate query subscription.
The host remains authoritative for storage, auth, record loading and sidepanels.

Welcome visibility is controlled by the host's accepted portal/user storage
snapshot. It appears only for nonblank, undismissed HTML; the SDK sanitizes rich
HTML through its existing renderer. Dismissal emits one intent and the host
persists and publishes `dismissed: true`; mounting never writes storage. User
settings and logout availability are separate host decisions. Escape/cancel
from logout confirmation produces no auth intent. Changing `scope` resets only
ephemeral UI state, never accepted host selection.

The navigation uses ordinary buttons/anchors and native disclosure semantics.
Arrow Up/Down, Home/End move among visible controls; Escape closes the current
group or drawer; Tab stays in an open drawer/dialog. Mobile navigation and
hidden-header controls restore focus to their opener on dismissal. A skip link,
landmarks, active-page indicators, accessible iframe titles and forced-colors
styles are included. Labels are replaceable for host localization.

SDK consumer tests use synthetic host adapters. They prove package/SSR/React
behavior, not native adoption or deployment acceptance. Native integration must
reconcile PortalView's shared hunks, preserve its landed condition compiler,
wire exactly one existing navigation/storage/query path, and run native and
permitted actual-deployment regressions before the whole ticket is Done.

## Configured descriptions and actions

All presentation options are additive. Omission retains the text user menu,
header actions, untruncated header description and 1024px responsive breakpoint.

`header.actionsPlacement: 'layout'` places the whole Search Again/user group
after sidebar navigation. Topbars keep it in the header from 640px upward and
put it after mobile menu rows below 640px. Sidebar navigation uses 1024px.
Empty menus retain the configured container; `hideMenuItems` withholds menu
rows without discarding explicitly placed utility actions or descriptions.
The native adapter still decides which headerless controls are available.

`descriptionOptions.placement: 'navigation'` places the existing HTML source
after menu rows. `truncate: true` reuses `CompleteTruncatedDescription` and its
measurement, sanitization and disclosure lifecycle. HTML or explicit `resetKey`
changes reset expansion; resize and presentation revision changes do not.
Keep `resetKey` stable for the same content. Labels `readMore` and `showLess`
are optional. An explicit empty description stays blank.

Explicit user `presentation: 'icon' | 'text'` uses the configured native
availability branches: settings-only is a direct icon/text control, logout-only
is a direct icon, both actions use a dropdown and neither produces a user
control. An empty text name remains blank. Omission or `'menu'` preserves the
existing text dropdown and name fallback.

```tsx
import { createElement } from 'react';
import {
    CompletePortalShell,
    type PortalShellSnapshot,
} from '@miniextensions/sdk/react';

const snapshot: PortalShellSnapshot = {
    scope: 'example:member',
    revision: 1,
    items: [],
    selection: null,
    header: {
        layout: 'sidebar',
        title: 'Portal',
        actionsPlacement: 'layout',
        descriptionHtml: '<p>Welcome to your portal.</p>',
        descriptionOptions: {
            placement: 'navigation',
            truncate: true,
            resetKey: 'portal-description',
        },
    },
    user: {
        name: 'Member',
        settingsEnabled: true,
        logoutEnabled: true,
        presentation: 'icon',
    },
};
const shell = createElement(CompletePortalShell, {
    snapshot,
    onIntent(intent) {
        console.log(intent.type, intent.scope, intent.revision);
    },
    labels: { readMore: 'Read more', showLess: 'Show less' },
});
void shell;
```

Logout confirmation is owned by the committed immutable snapshot and intent
callback. Replacing either retires an old confirmation permanently, including
A→B→A; a fresh current control can open another. Internal renders with the same
snapshot and callback retain it. Confirmation is consumed before dispatch, so
synchronous host publication cannot duplicate logout. This retires UI admission
before a host intent; it does not cancel or replay already allocated host work.
