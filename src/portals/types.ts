import type {
    JsonValue,
    ListPortalLinkedRecordsInput,
    ListPortalLinkedRecordsResult,
    LoadExtensionInput,
    MiniExtensionsClient,
    PortalLoadedResult,
    RuntimeLinkedRecordDetailField,
    SaveFormInput,
} from '../runtime/types.js';
import type { ParentFormDraftScope } from '../forms/drafts.js';

/** Advance revision for visitor, connection, token and loaded Portal changes. */
export type PortalOwnerScope = { ownerId: string; revision: number };
export type PortalCollectionCriteria = Omit<
    ListPortalLinkedRecordsInput,
    | 'extensionAccessToken'
    | 'portalFieldId'
    | 'alreadyLoadedRecordIds'
    | 'airtableOffset'
    | 'pagesToFetch'
    | 'refreshLoggedInPortalRecord'
>;
export type PortalCollectionOptions = {
    client: MiniExtensionsClient;
    portal: PortalLoadedResult;
    portalFieldId: string;
    criteria: PortalCollectionCriteria;
    getScope(): PortalOwnerScope;
};
export type PortalReadOptions = {
    pagesToFetch: ListPortalLinkedRecordsInput['pagesToFetch'];
    refreshLoggedInPortalRecord: boolean;
    signal?: AbortSignal;
};

/** Custom views replace these settings, including keys they omit. */
export type PortalLayoutSettings = {
    layout: JsonValue | undefined;
    disableInlineEdit: JsonValue | undefined;
    allowUsersToUnlinkRecords: JsonValue | undefined;
    kanbanCategoryField: JsonValue | undefined;
};
export type PortalCollectionSnapshot = ListPortalLinkedRecordsResult & {
    criteriaKey: string;
    /** Returned non-hidden fields only; empty projections stay empty. */
    detailFields: RuntimeLinkedRecordDetailField[];
    layoutSettings: PortalLayoutSettings;
};
export type PortalReadOutcome =
    | {
          type: 'loaded';
          raw: ListPortalLinkedRecordsResult;
          snapshot: PortalCollectionSnapshot;
      }
    | {
          type: 'criteria-cleanup-required';
          raw: ListPortalLinkedRecordsResult;
      };

export type PortalChildRequestOptions = Pick<
    LoadExtensionInput,
    'query' | 'clientTimeZone' | 'deviceFingerprint'
> & {
    access: { type: 'create' } | { type: 'edit'; recordId: string };
    /** Exact configured create/edit child ID; this does not grant access. */
    configuredChildExtensionId: string;
};
export type PortalChildFormRequest = {
    input: Omit<
        Extract<LoadExtensionInput, { childExtensionInfo: object }>,
        'context'
    > & {
        context: Extract<LoadExtensionInput['context'], { type: 'modal' }>;
    };
    saveContext: {
        type: 'modal';
        prefillData: Extract<
            SaveFormInput['context'],
            { prefillData: unknown }
        >['prefillData'];
    };
    parent: ParentFormDraftScope;
    /** Check before and after the explicit child load, and before using its context. */
    isCurrent(): boolean;
};

export type PortalCollectionErrorCode =
    | 'scope-changed'
    | 'disposed'
    | 'read-in-progress'
    | 'read-required'
    | 'criteria-cleanup-required'
    | 'child-not-configured'
    | 'record-not-listed';
export type PortalCollection = {
    /** Criteria identity only; no token/session credentials are encoded here. */
    readonly criteriaKey: string;
    readFirst(options: PortalReadOptions): Promise<PortalReadOutcome>;
    /** Null means the accepted cursor is final; no request is dispatched. */
    readNext(options: PortalReadOptions): Promise<PortalReadOutcome | null>;
    getSnapshot(): PortalCollectionSnapshot | null;
    /** Guard application rendering after awaiting a read. */
    isCurrent(): boolean;
    childFormRequest(
        options: PortalChildRequestOptions
    ): PortalChildFormRequest;
    /** Retire before unlink/token replacement; obtain a fresh Portal separately. */
    destroy(): void;
};
