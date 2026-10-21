import {
    createElement as h,
    StrictMode,
    useState,
    useSyncExternalStore,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
    createFormFieldBindings,
    type FormFieldBinding,
} from '@miniextensions/sdk/forms';
import {
    createMiniExtensionsClient,
    type FormLoadedResult,
    type PortalLoadedResult,
    type RuntimeFieldSchema,
} from '@miniextensions/sdk';
import { createPortalListOwner } from '@miniextensions/sdk/portals';
import {
    createFormFieldRendererHost,
    createPortalDetailRendererHost,
    type FieldRendererHost,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import {
    LastModifiedTimeField,
    FieldRenderer,
    TextField,
    renderLastModifiedTimeField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/datetime.css';
import '@miniextensions/sdk/react/text.css';
import './styles.css';

// Synthetic local data only. Form uses the real read-only owner; Portal grid
// and list use accepted detail projections, never fabricated computed cells.
// Other cards isolate presentation states. Only the Text neighbor accepts edits.
const counts = {
    timestampWrites: 0,
    writes: 0,
    rowEvents: 0,
    saves: 0,
    requests: 0,
    portalReads: 0,
    formReads: 0,
    metadataStage: 0,
};
function increment(key: keyof typeof counts, id: string) {
    counts[key]++;
    const node = document.getElementById(id);
    if (node) node.textContent = String(counts[key]);
}
function store() {
    const listeners = new Set<() => void>();
    return {
        emit: () => {
            for (const listener of listeners) listener();
        },
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        dispose: () => listeners.clear(),
    };
}
type Config = FieldRendererProps<'lastModifiedTime'>['displayConfig'];
type ResultConfig =
    FieldRendererProps<'lastModifiedTime'>['field']['config']['options']['result'];
const dateResult: ResultConfig = {
    type: 'date',
    options: { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } },
};
const dateTimeResult: ResultConfig = {
    type: 'dateTime',
    options: {
        dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
        timeFormat: { name: '24hour', format: 'HH:mm' },
        timeZone: 'utc',
    },
};
function makeTimestamp(
    title: string,
    initial: unknown,
    options: {
        display?: Config;
        write?: Config;
        pending?: boolean;
        error?: string;
        fieldName?: string;
        masked?: boolean;
        result?: ResultConfig;
        validity?: unknown;
    } = {}
) {
    let value = initial,
        hidden = false,
        retired = false,
        revision = 0;
    const state = store();
    // Only the malformed-metadata cards bypass the TypeScript contract here;
    // real Form and Portal fixtures below always use accepted boolean metadata.
    const config = {
        type: 'lastModifiedTime',
        options: {
            isValid: Object.hasOwn(options, 'validity')
                ? options.validity
                : true,
            result: options.result ?? dateTimeResult,
            referencedFieldIds: ['fld_unread_reference'],
        },
    } as FieldRendererProps<'lastModifiedTime'>['field']['config'];
    const field = {
        id: 'fld_repeated_timestamp',
        name: options.fieldName ?? title,
        description: null,
        isComputed: true,
        isPrimaryField: false,
        config,
    };
    const host: FieldRendererHost = {
        getSnapshot: () =>
            retired
                ? { status: 'retired', reason: 'Synthetic owner retired.' }
                : hidden
                  ? { status: 'hidden', reason: 'Synthetic owner hidden.' }
                  : {
                        status: 'ready',
                        fields: [
                            {
                                physicalKind: 'lastModifiedTime',
                                presentation: {
                                    type: 'physical',
                                    config: field.config,
                                },
                                fieldId: field.id,
                                title,
                                field,
                                displayConfig: options.display ?? {},
                                writeConfig: options.write ?? {},
                                value: value as FieldRendererProps<'lastModifiedTime'>['value'],
                                context: 'portal-detail',
                                computed: true,
                                dirty: false,
                                pending: !!options.pending,
                                error: options.error ?? null,
                                validation: [],
                                capability: { type: 'readonly' },
                            },
                        ],
                    },
        subscribe: (listener) =>
            state.subscribe(() => listener(host.getSnapshot())),
        dispose: state.dispose,
    };
    const binding: FormFieldBinding = {
        getSnapshot: () => ({
            field: {
                fieldId: field.id,
                title,
                fieldType: 'lastModifiedTime',
                isComputed: true,
                readOnly: true,
                schema: {
                    fieldType: 'lastModifiedTime',
                    airtableField: field,
                    miniExtConfig: { ...options.display, ...options.write },
                },
            },
            value: value as ReturnType<
                FormFieldBinding['getSnapshot']
            >['value'],
            dirty: false,
            revision,
            visibility: {
                type: hidden ? 'hidden' : 'visible',
                diagnostics: [],
            },
            readOnly: true,
            canEdit: false,
            pending: !!options.pending,
            error: options.error ?? null,
            validation: [],
            scalar: null,
            selection: null,
            date: null,
            retired,
        }),
        subscribe: (listener) =>
            state.subscribe(() => listener(binding.getSnapshot())),
        setValue: () => {
            increment('timestampWrites', 'timestamp-writes');
            return { accepted: false, reason: 'readonly' };
        },
        scalar: null,
        selection: null,
        date: null,
    };
    return {
        host,
        binding,
        subscribe: state.subscribe,
        nativeText: () =>
            retired
                ? 'Retired'
                : hidden
                  ? 'Hidden'
                  : options.masked
                    ? 'Masked'
                    : value === undefined
                      ? 'Missing'
                      : describe(value),
        nativeValue: () => value,
        replaceWith: (next: unknown) => {
            value = next;
            revision++;
            state.emit();
        },
        replace: () => {
            value = '2024-11-03T01:30:00.123456789-04:00';
            revision++;
            state.emit();
        },
        toggleHidden: () => {
            hidden = !hidden;
            state.emit();
        },
        retire: () => {
            retired = true;
            state.emit();
        },
    };
}
function makeText(title: string, initial: string, error: string | null = null) {
    let value: string | null = initial,
        revision = 0;
    const state = store();
    const field = {
        id: 'fld_neighbor',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'singleLineText' as const, options: null },
    };
    const binding: FormFieldBinding = {
        getSnapshot: () => ({
            field: {
                fieldId: field.id,
                title,
                fieldType: 'singleLineText',
                isComputed: false,
                readOnly: false,
                schema: {
                    fieldType: 'singleLineText',
                    airtableField: field,
                    miniExtConfig: {},
                },
            },
            value,
            dirty: value !== initial,
            revision,
            visibility: { type: 'visible', diagnostics: [] },
            readOnly: false,
            canEdit: true,
            pending: false,
            error,
            validation: [],
            scalar: null,
            selection: null,
            date: null,
            retired: false,
        }),
        subscribe: (listener) =>
            state.subscribe(() => listener(binding.getSnapshot())),
        setValue: (next) => {
            if (next !== null && typeof next !== 'string')
                return { accepted: false, reason: 'readonly' };
            value = next;
            revision++;
            increment('writes', 'writes');
            state.emit();
            return { accepted: true };
        },
        scalar: null,
        selection: null,
        date: null,
    };
    return {
        binding,
        subscribe: state.subscribe,
        nativeText: () => JSON.stringify(value),
        nativeValue: () => value,
    };
}

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

