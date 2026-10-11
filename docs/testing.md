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

The existing workflow matrix stays on standard GitHub-hosted `ubuntu-latest`
with Node 22 and 24 and frozen pnpm installation. Both jobs run the same
coverage gate and retain reports for seven days, including on failure.
Existing installed CommonJS/ESM consumers, package-format/receipt guards,
recipes and the Node 24 native Chromium proof remain unchanged. No larger or
self-hosted runner, live-backend smoke, package publication or deployment is
introduced.
