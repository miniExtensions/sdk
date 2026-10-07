import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
} from 'node:path';
import {
    assertPrivacyProofInventory,
    privacyScenarioInventory,
    privacyAuthScenarioInventory,
} from './privacy-proof-inventory.mjs';

// Retain a manual browser fixture only after the exact packed checks pass,
// before their independent consumer directories are removed.
const sdkName = '@miniextensions/sdk';
const starterFiles = [
    'index.html',
    'styles.css',
    'src/main.ts',
    'src/fields.ts',
    'src/portal.ts',
    'src/dom.ts',
    'src/drafts.ts',
    'src/recovery.ts',
    'src/confirmation.ts',
    'src/review.ts',
    'src/linkedFilters.ts',
    'src/choiceAvailability.ts',
    'src/childQueries.ts',
    'src/portalSort.ts',
    'src/portalFilter.ts',
];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (root, path) => {
    const part = relative(root, path);
    return (
        part === '' ||
        (!part.startsWith('..' + '/') && part !== '..' && !isAbsolute(part))
    );
};
const regular = (path) => {
    assert(lstatSync(path).isFile(), `Expected a regular file: ${path}`);
    assert.equal(
        realpathSync(path),
        resolve(path),
        `Symlink input refused: ${path}`
    );
    return readFileSync(path);
};

/** This function is serialized into the static kit; it imports no SDK source. */
function createPrivacyFixture(scenario) {
    if (['hide-empty-review', 'hide-empty-review-malformed'].includes(scenario))
        return createHideEmptyReviewFixture(scenario);
    if (scenario.startsWith('hide-empty-'))
        return createEditHideEmptyFixture(scenario);
    if (scenario.startsWith('review-')) return createReviewFixture(scenario);
    if (scenario === 'address-ime') return createAddressCompositionFixture();
    if (scenario === 'teardown-logout' || scenario === 'teardown-disconnect')
        return createTeardownFixture(scenario);
    if (['projection-single', 'projection-multiple'].includes(scenario))
        return createProjectionFixture(scenario);
    if (
        [
            'address-acceptance',
            'address-failure',
            'address-lifecycle',
            'address-remount',
        ].includes(scenario)
    )
        return createAddressFixture(scenario);
    if (
        [
            'visibility-draft',
            'visibility-unavailable',
            'visibility-section',
        ].includes(scenario)
    )
        return createVisibilityFixture(scenario);
    if (
        [
            'choice-single',
            'choice-multiple',
            'choice-add-single',
            'choice-add-multiple',
            'linked-filters',
            'linked-filter-deferred',
        ].includes(scenario)
    )
        return createInteractionFixture(scenario);
    const cases = {
        pin: {
            name: 'Identifier',
            title: 'Portal PIN',
            type: 'singleLineText',
            value: 'Exact-Case PIN 07',
            masked: true,
        },
        password: {
            name: 'Identifier',
            title: 'Portal Password',
            type: 'singleLineText',
            value: 'Exact-Case Password 09',
            masked: true,
        },
        word: {
            name: 'Identifier',
            title: 'Spinning Identifier',
            type: 'singleLineText',
            value: 'Exact ordinary identifier',
            masked: false,
        },
        email: {
            name: 'Email',
            type: 'email',
            value: 'Privacy.Exact+Email@example.test',
            masked: true,
            destination: 'Privacy.Exact+Email@example.test',
            verificationType: 'email',
        },
        phone: {
            name: 'Phone',
            type: 'phoneNumber',
            value: '+15550102030',
            masked: true,
            destination: '+15550102030',
            verificationType: 'phoneNumber',
        },
    };
    if (scenario !== 'portal' && !Object.hasOwn(cases, scenario))
        throw new Error('Unknown synthetic privacy scenario.');
    const selected = cases[scenario];
    const envelope = {
        extensionId: 'privacy_portal_synthetic',
        language: 'en',
        themeColor: 'blue',
        enableCommentsOnChildForms: false,
        workspaceId: 'privacy_workspace_synthetic',
        extensionOwnerUID: 'privacy_owner_synthetic',
        faviconUrl: null,
        googleAnalyticsMeasurementId: null,
        isStarterExtension: false,
    };
    const display = {
        baseId: 'privacy_base_synthetic',
        loggedInUserCanEditExtension: false,
        showMiniExtensionsBranding: true,
        onFreePlan: true,
        trialExpiresAtUnixEpoch: null,
    };
    const field = (id, name, type = 'singleLineText') => ({
        id,
        name,
        config: { type },
    });
    const title = {
        ...field('fld_title_synthetic', 'Title'),
        isPrimaryField: true,
    };
    const secret = field('fld_secret_synthetic', 'Private text');
    const plain = field('fld_plain_synthetic', 'Ordinary text');
    const linked = {
        id: 'fld_children_synthetic',
        name: 'Synthetic children',
        config: {
            type: 'multipleRecordLinks',
            options: {
                linkedTableId: 'tbl_children_synthetic',
                inverseLinkFieldId: 'fld_parent_synthetic',
                isReversed: false,
                prefersSingleRecordLink: false,
            },
        },
    };
    const records = {
        rec_private_synthetic: {
            id: 'rec_private_synthetic',
            fields: {
                fld_title_synthetic: 'Row Alpha',
                fld_secret_synthetic: 'Exact Case-Sensitive Original',
                fld_plain_synthetic: 'Ordinary public value',
            },
        },
        rec_empty_synthetic: {
            id: 'rec_empty_synthetic',
            fields: {
                fld_title_synthetic: 'Row Empty',
                fld_secret_synthetic: '',
                fld_plain_synthetic: 'Ordinary second value',
            },
        },
    };
    const parent = {
        id: 'rec_visitor_synthetic',
        fields: { fld_children_synthetic: Object.keys(records) },
    };
    const linkSchema = {
        fieldType: 'multipleRecordLinks',
        airtableField: linked,
        miniExtConfig: {
            layout: 'grid',
            disableInlineEdit: false,
            allowCreatingRecords: false,
            allowEditingRecords: true,
            extensionIdForEditing: 'privacy_child_synthetic',
            allowUsersToUnlinkRecords: false,
            customViews: [
                {
                    id: 'view_privacy_synthetic',
                    config: { name: 'Synthetic privacy grid' },
                },
            ],
        },
    };
    const detail = (entry, childMasked) => ({
        fieldId: entry.id,
        fieldName: entry.name,
        titleOverride: null,
        isHidden: false,
        fieldIsInEditingChildForm: true,
        // Conflicting detail config deliberately proves the child config wins.
        miniExtConfig: { obscurePassword: !childMasked },
        childFormField: {
            idOrName: { type: 'id', id: entry.id },
            config: {
                type: 'singleLineText',
                config: { obscurePassword: childMasked },
            },
        },
    });
    const details = {
        fld_children_synthetic: [
            detail(title, false),
            detail(secret, true),
            detail(plain, false),
        ],
    };
    const portalPage = () =>
        structuredClone({
            ...envelope,
            extensionScreen: 'portal_loaded',
            payload: {
                ...display,
                extensionType: 'portal',
                extensionName: 'Synthetic privacy Portal',
                extensionAccessToken: 'FAKE_SYNTHETIC_PORTAL_TOKEN',
                publicFields: {},
                viewIdsToAirtableViews: {},
                formRecord: {
                    type: 'edit',
                    tableId: 'tbl_visitors_synthetic',
                    recordId: parent.id,
                    data: parent.fields,
                },
                fieldNamesToSchemas: { 'Synthetic children': linkSchema },
                fieldIdsToSchemas: { fld_children_synthetic: linkSchema },
                fieldIdsInPortal: [linked.id],
                usersTableFields: [linked],
                linkedRecordFieldIdToDetailFields: details,
                linkedRecordFieldIdToFieldsTitles: {
                    fld_children_synthetic: {
                        fld_title_synthetic: 'Title',
                        fld_secret_synthetic: 'Private text',
                        fld_plain_synthetic: 'Ordinary text',
                    },
                },
                cookieKeyForLoginToken: null,
                initialLinkedTableStates: {
                    tbl_children_synthetic: {
                        airtableFields: [title, secret, plain],
                        recordIdsToAirtableRecords: {},
                    },
                },
            },
        });
    const loginPage = () => {
        const id = 'fld_login_synthetic';
        const schema = {
            fieldType: selected.type,
            airtableField: field(id, selected.name, selected.type),
            miniExtConfig: selected.verificationType
                ? {
                      maskPasswordOnLoginScreen: true,
                      ...(selected.verificationType === 'email'
                          ? { requireEmailVerificationToLogin: true }
                          : { requirePhoneNumberVerificationToLogin: true }),
                  }
                : { title: selected.title },
        };
        return structuredClone({
            ...envelope,
            extensionScreen: 'login_page',
            payload: {
                ...display,
                publicFields: {},
                hasParentExtension: false,
                shareId: 'privacy_share_synthetic',
                loginFieldNames: [selected.name],
                loginFieldIds: [id],
                fieldNamesToSchemas: { [selected.name]: schema },
                fieldIdsToSchemas: { [id]: schema },
                tableId: 'tbl_visitors_synthetic',
                prefillFieldNamesToValues: {},
                prefillLoginRecordId: null,
            },
        });
    };
    const childPage = (input) => {
        const access = input.childExtensionInfo?.accessType;
        if (
            input.childExtensionInfo?.childExtensionId !==
                'privacy_child_synthetic' ||
            access?.type !== 'edit' ||
            !Object.hasOwn(records, access.childExtensionRecordId) ||
            input.childExtensionAccessData?.fieldIdUsedToAccessExtension !==
                linked.id ||
            input.childExtensionAccessData?.parentExtensionAccessToken !==
                'FAKE_SYNTHETIC_PORTAL_TOKEN'
        ) {
            throw new Error('Unexpected synthetic child context.');
        }
        const schemas = [title, secret, plain].map((entry) => ({
            fieldType: 'singleLineText',
            airtableField: entry,
            miniExtConfig: { obscurePassword: entry.id === secret.id },
        }));
        return structuredClone({
            ...envelope,
            extensionId: 'privacy_child_synthetic',
            extensionScreen: 'form_loaded',
            payload: {
                ...display,
                extensionType: 'form',
                extensionName: 'Synthetic child Form',
                extensionAccessToken: 'FAKE_SYNTHETIC_CHILD_TOKEN',
                hasParentExtension: true,
                publicFields: {},
                formRecord: {
                    type: 'edit',
                    tableId: 'tbl_children_synthetic',
                    recordId: access.childExtensionRecordId,
                    data: records[access.childExtensionRecordId].fields,
                },
                formErrors: {},
                fieldIdsInForm: schemas.map((entry) => entry.airtableField.id),
                fieldNamesToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.name, entry])
                ),
                fieldIdsToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.id, entry])
                ),
                formFieldIdsWithUnsavedChanges: [],
                urlPrefilledFieldIds: [],
                linkedRecordFieldIdToDetailFields: {},
                cookieKeyForLoginToken: null,
            },
        });
    };
    const state = {
        scenario,
        synthetic: true,
        realNetworkEnabled: false,
        calls: [],
        unexpected: [],
        events: [],
        expected:
            scenario === 'portal'
                ? {
                      recordId: 'rec_private_synthetic',
                      fieldId: secret.id,
                      original: 'Exact Case-Sensitive Original',
                      saved: 'Different-length Saved Value',
                      fixedMask: '••••••••',
                      emptyRecordId: 'rec_empty_synthetic',
                      unmasked: 'Ordinary public value',
                  }
                : {
                      name: selected.name,
                      inputType: selected.masked ? 'password' : 'text',
                      credential: selected.value,
                      destination: selected.destination ?? null,
                      fixedMask: '••••••••',
                      verificationId: 'verification_privacy_synthetic',
                      code: '123456',
                  },
    };
    const fail = (message) => {
        state.unexpected.push(message);
        throw new Error(message);
    };
    const json = (value) =>
        new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    const transport = async (request, init = {}) => {
        const url = new URL(
            request instanceof Request ? request.url : String(request)
        );
        const method =
            init.method ??
            (request instanceof Request ? request.method : 'GET');
        if (url.origin !== 'https://synthetic-sdk.invalid')
            return fail('Real/unrecognized origin refused: ' + url.origin);
        if (init.credentials !== 'omit')
            return fail(
                'Synthetic API requires the real SDK anonymous transport policy.'
            );
        init.signal?.throwIfAborted();
        const route = url.searchParams.get('route') ?? url.pathname;
        let input;
        try {
            input = JSON.parse(
                method === 'GET'
                    ? (url.searchParams.get('input') ?? '{}')
                    : String(init.body ?? '{}')
            );
        } catch {
            return fail('Unrecognized JSON request.');
        }
        const visibleInput = { ...input };
        delete visibleInput.miniExtStorageV4;
        delete visibleInput.miniExtSession;
        state.calls.push({
            route,
            method,
            input: structuredClone(visibleInput),
            credentialsMode: init.credentials,
        });
        if (route === 'fetchExtensionForEndUser') {
            if (input.childExtensionInfo) return json(childPage(input));
            if (input.shareId !== 'privacy_share_synthetic')
                return fail('Unexpected synthetic share ID.');
            return json(scenario === 'portal' ? portalPage() : loginPage());
        }
        if (scenario !== 'portal') {
            if (route === 'loginIntoExtensionUsingLoginPageExtension') {
                if (
                    input.extensionId !== envelope.extensionId ||
                    JSON.stringify(input.loginCredentials) !==
                        JSON.stringify({ [selected.name]: selected.value })
                ) {
                    return fail(
                        'Enter the exact published synthetic credential from the manual recipe.'
                    );
                }
                return json(
                    selected.verificationType
                        ? {
                              type: 'verification-message-sent',
                              verificationId: 'verification_privacy_synthetic',
                              emailOrPhoneNumber: selected.destination,
                              verificationType: selected.verificationType,
                          }
                        : { type: 'no-record' }
                );
            }
            if (route === 'confirmVerificationCodeForLogin') {
                if (
                    !selected.verificationType ||
                    input.verificationId !== 'verification_privacy_synthetic' ||
                    input.verificationCode !== '123456' ||
                    input.language !== 'en'
                ) {
                    return fail(
                        'Unexpected synthetic verification identity/code.'
                    );
                }
                return json({
                    encryptedLoginToken: 'FAKE_SYNTHETIC_LOGIN_TOKEN',
                });
            }
            return fail(
                'Unrecognized synthetic authentication route: ' + route
            );
        }
        if (route === 'fetchRecordsForLinkedTableOnPortal') {
            if (
                input.extensionAccessToken !== 'FAKE_SYNTHETIC_PORTAL_TOKEN' ||
                input.portalFieldId !== linked.id ||
                input.selectedCustomViewId !== 'view_privacy_synthetic' ||
                input.airtableOffset !== null
            ) {
                return fail('Unexpected synthetic Portal list scope.');
            }
            return json({
                airtableOffset: null,
                recordIds: Object.keys(records),
                tableIdsToLinkedTableStates: {
                    tbl_children_synthetic: {
                        airtableFields: [title, secret, plain],
                        recordIdsToAirtableRecords: records,
                    },
                },
                customViewDetailFields: null,
            });
        }
        if (route === '/api/trpc/airtable.updatePortalRecord') {
            if (
                method !== 'POST' ||
                input.portalExtensionAccessToken !==
                    'FAKE_SYNTHETIC_PORTAL_TOKEN' ||
                input.portalFieldId !== linked.id ||
                input.selectedCustomViewId !== 'view_privacy_synthetic' ||
                input.recordId !== 'rec_private_synthetic' ||
                input.recordFieldId !== secret.id ||
                input.value !== state.expected.saved
            ) {
                return fail(
                    'Only the exact documented synthetic native Grid save is permitted.'
                );
            }
            records[input.recordId].fields[input.recordFieldId] = input.value;
            return json({
                result: {
                    data: {
                        record: structuredClone(records[input.recordId]),
                        auditTrail: null,
                        auditTrails: [],
                    },
                },
            });
        }
        if (route === '/api/trpc/airtable.getUserRecord') {
            if (
                method !== 'GET' ||
                input.extensionAccessToken !== 'FAKE_SYNTHETIC_PORTAL_TOKEN'
            )
                return fail('Unexpected synthetic parent refresh.');
            return json({ result: { data: structuredClone(parent) } });
        }
        return fail('Unsupported route refused; no backend fallback: ' + route);
    };
    return { state, fetch: transport, loginPage, portalPage };
}

