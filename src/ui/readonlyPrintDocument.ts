import type { RuntimeLanguage } from '../runtime/types.js';

/** Display facts admitted by the host; this DTO carries no read or write authority. */
export type ReadonlyPrintFacet =
    | {
          readonly kind: 'notice';
          readonly state: 'empty' | 'unavailable' | 'loading' | 'invalid';
          readonly label: string;
      }
    | {
          readonly kind: 'text' | 'phone' | 'date' | 'duration' | 'address';
          readonly value: string | null;
          readonly emptyLabel: string;
          readonly textSize?: 'small' | 'medium' | 'large' | 'very large';
      }
    | {
          readonly kind: 'numeric';
          /** The exact native physical/computed formatting, captured before admission. */
          readonly text: string | null;
          readonly emptyLabel: string;
          readonly progress?: {
              readonly fraction: number;
              readonly color: string;
          };
      }
    | {
          readonly kind: 'html' | 'quill' | 'markdown';
          readonly value: string | null;
          readonly emptyLabel: string;
          readonly height?: number;
      }
    | {
          readonly kind: 'pills';
          readonly items: readonly {
              readonly label: string;
              readonly color?: string;
              readonly backgroundColor?: string;
          }[];
          readonly emptyLabel: string;
      }
    | {
          readonly kind: 'people';
          readonly items: readonly {
              readonly label: string;
              readonly avatarUrl?: string;
          }[];
          readonly emptyLabel: string;
      }
    | {
          readonly kind: 'checkbox';
          readonly value: boolean | null;
          readonly checkedLabel: string;
          readonly uncheckedLabel: string;
      }
    | {
          readonly kind: 'rating';
          readonly icon: 'star' | 'heart' | 'thumbsUp' | 'flag' | 'dot';
          readonly value: number | null;
          readonly max: number;
          readonly color: string;
          readonly emptyLabel: string;
          readonly glyph: {
              readonly path: string;
              readonly viewBox: string;
              readonly unfilledColor: string;
          };
      }
    | {
          readonly kind: 'barcode';
          readonly text: string;
          readonly barcodeType: string;
          readonly emptyLabel: string;
      }
    | {
          readonly kind: 'resource';
          readonly label: string;
          readonly href: string | null;
      }
    | {
          readonly kind: 'attachments';
          readonly items: readonly {
              readonly key: string;
              readonly label: string;
              readonly kind: 'image' | 'document' | 'audio' | 'video' | 'file';
              readonly url: string;
              /** Already admitted sources, in native fallback order. */
              readonly imageSources: readonly string[];
          }[];
          readonly layout: 'grid' | 'thumbnail' | 'icon';
          readonly columns: number;
          readonly fit: 'cover' | 'contain';
          readonly thumbnailSize: 'small' | 'medium' | 'large';
          readonly thumbnailHeight?: number;
          readonly showNames: boolean;
          readonly emptyLabel: string;
      }
    | {
          readonly kind: 'linkedRecords';
          readonly records: readonly ReadonlyPrintLinkedRecord[];
          readonly layout: 'list' | 'gallery';
          readonly thumbnailLocation: 'left' | 'right';
          readonly columns: number;
          readonly emptyLabel: string;
      }
    | {
          readonly kind: 'sequence';
          readonly items: readonly ReadonlyPrintFacet[];
          readonly layout: 'inline' | 'stack' | 'wrap';
          readonly emptyLabel: string;
      }
    | {
          readonly kind: 'unsupported';
          readonly reason:
              | 'unsupported-presentation'
              | 'unavailable-projection';
      };

export type ReadonlyPrintLinkedRecord =
    | {
          readonly key: string;
          readonly status: 'present';
          readonly primary: string;
          readonly fields: readonly ReadonlyPrintField[];
          readonly thumbnail?: Extract<
              ReadonlyPrintFacet,
              { kind: 'attachments' }
          >;
      }
    | {
          readonly key: string;
          readonly status: 'loading' | 'unavailable';
          readonly label: string;
      };

export type ReadonlyPrintField = {
    /** Occurrence identity; order and duplicate occurrences are never deduplicated. */
    readonly key: string;
    readonly fieldName: string;
    readonly title: string;
    readonly showTitle: boolean;
    readonly required: boolean;
    readonly sameRow: boolean;
    readonly enableSideBySideOnMobile: boolean;
    readonly description?: {
        readonly html: string | null;
        readonly imageUrl: string | null;
        readonly placement: 'top' | 'bottom' | 'tooltip';
        readonly truncate: boolean;
    };
    readonly error?: string | null;
    readonly facet: ReadonlyPrintFacet;
};

