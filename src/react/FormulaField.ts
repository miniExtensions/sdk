import {
    createElement,
    useId,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import { getReadableStringFromAirtableValue } from '../formulas/valueConversion.js';
import {
    createRendererProps,
    type FieldRendererProps,
} from '../ui/rendererRegistry.js';
import { textConfiguration } from './TextField.js';
import { SingleSelectField } from './index.js';
import type { ControlledSingleSelectFieldProps } from './ControlledSelectField.js';
import { CompleteHTMLRenderer } from './html/CompleteHTMLRenderer.js';
import { SingleLineTextField } from './SingleLineTextField.js';
import {
    CompleteReadOnlyTextField,
    type CompleteReadOnlyTextFieldProps,
} from './CompleteReadOnlyTextField.js';
import {
    GridFormulaAttachmentNames,
    ReadOnlyURLGallery,
    type ReadOnlyURLGalleryProps,
} from './ReadOnlyURLGallery.js';
import type { ReadonlyResourceOwner } from './readonlyResourceOwner.js';

/** Accepted native result/configuration facts. This contract grants no writes,
 * computes no formula, and never accepts a UI renderer or fabricated binding. */
export type ControlledFormulaFieldProps = Pick<
    CompleteReadOnlyTextFieldProps,
    'language' | 'textSize' | 'layout' | 'className'
> & {
    mode: 'controlled';
    binding?: never;
    render?: never;
    inputId?: string;
    formId?: string;
    ariaLabel?: string;
    labelledBy?: string;
    describedBy?: string;
    obscurePassword?: boolean;
    renderFormulaAsHTML?: boolean;
    heightForFormulaFieldHTML?: number | string | null;
    renderFormulaAsAttachment?: boolean;
    displayAsButton?: boolean;
    validUrlButtonLabel?: string | null;
    invalidUrlButtonLabel?: string | null;
    buttonLabels?: { openLink?: string; invalidLink?: string };
    /** Display-only Select facts; the Formula always supplies a readonly owner. */
    select?: Pick<
        ControlledSingleSelectFieldProps,
        'choices' | 'labels' | 'isInGrid'
    >;
    /** Ordered entries admitted by the host's existing HTTP(S) extractor. */
    gallery?: ReadOnlyURLGalleryProps;
    /** Captured native lifetime; formula metadata and URLs grant no authority. */
    resource?: { owner?: ReadonlyResourceOwner; identity?: unknown };
} & (
        | {
              isValid: false;
              value?: never;
              formattedValue?: never;
              resultType?: never;
          }
        | {
              isValid: true;
              resultType: string;
              value: unknown;
              /** Existing localized/error/special-value conversion, not raw markup. */
              formattedValue: string | null | undefined;
              /** Failed conversion is a fact, not permission to preempt rich modes. */
              formattingFailed?: boolean;
          }
    );

const readonlySelectOwner = { isCurrent: () => false, token: {} };
const noFormulaWrite = () => false;
const invalidFormula =
    'This field has an invalid value. Check the field in Airtable.';
const unexpectedFormula =
    'This field contains an unexpected value. Try refreshing the airtable base';

function formulaError(message: string): ReactNode {
    return createElement(
        'div',
        { role: 'alert', className: 'mx-sdk-formula-error' },
        createElement('p', { 'aria-label': 'error-message' }, message)
    );
}

/** Complete readonly result presentation, with legacy conflict precedence. */
export function ControlledFormulaField(
    props: ControlledFormulaFieldProps
): ReactNode {
    let content: ReactNode;
    if (!props.isValid) content = formulaError(invalidFormula);
    else if (props.obscurePassword)
        content = createElement(CompleteReadOnlyTextField, {
            value: '••••••••',
            language: props.language,
            textSize: props.textSize,
            layout: props.layout,
        });
    else if (props.resultType === 'singleSelect') {
        content =
            props.value != null && typeof props.value !== 'string'
                ? formulaError(unexpectedFormula)
                : props.value == null || props.value === ''
                  ? createElement(CompleteReadOnlyTextField, {
                        value: null,
                        language: props.language,
                    })
                  : createElement(SingleSelectField, {
                        choices: props.select?.choices ?? [],
                        availableChoices: props.select?.choices ?? [],
                        labels: props.select?.labels,
                        isInGrid: props.select?.isInGrid,
                        inputId: props.inputId,
                        formId: props.formId,
                        ariaLabel: props.ariaLabel,
                        describedBy: props.describedBy,
                        presentation: 'dropdown',
                        value: props.value as string | null,
                        readOnly: true,
                        owner: readonlySelectOwner,
                        onValueChange: noFormulaWrite,
                    });
    } else if (props.renderFormulaAsHTML) {
        content =
            typeof props.value !== 'string'
                ? formulaError(unexpectedFormula)
                : createElement(CompleteHTMLRenderer, {
                      html: props.value,
                      style: {
                          height: props.heightForFormulaFieldHTML ?? undefined,
                      },
                  });
    } else if (props.renderFormulaAsAttachment) {
        content =
            typeof props.value !== 'string'
                ? formulaError(unexpectedFormula)
                : createElement(
                      GridFormulaAttachmentNames.Provider,
                      { value: props.gallery?.isInGrid === true },
                      createElement(ReadOnlyURLGallery, {
                          ...props.gallery,
                          entries: props.gallery?.entries ?? [],
                          owner: props.gallery?.owner ?? props.resource?.owner,
                          identity:
                              props.gallery?.identity ??
                              props.resource?.identity,
                      })
                  );
    } else if (props.displayAsButton) {
        content = createElement(SingleLineTextField, {
            mode: 'readOnly',
            value: typeof props.value === 'string' ? props.value : null,
            language: props.language,
            displayAsButton: true,
            validButtonLabel: props.validUrlButtonLabel,
            invalidButtonLabel: props.invalidUrlButtonLabel,
            resource: { ...props.resource, labels: props.buttonLabels },
        });
    } else if (props.formattingFailed)
        content = formulaError(unexpectedFormula);
    else
        content = createElement(CompleteReadOnlyTextField, {
            value: props.formattedValue,
            language: props.language,
            textSize: props.textSize,
            layout: props.layout,
        });
    return createElement(
        'div',
        {
            id: props.inputId,
            role: 'group',
            'aria-label': props.ariaLabel,
            'aria-labelledby': props.labelledBy,
            'aria-describedby': props.describedBy,
            className: ['mx-sdk-controlled-formula', props.className]
                .filter(Boolean)
                .join(' '),
        },
        content
    );
}

export type FormulaFieldOptions = { className?: string };
type FormulaControlProps = Pick<
    FieldRendererProps<'formula'>,
    | 'field'
    | 'title'
    | 'value'
    | 'displayConfig'
    | 'writeConfig'
    | 'pending'
    | 'error'
    | 'validation'
> &
    FormulaFieldOptions;

/** Use native result formatting only; malformed data never becomes diagnostic text. */
function readableFormula(props: FormulaControlProps): string | null {
    try {
        const accepted = createRendererProps({
            physicalKind: 'formula',
            fieldId: props.field.id,
            title: props.title,
            field: props.field,
            displayConfig: null,
            value: props.value,
            context: 'form',
            computed: true,
            dirty: false,
            pending: false,
            validation: [],
            error: null,
            capability: { type: 'readonly' },
        });
        if (!accepted || accepted.physicalKind !== 'formula') return null;
        const result =
            accepted.presentation.type === 'computed-result'
                ? accepted.presentation.config
                : null;
        if (result === null) {
            return accepted.value !== null &&
                typeof accepted.value === 'object' &&
                'error' in accepted.value
                ? accepted.value.error
                : '';
        }
        // Formula's scalar-array conversion cannot consume array-valued result
        // metadata. Delegate those native arrays to their existing formatter.
        const arrayResult =
            Array.isArray(accepted.value) &&
            [
                'multipleSelects',
                'multipleCollaborators',
                'multipleAttachments',
                'multipleRecordLinks',
                'multipleLookupValues',
            ].includes(result.type);
        return getReadableStringFromAirtableValue({
            value: accepted.value ?? null,
            airtableFieldConfig: arrayResult ? result : accepted.field.config,
            fieldName: accepted.field.name,
            source: {
                type: 'airtableMock',
                linkedTableStates: {},
                dateParsing: 'local',
                doNotReturnRecordIdsForLinkedRecords: true,
                unavailableLinkedRecordPlaceholder: 'Unavailable',
            },
        });
    } catch {
        return null;
    }
}

/** Inert text: no editor, raw HTML, resource loading, or owner action. */
export function FormulaControl(props: FormulaControlProps): ReactNode {
    const id = useId();
    const config = textConfiguration(props.displayConfig, props.writeConfig);
    const title = props.title.trim() ? props.title : props.field.name;
    // Mask before formatting so the readable value is absent from the DOM too.
    const value = config.password ? '••••••••' : readableFormula(props);
    const feedback =
        props.error ??
        props.validation.map((item) => item.errorMessage).join('\n');
    const stop = (event: SyntheticEvent) => event.stopPropagation();
    return createElement(
        'span',
        {
            className: ['mx-sdk-formula-field', props.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
        },
        config.showTitle
            ? createElement('label', { htmlFor: id }, title)
            : null,
        createElement(
            'output',
            {
                id,
                'aria-label': config.showTitle ? undefined : title,
                'aria-busy': props.pending,
                'aria-invalid':
                    props.error !== null ||
                    props.validation.length > 0 ||
                    value === null,
                'aria-describedby': feedback ? `${id}-feedback` : undefined,
                style: {
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                    display: 'block',
                },
            },
            value ?? 'Unavailable'
        ),
        createElement(
            'span',
            { id: `${id}-feedback`, role: 'status', 'aria-live': 'polite' },
            feedback
        )
    );
}

/** Shared Formula slot; supplied capabilities and presentation hints grant no authority. */
export function renderFormulaField(
    props: FieldRendererProps<'formula'>,
    options: FormulaFieldOptions = {}
): ReactNode {
    return createElement(FormulaControl, {
        field: props.field,
        title: props.title,
        value: props.value,
        displayConfig: props.displayConfig,
        writeConfig: props.writeConfig,
        pending: props.pending,
        error: props.error,
        validation: props.validation,
        className: options.className,
    });
}
