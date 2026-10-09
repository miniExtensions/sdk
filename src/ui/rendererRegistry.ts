import type {
    AirtableAttachment,
    AirtableBarcodeValue,
    AirtableCollaborator,
    AirtableValue,
    RuntimeFieldSchema,
} from '../runtime/types.js';
import type { FormValidationMessage } from '../forms/helpers.js';
import type { FieldActionResult } from '../forms/bindings.js';
import type { ScalarFieldState, DurationFieldState } from './scalarModels.js';
import type { DateFieldState } from './dateModel.js';
import type { SelectionState } from './types.js';
import type { FormAttachmentSnapshot } from '../forms/attachmentController.js';
import type { FormSelectChoiceSnapshot } from '../forms/selectChoiceController.js';
import type { ButtonFieldRenderProps } from './buttonModel.js';
import type {
    FormLinkedRecordsFacet,
    FormLinkedRecordsSnapshot,
} from '../forms/linkedRecords.js';

export type FieldKind = RuntimeFieldSchema['fieldType'];
export type FieldSchema<K extends FieldKind> = Extract<
    RuntimeFieldSchema,
    { fieldType: K }
>;
export type FieldMetadata<K extends FieldKind> =
    FieldSchema<K>['airtableField'];
export type FieldConfig<K extends FieldKind> = FieldSchema<K>['miniExtConfig'];
export type FieldValueMap = {
    singleLineText: string;
    number: number;
    email: string;
    url: string;
    multilineText: string;
    percent: number;
    currency: number;
    singleSelect: string;
    multipleSelects: readonly string[];
    singleCollaborator: AirtableCollaborator;
    multipleCollaborators: readonly AirtableCollaborator[];
    multipleRecordLinks: readonly string[];
    date: string;
    dateTime: string;
    phoneNumber: string;
    multipleAttachments: readonly AirtableAttachment[];
    checkbox: boolean;
    formula: AirtableValue;
    createdTime: string;
    rollup: AirtableValue;
    count: number;
    multipleLookupValues: Extract<
        AirtableValue,
        readonly unknown[] | { error: string }
    >;
    autoNumber: number;
    barcode: AirtableBarcodeValue;
    rating: number;
    richText: string;
    duration: number;
    lastModifiedTime: string;
    createdBy: AirtableCollaborator;
    lastModifiedBy: AirtableCollaborator;
    button: Extract<AirtableValue, { url: string; label: string }>;
    externalSyncSource: string;
    aiText: Extract<
        AirtableValue,
        { state: string; value: string; isStale: boolean }
    >;
};
export type FieldReadValue<K extends FieldKind> =
    | FieldValueMap[K]
    | null
    | undefined;
export type FieldWriteValue<K extends FieldKind> = FieldValueMap[K] | null;
export type ScalarRendererActions = {
    state: ScalarFieldState;
    setInput(input: string): boolean;
    setChecked(checked: boolean): boolean;
    /** Present only for the duration specialization. */
    setFocused?(focused: boolean): boolean;
};
export type DurationRendererActions = ScalarRendererActions & {
    state: DurationFieldState;
    /** Presentation only; does not round or write native seconds. */
    setFocused(focused: boolean): boolean;
};
export type DateRendererActions = {
    state: DateFieldState;
    setInput(input: string): boolean;
    clear(): boolean;
};
export type SelectionRendererActions = {
    state: SelectionState;
    choose(values: readonly string[]): void;
    toggle(value: string): void;
    clear(): void;
    setSearchInput(input: string): void;
    reload(): Promise<void>;
    loadMore(): Promise<void>;
    cancel(): void;
};
export type AttachmentRendererActions = {
    state: FormAttachmentSnapshot;
    select(files: readonly File[]): boolean;
    clear(): void;
    remove(nativeIndex: number): boolean;
    upload(): Promise<boolean>;
    cancel(): void;
};
export type ChoiceRendererActions = {
    state: FormSelectChoiceSnapshot;
    create(name: string): Promise<boolean>;
    cancel(): void;
};
type ComputedKind =
    | 'formula'
    | 'rollup'
    | 'multipleLookupValues'
    | 'count'
    | 'autoNumber'
    | 'createdTime'
    | 'lastModifiedTime'
    | 'createdBy'
    | 'lastModifiedBy'
    | 'externalSyncSource'
    | 'aiText';
