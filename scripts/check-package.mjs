import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    cpSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import {
    assertBrowserInputs,
    assertInstalledArchive,
    assertPackedDocLinks,
} from './package-checks.mjs';

const require = createRequire(import.meta.url);
const temporaryDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'miniextensions-sdk-'))
);
// A sibling temp root has no generic consumer node_modules in its ancestry.
const browserDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'miniextensions-browser-'))
);
const packageMetadata = JSON.parse(readFileSync('package.json', 'utf8'));

function run(command, args, cwd = temporaryDirectory) {
    return execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env,
            npm_config_cache: join(temporaryDirectory, 'npm-cache'),
        },
        timeout: 120000,
    });
}

try {
    // check:package also works alone; never pack leftover build output.
    run(process.execPath, ['scripts/build.mjs'], process.cwd());
    const packed = JSON.parse(
        run(
            'npm',
            [
                'pack',
                '--json',
                '--ignore-scripts',
                '--pack-destination',
                temporaryDirectory,
            ],
            process.cwd()
        )
    )[0];
    for (const { path } of packed.files) {
        assert(
            path === 'package.json' ||
                path === 'README.md' ||
                path === 'LICENSE' ||
                path === 'THIRD_PARTY_NOTICES.md' ||
                path === 'docs/formulas.md' ||
                path === 'docs/runtime.md' ||
                path.startsWith('dist/esm/') ||
                path.startsWith('dist/cjs/'),
            `Unexpected packed file: ${path}`
        );
    }
    writeFileSync(
        join(temporaryDirectory, 'package.json'),
        JSON.stringify({ private: true, type: 'module' })
    );
    run('npm', [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        join(temporaryDirectory, packed.filename),
    ]);
    const installedPackage = join(
        temporaryDirectory,
        'node_modules/@miniextensions/sdk'
    );
    await assertPackedDocLinks(
        installedPackage,
        packed.files.map(({ path }) => path)
    );

    // Compile the actual shipped quickstart against installed declarations.
    const runtimeGuide = readFileSync(
        join(installedPackage, 'docs/runtime.md'),
        'utf8'
    );
    const quickstart = runtimeGuide
        .split('## Packaged Form quickstart\n')[1]
        ?.match(/```ts\n([\s\S]*?)\n```/)?.[1];
    assert(quickstart, 'Missing packaged Form quickstart');
    const guideExamples = [...runtimeGuide.matchAll(/```ts\n([\s\S]*?)\n```/g)]
        .map(([, code]) => code)
        .join('\n');
    writeFileSync(join(temporaryDirectory, 'runtime-guide.ts'), guideExamples);
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        'false',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        'runtime-guide.ts',
    ]);

    const consumer = `
import { FormulaRunner, AirtableFieldType } from '@miniextensions/sdk/formulas';
import { createMiniExtensionsClient, withExtensionPassword, withLoginToken } from '@miniextensions/sdk';
const client = createMiniExtensionsClient({ apiOrigin: 'https://api.example.com', publishableKey: 'me_pk_example' });
client.setSession(withExtensionPassword({}, { extensionId: 'extExample', encryptedExtensionPassword: 'password-token' }));
client.setSession(withLoginToken(client.getSession(), { extensionId: 'extExample', tableId: 'tblExample', loginFieldNames: ['Email'], encryptedLoginToken: 'login-token' }));
if (Object.keys(client.getSession()).length !== 2) throw new Error('Session helper failed');
interface NumericOptions { precision: number; }
const numericOptions: NumericOptions = { precision: 0 };
const runner = new FormulaRunner('{Quantity} * 3');
runner.context = {
    record: { id: 'recExample', fields: { fldQuantity: 4 } },
    airtableFields: [{
        id: 'fldQuantity', name: 'Quantity', isPrimaryField: true,
        config: { type: AirtableFieldType.NUMBER, options: numericOptions }
    }],
    linkedTableLoadingStates: {}
};
if (runner.run() !== 12) throw new Error('Formula context did not resolve');
export const result = runner.run();
`;
    const javascriptConsumer = consumer.replace(
        'interface NumericOptions { precision: number; }\nconst numericOptions: NumericOptions',
        'const numericOptions'
    );
    writeFileSync(join(temporaryDirectory, 'consumer.mjs'), javascriptConsumer);
    run(process.execPath, ['consumer.mjs']);

    writeFileSync(
        join(temporaryDirectory, 'consumer.cjs'),
        `const { FormulaRunner } = require('@miniextensions/sdk/formulas');
const { createMiniExtensionsClient } = require('@miniextensions/sdk');
if (Object.keys(createMiniExtensionsClient({ apiOrigin: 'https://api.example.com', publishableKey: 'me_pk_example' }).getSession()).length !== 0) throw new Error('CommonJS runtime client failed');
if (new FormulaRunner('2 + 3 * 4').run() !== 14) throw new Error('CommonJS formula evaluation failed');
`
    );
    run(process.execPath, ['consumer.cjs']);

    const declarationConsumer =
        consumer +
        `
import type { FormLoadedResult, RuntimeFieldSchema } from '@miniextensions/sdk';
export function renderChoiceNames(field: RuntimeFieldSchema): string[] {
    const config = field.airtableField.config;
    switch (config.type) {
        case AirtableFieldType.SINGLE_SELECT:
        case AirtableFieldType.MULTIPLE_SELECTS:
        case AirtableFieldType.EXTERNAL_SYNC_SOURCE:
            return config.options?.choices.map((choice) => {
                const color: string | undefined = choice.color;
                const newOption: boolean | undefined = choice.newOption;
                return choice.id + choice.name + (color ?? '') + (newOption ?? false);
            }) ?? [];
        case AirtableFieldType.SINGLE_COLLABORATOR:
        case AirtableFieldType.MULTIPLE_COLLABORATORS:
        case AirtableFieldType.CREATED_BY:
        case AirtableFieldType.LAST_MODIFIED_BY:
            return config.options?.choices.map((choice) => {
                const avatar: string | undefined = choice.profilePicUrl;
                return choice.id + choice.name + choice.email + (avatar ?? '');
            }) ?? [];
        default:
            return [];
    }
}
export function renderAttachmentPreview(extension: FormLoadedResult): {
    url: string | undefined;
    width: number | undefined;
    height: number | undefined;
} {
    const attachment = extension.payload.persistedAddOnlyAttachmentValuesByFieldId?.fldFiles?.[0];
    const small = attachment?.thumbnails?.small;
    const large = attachment?.thumbnails?.large;
    const full = attachment?.thumbnails?.full;
    return {
        url: large?.url ?? small?.url ?? full?.url,
        width: large?.width,
        height: large?.height,
    };
}
`;

    for (const [filename, module, moduleResolution] of [
        ['consumer.mts', 'NodeNext', 'NodeNext'],
        ['consumer.cts', 'NodeNext', 'NodeNext'],
        ['browser-consumer.ts', 'ESNext', 'Bundler'],
    ]) {
        writeFileSync(join(temporaryDirectory, filename), declarationConsumer);
        run(process.execPath, [
            require.resolve('typescript/bin/tsc'),
            '--noEmit',
            '--strict',
            '--skipLibCheck',
            'false',
            '--target',
            'ES2022',
            '--module',
            module,
            '--moduleResolution',
            moduleResolution,
            filename,
        ]);
    }

    const bundled = await build({
        entryPoints: [join(temporaryDirectory, 'consumer.mjs')],
        bundle: true,
        platform: 'browser',
        format: 'iife',
        globalName: 'miniExtensionsFormulaExample',
        write: false,
        logLevel: 'silent',
    });
    const browserContext = { URL, TextEncoder, fetch };
    runInNewContext(bundled.outputFiles[0].text, browserContext, {
        timeout: 10000,
    });
    assert.equal(browserContext.miniExtensionsFormulaExample.result, 12);

    cpSync('examples/browser', browserDirectory, {
        recursive: true,
        filter: (path) =>
            !/(?:^|[/\\])(?:node_modules|\.generated)(?:[/\\]|$)/.test(path),
    });
    const archivePath = join(temporaryDirectory, packed.filename);
    const archiveSpec = `file:${archivePath}`;
    const browserManifestPath = join(browserDirectory, 'package.json');
    const browserLockPath = join(browserDirectory, 'package-lock.json');
    const browserManifest = JSON.parse(
        readFileSync(browserManifestPath, 'utf8')
    );
    const browserLock = JSON.parse(readFileSync(browserLockPath, 'utf8'));
    // Preserve the committed registry resolutions; replace only the SDK pin.
    browserManifest.dependencies[packageMetadata.name] = archiveSpec;
    browserLock.packages[''].dependencies[packageMetadata.name] = archiveSpec;
    browserLock.packages[`node_modules/${packageMetadata.name}`] = {
        version: packageMetadata.version,
        resolved: archiveSpec,
        integrity: packed.integrity,
        license: packageMetadata.license,
        dependencies: packageMetadata.dependencies,
        engines: packageMetadata.engines,
    };
    for (const [name, spec] of Object.entries({
        ...browserManifest.dependencies,
        ...browserManifest.devDependencies,
    })) {
        assert(
            name === packageMetadata.name || /^\d+\.\d+\.\d+$/.test(spec),
            `Browser dependency must be pinned to the registry: ${name}`
        );
    }
    writeFileSync(browserManifestPath, JSON.stringify(browserManifest));
    writeFileSync(browserLockPath, JSON.stringify(browserLock));
    run(
        'npm',
        ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        browserDirectory
    );
    await assertInstalledArchive(browserDirectory, archivePath, packed);
    const compiled = new Set(
        run('npm', ['run', 'typecheck', '--', '--listFiles'], browserDirectory)
            .split(/\r?\n/)
            .map((path) => resolve(path))
    );
    await assertBrowserInputs(
        {
            inputs: Object.fromEntries(
                [...compiled]
                    .filter((path) => path.endsWith('.ts'))
                    .map((path) => [path, {}])
            ),
        },
        browserDirectory
    );
    function checkExampleSources(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) checkExampleSources(path);
            else if (path.endsWith('.ts')) {
                assert(
                    compiled.has(path),
                    `Example source not compiled: ${path}`
                );
            }
        }
    }
    checkExampleSources(join(browserDirectory, 'src'));
    run('npm', ['run', 'build'], browserDirectory);
    await assertBrowserInputs(
        JSON.parse(
            readFileSync(
                join(browserDirectory, '.generated/metafile.json'),
                'utf8'
            )
        ),
        browserDirectory
    );
    for (const filename of ['main.js', 'index.html', 'styles.css']) {
        assert(
            readFileSync(join(browserDirectory, '.generated', filename))
                .length > 0,
            `Missing browser build output: ${filename}`
        );
    }

    function checkPortableOutput(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) {
                checkPortableOutput(path);
            } else if (
                entry.name.endsWith('.js') ||
                entry.name.endsWith('.ts')
            ) {
                assert.doesNotMatch(
                    readFileSync(path, 'utf8'),
                    /@type-system\/|['"]@\/|\/Users\//,
                    `Non-portable package reference: ${entry.name}`
                );
            }
        }
    }
    checkPortableOutput(
        join(temporaryDirectory, 'node_modules/@miniextensions/sdk/dist')
    );
    console.log(
        `${packageMetadata.name}: packed ESM/CommonJS, declarations, doc links/quickstart, and full browser example typecheck/build passed (${packed.integrity})`
    );
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    rmSync(browserDirectory, { recursive: true, force: true });
}
