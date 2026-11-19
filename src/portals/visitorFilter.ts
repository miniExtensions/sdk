import type {
    RuntimeConditionItem,
    RuntimeConditionSetting,
    RuntimeConditionsDefinition,
} from '../runtime/types.js';
import type {
    PortalVisitorSortOutcome,
    PortalVisitorSortStamp,
} from './visitorSort.js';

export type PortalVisitorFilterOperand =
    | Readonly<{ kind: 'none' | 'text' | 'number' | 'boolean' }>
    | Readonly<{
          kind: 'choice' | 'choices';
          choices: readonly Readonly<{ value: string; label: string }>[];
      }>;

export type PortalVisitorFilterOperator = Readonly<{
    label: string;
    /** A complete, host-admitted initial setting in the public wire format. */
    setting: RuntimeConditionSetting;
    operand: PortalVisitorFilterOperand;
}>;

export type PortalVisitorFilterField = Readonly<{
    id: string;
    name: string;
    label?: string;
    operators: readonly PortalVisitorFilterOperator[];
}>;

export type PortalVisitorFilterFrame = Readonly<{
    stamp: PortalVisitorSortStamp;
    fields: readonly PortalVisitorFilterField[];
    criteria: RuntimeConditionsDefinition | null;
    /** Host-projected settings for existing nodes that normalize only on deletion. */
    effectiveSettings?: Readonly<Record<string, RuntimeConditionSetting>>;
}>;

export type PortalVisitorFilterCommand = Readonly<{
    stamp: PortalVisitorSortStamp;
    criteria: RuntimeConditionsDefinition | null;
}>;

export type PortalVisitorFilterOutcome = PortalVisitorSortOutcome;

export type PortalVisitorFilterPort = {
    read(): PortalVisitorFilterFrame | null;
    subscribe(listener: () => void): () => void;
    /** Verify ownership before writes and report allocation only on transport entry. */
    apply(
        command: PortalVisitorFilterCommand
    ): PortalVisitorFilterOutcome | Promise<PortalVisitorFilterOutcome>;
};

type LogicalOperator = RuntimeConditionsDefinition['logicalOperator'];

export type PortalVisitorFilterDraft = {
    current(): boolean;
    canAddGroup(id: string | null): boolean;
    canEditGroup(id: string | null): boolean;
    snapshot(): {
        criteria: RuntimeConditionsDefinition | null;
        fields: readonly PortalVisitorFilterField[];
    };
    settingForEditor(id: string): RuntimeConditionSetting | undefined;
    addCondition(id: string | null): string | null;
    addGroup(id: string | null): string | null;
    setLogicalOperator(id: string | null, operator: LogicalOperator): boolean;
    setField(id: string, fieldId: string): boolean;
    setOperator(id: string, type: RuntimeConditionSetting['type']): boolean;
    setOperand(id: string, value: unknown): boolean;
    remove(id: string): boolean;
    clear(): boolean;
    retire(): void;
    canReport(outcome: PortalVisitorFilterOutcome): boolean;
    commit(): Promise<PortalVisitorFilterOutcome>;
};

type Condition = Extract<RuntimeConditionItem, { type: 'singleCondition' }>;
type Parent = Pick<
    RuntimeConditionsDefinition,
    'logicalOperator' | 'conditions'
>;

const logical = (operator: unknown): operator is LogicalOperator =>
    operator === 'and' || operator === 'or';
const validRevision = (revision: string | number) =>
    (typeof revision === 'string' && revision.length > 0) ||
    Number.isSafeInteger(revision);
const validGeneration = (generation: number) =>
    Number.isSafeInteger(generation) && generation >= 0;

function isRecord(input: unknown): input is Record<string, unknown> {
    return input !== null && typeof input === 'object' && !Array.isArray(input);
}

// The runtime DTO is JSON: object member order is immaterial, array order is not.
function isEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) && Array.isArray(right))
        return (
            left.length === right.length &&
            left.every((value, index) => isEqual(value, right[index]))
        );
    if (!isRecord(left) || !isRecord(right)) return false;
    const keys = Object.keys(left);
    return (
        keys.length === Object.keys(right).length &&
        keys.every(
            (key) => Object.hasOwn(right, key) && isEqual(left[key], right[key])
        )
    );
}

function belongsTo(
    field: PortalVisitorFilterField,
    setting: RuntimeConditionSetting
) {
    const ref = setting.idOrName;
    return ref.type === 'id'
        ? ref.id === field.id
        : ref.type === 'name' && ref.name === field.name;
}

function validOperand(operand: PortalVisitorFilterOperand, value: unknown) {
    switch (operand.kind) {
        case 'none':
            return value === undefined;
        case 'text':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'choice':
            return operand.choices.some((option) => option.value === value);
        case 'choices':
            return (
                Array.isArray(value) &&
                Array.from(value).every((item) =>
                    operand.choices.some((option) => option.value === item)
                )
            );
    }
}

