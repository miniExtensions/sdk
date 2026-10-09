import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    readFileSync,
    writeFileSync,
    mkdtempSync,
    rmSync,
    realpathSync,
} from 'node:fs';
import { resolve, join, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { format, resolveConfig } from 'prettier';

const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const tree = 'b39e58ead46a311c497def57474cf5ca720542ae';
// Roles identify evidence without distributing private source locations.
const expectedSources = {
    'ordered-projection':
        '66c1ec59ca43900539406a24fd14764f2a36b3de6a58c2d196fc4d06a593b5ba',
    'scalar-converter':
        '397b3a1a35ae07d0235d6477078cc10e7cf02ba00e02269272b4b3946f0dd3e1',
    'formula-runner':
        'e4169421073e02ce37ecbe0c5e142584634572020781ebeaeec6b6bb48704d7f',
    'condition-record':
        'b0f31ce92fab137306cc54d2e79678d38421aa436913f9efdfd49acd8c96f3b7',
    'single-select-renderer':
        'e68eebe28dd2ee0a0f60bf62b8674dc92a44447b0841f1692079f7a37e6ceea3',
    'multiple-select-renderer':
        '3fb37cc8eb20e50b28e8e424266111bc0532ed6db685219e33a5ea0c1794d847',
    'form-surface':
        '01b02c79812dcf279fa1da43f85dd1f7435d2555937475204337f0db2db59683',
    'form-pages':
        '810b89b525ddfa05d520d2f7044f2304c320ff3b0884e810f408ba8ca06518b1',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireEvidence = (valid) => {
    if (!valid) throw new Error('Canonical evidence validation failed.');
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesPath = join(root, 'test/fixtures/crossPageChoicesCases.mjs');
const fixturePath = join(root, 'test/fixtures/crossPageChoices.json');
let directory;
try {
    requireEvidence(process.argv.length === 4);
    const checkout = realpathSync(process.argv[2]);
    const sourceMap = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    requireEvidence(
        sourceMap !== null &&
            typeof sourceMap === 'object' &&
            !Array.isArray(sourceMap)
    );
    const roles = Object.keys(expectedSources).sort();
    requireEvidence(
        JSON.stringify(Object.keys(sourceMap).sort()) === JSON.stringify(roles)
    );
    const git = (...args) =>
        execFileSync('git', args, {
            cwd: checkout,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
    requireEvidence(git('rev-parse', 'HEAD') === revision);
    requireEvidence(git('rev-parse', 'HEAD^{tree}') === tree);
    requireEvidence(
        git('status', '--porcelain', '--untracked-files=no') === ''
    );
    const locations = {};
    for (const role of roles) {
        const location = sourceMap[role];
        requireEvidence(
            typeof location === 'string' &&
                location.length > 0 &&
                !isAbsolute(location)
        );
        const absolute = realpathSync(resolve(checkout, location));
        const local = relative(checkout, absolute);
        requireEvidence(
            local !== '' && !local.startsWith('..') && !isAbsolute(local)
        );
        const bytes = readFileSync(absolute);
        requireEvidence(hash(bytes) === expectedSources[role]);
        const pinned = execFileSync('git', ['show', `${revision}:${local}`], {
            cwd: checkout,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        requireEvidence(bytes.equals(pinned));
        locations[role] = absolute;
    }
    directory = mkdtempSync(join(tmpdir(), 'sdk-page-oracle-'));
    const outfile = join(directory, 'oracle.cjs');
    const importFrom = (role) => JSON.stringify(locations[role]);
    await build({
        stdin: {
            contents: `
import {getFormRecordWithFieldsRemovedIfHiddenByConditionalFields as project} from ${importFrom('ordered-projection')};
import {convertConditionFieldsToFormula as convert} from ${importFrom('scalar-converter')};
import FormulaRunner from ${importFrom('formula-runner')};
import {checkIfConditionsAreMet as evaluate} from ${importFrom('condition-record')};
import {crossPageChoicesCases as cases} from ${JSON.stringify(casesPath)};
const choices=cases.map(c=>{
 const airtableFields=Object.values(c.schemas).map(s=>s.airtableField);
 const formRecord={type:'edit',recordId:'rec_synthetic',data:structuredClone(c.data)};
 const projection=project({formRecord,airtableFields,formFields:c.fieldIds.map(id=>c.schemas[id]),linkedTableLoadingStates:{},conditionalLinkedRecordFieldIdsToFilteringValues:{},evaluateConditionalFields:true});
 const target=c.schemas[c.fieldId];
 const selected=Array.isArray(c.data[c.fieldId])?c.data[c.fieldId]:[c.data[c.fieldId]];
 const eligible=target.airtableField.config.options.choices.filter(option=>{
  if(c.rendererType==='list'&&selected.includes(option.name))return true;
  const definition=target.miniExtConfig.conditionsForOptions.find(r=>r.config.optionForConditions===option.id)?.config.conditionsForOption??null;
  return evaluate({formulaRunner:new FormulaRunner(convert(definition,airtableFields)),airtableFields,linkedTableLoadingStates:{},record:{id:'rec_synthetic',fields:projection.formRecordWithoutHiddenConditionalFields.data}});
 }).map(o=>o.name);
 return {...c,canonical:{projectedData:projection.formRecordWithoutHiddenConditionalFields.data,hiddenFieldIds:projection.hiddenFieldsFromConditionalFields,eligibleNames:eligible,nativeData:formRecord.data}};
});
console.log(JSON.stringify({choices}));`,
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
            generator: 'scripts/generate-cross-page-choice-fixtures.mjs',
            generatorSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
            casesSourceSha256: hash(readFileSync(casesPath)),
            casesHelpersSourceSha256: hash(
                readFileSync(
                    join(
                        root,
                        'test/fixtures/conditionalPageValidationCases.mjs'
                    )
                )
            ),
            sources: expectedSources,
            execution:
                'pinned ordered conditional-field projection and renderer option predicates against complete synthetic native records; page index is presentation metadata only',
        },
        ...cases,
    };
    writeFileSync(
        fixturePath,
        await format(JSON.stringify(fixture), {
            ...(await resolveConfig(fixturePath)),
            parser: 'json',
        })
    );
    console.log(
        `Canonical cross-page choice fixtures: ${cases.choices.length} classified cases.`
    );
} catch {
    // Build and Git diagnostics can contain private locations; keep them private.
    console.error(
        'Cross-page choice fixture generation failed; verify the explicit checkout and external role mapping.'
    );
    process.exitCode = 1;
} finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
}
