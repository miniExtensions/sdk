import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useSyncExternalStore,
    type CSSProperties,
    type ReactNode,
    type ReactElement,
    type SyntheticEvent,
} from 'react';
import moment from 'moment';
import {
    presentRecordComment,
    type RecordCommentsController,
} from '../ui/recordComments.js';
import { TextareaInput } from './TextareaInput.js';

export type RecordCommentsLabels = {
    title: string;
    refresh: string;
    empty: string;
    commented: string;
    addComment: string;
    send: string;
    older: string;
    loading: string;
    close: string;
};

/** Literal strings only; a host may supply its selected language unchanged. */
export const recordCommentsLabels: RecordCommentsLabels = {
    title: 'Comments',
    refresh: 'Refresh',
    empty: 'No comments on this record',
    commented: 'Commented',
    addComment: 'Add a comment',
    send: 'Send',
    older: 'Load older comments',
    loading: 'Loading',
    close: 'Close',
};

export type CompleteRecordCommentsProps = {
    controller: RecordCommentsController;
    labels: RecordCommentsLabels;
    className?: string;
    style?: CSSProperties;
};

const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

function useCommentsView(controller: RecordCommentsController) {
    const state = useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot
    );
    const lease = useMemo(() => ({}), [controller]);
    const committed = useRef<object | null>(null);
    useCommitEffect(() => {
        committed.current = lease;
        void controller.start();
        return () => {
            if (committed.current === lease) committed.current = null;
        };
    }, [controller, lease]);
    return {
        state,
        act(action: () => unknown) {
            if (committed.current === lease) action();
        },
    };
}

function commentText(text: string, mentions: Record<string, string>) {
    return text.split(/@\[([^\]]+)\]/g).map((part, index) => {
        const known =
            index % 2 === 1 &&
            Object.prototype.hasOwnProperty.call(mentions, part);
        return h(
            'span',
            {
                key: index,
                className: known ? 'mx-sdk-comments-mention' : undefined,
            },
            known ? mentions[part] : index % 2 === 1 ? `@[${part}]` : part
        );
    });
}

/** Full rows/composer/loading/error/paging UI; no host renderer injection. */
export function CompleteRecordComments(
    props: CompleteRecordCommentsProps
): ReactElement | null {
    const { controller, labels } = props;
    const { state, act } = useCommentsView(controller);
    const titleId = useId();
    if (state.retired) return null;
    const loading =
        state.readStatus === 'idle' || state.readStatus === 'loading';
    let body: ReactNode;
    if (loading)
        body = h(
            'div',
            { role: 'status', 'data-testid': 'loading-component' },
            labels.loading
        );
    else if (state.readStatus === 'error')
        body = h('div', { role: 'alert' }, state.readError?.message);
    else
        body = h(
            'div',
            null,
            state.nextCursor != null
                ? h(
                      'button',
                      {
                          type: 'button',
                          disabled: state.loadingOlder,
                          onClick: () => act(() => controller.loadOlder()),
                      },
                      state.loadingOlder ? labels.loading : labels.older
                  )
                : null,
            state.olderError
                ? h('div', { role: 'alert' }, state.olderError.message)
                : null,
            state.history.length === 0
                ? h('p', { className: 'mx-sdk-comments-empty' }, labels.empty)
                : null,
            ...state.history.map((comment, index) => {
                const presentation = presentRecordComment(comment);
                return h(
                    'article',
                    { key: index, className: 'mx-sdk-comments-row' },
                    h(
                        'div',
                        { className: 'mx-sdk-comments-author' },
                        presentation.author
                    ),
                    h(
                        'p',
                        { className: 'mx-sdk-comments-time' },
                        `${labels.commented} ${moment(comment.createdTime).locale('en').fromNow()}`
                    ),
                    h(
                        'div',
                        { className: 'mx-sdk-comments-text' },
                        commentText(presentation.text, presentation.mentions)
                    )
                );
            })
        );
    return h(
        'section',
        {
            className: ['mx-sdk-comments', props.className]
                .filter(Boolean)
                .join(' '),
            style: props.style,
            'aria-labelledby': titleId,
        },
        h(
            'header',
            { className: 'mx-sdk-comments-header' },
            h('h2', { id: titleId }, labels.title),
            h(
                'button',
                {
                    type: 'button',
                    'aria-label': labels.refresh,
                    disabled: loading,
                    onClick: () => act(() => controller.refresh()),
                },
                labels.refresh
            )
        ),
        h('div', { className: 'mx-sdk-comments-body' }, body),
        state.readStatus === 'ready' &&
            !state.loadingOlder &&
            !state.disableSending
            ? h(
                  'footer',
                  { className: 'mx-sdk-comments-footer' },
                  h(TextareaInput, {
                      value: state.draft,
                      onChange: (event) =>
                          act(() => controller.setDraft(event.target.value)),
                      autoSize: { minRows: 2, maxRows: 5 },
                      disabled: state.sending,
                      placeholder: labels.addComment,
                      'aria-label': labels.addComment,
                      autoComplete: 'off',
                  }),
                  h(
                      'button',
                      {
                          type: 'button',
                          className: 'mx-sdk-comments-send',
                          disabled: state.sending || state.draft.length === 0,
                          onClick: () => act(() => controller.send()),
                      },
                      labels.send
                  ),
                  state.sendError
                      ? h('div', { role: 'alert' }, state.sendError.message)
                      : null
              )
            : null
    );
}

