import {
    createElement as h,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactElement,
    type ReactNode,
} from 'react';
import {
    capturePortalVisitorSearchDraft,
    readPortalVisitorSearchFrame,
    samePortalVisitorSearchScope,
    type PortalVisitorSearchIntent,
    type PortalVisitorSearchOutcome,
    type PortalVisitorSearchPort,
} from '../portals/visitorSearch.js';

const defaultLabels = {
    input: 'Search',
    submit: 'Search',
    clear: 'Clear search',
};
const useCommitEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;

export type PortalVisitorSearchLabels = Partial<typeof defaultLabels>;
export type PortalVisitorSearchProps = {
    port: PortalVisitorSearchPort & {
        subscribe(listener: () => void): () => void;
    };
    disabled?: boolean;
    labels?: PortalVisitorSearchLabels;
    className?: string;
    style?: CSSProperties;
    onOutcome?(outcome: PortalVisitorSearchOutcome): void;
    renderScanner?(controls: {
        disabled: boolean;
        /** Capture at scanner open and retire the callback when the scanner closes. */
        capture(): ((value: string) => void) | null;
    }): ReactNode;
};

type Entry = {
    port: PortalVisitorSearchProps['port'];
    subscription: symbol;
    draft: ReturnType<typeof capturePortalVisitorSearchDraft>;
    text: string;
    pendingClear: PortalVisitorSearchIntent | null;
    reconcile(
        frame: ReturnType<typeof readPortalVisitorSearchFrame>
    ): Entry | null;
};

export function PortalVisitorSearch({
    port,
    disabled,
    labels,
    className,
    style,
    onOutcome,
    renderScanner,
}: PortalVisitorSearchProps): ReactElement {
    const names = { ...defaultLabels, ...labels };
    const id = useId();
    const input = useRef<HTMLInputElement>(null);
    const [visible, setVisible] = useState<{
        entry: Entry;
        text: string;
    } | null>(null);
    const current = useRef<Entry | null>(null);
    const settings = useRef({ disabled, onOutcome });
    useCommitEffect(() => {
        settings.current = { disabled, onOutcome };
    }, [disabled, onOutcome]);
    useCommitEffect(() => {
        let active = true;
        const subscription = Symbol();
        const reconcile: Entry['reconcile'] = (frame) => {
            if (!active || frame === undefined) return null;
            const previous = current.current;
            if (previous?.draft.observe(frame)) return previous;
            const entry: Entry | null = frame
                ? {
                      port,
                      subscription,
                      draft: capturePortalVisitorSearchDraft(port, frame),
                      text: frame.searchTerm,
                      pendingClear: null,
                      reconcile,
                  }
                : null;
            current.current = entry;
            setVisible(entry && { entry, text: entry.text });
            return entry;
        };
        const refresh = () => {
            if (active) reconcile(readPortalVisitorSearchFrame(port));
        };
        const unsubscribe = port.subscribe(refresh);
        refresh();
        return () => {
            active = false;
            current.current = null;
            unsubscribe();
        };
    }, [port]);

    const entry = visible?.entry.port === port ? visible.entry : null;
    const inactive = disabled === true || entry === null;
    const owns = (candidate: Entry | null): candidate is Entry =>
        candidate !== null &&
        candidate === current.current &&
        !settings.current.disabled &&
        candidate.reconcile(readPortalVisitorSearchFrame(candidate.port)) ===
            candidate;
    const edit = (candidate: Entry, text: string) => {
        candidate.pendingClear = null;
        candidate.text = text;
        setVisible({ entry: candidate, text });
    };
    const submit = (
        candidate: Entry,
        intent: PortalVisitorSearchIntent,
        onAdmitted?: () => void
    ) => {
        const submission = candidate.draft.submit(intent, () => {
            candidate.pendingClear = null;
            if (intent.source === 'clear') {
                edit(candidate, '');
                candidate.pendingClear = intent;
                input.current?.focus();
            }
            onAdmitted?.();
        });
        void submission.then((outcome) => {
            const live = current.current;
            if (!live || live.subscription !== candidate.subscription) return;
            const frame = readPortalVisitorSearchFrame(candidate.port);
            const verified = candidate.reconcile(frame);
            if (!verified || !frame) return;
            const publication =
                outcome.type === 'stale'
                    ? undefined
                    : outcome.committedPublication;
            const captured = candidate.draft.frame;
            const advancedAllocation =
                outcome.type === 'allocated' &&
                outcome.generation > captured.stamp.generation
                    ? outcome
                    : undefined;
            if (!publication && !advancedAllocation) {
                if (verified === candidate) {
                    if (candidate.pendingClear === intent) {
                        candidate.pendingClear = null;
                        if (outcome.type === 'refused')
                            edit(candidate, frame.searchTerm);
                    }
                    settings.current.onOutcome?.(outcome);
                }
                return;
            }
            const requestedTerm =
                intent.source === 'clear' ? '' : intent.searchTerm;
            // An allocation alone can identify a same-term reload, but it
            // cannot establish which command changed the committed term.
            if (!publication && requestedTerm !== captured.searchTerm) return;
            if (
                samePortalVisitorSearchScope(captured.stamp, frame.stamp) &&
                frame.stamp.generation ===
                    (publication?.generation ??
                        advancedAllocation?.generation) &&
                frame.publicationRevision ===
                    (publication?.revision ?? captured.publicationRevision) &&
                frame.searchTerm === requestedTerm
            )
                settings.current.onOutcome?.(outcome);
        });
    };

    return h(
        'div',
        {
            role: 'search',
            className,
            style,
        },
        h('label', { htmlFor: id }, names.input),
        h('input', {
            id,
            ref: input,
            type: 'text',
            value: entry ? visible?.text : '',
            placeholder: names.input,
            disabled: inactive,
            onChange(event: React.ChangeEvent<HTMLInputElement>) {
                if (owns(entry)) edit(entry, event.currentTarget.value);
            },
            onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
                if (
                    event.key !== 'Enter' ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229
                )
                    return;
                event.preventDefault();
                if (owns(entry))
                    submit(entry, { source: 'submit', searchTerm: entry.text });
            },
        }),
        entry && visible?.text
            ? h(
                  'button',
                  {
                      type: 'button',
                      disabled: inactive,
                      onClick() {
                          if (!owns(entry)) return;
                          submit(entry, { source: 'clear' });
                      },
                  },
                  names.clear
              )
            : null,
        renderScanner?.({
            disabled: inactive,
            capture() {
                if (!owns(entry)) return null;
                let accepted = false;
                return (value) => {
                    if (accepted || !owns(entry)) return;
                    submit(entry, { source: 'scan', searchTerm: value }, () => {
                        accepted = true;
                        edit(entry, value);
                    });
                };
            },
        }),
        h(
            'button',
            {
                type: 'button',
                disabled: inactive,
                onClick() {
                    if (owns(entry))
                        submit(entry, {
                            source: 'submit',
                            searchTerm: entry.text,
                        });
                },
            },
            names.submit
        )
    );
}
