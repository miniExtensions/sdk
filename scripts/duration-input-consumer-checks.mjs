import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const durationInputTypedConsumer = `
import {isDurationInputText,parseDurationInputSeconds,type DurationFormat} from '@miniextensions/sdk/formulas';
const durationDraftAccepted:boolean=isDurationInputText('-');
const durationCompatibilityFormat:DurationFormat='h:mm:ss.SSS';
const nativeDurationSeconds:number|null=parseDurationInputSeconds('1:20.125',durationCompatibilityFormat);
// @ts-expect-error input drafts remain strings
isDurationInputText(7);
// @ts-expect-error input conversion requires an explicit supported duration format
parseDurationInputSeconds('7','minutes');
void durationDraftAccepted;void nativeDurationSeconds;
`;

export async function checkDurationInputConsumer({ consumerDirectory }) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/formulas/index.js'
            )
        )
    );
    let checks = 0;
    for (const api of [esm, consumer('@miniextensions/sdk/formulas')]) {
        assert.equal(api.isDurationInputText(''), true);
        assert.equal(api.isDurationInputText('-'), true);
        assert.equal(api.isDurationInputText(':'), true);
        assert.equal(api.isDurationInputText('25:72'), true);
        assert.equal(api.isDurationInputText('-1:01:20.125'), true);
        assert.equal(api.isDurationInputText('.'), false);
        assert.equal(api.isDurationInputText('1.1234'), false);
        assert.equal(api.isDurationInputText('abc'), false);
        for (const format of [
            'h:mm',
            'h:mm:ss',
            'h:mm:ss.S',
            'h:mm:ss.SS',
            'h:mm:ss.SSS',
        ]) {
            assert.equal(api.parseDurationInputSeconds('', format), null);
            assert.equal(api.parseDurationInputSeconds('-', format), 0);
            assert.equal(
                api.parseDurationInputSeconds('7', format),
                format === 'h:mm' ? 420 : 7
            );
            assert.equal(
                api.parseDurationInputSeconds('25:72', format),
                format === 'h:mm' ? 94320 : 1572
            );
            assert.equal(
                api.parseDurationInputSeconds('-1:01:20.125', format),
                -3680.125
            );
            assert.equal(api.parseDurationInputSeconds('abc', format), 0);
        }
        checks++;
    }
    return checks;
}
