import type {
    CanonicalAirtableAttachment,
    CanonicalAirtableBarcodeValue,
    CanonicalAirtableCollaborator,
    CanonicalAirtableField,
    CanonicalAirtableFieldSet,
    CanonicalAirtableRecord,
    CanonicalAirtableValue,
    CanonicalConditionalLinkedRecordFilteringValues,
    CanonicalDeviceFingerprint,
    CanonicalFormErrors,
    CanonicalFormLoadedOutput,
    CanonicalLanguage,
    CanonicalLinkedRecordPrefill,
    CanonicalLoadExtensionContext,
    CanonicalLoginPageOutput,
    CanonicalOperationInputs,
    CanonicalOperationOutputs,
    CanonicalPasswordRequiredOutput,
    CanonicalPortalLoadedOutput,
    CanonicalQuery,
    CanonicalSelectorFilter,
    CanonicalSelectFieldChoice,
} from './contracts/generated.js';
import type {
    CanonicalPostgresAttachmentDisplayFailure,
    CanonicalPostgresBooleanColumnConfig,
    CanonicalPostgresConnection,
    CanonicalPostgresConfiguredColumn,
    CanonicalPostgresCreateQuery,
    CanonicalPostgresCreateResult,
    CanonicalPostgresDatabase,
    CanonicalPostgresDateColumnConfig,
    CanonicalPostgresEnumColumnConfig,
    CanonicalPostgresUuidColumnConfig,
    CanonicalPostgresTimestampColumnConfig,
    CanonicalPostgresTimestamptzColumnConfig,
    CanonicalPostgresTimeColumnConfig,
    CanonicalPostgresTimetzColumnConfig,
    CanonicalPostgresIntervalColumnConfig,
    CanonicalPostgresJsonColumnConfig,
    CanonicalPostgresJsonbColumnConfig,
    CanonicalPostgresField,
    CanonicalPostgresFormRecordAccess,
    CanonicalPostgresFormDraftState,
    CanonicalPostgresFormDraft,
    CanonicalPostgresFilter,
    CanonicalPostgresIdentifierConfiguration,
    CanonicalPostgresNumericColumnConfig,
    CanonicalPostgresNativeDraft,
    CanonicalPostgresPortalTab,
    CanonicalPostgresPortalDraftState,
    CanonicalPostgresPortalDraft,
    CanonicalPostgresRecord,
    CanonicalPostgresRecordDisplayConfiguration,
    CanonicalPostgresRecordEditingConfiguration,
    CanonicalPostgresRecordEditingValidation,
    CanonicalPostgresRecordIdentity,
    CanonicalPostgresReadableRelationConfiguration,
    CanonicalPostgresRelationship,
    CanonicalPostgresRelationshipOperator,
    CanonicalPostgresRelationshipCollation,
    CanonicalPostgresRelationshipConfig,
    CanonicalPostgresRelationshipColumn,
    CanonicalPostgresRelationshipBinding,
    CanonicalPostgresRelationshipSelection,
    CanonicalPostgresRelationshipChange,
    CanonicalPostgresRelationshipClear,
    CanonicalPostgresRelationshipCandidate,
    CanonicalPostgresRelationshipCandidatePage,
    CanonicalPostgresRowObservation,
    CanonicalPostgresSchema,
    CanonicalPostgresSelectQuery,
    CanonicalPostgresSelectResult,
    CanonicalPostgresSort,
    CanonicalPostgresSource,
    CanonicalPostgresTable,
    CanonicalPostgresTableReference,
    CanonicalPostgresTextColumnConfig,
    CanonicalPostgresType,
    CanonicalPostgresUpdateQuery,
    CanonicalPostgresUpdateResult,
    CanonicalPostgresValue,
} from './contracts/postgres.generated.js';

export type { CanonicalOperationTransports } from './contracts/generated.js';

/** Client-side JSON utilities; these do not define any server API payload. */
export type JsonValue =
    | string
    | number
    | boolean
    | null
    | readonly JsonValue[]
    | JsonObject;
