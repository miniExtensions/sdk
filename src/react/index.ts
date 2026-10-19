import {
    createElement,
    Fragment,
    useMemo,
    useState,
    useRef,
    useEffect,
    useLayoutEffect,
    useId,
    useSyncExternalStore,
    type ReactNode,
    type ChangeEvent,
} from 'react';
import { dispatchField } from '../ui/rendererRegistry.js';
import { FieldRendererSource } from './fieldRendererSource.js';
export {
    BarcodeField,
    renderBarcodeField,
    type BarcodeFieldProps,
    type BarcodeFieldOptions,
} from './BarcodeField.js';
export {
    SingleCollaboratorField,
    renderSingleCollaboratorField,
    type SingleCollaboratorFieldProps,
    type SingleCollaboratorFieldOptions,
} from './SingleCollaboratorField.js';
export {
    MultipleCollaboratorsField,
    renderMultipleCollaboratorsField,
    type MultipleCollaboratorsFieldProps,
    type MultipleCollaboratorsFieldOptions,
} from './MultipleCollaboratorsField.js';
export {
    RichTextField,
    renderRichTextField,
    type RichTextFieldProps,
    type RichTextFieldOptions,
} from './RichTextField.js';
export {
    AiTextField,
    renderAiTextField,
    type AiTextFieldProps,
    type AiTextFieldOptions,
} from './AiTextField.js';
export {
    MultipleAttachmentsField,
    renderMultipleAttachmentsField,
    type MultipleAttachmentsFieldProps,
    type MultipleAttachmentsFieldOptions,
} from './MultipleAttachmentsField.js';
export {
    ReadonlyAttachmentsField,
    renderReadonlyAttachmentsField,
    type ReadonlyAttachmentsFieldProps,
    type ReadonlyAttachmentsFieldOptions,
} from './ReadonlyAttachmentsField.js';
import {
    SingleSelectControl,
    singleSelectConfiguration,
    singleSelectDisplayOptions,
    type SingleSelectFieldOptions,
} from './SingleSelectField.js';
export {
    renderSingleSelectField,
    type SingleSelectFieldOptions,
} from './SingleSelectField.js';
import { LookupControl, type LookupFieldOptions } from './LookupField.js';
export { renderLookupField, type LookupFieldOptions } from './LookupField.js';
import { RollupControl, type RollupFieldOptions } from './RollupField.js';
export { renderRollupField, type RollupFieldOptions } from './RollupField.js';
import { FormulaControl, type FormulaFieldOptions } from './FormulaField.js';
export {
    renderFormulaField,
    type FormulaFieldOptions,
} from './FormulaField.js';
export {
    renderMultipleRecordLinksField,
    type LinkedRecordsFieldOptions,
} from './LinkedRecordsField.js';
import {
    renderMultipleSelectsField,
    type MultipleSelectFieldOptions,
} from './MultipleSelectField.js';
export {
    renderMultipleSelectsField,
    type MultipleSelectFieldOptions,
} from './MultipleSelectField.js';
import {
    DateControl,
    dateConfiguration,
    type DateFieldOptions,
} from './DateField.js';
export { renderDateField, type DateFieldOptions } from './DateField.js';
import {
    TextControl,
    textConfiguration,
    type TextFieldOptions,
} from './TextField.js';
export {
    renderSingleLineTextField,
    type TextFieldOptions,
} from './TextField.js';
import type { ExternalSyncSourceFieldOptions } from './ExternalSyncSourceField.js';
import {
    lastModifiedByName,
    type LastModifiedByFieldOptions,
} from './LastModifiedByField.js';
export {
    renderLastModifiedByField,
    type LastModifiedByFieldOptions,
} from './LastModifiedByField.js';
export {
    renderExternalSyncSourceField,
    type ExternalSyncSourceFieldOptions,
} from './ExternalSyncSourceField.js';
import { createdByName, type CreatedByFieldOptions } from './CreatedByField.js';
export {
    renderCreatedByField,
    type CreatedByFieldOptions,
} from './CreatedByField.js';
import {
    lastModifiedTimeInput,
    type LastModifiedTimeFieldOptions,
} from './LastModifiedTimeField.js';
export {
    renderLastModifiedTimeField,
    type LastModifiedTimeFieldOptions,
} from './LastModifiedTimeField.js';
import {
    createdTimeInput,
    type CreatedTimeFieldOptions,
} from './CreatedTimeField.js';
export {
    renderCreatedTimeField,
    type CreatedTimeFieldOptions,
} from './CreatedTimeField.js';
import {
    MultilineTextControl,
    multilineTextConfiguration,
    multilineTextUnavailable,
    type MultilineTextFieldOptions,
} from './MultilineTextField.js';
export {
    renderMultilineTextField,
    type MultilineTextFieldOptions,
} from './MultilineTextField.js';
export {
    renderPhoneNumberField,
    type PhoneNumberFieldOptions,
} from './PhoneNumberField.js';
export { renderUrlField, type UrlFieldOptions } from './UrlField.js';
export { renderEmailField, type EmailFieldOptions } from './EmailField.js';
import {
    CheckboxControl,
    checkboxConfiguration,
    type CheckboxFieldOptions,
} from './CheckboxField.js';
export {
    CheckboxInput,
    renderCheckboxField,
    type CheckboxInputProps,
    type CheckboxFieldOptions,
} from './CheckboxField.js';
import {
    NumberControl,
    numberConfiguration,
    type NumberFieldOptions,
} from './NumberField.js';
export { renderNumberField, type NumberFieldOptions } from './NumberField.js';
import { countInput, type CountFieldOptions } from './CountField.js';
export { renderCountField, type CountFieldOptions } from './CountField.js';
export {
    renderAutoNumberField,
    type AutoNumberFieldOptions,
} from './AutoNumberField.js';
export { renderRatingField, type RatingFieldOptions } from './RatingField.js';
export {
    renderPercentField,
    type PercentFieldOptions,
} from './PercentField.js';
import {
    CurrencyControl,
    currencyConfiguration,
    type CurrencyFieldOptions,
} from './CurrencyField.js';
export {
    renderCurrencyField,
    type CurrencyFieldOptions,
} from './CurrencyField.js';
import {
    DurationControl,
    durationConfiguration,
    type DurationFieldOptions,
} from './DurationField.js';
export {
    renderDurationField,
    type DurationFieldOptions,
} from './DurationField.js';
import {
    DateTimeControl,
    dateTimeConfiguration,
    type DateTimeFieldOptions,
} from './DateTimeField.js';
export {
    renderDateTimeField,
    type DateTimeFieldOptions,
} from './DateTimeField.js';
import type {
    FormRenderScope,
    FormRenderSnapshot,
} from '../ui/formRenderScope.js';
import type {
    PortalRenderScope,
    PortalRenderSnapshot,
} from '../ui/portalRenderScope.js';
import type { FormFieldBinding, FormFieldSnapshot } from '../forms/bindings.js';
import type {
    FormAttachmentController,
    FormAttachmentSnapshot,
} from '../forms/attachmentController.js';

/** A file chooser's bubbling cancel is not cancellation of its surrounding dialog. */
export function isDialogCancellation(event: {
    target: unknown;
    currentTarget: unknown;
}): boolean {
    return event.target === event.currentTarget;
}

