import {
    createElement as h,
    Fragment,
    forwardRef,
    useEffect,
    useImperativeHandle,
    useRef,
    useState,
    type CSSProperties,
    type ComponentProps,
} from 'react';
import * as React from 'react';
import { createAddressRuntime } from '../../vendor/headlessui-address/sdk-runtime.js';
const { Combobox, Transition } = createAddressRuntime(React);
import { TextInput } from './TextInput.js';
import { ActionButton } from './ActionButton.js';
import { resolveCurrentClearableInputMobile } from './CompleteClearableTextInput.js';
import { googleMapsAttributionLogo } from '../ui/addressAutocomplete.js';
import {
    useAddressAutocomplete,
    type AddressAutocompleteLifecycleProps,
} from './useAddressAutocomplete.js';
import type { AddressPrediction } from '../runtime/types.js';

export type AddressAutocompleteLabels = Readonly<{
    clear: string;
    loadingPredictions: string;
    loadingDetails: string;
    failed: string;
    retry: string;
}>;

export type CompleteAddressAutocompleteProps =
    AddressAutocompleteLifecycleProps &
        Omit<
            ComponentProps<'input'>,
            'value' | 'defaultValue' | 'onChange' | 'children' | 'autoComplete'
        > & {
            labels: AddressAutocompleteLabels;
            /** Supply the same resolved snapshot during server render/hydration. */
            initialMobile?: boolean;
            /** Optional scoped accent tokens; no application stylesheet is required. */
            theme?: Readonly<{
                activeBackground?: string;
                activeText?: string;
            }>;
        };

type CustomInputProps = Omit<
    ComponentProps<'input'>,
    'value' | 'defaultValue' | 'children'
> & {
    displayText: string;
    clearLabel: string;
    mobile: boolean;
    inputId?: string;
    inputDisabled?: boolean;
    onClear(): void;
};

const CustomInput = forwardRef<HTMLInputElement, CustomInputProps>(
    function AddressInput(
        {
            displayText,
            clearLabel,
            mobile,
            inputId,
            inputDisabled,
            onClear,
            onChange,
            ...native
        },
        ref
    ) {
        const input = useRef<HTMLInputElement | null>(null);
        const [hasValue, setHasValue] = useState(displayText.length > 0);
        useImperativeHandle(ref, () => input.current!, []);
        useEffect(() => {
            setHasValue((input.current?.value ?? displayText).length > 0);
        }, [displayText]);
        return h(
            'div',
            {
                className: 'mx-sdk-address-input-wrapper',
                'data-mobile': mobile,
            },
            h(TextInput, {
                ...native,
                ref: input,
                id: inputId ?? native.id,
                disabled: inputDisabled,
                value: displayText,
                onChange: (event) => {
                    setHasValue(event.currentTarget.value.length > 0);
                    onChange?.(event);
                },
            }),
            mobile && hasValue
                ? h(
                      ActionButton,
                      {
                          className: 'mx-sdk-address-clear',
                          'aria-label': clearLabel,
                          disabled: inputDisabled || native.readOnly,
                          onClick: () => {
                              if (input.current) input.current.value = '';
                              setHasValue(false);
                              onClear();
                              input.current?.focus();
                          },
                      },
                      h(
                          'svg',
                          {
                              viewBox: '0 0 24 24',
                              fill: 'currentColor',
                              'aria-hidden': true,
                          },
                          h('path', {
                              d: 'M6.22 5.16a.75.75 0 0 0-1.06 1.06L10.94 12l-5.78 5.78a.75.75 0 1 0 1.06 1.06L12 13.06l5.78 5.78a.75.75 0 1 0 1.06-1.06L13.06 12l5.78-5.78a.75.75 0 0 0-1.06-1.06L12 10.94 6.22 5.16Z',
                          })
                      )
                  )
                : null
        );
    }
);

/** Complete Google-backed presentation; only supplied authorized reads perform I/O. */
export const CompleteAddressAutocomplete = forwardRef<
    HTMLInputElement,
    CompleteAddressAutocompleteProps