/** Synthetic wire responses; actual packed starter controls own every Save. */
function createInteractionFixture(scenario) {
    const linked = scenario.startsWith('linked-filter');
    const multiple = scenario.endsWith('-multiple');
    const adding = scenario.startsWith('choice-add-');
    const token = 'FAKE_SYNTHETIC_INTERACTION_TOKEN';
    const field = (id, name, type, options = null) => ({
        id,
        name,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type, options },
    });
    const driver = field('fld_driver', 'Driver', 'singleLineText');
    const choices = field(
        'fld_choices',
        'Choices',
        multiple ? 'multipleSelects' : 'singleSelect',
        {
            choices: [
                { id: 'sel_alpha', name: 'Alpha' },
                { id: 'sel_beta', name: 'Beta' },
                { id: 'sel_gamma', name: 'Gamma' },
            ],
        }
    );
    const choiceSchema = {
        fieldType: choices.config.type,
        airtableField: choices,
        miniExtConfig: {
            enableConditionalOptions: true,
            ...(adding
                ? { allowAddingNewOptions: true }
                : {
                      maxNumberOfSelections: 2,
                      singleOrMultiSelectLimitSelectionOptions: [
                          'sel_alpha',
                          'sel_beta',
                      ],
                  }),
            conditionsForOptions: [
                {
                    id: 'rule_beta',
                    config: {
                        optionForConditions: 'sel_beta',
                        name: 'Conditional Beta',
                        conditionsForOption: {
                            logicalOperator: 'and',
                            conditions: [
                                {
                                    id: 'driver_contains',
                                    type: 'singleCondition',
                                    setting: {
                                        type: 'contains',
                                        fieldType: 'singleLineText',
                                        idOrName: { type: 'id', id: driver.id },
                                        value: 'allowed',
                                    },
                                },
                            ],
                        },
                    },
                },
            ],
        },
    };
    const definitions = [
        { id: 'fld_country', name: 'Current country', title: 'Country' },
        { id: 'fld_region', name: 'Current region', title: 'Region' },
        { id: 'fld_city', name: 'Current city', title: 'City' },
    ];
    const values = {
        fld_country: [
            { recordId: 'rec_country_north', stringValue: 'North, East' },
            { recordId: 'rec_country_south', stringValue: 'South' },
        ],
        fld_region: [
            { recordId: 'rec_region_one', stringValue: 'Duplicate label' },
            { recordId: 'rec_region_two', stringValue: 'Duplicate label' },
        ],
        fld_city: [{ recordId: 'rec_city', stringValue: 'City = "One"' }],
    };
    const link = (id, name) =>
        field(id, name, 'multipleRecordLinks', {
            linkedTableId: 'tbl_projects',
            inverseLinkFieldId: 'fld_parent',
            isReversed: false,
            prefersSingleRecordLink: false,
        });
    const metadata = {
        tbl_projects: {
            airtableFields: [
                {
                    ...field(
                        'fld_project_name',
                        'Project name',
                        'singleLineText'
                    ),
                    isPrimaryField: true,
                },
                ...definitions.map((entry) => link(entry.id, entry.name)),
            ],
            recordIdsToAirtableRecords: {},
        },
    };
    const projectSchema = {
        fieldType: 'multipleRecordLinks',
        airtableField: link('fld_projects', 'Projects'),
        miniExtConfig: {
            dynamicFilteringToggle: true,
            conditionalLinkedRecordFilteringFieldsType: 'show-in-form',
            conditionalLinkedRecordFilterFields: definitions.map((entry) => ({
                idOrName: { type: 'id', id: entry.id },
                config: {
                    type: 'multipleRecordLinks',
                    config: {
                        title: entry.title,
                        disableAddingIfConditionalFilterIsEmpty: false,
                        disableRemovingIfConditionalFilterIsEmpty: false,
                    },
                },
            })),
        },
    };
    const schemas = [
        {
            fieldType: 'singleLineText',
            airtableField: driver,
            miniExtConfig: {},
        },
        linked ? projectSchema : choiceSchema,
    ];
    const initial = linked
        ? { fld_driver: 'denied', fld_projects: ['rec_retained'] }
        : {
              fld_driver: 'denied',
              fld_choices: adding
                  ? multiple
                      ? ['Beta']
                      : 'Beta'
                  : multiple
                    ? []
                    : null,
          };
    const page = () =>
        structuredClone({
            extensionId: 'interaction_form_synthetic',
            language: 'en',
            themeColor: 'blue',
            enableCommentsOnChildForms: false,
            workspaceId: 'interaction_workspace_synthetic',
            extensionOwnerUID: 'interaction_owner_synthetic',
            faviconUrl: null,
            googleAnalyticsMeasurementId: null,
            isStarterExtension: false,
            extensionScreen: 'form_loaded',
            payload: {
                baseId: 'interaction_base_synthetic',
                loggedInUserCanEditExtension: false,
                showMiniExtensionsBranding: true,
                onFreePlan: true,
                trialExpiresAtUnixEpoch: null,
                extensionType: 'form',
                extensionName: 'Synthetic interaction Form',
                extensionAccessToken: token,
                hasParentExtension: false,
                publicFields: {},
                formRecord: {
                    type: 'edit',
                    tableId: 'tbl_interaction_synthetic',
                    recordId: 'rec_interaction_synthetic',
                    data: initial,
                },
                formErrors: {},
                fieldIdsInForm: schemas.map(
                    (schema) => schema.airtableField.id
                ),
                fieldNamesToSchemas: Object.fromEntries(
                    schemas.map((schema) => [schema.airtableField.name, schema])
                ),
                fieldIdsToSchemas: Object.fromEntries(
                    schemas.map((schema) => [schema.airtableField.id, schema])
                ),
                formFieldIdsWithUnsavedChanges: [],
                urlPrefilledFieldIds: [],
                linkedRecordFieldIdToDetailFields: {},
                cookieKeyForLoginToken: null,
            },
        });
    const state = {
        scenario,
        synthetic: true,
        realNetworkEnabled: false,
        calls: [],
        events: [],
        unexpected: [],
        pending: null,
        expected: { multiple, adding, filterValues: values, initial },
    };
    let release = null;
    let delayedFilter = false;
    let delayedRead = false;
    const fail = (message) => {
        state.unexpected.push(message);
        throw new Error(message);
    };
    const json = (value) =>
        new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    const defer = async (route, signal) => {
        if (release != null)
            return fail('Only one bounded synthetic read can be pending.');
        state.pending = { route };
        state.events.push({ type: 'deferred-start', route });
        await new Promise((done) => {
            release = done;
        });
        state.pending = null;
        state.events.push({
            type: 'deferred-settled',
            route,
            aborted: signal?.aborted === true,
        });
        // Return the already-started READ after cancellation. Real SDK and
        // application signal/owner fences must discard it; this is no write.
    };
    const transport = async (resource, init = {}) => {
        const url = new URL(
            resource instanceof Request ? resource.url : String(resource)
        );
        const method =
            init.method ??
            (resource instanceof Request ? resource.method : 'GET');
        if (
            url.origin !== 'https://synthetic-sdk.invalid' ||
            init.credentials !== 'omit'
        )
            return fail('Non-synthetic origin or credential mode refused.');
        init.signal?.throwIfAborted();
        let input;
        try {
            input = JSON.parse(
                method === 'GET'
                    ? (url.searchParams.get('input') ?? '{}')
                    : String(init.body ?? '{}')
            );
        } catch {
            return fail('Malformed synthetic input.');
        }
        const route = url.searchParams.get('route') ?? url.pathname;
        const visibleInput = { ...input };
        delete visibleInput.miniExtStorageV4;
        delete visibleInput.miniExtSession;
        state.calls.push({
            route,
            method,
            input: structuredClone(visibleInput),
            credentialsMode: init.credentials,
        });
        if (route === 'fetchExtensionForEndUser') {
            if (
                method !== 'POST' ||
                input.shareId !== 'privacy_share_synthetic' ||
                input.childExtensionInfo
            )
                return fail('Unexpected synthetic root load.');
            return json(page());
        }
        if (input.extensionAccessToken !== token)
            return fail('Unexpected synthetic Form scope.');
        if (route === '/api/trpc/airtable.addNewAirtableOptionForFormField') {
            if (
                !adding ||
                method !== 'POST' ||
                input.airtableFieldId !== 'fld_choices' ||
                input.newChoiceText !== ' bEtA '
            )
                return fail(
                    'Unexpected synthetic existing-choice resolution scope.'
                );
            // The canonical route may resolve an equivalent existing name.
            // Return the exact current metadata ID/name; create no metadata.
            state.events.push({
                type: 'existing-choice-returned',
                choiceId: 'sel_beta',
                choiceName: 'Beta',
                metadataCreated: false,
            });
            return json({
                result: {
                    data: { newChoice: { id: 'sel_beta', name: 'Beta' } },
                },
            });
        }
        if (route === 'saveForm') {
            if (
                method !== 'POST' ||
                input.formRecord?.recordId !== 'rec_interaction_synthetic' ||
                input.formRecord?.tableId !== 'tbl_interaction_synthetic' ||
                input.context?.type !== 'direct-url'
            )
                return fail('Unexpected synthetic native Save scope.');
            const value =
                input.formRecord?.data?.[
                    linked ? 'fld_projects' : 'fld_choices'
                ];
            if (
                linked
                    ? !Array.isArray(value) ||
                      value.some(
                          (id) =>
                              ![
                                  'rec_retained',
                                  'rec_available',
                                  'rec_page_two',
                              ].includes(id)
                      )
                    : multiple
                      ? !Array.isArray(value) ||
                        value.some((name) => !['Alpha', 'Beta'].includes(name))
                      : value !== null && !['Alpha', 'Beta'].includes(value)
            )
                return fail('Save must preserve native names/record IDs.');
            // Normal validation output preserves the actual app draft for
            // subsequent probes. These cases prove dispatch, not persistence.
            return json({
                type: 'error',
                formValidationErrors: [],
                formErrors: {},
            });
        }
        if (!linked)
            return fail(
                'Choice fixture permits only root load, explicit Save and the bounded existing-choice resolution variant.'
            );
        if (
            route ===
            '/api/trpc/publicExtensions.fetchInitialTableIdsToLinkedTableStates'
        ) {
            if (method !== 'GET')
                return fail('Metadata procedure requires GET.');
            return json({ result: { data: metadata } });
        }
        if (
            route === 'fetchPrimaryValuesForConditionalLinkedRecordFilterField'
        ) {
            const entry = definitions.find(
                (definition) =>
                    definition.id === input.linkedRecordsFilterFieldId
            );
            if (
                method !== 'POST' ||
                input.mainTableLinkedRecordsFieldId !== 'fld_projects' ||
                !entry
            )
                return fail('Unexpected synthetic filter scope.');
            if (scenario === 'linked-filter-deferred' && !delayedFilter) {
                delayedFilter = true;
                await defer(route, init.signal);
            }
            return json({
                primaryValues: values[entry.id],
                prefillValue:
                    values[entry.id].find(
                        (pair) => pair.stringValue === input.urlSearchValue
                    ) ?? null,
            });
        }
        if (route === 'fetchRecordsForFormLinkedRecordsSelector') {
            if (
                method !== 'POST' ||
                input.linkedRecordFieldId !== 'fld_projects' ||
                input.filter?.viewType !== 'list' ||
                (input.offset !== null &&
                    input.offset !== 'cursor_interaction_next')
            )
                return fail('Unexpected synthetic choice-read cursor/scope.');
            if (scenario === 'linked-filter-deferred' && !delayedRead) {
                delayedRead = true;
                await defer(route, init.signal);
            }
            const second = input.offset === 'cursor_interaction_next';
            return json({
                records: second
                    ? [
                          {
                              id: 'rec_page_two',
                              fields: { fld_project_name: 'Page two project' },
                          },
                      ]
                    : [
                          {
                              id: 'rec_retained',
                              fields: { fld_project_name: 'Retained project' },
                          },
                          {
                              id: 'rec_available',
                              fields: { fld_project_name: 'Available project' },
                          },
                      ],
                offset: second ? null : 'cursor_interaction_next',
                tableIdsToLinkedTableStates: metadata,
            });
        }
        return fail(
            'Unsupported interaction route refused; no real fetch fallback.'
        );
    };
    const releaseDeferred = () => {
        if (release == null) return;
        const done = release;
        release = null;
        state.events.push({
            type: 'deferred-release',
            route: state.pending?.route,
        });
        done();
    };
    return {
        state,
        fetch: transport,
        ...(scenario === 'linked-filter-deferred' ? { releaseDeferred } : {}),
    };
}

/** Shared synthetic responses for packed and native conditional projection. */
export function createProjectionFixture(scenario) {
    const multiple = scenario === 'projection-multiple';
    const token = 'FAKE_SYNTHETIC_PROJECTION_TOKEN';
    const field = (id, name, type, options = null) => ({
        id,
        name,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type, options },
    });
    const show = field('fld_projection_show', 'Show driver', 'checkbox', {
        icon: 'check',
        color: 'greenBright',
    });
    const driver = field(
        'fld_projection_driver',
        'Projection driver',
        'singleLineText'
    );
    const witness = field(
        'fld_projection_witness',
        'Readonly full-record witness',
        'singleLineText'
    );
    const choice = field(
        multiple ? 'fld_projection_multiple' : 'fld_projection_single',
        multiple ? 'Multiple projected choices' : 'Single projected choice',
        multiple ? 'multipleSelects' : 'singleSelect',
        {
            choices: [
                { id: 'sel_alpha', name: 'Alpha' },
                { id: 'sel_beta', name: 'Beta' },
                { id: 'sel_gamma', name: 'Gamma' },
            ],
        }
    );
    const conditions = (id, setting) => ({
        logicalOperator: 'and',
        conditions: [{ id, type: 'singleCondition', setting }],
    });
    const schema = (entry, miniExtConfig = {}) => ({
        fieldType: entry.config.type,
        airtableField: entry,
        miniExtConfig,
    });
    const betaConditions = conditions('hidden_driver_empty', {
        type: 'isEmpty',
        fieldType: 'singleLineText',
        idOrName: { type: 'id', id: driver.id },
    });
    betaConditions.conditions.push(
        ...conditions('projected_readonly_witness', {
            type: 'contains',
            fieldType: 'singleLineText',
            idOrName: { type: 'id', id: witness.id },
            value: 'Retained readonly',
        }).conditions
    );
    const schemas = [
        schema(show),
        schema(driver, {
            conditionalFields: conditions('show_driver', {
                type: 'is',
                fieldType: 'checkbox',
                idOrName: { type: 'id', id: show.id },
                value: true,
            }),
        }),
        schema(witness, {
            readOnly: true,
            conditionalFields: conditions('witness_full_record', {
                type: 'contains',
                fieldType: 'singleLineText',
                idOrName: { type: 'id', id: driver.id },
                value: 'allowed',
            }),
        }),
        schema(choice, {
            enableConditionalOptions: true,
            singleOrMultiSelectLimitSelectionOptions: ['sel_alpha', 'sel_beta'],
            conditionsForOptions: [
                {
                    id: 'projected_beta',
                    config: {
                        optionForConditions: 'sel_beta',
                        name: 'Projected Beta',
                        conditionsForOption: betaConditions,
                    },
                },
            ],
        }),
    ];
    const initial = {
        [show.id]: true,
        [driver.id]: 'allowed',
        [witness.id]: 'Retained readonly text',
        [choice.id]: multiple ? [] : null,
        fld_projection_unrendered_multi: ['Retained', 'Native'],
        fld_projection_unrendered_linked: ['rec_projection_parent'],
        fld_projection_unrendered_barcode: { text: '003', type: 'code128' },
    };
    const state = {
        scenario,
        synthetic: true,
        realNetworkEnabled: false,
        calls: [],
        events: [],
        unexpected: [],
        expected: {
            multiple,
            initial,
            choiceFieldId: choice.id,
            controlFieldIds: schemas.map((entry) => entry.airtableField.id),
            recordId: 'rec_projection_synthetic',
            tableId: 'tbl_projection_synthetic',
        },
    };
    const page = () =>
        structuredClone({
            extensionId: 'projection_form_synthetic',
            language: 'en',
            themeColor: 'blue',
            enableCommentsOnChildForms: false,
            workspaceId: 'projection_workspace_synthetic',
            extensionOwnerUID: 'projection_owner_synthetic',
            faviconUrl: null,
            googleAnalyticsMeasurementId: null,
            isStarterExtension: false,
            extensionScreen: 'form_loaded',
            payload: {
                baseId: 'projection_base_synthetic',
                loggedInUserCanEditExtension: false,
                showMiniExtensionsBranding: true,
                onFreePlan: true,
                trialExpiresAtUnixEpoch: null,
                extensionType: 'form',
                extensionName: 'Synthetic flat scalar projection Form',
                extensionAccessToken: token,
                hasParentExtension: false,
                publicFields: {},
                formRecord: {
                    type: 'edit',
                    tableId: state.expected.tableId,
                    recordId: state.expected.recordId,
                    data: initial,
                },
                formErrors: {},
                fieldIdsInForm: schemas.map((entry) => entry.airtableField.id),
                fieldNamesToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.name, entry])
                ),
                fieldIdsToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.id, entry])
                ),
                formFieldIdsWithUnsavedChanges: [],
                urlPrefilledFieldIds: [],
                linkedRecordFieldIdToDetailFields: {},
                cookieKeyForLoginToken: null,
            },
        });
    const fail = (message) => {
        state.unexpected.push(message);
        throw new Error(message);
    };
    const json = (value) =>
        new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    const transport = async (resource, init = {}) => {
        const url = new URL(
            resource instanceof Request ? resource.url : String(resource)
        );
        const method =
            init.method ??
            (resource instanceof Request ? resource.method : 'GET');
        if (
            url.origin !== 'https://synthetic-sdk.invalid' ||
            init.credentials !== 'omit'
        )
            return fail('Non-synthetic projection origin or credentials.');
        init.signal?.throwIfAborted();
        let input;
        try {
            input = JSON.parse(
                method === 'GET'
                    ? (url.searchParams.get('input') ?? '{}')
                    : String(init.body ?? '{}')
            );
        } catch {
            return fail('Malformed synthetic projection input.');
        }
        const route = url.searchParams.get('route') ?? url.pathname;
        const visibleInput = { ...input };
        delete visibleInput.miniExtStorageV4;
        delete visibleInput.miniExtSession;
        state.calls.push({
            route,
            method,
            input: structuredClone(visibleInput),
            credentialsMode: init.credentials,
        });
        if (route === 'fetchExtensionForEndUser') {
            if (
                method !== 'POST' ||
                input.shareId !== 'privacy_share_synthetic' ||
                input.childExtensionInfo
            )
                return fail('Unexpected synthetic projection root load.');
            return json(page());
        }
        if (
            route !== 'saveForm' ||
            method !== 'POST' ||
            input.extensionAccessToken !== token ||
            input.formRecord?.type !== 'edit' ||
            input.formRecord?.recordId !== state.expected.recordId ||
            input.formRecord?.tableId !== state.expected.tableId ||
            input.context?.type !== 'direct-url'
        )
            return fail('Unexpected projection route or native Save scope.');
        const value = input.formRecord.data[choice.id];
        if (
            multiple
                ? !Array.isArray(value) ||
                  value.some((name) => !['Alpha', 'Beta'].includes(name))
                : value !== null && !['Alpha', 'Beta'].includes(value)
        )
            return fail('Projection Save requires native names, not IDs.');
        // A validation response retains the real draft; no persisted record
        // or backend permission result is simulated by this fixture.
        return json({
            type: 'error',
            formValidationErrors: [],
            formErrors: {},
        });
    };
    return { state, page, fetch: transport };
}

