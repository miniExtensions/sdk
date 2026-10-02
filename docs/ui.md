# Optional selection UI

`@miniextensions/sdk/ui` provides conventional native single and multi-select
controls, a searchable linked-record picker, and a headless selection model.
It uses browser DOM APIs and has no React or other UI framework dependency.
Importing the core client does not import this UI module. No control loads an
extension, saves a record, adds a select choice, or calls Airtable directly.

Install the customer archive in your app first:

```sh
npm install /path/to/miniextensions-sdk-0.1.0-alpha.0.tgz
```

This private package has not been published to npm. Installing by package name
from npm is a future release decision. Use your existing ES2022 browser bundler
and Node.js 22+ build environment. The UI module can be imported on a server,
but creating a DOM control requires a browser `Document`, or an explicitly
supplied compatible `document`. Call DOM factories after browser mounting.

The [runtime quickstart](runtime.md#packaged-form-quickstart) explains load,
draft construction, save, validation and success handling. The UI helpers below
only edit an application-owned draft. Keep hidden prefills and native field
values when building the save input. Save only from the visitor's deliberate
action; cancellation cannot undo a mutation and the SDK never retries a save
automatically.

## Native single and multi-selects

`createSelectControl` renders a labeled native `<select>`. It accepts loaded
`RuntimeFieldSchema` metadata and emits native Airtable values: a choice name
or `null` for single-select, and an array of choice names for multi-select.
Choice IDs are metadata identifiers; do not save those IDs as select values.
The wrapper handles native keyboard interaction and owns its selection model.
Call `destroy()` when removing it.

Each convenience control stays bound to that field schema and single/multi
mode. Recreate it if the field identity or schema changes. Use
`control.model.setValue` for controlled value updates; its model uses arrays of
choice names even when the native single-select value is one name or `null`.
For async or changing option sources, use the headless/mounted picker below.

This complete helper loads a Form and mounts two configured fields. Pass an
existing client, your actual `LoadExtensionInput`, an empty host element, and
the field IDs from your published Form. It performs no save.

```ts
import {
    AirtableFieldType,
    type AirtableValue,
    type LoadExtensionInput,
    type MiniExtensionsClient,
} from '@miniextensions/sdk';
import {
    createSelectControl,
    type SelectControl,
} from '@miniextensions/sdk/ui';

export async function mountFormSelects(
    client: MiniExtensionsClient,
    input: LoadExtensionInput,
    host: HTMLElement,
    fieldIds: { single: string; multiple: string },
    signal: AbortSignal
) {
    const form = await client.loadExtension(input, { signal });
    signal.throwIfAborted();
    if (form.extensionScreen !== 'form_loaded') {
        throw new Error('Handle the returned login/password/redirect first.');
    }
    const data: Record<string, AirtableValue> = {
        ...form.payload.formRecord.data,
    };
    const changed = new Set<string>();
    const expected = [
        [fieldIds.single, AirtableFieldType.SINGLE_SELECT],
        [fieldIds.multiple, AirtableFieldType.MULTIPLE_SELECTS],
    ] as const;
    // Validate both fields before mounting either one.
    const schemas = expected.map(([fieldId, type]) => {
        const field = form.payload.fieldIdsToSchemas[fieldId];
        if (
            !form.payload.fieldIdsInForm.includes(fieldId) ||
            field?.fieldType !== type
        ) {
            throw new Error(`Choose a configured ${type} field: ${fieldId}`);
        }
        return field;
    });
    const controls: SelectControl[] = [];
    try {
        for (const field of schemas) {
            controls.push(
                createSelectControl({
                    field,
                    value: data[field.airtableField.id],
                    onChange(value) {
                        data[field.airtableField.id] = value;
                        changed.add(field.airtableField.id);
                    },
                })
            );
        }
    } catch (error) {
        for (const control of controls) control.destroy();
        throw error;
    }
    host.replaceChildren(...controls.map((control) => control.element));
    return {
        form,
        getDraft: () => ({ ...form.payload.formRecord, data: { ...data } }),
        getChangedFieldIds: () => [...changed],
        destroy() {
            for (const control of controls) control.destroy();
            host.replaceChildren();
        },
    };
}
```

Add `getChangedFieldIds()` to the loaded dirty/prefill IDs when constructing
`SaveFormInput`; use `getDraft()` for its `formRecord`. Handle all server
validation errors before treating the save as successful, as the runtime
guide shows. A field's presence and an enabled control do not grant write
permission. The wrapper respects computed and `miniExtConfig.readOnly` hints;
the published extension and backend enforce visitor, record and action rules.

Unsupported field kinds, mismatched schema types, duplicate/malformed choices
and incorrectly shaped values throw. Handle this as an unavailable field in
your app rather than guessing a different input type. Empty canonical choices
produce an empty selector; the wrapper never invents options. It preserves a
persisted name absent from current choices for display, without offering that
name as a new choice.

Native multi-select uses the operating system's keyboard conventions, including
Command/Control and Shift. Use the searchable mounted control when you want
visible checkbox/radio choices and individual remove buttons.

## Authorized linked-record selection

The linked adapters call the existing `listFormOptions` and
`listPortalOptions` operations with `viewType: 'list'`, current search text,
returned page offset and an `AbortSignal`. They keep record IDs as values and
derive labels from returned primary-field metadata. If a label cannot be
resolved, the record ID remains visible. They never request direct Airtable
credentials or infer access from a label.

This Form helper uses a loaded, canonical linked field. The optional selected
record hydration reads only the Form's existing selected records; it does not
accept arbitrary IDs to look up. Abort and dispose it before replacing the
visitor, token, context, field or conditional filtering values.

```ts
import {
    AirtableFieldType,
    type ConditionalLinkedRecordFilteringValues,
    type FormLoadedResult,
    type MiniExtensionsClient,
    type RuntimeTableStates,
} from '@miniextensions/sdk';
import {
    createFormLinkedRecordLoader,
    createSelectionModel,
    mountSelectionControl,
    selectionOptionsFromRecords,
} from '@miniextensions/sdk/ui';

export async function mountFormLinkedField(
    client: MiniExtensionsClient,
    form: FormLoadedResult,
    fieldId: string,
    host: HTMLElement,
    signal: AbortSignal,
    filteringValues: ConditionalLinkedRecordFilteringValues
) {
    const field = form.payload.fieldIdsToSchemas[fieldId];
    if (
        !form.payload.fieldIdsInForm.includes(fieldId) ||
        field?.fieldType !== AirtableFieldType.MULTIPLE_RECORD_LINKS ||
        field.airtableField.config.type !==
            AirtableFieldType.MULTIPLE_RECORD_LINKS
    ) {
        throw new Error('Choose a linked field configured in this Form.');
    }
    const config = field.airtableField.config;
    if (typeof config.options.prefersSingleRecordLink !== 'boolean') {
        throw new Error('Expected canonical linked-field selection metadata.');
    }
    const rawValue = form.payload.formRecord.data[fieldId];
    if (
        rawValue != null &&
        (!Array.isArray(rawValue) ||
            rawValue.some((id) => typeof id !== 'string'))
    ) {
        throw new Error('Expected linked-record IDs as an array.');
    }
    const value = rawValue == null ? [] : (rawValue as string[]);
    const loadOptions = createFormLinkedRecordLoader({
        client,
        linkedTableId: config.options.linkedTableId,
        input: {
            extensionAccessToken: form.payload.extensionAccessToken,
            linkedRecordFieldId: fieldId,
            conditionalLinkedRecordFilteringValues: filteringValues,
        },
    });
    const session = client.getSession();
    const tables: RuntimeTableStates =
        value.length === 0
            ? {}
            : await client.linkedRecords.loadSelectedRecords(
                  { extensionAccessToken: form.payload.extensionAccessToken },
                  { session, signal }
              );
    signal.throwIfAborted();
    if (loadOptions.isCurrent?.() === false) {
        throw new Error(
            'Visitor changed; recreate the field for the new scope.'
        );
    }
    const table = tables[config.options.linkedTableId];
    const selectedRecords = value.flatMap((id) => {
        const record = table?.recordIdsToAirtableRecords[id];
        return record == null ? [] : [record];
    });
    let draftValue = [...value];
    const model = createSelectionModel({
        multiple: !config.options.prefersSingleRecordLink,
        value,
        selectedOptions: selectionOptionsFromRecords(selectedRecords, table),
        loadOptions,
        readOnly:
            field.airtableField.isComputed === true ||
            field.miniExtConfig?.readOnly === true,
        onChange(ids) {
            draftValue = [...ids];
        },
    });
    const control = mountSelectionControl(model, {
        label: field.airtableField.name,
        description: 'Search the records available to this visitor.',
    });
    host.replaceChildren(control.element);
    const destroy = (): void => {
        control.destroy();
        model.destroy();
        host.replaceChildren();
        signal.removeEventListener('abort', destroy);
    };
    signal.addEventListener('abort', destroy, { once: true });
    await model.reload(); // Mounting alone does not fetch.
    return { model, getDraftValue: () => [...draftValue], destroy };
}
```

Use the returned ID array as the linked field's native draft value and mark
that field dirty. A single linked selection still uses an array with zero or
one record ID. A persisted selected ID may be absent from a searched page:
the model retains its supplied label, or displays the ID until hydrated. Search
and paging never silently remove selected values. `selectedOptions` supplies
display labels; it does not authorize adding those IDs to a new selection.

For a Portal grid editor, use the Portal adapter with its current loaded token,
the configured Portal relationship field, and the actual linked field in that
relationship's returned table metadata. The Portal field and the cell's linked
field are different IDs. This factory returns a headless model for your editor
to mount; it performs no grid update. Supply `readOnly` from the canonical
column/action configuration instead of assuming every returned field is editable.

```ts
import {
    AirtableFieldType,
    type MiniExtensionsClient,
    type PortalLoadedResult,
    type RuntimeTableState,
} from '@miniextensions/sdk';
import {
    createPortalLinkedRecordLoader,
    createSelectionModel,
} from '@miniextensions/sdk/ui';

export function createPortalCellPicker(options: {
    client: MiniExtensionsClient;
    portal: PortalLoadedResult;
    portalFieldId: string;
    portalTableId: string;
    portalTable: RuntimeTableState;
    recordFieldId: string;
    value: readonly string[];
    readOnly: boolean;
    onChange: (ids: readonly string[]) => void;
}) {
    const { portal, portalFieldId } = options;
    const relationship = portal.payload.fieldIdsToSchemas[portalFieldId];
    const recordField = options.portalTable.airtableFields.find(
        (field) => field.id === options.recordFieldId
    );
    if (
        !portal.payload.fieldIdsInPortal.includes(portalFieldId) ||
        relationship?.fieldType !== AirtableFieldType.MULTIPLE_RECORD_LINKS ||
        relationship?.airtableField.config.type !==
            AirtableFieldType.MULTIPLE_RECORD_LINKS ||
        relationship.airtableField.config.options.linkedTableId !==
            options.portalTableId ||
        recordField?.config.type !== AirtableFieldType.MULTIPLE_RECORD_LINKS ||
        typeof recordField.config.options.prefersSingleRecordLink !== 'boolean'
    ) {
        throw new Error(
            'Expected current canonical Portal/table/linked-field metadata.'
        );
    }
    return createSelectionModel({
        multiple: !recordField.config.options.prefersSingleRecordLink,
        value: options.value,
        readOnly: options.readOnly || recordField.isComputed === true,
        onChange: options.onChange,
        loadOptions: createPortalLinkedRecordLoader({
            client: options.client,
            linkedTableId: recordField.config.options.linkedTableId,
            input: {
                extensionAccessToken: portal.payload.extensionAccessToken,
                linkedRecordFieldId: recordField.id,
                portalTableId: options.portalTableId,
                portalFieldId,
            },
        }),
    });
}
```

To hydrate Portal labels, pass the already authorized selected records and
their corresponding returned table state to `selectionOptionsFromRecords`,
then pass those options to `model.setValue(ids, labels)`. Do not use Form-only
`loadSelectedRecords` as a general Portal or arbitrary-record lookup.

**Cascading/dynamic filter-option discovery is unsupported by this initial UI
surface.** The SDK accepts known Form conditional filtering values but does not
expose the hosted filter-option discovery operation. Supply values already
known to your application and recreate the loader when they change. Do not
invent options, query Airtable directly or omit values to bypass configured
filtering. Calendar selectors and creating options/records are separate runtime
operations; the mounted picker does not provide those workflows.

## Headless model and lifecycle

`createSelectionModel` also works without DOM mounting. Subscribe to copied
state snapshots and render with your framework. `subscribe` emits immediately
and returns an unsubscribe function. `choose`, `toggle` and `clear` represent
user changes and call `onChange`. `setValue`, `setOptions` and `reset` represent
application updates and do not call it. Values remain strings inside the
model; convert them to the field's native value at your draft boundary.

`setSearchTerm` starts a fresh first page. `reload` repeats the current search;
`loadMore` uses only the latest returned offset. The model de-duplicates options
by value, preserves selected labels across page/search changes, aborts obsolete
requests and discards late responses even if a loader ignores cancellation.
Transport errors appear in `state.error`; your renderer decides whether to
offer Retry. There is no automatic retry loop.

`disabled` blocks every interaction. `readOnly` permits search and paging but
blocks selection, removal and clearing. Unknown or disabled new choices are
ignored. Application `setValue` can restore authorized persisted values absent
from the current options; it is not a permission check.

Create one client and model per visitor. SDK loader factories capture a copy of
the request input and client session. If client credentials change, their
freshness guard invalidates old choices and prevents selecting from that old
credential scope. The application must still destroy/reset and recreate the
loader on every visitor, extension token, record, field, filter or context
change, including two anonymous visitors with identical empty sessions and an
A → B → A credential sequence. `isCurrent` compares current credential contents,
not a session generation; credentials alone cannot identify those transitions.

For a reused model, call `model.reset({value: [], selectedOptions: [],
loadOptions: newLoader, ...})` before loading the new visitor. Do not carry
previous visitor labels or values into that reset. A new loader must use the
new loaded token and canonical field/context input. `cancel()` stops the active
read; `destroy()` aborts work and removes listeners. A mounted control's
`destroy()` removes its own DOM handlers/subscription; remove its element
separately and destroy a model you created. The native select wrapper's
`destroy()` owns its handlers and model.

## React and Next integration

You can mount these controls inside a client component without adding a React
peer dependency to the SDK. This example uses your app's existing React
installation. Keep the loaded `field` object stable within a scope. Construct
`scopeKey` in application memory from visitor/context identity and a token
generation; do not render credentials in HTML. Change it on login/logout,
record/context/filter changes and fresh loaded tokens, including anonymous
visitor changes.

The setup effect depends on field identity and scope only. Latest value and
callback refs avoid remounting on each edit, so focus survives controlled-value
updates. The second effect synchronizes native values into the existing model.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import {
    AirtableFieldType,
    type AirtableValue,
    type RuntimeFieldSchema,
} from '@miniextensions/sdk';
import {
    createSelectControl,
    type SelectControl,
} from '@miniextensions/sdk/ui';

export function SdkSelect(props: {
    field: RuntimeFieldSchema;
    scopeKey: string;
    value: AirtableValue;
    onChange: (value: AirtableValue) => void;
}) {
    const { field, scopeKey, value, onChange } = props;
    const host = useRef<HTMLDivElement>(null);
    const control = useRef<SelectControl | null>(null);
    const current = useRef({ value, onChange, scopeKey });
    current.current = { value, onChange, scopeKey };
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const node = host.current;
        if (node == null) return;
        let mounted: SelectControl;
        try {
            mounted = createSelectControl({
                field,
                value: current.current.value,
                onChange(nextValue) {
                    if (current.current.scopeKey === scopeKey) {
                        current.current.onChange(nextValue);
                    }
                },
            });
        } catch (cause) {
            setError(
                cause instanceof Error ? cause.message : 'Field unavailable'
            );
            return;
        }
        setError(null);
        control.current = mounted;
        node.replaceChildren(mounted.element);
        return () => {
            mounted.destroy();
            if (control.current === mounted) control.current = null;
            node.replaceChildren();
        };
    }, [field, scopeKey]);

    useEffect(() => {
        const mounted = control.current;
        if (mounted == null) return;
        const multiple = field.fieldType === AirtableFieldType.MULTIPLE_SELECTS;
        const valid =
            value == null ||
            (multiple
                ? Array.isArray(value) &&
                  value.every((entry) => typeof entry === 'string')
                : typeof value === 'string');
        if (!valid) {
            mounted.model.setDisabled(true);
            setError('Expected a native select name or array of names.');
            return;
        }
        mounted.model.setDisabled(false);
        mounted.model.setValue(
            value == null
                ? []
                : multiple
                  ? (value as string[])
                  : value === ''
                    ? []
                    : [value as string]
        );
        setError(null);
    }, [value, field, scopeKey]);

    return (
        <>
            <div ref={host} />
            {error && <p role="alert">{error}</p>}
        </>
    );
}
```

For async linked controls, create the loader and model inside the scope effect,
mount with `mountSelectionControl`, call `model.reload()` explicitly, and clean
up **both** `mounted.destroy()` and `model.destroy()`. Abort any selected-label
hydration on cleanup. Keep the latest change callback in a ref, and apply
controlled linked-ID arrays with `model.setValue` in a separate value effect.
Do not recreate the model merely because the parent renders a new callback.

## Customization and local proof

The DOM controls ship without global CSS. Scope your styles below the host:
`[data-ui="select"]`, `[data-ui="search"]`, `[data-ui="choice"]`,
`[data-ui="selected-option"]`, `[data-ui="remove"]`,
`[data-ui="status"]` and `[data-ui="error"]` are styling hooks. Controls also
use corresponding `me-sdk-*` classes. Keep focus outlines and visible labels,
and preserve `[hidden]` visibility when applying display styles.
The mounted control uses labeled search, native checkbox/radio choices,
announced loading/error states, retry/paging buttons and selected-value remove
buttons. It keeps unchanged choice nodes to preserve focus while state updates.

Pass `label`, `description`, `search: false` or `messages` overrides to
`mountSelectionControl`; message keys are `searchLabel`, `loading`, `empty`,
`errorPrefix`, `retry`, `more`, `clear` and `selectedLabel`. `formatLabel`
customizes displayed option text. Linked loaders also accept
`formatRecordLabel(record, table)` for application-specific labels. Renderers
assign text through text APIs; they never interpret labels/messages as HTML.
For fully custom layout or styling, use the headless model directly.

The repository's `examples/ui-selection` is a separate installed-archive
consumer with synthetic metadata, native controls, an async picker, visitor
reset, error/empty/race/page scenarios and a preview using the existing
[FormulaRunner](formulas.md#field-references-and-context). It has no credentials
or network fixtures. Its one-shot build exits; its optional loopback preview
serves on port 34921. The example source is not bundled into the customer
archive; this guide contains the customer-facing integration recipes.

Deterministic tests and that local browser sandbox prove UI interaction and
package boundaries. They do not prove a particular staging deployment accepts
your published extension or key. Server compatibility remains a separate
validation step with its own authorized environment and fixtures.
