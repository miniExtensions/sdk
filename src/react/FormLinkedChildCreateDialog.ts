import {
    createElement as h,
    lazy,
    Suspense,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type FormEvent,
    type KeyboardEvent,
    type ReactElement,
    type ReactNode,
    type Ref,
    type SyntheticEvent,
} from 'react';
import type { FormFieldBindings } from '../forms/bindings.js';
import type {
    FormLinkedChildOwner,
    FormLinkedChildSnapshot,
} from '../forms/linkedChild.js';
import type { FormPageOwner } from '../forms/pages.js';

export type FormLinkedChildCreateOpening = Readonly<{
    /** The exact button that began this explicit Create. */
    opener: HTMLButtonElement;
    /** The child returned by the owner's accepted Create snapshot. */
    child: FormFieldBindings;
    /** The parent must retire this opening when its owner or trigger changes. */
    isCurrent(): boolean;
}>;

export type FormLinkedChildCreateDialogProps = Readonly<{
    owner: FormLinkedChildOwner;
    opening: FormLinkedChildCreateOpening;
    renderFields(fields: FormFieldBindings, pages: FormPageOwner): ReactNode;
    labels?: Partial<typeof defaultLabels>;
}>;

type LinkedChildDialogProps = FormLinkedChildCreateDialogProps & {
    editRecordId?: string;
};

const defaultLabels = {
    title: 'Create linked record',
    save: 'Save',
    incomplete: 'Complete the child Form before saving.',
    close: 'Close',
    discardQuestion: 'Close without saving this linked record?',
    keepEditing: 'Keep editing',
    confirmClose: 'Close without saving',
};

const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

// The general React entry remains importable before the host boots a DOM.
const LinkedChildDialogPortal = lazy(async () => {
    const { createPortal } = await import('react-dom');
    return {
        default: ({
            children,
            container,
        }: {
            children?: ReactNode;
            container: HTMLElement;
        }) => createPortal(children, container),
    };
});

function isVisible(element: HTMLElement): boolean {
    return (
        element.getClientRects().length > 0 &&
        element.ownerDocument.defaultView?.getComputedStyle(element)
            .visibility === 'visible'
    );
}

function tabStops(dialog: HTMLDialogElement): HTMLElement[] {
    return [
        ...dialog.querySelectorAll<HTMLElement>(
            'button,a[href],input,select,textarea,[contenteditable],[tabindex]'
        ),
    ].filter(
        (element) =>
            element.tabIndex >= 0 &&
            !element.matches(':disabled') &&
            !element.closest('[hidden],[inert]') &&
            isVisible(element)
    );
}

function matchesIntent(
    state: FormLinkedChildSnapshot,
    editRecordId: string | undefined
): boolean {
    if (editRecordId === undefined) return state.intent?.type === 'create';
    return (
        state.intent?.type === 'edit' && state.intent.recordId === editRecordId
    );
}

function useLinkedChildPresentation(owner: FormLinkedChildOwner) {
    const store = useMemo(() => {
        let snapshot = owner.getSnapshot();
        return {
            subscribe: (notify: () => void) => owner.subscribe(notify),
            getSnapshot: () => {
                const next = owner.getSnapshot();
                if (
                    next.revision !== snapshot.revision ||
                    next.phase !== snapshot.phase ||
                    next.child !== snapshot.child ||
                    next.pages !== snapshot.pages ||
                    next.error !== snapshot.error ||
                    next.intent?.type !== snapshot.intent?.type ||
                    (next.intent?.type === 'edit' &&
                        snapshot.intent?.type === 'edit' &&
                        next.intent.recordId !== snapshot.intent.recordId)
                )
                    snapshot = next;
                return snapshot;
            },
        };
    }, [owner]);
    return useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
}

/** Presents an already-opened one-page Create. The supplied owner retains its draft and Save. */
export function FormLinkedChildCreateDialog(
    props: FormLinkedChildCreateDialogProps
): ReactElement | null {
    return h(LinkedChildDialogPresentation, props);
}

