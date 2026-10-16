export type FormProgressValues = Record<
    string,
    string | number | boolean | null
>;

export type FormProgressToken = { draftId: string; writeId: string };
export type FormProgressSnapshot = {
    token: FormProgressToken;
    values: FormProgressValues;
};
export type FormProgressStorageAdapter = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};
export type FormProgressLockManager = {
    request<Result>(name: string, callback: () => Result): Promise<Result>;
};
export type FormProgressStorageOptions = {
    /** Opaque application scope; never put credentials in this string. */
    scope: string;
    getStorage(): FormProgressStorageAdapter | undefined;
    /** Mutations require cooperating exclusive Web Locks; there is no fallback. */
    getLocks(): FormProgressLockManager | undefined;
    /** Supply fresh globally unique IDs, including across owners and documents. */
    createId(): string;
    /** Bind the accepted create Form, visitor, session and application epoch. */
    isCurrent(): boolean;
};
type Failure = { status: 'invalid' | 'unavailable' | 'retired' };
export type FormProgressReadResult =
    | { status: 'read'; snapshot: FormProgressSnapshot | null }
    | Failure;
export type FormProgressWriteResult =
    | { status: 'written'; snapshot: FormProgressSnapshot }
    | { status: 'conflict' }
    | Failure;
export type FormProgressRemovalResult =
    | { status: 'removed' | 'absent' | 'conflict' }
    | Failure;
export type FormProgressStorage = {
    read(): FormProgressReadResult;
    write(args: {
        expected: FormProgressToken | null;
        values: FormProgressValues;
    }): Promise<FormProgressWriteResult>;
    remove(expected: FormProgressToken): Promise<FormProgressRemovalResult>;
    /** Retire this owner and its queued work without deleting any stored bytes. */
    destroy(): void;
};

const kind = 'miniExtensions-sdk-create-progress';
const version = 1;
const prefix = 'miniExtensions-sdk:create-progress:v1:';
const invalid = Symbol('invalid');
const retiredOperation = Symbol('retired');

/**
 * Explicit scalar create-progress storage. Construction performs no I/O. This
 * owner grants no field, restore, submit, session or unknown-write authority.
 */
