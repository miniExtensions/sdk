import FuseModule from 'fuse.js';
import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type KeyboardEvent,
    type SyntheticEvent,
} from 'react';
import { RadioInput } from './RadioInput.js';
import {
    publishDeferredSelectChoice,
    type PendingSelectChoice,
} from '../ui/selectDeferredChoice.js';
import { getSelectOptionPresentationKey } from '../ui/selectPresentation.js';

export type ControlledSelectChoice = {
    id: string;
    name: string;
    displayName?: string;
    color?: string;
    backgroundColor?: string;
};
export type SelectEditOwner = {
    token: unknown;
    isCurrent(): boolean;
    /** Exact same-operation metadata receipt; never general stale-owner admission. */
    canContinueMetadataPublication?(): boolean;
};
export type ControlledSelectLabels = {
    placeholder?: string;
    empty?: string;
    addOption?: string;
    noMatches?: string;
    clear?: string;
    remove?: (name: string) => string;
    loading?: string;
    creationFailed?: string;
};
export type ControlledSelectCommonProps = {
    choices: readonly ControlledSelectChoice[];
    availableChoices: readonly ControlledSelectChoice[];
    owner: SelectEditOwner;
    presentation: 'list' | 'dropdown';
    readOnly?: boolean;
    disabled?: boolean;
    visible?: boolean;
    limitToOneSelection?: boolean;
    maxSelections?: number | null;
    allowAddingNewOptions?: boolean;
    publishMetadata?(choice: PendingSelectChoice): boolean | void;
    inputId?: string;
    formId?: string;
    ariaLabel?: string;
    describedBy?: string;
    invalid?: boolean;
    className?: string;
    labels?: ControlledSelectLabels;
    isInGrid?: boolean;
};
export type ControlledSingleSelectFieldProps = ControlledSelectCommonProps & {
    value: string | null;
    onValueChange(value: string | null): boolean | void;
};
export type ControlledMultipleSelectsFieldProps =
    ControlledSelectCommonProps & {
        value: readonly string[];
        onValueChange(value: string[]): boolean | void;
    };
type ControlProps = ControlledSelectCommonProps & {
    values: readonly string[];
    multiple: boolean;
    change(values: string[]): boolean | void;
};
function isFuseConstructor(
    value: unknown
): value is typeof import('fuse.js').default {
    return typeof value === 'function';
}
const stop = (event: SyntheticEvent) => event.stopPropagation();
const label = (choice: ControlledSelectChoice) =>
    choice.displayName ?? choice.name;
const key = (choice: ControlledSelectChoice) =>
    getSelectOptionPresentationKey({
        id: choice.id,
        canonicalName: choice.name,
        displayName: label(choice),
    });