/** Optional shell. Picker cancellation never closes it or changes the pending queue. */
export function AttachmentDialog({
    children,
    onClose,
}: {
    children: ReactNode;
    onClose(): void;
}): ReactNode {
    const dialog = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const node = dialog.current;
        if (node == null) return;
        node.showModal();
        return () => node.close();
    }, []);
    return createElement(
        'dialog',
        {
            ref: dialog,
            onCancel: (
                event: import('react').SyntheticEvent<HTMLDialogElement>
            ) => {
                event.preventDefault();
                if (!isDialogCancellation(event)) return;
                onClose();
            },
        },
        children,
        createElement('button', { type: 'button', onClick: onClose }, 'Close')
    );
}

export type AttachmentRenderState = FieldRenderState & {
    attachment: FormAttachmentSnapshot;
    controller: FormAttachmentController;
};
export type AttachmentFieldProps = {
    binding: FormFieldBinding;
    controller: FormAttachmentController;
    render?(state: AttachmentRenderState): ReactNode;
};

/** Unmount removes subscriptions, never the owner-held queue or uncertainty journal. */
export function AttachmentField({
    binding,
    controller,
    render,
}: AttachmentFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    const input = useRef<HTMLInputElement>(null);
    const section = useRef<HTMLElement>(null);
    const choose = useRef<HTMLButtonElement>(null);
    const upload = useRef<HTMLButtonElement>(null);
    const cancel = useRef<HTMLButtonElement>(null);
    const statusId = useId();
    // Focus belongs to this rendered owner, never to an asynchronous upload.
    const focus = useMemo<{ element: HTMLButtonElement | null }>(
        () => ({ element: null }),
        [binding, controller]
    );
    const store = useMemo(() => {
        let value = controller.getSnapshot();
        return {
            getSnapshot: () => value,
            subscribe: (notify: () => void) =>
                controller.subscribe((next) => {
                    value = next;
                    notify();
                }),
        };
    }, [controller]);
    const attachment = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    useLayoutEffect(() => {
        const node = section.current;
        const previous = focus.element;
        if (node == null || previous == null) return;
        const active = node.ownerDocument.activeElement;
        if (
            active !== previous &&
            !(active === node.ownerDocument.body && !previous.isConnected)
        )
            return;
        if (previous.isConnected && !previous.disabled && !previous.hidden)
            return;
        const removals = Array.from(
            node.querySelectorAll<HTMLButtonElement>(
                'button[data-attachment-remove]:not(:disabled)'
            )
        );
        const index = previous.dataset.attachmentRemove;
        const nextRow =
            index == null
                ? null
                : (removals.find(
                      (button) =>
                          Number(button.dataset.attachmentRemove) >=
                          Number(index)
                  ) ?? removals.at(-1));
        const next =
            nextRow ??
            [
                attachment.busy ? cancel.current : upload.current,
                choose.current,
            ].find((button) => button && !button.disabled && !button.hidden);
        (next ?? node).focus();
    });
    if (render) return render({ snapshot, attachment, binding, controller });
    if (snapshot.retired || attachment.retired) return null;
    const visible = snapshot.visibility.type === 'visible';
    if (!visible && attachment.files.length === 0 && !attachment.busy)
        return null;
    const pending = `${attachment.files.length} pending ${
        attachment.files.length === 1 ? 'file' : 'files'
    }.`;
    const message =
        attachment.phase === 'uncertain'
            ? 'Upload outcome uncertain. Inspect the upload before continuing; it was not added or retried automatically.'
            : attachment.phase === 'uploading'
              ? 'Uploading one attachment. Wait for confirmation before uploading the next file.'
              : attachment.phase === 'accepted'
                ? 'Attachment accepted into the draft. Save to submit your changes.'
                : attachment.files.length > 0
                  ? 'Files selected. Upload each file explicitly, then Save.'
                  : 'No pending files. Choose files to begin.';
    const actions = {
        display: 'flex',
        flexWrap: 'wrap' as const,
        gap: '0.5rem',
        alignItems: 'center',
    };
    return createElement(
        'section',
        {
            ref: section,
            tabIndex: -1,
            'aria-label': visible
                ? (snapshot.field?.title ?? 'Attachments')
                : 'Pending attachment activity',
            'aria-describedby': statusId,
            style: {
                display: 'grid',
                gap: '0.75rem',
                padding: '1rem',
                border: '1px solid #cbd5e1',
                borderRadius: '0.5rem',
                minWidth: 0,
                overflowWrap: 'anywhere',
            },
            onFocusCapture: (
                event: import('react').FocusEvent<HTMLElement>
            ) => {
                focus.element =
                    event.target.tagName === 'BUTTON'
                        ? (event.target as HTMLButtonElement)
                        : null;
            },
            onBlurCapture: (event: import('react').FocusEvent<HTMLElement>) => {
                if (
                    event.relatedTarget &&
                    !event.currentTarget.contains(event.relatedTarget)
                )
                    focus.element = null;
            },
            onDragOver: (event: import('react').DragEvent<HTMLElement>) =>
                event.preventDefault(),
            onDrop: (event: import('react').DragEvent<HTMLElement>) => {
                event.preventDefault();
                controller.select(Array.from(event.dataTransfer.files));
            },
        },
        visible
            ? createElement(
                  'strong',
                  null,
                  snapshot.field?.title ?? 'Attachments'
              )
            : null,
        visible && attachment.rows.length > 0
            ? createElement(
                  'ul',
                  {
                      'aria-label': 'Existing attachments',
                      style: { margin: 0, paddingInlineStart: '1.5rem' },
                  },
                  ...attachment.rows.map((row) =>
                      createElement(
                          'li',
                          {
                              key: row.nativeIndex,
                              style: { paddingBlock: '0.25rem' },
                          },
                          createElement(
                              'div',
                              {
                                  style: {
                                      ...actions,
                                      justifyContent: 'space-between',
                                  },
                              },
                              createElement(
                                  'span',
                                  { style: { minWidth: 0 } },
                                  row.label
                              ),
                              createElement(
                                  'button',
                                  {
                                      type: 'button',
                                      'data-attachment-remove': row.nativeIndex,
                                      'aria-label': `Remove attachment ${row.nativeIndex + 1}`,
                                      disabled: !row.removeAllowed,
                                      onClick: () =>
                                          controller.remove(
                                              attachment.valuesRevision,
                                              row.nativeIndex
                                          ),
                                  },
                                  'Remove attachment'
                              )
                          )
                      )
                  )
              )
            : null,
        visible && attachment.presentation === 'unavailable'
            ? createElement('p', null, 'Attachment presentation unavailable')
            : null,
        createElement('input', {
            ref: input,
            type: 'file',
            hidden: true,
            multiple: true,
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
                controller.select(Array.from(event.currentTarget.files ?? []));
                // The controller owns File identities; allow selecting the same file again.
                event.currentTarget.value = '';
            },
        }),
        createElement(
            'div',
            { id: statusId, role: 'status', 'aria-atomic': true },
            createElement(
                'p',
                { style: { margin: 0, fontWeight: 600 } },
                pending
            ),
            createElement('p', { style: { margin: '0.25rem 0 0' } }, message),
            attachment.error && attachment.phase !== 'uncertain'
                ? createElement(
                      'p',
                      { style: { margin: '0.25rem 0 0' } },
                      attachment.error
                  )
                : null
        ),
        attachment.busy
            ? createElement('progress', {
                  'aria-label':
                      attachment.phase === 'uncertain'
                          ? 'Awaiting upload outcome'
                          : 'Uploading attachment',
                  style: { width: '100%' },
              })
            : null,
        createElement(
            'div',
            { style: actions },
            createElement(
                'button',
                {
                    ref: choose,
                    type: 'button',
                    hidden: !visible,
                    'aria-describedby': statusId,
                    disabled:
                        (!snapshot.canEdit && !attachment.busy) ||
                        (attachment.phase === 'uncertain' && !attachment.busy),
                    onClick: () => input.current?.click(),
                },
                'Choose files'
            ),
            createElement(
                'button',
                {
                    ref: upload,
                    type: 'button',
                    hidden: !visible,
                    'aria-describedby': statusId,
                    disabled:
                        attachment.busy ||
                        attachment.phase === 'uncertain' ||
                        attachment.files.length === 0 ||
                        !snapshot.canEdit,
                    onClick: () => void controller.upload(),
                },
                'Upload next file'
            )
        ),
        createElement(
            'div',
            { style: actions },
            createElement(
                'button',
                {
                    type: 'button',
                    'aria-describedby': statusId,
                    disabled: attachment.files.length === 0,
                    onClick: () => controller.clear(),
                },
                'Clear pending files'
            ),
            createElement(
                'button',
                {
                    ref: cancel,
                    type: 'button',
                    'aria-describedby': statusId,
                    disabled: !attachment.busy,
                    onClick: () => controller.cancel(),
                },
                'Cancel upload'
            )
        )
    );
}

