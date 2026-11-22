import { createElement as h, forwardRef } from 'react';
import { ActionButton } from './ActionButton.js';
import { AttachmentPaperClip } from './AttachmentPaperClip.js';

export type AttachmentSliderThumbnail = {
    /** Identity of this host-admitted occurrence, including its owner. */
    key: string;
    filename?: string | null;
    /** Display URL projected by the host. */
    thumbnailUrl?: string | null;
};

export type AttachmentSliderThumbnailRailProps = {
    rows: readonly AttachmentSliderThumbnail[];
    selectedIndex: number;
    /** Selection intent only. The host decides whether it can be applied. */
    onSelect(index: number): void;
};

const rail = 'mx-sdk-attachment-thumbnail-rail';

/** The ref attaches to the rail's native dialog focus target. */
export const AttachmentSliderThumbnailRail = forwardRef<
    HTMLDivElement,
    AttachmentSliderThumbnailRailProps
>(function AttachmentSliderThumbnailRail(
    { rows, selectedIndex, onSelect },
    ref
) {
    return h(
        'div',
        { className: rail, ref, tabIndex: -1 },
        h(
            'div',
            { className: `${rail}__scroll` },
            h(
                'div',
                { className: `${rail}__row` },
                rows.map(({ key, filename, thumbnailUrl }, index) => {
                    const selection = {
                        className: `${rail}__select`,
                        'data-selected': index === selectedIndex,
                        onClick: () => onSelect(index),
                    };
                    return h(
                        'div',
                        { key, className: `${rail}__tile` },
                        thumbnailUrl != null
                            ? h('img', {
                                  src: thumbnailUrl,
                                  alt: '',
                                  className: `${rail}__image`,
                              })
                            : h(AttachmentPaperClip, {
                                  className: `${rail}__fallback`,
                              }),
                        h(
                            ActionButton,
                            selection,
                            h('span', { className: `${rail}__label` }, filename)
                        )
                    );
                })
            )
        )
    );
});
