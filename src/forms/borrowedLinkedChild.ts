/** Opaque native identities/revisions. These are lifecycle checks, never server authority. */
export type BorrowedLinkedChildScope = {
    source: readonly unknown[];
    /** Null before a native draft is loaded. Do not copy or reconstruct its values. */
    draft: readonly unknown[] | null;
};
const readBrand = Symbol('borrowed-child-read');
const saveBrand = Symbol('borrowed-child-save');
export type BorrowedLinkedChildRead = Readonly<{ [readBrand]: true }>;
export type BorrowedLinkedChildSave = Readonly<{ [saveBrand]: true }>;
export type BorrowedLinkedChildController = {
    captureRead(): BorrowedLinkedChildRead | null;
    /** Guard the actual synchronous native acceptance, not a claimed SDK load. */
    acceptRead(
        read: BorrowedLinkedChildRead,
        publish: (isCurrent: () => boolean) => boolean
    ): boolean;
    /** An accepted read can present subsequent edits to that same native draft. */
    canPresent(read: BorrowedLinkedChildRead): boolean;
    captureSave(): BorrowedLinkedChildSave | null;
    /** Only an actually accepted current read admits delegation. Native Save owns allocation/retry/settlement. */
    save<T>(
        intent: BorrowedLinkedChildSave,
        allocate: () => Promise<T>
    ): Promise<{ type: 'retired' } | { type: 'settled'; value: T }>;
    dispose(): void;
};
const same = (a: readonly unknown[], b: readonly unknown[]) =>
    a.length === b.length &&
    a.every((part, index) => Object.is(part, b[index]));

/**
 * Borrows actual host publications and draft revisions. No client, transport,
 * draft store, recovery journal, automatic read/Save or relationship writer.
 * The host must advance source identities for observed replacement/ABA and draft
 * revisions for every accepted edit, including equal-value intent.
 */
export function createBorrowedLinkedChildController(options: {
    readScope(): BorrowedLinkedChildScope | null;
}): BorrowedLinkedChildController {
    let disposed = false;
    let acceptedSource: readonly unknown[] | null = null;
    const reads = new WeakMap<
        BorrowedLinkedChildRead,
        { scope: BorrowedLinkedChildScope; used: boolean; accepted: boolean }
    >();
    const saves = new WeakMap<
        BorrowedLinkedChildSave,
        { scope: BorrowedLinkedChildScope; used: boolean }
    >();
    const capture = (): BorrowedLinkedChildScope | null => {
        if (disposed) return null;
        try {
            const scope = options.readScope();
            if (
                !scope ||
                !Array.isArray(scope.source) ||
                scope.source.length === 0 ||
                (scope.draft !== null && !Array.isArray(scope.draft))
            )
                return null;
            return {
                source: [...scope.source],
                draft: scope.draft === null ? null : [...scope.draft],
            };
        } catch {
            return null;
        }
    };
    const current = (scope: BorrowedLinkedChildScope, draft: boolean) => {
        const now = capture();
        return (
            now !== null &&
            same(scope.source, now.source) &&
            (!draft ||
                (scope.draft === null
                    ? now.draft === null
                    : now.draft !== null && same(scope.draft, now.draft)))
        );
    };
    return {
        captureRead() {
            const scope = capture();
            if (!scope) return null;
            const ticket = { [readBrand]: true } as const;
            reads.set(ticket, { scope, used: false, accepted: false });
            return ticket;
        },
        acceptRead(ticket, publish) {
            const read = reads.get(ticket);
            if (!read || read.used || !current(read.scope, true)) return false;
            read.used = true;
            const guard = () => current(read.scope, true);
            // A synchronous native publication may itself install the draft.
            read.accepted = publish(guard) === true;
            const accepted = read.accepted && current(read.scope, false);
            if (accepted) acceptedSource = read.scope.source;
            return accepted;
        },
        canPresent(ticket) {
            const read = reads.get(ticket);
            return (
                read !== undefined &&
                (!read.used || read.accepted) &&
                current(read.scope, !read.accepted)
            );
        },
        captureSave() {
            const scope = capture();
            if (
                !scope ||
                scope.draft === null ||
                acceptedSource === null ||
                !same(scope.source, acceptedSource)
            )
                return null;
            const ticket = { [saveBrand]: true } as const;
            saves.set(ticket, { scope, used: false });
            return ticket;
        },
        async save(ticket, allocate) {
            const save = saves.get(ticket);
            if (!save || save.used || !current(save.scope, true))
                return { type: 'retired' };
            save.used = true;
            // Do not check current/disposed after handing off. The original
            // native operation owns its outcome, parent reconciliation and cleanup.
            return { type: 'settled', value: await allocate() };
        },
        dispose() {
            disposed = true;
        },
    };
}