>(function CompleteAddressAutocomplete(props, ref) {
    const {
        identity,
        reads,
        value,
        onChange,
        maxLength,
        labels,
        initialMobile,
        theme,
        className,
        style,
        ...native
    } = props;
    const lifecycle = useAddressAutocomplete({
        identity,
        reads,
        value,
        onChange,
        maxLength,
        disabled: native.disabled,
        readOnly: native.readOnly,
    });
    const { state } = lifecycle;
    const [mobile] = useState(
        () => initialMobile ?? resolveCurrentClearableInputMobile()
    );
    const selected =
        state.selectedPlaceId == null
            ? null
            : { placeId: state.selectedPlaceId, description: value ?? '' };
    const failed =
        state.phase === 'failed-predictions' ||
        state.phase === 'failed-details';
    const tokens: CSSProperties & Record<string, string | undefined> = {
        '--mx-sdk-address-active-background': theme?.activeBackground,
        '--mx-sdk-address-active-text': theme?.activeText,
    };
    return h(
        'div',
        { className: 'mx-sdk-address', style: tokens },
        h<{
            nullable: true;
            multiple: false;
            disabled?: boolean;
            value: AddressPrediction | null;
            by(
                left: AddressPrediction | null,
                right: AddressPrediction | null
            ): boolean;
            onChange(prediction: AddressPrediction | null): void;
            children: React.ReactNode;
        }>(Combobox, {
            nullable: true,
            multiple: false,
            disabled: native.disabled || native.readOnly,
            value: selected,
            by: (left, right) => left?.placeId === right?.placeId,
            onChange: lifecycle.select,
            children: h(
                Fragment,
                null,
                h(Combobox.Input<typeof CustomInput>, {
                    ...native,
                    ref,
                    as: CustomInput,
                    inputId: native.id,
                    inputDisabled: native.disabled,
                    displayText: value ?? '',
                    displayValue: () => value ?? '',
                    onChange: (event) => lifecycle.change(event.target.value),
                    onClear: () => lifecycle.change(''),
                    autoComplete: 'off',
                    clearLabel: labels.clear,
                    mobile,
                    className: ['mx-sdk-address-input', className]
                        .filter(Boolean)
                        .join(' '),
                    style,
                    maxLength,
                }),
                state.phase === 'loading-predictions' ||
                    (state.phase === 'predictions' &&
                        state.predictions.length !== 0)
                    ? h(
                          Transition,
                          {
                              as: Fragment,
                              leave: 'mx-sdk-address-leave',
                              leaveFrom: 'mx-sdk-address-visible',
                              leaveTo: 'mx-sdk-address-hidden',
                          },
                          h(
                              Combobox.Options,
                              { className: 'mx-sdk-address-options' },
                              state.phase === 'loading-predictions'
                                  ? h(
                                        'li',
                                        {
                                            className: 'mx-sdk-address-loading',
                                            role: 'status',
                                        },
                                        h('span', {
                                            className: 'mx-sdk-address-spinner',
                                            'aria-hidden': true,
                                        }),
                                        h(
                                            'span',
                                            {
                                                className:
                                                    'mx-sdk-address-sr-only',
                                            },
                                            labels.loadingPredictions
                                        )
                                    )
                                  : h(
                                        Fragment,
                                        null,
                                        ...state.predictions.map((prediction) =>
                                            h(
                                                Combobox.Option<
                                                    'li',
                                                    AddressPrediction
                                                >,
                                                {
                                                    key: prediction.placeId,
                                                    value: prediction,
                                                    className: ({ active }) =>
                                                        `mx-sdk-address-option${active ? ' mx-sdk-address-option-active' : ''}`,
                                                    children:
                                                        prediction.description,
                                                }
                                            )
                                        ),
                                        h(
                                            'li',
                                            {
                                                role: 'presentation',
                                                className:
                                                    'mx-sdk-address-attribution',
                                            },
                                            h('img', {
                                                src: googleMapsAttributionLogo,
                                                alt: 'Google Maps',
                                                width: 98,
                                                height: 18,
                                            })
                                        )
                                    )
                          )
                      )
                    : null,
                state.phase === 'loading-details'
                    ? h(
                          'span',
                          {
                              className: 'mx-sdk-address-sr-only',
                              role: 'status',
                          },
                          labels.loadingDetails
                      )
                    : null,
                failed
                    ? h(
                          'div',
                          { className: 'mx-sdk-address-error' },
                          h('p', { role: 'alert' }, labels.failed),
                          h(
                              ActionButton,
                              {
                                  className: 'mx-sdk-address-retry',
                                  onClick: lifecycle.retry,
                              },
                              labels.retry
                          )
                      )
                    : null
            ),
        })
    );
});
