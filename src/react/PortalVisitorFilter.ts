import {
    createElement as h,
    lazy,
    Suspense,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ChangeEvent,
    type CSSProperties,
    type KeyboardEvent,
    type MouseEvent,
    type PointerEvent,
    type ReactElement,
    type SyntheticEvent,
} from 'react';
import {
    createPortalVisitorFilterDraft,
    resolvePortalVisitorFilterOperator,
    type PortalVisitorFilterPort,
    type PortalVisitorFilterOutcome,
} from '../portals/visitorFilter.js';
import type {
    RuntimeConditionSetting,
    RuntimeConditionsDefinition,
    RuntimeLanguage,
} from '../runtime/types.js';

const defaultLabels = {
    trigger: 'Filter',
    quickFilters: 'Quick filters',
    allValues: 'All values',
    title: 'Filter records',
    done: 'Done',
    close: 'Close',
    addCondition: 'Add condition',
    addGroup: 'Add group',
    clear: 'Clear filters',
    removeCondition: 'Delete condition',
    removeGroup: 'Delete group',
    group: 'Condition group',
    all: 'All conditions',
    any: 'Any condition',
    logicalOperator: 'Match',
    field: 'Field',
    operator: 'Operator',
    value: 'Value',
    calendar: 'Calendar',
    yes: 'Yes',
    no: 'No',
    unavailableGroup:
        'This saved filter group exceeds the supported depth. You can keep it or delete it.',
    unavailable:
        'This filter condition is unavailable. You can keep it or delete it.',
    refused: 'The current view could not apply these filters.',
    stale: 'The view or filter fields changed. Open Filter again to edit the current conditions.',
    uncertain:
        'Filter submission could not be confirmed. Check the current view before trying again.',
};

type Labels = typeof defaultLabels;
export type PortalVisitorFilterLabels = Partial<Labels>;
export type PortalVisitorFilterProps = {
    port: PortalVisitorFilterPort;
    disabled?: boolean;
    /** Show the quick filters admitted by the current host frame. */
    showDropdowns?: boolean;
    labels?: PortalVisitorFilterLabels;
    /** Calendar locale for date operands. Defaults to English. */
    language?: RuntimeLanguage;
    className?: string;
    style?: CSSProperties;
    onOutcome?(outcome: PortalVisitorFilterOutcome): void;
};
type Draft = NonNullable<ReturnType<typeof createPortalVisitorFilterDraft>>;
type Open = { port: PortalVisitorFilterPort; draft: Draft };
type HeldQuickKey = { fieldId: string; key: string; shown: Open };
type QuickGesture = { fieldId: string; shown: Open; held?: HeldQuickKey };
type Status = {
    type: PortalVisitorFilterOutcome['type'] | 'pending';
    owner?: Open;
    outcome?: PortalVisitorFilterOutcome;
};
const FilterDateField = /* @__PURE__ */ lazy(async () => ({
    default: (await import('./date/DateField.js')).DateField,
}));
const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;
const buttons: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.5rem',
};
const selectKeys = new Set([
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'PageUp',
    'PageDown',
    'Enter',
]);

function hitsBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    // Native dialogs retarget both the backdrop and their own padding to the dialog.
    const { left, right, top, bottom } =
        event.currentTarget.getBoundingClientRect();
    return (
        event.clientX < left ||
        event.clientX >= right ||
        event.clientY < top ||
        event.clientY >= bottom
    );
}

function readFilterDraft(port: PortalVisitorFilterPort): Open | null {
    const draft = createPortalVisitorFilterDraft(port);
    return draft ? { port, draft } : null;
}

