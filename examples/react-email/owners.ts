import {
    createMiniExtensionsClient,
    type AirtableValue,
    type FormLoadedResult,
    type PortalLoadedResult,
    type RuntimeFieldSchema,
    type ListPortalLinkedRecordsResult,
} from '@miniextensions/sdk';
import {
    createFormFieldBindings,
    RecoveryJournal,
} from '@miniextensions/sdk/forms';
import {
    createPortalCellBinding,
    createPortalListOwner,
} from '@miniextensions/sdk/portals';
import {
    createFormFieldRendererHost,
    createPortalCellRendererHost,
    createPortalDetailRendererHost,
    type FieldRendererHost,
} from '@miniextensions/sdk/ui';

// All payloads and identifiers in this module are synthetic. Public owners and
// their guards are real; the three transport methods below only access memory.
// No native email validation, trimming, case folding, links, or live Save is used.
/** Complete synthetic settings with the canonical public response shape. */
const publicFormFields = (): FormLoadedResult['payload']['publicFields'] => ({
    type: 'form',
    state: {
        formFields: null,
        tableId: 'table_example',
        disableCreatingRecords: null,
        disableAccessingExistingRecords: null,
        accessingRecordsMethod: null,
        loginFields: null,
        ifRecordDoesNotExist: null,
        enableCustomErrorMessage: null,
        customErrorMessageIfRecordDoesNotExist: null,
        redirectUrlIfRecordDoesNotExist: null,
        allowLoginConditionally: null,
        allowLoginConditionFields: {
            logicalOperator: 'and',
            conditions: [],
        },
        enableAccessingExistingRecordsConditionally: null,
        enableAccessingExistingRecordsConditionFields: null,
        allowCreatingOnlyOneRecord: null,
        disableFormAfterSubmissionLimit: null,
        submissionLimit: null,
        enableLockingFormAfterSubmission: null,
        checkboxFieldUsedForLocking: null,
        disableFormAtScheduledDate: null,
        dateForDisablingFormStatic: null,
        dateForDisablingFormField: null,
        dateForDisablingFormType: null,
        enableCustomFormDisabledMessage: null,
        formDisabledMessageStatic: null,
        formDisabledMessageField: null,
        formDisabledMessageType: null,
        enableSaveFormButtonConditionally: null,
        enableSaveFormButtonConditionFields: null,
        customDisabledFormMessage: null,
        embeddedFormRedirectType: null,
        enableCustomExtensionSlug: null,
        enableLoginPageTitle: null,
        loginPageTitle: null,
        enableLoginPageSubtitle: null,
        loginPageSubtitle: null,
        enableLoginPageCoverImage: null,
        loginPageCoverImageURL: null,
        loginPageImageFit: null,
        enableLoginPageCustomSubmitButtonLabel: null,
        loginPageSubmitButtonLabel: null,
        formHeaderTitleType: null,
        formHeaderTitleField: null,
        formTitleDescriptionStatic: null,
        enableFormDescription: null,
        formHeaderDescriptionStatic: null,
        formHeaderDescriptionField: null,
        formHeaderDescriptionType: null,
        truncateDescription: null,
        enableLogo: null,
        formHeaderLogoImageURLStatic: null,
        formHeaderLogoImageURLField: null,
        formHeaderLogoImageURLType: null,
        enableCoverImage: null,
        formCoverImageUrl: null,
        enableFormFooter: null,
        formFooterDescriptionStatic: null,
        formFooterDescriptionField: null,
        formFooterDescriptionType: null,
        enableSubmitButtonLabel: null,
        formSaveButtonText: null,
        promptUserBeforeSubmission: null,
        successAction: null,
        successMessageStatic: null,
        successMessageField: null,
        successMessageType: null,
        successMessageDelay: null,
        afterFormSubmission: null,
        reloadFormDelay: null,
        showPrintButton: null,
        successMessageCanCreateNewRecord: null,
        successMessageNewRecordText: null,
        allowCopySubmittedToNewForm: null,
        allowCopySubmittedToNewFormButtonText: null,
        redirectURLType: null,
        redirectURLField: null,
        redirectURLStatic: null,
        enableRedirectDelay: null,
        redirectDelay: null,
        enableWebhookTrigger: null,
        webhookTriggerURLType: null,
        webhookTriggerURLField: null,
        webhookTriggerURLStatic: null,
        webhookURLRequestType: null,
        webhookTriggerConditions: null,
        sessionExpiration: null,
        closeDelay: null,
        emailFormSubmissionToAdmin: null,
        formSubmissionEmails: null,
        emailFormSubmissionToUser: null,
        emailFormSubmissionToUserEmailField: null,
        emailFormSubmissionToUserEmailSubjectField: null,
        emailFormSubmissionToUserEmailBodyField: null,
        emailFormSubmissionToUserEmailFrom: null,
        sendSMSConfirmationToUser: null,
        smsPhoneNumberField: null,
        smsMessageField: null,
        themeColor: null,
        setFormBackgroundColorToThemeColor: null,
        hideGridHeaderIcons: null,
        formMaxWidth: null,
        multiPageFormMode: null,
        language: null,
        enableExtensionPassword: null,
        extensionPassword: null,
        enableCaptcha: null,
        allowDeletingRecords: null,
        hideDeleteButton: null,
        deleteButtonText: null,
        enableTracking: null,
        userIPAddressField: null,
        userLongitudeField: null,
        userLatitudeField: null,
        enablePrefillForNewRecords: null,
        prefillURLParamsForAddingRecords: null,
        allowHiddenPrefills: null,
        autoSubmitAfterPrefill: null,
        enableFormComputeMode: null,
        computeMode: null,
        enableCustomComputeButtonLabel: null,
        computeModeComputeButtonTitle: null,
        computeModeUseConfirmationCheckbox: null,
        computeModeConfirmationCheckboxField: null,
        sendUpdateLinkToUser: null,
        updateLinkEmailField: null,
        saveFormProgress: null,
        enableCommentsOnChildForms: null,
        commenterNameField: null,
        enableIntercomChat: null,
        intercomAppId: null,
        goToNextRecordAfterSubmission: null,
    },
});

