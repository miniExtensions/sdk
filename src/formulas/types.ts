/** Field kinds understood by the formula evaluator. */
export enum AirtableFieldType {
    /**
     * A single line of text.
     *
     * **Cell format**
     * ```js
     * string
     * ```
     *
     * **Field options**
     *
     * n/a
     */
    SINGLE_LINE_TEXT = 'singleLineText',
    /**
     * A valid email address (e.g. andrew@example.com).
     *
     * **Cell format**
     * ```js
     * string
     * ```
     *
     * **Field options**
     *
     * n/a
     */
    EMAIL = 'email',
    /**
     * A valid URL (e.g. airtable.com or https://airtable.com/universe).
     *
     * **Cell format**
     * ```js
     * string
     * ```
     *
     * **Field options**
     *
     * n/a
     */
    URL = 'url',
    /**
     * A long text field that can span multiple lines. May contain "mention tokens",
     * e.g. `<airtable:mention id="menE1i9oBaGX3DseR">@Alex</airtable:mention>`
     *
     * **Cell format**
     * ```js
     * string
     * ```
     *
     * **Field options**
     *
     * n/a
     */
    MULTILINE_TEXT = 'multilineText',
    /**
     * A number.
     *
     * The `precision` option indicates the number of digits shown to the right of
     * the decimal point for this field.
     *
     * **Cell format**
     * ```js
     * number
     * ```
     *
     * **Field options**
     * ```js
     * {
     *     precision: number, // from 0 to 8 inclusive
     * }
     * ```
     */
    NUMBER = 'number',
    /**
     * A percentage.
     *
     * When reading from and writing to a "Percent" field, the cell value is a decimal.
     * For example, 0 is 0%, 0.5 is 50%, and 1 is 100%.
     *
     * **Cell format**
     * ```js
     * number
     * ```
     *
     * **Field options**
     * ```js
     * {
     *     precision: number, // from 0 to 8 inclusive
     * }
     * ```
     */
    PERCENT = 'percent',
    /**
     * An amount of a currency.
     *
     * **Cell format**
     * ```js
     * number
     * ```
     *
     * **Field options**
     * ```js
     * {
     *     precision: number, // from 0 to 7 inclusive
     *     symbol: string,
     * }
     * ```
     */
    CURRENCY = 'currency',
    /**
     * Single select allows you to select a single choice from predefined choices in a dropdown.
     *
     * **Cell read format**
     * ```js
     * {
     *     id: string,
     *     name: string,
     *     color?: Color
     * }
     * ```
     * The currently selected choice.
     *
     * **Cell write format**
     * ```js
     * { id: string } | { name: string }
     * ```
     *
     * **Field options read format**
     * ```js
     * {
     *     choices: Array<{
     *         id: string,
     *         name: string,
     *         color?: {@link Color}, // Color is not provided when field coloring is disabled.
     *     }>,
     * }
     * ```
     *
     * All colors except base colors from {@link Color} can be used as choice colors (e.g.
     * "blueBright", "blueDark1", "blueLight1", "blueLight2" are supported, "blue" is not)
     *
     * Bases on a free or plus plan are limited to colors ending in "Light2".
     *
     * **Field options write format**
     * ```js
     * {
     *     choices: Array<
     *         // New choice format
     *         {name: string, color?: {@link Color}} |
     *         // Pre-existing choices use read format specified above
     *     >,
     * }
     * ```
     * The default behavior of calling `updateOptionsAsync` on a `SINGLE_SELECT` field allows
     * choices to be added or updated, but not deleted. Therefore, you should pass all pre-existing
     * choices in `choices` (similar to updating a `MULTIPLE_SELECTS` field type cell value). You can
     * do this by spreading the current choices:
     * ```js
     * const selectField = table.getFieldByName('My select field');
     * await selectField.updateOptionsAsync({
     *     choices: [
     *         ...selectField.options.choices,
     *         {name: 'My new choice'},
     *     ],
     * });
     *
     * ```
     *
     * If you want to allow choices to be deleted, you can pass an object with
     * `enableSelectFieldChoiceDeletion: true` as the second argument. By passing this argument,
     * any existing choices which are not passed again via `choices` will be deleted, and any
     * cells which referenced a now-deleted choice will be cleared.
     * ```js
     * const selectField = table.getFieldByName('My select field');
     * await selectField.updateOptionsAsync(
     *     {
     *         choices: selectField.options.choices.filter((choice) => choice.name !== 'Choice to delete'),
     *     },
     *     {enableSelectFieldChoiceDeletion: true},
     * );
     *
     * ```
     */
    SINGLE_SELECT = 'singleSelect',
    /**
     * Multiple select allows you to select one or more predefined choices from a dropdown
     *
     * Similar to MULTIPLE_ATTACHMENTS and MULTIPLE_COLLABORATORS, this array-type field
     * will override the current cell value when being updated. Be sure to spread the current
     * cell value if you want to keep the currently selected choices.
     *
     * **Cell read format**
     * ```js
     * Array<{
     *     id: string,
     *     name: string,
     *     color?: Color,
     * }>
     * ```
     * The currently selected choices.
     *
     * **Cell write format**
     * ```js
     * Array<{id: string} | {name: string}>
     * ```
     *
     * **Field options read format**
     * ```js
     * {
     *     choices: Array<{
     *         id: string,
     *         name: string,
     *         color?: Color,
     *     }>,
     * }
     * ```
     *
     * **Field options write format**
     * ```js
     * {
     *     choices: Array<
     *         // New choice format
     *         {name: string, color?: Color} |
     *         // Pre-existing choices use read format specified above
     *     >,
     * }
     * ```
     * The default behavior of calling `updateOptionsAsync` on a `MULTIPLE_SELECTS` field allows
     * choices to be added or updated, but not deleted. Therefore, you should pass all pre-existing
     * choices in `choices` (similar to updating a `SINGLE_SELECT` field type cell value). You can
     * do this by spreading the current choices:
     * ```js
     * const multipleSelectField = table.getFieldByName('My multiple select field');
     * await multipleSelectField.updateOptionsAsync({
     *     choices: [
     *         ...multipleSelectField.options.choices,
     *         {name: 'My new choice'},
     *     ],
     * });
     *
     * ```
     *
     * If you want to allow choices to be deleted, you can pass an object with
     * `enableSelectFieldChoiceDeletion: true` as the second argument. By passing this argument,
     * any existing choices which are not passed again via `choices` will be deleted, and any
     * cells which referenced a now-deleted choice will be cleared.
     * ```js
     * const multipleSelectField = table.getFieldByName('My multiple select field');
     * await multipleSelectField.updateOptionsAsync(
     *     {
     *         choices: multipleSelectField.options.choices.filter((choice) => choice.name !== 'Choice to delete'),
     *     },
     *     {enableSelectFieldChoiceDeletion: true},
     * );
     *
     * ```
     */
    MULTIPLE_SELECTS = 'multipleSelects',
    /**
     * A collaborator field lets you add collaborators to your records. Collaborators can optionally
     * be notified when they're added. A single collaborator field has been configured to only
     * reference one collaborator.
     *
     * **Cell read format**
     * ```js
     * {
     *     id: string,
     *     email: string,
     *     name?: string,
     *     profilePicUrl?: string,
     * }
     * ```
     * The currently selected collaborator.
     *
     * **Cell write format**
     * ```js
     * { id: string }
     * ```
     *
     * **Field options read format**
     * ```js
     * {
     *     choices: Array<{
     *         id: string,
     *         email: string,
     *         name?: string,
     *         profilePicUrl?: string,
     *     }>,
     * }
     * ```
     *
     * **Field options write format**
     *
     * N/A
     *
     * Options are not required when creating a `SINGLE_COLLABORATOR` field, and updating options is
     * not supported.
     *
     */
    SINGLE_COLLABORATOR = 'singleCollaborator',
    /**
     * A collaborator field lets you add collaborators to your records. Collaborators can optionally
     * be notified when they're added. A multiple collaborator field has been configured to
     * reference any number of collaborators.
     *
     * Similar to MULTIPLE_ATTACHMENTS and MULTIPLE_COLLABORATORS, this array-type field
     * will override the current cell value when being updated. Be sure to spread the current
     * cell value if you want to keep the currently selected collaborators.
     *
     * **Cell read format**
     * ```js
     * Array<{
     *     id: string,
     *     email: string,
     *     name?: string,
     *     profilePicUrl?: string,
     * }>
     * ```
     * The currently selected collaborators.
     *
     * **Cell write format**
     * ```js
     * Array<{ id: string }>
     * ```
     *
     * **Field options read format**
     * ```js
     * {
     *     choices: Array<{
     *         id: string,
     *         email: string,
     *         name?: string,
     *         profilePicUrl?: string,
     *     }>,
     * }
     * ```
     *
     * **Field options write format**
     *
     * N/A
     *
     * Options are not required when creating a `MULTIPLE_COLLABORATORS` field, and updating options
     * is not supported.
     */
    MULTIPLE_COLLABORATORS = 'multipleCollaborators',
    /**
     * Link to another record.
     *
     * When updating an existing linked record cell value, the specified array will
     * overwrite the current cell value. If you want to add a new linked record without
     * deleting the current linked records, you can spread the current cell value like so:
     * ```js
     * const newForeignRecordIdToLink = 'recXXXXXXXXXXXXXX';
     * myTable.updateRecordAsync(myRecord, {
     *     'myLinkedRecordField': [
     *         ...myRecord.getCellValue('myLinkedRecordField'),
     *         { id: newForeignRecordIdToLink }
     *     ]
     * });
     * ```
     *
     * Similarly, you can clear the current cell value by passing an empty array, or
     * remove specific linked records by passing a filtered array of the current cell
     * value.
     *
     * **Cell read format**
     * ```js
     * Array<{
     *     id: RecordId,
     *     name: string,
     * }>
     * ```
     * The currently linked record IDs and their primary cell values from the linked table.
     *
     * **Cell write format**
     * ```js
     * Array<{ id: RecordId }>
     * ```
     *
     * **Field options read format**
     * ```js
     * {
     *     // The ID of the table this field links to
     *     linkedTableId: TableId,
     *     // The ID of the field in the linked table that links back
     *     // to this one
     *     inverseLinkFieldId?: FieldId,
     *     // The ID of the view in the linked table to use when showing
     *     // a list of records to select from
     *     viewIdForRecordSelection?: ViewId,
     *     // Whether linked records are rendered in the reverse order from the cell value in the
     *     // Airtable UI (i.e. most recent first)
     *     // You generally do not need to rely on this option.
     *     isReversed: boolean,
     *     // Whether this field prefers to only have a single linked record. While this preference
     *     // is enforced in the Airtable UI, it is possible for a field that prefers single linked
     *     // records to have multiple record links (for example, via copy-and-paste or programmatic
     *     // updates).
     *     prefersSingleRecordLink: boolean,
     * }
     * ```
     *
     * **Field options write format**
     * ```js
     * {
     *     // The ID of the table this field links to
     *     linkedTableId: TableId,
     *     // The ID of the view in the linked table to use when showing
     *     // a list of records to select from
     *     viewIdForRecordSelection?: ViewId,
     *     // Note: prefersSingleRecordLink cannot be specified via programmatic field creation
     *     // and will be false for fields created within an app
     * }
     * ```
     *
     * Creating `MULTIPLE_RECORD_LINKS` fields is supported but updating options for existing
     * `MULTIPLE_RECORD_LINKS` fields is not supported.
     */
    MULTIPLE_RECORD_LINKS = 'multipleRecordLinks',
    /**
     * A date.
     *
     * When reading from and writing to a date field, the cell value will always be an
     * [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) formatted date. (Field
     * options specify how it's formatted in the main Airtable UI - `format` can be used with
     * [`moment.js`](https://momentjs.com/) to match that.)
     *
     * The date format string follows the moment.js structure documented
     * [here](https://momentjs.com/docs/#/parsing/string-format/)
     *
     * **Cell read format**
     * ```js
     * string
     * ```
     *
     * **Cell write format**
     * ```js
     * Date | string
     * ```
     *
     * **Field options read format**
     * ```js
     * {
     *     dateFormat:
     *          | {name: 'local', format: 'l'}
     *          | {name: 'friendly', format: 'LL'}
     *          | {name: 'us', format: 'M/D/YYYY'}
     *          | {name: 'european', format: 'D/M/YYYY'}
     *          | {name: 'iso', format: 'YYYY-MM-DD'}
     * }
     * ```
     *
     * **Field options write format**
     * ```js
     * {
     *     dateFormat:
     *          // Format is optional, but must match name if provided.
     *          | {name: 'local', format?: 'l'}
     *          | {name: 'friendly', format?: 'LL'}
     *          | {name: 'us', format?: 'M/D/YYYY'}
     *          | {name: 'european', format?: 'D/M/YYYY'}
     *          | {name: 'iso', format?: 'YYYY-MM-DD'}
     * }
     * ```
     */
    DATE = 'date',
    /**
     * A date field configured to also include a time.
     *
     * When reading from and writing to a date field, the cell value will always be an
     * [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) formatted date. (Field
     * options specify how it's formatted in the main Airtable UI - `format` can be used with
     * [`moment.js`](https://momentjs.com/) to match that.)
     *
     * The date and time format strings follow the moment.js structure documented
     * [here](https://momentjs.com/docs/#/parsing/string-format/)
     *
     * **Cell read format**
     * ```js
     * string
     * ```
     *
     * **Cell write format**
     * ```js
     * Date | string
     * ```
     *
     * **Field options read format**
     * ```js
     * {
     *     dateFormat:
     *          | {name: 'local', format: 'l'}
     *          | {name: 'friendly', format: 'LL'}
     *          | {name: 'us', format: 'M/D/YYYY'}
     *          | {name: 'european', format: 'D/M/YYYY'}
     *          | {name: 'iso', format: 'YYYY-MM-DD'},
     *     timeFormat:
     *          | {name: '12hour', format: 'h:mma'}
     *          | {name: '24hour', format: 'HH:mm'},
     *     timeZone: 'utc' | 'client',
     * }
     * ```
     *
     * **Field options write format**
     * ```js
     * {
     *     dateFormat:
     *          // Format is optional, but must match name if provided.
     *          | {name: 'local', format?: 'l'}
     *          | {name: 'friendly', format?: 'LL'}
     *          | {name: 'us', format?: 'M/D/YYYY'}
     *          | {name: 'european', format?: 'D/M/YYYY'}
     *          | {name: 'iso', format?: 'YYYY-MM-DD'},
     *     timeFormat:
     *          // Format is optional, but must match name if provided.
     *          | {name: '12hour', format?: 'h:mma'}
     *          | {name: '24hour', format?: 'HH:mm'},
     *     timeZone: 'utc' | 'client',
     * }
     * ```
     */
    DATE_TIME = 'dateTime',
    /**
     * A telephone number (e.g. (415) 555-9876).
     *
     * **Cell format**
     * ```js
     * string
     * ```
     *
     * **Field options**
     *
     * None
     */
    PHONE_NUMBER = 'phoneNumber',
    /**
     * Attachments allow you to add images, documents, or other files which can then be viewed or downloaded.
     *
     * When updating an existing attachment cell value, the specified array will
     * overwrite the current cell value. If you want to add a new attachment without
     * deleting the current attachments, you can spread the current cell value like so:
     * ```js
     * const newAttachmentUrl = 'example.com/cute-cats.jpeg';
     * myTable.updateRecordAsync(myRecord, {
     *     'myAttachmentField': [
     *         ...myRecord.getCellValue('myAttachmentField'),
     *         { url: newAttachmentUrl }
     *     ]
     * });
     * ```
     *
     * Similarly, you can clear the current cell value by passing an empty array, or
     * remove specific attachments by passing a filtered array of the current cell
     * value.
     *
     * Note: when you pass an existing attachment, you must pass the full attachment
     * object. New attachments only require the `url` property. You can optionally
     * pass the \`filename\` property to give it a readable name.
     *
     * Additionally, the Airtable generated attachment URLs do not currently expire,
     * but this will change in the future. If you want to persist the attachments, we
     * recommend downloading them instead of saving the URL. Before this change is
     * rolled out, we will post a more detailed deprecation timeline.
     *
     * **Cell read format**
     * ```js
     * Array<{
     *     // unique attachment id
     *     id: string,
     *     // url, e.g. "https://dl.airtable.com/foo.jpg"
     *     url: string,
     *     // filename, e.g. "foo.jpg"
     *     filename: string,
     *     // file size, in bytes
     *     size?: number,
     *     // content type, e.g. "image/jpeg"
     *     type?: string,
     *     // thumbnails if available
     *     thumbnails?: {
     *         small?: {
     *             url: string,
     *             width: number,
     *             height: number,
     *         },
     *         large?: {
     *             url: string,
     *             width: number,
     *             height: number,
     *         },
     *         full?: {
     *             url: string,
     *             width: number,
     *             height: number,
     *         },
     *     },
     * }>
     * ```
     *
     * **Cell write format**
     * ```js
     * Array<
     *     // New attachment format
     *     { url: string, filename?: string} ||
     *     // Pre-existing attachments use cell read format specified above
     *     { ... }
     * >
     * ```
     * For pre-existing attachments, pass the object read from the cell value.
     * You cannot change any properties of pre-existing attachments.
     *
     * **Field options read format**
     * ```js
     * {
     *     // Whether attachments are rendered in the reverse order from the cell value in the
     *     // Airtable UI (i.e. most recent first)
     *     // You generally do not need to rely on this option.
     *     isReversed: boolean,
     * }
     * ```
     *
     * **Field options write format**
     *
     * N/A
     *
     * Options are not required when creating a `MULTIPLE_ATTACHMENTS` field, and updating options
     * is not supported.
     */
    MULTIPLE_ATTACHMENTS = 'multipleAttachments',
    /**
     * A checkbox.
     *
     * This field is "true" when checked and "null" when unchecked.
     *
     * **Cell read format**
     * ```js
     * true | null
     * ```
     *
     * You can write to the cell with "false", but the read value will be still be "null"
     * (unchecked).
     *
     * **Cell write format**
     * ```js
     * boolean | null
     * ```
     *
     * **Field options**
     *
     * ```js
     * {
     *     // an icon name
     *     icon: 'check' | 'star' | 'heart' | 'thumbsUp' | 'flag',
     *     // the color of the check box
     *     color: 'yellowBright' | 'orangeBright' | 'redBright' | 'pinkBright' | 'purpleBright' | 'blueBright' | 'cyanBright' | 'tealBright' | 'greenBright' | 'grayBright' ,
     * }
     * ```
     *
     * Bases on a free or plus plan are limited to using the 'check' icon and 'greenBright' color.
     */
    CHECKBOX = 'checkbox',
    /**
     * Compute a value in each record based on other fields in the same record.
     *
     * **Cell read format**
     *
     * Check `options.result` to know the resulting field type.
     * ```js
     * any
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *     // false if the formula contains an error
     *     isValid: boolean,
     *     // the other fields in the record that are used in the formula
     *     referencedFieldIds: Array<FieldId>,
     *     // the resulting field type and options returned by the formula
     *     result: {
     *         // the field type of the formula result
     *         type: string,
     *         // that types options
     *         options?: any,
     *     },
     * }
     * ```
     *
     * **Field options write format**
     *
     * Creating or updating `FORMULA` fields is not supported.
     */
    FORMULA = 'formula',
    /**
     * The time the record was created in UTC.
     *
     * When reading from a "Created time" field, the cell value will always be an
     * [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) formatted date time.
     * (Field options specify how it's displayed in the UI.)
     *
     * **Cell read format**
     * ```js
     * string
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *     result: {
     *         type: 'date' | 'dateTime',
     *         // See DATE and DATE_TIME for detailed field options
     *         options: DateOrDateTimeFieldOptions,
     *     },
     * }
     * ```
     *
     * **Field options write format**
     *
     * Creating or updating `CREATED_TIME` fields is not supported.
     */
    CREATED_TIME = 'createdTime',
    /**
     * A rollup allows you to summarize data from records that are linked to this table.
     *
     * **Cell read format**
     * Check `options.result` to know the resulting field type.
     * ```js
     * any
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *     // false if the formula contains an error
     *     isValid: boolean,
     *     // the linked record field in this table that this field is
     *     // summarizing.
     *     recordLinkFieldId: FieldId,
     *     // the field id in the linked table that this field is summarizing.
     *     fieldIdInLinkedTable: FieldId,
     *     // the other fields in the record that are used in the formula
     *     referencedFieldIds: Array<FieldId>,
     *     // the resulting field type and options returned by the formula
     *     result: {
     *         // the field type of the formula result
     *         type: string,
     *         // that types options
     *         options?: any,
     *     },
     * }
     * ```
     *
     * **Field options write format**
     *
     * Creating or updating `ROLLUP` fields is not supported.
     */
    ROLLUP = 'rollup',
    /**
     * Count the number of linked records.
     *
     * **Cell read format**
     * ```js
     * number
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *    // is the field currently valid (e.g. false if the linked record
     *    // field has been changed to a different field type)
     *    isValid: boolean,
     *    // the linked record field in this table that we're counting
     *    recordLinkFieldId: FieldId,
     * }
     * ```
     *
     * **Field options write format**
     *
     * Creating or updating `COUNT` fields is not supported.
     */
    COUNT = 'count',
    /**
     * Lookup a field on linked records.
     *
     * **Cell read format**
     * ```js
     * Array<{
     *     // the ID of the linked record this lookup value comes from
     *     linkedRecordId: RecordId,
     *     // the cell value of the lookup. the actual type depends on the field being looked up
     *     value: unknown,
     * }>
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *     // whether the lookup field is correctly configured
     *     isValid: boolean,
     *     // the linked record field in this table that this field is
     *     // looking up
     *     recordLinkFieldId: FieldId,
     *     // the field in the foreign table that will be looked up on
     *     // each linked record
     *     fieldIdInLinkedTable: FieldId | null,
     *     // the local field configuration for the foreign field being
     *     // looked up
     *     result?: undefined | {type: AirtableFieldType, options: unknown}
     * }
     * ```
     *
     * **Field options write format**
     *
     * Creating or updating `MULTIPLE_LOOKUP_VALUES` fields is not supported.
     */
    MULTIPLE_LOOKUP_VALUES = 'multipleLookupValues',
    /**
     * Automatically incremented unique counter for each record.
     *
     * **Cell read format**
     * ```js
     * number
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     *
     * n/a
     *
     * **Field options write format**
     *
     * Creating or updating `AUTO_NUMBER` fields is not supported.
     */
    AUTO_NUMBER = 'autoNumber',
    /**
     * Use the Airtable iOS or Android app to scan barcodes.
     *
     * **Cell read format**
     * ```js
     * {
     *     // the text value of the barcode
     *     text: string,
     *     // the type of barcode
     *     type?: string,
     * }
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options**
     *
     * n/a
     */
    BARCODE = 'barcode',
    /**
     * A rating (e.g. stars out of 5)
     *
     * **Cell format**
     * ```js
     * number
     * ```
     *
     * **Field options**
     * ```js
     * {
     *     // the icon name used to display the rating
     *     icon: 'star' | 'heart' | 'thumbsUp' | 'flag' | 'dot',
     *     // the maximum value for the rating, from 1 to 10 inclusive
     *     max: number,
     *     // the color of selected icons
     *     color: 'yellowBright' | 'orangeBright' | 'redBright' | 'pinkBright' | 'purpleBright' | 'blueBright' | 'cyanBright' | 'tealBright' | 'greenBright' | 'grayBright' ,
     * }
     * ```
     *
     * Bases on a free or plus plan are limited to using the 'star' icon and 'yellowBright' color.
     */
    RATING = 'rating',
    /**
     * A long text field with rich formatting enabled.
     *
     * Returned string is formatted with [markdown syntax for Airtable rich text formatting](https://support.airtable.com/hc/en-us/articles/360044741993-Markdown-syntax-for-Airtable-rich-text-formatting).
     * Use this formatting when updating cell values.
     *
     * **Cell format**
     * ```js
     * string
     * ```
     * **Field options**
     *
     * n/a
     *
     */
    RICH_TEXT = 'richText',
    /**
     * A duration of time in seconds.
     *
     * The `durationFormat` string follows the moment.js structure documented
     * [here](https://momentjs.com/docs/#/parsing/string-format/).
     *
     * **Cell format**
     * ```js
     * number
     * ```
     *
     * **Field options**
     * ```js
     * {
     *     durationFormat: 'h:mm' | 'h:mm:ss' | 'h:mm:ss.S' | 'h:mm:ss.SS' | 'h:mm:ss.SSS',
     * }
     * ```
     */
    DURATION = 'duration',
    /**
     * Shows the date and time that a record was most recently modified in any editable field or
     * just in specific editable fields.
     *
     * When reading from a "Last modified time" field, the cell value will always be an
     * [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) formatted date time.
     * (Field options specify how it's displayed in the UI.)
     *
     * **Cell read format**
     * ```js
     * string
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *     // false if the formula contains an error
     *     isValid: boolean,
     *     // the fields to check the last modified time of
     *     referencedFieldIds: Array<FieldId>,
     *     // the cell value result type
     *     result: {
     *         type: 'date' | 'dateTime',
     *         // See DATE and DATE_TIME for detailed field options
     *         options: DateOrDateTimeFieldOptions,
     *     },
     * }
     * ```
     * **Field options write format**
     *
     * Creating or updating `LAST_MODIFIED_TIME` fields is not supported.
     */
    LAST_MODIFIED_TIME = 'lastModifiedTime',
    /**
     * The collaborator who created a record.
     *
     * The cell value format is the same as the `SINGLE_COLLABORATOR` field, without the ability to
     * write to the cell value.
     *
     * **Cell read format**
     * ```js
     * {
     *     id: string,
     *     email: string,
     *     name?: string,
     *     profilePicUrl?: string,
     * }
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *     choices: Array<{
     *         id: string,
     *         email: string,
     *         name?: string,
     *         profilePicUrl?: string,
     *     }>,
     * }
     * ```
     *
     * **Field options write format**
     *
     * Creating or updating `CREATED_BY` fields is not supported.
     *
     */
    CREATED_BY = 'createdBy',
    /**
     * Shows the last collaborator who most recently modified any editable field or just in specific
     * editable fields.
     *
     * The cell value format is the same as the `SINGLE_COLLABORATOR` field, without the ability to
     * write to the cell value.
     *
     * **Cell read format**
     * ```js
     * {
     *     id: string,
     *     email: string,
     *     name?: string,
     *     profilePicUrl?: string,
     * }
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *     referencedFieldIds: Array<FieldId>,
     *     choices: Array<{
     *         id: string,
     *         email: string,
     *         name?: string,
     *         profilePicUrl?: string,
     *     }>,
     * }
     * ```
     *
     * **Field options write format**
     *
     * Creating or updating `LAST_MODIFIED_BY` fields is not supported.
     *
     */
    LAST_MODIFIED_BY = 'lastModifiedBy',
    /**
     * A button that can be clicked from the Airtable UI to open a URL or open a block.
     *
     * You cannot currently programmatically interact with a button field from a block, but you can
     * configure your block to perform a certain action when it's opened from a button field: see
     * {@link useRecordActionData} for details.
     *
     * **Cell read format**
     * ```js
     * {
     *     // The label of the button
     *     label: string,
     *     // URL the button opens, or URL of the block that the button opens.
     *     // Null when the URL formula has become invalid.
     *     url: string | null,
     * }
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     *
     * n/a
     *
     * **Field options write format**
     *
     * Creating or updating `BUTTON` fields is not supported.
     *
     */
    BUTTON = 'button',
    /**
     * Shows the name of the source that a record is synced from. This field is only available on
     * synced tables.
     *
     * **Cell read format**
     * ```js
     * {
     *     id: string,
     *     name: string,
     *     color?: Color
     * }
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *     choices: Array<{
     *         id: string,
     *         name: string,
     *         color?: {@link Color}, // Color is not provided when field coloring is disabled.
     *     }>,
     * }
     * ```
     * Every choice represents a sync source, and choices are added or removed automatically as
     * sync sources are added or removed. Choice names and colors are user-configurable.
     *
     * **Field options write format**
     *
     * Creating or updating `EXTERNAL_SYNC_SOURCE` fields is not supported.
     *
     */
    EXTERNAL_SYNC_SOURCE = 'externalSyncSource',

