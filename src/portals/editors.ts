import {
    AirtableFieldType,
    type PortalLoadedResult,
    type RuntimeSortField,
    type RuntimeConditionsDefinition,
} from '../runtime/index.js';
import { compileRuntimeConditions } from '../forms/conditions.js';
import { getPortalLinkedRecordFieldConfig } from './helpers.js';
import type {
    PortalCollectionCriteria,
    PortalCollectionSnapshot,
} from './types.js';

const object = (v: unknown): v is Record<string, unknown> =>
    v != null && typeof v === 'object' && !Array.isArray(v);
const policyEncoding = (value: unknown): unknown => {
    if (value === undefined) return ['undefined'];
    if (value === null) return ['null'];
    if (Array.isArray(value))
        return ['array', Array.from(value, policyEncoding)];
    if (object(value))
        return [
            'object',
            Object.entries(value).map(([k, v]) => [k, policyEncoding(v)]),
        ];
    return [typeof value, value];
};
export type PortalEditorOptions = {
    portal: PortalLoadedResult;
    portalFieldId: string;
    criteria: PortalCollectionCriteria;
    snapshot: PortalCollectionSnapshot;
    /** Bind the exact accepted page, criteria, owner/session and configuration epoch. */
    isCurrent(): boolean;
    configurationRevision?(): string | number;
    /** Caller retires rows/paging and other editors before accepting; never reads automatically. */
    onApply(criteria: PortalCollectionCriteria): void;
};
export type PortalEditorField = { id: string; name: string };
export type PortalSortEditorSnapshot = {
    revision: number;
    retired: boolean;
    fields: PortalEditorField[];
    fieldId: string;
    direction: 'asc' | 'desc';
    unresolved: boolean;
    diagnostic: string | null;
    originalCriteria: PortalCollectionCriteria | null;
};
export type PortalFilterEditorSnapshot = {
    revision: number;
    retired: boolean;
    fields: PortalEditorField[];
    fieldId: string;
    operator: string;
    operators: readonly string[];
    operand: string | boolean | string[];
    operandKind: 'none' | 'text' | 'boolean' | 'choices';
    multiple: boolean;
    choices: { id: string; name: string }[];
    unresolved: boolean;
    replacementPrepared: boolean;
    diagnostic: string | null;
    originalCriteria: PortalCollectionCriteria | null;
};
export type PortalSortEditorModel = {
    getSnapshot(): PortalSortEditorSnapshot;
    subscribe(
        listener: (snapshot: PortalSortEditorSnapshot) => void
    ): () => void;
    setField(id: string): boolean;
    setDirection(direction: 'asc' | 'desc'): boolean;
    apply(): boolean;
    clear(): boolean;
    destroy(): void;
};
export type PortalFilterEditorModel = {
    getSnapshot(): PortalFilterEditorSnapshot;
    subscribe(
        listener: (snapshot: PortalFilterEditorSnapshot) => void
    ): () => void;
    setField(id: string): boolean;
    setOperator(operator: string): boolean;
    setOperand(operand: string | boolean | string[]): boolean;
    prepareReplacement(): boolean;
    apply(): boolean;
    clear(): boolean;
    destroy(): void;
};
export type PortalEditorResult<T> =
    | { type: 'ready'; model: T }
    | { type: 'unavailable'; diagnostic: string };
