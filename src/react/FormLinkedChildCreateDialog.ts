import {
    createElement as h,
    Fragment,
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
    type MouseEvent,
    type PointerEvent,
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
import { FormPageNavigationButton } from './CompleteFormPageNavigation.js';
import { FormSubmitButton } from './FormSubmitButton.js';
import { getThemePortalProps, useThemeSnapshot } from './ThemeBoundary.js';
import { isVisible, wrapDialogTab } from './dialogFocus.js';

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
    className?: string;
    closeIcon?: ReactNode;
    dialogRef: Ref<HTMLDialogElement>;
    closeButton: Ref<HTMLButtonElement>;
    keepEditing: Ref<HTMLButtonElement>;
    fields: ReactNode;
    error: string | null;
    errorAction?: ReactNode;
    confirm: boolean;
    closeDisabled: boolean;
    saveDisabled: boolean;
    primaryFormId?: string;
    primaryMode?: 'next' | 'review';
    primarySaving?: boolean;
    beforePrimary?: ReactNode;
    hostForm?: boolean;
    backdrop?: {
        onPointerDown(event: PointerEvent<HTMLDialogElement>): void;
        onPointerUp(event: PointerEvent<HTMLDialogElement>): void;
        onPointerCancel(): void;
        onClick(event: MouseEvent<HTMLDialogElement>): void;
    };
    dismiss(): void;
    keep(): void;
    discard(): void;
    save?(): void;
};

function LinkedChildDialogChrome({
    labels,
    className,
    closeIcon,
    dialogRef,
    closeButton,
    keepEditing,
    fields,
    error,
    errorAction,
    confirm,
    closeDisabled,
    saveDisabled,
    primaryFormId,
    primaryMode,
    primarySaving = false,
    beforePrimary,
    hostForm = false,
    backdrop,
    dismiss,
    keep,
    discard,
    save,
}: DialogChromeProps): ReactElement {
    const titleId = useId();
    const themeSnapshot = useThemeSnapshot();
    const customized = Boolean(
        className || closeIcon != null || primaryMode || beforePrimary != null
    );
    const theme = customized ? getThemePortalProps(themeSnapshot) : undefined;
    const form =
        primaryFormId &&
        h('form', {
            id: primaryFormId,
            noValidate: true,
            onSubmit: (event: FormEvent<HTMLFormElement>) => {
                const admitted =
                    !event.defaultPrevented && !confirm && !saveDisabled;
                event.preventDefault();
                event.stopPropagation();
                if (admitted) save?.();
            },
        });
    const body = h(
        Fragment,
        null,
        form,
        fields,
        error != null && h('p', { role: 'alert' }, error),
        errorAction
    );
    let primary: ReactElement | null;
    if (hostForm) {
        primary = null;
    } else if (primaryFormId && primaryMode === 'next') {
        primary = h(FormPageNavigationButton, {
            direction: 'next',
            type: 'submit',
            form: primaryFormId,
            label: labels.save,
            loading: primarySaving,
            disabled: saveDisabled,
        });
    } else if (primaryFormId && primaryMode === 'review') {
        primary = h(FormSubmitButton, {
            formId: primaryFormId,
            label: labels.save,
            mode: 'review',
            saving: primarySaving,
            canSubmit: !saveDisabled,
        });
    } else {
        primary = h(
            'button',
            {
                type: primaryFormId ? 'submit' : 'button',
                form: primaryFormId || undefined,
                disabled: saveDisabled,
                onClick: primaryFormId ? undefined : save,
            },
            labels.save
        );
    }
    const actions = hostForm ? null : h(Fragment, null, beforePrimary, primary);
    return h(
        'dialog',
        {
            ref: dialogRef,
            'aria-labelledby': titleId,
            ...(theme && {
                ...theme,
                className:
                    [theme.className, className].filter(Boolean).join(' ') ||
                    undefined,
            }),
            onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
                if (event.target !== event.currentTarget) return;
                event.preventDefault();
                event.stopPropagation();
                if (confirm) keep();
                else dismiss();
            },
            onSubmit: (event: FormEvent<HTMLDialogElement>) => {
                if (!hostForm) event.preventDefault();
                event.stopPropagation();
            },
            ...backdrop,
            onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => {
                if (
                    event.key !== 'Tab' ||
                    event.nativeEvent.isComposing ||
                    event.defaultPrevented
                )
                    return;
                wrapDialogTab(event);
            },
        },
        h(
            'h2',
            {
                id: titleId,
                className: customized
                    ? 'mx-sdk-linked-child-create__title'
                    : undefined,
            },
            labels.title
        ),
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
                    className: customized
                        ? 'mx-sdk-linked-child-create__close'
                        : undefined,
                    'aria-label': closeIcon != null ? labels.close : undefined,
                },
                closeIcon ?? labels.close
            ),
            customized
                ? h(
                      'div',
                      { className: 'mx-sdk-linked-child-create__body' },
                      body
                  )
                : body,
            actions && customized
                ? h(
                      'div',
                      { className: 'mx-sdk-linked-child-create__actions' },
                      actions
                  )
                : actions
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
    | {
          type: 'saved';
          recordId: string;
          /** A current but unlinked Save is terminal and awaits explicit Close. */
          link: 'linked' | 'unlinked' | 'superseded';
      };

