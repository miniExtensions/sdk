import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import {
    classifyAttachmentPreview,
    isAttachmentPreviewImage,
    type AttachmentPreviewSource,
} from '../ui/attachmentPreview.js';
import { AttachmentPreview } from './AttachmentPreview.js';
import { ActionButton } from './ActionButton.js';
import { readResourceResponse } from './resourceResponse.js';

/** Explicit display resources; this contract grants no physical-field authority. */
export type ReadOnlyURLGalleryEntry = AttachmentPreviewSource & {
    readonly id?: string | null;
    readonly thumbnailUrl?: string | null;
};

export type ReadOnlyURLGalleryLabels = {
    attachments: string;
    openAttachment: string;
    open: string;
    download: string;
    close: string;
    previous: string;
    next: string;
    selectAttachment: string;
    previewNotAvailable: string;
    empty: string;
    downloadFailed: string;
};

export type ReadOnlyURLGalleryProps = {
    entries: readonly ReadOnlyURLGalleryEntry[];
    labels?: Partial<ReadOnlyURLGalleryLabels>;
    isInGrid?: boolean;
    displayMode?: 'thumbnail' | 'icon';
    thumbnailSize?: 'small' | 'medium' | 'large';
    thumbFitType?: 'cover' | 'contain';
    hideAttachmentName?: boolean;
    disableOpenFiles?: boolean;
    disableDownloadFiles?: boolean;
    className?: string;
};

const defaults: ReadOnlyURLGalleryLabels = {
    attachments: 'Attachments',
    openAttachment: 'Open attachment',
    open: 'Open',
    download: 'Download',
    close: 'Close',
    previous: 'Previous',
    next: 'Next',
    selectAttachment: 'Select attachment',
    previewNotAvailable: 'Preview Not Available',
    empty: 'No Value',
    downloadFailed: 'Could not download attachment',
};
const stop = (event: SyntheticEvent) => event.stopPropagation();
const contain = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
};

function thumbnail(entry: ReadOnlyURLGalleryEntry): ReactNode {
    const src =
        entry.thumbnailUrl ??
        entry.thumbnails?.full?.url ??
        (isAttachmentPreviewImage(entry) ? entry.url : null);
    return src == null
        ? h(
              'span',
              { 'aria-hidden': true, className: 'mx-sdk-url-gallery__glyph' },
              '▤'
          )
        : h('img', { src, alt: '', loading: 'lazy' });
}

/** Retain the ordered selected occurrence before any preview/action dereference. */
function replacementIndex(
    previous: readonly ReadOnlyURLGalleryEntry[],
    index: number,
    entries: readonly ReadOnlyURLGalleryEntry[]
): number {
    const selected = previous[index];
    const matches = (entry: ReadOnlyURLGalleryEntry) =>
        selected != null &&
        entry.url === selected.url &&
        (selected.id == null || entry.id === selected.id);
    const occurrence = previous.slice(0, index).filter(matches).length;
    const indices = entries.flatMap((entry, at) =>
        matches(entry) ? [at] : []
    );
    let retained = indices[Math.min(occurrence, indices.length - 1)] ?? -1;
    if (
        retained < 0 &&
        selected?.id != null &&
        previous.filter((entry) => entry.id === selected.id).length === 1
    ) {
        const sameId = entries.flatMap((entry, at) =>
            entry.id === selected.id ? [at] : []
        );
        if (sameId.length === 1) retained = sameId[0]!;
    }
    return retained >= 0
        ? retained
        : Math.max(0, Math.min(index, entries.length - 1));
}

