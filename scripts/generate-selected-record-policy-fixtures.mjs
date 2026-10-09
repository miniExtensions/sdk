import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { build } from 'esbuild';
import { format } from 'prettier';
import ts from 'typescript';

const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const checkout = process.argv[2];
assert(checkout, 'Supply the authorized pinned canonical checkout explicitly.');
const git = (...args) =>
    execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), revision);
assert.equal(git('diff', 'HEAD', '--'), '');
const fastSortVersion = JSON.parse(
    readFileSync(
        resolve(checkout, 'node_modules/fast-sort/package.json'),
        'utf8'
    )
).version;
assert.equal(
    fastSortVersion,
    '3.4.0',
    'Use the pinned canonical fast-sort version.'
);
const helper = 'components/PublicExtension/redux/helpers.ts';
const sources = [
    helper,
    'types/extensions/linkedRecordsFieldTypes.ts',
    'types/extensions/sorting/utils.ts',
    'types/extensions/conditions/convertConditionalFields.ts',
    'types/airtableMock/formulas/index.ts',
    'types/helpers/getAirtableFieldsFromConditions.ts',
    'types/extensions/conditions/helpers.ts',
    'types/airtable/getReadableStringFromAirtableValue.ts',
];
const sf = ts.createSourceFile(
    helper,
    readFileSync(resolve(checkout, helper), 'utf8'),
    ts.ScriptTarget.Latest,
    true
);
function extract(name) {
    const found = [];
    function visit(node) {
        if (
            ts.isVariableStatement(node) &&
            node.declarationList.declarations.some(
                (d) => ts.isIdentifier(d.name) && d.name.text === name
            )
        )
            found.push(node.getText(sf));
        ts.forEachChild(node, visit);
    }
    visit(sf);
    assert.equal(found.length, 1, `Unique canonical declaration: ${name}`);
    return found[0];
}
const declarations = [
    'getRecordsIdsAfterFilterAndSorting',
    'getSortFields',
].map(extract);
const field = (id, type, options = null) => ({
    id: `fld_${id}`,
    name: id,
    description: null,
    isComputed: false,
    isPrimaryField: id === 'text',
    config: { type, options },
});
const fields = [
    field('text', 'singleLineText'),
    field('number', 'number', { precision: 0 }),
    field('single', 'singleSelect', {
        choices: [
            { id: 'sel_z', name: 'Zulu' },
            { id: 'sel_a', name: 'Alpha' },
        ],
    }),
    field('multi', 'multipleSelects', {
        choices: [
            { id: 'sel_z', name: 'Zulu' },
            { id: 'sel_a', name: 'Alpha' },
        ],
    }),
    field('check', 'checkbox'),
];
const choice = (name) => name;
const records = [
    {
        id: 'rec_b',
        fields: {
            fld_text: 'item 10',
            fld_number: 2,
            fld_single: choice('Alpha'),
            fld_multi: [choice('Alpha')],
            fld_check: true,
        },
    },
    {
        id: 'rec_a',
        fields: {
            fld_text: 'Item 2',
            fld_number: 2,
            fld_single: choice('Zulu'),
            fld_multi: [choice('Zulu'), choice('Alpha')],
            fld_check: true,
        },
    },
    {
        id: 'rec_c',
        fields: {
            fld_text: 'item 2',
            fld_number: 1,
            fld_single: choice('Zulu'),
            fld_multi: [choice('Zulu')],
            fld_check: false,
        },
    },
    {
        id: 'rec_null',
        fields: {
            fld_text: null,
            fld_number: null,
            fld_single: null,
            fld_multi: null,
            fld_check: null,
        },
    },
    {
        id: 'rec_tie',
        fields: {
            fld_text: 'ITEM 2',
            fld_number: 2,
            fld_single: choice('Zulu'),
            fld_multi: [choice('Zulu'), choice('Alpha')],
            fld_check: true,
        },
    },
];
const recordIds = ['rec_b', 'rec_a', 'rec_null', 'rec_c', 'rec_a', 'rec_tie'];
const condition = (id, fieldType, type, value) => ({
    logicalOperator: 'and',
    conditions: [
        {
            id: 'condition_one',
            type: 'singleCondition',
            setting: {
                type,
                fieldType,
                idOrName: { type: 'id', id: `fld_${id}` },
                ...(['isEmpty', 'isNotEmpty'].includes(type) ? {} : { value }),
            },
        },
    ],
});
const numeric = condition('number', 'number', 'greaterThan', 1);
const sort = (id, type = 'asc') => ({
    idOrName: { type: 'id', id: `fld_${id}` },
    type,
});
const cases = [];
const add = (name, config, ids = recordIds) =>
    cases.push({ name, input: { fields, records, recordIds: ids, config } });
add('no config preserves native occurrences', null);
add('empty config preserves native occurrences', {});
for (const toggle of ['absent', null, true, false])
    for (const mode of ['absent', 'record-finder-only', 'selected-records'])
        add(`toggle ${toggle} mode ${mode}`, {
            filterLinkedRecordsConditionFields: numeric,
            ...(toggle === 'absent'
                ? {}
                : { filterLinkedRecordsToggle: toggle }),
            ...(mode === 'absent' ? {} : { filterApplicationMode: mode }),
        });
add('null conditions', { filterLinkedRecordsConditionFields: null });
add('filter missing records', { filterLinkedRecordsConditionFields: numeric }, [
    ...recordIds,
    'rec_missing',
]);
for (const id of ['text', 'number', 'single', 'multi', 'check'])
    for (const direction of ['asc', 'desc'])
        add(`${id} ${direction} nulls ties duplicates`, {
            sortFields: [sort(id, direction)],
        });