    /**
     *
     * Field that contains text generated by AI.
     *
     * **Cell read format**
     *
     * ```js
     * {
     *     state: 'empty' | 'loading' | 'generated' | 'error',
     *     value: string,
     *     isStale: boolean,
     *     // Only populated if state is 'error'
     *     errorType?: string,
     * }
     * ```
     *
     * **Cell write format**
     *
     * n/a
     *
     * **Field options read format**
     * ```js
     * {
     *     prompt?: Array<string | {field: {fieldId: string}}>,
     *     referencedFieldIds?: Array<string>,
     * }
     * ```
     * Prompt is an array of strings and field references. All referenced field ids
     *
     * **Field options write format**
     *
     * Creating or updating `AI_TEXT` fields is not supported.
     *
     */
    AI_TEXT = 'aiText',

    MANUAL_SORT = 'manualSort',
}

export const AIRTABLE_FORMULA_ERROR_VALUE = '#ERROR!';

// Accept the JSON discriminators returned by loaded Forms and Portals while
// retaining the enum constants for existing formula consumers.
export type NumericFieldConfig = {
    type: `${AirtableFieldType.NUMBER | AirtableFieldType.PERCENT}`;
    options: { precision: number };
};

export type CurrencyFieldConfig = {
    type: `${AirtableFieldType.CURRENCY}`;
    options: { precision: number; symbol: string };
};