/** Cache detached snapshots: React requires stable identity between notifications. */
export function useFieldBinding(binding: FormFieldBinding): FormFieldSnapshot {
    const store = useMemo(() => {
        let snapshot = binding.getSnapshot();
        return {
            getSnapshot: () => snapshot,
            subscribe: (notify: () => void) =>
                binding.subscribe((next) => {
                    snapshot = next;
                    notify();
                }),
        };
    }, [binding]);
    return useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
}
export type FieldRenderState = {
    snapshot: FormFieldSnapshot;
    binding: FormFieldBinding;
};
export type FieldProps = {
    binding: FormFieldBinding;
    render?(state: FieldRenderState): ReactNode;
};
const status = (snapshot: FormFieldSnapshot) =>
    createElement(
        'p',
        { role: 'status', 'aria-busy': snapshot.pending },
        snapshot.scalar?.error ??
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n')
    );
export type LastModifiedTimeFieldProps = FieldProps &
    LastModifiedTimeFieldOptions;
/** Valid supplied modification timestamps stay readonly without recomputation. */
export function LastModifiedTimeField({
    binding,
    render,
    className,
    clearLabel,
}: LastModifiedTimeFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'lastModifiedTime' ||
        schema.airtableField.config.type !== 'lastModifiedTime'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Last Modified Time fields.'
        );
    return createElement(DateTimeControl, {
        ...dateTimeConfiguration(schema.miniExtConfig),
        className,
        clearLabel,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        input: lastModifiedTimeInput(
            snapshot.value,
            schema.airtableField.config
        ),
        disabled: true,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setInput: () => {},
        clear: () => {},
    });
}
export type CreatedTimeFieldProps = FieldProps & CreatedTimeFieldOptions;
/** The supplied creation timestamp stays readonly regardless of result metadata. */
export function CreatedTimeField({
    binding,
    render,
    className,
    clearLabel,
}: CreatedTimeFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'createdTime' ||
        schema.airtableField.config.type !== 'createdTime'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Created Time fields.'
        );
    return createElement(DateTimeControl, {
        ...dateTimeConfiguration(schema.miniExtConfig),
        className,
        clearLabel,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        input: createdTimeInput(snapshot.value),
        disabled: true,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setInput: () => {},
        clear: () => {},
    });
}
export type LastModifiedByFieldProps = FieldProps & LastModifiedByFieldOptions;
/** The supplied modifier name stays readonly regardless of forged editing state. */
export function LastModifiedByField({
    binding,
    render,
    className,
    clearLabel,
}: LastModifiedByFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'lastModifiedBy' ||
        schema.airtableField.config.type !== 'lastModifiedBy'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Last Modified By fields.'
        );
    return createElement(TextControl, {
        ...textConfiguration(schema.miniExtConfig),
        className,
        clearLabel,
        source: binding,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        value: lastModifiedByName(snapshot.value),
        disabled: true,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setValue: () => false,
    });
}
export type CreatedByFieldProps = FieldProps & CreatedByFieldOptions;
/** The supplied creator name stays readonly regardless of forged editing state. */
export function CreatedByField({
    binding,
    render,
    className,
    clearLabel,
}: CreatedByFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'createdBy' ||
        schema.airtableField.config.type !== 'createdBy'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Created By fields.'
        );
    return createElement(TextControl, {
        ...textConfiguration(schema.miniExtConfig),
        className,
        clearLabel,
        source: binding,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        value: createdByName(snapshot.value),
        disabled: true,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setValue: () => false,
    });
}
export type ExternalSyncSourceFieldProps = FieldProps &
    ExternalSyncSourceFieldOptions;