export type BorrowedFormLinkedChildCreateDismissOutcome =
    | 'closed'
    | 'superseded'
    | 'blocked';

export type BorrowedFormLinkedChildCreateSnapshot<View> = Readonly<{
    ref: BorrowedFormLinkedChildCreateRef;
    phase: 'ready' | 'saving' | 'unknown' | 'saved' | 'closed' | 'retired';
    /** Accepted native fields. Null when there is no accepted view. */
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
    /** Commit explicit Close without a second prompt. Retain unresolved and saved-unlinked outcomes. */
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

type BorrowedCreateLabels = Partial<typeof defaultLabels> & {
    savedWithoutLink?: string;
};

export type BorrowedFormLinkedChildCreateDialogProps<View> = Readonly<{
    owner: BorrowedFormLinkedChildCreateOwner<View>;
    opening: BorrowedFormLinkedChildCreateOpening;
    /** Render fields without a separate editor dialog, form, or submit footer. */
    renderFields(fields: View): ReactNode;
    /** Supply an optional non-submitting host action for the current error, including an unresolved Save. */
    renderErrorAction?(message: string): ReactNode;
    labels?: BorrowedCreateLabels;
    /** Opt in to named layout hooks on the dialog's presentation. */
    className?: string;
    /** Presented in the existing Close button and described by its label. */
    closeIcon?: ReactNode;
    /** A native navigation or Review action that can defer Save until confirmation. */
    primaryAction?: Readonly<{
        label: string;
        /** Uses the same form ID as the native inputs to enable implicit submission. */
        formId?: string;
        /** Uses the standard Form control for the associated form. */
        mode?: 'next' | 'review';
        beforePrimary?: ReactNode;
        /** Return false when declining the action so an admitted Review stays current. */
        onAction(save: () => Promise<void>): boolean | void;
    }>;
}>;

function isSavedUnlinked(
    state: BorrowedFormLinkedChildCreateSnapshot<unknown>
): boolean {
    return (
        state.phase === 'saved' &&
        state.outcome?.type === 'saved' &&
        state.outcome.link === 'unlinked'
    );
}

function useBorrowedDialogControlGeneration(
    owner: object,
    opening: BorrowedFormLinkedChildCreateOpening
): number {
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
    return controlGeneration;
}

/** Presents an accepted native Create using the same dialog chrome and host-owned draft. */
export function BorrowedFormLinkedChildCreateDialog<View>(
    props: BorrowedFormLinkedChildCreateDialogProps<View>
): ReactElement | null {
    const { owner, opening } = props;
    const controlGeneration = useBorrowedDialogControlGeneration(
        owner,
        opening
    );
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
        !opening.isCurrent()
    )
        return null;
    const unlinked = isSavedUnlinked(state);
    if (
        !unlinked &&
        (state.fields == null ||
            (state.phase !== 'ready' &&
                state.phase !== 'saving' &&
                state.phase !== 'unknown'))
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
                content:
                    unlinked || state.fields == null
                        ? null
                        : props.renderFields(state.fields),
                labels: props.labels,
                renderErrorAction: props.renderErrorAction,
                className: props.className,
                closeIcon: props.closeIcon,
                primaryAction: props.primaryAction,
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
    renderErrorAction,
    className,
    closeIcon,
    primaryAction,
}: {
    owner: BorrowedFormLinkedChildCreateOwner<View>;
    opening: BorrowedFormLinkedChildCreateOpening;
    state: BorrowedFormLinkedChildCreateSnapshot<View>;
    content: ReactNode;
    labels?: BorrowedCreateLabels;
    renderErrorAction?: BorrowedFormLinkedChildCreateDialogProps<View>['renderErrorAction'];
    className?: string;
    closeIcon?: ReactNode;
    primaryAction?: BorrowedFormLinkedChildCreateDialogProps<View>['primaryAction'];
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
            saved: null as null | 'linked' | 'unlinked' | 'superseded',
            unresolved: false,
            pendingPrimarySave: null as (() => Promise<void>) | null,
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
    const unlinked = isSavedUnlinked(state);
    const confirm =
        !unlinked &&
        question?.opening === state.ref.opening &&
        question.revision === state.ref.revision;
    const current = (
        expected: BorrowedFormLinkedChildCreateRef,
        action: 'save' | 'dismiss'
    ) => {
        if (
            !session.live ||
            !dialogRef.current?.open ||
            committedOpening.current.identity !== expected.opening ||
            !committedOpening.current.isCurrent()
        )
            return false;
        const actual = owner.getSnapshot();
        if (
            actual?.ref.opening !== expected.opening ||
            actual.ref.revision !== expected.revision ||
            session.saving ||
            session.closing ||
            session.closed
        )
            return false;
        if (action === 'dismiss' && isSavedUnlinked(actual)) return true;
        return (
            !session.saved &&
            (actual.phase === 'ready' ||
                (action === 'dismiss' && actual.phase === 'unknown')) &&
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
            session.pendingPrimarySave = null;
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
        session.pendingPrimarySave = null;
        if (state.dirty && !unlinked) {
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
    const save = async (expected: BorrowedFormLinkedChildCreateRef) => {
        if (!current(expected, 'save')) return;
        session.saving = true;
        setActionStatus({ session, phase: 'saving' });
        try {
            const outcome = await owner.save(expected);
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

    const activatePrimary = () => {
        const expected = state.ref;
        if (!primaryAction) {
            session.pendingPrimarySave = null;
            void save(expected);
            return;
        }
        if (!current(expected, 'save')) return;
        const previousSave = session.pendingPrimarySave;
        const saveOnce = async () => {
            if (session.pendingPrimarySave !== saveOnce) return;
            session.pendingPrimarySave = null;
            if (owner.getSnapshot()?.ref === expected) await save(expected);
        };
        session.pendingPrimarySave = saveOnce;
        let admitted: boolean | void = false;
        try {
            admitted = primaryAction.onAction(saveOnce);
        } finally {
            if (admitted === false && session.pendingPrimarySave === saveOnce)
                session.pendingPrimarySave = previousSave;
        }
    };

    const localPhase =
        actionStatus?.session === session ? actionStatus.phase : null;
    const saving = state.phase === 'saving' || localPhase === 'saving';
    return h(LinkedChildDialogChrome, {
        labels: primaryAction
            ? { ...labels, save: primaryAction.label }
            : labels,
        className,
        closeIcon,
        dialogRef,
        closeButton,
        keepEditing,
        fields: content,
        error: unlinked
            ? (suppliedLabels?.savedWithoutLink ??
              'The record was saved but could not be linked to this Form.')
            : state.error,
        errorAction:
            !unlinked &&
            !saving &&
            localPhase !== 'saved' &&
            !confirm &&
            state.error != null
                ? renderErrorAction?.(state.error)
                : null,
        confirm,
        closeDisabled: saving || (localPhase === 'saved' && !unlinked),
        saveDisabled: state.phase !== 'ready' || localPhase != null,
        primaryFormId: primaryAction?.formId,
        primaryMode: primaryAction?.mode,
        primarySaving: saving,
        beforePrimary: primaryAction?.beforePrimary,
        dismiss,
        keep,
        discard: () => {
            if (!question || pendingDecision.current !== question) return;
            pendingDecision.current = null;
            setQuestion(null);
            close(question);
        },
        save: activatePrimary,
    });
}

export type BorrowedFormLinkedChildEditOpening =
    BorrowedFormLinkedChildCreateOpening;

export type BorrowedFormLinkedChildEditRef = BorrowedFormLinkedChildCreateRef;

export type BorrowedFormLinkedChildEditSnapshot =
    | Readonly<{
          ref: BorrowedFormLinkedChildEditRef;
          phase: 'presented';
          dirty: boolean;
          canDismiss: boolean;
      }>
    | Readonly<{
          ref: BorrowedFormLinkedChildEditRef;
          /** Closed means the host acknowledged a terminal action for this opening. */
          phase: 'closed' | 'retired';
      }>;

export type BorrowedFormLinkedChildEditOwner = Readonly<{
    /** Keep the snapshot stable until the host publishes a change. */
    getSnapshot(): BorrowedFormLinkedChildEditSnapshot | null;
    subscribe(notify: () => void): () => void;
    /** Commit the exact Close without presenting another confirmation. */
    dismiss(
        expected: BorrowedFormLinkedChildEditRef
    ): BorrowedFormLinkedChildCreateDismissOutcome;
}>;

export type BorrowedFormLinkedChildEditDialogProps = Readonly<{
    owner: BorrowedFormLinkedChildEditOwner;
    opening: BorrowedFormLinkedChildEditOpening;
    /** The native fields and their original form and Save footer. */
    children: ReactNode;
    labels?: Partial<Omit<typeof defaultLabels, 'save' | 'incomplete'>>;
    className?: string;
    closeIcon?: ReactNode;
}>;

/** Presents an accepted existing child without owning the host's read, draft or Save. */
export function BorrowedFormLinkedChildEditDialog({
    owner,
    opening,
    children,
    labels,
    className,
    closeIcon,
}: BorrowedFormLinkedChildEditDialogProps): ReactElement | null {
    const controlGeneration = useBorrowedDialogControlGeneration(
        owner,
        opening
    );
    const store = useMemo(
        () => ({
            subscribe: (notify: () => void) => owner.subscribe(notify),
            read: () => owner.getSnapshot(),
        }),
        [owner]
    );
    const view = useSyncExternalStore(store.subscribe, store.read, store.read);
    if (
        view?.phase !== 'presented' ||
        view.ref.opening !== opening.identity ||
        !opening.isCurrent()
    )
        return null;
    return h(
        Suspense,
        { fallback: null },
        h(
            LinkedChildDialogPortal,
            { container: opening.opener.ownerDocument.body },
            h(BorrowedEditPresentation, {
                key: controlGeneration,
                owner,
                opening,
                view,
                labels,
                className,
                closeIcon,
                children,
            })
        )
    );
}

function BorrowedEditPresentation({
    owner,
    opening,
    view,
    labels: suppliedLabels,
    className,
    closeIcon,
    children,
}: BorrowedFormLinkedChildEditDialogProps & {
    view: Extract<BorrowedFormLinkedChildEditSnapshot, { phase: 'presented' }>;
}): ReactElement {
    const labels = {
        ...defaultLabels,
        title: 'Edit linked record',
        discardQuestion:
            'Close without saving? Reopen this record to continue editing.',
        ...suppliedLabels,
    };
    const dialogRef = useRef<HTMLDialogElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const keepEditing = useRef<HTMLButtonElement>(null);
    const [question, setQuestion] =
        useState<BorrowedFormLinkedChildEditRef | null>(null);
    const backdropPress = useRef<{
        pointerId: number;
        expected: BorrowedFormLinkedChildEditRef;
        releasedOutside: boolean;
    } | null>(null);
    const { identity, opener } = opening;
    const committedOpening = useRef(opening);
    const session = useMemo(
        () => ({ live: false, closing: false, closed: false }),
        [identity, opener, owner]
    );
    const confirm =
        question?.opening === identity &&
        question.revision === view.ref.revision &&
        view.canDismiss;

    useCommitEffect(() => {
        committedOpening.current = opening;
    }, [opening]);

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
            const active = document.activeElement;
            const latest = owner.getSnapshot();
            node.close();
            if (
                (active === document.body || node.contains(active)) &&
                latest?.phase === 'closed' &&
                latest.ref.opening === identity &&
                committedOpening.current.identity === identity &&
                committedOpening.current.isCurrent() &&
                opener.isConnected &&
                !opener.matches(':disabled') &&
                !opener.closest('[hidden],[inert]') &&
                isVisible(opener)
            )
                opener.focus({ preventScroll: true });
        };
    }, [identity, opener, owner, session]);

    const wasConfirming = useRef(false);
    useCommitEffect(() => {
        if (confirm) keepEditing.current?.focus({ preventScroll: true });
        else if (wasConfirming.current && view.canDismiss)
            closeButton.current?.focus({ preventScroll: true });
        wasConfirming.current = confirm;
    }, [confirm, view.canDismiss]);

    const canDismiss = (expected: BorrowedFormLinkedChildEditRef): boolean => {
        if (
            !session.live ||
            session.closing ||
            session.closed ||
            !dialogRef.current?.open ||
            committedOpening.current.identity !== expected.opening ||
            !committedOpening.current.isCurrent()
        )
            return false;
        const actual = owner.getSnapshot();
        return (
            actual?.phase === 'presented' &&
            actual.canDismiss &&
            actual.ref.opening === expected.opening &&
            actual.ref.revision === expected.revision
        );
    };

    const close = (expected: BorrowedFormLinkedChildEditRef) => {
        if (!canDismiss(expected)) return;
        session.closing = true;
        try {
            session.closed = owner.dismiss(expected) === 'closed';
        } finally {
            session.closing = false;
        }
    };
    const dismiss = () => {
        if (confirm || !canDismiss(view.ref)) return;
        if (view.dirty) setQuestion(view.ref);
        else close(view.ref);
    };
    return h(LinkedChildDialogChrome, {
        labels,
        className,
        closeIcon,
        dialogRef,
        closeButton,
        keepEditing,
        fields: children,
        error: null,
        confirm,
        closeDisabled: !view.canDismiss,
        saveDisabled: true,
        hostForm: true,
        backdrop: {
            onPointerDown(event) {
                backdropPress.current =
                    !confirm &&
                    event.isTrusted &&
                    event.isPrimary &&
                    event.button === 0 &&
                    hitEditBackdrop(event)
                        ? {
                              pointerId: event.pointerId,
                              expected: view.ref,
                              releasedOutside: false,
                          }
                        : null;
            },
            onPointerUp(event) {
                const press = backdropPress.current;
                if (press?.pointerId !== event.pointerId) return;
                if (event.isTrusted && hitEditBackdrop(event))
                    press.releasedOutside = true;
                else backdropPress.current = null;
            },
            onPointerCancel() {
                backdropPress.current = null;
            },
            onClick(event) {
                const press = backdropPress.current;
                backdropPress.current = null;
                if (
                    !press?.releasedOutside ||
                    !event.isTrusted ||
                    !hitEditBackdrop(event) ||
                    !canDismiss(press.expected) ||
                    ('pointerId' in event.nativeEvent &&
                        event.nativeEvent.pointerId !== press.pointerId)
                )
                    return;
                event.stopPropagation();
                dismiss();
            },
        },
        dismiss,
        keep: () => setQuestion(null),
        discard: () => {
            if (!confirm || !question) return;
            setQuestion(null);
            close(question);
        },
    });
}

function hitEditBackdrop(event: MouseEvent<HTMLDialogElement>): boolean {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return (
        event.clientX < rect.left ||
        event.clientX >= rect.right ||
        event.clientY < rect.top ||
        event.clientY >= rect.bottom
    );
}
