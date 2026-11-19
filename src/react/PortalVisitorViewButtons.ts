import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
    type ReactElement,
} from 'react';

export type PortalVisitorViewButton = {
    readonly id: string;
    readonly label: string | null;
    readonly showBadge?: boolean;
};

export type PortalVisitorViewButtonsProps = {
    /** The host's eligible views, in presentation order. */
    views: readonly PortalVisitorViewButton[];
    selectedViewId: string | null;
    /** Replace this token whenever the host retires the current view authority. */
    ownerToken: unknown;
    unnamedViewLabel: string;
    groupLabel?: string;
    testId?: string;
    /** A selection intent. The host checks current authority before applying it. */
    onSelect(viewId: string): void;
};

type Press = { placement: object; viewId: string };

const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

export function PortalVisitorViewButtons({
    views,
    selectedViewId,
    ownerToken,
    unnamedViewLabel,
    groupLabel,
    testId,
    onSelect,
}: PortalVisitorViewButtonsProps): ReactElement | null {
    const placement = useMemo(() => ({}), [ownerToken]);
    const pointerPress = useRef<Press | null>(null);
    const keyboardPress = useRef<Press | null>(null);
    const selection = useMemo(
        () => ({ views, selectedViewId, onSelect }),
        [views, selectedViewId, onSelect]
    );
    const currentSelection = useRef<typeof selection | null>(null);
    useCommitEffect(() => {
        currentSelection.current = selection;
        return () => {
            currentSelection.current = null;
        };
    }, [selection]);

    if (views.length < 2) return null;
    return h(
        'div',
        {
            'aria-label': groupLabel,
            'data-testid': testId,
            className: 'me-portal-visitor-view-buttons',
            role: groupLabel ? 'group' : undefined,
        },
        views.map(({ id, label, showBadge }) =>
            h(
                'button',
                {
                    key: id,
                    type: 'button',
                    className: 'me-portal-visitor-view-button',
                    'aria-pressed': selectedViewId === id,
                    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
                        if (event.isPrimary && event.button === 0)
                            pointerPress.current = { placement, viewId: id };
                    },
                    onPointerCancel: (
                        event: PointerEvent<HTMLButtonElement>
                    ) => {
                        if (event.isPrimary) pointerPress.current = null;
                    },
                    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                        if (event.key !== ' ' && event.key !== 'Enter') return;
                        if (event.repeat) event.preventDefault();
                        else keyboardPress.current = { placement, viewId: id };
                    },
                    onBlur: () => {
                        if (keyboardPress.current?.viewId === id)
                            keyboardPress.current = null;
                    },
                    onClick: (event: MouseEvent<HTMLButtonElement>) => {
                        const press =
                            event.detail === 0 ? keyboardPress : pointerPress;
                        const origin = press.current;
                        press.current = null;
                        if (
                            origin &&
                            (origin.placement !== placement ||
                                origin.viewId !== id)
                        )
                            return;
                        if (
                            currentSelection.current === selection &&
                            selection.selectedViewId !== id
                        )
                            selection.onSelect(id);
                    },
                },
                showBadge
                    ? h('span', {
                          'aria-hidden': true,
                          className: 'me-portal-visitor-view-button__badge',
                      })
                    : null,
                h(
                    'span',
                    { className: 'me-portal-visitor-view-button__label' },
                    label ?? unnamedViewLabel
                )
            )
        )
    );
}
