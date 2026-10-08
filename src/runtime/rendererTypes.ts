import type {
    AirtableField,
    AirtableValue,
    FormLoadedPayload,
    PortalLoadedPayload,
} from './types.js';

/** Exact native metadata aliases; no renderer or permission behavior. */
export type AirtableNumericField = Extract<
    AirtableField,
    { config: { type: 'number' | 'percent' } }
>;
export type AirtableCurrencyField = Extract<
    AirtableField,
    { config: { type: 'currency' } }
>;
export type AirtableCollaboratorField = Exclude<
    Extract<
        AirtableField,
        {
            config: {
                type:
                    | 'singleCollaborator'
                    | 'multipleCollaborators'
                    | 'createdBy';
            };
        }
    >,
    Extract<AirtableField, { config: { type: 'createdBy' } }>
>;
export type AirtableURLField = Extract<
    AirtableField,
    { config: { type: 'url' } }
>;
export type AirtableCheckboxField = Extract<
    AirtableField,
    { config: { type: 'checkbox' } }
>;
export type AirtableRatingField = Extract<
    AirtableField,
    { config: { type: 'rating' } }
>;
export type AirtableEmailField = Extract<
    AirtableField,
    { config: { type: 'email' } }
>;
export type AirtableDateField = Extract<
    AirtableField,
    { config: { type: 'date' } }
>;
export type AirtableRichTextField = Extract<
    AirtableField,
    { config: { type: 'richText' } }
>;
export type AirtableSingleLineTextField = Extract<
    AirtableField,
    { config: { type: 'singleLineText' } }
>;
export type AirtableSelectField = Extract<
    AirtableField,
    { config: { type: 'singleSelect' | 'multipleSelects' } }
>;
export type AirtableLastModifiedTimeField = Extract<
    AirtableField,
    { config: { type: 'lastModifiedTime' } }
>;
export type AirtableExternalSyncSourceField = Extract<
    AirtableField,
    { config: { type: 'externalSyncSource' } }
>;
export type AirtableLastModifiedByField = Extract<
    AirtableField,
    { config: { type: 'lastModifiedBy' } }
>;
export type AirtableCreatedByField = Extract<
    AirtableField,
    { config: { type: 'createdBy' } }
>;
export type AirtableDurationField = Extract<
    AirtableField,
    { config: { type: 'duration' } }
>;
export type AirtableLookupField = Extract<
    AirtableField,
    { config: { type: 'multipleLookupValues' } }
>;
export type AirtableCountField = Extract<
    AirtableField,
    { config: { type: 'count' } }
>;
export type AirtableRollupField = Extract<
    AirtableField,
    { config: { type: 'rollup' } }
>;
export type AirtableCreatedTimeField = Extract<
    AirtableField,
    { config: { type: 'createdTime' } }
>;
export type AirtableFormulaField = Extract<
    AirtableField,
    { config: { type: 'formula' } }
>;
export type AirtableLinkedRecordField = Extract<
    AirtableField,
    { config: { type: 'multipleRecordLinks' } }
>;
export type AirtableDateTimeField = Extract<
    AirtableField,
    { config: { type: 'dateTime' } }
>;
export type AirtableAttachmentsField = Extract<
    AirtableField,
    { config: { type: 'multipleAttachments' } }
>;
export type AirtableMultilineTextField = Extract<
    AirtableField,
    { config: { type: 'multilineText' } }
>;
export type AirtablePhoneNumberField = Extract<
    AirtableField,
    { config: { type: 'phoneNumber' } }
>;
export type AirtableBarcodeField = Extract<
    AirtableField,
    { config: { type: 'barcode' } }
>;
export type AirtableButtonField = Extract<
    AirtableField,
    { config: { type: 'button' } }
>;
export type AirtableAutoNumberField = Extract<
    AirtableField,
    { config: { type: 'autoNumber' } }
>;
export type AirtableAiField = Extract<
    AirtableField,
    { config: { type: 'aiText' } }
>;

