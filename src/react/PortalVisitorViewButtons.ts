import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
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
    unnamedViewLabel: string;
    groupLabel?: string;
    testId?: string;
    /** A selection intent. The host checks current authority before applying it. */
    onSelect(viewId: string): void;
};

const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

export function PortalVisitorViewButtons({
    views,
    selectedViewId,
    unnamedViewLabel,
    groupLabel,
    testId,
    onSelect,
}: PortalVisitorViewButtonsProps): ReactElement | null {
    // A retired click cannot become current when the same view returns.
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
                    onClick: () => {
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
