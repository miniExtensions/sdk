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
    'src/linkedFilters.ts',
    'src/choiceAvailability.ts',
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
            `const createInteractionFixture = ${createInteractionFixture.toString()};\nexport const createPrivacyFixture = ${createPrivacyFixture.toString()};\nexport const installProofInspection = ${installProofInspection.toString()};\n`
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
        const links = ['pin', 'password', 'word', 'email', 'phone']
            .map(
                (name) =>
                    `<li><a href="starter/index.html?scenario=${name}">Actual starter: ${name}</a> · <a href="auth/index.html?scenario=${name}">Complete AuthPanel: ${name}</a></li>`
            )
            .join('');
        const interactionLinks = [
            'choice-single',
            'choice-multiple',
            'choice-add-single',
            'choice-add-multiple',
            'linked-filters',
            'linked-filter-deferred',
        ]
            .map(
                (name) =>
                    `<li><a href="starter/index.html?scenario=${name}">Actual starter: ${name}</a></li>`
            )
            .join('');
        write(
            'index.html',
            shell(
                'Synthetic packed SDK browser proof',
                `<main><h1>Manual synthetic SDK scenarios</h1><p>This static kit contains the actual packed starter and complete shipped AuthPanel recipe. Generation alone proves no browser outcome. Read README.md before recording a result.</p><ul>${links}<li><a href="starter/index.html?scenario=portal">Actual starter: obscured Portal child-config Grid save/reopen</a></li>${interactionLinks}</ul><p><a href="README.md">Manual assertions and scope</a> · <a href="manifest.json">Source/package manifest</a></p></main>`
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

choice-single and choice-multiple use only visible direct scalar Driver/Choices fields. Driver starts denied; Beta is unavailable, while Gamma is excluded by the static choice-ID allowlist. Type allowed into Driver and select Conditional Beta using the actual native select. Its value is Beta (or [Beta]), never sel_beta or the display label. Type denied again: the existing selected name/label must remain unchanged and removable, without an automatic Save. Choose Save explicitly to inspect that native request. The fixture intentionally returns a normal validation result, retaining the draft; it does not prove persistence. Remove the retained selection, verify Beta cannot be added again, and deliberately Save the native null/empty array. These cases cover the application's conservative flat direct-scalar projection only; no hidden/linked driver projection or general hosted conditional visibility is claimed. One-page field visibility is not included.

choice-add-single and choice-add-multiple enable the actual Add Choice controls without a static allowlist or selection maximum. Driver starts denied with the existing Beta name retained. Remove it natively and deliberately Save null/empty array. Type the whitespace/case-equivalent name " bEtA " in New choice name and choose Create choice. The synthetic add-option route returns the already-existing sel_beta/Beta metadata; it creates no choice. The denied choice must not be reselected or change the record draft, and no automatic Save may occur. The next deliberate Save must still carry null/empty array. Inspect the one exact existing-choice resolution request and metadataCreated:false event; this is an availability boundary assertion, not metadata creation or persistence proof.

linked-filters uses the current published linked cascade, separately from the flat choice cases. For ordered prefills, add prefill_Current%20country=North%2C%20East, prefill_Current%20region=Duplicate%20label and prefill_Current%20city=City%20%3D%20%22One%22 to its scenario URL. Choose Load conditional filters, Search choices and More choices; select Available project and Page two project through their native checkbox controls, then Save deliberately. Observe exact returned record/string pairs and the one next-page cursor. Changing Country to South must clear downstream filter choices and invalidate the old cursor while retaining native selected record IDs; a subsequent Search choices starts with a null cursor and performs no automatic Save.

linked-filter-deferred has one explicit test-only control, Release pending synthetic read. Its first Country search and first inner choice read wait for that native button. Start Country search, choose the real app Cancel control, then release the already-started read: no filter choice, child read or Save may appear. Search Country again, choose the returned North record and start Search choices. Switch the real app visitor A to B to A, then release that read. The retired owner must add no stale choices or writes and retain its original record IDs. Disconnect normally. This release control only settles these two synthetic read responses; it neither changes the application DOM nor dispatches a mutation. Every other diagnostic hook is read-only.

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
            scenarios: [
                'pin',
                'password',
                'word',
                'email',
                'phone',
                'portal',
                'choice-single',
                'choice-multiple',
                'choice-add-single',
                'choice-add-multiple',
                'linked-filters',
                'linked-filter-deferred',
            ],
            limits: [
                'Synthetic transport only; real network fallback disabled.',
                'No backend/security/permission/OTP delivery/durable persistence proof.',
                'No browser execution, CDP or TLS exception performed by generation.',
                'Configured-choice cases use only visible direct scalar drivers in a flat Form; no general hidden/linked projection or field visibility proof.',
                'Interaction Save cases prove explicit native dispatch with validation responses, not durable persistence.',
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
