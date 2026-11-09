import { createNumberFieldModel } from './scalarModels.js';
import {
    isNumberInputCompatible,
    parseNumberInputCompatibility,
    type NumberInputCompatibilityConfig,
    type NumberInputCompatibilityPolicy,
} from './numberInputCompatibility.js';

export type LocalizedNumericInputOwner = {
    airtableField: { id: string; config: NumberInputCompatibilityConfig };
    miniExtFieldConfig?: NumberInputCompatibilityPolicy & {
        readOnly?: boolean;
    };
    value: number | null;
    /** A native guarded callback may explicitly refuse; void retains controlled-host compatibility. */
    setValue(value: number | null): boolean | void;
};

/** Native locale syntax plus finite/negative policy, before scalar admission. */
export function isLocalizedNumericInputValid(
    input: string,
    owner: Pick<
        LocalizedNumericInputOwner,
        'airtableField' | 'miniExtFieldConfig'
    >
): boolean {
    if (
        !isNumberInputCompatible(
            input,
            owner.airtableField.config.type,
            owner.miniExtFieldConfig
        )
    )
        return false;
    const value = parseNumberInputCompatibility(
        input,
        owner.airtableField.config
    );
    return (
        value == null ||
        (Number.isFinite(value) &&
            (owner.miniExtFieldConfig?.allowNegativeNumbers === true ||
                value >= 0))
    );
}

/** Localized display never enters the legacy raw scalar grammar. */
export function createLocalizedNumericInputAdapter(options: {
    read(): LocalizedNumericInputOwner | null;
    isCurrent(): boolean;
}) {
    const scalar = createNumberFieldModel({
        getValue: () => options.read()?.value,
        canEdit: () => {
            const owner = options.read();
            return owner != null && owner.miniExtFieldConfig?.readOnly !== true;
        },
        isCurrent: options.isCurrent,
        write: (value) => {
            const owner = options.read();
            return (
                typeof value !== 'boolean' &&
                owner != null &&
                owner.setValue(value) !== false
            );
        },
    });
    return {
        setInput(input: string): boolean {
            const owner = options.read();
            if (
                owner == null ||
                !options.isCurrent() ||
                owner.miniExtFieldConfig?.readOnly === true ||
                !isLocalizedNumericInputValid(input, owner)
            )
                return false;
            const native = parseNumberInputCompatibility(
                input,
                owner.airtableField.config
            );
            return scalar.setInput(
                native == null
                    ? ''
                    : Object.is(native, -0)
                      ? '-0'
                      : String(native)
            );
        },
    };
}