add('multiple keys and stable ties', {
    sortFields: [sort('number', 'desc'), sort('text'), sort('single', 'desc')],
});
add('filter before multiple sort keys', {
    filterLinkedRecordsConditionFields: numeric,
    sortFields: [sort('single'), sort('text', 'desc')],
});
add('disabled filter still sorts', {
    filterLinkedRecordsToggle: false,
    filterLinkedRecordsConditionFields: numeric,
    sortFields: [sort('number')],
});
add('finder only still sorts selected records', {
    filterApplicationMode: 'record-finder-only',
    filterLinkedRecordsConditionFields: numeric,
    sortFields: [sort('single')],
});
add('single select filter and configured choice sort', {
    filterLinkedRecordsConditionFields: condition(
        'single',
        'singleSelect',
        'is',
        'sel_z'
    ),
    sortFields: [sort('multi')],
});
add('multiple select filter and configured choice sort', {
    filterLinkedRecordsConditionFields: condition(
        'multi',
        'multipleSelects',
        'hasAnyOf',
        ['sel_a']
    ),
    sortFields: [sort('single')],
});
add('empty values filter', {
    filterLinkedRecordsConditionFields: condition(
        'text',
        'singleLineText',
        'isEmpty'
    ),
});
add('checkbox filter', {
    filterLinkedRecordsConditionFields: condition(
        'check',
        'checkbox',
        'is',
        true
    ),
});
const directory = mkdtempSync(join(tmpdir(), 'sdk-canonical-selected-'));
try {
    const outfile = join(directory, 'canonical.cjs');
    const imports =
        `import FormulaRunner from ${JSON.stringify(resolve(checkout, sources[4]))};\n` +
        [
            [
                'getActiveFilterLinkedRecordsConditionFields, isLinkedRecordFilterAppliedToSelectedRecords',
                sources[1],
            ],
            ['sortAirtableRecordsWithSortFields', sources[2]],
            ['convertConditionFieldsToFormula', sources[3]],
            ['getAirtableFieldsFromConditions', sources[5]],
            ['getFlatConditionsFromDefinition', sources[6]],
            ['convertAirtableValueToPrimitive', sources[7]],
            [
                'readOnlyFieldId',
                'types/extensions/miniExt-field-configs/fields.ts',
            ],
            [
                'sortFieldsFieldId',
                'types/extensions/miniExt-field-configs/linkedRecordsFieldSections.ts',
            ],
        ]
            .map(
                ([names, path]) =>
                    `import {${names}} from ${JSON.stringify(resolve(checkout, path))};`
            )
            .join('\n');
    // The two declarations are unchanged canonical source. Calendar helpers are
    // unreachable: every generated case asserts the explicitly supported scope.
    for (const c of cases)
        assert.notEqual(c.input.config?.recordFinderMode, 'calendar');
    const result = await build({
        stdin: {
            contents: `${imports}\n${declarations.join('\n')}\nconst cases=${JSON.stringify(cases)};console.log(JSON.stringify(cases.map(({name,input})=>{const activeFilter=getActiveFilterLinkedRecordsConditionFields(input.config);return {name,input,expected:{recordIds:getRecordsIdsAfterFilterAndSorting({recordLinksMiniExtConfig:input.config,recordLinksValue:input.recordIds,recordIdsToAirtableRecords:Object.fromEntries(input.records.map(r=>[r.id,r])),fieldNamesToAirtableFields:Object.fromEntries(input.fields.map(f=>[f.name,f])),linkedTableLoadingStates:{},isForAlreadySelectedRecords:true}),activeFilter,filterAppliedToSelectedRecords:input.config?isLinkedRecordFilterAppliedToSelectedRecords(input.config):false,formula:activeFilter?convertConditionFieldsToFormula(activeFilter,input.fields):null}};})));`,
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
        metafile: true,
    });
    const preload = join(directory, 'frontend.cjs');
    writeFileSync(preload, 'globalThis.window = {};');
    const outputs = JSON.parse(
        execFileSync(process.execPath, ['--require', preload, outfile], {
            encoding: 'utf8',
        })
    );
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    const executedSources = [
        ...new Set([
            ...sources,
            ...Object.keys(result.metafile.inputs)
                .filter((p) => p !== '<stdin>' && !p.includes('node_modules'))
                .map((p) => relative(resolve(checkout), resolve(checkout, p))),
        ]),
    ].sort();
    const fixture = {
        provenance: {
            revision,
            tree: git('rev-parse', 'HEAD^{tree}'),
            generator: 'scripts/generate-selected-record-policy-fixtures.mjs',
            generatorSha256: hash(
                readFileSync(
                    'scripts/generate-selected-record-policy-fixtures.mjs'
                )
            ),
            sources: Object.fromEntries(
                executedSources.map((p) => [
                    p,
                    hash(readFileSync(resolve(checkout, p))),
                ])
            ),
            extractedDeclarations: [
                'getRecordsIdsAfterFilterAndSorting',
                'getSortFields',
            ],
            execution:
                'Unchanged AST-extracted canonical declarations with canonical toggle/mode, compiler, FormulaRunner, primitive conversion and fast-sort dependencies; selected records, synthetic direct scalar/select values, empty linked state, synthetic window global for canonical frontend assertion; no calendar, nested/computed/date fields or child exemptions',
            dependencies: { 'fast-sort': fastSortVersion },
        },
        cases: outputs,
    };
    writeFileSync(
        'test/fixtures/selected-record-policy.json',
        await format(JSON.stringify(fixture), { parser: 'json', tabWidth: 4 })
    );
    console.log(
        `Executed canonical selected-record policy fixtures: ${outputs.length}`
    );
} finally {
    rmSync(directory, { recursive: true, force: true });
}
