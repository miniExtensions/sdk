import {
    createElement as h,
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
    type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
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
                    next.intent?.type !== snapshot.intent?.type
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
export function FormLinkedChildCreateDialog({
    owner,
    opening,
    renderFields,
    labels,
}: FormLinkedChildCreateDialogProps): ReactElement | null {
    const state = useLinkedChildPresentation(owner);
    const { child, pages } = state;
    if (
        !opening.isCurrent() ||
        state.intent?.type !== 'create' ||
        child !== opening.child ||
        !pages ||
        pages.getSnapshot().pages.length !== 1 ||
        !['ready', 'error', 'saving', 'unknown'].includes(state.phase)
    )
        return null;

    return createPortal(
        h(CreateDialog, {
            owner,
            opening,
            state,
            child,
            pages,
            renderFields,
            labels,
        }),
        opening.opener.ownerDocument.body
    );
}

function CreateDialog({
    owner,
    opening,
    state,
    child,
    pages,
    renderFields,
    labels: suppliedLabels,
}: FormLinkedChildCreateDialogProps & {
    state: FormLinkedChildSnapshot;
    child: FormFieldBindings;
    pages: FormPageOwner;
}): ReactElement {
    const labels = { ...defaultLabels, ...suppliedLabels };
    const titleId = useId();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const closeButton = useRef<HTMLButtonElement>(null);
    const keepEditing = useRef<HTMLButtonElement>(null);
    const pendingDecision = useRef<FormLinkedChildSnapshot | null>(null);
    const [question, setQuestion] = useState<FormLinkedChildSnapshot | null>(
        null
    );
    const [invalidRevision, setInvalidRevision] = useState<number | null>(null);
    const session = useMemo(
        () => ({ closed: false, saving: false, live: false }),
        [owner, opening, child, pages]
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
            next.intent?.type === 'create' &&
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
            const admittedSave =
                session.saving &&
                next.phase === 'saved' &&
                next.completion === 'reconciled';
            node.close();
            if (
                fromDialog &&
                (admittedClose || admittedSave) &&
                opening.isCurrent() &&
                opener.isConnected &&
                !opener.matches(':disabled') &&
                isVisible(opener)
            )
                opener.focus({ preventScroll: true });
        };
    }, [owner, opening, session]);

    useCommitEffect(() => {
        if (confirm) keepEditing.current?.focus({ preventScroll: true });
    }, [confirm]);

    const close = (rendered: FormLinkedChildSnapshot) => {
        if (!current(rendered, 'close')) return;
        session.closed = true;
        owner.close();
    };
    const dismiss = () => {
        if (!current(state, 'close') || session.saving) return;
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
            await owner.save(state.revision);
        } catch {
            // Local page validation can refuse before the owner publishes a Save attempt.
            if (pages.getSnapshot().problems.length && current(state, 'save'))
                setInvalidRevision(state.revision);
        } finally {
            if (session.live) session.saving = false;
        }
    };

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
                    disabled: state.phase === 'saving',
                    onClick: dismiss,
                },
                labels.close
            ),
            renderFields(child, pages),
            (state.error || invalidRevision === state.revision) &&
                h('p', { role: 'alert' }, state.error ?? labels.incomplete),
            h(
                'button',
                {
                    type: 'button',
                    disabled:
                        state.phase === 'saving' || state.phase === 'unknown',
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
                        onClick: () => {
                            if (pendingDecision.current !== question) return;
                            pendingDecision.current = null;
                            setQuestion(null);
                            close(question);
                        },
                    },
                    labels.confirmClose
                )
            )
    );
}
