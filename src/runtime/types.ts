import type {
    AirtableAttachment,
    AirtableBarcodeValue,
    AirtableCollaborator,
    AirtableField,
    AirtableFieldType,
    AirtableRecord,
    AirtableValue,
    SelectFieldChoice,
} from '../formulas/types.js';

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | readonly JsonValue[]
    | JsonObject;

/** Configuration is returned intact without imposing a generated schema. */
export type JsonObject = { readonly [key: string]: JsonValue | undefined };

export type RuntimeSession = Record<string, string>;
export type RuntimeQuery = Record<
    string,
    string | readonly string[] | undefined
>;
export type RuntimeLanguage =
    | 'en'
    | 'es'
    | 'fr'
    | 'vi'
    | 'nl'
    | 'de'
    | 'ja'
    | 'ko'
    | 'pt'
    | 'cs'
    | 'he'
    | 'it'
    | 'ka'
    | 'zh-Hans'
    | 'ca';

export type RuntimeLinkedRecordFieldConfig = {
    type: AirtableFieldType.MULTIPLE_RECORD_LINKS;
    options: {
        linkedTableId: string;
        inverseLinkFieldId?: string;
        viewIdForRecordSelection?: string;
        isReversed: boolean;
        prefersSingleRecordLink: boolean;
    };
};

/** Runtime schemas include the link metadata needed for child Form context. */
export type RuntimeAirtableField = Omit<AirtableField, 'config'> & {
    config:
        | Exclude<
              AirtableField['config'],
              { type: AirtableFieldType.MULTIPLE_RECORD_LINKS }
          >
        | RuntimeLinkedRecordFieldConfig;
};

export type RuntimeFieldSchema = {
    fieldType: AirtableFieldType;
    airtableField: RuntimeAirtableField;
    miniExtConfig?: JsonObject;
};
export type RuntimeFieldSchemas = Record<string, RuntimeFieldSchema>;
export type RuntimeTableState = {
    airtableFields: RuntimeAirtableField[];
    recordIdsToAirtableRecords: Record<string, AirtableRecord>;
};
export type RuntimeTableStates = Record<string, RuntimeTableState>;
export type RuntimeFormErrors = Record<string, string | undefined>;

export type RuntimeFormRecord =
    | { type: 'create'; data: Record<string, AirtableValue> }
    | {
          type: 'edit';
          recordId: string;
          tableId: string;
          data: Record<string, AirtableValue>;
      };

export type DeviceFingerprint = { version: 1; visitorId: string | null };
export type LinkedRecordPrefill = {
    toLinkToParent: {
        reversedFieldIdToPrefill: string;
        parentFormRecordId: string;
    } | null;
    prefillQueryForChildExtension: string | null;
};

export type LoadExtensionContext =
    | {
          type: 'direct-url';
          localStorageRecord?: Record<string, AirtableValue>;
      }
    | {
          type: 'modal';
          linkedTableIdOfLinkedRecordField: string;
          prefillDataForLinkedRecordsForm: LinkedRecordPrefill | null;
      };

type LoadExtensionBaseInput = {
    query?: RuntimeQuery;
    context: LoadExtensionContext;
    clientTimeZone?: string;
    deviceFingerprint?: DeviceFingerprint;
};

export type LoadExtensionInput = LoadExtensionBaseInput &
    (
        | { shareId: string; recordId: string | null }
        | {
              childExtensionAccessData: {
                  parentExtensionAccessToken: string;
                  fieldIdUsedToAccessExtension: string | null;
              };
              childExtensionInfo: {
                  childExtensionId: string;
                  accessType:
                      | { type: 'create' }
                      | {
                            type: 'edit';
                            childExtensionRecordId: string;
                            childExtensionFieldId: string | null;
                        };
              };
          }
    );

type RuntimeDisplayMetadata = {
    baseId: string;
    loggedInUserCanEditExtension: boolean;
    showMiniExtensionsBranding: boolean;
    onFreePlan: boolean;
    trialExpiresAtUnixEpoch: number | null;
};

export type PasswordRequiredPayload = RuntimeDisplayMetadata;

export type LoginPagePayload = RuntimeDisplayMetadata & {
    publicFields: JsonObject;
    hasParentExtension: boolean;
    shareId: string;
    loginFieldNames: string[];
    loginFieldIds: string[];
    fieldNamesToSchemas: RuntimeFieldSchemas;
    fieldIdsToSchemas: RuntimeFieldSchemas;
    tableId: string;
    prefillFieldNamesToValues: Record<string, string>;
    prefillLoginRecordId: string | null;
};

