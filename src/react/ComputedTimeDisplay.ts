import { createElement, type ReactNode } from 'react';
import 'moment/min/locales.js';
import {
    formatDateInputValue,
    type DateInputCompatibilityConfig,
} from '../formulas/dateInputFormatting.js';
import type { LastModifiedTimeFieldConfig } from '../formulas/types.js';
import { checkIfPageUrlIsValid } from '../forms/pageUrlValidation.js';
import { CompleteReadOnlyTextField } from './CompleteReadOnlyTextField.js';
import { fieldPresentationDescribedBy } from './fieldPresentation.js';
import { CreatedTimeResource } from './CreatedTimeResource.js';
import type { ControlledCreatedTimeFieldProps } from './CreatedTimeField.js';

/** Private shared computed-time UI. Result metadata is read only after dispatch. */
type ComputedTimeDisplayProps = Omit<
    ControlledCreatedTimeFieldProps,
    'dateConfig'
> & {
    dateConfig: DateInputCompatibilityConfig | LastModifiedTimeFieldConfig;
};

export function ComputedTimeDisplay(
    props: ComputedTimeDisplayProps
): ReactNode {
    if (props.owner) {
        try {
            if (props.owner.isCurrent() !== true) return null;
        } catch {
            return null;
        }
    }

    let text = '';
    let invalidShape = false;
    let mode: 'text' | 'attachment' | 'button' = 'text';
    let href: string | null = null;
    if (props.masked === true) {
        text = '••••••••';
    } else {
        const value = props.value;
        if (value != null && typeof value !== 'string') {
            invalidShape = true;
            text = props.invalidValueLabel ?? 'Unexpected field value';
        } else {
            if (
                props.displayContext !== 'editable' &&
                (props.displayAsAttachments === true ||
                    props.displayAsButton === true)
            ) {
                // Reuse the existing native-compatible validator. Only the
                // accepted href projection remains here; no second validator.
                if (typeof value === 'string' && checkIfPageUrlIsValid(value))
                    href = /^(?:https?:\/\/|mailto:)/i.test(value)
                        ? value
                        : `https://${value}`;
                if (
                    props.displayAsAttachments === true &&
                    href !== null &&
                    /^https?:\/\//i.test(href)
                )
                    mode = 'attachment';
                else if (props.displayAsButton === true) mode = 'button';
            }
            // Dispatch precedes formatting: URL modes never inspect date data.
            if (mode === 'text' && value != null) {
                const config = props.dateConfig;
                const result =
                    config.type === 'lastModifiedTime'
                        ? config.options.isValid === true
                            ? config.options.result
                            : null
                        : config;
                if (result !== null)
                    text = formatDateInputValue({
                        airtableValue: value,
                        airtableFieldConfig: result,
                        language: props.dateLanguage ?? props.language,
                    });
            }
        }
    }

    const association = props.presentation?.association;
    return createElement(
        'div',
        {
            className: 'mx-sdk-created-time-display',
            style:
                mode === 'attachment' &&
                props.attachmentOptions?.isInGrid === true
                    ? { height: '100%', minHeight: 0, minWidth: 0 }
                    : undefined,
            role: 'group',
            id: association?.controlId,
            'aria-labelledby': association?.labelId,
            'aria-describedby': association
                ? fieldPresentationDescribedBy(association)
                : undefined,
            'aria-invalid':
                invalidShape || association?.errorId !== undefined || undefined,
        },
        invalidShape
            ? createElement('p', { role: 'alert' }, text)
            : mode !== 'text'
              ? createElement(CreatedTimeResource, {
                    mode,
                    href,
                    owner: props.owner,
                    identity: props.identity,
                    inert: props.inert,
                    buttonLabel: props.buttonLabel,
                    attachmentOptions: props.attachmentOptions,
                    labels: props.labels,
                    className: props.className,
                })
              : createElement(CompleteReadOnlyTextField, {
                    value: text,
                    language: props.language,
                    textSize: props.textSize,
                    layout: props.layout,
                    className: props.className,
                })
    );
}
