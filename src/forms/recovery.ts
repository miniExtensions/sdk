import type { SaveFormInput } from '../runtime/types.js';

/** Example-local state only: local IDs are not server idempotency keys. */
export type RecoveryScope = {
    owner: string;
    parentFieldId: string | null;
    tableId: string | null;
    childExtensionId: string;
    context: SaveFormInput['context']['type'];
};
export type RecoveryAttempt = {
    id: string;
    scope: RecoveryScope;
    recordId: string | null;
    fieldId: string | null;
    loadVersion: number;
    operation: 'save' | 'upload' | 'choice' | 'button';
    outcome:
        | 'not-submitted'
        | 'not-dispatched'
        | 'unknown'
        | 'saved'
        | 'validation-error'
        | 'uploaded'
        | 'choice-created'
        | 'webhook-success';
    flight: boolean;
    acknowledgment: 'none' | 'existing-request' | 'new-intent';
    associatedRecordId: string | null;
    retainedInput: Array<{ title: string; value: string }>;
};
export const recoveryOwner = (
    apiOrigin: string,
    shareId: string,
    portal: {
        extensionId: string;
        payload: { formRecord: { tableId: string; recordId: string } };
    }
): string =>
    JSON.stringify([
        new URL(apiOrigin).origin,
        shareId.trim(),
        portal.extensionId,
        portal.payload.formRecord.tableId,
        portal.payload.formRecord.recordId,
    ]);
export const sameRecoveryRelationship = (
    left: RecoveryScope,
    right: RecoveryScope
): boolean =>
    left.owner === right.owner &&
    left.parentFieldId === right.parentFieldId &&
    left.tableId === right.tableId &&
    left.context === right.context;
/** Internal observation for owner-held Button models; no retained input is exposed. */
type RecoveryChange = {
    scope: RecoveryScope;
    recordId: string | null;
};
const observers = new WeakMap<
    RecoveryJournal,
    Set<(change: RecoveryChange) => void>
>();
export function subscribeRecoveryJournal(
    journal: RecoveryJournal,
    listener: (change: RecoveryChange) => void
): () => void {
    let listeners = observers.get(journal);
    if (!listeners) observers.set(journal, (listeners = new Set()));
    listeners.add(listener);
    return () => listeners.delete(listener);
}
const notifyRecoveryChange = (
    journal: RecoveryJournal,
    attempt: RecoveryAttempt
) => {
    for (const listener of [...(observers.get(journal) ?? [])]) {
        try {
            listener({
                scope: { ...attempt.scope },
                recordId: attempt.recordId,
            });
        } catch {}
    }
};
/** Operation guards survive in-page teardown; a document reload loses the journal. */
export class RecoveryJournal {
    private attempts: RecoveryAttempt[] = [];
    private sequence = 0;
    /** Explicit privacy teardown drops reference input, never commit uncertainty. */
    scrubRetainedInput(): void {
        for (const attempt of this.attempts) attempt.retainedInput = [];
    }
    unknown(owner: string): RecoveryAttempt[] {
        return this.attempts.filter(
            (attempt) =>
                attempt.scope.owner === owner && attempt.outcome === 'unknown'
        );
    }
    blocking(
        scope: RecoveryScope,
        recordId: string | null
    ): RecoveryAttempt | undefined {
        return this.unknown(scope.owner).find(
            (attempt) =>
                sameRecoveryRelationship(attempt.scope, scope) &&
                attempt.recordId === recordId &&
                attempt.acknowledgment === 'none'
        );
    }
    prepare(
        scope: RecoveryScope,
        recordId: string | null,
        loadVersion: number
    ): RecoveryAttempt {
        const attempt: RecoveryAttempt = {
            id: `attempt-${++this.sequence}`,
            scope: { ...scope },
            recordId,
            fieldId: null,
            loadVersion,
            operation: 'save',
            outcome: 'not-submitted',
            flight: false,
            acknowledgment: 'none',
            associatedRecordId: null,
            retainedInput: [],
        };
        this.attempts.push(attempt);
        return attempt;
    }
    begin(
        scope: RecoveryScope,
        recordId: string | null,
        operation: RecoveryAttempt['operation'],
        loadVersion: number,
        fieldId: string | null = null,
        prepared?: RecoveryAttempt | null
    ): RecoveryAttempt {
        if (this.blocking(scope, recordId))
            throw new Error(
                'Inspect the earlier attempt before submitting again.'
            );
        const attempt =
            prepared?.outcome === 'not-submitted' &&
            sameRecoveryRelationship(prepared.scope, scope) &&
            prepared.recordId === recordId
                ? prepared
                : this.prepare(scope, recordId, loadVersion);
        attempt.operation = operation;
        attempt.fieldId = fieldId;
        attempt.loadVersion = loadVersion;
        attempt.outcome = 'unknown';
        attempt.flight = true;
        notifyRecoveryChange(this, attempt);
        return attempt;
    }
    /** Only a proven pre-transport disposition may settle the exact active journal attempt. */
    notDispatched(attempt: RecoveryAttempt): boolean {
        if (
            !this.attempts.includes(attempt) ||
            attempt.outcome !== 'unknown' ||
            !attempt.flight ||
            attempt.acknowledgment !== 'none'
        )
            return false;
        attempt.outcome = 'not-dispatched';
        attempt.flight = false;
        attempt.retainedInput = [];
        notifyRecoveryChange(this, attempt);
        return true;
    }
    finishFlight(attempt: RecoveryAttempt): void {
        const wasFlying = attempt.flight;
        attempt.flight = false;
        if (wasFlying) notifyRecoveryChange(this, attempt);
    }
    accepted(
        attempt: RecoveryAttempt,
        outcome:
            | 'saved'
            | 'validation-error'
            | 'uploaded'
            | 'choice-created'
            | 'webhook-success'
    ): void {
        attempt.outcome = outcome;
        attempt.flight = false;
        notifyRecoveryChange(this, attempt);
    }
    acknowledgeExisting(attempt: RecoveryAttempt, recordId: string): void {
        this.assertSettled(attempt);
        attempt.acknowledgment = 'existing-request';
        attempt.associatedRecordId = recordId;
        notifyRecoveryChange(this, attempt);
        // A human association is NOT proof the attempt created or updated this record.
    }
    acknowledgeNewIntent(attempt: RecoveryAttempt): void {
        this.assertSettled(attempt);
        attempt.acknowledgment = 'new-intent';
        notifyRecoveryChange(this, attempt);
        // Original outcome remains unknown. It is never replayed or marked failed.
    }
    private assertSettled(attempt: RecoveryAttempt): void {
        if (attempt.flight || attempt.outcome !== 'unknown')
            throw new Error(
                'Wait for the browser action to stop, then check again.'
            );
    }
}