export type JsonObject = { readonly [key: string]: JsonValue | undefined };
export type RuntimeSession = Record<string, string>;

/** Portable contracts generated from the existing API source of truth. */
export type AirtableField = CanonicalAirtableField;
export type AirtableAttachment = CanonicalAirtableAttachment;
export type AirtableBarcodeValue = CanonicalAirtableBarcodeValue;
export type AirtableCollaborator = CanonicalAirtableCollaborator;
export type SelectFieldChoice = CanonicalSelectFieldChoice;
export type AirtableFieldSet = CanonicalAirtableFieldSet;
export type AirtableRecord = CanonicalAirtableRecord;
export type AirtableValue = CanonicalAirtableValue;
/** Native PostgreSQL metadata and wire values; these do not imply a loaded Form. */
export type PostgresAttachmentDisplayFailure =
    CanonicalPostgresAttachmentDisplayFailure;
export type PostgresConnection = CanonicalPostgresConnection;
/** Native adapter contracts; these do not add a public Form transport operation. */
export type PostgresCreateQuery = CanonicalPostgresCreateQuery;
export type PostgresCreateResult = CanonicalPostgresCreateResult;
/** Loaded native baselines confer no continuing authorization to edit a row. */
export type PostgresRowObservation = CanonicalPostgresRowObservation;
/** Native adapter contracts; these do not add a public Portal save operation. */
export type PostgresUpdateQuery = CanonicalPostgresUpdateQuery;
export type PostgresUpdateResult = CanonicalPostgresUpdateResult;
/** Saved private Form access intent; current database/workspace checks still apply. No public transport admission. */
export type PostgresFormRecordAccess = CanonicalPostgresFormRecordAccess;
/** Private member authoring contracts; parsing and current authorization remain server-side. */
export type PostgresConfiguredColumn = CanonicalPostgresConfiguredColumn;
export type PostgresReadableRelationConfiguration =
    CanonicalPostgresReadableRelationConfiguration;
export type PostgresFormDraftState = CanonicalPostgresFormDraftState;
export type PostgresFormDraft = CanonicalPostgresFormDraft;
export type PostgresPortalTab = CanonicalPostgresPortalTab;
export type PostgresPortalDraftState = CanonicalPostgresPortalDraftState;
export type PostgresPortalDraft = CanonicalPostgresPortalDraft;
export type PostgresNativeDraft = CanonicalPostgresNativeDraft;
export type PostgresSource = CanonicalPostgresSource;
export type PostgresDatabase = CanonicalPostgresDatabase;
export type PostgresSchema = CanonicalPostgresSchema;
export type PostgresTable = CanonicalPostgresTable;
export type PostgresTableReference = CanonicalPostgresTableReference;
export type PostgresField = CanonicalPostgresField;
export type PostgresType = CanonicalPostgresType;
export type PostgresRelationship = CanonicalPostgresRelationship;
/** Saved native relationship intent; current settings, grants and tuple checks remain server-side. */
export type PostgresRelationshipOperator =
    CanonicalPostgresRelationshipOperator;
export type PostgresRelationshipCollation =
    CanonicalPostgresRelationshipCollation;
export type PostgresRelationshipConfig = CanonicalPostgresRelationshipConfig;
export type PostgresRelationshipColumn = CanonicalPostgresRelationshipColumn;
export type PostgresRelationshipBinding = CanonicalPostgresRelationshipBinding;
export type PostgresRelationshipSelection =
    CanonicalPostgresRelationshipSelection;
export type PostgresRelationshipChange = CanonicalPostgresRelationshipChange;
export type PostgresRelationshipClear = CanonicalPostgresRelationshipClear;
export type PostgresRelationshipCandidate =
    CanonicalPostgresRelationshipCandidate;
export type PostgresRelationshipCandidatePage =
    CanonicalPostgresRelationshipCandidatePage;

