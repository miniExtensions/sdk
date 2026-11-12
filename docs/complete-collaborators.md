# Complete Collaborator fields

`CompleteSingleCollaboratorField` and controlled `MultipleCollaboratorsField` own
the searchable picker, option rows, selected badges, images, keyboard and
pointer interaction, focus handoff, readonly presentation and styles. They use
the same public UI in an independent site and in a native application adapter.
React and React DOM 18.3.1 or 19 are supported peers. Tailwind, Next, native JSX
renderers, SDK clients and field bindings are not required.

Importing the public entry and rendering readonly output do not initialize
React DOM or the picker engine. Editable server output includes an associated,
disabled loading input; the actual picker loads after a client commit. The
initial hydration markup matches that output. An accepted removal can hand
focus to the prepared input, while a refused action or focus moved elsewhere
cannot steal it later.

```tsx
import {
    CompleteSingleCollaboratorField,
    type CompleteCollaborator,
    type CompleteCollaboratorEditOwner,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-collaborators.css';

type Person = CompleteCollaborator & { upstreamRevision: string };

function Assignee(props: {
    offered: readonly Person[];
    value: Person | null;
    owner: CompleteCollaboratorEditOwner;
    propose: (value: Person | null) => void;
}) {
    return (
        <CompleteSingleCollaboratorField
            title="Assignee"
            inputId="assignee"
            formId="record-form"
            choices={props.offered}
            value={props.value}
            owner={props.owner}
            onValueChange={props.propose}
        />
    );
}
```

Use the natural public name for a complete controlled multiple field:

```tsx
import {
    MultipleCollaboratorsField,
    type ControlledMultipleCollaboratorsFieldProps,
} from '@miniextensions/sdk/react';

function Reviewers(
    props: Omit<ControlledMultipleCollaboratorsFieldProps, 'mode'>
) {
    return <MultipleCollaboratorsField {...props} mode="controlled" />;
}
```

The explicit discriminator keeps existing `<MultipleCollaboratorsField binding={binding}
render={...} />` calls and `MultipleCollaboratorsFieldProps` compatible. The same
binding contract is available as `BindingMultipleCollaboratorsField` and
`BindingMultipleCollaboratorsFieldProps`; `renderMultipleCollaboratorsField`
remains display-only. `ControlledMultipleCollaboratorsFieldProps<Person>` names
the controlled contract. `CompleteMultipleCollaboratorsField` remains a
compatible alias for the complete picker without a discriminator.

Multiple uses `value: readonly Person[]` and proposes `Person[]`; Single
proposes the original offered object or `null`. Entries are never converted
to IDs, reconstructed from labels, resolved by email or cloned. Removing an ID
removes every matching occurrence and retains each neighboring object and its
order. Duplicate stored occurrences remain visible, including readonly lookup
values. The badge label is literal `name || email`.

## Offered identities and the canonical writer

`choices` is the authoritative supplied offer, separately from the stored
`value`. An empty offer stays empty. A stored identity no longer in the offer
remains displayed and removable, but cannot be selected again after removal.
No identity service, discovery, workspace membership change or backend lookup
is performed. Search uses Fuse 6.6.2 over `name` and `email`, with threshold
`0.2`, `ignoreLocation: true` and `ignoreFieldNorm: true`.

The caller retains canonical state and decides whether to echo a proposed
value. The component never privately commits selection. A refusal or thrown
writer cannot leave a selected value behind. A focus request belongs only to
that attempted action and is consumed at its first reconciliation; a later
external value cannot fulfill an earlier refused request.

Pointer selection uses the same canonical proposal and focus receipt as removal.
It does not queue the picker's separate deferred refocus. After an accepted or
refused selection, moving to an adjacent field cannot be undone by a later
animation frame. Keyboard selection still uses the actual combobox actions.

`owner.token` identifies the actual current field/session/record/configuration
generation. `owner.isCurrent()` must read current caller authority when an
action runs. This is an explicit native-object action boundary, not a grant
inferred from an offered identity, a value hash or a scalar borrowed binding.
The caller must issue another token after a genuine owner replacement or
revocation. Once the SDK observes `isCurrent() === false`, that generation
cannot revive merely because the predicate later becomes true. Replacing the
token, hiding, disabling, changing readonly policy, changing input/form
identity or unmounting retires the old control and retained actions.

Equivalent labels, metadata, optional boolean defaults and canonical value
echoes preserve the current query, control and focus. Permission checks,
conditional visibility, canonical drafts, configured auto-computation and Save
remain caller-owned. Backend authorization is independent of this UI.

## Images, labels and accessibility

Avatar network authority is explicit. Omitted `avatarPolicy` and
`{type: 'none'}` render no image, even if a supplied object contains a URL.
An independent site may opt in to direct HTTP(S) sources on exact origins:

```tsx
avatarPolicy={{
    type: 'direct',
    allowedOrigins: ['https://avatars.example.com'],
}}
```

An application with an existing optimizer can instead provide a data-only
`{type: 'source', getSource(url)}` policy returning `src`, optional `srcSet`,
`sizes`, `loading` and `decoding`, or `null`. The SDK still owns the decorative
32×32 `<img>` markup. For example, a Next adapter can derive these attributes
with its public `getImageProps` API, retaining its configured loader and remote
allow-list. No required avatar JSX or Next dependency enters the SDK, and a
source integration must not widen the application's existing image authority.

`labels` localizes the placeholder, available/no-match/readonly-empty messages,
open button and `(label) => removeLabel`. Strings render literally.
`inputId`, `formId`, `labelledBy`, `describedBy` and `invalid` preserve native
label, form, help and error associations. `title` renders an SDK label unless
`showLabel` is false. The field remains a named group when a readonly or selected
Single has no input. Remove and open controls do not submit a surrounding form;
picker events remain inside the field boundary.

The stylesheet is scoped under `.mx-sdk-complete-collaborators`. Applications
can override `--mx-sdk-collaborator-accent`, `--mx-sdk-collaborator-tint`,
`--mx-sdk-collaborator-focus` and `--mx-sdk-collaborator-active` on that root
without supplying a renderer or a global utility stylesheet.

The natural `SingleCollaboratorField` and `MultipleCollaboratorsField` names
accept these complete picker contracts with an explicit `mode="controlled"`.
Their original binding calls (with no mode), explicit `Binding` exports and
renderer-slot helpers remain display-only, including their mask-before-read
and no-action contracts. `SingleCollaboratorFieldProps` retains its original
binding shape; `ControlledSingleCollaboratorFieldProps<T>` names the controlled
single contract. The `Complete` exports remain compatible.
