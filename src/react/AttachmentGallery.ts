import {
    createElement as h,
    Fragment,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    type ButtonHTMLAttributes,
    type MouseEventHandler,
    type ReactNode,
} from 'react';
import { ActionButton } from './ActionButton.js';
import { AttachmentTileOpenButton } from './AttachmentTileOpenButton.js';
import {
    renderAttachmentSlider,
    type AttachmentSliderProps,
} from './AttachmentSlider.js';
import type { AttachmentSliderBodyRow } from './AttachmentSliderBody.js';
import { AttachmentSliderPortal } from './attachmentSliderDialogRuntime.js';
import {
    AttachmentGalleryThumbnail,
    type AttachmentGalleryDocument,
} from './AttachmentGalleryThumbnail.js';
import { useAttachmentGalleryNavigation } from './useAttachmentGalleryNavigation.js';

export type { AttachmentGalleryDocument } from './AttachmentGalleryThumbnail.js';

export type AttachmentGalleryRow = AttachmentSliderBodyRow & {
    /** Original row URL before host display projection. */
    readonly resourceUrl: string;
    readonly imageSources: readonly string[];
    readonly icon: 'play' | 'document';
    readonly document?: AttachmentGalleryDocument;
    readonly removeTestId?: string;
    readonly annotationAllowed?: boolean;
    readonly canDownloadInSlider: boolean;
    readonly canOpenInSlider: boolean;
};

export type AttachmentGalleryProps = Pick<
    AttachmentSliderProps,
    'covered' | 'intercomOpen' | 'readDownload' | 'onDownloadError'
> & {
    rows: readonly AttachmentGalleryRow[];
    /** Accepted collection identity, stable across display-only projection changes. */
    collectionIdentity?: object;
    layout: 'grid' | 'icon' | 'thumbnail';
    columns: 2 | 3 | 4;
    fit: 'contain' | 'cover';
    showNames: boolean;
    prepareImagesForPrint?: boolean;
    labels: AttachmentSliderProps['labels'] & {
        remove: string;
        retry: string;
        annotate: string;
    };
    showOpen: boolean;
    formRemovalOwner?: object;
    canRemoveFromTile?(index: number): boolean;
    canRemoveFromSlider?(index: number): boolean;
    onRemove?(index: number): void;
    confirmRemove?(filename: string): Promise<boolean>;
    onAnnotate?(index: number): void;
    tileTestId?: string;
};

const gallery = 'mx-sdk-attachment-gallery';
const useCommitEffect =
    typeof window === 'undefined' ? useEffect : useLayoutEffect;
const iconPaths = {
    remove: [
        'M5.47 5.47a.75.75 0 0 1 1.06 0L12 10.94l5.47-5.47a.75.75 0 1 1 1.06 1.06L13.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 0 1-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 0 1 0-1.06Z',
    ],
    annotate: [
        'M21.731 2.269a2.625 2.625 0 0 0-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 0 0 0-3.712ZM19.513 8.199l-3.712-3.712-8.4 8.4a5.25 5.25 0 0 0-1.32 2.214l-.8 2.685a.75.75 0 0 0 .933.933l2.685-.8a5.25 5.25 0 0 0 2.214-1.32l8.4-8.4Z',
        'M5.25 5.25a3 3 0 0 0-3 3v10.5a3 3 0 0 0 3 3h10.5a3 3 0 0 0 3-3V13.5a.75.75 0 0 0-1.5 0v5.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V8.25a1.5 1.5 0 0 1 1.5-1.5h5.25a.75.75 0 0 0 0-1.5H5.25Z',
    ],
};

function GalleryIcon({ name }: { name: keyof typeof iconPaths }) {
    return h(
        'svg',
        {
            viewBox: '0 0 24 24',
            fill: 'currentColor',
            'aria-hidden': true,
            className: `${gallery}__${name}-icon`,
        },
        iconPaths[name].map((d) =>
            h('path', {
                key: d,
                d,
                fillRule: name === 'remove' ? 'evenodd' : undefined,
                clipRule: name === 'remove' ? 'evenodd' : undefined,
            })
        )
    );
}