export type CompleteRecordCommentsDialogProps = CompleteRecordCommentsProps & {
    dismiss(): void;
    /** Stable invoker when the activation control is temporary, such as a menu. */
    returnFocusTo?: { readonly current: HTMLElement | null };
    reservedInlineEndWidth?: string;
    zIndex?: number;
};

type DialogEntry = { node: HTMLDialogElement; opener: Element | null };
const dialogStacks = new WeakMap<Document, DialogEntry[]>();

/** Native modal mechanics keep the SDK portable, SSR-safe and React 18/19-safe. */
export function CompleteRecordCommentsDialog(
    props: CompleteRecordCommentsDialogProps
): ReactElement | null {
    const retired = useSyncExternalStore(
        props.controller.subscribe,
        props.controller.getSnapshot,
        props.controller.getSnapshot
    ).retired;
    const node = useRef<HTMLDialogElement>(null);
    const dismiss = useRef(props.dismiss);
    useCommitEffect(() => {
        dismiss.current = props.dismiss;
    });
    useCommitEffect(() => {
        if (retired) return;
        const dialog = node.current;
        if (!dialog) return;
        const document = dialog.ownerDocument;
        const window = document.defaultView;
        const entry = {
            node: dialog,
            opener: props.returnFocusTo?.current ?? document.activeElement,
        };
        const stack = dialogStacks.get(document) ?? [];
        dialogStacks.set(document, stack);
        stack.push(entry);
        dialog.showModal();
        const controls = () =>
            Array.from(
                dialog.querySelectorAll<HTMLElement>(
                    'button:not(:disabled),textarea:not(:disabled),[tabindex="0"]'
                )
            );
        const top = () => stack[stack.length - 1] === entry;
        const keydown = (event: KeyboardEvent) => {
            if (!top() || event.isComposing) return;
            const target = document.activeElement?.closest(
                'dialog,[role="dialog"]'
            );
            if (target && target !== dialog) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                dismiss.current();
            } else if (event.key === 'Tab') {
                const items = controls();
                const first = items[0];
                const last = items[items.length - 1];
                if (
                    first &&
                    last &&
                    (event.shiftKey
                        ? document.activeElement === first
                        : document.activeElement === last)
                ) {
                    event.preventDefault();
                    (event.shiftKey ? last : first).focus();
                }
            }
        };
        const focus = (event: FocusEvent) => {
            if (
                top() &&
                event.target instanceof (window?.Node ?? Node) &&
                !dialog.contains(event.target)
            )
                controls()[0]?.focus();
        };
        window?.addEventListener('keydown', keydown, true);
        document.addEventListener('focusin', focus);
        return () => {
            window?.removeEventListener('keydown', keydown, true);
            document.removeEventListener('focusin', focus);
            const wasTop = top();
            const index = stack.indexOf(entry);
            // A lower dialog can unmount before its successor. Preserve the
            // opener chain instead of later focusing that removed subtree.
            for (const successor of stack)
                if (successor.opener && dialog.contains(successor.opener))
                    successor.opener = entry.opener;
            if (index !== -1) stack.splice(index, 1);
            dialog.close();
            if (
                wasTop &&
                entry.opener instanceof (window?.HTMLElement ?? HTMLElement) &&
                entry.opener.isConnected
            )
                entry.opener.focus({ preventScroll: true });
        };
    }, [retired]);
    const style: CSSProperties & {
        '--mx-sdk-comments-reserved-inline-end'?: string;
    } = {
        ...props.style,
        zIndex: props.zIndex,
        '--mx-sdk-comments-reserved-inline-end': props.reservedInlineEndWidth,
    };
    if (retired) return null;
    return h(
        'dialog',
        {
            ref: node,
            'aria-label': props.labels.title,
            className: 'mx-sdk-comments-dialog',
            style,
            onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
                event.preventDefault();
                event.stopPropagation();
                props.dismiss();
            },
        },
        h('div', {
            className: 'mx-sdk-comments-overlay',
            'aria-hidden': true,
            'data-testid': 'dialog-overlay-test-id',
            onClick: props.dismiss,
        }),
        h(
            'div',
            {
                className: 'mx-sdk-comments-panel',
                'data-testid': 'dialog-test-id',
            },
            h(CompleteRecordComments, props),
            h(
                'button',
                {
                    type: 'button',
                    className: 'mx-sdk-comments-close',
                    'aria-label': props.labels.close,
                    'data-testid': 'close-dialog',
                    onClick: props.dismiss,
                },
                '×'
            )
        )
    );
}