export type SelectFieldChoice = {
    id: string;
    name: string;
    color?: string;
    newOption?: boolean;
};

export type SelectFieldConfig = {
    type: `${
        | AirtableFieldType.SINGLE_SELECT
        | AirtableFieldType.MULTIPLE_SELECTS
        | AirtableFieldType.EXTERNAL_SYNC_SOURCE}`;
    options?: { choices: SelectFieldChoice[] } | null;
};

export type CollaboratorFieldConfig = {
    type: `${
        | AirtableFieldType.SINGLE_COLLABORATOR
        | AirtableFieldType.MULTIPLE_COLLABORATORS
        | AirtableFieldType.CREATED_BY
        | AirtableFieldType.LAST_MODIFIED_BY}`;
    options?: { choices: AirtableCollaborator[] } | null;
};

export type DurationFormat =
    | 'h:mm'
    | 'h:mm:ss'
    | 'h:mm:ss.S'
    | 'h:mm:ss.SS'
    | 'h:mm:ss.SSS';

export type DurationFieldConfig = {
    type: `${AirtableFieldType.DURATION}`;
    options: { durationFormat: DurationFormat };
};

export type DateFieldConfig = {
    type: `${AirtableFieldType.DATE}`;
    options: {
        dateFormat: { format: string };
    };
};

