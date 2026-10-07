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
assert(checkout, 'Supply the authorized pinned canonical checkout.');
const git = (...args) =>
    execFileSync('git', args, { cwd: checkout, encoding: 'utf8' }).trim();
assert.equal(git('rev-parse', 'HEAD'), revision);
assert.equal(git('diff', 'HEAD', '--'), '');
const sources = [
    'types/extensions/conditions/convertConditionalFields.ts',
    'utils/formatMultiSelectValue.ts',
];
const cases = [];
for (const type of ['singleSelect', 'multipleSelects']) {
    const operators =
        type === 'singleSelect'
            ? ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty']
            : [
                  'hasAnyOf',
                  'hasAllOf',
                  'hasNoneOf',
                  'isExactly',
                  'isEmpty',
                  'isNotEmpty',
              ];
    for (const name of [
        'Normal',
        'comma, value',
        'double "quote"',
        "single 'quote'",
        'back\\slash',
        'literal\\n',
        'actual\nnewline',
        'regex [a].*+-?',
        'emoji 🦋',
    ]) {
        const field = {
            id: 'fld_choice',
            name: 'Choice',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: {
                type,
                options: {
                    choices: [
                        { id: 'sel_a', name },
                        { id: 'sel_b', name: 'Other' },
                    ],
                },
            },
        };
        for (const operator of operators)
            for (const kind of ['known', 'unknown', 'partial', 'duplicate']) {
                const value = ['is', 'isNot'].includes(operator)
                    ? kind === 'unknown'
                        ? 'deleted'
                        : 'sel_a'
                    : kind === 'unknown'
                      ? ['deleted']
                      : kind === 'partial'
                        ? ['sel_a', 'deleted']
                        : kind === 'duplicate'
                          ? ['sel_a', 'sel_a', 'sel_b']
                          : ['sel_a', 'sel_b'];
                const conditions = {
                    logicalOperator: 'and',
                    conditions: [
                        {
                            id: 'one',
                            type: 'singleCondition',
                            setting: {
                                type: operator,
                                fieldType: type,
                                idOrName: { type: 'id', id: field.id },
                                ...(['isEmpty', 'isNotEmpty'].includes(operator)
                                    ? {}
                                    : { value }),
                            },
                        },
                    ],
                };
                cases.push({
                    name: `${type}/${operator}/${name}/${kind}`,
                    field,
                    conditions,
                });
            }
    }
}
const dir = mkdtempSync(join(tmpdir(), 'sdk-canonical-select-'));
try {
    const outfile = join(dir, 'canonical.cjs');
    await build({
        stdin: {
            contents: `import {convertConditionFieldsToFormula as compile} from ${JSON.stringify(resolve(checkout, sources[0]))}; import {formatMultiSelectValue as serialize} from ${JSON.stringify(resolve(checkout, sources[1]))}; const cases=${JSON.stringify(cases)}; console.log(JSON.stringify(cases.map(input=>({input,formula:compile(input.conditions,[input.field],{failClosedOnInvalidCondition:true}),serialized:input.field.config.options.choices.map(c=>serialize(c.name)).join(', ')}))));`,
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
            generator: 'scripts/generate-select-condition-fixtures.mjs',
            generatorSha256: hash(
                readFileSync('scripts/generate-select-condition-fixtures.mjs')
            ),
            sources: Object.fromEntries(
                sources.map((p) => [
                    p,
                    hash(readFileSync(resolve(checkout, p))),
                ])
            ),
            execution:
                'Unchanged pinned canonical converter and native multi-select serializer; synthetic metadata and operands only',
        },
        cases: outputs,
    };
    writeFileSync(
        'test/fixtures/selectConditions.json',
        await format(JSON.stringify(fixture), { parser: 'json', tabWidth: 4 })
    );
    console.log('Executed canonical select fixtures:', outputs.length);
} finally {
    rmSync(dir, { recursive: true, force: true });
}
