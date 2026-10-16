import {
    createElement as h,
    useState,
    useSyncExternalStore,
    type FormEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
    createFormFieldBindings,
    RecoveryJournal,
    type FormFieldBinding,
} from '@miniextensions/sdk/forms';
import {
    createMiniExtensionsClient,
    type FormLoadedResult,
    type PortalLoadedResult,
    type RuntimeFieldSchema,
} from '@miniextensions/sdk';
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
import {
    SingleSelectField,
    FieldRenderer,
    renderSingleSelectField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/single-select.css';
import './styles.css';

// All owners and transport responses are synthetic. Only explicit Save buttons
// invoke record-write methods; choosing a value changes the owner's draft.
const counts = {
    draftChanges: 0,
    choiceCalls: 0,
    formSaves: 0,
    gridSaves: 0,
    portalReads: 0,
    requests: 0,
    rowEvents: 0,
    submits: 0,
};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
const increment = (key: keyof typeof counts) => {
    counts[key]++;
    notify();
};
const cleanup: (() => void)[] = [];
const formPayloads: unknown[] = [],
    gridPayloads: unknown[] = [];
const choices = [
    { id: 'sel_routine', name: 'Routine' },
    { id: 'sel_soon', name: 'Soon' },
    { id: 'sel_urgent', name: 'Urgent' },
];
type Config = RuntimeFieldSchema['miniExtConfig'];
const schema = (title: string, config: Config = {}): RuntimeFieldSchema => ({
    fieldType: 'singleSelect',
    airtableField: {
        id: 'fld_priority',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type: 'singleSelect',
            options: { choices: structuredClone(choices) },
        },
    },
    miniExtConfig: config,
});
function makeClient() {
    return createMiniExtensionsClient({
        apiOrigin: 'https://synthetic.invalid',
        fetch: async () => {
            increment('requests');
            throw Error('Network is disabled.');
        },
    });
}
function watch(binding: FormFieldBinding) {
    let previous = JSON.stringify(binding.getSnapshot().value);
    cleanup.push(
        binding.subscribe((snapshot) => {
            const next = JSON.stringify(snapshot.value);
            if (next !== previous) {
                previous = next;
                increment('draftChanges');
            }
            notify();
        })
    );
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

function makeForm(
    id: string,
    title: string,
    value: string | null,
    config: Config = {},
    held = false
) {
    const client = makeClient();
    const loaded = structuredClone(syntheticForm);
    loaded.payload.fieldIdsInForm = ['fld_priority'];
    loaded.payload.fieldIdsToSchemas = { fld_priority: schema(title, config) };
    loaded.payload.formRecord = {
        type: 'create',
        data: { fld_priority: value },
    };
    client.forms.save = async (input) => {
        increment('formSaves');
        formPayloads.push(structuredClone(input));
        // A validation response keeps this gallery local and leaves its draft visible.
        return { type: 'error', formValidationErrors: [], formErrors: {} };
    };
    let release: (() => void) | undefined;
    client.forms.addSelectOption = async (input) => {
        increment('choiceCalls');
        const result = {
            newChoice: { id: `sel_local_${id}`, name: input.newChoiceText },
        };
        if (!held) return result;
        // Deliberately ignore cancellation here to prove stale completion cannot
        // install the late choice into the retired creation attempt.
        return new Promise((resolve) => {
            release = () => resolve(result);
        });
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
            deviceFingerprint: { version: 1, visitorId: 'synthetic_select' },
        },
        getScope: () => ({ ownerId: id, revision: 0 }),
    });
    if (
        config &&
        'allowAddingNewOptions' in config &&
        config.allowAddingNewOptions
    )
        owner.selectChoice('fld_priority', {
            journal: new RecoveryJournal(),
            loadVersion: 1,
            scope: {
                owner: id,
                parentFieldId: null,
                tableId: null,
                childExtensionId: 'synthetic_form',
                context: 'modal',
            },
        });
    const binding = owner.field('fld_priority');
    watch(binding);
    let current = true;
    const host = createFormFieldRendererHost({
        fields: owner,
        fieldId: 'fld_priority',
        isCurrent: () => current,
        configurationRevision: () => 0,
    });
    if (host.getSnapshot().status !== 'ready')
        throw Error(
            `Form admission failed: ${id}: ${JSON.stringify(host.getSnapshot())}`
        );
    cleanup.push(() => {
        host.dispose();
        owner.destroy();
    });
    return {
        binding,
        host,
        read: () => binding.getSnapshot().value,
        save: async () => {
            await owner.save();
            notify();
        },
        release: () => {
            release?.();
            release = undefined;
        },
        retire: () => {
            current = false;
            host.getSnapshot();
            notify();
        },
    };
}
async function makePortal(layout: 'grid' | 'list', value: string) {
    const client = makeClient();
    const fieldSchema = schema(
        layout === 'grid' ? 'Grid priority' : 'List priority'
    );
    const field = fieldSchema.airtableField;
    const portal: PortalLoadedResult = {
        ...structuredClone(syntheticForm),
        extensionScreen: 'portal_loaded',
        payload: {
            extensionType: 'portal',
            extensionName: 'Synthetic Select Portal',
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
                                linkedTableId: 'table_priorities',
                                inverseLinkFieldId: 'fld_parent',
                                isReversed: false,
                                prefersSingleRecordLink: false,
                            },
                        },
                    },
                    miniExtConfig: {
                        layout,
                        disableInlineEdit: false,
                        allowEditingRecords: true,
                        formsForEditingAndCreating: 'same-form',
                        extensionIdForCreatingAndEditing: 'synthetic_child',
                        customViews: [
                            {
                                id: 'view_priority',
                                config: { name: 'Priorities' },
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
    client.portals.listLinkedRecords = async () => {
        increment('portalReads');
        return {
            airtableOffset: null,
            recordIds: ['record_priority'],
            customViewDetailFields: {
                fld_related: [
                    {
                        fieldId: field.id,
                        fieldName: field.name,
                        titleOverride: '',
                        isHidden: false,
                        fieldIsInEditingChildForm: true,
                        childFormField: null,
                        miniExtConfig: fieldSchema.miniExtConfig,
                    },
                ],
            },
            tableIdsToLinkedTableStates: {
                table_priorities: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        record_priority: {
                            id: 'record_priority',
                            fields: { fld_priority: value },
                        },
                    },
                },
            },
        };
    };
    client.portals.updateGridCell = async (input) => {
        increment('gridSaves');
        gridPayloads.push(structuredClone(input));
        return {
            auditTrail: null,
            auditTrails: [],
            record: {
                id: 'record_priority',
                fields: { fld_priority: input.value },
            },
        };
    };
    const owner = createPortalListOwner({
        client,
        portal,
        portalFieldId: 'fld_related',
        criteria: {
            selectedCustomViewId: 'view_priority',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: `select_${layout}`, revision: 0 }),
    });
    await owner.readFirst(owner.getSnapshot().revision, {
        pagesToFetch: 1,
        refreshLoggedInPortalRecord: false,
    });
    const detail = createPortalDetailRendererHost({
        owner,
        client,
        recordId: 'record_priority',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const detailState = detail.getSnapshot();
    if (
        detailState.status !== 'ready' ||
        detailState.fields[0]?.capability.type !== 'readonly'
    )
        throw Error('Portal detail must be read only.');
    cleanup.push(() => {
        detail.dispose();
        owner.destroy();
    });
    if (layout === 'list')
        return {
            detail,
            cell: null,
            host: null,
            read: () => value,
            save: async () => {},
        };
    const cell = createPortalCellBinding({
        client,
        schema: fieldSchema,
        value,
        input: {
            portalExtensionAccessToken: 'synthetic_portal',
            portalFieldId: 'fld_related',
            recordId: 'record_priority',
            recordFieldId: field.id,
            selectedCustomViewId: 'view_priority',
        },
        getScope: () => ({ ownerId: 'select_grid', revision: 0 }),
        isCurrent: () => true,
        recovery: {
            journal: new RecoveryJournal(),
            scope: {
                owner: 'select_grid',
                parentFieldId: 'fld_related',
                tableId: 'table_priorities',
                childExtensionId: '',
                context: 'modal',
            },
            loadVersion: 1,
        },
    });
    let previous: unknown = value;
    cleanup.push(
        cell.binding.subscribe((snapshot) => {
            if (snapshot.value !== previous) {
                previous = snapshot.value;
                increment('draftChanges');
            }
            notify();
        })
    );
    const host = createPortalCellRendererHost({
        cell,
        owner,
        client,
        recordId: 'record_priority',
        fieldId: field.id,
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const cellState = host.getSnapshot();
    if (
        cellState.status !== 'ready' ||
        cellState.fields[0]?.capability.type !== 'editable'
    )
        throw Error('Grid cell must be editable.');
    cleanup.push(() => {
        host.dispose();
        cell.destroy();
    });
    return {
        detail,
        cell,
        host,
        read: () => cell.binding.getSnapshot().value,
        save: async () => {
            await cell.save();
            notify();
        },
    };
}
const primary = makeForm('main', 'Priority', 'Routine');
const restricted = makeForm('restricted', 'Delivery window', 'Legacy', {
    singleOrMultiSelectLimitSelectionOptions: ['sel_soon'],
    enableConditionalOptions: true,
    conditionsForOptions: [
        {
            id: 'rule_soon',
            config: {
                optionForConditions: 'sel_soon',
                name: 'Next up',
                conditionsForOption: { logicalOperator: 'and', conditions: [] },
            },
        },
    ],
});
const locked = makeForm('locked', 'Locked priority', 'Urgent', {
    readOnly: true,
});
const masked = makeForm('masked', 'Private priority', 'SECRET_PRIORITY_X', {
    obscurePassword: true,
    allowAddingNewOptions: true,
});
const creator = makeForm('creator', 'Create a priority', 'Routine', {
    allowAddingNewOptions: true,
});
const held = makeForm(
    'held',
    'Slow choice request',
    'Soon',
    { allowAddingNewOptions: true },
    true
);
const compact = makeForm('compact', 'Compact priority', null, {
    showTitle: false,
});
const lifecycle = makeForm('lifecycle', 'Lifecycle priority', 'Routine');
const grid = await makePortal('grid', 'Routine');
const list = await makePortal('list', 'Soon');
const renderHost = (host: FieldRendererHost) =>
    h(FieldRenderer, {
        host,
        renderers: { renderSingleSelectField },
        fallback: () =>
            h('p', { role: 'status' }, 'This owner is no longer available.'),
    });
const cards = [
    {
        id: 'primary',
        eyebrow: 'FORM / BINDING',
        title: 'Choose a priority',
        description: 'Selections stay in the draft until you explicitly save.',
        render: () => h(SingleSelectField, { binding: primary.binding }),
        read: primary.read,
    },
    {
        id: 'repeated',
        eyebrow: 'FORM / SAME OWNER',
        title: 'A second view',
        description:
            'The same binding shares its draft, with a distinct accessible label.',
        render: () =>
            h(SingleSelectField, {
                binding: primary.binding,
                clearLabel: 'Clear repeated priority',
            }),
        read: primary.read,
    },
    {
        id: 'restricted',
        eyebrow: 'FORM / PUBLISHED POLICY',
        title: 'Labels and retained values',
        description:
            '“Next up” is a display label for Soon. The old Legacy value stays visible.',
        render: () => renderHost(restricted.host),
        read: restricted.read,
    },
    {
        id: 'grid',
        eyebrow: 'PORTAL / GRID CELL',
        title: 'Inline editing',
        description:
            'An accepted Grid cell owns this draft and its explicit Save.',
        render: () => renderHost(grid.host!),
        read: grid.read,
    },
    {
        id: 'grid-detail',
        eyebrow: 'PORTAL / GRID DETAIL',
        title: 'Original record',
        description:
            'Detail presentation remains read only while the cell draft changes.',
        render: () => renderHost(grid.detail),
        read: () => 'Routine',
    },
    {
        id: 'list-detail',
        eyebrow: 'PORTAL / LIST DETAIL',
        title: 'A readonly list',
        description: 'The accepted List owner supplies a read only projection.',
        render: () => renderHost(list.detail),
        read: list.read,
    },
    {
        id: 'locked',
        eyebrow: 'FORM / READ ONLY',
        title: 'Published permission',
        description:
            'A configured read only field keeps its current selection.',
        render: () => renderHost(locked.host),
        read: locked.read,
    },
    {
        id: 'masked',
        eyebrow: 'FORM / PRIVATE',
        title: 'Masked presentation',
        description:
            'The control exposes no choice names, options or creation tools.',
        render: () => renderHost(masked.host),
        read: () => 'Masked',
    },
    {
        id: 'creator',
        eyebrow: 'FORM / CHOICE CREATION',
        title: 'Add a useful choice',
        description:
            'Create is a deliberate metadata action. The selected name remains an unsaved draft.',
        render: () => renderHost(creator.host),
        read: creator.read,
    },
    {
        id: 'held',
        eyebrow: 'FORM / CANCELLATION',
        title: 'Cancel a slow request',
        description:
            'Cancel the held request, then release its late synthetic response below.',
        render: () => h(SingleSelectField, { binding: held.binding }),
        read: held.read,
    },
    {
        id: 'compact',
        eyebrow: 'FORM / COMPACT',
        title: 'Title hidden, name intact',
        description:
            'The accessible field name remains available without a visible title.',
        render: () =>
            h(SingleSelectField, {
                binding: compact.binding,
                emptyLabel: 'Choose when ready',
            }),
        read: compact.read,
    },
    {
        id: 'lifecycle',
        eyebrow: 'FORM / OWNER LIFETIME',
        title: 'A retired owner',
        description: 'Retire this host below to remove its editor permanently.',
        render: () => renderHost(lifecycle.host),
        read: lifecycle.read,
    },
];
function Card({ card }: { card: (typeof cards)[number] }) {
    const value = useSyncExternalStore(subscribe, () =>
        JSON.stringify(card.read())
    );
    return h(
        'article',
        { className: 'card', id: `card-${card.id}` },
        h('p', { className: 'eyebrow' }, card.eyebrow),
        h('h2', null, card.title),
        h('p', { className: 'description' }, card.description),
        h(
            'form',
            {
                className: 'demo',
                onSubmit: (event: FormEvent) => {
                    event.preventDefault();
                    increment('submits');
                },
                onClick: () => increment('rowEvents'),
                onKeyDown: () => increment('rowEvents'),
                onPointerDown: () => increment('rowEvents'),
            },
            card.render()
        ),
        h(
            'div',
            { className: 'native' },
            h('span', null, 'Native draft'),
            h('code', { id: `native-${card.id}` }, value ?? 'Missing')
        )
    );
}
function App() {
    const counters = JSON.parse(
        useSyncExternalStore(subscribe, () => JSON.stringify(counts))
    ) as typeof counts;
    const [status, setStatus] = useState('Nothing has been saved.');
    const [retired, setRetired] = useState(false);
    const run = (action: () => Promise<void>, message: string) => {
        void action().then(
            () => setStatus(message),
            (error: unknown) =>
                setStatus(
                    error instanceof Error
                        ? error.message
                        : 'The local action could not complete.'
                )
        );
    };
    return h(
        'main',
        null,
        h(
            'header',
            null,
            h(
                'div',
                { className: 'kicker' },
                'miniExtensions SDK · React example'
            ),
            h('h1', null, 'One choice. A shared draft.'),
            h(
                'p',
                { className: 'intro' },
                'A native Single Select field across Form, Grid and List owners. Try the controls below; this page uses only local synthetic data.'
            ),
            h('span', { className: 'badge' }, 'Provisional renderer')
        ),
        h(
            'section',
            { className: 'stats', 'aria-label': 'Synthetic activity' },
            ...(
                [
                    'draftChanges',
                    'choiceCalls',
                    'formSaves',
                    'gridSaves',
                    'requests',
                    'rowEvents',
                ] as const
            ).map((key) =>
                h(
                    'div',
                    { key },
                    h('strong', { id: key }, String(counters[key])),
                    h(
                        'span',
                        null,
                        {
                            draftChanges: 'Draft changes',
                            choiceCalls: 'Choice requests',
                            formSaves: 'Form saves',
                            gridSaves: 'Grid saves',
                            requests: 'External requests',
                            rowEvents: 'Row events',
                        }[key]
                    )
                )
            )
        ),
        h(
            'div',
            { className: 'gallery' },
            ...cards.map((card) => h(Card, { key: card.id, card }))
        ),
        h(
            'section',
            {
                className: 'actions',
                'aria-label': 'Explicit synthetic actions',
            },
            h(
                'div',
                null,
                h('h2', null, 'You decide when to save'),
                h(
                    'p',
                    null,
                    'These buttons call local synthetic transports. No record or metadata leaves this page.'
                )
            ),
            h(
                'div',
                { className: 'buttons' },
                h(
                    'button',
                    {
                        id: 'save-form',
                        type: 'button',
                        onClick: () =>
                            run(
                                primary.save,
                                'Form Save captured locally; draft retained for inspection.'
                            ),
                    },
                    'Save Form draft'
                ),
                h(
                    'button',
                    {
                        id: 'save-created',
                        type: 'button',
                        onClick: () =>
                            run(
                                creator.save,
                                'Created choice draft captured by the local Save transport.'
                            ),
                    },
                    'Save created choice'
                ),
                h(
                    'button',
                    {
                        id: 'save-grid',
                        type: 'button',
                        disabled:
                            !grid.cell?.binding.getSnapshot().dirty ||
                            grid.cell.binding.getSnapshot().pending,
                        onClick: () =>
                            run(grid.save, 'Grid Save captured locally.'),
                    },
                    'Save Grid draft'
                ),
                h(
                    'button',
                    {
                        id: 'release-choice',
                        type: 'button',
                        onClick: held.release,
                    },
                    'Release late response'
                ),
                h(
                    'button',
                    {
                        id: 'retire-owner',
                        type: 'button',
                        disabled: retired,
                        onClick: () => {
                            lifecycle.retire();
                            setRetired(true);
                        },
                    },
                    'Retire field owner'
                )
            ),
            h(
                'p',
                { id: 'action-status', role: 'status', 'aria-live': 'polite' },
                status
            )
        ),
        h(
            'footer',
            null,
            'Native choice names stay in the owner. Labels are presentation. Creation and saving are separate actions.'
        )
    );
}
Object.assign(window, {
    __singleSelectProof: {
        read: () => ({
            counts: { ...counts },
            primary: primary.read(),
            restricted: restricted.read(),
            grid: grid.read(),
            list: list.read(),
            locked: locked.read(),
            masked: masked.read(),
            creator: creator.read(),
            held: held.read(),
            compact: compact.read(),
            lifecycle: lifecycle.read(),
            lifecycleStatus: lifecycle.host.getSnapshot().status,
            creatorPhase: creator.binding.getSnapshot().choiceCreation?.phase,
            heldPhase: held.binding.getSnapshot().choiceCreation?.phase,
            formPayloads: structuredClone(formPayloads),
            gridPayloads: structuredClone(gridPayloads),
        }),
    },
});
window.addEventListener(
    'pagehide',
    () => cleanup.forEach((dispose) => dispose()),
    { once: true }
);
createRoot(document.getElementById('app')!).render(h(App));
