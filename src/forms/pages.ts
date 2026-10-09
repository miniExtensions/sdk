import type { FormFieldBindings, FormFieldSnapshot } from './bindings.js';
import type { FormControllerSaveOptions } from './controller.js';
import type { FormDraftSnapshot } from './drafts.js';
import type { AirtableValue, FormLoadedResult } from '../runtime/index.js';
import { validatePageField, type FormPageProblem } from './pageValidation.js';
import { normalizeFormLeaseLoaded } from '../ui/formLease.js';
export type FormPageDescriptor = {
    title: string | null;
    description: string | null;
    fieldIds: string[];
    hidden: boolean;
};
export type FormPageSnapshot = {
    revision: number;
    status: 'ready' | 'blocked' | 'all-hidden' | 'retired';
    pages: FormPageDescriptor[];
    activePageIndex: number;
    currentFieldIds: string[];
    canBack: boolean;
    canNext: boolean;
    canSubmit: boolean;
    /** Final Review may open with ordinary validation errors. */
    canReview: boolean;
    reviewing: boolean;
    problems: FormPageProblem[];
};
export type FormPageAction =
    | { accepted: true }
    | {
          accepted: false;
          reason:
              | 'retired'
              | 'stale-revision'
              | 'blocked'
              | 'validation'
              | 'no-page'
              | 'busy';
      };
export type FormPageReviewRequest = {
    revision: number;
    /** Detached presentation copies; the existing native draft remains Save authority. */
    loaded: FormLoadedResult;
    draft: Readonly<FormDraftSnapshot<AirtableValue>>;
    signal: AbortSignal;
    isCurrent(): boolean;
};
export type FormPageReviewDecision =
    | { type: 'edit' }
    | { type: 'confirm'; isCurrent(): boolean };
export type FormPageErrorReason =
    | Exclude<FormPageAction, { accepted: true }>['reason']
    | 'review-cancelled';
