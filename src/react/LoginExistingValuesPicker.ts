import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
    type ReactElement,
    type ReactNode,
} from 'react';
import { createSelectionModel } from '../ui/model.js';
import type {
    SelectionModel,
    SelectionRequest,
    SelectionState,
} from '../ui/types.js';

export type LoginExistingValuesOwner = Readonly<{
    extensionSessionId: string;
    extensionId: string;
    fieldId: string;
    viewMode: 'draft' | 'published';
}>;

export type LoginExistingValuesRequest = SelectionRequest &
    LoginExistingValuesOwner;

export type LoginExistingValuesPage = {
    labels: readonly string[];
    offset: string | null;
};

export type LoginExistingValuesLabels = {
    open: string;
    title: string;
    close: string;
    search: string;
    blank: string;
    loading: string;
    empty: string;
    error: string;
    retry: string;
    more: string;
};

export type LoginExistingValuesPickerProps = {
    owner: LoginExistingValuesOwner;
    allowSearchFromExistingValuesInLogin?: boolean;
    maskPasswordOnLoginScreen?: boolean;
    disabled?: boolean;
    loadOptions(
        request: LoginExistingValuesRequest
    ): Promise<LoginExistingValuesPage>;
    /** Receives the original data label, including whitespace or an empty string. */
    onSelect(label: string): void;
    labels?: Partial<LoginExistingValuesLabels>;
    /** Host action rendered beside the dialog title. */
    titleAction?: ReactNode;
    className?: string;
};

const defaultLabels: LoginExistingValuesLabels = {
    open: 'Find an existing value',
    title: 'Existing values',
    close: 'Close',
    search: 'Search existing values',
    blank: 'Blank value',
    loading: 'Loading values…',
    empty: 'No matching values.',
    error: 'Could not load values.',
    retry: 'Retry',
    more: 'Load more',
};

type Lookup = {
    model: SelectionModel;
    unsubscribe: () => void;
    timer: ReturnType<typeof setTimeout> | null;
};

type LookupView = { lookup: Lookup; state: SelectionState };

function cancelDelay(lookup: Lookup) {
    if (lookup.timer !== null) {
        clearTimeout(lookup.timer);
        lookup.timer = null;
    }
}

function retire(active: { current: Lookup | null }, lookup: Lookup) {
    if (active.current !== lookup) return false;
    active.current = null;
    cancelDelay(lookup);
    lookup.unsubscribe();
    lookup.model.destroy();
    return true;
}

