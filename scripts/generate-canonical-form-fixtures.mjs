import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    readFileSync,
    writeFileSync,
    mkdtempSync,
    mkdirSync,
    rmSync,
    realpathSync,
    lstatSync,
} from 'node:fs';
import {
    resolve,
    join,
    relative,
    isAbsolute,
    dirname,
    basename,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { format, resolveConfig } from 'prettier';

const revision = 'e492cd6db39cc2ad21754d4614ade9f4fa235d3d';
const tree = 'c05d6fafeaecdd1e65a28c6c5fc8a72e0be9baed';
// Exact Git-LF source roles; private checkout locations remain external inputs.
const expectedSources = {
    'native-manifest':
        '6fb1d840c95f9dee226894ff5fc91cb18aae9ade39622e79032295bad61b669d',
    'native-lock':
        '29626625233c4fcbcb60ad112109073a7d8d15f45fb05c91ce30455702c6fa06',
    'canonical-reducer':
        '6dde847311fac600effc2316bf5a6a7262ce7155c013aee0d678c3a9a26ba00b',
    'edit-provenance':
        'ac0cb5d082a555083ee892068aedd9a262eeb67a6c98ac1423070ad1962ce760',
    'render-ownership':
        '0380d3583fe499ff5b5dc7c25063d550965bb3eb04f5286735b47fc97cfae987',
    'form-opening':
        '34149e52f13cd705ae64c958930f57c225ce2783e628428963ed508670d15e91',
    'form-settlement':
        'd4d4feec44478b5ce7e04ccfa5070e8f1bde426cc60784b14ecc5674f4e1195f',
    'ordinary-validation':
        '98101508f355adcf7c070dd2a938e90ab74c848f8bad976b0f47d98a06eaf604',
    'form-projection':
        'bed4f4ba2e8cf9fd43f63509acf17dc8b7ff580a0a5f23b5c96e1c1b69eb053f',
    'form-selectors':
        '895c2e7c53badeb4e6b4294957940ccc0d157bb554be944945b480d16b72748c',
    'validation-mode':
        '94e1ab19162424a0898db09a79cbbcf103b98047c33751bb34b09685c0f617b0',
    'richtext-comparison':
        '838f491df7747e4cdd05ac60aa94eef1f4b73875943f1c0df48d254d9fe67963',
    'public-fields':
        '4b63e300af62af4ee35f7e26a4190a06962ce052a30846b88b76418236a7e4d1',
    'extension-version':
        'f6a52df54939f06248432844c229ddafed464c87e315e46df44e8a8efdd49f55',
    'screen-kind':
        'f08904fc9b54c6b26d240d0fdf6ed233816d6cd081893c9c27a9885429c322bf',
    'extension-kind':
        '8d862f2cb20419777e609fe289c0184318fbc273dadb5ad1adf643a9d92cb516',
    'native-record-value-corpus':
        '888fa0b72e8e3b2765146f786b7671eecf3fab9e11a2c105a46eab488d23913b',
    'native-open-corpus':
        'aaa4fe1adefaf9ba82bd50ac455f3ccd2820d2b055ec458b00fb62f19860fd54',
    'native-save-corpus':
        '58092d241275933e1f0678dc473cb9fb931d1520df33f283fdaa0643282904ad',
};
const expectedRichText = {
    require: 'aca60313323d0e647104746ae2ff34852fe827160eb6abcff7e73872af58e526',
    import: '515fb774b72eb9f6e1f86ec27d051f8c0eb3c432ad6d47f366e565b116c809e0',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const toolHash = (filename) => {
    const bytes = readFileSync(filename);
    const canonical = Buffer.from(
        bytes.toString('utf8').replaceAll('\r\n', '\n')
    );
    requireEvidence(!canonical.includes(13));
    requireEvidence(
        bytes.equals(canonical) ||
            bytes.equals(
                Buffer.from(canonical.toString('utf8').replaceAll('\n', '\r\n'))
            )
    );
    return hash(canonical);
};
const requireEvidence = (valid) => {
    if (!valid) throw new Error('Canonical Form evidence validation failed.');
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const casesPath = join(root, 'test/fixtures/canonicalFormCases.mjs');
const fixturePath = join(root, 'test/fixtures/canonicalForms.json');
let directory;
let phase = 'source-admission';
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
    const sourceEvidence = {};
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
        const pinned = execFileSync(
            'git',
            ['show', `${revision}:${local.replaceAll('\\', '/')}`],
            {
                cwd: checkout,
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        );
        requireEvidence(hash(pinned) === expectedSources[role]);
        // Accept only Git's exact full-file checkout transform. This does not
        // trim, reformat, normalize mixed endings, or alter the executed file.
        const crlf = Buffer.from(
            pinned.toString('utf8').replaceAll('\n', '\r\n')
        );
        const eol = bytes.equals(pinned)
            ? 'git-lf'
            : bytes.equals(crlf)
              ? 'git-crlf'
              : null;
        requireEvidence(eol !== null);
        locations[role] = absolute;
        sourceEvidence[role] = {
            canonicalSha256: hash(pinned),
            rawSha256: hash(bytes),
            eol,
        };
    }
    // The native RichText equality branch already borrows this old installed
    // helper. Pin both packaged formats and report that dependency explicitly;
    // it is not independent proof of the candidate's RichText implementation.
    const formsEntry = createRequire(locations['richtext-comparison']).resolve(
        '@miniextensions/sdk/forms'
    );
    const richTextLocations = {
        require: join(dirname(formsEntry), 'richTextSerialization.js'),
        import: resolve(
            dirname(formsEntry),
            '../../esm/forms/richTextSerialization.js'
        ),
    };
    for (const [formatName, location] of Object.entries(richTextLocations))
        requireEvidence(
            hash(readFileSync(location)) === expectedRichText[formatName]
        );
    const nativeRequire = createRequire(locations['native-manifest']);
    const newRelicEntry = nativeRequire.resolve('newrelic');
    const newRelicPackage = JSON.parse(
        readFileSync(join(dirname(newRelicEntry), 'package.json'), 'utf8')
    );

    const temporaryRoot = realpathSync(tmpdir());
    directory = mkdtempSync(join(temporaryRoot, 'sdk-canonical-form-oracle-'));
    const isolatedHome = join(directory, 'home');
    mkdirSync(isolatedHome);
    const boundaryGuard = join(directory, 'boundary-guard.cjs');
    writeFileSync(
        boundaryGuard,
        `
const deny=()=>{throw Object.assign(new Error('Native oracle external I/O refused'),{code:'NATIVE_ORACLE_IO_REFUSED'});};
for(const [name,methods] of Object.entries({http:['request','get'],https:['request','get'],net:['connect','createConnection'],tls:['connect'],child_process:['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']})){
 const module=require('node:'+name); for(const method of methods) module[method]=deny;
}
globalThis.fetch=deny;
`
    );
    const outfile = join(directory, 'oracle.cjs');
    const importFrom = (role) => JSON.stringify(locations[role]);
    phase = 'native-bundle';
    await build({
        stdin: {
            contents: `
import reducer, {publicExtensionActions as actions} from ${importFrom('canonical-reducer')};
import {captureHostedFormEditProvenance as captureEdit, getHostedFormEditRetention as retention} from ${importFrom('edit-provenance')};
import {readNativeFormRenderOwner as readRenderOwner, nativeFormRenderOwnerIsCurrent as ownerIsCurrent} from ${importFrom('render-ownership')};
import {getPublicFieldsFromExtension} from ${importFrom('public-fields')};
import {currentExtensionsVersionIndex as extensionVersion} from ${importFrom('extension-version')};
import {ExtensionScreen} from ${importFrom('screen-kind')};
import {getFormFieldErrorMessageForFrontend as validateField} from ${importFrom('ordinary-validation')};
import {getFilteredRecordData} from ${importFrom('form-projection')};
import {selectLinkedTableStates, selectAirtableFields} from ${importFrom('form-selectors')};
import {isAdvancedFieldValidationEnabledForRuntime as advancedValidationEnabled} from ${importFrom('validation-mode')};
import {extensionOpened} from ${importFrom('form-opening')};
import {configureStore} from '@reduxjs/toolkit';
import {canonicalFormFieldDefinitions, replayCanonicalFormCases} from ${JSON.stringify(casesPath)};
const createStore = state => configureStore({reducer:{publicExtension:reducer},preloadedState:{publicExtension:state}});
replayCanonicalFormCases({reducer,actions,captureEdit,retention,readRenderOwner,ownerIsCurrent,getPublicFieldsFromExtension,extensionVersion,formLoadedScreen:ExtensionScreen.FORM_LOADED,validateField,getFilteredRecordData,selectLinkedTableStates,selectAirtableFields,advancedValidationEnabled,extensionOpened,createStore}).then(scenarios => {
console.log(JSON.stringify({fields:canonicalFormFieldDefinitions,scenarios}));
}).catch(() => {process.exitCode=1;});`,
            resolveDir: checkout,
            loader: 'ts',
        },
        absWorkingDir: checkout,
        tsconfig: resolve(checkout, 'tsconfig.json'),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        outfile,
        // New Relic dynamically enumerates its own subscriber directory. Keep
        // that existing Node package intact instead of bundling README/assets
        // into requires or replacing its implementation with a test shim.
        plugins: [
            {
                name: 'native-node-newrelic',
                setup(builder) {
                    builder.onResolve(
                        { filter: /^newrelic(?:\/.*)?$/ },
                        ({ path }) => ({
                            path: nativeRequire.resolve(path),
                            external: true,
                        })
                    );
                },
            },
        ],
        logLevel: 'silent',
    });
    const environment = {};
    for (const name of [
        'PATH',
        'Path',
        'SystemRoot',
        'SystemDrive',
        'WINDIR',
        'TEMP',
        'TMP',
    ])
        if (process.env[name] != null) environment[name] = process.env[name];
    Object.assign(environment, {
        NODE_ENV: 'test',
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        APPDATA: join(isolatedHome, 'AppData', 'Roaming'),
        LOCALAPPDATA: join(isolatedHome, 'AppData', 'Local'),
        NEW_RELIC_ENABLED: 'false',
        METADATA_SERVER_DETECTION: 'none',
        NEXT_TELEMETRY_DISABLED: '1',
    });
    phase = 'native-replay';
    const observations = JSON.parse(
        execFileSync(
            process.execPath,
            ['--max-old-space-size=1024', '--require', boundaryGuard, outfile],
            {
                cwd: checkout,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
                env: environment,
                timeout: 60000,
                maxBuffer: 4 * 1024 * 1024,
            }
        )
    );
    const fixture = {
        provenance: {
            revision,
            tree,
            generator: 'scripts/generate-canonical-form-fixtures.mjs',
            generatorSha256: toolHash(fileURLToPath(import.meta.url)),
            casesSourceSha256: toolHash(casesPath),
            toolEolPolicy:
                'canonical LF hash, exact LF or complete CRLF checkout bytes only',
            eolPolicy:
                'exact Git LF bytes or exact whole-file LF-to-CRLF checkout transform only',
            sources: sourceEvidence,
            installedRichTextSerialization: expectedRichText,
            externalNodePackage: {
                name: 'newrelic',
                version: newRelicPackage.version,
                entrySha256: hash(readFileSync(newRelicEntry)),
            },
            environment:
                'sterile test process with empty home, no inherited credentials, forbidden network/child-process boundaries and bounded1024MiB heap/60s replay',
            execution:
                'real native reducer/actions, provenance retention, render ownership and preserved-open thunk via a real Redux store; real field validation against reducer-observed inputs; synthetic direct-root non-Compute inputs only',
            referenceOnlyRoles: [
                'form-settlement',
                'native-record-value-corpus',
                'native-open-corpus',
                'native-save-corpus',
            ],
            limits: [
                'Trusted Save settlement rows execute updateRecordAfterSave, not request allocation, transport or stale-response admission.',
                'Historical readonly metadata is a synthetic state fixture; no Compute admission or permission to submit is manufactured.',
                'RichText equality borrows the pinned installed SDK helper; this corpus independently proves native transition ordering and state effects, not that helper itself.',
                'No native integration, browser, deployment or hosted acceptance is implied.',
            ],
        },
        ...observations,
    };
    phase = 'fixture-publication';
    writeFileSync(
        fixturePath,
        await format(JSON.stringify(fixture), {
            ...(await resolveConfig(fixturePath)),
            parser: 'json',
        })
    );
    console.log(
        `Canonical Form fixtures: ${observations.scenarios.length} real-native scenarios.`
    );
} catch (error) {
    if (phase === 'native-bundle' && Array.isArray(error?.errors)) {
        // Private local diagnostics only; never part of the published corpus.
        const diagnosticDirectory = join(root, 'dist', 'focused');
        mkdirSync(diagnosticDirectory, { recursive: true });
        writeFileSync(
            join(diagnosticDirectory, 'canonical-form-bundle-diagnostic.json'),
            JSON.stringify(
                error.errors.map(({ text, location }) => ({
                    text,
                    file: location?.file,
                    line: location?.line,
                })),
                null,
                2
            )
        );
    }
    // Build/Git diagnostics may contain private source locations.
    console.error(
        `Canonical Form fixture generation failed during ${phase}; verify the explicit checkout, dependency bytes and external role mapping.`
    );
    process.exitCode = 1;
} finally {
    if (directory) {
        // This exact fresh directory is the only recursively removable target.
        const target = realpathSync(directory);
        const info = lstatSync(directory);
        if (
            target === directory &&
            dirname(target) === realpathSync(tmpdir()) &&
            basename(target).startsWith('sdk-canonical-form-oracle-') &&
            info.isDirectory() &&
            !info.isSymbolicLink()
        ) {
            rmSync(target, { recursive: true, force: true });
        } else {
            console.error(
                'Canonical Form temporary cleanup refused; owned state retained.'
            );
            process.exitCode = 1;
        }
    }
}
