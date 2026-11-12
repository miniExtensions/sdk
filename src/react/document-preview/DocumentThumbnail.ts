import {
    createElement as h,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { CompleteHTMLRenderer } from '../html/CompleteHTMLRenderer.js';
import { LiteralText } from '../LiteralText.js';
import { RecoverableImage } from '../RecoverableImage.js';
import { DocumentPDF } from './DocumentPDF.js';
import {
    copyDocumentSource,
    decodeDocumentTIFF,
    loadDocumentSource,
    parseDocumentCSV,
    sanitizeDocumentHTML,
    type AdmittedDocument,
    type DocumentThumbnailLabels,
    type DocumentThumbnailOptions,
    type DocumentThumbnailSource,
} from './documentContent.js';

type Owner = { token?: unknown; isCurrent(): boolean };
type Props = {
    uri: string;
    options: DocumentThumbnailOptions;
    authoritySource?: DocumentThumbnailSource;
    owner?: Owner;
    identity?: unknown;
    visible: boolean;
    inert?: boolean;
    inGrid: boolean;
    pdfModal?: boolean;
    onDownload?: (
        bytes: Uint8Array,
        isCurrent: () => boolean,
        signal: AbortSignal
    ) => void;
};
const owned = (owner: Owner | undefined) => {
    try {
        return owner === undefined || owner.isCurrent() === true;
    } catch {
        return false;
    }
};
const defaults: DocumentThumbnailLabels = {
    loading: 'Loading document',
    unavailable: 'Document preview unavailable',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    resetZoom: 'Reset zoom',
    showAllPages: 'Show all pages',
    showSinglePage: 'Show one page',
    download: 'Download',
    page: 'Page',
};

function DocumentRaster({
    document,
    isCurrent,
    unavailable,
}: {
    document: AdmittedDocument;
    isCurrent(): boolean;
    unavailable: string;
}): ReactNode {
    const [url, setURL] = useState<string | null>(null);
    const ref = useRef<HTMLImageElement | null>(null);
    const imageRef = useCallback(
        (node: HTMLImageElement | null) => {
            ref.current?.removeAttribute('src');
            ref.current = node;
            if (node && url && isCurrent()) node.setAttribute('src', url);
        },
        [url, isCurrent]
    );
    useEffect(() => {
        if (!isCurrent()) return;
        const url = URL.createObjectURL(
            new Blob([document.bytes.buffer], { type: document.mimeType })
        );
        setURL(url);
        return () => {
            ref.current?.removeAttribute('src');
            URL.revokeObjectURL(url);
        };
    }, [document, isCurrent]);
    return url && isCurrent()
        ? h(RecoverableImage, {
              ref: imageRef,
              sources: [url],
              alt: '',
              style: {
                  maxWidth: '95%',
                  maxHeight: '95%',
                  objectFit: 'contain',
              },
              renderFallback: () => h('span', { role: 'status' }, unavailable),
          })
        : null;
}

function DocumentTIFF({
    document,
    isCurrent,
    unavailable,
}: {
    document: AdmittedDocument;
    isCurrent(): boolean;
    unavailable: string;
}): ReactNode {
    const ref = useRef<HTMLCanvasElement>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas || !isCurrent()) return;
        let active = true;
        void decodeDocumentTIFF(document.bytes)
            .then((image) => {
                if (!active || !isCurrent()) return;
                const context = canvas.getContext('2d');
                if (!context) throw Error('Canvas unavailable');
                canvas.width = image.width;
                canvas.height = image.height;
                const pixels = context.createImageData(
                    image.width,
                    image.height
                );
                pixels.data.set(image.rgba);
                context.putImageData(pixels, 0, 0);
                canvas.setAttribute('data-rendered-tiff', 'true');
            })
            .catch(() => {
                if (active && isCurrent()) setFailed(true);
            });
        return () => {
            active = false;
            canvas.removeAttribute('data-rendered-tiff');
            canvas.width = 0;
            canvas.height = 0;
        };
    }, [document, isCurrent]);
    return failed
        ? h('span', { role: 'status' }, unavailable)
        : h('canvas', {
              ref,
              'aria-label': 'TIFF',
              style: { maxWidth: '95%', maxHeight: '95%' },
          });
}

