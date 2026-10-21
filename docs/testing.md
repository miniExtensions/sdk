# Source test coverage

## Form Save response identity

`test/formSaveIdentity.test.ts` exercises the actual client and Form controller
with synthetic fetch responses. Saved edit record/table mismatches and malformed
identities must be rejected before lifecycle acceptance or dirty-field clearing.
The draft and dispatched uncertainty remain, and a second Save requires a fresh
load instead of replaying. Create responses may assign a new record ID, while
their table still matches the loaded Form configuration. Matching edit/create,
Compute and child contexts, structural-only normalization without a loaded
context, detached results and stale-owner replacement remain covered.

The normal package check also runs installed ESM/CommonJS consumers against the
packed SDK. These checks use local synthetic responses; they do not establish
live backend persistence or replace authenticated browser acceptance.

## Existing source coverage

Multiple Select presentation is covered by `test/reactMultipleSelect.test.ts`:
native array order, limits and unavailable selections, aliases, blocked/read-only/
pending controls, stale callbacks, optional Form creation, no implicit Save and
actual Portal Grid/List hosts. `pnpm check:package` also verifies installed
ESM/CommonJS components, public Form/Grid/List declarations, the CSS export and
the example bundle. After build, run
`node scripts/check-multiple-select-browser.mjs` for local packed-package
Chromium checks and screenshots. All these scenarios use synthetic owners.

Review regressions cover both masking flags from display and write configuration,
direct slots and real Form/Grid/List hosts, same-host snapshot retention,
binding/host A→B→A retirement, conservative standalone props replacement, and
creation completion after source replacement or unmount. The packed Chromium
proof also checks all four masking configurations and same-host draft retention.

Run `pnpm test` for the source coverage gate or `pnpm check` for formatting,
types, source coverage and the existing installed-package/recipe guards.
`pnpm test:unit` and `pnpm test:component` are focused diagnostic runs; only
the complete `pnpm test` run enforces the cross-profile policy. The SDK does
not have a separate lint command: Prettier and strict TypeScript are its
existing static checks.

Tests that directly import happy-dom mount native or React components and
belong to the component profile. Headless controller, field-model, protocol
and formula tests belong to the unit profile. Keep a direct happy-dom import
in component suites so this convention remains explicit. These are synthetic
tests; happy-dom does not establish real Chromium layout, browser event or
live backend behavior. The separate packed native Chromium scenarios remain
required in CI.

## Portal read failure guidance checks

`test/browserExamplePortalReadFailure.test.ts` mounts the shipped `PortalList`
with the exact `PortalReadFailureList` recipe from `docs/portals.md`. It checks
fixed network/5xx, denied and generic messages, raw-error suppression, explicit
fresh reads and stale-owner refusal. The separate vanilla-starter cases retain
its direct-collection generic feedback and manual Load contract; they do not
claim that the starter adopted `PortalListSnapshot.failure`.

`scripts/portal-read-failure-consumer-checks.mjs`, run by `pnpm check:package`,
checks installed ESM/CommonJS behavior and strict public declarations, including
detached kind/status-only snapshots, cancellation, reset and retired responses.
The custom shell uses normal public imports. These synthetic checks establish
no automatic retry or session change; they do not establish hosted authentication,
backend permissions or live persistence.

Attachment presentation regressions in `test/reactFieldComponents.test.ts` cover
phase messages and counts, explicit first-file upload, duplicate queue order,
indeterminate activity, disabled-control focus, uncertainty after Clear/remount,
owner replacement and completion after unmount. `pnpm check:browser` also runs
`scripts/attachment-presentation-browser-checks.mjs` against its installed archive
with sandboxed Chromium: native keyboard/chooser completion, removal focus,
selected/uploading/accepted/uncertain status, replacement during a flight, canceled
and lost responses, retired-owner late completion, unmount and a narrow viewport.
The receipt retains accessibility snapshots and screenshots. This is synthetic
local evidence; it does not certify OS-dialog cancellation, a screen reader or
live upload/Save persistence. A saved environment may select its supported Chrome
executable with `SDK_NATIVE_CHROMIUM`; Chromium's sandbox stays enabled.

## Measurement and denominator

The runner performs a clean isolated TypeScript compile with source maps and
uses pinned c8/V8 coverage on the compiled source. Both profiles include all
source files, including files never imported by a test. It unions raw V8 data
for the combined report; it never averages profile percentages. The policy
requires the report to contain every TypeScript source exactly once, and
rejects missing, duplicate or unexpected paths.