const publicPortalFields =
    (): PortalLoadedResult['payload']['publicFields'] => ({
        type: 'portal',
        state: {
            portalFields: null,
            tableId: 'table_example',
            enableCustomExtensionSlug: null,
            doNotRequireLoginInPortal: null,
            loginFields: null,
            ifRecordDoesNotExist: null,
            redirectUrlIfRecordDoesNotExist: null,
            enableCustomErrorMessage: null,
            customErrorMessageIfRecordDoesNotExist: null,
            allowLoginConditionally: null,
            allowLoginConditionFields: null,
            lastLoginDate: null,
            enableLoginPageTitle: null,
            loginPageTitle: null,
            enableLoginPageSubtitle: null,
            loginPageSubtitle: null,
            enableLoginPageCoverImage: null,
            loginPageCoverImageURL: null,
            loginPageImageFit: null,
            enableLoginPageCustomSubmitButtonLabel: null,
            loginPageSubmitButtonLabel: null,
            portalPageTitle: null,
            hidePortalHeader: null,
            portalHeaderTitleType: null,
            portalHeaderTitleField: null,
            showPortalHeaderAsHTML: null,
            portalHeaderLogo: null,
            enablePortalDescription: null,
            portalDescription: null,
            enablePortalWelcomeMessage: null,
            portalWelcomeMessage: null,
            truncatePortalDescription: null,
            doNotShowUserProfile: null,
            portalUserMenu: null,
            portalProfileTitleType: null,
            portalHeaderUserTitleField: null,
            portalHeaderUserTitleText: null,
            extensionIdForUserProfile: null,
            hideLogoutButton: null,
            hideMenuItems: null,
            portalHeaderDisplayMode: null,
            viewsDisplayMode: null,
            enableExternalLinks: null,
            menuItems: null,
            groupMenus: null,
            menusGroupName: null,
            enableExtensionPassword: null,
            extensionPassword: null,
            themeColor: null,
            setFormBackgroundColorToThemeColor: null,
            hideGridHeaderIcons: null,
            childFormMaxWidth: null,
            language: null,
            enableCommentsOnChildForms: null,
            commenterNameField: null,
            enableIntercomChat: null,
            intercomAppId: null,
        },
    });

