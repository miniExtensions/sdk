import {
    AirtableFieldType,
    type PortalLoadedResult,
    type RuntimeSortField,
} from '@miniextensions/sdk';
import {
    getPortalLinkedRecordFieldConfig,
    type PortalCollectionCriteria,
    type PortalCollectionSnapshot,
} from '@miniextensions/sdk/portals';
import { button, element, labeled } from './dom.js';

export type PortalSortEditor =
    | { type: 'ready'; node: HTMLElement; destroy(): void }
    | { type: 'unavailable'; diagnostic: string };

const object = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

/** Shipped recipe only. Criteria construction is not record/access authority. */
export function mountPortalSortEditor(options: {
    portal: PortalLoadedResult;
    portalFieldId: string;
    criteria: PortalCollectionCriteria;
    snapshot: PortalCollectionSnapshot;
    /** Bind collection, accepted snapshot/mount epoch, owner/session and live DOM. */
    isCurrent(): boolean;
    onApply(criteria: PortalCollectionCriteria): void;
}): PortalSortEditor {
    const unavailable = (diagnostic: string): PortalSortEditor => ({
        type: 'unavailable',
        diagnostic,
    });
    try {
        let portal: PortalLoadedResult;
        let criteria: PortalCollectionCriteria;
        let snapshot: PortalCollectionSnapshot;
        try {
            portal = structuredClone(options.portal);
            criteria = structuredClone(options.criteria);
            snapshot = structuredClone(options.snapshot);
        } catch {
            return unavailable('Sort metadata cannot be reconstructed.');
        }
        const schema = portal.payload.fieldIdsToSchemas[options.portalFieldId];
        const link = getPortalLinkedRecordFieldConfig(schema?.airtableField);
        if (link == null || !object(schema?.miniExtConfig ?? {}))
            return unavailable('Sort configuration is unavailable.');
        const root = schema.miniExtConfig ?? {};
        const views = 'customViews' in root ? root.customViews : undefined;
        if (views != null && !Array.isArray(views))
            return unavailable('Sort custom views are malformed.');
        const matches = (views ?? []).filter(
            (view) => view.id === criteria.selectedCustomViewId
        );
        if ((views?.length ?? 0) > 0 && matches.length !== 1)
            return unavailable(
                'Sort view does not match the accepted collection.'
            );
        const view = matches[0]?.config;
        // These overridable keys replace root values, including omitted values.
        const config = view?.viewBehavior === 'custom' ? view : root;
        const hide =
            'hideSortButtonForPortal' in config
                ? config.hideSortButtonForPortal
                : undefined;
        const allowed =
            'sortingOnExtensionFields' in config
                ? config.sortingOnExtensionFields
                : undefined;
        const primary =
            'customPrimaryField' in config
                ? config.customPrimaryField
                : undefined;
        const layout = 'layout' in config ? config.layout : undefined;
        if (
            (hide !== undefined &&
                hide !== null &&
                typeof hide !== 'boolean') ||
            (allowed != null &&
                (!Array.isArray(allowed) ||
                    allowed.some(
                        (id) => typeof id !== 'string' || id.length === 0
                    ))) ||
            (primary != null && typeof primary !== 'string')
        )
            return unavailable('Sort configuration is malformed.');
        if (hide === true)
            return unavailable('Sorting controls are hidden by this view.');
        if (layout != null && layout !== 'grid' && layout !== 'list')
            return unavailable(
                'This sort recipe supports table and list presentation only.'
            );
        const fields =
            snapshot.tableIdsToLinkedTableStates[link.options.linkedTableId]
                ?.airtableFields;
        if (!Array.isArray(fields) || !Array.isArray(snapshot.detailFields))
            return unavailable('Load this view to obtain its sort metadata.');
        const ids = new Set<string>();
        for (const field of fields) {
            if (
                !object(field) ||
                typeof field.id !== 'string' ||
                !field.id ||
                ids.has(field.id) ||
                typeof field.name !== 'string' ||
                !field.name ||
                !object(field.config) ||
                !Object.values(AirtableFieldType).some(
                    (type) => type === field.config.type
                ) ||
                (field.isPrimaryField !== undefined &&
                    typeof field.isPrimaryField !== 'boolean') ||
                (field.isComputed !== undefined &&
                    typeof field.isComputed !== 'boolean')
            )
                return unavailable(
                    'Returned sort fields are malformed or ambiguous.'
                );
            ids.add(field.id);
        }
        const visible = new Set<string>();
        for (const detail of snapshot.detailFields) {
            if (
                !object(detail) ||
                typeof detail.fieldId !== 'string' ||
                typeof detail.isHidden !== 'boolean'
            )
                return unavailable('Returned sort presentation is malformed.');
            if (!detail.isHidden) visible.add(detail.fieldId);
        }
        const explicitPrimary =
            primary == null ? undefined : fields.find((f) => f.id === primary);
        const physicalPrimaries = fields.filter(
            (f) => f.isPrimaryField === true
        );
        if (explicitPrimary == null && physicalPrimaries.length > 1)
            return unavailable('Returned primary field metadata is ambiguous.');
        // Never guess that the first returned field is primary.
        const primaryField = explicitPrimary ?? physicalPrimaries[0];
        if (primaryField) visible.add(primaryField.id);
        const candidates = fields.filter(
            (f) =>
                visible.has(f.id) &&
                (allowed == null ||
                    allowed.length === 0 ||
                    allowed.includes(f.id))
        );
        if (candidates.length === 0)
            return unavailable(
                'No returned visible fields are available for sorting.'
            );
        const node = element('section');
        node.setAttribute('aria-label', 'Portal sorting');
        const field = element('select');
        field.append(new Option('Use configured order', ''));
        for (const candidate of candidates)
            field.append(
                new Option(`${candidate.name} (${candidate.id})`, candidate.id)
            );
        const direction = element('select');
        direction.append(
            new Option('Ascending', 'asc'),
            new Option('Descending', 'desc')
        );
        const sorts = criteria.sortFieldsByEndUser;
        const existing =
            Array.isArray(sorts) && sorts.length === 1 ? sorts[0] : null;
        const resolvedMatches =
            existing != null && object(existing.idOrName)
                ? candidates.filter((f) =>
                      existing.idOrName.type === 'id'
                          ? f.id === existing.idOrName.id
                          : existing.idOrName.type === 'name' &&
                            f.name === existing.idOrName.name
                  )
                : [];
        const resolved =
            resolvedMatches.length === 1 ? resolvedMatches[0] : null;
        const simple =
            sorts == null ||
            (Array.isArray(sorts) && sorts.length === 0) ||
            (resolved != null &&
                (existing?.type === 'asc' || existing?.type === 'desc'));
        if (resolved && existing) {
            field.value = resolved.id;
            direction.value = existing.type;
        }
        if (!simple)
            node.append(
                element(
                    'p',
                    'Existing multiple or unresolved sorts are preserved. Choose Replace existing sorts to explicitly replace them.'
                )
            );
        let retired = false;
        const destroy = (): void => {
            retired = true;
            node.inert = true;
            apply.disabled = true;
            field.disabled = true;
            direction.disabled = true;
        };
        const apply = button(
            simple ? 'Apply sort' : 'Replace existing sorts',
            () => {
                if (retired || !node.isConnected) return;
                const current = options.isCurrent();
                if (!current || retired || !node.isConnected) return;
                const selected = candidates.find((f) => f.id === field.value);
                if (field.value !== '' && selected == null) return;
                if (direction.value !== 'asc' && direction.value !== 'desc')
                    return;
                const sort: RuntimeSortField[] =
                    selected == null
                        ? []
                        : [
                              {
                                  idOrName: { type: 'id', id: selected.id },
                                  type: direction.value,
                              },
                          ];
                const next = structuredClone(criteria);
                next.sortFieldsByEndUser = sort;
                // Retire before calling caller code, which can synchronously reenter.
                destroy();
                options.onApply(next);
            }
        );
        node.append(
            labeled('Sort field', field),
            labeled('Sort direction', direction),
            apply
        );
        return { type: 'ready', node, destroy };
    } catch {
        return unavailable('Sort metadata or configuration is malformed.');
    }
}
