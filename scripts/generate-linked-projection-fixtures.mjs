import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statfsSync,
    writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Exact completed native source, not a claim about a later receiving revision.
const revision = 'acc1f942ff9704d469be421de8af251f0a27d220';
const tree = 'f9e12725785f98e131085dbc507f675fb6b479d0';
const sdkRevision = 'bd9d1f42982380069fc6a027650e70eff8127b9a';
const expectedSources = {
    'components/PublicExtension/helpers/getFormRecordWithFieldsRemovedIfHiddenByConditionalFields.ts':
        '66c1ec59ca43900539406a24fd14764f2a36b3de6a58c2d196fc4d06a593b5ba',
    'utils/isFieldHiddenByConditionalFields.ts':
        'b0f31ce92fab137306cc54d2e79678d38421aa436913f9efdfd49acd8c96f3b7',
    'types/extensions/conditions/convertConditionalFields.ts':
        '397b3a1a35ae07d0235d6477078cc10e7cf02ba00e02269272b4b3946f0dd3e1',
    'types/extensions/conditions/types.ts':
        '8845cdd88ad2b9b10b1313935ec2a2fee93588e8dfdecb0ba9374935770dd8e9',
    'types/extensions/conditions/helpers.ts':
        'eb12169f432fe5242cdbfa29e03fe2172912c694104176d70b48ba7d6740ed3a',
    'types/airtable/getResultAirtableConfigForAirtableField.ts':
        '39160ea3ae8d2feb847ea89f5edfd4cfd8a28afed84091342c21ce2278c2ab37',
    'types/utils/deepClone.ts':
        'fdad67f11ba03332c9a167492f8375c2c86e2ea361ea949b9b0d5089a9cb3934',
    'types/airtableMock/formulas/index.ts':
        '5187c4c6c8445c772827ebbb841df5647d900ac9603428d4a07ab547f2522d7c',
    'types/airtableMock/formulas/lexer/lexer.ts':
        '40d523a4b7e34133df5d7c731d0066cffc53669e482b75aa1491969ba0706ca5',
    'types/airtableMock/formulas/parser/parser.ts':
        '623f9075c75042701dd54641b8980346477059cebf815f49de9d515d38430631',
    'types/airtableMock/formulas/interpreter/interpreter.ts':
        'eea32f61aeeb156605d854cdac3c58b499a592777e3a1766a17006db0aae0f68',
    'types/airtableMock/formulas/helpers/extractIdentifiersFromExpr.ts':
        '0fe4c50ef278f67a6d51e356a23cfe48e37d4a68a2d3be857984bf83387e7763',
    'types/airtableMock/helper.ts':
        '8864f5bd31a3ea5102ec201ffa6146ad189716185ac5f4e9a6de6e5ecfe91a48',
    'types/airtable/getReadableStringFromAirtableValue.ts':
        'd107578560f31fee73644deadce58d0276a594de393a97023580fd4fae1f9f35',
    'types/airtable/assertRecordId.ts':
        '2e8d5e22f3391dc5eb279017abae4e6798828d65d1067aaa9e5cb8be2648552f',
    'utils/formatMultiSelectValue.ts':
        '110b8a726d00ba75d8b22023f021b0668c3d65d4aecbfd3f964dae8eed272955',
    'types/utils/type-guards/index.ts':
        'c0712f54a6dbaa8a46110fb65ea55e870ca92ef21a12753d6389fd56ba6313fd',
    'types/extensions/miniExt-field-configs/formFieldsWithConfigs/constants.ts':
        '3efa63e2afd40db8dd4499cbf8f77f04577d40ce97456f7c593603eeef545c02',
    'types/airtable/types.ts':
        '8cf036f0397865e0f7b133af5ec0111333afefe92725fd5b5c4df6f05b06a8b2',
    'package.json':
        '8841d8709156319bc34450e2d93e0e37e8c9cf8e1dda4daa9324465941063995',
    'pnpm-lock.yaml':
        'c5aec9a4861602900ba230dbf0393e682922c670cec104b9352729d26946265c',
    'tsconfig.json':
        '4311ab8de52edb877797eb5bbf0cd9cc1c334c2d71d3d3169cd8f59f38b63aee',
};
const expectedInstalledSdk = {
    'package.json':
        '7642b95deb19c6a3531bd41c6d317ddf255527f6fe282dc3ad88f410442fae53',
    'dist/esm/formulas/index.js':
        '0c4aec6f3ef127407d87be2f4943de87e67435d200dc20e6d870786255f6acbc',
    'dist/cjs/formulas/index.js':
        '04448505eef37bc66fa7caa5335bb8e7eb176456e8890aed1fb85de20e7a91f8',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesPath = join(root, 'test/fixtures/linkedProjectionCases.mjs');
const require = createRequire(import.meta.url);
const { build } = require('esbuild');
const { format, resolveConfig } = require('prettier');
assert.equal(
    process.argv.length,
    3,
    'Supply the pinned native checkout explicitly.'
);
const checkout = realpathSync(process.argv[2]);
const git = (...args) =>
    execFileSync('git', args, {
        cwd: checkout,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
const inside = (parent, child) => {
    const path = relative(parent, child);
    return path !== '' && !path.startsWith('..') && !isAbsolute(path);
};
assert.equal(git('rev-parse', 'HEAD'), revision);
assert.equal(git('rev-parse', 'HEAD^{tree}'), tree);
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
for (const [path, expected] of Object.entries(expectedSources)) {
    const canonical = execFileSync('git', ['show', `${revision}:${path}`], {
        cwd: checkout,
    });
    assert.equal(hash(canonical), expected, `Pinned source ${path}`);
    assert.equal(
        hash(readFileSync(join(checkout, path))),
        expected,
        `Executed source ${path}`
    );
}
const nativeManifest = join(checkout, 'package.json');
assert.equal(
    JSON.parse(readFileSync(nativeManifest)).dependencies[
        '@miniextensions/sdk'
    ],
    `git+https://github.com/miniExtensions/sdk.git#${sdkRevision}`
);
const nativeRequire = createRequire(nativeManifest);
const sdkRoot = realpathSync(
    resolve(
        dirname(nativeRequire.resolve('@miniextensions/sdk/formulas')),
        '../../..'
    )
);
for (const [path, expected] of Object.entries(expectedInstalledSdk))
    assert.equal(
        hash(readFileSync(join(sdkRoot, path))),
        expected,
        `Installed native SDK ${path}`
    );
const capacity = statfsSync(root);
assert(
    capacity.bavail * capacity.bsize > 1024 ** 3,
    'Preserve 1 GiB before the bounded oracle bundle.'
);
const directory = mkdtempSync(
    join(realpathSync(tmpdir()), 'sdk-linked-projection-oracle-')
);
try {
    const home = join(directory, 'home');
    mkdirSync(home);
    const guard = join(directory, 'boundary-guard.cjs');
    writeFileSync(
        guard,
        `const deny=()=>{throw Object.assign(new Error('Native oracle external I/O refused'),{code:'NATIVE_ORACLE_IO_REFUSED'});};\nfor(const [name,methods] of Object.entries({http:['request','get'],https:['request','get'],net:['connect','createConnection'],tls:['connect'],dgram:['createSocket'],child_process:['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']})){const module=require('node:'+name);for(const method of methods)module[method]=deny;}\nglobalThis.fetch=deny;\n`
    );
    const outfile = join(directory, 'oracle.cjs');
    const result = await build({
        stdin: {
            contents: `import assert from 'node:assert/strict';\nimport {getFormRecordWithFieldsRemovedIfHiddenByConditionalFields as project} from ${JSON.stringify(join(checkout, Object.keys(expectedSources)[0]))};\nimport {linkedProjectionCases} from ${JSON.stringify(casesPath)};\nconst passes=[];for(const [order,cases] of [['cold-forward',linkedProjectionCases],['warm-forward',linkedProjectionCases],['reverse',[...linkedProjectionCases].reverse()]]){passes.push({order,cases:cases.map(({name,input,nativeFallbackReason})=>{const before=JSON.stringify(input);const output=project(input);assert.equal(JSON.stringify(input),before);return {name,input,...(nativeFallbackReason?{nativeFallbackReason}:{}),expected:{formRecord:output.formRecordWithoutHiddenConditionalFields,hiddenFieldIds:output.hiddenFieldsFromConditionalFields}};})});}console.log(JSON.stringify(passes));`,
            resolveDir: checkout,
            loader: 'ts',
        },
        absWorkingDir: checkout,
        tsconfig: join(checkout, 'tsconfig.json'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile,
        metafile: true,
        logLevel: 'silent',
    });
    assert(
        readFileSync(outfile).byteLength < 10 * 1024 ** 2,
        'Unexpected oracle bundle size.'
    );
    const closure = {};
    for (const path of Object.keys(result.metafile.inputs)) {
        if (path === '<stdin>') continue;
        const absolute = realpathSync(resolve(checkout, path));
        const bytes = readFileSync(absolute);
        if (absolute === casesPath) {
            closure['cases'] = hash(bytes);
            continue;
        }
        if (inside(sdkRoot, absolute)) {
            closure[`installed-sdk/${relative(sdkRoot, absolute)}`] =
                hash(bytes);
            continue;
        }
        assert(
            inside(checkout, absolute),
            'Unexpected external source in native bundle.'
        );
        const local = relative(checkout, absolute);
        if (!local.startsWith('node_modules/'))
            assert.equal(
                hash(
                    execFileSync('git', ['show', `${revision}:${local}`], {
                        cwd: checkout,
                    })
                ),
                hash(bytes),
                `Native closure source ${local}`
            );
        closure[`native/${local}`] = hash(bytes);
    }
    for (const output of Object.values(result.metafile.outputs))
        for (const imported of output.imports)
            assert(
                !imported.external || imported.path.startsWith('node:'),
                `External runtime package ${imported.path}`
            );
    const passes = JSON.parse(
        execFileSync(
            process.execPath,
            ['--max-old-space-size=256', '--require', guard, outfile],
            {
                cwd: directory,
                env: {
                    PATH: dirname(process.execPath),
                    HOME: home,
                    LANG: 'C',
                    TZ: 'UTC',
                },
                encoding: 'utf8',
                timeout: 30000,
                maxBuffer: 8 * 1024 ** 2,
            }
        )
    );
    // Recheck source custody after execution before retaining an oracle result.
    assert.equal(git('rev-parse', 'HEAD'), revision);
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '');
    const fixture = {
        provenance: {
            revision,
            tree,
            installedSdkRevision: sdkRevision,
            generator: 'scripts/generate-linked-projection-fixtures.mjs',
            generatorSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
            casesSourceSha256: hash(readFileSync(casesPath)),
            sources: expectedSources,
            installedSdkEntries: expectedInstalledSdk,
            bundleInputs: Object.fromEntries(
                Object.entries(closure).sort(([a], [b]) => a.localeCompare(b))
            ),
            bundleSha256: hash(readFileSync(outfile)),
            execution:
                'Actual native projection, condition converter, loading guard, JSON clone and host value conversion; native formula execution delegates to its installed SDK. Three case orders, sterile HOME/environment, network and child-process refusal. Static snapshots do not prove live store publication, fallback error identity or Form/Review/Save ownership.',
        },
        passes,
    };
    const fixturePath = join(root, 'test/fixtures/linkedProjection.json');
    writeFileSync(
        fixturePath,
        await format(JSON.stringify(fixture), {
            ...(await resolveConfig(fixturePath)),
            parser: 'json',
        })
    );
    console.log(
        `Executed native ${revision}: ${passes[0].cases.length} cases in ${passes.length} orders; temporary oracle removed.`
    );
} finally {
    rmSync(directory, { recursive: true, force: true });
}
