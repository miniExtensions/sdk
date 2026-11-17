import {
    createElement as h,
    Fragment,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    type CSSProperties,
    type ComponentType,
    type ReactElement,
    type ReactNode,
    type SyntheticEvent,
} from 'react';

export type FormReviewItem = {
    id: string;
    title: string;
    semanticTitle: string;
    /** Already admitted readonly leaf presentation, never a draft or Save capability. */
    value: ReactNode;
};

export type FormReviewDialogFrameProps = {
    title: string;
    onDismiss(): void;
    children?: ReactNode;
};

export type CompleteFormReviewProps = {
    open: boolean;
    /** Host modal primitive only. SDK retains the complete panel and controls. */
    dialogFrame?: ComponentType<FormReviewDialogFrameProps>;
    items: readonly FormReviewItem[];
    title: string;
    editLabel: string;
    confirmLabel: string;
    emptyLabel: string;
    onEdit(): void;
    onDismiss(): void;
    onConfirm(): unknown;
    confirmDisabled?: boolean;
    returnFocusTo?: { readonly current: HTMLElement | null };
    reservedInlineEndWidth?: string;
    className?: string;
    style?: CSSProperties;
};

type DialogEntry = { node: HTMLDialogElement; opener: Element | null };
const dialogStacks = new WeakMap<Document, DialogEntry[]>();
const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** Complete live Review presentation. The supplied actions retain native admission and Save. */
export function CompleteFormReview(
    props: CompleteFormReviewProps
): ReactElement | null {
    const node = useRef<HTMLDialogElement>(null);
    const dismiss = useRef(props.onDismiss);
    const instanceId = useId();
    useCommitEffect(() => {
        dismiss.current = props.onDismiss;
    });
    useCommitEffect(() => {
        if (!props.open || props.dialogFrame) return;
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
                    'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'
                )
            ).filter((element) => !element.closest('[hidden]'));
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
        controls()[0]?.focus({ preventScroll: true });
        return () => {
            window?.removeEventListener('keydown', keydown, true);
            document.removeEventListener('focusin', focus);
            const wasTop = top();
            const index = stack.indexOf(entry);
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
    }, [props.open, props.dialogFrame]);
    if (!props.open) return null;
    const style: CSSProperties & {
        '--mx-sdk-form-review-reserved-inline-end'?: string;
    } = {
        ...props.style,
        '--mx-sdk-form-review-reserved-inline-end':
            props.reservedInlineEndWidth,
    };
    const panel = h(
        'div',
        {
            className: 'mx-sdk-form-review-panel',
            'data-testid': props.dialogFrame ? undefined : 'dialog-test-id',
        },
        h(
            'header',
            { className: 'mx-sdk-form-review-header' },
            h(
                'button',
                {
                    type: 'button',
                    className: 'mx-sdk-form-review-edit',
                    onClick: props.onEdit,
                },
                h(
                    'svg',
                    {
                        className: 'mx-sdk-form-review-icon',
                        viewBox: '0 0 20 20',
                        fill: 'currentColor',
                        'aria-hidden': true,
                    },
                    h('path', {
                        fillRule: 'evenodd',
                        d: 'M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z',
                        clipRule: 'evenodd',
                    })
                ),
                props.editLabel
            ),
            h(
                'h2',
                {
                    id: `${instanceId}-title`,
                    className: 'mx-sdk-form-review-title',
                },
                props.title
            )
        ),
        h(
            'div',
            { className: 'mx-sdk-form-review-body' },
            props.items.length === 0
                ? h(
                      'p',
                      { className: 'mx-sdk-form-review-empty' },
                      h(
                          'svg',
                          {
                              className: 'mx-sdk-form-review-icon',
                              viewBox: '0 0 20 20',
                              fill: 'currentColor',
                              'aria-hidden': true,
                          },
                          h('path', {
                              fillRule: 'evenodd',
                              d: 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm4.72-11.66a6.5 6.5 0 0 1-9.06 9.06l9.06-9.06ZM4.6 14.34a6.5 6.5 0 0 1 9.06-9.06L4.6 14.34Z',
                              clipRule: 'evenodd',
                          })
                      ),
                      props.emptyLabel
                  )
                : h(
                      'dl',
                      { className: 'mx-sdk-form-review-list' },
                      props.items.map((item, index) => {
                          const labelId = `${instanceId}-field-${index}`;
                          return h(
                              Fragment,
                              { key: item.id },
                              h(
                                  'dt',
                                  {
                                      id: labelId,
                                      className: `mx-sdk-form-review-label${
                                          item.title.length === 0
                                              ? ' mx-sdk-form-review-label--hidden sr-only'
                                              : ''
                                      }`,
                                  },
                                  item.title.length === 0
                                      ? item.semanticTitle
                                      : item.title
                              ),
                              h(
                                  'dd',
                                  {
                                      className: 'mx-sdk-form-review-value',
                                      'aria-labelledby': labelId,
                                  },
                                  item.value
                              )
                          );
                      })
                  )
        ),
        h(
            'footer',
            { className: 'mx-sdk-form-review-footer' },
            h(
                'button',
                {
                    type: 'button',
                    className: 'mx-sdk-form-review-confirm',
                    disabled: props.confirmDisabled,
                    onClick: () => {
                        props.onConfirm();
                    },
                },
                props.confirmLabel
            )
        )
    );
    if (props.dialogFrame) {
        return h(props.dialogFrame, {
            title: props.title,
            onDismiss: props.onDismiss,
            children: panel,
        });
    }
    return h(
        'dialog',
        {
            ref: node,
            'aria-labelledby': `${instanceId}-title`,
            className: ['mx-sdk-form-review-dialog', props.className]
                .filter(Boolean)
                .join(' '),
            style,
            onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
                event.preventDefault();
                event.stopPropagation();
                props.onDismiss();
            },
        },
        h('div', {
            className: 'mx-sdk-form-review-overlay',
            'aria-hidden': true,
            'data-testid': 'dialog-overlay-test-id',
            onClick: props.onDismiss,
        }),
        panel
    );
}
