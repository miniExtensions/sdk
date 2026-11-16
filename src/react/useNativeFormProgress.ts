import { useEffect, useRef, useState } from 'react';
import type { AirtableFieldSet } from '../runtime/types.js';
import {
    makeNativeFormProgressKey,
    parseNativeFormProgressValue,
    type NativeFormProgressSnapshot,
    type NativeFormProgressWriteResult,
} from '../forms/nativeProgressStorage.js';

/** Undefined means no witness; an explicit null revision/writer witnesses absence. */
export type NativeFormProgressRead = {
    shareId: string;
    revision: number | null;
    writerId: string | null;
};
export type NativeFormProgressStorageEvent = {
    key: string | null;
    newValue: string | null;
};
/** Stable host ports. Reads preserve the synchronous native best-effort protocol. */
export type NativeFormProgressPorts = {
    readSnapshot(shareId: string): NativeFormProgressSnapshot | undefined;
    remove(shareId: string): boolean;
    getWriterId(shareId: string): string;
    write(args: {
        shareId: string;
        writerId: string;
        record: AirtableFieldSet;
        expectedRevision: number | null;
        /** Forward into storage: this must be checked after acquiring its lock. */
        isWriteStillEligible(): boolean;
    }): Promise<NativeFormProgressWriteResult | { status: 'cancelled' }>;
    subscribeStorage(
        listener: (event: NativeFormProgressStorageEvent) => void
    ): () => void;
};
export type NativeFormProgressOptions = {
    surfaceEnabled?: boolean;
    /** Null for modal/other non-direct surfaces. */
    shareId: string | null;
    /** The host excludes login, Compute and disabled saving. */
    configurationEligible: boolean;
    /** Keep this publication's identity and original canonical record reference. */
    record: { type: string; data: AirtableFieldSet };
    progressRead?: NativeFormProgressRead | undefined;
    ports: NativeFormProgressPorts;
};

type FormProgressWriterState = {
    hasConflict: boolean;
    needsWriteRetry: boolean;
    writeGeneration: number;
    lastObservedRecord: AirtableFieldSet;
    pendingWrite: Promise<void>;
    revision: number | null;
    shareId: string;
    writerId: string;
};

const recordsAreEqual = (left: unknown, right: unknown): boolean => {
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return false;
    }
};