/** The supplied source name stays readonly regardless of forged editing state. */
export function ExternalSyncSourceField({
    binding,
    render,
    className,
    clearLabel,
}: ExternalSyncSourceFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'externalSyncSource' ||
        schema.airtableField.config.type !== 'externalSyncSource'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports External Sync Source fields.'
        );
    return createElement(TextControl, {
        ...textConfiguration(schema.miniExtConfig),
        className,
        clearLabel,
        source: binding,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        value: typeof snapshot.value === 'string' ? snapshot.value : '',
        disabled: true,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setValue: () => false,
    });
}
export type FormulaFieldProps = FieldProps & FormulaFieldOptions;
/** Present the accepted computed answer without borrowing any binding actions. */
export function FormulaField({
    binding,
    render,
    className,
}: FormulaFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'formula' ||
        schema.airtableField.config.type !== 'formula'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Formula fields.'
        );
    return createElement(FormulaControl, {
        field: schema.airtableField,
        title: snapshot.field?.title ?? '',
        value: snapshot.value,
        displayConfig: schema.miniExtConfig,
        pending: snapshot.pending,
        error: snapshot.error,
        validation: snapshot.validation,
        className,
    });
}
export type LookupFieldProps = FieldProps & LookupFieldOptions;
/** Present the accepted Lookup array without borrowing binding or linked actions. */
export function LookupField({
    binding,
    render,
    className,
}: LookupFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'multipleLookupValues' ||
        schema.airtableField.config.type !== 'multipleLookupValues'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Lookup fields.'
        );
    return createElement(LookupControl, {
        field: schema.airtableField,
        title: snapshot.field?.title ?? '',
        value: snapshot.value,
        displayConfig: schema.miniExtConfig,
        pending: snapshot.pending,
        error: snapshot.error,
        validation: snapshot.validation,
        className,
    });
}
export type RollupFieldProps = FieldProps & RollupFieldOptions;
/** Present the accepted computed answer without borrowing any binding actions. */
export function RollupField({
    binding,
    render,
    className,
}: RollupFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'rollup' ||
        schema.airtableField.config.type !== 'rollup'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Rollup fields.'
        );
    return createElement(RollupControl, {
        field: schema.airtableField,
        title: snapshot.field?.title ?? '',
        value: snapshot.value,
        displayConfig: schema.miniExtConfig,
        pending: snapshot.pending,
        error: snapshot.error,
        validation: snapshot.validation,
        className,
    });
}
export type CountFieldProps = FieldProps & CountFieldOptions;
/** Computed Count metadata and native values remain owned by the binding. */
export function CountField({
    binding,
    render,
    className,
}: CountFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'count' ||
        schema.airtableField.config.type !== 'count'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Count fields.'
        );
    return createElement(NumberControl, {
        ...numberConfiguration(schema.miniExtConfig),
        className,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        input: countInput(snapshot.value, schema.airtableField.config),
        disabled: true,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setInput: () => {},
    });
}
export type AutoNumberFieldProps = FieldProps & NumberFieldOptions;
/** Computed native numbers have no local input model or write action. */
export function AutoNumberField({
    binding,
    render,
    className,
}: AutoNumberFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'autoNumber' ||
        schema.airtableField.config.type !== 'autoNumber'
    )
        return status(snapshot);
    return createElement(NumberControl, {
        ...numberConfiguration(schema.miniExtConfig),
        className,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        input:
            typeof snapshot.value === 'number' &&
            Number.isFinite(snapshot.value)
                ? String(snapshot.value)
                : '',
        disabled: true,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setInput: () => {},
    });
}
export type TextFieldProps = FieldProps & TextFieldOptions;
export function TextField({
    binding,
    render,
    className,
    clearLabel,
}: TextFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const config = textConfiguration(snapshot.field?.schema.miniExtConfig);
    return createElement(TextControl, {
        ...config,
        className,
        clearLabel,
        source: binding,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : (snapshot.field?.schema.airtableField.name ?? ''),
        value: typeof snapshot.value === 'string' ? snapshot.value : '',
        disabled:
            config.configuredReadOnly || !snapshot.canEdit || snapshot.pending,
        pending: snapshot.pending,
        invalid:
            snapshot.scalar?.error != null ||
            snapshot.error !== null ||
            snapshot.validation.length > 0,
        feedback:
            snapshot.scalar?.error ??
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setValue: (value) => binding.setValue(value).accepted,
    });
}
/** Plain multiline text borrows the owner setter and never submits on Enter. */
export type MultilineTextFieldProps = FieldProps & MultilineTextFieldOptions;
export function MultilineTextField({
    binding,
    render,
    className,
    clearLabel,
}: MultilineTextFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const title = snapshot.field?.title.trim()
        ? snapshot.field.title
        : (snapshot.field?.schema.airtableField.name ?? '');
    const config = multilineTextConfiguration(
        snapshot.field?.schema.miniExtConfig ?? null
    );
    const unavailable =
        snapshot.field?.schema.fieldType !== 'multilineText'
            ? 'This control supports plain multiline text fields.'
            : config.unavailable;
    if (unavailable)
        return multilineTextUnavailable(
            title,
            unavailable,
            className,
            config.showTitle
        );
    return createElement(MultilineTextControl, {
        ...config,
        className,
        clearLabel,
        source: binding,
        title,
        value: typeof snapshot.value === 'string' ? snapshot.value : '',
        disabled:
            config.configuredReadOnly || !snapshot.canEdit || snapshot.pending,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setValue: (value) => binding.setValue(value).accepted,
    });
}
/** Phone drafts stay literal text without formatting or dialing actions. */
export type PhoneNumberFieldProps = TextFieldProps;
export function PhoneNumberField(props: PhoneNumberFieldProps): ReactNode {
    return createElement(TextField, props);
}
/** URL drafts stay literal text and grant no navigation authority. */
export type UrlFieldProps = TextFieldProps;
export function UrlField(props: UrlFieldProps): ReactNode {
    return createElement(TextField, props);
}
/** Email preserves exact text; surrounding page and server owners validate it. */
export type EmailFieldProps = TextFieldProps;
export function EmailField(props: EmailFieldProps): ReactNode {
    return createElement(TextField, props);
}
/** Numeric input uses native units, including fractional percent values. */
export type NumberFieldProps = FieldProps & NumberFieldOptions;
export type RatingFieldProps = NumberFieldProps;
/** Native numeric rating drafts stay with the accepted scalar owner. */
export function RatingField(props: RatingFieldProps): ReactNode {
    return createElement(NumberField, props);
}
export type PercentFieldProps = NumberFieldProps;
export type CurrencyFieldProps = FieldProps & CurrencyFieldOptions;
export type DurationFieldProps = FieldProps & DurationFieldOptions;
export function NumberField({
    binding,
    render,
    className,
    clearLabel,
}: NumberFieldProps & DurationFieldOptions & CurrencyFieldOptions): ReactNode {
    const subscribed = useFieldBinding(binding);
    // Accepted duration metadata can change without a native write.
    const snapshot =
        subscribed.scalar?.kind === 'duration'
            ? binding.getSnapshot()
            : subscribed;
    if (render) return render({ snapshot, binding });
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        !snapshot.scalar ||
        snapshot.scalar.kind === 'checkbox'
    )
        return null;
    if (
        snapshot.field?.schema.fieldType === 'number' ||
        snapshot.field?.schema.fieldType === 'percent' ||
        snapshot.field?.schema.fieldType === 'rating'
    ) {
        if (snapshot.scalar.retired || snapshot.scalar.kind !== 'number')
            return null;
        const config = numberConfiguration(snapshot.field.schema.miniExtConfig);
        return createElement(NumberControl, {
            ...config,
            className,
            title: snapshot.field.title.trim()
                ? snapshot.field.title
                : snapshot.field.schema.airtableField.name,
            input: snapshot.scalar.input,
            disabled:
                config.configuredReadOnly ||
                !snapshot.canEdit ||
                !snapshot.scalar.canEdit ||
                snapshot.pending,
            pending: snapshot.pending,
            invalid:
                !snapshot.scalar.valid ||
                snapshot.error !== null ||
                snapshot.validation.length > 0,
            feedback:
                snapshot.scalar.error ??
                snapshot.error ??
                snapshot.validation
                    .map((error) => error.errorMessage)
                    .join('\n'),
            setInput: (input) => binding.scalar?.setInput(input),
        });
    }
    if (snapshot.field?.schema.fieldType === 'currency') {
        if (snapshot.scalar.kind !== 'number' || snapshot.scalar.retired)
            return null;
        const config = currencyConfiguration(
            snapshot.field.schema.miniExtConfig
        );
        const metadata = snapshot.field.schema.airtableField.config;
        return createElement(CurrencyControl, {
            ...config,
            className,
            clearLabel,
            title: snapshot.field.title.trim()
                ? snapshot.field.title
                : snapshot.field.schema.airtableField.name,
            symbol: metadata.type === 'currency' ? metadata.options.symbol : '',
            input: snapshot.scalar.input,
            disabled:
                config.configuredReadOnly ||
                !snapshot.canEdit ||
                !snapshot.scalar.canEdit ||
                snapshot.pending,
            pending: snapshot.pending,
            invalid:
                !snapshot.scalar.valid ||
                snapshot.error !== null ||
                snapshot.validation.length > 0,
            feedback:
                snapshot.scalar.error ??
                snapshot.error ??
                snapshot.validation
                    .map((error) => error.errorMessage)
                    .join('\n'),
            setInput: (input) => binding.scalar?.setInput(input),
            clear: () => binding.scalar?.setInput(''),
        });
    }
    if (snapshot.field?.schema.fieldType === 'duration') {
        if (snapshot.scalar.kind !== 'duration' || snapshot.scalar.retired)
            return null;
        const config = durationConfiguration(
            snapshot.field.schema.miniExtConfig,
            undefined,
            snapshot.scalar.durationFormat
        );
        return createElement(DurationControl, {
            ...config,
            className,
            clearLabel,
            title: snapshot.field.title.trim()
                ? snapshot.field.title
                : snapshot.field.schema.airtableField.name,
            input: snapshot.scalar.input,
            disabled:
                config.configuredReadOnly ||
                !snapshot.canEdit ||
                !snapshot.scalar.canEdit ||
                snapshot.scalar.durationFormat === null ||
                typeof binding.scalar?.setFocused !== 'function' ||
                snapshot.pending,
            pending: snapshot.pending,
            invalid:
                !snapshot.scalar.valid ||
                snapshot.error !== null ||
                snapshot.validation.length > 0,
            feedback:
                snapshot.scalar.error ??
                snapshot.error ??
                snapshot.validation
                    .map((error) => error.errorMessage)
                    .join('\n'),
            setInput: (input) => binding.scalar?.setInput(input),
            setFocused: (focused) => binding.scalar?.setFocused?.(focused),
            clear: () => binding.scalar?.setInput(''),
        });
    }
    return createElement(
        'div',
        null,
        createElement(
            'label',
            null,
            snapshot.field?.title,
            createElement('input', {
                type: 'text',
                inputMode:
                    snapshot.scalar.kind === 'duration' ? 'text' : 'decimal',
                placeholder:
                    snapshot.scalar.kind === 'duration'
                        ? ((snapshot.field?.schema.miniExtConfig &&
                          'placeholderText' in
                              snapshot.field.schema.miniExtConfig
                              ? snapshot.field.schema.miniExtConfig
                                    .placeholderText
                              : undefined) ??
                          snapshot.scalar.durationFormat ??
                          undefined)
                        : undefined,
                value: snapshot.scalar.input,
                disabled: !snapshot.canEdit,
                'aria-invalid': !snapshot.scalar.valid,
                onFocus: () => binding.scalar?.setFocused?.(true),
                onBlur: () => binding.scalar?.setFocused?.(false),
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                    binding.scalar?.setInput(event.currentTarget.value),
            })
        ),
        status(snapshot)
    );
}
/** Percent input preserves native fractions without display conversion. */
export function PercentField(props: PercentFieldProps): ReactNode {
    return createElement(NumberField, props);
}
/** Currency adornment shares the existing numeric owner and raw native units. */
export function CurrencyField(props: CurrencyFieldProps): ReactNode {
    return createElement(NumberField, props);
}
/** Clock editing shares the existing scalar owner; render may replace all markup. */
export function DurationField(props: DurationFieldProps): ReactNode {
    return createElement(NumberField, props);
}
export type CheckboxFieldProps = FieldProps & CheckboxFieldOptions;
export function CheckboxField({
    binding,
    render,
    className,
}: CheckboxFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        snapshot.scalar?.kind !== 'checkbox' ||
        snapshot.scalar.retired ||
        snapshot.field?.schema.fieldType !== 'checkbox'
    )
        return null;
    const config = checkboxConfiguration(snapshot.field.schema.miniExtConfig);
    return createElement(CheckboxControl, {
        ...config,
        className,
        title: snapshot.field.title.trim()
            ? snapshot.field.title
            : snapshot.field.schema.airtableField.name,
        checked: snapshot.scalar.checked,
        disabled:
            config.disabled ||
            !snapshot.canEdit ||
            !snapshot.scalar.canEdit ||
            snapshot.pending,
        pending: snapshot.pending,
        invalid:
            !snapshot.scalar.valid ||
            snapshot.error !== null ||
            snapshot.validation.length > 0,
        feedback:
            snapshot.scalar.error ??
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setChecked: (checked) => binding.scalar?.setChecked(checked) ?? false,
    });
}

