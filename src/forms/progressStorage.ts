import type { AirtableFieldSet } from '../runtime/types.js';

const formProgressEnvelopeKind = 'miniExtensions-form-progress';
const formProgressEnvelopeVersion = 1;

type FormProgressEnvelope = {
    kind: typeof formProgressEnvelopeKind;
    schemaVersion: typeof formProgressEnvelopeVersion;
    revision: number;
    writerId: string;
    record: AirtableFieldSet;
};

export type StoredFormProgressSnapshot = {
    record: AirtableFieldSet;
    revision: number;
    writerId: string | null;
};

export type FormProgressWriteResult =
    | { status: 'written'; revision: number }
    | { status: 'conflict' }
    | { status: 'unavailable' };

export type FormProgressRemovalResult =
    | { status: 'removed' }
    | { status: 'preserved-newer-progress' }
    | { status: 'unavailable' };

export const makeFormProgressKey = (shareId: string) =>
    `form-progress-${shareId}`;

const makeFormProgressWriterKey = (shareId: string) =>
    `form-progress-writer-${shareId}`;

const makeFormProgressLockName = (shareId: string) =>
    `form-progress-lock-${shareId}`;

const isAirtableFieldSetShape = (value: unknown): value is AirtableFieldSet =>
    typeof value === 'object' && value != null && !Array.isArray(value);

const isFormProgressEnvelope = (
    value: unknown
): value is FormProgressEnvelope => {
    if (!isAirtableFieldSetShape(value)) return false;

    return (
        value.kind === formProgressEnvelopeKind &&
        value.schemaVersion === formProgressEnvelopeVersion &&
        typeof value.revision === 'number' &&
        Number.isInteger(value.revision) &&
        value.revision > 0 &&
        typeof value.writerId === 'string' &&
        value.writerId.length > 0 &&
        isAirtableFieldSetShape(value.record)
    );
};

export const parseStoredFormProgressValue = (
    storedValue: string | null
): StoredFormProgressSnapshot | undefined => {
    if (storedValue == null) return undefined;

    try {
        const parsedValue: unknown = JSON.parse(storedValue);
        if (isFormProgressEnvelope(parsedValue)) {
            return {
                record: parsedValue.record,
                revision: parsedValue.revision,
                writerId: parsedValue.writerId,
            };
        }

        if (
            isAirtableFieldSetShape(parsedValue) &&
            parsedValue.kind !== formProgressEnvelopeKind
        ) {
            // Progress written before the concurrency protocol remains
            // restorable. Revision zero makes the first new writer upgrade it
            // atomically instead of discarding a customer's draft.
            return {
                record: parsedValue,
                revision: 0,
                writerId: null,
            };
        }
    } catch {
        return undefined;
    }

    return undefined;
};

/** The application resolves its chosen browser storage only at an operation. */
export type FormProgressStorageAdapter = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};

/** Adapt Web Locks explicitly; no browser capability is discovered by the SDK. */
export type FormProgressLockManager = {
    request<Result>(name: string, callback: () => Result): Promise<Result>;
};

export type FormProgressStorageOptions = {
    getLocalStorage(): FormProgressStorageAdapter | undefined;
    getSessionStorage(): FormProgressStorageAdapter | undefined;
    getLocks?(): FormProgressLockManager | undefined;
    createWriterId(): string;
    /** Operation only: never receives a draft, storage error or credential. */
    onUnavailable?(operation: 'read' | 'remove' | 'write'): void;
};

export type FormProgressStorage = {
    readStoredFormProgressSnapshot(
        shareId: string
    ): StoredFormProgressSnapshot | undefined;
    readStoredFormProgress(shareId: string): AirtableFieldSet | undefined;
    getFormProgressWriterId(shareId: string): string;
    writeStoredFormProgress(args: {
        expectedRevision: number | null;
        record: AirtableFieldSet;
        shareId: string;
        writerId: string;
    }): Promise<FormProgressWriteResult>;
    removeStoredFormProgress(shareId: string): boolean;
    removeStoredFormProgressIfOwned(args: {
        shareId: string;
        writerId: string;
    }): Promise<FormProgressRemovalResult>;
};

const requireStorage = (
    resolve: () => FormProgressStorageAdapter | undefined
): FormProgressStorageAdapter => {
    const storage = resolve();
    if (storage === undefined)
        throw new TypeError('Form progress storage is unavailable.');
    return storage;
};

