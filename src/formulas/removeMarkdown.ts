/**
 * We have to disable this rule because markdown contains characters like [] and () which need to be escaped
 */
/* eslint-disable no-useless-escape */

/**
 * @param markdown
 * @returns a new string containing only the readable parts of the markdown input.
 * based on https://github.com/stiang/remove-markdown
 */

const cache = new Map<string, string>();
export const removeMarkdown = (markdown: string): string => {
    if (cache.has(markdown)) {
        return cache.get(markdown)!;
    }
    const lines = markdown.split('\n');
    const processedLines = [];
    let insideFencedCodeBlock = false;

    for (let line of lines) {
        // Trim whitespace from the line
        line = line.trim();

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

        // Remove headers (both # and Setext-style)
        if (line.startsWith('#')) {
            line = line
                .replace(/^#{1,6}\s*/, '')
                .replace(/\s*#{1,6}\s*$/, '')
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

        // Remove inline code (e.g., `code`)
        line = line.replace(/`([^`]+)`/g, '$1');

        // Remove bold/italic and nested emphasis
        let emphasisIterations = 0; // Safeguard against infinite loops
        const MAX_EMPHASIS_ITERATIONS = 10; // Limit the number of iterations
        while (/(\*|_){1,3}(.+?)\1{1,3}/.test(line)) {
            line = line.replace(/(\*|_){1,3}(.+?)\1{1,3}/g, '$2');
            emphasisIterations++;
            if (emphasisIterations >= MAX_EMPHASIS_ITERATIONS) {
                console.warn(
                    'Exceeded emphasis processing limit, skipping further replacements.'
                );
                break;
            }
        }

        // Remove strikethrough (e.g., ~~text~~)
        line = line.replace(/~~(.+?)~~/g, '$1');

        // Preserve links and images as-is
        line = line.replace(/!\[.*?\]\(.*?\)/g, (match) => match); // Preserve images
        line = line.replace(/\[.*?\]\(.*?\)/g, (match) => match); // Preserve links

        // Remove HTML tags
        line = line.replace(/<[^>]+>/g, '');

        // Skip empty lines after processing
        if (line.trim() === '') {
            continue;
        }

        // Add the cleaned-up line to the result
        processedLines.push(line);
    }

    // Join processed lines with double newlines for consistency
    const MAX_NEWLINES = 10; // Safeguard against excessive newlines
    const res = processedLines
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
        .split('\n')
        .slice(0, MAX_NEWLINES)
        .join('\n')
        .trim();

    cache.set(markdown, res);
    return res;
};
