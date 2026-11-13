# Calendar surfaces

The dedicated `/react/calendar` entry contains `CalendarRecordPicker`,
`PortalCalendar` and the lower-level `CalendarMonthGrid`. These components take
already-admitted native data and semantic action ports. They do not create a
client, query cache, canonical record store, child form or relationship writer.
Native adapters, the qualified package pin and native/hosted acceptance remain
separate delivery obligations; an SDK check does not establish those outcomes.

Import `@miniextensions/sdk/react/calendar-complete.css` for the complete
surfaces. It composes the existing shared rich-leaf styles unchanged. Import
`@miniextensions/sdk/react/calendar.css` for the standalone month grid alone.
Picker details reuse `LinkedFinderRichLeaf` and `LinkedFinderCardField` from the
shared Finder delivery. There is no native JSX/render callback or unknown-field
string fallback. The native Portal Calendar compact presentation is deliberately
literal primary/optional subtitle, with no thumbnail or carousel.

`CalendarRecordPickerAcceptedFrame` separates a stable `control` owner/read port
from its exact `presentationOwner`, accepted records/schema, rich projections,
full canonical selected-ID array and semantic toggle. `selectionEnabled` is an
admitted native policy; the native toggle still makes the final cap/readonly
decision. Missing display projection is unavailable, never hydrated from cache.
The picker uses the actual multi-selection listbox hooks and keeps error before
loading. More is explicit, disabled while paging, and requests `resetOffset:false`.

`PortalCalendarAcceptedFrame` also separates stable month/read control from its
exact display owner. Its `retainedMonth` is the accepted canonical applied month.
The control owner must survive its own admitted month transition so that the
ordered forced read can follow; that does not retain the old cards' authority.
Each record's optional `open` and `remove` ports are separately admitted native
capabilities. Wide Open forwards the configured side policy; narrow Open forces
modal presentation. Child readonly/custom-view admission stays inside the
captured native opener, and absence of one action never grants another.

Portal's optional `registerVisibleRecords` callback receives a
`PortalCalendarVisibleRecords` descriptor after the SDK presentation commits.
Its frozen `recordIds` contains unique IDs of cards actually rendered: the
selected day's cards in narrow mode, or the displayed month's cards in wide
mode. Invalid-date and off-month wide records are absent, even when they remain
in the accepted native result. This membership is separate from canonical
record selection. Registration never runs during render or server rendering.

Keep the registration callback stable, for example with `useCallback`, and keep
accepted immutable records and schema stable across registration-driven parent
renders. Recreated frame, presentation-owner wrapper and action-array wrappers
do not republish membership. Real control/owner, presentation token, record,
schema, date-policy, status, day, width or displayed-month changes retire the
held descriptor. Retirement happens before its disposer and replacement
registration, including StrictMode cleanup and unmount. A failed `isCurrent()`
observation is permanent; data or presentation A → B → A cannot revive an old
descriptor. Currentness refreshes only against the latest committed equivalent
frame, and a synchronous successor publication cannot be borrowed by its
predecessor.

A native adapter can register the descriptor and mount its own existing child
owners only for its current IDs. This restores the native narrow selected-day
mount boundary: an off-day URL target must not mount and claim auto-open merely
because its record belongs to the accepted month. The descriptor grants only
SDK presentation membership. Native accepted-record ownership, route/open
claims, readonly/custom-view admission, child/write/save lifetimes and disposal
remain native checks; combine those with `isCurrent()` before a presentation
action. Replacing this descriptor does not cancel an already-authorized native
save or confer a native read/write capability. No native renderer, JSX slot,
copied day state or second Calendar controller is introduced.

Both surfaces retain their controller across ordinary display publications and
retire captured actions on owner/config/view replacement, ABA and unmount.
Portal record actions additionally retire on day/width presentation transitions.
The injected clock is a mount-lifetime context; replacing its object on a parent
render does not recenter the calendar. Its methods perform the current native
time/offset reads. Local UI updates after an admitted read do not grant record
authority or resynchronize an old accepted frame.