/** Readonly collection presentation. Selection is local; resources stay explicit. */
export function ReadOnlyURLGallery(props: ReadOnlyURLGalleryProps): ReactNode {
    const [selection, setSelection] = useState({
        entries: props.entries,
        index: 0,
        open: false,
    });
    let selected = selection;
    if (selection.entries !== props.entries) {
        selected = {
            entries: props.entries,
            index: replacementIndex(
                selection.entries,
                selection.index,
                props.entries
            ),
            open: selection.open && props.entries.length > 0,
        };
        setSelection(selected);
    }
    const live = useRef<ReadOnlyURLGalleryProps | null>(null);
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        live.current = props;
        return () => {
            if (live.current === props) live.current = null;
        };
    });
    const current = () => live.current === props;
    const labels = { ...defaults, ...props.labels };
    const choose = (index: number, open = true) => {
        if (!current() || props.entries.length === 0) return;
        setSelection({
            entries: props.entries,
            index: Math.max(0, Math.min(index, props.entries.length - 1)),
            open,
        });
    };
    const close = () => {
        if (current()) setSelection((value) => ({ ...value, open: false }));
    };
    const entry = props.entries[selected.index];
    const occurrence = props.entries
        .slice(0, selected.index)
        .filter(
            (candidate) =>
                candidate.url === entry?.url && candidate.id === entry?.id
        ).length;
    return h(
        'div',
        {
            className: ['mx-sdk-url-gallery', props.className]
                .filter(Boolean)
                .join(' '),
            'data-grid': props.isInGrid === true,
            'data-display': props.displayMode ?? 'thumbnail',
            'data-size': props.thumbnailSize ?? 'large',
            'data-fit': props.thumbFitType ?? 'cover',
            onClick: stop,
            onAuxClick: stop,
            onDoubleClick: stop,
            onPointerDown: stop,
        },
        props.entries.length === 0
            ? h(
                  'p',
                  {
                      className: 'mx-sdk-url-gallery__empty',
                      'data-testid': 'no-value-test-id',
                  },
                  labels.empty
              )
            : h(
                  'ul',
                  {
                      className: 'mx-sdk-url-gallery__entries',
                      'aria-label': labels.attachments,
                  },
                  props.entries.map((item, index) =>
                      h(
                          'li',
                          {
                              key: `${item.id ?? ''}:${index}`,
                              className: 'mx-sdk-url-gallery__entry',
                          },
                          h(
                              'div',
                              { className: 'mx-sdk-url-gallery__thumbnail' },
                              thumbnail(item)
                          ),
                          props.hideAttachmentName === false &&
                              props.isInGrid !== true
                              ? h(
                                    'p',
                                    { className: 'mx-sdk-url-gallery__name' },
                                    item.filename
                                )
                              : null,
                          props.disableOpenFiles !== true
                              ? h(
                                    ActionButton,
                                    {
                                        'aria-label': item.url,
                                        className: 'mx-sdk-url-gallery__open',
                                        onClick: (event: SyntheticEvent) => {
                                            contain(event);
                                            choose(index);
                                        },
                                    },
                                    h(
                                        'span',
                                        {
                                            className:
                                                'mx-sdk-url-gallery__sr-only',
                                        },
                                        labels.openAttachment
                                    )
                                )
                              : null
                      )
                  )
              ),
        selected.open && entry != null
            ? h(GalleryDialog, {
                  entry,
                  index: selected.index,
                  entries: props.entries,
                  mediaKey: JSON.stringify([entry.url, entry.id, occurrence]),
                  labels,
                  disableOpen: props.disableOpenFiles === true,
                  disableDownload: props.disableDownloadFiles === true,
                  current,
                  choose,
                  close,
              })
            : null
    );
}

type DialogProps = {
    entry: ReadOnlyURLGalleryEntry;
    index: number;
    entries: readonly ReadOnlyURLGalleryEntry[];
    mediaKey: string;
    labels: ReadOnlyURLGalleryLabels;
    disableOpen: boolean;
    disableDownload: boolean;
    current(): boolean;
    choose(index: number): void;
    close(): void;
};

function GalleryDialog(props: DialogProps): ReactNode {
    const dialog = useRef<HTMLDivElement>(null);
    const close = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        const previous = dialog.current?.ownerDocument.activeElement;
        close.current?.focus();
        return () => {
            if (previous instanceof HTMLElement && previous.isConnected)
                previous.focus();
        };
    }, []);
    return h(
        'div',
        {
            className: 'mx-sdk-url-gallery__backdrop',
            onClick: (event: SyntheticEvent) => {
                contain(event);
                if (event.target === event.currentTarget) props.close();
            },
        },
        h(
            'div',
            {
                ref: dialog,
                role: 'dialog',
                'aria-modal': true,
                'aria-label': props.labels.attachments,
                className: 'mx-sdk-url-gallery__dialog',
                onKeyDown: (
                    event: import('react').KeyboardEvent<HTMLDivElement>
                ) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        props.close();
                    } else if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        props.choose(props.index - 1);
                    } else if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        props.choose(props.index + 1);
                    } else if (event.key === 'Tab') {
                        const nodes = Array.from(
                            dialog.current?.querySelectorAll<HTMLElement>(
                                'button:not(:disabled), a[href], video, audio, iframe'
                            ) ?? []
                        );
                        const first = nodes[0],
                            last = nodes[nodes.length - 1];
                        if (event.shiftKey && event.target === first) {
                            event.preventDefault();
                            last?.focus();
                        } else if (!event.shiftKey && event.target === last) {
                            event.preventDefault();
                            first?.focus();
                        }
                    }
                },
            },
            h(
                'div',
                { className: 'mx-sdk-url-gallery__actions' },
                h(DownloadButton, { key: props.mediaKey, ...props }),
                !props.disableOpen &&
                    !classifyAttachmentPreview(props.entry).isWordDocument
                    ? h(
                          'a',
                          {
                              href: props.entry.url,
                              target: '_blank',
                              rel: 'noreferrer',
                              onClick: (event: SyntheticEvent) => {
                                  stop(event);
                                  if (!props.current()) event.preventDefault();
                              },
                          },
                          props.labels.open
                      )
                    : null,
                h(
                    ActionButton,
                    {
                        ref: close,
                        onClick: (event: SyntheticEvent) => {
                            contain(event);
                            props.close();
                        },
                    },
                    props.labels.close
                )
            ),
            h(
                'p',
                { className: 'mx-sdk-url-gallery__filename' },
                props.entry.filename
            ),
            h(
                'div',
                { className: 'mx-sdk-url-gallery__viewer' },
                h(
                    ActionButton,
                    {
                        disabled: props.index === 0,
                        'aria-label': props.labels.previous,
                        onClick: () => props.choose(props.index - 1),
                    },
                    '‹'
                ),
                h(
                    'div',
                    { className: 'mx-sdk-url-gallery__preview' },
                    h(AttachmentPreview, {
                        key: props.mediaKey,
                        attachment: props.entry,
                        labels: props.labels,
                    })
                ),
                h(
                    ActionButton,
                    {
                        disabled: props.index === props.entries.length - 1,
                        'aria-label': props.labels.next,
                        onClick: () => props.choose(props.index + 1),
                    },
                    '›'
                )
            ),
            h(
                'p',
                {
                    className: 'mx-sdk-url-gallery__position',
                    'aria-live': 'polite',
                },
                `${props.index + 1} / ${props.entries.length}`
            ),
            h(
                'div',
                { className: 'mx-sdk-url-gallery__strip' },
                props.entries.map((item, index) =>
                    h(
                        ActionButton,
                        {
                            key: `${item.id ?? ''}:${index}`,
                            'aria-label': `${props.labels.selectAttachment} ${index + 1}`,
                            'aria-pressed': index === props.index,
                            onClick: () => props.choose(index),
                        },
                        thumbnail(item)
                    )
                )
            )
        )
    );
}

