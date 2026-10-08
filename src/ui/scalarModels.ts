/** Renderer-neutral scalar input state. Native commits remain adapter-owned. */
export type ScalarFieldState = {
    kind: 'number' | 'checkbox';
    input: string;
    checked: boolean;
    valid: boolean;
    error: string | null;
    canEdit: boolean;
    retired: boolean;
    revision: number;
};
export type ScalarFieldModel = {
    getState(): ScalarFieldState;
    subscribe(listener: () => void): () => void;
    setInput(input: string): boolean;
    setChecked(checked: boolean): boolean;
    refresh(expectedRevision?: number): void;
    destroy(): void;
};
export type ScalarFieldModelOptions = {
    getValue(): unknown;
    canEdit(): boolean;
    isCurrent(): boolean;
    write(value: number | boolean | null): boolean;
};
const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const createScalarFieldModel = (
    kind: ScalarFieldState['kind'],
    options: ScalarFieldModelOptions
): ScalarFieldModel => {
    let retired = false;
    let revision = 0;
    let seen: unknown;
    let initialized = false;
    let input = '';
    let error: string | null = null;
    const listeners = new Set<() => void>();
    const current = () => {
        if (!retired && !options.isCurrent()) retired = true;
        return !retired;
    };
    const sync = () => {
        if (!current()) return;
        const ticket = revision;
        const native = options.getValue();
        if (!current() || revision !== ticket) return;
        if (!initialized || !Object.is(native, seen)) {
            initialized = true;
            seen = native;
            const empty =
                native == null ||
                (typeof native === 'string' && native.trim() === '');
            const valid =
                empty ||
                (kind === 'number'
                    ? typeof native === 'number' && Number.isFinite(native)
                    : typeof native === 'boolean');
            input = kind === 'number' && valid && !empty ? String(native) : '';
            error = valid
                ? null
                : 'This field has an unsupported native value.';
        }
    };
    const notify = () => {
        for (const listener of [...listeners]) {
            try {
                listener();
            } catch {
                /* Rendering cannot undo a native commit. */
            }
        }
    };
    const edit = (value: number | boolean | null, nextInput: string) => {
        sync();
        if (!current() || !options.canEdit() || !current()) return false;
        const ticket = ++revision;
        if (!options.write(value) || !current() || revision !== ticket)
            return false;
        const native = options.getValue();
        if (!current() || revision !== ticket) return false;
        seen = native;
        initialized = true;
        input = nextInput;
        error = null;
        notify();
        return true;
    };
    return {
        getState() {
            sync();
            const live = current();
            const editable = live && options.canEdit() && current();
            return {
                kind,
                input: live ? input : '',
                checked: live && seen === true,
                valid: live && error === null,
                error: live ? error : null,
                canEdit: editable,
                retired: !current(),
                revision,
            };
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setInput(value) {
            sync();
            if (
                kind !== 'number' ||
                !current() ||
                !options.canEdit() ||
                !current()
            )
                return false;
            if (typeof value !== 'string') return false;
            const parsed =
                value === '' ? null : numeric.test(value) ? Number(value) : NaN;
            if (parsed !== null && !Number.isFinite(parsed)) {
                revision += 1;
                input = value;
                error = 'Enter a valid finite number.';
                notify();
                return false;
            }
            return edit(parsed, value);
        },
        setChecked(value) {
            return kind === 'checkbox' && typeof value === 'boolean'
                ? edit(value, '')
                : false;
        },
        refresh(expectedRevision) {
            if (
                !current() ||
                (expectedRevision !== undefined &&
                    revision !== expectedRevision)
            )
                return;
            revision += 1;
            initialized = false;
            sync();
            notify();
        },
        destroy() {
            const changed = !retired;
            retired = true;
            revision += 1;
            if (changed) notify();
            listeners.clear();
        },
    };
};
export const createNumberFieldModel = (
    options: ScalarFieldModelOptions
): ScalarFieldModel => createScalarFieldModel('number', options);
export const createCheckboxFieldModel = (
    options: ScalarFieldModelOptions
): ScalarFieldModel => createScalarFieldModel('checkbox', options);