/** Combined Review/empty-hiding fixture; the three existing fixtures stay intact. */
export function createHideEmptyReviewFixture(scenario) {
    if (
        !['hide-empty-review', 'hide-empty-review-malformed'].includes(scenario)
    )
        throw new Error('Unknown combined empty-hiding Review scenario.');
    const fixture = createEditHideEmptyFixture('hide-empty-edit');
    const malformed = scenario === 'hide-empty-review-malformed';
    const blankFieldIds = fixture.state.expected.controlFieldIds.filter(
        (id) =>
            !['fld_empty_rich', 'fld_empty_locked', 'fld_empty_tail'].includes(
                id
            )
    );
    const initial = {
        ...structuredClone(fixture.state.expected.initial),
        ...Object.fromEntries(blankFieldIds.map((id) => [id, ' \t\n '])),
        ...(malformed
            ? { fld_empty_barcode: 'PrivateCombinedMalformedBarcode' }
            : {}),
    };
    fixture.state.scenario = scenario;
    fixture.state.expected = {
        ...fixture.state.expected,
        initial: structuredClone(initial),
        blankFieldIds,
        controlFieldIds: fixture.state.expected.controlFieldIds.filter(
            (id) => id !== 'fld_empty_rich'
        ),
        initialDirtyFieldIds: [...blankFieldIds],
    };
    const page = () => {
        const loaded = fixture.page();
        loaded.payload.formRecord.data = structuredClone(initial);
        loaded.payload.fieldIdsInForm = [
            ...fixture.state.expected.controlFieldIds,
        ];
        loaded.payload.formFieldIdsWithUnsavedChanges = [...blankFieldIds];
        loaded.payload.publicFields.state = {
            promptUserBeforeSubmission: true,
        };
        if (malformed)
            loaded.payload.fieldIdsToSchemas.fld_empty_barcode.miniExtConfig.hideFieldIfEmpty = false;
        return loaded;
    };
    const fetch = async (resource, init) => {
        const response = await fixture.fetch(resource, init);
        const url = new URL(
            resource instanceof Request ? resource.url : String(resource)
        );
        // The base transport closes over its own page/initial. Transform the
        // actual root response too, using the independent native map above.
        if (url.searchParams.get('route') === 'fetchExtensionForEndUser')
            return new Response(JSON.stringify(page()), {
                status: response.status,
                headers: response.headers,
            });
        return response;
    };
    return { state: fixture.state, page, fetch };
}

/** Empty hiding is presentation only; the fixture retains every native value. */
export function createEditHideEmptyFixture(scenario) {
    if (
        ![
            'hide-empty-edit',
            'hide-empty-create',
            'hide-empty-unavailable',
        ].includes(scenario)
    )
        throw new Error('Unknown synthetic empty-hiding scenario.');
    const create = scenario === 'hide-empty-create';
    const unavailable = scenario === 'hide-empty-unavailable';
    const token = 'FAKE_SYNTHETIC_HIDE_EMPTY_TOKEN';
    const families = [
        [
            'title',
            'singleLineText',
            create || unavailable ? null : 'Required retained answer',
        ],
        ['email', 'email', null],
        ['url', 'url', ''],
        ['multiline', 'multilineText', '   '],
        ['phone', 'phoneNumber', null],
        ['rich', 'richText', '  '],
        ['number', 'number', 0],
        ['currency', 'currency', 0],
        ['percent', 'percent', 0],
        ['rating', 'rating', 0],
        ['checkbox', 'checkbox', false],
        ['barcode', 'barcode', { text: '   ', type: 'code128' }],
        ['locked', 'singleLineText', 'Retained readonly native answer'],
        ['tail', 'singleLineText', 'Adjacent native answer'],
    ];
    const fields = families.map(([name, type]) => ({
        id: `fld_empty_${name}`,
        name: name === 'title' ? 'Hidden required answer' : `Empty ${name}`,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: {
            type,
            options:
                type === 'checkbox'
                    ? { icon: 'check', color: 'greenBright' }
                    : type === 'rating'
                      ? { max: 5, icon: 'star', color: 'yellowBright' }
                      : type === 'currency'
                        ? { precision: 2, symbol: '$' }
                        : ['number', 'percent'].includes(type)
                          ? { precision: 2 }
                          : null,
        },
    }));
    const initial = {
        ...Object.fromEntries(
            families.map(([name, , value]) => [`fld_empty_${name}`, value])
        ),
        fld_empty_unrendered_multi: ['Retained', 'Native'],
        fld_empty_unrendered_linked: ['rec_empty_parent'],
        fld_empty_unrendered_barcode: { text: '004', type: 'code128' },
    };
    const state = {
        scenario,
        synthetic: true,
        realNetworkEnabled: false,
        calls: [],
        events: [],
        unexpected: [],
        pending: null,
        expected: {
            initial,
            controlFieldIds: fields.map((field) => field.id),
            tableId: 'tbl_empty_synthetic',
            recordId: 'rec_empty_synthetic',
            initialDirtyFieldIds: ['fld_empty_title'],
            urlPrefilledFieldIds: ['fld_empty_number'],
            validationMessage:
                'This hidden answer is still required by the synthetic response.',
        },
    };
    let rootLoads = 0;
    const page = () => {
        const blocked = unavailable && rootLoads <= 1;
        const schemas = fields.map((field, index) => ({
            fieldType: field.config.type,
            airtableField: field,
            miniExtConfig: {
                ...(index < 12
                    ? { hideFieldIfEmpty: !(unavailable && !blocked) }
                    : {}),
                ...(['fld_empty_email', 'fld_empty_locked'].includes(field.id)
                    ? { readOnly: true }
                    : {}),
                ...(field.id === 'fld_empty_title' && !create && !unavailable
                    ? { required: true }
                    : {}),
                ...(field.id === 'fld_empty_tail' && blocked
                    ? {
                          headerSectionTitle: 'Retained disabled section',
                          enableSectionHeader: false,
                      }
                    : {}),
            },
        }));
        return structuredClone({
            extensionId: 'empty_form_synthetic',
            language: 'en',
            themeColor: 'blue',
            enableCommentsOnChildForms: false,
            workspaceId: 'empty_workspace_synthetic',
            extensionOwnerUID: 'empty_owner_synthetic',
            faviconUrl: null,
            googleAnalyticsMeasurementId: null,
            isStarterExtension: false,
            extensionScreen: 'form_loaded',
            payload: {
                baseId: 'empty_base_synthetic',
                loggedInUserCanEditExtension: false,
                showMiniExtensionsBranding: true,
                onFreePlan: true,
                trialExpiresAtUnixEpoch: null,
                extensionType: 'form',
                extensionName: 'Synthetic edit empty-hiding Form',
                extensionAccessToken: token,
                hasParentExtension: false,
                publicFields: {},
                formRecord: create
                    ? { type: 'create', data: initial }
                    : {
                          type: 'edit',
                          tableId: state.expected.tableId,
                          recordId: state.expected.recordId,
                          data: initial,
                      },
                formErrors: {},
                fieldIdsInForm: state.expected.controlFieldIds,
                fieldNamesToSchemas: Object.fromEntries(
                    schemas.map((schema) => [schema.airtableField.name, schema])
                ),
                fieldIdsToSchemas: Object.fromEntries(
                    schemas.map((schema) => [schema.airtableField.id, schema])
                ),
                formFieldIdsWithUnsavedChanges:
                    state.expected.initialDirtyFieldIds,
                urlPrefilledFieldIds: state.expected.urlPrefilledFieldIds,
                linkedRecordFieldIdToDetailFields: {},
                cookieKeyForLoginToken: null,
            },
        });
    };
    const fail = (message) => {
        state.unexpected.push(message);
        throw new Error(message);
    };
    const json = (value) =>
        new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    const fetch = async (resource, init = {}) => {
        const url = new URL(
            resource instanceof Request ? resource.url : String(resource)
        );
        const method =
            init.method ??
            (resource instanceof Request ? resource.method : 'GET');
        if (
            url.origin !== 'https://synthetic-sdk.invalid' ||
            init.credentials !== 'omit'
        )
            return fail(
                'Non-synthetic empty-hiding origin or credential mode refused.'
            );
        init.signal?.throwIfAborted();
        let input;
        try {
            input = JSON.parse(
                method === 'GET'
                    ? (url.searchParams.get('input') ?? '{}')
                    : String(init.body ?? '{}')
            );
        } catch {
            return fail('Malformed synthetic empty-hiding input.');
        }
        const route = url.searchParams.get('route') ?? url.pathname;
        const visibleInput = { ...input };
        delete visibleInput.miniExtStorageV4;
        delete visibleInput.miniExtSession;
        state.calls.push({
            route,
            method,
            input: structuredClone(visibleInput),
            credentialsMode: init.credentials,
        });
        if (route === 'fetchExtensionForEndUser') {
            if (
                method !== 'POST' ||
                input.shareId !== 'privacy_share_synthetic' ||
                input.childExtensionInfo
            )
                return fail('Unexpected synthetic empty-hiding root load.');
            rootLoads++;
            state.events.push({
                type: 'hide-empty-root-response',
                load: rootLoads,
                blocked: unavailable && rootLoads === 1,
            });
            return json(page());
        }
        if (
            route !== 'saveForm' ||
            method !== 'POST' ||
            input.extensionAccessToken !== token ||
            input.formRecord?.type !== (create ? 'create' : 'edit') ||
            input.context?.type !== 'direct-url' ||
            (!create &&
                (input.formRecord?.recordId !== state.expected.recordId ||
                    input.formRecord?.tableId !== state.expected.tableId))
        )
            return fail('Unexpected empty-hiding route or native Save scope.');
        if (unavailable && rootLoads === 1)
            return fail('Blocked empty hiding must stop before Save dispatch.');
        return json({
            type: 'error',
            formValidationErrors:
                !create && !unavailable
                    ? [
                          {
                              fieldId: 'fld_empty_title',
                              fieldTitle: 'Hidden required answer',
                              errorMessage: state.expected.validationMessage,
                          },
                      ]
                    : [],
            formErrors: {},
        });
    };
    return { state, page, fetch };
}