function Picker(props: LoginExistingValuesPickerProps) {
    const id = useId();
    const trigger = useRef<HTMLButtonElement>(null);
    const search = useRef<HTMLInputElement>(null);
    const active = useRef<Lookup | null>(null);
    const callbacks = useRef(props);
    const [view, setView] = useState<LookupView | null>(null);
    const labels = { ...defaultLabels, ...props.labels };
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const openedLookup = view?.lookup;
    const loading =
        view !== null && (view.state.loading || view.lookup.timer !== null);

    useCommittedEffect(() => {
        callbacks.current = props;
    });
    useCommittedEffect(() => {
        return () => {
            if (active.current) retire(active, active.current);
        };
    }, []);
    useCommittedEffect(() => {
        if (openedLookup) search.current?.focus();
    }, [openedLookup]);

    function close(lookup: Lookup) {
        if (!retire(active, lookup)) return;
        setView(null);
        trigger.current?.focus();
    }

    function open() {
        if (props.disabled || active.current) return;
        const owner = { ...props.owner };
        let occurrence = 0;
        const lookup: Lookup = {
            timer: null,
            unsubscribe: () => {},
            model: createSelectionModel({
                readOnly: true,
                async loadOptions(request) {
                    const page = await callbacks.current.loadOptions({
                        ...owner,
                        ...request,
                    });
                    if (request.signal.aborted || active.current !== lookup)
                        return { options: [], offset: null };
                    return {
                        options: page.labels.map((label) => ({
                            // A label can occur repeatedly in one page or across
                            // pages. Its occurrence key is never a draft value.
                            value: String(++occurrence),
                            label,
                        })),
                        offset: page.offset,
                    };
                },
            }),
        };
        active.current = lookup;
        lookup.unsubscribe = lookup.model.subscribe((state) => {
            if (active.current === lookup) setView({ lookup, state });
        });
        void lookup.model.reload();
    }

    function changeQuery(lookup: Lookup, query: string) {
        if (active.current !== lookup) return;
        cancelDelay(lookup);
        lookup.timer = setTimeout(() => {
            lookup.timer = null;
            if (active.current === lookup) void lookup.model.reload();
        }, 500);
        lookup.model.setSearchInput(query);
    }

    function load(lookup: Lookup, append: boolean) {
        if (
            active.current !== lookup ||
            lookup.timer !== null ||
            lookup.model.getState().loading
        )
            return;
        if (append) void lookup.model.loadMore();
        else void lookup.model.reload();
    }

    function choose(lookup: Lookup, occurrence: string) {
        if (active.current !== lookup) return;
        const option = lookup.model
            .getState()
            .options.find(({ value }) => value === occurrence);
        if (!option) return;
        close(lookup);
        callbacks.current.onSelect(option.label);
    }

    function handleDialogKey(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key === 'Escape' && view) {
            event.preventDefault();
            event.stopPropagation();
            close(view.lookup);
        }
    }

    const panel = view
        ? h(
              'div',
              {
                  id: `${id}-panel`,
                  role: 'dialog',
                  'aria-labelledby': `${id}-title`,
                  className: 'mx-sdk-login-values-panel',
                  onKeyDown: handleDialogKey,
              },
              h(
                  'div',
                  { className: 'mx-sdk-login-values-header' },
                  h('div', { id: `${id}-title` }, labels.title),
                  props.titleAction,
                  h(
                      'button',
                      { type: 'button', onClick: () => close(view.lookup) },
                      labels.close
                  )
              ),
              h('label', { htmlFor: `${id}-search` }, labels.search),
              h('input', {
                  type: 'search',
                  id: `${id}-search`,
                  ref: search,
                  value: view.state.searchTerm,
                  onChange: (event) =>
                      changeQuery(view.lookup, event.currentTarget.value),
                  onKeyDown: (event) => {
                      if (event.key === 'Enter') event.preventDefault();
                  },
              }),
              h(
                  'ul',
                  {
                      className: 'mx-sdk-login-values-options',
                      'aria-busy': loading,
                  },
                  view.state.options.map((option) =>
                      h(
                          'li',
                          { key: option.value },
                          h(
                              'button',
                              {
                                  type: 'button',
                                  ...(option.label.trim() === ''
                                      ? { 'aria-label': labels.blank }
                                      : {}),
                                  onClick: () =>
                                      choose(view.lookup, option.value),
                              },
                              option.label
                          )
                      )
                  )
              ),
              h(
                  'div',
                  { role: 'status' },
                  loading
                      ? labels.loading
                      : view.state.error === null &&
                          view.state.options.length === 0
                        ? labels.empty
                        : null
              ),
              view.state.error !== null
                  ? h(
                        'div',
                        null,
                        h('div', { role: 'alert' }, labels.error),
                        h(
                            'button',
                            {
                                type: 'button',
                                onClick: () =>
                                    load(
                                        view.lookup,
                                        view.state.offset !== null
                                    ),
                            },
                            labels.retry
                        )
                    )
                  : view.state.offset !== null
                    ? h(
                          'button',
                          {
                              type: 'button',
                              disabled: loading,
                              onClick: () => load(view.lookup, true),
                          },
                          labels.more
                      )
                    : null
          )
        : null;

    return h(
        'div',
        {
            className: ['mx-sdk-login-values', props.className]
                .filter(Boolean)
                .join(' '),
        },
        h(
            'button',
            {
                type: 'button',
                ref: trigger,
                disabled: props.disabled,
                'aria-haspopup': 'dialog',
                'aria-expanded': panel !== null,
                'aria-controls': panel ? `${id}-panel` : undefined,
                onClick: () => {
                    if (active.current) close(active.current);
                    else open();
                },
            },
            labels.open
        ),
        panel
    );
}

/** Host-owned lookup for one explicitly configured Login field. */
export function LoginExistingValuesPicker(
    props: LoginExistingValuesPickerProps
): ReactElement | null {
    if (
        props.allowSearchFromExistingValuesInLogin !== true ||
        props.maskPasswordOnLoginScreen === true
    )
        return null;

    const { extensionSessionId, extensionId, fieldId, viewMode } = props.owner;
    return h(Picker, {
        ...props,
        key: JSON.stringify([
            extensionSessionId,
            extensionId,
            fieldId,
            viewMode,
            props.disabled === true,
        ]),
    });
}
