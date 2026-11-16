import type { ImageAnnotationSourceLease } from './imageAnnotationSession.js';

export type ImageAnnotationTool =
    | 'ArrowMarker'
    | 'CalloutMarker'
    | 'EllipseMarker'
    | 'FrameMarker'
    | 'FreehandMarker'
    | 'HighlightMarker'
    | 'LineMarker'
    | 'TextMarker';

export type ImageAnnotationEditorLabels = {
    title: string;
    moreTools: string;
    /** Instance-local titles/accessible names; never mutate vendor static titles. */
    tools?: Partial<Record<ImageAnnotationTool, string>>;
    actions?: Readonly<Record<string, string>>;
};

export type ImageAnnotationMarkerEvents = {
    render: { dataUrl: string };
    close: unknown;
};

/** Internal vendor shape/test seam, never accepted as a public field prop. */
export interface ImageAnnotationMarkerArea {
    settings: { displayMode: string };
    availableMarkerTypes: unknown[];
    renderAtNaturalSize: boolean;
    renderImageType: string;
    renderImageQuality?: number;
    targetRoot: HTMLElement;
    styles: { classNamePrefixBase: string; classNamePrefix: string };
    addEventListener(
        type: 'render',
        listener: (event: { dataUrl: string }) => void
    ): void;
    addEventListener(type: 'close', listener: () => void): void;
    removeEventListener(
        type: 'render',
        listener: (event: { dataUrl: string }) => void
    ): void;
    removeEventListener(type: 'close', listener: () => void): void;
    show(): void;
    close(): void;
}
export type ImageAnnotationMarkerModule = {
    MarkerArea: new (image: HTMLImageElement) => ImageAnnotationMarkerArea;
} & Record<ImageAnnotationTool, unknown>;

/** Converts only the vendor's selected PNG output. No URL/network fetch is used. */
export function annotationPngFromDataUrl(dataUrl: string): Blob {
    const prefix = 'data:image/png;base64,';
    if (!dataUrl.startsWith(prefix)) throw new Error('Expected annotation PNG');
    const decoded = atob(dataUrl.slice(prefix.length));
    const bytes = Uint8Array.from(decoded, (character) =>
        character.charCodeAt(0)
    );
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((byte, index) => bytes[index] === byte)) {
        throw new Error('Invalid annotation PNG');
    }
    return new Blob([bytes], { type: 'image/png' });
}

/** Browser-only lazy boundary. Importing this module does not load the vendor/DOM. */
export async function openImageAnnotationMarkerEditor(
    input: {
        image: HTMLImageElement;
        lease: ImageAnnotationSourceLease;
        labels: ImageAnnotationEditorLabels;
    },
    loadVendor: () => Promise<ImageAnnotationMarkerModule> = () =>
        import('markerjs2')
) {
    const { image, lease, labels } = input;
    if (!lease.isCurrent()) return;
    try {
        const markerjs2 = await loadVendor();
        if (!lease.isCurrent()) return;
        const area = new markerjs2.MarkerArea(image);
        area.settings.displayMode = 'popup';
        area.availableMarkerTypes = [
            markerjs2.ArrowMarker,
            markerjs2.CalloutMarker,
            markerjs2.EllipseMarker,
            markerjs2.FrameMarker,
            markerjs2.FreehandMarker,
            markerjs2.HighlightMarker,
            markerjs2.LineMarker,
            markerjs2.TextMarker,
        ];
        area.renderAtNaturalSize = true;
        area.renderImageType = 'image/png';
        area.renderImageQuality = 1;

        let closed = false;
        let rendered = false;
        const keyboardListeners: Array<() => void> = [];
        const removeKeyboard = () => {
            for (const remove of keyboardListeners.splice(0)) remove();
        };
        const onRender = (event: { dataUrl: string }) => {
            if (!lease.isCurrent() || rendered) return;
            rendered = true;
            try {
                const blob = annotationPngFromDataUrl(event.dataUrl);
                void lease.render(blob);
            } catch (error) {
                lease.fail('render', error);
            }
        };
        const removeListeners = () => {
            area.removeEventListener('render', onRender);
            area.removeEventListener('close', onClose);
            removeKeyboard();
        };
        const onClose = () => {
            closed = true;
            removeListeners();
            lease.close();
        };
        const dispose = () => {
            if (closed) return;
            closed = true;
            try {
                area.close();
            } finally {
                removeListeners();
            }
        };
        area.addEventListener('render', onRender);
        area.addEventListener('close', onClose);
        if (!lease.installEditor(dispose)) {
            dispose();
            return;
        }
        area.show();

        // markerjs2 2.32.7 has hardcoded toolbar strings, not a locale property.
        // Bridge only this instance's DOM labels; leave vendor globals untouched.
        const root = area.targetRoot.querySelector<HTMLElement>(
            '.' +
                area.styles.classNamePrefixBase +
                '.' +
                area.styles.classNamePrefix
        );
        if (root) {
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-label', labels.title);
            const selector =
                '[data-action], [data-type-name], .' +
                area.styles.classNamePrefix +
                'toolbar-button';
            root.querySelectorAll<HTMLElement>(selector).forEach((control) => {
                const tool = control.getAttribute('data-type-name');
                const action = control.getAttribute('data-action');
                const title =
                    (tool
                        ? Object.entries(labels.tools ?? {}).find(
                              ([name]) => name === tool
                          )?.[1]
                        : undefined) ??
                    (action ? labels.actions?.[action] : undefined) ??
                    control.getAttribute('title') ??
                    labels.moreTools;
                control.setAttribute('aria-label', title);
                control.setAttribute('title', title);
                if (control instanceof HTMLButtonElement) {
                    control.type = 'button';
                    return;
                }
                control.setAttribute('role', 'button');
                control.tabIndex = 0;
                const keydown = (event: KeyboardEvent) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    control.click();
                };
                control.addEventListener('keydown', keydown);
                keyboardListeners.push(() =>
                    control.removeEventListener('keydown', keydown)
                );
            });
        }
        // Do not activate a commercial license, hide addLogo, or remove its backlink.
        // The component also keeps a visible marker.js attribution beside the field.
    } catch (error) {
        lease.fail('editor', error);
    }
}