Import `@miniextensions/sdk/react/calendar` and its `calendar.css` subpath for
standalone grids and styles. The general `/react` entry intentionally keeps the
Calendar dependency graph separate: eagerly importing react-aria also imports
ReactDOM, which would change earlier DOM feature detection for unrelated fields.
`CalendarMonthGrid` uses react-aria 3.53.0, react-stately 3.51.0 and
@internationalized/date 3.12.4 together. Its optional locale provider localizes
dates and weekdays; labels supply localized navigation and event wording.
The Calendar build imports the exact 3.53.0 distribution through the
`calendar-react-aria` npm alias and bundles the selected hooks/date closure.
React and React DOM remain external optional peers, so a core-only SDK install
does not install React. The existing collaborator/scanner closure retains its separately
guarded react-aria 3.53.1 distribution. Do not relax that closure's version or
license guard to deduplicate these distinct consumers.
The source references the standard ES2023 Intl declarations required by that
graph, retaining strict library checking and the existing ES2022 runtime target.
Both runtime formats bundle the static ESM hook closure. Importing the upstream
CommonJS barrel also initializes unrelated widget modules; keep those out of
Calendar imports. Grid and listbox share one private `CalendarRuntime` closure,
so their locale and selection contexts agree. Both TypeScript compilers,
matching declarations and actual CommonJS output checks remain required.

`parseCalendarFieldDate` retains the native picker policy: DateTime uses each
field's effective display zone, while timestamp-shaped computed DATE values use
UTC. `getPortalCalendarDateKeys` retains the separate Portal policy: DateTime
uses the viewer zone or fallback offset, and computed DATE keeps the timestamp's
parsed zone. Portal arrays deduplicate day keys in first-seen order. Picker
ranges require two strings and clip inclusively to the query month. No helper
evaluates a formula, hydrates a missing record, or reads a cache.

The controllers borrow an immutable host frame with a real committed opaque
owner and a final `isCurrent` fence. Host ports return explicit synchronous
`{type: 'admitted'}` or `{type: 'refused', reason}` outcomes. A promise or void
return is not admission. The host retains transport, receipt, debounce, cache,
selection-cap, child and remove authority. Frame replacement retires captured
actions, including observed A → B → A. The host must advance its committed
identity on authority changes and fence dispatch itself.

Picker initializes its selected day from the UTC ISO clock, query month from
the local clock, and focus-month guard from the selected day. Highlighting uses
the independent local Date clock. Month focus advances the guards before one
scheduled first-page read; explicit More requests keep `resetOffset: false`.
The frame's `visibleDay` identifies its accepted day projection; local day
changes immediately retire prior-day record actions until a matching frame is
published. A captured record action cannot revive after local day A → B → A.
R30 compares the entire canonical membership against the proposed selection,
admits exactly one current visible-day delta, and invokes one semantic toggle.

Portal initializes local today only when it lies within the retained query
month, otherwise day one. Cross-month focus advances its guard, retains the
month, requests one forced first page, then commits the local day. Same-month
focus has no read. Applied month and local day stay separate on frame updates;
remount uses the current retained month. There is no midnight subscription or
automatic recentering. Controllers contain no subscription: composition must
rerender after local actions and publish new immutable host frames on change.

The grid controls local day presentation only. Picker uses six weeks and full
day/focus props. Portal uses variable weeks, omits grid keydown, forwards only
the wide-day aria-label, and forwards narrow-day button props. Narrow/wide
changes preserve the supplied day and issue no query or record write. SDK
composition seams accept already-rendered SDK content; the complete surfaces
own their structured record composition and separately fence its actions.
Narrow event dots reserve the native top-six spacing for the day number and
use reverse flex wrapping at the bottom; inline text line boxes can otherwise
push dense dot clusters into the number on phone widths.

The source suites exercise date/controller policies, real listbox interaction,
status/paging, clock replacement, focus refusal, synchronous month publication,
responsive actions and directly retained callbacks. The normal package matrix
uses installed React 18/19 ESM/CJS, strict declarations, CSS, cold SSR,
hydration and StrictMode; the existing native-browser runner owns trusted
Chromium controls. Execution results must identify the tested source/archive.
Synthetic SDK frames establish no native receipt, actual child lifecycle,
provider, fixture or hosted acceptance.