const getValue = (setting: RuntimeConditionSetting): unknown =>
    'value' in setting ? setting.value : undefined;

function validSetting(setting: RuntimeConditionSetting) {
    if (
        typeof setting?.fieldType !== 'string' ||
        typeof setting.type !== 'string'
    )
        return false;
    const ref = setting.idOrName;
    return (
        (ref?.type === 'id' && typeof ref.id === 'string' && !!ref.id) ||
        (ref?.type === 'name' && typeof ref.name === 'string' && !!ref.name)
    );
}

function validTree(parent: Parent, ids: Set<string>): boolean {
    return (
        logical(parent.logicalOperator) &&
        Array.isArray(parent.conditions) &&
        Array.from(parent.conditions).every((node) => {
            if (
                !node ||
                typeof node.id !== 'string' ||
                !node.id ||
                ids.has(node.id)
            )
                return false;
            ids.add(node.id);
            if (node.type === 'groupCondition') return validTree(node, ids);
            return (
                node.type === 'singleCondition' && validSetting(node.setting)
            );
        })
    );
}

function readFrame(
    port: PortalVisitorFilterPort
): PortalVisitorFilterFrame | null {
    try {
        const frame = port.read();
        if (!frame) return null;
        const { stamp, fields, criteria, effectiveSettings } = frame;
        const ids = new Set<string>();
        if (
            typeof stamp.sessionId !== 'string' ||
            !stamp.sessionId ||
            typeof stamp.fieldId !== 'string' ||
            !stamp.fieldId ||
            !(stamp.viewId === null || typeof stamp.viewId === 'string') ||
            !validRevision(stamp.configurationRevision) ||
            !validRevision(stamp.metadataRevision) ||
            !validGeneration(stamp.generation) ||
            !Array.isArray(fields) ||
            new Set(fields.map((field) => field.id)).size !== fields.length ||
            Array.from(fields).some(
                (field) =>
                    typeof field.id !== 'string' ||
                    !field.id ||
                    typeof field.name !== 'string' ||
                    !field.name ||
                    typeof (field.label ?? '') !== 'string' ||
                    !Array.isArray(field.operators) ||
                    field.operators.length === 0 ||
                    new Set(
                        field.operators.map(
                            (operator: PortalVisitorFilterOperator) =>
                                operator.setting.type
                        )
                    ).size !== field.operators.length ||
                    Array.from<PortalVisitorFilterOperator>(
                        field.operators
                    ).some(
                        (operator) =>
                            typeof operator.label !== 'string' ||
                            !validSetting(operator.setting) ||
                            !belongsTo(field, operator.setting) ||
                            !validOperand(
                                operator.operand,
                                getValue(operator.setting)
                            )
                    )
            ) ||
            (criteria !== null && !validTree(criteria, ids)) ||
            (effectiveSettings !== undefined &&
                (!isRecord(effectiveSettings) ||
                    Object.entries(effectiveSettings).some(
                        ([id, setting]) =>
                            !ids.has(id) ||
                            !validSetting(setting as RuntimeConditionSetting)
                    )))
        )
            return null;
        return structuredClone(frame);
    } catch {
        return null;
    }
}

function sameScope(a: PortalVisitorFilterFrame, b: PortalVisitorFilterFrame) {
    return (
        a.stamp.sessionId === b.stamp.sessionId &&
        a.stamp.fieldId === b.stamp.fieldId &&
        a.stamp.viewId === b.stamp.viewId &&
        a.stamp.configurationRevision === b.stamp.configurationRevision &&
        a.stamp.metadataRevision === b.stamp.metadataRevision &&
        isEqual(a.fields, b.fields)
    );
}

// Root criteria are level 0; the native normalizer accepts groups at levels 1 and 2.
const maximumGroupLevel = 2;

function locate(
    parent: Parent,
    id: string,
    parentLevel = 0
):
    | {
          node: RuntimeConditionItem;
          level: number;
      }
    | undefined {
    for (const node of parent.conditions) {
        const level =
            node.type === 'groupCondition' ? parentLevel + 1 : parentLevel;
        if (node.id === id) return { node, level };
        if (node.type !== 'groupCondition') continue;
        const nested = locate(node, id, level);
        if (nested) return nested;
    }
    return undefined;
}

function removeCondition(parent: Parent, id: string, level = 0): boolean {
    for (const [index, node] of parent.conditions.entries()) {
        if (node.id === id) {
            parent.conditions.splice(index, 1);
            return true;
        }
        if (
            node.type === 'groupCondition' &&
            level < maximumGroupLevel &&
            removeCondition(node, id, level + 1)
        ) {
            if (node.conditions.length === 0)
                parent.conditions.splice(index, 1);
            return true;
        }
    }
    return false;
}