export type PostgresRecord = CanonicalPostgresRecord;
export type PostgresValue = CanonicalPostgresValue;
/** Generated scalar storage only; no schema validator or Form admission. */
export type PostgresTextColumnConfig = CanonicalPostgresTextColumnConfig;
/** Generated Boolean-column settings only; native values remain text/NULL. */
export type PostgresBooleanColumnConfig = CanonicalPostgresBooleanColumnConfig;
/** Generated numeric-column settings only; native values stay lossless text. */
export type PostgresNumericColumnConfig = CanonicalPostgresNumericColumnConfig;
/** Generated SQL DATE settings only; this adds no date parser or coercion. */
export type PostgresDateColumnConfig = CanonicalPostgresDateColumnConfig;
export type PostgresEnumColumnConfig = CanonicalPostgresEnumColumnConfig;
export type PostgresUuidColumnConfig = CanonicalPostgresUuidColumnConfig;
/** Native temporal configuration only; values retain PostgreSQL text precision. */
export type PostgresTimestampColumnConfig =
    CanonicalPostgresTimestampColumnConfig;
export type PostgresTimestamptzColumnConfig =
    CanonicalPostgresTimestamptzColumnConfig;
export type PostgresTimeColumnConfig = CanonicalPostgresTimeColumnConfig;
export type PostgresTimetzColumnConfig = CanonicalPostgresTimetzColumnConfig;
export type PostgresIntervalColumnConfig =
    CanonicalPostgresIntervalColumnConfig;
export type PostgresJsonColumnConfig = CanonicalPostgresJsonColumnConfig;
export type PostgresJsonbColumnConfig = CanonicalPostgresJsonbColumnConfig;
export type PostgresRecordIdentity = CanonicalPostgresRecordIdentity;
export type PostgresIdentifierConfiguration =
    CanonicalPostgresIdentifierConfiguration;
export type PostgresRecordDisplayConfiguration =
    CanonicalPostgresRecordDisplayConfiguration;
export type PostgresRecordEditingConfiguration =
    CanonicalPostgresRecordEditingConfiguration;
/** A current visible snapshot observation, never ongoing mutation authority. */
export type PostgresRecordEditingValidation =
    CanonicalPostgresRecordEditingValidation;
/** Structured read contracts; public runtime transport is a separate integration. */
export type PostgresFilter = CanonicalPostgresFilter;
export type PostgresSort = CanonicalPostgresSort;
export type PostgresSelectQuery = CanonicalPostgresSelectQuery;
export type PostgresSelectResult = CanonicalPostgresSelectResult;
export type RuntimeQuery = CanonicalQuery;
export type RuntimeLanguage = CanonicalLanguage;
export type RuntimeAirtableField = CanonicalAirtableField;
export type RuntimeLinkedRecordFieldConfig = Extract<
    RuntimeAirtableField['config'],
    { type: 'multipleRecordLinks' }
>;
export type RuntimeFieldSchema =
    FormLoadedPayload['fieldNamesToSchemas'][string];
export type RuntimeFieldSchemas = FormLoadedPayload['fieldNamesToSchemas'];
export type RuntimeTableStates =
    CanonicalOperationOutputs['linkedRecords.loadSelectedRecords'];
export type RuntimeTableState = RuntimeTableStates[string];
export type RuntimeFormErrors = CanonicalFormErrors;
export type RuntimeFormRecord = SaveFormInput['formRecord'];
export type DeviceFingerprint = CanonicalDeviceFingerprint;
export type LinkedRecordPrefill = CanonicalLinkedRecordPrefill;
export type LoadExtensionContext = CanonicalLoadExtensionContext;

export type PasswordRequiredResult = CanonicalPasswordRequiredOutput;
export type LoginPageResult = CanonicalLoginPageOutput;
export type FormLoadedResult = CanonicalFormLoadedOutput;
export type PortalLoadedResult = CanonicalPortalLoadedOutput;
export type PasswordRequiredPayload = PasswordRequiredResult['payload'];
export type LoginPagePayload = LoginPageResult['payload'];
export type FormLoadedPayload = FormLoadedResult['payload'];
export type PortalLoadedPayload = PortalLoadedResult['payload'];
export type ExtensionScreenResult<Screen extends string, Payload> = Omit<
    PasswordRequiredResult,
    'extensionScreen' | 'payload'
