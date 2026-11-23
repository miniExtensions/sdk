import {
    createElement as h,
    Fragment,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { ActionButton } from './ActionButton.js';
import { LinkedFinderAttachmentIcon } from './LinkedFinderAttachmentCollection.js';
import { RecoverableImage } from './RecoverableImage.js';
import { DocumentThumbnail } from './document-preview/DocumentThumbnail.js';
import {
    documentMedia,
    isAdmittedDocumentUri,
    type DocumentThumbnailOptions,
    type DocumentThumbnailSource,
} from './document-preview/documentContent.js';
import { readResourceResponse } from './resourceResponse.js';

export type AttachmentGalleryDocument = {
    uri: string;
    options: DocumentThumbnailOptions;
    /** An explicitly admitted local response, owned by the current thumbnail. */
    readLocal?: (signal: AbortSignal) => Promise<Response>;
    /** The host admits the remote URI to the legacy Microsoft Office viewer. */
    legacyOfficePreview?: boolean;
};

type Layout = 'grid' | 'thumbnail' | 'icon';
type Icon = 'play' | 'document';
type Props = {
    attachment: { readonly filename?: string | null };
    imageSources: readonly string[];
    icon: Icon;
    document?: AttachmentGalleryDocument;
    layout: Layout;
    fit: 'cover' | 'contain';
    showNames: boolean;
    prepareImagesForPrint?: boolean;
    retryLabel: string;
};

const thumbnail = 'mx-sdk-attachment-gallery-thumbnail';
// Matches the native gallery's pinned @cyntler/react-doc-viewer 1.17.1 renderer.
const legacyOfficeTypes = new Set([
    'odt',
    'application/vnd.oasis.opendocument.text',
    'doc',
    'application/msword',
    'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
    'xls',
    'application/vnd.ms-excel',
    'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'ppt',
    'application/vnd.ms-powerpoint',
    'pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function fallback(icon: Icon, document = false) {
    return h(
        'div',
        {
            className:
                `${thumbnail}__fallback` +
                (document ? ` ${thumbnail}__fallback--document` : ''),
        },
        h(LinkedFinderAttachmentIcon, { play: icon === 'play' })
    );
}

function image({ attachment, imageSources, layout, fit, retryLabel }: Props) {
    return h(RecoverableImage, {
        sources: imageSources,
        alt: '',
        className: `${thumbnail}__image object-${layout === 'thumbnail' ? fit : 'cover'}`,
        renderFallback: (retry) =>
            h(
                'div',
                {
                    className: `${thumbnail}__fallback ${thumbnail}__fallback--retry`,
                    role: 'status',
                    'aria-label': `Could not load ${attachment.filename ?? 'attachment'}`,
                },
                h(LinkedFinderAttachmentIcon, { play: false }),
                h(
                    ActionButton,
                    {
                        className: `${thumbnail}__retry`,
                        onClick: (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            retry();
                        },
                    },
                    retryLabel
                )
            ),
    });
}

function documentSpinner(label?: string) {
    return h(
        'div',
        {
            className:
                `${thumbnail}__loading` +
                (label === undefined ? ` ${thumbnail}__loading--remote` : ''),
            'data-testid':
                label === undefined ? undefined : 'loading-component',
            role: label === undefined ? undefined : 'status',
            'aria-label': label,
            'aria-hidden': label === undefined || undefined,
        },
        h(
            'svg',
            {
                viewBox: '0 0 24 24',
                fill: 'none',
                'aria-hidden': true,
            },
            h('circle', {
                cx: 12,
                cy: 12,
                r: 10,
                stroke: 'currentColor',
                strokeWidth: 4,
                opacity: 0.25,
            }),
            h('path', {
                fill: 'currentColor',
                opacity: 0.75,
                d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z',
            })
        )
    );
}

function LocalDocumentThumbnail({
    uri,
    options,
    read,
    inGrid,
    icon,
}: {
    uri: string;
    options: DocumentThumbnailOptions;
    read: NonNullable<AttachmentGalleryDocument['readLocal']>;
    inGrid: boolean;
    icon: Icon;
}) {
    const { mimeType, revision } = options.source;
    const key = useMemo(() => ({}), [uri, read, mimeType, revision, inGrid]);
    const [result, setResult] = useState<{
        key: object;
        source: Extract<DocumentThumbnailSource, { kind: 'bytes' }> | null;
    } | null>(null);
    const commitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;
        const current = () => !signal.aborted;

        void (async () => {
            // Strict Mode can retire the first layout setup before opening transport.
            await Promise.resolve();
            if (!current()) return;
            const response = await read(signal);
            const type = documentMedia(
                mimeType ?? response.headers.get('Content-Type')
            );
            if (!current() || type === null) {
                if (response.body && !response.body.locked)
                    void response.body.cancel().catch(() => {});
                if (current()) setResult({ key, source: null });
                return;
            }
            const chunks = await readResourceResponse(
                response,
                signal,
                current
            );
            if (!current()) return;
            const bytes = new Uint8Array(
                chunks.reduce((size, chunk) => size + chunk.byteLength, 0)
            );
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
            }
            setResult({
                key,
                source: {
                    kind: 'bytes',
                    revision: key,
                    mimeType: type.mimeType,
                    bytes,
                },
            });
        })().catch(() => {
            if (current()) setResult({ key, source: null });
        });

        return () => controller.abort();
    }, [key, mimeType, read]);

    if (result?.key !== key)
        return documentSpinner(options.labels?.loading ?? 'Loading document');
    if (result.source === null) return fallback(icon, true);
    return h(DocumentThumbnail, {
        uri,
        options: { ...options, source: result.source },
        visible: true,
        inGrid,
        unavailable: fallback(icon, true),
    });
}

