import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    convertEditorValueToStoredRichText,
    normalizeRichTextForComparison,
    convertStoredRichTextToEditorMarkdown,
    parseStoredRichTextCheckbox,
    serializeStoredRichTextCheckbox,
} from '../src/forms/index.js';

test('native editor empty sentinel and hard breaks use exact stored bytes', () => {
    for (const [input, expected] of [
        ['\\\n', ''],
        ['line 1\n\\\nline 2', 'line 1\n\nline 2'],
        ['line 1\\\nline 2', 'line 1\\\nline 2'],
        [' content  \n', ' content  \n'],
    ])
        assert.equal(convertEditorValueToStoredRichText(input), expected);
});

test('native checkbox output keeps the established exact lower-case and line-prefix grammar', () => {
    assert.equal(
        convertEditorValueToStoredRichText(
            '- [x] Done\n- [ ] Open\n- [X] Legacy\n  - [x] Nested\ninline - [x] text'
        ),
        '[x] Done\n[ ] Open\n- [X] Legacy\n  - [x] Nested\ninline - [x] text'
    );
});

test('comparison keys normalize nullable values, CRLF and trailing newline artifacts only', () => {
    assert.equal(normalizeRichTextForComparison(null), '');
    assert.equal(normalizeRichTextForComparison(undefined), '');
    assert.equal(normalizeRichTextForComparison('a\r\nb\n\n'), 'a\nb');
    assert.equal(normalizeRichTextForComparison('- [x] task\n'), '[x] task');
    assert.equal(normalizeRichTextForComparison('a  \n'), 'a  ');
    assert.equal(normalizeRichTextForComparison('\u200ba\t'), '\u200ba\t');
});

test('comparison never changes the raw stored serialization or its trailing spaces/newlines', () => {
    const raw = '- [x] task  \n\n';
    const stored = convertEditorValueToStoredRichText(raw);
    assert.equal(stored, '[x] task  \n\n');
    assert.equal(normalizeRichTextForComparison(stored), '[x] task  ');
    assert.equal(stored, '[x] task  \n\n');
});

test('stored checkbox syntax converts for the existing native editor without general Markdown rewriting', () => {
    assert.equal(convertStoredRichTextToEditorMarkdown(null), '');
    assert.equal(convertStoredRichTextToEditorMarkdown(undefined), '');
    const stored = '[x] Done\n[ ] Open\n[X] Legacy\n  [x] Nested\n**bold**  \n';
    assert.equal(
        convertStoredRichTextToEditorMarkdown(stored),
        '- [x] Done\n- [ ] Open\n[X] Legacy\n  [x] Nested\n**bold**  \n'
    );
    assert.equal(
        convertEditorValueToStoredRichText(
            convertStoredRichTextToEditorMarkdown(stored)
        ),
        stored
    );
});

test('native checkbox parser preserves exact admission and only trims the checkbox content', () => {
    assert.deepEqual(
        parseStoredRichTextCheckbox({ content: '[x]  checked  ' }),
        { type: 'checkbox_list_item', checked: true, content: 'checked' }
    );
    assert.deepEqual(parseStoredRichTextCheckbox({ content: '[\t]  open  ' }), {
        type: 'checkbox_list_item',
        checked: false,
        content: 'open',
    });
    for (const content of [
        '[X] legacy',
        ' [x] indented',
        '- [x] list',
        'plain',
        '[no] invalid',
    ])
        assert.equal(parseStoredRichTextCheckbox({ content }), false);
});

test('native checkbox serializer keeps checked state, content bytes and final newline', () => {
    assert.equal(
        serializeStoredRichTextCheckbox({
            type: 'checkbox_list_item',
            checked: true,
            content: ' exact  ',
        }),
        '[x]  exact  \n'
    );
    assert.equal(
        serializeStoredRichTextCheckbox({
            type: 'checkbox_list_item',
            checked: false,
            content: 'open',
        }),
        '[ ] open\n'
    );
    assert.equal(
        serializeStoredRichTextCheckbox({
            type: 'paragraph',
            checked: true,
            content: 'plain',
        }),
        false
    );
});

test('serialization and comparison preserve established lexical behavior inside fenced text', () => {
    const editor = '```\n- [x] literal\n```\n';
    const stored = '```\n[x] literal\n```\n';
    assert.equal(convertEditorValueToStoredRichText(editor), stored);
    assert.equal(convertStoredRichTextToEditorMarkdown(stored), editor);
});