export type FormLoadedPayload = RuntimeDisplayMetadata & {
    extensionType: 'form';
    extensionAccessToken: string;
    extensionName: string | null;
    hasParentExtension: boolean;
    formRecord: RuntimeFormRecord;
    persistedAddOnlyAttachmentValuesByFieldId?: Record<
        string,
        AirtableAttachment[]
    >;
    formErrors: RuntimeFormErrors;
    publicFields: JsonObject;
    fieldIdsInForm: string[];
    fieldNamesToSchemas: RuntimeFieldSchemas;
    fieldIdsToSchemas: RuntimeFieldSchemas;
    formFieldIdsWithUnsavedChanges: string[];
    urlPrefilledFieldIds?: string[];
    linkedRecordFieldIdToDetailFields: RuntimeLinkedRecordDetailFields;
    cookieKeyForLoginToken: string | null;
};

export type PortalLoadedPayload = RuntimeDisplayMetadata & {
    extensionType: 'portal';
    extensionName: string | null;
    extensionAccessToken: string;
    viewIdsToAirtableViews: JsonObject;
    publicFields: JsonObject;
    formRecord: Extract<RuntimeFormRecord, { type: 'edit' }>;
    fieldNamesToSchemas: RuntimeFieldSchemas;
    fieldIdsToSchemas: RuntimeFieldSchemas;
    linkedRecordFieldIdToDetailFields: RuntimeLinkedRecordDetailFields;
    linkedRecordFieldIdToFieldsTitles: Record<string, Record<string, string>>;
    portalFieldIdToSearchPageField?: Record<
        string,
        { fieldId: string; fieldName: string }
    >;
    cookieKeyForLoginToken: string | null;
    fieldIdsInPortal: string[];
    hasConditionallyHiddenPortalFields?: boolean;
    usersTableFields: RuntimeAirtableField[];
    initialLinkedTableStates: RuntimeTableStates;
};

export type ExtensionScreenResult<Screen extends string, Payload> = {
    extensionScreen: Screen;
    extensionId: string;
    language: RuntimeLanguage;
    themeColor: string;
    enableCommentsOnChildForms: boolean;
    workspaceId: string;
    extensionOwnerUID: string;
    faviconUrl: string | null;
    googleAnalyticsMeasurementId: string | null;
    isStarterExtension: boolean;
    publishedVersionId?: string | null;
    payload: Payload;
};

export type PasswordRequiredResult = ExtensionScreenResult<
    'password',
    PasswordRequiredPayload
>;
export type LoginPageResult = ExtensionScreenResult<
    'login_page',
    LoginPagePayload
>;
export type FormLoadedResult = ExtensionScreenResult<
    'form_loaded',
    FormLoadedPayload
>;
export type PortalLoadedResult = ExtensionScreenResult<
    'portal_loaded',
    PortalLoadedPayload
>;
export type LoadExtensionResult =
    | PasswordRequiredResult
    | LoginPageResult
    | FormLoadedResult
    | PortalLoadedResult
    | {
          type: 'redirect';
          url: string;
          extensionScreen?: never;
          payload?: never;
      };

export type VerifyExtensionPasswordInput = {
    extensionPassword: string;
    extensionId: string;
};
export type VerifyExtensionPasswordResult =
    | { type: 'correct'; encryptedExtensionPassword: string }
    | { type: 'wrong' }
    | { type: 'blocked' };

export type LoginInput = {
    loginCredentials: Record<string, string>;
    loginRecordId?: string;
    extensionId: string;
    fallbackPhoneVerificationNumber?: string;
};
export type LoginResult =
    | { type: 'found-record'; encryptedLoginToken: string }
    | { type: 'no-record' }
    | {
          type: 'verification-message-sent';
          verificationId: string;
          emailOrPhoneNumber: string;
          verificationType: 'email' | 'phoneNumber';
      };

export type ConfirmVerificationCodeInput = {
    verificationId: string;
    verificationCode: string;
    language: RuntimeLanguage;
};
export type ConfirmVerificationCodeResult = { encryptedLoginToken: string };
export type SignUpInput = {
    signUpCredentials: Record<string, string>;
    extensionId: string;
};
export type SignUpResult = { ok: boolean };