/** Native one-page visibility fixtures; no application actions are simulated. */
function createVisibilityFixture(scenario) {
    const token = 'FAKE_SYNTHETIC_VISIBILITY_TOKEN';
    const unavailable = scenario === 'visibility-unavailable';
    const section = scenario === 'visibility-section';
    const field = (id, name, type = 'singleLineText', options = null) => ({
        id,
        name,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type, options },
    });
    const driver = field('fld_visibility_driver', 'Show details', 'checkbox', {
        icon: 'check',
        color: 'greenBright',
    });
    const text = field('fld_visibility_text', 'Conditional text');
    const locked = field('fld_visibility_readonly', 'Conditional readonly');
    const number = field(
        'fld_visibility_number',
        'Conditional number',
        'number',
        { precision: 2 }
    );
    const tail = field('fld_visibility_tail', 'Unconditional tail');
    const lead = field('fld_visibility_lead', 'Section lead');
    const follower = field('fld_visibility_follower', 'Section follower');
    const reset = field('fld_visibility_reset', 'Reset section');
    const selection = field(
        'fld_visibility_select',
        'Published selection',
        'singleSelect',
        { choices: [{ id: 'sel_visibility_red', name: 'Red' }] }
    );
    const supported = {
        logicalOperator: 'and',
        conditions: [
            {
                id: 'visibility_checkbox_condition',
                type: 'singleCondition',
                setting: {
                    type: 'is',
                    fieldType: 'checkbox',
                    idOrName: { type: 'id', id: driver.id },
                    value: true,
                },
            },
        ],
    };
    const unsupported = {
        logicalOperator: 'and',
        conditions: [
            {
                id: 'visibility_unsupported_select_condition',
                type: 'singleCondition',
                setting: {
                    type: 'is',
                    fieldType: 'singleSelect',
                    idOrName: { type: 'id', id: selection.id },
                    value: 'sel_visibility_red',
                },
            },
        ],
    };
    const initial = {
        [driver.id]: unavailable,
        [text.id]: 'Retained conditional text',
        [locked.id]: 'Locked native value',
        [number.id]: 7,
        [tail.id]: 'Adjacent native value',
        [lead.id]: 'Retained lead',
        [follower.id]: 'Retained follower',
        [reset.id]: 'Reset stays available',
        [selection.id]: 'Red',
        // These complete native values are deliberately outside the rendered
        // field list. Visibility must never prune/coerce the Save draft.
        fld_visibility_unrendered_multi: ['Legacy', 'Red'],
        fld_visibility_unrendered_linked: ['rec_visibility_parent'],
        fld_visibility_unrendered_barcode: { text: '001', type: 'code128' },
    };
    const fieldIds = section
        ? [driver.id, lead.id, follower.id, reset.id, tail.id]
        : unavailable
          ? [driver.id, text.id, tail.id]
          : [driver.id, text.id, locked.id, number.id, tail.id];
    const state = {
        scenario,
        synthetic: true,
        realNetworkEnabled: false,
        calls: [],
        events: [],
        unexpected: [],
        pending: null,
        expected: {
            initial,
            controlFieldIds: fieldIds,
            recordId: 'rec_visibility_synthetic',
            tableId: 'tbl_visibility_synthetic',
        },
    };
    let rootLoads = 0;
    const schema = (entry, miniExtConfig = {}) => ({
        fieldType: entry.config.type,
        airtableField: entry,
        miniExtConfig,
    });
    const page = () => {
        const blocked = unavailable && rootLoads === 1;
        const schemas = [
            schema(driver),
            schema(text, {
                conditionalFields: blocked ? unsupported : supported,
            }),
            schema(locked, { readOnly: true, conditionalFields: supported }),
            schema(number, { conditionalFields: supported }),
            schema(tail),
            schema(lead, {
                headerSectionTitle: 'Conditional section',
                enableSectionHeader: true,
                applyFieldConditionsToSection: true,
                conditionalFields: supported,
            }),
            schema(follower),
            schema(reset, {
                headerSectionTitle: 'Next section',
                enableSectionHeader: true,
            }),
            schema(selection),
        ];
        return structuredClone({
            extensionId: 'visibility_form_synthetic',
            language: 'en',
            themeColor: 'blue',
            enableCommentsOnChildForms: false,
            workspaceId: 'visibility_workspace_synthetic',
            extensionOwnerUID: 'visibility_owner_synthetic',
            faviconUrl: null,
            googleAnalyticsMeasurementId: null,
            isStarterExtension: false,
            extensionScreen: 'form_loaded',
            payload: {
                baseId: 'visibility_base_synthetic',
                loggedInUserCanEditExtension: false,
                showMiniExtensionsBranding: true,
                onFreePlan: true,
                trialExpiresAtUnixEpoch: null,
                extensionType: 'form',
                extensionName: 'Synthetic one-page visibility Form',
                extensionAccessToken: token,
                hasParentExtension: false,
                publicFields: {},
                formRecord: {
                    type: 'edit',
                    tableId: state.expected.tableId,
                    recordId: state.expected.recordId,
                    data: initial,
                },
                formErrors: {},
                fieldIdsInForm: fieldIds,
                fieldNamesToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.name, entry])
                ),
                fieldIdsToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.id, entry])
                ),
                formFieldIdsWithUnsavedChanges: [],
                urlPrefilledFieldIds: [],
                linkedRecordFieldIdToDetailFields: {},
                cookieKeyForLoginToken: null,
            },
        });
    };
    const fail = (message) => {
        state.unexpected.push(message);
        throw new Error(message);
    };
    const json = (value) =>
        new Response(JSON.stringify(value), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    const transport = async (resource, init = {}) => {
        const url = new URL(
            resource instanceof Request ? resource.url : String(resource)
        );
        const method =
            init.method ??
            (resource instanceof Request ? resource.method : 'GET');
        if (
            url.origin !== 'https://synthetic-sdk.invalid' ||
            init.credentials !== 'omit'
        )
            return fail(
                'Non-synthetic visibility origin or credential mode refused.'
            );
        init.signal?.throwIfAborted();
        let input;
        try {
            input = JSON.parse(
                method === 'GET'
                    ? (url.searchParams.get('input') ?? '{}')
                    : String(init.body ?? '{}')
            );
        } catch {
            return fail('Malformed synthetic visibility input.');
        }
        const route = url.searchParams.get('route') ?? url.pathname;
        const visibleInput = { ...input };
        delete visibleInput.miniExtStorageV4;
        delete visibleInput.miniExtSession;
        state.calls.push({
            route,
            method,
            input: structuredClone(visibleInput),
            credentialsMode: init.credentials,
        });
        if (route === 'fetchExtensionForEndUser') {
            if (
                method !== 'POST' ||
                input.shareId !== 'privacy_share_synthetic' ||
                input.childExtensionInfo
            )
                return fail('Unexpected synthetic visibility root load.');
            rootLoads += 1;
            state.events.push({
                type: 'visibility-root-response',
                load: rootLoads,
                condition:
                    unavailable && rootLoads === 1
                        ? 'unsupported-singleSelect'
                        : 'supported-checkbox',
            });
            return json(page());
        }
        if (
            route !== 'saveForm' ||
            method !== 'POST' ||
            input.extensionAccessToken !== token ||
            input.formRecord?.type !== 'edit' ||
            input.formRecord?.recordId !== state.expected.recordId ||
            input.formRecord?.tableId !== state.expected.tableId ||
            input.context?.type !== 'direct-url'
        )
            return fail(
                'Unexpected visibility route or native Save scope; no real fetch fallback.'
            );
        if (unavailable && rootLoads === 1)
            return fail(
                'Unsupported visibility must stop before Save dispatch.'
            );
        // The actual application builds the complete native Save input. Normal
        // validation output retains that draft; no persistence is simulated.
        return json({
            type: 'error',
            formValidationErrors: [],
            formErrors: {},
        });
    };
    return { state, fetch: transport };
}

/** Bounded address responses; controls settle transport only, never app state. */
function createAddressFixture(scenario) {
    const token = 'FAKE_SYNTHETIC_ADDRESS_TOKEN';
    const predictionRoute =
        '/api/trpc/publicExtensions.autoCompleteAddressField';
    const detailRoute =
        '/api/trpc/publicExtensions.getFormattedAddressFromPlaceId';
    const conditional = scenario === 'address-lifecycle';
    const field = (id, name, type = 'singleLineText', options = null) => ({
        id,
        name,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type, options },
    });
    const address = field('fld_address_synthetic', 'Address');
    const driver = field('fld_address_driver', 'Show address', 'checkbox', {
        icon: 'check',
        color: 'greenBright',
    });
    const tail = field('fld_address_tail', 'Adjacent text');
    const initial = {
        [address.id]: 'Loaded address',
        [driver.id]: true,
        [tail.id]: 'Adjacent native value',
        fld_address_unrendered_multi: ['Retained', 'Native'],
        fld_address_unrendered_linked: ['rec_address_parent'],
        fld_address_unrendered_barcode: { text: '007', type: 'code128' },
    };
    const predictions = [
        {
            description: 'Selected native address beyond cap',
            placeId: 'place_address_one',
        },
        {
            description: '<b>Alternate native address</b>',
            placeId: 'place_address_two',
        },
    ];
    const fieldIds = conditional
        ? [driver.id, address.id, tail.id]
        : [address.id, tail.id];
    const state = {
        scenario,
        synthetic: true,
        realNetworkEnabled: false,
        calls: [],
        events: [],
        unexpected: [],
        pending: [],
        abortCounts: { predictions: 0, details: 0, save: 0 },
        expected: {
            initial,
            controlFieldIds: fieldIds,
            characterLimit: 24,
            predictions,
            formatted: 'Formatted native address beyond cap',
            recordId: 'rec_address_synthetic',
            tableId: 'tbl_address_synthetic',
        },
    };
    const schema = (entry, miniExtConfig = {}) => ({
        fieldType: entry.config.type,
        airtableField: entry,
        miniExtConfig,
    });
    const schemas = [
        schema(address, {
            enableAddressAutocomplete: true,
            characterLimit: state.expected.characterLimit,
            ...(conditional
                ? {
                      conditionalFields: {
                          logicalOperator: 'and',
                          conditions: [
                              {
                                  id: 'address_checkbox_condition',
                                  type: 'singleCondition',
                                  setting: {
                                      type: 'is',
                                      fieldType: 'checkbox',
                                      idOrName: { type: 'id', id: driver.id },
                                      value: true,
                                  },
                              },
                          ],
                      },
                  }
                : {}),
        }),
        schema(driver),
        schema(tail),
    ];
    const page = () =>
        structuredClone({
            extensionId: 'address_form_synthetic',
            language: 'en',
            themeColor: 'blue',
            enableCommentsOnChildForms: false,
            workspaceId: 'address_workspace_synthetic',
            extensionOwnerUID: 'address_owner_synthetic',
            faviconUrl: null,
            googleAnalyticsMeasurementId: null,
            isStarterExtension: false,
            extensionScreen: 'form_loaded',
            payload: {
                baseId: 'address_base_synthetic',
                loggedInUserCanEditExtension: false,
                showMiniExtensionsBranding: true,
                onFreePlan: true,
                trialExpiresAtUnixEpoch: null,
                extensionType: 'form',
                extensionName: 'Synthetic bounded address Form',
                extensionAccessToken: token,
                hasParentExtension: false,
                publicFields: {},
                formRecord: {
                    type: 'edit',
                    tableId: state.expected.tableId,
                    recordId: state.expected.recordId,
                    data: initial,
                },
                formErrors: {},
                fieldIdsInForm: fieldIds,
                fieldNamesToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.name, entry])
                ),
                fieldIdsToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.id, entry])
                ),
                formFieldIdsWithUnsavedChanges: [],
                urlPrefilledFieldIds: [],
                linkedRecordFieldIdToDetailFields: {},
                cookieKeyForLoginToken: null,
            },
        });
    const fail = (message) => {
        state.unexpected.push(message);
        throw new Error(message);
    };
    const json = (value, status = 200) =>
        new Response(JSON.stringify(value), {
            status,
            headers: { 'Content-Type': 'application/json' },
        });
    const waiting = [];
    let nextRead = 0;
    const defer = (kind, route, signal) => {
        if (waiting.length >= 2)
            return fail('Only two concurrent synthetic address responses fit.');
        const entry = { id: ++nextRead, kind, route, aborted: false };
        state.pending.push(entry);
        const aborted = () => {
            if (entry.aborted) return;
            entry.aborted = true;
            state.abortCounts[kind] += 1;
            state.events.push({ type: 'address-response-aborted', ...entry });
        };
        signal?.addEventListener('abort', aborted, { once: true });
        return new Promise((resolve) => {
            waiting.push({
                entry,
                resolve: (outcome) => {
                    signal?.removeEventListener('abort', aborted);
                    state.pending = state.pending.filter(
                        (pending) => pending.id !== entry.id
                    );
                    state.events.push({
                        type: 'address-response-settled',
                        ...entry,
                        outcome,
                    });
                    resolve(outcome);
                },
            });
        });
    };
    const settle = (kind, outcome) => {
        const index = waiting.findIndex((read) => read.entry.kind === kind);
        if (index < 0) return;
        const [read] = waiting.splice(index, 1);
        read.resolve(outcome);
    };
    const transport = async (resource, init = {}) => {
        const url = new URL(
            resource instanceof Request ? resource.url : String(resource)
        );
        const method =
            init.method ??
            (resource instanceof Request ? resource.method : 'GET');
        if (
            url.origin !== 'https://synthetic-sdk.invalid' ||
            init.credentials !== 'omit'
        )
            return fail('Non-synthetic address origin or credentials refused.');
        init.signal?.throwIfAborted();
        let input;
        try {
            input = JSON.parse(
                method === 'GET'
                    ? (url.searchParams.get('input') ?? '{}')
                    : String(init.body ?? '{}')
            );
        } catch {
            return fail('Malformed synthetic address input.');
        }
        const route = url.searchParams.get('route') ?? url.pathname;
        const visibleInput = { ...input };
        delete visibleInput.miniExtStorageV4;
        delete visibleInput.miniExtSession;
        state.calls.push({
            route,
            method,
            input: structuredClone(visibleInput),
            credentialsMode: init.credentials,
        });
        if (route === 'fetchExtensionForEndUser') {
            if (
                method !== 'POST' ||
                input.shareId !== 'privacy_share_synthetic' ||
                input.childExtensionInfo
            )
                return fail('Unexpected synthetic address root load.');
            return json(page());
        }
        if (input.extensionAccessToken !== token)
            return fail('Unexpected synthetic address token scope.');
        if (route === predictionRoute || route === detailRoute) {
            if (method !== 'GET' || input.fieldId !== address.id)
                return fail('Unexpected synthetic address field/read scope.');
            const kind = route === predictionRoute ? 'predictions' : 'details';
            if (
                kind === 'predictions'
                    ? typeof input.addressFieldValue !== 'string' ||
                      input.addressFieldValue.trim() === '' ||
                      input.addressFieldValue.length > 200
                    : !predictions.some(
                          (prediction) => prediction.placeId === input.placeId
                      )
            )
                return fail('Unexpected synthetic address query/place input.');
            // Deliberately deliver after abort. The installed SDK and current
            // starter/presenter must reject the retired response themselves.
            const outcome = await defer(kind, route, init.signal);
            if (outcome === 'failure')
                return json(
                    { error: { message: 'Synthetic unavailable' } },
                    503
                );
            return json({
                result: {
                    data:
                        kind === 'predictions'
                            ? predictions
                            : state.expected.formatted,
                },
            });
        }
        if (
            route !== 'saveForm' ||
            method !== 'POST' ||
            input.formRecord?.type !== 'edit' ||
            input.formRecord?.recordId !== state.expected.recordId ||
            input.formRecord?.tableId !== state.expected.tableId ||
            input.context?.type !== 'direct-url'
        )
            return fail(
                'Unexpected address route or native Save scope; no real fetch fallback.'
            );
        if (scenario === 'address-lifecycle')
            await defer('save', route, init.signal);
        // A normal validation result retains the native draft. There is no
        // persistence, provider, permission or automatic-retry simulation.
        return json({
            type: 'error',
            formValidationErrors: [],
            formErrors: {},
        });
    };
    return {
        state,
        fetch: transport,
        addressControls: [
            [
                'Release address predictions',
                () => settle('predictions', 'success'),
            ],
            [
                'Fail address predictions',
                () => settle('predictions', 'failure'),
            ],
            ['Release address details', () => settle('details', 'success')],
            ['Fail address details', () => settle('details', 'failure')],
            ...(scenario === 'address-lifecycle'
                ? [
                      [
                          'Release address Save validation',
                          () => settle('save', 'success'),
                      ],
                  ]
                : []),
        ],
    };
}

/** Explicit synthetic DOM composition markers, never an OS IME driver. */
function createAddressCompositionFixture() {
    const fixture = createAddressFixture('address-acceptance');
    fixture.state.scenario = 'address-ime';
    fixture.state.expected.composition = {
        proofScope: 'synthetic DOM composition events; no OS IME proof',
        composingValue: '東京都千代田区丸の内一丁目二番地の未確定入力を保持',
        committedValue: '東京都千代田区',
        keyNames: ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'],
    };
    const getInput = () => {
        const input = document.querySelector(
            '#screen input[data-field-id="fld_address_synthetic"]'
        );
        if (!(input instanceof HTMLInputElement) || input.disabled)
            throw new Error(
                'Synthetic composition requires the active address input.'
            );
        return input;
    };
    const marker = (input, event, supplied) => {
        const before = {
            value: input.value,
            activeDescendant: input.getAttribute('aria-activedescendant'),
        };
        const dispatchReturned = input.dispatchEvent(event);
        fixture.state.events.push({
            type: 'synthetic-dom-composition-marker',
            supplied,
            observed: {
                type: event.type,
                isTrusted: event.isTrusted,
                isComposing: event.isComposing ?? null,
                key: event.key ?? null,
                keyCode: event.keyCode ?? null,
                defaultPrevented: event.defaultPrevented,
                dispatchReturned,
            },
            before,
            after: {
                value: input.value,
                activeDescendant: input.getAttribute('aria-activedescendant'),
            },
        });
    };
    fixture.compositionControls = [
        [
            'Start synthetic DOM composition',
            () => {
                const input = getInput();
                marker(
                    input,
                    new CompositionEvent('compositionstart', { bubbles: true }),
                    { type: 'compositionstart' }
                );
            },
        ],
        [
            'Update synthetic composing Japanese input',
            () => {
                const input = getInput();
                input.value = fixture.state.expected.composition.composingValue;
                marker(
                    input,
                    new InputEvent('input', {
                        bubbles: true,
                        isComposing: true,
                        inputType: 'insertCompositionText',
                        data: input.value,
                    }),
                    {
                        type: 'input',
                        isComposing: true,
                        inputType: 'insertCompositionText',
                        value: input.value,
                    }
                );
            },
        ],
        [
            'Dispatch synthetic composing keyboard markers',
            () => {
                const input = getInput();
                for (const flags of [{ isComposing: true }, { keyCode: 229 }])
                    for (const key of fixture.state.expected.composition
                        .keyNames) {
                        const supplied = { type: 'keydown', key, ...flags };
                        marker(
                            input,
                            new KeyboardEvent('keydown', {
                                key,
                                ...flags,
                                bubbles: true,
                                cancelable: true,
                            }),
                            supplied
                        );
                    }
            },
        ],
        [
            'Commit synthetic DOM composition',
            () => {
                const input = getInput();
                input.value = fixture.state.expected.composition.committedValue;
                marker(
                    input,
                    new CompositionEvent('compositionend', {
                        bubbles: true,
                        data: input.value,
                    }),
                    { type: 'compositionend', value: input.value }
                );
                marker(
                    input,
                    new InputEvent('input', {
                        bubbles: true,
                        isComposing: false,
                        inputType: 'insertText',
                        data: input.value,
                    }),
                    {
                        type: 'input',
                        isComposing: false,
                        inputType: 'insertText',
                        value: input.value,
                    }
                );
            },
        ],
    ];
    return fixture;
}

