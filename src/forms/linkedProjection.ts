import type {
    RuntimeAirtableField,
    RuntimeConditionsDefinition,
    RuntimeFieldSchema,
    RuntimeFormRecord,
} from '../runtime/types.js';
import type { TableIdsToLinkedTableLoadingStates } from '../formulas/types.js';
import FormulaRunner from '../formulas/runner.js';
import type {
    FormulaInterpreterOptions,
    InterpreterContext,
} from '../formulas/interpreter/interpreter.js';
import { extractIdentifiersFromExpr } from '../formulas/helpers/extractIdentifiersFromExpr.js';
import { compileSelectConditions } from './selectConditions.js';
import { formulaConditionResultType } from './conditions.js';

type Immutable<T> = T extends readonly (infer Item)[]
    ? readonly Immutable<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: Immutable<T[Key]> }
      : T;

/** The accepted selected-record/primary-display pair, not query or write authority. */
export type FormProjectionDriverPair = Readonly<{
    recordId: string;
    stringValue: string | null | undefined;
}>;

export type FormProjectionLinkedFilters = Readonly<
    Record<
        string,
        | Readonly<Record<string, FormProjectionDriverPair | null | undefined>>
        | null
        | undefined
    >
>;

export type FormProjectionLinkedTableStates =
    Immutable<TableIdsToLinkedTableLoadingStates>;

export type CreateLinkedFormRecordProjectionInput<
    RecordType extends RuntimeFormRecord = RuntimeFormRecord,
> = Readonly<{
    /** Explicit compatibility, including JSON cloning and uncached-ID pruning. */
    compatibility: 'native-form-v1';
    /** Complete accepted output record, including its native metadata. */
    formRecord: Immutable<RecordType>;
    /** Decisions use this entire record before any output field is removed. */
    formRecordForConditionEvaluation?: Immutable<RuntimeFormRecord>;
    /** The actual complete committed Form order, never a visible-field subset. */
    formFields: readonly Immutable<RuntimeFieldSchema>[];
    airtableFields: readonly Immutable<RuntimeAirtableField>[];
    linkedTableLoadingStates: FormProjectionLinkedTableStates;
    conditionalLinkedRecordFieldIdsToFilteringValues: FormProjectionLinkedFilters;
    evaluateConditionalFields?: boolean;
    /** A host-captured identity for a create record; this helper allocates none. */
    createRecordId?: string;
    /** Low-level conversion/date adapters must close over this same snapshot. */
    interpreterOptions?: FormulaInterpreterOptions;
}>;

export type LinkedFormProjectionDiagnostic = Readonly<{
    code: 'invalid-snapshot' | 'unsupported-driver' | 'projection-exception';
}>;

export type LinkedFormRecordProjection =
    | {
          type: 'available';
          /** JSON-normalized output; caller-specific narrowed types are not retained. */
          formRecord: RuntimeFormRecord;
          hiddenFieldIds: readonly string[];
      }
    | {
          type: 'blocked';
          code: LinkedFormProjectionDiagnostic['code'];
          diagnostics: readonly LinkedFormProjectionDiagnostic[];
      };

const isObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

// These are condition drivers, not a restriction on retained output values.
// Other driver families retain the consumer's whole original native fallback.
const driverTypes = new Set([
    'singleLineText',
    'email',
    'url',
    'multilineText',
    'phoneNumber',
    'barcode',
    'richText',
    'number',
    'currency',
    'percent',
    'rating',
    'checkbox',
    'singleSelect',
    'multipleSelects',
    'multipleRecordLinks',
    'multipleLookupValues',
    'date',
    'dateTime',
    'createdTime',
    'lastModifiedTime',
]);

/**
 * A synchronous, detached projection of one application-owned input snapshot.
 * It reads no store/cache/client/provider and creates no draft or Save owner.
 * A blocked result contains no partial output: consumers must use their whole
 * original fallback, outside this helper's catch, preserving native exceptions.
 */
export function createLinkedFormRecordProjection<
    RecordType extends RuntimeFormRecord,