export type ConditionalLinkedRecordFilteringValues = Record<
    string,
    { recordId: string; stringValue: string } | null
>;
export type SaveFormInput = {
    extensionAccessToken: string;
    formRecord: RuntimeFormRecord;
    captchaVal: string | null;
    isComputeMode: boolean;
    searchQuery: RuntimeQuery;
    context:
        | { type: 'direct-url' }
        | {
              type: 'modal' | 'side-panel' | 'form-layout';
              prefillData: LinkedRecordPrefill | null;
          };
    longitude?: number;
    latitude?: number;
    conditionalLinkedRecordFieldIdsToFilteringValues: Record<
        string,
        ConditionalLinkedRecordFilteringValues
    >;
    deviceFingerprint?: DeviceFingerprint;
    formFieldIdsWithUnsavedChanges: string[];
};

export type SaveFormResult =
    | {
          type: 'saved';
          record: AirtableRecord;
          loggedInUserRecord: AirtableRecord | null;
          context:
              | { type: 'direct-url' }
              | {
                    type: 'modal' | 'side-panel' | 'form-layout';
                    newTableIdsToLinkedTableStates: RuntimeTableStates;
                };
          tableId: string;
          postSubmissionWarnings?: Array<{
              type:
                  | 'userConfirmationEmailFailed'
                  | 'adminNotificationEmailFailed'
                  | 'smsConfirmationFailed'
                  | 'saveAndContinueUpdateLinkEmailFailed';
          }>;
          postSubmissionNotifications?: Array<{
              type: 'saveAndContinueUpdateLinkEmailSent';
          }>;
      }
    | {
          type: 'error';
          formValidationErrors: Array<{
              fieldId: string;
              fieldTitle: string;
              errorMessage: string;
          }>;
          formErrors: RuntimeFormErrors;
          concurrentEditErrorMessage?: string;
      };

export type RuntimeFieldIdentifier =
    | { type: 'id'; id: string }
    | { type: 'name'; name: string };

export type RuntimeSortField = {
    idOrName: RuntimeFieldIdentifier;
    type: 'asc' | 'desc';
};
export type RuntimeSortFields = RuntimeSortField[];

type Condition<Operator extends string, Field, Value = never> = {
    idOrName: RuntimeFieldIdentifier;
    type: Operator;
    fieldType: Field;
} & ([Value] extends [never] ? { value?: never } : { value: Value });

type TextConditionField =
    | AirtableFieldType.SINGLE_LINE_TEXT
    | AirtableFieldType.EMAIL
    | AirtableFieldType.URL
    | AirtableFieldType.MULTILINE_TEXT
    | AirtableFieldType.PHONE_NUMBER
    | AirtableFieldType.BARCODE
    | AirtableFieldType.AI_TEXT;
type NumberConditionField =
    | AirtableFieldType.NUMBER
    | AirtableFieldType.PERCENT
    | AirtableFieldType.CURRENCY
    | AirtableFieldType.RATING;
type DateConditionField = AirtableFieldType.DATE | AirtableFieldType.DATE_TIME;

export type RuntimeDateRange =
    | 'the past week'
    | 'the past month'
    | 'the past year'
    | 'the next week'
    | 'the next month'
    | 'the next year'
    | 'this week'
    | 'today or in the past'
    | 'today or in the future';

