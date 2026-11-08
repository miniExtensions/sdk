import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { removeMarkdown } from '../src/formulas/index.js';

describe('Markdown display text', () => {
    for (const count of [1, 2, 3, 4, 5, 6, 7, 10, 11]) {
        it(`retains all ${count} readable lines, including cached calls`, () => {
            const lines = Array.from(
                { length: count },
                (_, i) => `Line ${i + 1}`
            );
            const input = lines.join('\n');
            const expected = lines.join('\n\n');
            assert.equal(removeMarkdown(input), expected);
            assert.equal(removeMarkdown(input), expected);
        });
    }

    it('normalizes paragraph separators without dropping later paragraphs', () => {
        const input =
            '\nFirst\n\n\nSecond\n \nThird\nFourth\n\nFifth\nSixth\n\n';
        assert.equal(
            removeMarkdown(input),
            'First\n\nSecond\n\nThird\n\nFourth\n\nFifth\n\nSixth'
        );
        assert.equal(removeMarkdown('\n \n\n'), '');
    });

    it('preserves fenced code text and the paragraphs after it', () => {
        const input = [
            '**Before**',
            '```ts',
            'const value = "**literal**";',
            '<div>literal code</div>',
            '',
            '[literal](https://example.com)',
            '```',
            '*After*',
            'Last paragraph',
        ].join('\n');
        const expected = [
            'Before',
            'const value = "**literal**";',
            '<div>literal code</div>',
            '[literal](https://example.com)',
            'After',
            'Last paragraph',
        ].join('\n\n');
        assert.equal(removeMarkdown(input), expected);
        assert.equal(removeMarkdown(input), expected);
    });

    it('retains links and images while applying existing emphasis and HTML conversion', () => {
        const input = [
            '# Title',
            '**bold** and _italic_',
            '[link](https://example.com)',
            '![image](https://example.com/image.png)',
            '<b>HTML</b>',
            '~~Last paragraph~~',
        ].join('\n');
        const expected = [
            'Title',
            'bold and italic',
            '[link](https://example.com)',
            '![image](https://example.com/image.png)',
            'HTML',
            'Last paragraph',
        ].join('\n\n');
        assert.equal(removeMarkdown(input), expected);
        assert.equal(removeMarkdown(input), expected);
    });
});
