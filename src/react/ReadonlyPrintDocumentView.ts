import { createElement as h, Fragment, useId, type ReactNode } from 'react';
import {
    captureReadonlyPrintDocument,
    type ReadonlyPrintCapture,
    type ReadonlyPrintDocument,
    type ReadonlyPrintFacet,
    type ReadonlyPrintField,
} from '../ui/readonlyPrintDocument.js';
import { CompleteFormFieldPresentation } from './CompleteFormFieldPresentation.js';
import { CompleteReadOnlyTextField } from './CompleteReadOnlyTextField.js';
import { CompleteReadOnlyPhoneNumberField } from './CompleteReadOnlyPhoneNumberField.js';
import { CompleteCheckboxField } from './CompleteCheckboxField.js';
import { CompleteHTMLRenderer } from './html/CompleteHTMLRenderer.js';
import { CompleteQuillHTMLRenderer } from './html/CompleteQuillHTMLRenderer.js';
import { CompleteRichTextEditor } from './CompleteRichTextEditor.js';
import { RatingInput } from './RatingInput.js';
import { PersonBadge } from './PersonBadge.js';
import { RecoverableImage } from './RecoverableImage.js';
import {
    fieldPresentationDescribedBy,
    type FieldPresentationComposition,
} from './fieldPresentation.js';

