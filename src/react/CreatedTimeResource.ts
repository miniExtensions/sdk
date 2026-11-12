import {
    createElement as h,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import { checkIfPageUrlIsValid } from '../forms/pageUrlValidation.js';
import { ActionButton } from './ActionButton.js';
import { RecoverableImage } from './RecoverableImage.js';
import { CompleteHTMLRenderer } from './html/CompleteHTMLRenderer.js';
import { readResourceResponse } from './resourceResponse.js';
import { DocumentThumbnail } from './document-preview/DocumentThumbnail.js';
import {
    admitsDocumentThumbnail,
    modalPDFOptions,
    type DocumentThumbnailOptions,
} from './document-preview/documentContent.js';

export type CreatedTimeDisplayOwner = {
    token?: unknown;
    isCurrent(): boolean;
};

export type CreatedTimeAttachmentOptions = {
    /** Explicit current-URI/owned-byte admission for document thumbnails. */
    documentPreview?: DocumentThumbnailOptions;
    isInGrid?: boolean;
    displayMode?: 'thumbnail' | 'icon';
    thumbnailSize?: 'small' | 'medium' | 'large';
    thumbFitType?: 'cover' | 'contain';
    hideAttachmentName?: boolean;
    disableOpenFiles?: boolean;
    disableDownloadFiles?: boolean;
};

export type CreatedTimeResourceLabels = {
    openLink: string;
    invalidLink: string;
    openAttachment: string;
    attachments: string;
    open: string;
    download: string;
    close: string;
    tryAgain: string;
    previewUnavailable: string;
    imageUnavailable: string;
    downloadFailed: string;
};

export type CreatedTimeResourceProps = {
    mode: 'button' | 'attachment';
    /** An explicitly normalized resource, never a URL extracted from prose. */
    href: string | null;
    owner?: CreatedTimeDisplayOwner;
    /** Current record/source identity; changing it also closes an open preview. */
    identity?: unknown;
    inert?: boolean;
    buttonLabel?: string | null;
    labels?: Partial<CreatedTimeResourceLabels>;
    attachmentOptions?: CreatedTimeAttachmentOptions;
    className?: string;
};

const defaultLabels: CreatedTimeResourceLabels = {
    openLink: 'Open link',
    invalidLink: 'Invalid link',
    openAttachment: 'Open attachment',
    attachments: 'Attachments',
    open: 'Open',
    download: 'Download',
    close: 'Close',
    tryAgain: 'Try again',
    previewUnavailable: 'Attachment preview is not available',
    imageUnavailable: 'Could not load attachment',
    downloadFailed: 'Could not download attachment',
};

type TrackedNode = {
    node: Element;
    attributes: Record<string, string>;
};
type Download = {
    controller: AbortController;
    body: ReadableStream<Uint8Array> | null;
    anchor: HTMLAnchorElement | null;
    objectURL: string | null;
};
type Lease = {
    id: number;
    active: boolean;
    nodes: Set<TrackedNode>;
    download: Download | null;
};
type Accepted = {
    lease: Lease;
    props: CreatedTimeResourceProps;
    href: string | null;
};

const stop = (event: SyntheticEvent) => event.stopPropagation();
const contain = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
};
const currentOwner = (owner: CreatedTimeDisplayOwner | undefined): boolean => {
    try {
        return owner === undefined || owner.isCurrent() === true;
    } catch {
        return false;
    }
};

