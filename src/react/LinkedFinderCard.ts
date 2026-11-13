import {
    createElement as h,
    Fragment,
    useEffect,
    useLayoutEffect,
    useId,
    useRef,
    useState,
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
    | {
          readonly kind: 'text';
          readonly display: CompleteReadOnlyTextFieldProps;
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
    | { readonly kind: 'pills'; readonly items: readonly LinkedFinderPill[] }
    | { readonly kind: 'linkedPills'; readonly labels: readonly string[] }
    | {
          readonly kind: 'people';
          readonly items: readonly {
              readonly label: string;
              readonly avatar?: LinkedFinderImage;
          }[];
      }
    | {
          readonly kind: 'rating';
          readonly value: number;
          readonly max: number;
          readonly icon: 'star' | 'heart' | 'thumbsUp' | 'flag' | 'dot';
          readonly color: string;
          readonly label: string;
      }
    | {
          readonly kind: 'attachmentImages';
          readonly images: readonly LinkedFinderImage[];
          readonly empty: 'none' | 'no-values';
          readonly emptyLabel: string;
      }
    | {
          readonly kind: 'sequence';
          readonly leaves: readonly LinkedFinderCardLeaf[];
      };

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
export type LinkedFinderCardProjection =
    | { readonly status: 'loading'; readonly label: string }
    | { readonly status: 'unavailable'; readonly label: string }
    | {
          readonly status: 'present';
          readonly primary: string;
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
        'span',
        {
            className: 'mx-sdk-finder-rating',
            role: 'img',
            'aria-label': leaf.label,
        },
        Array.from(
            { length: Math.max(0, Math.min(100, Math.floor(leaf.max))) },
            (_, index) =>
                h(
                    'svg',
                    {
                        key: index,
                        viewBox: '0 0 24 24',
                        'aria-hidden': true,
                        style: {
                            color: index < leaf.value ? leaf.color : '#d1d5db',
                        },
                        fill: 'currentColor',
                    },
                    h('path', { d: paths[leaf.icon] })
                )
        )
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
        case 'text':
            return h(CompleteReadOnlyTextField, leaf.display);
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
                'span',
                { className: 'mx-sdk-finder-pills' },
                leaf.items.map((item, index) =>
                    h(
                        'span',
                        { key: index, className: 'mx-sdk-finder-person' },
                        item.avatar
                            ? h('img', {
                                  src: item.avatar.url,
                                  alt: '',
                                  className: 'mx-sdk-finder-avatar',
                              })
                            : null,
                        item.label
                    )
                )
            );
        case 'rating':
            return h(Rating, { leaf });
        case 'attachmentImages':
            return leaf.images.length
                ? h(
                      'span',
                      { className: 'mx-sdk-finder-attachment-images' },
                      leaf.images.map((image, index) =>
                          h('img', {
                              key: `${image.id ?? index}:${image.url}`,
                              src: image.url,
                              alt: image.filename,
                              loading: 'lazy',
                          })
                      )
                  )
                : leaf.empty === 'no-values'
                  ? h('span', null, leaf.emptyLabel)
                  : h('span');
        case 'sequence':
            return h(
                Fragment,
                null,
                leaf.leaves.map((child, index) =>
                    h(LinkedFinderRichLeaf, { key: index, leaf: child })
                )
            );
    }
}

type Present = Extract<LinkedFinderCardProjection, { status: 'present' }>;
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

function Carousel({ card }: { card: Present }) {
    const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
    const images = linkedFinderCarouselImages(card.images, failed);
    const [selection, setSelection] = useState<{
        identity: string | null;
        index: number;
    }>({ identity: null, index: 0 });
    const index = linkedFinderCarouselIndex(
        images,
        selection.identity,
        selection.index
    );
    const image = images[index];
    if (
        selection.identity !== (image?.identity ?? null) ||
        selection.index !== index
    )
        setSelection({ identity: image?.identity ?? null, index });
    const committed = useRef(images);
    useCommittedEffect(() => {
        committed.current = images;
    });
    const change = (delta: number) => {
        const next = (index + delta + images.length) % images.length;
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
                      style: { transform: `translateX(-${index * 100}%)` },
                  },
                  images.map((attempt, attemptIndex) =>
                      h('img', {
                          key: attempt.failureKey,
                          src: attempt.source,
                          alt: attempt.image.filename,
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
                  '▧'
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
                                  onClick: () =>
                                      setSelection({
                                          identity: attempt.identity,
                                          index: dotIndex,
                                      }),
                              },
                              h('span', { 'aria-hidden': true }, '●')
                          )
                      )
                  )
              )
            : null
    );
}

export function LinkedFinderCard({
    projection,
}: {
    projection: LinkedFinderCardProjection;
}): ReactElement {
    if (projection.status !== 'present')
        return h(
            'div',
            {
                className: `mx-sdk-finder-card-${projection.status}`,
                role: projection.status === 'loading' ? 'status' : undefined,
            },
            projection.label
        );
    return h(PresentCard, { projection });
}

function PresentCard({ projection }: { projection: Present }): ReactElement {
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
                  ? h(Carousel, { card: projection })
                  : h(
                        'div',
                        {
                            className: 'mx-sdk-finder-carousel',
                            style: { height: projection.imageHeight },
                            role: 'img',
                            'aria-label': projection.labels.noImage,
                        },
                        '▧'
                    )
            : null,
        h(
            'div',
            { className: 'mx-sdk-finder-card-content' },
            h(
                'p',
                { className: 'mx-sdk-finder-card-primary' },
                projection.primary
            ),
            h(
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
                    h(
                        'div',
                        {
                            key: field.key,
                            className: 'mx-sdk-finder-card-field',
                        },
                        field.title !== null
                            ? h(
                                  'div',
                                  {
                                      className:
                                          'mx-sdk-finder-card-field-title',
                                  },
                                  field.title
                              )
                            : null,
                        h(
                            'div',
                            { className: 'mx-sdk-finder-card-field-value' },
                            h(LinkedFinderRichLeaf, { leaf: field.leaf })
                        )
                    )
                )
            )
        ),
        projection.shouldRenderThumbnail &&
            projection.layout === 'list' &&
            projection.thumbnailLocation === 'right'
            ? listImage
            : null
    );
}