Type declarations have no executable behavior. Seven baseline source files
emit only `export {}`: auth/types, portals/types, ui/types, runtime/types,
runtime/rendererTypes, runtime/contracts/generated and formulas/lexer/token.
They remain in the raw reports. Before calculating executable-source gates,
the runner parses each emitted module and identifies empty modules structurally.
There are no path-based exclusions for generated code, error paths, React,
barrel exports or difficult modules. Adding any executable statement, import
or re-export to an empty module automatically includes it in the gate.

`coverage/source-metrics.json` records the full source inventory, exact empty
module list, raw totals, executable totals and each enforced threshold.
`coverage/{unit,component,combined}` contains c8 JSON, LCOV and HTML reports.
V8's mapped line/branch/function metrics quantify executed source, not every
possible condition combination or assertion quality. Review behavior and
failure-path assertions in addition to percentages.

## Baseline and enforced floors

The baseline is main `e42fc0a283ea1b5d940dcd1ec250b8a95ee10fff`, measured with
Node 24.19.0, TypeScript 5.9.3 and c8 11.0.0: 2,367 passing tests, 81 TypeScript
source files (74 with runtime statements). Executable coverage was 93.84%
lines, 88.66% branches and 92.73% functions. Raw totals including empty type
modules were 64.47%, 88.59% and 92.11%, respectively. React alone was 31.24%
lines and 30.56% functions; the broad model suite did not establish React
lifecycle coverage.

The strengthened Node 24 source suite passes 2,433 tests: 2,220 unit and 213
component tests, plus three separate coverage-policy regression tests.
Executable coverage is 97.40% lines/statements, 89.38% branches and 96.35%
functions. React is 98.41% lines, 86.02% branches and 92.11% functions; UI is
97.21%, 90.51% and 95.09%, respectively. CI reports the actual values for each
supported Node version; these local measurements are not a substitute for
exact-head CI or the independent native-browser gate.

`coverage-policy.json` is the checked-in acceptance floor, enforced in CI.
It gates the combined executable source and each public source area, with
independent unit auth/runtime/Form/Portal/formula and component React floors. Per-area gates stop
formula/model volume from hiding regressions in smaller authentication or
React code. Thresholds are minimums, not completion targets; raise them with
meaningful tested behavior rather than excluding uncovered paths.

New regression coverage exercises malformed authentication results, stale
owners and cancellation; Portal metadata and filter admission; real React
mount/unmount, subscription gaps, pending reads and binding replacement;
native text/number/date/duration/checkbox edits and attachment failures; and
linked-renderer hydration, retry and disposal. Held promises control races
without sleeps or automatic retries. Counterfactual checks confirmed that
removing binding identity and subscription refresh guards makes the relevant
React tests fail.

## CI and reproducibility

CI runs one Node 24 job named `check (24)` on standard GitHub-hosted
`ubuntu-latest` with frozen pnpm installation. Pull requests run one workflow;
push runs are limited to `main`. The job enforces the coverage gate and retains
reports for seven days, including on failure. Node 22 is not a CI target.
Existing installed CommonJS/ESM consumers, package-format/receipt guards,
recipes and the Node 24 native Chromium proof remain unchanged. No larger or
self-hosted runner, live-backend smoke, package publication or deployment is
introduced.

The Node 24 check name is unchanged. If repository protection still requires
`check (22)`, a repository administrator must remove that retired requirement;
the workflow does not change repository protection settings.

## Portal view availability checks

`evaluatePortalViewAvailability` is a headless snapshot decision. Pure tests
cover owning-field and view conditions, native parent data/schema, true legacy
versus all-hidden/refused lists, raw duplicate identities, valid direct links and
computed lookup relationships, invalid metadata and detached eligible configs.
Computed condition drivers remain unsupported; an outer computed lookup is a
different contract. Eligible configs retain canonical properties and are not
log-safe. The helper must perform no fetch, DOM or storage operation.

Installed ESM/CommonJS and declaration checks verify the public `/portals`
surface. Actual starter cases exercise the shared decision, exact selected IDs,
eligible neighbors and accepted-parent replacement. Keep owner/revision and
captured-action retirement assertions: pure helper results cannot prove those
lifetimes. A missing-export baseline failure proves only surface absence; a
behavioral regression must reach its choice/read oracle. These synthetic checks
grant no access and do not establish live authorization, freshness or backend
condition parity. Use the existing `pnpm check` gates; no live fixture is needed.

