import {
    Extension,
    Plugin,
    PluginKey,
    TextSelection,
    toggleMark,
    isInTable,
    type Editor,
    type EditorState,
    isMarkdown,
    isUrl,
    isInCode as selectionIsInCode,
    LANGUAGES,
} from '../../vendor/rich-markdown-editor/sdk-runtime.js';

import { configureRichTextCheckboxes } from './completeRichTextCheckboxes.js';

const PROSEMIRROR_SLICE_MIME_TYPE = 'application/x-prosemirror-slice';
const PROSEMIRROR_HTML_MARKER = 'data-pm-slice';
export const generalPastePluginKey = new PluginKey<unknown>(
    'general-markdown-paste-fix'
);

type VscodeClipboardMetadata = {
    mode?: string;
};

type UnknownRecord = Record<string, unknown>;

type MarkdownPasteDecisionInput = {
    text: string;
    html: string;
    pasteCodeLanguage?: string;
    hasProsemirrorSlice: boolean;
};

type MarkdownFenceTokenizer = {
    parse(
        text: string,
        environment: Record<string, unknown>
    ): readonly {
        type: string;
        map: readonly [number, number] | null;
    }[];
};
type MarkdownPasteParser = Editor['pasteParser'] & {
    tokenizer: MarkdownFenceTokenizer;
};

type EmbedCommands = {
    embed(attributes: { href: string }): unknown;
};

const normalizeBareTaskMarkers = (text: string): string => {
    const CHECKBOX_REGEX = /^\s?(\[(X|\s|_|-)\]\s(.*)?)/gim;
    let normalizedText = text;

    while (normalizedText.match(CHECKBOX_REGEX) != null) {
        normalizedText = normalizedText.replace(
            CHECKBOX_REGEX,
            (match) => `- ${match.trim()}`
        );
    }

    return normalizedText;
};

function normalizePastedMarkdown(
    text: string,
    tokenizer: MarkdownFenceTokenizer
): string {
    if (!text.includes('[') || (!text.includes('```') && !text.includes('~~~')))
        return normalizeBareTaskMarkers(text);

    const lineBreaks = Array.from(text.matchAll(/\r\n?|\n/g));
    const parts: string[] = [];
    let cursor = 0;
    for (const token of tokenizer.parse(text, {})) {
        if (token.type !== 'fence' || token.map == null) continue;
        const [startLine, endLine] = token.map;
        // Keep the preceding line break with the fence. The legacy task
        // rewrite can otherwise trim it away after a bare marker.
        const fenceStart = Math.max(
            cursor,
            lineBreaks[startLine - 1]?.index ?? 0
        );
        const lastBreak = lineBreaks[endLine - 1];
        const fenceEnd =
            lastBreak == null
                ? text.length
                : lastBreak.index + lastBreak[0].length;
        parts.push(
            normalizeBareTaskMarkers(text.slice(cursor, fenceStart)),
            text.slice(fenceStart, fenceEnd)
        );
        cursor = fenceEnd;
    }
    parts.push(normalizeBareTaskMarkers(text.slice(cursor)));
    return parts.join('');
}

const isUnknownRecord = (value: unknown): value is UnknownRecord =>
    typeof value === 'object' && value != null;

const parseVscodeClipboardMetadata = (
    rawMetadata: string
): VscodeClipboardMetadata | undefined => {
    if (rawMetadata.length === 0) {
        return undefined;
    }

    try {
        const parsed: unknown = JSON.parse(rawMetadata);

        if (!isUnknownRecord(parsed)) {
            return undefined;
        }

        const mode = parsed.mode;

        if (typeof mode === 'string') {
            return { mode };
        }

        return {};
    } catch {
        return undefined;
    }
};

const hasProsemirrorSliceInClipboard = (event: ClipboardEvent): boolean => {
    const types = event.clipboardData?.types;

    if (types == null) {
        return false;
    }

    return types.includes(PROSEMIRROR_SLICE_MIME_TYPE);
};

export const shouldParsePlainTextAsMarkdown = ({
    text,
    html,
    pasteCodeLanguage,
    hasProsemirrorSlice,
}: MarkdownPasteDecisionInput): boolean => {
    if (hasProsemirrorSlice || html.includes(PROSEMIRROR_HTML_MARKER)) {
        return false;
    }

    if (pasteCodeLanguage === 'markdown') {
        return true;
    }

    const hasHtml = html.trim().length > 0;
    return !hasHtml && isMarkdown(text);
};

export class GeneralPasteHandlerExtension extends Extension {
    override get name(): string {
        return 'general-markdown-paste-fix';
    }

    get rulePlugins(): (typeof configureRichTextCheckboxes)[] {
        return [configureRichTextCheckboxes];
    }