/** One SDK content leaf; it never changes the field's canonical URI/modal type. */
export function DocumentThumbnail(props: Props): ReactNode {
    const ownerCurrent = owned(props.owner);
    const options =
        props.visible && !props.inert && ownerCurrent
            ? props.options
            : undefined;
    const source = options?.source;
    const sourceKind = source?.kind;
    const sourceRevision = source?.revision;
    const sourceMime = source?.mimeType;
    const authority = props.authoritySource ?? source;
    const authorityKind = authority?.kind;
    const authorityRevision = authority?.revision;
    const authorityMime = authority?.mimeType;
    const authorityBytes =
        authority?.kind === 'bytes' ? authority.bytes : undefined;
    const workerUrl = options?.pdfWorkerUrl;
    const resourceBaseUrl = options?.pdfResourceBaseUrl;
    const token = props.owner?.token;
    const bytes = source?.kind === 'bytes' ? source.bytes : undefined;
    const copied = useMemo(
        () =>
            ownerCurrent && source?.kind === 'bytes'
                ? copyDocumentSource(source)
                : null,
        [
            source?.kind,
            source?.revision,
            source?.mimeType,
            bytes,
            ownerCurrent,
            props.uri,
            token === undefined ? props.owner : token,
            token,
            props.identity,
        ]
    );
    const key = useMemo(
        () => ({}),
        [
            props.uri,
            token === undefined ? props.owner : token,
            token,
            props.identity,
            props.visible,
            props.inert,
            props.inGrid,
            props.pdfModal,
            ownerCurrent,
            source?.kind,
            source?.revision,
            source?.mimeType,
            bytes,
            workerUrl,
            resourceBaseUrl,
            authorityKind,
            authorityRevision,
            authorityMime,
            authorityBytes,
        ]
    );
    const committed = useRef<{ key: object; props: Props } | null>(null);
    const flight = useRef<{ key: object; controller: AbortController } | null>(
        null
    );
    const commitEffect =
        typeof window === 'undefined' ? useEffect : useLayoutEffect;
    commitEffect(() => {
        committed.current = { key, props };
    });
    commitEffect(() => {
        const run = { key, controller: new AbortController() };
        flight.current = run;
        return () => {
            run.controller.abort();
            if (flight.current === run) flight.current = null;
            if (committed.current?.key === key) committed.current = null;
        };
    }, [key]);
    const current = useCallback(() => {
        const accepted = committed.current;
        const liveAuthority =
            accepted?.props.authoritySource ?? accepted?.props.options.source;
        return (
            accepted?.key === key &&
            accepted.props.visible &&
            !accepted.props.inert &&
            owned(accepted.props.owner) &&
            (sourceKind === 'uri' || sourceKind === 'bytes') &&
            accepted.props.owner?.token === token &&
            accepted.props.options?.source?.kind === sourceKind &&
            accepted.props.options.source.revision === sourceRevision &&
            accepted.props.options.source.mimeType === sourceMime &&
            (accepted.props.options.source.kind !== 'bytes' ||
                accepted.props.options.source.bytes === bytes) &&
            accepted.props.options.pdfWorkerUrl === workerUrl &&
            accepted.props.options.pdfResourceBaseUrl === resourceBaseUrl &&
            liveAuthority?.kind === authorityKind &&
            liveAuthority?.revision === authorityRevision &&
            liveAuthority?.mimeType === authorityMime &&
            (liveAuthority?.kind !== 'bytes' ||
                liveAuthority.bytes === authorityBytes) &&
            flight.current?.key === key &&
            !flight.current.controller.signal.aborted
        );
    }, [key]);
    const [state, setState] = useState<{
        key: object;
        document: AdmittedDocument | null;
        csv?: string[][];
        failed?: boolean;
    } | null>(null);
    const labels = { ...defaults };
    for (const name of Object.keys(
        labels
    ) as (keyof DocumentThumbnailLabels)[]) {
        const value = options?.labels?.[name];
        if (typeof value === 'string' && value.trim()) labels[name] = value;
    }
    useEffect(() => {
        const run = flight.current;
        if (!current() || !source || run === null) return;
        let active = true;
        const live = () => active && flight.current === run && current();
        void (async () => {
            const document =
                source.kind === 'bytes'
                    ? copied
                    : await loadDocumentSource(
                          props.uri,
                          source,
                          run.controller,
                          live
                      );
            if (!live()) return;
            const csv =
                document?.media === 'csv'
                    ? await parseDocumentCSV(
                          new TextDecoder().decode(document.bytes)
                      )
                    : undefined;
            if (live())
                setState({ key, document, csv, failed: document === null });
        })().catch(() => {
            if (live()) setState({ key, document: null, failed: true });
        });
        return () => {
            active = false;
        };
    }, [key, current, copied]);
    if (!props.visible || props.inert || !ownerCurrent) return null;
    const accepted = state?.key === key ? state : null;
    const document = accepted?.document;
    let content: ReactNode;
    if (!source || (sourceKind !== 'uri' && sourceKind !== 'bytes'))
        content = h('span', { role: 'status' }, labels.unavailable);
    else if (!accepted) content = h('span', { role: 'status' }, labels.loading);
    else if (!document || accepted.failed)
        content = h('span', { role: 'status' }, labels.unavailable);
    else if (document.media === 'text')
        content = h(LiteralText, {
            as: 'div',
            value: new TextDecoder().decode(document.bytes),
            preserveWhitespace: false,
            style: { padding: '30px', overflowWrap: 'anywhere' },
        });
    else if (document.media === 'html')
        content = h(CompleteHTMLRenderer, {
            inline: true,
            html: sanitizeDocumentHTML(
                new TextDecoder().decode(document.bytes)
            ),
            style: { width: '100%', height: '100%', pointerEvents: 'none' },
        });
    else if (document.media === 'csv') {
        const rows = accepted.csv ?? [];
        content = h(
            'table',
            { style: { width: '100%', borderCollapse: 'collapse' } },
            h(
                'thead',
                null,
                h(
                    'tr',
                    null,
                    ...(rows[0] ?? []).map((value, index) =>
                        h('th', { key: index, scope: 'col' }, value)
                    )
                )
            ),
            h(
                'tbody',
                null,
                ...rows
                    .slice(1)
                    .map((row, index) =>
                        h(
                            'tr',
                            { key: index },
                            ...row.map((value, column) =>
                                h('td', { key: column }, value)
                            )
                        )
                    )
            )
        );
    } else if (document.media === 'image')
        content = h(DocumentRaster, {
            document,
            isCurrent: current,
            unavailable: labels.unavailable,
        });
    else if (document.media === 'tiff')
        content = h(DocumentTIFF, {
            document,
            isCurrent: current,
            unavailable: labels.unavailable,
        });
    else
        content = h(DocumentPDF, {
            document,
            options: props.options,
            labels,
            inGrid: props.inGrid,
            showAllPages: props.pdfModal,
            isCurrent: current,
            onDownload: props.onDownload
                ? (bytes: Uint8Array) => {
                      const run = flight.current;
                      if (run && current())
                          props.onDownload?.(
                              bytes,
                              current,
                              run.controller.signal
                          );
                  }
                : undefined,
        });
    return h(
        'div',
        {
            'data-document-thumbnail': document?.media ?? 'loading',
            style: {
                height: '100%',
                width: '100%',
                overflow: 'auto',
                pointerEvents:
                    props.inGrid || props.pdfModal ? undefined : 'none',
            },
        },
        content
    );
}