function receipt(
    value: PortalVisitorFilterOutcome
): PortalVisitorFilterOutcome {
    if (
        value?.type === 'allocated' &&
        typeof value.requestId === 'string' &&
        value.requestId &&
        validGeneration(value.generation)
    )
        return {
            type: 'allocated',
            requestId: value.requestId,
            generation: value.generation,
        };
    if (value?.type === 'stale' || value?.type === 'unchanged')
        return { type: value.type };
    if (value?.type === 'refused' || value?.type === 'uncertain') {
        const generation = value.committedGeneration;
        if (generation === undefined) return { type: value.type };
        if (validGeneration(generation))
            return { type: value.type, committedGeneration: generation };
    }
    return { type: 'uncertain' };
}

export function resolvePortalVisitorFilterOperator(
    fields: readonly PortalVisitorFilterField[],
    setting: RuntimeConditionSetting
) {
    const matches = fields.filter((field) => belongsTo(field, setting));
    if (matches.length !== 1) return null;
    const field = matches[0];
    const operator = field.operators.find(
        (entry) =>
            entry.setting.type === setting.type &&
            entry.setting.fieldType === setting.fieldType &&
            validOperand(entry.operand, getValue(setting))
    );
    return operator ? { field, operator } : null;
}

/** A tree draft tied to one admitted host frame and one Apply attempt. */
export function createPortalVisitorFilterDraft(
    port: PortalVisitorFilterPort
): PortalVisitorFilterDraft | null {
    const captured = readFrame(port);
    if (!captured) return null;
    let criteria = structuredClone(captured.criteria);
    let retired = false;
    let normalizedOnDeletion = false;
    let submitted: RuntimeConditionsDefinition | null | undefined;
    let nextId = 0;
    const used = new Set<string>();
    if (criteria) validTree(criteria, used);
    const current = () => {
        if (retired) return false;
        const live = readFrame(port);
        if (
            live &&
            sameScope(captured, live) &&
            live.stamp.generation === captured.stamp.generation &&
            isEqual(live.criteria, captured.criteria) &&
            isEqual(live.effectiveSettings, captured.effectiveSettings)
        )
            return true;
        retired = true;
        return false;
    };
    const newId = () => {
        let id: string;
        do {
            id = `portal_filter_${++nextId}`;
        } while (used.has(id));
        used.add(id);
        return id;
    };
    const node = (id: string) => (criteria ? locate(criteria, id) : undefined);
    const condition = (id: string) => {
        const found = node(id);
        return found?.node.type === 'singleCondition' &&
            found.level <= maximumGroupLevel
            ? found.node
            : undefined;
    };
    const groupLevel = (id: string | null) => {
        if (id === null) return 0;
        const found = node(id);
        return found?.node.type === 'groupCondition' ? found.level : undefined;
    };
    const canEditGroup = (id: string | null) => {
        const level = groupLevel(id);
        return level !== undefined && level <= maximumGroupLevel;
    };
    const originalSetting = (id: string) => {
        const original =
            captured.criteria && locate(captured.criteria, id)?.node;
        return original?.type === 'singleCondition'
            ? original.setting
            : undefined;
    };
    const effectiveSetting = (id: string) => {
        const settings = captured.effectiveSettings;
        return settings && Object.hasOwn(settings, id)
            ? settings[id]
            : undefined;
    };
    const projectedSetting = (leaf: Condition) => {
        const effective = effectiveSetting(leaf.id);
        return effective && isEqual(originalSetting(leaf.id), leaf.setting)
            ? effective
            : leaf.setting;
    };
    const editSetting = (leaf: Condition, next: RuntimeConditionSetting) => {
        const effective = effectiveSetting(leaf.id);
        const original = originalSetting(leaf.id);
        // Returning to what the editor initially showed must preserve the saved wire
        // setting. An explicit deletion still reserializes the surviving tree.
        leaf.setting = structuredClone(
            !normalizedOnDeletion &&
                original &&
                effective &&
                isEqual(next, effective)
                ? original
                : next
        );
    };
    const first = captured.fields[0]?.operators[0];
    const canAddGroup = (id: string | null) => {
        const level = groupLevel(id);
        return (
            Boolean(first) && level !== undefined && level < maximumGroupLevel
        );
    };
    const insert = (id: string | null, group: boolean) => {
        if (
            !current() ||
            !first ||
            (group ? !canAddGroup(id) : !canEditGroup(id))
        )
            return null;
        const parent =
            id === null
                ? (criteria ??= { logicalOperator: 'and', conditions: [] })
                : node(id)?.node;
        if (!parent || !('conditions' in parent)) return null;
        const value: RuntimeConditionItem = group
            ? {
                  id: newId(),
                  type: 'groupCondition',
                  logicalOperator: 'and',
                  conditions: [],
              }
            : {
                  id: newId(),
                  type: 'singleCondition',
                  setting: structuredClone(first.setting),
              };
        parent.conditions.push(value);
        return value.id;
    };
    const normalizeAfterRemoval = (parent: Parent, level = 0) => {
        for (const current of parent.conditions) {
            if (current.type === 'groupCondition') {
                if (level < maximumGroupLevel)
                    normalizeAfterRemoval(current, level + 1);
                continue;
            }
            const effective = projectedSetting(current);
            if (effective !== current.setting)
                current.setting = structuredClone(effective);
        }
    };
    return {
        current,
        canAddGroup,
        canEditGroup,
        snapshot() {
            return structuredClone({ criteria, fields: captured.fields });
        },
        settingForEditor(id: string) {
            const leaf = condition(id);
            return leaf ? structuredClone(projectedSetting(leaf)) : undefined;
        },
        addCondition(id: string | null) {
            return insert(id, false);
        },
        addGroup(id: string | null) {
            return insert(id, true);
        },
        setLogicalOperator(id: string | null, operator: LogicalOperator) {
            if (!current() || !logical(operator) || !canEditGroup(id))
                return false;
            const parent = id === null ? criteria : node(id)?.node;
            if (!parent || !('conditions' in parent)) return false;
            parent.logicalOperator = operator;
            return true;
        },
        setField(id: string, fieldId: string) {
            if (!current()) return false;
            const leaf = condition(id);
            const field = captured.fields.find(
                (candidate) => candidate.id === fieldId
            );
            if (!leaf || !field) return false;
            const selected = resolvePortalVisitorFilterOperator(
                captured.fields,
                projectedSetting(leaf)
            );
            if (!selected || selected.field.id === fieldId) return false;
            editSetting(leaf, field.operators[0].setting);
            return true;
        },
        setOperator(id: string, type: RuntimeConditionSetting['type']) {
            if (!current()) return false;
            const leaf = condition(id);
            if (!leaf) return false;
            const setting = projectedSetting(leaf);
            if (setting.type === type) return false;
            const field = resolvePortalVisitorFilterOperator(
                captured.fields,
                setting
            )?.field;
            const operator = field?.operators.find(
                (option) => option.setting.type === type
            );
            if (!operator) return false;
            editSetting(leaf, operator.setting);
            return true;
        },
        setOperand(id: string, value: unknown) {
            if (!current()) return false;
            const leaf = condition(id);
            if (!leaf) return false;
            const setting = projectedSetting(leaf);
            const resolution = resolvePortalVisitorFilterOperator(
                captured.fields,
                setting
            );
            if (
                !resolution ||
                resolution.operator.operand.kind === 'none' ||
                !validOperand(resolution.operator.operand, value)
            )
                return false;
            editSetting(leaf, { ...setting, value } as RuntimeConditionSetting);
            return true;
        },
        remove(id: string) {
            if (!current() || !criteria || !removeCondition(criteria, id))
                return false;
            normalizedOnDeletion = true;
            if (criteria.conditions.length === 0) criteria = null;
            else normalizeAfterRemoval(criteria);
            return true;
        },
        clear() {
            if (!current()) return false;
            criteria = null;
            return true;
        },
        retire() {
            retired = true;
        },
        canReport(outcome: PortalVisitorFilterOutcome) {
            if (submitted === undefined) return true;
            const live = readFrame(port);
            if (!live || !sameScope(captured, live)) return false;
            const generation = live.stamp.generation;
            if (generation < captured.stamp.generation) return false;
            if (
                (outcome.type === 'refused' || outcome.type === 'uncertain') &&
                outcome.committedGeneration !== undefined
            )
                return (
                    generation === outcome.committedGeneration &&
                    isEqual(live.criteria, submitted)
                );
            return (
                (generation === captured.stamp.generation ||
                    (outcome.type === 'allocated' &&
                        generation === outcome.generation)) &&
                (isEqual(live.criteria, captured.criteria) ||
                    isEqual(live.criteria, submitted))
            );
        },
        async commit(): Promise<PortalVisitorFilterOutcome> {
            if (!current()) return { type: 'stale' };
            retired = true;
            if (isEqual(criteria, captured.criteria))
                return { type: 'unchanged' };
            submitted = criteria;
            try {
                return receipt(
                    await port.apply(
                        structuredClone({ stamp: captured.stamp, criteria })
                    )
                );
            } catch {
                return { type: 'uncertain' };
            }
        },
    };
}