## Single Select presentation checks

`test/reactSingleSelect.test.ts` exercises the binding component, named helper and
the single-select path of `SelectField`. `pnpm check:package` exercises installed
ESM/CommonJS exports, public props/options, physical-kind and capability types,
Form/Grid/List recipes, optional `single-select.css`, and the local example.

Synthetic owners cover native choice-name/null drafts, configured display labels,
retained unavailable selections, static limits and ready/blocked availability.
Blocked availability keeps retained selections and owner-permitted Clear distinct
from admitting new choices. Readonly detail hosts remain distinct from accepted
static Grid cell editors; conditional inline editing is refused. Masks omit private values, options and
choice actions. Repeated controls, titles, associated feedback, pending state,
custom rendering, retirement and stale callbacks are checked without changing the
shared selection model or adding implicit Save.

Configured choice creation and cancellation use existing Form-owner actions with
held synthetic responses. Checks distinguish local create-name text from native
drafts, retain owner authority through remounts, and prevent old completion from
clearing a successor's text. Standalone-helper regressions preserve input for the
same incoming renderer-props object, retire it when that object is replaced even
with reused capabilities, and fence late completion across observed A→B→A
transitions. Explicit source and host-context identity retain precedence over
that fallback. These checks do not establish backend persistence or resolve an
uncertain choice operation by retrying it.

After building, run `node examples/react-single-select/dev.mjs` for the local
synthetic example at `http://127.0.0.1:4196`. The separate native Chromium proof installs the exact tested archive in its own clean consumer and runs
with `SDK_SINGLE_SELECT_CHROMIUM=/path/to/chromium node scripts/check-single-select-browser.mjs /path/to/checked-sdk.tgz /path/to/evidence`.
It covers native dropdown interaction, keyboard type-ahead and Tab/Space access, row-event containment,
layout and forced colors. Generated preview outputs remain ignored while the
example sources remain tracked and unignored. No live data or backend is involved.

The proof requires the browser sandbox, verifies every bundled SDK input comes
from the installed archive, records source/package/input hashes, and cleans only
its owned browser, server and temporary consumer. All synthetic write and
negative-interaction assertions remain active.

Task IDs: 3815.

The macOS headless run does not prove native popup arrow navigation: the same
limitation was reproduced with a plain native select. The receipt identifies this
limit separately from the passing type-ahead and keyboard Clear checks.

## Multiline Text presentation checks

`pnpm check:package` runs 20 installed ESM/CommonJS groups with synthetic owners.
They cover whitespace, blank and trailing lines, literal markup, native string/null
drafts, explicit clearing, composition completion and cancellation, character
limits, readonly controls, stale actions, owner replacement, custom binding
rendering and retired hosts. Unsupported append-only, attachment-display and
explicit masking signals from either configuration render only a status; the
checks assert that native values, controls, counts and value-derived feedback are
absent. The suite asserts no implicit Save or external request. Public exports,
the multiline-only slot, Form/Grid/List composition and guide recipes are
typechecked; the example is bundled using shared optional `text.css`.

Happy DOM retains textarea CRLF line endings. Its checks prove that mounting and
remounting leave the owner unchanged, and that a deliberate LF edit is accepted;
they do not establish native DOM line-ending normalization. After building,
`node scripts/check-multiline-text-browser.mjs` runs the separate local Chromium
proof, including native textarea line endings and Enter inserting a newline.
Simulated composition is not a real input-method certification. These checks do
not implement rich text, append operations, attachment workflows or login.

## Email presentation checks

`pnpm check:package` exercises the installed Email exports in ESM and CommonJS,
including single-line whitespace/case/Unicode, invalid address drafts, explicit null
clearing, composition completion, stale actions, readonly and masked controls,
custom binding rendering and retired hosts. These tests use synthetic owners and
assert that no implicit Save occurs. Installed declaration checks cover public
props/options, the Email-only slot and Form/Grid/List composition. The public
example is typechecked and bundled against the archive using the existing
optional `text.css`; Email adds no stylesheet export.

