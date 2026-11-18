import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type MouseEvent,
    type ReactElement,
    type SyntheticEvent,
} from 'react';
import {
    createPortalVisitorSortDraft,
    type PortalVisitorSortOutcome,
    type PortalVisitorSortPort,
    type PortalVisitorSortRule,
} from '../portals/visitorSort.js';

const defaultLabels = {
    trigger: 'Sort',
    title: 'Sort records',
    add: 'Add sort condition',
    done: 'Done',
    close: 'Close',
    field: 'Field',
    direction: 'Direction',
    ascending: 'Ascending',
    descending: 'Descending',
    remove: 'Delete sort condition',
    unavailable: 'This sort field is unavailable.',
    stale: 'The view or sort fields changed. Open Sort again to edit the current rules.',
    refused: 'The current view could not apply these sort rules.',
    uncertain:
        'Sort submission could not be confirmed. Check the current view before trying again.',
};

export type PortalVisitorSortLabels = Partial<typeof defaultLabels>;

export type PortalVisitorSortProps = {
    port: PortalVisitorSortPort;
    disabled?: boolean;
    labels?: PortalVisitorSortLabels;
    className?: string;
    style?: CSSProperties;
    onOutcome?(outcome: PortalVisitorSortOutcome): void;
};

type Draft = NonNullable<ReturnType<typeof createPortalVisitorSortDraft>>;
type Open = { port: PortalVisitorSortPort; draft: Draft };
type Labels = typeof defaultLabels;
const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

const panelStyle: CSSProperties = {
    width: 'min(36rem, calc(100% - 2rem))',
    maxHeight: 'calc(100% - 2rem)',
    padding: 0,
    borderRadius: '0.6rem',
};
const buttonRow: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.5rem',
};

function containTab(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const dialog = event.currentTarget;
    const active = dialog.ownerDocument.activeElement;
    if (active?.closest('dialog') !== dialog) return;
    const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled),select:not(:disabled)'
        )
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last || active !== (event.shiftKey ? first : last)) return;
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
}

function SortDialog({
    active,
    labels,
    close,
    opener,
    disabled,
}: {
    active: Open;
    labels: Labels;
    close(): void;
    opener: { readonly current: HTMLButtonElement | null };
    disabled: boolean;
}) {
    const { draft, port } = active;
    const dialog = useRef<HTMLDialogElement>(null);
    const title = useRef<HTMLHeadingElement>(null);
    const add = useRef<HTMLButtonElement>(null);
    const done = useRef<HTMLButtonElement>(null);
    const [stale, setStale] = useState(false);
    const [version, refresh] = useState(0);
    const wantedFocus = useRef<string | null>(null);
    const startedOutside = useRef(false);
    const id = useId();
    const titleId = id + '-title';
    const { rules, canAdd } = draft.snapshot();
    const inactive = disabled || stale;
    const controlId = (key: number, control: string) =>
        `${id}-${key}-${control}`;

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
            const document = node.ownerDocument;
            const focusedInside = node.contains(document.activeElement);
            if (node.open) node.close();
            if (
                focusedInside &&
                opener.current?.isConnected &&
                document.activeElement === document.body
            )
                opener.current.focus();
        };
    }, [draft, opener, port]);
    useCommitEffect(() => {
        const focusId = wantedFocus.current;
        if (focusId === null) return;
        wantedFocus.current = null;
        const node = dialog.current?.ownerDocument.getElementById(focusId);
        if (node && !node.matches(':disabled')) node.focus();
        else if (add.current && !add.current.disabled) add.current.focus();
        else done.current?.focus();
    }, [version]);
    useCommitEffect(() => {
        const node = dialog.current;
        const focused = node?.ownerDocument.activeElement;
        if (
            inactive &&
            focused?.matches(':disabled') &&
            node?.contains(focused)
        )
            done.current?.focus();
    }, [inactive]);

    const update = (changed: boolean, focus?: string) => {
        if (!changed) {
            if (!draft.current()) setStale(true);
            return;
        }
        if (focus) wantedFocus.current = focus;
        refresh((value) => value + 1);
    };
    const renderRule = (rule: PortalVisitorSortRule, index: number) => {
        const number = index + 1;
        return h(
            'li',
            { key: rule.key, style: buttonRow },
            rule.fieldId === null
                ? h('span', { role: 'status' }, labels.unavailable)
                : h(
                      'label',
                      null,
                      labels.field,
                      ' ',
                      h(
                          'select',
                          {
                              id: controlId(rule.key, 'field'),
                              value: rule.fieldId,
                              disabled: inactive,
                              'aria-label': `${labels.field} ${number}`,
                              onChange: (
                                  event: SyntheticEvent<HTMLSelectElement>
                              ) =>
                                  update(
                                      draft.setField(
                                          rule.key,
                                          event.currentTarget.value
                                      )
                                  ),
                          },
                          rule.availableFields.map((field) =>
                              h(
                                  'option',
                                  { key: field.id, value: field.id },
                                  field.label ?? field.name
                              )
                          )
                      )
                  ),
            rule.fieldId === null
                ? null
                : h(
                      'label',
                      null,
                      labels.direction,
                      ' ',
                      h(
                          'select',
                          {
                              value: rule.direction,
                              disabled: inactive,
                              'aria-label': `${labels.direction} ${number}`,
                              onChange: (
                                  event: SyntheticEvent<HTMLSelectElement>
                              ) => {
                                  const direction = event.currentTarget.value;
                                  if (
                                      direction === 'asc' ||
                                      direction === 'desc'
                                  )
                                      update(
                                          draft.setDirection(
                                              rule.key,
                                              direction
                                          )
                                      );
                              },
                          },
                          h('option', { value: 'asc' }, labels.ascending),
                          h('option', { value: 'desc' }, labels.descending)
                      )
                  ),
            h(
                'button',
                {
                    type: 'button',
                    id: controlId(rule.key, 'remove'),
                    disabled: inactive,
                    'aria-label': `${labels.remove} ${number}`,
                    onClick: () => {
                        const neighbor = rules[index + 1] ?? rules[index - 1];
                        update(
                            draft.remove(rule.key),
                            neighbor
                                ? controlId(neighbor.key, 'remove')
                                : id + '-add'
                        );
                    },
                },
                labels.remove
            )
        );
    };
    return h(
        'dialog',
        {
            ref: dialog,
            style: panelStyle,
            'aria-labelledby': titleId,
            onKeyDown: containTab,
            onCancel: (event: SyntheticEvent) => {
                event.preventDefault();
                close();
            },
            onPointerDown: (event: MouseEvent<HTMLDialogElement>) => {
                startedOutside.current = event.target === event.currentTarget;
            },
            onClick: (event: MouseEvent<HTMLDialogElement>) => {
                const outside =
                    startedOutside.current &&
                    event.target === event.currentTarget;
                startedOutside.current = false;
                if (outside) close();
            },
        },
        h(
            'div',
            { style: { padding: '1rem' } },
            h(
                'header',
                { style: buttonRow },
                h(
                    'h2',
                    { id: titleId, tabIndex: -1, ref: title },
                    labels.title
                ),
                h('button', { type: 'button', onClick: close }, labels.close)
            ),
            inactive ? h('p', { role: 'status' }, labels.stale) : null,
            h('ol', null, rules.map(renderRule)),
            h(
                'footer',
                { style: buttonRow },
                h(
                    'button',
                    {
                        type: 'button',
                        ref: add,
                        id: id + '-add',
                        disabled: inactive || !canAdd,
                        onClick: () => {
                            const key = draft.add();
                            update(
                                key !== null,
                                key === null
                                    ? undefined
                                    : controlId(key, 'field')
                            );
                        },
                    },
                    labels.add
                ),
                h(
                    'button',
                    { type: 'button', ref: done, onClick: close },
                    labels.done
                )
            )
        )
    );
}

