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
        const node = element('section');
        node.setAttribute('aria-label', 'Portal condition filtering');
        const field = element('select');
        for (const f of candidates)
            field.append(new Option(`${f.name} (${f.id})`, f.id));
        const operator = element('select');
        const value = element('input');
        value.type = 'text';
        const bool = element('select');
        bool.append(new Option('False', 'false'), new Option('True', 'true'));
        const choices = element('select');
        const choicesRow = labeled('Filter choices', choices);
        const valueRow = labeled('Filter value', value);
        const boolRow = labeled('Checkbox value', bool);
        const message = element('p', '', 'hint');
        message.setAttribute('role', 'status');
        let retired = false;
        const policyKey = () =>
            JSON.stringify({
                schema: options.portal.payload.fieldIdsToSchemas[
                    options.portalFieldId
                ],
                fields: options.snapshot.tableIdsToLinkedTableStates[
                    link.options.linkedTableId
                ]?.airtableFields,
                map:
                    options.snapshot.customViewDetailFields === null
                        ? options.portal.payload
                              .linkedRecordFieldIdToDetailFields
                        : options.snapshot.customViewDetailFields,
                criteria: options.criteria,
            });
        const acceptedPolicyKey = policyKey();
        const current = () => {
            if (retired || !node.isConnected) return false;
            try {
                if (policyKey() !== acceptedPolicyKey) {
                    destroy();
                    return false;
                }
                const yes = options.isCurrent();
                if (policyKey() !== acceptedPolicyKey) {
                    destroy();
                    return false;
                }
                return yes && !retired && node.isConnected;
            } catch {
                destroy();
                return false;
            }
        };
        const selected = () => candidates.find((f) => f.id === field.value);
        const renderValue = () => {
            const f = selected();
            value.hidden =
                !f ||
                emptyOperator(operator.value) ||
                f.config.type === 'checkbox' ||
                selectType(f.config.type);
            bool.hidden =
                !f ||
                emptyOperator(operator.value) ||
                f.config.type !== 'checkbox';
            choices.hidden =
                !f ||
                emptyOperator(operator.value) ||
                !selectType(f.config.type);
            choices.multiple =
                operator.value !== 'is' && operator.value !== 'isNot';
            for (const [row, control] of [
                [valueRow, value],
                [boolRow, bool],
                [choicesRow, choices],
            ] as const) {
                row.hidden = control.hidden;
                // The shipped stylesheet gives labels display:grid, overriding
                // the browser's default [hidden] display rule.
                row.style.display = control.hidden ? 'none' : '';
            }
        };
        const renderOperators = () => {
            operator.replaceChildren();
            choices.replaceChildren();
            const f = selected();
            if (f) {
                choices.append(new Option('Choose a choice', ''));
                for (const option of choicesFor(f))
                    choices.append(new Option(option.name, option.id));
                for (const op of allowedOperators(f))
                    operator.append(new Option(op, op));
            }
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
        const unresolvedChoice =
            resolved != null &&
            setting != null &&
            selectType(resolved.config.type) &&
            !emptyOperator(String(setting.type)) &&
            !Array.from(
                Array.isArray(setting.value) ? setting.value : [setting.value]
            ).every((id) =>
                choicesFor(resolved).some((choice) => choice.id === id)
            );
        const simple =
            existing == null ||
            (resolved != null && !unresolvedChoice && valid(existing));
        let replace = simple;
        const identity = resolved && leaf ? leaf.id : 'portal_scalar_filter';
        if (resolved && setting) {
            field.value = resolved.id;
            renderOperators();
            operator.value = String(setting.type);
            renderValue();
            value.value =
                typeof setting.value === 'string' ||
                typeof setting.value === 'number'
                    ? String(setting.value)
                    : '';
            bool.value = setting.value === true ? 'true' : 'false';
            const ids = Array.isArray(setting.value)
                ? setting.value
                : [setting.value];
            for (const option of Array.from(choices.options))
                option.selected = ids.includes(option.value);
            renderValue();
        }
        if (!simple)
            node.append(
                element(
                    'p',
                    unresolvedChoice
                        ? 'Some saved choices are unavailable. The entire original filter is preserved. Choose Replace existing filters before applying or clearing.'
                        : 'Richer or unresolved existing filters are preserved. Choose Replace existing filters before applying or clearing.'
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
            if (!f || !allowedOperators(f).includes(operator.value)) return;
            let operand: unknown;
            if (emptyOperator(operator.value)) operand = undefined;
            else if (selectType(f.config.type)) {
                const ids = Array.from(choices.selectedOptions)
                    .map((option) => option.value)
                    .filter((id) => id !== '');
                if (
                    !ids.length ||
                    ids.some(
                        (id) =>
                            !choicesFor(f).some((choice) => choice.id === id)
                    )
                ) {
                    message.textContent =
                        'Choose a current choice before applying.';
                    return;
                }
                operand =
                    operator.value === 'is' || operator.value === 'isNot'
                        ? ids[0]
                        : ids;
            } else if (
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
            valueRow,
            boolRow,
            choicesRow,
            message,
            apply,
            clear
        );
        return { type: 'ready', node, destroy };
    } catch {
        return unavailable('Filter metadata or configuration is malformed.');
    }
}