export type MultipleSelectFieldProps = FieldProps & MultipleSelectFieldOptions;
/** Borrow a Form binding; the existing owner retains every selection policy. */
export function MultipleSelectField({
    binding,
    render,
    ...options
}: MultipleSelectFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'multipleSelects' ||
        (snapshot.value != null &&
            (!Array.isArray(snapshot.value) ||
                !snapshot.value.every((value) => typeof value === 'string')))
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Multiple Select fields.'
        );
    const selection = binding.selection;
    const choice = binding.choiceCreation;
    const control = renderMultipleSelectsField(
        {
            physicalKind: 'multipleSelects',
            presentation: {
                type: 'physical',
                config: schema.airtableField.config,
            },
            fieldId: schema.airtableField.id,
            title: snapshot.field!.title,
            field: schema.airtableField,
            displayConfig: schema.miniExtConfig ?? null,
            writeConfig: schema.miniExtConfig ?? null,
            value: snapshot.value as readonly string[] | null | undefined,
            context: 'form',
            computed: schema.airtableField.isComputed === true,
            dirty: snapshot.dirty,
            pending: snapshot.pending,
            error: snapshot.error,
            validation: snapshot.validation,
            selectAvailability: snapshot.selectAvailability ?? undefined,
            capability: snapshot.readOnly
                ? { type: 'readonly' }
                : {
                      type: 'editable',
                      setValue: binding.setValue,
                      selection:
                          selection && snapshot.selection
                              ? {
                                    choose: selection.choose,
                                    toggle: selection.toggle,
                                    clear: selection.clear,
                                    setSearchInput: selection.setSearchInput,
                                    reload: selection.reload,
                                    loadMore: selection.loadMore,
                                    cancel: selection.cancel,
                                    state: {
                                        ...snapshot.selection,
                                        disabled:
                                            snapshot.selection.disabled ||
                                            !snapshot.canEdit,
                                    },
                                }
                              : undefined,
                      choice:
                          choice && snapshot.choiceCreation
                              ? {
                                    state: snapshot.choiceCreation,
                                    create: choice.create,
                                    cancel: choice.cancel,
                                }
                              : undefined,
                  },
        },
        options
    );
    return createElement(
        FieldRendererSource.Provider,
        { value: binding },
        control
    );
}

export type SingleSelectFieldProps = FieldProps &
    Omit<SingleSelectFieldOptions, 'source'>;