function FilterDialog({
    shown,
    labels,
    language,
    disabled,
    close,
    opener,
}: {
    shown: Open;
    labels: Labels;
    language: RuntimeLanguage;
    disabled: boolean;
    close(): void;
    opener: { readonly current: HTMLButtonElement | null };
}) {
    const { draft, port } = shown;
    const dialog = useRef<HTMLDialogElement>(null);
    const title = useRef<HTMLHeadingElement>(null);
    const done = useRef<HTMLButtonElement>(null);
    const backdrop = useRef(false);
    const focusNext = useRef<string | null>(null);
    const id = useId();
    const titleId = `${id}-title`;
    const [stale, setStale] = useState(false);
    const [version, refresh] = useState(0);
    const inactive = disabled || stale;
    const { criteria, fields } = draft.snapshot();
    useCommitEffect(() => {
        const node = dialog.current;
        if (!node) return;
        node.showModal();
        title.current?.focus();
        const revalidate = () => {
            if (!draft.current()) setStale(true);
        };
        const unsubscribe = port.subscribe(revalidate);
        revalidate();
        return () => {
            unsubscribe();
            const owner = node.ownerDocument;
            const hadFocus = node.contains(owner.activeElement);
            if (node.open) node.close();
            if (
                hadFocus &&
                opener.current?.isConnected &&
                owner.activeElement === owner.body
            )
                opener.current.focus();
        };
    }, [draft, opener, port]);
    useCommitEffect(() => {
        const focusId = focusNext.current;
        if (focusId === null) return;
        focusNext.current = null;
        const next = dialog.current?.ownerDocument.getElementById(focusId);
        if (next && !next.matches(':disabled')) next.focus();
        else done.current?.focus();
    }, [version]);
    useCommitEffect(() => {
        const active = dialog.current?.ownerDocument.activeElement;
        if (
            inactive &&
            active?.matches(':disabled') &&
            dialog.current?.contains(active)
        )
            done.current?.focus();
    }, [inactive]);

    const update = (success: boolean, focus?: string) => {
        if (!success) {
            if (!draft.current()) setStale(true);
            return;
        }
        if (focus) focusNext.current = focus;
        refresh((value) => value + 1);
    };
    const action = (
        label: string,
        run: () => void,
        key?: string,
        disabled = false
    ) =>
        h(
            'button',
            {
                type: 'button',
                disabled: inactive || disabled,
                onClick: run,
                id: key,
            },
            label
        );
    const editOperand = (
        nodeId: string,
        setting: RuntimeConditionSetting,
        selected: NonNullable<
            ReturnType<typeof resolvePortalVisitorFilterOperator>
        >
    ) => {
        const descriptor = selected.operator.operand;
        if (descriptor.kind === 'none') return null;
        const value = 'value' in setting ? setting.value : undefined;
        const label = { 'aria-label': labels.value, disabled: inactive };
        if (descriptor.kind === 'choice' || descriptor.kind === 'choices') {
            return h(
                'select',
                {
                    ...label,
                    multiple: descriptor.kind === 'choices',
                    value:
                        typeof value === 'string' || Array.isArray(value)
                            ? (value as string | string[])
                            : '',
                    onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                        update(
                            draft.setOperand(
                                nodeId,
                                descriptor.kind === 'choice'
                                    ? event.currentTarget.value
                                    : Array.from(
                                          event.currentTarget.selectedOptions,
                                          (option) => option.value
                                      )
                            )
                        ),
                },
                descriptor.choices.map((option) =>
                    h(
                        'option',
                        { value: option.value, key: option.value },
                        option.label
                    )
                )
            );
        }
        if (descriptor.kind === 'date') {
            return h(
                Suspense,
                { fallback: null },
                h(FilterDateField, {
                    id: `${id}-${nodeId}-date`,
                    sessionId: `${selected.field.id}:${setting.type}`,
                    airtableDateConfig: {
                        type: 'date',
                        options: {
                            dateFormat: {
                                format: descriptor.dateFormat ?? 'YYYY-MM-DD',
                            },
                        },
                    },
                    title: labels.value,
                    calendarLabel: labels.calendar,
                    language,
                    readOnly: inactive,
                    owner: { token: draft, isCurrent: draft.current },
                    value: typeof value === 'string' ? value : null,
                    setValue(date) {
                        const accepted = draft.setOperand(nodeId, date);
                        update(accepted);
                        return accepted;
                    },
                })
            );
        }
        if (descriptor.kind === 'boolean') {
            return h(
                'select',
                {
                    ...label,
                    value: value === true ? 'yes' : 'no',
                    onChange: (event: ChangeEvent<HTMLSelectElement>) =>
                        update(
                            draft.setOperand(
                                nodeId,
                                event.currentTarget.value === 'yes'
                            )
                        ),
                },
                h('option', { value: 'yes' }, labels.yes),
                h('option', { value: 'no' }, labels.no)
            );
        }
        const isTextLength = descriptor.kind === 'text-length';
        const numeric = descriptor.kind === 'number' || isTextLength;
        const edit = (event: SyntheticEvent<HTMLInputElement>) => {
            const input = event.currentTarget;
            const clearedLength =
                isTextLength && input.value === '' && !input.validity.badInput;
            const operand = numeric ? input.valueAsNumber : input.value;
            update(draft.setOperand(nodeId, clearedLength ? 0 : operand));
        };
        return h('input', {
            ...label,
            type: numeric ? 'number' : 'text',
            value:
                typeof value === 'number' || typeof value === 'string'
                    ? value
                    : '',
            onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                    event.preventDefault();
            },
            ...(isTextLength ? { onInput: edit } : { onChange: edit }),
        });
    };
    function editor(
        parent: RuntimeConditionsDefinition | null,
        groupId: string | null
    ): ReactElement {
        const controlsId = `${id}-${groupId ?? 'root'}`;
        const add = (group: boolean) => {
            const created = group
                ? draft.addGroup(groupId)
                : draft.addCondition(groupId);
            update(
                created !== null,
                created === null
                    ? undefined
                    : `${id}-${created}-${group ? 'operator' : 'field'}`
            );
        };
        const nodes = parent?.conditions ?? [];
        return h(
            'div',
            null,
            parent
                ? h(
                      'label',
                      null,
                      labels.logicalOperator,
                      ' ',
                      h(
                          'select',
                          {
                              id: `${controlsId}-operator`,
                              value: parent.logicalOperator,
                              disabled: inactive,
                              onChange: (
                                  event: ChangeEvent<HTMLSelectElement>
                              ) => {
                                  const value = event.currentTarget.value;
                                  if (value === 'and' || value === 'or')
                                      update(
                                          draft.setLogicalOperator(
                                              groupId,
                                              value
                                          )
                                      );
                              },
                          },
                          h('option', { value: 'and' }, labels.all),
                          h('option', { value: 'or' }, labels.any)
                      )
                  )
                : null,
            h(
                'ol',
                null,
                nodes.map((node) => {
                    if (node.type === 'groupCondition')
                        return h(
                            'li',
                            { key: node.id },
                            h(
                                'fieldset',
                                null,
                                h('legend', null, labels.group),
                                draft.canEditGroup(node.id)
                                    ? editor(node, node.id)
                                    : h('p', null, labels.unavailableGroup),
                                action(labels.removeGroup, () =>
                                    update(
                                        draft.remove(node.id),
                                        `${controlsId}-add`
                                    )
                                )
                            )
                        );
                    const setting =
                        draft.settingForEditor(node.id) ?? node.setting;
                    const selected = resolvePortalVisitorFilterOperator(
                        fields,
                        setting
                    );
                    const remove = action(labels.removeCondition, () =>
                        update(draft.remove(node.id), `${controlsId}-add`)
                    );
                    if (!selected)
                        return h(
                            'li',
                            { key: node.id },
                            h('span', null, labels.unavailable),
                            ' ',
                            remove
                        );
                    return h(
                        'li',
                        { key: node.id, style: buttons },
                        h(
                            'label',
                            null,
                            labels.field,
                            ' ',
                            h(
                                'select',
                                {
                                    id: `${id}-${node.id}-field`,
                                    value: selected.field.id,
                                    disabled: inactive,
                                    onChange: (
                                        event: ChangeEvent<HTMLSelectElement>
                                    ) =>
                                        update(
                                            draft.setField(
                                                node.id,
                                                event.currentTarget.value
                                            )
                                        ),
                                },
                                fields.map((field) =>
                                    h(
                                        'option',
                                        { key: field.id, value: field.id },
                                        field.label ?? field.name
                                    )
                                )
                            )
                        ),
                        h(
                            'label',
                            null,
                            labels.operator,
                            ' ',
                            h(
                                'select',
                                {
                                    value: selected.operator.setting.type,
                                    disabled: inactive,
                                    onChange: (
                                        event: ChangeEvent<HTMLSelectElement>
                                    ) => {
                                        const operator =
                                            selected.field.operators.find(
                                                (candidate) =>
                                                    candidate.setting.type ===
                                                    event.currentTarget.value
                                            );
                                        if (operator)
                                            update(
                                                draft.setOperator(
                                                    node.id,
                                                    operator.setting.type
                                                )
                                            );
                                    },
                                },
                                selected.field.operators.map((operator) =>
                                    h(
                                        'option',
                                        {
                                            key: operator.setting.type,
                                            value: operator.setting.type,
                                        },
                                        operator.label
                                    )
                                )
                            )
                        ),
                        editOperand(node.id, setting, selected),
                        remove
                    );
                })
            ),
            fields.length > 0
                ? h(
                      'div',
                      { style: buttons },
                      action(
                          labels.addCondition,
                          () => add(false),
                          `${controlsId}-add`
                      ),
                      action(
                          labels.addGroup,
                          () => add(true),
                          undefined,
                          !draft.canAddGroup(groupId)
                      )
                  )
                : null
        );
    }
    return h(
        'dialog',
        {
            ref: dialog,
            role: 'dialog',
            'aria-labelledby': titleId,
            style: {
                width: 'min(42rem, calc(100% - 2rem))',
                maxHeight: 'calc(100% - 2rem)',
                borderRadius: '0.6rem',
            },
            onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
                event.preventDefault();
                close();
            },
            onPointerDown: (event) => {
                backdrop.current = event.button === 0 && hitsBackdrop(event);
            },
            onPointerCancel: () => {
                backdrop.current = false;
            },
            onClick: (event) => {
                const dismiss = backdrop.current && hitsBackdrop(event);
                backdrop.current = false;
                if (dismiss) close();
            },
        },
        h(
            'header',
            { style: buttons },
            h('h2', { id: titleId, tabIndex: -1, ref: title }, labels.title),
            h('button', { type: 'button', onClick: close }, labels.close)
        ),
        inactive ? h('p', { role: 'status' }, labels.stale) : null,
        editor(criteria, null),
        h(
            'footer',
            { style: buttons },
            criteria
                ? action(labels.clear, () =>
                      update(draft.clear(), `${id}-root-add`)
                  )
                : null,
            h(
                'button',
                { type: 'button', onClick: close, ref: done },
                labels.done
            )
        )
    );
}