function createTeardownFixture(scenario) {
    const token = 'FAKE_SYNTHETIC_TEARDOWN_TOKEN';
    const privateText = 'Previous visitor private narrative';
    const privateTitle = 'Previous visitor private field label';
    const privateFilename = 'previous-visitor-private-attachment.pdf';
    const initial = {
        fld_title: 'Initial public title',
        fld_files: [
            {
                url: 'https://synthetic-files.invalid/private-reference',
                filename: privateFilename,
            },
        ],
        fld_readonly: 'Public readonly witness',
        fld_number: 7,
        fld_checkbox: true,
    };
    const fresh = {
        fld_title: 'Fresh public baseline',
        fld_files: [],
        fld_readonly: 'Fresh public readonly witness',
        fld_number: 0,
        fld_checkbox: false,
    };
    const field = (id, name, type, options = null) => ({
        id,
        name,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type, options },
    });
    const state = {
        scenario,
        synthetic: true,
        realNetworkEnabled: false,
        calls: [],
        events: [],
        unexpected: [],
        expected: {
            token,
            initial,
            fresh,
            privateText,
            privateTitle,
            privateFilename,
            publicTitle: 'Current public title',
        },
    };
    let loads = 0;
    let saves = 0;
    const page = (first) => {
        const title = first ? privateTitle : state.expected.publicTitle;
        const entries = [
            [field('fld_title', title, 'singleLineText'), { title }],
            [
                field('fld_files', 'Files', 'multipleAttachments', {
                    isReversed: false,
                }),
                {},
            ],
            [
                field('fld_readonly', 'Public readonly', 'singleLineText'),
                { readOnly: true },
            ],
            [
                field('fld_number', 'Public number', 'number', {
                    precision: 0,
                }),
                {},
            ],
            [
                field('fld_checkbox', 'Public checkbox', 'checkbox', {
                    icon: 'check',
                    color: 'greenBright',
                }),
                {},
            ],
        ].map(([airtableField, miniExtConfig]) => ({
            fieldType: airtableField.config.type,
            airtableField,
            miniExtConfig,
        }));
        return structuredClone({
            extensionId: 'teardown_form_synthetic',
            language: 'en',
            themeColor: 'blue',
            enableCommentsOnChildForms: false,
            workspaceId: 'teardown_workspace_synthetic',
            extensionOwnerUID: 'teardown_owner_synthetic',
            faviconUrl: null,
            googleAnalyticsMeasurementId: null,
            isStarterExtension: false,
            extensionScreen: 'form_loaded',
            payload: {
                baseId: 'teardown_base_synthetic',
                loggedInUserCanEditExtension: false,
                showMiniExtensionsBranding: true,
                onFreePlan: true,
                trialExpiresAtUnixEpoch: null,
                extensionType: 'form',
                extensionName: 'Synthetic public anonymous Form',
                extensionAccessToken: token,
                hasParentExtension: false,
                publicFields: {},
                formRecord: { type: 'create', data: first ? initial : fresh },
                formErrors: {},
                fieldIdsInForm: entries.map((entry) => entry.airtableField.id),
                fieldNamesToSchemas: Object.fromEntries(
                    entries.map((entry) => [entry.airtableField.name, entry])
                ),
                fieldIdsToSchemas: Object.fromEntries(
                    entries.map((entry) => [entry.airtableField.id, entry])
                ),
                // The journal retains attachment names only from dirty fields.
                formFieldIdsWithUnsavedChanges: first ? ['fld_files'] : [],
                urlPrefilledFieldIds: [],
                linkedRecordFieldIdToDetailFields: {},
                cookieKeyForLoginToken: null,
            },
        });
    };
    const fail = (message) => {
        state.unexpected.push(message);
        throw new Error(message);
    };
    const transport = async (request, init = {}) => {
        const url = new URL(
            request instanceof Request ? request.url : String(request)
        );
        if (url.origin !== 'https://synthetic-sdk.invalid')
            return fail('Real/unrecognized teardown origin refused.');
        if (init.credentials !== 'omit')
            return fail('Teardown fixture requires anonymous SDK transport.');
        init.signal?.throwIfAborted();
        const method =
            init.method ??
            (request instanceof Request ? request.method : 'GET');
        const route = url.searchParams.get('route') ?? url.pathname;
        let input;
        try {
            input = JSON.parse(
                method === 'GET'
                    ? (url.searchParams.get('input') ?? '{}')
                    : String(init.body ?? '{}')
            );
        } catch {
            return fail('Unexpected teardown JSON request.');
        }
        const visibleInput = { ...input };
        delete visibleInput.miniExtStorageV4;
        delete visibleInput.miniExtSession;
        state.calls.push({
            route,
            method,
            input: structuredClone(visibleInput),
            credentialsMode: init.credentials,
        });
        if (route === 'fetchExtensionForEndUser') {
            if (
                input.shareId !== 'privacy_share_synthetic' ||
                input.childExtensionInfo != null ||
                input.recordId !== null ||
                input.context?.type !== 'direct-url'
            )
                return fail('Unexpected standalone teardown Form load.');
            loads += 1;
            const result = page(loads === 1);
            state.events.push({
                type: 'synthetic-teardown-form-load',
                load: loads,
                formRecord: structuredClone(result.payload.formRecord),
                dirtyFieldIds: [
                    ...result.payload.formFieldIdsWithUnsavedChanges,
                ],
            });
            return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (route === 'saveForm') {
            saves += 1;
            if (method !== 'POST' || saves !== 1)
                return fail('An uncertain teardown create must never replay.');
            state.events.push({ type: 'synthetic-create-response-lost' });
            // An expected handled transport failure leaves the real journal
            // outcome unknown. It grants no durable persistence credit.
            throw new Error('Synthetic create response lost after dispatch.');
        }
        return fail(
            'Unsupported teardown route; no network fallback: ' + route
        );
    };
    return { state, fetch: transport };
}

/** Review responses reuse normal scalar controls and existing transport fences. */
export function createReviewFixture(scenario) {
    if (scenario === 'review-address') {
        const fixture = createAddressFixture('address-lifecycle');
        fixture.state.scenario = scenario;
        const fetch = fixture.fetch;
        return {
            ...fixture,
            fetch: async (resource, init) => {
                const response = await fetch(resource, init);
                const url = new URL(
                    resource instanceof Request
                        ? resource.url
                        : String(resource)
                );
                if (
                    url.searchParams.get('route') !== 'fetchExtensionForEndUser'
                )
                    return response;
                const page = await response.json();
                page.payload.publicFields.state = {
                    promptUserBeforeSubmission: true,
                };
                return new Response(JSON.stringify(page), {
                    headers: { 'Content-Type': 'application/json' },
                });
            },
        };
    }
    const token = 'FAKE_SYNTHETIC_REVIEW_TOKEN';
    const required = scenario === 'review-validation';
    const held = scenario === 'review-unknown';
    const field = (id, name, type, options = null) => ({
        id,
        name,
        description: null,
        isComputed: false,
        isPrimaryField: false,
        config: { type, options },
    });
    const schema = (entry, miniExtConfig = {}) => ({
        fieldType: entry.config.type,
        airtableField: entry,
        miniExtConfig,
    });
    const title = field('fld_review_title', 'Review answer', 'singleLineText');
    const show = field(
        'fld_review_show',
        'Show conditional answer',
        'checkbox',
        {
            icon: 'check',
            color: 'greenBright',
        }
    );
    const conditional = field(
        'fld_review_conditional',
        'Conditional answer',
        'singleLineText'
    );
    const readonly = field(
        'fld_review_readonly',
        'Plain readonly answer',
        'singleLineText'
    );
    const url = field('fld_review_url', 'Plain URL answer', 'url');
    const number = field('fld_review_number', 'Zero count', 'number', {
        precision: 0,
    });
    const rating = field('fld_review_rating', 'Empty rating', 'rating', {
        max: 5,
        icon: 'star',
        color: 'yellowBright',
    });
    const barcode = field('fld_review_barcode', 'Empty barcode', 'barcode');
    const schemas = [
        schema(
            title,
            required
                ? { title: 'Required answer', required: true }
                : {
                      title: '<b>Semantic secret</b>',
                      obscurePassword: true,
                      showTitle: false,
                  }
        ),
        schema(show),
        schema(conditional, {
            conditionalFields: {
                logicalOperator: 'and',
                conditions: [
                    {
                        id: 'review_conditional_answer',
                        type: 'singleCondition',
                        setting: {
                            type: 'is',
                            fieldType: 'checkbox',
                            idOrName: { type: 'id', id: show.id },
                            value: true,
                        },
                    },
                ],
            },
        }),
        schema(readonly, { readOnly: true }),
        schema(url),
        schema(number),
        schema(rating),
        schema(barcode),
    ];
    const initial = {
        [title.id]: required ? null : 'CaseSensitiveReviewSecret',
        [show.id]: !required,
        [conditional.id]: 'Retained conditional answer',
        [readonly.id]: '<img src=x onerror=alert(1)>',
        [url.id]: 'https://example.test/review?value=<b>literal</b>',
        [number.id]: 0,
        [rating.id]: 0,
        [barcode.id]: { text: '   ', type: 'code128' },
        fld_review_unrendered_multi: ['Retained', 'Native'],
        fld_review_unrendered_linked: ['rec_review_parent'],
        fld_review_unrendered_barcode: { text: '004', type: 'code128' },
    };
    const state = {
        scenario,
        synthetic: true,
        realNetworkEnabled: false,
        calls: [],
        events: [],
        unexpected: [],
        pending: [],
        abortCounts: { save: 0 },
        expected: {
            initial,
            controlFieldIds: schemas.map((entry) => entry.airtableField.id),
            recordId: 'rec_review_synthetic',
            tableId: 'tbl_review_synthetic',
            validationMessage: 'A review answer is required.',
        },
    };
    const page = () =>
        structuredClone({
            extensionId: 'review_form_synthetic',
            language: 'en',
            themeColor: 'blue',
            enableCommentsOnChildForms: false,
            workspaceId: 'review_workspace_synthetic',
            extensionOwnerUID: 'review_owner_synthetic',
            faviconUrl: null,
            googleAnalyticsMeasurementId: null,
            isStarterExtension: false,
            extensionScreen: 'form_loaded',
            payload: {
                baseId: 'review_base_synthetic',
                loggedInUserCanEditExtension: false,
                showMiniExtensionsBranding: true,
                onFreePlan: true,
                trialExpiresAtUnixEpoch: null,
                extensionType: 'form',
                extensionName: 'Synthetic prepared review Form',
                extensionAccessToken: token,
                hasParentExtension: false,
                publicFields: { state: { promptUserBeforeSubmission: true } },
                formRecord: {
                    type: 'edit',
                    tableId: state.expected.tableId,
                    recordId: state.expected.recordId,
                    data: initial,
                },
                formErrors: {},
                fieldIdsInForm: schemas.map((entry) => entry.airtableField.id),
                fieldNamesToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.name, entry])
                ),
                fieldIdsToSchemas: Object.fromEntries(
                    schemas.map((entry) => [entry.airtableField.id, entry])
                ),
                formFieldIdsWithUnsavedChanges: [],
                urlPrefilledFieldIds: [],
                linkedRecordFieldIdToDetailFields: {},
                cookieKeyForLoginToken: null,
            },
        });
    const fail = (message) => {
        state.unexpected.push(message);
        throw new Error(message);
    };
    const json = (value) =>
        new Response(JSON.stringify(value), {
            headers: { 'Content-Type': 'application/json' },
        });
    let release;
    let loseReviewResponse = false;
    const fetch = async (resource, init = {}) => {
        const url = new URL(
            resource instanceof Request ? resource.url : String(resource)
        );
        const method =
            init.method ??
            (resource instanceof Request ? resource.method : 'GET');
        if (
            url.origin !== 'https://synthetic-sdk.invalid' ||
            init.credentials !== 'omit'
        )
            return fail('Non-synthetic review origin or credentials.');
        init.signal?.throwIfAborted();
        let input;
        try {
            input = JSON.parse(
                method === 'GET'
                    ? (url.searchParams.get('input') ?? '{}')
                    : String(init.body ?? '{}')
            );
        } catch {
            return fail('Malformed synthetic review input.');
        }
        const route = url.searchParams.get('route') ?? url.pathname;
        const visibleInput = { ...input };
        delete visibleInput.miniExtStorageV4;
        delete visibleInput.miniExtSession;
        state.calls.push({
            route,
            method,
            input: structuredClone(visibleInput),
            credentialsMode: init.credentials,
        });
        if (route === 'fetchExtensionForEndUser') {
            if (
                method !== 'POST' ||
                input.shareId !== 'privacy_share_synthetic' ||
                input.childExtensionInfo
            )
                return fail('Unexpected synthetic review root load.');
            return json(page());
        }
        if (
            route !== 'saveForm' ||
            method !== 'POST' ||
            input.extensionAccessToken !== token ||
            input.formRecord?.type !== 'edit' ||
            input.formRecord?.recordId !== state.expected.recordId ||
            input.formRecord?.tableId !== state.expected.tableId ||
            input.context?.type !== 'direct-url'
        )
            return fail('Unexpected review route or native Save scope.');
        if (held) {
            if (release != null)
                return fail('Only one review Save may be pending.');
            const pending = {
                id: 'review-save-1',
                kind: 'save',
                aborted: false,
            };
            state.pending.push(pending);
            init.signal?.addEventListener(
                'abort',
                () => {
                    pending.aborted = true;
                    state.abortCounts.save += 1;
                    state.events.push({
                        type: 'review-save-aborted',
                        id: pending.id,
                    });
                },
                { once: true }
            );
            await new Promise((done) => {
                release = done;
            });
            state.pending = [];
            state.events.push({
                type: 'review-save-settled',
                id: pending.id,
                aborted: pending.aborted,
            });
            if (loseReviewResponse)
                throw new Error('Synthetic confirmed Review response lost.');
            // Deliver the already-started response despite cancellation; the
            // actual SDK and starter own its rejection and uncertain state.
        }
        return json({
            type: 'error',
            formValidationErrors: required
                ? [
                      {
                          fieldId: title.id,
                          fieldTitle: 'Required answer',
                          errorMessage: state.expected.validationMessage,
                      },
                  ]
                : [],
            formErrors: required
                ? { [title.id]: state.expected.validationMessage }
                : {},
        });
    };
    return {
        state,
        page,
        fetch,
        ...(held
            ? {
                  addressControls: [
                      [
                          'Lose held review Save response',
                          () => {
                              const done = release;
                              if (done == null) return;
                              release = null;
                              loseReviewResponse = true;
                              done();
                          },
                      ],
                      [
                          'Release held review Save',
                          () => {
                              const done = release;
                              release = null;
                              if (done == null) return;
                              state.events.push({
                                  type: 'review-save-released',
                                  id: 'review-save-1',
                              });
                              done();
                          },
                      ],
                  ],
              }
            : {}),
    };
}

