import {
    createElement as h,
    useEffect,
    useRef,
    useState,
    type ReactNode,
    type SyntheticEvent,
} from 'react';
import type {
    PDFDocumentProxy,
    PDFDocumentLoadingTask,
    PDFWorker,
    RenderTask,
} from 'pdfjs-dist';
import { ActionButton } from '../ActionButton.js';
import { documentPDFResourcePath } from './pdfResources.js';
import { readResourceResponse } from '../resourceResponse.js';
import type {
    AdmittedDocument,
    DocumentThumbnailLabels,
    DocumentThumbnailOptions,
} from './documentContent.js';

export const documentPDFVersion = '6.5.438';

export function localDocumentAsset(
    value: unknown,
    ownerDocument: Document
): string | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    try {
        const url = new URL(value, ownerDocument.baseURI);
        const origin = new URL(ownerDocument.URL).origin;
        return /^https?:$/.test(url.protocol) &&
            url.origin === origin &&
            !url.username &&
            !url.password &&
            !url.hash
            ? url.href
            : null;
    } catch {
        return null;
    }
}

type PDFProps = {
    document: AdmittedDocument;
    options: DocumentThumbnailOptions;
    labels: DocumentThumbnailLabels;
    inGrid: boolean;
    showAllPages?: boolean;
    isCurrent(): boolean;
    onDownload?: (bytes: Uint8Array) => void;
};

function PDFPage({
    document,
    pageNumber,
    zoom,
    isCurrent,
    failed,
}: {
    document: PDFDocumentProxy;
    pageNumber: number;
    zoom: number;
    isCurrent(): boolean;
    failed(): void;
}): ReactNode {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = ref.current;
        if (!canvas || !isCurrent()) return;
        let active = true;
        let task: RenderTask | null = null;
        const current = () => active && isCurrent();
        void (async () => {
            const page = await document.getPage(pageNumber);
            if (!current()) {
                if (active) failed();
                return;
            }
            const context = canvas.getContext('2d');
            if (!context) throw Error('Canvas unavailable');
            const initial = page.getViewport({ scale: 1 });
            const width = canvas.parentElement?.clientWidth || initial.width;
            const viewport = page.getViewport({
                scale: Math.max(0.1, width / initial.width) * zoom,
            });
            canvas.width = Math.ceil(viewport.width);
            canvas.height = Math.ceil(viewport.height);
            task = page.render({ canvas, canvasContext: context, viewport });
            await task.promise;
            if (current())
                canvas.setAttribute('data-rendered-page', String(pageNumber));
            else if (active) failed();
        })().catch(() => {
            if (active) failed();
        });
        return () => {
            active = false;
            task?.cancel();
            canvas.removeAttribute('data-rendered-page');
            canvas.width = 0;
            canvas.height = 0;
        };
    }, [document, pageNumber, zoom, isCurrent, failed]);
    return h('canvas', {
        ref,
        'aria-label': `PDF ${pageNumber}`,
        style: { display: 'block', maxWidth: zoom === 1 ? '100%' : undefined },
    });
}