type SelectionKind =
    | 'singleSelect'
    | 'multipleSelects'
    | 'multipleRecordLinks'
    | 'singleCollaborator'
    | 'multipleCollaborators';
export type FieldRendererCapability<K extends FieldKind> =
    | { type: 'readonly' }
    | (K extends 'button'
          ? { type: 'button'; button: ButtonFieldRenderProps }
          : K extends ComputedKind
            ? never
            : {
                  type: 'editable';
                  setValue(value: FieldWriteValue<K>): FieldActionResult;
              } & (K extends 'duration'
                  ? { scalar?: DurationRendererActions }
                  : K extends
                          | 'number'
                          | 'percent'
                          | 'currency'
                          | 'rating'
                          | 'checkbox'
                    ? { scalar?: ScalarRendererActions }
                    : {}) &
                  (K extends 'date' | 'dateTime'
                      ? { date?: DateRendererActions }
                      : {}) &
                  (K extends SelectionKind
                      ? { selection?: SelectionRendererActions }
                      : {}) &
                  (K extends 'multipleAttachments'
                      ? { attachment?: AttachmentRendererActions }
                      : {}) &
                  (K extends 'singleSelect' | 'multipleSelects'
                      ? { choice?: ChoiceRendererActions }
                      : {}));
export type FieldPresentation =
    | {
          type: 'physical';
          config: RuntimeFieldSchema['airtableField']['config'];
      }
    | {
          type: 'computed-result';
          config: RuntimeFieldSchema['airtableField']['config'] | null;
      };
/** Borrowed Form presentation; the discriminator leaves other contexts explicit. */
export type LinkedRecordsRendererProps = {
    source: 'form';
    state: FormLinkedRecordsSnapshot;
    readSelected: FormLinkedRecordsFacet['readSelected'];
};
export type FieldRendererProps<K extends FieldKind> = {
    physicalKind: K;
    presentation: FieldPresentation;
    fieldId: string;
    title: string;
    field: FieldMetadata<K>;
    displayConfig: FieldConfig<K> | null;
    writeConfig?: FieldConfig<K> | null;
    value: FieldReadValue<K>;
    context: 'form' | 'portal-cell' | 'portal-detail' | 'linked-detail';
    computed: boolean;
    dirty: boolean;
    pending: boolean;
    validation: readonly FormValidationMessage[];
    error: string | null;
    capability: FieldRendererCapability<K>;
} & (K extends 'multipleRecordLinks'
    ? { linkedRecords?: LinkedRecordsRendererProps }
    : { linkedRecords?: never });
export type FieldRendererPropsUnion = {
    [K in FieldKind]: FieldRendererProps<K>;
}[FieldKind];
export type FieldRendererSlots<R> = {
    [K in FieldKind as `render${Capitalize<K>}Field`]?: (
        props: FieldRendererProps<K>
    ) => R;
};
export type FieldRendererHostSnapshot =
    | { status: 'ready'; fields: readonly FieldRendererPropsUnion[] }
    | {
          status: 'hidden' | 'blocked' | 'unavailable' | 'retired';
          reason: string;
      };
export type FieldRendererHost = {
    getSnapshot(): FieldRendererHostSnapshot;
    subscribe(
        listener: (snapshot: FieldRendererHostSnapshot) => void
    ): () => void;
    dispose(): void;
};

export const FIELD_RENDERER_SLOTS = {
    singleLineText: 'renderSingleLineTextField',
    number: 'renderNumberField',
    email: 'renderEmailField',
    url: 'renderUrlField',
    multilineText: 'renderMultilineTextField',
    percent: 'renderPercentField',
    currency: 'renderCurrencyField',
    singleSelect: 'renderSingleSelectField',
    multipleSelects: 'renderMultipleSelectsField',
    singleCollaborator: 'renderSingleCollaboratorField',
    multipleCollaborators: 'renderMultipleCollaboratorsField',
    multipleRecordLinks: 'renderMultipleRecordLinksField',
    date: 'renderDateField',
    dateTime: 'renderDateTimeField',
    phoneNumber: 'renderPhoneNumberField',
    multipleAttachments: 'renderMultipleAttachmentsField',
    checkbox: 'renderCheckboxField',
    formula: 'renderFormulaField',
    createdTime: 'renderCreatedTimeField',
    rollup: 'renderRollupField',
    count: 'renderCountField',
    multipleLookupValues: 'renderMultipleLookupValuesField',
    autoNumber: 'renderAutoNumberField',
    barcode: 'renderBarcodeField',
    rating: 'renderRatingField',
    richText: 'renderRichTextField',
    duration: 'renderDurationField',
    lastModifiedTime: 'renderLastModifiedTimeField',
    createdBy: 'renderCreatedByField',
    lastModifiedBy: 'renderLastModifiedByField',
    button: 'renderButtonField',
    externalSyncSource: 'renderExternalSyncSourceField',
    aiText: 'renderAiTextField',
} as const satisfies { [K in FieldKind]: `render${Capitalize<K>}Field` };

