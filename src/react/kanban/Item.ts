import React, { useEffect } from 'react';
import type {
    DraggableSyntheticListeners,
    UniqueIdentifier,
} from '@dnd-kit/core';
import type { Transform } from '@dnd-kit/utilities';
import { claimKanbanCursor } from './cursor.js';
export type RenderItemFunc = (recordId: UniqueIdentifier) => React.ReactElement;
type Props = React.HTMLAttributes<HTMLDivElement> & {
    dragOverlay?: boolean;
    color?: string;
    disabled?: boolean;
    dragging?: boolean;
    handle?: boolean;
    handleProps?: unknown;
    height?: number;
    index?: number;
    fadeIn?: boolean;
    transform?: Transform | null;
    listeners?: DraggableSyntheticListeners;
    sorting?: boolean;
    transition?: string | null;
    wrapperStyle?: React.CSSProperties;
    value: UniqueIdentifier;
    renderItem: RenderItemFunc;
};
export const Item = React.memo(
    React.forwardRef<HTMLLIElement, Props>(function Item(
        {
            dragOverlay,
            color,
            disabled,
            dragging,
            handle,
            handleProps,
            height,
            index,
            fadeIn,
            transform,
            listeners,
            sorting,
            style,
            transition,
            wrapperStyle,
            value,
            renderItem,
            ...attributes
        },
        ref
    ) {
        useEffect(
            () => (dragOverlay ? claimKanbanCursor(document.body) : undefined),
            [dragOverlay]
        );
        const variables: React.CSSProperties &
            Record<string, string | number | undefined> = {
            ...wrapperStyle,
            transition: [transition, wrapperStyle?.transition]
                .filter(Boolean)
                .join(', '),
            '--translate-x': transform
                ? `${Math.round(transform.x)}px`
                : undefined,
            '--translate-y': transform
                ? `${Math.round(transform.y)}px`
                : undefined,
            '--scale-x': transform?.scaleX ? `${transform.scaleX}` : undefined,
            '--scale-y': transform?.scaleY ? `${transform.scaleY}` : undefined,
            '--index': index,
            '--color': color,
        };
        return React.createElement(
            'li',
            {
                ref,
                className: [
                    'mx-sdk-kanban-item',
                    dragOverlay ? 'mx-sdk-kanban-item-overlay' : null,
                ]
                    .filter(Boolean)
                    .join(' '),
                style: variables,
            },
            React.createElement(
                'div',
                {
                    ...(!handle ? listeners : undefined),
                    ...attributes,
                    className: 'mx-sdk-kanban-draggable',
                    style,
                    'data-kanban-record': String(value),
                    tabIndex: !handle ? 0 : undefined,
                },
                renderItem(value)
            )
        );
    })
);
