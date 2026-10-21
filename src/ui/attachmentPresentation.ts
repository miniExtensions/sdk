/** Label-only projection. Native field values remain a separate SDK contract. */
export type AttachmentPresentation =
    | { status: 'ready'; rows: readonly { label: string }[] }
    | { status: 'masked' }
    | { status: 'unavailable' };

const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/** Internal host boundary: check visibility and policy before invoking readRows. */
export function projectAttachmentPresentation(input: {
    visible: boolean;
    current(): boolean;
    configs: readonly unknown[];
    readRows(): unknown;
}): AttachmentPresentation {
    const unavailable = { status: 'unavailable' } as const;
    try {
        if (!input.visible || !input.current()) return unavailable;
        if (!input.configs.length || !input.configs.every(object))
            return unavailable;
        const configs = input.configs.filter(object);
        // A malformed masking flag also conceals. No row getter is invoked.
        if (
            configs.some((config) =>
                ['obscurePassword', 'maskPasswordOnLoginScreen'].some((key) => {
                    const flag = config[key];
                    return flag !== undefined && flag !== false;
                })
            )
        )
            return input.current() ? { status: 'masked' } : unavailable;
        let names = true;
        for (const config of configs) {
            const hideName = config.hideAttachmentName;
            if (hideName !== undefined && typeof hideName !== 'boolean')
                return unavailable;
            if (hideName !== false) names = false;
        }
        if (!input.current()) return unavailable;
        const source = input.readRows();
        if (!Array.isArray(source)) return unavailable;
        const rows: { label: string }[] = [];
        for (let index = 0; index < source.length; index++) {
            if (!Object.hasOwn(source, index)) return unavailable;
            const row: unknown = source[index];
            if (!object(row)) return unavailable;
            const visible = row.visible;
            if (typeof visible !== 'boolean') return unavailable;
            if (!visible) continue;
            const attachment = row.attachment;
            if (!object(attachment)) return unavailable;
            let label = 'Attachment';
            if (names) {
                const filename = attachment.filename;
                if (filename !== undefined && typeof filename !== 'string')
                    return unavailable;
                label =
                    typeof filename === 'string' && filename.trim() !== ''
                        ? filename
                        : 'Attachment — filename unavailable';
            }
            rows.push({ label });
        }
        return input.current() ? { status: 'ready', rows } : unavailable;
    } catch {
        return unavailable;
    }
}

/** Validate and copy only the public facet; reject accidental native metadata. */
export function copyAttachmentPresentation(
    value: unknown
): AttachmentPresentation | null {
    try {
        if (!object(value)) return null;
        const keys = Object.keys(value);
        const status = value.status;
        if (status === 'masked' || status === 'unavailable')
            return keys.length === 1 && keys[0] === 'status'
                ? { status }
                : null;
        if (
            status !== 'ready' ||
            keys.length !== 2 ||
            !keys.includes('status') ||
            !keys.includes('rows')
        )
            return null;
        const source = value.rows;
        if (!Array.isArray(source)) return null;
        const rows: { label: string }[] = [];
        for (let index = 0; index < source.length; index++) {
            if (!Object.hasOwn(source, index)) return null;
            const row: unknown = source[index];
            if (
                !object(row) ||
                Object.keys(row).length !== 1 ||
                !Object.hasOwn(row, 'label')
            )
                return null;
            const label = row.label;
            if (typeof label !== 'string') return null;
            rows.push({ label });
        }
        return { status: 'ready', rows };
    } catch {
        return null;
    }
}