export function dispatchField<R>(
    slots: FieldRendererSlots<R>,
    props: FieldRendererPropsUnion,
    fallback: (props: FieldRendererPropsUnion, reason: 'missing-renderer') => R
): R {
    // The exhaustive map keeps the lookup coupled to the physical discriminator.
    const renderer = slots[FIELD_RENDERER_SLOTS[props.physicalKind]] as
        | ((props: FieldRendererPropsUnion) => R)
        | undefined;
    return renderer ? renderer(props) : fallback(props, 'missing-renderer');
}

export type RendererPropsInput = Omit<
    FieldRendererPropsUnion,
    | 'presentation'
    | 'physicalKind'
    | 'field'
    | 'displayConfig'
    | 'writeConfig'
    | 'value'
    | 'capability'
    | 'linkedRecords'
> & {
    physicalKind: string;
    field: unknown;
    displayConfig: unknown;
    writeConfig?: unknown;
    value: unknown;
    linkedRecords?: LinkedRecordsRendererProps;
    capability:
        | { type: 'readonly' }
        | {
              type: 'editable';
              setValue(value: AirtableValue): FieldActionResult;
              scalar?: ScalarRendererActions;
              date?: DateRendererActions;
              selection?: SelectionRendererActions;
              attachment?: AttachmentRendererActions;
              choice?: ChoiceRendererActions;
          }
        | { type: 'button'; button: ButtonFieldRenderProps };
};
const object = (value: unknown): value is Record<string, unknown> =>
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
const dense = (value: unknown, check: (item: unknown) => boolean): boolean =>
    Array.isArray(value) &&
    Array.from(value).every(
        (item, index) => Object.hasOwn(value, index) && check(item)
    );
const text = (value: unknown) => typeof value === 'string';
const optional = (
    value: Record<string, unknown>,
    key: string,
    check: (value: unknown) => boolean
) => value[key] === undefined || check(value[key]);
const collaborator = (value: unknown) =>
    object(value) &&
    text(value.id) &&
    text(value.email) &&
    text(value.name) &&
    optional(value, 'profilePicUrl', text);
const finite = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value);
const thumbnail = (value: unknown) =>
    object(value) &&
    text(value.url) &&
    finite(value.width) &&
    finite(value.height);
const attachment = (value: unknown) =>
    object(value) &&
    text(value.url) &&
    optional(value, 'id', (id) => id === null || text(id)) &&
    ['filename', 'type'].every((key) => optional(value, key, text)) &&
    optional(value, 'size', finite) &&
    optional(
        value,
        'thumbnails',
        (value) =>
            object(value) &&
            ['small', 'large', 'full'].every((key) =>
                optional(value, key, thumbnail)
            )
    );
const barcode = (value: unknown) =>
    object(value) &&
    Object.keys(value).every((key) => key === 'text' || key === 'type') &&
    optional(value, 'text', text) &&
    optional(value, 'type', text);
const ai = (value: unknown) =>
    object(value) &&
    ['error', 'empty', 'loading', 'generated'].includes(String(value.state)) &&
    text(value.value) &&
    typeof value.isStale === 'boolean' &&
    optional(value, 'errorType', text);
const nativeMember = (value: unknown): boolean =>
    value === null ||
    text(value) ||
    finite(value) ||
    typeof value === 'boolean' ||
    collaborator(value) ||
    attachment(value) ||
    ai(value) ||
    barcode(value) ||
    (object(value) &&
        ((text(value.url) && text(value.label)) ||
            text(value.error) ||
            ['NaN', 'Infinity', '-Infinity'].includes(
                String(value.specialValue)
            )));