export function LinkedChildDialogPresentation({
    owner,
    opening,
    renderFields,
    labels,
    editRecordId,
}: LinkedChildDialogProps): ReactElement | null {
    const state = useLinkedChildPresentation(owner);
    const [dismissedEdit, setDismissedEdit] = useState<{
        owner: FormLinkedChildOwner;
        child: FormFieldBindings;
        pages: FormPageOwner;
        recordId: string;
    } | null>(null);
    const { child, pages } = state;
    // A fresh admission creates fresh bindings and pages, even for the same record.
    const dismissed =
        state.phase === 'unknown' &&
        dismissedEdit?.owner === owner &&
        dismissedEdit.child === child &&
        dismissedEdit.pages === pages &&
        dismissedEdit.recordId === editRecordId;
    if (
        dismissed ||
        !opening.isCurrent() ||
        !matchesIntent(state, editRecordId) ||
        child !== opening.child ||
        !pages ||
        pages.getSnapshot().pages.length !== 1 ||
        !['ready', 'error', 'saving', 'unknown'].includes(state.phase)
    )
        return null;

    return h(
        Suspense,
        { fallback: null },
        h(
            LinkedChildDialogPortal,
            { container: opening.opener.ownerDocument.body },
            h(LinkedChildDialog, {
                owner,
                opening,
                state,
                child,
                pages,
                renderFields,
                labels,
                editRecordId,
                dismissUnknownEdit: (recordId: string) =>
                    setDismissedEdit({ owner, child, pages, recordId }),
            })
        )
    );
}

