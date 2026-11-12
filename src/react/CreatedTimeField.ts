import { createElement, type ReactNode } from 'react';
import 'moment/min/locales.js';
import {
    formatDateInputValue,
    type DateInputCompatibilityConfig,
} from '../formulas/dateInputFormatting.js';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import { checkIfPageUrlIsValid } from '../forms/pageUrlValidation.js';
import {
    CompleteReadOnlyTextField,
    type CompleteReadOnlyTextFieldProps,
} from './CompleteReadOnlyTextField.js';
import {
    fieldPresentationDescribedBy,
    type FieldPresentationComposition,
} from './fieldPresentation.js';
import {
    CreatedTimeResource,
    type CreatedTimeAttachmentOptions,
    type CreatedTimeDisplayOwner,
    type CreatedTimeResourceLabels,
} from './CreatedTimeResource.js';
import {
    DateTimeControl,
    dateTimeConfiguration,
    type DateTimeFieldOptions,
} from './DateTimeField.js';

export type CreatedTimeFieldOptions = DateTimeFieldOptions;

/** Explicit display inputs, separate from the existing binding adapter. */
export type ControlledCreatedTimeFieldProps = Pick<
    CompleteReadOnlyTextFieldProps,
    'language' | 'textSize' | 'layout' | 'className'
> & {
    /** Select controlled data or a binding, never both. */
    binding?: never;
    render?: never;
    clearLabel?: never;
    value: string | null | undefined;
    /** The accepted Created-time result's date/dateTime configuration. */
    dateConfig: DateInputCompatibilityConfig;
    /** A supplied owner may retire presentation; it grants no write authority. */
    owner?: CreatedTimeDisplayOwner;
    /** Distinguish source/record lifetimes without borrowing a binding. */
    identity?: unknown;
    /** The editable computed-field path deliberately ignores resource flags. */
    displayContext?: 'editable' | 'readonly';
    displayAsAttachments?: boolean;
    displayAsButton?: boolean;
    buttonLabel?: string | null;
    attachmentOptions?: CreatedTimeAttachmentOptions;
    labels?: Partial<CreatedTimeResourceLabels>;
    /** Preview/authority projection: no resource activation or loading. */
    inert?: boolean;
    masked?: boolean;
    /** Localized malformed-shape feedback; malformed values are never coerced. */
    invalidValueLabel?: string;
    /** Existing shell owns visible labels, help, errors and form composition. */
    presentation?: FieldPresentationComposition;
};

export type {
    CreatedTimeAttachmentOptions,
    CreatedTimeDisplayOwner,
    CreatedTimeResourceLabels,
} from './CreatedTimeResource.js';
export type {
    DocumentThumbnailOptions,
    DocumentThumbnailSource,
    DocumentThumbnailLabels,
} from './document-preview/documentContent.js';

/**
 * Controlled readonly presentation. Formatting uses the shared date engine;
 * the legacy binding renderer below keeps its raw timestamp contract.
 */
export function ControlledCreatedTimeField(
    props: ControlledCreatedTimeFieldProps
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
            if (mode === 'text' && value != null)
                text = formatDateInputValue({
                    airtableValue: value,
                    airtableFieldConfig: props.dateConfig,
                    language: props.language,
                });
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

/** Preserve the supplied timestamp text without parsing result metadata. */
export function createdTimeInput(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/** Read-only timestamp presentation; the accepted owner keeps the native value. */
export function renderCreatedTimeField(
    props: FieldRendererProps<'createdTime'>,
    options: CreatedTimeFieldOptions = {}
): ReactNode {
    return createElement(DateTimeControl, {
        ...dateTimeConfiguration(props.displayConfig, props.writeConfig),
        ...options,
        title: props.title.trim() ? props.title : props.field.name,
        input: createdTimeInput(props.value),
        disabled: true,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
        // Computed presentation never borrows a date model or setter authority.
        setInput: () => {},
        clear: () => {},
    });
}
