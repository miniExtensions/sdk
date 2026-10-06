import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { format, resolveConfig } from 'prettier';

const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const checkout = process.argv[2];
assert(checkout, 'Supply the canonical monorepo checkout explicitly.');
assert.equal(
    execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: checkout,
        encoding: 'utf8',
    }).trim(),
    revision
);
const helper =
    'components/PublicExtension/helpers/getFormRecordWithFieldsRemovedIfHiddenByConditionalFields.ts';
const sources = [
    helper,
    'utils/isFieldHiddenByConditionalFields.ts',
    'types/extensions/conditions/convertConditionalFields.ts',
];
assert.equal(
    execFileSync('git', ['diff', 'HEAD', '--'], {
        cwd: checkout,
        encoding: 'utf8',
    }),
    '',
    'Canonical checkout must have no tracked modifications'
);
const tree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
    cwd: checkout,
    encoding: 'utf8',
}).trim();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const casesPath = resolve('test/fixtures/sectionProjectionCases.mjs');
const directory = mkdtempSync(join(tmpdir(), 'sdk-canonical-sections-'));
try {
    const outfile = join(directory, 'canonical.cjs');
    await build({
        stdin: {
            contents: `import { getFormRecordWithFieldsRemovedIfHiddenByConditionalFields as project } from ${JSON.stringify(resolve(checkout, helper))};\nimport { sectionProjectionCases } from ${JSON.stringify(casesPath)};\nconst cases = sectionProjectionCases.map(({name,input}) => { const result = project({ formRecord: {type:'edit',tableId:'tbl_synthetic',recordId:input.recordId,data:input.data}, airtableFields:input.airtableFields, linkedTableLoadingStates:{}, formFields:input.fieldIds.map(id=>input.fieldIdsToSchemas[id]), conditionalLinkedRecordFieldIdsToFilteringValues:{} }); return { name, input, expected: { hiddenFieldIds:result.hiddenFieldsFromConditionalFields, record:{id:input.recordId,fields:result.formRecordWithoutHiddenConditionalFields.data} } }; }); console.log(JSON.stringify(cases));`,
            resolveDir: resolve(checkout),
            loader: 'ts',
        },
        absWorkingDir: resolve(checkout),
        tsconfig: resolve(checkout, 'tsconfig.json'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile,
        logLevel: 'silent',
    });
    const cases = JSON.parse(
        execFileSync(process.execPath, [outfile], { encoding: 'utf8' })
    );
    const fixture = {
        provenance: {
            revision,
            tree,
            generatorSha256: hash(
                readFileSync('scripts/generate-section-projection-fixtures.mjs')
            ),
            helper,
            sources: Object.fromEntries(
                sources.map((path) => [
                    path,
                    hash(readFileSync(resolve(checkout, path))),
                ])
            ),
            casesSourceSha256: hash(readFileSync(casesPath)),
            generator: 'scripts/generate-section-projection-fixtures.mjs',
            execution:
                'pinned canonical helper, edit record, empty linked state and filter map',
        },
        cases,
    };
    writeFileSync(
        'test/fixtures/sectionProjection.json',
        await format(JSON.stringify(fixture), {
            ...(await resolveConfig('test/fixtures/sectionProjection.json')),
            parser: 'json',
        })
    );
    console.log(
        `Executed canonical ${revision}: ${cases.length} supported fixtures`
    );
} finally {
    rmSync(directory, { recursive: true, force: true });
}
