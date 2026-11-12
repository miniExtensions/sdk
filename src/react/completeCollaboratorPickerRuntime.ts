import {
    Combobox,
    ComboboxButton,
    ComboboxInput,
    ComboboxOption,
    ComboboxOptions,
} from '@headlessui/react';
import {
    createElement as h,
    forwardRef,
    useRef,
    type ButtonHTMLAttributes,
    type ChangeEvent,
    type MouseEvent,
    type Ref,
    type ReactNode,
} from 'react';
import {
    CollaboratorAvatar,
    type CompleteCollaborator,
    type CompleteCollaboratorLabels,
    type CollaboratorAvatarPolicy,
} from './CompleteCollaboratorField.js';
import { TextInput, type TextInputProps } from './TextInput.js';
import { removeCollaboratorSelection } from '../ui/collaboratorSelection.js';

export type CollaboratorPickerProps<T extends CompleteCollaborator> = {
    value: readonly T[];
    choices: readonly T[];
    query: string;
    onChange(value: T[]): void;
    onQueryChange(query: string): void;
    onInputFocus(): void;
    onClose(): void;
    inputRef: Ref<HTMLInputElement>;
    inputId: string;
    formId?: string;
    ariaLabel?: string;
    labelledBy?: string;
    describedBy?: string;
    invalid?: boolean;
    disabled?: boolean;
    labels?: CompleteCollaboratorLabels;
    avatarPolicy?: CollaboratorAvatarPolicy;
};

// Headless UI owns its generated label attribute; retain an enclosing native
// label association at the final SDK input without a caller JSX renderer.
const CollaboratorInput = forwardRef<
    HTMLInputElement,
    TextInputProps & {
        labelledBy?: string;
        fieldDescribedBy?: string;
        fieldInvalid?: boolean;
    }
>(function CollaboratorInput(
    { labelledBy, fieldDescribedBy, fieldInvalid, ...input },
    ref
) {
    return h(TextInput, {
        ...input,
        ref,
        'aria-labelledby': labelledBy ?? input['aria-labelledby'],
        'aria-describedby': fieldDescribedBy ?? input['aria-describedby'],
        'aria-invalid': fieldInvalid ?? input['aria-invalid'],
    });
});

// Keep native click activation for the public toggle. Headless UI 2 normally
// toggles on mouse pointerdown and remembers that pointer type, so relaying an
// input click to its button would stop working after the arrow was used once.
// The SDK owns this native-button adaptation; keyboard/click, disabled, focus
// and accessibility props still come from the actual public ComboboxButton.
const CollaboratorToggle = forwardRef<
    HTMLButtonElement,
    ButtonHTMLAttributes<HTMLButtonElement>
>(function CollaboratorToggle({ onPointerDown, ...button }, ref) {
    void onPointerDown;
    return h('button', { ...button, ref });
});

/** Actual SDK-owned Headless picker; evaluated only after a client commit. */
export function CollaboratorPicker<T extends CompleteCollaborator>(
    props: CollaboratorPickerProps<T>
): ReactNode {
    const button = useRef<HTMLButtonElement>(null);
    return h(
        Combobox<T[], true>,
        {
            value: [...props.value],
            onChange: props.onChange,
            multiple: true,
            by: 'id',
            disabled: props.disabled,
            invalid: props.invalid,
            onClose: props.onClose,
        },
        h(
            'div',
            { className: 'mx-sdk-collaborator-picker' },
            h(ComboboxInput<string, typeof CollaboratorInput>, {
                as: CollaboratorInput,
                ref: props.inputRef,
                id: props.inputId,
                form: props.formId,
                value: props.query,
                onChange: (event: ChangeEvent<HTMLInputElement>) =>
                    props.onQueryChange(event.target.value),
                onFocus: props.onInputFocus,
                onClick: () => button.current?.click(),
                placeholder: props.labels?.placeholder ?? 'Select',
                autoComplete: 'off',
                'aria-label': props.ariaLabel,
                labelledBy: props.labelledBy,
                fieldDescribedBy: props.describedBy,
                fieldInvalid: props.invalid,
            }),
            h(
                ComboboxButton<typeof CollaboratorToggle>,
                {
                    as: CollaboratorToggle,
                    ref: button,
                    type: 'button',
                    form: props.formId,
                    'aria-label': props.labels?.open ?? 'Open combobox',
                    className: 'mx-sdk-collaborator-open',
                },
                h(
                    'svg',
                    {
                        viewBox: '0 0 20 20',
                        width: 20,
                        height: 20,
                        'aria-hidden': true,
                        fill: 'none',
                        stroke: 'currentColor',
                    },
                    h('path', { d: 'm6 8 4 4 4-4' })
                )
            ),
            h(
                ComboboxOptions,
                { className: 'mx-sdk-collaborator-options', modal: false },
                h(
                    'div',
                    { className: 'mx-sdk-collaborator-options-label' },
                    props.choices.length
                        ? (props.labels?.availableOptions ??
                              'Available options')
                        : (props.labels?.noMatches ?? 'No matching options')
                ),
                ...props.choices.map((collaborator, index) =>
                    h(
                        ComboboxOption<'div', T>,
                        {
                            as: 'div',
                            key: `${collaborator.id}-${index}`,
                            value: collaborator,
                            className: 'mx-sdk-collaborator-option',
                            // The controlled field owns accepted/refused focus.
                            // Headless UI's pointer handler queues an unfenced
                            // refocus that can close a subsequently opened field.
                            onMouseDown: (event: MouseEvent) => {
                                event.preventDefault();
                                if (event.button !== 0 || props.disabled)
                                    return;
                                props.onChange(
                                    props.value.some(
                                        (value) => value.id === collaborator.id
                                    )
                                        ? removeCollaboratorSelection(
                                              props.value,
                                              collaborator.id
                                          )
                                        : [...props.value, collaborator]
                                );
                            },
                        },
                        h(CollaboratorAvatar, {
                            profilePicUrl: collaborator.profilePicUrl,
                            avatarPolicy: props.avatarPolicy,
                        }),
                        h(
                            'span',
                            { className: 'mx-sdk-collaborator-option-text' },
                            h('span', null, collaborator.name),
                            h('span', null, collaborator.email)
                        ),
                        props.value.some(
                            (value) => value.id === collaborator.id
                        )
                            ? h('span', { 'aria-hidden': true }, '✓')
                            : null
                    )
                )
            )
        )
    );
}
