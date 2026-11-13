import { createElement, type ReactElement } from 'react';

export type FormSubmitButtonProps = {
    /** ID of the host's existing form, including when the button is outside it. */
    formId: string;
    /** Already localized and resolved by the host, including custom final labels. */
    label: string;
    mode: 'save' | 'compute' | 'review';
    saving: boolean;
    /** Surface admission, not whether the form currently has validation errors. */
    canSubmit: boolean;
};

/**
 * Native terminal Form control. The associated form owns the single submit path,
 * validation, Compute/Review routing and persistence. No effects or click dispatch.
 * Import @miniextensions/sdk/react/form-submit.css for the portable presentation.
 */
export function FormSubmitButton({
    formId,
    label,
    mode,
    saving,
    canSubmit,
}: FormSubmitButtonProps): ReactElement {
    return createElement(
        'button',
        {
            type: 'submit',
            form: formId,
            'aria-label': label,
            className: 'mx-sdk-form-submit',
            'data-mode': mode,
            disabled: saving || !canSubmit,
        },
        saving
            ? createElement(
                  'span',
                  { className: 'mx-sdk-form-submit-pending' },
                  createElement(
                      'svg',
                      {
                          className: 'mx-sdk-form-submit-spinner',
                          xmlns: 'http://www.w3.org/2000/svg',
                          fill: 'none',
                          viewBox: '0 0 24 24',
                          'aria-hidden': true,
                      },
                      createElement('circle', {
                          cx: 12,
                          cy: 12,
                          r: 10,
                          stroke: 'currentColor',
                          strokeWidth: 4,
                          opacity: 0.25,
                      }),
                      createElement('path', {
                          fill: 'currentColor',
                          opacity: 0.75,
                          d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z',
                      })
                  )
              )
            : null,
        createElement('span', null, label)
    );
}