/** Read-only snapshots plus an explicit native synthetic-read release button. */
function installProofInspection(fixture, kind) {
    const banner = document.createElement('section');
    banner.className = 'proof-banner';
    banner.innerHTML =
        '<h1>Synthetic packed SDK privacy proof</h1><p>Manual or separately authorized hosted W3C browser exercise. No backend, real credentials, network fallback or permission grant. Refreshing this document resets synthetic state.</p><p><a href="../index.html">All scenarios</a></p><button type="button">Inspect current trace and UI</button><pre hidden></pre>';
    document.body.prepend(banner);
    const snapshot = () => {
        const application =
            kind === 'starter'
                ? document.querySelector('#screen')
                : document.querySelector('#auth-root');
        return {
            kind,
            scenario: fixture.state.scenario,
            expected: fixture.state.expected,
            busy:
                kind === 'starter'
                    ? application?.getAttribute('aria-busy') === 'true'
                    : null,
            applicationText: application?.textContent ?? '',
            status:
                kind === 'starter'
                    ? document.querySelector('#status')?.textContent
                    : application?.querySelector('[role="status"]')
                          ?.textContent,
            inputs: [...(application?.querySelectorAll('input') ?? [])].map(
                (input) => ({
                    type: input.type,
                    fieldId: input.dataset.fieldId ?? null,
                    autocomplete: input.autocomplete,
                })
            ),
            address:
                fixture.state.scenario.startsWith('address-') ||
                fixture.state.scenario === 'review-address'
                    ? {
                          controls: [
                              ...(application?.querySelectorAll(
                                  '[data-field-id]'
                              ) ?? []),
                          ]
                              .filter((control) =>
                                  fixture.state.expected.controlFieldIds.includes(
                                      control.dataset.fieldId
                                  )
                              )
                              .map((control) => ({
                                  fieldId: control.dataset.fieldId,
                                  id: control.id,
                                  type: control.type,
                                  hidden: control.closest('[hidden]') !== null,
                                  visible: control.getClientRects().length > 0,
                                  disabled: control.disabled,
                                  value:
                                      control.type === 'checkbox'
                                          ? control.checked
                                          : control.value,
                                  focused: document.activeElement === control,
                              })),
                          presenters: [
                              ...(application?.querySelectorAll(
                                  '[data-ui="address-autocomplete"]'
                              ) ?? []),
                          ].map((presenter) => ({
                              fieldId:
                                  presenter.querySelector('input')?.dataset
                                      .fieldId,
                              expanded: presenter
                                  .querySelector('input')
                                  ?.getAttribute('aria-expanded'),
                              activeDescendant: presenter
                                  .querySelector('input')
                                  ?.getAttribute('aria-activedescendant'),
                              status:
                                  presenter.querySelector('p')?.textContent ??
                                  '',
                              statusRole: presenter
                                  .querySelector('p')
                                  ?.getAttribute('role'),
                              retryHidden: presenter.querySelector(
                                  ':scope > button:last-child'
                              )?.hidden,
                              retryDisabled: presenter.querySelector(
                                  ':scope > button:last-child'
                              )?.disabled,
                              options: [
                                  ...presenter.querySelectorAll(
                                      '[role="option"]'
                                  ),
                              ].map((option) => ({
                                  label: option.textContent,
                                  selected:
                                      option.getAttribute('aria-selected') ===
                                      'true',
                                  hidden: option.closest('[hidden]') !== null,
                                  visible: option.getClientRects().length > 0,
                                  disabled: option.disabled,
                              })),
                          })),
                          screenInert: application?.inert ?? false,
                          fieldsInert:
                              application?.querySelector('.fields')?.inert ??
                              false,
                          activeFieldId:
                              document.activeElement?.dataset.fieldId ?? null,
                          abortCounts: structuredClone(
                              fixture.state.abortCounts
                          ),
                      }
                    : null,
            review:
                fixture.state.scenario.startsWith('review-') ||
                ['hide-empty-review', 'hide-empty-review-malformed'].includes(
                    fixture.state.scenario
                )
                    ? {
                          dialogs: [
                              ...document.querySelectorAll(
                                  'dialog[data-form-review]'
                              ),
                          ].map((dialog) => ({
                              open: dialog.open,
                              role: dialog.getAttribute('role'),
                              text: dialog.textContent,
                              rows: [...dialog.querySelectorAll('dt')].map(
                                  (label) => ({
                                      fieldId: label.dataset.reviewFieldId,
                                      title: label.textContent,
                                      hideTitle:
                                          label.dataset.reviewTitleHidden ===
                                          'true',
                                      labelId: label.id,
                                      value: label.nextElementSibling
                                          ?.textContent,
                                      labelledBy:
                                          label.nextElementSibling?.getAttribute(
                                              'aria-labelledby'
                                          ),
                                  })
                              ),
                              nestedMarkup:
                                  dialog.querySelectorAll('img,b,a').length,
                          })),
                          controls: [
                              ...(application?.querySelectorAll(
                                  '[data-field-id]'
                              ) ?? []),
                          ]
                              .filter((control) =>
                                  fixture.state.expected.controlFieldIds.includes(
                                      control.dataset.fieldId
                                  )
                              )
                              .map((control) => ({
                                  fieldId: control.dataset.fieldId,
                                  type: control.type,
                                  hidden: control.closest('[hidden]') !== null,
                                  disabled: control.disabled,
                                  value:
                                      control.type === 'checkbox'
                                          ? control.checked
                                          : control.value,
                              })),
                          fieldsInert:
                              application?.querySelector('.fields')?.inert ??
                              false,
                          activeButton:
                              document.activeElement?.tagName === 'BUTTON'
                                  ? document.activeElement.textContent
                                  : null,
                          errors: [
                              ...(application?.querySelectorAll(
                                  '.error-list li'
                              ) ?? []),
                          ].map((node) => node.textContent),
                          abortCounts: structuredClone(
                              fixture.state.abortCounts
                          ),
                      }
                    : null,
            visibility:
                fixture.state.scenario.startsWith('visibility-') ||
                fixture.state.scenario.startsWith('hide-empty-') ||
                fixture.state.scenario.startsWith('projection-')
                    ? {
                          controls: [
                              ...(application?.querySelectorAll(
                                  '[data-field-id]'
                              ) ?? []),
                          ]
                              .filter((control) =>
                                  fixture.state.expected.controlFieldIds.includes(
                                      control.dataset.fieldId
                                  )
                              )
                              .map((control) => ({
                                  fieldId: control.dataset.fieldId,
                                  type: control.type,
                                  hidden: control.closest('[hidden]') !== null,
                                  disabled: control.disabled,
                                  value:
                                      control.type === 'checkbox'
                                          ? control.checked
                                          : control.value,
                                  badInput: control.validity?.badInput ?? false,
                                  valid: control.validity?.valid ?? true,
                              })),
                          activeFieldId:
                              document.activeElement?.dataset.fieldId ?? null,
                          alerts: [
                              ...(application?.querySelectorAll(
                                  '[role="alert"]'
                              ) ?? []),
                          ].map((alert) => ({
                              text: alert.textContent ?? '',
                              hidden: alert.closest('[hidden]') !== null,
                          })),
                          errors: [
                              ...(application?.querySelectorAll(
                                  '.error-list li'
                              ) ?? []),
                          ].map((node) => node.textContent),
                      }
                    : null,
            selects: [...(application?.querySelectorAll('select') ?? [])].map(
                (select) => ({
                    fieldId: select.dataset.fieldId ?? null,
                    filterFieldId: select.dataset.filterFieldId ?? null,
                    value: select.value,
                    multiple: select.multiple,
                    disabled: select.disabled,
                    options: [...select.options].map((option) => ({
                        value: option.value,
                        label: option.textContent,
                        selected: option.selected,
                        disabled: option.disabled,
                    })),
                })
            ),
            linkedDraft:
                application?.querySelector(
                    'textarea[data-field-id="fld_projects"]'
                )?.value ?? null,
            pending: structuredClone(fixture.state.pending ?? null),
            cells: [...(application?.querySelectorAll('tbody tr') ?? [])].map(
                (row) => ({
                    recordId: row.dataset.recordId,
                    cells: [...row.querySelectorAll('td')].map((cell) => ({
                        text: cell.textContent,
                        title: cell.title,
                    })),
                })
            ),
            calls: structuredClone(fixture.state.calls),
            events: structuredClone(fixture.state.events),
            unexpected: [...fixture.state.unexpected],
        };
    };
    window.__privacyBrowserProof = Object.freeze({ snapshot });
    if (fixture.addressControls)
        for (const [text, settle] of fixture.addressControls) {
            const control = document.createElement('button');
            control.type = 'button';
            control.textContent = text;
            control.dataset.proofControl = 'address-response';
            control.addEventListener('click', settle);
            banner.append(control);
        }
    if (fixture.compositionControls)
        for (const [text, dispatch] of fixture.compositionControls) {
            const control = document.createElement('button');
            control.type = 'button';
            control.textContent = text;
            control.dataset.proofControl = 'synthetic-dom-composition';
            control.addEventListener('click', dispatch);
            banner.append(control);
        }
    if (fixture.releaseDeferred) {
        const release = document.createElement('button');
        release.type = 'button';
        release.textContent = 'Release pending synthetic read';
        release.dataset.proofControl = 'release-read';
        release.addEventListener('click', fixture.releaseDeferred);
        banner.append(release);
    }
    const button = banner.querySelector('button');
    button.addEventListener('click', () => {
        const pre = banner.querySelector('pre');
        pre.hidden = false;
        pre.textContent = JSON.stringify(snapshot(), null, 2);
    });
    window.addEventListener('error', (event) =>
        fixture.state.unexpected.push('Browser error: ' + event.message)
    );
    window.addEventListener('unhandledrejection', (event) =>
        fixture.state.unexpected.push(
            'Unhandled rejection: ' + String(event.reason)
        )
    );
}

function starterBootstrap() {
    const scenario =
        new URL(location.href).searchParams.get('scenario') ?? 'pin';
    const fixture = createPrivacyFixture(scenario);
    globalThis.fetch = fixture.fetch;
    installProofInspection(fixture, 'starter');
    for (const [id, value] of [
        ['api-origin', 'https://synthetic-sdk.invalid'],
        ['share-id', 'privacy_share_synthetic'],
    ]) {
        const input = document.getElementById(id);
        input.value = value;
        input.readOnly = true;
    }
    // User must choose Connect, login/code actions, record reads and Grid save.
    return import('./main.js');
}

const csp =
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const proofCss = `body{font-family:system-ui,sans-serif;line-height:1.5;color:#20304a;background:#f4f6fa;margin:0;padding:24px}main,.proof-banner,#auth-root{max-width:1050px;margin:0 auto 24px}.proof-banner{border:2px solid #48618a;padding:18px;background:white}.proof-banner h1{font-size:1.35rem}pre{overflow:auto;white-space:pre-wrap;background:#eef1f6;padding:16px}a{color:#174d9c}label{display:block;margin:12px 0}input,button,select{font:inherit;padding:8px}fieldset{margin:14px 0}li{margin:10px 0}.card{background:white;padding:16px}button{cursor:pointer}`;
const shell = (title, body, scripts = '') =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${title}</title><link rel="stylesheet" href="../proof.css"></head><body>${body}${scripts}</body></html>\n`;

/** Build a static kit, never pack/install/serve or execute browser interactions. */
export async function buildPrivacyBrowserProof({
    browserConsumerDirectory,
    authConsumerDirectory,
    outputDirectory,
    source,
    packageSha256,
    ci = {},
}) {
    assert.match(packageSha256, /^[a-f0-9]{64}$/);
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    assert.match(source.tree, /^[a-f0-9]{40}$/);
    const browser = realpathSync(browserConsumerDirectory);
    const auth = realpathSync(authConsumerDirectory);
    const browserSdk = realpathSync(join(browser, 'node_modules', sdkName));
    const authSdk = realpathSync(join(auth, 'node_modules', sdkName));
    assert(
        within(browser, browserSdk) && within(auth, authSdk),
        'SDK must be installed locally, never checkout-linked.'
    );
    const packageMetadata = JSON.parse(
        regular(join(browserSdk, 'package.json'))
    );
    assert.equal(packageMetadata.name, sdkName);
    const manifest = JSON.parse(regular(join(browser, 'package.json')));
    const spec = manifest.dependencies?.[sdkName];
    assert(
        typeof spec === 'string' && spec.startsWith('file:'),
        'Copied starter must resolve the supplied local TGZ.'
    );
    const archivePath = resolve(browser, spec.slice(5));
    const archive = regular(archivePath);
    assert.equal(
        sha256(archive),
        packageSha256,
        'Exact checked TGZ digest differs.'
    );
    const archived = new Map();
    const archiveMember = (path) => {
        assert(!path.startsWith('/') && !path.split('/').includes('..'));
        if (!archived.has(path))
            archived.set(
                path,
                execFileSync('tar', ['-xzOf', '-', `package/${path}`], {
                    input: archive,
                    maxBuffer: 4 * 1024 * 1024,
                    timeout: 10000,
                })
            );
        return archived.get(path);
    };
    const sources = [];
    for (const path of starterFiles) {
        const bytes = regular(join(browser, path));
        assert.deepEqual(
            bytes,
            regular(join(browserSdk, 'examples/browser', path)),
            'Copied source differs from installed starter: ' + path
        );
        assert.deepEqual(
            bytes,
            archiveMember('examples/browser/' + path),
            'Installed starter differs from exact archive: ' + path
        );
        sources.push({
            origin: 'packed-browser-starter',
            path,
            bytes: bytes.length,
            sha256: sha256(bytes),
        });
    }
    const guide = regular(join(authSdk, 'docs/auth.md'));
    assert.deepEqual(
        guide,
        archiveMember('docs/auth.md'),
        'Installed AuthPanel documentation differs from archive.'
    );
    const recipes = [
        ...guide.toString('utf8').matchAll(/```tsx\n([\s\S]*?)\n```/g),
    ]
        .map((match) => match[1])
        .filter((code) => code.includes('export function AuthPanel('));
    assert.equal(
        recipes.length,
        1,
        'Expected exactly one complete shipped AuthPanel recipe.'
    );
    const recipe = recipes[0];
    const authRequire = createRequire(join(auth, 'package.json'));
    for (const name of ['react', 'react-dom']) {
        const path = authRequire.resolve(`${name}/package.json`);
        assert(
            within(join(auth, 'node_modules'), realpathSync(path)),
            'React must resolve from the clean auth consumer.'
        );
        assert.equal(JSON.parse(regular(path)).version, '19.2.0');
    }
    assert(isAbsolute(outputDirectory), 'Output directory must be absolute.');
    const output = resolve(outputDirectory);
    assert.equal(
        join(realpathSync(dirname(output)), basename(output)),
        output,
        'Output parent must be free of symlinks.'
    );
    assert(
        !within(browser, output) && !within(auth, output),
        'Kit must survive consumer cleanup.'
    );
    assert(
        !existsSync(output),
        'Refuse existing output; no unrelated files may be merged/deleted.'
    );
    mkdirSync(output);
    const outputs = [];
    const write = (path, bytes) => {
        const destination = join(output, path);
        mkdirSync(dirname(destination), { recursive: true });
        writeFileSync(destination, bytes, { flag: 'wx' });
        outputs.push({
            path,
            bytes: Buffer.byteLength(bytes),
            sha256: sha256(bytes),
        });
    };
    const inputs = (meta, root, installed, generatedRoot) =>
        Object.keys(meta.inputs).map((name) => {
            const path = resolve(root, name);
            const isGenerated = generatedRoot && within(generatedRoot, path);
            assert(
                isGenerated || within(root, path),
                'Bundle escaped its consumer: ' + name
            );
            const bytes = regular(path);
            if (within(installed, path)) {
                const member = relative(installed, path).replaceAll('\\', '/');
                assert(
                    member.startsWith('dist/'),
                    'Only shipped public SDK modules may be bundled.'
                );
                assert.deepEqual(
                    bytes,
                    archiveMember(member),
                    'SDK module differs from checked TGZ: ' + member
                );
            }
            return {
                origin: isGenerated
                    ? 'synthetic-proof-wrapper-or-doc-fence'
                    : within(installed, path)
                      ? 'installed-sdk-archive'
                      : 'consumer-installed-or-copied-input',
                path: isGenerated
                    ? relative(generatedRoot, path)
                    : relative(root, path),
                bytes: bytes.length,
                sha256: sha256(bytes),
            };
        });
    try {
        const generated = join(output, '.build');
        mkdirSync(generated);
        // Reuse the exact customer starter build already checked by check-package.
        const starterMeta = JSON.parse(
            regular(join(browser, '.generated/metafile.json'))
        );
        const starterInputs = inputs(starterMeta, browser, browserSdk);
        assert(
            starterInputs.some(
                (entry) =>
                    entry.origin === 'installed-sdk-archive' &&
                    entry.path ===
                        'node_modules/@miniextensions/sdk/dist/esm/forms/visibility.js'
            ),
            'Actual starter must bind the installed archive visibility module.'
        );
        assert(
            starterInputs.some(
                (entry) =>
                    entry.origin === 'installed-sdk-archive' &&
                    entry.path ===
                        'node_modules/@miniextensions/sdk/dist/esm/forms/projection.js'
            ),
            'Actual starter must bind the installed archive scalar projection module.'
        );
        assert(
            starterInputs.some(
                (entry) =>
                    entry.origin === 'consumer-installed-or-copied-input' &&
                    entry.path === 'src/review.ts'
            ),
            'Actual starter must bind the exact archive-copied review recipe.'
        );
        assert(
            starterInputs.some(
                (entry) =>
                    entry.origin === 'installed-sdk-archive' &&
                    entry.path ===
                        'node_modules/@miniextensions/sdk/dist/esm/ui/addressAutocomplete.js'
            ),
            'Actual starter must bind the installed archive address autocomplete module.'
        );
        const builtMain = regular(join(browser, '.generated/main.js'));
        write('starter/main.js', builtMain);
        write(
            'starter/main.js.map',
            regular(join(browser, '.generated/main.js.map'))
        );
        write('starter/styles.css', regular(join(browser, 'styles.css')));
        const originalHtml = regular(join(browser, 'index.html')).toString(
            'utf8'
        );
        assert.equal(
            (
                originalHtml.match(
                    /<script\b[^>]*src="\/main\.js"[^>]*><\/script>/g
                ) ?? []
            ).length,
            1
        );
        const starterHtml = originalHtml
            .replace('href="/styles.css"', 'href="./styles.css"')
            .replace(
                /<script\b[^>]*src="\/main\.js"[^>]*><\/script>/,
                '<script type="module" src="./bootstrap.js"></script>'
            )
            .replace(
                '</head>',
                `<meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="../proof.css"></head>`
            );
        write('starter/index.html', starterHtml);
        write(
            'fixture.js',
            `const createTeardownFixture = ${createTeardownFixture.toString()};\nconst createInteractionFixture = ${createInteractionFixture.toString()};\nconst createProjectionFixture = ${createProjectionFixture.toString()};\nconst createEditHideEmptyFixture = ${createEditHideEmptyFixture.toString()};\nconst createHideEmptyReviewFixture = ${createHideEmptyReviewFixture.toString()};\nconst createVisibilityFixture = ${createVisibilityFixture.toString()};\nconst createAddressFixture = ${createAddressFixture.toString()};\nconst createAddressCompositionFixture = ${createAddressCompositionFixture.toString()};\nconst createReviewFixture = ${createReviewFixture.toString()};\nexport const createPrivacyFixture = ${createPrivacyFixture.toString()};\nexport const installProofInspection = ${installProofInspection.toString()};\n`
        );
        write(
            'starter/bootstrap.js',
            `import { createPrivacyFixture, installProofInspection } from '../fixture.js';\n(${starterBootstrap.toString()})();\n`
        );
        write('proof.css', proofCss);
        const recipePath = join(generated, 'AuthPanel.tsx');
        writeFileSync(recipePath, recipe, { flag: 'wx' });
        const authEntry = `import React from 'react';
