import {
    createFormAttachmentController,
    type FormAttachmentController,
    type AttachmentRecovery,
} from './attachmentController.js';
import type { AirtableValue, FormLoadedResult } from '../runtime/types.js';
import { createSelectionModel } from '../ui/model.js';
import { createSelectFieldModel } from '../ui/selectModel.js';
import { resolveSelectFieldAvailability } from '../ui/selectAvailability.js';
import type {
    SelectionLoader,
    SelectionModel,
    SelectionState,
} from '../ui/types.js';
import {
    createFormController,
    type FormController,
    type FormControllerOptions,
    type FormControllerSaveOptions,
    type FormControllerState,
} from './controller.js';
import { FormDraftStore } from './drafts.js';
import {
    openLoadedFormDraft,
    type FormValidationMessage,
    type LoadedFormFieldDescriptor,
    type FormSaveOptions,
} from './helpers.js';
import {
    composeFormFieldVisibility,
    type FormFieldVisibility,
} from './visibility.js';
import { formChoiceConditionRecord } from './choiceRecord.js';

export type FieldActionResult =
    | { accepted: true }
    | {
          accepted: false;
          reason:
              | 'retired'
              | 'readonly'
              | 'hidden'
              | 'blocked'
              | 'invalid-value';
      };
export type FormFieldSnapshot = {
    field: LoadedFormFieldDescriptor | null;
    value: AirtableValue | undefined;
    dirty: boolean;
    revision: number | null;
    visibility: FormFieldVisibility;
    readOnly: boolean;
    canEdit: boolean;
    pending: boolean;
    error: string | null;
    validation: FormValidationMessage[];
    selection: SelectionState | null;
    retired: boolean;
};
export type FormFieldBinding = {
    getSnapshot(): FormFieldSnapshot;
    subscribe(listener: (state: FormFieldSnapshot) => void): () => void;
    setValue(value: AirtableValue): FieldActionResult;
    /** Renderer-neutral model; native data is written only through its user actions. */
    selection: SelectionModel | null;
};
export type FormFieldBindingsOptions = FormControllerOptions & {
    /** Additional explicit UI/recovery lease. It never clears native data. */
    canWrite?(): boolean;
    /** Additional accepted-render field lease; refusal never prunes native data. */
    canWriteField?(fieldId: string): boolean;
};
export type FormFieldBindings = {
    controller: FormController;
    getLoaded(): FormLoadedResult;
    attachment(
        fieldId: string,
        recovery: AttachmentRecovery
    ): FormAttachmentController;
    field(fieldId: string): FormFieldBinding;
    refresh(): void;
    setLinkedLoader(fieldId: string, loader: SelectionLoader): void;
    /** Accepted field-specific presentation only, not a table-wide cache. */
    setLinkedOptions(
        fieldId: string,
        options: readonly { value: string; label: string }[],
        append?: boolean
    ): void;
    save(
        options?: FormControllerSaveOptions
    ): ReturnType<FormController['save']>;
    reload(options: {
        dirty: 'keep' | 'discard';
        read(signal: AbortSignal): Promise<FormLoadedResult>;
        saveOptions?: FormSaveOptions;
    }): Promise<boolean>;
    destroy(): void;
};

const invalid = (): FormFieldVisibility => ({
    type: 'blocked',
    code: 'invalid',
    diagnostics: [],
});
const linkedValues = (value: AirtableValue | undefined): string[] | null => {
    if (value == null || (typeof value === 'string' && value.trim() === ''))
        return [];
    if (
        !Array.isArray(value) ||
        Array.from(value).some(
            (id, index) =>
                !Object.hasOwn(value, index) ||
                typeof id !== 'string' ||
                id.trim() === ''
        )
    )
        return null;
    return [...value] as string[];
};

