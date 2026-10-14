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
    ExternalSyncSourceField,
    FieldRenderer,
    TextField,
    renderExternalSyncSourceField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/text.css';
import './styles.css';

// Synthetic local data only. Form uses the real read-only owner; Portal grid
// and list use accepted detail projections, never fabricated computed cells.
// Other cards isolate presentation states. Only the Text neighbor accepts edits.
const counts = {
    sourceWrites: 0,
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
type Config = FieldRendererProps<'externalSyncSource'>['displayConfig'];
function makeSource(
    title: string,
    initial: string | null | undefined,
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
        id: 'fld_repeated_source',
        name: options.fieldName ?? title,
        description: null,
        isComputed: true,
        isPrimaryField: false,
        config: {
            type: 'externalSyncSource' as const,
            options: { choices: [{ id: 'source_a', name: 'Known metadata' }] },
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
                                physicalKind: 'externalSyncSource',
                                presentation: {
                                    type: 'physical',
                                    config: field.config,
                                },
                                fieldId: field.id,
                                title,
                                field,
                                displayConfig: options.display ?? {},
                                writeConfig: options.write ?? {},
                                value,
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
                fieldType: 'externalSyncSource',
                isComputed: true,
                readOnly: true,
                schema: {
                    fieldType: 'externalSyncSource',
                    airtableField: field,
                    miniExtConfig: { ...options.display, ...options.write },
                },
            },
            value,
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
            increment('sourceWrites', 'source-writes');
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
                      : JSON.stringify(value),
        changeChoices: () => {
            field.config.options.choices =
                revision % 2 === 0
                    ? [{ id: 'new_choice', name: 'Renamed metadata' }]
                    : [];
            revision++;
            state.emit();
        },
        replace: () => {
            value = 'Replacement source';
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
): Extract<RuntimeFieldSchema, { fieldType: 'externalSyncSource' }> {
    return {
        fieldType: 'externalSyncSource',
        airtableField: {
            id: 'fld_source',
            name: title,
            description: null,
            isComputed: computed,
            isPrimaryField: false,
            config: {
                type: 'externalSyncSource',
                options: {
                    choices: [{ id: 'source_a', name: 'Known metadata' }],
                },
            },
        },
        miniExtConfig: {},
    };
}
function makeFormSource(computed = true) {
    const title = computed ? 'Bound source' : 'Noncomputed source';
    const value = computed ? 'Form native source' : 'Owner reports editable';
    const loaded = structuredClone(syntheticForm);
    loaded.payload.fieldIdsInForm = ['fld_source'];
    loaded.payload.fieldIdsToSchemas = { fld_source: schema(title, computed) };
    loaded.payload.formRecord = { type: 'create', data: { fld_source: value } };
    const owner = createFormFieldBindings({
        loaded,
        client,
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
            deviceFingerprint: { version: 1, visitorId: 'synthetic_source' },
        },
        getScope: () => ({ ownerId: 'source_form', revision: 0 }),
    });
    const binding = owner.field('fld_source');
    const setValue = binding.setValue;
    binding.setValue = (value) => {
        increment('sourceWrites', 'source-writes');
        return setValue(value);
    };
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'fld_source',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const admission = host.getSnapshot();
    if (binding.scalar !== null || binding.getSnapshot().canEdit === computed)
        throw Error('Unexpected synthetic owner admission.');
    if (computed ? admission.status !== 'ready' : admission.status === 'ready')
        throw Error('Unexpected real host admission.');
    cleanup.push(() => {
        host.dispose();
        owner.destroy();
    });
    return {
        binding,
        admission: admission.status,
        ownerCanEdit: binding.getSnapshot().canEdit,
        subscribe: (listener: () => void) => binding.subscribe(listener),
        nativeText: () => JSON.stringify(binding.getSnapshot().value),
    };
}
async function makePortalSource(
    layout: 'grid' | 'list',
    title: string,
    value: string
) {
    const field = schema(title).airtableField;
    const portal: PortalLoadedResult = {
        ...structuredClone(syntheticForm),
        extensionScreen: 'portal_loaded',
        payload: {
            extensionType: 'portal',
            extensionName: 'Synthetic Source Portal',
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
                                linkedTableId: 'table_sources',
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
                            { id: 'view_source', config: { name: 'Sources' } },
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
            recordIds: ['record_source'],
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
                table_sources: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        record_source: {
                            id: 'record_source',
                            fields: { fld_source: value },
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
            selectedCustomViewId: 'view_source',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: `source_${layout}`, revision: 0 }),
    });
    await owner.readFirst(owner.getSnapshot().revision, {
        pagesToFetch: 1,
        refreshLoggedInPortalRecord: false,
    });
    const host = createPortalDetailRendererHost({
        owner,
        client,
        recordId: 'record_source',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const snapshot = host.getSnapshot();
    if (
        snapshot.status !== 'ready' ||
        snapshot.fields[0]?.physicalKind !== 'externalSyncSource' ||
        snapshot.fields[0].capability.type !== 'readonly'
    )
        throw Error('Source detail must be read only.');
    cleanup.push(() => {
        host.dispose();
        owner.destroy();
    });
    return {
        host,
        binding: undefined,
        subscribe: (listener: () => void) => host.subscribe(listener),
        nativeText: () => JSON.stringify(value),
    };
}
window.addEventListener(
    'pagehide',
    () => cleanup.forEach((dispose) => dispose()),
    { once: true }
);

const acceptedSource = makeSource('Native source', '  Unlisted 日本語 👩🏽‍💻  ');
const lifecycle = makeSource('Lifecycle source', 'Retirable source');
const neighbor = makeText('Editable neighbor', 'Text draft');
const wrong = makeText(
    'Other field kind',
    'Private wrong-kind text',
    'Not an External Sync Source binding.'
);
const cards = [
    {
        heading: 'Native label, unchanged',
        note: 'Unknown labels, spaces and Unicode stay exactly as supplied.',
        owner: acceptedSource,
        slot: true,
    },
    {
        heading: 'Real Form owner',
        note: 'Canonical computed metadata gives the Form binding read-only authority.',
        owner: makeFormSource(),
    },
    {
        heading: 'Markup stays text',
        note: 'HTML-shaped strings never become elements, links or executable content.',
        owner: makeSource(
            'Literal markup',
            '<script>window.sourceInjection = true</script>'
        ),
        slot: true,
    },
    {
        heading: 'Portal grid detail',
        note: 'An accepted grid detail projection displays a URL as plain text.',
        owner: await makePortalSource(
            'grid',
            'Grid source',
            'https://example.invalid/source?x=1'
        ),
        slot: true,
    },
    {
        heading: 'No value yet',
        note: 'Null stays blank without a replacement or default label.',
        owner: makeSource('Empty source', null),
    },
    {
        heading: 'Missing snapshot value',
        note: 'A missing slot value stays blank too.',
        owner: makeSource('Missing source', undefined),
        slot: true,
    },
    {
        heading: 'Display masking',
        note: 'The display configuration protects both control and native readout.',
        owner: makeSource('Display mask', 'DISPLAY_PRIVATE_SOURCE', {
            display: { maskPasswordOnLoginScreen: true },
            masked: true,
        }),
        slot: true,
    },
    {
        heading: 'Write configuration masking',
        note: 'Either configuration can mask the read-only native string.',
        owner: makeSource('Write mask', 'WRITE_PRIVATE_SOURCE', {
            write: { maskPasswordOnLoginScreen: true },
            masked: true,
        }),
        slot: true,
    },
    {
        heading: 'Pending owner',
        note: 'Busy state stays visible while input and Clear remain disabled.',
        owner: makeSource('Pending source', 'Pending native', {
            pending: true,
        }),
    },
    {
        heading: 'Owner feedback',
        note: 'The owner supplies feedback; rendering does not validate or save.',
        owner: makeSource('Feedback source', 'Reviewed native', {
            error: 'Synthetic read-only feedback.',
        }),
        slot: true,
    },
    {
        heading: 'Accessible hidden title',
        note: 'A hidden visual label keeps its accessible name.',
        owner: makeSource('Hidden title', 'Accessible native', {
            display: { showTitle: false },
        }),
        slot: true,
    },
    {
        heading: 'Portal list detail',
        note: 'The real list detail host falls back to the physical field name.',
        owner: await makePortalSource(
            'list',
            'Fallback source',
            'List native source'
        ),
        slot: true,
    },
    {
        heading: 'Editable Text neighbor',
        note: 'Only this separate Text binding accepts edits, composition and Clear.',
        owner: neighbor,
        text: true,
    },
    {
        heading: 'Wrong physical binding',
        note: 'The source wrapper refuses another physical kind.',
        owner: wrong,
        wrong: true,
    },
    {
        heading: 'Application override',
        note: 'A custom renderer owns its safe presentation, including wrong-kind bindings.',
        owner: wrong,
        custom: true,
    },
    {
        heading: 'Owner lifecycle',
        note: 'Retirement removes the input, disabled Clear and private readout.',
        owner: lifecycle,
    },
    {
        heading: 'Direct wrapper stays read only',
        note: 'Noncomputed metadata can grant owner edits. This wrapper still disables input and Clear; its real host refuses admission.',
        owner: makeFormSource(false),
    },
];
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
            ? h(ExternalSyncSourceField, {
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
                          renderExternalSyncSourceField: (props) =>
                              renderExternalSyncSourceField(props, {
                                  className: 'custom-source',
                                  clearLabel: 'Clear read-only source',
                              }),
                      },
                  })
                : h(ExternalSyncSourceField, { binding: card.owner.binding! }),
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
        h('h1', null, 'Sources stay as text.'),
        h(
            'p',
            { className: 'intro' },
            'Native source labels from Form and Portal owners, preserved as plain text. Choice metadata never replaces a value, creates a link, or grants editing.'
        ),
        h(
            'div',
            { className: 'toolbar' },
            h(
                'button',
                { type: 'button', onClick: acceptedSource.changeChoices },
                'Change choice metadata'
            ),
            h(
                'button',
                { type: 'button', onClick: acceptedSource.replace },
                'Replace source value'
            ),
            h(
                'button',
                { type: 'button', onClick: () => setMount(mount + 1) },
                'Remount controls'
            ),
            h(
                'button',
                { type: 'button', onClick: acceptedSource.toggleHidden },
                'Toggle source visibility'
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
                'Source setter calls: ',
                h('b', { id: 'source-writes' }, String(counts.sourceWrites))
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
