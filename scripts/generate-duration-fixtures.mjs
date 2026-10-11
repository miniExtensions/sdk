import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { format } from 'prettier';

// Maintainer-only regeneration. Ordinary CI consumes the committed fixture.
const checkout = process.argv[2];
assert(checkout, 'Supply the explicit authorized pinned canonical checkout.');
const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const git = (...args) =>
    execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), revision);
const sourcePaths = [
    'types/airtable/DurationField/helpers.ts',
    'types/utils/assertUnreachable.ts',
];
const sha = (value) => createHash('sha256').update(value).digest('hex');
const sources = sourcePaths.map((path) => {
    const source = readFileSync(resolve(checkout, path));
    assert.equal(
        source.toString(),
        execFileSync('git', ['show', `${revision}:${path}`], {
            cwd: checkout,
            encoding: 'utf8',
        }),
        `Pinned source drift: ${path}`
    );
    return { path, sha256: sha(source) };
});
const require = createRequire(import.meta.url);
const dependencies = {
    moment: require('moment/package.json').version,
    'moment-duration-format': require('moment-duration-format/package.json')
        .version,
};
assert.equal(dependencies.moment, '2.31.0');
assert.equal(dependencies['moment-duration-format'], '2.3.2');
const bundled = await build({
    entryPoints: [resolve(checkout, sourcePaths[0])],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['moment', 'moment-duration-format'],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
    require,
    module,
    module.exports
);
const canonical = module.exports;
const formats = ['h:mm', 'h:mm:ss', 'h:mm:ss.S', 'h:mm:ss.SS', 'h:mm:ss.SSS'];
// Admission is an explicit SDK editing contract, not a regex inferred from
// canonical's permissive filter. Canonical execution supplies every oracle.
const admitted = [
    ['clear', ''],
    ['zero', '0'],
    ['bare', '7'],
    ['negative-bare', '-7'],
    ['leading-zero', '0007'],
    ['bare-terminal-dot', '7.'],
    ['bare-decimal', '212.25'],
    ['negative-decimal', '-212.25'],
    ['bare-milliseconds', '2.123'],
    ['two-clock', '12:40'],
    ['negative-two-clock', '-12:40'],
    ['two-overflow', '25:72'],
    ['two-leading-zeros', '001:002'],
    ['three-clock', '1:02:03'],
    ['negative-three-clock', '-1:02:03.123'],
    ['three-terminal-dot', '1:02:03.'],
    ['three-leading-zeros', '001:002:003.004'],
    ['three-overflow', '25:72:75'],
];
const twoDecimals = [
    ['two-decimal', '1:2.5'],
    ['negative-two-decimal', '-1:2.125'],
    ['two-terminal-dot', '1:2.'],
];
const refused = [
    ['partial-sign', '-'],
    ['partial-colon', ':'],
    ['partial-two', '1:'],
    ['partial-three', '1:2:'],
    ['partial-dot', '.'],
    ['partial-negative-dot', '-.'],
    ['empty-component', '1::2'],
    ['extra-component', '1:2:3:4'],
    ['decimal-first-component', '1.2:3'],
    ['decimal-middle-component', '1:2.3:4'],
    ['plus', '+7'],
    ['exponent', '1e2'],
    ['whitespace', ' '],
    ['leading-whitespace', ' 7'],
    ['trailing-whitespace', '7 '],
    ['letters', 'abc'],
    ['excess-bare-fraction', '1.1234'],
    ['excess-clock-fraction', '1:2:3.1234'],
    ['nonfinite-magnitude', '9'.repeat(310)],
];
const inputCases = [];
for (const durationFormat of formats) {
    const add = ([name, input], admission) => {
        const result = {
            id: `${durationFormat}/${admission}/${name}`,
            durationFormat,
            input,
            admission,
            canonicalRawFilter: canonical.checkIfValueIsValidInput(input),
        };
        if (admission === 'admitted') {
            result.seconds = canonical.getNumberOfSeconds(
                input,
                durationFormat
            );
            assert(result.seconds === null || Number.isFinite(result.seconds));
            result.formattedInput = canonical.getFormattedDuration(
                input,
                durationFormat
            );
            result.formattedNative =
                result.seconds === null
                    ? ''
                    : canonical.getFormattedDuration(
                          String(result.seconds),
                          durationFormat,
                          true
                      );
        }
        inputCases.push(result);
    };
    admitted.forEach((item) => add(item, 'admitted'));
    twoDecimals.forEach((item) =>
        add(item, durationFormat === 'h:mm' ? 'refused' : 'admitted')
    );
    refused.forEach((item) => add(item, 'refused'));
}
const nativeCases = formats.flatMap((durationFormat) =>
    ['7', '2.123456789', '-3680.4', '-0.00001', '-0', '0', '10000000'].map(
        (secondsText) => ({
            id: `${durationFormat}/native/${secondsText}`,
            durationFormat,
            secondsText,
            formatted: canonical.getFormattedDuration(
                secondsText,
                durationFormat,
                true
            ),
        })
    )
);
const generator = 'scripts/generate-duration-fixtures.mjs';
writeFileSync(
    'test/fixtures/duration-input-canonical.json',
    await format(
        JSON.stringify({
            provenance: {
                revision,
                tree: git('rev-parse', 'HEAD^{tree}'),
                sources,
                generator,
                generatorSha256: sha(readFileSync(generator)),
                dependencies,
                execution:
                    'Unchanged pinned canonical duration helper bundled with esbuild; local pinned Moment dependencies; synthetic inputs only; no backend calls.',
                admission:
                    'Explicit complete SDK editing partitions: empty clears; bare digits with optional minus and final 0..3 decimal digits; two components forbid decimals for h:mm and allow final decimals otherwise; three components allow final decimals for all formats. Partial, malformed and nonfinite inputs are refused without consulting canonical coercion as acceptance authority.',
            },
            inputCases,
            nativeCases,
        }),
        { parser: 'json', tabWidth: 4 }
    )
);
console.log(
    `Executed ${inputCases.length} input and ${nativeCases.length} native canonical duration fixtures.`
);
