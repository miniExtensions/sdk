import { evaluateFormFieldVisibility } from '../forms/visibility.js';
import type {
    PortalLoadedResult,
    RuntimeConditionsDefinition,
} from '../runtime/types.js';
import { getPortalLinkedRecordFieldConfig, isObject } from './helpers.js';

type PortalFieldConfig = NonNullable<
    Extract<
        NonNullable<
            PortalLoadedResult['payload']['publicFields']['state']['portalFields']
        >[number]['config'],
        { type: 'multipleRecordLinks' | 'multipleLookupValues' }
    >['config']
>;
type CanonicalCustomView = NonNullable<
    PortalFieldConfig['customViews']
>[number];

/** Detached eligible metadata only; this descriptor grants no read or action. */
export type PortalAvailableCustomView = Readonly<{
    id: string;
    config: NonNullable<CanonicalCustomView['config']> | null;
}>;

export type PortalViewAvailability = Readonly<{
    views: readonly PortalAvailableCustomView[];
    /** Only an eligible field with an absent/empty configured list is legacy. */
    legacy: boolean;
    /** Generic feedback only: no refused identities or condition diagnostics. */
    unavailable: boolean;
}>;

const refused = (unavailable: boolean): PortalViewAvailability => ({
    views: [],
    legacy: false,
    unavailable,
});

/**
 * Evaluate presentation choices from one complete accepted Portal snapshot.
 * No I/O, mutation, caching, freshness lease or server authorization is added.
 * Re-evaluate accepted parent changes and retain the application's owner guards.
 */
export function evaluatePortalViewAvailability(input: {
    portal: PortalLoadedResult;
    portalFieldId: string;
}): PortalViewAvailability {
    try {
        const { portal, portalFieldId } = input;
        if (
            !isObject(portal) ||
            portal.extensionScreen !== 'portal_loaded' ||
            !isObject(portal.payload)
        )
            return refused(true);
        const { payload } = portal;
        if (
            payload.extensionType !== 'portal' ||
            !isObject(payload.formRecord) ||
            payload.formRecord.type !== 'edit' ||
            !isObject(payload.formRecord.data) ||
            !Array.isArray(payload.usersTableFields) ||
            typeof portalFieldId !== 'string' ||
            portalFieldId.trim() === '' ||
            !Array.isArray(payload.fieldIdsInPortal) ||
            !payload.fieldIdsInPortal.includes(portalFieldId) ||
            !isObject(payload.fieldIdsToSchemas) ||
            !Object.hasOwn(payload.fieldIdsToSchemas, portalFieldId)
        )
            return refused(true);
        const schema = payload.fieldIdsToSchemas[portalFieldId];
        if (
            !isObject(schema) ||
            !isObject(schema.airtableField) ||
            schema.airtableField.id !== portalFieldId ||
            schema.fieldType !== schema.airtableField.config?.type ||
            getPortalLinkedRecordFieldConfig(schema.airtableField) === null
        )
            return refused(true);
        const config: PortalFieldConfig | undefined = schema.miniExtConfig;
        if (config !== undefined && !isObject(config)) return refused(true);
        const visibility = (conditions: RuntimeConditionsDefinition | null) =>
            evaluateFormFieldVisibility({
                field: {
                    ...schema,
                    miniExtConfig: {
                        ...(conditions === null
                            ? {}
                            : { conditionalFields: conditions }),
                        hideFieldIfEmpty: false,
                    },
                },
                airtableFields: payload.usersTableFields,
                data: payload.formRecord.data,
                formRecordType: 'edit',
                evaluationMode: 'runtime',
                invalidConditionMode: 'strict',
            });
        const fieldVisibility = visibility(config?.conditionalFields ?? null);
        const missingFieldDriver = fieldVisibility.diagnostics.some(
            (diagnostic) => diagnostic.code === 'missing-field'
        );
        if (fieldVisibility.type !== 'visible' || missingFieldDriver)
            return refused(
                fieldVisibility.type === 'blocked' || missingFieldDriver
            );
        const configured = config?.customViews;
        if (
            configured === undefined ||
            (Array.isArray(configured) && configured.length === 0)
        )
            return { views: [], legacy: true, unavailable: false };
        if (!Array.isArray(configured)) return refused(true);
        // Count raw identities first; a hidden or malformed twin cannot make a
        // duplicate view uniquely selectable after filtering.
        const counts = new Map<string, number>();
        for (const view of configured)
            if (isObject(view) && typeof view.id === 'string')
                counts.set(view.id, (counts.get(view.id) ?? 0) + 1);
        const views: PortalAvailableCustomView[] = [];
        let unavailable = false;
        for (const view of configured) {
            try {
                if (
                    !isObject(view) ||
                    typeof view.id !== 'string' ||
                    view.id.trim() === '' ||
                    counts.get(view.id) !== 1 ||
                    (view.config != null && !isObject(view.config))
                ) {
                    unavailable = true;
                    continue;
                }
                const current = visibility(
                    view.config?.customViewConditions ?? null
                );
                const missingDriver = current.diagnostics.some(
                    (diagnostic) => diagnostic.code === 'missing-field'
                );
                if (current.type === 'blocked' || missingDriver)
                    unavailable = true;
                else if (current.type === 'visible')
                    views.push({
                        id: view.id,
                        config: structuredClone(view.config ?? null),
                    });
            } catch {
                // A malformed/uncloneable view cannot erase eligible neighbors.
                unavailable = true;
            }
        }
        return { views, legacy: false, unavailable };
    } catch {
        return refused(true);
    }
}
