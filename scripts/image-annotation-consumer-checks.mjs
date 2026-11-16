import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const imageAnnotationTypedConsumer =
    "\nimport { createElement } from 'react';\nimport {\n    ImageAnnotationField,\n    CompleteImageAnnotationField,\n    type ImageAnnotationFieldProps,\n    type ImageAnnotationStorage,\n    type ImageAnnotationAppend,\n    type ImageAnnotationOwner,\n} from '@miniextensions/sdk/react';\ntype Upload = { temporaryId: string };\nconst token = {};\nlet current: object | null = token;\nconst owner: ImageAnnotationOwner = { token, isCurrent: () => current === token };\nconst storage: ImageAnnotationStorage<Upload> = {\n    async createTemporaryPng({ blob, filename, operation }) {\n        void blob; void filename; void operation;\n        return { temporaryId: 'synthetic' };\n    },\n    async resolveUrl(upload) { void upload.temporaryId; return 'https://example.invalid/local-only.png'; },\n};\nconst appendCurrent: ImageAnnotationAppend = ({ owner: captured, operation, attachment }) => {\n    void operation; void attachment.filename;\n    return captured === token && current === token ? 'appended' : 'retired';\n};\nconst props: ImageAnnotationFieldProps<Upload> = { owner, storage, appendCurrent, form:'native-form', ariaDescribedBy:'help' };\ncreateElement(ImageAnnotationField<Upload>, props);\ncreateElement(CompleteImageAnnotationField<Upload>, props);\n// @ts-expect-error an opaque token alone is not continuing owner authority\nconst tokenOnly: ImageAnnotationFieldProps<Upload> = { ...props, owner: token };\n// @ts-expect-error canonical append admission is synchronous, not callback completion\nconst asyncAppend: ImageAnnotationFieldProps<Upload> = { ...props, appendCurrent: async () => 'appended' };\n// @ts-expect-error complete SDK owns the editor UI; no native renderer injection\nconst nativeUI: ImageAnnotationFieldProps<Upload> = { ...props, renderEditor() { return null; } };\n// @ts-expect-error split URL resolution cannot be omitted after upload allocation\nconst noResolve: ImageAnnotationStorage<Upload> = { createTemporaryPng: storage.createTemporaryPng };\nvoid tokenOnly; void asyncAppend; void nativeUI; void noResolve;\ncurrent = null;\n";

async function checkInstalled(directory) {
    assert.equal(
        typeof globalThis.document,
        'undefined',
        'SSR import must not require DOM'
    );
    const consumer = createRequire(join(directory, 'package.json'));
    const React = consumer('react');
    const { renderToString } = consumer('react-dom/server');
    const cjs = consumer('@miniextensions/sdk/react');
    const esm = await import(
        pathToFileURL(
            join(
                directory,
                'node_modules/@miniextensions/sdk/dist/esm/react/index.js'
            )
        )
    );
    assert.equal(typeof globalThis.document, 'undefined');
    const pkgRoot = join(directory, 'node_modules/@miniextensions/sdk');
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
    // This source preparation must NOT pass package qualification on an unpinned
    // transitive/global vendor. Ordinary dependency/lock composition comes first.
    assert.equal(pkg.dependencies.markerjs2, '2.32.7');
    const notice = readFileSync(
        join(pkgRoot, 'docs/image-annotation-markerjs2-license.txt'),
        'utf8'
    );
    const blob = createHash('sha1')
        .update('blob ' + Buffer.byteLength(notice) + '\0')
        .update(notice)
        .digest('hex');
    assert.equal(blob, '0709c250e344a56c87fba438c93f08892238b939');
    const css = readFileSync(
        consumer.resolve(
            '@miniextensions/sdk/react/complete-image-annotation.css'
        ),
        'utf8'
    );
    for (const selector of [
        '.mx-sdk-image-annotation',
        '.mx-sdk-image-annotation-picker',
        '.mx-sdk-image-annotation-credit',
        ':focus-visible',
    ])
        assert(css.includes(selector));
    const groups = [];
    for (const [module, api] of [
        ['esm', esm],
        ['cjs', cjs],
    ]) {
        assert.equal(typeof api.ImageAnnotationField, 'function');
        assert.equal(
            api.CompleteImageAnnotationField,
            api.ImageAnnotationField
        );
        const token = {};
        let current = token,
            uploads = 0,
            reads = 0,
            appends = 0;
        const props = {
            owner: { token, isCurrent: () => current === token },
            storage: {
                async createTemporaryPng() {
                    uploads++;
                    throw new Error('SSR must not upload');
                },
                async resolveUrl() {
                    reads++;
                    throw new Error('SSR must not resolve');
                },
            },
            appendCurrent() {
                appends++;
                return 'retired';
            },
            id: 'annotation',
            name: 'native-image',
            form: 'native-save',
            ariaLabel: 'Image <literal>',
            ariaDescribedBy: 'native-help',
        };
        const html = renderToString(
            React.createElement(
                'form',
                { id: 'native-save' },
                React.createElement(api.ImageAnnotationField, props),
                React.createElement('button', { type: 'submit' }, 'Save')
            )
        );
        assert(html.includes('Image &lt;literal&gt;'));
        assert(html.includes('type="file"'));
        assert(html.includes('accept="image/*"'));
        assert(html.includes('form="native-save"'));
        assert(html.includes('aria-describedby="native-help"'));
        assert(html.includes('https://markerjs.com'));
        assert(html.includes('Image annotation powered by marker.js'));
        assert.equal((html.match(/<form/g) ?? []).length, 1);
        assert.deepEqual([uploads, reads, appends], [0, 0, 0]);
        current = null;
        groups.push({ module, storageCalls: 0, SSR: true });
    }
    return { react: React.version, groups: groups.length, results: groups };
}

