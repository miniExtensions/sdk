import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    type CSSProperties,
    type FormEvent,
    type KeyboardEvent,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import { TextInput } from './TextInput.js';
import {
    usePortalSearchGate,
    type PortalSearchGateOptions,
} from './usePortalSearchGate.js';

export type PortalSearchGateProps = PortalSearchGateOptions & {
    inputId?: string;
    ariaLabel?: string;
    className?: string;
    /** Optional native maker decoration; never the prompt or its state owner. */
    headerActions?: ReactNode;
    /** Portable container-local theme/layout values, with no app-context import. */
    accentColor?: string;
    focusColor?: string;
    reservedInlineEndWidth?: string;
    zIndex?: number;
    panelTestId?: string;
    overlayTestId?: string;
};

type GateStyle = CSSProperties & {
    '--mx-sdk-search-accent'?: string;
    '--mx-sdk-search-focus'?: string;
    '--mx-sdk-search-reserved-inline-end'?: string;
};

// Preserve the native prompt's required Tab loop at both visible-control ends.
// This does not identify the previous browser failure's focus destination.
function containTab(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const dialog = event.currentTarget;
    // Do not act as FocusLock or steal a nested/portalled dialog's keyboard.
    if (
        dialog.ownerDocument.activeElement?.closest(
            'dialog,[role="dialog"]'
        ) !== dialog
    )
        return;
    const controls = [
        ...dialog.querySelectorAll<HTMLElement>(
            'a[href],area[href],button,input,select,textarea,summary,[tabindex]'
        ),
    ]
        .filter((element) => {
            if (
                element.tabIndex < 0 ||
                element.matches(':disabled,input[type="hidden"]')
            )
                return false;
            for (
                let node: HTMLElement | null = element;
                node && node !== dialog;
                node = node.parentElement
            ) {
                const style =
                    node.ownerDocument.defaultView?.getComputedStyle(node);
                if (
                    node.hidden ||
                    node.hasAttribute('inert') ||
                    style?.display === 'none' ||
                    style?.visibility === 'hidden' ||
                    style?.visibility === 'collapse'
                )
                    return false;
            }
            return true;
        })
        .sort((a, b) => {
            // Positive tabindex precedes the ordinary DOM-order zero cohort.
            const priority = (node: HTMLElement) =>
                node.tabIndex > 0 ? node.tabIndex : Infinity;
            const left = priority(a);
            const right = priority(b);
            return left === right ? 0 : left - right;
        });
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
        event.preventDefault();
        dialog.focus();
    } else if (event.shiftKey && dialog.ownerDocument.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && dialog.ownerDocument.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

/**
 * Complete blocking prompt. The native dialog owns modal focus/inertness; the
 * caller still owns gate admission, record access, navigation and unmounting.
 * Requires HTMLDialogElement.showModal in the browser; import/SSR do not use DOM.
 */
export function PortalSearchGate(props: PortalSearchGateProps) {
    const state = usePortalSearchGate(props);
    const generatedId = useId();
    const inputId = props.inputId ?? `${generatedId}-search`;
    const titleId = `${generatedId}-title`;
    const descriptionId = `${generatedId}-description`;
    const errorId = `${generatedId}-error`;
    const dialog = useRef<HTMLDialogElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        const node = dialog.current;
        if (node == null) return;
        node.showModal();
        input.current?.focus();
        // Close while connected: removal first clears the browser's modal
        // lifetime, so a later passive close cannot restore its opener focus.
        return () => node.close();
    }, []);
    const style: GateStyle = {
        '--mx-sdk-search-accent': props.accentColor,
        '--mx-sdk-search-focus': props.focusColor,
        '--mx-sdk-search-reserved-inline-end': props.reservedInlineEndWidth,
        zIndex: props.zIndex,
    };
    return h(
        'dialog',
        {
            ref: dialog,
            className: ['mx-sdk-search-gate', props.className]
                .filter(Boolean)
                .join(' '),
            style,
            'aria-labelledby':
                props.ariaLabel == null && state.title ? titleId : undefined,
            'aria-label':
                props.ariaLabel ?? (state.title ? undefined : 'Search'),
            'aria-describedby': descriptionId,
            onCancel: (event: SyntheticEvent<HTMLDialogElement>) =>
                event.preventDefault(),
            onKeyDown: containTab,
        },
        h('div', {
            className: 'mx-sdk-search-gate-overlay',
            'aria-hidden': true,
            'data-testid': props.overlayTestId,
        }),
        h(
            'section',
            {
                className: 'mx-sdk-search-gate-panel',
                'data-testid': props.panelTestId,
            },
            h(
                'header',
                { className: 'mx-sdk-search-gate-header' },
                h('h2', { id: titleId }, state.title),
                props.headerActions
            ),
            h(
                'div',
                { className: 'mx-sdk-search-gate-body' },
                h('p', { id: descriptionId }, state.description),
                state.showError
                    ? h(
                          'div',
                          {
                              className: 'mx-sdk-search-gate-error',
                              id: errorId,
                          },
                          h(
                              'svg',
                              {
                                  viewBox: '0 0 20 20',
                                  'aria-hidden': true,
                                  focusable: 'false',
                              },
                              h('circle', { cx: 10, cy: 10, r: 9 }),
                              h('path', { d: 'M7 7l6 6m0-6-6 6' })
                          ),
                          h('p', null, state.noResultsMessage)
                      )
                    : null,
                h(
                    'form',
                    {
                        onSubmit: (event: FormEvent<HTMLFormElement>) => {
                            event.preventDefault();
                            state.submit();
                        },
                    },
                    h(
                        'div',
                        { className: 'mx-sdk-search-gate-field' },
                        h(
                            'label',
                            { htmlFor: inputId },
                            props.searchPageField.fieldName
                        ),
                        h(TextInput, {
                            ref: input,
                            id: inputId,
                            type: 'text',
                            value: state.searchTerm,
                            placeholder: state.placeholder,
                            'aria-describedby': state.showError
                                ? `${descriptionId} ${errorId}`
                                : descriptionId,
                            'aria-invalid': state.showError,
                            onChange: (event) =>
                                state.setSearchTerm(event.target.value),
                        })
                    ),
                    h(
                        'div',
                        { className: 'mx-sdk-search-gate-actions' },
                        h(
                            'button',
                            { type: 'submit', disabled: state.disabled },
                            props.hasNoResults ? 'Search Again' : 'Continue'
                        ),
                        props.hasNoResults
                            ? h(
                                  'button',
                                  {
                                      type: 'button',
                                      className: 'mx-sdk-search-gate-clear',
                                      onClick: state.clear,
                                  },
                                  'Clear'
                              )
                            : null
                    )
                )
            )
        )
    );
}
