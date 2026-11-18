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

// Pin the reproduced layout in the temporary npm consumer only.
export const splitDurationMomentInstall = {
    dependencies: { moment: '2.31.0' },
    overrides: { 'moment-timezone@0.5.45': { moment: '2.30.1' } },
};

export const splitDurationMomentConsumer = `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fromSdk = createRequire(require.resolve('@miniextensions/sdk/ui'));
const fromTimezone = createRequire(fromSdk.resolve('moment-timezone/package.json'));
const fromPlugin = createRequire(fromSdk.resolve('moment-duration-format/package.json'));
const timezoneMoment = fromTimezone('moment');
const pluginMoment = fromPlugin('moment');
assert.equal(timezoneMoment.version, '2.30.1');
assert.equal(pluginMoment.version, '2.31.0');
assert.notEqual(timezoneMoment, pluginMoment, 'Duration regression requires split Moment instances');

const hostMoment = require('host-moment');
assert.notEqual(hostMoment, pluginMoment);
require('host-moment/locale/fr');
assert.equal(hostMoment.locale('fr'), 'fr');
const hostFormatter = hostMoment.duration.fn.format;

const entry = process.argv[2] === 'esm'
    ? await import('@miniextensions/sdk/ui')
    : require('@miniextensions/sdk/ui');
let native = 7;
let writes = 0;
const model = entry.createDurationFieldModel({
    getValue: () => native,
    getDurationFormat: () => 'h:mm:ss.SSS',
    canEdit: () => true,
    isCurrent: () => true,
    write(value) {
        native = value;
        writes++;
        model.getState();
        return true;
    },
});
try {
    model.getState();
    assert.equal(model.setFocused(true), true);
    assert.equal(model.setInput('01:02.500'), true);
    assert.equal(model.setFocused(false), true);
    assert.equal(model.getState().input, '1:02.500');
    assert.equal(model.getState().valid, true);
    assert.equal(native, 62.5);
    assert.equal(writes, 1);
    assert.equal(hostMoment.locale(), 'fr');
    assert.equal(hostMoment.duration.fn.format, hostFormatter);
} finally {
    model.destroy();
}
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
