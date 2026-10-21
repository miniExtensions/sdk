import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const formulaCompatibilityTypedConsumer = `
import formulaHostMoment from 'host-moment';
import {
    FormulaRunner as HostedFormulaRunner, Interpreter as HostedInterpreter,
    Identifier as HostedIdentifier, type FormulaInterpreterOptions as HostedInterpreterOptions,
    type FormulaDateRuntime as HostedDateRuntime, type FormulaDateValue as HostedDateValue,
    type FormulaFieldReferenceResolution as HostedFieldResolution,
} from '@miniextensions/sdk/formulas';
const formulaHostDateRuntime:HostedDateRuntime=formulaHostMoment;
const formulaHostDateValue:HostedDateValue=formulaHostMoment.utc('2026-05-04');
const formulaHostField:HostedFieldResolution={nativeValue:3,toPrimitive:()=>3};
const formulaHostOptions:HostedInterpreterOptions={legacyRuntime:true,dateRuntime:formulaHostDateRuntime,resolveFieldReference:()=>formulaHostField};
const formulaHostRunner=new HostedFormulaRunner('{Native}+1',false,formulaHostOptions);
const formulaHostInterpreter=new HostedInterpreter(new HostedIdentifier('Native'),true,formulaHostOptions);
void [formulaHostRunner.run(),formulaHostRunner.runWithOutcome(),formulaHostInterpreter.executeWithOutcome(),formulaHostDateValue.clone().startOf('day')];
// @ts-expect-error compatibility is explicitly selected; omission keeps defaults
new HostedFormulaRunner('1',false,{legacyRuntime:false});
// @ts-expect-error primitive conversion must return a captured value synchronously
new HostedFormulaRunner('1',false,{resolveFieldReference:()=>({nativeValue:1,toPrimitive:async()=>1})});
`;

/** Public installed exports; separate Moment versions model a real host. */
export async function checkFormulaCompatibilityConsumer({ consumerDirectory }) {
    const consumer = createRequire(join(consumerDirectory, 'package.json'));
    const hostMoment = consumer('host-moment');
    consumer('host-moment/locale/fr.js');
    const sdkMoment = consumer('moment');
    assert.equal(hostMoment.version, '2.30.1');
    assert.equal(sdkMoment.version, '2.31.0');
    assert.notEqual(hostMoment, sdkMoment);
    const esm = await import(
        pathToFileURL(
            join(
                consumerDirectory,
                'node_modules/@miniextensions/sdk/dist/esm/formulas/index.js'
            )
        ).href
    );
    const previousLocale = hostMoment.locale();
    let formats = 0;
    try {
        for (const api of [esm, consumer('@miniextensions/sdk/formulas')]) {
            const formula = 'DATETIME_FORMAT("2026-05-04", "MMMM")';
            const defaultRunner = new api.FormulaRunner(formula);
            const defaultMonth = defaultRunner.run();
            const dateRuntime = Object.assign(
                () => hostMoment.utc('2026-05-04T12:00:00Z').utcOffset(840),
                {
                    utc: (...args) => hostMoment.utc(...args),
                }
            );
            const compatible = new api.FormulaRunner(formula, false, {
                legacyRuntime: true,
                dateRuntime,
            });
            for (const [locale, month] of [
                ['fr', 'mai'],
                ['en', 'May'],
                ['fr', 'mai'],
            ]) {
                hostMoment.locale(locale);
                assert.equal(compatible.run(), month);
                assert.deepEqual(compatible.runWithOutcome(), {
                    type: 'value',
                    value: month,
                });
                assert.equal(defaultRunner.run(), defaultMonth);
            }
            assert.equal(
                new api.FormulaRunner('TODAY()', false, {
                    legacyRuntime: true,
                    dateRuntime,
                }).run(),
                '2026-05-05'
            );
            assert.equal(
                new api.FormulaRunner('(1/0)+1').run(),
                api.AIRTABLE_FORMULA_ERROR_VALUE
            );
            const permissive = new api.FormulaRunner('(1/0)+1', false, {
                legacyRuntime: true,
            });
            assert.equal(permissive.run(), Infinity);
            assert.deepEqual(permissive.runWithOutcome(), {
                type: 'error',
                code: 'non-finite-result',
            });
            assert.equal(permissive.run(), Infinity);
            let reads = 0;
            let conversions = 0;
            const cells = {
                get Native() {
                    reads++;
                    return reads === 1
                        ? { error: '#ERROR!' }
                        : 'A second read would lose fault provenance';
                },
            };
            const native = new api.FormulaRunner('{Native}', false, {
                legacyRuntime: true,
                resolveFieldReference: () => {
                    const nativeValue = cells.Native;
                    return {
                        nativeValue,
                        toPrimitive: () => {
                            conversions++;
                            return '#ERROR!';
                        },
                    };
                },
            });
            assert.deepEqual(native.runWithOutcome(), {
                type: 'error',
                code: 'runtime-error',
            });
            assert.equal(reads, 1);
            assert.equal(conversions, 0);
            reads = 0;
            assert.equal(native.run(), '#ERROR!');
            assert.equal(reads, 1);
            assert.equal(conversions, 1);
            formats++;
        }
    } finally {
        hostMoment.locale(previousLocale);
    }
    return formats;
}
