/**
 * We have to disable this rule because markdown contains characters like [] and () which need to be escaped
 */
/* eslint-disable no-useless-escape */

/**
 * @param markdown
 * @returns a new string containing only the readable parts of the markdown input.
 * based on https://github.com/stiang/remove-markdown
 */

const markdownCache = new Map<string, string>();
const formTitleCache = new Map<string, string>();
const markup = /<[^>]+>/g;
// A Form title can use angle brackets as comparison signs in plain text.
const formTitleMarkup =
    /<!--.*?-->|<!doctype\s+[^<>]*>|<\/?[a-z][\w:-]*(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;
// Underscores within an identifier do not open or close Markdown emphasis.
const emphasis =
    /(\*){1,3}(.+?)\1{1,3}|(?<![\p{L}\p{M}\p{N}_])(_{1,3})(?![_\s])(.+?)(?<![_\s])\3(?![\p{L}\p{M}\p{N}_])/gu;

function plainTextFromMarkdown(
    markdown: string,
    tags: RegExp,
    cache: Map<string, string>,
    preserveInlineCode = false
): string {
    if (cache.has(markdown)) {
        return cache.get(markdown)!;
    }
    const lines = markdown.split('\n');
    const processedLines = [];
    let insideFencedCodeBlock = false;

    for (const rawLine of lines) {
        // Trim whitespace from the line
        let line = rawLine.trim();

        // Handle fenced code blocks (e.g., ``` or ~~~)
        if (line.startsWith('```') || line.startsWith('~~~')) {
            insideFencedCodeBlock = !insideFencedCodeBlock;
            if (!insideFencedCodeBlock) {
                processedLines.push(''); // Add a blank line after closing a code block
            }
            continue; // Skip opening/closing markers
        }
        if (insideFencedCodeBlock) {
            processedLines.push(line); // Preserve content inside fenced code blocks
            continue;
        }

        // Remove horizontal rules
        if (
            /^(-{3,}|\*{3,}|_{3,})$/.test(line) ||
            /^(\* \* \*|\- \- \-)$/.test(line)
        ) {
            continue;
        }

        // Only a valid heading opener and a whitespace-separated closer are formatting.
        const heading = /^ {0,3}#{1,6}(?=[ \t]|\r?$)/.exec(rawLine);
        if (heading) {
            line = rawLine
                .slice(heading[0].length)
                .replace(/[ \t]#+[ \t]*\r?$/, '')
                .trim();
        }
        if (/^[=\-]{2,}\s*$/.test(line)) {
            continue;
        }

        // Remove blockquotes (but preserve content)
        if (/^\s{0,3}>\s?/.test(line)) {
            line = line.replace(/^\s{0,3}>\s?/, '');
        }

        // Remove list syntax (unordered and ordered)
        line = line.replace(/^(\s*)[\*\-\+]\s+/, '$1'); // Unordered
        line = line.replace(/^(\s*)(\d+\.)\s+/, '$1'); // Ordered

        const literals: string[] | undefined = preserveInlineCode
            ? []
            : undefined;
        if (literals) {
            // Keep code opaque to formatting, and escape authored markers too.
            line = line.replace(
                /`([^`]+)`|\uE000/g,
                (match, code: string | undefined) => {
                    const index = literals.push(code ?? match) - 1;
                    return `\uE000${index}\uE000`;
                }
            );
        } else {
            line = line.replace(/`([^`]+)`/g, '$1');
        }

        // Remove bold/italic and nested emphasis
        const MAX_EMPHASIS_ITERATIONS = 10; // Limit the number of iterations
        for (
            let iteration = 1;
            iteration <= MAX_EMPHASIS_ITERATIONS;
            iteration++
        ) {
            const stripped = line.replace(
                emphasis,
                (
                    _match,
                    _asterisk,
                    asteriskText,
                    _underscore,
                    underscoreText
                ) => asteriskText ?? underscoreText
            );
            if (stripped === line) break;
            line = stripped;
            if (iteration === MAX_EMPHASIS_ITERATIONS) {
                console.warn(
                    'Exceeded emphasis processing limit, skipping further replacements.'
                );
            }
        }

        // Remove strikethrough (e.g., ~~text~~)
        line = line.replace(/~~(.+?)~~/g, '$1');

        // Preserve links and images as-is
        line = line.replace(/!\[.*?\]\(.*?\)/g, (match) => match); // Preserve images
        line = line.replace(/\[.*?\]\(.*?\)/g, (match) => match); // Preserve links

        // Remove HTML tags
        line = line.replace(tags, '');
        if (literals?.length) {
            line = line.replace(/\uE000(\d+)\uE000/g, (_match, index) => {
                return literals[Number(index)];
            });
        }

        // Skip empty lines after processing
        if (line.trim() === '') {
            continue;
        }

        // Add the cleaned-up line to the result
        processedLines.push(line);
    }

    // Join processed lines with double newlines for consistency
    const res = processedLines
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
        .trim();

    cache.set(markdown, res);
    return res;
}

export const removeMarkdown = (markdown: string): string =>
    plainTextFromMarkdown(markdown, markup, markdownCache);

export const removeFormTitleMarkdown = (markdown: string): string =>
    plainTextFromMarkdown(markdown, formTitleMarkup, formTitleCache, true);