import { createRoot } from 'react-dom/client';
import { createMiniExtensionsClient } from '@miniextensions/sdk';
import { AuthPanel } from './AuthPanel';
import { createPrivacyFixture, installProofInspection } from '../fixture.js';
const scenario = new URL(location.href).searchParams.get('scenario') ?? 'pin';
const fixture = createPrivacyFixture(scenario);
if (scenario === 'portal') throw new Error('Portal belongs to the actual starter, not AuthPanel.');
globalThis.fetch = fixture.fetch;
installProofInspection(fixture, 'react-auth');
const client = createMiniExtensionsClient({ apiOrigin: 'https://synthetic-sdk.invalid', fetch: fixture.fetch });
const root = createRoot(document.getElementById('auth-root')!);
let scope = { ownerId: 'synthetic-react-owner', revision: 0 };
function renderPanel() {
    const page = fixture.loginPage();
    const captured = { ...scope };
    root.render(<AuthPanel client={client} page={page} ownerScope={captured}
        getScope={() => ({ ...scope })}
        onSessionApplied={() => {
            scope = { ...scope, revision: scope.revision + 1 };
            fixture.state.events.push({ type: 'explicit-session-applied', sessionEntryCount: Object.keys(client.getSession()).length });
            root.render(<p>Host received an explicit session application. Choose the host Reload button to render another synthetic page.</p>);
        }}
        onReload={() => {
            scope = { ...scope, revision: scope.revision + 1 };
            fixture.state.events.push({ type: 'explicit-panel-reload' });
            renderPanel();
        }} />);
}
document.getElementById('host-reload')!.addEventListener('click', () => {
    scope = { ...scope, revision: scope.revision + 1 };
    fixture.state.events.push({ type: 'explicit-host-reload' });
    renderPanel();
});
renderPanel();
`;
        const entryPath = join(generated, 'auth-entry.tsx');
        writeFileSync(entryPath, authEntry, { flag: 'wx' });
        const browserRequire = createRequire(join(browser, 'package.json'));
        const { build } = browserRequire('esbuild');
        const authBundle = await build({
            absWorkingDir: auth,
            entryPoints: [entryPath],
            nodePaths: [join(auth, 'node_modules')],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            jsx: 'automatic',
            define: { 'process.env.NODE_ENV': '"production"' },
            outfile: join(output, 'auth/auth.js'),
            write: false,
            metafile: true,
            sourcemap: false,
            legalComments: 'linked',
            logLevel: 'silent',
            // Keep the shared synthetic transport external; copied starter uses
            // the same file. This is no SDK alias or private source override.
            plugins: [
                {
                    name: 'static-fixture-reference',
                    setup(builder) {
                        builder.onResolve(
                            { filter: /^\.\.\/fixture\.js$/ },
                            () => ({ path: '../fixture.js', external: true })
                        );
                    },
                },
            ],
        });
        const authInputs = inputs(
            authBundle.metafile,
            auth,
            authSdk,
            generated
        );
        for (const file of authBundle.outputFiles)
            write(relative(output, file.path), file.contents);
        write(
            'auth/index.html',
            shell(
                'Complete shipped React AuthPanel synthetic proof',
                '<main><h1>Complete shipped AuthPanel recipe</h1><p>The app host and all responses are synthetic. Recipe code is extracted unchanged from the installed archive.</p><button id="host-reload" type="button">Host Reload</button><div id="auth-root"></div></main>',
                '<script type="module" src="./auth.js"></script>'
            )
        );
        const links = privacyScenarioInventory
            .map(
                (name) =>
                    `<li><a href="starter/index.html?scenario=${name}">Actual starter: ${name === 'portal' ? 'obscured Portal child-config Grid save/reopen' : name}</a>${privacyAuthScenarioInventory.includes(name) ? ` · <a href="auth/index.html?scenario=${name}">Complete AuthPanel: ${name}</a>` : ''}</li>`
            )
            .join('');
        write(
            'index.html',
            shell(
                'Synthetic packed SDK browser proof',
                `<main><h1>Manual synthetic SDK scenarios</h1><p>This static kit contains the actual packed starter and complete shipped AuthPanel recipe. Generation alone proves no browser outcome. Read README.md before recording a result.</p><ul>${links}</ul><p><a href="README.md">Manual assertions and scope</a> · <a href="manifest.json">Source/package manifest</a></p></main>`
            ).replace('href="../proof.css"', 'href="./proof.css"')
        );
        write('SDK-LICENSE', regular(join(authSdk, 'LICENSE')));
        write(
            'SDK-THIRD-PARTY-NOTICES.md',
            regular(join(authSdk, 'THIRD_PARTY_NOTICES.md'))
        );
        for (const name of ['react', 'react-dom'])
            write(
                name + '-LICENSE',
                regular(join(auth, 'node_modules', name, 'LICENSE'))
            );
        const readme = `# Manual packed SDK privacy browser proof

This kit needs only a static server. Serve this directory as its root and open index.html in normal Chrome with certificate verification enabled. The separately authorized hosted W3C proof may consume these exact immutable assets; label its result automated synthetic UI evidence, never independent manual exploration. Do not use CDP, certificate exceptions or changes to existing trust stores/browser profiles. The approved hosted route uses a fresh profile strictly inside its owned disposable work root and audits that concrete path's absence after cleanup. A browser/sandbox/TLS startup failure is a capability blocker, not a successful UI result. The generator installs nothing, starts no server, launches no browser and repacks no package.

Package SHA256: ${packageSha256}
Source commit: ${source.commit}
Source tree: ${source.tree}

## Supported scenario routes

The manifest declares ${privacyScenarioInventory.length} actual-starter scenarios. ${privacyAuthScenarioInventory.length} also expose the complete AuthPanel recipe, giving ${privacyScenarioInventory.length + privacyAuthScenarioInventory.length} menu routes. The generated inventory guard checks every declared factory route and reconciles this list with the menu and manifest; construction alone is not browser execution.

${privacyScenarioInventory.map((name) => `- [Actual starter: ${name}](starter/index.html?scenario=${name})${privacyAuthScenarioInventory.includes(name) ? ` · [Complete AuthPanel: ${name}](auth/index.html?scenario=${name})` : ''}`).join('\n')}

## What is actual and what is synthetic

starter/main.js is the exact existing customer build from the archive-copied browser starter. The starter source bytes and all SDK bundle inputs are compared to fixed members read from the exact checked TGZ. auth/auth.js bundles the entire unchanged AuthPanel TSX code fence from installed docs/auth.md using the installed SDK and consumer React/ReactDOM 19.2.0. Only the host wrapper and public response fixtures are authored here. There is no private implementation/source alias or reduced replacement AuthPanel.

All destinations, credentials, records, tokens and responses are deliberately synthetic. The local transport intercepts the real SDK request protocol, rejects unexpected origins/routes/scopes, and has no real fetch fallback. The page CSP also disallows network connections. The normal browser loads only static kit assets from its server. This is not backend permission, credential secrecy/encryption, OTP delivery, Airtable persistence, TLS connectivity to miniExtensions, or hosted UI parity proof. A document refresh resets in-memory synthetic state.

## Manual input and output assertions

For each Actual starter login link, choose Connect and load (origin/share are already fixed to synthetic values). For AuthPanel links, the complete panel mounts immediately; there is no automatic login.

1. **PIN/Password positive:** PIN uses returned title Portal PIN and credential Exact-Case PIN 07; Password uses Portal Password and Exact-Case Password 09. The starter label remains Identifier. Inspect its input type=password, type the exact credential, then choose Log in and use session (starter) or Log in (AuthPanel). Synthetic response is no-record. The trace must contain one login with exactly {Identifier: entered value}, preserving case/spacing. Input masking must not rewrite credentials.
2. **Ordinary-word negative:** returned title Spinning Identifier contains the substring pin without a password/PIN word boundary. Input type must remain text. Enter Exact ordinary identifier and log in. Trace must preserve that exact Identifier credential and contain one login. No title-inferred password/OTP permission is granted.
3. **Explicit masked email/phone OTP:** Email credential/destination is Privacy.Exact+Email@example.test; Phone is +15550102030. Both use maskPasswordOnLoginScreen=true plus their matching configured requireEmailVerificationToLogin/requirePhoneNumberVerificationToLogin flag. Input type=password. Log in once. The app status must show a fixed eight-bullet destination, not the raw destination. Enter code 123456 and choose Confirm and use session (starter) or Confirm code (AuthPanel). Trace must show login followed by confirmVerificationCodeForLogin with verificationId verification_privacy_synthetic, verificationCode 123456 and language en. On React the message must offer Apply session; no session is applied before you click it. On the starter the existing UI explicitly applies the returned fake session and asks you to Reload. No real email/SMS is delivered.
4. **Portal child-config mask/native Grid:** choose Connect and load, then Load records. In Row Alpha, Private text must show fixed eight bullets and its cell title must not contain the synthetic original; Row Empty must show an empty value (its Edit cell action may remain, but no bullets); Ordinary text must show Ordinary public value. Effective child config wins over deliberately contradictory detail config in both masked and unmasked fields. Click Edit cell in Row Alpha's Private text column. Input type=password and native input value must be Exact Case-Sensitive Original (inspect only; no visible plaintext cell). Replace it with Different-length Saved Value and choose Save cell. Exactly one POST airtable.updatePortalRecord must use recordId rec_private_synthetic, recordFieldId fld_secret_synthetic, portalFieldId fld_children_synthetic, selectedCustomViewId view_privacy_synthetic and that exact native value. The returned body cell must remain fixed-mask. Reopen Edit cell: type=password and native input value must equal the saved value. Choose Cancel, Load records, then Open Form for Row Alpha to inspect the fresh native child payload: Private text remains a password control with that exact saved value. Do not submit the child Form; unrelated mutation routes are deliberately rejected. Empty and ordinary controls must remain unchanged.

At each stage choose Inspect current trace and UI, or read window.__privacyBrowserProof.snapshot() in normal browser developer tools. It only reads state; it triggers no app action/request. Save the manual observations/screenshots and scenario URLs with the manifest digest separately. The snapshot contains synthetic expected values and trace inputs on purpose; privacy assertions apply to applicationText/status/cells, not the diagnostics banner/README or synthetic transport trace. Input values are omitted from the generic DOM snapshot. A rejected/extra route, browser error or nonempty unexpected list must be reported; never hide it or claim all assertions passed merely because the page loaded.

## Bounded interaction scenarios

choice-single and choice-multiple use only visible direct scalar Driver/Choices fields. Driver starts denied; Beta is unavailable, while Gamma is excluded by the static choice-ID allowlist. Type allowed into Driver and select Conditional Beta using the actual native select. Its value is Beta (or [Beta]), never sel_beta or the display label. Type denied again: the existing selected name/label must remain unchanged and removable, without an automatic Save. Choose Save explicitly to inspect that native request. The fixture intentionally returns a normal validation result, retaining the draft; it does not prove persistence. Remove the retained selection, verify Beta cannot be added again, and deliberately Save the native null/empty array. These choice cases cover the application's conservative flat direct-scalar projection only; no hidden/linked driver projection or general hosted conditional visibility is claimed. The separate visibility scenarios below cover only their declared one-page scalar configurations.

choice-add-single and choice-add-multiple enable the actual Add Choice controls without a static allowlist or selection maximum. Driver starts denied with the existing Beta name retained. Remove it natively and deliberately Save null/empty array. Type the whitespace/case-equivalent name " bEtA " in New choice name and choose Create choice. The synthetic add-option route returns the already-existing sel_beta/Beta metadata; it creates no choice. The denied choice must not be reselected or change the record draft, and no automatic Save may occur. The next deliberate Save must still carry null/empty array. Inspect the one exact existing-choice resolution request and metadataCreated:false event; this is an availability boundary assertion, not metadata creation or persistence proof.

projection-single and projection-multiple compose one-page conditional visibility with configured option conditions. Show driver starts checked, Projection driver contains allowed, and Projected Beta is unavailable because that driver is populated. Edit the driver to allowed edited, then use native SPACE/TAB to hide it. Projected Beta becomes available because the canonical evaluation copy removes only the conditionally hidden driver ID. The readonly full-record witness remains visible: each field predicate reads the complete accepted snapshot rather than another field's already-pruned result. Select Beta natively and explicitly Save. That request must retain the hidden edited driver, readonly and unrendered native array/link/barcode values, plus exactly the driver, checkbox and choice dirty IDs. Reveal the driver: its accepted value remains, the selected Beta label is retained and removable, and removing Beta denies readdition. The next deliberate Save carries the complete native null/empty-array selection. A native A-to-B-to-A visitor switch retires the controls, restores the accepted A draft with fresh controls and performs no Save. These cases prove only the declared flat physical scalar dependencies; no section, computed/linked/lookup projection, backend validation or persistence credit is granted.

