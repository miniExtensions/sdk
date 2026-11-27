import {
    createElement as h,
    Fragment,
    useEffect,
    useLayoutEffect,
    useId,
    useRef,
    useState,
    type CSSProperties,
    type ReactElement,
    type ReactNode,
} from 'react';
import type { RuntimeLanguage, RuntimeFieldSchema } from '../runtime/types.js';
import {
    linkedFinderCarouselImages,
    linkedFinderCarouselIndex,
    linkedFinderListImageVector,
    type LinkedFinderImage,
} from '../ui/linkedFinderImages.js';
import {
    CompleteReadOnlyTextField,
    type CompleteReadOnlyTextFieldProps,
} from './CompleteReadOnlyTextField.js';
import { CompleteHTMLRenderer } from './html/CompleteHTMLRenderer.js';
import { CompleteQuillHTMLRenderer } from './html/CompleteQuillHTMLRenderer.js';
import { CompleteRichTextEditor } from './CompleteRichTextEditor.js';
import {
    CompleteLocalizedNumericField,
    type CompleteLocalizedNumericRendererProps,
} from './CompleteLocalizedNumericField.js';
import type {
    ControlledDateFieldProps,
    ControlledDateTimeFieldProps,
} from './date/DateField.js';
import { formatDateInputValue } from '../ui/dateInputCompatibility.js';
import {
    CompleteReadOnlyPhoneNumberField,
    type CompleteReadOnlyPhoneNumberFieldProps,
} from './CompleteReadOnlyPhoneNumberField.js';
import {
    ReadOnlyDurationField,
    type ReadOnlyDurationFieldProps,
} from './ReadOnlyDurationField.js';
import { CompleteCheckboxField } from './CompleteCheckboxField.js';
import {
    ControlledBarcodeField,
    type ControlledBarcodeFieldProps,
} from './ControlledBarcodeField.js';
import { ButtonField, type ButtonFieldProps } from './ButtonField.js';
import { RatingInput } from './RatingInput.js';
import { PersonBadge } from './PersonBadge.js';
import { RecoverableImage } from './RecoverableImage.js';
import {
    SingleLineTextField,
    type ReadOnlySingleLineTextFieldProps,
} from './SingleLineTextField.js';
import type { CollaboratorImageSource } from './CompleteCollaboratorField.js';
import {
    LinkedFinderAttachmentCollection,
    LinkedFinderAttachmentIcon,
    type LinkedFinderAttachmentCollectionProps,
} from './LinkedFinderAttachmentCollection.js';
import {
    CreatedTimeResource,
    type CreatedTimeResourceProps,
} from './CreatedTimeResource.js';

type ReadonlyNumeric = CompleteLocalizedNumericRendererProps & {
    capability: { type: 'readonly' };
};
type ReadonlyDate = Pick<
    ControlledDateFieldProps,
    'airtableDateConfig' | 'value' | 'language'
>;
type ReadonlyDateTime = Pick<
    ControlledDateTimeFieldProps,
    'airtableDateConfig' | 'value' | 'language'
