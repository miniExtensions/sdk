/** Native rich-markdown-editor output and the hosted stored-checkbox syntax. */
export type RichTextCheckboxNode = {
    type: string;
    checked: boolean;
    content: string;
};
export type ParsedRichTextCheckbox = {
    type: 'checkbox_list_item';
    checked: boolean;
    content: string;
};

/** Preserve stored bytes except the existing editor sentinel, hard-break and checkbox artifacts. */
export function convertEditorValueToStoredRichText(value: string): string {
    if (value === '\\\n') return '';
    return value
        .replace(/\n\\\n/g, '\n\n')
        .replace(
            /^- \[(\s|x)\]/gm,
            (_, content: string) => `[${content === 'x' ? 'x' : ' '}]`
        );
}

/** Equality only. Never use this comparison key as the persisted value. */
export function normalizeRichTextForComparison(
    value: string | null | undefined
): string {
    if (value == null) return '';
    return convertEditorValueToStoredRichText(
        value.replace(/\r\n/g, '\n')
    ).replace(/\n+$/g, '');
}

/** The caller's actual editor still owns its document, ref, caret, composition and paste. */
export function convertStoredRichTextToEditorMarkdown(
    value: string | null | undefined
): string {
    return (
        value?.replace(
            /^\[(\s|x)\]/gm,
            (_, content: string) => `- [${content === 'x' ? 'x' : ' '}]`
        ) ?? ''
    );
}

export function parseStoredRichTextCheckbox(node: {
    content: string;
}): ParsedRichTextCheckbox | false {
    const checkbox = /^\[(\s|x)\]/.exec(node.content);
    if (checkbox == null) return false;
    return {
        type: 'checkbox_list_item',
        checked: checkbox[1] === 'x',
        content: node.content.slice(3).trim(),
    };
}

export function serializeStoredRichTextCheckbox(
    node: RichTextCheckboxNode
): string | false {
    return node.type === 'checkbox_list_item'
        ? `[${node.checked ? 'x' : ' '}] ${node.content}\n`
        : false;
}