/** Complete controlled picker. Only transient search/open state is owned here. */
function SelectControl(props: ControlProps): ReactNode {
    const generatedId = useId();
    const id = props.inputId ?? generatedId;
    const root = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const focusAfterRemoval = useRef<{
        epoch: object;
        element: HTMLButtonElement;
    } | null>(null);
    const generation = useRef({ token: props.owner.token, epoch: {} });
    if (generation.current.token !== props.owner.token)
        generation.current = { token: props.owner.token, epoch: {} };
    const epoch = generation.current.epoch;
    const live = useRef<ControlProps | null>(null);
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        live.current = props;
        return () => {
            live.current = null;
        };
    });
    const revision = useRef(0);
    const creation = useRef<{ epoch: object } | null>(null);
    const [creationState, setCreationState] = useState<{
        epoch: object;
        busy: boolean;
        failed: boolean;
    }>({ epoch, busy: false, failed: false });
    const busy = creationState.epoch === epoch && creationState.busy;
    commitEffect(() => {
        const pending = focusAfterRemoval.current;
        if (!pending) return;
        focusAfterRemoval.current = null;
        if (
            pending.epoch !== epoch ||
            !root.current ||
            props.readOnly ||
            props.disabled ||
            props.visible === false ||
            !props.owner.isCurrent()
        )
            return;
        const active = root.current.ownerDocument.activeElement;
        if (
            active !== pending.element &&
            !(
                active === root.current.ownerDocument.body &&
                !pending.element.isConnected
            )
        )
            return;
        if (pending.element.isConnected) return;
        const target =
            input.current ??
            root.current.querySelector<HTMLButtonElement>(
                'button[data-select-remove]'
            );
        target?.focus();
    });
    const [draft, setDraft] = useState({
        epoch,
        text: '',
        open: false,
        active: -1,
    });
    const state =
        draft.epoch === epoch
            ? draft
            : { epoch, text: '', open: false, active: -1 };
    const update = (change: Partial<typeof state>) => {
        // Retained blur/search/hover callbacks must not erase a successor's draft.
        if (live.current !== props || generation.current.epoch !== epoch)
            return;
        if (change.text !== undefined && change.text !== state.text)
            revision.current++;
        setDraft({ ...state, ...change });
    };
    const writable = () =>
        live.current === props &&
        generation.current.epoch === epoch &&
        props.visible !== false &&
        !props.readOnly &&
        !props.disabled &&
        props.owner.isCurrent();
    const disabled = props.readOnly === true || props.disabled === true;
    const canAdd =
        !disabled &&
        !(
            props.multiple &&
            ((props.limitToOneSelection && props.values.length === 1) ||
                (props.maxSelections != null &&
                    props.values.length >= props.maxSelections))
        );
    const lookup = new Map(
        props.choices.map((choice) => [choice.name, choice])
    );
    const selected = props.values.map(
        (name) => lookup.get(name) ?? { id: `unavailable:${name}`, name }
    );
    const candidates = props.availableChoices.filter(
        (choice) => !props.multiple || !props.values.includes(choice.name)
    );
    const fuse = useMemo(
        () =>
            isFuseConstructor(FuseModule)
                ? new FuseModule([...candidates], {
                      keys: ['displayName', 'name'],
                      threshold: 0.2,
                      ignoreLocation: true,
                      ignoreFieldNorm: true,
                  })
                : null,
        [props.availableChoices, props.values, props.multiple]
    );
    const found = state.text
        ? (fuse?.search(state.text).map((result) => result.item) ?? [])
        : candidates;
    const settle = (submittedRevision: number, open: boolean) => {
        const current = live.current;
        if (
            !current ||
            generation.current.epoch !== epoch ||
            revision.current !== submittedRevision ||
            current.disabled ||
            current.readOnly ||
            current.visible === false ||
            !current.owner.isCurrent()
        )
            return;
        setDraft({ epoch, text: '', open, active: -1 });
    };
    const choose = (name: string) => {
        if (
            !writable() ||
            !canAdd ||
            !props.availableChoices.some((choice) => choice.name === name)
        )
            return;
        const next =
            !props.multiple || props.limitToOneSelection
                ? [name]
                : [...props.values, name];
        const submittedRevision = revision.current;
        const accepted = props.change(next);
        if (accepted !== false) settle(submittedRevision, props.multiple);
    };
    const remove = (name: string, element?: HTMLButtonElement) => {
        if (!writable()) return;
        if (element) focusAfterRemoval.current = { epoch, element };
        const accepted = props.change(
            props.values.filter((value) => value !== name)
        );
        if (accepted === false) focusAfterRemoval.current = null;
    };
    const clear = () => {
        if (writable()) props.change([]);
    };
    const create = (name = state.text) => {
        if (
            !writable() ||
            !canAdd ||
            !props.allowAddingNewOptions ||
            !props.publishMetadata ||
            creation.current?.epoch === epoch
        )
            return;
        const operation = { epoch };
        creation.current = operation;
        const submittedRevision = revision.current;
        setCreationState({ epoch, busy: true, failed: false });
        let metadataPublished = false;
        const publishMetadata = props.publishMetadata;
        try {
            const result = publishDeferredSelectChoice({
                input: name,
                choices: props.choices,
                selectedNames: props.values,
                multiple: props.multiple,
                isCurrent: () =>
                    writable() ||
                    (metadataPublished &&
                        live.current !== null &&
                        props.owner.canContinueMetadataPublication?.() ===
                            true),
                publishMetadata: (choice) => {
                    const accepted = publishMetadata(choice);
                    metadataPublished = accepted !== false;
                    return accepted;
                },
                selectName: (name) =>
                    props.change(
                        !props.multiple || props.limitToOneSelection
                            ? [name]
                            : [...props.values, name]
                    ),
            });
            if (
                result.status === 'selected' ||
                result.status === 'already-selected'
            )
                settle(submittedRevision, props.multiple);
        } catch (error) {
            if (live.current && generation.current.epoch === epoch)
                setCreationState({ epoch, busy: true, failed: true });
            throw error;
        } finally {
            queueMicrotask(() => {
                if (creation.current !== operation) return;
                creation.current = null;
                if (live.current && generation.current.epoch === epoch)
                    setCreationState((previous) => ({
                        ...previous,
                        busy: false,
                    }));
            });
        }
    };
    const addFromPrompt = () => {
        if (!writable() || !canAdd || creation.current?.epoch === epoch) return;
        const name = root.current?.ownerDocument.defaultView?.prompt(
            props.labels?.addOption ?? 'Add new option'
        );
        if (name == null || name.trim() === '') return;
        const normalized = name.trim().toLowerCase();
        if (
            props.availableChoices.some((choice) =>
                [choice.name, label(choice)].some(
                    (value) => value.trim().toLowerCase() === normalized
                )
            )
        )
            return;
        create(name);
    };
    const normalized = state.text.trim().toLowerCase();
    const showCreate =
        canAdd &&
        props.allowAddingNewOptions &&
        props.publishMetadata &&
        normalized.length > 0 &&
        !props.choices.some((choice) =>
            [choice.name, label(choice)].some(
                (value) => value.trim().toLowerCase() === normalized
            )
        );
    const badge = (choice: ControlledSelectChoice, removable: boolean) =>
        h(
            'span',
            {
                className: 'mx-sdk-select-badge',
                style: {
                    color: choice.color,
                    backgroundColor: choice.backgroundColor,
                },
            },
            label(choice),
            removable
                ? h(
                      'button',
                      {
                          type: 'button',
                          form: props.formId,
                          'aria-label':
                              props.labels?.remove?.(label(choice)) ??
                              `Remove ${label(choice)}`,
                          'data-select-remove': choice.name,
                          onClick: (
                              event: import('react').MouseEvent<HTMLButtonElement>
                          ) => remove(choice.name, event.currentTarget),
                      },
                      '×'
                  )
                : null
        );
    if (props.visible === false) return null;
    return h(
        'div',
        {
            ref: root,
            className: ['mx-sdk-select', props.className]
                .filter(Boolean)
                .join(' '),
            'data-style': props.presentation,
            onClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onBlur: (event: import('react').FocusEvent<HTMLDivElement>) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                    update({ open: false });
            },
        },
        props.presentation === 'list'
            ? h(
                  'fieldset',
                  {
                      id,
                      disabled,
                      'aria-describedby': props.describedBy,
                      'aria-invalid': props.invalid,
                  },
                  h(
                      'legend',
                      { className: 'mx-sdk-select-sr-only' },
                      props.ariaLabel
                  ),
                  ...props.availableChoices.map((choice) => {
                      const checked = props.values.includes(choice.name);
                      const optionId = `${id}-${key(choice)}`;
                      return h(
                          'div',
                          {
                              key: key(choice),
                              className: 'mx-sdk-select-list-option',
                          },
                          props.multiple
                              ? h('input', {
                                    type: 'checkbox',
                                    id: optionId,
                                    form: props.formId,
                                    checked,
                                    disabled: disabled || (!checked && !canAdd),
                                    onChange: () =>
                                        checked
                                            ? remove(choice.name)
                                            : choose(choice.name),
                                })
                              : h(RadioInput, {
                                    id: optionId,
                                    name: `${generatedId}-group`,
                                    form: props.formId,
                                    checked,
                                    allowDeselect: true,
                                    disabled,
                                    onCheckedChange: (next) =>
                                        next ? choose(choice.name) : clear(),
                                }),
                          h(
                              'label',
                              { htmlFor: optionId },
                              badge(choice, false)
                          )
                      );
                  })
              )
            : h(
                  'div',
                  { className: 'mx-sdk-select-dropdown' },
                  h(
                      'ul',
                      {
                          className: 'mx-sdk-select-selected',
                          'aria-label': 'selected options',
                      },
                      ...selected.map((choice, index) =>
                          h(
                              'li',
                              { key: `${key(choice)}-${index}` },
                              badge(choice, !disabled)
                          )
                      )
                  )
              ),
        disabled && selected.length === 0
            ? h('span', null, props.labels?.empty ?? 'None')
            : null,
        !disabled && props.presentation === 'dropdown' && canAdd
            ? h(
                  'div',
                  { className: 'mx-sdk-select-search' },
                  h('input', {
                      ref: input,
                      id,
                      form: props.formId,
                      role:
                          props.presentation === 'dropdown'
                              ? 'combobox'
                              : undefined,
                      'aria-label': props.ariaLabel,
                      'aria-describedby': props.describedBy,
                      'aria-invalid': props.invalid,
                      'aria-expanded':
                          props.presentation === 'dropdown'
                              ? state.open
                              : undefined,
                      'aria-controls':
                          props.presentation === 'dropdown' && state.open
                              ? `${id}-options`
                              : undefined,
                      'aria-activedescendant':
                          props.presentation === 'dropdown' &&
                          state.open &&
                          (found[state.active] ||
                              (showCreate && state.active === found.length))
                              ? `${id}-option-${state.active}`
                              : undefined,
                      autoComplete: 'off',
                      placeholder: props.labels?.placeholder,
                      value: state.text,
                      onChange: (
                          event: import('react').ChangeEvent<HTMLInputElement>
                      ) =>
                          update({
                              text: event.currentTarget.value,
                              open: true,
                              active: 0,
                          }),
                      onFocus: () => update({ open: true }),
                      onClick: () => update({ open: true }),
                      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
                          event.stopPropagation();
                          if (event.nativeEvent.isComposing) return;
                          const optionCount =
                              found.length + (showCreate ? 1 : 0);
                          if (event.key === 'Escape') {
                              event.preventDefault();
                              update({ open: false, active: -1 });
                          } else if (event.key === 'Tab') {
                              update({ open: false, active: -1 });
                          } else if (
                              event.key === 'ArrowDown' ||
                              event.key === 'ArrowUp'
                          ) {
                              event.preventDefault();
                              const direction =
                                  event.key === 'ArrowDown' ? 1 : -1;
                              const next =
                                  !state.open || state.active < 0
                                      ? direction === 1
                                          ? 0
                                          : optionCount - 1
                                      : state.active + direction;
                              update({
                                  open: true,
                                  active: Math.max(
                                      -1,
                                      Math.min(optionCount - 1, next)
                                  ),
                              });
                          } else if (
                              state.open &&
                              (event.key === 'Home' || event.key === 'End')
                          ) {
                              event.preventDefault();
                              update({
                                  active:
                                      event.key === 'Home'
                                          ? 0
                                          : optionCount - 1,
                              });
                          } else if (event.key === 'Enter') {
                              event.preventDefault();
                              if (!state.open) return;
                              if (found[state.active])
                                  choose(found[state.active]!.name);
                              else if (
                                  showCreate &&
                                  (state.active === found.length ||
                                      found.length === 0)
                              )
                                  create();
                          }
                      },
                  }),
                  props.presentation === 'dropdown' && state.open
                      ? h(
                            'ul',
                            {
                                role: 'listbox',
                                id: `${id}-options`,
                                'aria-label': props.ariaLabel,
                                'aria-multiselectable': props.multiple,
                            },
                            ...found.map((choice, index) =>
                                h(
                                    'li',
                                    {
                                        key: key(choice),
                                        id: `${id}-option-${index}`,
                                        role: 'option',
                                        'data-active':
                                            state.active === index || undefined,
                                        'aria-selected': props.values.includes(
                                            choice.name
                                        ),
                                        onMouseDown: (
                                            event: import('react').MouseEvent
                                        ) => event.preventDefault(),
                                        onMouseEnter: () =>
                                            update({ active: index }),
                                        onClick: () => choose(choice.name),
                                    },
                                    badge(choice, false)
                                )
                            ),
                            busy
                                ? h(
                                      'li',
                                      { role: 'status' },
                                      props.labels?.loading ?? 'Loading…'
                                  )
                                : null,
                            showCreate
                                ? h(
                                      'li',
                                      {
                                          id: `${id}-option-${found.length}`,
                                          role: 'option',
                                          'aria-selected': false,
                                          'aria-disabled': busy,
                                          'data-active':
                                              state.active === found.length ||
                                              undefined,
                                          onMouseDown: (
                                              event: import('react').MouseEvent
                                          ) => event.preventDefault(),
                                          onMouseEnter: () =>
                                              update({ active: found.length }),
                                          onClick: () => create(),
                                      },
                                      `${props.labels?.addOption ?? 'Add new option'} "${state.text.trim()}"`
                                  )
                                : null,
                            found.length === 0 && !showCreate
                                ? h(
                                      'li',
                                      { role: 'presentation' },
                                      props.labels?.noMatches ??
                                          'No matching choices'
                                  )
                                : null
                        )
                      : null
              )
            : null,
        !disabled &&
            props.presentation === 'list' &&
            props.allowAddingNewOptions
            ? h(
                  'button',
                  {
                      type: 'button',
                      form: props.formId,
                      disabled: !canAdd || busy,
                      'aria-busy': busy,
                      onClick: addFromPrompt,
                  },
                  busy
                      ? (props.labels?.loading ?? 'Loading…')
                      : (props.labels?.addOption ?? 'Add new option')
              )
            : null,
        creationState.epoch === epoch && creationState.failed
            ? h(
                  'p',
                  { role: 'alert' },
                  props.labels?.creationFailed ??
                      'The choice could not be added. Review the current field before trying again.'
              )
            : null,
        !disabled && props.values.length > 0
            ? h(
                  'button',
                  {
                      type: 'button',
                      form: props.formId,
                      onClick: clear,
                      'aria-label': props.labels?.clear ?? 'Clear',
                  },
                  props.labels?.clear ?? 'Clear'
              )
            : null
    );
}
export function ControlledSingleSelectField(
    props: ControlledSingleSelectFieldProps
): ReactNode {
    return h(SelectControl, {
        ...props,
        values: props.value ? [props.value] : [],
        multiple: false,
        change: (values) => props.onValueChange(values[0] ?? null),
    });
}
export function ControlledMultipleSelectsField(
    props: ControlledMultipleSelectsFieldProps
): ReactNode {
    return h(SelectControl, {
        ...props,
        values: props.value,
        multiple: true,
        change: props.onValueChange,
    });
}
