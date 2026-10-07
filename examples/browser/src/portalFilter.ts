import {
    AirtableFieldType,
    type PortalLoadedResult,
    type RuntimeConditionsDefinition,
} from '@miniextensions/sdk';
import { compileRuntimeConditions } from '@miniextensions/sdk/forms';
import {
    getPortalLinkedRecordFieldConfig,
    type PortalCollectionCriteria,
    type PortalCollectionSnapshot,
} from '@miniextensions/sdk/portals';
import { button, element, labeled } from './dom.js';

export type PortalFilterEditor =
    | { type: 'ready'; node: HTMLElement; destroy(): void }
    | { type: 'unavailable'; diagnostic: string };
const object = (v: unknown): v is Record<string, unknown> =>
    v != null && typeof v === 'object' && !Array.isArray(v);
const operators = [
    'is',
    'isNot',
    'contains',
    'doesNotContain',
    'matchesRegex',
    'isOfLength',
    'isEmpty',
    'isNotEmpty',
    'equals',
    'notEquals',
    'greaterThan',
    'lessThan',
    'greaterThanOrEqualsTo',
    'lessThanOrEqualsTo',
] as const;
const numeric = (type: string) =>
    ['number', 'percent', 'currency', 'rating'].includes(type);
const emptyOperator = (operator: string) =>
    operator === 'isEmpty' || operator === 'isNotEmpty';

