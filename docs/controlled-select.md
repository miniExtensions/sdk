# Controlled Select fields

`SingleSelectField` and `MultipleSelectsField` from `@miniextensions/sdk/react`
accept controlled values and render their own list/dropdown/search/badges.
Existing `SingleSelectField({binding})` and `MultipleSelectField({binding})`
retain the binding contract; `BindingSingleSelectField` and
`BindingMultipleSelectsField` name those paths explicitly.

Import `@miniextensions/sdk/react/controlled-select.css` for the default controls.
Provide canonical name values separately from choice display labels, original
choice IDs (including pending blank IDs), available choices, and a real current
owner token/currentness check. The component owns only transient search/open
state. It does not save records, resolve credentials, or call a provider.

`publishMetadata` is a synchronous host admission step for `{id:'', name,
newOption:true}`. A new choice is published before its selected canonical name.
The host must preserve the captured authority across only that exact metadata
transition. Refusal, exceptions and authority retirement do not trigger rollback,
provider creation, or a retry against a successor. A same-value Single selection
still reaches the native writer; the component does not discard its intent.

`createSelectConditionEvaluation` takes explicit current record/schema/link
context and option rules. It owns compatible condition compilation and lazy
formula evaluation, including whole-AST compatibility fallback. Host value/date
adapters remain explicit; no native global store is accessed by SDK code.

This document describes the implementation contract, not verification. Package,
React 18/19, native Form/Save and browser acceptance require their own executed
receipts for the exact candidate.