/** Opt-in local draft protocol. Construction performs no I/O or global access. */
export const createFormProgressStorage = (
    options: FormProgressStorageOptions
): FormProgressStorage => {
    // Reuse one owner per application to retain fallback identities by share.
    const fallbackWriterIds = new Map<string, string>();
    const removeStoredFormProgress = (shareId: string): boolean => {
        try {
            requireStorage(() => options.getLocalStorage()).removeItem(
                makeFormProgressKey(shareId)
            );
            return true;
        } catch {
            options.onUnavailable?.('remove');
            return false;
        }
    };

    const readStoredFormProgressSnapshot = (
        shareId: string
    ): StoredFormProgressSnapshot | undefined => {
        let storedValue: string | null;
        try {
            storedValue = requireStorage(() =>
                options.getLocalStorage()
            ).getItem(makeFormProgressKey(shareId));
        } catch {
            options.onUnavailable?.('read');
            return undefined;
        }

        if (storedValue == null) return undefined;

        const snapshot = parseStoredFormProgressValue(storedValue);
        if (snapshot != null) return snapshot;

        removeStoredFormProgress(shareId);
        return undefined;
    };

    const readStoredFormProgress = (
        shareId: string
    ): AirtableFieldSet | undefined =>
        readStoredFormProgressSnapshot(shareId)?.record;

    const getFormProgressWriterId = (shareId: string): string => {
        const fallbackWriterId = fallbackWriterIds.get(shareId);

        try {
            const key = makeFormProgressWriterKey(shareId);
            const storedWriterId = requireStorage(() =>
                options.getSessionStorage()
            ).getItem(key);
            if (storedWriterId != null) return storedWriterId;

            const writerId = fallbackWriterId ?? options.createWriterId();
            requireStorage(() => options.getSessionStorage()).setItem(
                key,
                writerId
            );
            fallbackWriterIds.set(shareId, writerId);
            return writerId;
        } catch {
            if (fallbackWriterId != null) return fallbackWriterId;

            const writerId = options.createWriterId();
            fallbackWriterIds.set(shareId, writerId);
            return writerId;
        }
    };

    const writeStoredFormProgress = async (args: {
        expectedRevision: number | null;
        record: AirtableFieldSet;
        shareId: string;
        writerId: string;
    }): Promise<FormProgressWriteResult> => {
        const lockManager = options.getLocks?.();
        const writeIfCurrent = (): FormProgressWriteResult => {
            const currentSnapshot = readStoredFormProgressSnapshot(
                args.shareId
            );
            const currentRevision = currentSnapshot?.revision ?? null;

            if (currentRevision !== args.expectedRevision) {
                return { status: 'conflict' };
            }

            const revision = (currentRevision ?? 0) + 1;
            const envelope: FormProgressEnvelope = {
                kind: formProgressEnvelopeKind,
                schemaVersion: formProgressEnvelopeVersion,
                revision,
                writerId: args.writerId,
                record: args.record,
            };

            try {
                requireStorage(() => options.getLocalStorage()).setItem(
                    makeFormProgressKey(args.shareId),
                    JSON.stringify(envelope)
                );
                return { status: 'written', revision };
            } catch {
                options.onUnavailable?.('write');
                return { status: 'unavailable' };
            }
        };

        // Web Locks serialize the read/write critical section across cooperating
        // tabs. Without them this preserves revision checks only; the application
        // still owns storage-event conflict detection.
        if (lockManager == null) return writeIfCurrent();

        try {
            return await lockManager.request(
                makeFormProgressLockName(args.shareId),
                writeIfCurrent
            );
        } catch {
            options.onUnavailable?.('write');
            return { status: 'unavailable' };
        }
    };

    const removeStoredFormProgressIfOwned = async (args: {
        shareId: string;
        writerId: string;
    }): Promise<FormProgressRemovalResult> => {
        const lockManager = options.getLocks?.();
        const removeIfCurrentOwner = (): FormProgressRemovalResult => {
            const currentSnapshot = readStoredFormProgressSnapshot(
                args.shareId
            );

            if (
                currentSnapshot?.writerId != null &&
                currentSnapshot.writerId !== args.writerId
            ) {
                return { status: 'preserved-newer-progress' };
            }

            return removeStoredFormProgress(args.shareId)
                ? { status: 'removed' }
                : { status: 'unavailable' };
        };

        if (lockManager == null) return removeIfCurrentOwner();

        try {
            return await lockManager.request(
                makeFormProgressLockName(args.shareId),
                removeIfCurrentOwner
            );
        } catch {
            options.onUnavailable?.('remove');
            return { status: 'unavailable' };
        }
    };

    return {
        readStoredFormProgressSnapshot,
        readStoredFormProgress,
        getFormProgressWriterId,
        writeStoredFormProgress,
        removeStoredFormProgress,
        removeStoredFormProgressIfOwned,
    };
};