const noop = () => {};
const safeHref = (href: string | null) =>
    href === null || /^(?:https?:|mailto:|tel:|#|\/(?!\/))/i.test(href);

function supported(facet: ReadonlyPrintFacet): boolean {
    switch (facet.kind) {
        case 'unsupported':
            return false;
        case 'resource':
            return safeHref(facet.href);
        case 'rating':
            return (
                Number.isInteger(facet.max) &&
                facet.max > 0 &&
                facet.max <= 100 &&
                (facet.value === null ||
                    (facet.value >= 0 && facet.value <= facet.max))
            );
        case 'attachments':
            // Document/media thumbnail preparation is a separate admitted
            // cohort. An icon layout is already an exact static display.
            return (
                facet.layout === 'icon' ||
                facet.items.every(
                    (item) =>
                        item.kind === 'image' || item.imageSources.length > 0
                )
            );
        case 'linkedRecords':
            return facet.records.every(
                (record) =>
                    record.status !== 'present' ||
                    ((!record.thumbnail || supported(record.thumbnail)) &&
                        record.fields.every((field) => supported(field.facet)))
            );
        case 'sequence':
            return facet.items.every(supported);
        default:
            return true;
    }
}

/** Whole-document render admission; no partial SDK document or native slot. */
export function prepareReadonlyPrintDocument(
    input: ReadonlyPrintDocument
): ReadonlyPrintCapture {
    const captured = captureReadonlyPrintDocument(input);
    if (captured.status !== 'accepted') return captured;
    const field = captured.document.fields.find(
        (item) => !supported(item.facet)
    );
    return field
        ? {
              status: 'refused',
              reason: 'unsupported-facet',
              fieldKey: field.key,
          }
        : captured;
}

type Context = {
    language: ReadonlyPrintDocument['language'];
    identity: string;
    semanticTitle?: string;
};
function empty(label: string) {
    return h('span', { className: 'mx-sdk-print-empty' }, label);
}
function FileIcon({ play = false }: { play?: boolean }): ReactNode {
    return h(
        'svg',
        {
            viewBox: '0 0 24 24',
            'aria-hidden': true,
            className: 'mx-sdk-print-file-icon',
            fill: 'none',
            stroke: 'currentColor',
        },
        h('path', {
            d: play ? 'M8 4l12 8-12 8z' : 'M5 2h9l5 5v15H5z M14 2v6h5',
            fill: play ? 'currentColor' : 'none',
        })
    );
}
function Facet({
    facet,
    context,
    path,
    composition,
}: {
    facet: ReadonlyPrintFacet;
    context: Context;
    path: string;
    composition?: FieldPresentationComposition;
}): ReactNode {
    switch (facet.kind) {
        case 'notice':
            return h(
                'span',
                {
                    className: 'mx-sdk-print-notice',
                    'data-print-state': facet.state,
                },
                facet.label
            );
        case 'text':
        case 'date':
        case 'duration':
        case 'address':
            return h(CompleteReadOnlyTextField, {
                value: facet.value,
                language: context.language,
                emptyLabel: facet.emptyLabel,
                textSize: facet.textSize,
            });
        case 'phone':
            return h(CompleteReadOnlyPhoneNumberField, {
                value: facet.value,
                emptyLabel: facet.emptyLabel,
            });
        case 'numeric': {
            const fraction = facet.progress?.fraction ?? 0;
            const boundedFraction = Math.max(0, Math.min(1, fraction));
            const percent = boundedFraction * 100;
            return h(
                'div',
                { className: 'mx-sdk-print-numeric' },
                facet.progress && facet.text !== null
                    ? h(
                          'div',
                          {
                              className: 'mx-sdk-print-progress',
                              role: 'progressbar',
                              'aria-valuenow': percent,
                              'aria-valuemin': 0,
                              'aria-valuemax': 100,
                              'aria-valuetext':
                                  boundedFraction === fraction
                                      ? undefined
                                      : facet.text,
                          },
                          h('div', {
                              style: {
                                  width: `${percent}%`,
                                  backgroundColor: facet.progress.color,
                              },
                          })
                      )
                    : null,
                h(CompleteReadOnlyTextField, {
                    value: facet.text,
                    language: context.language,
                    emptyLabel: facet.emptyLabel,
                })
            );
        }
        case 'html':
            return facet.value
                ? h(
                      'div',
                      {
                          className: 'mx-sdk-print-html',
                          style: { height: facet.height },
                      },
                      h(CompleteHTMLRenderer, { html: facet.value })
                  )
                : empty(facet.emptyLabel);
        case 'quill':
            return facet.value
                ? h(CompleteQuillHTMLRenderer, { html: facet.value })
                : empty(facet.emptyLabel);
        case 'markdown':
            return h(CompleteRichTextEditor, {
                value: facet.value,
                readOnly: true,
                onValueChange: noop,
                emptyContent: facet.emptyLabel,
                identity: `${context.identity}/${path}`,
                ariaLabelledBy: composition?.association.labelId,
                ariaDescribedBy: composition
                    ? fieldPresentationDescribedBy(composition.association)
                    : undefined,
            });
        case 'pills':
            return facet.items.length
                ? h(
                      'div',
                      { className: 'mx-sdk-print-pills' },
                      facet.items.map((item, index) =>
                          h(
                              'span',
                              {
                                  key: index,
                                  className: 'mx-sdk-print-pill',
                                  style: {
                                      color: item.color,
                                      backgroundColor: item.backgroundColor,
                                  },
                              },
                              item.label
                          )
                      )
                  )
                : empty(facet.emptyLabel);
        case 'people':
            return facet.items.length
                ? h(
                      'ul',
                      { className: 'mx-sdk-print-people' },
                      facet.items.map((item, index) =>
                          h(PersonBadge, {
                              key: index,
                              label: item.label,
                              className: 'mx-sdk-print-person',
                              avatar: item.avatarUrl
                                  ? h('img', {
                                        src: item.avatarUrl,
                                        alt: '',
                                        width: 32,
                                        height: 32,
                                        loading: 'eager',
                                    })
                                  : undefined,
                          })
                      )
                  )
                : empty(facet.emptyLabel);
        case 'checkbox':
            return h(CompleteCheckboxField, {
                value: facet.value,
                onChange: noop,
                readOnly: true,
                checkedStateLabel: facet.checkedLabel,
                uncheckedStateLabel: facet.uncheckedLabel,
                presentation: composition,
            });
        case 'rating':
            return h(RatingInput, {
                value: facet.value,
                max: facet.max,
                disabled: true,
                onChange: noop,
                grid: false,
                empty: empty(facet.emptyLabel),
                iconsClassName: 'mx-sdk-print-rating-icons',
                printSummaryClassName: 'mx-sdk-print-rating-summary',
                inputProps: {
                    className: 'mx-sdk-print-rating-range',
                    id:
                        composition?.association.kind === 'input'
                            ? composition.association.controlId
                            : undefined,
                    'aria-label': composition
                        ? undefined
                        : context.semanticTitle,
                    'aria-labelledby': composition?.association.labelId,
                    'aria-describedby': composition
                        ? fieldPresentationDescribedBy(composition.association)
                        : undefined,
                },
                renderIcon: ({ filled }) =>
                    h(
                        'svg',
                        { viewBox: facet.glyph.viewBox, 'aria-hidden': true },
                        h('path', {
                            d: facet.glyph.path,
                            fillRule: 'evenodd',
                            fill: filled
                                ? facet.color
                                : facet.glyph.unfilledColor,
                        })
                    ),
            });
        case 'barcode':
            // The canonical native display-only BarcodeField is literal text.
            return h(CompleteReadOnlyTextField, {
                value: facet.text,
                language: context.language,
                emptyLabel: facet.emptyLabel,
            });
        case 'resource':
            return facet.href
                ? h(
                      'a',
                      { className: 'mx-sdk-print-resource', href: facet.href },
                      facet.label
                  )
                : h(
                      'span',
                      { className: 'mx-sdk-print-resource' },
                      facet.label
                  );
        case 'attachments':
            return facet.items.length
                ? h(
                      'div',
                      {
                          className: `mx-sdk-print-attachments mx-sdk-print-attachments-${facet.layout}`,
                          'data-thumbnail-size': facet.thumbnailSize,
                          style: {
                              gridTemplateColumns:
                                  facet.layout !== 'icon'
                                      ? `repeat(${facet.columns}, minmax(0, 1fr))`
                                      : undefined,
                          },
                      },
                      facet.items.map((item, index) =>
                          h(
                              'figure',
                              {
                                  key: `${index}:${item.key}`,
                                  className: 'mx-sdk-print-attachment',
                              },
                              item.imageSources.length > 0
                                  ? h(RecoverableImage, {
                                        sources: item.imageSources,
                                        alt: item.label,
                                        loading: 'eager',
                                        style: {
                                            objectFit:
                                                facet.layout === 'icon'
                                                    ? 'cover'
                                                    : facet.fit,
                                            height:
                                                facet.layout === 'icon'
                                                    ? undefined
                                                    : facet.thumbnailHeight,
                                        },
                                        renderFallback: () =>
                                            h(
                                                'span',
                                                {
                                                    className:
                                                        'mx-sdk-print-file-fallback',
                                                },
                                                h(FileIcon),
                                                facet.unavailableLabel ??
                                                    facet.emptyLabel
                                            ),
                                    })
                                  : h(FileIcon, {
                                        play:
                                            item.kind === 'audio' ||
                                            item.kind === 'video',
                                    }),
                              facet.showNames
                                  ? h('figcaption', null, item.label)
                                  : null
                          )
                      )
                  )
                : empty(facet.emptyLabel);
        case 'linkedRecords':
            return facet.records.length
                ? h(
                      'div',
                      {
                          className: `mx-sdk-print-records mx-sdk-print-records-${facet.layout}`,
                          style: {
                              gridTemplateColumns:
                                  facet.layout === 'gallery'
                                      ? `repeat(${facet.columns}, minmax(0, 1fr))`
                                      : undefined,
                          },
                      },
                      facet.records.map((record, index) =>
                          record.status !== 'present'
                              ? h(
                                    'div',
                                    {
                                        key: `${index}:${record.key}`,
                                        'data-print-state': record.status,
                                    },
                                    record.label
                                )
                              : h(
                                    'article',
                                    {
                                        key: `${index}:${record.key}`,
                                        className: 'mx-sdk-print-record',
                                        'data-thumbnail-location':
                                            facet.thumbnailLocation,
                                    },
                                    record.thumbnail
                                        ? h(
                                              'div',
                                              {
                                                  className:
                                                      'mx-sdk-print-record-thumbnail',
                                              },
                                              h(Facet, {
                                                  facet: record.thumbnail,
                                                  context,
                                                  path: `${path}/${index}/thumbnail`,
                                              })
                                          )
                                        : null,
                                    h(
                                        'div',
                                        {
                                            className:
                                                'mx-sdk-print-record-body',
                                        },
                                        h('h3', null, record.primary),
                                        record.fields.map((field, detail) =>
                                            h(Field, {
                                                key: `${detail}:${field.key}`,
                                                field,
                                                context,
                                                path: `${path}/${index}/${detail}`,
                                            })
                                        )
                                    )
                                )
                      )
                  )
                : empty(facet.emptyLabel);
        case 'sequence':
            return facet.items.length
                ? h(
                      'div',
                      {
                          className: `mx-sdk-print-sequence mx-sdk-print-sequence-${facet.layout}`,
                      },
                      facet.items.map((item, index) =>
                          h(Facet, {
                              key: index,
                              facet: item,
                              context,
                              path: `${path}/${index}`,
                          })
                      )
                  )
                : empty(facet.emptyLabel);
        case 'unsupported':
            return null; // Whole-document admission rejects this before rendering.
    }
}
function Field({
    field,
    context,
    path,
}: {
    field: ReadonlyPrintField;
    context: Context;
    path: string;
}): ReactNode {
    const diagramUrl =
        field.description?.placement === 'tooltip'
            ? field.description.imageUrl?.trim()
            : null;
    return h(CompleteFormFieldPresentation, {
        title: field.title,
        fieldName: field.fieldName,
        semanticTitle: field.semanticTitle,
        showTitle: field.showTitle,
        required: field.required,
        associationKind:
            field.facet.kind === 'rating' || field.facet.kind === 'checkbox'
                ? 'input'
                : 'group',
        sameRow: field.sameRow,
        enableSideBySideOnMobile: field.enableSideBySideOnMobile,
        description: field.description?.html,
        descriptionImageUrl: field.description?.imageUrl,
        descriptionPlacement: field.description?.placement,
        truncateDescription: field.description?.truncate,
        readMoreLabel: field.description?.readMoreLabel,
        showLessLabel: field.description?.showLessLabel,
        error: field.error,
        className: 'mx-sdk-print-field',
        children: (composition) =>
            h(
                Fragment,
                null,
                diagramUrl
                    ? h(RecoverableImage, {
                          className:
                              'mx-sdk-field-description-image mx-sdk-print-tooltip-image',
                          sources: [diagramUrl],
                          alt: '',
                          loading: 'lazy',
                          renderFallback: () => null,
                      })
                    : null,
                h(Facet, {
                    facet: field.facet,
                    context: { ...context, semanticTitle: field.semanticTitle },
                    path,
                    composition,
                })
            ),
    });
}

export type ReadonlyPrintDocumentViewProps = {
    /** Host-admitted display facts. The view detaches them before rendering. */
    document: ReadonlyPrintDocument;
    className?: string;
};

/** Actual SDK-owned print DOM. It owns no client, record, Save or native renderer callback. */
export function ReadonlyPrintDocumentView(
    props: ReadonlyPrintDocumentViewProps
): ReactNode {
    const identity = useId();
    const prepared = prepareReadonlyPrintDocument(props.document);
    if (prepared.status !== 'accepted') return null;
    const document = prepared.document;
    const context = { language: document.language, identity };
    return h(
        'div',
        {
            className: ['mx-sdk-print-document', props.className]
                .filter(Boolean)
                .join(' '),
            'data-mx-print-document': '',
            lang: document.language,
        },
        document.title
            ? h('h1', { className: 'mx-sdk-print-title' }, document.title)
            : null,
        document.fields.map((field, index) =>
            h(Field, {
                key: `${index}:${field.key}`,
                field,
                context,
                path: String(index),
            })
        )
    );
}