/** Installed recipe only. Compiler validation is not record/read authority. */
export function mountPortalScalarFilterEditor(options: {
    portal: PortalLoadedResult;
    portalFieldId: string;
    criteria: PortalCollectionCriteria;
    snapshot: PortalCollectionSnapshot;
    isCurrent(): boolean;
    onApply(criteria: PortalCollectionCriteria): void;
}): PortalFilterEditor {
    const unavailable = (diagnostic: string): PortalFilterEditor => ({
        type: 'unavailable',
        diagnostic,
    });
    try {
        const portal = structuredClone(options.portal);
        const snapshot = structuredClone(options.snapshot);
        const criteria = structuredClone(options.criteria);
        const schema = portal.payload.fieldIdsToSchemas[options.portalFieldId];
        const link = getPortalLinkedRecordFieldConfig(schema?.airtableField);
        if (!link || !object(schema?.miniExtConfig ?? {}))
            return unavailable('Filter configuration is unavailable.');
        const root: Record<string, unknown> = schema.miniExtConfig ?? {};
        const views = root.customViews;
        if (views != null && !Array.isArray(views))
            return unavailable('Filter views are malformed.');
        const matches = (views ?? []).filter(
            (v) => object(v) && v.id === criteria.selectedCustomViewId
        );
        if ((views?.length ?? 0) > 0 && matches.length !== 1)
            return unavailable('Filter view does not match this collection.');
        const view = matches[0]?.config;
        if (view != null && !object(view))
            return unavailable('Filter view settings are malformed.');
        const custom = view?.viewBehavior === 'custom';
        const config = custom ? view : root;
        // Canonical override assigns this key even when the custom view omits it.
        if (
            (custom || Object.hasOwn(root, 'disableFilteringOnExtension')) &&
            config.disableFilteringOnExtension !== false
        )
            return unavailable('Filtering controls are disabled by this view.');
        const fields =
            snapshot.tableIdsToLinkedTableStates[link.options.linkedTableId]
                ?.airtableFields;
        if (!Array.isArray(fields))
            return unavailable(
                'Load this linked table to obtain filter metadata.'
            );
        const ids = new Set<string>();
        for (const f of fields) {
            if (
                !object(f) ||
                typeof f.id !== 'string' ||
                !f.id ||
                ids.has(f.id) ||
                typeof f.name !== 'string' ||
                !f.name ||
                !object(f.config) ||
                !Object.values(AirtableFieldType).some(
                    (t) => t === f.config.type
                ) ||
                (f.isComputed !== undefined &&
                    typeof f.isComputed !== 'boolean') ||
                (f.isPrimaryField !== undefined &&
                    typeof f.isPrimaryField !== 'boolean')
            )
                return unavailable(
                    'Returned filter fields are malformed or ambiguous.'
                );
            ids.add(f.id);
        }
        // Missing and explicitly empty projections have different primary eligibility.
        const map =
            snapshot.customViewDetailFields === null
                ? portal.payload.linkedRecordFieldIdToDetailFields
                : snapshot.customViewDetailFields;
        if (!object(map))
            return unavailable('Filter presentation metadata is unavailable.');
        const projection = map[options.portalFieldId];
        if (projection == null)
            return unavailable('This view has no accepted filter projection.');
        if (!Array.isArray(projection))
            return unavailable('Filter projection is malformed.');
        const visible = new Set<string>();
        for (const d of projection) {
            if (
                !object(d) ||
                typeof d.fieldId !== 'string' ||
                typeof d.isHidden !== 'boolean'
            )
                return unavailable('Filter projection is malformed.');
            if (!d.isHidden) visible.add(d.fieldId);
        }
        const primaryId = config.customPrimaryField;
        if (primaryId != null && typeof primaryId !== 'string')
            return unavailable('Filter primary configuration is malformed.');
        const physicalPrimaries = fields.filter(
            (f) => f.isPrimaryField === true
        );
        if (physicalPrimaries.length > 1)
            return unavailable('Filter primary metadata is ambiguous.');
        const primary =
            primaryId == null
                ? physicalPrimaries[0]
                : fields.find((f) => f.id === primaryId);
        if (primaryId != null && !primary)
            return unavailable(
                'The configured filter primary is not returned.'
            );
        if (primary) visible.add(primary.id);
        const make = (
            fieldId: string,
            fieldType: string,
            operator: string,
            value: unknown,
            id = 'portal_scalar_filter'
        ): RuntimeConditionsDefinition =>
            ({
                logicalOperator: 'and',
                conditions: [
                    {
                        type: 'singleCondition',
                        id,
                        setting: {
                            type: operator,
                            idOrName: { type: 'id', id: fieldId },
                            fieldType,
                            ...(emptyOperator(operator) ? {} : { value }),
                        },
                    },
                ],
            }) as RuntimeConditionsDefinition;
        const valid = (definition: RuntimeConditionsDefinition): boolean => {
            const result = compileRuntimeConditions({
                conditions: definition,
                airtableFields: fields,
                invalidConditionMode: 'strict',
                fieldReferenceMode: 'saved',
            });
            return (
                result.type === 'compiled' && result.diagnostics.length === 0
            );
        };
        const allowedOperators = (field: (typeof fields)[number]) =>
            operators.filter((op) =>
                valid(
                    make(
                        field.id,
                        field.config.type,
                        op,
                        op === 'isOfLength' || numeric(field.config.type)
                            ? 1
                            : field.config.type === 'checkbox'
                              ? false
                              : 'probe'
                    )
                )
            );
        const candidates = fields.filter(
            (f) =>
                visible.has(f.id) &&
                f.isComputed !== true &&
                allowedOperators(f).length > 0
        );
        if (!candidates.length)
            return unavailable(
                'No returned direct scalar fields are available for filtering.'
            );
        const node = element('section');
        node.setAttribute('aria-label', 'Portal scalar filtering');
        const field = element('select');
        for (const f of candidates)
            field.append(new Option(`${f.name} (${f.id})`, f.id));
        const operator = element('select');
        const value = element('input');
        value.type = 'text';
        const bool = element('select');
        bool.append(new Option('False', 'false'), new Option('True', 'true'));
        const message = element('p', '', 'hint');
        message.setAttribute('role', 'status');
        let retired = false;
        const current = () => {
            if (retired || !node.isConnected) return false;
            const yes = options.isCurrent();
            return yes && !retired && node.isConnected;
        };
        const selected = () => candidates.find((f) => f.id === field.value);
        const renderValue = () => {
            const f = selected();
            value.hidden =
                !f ||
                emptyOperator(operator.value) ||
                f.config.type === 'checkbox';
            bool.hidden = !f || f.config.type !== 'checkbox';
        };
        const renderOperators = () => {
            operator.replaceChildren();
            const f = selected();
            if (f)
                for (const op of allowedOperators(f))
                    operator.append(new Option(op, op));
            renderValue();
        };
        renderOperators();
        field.addEventListener('change', () => {
            if (current()) {
                value.value = '';
                renderOperators();
            }
        });
        operator.addEventListener('change', () => {
            if (current()) renderValue();
        });
        const existing = criteria.filtersByEndUser;
        const leaf =
            object(existing) &&
            (existing.logicalOperator === 'and' ||
                existing.logicalOperator === 'or') &&
            Array.isArray(existing.conditions) &&
            existing.conditions.length === 1
                ? existing.conditions[0]
                : null;
        const setting: Record<string, unknown> | null =
            object(leaf) &&
            leaf.type === 'singleCondition' &&
            typeof leaf.id === 'string' &&
            leaf.id.length > 0 &&
            object(leaf.setting)
                ? leaf.setting
                : null;
        const reference = setting?.idOrName;
        const resolved =
            setting && object(reference) && reference.type === 'id'
                ? candidates.find(
                      (f) =>
                          f.id === reference.id &&
                          f.config.type === setting.fieldType
                  )
                : null;
        const simple =
            existing == null || (resolved != null && valid(existing));
        let replace = simple;
        const identity = resolved && leaf ? leaf.id : 'portal_scalar_filter';
        if (resolved && setting) {
            field.value = resolved.id;
            renderOperators();
            operator.value = String(setting.type);
            value.value =
                typeof setting.value === 'string' ||
                typeof setting.value === 'number'
                    ? String(setting.value)
                    : '';
            bool.value = setting.value === true ? 'true' : 'false';
            renderValue();
        }
        if (!simple)
            node.append(
                element(
                    'p',
                    'Richer or unresolved existing filters are preserved. Choose Replace existing filters before applying or clearing.'
                )
            );
        const replacement = button('Replace existing filters', () => {
            if (current()) {
                replace = true;
                apply.disabled = false;
                clear.disabled = false;
                replacement.disabled = true;
                message.textContent =
                    'Replacement prepared; existing criteria remain unchanged until Apply or Clear.';
            }
        });
        const destroy = () => {
            retired = true;
            node.inert = true;
            for (const control of node.querySelectorAll<
                HTMLInputElement | HTMLSelectElement | HTMLButtonElement
            >('input,select,button'))
                control.disabled = true;
        };
        const accept = (filters: RuntimeConditionsDefinition | null) => {
            const next = structuredClone(criteria);
            next.filtersByEndUser = filters;
            destroy();
            options.onApply(next);
        };
        const apply = button('Apply filter', () => {
            if (!current() || !replace) return;
            const f = selected();
            if (
                !f ||
                !allowedOperators(f).includes(
                    operator.value as (typeof operators)[number]
                )
            )
                return;
            let operand: unknown;
            if (emptyOperator(operator.value)) operand = undefined;
            else if (
                numeric(f.config.type) ||
                operator.value === 'isOfLength'
            ) {
                if (value.value.trim() === '') {
                    message.textContent =
                        'Enter a finite number; blank is not zero.';
                    return;
                }
                operand = Number(value.value);
                if (!Number.isFinite(operand)) {
                    message.textContent = 'Enter a finite number.';
                    return;
                }
            } else if (f.config.type === 'checkbox') {
                if (!['true', 'false'].includes(bool.value)) return;
                operand = bool.value === 'true';
            } else operand = value.value;
            const definition = make(
                f.id,
                f.config.type,
                operator.value,
                operand,
                identity
            );
            if (!valid(definition)) {
                message.textContent =
                    'This condition is incomplete or cannot be safely compiled. Existing criteria are unchanged.';
                return;
            }
            accept(definition);
        });
        const clear = button('Clear filter', () => {
            if (current() && replace) accept(null);
        });
        apply.disabled = clear.disabled = !simple;
        if (!simple) node.append(replacement);
        node.append(
            labeled('Filter field', field),
            labeled('Filter operator', operator),
            labeled('Filter value', value),
            labeled('Checkbox value', bool),
            message,
            apply,
            clear
        );
        return { type: 'ready', node, destroy };
    } catch {
        return unavailable('Filter metadata or configuration is malformed.');
    }
}
