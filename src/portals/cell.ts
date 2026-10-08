import type {
    AirtableValue,
    MiniExtensionsClient,
    RuntimeFieldSchema,
    UpdateGridCellInput,
    UpdateGridCellResult,
} from '../runtime/types.js';
import { FormDraftStore } from '../forms/drafts.js';
import { createFieldBinding } from '../forms/fieldBinding.js';
import type { FormFieldBinding, FormFieldSnapshot } from '../forms/bindings.js';
import { createSelectFieldModel } from '../ui/selectModel.js';
import { createSelectionModel } from '../ui/model.js';
import type { SelectionModel } from '../ui/types.js';
import { RecoveryJournal, type RecoveryScope } from '../forms/recovery.js';
import type { PortalOwnerScope } from './types.js';

export type PortalCellBindingOptions = {
    client: MiniExtensionsClient;
    input: Omit<UpdateGridCellInput, 'value'>;
    schema: RuntimeFieldSchema;
    value: AirtableValue;
    getScope(): PortalOwnerScope;
    /** Accepted snapshot/mount/configuration lease; caller retires it on replacement. */
    isCurrent(): boolean;
    recovery: {
        journal: RecoveryJournal;
        scope: RecoveryScope;
        loadVersion: number;
    };
};
export type PortalCellBinding = {
    binding: FormFieldBinding;
    save(options?: {
        signal?: AbortSignal;
        dispatched?(): void;
    }): Promise<UpdateGridCellResult>;
    cancel(): void;
    destroy(): void;
};

const gridValue = (
    value: AirtableValue | undefined
): UpdateGridCellInput['value'] => {
    if (value == null) return null;
    if (
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
    )
        return value;
    if (
        Array.isArray(value) &&
        Array.from(value).every(
            (item, index) =>
                Object.hasOwn(value, index) && typeof item === 'string'
        )
    )
        return [...value] as string[];
    throw new Error('Use the child Form for this field type.');
};