/** Portable advanced Filter. The host remains the sole owner of writes and reads. */
export function PortalVisitorFilter(
    props: PortalVisitorFilterProps
): ReactElement {
    const labels = { ...defaultLabels, ...props.labels };
    const [active, setActive] = useState<Open | null>(null);
    const [quick, setQuick] = useState<Open | null>(null);
    const [status, setStatus] = useState<Status | null>(null);
    const occupied = useRef<Open | null>(null);
    const inFlight = useRef<Open | null>(null);
    const quickGesture = useRef<QuickGesture | null>(null);
    const heldQuickKey = useRef<HeldQuickKey | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const quickId = useId();
    const owner = useRef(props.port);
    const notify = useRef(props.onOutcome);
    useCommitEffect(() => {
        notify.current = props.onOutcome;
    }, [props.onOutcome]);
    useCommitEffect(() => {
        owner.current = props.port;
        setStatus(null);
        return () => {
            const old = occupied.current;
            occupied.current = null;
            inFlight.current = null;
            old?.draft.retire();
            quickGesture.current = null;
            heldQuickKey.current = null;
        };
    }, [props.port]);
    useCommitEffect(() => {
        if (!props.showDropdowns) {
            setQuick(null);
            quickGesture.current = null;
            heldQuickKey.current = null;
            return;
        }
        const refresh = () => setQuick(readFilterDraft(props.port));
        const unsubscribe = props.port.subscribe(refresh);
        refresh();
        return unsubscribe;
    }, [props.port, props.showDropdowns]);
    useCommitEffect(() => {
        if (active && active.port !== props.port) setActive(null);
        if (active && props.disabled) active.draft.retire();
    }, [active, props.disabled, props.port]);
    useCommitEffect(() => {
        if (!props.disabled) return;
        quickGesture.current = null;
        heldQuickKey.current = null;
    }, [props.disabled]);
    useCommitEffect(() => {
        if (
            !status?.owner ||
            status.owner.port !== props.port ||
            !status.outcome
        )
            return;
        const { owner: shown, outcome } = status;
        const revalidate = () => {
            if (!shown.draft.canReport(outcome))
                setStatus((value) => (value === status ? null : value));
        };
        const unsubscribe = shown.port.subscribe(revalidate);
        revalidate();
        return unsubscribe;
    }, [props.port, status]);
    const open = () => {
        if (occupied.current || inFlight.current || props.disabled) return;
        const shown = readFilterDraft(props.port);
        if (!shown) {
            setStatus({ type: 'refused' });
            return;
        }
        occupied.current = shown;
        setStatus(null);
        setActive(shown);
    };
    const submit = (shown: Open, held?: HeldQuickKey) => {
        inFlight.current = shown;
        setStatus({ type: 'pending' });
        void shown.draft.commit().then((outcome) => {
            if (inFlight.current !== shown || owner.current !== shown.port)
                return;
            inFlight.current = null;
            if (props.showDropdowns) setQuick(readFilterDraft(shown.port));
            const current = shown.draft.canReport(outcome);
            if (held && heldQuickKey.current === held) {
                const resumed = current
                    ? shown.draft.resumeAfterAllocation()
                    : null;
                heldQuickKey.current = resumed
                    ? { ...held, shown: { port: shown.port, draft: resumed } }
                    : null;
            }
            if (!current) {
                setStatus({ type: 'stale' });
                return;
            }
            setStatus(
                outcome.type === 'refused' || outcome.type === 'uncertain'
                    ? { type: outcome.type, owner: shown, outcome }
                    : { type: outcome.type }
            );
            notify.current?.(outcome);
        });
    };
    const close = (shown: Open) => {
        if (occupied.current !== shown) return;
        occupied.current = null;
        setActive(null);
        if (props.disabled) shown.draft.retire();
        submit(shown);
    };
    const applyDropdown = (fieldId: string, values: string[]) => {
        const gesture = quickGesture.current;
        quickGesture.current = null;
        if (
            !gesture ||
            gesture.fieldId !== fieldId ||
            gesture.shown.port !== owner.current ||
            occupied.current ||
            inFlight.current ||
            props.disabled
        )
            return false;
        const { shown } = gesture;
        if (!shown.draft.current()) {
            if (gesture.held && heldQuickKey.current === gesture.held)
                heldQuickKey.current = null;
            setStatus({ type: 'stale' });
            return false;
        }
        if (!shown.draft.setDropdown(fieldId, values)) return false;
        submit(shown, gesture.held);
        return true;
    };
    const renderDropdowns = (shown: Open) => {
        const dropdowns = shown.draft.dropdowns();
        if (!dropdowns.length) return null;
        return h(
            'div',
            {
                role: 'group',
                'aria-label': labels.quickFilters,
                style: buttons,
            },
            dropdowns.map(({ fieldId, label, multiple, choices, selected }) => {
                const selectId = `${quickId}-${fieldId}`;
                const remember = () => {
                    quickGesture.current = { fieldId, shown };
                };
                const gestureEvents = {
                    onFocus: remember,
                    onPointerDown: (event: PointerEvent) => {
                        if (event.button !== 0) return;
                        heldQuickKey.current = null;
                        remember();
                    },
                };
                return h(
                    'div',
                    { key: fieldId },
                    h(
                        'label',
                        null,
                        label,
                        ' ',
                        h(
                            'select',
                            {
                                ...gestureEvents,
                                id: selectId,
                                onKeyDown: (
                                    event: KeyboardEvent<HTMLSelectElement>
                                ) => {
                                    if (event.repeat) {
                                        const held = heldQuickKey.current;
                                        quickGesture.current =
                                            held?.fieldId === fieldId &&
                                            held.key === event.key
                                                ? {
                                                      fieldId,
                                                      shown: held.shown,
                                                      held,
                                                  }
                                                : null;
                                        return;
                                    }
                                    if (
                                        selectKeys.has(event.key) ||
                                        (event.key.length === 1 &&
                                            !event.ctrlKey &&
                                            !event.metaKey &&
                                            !event.altKey)
                                    ) {
                                        const held = {
                                            fieldId,
                                            key: event.key,
                                            shown,
                                        };
                                        heldQuickKey.current = held;
                                        quickGesture.current = {
                                            fieldId,
                                            shown,
                                            held,
                                        };
                                    }
                                },
                                onKeyUp: (
                                    event: KeyboardEvent<HTMLSelectElement>
                                ) => {
                                    const held = heldQuickKey.current;
                                    if (
                                        held?.fieldId === fieldId &&
                                        held.key === event.key
                                    )
                                        heldQuickKey.current = null;
                                },
                                onBlur: () => {
                                    if (
                                        heldQuickKey.current?.fieldId ===
                                        fieldId
                                    )
                                        heldQuickKey.current = null;
                                    if (
                                        quickGesture.current?.fieldId ===
                                        fieldId
                                    )
                                        quickGesture.current = null;
                                },
                                multiple,
                                value: multiple
                                    ? [...selected]
                                    : (selected[0] ?? ''),
                                disabled: props.disabled,
                                'aria-disabled':
                                    Boolean(inFlight.current) || undefined,
                                onChange: (
                                    event: ChangeEvent<HTMLSelectElement>
                                ) => {
                                    const input = event.currentTarget;
                                    const values = multiple
                                        ? Array.from(input.options)
                                              .filter(
                                                  (option) => option.selected
                                              )
                                              .map((option) => option.value)
                                        : input.value
                                          ? [input.value]
                                          : [];
                                    applyDropdown(fieldId, values);
                                },
                            },
                            !multiple
                                ? h('option', { value: '' }, labels.allValues)
                                : null,
                            selected
                                .filter(
                                    (value) =>
                                        !choices.some(
                                            (choice) => choice.value === value
                                        )
                                )
                                .map((value) =>
                                    h(
                                        'option',
                                        { key: value, value, disabled: true },
                                        labels.unavailable
                                    )
                                ),
                            choices.map((choice) =>
                                h(
                                    'option',
                                    { key: choice.value, value: choice.value },
                                    choice.label
                                )
                            )
                        )
                    ),
                    multiple
                        ? h(
                              'button',
                              {
                                  ...gestureEvents,
                                  onKeyDown: (
                                      event: KeyboardEvent<HTMLButtonElement>
                                  ) => {
                                      if (
                                          !event.repeat &&
                                          (event.key === 'Enter' ||
                                              event.key === ' ')
                                      )
                                          remember();
                                  },
                                  type: 'button',
                                  disabled: props.disabled || !selected.length,
                                  'aria-disabled':
                                      Boolean(inFlight.current) || undefined,
                                  'aria-label': `${labels.clear} ${label}`,
                                  onClick: (
                                      event: MouseEvent<HTMLButtonElement>
                                  ) => {
                                      if (applyDropdown(fieldId, []))
                                          event.currentTarget.ownerDocument
                                              .getElementById(selectId)
                                              ?.focus();
                                  },
                              },
                              labels.clear
                          )
                        : null
                );
            })
        );
    };
    const type = status?.type;
    const feedback =
        type === 'refused' || type === 'uncertain' || type === 'stale'
            ? labels[type]
            : null;
    return h(
        'div',
        { className: props.className, style: props.style },
        h(
            'button',
            {
                type: 'button',
                ref: trigger,
                'aria-haspopup': 'dialog',
                disabled: props.disabled,
                'aria-disabled':
                    inFlight.current?.port === props.port || undefined,
                onClick: open,
            },
            labels.trigger
        ),
        props.showDropdowns && quick?.port === props.port
            ? renderDropdowns(quick)
            : null,
        feedback ? h('p', { role: 'status' }, feedback) : null,
        active?.port === props.port
            ? h(FilterDialog, {
                  shown: active,
                  labels,
                  language: props.language ?? 'en',
                  opener: trigger,
                  disabled: props.disabled === true,
                  close: () => close(active),
              })
            : null
    );
}