>;
export type LinkedFinderPill = {
    readonly label: string;
    readonly color?: string;
    readonly backgroundColor?: string;
};
/** Exhaustive admitted presentation. Schema/config never select a leaf or grant an action. */
export type LinkedFinderCardLeaf =
    | { readonly kind: 'literal'; readonly text: string }
    | { readonly kind: 'error'; readonly message: string }
    | {
          readonly kind: 'text';
          readonly display: CompleteReadOnlyTextFieldProps;
      }
    | {
          readonly kind: 'singleLine';
          readonly display: ReadOnlySingleLineTextFieldProps;
      }
    | { readonly kind: 'html'; readonly html: string; readonly height?: number }
    | { readonly kind: 'quill'; readonly html: string }
    | {
          readonly kind: 'markdown';
          readonly value: string | null;
          readonly identity: string;
          readonly emptyLabel: string;
      }
    | {
          readonly kind: 'numeric';
          readonly display: ReadonlyNumeric;
          readonly emptyLabel: string;
      }
    | { readonly kind: 'date'; readonly display: ReadonlyDate }
    | { readonly kind: 'dateTime'; readonly display: ReadonlyDateTime }
    | {
          readonly kind: 'phone';
          readonly display: CompleteReadOnlyPhoneNumberFieldProps;
      }
    | {
          readonly kind: 'duration';
          readonly display: ReadOnlyDurationFieldProps;
      }
    | {
          readonly kind: 'checkbox';
          readonly value: boolean | null;
          readonly checkedLabel: string;
          readonly uncheckedLabel: string;
      }
    | {
          readonly kind: 'barcode';
          readonly display: Pick<
              ControlledBarcodeFieldProps,
              'value' | 'language'
          >;
      }
    | { readonly kind: 'button'; readonly accepted: ButtonFieldProps }
    | {
          readonly kind: 'urlButton';
          readonly display: Pick<
              CreatedTimeResourceProps,
              'href' | 'owner' | 'identity' | 'inert' | 'buttonLabel' | 'labels'
          >;
      }
    | { readonly kind: 'pills'; readonly items: readonly LinkedFinderPill[] }
    | { readonly kind: 'linkedPills'; readonly labels: readonly string[] }
    | {
          readonly kind: 'people';
          readonly items: readonly {
              readonly label: string;
              readonly avatar?: LinkedFinderImage;
              /** Resolved by the actual host optimizer/allow-list before projection. */
              readonly avatarSource?: CollaboratorImageSource;
          }[];
      }
    | {
          readonly kind: 'rating';
          readonly value: number | null;
          readonly max: number;
          readonly icon: 'star' | 'heart' | 'thumbsUp' | 'flag' | 'dot';
          readonly color: string;
          readonly label: string;
          readonly emptyLabel?: string;
          readonly glyph?: {
              readonly path: string;
              readonly viewBox: string;
              readonly unfilledColor: string;
          };
      }
    | {
          readonly kind: 'attachmentCollection';
          readonly display: LinkedFinderAttachmentCollectionProps;
      }
    | {
          readonly kind: 'attachmentImages';
          readonly images: readonly LinkedFinderImage[];
          /** Ordered host projections, including files without a thumbnail.
           * Null never recovers an original URL or a hidden cached value. */
          readonly entries?: readonly LinkedFinderAttachmentThumbnail[];
          readonly empty: 'none' | 'no-values';
          readonly emptyLabel: string;
      }
    | {
          readonly kind: 'sequence';
          readonly leaves: readonly LinkedFinderCardLeaf[];
          readonly layout?: 'wrap';
      };

export type LinkedFinderAttachmentThumbnail = Readonly<{
    id?: string;
    thumbnailUrl: string | null;
    filename: string;
}>;

function AttachmentImages({
    leaf,
}: {
    leaf: Extract<LinkedFinderCardLeaf, { kind: 'attachmentImages' }>;
}): ReactElement {
    const entries =
        leaf.entries ??
        leaf.images.map((image) => ({
            id: image.id,
            thumbnailUrl: image.url,
            filename: image.filename ?? '',
        }));
    const occurrences = new Map<string, number>();
    return entries.length
        ? h(
              'span',
              { className: 'mx-sdk-finder-attachment-images' },
              entries.map((entry) => {
                  const identity = JSON.stringify([
                      entry.id,
                      entry.thumbnailUrl,
                  ]);
                  const occurrence = occurrences.get(identity) ?? 0;
                  occurrences.set(identity, occurrence + 1);
                  return h(
                      'span',
                      {
                          key: identity + ':' + occurrence,
                          className: 'mx-sdk-finder-attachment-thumbnail',
                      },
                      h(RecoverableImage, {
                          sources: entry.thumbnailUrl
                              ? [entry.thumbnailUrl]
                              : [],
                          alt: entry.filename,
                          loading: 'lazy',
                          renderFallback: () =>
                              h(
                                  'span',
                                  {
                                      className:
                                          'mx-sdk-finder-attachment-filename',
                                      title: entry.filename,
                                  },
                                  h(LinkedFinderAttachmentIcon, {
                                      play: false,
                                  }),
                                  h('span', null, entry.filename)
                              ),
                      })
                  );
              })
          )
        : leaf.empty === 'no-values'
          ? h('span', null, leaf.emptyLabel)
          : h('span');
}

