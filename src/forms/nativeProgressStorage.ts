import type { AirtableFieldSet } from '../runtime/types.js';

const kind = 'miniExtensions-form-progress';
const schemaVersion = 1;
type Envelope = {
    kind: typeof kind;
    schemaVersion: typeof schemaVersion;
    revision: number;
    writerId: string;
    record: AirtableFieldSet;
};

export type NativeFormProgressSnapshot = {
    record: AirtableFieldSet;
    revision: number;
    writerId: string | null;
};
export type NativeFormProgressWriteResult =
    | { status: 'written'; revision: number }
    | { status: 'conflict' }
    | { status: 'unavailable' };
export type NativeFormProgressRemovalResult =
    | { status: 'removed' }
    | { status: 'preserved-newer-progress' }
    | { status: 'unavailable' };
export type NativeFormProgressStorageAdapter = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};
export type NativeFormProgressLockManager = {
    request<Result>(name: string, callback: () => Result): Promise<Result>;
};
export type NativeFormProgressStorageOptions = {
    shareId: string;
    writerId: string;
    getStorage(): NativeFormProgressStorageAdapter;
    getLocks?(): NativeFormProgressLockManager | undefined;
    onWarning?(operation: 'read' | 'remove' | 'write'): void;
};
export type NativeFormProgressStorage = {
    read(): NativeFormProgressSnapshot | undefined;
    write(args: {
        expectedRevision: number | null;
        record: AirtableFieldSet;
    }): Promise<NativeFormProgressWriteResult>;
    /** Native Discard is unconditional and does not acquire a lock. */
    remove(): boolean;
    /** Preserves another writer; intentionally removes newer same-writer data. */
    removeIfOwned(): Promise<NativeFormProgressRemovalResult>;
};

export const makeNativeFormProgressKey = (shareId: string): string =>
    `form-progress-${shareId}`;

const isRecord = (value: unknown): value is AirtableFieldSet =>
    typeof value === 'object' && value != null && !Array.isArray(value);
const isEnvelope = (value: unknown): value is Envelope => {
    if (!isRecord(value)) return false;
    return (
        value.kind === kind &&
        value.schemaVersion === schemaVersion &&
        typeof value.revision === 'number' &&
        Number.isInteger(value.revision) &&
        value.revision > 0 &&
        typeof value.writerId === 'string' &&
        value.writerId.length > 0 &&
        isRecord(value.record)
    );
};

/** Native storage-event parsing only; the host owns its conflict latch. */
export const parseNativeFormProgressValue = (
    storedValue: string | null
): NativeFormProgressSnapshot | undefined => {
    if (storedValue == null) return undefined;
    try {
        const parsed: unknown = JSON.parse(storedValue);
        if (isEnvelope(parsed))
            return {
                record: parsed.record,
                revision: parsed.revision,
                writerId: parsed.writerId,
            };
        if (isRecord(parsed) && parsed.kind !== kind)
            return { record: parsed, revision: 0, writerId: null };
    } catch {
        return undefined;
    }
    return undefined;
};

/**
 * Compatibility extraction of native Form progress storage at monorepo
 * 25f5efdefaf482dea07af05d54fbeea8e3d92635. Rich JSON values and the native
 * revision protocol are preserved, including operation without Web Locks.
 * The host retains writer-ID generation, conflict state, Restore and Save.
 * Construction performs no storage I/O and installs no event listener.
 */
export const createNativeFormProgressStorage = (
    options: NativeFormProgressStorageOptions
): NativeFormProgressStorage => {
    const warn =
        options.onWarning ??
        ((operation: 'read' | 'remove' | 'write') => {
            console.warn(
                `Unable to ${operation} browser-local Form progress; continuing without it.`
            );
        });
    const remove = (): boolean => {
        try {
            options
                .getStorage()
                .removeItem(makeNativeFormProgressKey(options.shareId));
            return true;
        } catch {
            warn('remove');
            return false;
        }
    };
    const read = (): NativeFormProgressSnapshot | undefined => {
        let storedValue: string | null;
        try {
            storedValue = options
                .getStorage()
                .getItem(makeNativeFormProgressKey(options.shareId));
        } catch {
            warn('read');
            return undefined;
        }
        if (storedValue == null) return undefined;
        const snapshot = parseNativeFormProgressValue(storedValue);
        if (snapshot != null) return snapshot;
        remove();
        return undefined;
    };
    const write: NativeFormProgressStorage['write'] = async (args) => {
        const lockManager = options.getLocks?.();
        const writeIfCurrent = (): NativeFormProgressWriteResult => {
            const currentSnapshot = read();
            const currentRevision = currentSnapshot?.revision ?? null;
            if (currentRevision !== args.expectedRevision)
                return { status: 'conflict' };
            const revision = (currentRevision ?? 0) + 1;
            const envelope: Envelope = {
                kind,
                schemaVersion,
                revision,
                writerId: options.writerId,
                record: args.record,
            };
            try {
                options
                    .getStorage()
                    .setItem(
                        makeNativeFormProgressKey(options.shareId),
                        JSON.stringify(envelope)
                    );
                return { status: 'written', revision };
            } catch {
                warn('write');
                return { status: 'unavailable' };
            }
        };
        if (lockManager == null) return writeIfCurrent();
        try {
            return await lockManager.request(
                `form-progress-lock-${options.shareId}`,
                writeIfCurrent
            );
        } catch {
            warn('write');
            return { status: 'unavailable' };
        }
    };
    const removeIfOwned =
        async (): Promise<NativeFormProgressRemovalResult> => {
            const lockManager = options.getLocks?.();
            const removeIfCurrentOwner =
                (): NativeFormProgressRemovalResult => {
                    const currentSnapshot = read();
                    if (
                        currentSnapshot?.writerId != null &&
                        currentSnapshot.writerId !== options.writerId
                    )
                        return { status: 'preserved-newer-progress' };
                    return remove()
                        ? { status: 'removed' }
                        : { status: 'unavailable' };
                };
            if (lockManager == null) return removeIfCurrentOwner();
            try {
                return await lockManager.request(
                    `form-progress-lock-${options.shareId}`,
                    removeIfCurrentOwner
                );
            } catch {
                warn('remove');
                return { status: 'unavailable' };
            }
        };
    return { read, write, remove, removeIfOwned };
};