export const createFormProgressStorage = (
    options: FormProgressStorageOptions
): FormProgressStorage => {
    const { scope, getStorage, getLocks, createId, isCurrent } = options;
    if (typeof scope !== 'string' || scope.trim() === '')
        throw new TypeError('An opaque Form progress scope is required.');
    const key = prefix + scope;
    const lockName = key;
    const usedIds = new Set<string>();
    let retired = false;
    let checking = false;
    let calling = false;
    let requesting = false;

    const current = (): boolean => {
        if (retired) return false;
        if (checking || calling) {
            retired = true;
            return false;
        }
        checking = true;
        try {
            if (isCurrent() !== true) retired = true;
        } catch {
            retired = true;
        } finally {
            checking = false;
        }
        return !retired;
    };
    const enter = (): boolean => {
        if (requesting) retired = true;
        return current();
    };
    const guarded = <Result>(callback: () => Result): Result => {
        if (!current()) throw retiredOperation;
        let result!: Result;
        let error: unknown;
        let failed = false;
        calling = true;
        try {
            result = callback();
        } catch (caught) {
            failed = true;
            error = caught;
        } finally {
            calling = false;
        }
        if (!current()) throw retiredOperation;
        if (failed) throw error;
        return result;
    };
    const failure = (error: unknown): Failure => {
        if (error === retiredOperation || !current())
            return { status: 'retired' };
        return { status: error === invalid ? 'invalid' : 'unavailable' };
    };
    const object = (value: unknown): value is Record<string, unknown> =>
        typeof value === 'object' && value !== null && !Array.isArray(value);
    const identifier = (value: unknown): value is string =>
        typeof value === 'string' && value.trim() !== '';
    const copyToken = (value: unknown): FormProgressToken => {
        if (!object(value)) throw invalid;
        const names = guarded(() => Object.keys(value));
        if (!names.includes('draftId') || !names.includes('writeId'))
            throw invalid;
        const draftId = guarded(() => value.draftId);
        const writeId = guarded(() => value.writeId);
        if (!identifier(draftId) || !identifier(writeId) || draftId === writeId)
            throw invalid;
        return { draftId, writeId };
    };
    const copyValues = (value: unknown): FormProgressValues => {
        if (!object(value)) throw invalid;
        const result: FormProgressValues = {};
        const keys = guarded(() => Reflect.ownKeys(value));
        for (const field of keys) {
            const descriptor = guarded(() =>
                Object.getOwnPropertyDescriptor(value, field)
            );
            if (!descriptor?.enumerable) continue;
            if (typeof field !== 'string') throw invalid;
            const cell = guarded(() => value[field]);
            if (
                cell !== null &&
                typeof cell !== 'string' &&
                typeof cell !== 'boolean' &&
                !(typeof cell === 'number' && Number.isFinite(cell))
            )
                throw invalid;
            Object.defineProperty(result, field, {
                value: cell,
                enumerable: true,
                configurable: true,
                writable: true,
            });
        }
        return result;
    };
    const remember = (token: FormProgressToken) => {
        usedIds.add(token.draftId);
        usedIds.add(token.writeId);
    };
    const decode = (bytes: unknown): FormProgressSnapshot | null => {
        if (bytes === null) return null;
        if (typeof bytes !== 'string') throw invalid;
        let envelope: unknown;
        try {
            envelope = guarded(() => JSON.parse(bytes));
        } catch (error) {
            if (error === retiredOperation) throw error;
            throw invalid;
        }
        if (!object(envelope)) throw invalid;
        const keys = Object.keys(envelope).sort();
        if (
            keys.join(',') !== 'draftId,kind,values,version,writeId' ||
            envelope.kind !== kind ||
            envelope.version !== version
        )
            throw invalid;
        const token = copyToken(envelope);
        const values = copyValues(envelope.values);
        remember(token);
        return { token, values };
    };
    const storage = (): FormProgressStorageAdapter => {
        const adapter = guarded(getStorage);
        if (adapter == null) throw new TypeError();
        return adapter;
    };
    const stored = (
        adapter: FormProgressStorageAdapter
    ): FormProgressSnapshot | null => {
        const getItem = guarded(() => adapter.getItem);
        if (typeof getItem !== 'function') throw new TypeError();
        return decode(guarded(() => getItem.call(adapter, key)));
    };
    const sameToken = (a: FormProgressToken, b: FormProgressToken): boolean =>
        a.draftId === b.draftId && a.writeId === b.writeId;
    const freshId = (): string => {
        const id = guarded(createId);
        if (!identifier(id) || usedIds.has(id)) throw invalid;
        usedIds.add(id);
        return id;
    };
    const locked = async <Result extends { status: string }>(
        operation: () => Result
    ): Promise<Result | Failure> => {
        let closed = false;
        let ran = false;
        let answer: Result | Failure | undefined;
        try {
            const manager = guarded(getLocks);
            if (manager == null) return { status: 'unavailable' };
            const request = guarded(() => manager.request);
            if (typeof request !== 'function') return { status: 'unavailable' };
            if (!current()) return { status: 'retired' };
            requesting = true;
            let pending: Promise<Result | Failure>;
            try {
                pending = request.call(manager, lockName, () => {
                    if (closed || ran) return { status: 'retired' } as Failure;
                    ran = true;
                    try {
                        if (!current()) throw retiredOperation;
                        answer = operation();
                    } catch (error) {
                        answer = failure(error);
                    }
                    return answer;
                }) as Promise<Result | Failure>;
            } finally {
                requesting = false;
            }
            const returned = await pending;
            if (!current()) return { status: 'retired' };
            if (!ran || answer === undefined || returned !== answer)
                return { status: 'unavailable' };
            return answer;
        } catch (error) {
            return failure(error);
        } finally {
            closed = true;
        }
    };

    return {
        read() {
            if (!enter()) return { status: 'retired' };
            try {
                return { status: 'read', snapshot: stored(storage()) };
            } catch (error) {
                return failure(error);
            }
        },
        async write(args) {
            if (!enter()) return { status: 'retired' };
            let expected: FormProgressToken | null;
            let values: FormProgressValues;
            try {
                const target = guarded(() => args.expected);
                expected = target === null ? null : copyToken(target);
                values = copyValues(guarded(() => args.values));
                if (expected !== null) remember(expected);
            } catch (error) {
                return failure(error);
            }
            return locked<FormProgressWriteResult>(() => {
                const adapter = storage();
                const previous = stored(adapter);
                if (
                    expected === null
                        ? previous !== null
                        : previous === null ||
                          !sameToken(expected, previous.token)
                )
                    return { status: 'conflict' };
                const token = {
                    draftId: expected === null ? freshId() : expected.draftId,
                    writeId: freshId(),
                };
                const snapshot = { token, values };
                const bytes = guarded(() =>
                    JSON.stringify({ kind, version, ...token, values })
                );
                const setItem = guarded(() => adapter.setItem);
                if (typeof setItem !== 'function') throw new TypeError();
                guarded(() => setItem.call(adapter, key, bytes));
                return { status: 'written', snapshot };
            });
        },
        async remove(supplied) {
            if (!enter()) return { status: 'retired' };
            let expected: FormProgressToken;
            try {
                expected = copyToken(supplied);
            } catch (error) {
                return failure(error);
            }
            return locked<FormProgressRemovalResult>(() => {
                const adapter = storage();
                const previous = stored(adapter);
                if (previous === null) return { status: 'absent' };
                if (!sameToken(expected, previous.token))
                    return { status: 'conflict' };
                const removeItem = guarded(() => adapter.removeItem);
                if (typeof removeItem !== 'function') throw new TypeError();
                guarded(() => removeItem.call(adapter, key));
                return { status: 'removed' };
            });
        },
        destroy() {
            retired = true;
        },
    };
};
