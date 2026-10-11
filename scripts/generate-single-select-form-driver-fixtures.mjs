import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { format, resolveConfig } from 'prettier';

const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const tree = 'b39e58ead46a311c497def57474cf5ca720542ae';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generator = 'scripts/generate-single-select-form-driver-fixtures.mjs';
const casesSource = 'test/fixtures/singleSelectFormDriverCases.mjs';
const fixturePath = join(root, 'test/fixtures/singleSelectFormDrivers.json');
const sources = {
    projection:
        'components/PublicExtension/helpers/getFormRecordWithFieldsRemovedIfHiddenByConditionalFields.ts',
    conditionRecord: 'utils/isFieldHiddenByConditionalFields.ts',
    converter: 'types/extensions/conditions/convertConditionalFields.ts',
    formulaRunner: 'types/airtableMock/formulas/index.ts',
    interpreter: 'types/airtableMock/formulas/interpreter/interpreter.ts',
    validation: 'components/PublicExtension/helpers/form-validation.ts',
    advancedEnabled: 'types/helpers/isEnableFieldValidationsForField.ts',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
let directory;
try {
    assert.equal(
        process.argv.length,
        3,
        'Supply the explicit canonical checkout.'
    );
    const checkout = resolve(process.argv[2]);
    const git = (...args) =>
        execFileSync('git', args, {
            cwd: checkout,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
    assert.equal(git('rev-parse', 'HEAD'), revision);
    assert.equal(git('rev-parse', 'HEAD^{tree}'), tree);
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
    const sourceHashes = {};
    for (const source of Object.values(sources)) {
        const bytes = readFileSync(resolve(checkout, source));
        const pinned = execFileSync('git', ['show', `${revision}:${source}`], {
            cwd: checkout,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        assert(
            bytes.equals(pinned),
            'Canonical source differs from pinned revision.'
        );
        sourceHashes[source] = hash(bytes);
    }
    directory = mkdtempSync(join(tmpdir(), 'sdk-select-form-oracle-'));
    const outfile = join(directory, 'canonical.cjs');
    const importFrom = (role) =>
        JSON.stringify(resolve(checkout, sources[role]));
    await build({
        stdin: {
            contents: `
import assert from 'node:assert/strict';
import {getFormRecordWithFieldsRemovedIfHiddenByConditionalFields as project} from ${importFrom('projection')};
import {convertConditionFieldsToFormula as convert} from ${importFrom('converter')};
import FormulaRunner from ${importFrom('formulaRunner')};
import {checkIfConditionsAreMet as evaluate} from ${importFrom('conditionRecord')};
import {getFormFieldErrorMessageForFrontend as validate} from ${importFrom('validation')};
import {isAdvancedFieldValidationEnabledForRuntime as enabled} from ${importFrom('advancedEnabled')};
import {singleSelectFormDriverCases as cases} from ${JSON.stringify(join(root, casesSource))};
const output = cases.map(c => {
    const before = JSON.stringify(c.input);
    const input = c.input;
    const formRecord = {type:'edit',tableId:'tbl_synthetic',recordId:input.recordId,data:input.data};
    const formula = convert(c.rule, input.airtableFields);
    const conditionMet = evaluate({record:{id:input.recordId,fields:input.data},formulaRunner:new FormulaRunner(formula),airtableFields:input.airtableFields,linkedTableLoadingStates:{}});
    const projected = project({formRecord,airtableFields:input.airtableFields,linkedTableLoadingStates:{},formFields:input.fieldIds.map(id=>input.fieldIdsToSchemas[id]),conditionalLinkedRecordFieldIdsToFilteringValues:{}});
    const target = input.fieldIdsToSchemas.validationTarget;
    const validation = {type:'result',invalid:!!validate({miniExtConfig:target.miniExtConfig,airtableFieldConfig:target.airtableField.config,value:input.data.validationTarget,storedValue:input.data.validationTarget,isConditionallyHidden:projected.hiddenFieldsFromConditionalFields.includes('validationTarget'),language:'en',isComputeMode:false,formRecord,airtableFields:input.airtableFields,linkedTableLoadingStates:{},isAdvancedFieldValidationEnabled:enabled({airtableFieldType:target.airtableField.config.type,miniExtConfig:target.miniExtConfig})})};
    assert.equal(JSON.stringify(c.input), before, 'Canonical execution mutated native input');
    return {...c,expected:{formula,conditionMet,hiddenFieldIds:projected.hiddenFieldsFromConditionalFields,record:{id:input.recordId,fields:projected.formRecordWithoutHiddenConditionalFields.data},validation,inputUnchanged:true}};
});
console.log(JSON.stringify(output));`,
            resolveDir: checkout,
            loader: 'ts',
        },
        absWorkingDir: checkout,
        tsconfig: resolve(checkout, 'tsconfig.json'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile,
        logLevel: 'silent',
    });
    const cases = JSON.parse(
        execFileSync(process.execPath, [outfile], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    );
    const fixture = {
        provenance: {
            revision,
            tree,
            generator,
            generatorSha256: hash(readFileSync(join(root, generator))),
            casesSource,
            casesSourceSha256: hash(readFileSync(join(root, casesSource))),
            sources: sourceHashes,
            execution:
                'unchanged pinned frontend projection helper and advanced validation helper through canonical converter and FormulaRunner; edit records with full native synthetic data, empty linked states and filter map; input immutability asserted',
        },
        cases,
    };
    writeFileSync(
        fixturePath,
        await format(JSON.stringify(fixture), {
            ...(await resolveConfig(fixturePath)),
            parser: 'json',
        })
    );
    console.log(`Canonical single-select Form drivers: ${cases.length} cases.`);
} catch {
    // Tool diagnostics can include local source locations; keep output portable.
    console.error(
        'Single-select Form fixture generation failed; verify the explicit pinned checkout.'
    );
    process.exitCode = 1;
} finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
}