/** One accepted Form owner. Renderer unmount only unsubscribes; never call destroy for a rerender. */
export function createFormFieldBindings(
    initial: FormFieldBindingsOptions
): FormFieldBindings {
    let options = initial;
    const store = initial.store ?? new FormDraftStore<AirtableValue>();
    let loaded = structuredClone(initial.loaded);
    const controller = createFormController({ ...initial, loaded, store });
    let epoch = controller.getState().epoch;
    const attachments = new Map<string, FormAttachmentController>();
    const attachmentBlocked = () =>
        [...attachments.values()].some((model) => {
            const state = model.getSnapshot();
            return state.busy || state.phase === 'uncertain';
        });
    let retired = false;
    let disposed = false;
    let syncing = false;
    let pendingRead: AbortController | null = null;
    let readGeneration = 0;
    let readError: string | null = null;
    let visibility: Record<string, FormFieldVisibility> = {};
    const entries = new Map<
        string,
        {
            binding: FormFieldBinding;
            listeners: Set<(state: FormFieldSnapshot) => void>;
            model: SelectionModel | null;
            stop: (() => void) | null;
        }
    >();
    const retireEntries = () => {
        for (const entry of entries.values()) {
            entry.stop?.();
            entry.model?.destroy();
        }
    };
    const current = () => {
        const state = controller.getState();
        if (retired || state.epoch !== epoch || state.draft === null)
            return false;
        return true;
    };
    const notify = () => {
        for (const entry of entries.values())
            for (const listener of [...entry.listeners]) {
                if (!entry.listeners.has(listener)) continue;
                try {
                    listener(entry.binding.getSnapshot());
                } catch {
                    /* A renderer is not the operation owner. */
                }
            }
    };
    const refresh = () => {
        if (syncing) return;
        syncing = true;
        try {
            const state = controller.getState();
            if (retired || state.epoch !== epoch || state.draft === null) {
                retired = true;
                retireEntries();
                visibility = {};
                notify();
                return;
            }
            const schemas = loaded.payload.fieldIdsToSchemas;
            const handle = openLoadedFormDraft({
                store,
                loaded,
                parent: options.parent,
            });
            for (const [id, schema] of Object.entries(schemas)) {
                const config = schema.airtableField.config;
                if (
                    config.type !== 'singleSelect' &&
                    config.type !== 'multipleSelects'
                )
                    continue;
                const additions = store.choices(handle, id);
                if (additions.length) {
                    const choices = new Map(
                        (config.options?.choices ?? []).map((choice) => [
                            choice.id,
                            choice,
                        ])
                    );
                    for (const choice of additions)
                        choices.set(choice.id, choice);
                    config.options = {
                        ...config.options,
                        choices: [...choices.values()],
                    };
                }
            }
            visibility = composeFormFieldVisibility({
                fieldIds: loaded.payload.fieldIdsInForm.filter(
                    (id) => schemas[id] != null
                ),
                fieldIdsToSchemas: schemas,
                airtableFields: Object.values(schemas).map(
                    (schema) => schema.airtableField
                ),
                data: state.draft.data,
                formRecordType: loaded.payload.formRecord.type,
                evaluationMode: 'runtime',
                invalidConditionMode: 'strict',
            });
            for (const [id, entry] of entries) {
                const descriptor = state.fields.find(
                    (field) => field.fieldId === id
                );
                if (!descriptor || !entry.model) continue;
                const native = state.draft.data[id];
                const isSelect =
                    descriptor.fieldType === 'singleSelect' ||
                    descriptor.fieldType === 'multipleSelects';
                const value = isSelect
                    ? descriptor.fieldType === 'singleSelect'
                        ? typeof native === 'string' && native !== ''
                            ? [native]
                            : []
                        : Array.isArray(native)
                          ? native.filter(
                                (item): item is string =>
                                    typeof item === 'string'
                            )
                          : []
                    : linkedValues(native);
                if (value !== null) entry.model.setValue(value);
                if (isSelect) {
                    try {
                        const availability = resolveSelectFieldAvailability({
                            field: schemas[id],
                            airtableFields: Object.values(schemas).map(
                                (schema) => schema.airtableField
                            ),
                            recordForConditionEvaluation:
                                formChoiceConditionRecord(
                                    loaded,
                                    descriptor.schema,
                                    state.draft.data
                                ),
                            mode: 'runtime',
                            invalidConditionMode: 'compatibility',
                        });
                        entry.model.setOptions(availability.options);
                    } catch {
                        entry.model.setOptions([]);
                    }
                }
                entry.model.setReadOnly(descriptor.readOnly);
                entry.model.setDisabled(
                    visibility[id]?.type !== 'visible' ||
                        pendingRead !== null ||
                        !(options.canWrite?.() ?? true) ||
                        attachmentBlocked() ||
                        !(options.canWriteField?.(id) ?? true) ||
                        state.status === 'saving' ||
                        state.status === 'cancelled' ||
                        state.status === 'transport-error'
                );
            }
            notify();
        } finally {
            syncing = false;
        }
    };
    const setValue = (id: string, value: AirtableValue): FieldActionResult => {
        if (!current()) return { accepted: false, reason: 'retired' };
        const state = controller.getState();
        const descriptor = state.fields.find((field) => field.fieldId === id);
        if (!descriptor || descriptor.readOnly)
            return { accepted: false, reason: 'readonly' };
        if (
            pendingRead !== null ||
            !(options.canWrite?.() ?? true) ||
            attachmentBlocked() ||
            !(options.canWriteField?.(id) ?? true) ||
            state.status === 'saving' ||
            state.status === 'cancelled' ||
            state.status === 'transport-error'
        )
            return { accepted: false, reason: 'blocked' };
        if (visibility[id]?.type !== 'visible')
            return {
                accepted: false,
                reason:
                    visibility[id]?.type === 'hidden' ? 'hidden' : 'blocked',
            };
        if (
            descriptor.fieldType === 'multipleRecordLinks' &&
            linkedValues(value) === null
        )
            return { accepted: false, reason: 'invalid-value' };
        return controller.write(id, value)
            ? { accepted: true }
            : { accepted: false, reason: 'retired' };
    };
    const field = (id: string): FormFieldBinding => {
        const existing = entries.get(id);
        if (existing) return existing.binding;
        if (!current()) throw new Error('This Form binding owner is retired.');
        const state = controller.getState();
        const descriptor = state.fields.find((field) => field.fieldId === id);
        if (!descriptor)
            throw new Error('The field is not returned by this Form.');
        const schema = descriptor.schema;
        const native = state.draft!.data[id];
        let model: SelectionModel | null = null;
        if (
            descriptor.fieldType === 'singleSelect' ||
            descriptor.fieldType === 'multipleSelects'
        ) {
            model = createSelectFieldModel({
                field: schema,
                value: native,
                onChange: (value) => {
                    if (!ownsBinding()) return;
                    const result = setValue(id, value);
                    if (!result.accepted) refresh();
                },
            });
        } else if (descriptor.fieldType === 'multipleRecordLinks') {
            model = createSelectionModel({
                multiple: true,
                value: linkedValues(native) ?? [],
                readOnly: descriptor.readOnly,
                selectedOptions: (linkedValues(native) ?? []).map((value) => ({
                    value,
                    label: 'Linked record',
                })),
                onChange: (values) => {
                    if (!ownsBinding()) return;
                    const result = setValue(id, [...values]);
                    if (!result.accepted) refresh();
                },
            });
        }
        const fieldEpoch = epoch;
        const ownsBinding = () =>
            current() &&
            epoch === fieldEpoch &&
            entries.get(id)?.binding === binding;
        const listeners = new Set<(state: FormFieldSnapshot) => void>();
        const binding: FormFieldBinding = {
            selection: model,
            setValue: (value) => {
                if (!ownsBinding())
                    return { accepted: false, reason: 'retired' };
                if (!binding.getSnapshot().canEdit)
                    return { accepted: false, reason: 'blocked' };
                if (model) {
                    let values: string[] | null;
                    if (descriptor.fieldType === 'multipleRecordLinks')
                        values = linkedValues(value);
                    else if (descriptor.fieldType === 'singleSelect')
                        values =
                            value == null
                                ? []
                                : typeof value === 'string'
                                  ? value === ''
                                      ? []
                                      : [value]
                                  : null;
                    else
                        values =
                            Array.isArray(value) &&
                            Array.from(value).every(
                                (item, index) =>
                                    Object.hasOwn(value, index) &&
                                    typeof item === 'string' &&
                                    item !== ''
                            )
                                ? ([...value] as string[])
                                : value == null
                                  ? []
                                  : null;
                    if (values === null)
                        return { accepted: false, reason: 'invalid-value' };
                    const available = model.getState();
                    const selected = new Set(available.value);
                    const allowed = new Set(
                        available.options
                            .filter((option) => option.disabled !== true)
                            .map((option) => option.value)
                    );
                    if (
                        values.some(
                            (value) =>
                                !selected.has(value) && !allowed.has(value)
                        )
                    )
                        return { accepted: false, reason: 'invalid-value' };
                    model.choose(values);
                    return model.getState().value.length ===
                        new Set(values).size &&
                        values.every((item) =>
                            model.getState().value.includes(item)
                        )
                        ? { accepted: true }
                        : { accepted: false, reason: 'invalid-value' };
                }
                return setValue(id, value);
            },
            getSnapshot: () => {
                const live = ownsBinding();
                const now = controller.getState();
                return structuredClone({
                    field: live
                        ? (now.fields.find((field) => field.fieldId === id) ??
                          null)
                        : null,
                    value: live ? now.draft?.data[id] : undefined,
                    dirty:
                        live &&
                        (now.draft?.dirtyFieldIds.includes(id) ?? false),
                    revision: live ? now.draftRevision : null,
                    visibility: live
                        ? (options.canWriteField?.(id) ?? true)
                            ? (visibility[id] ?? invalid())
                            : invalid()
                        : invalid(),
                    readOnly: !live || descriptor.readOnly,
                    canEdit:
                        live &&
                        !descriptor.readOnly &&
                        visibility[id]?.type === 'visible' &&
                        (options.canWrite?.() ?? true) &&
                        !attachmentBlocked() &&
                        (options.canWriteField?.(id) ?? true) &&
                        pendingRead === null &&
                        (now.status === 'ready' ||
                            now.status === 'validation-error' ||
                            now.status === 'saved'),
                    pending:
                        live &&
                        (pendingRead !== null ||
                            now.status === 'saving' ||
                            model?.getState().loading === true),
                    error: live
                        ? (readError ??
                          now.errorMessage ??
                          model?.getState().error ??
                          null)
                        : null,
                    validation: live
                        ? now.validationErrors.filter(
                              (error) => error.fieldId === id
                          )
                        : [],
                    selection: live ? (model?.getState() ?? null) : null,
                    retired: !live,
                });
            },
            subscribe: (listener) => {
                listeners.add(listener);
                listener(binding.getSnapshot());
                return () => listeners.delete(listener);
            },
        };
        entries.set(id, {
            binding,
            listeners,
            model,
            stop:
                model?.subscribe(() => {
                    if (!syncing) notify();
                }) ?? null,
        });
        refresh();
        return binding;
    };
    const unsubscribe = controller.subscribe(() => refresh());
    refresh();
    const owner: FormFieldBindings = {
        controller,
        getLoaded: () => {
            if (!current()) throw new Error('This Form owner is retired.');
            return structuredClone(loaded);
        },
        attachment: (id, recovery) => {
            if (!current()) throw new Error('This Form owner is retired.');
            let model = attachments.get(id);
            if (model == null) {
                model = createFormAttachmentController({
                    ...recovery,
                    form: owner,
                    fieldId: id,
                    client: options.client,
                    changed: () => refresh(),
                });
                attachments.set(id, model);
            }
            return model;
        },
        field,
        refresh,
        save: (supplied) => {
            if (
                pendingRead !== null ||
                [...attachments.values()].some(
                    (model) => model.getSnapshot().files.length > 0
                ) ||
                !(options.canWrite?.() ?? true) ||
                attachmentBlocked() ||
                !current()
            )
                return Promise.reject(
                    new Error(
                        'This Form is unavailable until its explicit load completes.'
                    )
                );
            return controller.save(supplied);
        },
        setLinkedOptions: (id, supplied, append = false) => {
            if (!current()) return;
            const binding = field(id);
            if (
                binding.getSnapshot().field?.fieldType !== 'multipleRecordLinks'
            )
                throw new TypeError('A linked field is required.');
            const existing = append
                ? binding.selection!.getState().options
                : [];
            binding.selection!.setOptions([
                ...existing,
                ...structuredClone(supplied),
            ]);
        },
        setLinkedLoader: (id, loader) => {
            if (!current()) return;
            const binding = field(id);
            if (
                binding.getSnapshot().field?.fieldType !== 'multipleRecordLinks'
            )
                throw new TypeError('A linked field is required.');
            const state = binding.selection!.getState();
            const wrapped: SelectionLoader = Object.assign(
                async (request: Parameters<SelectionLoader>[0]) => {
                    if (!current())
                        throw new Error('The linked field owner is retired.');
                    const result = await loader(request);
                    if (!current())
                        throw new Error('The linked field owner is retired.');
                    return result;
                },
                { isCurrent: () => current() && (loader.isCurrent?.() ?? true) }
            );
            binding.selection!.reset({
                ...state,
                selectedOptions: state.selectedOptions,
                loadOptions: wrapped,
                onChange: (values) => {
                    const result = setValue(id, [...values]);
                    if (!result.accepted) refresh();
                },
            });
        },
        reload: async (request) => {
            if (request.dirty !== 'keep' && request.dirty !== 'discard')
                throw new TypeError(
                    'Reload requires an explicit keep or discard choice.'
                );
            if (!current() || controller.getState().status === 'saving')
                return false;
            const generation = ++readGeneration;
            const capturedEpoch = epoch;
            const previous = pendingRead;
            const abort = new AbortController();
            pendingRead = abort;
            refresh();
            readError = null;
            notify();
            previous?.abort();
            try {
                const fresh = structuredClone(await request.read(abort.signal));
                if (
                    generation !== readGeneration ||
                    capturedEpoch !== epoch ||
                    !current() ||
                    abort.signal.aborted
                )
                    return false;
                if (
                    fresh.extensionId !== loaded.extensionId ||
                    fresh.payload.formRecord.type !==
                        loaded.payload.formRecord.type ||
                    (fresh.payload.formRecord.type === 'edit' &&
                        loaded.payload.formRecord.type === 'edit' &&
                        (fresh.payload.formRecord.recordId !==
                            loaded.payload.formRecord.recordId ||
                            fresh.payload.formRecord.tableId !==
                                loaded.payload.formRecord.tableId))
                )
                    throw new Error('The reload does not match this Form.');
                const snapshot = controller.getState().draft!;
                if (request.dirty === 'keep') {
                    for (const id of snapshot.dirtyFieldIds)
                        if (Object.hasOwn(snapshot.data, id))
                            fresh.payload.formRecord.data[id] = structuredClone(
                                snapshot.data[id]
                            );
                    fresh.payload.formFieldIdsWithUnsavedChanges = [
                        ...snapshot.dirtyFieldIds,
                    ];
                }
                retired = true;
                retireEntries();
                notify();
                // Retire old bindings, not successor state, before replacing the owner epoch.
                for (const entry of entries.values()) entry.listeners.clear();
                entries.clear();
                const handle = openLoadedFormDraft({
                    store,
                    loaded,
                    parent: options.parent,
                });
                store.discard(handle);
                loaded = fresh;
                options = {
                    ...options,
                    loaded,
                    saveOptions: request.saveOptions ?? options.saveOptions,
                };
                for (const model of attachments.values()) model.dispose();
                attachments.clear();
                syncing = true;
                try {
                    controller.reset({ ...options, store });
                    epoch = controller.getState().epoch;
                    retired = false;
                } finally {
                    syncing = false;
                }
                pendingRead = null;
                refresh();
                return true;
            } catch {
                if (
                    generation === readGeneration &&
                    capturedEpoch === epoch &&
                    current()
                ) {
                    readError =
                        'The Form could not be reloaded. Retry explicitly.';
                    notify();
                }
                return false;
            } finally {
                if (pendingRead === abort) {
                    pendingRead = null;
                    refresh();
                }
            }
        },
        destroy: () => {
            if (disposed) return;
            disposed = true;
            retired = true;
            readGeneration++;
            const previous = pendingRead;
            pendingRead = null;
            unsubscribe();
            for (const model of attachments.values()) model.dispose();
            attachments.clear();
            retireEntries();
            controller.destroy();
            notify();
            for (const entry of entries.values()) entry.listeners.clear();
            previous?.abort();
        },
    };
    return owner;
}
