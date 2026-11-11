import { createElement as h, useId, type ReactNode } from 'react';
import { CheckboxInput } from './CheckboxField.js';
import type { FieldPresentationComposition } from './fieldPresentation.js';

export type CompleteCheckboxFieldProps = {
    /** Already admitted canonical value; the presenter owns no draft or writer. */
    value: boolean | null;
    onChange: (checked: boolean) => void;
    id?: string;
    form?: string;
    checkboxStyle?: 'checkbox' | 'toggle' | 'button';
    readOnly?: boolean;
    isInGrid?: boolean;
    isPortalScreen?: boolean;
    checkedStateLabel?: string;
    uncheckedStateLabel?: string;
    ariaDescribedBy?: string;
    ariaInvalid?: boolean;
    /** Optional standalone chrome. Omit it when the surrounding app owns chrome. */
    title?: string;
    showTitle?: boolean;
    feedback?: string;
    className?: string;
    /** Caller-admitted Calendly display; this slot creates no provider capability. */
    calendlyPresenter?: ReactNode;
    presentation?: FieldPresentationComposition;
};

function CheckIcon() {
    return h(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 3,
            'aria-hidden': true,
        },
        h('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            d: 'm4.5 12.75 6 6 9-13.5',
        })
    );
}

/** Complete native Checkbox modes. DOM association never grants write authority. */
export function CompleteCheckboxField(
    props: CompleteCheckboxFieldProps
): ReactNode {
    const generatedId = useId();
    const association = props.presentation?.association;
    const id = association?.controlId ?? props.id ?? generatedId;
    const form = association?.formId ?? props.form;
    const shellOwnsChrome = props.presentation?.chromeOwner === 'shell';
    const labelId = association?.labelId ?? `${id}-label`;
    const feedback = !shellOwnsChrome ? props.feedback : undefined;
    const describedBy = shellOwnsChrome
        ? [association?.errorId, association?.descriptionId]
              .filter(Boolean)
              .join(' ') || undefined
        : [props.ariaDescribedBy, feedback ? `${id}-feedback` : undefined]
              .filter(Boolean)
              .join(' ') || undefined;
    const checked = props.value ?? false;
    const readOnly = props.readOnly === true;
    const staticGrid = readOnly && props.isInGrid === true;
    const calendly = !readOnly && props.calendlyPresenter !== undefined;
    const nonLabelable =
        staticGrid ||
        calendly ||
        (!readOnly && props.checkboxStyle === 'button');
    // The shell emits the local group node for non-labelable presentations.
    const groupedByShell = shellOwnsChrome && association?.kind !== 'input';
    const showTitle = props.showTitle !== false && !!props.title;
    const labelledBy = shellOwnsChrome
        ? labelId
        : showTitle
          ? labelId
          : undefined;
    const common = {
        id: groupedByShell ? undefined : id,
        form,
        'aria-labelledby': labelledBy,
        'aria-label': !shellOwnsChrome && !showTitle ? props.title : undefined,
        'aria-describedby': describedBy,
        'aria-invalid': shellOwnsChrome
            ? !!association?.errorId
            : props.ariaInvalid,
    };
    const checkboxStyle = readOnly
        ? 'checkbox'
        : (props.checkboxStyle ?? 'checkbox');
    let control: ReactNode;
    if (calendly) {
        control = h(
            'div',
            {
                id: groupedByShell ? undefined : id,
                role: groupedByShell ? undefined : 'group',
                'aria-labelledby': groupedByShell ? undefined : labelledBy,
                'aria-label': groupedByShell ? undefined : common['aria-label'],
                'aria-describedby': groupedByShell ? undefined : describedBy,
                'aria-invalid': groupedByShell
                    ? undefined
                    : common['aria-invalid'],
                className: 'mx-sdk-complete-checkbox__calendly',
            },
            props.calendlyPresenter
        );
    } else if (staticGrid) {
        control = h(
            'div',
            {
                id: groupedByShell ? undefined : id,
                role: groupedByShell ? undefined : 'group',
                'aria-labelledby': groupedByShell ? undefined : labelledBy,
                'aria-label': groupedByShell ? undefined : common['aria-label'],
                'aria-describedby': groupedByShell ? undefined : describedBy,
                'aria-invalid': groupedByShell
                    ? undefined
                    : common['aria-invalid'],
            },
            h(
                'span',
                { className: 'mx-sdk-complete-checkbox__sr-only sr-only' },
                String(checked)
            ),
            h(
                'div',
                {
                    className: `h-5 w-5 rounded p-0.5 mx-sdk-complete-checkbox__grid ${checked ? 'bg-theme-400' : 'border border-gray-300 bg-white'}`,
                    'data-checkbox-grid-value': String(checked),
                    'aria-hidden': true,
                },
                checked ? h(CheckIcon) : null
            )
        );
    } else if (checkboxStyle === 'button') {
        const stateLabel = checked
            ? props.checkedStateLabel?.trim()
            : props.uncheckedStateLabel?.trim();
        control = h(
            'div',
            {
                className:
                    'flex h-5 items-center mx-sdk-complete-checkbox__button-row',
            },
            h(
                'button',
                {
                    ...common,
                    type: 'button',
                    // The named shell group supplies field context; the button
                    // retains its current state label as its accessible name.
                    'aria-labelledby': nonLabelable
                        ? undefined
                        : common['aria-labelledby'],
                    'aria-label': nonLabelable
                        ? undefined
                        : common['aria-label'],
                    className:
                        'inline-flex items-center whitespace-nowrap justify-center shadow-sm disabled:pointer-events-none disabled:opacity-50 bg-theme-600 text-white hover:bg-theme-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-theme-600 px-2.5 py-1.5 text-xs font-medium rounded mx-sdk-complete-checkbox__button',
                    'aria-pressed': checked,
                    disabled: readOnly,
                    onClick: () => {
                        if (!readOnly) props.onChange(!props.value);
                    },
                },
                stateLabel || String(checked)
            )
        );
    } else {
        const input = h(CheckboxInput, {
            ...common,
            checked,
            disabled: readOnly,
            readOnly: checkboxStyle === 'checkbox' ? readOnly : undefined,
            'aria-checked': checked,
            className:
                checkboxStyle === 'toggle'
                    ? 'absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0 mx-sdk-complete-checkbox__toggle-input'
                    : `h-5 w-5 rounded border-gray-300 text-theme-600 focus:ring-theme-600 disabled:text-theme-400 mx-sdk-complete-checkbox__input${props.isPortalScreen ? ' cursor-pointer !ring-0 !ring-offset-0 mx-sdk-complete-checkbox__input--portal' : ''}`,
            onChange: (event) => {
                if (!readOnly) props.onChange(event.currentTarget.checked);
            },
        });
        control =
            checkboxStyle === 'toggle'
                ? h(
                      'div',
                      { 'data-style': 'toggle' },
                      h(
                          'div',
                          {
                              className: `relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-600 focus-within:ring-offset-2 mx-sdk-complete-checkbox__toggle ${checked ? 'bg-theme-600' : 'bg-gray-300'}`,
                              'data-checked': String(checked),
                          },
                          input,
                          h('span', {
                              className: `pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out mx-sdk-complete-checkbox__toggle-thumb ${checked ? 'translate-x-4' : 'translate-x-0'}`,
                              'aria-hidden': true,
                          })
                      )
                  )
                : h(
                      'div',
                      {
                          className:
                              'flex h-5 items-center mx-sdk-complete-checkbox__input-row',
                          'data-style': 'checkbox',
                      },
                      input
                  );
    }
    return h(
        'div',
        {
            role:
                !shellOwnsChrome && nonLabelable && props.title
                    ? 'group'
                    : undefined,
            'aria-labelledby':
                !shellOwnsChrome && nonLabelable && showTitle
                    ? labelId
                    : undefined,
            'aria-label':
                !shellOwnsChrome && nonLabelable && !showTitle
                    ? props.title
                    : undefined,
            className: ['mx-sdk-complete-checkbox', props.className]
                .filter(Boolean)
                .join(' '),
        },
        !shellOwnsChrome && showTitle
            ? h(
                  nonLabelable ? 'span' : 'label',
                  {
                      id: labelId,
                      htmlFor: nonLabelable ? undefined : id,
                      className: 'mx-sdk-complete-checkbox__title',
                  },
                  props.title
              )
            : null,
        control,
        feedback
            ? h(
                  'span',
                  {
                      id: `${id}-feedback`,
                      role: 'status',
                      'aria-live': 'polite',
                      className: 'mx-sdk-complete-checkbox__feedback',
                  },
                  feedback
              )
            : null
    );
}