After building, `node scripts/check-email-browser.mjs` runs the separate local
Chromium proof. It distinguishes stopped event bubbling from native enclosing
form submission. Simulated composition is not a real input-method certification.
Neither suite validates delivery, sends mail or contacts a live backend.

## URL presentation checks

`pnpm check:package` exercises installed URL exports in ESM and CommonJS with
synthetic owners. The checks cover literal single-line values, including relative
paths and `javascript:`/`data:` strings, without links, navigation or requests;
explicit null clearing; composition completion; stale actions; readonly and
masked controls; binding overrides; and retired hosts. They assert no implicit
Save. Public props/options, the URL-only slot, Form/Grid/List composition and guide
recipes are typechecked. The example is compiled and bundled against the archive
using the shared optional `text.css`; URL adds no stylesheet export.

After building, `node scripts/check-url-browser.mjs` runs the separate local
Chromium proof. Native form submission and stopped event bubbling are distinct;
simulated composition does not certify a real input method. These checks do not
establish a navigation policy or contact a live backend.

## Last Modified Time presentation checks

`test/reactLastModifiedTime.test.ts` covers the readonly binding and named helper.
`pnpm check:package` runs installed ESM/CommonJS consumers with synthetic owners,
including public props/options, readonly negative types, physical-kind slot
rejection, Form/Grid/List composition and both guide recipes.

Coverage includes the exact-true validity gate, raw timestamps and offsets,
null/missing/nonstring values, and CR/LF display sanitization without changing
native bytes. Validity and nested result-metadata transitions preserve the owner's
answer. Referenced-field metadata does not cause record reads or timestamp
calculation. Direct helper fallbacks remain distinct from malformed host admission.
Forged capabilities cannot grant edits or supply a date model.

Disabled input/Clear, masks, associated feedback, title fallback, repeated IDs,
custom rendering, wrong-kind bindings and retirement remain covered. Physical
Last Modified Time is readonly with `isComputed: false`. Real synthetic Form
composition and Portal Grid/List detail hosts preserve native values without
computed inline editing bindings. Rendering adds no reads, writes or Save;
editable DateTime and Text neighbors retain their existing behavior.

The `examples/react-last-modified-time` fixture uses shared optional `datetime.css`.
Its source files stay tracked and unignored, and generated preview outputs stay
ignored. After building, run `node examples/react-last-modified-time/dev.mjs` for
the local example at `http://127.0.0.1:4195`. Run the separate native Chromium proof with
`SDK_LAST_MODIFIED_TIME_CHROMIUM=/path/to/chromium node scripts/check-last-modified-time-browser.mjs`.
It uses synthetic owners and checks disabled interaction, native-value retention,
event containment, layout and forced colors without a live backend. Synthetic
composition does not certify every platform's input method or screen reader.

Task IDs: 3815.

## Created Time presentation checks

`pnpm check:package` runs 20 installed ESM/CommonJS groups with synthetic owners.
They cover raw timestamp strings, offsets and fractional seconds, naive and
invalid strings, null/missing/nonstring values, and single-line CR/LF sanitization
without native normalization. Accepted nested date/dateTime metadata changes leave
the same owner's answer intact. Direct metadata and capability traps verify that
the renderer borrows no formatter, date model or write authority.

Checks include disabled input/Clear, masking, title fallback, associated feedback,
repeated IDs, custom rendering, wrong-kind bindings and stale/retired controls.
Physical Created Time remains readonly with `isComputed: false`. Real synthetic
Form composition and Portal Grid/List detail hosts preserve native strings; each
Portal fixture makes one explicit synthetic load, with no render-triggered reads,
writes or Save. Editable DateTime and Text neighbors remain functional.

Public props/options, readonly negative types, physical-kind slot rejection,
Form/Grid/List compositions and both guide recipes are typechecked. The example
uses shared optional `datetime.css`, with tracked source files and ignored preview
outputs. After building, `node scripts/check-created-time-browser.mjs` runs the
separate local browser proof using `examples/react-created-time`. No live data or
production backend is involved.

Task IDs: 3815.

## Last Modified By presentation checks

`pnpm check:package` runs 20 installed ESM/CommonJS groups with synthetic owners.
They cover the supplied native collaborator name, empty/null/missing values,
malformed direct helper values, privacy of email/ID/avatar data, metadata choice
changes without identity resolution, and retained native objects. Forged editable
capabilities and binding model access traps cannot grant edits. Disabled input and
Clear, masking from either configuration, associated plain-text feedback, repeated
IDs, stale controls, custom rendering and hidden or retired owners are covered.
The adjacent Text field still accepts explicit edits.

