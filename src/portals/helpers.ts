import { AirtableFieldType } from '../formulas/types.js';
import type {
    LinkedRecordPrefill,
    ListPortalLinkedRecordsResult,
    PortalLoadedResult,
    RuntimeAirtableField,
    RuntimeLinkedRecordFieldConfig,
    RuntimeLinkedRecordDetailField,
    RuntimeSession,
} from '../runtime/types.js';
import type {
    PortalCollectionCriteria,
    PortalLayoutSettings,
    PortalOwnerScope,
    PortalReadOptions,
} from './types.js';

/** Resolve only direct links or valid lookup results that are linked records. */
export const getPortalLinkedRecordFieldConfig = (
    field: RuntimeAirtableField | undefined
): RuntimeLinkedRecordFieldConfig | null => {
    if (!isObject(field) || !isObject(field.config)) return null;
    const config = field.config;
    const linked =
        config.type === AirtableFieldType.MULTIPLE_RECORD_LINKS
            ? config
            : config.type === AirtableFieldType.MULTIPLE_LOOKUP_VALUES &&
                isObject(config.options) &&
                config.options.isValid === true &&
                isObject(config.options.result) &&
                config.options.result.type ===
                    AirtableFieldType.MULTIPLE_RECORD_LINKS
              ? config.options.result
              : null;
    if (
        linked === null ||
        !isObject(linked.options) ||
        typeof linked.options.linkedTableId !== 'string' ||
        linked.options.linkedTableId.trim() === ''
    )
        return null;
    return linked;
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
export const requireIdentifier = (
    value: unknown,
    description: string
): string => {
    if (typeof value !== 'string' || value.trim() === '')
        throw new TypeError(`${description} must be a nonempty string.`);
    return value;
};
export const readOwnerScope = (
    getScope: () => PortalOwnerScope
): PortalOwnerScope => {
    const scope = getScope();
    requireIdentifier(scope?.ownerId, 'Owner ID');
    if (!Number.isSafeInteger(scope.revision) || scope.revision < 0)
        throw new TypeError('A nonnegative owner revision is required.');
    return { ownerId: scope.ownerId, revision: scope.revision };
};
export const readSession = (value: RuntimeSession): RuntimeSession => {
    if (
        !isObject(value) ||
        Object.values(value).some((entry) => typeof entry !== 'string')
    )
        throw new TypeError(
            'The client session must contain string credentials.'
        );
    return { ...value };
};
export const sameOwner = (a: PortalOwnerScope, b: PortalOwnerScope): boolean =>
    a.ownerId === b.ownerId && a.revision === b.revision;
export const sameSession = (a: RuntimeSession, b: RuntimeSession): boolean =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every((key) => Object.hasOwn(b, key) && a[key] === b[key]);

const canonical = (value: unknown, ancestors = new Set<object>()): unknown => {
    if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'boolean'
    )
        return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'object' && value !== null && !ancestors.has(value)) {
        ancestors.add(value);
        try {
            if (Array.isArray(value))
                return value.map((entry) => canonical(entry, ancestors));
            if (
                isObject(value) &&
                Object.getPrototypeOf(value) === Object.prototype
            )
                return Object.fromEntries(
                    Object.keys(value)
                        .sort()
                        .map((key) => [key, canonical(value[key], ancestors)])
                );
        } finally {
            ancestors.delete(value);
        }
    }
    throw new TypeError('Portal criteria must be JSON data.');
};

