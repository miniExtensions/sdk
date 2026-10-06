# Optional Form drafts and controller

`@miniextensions/sdk/forms` helps a custom application retain native Form
values, assemble a save input and present validation/success state. It has no
DOM, React or other UI framework dependency and is safe to import on a server.
The core client does not import it. It uses the existing `forms.save` operation;
it does not add authentication, backend operations or an authorization layer.

Install the supplied customer archive in your application:

```sh
npm install /path/to/miniextensions-sdk-0.1.0-alpha.0.tgz
```

The package is private and has not been published to npm. Installation by
package name from npm remains a separate future release decision. The
[runtime quickstart](runtime.md#packaged-form-quickstart) covers client setup,
published extension loading, passwords/login, query/context and visitor rules.
These helpers require a real `FormLoadedResult`; first handle any other loaded
screen or returned redirect. Use Node.js 22+ or your ES2022 browser bundler.

## Compile scalar runtime conditions

`compileRuntimeConditions` translates the existing `RuntimeConditionsDefinition`
AST into a formula for the bounded scalar subset below. It accepts deeply
readonly definitions and metadata and never changes them. Pass the current
returned Airtable fields, an explicit `invalidConditionMode` and, optionally,
`fieldReferenceMode: 'name'`. The default reference mode preserves the saved
tagged field ID/name; name mode uses the first matching current field's name.
Metadata lookup takes the first exact ID/name match. A renamed saved-name
reference is missing even if an old value remains in a record.

```ts
import type {
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
} from '@miniextensions/sdk';
import { compileRuntimeConditions } from '@miniextensions/sdk/forms';
import {
    FormulaRunner,
    type FormulaRunOutcome,
    type InterpreterContext,
} from '@miniextensions/sdk/formulas';

// Synthetic field IDs: replace them with IDs from the current returned metadata.
export const exampleConditions: RuntimeConditionsDefinition = {
    logicalOperator: 'and',
    conditions: [
        {
            id: 'title-ready',
            type: 'singleCondition',
            setting: {
                type: 'contains',
                fieldType: 'singleLineText',
                idOrName: { type: 'id', id: 'fld_title' },
                value: 'ready',
            },
        },
        {
            id: 'quantity-or-approved',
            type: 'groupCondition',
            logicalOperator: 'or',
            conditions: [
                {
                    id: 'quantity-at-least-two',
                    type: 'singleCondition',
                    setting: {
                        type: 'greaterThanOrEqualsTo',
                        fieldType: 'number',
                        idOrName: { type: 'id', id: 'fld_quantity' },
                        value: 2,
                    },
                },
                {
                    id: 'approved',
                    type: 'singleCondition',
                    setting: {
                        type: 'is',
                        fieldType: 'checkbox',
                        idOrName: { type: 'id', id: 'fld_approved' },
                        value: true,
                    },
                },
            ],
        },
    ],
};

export function compileScalarConditions(
    conditions: RuntimeConditionsDefinition | null,
    airtableFields: readonly RuntimeAirtableField[]
) {
    return compileRuntimeConditions({
        conditions,
        airtableFields,
        invalidConditionMode: 'strict',
        fieldReferenceMode: 'saved',
    });
}

// This is the application's presentation/error policy, not SDK authorization.
export type ScalarVisibility =
    | { type: 'visible' | 'hidden' }
    | {
          type: 'blocked';
          code:
              | 'unsupported'
              | 'invalid'
              | 'evaluation-exception'
              | Extract<FormulaRunOutcome, { type: 'error' }>['code'];
      };

export function scalarVisibility(
    airtableFields: readonly RuntimeAirtableField[],
    context: InterpreterContext,
    conditions: RuntimeConditionsDefinition | null = exampleConditions
): ScalarVisibility {
    const compiled = compileScalarConditions(conditions, airtableFields);
    if (compiled.type !== 'compiled')
        return { type: 'blocked', code: compiled.type };
    try {
        const runner = new FormulaRunner(compiled.formula);
        runner.context = { ...context, airtableFields: [...airtableFields] };
        const result = runner.runWithOutcome();
        if (result.type === 'error')
            return { type: 'blocked', code: result.code };
        return {
            type: FormulaRunner.isFalsyValue(result.value)
                ? 'hidden'
                : 'visible',
        };
    } catch {
        return { type: 'blocked', code: 'evaluation-exception' };
    }
}
```

The example matches a title containing `ready` and either quantity at least two
or a checked approval. Supply the current fields and the native record context
from the [formula context recipe](formulas.md#loaded-form-and-portal-metadata)
to `scalarVisibility(fields, context)`. Rebuild both after accepted edits or a
fresh load, and check the application's current visitor/revision before applying
the decision. For a Portal row, use that row's record and table metadata; the
formula guide's logged-in Portal context describes the parent user record.

Only a successful typed value reaches `isFalsyValue`. Unsupported/invalid
definitions, recognized formula faults and thrown evaluation exceptions all
block this example's presentation. Compiled warnings retain the strict compiler
semantics below; an application may choose a stricter warning policy. Use only
metadata and native values actually supplied to the current caller. A local
presentation decision grants no read/write permissions and does not remove
record values or change save authority.

The result is `{ type: 'compiled', formula, diagnostics }`, or
`{ type: 'unsupported' | 'invalid', diagnostics }` with no formula. Callers must
handle both blocked outcomes; never substitute a truthy predicate. Diagnostics
contain finite codes, severity, zero-based nested condition-index paths and an
optional editor condition ID. They do not copy operands, record values,
formulas or exception text. If unsupported and invalid rules coexist, the
result is `unsupported` and retains the collected diagnostics.

The supported boundary is **87 operator/type pairs**, **14 operators** and
**12 direct physical field types**. Let T7 mean `singleLineText`, `email`,
`url`, `multilineText`, `phoneNumber`, `barcode`, `richText`; T6 excludes
`richText`; N4 means `number`, `percent`, `currency`, `rating`.

| Operators                                                                                       | Direct types      | Pairs |
| ----------------------------------------------------------------------------------------------- | ----------------- | ----: |
| `matchesRegex`, `contains`, `doesNotContain`, `isOfLength`                                      | T7                |    28 |
| `is`                                                                                            | T6 and `checkbox` |     7 |
| `isNot`                                                                                         | T6                |     6 |
| `isEmpty`, `isNotEmpty`                                                                         | T7 and N4         |    22 |
| `equals`, `notEquals`, `greaterThan`, `lessThan`, `greaterThanOrEqualsTo`, `lessThanOrEqualsTo` | N4                |    24 |

Nested groups support the existing `and`/`or` AST. There is no `not` group;
negative operators generate the canonical `NOT(...)` formula where needed.
Every saved operator/type pair and matching current physical operator/type
pair must be in this table. Dates, selects, links, attachments, collaborators,
computed formula/lookup/rollup fields and other richer variants block the whole
definition, including in compatibility mode. The helper does not unwrap a
computed result type or partially compile richer rules.

Canonical scalar semantics are retained when both pairs are supported; exact
saved/current type equality is not required. Numeric comparisons divide the
operand by 100 when the current field is `percent`. Emptiness uses the saved
`rating` setting's zero comparison; other supported saved types use
`LEN('' & {field})`. Checkbox equality uses 0/1; case-insensitive substring
rules use `FIND`/`LOWER`. This is precedence for compilation, not evidence that
metadata is fresh or that a changed field grants an action.

Null or a valid top-level empty definition compiles to `1`. A supported missing
driver compiles to a `FALSE()` leaf with a warning; an OR sibling can still
match, even in strict mode. Strict incomplete operands and empty nested groups
return `invalid`, rather than the native converter's whole-definition
`FALSE()`. Explicit compatibility mode can omit these with warnings when a
complete sibling survives. A nonempty group whose entire contents are omitted
is always `invalid`; it never becomes `AND()`, `OR()` or `1`.

The helper preserves canonical quote/closing-brace escaping, then checks
literal and reference round trips with the existing lexer/parser without
evaluation. Ambiguous backslash sequences that would change saved bytes,
invalid regex patterns, nonfinite numeric operands, malformed/cyclic input and
unparseable formulas return `invalid`. These static checks occur before a
missing driver can hide an invalid operand: that conservative boundary differs
from native converter short-circuiting. Regex validation checks syntax only,
not execution cost. Compatibility omits incomplete input only; it does not
omit malformed operands, escape hazards or unsupported rules.

`compiled` means a supported, parseable formula, not a matched or error-free
condition. Evaluation still requires the explicit native field/record context
described in the [formula guide](formulas.md). Compilation performs no formula
execution, record read or request and grants no backend authentication,
validation, save or visibility authority. Your application still owns field,
section/page/review presentation, current owner/revision checks and any
evaluation/error policy. No starter conditional workflow is enabled by this
helper.

## One-page conditional field visibility

`evaluateFormFieldVisibility` evaluates one returned field's conditional
predicate. `composeFormFieldVisibility` adds the ordered frontend section
rules and returns stable field-ID keyed `visible`, `hidden` or `blocked`
results. Both require current physical metadata, the complete accepted native
draft, explicit create/edit and runtime/preview modes, and an explicit compiler
policy. They reuse the scalar compiler and typed formula outcome above.

```ts
import type { AirtableValue, FormLoadedResult } from '@miniextensions/sdk';
import {
    composeFormFieldVisibility,
    type FormDraftSnapshot,
} from '@miniextensions/sdk/forms';

export function onePageVisibility(
    loaded: FormLoadedResult,
    draft: FormDraftSnapshot<AirtableValue>
) {
    return composeFormFieldVisibility({
        fieldIds: loaded.payload.fieldIdsInForm,
        fieldIdsToSchemas: loaded.payload.fieldIdsToSchemas,
        airtableFields: Object.values(loaded.payload.fieldIdsToSchemas).map(
            (schema) => schema.airtableField
        ),
        data: draft.data,
        formRecordType: loaded.payload.formRecord.type,
        evaluationMode: 'runtime',
        invalidConditionMode: 'strict',
    });
}
```

Call this after each accepted draft edit and fresh metadata load. Every
predicate reads the same complete draft, including currently hidden values;
readonly fields still evaluate their conditions. Never progressively remove
hidden values before evaluating the next field. The helper makes no requests
and does not write data, dirty IDs, local choices or child context. A native
checkbox remains a boolean, percentages remain fractions, and barcode drivers
use native objects with a `text` property; malformed driver values block
evaluation. Linked and computed drivers remain unsupported, including a
computed field whose reported physical type looks scalar.
ID/name aliases that could select a different field or read another native
ID-keyed value return `ambiguous-reference`; the helper does not guess.

A nonblank `headerSectionTitle` starts a frontend section unless
`enableSectionHeader` is explicitly false. A missing flag retains legacy
title-only sections. A hidden lead with `applyFieldConditionsToSection: true`
hides its followers until the next header. A blocked lead propagates a blocked
outcome; other followers evaluate independently. A next header always resets
the previous section, even if it retains the propagation flag without a
predicate. This frontend compositor does not produce the backend's filtered
record projection for conditional select options or other consumers.

The starter retains its conservative flat choice adapter: any published
conditional-field or section context makes configured choice evaluation
unavailable, even when the current field visibility results are all visible.
These results never stand in for the canonical filtered-record projection.

`blocked` carries a finite code and safe compiler code/severity/index-path
diagnostics, excluding editor IDs, formulas, operands, values and exception
text. Supported missing references retain the compiler's false/warning
semantics. Native error objects, nonfinite results and evaluation exceptions
remain explicit errors; literal `#ERROR!` strings remain ordinary data.

This conditional-only helper blocks active `hideFieldIfEmpty: true` in edit
mode, because native empty hiding requires a separate canonical filtered-value
adapter. The ordinary flag is inactive in create mode. Lookup fields hide
empty values by default in both modes and therefore block unless that flag is
explicitly false. Preview skips conditions but still blocks active native
empty hiding. Multi-page navigation and native filtered-value adapters remain
application-owned.

The shipped browser starter applies these results to field presentation after
accepted edits. It retains controls and native drafts, validates only visible
controls at Save, and presents an explicit unavailable-field message for
blocked outcomes. The visitor can repair an editable driver; Save remains
blocked while visibility is unavailable. Hiding never clears accepted values
or prunes `createFormSaveInput`: the existing server still owns validation and
write authorization. A presentation result grants no permission.

## Preserve the full native draft

Create one `FormDraftStore<AirtableValue>` per visitor. `openLoadedFormDraft`
copies the entire loaded record data, including hidden prefills, and unions
the loaded dirty IDs with URL-prefilled IDs. Subsequent writes add field IDs
without replacing that baseline. Data stays in memory; the store does not use
local storage, browser cookies, a server or a global visitor cache.

This recipe opens a loaded Form and prepares typed text, number and checkbox
edits. Pass the actual field IDs from that published Form. It checks returned
descriptors and read-only/computed hints before writing. The pure store itself
does not validate field permissions or value schemas.

```ts
import {
    AirtableFieldType,
    type AirtableValue,
    type FormLoadedResult,
    type MiniExtensionsClient,
    type RuntimeSession,
} from '@miniextensions/sdk';
import {
    FormDraftStore,
    createFormSaveInput,
    describeLoadedFormFields,
    formValidationMessages,
    normalizeFormSaveResult,
    openLoadedFormDraft,
    type FormDraftHandle,
    type FormSaveOptions,
} from '@miniextensions/sdk/forms';

export function openTypedFormDraft(
    loaded: FormLoadedResult,
    fieldIds: { title: string; quantity: string; approved: string },
    edits: { title: string; quantity: number; approved: boolean }
) {
    const store = new FormDraftStore<AirtableValue>();
    const handle = openLoadedFormDraft({ store, loaded });
    const fields = describeLoadedFormFields(loaded);
    const values: Record<string, AirtableValue> = {
        [fieldIds.title]: edits.title,
        [fieldIds.quantity]: edits.quantity,
        [fieldIds.approved]: edits.approved,
    };
    const expected = [
        [fieldIds.title, AirtableFieldType.SINGLE_LINE_TEXT],
        [fieldIds.quantity, AirtableFieldType.NUMBER],
        [fieldIds.approved, AirtableFieldType.CHECKBOX],
    ] as const;
    for (const [fieldId, type] of expected) {
        const field = fields.find((entry) => entry.fieldId === fieldId);
        if (field?.fieldType !== type || field.readOnly) {
            throw new Error(
                `Choose a returned editable ${type} field: ${fieldId}`
            );
        }
    }
    for (const [fieldId, value] of Object.entries(values)) {
        if (!store.write(handle, fieldId, value))
            throw new Error('Draft expired');
    }
    return {
        store,
        handle,
        fields,
        initialValidation: formValidationMessages(
            loaded.payload.formErrors,
            [],
            loaded
        ),
    };
}

// Invoke only from the visitor's deliberate Save action after checking scope.
// Use the session captured for that same visitor/load, never a new visitor's.
export async function savePureFormDraftOnce(
    client: MiniExtensionsClient,
    loaded: FormLoadedResult,
    store: FormDraftStore<AirtableValue>,
    handle: FormDraftHandle,
    saveOptions: FormSaveOptions,
    session: Readonly<RuntimeSession>,
    signal: AbortSignal
) {
    signal.throwIfAborted();
    const draft = store.snapshot(handle);
    const submittedRevision = store.revision(handle);
    if (draft == null || submittedRevision == null)
        throw new Error('Draft expired');
    const input = createFormSaveInput({ loaded, draft, options: saveOptions });
    const response = await client.forms.save(input, { session, signal });
    signal.throwIfAborted();
    const result = normalizeFormSaveResult(response, loaded);
    if (result.type === 'error') {
        for (const error of result.validationErrors) {
            console.error(error.fieldTitle, error.errorMessage);
        }
        if (result.concurrentEditErrorMessage != null) {
            console.error(result.concurrentEditErrorMessage);
        }
        return result; // Keep the draft so the visitor can correct it.
    }
    // If someone wrote while the request ran, those edits remain dirty.
    const noNewerEdits = store.markSaved(handle, submittedRevision);
    console.info('Saved record:', result.raw.record.id, { noNewerEdits });
    for (const warning of result.postSubmissionWarnings)
        console.warn(warning.type);
    for (const notification of result.postSubmissionNotifications)
        console.info(notification.type);
    return result;
}
```

Supply complete `FormSaveOptions`: `captchaVal`, `isComputeMode`, `searchQuery`,
`context` and `conditionalLinkedRecordFieldIdsToFilteringValues`, plus any
configured device fingerprint/location. Use `isComputeMode: false` for a
normal submission. Compute mode can write; it is not a harmless local formula
preview. Use the existing `/formulas` subpath for local evaluation.

`createFormSaveInput` preserves the loaded create/edit discriminator, record
and table IDs, token and baseline data. It merges the snapshot's native values
and unions loaded dirty, URL-prefill and snapshot dirty IDs. It copies the
result and does not modify the loaded result or store. Text remains a string,
numbers remain numbers, checkboxes remain booleans, selects use choice names
and linked fields use arrays of record IDs. It does not turn every value into
text or discard fields that your renderer does not display.

The pure save recipe leaves single-flight control, owner/session checks,
response ownership and recovery to your application. After success, obtain a
fresh loaded Form and discard the completed handle before reopening its
baseline. After a transport error or a dispatched cancellation, reconcile the
server outcome and obtain a fresh load before deciding whether to submit
again. Do not call it blindly a second time. Use the controller below for
these presentation guards.

The store scopes a draft by actual extension ID, create/edit record ID and
optional parent Portal/record/relationship IDs. Reopening the same live scope
retains its draft. `discard(handle)` invalidates that handle; `clear()`
invalidates all handles. Store handles are object identities: an expired handle
cannot write into a new draft with the same scope string. `addChoice` retains
local choice metadata only; it does not call `forms.addSelectOption` or save a
record. Never share a store across visitors or connections.

## Headless controller with explicit Save

`createFormController` binds one loaded Form, complete save options and the
current visitor/context scope. It snapshots the client session and sends that
request-only session when saving. `getScope` must return an application-owned
nonempty `ownerId` and a nonnegative integer `revision`.

The next recipe loads a standalone Form and wires native text, number and
checkbox inputs. Pass real DOM elements from your app and actual field IDs.
Only the button invokes Save. The subscription receives initial inline errors,
then validation, success warnings/notifications or transport/cancel state. All
record and error text uses safe text APIs.

```ts
import {
    AirtableFieldType,
    type LoadExtensionInput,
    type MiniExtensionsClient,
} from '@miniextensions/sdk';
import {
    createFormController,
    type FormOwnerScope,
    type FormSaveOptions,
} from '@miniextensions/sdk/forms';

const formEditorOwners = new WeakMap<HTMLElement, symbol>();

export async function attachStandaloneFormEditor(options: {
    client: MiniExtensionsClient;
    input: Extract<LoadExtensionInput, { shareId: string }>;
    saveOptions: FormSaveOptions;
    getScope: () => FormOwnerScope;
    signal: AbortSignal;
    fieldIds: { title: string; quantity: string; approved: string };
    inputs: {
        title: HTMLInputElement;
        quantity: HTMLInputElement;
        approved: HTMLInputElement;
    };
    inlineErrors: {
        title: HTMLElement;
        quantity: HTMLElement;
        approved: HTMLElement;
    };
    saveButton: HTMLButtonElement;
    message: HTMLElement;
}) {
    const inputs = { ...options.inputs };
    const inlineErrors = { ...options.inlineErrors };
    const fieldIds = { ...options.fieldIds };
    const saveButton = options.saveButton;
    const message = options.message;
    const nodes = [
        ...Object.values(inputs),
        ...Object.values(inlineErrors),
        saveButton,
        message,
    ];
    if (new Set(nodes).size !== nodes.length) {
        throw new Error(
            'Supply distinct input, error, Save and message elements.'
        );
    }
    const owner = Symbol('Form editor');
    const scopeAtLoad = { ...options.getScope() };
    const session = { ...options.client.getSession() };
    options.signal.throwIfAborted();
    const loaded = await options.client.loadExtension(options.input, {
        session,
        signal: options.signal,
    });
    options.signal.throwIfAborted();
    const scopeNow = options.getScope();
    const sessionNow = options.client.getSession();
    options.signal.throwIfAborted();
    if (
        scopeNow.ownerId !== scopeAtLoad.ownerId ||
        scopeNow.revision !== scopeAtLoad.revision ||
        Object.keys(sessionNow).length !== Object.keys(session).length ||
        !Object.keys(session).every(
            (key) =>
                Object.hasOwn(sessionNow, key) &&
                sessionNow[key] === session[key]
        )
    ) {
        throw new Error(
            'Scope changed during load; load the new visitor/context.'
        );
    }
    if (loaded.extensionScreen !== 'form_loaded') {
        throw new Error('Handle the returned login/password/redirect first.');
    }
    const controller = createFormController({
        client: options.client,
        loaded,
        saveOptions: options.saveOptions,
        getScope: options.getScope,
    });
    let destroyed = false;
    const ownsView = (): boolean => {
        if (
            destroyed ||
            options.signal.aborted ||
            !nodes.every((node) => formEditorOwners.get(node) === owner)
        )
            return false;
        try {
            const scope = options.getScope();
            const currentSession = options.client.getSession();
            return (
                scope.ownerId === scopeAtLoad.ownerId &&
                scope.revision === scopeAtLoad.revision &&
                Object.keys(currentSession).length ===
                    Object.keys(session).length &&
                Object.keys(session).every(
                    (key) =>
                        Object.hasOwn(currentSession, key) &&
                        currentSession[key] === session[key]
                ) &&
                !destroyed &&
                !options.signal.aborted &&
                nodes.every((node) => formEditorOwners.get(node) === owner)
            );
        } catch {
            return false;
        }
    };
    const expected = {
        title: AirtableFieldType.SINGLE_LINE_TEXT,
        quantity: AirtableFieldType.NUMBER,
        approved: AirtableFieldType.CHECKBOX,
    } as const;
    const keys = ['title', 'quantity', 'approved'] as const;
    const initial = controller.getState();
    for (const key of keys) {
        const field = initial.fields.find(
            (entry) => entry.fieldId === fieldIds[key]
        );
        if (field?.fieldType !== expected[key]) {
            controller.destroy();
            throw new Error(`Choose a returned ${expected[key]} field.`);
        }
    }
    try {
        options.signal.throwIfAborted();
    } catch (cause) {
        controller.destroy();
        throw cause;
    }
    // Claim only after the loaded schemas validate. A replacement gets its
    // own symbol; old listeners and cleanup cannot act on its shared nodes.
    for (const node of nodes) formEditorOwners.set(node, owner);
    inputs.title.type = 'text';
    inputs.quantity.type = 'number';
    if (!inputs.quantity.hasAttribute('step')) inputs.quantity.step = 'any';
    inputs.approved.type = 'checkbox';
    saveButton.type = 'button';

    const onTitle = (): void => {
        if (!ownsView()) return;
        controller.write(fieldIds.title, inputs.title.value);
    };
    const onQuantity = () => {
        if (!ownsView()) return;
        const input = inputs.quantity;
        if (input.validity.badInput) return;
        if (input.value === '') {
            controller.write(fieldIds.quantity, null);
        } else if (Number.isFinite(input.valueAsNumber)) {
            controller.write(fieldIds.quantity, input.valueAsNumber);
        }
    };
    const onApproved = (): void => {
        if (!ownsView()) return;
        controller.write(fieldIds.approved, inputs.approved.checked);
    };
    inputs.title.addEventListener('input', onTitle);
    inputs.quantity.addEventListener('input', onQuantity);
    inputs.approved.addEventListener('change', onApproved);

    const unsubscribe = controller.subscribe((state) => {
        if (!ownsView()) return;
        saveButton.disabled = !state.canSave;
        for (const key of keys) {
            const fieldId = fieldIds[key];
            const field = state.fields.find(
                (entry) => entry.fieldId === fieldId
            );
            const input = inputs[key];
            input.disabled = !state.canSave || field == null || field.readOnly;
            const value = state.draft?.data[fieldId];
            if (key === 'approved') input.checked = value === true;
            else if (key !== 'quantity' || !input.validity.badInput) {
                const text = value == null ? '' : String(value);
                if (input.value !== text) input.value = text;
            }
            const errors = state.validationErrors.filter(
                (error) => error.fieldId === fieldId
            );
            inlineErrors[key].textContent = errors
                .map((error) => error.errorMessage)
                .join('\n');
            input.setAttribute('aria-invalid', String(errors.length > 0));
        }
        if (state.result?.type === 'saved') {
            message.textContent = [
                `Saved record: ${state.result.raw.record.id}`,
                ...state.result.postSubmissionWarnings.map(
                    (warning) => `Warning: ${warning.type}`
                ),
                ...state.result.postSubmissionNotifications.map(
                    (notification) => notification.type
                ),
            ].join('\n');
        } else {
            message.textContent =
                state.concurrentEditErrorMessage ??
                state.errorMessage ??
                state.status;
        }
    });
    const onSave = (): void => {
        if (!ownsView()) return;
        const state = controller.getState();
        if (!state.canSave || !ownsView()) return;
        for (const key of keys) {
            const field = state.fields.find(
                (entry) => entry.fieldId === fieldIds[key]
            );
            if (field == null || field.readOnly) continue;
            const input = inputs[key];
            if (
                !input.checkValidity() ||
                (key === 'quantity' &&
                    input.value !== '' &&
                    !Number.isFinite(input.valueAsNumber))
            ) {
                if (ownsView()) input.reportValidity();
                return;
            }
        }
        if (!ownsView()) return;
        void controller.save().catch((cause: unknown) => {
            if (!ownsView()) return;
            // State normally contains the failure. Scope/disposal errors can
            // occur before dispatch; keep Save disabled until fresh setup.
            saveButton.disabled = true;
            message.textContent =
                cause instanceof Error ? cause.message : 'Save unavailable';
        });
    };
    saveButton.addEventListener('click', onSave);

    const destroy = (): void => {
        if (destroyed) return;
        destroyed = true;
        unsubscribe();
        controller.destroy();
        inputs.title.removeEventListener('input', onTitle);
        inputs.quantity.removeEventListener('input', onQuantity);
        inputs.approved.removeEventListener('change', onApproved);
        saveButton.removeEventListener('click', onSave);
        const release = (node: HTMLElement, clear: () => void): void => {
            if (formEditorOwners.get(node) !== owner) return;
            clear();
            formEditorOwners.delete(node);
        };
        for (const key of keys) {
            release(inputs[key], () => {
                inputs[key].value = '';
                inputs[key].checked = false;
                inputs[key].disabled = true;
                inputs[key].removeAttribute('aria-invalid');
            });
            release(inlineErrors[key], () => {
                inlineErrors[key].textContent = '';
            });
        }
        release(saveButton, () => {
            saveButton.disabled = true;
        });
        release(message, () => {
            message.textContent = '';
        });
        options.signal.removeEventListener('abort', destroy);
    };
    options.signal.addEventListener('abort', destroy, { once: true });
    try {
        options.signal.throwIfAborted();
        const current = controller.getState();
        if (
            current.status === 'disposed' ||
            current.status === 'stale' ||
            !ownsView()
        ) {
            throw new Error(
                'Editor scope changed during setup; create a fresh editor.'
            );
        }
        options.signal.throwIfAborted();
    } catch (cause) {
        destroy();
        throw cause;
    }
    return { controller, destroy };
}
```

Give the native inputs visible labels and connect each inline-error element
with `aria-describedby`; set the message element's `role="status"` or your
chosen accessible announcement behavior in your app markup. The recipe keeps
inputs mounted while synchronizing values, so ordinary writes do not remount
focused controls. For select/linked controls, use the separate optional UI
guide when that package subpath is present; keep its value callbacks native
and write them with `controller.write(fieldId, value)`.

The recipe gives each mounted editor private ownership of all supplied DOM
nodes through a `WeakMap` and unique symbol. A replacement may claim those
same nodes before old cleanup runs: old handlers then do nothing, and old
cleanup removes only its own listeners and clears only nodes it still owns.
No credential or ownership token is written into DOM attributes. Abort old
loads and destroy old editors promptly when replacing them.

Save also checks the native inputs' current browser validity and finite number
value before submitting. Invalid numeric text never becomes an empty/null edit
or silently submits the previous valid value. Keep your application's native
`required`, `min`, `max` and `step` attributes as configured; server validation
still decides whether the submitted native values meet the Form's rules.
When your markup omits `step`, this generic number recipe uses `step="any"`
instead of the browser's integer-only default, so finite fractional values are
not rejected by an accidental UI default.

For a direct create Form without CAPTCHA or conditional linked filtering,
complete save options can use `captchaVal: null`, `isComputeMode: false`,
`searchQuery: loadInput.query ?? {}`, `context: {type: 'direct-url'}` and
`conditionalLinkedRecordFieldIdsToFilteringValues: {}`. Those values do not
disable configured rules. Supply actual current widget tokens and known
filtering values when required; preserve the load's query/device fingerprint
and actual child/modal save context. Update the controller configuration
explicitly when those inputs change.

## State, recovery and scope changes

`subscribe` emits a copied initial state immediately and returns an unsubscribe
function. `getState` observes scope freshness too. Descriptors follow the
returned `fieldIdsInForm` order and include only IDs with returned canonical
schemas. They expose title, type, computed/read-only hints and a copied schema;
they do not invent a hidden flag, evaluate conditional visibility or grant
permission to edit. Unsupported or malformed metadata fails rather than being
reinterpreted. Preserve undisplayed native values in the draft.

`controller.write` accepts only returned, noncomputed, non-read-only fields and
native values. It returns `false` for unavailable fields, expired drafts and
stale/disposed controllers. It does not replace backend field validation or
inspect every `AirtableValue` against the field's value schema. The server still
enforces the published extension, password/login, record/field/action,
CAPTCHA and other existing rules.

The controller prevents simultaneous saves. `ready` and `validation-error`
permit an explicit Save. An error result retains the draft and combines field
validation and `formErrors` without duplicating the same field/message; it
retains concurrent-edit feedback separately. Correct the draft, then Save
again. Initial loaded `formErrors` also appear before any submission.

`saved` exposes the actual raw result, normalized warning and notification
arrays, and the saved record ID. Warnings report post-submission failures after
the record was saved; they are not a reason to repeat creation. If writes occur
during an in-flight save, the store clears dirty IDs only when its revision
matches the submitted snapshot. Otherwise `hasNewerEdits` is true and those
edits remain unsaved. The native recipe disables editing during Save to avoid
this extra reconciliation step.

After `saved`, `transport-error` or a dispatched `cancelled` state, another Save
requires a fresh load and explicit reset. A transport/cancellation outcome may
already have written on the server. Reconcile that outcome and load the
appropriate saved/edit/create context before deciding what to submit. There
is no automatic retry, mutation cancellation rollback or automatic reset from
a response. A signal already aborted before dispatch rejects without sending.

Advance the application-owned revision returned by `getScope` whenever visitor,
connection, credentials,
loaded token, record, field/filter configuration or parent context changes.
Use a stable application owner identity for each visitor.
Anonymous visitors need distinct ownership/revisions too. Increment for every
transition, including A → B → A: identical final credentials cannot prove the
old context remains current.

On a scope change, abort the old load, unsubscribe/dispose the old controller
and controls, clear/discard the old visitor store, then load a new Form and
create a controller with the new owner/revision. Do not carry previous visitor
labels or values into it. The controller detects an observed owner/revision or
session mismatch, invalidates old handles and hides stale state. Your app still
owns prompt teardown and revision changes; there is no global login listener.

`reset(newOptions)` is an explicit alternative for a retained controller. It
aborts active work, checks the new configuration and clears the old store when
owner/revision/client/session/token/Form context changes. Same-scope reset
preserves a draft during configuration changes. After a completed save with no
newer edits, it discards that completed handle to adopt the fresh loaded
baseline. With newer writes, it retains the draft until the application decides
how to reconcile them. `destroy()` hides state and removes listeners, but the
owner remains responsible for clearing a supplied visitor store.

This module is client-side presentation and draft management. Local tests and
packed-consumer checks prove these helper contracts; they do not prove a
specific staging deployment, extension or backend compatibility.
