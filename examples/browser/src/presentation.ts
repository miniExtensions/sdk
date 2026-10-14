import type {
    AirtableRecord,
    AirtableValue,
    RuntimeAirtableField,
} from '@miniextensions/sdk';
import type { FormValidationMessage } from '@miniextensions/sdk/forms';

export type FieldPresentationPolicy = {
    type: 'visible' | 'masked' | 'hidden' | 'unavailable';
};
export type FieldDisplayDescriptor = {
    fieldId: string;
    isHidden?: boolean;
    displayConfig?: unknown;
};
const dataObject = (value: unknown): Record<string, unknown> | null => {
    if (
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype
    )
        return null;
    const entries: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') return null;
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (
            !property ||
            property.enumerable !== true ||
            !Object.hasOwn(property, 'value')
        )
            return null;
        entries.push([key, property.value]);
    }
    const snapshot = Object.fromEntries(entries);
    Object.setPrototypeOf(snapshot, null);
    return snapshot;
};
const dataArray = (value: unknown): unknown[] | null => {
    if (
        !Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Array.prototype
    )
        return null;
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (
        !Number.isSafeInteger(length) ||
        length < 0 ||
        Reflect.ownKeys(value).length !== length + 1
    )
        return null;
    const entries: unknown[] = [];
    for (let index = 0; index < length; index++) {
        const property = Object.getOwnPropertyDescriptor(value, String(index));
        if (
            !property ||
            property.enumerable !== true ||
            !Object.hasOwn(property, 'value')
        )
            return null;
        entries.push(property.value);
    }
    return entries;
};

/** Current frontend display eligibility only; never backend access authority. */
export function getFieldPresentationPolicy(input: {
    fieldId: string;
    descriptor: FieldDisplayDescriptor | undefined;
    visible: boolean;
    isCurrent: boolean;
}): FieldPresentationPolicy {
    try {
        const fieldId = input.fieldId;
        const descriptor = dataObject(input.descriptor);
        if (
            input.isCurrent !== true ||
            typeof fieldId !== 'string' ||
            fieldId.trim() === '' ||
            !descriptor ||
            !Object.hasOwn(descriptor, 'fieldId') ||
            descriptor.fieldId !== fieldId ||
            (descriptor.isHidden !== undefined &&
                typeof descriptor.isHidden !== 'boolean')
        )
            return { type: 'unavailable' };
        if (input.visible !== true || descriptor.isHidden === true)
            return { type: 'hidden' };
        const config = dataObject(descriptor.displayConfig);
        if (
            !Object.hasOwn(descriptor, 'displayConfig') ||
            !config ||
            [config.obscurePassword, config.maskPasswordOnLoginScreen].some(
                (flag) => flag !== undefined && typeof flag !== 'boolean'
            )
        )
            return { type: 'unavailable' };
        // Masking precedes rich presentation. This plain-text projection does
        // not render configured buttons, attachments or formula markup.
        if (
            config.obscurePassword === true ||
            config.maskPasswordOnLoginScreen === true
        )
            return { type: 'masked' };
        for (const flag of [
            'displayAsButton',
            'displayAsAttachments',
            'renderFormulaAsHTML',
            'renderFormulaAsAttachment',
        ])
            if (config[flag] !== undefined && config[flag] !== false)
                return { type: 'unavailable' };
        return { type: 'visible' };
    } catch {
        return { type: 'unavailable' };
    }
}

/** Resolve the exact target primary in an accepted detail projection. */
export function primaryFieldPresentationPolicy(input: {
    fieldId: string;
    detailFields: unknown;
    isCurrent: boolean;
}): FieldPresentationPolicy {
    try {
        const details = dataArray(input.detailFields);
        if (!details) return { type: 'unavailable' };
        const fieldId = input.fieldId;
        const descriptors = details.map(dataObject);
        if (descriptors.some((field) => field === null))
            return { type: 'unavailable' };
        const matches = descriptors.filter(
            (field) => field !== null && field.fieldId === fieldId
        );
        if (matches.length !== 1) return { type: 'unavailable' };
        const detail = matches[0];
        if (
            !detail ||
            !Object.hasOwn(detail, 'fieldId') ||
            typeof detail.fieldId !== 'string' ||
            !Object.hasOwn(detail, 'isHidden') ||
            typeof detail.isHidden !== 'boolean' ||
            !Object.hasOwn(detail, 'miniExtConfig')
        )
            return { type: 'unavailable' };
        return getFieldPresentationPolicy({
            fieldId,
            descriptor: {
                fieldId: detail.fieldId,
                isHidden: detail.isHidden,
                displayConfig: detail.miniExtConfig,
            },
            visible: true,
            isCurrent: input.isCurrent,
        });
    } catch {
        return { type: 'unavailable' };
    }
}

