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
// The external map supplies private locations; distributed evidence uses roles.
const expectedSources = {
    'range-predicate':
        '02e4995f46d9d2aa15865a98a9634eb7f6e4323e56466b62b72efc6fd6402cf5',
    'date-format':
        'a72e64e976dd4ead2df4670836535e24a6e58dc430635d7660575062c1df3726',
    'assert-unreachable':
        '4d028fb5576114f3840b4382de3d2a9062e95e6a9b9ffea4114401476f4d70c9',
    'airtable-field-types':
        '6426f0039a1dd4876c8dda07fd93e919c763b1418e3b2c4c75e1628c8d0726a4',
};
const expectedDependencies = {
    entry: 'b93bc1a0ab15d56e12f0e281bf005d39166952d9208b828e8d056563f3ff1fd1',
    implementation:
        '0c9a4268aa9cd624f8c7ff72240984c55fb0122d5f013afe22b1e04f6cdc6880',
    data: 'dca2a4e4ffcd85f25190d7e82c6cd65e7e8fbdd98358247a70656ea087860fd8',
    moment: '7dc0a51c32dae143f2eade235145dfd6a7756388c0f0bf409fa373dd6c233629',
};
const enumAdapter =
    "export const AirtableFieldType = { DATE: 'date', DATE_TIME: 'dateTime' };";
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireEvidence = (valid) => {
    if (!valid) throw new Error('Canonical evidence validation failed.');
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesPath = join(root, 'test/fixtures/dateRangeCases.mjs');
const fixturePath = join(root, 'test/fixtures/dateRanges.json');
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
    const sourceRequire = createRequire(locations['range-predicate']);
    const momentEntry = sourceRequire.resolve('moment-timezone');
    const dependencyRoot = dirname(momentEntry);
    const dependencyPackage = JSON.parse(
        readFileSync(join(dependencyRoot, 'package.json'), 'utf8')
    );
    const momentImplementation = createRequire(momentEntry).resolve('moment');
    const momentPackage = JSON.parse(
        readFileSync(
            join(dirname(momentImplementation), 'package.json'),
            'utf8'
        )
    );
    requireEvidence(dependencyPackage.version === '0.5.45');
    requireEvidence(momentPackage.version === '2.30.1');
    const dependencyFiles = {
        entry: momentEntry,
        implementation: join(dependencyRoot, 'moment-timezone.js'),
        data: join(dependencyRoot, 'data/packed/latest.json'),
        moment: momentImplementation,
    };
    for (const [role, location] of Object.entries(dependencyFiles))
        requireEvidence(
            hash(readFileSync(location)) === expectedDependencies[role]
        );
    const dataVersion = JSON.parse(
        readFileSync(dependencyFiles.data, 'utf8')
    ).version;
    directory = mkdtempSync(join(tmpdir(), 'sdk-date-range-oracle-'));
    const outfile = join(directory, 'oracle.cjs');
    await build({
        stdin: {
            contents: `
import moment from 'moment-timezone';
import {isAirtableDateValueWithinRange as validate} from ${JSON.stringify(locations['range-predicate'])};
import {dateRangeCases as cases} from ${JSON.stringify(casesPath)};
moment.locale('en');
if(cases.length > 600) throw new Error('Case budget exceeded');
const validation = cases.map(c => {
  let canonical;
  try {
    canonical={type:'result',withinRange:validate({
      airtableFieldConfig:c.kind==='date' ? {type:'date',options:{}} : {type:'dateTime',options:{timeZone:c.timeZone}},
      airtableValue:c.value,dateRange:c.dateRange,now:moment.utc(c.now)})};
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
        treeShaking: true,
        platform: 'node',
        format: 'cjs',
        outfile,
        logLevel: 'silent',
        plugins: [
            {
                name: 'pinned-date-range-dependencies',
                setup(builder) {
                    builder.onResolve({ filter: /^moment-timezone$/ }, () => ({
                        path: momentEntry,
                    }));
                    builder.onLoad({ filter: /./ }, (args) => {
                        if (args.path === locations['airtable-field-types'])
                            return { contents: enumAdapter, loader: 'js' };
                    });
                },
            },
        ],
    });
    const cases = JSON.parse(
        execFileSync(process.execPath, [outfile], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
    );
    requireEvidence(
        Array.isArray(cases.validation) && cases.validation.length <= 600
    );
    const fixture = {
        provenance: {
            revision,
            tree,
            generator: 'scripts/generate-date-range-fixtures.mjs',
            generatorSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
            casesSourceSha256: hash(readFileSync(casesPath)),
            sources: expectedSources,
            export: 'isAirtableDateValueWithinRange',
            adapter: {
                sourceRole: 'airtable-field-types',
                scope: 'only DATE and DATE_TIME enum members; no predicate replacement',
                source: enumAdapter,
                sha256: hash(enumAdapter),
            },
            momentTimezone: {
                version: dependencyPackage.version,
                dataVersion,
                momentVersion: momentPackage.version,
                sha256: expectedDependencies,
            },
            clock: 'explicit UTC instant per case; canonical helper converts to effective range zone',
            locale: 'en; ISO week boundaries remain locale independent',
            execution:
                'unchanged pinned named range export, tree-shaken bundle; synthetic date-only and fixed-zone inputs; result categories only',
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
        `Canonical date range fixtures: ${cases.validation.length} classified cases.`
    );
} catch {
    // Build and Git diagnostics may reveal private source locations.
    console.error(
        'Date range fixture generation failed; verify the explicit checkout and external role mapping.'
    );
    process.exitCode = 1;
} finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
}
