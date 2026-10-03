import type {
    AirtableValue,
    FormLoadedResult,
    MiniExtensionsClient,
    RuntimeSession,
} from '../runtime/types.js';
import {
    type FormDraftHandle,
    type FormDraftSnapshot,
    FormDraftStore,
    type ParentFormDraftScope,
} from './drafts.js';
import {
    createFormSaveInput,
    describeLoadedFormFields,
    formValidationMessages,
    normalizeFormSaveResult,
    openLoadedFormDraft,
    type FormSaveOptions,
    type FormValidationMessage,
    type LoadedFormFieldDescriptor,
    type NormalizedFormSaveResult,
} from './helpers.js';

/** Applications change revision for visitor, connection, token and context changes. */
export type FormOwnerScope = { ownerId: string; revision: number };

export type FormControllerOptions = {
    client: MiniExtensionsClient;
    loaded: FormLoadedResult;
    saveOptions: FormSaveOptions;
    getScope(): FormOwnerScope;
    /** One visitor owns a store. Clear it when the visitor or connection changes. */
    store?: FormDraftStore<AirtableValue>;
    parent?: ParentFormDraftScope | null;
};

export type FormControllerStatus =
    | 'ready'
    | 'saving'
    | 'validation-error'
    | 'saved'
    | 'transport-error'
    | 'cancelled'
    | 'stale'
    | 'disposed';

export type FormControllerState = {
    ownerScope: FormOwnerScope;
    status: FormControllerStatus;
    canSave: boolean;
    fields: LoadedFormFieldDescriptor[];
    draft: FormDraftSnapshot<AirtableValue> | null;
    validationErrors: FormValidationMessage[];
    concurrentEditErrorMessage: string | null;
    result: NormalizedFormSaveResult | null;
    errorMessage: string | null;
    /** Successful response retained, but newer local writes remain unsaved. */
    hasNewerEdits: boolean;
};

export type FormControllerErrorCode =
    | 'scope-changed'
    | 'save-in-progress'
    | 'reload-required'
    | 'draft-expired'
    | 'cancelled'
    | 'disposed';

export class FormControllerError extends Error {
    readonly code: FormControllerErrorCode;

    constructor(code: FormControllerErrorCode, message: string) {
        super(message);
        this.name = 'FormControllerError';
        this.code = code;
    }
}

export type FormController = {
    getState(): FormControllerState;
    subscribe(listener: (state: FormControllerState) => void): () => void;
    /** Only returned non-computed, non-read-only fields; values stay native. */
    write(fieldId: string, value: AirtableValue): boolean;
    save(options?: { signal?: AbortSignal }): Promise<NormalizedFormSaveResult>;
    /** Explicit scope changes clear the previous store; same-scope resets retain drafts. */
    reset(options: FormControllerOptions): void;
    /** A dispatched cancelled save has an unknown server outcome; reload before resaving. */
    cancel(): void;
    destroy(): void;
};

const readScope = (getScope: () => FormOwnerScope): FormOwnerScope => {
    const scope = getScope();
    if (
        typeof scope?.ownerId !== 'string' ||
        scope.ownerId.trim() === '' ||
        !Number.isSafeInteger(scope.revision) ||
        scope.revision < 0
    ) {
        throw new TypeError(
            'An owner ID and nonnegative scope revision are required.'
        );
    }
    return { ownerId: scope.ownerId, revision: scope.revision };
};

const sameScope = (a: FormOwnerScope, b: FormOwnerScope) =>
    a.ownerId === b.ownerId && a.revision === b.revision;

const sameSession = (a: RuntimeSession, b: RuntimeSession) =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && a[key] === b[key]);

type Context = {
    client: MiniExtensionsClient;
    loaded: FormLoadedResult;
    saveOptions: FormSaveOptions;
    getScope: () => FormOwnerScope;
    scope: FormOwnerScope;
    session: RuntimeSession;
    store: FormDraftStore<AirtableValue>;
    handle: FormDraftHandle;
    fields: LoadedFormFieldDescriptor[];
    contextKey: string;
};

type PreparedContext = Omit<Context, 'handle'> & {
    parent: ParentFormDraftScope | null;
};

const prepare = (options: FormControllerOptions): PreparedContext => {
    const loaded = structuredClone(options.loaded);
    const saveOptions = structuredClone(options.saveOptions);
    const scope = readScope(options.getScope);
    const session = { ...options.client.getSession() };
    const fields = describeLoadedFormFields(loaded);
    const store = options.store ?? new FormDraftStore<AirtableValue>();
    const parent = structuredClone(options.parent ?? null);
    createFormSaveInput({
        loaded,
        draft: {
            data: loaded.payload.formRecord.data,
            dirtyFieldIds: loaded.payload.formFieldIdsWithUnsavedChanges,
        },
        options: saveOptions,
    });
    formValidationMessages(loaded.payload.formErrors, [], loaded);
    return {
        client: options.client,
        loaded,
        saveOptions,
        getScope: options.getScope,
        scope,
        session,
        store,
        fields,
        parent,
        contextKey: JSON.stringify([
            loaded.extensionId,
            loaded.payload.extensionAccessToken,
            loaded.payload.formRecord.type,
            loaded.payload.formRecord.type === 'edit'
                ? [
                      loaded.payload.formRecord.recordId,
                      loaded.payload.formRecord.tableId,
                  ]
                : null,
            parent,
            saveOptions.context,
            saveOptions.searchQuery,
            saveOptions.conditionalLinkedRecordFieldIdsToFilteringValues,
        ]),
    };
};

