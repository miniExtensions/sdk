import { createElement as h, type ReactElement } from 'react';

/** A public field diagnostic that the host has already authorized for display. */
export type FormValidationDiagnostic = Readonly<{
    fieldId: string;
    /** Semantic field title, including when the field's inline label is hidden. */
    fieldTitle: string;
    errorMessage: string;
}>;

export type FormValidationSummaryProps = Readonly<{
    heading: string;
    /** Display order is preserved. Field IDs must be unique within the summary. */
    diagnostics: readonly FormValidationDiagnostic[];
}>;

/**
 * Complete form-level error presentation. The host retains validation, error
 * state, localization and native fragment navigation. Import form-validation-summary.css.
 */
export function FormValidationSummary({
    heading,
    diagnostics,
}: FormValidationSummaryProps): ReactElement | null {
    if (diagnostics.length === 0) return null;
    return h(
        'div',
        {
            role: 'alert',
            'data-testid': 'alert-test-id',
            className: 'mx-sdk-form-validation-summary',
        },
        h(
            'div',
            { className: 'mx-sdk-form-validation-summary-row' },
            h(
                'div',
                { className: 'mx-sdk-form-validation-summary-icon' },
                h(
                    'svg',
                    {
                        viewBox: '0 0 24 24',
                        fill: 'currentColor',
                        'aria-hidden': true,
                    },
                    h('path', {
                        fillRule: 'evenodd',
                        d: 'M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25Zm-1.72 6.97a.75.75 0 1 0-1.06 1.06L10.94 12l-1.72 1.72a.75.75 0 1 0 1.06 1.06L12 13.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L13.06 12l1.72-1.72a.75.75 0 1 0-1.06-1.06L12 10.94l-1.72-1.72Z',
                        clipRule: 'evenodd',
                    })
                )
            ),
            h(
                'div',
                { className: 'mx-sdk-form-validation-summary-body' },
                h(
                    'h3',
                    { className: 'mx-sdk-form-validation-summary-heading' },
                    heading
                ),
                h(
                    'div',
                    { className: 'mx-sdk-form-validation-summary-errors' },
                    h(
                        'ul',
                        {
                            role: 'list',
                            className: 'mx-sdk-form-validation-summary-list',
                        },
                        diagnostics.map(
                            ({ fieldId, fieldTitle, errorMessage }) =>
                                h(
                                    'li',
                                    {
                                        key: fieldId,
                                        'data-testid': `field-${fieldId}-error`,
                                    },
                                    h('a', { href: `#${fieldId}` }, fieldTitle),
                                    ` (${errorMessage})`
                                )
                        )
                    )
                )
            )
        )
    );
}
