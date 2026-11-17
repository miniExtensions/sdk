import {
    createElement as h,
    type MouseEventHandler,
    type ReactElement,
} from 'react';
import { CompleteQuillHTMLRenderer } from './html/CompleteQuillHTMLRenderer.js';

/** Presentation facts only. The page lifecycle and canonical fields stay outside this view. */
export type FormPageNavigationDescriptor = {
    title: string | null;
    description: string | null;
    fieldIds: readonly string[];
    hidden: boolean;
};

export type CompleteFormPageNavigationProps = {
    pages: readonly FormPageNavigationDescriptor[];
    activePageIndex: number;
    /** An admitted authoring action; absent on ordinary public forms. */
    onSelectTitle?: () => void;
    progressTestId?: string;
    progressItemTestId?: string;
    className?: string;
};

/** Complete progress, current title and HTML description without a second page index. */
export function CompleteFormPageNavigation({
    pages,
    activePageIndex,
    onSelectTitle,
    progressTestId = 'form-page-progress',
    progressItemTestId = 'form-page-progress-item',
    className,
}: CompleteFormPageNavigationProps): ReactElement | null {
    const activePage = pages[activePageIndex];
    if (
        !activePage ||
        (activePage.title == null && activePage.description == null)
    )
        return null;
    const visibleSections = pages
        .map((page, index) => ({ page, index }))
        .filter(
            ({ page }) =>
                !page.hidden && (page.title != null || page.description != null)
        );
    const canSelectTitle =
        onSelectTitle != null && activePage.fieldIds.length > 0;
    return h(
        'div',
        {
            className: ['mx-sdk-form-pages', className]
                .filter(Boolean)
                .join(' '),
        },
        visibleSections.length > 1
            ? h(
                  'div',
                  {
                      className: 'mx-sdk-form-pages-progress',
                      'aria-hidden': true,
                      'data-testid': progressTestId,
                  },
                  visibleSections.map(({ index }) =>
                      h('div', {
                          key: index,
                          className: `mx-sdk-form-pages-progress-item${
                              index <= activePageIndex
                                  ? ' mx-sdk-form-pages-progress-item--reached bg-theme-600'
                                  : ' bg-gray-200'
                          }`,
                          'data-testid': progressItemTestId,
                      })
                  )
              )
            : null,
        activePage.title != null
            ? h(
                  'h2',
                  { className: 'mx-sdk-form-pages-title' },
                  canSelectTitle
                      ? h(
                            'button',
                            {
                                type: 'button',
                                className: 'mx-sdk-form-pages-select-title',
                                onClick: onSelectTitle,
                            },
                            activePage.title
                        )
                      : activePage.title
              )
            : null,
        activePage.description != null
            ? h(
                  'div',
                  { className: 'mx-sdk-form-pages-description' },
                  h(CompleteQuillHTMLRenderer, {
                      html: activePage.description,
                  })
              )
            : null
    );
}

export type FormPageNavigationButtonProps = {
    direction: 'back' | 'next';
    label: string;
    loading?: boolean;
    disabled?: boolean;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    /** Associate with the existing host form even when rendered outside it. */
    form?: string;
    type?: 'button' | 'submit';
    className?: string;
};

/** Back is a command; Next keeps the host form as the sole submit route. */
export function FormPageNavigationButton({
    direction,
    label,
    loading = false,
    disabled = false,
    onClick,
    form,
    type = direction === 'next' ? 'submit' : 'button',
    className,
}: FormPageNavigationButtonProps): ReactElement {
    const chevron = h(
        'svg',
        {
            viewBox: '0 0 20 20',
            fill: 'currentColor',
            className: 'mx-sdk-form-page-button-icon',
            'aria-hidden': true,
        },
        h('path', {
            fillRule: 'evenodd',
            d:
                direction === 'back'
                    ? 'M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z'
                    : 'M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z',
            clipRule: 'evenodd',
        })
    );
    const indicator = loading
        ? h(
              'svg',
              {
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  className:
                      'mx-sdk-form-page-button-icon mx-sdk-form-page-button-spinner',
                  'aria-hidden': true,
              },
              h('circle', {
                  cx: 12,
                  cy: 12,
                  r: 10,
                  stroke: 'currentColor',
                  strokeWidth: 4,
                  opacity: 0.25,
              }),
              h('path', {
                  fill: 'currentColor',
                  opacity: 0.75,
                  d: 'M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z',
              })
          )
        : chevron;
    return h(
        'button',
        {
            type,
            form,
            onClick,
            disabled: disabled || loading,
            'aria-label': label,
            'aria-busy': loading || undefined,
            className: [
                'mx-sdk-form-page-button',
                `mx-sdk-form-page-button--${direction}`,
                className,
            ]
                .filter(Boolean)
                .join(' '),
        },
        direction === 'back' ? indicator : null,
        h('span', null, label),
        direction === 'next' ? indicator : null
    );
}