function LinkedChildDialog({
    owner,
    opening,
    state,
    child,
    pages,
    renderFields,
    labels: suppliedLabels,
    editRecordId,
    dismissUnknownEdit,
}: LinkedChildDialogProps & {
    state: FormLinkedChildSnapshot;
    child: FormFieldBindings;
    pages: FormPageOwner;
    dismissUnknownEdit(recordId: string): void;
}): ReactElement {
    const labels = { ...defaultLabels, ...suppliedLabels };
    const dialogRef = useRef<HTMLDialogElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const keepEditing = useRef<HTMLButtonElement>(null);
    const pendingDecision = useRef<FormLinkedChildSnapshot | null>(null);
    const [question, setQuestion] = useState<FormLinkedChildSnapshot | null>(
        null
    );
    const [invalidRevision, setInvalidRevision] = useState<number | null>(null);
    const session = useMemo(
        () => ({
            closed: false,
            saving: false,
            savedByDialog: false,
            live: false,
            dismissedUnknownRevision: null as number | null,
        }),
        [owner, opening, child, pages, editRecordId]
    );
    const confirm =
        question?.child === child && question.revision === state.revision;

    const current = (
        rendered: FormLinkedChildSnapshot,
        action: 'close' | 'save'
    ) => {
        if (!session.live || !dialogRef.current?.open || !opening.isCurrent())
            return false;
        const next = owner.getSnapshot();
        return (
            next.child === child &&
            next.pages === pages &&
            matchesIntent(next, editRecordId) &&
            next.revision === rendered.revision &&
            (next.phase === 'ready' ||
                next.phase === 'error' ||
                (action === 'close' && next.phase === 'unknown'))
        );
    };

    useCommitEffect(() => {
        const node = dialogRef.current;
        if (!node || !opening.isCurrent()) return;
        const document = node.ownerDocument;
        const opener = opening.opener;
        // Native dialog cleanup must not auto-focus a retired opener.
        if (document.activeElement === opener) opener.blur();
        node.showModal();
        session.live = true;
        closeButton.current?.focus({ preventScroll: true });
        return () => {
            session.live = false;
            pendingDecision.current = null;
            const active = document.activeElement;
            const fromDialog =
                active === document.body || node.contains(active);
            const next = owner.getSnapshot();
            const admittedClose = session.closed && next.phase === 'closed';
            const admittedUnknownDismissal =
                next.phase === 'unknown' &&
                next.revision === session.dismissedUnknownRevision &&
                matchesIntent(next, editRecordId) &&
                next.child === child &&
                next.pages === pages;
            const admittedSave =
                (session.saving || session.savedByDialog) &&
                next.phase === 'saved' &&
                next.completion === 'reconciled' &&
                (editRecordId === undefined ||
                    (matchesIntent(next, editRecordId) &&
                        next.child === child &&
                        next.pages === pages));
            node.close();
            if (
                fromDialog &&
                (admittedClose || admittedSave || admittedUnknownDismissal) &&
                opening.isCurrent() &&
                opener.isConnected &&
                !opener.matches(':disabled') &&
                !opener.closest('[hidden],[inert]') &&
                isVisible(opener)
            )
                opener.focus({ preventScroll: true });
        };
    }, [owner, opening, session, editRecordId, child, pages]);

    useCommitEffect(() => {
        if (confirm) keepEditing.current?.focus({ preventScroll: true });
    }, [confirm]);

    const close = (rendered: FormLinkedChildSnapshot) => {
        if (!current(rendered, 'close')) return;
        if (editRecordId !== undefined) {
            session.closed = owner.closeEdit(rendered.revision);
            return;
        }
        session.closed = true;
        owner.close();
    };
    const dismiss = () => {
        if (!current(state, 'close') || session.saving) return;
        if (editRecordId !== undefined && state.phase === 'unknown') {
            // Leave the owner's draft and unresolved Save in place.
            session.dismissedUnknownRevision = state.revision;
            dismissUnknownEdit(editRecordId);
            return;
        }
        if (child.controller.getState().draft?.dirtyFieldIds.length) {
            if (!current(state, 'close')) return;
            pendingDecision.current = state;
            setQuestion(state);
        } else close(state);
    };
    const keep = () => {
        pendingDecision.current = null;
        setQuestion(null);
        queueMicrotask(() => {
            if (current(state, 'close'))
                closeButton.current?.focus({ preventScroll: true });
        });
    };
    const save = async () => {
        if (!current(state, 'save') || session.saving) return;
        session.saving = true;
        setInvalidRevision(null);
        try {
            const result = await owner.save(state.revision);
            session.savedByDialog = result.type === 'saved';
        } catch {
            // Local page validation can refuse before the owner publishes a Save attempt.
            if (pages.getSnapshot().problems.length && current(state, 'save'))
                setInvalidRevision(state.revision);
        } finally {
            if (session.live) session.saving = false;
        }
    };

    return h(LinkedChildDialogChrome, {
        labels,
        dialogRef,
        closeButton,
        keepEditing,
        fields: renderFields(child, pages),
        error:
            state.error || invalidRevision === state.revision
                ? (state.error ?? labels.incomplete)
                : null,
        confirm,
        closeDisabled: state.phase === 'saving',
        saveDisabled: state.phase === 'saving' || state.phase === 'unknown',
        dismiss,
        keep,
        discard: () => {
            if (!question || pendingDecision.current !== question) return;
            pendingDecision.current = null;
            setQuestion(null);
            close(question);
        },
        save,
    });
}

type DialogChromeProps = {
    labels: typeof defaultLabels;
    dialogRef: Ref<HTMLDialogElement>;
    closeButton: Ref<HTMLButtonElement>;
    keepEditing: Ref<HTMLButtonElement>;
    fields: ReactNode;
    error: string | null;
    confirm: boolean;
    closeDisabled: boolean;
    saveDisabled: boolean;
    dismiss(): void;
    keep(): void;
    discard(): void;
    save(): void;
};

