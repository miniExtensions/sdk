import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type ChangeEvent,
    type CSSProperties,
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
} from '../runtime/types.js';

const defaultLabels = {
    trigger: 'Filter',
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
    labels?: PortalVisitorFilterLabels;
    className?: string;
    style?: CSSProperties;
    onOutcome?(outcome: PortalVisitorFilterOutcome): void;
};
type Draft = NonNullable<ReturnType<typeof createPortalVisitorFilterDraft>>;
type Open = { port: PortalVisitorFilterPort; draft: Draft };
type Status = {
    type: PortalVisitorFilterOutcome['type'];
    owner?: Open;
    outcome?: PortalVisitorFilterOutcome;
};
const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;
const buttons: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.5rem',
};

function FilterDialog({
    shown,
    labels,
    disabled,
    close,
    opener,
}: {
    shown: Open;
    labels: Labels;
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
        descriptor: NonNullable<
            ReturnType<typeof resolvePortalVisitorFilterOperator>
        >['operator']['operand']
    ) => {
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
        return h('input', {
            ...label,
            type: descriptor.kind,
            value:
                typeof value === 'number' || typeof value === 'string'
                    ? value
                    : '',
            onChange: (event: ChangeEvent<HTMLInputElement>) =>
                update(
                    draft.setOperand(
                        nodeId,
                        descriptor.kind === 'number'
                            ? event.currentTarget.valueAsNumber
                            : event.currentTarget.value
                    )
                ),
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
                        editOperand(
                            node.id,
                            setting,
                            selected.operator.operand
                        ),
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
                backdrop.current = event.target === event.currentTarget;
            },
            onClick: (event) => {
                const dismiss =
                    backdrop.current && event.target === event.currentTarget;
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
    const [status, setStatus] = useState<Status | null>(null);
    const occupied = useRef<Open | null>(null);
    const inFlight = useRef<Open | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
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
        };
    }, [props.port]);
    useCommitEffect(() => {
        if (active && active.port !== props.port) setActive(null);
        if (active && props.disabled) active.draft.retire();
    }, [active, props.disabled, props.port]);
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
        const draft = createPortalVisitorFilterDraft(props.port);
        if (!draft) {
            setStatus({ type: 'refused' });
            return;
        }
        const shown = { port: props.port, draft };
        occupied.current = shown;
        setStatus(null);
        setActive(shown);
    };
    const close = (shown: Open) => {
        if (occupied.current !== shown) return;
        occupied.current = null;
        inFlight.current = shown;
        setActive(null);
        if (props.disabled) shown.draft.retire();
        void shown.draft.commit().then((outcome) => {
            if (inFlight.current !== shown || owner.current !== shown.port)
                return;
            inFlight.current = null;
            if (!shown.draft.canReport(outcome)) {
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
        feedback ? h('p', { role: 'status' }, feedback) : null,
        active?.port === props.port
            ? h(FilterDialog, {
                  shown: active,
                  labels,
                  opener: trigger,
                  disabled: props.disabled === true,
                  close: () => close(active),
              })
            : null
    );
}
