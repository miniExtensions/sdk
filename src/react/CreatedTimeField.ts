import { ComputedTimeDisplay } from './ComputedTimeDisplay.js';
import { createElement, type ReactNode } from 'react';
import { type DateInputCompatibilityConfig } from '../formulas/dateInputFormatting.js';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import { type CompleteReadOnlyTextFieldProps } from './CompleteReadOnlyTextField.js';
import { type FieldPresentationComposition } from './fieldPresentation.js';
import {
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
    /** Date text locale; defaults to language without changing empty-value labels. */
    dateLanguage?: CompleteReadOnlyTextFieldProps['language'];
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

/** Controlled Created-time display; the binding renderer retains raw timestamps. */
export function ControlledCreatedTimeField(
    props: ControlledCreatedTimeFieldProps
): ReactNode {
    return createElement(ComputedTimeDisplay, props);
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
