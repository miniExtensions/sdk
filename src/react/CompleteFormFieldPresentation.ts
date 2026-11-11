import {
    createElement as h,
    useState,
    useRef,
    useEffect,
    lazy,
    Suspense,
    Fragment,
    type ReactNode,
    type KeyboardEvent,
} from 'react';

import {
    CompleteQuillHTMLRenderer,
    CompleteTruncatedDescription,
} from './html/index.js';
import {
    hasFieldDescription,
    useFieldPresentationAssociation,
    fieldPresentationDescribedBy,
    type FieldPresentationAssociation,
    type FieldPresentationComposition,
} from './fieldPresentation.js';

// Keep optional popup dependencies out of the ordinary leaf import path.
const FieldTooltipPopup = lazy(() => import('./fieldTooltipPopup.js'));

export type CompleteFormFieldPresentationProps = {
    /** Already projected by the host. No conditional or writer evaluation occurs here. */
    visible?: boolean;
    title: string;
    semanticTitle?: string;
    fieldName: string;
    showTitle?: boolean;
    required?: boolean;
    associationKind: FieldPresentationAssociation['kind'];
    formId?: string;
    description?: string | null;
    descriptionPlacement?: 'top' | 'bottom' | 'tooltip';
    descriptionImageUrl?: string | null;
    truncateDescription?: boolean;
    error?: string | null;
    errorTestId?: string;
    sameRow?: boolean;
    enableSideBySideOnMobile?: boolean;
    className?: string;
    /** Host-owned builder action node, never inferred from metadata. */
    titleActions?: ReactNode;
    loading?: ReactNode;
    preview?: boolean;
    /** Explicit host canvas admission marker, projected only in config preview. */
    previewControlProps?: { 'data-config-preview-canvas-control': 'true' };
    readMoreLabel?: string;
    showLessLabel?: string;
    /** Render actual complete leaves with the one shared association. */
    children: (composition: FieldPresentationComposition) => ReactNode;
};

