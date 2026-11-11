import type {
    AddRecordCommentInput,
    ListRecordCommentsInput,
    ListRecordCommentsResult,
    RuntimeAirtableComment,
} from '../runtime/types.js';

/** Canonical wire union, including verified native actor attribution. */
export type RecordComment = RuntimeAirtableComment;

/** Preserves the native Tables presenter, including legacy alias grammar. */
export function presentRecordComment(comment: RecordComment) {
    const noMentions: Record<string, string> = {};
    if ('actor' in comment)
        return {
            author: comment.authorLabel,
            text: comment.text,
            mentions: noMentions,
        };
    const alias = comment.text.match(/{{(.*?)}}:/)?.[1] ?? null;
    return {
        author: alias ?? comment.author.name ?? comment.author.email,
        text:
            alias === null
                ? comment.text
                : comment.text.substring(`{{${alias}}}: `.length),
        mentions: Object.fromEntries(
            Object.entries(comment.mentioned ?? {}).map(([id, entry]) => [
                id,
                entry.type === 'user'
                    ? (entry.name ?? entry.email)
                    : entry.name,
            ])
        ),
    };
}

export type RecordCommentsSnapshot = Readonly<{
    readStatus: 'idle' | 'loading' | 'ready' | 'error';
    /** Retained internally during refresh/error; UI must use readStatus. */
    history: readonly RecordComment[];
    nextCursor: ListRecordCommentsResult['nextCursor'];
    disableSending: boolean;
    draft: string;
    sending: boolean;
    loadingOlder: boolean;
    readError: Error | null;
    olderError: Error | null;
    sendError: Error | null;
    retired: boolean;
}>;

export type RecordCommentsControllerOptions = {
    /** A real captured owner. Replacements require a new controller. */
    owner: { isCurrent(): boolean };
    childExtensionAccessToken: string;
    list(input: ListRecordCommentsInput): Promise<ListRecordCommentsResult>;
    /** Must reject failures. Catch-and-resolve mutation wrappers are unsuitable. */
    append(input: AddRecordCommentInput): Promise<unknown>;
    /** Always receives the original admitted query, even after UI retirement. */
    invalidate(input: ListRecordCommentsInput): void | Promise<unknown>;
    /** Host's single normalized error/plan-limit presenter. Never a send receipt. */
    onAppendError?(error: unknown): void;
    onPresentationError?(error: unknown): void;
};

export type RecordCommentsController = ReturnType<
    typeof createRecordCommentsController
>;

const normalized = (error: unknown) =>
    error instanceof Error ? error : new Error(String(error));

/**
 * No I/O at construction, automatic retries, optimistic rows or mutation aborts.
 * UI subscriptions do not own an allocated append. Dispose retires admission,
 * while that append still settles against its captured query/cache authority.
 */
export function createRecordCommentsController(
    options: RecordCommentsControllerOptions
) {
    const {
        owner,
        list,
        append,
        invalidate,
        onAppendError,
        onPresentationError,
    } = options;
    const query = {
        childExtensionAccessToken: options.childExtensionAccessToken,
    };
    let state: RecordCommentsSnapshot = Object.freeze({
        readStatus: 'idle',
        history: Object.freeze([]),
        nextCursor: undefined,
        disableSending: false,
        draft: '',
        sending: false,
        loadingOlder: false,
        readError: null,
        olderError: null,
        sendError: null,
        retired: false,
    });
    let readGeneration = 0;
    let historyEpoch = 0;
    let draftGeneration = 0;
    let newest: ListRecordCommentsResult | null = null;
    const listeners = new Set<() => void>();
    const current = () => !state.retired && owner.isCurrent();
    const reportPresentation = (error: unknown) => {
        try {
            onPresentationError?.(error);
        } catch {
            // A presentation failure cannot change an allocated append receipt.
        }
    };
    const publish = (patch: Partial<RecordCommentsSnapshot>) => {
        state = Object.freeze({ ...state, ...patch });
        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                reportPresentation(error);
            }
        }
    };

    async function readNewest(afterAppend = false) {
        if (!current() || (!afterAppend && state.readStatus === 'loading'))
            return false;
        const generation = ++readGeneration;
        publish({
            readStatus: 'loading',
            readError: null,
            olderError: null,
            loadingOlder: false,
        });
        try {
            const page = await list({ ...query });
            if (!current() || generation !== readGeneration) return false;
            newest = { ...page };
            historyEpoch++;
            publish({
                readStatus: 'ready',
                history: Object.freeze([...page.comments]),
                nextCursor: page.nextCursor,
                disableSending: page.disableSending === true,
            });
            return true;
        } catch (error) {
            if (current() && generation === readGeneration)
                publish({ readStatus: 'error', readError: normalized(error) });
            return false;
        }
    }

    async function loadOlder() {
        if (
            !current() ||
            state.readStatus !== 'ready' ||
            state.loadingOlder ||
            state.nextCursor == null
        )
            return false;
        const generation = readGeneration;
        const epoch = historyEpoch;
        const cursor = state.nextCursor;
        publish({ loadingOlder: true, olderError: null });
        try {
            const page = await list({ ...query, cursor });
            if (
                !current() ||
                generation !== readGeneration ||
                epoch !== historyEpoch ||
                state.readStatus !== 'ready'
            )
                return false;
            publish({
                history: Object.freeze([...page.comments, ...state.history]),
                nextCursor: page.nextCursor,
                loadingOlder: false,
            });
            return true;
        } catch (error) {
            if (
                current() &&
                generation === readGeneration &&
                epoch === historyEpoch
            )
                publish({ loadingOlder: false, olderError: normalized(error) });
            return false;
        }
    }

    async function send() {
        if (
            !current() ||
            state.readStatus !== 'ready' ||
            state.disableSending ||
            state.sending ||
            state.loadingOlder ||
            state.draft.length === 0 ||
            newest === null
        )
            return false;
        const draft = state.draft;
        const generation = draftGeneration;
        const prefix = newest.readableVersionOfRecordPrimaryValue;
        const input: AddRecordCommentInput = {
            ...query,
            comment:
                newest.includeCommenterPrefix !== false && prefix !== null
                    ? `{{${prefix}}}: ${draft}`
                    : draft,
        };
        // Synchronous admission precedes transport and any reentrant observer.
        publish({ sending: true, sendError: null });
        try {
            await append(input);
        } catch (error) {
            if (current()) {
                publish({ sending: false, sendError: normalized(error) });
                try {
                    onAppendError?.(error);
                } catch (presentationError) {
                    reportPresentation(presentationError);
                }
            }
            return false;
        }

        // The append is accepted. Everything below is a separate operation.
        if (current()) {
            const matching =
                draftGeneration === generation && state.draft === draft;
            if (matching) draftGeneration++;
            publish({ sending: false, ...(matching ? { draft: '' } : {}) });
        }
        // Do not hold the admitted append receipt open on cache/read work.
        // A stalled refresh is still a completed append, never a replay lease.
        void (async () => {
            try {
                await invalidate({ ...query });
            } catch (error) {
                reportPresentation(error);
            }
            if (current()) await readNewest(true);
        })().catch(reportPresentation);
        return true;
    }

    return {
        getSnapshot: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        start() {
            if (state.readStatus === 'idle') return readNewest();
            return Promise.resolve(false);
        },
        refresh: () => readNewest(),
        loadOlder,
        setDraft(value: string) {
            if (!current() || value === state.draft) return;
            draftGeneration++;
            publish({ draft: value, sendError: null });
        },
        send,
        dispose() {
            readGeneration++;
            publish({ retired: true });
            listeners.clear();
        },
    };
}
