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
    createNumberFieldModel,
    createPortalDetailRendererHost,
    type FieldRendererHost,
    type FieldRendererProps,
} from '@miniextensions/sdk/ui';
import {
    CountField,
    FieldRenderer,
    NumberField,
    renderCountField,
} from '@miniextensions/sdk/react';
import '@miniextensions/sdk/react/number.css';
import './styles.css';

// Synthetic local data only. Form uses the real read-only owner; Portal grid
// and list use accepted detail projections, never fabricated computed cells.
// Other cards isolate presentation states. Only Number borrows a scalar.
const counts = {
    countWrites: 0,
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
type Config = FieldRendererProps<'count'>['displayConfig'];
function makeCount(
    title: string,
    initial: number | null | undefined,
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
        id: 'fld_repeated_count',
        name: options.fieldName ?? title,
        description: null,
        isComputed: true,
        isPrimaryField: false,
        config: {
            type: 'count' as const,
            options: { isValid: true, recordLinkFieldId: 'fld_related' },
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
                                physicalKind: 'count',
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
                fieldType: 'count',
                isComputed: true,
                readOnly: true,
                schema: {
                    fieldType: 'count',
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
            increment('countWrites', 'count-writes');
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
        toggleValidity: () => {
            field.config.options.isValid = !field.config.options.isValid;
            revision++;
            state.emit();
        },
        replace: () => {
            value = 101;
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
function makeNumber(
    title: string,
    initial: number,
    error: string | null = null
) {
    let value: number | null = initial;
    const state = store();
    const field = {
        id: 'fld_neighbor',
        name: title,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type: 'number' as const, options: { precision: 2 } },
    };
    const model = createNumberFieldModel({
        getValue: () => value,
        canEdit: () => true,
        isCurrent: () => true,
        write: (next) => {
            if (typeof next === 'boolean') return false;
            value = next;
            increment('writes', 'writes');
            return true;
        },
    });
    model.subscribe(state.emit);
    const binding: FormFieldBinding = {
        getSnapshot: () => ({
            field: {
                fieldId: field.id,
                title,
                fieldType: 'number',
                isComputed: false,
                readOnly: false,
                schema: {
                    fieldType: 'number',
                    airtableField: field,
                    miniExtConfig: {},
                },
            },
            value,
            dirty: value !== initial,
            revision: model.getState().revision,
            visibility: { type: 'visible', diagnostics: [] },
            readOnly: false,
            canEdit: true,
            pending: false,
            error,
            validation: [],
            scalar: model.getState(),
            selection: null,
            date: null,
            retired: false,
        }),
        subscribe: (listener) =>
            state.subscribe(() => listener(binding.getSnapshot())),
        setValue: () => ({ accepted: false, reason: 'readonly' }),
        scalar: model,
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
    title: string
): Extract<RuntimeFieldSchema, { fieldType: 'count' }> {
    return {
        fieldType: 'count',
        airtableField: {
            id: 'fld_count',
            name: title,
            description: null,
            isComputed: true,
            isPrimaryField: false,
            config: {
                type: 'count',
                options: { isValid: true, recordLinkFieldId: 'fld_related' },
            },
        },
        miniExtConfig: {},
    };
}
function makeFormCount() {
    const loaded = structuredClone(syntheticForm);
    loaded.payload.fieldIdsInForm = ['fld_count'];
    loaded.payload.fieldIdsToSchemas = { fld_count: schema('Bound zero') };
    loaded.payload.formRecord = { type: 'create', data: { fld_count: 0 } };
    const owner = createFormFieldBindings({
        loaded,
        client,
        saveOptions: {
            captchaVal: null,
            isComputeMode: false,
            searchQuery: {},
            context: { type: 'direct-url' },
            conditionalLinkedRecordFieldIdsToFilteringValues: {},
            deviceFingerprint: { version: 1, visitorId: 'synthetic_count' },
        },
        getScope: () => ({ ownerId: 'count_form', revision: 0 }),
    });
    const binding = owner.field('fld_count');
    const setValue = binding.setValue;
    binding.setValue = (value) => {
        increment('countWrites', 'count-writes');
        return setValue(value);
    };
    if (binding.scalar !== null || binding.getSnapshot().canEdit)
        throw Error('Count must remain read only.');
    cleanup.push(() => owner.destroy());
    return {
        binding,
        subscribe: (listener: () => void) => binding.subscribe(listener),
        nativeText: () => JSON.stringify(binding.getSnapshot().value),
    };
}
async function makePortalCount(
    layout: 'grid' | 'list',
    title: string,
    value: number
) {
    const field = schema(title).airtableField;
    const portal: PortalLoadedResult = {
        ...structuredClone(syntheticForm),
        extensionScreen: 'portal_loaded',
        payload: {
            extensionType: 'portal',
            extensionName: 'Synthetic Count Portal',
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
                                linkedTableId: 'table_counts',
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
                            { id: 'view_count', config: { name: 'Counts' } },
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
            recordIds: ['record_count'],
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
                table_counts: {
                    airtableFields: [field],
                    recordIdsToAirtableRecords: {
                        record_count: {
                            id: 'record_count',
                            fields: { fld_count: value },
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
            selectedCustomViewId: 'view_count',
            searchTerm: '',
            searchParamsMap: {},
            sortFieldsByEndUser: null,
            filtersByEndUser: null,
            supportsEndUserSortCleanup: true,
            supportsEndUserFilterCleanup: true,
        },
        getScope: () => ({ ownerId: `count_${layout}`, revision: 0 }),
    });
    await owner.readFirst(owner.getSnapshot().revision, {
        pagesToFetch: 1,
        refreshLoggedInPortalRecord: false,
    });
    const host = createPortalDetailRendererHost({
        owner,
        client,
        recordId: 'record_count',
        isCurrent: () => true,
        configurationRevision: () => 0,
    });
    const snapshot = host.getSnapshot();
    if (
        snapshot.status !== 'ready' ||
        snapshot.fields[0]?.physicalKind !== 'count' ||
        snapshot.fields[0].capability.type !== 'readonly'
    )
        throw Error('Count detail must be read only.');
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

const acceptedCount = makeCount('Related count', 42);
const lifecycle = makeCount('Lifecycle value', 99);
const neighbor = makeNumber('Editable neighbor', 7);
const wrong = makeNumber('Other field kind', 777, 'Not a Count binding.');
const cards = [
    {
        heading: 'Accepted native count',
        note: 'Valid Count metadata shows the supplied number. No links are counted here.',
        owner: acceptedCount,
        slot: true,
    },
    {
        heading: 'Zero stays zero',
        note: 'A real Form owner supplies a computed read-only binding and preserves zero.',
        owner: makeFormCount(),
    },
    {
        heading: 'No numeric normalization',
        note: 'Fractions and negative values display as supplied.',
        owner: makeCount('Fractional value', -1.125),
        slot: true,
    },
    {
        heading: 'Portal grid detail',
        note: 'An accepted grid detail projection preserves native exponent notation.',
        owner: await makePortalCount('grid', 'Exponent value', 1e21),
        slot: true,
    },
    {
        heading: 'No value yet',
        note: 'Null stays blank; rendering does not calculate a count.',
        owner: makeCount('Empty value', null),
    },
    {
        heading: 'Missing snapshot value',
        note: 'A missing slot value stays blank too.',
        owner: makeCount('Missing value', undefined),
        slot: true,
    },
    {
        heading: 'Display masking',
        note: 'The display configuration masks the disabled control.',
        owner: makeCount('Display mask', 987, {
            display: { maskPasswordOnLoginScreen: true },
            masked: true,
        }),
        slot: true,
    },
    {
        heading: 'Write configuration masking',
        note: 'Masking applies from either configuration without granting writes.',
        owner: makeCount('Write mask', 654, {
            write: { maskPasswordOnLoginScreen: true },
            masked: true,
        }),
        slot: true,
    },
    {
        heading: 'Pending owner',
        note: 'Busy state remains visible while the field stays disabled.',
        owner: makeCount('Pending value', 27, { pending: true }),
    },
    {
        heading: 'Owner feedback',
        note: 'The owner supplies feedback; presentation does not validate or save.',
        owner: makeCount('Feedback value', 28, {
            error: 'Synthetic read-only feedback.',
        }),
        slot: true,
    },
    {
        heading: 'Accessible hidden title',
        note: 'A hidden visual label keeps its accessible name.',
        owner: makeCount('Hidden title', 314, {
            display: { showTitle: false },
        }),
        slot: true,
    },
    {
        heading: 'Portal list detail',
        note: 'A real list detail host uses the field name when its title override is blank.',
        owner: await makePortalCount('list', 'Fallback count', 2718),
        slot: true,
    },
    {
        heading: 'Editable Number neighbor',
        note: 'Only this separate Number model accepts edits and partial drafts.',
        owner: neighbor,
        number: true,
    },
    {
        heading: 'Wrong physical binding',
        note: 'Count refuses another physical kind even if it has a scalar.',
        owner: wrong,
        wrong: true,
    },
    {
        heading: 'Application override',
        note: 'An explicit custom renderer owns its safe presentation.',
        owner: wrong,
        custom: true,
    },
    {
        heading: 'Owner lifecycle',
        note: 'Retiring the binding removes the control and its native readout.',
        owner: lifecycle,
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
            ? h(CountField, {
                  binding: card.owner.binding!,
                  render: () =>
                      h(
                          'p',
                          { role: 'status' },
                          'Application-owned read-only presentation.'
                      ),
              })
            : card.number
              ? h(NumberField, { binding: card.owner.binding! })
              : card.slot && 'host' in card.owner
                ? h(FieldRenderer, {
                      host: card.owner.host!,
                      renderers: {
                          renderCountField: (props) =>
                              renderCountField(props, {
                                  className: 'custom-count',
                              }),
                      },
                  })
                : h(CountField, { binding: card.owner.binding! }),
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
        h('h1', null, 'Counts, as supplied.'),
        h(
            'p',
            { className: 'intro' },
            'Read-only native values from Form and Portal owners. Metadata decides whether a count is available; the renderer never counts links or changes the value.'
        ),
        h(
            'div',
            { className: 'toolbar' },
            h(
                'button',
                { type: 'button', onClick: acceptedCount.toggleValidity },
                'Toggle Count validity'
            ),
            h(
                'button',
                { type: 'button', onClick: acceptedCount.replace },
                'Replace count value'
            ),
            h(
                'button',
                { type: 'button', onClick: () => setMount(mount + 1) },
                'Remount controls'
            ),
            h(
                'button',
                { type: 'button', onClick: acceptedCount.toggleHidden },
                'Toggle count visibility'
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
                'Count setter calls: ',
                h('b', { id: 'count-writes' }, String(counts.countWrites))
            ),
            h(
                'span',
                null,
                'Number writes: ',
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