type RemovePointer = { pointerId: number; pointerType: string };

function RemoveAttachmentTile({
    onRemove,
    testId,
    label,
    resourceUrl,
    formRemovalOwner,
}: {
    onRemove(): void;
    testId: string;
    label: string;
    resourceUrl: string;
    formRemovalOwner?: object;
}) {
    // Retain the focusable button, but bind physical gestures to its original row.
    const owner = useMemo(
        () => ({ formRemovalOwner, resourceUrl }),
        [formRemovalOwner, resourceUrl]
    );
    const presses = useRef(
        new Map<string, { pointerId: number; owner: typeof owner }>()
    );
    const release = useRef<RemovePointer | null>(null);
    const spacePress = useRef<typeof owner | null>(null);
    const takePointerPress = ({ pointerId, pointerType }: RemovePointer) => {
        const press = presses.current.get(pointerType);
        if (press?.pointerId !== pointerId) return null;
        presses.current.delete(pointerType);
        return press;
    };
    const onClick: MouseEventHandler<HTMLButtonElement> = (event) => {
        event.stopPropagation();
        if (formRemovalOwner != null) {
            const released = release.current;
            release.current = null;
            const click = event.nativeEvent;
            const pointerType =
                'pointerType' in click && typeof click.pointerType === 'string'
                    ? click.pointerType
                    : undefined;
            // Enter and assistive technology also send non-pointer clicks.
            if (
                event.detail > 0 ||
                (pointerType != null && pointerType !== '')
            ) {
                const pointer =
                    'pointerId' in click &&
                    typeof click.pointerId === 'number' &&
                    pointerType != null
                        ? { pointerId: click.pointerId, pointerType }
                        : released;
                if (!pointer || takePointerPress(pointer)?.owner !== owner)
                    return;
            }
        }
        onRemove();
    };
    const gestures: ButtonHTMLAttributes<HTMLButtonElement> | undefined =
        formRemovalOwner == null
            ? undefined
            : {
                  onPointerDown(event) {
                      release.current = null;
                      if (event.isPrimary && event.button === 0)
                          presses.current.set(event.pointerType, {
                              pointerId: event.pointerId,
                              owner,
                          });
                  },
                  onPointerUp(event) {
                      if (event.isPrimary && event.button === 0)
                          release.current = {
                              pointerId: event.pointerId,
                              pointerType: event.pointerType,
                          };
                  },
                  onPointerCancel(event) {
                      takePointerPress(event);
                  },
                  onKeyDown(event) {
                      if (event.key === ' ' && !event.repeat)
                          spacePress.current = owner;
                  },
                  onKeyUp(event) {
                      if (event.key !== ' ') return;
                      const press = spacePress.current;
                      spacePress.current = null;
                      if (press !== owner) event.preventDefault();
                  },
                  onBlur() {
                      spacePress.current = null;
                  },
              };
    const control = {
        ...gestures,
        className: `${gallery}__remove`,
        onClick,
        'data-testid': testId,
    };
    return h(
        ActionButton,
        control,
        h(
            'span',
            { className: 'mx-sdk-attachment-slider-actions__label' },
            label
        ),
        h(GalleryIcon, { name: 'remove' })
    );
}

