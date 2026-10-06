# Formula evaluation

`@miniextensions/sdk/formulas` evaluates expressions locally. It implements a
subset of Airtable-style formulas; it does not promise complete Airtable formula
compatibility or fetch Airtable records.

## Basic use

```ts
import { FormulaRunner } from '@miniextensions/sdk/formulas';

const formula = new FormulaRunner('2 + 3 * 4');
const value = formula.run(); // 14
```

The constructor parses the expression. `run()` evaluates it and normally returns
a string or number. Construct one runner and replace its context when evaluating
the same formula against different records.

## Distinguishing values from formula faults

Use `runWithOutcome()` when a caller must distinguish data from an evaluation
fault. It evaluates the current expression once and returns the exported
`FormulaRunOutcome` union:

```ts
import {
    FormulaRunner,
    type FormulaRunOutcome,
} from '@miniextensions/sdk/formulas';

const result: FormulaRunOutcome = new FormulaRunner(
    'AND(1, REGEX_MATCH("sample", "["))'
).runWithOutcome();

if (result.type === 'error') {
    console.log(result.code); // 'runtime-error'
} else {
    console.log(result.value); // string or finite number
}
```

The error codes are `runtime-error` for recognized evaluation faults and invalid
converted results, and `non-finite-result` for numeric `NaN` or infinity. Numeric
faults keep that code when another expression consumes them. A literal
`'#ERROR!'`, including a returned text field with that value, remains a successful
text result. An explicit native computed `{error: string}` cell or array member
retains its fault provenance before readable formatting. Numeric error members
of actual computed arrays are also rejected before formatting can turn them into
text. This behavior does not change the shared readable-value formatter.

`ISERROR(...)` can handle recognized formula faults and returns numeric `1`.
Function arguments remain eager, including unselected `IF` branches. Neither
method catches unknown-field errors, unsupported-function errors, parser errors,
or unrelated exceptions such as an invalid `REGEX_REPLACE` pattern. An invalid
`REGEX_MATCH` pattern is a recognized formula runtime fault.

`run()` retains the legacy outer `'#ERROR!'` representation for recognized
faults and still returns top-level numeric `NaN` or infinity. Those numeric values
propagate as faults when consumed by logic, arithmetic, comparisons,
concatenation, unary minus, or supported function calls. For example, `-1 / 0`
still returns numeric negative infinity, while `-(1 / 0)` consumes infinity and
returns `'#ERROR!'`. Bare invalid date conversions or missing `IF` results can
still return legacy `null` or `undefined`; `runWithOutcome()` rejects them as
`runtime-error`, as does consuming them in another expression. Replacing the
context does not retain an earlier outcome or error state.

## Field references and context

```ts
import {
    AirtableFieldType,
    FormulaRunner,
    type InterpreterContext,
} from '@miniextensions/sdk/formulas';

const context: InterpreterContext = {
    record: {
        id: 'recExample',
        fields: { fldQuantity: 4 },
    },
    airtableFields: [
        {
            id: 'fldQuantity',
            name: 'Quantity',
            isPrimaryField: true,
            config: {
                type: AirtableFieldType.NUMBER,
                options: { precision: 0 },
            },
        },
    ],
    linkedTableLoadingStates: {},
};

const formula = new FormulaRunner('{Quantity} * 3');
formula.context = context;
console.log(formula.run()); // 12
```

References can use a field name or ID. Record values may be keyed by either. If
both are present, the current engine prefers the name-keyed value. Linked-record
primary values prefer field IDs, with name-keyed fallback.

Linked-record labels require supplied linked-table metadata and records. The
engine uses record IDs when that context is unavailable. It performs no network
request to fill missing data.

Unknown fields throw by default. `new FormulaRunner(source, true)` instead
evaluates an unknown field as an empty string. Field references and `RECORD_ID()`
require a context.

## Loaded Form and Portal metadata

Loaded metadata can be passed directly, using its JSON field discriminators or
the existing `AirtableFieldType` constants. Keep computed `options.result`
metadata intact: the runner converts the returned cell value; it does not
recompute an Airtable formula or write a computed field.

These functions are application recipes. API linked-table states need the
engine's loaded-state envelope. Use states from the same current visitor and
loaded context; the runner never fetches missing linked records.

