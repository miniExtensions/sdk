import { checkIfPageUrlIsValid } from '../../forms/pageUrlValidation.js';
import { readResourceResponse } from '../resourceResponse.js';
import { getHTMLPurifier } from '../html/htmlPurifier.js';

export type DocumentMedia = 'text' | 'csv' | 'html' | 'tiff' | 'image' | 'pdf';

/** Preloaded bytes are copied on admission; revision retires prior decoded data. */
export type DocumentThumbnailSource =
    | { kind: 'uri'; revision?: unknown; mimeType?: string }
    | { kind: 'bytes'; revision: unknown; mimeType: string; bytes: Uint8Array };

export type DocumentThumbnailLabels = {
    loading: string;
    unavailable: string;
    previousPage: string;
    nextPage: string;
    zoomIn: string;
    zoomOut: string;
    resetZoom: string;
    showAllPages: string;
    showSinglePage: string;
    download: string;
    page: string;
};

export type DocumentThumbnailOptions = {
    /** Explicit admission for current-URI loading or already owned bytes. */
    source: DocumentThumbnailSource;
    labels?: Partial<DocumentThumbnailLabels>;
} & (
    | {
          /** PDF requires both same-origin URLs for the version-matched assets. */
          pdfWorkerUrl: string;
          pdfResourceBaseUrl: string;
      }
    | { pdfWorkerUrl?: never; pdfResourceBaseUrl?: never }
);

export type AdmittedDocument = {
    mimeType: string;
    media: DocumentMedia;
    bytes: Uint8Array<ArrayBuffer>;
};

/** Known-URI PDF modal classification never learns a type from thumbnails. */
export function modalPDFOptions(
    options: DocumentThumbnailOptions | undefined
): DocumentThumbnailOptions | null {
    if (!options?.source) return null;
    if (options.source.kind === 'uri')
        return {
            ...options,
            source: { ...options.source, mimeType: 'application/pdf' },
        };
    return options.source.kind === 'bytes' &&
        documentMedia(options.source.mimeType)?.media === 'pdf'
        ? options
        : null;
}

export function documentMedia(
    value: unknown
): { mimeType: string; media: DocumentMedia } | null {
    if (typeof value !== 'string') return null;
    const mimeType = value.split(';')[0].trim().toLowerCase();
    let media: DocumentMedia;
    if (['txt', 'text/plain'].includes(mimeType)) media = 'text';
    else if (['csv', 'text/csv'].includes(mimeType)) media = 'csv';
    else if (['htm', 'html', 'text/htm', 'text/html'].includes(mimeType))
        media = 'html';
    else if (['tif', 'tiff', 'image/tif', 'image/tiff'].includes(mimeType))
        media = 'tiff';
    else if (['pdf', 'application/pdf'].includes(mimeType)) media = 'pdf';
    else if (
        [
            'png',
            'image/png',
            'bmp',
            'image/bmp',
            'jpg',
            'jpeg',
            'image/jpg',
            'image/jpeg',
            'gif',
            'image/gif',
        ].includes(mimeType)
    )
        media = 'image';
    else return null;
    const canonical =
        mimeType === 'png'
            ? 'image/png'
            : mimeType === 'bmp'
              ? 'image/bmp'
              : ['jpg', 'jpeg', 'image/jpg'].includes(mimeType)
                ? 'image/jpeg'
                : mimeType === 'gif'
                  ? 'image/gif'
                  : mimeType;
    return { mimeType: canonical, media };
}

/** Whole-URI exclusions remain distinct from renderer-private discovered MIME. */
export function admitsDocumentThumbnail(
    uri: string,
    inGrid: boolean,
    iconMode: boolean
): boolean {
    return (
        !iconMode &&
        (inGrid || !uri.endsWith('.pdf')) &&
        !/\.(?:xls|xlsx|doc|docx|odt|ppt|pptx|r\d\d|r\d\d\d)$/i.test(uri)
    );
}

export function copyDocumentSource(
    source: DocumentThumbnailSource
): AdmittedDocument | null {
    if (source.kind !== 'bytes') return null;
    const type = documentMedia(source.mimeType);
    if (type === null || !(source.bytes instanceof Uint8Array)) return null;
    return { ...type, bytes: new Uint8Array(source.bytes) };
}

export async function loadDocumentSource(
    uri: string,
    source: DocumentThumbnailSource,
    controller: AbortController,
    isCurrent: () => boolean
): Promise<AdmittedDocument | null> {
    const current = () => !controller.signal.aborted && isCurrent();
    if (!current() || !/^https?:\/\//i.test(uri) || !checkIfPageUrlIsValid(uri))
        return null;
    if (source.kind === 'bytes') return copyDocumentSource(source);
    if (source.kind !== 'uri') return null;
    let type = documentMedia(source.mimeType);
    let response: Response | null = null;
    try {
        if (source.mimeType === undefined) {
            response = await fetch(uri, {
                method: 'HEAD',
                credentials: 'omit',
                signal: controller.signal,
            });
            if (!current() || !response.ok) return null;
            type = documentMedia(response.headers.get('Content-Type'));
            if (response.body !== null) await response.body.cancel();
            response = null;
        }
        if (!current() || type === null) return null;
        response = await fetch(uri, {
            credentials: 'omit',
            signal: controller.signal,
        });
        const chunks = await readResourceResponse(
            response,
            controller.signal,
            current
        );
        if (!current()) return null;
        const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
        }
        return { ...type, bytes };
    } finally {
        if (
            response?.body !== null &&
            response?.body !== undefined &&
            !response.body.locked
        ) {
            try {
                await response.body.cancel();
            } catch {
                /* Already consumed or errored. */
            }
        }
        if (!isCurrent()) controller.abort();
    }
}

export async function parseDocumentCSV(text: string): Promise<string[][]> {
    const { default: parser } = await import('papaparse');
    const result = parser.parse(text, {
        delimiter: ',',
        dynamicTyping: false,
        worker: false,
        download: false,
    });
    if (result.errors.length) throw Error('Malformed CSV');
    return result.data;
}

/** Document bytes grant display authority, never embedded navigation or loads. */
export function sanitizeDocumentHTML(html: string): string {
    return getHTMLPurifier().sanitize(html, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: [
            'iframe',
            'img',
            'picture',
            'audio',
            'video',
            'source',
            'track',
            'link',
            'style',
            'form',
            'input',
            'button',
            'textarea',
            'select',
            'option',
            'object',
            'embed',
        ],
        FORBID_ATTR: [
            'id',
            'name',
            'src',
            'srcset',
            'href',
            'style',
            'poster',
            'background',
            'data',
            'action',
            'formaction',
        ],
    });
}

export async function decodeDocumentTIFF(
    bytes: Uint8Array
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
    const { default: decoder } = await import('utif2');
    const copy = new Uint8Array(bytes).buffer;
    const first = decoder.decode(copy)[0];
    if (!first) throw Error('TIFF has no image');
    decoder.decodeImage(copy, first);
    const width = first.width;
    const height = first.height;
    if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width! <= 0 ||
        height! <= 0
    )
        throw Error('Invalid TIFF dimensions');
    const rgba = decoder.toRGBA8(first);
    if (rgba.byteLength !== width! * height! * 4)
        throw Error('Invalid TIFF pixels');
    return { width: width!, height: height!, rgba };
}
