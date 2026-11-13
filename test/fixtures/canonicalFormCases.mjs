// Synthetic inputs only. Expected checkpoints are produced by the pinned real
// native reducer, never by the candidate SDK kernel or a reducer approximation.
export const canonicalFormFieldDefinitions = [
    { id: 'fld_text', name: 'Text', type: 'singleLineText' },
    { id: 'fld_second', name: 'Second', type: 'singleLineText' },
    {
        id: 'fld_required',
        name: 'Required',
        type: 'singleLineText',
        required: true,
    },
    { id: 'fld_amount', name: 'Amount', type: 'number' },
    { id: 'fld_rich', name: 'Notes', type: 'richText' },
    { id: 'fld_links', name: 'Links', type: 'multipleRecordLinks' },
    {
        id: 'fld_prefill',
        name: 'Readonly URL prefill',
        type: 'singleLineText',
        readonlyPrefill: true,
    },
];

const edit = (fieldId, value, extra = {}) => ({
    type: 'edit',
    fieldId,
    value,
    dirty: 'append',
    ...extra,
});
const initialValues = {
    fld_text: 'A',
    fld_second: 'B',
    fld_required: 'present',
    fld_amount: 1,
    fld_rich: 'line\n',
    fld_links: ['rec_a'],
    fld_prefill: 'URL-loaded value',
};

