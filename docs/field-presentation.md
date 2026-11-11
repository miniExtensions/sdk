# Complete Form field presentation

Import `CompleteFormFieldPresentation`, `CompleteMultilineTextField`, and
`CompleteCheckboxField` from `@miniextensions/sdk/react`. Import these styles:

```ts
import '@miniextensions/sdk/react/field-presentation.css';
import '@miniextensions/sdk/react/complete-multiline.css';
import '@miniextensions/sdk/react/complete-checkbox.css';
import '@miniextensions/sdk/react/html-description.css';
```

The shell owns the title, required marker, HTML description, description image,
tooltip and error. Its children compose actual complete leaves using the same
per-mounted-field association. React-generated instance IDs survive value and
configuration rerenders and SSR hydration. Use the same React identifier prefix
for server/client roots; distinct independent roots need distinct prefixes.
Airtable field keys and writer ownership are separate from DOM identity.

```ts
createElement(CompleteFormFieldPresentation, {
    title: 'Notes',
    fieldName: 'Notes',
    associationKind: 'input',
    formId: 'existing-form',
    description: '<p>Describe the request.</p>',
    error: undefined,
    descriptionPlacement: 'tooltip',
    children: (presentation) =>
        createElement(CompleteMultilineTextField, {
            id: 'standalone-default',
            value: notes,
            onChange: setNotes,
            presentation,
        }),
});
```

Use `input` only when the complete leaf emits a labelable local control.
`group` and `non-labelable` emit a real shell-owned group, named by a span title,
with no `htmlFor`. Checkbox/toggle use `input`; Checkbox button and already
admitted Calendly presenters use `non-labelable`; native readonly displays use
`group`. Button state text retains its accessible name. Loading automatically
uses a group because there is no input. Meaningful HTML alone allocates the help
target: decorative description images do not create an absent text description.
Tooltip help retains one local visually hidden HTML counterpart; its separate
focusable popup uses the existing portable portal/collision primitive.

Standalone leaves retain their defaults. The additive `presentation` port
suppresses only optional leaf chrome and consumes shell IDs/form association.
`CompleteCheckboxField` is a pure controlled presenter for native checkbox,
toggle, button and readonly/grid modes. Its optional `calendlyPresenter` is an
already admitted display supplied by the consumer; no provider capability,
booking, writer or transport is created. Existing `CheckboxControl` and bound
`renderCheckboxField` remain independent and unchanged.

The host projects canonical visibility, readonly, conditional, autofill and
computed-empty policy. The shell does not evaluate conditions, own a draft,
authorize a write or alter section/page boundaries. Preview builder actions are
explicit nodes; `previewControlProps` admits its focusable tooltip/retry controls
to an existing host canvas policy. Preview mode alone grants no state writer.

Description images preserve the native per-mounted single failed-URL latch.
Text/value rerenders do not retry the same failed URL; replacing the trimmed URL
uses a new image key. Public failure suppresses the image; config preview offers
an explicit non-submit Try again button. True remount and placement/visibility
remount retry. A→B→A and reversed stale DOM events are characterized by mounted
component tests; this is not an attachment-thumbnail cache/generation policy.

Native first composition supports Checkbox and Multiline. Native readonly
Multiline still uses its canonical readonly renderer (including attachment/button
precedence). Other native field families keep their existing full native shell
until a real leaf adapter consumes the shared association. This extraction does
not claim every field, Form state, group or page is migrated.

Source components, installed React 18/19 ESM/CJS/types/CSS, SSR/hydration and
synthetic localhost browser checks use real complete leaves and public HTML.
They prove local associations, interaction and layout; synthetic callbacks do
not prove Airtable persistence or hosted/provider acceptance.
