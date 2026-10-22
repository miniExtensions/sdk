import { FormDraftStore, type FormDraftHandle } from '../forms/drafts.js';

export type PortalInlineEditCell = {
    tableId: string;
    recordId: string;
    fieldId: string;
};
export type PortalInlineEdit<Value, Request, Result> = {
    cell: PortalInlineEditCell;
    committedValue: Value;
    value: Value;
    request: Request;
    applyValue(value: Value): void;
    onCommitted(result: Result): void;
    onError(error: unknown): void;
    onBatchSettled(): void;
    onIdle(): void;
};
export type PortalInlineEditQueueOptions<Value, Request, Result> = {
    /** One store per session owner. It may be shared with cell bindings. */
    store?: FormDraftStore<Value>;
    commit(request: Request): Promise<Result>;
    committedValue(result: Result, cell: PortalInlineEditCell): Value;
};
export type PortalInlineEditQueue<Value, Request, Result> = {
    enqueue(edit: PortalInlineEdit<Value, Request, Result>): boolean;
    /** Dispatch explicit pending intents; never replay a failed request. */
    flush(): Promise<void>;
    hasPending(): boolean;
    /** Retire admission and undispatched work. Started writes still settle. */
    dispose(): void;
};

type Draft<Value> = { handle: FormDraftHandle; committedValue: Value };
const cellKey = (cell: PortalInlineEditCell) =>
    JSON.stringify([cell.tableId, cell.recordId, cell.fieldId]);
// Presentation failures must not reclassify an accepted mutation or stop draining.
const feedback = (callback: () => void) => {
    try {
        callback();
    } catch {
        /* The session mutation owner outlives its presentation. */
    }
};

/** Session-owned native drafts and conditional recovery, with injected transport.
 * A new enqueue is a new explicit intent, including A → B → A. An error never
 * schedules its failed request again. Host authorization and feedback stay host-owned.
 */
export function createPortalInlineEditQueue<Value, Request, Result>(
    options: PortalInlineEditQueueOptions<Value, Request, Result>
): PortalInlineEditQueue<Value, Request, Result> {
    const store = options.store ?? new FormDraftStore<Value>();
    const drafts = new Map<string, Draft<Value>>();
    const pending = new Map<
        string,
        { edit: PortalInlineEdit<Value, Request, Result>; revision: number }
    >();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let flight: Promise<void> | null = null;
    let disposed = false;
    const discard = (key: string) => {
        const draft = drafts.get(key);
        if (draft) store.discard(draft.handle);
        drafts.delete(key);
    };
    const clearTimer = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
    const schedule = () => {
        clearTimer();
        timer = setTimeout(() => {
            void queue.flush();
        }, 1_000);
    };
    const drain = async () => {
        while (pending.size > 0 && !disposed) {
            const edits = [...pending.entries()];
            pending.clear();
            let finalEdit: PortalInlineEdit<Value, Request, Result> | undefined;
            for (const [key, { edit, revision }] of edits) {
                if (disposed) {
                    discard(key);
                    continue;
                }
                finalEdit = edit;
                const draft = drafts.get(key)!;
                let result: Result;
                try {
                    result = await options.commit(edit.request);
                    draft.committedValue = structuredClone(
                        options.committedValue(result, edit.cell)
                    );
                } catch (error) {
                    feedback(() => edit.onError(error));
                    // Do not use value equality: a newer A after B is still newer.
                    if (
                        !pending.has(key) &&
                        store.revision(draft.handle) === revision
                    )
                        feedback(() =>
                            edit.applyValue(
                                structuredClone(draft.committedValue)
                            )
                        );
                    if (!pending.has(key)) discard(key);
                    continue;
                }
                store.markSaved(draft.handle, revision);
                feedback(() => edit.onCommitted(result));
                if (!pending.has(key)) discard(key);
            }
            if (finalEdit) feedback(() => finalEdit.onBatchSettled());
            if (pending.size === 0 || disposed) {
                // hasPending must be false inside onIdle, as in the host queue.
                if (disposed) for (const key of drafts.keys()) discard(key);
                flight = null;
                if (finalEdit) feedback(() => finalEdit.onIdle());
                return;
            }
        }
    };
    const queue: PortalInlineEditQueue<Value, Request, Result> = {
        enqueue: (edit) => {
            if (disposed) return false;
            const key = cellKey(edit.cell);
            let draft = drafts.get(key);
            if (!draft) {
                draft = {
                    handle: store.open(
                        {
                            extensionId: key,
                            recordId: edit.cell.recordId,
                            parent: null,
                        },
                        { [edit.cell.fieldId]: edit.committedValue },
                        []
                    ),
                    committedValue: structuredClone(edit.committedValue),
                };
                drafts.set(key, draft);
            }
            store.write(draft.handle, edit.cell.fieldId, edit.value);
            pending.set(key, {
                edit: {
                    ...edit,
                    cell: { ...edit.cell },
                    request: structuredClone(edit.request),
                },
                revision: store.revision(draft.handle)!,
            });
            feedback(() =>
                edit.applyValue(store.read(draft.handle, edit.cell.fieldId)!)
            );
            if (!disposed && !flight) schedule();
            return true;
        },
        flush: () => {
            clearTimer();
            if (flight) return flight;
            if (disposed || pending.size === 0) return Promise.resolve();
            let resolve!: () => void;
            let reject!: (error: unknown) => void;
            const saving = new Promise<void>((yes, no) => {
                resolve = yes;
                reject = no;
            });
            flight = saving;
            void drain().then(resolve, reject);
            return saving;
        },
        hasPending: () => flight !== null || pending.size > 0,
        dispose: () => {
            disposed = true;
            clearTimer();
            pending.clear();
            if (!flight) for (const key of drafts.keys()) discard(key);
        },
    };
    return queue;
}
