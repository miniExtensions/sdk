/** Caller-owned read transport and captured summary-refresh generation. */
export type PortalSummaryRefreshOptions<RecordType> = Readonly<{
    /** Read only: a failed attempt may be repeated once. Never pass a mutation. */
    fetchRecord(): Promise<RecordType>;
    generation: number;
    /** Include actual mount/session/record/configuration ownership in this guard. */
    isLatestGeneration(generation: number): boolean;
    /** Synchronous host application; exceptions propagate without rereading. */
    onFresh(record: RecordType): void;
    /** Synchronous host warning; exceptions propagate. */
    onStale(): void;
}>;

/**
 * Refresh a hosted Portal summary with at most two reads. The caller retains
 * identity, generation allocation, transport, state application and recovery UI.
 * Retirement suppresses subsequent reads and callbacks; it does not abort an
 * already-started read. No mutation or authentication recovery is performed.
 */
export const refreshPortalSummaryFields = async <RecordType>(
    options: PortalSummaryRefreshOptions<RecordType>
): Promise<void> => {
    const { fetchRecord, generation, isLatestGeneration, onFresh, onStale } =
        options;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!isLatestGeneration(generation)) return;
        let record: RecordType;
        try {
            record = await fetchRecord();
        } catch {
            if (!isLatestGeneration(generation)) return;
            if (attempt === 1) {
                onStale();
                return;
            }
            continue;
        }
        if (!isLatestGeneration(generation)) return;
        onFresh(record);
        return;
    }
};