/** The packaged visitor dialog. The supplied host owns writes, reads and receipts. */
export function PortalVisitorSort(props: PortalVisitorSortProps): ReactElement {
    const labels = { ...defaultLabels, ...props.labels };
    const [active, setActive] = useState<Open | null>(null);
    const [status, setStatus] = useState<
        PortalVisitorSortOutcome['type'] | null
    >(null);
    const occupied = useRef<Open | null>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const inFlight = useRef<Open | null>(null);
    const lifetime = useRef(0);
    const host = useRef(props.port);
    useCommitEffect(() => {
        host.current = props.port;
        setStatus(null);
        return () => {
            lifetime.current++;
            const previous = occupied.current;
            occupied.current = null;
            inFlight.current = null;
            previous?.draft.retire();
        };
    }, [props.port]);
    useCommitEffect(() => {
        if (active && active.port !== props.port) setActive(null);
        if (active && props.disabled) active.draft.retire();
    }, [active, props.disabled, props.port]);

    const open = () => {
        if (occupied.current || inFlight.current || props.disabled) return;
        const draft = createPortalVisitorSortDraft(props.port);
        if (!draft) {
            setStatus('refused');
            return;
        }
        lifetime.current++;
        const next = { port: props.port, draft };
        occupied.current = next;
        setStatus(null);
        setActive(next);
    };
    const close = (shown: Open) => {
        if (occupied.current !== shown) return;
        occupied.current = null;
        inFlight.current = shown;
        setActive(null);
        if (props.disabled) shown.draft.retire();
        const token = lifetime.current;
        void shown.draft.commit().then((outcome) => {
            if (
                lifetime.current !== token ||
                host.current !== shown.port ||
                inFlight.current !== shown
            )
                return;
            inFlight.current = null;
            if (!shown.draft.canReport(outcome)) {
                setStatus('stale');
                return;
            }
            setStatus(outcome.type);
            props.onOutcome?.(outcome);
        });
    };
    const feedback =
        status === 'stale' || status === 'refused' || status === 'uncertain'
            ? labels[status]
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
                'aria-disabled':
                    inFlight.current?.port === props.port || undefined,
                disabled: props.disabled,
                onClick: open,
            },
            labels.trigger
        ),
        feedback ? h('p', { role: 'status' }, feedback) : null,
        active?.port === props.port
            ? h(SortDialog, {
                  active,
                  labels,
                  opener: trigger,
                  disabled: props.disabled === true,
                  close: () => close(active),
              })
            : null
    );
}
