import type {
    PortalVisitorFilterCommand,
    PortalVisitorFilterField,
    PortalVisitorFilterFrame,
    PortalVisitorFilterPort,
} from '../../src/portals/visitorFilter.js';
import type {
    RuntimeConditionSetting,
    RuntimeConditionsDefinition,
} from '../../src/runtime/types.js';

export const statusChoice = (value: string): RuntimeConditionSetting => ({
    fieldType: 'singleSelect',
    type: 'is',
    idOrName: { type: 'id', id: 'status' },
    value,
});
const choices = [
    { value: 'red', label: 'Red' },
    { value: 'blue', label: 'Blue' },
];
const makeFields = (
    multipleChoices: readonly { value: string; label: string }[]
): PortalVisitorFilterField[] => [
    {
        id: 'status',
        name: 'Status',
        label: 'Current status',
        operators: [
            {
                label: 'Is',
                setting: statusChoice('red'),
                operand: { kind: 'choice', choices },
            },
        ],
    },
    {
        id: 'labels',
        name: 'Labels',
        operators: [
            {
                label: 'Has any',
                operand: { kind: 'choices', choices: multipleChoices },
                setting: {
                    fieldType: 'multipleSelects',
                    type: 'hasAnyOf',
                    idOrName: { type: 'id', id: 'labels' },
                    value: [],
                },
            },
        ],
    },
];
export const leaf = (id: string, setting: RuntimeConditionSetting) => ({
    id,
    type: 'singleCondition' as const,
    setting,
});
export const group = (
    id: string,
    ...conditions: RuntimeConditionsDefinition['conditions']
) => ({
    id,
    type: 'groupCondition' as const,
    logicalOperator: 'or' as const,
    conditions,
});
export const displayed = leaf('renamed', {
    ...statusChoice('red'),
    idOrName: { type: 'name', name: 'Former status' },
});
export const title = leaf('retained-title', {
    fieldType: 'singleLineText',
    type: 'contains',
    idOrName: { type: 'name', name: 'Old title' },
    value: 'Keep this exact leaf',
});

export function quickFilterOwner(
    criteria: RuntimeConditionsDefinition | null,
    dropdownFieldIds = ['labels', 'status'],
    multipleChoices = choices
) {
    const calls: PortalVisitorFilterCommand[] = [];
    const listeners = new Set<() => void>();
    let frame: PortalVisitorFilterFrame = {
        stamp: {
            sessionId: 'portal',
            fieldId: 'linked',
            viewId: 'view-a',
            configurationRevision: 1,
            metadataRevision: 1,
            generation: 1,
        },
        fields: makeFields(multipleChoices),
        criteria,
        dropdownFieldIds,
        effectiveSettings: criteria?.conditions.some(
            (node) => node.id === 'renamed'
        )
            ? { renamed: statusChoice('red') }
            : undefined,
    };
    const update = (next: Partial<PortalVisitorFilterFrame>) => {
        frame = { ...frame, ...next };
        for (const listener of listeners) listener();
    };
    let respond: PortalVisitorFilterPort['apply'] = (command) => {
        const generation = frame.stamp.generation + 1;
        update({
            stamp: { ...frame.stamp, generation },
            criteria: command.criteria,
            effectiveSettings: undefined,
        });
        return {
            type: 'allocated',
            requestId: `first-${calls.length}`,
            generation,
        };
    };
    const port: PortalVisitorFilterPort = {
        read: () => frame,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        apply(command) {
            calls.push(command);
            return respond(command);
        },
    };
    return {
        port,
        calls,
        listeners,
        update,
        respondWith(next: PortalVisitorFilterPort['apply']) {
            respond = next;
        },
    };
}
