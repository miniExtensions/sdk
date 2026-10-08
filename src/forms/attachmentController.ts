import type { MiniExtensionsClient } from '../runtime/types.js';
import type { FormLoadedResult } from '../runtime/types.js';
import type { FormFieldBindings } from './bindings.js';
import { checkFormAttachmentFiles } from './attachments.js';
import {
    admittedAttachmentValues,
    appendedAttachmentValues,
} from './attachmentUpload.js';
import {
    RecoveryJournal,
    type RecoveryScope,
    type RecoveryAttempt,
} from './recovery.js';

export type AttachmentPhase =
    | 'idle'
    | 'selected'
    | 'uploading'
    | 'accepted'
    | 'uncertain'
    | 'retired';
export type FormAttachmentSnapshot = {
    phase: AttachmentPhase;
    /** Original File identities are retained in memory, never serialized. */
    files: readonly File[];
    revision: number;
    busy: boolean;
    error: string | null;
    retired: boolean;
};
export type FormAttachmentController = {
    getSnapshot(): FormAttachmentSnapshot;
    subscribe(listener: (snapshot: FormAttachmentSnapshot) => void): () => void;
    /** Replace the pending queue; no upload. Empty chooser completion preserves it. */
    select(files: readonly File[]): boolean;
    clear(): void;
    /** Upload only the first queued file. Every further upload is explicit. */
    upload(): Promise<boolean>;
    cancel(): void;
    dispose(): void;
};
export type AttachmentRecovery = {
    journal: RecoveryJournal;
    scope: RecoveryScope;
    loadVersion: number;
};
export type FormAttachmentControllerOptions = AttachmentRecovery & {
    form: FormFieldBindings;
    fieldId: string;
    client: MiniExtensionsClient;
    changed?(): void;
    isCurrent?(): boolean;
    getLoaded?(): FormLoadedResult;
    configurationRevision?(): string | number;
    /** Adapter may capture unrelated reference input; it must not dispatch or mutate native data. */
    onAttempt?(attempt: RecoveryAttempt): void;
};

