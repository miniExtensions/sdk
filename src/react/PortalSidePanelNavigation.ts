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
import type { AdjacentChildNavigationInput } from '../ui/childNavigationCompatibility.js';

export type PortalSidePanelNavigationFrame = Readonly<{
    /** Replace on every accepted frame replacement, even when the record stays the same. */
    ownerToken: object;
    sourceExtensionSessionId: string;
    sourceRecordId: string;
    previousRecordId: string | null;
    nextRecordId: string | null;
}>;

export type PortalSidePanelNavigationRequest = AdjacentChildNavigationInput &
    Readonly<{
        ownerToken: object;
        sourceRecordId: string;
        signal: AbortSignal;
    }>;

export type PortalSidePanelNavigationProps = {
    /** The accepted linked-record side panel. Use null for a direct URL. */
    frame: PortalSidePanelNavigationFrame | null;
    labels: Readonly<{ previous: string; next: string; group?: string }>;
    /** Decorative button icons. Existing labels remain the accessible names. */
    icons?: Readonly<{ previous: ReactElement; next: ReactElement }>;
    /** Read the host's live admission for the supplied source frame and exact neighbor. */
    isCurrent(request: PortalSidePanelNavigationRequest): boolean;
    /** Let the existing host dismissal flow retain or discard the open draft. */
    confirmDismissal(
        request: PortalSidePanelNavigationRequest
    ): boolean | Promise<boolean>;
    /** Resolve and open the exact attached neighbor under the host's current admission. */
    openAdjacent(
        request: PortalSidePanelNavigationRequest
    ): void | Promise<void>;
};

type Direction = AdjacentChildNavigationInput['type'];
type Press = { placement: object; direction: Direction };
const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** Previous/Next intentions for the host-owned linked-record side panel. */
export function PortalSidePanelNavigation({
    frame,
    labels,
    icons,
    isCurrent,
    confirmDismissal,
    openAdjacent,
}: PortalSidePanelNavigationProps): ReactElement | null {
    const token = frame?.ownerToken;
    const sourceExtensionSessionId = frame?.sourceExtensionSessionId;
    const sourceRecordId = frame?.sourceRecordId;
    const previous = frame?.previousRecordId ?? null;
    const next = frame?.nextRecordId ?? null;
    const placement = useMemo(
        () => ({}),
        [token, sourceExtensionSessionId, sourceRecordId, previous, next]
    );
    const pointerPress = useRef<Press | null>(null);
    const keyboardPress = useRef<Press | null>(null);
    const pending = useRef<AbortController | null>(null);
    const current = useRef<{
        placement: object;
        isCurrent: PortalSidePanelNavigationProps['isCurrent'];
        confirmDismissal: PortalSidePanelNavigationProps['confirmDismissal'];
        openAdjacent: PortalSidePanelNavigationProps['openAdjacent'];
    } | null>(null);

    useCommitEffect(() => {
        current.current = {
            placement,
            isCurrent,
            confirmDismissal,
            openAdjacent,
        };
        return () => {
            current.current = null;
        };
    }, [placement, isCurrent, confirmDismissal, openAdjacent]);
    useCommitEffect(
        () => () => {
            const retired = pending.current;
            pending.current = null;
            retired?.abort();
        },
        [placement]
    );

    if (!token || !sourceExtensionSessionId || !sourceRecordId) return null;
    if (previous === null && next === null) return null;

    const activate = async (type: Direction, recordId: string) => {
        if (pending.current || current.current?.placement !== placement) return;
        const attempt = new AbortController();
        pending.current = attempt;
        const request: PortalSidePanelNavigationRequest = {
            type,
            recordId,
            sourceExtensionSessionId,
            sourceRecordId,
            ownerToken: token,
            signal: attempt.signal,
        };
        const admitted = () => {
            const owner = current.current;
            const held = () =>
                !attempt.signal.aborted &&
                pending.current === attempt &&
                current.current === owner;
            return owner?.placement === placement &&
                held() &&
                owner.isCurrent(request) &&
                held()
                ? owner
                : null;
        };

        try {
            const owner = admitted();
            if (!owner || (await owner.confirmDismissal(request)) !== true)
                return;
            const accepted = admitted();
            if (accepted) await accepted.openAdjacent(request);
        } catch {
            // A refused dismissal/read does not open a neighbor.
        } finally {
            if (pending.current === attempt) pending.current = null;
            attempt.abort();
        }
    };

    const button = (direction: Direction, recordId: string | null) =>
        h(
            'button',
            {
                type: 'button',
                disabled: recordId === null,
                'aria-label': icons ? labels[direction] : undefined,
                className: 'me-portal-side-panel-navigation__button',
                onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
                    if (event.isPrimary && event.button === 0)
                        pointerPress.current = { placement, direction };
                },
                onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => {
                    if (event.isPrimary) pointerPress.current = null;
                },
                onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                    if (event.key !== ' ' && event.key !== 'Enter') return;
                    if (event.repeat) event.preventDefault();
                    else keyboardPress.current = { placement, direction };
                },
                onBlur: () => {
                    if (keyboardPress.current?.direction === direction)
                        keyboardPress.current = null;
                },
                onClick: (event: MouseEvent<HTMLButtonElement>) => {
                    const press =
                        event.detail === 0 ? keyboardPress : pointerPress;
                    const origin = press.current;
                    press.current = null;
                    if (
                        recordId === null ||
                        (origin &&
                            (origin.placement !== placement ||
                                origin.direction !== direction))
                    )
                        return;
                    void activate(direction, recordId);
                },
            },
            icons
                ? h('span', { 'aria-hidden': true }, icons[direction])
                : labels[direction]
        );

    return h(
        'div',
        {
            'aria-label': labels.group,
            role: labels.group ? 'group' : undefined,
            className: 'me-portal-side-panel-navigation',
        },
        button('previous', previous),
        button('next', next)
    );
}