export const captureCriteria = (
    value: PortalCollectionCriteria
): PortalCollectionCriteria => {
    const criteria = structuredClone(value);
    if (
        !isObject(criteria) ||
        typeof criteria.selectedCustomViewId !== 'string' ||
        (criteria.searchTerm !== null &&
            typeof criteria.searchTerm !== 'string') ||
        (criteria.sortFieldsByEndUser !== null &&
            !Array.isArray(criteria.sortFieldsByEndUser)) ||
        (criteria.filtersByEndUser !== null &&
            !isObject(criteria.filtersByEndUser)) ||
        !isObject(criteria.searchParamsMap) ||
        Object.values(criteria.searchParamsMap).some(
            (entry) => typeof entry !== 'string'
        ) ||
        (criteria.supportsEndUserSortCleanup !== undefined &&
            criteria.supportsEndUserSortCleanup !== true) ||
        (criteria.supportsEndUserFilterCleanup !== undefined &&
            criteria.supportsEndUserFilterCleanup !== true)
    )
        throw new TypeError('Complete Portal criteria are required.');
    if (
        criteria.calendarLayoutFilter !== undefined &&
        (!isObject(criteria.calendarLayoutFilter) ||
            typeof criteria.calendarLayoutFilter.monthToFetchRecordsFor !==
                'string' ||
            !Number.isFinite(criteria.calendarLayoutFilter.clientUtcOffset) ||
            (criteria.calendarLayoutFilter.clientTimeZone !== undefined &&
                typeof criteria.calendarLayoutFilter.clientTimeZone !==
                    'string'))
    )
        throw new TypeError('The Portal calendar criteria are malformed.');
    const known = new Set([
        'selectedCustomViewId',
        'searchTerm',
        'sortFieldsByEndUser',
        'filtersByEndUser',
        'searchParamsMap',
        'supportsEndUserSortCleanup',
        'supportsEndUserFilterCleanup',
        'calendarLayoutFilter',
    ]);
    if (Object.keys(criteria).some((key) => !known.has(key)))
        throw new TypeError(
            'Portal criteria must not include tokens or pagination state.'
        );
    canonical(criteria);
    return criteria;
};
export const criteriaIdentity = (
    portalId: string,
    parentRecordId: string,
    portalFieldId: string,
    criteria: PortalCollectionCriteria
): string =>
    JSON.stringify(
        canonical({ portalId, parentRecordId, portalFieldId, criteria })
    );
export const captureReadOptions = (
    value: PortalReadOptions
): PortalReadOptions => {
    if (
        !isObject(value) ||
        (value.pagesToFetch !== null &&
            (!Number.isSafeInteger(value.pagesToFetch) ||
                value.pagesToFetch <= 0)) ||
        typeof value.refreshLoggedInPortalRecord !== 'boolean'
    )
        throw new TypeError(
            'Explicit pagesToFetch and refreshLoggedInPortalRecord are required.'
        );
    return {
        pagesToFetch: value.pagesToFetch,
        refreshLoggedInPortalRecord: value.refreshLoggedInPortalRecord,
        signal: value.signal,
    };
};

/** The existing browser example's bounded child-ID rules; no new config evaluator. */
type PortalLinkedFieldConfig = NonNullable<
    Extract<
        NonNullable<
            PortalLoadedResult['payload']['publicFields']['state']['portalFields']
        >[number]['config'],
        { type: 'multipleRecordLinks' | 'multipleLookupValues' }
    >['config']
>;

const configuredChildId = (
    config: PortalLinkedFieldConfig | undefined,
    creating: boolean
): string | null => {
    if (config == null) return null;
    if (
        creating &&
        config.layout !== 'form' &&
        config.allowCreatingRecords !== true
    )
        return null;
    if (!creating && config.allowEditingRecords !== true) return null;
    const sameForm =
        config.allowEditingRecords === true &&
        config.allowCreatingRecords === true &&
        (config.formsForEditingAndCreating == null ||
            config.formsForEditingAndCreating === 'same-form') &&
        (!creating || config.layout !== 'form');
    const value = sameForm
        ? config.extensionIdForCreatingAndEditing
        : creating
          ? config.extensionIdForCreating
          : config.extensionIdForEditing;
    return typeof value === 'string' && value.trim() !== '' ? value : null;
};

export type PortalMetadata = {
    portalId: string;
    token: string;
    parentRecordId: string;
    linkedTableId: string;
    portalFieldId: string;
    createChildId: string | null;
    editChildId: string | null;
    viewAllowsEditing: boolean;
    prefill: LinkedRecordPrefill;
    legacyDetails: RuntimeLinkedRecordDetailField[];
    layoutSettings: PortalLayoutSettings;
};

const validateDetails = (value: unknown): void => {
    if (!Array.isArray(value))
        throw new TypeError('Portal detail fields must be an array.');
    for (const field of value) {
        if (!isObject(field) || typeof field.isHidden !== 'boolean')
            throw new TypeError('The Portal detail field is malformed.');
        requireIdentifier(field.fieldId, 'Detail field ID');
    }
};

