import type { FormValidationMessage } from '../forms/helpers.js';
import type {
    LinkedFinderCardLeaf,
    LinkedFinderCardProjection,
} from './LinkedFinderCard.js';
import type {
    ControlledSelectCommonProps,
    ControlledSingleSelectFieldProps,
    ControlledMultipleSelectsFieldProps,
} from './ControlledSelectField.js';
import type {
    CompleteSingleCollaboratorFieldProps,
    CompleteMultipleCollaboratorsFieldProps,
} from './CompleteCollaboratorField.js';
import type { ControlledButtonFieldProps } from './ButtonField.js';
import type { ControlledFormulaFieldProps } from './FormulaField.js';
import type { ControlledRollupFieldProps } from './RollupField.js';
import type { ControlledRatingFieldProps } from './ControlledRatingField.js';
import type { CompleteRichTextEditorProps } from './CompleteRichTextEditor.js';
import type { RuntimeLanguage } from '../runtime/types.js';
import type { ReadOnlyURLGalleryProps } from './ReadOnlyURLGallery.js';

/** Actual host capture; equality of values/record IDs never renews this owner. */
export type LookupPresentationOwner = {
    readonly token: unknown;
    isCurrent(): boolean;
    /** Optional immediate notification; queries/actions still recheck isCurrent. */
    subscribe?(listener: () => void): () => void;
};

type SelectPresentation = Pick<
    ControlledSelectCommonProps,
    | 'choices'
    | 'availableChoices'
    | 'presentation'
    | 'limitToOneSelection'
    | 'maxSelections'
    | 'labels'
    | 'isInGrid'
    | 'inputId'
    | 'formId'
    | 'ariaLabel'
    | 'describedBy'
    | 'invalid'
    | 'className'
>;
type CollaboratorPresentation = Pick<
    CompleteSingleCollaboratorFieldProps,
    | 'choices'
    | 'labels'
    | 'avatarPolicy'
    | 'inputId'
    | 'formId'
    | 'ariaLabel'
    | 'labelledBy'
    | 'describedBy'
    | 'invalid'
    | 'title'
    | 'showLabel'
    | 'className'
>;

/** Card facts grant no binding, model, setter, picker or metadata-write port. */
export type LookupReadonlyCardLeaf =
    | Exclude<LinkedFinderCardLeaf, { kind: 'sequence' | 'button' }>
    | { readonly kind: 'button'; readonly accepted: ControlledButtonFieldProps }
    | {
          readonly kind: 'sequence';
          readonly leaves: readonly LookupReadonlyCardLeaf[];
          readonly layout?: 'wrap';
      };

type PresentCard = Extract<LinkedFinderCardProjection, { status: 'present' }>;
export type LookupReadonlyCardProjection =
    | Exclude<LinkedFinderCardProjection, { status: 'present' }>
    | (Omit<PresentCard, 'fields'> & {
          readonly fields: readonly (Omit<
              PresentCard['fields'][number],
              'leaf'
          > & {
              readonly leaf: LookupReadonlyCardLeaf;
          })[];
      });

type LinkedRow = {
    /** Captured occurrence identity, not a deduplicated record ID. */
    readonly key: string;
    readonly open?: {
        readonly label: string;
        /** Existing child owner receives the actual SDK trigger for focus return. */
        run(trigger: HTMLElement): unknown;
    };
};
export type LookupReadonlyLinkedCardRow = LinkedRow & {
    readonly card: LookupReadonlyCardProjection;
};
export type LookupReadonlyLinkedGridRow = LinkedRow & {
    readonly cells: readonly {
        readonly key: string;
        readonly result: LookupResultPresentation;
    }[];
};
export type LookupReadonlyLinkedRow =
    | LookupReadonlyLinkedCardRow
    | LookupReadonlyLinkedGridRow;
