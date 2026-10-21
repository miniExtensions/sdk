import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const richTextSerializationTypedConsumer = `
import {convertEditorValueToStoredRichText as rtStore,normalizeRichTextForComparison as rtCompare,convertStoredRichTextToEditorMarkdown as rtEditor,parseStoredRichTextCheckbox as rtParse,serializeStoredRichTextCheckbox as rtSerialize,type ParsedRichTextCheckbox as RtParsed} from '@miniextensions/sdk/forms';
const rtStored:string=rtStore('- [x] task\\n');const rtKey:string=rtCompare(null);const rtMarkdown:string=rtEditor(undefined);
const rtParsed:RtParsed|false=rtParse({content:'[x] task'});if(rtParsed!==false){const rtNodeKind:'checkbox_list_item'=rtParsed.type;void rtNodeKind;}
const rtSerialized:string|false=rtSerialize({type:'checkbox_list_item',checked:true,content:'task'});
// @ts-expect-error native editor serialization is a string
rtStore(42);
// @ts-expect-error checkbox parser requires native text content
rtParse({content:42});
// @ts-expect-error native checked state remains boolean
rtSerialize({type:'checkbox_list_item',checked:'yes',content:'task'});
void rtStored;void rtKey;void rtMarkdown;void rtSerialized;
`;

export async function checkRichTextSerializationConsumer({
    consumerDirectory,
}) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/forms/index.js'
            )
        )
    );
    let checks = 0;
    for (const api of [esm, consumer('@miniextensions/sdk/forms')]) {
        const raw = '- [x] done  \n\n';
        const stored = api.convertEditorValueToStoredRichText(raw);
        assert.equal(stored, '[x] done  \n\n');
        assert.equal(api.normalizeRichTextForComparison(stored), '[x] done  ');
        assert.equal(stored, '[x] done  \n\n');
        assert.equal(api.convertStoredRichTextToEditorMarkdown(stored), raw);
        assert.equal(api.convertEditorValueToStoredRichText('\\\n'), '');
        assert.equal(
            api.convertEditorValueToStoredRichText('a\n\\\nb'),
            'a\n\nb'
        );
        assert.equal(api.normalizeRichTextForComparison('a\r\nb\n'), 'a\nb');
        assert.equal(api.normalizeRichTextForComparison(undefined), '');
        assert.deepEqual(
            api.parseStoredRichTextCheckbox({ content: '[x]  done  ' }),
            { type: 'checkbox_list_item', checked: true, content: 'done' }
        );
        assert.equal(
            api.parseStoredRichTextCheckbox({ content: '[X] legacy' }),
            false
        );
        assert.equal(
            api.serializeStoredRichTextCheckbox({
                type: 'checkbox_list_item',
                checked: false,
                content: 'open',
            }),
            '[ ] open\n'
        );
        assert.equal(
            api.serializeStoredRichTextCheckbox({
                type: 'paragraph',
                checked: true,
                content: 'plain',
            }),
            false
        );
        checks++;
    }
    return checks;
}