const syntheticForm: FormLoadedResult = {
    extensionScreen: 'form_loaded',
    extensionId: 'extension_example',
    language: 'en',
    themeColor: 'blue',
    enableCommentsOnChildForms: false,
    workspaceId: 'workspace_example',
    extensionOwnerUID: 'owner_example',
    faviconUrl: null,
    googleAnalyticsMeasurementId: null,
    isStarterExtension: false,
    publishedVersionId: 'version_example',
    payload: {
        extensionType: 'form',
        extensionAccessToken: 'access_example',
        extensionName: 'Example form',
        hasParentExtension: false,
        formRecord: { type: 'create', data: { fld_title: 'Example' } },
        formErrors: {},
        publicFields: publicFormFields(),
        fieldIdsInForm: ['fld_title'],
        fieldNamesToSchemas: {},
        fieldIdsToSchemas: {},
        formFieldIdsWithUnsavedChanges: [],
        urlPrefilledFieldIds: [],
        linkedRecordFieldIdToDetailFields: {},
        cookieKeyForLoginToken: null,
        baseId: 'base_example',
        loggedInUserCanEditExtension: false,
        showMiniExtensionsBranding: true,
        onFreePlan: true,
        trialExpiresAtUnixEpoch: null,
    },
};

const cleanup: (() => void)[] = [];
const client = createMiniExtensionsClient({
    apiOrigin: 'https://synthetic.invalid',
    fetch: async () => {
        increment('requests', 'requests');
        throw Error('No network is connected.');
    },
});
client.forms.save = async () => {
    increment('saves', 'saves');
    throw Error('No Save is connected.');
};
client.portals.updateGridCell = async () => {
    increment('saves', 'saves');
    throw Error('No mutation is connected.');
};
function schema(
    title: string,
    computed = true,
    result: ResultConfig = dateTimeResult
): Extract<RuntimeFieldSchema, { fieldType: 'lastModifiedTime' }> {
    return {
        fieldType: 'lastModifiedTime',
        airtableField: {
            id: 'fld_timestamp',
            name: title,
            description: null,
            isComputed: computed,
            isPrimaryField: false,
            config: {
                type: 'lastModifiedTime',
                options: {
                    isValid: true,
                    result,
                    referencedFieldIds: ['fld_unread_reference'],
                },
            },
        },
        miniExtConfig: {},
    };
}
function makeFormTimestamp(computed = true) {
    const title = computed ? 'Bound timestamp' : 'Noncomputed timestamp';
    const value = computed ? '2024-11-03T01:30:00' : '2026-10-14T09:30:00.120Z';
    let current = true;
    let metadataStage = 0;
    const currentness = store();
    const loaded = structuredClone(syntheticForm);
    loaded.payload.fieldIdsInForm = ['fld_timestamp'];
    loaded.payload.fieldIdsToSchemas = {
        fld_timestamp: schema(title, computed),
    };
    loaded.payload.formRecord = {
        type: 'create',
        data: { fld_timestamp: value },
    };
    const owner = createFormFieldBindings({
        loaded,
        client,
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
            deviceFingerprint: { version: 1, visitorId: 'synthetic_timestamp' },
        },
        getScope: () => ({ ownerId: 'timestamp_form', revision: 0 }),
    });
    let binding: FormFieldBinding;
    let host: FieldRendererHost;
    function acceptBinding() {
        binding = owner.field('fld_timestamp');
        const setValue = binding.setValue;
        binding.setValue = (next) => {
            increment('timestampWrites', 'timestamp-writes');
            return setValue(next);
        };
        const realHost = createFormFieldRendererHost({
            fields: owner,
            fieldId: 'fld_timestamp',
            isCurrent: () => current,
            configurationRevision: () => 0,
        });
        host = {
            ...realHost,
            subscribe: (listener) => {
                const offHost = realHost.subscribe(listener);
                const offCurrent = currentness.subscribe(() =>
                    listener(realHost.getSnapshot())
                );
                return () => {
                    offHost();
                    offCurrent();
                };
            },
        };
        if (
            binding.scalar !== null ||
            binding.date !== null ||
            binding.getSnapshot().canEdit ||
            !binding.getSnapshot().readOnly
        )
            throw Error(
                'Last Modified Time must be read only by physical kind.'
            );
        if (host.getSnapshot().status !== 'ready')
            throw Error('The real Form host must accept Last Modified Time.');
    }
    acceptBinding();
    cleanup.push(() => {
        host.dispose();
        owner.destroy();
    });
    return {
        get binding() {
            return binding;
        },
        get host() {
            return host;
        },
        get admission() {
            return host.getSnapshot().status;
        },
        get ownerCanEdit() {
            return binding.getSnapshot().canEdit;
        },
        subscribe: (listener: () => void) => {
            const offBinding = binding.subscribe(listener);
            const offCurrent = currentness.subscribe(listener);
            return () => {
                offBinding();
                offCurrent();
            };
        },
        nativeText: () =>
            current ? describe(binding.getSnapshot().value) : 'Stale',
        nativeValue: () => binding.getSnapshot().value,
        retireCurrent: () => {
            current = false;
            currentness.emit();
        },
        cycleMetadata: async () => {
            if (metadataStage >= 2) return;
            const nextStage = metadataStage + 1;
            const fresh = owner.getLoaded();
            const field = fresh.payload.fieldIdsToSchemas.fld_timestamp;
            if (field.fieldType !== 'lastModifiedTime')
                throw Error('Unexpected physical kind.');
            field.airtableField.config.options = {
                isValid: nextStage !== 1,
                result: nextStage === 2 ? dateResult : dateTimeResult,
                referencedFieldIds:
                    nextStage === 2 ? [] : ['fld_unread_replacement'],
            };
            // A local accepted read replaces metadata, not the native value.
            // The owner retires old bindings; the application accepts a fresh
            // binding/host after reload instead of resurrecting a stale host.
            const accepted = await owner.reload({
                dirty: 'keep',
                read: async () => {
                    increment('formReads', 'form-reads');
                    return fresh;
                },
            });
            if (!accepted)
                throw Error('Synthetic metadata reload was refused.');
            host.dispose();
            acceptBinding();
            metadataStage = nextStage;
            increment('metadataStage', 'metadata-stage');
            currentness.emit();
        },
    };
}
async function makePortalTimestamp(
    layout: 'grid' | 'list',
    title: string,
    value: string,
    result: ResultConfig = dateTimeResult
) {
    const field = schema(title, true, result).airtableField;
    const portal: PortalLoadedResult = {
        ...structuredClone(syntheticForm),
        extensionScreen: 'portal_loaded',
        payload: {
            extensionType: 'portal',
            extensionName: 'Synthetic Timestamp Portal',
            extensionAccessToken: 'synthetic_portal',
            baseId: 'synthetic_base',
            loggedInUserCanEditExtension: false,
            showMiniExtensionsBranding: true,
            onFreePlan: false,
            trialExpiresAtUnixEpoch: null,
            viewIdsToAirtableViews: {},
            publicFields: publicPortalFields(),
            formRecord: {
                type: 'edit',
                tableId: 'table_parent',
                recordId: 'record_parent',
                data: {},
            },
            fieldNamesToSchemas: {},
            fieldIdsToSchemas: {
                fld_related: {
                    fieldType: 'multipleRecordLinks',
                    airtableField: {
                        id: 'fld_related',
                        name: 'Related',
                        description: null,
                        isComputed: false,
                        isPrimaryField: false,
                        config: {
                            type: 'multipleRecordLinks',
                            options: {
                                linkedTableId: 'table_timestamps',
                                inverseLinkFieldId: 'fld_parent',
                                isReversed: false,
                                prefersSingleRecordLink: false,
                            },
                        },
                    },
                    miniExtConfig: {
                        layout,
                        disableInlineEdit: false,
                        customViews: [
                            {
                                id: 'view_timestamp',
                                config: { name: 'Timestamps' },
                            },
                        ],
                    },
                },
            },
            linkedRecordFieldIdToDetailFields: {},
            linkedRecordFieldIdToFieldsTitles: {},
            cookieKeyForLoginToken: null,
            fieldIdsInPortal: ['fld_related'],
            usersTableFields: [],
            initialLinkedTableStates: {},
        },
    };
    // The existing list owner accepts this local projection exactly once. No fetch.
    client.portals.listLinkedRecords = async () => {
        increment('portalReads', 'portal-reads');
        return {
            airtableOffset: null,
            recordIds: ['record_timestamp'],
            customViewDetailFields: {
                fld_related: [
                    {
                        fieldId: field.id,
                        fieldName: field.name,
                        titleOverride: '',
                        isHidden: false,
                        fieldIsInEditingChildForm: false,
                        childFormField: null,
                        miniExtConfig: {},
                    },
                ],
            },
            tableIdsToLinkedTableStates: {
                table_timestamps: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        record_timestamp: {
                            id: 'record_timestamp',
                            fields: { fld_timestamp: value },
                        },
                    },
                },
            },
        };
    };
    const owner = createPortalListOwner({
        client,
        portal,
        portalFieldId: 'fld_related',
        criteria: {
            selectedCustomViewId: 'view_timestamp',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: `timestamp_${layout}`, revision: 0 }),
    });
    await owner.readFirst(owner.getSnapshot().revision, {
        pagesToFetch: 1,
        refreshLoggedInPortalRecord: false,
    });
    const host = createPortalDetailRendererHost({
        owner,
        client,
        recordId: 'record_timestamp',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const snapshot = host.getSnapshot();
    if (
        snapshot.status !== 'ready' ||
        snapshot.fields[0]?.physicalKind !== 'lastModifiedTime' ||
        snapshot.fields[0].capability.type !== 'readonly'
    )
        throw Error('Timestamp detail must be read only.');
    cleanup.push(() => {
        host.dispose();
        owner.destroy();
    });
    return {
        host,
        binding: undefined,
        subscribe: (listener: () => void) => host.subscribe(listener),
        nativeText: () => describe(value),
        nativeValue: () => {
            const snapshot = host.getSnapshot();
            return snapshot.status === 'ready'
                ? snapshot.fields[0]?.value
                : undefined;
        },
    };
}
window.addEventListener(
    'pagehide',
    () => cleanup.forEach((dispose) => dispose()),
    { once: true }
);

function describe(value: unknown): string {
    if (value === undefined) return 'Missing';
    return JSON.stringify(value);
}
const acceptedTimestamp = makeTimestamp(
    'Native timestamp',
    '2024-02-29T12:30:45.007+05:45'
);
const lifecycle = makeTimestamp('Lifecycle timestamp', '2020-01-01T00:00:00Z');
const neighbor = makeText('Editable neighbor', 'Text draft');
const wrong = makeText(
    'Other field kind',
    'PRIVATE_TIMESTAMP_WRONG_KIND',
    'Not a Last Modified Time binding.'
);
const noncomputed = makeFormTimestamp(false);
const acceptedForm = makeFormTimestamp();
const raw = makeTimestamp('Raw string', 'not a timestamp', {
    result: dateResult,
});
const rawValues = [
    '2024-02-30T25:61:61Z',
    '2024-11-03T01:30:00',
    '  2024-02-29T12:30:45.007+05:45  ',
    '日本語 🕰️',
    'https://example.invalid/raw-time',
    '2024-02-29T12:30:45.123456789-00:30',
    '2024-01-01\r\nT12:00:00Z',
];
let rawIndex = 0;
const cards = [
    {
        heading: 'The native timestamp',
        note: 'Seconds, fractions and the explicit offset stay exactly as supplied.',
        owner: acceptedTimestamp,
        slot: true,
    },
    {
        heading: 'Real Form binding',
        note: 'The Form owner stays read only. No date editor or parsing model is borrowed.',
        owner: acceptedForm,
    },
    {
        heading: 'Markup stays text',
        note: 'Even a malformed timestamp is plain text, never HTML or executable content.',
        owner: makeTimestamp(
            'Literal markup',
            '<script>window.timestampInjection = true</script>'
        ),
        slot: true,
    },
    {
        heading: 'Portal grid detail',
        note: 'The accepted detail owner preserves the supplied daylight-saving offset.',
        owner: await makePortalTimestamp(
            'grid',
            'Grid timestamp',
            '2024-11-03T01:30:00.120-04:00'
        ),
        slot: true,
    },
    {
        heading: 'No timestamp yet',
        note: 'Null stays blank. The renderer does not create or infer a timestamp.',
        owner: makeTimestamp('Empty timestamp', null),
    },
    {
        heading: 'Missing snapshot value',
        note: 'Missing stays blank without adding a native property.',
        owner: makeTimestamp('Missing timestamp', undefined),
        slot: true,
    },
    {
        heading: 'Display masking',
        note: 'Display configuration masks the timestamp and its native readout.',
        owner: makeTimestamp('Display mask', 'DISPLAY_PRIVATE_TIMESTAMP', {
            display: { maskPasswordOnLoginScreen: true },
            masked: true,
        }),
        slot: true,
    },
    {
        heading: 'Write configuration masking',
        note: 'Either configuration can mask a read-only timestamp.',
        owner: makeTimestamp('Write mask', 'WRITE_PRIVATE_TIMESTAMP', {
            write: { maskPasswordOnLoginScreen: true },
            masked: true,
        }),
        slot: true,
    },
    {
        heading: 'Pending owner',
        note: 'Busy state stays visible while input and Clear remain disabled.',
        owner: makeTimestamp('Pending timestamp', '2025-01-01T01:02:03Z', {
            pending: true,
        }),
    },
    {
        heading: 'Owner feedback',
        note: 'Supplied feedback stays associated with the disabled control.',
        owner: makeTimestamp('Feedback timestamp', '2025-02-03T04:05:06.123Z', {
            error: 'Synthetic read-only feedback.',
        }),
        slot: true,
    },
    {
        heading: 'Accessible hidden title',
        note: 'The visual label is hidden while the accessible name remains.',
        owner: makeTimestamp('Hidden title', '2025-03-04T05:06:07+00:00', {
            display: { showTitle: false },
        }),
        slot: true,
    },
    {
        heading: 'Portal list with date metadata',
        note: 'Nested date metadata does not truncate, parse or format the native string.',
        owner: await makePortalTimestamp(
            'list',
            'Fallback timestamp',
            '2024-02-29T12:30:45.123456789+05:45',
            dateResult
        ),
        slot: true,
    },
    {
        heading: 'Editable Text neighbor',
        note: 'This separate Text binding accepts edits, composition and Clear.',
        owner: neighbor,
        text: true,
    },
    {
        heading: 'Wrong physical binding',
        note: 'The Last Modified Time wrapper refuses another physical kind.',
        owner: wrong,
        wrong: true,
    },
    {
        heading: 'Application override',
        note: 'Custom rendering takes precedence, including wrong-kind bindings.',
        owner: wrong,
        custom: true,
    },
    {
        heading: 'Owner lifecycle',
        note: 'Retirement removes the input, disabled Clear and readout.',
        owner: lifecycle,
    },
    {
        heading: 'Read only by physical kind',
        note: 'Even isComputed: false stays read only. A host that loses currentness stays retired.',
        owner: noncomputed,
        slot: true,
    },
    {
        heading: 'An empty string stays empty',
        note: 'The empty string stays distinct from null in the native owner.',
        owner: makeTimestamp('Blank timestamp', ''),
    },
    {
        heading: 'Raw strings, without interpretation',
        note: 'Cycle malformed, naive, Unicode and fractional strings. No validation or timezone is inferred.',
        owner: raw,
    },
    {
        heading: 'Native line breaks stay intact',
        note: 'The browser strips line breaks from a single-line input; the native string keeps every byte.',
        owner: makeTimestamp('Native line breaks', '2024-01-01\r\nT12:00:00Z'),
    },
    {
        heading: 'Invalid metadata stays blank',
        note: 'isValid: false hides the presentation and preserves the supplied native string.',
        owner: makeTimestamp(
            'Invalid metadata',
            'PRESERVED_INVALID_TIMESTAMP',
            { validity: false }
        ),
        slot: true,
    },
    {
        heading: 'Missing validity stays blank',
        note: 'This malformed binding fixture probes the helper boundary; it is not accepted owner metadata.',
        owner: makeTimestamp('Missing validity', 'PRESERVED_MISSING_VALIDITY', {
            validity: undefined,
        }),
    },
    {
        heading: 'Nonstrings stay native',
        note: 'A numeric owner value displays blank without coercion, repair or replacement.',
        owner: makeTimestamp('Nonstring value', 42),
    },
    {
        heading: 'Only true means valid',
        note: 'This malformed binding supplies the string "true"; truthiness does not grant presentation.',
        owner: makeTimestamp(
            'Nonboolean validity',
            'PRESERVED_NONBOOLEAN_VALIDITY',
            { validity: 'true' }
        ),
    },
];
// Read-only observation captures exact native strings, including CR/LF, separately
// from single-line DOM input values. Masked native readouts stay out of the page.
Object.assign(window, {
    __lastModifiedTimeProof: {
        read: (index: number) =>
            structuredClone(cards[index].owner.nativeValue()),
        readAll: () =>
            cards.map((card) => structuredClone(card.owner.nativeValue())),
    },
});
function Card({ index }: { index: number }) {
    const card = cards[index];
    const native = useSyncExternalStore(
        card.owner.subscribe,
        card.owner.nativeText
    );
    return h(
        'section',
        {
            className: 'card',
            id: `card-${index}`,
            'data-owner-admission':
                'admission' in card.owner ? card.owner.admission : undefined,
            'data-owner-can-edit':
                'ownerCanEdit' in card.owner
                    ? String(card.owner.ownerCanEdit)
                    : undefined,
            onClick: () => increment('rowEvents', 'row-events'),
            onPointerDown: () => increment('rowEvents', 'row-events'),
            onKeyDown: () => increment('rowEvents', 'row-events'),
        },
        h(
            'p',
            { className: 'card-number' },
            String(index + 1).padStart(2, '0')
        ),
        h('h2', null, card.heading),
        h('p', { className: 'note' }, card.note),
        card.custom
            ? h(LastModifiedTimeField, {
                  binding: card.owner.binding!,
                  render: () =>
                      h(
                          'p',
                          { role: 'status' },
                          'Application-owned read-only presentation.'
                      ),
              })
            : card.text
              ? h(TextField, { binding: card.owner.binding! })
              : card.slot && 'host' in card.owner
                ? h(FieldRenderer, {
                      host: card.owner.host!,
                      renderers: {
                          renderLastModifiedTimeField: (props) =>
                              renderLastModifiedTimeField(props, {
                                  className: 'custom-timestamp',
                                  clearLabel: 'Clear read-only timestamp',
                              }),
                      },
                  })
                : h(LastModifiedTimeField, { binding: card.owner.binding! }),
        h(
            'p',
            { className: 'native' },
            'Native snapshot: ',
            h(
                'code',
                { id: `native-${index}` },
                card.wrong || card.custom ? 'Unavailable' : native
            )
        )
    );
}
function App() {
    const [mount, setMount] = useState(0);
    return h(
        'main',
        null,
        h('p', { className: 'eyebrow' }, 'miniExtensions SDK · React'),
        h('h1', null, 'Last modified. Never rewritten.'),
        h(
            'p',
            { className: 'intro' },
            'Last Modified Time appears only when its metadata is valid. Form and Portal owners keep the exact native value, with no parsing, clock or timezone calculations.'
        ),
        h(
            'div',
            { className: 'toolbar' },
            h(
                'button',
                {
                    type: 'button',
                    onClick: () => {
                        raw.replaceWith(rawValues[rawIndex % rawValues.length]);
                        rawIndex++;
                    },
                },
                'Cycle raw value'
            ),
            h(
                'button',
                { type: 'button', onClick: acceptedTimestamp.replace },
                'Replace timestamp value'
            ),
            h(
                'button',
                { type: 'button', onClick: () => setMount(mount + 1) },
                'Remount controls'
            ),
            h(
                'button',
                { type: 'button', onClick: acceptedTimestamp.toggleHidden },
                'Toggle timestamp visibility'
            ),
            h(
                'button',
                { type: 'button', onClick: noncomputed.retireCurrent },
                'Retire Form host'
            ),
            h(
                'button',
                {
                    type: 'button',
                    onClick: async () => {
                        await acceptedForm.cycleMetadata();
                        setMount((value) => value + 1);
                    },
                },
                'Cycle accepted metadata'
            ),
            h(
                'button',
                { type: 'button', onClick: lifecycle.retire },
                'Retire lifecycle binding'
            )
        ),
        h(
            'div',
            { className: 'cards', key: mount },
            cards.map((_, index) => h(Card, { key: index, index }))
        ),
        h(
            'footer',
            null,
            h(
                'span',
                null,
                'Timestamp setter calls: ',
                h(
                    'b',
                    { id: 'timestamp-writes' },
                    String(counts.timestampWrites)
                )
            ),
            h(
                'span',
                null,
                'Text writes: ',
                h('b', { id: 'writes' }, String(counts.writes))
            ),
            h(
                'span',
                null,
                'Save calls: ',
                h('b', { id: 'saves' }, String(counts.saves))
            ),
            h(
                'span',
                null,
                'Local Portal reads: ',
                h('b', { id: 'portal-reads' }, String(counts.portalReads))
            ),
            h(
                'span',
                null,
                'Local Form reads: ',
                h('b', { id: 'form-reads' }, String(counts.formReads))
            ),
            h(
                'span',
                null,
                'Metadata stage: ',
                h('b', { id: 'metadata-stage' }, String(counts.metadataStage))
            ),
            h(
                'span',
                null,
                'External transport: ',
                h('b', { id: 'requests' }, String(counts.requests))
            ),
            h(
                'span',
                null,
                'Parent row events: ',
                h('b', { id: 'row-events' }, String(counts.rowEvents))
            )
        )
    );
}
createRoot(document.getElementById('app')!).render(h(StrictMode, null, h(App)));