function resourceHref(props: CreatedTimeResourceProps): string | null {
    const href = props.href;
    if (typeof href !== 'string' || !checkIfPageUrlIsValid(href)) return null;
    if (/^https?:\/\//i.test(href)) return href;
    return props.mode === 'button' && /^mailto:/i.test(href) ? href : null;
}

function labelsFor(overrides: CreatedTimeResourceProps['labels']) {
    const labels = { ...defaultLabels };
    for (const key of Object.keys(
        labels
    ) as (keyof CreatedTimeResourceLabels)[]) {
        const value = overrides?.[key];
        if (typeof value === 'string' && value.trim()) labels[key] = value;
    }
    return labels;
}

function clearNode(record: TrackedNode) {
    for (const attribute of Object.keys(record.attributes))
        record.node.removeAttribute(attribute);
}

/** Stable refs also clear detached nodes, including React 19 ref replay. */
function trackedRef<T extends Element>(
    lease: Lease,
    attributes: Record<string, string>,
    descendants?: string
) {
    let records: TrackedNode[] = [];
    return (node: T | null) => {
        for (const record of records) {
            clearNode(record);
            lease.nodes.delete(record);
        }
        records = [];
        if (node === null) return;
        const targets = descendants
            ? Array.from(node.querySelectorAll(descendants))
            : [node];
        records = targets.map((target) => ({ node: target, attributes }));
        for (const record of records) {
            lease.nodes.add(record);
            if (lease.active)
                for (const [name, value] of Object.entries(attributes))
                    record.node.setAttribute(name, value);
        }
    };
}

function cleanDownload(download: Download) {
    download.anchor?.removeAttribute('href');
    download.anchor?.remove();
    download.anchor = null;
    if (download.objectURL !== null) {
        URL.revokeObjectURL(download.objectURL);
        download.objectURL = null;
    }
}

function abortDownload(download: Download) {
    download.controller.abort();
    const resource = download.body;
    if (resource !== null) {
        try {
            void resource.cancel().catch(() => {});
        } catch {
            // Retirement or settlement may already have released this resource.
        }
    }
}

function cancelDownload(lease: Lease) {
    const download = lease.download;
    if (download === null) return;
    lease.download = null;
    abortDownload(download);
    cleanDownload(download);
}

function retire(lease: Lease) {
    lease.active = false;
    for (const record of lease.nodes) clearNode(record);
    cancelDownload(lease);
}

function allowsDownload(accepted: Accepted): boolean {
    return (
        accepted.props.mode === 'attachment' &&
        accepted.href !== null &&
        accepted.props.attachmentOptions?.disableDownloadFiles !== true &&
        !accepted.href.startsWith(
            'https://firebasestorage.googleapis.com/v0/b/'
        )
    );
}

const imageURL = (href: string) =>
    /\.(?:png|jpg|gif|bmp|jpeg)(?:[?#]|$)/i.test(href);
// Legacy URL-only glyph selection; it does not infer MIME or enable playback.
const mediaURL = (href: string) =>
    /.(?:r\d\d|r\d\d\d|mp3|wav|ogg|flac|aac|wma|aiff|au|raw|wv|webm|mp4|m4a|3gp|3g2|3gpp|3gpp2|amr|awb|dct|dss|dvf|flv|gsm|ivs|m4v|mkv|mmf|mpg|msv|oga|ogv|opus|rm|rmvb|sln|tta|vob|vox|wmv|mov|avi)$/.test(
        href.toLowerCase()
    );
const attributeEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};
const escapeAttribute = (value: string) =>
    value.replace(/[&<>"']/g, (character) => attributeEscapes[character]!);

/** Readonly URL navigation and one resource; no field, provider or write owner. */
export function CreatedTimeResource(
    props: CreatedTimeResourceProps
): ReactNode {
    const href = resourceHref(props);
    const ownerCurrent = currentOwner(props.owner);
    const allowed = props.inert !== true && ownerCurrent;
    const labels = labelsFor(props.labels);
    const options = props.attachmentOptions;
    const inGrid = options?.isInGrid === true;
    const iconMode = !inGrid && options?.displayMode === 'icon';
    const ownerToken = props.owner?.token;
    const ownerKey = ownerToken === undefined ? props.owner : ownerToken;
    const sequence = useRef(0);
    const lease = useMemo<Lease>(
        () => ({
            id: ++sequence.current,
            active: false,
            nodes: new Set(),
            download: null,
        }),
        [
            props.mode,
            href,
            ownerKey,
            ownerToken,
            props.identity,
            props.inert,
            ownerCurrent,
        ]
    );
    const lifetime = useMemo(
        () => ({}),
        [props.identity, ownerToken, props.mode]
    );
    const viewport = useRef<HTMLDivElement>(null);
    const viewportGeneration = useMemo(() => ({}), [lease, iconMode, inGrid]);
    const [visibility, setVisibility] = useState({
        generation: viewportGeneration,
        inView: false,
    });
    const thumbnailVisible =
        iconMode ||
        (visibility.generation === viewportGeneration && visibility.inView);
    const accepted = useRef<Accepted | null>(null);
    const modalView = useRef<{ lifetime: object; open: boolean } | null>(null);
    const [modal, setModal] = useState({ lifetime, open: false });
    const [downloadState, setDownloadState] = useState({
        lease,
        pending: false,
        percent: 0,
        failed: false,
    });
    const modalOpen =
        allowed &&
        href !== null &&
        props.mode === 'attachment' &&
        modal.lifetime === lifetime &&
        modal.open;
    const dialog = useRef<HTMLDialogElement>(null);
    const commitEffect =
        typeof document === 'undefined' ? useEffect : useLayoutEffect;
    const linkRef = useMemo(
        () => trackedRef<HTMLAnchorElement>(lease, { href: href ?? '' }),
        [lease]
    );
    const openRef = useMemo(
        () => trackedRef<HTMLAnchorElement>(lease, { href: href ?? '' }),
        [lease]
    );
    const thumbnailRef = useMemo(
        () => trackedRef<HTMLImageElement>(lease, { src: href ?? '' }),
        [lease]
    );
    const previewRef = useMemo(
        () => trackedRef<HTMLImageElement>(lease, { src: href ?? '' }),
        [lease]
    );
    const pdfRef = useMemo(
        () =>
            trackedRef<HTMLDivElement>(
                lease,
                { src: `${href ?? ''}#toolbar=0` },
                'iframe'
            ),
        [lease]
    );

    const current = (): Accepted | null => {
        const active = accepted.current;
        return lease.active &&
            active?.lease === lease &&
            active.props.owner?.token === ownerToken &&
            active.props.inert !== true &&
            currentOwner(active.props.owner)
            ? active
            : null;
    };

    useEffect(() => {
        const node = viewport.current;
        if (!node || props.mode !== 'attachment' || iconMode || !allowed)
            return;
        const Observer = node.ownerDocument.defaultView?.IntersectionObserver;
        // Unknown visibility never grants permission to mount remote previews.
        if (typeof Observer !== 'function') return;
        let active = true;
        const observer = new Observer((entries) => {
            if (!active || !current()) return;
            const entry = entries.find(
                (candidate) => candidate.target === node
            );
            if (entry)
                setVisibility({
                    generation: viewportGeneration,
                    inView: entry.isIntersecting,
                });
        });
        observer.observe(node);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [viewportGeneration]);

    commitEffect(() => {
        accepted.current = { lease, props, href };
        lease.active = allowed && currentOwner(props.owner);
        if (lease.active)
            for (const record of lease.nodes)
                for (const [name, value] of Object.entries(record.attributes))
                    record.node.setAttribute(name, value);
        else retire(lease);
        return () => {
            if (accepted.current?.lease === lease) accepted.current = null;
            retire(lease);
        };
    }, [lease]);
    commitEffect(() => {
        if (accepted.current?.lease === lease)
            accepted.current = { lease, props, href };
        modalView.current = { lifetime, open: modalOpen };
        if ((!allowed || href === null) && modal.open)
            setModal((previous) =>
                previous.open ? { ...previous, open: false } : previous
            );
        if (
            !allowsDownload({ lease, props, href }) &&
            lease.download !== null
        ) {
            cancelDownload(lease);
            setDownloadState({
                lease,
                pending: false,
                percent: 0,
                failed: false,
            });
        }
    });
    commitEffect(() => {
        if (!modalOpen || dialog.current === null) return;
        const node = dialog.current;
        const previous = node.ownerDocument.activeElement;
        if (!node.open) node.showModal();
        return () => {
            if (node.open) node.close();
            const active = accepted.current;
            if (
                active?.lease.active &&
                active.props.identity === props.identity &&
                active.props.owner?.token === ownerToken &&
                active.props.inert !== true &&
                currentOwner(active.props.owner) &&
                previous?.isConnected &&
                'focus' in previous &&
                typeof previous.focus === 'function'
            )
                previous.focus();
        };
    }, [modalOpen, lifetime]);

    const close = () => {
        if (!current() || modalView.current?.lifetime !== lifetime) return;
        setModal((previous) =>
            previous.lifetime === lifetime && previous.open
                ? { lifetime, open: false }
                : previous
        );
    };
    const validLink = (
        event: SyntheticEvent<HTMLAnchorElement>,
        modalOnly = false
    ) => {
        event.stopPropagation();
        const active = current();
        if (
            !active ||
            active.href !== href ||
            (modalOnly &&
                (active.props.attachmentOptions?.disableOpenFiles === true ||
                    modalView.current?.lifetime !== lifetime ||
                    !modalView.current.open))
        ) {
            event.preventDefault();
            event.currentTarget.removeAttribute('href');
        }
    };

    const startDownload = async (
        ownerDocument: Document,
        thumbnailBytes?: Uint8Array,
        documentCurrent: () => boolean = () => true,
        documentSignal?: AbortSignal
    ) => {
        const active = current();
        if (
            !active ||
            !documentCurrent() ||
            documentSignal?.aborted ||
            !allowsDownload(active) ||
            active.href === null ||
            lease.download !== null ||
            (thumbnailBytes === undefined
                ? modalView.current?.lifetime !== lifetime ||
                  !modalView.current.open
                : active.props.attachmentOptions?.isInGrid !== true)
        )
            return;
        const target = active.href;
        const download: Download = {
            controller: new AbortController(),
            body: null,
            anchor: null,
            objectURL: null,
        };
        lease.download = download;
        const retired = () => abortDownload(download);
        documentSignal?.addEventListener('abort', retired, { once: true });
        const live = () => {
            const latest = current();
            return (
                latest !== null &&
                documentCurrent() &&
                latest.href === target &&
                allowsDownload(latest) &&
                lease.download === download &&
                !download.controller.signal.aborted
            );
        };
        const mounted = () => lease.active && accepted.current?.lease === lease;
        setDownloadState({ lease, pending: true, percent: 0, failed: false });
        let failed = false;
        let completed = false;
        try {
            const response =
                thumbnailBytes !== undefined
                    ? new Response(new Uint8Array(thumbnailBytes))
                    : await fetch(target, {
                          signal: download.controller.signal,
                          credentials: 'omit',
                      });
            download.body = response.body;
            if (!live()) return;
            const chunks = await readResourceResponse(
                response,
                download.controller.signal,
                live,
                (received, length) => {
                    if (length !== null)
                        setDownloadState({
                            lease,
                            pending: true,
                            percent: Math.min(100, (received / length) * 100),
                            failed: false,
                        });
                }
            );
            completed = true;
            if (!live()) return;
            download.objectURL = URL.createObjectURL(new Blob(chunks));
            if (!live()) return;
            const anchor = ownerDocument.createElement('a');
            download.anchor = anchor;
            anchor.href = download.objectURL;
            anchor.download = 'Unnamed';
            anchor.style.display = 'none';
            ownerDocument.body.append(anchor);
            if (live()) anchor.click();
        } catch {
            failed = live();
        } finally {
            documentSignal?.removeEventListener('abort', retired);
            if (!completed) abortDownload(download);
            cleanDownload(download);
            const ownsDownload = lease.download === download;
            if (ownsDownload) lease.download = null;
            if (mounted() && ownsDownload)
                setDownloadState({ lease, pending: false, percent: 0, failed });
        }
    };

    const glyph = (media = false) =>
        h(
            'span',
            { 'aria-hidden': true, style: { fontSize: '2rem' } },
            media ? '▶' : '▧'
        );
    const unavailable = () =>
        h(
            'div',
            {
                className: 'mx-sdk-created-time-preview-unavailable',
                style: {
                    display: 'grid',
                    placeItems: 'center',
                    gap: '0.5rem',
                    padding: '1rem',
                },
            },
            glyph(href !== null && mediaURL(href)),
            h('p', null, labels.previewUnavailable)
        );
    const imageFallback = (retry: () => void) =>
        h(
            'div',
            {
                role: 'status',
                'aria-label': labels.imageUnavailable,
                style: {
                    display: 'grid',
                    placeItems: 'center',
                    position: 'relative',
                    zIndex: 2,
                },
            },
            glyph(),
            h('span', null, labels.imageUnavailable),
            h(
                ActionButton,
                {
                    className: 'mx-sdk-button',
                    onClick: (event: SyntheticEvent) => {
                        contain(event);
                        if (current()) retry();
                    },
                },
                labels.tryAgain
            )
        );
    const outer = {
        style:
            props.mode === 'attachment' && inGrid
                ? { height: '100%', minHeight: 0, minWidth: 0 }
                : undefined,
        className: ['mx-sdk-created-time-resource', props.className]
            .filter(Boolean)
            .join(' '),
        onClick: stop,
        onAuxClick: stop,
        onDoubleClick: stop,
        onPointerDown: stop,
        onPointerUp: stop,
        onKeyDown: stop,
        onKeyUp: stop,
    };
    if (!ownerCurrent) return null;
    if (props.mode === 'button') {
        const label =
            typeof props.buttonLabel === 'string' && props.buttonLabel.trim()
                ? props.buttonLabel.trim()
                : href === null
                  ? labels.invalidLink
                  : labels.openLink;
        return h(
            'div',
            outer,
            allowed && href !== null
                ? h(
                      'a',
                      {
                          key: lease.id,
                          ref: linkRef,
                          href,
                          target: '_blank',
                          rel: 'noreferrer',
                          className:
                              'mx-sdk-button mx-sdk-created-time-url-button',
                          onClick: (event: SyntheticEvent<HTMLAnchorElement>) =>
                              validLink(event),
                          onAuxClick: (
                              event: SyntheticEvent<HTMLAnchorElement>
                          ) => validLink(event),
                          onContextMenu: (
                              event: SyntheticEvent<HTMLAnchorElement>
                          ) => validLink(event),
                      },
                      label
                  )
                : h(
                      ActionButton,
                      { className: 'mx-sdk-button', disabled: true },
                      label
                  )
        );
    }
    if (!allowed || href === null) return h('div', outer, unavailable());

    const size = options?.thumbnailSize ?? 'large';
    const columns = size === 'small' ? 4 : size === 'medium' ? 3 : 2;
    const image = imageURL(href);
    const busy = downloadState.lease === lease && downloadState.pending;
    const failed = downloadState.lease === lease && downloadState.failed;
    const pdfHTML = `<iframe src="${escapeAttribute(href + '#toolbar=0')}" title="${escapeAttribute(labels.attachments)}" width="100%" height="100%" frameborder="0"></iframe>`;
    const ownedPDF = modalPDFOptions(options?.documentPreview);
    const preview = image
        ? h(RecoverableImage, {
              key: lease.id,
              ref: previewRef,
              sources: [href],
              alt: '',
              style: {
                  maxHeight: '100%',
                  maxWidth: '100%',
                  objectFit: 'contain',
              },
              renderFallback: imageFallback,
          })
        : href.endsWith('.pdf') && options?.documentPreview
          ? ownedPDF
              ? h(DocumentThumbnail, {
                    uri: href,
                    options: ownedPDF,
                    authoritySource: options.documentPreview.source,
                    owner: props.owner,
                    identity: props.identity,
                    visible: modalOpen,
                    inert: props.inert,
                    inGrid: false,
                    pdfModal: true,
                })
              : unavailable()
          : href.endsWith('.pdf') && /^https:\/\//i.test(href)
            ? h(CompleteHTMLRenderer, {
                  key: `${lease.id}:${pdfHTML}`,
                  ref: pdfRef,
                  html: pdfHTML,
                  inline: true,
                  style: { height: '100%', width: '100%' },
              })
            : unavailable();
    return h(
        'div',
        outer,
        h(
            'ul',
            {
                'aria-label': labels.attachments,
                style: {
                    display: inGrid ? 'flex' : iconMode ? 'block' : 'grid',
                    gridTemplateColumns:
                        iconMode || inGrid
                            ? undefined
                            : `repeat(${columns}, minmax(0, 1fr))`,
                    gap: '0.25rem',
                    padding: 0,
                    margin: 0,
                    listStyle: 'none',
                    height: inGrid ? '100%' : undefined,
                    minHeight: inGrid ? 0 : undefined,
                },
            },
            h(
                'li',
                {
                    style: {
                        position: 'relative',
                        minWidth: 0,
                        minHeight: inGrid ? 0 : undefined,
                        flex: inGrid ? '1 1 0' : undefined,
                        height: inGrid ? '100%' : undefined,
                    },
                },
                h(
                    'div',
                    {
                        ref: viewport,
                        style: {
                            display: iconMode ? 'flex' : 'grid',
                            placeItems: 'center',
                            alignItems: 'center',
                            position: 'relative',
                            aspectRatio:
                                iconMode || inGrid ? undefined : '1 / 1',
                            minHeight: inGrid ? 0 : undefined,
                            minWidth: inGrid ? 0 : undefined,
                            boxSizing: 'border-box',
                            height: iconMode
                                ? '3.5rem'
                                : inGrid
                                  ? '100%'
                                  : undefined,
                            border: '1px solid #d1d5db',
                            borderRadius: '0.5rem',
                            overflow: 'hidden',
                            background: '#e5e7eb',
                        },
                    },
                    !thumbnailVisible
                        ? null
                        : image
                          ? h(RecoverableImage, {
                                key: lease.id,
                                ref: thumbnailRef,
                                sources: [href],
                                alt: '',
                                loading: 'lazy',
                                style: {
                                    height: '100%',
                                    width: iconMode ? '3.5rem' : '100%',
                                    flexShrink: 0,
                                    objectFit:
                                        !iconMode &&
                                        !inGrid &&
                                        options?.thumbFitType === 'contain'
                                            ? 'contain'
                                            : 'cover',
                                },
                                renderFallback: imageFallback,
                            })
                          : options?.documentPreview &&
                              admitsDocumentThumbnail(href, inGrid, iconMode)
                            ? h(DocumentThumbnail, {
                                  uri: href,
                                  options: options.documentPreview,
                                  owner: props.owner,
                                  identity: props.identity,
                                  visible: thumbnailVisible,
                                  inert: props.inert,
                                  inGrid,
                                  onDownload: allowsDownload({
                                      lease,
                                      props,
                                      href,
                                  })
                                      ? (
                                            bytes: Uint8Array,
                                            documentCurrent: () => boolean,
                                            documentSignal: AbortSignal
                                        ) => {
                                            const document =
                                                viewport.current?.ownerDocument;
                                            if (document && current())
                                                void startDownload(
                                                    document,
                                                    bytes,
                                                    documentCurrent,
                                                    documentSignal
                                                );
                                        }
                                      : undefined,
                              })
                            : glyph(mediaURL(href))
                ),
                options?.hideAttachmentName === false && !inGrid
                    ? h('p', {
                          'aria-hidden': true,
                          style: { margin: iconMode ? 0 : '0.25rem 0 0' },
                      })
                    : null,
                options?.disableOpenFiles !== true
                    ? h(
                          ActionButton,
                          {
                              'aria-label': href,
                              style: {
                                  position: 'absolute',
                                  inset: 0,
                                  zIndex: 1,
                                  border: 0,
                                  background: 'transparent',
                                  cursor: 'pointer',
                              },
                              onClick: (event: SyntheticEvent) => {
                                  contain(event);
                                  const active = current();
                                  if (
                                      active &&
                                      active.props.attachmentOptions
                                          ?.disableOpenFiles !== true
                                  )
                                      setModal({ lifetime, open: true });
                              },
                          },
                          h(
                              'span',
                              {
                                  style: {
                                      position: 'absolute',
                                      width: 1,
                                      height: 1,
                                      overflow: 'hidden',
                                      clipPath: 'inset(50%)',
                                  },
                              },
                              labels.openAttachment
                          )
                      )
                    : null
            )
        ),
        modalOpen
            ? h(
                  'dialog',
                  {
                      ref: dialog,
                      className: 'mx-sdk-created-time-resource-dialog',
                      'aria-label': labels.attachments,
                      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
                          contain(event);
                          if (event.target === event.currentTarget) close();
                      },
                      onClose: (event: SyntheticEvent<HTMLDialogElement>) => {
                          event.stopPropagation();
                          if (event.target === event.currentTarget) close();
                      },
                      onClick: (event: SyntheticEvent<HTMLDialogElement>) => {
                          contain(event);
                          if (event.target === event.currentTarget) close();
                      },
                      onKeyDown: stop,
                      style: {
                          width: 'min(92vw, 60rem)',
                          height: 'min(85vh, 45rem)',
                          border: 0,
                          padding: '1rem',
                          background: '#111827',
                          color: '#fff',
                          overflow: 'auto',
                      },
                  },
                  h(
                      'style',
                      null,
                      '.mx-sdk-created-time-resource-dialog::backdrop { background: rgba(0,0,0,0.7); }'
                  ),
                  h(
                      'div',
                      {
                          style: {
                              display: 'flex',
                              height: '100%',
                              flexDirection: 'column',
                              gap: '0.75rem',
                          },
                      },
                      h(
                          'div',
                          {
                              style: {
                                  display: 'flex',
                                  justifyContent: 'flex-end',
                                  gap: '0.75rem',
                              },
                          },
                          options?.disableDownloadFiles !== true &&
                              !href.startsWith(
                                  'https://firebasestorage.googleapis.com/v0/b/'
                              )
                              ? h(
                                    ActionButton,
                                    {
                                        className: 'mx-sdk-button',
                                        busy,
                                        onClick: (
                                            event: SyntheticEvent<HTMLButtonElement>
                                        ) => {
                                            contain(event);
                                            void startDownload(
                                                event.currentTarget
                                                    .ownerDocument
                                            );
                                        },
                                    },
                                    busy
                                        ? `${downloadState.percent.toFixed()}%`
                                        : labels.download
                                )
                              : null,
                          options?.disableOpenFiles !== true
                              ? h(
                                    'a',
                                    {
                                        key: lease.id,
                                        ref: openRef,
                                        href,
                                        target: '_blank',
                                        rel: 'noreferrer',
                                        className: 'mx-sdk-button',
                                        onClick: (
                                            event: SyntheticEvent<HTMLAnchorElement>
                                        ) => validLink(event, true),
                                        onAuxClick: (
                                            event: SyntheticEvent<HTMLAnchorElement>
                                        ) => validLink(event, true),
                                        onContextMenu: (
                                            event: SyntheticEvent<HTMLAnchorElement>
                                        ) => validLink(event, true),
                                    },
                                    labels.open
                                )
                              : null,
                          h(
                              ActionButton,
                              {
                                  className: 'mx-sdk-button',
                                  onClick: (event: SyntheticEvent) => {
                                      contain(event);
                                      close();
                                  },
                              },
                              labels.close
                          )
                      ),
                      failed
                          ? h('p', { role: 'alert' }, labels.downloadFailed)
                          : null,
                      h(
                          'div',
                          {
                              style: {
                                  display: 'grid',
                                  placeItems: 'center',
                                  minHeight: 0,
                                  flex: 1,
                                  overflow: 'auto',
                              },
                          },
                          preview
                      )
                  )
              )
            : null
    );
}