linked-filters uses the current published linked cascade, separately from the flat choice cases. For ordered prefills, add prefill_Current%20country=North%2C%20East, prefill_Current%20region=Duplicate%20label and prefill_Current%20city=City%20%3D%20%22One%22 to its scenario URL. Choose Load conditional filters, Search choices and More choices; select Available project and Page two project through their native checkbox controls, then Save deliberately. Observe exact returned record/string pairs and the one next-page cursor. Changing Country to South must clear downstream filter choices and invalidate the old cursor while retaining native selected record IDs; a subsequent Search choices starts with a null cursor and performs no automatic Save.

linked-filter-deferred has one explicit test-only control, Release pending synthetic read. Its first Country search and first inner choice read wait for that native button. Start Country search, choose the real app Cancel control, then release the already-started read: no filter choice, child read or Save may appear. Search Country again, choose the returned North record and start Search choices. Switch the real app visitor A to B to A, then release that read. The retired owner must add no stale choices or writes and retain its original record IDs. Disconnect normally. This release control only settles these two synthetic read responses; it neither changes the application DOM nor dispatches a mutation. Every other diagnostic hook is read-only.

visibility-draft uses a supported checkbox predicate for text, readonly and numeric targets. The false checkbox hides all three while Unconditional tail remains available. Use native SPACE/TAB to reveal them, edit the text and enter a valid number, then append an incomplete exponent with the real keyboard. Inspect the read-only numeric badInput observation; scripting a number value or input event is not this proof. A visible invalid control must deny Save. Toggle the checkbox false: all three targets hide and normal TAB traversal skips them. The next explicit Save must preserve the complete last accepted native draft, including hidden readonly/unrendered array/link/barcode values and exact dirty IDs. Reveal again to inspect the retained accepted text and invalid numeric control, repair the number natively, and explicitly Save. Validation responses retain drafts and prove dispatch only.

visibility-unavailable initially returns a canonical singleSelect condition outside this scalar visibility subset. The target is unavailable with an explicit alert; edit the adjacent control and choose Save: no Save route is permitted. Native Reload returns a fresh supported checkbox condition and fresh server values. The alert hides, target appears and a deliberate native edit/Save succeeds. This is an explicit fresh-read recovery, never an automatic retry or stale draft submission.

visibility-section uses one conditional section lead, its follower, and a later section header resetting that inherited condition. Initially the lead/follower hide while Reset section and Unconditional tail remain available. Native SPACE/TAB reveals and then hides the section; edit its follower before hiding and explicitly Save. Complete native field data and dirty IDs must remain unchanged by presentation. No multipage, computed/linked-driver projection or hosted section parity is claimed.

## Bounded address scenarios

These four scenarios use only a configured editable unmasked physical singleLineText Address with characterLimit 24. address-lifecycle adds the existing one-page checkbox visibility predicate. Native fixture buttons release or fail already-started synthetic predictions/details, and that lifecycle fixture separately releases a held Save validation response. They settle transport only and never edit application DOM, dispatch app events, or invoke a Save. All diagnostic hooks remain read-only. Predictions and details deliberately return even after their signal aborts; these cases exercise the combined installed SDK and starter/presenter cancellation fences, not an isolated generation mechanism or a real provider.

address-acceptance: type more than 24 characters with the real keyboard and observe the capped native input and exact debounced query. Release predictions, use ArrowDown/Enter to choose the first actual option and inspect immediate capped selected description and retained input focus with zero Save. Release details to inspect accepted capped formatted text. Save deliberately and inspect complete native data and the address dirty ID. Clear address natively and explicitly Save null; no blank prediction or automatic Save is permitted.

address-failure: fail a held prediction, inspect generic retry/manual-fallback status and retained input, then deliberately Save that manual draft. Type again, fail the new prediction and use the actual Try again control; only that explicit retry may request predictions. Release them, click an actual suggestion, fail its details, and inspect retained selected description. Use Try again to retry that same place, release formatting, then Save explicitly. Failure must not erase native values or submit automatically.

address-lifecycle: start predictions, hide then reveal Address using native SPACE/TAB on Show address, and release the old response after reveal. Same input ID, retained value, hidden/disabled state, real focus traversal, zero options/status/retry, exact abort counts and zero Save must be observable. Type afresh, release predictions and select an option while details remain held. Choose actual Save, inspect its exact selected-description data while the Form is busy/inert and the address is disabled, then release old details despite abort. Only the native fixture button releases the normal Save validation response; re-enable must preserve the selected description and add no read/Save. This demonstrates dispatch, not persistence.

address-remount: hold predictions, switch the actual Visitor selector A to B to A, and inspect a new input ID retaining the accepted draft with no automatic query. Release the old response after remount; it must add no options/status/retry, writes or detail read. Type afresh, release predictions, select an actual option and hold details. Choose Discard draft, inspect another new input ID and original loaded native data, then release old details after remount. The restored control and complete draft must stay unchanged. Deliberate Save must carry the loaded native data with no discarded dirty ID.

### Explicit synthetic DOM composition scenario

address-ime reuses the same bounded address transport and adds separately labelled visible fixture controls. It proves SDK/starter handling of supplied untrusted DOM events, not OS IME behavior. First type an ordinary query with the real keyboard, release predictions and highlight the first option using native ArrowDown. Dispatch synthetic composing keyboard markers: each ArrowDown/ArrowUp/Enter/Escape with isComposing:true and again keyCode:229 must leave the value/highlight unchanged, defaultPrevented:false, dispatchReturned:true, and issue no details or Save. Marker logs bind exact supplied and observed flags, before/after value and active descendant.

Start synthetic DOM composition; the existing popup and pending intents must retire. Update synthetic composing Japanese input: its fixed unfinished buffer exceeds the 24-character cap and must remain untouched for more than 800 ms, without a prediction, formatted details or Save. Dispatch the markers again while composition is active. Commit synthetic DOM composition: the actual compositionend plus final non-composing input commits the fixed final Japanese string and creates exactly one debounced prediction. Release it, focus the real input and use native ArrowDown/Enter; the ordinary highlight/selection/details behavior must still work. Release details, then explicitly Save and inspect full native record values and the address dirty ID. These composition controls intentionally dispatch app input markers only in this named scenario; existing four address response controls still settle transport only, and snapshot hooks remain read-only.

## Bounded privacy teardown scenarios

teardown-logout and teardown-disconnect use the actual starter's public anonymous create Form. Choose Connect and load, replace the title with Previous visitor private narrative and Save once. The synthetic response is lost; the uncertain create remains blocked. Earlier local input (reference only) must contain that text, Previous visitor private field label and previous-visitor-private-attachment.pdf. The attachment field starts dirty so this assertion exercises its retained filename.

Choose Reload before either teardown: the active Form must contain Fresh public baseline, no attachments, Fresh public readonly witness, numeric zero and checkbox false, while the earlier reference remains available separately and Save stays blocked. In teardown-logout choose Clear this visitor's session then Reload. In teardown-disconnect choose Disconnect then Connect and load the same share. Each anonymous reconnect must show those unchanged fresh values, no Earlier local input details and none of the three earlier private witnesses in application text, attributes or current field values. Earlier outcome not confirmed and the disabled Save must remain. Deliberate attempts to submit the current Form may not add another saveForm call; its total remains one. These cases prove synthetic UI teardown and conservative no-replay behavior; the original write outcome remains unknown. Diagnostic fixture expectations and traces remain synthetic reference material outside the application privacy assertion.

## Prepared review scenarios

hide-empty-edit uses explicit edit-mode hideFieldIfEmpty:true on twelve matching direct scalar families, including richText. Readonly null, blank text, false checkbox, zero rating and blank native barcode remain hidden; ordinary number/currency/percent zero stay visible. Replace the populated required answer with one SPACE in one native key command, then edit the visible sibling and Save. The complete whitespace/native snapshot, readonly/unrendered values, initial dirty ID, URL-prefilled ID and accepted edits must appear in the single Save. The synthetic returned hidden-field required error remains visible. Visitor A-to-B-to-A retains the accepted hidden draft without a read or replay; Discard restores initial controls without another Save. This is presentation and returned-error handling, not hosted required-rule evaluation, hidden-write authority or persistence.

hide-empty-create keeps the same empty scalar controls visible because ordinary empty hiding is inactive in create mode. The installed/packed checks assert the exact create envelope and full native data after an adjacent edit. hide-empty-unavailable retains a nonblank disabled section title: active edit empty hiding is blocked, the unavailable alert is visible and deliberate Save dispatches zero requests. Visitor round trip keeps the adjacent accepted draft. A normal Reload supplies the explicitly supported no-section/hide-false configuration; only a later explicit Save may dispatch. Review's separate row preparation supports eleven direct scalar types and excludes richText; these empty-hiding scenarios use promptUserBeforeSubmission:false/absent and grant no Review richText support.

hide-empty-review combines edit hideFieldIfEmpty:true with promptUserBeforeSubmission:true. All eleven Review-supported scalar targets contain exact whitespace native strings and remain hidden. RichText is retained as unrendered native data; it receives no Review support. Only the readonly locked answer and accepted visible sibling appear as ordered semantic review rows. Edit/Escape dispatch zero Saves. One fresh Confirm preserves all original whitespace bytes, readonly/unrendered native values, all eleven initial dirty IDs, the duplicate URL-prefilled numeric ID and accepted sibling ID in the full unique Save union. Returned hidden-required errors remain synthetic. hide-empty-review-malformed changes only the barcode answer to nonblank malformed native text and disables hide-empty for that field; ordinary visibility stays available, while Review rejects without opening a dialog or dispatching Save. This isolates Review's nonblank validation from empty-hiding's unavailable gate.

review-answers uses the exact archived starter review.ts and confirmation.ts with promptUserBeforeSubmission:true. Edit the masked secret and conditional answer, then hide the latter using the actual checkbox. Save opens a semantic modal with Edit focused first. The ordered review rows contain a fixed eight-bullet secret mask, literal readonly markup, a plain URL and populated numeric zero. Hidden conditional data, unchecked checkbox, zero rating and blank barcode have no rows. No rich markup/link/image is manufactured. Edit, Escape and Enter on initial Edit perform zero Saves and restore focus to Save. Fresh explicit Confirm dispatches the complete native snapshot and exact dirty IDs once, preserving hidden and unrendered native values. The response is validation output, not persistence.

The supported direct scalar review families are singleLineText, multilineText, email, url, phoneNumber, number, currency, percent, rating, checkbox and readonly barcode. Native empty or whitespace-only strings are omitted before typed formatting for every supported family. This controls review presentation only: Confirm keeps the complete native Save snapshot, including omitted values and dirty field IDs; it does not trim, coerce or prune that record. Populated malformed scalar values still make review unavailable. The installed archived recipe checks exercise empty and whitespace strings across all eleven families; these four browser scenarios do not claim every matrix row was entered through a native control.

review-address reuses the existing bounded held address transport. Opening review retires a held prediction or selected-place detail before capture; native Edit restores controls. Only then can the existing visible response-release buttons deliver the cancelled response. No late option, stale formatted value, repeat read or Save may result. A later explicit Confirm saves the captured selected description through the existing Save runner.

review-validation opens review with a missing required scalar answer. Explicit Confirm dispatches once and the synthetic backend-shaped required validation message remains visible with the full draft retained. Repair and fresh Edit preserve that answer without an additional Save. This proves returned-error handling, not actual server rule evaluation.

review-unknown holds the one confirmed Save. Cancel request aborts its accepted request scope. The visible response-release button then delivers a late validation result; the separate response-loss button instead rejects the held transport. For either settled uncertain outcome, native Save and the actual field group remain blocked: attempted text, number and checkbox edits must leave their values unchanged, with no repeated Save or reopened review. Reload keeps uncertainty blocked until explicit fresh-record acknowledgment enables a separate tracked edit. Native modal inertness also prevents ordinary background field or Visitor edits while review is open. Pending draft/configuration invalidation is separately exercised by actual-starter installed/packed event checks; these automated native cases do not claim an impossible background gesture or independent manual exploration.

## CI generation and remaining verification

CI generated this static kit only after the existing exact archive consumer checks passed. It did not launch a browser or perform these manual interactions. This bounded fixture does not expose every configured title/destination variant; deterministic helper tests cover hidden/blank titles and fallback-destination semantics separately. Record any additional manual exploration separately, and do not claim those variants were exercised from the positive scenarios alone. The manifest binds the source/CI identity, exact SDK package digest, complete recipe and bundle inputs, and static outputs. Preserve the original tested SDK TGZ and receipt alongside this fixture; browser evidence must name both digests.

`;
        write('README.md', readme);
        sources.push(
            {
                origin: 'installed-archive-doc',
                path: 'docs/auth.md',
                bytes: guide.length,
                sha256: sha256(guide),
            },
            {
                origin: 'complete-unchanged-tsx-fence',
                path: 'docs/auth.md#AuthPanel',
                bytes: Buffer.byteLength(recipe),
                sha256: sha256(recipe),
            }
        );
        rmSync(generated, { recursive: true, force: true });
        const receipt = {
            schemaVersion: 1,
            purpose: 'manual normal-browser synthetic privacy proof',
            source: { commit: source.commit, tree: source.tree },
            ci,
            package: {
                name: sdkName,
                version: packageMetadata.version,
                filename: basename(archivePath),
                sha256: packageSha256,
                bytes: archive.length,
            },
            provenance: {
                actualPackedStarterBuildReused: true,
                completeAuthPanelFence: true,
                sdkSourceAliases: false,
                packageRepacked: false,
                htmlChanges: [
                    'relative static assets',
                    'synthetic bootstrap module',
                    'CSP and diagnostics stylesheet',
                ],
                react: '19.2.0',
                reactDOM: '19.2.0',
            },
            generation: {
                status: 'static assets generated; manual browser execution pending',
                node: process.version,
                browserLaunched: false,
                servicesStarted: false,
            },
            sources,
            bundleInputs: { starter: starterInputs, auth: authInputs },
            outputs,
            scenarios: [...privacyScenarioInventory],
            limits: [
                'Synthetic transport only; real network fallback disabled.',
                'No backend/security/permission/OTP delivery/durable persistence proof.',
                'No browser execution, CDP or TLS exception performed by generation.',
                'Configured-choice cases use only visible direct scalar drivers in a flat Form; no general hidden/linked projection proof.',
                'Projection cases compose conditional field removal with option conditions for their declared flat physical scalar dependencies only; no section/computed/linked/lookup projection or persistence proof.',
                'Visibility scenarios cover their declared one-page checkbox/unsupported condition and section configurations only; no multipage or general hosted parity proof.',
                'Empty-hiding fixtures cover twelve direct scalar targets in explicit edit mode, inactive create mode, and blocked section recovery. Returned required errors are synthetic; no hosted backend validation, hidden-write authority or persistence credit.',
                'Interaction Save cases prove explicit native dispatch with validation responses, not durable persistence.',
                'Address scenarios cover only editable unmasked singleLineText, a valid cap and one optional one-page checkbox predicate; no provider, backend, hosted parity or other field/configuration credit.',
                'Address stale-response cases cover combined installed SDK and starter/presenter cancellation; they do not independently isolate presenter generations.',
                'The address-ime scenario supplies explicit untrusted DOM composition and keyboard event markers through visible synthetic fixture controls; it does not prove an OS IME, platform composition integration or native Japanese text entry.',
                'Review scenarios cover their declared one-page manual scalar rows and explicit-confirm dispatch only; returned validation/uncertainty handling gives no backend permission, actual rule evaluation or persistence credit.',
                'Native modal background inertness is preserved; pending draft/configuration invalidation is an installed/packed event oracle, not a claimed normal background native gesture.',
                'Generated successful output is not a manual browser pass.',
            ],
        };
        writeFileSync(
            join(output, 'manifest.json'),
            JSON.stringify(receipt, null, 2) + '\n',
            { flag: 'wx' }
        );
        const manifestSha256 = sha256(regular(join(output, 'manifest.json')));
        writeFileSync(
            join(output, 'SHA256SUMS'),
            [
                ...outputs.map((entry) => `${entry.sha256}  ${entry.path}`),
                `${manifestSha256}  manifest.json`,
            ].join('\n') + '\n',
            { flag: 'wx' }
        );
        await assertPrivacyProofInventory(output);
        return {
            outputDirectory: output,
            manifestSha256,
            packageSha256,
            outputFiles: outputs.length + 2,
            manualBrowserStatus: 'not-executed',
        };
    } catch (error) {
        // This function created the fresh directory exclusively; clean only it.
        rmSync(output, { recursive: true, force: true });
        throw error;
    }
}