export type DateTimeFieldConfig = {
    type: `${AirtableFieldType.DATE_TIME}`;
    options: {
        dateFormat: { format: string };
        timeFormat: { format: string };
        timeZone: string;
    };
};

export type LinkedRecordFieldConfig = {
    type: `${AirtableFieldType.MULTIPLE_RECORD_LINKS}`;
    options: { linkedTableId: string };
};

type ComputedFieldOptions =
    | { isValid: true; result: AirtableFieldConfig }
    | { isValid?: false; result?: AirtableFieldConfig | null };

export type ComputedFieldConfig = {
    type: `${
        | AirtableFieldType.FORMULA
        | AirtableFieldType.ROLLUP
        | AirtableFieldType.MULTIPLE_LOOKUP_VALUES}`;
    options: ComputedFieldOptions;
};

export type CreatedTimeFieldConfig = {
    type: `${AirtableFieldType.CREATED_TIME}`;
    options: {
        result: DateFieldConfig | DateTimeFieldConfig;
    };
};

export type LastModifiedTimeFieldConfig = {
    type: `${AirtableFieldType.LAST_MODIFIED_TIME}`;
    options: {
        isValid: boolean;
        result: DateFieldConfig | DateTimeFieldConfig;
    };
};

export type CountFieldConfig = {
    type: `${AirtableFieldType.COUNT}`;
    options: { isValid: boolean };
};