export const canonicalFormCases = [
    {
        name: 'context-preserves-retired-url-history-until-genuine-reinstall',
        retiredIntentFieldId: 'fld_prefill',
        events: [
            edit('fld_prefill', 'URL-loaded value'),
            { type: 'context', shareId: 'shr_other' },
            { type: 'context', shareId: 'shr_canonical' },
            edit('fld_text', 'fresh context editor', {
                expectedOwner: 'current',
            }),
            { type: 'reinstall', values: initialValues },
            edit('fld_prefill', 'URL-loaded value'),
        ],
    },
    {
        name: 'equal-readonly-url-intent-retires-origin-with-deduplicated-history',
        retiredIntentFieldId: 'fld_prefill',
        events: [
            edit('fld_prefill', 'URL-loaded value'),
            edit('fld_prefill', 'URL-loaded value'),
        ],
    },
    {
        name: 'equal-scalar-preserves-errors-and-retires-intent-metadata',
        errors: { fld_text: 'Retained error' },
        retiredIntentFieldId: 'fld_text',
        events: [edit('fld_text', 'A')],
    },
    {
        name: 'equal-array-preserves-order-and-retires-intent-metadata',
        retiredIntentFieldId: 'fld_links',
        events: [edit('fld_links', ['rec_a'])],
    },
    {
        name: 'richtext-equivalent-keeps-original-stored-bytes',
        retiredIntentFieldId: 'fld_rich',
        errors: { fld_rich: 'Retained rich text error' },
        events: [edit('fld_rich', 'line'), edit('fld_rich', 'line  ')],
    },
    {
        name: 'absent-null-empty-are-distinct-supported-writes',
        omitValueKeys: ['fld_text'],
        events: [
            edit('fld_text', null),
            edit('fld_text', ''),
            edit('fld_text', null),
        ],
    },
    {
        name: 'array-order-and-dirty-first-edit-order-survive-aba',
        events: [
            edit('fld_links', ['rec_a', 'rec_b']),
            edit('fld_text', 'changed'),
            edit('fld_links', ['rec_b', 'rec_a']),
            edit('fld_links', ['rec_a']),
            edit('fld_text', 'A'),
        ],
    },
    {
        name: 'dirty-preserve-still-writes-validates-and-advances-generation',
        events: [
            edit('fld_required', '', { dirty: 'preserve' }),
            edit('fld_required', 'valid', { dirty: 'preserve' }),
            edit('fld_text', 'dirty'),
            edit('fld_text', 'A', { dirty: 'preserve' }),
        ],
    },
    {
        name: 'replace-errors-is-independent-of-value-and-loaded-baseline',
        events: [
            {
                type: 'replaceErrors',
                errors: { fld_text: 'Server field error' },
            },
            edit('fld_text', 'A'),
            edit('fld_text', 'changed'),
            { type: 'replaceErrors', errors: {} },
        ],
    },
    {
        name: 'linked-add-remove-aba-without-dirty-membership',
        events: [
            { type: 'linkedAdd', recordId: 'rec_b', dirty: 'preserve' },
            { type: 'linkedRemove', recordId: 'rec_b', dirty: 'preserve' },
            {
                type: 'linkedRemove',
                recordId: 'rec_missing',
                dirty: 'preserve',
            },
        ],
    },
    {
        name: 'linked-new-record-exemption-can-change-without-value-write',
        events: [
            { type: 'linkedAdd', recordId: 'rec_a', newlyCreated: true },
            { type: 'linkedAdd', recordId: 'rec_a', newlyCreated: true },
        ],
    },
    {
        name: 'linked-remove-from-absent-does-not-create-empty-array',
        omitValueKeys: ['fld_links'],
        events: [{ type: 'linkedRemove', recordId: 'rec_missing' }],
    },
    {
        name: 'linked-remove-from-null-preserves-null',
        values: { fld_links: null },
        events: [{ type: 'linkedRemove', recordId: 'rec_missing' }],
    },
    {
        name: 'policy-aba-retires-old-editor-but-not-allocated-provenance',
        events: [
            { type: 'setReadOnly', readOnly: true },
            { type: 'setReadOnly', readOnly: false },
            edit('fld_text', 'stale editor', { expectedOwner: 'initial' }),
            edit('fld_text', 'fresh editor', { expectedOwner: 'current' }),
        ],
    },
    {
        name: 'low-level-native-edit-does-not-invent-readonly-admission',
        events: [
            { type: 'setReadOnly', readOnly: true },
            edit('fld_text', 'trusted native write'),
        ],
    },
    {
        name: 'context-aba-refuses-stale-editor-and-accepts-fresh-editor',
        events: [
            { type: 'context', shareId: 'shr_other' },
            { type: 'context', shareId: 'shr_canonical' },
            edit('fld_text', 'stale editor', { expectedOwner: 'initial' }),
            edit('fld_text', 'fresh editor', { expectedOwner: 'current' }),
        ],
    },
    {
        name: 'equal-form-reinstallation-is-a-new-owner-and-load-baseline',
        events: [
            edit('fld_text', 'unsaved'),
            { type: 'reinstall', values: initialValues },
            edit('fld_text', 'stale editor', { expectedOwner: 'initial' }),
            edit('fld_text', 'fresh editor', { expectedOwner: 'current' }),
        ],
    },
    {
        name: 'actual-native-preserved-open-keeps-draft-owner-errors-and-baseline',
        events: [
            edit('fld_text', 'unsaved'),
            {
                type: 'replaceErrors',
                errors: { fld_required: 'Retained during reopen' },
            },
            { type: 'preserveOpen' },
            edit('fld_text', 'same original owner', {
                expectedOwner: 'initial',
            }),
        ],
    },
    {
        name: 'loaded-policy-baseline-is-an-explicit-independent-transition',
        events: [
            {
                type: 'setLoadedBaseline',
                values: { fld_text: 'Explicit loaded baseline' },
            },
            edit('fld_text', 'changed'),
        ],
    },
    {
        name: 'configuration-token-aba-does-not-revive-old-owner',
        events: [
            { type: 'reinstall', token: 'synthetic-token-b' },
            { type: 'reinstall', token: 'synthetic-token-a' },
            edit('fld_text', 'stale editor', { expectedOwner: 'initial' }),
            edit('fld_text', 'fresh editor', { expectedOwner: 'current' }),
        ],
    },
    {
        name: 'missing-allocator-recovers-from-retained-native-generations',
        events: [
            edit('fld_text', 'changed'),
            { type: 'forgetAllocator' },
            { type: 'setReadOnly', readOnly: true },
            { type: 'reinstall' },
        ],
    },
    {
        name: 'trusted-save-replacement-replaces-newer-edit-and-keeps-load-baseline',
        evidenceBoundary: 'trusted-settlement-not-request-admission',
        events: [
            edit('fld_amount', 1234.5),
            { type: 'captureSubmittedRecord' },
            edit('fld_amount', 9876.5),
            { type: 'settleSave', valuesFrom: 'submitted' },
        ],
    },
    {
        name: 'trusted-save-returned-record-and-explicit-dirty-keep-create-to-edit',
        evidenceBoundary: 'trusted-settlement-not-request-admission',
        events: [
            edit('fld_text', 'changed'),
            edit('fld_second', 'changed second'),
            {
                type: 'settleSave',
                values: {
                    fld_text: 'returned server value',
                    fld_second: 'returned second',
                },
                dirtyFieldIdsToKeep: ['fld_second', 'fld_text', 'fld_second'],
            },
        ],
    },
];