/** PDF.js receives owned bytes and an instance worker, never a document URL. */
export function DocumentPDF(props: PDFProps): ReactNode {
    const host = useRef<HTMLDivElement>(null);
    const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
    const [error, setError] = useState(false);
    const [page, setPage] = useState(1);
    const [zoom, setZoom] = useState(1);
    const [allPages, setAllPages] = useState(props.showAllPages === true);
    const disposer = useRef(() => {});
    const failed = useRef(() => {});
    failed.current = () => {
        if (props.isCurrent()) setError(true);
        disposer.current();
    };
    const failPage = useRef(() => failed.current()).current;
    useEffect(() => {
        const element = host.current;
        const ownerDocument = element?.ownerDocument;
        if (!element || !ownerDocument || !props.isCurrent()) return;
        const workerUrl = localDocumentAsset(
            props.options.pdfWorkerUrl,
            ownerDocument
        );
        const resourceBase = localDocumentAsset(
            props.options.pdfResourceBaseUrl,
            ownerDocument
        );
        if (!workerUrl || !resourceBase || !resourceBase.endsWith('/')) {
            setError(true);
            return;
        }
        let active = true;
        const controller = new AbortController();
        let port: Worker | null = null;
        let worker: PDFWorker | null = null;
        let loading: PDFDocumentLoadingTask | null = null;
        let documentReady = false;
        let portFailed = false;
        const current = () =>
            active && !controller.signal.aborted && props.isCurrent();
        const closePort = () => {
            port?.removeEventListener('error', portError);
            port?.removeEventListener('messageerror', portError);
            worker?.destroy();
            port?.terminate();
        };
        const portError = (event: Event) => {
            event.preventDefault();
            portFailed = true;
            if (current()) setError(true);
            dispose();
            // A failed port cannot acknowledge PDF.js's termination request.
            closePort();
        };
        const dispose = () => {
            if (!active) return;
            active = false;
            controller.abort();
            // Let PDF.js clear its page/font/filter resources before closing its
            // external worker port; terminating first strands its Terminate reply.
            if (!documentReady || portFailed) closePort();
            void (loading?.destroy() ?? Promise.resolve())
                .catch(() => {})
                .finally(closePort);
            for (const canvas of element.querySelectorAll('canvas')) {
                canvas.removeAttribute('data-rendered-page');
                canvas.width = 0;
                canvas.height = 0;
            }
        };
        disposer.current = dispose;
        void (async () => {
            const engine = await import('./pdfEngineRuntime.js');
            if (!current()) {
                dispose();
                return;
            }
            if (engine.version !== documentPDFVersion)
                throw Error('PDF version mismatch');
            const WorkerConstructor = ownerDocument.defaultView?.Worker;
            if (!WorkerConstructor) throw Error('Worker unavailable');
            port = new WorkerConstructor(workerUrl, {
                type: 'module',
                credentials: 'omit',
                name: `mx-sdk-pdf-${documentPDFVersion}`,
            });
            port.addEventListener('error', portError);
            port.addEventListener('messageerror', portError);
            // External PDFWorker ports are assumed ready by PDF.js. Wait for
            // this owned worker's real handshake so startup failure/retirement
            // cannot strand a loading task before its setup promise settles.
            await new Promise<void>((resolve, reject) => {
                const cleanup = () => {
                    port?.removeEventListener('message', ready);
                    controller.signal.removeEventListener('abort', aborted);
                };
                const ready = (event: MessageEvent) => {
                    if (event.data?.action !== 'ready') return;
                    cleanup();
                    resolve();
                };
                const aborted = () => {
                    cleanup();
                    reject(Error('PDF worker retired'));
                };
                port!.addEventListener('message', ready);
                controller.signal.addEventListener('abort', aborted, {
                    once: true,
                });
                if (!current()) aborted();
            });
            if (!current()) {
                dispose();
                return;
            }
            worker = engine.PDFWorker.create({ port });
            class OwnedBinaryDataFactory {
                async fetch({
                    kind,
                    filename,
                }: {
                    kind: string;
                    filename: string;
                }): Promise<Uint8Array> {
                    const path = documentPDFResourcePath(kind, filename);
                    if (path === null || !current())
                        throw Error('Asset unavailable');
                    const response = await fetch(`${resourceBase}${path}`, {
                        signal: controller.signal,
                        credentials: 'omit',
                    });
                    const chunks = await readResourceResponse(
                        response,
                        controller.signal,
                        current
                    );
                    const bytes = new Uint8Array(
                        chunks.reduce(
                            (size, chunk) => size + chunk.byteLength,
                            0
                        )
                    );
                    let offset = 0;
                    for (const chunk of chunks) {
                        bytes.set(new Uint8Array(chunk), offset);
                        offset += chunk.byteLength;
                    }
                    if (!current()) throw Error('Asset retired');
                    return bytes;
                }
            }
            loading = engine.getDocument({
                data: new Uint8Array(props.document.bytes),
                worker,
                withCredentials: false,
                useWorkerFetch: false,
                BinaryDataFactory: OwnedBinaryDataFactory,
                cMapUrl: `${resourceBase}cmaps/`,
                cMapPacked: true,
                standardFontDataUrl: `${resourceBase}standard_fonts/`,
                wasmUrl: `${resourceBase}wasm/`,
                disableAutoFetch: true,
                disableRange: true,
                disableStream: true,
                enableXfa: false,
                disableWorkerRendering: true,
            });
            const result = await loading.promise;
            documentReady = true;
            if (current()) setDocument(result);
            else dispose();
        })().catch(() => {
            if (current()) setError(true);
            dispose();
        });
        return dispose;
    }, [
        props.document,
        props.options.pdfWorkerUrl,
        props.options.pdfResourceBaseUrl,
        props.isCurrent,
    ]);
    const action = (
        text: string,
        label: string,
        change: () => void,
        disabled = false
    ) =>
        h(
            ActionButton,
            {
                key: label,
                'aria-label': label,
                disabled,
                onClick: (event: SyntheticEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (props.isCurrent()) change();
                },
            },
            text
        );
    const controls =
        document && props.inGrid
            ? h(
                  'div',
                  {
                      'data-document-pdf-controls': true,
                      style: {
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.25rem',
                      },
                  },
                  document.numPages > 1
                      ? action(
                            '‹',
                            props.labels.previousPage,
                            () => setPage((value) => Math.max(1, value - 1)),
                            allPages || page <= 1
                        )
                      : null,
                  h(
                      'span',
                      { role: 'status' },
                      `${props.labels.page} ${page} / ${document.numPages}`
                  ),
                  document.numPages > 1
                      ? action(
                            '›',
                            props.labels.nextPage,
                            () =>
                                setPage((value) =>
                                    Math.min(document.numPages, value + 1)
                                ),
                            allPages || page >= document.numPages
                        )
                      : null,
                  action(
                      '−',
                      props.labels.zoomOut,
                      () =>
                          setZoom((value) =>
                              Math.max(0.1, Math.round((value - 0.1) * 10) / 10)
                          ),
                      zoom <= 0.1
                  ),
                  action('+', props.labels.zoomIn, () =>
                      setZoom((value) => Math.round((value + 0.1) * 10) / 10)
                  ),
                  action('1:1', props.labels.resetZoom, () => setZoom(1)),
                  action(
                      allPages
                          ? props.labels.showSinglePage
                          : props.labels.showAllPages,
                      allPages
                          ? props.labels.showSinglePage
                          : props.labels.showAllPages,
                      () => setAllPages((value) => !value)
                  ),
                  props.onDownload
                      ? action(
                            props.labels.download,
                            props.labels.download,
                            () => props.onDownload?.(props.document.bytes)
                        )
                      : null
              )
            : null;
    return h(
        'div',
        {
            ref: host,
            'data-document-pdf': documentPDFVersion,
            style: { width: '100%', height: '100%', overflow: 'auto' },
        },
        error
            ? h('span', { role: 'status' }, props.labels.unavailable)
            : !document
              ? h('span', { role: 'status' }, props.labels.loading)
              : h(
                    'div',
                    null,
                    controls,
                    ...(allPages
                        ? Array.from(
                              { length: document.numPages },
                              (_, i) => i + 1
                          )
                        : [page]
                    ).map((number) =>
                        h(PDFPage, {
                            key: number,
                            document,
                            pageNumber: number,
                            zoom,
                            isCurrent: props.isCurrent,
                            failed: failPage,
                        })
                    )
                )
    );
}
