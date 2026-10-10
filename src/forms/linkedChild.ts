import type {
    AirtableValue,
    FormLoadedResult,
    MiniExtensionsClient,
    LoadExtensionInput,
} from '../runtime/types.js';
import type { FormFieldBindings } from './bindings.js';
import type { FormDraftHandle } from './drafts.js';
import type { FormOwnerScope, FormSaveLifecycle } from './controller.js';
import type { NormalizedFormSaveResult, FormSaveOptions } from './helpers.js';
import { createFormPageOwner, type FormPageOwner } from './pages.js';
import { withFormSaveAdmission } from './saveAdmission.js';
import {
    RecoveryJournal,
    type RecoveryAttempt,
    type RecoveryScope,
} from './recovery.js';
import { normalizeFormLeaseLoaded } from '../ui/formLease.js';
import {
    resolveLinkedChildCreatePolicy,
    reconcileLinkedChildCreate,
    type LinkedChildCreatePolicy,
} from './linkedChildPolicy.js';

export type FormLinkedChildRecovery = {
    journal: RecoveryJournal;
    loadVersion: number;
};
export type FormLinkedChildSnapshot = {
    revision: number;
    phase:
        | 'idle'
        | 'loading'
        | 'ready'
        | 'saving'
        | 'saved'
        | 'error'
        | 'unknown'
        | 'closed'
        | 'retired'
        | 'unavailable';
    canCreate: boolean;
    /** Borrowed by rendering; unmount must not destroy these owned resources. */
    child: FormFieldBindings | null;
    pages: FormPageOwner | null;
    completion: 'none' | 'reconciled' | 'saved-not-reconciled';
    error: string | null;
};
export type FormLinkedChildOwner = {
    getSnapshot(): FormLinkedChildSnapshot;
    subscribe(
        listener: (snapshot: FormLinkedChildSnapshot) => void
    ): () => void;
    /** Explicit configured child load; never reads because a renderer mounted. */
    openCreate(options?: {
        signal?: AbortSignal;
        clientTimeZone?: string;
    }): Promise<boolean>;
    /** Captured rendered revision; existing page validation and Form Save remain authoritative. */
    save(
        renderedRevision: number,
        options?: { signal?: AbortSignal }
    ): Promise<NormalizedFormSaveResult>;
    /** Close cancels this intent only. A dispatched outcome is never replayed. */
    close(): void;
};

type InternalOptions = FormLinkedChildRecovery & {
    form: FormFieldBindings;
    fieldId: string;
    parentHandle: FormDraftHandle;
    client: MiniExtensionsClient;
    getClient(): MiniExtensionsClient;
    getScope(): FormOwnerScope;
    configurationRevision(): string | number;
    parentCurrent(): boolean;
    canAccept(): boolean;
    createChild(options: {
        loaded: FormLoadedResult;
        saveOptions: FormSaveOptions;
        isCurrent(): boolean;
    }): FormFieldBindings;
    /** Guarded native write and private receipt bookkeeping before publication. */
    commit(
        value: AirtableValue,
        expectedDraftRevision: number,
        afterCommit: () => void,
        isCurrent: () => boolean,
        unchanged?: boolean
    ): boolean;
    prepareCreated(
        result: Extract<NormalizedFormSaveResult, { type: 'saved' }>
    ): (() => void) | null;
    changed(): void;
};
const parentIds = new WeakMap<FormDraftHandle, number>();
let parentSequence = 0;
const parentIdentity = (handle: FormDraftHandle) => {
    let id = parentIds.get(handle);
    if (id === undefined) parentIds.set(handle, (id = ++parentSequence));
    return id;
};
const sameSession = (
    a: ReturnType<MiniExtensionsClient['getSession']>,
    b: ReturnType<MiniExtensionsClient['getSession']>
) =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && a[key] === b[key]);