/** A flat full-Form display projection, never a record, schema, client or page model. */
export type ReadonlyPrintDocument = {
    readonly language: RuntimeLanguage;
    readonly title?: string;
    readonly fields: readonly ReadonlyPrintField[];
};

export type ReadonlyPrintCapture =
    | { readonly status: 'accepted'; readonly document: ReadonlyPrintDocument }
    | {
          readonly status: 'refused';
          readonly reason: 'invalid-document' | 'unsupported-facet';
          readonly fieldKey?: string;
      };

type Rule = (value: unknown) => boolean;
const text: Rule = (value) => typeof value === 'string';
const bool: Rule = (value) => typeof value === 'boolean';
const finite: Rule = (value) =>
    typeof value === 'number' && Number.isFinite(value);
const columns: Rule = (value) =>
    finite(value) && Number.isInteger(value) && (value as number) > 0;
const nullable =
    (rule: Rule): Rule =>
    (value) =>
        value === null || rule(value);
const oneOf =
    (...values: readonly string[]): Rule =>
    (value) =>
        typeof value === 'string' && values.includes(value);
const list =
    (rule: Rule): Rule =>
    (value) =>
        Array.isArray(value) && value.every(rule);
function shape(
    value: unknown,
    required: Readonly<Record<string, Rule>>,
    optional: Readonly<Record<string, Rule>> = {}
): value is Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return false;
    const record = value as Record<string, unknown>;
    return (
        Object.keys(record).every(
            (key) =>
                Object.hasOwn(required, key) || Object.hasOwn(optional, key)
        ) &&
        Object.entries(required).every(
            ([key, rule]) => Object.hasOwn(record, key) && rule(record[key])
        ) &&
        Object.entries(optional).every(
            ([key, rule]) => record[key] === undefined || rule(record[key])
        )
    );
}

const empty = { emptyLabel: text };
const kind = (value: string): Rule => oneOf(value);
const fieldRule: Rule = (value) =>
    shape(
        value,
        {
            key: text,
            fieldName: text,
            title: text,
            showTitle: bool,
            required: bool,
            sameRow: bool,
            enableSideBySideOnMobile: bool,
            facet: facetRule,
        },
        {
            error: nullable(text),
            description: (item) =>
                shape(item, {
                    html: nullable(text),
                    imageUrl: nullable(text),
                    placement: oneOf('top', 'bottom', 'tooltip'),
                    truncate: bool,
                }),
        }
    );
const facetRule: Rule = (value) => {
    if (value === null || typeof value !== 'object' || !('kind' in value))
        return false;
    switch (value.kind) {
        case 'notice':
            return shape(value, {
                kind: kind('notice'),
                state: oneOf('empty', 'unavailable', 'loading', 'invalid'),
                label: text,
            });
        case 'text':
        case 'phone':
        case 'date':
        case 'duration':
        case 'address':
            return shape(
                value,
                { kind: kind(value.kind), value: nullable(text), ...empty },
                {
                    textSize: oneOf('small', 'medium', 'large', 'very large'),
                }
            );
        case 'numeric':
            return shape(
                value,
                { kind: kind('numeric'), text: nullable(text), ...empty },
                {
                    progress: (item) =>
                        shape(item, { fraction: finite, color: text }),
                }
            );
        case 'html':
        case 'quill':
        case 'markdown':
            return shape(
                value,
                { kind: kind(value.kind), value: nullable(text), ...empty },
                { height: finite }
            );
        case 'pills':
            return shape(value, {
                kind: kind('pills'),
                ...empty,
                items: list((item) =>
                    shape(
                        item,
                        { label: text },
                        { color: text, backgroundColor: text }
                    )
                ),
            });
        case 'people':
            return shape(value, {
                kind: kind('people'),
                ...empty,
                items: list((item) =>
                    shape(item, { label: text }, { avatarUrl: text })
                ),
            });
        case 'checkbox':
            return shape(value, {
                kind: kind('checkbox'),
                value: nullable(bool),
                checkedLabel: text,
                uncheckedLabel: text,
            });
        case 'rating':
            return shape(value, {
                kind: kind('rating'),
                icon: oneOf('star', 'heart', 'thumbsUp', 'flag', 'dot'),
                value: nullable(finite),
                max: finite,
                color: text,
                ...empty,
                glyph: (item) =>
                    shape(item, {
                        path: text,
                        viewBox: text,
                        unfilledColor: text,
                    }),
            });
        case 'barcode':
            return shape(value, {
                kind: kind('barcode'),
                text,
                barcodeType: text,
                ...empty,
            });
        case 'resource':
            return shape(value, {
                kind: kind('resource'),
                label: text,
                href: nullable(text),
            });
        case 'attachments':
            return shape(
                value,
                {
                    kind: kind('attachments'),
                    ...empty,
                    layout: oneOf('grid', 'thumbnail', 'icon'),
                    columns,
                    fit: oneOf('cover', 'contain'),
                    thumbnailSize: oneOf('small', 'medium', 'large'),
                    showNames: bool,
                    items: list((item) =>
                        shape(item, {
                            key: text,
                            label: text,
                            kind: oneOf(
                                'image',
                                'document',
                                'audio',
                                'video',
                                'file'
                            ),
                            url: text,
                            imageSources: list(text),
                        })
                    ),
                },
                { thumbnailHeight: finite }
            );
        case 'linkedRecords':
            return shape(value, {
                kind: kind('linkedRecords'),
                ...empty,
                layout: oneOf('list', 'gallery'),
                thumbnailLocation: oneOf('left', 'right'),
                columns,
                records: list(
                    (record) =>
                        shape(
                            record,
                            {
                                key: text,
                                status: kind('present'),
                                primary: text,
                                fields: list(fieldRule),
                            },
                            {
                                thumbnail: (item) =>
                                    facetRule(item) &&
                                    (item as { kind: string }).kind ===
                                        'attachments',
                            }
                        ) ||
                        shape(record, {
                            key: text,
                            status: oneOf('loading', 'unavailable'),
                            label: text,
                        })
                ),
            });
        case 'sequence':
            return shape(value, {
                kind: kind('sequence'),
                ...empty,
                layout: oneOf('inline', 'stack', 'wrap'),
                items: list(facetRule),
            });
        case 'unsupported':
            return shape(value, {
                kind: kind('unsupported'),
                reason: oneOf(
                    'unsupported-presentation',
                    'unavailable-projection'
                ),
            });
        default:
            return false;
    }
};

