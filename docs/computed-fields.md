# Controlled computed fields

`ComputedField` is an additive readonly presentation for physical Formula,
Rollup and Lookup fields. Existing binding-based APIs remain unchanged. The
host supplies its actual captured owner and identity, admitted metadata and
formatted display facts. There is no SDK field binding, value setter, formula
engine, resource producer or host renderer callback in this contract.

```ts
import {
    ComputedField,
    projectComputedFormulaDisplay,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/computed.css';

const projection = projectComputedFormulaDisplay({
    isValid: true,
    language: 'en',
    resultType: 'currency',
    value: canonicalValue,
    formattedValue: nativeFormattedValue,
    config: nativeDisplayConfig,
});

const props =
    projection.status === 'ready'
        ? {
              kind: 'formula' as const,
              owner,
              identity,
              display: projection.display,
          }
        : { kind: 'formula' as const, owner, identity, state: projection };
```

The outer control owns its DOM associations. Formula display facts omit nested
input/form/label/description IDs; a readonly Select retains its own generated
control ID. Put the shell's association on `ComputedField` itself. Formula keeps
the existing effective Select, explicit HTML, attachment, static URL Button,
then formatted-text precedence. Rollup uses the existing complete readonly Text
presentation and does not acquire Formula resource modes.

`projectComputedLookup` from `@miniextensions/sdk/ui` delegates value admission to
the existing ordered Lookup projection. It preserves original whole-array and
scalar references, occurrence indexes, duplicates, false/zero values, the native
empty/omission distinction and physical computed identity. The source field and
readonly display configuration are preserved by reference. An editable host
gets a new readonly configuration overlay without mutating its source.

Native schema types, localized formatting, choice/URL admission and captured
linked/attachment/Button authority stay in the host. Assemble their typed leaf
facts with `composeComputedPresentation`; it owns recursive ordering, empty and
error presentation. Missing, malformed or stale leaves fail closed. A ready
zero-occurrence sequence remains distinct from an outer empty answer.

Global masking returns before inspecting owner, source, values or resources.
Invalid Formula metadata and password configuration precede conversion and
rich-resource getters. Configuration projection copies only named display
options; it cannot manufacture resource or action authority from a URL.

The control reuses the complete Lookup presentation lease and rich leaves.
Owner retirement is monotonic for the same capture, including parent rerenders;
a new physical kind unmounts the previous presentation. Formula gallery owner
and identity preserve the existing explicit-gallery then resource fallback,
conjoined with the parent capture. Pending downloads retire on child replacement
or unmount and cannot publish a late result. Host capture renewal remains the
host's responsibility, including changes that batch back to equal values.

For a Formula gallery, the parent capture may represent the current Form policy
while the supplied resource capture binds one immutable value. Selection stays
open across admitted resource successors only while that parent remains current.
The resource capture still gates every preview, download and link; retiring the
parent closes selection permanently for that capture. Other Formula modes keep
their value-bound parent, including the HTML anchor default-action guard.
