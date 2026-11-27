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
type BoundaryFocus = {
    placement: object;
    source: HTMLButtonElement;
    request: PortalSidePanelNavigationRequest;
    destination: HTMLButtonElement | null;
    opened: boolean;
    clear(): void;
    apply(): void;
};
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
    const previousButton = useRef<HTMLButtonElement>(null);
    const nextButton = useRef<HTMLButtonElement>(null);
    const boundaryFocus = useRef<BoundaryFocus | null>(null);
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
    useCommitEffect(() => () => boundaryFocus.current?.clear(), []);
    useCommitEffect(() => {
        const handoff = boundaryFocus.current;
        if (!handoff || handoff.placement === placement) return;
        const fromNext = handoff.request.type === 'next';
        const reverseRecord = fromNext ? previous : next;
        const destination = fromNext
            ? previousButton.current
            : nextButton.current;
        if (
            handoff.destination !== null ||
            sourceRecordId !== handoff.request.recordId ||
            reverseRecord !== handoff.request.sourceRecordId ||
            !handoff.source.disabled ||
            !destination ||
            destination.disabled
        ) {
            handoff.clear();
            return;
        }
        // The destination may commit before an asynchronous open settles.
        handoff.destination = destination;
        handoff.apply();
    }, [placement, sourceRecordId, previous, next]);

    if (!token || !sourceExtensionSessionId || !sourceRecordId) return null;
    if (previous === null && next === null) return null;

    const watchBoundaryFocus = (
        source: HTMLButtonElement,
        request: PortalSidePanelNavigationRequest
    ): BoundaryFocus => {
        const document = source.ownerDocument;
        const window = document.defaultView;
        const handoff: BoundaryFocus = {
            placement,
            source,
            request,
            destination: null,
            opened: false,
            clear() {
                if (boundaryFocus.current !== handoff) return;
                boundaryFocus.current = null;
                document.removeEventListener('focusin', focusMoved, true);
                document.removeEventListener(
                    'pointerdown',
                    handoff.clear,
                    true
                );
                window?.removeEventListener('blur', handoff.clear);
            },
            apply() {
                const destination = handoff.destination;
                if (
                    boundaryFocus.current !== handoff ||
                    !handoff.opened ||
                    !destination
                )
                    return;
                handoff.clear();
                const active = document.activeElement;
                if (
                    source.isConnected &&
                    destination.isConnected &&
                    !destination.disabled &&
                    (active === source ||
                        active === document.body ||
                        active === document.documentElement)
                )
                    destination.focus({ preventScroll: true });
            },
        };
        function focusMoved(event: FocusEvent) {
            if (
                event.target !== source &&
                event.target !== document.body &&
                event.target !== document.documentElement
            )
                handoff.clear();
        }
        boundaryFocus.current = handoff;
        document.addEventListener('focusin', focusMoved, true);
        document.addEventListener('pointerdown', handoff.clear, true);
        window?.addEventListener('blur', handoff.clear);
        return handoff;
    };

    const activate = async (
        type: Direction,
        recordId: string,
        focusSource: HTMLButtonElement | null
    ) => {
        if (pending.current || current.current?.placement !== placement) return;
        boundaryFocus.current?.clear();
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

        let handoff: BoundaryFocus | undefined;
        try {
            const owner = admitted();
            if (!owner || (await owner.confirmDismissal(request)) !== true)
                return;
            const accepted = admitted();
            if (!accepted) return;
            if (
                focusSource &&
                focusSource.ownerDocument.activeElement === focusSource
            )
                handoff = watchBoundaryFocus(focusSource, request);
            await accepted.openAdjacent(request);
            if (handoff) {
                handoff.opened = true;
                handoff.apply();
            }
        } catch {
            handoff?.clear();
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
                ref: direction === 'previous' ? previousButton : nextButton,
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
                    void activate(
                        direction,
                        recordId,
                        event.detail === 0 && origin
                            ? event.currentTarget
                            : null
                    );
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