/** A lease for prepared criteria, never record, access or network authority. */
function editorLease<S>(options: PortalEditorOptions, snapshot: () => S) {
    let retired = false,
        delivery = 0;
    const listeners = new Set<(snapshot: S) => void>();
    const key = () =>
        JSON.stringify(
            policyEncoding({
                portal: options.portal,
                snapshot: options.snapshot,
                criteria: options.criteria,
            })
        );
    const accepted = key(),
        configuration = options.configurationRevision?.();
    const destroy = () => {
        if (!retired) {
            retired = true;
            emit();
        }
    };
    // Publication is separately guarded after retirement subscribers may reenter.
    const externalCurrent = (): boolean => {
        try {
            if (
                key() !== accepted ||
                options.configurationRevision?.() !== configuration
            )
                return false;
            const yes = options.isCurrent();
            return (
                yes &&
                key() === accepted &&
                options.configurationRevision?.() === configuration
            );
        } catch {
            return false;
        }
    };
    const current = (): boolean => {
        if (retired) return false;
        const yes = externalCurrent();
        if (!yes) destroy();
        return yes && !retired;
    };
    const emit = () => {
        const id = ++delivery;
        for (const listener of [...listeners]) {
            if (id !== delivery) break;
            if (listeners.has(listener)) {
                try {
                    listener(structuredClone(snapshot()));
                } catch {}
            }
        }
    };
    return {
        current,
        canPublish: externalCurrent,
        emit,
        destroy,
        retired: () => retired,
        subscribe(listener: (snapshot: S) => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}
const textOperators = [
    'is',
    'isNot',
    'contains',
    'doesNotContain',
    'matchesRegex',
    'isOfLength',
    'isEmpty',
    'isNotEmpty',
] as const;
const numericOperators = [
    'equals',
    'notEquals',
    'greaterThan',
    'lessThan',
    'greaterThanOrEqualsTo',
    'lessThanOrEqualsTo',
    'isEmpty',
    'isNotEmpty',
] as const;
const singleOperators = [
    'is',
    'isNot',
    'isAnyOf',
    'isNoneOf',
    'isEmpty',
    'isNotEmpty',
] as const;
const multiOperators = [
    'hasAnyOf',
    'hasAllOf',
    'hasNoneOf',
    'isExactly',
    'isEmpty',
    'isNotEmpty',
] as const;
const selectType = (type: string) =>
    type === 'singleSelect' || type === 'multipleSelects';
// Explicit direct-type capabilities; final proposals still use the strict compiler.
const capabilities = (type: string): readonly string[] => {
    if (type === 'singleSelect') return singleOperators;
    if (type === 'multipleSelects') return multiOperators;
    if (numeric(type)) return numericOperators;
    if (type === 'checkbox') return ['is'];
    if (
        [
            'singleLineText',
            'email',
            'url',
            'multilineText',
            'phoneNumber',
            'barcode',
        ].includes(type)
    )
        return textOperators;
    if (type === 'richText')
        return textOperators.filter((op) => op !== 'is' && op !== 'isNot');
    return [];
};
const numeric = (type: string) =>
    ['number', 'percent', 'currency', 'rating'].includes(type);
const emptyOperator = (operator: string) =>
    operator === 'isEmpty' || operator === 'isNotEmpty';

export function createPortalSortEditor(
    options: PortalEditorOptions
): PortalEditorResult<PortalSortEditorModel> {
    const unavailable = (
        diagnostic: string
    ): PortalEditorResult<PortalSortEditorModel> => ({
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
        if (view != null && !object(view))
            return unavailable('Sort view configuration is malformed.');
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

        const sorts = criteria.sortFieldsByEndUser;
        const existing =
            Array.isArray(sorts) && sorts.length === 1 ? sorts[0] : null;
        const resolvedMatches =
            existing && object(existing.idOrName)
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
        let fieldId = resolved?.id ?? '',
            direction: 'asc' | 'desc' =
                existing?.type === 'desc' ? 'desc' : 'asc',
            revision = 0;
        const state = (): PortalSortEditorSnapshot => ({
            revision,
            retired: lease.retired(),
            fields: lease.retired()
                ? []
                : candidates.map((f) => ({ id: f.id, name: f.name })),
            fieldId: lease.retired() ? '' : fieldId,
            direction,
            unresolved: !simple,
            diagnostic: null,
            originalCriteria: lease.retired()
                ? null
                : structuredClone(criteria),
        });
        const lease = editorLease(options, state);
        const change = () => {
            revision++;
            lease.emit();
        };
        const accept = (sort: RuntimeSortField[]): boolean => {
            if (!lease.current()) return false;
            const next = structuredClone(criteria);
            next.sortFieldsByEndUser = sort;
            lease.destroy();
            if (!lease.canPublish()) return false;
            options.onApply(next);
            return true;
        };
        return {
            type: 'ready',
            model: {
                getSnapshot() {
                    lease.current();
                    return structuredClone(state());
                },
                subscribe: lease.subscribe,
                setField(id) {
                    if (
                        !lease.current() ||
                        (id !== '' && !candidates.some((f) => f.id === id))
                    )
                        return false;
                    fieldId = id;
                    change();
                    return true;
                },
                setDirection(value) {
                    if (
                        !lease.current() ||
                        (value !== 'asc' && value !== 'desc')
                    )
                        return false;
                    direction = value;
                    change();
                    return true;
                },
                apply() {
                    return accept(
                        fieldId === ''
                            ? []
                            : [
                                  {
                                      idOrName: { type: 'id', id: fieldId },
                                      type: direction,
                                  },
                              ]
                    );
                },
                clear() {
                    return accept([]);
                },
                destroy: lease.destroy,
            },
        };
    } catch {
        return unavailable('Sort metadata or configuration is malformed.');
    }
}
export function createPortalFilterEditor(
    options: PortalEditorOptions
): PortalEditorResult<PortalFilterEditorModel> {
    const unavailable = (
        diagnostic: string
    ): PortalEditorResult<PortalFilterEditorModel> => ({
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
            if (selectType(f.config.type)) {
                const choices: unknown =
                    'options' in f.config &&
                    object(f.config.options) &&
                    'choices' in f.config.options
                        ? f.config.options.choices
                        : null;
                if (!Array.isArray(choices))
                    return unavailable(
                        'Returned filter choices are malformed.'
                    );
                const choiceIds = new Set<string>(),
                    choiceNames = new Set<string>();
                for (const choice of Array.from(choices)) {
                    if (
                        !object(choice) ||
                        typeof choice.id !== 'string' ||
                        !choice.id ||
                        typeof choice.name !== 'string' ||
                        !choice.name ||
                        choiceIds.has(choice.id) ||
                        choiceNames.has(choice.name)
                    )
                        return unavailable(
                            'Returned filter choices are malformed or ambiguous.'
                        );
                    choiceIds.add(choice.id);
                    choiceNames.add(choice.name);
                }
            }
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
        if (projection != null && !Array.isArray(projection))
            return unavailable('Filter projection is malformed.');
        const visible = new Set<string>();
        for (const d of projection ?? []) {
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
        if (primary && projection != null) visible.add(primary.id);
        const dropdown = config.dropdownFiltersFields;
        if (
            dropdown != null &&
            (!Array.isArray(dropdown) ||
                Array.from(dropdown).some(
                    (id) => typeof id !== 'string' || !id
                ))
        )
            return unavailable('Filter field restrictions are malformed.');
        const dropdownIds = new Set(
            dropdown == null
                ? fields
                      .filter((f) => selectType(f.config.type))
                      .map((f) => f.id)
                : dropdown
        );
        const choicesFor = (
            f: (typeof fields)[number]
        ): { id: string; name: string }[] => {
            if (
                !selectType(f.config.type) ||
                !object(f.config.options) ||
                !('choices' in f.config.options)
            )
                return [];
            return f.config.options.choices as { id: string; name: string }[];
        };
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
        const allowedOperators = (f: (typeof fields)[number]) =>
            selectType(f.config.type) && choicesFor(f).length === 0
                ? ['isEmpty', 'isNotEmpty']
                : capabilities(f.config.type);
        const candidates = fields.filter(
            (f) =>
                (visible.has(f.id) ||
                    (selectType(f.config.type) && dropdownIds.has(f.id))) &&
                f.isComputed !== true &&
                allowedOperators(f).length > 0
        );
        if (!candidates.length)
            return unavailable(
                'No returned supported condition fields are available for filtering.'
            );

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
        const unresolvedChoice =
            resolved != null &&
            setting != null &&
            selectType(resolved.config.type) &&
            !emptyOperator(String(setting.type)) &&
            !Array.from(
                Array.isArray(setting.value) ? setting.value : [setting.value]
            ).every((id) => choicesFor(resolved).some((c) => c.id === id));
        const simple =
            existing == null ||
            (resolved != null && !unresolvedChoice && valid(existing));
        let fieldId = resolved?.id ?? candidates[0].id;
        let operator =
            resolved && setting
                ? String(setting.type)
                : allowedOperators(candidates[0])[0];
        let operand: string | boolean | string[] =
            resolved && setting
                ? selectType(resolved.config.type)
                    ? Array.isArray(setting.value)
                        ? [...setting.value]
                        : typeof setting.value === 'string'
                          ? [setting.value]
                          : []
                    : resolved.config.type === 'checkbox'
                      ? setting.value === true
                      : typeof setting.value === 'string' ||
                          typeof setting.value === 'number'
                        ? String(setting.value)
                        : ''
                : '';
        let booleanOperand = operand === true;
        let replace = simple,
            diagnostic: string | null = !simple
                ? unresolvedChoice
                    ? 'Some saved choices are unavailable. The entire original filter is preserved. Choose Replace existing filters before applying or clearing.'
                    : 'Richer or unresolved existing filters are preserved. Choose Replace existing filters before applying or clearing.'
                : null,
            revision = 0;
        const identity = resolved && leaf ? leaf.id : 'portal_scalar_filter';
        const selected = () => candidates.find((f) => f.id === fieldId)!;
        const state = (): PortalFilterEditorSnapshot => ({
            revision,
            retired: lease.retired(),
            fields: lease.retired()
                ? []
                : candidates.map((f) => ({ id: f.id, name: f.name })),
            fieldId: lease.retired() ? '' : fieldId,
            operator,
            operators: [...allowedOperators(selected())],
            operand: lease.retired() ? '' : structuredClone(operand),
            operandKind: emptyOperator(operator)
                ? 'none'
                : selectType(selected().config.type)
                  ? 'choices'
                  : selected().config.type === 'checkbox'
                    ? 'boolean'
                    : 'text',
            multiple: operator !== 'is' && operator !== 'isNot',
            choices: lease.retired()
                ? []
                : structuredClone(choicesFor(selected())),
            unresolved: !simple,
            replacementPrepared: replace,
            diagnostic,
            originalCriteria: lease.retired()
                ? null
                : structuredClone(criteria),
        });
        const lease = editorLease(options, state);
        const change = () => {
            revision++;
            lease.emit();
        };
        const fail = (message: string) => {
            diagnostic = message;
            change();
            return false;
        };
        const accept = (
            filters: RuntimeConditionsDefinition | null
        ): boolean => {
            if (!lease.current() || !replace) return false;
            const next = structuredClone(criteria);
            next.filtersByEndUser = filters;
            lease.destroy();
            if (!lease.canPublish()) return false;
            options.onApply(next);
            return true;
        };
        return {
            type: 'ready',
            model: {
                getSnapshot() {
                    lease.current();
                    return structuredClone(state());
                },
                subscribe: lease.subscribe,
                setField(id) {
                    if (
                        !lease.current() ||
                        !candidates.some((f) => f.id === id)
                    )
                        return false;
                    fieldId = id;
                    operator = allowedOperators(selected())[0];
                    operand =
                        selected().config.type === 'checkbox'
                            ? booleanOperand
                            : selectType(selected().config.type)
                              ? []
                              : '';
                    change();
                    return true;
                },
                setOperator(value) {
                    if (
                        !lease.current() ||
                        !allowedOperators(selected()).includes(value)
                    )
                        return false;
                    operator = value;
                    change();
                    return true;
                },
                setOperand(value) {
                    if (!lease.current()) return false;
                    const copied = structuredClone(value);
                    if (
                        !(
                            typeof copied === 'string' ||
                            typeof copied === 'boolean' ||
                            (Array.isArray(copied) &&
                                Array.from(copied).every(
                                    (v) => typeof v === 'string'
                                ))
                        )
                    )
                        return false;
                    if (!lease.current()) return false;
                    operand = copied;
                    if (typeof copied === 'boolean') booleanOperand = copied;
                    change();
                    return true;
                },
                prepareReplacement() {
                    if (!lease.current()) return false;
                    replace = true;
                    diagnostic =
                        'Replacement prepared; existing criteria remain unchanged until Apply or Clear.';
                    change();
                    return true;
                },
                apply() {
                    if (!lease.current() || !replace) return false;
                    const f = selected();
                    let value: unknown;
                    if (emptyOperator(operator)) value = undefined;
                    else if (selectType(f.config.type)) {
                        if (
                            !Array.isArray(operand) ||
                            !operand.length ||
                            operand.some(
                                (id) => !choicesFor(f).some((c) => c.id === id)
                            )
                        )
                            return fail(
                                'Choose a current choice before applying.'
                            );
                        value =
                            operator === 'is' || operator === 'isNot'
                                ? operand.length === 1
                                    ? operand[0]
                                    : null
                                : [...operand];
                    } else if (
                        numeric(f.config.type) ||
                        operator === 'isOfLength'
                    ) {
                        if (
                            typeof operand !== 'string' ||
                            operand.trim() === ''
                        )
                            return fail(
                                'Enter a finite number; blank is not zero.'
                            );
                        value = Number(operand);
                        if (!Number.isFinite(value))
                            return fail('Enter a finite number.');
                    } else if (f.config.type === 'checkbox') {
                        if (typeof operand !== 'boolean')
                            return fail('Choose a boolean value.');
                        value = operand;
                    } else {
                        if (typeof operand !== 'string')
                            return fail('Enter a text value.');
                        value = operand;
                    }
                    const definition = make(
                        f.id,
                        f.config.type,
                        operator,
                        value,
                        identity
                    );
                    if (!valid(definition))
                        return fail(
                            'This condition is incomplete or cannot be safely compiled. Existing criteria are unchanged.'
                        );
                    return accept(definition);
                },
                clear() {
                    return accept(null);
                },
                destroy: lease.destroy,
            },
        };
    } catch {
        return unavailable('Filter metadata or configuration is malformed.');
    }
}
