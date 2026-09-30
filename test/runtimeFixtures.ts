import type {
    FormLoadedResult,
    LoadExtensionInput,
    SaveFormInput,
} from '../src/runtime/index.js';

export const loadInput: LoadExtensionInput = {
    shareId: 'share_example',
    recordId: null,
    context: { type: 'direct-url' },
    query: { prefill_Title: 'Example', repeated: ['First', 'Second'] },
    clientTimeZone: 'America/New_York',
    deviceFingerprint: { version: 1, visitorId: 'visitor_example' },
};

export const formResult: FormLoadedResult = {
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
        publicFields: {
            optionalSetting: { enabled: true, items: ['First', null, 0] },
        },
        fieldIdsInForm: ['fld_title'],
        fieldNamesToSchemas: {},
        fieldIdsToSchemas: {},
        formFieldIdsWithUnsavedChanges: ['fld_title'],
        urlPrefilledFieldIds: ['fld_title'],
        linkedRecordFieldIdToDetailFields: {},
        cookieKeyForLoginToken: null,
        baseId: 'base_example',
        loggedInUserCanEditExtension: false,
        showMiniExtensionsBranding: true,
        onFreePlan: true,
        trialExpiresAtUnixEpoch: null,
    },
};

export const saveInput: SaveFormInput = {
    extensionAccessToken: 'access_example',
    formRecord: { type: 'create', data: { fld_title: 'Updated example' } },
    formFieldIdsWithUnsavedChanges: ['fld_title'],
    captchaVal: null,
    isComputeMode: false,
    searchQuery: {},
    context: { type: 'direct-url' },
    conditionalLinkedRecordFieldIdsToFilteringValues: {},
    deviceFingerprint: { version: 1, visitorId: 'visitor_example' },
};
