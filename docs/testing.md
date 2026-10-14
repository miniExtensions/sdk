# Source test coverage

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
