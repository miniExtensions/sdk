import {
    createElement as h,
    lazy,
    Suspense,
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
import { NativeLoginExistingValuesDialog } from './NativeLoginExistingValuesDialog.js';

const LoginDialogPortal = lazy(async () => {
    const { createPortal } = await import('react-dom');
    return {
        default: ({
            children,
            container,
        }: {
            children?: ReactNode;
            container: HTMLElement;
        }) => createPortal(children, container),
    };
});

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
    /** Presents the picker as a modal with an input-focused combobox. */
    appearance?: 'native';
    /** Optional visible hint for the native search input. */
    searchPlaceholder?: string;
    /** Replaces the trigger's visible label. Its accessible name remains labels.open. */
    triggerContent?: ReactNode;
    /** Native modal markers for host integration tests. */
    testIds?: Readonly<{ dialog?: string; overlay?: string }>;
    /** Formats a host-provided lookup error in the native modal. */
    renderError?(message: string): ReactNode;
    /** Optional host loading indicator displayed during an initial lookup. */
    renderLoading?(): ReactNode;
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
    const optionsList = useRef<HTMLUListElement>(null);
    const active = useRef<Lookup | null>(null);
    const callbacks = useRef(props);
    const [view, setView] = useState<LookupView | null>(null);
    const labels = { ...defaultLabels, ...props.labels };
    const native = props.appearance === 'native';
    const useCommittedEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const openedLookup = native ? undefined : view?.lookup;
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
        if (!native) trigger.current?.focus();
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

    function moveOptionFocus(
        event: KeyboardEvent<HTMLInputElement | HTMLButtonElement>
    ) {
        const forward = event.key === 'ArrowDown';
        if (
            (!forward && event.key !== 'ArrowUp') ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.nativeEvent.isComposing
        )
            return;
        const buttons = Array.from(
            optionsList.current?.querySelectorAll<HTMLButtonElement>(
                'li > button'
            ) ?? []
        );
        if (buttons.length === 0) return;
        event.preventDefault();

        // Navigate the mounted occurrences in order, including repeated labels.
        const index = buttons.findIndex(
            (button) => button === event.currentTarget
        );
        if (index === -1) {
            (forward ? buttons[0] : buttons.at(-1))?.focus();
            return;
        }
        const next = buttons[index + (forward ? 1 : -1)];
        if (next) next.focus();
        else if (!forward) search.current?.focus();
    }

    function handleDialogKey(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key !== 'Escape' || !view || event.nativeEvent.isComposing)
            return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) close(view.lookup);
    }

    const inlineView = native ? null : view;
    const defaultPanel = inlineView
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
                      {
                          type: 'button',
                          onClick: () => close(inlineView.lookup),
                      },
                      labels.close
                  )
              ),
              h('label', { htmlFor: `${id}-search` }, labels.search),
              h('input', {
                  type: 'search',
                  id: `${id}-search`,
                  ref: search,
                  value: inlineView.state.searchTerm,
                  onChange: (event) =>
                      changeQuery(inlineView.lookup, event.currentTarget.value),
                  onKeyDown: (event) => {
                      if (event.key === 'Enter') event.preventDefault();
                      else moveOptionFocus(event);
                  },
              }),
              h(
                  'ul',
                  {
                      className: 'mx-sdk-login-values-options',
                      ref: optionsList,
                      'aria-busy': loading,
                  },
                  inlineView.state.options.map((option) =>
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
                                      choose(inlineView.lookup, option.value),
                                  onKeyDown: moveOptionFocus,
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
                      : inlineView.state.error === null &&
                          inlineView.state.options.length === 0
                        ? labels.empty
                        : null
              ),
              inlineView.state.error !== null
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
                                        inlineView.lookup,
                                        inlineView.state.offset !== null
                                    ),
                            },
                            labels.retry
                        )
                    )
                  : inlineView.state.offset !== null
                    ? h(
                          'button',
                          {
                              type: 'button',
                              disabled: loading,
                              onClick: () => load(inlineView.lookup, true),
                          },
                          labels.more
                      )
                    : null
          )
        : null;

    const panel =
        view && native
            ? h(NativeLoginExistingValuesDialog, {
                  id,
                  opener: trigger.current,
                  labels,
                  state: view.state,
                  debouncing: view.lookup.timer !== null,
                  titleAction: props.titleAction,
                  searchPlaceholder: props.searchPlaceholder,
                  testIds: props.testIds,
                  renderError: props.renderError,
                  renderLoading: props.renderLoading,
                  dismiss: () => close(view.lookup),
                  changeQuery: (query) => changeQuery(view.lookup, query),
                  choose: (value) => choose(view.lookup, value),
                  load: (append) => load(view.lookup, append),
              })
            : defaultPanel;

    // Keep browser form ownership with the host's Login fields. Mount next to
    // its form so the picker still inherits the surrounding application theme.
    const portalContainer =
        native && panel
            ? trigger.current?.closest('form')?.parentElement
            : null;

    return h(
        'div',
        {
            className: [
                'mx-sdk-login-values',
                native && 'mx-sdk-login-values--native',
                props.className,
            ]
                .filter(Boolean)
                .join(' '),
        },
        h(
            'button',
            {
                type: 'button',
                ref: trigger,
                disabled: props.disabled,
                'aria-label':
                    props.triggerContent != null ? labels.open : undefined,
                'aria-haspopup': 'dialog',
                'aria-expanded': panel !== null,
                'aria-controls': panel ? `${id}-panel` : undefined,
                onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
                    // A held Enter can repeat after selection returns focus.
                    if (event.key === 'Enter' && event.repeat)
                        event.preventDefault();
                },
                onClick: () => {
                    if (active.current) close(active.current);
                    else open();
                },
            },
            props.triggerContent ?? labels.open
        ),
        portalContainer
            ? h(
                  Suspense,
                  null,
                  h(LoginDialogPortal, { container: portalContainer }, panel)
              )
            : panel
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
            props.appearance,
        ]),
    });
}