function LegacyRemoteDocumentThumbnail({
    uri,
    options,
    inGrid,
    icon,
}: {
    uri: string;
    options: DocumentThumbnailOptions;
    inGrid: boolean;
    icon: Icon;
}) {
    const revision = options.source.revision;
    const key = useMemo(() => ({}), [uri, revision]);
    const [probe, setProbe] = useState<{
        key: object;
        contentType: string | null;
    } | null>(null);
    const commitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;

        void (async () => {
            await Promise.resolve();
            if (signal.aborted) return;
            const response = await fetch(uri, {
                method: 'HEAD',
                credentials: 'omit',
                signal,
            });
            if (response.body && !response.body.locked)
                void response.body.cancel().catch(() => {});
            if (!signal.aborted)
                setProbe({
                    key,
                    contentType: response.ok
                        ? (response.headers
                              .get('Content-Type')
                              ?.split(';', 1)[0] ?? null)
                        : null,
                });
        })().catch(() => {
            if (!signal.aborted) setProbe({ key, contentType: null });
        });

        return () => controller.abort();
    }, [key, uri]);

    if (probe?.key !== key)
        return documentSpinner(options.labels?.loading ?? 'Loading document');
    const { contentType } = probe;
    if (contentType !== null && legacyOfficeTypes.has(contentType))
        return h(
            'div',
            { id: 'msdoc-renderer', className: `${thumbnail}__office` },
            h('iframe', {
                id: 'msdoc-iframe',
                title: 'msdoc-iframe',
                src: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(uri)}`,
                frameBorder: '0',
            })
        );

    const type = documentMedia(contentType);
    if (type === null) return fallback(icon, true);
    return h(DocumentThumbnail, {
        uri,
        options: {
            ...options,
            source: { kind: 'uri', revision, mimeType: type.mimeType },
        },
        visible: true,
        inGrid,
        unavailable: fallback(icon, true),
    });
}

function documentThumbnail(
    { uri, options, readLocal, legacyOfficePreview }: AttachmentGalleryDocument,
    inGrid: boolean,
    icon: Icon
) {
    const preview =
        readLocal != null && options.source.kind === 'uri'
            ? h(LocalDocumentThumbnail, {
                  uri,
                  options,
                  read: readLocal,
                  inGrid,
                  icon,
              })
            : legacyOfficePreview === true &&
                options.source.kind === 'uri' &&
                options.source.mimeType === undefined &&
                isAdmittedDocumentUri(uri)
              ? h(LegacyRemoteDocumentThumbnail, { uri, options, inGrid, icon })
              : h(DocumentThumbnail, {
                    uri,
                    options,
                    visible: true,
                    inGrid,
                    unavailable: fallback(icon, true),
                });
    return h(
        'div',
        {
            className: `${thumbnail}__document${inGrid ? ' object-cover' : ''}`,
        },
        preview,
        documentSpinner()
    );
}

function ObservedThumbnail(props: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const node = ref.current;
        const Observer =
            node?.ownerDocument.defaultView?.IntersectionObserver ??
            globalThis.IntersectionObserver;
        if (!node || !Observer) return;
        let active = true;
        const observer = new Observer(([entry]) => {
            if (active && entry) setInView(entry.isIntersecting);
        });
        observer.observe(node);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, []);

    const hasImage = props.imageSources.length > 0;
    let content: ReactNode = null;
    if (hasImage && (inView || props.prepareImagesForPrint))
        content = image(props);
    else if (inView)
        content = props.document
            ? documentThumbnail(
                  props.document,
                  props.layout === 'grid',
                  props.icon
              )
            : fallback(props.icon);

    return h(
        'div',
        {
            title: '',
            ref,
            className: `${thumbnail}__visual ${thumbnail}__visual--${props.layout}`,
        },
        content
    );
}

/** Visual tile only. The gallery separately owns opening and editing controls. */
export function AttachmentGalleryThumbnail(props: Props): ReactNode {
    const caption =
        props.layout !== 'grid' && props.showNames
            ? h(
                  'p',
                  {
                      className: `${thumbnail}__caption`,
                      'data-testid': 'attachmentThumbnailCaptionTestId',
                  },
                  props.attachment.filename
              )
            : null;
    if (props.layout === 'icon')
        return h(
            'div',
            { className: `${thumbnail}--icon` },
            h(
                'div',
                {
                    className: `${thumbnail}__visual ${thumbnail}__visual--icon`,
                },
                props.imageSources.length > 0
                    ? image(props)
                    : fallback(props.icon)
            ),
            caption
        );
    return h(
        Fragment,
        null,
        h(ObservedThumbnail, { ...props, key: props.layout }),
        caption
    );
}