Actual Form composition and Portal Grid/List detail hosts retain readonly
capabilities. Physical Last Modified By remains readonly even with `isComputed: false`.
Each Portal fixture uses one explicit synthetic load; rendering adds no requests,
writes or Save. No computed inline editing binding is created. Public props and
options, canonical collaborator values, readonly negative types, wrong-kind slots,
Form/Grid/List composition and both guide recipes are typechecked. The example
compiles and bundles with shared optional `text.css`; its source files remain
tracked and unignored while generated preview outputs stay ignored.

After building, `node scripts/check-last-modified-by-browser.mjs` runs the separate local
Chromium proof. The `examples/react-last-modified-by` synthetic fixture serves on
`http://127.0.0.1:4193`. These checks perform no identity lookup and load no avatar
resources.

## Created By presentation checks

`pnpm check:package` runs 20 installed ESM/CommonJS groups with synthetic owners.
They cover the supplied native collaborator name, empty/null/missing values,
malformed direct helper values, privacy of email/ID/avatar data, metadata choice
changes without identity resolution, and retained native objects. Forged editable
capabilities and binding model access traps cannot grant edits. Disabled input and
Clear, masking from either configuration, associated plain-text feedback, repeated
IDs, stale controls, custom rendering and hidden or retired owners are covered.
The adjacent Text field still accepts explicit edits.

Actual Form composition and Portal Grid/List detail hosts retain readonly
capabilities. Physical Created By remains readonly even with `isComputed: false`.
Each Portal fixture uses one explicit synthetic load; rendering adds no requests,
writes or Save. No computed inline editing binding is created. Public props and
options, canonical collaborator values, readonly negative types, wrong-kind slots,
Form/Grid/List composition and both guide recipes are typechecked. The example
compiles and bundles with shared optional `text.css`; its source files remain
tracked and unignored while generated preview outputs stay ignored.

After building, `node scripts/check-created-by-browser.mjs` runs the separate local
Chromium proof. The `examples/react-created-by` synthetic fixture serves on
`http://127.0.0.1:4192`. These checks perform no identity lookup and load no avatar
resources.

## External Sync Source presentation checks

`pnpm check:package` runs 20 installed ESM/CommonJS groups with synthetic owners.
They cover canonical computed Form bindings, literal SDK strings and unknown
labels, empty/null/missing values, metadata choice changes on the same owner,
forged editable capabilities and model access traps. Defensive direct helper
checks reject object-to-name extraction and coercion. Disabled input and Clear,
masking from either configuration, associated feedback, stale controls, custom
rendering and hidden or retired owners remain covered. The adjacent Text field
continues to accept explicit edits.

Actual Form composition and Portal Grid/List detail hosts retain readonly
capabilities. The Portal fixture makes one explicit synthetic load; rendering
adds no reads, writes or Save. It creates no computed inline editing binding.
A separate malformed `isComputed: false` fixture preserves the existing host
rejection while proving that the direct wrapper remains inert. Public props and
options, readonly negative types, the SDK string value contract, wrong-slot
rejection, Form/Grid/List composition and both guide recipes are typechecked.
The example compiles and bundles with shared optional `text.css`; its seven source
files remain tracked and unignored while generated preview outputs are ignored.

After building, `node scripts/check-external-sync-source-browser.mjs` runs the
separate local Chromium proof. All fixtures are synthetic. These checks do not
claim support for arbitrary raw Airtable objects or perform synchronization.

## Count presentation checks

`pnpm check:package` runs 20 installed ESM/CommonJS groups with synthetic owners.
They cover readonly Form bindings without a scalar, finite native displays,
null/missing values, invalid metadata retaining a nonempty native number,
same-owner validity changes through explicit synthetic reloads, malformed metadata
rejection by hosts and blank direct-helper display, forged capabilities,
masking from either configuration, associated feedback, stale controls, custom
rendering and hidden or retired owners. The adjacent Number field remains editable.

Actual Form composition and Portal Grid/List detail hosts retain readonly Count
capabilities. The Portal fixture makes one explicit synthetic load; rendering and
rerendering add no reads, writes or Save. It does not fabricate a computed inline
cell binding. Public props/options, readonly negative types, wrong-slot rejection,
Form/Grid/List composition and both guide recipes are typechecked. The local
example compiles and bundles with shared optional `number.css`; Count adds no
stylesheet export, and its sources remain tracked while preview outputs are ignored.

