import FormulaRunner from '../formulas/runner.js';
import { convertAirtableValueToPrimitive } from '../formulas/valueConversion.js';
import type {
    AirtableRecord,
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
} from '../runtime/types.js';
import { compileRuntimeConditions } from './conditions.js';

export type FormSelectedRecordPolicy = {
    supported: boolean;
    reasons: readonly ('selected-condition' | 'selected-sort')[];
    state: 'not-configured' | 'waiting-data' | 'applied' | 'unsupported';
    diagnostics: readonly {
        code:
            | 'missing-dependency'
            | 'ambiguous-metadata'
            | 'unsupported-condition'
            | 'unsupported-sort'
            | 'invalid-value';
        fieldId?: string;
    }[];
};

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const dense = (value: unknown): value is unknown[] =>
    Array.isArray(value) &&
    Array.from(value).every((_, index) => Object.hasOwn(value, index));
const textTypes = new Set([
    'singleLineText',
    'email',
    'url',
    'multilineText',
    'phoneNumber',
    'richText',
]);
const numericTypes = new Set(['number', 'percent', 'currency', 'rating']);
const direct = (field: RuntimeAirtableField) =>
    field.isComputed === false &&
    (textTypes.has(field.config.type) ||
        numericTypes.has(field.config.type) ||
        ['barcode', 'checkbox', 'singleSelect', 'multipleSelects'].includes(
            field.config.type
        ));

// Canonical sorting uses a natural, case-insensitive en-US comparer. Selects
// instead compare the exact native names by their configured option positions.
const compareText = new Intl.Collator('en-US', {
    numeric: true,
    sensitivity: 'base',
}).compare;
type Primitive = string | number | (string | number)[] | null | undefined;
function compare(a: Primitive, b: Primitive, field: RuntimeAirtableField) {
    if (
        a != null &&
        b != null &&
        (field.config.type === 'singleSelect' ||
            field.config.type === 'multipleSelects')
    ) {
        const av = Array.isArray(a) ? a : [a];
        const bv = Array.isArray(b) ? b : [b];
        const choices = field.config.options.choices;
        for (let index = 0; index < Math.min(av.length, bv.length); index++) {
            const difference =
                choices.findIndex((choice) => choice.name === av[index]) -
                choices.findIndex((choice) => choice.name === bv[index]);
            if (difference) return difference;
        }
        return av.length - bv.length;
    }
    if (typeof a === 'number' && typeof b === 'number')
        return a < b ? -1 : a > b ? 1 : 0;
    return compareText(
        Array.isArray(a) ? a.join(', ') : (a ?? '').toString(),
        Array.isArray(b) ? b.join(', ') : (b ?? '').toString()
    );
}

