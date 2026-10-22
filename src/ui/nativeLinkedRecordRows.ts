/** Caller-owned rich display data for one distinct displayed record. */
export type NativeLinkedRecordRow<T> = { recordId: string; data: T };

/**
 * Project an already filtered/sorted native subset once per record ID.
 * Native selection, labels, permissions, requests and writers stay with the caller.
 */
export function projectNativeLinkedRecordRows<T>(
    recordIds: readonly string[],
    readDisplayData: (recordId: string) => T
): NativeLinkedRecordRow<T>[] {
    const seen = new Set<string>();
    return recordIds.reduce<NativeLinkedRecordRow<T>[]>((rows, recordId) => {
        if (seen.has(recordId)) return rows;
        seen.add(recordId);
        rows.push({ recordId, data: readDisplayData(recordId) });
        return rows;
    }, []);
}