function LinkedChildDialogChrome({
    labels,
    dialogRef,
    closeButton,
    keepEditing,
    fields,
    error,
    confirm,
    closeDisabled,
    saveDisabled,
    dismiss,
    keep,
    discard,
    save,
}: DialogChromeProps): ReactElement {
    const titleId = useId();
    return h(
        'dialog',
        {
            ref: dialogRef,
            'aria-labelledby': titleId,
            onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
                event.preventDefault();
                event.stopPropagation();
                if (confirm) keep();
                else dismiss();
            },
            onSubmit: (event: FormEvent<HTMLDialogElement>) => {
                event.preventDefault();
                event.stopPropagation();
            },
            onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => {
                if (
                    event.key !== 'Tab' ||
                    event.nativeEvent.isComposing ||
                    event.defaultPrevented
                )
                    return;
                const dialog = event.currentTarget;
                const stops = tabStops(dialog);
                const first = stops[0];
                const last = stops.at(-1);
                if (!first || !last) return;
                const active = dialog.ownerDocument.activeElement;
                if (active !== (event.shiftKey ? first : last)) return;
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            },
        },
        h('h2', { id: titleId }, labels.title),
        h(
            'div',
            { hidden: confirm },
            h(
                'button',
                {
                    type: 'button',
                    ref: closeButton,
                    disabled: closeDisabled,
                    onClick: dismiss,
                },
                labels.close
            ),
            fields,
            error != null && h('p', { role: 'alert' }, error),
            h(
                'button',
                {
                    type: 'button',
                    disabled: saveDisabled,
                    onClick: save,
                },
                labels.save
            )
        ),
        confirm &&
            h(
                'div',
                null,
                h('p', { role: 'alert' }, labels.discardQuestion),
                h(
                    'button',
                    { type: 'button', ref: keepEditing, onClick: keep },
                    labels.keepEditing
                ),
                h(
                    'button',
                    {
                        type: 'button',
                        onClick: discard,
                    },
                    labels.confirmClose
                )
            )
    );
}

/** A fresh native acceptance must supply a new opening identity, including after reopening. */
export type BorrowedFormLinkedChildCreateRef = Readonly<{
    opening: object;
    revision: number;
}>;

export type BorrowedFormLinkedChildCreateSaveOutcome =
    | { type: 'not-dispatched'; reason: 'superseded' | 'busy' | 'invalid' }
    | { type: 'rejected' }
    | { type: 'unknown'; attemptId: string }
    | { type: 'saved'; recordId: string; link: 'linked' | 'superseded' };

export type BorrowedFormLinkedChildCreateDismissOutcome =
    | 'closed'
    | 'superseded'
    | 'blocked';

export type BorrowedFormLinkedChildCreateSnapshot<View> = Readonly<{
    ref: BorrowedFormLinkedChildCreateRef;
    phase: 'ready' | 'saving' | 'unknown' | 'saved' | 'closed' | 'retired';
    /** Accepted, one-page native fields. Null when there is no accepted view. */
    fields: View | null;
    dirty: boolean;
    error: string | null;
    /** Native settlement, retained through dialog cleanup for this opening. */
    outcome: BorrowedFormLinkedChildCreateSaveOutcome | null;
}>;

export type BorrowedFormLinkedChildCreateOwner<View> = Readonly<{
    /** Return the same snapshot object until published state changes. */
    getSnapshot(): BorrowedFormLinkedChildCreateSnapshot<View> | null;
    subscribe(notify: () => void): () => void;
    /** Atomically claim the exact opening and revision before sending. Publish its resulting phase. */
    save(
        expected: BorrowedFormLinkedChildCreateRef
    ): Promise<BorrowedFormLinkedChildCreateSaveOutcome>;
    /** Commit the already-confirmed close without a second prompt. Retain any unresolved Save. */
    dismiss(
        expected: BorrowedFormLinkedChildCreateRef
    ): BorrowedFormLinkedChildCreateDismissOutcome;
}>;