const openContext = (prepared: PreparedContext): Context => ({
    ...prepared,
    handle: openLoadedFormDraft({
        store: prepared.store,
        loaded: prepared.loaded,
        parent: prepared.parent,
    }),
});

/** Headless presentation helper; all writes still use the existing forms.save operation. */
export const createFormController = (
    options: FormControllerOptions
): FormController => {
    let context = openContext(prepare(options));
    let generation = 0;
    let status: FormControllerStatus = 'ready';
    let validationErrors = formValidationMessages(
        context.loaded.payload.formErrors,
        [],
        context.loaded
    );
    let concurrentEditErrorMessage: string | null = null;
    let result: NormalizedFormSaveResult | null = null;
    let errorMessage: string | null = null;
    let hasNewerEdits = false;
    let savedRevision: number | null = null;
    let active: AbortController | null = null;
    const listeners = new Set<(state: FormControllerState) => void>();
    let emitting = false;
    let pendingEmission = false;
    let emissionRevision = 0;

    const state = (): FormControllerState =>
        structuredClone({
            ownerScope: context.scope,
            status,
            canSave:
                (status === 'ready' || status === 'validation-error') &&
                active === null &&
                context.store.snapshot(context.handle) !== null,
            fields:
                status === 'stale' || status === 'disposed'
                    ? []
                    : context.fields,
            draft:
                status === 'stale' || status === 'disposed'
                    ? null
                    : context.store.snapshot(context.handle),
            validationErrors,
            concurrentEditErrorMessage,
            result,
            errorMessage,
            hasNewerEdits:
                hasNewerEdits ||
                (status === 'saved' &&
                    savedRevision !== null &&
                    context.store.revision(context.handle) !== savedRevision),
        });
    const emit = () => {
        emissionRevision += 1;
        pendingEmission = true;
        if (emitting) return;
        emitting = true;
        try {
            while (pendingEmission) {
                pendingEmission = false;
                const revision = emissionRevision;
                const emissionGeneration = generation;
                const owner = context;
                for (const listener of [...listeners]) {
                    if (!listeners.has(listener)) continue;
                    // Nested reset/write/destroy wins over this older emission.
                    if (
                        revision !== emissionRevision ||
                        emissionGeneration !== generation ||
                        owner !== context
                    )
                        break;
                    // This may queue a sanitized stale state, never recursively emit.
                    if (
                        !observeScope() &&
                        status !== 'stale' &&
                        status !== 'disposed'
                    )
                        break;
                    if (
                        revision !== emissionRevision ||
                        emissionGeneration !== generation
                    )
                        break;
                    try {
                        listener(state());
                    } catch {
                        // A renderer failure does not change the save or other subscribers.
                    }
                }
            }
        } finally {
            emitting = false;
        }
    };
    const current = () => {
        try {
            return (
                sameScope(readScope(context.getScope), context.scope) &&
                sameSession(context.client.getSession(), context.session)
            );
        } catch {
            return false;
        }
    };
    const scopeError = () =>
        new FormControllerError(
            'scope-changed',
            'The Form owner or context changed. Clear visitor drafts and reset the controller.'
        );
    const observeScope = () => {
        if (status === 'disposed' || status === 'stale') return false;
        if (current()) return true;
        const previous = active;
        generation += 1;
        active = null;
        // An already-expired handle cannot clear a replacement visitor's drafts.
        if (context.store.snapshot(context.handle) !== null)
            context.store.clear();
        status = 'stale';
        validationErrors = [];
        concurrentEditErrorMessage = null;
        result = null;
        errorMessage = null;
        hasNewerEdits = false;
        savedRevision = null;
        emit();
        previous?.abort(scopeError());
        return false;
    };
    const requireScope = () => {
        if (status === 'disposed') {
            throw new FormControllerError(
                'disposed',
                'The Form controller was disposed.'
            );
        }
        if (!observeScope()) throw scopeError();
    };

    return {
        getState: () => {
            observeScope();
            return state();
        },
        subscribe: (listener) => {
            observeScope();
            listeners.add(listener);
            listener(state());
            return () => listeners.delete(listener);
        },
        write: (fieldId, value) => {
            if (!observeScope()) return false;
            const field = context.fields.find(
                (entry) => entry.fieldId === fieldId
            );
            if (field === undefined || field.readOnly) return false;
            if (!context.store.write(context.handle, fieldId, value))
                return false;
            if (status === 'saved') hasNewerEdits = true;
            emit();
            return true;
        },
        save: async (requestOptions = {}) => {
            requireScope();
            if (active !== null) {
                throw new FormControllerError(
                    'save-in-progress',
                    'A Form save is already in progress.'
                );
            }
            if (
                status === 'saved' ||
                status === 'cancelled' ||
                status === 'transport-error'
            ) {
                throw new FormControllerError(
                    'reload-required',
                    'Load a fresh Form and reset before another save.'
                );
            }
            requestOptions.signal?.throwIfAborted();
            const draft = context.store.snapshot(context.handle);
            const draftRevision = context.store.revision(context.handle);
            if (draft === null || draftRevision === null) {
                throw new FormControllerError(
                    'draft-expired',
                    'This Form draft is no longer active.'
                );
            }
            const owner = context;
            const saveGeneration = generation;
            const input = createFormSaveInput({
                loaded: owner.loaded,
                draft,
                options: owner.saveOptions,
            });
            const controller = new AbortController();
            const externalSignal = requestOptions.signal;
            const forwardAbort = () => controller.abort(externalSignal?.reason);
            externalSignal?.addEventListener('abort', forwardAbort, {
                once: true,
            });
            active = controller;
            status = 'saving';
            errorMessage = null;
            emit();
            try {
                // A subscriber may have reset/cancelled during the loading emission.
                controller.signal.throwIfAborted();
                requireScope();
                const response = await owner.client.forms.save(input, {
                    signal: controller.signal,
                    session: { ...owner.session },
                });
                controller.signal.throwIfAborted();
                if (saveGeneration !== generation || owner !== context)
                    throw scopeError();
                requireScope();
                if (owner.store.snapshot(owner.handle) === null) {
                    throw new FormControllerError(
                        'draft-expired',
                        'This Form draft is no longer active.'
                    );
                }
                const normalized = normalizeFormSaveResult(
                    response,
                    owner.loaded
                );
                controller.signal.throwIfAborted();
                if (saveGeneration !== generation || owner !== context)
                    throw scopeError();
                requireScope();
                result = normalized;
                validationErrors = normalized.validationErrors;
                concurrentEditErrorMessage =
                    normalized.concurrentEditErrorMessage;
                if (normalized.type === 'saved') {
                    savedRevision = draftRevision;
                    hasNewerEdits = !owner.store.markSaved(
                        owner.handle,
                        draftRevision
                    );
                    status = 'saved';
                } else {
                    hasNewerEdits = false;
                    status = 'validation-error';
                }
                active = null;
                emit();
                if (saveGeneration !== generation || owner !== context)
                    throw scopeError();
                requireScope();
                controller.signal.throwIfAborted();
                return structuredClone(normalized);
            } catch (error) {
                if (
                    saveGeneration === generation &&
                    owner === context &&
                    active === controller
                ) {
                    if (!observeScope()) throw scopeError();
                    status = controller.signal.aborted
                        ? 'cancelled'
                        : 'transport-error';
                    errorMessage =
                        error instanceof Error
                            ? error.message
                            : 'The Form save failed.';
                    emit();
                }
                throw error;
            } finally {
                externalSignal?.removeEventListener('abort', forwardAbort);
                if (active === controller) active = null;
            }
        },
        reset: (nextOptions) => {
            if (status === 'disposed') {
                throw new FormControllerError(
                    'disposed',
                    'The Form controller was disposed.'
                );
            }
            const prepared = prepare(nextOptions);
            const scopeChanged =
                !sameScope(context.scope, prepared.scope) ||
                context.client !== prepared.client ||
                !sameSession(context.session, prepared.session) ||
                context.contextKey !== prepared.contextKey;
            const previous = active;
            // Reset is an explicit application action, never an automatic save response.
            if (scopeChanged && context.store.snapshot(context.handle) !== null)
                context.store.clear();
            else if (
                !scopeChanged &&
                status === 'saved' &&
                !state().hasNewerEdits
            )
                context.store.discard(context.handle);
            generation += 1;
            active = null;
            context = openContext(prepared);
            status = 'ready';
            validationErrors = formValidationMessages(
                context.loaded.payload.formErrors,
                [],
                context.loaded
            );
            concurrentEditErrorMessage = null;
            result = null;
            errorMessage = null;
            hasNewerEdits = false;
            savedRevision = null;
            emit();
            previous?.abort(scopeError());
        },
        cancel: () => {
            if (active === null) return;
            const previous = active;
            generation += 1;
            active = null;
            status = 'cancelled';
            errorMessage =
                'Load a fresh Form before another save; cancellation cannot undo a server write.';
            emit();
            previous.abort(
                new FormControllerError(
                    'cancelled',
                    'The Form save was cancelled; its server outcome may be unknown.'
                )
            );
        },
        destroy: () => {
            if (status === 'disposed') return;
            const previous = active;
            generation += 1;
            active = null;
            status = 'disposed';
            validationErrors = [];
            concurrentEditErrorMessage = null;
            result = null;
            errorMessage = null;
            hasNewerEdits = false;
            savedRevision = null;
            emit();
            listeners.clear();
            previous?.abort(
                new FormControllerError(
                    'disposed',
                    'The Form controller was disposed.'
                )
            );
        },
    };
};
