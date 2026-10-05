import {
    AirtableFieldType,
    createMiniExtensionsClient,
    type ListPortalLinkedRecordsInput,
    type ListPortalLinkedRecordsResult,
    type PortalLoadedResult,
    type RuntimeAirtableField,
    type RuntimeRequestOptions,
} from '../src/runtime/index.js';
import { formResult, publicPortalFields } from './runtimeFixtures.js';

type PortalLinkedFieldConfig = NonNullable<
    Extract<
        NonNullable<
            PortalLoadedResult['payload']['publicFields']['state']['portalFields']
        >[number]['config'],
        { type: 'multipleRecordLinks' }
    >['config']
>;

export const portalField: RuntimeAirtableField = {
    id: 'fld_children',
    name: 'Children',
    description: null,
    isComputed: false,
    isPrimaryField: false,
    config: {
        type: AirtableFieldType.MULTIPLE_RECORD_LINKS,
        options: {
            linkedTableId: 'table_children',
            inverseLinkFieldId: 'fld_parent',
            isReversed: false,
            prefersSingleRecordLink: false,
        },
    },
};

export const portalPage = (
    config: PortalLinkedFieldConfig = {}
): PortalLoadedResult => ({
    ...structuredClone(formResult),
    extensionScreen: 'portal_loaded',
    payload: {
        extensionType: 'portal',
        extensionName: 'Synthetic Portal',
        extensionAccessToken: 'portal_access_example',
        baseId: 'base_example',
        loggedInUserCanEditExtension: false,
        showMiniExtensionsBranding: true,
        onFreePlan: false,
        trialExpiresAtUnixEpoch: null,
        viewIdsToAirtableViews: {},
        publicFields: publicPortalFields(),
        formRecord: {
            type: 'edit',
            tableId: 'table_parents',
            recordId: 'record_parent',
            data: { fld_prefill: 'prefill_Title=Example' },
        },
        fieldNamesToSchemas: {},
        fieldIdsToSchemas: {
            fld_prefill: {
                fieldType: AirtableFieldType.SINGLE_LINE_TEXT,
                airtableField: {
                    id: 'fld_prefill',
                    name: 'Parent Prefill Query',
                    description: null,
                    isComputed: false,
                    isPrimaryField: false,
                    config: {
                        type: AirtableFieldType.SINGLE_LINE_TEXT,
                        options: null,
                    },
                },
            },
            fld_children: {
                fieldType: AirtableFieldType.MULTIPLE_RECORD_LINKS,
                airtableField: structuredClone(portalField),
                miniExtConfig: {
                    layout: 'grid',
                    allowCreatingRecords: true,
                    allowEditingRecords: true,
                    formsForEditingAndCreating: 'same-form',
                    extensionIdForCreatingAndEditing: 'extension_child',
                    prefillChildFormForCreatingRecords: true,
                    prefillFieldForCreatingChildExtension: 'fld_prefill',
                    customViews: [
                        {
                            id: 'view_example',
                            config: { name: 'Example view' },
                        },
                    ],
                    ...structuredClone(config),
                },
            },
        },
        linkedRecordFieldIdToDetailFields: {},
        linkedRecordFieldIdToFieldsTitles: {},
        cookieKeyForLoginToken: null,
        fieldIdsInPortal: ['fld_children'],
        usersTableFields: [],
        initialLinkedTableStates: {},
    },
});

export const portalListPage = (
    value: Partial<ListPortalLinkedRecordsResult> = {}
): ListPortalLinkedRecordsResult => ({
    airtableOffset: null,
    recordIds: [],
    tableIdsToLinkedTableStates: {},
    customViewDetailFields: null,
    ...structuredClone(value),
});

export type PortalReadCall = {
    input: ListPortalLinkedRecordsInput;
    options?: RuntimeRequestOptions;
};

/** Synthetic operation fixtures only. Unexpected runtime/network calls fail. */
export const portalFixture = (
    read: (
        call: PortalReadCall
    ) => Promise<ListPortalLinkedRecordsResult> = async () => portalListPage()
) => {
    const calls: PortalReadCall[] = [];
    let mutations = 0;
    const client = createMiniExtensionsClient({
        apiOrigin: 'https://sdk.example.test',
        session: { visitor: 'visitor_A' },
        fetch: async () => {
            throw new Error('Unexpected fixture network request.');
        },
    });
    client.portals.listLinkedRecords = (input, options) => {
        const call = { input, options };
        calls.push(call);
        return read(call);
    };
    client.portals.unlinkRecord = async () => {
        mutations += 1;
    };
    client.portals.updateGridCell = async () => {
        mutations += 1;
        throw new Error('Unexpected fixture mutation.');
    };
    client.forms.save = async () => {
        mutations += 1;
        throw new Error('Unexpected fixture mutation.');
    };
    return {
        client,
        calls,
        get mutations() {
            return mutations;
        },
    };
};

export const deferredPortal = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });
    return { promise, resolve, reject };
};