/** Shared admission, generation and uncertainty state; rendering never owns the queue. */
export function createFormAttachmentController(
    options: FormAttachmentControllerOptions
): FormAttachmentController {
    const { form, fieldId, client, journal } = options;
    const scope = structuredClone(options.scope);
    const epoch = form.controller.getState().epoch;
    const binding = form.field(fieldId);
    if (binding.getSnapshot().field?.fieldType !== 'multipleAttachments')
        throw new TypeError('An attachment field is required.');
    let files: File[] = [];
    let revision = 0;
    let retired = false;
    let phase: AttachmentPhase = 'idle';
    let error: string | null = null;
    let active: AbortController | null = null;
    const attempted = new WeakSet<File>();
    const listeners = new Set<(snapshot: FormAttachmentSnapshot) => void>();
    let stop: () => void = () => {};
    const current = () => {
        const state = form.controller.getState();
        return (
            !retired &&
            (options.isCurrent?.() ?? true) &&
            state.epoch === epoch &&
            state.draft !== null &&
            state.status !== 'stale' &&
            state.status !== 'disposed'
        );
    };
    const policyLoaded = () =>
        structuredClone(options.getLoaded?.() ?? form.getLoaded());
    const recordId = () => {
        const record = policyLoaded().payload.formRecord;
        return record.type === 'edit' ? record.recordId : null;
    };
    const blocked = () =>
        current() && journal.blocking(scope, recordId()) != null;
    const snapshot = (): FormAttachmentSnapshot => ({
        phase: retired
            ? 'retired'
            : blocked() && active === null
              ? 'uncertain'
              : phase,
        files: retired ? [] : [...files],
        revision,
        busy: active !== null,
        error: retired ? null : error,
        retired,
    });
    const emit = () => {
        if (!current()) return;
        const next = snapshot();
        for (const listener of [...listeners])
            if (listeners.has(listener)) {
                try {
                    listener({ ...next, files: [...next.files] });
                } catch {
                    /* Presentation cannot veto an accepted append. */
                }
            }
        try {
            options.changed?.();
        } catch {
            /* Same rule for stock and custom renderers. */
        }
    };
    const dispose = () => {
        if (retired) return;
        retired = true;
        revision++;
        files = [];
        const previous = active;
        active = null;
        for (const listener of [...listeners]) {
            try {
                listener(snapshot());
            } catch {}
        }
        listeners.clear();
        stop();
        previous?.abort();
    };
    stop = form.controller.subscribe((state) => {
        if (
            state.epoch !== epoch ||
            state.status === 'stale' ||
            state.status === 'disposed'
        )
            dispose();
    });
    if (retired) stop();
    const admission = (candidates: readonly File[]) => {
        if (
            !current() ||
            blocked() ||
            active !== null ||
            !binding.getSnapshot().canEdit
        )
            return false;
        const state = form.controller.getState();
        if (
            state.status !== 'ready' &&
            state.status !== 'validation-error' &&
            state.status !== 'saved'
        )
            return false;
        const loaded = policyLoaded();
        const check = checkFormAttachmentFiles({
            loaded,
            fieldId,
            value: state.draft!.data[fieldId],
            files: candidates,
        });
        return (
            check.batchError === null &&
            candidates.every((_, index) =>
                check.acceptedIndexes.includes(index)
            )
        );
    };
    return {
        getSnapshot() {
            if (!current() && !retired) dispose();
            return snapshot();
        },
        subscribe(listener) {
            listeners.add(listener);
            listener(snapshot());
            return () => listeners.delete(listener);
        },
        select(next) {
            if (
                !current() ||
                next.length === 0 ||
                binding.getSnapshot().visibility.type !== 'visible'
            )
                return false;
            try {
                if (
                    Array.from(next).some(
                        (file, index) =>
                            !Object.hasOwn(next, index) ||
                            file == null ||
                            typeof file.type !== 'string' ||
                            !Number.isFinite(file.size) ||
                            file.size < 0 ||
                            typeof file.arrayBuffer !== 'function'
                    )
                )
                    return false;
                // A replacement during a flight is queued only; it cannot change that flight's captured File.
                if (active === null && !admission(next)) {
                    error =
                        'These files cannot be added with the current Form settings.';
                    emit();
                    return false;
                }
                if (active !== null) {
                    const check = checkFormAttachmentFiles({
                        loaded: policyLoaded(),
                        fieldId,
                        value: form.controller.getState().draft!.data[fieldId],
                        files: next,
                    });
                    if (
                        check.batchError !== null ||
                        !next.every((_, index) =>
                            check.acceptedIndexes.includes(index)
                        )
                    )
                        return false;
                }
                files = [...next];
                revision++;
                error = null;
                if (active === null && !blocked()) phase = 'selected';
                emit();
                return true;
            } catch {
                error =
                    'These files cannot be added with the current Form settings.';
                emit();
                return false;
            }
        },
        clear() {
            if (!current()) return;
            files = [];
            revision++;
            if (active === null && !blocked()) phase = 'idle';
            error = null;
            emit();
        },
        async upload() {
            const selected = files[0];
            if (selected == null || attempted.has(selected)) return false;
            let native;
            try {
                if (!admission([selected])) return false;
                native = form.controller.getState();
                admittedAttachmentValues(
                    policyLoaded(),
                    fieldId,
                    native.draft!.data[fieldId],
                    selected
                );
            } catch {
                error =
                    'This file cannot be added with the current Form settings.';
                emit();
                return false;
            }
            const capturedRevision = revision;
            const configurationRevision = options.configurationRevision?.();
            const nativeRevision = native.draftRevision;
            const session = { ...client.getSession() };
            const loaded = policyLoaded();
            const abort = new AbortController();
            let attempt: RecoveryAttempt;
            try {
                attempt = journal.begin(
                    scope,
                    recordId(),
                    'upload',
                    options.loadVersion,
                    fieldId
                );
            } catch {
                return false;
            }
            attempt.retainedInput.push({
                title: 'Attachment activity',
                value: 'Attachment details are not retained.',
            });
            active = abort;
            phase = 'uploading';
            error = null;
            attempted.add(selected);
            const ownsAttempt = () => {
                const state = form.controller.getState();
                const now = client.getSession();
                return (
                    current() &&
                    options.configurationRevision?.() ===
                        configurationRevision &&
                    active === abort &&
                    !abort.signal.aborted &&
                    state.draftRevision === nativeRevision &&
                    Object.keys(now).length === Object.keys(session).length &&
                    Object.keys(session).every(
                        (key) => now[key] === session[key]
                    ) &&
                    attempt.flight &&
                    attempt.outcome === 'unknown' &&
                    attempt.acknowledgment === 'none' &&
                    journal.blocking(scope, recordId()) === attempt &&
                    binding.getSnapshot().visibility.type === 'visible'
                );
            };
            try {
                options.onAttempt?.(attempt);
                emit();
                if (!ownsAttempt()) return false;
                const returned = await client.attachments.uploadFile(
                    {
                        file: selected,
                        filename: selected.name,
                        extensionAccessToken:
                            loaded.payload.extensionAccessToken,
                        fieldId,
                    },
                    { signal: abort.signal, session }
                );
                if (!ownsAttempt()) return false;
                const state = form.controller.getState();
                const next = appendedAttachmentValues(
                    policyLoaded(),
                    fieldId,
                    state.draft!.data[fieldId],
                    selected,
                    returned
                );
                if (
                    !ownsAttempt() ||
                    !form.controller.write(fieldId, next, () =>
                        journal.accepted(attempt, 'uploaded')
                    )
                )
                    return false;
                // Accepted before any presentation/queue update; never replay after a renderer exception.
                attempted.delete(selected);
                if (!current()) return true;
                attempted.delete(selected);
                phase = 'accepted';
                if (revision === capturedRevision && files[0] === selected) {
                    files = files.slice(1);
                    revision++;
                }
                error = null;
                emit();
                return true;
            } catch {
                return false;
            } finally {
                journal.finishFlight(attempt);
                if (active === abort) {
                    active = null;
                    if (current()) {
                        if (attempt.outcome === 'unknown') {
                            phase = 'uncertain';
                            error =
                                'Upload outcome needs inspection. It was not added or retried automatically.';
                        }
                        emit();
                    }
                }
            }
        },
        cancel() {
            if (!current() || active === null) return;
            phase = 'uncertain';
            active.abort();
            emit();
        },
        dispose,
    };
}