export type LinkedFinderCardField = {
    readonly key: string;
    readonly title: string | null;
    /** Optional auditing context; never interpreted as authority by the card. */
    readonly metadata?: {
        readonly schema: RuntimeFieldSchema['airtableField'];
        readonly config: unknown;
    };
    readonly leaf: LinkedFinderCardLeaf;
};
/** Native Map shows the admitted primary only, never detail/image recovery. */
export type LinkedFinderMapCardProjection = Readonly<{
    status: 'present';
    layout: 'map';
    primary: string;
    primaryIsEmpty: boolean;
}>;
export type LinkedFinderCardProjection =
    | { readonly status: 'loading'; readonly label: string }
    | { readonly status: 'unavailable'; readonly label: string }
    | {
          readonly status: 'present';
          readonly primary: string;
          /** Host-observed empty primary before its localized placeholder. */
          readonly primaryIsEmpty?: boolean;
          readonly fields: readonly LinkedFinderCardField[];
          readonly language: RuntimeLanguage;
          readonly layout: 'list' | 'gallery' | 'kanban';
          readonly images: readonly LinkedFinderImage[];
          readonly imageFit: 'cover' | 'contain';
          readonly imageHeight: number;
          readonly shouldRenderThumbnail: boolean;
          readonly thumbnailLocation: 'left' | 'right';
          readonly fieldsPerCardRow: number;
          readonly labels: {
              readonly previousImage: string;
              readonly nextImage: string;
              readonly noImage: string;
              /** Localized template with {index}, numbered from one. */
              readonly viewImage?: string;
          };
      };

const noop = () => {};
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();
const useCommittedEffect =
    typeof document === 'undefined' ? useEffect : useLayoutEffect;
function Rating({
    leaf,
}: {
    leaf: Extract<LinkedFinderCardLeaf, { kind: 'rating' }>;
}) {
    const paths = {
        star: 'm12 2 3.1 6.3 7 .9-5 4.9 1.2 6.9-6.3-3.3-6.3 3.3 1.2-6.9-5-4.9 7-.9Z',
        heart: 'M12 21S2 15 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 7-10 13-10 13Z',
        thumbsUp: 'M3 10h4v12H3Zm5 0 5-8c3 0 2 5 1 8h6c3 0 2 4 0 11H8Z',
        flag: 'M5 22V2h14l-3 5 3 5H7v10Z',
        dot: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
    };
    return h(
        'div',
        {
            className: 'mx-sdk-finder-rating',
            role: 'img',
            'aria-label': leaf.label,
        },
        h(RatingInput, {
            value: leaf.value,
            max: Math.max(0, Math.min(100, Math.floor(leaf.max))),
            onChange: noop,
            disabled: true,
            grid: true,
            gridSummaryClassName: 'mx-sdk-finder-sr-only',
            iconsClassName: 'mx-sdk-finder-rating-icons',
            empty: leaf.emptyLabel ?? '',
            renderIcon: ({ filled }) =>
                h(
                    'svg',
                    {
                        viewBox: leaf.glyph?.viewBox ?? '0 0 24 24',
                        'aria-hidden': true,
                        style: {
                            color: filled
                                ? leaf.color
                                : (leaf.glyph?.unfilledColor ?? '#d1d5db'),
                        },
                        fill: 'currentColor',
                    },
                    h('path', {
                        fillRule: 'evenodd',
                        d: leaf.glyph?.path ?? paths[leaf.icon],
                    })
                ),
        })
    );
}

