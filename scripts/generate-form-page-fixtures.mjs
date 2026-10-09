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
    'email-syntax':
        'cefb9409ea8d98342d5fe46fa5bf26d26004fb1cf549435874d3c604870d2783',
    'ordinary-validation':
        '4cd7da6d3f7ccb44fe23f46ecf96ebeb8844bb9236c3a3cf33ab8e42113556d9',
    'value-emptiness':
        '0d4c94bfeeb88d2d180957861d8e1d34f40eeee64d921ba26b9aa5cf16a2785d',
    'select-option-policy':
        '081fe8f9a968b5e189fb86a86922aabaf4eeb6b2b7a15a6759bdf5b8ceea7e0f',
    'section-grouping':
        'bd127e74177448e81ee99cdd086b304d54bb51aa837d6ce121d32244d3b8e076',
    'page-navigation':
        '3c7fb6dd111835a24e666fd687487220cd295a866919f9ba2b2b9df07b02efea',
    'form-orchestration':
        '810b89b525ddfa05d520d2f7044f2304c320ff3b0884e810f408ba8ca06518b1',
    'navigation-dispatch':
        '83d76714a265ccef980773b9df031bcbc074b56a742a447de551d6f8f5ac8f56',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireEvidence = (valid) => {
    if (!valid) throw new Error('Canonical evidence validation failed.');
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesPath = join(root, 'test/fixtures/formPageCases.mjs');
const fixturePath = join(root, 'test/fixtures/formPages.json');
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
import {getErrorMessageForNonConditionalFields_frontend as validate} from ${importFrom('ordinary-validation')};
import {groupFormFieldsBySections as group} from ${importFrom('section-grouping')};
import {normalizeActivePageIndex as normalize, getNextVisiblePageIndex as next, getPreviousVisiblePageIndex as back} from ${importFrom('page-navigation')};
import {formPageValidationCases as values, formPageStructureCases as structures} from ${JSON.stringify(casesPath)};
const validation = values.map(c => ({...c, invalid: !!validate({
    miniExtConfig:c.schema.miniExtConfig, airtableFieldConfig:c.schema.airtableField.config,
    value:c.value, storedValue:c.stored, isConditionallyHidden:c.hidden,
    language:'en', isComputeMode:false,
})}));
const structure = structures.map(c => ({...c, groups:group(c.fields).map(g =>
    'fieldsInSection' in g ? {title:g.title,fieldIds:g.fieldsInSection.map(f=>f.airtableField.id)} : {fieldId:g.airtableField.id}
)}));
const navigation = [
    {pages:[{isHidden:false},{isHidden:true},{isHidden:false}],index:1},
    {pages:[{isHidden:true},{isHidden:true}],index:1},
].map(c => ({...c, normalized:normalize({pages:c.pages,activePageIndex:c.index}),
    next:next({pages:c.pages,activePageIndex:c.index}),back:back({pages:c.pages,activePageIndex:c.index})}));
console.log(JSON.stringify({validation,structure,navigation}));`,
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
            generator: 'scripts/generate-form-page-fixtures.mjs',
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
                'pinned ordinary validation including URL/shared email syntax, section grouping and navigation; synthetic values only',
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
        `Canonical page fixtures: ${cases.validation.length} validation, ${cases.structure.length} structures, ${cases.navigation.length} navigation.`
    );
} catch {
    // Build and Git diagnostics can contain private locations; keep them private.
    console.error(
        'Page fixture generation failed; verify the explicit checkout and external role mapping.'
    );
    process.exitCode = 1;
} finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
}
