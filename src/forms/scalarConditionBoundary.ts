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

/** Form-only select boundary; dependencies survive compiler constant folding. */
export function inspectFormSelectConditions(
    definition: unknown,
    fields: readonly RuntimeAirtableField[]
):
    | { type: 'supported'; drivers: RuntimeAirtableField[] }
    | { type: 'unsupported' } {
    const drivers: RuntimeAirtableField[] = [];
    const visited = new WeakSet<object>();
    const object = (value: unknown): value is Record<string, unknown> =>
        value != null && typeof value === 'object' && !Array.isArray(value);
    const select = (type: unknown) =>
        type === 'singleSelect' || type === 'multipleSelects';
    const visit = (node: unknown): boolean => {
        if (!object(node) || visited.has(node)) return true;
        visited.add(node);
        if (Array.isArray(node.conditions) && !node.conditions.every(visit))
            return false;
        const setting = node.setting;
        if (!object(setting)) return true;
        const ref = setting.idOrName;
        const matches = object(ref)
            ? fields.filter((field) =>
                  ref.type === 'id'
                      ? field.id === ref.id
                      : ref.type === 'name' && field.name === ref.name
              )
            : [];
        if (
            !select(setting.fieldType) &&
            !matches.some((field) => select(field.config.type))
        )
            return true;
        const driver = matches[0];
        if (
            !select(setting.fieldType) ||
            !object(ref) ||
            ref.type !== 'id' ||
            typeof ref.id !== 'string' ||
            ref.id === '' ||
            matches.length !== 1 ||
            driver == null ||
            typeof driver.name !== 'string' ||
            driver.config.type !== setting.fieldType ||
            (driver.isComputed !== undefined && driver.isComputed !== false) ||
            !(
                setting.fieldType === 'singleSelect'
                    ? [
                          'is',
                          'isNot',
                          'isAnyOf',
                          'isNoneOf',
                          'isEmpty',
                          'isNotEmpty',
                      ]
                    : [
                          'hasAnyOf',
                          'hasAllOf',
                          'hasNoneOf',
                          'isExactly',
                          'isEmpty',
                          'isNotEmpty',
                      ]
            ).includes(String(setting.type))
        )
            return false;
        drivers.push(driver);
        return true;
    };
    return visit(definition)
        ? { type: 'supported', drivers }
        : { type: 'unsupported' };
}
