import {
    createElement as h,
    createContext,
    useContext,
    useEffect,
    useLayoutEffect,
    useRef,
    type Context,
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
    progressLabel?: string;
    formatProgressValue?: (currentStep: number, totalSteps: number) => string;
    className?: string;
};

type FormNextKeyboardFocus = {
    submitter: HTMLButtonElement;
} | null;

export const FormNextKeyboardFocusContext: Context<FormNextKeyboardFocus> =
    createContext<FormNextKeyboardFocus>(null);

/** Complete progress, current title and HTML description without a second page index. */
export function CompleteFormPageNavigation({
    pages,
    activePageIndex,
    onSelectTitle,
    progressTestId = 'form-page-progress',
    progressItemTestId = 'form-page-progress-item',
    progressLabel = 'Form progress',
    formatProgressValue = (currentStep, totalSteps) =>
        `Step ${currentStep} of ${totalSteps}`,
    className,
}: CompleteFormPageNavigationProps): ReactElement | null {
    const activePage = pages[activePageIndex];
    const keyboardNext = useContext(FormNextKeyboardFocusContext);
    const heading = useRef<HTMLHeadingElement>(null);
    const previous = useRef({ activePageIndex, keyboardNext });
    const canSelectTitle =
        onSelectTitle != null && (activePage?.fieldIds.length ?? 0) > 0;
    const useCommitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    useCommitEffect(() => {
        const before = previous.current;
        previous.current = { activePageIndex, keyboardNext };
        const destination = heading.current;
        // Consume the request on this commit, even when validation keeps the
        // current page. A later page or visibility update cannot reuse it.
        if (
            !destination ||
            !keyboardNext ||
            keyboardNext === before.keyboardNext ||
            activePageIndex <= before.activePageIndex ||
            activePage?.hidden ||
            canSelectTitle
        )
            return;
        const document = destination.ownerDocument;
        const active = document.activeElement;
        // A final page can replace Next with Save and return focus to body.
        if (active === keyboardNext.submitter || active === document.body)
            destination.focus({ preventScroll: true });
    }, [activePageIndex, activePage?.hidden, canSelectTitle, keyboardNext]);

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
    const currentStep = visibleSections.filter(
        ({ index }) => index <= activePageIndex
    ).length;
    const totalSteps = visibleSections.length;
    return h(
        'div',
        {
            className: ['mx-sdk-form-pages', className]
                .filter(Boolean)
                .join(' '),
        },
        totalSteps > 1
            ? h(
                  'div',
                  {
                      className: 'mx-sdk-form-pages-progress',
                      role: 'progressbar',
                      'aria-label': progressLabel,
                      'aria-valuemin': 0,
                      'aria-valuenow': currentStep,
                      'aria-valuemax': totalSteps,
                      'aria-valuetext': formatProgressValue(
                          currentStep,
                          totalSteps
                      ),
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
                          'aria-hidden': true,
                          'data-testid': progressItemTestId,
                      })
                  )
              )
            : null,
        activePage.title != null
            ? h(
                  'h2',
                  {
                      className: 'mx-sdk-form-pages-title',
                      ref: heading,
                      tabIndex: canSelectTitle ? undefined : -1,
                  },
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
            viewBox: '0 0 24 24',
            fill: 'currentColor',
            className: 'mx-sdk-form-page-button-icon',
            'aria-hidden': true,
        },
        h('path', {
            fillRule: 'evenodd',
            d:
                direction === 'back'
                    ? 'M7.72 12.53a.75.75 0 0 1 0-1.06l7.5-7.5a.75.75 0 1 1 1.06 1.06L9.31 12l6.97 6.97a.75.75 0 1 1-1.06 1.06l-7.5-7.5Z'
                    : 'M16.28 11.47a.75.75 0 0 1 0 1.06l-7.5 7.5a.75.75 0 0 1-1.06-1.06L14.69 12 7.72 5.03a.75.75 0 1 1 1.06-1.06l7.5 7.5Z',
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
