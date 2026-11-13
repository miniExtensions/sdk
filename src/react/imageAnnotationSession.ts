/** Internal lifecycle for the explicit host-authorized annotation route.
 * This does not broaden attachmentController's upload-file-only admission.
 */
export type ImageAnnotationOwner = {
    token: object;
    /** Continuing native authority, not a one-shot allocation admission. */
    isCurrent: () => boolean;
};

export type AnnotatedImage = {
    url: string;
    filename: string;
    size: number;
    type: 'image/png';
};

export type ImageAnnotationStorage<Upload> = {
    createTemporaryPng: (input: {
        blob: Blob;
        filename: string;
        operation: object;
    }) => Promise<Upload>;
    resolveUrl: (upload: Upload) => Promise<string>;
};

export type ImageAnnotationAppend = (input: {
    owner: object;
    operation: object;
    attachment: AnnotatedImage;
}) => 'appended' | 'retired';

export type ImageAnnotationFailure =
    | 'decode'
    | 'editor'
    | 'render'
    | 'storage';

export type ImageAnnotationSource = {
    url: string;
    filename: string;
};

type OwnedSource = ImageAnnotationSource & { ownedObjectUrl: boolean };

export type ImageAnnotationSourceLease = {
    token: object;
    source: ImageAnnotationSource;
    isCurrent: () => boolean;
    /** Refused late drivers must dispose themselves instead of showing. */
    installEditor: (close: () => void) => boolean;
    /** Normal vendor close does not cancel an already allocated render/upload. */
    close: () => void;
    fail: (phase: ImageAnnotationFailure, error: unknown) => void;
    render: (blob: Blob) => Promise<void> | null;
};

type SourceState = {
    token: object;
    source: OwnedSource;
    closed: boolean;
    rendered: boolean;
    released: boolean;
    closeEditor: (() => void) | null;
};

export const buildAnnotatedImageFilename = (filename: string) => {
    const original = filename.length > 0 ? filename : 'image';
    return original.replace(/\.[^/.]+$/, '') + '-annotated.png';
};

export function createImageAnnotationSession<Upload>(ports: {
    owner: ImageAnnotationOwner;
    storage: ImageAnnotationStorage<Upload>;
    /** Must synchronously fence original owner/operation and append to latest value. */
    appendCurrent: ImageAnnotationAppend;
    releaseObjectUrl: (url: string) => void;
    onSavingChange?: (saving: boolean) => void;
    onClose?: (source: object) => void;
    onFailure?: (phase: ImageAnnotationFailure, error: unknown) => void;
}) {
    let active: SourceState | null = null;
    let disposed = false;

    const ownerIsCurrent = () => {
        try {
            return ports.owner.isCurrent();
        } catch {
            return false;
        }
    };
    const continues = (state: SourceState) =>
        !disposed && active === state && ownerIsCurrent();
    const editable = (state: SourceState) =>
        continues(state) && !state.closed;
    const release = (state: SourceState) => {
        if (!state.source.ownedObjectUrl || state.released) return;
        state.released = true;
        ports.releaseObjectUrl(state.source.url);
    };
    const retire = (state: SourceState) => {
        if (active === state) active = null;
        state.closed = true;
        const close = state.closeEditor;
        state.closeEditor = null;
        try {
            close?.();
        } finally {
            release(state);
        }
    };
    const report = (
        state: SourceState,
        phase: ImageAnnotationFailure,
        error: unknown
    ) => {
        if (continues(state)) ports.onFailure?.(phase, error);
    };

    const beginSource = (source: OwnedSource): ImageAnnotationSourceLease | null => {
        if (disposed || !ownerIsCurrent()) {
            // The caller allocated local URLs before admission. Own their release.
            if (source.ownedObjectUrl) ports.releaseObjectUrl(source.url);
            return null;
        }
        if (active) {
            try {
                retire(active);
            } catch (error) {
                disposed = true;
                if (source.ownedObjectUrl) ports.releaseObjectUrl(source.url);
                ports.onFailure?.('editor', error);
                return null;
            }
        }
        const state: SourceState = {
            token: {},
            source,
            closed: false,
            rendered: false,
            released: false,
            closeEditor: null,
        };
        active = state;
        ports.onSavingChange?.(false);

        const close = () => {
            if (state.closed) {
                release(state);
                return;
            }
            const notify = continues(state);
            state.closed = true;
            state.closeEditor = null;
            release(state);
            if (notify) {
                try {
                    ports.onClose?.(state.token);
                } catch (error) {
                    // Never interrupt the vendor's close/detach control flow.
                    try { ports.onFailure?.('editor', error); } catch { /* observer contract is nonthrowing */ }
                }
            }
        };

        return {
            token: state.token,
            source: { url: source.url, filename: source.filename },
            isCurrent: () => editable(state),
            installEditor(disposeEditor) {
                if (!editable(state) || state.closeEditor !== null) return false;
                state.closeEditor = disposeEditor;
                return true;
            },
            close,
            fail(phase, error) {
                if (!editable(state)) return;
                report(state, phase, error);
                const disposeEditor = state.closeEditor;
                state.closeEditor = null;
                try {
                    disposeEditor?.();
                } finally {
                    close();
                }
            },
            render(blob) {
                if (!editable(state) || state.rendered) return null;
                // Consume before transport allocation. Throws do not re-arm a render.
                state.rendered = true;
                const operation = {};
                const filename = buildAnnotatedImageFilename(source.filename);
                ports.onSavingChange?.(true);
                return (async () => {
                    try {
                        const upload = await ports.storage.createTemporaryPng({
                            blob,
                            filename,
                            operation,
                        });
                        // Closing UI is allowed; replacement/unmount/owner retirement is not.
                        if (!continues(state)) return;
                        const url = await ports.storage.resolveUrl(upload);
                        if (!continues(state)) return;
                        ports.appendCurrent({
                            owner: ports.owner.token,
                            operation,
                            attachment: {
                                url,
                                filename,
                                size: blob.size,
                                type: 'image/png',
                            },
                        });
                    } catch (error) {
                        report(state, 'storage', error);
                    } finally {
                        if (continues(state)) ports.onSavingChange?.(false);
                    }
                })();
            },
        };
    };

    return {
        isCurrent: () => !disposed && ownerIsCurrent(),
        beginSource,
        clearSource() {
            if (active) retire(active);
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            if (active) retire(active);
        },
    };
}