export function checkImageAnnotationReactMatrix({
    archivePath,
    typescriptBin,
}) {
    archivePath = resolve(archivePath);
    const archiveSha256 = createHash('sha256')
        .update(readFileSync(archivePath))
        .digest('hex');
    const versions = [];
    for (const version of [
        { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
        { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
    ]) {
        const directory = mkdtempSync(join(tmpdir(), 'sdk-image-annotation-'));
        const run = (command, args) =>
            execFileSync(command, args, {
                cwd: directory,
                stdio: 'inherit',
                timeout: 120000,
            });
        const policy = {
            nodeLinker: 'hoisted',
            minimumReleaseAge: 2880,
            minimumReleaseAgeExclude: [],
            blockExoticSubdeps: true,
            strictPeerDependencies: true,
            ignoreScripts: true,
        };
        const policyText =
            Object.entries(policy)
                .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
                .join('\n') + '\n';
        try {
            writeFileSync(
                join(directory, 'package.json'),
                JSON.stringify({
                    private: true,
                    type: 'module',
                    packageManager: 'pnpm@10.28.2',
                    dependencies: {
                        '@miniextensions/sdk': 'file:' + archivePath,
                        react: version.react,
                        'react-dom': version.react,
                        '@types/react': version.types,
                        '@types/react-dom': version.domTypes,
                        '@types/node': '22.20.5',
                    },
                })
            );
            writeFileSync(join(directory, 'pnpm-workspace.yaml'), policyText);
            const pnpm = (args) =>
                execFileSync('pnpm', args, {
                    cwd: directory,
                    encoding: 'utf8',
                    timeout: 120000,
                    env: { ...process.env, COREPACK_ENABLE_AUTO_PIN: '0' },
                });
            assert.equal(pnpm(['--version']).trim(), '10.28.2');
            for (const [key, value] of Object.entries(policy))
                assert.deepEqual(
                    JSON.parse(pnpm(['config', 'get', key, '--json']).trim()),
                    value
                );
            assert.equal(
                createHash('sha256')
                    .update(readFileSync(archivePath))
                    .digest('hex'),
                archiveSha256
            );
            pnpm(['install', '--strict-peer-dependencies', '--ignore-scripts']);
            assert.equal(
                readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8'),
                policyText
            );
            const example = readFileSync(
                join(
                    directory,
                    'node_modules/@miniextensions/sdk/examples/react-image-annotation/main.ts'
                ),
                'utf8'
            );
            for (const extension of ['mts', 'cts']) {
                const name = 'image-annotation.' + extension;
                const exampleName = 'image-annotation-example.' + extension;
                writeFileSync(
                    join(directory, name),
                    imageAnnotationTypedConsumer
                );
                writeFileSync(join(directory, exampleName), example);
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    name,
                    exampleName,
                ]);
            }
            const result = JSON.parse(
                execFileSync(
                    process.execPath,
                    [
                        fileURLToPath(import.meta.url),
                        '--run-consumer',
                        directory,
                    ],
                    {
                        cwd: directory,
                        encoding: 'utf8',
                        stdio: ['ignore', 'pipe', 'inherit'],
                    }
                )
            );
            assert.equal(result.react, version.react);
            assert.equal(result.groups, 2);
            versions.push(result);
            console.log(
                'Installed image annotation React' +
                    result.react +
                    ': ESM/CJS/types/CSS/SSR and actual packed host-port example passed; vendor canvas is separate.'
            );
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    }
    return { versions, cleanup: 'completed' };
}
if (process.argv[2] === '--run-consumer')
    console.log(JSON.stringify(await checkInstalled(process.argv[3])));
