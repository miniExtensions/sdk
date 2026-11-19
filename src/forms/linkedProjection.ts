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

/**
 * A finite native Form condition projection with no linked loading or filtering
 * input. The host must establish that its native loading boundary is clear.
 */
export type CreateNonLinkedFormRecordProjectionInput<
    RecordType extends RuntimeFormRecord = RuntimeFormRecord,
> = Omit<
    CreateLinkedFormRecordProjectionInput<RecordType>,
    | 'linkedTableLoadingStates'
    | 'conditionalLinkedRecordFieldIdsToFilteringValues'
>;

export type LinkedFormProjectionDiagnostic = Readonly<{
    code:
        | 'invalid-snapshot'
        | 'unsupported-driver'
        | 'native-loading-boundary'
        | 'projection-exception';
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

export type NonLinkedFormRecordProjection = LinkedFormRecordProjection;

const isObject = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);

/** Structured cloning must not silently change native property lookup. */
function canCaptureSnapshot(
    value: unknown,
    seen = new WeakSet<object>(),
    inputRoot = false
): boolean {
    if (typeof value === 'function' || typeof value === 'symbol') return false;
    if (value == null || typeof value !== 'object') return true;
    if (seen.has(value)) return true;
    const prototype = Object.getPrototypeOf(value);
    if (
        Array.isArray(value)
            ? prototype !== Array.prototype
            : prototype !== Object.prototype
    )
        return false;
    seen.add(value);
    return Reflect.ownKeys(value).every((key) => {
        if (typeof key === 'symbol') return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
            descriptor == null ||
            !('value' in descriptor) ||
            (!descriptor.enumerable &&
                !(Array.isArray(value) && key === 'length'))
        )
            return false;
        // These intentional low-level hooks are not serialized data. Capture
        // their option values once below; never walk Moment/function objects.
        if (inputRoot && key === 'interpreterOptions') return true;
        return canCaptureSnapshot(descriptor.value, seen);
    });
}

function captureInterpreterOptions(
    value: unknown
): { options: FormulaInterpreterOptions | undefined } | null {
    if (value == null) return { options: undefined };
    if (
        typeof value !== 'object' ||
        Object.getPrototypeOf(value) !== Object.prototype
    )
        return null;
    const options: FormulaInterpreterOptions = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key === 'symbol') return null;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
            descriptor == null ||
            !('value' in descriptor) ||
            !descriptor.enumerable
        )
            return null;
        // Copy descriptor values without consuming a getter or walking the
        // deliberate function/Moment values. This precedes graph validation.
        Object.defineProperty(options, key, {
            value: descriptor.value,
            enumerable: true,
        });
    }
    return { options };
}

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

const nonLinkedPhysicalOperators: Readonly<Record<string, readonly string[]>> =
    {
        singleLineText: [
            'is',
            'isNot',
            'contains',
            'doesNotContain',
            'isEmpty',
            'isNotEmpty',
        ],
        singleSelect: [
            'is',
            'isNot',
            'isAnyOf',
            'isNoneOf',
            'isEmpty',
            'isNotEmpty',
        ],
        multipleSelects: [
            'hasAllOf',
            'hasAnyOf',
            'hasNoneOf',
            'isExactly',
            'isEmpty',
            'isNotEmpty',
        ],
        number: [
            'equals',
            'notEquals',
            'greaterThan',
            'lessThan',
            'greaterThanOrEqualsTo',
            'lessThanOrEqualsTo',
            'isEmpty',
            'isNotEmpty',
        ],
    };

function isNonLinkedDriverMetadata(field: RuntimeAirtableField): boolean {
    const { type, options } = field.config;
    if (type === 'formula') return formulaConditionResultType(field) != null;
    if (field.isComputed !== false) return false;
    if (type === 'singleLineText') return options === null;
    if (type === 'singleSelect' || type === 'multipleSelects') {
        if (!isObject(options) || !Array.isArray(options.choices)) return false;
        const ids = new Set<string>();
        const names = new Set<string>();
        for (let index = 0; index < options.choices.length; index++) {
            const choice = options.choices[index];
            if (
                !Object.hasOwn(options.choices, index) ||
                !isObject(choice) ||
                typeof choice.id !== 'string' ||
                choice.id === '' ||
                typeof choice.name !== 'string' ||
                choice.name === '' ||
                ids.has(choice.id) ||
                names.has(choice.name)
            )
                return false;
            ids.add(choice.id);
            names.add(choice.name);
        }
        return true;
    }
    if (type === 'rating')
        return (
            isObject(options) &&
            typeof options.max === 'number' &&
            Number.isInteger(options.max) &&
            options.max > 0 &&
            typeof options.icon === 'string' &&
            typeof options.color === 'string'
        );
    return (
        (type === 'number' || type === 'percent' || type === 'currency') &&
        isObject(options) &&
        typeof options.precision === 'number' &&
        Number.isFinite(options.precision) &&
        (type !== 'currency' || typeof options.symbol === 'string')
    );
}