>(
    input: CreateLinkedFormRecordProjectionInput<RecordType>
): LinkedFormRecordProjection {
    const blocked = (
        code: LinkedFormProjectionDiagnostic['code']
    ): LinkedFormRecordProjection => ({
        type: 'blocked',
        code,
        diagnostics: [{ code }],
    });
    if (input == null || input.compatibility !== 'native-form-v1')
        return blocked('invalid-snapshot');

    try {
        // Native projection clones the whole output before evaluating conditions.
        // Preserve omission, non-finite numbers, -0 and metadata JSON behavior.
        const output: RuntimeFormRecord = JSON.parse(
            JSON.stringify(input.formRecord)
        );
        const snapshot = structuredClone({
            evaluation:
                input.formRecordForConditionEvaluation ?? input.formRecord,
            formFields: input.formFields,
            airtableFields: input.airtableFields,
            linkedStates: input.linkedTableLoadingStates,
            filters: input.conditionalLinkedRecordFieldIdsToFilteringValues,
        }) as {
            evaluation: RuntimeFormRecord;
            formFields: RuntimeFieldSchema[];
            airtableFields: RuntimeAirtableField[];
            linkedStates: TableIdsToLinkedTableLoadingStates;
            filters: FormProjectionLinkedFilters;
        };
        if (
            !isObject(output) ||
            !isObject(output.data) ||
            !isObject(snapshot.evaluation) ||
            !isObject(snapshot.evaluation.data) ||
            !Array.isArray(snapshot.formFields) ||
            !Array.isArray(snapshot.airtableFields) ||
            !isObject(snapshot.linkedStates) ||
            !isObject(snapshot.filters)
        )
            return blocked('invalid-snapshot');
        for (const record of [output, snapshot.evaluation]) {
            if (
                (record.type !== 'create' && record.type !== 'edit') ||
                (record.type === 'edit' &&
                    (typeof record.recordId !== 'string' ||
                        typeof record.tableId !== 'string'))
            )
                return blocked('invalid-snapshot');
        }

        const byId = new Map<string, RuntimeAirtableField>();
        const byName = new Map<string, RuntimeAirtableField>();
        for (const field of snapshot.airtableFields) {
            if (
                !isObject(field) ||
                typeof field.id !== 'string' ||
                typeof field.name !== 'string' ||
                !isObject(field.config) ||
                byId.has(field.id) ||
                byName.has(field.name)
            )
                return blocked('invalid-snapshot');
            byId.set(field.id, field);
            byName.set(field.name, field);
        }
        for (const field of byId.values())
            if (field.id !== field.name && byName.has(field.id))
                return blocked('invalid-snapshot');
        const seen = new Set<string>();
        for (const field of snapshot.formFields) {
            const physical = byId.get(field?.airtableField?.id);
            if (
                field == null ||
                physical == null ||
                seen.has(physical.id) ||
                field.fieldType !== physical.config.type ||
                field.airtableField.name !== physical.name ||
                field.airtableField.config.type !== physical.config.type
            )
                return blocked('invalid-snapshot');
            seen.add(physical.id);
        }
        for (const state of Object.values(snapshot.linkedStates)) {
            if (
                state == null ||
                !['notLoaded', 'loading', 'failed', 'loaded'].includes(
                    state.type
                ) ||
                (state.type === 'loaded' &&
                    (!isObject(state.data?.state) ||
                        !isObject(state.data.state.recordIdsToAirtableRecords)))
            )
                return blocked('invalid-snapshot');
        }

        const context: InterpreterContext = {
            record: {
                id:
                    snapshot.evaluation.type === 'edit'
                        ? snapshot.evaluation.recordId
                        : (input.createRecordId ?? ''),
                fields: snapshot.evaluation.data,
            },
            airtableFields: snapshot.airtableFields,
            linkedTableLoadingStates: snapshot.linkedStates,
        };
        const supported = (conditions: RuntimeConditionsDefinition | null) => {
            const active = new WeakSet<object>();
            const visit = (group: RuntimeConditionsDefinition): boolean => {
                if (
                    !isObject(group) ||
                    active.has(group) ||
                    !['and', 'or'].includes(group.logicalOperator) ||
                    !Array.isArray(group.conditions)
                )
                    return false;
                for (let index = 0; index < group.conditions.length; index++)
                    if (!Object.hasOwn(group.conditions, index)) return false;
                active.add(group);
                const result = group.conditions.every((condition) => {
                    if (condition.type === 'groupCondition')
                        return visit(condition);
                    if (condition.type !== 'singleCondition') return false;
                    const reference = condition.setting.idOrName;
                    const driver =
                        reference.type === 'id'
                            ? byId.get(reference.id)
                            : byName.get(reference.name);
                    return (
                        driver != null &&
                        (driverTypes.has(driver.config.type) ||
                            formulaConditionResultType(driver) != null)
                    );
                });
                active.delete(group);
                return result;
            };
            return conditions == null || visit(conditions);
        };
        const runnerFor = (conditions: RuntimeConditionsDefinition | null) =>
            new FormulaRunner(
                compileSelectConditions(
                    conditions,
                    snapshot.airtableFields
                ).formula,
                false,
                { ...input.interpreterOptions, legacyRuntime: true }
            );
        const passes = (runner: FormulaRunner): boolean => {
            let needsLinks = false;
            for (const identifier of new Set(
                extractIdentifiersFromExpr(runner.expr)
            )) {
                const field = byId.get(identifier) ?? byName.get(identifier);
                if (field == null)
                    throw new Error(`Unknown field ${identifier}`);
                if (field.config.type === 'multipleRecordLinks')
                    needsLinks = true;
            }
            const states = Object.values(snapshot.linkedStates);
            if (
                needsLinks &&
                states.length > 0 &&
                states.every((state) => state.type === 'loading')
            )
                return false;
            runner.context = context;
            return !FormulaRunner.isFalsyValue(runner.run());
        };

        const hiddenFieldIds: string[] = [];
        let section: RuntimeConditionsDefinition | null = null;
        if (input.evaluateConditionalFields !== false) {
            for (const field of snapshot.formFields) {
                const config = field.miniExtConfig;
                if (
                    config != null &&
                    'headerSectionTitle' in config &&
                    typeof config.headerSectionTitle === 'string' &&
                    config.headerSectionTitle.trim() !== ''
                )
                    section =
                        config.applyFieldConditionsToSection === true
                            ? (config.conditionalFields ?? null)
                            : null;
                const own =
                    config != null && 'conditionalFields' in config
                        ? (config.conditionalFields ?? null)
                        : null;
                if (!supported(section) || !supported(own))
                    return blocked('unsupported-driver');
                // Native parses both runners before its short-circuit AND.
                const sectionRunner = runnerFor(section);
                const fieldRunner = runnerFor(own);
                if (
                    (section != null || own != null) &&
                    !(passes(sectionRunner) && passes(fieldRunner))
                ) {
                    delete output.data[field.airtableField.id];
                    hiddenFieldIds.push(field.airtableField.id);
                }
            }
        }

        for (const [fieldId, value] of Object.entries(output.data)) {
            const field = byId.get(fieldId);
            const filters = snapshot.filters[fieldId];
            if (
                filters == null ||
                !Array.isArray(value) ||
                !value.every((id) => typeof id === 'string') ||
                field?.config.type !== 'multipleRecordLinks'
            )
                continue;
            if (!isObject(filters)) return blocked('invalid-snapshot');
            const state =
                snapshot.linkedStates[field.config.options.linkedTableId];
            const records =
                state?.type === 'loaded'
                    ? state.data.state.recordIdsToAirtableRecords
                    : {};
            const selected: string[] = [];
            for (const id of value) {
                const row = records[id];
                if (row == null) continue;
                if (typeof row.id !== 'string' || !isObject(row.fields))
                    return blocked('invalid-snapshot');
                const matches = Object.entries(filters).every(
                    ([driverId, pair]) => {
                        if (
                            pair == null ||
                            pair.stringValue == null ||
                            pair.stringValue === ''
                        )
                            return true;
                        const linkedValue = row.fields[driverId];
                        return (
                            Array.isArray(linkedValue) &&
                            linkedValue.includes(pair.recordId)
                        );
                    }
                );
                if (matches) selected.push(row.id);
            }
            output.data[fieldId] = selected;
        }
        return { type: 'available', formRecord: output, hiddenFieldIds };
    } catch {
        return blocked('projection-exception');
    }
}
