import type { PortalVisitorSortStamp } from './visitorSort.js';

/** Search and Sort use the same Portal collection owner. */
export type PortalVisitorSearchStamp = PortalVisitorSortStamp;

export type PortalVisitorSearchFrame = Readonly<{
    stamp: PortalVisitorSearchStamp;
    searchTerm: string;
}>;

export type PortalVisitorSearchIntent =
    | Readonly<{ source: 'submit' | 'scan'; searchTerm: string }>
    | Readonly<{ source: 'clear' }>;

export type PortalVisitorSearchCommand = Readonly<{
    stamp: PortalVisitorSearchStamp;
    source: PortalVisitorSearchIntent['source'];
    expectedSearchTerm: string;
    searchTerm: string;
}>;

export type PortalVisitorSearchOutcome =
    | Readonly<{ type: 'allocated'; requestId: string; generation: number }>
    | Readonly<{ type: 'stale' }>
    | Readonly<{
          type: 'refused' | 'uncertain';
          /** Set only when the host observed this command publish its own term. */
          committedGeneration?: number;
      }>;

export type PortalVisitorSearchPort = {
    read(): PortalVisitorSearchFrame | null;
    /**
     * Check the captured owner before changing the committed search term.
     * Request the first page even when the new term equals the current term.
     * Report allocation only after the authorized transport is invoked. If
     * the command publishes its term and the read is then refused or uncertain,
     * report the generation of that verified publication with the outcome.
     */
    apply(
        command: PortalVisitorSearchCommand
    ): PortalVisitorSearchOutcome | Promise<PortalVisitorSearchOutcome>;
};

function isRevision(value: unknown): boolean {
    return (
        (typeof value === 'string' && value.length > 0) ||
        Number.isSafeInteger(value)
    );
}

function readFrame(
    port: PortalVisitorSearchPort
): PortalVisitorSearchFrame | null {
    try {
        const frame = port.read();
        if (!frame || typeof frame.searchTerm !== 'string') return null;
        const {
            sessionId,
            fieldId,
            viewId,
            configurationRevision,
            metadataRevision,
            generation,
        } = frame.stamp;
        if (
            typeof sessionId !== 'string' ||
            !sessionId ||
            typeof fieldId !== 'string' ||
            !fieldId ||
            !(viewId === null || typeof viewId === 'string') ||
            !isRevision(configurationRevision) ||
            !isRevision(metadataRevision) ||
            !Number.isSafeInteger(generation) ||
            generation < 0
        )
            return null;
        return Object.freeze({
            stamp: Object.freeze({
                sessionId,
                fieldId,
                viewId,
                configurationRevision,
                metadataRevision,
                generation,
            }),
            searchTerm: frame.searchTerm,
        });
    } catch {
        return null;
    }
}

function sameFrame(
    captured: PortalVisitorSearchFrame,
    current: PortalVisitorSearchFrame | null
) {
    if (!current || captured.searchTerm !== current.searchTerm) return false;
    const a = captured.stamp;
    const b = current.stamp;
    return (
        a.sessionId === b.sessionId &&
        a.fieldId === b.fieldId &&
        a.viewId === b.viewId &&
        a.configurationRevision === b.configurationRevision &&
        a.metadataRevision === b.metadataRevision &&
        a.generation === b.generation
    );
}

export function createPortalVisitorSearchDraft(port: PortalVisitorSearchPort) {
    const frame = readFrame(port);
    if (!frame) return null;
    const current = () => sameFrame(frame, readFrame(port));
    return {
        frame,
        current,
        async submit(
            intent: PortalVisitorSearchIntent
        ): Promise<PortalVisitorSearchOutcome> {
            if (!current()) return { type: 'stale' };
            const source = intent.source;
            const searchTerm = source === 'clear' ? '' : intent.searchTerm;
            if (
                (source !== 'submit' &&
                    source !== 'scan' &&
                    source !== 'clear') ||
                typeof searchTerm !== 'string'
            )
                return { type: 'refused' };

            try {
                const outcome = await port.apply({
                    stamp: { ...frame.stamp },
                    source,
                    expectedSearchTerm: frame.searchTerm,
                    searchTerm,
                });
                if (
                    outcome.type === 'allocated' &&
                    typeof outcome.requestId === 'string' &&
                    outcome.requestId.length > 0 &&
                    Number.isSafeInteger(outcome.generation) &&
                    outcome.generation >= frame.stamp.generation
                )
                    return {
                        type: 'allocated',
                        requestId: outcome.requestId,
                        generation: outcome.generation,
                    };
                if (outcome.type === 'stale') return { type: 'stale' };
                if (
                    outcome.type === 'refused' ||
                    outcome.type === 'uncertain'
                ) {
                    const generation = outcome.committedGeneration;
                    if (generation === undefined) return { type: outcome.type };
                    if (
                        Number.isSafeInteger(generation) &&
                        generation >= frame.stamp.generation
                    )
                        return {
                            type: outcome.type,
                            committedGeneration: generation,
                        };
                }
            } catch {
                // An exception does not establish whether transport was invoked.
            }
            return { type: 'uncertain' };
        },
    };
}
