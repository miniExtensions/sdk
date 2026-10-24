import type { FieldActionResult } from '../forms/bindings.js';
import type { FormRenderSnapshot } from './formRenderScope.js';
import { FormPageError } from '../forms/pages.js';
import type {
    FieldRendererHost,
    FieldRendererHostSnapshot,
    FieldRendererProps,
} from './rendererRegistry.js';

export type BorrowedFormOwner = {
    owner: object | string | number;
    /** Host committed configuration epoch; must include observed ABA. */
    configuration: object | string | number;
};
export type BorrowedFormField = {
    [K in 'singleLineText' | 'number']: Omit<
        FieldRendererProps<K>,
        'capability'
    > & { editable: boolean };
}['singleLineText' | 'number'];
export type BorrowedFormRead = BorrowedFormOwner & {
    fields: readonly BorrowedFormField[];
    canSubmit: boolean;
};
export type BorrowedFormRenderPort<Submit> = {
    read(): BorrowedFormRead | null;
    subscribe(changed: () => void): () => void;
    /** Synchronous final native owner/config fence before canonical mutation. */
    write(
        expected: BorrowedFormOwner,
        fieldId: string,
        value: string | number | null
    ): boolean;
    /** Call admitAllocation once, after native coordinator waits, before allocation.
     * Once admitted, native allocation/settlement owns the outcome even on retirement. */
    submit(
        expected: BorrowedFormOwner,
        admitAllocation: () => boolean
    ): Promise<Submit>;
};
export type BorrowedFormRenderScope<Submit> = {
    getSnapshot(): FormRenderSnapshot<Submit>;
    subscribe(
        changed: (snapshot: FormRenderSnapshot<Submit>) => void
    ): () => void;
    destroy(): void;
};

/** Native canonical state only. No SDK client, controller, draft or Save result. */
export function createBorrowedFormRenderScope<Submit>(
    port: BorrowedFormRenderPort<Submit>
): BorrowedFormRenderScope<Submit> {
    const initial = port.read();
    if (!initial) throw new Error('A committed native Form owner is required.');
    const expected: BorrowedFormOwner = Object.freeze({
        owner: initial.owner,
        configuration: initial.configuration,
    });
    let retired = false,
        revision = 0;
    const listeners = new Set<(snapshot: FormRenderSnapshot<Submit>) => void>();
    const hosts = new Map<string, FieldRendererHost>();
    let stop: (() => void) | undefined;
    const read = (): BorrowedFormRead | null => {
        if (retired) return null;
        const current = port.read();
        if (
            !current ||
            current.owner !== expected.owner ||
            current.configuration !== expected.configuration
        ) {
            retired = true;
            revision++;
            stop?.();
            stop = undefined;
            return null;
        }
        return current;
    };
    const fieldSnapshot = (fieldId: string): FieldRendererHostSnapshot => {
        const field = read()?.fields.find((f) => f.fieldId === fieldId);
        if (!field)
            return {
                status: retired ? 'retired' : 'hidden',
                reason: 'Native field unavailable',
            };
        const allowed = () => {
            const current = read()?.fields.find((f) => f.fieldId === fieldId);
            return current?.editable === true && !current.pending;
        };
        const write = (value: string | number | null) =>
            (value === null ||
                typeof value ===
                    (field.physicalKind === 'singleLineText'
                        ? 'string'
                        : 'number')) &&
            allowed() &&
            port.write(expected, fieldId, value);
        if (field.physicalKind === 'singleLineText')
            return {
                status: 'ready',
                fields: [
                    {
                        ...field,
                        capability: field.editable
                            ? {
                                  type: 'editable',
                                  setValue: (
                                      value: string | number | null
                                  ): FieldActionResult =>
                                      write(value)
                                          ? { accepted: true }
                                          : {
                                                accepted: false,
                                                reason: 'retired',
                                            },
                              }
                            : { type: 'readonly' },
                    },
                ],
            };
        return {
            status: 'ready',
            fields: [
                {
                    ...field,
                    capability: field.editable
                        ? {
                              type: 'editable',
                              setValue: (
                                  value: string | number | null
                              ): FieldActionResult =>
                                  write(value)
                                      ? { accepted: true }
                                      : { accepted: false, reason: 'retired' },
                          }
                        : { type: 'readonly' },
                },
            ],
        };
    };
    const host = (fieldId: string): FieldRendererHost => {
        const existing = hosts.get(fieldId);
        if (existing) return existing;
        const value: FieldRendererHost = {
            getSnapshot: () => fieldSnapshot(fieldId),
            subscribe: (changed) =>
                subscribe(() => changed(fieldSnapshot(fieldId))),
            dispose: () => {},
        };
        hosts.set(fieldId, value);
        return value;
    };
    const snapshot = (): FormRenderSnapshot<Submit> => {
        const current = read();
        let used = false;
        return {
            revision,
            retired,
            page: {
                revision,
                status: retired ? 'retired' : 'ready',
                pages: [],
                activePageIndex: 0,
                currentFieldIds: current?.fields.map((f) => f.fieldId) ?? [],
                canBack: false,
                canNext: false,
                canSubmit: current?.canSubmit === true,
                canReview: false,
                reviewing: false,
                problems: [],
            },
            fields:
                current?.fields.map((f) => ({
                    fieldId: f.fieldId,
                    host: host(f.fieldId),
                })) ?? [],
            status: 'ready',
            canSave: current?.canSubmit === true,
            errorMessage: null,
            validationErrors: [],
            actions: {
                back: () => ({ accepted: false, reason: 'no-page' }),
                next: () => ({ accepted: false, reason: 'no-page' }),
                submit: async () => {
                    if (used) throw new FormPageError('retired');
                    used = true;
                    if (!read()?.canSubmit) throw new FormPageError('retired');
                    let allocated = false;
                    return port.submit(expected, () => {
                        if (allocated) return false;
                        allocated = true;
                        return read()?.canSubmit === true;
                    });
                },
            },
        };
    };
    const subscribe = (
        changed: (snapshot: FormRenderSnapshot<Submit>) => void
    ) => {
        listeners.add(changed);
        return () => {
            listeners.delete(changed);
        };
    };
    const notify = () => {
        revision++;
        read();
        for (const changed of [...listeners]) changed(snapshot());
    };
    const acquired = port.subscribe(notify);
    if (retired) acquired();
    else stop = acquired;
    read();
    return {
        getSnapshot: snapshot,
        subscribe,
        destroy: () => {
            if (retired) return;
            retired = true;
            stop?.();
            stop = undefined;
            notify();
        },
    };
}