    override get plugins(): Plugin<unknown>[] {
        return [
            new Plugin<unknown>({
                key: generalPastePluginKey,
                props: {
                    handlePaste: (view, event: ClipboardEvent) => {
                        if (!this.editor.isViewCurrent(view)) return false;
                        if (
                            typeof view.props.editable === 'function' &&
                            !view.props.editable(view.state)
                        ) {
                            return false;
                        }

                        const clipboardData = event.clipboardData;
                        if (clipboardData == null) {
                            return false;
                        }

                        const text = clipboardData.getData('text/plain');
                        const html = clipboardData.getData('text/html');
                        const vscodeRawMetadata =
                            clipboardData.getData('vscode-editor-data');
                        const vscodeMetadata =
                            parseVscodeClipboardMetadata(vscodeRawMetadata);
                        const pasteCodeLanguage = vscodeMetadata?.mode;
                        const hasProsemirrorSlice =
                            hasProsemirrorSliceInClipboard(event);
                        const { state, dispatch } = view;
                        const { from, to, $from, $to } = state.selection;

                        // The next block's start can be an endpoint without
                        // its text being part of the selected code.
                        if (
                            $from.parent.type.spec.code === true &&
                            from < $from.end() &&
                            $to.parent.isTextblock &&
                            $to.parentOffset === 0 &&
                            $from.after() === $to.before() &&
                            isUrl(text)
                        ) {
                            event.preventDefault();
                            const transaction = state.tr.insertText(
                                text,
                                from,
                                $from.end()
                            );
                            view.dispatch(
                                transaction.setSelection(
                                    TextSelection.create(
                                        transaction.doc,
                                        from + text.length
                                    )
                                )
                            );
                            return true;
                        }

                        if (
                            selectionIsInCode(state) ||
                            state.selection.$head.parent.type.spec.code === true
                        ) {
                            event.preventDefault();
                            view.dispatch(view.state.tr.insertText(text));
                            return true;
                        }

                        if (isUrl(text)) {
                            if (!state.selection.empty) {
                                const link = this.editor.schema.marks.link;
                                const existingLink = link.isInSet(
                                    $from.nodeAfter?.marks ?? []
                                );
                                if (existingLink && $from.sameParent($to)) {
                                    let coversSelection = true;
                                    state.doc.nodesBetween(from, to, (node) => {
                                        if (
                                            node.isInline &&
                                            !existingLink.isInSet(node.marks)
                                        ) {
                                            coversSelection = false;
                                        }
                                        return coversSelection;
                                    });
                                    if (coversSelection) {
                                        view.dispatch(
                                            state.tr
                                                .removeMark(
                                                    from,
                                                    to,
                                                    existingLink
                                                )
                                                .addMark(
                                                    from,
                                                    to,
                                                    link.create({
                                                        ...existingLink.attrs,
                                                        href: text,
                                                    })
                                                )
                                        );
                                        return true;
                                    }
                                }
                                toggleMark(link, { href: text })(
                                    state,
                                    dispatch
                                );
                                return true;
                            }

                            const { embeds } = this.editor.props;

                            if (
                                Array.isArray(embeds) &&
                                embeds.length > 0 &&
                                !isInTable(state)
                            ) {
                                for (const embed of embeds) {
                                    const matches = embed.matcher(text);
                                    if (Boolean(matches)) {
                                        // The vendor declares all commands as any.
                                        const commands = this.editor
                                            .commands as EmbedCommands;
                                        commands.embed({ href: text });
                                        return true;
                                    }
                                }
                            }

                            const transaction = view.state.tr
                                .insertText(
                                    text,
                                    state.selection.from,
                                    state.selection.to
                                )
                                .addMark(
                                    state.selection.from,
                                    state.selection.to + text.length,
                                    state.schema.marks.link.create({
                                        href: text,
                                    })
                                );

                            view.dispatch(transaction);
                            return true;
                        }

                        if (
                            pasteCodeLanguage &&
                            pasteCodeLanguage !== 'markdown'
                        ) {
                            event.preventDefault();

                            const isSupportedLanguage =
                                Object.prototype.hasOwnProperty.call(
                                    LANGUAGES,
                                    pasteCodeLanguage
                                );

                            view.dispatch(
                                view.state.tr
                                    .replaceSelectionWith(
                                        view.state.schema.nodes.code_fence.create(
                                            {
                                                language: isSupportedLanguage
                                                    ? pasteCodeLanguage
                                                    : null,
                                            }
                                        )
                                    )
                                    .insertText(text)
                            );

                            return true;
                        }

                        if (
                            shouldParsePlainTextAsMarkdown({
                                text,
                                html,
                                pasteCodeLanguage,
                                hasProsemirrorSlice,
                            })
                        ) {
                            event.preventDefault();

                            // The pinned editor creates a ProseMirror
                            // MarkdownParser; use its own fence line ranges.
                            const parser = this.editor
                                .pasteParser as MarkdownPasteParser;
                            const paste = parser.parse(
                                normalizePastedMarkdown(text, parser.tokenizer)
                            );
                            if (paste == null) return true;
                            const slice = paste.slice(0);

                            view.dispatch(
                                view.state.tr.replaceSelection(slice)
                            );
                            return true;
                        }

                        return false;
                    },
                },
            }),
        ];
    }
}

export default GeneralPasteHandlerExtension;