/** The SDK renders the tile collection and viewer; storage and writes stay with its host. */
export function AttachmentGallery(props: AttachmentGalleryProps): ReactNode {
    const { rows, onRemove, canRemoveFromSlider, labels } = props;
    const identityRows = useMemo(
        () => rows.map(({ id, resourceUrl }) => ({ id, url: resourceUrl })),
        [rows]
    );
    const navigation = useAttachmentGalleryNavigation(identityRows);
    const { currentSliderIndex, setCurrentSliderIndex, navigationOwner } =
        navigation;
    const collection = props.collectionIdentity ?? rows;
    const removal = useMemo(
        () => ({
            collection,
            navigationOwner,
            index: currentSliderIndex,
            onRemove,
            canRemoveFromSlider,
        }),
        [
            collection,
            navigationOwner,
            currentSliderIndex,
            onRemove,
            canRemoveFromSlider,
        ]
    );
    const activeRemoval = useRef<typeof removal | null>(null);
    useCommitEffect(() => {
        activeRemoval.current = removal.navigationOwner ? removal : null;
        return () => {
            if (activeRemoval.current === removal) activeRemoval.current = null;
        };
    }, [removal]);
    const current = rows[currentSliderIndex];
    const confirm = props.confirmRemove;
    const removeSelected =
        onRemove &&
        confirm &&
        current &&
        canRemoveFromSlider?.(currentSliderIndex) === true
            ? async () => {
                  if (
                      activeRemoval.current !== removal ||
                      !(await confirm(current.filename ?? ''))
                  )
                      return;
                  if (activeRemoval.current !== removal) return;
                  if (
                      currentSliderIndex !== 0 &&
                      currentSliderIndex === rows.length - 1
                  )
                      setCurrentSliderIndex((index) => index - 1);
                  onRemove(currentSliderIndex);
                  if (rows.length === 1) navigation.dismissSlider();
              }
            : undefined;
    const layoutClasses =
        props.layout === 'grid'
            ? 'flex h-full gap-1'
            : props.layout === 'icon'
              ? 'space-y-1'
              : `grid gap-1 grid-cols-${props.columns}`;
    const list = h(
        'ul',
        {
            className: `${gallery} ${gallery}--${props.layout} ${layoutClasses}`,
            style:
                props.layout === 'thumbnail'
                    ? {
                          gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`,
                      }
                    : undefined,
        },
        rows.map((row, index) =>
            h(
                'li',
                {
                    key: `${row.id}-${index}`,
                    className: `${gallery}__tile${props.layout === 'grid' ? '' : ' group'}`,
                    'data-testid': props.tileTestId,
                },
                h(AttachmentGalleryThumbnail, {
                    attachment: row,
                    imageSources: row.imageSources,
                    icon: row.icon,
                    document: row.document,
                    layout: props.layout,
                    fit: props.fit,
                    showNames: props.showNames,
                    prepareImagesForPrint: props.prepareImagesForPrint,
                    retryLabel: labels.retry,
                }),
                props.showOpen
                    ? h(AttachmentTileOpenButton, {
                          resourceKey: row.resourceUrl,
                          label: row.url,
                          onOpen: () =>
                              navigation.handleAttachmentThumbnailClick(index),
                      })
                    : null,
                onRemove && props.canRemoveFromTile?.(index) === true
                    ? h(RemoveAttachmentTile, {
                          resourceUrl: row.resourceUrl,
                          formRemovalOwner: props.formRemovalOwner,
                          testId:
                              row.removeTestId ??
                              `removeAttachmentButton-${row.url}`,
                          onRemove: () => onRemove(index),
                          label: labels.remove,
                      })
                    : null,
                props.showOpen && props.onAnnotate && row.annotationAllowed
                    ? h(
                          ActionButton,
                          {
                              className: `${gallery}__annotate`,
                              'aria-label': labels.annotate,
                              onClick: (event) => {
                                  event.stopPropagation();
                                  event.preventDefault();
                                  props.onAnnotate?.(index);
                              },
                          },
                          h(GalleryIcon, { name: 'annotate' }),
                          labels.annotate
                      )
                    : null
            )
        )
    );
    if (!navigationOwner || !current) return h(Fragment, null, list);
    const occurrence = rows
        .slice(0, currentSliderIndex)
        .filter(
            ({ id, url }) => id === current.id && url === current.url
        ).length;
    return h(
        Fragment,
        null,
        list,
        renderAttachmentSlider(
            {
                rows,
                currentIndex: currentSliderIndex,
                setCurrentIndex: setCurrentSliderIndex,
                navigationOwner,
                labels,
                covered: props.covered,
                intercomOpen: props.intercomOpen,
                onDismiss: navigation.dismissSlider,
                onDelete: removeSelected,
                downloadIdentity: JSON.stringify([
                    navigationOwner,
                    current.id,
                    occurrence,
                ]),
                canOpen: current.canOpenInSlider,
                canDownload: current.canDownloadInSlider,
                readDownload: props.readDownload,
                onDownloadError: props.onDownloadError,
            },
            AttachmentSliderPortal
        )
    );
}
