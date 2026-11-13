import {
    createElement as h,
    useMemo,
    useRef,
    useEffect,
    type KeyboardEvent,
    type ReactElement,
} from 'react';
import {
    projectKanbanColumns,
    createKanbanCategoryOperation,
    type KanbanProjectionInput,
    type KanbanCategoryInvocation,
} from '../portals/kanban.js';
import {
    LinkedFinderCard,
    type LinkedFinderCardProjection,
} from './LinkedFinderCard.js';
import type { KanbanItems } from './kanban/Board.js';
import { KanbanBoard } from './kanban/BoardLoader.js';
import { useStateWithDeps } from './kanban/projectionState.js';

export type KanbanCard = Readonly<{
    recordId: string;
    accessibleLabel: string;
    projection: LinkedFinderCardProjection;
    /** Current native admission only; data/config do not grant these actions. */
    open?: Readonly<{ label: string; activate: () => void }> | null;
    unlink?: Readonly<{
        label: string;
        description: string;
        pending: boolean;
        disabled: boolean;
        activate: () => void;
    }> | null;
    needsReviewLabel?: string | null;
}>;
export type KanbanProps<OriginalRecord, LoggedInRecord> = Readonly<{
    projection: KanbanProjectionInput;
    cards: readonly KanbanCard[];
    captureCategoryInvocation: (
        recordId: string
    ) => KanbanCategoryInvocation<OriginalRecord, LoggedInRecord>;
    readOnly: boolean;
    /** Native adapter supplies the all-session modal-open state. */
    modalOpen: boolean;
    className?: string;
    label: string;
}>;
function Card({ card }: { card: KanbanCard }): ReactElement {
    return h(
        'div',
        {
            className: 'mx-sdk-kanban-card',
            role: 'group',
            'aria-label': card.accessibleLabel,
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
                if (event.key === 'Enter' || event.key === ' ')
                    event.stopPropagation();
            },
        },
        h(
            'div',
            { className: 'mx-sdk-kanban-card-content' },
            h(LinkedFinderCard, { projection: card.projection })
        ),
        card.open
            ? h('button', {
                  type: 'button',
                  className: 'mx-sdk-kanban-open',
                  onClick: card.open.activate,
                  'aria-label': card.open.label,
              })
            : null,
        card.needsReviewLabel != null
            ? h('span', {
                  className: 'mx-sdk-kanban-review',
                  role: 'img',
                  'aria-label': card.needsReviewLabel,
              })
            : null,
        card.unlink
            ? h(
                  'button',
                  {
                      type: 'button',
                      className: 'mx-sdk-kanban-unlink',
                      disabled: card.unlink.disabled,
                      'aria-busy': card.unlink.pending,
                      title: card.unlink.description,
                      'aria-label': card.unlink.label,
                      onClick: card.unlink.activate,
                  },
                  card.unlink.pending
                      ? h('span', {
                            className: 'mx-sdk-kanban-spinner',
                            'aria-hidden': true,
                        })
                      : h('span', { 'aria-hidden': true }, '−')
              )
            : null
    );
}
/** Complete board over admitted card data and captured native mutation ports. */
export function Kanban<OriginalRecord, LoggedInRecord>(
    props: KanbanProps<OriginalRecord, LoggedInRecord>
): ReactElement {
    const source = props.projection;
    const projected = useMemo(
        () =>
            projectKanbanColumns(source).map((column) => ({
                ...column,
                recordIds: [...column.recordIds],
            })),
        [
            source.categoryFieldId,
            source.fields,
            source.recordIds,
            source.readRecord,
            source.uncategorizedLabel,
            source.hideEmptyColumns,
        ]
    );
    // A new authoritative snapshot or policy retires only unallocated drag UI.
    // The captured category operation continues independently after allocation.
    const [epoch] = useStateWithDeps<number>(
        (previous) => (previous ?? -1) + 1,
        [projected, props.readOnly, props.modalOpen]
    );
    const current = useRef<number | null>(epoch);
    current.current = epoch;
    useEffect(() => {
        current.current = epoch;
        return () => {
            current.current = null;
        };
    }, [epoch]);
    return h(KanbanSurface<OriginalRecord, LoggedInRecord>, {
        ...props,
        key: epoch,
        projected,
        isCurrent: () => current.current === epoch,
    });
}
function KanbanSurface<OriginalRecord, LoggedInRecord>(
    props: KanbanProps<OriginalRecord, LoggedInRecord> & {
        projected: KanbanItems;
        isCurrent: () => boolean;
    }
): ReactElement {
    const [items, setItems] = useStateWithDeps<KanbanItems>(props.projected, [
        props.projected,
    ]);
    const cards = new Map(props.cards.map((card) => [card.recordId, card]));
    const update = createKanbanCategoryOperation(
        props.captureCategoryInvocation
    );
    return h(
        'section',
        {
            className: ['mx-sdk-kanban', props.className]
                .filter(Boolean)
                .join(' '),
            'aria-label': props.label,
        },
        h(KanbanBoard, {
            items,
            setItems,
            isCurrent: props.isCurrent,
            disabled: props.readOnly,
            modalOpen: props.modalOpen,
            overlayClassName: props.className,
            scrollable: true,
            onRecordUpdate: update,
            renderItem: (id) => {
                const card = cards.get(String(id));
                if (!card)
                    throw new Error('Missing admitted Kanban card projection');
                return h(Card, { card });
            },
        })
    );
}