export type BorrowedFormLinkedChildCreateOpening = Readonly<{
    identity: object;
    opener: HTMLButtonElement;
    /** Must still recognize the original opener after an admitted terminal close. */
    isCurrent(): boolean;
}>;

export type BorrowedFormLinkedChildCreateDialogProps<View> = Readonly<{
    owner: BorrowedFormLinkedChildCreateOwner<View>;
    opening: BorrowedFormLinkedChildCreateOpening;
    /** Render fields without a separate modal, form element, or submit footer. */
    renderFields(fields: View): ReactNode;
    labels?: Partial<typeof defaultLabels>;
}>;

/** Presents an accepted native Create using the same dialog chrome and host-owned draft. */
export function BorrowedFormLinkedChildCreateDialog<View>(
    props: BorrowedFormLinkedChildCreateDialogProps<View>
): ReactElement | null {
    const { owner, opening } = props;
    const activationOwner = useMemo(
        () => ({}),
        [owner, opening.identity, opening.opener]
    );
    const [controls, setControls] = useState({
        owner: activationOwner,
        generation: 0,
    });
    let controlGeneration = controls.generation;
    if (controls.owner !== activationOwner) {
        controlGeneration++;
        setControls({ owner: activationOwner, generation: controlGeneration });
    }
    const store = useMemo(
        () => ({
            subscribe: (notify: () => void) => owner.subscribe(notify),
            read: () => owner.getSnapshot(),
        }),
        [owner]
    );
    const state = useSyncExternalStore(store.subscribe, store.read, store.read);
    if (
        !state ||
        state.ref.opening !== opening.identity ||
        state.fields == null ||
        !opening.isCurrent() ||
        (state.phase !== 'ready' &&
            state.phase !== 'saving' &&
            state.phase !== 'unknown')
    )
        return null;

    return h(
        Suspense,
        { fallback: null },
        h(
            LinkedChildDialogPortal,
            { container: opening.opener.ownerDocument.body },
            // A press started on the previous native opening must never release
            // on a reused Save button now bound to the successor.
            h(BorrowedCreatePresentation, {
                key: controlGeneration,
                owner,
                opening,
                state,
                content: props.renderFields(state.fields),
                labels: props.labels,
            })
        )
    );
}