/** Publish the host's committed, canonical unfiltered record. No I/O during render. */
export function useNativeFormProgress({
    surfaceEnabled = true,
    shareId,
    configurationEligible: progressConfigurationIsEligible,
    record: unfilteredFormRecord,
    progressRead,
    ports,
}: NativeFormProgressOptions) {
    const [conflictingShareId, setConflictingShareId] = useState<string | null>(
        null
    );
    const writerStateRef = useRef<FormProgressWriterState | null>(null);

    useEffect(() => {
        return () => {
            // Retire this hook's write authority without deleting persisted drafts.
            // A pending Web Lock callback rechecks the reference before storage mutation.
            writerStateRef.current = null;
        };
    }, []);

    const enabled = surfaceEnabled;

    useEffect(() => {
        if (!enabled) {
            // Builder previews must not acquire or remove runtime draft authority.
            writerStateRef.current = null;
            return;
        }
        if (shareId == null) return;

        if (!progressConfigurationIsEligible) {
            // Revoke queued writes before removing this share’s draft. A writer
            // may already be waiting inside the storage boundary for a Web Lock.
            writerStateRef.current = null;
            ports.remove(shareId);
            return;
        }

        if (unfilteredFormRecord.type !== 'create') {
            // Save adopts the record ID without unmounting FormLoaded. Retire
            // queued create writes, but leave draft deletion to submit cleanup.
            writerStateRef.current = null;
            return;
        }

        if (unfilteredFormRecord.type === 'create') {
            let writerState = writerStateRef.current;
            let shouldUpgradeLegacyDraft = false;
            if (writerState == null || writerState.shareId !== shareId) {
                const existingSnapshot = ports.readSnapshot(shareId);
                // Hydration must not acquire authority over a draft that changed
                // after the load read it (including while Restore was open).
                const staleRead =
                    progressRead != null &&
                    (progressRead.shareId !== shareId ||
                        progressRead.revision !==
                            (existingSnapshot?.revision ?? null) ||
                        progressRead.writerId !==
                            (existingSnapshot?.writerId ?? null));
                if (staleRead) setConflictingShareId(shareId);
                // Preserve migration of an existing legacy draft to the
                // versioned writer protocol, even when restored values match.
                shouldUpgradeLegacyDraft = existingSnapshot?.revision === 0;
                writerState = {
                    // Eligibility toggles do not release this mounted share's
                    // reload-required conflict authority. Keep writer and alert aligned.
                    hasConflict: staleRead || conflictingShareId === shareId,
                    needsWriteRetry: false,
                    writeGeneration: 0,
                    // Observe current hydration as a baseline. A stored draft
                    // remains the comparison point when restoration reconciles it.
                    lastObservedRecord:
                        existingSnapshot?.record ?? unfilteredFormRecord.data,
                    pendingWrite: Promise.resolve(),
                    revision: existingSnapshot?.revision ?? null,
                    shareId,
                    writerId: ports.getWriterId(shareId),
                };
                writerStateRef.current = writerState;
            }

            // Selectors can publish a fresh record object without changing any
            // values. Only a value transition is an edit, including returning
            // to the original baseline after a different value was entered.
            if (
                !shouldUpgradeLegacyDraft &&
                !writerState.needsWriteRetry &&
                recordsAreEqual(
                    writerState.lastObservedRecord,
                    unfilteredFormRecord.data
                )
            )
                return;
            writerState.lastObservedRecord = unfilteredFormRecord.data;
            // Consume retry admission when queuing, not after completion, so
            // equal publications cannot queue duplicate attempts while waiting.
            writerState.needsWriteRetry = false;
            const writeGeneration = ++writerState.writeGeneration;

            // Conditional visibility is presentation and save authorization,
            // not permission to erase a value the user already entered. Keep
            // the unfiltered record so hide -> reload -> reveal can recover it;
            // the backend still applies the current condition before mutation.
            const record = unfilteredFormRecord.data;
            writerState.pendingWrite = writerState.pendingWrite.then(
                async () => {
                    if (writerState.hasConflict) return;

                    const result = await ports.write({
                        isWriteStillEligible: () =>
                            writerStateRef.current === writerState &&
                            !writerState.hasConflict,
                        expectedRevision: writerState.revision,
                        record,
                        shareId,
                        writerId: writerState.writerId,
                    });

                    if (result.status === 'written') {
                        writerState.revision = result.revision;
                    } else if (
                        result.status === 'unavailable' &&
                        writerStateRef.current === writerState &&
                        writerState.writeGeneration === writeGeneration
                    ) {
                        // Remember failure separately from observation. Only a
                        // later publication retries; no state update or timer
                        // schedules a loop, and stale attempts cannot mark a
                        // newer queued edit as needing another write.
                        writerState.needsWriteRetry = true;
                    } else if (result.status === 'conflict') {
                        writerState.hasConflict = true;
                        setConflictingShareId(shareId);
                    }
                }
            );
        }
    }, [
        enabled,
        unfilteredFormRecord,
        progressConfigurationIsEligible,
        shareId,
        conflictingShareId,
        progressRead,
        ports,
    ]);

    useEffect(() => {
        if (!enabled || shareId == null || !progressConfigurationIsEligible)
            return;

        const handleStorage = (event: NativeFormProgressStorageEvent) => {
            if (event.key !== makeNativeFormProgressKey(shareId)) return;

            const writerState = writerStateRef.current;
            if (writerState == null || writerState.shareId !== shareId) return;

            const replacement = parseNativeFormProgressValue(event.newValue);
            const wasRemoved = event.newValue == null;
            const wasReplacedByAnotherWriter =
                replacement != null &&
                replacement.writerId !== writerState.writerId;

            if (wasRemoved || wasReplacedByAnotherWriter) {
                writerState.hasConflict = true;
                setConflictingShareId(shareId);
            }
        };

        return ports.subscribeStorage(handleStorage);
    }, [enabled, progressConfigurationIsEligible, shareId, ports]);

    return {
        hasConflict:
            enabled &&
            progressConfigurationIsEligible &&
            shareId != null &&
            conflictingShareId === shareId,
    };
}
