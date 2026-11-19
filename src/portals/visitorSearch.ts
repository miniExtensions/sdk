import type { PortalVisitorSortStamp } from './visitorSort.js';

/** Search and Sort use the same Portal collection owner. */
export type PortalVisitorSearchStamp = PortalVisitorSortStamp;

export type PortalVisitorSearchFrame = Readonly<{
    stamp: PortalVisitorSearchStamp;
    searchTerm: string;
    /** Advances when the committed term changes, including A → B → A. */
    publicationRevision: number;
}>;

export type PortalVisitorSearchIntent =
    | Readonly<{ source: 'submit' | 'scan'; searchTerm: string }>
    | Readonly<{ source: 'clear' }>;

export type PortalVisitorSearchCommand = Readonly<{
    stamp: PortalVisitorSearchStamp;
    source: PortalVisitorSearchIntent['source'];
    expectedSearchTerm: string;
    expectedPublicationRevision: number;
    searchTerm: string;
}>;

export type PortalVisitorSearchPublication = Readonly<{
    generation: number;
    revision: number;
}>;

export type PortalVisitorSearchOutcome =
    | Readonly<{
          type: 'allocated';
          requestId: string;
          generation: number;
          committedPublication?: PortalVisitorSearchPublication;
      }>
    | Readonly<{ type: 'stale' }>
    | Readonly<{
          type: 'refused' | 'uncertain';
          committedPublication?: PortalVisitorSearchPublication;
      }>;

export type PortalVisitorSearchPort = {
    read(): PortalVisitorSearchFrame | null;
    /**
     * Check the captured owner, term and publication before writing anything.
     * Request the first page even when the new term equals the current term.
     * Report allocation only after the authorized transport is invoked.
     * If this command changes the term, report its own verified publication
     * with the outcome. A same-term allocation can identify its live generation
     * without a publication receipt. Never attribute a later frame to it.
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

export function readPortalVisitorSearchFrame(
    port: PortalVisitorSearchPort
): PortalVisitorSearchFrame | null | undefined {
    let frame: PortalVisitorSearchFrame | null;
    try {
        frame = port.read();
    } catch {
        // An unavailable read provides no evidence of a replacement frame.
        return undefined;
    }
    try {
        if (!frame) return null;
        const { searchTerm, publicationRevision } = frame;
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
            generation < 0 ||
            typeof searchTerm !== 'string' ||
            !Number.isSafeInteger(publicationRevision) ||
            publicationRevision < 0
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
            searchTerm,
            publicationRevision,
        });
    } catch {
        return null;
    }
}

export function samePortalVisitorSearchScope(
    a: PortalVisitorSearchStamp,
    b: PortalVisitorSearchStamp
) {
    return (
        a.sessionId === b.sessionId &&
        a.fieldId === b.fieldId &&
        a.viewId === b.viewId &&
        a.configurationRevision === b.configurationRevision &&
        a.metadataRevision === b.metadataRevision
    );
}

export function capturePortalVisitorSearchDraft(
    port: PortalVisitorSearchPort,
    frame: PortalVisitorSearchFrame
) {
    let retired = false;
    const observe = (live: ReturnType<typeof readPortalVisitorSearchFrame>) => {
        if (retired || live === undefined) return false;
        retired =
            !live ||
            live.publicationRevision !== frame.publicationRevision ||
            live.searchTerm !== frame.searchTerm ||
            live.stamp.generation !== frame.stamp.generation ||
            !samePortalVisitorSearchScope(frame.stamp, live.stamp);
        return !retired;
    };
    const current = () =>
        !retired && observe(readPortalVisitorSearchFrame(port));
    return {
        frame,
        current,
        observe,
        async submit(
            intent: PortalVisitorSearchIntent,
            onAdmitted?: () => void
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
                onAdmitted?.();
                const outcome = await port.apply({
                    stamp: { ...frame.stamp },
                    source,
                    expectedSearchTerm: frame.searchTerm,
                    expectedPublicationRevision: frame.publicationRevision,
                    searchTerm,
                });
                if (outcome.type === 'stale') return { type: 'stale' };
                const publication = outcome.committedPublication;
                let committedPublication:
                    | PortalVisitorSearchPublication
                    | undefined;
                if (publication !== undefined) {
                    const { generation, revision } = publication;
                    if (
                        !Number.isSafeInteger(generation) ||
                        generation < frame.stamp.generation ||
                        !Number.isSafeInteger(revision) ||
                        revision < frame.publicationRevision ||
                        (revision === frame.publicationRevision &&
                            (generation === frame.stamp.generation ||
                                searchTerm !== frame.searchTerm)) ||
                        (outcome.type === 'allocated' &&
                            outcome.generation !== generation)
                    )
                        return { type: 'uncertain' };
                    committedPublication = Object.freeze({
                        generation,
                        revision,
                    });
                }
                const receipt = committedPublication
                    ? { committedPublication }
                    : {};
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
                        ...receipt,
                    };
                if (outcome.type === 'refused' || outcome.type === 'uncertain')
                    return { type: outcome.type, ...receipt };
            } catch {
                // An exception does not establish whether transport was invoked.
            }
            return { type: 'uncertain' };
        },
    };
}

export function createPortalVisitorSearchDraft(port: PortalVisitorSearchPort) {
    const frame = readPortalVisitorSearchFrame(port);
    if (!frame) return null;
    const { current, submit } = capturePortalVisitorSearchDraft(port, frame);
    return {
        frame,
        current,
        submit: (intent: PortalVisitorSearchIntent) => submit(intent),
    };
}
