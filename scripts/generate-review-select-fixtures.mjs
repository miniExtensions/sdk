import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';
import { format } from 'prettier';

const checkout = process.argv[2];
assert(checkout, 'Supply the pinned canonical checkout explicitly.');
const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const git = (...args) =>
    execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), revision);
assert.equal(git('diff', 'HEAD', '--'), '');
const sourcePath =
    'components/Fields/FieldRenderer/SelectField/optionPresentation.ts';
const source = readFileSync(resolve(checkout, sourcePath));
// Execute the actual helper with type-only imports erased. No policy reimplementation.
const transformed = await transform(source.toString(), {
    loader: 'ts',
    format: 'esm',
});
const canonical = await import(
    'data:text/javascript;base64,' +
        Buffer.from(transformed.code).toString('base64')
);
const choices = [
    { id: 'one', name: 'First' },
    { id: 'two', name: 'Second' },
];
const cases = [];
for (const config of [
    {},
    {
        enableConditionalOptions: false,
        conditionsForOptions: [
            { config: { optionForConditions: 'one', name: 'Changed' } },
        ],
    },
    {
        enableConditionalOptions: true,
        conditionsForOptions: [
            { config: { optionForConditions: 'one', name: '  Label  ' } },
        ],
    },
    {
        enableConditionalOptions: true,
        conditionsForOptions: [
            { config: { optionForConditions: 'one', name: '' } },
        ],
    },
    {
        enableConditionalOptions: true,
        conditionsForOptions: [
            { config: { optionForConditions: 'one', name: 'Same' } },
            { config: { optionForConditions: 'two', name: 'Same' } },
        ],
    },
])
    cases.push({
        choices,
        config,
        expected: canonical.makeSelectOptionPresentations({
            choices,
            miniExtFieldConfig: config,
        }),
    });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixture = {
    provenance: {
        revision,
        tree: git('rev-parse', 'HEAD^{tree}'),
        sourcePath,
        sourceSHA256: sha(source),
        generator: 'scripts/generate-review-select-fixtures.mjs',
        generatorSHA256: sha(
            readFileSync('scripts/generate-review-select-fixtures.mjs')
        ),
    },
    cases,
    unknown:
        canonical.makeUnavailableSelectOptionPresentation('<b>Unknown</b>'),
};
writeFileSync(
    'test/fixtures/reviewSelect.json',
    await format(JSON.stringify(fixture), { parser: 'json', tabWidth: 4 })
);
console.log(
    `Executed ${cases.length} canonical presentation cases and unknown fallback at ${revision}.`
);