function BorrowedCreatePresentation<View>({
    owner,
    opening,
    state,
    content,
    labels: suppliedLabels,
}: {
    owner: BorrowedFormLinkedChildCreateOwner<View>;
    opening: BorrowedFormLinkedChildCreateOpening;
    state: BorrowedFormLinkedChildCreateSnapshot<View>;
    content: ReactNode;
    labels?: Partial<typeof defaultLabels>;
}): ReactElement {
    const labels = { ...defaultLabels, ...suppliedLabels };
    const dialogRef = useRef<HTMLDialogElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const keepEditing = useRef<HTMLButtonElement>(null);
    const pendingDecision = useRef<BorrowedFormLinkedChildCreateRef | null>(
        null
    );
    const [question, setQuestion] =
        useState<BorrowedFormLinkedChildCreateRef | null>(null);
    const session = useMemo(
        () => ({
            live: false,
            saving: false,
            closing: false,
            closed: false,
            saved: null as null | 'linked' | 'superseded',
            unresolved: false,
        }),
        [owner, opening.identity, opening.opener]
    );
    const [actionStatus, setActionStatus] = useState<{
        session: typeof session;
        phase: 'saving' | 'unknown' | 'saved';
    } | null>(null);
    const committedOpening = useRef(opening);
    useCommitEffect(() => {
        committedOpening.current = opening;
    }, [opening]);
    const { identity, opener } = opening;
    const confirm =
        question?.opening === state.ref.opening &&
        question.revision === state.ref.revision;
    const current = (
        expected: BorrowedFormLinkedChildCreateRef,
        action: 'save' | 'dismiss'
    ) => {
        if (!session.live || !dialogRef.current?.open || !opening.isCurrent())
            return false;
        const actual = owner.getSnapshot();
        return (
            actual?.ref.opening === expected.opening &&
            actual.ref.revision === expected.revision &&
            (actual.phase === 'ready' ||
                (action === 'dismiss' && actual.phase === 'unknown')) &&
            !session.saving &&
            !session.closing &&
            !session.closed &&
            !session.saved &&
            (action === 'dismiss' || !session.unresolved)
        );
    };
    useCommitEffect(() => {
        const node = dialogRef.current;
        if (!node || !committedOpening.current.isCurrent()) return;
        const document = node.ownerDocument;
        if (document.activeElement === opener) opener.blur();
        node.showModal();
        session.live = true;
        closeButton.current?.focus({ preventScroll: true });
        return () => {
            session.live = false;
            pendingDecision.current = null;
            const active = document.activeElement;
            const next = owner.getSnapshot();
            const terminal =
                next?.ref.opening === identity &&
                (((session.closing || session.closed) &&
                    next.phase === 'closed') ||
                    ((session.saving || session.saved === 'linked') &&
                        next.phase === 'saved' &&
                        next.outcome?.type === 'saved' &&
                        next.outcome.link === 'linked'));
            node.close();
            if (
                (active === document.body || node.contains(active)) &&
                terminal &&
                committedOpening.current.identity === identity &&
                committedOpening.current.isCurrent() &&
                opener.isConnected &&
                !opener.matches(':disabled') &&
                !opener.closest('[hidden],[inert]') &&
                isVisible(opener)
            )
                opener.focus({ preventScroll: true });
        };
    }, [owner, identity, opener, session]);

    useCommitEffect(() => {
        if (confirm) keepEditing.current?.focus({ preventScroll: true });
    }, [confirm]);

    const close = (expected: BorrowedFormLinkedChildCreateRef) => {
        if (!current(expected, 'dismiss')) return;
        session.closing = true;
        try {
            session.closed = owner.dismiss(expected) === 'closed';
        } finally {
            session.closing = false;
        }
    };
    const dismiss = () => {
        if (!current(state.ref, 'dismiss')) return;
        if (state.dirty) {
            pendingDecision.current = state.ref;
            setQuestion(state.ref);
        } else close(state.ref);
    };
    const keep = () => {
        pendingDecision.current = null;
        setQuestion(null);
        queueMicrotask(() => {
            if (current(state.ref, 'dismiss'))
                closeButton.current?.focus({ preventScroll: true });
        });
    };
    const save = async () => {
        if (!current(state.ref, 'save')) return;
        session.saving = true;
        setActionStatus({ session, phase: 'saving' });
        try {
            const outcome = await owner.save(state.ref);
            session.saved = outcome.type === 'saved' ? outcome.link : null;
            session.unresolved = outcome.type === 'unknown';
        } catch {
            // An unclassified host failure cannot confer authority to retry.
            session.unresolved = true;
        } finally {
            if (session.live) {
                session.saving = false;
                setActionStatus(
                    session.unresolved
                        ? { session, phase: 'unknown' }
                        : session.saved
                          ? { session, phase: 'saved' }
                          : null
                );
            }
        }
    };

    const localPhase =
        actionStatus?.session === session ? actionStatus.phase : null;
    return h(LinkedChildDialogChrome, {
        labels,
        dialogRef,
        closeButton,
        keepEditing,
        fields: content,
        error: state.error,
        confirm,
        closeDisabled:
            state.phase === 'saving' ||
            localPhase === 'saving' ||
            localPhase === 'saved',
        saveDisabled: state.phase !== 'ready' || localPhase != null,
        dismiss,
        keep,
        discard: () => {
            if (!question || pendingDecision.current !== question) return;
            pendingDecision.current = null;
            setQuestion(null);
            close(question);
        },
        save,
    });
}