> & { extensionScreen: Screen; payload: Payload };
export type LoadExtensionInput = CanonicalOperationInputs['loadExtension'];
export type LoadExtensionResult = CanonicalOperationOutputs['loadExtension'];
export type VerifyExtensionPasswordInput =
    CanonicalOperationInputs['auth.verifyExtensionPassword'];
export type VerifyExtensionPasswordResult =
    CanonicalOperationOutputs['auth.verifyExtensionPassword'];
export type LoginInput = CanonicalOperationInputs['auth.login'];
export type LoginResult = CanonicalOperationOutputs['auth.login'];
export type ConfirmVerificationCodeInput =
    CanonicalOperationInputs['auth.confirmVerificationCode'];
export type ConfirmVerificationCodeResult =
    CanonicalOperationOutputs['auth.confirmVerificationCode'];
export type SignUpInput = CanonicalOperationInputs['auth.signUp'];
export type SignUpResult = CanonicalOperationOutputs['auth.signUp'];
export type ConditionalLinkedRecordFilteringValues =
    CanonicalConditionalLinkedRecordFilteringValues;
export type SaveFormInput = CanonicalOperationInputs['forms.save'];
export type SaveFormResult = CanonicalOperationOutputs['forms.save'];
export type DeleteCurrentRecordInput =
    CanonicalOperationInputs['forms.deleteCurrentRecord'];
export type AddSelectOptionInput =
    CanonicalOperationInputs['forms.addSelectOption'];
export type AddSelectOptionResult =
    CanonicalOperationOutputs['forms.addSelectOption'];
export type ListPortalLinkedRecordsInput =
    CanonicalOperationInputs['portals.listLinkedRecords'];
export type ListPortalLinkedRecordsResult =
    CanonicalOperationOutputs['portals.listLinkedRecords'];
export type GetPortalUserRecordInput =
    CanonicalOperationInputs['portals.getUserRecord'];
export type GetPortalUserRecordResult =
    CanonicalOperationOutputs['portals.getUserRecord'];
export type UpdateGridCellInput =
    CanonicalOperationInputs['portals.updateGridCell'];
export type UpdateGridCellResult =
    CanonicalOperationOutputs['portals.updateGridCell'];
export type UnlinkPortalRecordInput =
    CanonicalOperationInputs['portals.unlinkRecord'];
export type SetKanbanCategoryInput =
    CanonicalOperationInputs['portals.setKanbanCategory'];
export type SetKanbanCategoryResult =
    CanonicalOperationOutputs['portals.setKanbanCategory'];
export type ListFormLinkedRecordOptionsInput =
    CanonicalOperationInputs['linkedRecords.listFormOptions'];
export type ListPortalLinkedRecordOptionsInput =
    CanonicalOperationInputs['linkedRecords.listPortalOptions'];
export type ListLinkedRecordOptionsResult =
    CanonicalOperationOutputs['linkedRecords.listFormOptions'];
export type LoadSelectedRecordsInput =
    CanonicalOperationInputs['linkedRecords.loadSelectedRecords'];
export type LoadSelectedRecordsResult =
    CanonicalOperationOutputs['linkedRecords.loadSelectedRecords'];
export type ListConditionalFilterPrimaryValuesInput =
    CanonicalOperationInputs['linkedRecords.listConditionalFilterPrimaryValues'];
export type ListConditionalFilterPrimaryValuesResult =
    CanonicalOperationOutputs['linkedRecords.listConditionalFilterPrimaryValues'];
export type ConditionalFilterPrimaryValue =
    ListConditionalFilterPrimaryValuesResult['primaryValues'][number];
export type ConditionalFilterData =
    ListConditionalFilterPrimaryValuesInput['filterData'];
export type ListAddressPredictionsInput =
    CanonicalOperationInputs['addresses.listPredictions'];