/** Inspect every saved leaf, including leaves native short-circuiting may skip. */
function hasOnlyNonLinkedConditions(
    definition: unknown,
    fields: ReadonlyMap<string, RuntimeAirtableField>,
    values: Readonly<RuntimeFormRecord['data']>
): boolean {
    const active = new WeakSet<object>();
    const visit = (group: unknown): boolean => {
        if (
            !isObject(group) ||
            active.has(group) ||
            (group.logicalOperator !== 'and' &&
                group.logicalOperator !== 'or') ||
            !Array.isArray(group.conditions)
        )
            return false;
        active.add(group);
        try {
            for (let index = 0; index < group.conditions.length; index++) {
                if (!Object.hasOwn(group.conditions, index)) return false;
                const condition = group.conditions[index];
                if (!isObject(condition)) return false;
                if (condition.type === 'groupCondition') {
                    if (!visit(condition)) return false;
                    continue;
                }
                if (
                    condition.type !== 'singleCondition' ||
                    !isObject(condition.setting)
                )
                    return false;
                const setting = condition.setting;
                const reference = setting.idOrName;
                if (
                    !isObject(reference) ||
                    reference.type !== 'id' ||
                    typeof reference.id !== 'string' ||
                    reference.id === '' ||
                    typeof setting.type !== 'string' ||
                    typeof setting.fieldType !== 'string'
                )
                    return false;
                const driver = fields.get(reference.id);
                if (driver == null || !isNonLinkedDriverMetadata(driver))
                    return false;
                const resultType =
                    driver.config.type === 'formula'
                        ? formulaConditionResultType(driver)
                        : driver.config.type;
                if (resultType == null || resultType !== setting.fieldType)
                    return false;
                if (driver.config.type === 'formula') {
                    // Match native name-before-ID lookup, but only consume the
                    // captured supplied result; never evaluate the Formula.
                    const supplied =
                        driver.name in values
                            ? values[driver.name]
                            : values[driver.id];
                    if (
                        supplied != null &&
                        (resultType === 'singleLineText'
                            ? typeof supplied !== 'string'
                            : typeof supplied !== 'number' ||
                              !Number.isFinite(supplied))
                    )
                        return false;
                }
                const operators =
                    driver.config.type === 'formula'
                        ? resultType === 'singleLineText'
                            ? ['is']
                            : ['equals']
                        : resultType === 'percent' ||
                            resultType === 'currency' ||
                            resultType === 'rating'
                          ? nonLinkedPhysicalOperators.number
                          : nonLinkedPhysicalOperators[resultType];
                if (operators == null || !operators.includes(setting.type))
                    return false;
                if (setting.type === 'isEmpty' || setting.type === 'isNotEmpty')
                    continue;
                const value = setting.value;
                if (
                    resultType === 'singleSelect' ||
                    resultType === 'multipleSelects'
                ) {
                    if (setting.type === 'is' || setting.type === 'isNot') {
                        if (typeof value !== 'string' || value === '')
                            return false;
                    } else {
                        if (!Array.isArray(value) || value.length === 0)
                            return false;
                        for (let index = 0; index < value.length; index++)
                            if (
                                !Object.hasOwn(value, index) ||
                                typeof value[index] !== 'string' ||
                                value[index] === ''
                            )
                                return false;
                    }
                } else if (resultType === 'singleLineText') {
                    if (
                        typeof value !== 'string' ||
                        (value === '' &&
                            (setting.type === 'is' || setting.type === 'isNot'))
                    )
                        return false;
                } else if (typeof value !== 'number' || !Number.isFinite(value))
                    return false;
            }
            return true;
        } finally {
            active.delete(group);
        }
    };
    return definition == null || visit(definition);
}

/** Compare captured configuration data without depending on object key order. */
function sameNonLinkedMetadata(
    left: unknown,
    right: unknown,
    seen = new WeakMap<object, WeakSet<object>>()
): boolean {
    if (Object.is(left, right)) return true;
    if (
        left == null ||
        right == null ||
        typeof left !== 'object' ||
        typeof right !== 'object' ||
        Array.isArray(left) !== Array.isArray(right) ||
        (Array.isArray(left) &&
            Array.isArray(right) &&
            left.length !== right.length)
    )
        return false;
    const matches = seen.get(left);
    if (matches?.has(right)) return true;
    if (matches == null) seen.set(left, new WeakSet([right]));
    else matches.add(right);
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    return leftKeys.every(
        (key) =>
            Object.hasOwn(right, key) &&
            sameNonLinkedMetadata(
                Reflect.get(left, key),
                Reflect.get(right, key),
                seen
            )
    );
}