/** Field/operator pairs and operands supported by the runtime filter format. */
export type RuntimeConditionSetting =
    | Condition<
          'filenamesContains',
          AirtableFieldType.MULTIPLE_ATTACHMENTS,
          string | null
      >
    | Condition<
          'matchesRegex',
          | TextConditionField
          | AirtableFieldType.SINGLE_SELECT
          | AirtableFieldType.SINGLE_COLLABORATOR
          | AirtableFieldType.RICH_TEXT,
          string | null
      >
    | Condition<
          'is',
          | TextConditionField
          | AirtableFieldType.SINGLE_SELECT
          | DateConditionField
          | AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
          string | null
      >
    | Condition<'is', AirtableFieldType.CHECKBOX, boolean | null>
    | Condition<
          'isNot',
          | TextConditionField
          | AirtableFieldType.SINGLE_SELECT
          | AirtableFieldType.MULTIPLE_LOOKUP_VALUES,
          string | null
      >
    | Condition<
          'contains' | 'doesNotContain',
          | TextConditionField
          | AirtableFieldType.MULTIPLE_RECORD_LINKS
          | AirtableFieldType.MULTIPLE_LOOKUP_VALUES
          | AirtableFieldType.RICH_TEXT,
          string | null
      >
    | Condition<
          'isOfLength',
          TextConditionField | AirtableFieldType.RICH_TEXT,
          number | null
      >
    | Condition<
          'isAnyOf' | 'isNoneOf',
          AirtableFieldType.SINGLE_SELECT,
          string[] | null
      >
    | Condition<
          'isEmpty' | 'isNotEmpty',
          | TextConditionField
          | NumberConditionField
          | DateConditionField
          | AirtableFieldType.SINGLE_SELECT
          | AirtableFieldType.MULTIPLE_SELECTS
          | AirtableFieldType.SINGLE_COLLABORATOR
          | AirtableFieldType.MULTIPLE_COLLABORATORS
          | AirtableFieldType.MULTIPLE_RECORD_LINKS
          | AirtableFieldType.MULTIPLE_ATTACHMENTS
          | AirtableFieldType.DURATION
          | AirtableFieldType.MULTIPLE_LOOKUP_VALUES
          | AirtableFieldType.RICH_TEXT
      >
    | Condition<
          | 'equals'
          | 'notEquals'
          | 'greaterThan'
          | 'lessThan'
          | 'greaterThanOrEqualsTo'
          | 'lessThanOrEqualsTo',
          NumberConditionField,
          number | null
      >
    | Condition<
          'hasAllOf' | 'hasAnyOf' | 'hasNoneOf' | 'isExactly',
          AirtableFieldType.MULTIPLE_SELECTS,
          string[] | null
      >
    | Condition<'IsWithin', DateConditionField, RuntimeDateRange | null>
    | Condition<
          'isAfter' | 'isBefore' | 'isOnOrAfter' | 'isOnOrBefore',
          DateConditionField,
          string | null
      >
    | Condition<
          | 'isAfterToday'
          | 'isBeforeToday'
          | 'isToday'
          | 'isTomorrow'
          | 'isYesterday',
          DateConditionField
      >;

export type RuntimeConditionItem =
    | { id: string; type: 'singleCondition'; setting: RuntimeConditionSetting }
    | {
          id: string;
          type: 'groupCondition';
          logicalOperator: 'and' | 'or';
          conditions: RuntimeConditionItem[];
      };
export type RuntimeConditionsDefinition = {
    logicalOperator: 'and' | 'or';
    conditions: RuntimeConditionItem[];
};

export type RuntimeLinkedRecordDetailField = {
    fieldId: string;
    fieldName: string;
    titleOverride: string | null;
    isThumbnailField?: boolean;
    miniExtConfig?: JsonObject | null;
    isHidden: boolean;
    fieldIsInEditingChildForm: boolean;
    childFormField: JsonObject | null;
};
export type RuntimeLinkedRecordDetailFields = Record<
    string,
    RuntimeLinkedRecordDetailField[]
>;

export type ListPortalLinkedRecordsInput = {
    extensionAccessToken: string;
    refreshLoggedInPortalRecord?: boolean;
    alreadyLoadedRecordIds: string[];
    portalFieldId: string;
    sortFieldsByEndUser: RuntimeSortFields | null;
    supportsEndUserSortCleanup?: true;
    selectedCustomViewId: string;
    filtersByEndUser: RuntimeConditionsDefinition | null;
    supportsEndUserFilterCleanup?: true;
    searchParamsMap: Record<string, string>;
    airtableOffset: string | null;
    pagesToFetch: number | null;
    searchTerm: string | null;
    calendarLayoutFilter?: {
        monthToFetchRecordsFor: string;
        clientUtcOffset: number;
        clientTimeZone?: string;
    };
};
export type ListPortalLinkedRecordsResult = {
    endUserSortCleanup?: { sortFields: RuntimeSortFields };
    endUserFilterCleanup?: {
        filters: RuntimeConditionsDefinition | null;
    };
    airtableOffset: string | null;
    recordIds: string[];
    tableIdsToLinkedTableStates: RuntimeTableStates;
    customViewDetailFields: RuntimeLinkedRecordDetailFields | null;
};

export type GetPortalUserRecordInput = { extensionAccessToken: string };
export type GetPortalUserRecordResult = AirtableRecord | null;

