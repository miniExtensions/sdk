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
    type MouseEvent,
    type PointerEvent,
    type SyntheticEvent,
} from 'react';
import { RadioInput } from './RadioInput.js';
import { renderReadOnlyEmptyValue } from './CompleteReadOnlyTextField.js';
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
    availableOptions?: string;
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
    /** Compact dropdown presentation used by Portal Quick Filter. */
    dropdownStyle?: 'portal-filter';
};
export type ControlledSingleSelectFieldProps = ControlledSelectCommonProps & {
    value: string | null;
    onValueChange(value: string | null): boolean | void;
    /** Native Form appearance for a read-only, non-Grid dropdown. */
    readOnlyDropdownLayout?: 'native-form';
    /** Native Form spacing and labels for an editable, non-Grid radio list. */
    editableRadioLayout?: 'native-form';
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
    readOnlyDropdownLayout?: ControlledSingleSelectFieldProps['readOnlyDropdownLayout'];
    editableRadioLayout?: ControlledSingleSelectFieldProps['editableRadioLayout'];
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
const sameValues = (left: readonly string[], right: readonly string[]) =>
    left.length === right.length &&
    left.every((value, index) => value === right[index]);

type SelectionSettlement = {
    epoch: object;
    revision: number;
    previousValues: readonly string[];
    values: readonly string[];
    open: boolean;
    accepted: boolean;
    observedExpected: boolean;
};

/** Complete controlled picker. Only transient search/open state is owned here. */
function SelectControl(props: ControlProps): ReactNode {
    const portalFilter =
        props.presentation === 'dropdown' &&
        props.dropdownStyle === 'portal-filter';
    const nativeFormReadOnly =
        props.readOnlyDropdownLayout === 'native-form' &&
        props.readOnly === true &&
        props.presentation === 'dropdown' &&
        !props.multiple &&
        !props.isInGrid &&
        !portalFilter;
    const generatedId = useId();
    const id = props.inputId ?? generatedId;
    const root = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const revealAfterKey = useRef<{
        epoch: object;
        index: number;
        choiceKey: string;
    } | null>(null);
    const focusAfterRemoval = useRef<{
        epoch: object;
        element: HTMLButtonElement;
    } | null>(null);
    const generation = useRef({ token: props.owner.token, epoch: {} });
    if (generation.current.token !== props.owner.token)
        generation.current = { token: props.owner.token, epoch: {} };
    const epoch = generation.current.epoch;
    const live = useRef<ControlProps | null>(null);
    const pointerSelection = useRef<{
        target: Element;
        owner: SelectEditOwner;
        epoch: object;
    } | null>(null);
    const pendingSettlement = useRef<SelectionSettlement | null>(null);
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        live.current = props;
        const selection = pointerSelection.current;
        if (
            selection &&
            (selection.epoch !== epoch ||
                props.visible === false ||
                props.disabled ||
                props.readOnly ||
                !selection.owner.isCurrent())
        )
            pointerSelection.current = null;
        return () => {
            live.current = null;
        };
    });
    commitEffect(
        () => () => {
            pendingSettlement.current = null;
        },
        []
    );
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
        const next = { ...state, ...change };
        if (
            next.text !== state.text ||
            next.open !== state.open ||
            next.active !== state.active
        ) {
            revision.current++;
            pendingSettlement.current = null;
        }
        setDraft(next);
    };
    const writable = () =>
        live.current === props &&
        generation.current.epoch === epoch &&
        props.visible !== false &&
        !props.readOnly &&
        !props.disabled &&
        props.owner.isCurrent();
    const selectionPointerEvents = portalFilter
        ? {
              onPointerDown: (event: PointerEvent) => {
                  if (event.isPrimary && event.button === 0)
                      pointerSelection.current = writable()
                          ? {
                                target: event.currentTarget,
                                owner: props.owner,
                                epoch,
                            }
                          : null;
              },
              onPointerCancel: (event: PointerEvent) => {
                  if (event.isPrimary) pointerSelection.current = null;
              },
          }
        : {};
    const admitsSelectionClick = (event: MouseEvent) => {
        if (!portalFilter || event.detail === 0) return true;
        const selection = pointerSelection.current;
        pointerSelection.current = null;
        return (
            selection?.target === event.currentTarget &&
            selection.epoch === epoch &&
            selection.owner.isCurrent()
        );
    };
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
        (name) =>
            lookup.get(name) ?? {
                id: `unavailable:${name}`,
                name,
                backgroundColor: 'gray',
                color: '#f3f4f6',
            }
    );
    const candidates = portalFilter
        ? props.availableChoices
        : props.availableChoices.filter(
              (choice) => !props.multiple || !props.values.includes(choice.name)
          );
    const fuse = useMemo(
        () =>
            isFuseConstructor(FuseModule)
                ? new FuseModule([...candidates], {
                      keys: portalFilter
                          ? [{ name: 'label', getFn: label }]
                          : ['displayName', 'name'],
                      threshold: 0.2,
                      ignoreLocation: true,
                      ignoreFieldNorm: true,
                  })
                : null,
        [props.availableChoices, props.values, props.multiple, portalFilter]
    );
    const found = state.text
        ? (fuse?.search(state.text).map((result) => result.item) ?? [])
        : candidates;
    const moveActiveWithKeyboard = (index: number) => {
        if (portalFilter && writable()) {
            const choice = found[index];
            revealAfterKey.current = choice
                ? { epoch, index, choiceKey: key(choice) }
                : null;
        }
        update({ open: true, active: index });
    };
    commitEffect(() => {
        const pending = revealAfterKey.current;
        if (!pending) return;
        revealAfterKey.current = null;
        const target = input.current;
        const choice = found[state.active];
        if (
            !portalFilter ||
            pending.epoch !== epoch ||
            pending.index !== state.active ||
            !state.open ||
            !choice ||
            key(choice) !== pending.choiceKey ||
            !target ||
            target.ownerDocument.activeElement !== target ||
            !writable()
        )
            return;
        const activeId = target.getAttribute('aria-activedescendant');
        const option = activeId
            ? target.ownerDocument.getElementById(activeId)
            : null;
        if (option && root.current?.contains(option))
            option.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    });
    const settlePending = (committed: boolean) => {
        const pending = pendingSettlement.current;
        if (!pending) return;
        const current = live.current;
        if (
            !current ||
            generation.current.epoch !== pending.epoch ||
            revision.current !== pending.revision ||
            current.disabled ||
            current.readOnly ||
            current.visible === false
        ) {
            pendingSettlement.current = null;
            return;
        }
        const expected = sameValues(current.values, pending.values);
        const currentOwner = current.owner.isCurrent();
        if (
            (!expected &&
                (pending.observedExpected ||
                    !sameValues(current.values, pending.previousValues))) ||
            (committed && expected && !currentOwner)
        ) {
            // A different committed value or retired authority cannot later
            // become this operation's receipt by returning to the same value.
            pendingSettlement.current = null;
            return;
        }
        if (committed && expected) pending.observedExpected = true;
        // Native value-bound authority can be false until the controlled echo.
        // Only that exact current echo may settle; no writer is retried here.
        if (!pending.accepted || !expected || !currentOwner) return;
        pendingSettlement.current = null;
        setDraft({
            epoch: pending.epoch,
            text: '',
            open: pending.open,
            active: -1,
        });
    };
    commitEffect(() => settlePending(true));
    const changeAndSettle = (
        values: string[],
        submittedRevision: number,
        previousValues: readonly string[]
    ) => {
        // Metadata admission may synchronously admit a newer picker intent.
        // Keep its settlement while preserving the original native writer gate.
        if (
            generation.current.epoch !== epoch ||
            revision.current !== submittedRevision
        )
            return props.change(values);
        const pending: SelectionSettlement = {
            epoch,
            revision: submittedRevision,
            previousValues: [...previousValues],
            values: [...values],
            open: props.multiple,
            accepted: false,
            observedExpected: false,
        };
        // Observe synchronous commits during the writer, but never clear the
        // picker until the writer has actually accepted this exact intent.
        pendingSettlement.current = pending;
        let accepted: boolean | void;
        try {
            accepted = props.change(values);
        } catch (error) {
            if (pendingSettlement.current === pending)
                pendingSettlement.current = null;
            throw error;
        }
        if (pendingSettlement.current === pending) {
            if (accepted === false) pendingSettlement.current = null;
            else {
                pending.accepted = true;
                settlePending(false);
            }
        }
        return accepted;
    };
    const choose = (name: string) => {
        if (portalFilter && props.values.includes(name)) {
            remove(name);
            return;
        }
        if (
            !writable() ||
            (!canAdd &&
                !(
                    props.presentation === 'list' && props.limitToOneSelection
                )) ||
            !props.availableChoices.some((choice) => choice.name === name)
        )
            return;
        const next =
            !props.multiple || props.limitToOneSelection
                ? [name]
                : [...props.values, name];
        const submittedRevision = ++revision.current;
        changeAndSettle(next, submittedRevision, [...props.values]);
    };
    const remove = (name: string, element?: HTMLButtonElement) => {
        if (!writable()) return;
        revision.current++;
        pendingSettlement.current = null;
        if (element) focusAfterRemoval.current = { epoch, element };
        const accepted = props.change(
            props.values.filter((value) => value !== name)
        );
        if (accepted === false) focusAfterRemoval.current = null;
    };
    const clear = () => {
        if (!writable()) return;
        revision.current++;
        pendingSettlement.current = null;
        props.change([]);
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
        const submittedRevision = ++revision.current;
        pendingSettlement.current = null;
        const previousValues = [...props.values];
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
                    changeAndSettle(
                        !props.multiple || props.limitToOneSelection
                            ? [name]
                            : [...props.values, name],
                        submittedRevision,
                        previousValues
                    ),
            });
            if (
                result.status === 'already-selected' &&
                generation.current.epoch === epoch &&
                revision.current === submittedRevision
            ) {
                pendingSettlement.current = {
                    epoch,
                    revision: submittedRevision,
                    previousValues,
                    values: previousValues,
                    open: props.multiple,
                    accepted: true,
                    observedExpected: false,
                };
                settlePending(false);
            }
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
    const badge = (choice: ControlledSelectChoice, removable: boolean) => {
        const choiceLabel = label(choice);
        return h(
            'span',
            {
                className: 'mx-sdk-select-badge',
                title: choiceLabel,
                style: {
                    color: choice.color,
                    backgroundColor: choice.backgroundColor,
                },
            },
            (removable && props.multiple) || nativeFormReadOnly
                ? h(
                      'span',
                      { className: 'mx-sdk-select-selected-label' },
                      choiceLabel
                  )
                : choiceLabel,
            removable
                ? h(
                      'button',
                      {
                          type: 'button',
                          form: props.formId,
                          'aria-label':
                              props.labels?.remove?.(choiceLabel) ??
                              `Remove ${choiceLabel}`,
                          'data-select-remove': choice.name,
                          ...selectionPointerEvents,
                          onClick: (
                              event: import('react').MouseEvent<HTMLButtonElement>
                          ) => {
                              if (admitsSelectionClick(event))
                                  remove(choice.name, event.currentTarget);
                          },
                      },
                      portalFilter
                          ? h(
                                'svg',
                                {
                                    className: 'mx-sdk-select-remove-icon',
                                    viewBox: '0 0 8 8',
                                    stroke: 'currentColor',
                                    fill: 'none',
                                    'aria-hidden': true,
                                },
                                h('path', {
                                    d: 'M1 1l6 6m0-6L1 7',
                                    strokeLinecap: 'round',
                                    strokeWidth: 1.5,
                                })
                            )
                          : '×'
                  )
                : null
        );
    };
    if (props.visible === false) return null;
    return h(
        'div',
        {
            ref: root,
            className: ['mx-sdk-select', props.className]
                .filter(Boolean)
                .join(' '),
            'data-style': props.presentation,
            'data-portal-filter': portalFilter || undefined,
            'data-readonly-dropdown-layout': nativeFormReadOnly
                ? props.readOnlyDropdownLayout
                : undefined,
            onClick: props.readOnly
                ? undefined
                : (event: import('react').MouseEvent<HTMLDivElement>) => {
                      stop(event);
                      if (
                          portalFilter &&
                          !disabled &&
                          !(event.target as Element).closest(
                              'input, button, [role="listbox"]'
                          )
                      ) {
                          input.current?.focus();
                          update({ open: true });
                      }
                  },
            onPointerDown: props.readOnly ? undefined : stop,
            onKeyDown: props.readOnly ? undefined : stop,
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
                      'data-editable-radio-layout':
                          props.editableRadioLayout === 'native-form' &&
                          !props.multiple &&
                          !props.isInGrid &&
                          !disabled
                              ? props.editableRadioLayout
                              : undefined,
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
                      const optionId = `${id}-${generatedId}-${key(choice)}`;
                      return h(
                          'div',
                          {
                              key: key(choice),
                              className: 'mx-sdk-select-list-option',
                          },
                          props.multiple && !props.limitToOneSelection
                              ? h('input', {
                                    type: 'checkbox',
                                    className: 'mx-sdk-select-list-input',
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
                                    className: 'mx-sdk-select-list-input',
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
            : nativeFormReadOnly && selected.length === 0
              ? renderReadOnlyEmptyValue(props.labels?.empty ?? 'None')
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
                                {
                                    key: `${key(choice)}-${index}`,
                                    className:
                                        props.multiple && !disabled
                                            ? 'mx-sdk-select-removable-selection'
                                            : undefined,
                                },
                                badge(choice, !disabled)
                            )
                        )
                    )
                ),
        disabled && selected.length === 0 && !nativeFormReadOnly
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
                      placeholder:
                          portalFilter && selected.length
                              ? ''
                              : props.labels?.placeholder,
                      value: state.text,
                      onChange: (
                          event: import('react').ChangeEvent<HTMLInputElement>
                      ) =>
                          update({
                              text: event.currentTarget.value,
                              open: true,
                              active: 0,
                          }),
                      onFocus: () =>
                          update(portalFilter ? { text: '' } : { open: true }),
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
                              moveActiveWithKeyboard(
                                  Math.max(-1, Math.min(optionCount - 1, next))
                              );
                          } else if (
                              state.open &&
                              (event.key === 'Home' || event.key === 'End')
                          ) {
                              event.preventDefault();
                              moveActiveWithKeyboard(
                                  event.key === 'Home' ? 0 : optionCount - 1
                              );
                          } else if (event.key === 'Enter') {
                              event.preventDefault();
                              if (!state.open || (portalFilter && event.repeat))
                                  return;
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
                            portalFilter && found.length > 0
                                ? h(
                                      'li',
                                      {
                                          role: 'presentation',
                                          className:
                                              'mx-sdk-select-options-heading',
                                      },
                                      props.labels?.availableOptions ??
                                          'Available options'
                                  )
                                : null,
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
                                        ...selectionPointerEvents,
                                        onMouseDown: (
                                            event: import('react').MouseEvent
                                        ) => event.preventDefault(),
                                        onMouseEnter: () =>
                                            update({ active: index }),
                                        onClick: (event: MouseEvent) => {
                                            if (admitsSelectionClick(event))
                                                choose(choice.name);
                                        },
                                    },
                                    badge(choice, false),
                                    portalFilter &&
                                        props.values.includes(choice.name)
                                        ? h(
                                              'svg',
                                              {
                                                  className:
                                                      'mx-sdk-select-option-check',
                                                  viewBox: '0 0 24 24',
                                                  fill: 'currentColor',
                                                  'aria-hidden': true,
                                              },
                                              h('path', {
                                                  d: 'M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z',
                                                  fillRule: 'evenodd',
                                                  clipRule: 'evenodd',
                                              })
                                          )
                                        : null
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
        portalFilter && !disabled
            ? h(
                  'svg',
                  {
                      className: 'mx-sdk-select-portal-chevron',
                      viewBox: '0 0 24 24',
                      fill: 'currentColor',
                      width: 16,
                      height: 16,
                      'aria-hidden': true,
                  },
                  h('path', {
                      d: 'M12.53 16.28a.75.75 0 0 1-1.06 0l-7.5-7.5a.75.75 0 0 1 1.06-1.06L12 14.69l6.97-6.97a.75.75 0 1 1 1.06 1.06l-7.5 7.5Z',
                      fillRule: 'evenodd',
                      clipRule: 'evenodd',
                  })
              )
            : null,
        !disabled &&
            props.presentation === 'list' &&
            props.allowAddingNewOptions
            ? h(
                  'button',
                  {
                      type: 'button',
                      className: 'mx-sdk-select-action',
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
        !portalFilter && !disabled && props.values.length > 0
            ? h(
                  'button',
                  {
                      type: 'button',
                      className: 'mx-sdk-select-action',
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