const clone = (value) => structuredClone(value);
const context = (shareId = 'shr_canonical') => ({
    type: 'direct-url',
    potentialRecordIdFromUrl: null,
    shareId,
    extensionAccessTokenStartTime: 1700000000000,
});

// This is the fixed-ID form of the valid loaded fixture in the pinned native
// recordValue tests. Native public-field defaults are obtained from their real
// constructor. No loaded bindings, client or submission grants are fabricated.
export const replayCanonicalFormCases = async (native) => {
    const sessionId = 'sess_canonical';
    const otherSessionId = 'sess_unrelated';
    const fields = canonicalFormFieldDefinitions.map((field) => ({
        fieldType: field.type,
        airtableField: {
            id: field.id,
            name: field.name,
            isComputed: false,
            isPrimaryField: field.id === 'fld_text',
            description: '',
            config: {
                type: field.type,
                options:
                    field.type === 'multipleRecordLinks'
                        ? {
                              linkedTableId: 'tbl_children',
                              isReversed: false,
                              prefersSingleRecordLink: false,
                          }
                        : field.type === 'number'
                          ? { precision: 2 }
                          : null,
            },
        },
        miniExtConfig: {
            ...(field.required ? { required: true } : {}),
            ...(field.readonlyPrefill
                ? { readOnly: true, allowPrefillingDisabledField: true }
                : {}),
        },
    }));
    const fieldIdsToSchemas = Object.fromEntries(
        fields.map((field) => [field.airtableField.id, field])
    );
    const fieldNamesToSchemas = Object.fromEntries(
        fields.map((field) => [field.airtableField.name, field])
    );
    const publicFields = native.getPublicFieldsFromExtension({
        extension: {
            id: 'ext_canonical',
            shareId: 'shr_canonical',
            description: null,
            updatedTime: 1700000000000,
            createdTime: 1700000000000,
            lastEditorUID: 'usr_synthetic',
            version: native.extensionVersion,
            baseId: 'app_synthetic',
            name: 'Synthetic Form',
            type: 'form',
            userUID: 'usr_synthetic',
            state: { tableId: 'tbl_synthetic' },
        },
    });
    const makeScreen = (values, errors = {}, token = 'synthetic-token-a') => ({
        extensionId: 'ext_canonical',
        language: 'en',
        enableCommentsOnChildForms: false,
        googleAnalyticsMeasurementId: null,
        themeColor: 'blue',
        workspaceId: 'wsp_synthetic',
        faviconUrl: null,
        isStarterExtension: false,
        extensionScreen: native.formLoadedScreen,
        captchaVal: null,
        formConditionalLinkedRecordFilterFieldIdsToPrimaryValues: {},
        formLoadingState: { type: 'idle' },
        fieldIdsToReviewedRecordIds: {},
        isFormReadOnly: false,
        result: {
            type: 'success',
            data: {
                extensionType: 'form',
                extensionAccessToken: token,
                extensionName: null,
                hasParentExtension: false,
                formRecord: { type: 'create', data: clone(values) },
                formErrors: clone(errors),
                publicFields: clone(publicFields),
                fieldIdsInForm: Object.keys(fieldIdsToSchemas),
                fieldNamesToSchemas: clone(fieldNamesToSchemas),
                fieldIdsToSchemas: clone(fieldIdsToSchemas),
                formFieldIdsWithUnsavedChanges: [],
                linkedRecordFieldIdToDetailFields: {},
                urlPrefilledFieldIds: ['fld_prefill'],
                cookieKeyForLoginToken: null,
                baseId: 'app_synthetic',
                loggedInUserCanEditExtension: false,
                showMiniExtensionsBranding: true,
                onFreePlan: true,
                trialExpiresAtUnixEpoch: null,
            },
        },
    });
    const screen = (state) => state.sessionIdsToScreenStates[sessionId].data;
    const project = (state) => {
        const form = screen(state);
        const data = form.result.data;
        const { data: values, ...record } = data.formRecord;
        return clone({
            record,
            values,
            ownValueKeys: Object.keys(values),
            dirtyFieldIds: data.formFieldIdsWithUnsavedChanges,
            errors: data.formErrors,
            loadedPolicyBaseline:
                state.extensionIdsToFormStoredValues[sessionId],
            isFormReadOnly: form.isFormReadOnly,
            provenance: form.editProvenance ?? null,
            renderLease: form.borrowedRenderLease ?? null,
            manualReadonlyCompute: form.manualReadonlyCompute,
            manualReadonlyOrigin: form.manualReadonlyOrigin,
            manualReadonlyRetiredUrlFieldIds:
                form.manualReadonlyRetiredUrlFieldIds,
            selectedRecordFilterExemptRecordIdsByField:
                form.selectedRecordFilterExemptRecordIdsByField,
            nextFormEditGeneration: state.nextFormEditGeneration ?? null,
        });
    };

    const scenarios = [];
    for (const scenario of canonicalFormCases) {
        let state = native.reducer(undefined, { type: '@@INIT' });
        const dispatch = (name, payload) => {
            state = native.reducer(
                state,
                native.actions[name]({
                    extensionSessionId: sessionId,
                    ...payload,
                })
            );
        };
        dispatch('setContextForExtensionSessionId', { context: context() });
        const values = {
            ...clone(initialValues),
            ...clone(scenario.values ?? {}),
        };
        for (const key of scenario.omitValueKeys ?? []) delete values[key];
        dispatch('setLoadedScreenStateForSession', {
            screenState: makeScreen(values, scenario.errors),
        });
        dispatch('setStoredValuesForFormLoaded', { formData: clone(values) });
        dispatch('setLoadedScreenStateForSession', {
            extensionSessionId: otherSessionId,
            screenState: makeScreen({ fld_text: 'Unrelated draft' }),
        });

        // Historical UI metadata is plain synthetic state, not an accepted
        // Compute or permission to submit. These rows test its retirement only.
        if (scenario.retiredIntentFieldId) {
            state = clone(state);
            const form = screen(state);
            form.manualReadonlyCompute = {
                requestId: 'synthetic-historical-receipt',
                phase: 'settled',
                candidateFieldIds: [scenario.retiredIntentFieldId],
                settledFieldIds: [scenario.retiredIntentFieldId],
            };
            form.manualReadonlyOrigin = {
                ownerGeneration: form.borrowedRenderLease.ownerGeneration,
                fieldIds: [scenario.retiredIntentFieldId],
                values: {
                    [scenario.retiredIntentFieldId]: clone(
                        values[scenario.retiredIntentFieldId]
                    ),
                },
            };
        }
        const request = native.captureEdit({
            state,
            extensionSessionId: sessionId,
        });
        const initialOwner = native.readRenderOwner(state, sessionId);
        if (!request || !initialOwner)
            throw new Error('Native synthetic Form did not install an owner.');
        const initial = project(state);
        const unrelated = state.sessionIdsToScreenStates[otherSessionId];
        const linkedCache = state.tableIdsToLinkedTableStates;
        const portalRecords = state.fieldIdsToPortalRecordStates;
        let submitted;
        const steps = [];
        for (const event of scenario.events) {
            const before = state;
            switch (event.type) {
                case 'edit': {
                    const expected =
                        event.expectedOwner === 'initial'
                            ? initialOwner
                            : event.expectedOwner === 'current'
                              ? native.readRenderOwner(state, sessionId)
                              : null;
                    dispatch('updateRecordValue', {
                        fieldId: event.fieldId,
                        value: clone(event.value),
                        doNotUpdateHasUnsavedChange: event.dirty === 'preserve',
                        ...(expected
                            ? { expectedFormRenderOwner: expected }
                            : {}),
                    });
                    break;
                }
                case 'replaceErrors':
                    dispatch('updateFormFieldErrors', {
                        formFieldErrors: clone(event.errors),
                    });
                    break;
                case 'setLoadedBaseline':
                    dispatch('setStoredValuesForFormLoaded', {
                        formData: clone(event.values),
                    });
                    break;
                case 'preserveOpen': {
                    const store = native.createStore(state);
                    await store.dispatch(
                        native.extensionOpened({
                            extensionSessionId: sessionId,
                            extensionData: null,
                            preserveActiveScreenState: true,
                        })
                    );
                    state = store.getState().publicExtension;
                    break;
                }
                case 'setReadOnly':
                    dispatch('updateIsFormReadOnly', {
                        isFormReadOnly: event.readOnly,
                    });
                    break;
                case 'context':
                    dispatch('setContextForExtensionSessionId', {
                        context: context(event.shareId),
                    });
                    break;
                case 'reinstall': {
                    const nextValues =
                        event.values ??
                        screen(state).result.data.formRecord.data;
                    dispatch('setLoadedScreenStateForSession', {
                        screenState: makeScreen(nextValues, {}, event.token),
                    });
                    dispatch('setStoredValuesForFormLoaded', {
                        formData: clone(nextValues),
                    });
                    break;
                }
                case 'linkedAdd':
                    dispatch('addRecordIdToLinkedRecordsCellForForm', {
                        fieldId: 'fld_links',
                        newRecordIdToAdd: event.recordId,
                        doNotUpdateHasUnsavedChange: event.dirty === 'preserve',
                        isNewlyCreatedRecord: event.newlyCreated === true,
                    });
                    break;
                case 'linkedRemove':
                    dispatch(
                        'removeRecordIdFromLinkedRecordsCellForExtension',
                        {
                            fieldId: 'fld_links',
                            recordIdToRemove: event.recordId,
                            doNotUpdateHasUnsavedChange:
                                event.dirty === 'preserve',
                        }
                    );
                    break;
                case 'forgetAllocator':
                    state = { ...state, nextFormEditGeneration: undefined };
                    break;
                case 'captureSubmittedRecord':
                    // Snapshot data only; this deliberately does not claim an
                    // allocation receipt or invoke transport.
                    submitted = clone(
                        screen(state).result.data.formRecord.data
                    );
                    break;
                case 'settleSave':
                    dispatch('updateRecordAfterSave', {
                        loggedInUserRecord: null,
                        formRecord: {
                            type: 'edit',
                            tableId: 'tbl_synthetic',
                            recordId: 'rec_saved',
                            data: clone(
                                event.valuesFrom === 'submitted'
                                    ? submitted
                                    : event.values
                            ),
                        },
                        ...(event.dirtyFieldIdsToKeep
                            ? {
                                  fieldIdsWithUnsavedChangesToKeep:
                                      event.dirtyFieldIdsToKeep,
                              }
                            : {}),
                    });
                    break;
                default:
                    throw new Error('Unknown canonical Form oracle input.');
            }
            const changedFieldId =
                event.type === 'edit'
                    ? event.fieldId
                    : event.type === 'linkedAdd' ||
                        event.type === 'linkedRemove'
                      ? 'fld_links'
                      : null;
            let validation = null;
            if (
                changedFieldId &&
                screen(before).editProvenance?.fieldGenerations[
                    changedFieldId
                ] !==
                    screen(state).editProvenance?.fieldGenerations[
                        changedFieldId
                    ]
            ) {
                const previous = project(before);
                const next = project(state);
                const form = screen(state);
                const data = form.result.data;
                const field = data.fieldIdsToSchemas[changedFieldId];
                const linkedTableLoadingStates = native.selectLinkedTableStates(
                    state,
                    sessionId
                );
                const { unfilteredFormRecordData } =
                    native.getFilteredRecordData({
                        recordData: data.formRecord.data,
                        fieldIdsToAirtableFieldSchemas: data.fieldIdsToSchemas,
                        linkedTableLoadingStates,
                        extensionScreen: form.extensionScreen,
                    });
                const value = data.formRecord.data[changedFieldId];
                // Execute the real validator as an observable host port against
                // reducer-observed inputs. This is not a replacement validator
                // and is not a spy or mock of the reducer's internal call.
                const fieldError = native.validateField({
                    miniExtConfig: field.miniExtConfig,
                    formRecord: {
                        ...data.formRecord,
                        data: unfilteredFormRecordData,
                    },
                    airtableFields: native.selectAirtableFields(form),
                    linkedTableLoadingStates,
                    value,
                    isConditionallyHidden: false,
                    language: form.language,
                    airtableFieldConfig: field.airtableField.config,
                    isAdvancedFieldValidationEnabled:
                        native.advancedValidationEnabled({
                            airtableFieldType: field.airtableField.config.type,
                            miniExtConfig: field.miniExtConfig,
                        }),
                    isComputeMode: false,
                    storedValue: next.loadedPolicyBaseline[changedFieldId],
                });
                if (
                    (fieldError ?? null) !==
                    (next.errors[changedFieldId] ?? null)
                )
                    throw new Error('Native validation observation diverged.');
                validation = {
                    boundary: 'real-validator-with-reducer-observed-inputs',
                    input: {
                        fieldId: changedFieldId,
                        value: clone(value),
                        previousValues: previous.values,
                        canonicalValues: next.values,
                        evaluatedValues: clone(unfilteredFormRecordData),
                        loadedPolicyBaseline: next.loadedPolicyBaseline,
                        previousErrors: previous.errors,
                        previousDirtyFieldIds: previous.dirtyFieldIds,
                        provenance: next.provenance,
                        manualReadonlyCompute: next.manualReadonlyCompute,
                        manualReadonlyOrigin: next.manualReadonlyOrigin,
                    },
                    fieldError: fieldError ?? null,
                    resultingErrors: next.errors,
                };
            }
            const fresh = native.captureEdit({
                state,
                extensionSessionId: sessionId,
            });
            const submittedFieldIds = canonicalFormFieldDefinitions.map(
                (field) => field.id
            );
            steps.push({
                event: clone(event),
                checkpoint: project(state),
                validation,
                stateChanged: before !== state,
                initialOwnerCurrent: native.ownerIsCurrent(
                    state,
                    sessionId,
                    initialOwner
                ),
                initialRetention: native.retention({
                    state,
                    request,
                    submittedFieldIds,
                }),
                freshRetention: native.retention({
                    state,
                    request: fresh,
                    submittedFieldIds,
                }),
                unrelatedPreserved: {
                    session:
                        state.sessionIdsToScreenStates[otherSessionId] ===
                        unrelated,
                    linkedCache:
                        state.tableIdsToLinkedTableStates === linkedCache,
                    portalRecords:
                        state.fieldIdsToPortalRecordStates === portalRecords,
                },
            });
        }
        scenarios.push({
            name: scenario.name,
            evidenceBoundary:
                scenario.evidenceBoundary ?? 'native-reducer-and-provenance',
            initial,
            steps,
        });
    }
    return scenarios;
};