After building, `node scripts/check-count-browser.mjs` runs the separate local
Chromium proof. All fixtures are synthetic. These checks do not calculate linked
record counts, introduce integer/range policy or contact a live backend.

## AutoNumber presentation checks

`pnpm check:package` runs 16 installed ESM/CommonJS groups with synthetic Form
owners. They verify disabled native-number display, zero/fraction/negative/exponent
values, null and missing values, no writes on mount/remount, and defensive blank
display for nonfinite or nonnumeric input. Forged editable capabilities with
throwing scalar accessors and setters remain unused. Masking from either config,
unique labels, feedback, pending state, wrong-kind status, custom rendering,
owner replacement and retirement are covered without Save or requests.

Public props/options, readonly AutoNumber capabilities, wrong-slot rejection,
Form/Grid/List composition and guide recipes are typechecked. The example is
compiled and bundled against the archive with shared optional `number.css`;
there is no AutoNumber stylesheet export. Its seven source files must remain
unignored and generated preview files ignored. After building,
`node scripts/check-autonumber-browser.mjs` runs a separate local Chromium proof.
These checks do not test server-side number generation or introduce a local
sequence, editing action or validation policy.

## Rating presentation checks

`pnpm check:package` runs 18 installed ESM/CommonJS groups with synthetic owners.
They cover native negatives, fractions, above-maximum values, exponents, retained
partial input, empty/null/zero distinctions, readonly/masked controls, missing or
mismatched scalar bridges, custom rendering and stale actions. A separate actual
page owner proves that required Rating zero blocks Next and final Submit without
rewriting the zero or reaching transport. This is distinct from the scalar's
invalid-input Save refusal and does not claim universal validation by a lower-level
binding Save call. Number, Currency and Duration dispatch remain covered.

Public props/options, the Rating-only slot, Form/Grid/List composition and guide
recipes are typechecked. The example is compiled and bundled against the archive
using shared optional `number.css`; Rating adds no stylesheet export. After
building, `node scripts/check-rating-browser.mjs` runs the separate local Chromium
proof. Applications own native enclosing-form submission; simulated composition
does not certify real OS input methods. These checks do not introduce stars,
range enforcement or a rating-specific parser and contact no live backend.

## Percent presentation checks

`pnpm check:package` exercises installed Percent exports in ESM and CommonJS
with synthetic scalar owners. Checks cover unchanged native fractions, values
outside zero-to-one, precision and progress metadata, partial drafts and remounts,
empty-to-null edits, zero, blocked invalid Save, stale actions, missing or wrong
scalar capabilities, readonly/masked controls and custom binding overrides.
They also retain Number, Currency and Duration dispatch and assert no implicit
Save. Public props/options, the percent-only slot, Form/Grid/List composition and
guide recipes are typechecked. The example is compiled and bundled against the
archive with shared `number.css`; Percent adds no stylesheet export.

After building, `node scripts/check-percent-browser.mjs` runs the separate local
Chromium proof. Native enclosing-form submission and stopped event bubbling are
distinct. Simulated composition does not certify a real input method. All values
are synthetic; the checks do not contact a live backend or introduce a progress
bar or percent-formatting policy.

## Phone Number presentation checks

`pnpm check:package` exercises installed Phone Number exports in ESM and CommonJS
with synthetic owners. The checks cover literal single-line values, including
leading zeros, punctuation, extensions, Unicode digits and `tel:`/`sms:` strings;
explicit null clearing; composition completion; stale actions; readonly and masked
controls; binding overrides; and retired hosts. Country-code metadata does not
add a selector or format a value. The checks assert no links, navigation, requests
or implicit Save. Public props/options, the phone-number-only slot, Form/Grid/List
composition and guide recipes are typechecked. The example is compiled and bundled
against the archive using shared optional `text.css`; Phone Number adds no
stylesheet export.

After building, `node scripts/check-phone-number-browser.mjs` runs the separate
local Chromium proof. Native form submission and stopped event bubbling are
distinct; simulated composition does not certify a real input method. These checks
use synthetic drafts and do not establish a dialing policy or contact a live backend.

## Formula presentation checks

