import type {
    AirtableAttachment,
    AirtableField,
    AirtableFieldType,
    AirtableRecord,
    AirtableValue,
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

export type RuntimeFieldSchema = {
    fieldType: AirtableFieldType;
    airtableField: AirtableField;
    miniExtConfig?: JsonObject;
};
export type RuntimeFieldSchemas = Record<string, RuntimeFieldSchema>;
export type RuntimeTableState = {
    airtableFields: AirtableField[];
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
    linkedRecordFieldIdToDetailFields: JsonObject;
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
    linkedRecordFieldIdToDetailFields: JsonObject;
    linkedRecordFieldIdToFieldsTitles: Record<string, Record<string, string>>;
    portalFieldIdToSearchPageField?: Record<
        string,
        { fieldId: string; fieldName: string }
    >;
    cookieKeyForLoginToken: string | null;
    fieldIdsInPortal: string[];
    hasConditionallyHiddenPortalFields?: boolean;
    usersTableFields: AirtableField[];
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

export type RuntimeOperation =
    | 'loadExtension'
    | 'auth.verifyExtensionPassword'
    | 'auth.login'
    | 'auth.confirmVerificationCode'
    | 'auth.signUp'
    | 'forms.save';

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
    };
};