/** Leaves are real SDK components. No native JSX slot, client or cache lookup. */
export function LinkedFinderRichLeaf({
    leaf,
}: {
    leaf: LinkedFinderCardLeaf;
}): ReactNode {
    const id = useId();
    switch (leaf.kind) {
        case 'literal':
            return h('span', { className: 'mx-sdk-finder-literal' }, leaf.text);
        case 'error':
            return h(
                'span',
                { role: 'alert', className: 'mx-sdk-finder-field-error' },
                leaf.message
            );
        case 'text':
            return h(CompleteReadOnlyTextField, leaf.display);
        case 'singleLine':
            return h(SingleLineTextField, leaf.display);
        case 'html':
            return h(
                'div',
                { style: { height: leaf.height, overflow: 'auto' } },
                h(CompleteHTMLRenderer, { html: leaf.html })
            );
        case 'quill':
            return h(CompleteQuillHTMLRenderer, { html: leaf.html });
        case 'markdown':
            return h(CompleteRichTextEditor, {
                value: leaf.value,
                identity: leaf.identity,
                readOnly: true,
                onValueChange: noop,
                emptyContent: leaf.emptyLabel,
            });
        case 'numeric':
            return h(CompleteLocalizedNumericField, {
                field: leaf.display,
                options: {
                    presentation: 'display',
                    showLabel: false,
                    emptyLabel: leaf.emptyLabel,
                },
            });
        case 'date':
        case 'dateTime':
            // Use the same readonly presenter/formatter as /react/date without
            // importing the interactive picker and initializing ReactDOM during
            // a general-entry import before a browser/DOM has been installed.
            return h(
                'div',
                { id },
                h(CompleteReadOnlyTextField, {
                    value: formatDateInputValue({
                        airtableValue: leaf.display.value,
                        airtableFieldConfig: leaf.display.airtableDateConfig,
                    }),
                    language: leaf.display.language,
                })
            );
        case 'phone':
            return h(CompleteReadOnlyPhoneNumberField, leaf.display);
        case 'duration':
            return h(ReadOnlyDurationField, leaf.display);
        case 'checkbox':
            return h(CompleteCheckboxField, {
                value: leaf.value,
                onChange: noop,
                readOnly: true,
                checkedStateLabel: leaf.checkedLabel,
                uncheckedStateLabel: leaf.uncheckedLabel,
            });
        case 'barcode':
            return h(ControlledBarcodeField, {
                ...leaf.display,
                mode: 'controlled',
                displayOnly: true,
                readOnly: true,
                onChange: noop,
            });
        case 'button':
            return h(ButtonField, leaf.accepted);
        case 'urlButton':
            return h(CreatedTimeResource, { ...leaf.display, mode: 'button' });
        case 'pills':
            return h(
                'span',
                { className: 'mx-sdk-finder-pills' },
                leaf.items.map((item, index) =>
                    h(
                        'span',
                        {
                            key: index,
                            className: 'mx-sdk-finder-pill',
                            style: {
                                color: item.color,
                                backgroundColor: item.backgroundColor,
                            },
                        },
                        item.label
                    )
                )
            );
        case 'linkedPills':
            return h(
                'span',
                { className: 'mx-sdk-finder-pills' },
                leaf.labels.map((label, index) =>
                    h(
                        'span',
                        {
                            key: index,
                            className:
                                'mx-sdk-finder-pill mx-sdk-finder-linked-pill',
                        },
                        label
                    )
                )
            );
        case 'people':
            return h(
                'ul',
                { className: 'mx-sdk-collaborator-badges' },
                leaf.items.map((item, index) => {
                    const source =
                        item.avatarSource ??
                        (item.avatar ? { src: item.avatar.url } : null);
                    return h(PersonBadge, {
                        key: index,
                        label: item.label,
                        className: 'mx-sdk-collaborator-badge',
                        avatarClassName: 'mx-sdk-collaborator-badge-avatar',
                        bodyClassName: 'mx-sdk-collaborator-badge-body',
                        labelClassName: 'mx-sdk-collaborator-name',
                        avatar: source
                            ? h('img', {
                                  ...source,
                                  alt: '',
                                  width: 32,
                                  height: 32,
                                  className: 'mx-sdk-collaborator-avatar',
                              })
                            : undefined,
                    });
                })
            );
        case 'rating':
            return h(Rating, { leaf });
        case 'attachmentCollection':
            return h(LinkedFinderAttachmentCollection, leaf.display);
        case 'attachmentImages':
            return h(AttachmentImages, { leaf });
        case 'sequence':
            if (leaf.layout === 'wrap')
                return h(
                    'div',
                    { className: 'mx-sdk-finder-sequence' },
                    leaf.leaves.map((child, index) =>
                        h(
                            'div',
                            {
                                key: index,
                                className: 'mx-sdk-finder-sequence-item',
                            },
                            h(LinkedFinderRichLeaf, { leaf: child })
                        )
                    )
                );
            return h(
                Fragment,
                null,
                leaf.leaves.map((child, index) =>
                    h(LinkedFinderRichLeaf, { key: index, leaf: child })
                )
            );
    }
}