export type RuntimeGridCellValue =
    | boolean
    | string
    | number
    | null
    | string[]
    | AirtableAttachment[]
    | AirtableCollaborator
    | AirtableCollaborator[]
    | AirtableBarcodeValue;
export type UpdateGridCellInput = {
    portalExtensionAccessToken: string;
    portalFieldId: string;
    recordFieldId: string;
    recordId: string;
    selectedCustomViewId?: string;
    value: RuntimeGridCellValue;
};
export type RuntimeAuditTrail = {
    linkedRecordsFieldToAudit: string;
    recordId: string;
};
export type UpdateGridCellResult = {
    record: AirtableRecord;
    auditTrail: RuntimeAuditTrail | null;
    auditTrails: RuntimeAuditTrail[];
};
export type UnlinkPortalRecordInput = {
    extensionAccessToken: string;
    portalFieldId: string;
    recordIdToUnlink: string;
    selectedCustomViewId: string;
};
export type SetKanbanCategoryInput = {
    extensionAccessToken: string;
    portalFieldId: string;
    recordId: string;
    categoryFieldValue: string | null;
    selectedCustomViewId: string;
};
export type SetKanbanCategoryResult =
    | { type: 'logged-in'; loggedInUserRecord: AirtableRecord }
    | { type: 'no-login' };

export type DeleteCurrentRecordInput = { extensionAccessToken: string };
export type AddSelectOptionInput = {
    extensionAccessToken: string;
    airtableFieldId: string;
    newChoiceText: string;
};
export type AddSelectOptionResult = { newChoice: SelectFieldChoice };

export type LinkedRecordsSelectorFilter =
    | {
          viewType: 'list';
          searchTerm: string;
          searchSource?: 'manual' | 'barcode-scanner';
      }
    | { viewType: 'calendar'; month: string; clientUtcOffset: number };
export type ListFormLinkedRecordOptionsInput = {
    extensionAccessToken: string;
    linkedRecordFieldId: string;
    filter: LinkedRecordsSelectorFilter;
    offset: string | null;
    conditionalLinkedRecordFilteringValues: ConditionalLinkedRecordFilteringValues;
};
export type ListPortalLinkedRecordOptionsInput = {
    extensionAccessToken: string;
    linkedRecordFieldId: string;
    portalTableId: string;
    portalFieldId: string;
    filter: LinkedRecordsSelectorFilter;
    offset: string | null;
};
export type ListLinkedRecordOptionsResult = {
    records: AirtableRecord[];
    offset: string | null;
    tableIdsToLinkedTableStates: RuntimeTableStates;
};
export type LoadSelectedRecordsInput = { extensionAccessToken: string };
export type LoadSelectedRecordsResult = RuntimeTableStates;

export type CreateUploadUrlInput = {
    fileType: string;
    filename: string;
    fileSize: number;
    authority: {
        type: 'form';
        extensionAccessToken: string;
        fieldId: string;
    };
};
export type CreateUploadUrlResult = { signedUrl: string; publicUrl: string };
export type UploadFileInput = {
    file: Blob;
    filename: string;
    extensionAccessToken: string;
    fieldId: string;
};
export type UploadFileResult = {
    id: null;
    url: string;
    filename: string;
    size: number;
    type: string;
};

export type RuntimeAirtableComment = {
    id: string;
    createdTime: string;
    lastUpdatedTime: string | null;
    text: string;
    author: { id: string; email: string; name: string | null };
    mentioned: Record<
        string,
        | { type: 'userGroup'; id: string; name: string }
        | { type: 'user'; id: string; name: string; email: string }
    >;
};
export type ListRecordCommentsInput = { childExtensionAccessToken: string };
export type ListRecordCommentsResult = {
    readableVersionOfRecordPrimaryValue: string | null;
    comments: RuntimeAirtableComment[];
    disableSending?: boolean;
};
export type AddRecordCommentInput = {
    childExtensionAccessToken: string;
    comment: string;
};

