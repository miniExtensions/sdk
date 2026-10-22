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
    commit(request: Request): Promise<Result>;
    committedValue(result: Result, cell: PortalInlineEditCell): Value;
};
export type PortalInlineEditQueue<Value, Request, Result> = {
    enqueue(edit: PortalInlineEdit<Value, Request, Result>): boolean;
    /** Dispatch the current batch; later intents retain their own zero-delay batch. */
    flush(): Promise<void>;
    hasPending(): boolean;
    /** Retire admission and undispatched work. Started writes still settle. */
    dispose(): void;
};

type Draft<Value> = { committedValue: Value; revision: number };
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

/** Session-owned pending drafts and conditional recovery, with injected transport.
 * Native optimistic values live in the injected host writer, never a second store.
 * A new enqueue is a new explicit intent, including A → B → A. An error never
 * schedules its failed request again. Host authorization and feedback stay host-owned.
 */
export function createPortalInlineEditQueue<Value, Request, Result>(
    options: PortalInlineEditQueueOptions<Value, Request, Result>
): PortalInlineEditQueue<Value, Request, Result> {
    const drafts = new Map<string, Draft<Value>>();
    const pending = new Map<
        string,
        { edit: PortalInlineEdit<Value, Request, Result>; revision: number }
    >();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let flight: Promise<void> | null = null;
    let disposed = false;
    const discard = (key: string) => {
        drafts.delete(key);
    };
    const clearTimer = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
    };
    const schedule = (delay = 1_000) => {
        clearTimer();
        timer = setTimeout(() => {
            void queue.flush();
        }, delay);
    };
    const drain = async () => {
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
            } catch (error) {
                feedback(() => edit.onError(error));
                // Do not use value equality: a newer A after B is still newer.
                if (!pending.has(key) && draft.revision === revision)
                    feedback(() =>
                        edit.applyValue(structuredClone(draft.committedValue))
                    );
                if (!pending.has(key)) discard(key);
                continue;
            }
            // Transport has committed. Retain the submitted native value if
            // projecting the canonical receipt fails; feedback cannot roll it
            // back or leave a stale baseline for a later explicit edit.
            draft.committedValue = edit.value;
            try {
                draft.committedValue = structuredClone(
                    options.committedValue(result, edit.cell)
                );
            } catch (error) {
                feedback(() => edit.onError(error));
            }
            feedback(() => edit.onCommitted(result));
            if (!pending.has(key)) discard(key);
        }
        if (finalEdit) feedback(() => finalEdit.onBatchSettled());
        flight = null;
        if (pending.size > 0 && !disposed) {
            schedule(0);
            return;
        }
        // hasPending must be false inside onIdle, as in the host queue.
        if (disposed) for (const key of drafts.keys()) discard(key);
        if (finalEdit) feedback(() => finalEdit.onIdle());
    };
    const queue: PortalInlineEditQueue<Value, Request, Result> = {
        enqueue: (edit) => {
            if (disposed) return false;
            const key = cellKey(edit.cell);
            let draft = drafts.get(key);
            if (!draft) {
                draft = {
                    committedValue: structuredClone(edit.committedValue),
                    revision: 0,
                };
                drafts.set(key, draft);
            }
            draft.revision += 1;
            pending.set(key, {
                edit: {
                    ...edit,
                    cell: { ...edit.cell },
                    value: structuredClone(edit.value),
                    request: structuredClone(edit.request),
                },
                revision: draft.revision,
            });
            feedback(() => edit.applyValue(structuredClone(edit.value)));
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