type Present = Extract<
    LinkedFinderCardProjection,
    {
        status: 'present';
        layout: 'list' | 'gallery' | 'kanban';
    }
>;
function useListImage(card: Present) {
    const vector = linkedFinderListImageVector(card.images);
    const [state, setState] = useState({ vector, index: 0 });
    const current = state.vector === vector ? state : { vector, index: 0 };
    if (state !== current) setState(current);
    const active = useRef(current);
    useCommittedEffect(() => {
        active.current = current;
    }, [current]);
    const image = card.images[current.index];
    if (!image) return null;
    return h('img', {
        key: `${vector}:${current.index}`,
        src: image.url,
        alt: image.filename,
        className: 'mx-sdk-finder-list-image',
        style: { height: card.imageHeight, objectFit: card.imageFit },
        onError: () => {
            if (
                active.current.vector === vector &&
                active.current.index === current.index
            ) {
                const next = { vector, index: current.index + 1 };
                active.current = next;
                setState(next);
            }
        },
    });
}

function useCarouselController(
    projection: LinkedFinderCardProjection | LinkedFinderMapCardProjection
) {
    const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
    const [selection, setSelection] = useState<{
        identity: string | null;
        index: number;
    }>({ identity: null, index: 0 });
    // Loading is a host publication phase, not a new record or image vector.
    // Keep only UI identity/failure hints; no previous projection is retained.
    const retire =
        projection.status === 'unavailable' ||
        (projection.status === 'present' &&
            (projection.layout === 'map' ||
                projection.layout === 'list' ||
                !projection.shouldRenderThumbnail ||
                projection.images.length === 0));
    if (retire) {
        if (failed.size) setFailed(new Set());
        if (selection.identity !== null || selection.index !== 0)
            setSelection({ identity: null, index: 0 });
    }
    return { failed, setFailed, selection, setSelection };
}

