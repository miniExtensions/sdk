import type {
    FormLoadedResult,
    PostgresCopyPlanningConfig,
    PostgresConfiguredColumn,
    PostgresFormDraft,
    PostgresFormDraftState,
    PostgresNativeDraft,
    PostgresPortalDraft,
    PostgresPortalDraftState,
    PostgresPortalTab,
    PostgresReadableRelationConfiguration,
} from '../src/runtime/index.js';

declare const privateForm: PostgresFormDraft;
declare const privatePortal: PostgresPortalDraft;
declare const privateTab: PostgresPortalTab;

export const nativeFormArm: PostgresNativeDraft = privateForm;
export const nativePortalArm: PostgresNativeDraft = privatePortal;
export const formState: PostgresFormDraftState = {
    table: privateForm.state.table,
    displayColumnName: 'title',
    formFields: [
        {
            kind: 'text',
            columnName: 'links',
            config: { displayAs: 'attachments-public-urls' },
        },
        { kind: 'boolean', columnName: 'approved', config: { required: true } },
        { kind: 'numeric', columnName: 'amount', config: {} },
        { kind: 'date', columnName: 'day', config: {} },
        { kind: 'enum', columnName: 'status', config: {} },
        { kind: 'uuid', columnName: 'id', config: { readOnly: false } },
    ],
    access: undefined,
};
export const portalState: PostgresPortalDraftState = {
    tabs: [
        {
            ...privateTab,
            criteria: {
                where: {
                    type: 'comparison',
                    columnName: 'amount',
                    operator: 'gt',
                    value: '9007199254740993.123456789',
                },
                orderBy: [
                    { columnName: 'amount', direction: 'asc', nulls: 'last' },
                ],
            },
            identifier: undefined,
        },
        { ...privateTab, id: 'another-tab', criteria: undefined },
    ],
};
export const readableRelation: PostgresReadableRelationConfiguration = {
    source: privateForm.source,
    table: privateTab.table,
    relationOid: privateTab.relationOid,
    displayColumnName: privateTab.displayColumnName,
    columns: privateTab.columns,
};

export function inspectPrivateDraft(draft: PostgresNativeDraft) {
    const nativeSource: 'postgres' = draft.source.type;
    const currentVersion: 106 = draft.version;
    if (draft.type === 'form') {
        const fields: PostgresConfiguredColumn[] = draft.state.formFields;
        const generation: number = draft.relationOid;
        // @ts-expect-error Form state does not acquire Portal tabs.
        draft.state.tabs;
        return { nativeSource, currentVersion, fields, generation };
    }
    if (draft.type === 'BULK_COPY_FIELD_VALUE') {
        const mapping: PostgresCopyPlanningConfig = draft.state.mapping;
        const generation: number = draft.relationOid;
        // @ts-expect-error Copy state does not acquire Portal tabs.
        draft.state.tabs;
        // @ts-expect-error Copy state does not acquire Form fields.
        draft.state.formFields;
        return { nativeSource, currentVersion, mapping, generation };
    }
    const tabs: PostgresPortalTab[] = draft.state.tabs;
    // @ts-expect-error Portal state does not acquire Form fields.
    draft.state.formFields;
    return { nativeSource, currentVersion, tabs };
}

// @ts-expect-error Existing Form and Portal types retain their corresponding state.
export const crossedFormState: PostgresFormDraftState = portalState;
// @ts-expect-error Existing Portal and Form types retain their corresponding state.
export const crossedPortalState: PostgresPortalDraftState = formState;
// @ts-expect-error A Form discriminator cannot pair with Portal state.
export const crossedDraft: PostgresNativeDraft = {
    ...privatePortal,
    type: 'form',
};
export const historicalDraft: PostgresNativeDraft = {
    ...privateForm,
    // @ts-expect-error The private native draft belongs to schema 106.
    version: 105,
};
export const airtableDraft: PostgresNativeDraft = {
    ...privateForm,
    // @ts-expect-error Private native drafts do not accept Airtable source envelopes.
    source: { type: 'airtable', baseId: 'app_fixture' },
};
// @ts-expect-error A Form requires an explicit display-column property.
export const missingFormDisplay: PostgresFormDraftState = {
    table: privateTab.table,
    formFields: [],
};
// @ts-expect-error A readable relation requires an explicit display-column property.
export const missingRelationDisplay: PostgresReadableRelationConfiguration = {
    source: privateForm.source,
    table: privateTab.table,
    relationOid: 1,
    columns: [],
};
// @ts-expect-error A Portal tab requires an explicit display-column property.
export const missingTabDisplay: PostgresPortalTab = {
    id: 'tab',
    name: 'Tab',
    table: privateTab.table,
    relationOid: 1,
    columns: [],
};
export const unknownColumn: PostgresConfiguredColumn = {
    // @ts-expect-error A configured column's kind must be a supported native control.
    kind: 'airtable',
    columnName: 'value',
    config: {},
};
export const uuidAttachmentColumn: PostgresConfiguredColumn = {
    kind: 'uuid',
    columnName: 'id',
    // @ts-expect-error UUID configuration cannot acquire text attachment presentation.
    config: { displayAs: 'attachments-public-urls' },
};
export const booleanTextColumn: PostgresConfiguredColumn = {
    kind: 'boolean',
    columnName: 'approved',
    // @ts-expect-error Boolean configuration cannot acquire text-only normalization.
    config: { preserveTrailingWhitespace: true },
};
export const editingWithoutIdentifier: PostgresFormDraftState = {
    ...formState,
    // @ts-expect-error Enabling existing-record editing still requires a saved identifier.
    access: { disableAccessingExistingRecords: false },
};
// @ts-expect-error Native saved configuration is not a released public Airtable source.
export const publicFormSource: NonNullable<FormLoadedResult['source']> =
    privateForm.source;

// Connection equality, duplicate names, bounds and live grants are runtime checks.
// These witnesses intentionally assert no value-dependent authority for strings.