/** Internal detached presentation only; no draft writes or reads. */
export function projectSelectedRecordsPolicy(input: {
    config: unknown;
    records: readonly AirtableRecord[];
    airtableFields: readonly RuntimeAirtableField[] | null;
    waitingData: boolean;
    /** Private owner receipt: only native-selected, accepted created records. */
    createdRecordIds?: ReadonlySet<string>;
}): { records: AirtableRecord[]; policy: FormSelectedRecordPolicy } {
    const reasons: ('selected-condition' | 'selected-sort')[] = [];
    const diagnostics: FormSelectedRecordPolicy['diagnostics'][number][] = [];
    const result = (
        state: FormSelectedRecordPolicy['state'],
        records: readonly AirtableRecord[] = []
    ) => ({
        records: structuredClone([...records]),
        policy: {
            supported: state === 'not-configured' || state === 'applied',
            reasons: state === 'applied' ? [] : [...reasons],
            state,
            diagnostics: [...diagnostics],
        },
    });
    const refuse = (
        code: FormSelectedRecordPolicy['diagnostics'][number]['code'],
        fieldId?: string
    ) => {
        diagnostics.push({ code, ...(fieldId ? { fieldId } : {}) });
        return result('unsupported');
    };
    try {
        if (input.config == null)
            return result('not-configured', input.records);
        if (!object(input.config)) return refuse('invalid-value');
        const config = input.config;
        const conditions =
            config.filterLinkedRecordsToggle === false ||
            config.filterApplicationMode === 'record-finder-only'
                ? null
                : config.filterLinkedRecordsConditionFields;
        const filtering = conditions != null;
        const calendar =
            config.readOnly !== true && config.recordFinderMode === 'calendar';
        const sorting =
            calendar ||
            (config.sortFields != null &&
                (!Array.isArray(config.sortFields) ||
                    config.sortFields.length !== 0));
        if (filtering) reasons.push('selected-condition');
        if (sorting) reasons.push('selected-sort');
        if (!filtering && !sorting)
            return result('not-configured', input.records);
        if (calendar) return refuse('unsupported-sort');
        if (!input.airtableFields)
            return input.waitingData
                ? result('waiting-data')
                : refuse('missing-dependency');

        const byId = new Map<string, RuntimeAirtableField>();
        const byName = new Map<string, RuntimeAirtableField>();
        for (const field of input.airtableFields) {
            if (
                !object(field) ||
                typeof field.id !== 'string' ||
                !field.id ||
                typeof field.name !== 'string' ||
                !field.name ||
                !object(field.config) ||
                byId.has(field.id) ||
                byName.has(field.name)
            )
                return refuse('ambiguous-metadata');
            byId.set(field.id, field);
            byName.set(field.name, field);
        }
        // The formula interpreter accepts IDs and names. Refuse ambiguous
        // cross-references rather than reading another column accidentally.
        if (
            [...byName].some(
                ([name, field]) => byId.has(name) && byId.get(name) !== field
            )
        )
            return refuse('ambiguous-metadata');
        const dependencies = new Map<string, RuntimeAirtableField>();
        const resolve = (
            reference: unknown,
            reason: 'selected-condition' | 'selected-sort'
        ): RuntimeAirtableField | null => {
            if (
                !object(reference) ||
                (reference.type !== 'id' && reference.type !== 'name')
            )
                return null;
            const key = reference.type === 'id' ? reference.id : reference.name;
            if (typeof key !== 'string' || !key) return null;
            const field =
                reference.type === 'id' ? byId.get(key) : byName.get(key);
            if (!field)
                diagnostics.push({
                    code: 'missing-dependency',
                    ...(reference.type === 'id' ? { fieldId: key } : {}),
                });
            else if (!direct(field))
                diagnostics.push({
                    code:
                        reason === 'selected-condition'
                            ? 'unsupported-condition'
                            : 'unsupported-sort',
                    fieldId: field.id,
                });
            else dependencies.set(field.id, field);
            return field && direct(field) ? field : null;
        };

        let runner: FormulaRunner | null = null;
        if (filtering) {
            const visited = new Set<object>();
            const visit = (group: unknown): boolean => {
                if (
                    !object(group) ||
                    visited.has(group) ||
                    !dense(group.conditions)
                )
                    return false;
                visited.add(group);
                return group.conditions.every((condition) => {
                    if (!object(condition)) return false;
                    return condition.type === 'groupCondition'
                        ? visit(condition)
                        : condition.type === 'singleCondition' &&
                              object(condition.setting) &&
                              resolve(
                                  condition.setting.idOrName,
                                  'selected-condition'
                              ) !== null;
                });
            };
            if (!visit(conditions)) {
                if (!diagnostics.length)
                    diagnostics.push({ code: 'unsupported-condition' });
                return result('unsupported');
            }
            const compiled = compileRuntimeConditions({
                conditions: conditions as RuntimeConditionsDefinition,
                airtableFields: input.airtableFields,
                invalidConditionMode: 'strict',
            });
            if (compiled.type !== 'compiled' || compiled.diagnostics.length)
                return refuse('unsupported-condition');
            runner = new FormulaRunner(compiled.formula);
        }
        const sorts: { field: RuntimeAirtableField; descending: boolean }[] =
            [];
        if (sorting) {
            if (!dense(config.sortFields)) return refuse('unsupported-sort');
            for (const sort of config.sortFields) {
                if (
                    !object(sort) ||
                    (sort.type !== 'asc' && sort.type !== 'desc')
                )
                    return refuse('unsupported-sort');
                const field = resolve(sort.idOrName, 'selected-sort');
                if (!field) {
                    if (!diagnostics.length)
                        diagnostics.push({ code: 'unsupported-sort' });
                    return result('unsupported');
                }
                sorts.push({ field, descending: sort.type === 'desc' });
            }
        }
        for (const field of dependencies.values()) {
            if (
                field.config.type === 'singleSelect' ||
                field.config.type === 'multipleSelects'
            ) {
                const choices = field.config.options?.choices;
                if (!dense(choices))
                    return refuse('ambiguous-metadata', field.id);
                const ids = new Set<string>(),
                    names = new Set<string>();
                for (const choice of choices) {
                    if (
                        !object(choice) ||
                        typeof choice.id !== 'string' ||
                        !choice.id ||
                        typeof choice.name !== 'string' ||
                        !choice.name ||
                        ids.has(choice.id) ||
                        names.has(choice.name)
                    )
                        return refuse('ambiguous-metadata', field.id);
                    ids.add(choice.id);
                    names.add(choice.name);
                }
            }
        }
        const primitives = new Map<AirtableRecord, Map<string, Primitive>>();
        for (const record of input.records) {
            const values = new Map<string, Primitive>();
            for (const field of dependencies.values()) {
                // The runner prefers own name keys, but accepted native values
                // and sorting are ID-keyed. Match visibility's conservative
                // refusal rather than evaluating an unchecked name alias.
                if (
                    field.name !== field.id &&
                    Object.hasOwn(record.fields, field.name)
                )
                    return refuse('invalid-value', field.id);
                const value = record.fields[field.id];
                if (value != null) {
                    const type = field.config.type;
                    if (
                        numericTypes.has(type)
                            ? typeof value !== 'number' ||
                              !Number.isFinite(value)
                            : type === 'checkbox'
                              ? typeof value !== 'boolean'
                              : type === 'multipleSelects'
                                ? !dense(value) ||
                                  value.some((v) => typeof v !== 'string')
                                : type === 'barcode'
                                  ? !object(value) ||
                                    !('text' in value) ||
                                    (value.text != null &&
                                        typeof value.text !== 'string')
                                  : typeof value !== 'string'
                    )
                        return refuse('invalid-value', field.id);
                }
                const primitive =
                    value == null
                        ? value
                        : convertAirtableValueToPrimitive({
                              value,
                              fieldName: field.name,
                              airtableFieldConfig: field.config,
                              source: {
                                  type: 'airtableMock',
                                  linkedTableStates: {},
                              },
                          });
                values.set(
                    field.id,
                    primitive instanceof Date ? NaN : primitive
                );
            }
            primitives.set(record, values);
        }
        const selected = input.records.filter((record) => {
            if (!runner) return true;
            if (input.createdRecordIds?.has(record.id)) return true;
            runner.context = {
                record,
                airtableFields: [...dependencies.values()],
                linkedTableLoadingStates: {},
            };
            const outcome = runner.runWithOutcome();
            if (outcome.type !== 'value')
                throw new Error('Policy evaluation failed.');
            return !FormulaRunner.isFalsyValue(outcome.value);
        });
        // Explicit occurrence index supplies stable ties, including duplicate IDs.
        const ordered = selected.map((record, index) => ({ record, index }));
        ordered.sort((a, b) => {
            for (const { field, descending } of sorts) {
                const difference = compare(
                    primitives.get(a.record)!.get(field.id),
                    primitives.get(b.record)!.get(field.id),
                    field
                );
                if (difference) return descending ? -difference : difference;
            }
            return a.index - b.index;
        });
        return result(
            'applied',
            ordered.map(({ record }) => record)
        );
    } catch {
        return refuse('invalid-value');
    }
}