function Carousel({
    card,
    controller,
}: {
    card: Present;
    controller: ReturnType<typeof useCarouselController>;
}) {
    const { failed, setFailed, selection, setSelection } = controller;
    const images = linkedFinderCarouselImages(card.images, failed);
    const index = linkedFinderCarouselIndex(
        images,
        selection.identity,
        selection.index
    );
    const image = images[index];
    const offset = `-${index * 100}%`;
    useCommittedEffect(() => {
        const identity = image?.identity ?? null;
        if (selection.identity !== identity || selection.index !== index)
            setSelection((previous) =>
                previous.identity === selection.identity &&
                previous.index === selection.index
                    ? { identity, index }
                    : previous
            );
    }, [image?.identity, index, selection, setSelection]);
    const committed = useRef(images);
    useCommittedEffect(() => {
        committed.current = images;
        return () => {
            if (committed.current === images) committed.current = [];
        };
    });
    const change = (delta: number) => {
        if (committed.current !== images) return;
        const next = (index + delta + images.length) % images.length;
        setSelection({ identity: images[next].identity, index: next });
    };
    const select = (next: number) => {
        if (committed.current !== images || !images[next]) return;
        setSelection({ identity: images[next].identity, index: next });
    };
    return h(
        'div',
        {
            className: 'mx-sdk-finder-carousel',
            style: { height: card.imageHeight },
            onClick: stop,
            onKeyDown: stop,
        },
        image
            ? h(
                  'div',
                  {
                      className: 'mx-sdk-finder-carousel-track',
                      style:
                          card.layout === 'gallery'
                              ? ({
                                    '--mx-sdk-finder-carousel-offset': offset,
                                } as CSSProperties)
                              : { transform: `translateX(${offset})` },
                  },
                  images.map((attempt, attemptIndex) =>
                      h('img', {
                          key: attempt.failureKey,
                          src: attempt.source,
                          alt: attempt.image.filename,
                          'aria-hidden':
                              card.layout === 'gallery' &&
                              attemptIndex !== index
                                  ? true
                                  : undefined,
                          'data-visible':
                              attemptIndex === index ? 'true' : 'false',
                          style: { objectFit: card.imageFit },
                          onError: () => {
                              if (
                                  committed.current.some(
                                      (current) =>
                                          current.failureKey ===
                                          attempt.failureKey
                                  )
                              )
                                  setFailed(
                                      (previous) =>
                                          new Set([
                                              ...previous,
                                              attempt.failureKey,
                                          ])
                                  );
                          },
                      })
                  )
              )
            : h(
                  'span',
                  {
                      className: 'mx-sdk-finder-image-placeholder',
                      role: 'img',
                      'aria-label': card.labels.noImage,
                  },
                  card.layout === 'gallery' ? h(GalleryPlaceholder) : '▧'
              ),
        images.length > 1
            ? h(
                  Fragment,
                  null,
                  h(
                      'button',
                      {
                          type: 'button',
                          'aria-label': card.labels.previousImage,
                          onClick: () => change(-1),
                      },
                      '‹'
                  ),
                  h(
                      'button',
                      {
                          type: 'button',
                          'aria-label': card.labels.nextImage,
                          onClick: () => change(1),
                      },
                      '›'
                  ),
                  h(
                      'div',
                      { className: 'mx-sdk-finder-carousel-dots' },
                      images.map((attempt, dotIndex) =>
                          h(
                              'button',
                              {
                                  key: attempt.failureKey,
                                  type: 'button',
                                  'aria-label': (
                                      card.labels.viewImage ?? '{index}'
                                  ).replace('{index}', String(dotIndex + 1)),
                                  'aria-current':
                                      dotIndex === index ? 'true' : undefined,
                                  onClick: () => select(dotIndex),
                              },
                              h(
                                  'span',
                                  { 'aria-hidden': true },
                                  card.layout === 'gallery' ? undefined : '●'
                              )
                          )
                      )
                  )
              )
            : null
    );
}

function GalleryPlaceholder(): ReactElement {
    // Native Heroicons solid Photo geometry; MIT, see THIRD_PARTY_NOTICES.
    return h(
        'svg',
        {
            viewBox: '0 0 24 24',
            fill: 'currentColor',
            'aria-hidden': true,
            className: 'mx-sdk-finder-gallery-placeholder',
        },
        h('path', {
            fillRule: 'evenodd',
            clipRule: 'evenodd',
            d: 'M1.5 6a2.25 2.25 0 0 1 2.25-2.25h16.5A2.25 2.25 0 0 1 22.5 6v12a2.25 2.25 0 0 1-2.25 2.25H3.75A2.25 2.25 0 0 1 1.5 18V6ZM3 16.06V18c0 .414.336.75.75.75h16.5A.75.75 0 0 0 21 18v-1.94l-2.69-2.689a1.5 1.5 0 0 0-2.12 0l-.88.879.97.97a.75.75 0 1 1-1.06 1.06l-5.16-5.159a1.5 1.5 0 0 0-2.12 0L3 16.061Zm10.125-7.81a1.125 1.125 0 1 1 2.25 0 1.125 1.125 0 0 1-2.25 0Z',
        })
    );
}

