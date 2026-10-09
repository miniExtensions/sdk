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
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { format, resolveConfig } from 'prettier';

const revision = '58f73d575ab10baa0a10693660d8002f204368e1';
const tree = 'b39e58ead46a311c497def57474cf5ca720542ae';
// Roles identify evidence without distributing private source locations.
const expectedSources = {
    'frontend-validation':
        '768b7d657fd670c70918f540147fc6abbbd18513ba7605a0f4631999ad333810',
    'advanced-enabled':
        '94e1ab19162424a0898db09a79cbbcf103b98047c33751bb34b09685c0f617b0',
    'scalar-converter':
        '397b3a1a35ae07d0235d6477078cc10e7cf02ba00e02269272b4b3946f0dd3e1',
    'formula-runner':
        'e4169421073e02ce37ecbe0c5e142584634572020781ebeaeec6b6bb48704d7f',
    'condition-record':
        'b0f31ce92fab137306cc54d2e79678d38421aa436913f9efdfd49acd8c96f3b7',
    'ordinary-validation':
        '4cd7da6d3f7ccb44fe23f46ecf96ebeb8844bb9236c3a3cf33ab8e42113556d9',
    'email-syntax':
        'cefb9409ea8d98342d5fe46fa5bf26d26004fb1cf549435874d3c604870d2783',
    'value-emptiness':
        '0d4c94bfeeb88d2d180957861d8e1d34f40eeee64d921ba26b9aa5cf16a2785d',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireEvidence = (valid) => {
    if (!valid) throw new Error('Canonical evidence validation failed.');
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesPath = join(
    root,
    'test/fixtures/conditionalPageValidationCases.mjs'
);
const fixturePath = join(root, 'test/fixtures/conditionalPageValidation.json');
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
    const emailValidatorEntry = createRequire(
        locations['email-syntax']
    ).resolve('email-validator');
    const emailValidatorPackage = JSON.parse(
        readFileSync(join(dirname(emailValidatorEntry), 'package.json'), 'utf8')
    );
    const emailValidatorSha256 = hash(readFileSync(emailValidatorEntry));
    requireEvidence(emailValidatorPackage.version === '2.0.4');
    requireEvidence(
        emailValidatorSha256 ===
            '72a150940d35695c23e26e262e564dae9397ca9757e2ab57b1c784607d9838b1'
    );
    directory = mkdtempSync(join(tmpdir(), 'sdk-page-oracle-'));
    const outfile = join(directory, 'oracle.cjs');
    const importFrom = (role) => JSON.stringify(locations[role]);
    await build({
        stdin: {
            contents: `
import {getFormFieldErrorMessageForFrontend as validate} from ${importFrom('frontend-validation')};
import {isAdvancedFieldValidationEnabledForRuntime as enabled} from ${importFrom('advanced-enabled')};
import {conditionalPageValidationCases as cases} from ${JSON.stringify(casesPath)};
const validation = cases.map(c => {
  let canonical;
  try {
    const target=c.schemas.target;
    canonical={type:'result',invalid:!!validate({miniExtConfig:target.miniExtConfig,
      airtableFieldConfig:target.airtableField.config,value:c.data.target,
      storedValue:c.data.target,isConditionallyHidden:c.hidden,language:'en',isComputeMode:false,
      formRecord:{type:'create',data:c.data},airtableFields:Object.values(c.schemas).map(s=>s.airtableField),
      linkedTableLoadingStates:{},isAdvancedFieldValidationEnabled:enabled({
        airtableFieldType:target.airtableField.config.type,miniExtConfig:target.miniExtConfig})})};
  } catch { canonical={type:'throws'}; }
  return {...c,canonical};
});
console.log(JSON.stringify({validation}));`,
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
            generator:
                'scripts/generate-conditional-page-validation-fixtures.mjs',
            generatorSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
            casesSourceSha256: hash(readFileSync(casesPath)),
            sources: expectedSources,
            urlSyntax: {
                sourceRole: 'email-syntax',
                export: 'checkIfUrlIsValid',
                hrefExport: 'getValidUrlHref',
            },
            emailValidator: {
                version: emailValidatorPackage.version,
                entrySha256: emailValidatorSha256,
            },
            execution:
                'pinned frontend ordinary-first and runtime-enabled conditional validation through scalar converter and formula runner against full native synthetic data; result categories only',
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
        `Canonical conditional page fixtures: ${cases.validation.length} classified cases.`
    );
} catch {
    // Build and Git diagnostics can contain private locations; keep them private.
    console.error(
        'Conditional page fixture generation failed; verify the explicit checkout and external role mapping.'
    );
    process.exitCode = 1;
} finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
}