export type FormPageOwnerOptions = {
    fields: FormFieldBindings;
    /** Exact accepted owner/session/token/parent lease. Observed failure retires permanently. */
    isCurrent(): boolean;
    /** Monotonic accepted configuration epoch; do not use a reversible value hash. */
    configurationRevision(): number;
    /** Explicit final Review only. No adapter preserves configured-Review refusal. */
    review?(request: FormPageReviewRequest): Promise<FormPageReviewDecision>;
};
export type FormPageOwner = {
    getSnapshot(): FormPageSnapshot;
    subscribe(listener: (snapshot: FormPageSnapshot) => void): () => void;
    back(expectedRevision: number): FormPageAction;
    next(expectedRevision: number): FormPageAction;
    submit(
        expectedRevision: number,
        options?: FormControllerSaveOptions
    ): ReturnType<FormFieldBindings['save']>;
    /** Retires only this page owner; never destroys shared bindings or draft. */
    dispose(): void;
};
export class FormPageError extends Error {
    constructor(readonly reason: FormPageErrorReason) {
        super(`Form page action refused: ${reason}.`);
        this.name = 'FormPageError';
    }
}
const lastVisible = (
    pages: readonly FormPageDescriptor[],
    before = pages.length
): number => {
    for (let i = Math.min(before - 1, pages.length - 1); i >= 0; i--)
        if (!pages[i]!.hidden) return i;
    return -1;
};
export function createFormPageOwner(
    options: FormPageOwnerOptions
): FormPageOwner {
    const { fields } = options;
    const loaded = fields.getLoaded();
    const initial = fields.controller.getState();
    const configuration = options.configurationRevision();
    const loadedKey = JSON.stringify(normalizeFormLeaseLoaded(loaded));
    let retired = false,
        disposed = false,
        revision = 0,
        active = 0,
        emitting = false,
        syncing = false,
        notificationPending = false;
    let validatedDraftRevision: number | null = null;
    let inputRevision = 0,
        navigationRevision = 0;
    let validatedInputRevision: number | null = null;
    let validatedNavigationRevision: number | null = null;
    let validationStable = true;
    let fingerprint = '';
    let backBlocked = false;
    let intent: {
        abort: AbortController;
        reviewing: boolean;
        draftRevision: number;
        inputRevision: number;
        navigationRevision: number;
        pageIndex: number;
    } | null = null;
    let state: FormPageSnapshot = {
        revision,
        status: 'blocked',
        pages: [],
        activePageIndex: 0,
        currentFieldIds: [],
        canBack: false,
        canNext: false,
        canSubmit: false,
        canReview: false,
        reviewing: false,
        problems: [],
    };
    // Delivery is independent of reads: getSnapshot may synchronize first.
    const listeners = new Map<(s: FormPageSnapshot) => void, number>();
    const stops: (() => void)[] = [];
    const current = () => {
        if (retired || disposed) return false;
        try {
            const before = fields.controller.getState();
            const epoch = options.configurationRevision();
            const live = options.isCurrent();
            const after = fields.controller.getState();
            if (
                !live ||
                !Number.isSafeInteger(epoch) ||
                epoch < 0 ||
                epoch !== configuration ||
                options.configurationRevision() !== configuration ||
                before.epoch !== initial.epoch ||
                after.epoch !== initial.epoch ||
                after.contextRevision !== initial.contextRevision ||
                JSON.stringify(after.ownerScope) !==
                    JSON.stringify(initial.ownerScope) ||
                JSON.stringify(normalizeFormLeaseLoaded(fields.getLoaded())) !==
                    loadedKey
            )
                retired = true;
        } catch {
            retired = true;
        }
        if (retired || disposed) intent?.abort.abort();
        return !retired && !disposed;
    };
    const sync = (retry = true) => {
        if (syncing) return;
        syncing = true;
        validatedDraftRevision = null;
        validatedInputRevision = null;
        validatedNavigationRevision = null;
        let needsRetry = false;
        try {
            const problems: FormPageProblem[] = [];
            const snapshots = new Map<string, FormFieldSnapshot>();
            const live = current();
            const control = fields.controller.getState();
            const inputTicket = inputRevision;
            const config = loaded.payload.publicFields.state;
            const validConfig =
                config != null &&
                typeof config === 'object' &&
                !Array.isArray(config);
            const cfg: Record<string, unknown> = validConfig ? config : {};
            if (!validConfig)
                problems.push({ fieldId: null, code: 'invalid-metadata' });
            if (!live) retired = true;
            if (
                cfg.enableFormComputeMode === true ||
                cfg.autoSubmitAfterPrefill === true ||
                (cfg.promptUserBeforeSubmission === true &&
                    typeof options.review !== 'function')
            )
                problems.push({
                    fieldId: null,
                    code: 'unsupported-configuration',
                });
            const structural: FormPageDescriptor[] = [];
            const leading: FormPageDescriptor = {
                title: null,
                description: null,
                fieldIds: [],
                hidden: true,
            };
            let page = leading;
            const ids = loaded.payload.fieldIdsInForm;
            const seen = new Set<string>();
            for (const id of ids) {
                if (typeof id !== 'string' || seen.has(id)) {
                    problems.push({
                        fieldId: null,
                        code: 'invalid-metadata',
                    });
                    continue;
                }
                seen.add(id);
                const schema = loaded.payload.fieldIdsToSchemas[id];
                if (!schema) {
                    problems.push({
                        fieldId: id,
                        code: 'invalid-metadata',
                    });
                    continue;
                }
                const mini: Record<string, unknown> =
                    schema.miniExtConfig ?? {};
                if (
                    (mini.enableSectionHeader != null &&
                        typeof mini.enableSectionHeader !== 'boolean') ||
                    (mini.headerSectionTitle != null &&
                        typeof mini.headerSectionTitle !== 'string') ||
                    (mini.headerSectionDescription != null &&
                        typeof mini.headerSectionDescription !== 'string')
                )
                    problems.push({
                        fieldId: id,
                        code: 'invalid-metadata',
                    });
                const title =
                    mini.enableSectionHeader !== false &&
                    typeof mini.headerSectionTitle === 'string' &&
                    mini.headerSectionTitle.trim() !== ''
                        ? mini.headerSectionTitle
                        : null;
                if (title != null) {
                    if (structural.length === 0 && leading.fieldIds.length > 0)
                        structural.push(leading);
                    page = {
                        title,
                        description:
                            typeof mini.headerSectionDescription === 'string'
                                ? mini.headerSectionDescription
                                : null,
                        fieldIds: [],
                        hidden: true,
                    };
                    structural.push(page);
                }
                page.fieldIds.push(id);
                if (live) {
                    const snapshot = fields.field(id).getSnapshot();
                    snapshots.set(id, snapshot);
                    if (snapshot.visibility.type !== 'hidden')
                        page.hidden = false;
                    if (snapshot.visibility.type === 'blocked')
                        problems.push({
                            fieldId: id,
                            code: 'blocked-visibility',
                        });
                }
            }
            if (structural.length === 0 && leading.fieldIds.length > 0)
                structural.push(leading);
            const pages =
                cfg.multiPageFormMode === 'multi-page' && structural.length > 1
                    ? structural
                    : ids.length === 0
                      ? []
                      : [
                            {
                                title: null,
                                description: null,
                                fieldIds: [...ids],
                                hidden: [...snapshots.values()].every(
                                    (s) => s.visibility.type === 'hidden'
                                ),
                            },
                        ];
            if (
                cfg.multiPageFormMode != null &&
                cfg.multiPageFormMode !== 'one-page' &&
                cfg.multiPageFormMode !== 'multi-page'
            )
                problems.push({
                    fieldId: null,
                    code: 'unsupported-configuration',
                });
            const first = pages.findIndex((p) => !p.hidden);
            if (active >= pages.length || pages[active]?.hidden) {
                const normalized = first < 0 ? 0 : first;
                if (active !== normalized) navigationRevision++;
                active = normalized;
            }
            const navigationTicket = navigationRevision;
            const currentIds = pages[active]?.fieldIds ?? [];
            const last = lastVisible(pages);
            // Next follows the current page. Final Submit rechecks the complete
            // native answer using each rule's own hidden/read-only exceptions.
            for (const [id, snapshot] of snapshots) {
                if (!snapshot.field) {
                    problems.push({
                        fieldId: id,
                        code: 'invalid-metadata',
                    });
                    continue;
                }
                const issue = validatePageField(
                    snapshot.field,
                    control.draft?.data[id],
                    loaded.payload.formRecord.data[id],
                    snapshot.visibility.type === 'hidden'
                );
                if (issue && (active === last || currentIds.includes(id)))
                    problems.push(issue);
                if (
                    (active === last || currentIds.includes(id)) &&
                    snapshot.visibility.type === 'visible' &&
                    !snapshot.readOnly &&
                    (snapshot.scalar?.valid === false ||
                        snapshot.date?.error != null)
                )
                    problems.push({ fieldId: id, code: 'invalid-input' });
            }
            if (!current()) retired = true;
            validationStable =
                fields.controller.getState().draftRevision ===
                    control.draftRevision &&
                inputRevision === inputTicket &&
                navigationRevision === navigationTicket;
            // Invalid raw input need not change the last valid native value.
            // Retry once, then refuse if callbacks keep changing any validated
            // draft, input or navigation revision.
            if (!validationStable && !retired && retry) {
                needsRetry = true;
                return;
            }
            validatedDraftRevision =
                validationStable && !retired ? control.draftRevision : null;
            validatedInputRevision =
                validationStable && !retired ? inputTicket : null;
            validatedNavigationRevision =
                validationStable && !retired ? navigationTicket : null;
            const blocked = problems.some((p) =>
                [
                    'unsupported-configuration',
                    'unsupported-validation',
                    'invalid-metadata',
                    'blocked-visibility',
                ].includes(p.code)
            );
            backBlocked = problems.some((p) =>
                [
                    'unsupported-configuration',
                    'invalid-metadata',
                    'blocked-visibility',
                ].includes(p.code)
            );
            const queuedFiles = fields.hasPendingFiles();
            const busy =
                intent !== null ||
                queuedFiles ||
                !validationStable ||
                control.status === 'saving' ||
                !control.canSave ||
                [...snapshots.values()].some(
                    (s) =>
                        s.pending ||
                        (s.visibility.type === 'visible' &&
                            !s.readOnly &&
                            !s.canEdit)
                );
            const status: FormPageSnapshot['status'] = retired
                ? 'retired'
                : first < 0
                  ? 'all-hidden'
                  : blocked
                    ? 'blocked'
                    : 'ready';
            const shape = {
                status,
                pages,
                activePageIndex: active,
                currentFieldIds: currentIds,
                canBack:
                    status !== 'retired' &&
                    status !== 'all-hidden' &&
                    !backBlocked &&
                    !busy &&
                    pages.some((p, i) => i < active && !p.hidden),
                canNext:
                    status === 'ready' &&
                    !busy &&
                    problems.length === 0 &&
                    pages.some((p, i) => i > active && !p.hidden),
                canSubmit:
                    status === 'ready' &&
                    !busy &&
                    problems.length === 0 &&
                    active === last &&
                    [...snapshots.values()].some((s) => !s.readOnly),
                canReview:
                    cfg.promptUserBeforeSubmission === true &&
                    typeof options.review === 'function' &&
                    status === 'ready' &&
                    !busy &&
                    !problems.some((p) => p.code === 'invalid-input') &&
                    active === last &&
                    [...snapshots.values()].some((s) => !s.readOnly),
                reviewing: intent?.reviewing ?? false,
                problems,
            };
            const key = JSON.stringify([
                shape,
                control.draftRevision,
                inputTicket,
                navigationTicket,
                control.status,
                [...snapshots].map(([id, s]) => [
                    id,
                    s.scalar,
                    s.date,
                    s.pending,
                    s.retired,
                ]),
            ]);
            if (key !== fingerprint) {
                fingerprint = key;
                revision++;
            }
            state = { ...shape, revision };
            const held = intent;
            if (
                held?.reviewing &&
                (held.draftRevision !==
                    fields.controller.getState().draftRevision ||
                    held.inputRevision !== inputRevision ||
                    held.navigationRevision !== navigationRevision ||
                    held.pageIndex !== active ||
                    queuedFiles ||
                    !control.canSave ||
                    [...snapshots.values()].some(
                        (s) =>
                            s.pending ||
                            (s.visibility.type === 'visible' &&
                                !s.readOnly &&
                                !s.canEdit)
                    ))
            )
                held.abort.abort();
        } finally {
            syncing = false;
            if (needsRetry) sync(false);
            // A read can reenter through ownership callbacks and queue a write.
            // Deliver it even when no later external event follows that read.
            if (notificationPending && !emitting) publish(false);
        }
    };
    const snapshot = () => {
        sync();
        return structuredClone(state);
    };
    const publish = (synchronize: boolean) => {
        notificationPending = true;
        if (emitting || syncing) return;
        emitting = true;
        try {
            if (synchronize) sync();
            while (
                [...listeners.values()].some(
                    (delivered) => delivered !== revision
                )
            ) {
                for (const [listener, delivered] of listeners) {
                    if (delivered === revision) continue;
                    const ticket = revision;
                    // Mark before invoking the renderer, which can reenter.
                    listeners.set(listener, ticket);
                    try {
                        listener(structuredClone(state));
                    } catch {
                        /* Renderer errors do not change state. */
                    }
                    // An explicit read may already have synchronized a newer
                    // revision. Deliver that result without validating it again.
                    // Unstable validation refuses actions and gets no automatic
                    // retry merely to publish its busy snapshot.
                    if (revision === ticket && validationStable) sync();
                    if (revision !== ticket) break;
                }
            }
            notificationPending = false;
        } finally {
            emitting = false;
        }
    };
    const notify = () => publish(true);
    const refusal = (expected: number, back = false): FormPageAction | null => {
        sync();
        if (intent !== null) return { accepted: false, reason: 'busy' };
        if (retired) return { accepted: false, reason: 'retired' };
        if (expected !== revision)
            return { accepted: false, reason: 'stale-revision' };
        if (state.status === 'all-hidden')
            return { accepted: false, reason: 'no-page' };
        if (state.status === 'blocked' && (!back || backBlocked))
            return { accepted: false, reason: 'blocked' };
        const busy =
            !fields.controller.getState().canSave ||
            fields.hasPendingFiles() ||
            [...state.pages.flatMap((p) => p.fieldIds)].some((id) => {
                const s = fields.field(id).getSnapshot();
                return (
                    s.pending ||
                    (s.visibility.type === 'visible' &&
                        !s.readOnly &&
                        !s.canEdit)
                );
            });
        // Field/owner reads may invoke callbacks too. Never authorize an action
        // against a revision older than the final synchronized validation.
        sync();
        if (retired) return { accepted: false, reason: 'retired' };
        if (expected !== revision)
            return { accepted: false, reason: 'stale-revision' };
        if (busy || validatedDraftRevision === null)
            return { accepted: false, reason: 'busy' };
        return null;
    };
    // Observe model input changes before field render notifications. They
    // include unfinished input and ABA edits with an unchanged native draft.
    for (const id of loaded.payload.fieldIdsInForm) {
        try {
            const binding = fields.field(id);
            const changed = () => {
                inputRevision++;
                notify();
            };
            const scalarStop = binding.scalar?.subscribe(changed);
            const dateStop = binding.date?.subscribe(changed);
            if (scalarStop) stops.push(scalarStop);
            if (dateStop) stops.push(dateStop);
        } catch {
            /* Missing metadata is reported in the snapshot. */
        }
    }
    sync();
    stops.push(fields.controller.subscribe(notify));
    for (const id of loaded.payload.fieldIdsInForm) {
        try {
            stops.push(fields.field(id).subscribe(notify));
        } catch {
            /* Missing metadata is reported in the snapshot. */
        }
    }
    return {
        getSnapshot: snapshot,
        subscribe(listener) {
            listeners.set(listener, revision);
            return () => listeners.delete(listener);
        },
        back(expected) {
            const denied = refusal(expected, true);
            if (denied) return denied;
            const index = lastVisible(state.pages, active);
            if (index < 0) return { accepted: false, reason: 'no-page' };
            active = index;
            navigationRevision++;
            const completionRevision = revision + 1;
            notify();
            if (revision !== completionRevision && current())
                return { accepted: false, reason: 'stale-revision' };
            return current()
                ? { accepted: true }
                : { accepted: false, reason: 'retired' };
        },
        next(expected) {
            const denied = refusal(expected);
            if (denied) return denied;
            if (state.problems.length > 0)
                return { accepted: false, reason: 'validation' };
            const index = state.pages.findIndex(
                (p, i) => i > active && !p.hidden
            );
            if (index < 0) return { accepted: false, reason: 'no-page' };
            active = index;
            navigationRevision++;
            const completionRevision = revision + 1;
            notify();
            if (revision !== completionRevision && current())
                return { accepted: false, reason: 'stale-revision' };
            return current()
                ? { accepted: true }
                : { accepted: false, reason: 'retired' };
        },
        async submit(expected, saveOptions) {
            const denied = refusal(expected);
            if (denied && !denied.accepted)
                throw new FormPageError(denied.reason);
            const reviewRequired =
                loaded.payload.publicFields.state.promptUserBeforeSubmission ===
                true;
            if (!(reviewRequired ? state.canReview : state.canSubmit))
                throw new FormPageError(
                    state.problems.length ? 'validation' : 'no-page'
                );
            const control = fields.controller.getState();
            const draftRevision = control.draftRevision;
            if (
                validatedDraftRevision === null ||
                draftRevision !== validatedDraftRevision ||
                validatedInputRevision !== inputRevision ||
                validatedNavigationRevision !== navigationRevision ||
                control.draft === null
            )
                throw new FormPageError('stale-revision');
            const pageIndex = active;
            const inputTicket = inputRevision;
            const navigationTicket = navigationRevision;
            const operation = {
                abort: new AbortController(),
                reviewing: reviewRequired,
                draftRevision: draftRevision!,
                inputRevision: inputTicket,
                navigationRevision: navigationTicket,
                pageIndex,
            };
            const externalSignal = saveOptions?.signal;
            const abort = () => operation.abort.abort();
            externalSignal?.addEventListener('abort', abort, { once: true });
            if (externalSignal?.aborted) abort();
            intent = operation;
            const owns = () => {
                if (intent !== operation || operation.abort.signal.aborted)
                    return false;
                const live = current();
                return (
                    live &&
                    intent === operation &&
                    !operation.abort.signal.aborted &&
                    !fields.hasPendingFiles() &&
                    active === pageIndex &&
                    inputRevision === inputTicket &&
                    navigationRevision === navigationTicket &&
                    fields.controller.getState().draftRevision === draftRevision
                );
            };
            let presentationCurrent: (() => boolean) | undefined;
            const callerOwns = () => {
                if (!owns()) return false;
                const caller = saveOptions?.isCurrent?.() ?? true;
                return caller && owns();
            };
            const fresh = () => {
                if (!callerOwns()) return false;
                // Every application callback may synchronously mutate or dispose.
                if (presentationCurrent && !presentationCurrent()) return false;
                return callerOwns();
            };
            try {
                notify();
                if (!fresh()) throw new FormPageError('stale-revision');
                if (reviewRequired) {
                    const cancelled = new Promise<never>((_, reject) => {
                        const fail = () =>
                            reject(new FormPageError('review-cancelled'));
                        if (operation.abort.signal.aborted) fail();
                        else
                            operation.abort.signal.addEventListener(
                                'abort',
                                fail,
                                { once: true }
                            );
                    });
                    const decision = await Promise.race([
                        cancelled,
                        Promise.resolve().then(() => {
                            if (!fresh())
                                throw new FormPageError('stale-revision');
                            return options.review!({
                                revision: expected,
                                loaded: structuredClone(fields.getLoaded()),
                                draft: structuredClone(control.draft!),
                                signal: operation.abort.signal,
                                isCurrent: callerOwns,
                            });
                        }),
                    ]);
                    if (!owns()) throw new FormPageError('stale-revision');
                    if (decision?.type === 'edit')
                        throw new FormPageError('review-cancelled');
                    if (
                        decision?.type !== 'confirm' ||
                        typeof decision.isCurrent !== 'function'
                    )
                        throw new FormPageError('blocked');
                    presentationCurrent = () => decision.isCurrent();
                    if (!fresh()) throw new FormPageError('stale-revision');
                    sync();
                    if (
                        !fresh() ||
                        validatedDraftRevision !== draftRevision ||
                        validatedInputRevision !== inputTicket ||
                        validatedNavigationRevision !== navigationTicket
                    )
                        throw new FormPageError('stale-revision');
                    if (state.status !== 'ready' || state.problems.length > 0)
                        throw new FormPageError(
                            state.status === 'blocked'
                                ? 'blocked'
                                : 'validation'
                        );
                }
                if (!fresh()) throw new FormPageError('stale-revision');
                operation.reviewing = false;
                notify();
                if (!fresh()) throw new FormPageError('stale-revision');
                return await fields.save({
                    ...saveOptions,
                    signal: operation.abort.signal,
                    lifecycle: {
                        dispatch(input, revision) {
                            if (input.isComputeMode === true)
                                throw new FormPageError('blocked');
                            if (!fresh())
                                throw new FormPageError('stale-revision');
                            const journal = saveOptions?.lifecycle?.dispatch(
                                input,
                                revision
                            );
                            return {
                                accepted(result) {
                                    journal?.accepted(result);
                                },
                                finish(disposition) {
                                    journal?.finish(disposition);
                                },
                            };
                        },
                    },
                    isCurrent: fresh,
                });
            } finally {
                externalSignal?.removeEventListener('abort', abort);
                // An old completion owns only its own intent and abort signal.
                if (intent === operation) {
                    intent = null;
                    operation.abort.abort();
                    notify();
                }
            }
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            retired = true;
            intent?.abort.abort();
            for (const stop of stops) stop();
            notify();
            listeners.clear();
        },
    };
}
