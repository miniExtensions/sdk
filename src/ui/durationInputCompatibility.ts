import {
    isDurationInputText,
    parseDurationInputSeconds,
} from '../formulas/durationInput.js';
import { isDurationFormat, type DurationFormat } from './durationInput.js';
import { createNumberFieldModel } from './scalarModels.js';

/** Hosted clock grammar; deliberately distinct from the strict Duration model. */
export type DurationInputOwner = {
    format: DurationFormat;
    value: number | null;
    readOnly?: boolean;
    /** Already-authorized canonical writer. False refuses the presentation edit. */
    onChange(value: number | null): boolean | void;
};

export type DurationInputAdapter = {
    setInput(input: string): boolean;
    isCurrent(): boolean;
    canEdit(): boolean;
};

/** Presentation adapter only: no canonical draft, transport, subscription or Save. */
export function createDurationInputAdapter(options: {
    read(): DurationInputOwner | null;
    /** Actual captured field/session/format/owner lifetime, including observed ABA. */
    isCurrent(): boolean;
}): DurationInputAdapter {
    const canEdit = () => {
        if (!options.isCurrent()) return false;
        const owner = options.read();
        return (
            owner != null &&
            isDurationFormat(owner.format) &&
            !owner.readOnly &&
            options.isCurrent()
        );
    };
    const scalar = createNumberFieldModel({
        getValue: () => options.read()?.value,
        canEdit,
        isCurrent: options.isCurrent,
        write: (value) => {
            if (typeof value === 'boolean' || !canEdit()) return false;
            const owner = options.read();
            return (
                owner != null &&
                options.isCurrent() &&
                owner.onChange(value) !== false
            );
        },
    });
    return {
        isCurrent: () => options.isCurrent(),
        canEdit,
        setInput(input) {
            if (!canEdit() || !isDurationInputText(input)) return false;
            const owner = options.read();
            if (owner == null || !options.isCurrent()) return false;
            const seconds = parseDurationInputSeconds(input, owner.format);
            if (seconds != null && !Number.isFinite(seconds)) return false;
            // Never pass clock text into the strict scalar grammar. Preserve -0.
            return scalar.setInput(
                seconds == null
                    ? ''
                    : Object.is(seconds, -0)
                      ? '-0'
                      : String(seconds)
            );
        },
    };
}
