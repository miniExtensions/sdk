import type * as React from 'react';
import type { Node, Schema } from 'prosemirror-model';
import type { EditorState, Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
export { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
export type { EditorState } from 'prosemirror-state';
export type { EditorView } from 'prosemirror-view';
export { toggleMark } from 'prosemirror-commands';
export { isInTable } from 'prosemirror-tables';

export type RuntimeTheme = Record<string, string | number | undefined>;
export type RuntimeEmbed = {
    matcher(url: string): unknown;
    component: React.ComponentType<Record<string, unknown>>;
};
export type RuntimeEditorProps = {
    defaultValue: string;
    value?: string;
    readOnly?: boolean;
    placeholder: string;
    onChange?(readValue: () => string): void;
    onFocus?(): void;
    onBlur?(): void;
    parsers?: { match(node: { content: string }): false | {
        type: 'checkbox_list_item'; checked: boolean; content: string;
    } }[];
    serializer?(node: { type: string; checked: boolean; content: string }): string | false;
    renderNodeView(key: object, dom: HTMLElement, element: React.ReactElement): void;
    removeNodeView(key: object): void;
    extensions?: Extension[];
    embeds?: RuntimeEmbed[];
    theme?: RuntimeTheme;
    dictionary?: Record<string, string>;
    autoFocus?: boolean;
    readOnlyWriteCheckboxes?: boolean;
    dark?: boolean;
    dir?: string;
    id?: string;
    className?: string;
    style?: React.CSSProperties;
    maxLength?: number;
    headingsOffset?: number;
    scrollTo?: string;
    disableExtensions?: string[];
    tooltip?: React.ElementType;
    onClickLink?(href: string, event: MouseEvent): void;
    onClickHashtag?(tag: string, event: MouseEvent): void;
    onHoverLink?(event: MouseEvent): boolean;
    onKeyDown?(event: React.KeyboardEvent<HTMLDivElement>): void;
    onSave?(state: { done: boolean }): void;
    onCancel?(): void;
    onCreateLink?(title: string): Promise<string>;
    onSearchLink?(term: string): Promise<{ title: string; url: string }[]>;
    uploadImage?(file: File): Promise<string>;
    onImageUploadStart?(): void;
    onImageUploadStop?(): void;
    onShowToast?(message: string, code: string): void;
    handleDOMEvents?: Record<string, (view: EditorView, event: Event) => boolean>;
};

export class Editor extends React.PureComponent<RuntimeEditorProps> {
    element: HTMLElement | null;
    view: EditorView;
    schema: Schema;
    commands: unknown;
    pasteParser: { parse(markdown: string): Node | null };
    isViewCurrent(view: EditorView): boolean;
    value(): string;
    focusAtStart(): void;
    focusAtEnd(): void;
}

export class Extension {
    constructor(options?: Record<string, unknown>);
    editor: Editor;
    options: Record<string, unknown>;
    get name(): string;
    get type(): string;
    get plugins(): Plugin<unknown>[];
    bindEditor(editor: Editor): void;
}

export const theme: RuntimeTheme;
export const LANGUAGES: Readonly<Record<string, string>>;
export function isMarkdown(text: string): boolean;
export function isUrl(text: string): boolean;
export function isInCode(state: EditorState): boolean;
