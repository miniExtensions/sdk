import * as React from 'react';
import {
    createElement as h,
    Fragment,
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactElement,
    type ReactNode,
} from 'react';
import { createAddressRuntime } from '../../vendor/headlessui-address/sdk-runtime.js';
import {
    createCompleteLinkedFinderCoordinator,
    type CompleteLinkedFinderCoordinator,
    type CompleteLinkedFinderHost,
} from '../ui/completeLinkedFinder.js';
import {
    LinkedFinderCard,
    type LinkedFinderCardProjection,
} from './LinkedFinderCard.js';
import { useBarcodeScannerButton } from './useBarcodeScannerButton.js';
import type { BarcodeScannerButtonOptions } from './useBarcodeScannerButton.js';

const { Combobox } = createAddressRuntime(React);
export type CompleteLinkedFinderLabels = {
    readonly search: string;
    readonly loading: string;
    readonly noMatches: string;
    readonly unavailable: string;
    readonly loadMore: string;
};
export type CompleteLinkedFinderCandidate = {
    readonly id: string;
    readonly projection: LinkedFinderCardProjection;
};
export type CompleteLinkedFinderProps<Row, Filter, Owner extends object> = {
    /** Stable captured ports. The SDK creates no client, canonical store or hydration. */
    host: CompleteLinkedFinderHost<Row, Filter, Owner>;
    /** Current filter for mount, host-generation changes and pagination. */
    filter: Filter;
    /** Committed non-search query generation. Search echoes do not retire scans. */
    queryKey: unknown;
    searchTerm: string;
    onSearchTermChange(
        value: string,
        source?: 'manual' | 'barcode-scanner'
    ): void;
    filterForSearch(
        value: string,
        source?: 'manual' | 'barcode-scanner'
    ): Filter;
    /** Host-filtered/sorted, already admitted structured data. No JSX slots.
     * Only IDs present in the raw candidate model can be displayed. */
    candidates(
        expectedOwner: Owner,
        rawCandidateIds: readonly string[]
    ): readonly CompleteLinkedFinderCandidate[];
    labels: CompleteLinkedFinderLabels;
    scanner?: Pick<
        BarcodeScannerButtonOptions,
        'autoStartCamera' | 'labels' | 'style' | 'desktopViewportOffset'
    > & { enabled: boolean };
    /** Host table/schema readiness, separate from query and paging state. */
    initialLoading?: boolean;
    className?: string;
    /** Optional stable instrumentation on each selectable record row. */
    optionTestId?: string;
    testing?: boolean;
    /** Main-form single-link preference. Close remains independently owner-fenced. */
    closeAfterToggle?: boolean;
};

export type CompleteLinkedFinderViewProps<
    Row,
    Filter,
    Owner extends object,
> = CompleteLinkedFinderProps<Row, Filter, Owner> & {
    /** Existing committed native coordinator; this view never creates or destroys it. */
    coordinator: CompleteLinkedFinderCoordinator<Row, Filter, Owner> | null;
    /** Native prefetch/open can own the initial read without a second allocation. */
    queryOnMount?: boolean;
    /** Admitted authenticated-preview presentation, with no candidate model or loading flash. */
    previewPresentation?: {
        readonly expectedOwner: Owner;
        readonly candidateIds: readonly string[];
        readonly offset: string | null;
        readonly error: string | null;
    };
};