/** One Portal cell; no fabricated Form, network read, grid or storage owner. */
export const createPortalCellBinding = (
    options: PortalCellBindingOptions
): PortalCellBinding => {
    const input = structuredClone(options.input);
    const schema = structuredClone(options.schema);
    if (
        schema.airtableField.id !== input.recordFieldId ||
        schema.fieldType !== schema.airtableField.config.type ||
        ('isComputed' in schema && schema.isComputed === true) ||
        schema.airtableField.isComputed === true ||
        schema.fieldType === 'multipleAttachments'
    )
        throw new Error('This field cannot be edited inline.');
    const config = schema.miniExtConfig;
    if (
        (config != null && 'conditionalFields' in config
            ? (config.conditionalFields?.conditions.length ?? 0)
            : 0) !== 0 ||
        (config != null && 'conditionsForOptions' in config
            ? (config.conditionsForOptions?.length ?? 0)
            : 0) !== 0 ||
        (config != null &&
            'filterLinkedRecordsConditionFields' in config &&
            config.filterLinkedRecordsConditionFields != null &&
            (!('filterLinkedRecordsToggle' in config) ||
                config.filterLinkedRecordsToggle !== false))
    )
        throw new Error('Use the child Form for conditional fields.');
    const readOnly =
        config != null && 'readOnly' in config && config.readOnly === true;
    const scope = { ...options.getScope() };
    const session = structuredClone(options.client.getSession());
    const recovery = {
        ...options.recovery,
        scope: structuredClone(options.recovery.scope),
    };
    const store = new FormDraftStore<AirtableValue>();
    const handle = store.open(
        {
            extensionId: input.portalExtensionAccessToken,
            recordId: input.recordId,
            parent: {
                portalId: input.portalExtensionAccessToken,
                recordId: input.recordId,
                portalFieldId: input.portalFieldId,
            },
        },
        { [input.recordFieldId]: options.value },
        []
    );
    const listeners = new Set<(state: FormFieldSnapshot) => void>();
    let retired = false;
    let busy = false;
    let submitted = false;
    let error: string | null = null;
    let active: AbortController | null = null;
    let model: SelectionModel | null = null;
    const current = () => {
        const next = options.getScope();
        const now = options.client.getSession();
        if (
            !retired &&
            (next.ownerId !== scope.ownerId ||
                next.revision !== scope.revision ||
                !options.isCurrent() ||
                Object.keys(now).length !== Object.keys(session).length ||
                Object.keys(session).some(
                    (key) =>
                        !Object.hasOwn(now, key) || now[key] !== session[key]
                ))
        )
            retired = true;
        return !retired;
    };
    const blocked = () =>
        submitted ||
        recovery.journal.blocking(recovery.scope, input.recordId) !== undefined;
    const snapshot = (): FormFieldSnapshot => {
        const live = current();
        return {
            field: live
                ? {
                      fieldId: input.recordFieldId,
                      title:
                          typeof config?.title === 'string'
                              ? config.title
                              : schema.airtableField.name,
                      fieldType: schema.fieldType,
                      isComputed: false,
                      readOnly,
                      schema,
                  }
                : null,
            value: live ? store.read(handle, input.recordFieldId) : undefined,
            dirty:
                live &&
                (store
                    .snapshot(handle)
                    ?.dirtyFieldIds.includes(input.recordFieldId) ??
                    false),
            revision: live ? store.revision(handle) : null,
            visibility: live
                ? { type: 'visible', diagnostics: [] }
                : { type: 'blocked', code: 'invalid', diagnostics: [] },
            readOnly: !live || readOnly,
            canEdit: live && !readOnly && !busy && !blocked(),
            pending: live && (busy || model?.getState().loading === true),
            error: live ? (error ?? model?.getState().error ?? null) : null,
            validation: [],
            selection: live ? (model?.getState() ?? null) : null,
            retired: !live,
        };
    };
    let notifying = false;
    const notify = () => {
        if (notifying) return;
        notifying = true;
        model?.setDisabled(!snapshot().canEdit);
        try {
            for (const listener of [...listeners]) {
                if (!listeners.has(listener)) continue;
                try {
                    listener(binding.getSnapshot());
                } catch {
                    /* Rendering does not own the mutation. */
                }
            }
        } finally {
            notifying = false;
        }
    };
    const write = (value: AirtableValue) => {
        if (!snapshot().canEdit)
            return { accepted: false as const, reason: 'blocked' as const };
        gridValue(value);
        if (!store.write(handle, input.recordFieldId, value))
            return { accepted: false as const, reason: 'retired' as const };
        notify();
        return { accepted: true as const };
    };
    if (
        schema.fieldType === 'singleSelect' ||
        schema.fieldType === 'multipleSelects'
    )
        model = createSelectFieldModel({
            field: schema,
            value: options.value,
            readOnly,
            onChange: (value) => {
                write(value);
            },
        });
    else if (schema.fieldType === 'multipleRecordLinks') {
        const native = gridValue(options.value) as string[] | null;
        if (native !== null && !Array.isArray(native))
            throw new Error('Invalid linked value.');
        model = createSelectionModel({
            multiple: true,
            value: native ?? [],
            readOnly,
            selectedOptions: (native ?? []).map((value) => ({
                value,
                label: 'Linked record',
            })),
            onChange: (value) => {
                write([...value]);
            },
        });
    }
    const binding = createFieldBinding({
        fieldType: schema.fieldType,
        model,
        snapshot,
        write,
        subscribe: (listener) => {
            listeners.add(listener);
            listener(binding.getSnapshot());
            return () => listeners.delete(listener);
        },
    });
    const stop = model?.subscribe(() => notify());
    const cancel = () => {
        if (!active) return;
        active.abort();
        busy = false;
        error =
            'The cell outcome is unknown. Load a fresh Portal before another change.';
        notify();
    };
    return {
        binding,
        save: async (request = {}) => {
            if (!snapshot().canEdit)
                throw new Error('Load a fresh Portal before saving this cell.');
            const value = gridValue(store.read(handle, input.recordFieldId));
            request.signal?.throwIfAborted();
            const revision = store.revision(handle)!;
            const attempt = recovery.journal.begin(
                recovery.scope,
                input.recordId,
                'save',
                recovery.loadVersion,
                input.recordFieldId
            );
            submitted = true;
            busy = true;
            error = null;
            const abort = new AbortController();
            active = abort;
            const externalAbort = () => abort.abort();
            request.signal?.addEventListener('abort', externalAbort, {
                once: true,
            });
            try {
                request.dispatched?.();
                notify();
                if (!current() || abort.signal.aborted)
                    throw new Error('The cell owner changed before dispatch.');
                const result = await options.client.portals.updateGridCell(
                    { ...input, value },
                    { signal: abort.signal }
                );
                if (
                    !current() ||
                    abort.signal.aborted ||
                    active !== abort ||
                    attempt.outcome !== 'unknown' ||
                    attempt.acknowledgment !== 'none' ||
                    !attempt.flight ||
                    store.revision(handle) !== revision
                )
                    throw new Error('The cell outcome is unknown.');
                recovery.journal.accepted(attempt, 'saved');
                store.markSaved(handle, revision);
                return result;
            } catch (cause) {
                if (current())
                    error =
                        'The cell outcome is unknown. Load fresh records; do not repeat this Save.';
                throw cause;
            } finally {
                request.signal?.removeEventListener('abort', externalAbort);
                recovery.journal.finishFlight(attempt);
                if (active === abort) {
                    active = null;
                    busy = false;
                    if (current()) notify();
                }
            }
        },
        cancel,
        destroy: () => {
            retired = true;
            active?.abort();
            active = null;
            busy = false;
            stop?.();
            model?.destroy();
            store.clear();
            notify();
            listeners.clear();
        },
    };
};
