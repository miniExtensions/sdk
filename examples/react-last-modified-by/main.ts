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
    LastModifiedByField,
    FieldRenderer,
    TextField,
    renderLastModifiedByField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/text.css';
import './styles.css';

// Synthetic local data only. Form uses the real read-only owner; Portal grid
// and list use accepted detail projections, never fabricated computed cells.
// Other cards isolate presentation states. Only the Text neighbor accepts edits.
const counts = {
    modifierWrites: 0,
    writes: 0,
    rowEvents: 0,
    saves: 0,
    requests: 0,
    portalReads: 0,
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
type Config = FieldRendererProps<'lastModifiedBy'>['displayConfig'];
function makeModifier(
    title: string,
    initial: unknown,
    options: {
        display?: Config;
        write?: Config;
        pending?: boolean;
        error?: string;
        fieldName?: string;
        masked?: boolean;
    } = {}
) {
    let value = initial,
        hidden = false,
        retired = false,
        revision = 0;
    const state = store();
    const field = {
        id: 'fld_repeated_modifier',
        name: options.fieldName ?? title,
        description: null,
        isComputed: true,
        isPrimaryField: false,
        config: {
            type: 'lastModifiedBy' as const,
            options: {
                choices: [
                    collaborator('PRIVATE_MODIFIER_METADATA_NAME', 'blank'),
                ],
            },
        },
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
                                physicalKind: 'lastModifiedBy',
                                presentation: {
                                    type: 'physical',
                                    config: field.config,
                                },
                                fieldId: field.id,
                                title,
                                field,
                                displayConfig: options.display ?? {},
                                writeConfig: options.write ?? {},
                                value: value as FieldRendererProps<'lastModifiedBy'>['value'],
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
                fieldType: 'lastModifiedBy',
                isComputed: true,
                readOnly: true,
                schema: {
                    fieldType: 'lastModifiedBy',
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
            increment('modifierWrites', 'modifier-writes');
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
            value = collaborator('Replacement modifier', 'replacement');
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
    computed = true
): Extract<RuntimeFieldSchema, { fieldType: 'lastModifiedBy' }> {
    return {
        fieldType: 'lastModifiedBy',
        airtableField: {
            id: 'fld_modifier',
            name: title,
            description: null,
            isComputed: computed,
            isPrimaryField: false,
            config: {
                type: 'lastModifiedBy',
                options: {
                    choices: [
                        collaborator('PRIVATE_MODIFIER_METADATA_NAME', 'blank'),
                    ],
                },
            },
        },
        miniExtConfig: {},
    };
}
function makeFormModifier(computed = true) {
    const title = computed ? 'Bound modifier' : 'Noncomputed modifier';
    const value = collaborator(
        computed ? 'Form modifier' : 'Noncomputed modifier',
        computed ? 'form' : 'noncomputed'
    );
    let current = true;
    const currentness = store();
    const loaded = structuredClone(syntheticForm);
    loaded.payload.fieldIdsInForm = ['fld_modifier'];
    loaded.payload.fieldIdsToSchemas = {
        fld_modifier: schema(title, computed),
    };
    loaded.payload.formRecord = {
        type: 'create',
        data: { fld_modifier: value },
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
            deviceFingerprint: { version: 1, visitorId: 'synthetic_modifier' },
        },
        getScope: () => ({ ownerId: 'modifier_form', revision: 0 }),
    });
    const binding = owner.field('fld_modifier');
    const setValue = binding.setValue;
    binding.setValue = (value) => {
        increment('modifierWrites', 'modifier-writes');
        return setValue(value);
    };
    const realHost = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'fld_modifier',
        isCurrent: () => current,
        configurationRevision: () => 0,
    });
    const host: FieldRendererHost = {
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
        binding.getSnapshot().canEdit ||
        !binding.getSnapshot().readOnly
    )
        throw Error('Last Modified By must be read only by physical kind.');
    if (host.getSnapshot().status !== 'ready')
        throw Error('The real Form host must accept Last Modified By.');
    cleanup.push(() => {
        host.dispose();
        owner.destroy();
    });
    return {
        binding,
        host,
        get admission() {
            return host.getSnapshot().status;
        },
        ownerCanEdit: binding.getSnapshot().canEdit,
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
    };
}
async function makePortalModifier(
    layout: 'grid' | 'list',
    title: string,
    value: ReturnType<typeof collaborator>
) {
    const field = schema(title).airtableField;
    const portal: PortalLoadedResult = {
        ...structuredClone(syntheticForm),
        extensionScreen: 'portal_loaded',
        payload: {
            extensionType: 'portal',
            extensionName: 'Synthetic Modifier Portal',
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
                                linkedTableId: 'table_modifiers',
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
                                id: 'view_modifier',
                                config: { name: 'Modifiers' },
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
            recordIds: ['record_modifier'],
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
                table_modifiers: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        record_modifier: {
                            id: 'record_modifier',
                            fields: { fld_modifier: value },
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
            selectedCustomViewId: 'view_modifier',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: `modifier_${layout}`, revision: 0 }),
    });
    await owner.readFirst(owner.getSnapshot().revision, {
        pagesToFetch: 1,
        refreshLoggedInPortalRecord: false,
    });
    const host = createPortalDetailRendererHost({
        owner,
        client,
        recordId: 'record_modifier',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const snapshot = host.getSnapshot();
    if (
        snapshot.status !== 'ready' ||
        snapshot.fields[0]?.physicalKind !== 'lastModifiedBy' ||
        snapshot.fields[0].capability.type !== 'readonly'
    )
        throw Error('Modifier detail must be read only.');
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

function collaborator(name: string, key: string) {
    return {
        id: `PRIVATE_MODIFIER_ID_${key}`,
        email: `PRIVATE_MODIFIER_EMAIL_${key}@example.invalid`,
        name,
        profilePicUrl: `https://example.invalid/PRIVATE_MODIFIER_AVATAR_${key}.png`,
        privateNote: { token: `PRIVATE_MODIFIER_EXTRA_${key}` },
    };
}
function describe(value: unknown): string {
    if (value === undefined) return 'Missing';
    if (value === null) return 'null';
    return typeof value === 'object'
        ? 'Object preserved'
        : 'Invalid shape preserved';
}
const acceptedModifier = makeModifier(
    'Native modifier',
    collaborator('  Ada 日本語 👩🏽‍💻  ', 'native')
);
const lifecycle = makeModifier(
    'Lifecycle modifier',
    collaborator('Retirable modifier', 'lifecycle')
);
const neighbor = makeText('Editable neighbor', 'Text draft');
// A Created By value has the same native object shape, but it is a different
// physical kind. Neither structural similarity nor a custom renderer grants edits.
const wrong = makeModifier(
    'Created By binding',
    collaborator('PRIVATE_MODIFIER_WRONG_KIND', 'wrong-kind')
);
const wrongSnapshot = wrong.binding.getSnapshot;
wrong.binding.getSnapshot = () => {
    const snapshot = wrongSnapshot();
    return {
        ...snapshot,
        field: snapshot.field
            ? {
                  ...snapshot.field,
                  fieldType: 'createdBy',
                  schema: {
                      fieldType: 'createdBy',
                      airtableField: {
                          ...snapshot.field.schema.airtableField,
                          config: {
                              type: 'createdBy',
                              options: { choices: [] },
                          },
                      },
                      miniExtConfig: {},
                  },
              }
            : null,
    };
};
const noncomputed = makeFormModifier(false);
const malformed = makeModifier('Malformed value', 'not a collaborator');
const malformedValues: unknown[] = [
    'PRIVATE_MODIFIER_RAW_STRING',
    {
        id: 'PRIVATE_MODIFIER_ID_MISSING',
        email: 'PRIVATE_MODIFIER_EMAIL_MISSING@example.invalid',
    },
    {
        id: 7,
        email: 'PRIVATE_MODIFIER_EMAIL_BAD_ID@example.invalid',
        name: 'Do not display bad ID',
    },
    {
        id: 'PRIVATE_MODIFIER_ID_BAD_EMAIL',
        email: null,
        name: 'Do not display bad email',
    },
    {
        id: 'PRIVATE_MODIFIER_ID_BAD_NAME',
        email: 'PRIVATE_MODIFIER_EMAIL_BAD_NAME@example.invalid',
        name: 42,
    },
    {
        ...collaborator('Do not display bad avatar', 'bad-avatar'),
        profilePicUrl: null,
    },
    [collaborator('Do not display array', 'array')],
];
let malformedIndex = 0;
const cards = [
    {
        heading: 'A name, exactly as supplied',
        note: 'Spaces and Unicode stay intact. Identity fields stay in the native object.',
        owner: acceptedModifier,
        slot: true,
    },
    {
        heading: 'Real Form binding',
        note: 'The Form owner exposes the modifier as read only, with no scalar editor.',
        owner: makeFormModifier(),
    },
    {
        heading: 'Markup stays text',
        note: 'The supplied name never becomes HTML or executable content.',
        owner: makeModifier(
            'Literal markup',
            collaborator(
                '<script>window.modifierInjection = true</script>',
                'markup'
            )
        ),
        slot: true,
    },
    {
        heading: 'Portal grid detail',
        note: 'An accepted grid detail projection displays a URL-shaped name as plain text.',
        owner: await makePortalModifier(
            'grid',
            'Grid modifier',
            collaborator('https://example.invalid/modifier?x=1', 'grid')
        ),
        slot: true,
    },
    {
        heading: 'No modifier yet',
        note: 'Null stays blank. No identity is resolved or fetched.',
        owner: makeModifier('Empty modifier', null),
    },
    {
        heading: 'Missing snapshot value',
        note: 'Missing stays blank without adding a native property.',
        owner: makeModifier('Missing modifier', undefined),
        slot: true,
    },
    {
        heading: 'Display masking',
        note: 'The display configuration masks the name; private identity fields stay out of the page.',
        owner: makeModifier(
            'Display mask',
            collaborator('DISPLAY_PRIVATE_MODIFIER', 'display-mask'),
            { display: { maskPasswordOnLoginScreen: true }, masked: true }
        ),
        slot: true,
    },
    {
        heading: 'Write configuration masking',
        note: 'Either configuration can mask a read-only name.',
        owner: makeModifier(
            'Write mask',
            collaborator('WRITE_PRIVATE_MODIFIER', 'write-mask'),
            { write: { maskPasswordOnLoginScreen: true }, masked: true }
        ),
        slot: true,
    },
    {
        heading: 'Pending owner',
        note: 'Busy state stays visible while input and Clear remain disabled.',
        owner: makeModifier(
            'Pending modifier',
            collaborator('Pending native', 'pending'),
            { pending: true }
        ),
    },
    {
        heading: 'Owner feedback',
        note: 'Supplied feedback stays associated with the disabled control.',
        owner: makeModifier(
            'Feedback modifier',
            collaborator('Reviewed native', 'feedback'),
            { error: 'Synthetic read-only feedback.' }
        ),
        slot: true,
    },
    {
        heading: 'Accessible hidden title',
        note: 'The visual label is hidden while the accessible name remains.',
        owner: makeModifier(
            'Hidden title',
            collaborator('Accessible native', 'hidden-title'),
            { display: { showTitle: false } }
        ),
        slot: true,
    },
    {
        heading: 'Portal list detail',
        note: 'The list detail host falls back to the physical field name.',
        owner: await makePortalModifier(
            'list',
            'Fallback modifier',
            collaborator('List modifier', 'list')
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
        note: 'A Created By object has the same shape but belongs to a different physical kind.',
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
        heading: 'A blank name stays blank',
        note: 'A valid collaborator with an empty name never falls back to email or ID.',
        owner: makeModifier('Blank name', collaborator('', 'blank')),
    },
    {
        heading: 'Malformed native value',
        note: 'Malformed objects and primitives stay blank without replacing their native value.',
        owner: malformed,
    },
    {
        heading: 'No name fallback',
        note: 'An object without a name cannot expose its email, ID or avatar.',
        owner: makeModifier('No modifier name', {
            id: 'PRIVATE_MODIFIER_ID_NO_NAME',
            email: 'PRIVATE_MODIFIER_EMAIL_NO_NAME@example.invalid',
            profilePicUrl:
                'https://example.invalid/PRIVATE_MODIFIER_AVATAR_NO_NAME.png',
        }),
    },
];
// Read-only test observation is separate from page markup. Full native objects,
// including private sentinel fields, remain in the owners and never in the DOM.
Object.assign(window, {
    __lastModifiedByProof: {
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
            ? h(LastModifiedByField, {
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
                          renderLastModifiedByField: (props) =>
                              renderLastModifiedByField(props, {
                                  className: 'custom-modifier',
                                  clearLabel: 'Clear read-only modifier',
                              }),
                      },
                  })
                : h(LastModifiedByField, { binding: card.owner.binding! }),
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
        h('h1', null, 'The last modifier’s name, preserved.'),
        h(
            'p',
            { className: 'intro' },
            'Read-only names from native collaborator objects. Form and Portal owners keep the complete value; no history, timestamp or identity lookup is inferred.'
        ),
        h(
            'div',
            { className: 'toolbar' },
            h(
                'button',
                {
                    type: 'button',
                    onClick: () => {
                        malformed.replaceWith(
                            malformedValues[
                                malformedIndex % malformedValues.length
                            ]
                        );
                        malformedIndex++;
                    },
                },
                'Cycle malformed value'
            ),
            h(
                'button',
                { type: 'button', onClick: acceptedModifier.replace },
                'Replace modifier value'
            ),
            h(
                'button',
                { type: 'button', onClick: () => setMount(mount + 1) },
                'Remount controls'
            ),
            h(
                'button',
                { type: 'button', onClick: acceptedModifier.toggleHidden },
                'Toggle modifier visibility'
            ),
            h(
                'button',
                { type: 'button', onClick: noncomputed.retireCurrent },
                'Retire Form host'
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
                'Modifier setter calls: ',
                h('b', { id: 'modifier-writes' }, String(counts.modifierWrites))
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
