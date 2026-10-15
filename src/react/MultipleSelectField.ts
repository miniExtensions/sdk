import {
    createElement as h,
    useId,
    useState,
    type ChangeEvent,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type {
    ChoiceRendererActions,
    FieldRendererProps,
} from '../ui/rendererRegistry.js';
import { getSelectFieldPolicy } from '../ui/selectPolicy.js';

export type MultipleSelectFieldOptions = {
    /** Optional wrapper class; all default styles are component-specific. */
    className?: string;
    /** Defaults to "Clear <field title>". */
    clearLabel?: string;
};

const stop = (event: SyntheticEvent) => event.stopPropagation();

/** Borrowed presentation only: no selection model, filtering, requests or Save. */
function MultipleSelectControl({
    field: props,
    className,
    clearLabel,
}: MultipleSelectFieldOptions & {
    field: FieldRendererProps<'multipleSelects'>;
}): ReactNode {
    const id = useId();
    const [intent, setIntent] = useState<{
        action?: ChoiceRendererActions['create'];
        name: string;
    }>({ name: '' });
    const title = props.title.trim() ? props.title : props.field.name;
    const capability = props.capability;
    const selection =
        capability.type === 'editable' && capability.selection?.state.multiple
            ? capability.selection
            : undefined;
    const state = selection?.state;
    const value = props.value ?? [];
    // Reuse the existing owner's label rules, without applying its filters or limits.
    const labels = new Map(
        getSelectFieldPolicy({
            fieldType: 'multipleSelects',
            airtableField: props.field,
            miniExtConfig: props.displayConfig ?? undefined,
        }).options.map((option) => [option.value, option.label])
    );
    for (const option of state?.selectedOptions ?? [])
        labels.set(option.value, option.label);
    for (const option of state?.options ?? [])
        labels.set(option.value, option.label);
    const readOnly = [props.displayConfig, props.writeConfig].some(
        (config) => config && 'readOnly' in config && config.readOnly === true
    );
    const disabled =
        !selection ||
        readOnly ||
        props.computed ||
        props.pending ||
        state?.disabled === true ||
        state?.readOnly === true;
    const blocked = props.selectAvailability?.status === 'blocked';
    const choice =
        props.context === 'form' && capability.type === 'editable' && selection
            ? capability.choice
            : undefined;
    // Unsubmitted text belongs to the captured creation owner, never its successor.
    const name = intent.action === choice?.create ? intent.name : '';
    const feedback = [
        props.error ?? state?.error,
        ...props.validation.map((message) => message.errorMessage),
        blocked
            ? 'Choices are unavailable. Existing selections can be removed.'
            : '',
        choice?.state.error,
        choice?.state.busy
            ? 'Creating choice…'
            : choice?.state.phase === 'created-selected'
              ? 'Choice created and selected in the draft. Save to update the record.'
              : choice?.state.phase === 'created-not-selected'
                ? 'Choice created but not selected. The record has not been saved.'
                : '',
    ]
        .filter(Boolean)
        .join('\n');
    const showTitle = !(
        props.displayConfig &&
        'showTitle' in props.displayConfig &&
        props.displayConfig.showTitle === false
    );
    return h(
        'fieldset',
        {
            className: ['mx-sdk-multiple-select-field', className]
                .filter(Boolean)
                .join(' '),
            'aria-label': showTitle ? undefined : title,
            'aria-describedby': feedback ? `${id}-feedback` : undefined,
            'aria-invalid': props.error !== null || props.validation.length > 0,
            'aria-busy': props.pending || choice?.state.busy || undefined,
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
        },
        showTitle ? h('legend', null, title) : null,
        h(
            'ul',
            {
                className: 'mx-sdk-multiple-select-values',
                'aria-label': `${title} selected choices`,
            },
            ...value.map((nativeName, index) =>
                h(
                    'li',
                    { key: `${index}:${nativeName}` },
                    h('span', null, labels.get(nativeName) ?? nativeName),
                    h(
                        'button',
                        {
                            type: 'button',
                            disabled,
                            'aria-label': `Remove ${labels.get(nativeName) ?? nativeName}`,
                            onClick: () => {
                                if (!disabled) selection?.toggle(nativeName);
                            },
                        },
                        '×'
                    )
                )
            )
        ),
        value.length === 0
            ? h(
                  'span',
                  { className: 'mx-sdk-multiple-select-empty' },
                  'No selections'
              )
            : null,
        h(
            'div',
            { className: 'mx-sdk-multiple-select-options' },
            ...(state?.options ?? []).map((option, index) => {
                const selected = value.includes(option.value);
                return h(
                    'label',
                    { key: option.value, htmlFor: `${id}-${index}` },
                    h('input', {
                        id: `${id}-${index}`,
                        type: 'checkbox',
                        checked: selected,
                        disabled:
                            disabled ||
                            (!selected &&
                                (blocked || option.disabled === true)),
                        onChange: (event: ChangeEvent<HTMLInputElement>) => {
                            event.stopPropagation();
                            if (
                                !disabled &&
                                (selected || (!blocked && !option.disabled))
                            )
                                selection?.toggle(option.value);
                        },
                    }),
                    h('span', null, option.label)
                );
            })
        ),
        h(
            'button',
            {
                type: 'button',
                className: 'mx-sdk-multiple-select-clear',
                disabled: disabled || value.length === 0,
                'aria-label': clearLabel?.trim()
                    ? clearLabel
                    : `Clear ${title}`,
                onClick: () => {
                    if (!disabled && value.length) selection?.clear();
                },
            },
            'Clear'
        ),
        choice
            ? h(
                  'div',
                  { className: 'mx-sdk-multiple-select-create' },
                  h('label', { htmlFor: `${id}-new` }, 'New choice name'),
                  h('input', {
                      id: `${id}-new`,
                      value: name,
                      disabled: disabled || blocked || !choice.state.canCreate,
                      onChange: (event: ChangeEvent<HTMLInputElement>) => {
                          event.stopPropagation();
                          setIntent({
                              action: choice.create,
                              name: event.currentTarget.value,
                          });
                      },
                      onKeyDown: (
                          event: import('react').KeyboardEvent<HTMLInputElement>
                      ) => {
                          if (event.key === 'Enter') event.preventDefault();
                      },
                  }),
                  h(
                      'button',
                      {
                          type: 'button',
                          disabled:
                              disabled ||
                              blocked ||
                              !choice.state.canCreate ||
                              !name.trim(),
                          onClick: () => {
                              if (
                                  !disabled &&
                                  !blocked &&
                                  choice.state.canCreate &&
                                  name.trim()
                              )
                                  void choice.create(name);
                          },
                      },
                      'Add choice'
                  ),
                  h(
                      'button',
                      {
                          type: 'button',
                          disabled: !choice.state.busy,
                          onClick: () => {
                              if (choice.state.busy) choice.cancel();
                          },
                      },
                      'Cancel choice creation'
                  )
              )
            : null,
        h(
            'span',
            {
                id: `${id}-feedback`,
                className: 'mx-sdk-multiple-select-feedback',
                role: 'status',
                'aria-live': 'polite',
            },
            feedback
        )
    );
}

/** Multiple Select slot for existing Form, Grid and List hosts. */
export function renderMultipleSelectsField(
    props: FieldRendererProps<'multipleSelects'>,
    options: MultipleSelectFieldOptions = {}
): ReactNode {
    return h(MultipleSelectControl, { field: props, ...options });
}
