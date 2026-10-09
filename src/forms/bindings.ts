import type { DateFieldModel, DateFieldState } from '../ui/dateModel.js';
import {
    createFormSelectChoiceController,
    type FormSelectChoiceController,
    type FormSelectChoiceSnapshot,
    type SelectChoiceRecovery,
    type SelectChoiceAdapter,
} from './selectChoiceController.js';
import type { ScalarFieldModel, ScalarFieldState } from '../ui/scalarModels.js';
import { createFieldBinding } from './fieldBinding.js';
import {
    createFormAttachmentController,
    type FormAttachmentController,
    type AttachmentRecovery,
    type FormAttachmentControllerOptions,
} from './attachmentController.js';
import type { AirtableValue, FormLoadedResult } from '../runtime/types.js';
import { createSelectionModel } from '../ui/model.js';
import { guardFormLinkedRecordPage } from '../ui/linkedRecordPages.js';
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
import {
    createFormLinkedRecordsOwner,
    type FormLinkedRecordsFacet,
} from './linkedRecords.js';

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
    scalar?: ScalarFieldState | null;
    date?: DateFieldState | null;
    retired: boolean;
    choiceCreation?: FormSelectChoiceSnapshot | null;
};
export type FormFieldBinding = {
    getSnapshot(): FormFieldSnapshot;
    subscribe(listener: (state: FormFieldSnapshot) => void): () => void;
    setValue(value: AirtableValue): FieldActionResult;
    /** Renderer-neutral model; native data is written only through its user actions. */
    selection: SelectionModel | null;
    scalar: ScalarFieldModel | null;
    date: DateFieldModel | null;
    readonly choiceCreation?: FormSelectChoiceController | null;
};
export type FormFieldBindingsOptions = FormControllerOptions & {
    /** Advance for accepted linked-record configuration replacement, including observed ABA. */
    configurationRevision?(): string | number;
    /** Explicit client zone for dateTime presentation; never a local-time parser. */
    getClientTimeZone?(): string;
    /** Additional explicit UI/recovery lease. It never clears native data. */
    canWrite?(): boolean;
    /** Additional accepted-render field lease; refusal never prunes native data. */
    canWriteField?(fieldId: string): boolean;
};
export type FormFieldBindings = {
    controller: FormController;
    getLoaded(): FormLoadedResult;
    /** Existing owner-held queues only; never constructs an attachment controller. */
    hasPendingFiles(): boolean;
    attachment(
        fieldId: string,
        recovery: AttachmentRecovery,
        adapter?: Pick<
            FormAttachmentControllerOptions,
            'getLoaded' | 'isCurrent' | 'configurationRevision' | 'onAttempt'
        >
    ): FormAttachmentController;
    selectChoice(
        fieldId: string,
        recovery: SelectChoiceRecovery,
        adapter?: SelectChoiceAdapter
    ): FormSelectChoiceController;
    field(fieldId: string): FormFieldBinding;
    /** Read-only rich data; constructing/subscribing never dispatches a read. */
    linkedRecords(fieldId: string): FormLinkedRecordsFacet;
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
    // Server-accepted selection IDs stay separate from dirty values kept across reload.
    let originalLinkedRecordData = structuredClone(
        initial.loaded.payload.formRecord.data
    );
    const controller = createFormController({ ...initial, loaded, store });
    let epoch = controller.getState().epoch;
    let contextRevision = controller.getState().contextRevision;
    const choiceCreators = new Map<string, FormSelectChoiceController>();
    const choiceBlocked = () =>
        [...choiceCreators.values()].some((model) => model.blocksForm());
    const attachments = new Map<string, FormAttachmentController>();
    const attachmentBlocked = () =>
        [...attachments.values()].some((model) => model.blocksForm());
    let retired = false;
    let disposed = false;
    let syncing = false;
    let pendingRead: AbortController | null = null;
    let readGeneration = 0;
    let readError: string | null = null;
    let visibility: Record<string, FormFieldVisibility> = {};
    let linkedRecordsOwner: ReturnType<
        typeof createFormLinkedRecordsOwner
    > | null = null;
    const linkedOptionRevisions = new Map<string, number>();
    const replacingLinkedOptions = new Map<string, number>();
    const beginLinkedReplacement = (id: string) => {
        const ticket = (linkedOptionRevisions.get(id) ?? 0) + 1;
        linkedOptionRevisions.set(id, ticket);
        replacingLinkedOptions.set(id, ticket);
        return ticket;
    };
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
        const oldLinkedRecords = linkedRecordsOwner;
        linkedRecordsOwner = null;
        oldLinkedRecords?.destroy();
        for (const entry of entries.values()) {
            entry.stop?.();
            entry.model?.destroy();
            entry.binding.date?.destroy();
        }
    };
    const current = () => {
        const state = controller.getState();
        if (
            retired ||
            state.epoch !== epoch ||
            state.contextRevision !== contextRevision ||
            state.draft === null
        )
            return false;
        return true;
    };
    // A cancelled mutation retires its old bindings, but not the accepted owner
    // of an explicit recovery read. Replaced/disposed owners cannot recover here.
    const recoverable = () => {
        const state = controller.getState();
        return (
            !disposed &&
            state.draft !== null &&
            state.contextRevision === contextRevision &&
            (state.status === 'cancelled' ||
                state.status === 'transport-error') &&
            (options.isCurrent?.() ?? true)
        );
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
            if (
                retired ||
                state.epoch !== epoch ||
                state.contextRevision !== contextRevision ||
                state.draft === null
            ) {
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
                        choiceBlocked() ||
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
            choiceBlocked() ||
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
        const binding: FormFieldBinding = createFieldBinding({
            getClientTimeZone: options.getClientTimeZone,
            fieldType: descriptor.fieldType,
            model,
            write: (value) => setValue(id, value),
            snapshot: () => {
                const live = ownsBinding();
                const now = controller.getState();
                return structuredClone({
                    field: live
                        ? (() => {
                              const descriptor = now.fields.find(
                                  (field) => field.fieldId === id
                              );
                              return descriptor == null
                                  ? null
                                  : {
                                        ...descriptor,
                                        schema:
                                            loaded.payload.fieldIdsToSchemas[
                                                id
                                            ] ?? descriptor.schema,
                                    };
                          })()
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
                        !choiceBlocked() &&
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
                    choiceCreation: live
                        ? (choiceCreators.get(id)?.getSnapshot() ?? null)
                        : null,
                });
            },
            subscribe: (listener) => {
                listeners.add(listener);
                listener(binding.getSnapshot());
                return () => listeners.delete(listener);
            },
        });
        Object.defineProperty(binding, 'choiceCreation', {
            get: () =>
                ownsBinding() ? (choiceCreators.get(id) ?? null) : null,
        });
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
    const hasPendingFiles = () =>
        [...attachments.values()].some(
            (model) => model.getSnapshot().files.length > 0
        );
    const owner: FormFieldBindings = {
        hasPendingFiles,
        controller,
        getLoaded: () => {
            if (!current()) throw new Error('This Form owner is retired.');
            return structuredClone(loaded);
        },
        attachment: (id, recovery, adapter) => {
            if (!current()) throw new Error('This Form owner is retired.');
            let model = attachments.get(id);
            if (model == null) {
                model = createFormAttachmentController({
                    ...recovery,
                    ...adapter,
                    form: owner,
                    fieldId: id,
                    client: options.client,
                    changed: () => refresh(),
                });
                attachments.set(id, model);
            }
            return model;
        },
        selectChoice: (id, recovery, adapter = {}) => {
            if (!current()) throw new Error('This Form owner is retired.');
            let model = choiceCreators.get(id);
            if (model != null) return model;
            const binding = field(id);
            const type = binding.getSnapshot().field?.fieldType;
            if (type !== 'singleSelect' && type !== 'multipleSelects')
                throw new TypeError('A select field is required.');
            model = createFormSelectChoiceController({
                ...recovery,
                ...adapter,
                form: owner,
                fieldId: id,
                client: options.client,
                getLoaded: () => {
                    const page = structuredClone(
                        adapter.getLoaded?.() ?? loaded
                    );
                    const schema = page.payload.fieldIdsToSchemas[id];
                    const config = schema?.airtableField.config;
                    if (
                        config?.type === 'singleSelect' ||
                        config?.type === 'multipleSelects'
                    ) {
                        const handle = openLoadedFormDraft({
                            store,
                            loaded,
                            parent: options.parent,
                        });
                        const additions = store.choices(handle, id);
                        config.options = {
                            ...config.options,
                            choices: [
                                ...(config.options?.choices ?? []),
                                ...additions.filter(
                                    (choice) =>
                                        !(config.options?.choices ?? []).some(
                                            (item) => item.id === choice.id
                                        )
                                ),
                            ],
                        };
                    }
                    return page;
                },
                canWrite: () =>
                    current() &&
                    !choiceBlocked() &&
                    !attachmentBlocked() &&
                    pendingRead === null &&
                    (options.canWrite?.() ?? true) &&
                    (options.canWriteField?.(id) ?? true) &&
                    visibility[id]?.type === 'visible',
                canAccept: () =>
                    current() &&
                    !attachmentBlocked() &&
                    pendingRead === null &&
                    (options.canWriteField?.(id) ?? true) &&
                    (adapter.canAccept?.() ?? options.canWrite?.() ?? true) &&
                    visibility[id]?.type === 'visible' &&
                    ['ready', 'saved', 'validation-error'].includes(
                        controller.getState().status
                    ),
                changed: refresh,
                install: (choice, selected, accepted) => {
                    if (!current()) return false;
                    const state = controller.getState();
                    const schema = loaded.payload.fieldIdsToSchemas[id]!;
                    const config = schema.airtableField.config;
                    if (
                        config.type !== 'singleSelect' &&
                        config.type !== 'multipleSelects'
                    )
                        return false;
                    const handle = openLoadedFormDraft({
                        store,
                        loaded,
                        parent: options.parent,
                    });
                    const install = () => {
                        store.addChoice(handle, id, choice);
                        config.options = {
                            ...config.options,
                            choices: [
                                ...(config.options?.choices ?? []).filter(
                                    (item) => item.id !== choice.id
                                ),
                                structuredClone(choice),
                            ],
                        };
                        accepted();
                    };
                    const native = state.draft!.data[id];
                    const alreadySelected =
                        type === 'multipleSelects'
                            ? Array.isArray(native) &&
                              native.includes(choice.name)
                            : native === choice.name;
                    if (selected && !alreadySelected) {
                        const value =
                            type === 'multipleSelects'
                                ? [
                                      ...(Array.isArray(state.draft!.data[id])
                                          ? (state.draft!.data[id] as string[])
                                          : []),
                                      choice.name,
                                  ]
                                : choice.name;
                        return controller.write(id, value, install);
                    }
                    install();
                    refresh();
                    return true;
                },
            });
            choiceCreators.set(id, model);
            refresh();
            return model;
        },
        field,
        linkedRecords: (id) => {
            if (!current() || pendingRead || replacingLinkedOptions.has(id))
                throw new Error('A current idle Form owner is required.');
            linkedRecordsOwner ??= createFormLinkedRecordsOwner({
                client: options.client,
                loaded,
                originalRecordData: originalLinkedRecordData,
                field,
                isCurrent: current,
                configurationRevision: () =>
                    options.configurationRevision?.() ?? 0,
            });
            return linkedRecordsOwner.field(id);
        },
        refresh,
        save: (supplied) => {
            if (
                pendingRead !== null ||
                hasPendingFiles() ||
                !(options.canWrite?.() ?? true) ||
                attachmentBlocked() ||
                choiceBlocked() ||
                !current() ||
                [...entries.values()].some((entry) => {
                    const state = entry.binding.getSnapshot();
                    return (
                        state.canEdit &&
                        (state.scalar?.valid === false ||
                            state.date?.valid === false)
                    );
                })
            )
                return Promise.reject(
                    new Error(
                        'This Form is unavailable until its explicit load completes.'
                    )
                );
            return controller.save({
                ...supplied,
                isCurrent: () =>
                    (supplied?.isCurrent?.() ?? true) &&
                    [...entries.values()].every((entry) => {
                        const state = entry.binding.getSnapshot();
                        return (
                            state.visibility.type !== 'visible' ||
                            state.readOnly ||
                            !entry.binding.date ||
                            entry.binding.date.getState().valid
                        );
                    }),
            });
        },
        setLinkedOptions: (id, supplied, append = false) => {
            const ticket = beginLinkedReplacement(id);
            try {
                if (!current()) return;
                const binding = field(id);
                const model = binding.selection;
                const fieldEpoch = epoch;
                const owns = () =>
                    linkedOptionRevisions.get(id) === ticket &&
                    current() &&
                    epoch === fieldEpoch &&
                    entries.get(id)?.binding === binding &&
                    linkedOptionRevisions.get(id) === ticket;
                if (
                    binding.getSnapshot().field?.fieldType !==
                        'multipleRecordLinks' ||
                    !model
                )
                    throw new TypeError('A linked field is required.');
                if (!owns()) return;
                linkedRecordsOwner?.clearOptions(id);
                if (!owns()) return;
                const existing = append ? model.getState().options : [];
                const next = [...existing, ...structuredClone(supplied)];
                if (!owns()) return;
                // A static replacement must also retire any older option read.
                // Cancellation retains native selection and invokes no request.
                model.cancel();
                if (!owns()) return;
                model.setOptions(next);
            } finally {
                if (replacingLinkedOptions.get(id) === ticket)
                    replacingLinkedOptions.delete(id);
            }
        },
        setLinkedLoader: (id, loader) => {
            const ticket = beginLinkedReplacement(id);
            try {
                if (!current()) return;
                const binding = field(id);
                const model = binding.selection;
                const fieldEpoch = epoch;
                const owns = () =>
                    linkedOptionRevisions.get(id) === ticket &&
                    current() &&
                    epoch === fieldEpoch &&
                    entries.get(id)?.binding === binding &&
                    linkedOptionRevisions.get(id) === ticket;
                const descriptor = binding.getSnapshot().field;
                if (descriptor?.fieldType !== 'multipleRecordLinks' || !model)
                    throw new TypeError('A linked field is required.');
                const schema = descriptor.schema;
                if (schema.airtableField.config.type !== 'multipleRecordLinks')
                    throw new TypeError('A linked field is required.');
                const linkedTableId =
                    schema.airtableField.config.options.linkedTableId;
                const token = loaded.payload.extensionAccessToken;
                if (!owns()) return;
                linkedRecordsOwner?.clearOptions(id);
                if (!owns()) return;
                const state = model.getState();
                if (!owns()) return;
                const wrapped: SelectionLoader = Object.assign(
                    async (request: Parameters<SelectionLoader>[0]) => {
                        if (!current())
                            throw new Error(
                                'The linked field owner is retired.'
                            );
                        const result = await loader(request);
                        if (!current())
                            throw new Error(
                                'The linked field owner is retired.'
                            );
                        return guardFormLinkedRecordPage(
                            result,
                            options.client,
                            token,
                            id,
                            linkedTableId
                        );
                    },
                    {
                        isCurrent: () =>
                            current() && (loader.isCurrent?.() ?? true),
                    }
                );
                if (!owns()) return;
                model.reset({
                    ...state,
                    selectedOptions: state.selectedOptions,
                    loadOptions: wrapped,
                    onChange: (values) => {
                        const result = setValue(id, [...values]);
                        if (!result.accepted) refresh();
                    },
                });
            } finally {
                if (replacingLinkedOptions.get(id) === ticket)
                    replacingLinkedOptions.delete(id);
            }
        },
        reload: async (request) => {
            if (request.dirty !== 'keep' && request.dirty !== 'discard')
                throw new TypeError(
                    'Reload requires an explicit keep or discard choice.'
                );
            if (
                (!current() && !recoverable()) ||
                controller.getState().status === 'saving'
            )
                return false;
            const generation = ++readGeneration;
            const capturedEpoch = epoch;
            const capturedControllerEpoch = controller.getState().epoch;
            const capturedContextRevision =
                controller.getState().contextRevision;
            // Retirement itself changes this owner’s presentation state. Observe
            // controller identity separately before disposing or replacing drafts.
            const ownsReplacement = () => {
                const sameController = () => {
                    const state = controller.getState();
                    return (
                        state.epoch === capturedControllerEpoch &&
                        state.contextRevision === capturedContextRevision &&
                        state.draft !== null &&
                        state.status !== 'stale' &&
                        state.status !== 'disposed'
                    );
                };
                const sameRead = () =>
                    !disposed &&
                    generation === readGeneration &&
                    capturedEpoch === epoch &&
                    pendingRead === abort &&
                    !abort.signal.aborted;
                return (
                    sameRead() &&
                    sameController() &&
                    (options.isCurrent?.() ?? true) &&
                    sameController() &&
                    sameRead()
                );
            };
            const ownsRead = () =>
                capturedControllerEpoch === controller.getState().epoch &&
                (current() || recoverable());
            const previous = pendingRead;
            const abort = new AbortController();
            pendingRead = abort;
            const previousLinkedRecords = linkedRecordsOwner;
            linkedRecordsOwner = null;
            previousLinkedRecords?.destroy();
            refresh();
            readError = null;
            notify();
            previous?.abort();
            try {
                const fresh = structuredClone(await request.read(abort.signal));
                if (
                    generation !== readGeneration ||
                    capturedEpoch !== epoch ||
                    !ownsRead() ||
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
                const freshOriginalLinkedRecordData = structuredClone(
                    fresh.payload.formRecord.data
                );
                if (request.dirty === 'keep') {
                    for (const id of snapshot.dirtyFieldIds)
                        if (Object.hasOwn(snapshot.data, id))
                            fresh.payload.formRecord.data[id] = structuredClone(
                                snapshot.data[id]
                            );
                    fresh.payload.formFieldIdsWithUnsavedChanges = [
                        ...new Set([
                            ...fresh.payload.formFieldIdsWithUnsavedChanges,
                            ...snapshot.dirtyFieldIds,
                        ]),
                    ];
                }
                retired = true;
                retireEntries();
                notify();
                // Subscribers may synchronously replace the controller or dispose
                // this owner. The old reload must not discard a successor draft.
                if (!ownsReplacement()) return false;
                // Retire old bindings, not successor state, before replacing the owner epoch.
                for (const entry of entries.values()) entry.listeners.clear();
                entries.clear();
                for (const model of attachments.values()) model.dispose();
                attachments.clear();
                for (const model of choiceCreators.values()) model.dispose();
                choiceCreators.clear();
                if (!ownsReplacement()) return false;
                const handle = openLoadedFormDraft({
                    store,
                    loaded,
                    parent: options.parent,
                });
                store.discard(handle);
                loaded = fresh;
                originalLinkedRecordData = freshOriginalLinkedRecordData;
                options = {
                    ...options,
                    loaded,
                    saveOptions: request.saveOptions ?? options.saveOptions,
                };
                syncing = true;
                try {
                    const nextContextRevision = contextRevision + 1;
                    controller.reset({ ...options, store });
                    if (
                        controller.getState().contextRevision !==
                        nextContextRevision
                    )
                        return false;
                    epoch = controller.getState().epoch;
                    contextRevision = nextContextRevision;
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
                    ownsRead()
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
            for (const model of choiceCreators.values()) model.dispose();
            choiceCreators.clear();
            retireEntries();
            if (controller.getState().contextRevision === contextRevision)
                controller.destroy();
            notify();
            for (const entry of entries.values()) entry.listeners.clear();
            previous?.abort();
        },
    };
    return owner;
}
