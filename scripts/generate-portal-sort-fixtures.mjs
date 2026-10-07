import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { format } from 'prettier';

const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const checkout = process.argv[2];
assert(checkout, 'Supply the canonical monorepo checkout explicitly.');
const git = (...args) =>
    execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), revision);
assert.equal(
    git('diff', 'HEAD', '--'),
    '',
    'Canonical checkout must be unchanged'
);
const sources = [
    'components/Fields/FieldRenderer/LinkedRecordsField/getAllowedSortAirtableFields.ts',
    'helpers/getOverriddenMiniExtConfig.ts',
    'types/extensions/miniExt-field-configs/linkedRecordsFieldSections.ts',
    'types/airtable/helpers.ts',
];
const fields = ['title', 'quantity'].map((name, index) => ({
    id: `fld_${name}`,
    name,
    description: null,
    isComputed: false,
    isPrimaryField: index === 0,
    config: {
        type: index === 0 ? 'singleLineText' : 'number',
        options: index === 0 ? null : { precision: 0 },
    },
}));
const inputs = [
    { name: 'null restriction', root: { sortingOnExtensionFields: null } },
    { name: 'empty restriction', root: { sortingOnExtensionFields: [] } },
    {
        name: 'one allowed field',
        root: { sortingOnExtensionFields: ['fld_quantity'] },
    },
    { name: 'all stale', root: { sortingOnExtensionFields: ['fld_stale'] } },
    {
        name: 'custom omitted replacement',
        root: {
            hideSortButtonForPortal: true,
            sortingOnExtensionFields: ['fld_stale'],
            customPrimaryField: 'fld_quantity',
        },
        view: { viewBehavior: 'custom', layout: 'grid' },
    },
    {
        name: 'custom explicit restriction',
        root: { sortingOnExtensionFields: ['fld_title'] },
        view: {
            viewBehavior: 'custom',
            layout: 'list',
            sortingOnExtensionFields: ['fld_quantity'],
        },
    },
    {
        name: 'default view retains root',
        root: { sortingOnExtensionFields: ['fld_quantity'] },
        view: { viewBehavior: 'default' },
    },
    {
        name: 'custom hidden',
        root: {},
        view: { viewBehavior: 'custom', hideSortButtonForPortal: true },
    },
].map((input) => ({ ...input, fields }));
const directory = mkdtempSync(join(tmpdir(), 'sdk-canonical-sort-'));
try {
    const outfile = join(directory, 'canonical.cjs');
    await build({
        stdin: {
            contents: `import { getAllowedSortAirtableFields as allowed } from ${JSON.stringify(resolve(checkout, sources[0]))};import { getOverriddenMiniExtConfig as override } from ${JSON.stringify(resolve(checkout, sources[1]))};const cases=${JSON.stringify(inputs)};console.log(JSON.stringify(cases.map(input=>{const config=override({miniExtConfig:input.root,selectedCustomView:input.view?{id:'view_example',config:input.view}:null});return {input,expected:{fieldIds:allowed({airtableFields:input.fields,sortingOnExtensionFieldIds:config.sortingOnExtensionFields??null}).map(f=>f.id),hidden:config.hideSortButtonForPortal===true,config:Object.fromEntries(['sortingOnExtensionFields','hideSortButtonForPortal','customPrimaryField'].filter(k=>config[k]!==undefined).map(k=>[k,config[k]]))}};})));`,
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
    const hash = (b) => createHash('sha256').update(b).digest('hex');
    const fixture = {
        provenance: {
            revision,
            tree: git('rev-parse', 'HEAD^{tree}'),
            generator: 'scripts/generate-portal-sort-fixtures.mjs',
            generatorSha256: hash(
                readFileSync('scripts/generate-portal-sort-fixtures.mjs')
            ),
            sources: Object.fromEntries(
                sources.map((path) => [
                    path,
                    hash(readFileSync(resolve(checkout, path))),
                ])
            ),
            execution:
                'actual pinned canonical sort-list and custom-view override helpers; no backend reads',
        },
        cases,
    };
    writeFileSync(
        'test/fixtures/portalSort.json',
        await format(JSON.stringify(fixture), { parser: 'json', tabWidth: 4 })
    );
    console.log(
        `Executed canonical ${revision}: ${cases.length} sort fixtures`
    );
} finally {
    rmSync(directory, { recursive: true, force: true });
}
