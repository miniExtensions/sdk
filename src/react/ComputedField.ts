import { createElement, type ReactNode } from 'react';
import { ControlledLookupField } from './ControlledLookupField.js';
import type { ControlledFormulaFieldProps } from './FormulaField.js';
import type { ControlledRollupFieldProps } from './RollupField.js';
import type {
    ControlledLookupFieldProps,
    LookupPresentationState,
} from './lookupFieldTypes.js';
import { isLookupResultPresentation } from './lookupPresentationValidation.js';

type AssociationKey = 'inputId' | 'formId' | 'labelledBy' | 'describedBy';
type WithoutAssociation<T> = T extends unknown
    ? Omit<T, AssociationKey> & { readonly [K in AssociationKey]?: never }
    : never;

/** The outer computed frame owns IDs; Select retains its generated control ID. */
export type ComputedFormulaDisplay =
    WithoutAssociation<ControlledFormulaFieldProps>;
export type ComputedFieldProps = Omit<
    ControlledLookupFieldProps,
    'mode' | 'state'
> & {
    readonly masked?: boolean;
} & (
        | {
              readonly kind: 'lookup';
              readonly state: LookupPresentationState;
              readonly display?: never;
          }
        | {
              readonly kind: 'formula';
              readonly display: ComputedFormulaDisplay;
              readonly state?: never;
          }
        | {
              readonly kind: 'rollup';
              readonly display: ControlledRollupFieldProps;
              readonly state?: never;
          }
        | {
              readonly kind: 'formula' | 'rollup';
              /** Unavailable/masked host admission never fabricates a display. */
              readonly state: Exclude<
                  LookupPresentationState,
                  { readonly status: 'ready' }
              >;
              readonly display?: never;
          }
    );

function hasNestedAssociation(display: object): boolean {
    for (const key of ['inputId', 'formId', 'labelledBy', 'describedBy']) {
        const descriptor = Object.getOwnPropertyDescriptor(display, key);
        if (descriptor) {
            if (!('value' in descriptor) || descriptor.value !== undefined)
                return true;
        } else if (key in display) return true;
    }
    return false;
}

function nonreadyState(
    state: LookupPresentationState
): LookupPresentationState {
    return state.status === 'ready' ? { status: 'unavailable' } : state;
}

/**
 * One controlled computed frame, backed by the existing complete rich leaves
 * and their committed presentation/resource lifetime. No field binding exists.
 */
export function ComputedField(props: ComputedFieldProps): ReactNode {
    try {
        const masked = props.masked;
        if (
            masked === true ||
            (masked !== undefined && typeof masked !== 'boolean')
        )
            return null;
        const kind = props.kind;
        const frameKey =
            kind === 'lookup' || kind === 'formula' || kind === 'rollup'
                ? kind
                : 'invalid';
        const owner = props.owner;
        if (!owner || typeof owner.isCurrent !== 'function') return null;
        const common = {
            mode: 'controlled' as const,
            owner,
            identity: props.identity,
            language: props.language,
            title: props.title,
            showTitle: props.showTitle,
            inputId: props.inputId,
            labelledBy: props.labelledBy,
            describedBy: props.describedBy,
            pending: props.pending,
            error: props.error,
            validation: props.validation,
            className: ['mx-sdk-computed-field', props.className]
                .filter(Boolean)
                .join(' '),
            labels: props.labels,
        };
        let state: LookupPresentationState;
        try {
            if (!owner.isCurrent()) state = { status: 'unavailable' };
            else {
                switch (kind) {
                    case 'lookup':
                        state = props.state;
                        break;
                    case 'formula': {
                        if (props.state !== undefined) {
                            state = nonreadyState(props.state);
                            break;
                        }
                        const display = props.display;
                        if (!display || hasNestedAssociation(display)) {
                            state = { status: 'unavailable' };
                            break;
                        }
                        const isValid = display.isValid;
                        if (
                            display.mode !== 'controlled' ||
                            typeof isValid !== 'boolean'
                        ) {
                            state = { status: 'unavailable' };
                            break;
                        }
                        // Invalid metadata and masking precede value, rich-mode
                        // and resource getters, including DTO validation.
                        const admitted: ControlledFormulaFieldProps =
                            isValid === false
                                ? {
                                      mode: 'controlled',
                                      isValid: false,
                                      language: display.language,
                                  }
                                : display.obscurePassword === true
                                  ? {
                                        mode: 'controlled',
                                        isValid: true,
                                        language: display.language,
                                        resultType: 'singleLineText',
                                        value: null,
                                        formattedValue: null,
                                        obscurePassword: true,
                                        textSize: display.textSize,
                                        layout: display.layout,
                                    }
                                  : display;
                        state = {
                            status: 'ready',
                            result: { kind: 'formula', display: admitted },
                        };
                        break;
                    }
                    case 'rollup':
                        state =
                            props.state !== undefined
                                ? nonreadyState(props.state)
                                : {
                                      status: 'ready',
                                      result: {
                                          kind: 'rollup',
                                          display: props.display,
                                      },
                                  };
                        break;
                    default:
                        state = { status: 'unavailable' };
                }
            }
            if (
                state.status === 'ready' &&
                !isLookupResultPresentation(state.result)
            )
                state = { status: 'unavailable' };
        } catch {
            state = { status: 'unavailable' };
        }
        return createElement(ControlledLookupField, {
            ...common,
            frameRole: 'group',
            key: frameKey,
            state,
        });
    } catch {
        return null;
    }
}