type UnformattedFieldType = `${Exclude<
    AirtableFieldType,
    | AirtableFieldType.NUMBER
    | AirtableFieldType.PERCENT
    | AirtableFieldType.CURRENCY
    | AirtableFieldType.SINGLE_SELECT
    | AirtableFieldType.MULTIPLE_SELECTS
    | AirtableFieldType.EXTERNAL_SYNC_SOURCE
    | AirtableFieldType.SINGLE_COLLABORATOR
    | AirtableFieldType.MULTIPLE_COLLABORATORS
    | AirtableFieldType.CREATED_BY
    | AirtableFieldType.LAST_MODIFIED_BY
    | AirtableFieldType.DURATION
    | AirtableFieldType.DATE
    | AirtableFieldType.DATE_TIME
    | AirtableFieldType.MULTIPLE_RECORD_LINKS
    | AirtableFieldType.FORMULA
    | AirtableFieldType.ROLLUP
    | AirtableFieldType.MULTIPLE_LOOKUP_VALUES
    | AirtableFieldType.CREATED_TIME
    | AirtableFieldType.LAST_MODIFIED_TIME
    | AirtableFieldType.COUNT
>}`;

export type UnformattedFieldConfig = {
    type: UnformattedFieldType;
    options?: object | null;
};

/** Runtime choice metadata is optional for minimal formula-only field inputs. */
export type AirtableFieldConfig =
    | NumericFieldConfig
    | CurrencyFieldConfig
    | SelectFieldConfig
    | CollaboratorFieldConfig
    | DurationFieldConfig
    | DateFieldConfig
    | DateTimeFieldConfig
    | LinkedRecordFieldConfig
    | ComputedFieldConfig
    | CreatedTimeFieldConfig
    | LastModifiedTimeFieldConfig
    | CountFieldConfig
    | UnformattedFieldConfig;