export const capturePortalMetadata = (
    value: PortalLoadedResult,
    portalFieldId: string,
    selectedCustomViewId: string
): PortalMetadata => {
    const portal = structuredClone(value);
    if (
        portal.extensionScreen !== 'portal_loaded' ||
        portal.payload?.extensionType !== 'portal' ||
        portal.payload.formRecord?.type !== 'edit' ||
        !isObject(portal.payload.formRecord.data) ||
        !Array.isArray(portal.payload.fieldIdsInPortal) ||
        !portal.payload.fieldIdsInPortal.includes(portalFieldId) ||
        !isObject(portal.payload.fieldIdsToSchemas) ||
        !Object.hasOwn(portal.payload.fieldIdsToSchemas, portalFieldId)
    )
        throw new TypeError(
            'A loaded Portal and its returned linked field are required.'
        );
    const schema = portal.payload.fieldIdsToSchemas[portalFieldId];
    if (
        !isObject(schema) ||
        !isObject(schema.airtableField) ||
        schema.airtableField.id !== portalFieldId ||
        schema.fieldType !== schema.airtableField.config?.type
    )
        throw new TypeError('The Portal field must be a linked-record field.');
    const linkedConfig = getPortalLinkedRecordFieldConfig(schema.airtableField);
    if (linkedConfig === null)
        throw new TypeError(
            'The Portal field must be a direct link or a valid linked-record lookup.'
        );
    const link = linkedConfig.options;
    const lookup =
        schema.fieldType === AirtableFieldType.MULTIPLE_LOOKUP_VALUES;
    requireIdentifier(portalFieldId, 'Portal field ID');
    const linkedTableId = requireIdentifier(
        link.linkedTableId,
        'Linked table ID'
    );
    const inverseId =
        link.inverseLinkFieldId === undefined
            ? null
            : requireIdentifier(
                  link.inverseLinkFieldId,
                  'Inverse linked field ID'
              );
    const config: PortalLinkedFieldConfig | undefined = schema.miniExtConfig;
    if (config !== undefined && !isObject(config))
        throw new TypeError('The Portal field configuration is malformed.');
    if (config?.customViews !== undefined && !Array.isArray(config.customViews))
        throw new TypeError('The Portal custom views are malformed.');
    // Read only the existing id/config structure, not a general authorization schema.
    const views = (
        Array.isArray(config?.customViews) ? config.customViews : []
    ).flatMap((value) =>
        isObject(value) && typeof value.id === 'string'
            ? [
                  {
                      id: value.id,
                      config: isObject(value.config) ? value.config : null,
                  },
              ]
            : []
    );
    const matches = views.filter((view) => view.id === selectedCustomViewId);
    if (
        (views.length === 0 && selectedCustomViewId !== '') ||
        (views.length > 0 && matches.length !== 1)
    )
        throw new TypeError(
            'The selected custom view must come from the loaded Portal field.'
        );
    const viewConfig = matches[0]?.config;
    const layoutConfig =
        viewConfig?.viewBehavior === 'custom' ? viewConfig : config;
    const prefillKey = config?.prefillFieldForCreatingChildExtension;
    const prefillValue =
        typeof prefillKey === 'string' &&
        Object.hasOwn(portal.payload.formRecord.data, prefillKey)
            ? portal.payload.formRecord.data[prefillKey]
            : null;
    const legacyDetails = Object.hasOwn(
        portal.payload.linkedRecordFieldIdToDetailFields,
        portalFieldId
    )
        ? portal.payload.linkedRecordFieldIdToDetailFields[portalFieldId]
        : [];
    validateDetails(legacyDetails);
    const parentRecordId = requireIdentifier(
        portal.payload.formRecord.recordId,
        'Parent record ID'
    );
    return {
        portalId: requireIdentifier(portal.extensionId, 'Portal ID'),
        token: requireIdentifier(
            portal.payload.extensionAccessToken,
            'Portal access token'
        ),
        parentRecordId,
        portalFieldId,
        linkedTableId,
        // Lookup result links do not make the outer computed field creatable.
        createChildId: lookup ? null : configuredChildId(config, true),
        editChildId: configuredChildId(config, false),
        viewAllowsEditing: viewConfig?.disableEditingForCustomView !== true,
        prefill: {
            toLinkToParent:
                inverseId === null
                    ? null
                    : {
                          reversedFieldIdToPrefill: inverseId,
                          parentFormRecordId: parentRecordId,
                      },
            prefillQueryForChildExtension:
                typeof prefillValue === 'string' ? prefillValue : null,
        },
        legacyDetails,
        layoutSettings: structuredClone({
            layout: layoutConfig?.layout,
            disableInlineEdit: layoutConfig?.disableInlineEdit,
            allowUsersToUnlinkRecords: layoutConfig?.allowUsersToUnlinkRecords,
            kanbanCategoryField: layoutConfig?.kanbanCategoryField,
        }),
    };
};

