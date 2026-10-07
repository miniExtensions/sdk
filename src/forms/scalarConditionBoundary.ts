import type { RuntimeAirtableField } from '../runtime/types.js';

/** Internal consumer boundary: inspect the AST, not an optimized formula. */
export function hasSelectCondition(
    definition: unknown,
    fields: readonly RuntimeAirtableField[]
): boolean {
    const visited = new WeakSet<object>();
    const object = (v: unknown): v is Record<string, unknown> =>
        v != null && typeof v === 'object' && !Array.isArray(v);
    const select = (v: unknown) =>
        v === 'singleSelect' || v === 'multipleSelects';
    const visit = (node: unknown): boolean => {
        if (!object(node) || visited.has(node)) return false;
        visited.add(node);
        if (Array.isArray(node.conditions) && node.conditions.some(visit))
            return true;
        const setting = node.setting;
        if (!object(setting)) return false;
        if (select(setting.fieldType)) return true;
        const ref = setting.idOrName;
        return (
            object(ref) &&
            fields.some(
                (field) =>
                    (ref.type === 'id'
                        ? field.id === ref.id
                        : ref.type === 'name' && field.name === ref.name) &&
                    select(field.config.type)
            )
        );
    };
    return visit(definition);
}