/** Copy data descriptors only: never call getters, toJSON, callbacks or class methods. */
function copyData(
    value: unknown,
    ancestors: Set<object>,
    depth: number
): unknown {
    if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'boolean'
    )
        return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || depth > 128 || ancestors.has(value))
        throw new Error('invalid');
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null && !Array.isArray(value))
        throw new Error('invalid');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length) throw new Error('invalid');
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            if (Object.keys(descriptors).length !== value.length + 1)
                throw new Error('invalid');
            return Object.freeze(
                Array.from({ length: value.length }, (_, index) => {
                    const entry = descriptors[String(index)];
                    if (!entry || !('value' in entry))
                        throw new Error('invalid');
                    return copyData(entry.value, ancestors, depth + 1);
                })
            );
        }
        const result: Record<string, unknown> = Object.create(null) as Record<
            string,
            unknown
        >;
        for (const [key, entry] of Object.entries(descriptors)) {
            if (!('value' in entry) || !entry.enumerable)
                throw new Error('invalid');
            result[key] = copyData(entry.value, ancestors, depth + 1);
        }
        return Object.freeze(result);
    } finally {
        ancestors.delete(value);
    }
}

function unsupported(facet: ReadonlyPrintFacet): boolean {
    return (
        facet.kind === 'unsupported' ||
        (facet.kind === 'sequence' && facet.items.some(unsupported)) ||
        (facet.kind === 'linkedRecords' &&
            facet.records.some(
                (record) =>
                    record.status === 'present' &&
                    record.fields.some((field) => unsupported(field.facet))
            ))
    );
}

/**
 * Detach one already-admitted display snapshot, refusing the entire document on
 * unsupported or malformed data. This does not grant visibility or sanitize a
 * raw record: the host must mask passwords and filter private/hidden data first.
 * Failure reasons intentionally contain no source values or exception messages.
 */
export function captureReadonlyPrintDocument(
    input: ReadonlyPrintDocument
): ReadonlyPrintCapture {
    try {
        const value = copyData(input, new Set(), 0);
        if (
            !shape(
                value,
                {
                    language: oneOf(
                        'en',
                        'es',
                        'fr',
                        'vi',
                        'nl',
                        'de',
                        'ja',
                        'ko',
                        'pt',
                        'cs',
                        'he',
                        'it',
                        'ka',
                        'zh-Hans',
                        'ca'
                    ),
                    fields: list(fieldRule),
                },
                { title: text }
            )
        )
            return { status: 'refused', reason: 'invalid-document' };
        const document = value as unknown as ReadonlyPrintDocument;
        const refused = document.fields.find((field) =>
            unsupported(field.facet)
        );
        return refused
            ? {
                  status: 'refused',
                  reason: 'unsupported-facet',
                  fieldKey: refused.key,
              }
            : { status: 'accepted', document };
    } catch {
        return { status: 'refused', reason: 'invalid-document' };
    }
}
