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
    createPortalVisitorSearchDraft,
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
    draft: NonNullable<ReturnType<typeof createPortalVisitorSearchDraft>>;
    text: string;
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
        const refresh = () => {
            if (!active || current.current?.draft.current()) return;
            const draft = createPortalVisitorSearchDraft(port);
            const entry = draft
                ? { port, subscription, draft, text: draft.frame.searchTerm }
                : null;
            current.current = entry;
            setVisible(entry && { entry, text: entry.text });
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
        candidate.draft.current();
    const edit = (candidate: Entry, text: string) => {
        candidate.text = text;
        setVisible({ entry: candidate, text });
    };
    const submit = (candidate: Entry, intent: PortalVisitorSearchIntent) => {
        void candidate.draft.submit(intent).then((outcome) => {
            const live = current.current;
            if (!live || live.subscription !== candidate.subscription) return;
            const publication =
                outcome.type === 'stale'
                    ? undefined
                    : outcome.committedPublication;
            const captured = candidate.draft.frame;
            if (!publication) {
                if (
                    live === candidate &&
                    candidate.draft.current() &&
                    (outcome.type !== 'allocated' ||
                        outcome.generation === captured.stamp.generation)
                )
                    settings.current.onOutcome?.(outcome);
                return;
            }
            const frame = readPortalVisitorSearchFrame(candidate.port);
            const requestedTerm =
                intent.source === 'clear' ? '' : intent.searchTerm;
            if (
                frame &&
                samePortalVisitorSearchScope(captured.stamp, frame.stamp) &&
                frame.stamp.generation === publication.generation &&
                frame.publicationRevision === publication.revision &&
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
            type: 'text',
            value: entry ? visible?.text : '',
            placeholder: names.input,
            disabled: inactive,
            onChange(event: React.ChangeEvent<HTMLInputElement>) {
                if (owns(entry)) edit(entry, event.currentTarget.value);
            },
            onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing)
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
                          edit(entry, '');
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
                    accepted = true;
                    edit(entry, value);
                    submit(entry, { source: 'scan', searchTerm: value });
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
