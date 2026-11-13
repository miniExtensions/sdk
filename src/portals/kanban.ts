import type { AirtableField, AirtableRecord } from '../formulas/types.js';

export const uncategorizedKanbanColumnId = 'kanban:uncategorized';
const staleColumnPrefix = 'kanban:stale:';

export type KanbanColumn = Readonly<{
    id: string;
    label: string;
    value: string | null;
    recordIds: readonly string[];
}>;
export type KanbanProjectionInput = Readonly<{
    categoryFieldId: string;
    fields: readonly Pick<AirtableField, 'id' | 'config'>[];
    recordIds: readonly string[];
    readRecord: (
        recordId: string
    ) => Pick<AirtableRecord, 'fields'> | null | undefined;
    uncategorizedLabel: string;
    hideEmptyColumns: boolean;
}>;

/** Ordered presentation over an already-authorized immutable native snapshot. */
export function projectKanbanColumns(
    input: KanbanProjectionInput
): readonly KanbanColumn[] {
    const field = input.fields.find(
        (candidate) => candidate.id === input.categoryFieldId
    );
    if (!field)
        throw new Error(
            `Could not find airtable field with id ${input.categoryFieldId}`
        );
    if (field.config.type !== 'singleSelect' || !field.config.options)
        throw new TypeError('Kanban requires configured single-select choices');
    type MutableColumn = {
        id: string;
        label: string;
        value: string | null;
        recordIds: string[];
    };
    const uncategorized: MutableColumn = {
        id: uncategorizedKanbanColumnId,
        label: input.uncategorizedLabel,
        value: null,
        recordIds: [],
    };
    const columns: MutableColumn[] = [
        uncategorized,
        ...field.config.options.choices.map((choice) => ({
            id: choice.id,
            label: choice.name,
            value: choice.name,
            recordIds: [],
        })),
    ];
    const declared = new Map<string, MutableColumn>();
    for (const column of columns)
        if (column.value !== null && !declared.has(column.value))
            declared.set(column.value, column);
    const stale = new Map<string, MutableColumn>();
    for (const recordId of input.recordIds) {
        const record = input.readRecord(recordId);
        if (record == null)
            throw new Error(
                `Could not find record with id ${recordId} in linked table state`
            );
        const raw = record.fields[input.categoryFieldId];
        const value = typeof raw === 'string' ? raw : null;
        let column =
            value === null
                ? uncategorized
                : (declared.get(value) ?? stale.get(value));
        if (!column && value !== null) {
            column = {
                id: `${staleColumnPrefix}${value}`,
                label: value,
                value,
                recordIds: [],
            };
            stale.set(value, column);
            columns.push(column);
        }
        if (!column)
            throw new Error('Could not resolve the Kanban record column.');
        column.recordIds.push(recordId);
    }
    return input.hideEmptyColumns
        ? columns.filter((column) => column.recordIds.length > 0)
        : columns;
}

/** Column identity is distinct from its Airtable category value. */
export function getKanbanColumnAirtableValue(
    columns: readonly KanbanColumn[],
    columnId: string | number
): string | null {
    const column = columns.find((candidate) => candidate.id === columnId);
    if (!column)
        throw new Error(`Could not find Kanban column with id ${columnId}`);
    return column.value;
}

export type KanbanMutationResult<LoggedInRecord> =
    | Readonly<{ type: 'logged-in'; loggedInUserRecord: LoggedInRecord }>
    | Readonly<{ type: 'no-login' }>;

/** Narrow ports captured from the native invocation; no SDK client or store. */
export type KanbanCategoryInvocation<OriginalRecord, LoggedInRecord> =
    Readonly<{
        originalRecord: OriginalRecord;
        columns: readonly KanbanColumn[];
        readCategory: (record: OriginalRecord) => unknown;
        publishOptimistic: (categoryValue: string | null) => void;
        mutate: (
            categoryValue: string | null
        ) => Promise<KanbanMutationResult<LoggedInRecord>>;
        publishLoggedIn: (record: LoggedInRecord) => void;
        restore: (record: OriginalRecord) => void;
    }>;

/**
 * Preserve native immediate allocation and captured settlement. Fulfillment has
 * no success meaning: no-op, no-login and handled rollback all fulfill. This
 * operation neither serializes requests nor adds retirement/retry policy.
 * Keep potentially throwing native request-payload evaluation inside mutate,
 * where it remains post-optimistic and covered by the original catch.
 */
export function createKanbanCategoryOperation<OriginalRecord, LoggedInRecord>(
    capture: (
        recordId: string
    ) => KanbanCategoryInvocation<OriginalRecord, LoggedInRecord>
): (recordId: string, columnId: string | number) => Promise<void> {
    return async (recordId, columnId) => {
        const {
            originalRecord,
            columns,
            readCategory,
            publishOptimistic,
            mutate,
            publishLoggedIn,
            restore,
        } = capture(recordId);
        const value = getKanbanColumnAirtableValue(columns, columnId);
        if (readCategory(originalRecord) === value) return;
        // Intentionally outside try: native optimistic publication errors do
        // not allocate transport or enter the transport/publication rollback.
        publishOptimistic(value);
        try {
            const result = await mutate(value);
            if (result.type === 'logged-in')
                publishLoggedIn(result.loggedInUserRecord);
        } catch {
            // Retain captured whole-record rollback, including propagation of
            // a restore error. This is not a new revision-safe rollback repair.
            restore(originalRecord);
        }
    };
}