/** Complete field chrome; the consumer retains state, policy, layout boundaries and writes. */
export function CompleteFormFieldPresentation(
    props: CompleteFormFieldPresentationProps
): ReactNode {
    const association = useFieldPresentationAssociation({
        kind: props.loading != null ? 'group' : props.associationKind,
        formId: props.formId,
        description: props.description,
        error: props.error,
    });
    // Preserve native single failed-URL latch across config/value rerenders.
    // A new URL has a distinct image key; a true remount retries naturally.
    const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
    const [tooltipOpen, setTooltipOpen] = useState(false);
    const [popupReady, setPopupReady] = useState(false);
    const tooltipTriggerRef = useRef<HTMLButtonElement>(null);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
        undefined
    );
    const cancelClose = () => {
        if (closeTimer.current !== undefined) clearTimeout(closeTimer.current);
        closeTimer.current = undefined;
    };
    const openTooltip = () => {
        cancelClose();
        setTooltipOpen(true);
    };
    const leaveTooltip = () => {
        cancelClose();
        // Allow the pointer to cross the native 8px popup gap before closing.
        closeTimer.current = setTimeout(() => {
            closeTimer.current = undefined;
            setTooltipOpen(false);
        }, 150);
    };
    useEffect(
        () => () => {
            if (closeTimer.current !== undefined)
                clearTimeout(closeTimer.current);
        },
        []
    );
    const imageUrl = props.descriptionImageUrl?.trim() || null;
    const failed = imageUrl != null && failedImageUrl === imageUrl;
    const imageVisible = imageUrl != null && !failed;
    const failureVisible = failed && props.preview === true;
    const hasText = hasFieldDescription(props.description);
    const hasDescription = hasText || imageVisible || failureVisible;
    const placement = props.descriptionPlacement ?? 'top';
    // Native description owners remount when placement/visibility changes.
    // Retain the single-URL latch only across the same mounted presentation.
    const descriptionMount = props.visible === false ? null : placement;
    const [renderedDescriptionMount, setRenderedDescriptionMount] =
        useState(descriptionMount);
    const descriptionMountChanged =
        renderedDescriptionMount !== descriptionMount;
    if (descriptionMountChanged) {
        setRenderedDescriptionMount(descriptionMount);
        setFailedImageUrl(null);
    }
    const hasTooltip = descriptionMount === 'tooltip' && hasDescription;
    // Native Tooltip unmounts when its trigger has no content. Retire only its
    // popup state here; an image-only failure must retain the failed-URL latch.
    if (
        (descriptionMountChanged || !hasTooltip) &&
        (tooltipOpen || popupReady)
    ) {
        setTooltipOpen(false);
        setPopupReady(false);
    }
    useEffect(() => {
        if (!hasTooltip && closeTimer.current !== undefined) {
            clearTimeout(closeTimer.current);
            closeTimer.current = undefined;
        }
    }, [hasTooltip]);
    const semanticTitle = props.semanticTitle?.trim()
        ? props.semanticTitle
        : props.title.trim()
          ? props.title
          : props.fieldName;
    const title =
        props.showTitle === false || !props.title.trim()
            ? semanticTitle
            : props.title;
    const hiddenTitle = props.showTitle === false || !props.title.trim();
    if (props.visible === false) return null;

    const text = (hidden = false): ReactNode =>
        hasText && typeof props.description === 'string'
            ? h(
                  'div',
                  {
                      id:
                          hidden || placement !== 'tooltip'
                              ? association.descriptionId
                              : undefined,
                      className: hidden
                          ? 'mx-sdk-field-sr-only sr-only'
                          : 'mx-sdk-field-description-text',
                  },
                  props.truncateDescription && !hidden
                      ? h(CompleteTruncatedDescription, {
                            html: props.description,
                            readMoreLabel: props.readMoreLabel,
                            showLessLabel: props.showLessLabel,
                        })
                      : h(CompleteQuillHTMLRenderer, {
                            html: props.description,
                        })
              )
            : null;
    const description = (): ReactNode =>
        !hasDescription
            ? null
            : h(
                  'div',
                  { className: 'mx-sdk-field-description' },
                  imageVisible
                      ? h('img', {
                            key: imageUrl,
                            src: imageUrl ?? undefined,
                            alt: '',
                            className: 'mx-sdk-field-description-image',
                            onError: () => setFailedImageUrl(imageUrl),
                        })
                      : null,
                  failureVisible
                      ? h(
                            'div',
                            {
                                role: 'status',
                                className: 'mx-sdk-field-image-failure',
                            },
                            h(
                                'p',
                                null,
                                'This image could not be loaded. Replace it or try again.'
                            ),
                            h(
                                'button',
                                {
                                    type: 'button',
                                    ...props.previewControlProps,
                                    onClick: () => setFailedImageUrl(null),
                                },
                                'Try again'
                            )
                        )
                      : null,
                  text()
              );
    const titleProps = {
        id: association.labelId,
        className: `mx-sdk-field-title${hiddenTitle ? ' mx-sdk-field-sr-only sr-only' : ''}`,
    };
    const label =
        association.kind === 'input'
            ? h(
                  'label',
                  { ...titleProps, htmlFor: association.controlId },
                  title,
                  props.required
                      ? h('span', { className: 'mx-sdk-field-required' }, '*')
                      : null
              )
            : h(
                  'span',
                  titleProps,
                  title,
                  props.required
                      ? h('span', { className: 'mx-sdk-field-required' }, '*')
                      : null
              );
    const tooltipId = `${association.controlId}-tooltip`;
    const content =
        props.loading ?? props.children({ association, chromeOwner: 'shell' });
    return h(
        Fragment,
        null,
        h('div', {
            className: 'mx-sdk-field-row-break',
            'data-same-row': props.sameRow ? 'true' : 'false',
            'data-mobile-same-row': props.enableSideBySideOnMobile
                ? 'true'
                : 'false',
        }),
        h(
            'div',
            {
                className: ['mx-sdk-form-field', props.className]
                    .filter(Boolean)
                    .join(' '),
                'data-same-row': props.sameRow ? 'true' : 'false',
                'data-mobile-same-row': props.enableSideBySideOnMobile
                    ? 'true'
                    : 'false',
            },
            h(
                'div',
                { className: 'mx-sdk-field-title-row' },
                label,
                props.titleActions,
                hasTooltip
                    ? h(
                          'span',
                          {
                              className: 'mx-sdk-field-tooltip',
                              onMouseEnter: openTooltip,
                              onMouseLeave: leaveTooltip,
                          },
                          text(true),
                          h(
                              'button',
                              {
                                  ref: tooltipTriggerRef,
                                  type: 'button',
                                  className: 'mx-sdk-field-tooltip-trigger',
                                  ...props.previewControlProps,
                                  'aria-label': `Field description for ${semanticTitle}`,
                                  'aria-expanded': tooltipOpen,
                                  'aria-describedby':
                                      tooltipOpen && popupReady
                                          ? tooltipId
                                          : undefined,
                                  onFocus: openTooltip,
                                  onBlur: () => {
                                      // A cold lazy popup has no mounted
                                      // outside-focus listener yet. Retire it
                                      // if focus leaves before it is ready.
                                      if (!popupReady) {
                                          cancelClose();
                                          setTooltipOpen(false);
                                      }
                                  },
                                  onClick: openTooltip,
                                  onKeyDown: (
                                      event: KeyboardEvent<HTMLButtonElement>
                                  ) => {
                                      if (event.key === 'Escape') {
                                          cancelClose();
                                          setTooltipOpen(false);
                                          event.stopPropagation();
                                      }
                                  },
                              },
                              h('span', { 'aria-hidden': true }, 'ⓘ')
                          ),
                          tooltipOpen
                              ? h(
                                    Suspense,
                                    { fallback: null },
                                    h(
                                        FieldTooltipPopup,
                                        {
                                            id: tooltipId,
                                            onReadyChange: setPopupReady,
                                            anchorRef: tooltipTriggerRef,
                                            onOpenChange: setTooltipOpen,
                                            onMouseEnter: openTooltip,
                                            onMouseLeave: leaveTooltip,
                                        },
                                        description()
                                    )
                                )
                              : null
                      )
                    : null
            ),
            placement === 'top' ? description() : null,
            association.kind === 'input'
                ? h('div', { className: 'mx-sdk-field-control' }, content)
                : h(
                      'div',
                      {
                          id: association.controlId,
                          role: 'group',
                          'aria-labelledby': association.labelId,
                          'aria-describedby':
                              fieldPresentationDescribedBy(association),
                          'aria-invalid':
                              association.errorId != null || undefined,
                          className: 'mx-sdk-field-control',
                      },
                      content
                  ),
            placement === 'bottom' ? description() : null,
            props.error != null
                ? h(
                      'p',
                      {
                          id: association.errorId,
                          className: 'mx-sdk-field-error',
                          'data-testid': props.errorTestId,
                      },
                      props.error
                  )
                : null
        )
    );
}
