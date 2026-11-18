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
import { RecoverableImage } from './RecoverableImage.js';
import { readResourceResponse } from './resourceResponse.js';
import {
    resourceOwnerCurrent,
    resourceOwnerGeneration,
    watchResourceOwner,
    type ReadonlyResourceOwner,
} from './readonlyResourceOwner.js';

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
    retry?: string;
    empty: string;
    downloadFailed: string;
};

export type ReadOnlyURLGalleryProps = {
    entries: readonly ReadOnlyURLGalleryEntry[];
    /** Optional captured host authority; omitted legacy resources retain behavior. */
    owner?: ReadonlyResourceOwner;
    identity?: unknown;
    /** Selection continuity only. Never grants media, download or navigation authority. */
    selectionOwner?: ReadonlyResourceOwner;
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
    retry: 'Try again',
    empty: 'No Value',
    downloadFailed: 'Could not download attachment',
};
const stop = (event: SyntheticEvent) => event.stopPropagation();
const contain = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
};

type ThumbnailPresentation = {
    labels: ReadOnlyURLGalleryLabels;
    thumbnailRevision: number;
    resourcesCurrent(): boolean;
    current(): boolean;
};

function thumbnail(
    entry: ReadOnlyURLGalleryEntry,
    view: ThumbnailPresentation
): ReactNode {
    const explicitResource = typeof entry.url === 'string' && entry.url !== '';
    const image = explicitResource && isAttachmentPreviewImage(entry);
    const sources = explicitResource
        ? [
              entry.thumbnailUrl,
              entry.thumbnails?.full?.url,
              image ? entry.url : null,
          ].filter(
              (source): source is string =>
                  typeof source === 'string' &&
                  source !== '' &&
                  (image || source !== entry.url)
          )
        : [];
    if (sources.length === 0)
        return h(
            'span',
            { 'aria-hidden': true, className: 'mx-sdk-url-gallery__glyph' },
            '▤'
        );
    const { labels } = view;
    return h(RecoverableImage, {
        key: view.thumbnailRevision,
        sources,
        alt: '',
        loading: 'lazy',
        isCurrent: view.resourcesCurrent,
        renderFallback: (retry) =>
            h(
                'div',
                {
                    className: 'mx-sdk-url-gallery__failure',
                    role: 'status',
                    'aria-label': entry.filename
                        ? `${labels.previewNotAvailable}: ${entry.filename}`
                        : labels.previewNotAvailable,
                },
                h('span', null, labels.previewNotAvailable),
                h(
                    ActionButton,
                    {
                        className: 'mx-sdk-url-gallery__retry',
                        onClick: (event: SyntheticEvent<HTMLButtonElement>) => {
                            contain(event);
                            if (!view.current()) return;
                            const button = event.currentTarget;
                            if (button.ownerDocument.activeElement === button) {
                                const tile = button.closest(
                                    '.mx-sdk-url-gallery__entry, .mx-sdk-url-gallery__strip-item'
                                );
                                const nextFocus =
                                    tile?.querySelector<HTMLButtonElement>(
                                        '.mx-sdk-url-gallery__open, .mx-sdk-url-gallery__select'
                                    ) ??
                                    button.closest<HTMLElement>(
                                        '.mx-sdk-url-gallery__thumbnail'
                                    );
                                nextFocus?.focus();
                            }
                            retry();
                        },
                    },
                    labels.retry ?? defaults.retry
                )
            ),
    });
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
    const selectionOwner = props.selectionOwner ?? props.owner;
    const generation = resourceOwnerGeneration(selectionOwner);
    const resourceGeneration = resourceOwnerGeneration(props.owner);
    const selectionIdentity =
        props.selectionOwner === undefined ? props.identity : generation;
    const [, updateAvailability] = useState(0);
    const [selection, setSelection] = useState({
        entries: props.entries,
        generation,
        identity: selectionIdentity,
        resourceGeneration,
        resourceIdentity: props.identity,
        thumbnailRevision: 0,
        index: 0,
        open: false,
    });
    let selected = selection;
    const replaced =
        !Object.is(selection.generation, generation) ||
        !Object.is(selection.identity, selectionIdentity);
    const resourcesReplaced =
        replaced ||
        !Object.is(selection.resourceGeneration, resourceGeneration) ||
        !Object.is(selection.resourceIdentity, props.identity);
    if (selection.entries !== props.entries || resourcesReplaced) {
        selected = {
            entries: props.entries,
            generation,
            identity: selectionIdentity,
            resourceGeneration,
            resourceIdentity: props.identity,
            thumbnailRevision:
                selection.thumbnailRevision + Number(resourcesReplaced),
            index: replaced
                ? 0
                : replacementIndex(
                      selection.entries,
                      selection.index,
                      props.entries
                  ),
            open: !replaced && selection.open && props.entries.length > 0,
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
    const currentPresentation = () => live.current === props;
    const resourcesCurrent = () =>
        resourceOwnerCurrent(selectionOwner) &&
        resourceOwnerCurrent(props.owner);
    const current = () => currentPresentation() && resourcesCurrent();
    const lifetimeCurrent = () =>
        live.current !== null &&
        Object.is(
            resourceOwnerGeneration(
                live.current.selectionOwner ?? live.current.owner
            ),
            generation
        ) &&
        Object.is(
            live.current.selectionOwner === undefined
                ? live.current.identity
                : resourceOwnerGeneration(live.current.selectionOwner),
            selectionIdentity
        ) &&
        resourceOwnerCurrent(selectionOwner) &&
        resourceOwnerCurrent(props.owner);
    commitEffect(() => {
        return watchResourceOwner(selectionOwner, () => {
            if (
                live.current !== null &&
                Object.is(
                    resourceOwnerGeneration(
                        live.current.selectionOwner ?? live.current.owner
                    ),
                    generation
                ) &&
                Object.is(
                    live.current.selectionOwner === undefined
                        ? live.current.identity
                        : resourceOwnerGeneration(live.current.selectionOwner),
                    selectionIdentity
                ) &&
                !resourceOwnerCurrent(selectionOwner)
            )
                setSelection((value) => ({ ...value, open: false }));
        });
    }, [selectionOwner, generation, selectionIdentity]);
    commitEffect(() => {
        if (selectionOwner === props.owner) return;
        // A replaced immutable resource must disappear immediately, while the
        // still-current parent may retain the user's selection for its successor.
        return watchResourceOwner(props.owner, () =>
            updateAvailability((version) => version + 1)
        );
    }, [props.owner, selectionOwner]);
    const labels = { ...defaults, ...props.labels };
    const thumbnails: ThumbnailPresentation = {
        labels,
        thumbnailRevision: selected.thumbnailRevision,
        resourcesCurrent,
        current,
    };
    const choose = (index: number, open = true) => {
        if (!current() || props.entries.length === 0) return;
        setSelection({
            ...selected,
            index: Math.max(0, Math.min(index, props.entries.length - 1)),
            open,
        });
    };
    const close = () => {
        if (currentPresentation())
            setSelection((value) => ({ ...value, open: false }));
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
        !resourcesCurrent()
            ? h('p', { role: 'status' }, labels.previewNotAvailable)
            : props.entries.length === 0
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
                                {
                                    className: 'mx-sdk-url-gallery__thumbnail',
                                    tabIndex: -1,
                                },
                                thumbnail(item, thumbnails)
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
        selected.open && entry != null && resourcesCurrent()
            ? h(GalleryDialog, {
                  entry,
                  index: selected.index,
                  entries: props.entries,
                  mediaKey: JSON.stringify([entry.url, entry.id, occurrence]),
                  ...thumbnails,
                  disableOpen: props.disableOpenFiles === true,
                  disableDownload: props.disableDownloadFiles === true,
                  owner: props.owner,
                  identity: props.identity,
                  lifetimeCurrent,
                  choose,
                  close,
              })
            : null
    );
}

type DialogProps = ThumbnailPresentation & {
    entry: ReadOnlyURLGalleryEntry;
    index: number;
    entries: readonly ReadOnlyURLGalleryEntry[];
    mediaKey: string;
    disableOpen: boolean;
    disableDownload: boolean;
    owner?: ReadonlyResourceOwner;
    identity?: unknown;
    lifetimeCurrent(): boolean;
    choose(index: number): void;
    close(): void;
};

function GalleryDialog(props: DialogProps): ReactNode {
    const dialog = useRef<HTMLDivElement>(null);
    const close = useRef<HTMLButtonElement>(null);
    const previousButton = useRef<HTMLButtonElement>(null);
    const nextButton = useRef<HTMLButtonElement>(null);
    const navigationTrigger = useRef<HTMLButtonElement | null>(null);
    const chooseFromNavigation = (index: number) => {
        const active = dialog.current?.ownerDocument.activeElement;
        const trigger =
            active === previousButton.current
                ? previousButton.current
                : active === nextButton.current
                  ? nextButton.current
                  : null;
        navigationTrigger.current = trigger;
        props.choose(index);
    };
    useEffect(() => {
        const trigger = navigationTrigger.current;
        navigationTrigger.current = null;
        if (!trigger || trigger.isConnected || !props.current()) return;
        const document = trigger.ownerDocument;
        // A boundary navigation can remove its own focused button. Restore
        // keyboard ownership only when that removal left focus on the body;
        // preserve a deliberate move to any other connected control.
        if (
            document.activeElement == null ||
            document.activeElement === document.body ||
            document.activeElement === trigger
        )
            close.current?.focus();
    }, [props.index]);
    useEffect(() => {
        const previous = dialog.current?.ownerDocument.activeElement;
        if (props.current()) close.current?.focus();
        return () => {
            if (
                previous instanceof HTMLElement &&
                previous.isConnected &&
                ((props.owner === undefined && props.identity === undefined) ||
                    props.lifetimeCurrent())
            )
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
                        chooseFromNavigation(props.index - 1);
                    } else if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        chooseFromNavigation(props.index + 1);
                    } else if (event.key === 'Tab' && props.current()) {
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
                              onAuxClick: (event: SyntheticEvent) => {
                                  stop(event);
                                  if (!props.current()) event.preventDefault();
                              },
                              onContextMenu: (event: SyntheticEvent) => {
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
                props.index > 0
                    ? h(
                          ActionButton,
                          {
                              className: 'mx-sdk-url-gallery__previous',
                              ref: previousButton,
                              'aria-label': props.labels.previous,
                              onClick: () =>
                                  chooseFromNavigation(props.index - 1),
                          },
                          '‹'
                      )
                    : null,
                h(
                    'div',
                    { className: 'mx-sdk-url-gallery__preview' },
                    h(AttachmentPreview, {
                        key: props.mediaKey,
                        attachment: props.entry,
                        labels: props.labels,
                        owner: props.owner,
                        identity: props.identity,
                    })
                ),
                props.index < props.entries.length - 1
                    ? h(
                          ActionButton,
                          {
                              className: 'mx-sdk-url-gallery__next',
                              ref: nextButton,
                              'aria-label': props.labels.next,
                              onClick: () =>
                                  chooseFromNavigation(props.index + 1),
                          },
                          '›'
                      )
                    : null
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
                        'div',
                        {
                            key: `${item.id ?? ''}:${index}`,
                            className: 'mx-sdk-url-gallery__strip-item',
                        },
                        thumbnail(item, props),
                        h(ActionButton, {
                            className: 'mx-sdk-url-gallery__select',
                            'aria-label': `${props.labels.selectAttachment} ${index + 1}`,
                            'aria-pressed': index === props.index,
                            onClick: () => props.choose(index),
                        })
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
    const releaseActive = useRef<(() => void) | null>(null);
    const live = useRef<DialogProps | null>(null);
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const generation = resourceOwnerGeneration(props.owner);
    commitEffect(() => {
        live.current = props;
        if (props.disableDownload)
            setState({ pending: false, percent: 0, failed: false });
        return () => {
            live.current = null;
            releaseActive.current?.();
            releaseActive.current = null;
            active.current?.abort();
            active.current = null;
        };
    }, [props.entry.url, props.disableDownload, generation, props.identity]);
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
        const capturedOwner = props.owner;
        const capturedGeneration = generation;
        const capturedIdentity = props.identity;
        const current = () =>
            active.current === controller &&
            !controller.signal.aborted &&
            resourceOwnerCurrent(capturedOwner) &&
            Object.is(
                resourceOwnerGeneration(live.current?.owner),
                capturedGeneration
            ) &&
            Object.is(live.current?.identity, capturedIdentity) &&
            live.current?.disableDownload !== true &&
            live.current?.current() === true;
        const unsubscribe = watchResourceOwner(capturedOwner, () =>
            controller.abort()
        );
        releaseActive.current = unsubscribe;
        const document = event.currentTarget.ownerDocument;
        let anchor: HTMLAnchorElement | undefined;
        let objectURL: string | undefined;
        setState({ pending: true, percent: 0, failed: false });
        try {
            if (!current()) return;
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
            unsubscribe?.();
            if (releaseActive.current === unsubscribe)
                releaseActive.current = null;
            anchor?.removeAttribute('href');
            anchor?.remove();
            if (objectURL != null) URL.revokeObjectURL(objectURL);
            if (active.current === controller) {
                const settle = current();
                active.current = null;
                if (settle) setState((value) => ({ ...value, pending: false }));
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