type LinkedCollection = {
    readonly phase: 'loading' | 'ready' | 'error';
    readonly error?: string | null;
    readonly labels: {
        readonly empty: string;
        readonly loading: string;
        readonly unavailable: string;
        readonly loadMore?: string;
    };
    /** Already captured host read intent; absent means no read capability. */
    readonly loadMore?: { readonly busy: boolean; run(): unknown };
};
/** Layout policy is explicit; a native grid never needs a fabricated list card. */
export type LookupReadonlyLinkedCollection = LinkedCollection &
    (
        | {
              readonly layout: 'list' | 'gallery';
              readonly rows: readonly LookupReadonlyLinkedCardRow[];
              readonly columnsPerRow?: number;
          }
        | {
              readonly layout: 'table';
              readonly columns: readonly {
                  readonly key: string;
                  readonly title: string;
              }[];
              readonly rows: readonly LookupReadonlyLinkedGridRow[];
              readonly rowHeight?: number;
          }
    );

export type LookupResultPresentation =
    | Exclude<LookupReadonlyCardLeaf, { kind: 'sequence' }>
    | {
          readonly kind: 'singleSelect';
          readonly display: SelectPresentation &
              Pick<ControlledSingleSelectFieldProps, 'value'>;
      }
    | {
          readonly kind: 'multipleSelects';
          readonly display: SelectPresentation &
              Pick<ControlledMultipleSelectsFieldProps, 'value'>;
      }
    | {
          readonly kind: 'singleCollaborator';
          readonly display: CollaboratorPresentation &
              Pick<CompleteSingleCollaboratorFieldProps, 'value'>;
      }
    | {
          readonly kind: 'multipleCollaborators';
          readonly display: CollaboratorPresentation &
              Pick<CompleteMultipleCollaboratorsFieldProps, 'value'>;
      }
    | {
          readonly kind: 'formula';
          readonly display: ControlledFormulaFieldProps;
      }
    | { readonly kind: 'rollup'; readonly display: ControlledRollupFieldProps }
    | {
          readonly kind: 'ratingField';
          readonly display: Omit<
              ControlledRatingFieldProps,
              | 'onChange'
              | 'owner'
              | 'disabled'
              | 'enableInlineEdit'
              | 'binding'
              | 'render'
              | 'iconInput'
          >;
      }
    | {
          readonly kind: 'richText';
          readonly display: Omit<
              CompleteRichTextEditorProps,
              'onValueChange' | 'readOnly' | 'emptyContent'
          > & {
              readonly emptyLabel: string;
              readonly language: RuntimeLanguage;
          };
      }
    | { readonly kind: 'urlGallery'; readonly display: ReadOnlyURLGalleryProps }
    | {
          readonly kind: 'linkedCollection';
          readonly display: LookupReadonlyLinkedCollection;
      }
    | {
          readonly kind: 'sequence';
          readonly leaves: readonly {
              readonly key: string;
              readonly result: LookupResultPresentation;
          }[];
          readonly layout?: 'wrap';
      };

export type LookupPresentationState =
    | { readonly status: 'masked' }
    | { readonly status: 'empty' }
    | { readonly status: 'unavailable' }
    | { readonly status: 'invalid-result' }
    | { readonly status: 'native-error'; readonly message: string }
    | { readonly status: 'ready'; readonly result: LookupResultPresentation };

export type ControlledLookupFieldProps = {
    mode: 'controlled';
    binding?: never;
    render?: never;
    /** Immutable admitted state, separate from the canonical native array. */
    state: LookupPresentationState;
    owner: LookupPresentationOwner;
    /** Actual field/record/source capture; never a serialization of raw values. */
    identity: unknown;
    language?: RuntimeLanguage;
    title?: string;
    showTitle?: boolean;
    inputId?: string;
    labelledBy?: string;
    describedBy?: string;
    pending?: boolean;
    error?: string | null;
    validation?: readonly FormValidationMessage[];
    className?: string;
    labels?: {
        empty?: string;
        unavailable?: string;
        invalidResult?: string;
    };
};