function hasNonLinkedFieldConfiguration(field: RuntimeFieldSchema): boolean {
    const config = field.miniExtConfig;
    if (config == null) return true;
    if (!isObject(config)) return false;
    if (
        ('headerSectionTitle' in config &&
            config.headerSectionTitle != null &&
            typeof config.headerSectionTitle !== 'string') ||
        ('enableSectionHeader' in config &&
            config.enableSectionHeader != null &&
            typeof config.enableSectionHeader !== 'boolean') ||
        ('applyFieldConditionsToSection' in config &&
            config.applyFieldConditionsToSection != null &&
            typeof config.applyFieldConditionsToSection !== 'boolean')
    )
        return false;
    return !(
        ('filterLinkedRecordsConditionFields' in config &&
            config.filterLinkedRecordsConditionFields != null &&
            config.filterLinkedRecordsToggle !== false &&
            config.filterApplicationMode !== 'record-finder-only') ||
        ('conditionalLinkedRecordFilterFields' in config &&
            config.conditionalLinkedRecordFilterFields != null &&
            (!Array.isArray(config.conditionalLinkedRecordFilterFields) ||
                config.conditionalLinkedRecordFilterFields.length !== 0))
    );
}

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
    return projectFormRecord(input, 'linked');
}

/**
 * Native JSON projection for the finite saved-ID scalar/select cohort. It does
 * not infer linked loading readiness, filter records or expand Formula values.
 * A blocked result requires the caller's complete original native fallback.
 */
export function createNonLinkedFormRecordProjection<
    RecordType extends RuntimeFormRecord,
>(
    input: CreateNonLinkedFormRecordProjectionInput<RecordType>
): NonLinkedFormRecordProjection {
    return projectFormRecord(input, 'nonlinked');
}

function projectFormRecord<RecordType extends RuntimeFormRecord>(
    input:
        | CreateLinkedFormRecordProjectionInput<RecordType>
        | CreateNonLinkedFormRecordProjectionInput<RecordType>,
    mode: 'linked' | 'nonlinked'
): LinkedFormRecordProjection {
    const blocked = (
        code: LinkedFormProjectionDiagnostic['code']
    ): LinkedFormRecordProjection => ({
        type: 'blocked',
        code,
        diagnostics: [{ code }],
    });
    if (input == null) return blocked('invalid-snapshot');

    try {
        const optionsDescriptor = Object.getOwnPropertyDescriptor(
            input,
            'interpreterOptions'
        );
        if (
            optionsDescriptor != null &&
            (!('value' in optionsDescriptor) || !optionsDescriptor.enumerable)
        )
            return blocked('invalid-snapshot');
        const capturedOptions = captureInterpreterOptions(
            optionsDescriptor?.value
        );
        if (capturedOptions == null) return blocked('invalid-snapshot');
        if (
            !canCaptureSnapshot(input, new WeakSet<object>(), true) ||
            input.compatibility !== 'native-form-v1' ||
            (mode === 'nonlinked' &&
                (Object.hasOwn(input, 'linkedTableLoadingStates') ||
                    Object.hasOwn(
                        input,
                        'conditionalLinkedRecordFieldIdsToFilteringValues'
                    )))
        )
            return blocked('invalid-snapshot');
        const interpreterOptions = capturedOptions.options;
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
            linkedStates:
                mode === 'nonlinked'
                    ? {}
                    : (
                          input as CreateLinkedFormRecordProjectionInput<RecordType>
                      ).linkedTableLoadingStates,
            filters:
                mode === 'nonlinked'
                    ? {}
                    : (
                          input as CreateLinkedFormRecordProjectionInput<RecordType>
                      ).conditionalLinkedRecordFieldIdsToFilteringValues,
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
            if (
                mode === 'nonlinked' &&
                (field.airtableField.isComputed !== physical.isComputed ||
                    !sameNonLinkedMetadata(
                        field.airtableField.config,
                        physical.config
                    ) ||
                    !hasNonLinkedFieldConfiguration(field))
            )
                return blocked('invalid-snapshot');
        }
        if (
            mode === 'nonlinked' &&
            !snapshot.formFields.every((field) =>
                hasOnlyNonLinkedConditions(
                    field.miniExtConfig != null &&
                        'conditionalFields' in field.miniExtConfig
                        ? field.miniExtConfig.conditionalFields
                        : null,
                    byId,
                    snapshot.evaluation.data
                )
            )
        )
            return blocked('unsupported-driver');
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
                { ...interpreterOptions, legacyRuntime: true }
            );
        const passes = (runner: FormulaRunner): boolean => {
            for (const identifier of new Set(
                extractIdentifiersFromExpr(runner.expr)
            )) {
                const field = byId.get(identifier) ?? byName.get(identifier);
                if (field == null)
                    throw new Error(`Unknown field ${identifier}`);
            }
            runner.context = context;
            return !FormulaRunner.isFalsyValue(runner.run());
        };

        const hiddenFieldIds: string[] = [];
        let section: RuntimeConditionsDefinition | null = null;
        const states = Object.values(snapshot.linkedStates);
        const allTablesLoading =
            states.length > 0 &&
            states.every((state) => state.type === 'loading');
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
                // Native's cached empty-identifier path can classify even a
                // scalar/constant section runner as needing linked states.
                // That ambient cache is outside this immutable snapshot.
                // Preserve whole native fallback rather than guess its result.
                if (allTablesLoading && (section != null || own != null))
                    return blocked('native-loading-boundary');
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

        if (mode === 'nonlinked')
            return { type: 'available', formRecord: output, hiddenFieldIds };

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
