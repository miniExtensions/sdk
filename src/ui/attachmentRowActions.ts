import {
    projectAttachmentPresentation,
    copyAttachmentPresentation,
    type AttachmentPresentation,
} from './attachmentPresentation.js';

export type AttachmentRowAuthority = {
    /** Actual owner identity and monotonic native/configuration revision. */
    owner: string | number;
    revision: string | number;
    visible: boolean;
    editable: boolean;
    configs: readonly unknown[];
};
export type AttachmentActionRow = {
    nativeIndex: number;
    attachment: unknown;
    visible: boolean;
    removeAllowed: boolean;
};
export type AttachmentRowActions = {
    presentation: AttachmentPresentation;
    rows: readonly { nativeIndex: number; removeAllowed: boolean }[];
    /** Revalidates current policy/revision before invoking the existing host writer. */
    remove(nativeIndex: number): boolean;
};

/**
 * A label-only accepted row facet over an actual host owner. No draft, client,
 * File queue, upload or cleanup is constructed. Revision must include native,
 * visibility and configuration changes, including observed ABA.
 */
export function captureAttachmentRowActions(options: {
    getAuthority(): AttachmentRowAuthority | null;
    /** Called only after visibility/current/configuration masking gates. */
    readRows(): readonly AttachmentActionRow[] | null;
    /** Additional mounted/committed host lease; actions only. */
    isCurrent(): boolean;
    remove(nativeIndex: number): boolean;
}): AttachmentRowActions {
    const unavailable = { status: 'unavailable' } as const;
    const valid = (
        a: AttachmentRowAuthority | null
    ): a is AttachmentRowAuthority =>
        a !== null &&
        ((typeof a.owner === 'string' && a.owner.trim() !== '') ||
            (typeof a.owner === 'number' && Number.isFinite(a.owner))) &&
        ((typeof a.revision === 'string' && a.revision.trim() !== '') ||
            (typeof a.revision === 'number' && Number.isFinite(a.revision))) &&
        typeof a.visible === 'boolean' &&
        typeof a.editable === 'boolean' &&
        Array.isArray(a.configs);
    const privacyFlags = (configs: readonly unknown[]) =>
        configs.map((config) => {
            if (
                config == null ||
                typeof config !== 'object' ||
                Array.isArray(config)
            )
                return null;
            const c = config as Record<string, unknown>;
            return [
                c.obscurePassword,
                c.maskPasswordOnLoginScreen,
                c.hideAttachmentName,
                c.readOnly,
            ];
        });
    let flags: (unknown[] | null)[] = [];
    let accepted: AttachmentRowAuthority | null = null;
    try {
        const value = options.getAuthority();
        if (valid(value)) {
            accepted = {
                owner: value.owner,
                revision: value.revision,
                visible: value.visible,
                editable: value.editable,
                configs: [...value.configs],
            };
            flags = privacyFlags(accepted.configs);
        }
    } catch {
        /* unavailable */
    }
    const current = () => {
        try {
            const now = options.getAuthority();
            const nowFlags = valid(now) ? privacyFlags(now.configs) : [];
            return (
                valid(accepted) &&
                valid(now) &&
                accepted.owner === now.owner &&
                accepted.revision === now.revision &&
                accepted.visible === now.visible &&
                accepted.editable === now.editable &&
                accepted.configs.length === now.configs.length &&
                accepted.configs.every(
                    (config, index) =>
                        config === now.configs[index] &&
                        flags[index]?.every((flag, key) =>
                            Object.is(flag, nowFlags[index]?.[key])
                        ) === true
                )
            );
        } catch {
            return false;
        }
    };
    const project = () => {
        let rows: readonly AttachmentActionRow[] = [];
        if (!valid(accepted)) return { presentation: unavailable, rows };
        const presentation = projectAttachmentPresentation({
            visible: accepted.visible,
            current,
            configs: accepted.configs,
            readRows: () => {
                const value = options.readRows();
                if (!Array.isArray(value)) return null;
                let last = -1;
                const copied: AttachmentActionRow[] = [];
                for (let index = 0; index < value.length; index++) {
                    const row: AttachmentActionRow | undefined = value[index];
                    const nativeIndex = row?.nativeIndex,
                        visible = row?.visible,
                        removeAllowed = row?.removeAllowed;
                    if (
                        !Object.hasOwn(value, index) ||
                        row == null ||
                        !Number.isSafeInteger(nativeIndex) ||
                        nativeIndex === undefined ||
                        nativeIndex <= last ||
                        typeof visible !== 'boolean' ||
                        typeof removeAllowed !== 'boolean'
                    )
                        return null;
                    last = nativeIndex;
                    // A hidden occurrence must never dereference native metadata.
                    if (!visible) continue;
                    copied.push({
                        nativeIndex,
                        visible,
                        removeAllowed,
                        attachment: row.attachment,
                    });
                }
                rows = copied;
                return copied;
            },
        });
        return {
            presentation,
            rows:
                presentation.status === 'ready'
                    ? rows.filter((row) => row.visible)
                    : [],
        };
    };
    const actionCurrent = () => {
        try {
            return options.isCurrent() === true && current();
        } catch {
            return false;
        }
    };
    const editable =
        accepted?.editable === true &&
        flags.every(
            (row) => row !== null && (row[3] === undefined || row[3] === false)
        );
    const rendered = project();
    const rows = rendered.rows.map((row) => ({
        nativeIndex: row.nativeIndex,
        removeAllowed: editable && row.removeAllowed,
    }));
    return {
        presentation:
            copyAttachmentPresentation(rendered.presentation) ?? unavailable,
        rows: rows.map((row) => ({ ...row })),
        remove(nativeIndex) {
            if (
                rendered.presentation.status !== 'ready' ||
                !Number.isSafeInteger(nativeIndex) ||
                !rows.some(
                    (row) =>
                        row.nativeIndex === nativeIndex && row.removeAllowed
                ) ||
                !actionCurrent()
            )
                return false;
            const now = project();
            if (
                now.presentation.status !== 'ready' ||
                !now.rows.some(
                    (row) =>
                        row.nativeIndex === nativeIndex && row.removeAllowed
                ) ||
                !actionCurrent()
            )
                return false;
            return options.remove(nativeIndex);
        },
    };
}
