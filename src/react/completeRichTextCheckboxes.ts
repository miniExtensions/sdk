// Structural types for the existing vendor rule-plugin hook, without importing
// the vendor's incomplete transitive Markdown-it declaration closure.
type Token = {
    type: string;
    level: number;
    nesting: number;
    content: string;
    attrs: [string, string][] | null;
    children: Token[] | null;
    attrSet(name: string, value: string): void;
};
type Markdown = {
    core: {
        ruler: {
            at(name: string, rule: (state: { tokens: Token[] }) => void): void;
        };
    };
};

const checkboxMarker = /^\[([x\s_-])\]\s/i;

function closingIndex(tokens: Token[], start: number): number {
    const opening = tokens[start]!;
    for (let index = start + 1; index < tokens.length; index++) {
        const token = tokens[index]!;
        if (token.level === opening.level && token.nesting === -1) return index;
    }
    return -1;
}

function copyToken(token: Token, type: string): Token {
    const copy = Object.assign(
        Object.create(Object.getPrototypeOf(token)) as Token,
        token,
        { type }
    );
    copy.attrs = token.attrs?.map(([name, value]) => [name, value]) ?? null;
    return copy;
}

function asCheckboxItem(tokens: Token[]): boolean {
    const inline = tokens[2];
    const text = inline?.children?.[0];
    if (
        tokens[1]?.type !== 'paragraph_open' ||
        inline?.type !== 'inline' ||
        text?.type !== 'text'
    )
        return false;
    const marker = inline.content.match(checkboxMarker);
    if (!marker) return false;

    const opening = copyToken(tokens[0]!, 'checkbox_item_open');
    if (marker[1]!.toLowerCase() === 'x') opening.attrSet('checked', 'true');
    tokens[0] = opening;
    tokens[tokens.length - 1] = copyToken(
        tokens[tokens.length - 1]!,
        'checkbox_item_close'
    );
    // Preserve the vendor's whitespace and softbreak label behavior.
    if (text.content.startsWith(marker[0])) {
        inline.content = inline.content.slice(marker[0].length);
        text.content = text.content.slice(marker[0].length);
    }
    return true;
}

function splitBulletList(tokens: Token[]): Token[] {
    const items: Token[][] = [];
    // Pair direct siblings by depth; a nested item's close must not close its parent.
    for (let index = 1; index < tokens.length - 1; ) {
        if (tokens[index]?.type !== 'list_item_open') return tokens;
        const end = closingIndex(tokens, index);
        if (end === -1) return tokens;
        items.push(tokens.slice(index, end + 1));
        index = end + 1;
    }

    const result: Token[] = [];
    let kind: 'checkbox_list' | 'bullet_list' | undefined;
    let run: Token[] = [];
    const flush = () => {
        if (!kind) return;
        result.push(copyToken(tokens[0]!, kind + '_open'));
        for (const token of run) result.push(token);
        result.push(copyToken(tokens[tokens.length - 1]!, kind + '_close'));
    };
    for (const item of items) {
        const nextKind = asCheckboxItem(item) ? 'checkbox_list' : 'bullet_list';
        if (nextKind !== kind) {
            flush();
            kind = nextKind;
            run = [];
        }
        for (const token of rewriteBulletLists(item)) run.push(token);
    }
    flush();
    return result;
}

function rewriteBulletLists(tokens: Token[]): Token[] {
    const result: Token[] = [];
    for (let index = 0; index < tokens.length; index++) {
        if (tokens[index]!.type !== 'bullet_list_open') {
            result.push(tokens[index]!);
            continue;
        }
        const end = closingIndex(tokens, index);
        if (end === -1) {
            for (const token of tokens.slice(index)) result.push(token);
            break;
        }
        for (const token of splitBulletList(tokens.slice(index, end + 1)))
            result.push(token);
        index = end;
    }
    return result;
}

/** Keep both real editor parsers within their existing homogeneous list schemas. */
export function configureRichTextCheckboxes(markdown: Markdown): void {
    markdown.core.ruler.at('checkboxes', (state) => {
        state.tokens = rewriteBulletLists(state.tokens);
    });
}
