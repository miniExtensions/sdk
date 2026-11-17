import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    type ReactElement,
} from 'react';
import type { PortalMapProviderOwner } from '../portals/map/providerCoordinator.js';
import {
    LinkedFinderCard,
    type LinkedFinderCardProjection,
    type LinkedFinderMapCardProjection,
} from './LinkedFinderCard.js';

export type PortalMapCardProjection =
    | LinkedFinderMapCardProjection
    | Extract<
          LinkedFinderCardProjection,
          { status: 'loading' | 'unavailable' }
      >;
export type PortalMapCardData = Readonly<{
    recordId: string;
    /** Exact admitted presentation identity; replace on record/field/view ABA. */
    identity: object;
    owner: PortalMapProviderOwner;
    accessibleLabel: string;
    projection: PortalMapCardProjection;
    /** Independently admitted current host capability. Projection data grants nothing. */
    open?: Readonly<{
        label: string;
        activate: () => void;
        registerTrigger?: (element: HTMLButtonElement) => () => void;
    }> | null;
    needsReviewLabel?: string | null;
}>;

function currentOwner(owner: PortalMapProviderOwner): boolean {
    try {
        return owner.isCurrent() === true;
    } catch {
        return false;
    }
}
const useCommittedEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

/** Shared real card presentation, with no unlink surface or native renderer slot. */
export function PortalMapCard({
    card,
}: {
    card: PortalMapCardData;
}): ReactElement {
    const receipt = useMemo(
        () => ({ owner: card.owner, identity: card.identity, open: card.open }),
        [card.owner, card.identity, card.open]
    );
    const committed = useRef<typeof receipt | null>(null);
    const button = useRef<HTMLButtonElement>(null);
    const live = () =>
        committed.current === receipt &&
        currentOwner(receipt.owner) &&
        committed.current === receipt;
    useCommittedEffect(() => {
        committed.current = receipt;
        let dispose: (() => void) | undefined;
        let observer: MutationObserver | undefined;
        let retired = false;
        let attempted = false;
        const element = button.current;
        const registerTrigger = receipt.open?.registerTrigger;
        const stopWaiting = () => {
            observer?.disconnect();
            observer = undefined;
        };
        if (element && registerTrigger && live()) {
            const sameLiveButton = () =>
                !retired && live() && button.current === element;
            const registerConnected = () => {
                if (attempted) return;
                if (!sameLiveButton()) {
                    retired = true;
                    stopWaiting();
                    return;
                }
                if (!element.isConnected) return;
                attempted = true;
                stopWaiting();
                const release = registerTrigger(element);
                if (!sameLiveButton() || !element.isConnected) release();
                else dispose = release;
            };
            if (element.isConnected) registerConnected();
            else {
                // OverlayView can attach its real portal container after this effect.
                // Observe only this button's document until that same button connects.
                const Observer =
                    element.ownerDocument.defaultView?.MutationObserver;
                if (Observer) {
                    observer = new Observer(registerConnected);
                    observer.observe(element.ownerDocument, {
                        childList: true,
                        subtree: true,
                    });
                    registerConnected();
                }
            }
        }
        return () => {
            retired = true;
            if (committed.current === receipt) committed.current = null;
            stopWaiting();
            // This disposer belongs only to the captured registration, not a record-ID lookup.
            const release = dispose;
            dispose = undefined;
            release?.();
        };
    }, [receipt]);
    return h(
        'div',
        {
            className: 'mx-sdk-portal-map-card',
            role: 'group',
            'aria-label': card.accessibleLabel,
        },
        h(LinkedFinderCard, { projection: card.projection }),
        card.open
            ? h('button', {
                  type: 'button',
                  ref: button,
                  className: 'mx-sdk-portal-map-open',
                  'aria-label': card.open.label,
                  onClick: () => {
                      if (live()) receipt.open?.activate();
                  },
              })
            : null,
        card.needsReviewLabel != null
            ? h('span', {
                  className: 'mx-sdk-portal-map-review',
                  role: 'img',
                  'aria-label': card.needsReviewLabel,
              })
            : null
    );
}