function singleSelectBinding(
    binding: FormFieldBinding,
    snapshot: FormFieldSnapshot,
    options: Omit<SingleSelectFieldOptions, 'source'> = {}
): ReactNode {
    if (snapshot.retired || snapshot.visibility.type !== 'visible') return null;
    const schema = snapshot.field?.schema;
    if (
        schema?.fieldType !== 'singleSelect' ||
        schema.airtableField.config.type !== 'singleSelect'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Single Select fields.'
        );
    const config = singleSelectConfiguration(schema.miniExtConfig);
    const model = binding.selection;
    const state = snapshot.selection;
    const selection =
        model && state?.multiple === false
            ? {
                  state,
                  choose: model.choose,
                  toggle: model.toggle,
                  clear: model.clear,
                  setSearchInput: model.setSearchInput,
                  reload: model.reload,
                  loadMore: model.loadMore,
                  cancel: model.cancel,
              }
            : undefined;
    const creator = binding.choiceCreation;
    const computed =
        snapshot.field?.isComputed === true ||
        schema.airtableField.isComputed === true;
    return createElement(SingleSelectControl, {
        ...config,
        ...options,
        source: binding,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : schema.airtableField.name,
        value: typeof snapshot.value === 'string' ? snapshot.value : '',
        displayOptions: config.password
            ? []
            : singleSelectDisplayOptions(
                  schema.airtableField,
                  schema.miniExtConfig
              ),
        selection,
        choice:
            selection &&
            creator &&
            snapshot.choiceCreation &&
            !computed &&
            !snapshot.readOnly &&
            !config.configuredReadOnly &&
            !config.password
                ? {
                      state: snapshot.choiceCreation,
                      create: creator.create,
                      cancel: creator.cancel,
                  }
                : undefined,
        availability: snapshot.selectAvailability,
        disabled:
            config.password ||
            config.configuredReadOnly ||
            computed ||
            !snapshot.canEdit ||
            snapshot.pending ||
            !selection ||
            selection.state.disabled ||
            selection.state.readOnly,
        pending: snapshot.pending,
        invalid: snapshot.error !== null || snapshot.validation.length > 0,
        feedback:
            selection?.state.error ??
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
    });
}

/** Borrows the accepted binding; local choice text is scoped to its identity. */
export function SingleSelectField({
    binding,
    render,
    ...options
}: SingleSelectFieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    return singleSelectBinding(binding, snapshot, options);
}

export function SelectField({ binding, render }: FieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    // Renderer-local text is not native data; replacement owners get a fresh input.
    const [intent, setIntent] = useState({ binding, name: '' });
    const name = intent.binding === binding ? intent.name : '';
    if (render) return render({ snapshot, binding });
    if (snapshot.field?.schema.fieldType === 'singleSelect')
        return singleSelectBinding(binding, snapshot);
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        !snapshot.selection
    )
        return null;
    const state = snapshot.selection;
    const options = new Map(
        [...state.selectedOptions, ...state.options].map((option) => [
            option.value,
            option,
        ])
    );
    return createElement(
        'div',
        null,
        createElement(
            'label',
            null,
            snapshot.field?.title,
            createElement(
                'select',
                {
                    multiple: state.multiple,
                    value: state.multiple
                        ? [...state.value]
                        : (state.value[0] ?? ''),
                    disabled: !snapshot.canEdit,
                    onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                        binding.selection?.choose(
                            Array.from(
                                event.currentTarget.selectedOptions,
                                (option) => option.value
                            ).filter((value) => value !== '')
                        ),
                },
                !state.multiple
                    ? createElement('option', { value: '' }, 'None')
                    : null,
                [...options.values()].map((option) =>
                    createElement(
                        'option',
                        {
                            key: option.value,
                            value: option.value,
                            disabled: option.disabled,
                        },
                        option.label
                    )
                )
            )
        ),
        snapshot.choiceCreation != null
            ? createElement(
                  'div',
                  null,
                  createElement(
                      'label',
                      null,
                      'New choice name',
                      createElement('input', {
                          value: name,
                          disabled: !snapshot.choiceCreation.canCreate,
                          onChange: (event: ChangeEvent<HTMLInputElement>) =>
                              setIntent({
                                  binding,
                                  name: event.currentTarget.value,
                              }),
                      })
                  ),
                  createElement(
                      'button',
                      {
                          type: 'button',
                          disabled:
                              !snapshot.choiceCreation.canCreate ||
                              name.trim() === '',
                          onClick: () => {
                              const captured = name;
                              void binding.choiceCreation
                                  ?.create(captured)
                                  .then((accepted) => {
                                      if (accepted)
                                          setIntent((now) =>
                                              now.binding === binding &&
                                              now.name === captured
                                                  ? { binding, name: '' }
                                                  : now
                                          );
                                  });
                          },
                      },
                      'Create choice'
                  ),
                  createElement(
                      'button',
                      {
                          type: 'button',
                          disabled: !snapshot.choiceCreation.busy,
                          onClick: () => binding.choiceCreation?.cancel(),
                      },
                      'Cancel choice creation'
                  ),
                  createElement(
                      'p',
                      {
                          role: 'status',
                          'aria-busy': snapshot.choiceCreation.busy,
                      },
                      snapshot.choiceCreation.error ??
                          (snapshot.choiceCreation.phase === 'created-selected'
                              ? 'Choice created and selected in the draft. Save to update the record.'
                              : snapshot.choiceCreation.phase ===
                                  'created-not-selected'
                                ? 'Choice created but not currently selectable. The record has not been saved.'
                                : snapshot.choiceCreation.busy
                                  ? 'Creating choice…'
                                  : '')
                  )
              )
            : null,
        status(snapshot)
    );
}
export function LinkedField({ binding, render }: FieldProps): ReactNode {
    const snapshot = useFieldBinding(binding);
    if (render) return render({ snapshot, binding });
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        !snapshot.selection
    )
        return null;
    const state = snapshot.selection;
    const options = new Map(
        [...state.selectedOptions, ...state.options].map((option) => [
            option.value,
            option,
        ])
    );
    return createElement(
        'fieldset',
        { disabled: !snapshot.canEdit },
        createElement('legend', null, snapshot.field?.title),
        createElement(
            'label',
            null,
            'Search linked records',
            createElement('input', {
                value: state.searchTerm,
                onChange: (event: ChangeEvent<HTMLInputElement>) => {
                    if (binding.getSnapshot().canEdit)
                        binding.selection?.setSearchInput(
                            event.currentTarget.value
                        );
                },
            })
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: state.loading,
                onClick: () => {
                    if (binding.getSnapshot().canEdit)
                        void binding.selection?.reload();
                },
            },
            'Search'
        ),
        [...options.values()].map((option) =>
            createElement(
                'label',
                { key: option.value },
                createElement('input', {
                    type: 'checkbox',
                    checked: state.value.includes(option.value),
                    disabled: option.disabled,
                    onChange: () => binding.selection?.toggle(option.value),
                }),
                option.label
            )
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: state.loading || state.offset === null,
                onClick: () => {
                    if (binding.getSnapshot().canEdit)
                        void binding.selection?.loadMore();
                },
            },
            'More'
        ),
        status(snapshot)
    );
}

