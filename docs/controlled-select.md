# Controlled Select fields

`SingleSelectField` and `MultipleSelectsField` from `@miniextensions/sdk/react`
accept controlled values and render their own list/dropdown/search/badges.
Existing `SingleSelectField({binding})` and `MultipleSelectField({binding})`
retain the binding contract; `BindingSingleSelectField` and
`BindingMultipleSelectsField` name those paths explicitly.

Import `@miniextensions/sdk/react/controlled-select.css` for the default controls.
It includes spaced Add/Clear buttons and native list inputs with focus and
disabled states, without a utility-CSS build. Input accents and focus outlines
inherit `--mx-sdk-field-theme-color`, then `--mx-sdk-accent` or the existing
`--theme-600` color scale, with a blue default.
Provide canonical name values separately from choice display labels, original
choice IDs (including pending blank IDs), available choices, and a real current
owner token/currentness check. The component owns only transient search/open
state. It does not save records, resolve credentials, or call a provider.

Set `readOnlyDropdownLayout: 'native-form'` on a controlled `SingleSelectField`
with `readOnly: true` and `presentation: 'dropdown'` to render the native Form
value holder and empty-state icon. Use this appearance for Form fields outside
the Grid. The empty caption comes from `labels.empty`.

Set `editableDropdownLayout: 'native-form'` on an enabled, editable controlled
`SingleSelectField` dropdown outside the Grid to use the native Form holder.
Tab focuses the closed control. The arrow keys or a click on the holder open
the choices. Remove a selection through its chip's named button. Choice
admission and the controlled value echo follow the same host contract.

`publishMetadata` is a synchronous host admission step for `{id:'', name,
newOption:true}`. A new choice is published before its selected canonical name.
The host must preserve the captured authority across only that exact metadata
transition. Refusal, exceptions and authority retirement do not trigger rollback,
provider creation, or a retry against a successor. A same-value Single selection
still reaches the native writer; the component does not discard its intent.
After an accepted selection, clearing search waits for the exact controlled
value echo and current owner. Single dropdowns close; Multiple dropdowns stay
open. A newer interaction, different value, owner replacement or edit-policy
change retires that pending UI update without retrying the writer.

`createSelectConditionEvaluation` takes explicit current record/schema/link
context and option rules. It owns compatible condition compilation and lazy
formula evaluation, including whole-AST compatibility fallback. Host value/date
adapters remain explicit; no native global store is accessed by SDK code.

This document describes the implementation contract, not verification. Package,
React 18/19, native Form/Save and browser acceptance require their own executed
receipts for the exact candidate.