// This coordinator has no child cascade owner. Never submit an invented empty
// filtering map for configured child dependencies, including hidden/read-only fields.
const hasUnsupportedChildLinkedFilters = (loaded: FormLoadedResult) =>
    Object.values(loaded.payload.fieldIdsToSchemas).some((schema) => {
        if (schema.fieldType !== 'multipleRecordLinks') return false;
        const config = schema.miniExtConfig;
        if (config == null) return false;
        if (typeof config !== 'object' || Array.isArray(config)) return true;
        const toggle =
            'dynamicFilteringToggle' in config
                ? config.dynamicFilteringToggle
                : undefined;
        const filters =
            'conditionalLinkedRecordFilterFields' in config
                ? config.conditionalLinkedRecordFilterFields
                : undefined;
        return (
            toggle === true ||
            (toggle != null && typeof toggle !== 'boolean') ||
            (filters != null &&
                (!Array.isArray(filters) || filters.length !== 0))
        );
    });

/** Internal configured-create coordinator. There is no caller receipt or exemption channel. */
export function createFormLinkedChildOwner(
    options: InternalOptions
): FormLinkedChildOwner & {
    blocksForm(): boolean;
    dispose(): void;
} {
    if (!Number.isSafeInteger(options.loadVersion) || options.loadVersion < 0)
        throw new TypeError('A nonnegative accepted load version is required.');
    const parent = options.form.getLoaded();
    const initial = options.form.controller.getState();
    const config = options.configurationRevision();
    const parentKey = JSON.stringify(normalizeFormLeaseLoaded(parent));
    const session = { ...options.client.getSession() };
    const physical =
        parent.payload.fieldIdsToSchemas[options.fieldId]?.airtableField.config;
    const scope: RecoveryScope = {
        owner: JSON.stringify([
            'form-child',
            parentIdentity(options.parentHandle),
            initial.ownerScope.ownerId,
        ]),
        parentFieldId: options.fieldId,
        tableId:
            physical?.type === 'multipleRecordLinks'
                ? physical.options.linkedTableId
                : null,
        childExtensionId: '',
        context: 'modal',
    };
    let disposed = false,
        parentRetired = false,
        generation = 0,
        revision = 0;
    let phase: FormLinkedChildSnapshot['phase'] = 'idle';
    let completion: FormLinkedChildSnapshot['completion'] = 'none';
    let error: string | null = null;
    let activeLoad: AbortController | null = null;
    let saving = false;
    const ownedAttempts = new Set<RecoveryAttempt>();
    type Intent = {
        generation: number;
        plan: LinkedChildCreatePolicy;
        loaded: FormLoadedResult;
        fields: FormFieldBindings;
        pages: FormPageOwner | null;
        current: boolean;
        attempt: RecoveryAttempt | null;
        receipt: Extract<NormalizedFormSaveResult, { type: 'saved' }> | null;
        reconciled: boolean;
        saveOptions: FormSaveOptions;
        stops: (() => void)[];
        released: boolean;
    };
    let intent: Intent | null = null;
    const listeners = new Set<(snapshot: FormLinkedChildSnapshot) => void>();
    let notifying = false,
        notifyPending = false;
    const retirePresentation = () => {
        parentRetired = true;
    };
    const parentCurrent = () => {
        if (disposed || parentRetired) return false;
        try {
            const before = options.form.controller.getState();
            const live = options.parentCurrent();
            const after = options.form.controller.getState();
            if (
                !live ||
                before.epoch !== initial.epoch ||
                after.epoch !== initial.epoch ||
                before.contextRevision !== initial.contextRevision ||
                after.contextRevision !== initial.contextRevision ||
                !after.draft ||
                ['stale', 'disposed'].includes(after.status) ||
                options.configurationRevision() !== config ||
                options.getClient() !== options.client ||
                !sameSession(session, options.client.getSession()) ||
                JSON.stringify(
                    normalizeFormLeaseLoaded(options.form.getLoaded())
                ) !== parentKey ||
                disposed ||
                parentRetired
            )
                retirePresentation();
        } catch {
            retirePresentation();
        }
        return !parentRetired && !disposed;
    };
    const ownsIntent = (candidate: Intent) =>
        candidate.current &&
        candidate === intent &&
        candidate.generation === generation;
    const childCurrent = (candidate: Intent) =>
        ownsIntent(candidate) &&
        options.getClient() === options.client &&
        sameSession(session, options.client.getSession()) &&
        ownsIntent(candidate);
    const policy = () => {
        try {
            const data = options.form.controller.getState().draft?.data;
            if (!data) return null;
            return resolveLinkedChildCreatePolicy({
                loaded: parent,
                fieldId: options.fieldId,
                data,
                linkedRecords: options.form
                    .linkedRecords(options.fieldId)
                    .getSnapshot(),
            });
        } catch {
            return null;
        }
    };
    const blocking = () => options.journal.blocking(scope, null) !== undefined;
    const canCreate = () => {
        try {
            const admissionGeneration = generation;
            if (
                parent.payload.hasParentExtension ||
                !parentCurrent() ||
                activeLoad ||
                saving ||
                blocking() ||
                (intent && !['saved', 'closed', 'error'].includes(phase)) ||
                completion === 'saved-not-reconciled' ||
                !options.canAccept()
            )
                return false;
            const p = policy();
            return (
                p?.type === 'available' &&
                parentCurrent() &&
                admissionGeneration === generation &&
                !activeLoad &&
                !saving &&
                !disposed &&
                !parentRetired &&
                (!intent || ['saved', 'closed', 'error'].includes(phase))
            );
        } catch {
            // Eligibility callbacks are application code. A refusal must not leak
            // the constructor's subscription or launch a load.
            return false;
        }
    };
    const snapshot = (): FormLinkedChildSnapshot => {
        const live = parentCurrent();
        const p = live ? policy() : null;
        const unavailable =
            live &&
            !intent &&
            !activeLoad &&
            !saving &&
            (parent.payload.hasParentExtension ||
                p?.type === 'unavailable' ||
                !p);
        return {
            revision,
            phase: !live ? 'retired' : unavailable ? 'unavailable' : phase,
            canCreate: canCreate(),
            child: live && intent?.current ? intent.fields : null,
            pages: live && intent?.current ? intent.pages : null,
            completion,
            error: unavailable
                ? 'This configured child creation is unsupported or unavailable.'
                : error,
        };
    };
    const emit = () => {
        revision++;
        notifyPending = true;
        if (notifying) return;
        notifying = true;
        try {
            // Bound application reentry; mutation owners are independent of delivery.
            for (let rounds = 0; notifyPending && rounds < 8; rounds++) {
                notifyPending = false;
                const value = snapshot();
                for (const listener of [...listeners]) {
                    if (!listeners.has(listener)) continue;
                    try {
                        listener({ ...value });
                    } catch {
                        /* Rendering does not own the operation. */
                    }
                }
            }
        } finally {
            notifying = false;
        }
    };
    const release = (old: Intent) => {
        if (old.released) return;
        old.released = true;
        old.current = false;
        try {
            for (const stop of old.stops.splice(0)) stop();
        } finally {
            try {
                old.pages?.dispose();
            } finally {
                old.fields.destroy();
            }
        }
    };
    const requireParent = (plan: LinkedChildCreatePolicy) => {
        if (!parentCurrent() || !options.canAccept())
            throw Error('This parent Form is no longer available.');
        const fresh = policy();
        if (
            !fresh ||
            fresh.type !== 'available' ||
            fresh.childExtensionId !== plan.childExtensionId ||
            fresh.linkedTableId !== plan.linkedTableId ||
            !parentCurrent()
        )
            throw Error(
                'This configured child creation is no longer available.'
            );
    };
    let stopParent = () => {};
    const owner: ReturnType<typeof createFormLinkedChildOwner> = {
        getSnapshot: snapshot,
        subscribe(listener) {
            listeners.add(listener);
            try {
                listener(snapshot());
            } catch (failure) {
                listeners.delete(listener);
                throw failure;
            }
            return () => listeners.delete(listener);
        },
        async openCreate(request = {}) {
            const admissionGeneration = generation;
            if (!canCreate()) return false;
            const plan = policy();
            if (
                !plan ||
                plan.type !== 'available' ||
                !parentCurrent() ||
                admissionGeneration !== generation ||
                activeLoad ||
                saving ||
                disposed ||
                parentRetired
            )
                return false;
            const ticket = ++generation;
            const abort = new AbortController();
            const forward = () => abort.abort(request.signal?.reason);
            request.signal?.addEventListener('abort', forward, { once: true });
            if (request.signal?.aborted) forward();
            const old = intent;
            intent = null;
            activeLoad = abort;
            if (old) release(old);
            if (activeLoad !== abort || generation !== ticket) return false;
            phase = 'loading';
            completion = 'none';
            error = null;
            scope.tableId = plan.linkedTableId;
            scope.childExtensionId = plan.childExtensionId;
            emit();
            const ownsLoad = () =>
                activeLoad === abort &&
                generation === ticket &&
                !abort.signal.aborted &&
                parentCurrent();
            try {
                if (!ownsLoad()) return false;
                const input: LoadExtensionInput = {
                    childExtensionAccessData: {
                        parentExtensionAccessToken:
                            parent.payload.extensionAccessToken,
                        fieldIdUsedToAccessExtension: options.fieldId,
                    },
                    childExtensionInfo: {
                        childExtensionId: plan.childExtensionId,
                        accessType: { type: 'create' },
                    },
                    context: {
                        type: 'modal',
                        linkedTableIdOfLinkedRecordField: plan.linkedTableId,
                        prefillDataForLinkedRecordsForm: structuredClone(
                            plan.prefill
                        ),
                    },
                    query: Object.fromEntries(
                        new URLSearchParams(
                            plan.prefill.prefillQueryForChildExtension ?? ''
                        )
                    ),
                    ...(request.clientTimeZone !== undefined
                        ? { clientTimeZone: request.clientTimeZone }
                        : {}),
                };
                const response = await options.client.loadExtension(input, {
                    signal: abort.signal,
                    session: { ...session },
                });
                if (!ownsLoad()) return false;
                if (
                    response.extensionScreen !== 'form_loaded' ||
                    response.extensionId !== plan.childExtensionId ||
                    response.workspaceId !== parent.workspaceId ||
                    response.payload.baseId !== parent.payload.baseId ||
                    response.payload.hasParentExtension !== true ||
                    response.payload.formRecord.type !== 'create' ||
                    response.payload.publicFields.state.tableId !==
                        plan.linkedTableId ||
                    response.payload.publicFields.state
                        .enableFormComputeMode === true ||
                    (response.payload.publicFields.state.multiPageFormMode !=
                        null &&
                        response.payload.publicFields.state
                            .multiPageFormMode !== 'one-page') ||
                    response.payload.publicFields.state
                        .promptUserBeforeSubmission === true ||
                    response.payload.publicFields.state.enableCaptcha ===
                        true ||
                    hasUnsupportedChildLinkedFilters(response)
                )
                    throw Error(
                        'The configured child Form is unavailable in this flow.'
                    );
                const loaded = structuredClone(response);
                const saveOptions: FormSaveOptions = {
                    captchaVal: null,
                    isComputeMode: false,
                    searchQuery: structuredClone(input.query ?? {}),
                    context: {
                        type: 'modal',
                        prefillData: structuredClone(plan.prefill),
                    },
                    conditionalLinkedRecordFieldIdsToFilteringValues: {},
                };
                let candidate: Intent | null = null;
                let initializing = true;
                const fields = options.createChild({
                    loaded,
                    saveOptions,
                    isCurrent: () =>
                        initializing
                            ? ownsLoad()
                            : candidate !== null && childCurrent(candidate),
                });
                if (!ownsLoad()) {
                    initializing = false;
                    fields.destroy();
                    return false;
                }
                let pages: FormPageOwner | null = null;
                try {
                    candidate = {
                        generation: ticket,
                        plan,
                        loaded,
                        fields,
                        pages: null,
                        current: true,
                        attempt: null,
                        receipt: null,
                        reconciled: false,
                        saveOptions,
                        stops: [],
                        released: false,
                    };
                    intent = candidate;
                    initializing = false;
                    pages = createFormPageOwner({
                        fields,
                        isCurrent: () => childCurrent(candidate!),
                        configurationRevision: () => 0,
                    });
                    candidate.pages = pages;
                    if (pages.getSnapshot().status === 'blocked' || !ownsLoad())
                        throw Error(
                            'This child Form configuration is unsupported.'
                        );
                    activeLoad = null;
                    const stop = fields.controller.subscribe(() => {
                        if (intent === candidate && !saving) emit();
                    });
                    if (!ownsIntent(candidate) || !parentCurrent()) {
                        stop();
                        release(candidate);
                        return false;
                    }
                    candidate.stops.push(stop);
                    phase = 'ready';
                    emit();
                    return (
                        intent === candidate &&
                        candidate.current &&
                        parentCurrent()
                    );
                } catch (failure) {
                    if (candidate) {
                        candidate.current = false;
                        for (const stop of candidate.stops) stop();
                    }
                    pages?.dispose();
                    fields.destroy();
                    if (intent === candidate) intent = null;
                    throw failure;
                }
            } catch {
                if (activeLoad === abort && generation === ticket) {
                    phase = 'error';
                    error =
                        'Child Form could not be loaded. Choose Create to retry explicitly.';
                }
                return false;
            } finally {
                request.signal?.removeEventListener('abort', forward);
                if (activeLoad === abort) {
                    activeLoad = null;
                    emit();
                }
            }
        },
        async save(renderedRevision, request = {}) {
            const candidate = intent;
            if (
                !candidate ||
                !candidate.current ||
                !candidate.pages ||
                revision !== renderedRevision ||
                saving ||
                !['ready', 'error'].includes(phase) ||
                blocking()
            )
                throw Error('This child submission is unavailable.');
            requireParent(candidate.plan);
            const page = candidate.pages.getSnapshot();
            if (!page.canSubmit)
                throw Error('Complete the child Form before submitting.');
            if (revision !== renderedRevision || !childCurrent(candidate))
                throw Error('This child submission is stale.');
            const attemptScope = { ...scope };
            const lifecycle: FormSaveLifecycle = withFormSaveAdmission(
                {
                    dispatch(input, draftRevision) {
                        if (
                            !childCurrent(candidate) ||
                            input.extensionAccessToken !==
                                candidate.loaded.payload.extensionAccessToken ||
                            input.formRecord.type !== 'create' ||
                            input.context.type !== 'modal' ||
                            input.isComputeMode
                        )
                            throw Error('The child creation intent is stale.');
                        const attempt = options.journal.begin(
                            attemptScope,
                            null,
                            'save',
                            options.loadVersion,
                            options.fieldId
                        );
                        candidate.attempt = attempt;
                        ownedAttempts.add(attempt);
                        return {
                            accepted(result) {
                                if (result.type === 'saved') {
                                    if (
                                        result.raw.tableId !==
                                            candidate.plan.linkedTableId ||
                                        result.raw.context.type !== 'modal'
                                    )
                                        throw Error(
                                            'The child creation response does not match its intent.'
                                        );
                                    candidate.receipt = structuredClone(result);
                                }
                                options.journal.accepted(
                                    attempt,
                                    result.type === 'saved'
                                        ? 'saved'
                                        : 'validation-error'
                                );
                            },
                            finish(disposition) {
                                if (disposition === 'not-dispatched')
                                    options.journal.notDispatched(attempt);
                                else options.journal.finishFlight(attempt);
                            },
                        };
                    },
                },
                () => {
                    requireParent(candidate.plan);
                }
            );
            saving = true;
            phase = 'saving';
            error = null;
            emit();
            let result: NormalizedFormSaveResult | null = null;
            let failure: unknown;
            try {
                if (intent !== candidate || !candidate.current)
                    throw Error('This child submission was closed.');
                result = await candidate.pages.submit(page.revision, {
                    signal: request.signal,
                    lifecycle,
                    isCurrent: () => childCurrent(candidate),
                });
            } catch (caught) {
                failure = caught;
            } finally {
                saving = false;
            }
            try {
                const accepted = candidate.receipt;
                if (accepted) {
                    completion = 'saved-not-reconciled';
                    if (
                        candidate.current &&
                        intent === candidate &&
                        candidate.generation === generation &&
                        !candidate.reconciled &&
                        parentCurrent() &&
                        options.canAccept()
                    ) {
                        const state = options.form.controller.getState();
                        const reconciliation =
                            state.draft &&
                            reconcileLinkedChildCreate({
                                parent,
                                fieldId: options.fieldId,
                                data: state.draft.data,
                                child: candidate.loaded,
                                savedRecord: accepted.raw.record,
                            });
                        if (
                            reconciliation &&
                            reconciliation.type === 'available'
                        ) {
                            const fresh = policy();
                            // Capacity changes cannot overwrite newer parent edits. A no-op/remove needs no spare slot.
                            const adding = reconciliation.exemptCreatedRecord;
                            if (
                                !adding ||
                                (fresh?.type === 'available' &&
                                    fresh.childExtensionId ===
                                        candidate.plan.childExtensionId &&
                                    fresh.linkedTableId ===
                                        candidate.plan.linkedTableId)
                            ) {
                                const install = adding
                                    ? options.prepareCreated(accepted)
                                    : () => {};
                                const afterCommit = () => {
                                    install?.();
                                    candidate.reconciled = true;
                                    completion = 'reconciled';
                                };
                                if (!reconciliation.changed) {
                                    if (
                                        ownsIntent(candidate) &&
                                        parentCurrent() &&
                                        options.canAccept() &&
                                        ownsIntent(candidate)
                                    ) {
                                        // No-op reconciliation still requires the final
                                        // native lease: callbacks may have edited it.
                                        try {
                                            options.commit(
                                                reconciliation.nativeIds,
                                                state.draftRevision!,
                                                afterCommit,
                                                () =>
                                                    ownsIntent(candidate) &&
                                                    !disposed &&
                                                    !parentRetired,
                                                true
                                            );
                                        } catch {
                                            /* The accepted receipt stays known when admission fails. */
                                        }
                                    }
                                } else if (
                                    parentCurrent() &&
                                    options.canAccept()
                                ) {
                                    try {
                                        options.commit(
                                            reconciliation.nativeIds,
                                            state.draftRevision!,
                                            afterCommit,
                                            () =>
                                                ownsIntent(candidate) &&
                                                !disposed &&
                                                !parentRetired
                                        );
                                    } catch {
                                        /* A committed native write must never be replayed after observer failure. */
                                    }
                                }
                            }
                        }
                    }
                    if (intent === candidate && candidate.current) {
                        phase = 'saved';
                        emit();
                    }
                    options.changed();
                    return structuredClone(accepted);
                }
                if (intent === candidate) {
                    if (candidate.attempt?.outcome === 'unknown') {
                        phase = 'unknown';
                        error =
                            'The child Save outcome is unknown. Inspect it before another submission.';
                    } else {
                        phase = result?.type === 'error' ? 'ready' : 'error';
                        error =
                            result?.type === 'error'
                                ? 'Review the returned child validation errors.'
                                : 'Child Save was not accepted. Retry only after checking its state.';
                    }
                    emit();
                }
                options.changed();
                if (result) return structuredClone(result);
                throw failure ?? Error('Child Save was not accepted.');
            } finally {
                // A parent-only retirement keeps the receipt lease until settlement,
                // then releases its child subscriptions and native owner exactly once.
                if (disposed || parentRetired) release(candidate);
            }
        },
        close() {
            if (disposed) return;
            const old = intent;
            const ticket = ++generation;
            const load = activeLoad;
            activeLoad = null;
            intent = null;
            phase = blocking() ? 'unknown' : 'closed';
            if (old) {
                old.current = false;
                old.fields.controller.cancel();
                release(old);
            }
            load?.abort();
            if (
                generation === ticket &&
                intent === null &&
                activeLoad === null
            ) {
                phase = blocking() ? 'unknown' : 'closed';
                emit();
                options.changed();
            }
        },
        blocksForm: () =>
            activeLoad !== null ||
            saving ||
            (!disposed &&
                intent !== null &&
                intent.current &&
                ['ready', 'error'].includes(phase)) ||
            [...ownedAttempts].some(
                (attempt) =>
                    attempt.outcome === 'unknown' &&
                    attempt.acknowledgment === 'none'
            ) ||
            (!disposed && completion === 'saved-not-reconciled'),
        dispose() {
            if (disposed) return;
            disposed = true;
            parentRetired = true;
            stopParent();
            const load = activeLoad;
            activeLoad = null;
            load?.abort();
            // Parent-only retirement must not erase an in-flight child receipt.
            if (intent && !saving) release(intent);
            emit();
            listeners.clear();
        },
    };
    try {
        stopParent = options.form.controller.subscribe(() => {
            // Native edits can change capacity and conditional visibility without
            // replacing the Form owner. Publish their new action revision too.
            emit();
        });
    } catch (failure) {
        stopParent();
        throw failure;
    }
    return owner;
}