export const capturePage = (
    value: ListPortalLinkedRecordsResult
): ListPortalLinkedRecordsResult => {
    const page = structuredClone(value);
    if (
        !isObject(page) ||
        !Array.isArray(page.recordIds) ||
        (page.airtableOffset !== null &&
            typeof page.airtableOffset !== 'string') ||
        !isObject(page.tableIdsToLinkedTableStates) ||
        (page.customViewDetailFields !== null &&
            !isObject(page.customViewDetailFields))
    )
        throw new TypeError('The Portal list result is malformed.');
    for (const id of page.recordIds) requireIdentifier(id, 'Listed record ID');
    for (const [tableId, table] of Object.entries(
        page.tableIdsToLinkedTableStates
    )) {
        requireIdentifier(tableId, 'Returned table ID');
        if (
            !isObject(table) ||
            !Array.isArray(table.airtableFields) ||
            !isObject(table.recordIdsToAirtableRecords)
        )
            throw new TypeError('The returned Portal table is malformed.');
        for (const field of table.airtableFields) {
            if (!isObject(field))
                throw new TypeError('The returned Portal schema is malformed.');
            requireIdentifier(field.id, 'Returned field ID');
        }
        for (const [recordId, record] of Object.entries(
            table.recordIdsToAirtableRecords
        )) {
            if (
                !isObject(record) ||
                record.id !== recordId ||
                !isObject(record.fields)
            )
                throw new TypeError('The returned Portal record is malformed.');
            requireIdentifier(recordId, 'Returned record ID');
        }
    }
    for (const details of Object.values(page.customViewDetailFields ?? {}))
        validateDetails(details);
    if (
        page.endUserSortCleanup !== undefined &&
        (!isObject(page.endUserSortCleanup) ||
            !Array.isArray(page.endUserSortCleanup.sortFields))
    )
        throw new TypeError('The returned sort cleanup is malformed.');
    if (
        page.endUserFilterCleanup !== undefined &&
        (!isObject(page.endUserFilterCleanup) ||
            (page.endUserFilterCleanup.filters !== null &&
                !isObject(page.endUserFilterCleanup.filters)))
    )
        throw new TypeError('The returned filter cleanup is malformed.');
    return page;
};

/** Merge only already accepted pages of the same fixed criteria. Whole records win. */
export const mergePage = (
    previous: ListPortalLinkedRecordsResult | null,
    incoming: ListPortalLinkedRecordsResult
): ListPortalLinkedRecordsResult => {
    if (previous === null)
        return { ...incoming, recordIds: [...new Set(incoming.recordIds)] };
    const tables: ListPortalLinkedRecordsResult['tableIdsToLinkedTableStates'] =
        {
            ...previous.tableIdsToLinkedTableStates,
        };
    for (const [id, table] of Object.entries(
        incoming.tableIdsToLinkedTableStates
    )) {
        Object.defineProperty(tables, id, {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                airtableFields: table.airtableFields,
                recordIdsToAirtableRecords: {
                    ...(Object.hasOwn(tables, id)
                        ? tables[id].recordIdsToAirtableRecords
                        : {}),
                    ...table.recordIdsToAirtableRecords,
                },
            },
        });
    }
    return {
        ...incoming,
        recordIds: [...new Set([...previous.recordIds, ...incoming.recordIds])],
        tableIdsToLinkedTableStates: tables,
    };
};
export const visibleDetails = (
    metadata: PortalMetadata,
    page: ListPortalLinkedRecordsResult
): RuntimeLinkedRecordDetailField[] => {
    const details =
        page.customViewDetailFields === null
            ? metadata.legacyDetails
            : Object.hasOwn(page.customViewDetailFields, metadata.portalFieldId)
              ? page.customViewDetailFields[metadata.portalFieldId]
              : [];
    return structuredClone(details.filter((field) => !field.isHidden));
};
