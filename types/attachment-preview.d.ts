// docx-preview 0.3.0 has no Node main and its root declaration contains an
// untyped renderDocument. This adapter describes only the used explicit entry.
declare module 'docx-preview/dist/docx-preview.mjs' {
    export function renderAsync(
        data: Blob,
        bodyContainer: HTMLElement
    ): Promise<unknown>;
}
