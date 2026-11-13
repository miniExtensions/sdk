import type * as React from 'react';
import { createElement as h, useId, useState, type ReactNode } from 'react';
import { CompleteQuillHTMLRenderer } from './html/index.js';

/** Host authoring action only; native settings and selection authority stay outside. */
export type FormGroupPreview = Readonly<{
    startFieldId: string | null;
    onSelectSection: (startFieldId: string) => void;
}>;

export type FormGroupProps = Readonly<{
    title: string;
    description?: string | null;
    /** Configuration default, applied only when the visible group mounts. */
    isExpanded?: boolean;
    /** Already-resolved page state; also an initial expansion default only. */
    isReadOnlyPage?: boolean;
    /** Host evaluates visibility by Airtable field name, never by child DOM. */
    allFieldsHidden: boolean;
    /** Host resolves canonical error presence by field ID. */
    hasError: boolean;
    /** Original host field nodes retain their controllers, keys and writers. */
    children: ReactNode;
    preview?: FormGroupPreview;
    className?: string;
}>;

function Chevron({ open }: { open: boolean }): React.ReactElement {
    return h(
        'svg',
        {
            className: 'mx-sdk-form-group__chevron',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            'aria-hidden': true,
        },
        h('path', {
            d: open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
        })
    );
}

function VisibleFormGroup(props: FormGroupProps): React.ReactElement {
    const [open, setOpen] = useState(
        () => props.isReadOnlyPage === true || props.isExpanded === true
    );
    const id = useId();
    const buttonId = `${id}-disclosure`;
    const panelId = `${id}-panel`;
    const preview = props.preview;
    const startFieldId = preview?.startFieldId;
    const selectable = preview != null && startFieldId != null;
    const title = h(
        'span',
        { className: 'mx-sdk-form-group__title' },
        props.title
    );
    const error = props.hasError
        ? h('span', {
              className: 'mx-sdk-form-group__error',
              'aria-hidden': true,
          })
        : null;
    const disclosure = {
        id: buttonId,
        type: 'button' as const,
        'aria-expanded': open,
        'aria-controls': open ? panelId : undefined,
        onClick: () => setOpen((current) => !current),
    };

    return h(
        'div',
        {
            className: ['mx-sdk-form-group', props.className]
                .filter(Boolean)
                .join(' '),
        },
        h(
            'div',
            { className: 'mx-sdk-form-group__header-wrap' },
            selectable
                ? h(
                      'div',
                      { className: 'mx-sdk-form-group__header' },
                      h(
                          'button',
                          {
                              type: 'button',
                              className: 'mx-sdk-form-group__title-button',
                              onClick: () =>
                                  preview.onSelectSection(startFieldId),
                          },
                          title
                      ),
                      error,
                      h(
                          'button',
                          {
                              ...disclosure,
                              className: 'mx-sdk-form-group__toggle',
                              'aria-label': `${open ? 'Collapse' : 'Expand'} ${props.title}`,
                          },
                          h(Chevron, { open })
                      )
                  )
                : h(
                      'button',
                      {
                          ...disclosure,
                          className:
                              'mx-sdk-form-group__header mx-sdk-form-group__disclosure',
                      },
                      title,
                      error,
                      h(Chevron, { open })
                  )
        ),
        open
            ? h(
                  'div',
                  {
                      id: panelId,
                      className: 'mx-sdk-form-group__panel',
                      'aria-labelledby': buttonId,
                  },
                  props.description != null
                      ? h(
                            'div',
                            { className: 'mx-sdk-form-group__description' },
                            h(CompleteQuillHTMLRenderer, {
                                html: props.description,
                            })
                        )
                      : null,
                  h(
                      'div',
                      { className: 'mx-sdk-form-group__fields' },
                      props.children
                  )
              )
            : null
    );
}

/**
 * Complete collapsible section presentation for one-page Forms only. Multipage
 * callers keep their existing page composition instead of rendering FormGroup.
 * Native FormFieldOrGroup.tsx blob 0eb4a5dbfe05445256d993504980e2ca49f051fc
 * supplies the behavior contract. This owns local disclosure state, not field
 * values, visibility, validation, error-anchor navigation, pages or Save.
 */
export function FormGroup(props: FormGroupProps): React.ReactElement | null {
    // Native suppression unmounts Disclosure itself, including its open state.
    return props.allFieldsHidden ? null : h(VisibleFormGroup, props);
}