/** Optional subscription bridge. Mount/StrictMode/remount never reads. */
export function usePortalListOwner(
    owner: import('../portals/listOwner.js').PortalListOwner
): import('../portals/listOwner.js').PortalListSnapshot {
    const store = useMemo(() => {
        let snapshot = owner.getSnapshot();
        return {
            getSnapshot: () => {
                // Observe session/configuration retirement on same-owner rerenders.
                // Cache by revision so useSyncExternalStore retains stable identity.
                const next = owner.getSnapshot();
                if (next.revision !== snapshot.revision) snapshot = next;
                return snapshot;
            },
            subscribe: (notify: () => void) =>
                owner.subscribe((next) => {
                    snapshot = next;
                    notify();
                }),
        };
    }, [owner]);
    return useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
}
export type PortalListProps = {
    owner: import('../portals/listOwner.js').PortalListOwner;
    readOptions: import('../portals/types.js').PortalReadOptions;
    render?(state: {
        snapshot: import('../portals/listOwner.js').PortalListSnapshot;
        owner: import('../portals/listOwner.js').PortalListOwner;
    }): ReactNode;
};
/** Safe default list shell: app renderers own privacy-aware cell presentation, not state. */
export function PortalList({
    owner,
    readOptions,
    render,
}: PortalListProps): ReactNode {
    const snapshot = usePortalListOwner(owner);
    if (render) return render({ snapshot, owner });
    if (snapshot.phase === 'retired') return null;
    return createElement(
        'section',
        { 'aria-label': 'Portal records' },
        createElement(
            'p',
            { role: 'status', 'aria-busy': snapshot.pending },
            snapshot.error ??
                (snapshot.phase === 'empty'
                    ? 'No records returned.'
                    : snapshot.phase === 'cleanup'
                      ? 'The server proposed criteria cleanup. Inspect replacements before acceptance.'
                      : snapshot.pending
                        ? 'Loading records…'
                        : '')
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: snapshot.pending || snapshot.phase === 'cleanup',
                onClick: () => {
                    void owner.readFirst(snapshot.revision, readOptions);
                },
            },
            'Load records'
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: snapshot.pending || !snapshot.hasNext,
                onClick: () => {
                    void owner.readNext(snapshot.revision, readOptions);
                },
            },
            'Next page'
        ),
        createElement(
            'button',
            {
                type: 'button',
                disabled: !snapshot.pending,
                onClick: () => owner.cancel(snapshot.revision),
            },
            'Cancel read'
        ),
        createElement(
            'ol',
            null,
            ...(snapshot.page?.recordIds ?? []).map((id, index) =>
                createElement('li', { key: id }, `Record ${index + 1}`)
            )
        )
    );
}

/** Calendar-only date or explicit-offset dateTime; no browser local-time conversion. */
export type DateFieldProps = FieldProps & DateFieldOptions;
export type DateTimeFieldProps = FieldProps & DateTimeFieldOptions;
export function DateField({
    binding,
    render,
    className,
    clearLabel,
}: DateFieldProps): ReactNode {
    useFieldBinding(binding);
    // Date context can change independently of a native write; observe it on rerender.
    const snapshot = binding.getSnapshot();
    if (render) return render({ snapshot, binding });
    if (
        snapshot.retired ||
        snapshot.visibility.type !== 'visible' ||
        snapshot.date == null
    )
        return null;
    if (snapshot.date.kind === 'date') {
        if (snapshot.date.retired) return null;
        const config = dateConfiguration(snapshot.field?.schema.miniExtConfig);
        return createElement(DateControl, {
            ...config,
            className,
            clearLabel,
            title: snapshot.field?.title.trim()
                ? snapshot.field.title
                : (snapshot.field?.schema.airtableField.name ?? ''),
            input: snapshot.date.input,
            disabled:
                config.configuredReadOnly ||
                !snapshot.canEdit ||
                !snapshot.date.canEdit ||
                snapshot.pending,
            pending: snapshot.pending,
            invalid:
                !snapshot.date.valid ||
                snapshot.error !== null ||
                snapshot.validation.length > 0,
            feedback:
                snapshot.date.error ??
                snapshot.error ??
                snapshot.validation
                    .map((error) => error.errorMessage)
                    .join('\n'),
            setInput: (value) => binding.date?.setInput(value),
            clear: () => binding.date?.clear(),
        });
    }
    if (snapshot.date.retired)
        return createElement(
            'p',
            { role: 'status' },
            'Load a fresh Form before editing this date.'
        );
    const config = dateTimeConfiguration(snapshot.field?.schema.miniExtConfig);
    return createElement(DateTimeControl, {
        ...config,
        className,
        clearLabel,
        title: snapshot.field?.title.trim()
            ? snapshot.field.title
            : (snapshot.field?.schema.airtableField.name ?? ''),
        input: snapshot.date.input,
        disabled:
            config.configuredReadOnly ||
            !snapshot.canEdit ||
            !snapshot.date.canEdit ||
            snapshot.pending,
        pending: snapshot.pending,
        invalid:
            !snapshot.date.valid ||
            snapshot.error !== null ||
            snapshot.validation.length > 0,
        feedback:
            snapshot.date.error ??
            snapshot.error ??
            snapshot.validation.map((error) => error.errorMessage).join('\n'),
        setInput: (value) => binding.date?.setInput(value),
        clear: () => binding.date?.clear(),
    });
}
/** Same owner/model authority; stock rendering accepts an explicit offset, not a naive local timestamp. */
export const DateTimeField = DateField;

import type {
    PortalSortEditorModel,
    PortalSortEditorSnapshot,
    PortalFilterEditorModel,
    PortalFilterEditorSnapshot,
} from '../portals/editors.js';
/** Unmount only removes a subscription; the accepted Portal owner retains prepared state. */
export function PortalSortEditor({
    model,
    render,
}: {
    model: PortalSortEditorModel;
    render(state: {
        snapshot: PortalSortEditorSnapshot;
        model: PortalSortEditorModel;
    }): ReactNode;
}): ReactNode {
    const store = useMemo(() => {
        let value = model.getSnapshot();
        return {
            getSnapshot: () => value,
            subscribe: (notify: () => void) => {
                const stop = model.subscribe((next) => {
                    value = next;
                    notify();
                });
                // A child layout effect may have changed the model after render.
                // Refresh once on subscription; getSnapshot remains reference-stable.
                value = model.getSnapshot();
                notify();
                return stop;
            },
        };
    }, [model]);
    const snapshot = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    return render({ snapshot, model });
}
/** Custom markup uses the same explicit replacement/Apply/Clear actions as stock DOM. */
export function PortalFilterEditor({
    model,
    render,
}: {
    model: PortalFilterEditorModel;
    render(state: {
        snapshot: PortalFilterEditorSnapshot;
        model: PortalFilterEditorModel;
    }): ReactNode;
}): ReactNode {
    const store = useMemo(() => {
        let value = model.getSnapshot();
        return {
            getSnapshot: () => value,
            subscribe: (notify: () => void) => {
                const stop = model.subscribe((next) => {
                    value = next;
                    notify();
                });
                // A child layout effect may have changed the model after render.
                // Refresh once on subscription; getSnapshot remains reference-stable.
                value = model.getSnapshot();
                notify();
                return stop;
            },
        };
    }, [model]);
    const snapshot = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    return render({ snapshot, model });
}

