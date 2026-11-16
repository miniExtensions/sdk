import { createElement as h, type ReactElement, type ReactNode } from 'react';

/** Already-authorized, already-formatted private display text; not log-safe. */
export type PortalSummaryCard = Readonly<{
    fieldId: string;
    fieldName: string;
    readable: string;
}>;

export type PortalSummaryFieldsHeight =
    | 'short'
    | 'medium'
    | 'tall'
    | 'extra tall';

export type PortalSummaryCardsProps = Readonly<{
    /** Ordered unique fields, normally selected with projectPortalSummaryFields. */
    cards: readonly PortalSummaryCard[];
    height?: PortalSummaryFieldsHeight;
    hideTitles?: boolean;
    /**
     * Optional explicit host authoring composition around complete SDK content.
     * The host owns permissions, modal state and any actions. Called during
     * render; keep it pure. No command-retirement guarantee is introduced.
     */
    decorateCard?: (
        card: PortalSummaryCard,
        content: ReactElement
    ) => ReactNode;
}>;

/**
 * Complete passive parent-record summary presentation. Import
 * portal-summary-cards.css. Formatting, eligibility and record admission remain
 * with the host; rendering does not read, save, refresh or authenticate.
 */
export function PortalSummaryCards({
    cards,
    height = 'short',
    hideTitles,
    decorateCard,
}: PortalSummaryCardsProps): ReactElement | null {
    if (cards.length === 0) return null;
    return h(
        'dl',
        { className: 'mx-sdk-portal-summary-cards', 'data-height': height },
        cards.map((card) => {
            const content = h(
                'div',
                { className: 'mx-sdk-portal-summary-card' },
                hideTitles !== true &&
                    h(
                        'dt',
                        { className: 'mx-sdk-portal-summary-title' },
                        card.fieldName
                    ),
                h(
                    'dd',
                    {
                        className: 'mx-sdk-portal-summary-value',
                        title: card.readable,
                    },
                    card.readable
                )
            );
            return h(
                'div',
                { key: card.fieldId, className: 'mx-sdk-portal-summary-slot' },
                decorateCard ? decorateCard(card, content) : content
            );
        })
    );
}