function DownloadButton(props: DialogProps): ReactNode {
    const [state, setState] = useState({
        pending: false,
        percent: 0,
        failed: false,
    });
    const active = useRef<AbortController | null>(null);
    const live = useRef<DialogProps | null>(null);
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        live.current = props;
        if (props.disableDownload)
            setState({ pending: false, percent: 0, failed: false });
        return () => {
            live.current = null;
            active.current?.abort();
            active.current = null;
        };
    }, [props.entry.url, props.disableDownload]);
    // Current callbacks/options may change without replacing the selected URL.
    commitEffect(() => {
        live.current = props;
    });
    const disabled =
        props.disableDownload ||
        props.entry.url.startsWith(
            'https://firebasestorage.googleapis.com/v0/b/'
        );
    if (disabled) return null;
    const download = async (event: SyntheticEvent<HTMLButtonElement>) => {
        contain(event);
        if (
            active.current != null ||
            live.current?.disableDownload ||
            !props.current()
        )
            return;
        const controller = new AbortController();
        active.current = controller;
        const current = () =>
            active.current === controller &&
            !controller.signal.aborted &&
            live.current?.disableDownload !== true &&
            live.current?.current() === true;
        const document = event.currentTarget.ownerDocument;
        let anchor: HTMLAnchorElement | undefined;
        let objectURL: string | undefined;
        setState({ pending: true, percent: 0, failed: false });
        try {
            const response = await fetch(props.entry.url, {
                signal: controller.signal,
            });
            const chunks = await readResourceResponse(
                response,
                controller.signal,
                current,
                (received, length) => {
                    if (current() && length != null)
                        setState({
                            pending: true,
                            percent: Math.min(100, (received / length) * 100),
                            failed: false,
                        });
                }
            );
            if (!current()) return;
            objectURL = URL.createObjectURL(new Blob(chunks));
            anchor = document.createElement('a');
            anchor.href = objectURL;
            anchor.download = props.entry.filename ?? 'Unnamed';
            anchor.hidden = true;
            document.body.appendChild(anchor);
            if (current()) anchor.click();
        } catch {
            if (current())
                setState({ pending: false, percent: 0, failed: true });
        } finally {
            anchor?.removeAttribute('href');
            anchor?.remove();
            if (objectURL != null) URL.revokeObjectURL(objectURL);
            if (active.current === controller) {
                active.current = null;
                if (!controller.signal.aborted && live.current != null)
                    setState((value) => ({ ...value, pending: false }));
            }
        }
    };
    return h(
        'span',
        null,
        h(
            ActionButton,
            {
                busy: state.pending,
                onClick: (event) => {
                    void download(event);
                },
            },
            state.pending
                ? `${state.percent.toFixed()}%`
                : props.labels.download
        ),
        state.failed
            ? h('span', { role: 'alert' }, props.labels.downloadFailed)
            : null
    );
}
