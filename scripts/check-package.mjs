import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
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
import { checkUiRecipes } from './ui-recipe-checks.mjs';
import { checkFormRecipe } from './form-recipe-checks.mjs';

const require = createRequire(import.meta.url);
const temporaryDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'miniextensions-sdk-'))
);
// A sibling temp root has no generic consumer node_modules in its ancestry.
const browserDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'miniextensions-browser-'))
);
const uiDirectory = realpathSync(
    mkdtempSync(join(tmpdir(), 'miniextensions-ui-'))
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
                path === 'docs/ui.md' ||
                path === 'docs/forms.md' ||
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
    const uiGuide = readFileSync(join(installedPackage, 'docs/ui.md'), 'utf8');
    const uiGuideSources = [...uiGuide.matchAll(/```ts\n([\s\S]*?)\n```/g)].map(
        ([, code], index) => {
            const filename = `ui-guide-${index}.ts`;
            writeFileSync(join(temporaryDirectory, filename), code);
            return filename;
        }
    );
    assert(uiGuideSources.length > 0, 'Missing complete UI guide examples');
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        ...uiGuideSources,
    ]);

    await checkUiRecipes({
        consumerDirectory: temporaryDirectory,
        guideSources: uiGuideSources,
        happyDomModulePath: require.resolve('happy-dom'),
    });

    const formsGuide = readFileSync(
        join(installedPackage, 'docs/forms.md'),
        'utf8'
    );
    const formsGuideSources = [
        ...formsGuide.matchAll(/```ts\n([\s\S]*?)\n```/g),
    ].map(([, code], index) => {
        const filename = `forms-guide-${index}.ts`;
        writeFileSync(join(temporaryDirectory, filename), code);
        return filename;
    });
    assert(
        formsGuideSources.length > 0,
        'Missing complete Form helper recipes'
    );
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        ...formsGuideSources,
    ]);
    await checkFormRecipe({
        consumerDirectory: temporaryDirectory,
        guideSources: formsGuideSources,
        happyDomModulePath: require.resolve('happy-dom'),
    });

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

    for (const dependency of ['react', 'vue', 'happy-dom']) {
        assert(
            !existsSync(join(temporaryDirectory, 'node_modules', dependency)),
            `UI/test dependency leaked into package consumers: ${dependency}`
        );
    }
    const uiConsumer = `
import { createSelectionModel, createSelectControl, mountSelectionControl, createFormLinkedRecordLoader, createPortalLinkedRecordLoader } from '@miniextensions/sdk/ui';
if ([createSelectControl, mountSelectionControl, createFormLinkedRecordLoader, createPortalLinkedRecordLoader].some(value => typeof value !== 'function')) throw new Error('Missing public UI export');
const selection = createSelectionModel({ multiple: true, options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] });
selection.choose(['one', 'two']);
if (selection.getState().value.join(',') !== 'one,two') throw new Error('Packed selection model failed');
selection.destroy();
`;
    writeFileSync(join(temporaryDirectory, 'ui-consumer.mjs'), uiConsumer);
    run(process.execPath, ['ui-consumer.mjs']);
    writeFileSync(
        join(temporaryDirectory, 'ui-consumer.cjs'),
        `const { createSelectionModel, createSelectControl } = require('@miniextensions/sdk/ui');
if (typeof createSelectControl !== 'function') throw new Error('Missing CJS UI export');
const selection = createSelectionModel({options:[{value:'one',label:'One'}]});
selection.choose(['one']);
if (selection.getState().value[0] !== 'one') throw new Error('Packed CJS selection failed');
selection.destroy();\n`
    );
    run(process.execPath, ['ui-consumer.cjs']);

    const formsConsumer = `
import { FormDraftStore, openLoadedFormDraft, createFormSaveInput, normalizeFormSaveResult, describeLoadedFormFields, createFormController } from '@miniextensions/sdk/forms';
if ([openLoadedFormDraft, createFormSaveInput, normalizeFormSaveResult, describeLoadedFormFields, createFormController].some(value => typeof value !== 'function')) throw new Error('Missing Form helper export');
const store = new FormDraftStore();
const draft = store.open({extensionId:'extExample',recordId:null,parent:null},{fldExample:['Design']},[]);
store.write(draft,'fldExample',['Design','Support']);
if (store.snapshot(draft)?.data.fldExample.join(',') !== 'Design,Support') throw new Error('Packed Form draft failed');
store.clear();
if (store.snapshot(draft) !== null) throw new Error('Packed Form draft did not expire');
`;
    writeFileSync(
        join(temporaryDirectory, 'forms-consumer.mjs'),
        formsConsumer
    );
    run(process.execPath, ['forms-consumer.mjs']);
    writeFileSync(
        join(temporaryDirectory, 'forms-consumer.cjs'),
        `const { FormDraftStore, createFormController } = require('@miniextensions/sdk/forms');
if (typeof createFormController !== 'function') throw new Error('Missing CommonJS Form controller export');
const store = new FormDraftStore();
const draft = store.open({extensionId:'extExample',recordId:null,parent:null},{fldExample:'Draft'},[]);
if (store.snapshot(draft)?.data.fldExample !== 'Draft') throw new Error('CommonJS Form draft failed');
store.clear();\n`
    );
    run(process.execPath, ['forms-consumer.cjs']);

    const declarationConsumer =
        consumer +
        `
import { createSelectControl, mountSelectionControl, createSelectionModel, createFormLinkedRecordLoader, createPortalLinkedRecordLoader, type SelectionLoader } from '@miniextensions/sdk/ui';
import type { MiniExtensionsClient, ListFormLinkedRecordOptionsInput, ListPortalLinkedRecordOptionsInput } from '@miniextensions/sdk';
export function checkUiTypes(field: RuntimeFieldSchema, host: HTMLElement, client: MiniExtensionsClient, form: Omit<ListFormLinkedRecordOptionsInput, 'filter'|'offset'>, portal: Omit<ListPortalLinkedRecordOptionsInput, 'filter'|'offset'>) {
    const native = createSelectControl({field, value: null, onChange: value => void value});
    host.append(native.element);
    const formLoader: SelectionLoader = createFormLinkedRecordLoader({client, input: form, linkedTableId: 'tblExample'});
    const portalLoader: SelectionLoader = createPortalLinkedRecordLoader({client, input: portal, linkedTableId: 'tblExample'});
    const model = createSelectionModel({multiple: true, loadOptions: formLoader});
    const linked = mountSelectionControl(model, {label: 'Projects', formatLabel: option => option.label});
    host.append(linked.element);
    model.reset({loadOptions: portalLoader});
    linked.destroy(); model.destroy(); native.destroy();
}
import type { FormLoadedResult, RuntimeFieldSchema } from '@miniextensions/sdk';
import { FormDraftStore, openLoadedFormDraft, createFormSaveInput, normalizeFormSaveResult, describeLoadedFormFields, createFormController, type FormSaveOptions, type FormOwnerScope } from '@miniextensions/sdk/forms';
export function checkFormHelpers(loaded: FormLoadedResult, client: MiniExtensionsClient, options: FormSaveOptions, getScope: () => FormOwnerScope) {
    const store = new FormDraftStore<AirtableValue>();
    const draft = openLoadedFormDraft({store, loaded});
    const snapshot = store.snapshot(draft);
    if (snapshot !== null) createFormSaveInput({loaded, draft: snapshot, options});
    const descriptors = describeLoadedFormFields(loaded);
    const controller = createFormController({client, loaded, saveOptions: options, getScope, store});
    controller.subscribe(state => void state.validationErrors);
    controller.write(descriptors[0]?.fieldId ?? 'fldExample', ['Design']);
    controller.save().then(result => normalizeFormSaveResult(result.raw, loaded));
    controller.destroy();
}
import type { AirtableValue } from '@miniextensions/sdk';
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
        metafile: true,
    });
    assert(
        !Object.keys(bundled.metafile.inputs).some((path) =>
            /\/sdk\/dist\/esm\/(?:ui|forms)\//.test(path)
        ),
        'Core consumer unexpectedly bundled optional UI/Form helpers'
    );
    const browserContext = { URL, TextEncoder, fetch };
    runInNewContext(bundled.outputFiles[0].text, browserContext, {
        timeout: 10000,
    });
    assert.equal(browserContext.miniExtensionsFormulaExample.result, 12);

    // React is an optional host framework, never an SDK dependency. Check the
    // actual documented recipe only after proving dependency-free UI imports.
    const reactRecipes = [...uiGuide.matchAll(/```tsx\n([\s\S]*?)\n```/g)];
    assert(reactRecipes.length > 0, 'Missing React mount/dispose recipe');
    run('npm', [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        'react@19.2.0',
        '@types/react@19.2.2',
    ]);
    const reactSources = reactRecipes.map(([, code], index) => {
        const filename = `ui-react-${index}.tsx`;
        writeFileSync(join(temporaryDirectory, filename), code);
        return filename;
    });
    run(process.execPath, [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--jsx',
        'react-jsx',
        ...reactSources,
    ]);

    for (const [example, directory] of [
        ['browser', browserDirectory],
        ['ui-selection', uiDirectory],
    ]) {
        cpSync(`examples/${example}`, directory, {
            recursive: true,
            filter: (path) =>
                !/(?:^|[/\\])(?:node_modules|\.generated)(?:[/\\]|$)/.test(
                    path
                ),
        });
        const archivePath = join(temporaryDirectory, packed.filename);
        const archiveSpec = `file:${archivePath}`;
        const browserManifestPath = join(directory, 'package.json');
        const browserLockPath = join(directory, 'package-lock.json');
        const browserManifest = JSON.parse(
            readFileSync(browserManifestPath, 'utf8')
        );
        const browserLock = JSON.parse(readFileSync(browserLockPath, 'utf8'));
        // Preserve the committed registry resolutions; replace only the SDK pin.
        browserManifest.dependencies[packageMetadata.name] = archiveSpec;
        browserLock.packages[''].dependencies[packageMetadata.name] =
            archiveSpec;
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
            directory
        );
        await assertInstalledArchive(directory, archivePath, packed);
        const compiled = new Set(
            run('npm', ['run', 'typecheck', '--', '--listFiles'], directory)
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
            directory
        );
        function checkExampleSources(directory) {
            for (const entry of readdirSync(directory, {
                withFileTypes: true,
            })) {
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
        checkExampleSources(join(directory, 'src'));
        run('npm', ['run', 'build'], directory);
        await assertBrowserInputs(
            JSON.parse(
                readFileSync(
                    join(directory, '.generated/metafile.json'),
                    'utf8'
                )
            ),
            directory
        );
        for (const filename of ['main.js', 'index.html', 'styles.css']) {
            assert(
                readFileSync(join(directory, '.generated', filename)).length >
                    0,
                `Missing browser build output: ${filename}`
            );
        }
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
        `${packageMetadata.name}: packed core/UI/Form ESM/CommonJS, declarations, doc links/recipes (6 UI lifecycle and 4 Form recipe cases), and full browser/UI examples typecheck/build passed (${packed.integrity})`
    );
} finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    rmSync(browserDirectory, { recursive: true, force: true });
    rmSync(uiDirectory, { recursive: true, force: true });
}