const computedKinds = new Set<FieldKind>([
    'formula',
    'rollup',
    'multipleLookupValues',
    'count',
    'autoNumber',
    'createdTime',
    'lastModifiedTime',
    'createdBy',
    'lastModifiedBy',
    'externalSyncSource',
    'aiText',
]);
/** Validate the native wire shape without interpreting result metadata or coercing empty values. */
export function isFieldReadValue<K extends FieldKind>(
    kind: K,
    value: unknown
): value is FieldReadValue<K> {
    if (value === null || value === undefined) return true;
    switch (kind) {
        case 'number':
        case 'percent':
        case 'currency':
        case 'rating':
        case 'duration':
        case 'count':
        case 'autoNumber':
            return finite(value);
        case 'checkbox':
            return typeof value === 'boolean';
        case 'multipleSelects':
        case 'multipleRecordLinks':
            return dense(value, text);
        case 'singleCollaborator':
        case 'createdBy':
        case 'lastModifiedBy':
            return collaborator(value);
        case 'multipleCollaborators':
            return dense(value, collaborator);
        case 'multipleAttachments':
            return dense(value, attachment);
        case 'barcode':
            return barcode(value);
        case 'button':
            return object(value) && text(value.url) && text(value.label);
        case 'aiText':
            return ai(value);
        case 'formula':
        case 'rollup':
            return nativeMember(value) || dense(value, nativeMember);
        case 'multipleLookupValues':
            return (
                (object(value) && text(value.error)) ||
                dense(value, nativeMember)
            );
        default:
            return text(value);
    }
}
const json = (value: unknown, seen = new Set<object>()): boolean => {
    if (
        value === undefined ||
        value === null ||
        text(value) ||
        finite(value) ||
        typeof value === 'boolean'
    )
        return true;
    if (typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    const valid = Array.isArray(value)
        ? dense(value, (item) => json(item, seen))
        : object(value) &&
          Object.values(value).every((item) => json(item, seen));
    seen.delete(value);
    return valid;
};
const optionless = new Set([
    'singleLineText',
    'email',
    'url',
    'multilineText',
    'richText',
    'phoneNumber',
    'barcode',
    'button',
    'autoNumber',
]);
const validConfig = (
    value: unknown
): value is RuntimeFieldSchema['airtableField']['config'] => {
    if (
        !object(value) ||
        typeof value.type !== 'string' ||
        !Object.hasOwn(FIELD_RENDERER_SLOTS, value.type) ||
        !json(value)
    )
        return false;
    if (optionless.has(value.type)) return value.options === null;
    if (!object(value.options)) return false;
    const options = value.options;
    if (['number', 'percent', 'currency'].includes(value.type))
        return (
            finite(options.precision) &&
            (value.type !== 'currency' || text(options.symbol))
        );
    if (
        ['singleSelect', 'multipleSelects', 'externalSyncSource'].includes(
            value.type
        )
    )
        return dense(
            options.choices,
            (choice) => object(choice) && text(choice.id) && text(choice.name)
        );
    if (
        [
            'singleCollaborator',
            'multipleCollaborators',
            'createdBy',
            'lastModifiedBy',
        ].includes(value.type)
    )
        return dense(
            options.choices,
            (choice) =>
                object(choice) &&
                text(choice.id) &&
                text(choice.email) &&
                (choice.name === null || text(choice.name))
        );
    switch (value.type) {
        case 'checkbox':
            return text(options.icon) && text(options.color);
        case 'rating':
            return (
                text(options.icon) && text(options.color) && finite(options.max)
            );
        case 'multipleAttachments':
            return typeof options.isReversed === 'boolean';
        case 'multipleRecordLinks':
            return (
                text(options.linkedTableId) &&
                typeof options.isReversed === 'boolean' &&
                typeof options.prefersSingleRecordLink === 'boolean' &&
                optional(options, 'inverseLinkFieldId', text) &&
                optional(options, 'viewIdForRecordSelection', text)
            );
        case 'duration':
            return [
                'h:mm',
                'h:mm:ss',
                'h:mm:ss.S',
                'h:mm:ss.SS',
                'h:mm:ss.SSS',
            ].includes(String(options.durationFormat));
        case 'date':
        case 'dateTime':
            return (
                object(options.dateFormat) &&
                text(options.dateFormat.name) &&
                text(options.dateFormat.format) &&
                (value.type === 'date' ||
                    (object(options.timeFormat) &&
                        text(options.timeFormat.name) &&
                        text(options.timeFormat.format) &&
                        text(options.timeZone)))
            );
        case 'count':
            return (
                typeof options.isValid === 'boolean' &&
                (options.recordLinkFieldId === null ||
                    text(options.recordLinkFieldId))
            );
        case 'createdTime':
            return validConfig(options.result);
        case 'lastModifiedTime':
            return (
                typeof options.isValid === 'boolean' &&
                validConfig(options.result)
            );
        case 'formula':
        case 'rollup':
            return (
                options.result === null ||
                (options.isValid === true && validConfig(options.result))
            );
        case 'multipleLookupValues':
            return (
                typeof options.isValid === 'boolean' &&
                text(options.recordLinkFieldId) &&
                text(options.fieldIdInLinkedTable) &&
                (options.isValid
                    ? validConfig(options.result)
                    : options.result === null)
            );
        case 'aiText':
            return true;
        default:
            return false;
    }
};
/** Data is detached; action facades retain the host's guarded closures. */
export function createRendererProps(
    input: RendererPropsInput
): FieldRendererPropsUnion | null {
    if (!Object.hasOwn(FIELD_RENDERER_SLOTS, input.physicalKind)) return null;
    const kind = input.physicalKind as FieldKind;
    if (
        !object(input.field) ||
        !object(input.field.config) ||
        input.field.config.type !== kind ||
        !text(input.field.id) ||
        !text(input.field.name) ||
        !(input.field.description === null || text(input.field.description)) ||
        typeof input.field.isComputed !== 'boolean' ||
        typeof input.field.isPrimaryField !== 'boolean' ||
        !validConfig(input.field.config) ||
        !json(input.field)
    )
        return null;
    if (
        ![input.displayConfig, input.writeConfig].every(
            (config) =>
                config === undefined ||
                config === null ||
                (object(config) && json(config))
        ) ||
        !isFieldReadValue(kind, input.value) ||
        !json(input.value)
    )
        return null;
    const computed =
        computedKinds.has(kind) || input.field.isComputed || input.computed;
    if (input.capability.type === 'editable' && (computed || kind === 'button'))
        return null;
    if (input.capability.type === 'button' && kind !== 'button') return null;
    if (
        input.linkedRecords !== undefined &&
        (!object(input.linkedRecords) ||
            kind !== 'multipleRecordLinks' ||
            input.context !== 'form' ||
            input.linkedRecords.source !== 'form' ||
            typeof input.linkedRecords.readSelected !== 'function' ||
            !object(input.linkedRecords.state) ||
            !json(input.linkedRecords.state))
    )
        return null;
    if (input.capability.type === 'editable') {
        const cap = input.capability;
        if (
            cap.scalar &&
            (kind === 'duration'
                ? cap.scalar.state.kind !== 'duration' ||
                  typeof cap.scalar.setFocused !== 'function'
                : cap.scalar.setFocused !== undefined)
        )
            return null;
        if (
            typeof cap.setValue !== 'function' ||
            (cap.scalar &&
                ![
                    'number',
                    'percent',
                    'currency',
                    'rating',
                    'duration',
                    'checkbox',
                ].includes(kind)) ||
            (cap.date && !['date', 'dateTime'].includes(kind)) ||
            (cap.selection &&
                ![
                    'singleSelect',
                    'multipleSelects',
                    'singleCollaborator',
                    'multipleCollaborators',
                    'multipleRecordLinks',
                ].includes(kind)) ||
            (cap.attachment && kind !== 'multipleAttachments') ||
            (cap.choice && !['singleSelect', 'multipleSelects'].includes(kind))
        )
            return null;
    }
    try {
        const { capability, linkedRecords, ...data } = input;
        const config = input.field.config;
        const resultKind =
            kind === 'formula' ||
            kind === 'rollup' ||
            kind === 'multipleLookupValues';
        const options: unknown = config.options;
        const result =
            object(options) &&
            options.isValid === true &&
            validConfig(options.result)
                ? options.result
                : null;
        const presentation = resultKind
            ? { type: 'computed-result', config: result }
            : { type: 'physical', config };
        return {
            ...structuredClone({ ...data, computed, presentation }),
            ...(linkedRecords
                ? {
                      linkedRecords: {
                          source: linkedRecords.source,
                          state: structuredClone(linkedRecords.state),
                          readSelected: linkedRecords.readSelected,
                      },
                  }
                : {}),
            capability,
        } as FieldRendererPropsUnion;
    } catch {
        return null;
    }
}
