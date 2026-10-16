import {
    createElement as h,
    useContext,
    useEffect,
    useId,
    useRef,
    useState,
    type ChangeEvent,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type { FieldRendererProps } from '../ui/rendererRegistry.js';
import { portalLinkedPills } from '../ui/portalLinkedPills.js';
import { FieldRendererSource } from './fieldRendererSource.js';

export type LinkedRecordsFieldOptions = {
    /** Optional wrapper class; default styles are component-specific. */
    className?: string;
};

type Props = FieldRendererProps<'multipleRecordLinks'>;
const stop = (event: SyntheticEvent) => event.stopPropagation();
const masked = (config: unknown): boolean =>
    config !== null &&
    typeof config === 'object' &&
    (('obscurePassword' in config && config.obscurePassword === true) ||
        ('maskPasswordOnLoginScreen' in config &&
            config.maskPasswordOnLoginScreen === true));

/** Never recover a filtered selected label from candidates or cached option names. */
function selectedLabels(props: Props): readonly (string | null)[] {
    const value = props.value ?? [];
    const linked = props.linkedRecords;
    if (!linked) return value.map(() => null);
    if (linked.source === 'portal-pills')
        return value.map(
            (_, index) =>
                linked.items.find((item) => item.nativeIndex === index)
                    ?.label ?? null
        );
    const state = linked.state;
    const primary = state.table?.airtableFields.filter(
        (field) => field.isPrimaryField
    );
    const details = state.detailFields?.filter(
        (detail) => detail.fieldId === primary?.[0]?.id
    );
    if (
        !state.selectedPolicy.supported ||
        state.phase === 'retired' ||
        state.phase === 'unavailable' ||
        state.detailProjection !== 'present' ||
        primary?.length !== 1 ||
        details?.length !== 1 ||
        details[0].isHidden ||
        masked(details[0].miniExtConfig) ||
        props.field.config.type !== 'multipleRecordLinks' ||
        state.linkedTableId !== props.field.config.options.linkedTableId
    )
        return value.map(() => null);
    // Reuse the existing primary formatter and ambiguity guards on the already
    // filtered owner projection. No rich/nested fields are rendered here.
    return portalLinkedPills({
        field: props.field,
        originalValue: value,
        value,
        tables: {
            [state.linkedTableId]: {
                airtableFields: [...state.table!.airtableFields],
                recordIdsToAirtableRecords: Object.fromEntries(
                    state.selectedRecords.map((record) => [record.id, record])
                ),
            },
        },
    }).items.map((item) => item.label);
}

/** Borrowed presentation and actions only; no model, hydration effect or Save. */
function LinkedRecordsControl({
    field: props,
    className,
}: LinkedRecordsFieldOptions & { field: Props }): ReactNode {
    const id = useId();
    // Direct slots have no accepted owner identity. Any new props retire local
    // operation feedback, even when the caller returns to an earlier object.
    const source = useContext(FieldRendererSource) ?? props;
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
    const current = () => mounted.current && lifetime.current.token === token;
    const [operation, setOperation] = useState({
        token,
        pending: false,
        failed: false,
    });
    if (operation.token !== token)
        setOperation({ token, pending: false, failed: false });
    const flight = useRef<{ token: object; ticket: object } | null>(null);
    if (flight.current?.token !== token) flight.current = null;
    const busy = operation.token === token && operation.pending;
    const run = (action: () => Promise<unknown>) => {
        if (!current() || busy || flight.current?.token === token) return;
        const ticket = {};
        flight.current = { token, ticket };
        setOperation({ token, pending: true, failed: false });
        const finish = (failed: boolean) => {
            if (current() && flight.current?.ticket === ticket) {
                flight.current = null;
                setOperation({ token, pending: false, failed });
            }
        };
        try {
            void action().then(
                () => finish(false),
                () => finish(true)
            );
        } catch {
            finish(true);
        }
    };
    const title = props.title.trim() ? props.title : props.field.name;
    const password = masked(props.displayConfig) || masked(props.writeConfig);
    const selection =
        props.capability.type === 'editable'
            ? props.capability.selection
            : undefined;
    const state = selection?.state;
    const readOnly = [props.displayConfig, props.writeConfig].some(
        (config) => config && 'readOnly' in config && config.readOnly === true
    );
    const disabled =
        !selection ||
        readOnly ||
        props.computed ||
        props.pending ||
        state?.disabled === true ||
        state?.readOnly === true ||
        state?.loading === true ||
        busy;
    const form =
        props.linkedRecords?.source === 'form'
            ? props.linkedRecords
            : undefined;
    const readDisabled =
        props.pending ||
        busy ||
        form?.state.pending === true ||
        form?.state.phase === 'retired' ||
        form?.state.phase === 'unavailable';
    const value = props.value ?? [];
    const labels = selectedLabels(props);
    // Feedback may contain native IDs or filtered labels; keep it generic even
    // on unmasked fields. The owner retains detailed validation diagnostics.
    const failed =
        props.error ||
        props.validation.length ||
        state?.error ||
        form?.state.error ||
        (operation.token === token && operation.failed);
    const feedback = failed
        ? 'Linked records could not be updated. Review the field and try again.'
        : busy || state?.loading || form?.state.pending
          ? 'Loading linked records…'
          : '';
    const showTitle = !(
        props.displayConfig &&
        'showTitle' in props.displayConfig &&
        props.displayConfig.showTitle === false
    );
    return h(
        'fieldset',
        {
            className: ['mx-sdk-linked-records-field', className]
                .filter(Boolean)
                .join(' '),
            'aria-label': showTitle ? undefined : title,
            'aria-describedby': feedback ? `${id}-feedback` : undefined,
            'aria-invalid': Boolean(failed),
            'aria-busy': Boolean(
                busy || props.pending || state?.loading || form?.state.pending
            ),
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
            onKeyDown: stop,
            onKeyUp: stop,
            onChange: stop,
        },
        showTitle ? h('legend', null, title) : null,
        h(
            'ul',
            {
                className: 'mx-sdk-linked-records-values',
                'aria-label': `${title} selected records`,
            },
            ...value.map((nativeId, index) =>
                h(
                    'li',
                    { key: `${index}:${nativeId}` },
                    h(
                        'span',
                        null,
                        password
                            ? '••••'
                            : (labels[index] ?? 'Linked record unavailable')
                    ),
                    h(
                        'button',
                        {
                            type: 'button',
                            disabled,
                            'aria-label': `Remove selected record ${index + 1}`,
                            onClick: () => {
                                if (current() && !disabled)
                                    selection?.choose(
                                        value.filter((id) => id !== nativeId)
                                    );
                            },
                        },
                        '×'
                    )
                )
            )
        ),
        value.length === 0 ? h('span', null, 'No linked records') : null,
        h(
            'button',
            {
                type: 'button',
                disabled: disabled || value.length === 0,
                onClick: () => {
                    if (current() && !disabled && value.length)
                        selection?.clear();
                },
            },
            'Clear'
        ),
        form
            ? h(
                  'button',
                  {
                      type: 'button',
                      disabled: readDisabled,
                      onClick: () => {
                          if (!readDisabled) run(form.readSelected);
                      },
                  },
                  'Load selected'
              )
            : null,
        selection
            ? h(
                  'div',
                  { className: 'mx-sdk-linked-records-search' },
                  h(
                      'label',
                      { htmlFor: `${id}-search` },
                      'Search linked records'
                  ),
                  h('input', {
                      id: `${id}-search`,
                      type: password ? 'password' : 'text',
                      autoComplete: 'off',
                      spellCheck: false,
                      value: state!.searchTerm,
                      disabled,
                      onChange: (event: ChangeEvent<HTMLInputElement>) => {
                          if (current() && !disabled)
                              selection.setSearchInput(
                                  event.currentTarget.value
                              );
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
                          disabled,
                          onClick: () => {
                              if (!disabled) run(selection.reload);
                          },
                      },
                      'Search'
                  ),
                  h(
                      'ul',
                      {
                          className: 'mx-sdk-linked-records-options',
                          'aria-label': `${title} search results`,
                      },
                      ...state!.options
                          .filter((option) => !value.includes(option.value))
                          .map((option, index) =>
                              h(
                                  'li',
                                  { key: option.value },
                                  h(
                                      'button',
                                      {
                                          type: 'button',
                                          disabled:
                                              disabled ||
                                              option.disabled === true,
                                          'aria-label': password
                                              ? `Select masked record ${index + 1}`
                                              : undefined,
                                          onClick: () => {
                                              if (
                                                  current() &&
                                                  !disabled &&
                                                  !option.disabled
                                              )
                                                  selection.choose(
                                                      state!.multiple
                                                          ? [
                                                                ...value,
                                                                option.value,
                                                            ]
                                                          : [option.value]
                                                  );
                                          },
                                      },
                                      password
                                          ? '••••'
                                          : option.label.trim() &&
                                              option.label !== option.value
                                            ? option.label
                                            : 'Unnamed linked record'
                                  )
                              )
                          )
                  ),
                  h(
                      'button',
                      {
                          type: 'button',
                          disabled: disabled || !state!.offset,
                          onClick: () => {
                              if (!disabled && state!.offset)
                                  run(selection.loadMore);
                          },
                      },
                      'Load more'
                  )
              )
            : null,
        h(
            'span',
            {
                id: `${id}-feedback`,
                className: 'mx-sdk-linked-records-feedback',
                role: 'status',
                'aria-live': 'polite',
            },
            feedback
        )
    );
}

/** Bounded Linked Records slot for existing Form, Grid and List hosts. */
export function renderMultipleRecordLinksField(
    props: Props,
    options: LinkedRecordsFieldOptions = {}
): ReactNode {
    return h(LinkedRecordsControl, { field: props, ...options });
}