/** Apply before formatting. Hidden, missing and malformed policy never reads values. */
export function presentPublicLabel(
    policy: FieldPresentationPolicy | undefined,
    format: () => string
): string {
    try {
        if (policy?.type === 'masked') return '••••';
        if (policy?.type !== 'visible') return 'Linked record';
        const label = format();
        return typeof label === 'string' && label.trim() !== ''
            ? label
            : 'Linked record';
    } catch {
        return 'Linked record';
    }
}

/**
 * Project canonical errors for display without changing validation or native data.
 * Only a current, explicitly visible field policy can disclose its message/title.
 */
export function formValidationPresentation(
    errors: readonly FormValidationMessage[],
    policyForField: (
        fieldId: string
    ) => FieldPresentationPolicy | null | undefined
): FormValidationMessage[] {
    const messages: FormValidationMessage[] = [];
    let genericAdded = false;
    for (const error of errors) {
        let visible = false;
        try {
            visible = policyForField(error.fieldId)?.type === 'visible';
        } catch {
            // A failed presentation policy cannot grant access to error bytes.
        }
        if (visible) {
            messages.push({
                fieldId: error.fieldId,
                fieldTitle: error.fieldTitle,
                errorMessage: error.errorMessage,
            });
        } else if (!genericAdded) {
            genericAdded = true;
            messages.push({
                fieldId: '',
                fieldTitle: 'Form',
                errorMessage:
                    'The Form could not be saved. A configured field needs attention.',
            });
        }
    }
    return messages;
}

const privatePolicy = (
    before: FieldPresentationPolicy,
    after: FieldPresentationPolicy
): FieldPresentationPolicy => ({
    type:
        before.type === 'unavailable' || after.type === 'unavailable'
            ? 'unavailable'
            : before.type === 'hidden' || after.type === 'hidden'
              ? 'hidden'
              : before.type === 'masked' || after.type === 'masked'
                ? 'masked'
                : 'visible',
});

const primaryIdentity = (
    table: { airtableFields: readonly RuntimeAirtableField[] } | undefined
): { id: string; name: string } | null => {
    const entries = dataArray(table?.airtableFields)?.map(dataObject);
    if (!entries || entries.some((field) => field === null)) return null;
    const primaries = entries.filter((field) => field?.isPrimaryField === true);
    if (primaries.length !== 1) return null;
    const primary = primaries[0];
    if (
        !primary ||
        typeof primary.id !== 'string' ||
        primary.id.trim() === '' ||
        typeof primary.name !== 'string' ||
        primary.name.trim() === '' ||
        entries.filter((field) => field?.id === primary.id).length !== 1 ||
        entries.filter((field) => field?.name === primary.name).length !== 1 ||
        entries.some(
            (field) => field?.id !== primary.id && field?.id === primary.name
        )
    )
        return null;
    return { id: primary.id, name: primary.name };
};

/** Private starter formatter: never returns an empty caption or an ID fallback. */
export function safeLinkedRecordLabel(input: {
    record: AirtableRecord;
    table: { airtableFields: readonly RuntimeAirtableField[] } | undefined;
    detailFields: unknown;
    isCurrent(): boolean;
    formatValue?(value: AirtableValue | undefined): string;
}): string {
    try {
        const primary = primaryIdentity(input.table);
        const record = input.record;
        if (
            !primary ||
            typeof record?.id !== 'string' ||
            record.id.trim() === '' ||
            record.fields == null ||
            typeof record.fields !== 'object' ||
            Array.isArray(record.fields)
        )
            return 'Linked record';
        const policy = (): FieldPresentationPolicy => {
            if (!input.isCurrent()) return { type: 'unavailable' };
            const currentPrimary = primaryIdentity(input.table);
            if (
                !currentPrimary ||
                currentPrimary.id !== primary.id ||
                currentPrimary.name !== primary.name
            )
                return { type: 'unavailable' };
            return primaryFieldPresentationPolicy({
                fieldId: primary.id,
                detailFields: input.detailFields,
                isCurrent: input.isCurrent(),
            });
        };
        const before = policy();
        if (before.type !== 'visible')
            return presentPublicLabel(
                privatePolicy(before, policy()),
                () => ''
            );
        // Only a visible, current, uniquely identified primary may use its own
        // name key. An own ID key wins even when its value is blank/undefined.
        const key = Object.hasOwn(record.fields, primary.id)
            ? primary.id
            : Object.hasOwn(record.fields, primary.name)
              ? primary.name
              : null;
        if (key === null) return 'Linked record';
        const value = record.fields[key];
        const caption = input.formatValue
            ? input.formatValue(value)
            : typeof value === 'string' ||
                typeof value === 'boolean' ||
                (typeof value === 'number' && Number.isFinite(value))
              ? String(value)
              : 'Linked record';
        return presentPublicLabel(
            privatePolicy(before, policy()),
            () => caption
        );
    } catch {
        return 'Linked record';
    }
}
