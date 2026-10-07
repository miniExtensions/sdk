import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { format } from 'prettier';
const checkout = process.argv[2];
assert(checkout, 'Supply authorized pinned canonical checkout.');
const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const git = (...args) =>
    execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), revision);
assert.equal(git('diff', 'HEAD', '--'), '');
const sourcePath = 'types/helpers/date-format.ts';
const source = readFileSync(resolve(checkout, sourcePath));
const bundled = await build({
    entryPoints: [resolve(checkout, sourcePath)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['moment-timezone'],
    plugins: [
        {
            name: 'canonical-type-and-english-adapters',
            setup(b) {
                b.onResolve(
                    { filter: /airtable\/types|i18n\/strings/ },
                    (args) => ({ path: args.path, namespace: 'adapter' })
                );
                b.onLoad({ filter: /.*/, namespace: 'adapter' }, (args) => ({
                    loader: 'js',
                    contents: args.path.includes('airtable')
                        ? 'export const AirtableFieldType={DATE:"date",DATE_TIME:"dateTime"};'
                        : 'export const getLocaleCodeForLanguage=()=>{throw Error("Only canonical default-English branch is tested")};',
                }));
            },
        },
    ],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports
);
const canonical = module.exports;
const formats = [
    ['local', 'l'],
    ['friendly', 'LL'],
    ['us', 'M/D/YYYY'],
    ['european', 'D/M/YYYY'],
    ['iso', 'YYYY-MM-DD'],
];
const times = [
    ['12hour', 'h:mma'],
    ['24hour', 'HH:mm'],
];
const oldTZ = process.env.TZ;
const cases = [];
for (const localZone of [
    'UTC',
    'America/Los_Angeles',
    'Asia/Kathmandu',
    'Pacific/Apia',
]) {
    process.env.TZ = localZone;
    createRequire(import.meta.url)('moment-timezone').tz.guess(true);
    for (const [name, format] of formats) {
        for (const value of ['2024-02-29', '2026-03-08', '2011-12-30']) {
            const config = {
                type: 'date',
                options: { dateFormat: { name, format } },
            };
            cases.push({
                localZone,
                value,
                config,
                expected: canonical.getFormattedTimeFieldValue({
                    airtableValue: value,
                    airtableFieldConfig: config,
                }),
                normalized:
                    localZone === 'Pacific/Apia' && value === '2011-12-30',
            });
        }
        for (const [timeName, timeFormat] of times)
            for (const zone of [
                'utc',
                'America/Los_Angeles',
                'Asia/Kathmandu',
                'client',
            ])
                for (const value of [
                    '2026-03-08T09:30:00.000Z',
                    '2026-03-08T10:30:00.000Z',
                    '2026-11-01T08:30:00.000Z',
                    '2026-11-01T09:30:00.000Z',
                    '2026-01-01T00:15:00+05:45',
                ]) {
                    const config = {
                        type: 'dateTime',
                        options: {
                            dateFormat: { name, format },
                            timeFormat: { name: timeName, format: timeFormat },
                            timeZone: zone,
                        },
                    };
                    cases.push({
                        localZone,
                        value,
                        config,
                        expected: canonical.getFormattedTimeFieldValue({
                            airtableValue: value,
                            airtableFieldConfig: config,
                        }),
                        normalized: false,
                    });
                }
    }
}
if (oldTZ === undefined) delete process.env.TZ;
else process.env.TZ = oldTZ;
const sha = (b) => createHash('sha256').update(b).digest('hex');
writeFileSync(
    'test/fixtures/reviewDates.json',
    await format(
        JSON.stringify({
            provenance: {
                revision,
                tree: git('rev-parse', 'HEAD^{tree}'),
                sourcePath,
                sourceSha256: sha(source),
                generator: 'scripts/generate-review-date-fixtures.mjs',
                generatorSha256: sha(
                    readFileSync('scripts/generate-review-date-fixtures.mjs')
                ),
                execution:
                    'Unchanged pinned formatting helper; enum discriminators and default-English-only language adapter; synthetic native strings, no backend',
            },
            cases,
        }),
        { parser: 'json', tabWidth: 4 }
    )
);
console.log(`Executed ${cases.length} pinned canonical date cases.`);