export function LinkedFinderCard({
    projection,
    nativeFormListPresentation,
}: {
    projection: LinkedFinderCardProjection | LinkedFinderMapCardProjection;
    nativeFormListPresentation?: boolean;
}): ReactElement {
    const carousel = useCarouselController(projection);
    if (projection.status !== 'present')
        return h(
            'div',
            {
                className: `mx-sdk-finder-card-${projection.status}`,
                role: projection.status === 'loading' ? 'status' : undefined,
            },
            projection.label
        );
    if (projection.layout === 'map')
        return h(
            'p',
            {
                className: [
                    'mx-sdk-finder-map-primary',
                    projection.primaryIsEmpty
                        ? 'mx-sdk-finder-map-primary-empty'
                        : '',
                ].join(' '),
                title: projection.primary,
                'aria-label': projection.primary,
            },
            projection.primary
        );
    return h(PresentCard, {
        projection,
        carousel,
        nativeFormListPresentation,
    });
}

function CardDetail({
    field,
    layout,
}: {
    field: LinkedFinderCardField;
    layout: Present['layout'];
}): ReactElement {
    const titleId = useId();
    const named = layout === 'gallery' && field.title !== null;
    return h(
        'div',
        { className: 'mx-sdk-finder-card-field' },
        field.title !== null
            ? h(
                  'div',
                  {
                      className: 'mx-sdk-finder-card-field-title',
                      id: named ? titleId : undefined,
                      role: named ? 'term' : undefined,
                  },
                  field.title
              )
            : null,
        h(
            'div',
            {
                className: 'mx-sdk-finder-card-field-value',
                role: named ? 'definition' : undefined,
                'aria-labelledby': named ? titleId : undefined,
            },
            h(LinkedFinderRichLeaf, { leaf: field.leaf })
        )
    );
}

function PresentCard({
    projection,
    carousel,
    nativeFormListPresentation,
}: {
    projection: Present;
    carousel: ReturnType<typeof useCarouselController>;
    nativeFormListPresentation?: boolean;
}): ReactElement {
    const showsNativePrimary =
        projection.layout === 'gallery' ||
        (nativeFormListPresentation && projection.layout === 'list');
    // Native List position belongs to the record presenter, so it survives
    // thumbnail hiding, moving sides and a Gallery/Kanban round trip.
    const listImage = useListImage(projection);
    return h(
        'div',
        {
            className: `mx-sdk-finder-card mx-sdk-finder-card-${projection.layout}`,
        },
        projection.shouldRenderThumbnail &&
            (projection.layout !== 'list' ||
                projection.thumbnailLocation === 'left')
            ? projection.layout === 'list'
                ? listImage
                : projection.images.length
                  ? h(Carousel, { card: projection, controller: carousel })
                  : h(
                        'div',
                        {
                            className: 'mx-sdk-finder-carousel',
                            style: { height: projection.imageHeight },
                            role: 'img',
                            'aria-label': projection.labels.noImage,
                        },
                        projection.layout === 'gallery'
                            ? h(GalleryPlaceholder)
                            : '▧'
                    )
            : null,
        h(
            'div',
            { className: 'mx-sdk-finder-card-content' },
            h(
                'p',
                {
                    className: [
                        'mx-sdk-finder-card-primary',
                        showsNativePrimary && projection.primaryIsEmpty
                            ? 'mx-sdk-finder-card-primary-empty'
                            : '',
                        showsNativePrimary && projection.fields.length
                            ? 'mx-sdk-finder-card-primary-with-details'
                            : '',
                    ]
                        .filter(Boolean)
                        .join(' '),
                    title: showsNativePrimary ? projection.primary : undefined,
                    'aria-label': showsNativePrimary
                        ? projection.primary
                        : undefined,
                },
                projection.primary
            ),
            projection.layout !== 'gallery' || projection.fields.length
                ? h(
                      'div',
                      {
                          className: `mx-sdk-finder-card-fields mx-sdk-finder-card-fields-${projection.layout}`,
                          style:
                              projection.layout === 'list'
                                  ? undefined
                                  : {
                                        gridTemplateColumns: `repeat(${projection.fieldsPerCardRow}, minmax(150px, 1fr))`,
                                    },
                      },
                      projection.fields.map((field) =>
                          h(CardDetail, {
                              key: field.key,
                              field,
                              layout: projection.layout,
                          })
                      )
                  )
                : null
        ),
        projection.shouldRenderThumbnail &&
            projection.layout === 'list' &&
            projection.thumbnailLocation === 'right'
            ? listImage
            : null
    );
}
