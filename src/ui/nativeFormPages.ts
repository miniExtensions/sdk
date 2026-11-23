export type NativeFormPageDescriptor = Readonly<{
    title: string | null;
    description: string | null;
    fieldIds: readonly string[];
    hidden: boolean;
}>;

/** Host publications contain presentation and existing native action ports only. */
export type NativeFormPagesPublication<T> = Readonly<{
    owner: unknown;
    configuration: unknown;
    pages: readonly NativeFormPageDescriptor[];
    multiple: boolean;
    /** Builder previews keep their existing authoritative page selection. */
    controlledPageIndex?: number;
    reviewItems: readonly T[];
    isCurrent(): boolean;
    /** The host owns validation and Compute. Advance only after its admission. */
    onNext(args: { pageIndex: number; advance(): void }): void;
    /** Receives the destination visible page index. */
    onBack?(pageIndex: number): void;
}>;

export type NativeFormPagesActions = Readonly<{
    back(): void;
    next(): void;
    /** Reports whether this action opened a new Review. */
    openReview(submit: () => unknown): boolean;
    dismissReview(): void;
    confirmReview(): unknown;
}>;

export type NativeFormPagesSnapshot<T> = Readonly<{
    pages: readonly NativeFormPageDescriptor[];
    activePageIndex: number;
    isFirstPage: boolean;
    isLastPage: boolean;
    reviewItems: readonly T[];
    reviewing: boolean;
    retired: boolean;
    actions: NativeFormPagesActions;
}>;

export type NativeFormPages<T> = NativeFormPagesActions & {
    getSnapshot(): NativeFormPagesSnapshot<T>;
    subscribe(listener: () => void): () => void;
    update(publication: NativeFormPagesPublication<T>): void;
    dispose(): void;
};

type Review = Readonly<{ submit: () => unknown }>;

function copyPublication<T>(
    publication: NativeFormPagesPublication<T>
): NativeFormPagesPublication<T> {
    return {
        ...publication,
        pages: Object.freeze(
            publication.pages.map((page) =>
                Object.freeze({
                    title: page.title,
                    description: page.description,
                    fieldIds: Object.freeze([...page.fieldIds]),
                    hidden: page.hidden,
                })
            )
        ),
        // Items are opaque admitted host values, not another canonical draft.
        reviewItems: Object.freeze([...publication.reviewItems]),
    };
}

function samePages(
    left: readonly NativeFormPageDescriptor[],
    right: readonly NativeFormPageDescriptor[]
): boolean {
    return (
        left.length === right.length &&
        left.every((page, index) => {
            const next = right[index]!;
            return (
                page.title === next.title &&
                page.description === next.description &&
                page.hidden === next.hidden &&
                page.fieldIds.length === next.fieldIds.length &&
                page.fieldIds.every((id, i) => id === next.fieldIds[i])
            );
        })
    );
}

function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
    return (
        left.length === right.length &&
        left.every((item, index) => Object.is(item, right[index]))
    );
}

const firstVisible = (pages: readonly NativeFormPageDescriptor[]) =>
    pages.findIndex((page) => !page.hidden);

const lastVisible = (pages: readonly NativeFormPageDescriptor[]) => {
    for (let index = pages.length - 1; index >= 0; index--)
        if (!pages[index]!.hidden) return index;
    return -1;
};

/**
 * One live presentation lifecycle over native Form authority. Review keeps its
 * captured one-shot callback while current host publications update its rows.
 * No draft, validation, pending-input inference or Save settlement lives here.
 */
