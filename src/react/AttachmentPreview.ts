import { createElement as h, Fragment, useEffect, useRef } from 'react';
import type * as React from 'react';
import { renderAsync } from 'docx-preview/dist/docx-preview.mjs';
import {
    classifyAttachmentPreview,
    type AttachmentPreviewSource,
} from '../ui/attachmentPreview.js';

export type AttachmentPreviewLabels = {
    attachments: string;
    previewNotAvailable: string;
};

export type AttachmentPreviewProps = {
    /** An explicitly supplied media URL. No label-only facet URL recovery. */
    attachment: AttachmentPreviewSource;
    labels?: Partial<AttachmentPreviewLabels>;
};

/** Complete media presentation; the caller retains navigation and attachments. */
export function AttachmentPreview({
    attachment,
    labels,
}: AttachmentPreviewProps): React.ReactElement {
    const docContainerRef = useRef<HTMLDivElement>(null);
    const { isImage, isHEIC, isVideo, isAudio, isWordDocument, isPdf } =
        classifyAttachmentPreview(attachment);

    useEffect(() => {
        const host = docContainerRef.current;
        if (!isWordDocument || host == null) return;
        // The vendor may still write after retirement. Only this detachable
        // lifetime target is handed to it, never the retained React host.
        const container = document.createElement('div');
        host.appendChild(container);
        let retired = false;
        const loadDocument = async () => {
            try {
                const response = await fetch(attachment.url);
                const blob = await response.blob();
                if (retired) return;
                await renderAsync(blob, container);
            } catch (error) {
                if (!retired) console.error('Error rendering document:', error);
            }
        };
        void loadDocument();
        return () => {
            retired = true;
            container.remove();
        };
    }, [attachment.url, isWordDocument]);

    if (isHEIC && attachment.thumbnails?.full != null) {
        return h('img', {
            src: attachment.thumbnails.full.url,
            alt: '',
            className: 'mx-sdk-attachment-preview__image',
        });
    }
    if (isImage) {
        return h('img', {
            src: attachment.url,
            alt: '',
            className: 'mx-sdk-attachment-preview__image',
        });
    }
    if (isVideo) return h(PreviewVideo, { src: attachment.url });
    if (isAudio) return h('audio', { src: attachment.url, controls: true });
    if (isPdf) {
        return h('iframe', {
            src: attachment.url + '#toolbar=0',
            title: attachment.filename?.trim()
                ? attachment.filename
                : (labels?.attachments ?? 'Attachments'),
            frameBorder: '0',
            scrolling: 'auto',
            height: '100%',
            width: '100%',
        });
    }
    if (isWordDocument) {
        return h('div', {
            ref: docContainerRef,
            className: 'mx-sdk-attachment-preview__word',
        });
    }
    return h(
        Fragment,
        null,
        // Heroicons 2.1.1 PaperClip outline, MIT; see THIRD_PARTY_NOTICES.
        h(
            'svg',
            {
                xmlns: 'http://www.w3.org/2000/svg',
                fill: 'none',
                viewBox: '0 0 24 24',
                strokeWidth: 1.5,
                stroke: 'currentColor',
                className: 'mx-sdk-attachment-preview__unsupported-icon',
                'aria-hidden': true,
            },
            h('path', {
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                d: 'm18.375 12.739-7.693 7.693a4.5 4.5 0 0 1-6.364-6.364l10.94-10.94A3 3 0 1 1 19.5 7.372L8.552 18.32m.009-.01-.01.01m5.699-9.941-7.81 7.81a1.5 1.5 0 0 0 2.112 2.13',
            })
        ),
        h(
            'p',
            { className: 'mx-sdk-attachment-preview__unsupported-message' },
            labels?.previewNotAvailable ?? 'Preview Not Available'
        )
    );
}

function PreviewVideo({ src }: { src: string }) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    useEffect(() => {
        const video = videoRef.current;
        // StrictMode replays teardown on the retained node. Restore its source
        // without resetting ordinary rerenders or declarative source changes.
        if (video && video.getAttribute('src') !== src)
            video.setAttribute('src', src);
    }, [src]);
    useEffect(() => {
        const video = videoRef.current;
        return () => {
            if (video == null) return;
            video.pause();
            video.removeAttribute('src');
            video.load();
        };
    }, []);
    return h('video', {
        src,
        controls: true,
        className: 'mx-sdk-attachment-preview__video',
        ref: videoRef,
    });
}