type OwnerReceipt = {
    formSaves: number;
    gridSaves: number;
    fetchAttempts: number;
    portalReads: number;
    formSavedValue: string | null;
    gridSavedValue: string | null;
    formWrites: number;
    gridWrites: number;
};
const receipt: OwnerReceipt = {
    formSaves: 0,
    gridSaves: 0,
    fetchAttempts: 0,
    portalReads: 0,
    formSavedValue: null,
    gridSavedValue: null,
    formWrites: 0,
    gridWrites: 0,
};
const receiptListeners = new Set<() => void>();
const emitReceipt = () => {
    for (const listener of receiptListeners) listener();
};
export const getOwnerReceipt = (): OwnerReceipt => ({ ...receipt });
export const subscribeOwnerReceipt = (listener: () => void) => {
    receiptListeners.add(listener);
    return () => {
        receiptListeners.delete(listener);
    };
};
const emailValue = (value: AirtableValue | undefined): string | null => {
    if (value == null) return null;
    if (typeof value !== 'string')
        throw new Error('Expected a synthetic email string.');
    return value;
};
const client = createMiniExtensionsClient({
    apiOrigin: 'https://sdk.example.test',
    session: { visitor: 'synthetic-email-owner' },
    fetch: async () => {
        receipt.fetchAttempts++;
        emitReceipt();
        throw new Error('Unexpected synthetic fixture network request.');
    },
});
const emailSchema = (id: string, title: string): RuntimeFieldSchema => ({
    fieldType: 'email',
    airtableField: {
        id,
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'email', options: null },
    },
    miniExtConfig: {},
});
const formSchema = emailSchema('fld_form_email', 'Form email');
const gridSchema = emailSchema('fld_grid_email', 'Grid email');
const listSchema = emailSchema('fld_list_email', 'List email');
const extension = {
    extensionId: 'extension_synthetic_email',
    language: 'en' as const,
    themeColor: 'blue' as const,
    enableCommentsOnChildForms: false,
    workspaceId: 'workspace_synthetic',
    extensionOwnerUID: 'owner_synthetic',
    faviconUrl: null,
    googleAnalyticsMeasurementId: null,
    isStarterExtension: false,
    publishedVersionId: 'version_synthetic',
};
const sharedPayload = {
    extensionAccessToken: 'synthetic_not_a_credential',
    extensionName: 'Synthetic email owners',
    baseId: 'base_synthetic',
    loggedInUserCanEditExtension: false,
    showMiniExtensionsBranding: false,
    onFreePlan: false,
    trialExpiresAtUnixEpoch: null,
    fieldNamesToSchemas: {},
    cookieKeyForLoginToken: null,
};
const loadedForm: FormLoadedResult = {
    ...extension,
    extensionScreen: 'form_loaded',
    payload: {
        ...sharedPayload,
        extensionType: 'form',
        hasParentExtension: false,
        formRecord: { type: 'create', data: { fld_form_email: null } },
        formErrors: {},
        publicFields: publicFormFields(),
        fieldIdsInForm: ['fld_form_email'],
        fieldIdsToSchemas: { fld_form_email: formSchema },
        formFieldIdsWithUnsavedChanges: [],
        urlPrefilledFieldIds: [],
        linkedRecordFieldIdToDetailFields: {},
    },
};
let formWritable = true;
let formCurrent = true;
const formFields = createFormFieldBindings({
    client,
    loaded: loadedForm,
    saveOptions: {
        captchaVal: null,
        isComputeMode: false,
        searchQuery: {},
        context: { type: 'direct-url' },
        conditionalLinkedRecordFieldIdsToFilteringValues: {},
        deviceFingerprint: { version: 1, visitorId: 'visitor_synthetic' },
    },
    getScope: () => ({ ownerId: 'synthetic-form', revision: 0 }),
    isCurrent: () => formCurrent,
    canWrite: () => formWritable,
});
const formBinding = formFields.field('fld_form_email');
const formHost = createFormFieldRendererHost({
    fields: formFields,
    fieldId: 'fld_form_email',
    isCurrent: () => formCurrent,
    configurationRevision: () => 0,
});
client.forms.save = async (input) => {
    // Explicit Form Save exercises the public binding/controller path. This
    // fixture does not create a FormPageOwner: its existing email validation
    // policy is separate and unchanged, and the local responder accepts text.
    receipt.formSavedValue = emailValue(input.formRecord.data.fld_form_email);
    receipt.formSaves++;
    emitReceipt();
    return {
        type: 'saved',
        record: {
            id: 'record_form_saved',
            fields: structuredClone(input.formRecord.data),
        },
        loggedInUserRecord: null,
        tableId: 'table_synthetic_form',
        context: { type: 'direct-url' },
        postSubmissionWarnings: [],
        postSubmissionNotifications: [],
    };
};
let lastFormValue = formBinding.getSnapshot().value;
formBinding.subscribe((snapshot) => {
    if (!snapshot.retired && snapshot.value !== lastFormValue) {
        lastFormValue = snapshot.value;
        receipt.formWrites++;
    }
    emitReceipt();
});
export const formOwner = {
    host: formHost,
    binding: formBinding,
    getValue: () => emailValue(formBinding.getSnapshot().value),
    valueText: () =>
        formCurrent
            ? JSON.stringify(emailValue(formBinding.getSnapshot().value))
            : 'Retired',
    subscribe: (listener: () => void) => formBinding.subscribe(listener),
    save: async () => {
        await formFields.save();
    },
    togglePermission: () => {
        formWritable = !formWritable;
        formFields.refresh();
    },
    // A separate application action replaces this owner's draft; it does not
    // install a new accepted load or reset the renderer's authority lease.
    replaceValue: () => {
        formBinding.setValue(' External@Example.TEST ');
    },
    retire: () => {
        formCurrent = false;
        formFields.destroy();
    },
};

