import { createElement } from 'react';
import { projectPortalSummaryFields } from '@miniextensions/sdk/portals';
import {
    PortalSummaryCards,
    type PortalSummaryCard,
    type PortalSummaryCardsProps,
} from '@miniextensions/sdk/react';

const selected = projectPortalSummaryFields({
    summaryFieldIds: ['balance', 'balance', 'deleted'],
    fieldIdsToSchemas: {
        balance: { airtableField: { name: 'Account balance' } },
    },
});
const cards: readonly PortalSummaryCard[] = selected.map((field) => ({
    ...field,
    readable: '0.00',
}));
const props: PortalSummaryCardsProps = { cards, height: 'medium' };
createElement(PortalSummaryCards, props);
createElement(PortalSummaryCards, {
    ...props,
    decorateCard: (card, content) =>
        createElement('section', { 'data-host-field': card.fieldId }, content),
});

// @ts-expect-error card display DTOs are immutable
cards[0]!.readable = 'replacement';
// @ts-expect-error the card collection is immutable
props.cards.push({ fieldId: 'x', fieldName: 'X', readable: '' });
// @ts-expect-error raw values must be formatted by the host before rendering
const rawText: PortalSummaryCard['readable'] = false;
const readAuthority: Parameters<typeof projectPortalSummaryFields>[0] = {
    summaryFieldIds: [],
    fieldIdsToSchemas: {},
    // @ts-expect-error summary projection never accepts read authority
    fetchRecord() {},
};
void rawText;
void readAuthority;
