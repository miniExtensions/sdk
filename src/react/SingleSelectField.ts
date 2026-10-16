import {
    createElement,
    useContext,
    useEffect,
    useId,
    useRef,
    useState,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { RuntimeFieldSchema } from '../runtime/types.js';
import type {
    ChoiceRendererActions,
    FieldRendererProps,
    SelectionRendererActions,
} from '../ui/rendererRegistry.js';
import type { SelectAvailabilitySnapshot } from '../ui/selectAvailability.js';
import { getSelectFieldPolicy } from '../ui/selectPolicy.js';
import type { SelectionOption } from '../ui/types.js';
import { FieldRendererSource } from './fieldRendererSource.js';

export type SingleSelectFieldOptions = {
    /** Applied to the wrapper; the optional stylesheet can be replaced entirely. */
    className?: string;
    /** Accessible Clear label; defaults to "Clear <field title>". */
    clearLabel?: string;
    /** Empty dropdown label; defaults to "None". */
    emptyLabel?: string;
    /** Stable owner identity for transient choice text outside FieldRenderer. */
    source?: object;
};

type SelectConfig = RuntimeFieldSchema['miniExtConfig'] | null;
export function singleSelectConfiguration(
    display: SelectConfig,
    write?: SelectConfig
) {
    const configs = [display, write].filter((config) => config != null);
    return {
        configuredReadOnly: configs.some(
            (config) => 'readOnly' in config && config.readOnly === true
        ),
        password: configs.some(
            (config) =>
                ('obscurePassword' in config &&
                    config.obscurePassword === true) ||
                ('maskPasswordOnLoginScreen' in config &&
                    config.maskPasswordOnLoginScreen === true)
        ),
        showTitle: !(
            display &&
            'showTitle' in display &&
            display.showTitle === false
        ),
        required: configs.some(
            (config) => 'required' in config && config.required === true
        ),
    };
}

/** Full display metadata labels only; limits never remove a loaded native name. */
export function singleSelectDisplayOptions(
    field: FieldRendererProps<'singleSelect'>['field'],
    display: SelectConfig
): readonly SelectionOption[] {
    try {
        return getSelectFieldPolicy({
            fieldType: 'singleSelect',
            airtableField: field,
            ...(display == null ? {} : { miniExtConfig: display }),
        } as RuntimeFieldSchema).options;
    } catch {
        return [];
    }
}

type SingleSelectControlProps = SingleSelectFieldOptions &
    ReturnType<typeof singleSelectConfiguration> & {
        /** Original standalone snapshot, below explicit source and host context. */
        fallbackSource?: object;
        title: string;
        value: string;
        displayOptions: readonly SelectionOption[];
        selection?: SelectionRendererActions;
        choice?: ChoiceRendererActions;
        availability?: SelectAvailabilitySnapshot | null;
        disabled: boolean;
        pending: boolean;
        invalid: boolean;
        feedback: string;
    };
const stop = (event: SyntheticEvent) => event.stopPropagation();

function availabilityMessage(
    availability: SelectAvailabilitySnapshot | null | undefined,
    selection: SelectionRendererActions | undefined
): string {
    if (availability == null) return '';
    if (availability.status === 'blocked')
        return availability.code === 'unsupported-condition' ||
            availability.code === 'invalid-condition'
            ? 'Choices are unavailable for this configuration.'
            : 'Choices are temporarily unavailable.';
    if (selection == null || selection.state.options.length > 0) return '';
    return selection.state.searchTerm.trim()
        ? 'No matching choices.'
        : 'No choices available.';
}

/** Native dropdown presentation borrowing existing owner selection and choice actions. */
export function SingleSelectControl(
    props: SingleSelectControlProps
): ReactNode {
    const id = useId();
    const inherited = useContext(FieldRendererSource);
    const source = props.source ?? inherited ?? props.fallbackSource ?? props;
    const lifetime = useRef({ source, token: {} });
    if (lifetime.current.source !== source)
        lifetime.current = { source, token: {} };
    const token = lifetime.current.token;
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const [intent, setIntent] = useState({ token, name: '' });
    const name = intent.token === token ? intent.name : '';
    const select = useRef<HTMLSelectElement>(null);
    const current = () => mounted.current && lifetime.current.token === token;
    const options = new Map(
        (props.password
            ? []
            : (props.selection?.state.options ?? props.displayOptions)
        ).map((option) => [option.value, option])
    );
    if (!props.password) {
        for (const option of props.selection?.state.selectedOptions ?? [])
            if (!options.has(option.value))
                options.set(option.value, { ...option, disabled: true });
        if (props.value !== '' && !options.has(props.value))
            options.set(props.value, {
                value: props.value,
                label: props.value,
                disabled: true,
            });
    }
    const choice = props.password ? undefined : props.choice;
    const canCreate =
        !props.disabled && choice?.state.canCreate === true && current();
    const feedback = props.password
        ? ''
        : [
              props.feedback,
              availabilityMessage(props.availability, props.selection),
          ]
              .filter(Boolean)
              .join('\n');
    return createElement(
        'span',
        {
            className: ['mx-sdk-single-select-field', props.className]
                .filter(Boolean)
                .join(' '),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
            onCompositionStart: stop,
            onCompositionEnd: stop,
        },
        props.showTitle
            ? createElement(
                  'label',
                  { className: 'mx-sdk-single-select-label', htmlFor: id },
                  props.title
              )
            : null,
        createElement(
            'span',
            { className: 'mx-sdk-single-select-control' },
            props.password
                ? createElement('input', {
                      id,
                      className: 'mx-sdk-single-select',
                      type: 'password',
                      value: props.value === '' ? '' : '••••••••',
                      disabled: true,
                      autoComplete: 'off',
                      'aria-label': props.showTitle ? undefined : props.title,
                      'aria-required': props.required || undefined,
                      'aria-invalid': props.invalid,
                      'aria-busy': props.pending,
                  })
                : createElement(
                      'select',
                      {
                          ref: select,
                          id,
                          className: 'mx-sdk-single-select',
                          value: props.value,
                          disabled: props.disabled,
                          'aria-label': props.showTitle
                              ? undefined
                              : props.title,
                          'aria-required': props.required || undefined,
                          'aria-invalid': props.invalid,
                          'aria-busy': props.pending,
                          'aria-describedby': feedback
                              ? `${id}-feedback`
                              : undefined,
                          onChange: (
                              event: import('react').ChangeEvent<HTMLSelectElement>
                          ) => {
                              event.stopPropagation();
                              const value = event.currentTarget.value;
                              if (current() && !props.disabled)
                                  props.selection?.choose(
                                      value === '' ? [] : [value]
                                  );
                              // A refused owner action must not leave a fabricated DOM value.
                              event.currentTarget.value = props.value;
                          },
                      },
                      createElement(
                          'option',
                          { value: '' },
                          props.emptyLabel ?? 'None'
                      ),
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
                  ),
            !props.password
                ? createElement(
                      'button',
                      {
                          type: 'button',
                          className: 'mx-sdk-single-select-clear',
                          'aria-label': props.clearLabel?.trim()
                              ? props.clearLabel
                              : `Clear ${props.title}`,
                          'aria-controls': id,
                          disabled: props.disabled || props.value === '',
                          onMouseDown: (event: SyntheticEvent) =>
                              event.preventDefault(),
                          onClick: (event: SyntheticEvent) => {
                              event.stopPropagation();
                              if (
                                  current() &&
                                  !props.disabled &&
                                  props.value !== ''
                              ) {
                                  props.selection?.clear();
                                  select.current?.focus();
                              }
                          },
                      },
                      createElement('span', { 'aria-hidden': true }, '×')
                  )
                : null
        ),
        choice
            ? createElement(
                  'span',
                  { className: 'mx-sdk-single-select-choice' },
                  createElement(
                      'label',
                      { htmlFor: `${id}-new-choice` },
                      'New choice name'
                  ),
                  createElement('input', {
                      id: `${id}-new-choice`,
                      className: 'mx-sdk-single-select-new-choice',
                      value: name,
                      disabled: !canCreate,
                      autoComplete: 'off',
                      'aria-describedby': `${id}-choice-status`,
                      onChange: (
                          event: import('react').ChangeEvent<HTMLInputElement>
                      ) => {
                          event.stopPropagation();
                          if (current() && canCreate)
                              setIntent({
                                  token,
                                  name: event.currentTarget.value,
                              });
                      },
                      onKeyDown: (
                          event: import('react').KeyboardEvent<HTMLInputElement>
                      ) => {
                          event.stopPropagation();
                          if (event.key === 'Enter') event.preventDefault();
                      },
                  }),
                  createElement(
                      'span',
                      { className: 'mx-sdk-single-select-choice-actions' },
                      createElement(
                          'button',
                          {
                              type: 'button',
                              disabled: !canCreate || name.trim() === '',
                              onClick: () => {
                                  if (!current() || !canCreate || !name.trim())
                                      return;
                                  const captured = name;
                                  void choice.create(captured).then(
                                      (accepted) => {
                                          if (accepted && current())
                                              setIntent((now) =>
                                                  now.token === token &&
                                                  now.name === captured
                                                      ? { token, name: '' }
                                                      : now
                                              );
                                      },
                                      () => {}
                                  );
                              },
                          },
                          'Create choice'
                      ),
                      createElement(
                          'button',
                          {
                              type: 'button',
                              disabled: !choice.state.busy,
                              onClick: () => {
                                  if (current() && choice.state.busy)
                                      choice.cancel();
                              },
                          },
                          'Cancel choice creation'
                      )
                  ),
                  createElement(
                      'span',
                      {
                          id: `${id}-choice-status`,
                          role: 'status',
                          'aria-busy': choice.state.busy,
                          'aria-live': 'polite',
                          'aria-atomic': true,
                      },
                      choice.state.error ??
                          (choice.state.phase === 'created-selected'
                              ? 'Choice created and selected in the draft. Save to update the record.'
                              : choice.state.phase === 'created-not-selected'
                                ? 'Choice created but not currently selectable. The record has not been saved.'
                                : choice.state.busy
                                  ? 'Creating choice…'
                                  : choice.state.phase === 'uncertain'
                                    ? 'Choice creation outcome is uncertain.'
                                    : '')
                  )
              )
            : null,
        createElement(
            'span',
            {
                id: `${id}-feedback`,
                className: 'mx-sdk-single-select-feedback',
                role: 'status',
                'aria-live': 'polite',
                'aria-atomic': true,
            },
            feedback
        )
    );
}

/** Default Form/Grid/List presentation; accepted owners retain all write authority. */
export function renderSingleSelectField(
    props: FieldRendererProps<'singleSelect'>,
    options: SingleSelectFieldOptions = {}
): ReactNode {
    if (
        props.physicalKind !== 'singleSelect' ||
        props.field.config.type !== 'singleSelect'
    )
        return createElement(
            'p',
            { role: 'status' },
            'This control supports Single Select fields.'
        );
    const candidate =
        props.capability.type === 'editable'
            ? props.capability.selection
            : undefined;
    const selection =
        candidate?.state.multiple === false ? candidate : undefined;
    const config = singleSelectConfiguration(
        props.displayConfig,
        props.writeConfig
    );
    const computed = props.computed || props.field.isComputed === true;
    return createElement(SingleSelectControl, {
        ...config,
        ...options,
        fallbackSource: props,
        title: props.title.trim() ? props.title : props.field.name,
        value: typeof props.value === 'string' ? props.value : '',
        displayOptions: config.password
            ? []
            : singleSelectDisplayOptions(props.field, props.displayConfig),
        selection,
        choice:
            selection &&
            !selection.state.readOnly &&
            !computed &&
            !config.configuredReadOnly &&
            !config.password &&
            props.capability.type === 'editable'
                ? props.capability.choice
                : undefined,
        availability: props.selectAvailability,
        disabled:
            config.password ||
            config.configuredReadOnly ||
            computed ||
            props.pending ||
            !selection ||
            selection.state.disabled ||
            selection.state.readOnly,
        pending: props.pending,
        invalid: props.error !== null || props.validation.length > 0,
        feedback:
            selection?.state.error ??
            props.error ??
            props.validation.map((error) => error.errorMessage).join('\n'),
    });
}