export function CompleteLinkedFinderView<Row, Filter, Owner extends object>(
    props: CompleteLinkedFinderViewProps<Row, Filter, Owner>
): ReactElement {
    const { coordinator, host } = props;
    const [, refresh] = useState(0);
    const scroll = useRef<HTMLDivElement>(null);
    const sentinel = useRef<HTMLDivElement>(null);
    const focusInput = useCallback(
        (input: HTMLInputElement | null) => input?.focus(),
        []
    );
    useEffect(() => {
        const stop = coordinator?.subscribe(() =>
            refresh((value) => value + 1)
        );
        // An external prefetch can settle between render and subscription.
        refresh((value) => value + 1);
        return stop;
    }, [coordinator]);
    const snapshot = coordinator?.getSnapshot();
    const owner = snapshot?.owner ?? null;
    const readIdentity = snapshot?.readIdentity ?? null;
    const selected = snapshot?.selectedIds ?? [];
    const enabled = snapshot?.selectionEnabled === true;
    const currentOwner = () => {
        try {
            return owner !== null && host.isOwnerCurrent(owner);
        } catch {
            return false;
        }
    };
    const preview =
        props.previewPresentation?.expectedOwner === owner &&
        owner !== null &&
        currentOwner()
            ? props.previewPresentation
            : null;
    const rawIds =
        preview?.candidateIds ??
        coordinator?.model.getState().options.map((option) => option.value) ??
        [];
    const offset = preview ? preview.offset : snapshot?.offset;
    const error = preview ? preview.error : snapshot?.error;
    const loadingMore = !preview && snapshot?.loadingMore === true;
    useEffect(() => {
        if (props.queryOnMount === false) return;
        coordinator?.scheduleSearch({
            filter: props.filter,
            resetOffset: true,
        });
    }, [coordinator, props.queryKey, owner, props.queryOnMount]);
    useEffect(() => {
        if (
            !coordinator ||
            !owner ||
            !readIdentity ||
            !offset ||
            loadingMore ||
            (!preview && snapshot?.phase !== 'ready') ||
            !sentinel.current ||
            typeof IntersectionObserver === 'undefined'
        )
            return;
        let active = true;
        const observer = new IntersectionObserver(
            (entries) => {
                if (!active) return;
                const current = coordinator.getSnapshot();
                if (
                    active &&
                    entries.some((entry) => entry.isIntersecting) &&
                    current.owner === owner &&
                    current.readIdentity === readIdentity
                )
                    void coordinator.queryNow({
                        filter: props.filter,
                        resetOffset: false,
                    });
            },
            { root: scroll.current, rootMargin: '400px' }
        );
        observer.observe(sentinel.current);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [
        coordinator,
        owner,
        readIdentity,
        offset,
        loadingMore,
        preview !== null,
        snapshot?.phase,
        props.filter,
    ]);
    const { barcodeScannerButton, scannerComponent } = useBarcodeScannerButton({
        autoStartCamera: props.scanner?.autoStartCamera ?? false,
        hideButton: !props.scanner?.enabled || !enabled || !coordinator,
        ownerKey: owner,
        isCurrent: () => owner !== null && enabled && currentOwner(),
        runInLoop: true,
        labels: props.scanner?.labels,
        style: props.scanner?.style,
        desktopViewportOffset: props.scanner?.desktopViewportOffset,
        setValue: async (value) => {
            if (
                !coordinator ||
                !owner ||
                coordinator.getSnapshot().owner !== owner
            )
                return;
            props.onSearchTermChange(value, 'barcode-scanner');
            if (coordinator.getSnapshot().owner === owner)
                await coordinator.scan({
                    filter: props.filterForSearch(value, 'barcode-scanner'),
                    resetOffset: true,
                });
        },
    });
    const admittedCandidates = (): readonly CompleteLinkedFinderCandidate[] => {
        try {
            if (!owner || !host.isOwnerCurrent(owner)) return [];
            const result = props.candidates(owner, rawIds);
            const raw = new Set(rawIds),
                seen = new Set<string>();
            const rows = result.filter(
                ({ id }) =>
                    raw.has(id) && !seen.has(id) && Boolean(seen.add(id))
            );
            return host.isOwnerCurrent(owner) ? rows : [];
        } catch {
            return [];
        }
    };
    const candidates = admittedCandidates();
    const optionEnabled = (id: string) => {
        try {
            return (
                owner !== null &&
                enabled &&
                host.isOwnerCurrent(owner) &&
                host.isOptionEnabled(owner, id) &&
                host.isOwnerCurrent(owner)
            );
        } catch {
            return false;
        }
    };
    const body =
        props.initialLoading ||
        (!preview && snapshot?.phase === 'loading' && !snapshot.loadingMore)
            ? h(
                  'div',
                  { role: 'status', className: 'mx-sdk-finder-feedback' },
                  props.labels.loading
              )
            : error
              ? h(
                    'div',
                    { role: 'alert', className: 'mx-sdk-finder-feedback' },
                    error
                )
              : candidates.length
                ? h(
                      Combobox.Options,
                      { static: true, className: 'mx-sdk-finder-records' },
                      candidates.map(({ id, projection }) =>
                          h(Combobox.Option<'li', string>, {
                              key: id,
                              value: id,
                              ...{ 'data-testid': props.optionTestId },
                              disabled: !optionEnabled(id),
                              className: ({ active, selected }) =>
                                  `mx-sdk-finder-record${active ? ' mx-sdk-finder-option-active' : ''}${selected ? ' mx-sdk-finder-record-selected' : ''}`,
                              children: ({ selected }: { selected: boolean }) =>
                                  h(
                                      Fragment,
                                      null,
                                      selected
                                          ? h(
                                                'span',
                                                {
                                                    className:
                                                        'mx-sdk-finder-check',
                                                    'aria-hidden': true,
                                                },
                                                '✓'
                                            )
                                          : null,
                                      h(LinkedFinderCard, { projection })
                                  ),
                          })
                      )
                  )
                : h(
                      'div',
                      { className: 'mx-sdk-finder-feedback' },
                      props.labels.noMatches
                  );
    return h(
        'div',
        {
            className: ['mx-sdk-complete-linked-finder', props.className]
                .filter(Boolean)
                .join(' '),
        },
        h<{
            multiple: true;
            value: string[];
            disabled: boolean;
            onChange(value: string[]): void;
            children: ReactNode;
        }>(Combobox, {
            multiple: true,
            value: [...selected],
            disabled: false,
            onChange: (value) => {
                if (!coordinator || !owner) return;
                // Headless UI removes one occurrence. Canonical duplicates are
                // still host-owned, so a count change must invoke one semantic
                // toggle even if that ID remains in Headless UI's proposal.
                const count = (items: readonly string[], id: string) =>
                    items.filter((item) => item === id).length;
                const changed = [...value, ...selected].find(
                    (id) => count(value, id) !== count(selected, id)
                );
                if (changed != null)
                    void coordinator.toggle(owner, changed, {
                        closeAfterAddition: props.closeAfterToggle === true,
                    });
            },
            children: h(
                Fragment,
                null,
                h(
                    'div',
                    { className: 'mx-sdk-finder-search' },
                    h('span', { 'aria-hidden': true }, '⌕'),
                    h(Combobox.Input, {
                        type: 'search',
                        'aria-label': props.labels.search,
                        placeholder: props.labels.search,
                        displayValue: () => props.searchTerm,
                        defaultValue: props.searchTerm,
                        autoComplete: 'off',
                        ref: focusInput,
                        onChange: (
                            event: React.ChangeEvent<HTMLInputElement>
                        ) => {
                            props.onSearchTermChange(
                                event.target.value,
                                'manual'
                            );
                            coordinator?.scheduleSearch({
                                filter: props.filterForSearch(
                                    event.target.value,
                                    'manual'
                                ),
                                resetOffset: true,
                            });
                        },
                    }),
                    barcodeScannerButton
                ),
                h(
                    'div',
                    { ref: scroll, className: 'mx-sdk-finder-scroll' },
                    body,
                    offset
                        ? h(
                              'div',
                              {
                                  ref: sentinel,
                                  className: 'mx-sdk-finder-sentinel',
                                  'aria-label': props.labels.loadMore,
                              },
                              loadingMore
                                  ? h(
                                        'span',
                                        { role: 'status' },
                                        props.labels.loading
                                    )
                                  : null
                          )
                        : null
                ),
                scannerComponent
            ),
        })
    );
}

/** Actual searchable multi-select, cards and scanner composition with an owned coordinator. */
export function CompleteLinkedFinder<Row, Filter, Owner extends object>(
    props: CompleteLinkedFinderProps<Row, Filter, Owner>
): ReactElement {
    const [runtime, setRuntime] = useState<{
        host: typeof props.host;
        coordinator: CompleteLinkedFinderCoordinator<Row, Filter, Owner>;
    } | null>(null);
    useEffect(() => {
        const coordinator = createCompleteLinkedFinderCoordinator(props.host, {
            testing: props.testing,
        });
        setRuntime({ host: props.host, coordinator });
        return () => coordinator.destroy();
    }, [props.host, props.testing]);
    return runtime !== null && runtime.host === props.host
        ? h(CompleteLinkedFinderView<Row, Filter, Owner>, {
              ...props,
              coordinator: runtime.coordinator,
          })
        : h(
              'div',
              { className: 'mx-sdk-complete-linked-finder' },
              h('input', {
                  type: 'search',
                  'aria-label': props.labels.search,
                  placeholder: props.labels.search,
                  value: props.searchTerm,
                  readOnly: true,
              })
          );
}
