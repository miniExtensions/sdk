import {
    createElement as h,
    useEffect,
    useRef,
    useState,
    type ReactNode,
    type MouseEvent,
} from 'react';
import { RecoverableImage } from './RecoverableImage.js';
import { DocumentThumbnail } from './document-preview/DocumentThumbnail.js';
import type { DocumentThumbnailOptions } from './document-preview/documentContent.js';
import type { CompleteLinkedFinderAdmission } from '../ui/completeLinkedFinder.js';

export type LinkedFinderAttachmentRow = {
    /** Occurrence identity, not a deduplicated attachment ID. */
    readonly key: string;
    readonly label: string;
    readonly openLabel: string;
    readonly imageSources: readonly string[];
    readonly imageUnavailableLabel?: string;
    readonly icon: 'play' | 'document';
    readonly document?: {
        readonly uri: string;
        readonly options: DocumentThumbnailOptions;
    };
};
export type LinkedFinderAttachmentCollectionProps = {
    readonly rows: readonly LinkedFinderAttachmentRow[];
    readonly layout: 'grid' | 'thumbnail' | 'icon';
    readonly columns: 2 | 3 | 4;
    readonly fit: 'cover' | 'contain';
    readonly showNames: boolean;
    readonly owner: { isCurrent(): boolean };
    readonly labels: {
        readonly attachments: string;
        readonly retry: string;
        readonly imageUnavailable: string;
    };
    /** Captured host opening capability; no callback means no opening authority. */
    readonly onOpen?: (index: number) => CompleteLinkedFinderAdmission;
};
const current = (owner: LinkedFinderAttachmentCollectionProps['owner']) => {
    try {
        return owner.isCurrent() === true;
    } catch {
        return false;
    }
};
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
function Icon({ play }: { play: boolean }) {
    return h(
        'svg',
        {
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            'aria-hidden': true,
        },
        h('path', {
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            d: play
                ? 'M8 5v14l11-7L8 5Z'
                : 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6',
        })
    );
}
function Thumbnail({
    row,
    view,
}: {
    row: LinkedFinderAttachmentRow;
    view: LinkedFinderAttachmentCollectionProps;
}): ReactNode {
    const ref = useRef<HTMLDivElement | null>(null);
    const [visible, setVisible] = useState(view.layout === 'icon');
    useEffect(() => {
        if (
            view.layout === 'icon' ||
            !ref.current ||
            typeof IntersectionObserver === 'undefined'
        )
            return;
        const observer = new IntersectionObserver(([entry]) => {
            if (current(view.owner)) setVisible(entry.isIntersecting);
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [view.layout, view.owner]);
    const fallback = () =>
        h(
            'div',
            { className: 'mx-sdk-finder-attachment-fallback' },
            h(Icon, { play: row.icon === 'play' })
        );
    return h(
        'div',
        { ref, className: 'mx-sdk-finder-attachment-visual' },
        !visible || !current(view.owner)
            ? null
            : row.imageSources.length
              ? h(RecoverableImage, {
                    sources: row.imageSources,
                    alt: '',
                    className: 'mx-sdk-finder-attachment-image',
                    style: {
                        objectFit:
                            view.layout === 'thumbnail' ? view.fit : 'cover',
                    },
                    renderFallback: (retry) =>
                        h(
                            'div',
                            {
                                className: 'mx-sdk-finder-attachment-fallback',
                                role: 'status',
                                'aria-label':
                                    row.imageUnavailableLabel ??
                                    view.labels.imageUnavailable,
                            },
                            h(Icon, { play: false }),
                            h(
                                'button',
                                {
                                    type: 'button',
                                    className: 'mx-sdk-finder-attachment-retry',
                                    'aria-label': view.labels.retry,
                                    onClick: (
                                        event: MouseEvent<HTMLButtonElement>
                                    ) => {
                                        event.preventDefault();
                                        stop(event);
                                        if (current(view.owner)) retry();
                                    },
                                },
                                view.labels.retry
                            )
                        ),
                })
              : view.layout !== 'icon' && row.document
                ? h(
                      'div',
                      { className: 'mx-sdk-finder-attachment-document' },
                      h(DocumentThumbnail, {
                          uri: row.document.uri,
                          options: row.document.options,
                          owner: view.owner,
                          identity: row.key,
                          visible,
                          inGrid: view.layout === 'grid',
                      })
                  )
                : fallback()
    );
}

/** SDK-owned readonly collection surface; selection/modal/navigation stay in the host. */
export function LinkedFinderAttachmentCollection(
    view: LinkedFinderAttachmentCollectionProps
): ReactNode {
    return h(
        'ul',
        {
            className: `mx-sdk-finder-attachment-collection mx-sdk-finder-attachment-${view.layout}`,
            style: {
                gridTemplateColumns:
                    view.layout === 'thumbnail'
                        ? `repeat(${view.columns}, minmax(0, 1fr))`
                        : undefined,
            },
            'aria-label': view.labels.attachments,
            onClick: stop,
            onKeyDown: stop,
        },
        view.rows.map((row, index) =>
            h(
                'li',
                { key: row.key, className: 'mx-sdk-finder-attachment-item' },
                h(Thumbnail, { row, view }),
                view.showNames && view.layout !== 'grid'
                    ? h(
                          'p',
                          { className: 'mx-sdk-finder-attachment-name' },
                          row.label
                      )
                    : null,
                view.onOpen
                    ? h('button', {
                          type: 'button',
                          className: 'mx-sdk-finder-attachment-open',
                          'aria-label': row.openLabel,
                          disabled: !current(view.owner),
                          onClick: (event: MouseEvent<HTMLButtonElement>) => {
                              event.preventDefault();
                              stop(event);
                              if (current(view.owner)) view.onOpen?.(index);
                          },
                      })
                    : null
            )
        )
    );
}
