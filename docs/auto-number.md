# AutoNumber display

Use the public `AutoNumberField` from `@miniextensions/sdk/react` for a complete
readonly display. Import `@miniextensions/sdk/react/complete-readonly-text.css`.
The controlled contract shares `CompleteReadOnlyTextField`'s literal text, links,
localized empty values, sizes and layouts.

```tsx
import { AutoNumberField } from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/complete-readonly-text.css';

<AutoNumberField mode="controlled" value="0" language="en" />;
```

`mode="controlled"` requires an already projected string, `null`, or `undefined`
and an explicit SDK language. Native consumers keep their existing readonly value
conversion and pass its exact output. `"0"` is a visible zero; `null`, `undefined`
and `""` use the localized empty presentation. Literal whitespace, leading zeros
and markup-like text are preserved. The field uses the existing readonly text
link policy and accepts its optional `textSize`, `layout` and `className` props.

The native Form keeps its current label, help, error, readonly and preview shell.
Standalone consumers can compose the display inside
`CompleteFormFieldPresentation` with `associationKind="group"`. The display
creates no input, required rule, generated-record identity, setter, transport,
Save action or provider request.

The existing binding call, `<AutoNumberField binding={binding} />`, retains its
original disabled number presentation, masking, validation, visibility and custom
`render` semantics. `BindingAutoNumberField` is an explicit compatibility export
for that contract; the historical `AutoNumberFieldProps` name remains its props
alias. New controlled consumers can use `AutoNumberControlledProps`. The two
contracts cannot be combined in one call. `renderAutoNumberField` and
`AutoNumberFieldOptions` retain the existing renderer-slot contract.
