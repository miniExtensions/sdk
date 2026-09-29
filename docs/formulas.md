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

The constructor parses the expression. `run()` evaluates it and returns a string
or number. Construct one runner and replace its context when evaluating the same
formula against different records.

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
- Invalid numeric operations may return `NaN` or infinity. Certain runtime
  errors return the string `'#ERROR!'`; syntax and unsupported-function errors
  can throw.
- `FormulaRunner.isErrorValue` identifies numeric `NaN` and infinity. It does
  not classify the string `'#ERROR!'` as an error. `isFalsyValue` also recognizes
  zero, false, empty strings, and empty arrays.
- Date field values are evaluated in UTC. `TODAY()` uses the execution
  environment's local calendar date, so results may differ between server and
  browser timezones.
- Array values join with `', '`. Multi-select values use the engine's existing
  quote escaping.

These details are preserved for compatibility.

## Inspecting references

```ts
import { extractIdentifiersFromFormula } from '@miniextensions/sdk/formulas';

extractIdentifiersFromFormula('{Quantity} + {Price}');
// ['Quantity', 'Price']
```

The engine classes and AST types are exported for integrations that inspect a
compiled formula. Identifier extraction preserves traversal order and duplicate
references.
