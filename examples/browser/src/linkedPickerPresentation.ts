import { hasMaskedValuePolicy } from './privacy.js';

const unavailable = 'Linked record';
const object = (value: unknown): value is Record<string, unknown> =>
    value != null && typeof value === 'object' && !Array.isArray(value);
const plainTypes = new Set([
    'singleLineText',
    'multilineText',
    'email',
    'phoneNumber',
    'number',
    'currency',
    'percent',
    'rating',
    'checkbox',
]);

/** Private candidate captions only; no labels or native values are retained. */
export function createLinkedPickerPresentation(options: {
    config(): unknown;
    details(): unknown;
    current(): boolean;
    useCustomPrimary?: boolean;
    onRetire?(caption: string): void;
}) {
    let retired = false;
    const retire = () => {
        if (retired) return;
        retired = true;
        options.onRetire?.(unavailable);
    };
    const policy = () => [options.config(), options.details()] as const;
    let capturedPolicy: string | undefined;
    try {
        capturedPolicy = JSON.stringify(policy());
    } catch {
        retire();
    }
    const active = (): boolean => {
        if (retired) return false;
        try {
            if (
                !options.current() ||
                JSON.stringify(policy()) !== capturedPolicy ||
                !options.current()
            )
                retire();
        } catch {
            retire();
        }
        return !retired;
    };
    return {
        // Empty pages still have to retire captions already mounted by this picker.
        refresh() {
            active();
        },
        caption(record: unknown, table: unknown): string {
            try {
                if (!active()) return unavailable;
                const [linkConfig, details] = policy();
                if (
                    (linkConfig != null && !object(linkConfig)) ||
                    !Array.isArray(details) ||
                    !object(table) ||
                    !Array.isArray(table.airtableFields)
                )
                    return unavailable;
                const fields = table.airtableFields;
                const metadata = JSON.stringify(fields);
                const ids = new Set<string>();
                for (const field of fields) {
                    if (
                        !object(field) ||
                        typeof field.id !== 'string' ||
                        field.id.trim() === '' ||
                        ids.has(field.id) ||
                        typeof field.name !== 'string' ||
                        !object(field.config) ||
                        (field.isComputed !== undefined &&
                            typeof field.isComputed !== 'boolean') ||
                        (field.isPrimaryField !== undefined &&
                            typeof field.isPrimaryField !== 'boolean')
                    )
                        return unavailable;
                    ids.add(field.id);
                }
                const detailIds = new Set<string>();
                for (const detail of details) {
                    if (
                        !object(detail) ||
                        typeof detail.fieldId !== 'string' ||
                        detail.fieldId.trim() === '' ||
                        detailIds.has(detail.fieldId)
                    )
                        return unavailable;
                    detailIds.add(detail.fieldId);
                }
                const configured =
                    options.useCustomPrimary === false
                        ? undefined
                        : linkConfig?.customPrimaryField;
                if (
                    configured != null &&
                    (typeof configured !== 'string' || configured.trim() === '')
                )
                    return unavailable;
                const primaries = fields.filter((field) =>
                    configured == null
                        ? field.isPrimaryField === true
                        : field.id === configured
                );
                if (primaries.length !== 1) return unavailable;
                const primary = primaries[0];
                const detail = details.find(
                    (entry) => entry.fieldId === primary.id
                );
                if (
                    !object(detail) ||
                    detail.fieldName !== primary.name ||
                    detail.isHidden !== false ||
                    (detail.miniExtConfig != null &&
                        !object(detail.miniExtConfig))
                )
                    return unavailable;
                const config = detail.miniExtConfig ?? {};
                for (const flag of [
                    'obscurePassword',
                    'maskPasswordOnLoginScreen',
                ])
                    if (
                        (config[flag] !== undefined &&
                            typeof config[flag] !== 'boolean') ||
                        (linkConfig?.[flag] !== undefined &&
                            typeof linkConfig[flag] !== 'boolean')
                    )
                        return unavailable;
                if (
                    primary.isComputed === true ||
                    !plainTypes.has(primary.config.type)
                )
                    return unavailable;
                const current = (): boolean => {
                    if (!active()) return false;
                    if (JSON.stringify(table.airtableFields) !== metadata)
                        retire();
                    return active();
                };
                if (!current()) return unavailable;
                // Privacy decisions precede even access to record.fields.
                if (
                    hasMaskedValuePolicy(linkConfig) ||
                    hasMaskedValuePolicy(config)
                )
                    return current() ? '••••••••' : unavailable;
                if (
                    config.displayAsAttachments === true ||
                    config.displayAsButton === true ||
                    !object(record)
                )
                    return unavailable;
                const values = record.fields;
                if (!current()) return unavailable;
                if (!object(values)) return unavailable;
                const key = Object.hasOwn(values, primary.id)
                    ? primary.id
                    : primary.name.trim() !== '' &&
                        fields.filter((field) => field.name === primary.name)
                            .length === 1 &&
                        !fields.some(
                            (field) =>
                                field.id !== primary.id &&
                                field.id === primary.name
                        ) &&
                        Object.hasOwn(values, primary.name)
                      ? primary.name
                      : null;
                if (key === null) return unavailable;
                const value = values[key];
                if (!current()) return unavailable;
                const numeric = [
                    'number',
                    'currency',
                    'percent',
                    'rating',
                ].includes(primary.config.type);
                if (
                    numeric
                        ? typeof value !== 'number' || !Number.isFinite(value)
                        : primary.config.type === 'checkbox'
                          ? typeof value !== 'boolean'
                          : typeof value !== 'string' || value.trim() === ''
                )
                    return unavailable;
                // Preserve the starter's scalar formatting, including zero/false.
                const text = String(value);
                return current() && text.trim() !== '' ? text : unavailable;
            } catch {
                return unavailable;
            }
        },
    };
}
