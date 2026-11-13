import React, { forwardRef } from 'react';
export type ContainerProps = {
    children: React.ReactNode;
    columns?: number;
    label?: string;
    style?: React.CSSProperties;
    horizontal?: boolean;
    hover?: boolean;
    handleProps?: React.HTMLAttributes<HTMLElement>;
    scrollable?: boolean;
    shadow?: boolean;
    placeholder?: boolean;
    unstyled?: boolean;
};
/** Native column listeners are deliberately not attached: no new column handle. */
export const Container = forwardRef<HTMLDivElement, ContainerProps>(
    function Container(props, ref) {
        return React.createElement('div', {
            ref,
            className: [
                'mx-sdk-kanban-column',
                props.hover && 'mx-sdk-kanban-column-over',
                props.shadow && 'mx-sdk-kanban-column-overlay',
            ]
                .filter(Boolean)
                .join(' '),
            style: props.style,
            children: [
                props.label
                    ? React.createElement(
                          'div',
                          {
                              key: 'label',
                              className: 'mx-sdk-kanban-column-label',
                          },
                          props.label
                      )
                    : null,
                React.createElement(
                    'ul',
                    { key: 'items', className: 'mx-sdk-kanban-items' },
                    props.children
                ),
            ],
        });
    }
);
