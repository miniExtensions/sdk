import {
    createElement,
    forwardRef,
    type LiHTMLAttributes,
    type MouseEventHandler,
    type ReactNode,
} from 'react';
import { ActionButton, type ActionButtonProps } from './ActionButton.js';
import { LiteralText } from './LiteralText.js';

export type PersonBadgeProps = Omit<
    LiHTMLAttributes<HTMLLIElement>,
    'children' | 'dangerouslySetInnerHTML'
> & {
    /** Already resolved display label; the caller owns native identity/fallback. */
    label: string;
    /** Caller-owned avatar asset and loading policy. No lookup or fetch is added. */
    avatar?: ReactNode;
    avatarClassName?: string;
    bodyClassName?: string;
    labelClassName?: string;
    removeButtonClassName?: string;
    removeLabelClassName?: string;
    removeIconClassName?: string;
    /** Omit for display-only. The caller owns removal admission and native edits. */
    remove?: {
        label: string;
        onClick: MouseEventHandler<HTMLButtonElement>;
        buttonProps?: Omit<
            ActionButtonProps,
            | 'onClick'
            | 'children'
            | 'dangerouslySetInnerHTML'
            | 'busy'
            | 'busyContent'
        >;
    };
};

/** Native person badge presentation; no collaborator model, picker or writer. */
export const PersonBadge = forwardRef<HTMLLIElement, PersonBadgeProps>(
    function PersonBadge(
        {
            label,
            avatar,
            avatarClassName,
            bodyClassName,
            labelClassName,
            removeButtonClassName,
            removeLabelClassName,
            removeIconClassName,
            remove,
            ...native
        },
        ref
    ) {
        return createElement(
            'li',
            { ...native, ref },
            avatar !== undefined
                ? createElement('div', { className: avatarClassName }, avatar)
                : null,
            createElement(
                'div',
                { className: bodyClassName },
                createElement(LiteralText, {
                    as: 'span',
                    value: label,
                    className: labelClassName,
                    preserveWhitespace: false,
                }),
                remove
                    ? createElement(
                          ActionButton,
                          {
                              ...remove.buttonProps,
                              className:
                                  removeButtonClassName ??
                                  remove.buttonProps?.className,
                              onClick: remove.onClick,
                          },
                          createElement(
                              'span',
                              { className: removeLabelClassName },
                              remove.label
                          ),
                          createElement(
                              'svg',
                              {
                                  className: removeIconClassName,
                                  width: 8,
                                  height: 8,
                                  stroke: 'currentColor',
                                  fill: 'none',
                                  viewBox: '0 0 8 8',
                                  'aria-hidden': true,
                              },
                              createElement('path', {
                                  strokeLinecap: 'round',
                                  strokeWidth: '1.5',
                                  d: 'M1 1l6 6m0-6L1 7',
                              })
                          )
                      )
                    : null
            )
        );
    }
);