const portal: PortalLoadedResult = {
    ...extension,
    extensionScreen: 'portal_loaded',
    payload: {
        ...sharedPayload,
        extensionType: 'portal',
        viewIdsToAirtableViews: {},
        publicFields: publicPortalFields(),
        formRecord: {
            type: 'edit',
            tableId: 'table_parent',
            recordId: 'record_parent',
            data: {},
        },
        fieldIdsToSchemas: Object.fromEntries(
            ['grid', 'list'].map((layout) => {
                const fieldId = `fld_${layout}_rows`;
                const schema: RuntimeFieldSchema = {
                    fieldType: 'multipleRecordLinks',
                    airtableField: {
                        id: fieldId,
                        name: `${layout} rows`,
                        description: null,
                        isComputed: false,
                        isPrimaryField: false,
                        config: {
                            type: 'multipleRecordLinks',
                            options: {
                                linkedTableId: `table_${layout}`,
                                isReversed: false,
                                prefersSingleRecordLink: false,
                            },
                        },
                    },
                    miniExtConfig: {
                        layout: layout as 'grid' | 'list',
                        allowEditingRecords: true,
                        formsForEditingAndCreating: 'same-form',
                        extensionIdForCreatingAndEditing:
                            'extension_synthetic_child',
                    },
                };
                return [fieldId, schema];
            })
        ),
        linkedRecordFieldIdToDetailFields: {},
        linkedRecordFieldIdToFieldsTitles: {},
        fieldIdsInPortal: ['fld_grid_rows', 'fld_list_rows'],
        usersTableFields: [],
        initialLinkedTableStates: {},
    },
};
const listPage = (kind: 'grid' | 'list'): ListPortalLinkedRecordsResult => {
    const schema = kind === 'grid' ? gridSchema : listSchema;
    const recordId = `record_${kind}`;
    const value = kind === 'grid' ? 'Grid@Example.TEST' : 'List@Example.TEST';
    return {
        airtableOffset: null,
        recordIds: [recordId],
        customViewDetailFields: {
            [`fld_${kind}_rows`]: [
                {
                    fieldId: schema.airtableField.id,
                    fieldName: schema.airtableField.name,
                    titleOverride: null,
                    isHidden: false,
                    fieldIsInEditingChildForm: true,
                    childFormField: null,
                    miniExtConfig: schema.miniExtConfig,
                },
            ],
        },
        tableIdsToLinkedTableStates: {
            [`table_${kind}`]: {
                airtableFields: [schema.airtableField],
                recordIdsToAirtableRecords: {
                    [recordId]: {
                        id: recordId,
                        fields: { [schema.airtableField.id]: value },
                    },
                },
            },
        },
    };
};
client.portals.listLinkedRecords = async (input) => {
    if (!['fld_grid_rows', 'fld_list_rows'].includes(input.portalFieldId))
        throw new Error('Unexpected synthetic Portal field.');
    receipt.portalReads++;
    emitReceipt();
    return listPage(input.portalFieldId === 'fld_grid_rows' ? 'grid' : 'list');
};
client.portals.updateGridCell = async (input) => {
    receipt.gridSavedValue = emailValue(input.value);
    receipt.gridSaves++;
    emitReceipt();
    return {
        auditTrail: null,
        auditTrails: [],
        record: {
            id: input.recordId,
            fields: { [input.recordFieldId]: input.value },
        },
    };
};
const makePortalOwner = (kind: 'grid' | 'list') =>
    createPortalListOwner({
        client,
        portal,
        portalFieldId: `fld_${kind}_rows`,
        criteria: {
            selectedCustomViewId: '',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: `synthetic-${kind}`, revision: 0 }),
    });