`test/reactFormula.test.ts` covers native result configurations, scalar and
array-valued results, null/missing/error/special-number values, malformed data,
metadata failures, masking before formatting, labels and feedback, binding
replacement/retirement, readonly authority and an editable Number neighbor.
Synthetic accepted Form and Portal Grid/List compositions add no reads, writes
or Save. `pnpm check:package` checks installed ESM/CommonJS runtime and public
positive/negative types using the packed package.

For the separate packed-browser proof, build/validate the package and run:

```sh
SDK_FORMULA_CHROMIUM=/path/to/chrome node scripts/check-formula-browser.mjs /path/to/sdk.tgz /path/to/evidence
```

The script installs the tarball into a temporary consumer, launches sandboxed
Chromium, checks inert outputs, masking, private-ID suppression, native state,
zero requests/writes and retirement, and captures desktop, mobile and forced-color
screenshots. It uses synthetic data only. It supplements `pnpm check:browser`;
it does not certify live backend behavior or every screen reader.

## Rollup presentation checks

`test/reactRollup.test.ts` covers native result formats, scalar and top-level
array results, duplicates/null members, invalid metadata/values, native errors,
special numbers, masking from both configuration surfaces, inert markup, labels,
feedback, readonly authority, binding replacement/retirement and an editable
Number neighbor. Synthetic accepted Form and Portal Grid/List hosts add no reads,
writes or Save. Provenance IDs do not trigger hydration. Installed ESM/CommonJS
runtime scenarios and positive/negative public types run in `pnpm check:package`.

For the separate author-run packed-browser proof, build/validate the package and
run:

```sh
SDK_ROLLUP_CHROMIUM=/path/to/chrome node scripts/check-rollup-browser.mjs /path/to/sdk.tgz /path/to/evidence
```

This sandboxed Chromium check uses synthetic accepted Form values and the exact
retained tarball, checks native state, inert text, masking, private-ID suppression,
zero requests/writes and retirement, and captures desktop, mobile and forced-color
screenshots. It supplements `pnpm check:browser` and is not a separate hosted CI
workflow stage. It does not certify live backend behavior or screen readers.

## Lookup presentation checks

`test/reactLookup.test.ts` exercises the native flat-array/result-metadata
contract, duplicates/null occurrences and distinct empty owner data, native
errors, canonical formats, unsupported/malformed values and metadata, masking
before conversion, labels/feedback, physical readonly authority, owner visibility
and retirement, accepted Form/Portal hosts and an editable neighbor. Visible Form
fixtures explicitly use `hideFieldIfEmpty: false`; the existing unsupported
Lookup empty-hiding refusal is asserted separately.

`pnpm check:package` serially awaits installed ESM/CommonJS Lookup cases and
strict positive/negative declarations, including separate physical slots,
array-only values, readonly capability and the public React-only export boundary.
Existing package groups and worker/cleanup assertions remain enabled.

For the separate local packed-browser proof, validate the package and run:

```sh
SDK_LOOKUP_CHROMIUM=/path/to/chrome node scripts/check-lookup-browser.mjs /path/to/sdk.tgz /path/to/evidence
```

This sandboxed Chromium proof checks installed-package bundle provenance, inert
native outputs, masking, unresolved-ID suppression, malformed-value refusals,
unchanged native data, zero I/O/actions, retirement and desktop/mobile/forced-color
screenshots. It supplements the unchanged ordinary `pnpm check:browser`; it is
not a separate hosted CI stage or live backend, OS picker or screen-reader proof.

## Native radio input acceptance

The existing `pnpm check:browser` harness also runs the installed public
`RadioInput` through `scripts/browser-radio-input-checks.mjs`. Its separate
`radioInput` receipt contains three native-browser groups: trusted label/Space
activation with opt-in/default repeat behavior; Arrow navigation and identical
names isolated by native form owners; and controlled refusal plus readonly,
disabled and cancelled-event admission. Every group checks native refs and zero
form submits. The fixture owns only synthetic checked state and explicit flags.

The normal sandboxed browser and isolated contexts are retained. Source and
bundle hashes, installed SDK inputs, trusted-event receipts, accessibility
snapshots, screenshots, unexpected requests, page errors and cleanup are saved.
A launch/access denial means no acceptance evidence. These actual Chromium
checks supplement source/Happy DOM checks and do not claim hosted persistence,
manual dogfooding, other browser engines or a screen-reader session.