/** Native values exclude arrays; this is separate from formula interpreter values. */
export type NonArrayAirtableValue = Exclude<AirtableValue, readonly unknown[]>;
export type AirtableButtonValue = Extract<
    NonArrayAirtableValue,
    { url: string; label: string }
>;

/** Exact Form-only envelopes, preserving optional config, unlike RuntimeFieldSchema. */
export type FormFieldsMiniExtFieldWithConfig = NonNullable<
    FormLoadedPayload['publicFields']['state']['formFields']
>[number];
export type FormFieldsMiniExtConfigSingleLineTextField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'singleLineText' }
>;
export type FormFieldsMiniExtConfigEmailField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'email' }
>;
export type FormFieldsMiniExtConfigUrlField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'url' }
>;
export type FormFieldsMiniExtConfigMultilineTextField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'multilineText' }
>;
export type FormFieldsMiniExtConfigNumberField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'number' }
>;
export type FormFieldsMiniExtConfigPercentField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'percent' }
>;
export type FormFieldsMiniExtConfigCurrencyField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'currency' }
>;
export type FormFieldsMiniExtConfigSingleSelectField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'singleSelect' }
>;
export type FormFieldsMiniExtConfigMultipleSelectsField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'multipleSelects' }
>;
export type FormFieldsMiniExtConfigSingleCollaboratorField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'singleCollaborator' }
>;
export type FormFieldsMiniExtConfigMultipleCollaboratorsField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'multipleCollaborators' }
>;
export type FormFieldsMiniExtConfigMultipleRecordLinksField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'multipleRecordLinks' }
>;
export type FormFieldsMiniExtConfigDateField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'date' }
>;
export type FormFieldsMiniExtConfigDateTimeField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'dateTime' }
>;
export type FormFieldsMiniExtConfigPhoneNumberField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'phoneNumber' }
>;
export type FormFieldsMiniExtConfigMultipleAttachmentsField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'multipleAttachments' }
>;
export type FormFieldsMiniExtConfigCheckboxField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'checkbox' }
>;
export type FormFieldsMiniExtConfigFormulaField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'formula' }
>;
export type FormFieldsMiniExtConfigCreatedTimeField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'createdTime' }
>;
export type FormFieldsMiniExtConfigRollupField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'rollup' }
>;
export type FormFieldsMiniExtConfigCountField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'count' }
>;
export type FormFieldsMiniExtConfigMultipleLookupValuesField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'multipleLookupValues' }
>;
export type FormFieldsMiniExtConfigAutoNumberField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'autoNumber' }
>;
export type FormFieldsMiniExtConfigBarcodeField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'barcode' }
>;
export type FormFieldsMiniExtConfigRatingField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'rating' }
>;
export type FormFieldsMiniExtConfigRichTextField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'richText' }
>;
export type FormFieldsMiniExtConfigDurationField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'duration' }
>;
export type FormFieldsMiniExtConfigLastModifiedTimeField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'lastModifiedTime' }
>;
export type FormFieldsMiniExtConfigCreatedByField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'createdBy' }
>;
export type FormFieldsMiniExtConfigLastModifiedByField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'lastModifiedBy' }
>;
export type FormFieldsMiniExtConfigButtonField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'button' }
>;
export type FormFieldsMiniExtConfigExternalSyncSourceField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'externalSyncSource' }
>;
export type FormFieldsMiniExtConfigAiTextField = Extract<
    FormFieldsMiniExtFieldWithConfig['config'],
    { type: 'aiText' }
>;
export type ButtonMiniExtConfig = FormFieldsMiniExtConfigButtonField['config'];
type PortalLinkedField = Extract<
    NonNullable<
        PortalLoadedPayload['publicFields']['state']['portalFields']
    >[number]['config'],
    { type: 'multipleRecordLinks' }
>;
export type LinkedRecordsMiniExtConfig = Exclude<
    | FormFieldsMiniExtConfigMultipleRecordLinksField['config']
    | PortalLinkedField['config'],
    undefined
>;