const gridListOwner = makePortalOwner('grid');
const detailListOwner = makePortalOwner('list');
let gridCell: ReturnType<typeof createPortalCellBinding>;
let gridHost: FieldRendererHost;
let listHost: FieldRendererHost;
export const gridOwner = {
    get host() {
        return gridHost;
    },
    get binding() {
        return gridCell.binding;
    },
    getValue: () => emailValue(gridCell.binding.getSnapshot().value),
    valueText: () =>
        JSON.stringify(emailValue(gridCell.binding.getSnapshot().value)),
    subscribe: (listener: () => void) => gridCell.binding.subscribe(listener),
    // The existing Grid cell permits one successful Save per accepted owner.
    save: async () => {
        await gridCell.save();
    },
};
export const listOwner = {
    get host() {
        return listHost;
    },
    getValue: () => {
        const records = detailListOwner.getRecords(
            detailListOwner.getSnapshot().revision
        );
        return emailValue(records?.records[0]?.fields.fld_list_email);
    },
    valueText: () => JSON.stringify(listOwner.getValue()),
    subscribe: (listener: () => void) => detailListOwner.subscribe(listener),
};
// Accept the two synthetic responses before rendering. These are public owner
// reads routed solely to memory above; fetch() always throws if invoked.
export const ready = (async () => {
    await Promise.all(
        [gridListOwner, detailListOwner].map(async (owner) => {
            const accepted = await owner.readFirst(
                owner.getSnapshot().revision,
                {
                    pagesToFetch: 1,
                    refreshLoggedInPortalRecord: false,
                }
            );
            if (!accepted)
                throw new Error('Synthetic Portal page was not accepted.');
        })
    );
    const gridRevision = gridListOwner.getSnapshot().revision;
    gridCell = createPortalCellBinding({
        client,
        input: {
            portalExtensionAccessToken: portal.payload.extensionAccessToken,
            portalFieldId: 'fld_grid_rows',
            recordId: 'record_grid',
            recordFieldId: 'fld_grid_email',
            selectedCustomViewId: '',
        },
        schema: gridSchema,
        value: 'Grid@Example.TEST',
        getScope: () => ({ ownerId: 'synthetic-grid', revision: 0 }),
        isCurrent: () => gridListOwner.isCurrent(gridRevision),
        recovery: {
            journal: new RecoveryJournal(),
            scope: {
                owner: 'synthetic-grid',
                parentFieldId: 'fld_grid_rows',
                tableId: 'table_grid',
                childExtensionId: '',
                context: 'modal',
            },
            loadVersion: 1,
        },
    });
    let lastGridValue = gridCell.binding.getSnapshot().value;
    gridCell.binding.subscribe((snapshot) => {
        if (!snapshot.retired && snapshot.value !== lastGridValue) {
            lastGridValue = snapshot.value;
            receipt.gridWrites++;
        }
        emitReceipt();
    });
    gridHost = createPortalCellRendererHost({
        owner: gridListOwner,
        cell: gridCell,
        client,
        recordId: 'record_grid',
        fieldId: 'fld_grid_email',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    listHost = createPortalDetailRendererHost({
        owner: detailListOwner,
        client,
        recordId: 'record_list',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
})();
