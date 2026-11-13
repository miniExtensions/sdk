import {
    createElement as h,
    Fragment,
    useEffect,
    useState,
    type ReactElement,
} from 'react';
import type { KanbanBoardProps } from './Board.js';
import { Container } from './Container.js';
import { Item } from './Item.js';

type BoardComponent = (typeof import('./Board.js'))['MultipleContainers'];

/** Keep the complete SSR card frame while deferring DOM-peer initialization. */
export function KanbanBoard(props: KanbanBoardProps): ReactElement {
    const [Board, setBoard] = useState<BoardComponent | null>(null);
    const [failure, setFailure] = useState<unknown>(null);
    useEffect(() => {
        let current = true;
        void import('./Board.js').then(
            (runtime) => {
                if (current) setBoard(() => runtime.MultipleContainers);
            },
            (error) => {
                if (current) setFailure(error);
            }
        );
        return () => {
            current = false;
        };
    }, []);
    if (failure) throw failure;
    return h(
        Fragment,
        null,
        h('span', {
            hidden: true,
            'data-kanban-ready': Board !== null ? 'true' : 'false',
        }),
        Board
            ? h(Board, props)
            : h(
                  'div',
                  { className: 'mx-sdk-kanban-board' },
                  props.items.map((column) =>
                      h(Container, {
                          key: column.id,
                          label: column.label,
                          children: column.recordIds.map((id) =>
                              h(Item, {
                                  key: id,
                                  value: id,
                                  renderItem: props.renderItem,
                              })
                          ),
                      })
                  )
              )
    );
}
