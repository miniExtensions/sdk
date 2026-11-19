import type { FormFieldBindings } from './bindings.js';

export type LinkedRecordOpenHistory = ReadonlyMap<string, ReadonlySet<string>>;

type LinkedRecordOpenHistoryAccess = {
    observe(): LinkedRecordOpenHistory | null;
    peek(): LinkedRecordOpenHistory | null;
};

const histories = new WeakMap<
    FormFieldBindings,
    LinkedRecordOpenHistoryAccess
>();

export function registerLinkedRecordOpenHistory(
    fields: FormFieldBindings,
    access: LinkedRecordOpenHistoryAccess
): void {
    histories.set(fields, access);
}

export function readLinkedRecordOpenHistory(
    fields: FormFieldBindings
): LinkedRecordOpenHistory | null {
    return histories.get(fields)?.observe() ?? null;
}

/** Validate a captured history without calling host code during final admission. */
export function isCurrentLinkedRecordOpenHistory(
    fields: FormFieldBindings,
    captured: LinkedRecordOpenHistory | null
): boolean {
    return (histories.get(fields)?.peek() ?? null) === captured;
}