/** Operations sent to the SDK endpoint; uploadFile is a client-side helper. */
export type RuntimeOperation =
    | 'loadExtension'
    | 'auth.verifyExtensionPassword'
    | 'auth.login'
    | 'auth.confirmVerificationCode'
    | 'auth.signUp'
    | 'forms.save'
    | 'forms.deleteCurrentRecord'
    | 'forms.addSelectOption'
    | 'portals.listLinkedRecords'
    | 'portals.getUserRecord'
    | 'portals.updateGridCell'
    | 'portals.unlinkRecord'
    | 'portals.setKanbanCategory'
    | 'linkedRecords.listFormOptions'
    | 'linkedRecords.listPortalOptions'
    | 'linkedRecords.loadSelectedRecords'
    | 'attachments.createUploadUrl'
    | 'comments.listForRecord'
    | 'comments.addToRecord';

export type RuntimeRequestOptions = {
    signal?: AbortSignal;
    /** Complete request-only replacement; it is never persisted or merged. */
    session?: Readonly<RuntimeSession>;
};

export type MiniExtensionsClientOptions = {
    apiOrigin: string;
    publishableKey: string;
    session?: Readonly<RuntimeSession>;
    fetch?: typeof globalThis.fetch;
};

export type MiniExtensionsClient = {
    getSession(): RuntimeSession;
    setSession(session: Readonly<RuntimeSession>): void;
    loadExtension(
        input: LoadExtensionInput,
        options?: RuntimeRequestOptions
    ): Promise<LoadExtensionResult>;
    auth: {
        verifyExtensionPassword(
            input: VerifyExtensionPasswordInput,
            options?: RuntimeRequestOptions
        ): Promise<VerifyExtensionPasswordResult>;
        login(
            input: LoginInput,
            options?: RuntimeRequestOptions
        ): Promise<LoginResult>;
        confirmVerificationCode(
            input: ConfirmVerificationCodeInput,
            options?: RuntimeRequestOptions
        ): Promise<ConfirmVerificationCodeResult>;
        signUp(
            input: SignUpInput,
            options?: RuntimeRequestOptions
        ): Promise<SignUpResult>;
    };
    forms: {
        save(
            input: SaveFormInput,
            options?: RuntimeRequestOptions
        ): Promise<SaveFormResult>;
        deleteCurrentRecord(
            input: DeleteCurrentRecordInput,
            options?: RuntimeRequestOptions
        ): Promise<void>;
        addSelectOption(
            input: AddSelectOptionInput,
            options?: RuntimeRequestOptions
        ): Promise<AddSelectOptionResult>;
    };
    portals: {
        listLinkedRecords(
            input: ListPortalLinkedRecordsInput,
            options?: RuntimeRequestOptions
        ): Promise<ListPortalLinkedRecordsResult>;
        getUserRecord(
            input: GetPortalUserRecordInput,
            options?: RuntimeRequestOptions
        ): Promise<GetPortalUserRecordResult>;
        updateGridCell(
            input: UpdateGridCellInput,
            options?: RuntimeRequestOptions
        ): Promise<UpdateGridCellResult>;
        unlinkRecord(
            input: UnlinkPortalRecordInput,
            options?: RuntimeRequestOptions
        ): Promise<void>;
        setKanbanCategory(
            input: SetKanbanCategoryInput,
            options?: RuntimeRequestOptions
        ): Promise<SetKanbanCategoryResult>;
    };
    linkedRecords: {
        listFormOptions(
            input: ListFormLinkedRecordOptionsInput,
            options?: RuntimeRequestOptions
        ): Promise<ListLinkedRecordOptionsResult>;
        listPortalOptions(
            input: ListPortalLinkedRecordOptionsInput,
            options?: RuntimeRequestOptions
        ): Promise<ListLinkedRecordOptionsResult>;
        loadSelectedRecords(
            input: LoadSelectedRecordsInput,
            options?: RuntimeRequestOptions
        ): Promise<LoadSelectedRecordsResult>;
    };
    attachments: {
        createUploadUrl(
            input: CreateUploadUrlInput,
            options?: RuntimeRequestOptions
        ): Promise<CreateUploadUrlResult>;
        /** Uploads bytes only; callers explicitly add the attachment to a Form. */
        uploadFile(
            input: UploadFileInput,
            options?: RuntimeRequestOptions
        ): Promise<UploadFileResult>;
    };
    comments: {
        listForRecord(
            input: ListRecordCommentsInput,
            options?: RuntimeRequestOptions
        ): Promise<ListRecordCommentsResult>;
        addToRecord(
            input: AddRecordCommentInput,
            options?: RuntimeRequestOptions
        ): Promise<void>;
    };
};