export function createNativeFormPages<T>(
    initial: NativeFormPagesPublication<T>
): NativeFormPages<T> {
    const owner = initial.owner;
    const configuration = initial.configuration;
    let publication = copyPublication(initial);
    let internalPageIndex = 0;
    let navigation = 0;
    let review: Review | null = null;
    let retired = false;
    let checking = false;
    let emitting = false;
    let notificationPending = false;
    let cached: NativeFormPagesSnapshot<T> | undefined;
    let cachedNavigation = -1;
    let cachedReview: Review | null = null;
    const listeners = new Set<() => void>();

    const activeIndex = (): number => {
        if (publication.pages.length === 0) return 0;
        if (publication.controlledPageIndex !== undefined)
            return Math.min(
                Math.max(publication.controlledPageIndex, 0),
                publication.pages.length - 1
            );
        const first = firstVisible(publication.pages);
        if (first < 0) return 0;
        if (!publication.multiple) return first;
        const index = Math.min(
            Math.max(internalPageIndex, 0),
            publication.pages.length - 1
        );
        return publication.pages[index]!.hidden ? first : index;
    };

    const retire = () => {
        if (retired) return;
        retired = true;
        review = null;
        navigation++;
    };

    const current = (): boolean => {
        if (retired) return false;
        // A native admission callback may reenter a retained action. Its outer
        // decision is not known yet, so nested actions cannot borrow admission.
        if (checking) return false;
        checking = true;
        try {
            if (!publication.isCurrent()) retire();
        } catch {
            retire();
        } finally {
            checking = false;
        }
        return !retired;
    };

    const notify = () => {
        notificationPending = true;
        if (emitting) return;
        emitting = true;
        try {
            // A subscriber may publish another value or retire the owner.
            for (let pass = 0; notificationPending && pass < 16; pass++) {
                notificationPending = false;
                for (const listener of [...listeners]) {
                    if (!listeners.has(listener)) continue;
                    try {
                        listener();
                    } catch {
                        // A renderer cannot take ownership of this lifecycle.
                    }
                }
            }
        } finally {
            emitting = false;
        }
    };

    const allowed = (expectedNavigation: number): boolean => {
        const live = current();
        publish();
        return live && navigation === expectedNavigation;
    };

    const dismiss = (expected: Review | null) => {
        if (!current() || expected == null || review !== expected) {
            publish();
            return;
        }
        review = null;
        navigation++;
        publish();
    };

    const confirm = (expected: Review | null): unknown => {
        if (!current() || expected == null || review !== expected) {
            publish();
            return;
        }
        // Consume before publication or native invocation, including reentry.
        review = null;
        navigation++;
        publish();
        if (!current()) {
            publish();
            return;
        }
        // Native owns queued admission, latest payload and allocated settlement.
        return expected.submit();
    };

    const open = (expectedNavigation: number, submit: () => unknown) => {
        if (!allowed(expectedNavigation) || review != null) return false;
        review = Object.freeze({ submit });
        navigation++;
        publish();
        return true;
    };

    const back = (expectedNavigation: number) => {
        if (!allowed(expectedNavigation) || review != null) return;
        const active = activeIndex();
        let target = -1;
        for (let index = active - 1; index >= 0; index--) {
            if (!publication.pages[index]!.hidden) {
                target = index;
                break;
            }
        }
        if (!publication.multiple || target < 0) return;
        const ticket = ++navigation;
        if (publication.controlledPageIndex === undefined)
            internalPageIndex = target;
        const onBack = publication.onBack;
        publish();
        if (allowed(ticket)) onBack?.(target);
    };

    const next = (expectedNavigation: number) => {
        if (!allowed(expectedNavigation) || review != null) return;
        const pageIndex = activeIndex();
        if (
            !publication.multiple ||
            !publication.pages.some(
                (page, index) => index > pageIndex && !page.hidden
            )
        )
            return;
        const ticket = ++navigation;
        const onNext = publication.onNext;
        let used = false;
        publish();
        if (!allowed(ticket)) return;
        onNext({
            pageIndex,
            advance() {
                if (used) return;
                used = true;
                if (!allowed(ticket) || review != null) return;
                const target = publication.pages.findIndex(
                    (page, index) => index > pageIndex && !page.hidden
                );
                if (target < 0) return;
                navigation++;
                if (publication.controlledPageIndex === undefined)
                    internalPageIndex = target;
                publish();
            },
        });
    };

    function publish() {
        const pages = retired ? Object.freeze([]) : publication.pages;
        const items = retired ? Object.freeze([]) : publication.reviewItems;
        const index = retired ? 0 : activeIndex();
        if (
            cached &&
            cachedNavigation === navigation &&
            cachedReview === review &&
            cached.retired === retired &&
            cached.activePageIndex === index &&
            samePages(cached.pages, pages) &&
            sameItems(cached.reviewItems, items)
        )
            return;
        const expectedNavigation = navigation;
        const expectedReview = review;
        cachedNavigation = navigation;
        cachedReview = review;
        cached = Object.freeze({
            pages,
            activePageIndex: index,
            isFirstPage:
                !publication.multiple ||
                index === Math.max(firstVisible(pages), 0),
            isLastPage:
                !publication.multiple ||
                index === Math.max(lastVisible(pages), 0),
            reviewItems: items,
            reviewing: review != null,
            retired,
            actions: Object.freeze({
                back: () => back(expectedNavigation),
                next: () => next(expectedNavigation),
                openReview: (submit: () => unknown) =>
                    open(expectedNavigation, submit),
                dismissReview: () => dismiss(expectedReview),
                confirmReview: () => confirm(expectedReview),
            }),
        });
        notify();
    }

    current();
    publish();
    return {
        getSnapshot() {
            // React render reads are inert. Actions and committed publications
            // are the observation boundaries for native currentness.
            return cached!;
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        update(nextPublication) {
            if (!current()) {
                publish();
                return;
            }
            if (
                !Object.is(nextPublication.owner, owner) ||
                !Object.is(nextPublication.configuration, configuration)
            ) {
                retire();
                publish();
                return;
            }
            const previousIndex = activeIndex();
            const structureChanged =
                !samePages(publication.pages, nextPublication.pages) ||
                publication.multiple !== nextPublication.multiple ||
                publication.controlledPageIndex !==
                    nextPublication.controlledPageIndex;
            publication = copyPublication(nextPublication);
            internalPageIndex = previousIndex;
            current();
            const normalizedIndex = activeIndex();
            internalPageIndex = normalizedIndex;
            if (structureChanged || normalizedIndex !== previousIndex)
                navigation++;
            publish();
        },
        // A retained public action has the same lease as its originating view.
        get back() {
            return cached!.actions.back;
        },
        get next() {
            return cached!.actions.next;
        },
        get openReview() {
            return cached!.actions.openReview;
        },
        get dismissReview() {
            return cached!.actions.dismissReview;
        },
        get confirmReview() {
            return cached!.actions.confirmReview;
        },
        dispose() {
            retire();
            publish();
            listeners.clear();
        },
    };
}
