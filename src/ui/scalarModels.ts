import { getFormattedDuration } from '../formulas/durationFormatting.js';
import {
    isDurationFormat,
    parseDurationInput,
    type DurationFormat,
} from './durationInput.js';

/** Renderer-neutral scalar input state. Native commits remain adapter-owned. */
type ScalarState = {
    input: string;
    checked: boolean;
    valid: boolean;
    error: string | null;
    canEdit: boolean;
    retired: boolean;
    revision: number;
};
export type DurationFieldState = ScalarState & {
    kind: 'duration';
    focused: boolean;
    durationFormat: DurationFormat | null;
};
export type ScalarFieldState =
    | (ScalarState & { kind: 'number' | 'checkbox' })
    | DurationFieldState;
export type ScalarFieldModel = {
    getState(): ScalarFieldState;
    subscribe(listener: () => void): () => void;
    setInput(input: string): boolean;
    setChecked(checked: boolean): boolean;
    /** Duration-only presentation action; never commits or rounds native seconds. */
    setFocused?(focused: boolean): boolean;
    refresh(expectedRevision?: number): void;
    destroy(): void;
};
export type DurationFieldModel = Omit<
    ScalarFieldModel,
    'getState' | 'setFocused'
> & {
    getState(): DurationFieldState;
    setFocused(focused: boolean): boolean;
};
export type DurationFieldModelOptions = ScalarFieldModelOptions & {
    getDurationFormat(): DurationFormat;
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
    options: ScalarFieldModelOptions & { getDurationFormat?(): DurationFormat }
): ScalarFieldModel => {
    let retired = false;
    let revision = 0;
    let seen: unknown;
    let initialized = false;
    let input = '';
    let error: string | null = null;
    let focused = false;
    let durationFormat: DurationFormat | null = null;
    let committing: {
        revision: number;
        value: number | boolean | null;
        input: string;
    } | null = null;
    const listeners = new Set<() => void>();
    const current = () => {
        if (!retired && !options.isCurrent()) retired = true;
        return !retired;
    };
    const sync = () => {
        if (!current()) return;
        const ticket = revision;
        const native = options.getValue();
        let format: DurationFormat | null = null;
        if (kind === 'duration') {
            try {
                const value = options.getDurationFormat?.();
                if (isDurationFormat(value)) format = value;
            } catch {
                /* Unsupported configuration is generic presentation. */
            }
        }
        if (!current() || revision !== ticket) return;
        const formatChanged = kind === 'duration' && format !== durationFormat;
        if (initialized && formatChanged) {
            retired = true;
            revision += 1;
            notify();
            return;
        }
        if (!initialized || !Object.is(native, seen) || formatChanged) {
            const wasInitialized = initialized;
            const editingError = focused && wasInitialized ? error : null;
            const ownCommit =
                committing?.revision === revision &&
                Object.is(native, committing.value)
                    ? committing
                    : null;
            initialized = true;
            seen = native;
            durationFormat = format;
            const empty =
                native == null ||
                (typeof native === 'string' && native.trim() === '');
            const valid =
                empty ||
                (kind !== 'checkbox'
                    ? typeof native === 'number' &&
                      Number.isFinite(native) &&
                      (kind !== 'duration' || Number.isFinite(native * 1000))
                    : typeof native === 'boolean');
            if (kind === 'duration') {
                if (wasInitialized && !ownCommit) revision += 1;
                if (!format) {
                    error = 'This duration format is unavailable.';
                    return;
                }
                try {
                    const display =
                        valid && !empty
                            ? getFormattedDuration(String(native), format, true)
                            : '';
                    if (ownCommit) input = ownCommit.input;
                    else if (!focused || !wasInitialized) input = display;
                    error = valid
                        ? ownCommit
                            ? null
                            : editingError
                        : 'This field has an unsupported native value.';
                } catch {
                    error = 'This field has an unsupported native value.';
                }
                return;
            }
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
    const canEdit = (ticket: number) => {
        if (
            !current() ||
            !options.canEdit() ||
            !current() ||
            revision !== ticket
        )
            return false;
        // Permission callbacks may replace the accepted duration configuration.
        if (kind === 'duration') sync();
        return current() && revision === ticket;
    };
    const edit = (value: number | boolean | null, nextInput: string) => {
        sync();
        const before = revision;
        if (!canEdit(before)) return false;
        const ticket = ++revision;
        const previousCommit = committing;
        committing = { revision: ticket, value, input: nextInput };
        try {
            if (!options.write(value) || !current() || revision !== ticket)
                return false;
        } finally {
            committing = previousCommit;
        }
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
            const editable = canEdit(revision);
            const live = current();
            const state = {
                kind,
                input: live ? input : '',
                checked: live && seen === true,
                valid: live && error === null,
                error: live ? error : null,
                canEdit: editable,
                retired: !current(),
                revision,
            };
            return kind === 'duration'
                ? { ...state, kind: 'duration', focused, durationFormat }
                : { ...state, kind };
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        setInput(value) {
            sync();
            const ticket = revision;
            if (kind === 'checkbox' || !canEdit(ticket)) return false;
            if (typeof value !== 'string') return false;
            const parsed =
                kind === 'duration'
                    ? durationFormat
                        ? parseDurationInput(value, durationFormat)
                        : undefined
                    : value === ''
                      ? null
                      : numeric.test(value)
                        ? Number(value)
                        : NaN;
            if (
                parsed === undefined ||
                (parsed !== null && !Number.isFinite(parsed))
            ) {
                revision += 1;
                input = value;
                error =
                    kind === 'duration'
                        ? 'Enter a complete duration in the configured format.'
                        : 'Enter a valid finite number.';
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
        ...(kind === 'duration'
            ? {
                  setFocused(value: boolean) {
                      sync();
                      const ticket = revision;
                      if (typeof value !== 'boolean' || !canEdit(ticket))
                          return false;
                      if (focused === value) return true;
                      focused = value;
                      revision += 1;
                      if (!focused && error === null && durationFormat) {
                          try {
                              input =
                                  seen == null ||
                                  (typeof seen === 'string' &&
                                      seen.trim() === '')
                                      ? ''
                                      : getFormattedDuration(
                                            String(seen),
                                            durationFormat,
                                            true
                                        );
                          } catch {
                              error =
                                  'This field has an unsupported native value.';
                          }
                      }
                      notify();
                      return true;
                  },
              }
            : {}),
        refresh(expectedRevision) {
            if (
                !current() ||
                (expectedRevision !== undefined &&
                    revision !== expectedRevision)
            )
                return;
            revision += 1;
            initialized = false;
            focused = false;
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
export const createDurationFieldModel = (
    options: DurationFieldModelOptions
): DurationFieldModel =>
    createScalarFieldModel('duration', options) as DurationFieldModel;
