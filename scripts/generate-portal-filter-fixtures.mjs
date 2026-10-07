import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { format } from 'prettier';
import ts from 'typescript';
const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const checkout = process.argv[2];
assert(checkout, 'Supply the pinned canonical checkout explicitly.');
const git = (...a) =>
    execFileSync('git', a, { cwd: checkout, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), revision);
assert.equal(git('diff', 'HEAD', '--'), '');
const sources = [
    'types/extensions/conditions/portalEndUserFilters.ts',
    'types/extensions/conditions/convertConditionalFields.ts',
    'types/extensions/conditions/helpers.ts',
    'helpers/getOverriddenMiniExtConfig.ts',
    'types/extensions/miniExt-field-configs/linkedRecordsFieldSections.ts',
    'backend-src/v1/handlers/fetchRecordsForLinkedTableOnPortal/index.ts',
];
// Extract the actual finite enablement expression structurally, not by text matching.
const sf = ts.createSourceFile(
    sources[5],
    readFileSync(resolve(checkout, sources[5]), 'utf8'),
    ts.ScriptTarget.Latest,
    true
);
const expressions = [];
function visit(n) {
    if (
        ts.isVariableDeclaration(n) &&
        ts.isIdentifier(n.name) &&
        n.name.text === 'isFilteringEnabled'
    )
        expressions.push(n.initializer.getText(sf));
    ts.forEachChild(n, visit);
}
visit(sf);
assert.equal(expressions.length, 1);
const texts = [
    'singleLineText',
    'email',
    'url',
    'multilineText',
    'phoneNumber',
    'barcode',
    'richText',
];
const numbers = ['number', 'percent', 'currency', 'rating'];
const pairs = {
    is: [...texts.filter((t) => t !== 'richText'), 'checkbox'],
    isNot: texts.filter((t) => t !== 'richText'),
    contains: texts,
    doesNotContain: texts,
    matchesRegex: texts,
    isOfLength: texts,
    isEmpty: [...texts, ...numbers],
    isNotEmpty: [...texts, ...numbers],
    equals: numbers,
    notEquals: numbers,
    greaterThan: numbers,
    lessThan: numbers,
    greaterThanOrEqualsTo: numbers,
    lessThanOrEqualsTo: numbers,
};
const field = (type) => ({
    id: 'fld_value',
    name: 'Value',
    description: null,
    isComputed: false,
    isPrimaryField: true,
    config: { type, options: null },
});
const make = (type, operator, value) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'filter_one',
            type: 'singleCondition',
            setting: {
                type: operator,
                fieldType: type,
                idOrName: { type: 'id', id: 'fld_value' },
                ...(['isEmpty', 'isNotEmpty'].includes(operator)
                    ? {}
                    : { value }),
            },
        },
    ],
});
const cases = [];
for (const [operator, types] of Object.entries(pairs))
    for (const type of types) {
        const value =
            operator === 'isOfLength'
                ? -0.5
                : numbers.includes(type)
                  ? 25
                  : type === 'checkbox'
                    ? false
                    : "Exact 'quoted' bytes";
        cases.push({
            name: type + ' ' + operator,
            field: field(type),
            conditions: make(type, operator, value),
        });
    }
for (const [op, v] of [
    ['is', ''],
    ['isNot', ''],
    ['contains', ''],
    ['doesNotContain', ''],
    ['matchesRegex', ''],
    ['matchesRegex', '['],
    ['isOfLength', -2.5],
])
    cases.push({
        name: 'boundary ' + op + ' ' + JSON.stringify(v),
        field: field('singleLineText'),
        conditions: make('singleLineText', op, v),
    });
for (const mode of [
    'missing',
    'type-changed',
    'not-allowed',
    'name-reference',
    'empty-id',
]) {
    const conditions = make('number', 'equals', 25);
    if (mode === 'type-changed')
        conditions.conditions[0].setting.fieldType = 'singleLineText';
    if (mode === 'name-reference')
        conditions.conditions[0].setting.idOrName = {
            type: 'name',
            name: 'Value',
        };
    if (mode === 'empty-id') conditions.conditions[0].id = '';
    cases.push({ name: mode, field: field('number'), conditions, mode });
}
const settings = [];
for (const scope of ['root', 'custom', 'omitted-config'])
    for (const kind of ['absent', 'undefined', 'null', 'true', 'false'])
        settings.push({ scope, kind });
const directory = mkdtempSync(join(tmpdir(), 'sdk-canonical-filter-'));
try {
    const outfile = join(directory, 'canonical.cjs');
    await build({
        stdin: {
            contents: `import { normalizePortalEndUserFilters as normalize, getPortalEndUserFilterAllowedFieldIds as allowed } from ${JSON.stringify(resolve(checkout, sources[0]))};import { convertConditionFieldsToFormula as compile } from ${JSON.stringify(resolve(checkout, sources[1]))};import { getOverriddenMiniExtConfig as override } from ${JSON.stringify(resolve(checkout, sources[3]))};const disableFilteringOnExtensionFieldId='disableFilteringOnExtension';const cases=${JSON.stringify(cases)};const settings=${JSON.stringify(settings)};console.log(JSON.stringify({cases:cases.map(input=>{const fields=input.mode==='missing'?[]:[input.field];const ids=allowed({allFields:fields,visibleFieldIds:input.mode==='not-allowed'?[]:['fld_value'],dropdownFilterFieldIds:[]});const result=normalize({filters:input.conditions,allFields:fields,allowedFieldIds:ids});return {input,expected:{...result,formula:result.filters?compile(result.filters,fields,{failClosedOnInvalidCondition:true}):null,allowedIds:[...ids]}};}),settings:settings.map(input=>{const root={};if(input.kind!=='absent')root.disableFilteringOnExtension=input.kind==='undefined'?undefined:JSON.parse(input.kind);const selected=input.scope==='custom'?{id:'view_example',config:{viewBehavior:'custom',...root}}:input.scope==='omitted-config'?{id:'view_example'}:null;const overriddenMiniExtConfig=override({miniExtConfig:input.scope==='custom'?{}:root,selectedCustomView:selected});return {input,enabled:(${expressions[0]}),hasKey:Object.hasOwn(overriddenMiniExtConfig,disableFilteringOnExtensionFieldId)};})}));`,
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
    const outputs = JSON.parse(
        execFileSync(process.execPath, [outfile], { encoding: 'utf8' })
    );
    const hash = (b) => createHash('sha256').update(b).digest('hex');
    const fixture = {
        provenance: {
            revision,
            tree: git('rev-parse', 'HEAD^{tree}'),
            generator: 'scripts/generate-portal-filter-fixtures.mjs',
            generatorSha256: hash(
                readFileSync('scripts/generate-portal-filter-fixtures.mjs')
            ),
            sources: Object.fromEntries(
                sources.map((p) => [
                    p,
                    hash(readFileSync(resolve(checkout, p))),
                ])
            ),
            enablementExpression: expressions[0],
            execution:
                'Pinned canonical normalization, allowed-field, formula and override helpers; AST-selected canonical enablement expression; synthetic inputs only',
        },
        ...outputs,
    };
    writeFileSync(
        'test/fixtures/portalFilter.json',
        await format(JSON.stringify(fixture), { parser: 'json', tabWidth: 4 })
    );
    console.log(
        'Executed canonical filter fixtures',
        outputs.cases.length,
        outputs.settings.length
    );
} finally {
    rmSync(directory, { recursive: true, force: true });
}