```ts
import type {
    AirtableValue,
    FormLoadedResult,
    PortalLoadedResult,
    RuntimeTableStates,
} from '@miniextensions/sdk';
import type { FormDraftSnapshot } from '@miniextensions/sdk/forms';
import type { InterpreterContext } from '@miniextensions/sdk/formulas';

type FormulaLinkedStates =
    | RuntimeTableStates
    | PortalLoadedResult['payload']['initialLinkedTableStates'];

function formulaLinkedStates(
    states: FormulaLinkedStates
): InterpreterContext['linkedTableLoadingStates'] {
    const linked: InterpreterContext['linkedTableLoadingStates'] = {};
    for (const [tableId, state] of Object.entries(states)) {
        linked[tableId] = { type: 'loaded', data: { state } };
    }
    return linked;
}

function formFormulaContext(
    form: FormLoadedResult,
    draft: FormDraftSnapshot<AirtableValue>,
    linkedStates: FormulaLinkedStates,
    unsavedRecordId: string
): InterpreterContext {
    return {
        record: {
            id:
                form.payload.formRecord.type === 'edit'
                    ? form.payload.formRecord.recordId
                    : unsavedRecordId,
            fields: { ...form.payload.formRecord.data, ...draft.data },
        },
        airtableFields: Object.values(form.payload.fieldIdsToSchemas).map(
            ({ airtableField }) => airtableField
        ),
        linkedTableLoadingStates: formulaLinkedStates(linkedStates),
    };
}

function portalFormulaContext(
    portal: PortalLoadedResult,
    linkedStates: FormulaLinkedStates = portal.payload.initialLinkedTableStates
): InterpreterContext {
    return {
        record: {
            id: portal.payload.formRecord.recordId,
            fields: portal.payload.formRecord.data,
        },
        airtableFields: portal.payload.usersTableFields,
        linkedTableLoadingStates: formulaLinkedStates(linkedStates),
    };
}
```

Assign the returned context to `runner.context`. Rebuild it from the current
`FormDraftStore.snapshot(handle)` or controller `getState().draft` after an
accepted edit; discard it on visitor/context changes. For an unsaved create,
choose a stable application identity for `unsavedRecordId`; it is a preview
identity, not a persisted Airtable record ID. After saving, reload canonical
computed values before relying on them in a new evaluation.

## Supported functions

| Category | Functions                                                                            |
| -------- | ------------------------------------------------------------------------------------ |
| Record   | `RECORD_ID`                                                                          |
| Text     | `FIND`, `SEARCH`, `LOWER`, `TRIM`, `LEN`, `REGEX_MATCH`, `REGEX_REPLACE`, `VALUE`    |
| Logic    | `AND`, `OR`, `NOT`, `TRUE`, `FALSE`, `IF`, `ISERROR`                                 |
| Dates    | `IS_BEFORE`, `IS_AFTER`, `DATESTR`, `TODAY`, `WEEKDAY`, `DATEADD`, `DATETIME_FORMAT` |

The parser also supports grouping, unary minus, arithmetic (`+`, `-`, `*`, `/`),
concatenation (`&`), and comparisons (`=`, `!=`, `<`, `<=`, `>`, `>=`). String
literals can use single or double quotes. Function names are case sensitive.

## Existing semantics

- Arithmetic operations round their results. For example, `3 / 2` evaluates to
  `2`.
- Function arguments evaluate eagerly, including both branches of `IF`.
- Boolean operations return numeric `1` or `0`.
- Top-level invalid numeric operations may return `NaN` or infinity through
  `run()`. Consuming them propagates a formula fault; recognized runtime faults
  return the outer string `'#ERROR!'`. Unknown-field, unsupported-function and
  unrelated syntax exceptions still throw.
- `FormulaRunner.isErrorValue` identifies numeric `NaN` and infinity. It does
  not classify the string `'#ERROR!'` as an error. `isFalsyValue` also recognizes
  zero, false, empty strings, and empty arrays.
- Date field values are evaluated in UTC. `TODAY()` uses the execution
  environment's local calendar date, so results may differ between server and
  browser timezones.
- Array values join with `', '`. Multi-select values use the engine's existing
  quote escaping.

The typed outcome method is additive. The propagation rules above prevent a
recognized fault from turning into truthy text or a successful comparison;
ordinary marker strings keep their existing data semantics.

The public `GetReadableStringSource` context also accepts
`dateParsing: 'local' | 'utc'` for readable-value conversion. Omitted or `utc`
keeps the existing UTC parsing; `local` interprets date-only and zoneless
dateTime strings in the execution environment's timezone before applying the
field's configured output format/timezone. The option follows timestamp,
formula and lookup result conversion. Portal child-create query prefills use
`local` to match canonical browser formatting. FormulaRunner's existing
context and default date semantics remain unchanged.

## Inspecting references

```ts
import { extractIdentifiersFromFormula } from '@miniextensions/sdk/formulas';

extractIdentifiersFromFormula('{Quantity} + {Price}');
// ['Quantity', 'Price']
```

The engine classes and AST types are exported for integrations that inspect a
compiled formula. Identifier extraction preserves traversal order and duplicate
references.