export type ListAddressPredictionsResult =
    CanonicalOperationOutputs['addresses.listPredictions'];
export type AddressPrediction = ListAddressPredictionsResult[number];
export type GetFormattedAddressInput =
    CanonicalOperationInputs['addresses.getFormattedAddress'];
export type GetFormattedAddressResult =
    CanonicalOperationOutputs['addresses.getFormattedAddress'];
export type TriggerConfiguredButtonWebhookInput =
    CanonicalOperationInputs['buttons.triggerWebhook'];
export type TriggerConfiguredButtonWebhookResult =
    CanonicalOperationOutputs['buttons.triggerWebhook'];
export type ConfiguredButtonWebhookSource =
    TriggerConfiguredButtonWebhookInput['source'];
export type CreateUploadUrlInput =
    CanonicalOperationInputs['attachments.createUploadUrl'];
export type CreateUploadUrlResult =
    CanonicalOperationOutputs['attachments.createUploadUrl'];
export type ListRecordCommentsInput =
    CanonicalOperationInputs['comments.listForRecord'];
export type ListRecordCommentsResult =
    CanonicalOperationOutputs['comments.listForRecord'];
export type AddRecordCommentInput =
    CanonicalOperationInputs['comments.addToRecord'];

export type RuntimeFieldIdentifier = RuntimeSortFields[number]['idOrName'];
export type RuntimeSortFields = NonNullable<
    ListPortalLinkedRecordsInput['sortFieldsByEndUser']
>;
export type RuntimeSortField = RuntimeSortFields[number];
export type RuntimeConditionsDefinition = NonNullable<
    ListPortalLinkedRecordsInput['filtersByEndUser']
>;
export type RuntimeConditionItem =
    RuntimeConditionsDefinition['conditions'][number];
export type RuntimeConditionSetting = Extract<
    RuntimeConditionItem,
    { type: 'singleCondition' }
>['setting'];
export type RuntimeDateRange = NonNullable<
    Extract<RuntimeConditionSetting, { type: 'IsWithin' }>['value']
>;
export type RuntimeLinkedRecordDetailFields =
    FormLoadedPayload['linkedRecordFieldIdToDetailFields'];
export type RuntimeLinkedRecordDetailField =
    RuntimeLinkedRecordDetailFields[string][number];
export type RuntimeGridCellValue = UpdateGridCellInput['value'];
export type RuntimeAuditTrail = NonNullable<UpdateGridCellResult['auditTrail']>;
export type LinkedRecordsSelectorFilter = CanonicalSelectorFilter;
export type RuntimeAirtableComment =
    ListRecordCommentsResult['comments'][number];
export type RuntimeOperation = keyof CanonicalOperationInputs;

/** Uploading bytes is a client helper, separate from canonical Form saving. */
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

export type RuntimeRequestOptions = {
    signal?: AbortSignal;
    /** Complete request-only replacement; it is never persisted or merged. */
    session?: Readonly<RuntimeSession>;
};

export type MiniExtensionsClientOptions = {
    /** Defaults to https://web.miniextensions.com; explicit overrides stay authoritative. */
    apiOrigin?: string;
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
        listConditionalFilterPrimaryValues(
            input: ListConditionalFilterPrimaryValuesInput,
            options?: RuntimeRequestOptions
        ): Promise<ListConditionalFilterPrimaryValuesResult>;
    };
    addresses: {
        listPredictions(
            input: ListAddressPredictionsInput,
            options?: RuntimeRequestOptions
        ): Promise<ListAddressPredictionsResult>;
        getFormattedAddress(
            input: GetFormattedAddressInput,
            options?: RuntimeRequestOptions
        ): Promise<GetFormattedAddressResult>;
    };
    buttons: {
        /** Runs the configured Button action; the server resolves URL and method. */
        triggerWebhook(
            input: TriggerConfiguredButtonWebhookInput,
            options?: RuntimeRequestOptions
        ): Promise<TriggerConfiguredButtonWebhookResult>;
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