/** Optional React subscription; the host owns model disposal, not a renderer remount. */
export function useButtonField(
    model: import('../ui/buttonModel.js').ButtonFieldModel
): import('../ui/buttonModel.js').ButtonFieldRenderProps {
    const store = useMemo(() => {
        let snapshot = model.getSnapshot();
        let key = JSON.stringify(snapshot);
        return {
            getSnapshot: () => {
                const next = model.getSnapshot();
                const nextKey = JSON.stringify(next);
                if (nextKey !== key) {
                    snapshot = next;
                    key = nextKey;
                }
                return snapshot;
            },
            subscribe: (notify: () => void) => {
                const stop = model.subscribe((next) => {
                    snapshot = next;
                    key = JSON.stringify(next);
                    notify();
                });
                const next = model.getSnapshot();
                if (JSON.stringify(next) !== key) {
                    snapshot = next;
                    key = JSON.stringify(next);
                    notify();
                }
                return stop;
            },
        };
    }, [model]);
    const snapshot = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    return useMemo(
        () => ({
            ...snapshot,
            prepareLink: () => model.prepareLink(snapshot.revision),
            triggerWebhook: () => model.triggerWebhook(snapshot.revision),
            cancel: () => model.cancel(snapshot.revision),
            acknowledgeNewIntent: () =>
                model.acknowledgeNewIntent(snapshot.revision),
        }),
        [model, snapshot]
    );
}

export type FieldRendererFallback =
    | Exclude<
          import('../ui/rendererRegistry.js').FieldRendererHostSnapshot,
          { status: 'ready' }
      >
    | {
          status: 'missing-renderer';
          physicalKind: import('../ui/rendererRegistry.js').FieldKind;
      };
export type FieldRendererProps = {
    host: import('../ui/rendererRegistry.js').FieldRendererHost;
    renderers: import('../ui/rendererRegistry.js').FieldRendererSlots<ReactNode>;
    fallback?(state: FieldRendererFallback): ReactNode;
};

/** Subscription only: the supplied owner retains drafts, input buffers, Files and uncertainty. */
export function useFieldRendererHost(
    host: import('../ui/rendererRegistry.js').FieldRendererHost
): import('../ui/rendererRegistry.js').FieldRendererHostSnapshot {
    const store = useMemo(() => {
        let value = host.getSnapshot();
        let key = JSON.stringify(value);
        const read = () => {
            const next = host.getSnapshot();
            const nextKey = JSON.stringify(next);
            if (nextKey !== key) {
                value = next;
                key = nextKey;
            }
            return value;
        };
        return {
            getSnapshot: read,
            subscribe: (notify: () => void) => {
                const stop = host.subscribe(() => {
                    const before = value;
                    read();
                    if (value !== before) notify();
                });
                const before = value;
                read();
                if (value !== before) notify();
                return stop;
            },
        };
    }, [host]);
    return useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
}

/** Named per-kind slots; no default markup, owner disposal, or automatic I/O. */
export function FieldRenderer({
    host,
    renderers,
    fallback,
}: FieldRendererProps): ReactNode {
    const snapshot = useFieldRendererHost(host);
    if (snapshot.status !== 'ready') return fallback?.(snapshot) ?? null;
    return createElement(
        FieldRendererSource.Provider,
        { value: host },
        ...snapshot.fields.map((field) =>
            createElement(
                Fragment,
                { key: field.fieldId },
                dispatchField(
                    renderers,
                    field,
                    (missing) =>
                        fallback?.({
                            status: 'missing-renderer',
                            physicalKind: missing.physicalKind,
                        }) ?? null
                )
            )
        )
    );
}

export type AirtableFormRenderState = Omit<FormRenderSnapshot, 'fields'> & {
    fields: readonly { fieldId: string; node: ReactNode }[];
};
export type AirtableFormProps = {
    scope: FormRenderScope;
    renderers: import('../ui/rendererRegistry.js').FieldRendererSlots<ReactNode>;
    fallback?(state: FieldRendererFallback): ReactNode;
    /** Layout only; actions retain the revision that produced this render. */
    children(state: AirtableFormRenderState): ReactNode;
};

/** A subscription shell: unmount never disposes the supplied rendering scope. */
export function AirtableForm({
    scope,
    renderers,
    fallback,
    children,
}: AirtableFormProps): ReactNode {
    const store = useMemo(() => {
        let value = scope.getSnapshot();
        const read = () => {
            const next = scope.getSnapshot();
            if (next.revision !== value.revision) value = next;
            return value;
        };
        return {
            getSnapshot: read,
            subscribe: (notify: () => void) => {
                const refresh = () => {
                    const before = value;
                    read();
                    if (value !== before) notify();
                };
                const stop = scope.subscribe(refresh);
                refresh();
                return stop;
            },
        };
    }, [scope]);
    const state = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    if (state.retired) return null;
    return children({
        ...state,
        fields: state.fields.map(({ fieldId, host }) => ({
            fieldId,
            node: createElement(FieldRenderer, {
                key: fieldId,
                host,
                renderers,
                fallback: (failure) =>
                    failure.status === 'hidden' || failure.status === 'retired'
                        ? null
                        : (fallback?.(failure) ?? null),
            }),
        })),
    });
}

export type AirtablePortalRenderState = Omit<PortalRenderSnapshot, 'rows'> & {
    rows: readonly {
        recordId: string;
        cells: readonly { fieldId: string; node: ReactNode }[];
    }[];
};
export type AirtableGridProps = {
    scope: PortalRenderScope;
    renderers: import('../ui/rendererRegistry.js').FieldRendererSlots<ReactNode>;
    fallback?(state: FieldRendererFallback): ReactNode;
    /** App-owned layout; every action retains this accepted render's revision. */
    children(state: AirtablePortalRenderState): ReactNode;
};
export type AirtableListProps = AirtableGridProps;

function AirtablePortal({
    scope,
    renderers,
    fallback,
    children,
}: AirtableGridProps): ReactNode {
    const store = useMemo(() => {
        let value = scope.getSnapshot();
        const read = () => {
            const next = scope.getSnapshot();
            if (next.revision !== value.revision) value = next;
            return value;
        };
        return {
            getSnapshot: read,
            subscribe: (notify: () => void) => {
                const refresh = () => {
                    const before = value;
                    read();
                    if (value !== before) notify();
                };
                const stop = scope.subscribe(refresh);
                refresh();
                return stop;
            },
        };
    }, [scope]);
    const state = useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot
    );
    if (state.retired) return null;
    return children({
        ...state,
        rows: state.rows.map(({ recordId, cells }) => ({
            recordId,
            cells: cells.map(({ fieldId, host }) => ({
                fieldId,
                node: createElement(FieldRenderer, {
                    key: fieldId,
                    host,
                    renderers,
                    fallback: (failure) =>
                        failure.status === 'hidden' ||
                        failure.status === 'retired'
                            ? null
                            : (fallback?.(failure) ?? null),
                }),
            })),
        })),
    });
}

/** Grid layout shell only. Unmount never disposes the supplied scope or owner. */
export function AirtableGrid(props: AirtableGridProps): ReactNode {
    return createElement(AirtablePortal, props);
}

/** List layout shell over the same accepted records, hosts and action authority. */
export function AirtableList(props: AirtableListProps): ReactNode {
    return createElement(AirtablePortal, props);
}

export { ButtonField, renderButtonField } from './ButtonField.js';
export type { ButtonFieldProps, ButtonFieldMessages } from './ButtonField.js';
