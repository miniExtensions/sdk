# Calendar foundations

The additive `/ui` date projections and controllers, and `/react/calendar`
`CalendarMonthGrid`, prepare the Calendar extraction. They do not yet deliver
complete `CalendarRecordPicker` or `PortalCalendar` rich-card/native adoption.
The shared complete finder/card delivery remains a composition dependency.

Import `@miniextensions/sdk/react/calendar` and its `calendar.css` subpath for
standalone grids and styles. The general `/react` entry intentionally keeps the
Calendar dependency graph separate: eagerly importing react-aria also imports
ReactDOM, which would change earlier DOM feature detection for unrelated fields.
`CalendarMonthGrid` uses react-aria 3.53.0, react-stately 3.51.0 and
@internationalized/date 3.12.4 together. Its optional locale provider localizes
dates and weekdays; labels supply localized navigation and event wording.
Calendar imports the exact 3.53.0 distribution through the `calendar-react-aria`
npm alias. The existing collaborator/scanner closure retains its separately
guarded react-aria 3.53.1 distribution. Do not relax that closure's version or
license guard to deduplicate these distinct consumers.
The source references the standard ES2023 Intl declarations required by that
graph, retaining strict library checking and the existing ES2022 runtime target.

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
composition seams accept already-rendered SDK content; these do not grant
record actions or replace the required complete shared rich-card contract.

Source tests and installed React 18/19 ESM/CJS/type/SSR/hydration checks cover
these foundations. Real-browser, complete surface, native adapter and hosted
acceptance are separate evidence obligations.
