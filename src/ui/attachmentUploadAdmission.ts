/** Borrowed host provenance; this is admission for a new intent, not server authorization. */
export type AttachmentUploadAuthority = {
    owner: string | number;
    /** Include observed native/policy/configuration replacement, including ABA. */
    revision: string | number;
    visible: boolean;
    editable: boolean;
};
export type AttachmentUploadAdmission = {
    /**
     * Validation may consult this repeatedly. Failed authoritative validation
     * permanently retires the intent; recursive checks refuse only the nested invocation.
     */
    isCurrent(): boolean;
    /** Single synchronous handoff. The host retains the returned value/promise and its settlement. */
    admit<T>(
        allocate: () => T
    ): { accepted: true; value: T } | { accepted: false };
    /** Never aborts, cancels or discards an already allocated host operation. */
    retire(): void;
};

/** No Files, draft, queue, client, transport, cleanup or recovery journal is owned here. */
export function captureAttachmentUploadAdmission(options: {
    getAuthority(): AttachmentUploadAuthority | null;
    isCurrent(): boolean;
}): AttachmentUploadAdmission {
    const identity = (value: unknown): value is string | number =>
        (typeof value === 'string' && value.trim() !== '') ||
        (typeof value === 'number' && Number.isFinite(value));
    const read = (): AttachmentUploadAuthority | null => {
        const value = options.getAuthority();
        if (value == null) return null;
        const { owner, revision, visible, editable } = value;
        return identity(owner) &&
            identity(revision) &&
            typeof visible === 'boolean' &&
            typeof editable === 'boolean'
            ? { owner, revision, visible, editable }
            : null;
    };
    let captured: AttachmentUploadAuthority | null = null;
    try {
        captured = read();
    } catch {
        /* unavailable host provenance */
    }
    let retired = false;
    let consumed = false;
    let checking = false;
    const current = () => {
        if (retired || consumed || checking) return false;
        checking = true;
        let accepted = false;
        try {
            if (
                captured?.visible &&
                captured.editable &&
                options.isCurrent() === true
            ) {
                const now = read();
                accepted =
                    now !== null &&
                    now.visible &&
                    now.editable &&
                    now.owner === captured.owner &&
                    now.revision === captured.revision &&
                    options.isCurrent() === true &&
                    !retired;
            }
        } catch {
            /* a failed host read cannot admit new allocation */
        } finally {
            checking = false;
        }
        if (!accepted) retired = true;
        return accepted;
    };
    return {
        isCurrent: current,
        admit(allocate) {
            if (!current()) return { accepted: false };
            // Claim before entering the host, including a reentrant allocation callback.
            consumed = true;
            return { accepted: true, value: allocate() };
        },
        retire() {
            retired = true;
        },
    };
}