export type AirtableField = {
    id: string;
    name: string;
    config: AirtableFieldConfig;
    isPrimaryField?: boolean;
    isComputed?: boolean;
    description?: string | null;
};

export type AirtableCollaborator = {
    id: string;
    email: string;
    name: string;
    profilePicUrl?: string;
};

export type AirtableAttachment = {
    id?: string | null;
    url: string;
    filename?: string;
    size?: number;
    type?: string;
    thumbnails?: {
        small?: AirtableThumbnail;
        large?: AirtableThumbnail;
        full?: AirtableThumbnail;
    };
};

export type AirtableThumbnail = {
    url: string;
    width: number;
    height: number;
};

export type AirtableBarcodeValue = { text?: string; type?: string };
export type AirtableButtonValue = { url: string | null; label: string };
export type AirtableComputedErrorValue = { error: string };
export type AirtableSpecialValue = {
    specialValue: 'NaN' | 'Infinity' | '-Infinity';
};
export type AirtableAiTextValue = {
    state: 'empty' | 'loading' | 'generated' | 'error';
    value: string;
    isStale?: boolean;
    errorType?: string;
};

export type NonArrayAirtableValue =
    | string
    | number
    | boolean
    | AirtableBarcodeValue
    | AirtableButtonValue
    | AirtableComputedErrorValue
    | AirtableSpecialValue
    | AirtableCollaborator
    | AirtableAiTextValue
    | null
    | undefined;

export type AirtableValue =
    | NonArrayAirtableValue
    | ReadonlyArray<NonArrayAirtableValue | AirtableAttachment>;

export type AirtableRecord = {
    id: string;
    /** Values may be keyed by field ID or field name; absent cells are blank. */
    fields: { [fieldIdOrName: string]: AirtableValue };
};

export type LinkedTableState = {
    airtableFields: AirtableField[];
    recordIdsToAirtableRecords: { [recordId: string]: AirtableRecord };
};

export type LinkedTableLoadingState =
    | { type: 'notLoaded' }
    | { type: 'loading' }
    | { type: 'failed'; errorMessage: string }
    | {
          type: 'loaded';
          data: { state: LinkedTableState };
          isPaginating?: boolean;
          isReloading?: boolean;
          errorMessage?: string;
      };

export type TableIdsToLinkedTableLoadingStates = {
    [tableId: string]: LinkedTableLoadingState;
};
