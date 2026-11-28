import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { execPackageFileSync } from './package-manager-launch.mjs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const sdkRoot = fileURLToPath(new URL('..', import.meta.url));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const testFiles = [
    'readonlyPrintDocument',
    'reactReadonlyPrintDocument',
    'printableForm',
    'printableDOM',
    'reactPrintableForm',
];
const expectedTestCount = 51;
const publicImports = new Map([
    ['../src/ui/readonlyPrintDocument.js', '@miniextensions/sdk/ui'],
    ['../src/ui/printableForm.js', '@miniextensions/sdk/ui'],
    ['../src/ui/printableDOM.js', '@miniextensions/sdk/ui'],
    ['../src/react/ReadonlyPrintDocumentView.js', '@miniextensions/sdk/react'],
    ['../src/react/PrintableForm.js', '@miniextensions/sdk/react'],
    ['../src/react/printableFormEngine.js', '@miniextensions/sdk/react'],
    ['../src/react/PrintableFormJobControls.js', '@miniextensions/sdk/react'],
]);
export const printableFormTypedConsumer = `
import {createElement,createRef} from 'react';
import {PrintableForm,PrintableFormPreparationControls,createBrowserPrintableFormEngine,createBrowserReadonlyDOMPrintEngine,type PrintableFormHandle} from '@miniextensions/sdk/react';
import {createPrintableFormController,createReadonlyDOMPrintController,getDocumentPrintableFormAdmission,type PrintableFormSource,type ReadonlyDOMPrintSource} from '@miniextensions/sdk/ui';
declare const document:Document;
declare const source:PrintableFormSource;
declare const nativeSource:ReadonlyDOMPrintSource;
const labels={print:'Print',preparing:'Preparing',cancel:'Cancel',invoked:'Requested',unknown:'Unknown',failed:'Failed',done:'Closed'};
const admission=getDocumentPrintableFormAdmission(document);
const engine=createBrowserPrintableFormEngine(document,labels);
const controller=createPrintableFormController({source,admission,engine});
const fallback=createReadonlyDOMPrintController({source:nativeSource,admission,engine:createBrowserReadonlyDOMPrintEngine(document,labels)});
createElement(PrintableForm,{source,admission,labels,ref:createRef<PrintableFormHandle>()});
createElement(PrintableFormPreparationControls,{controller:fallback,labels});
const receipt=controller.request('keyboard');
if(receipt.status==='admitted') receipt.job.cancelBeforeInvocation();
// @ts-expect-error authority admission is synchronous
const asyncSource:PrintableFormSource={...source,readAuthority:async()=>null};
// @ts-expect-error a whole retained native root requires an explicit release
const missingRelease:ReadonlyDOMPrintSource={...nativeSource,capture:()=>({status:'accepted',document:{element:document.body}})};
void asyncSource;void missingRelease;
`;

function files(root, relative = '') {
    const result = [];
    for (const entry of readdirSync(join(root, relative), {
        withFileTypes: true,
    })) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) result.push(...files(root, name));
        else {
            assert(entry.isFile(), 'Packed installation contains a non-file');
            result.push(name);
        }
    }
    return result.sort();
}

/** Original assertions, public imports only; each React/format has its own process. */
export async function checkPrintableFormReactMatrix({
    archivePath,
    packedMetadata,
    typescriptBin,
}) {
    archivePath = realpathSync(archivePath);
    const archive = readFileSync(archivePath);
    const archiveSha256 = sha(archive);
    assert.equal(
        packedMetadata.integrity,
        `sha512-${createHash('sha512').update(archive).digest('base64')}`
    );
    const profiles = [];
    for (const version of ['18.3.1', '19.2.0']) {
        const root = realpathSync(
            mkdtempSync(join(tmpdir(), 'sdk-printable-form-'))
        );
        const manifest = {
            private: true,
            type: 'module',
            packageManager: 'pnpm@10.28.2',
            dependencies: {
                '@miniextensions/sdk': `file:${archivePath}`,
                react: version,
                'react-dom': version,
                '@types/react': version === '18.3.1' ? '18.3.12' : '19.2.2',
                '@types/react-dom': version === '18.3.1' ? '18.3.1' : '19.2.2',
                '@types/node': '22.20.5',
                'happy-dom': '20.0.11',
            },
        };
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
            assert.deepEqual(readdirSync(root), []);
            writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
            writeFileSync(join(root, 'pnpm-workspace.yaml'), policyText);
            const pnpm = (args) =>
                execPackageFileSync('pnpm', args, {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 120000,
                    env: {
                        ...process.env,
                        COREPACK_ENABLE_AUTO_PIN: '0',
                        COREPACK_ENABLE_NETWORK: '0',
                    },
                });
            assert.equal(pnpm(['--version']).trim(), '10.28.2');
            for (const [key, value] of Object.entries(policy))
                assert.deepEqual(
                    JSON.parse(pnpm(['config', 'get', key, '--json'])),
                    value
                );
            assert.equal(sha(readFileSync(archivePath)), archiveSha256);
            pnpm(['install', '--strict-peer-dependencies', '--ignore-scripts']);
            assert.equal(
                readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
                policyText
            );
            assert.deepEqual(
                JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
                manifest
            );
            assert(!existsSync(join(root, 'package-lock.json')));
            const lockSha256 = sha(readFileSync(join(root, 'pnpm-lock.yaml')));
            // Compare every actual archive byte. No fabricated npm lock or source alias.
            const installed = join(root, 'node_modules/@miniextensions/sdk');
            assert(lstatSync(installed).isDirectory());
            assert.equal(realpathSync(installed), installed);
            const expected = join(root, 'expected-archive');
            mkdirSync(expected);
            const members = execFileSync('tar', ['-tzf', '-'], {
                input: archive,
                encoding: 'utf8',
            })
                .trim()
                .split('\n');
            for (const member of members)
                assert(
                    /^package\//.test(member) &&
                        !member.split('/').includes('..') &&
                        !member.includes('\\')
                );
            execFileSync('tar', ['-xz', '-C', expected], { input: archive });
            const expectedFiles = packedMetadata.files
                .map(({ path }) => path)
                .sort();
            assert.deepEqual(files(join(expected, 'package')), expectedFiles);
            assert.deepEqual(files(installed), expectedFiles);
            for (const file of expectedFiles)
                assert.deepEqual(
                    readFileSync(join(installed, file)),
                    readFileSync(join(expected, 'package', file)),
                    `Installed archive bytes differ: ${file}`
                );
            rmSync(expected, { recursive: true });
            for (const extension of ['mts', 'cts']) {
                const path = join(root, `printable-form.${extension}`);
                writeFileSync(path, printableFormTypedConsumer);
                execFileSync(
                    process.execPath,
                    [
                        typescriptBin,
                        '--strict',
                        '--noEmit',
                        '--target',
                        'ES2022',
                        '--module',
                        'NodeNext',
                        '--moduleResolution',
                        'NodeNext',
                        '--types',
                        'node,react',
                        path,
                    ],
                    { cwd: root, stdio: 'pipe', timeout: 120000 }
                );
            }
            const require = createRequire(join(root, 'package.json'));
            assert.equal(require('react').version, version);
            assert.equal(require('react-dom').version, version);
            const css = readFileSync(
                require.resolve('@miniextensions/sdk/react/printable-form.css')
            );
            assert.match(css.toString(), /\.mx-sdk-print-document/);
            assert.match(css.toString(), /@media print/);
            const formats = [];
            for (const format of ['esm', 'cjs']) {
                const tests = [];
                const names = new Map([
                    ['@miniextensions/sdk/ui', new Set()],
                    ['@miniextensions/sdk/react', new Set()],
                ]);
                for (const file of testFiles) {
                    const original = readFileSync(
                        join(sdkRoot, 'test', `${file}.test.ts`),
                        'utf8'
                    );
                    const adapted = original.replace(
                        /(['"])(\.\.\/src\/[^'"]+)\1/g,
                        (_, quote, path) => {
                            assert(
                                publicImports.has(path),
                                `Unmapped private test import: ${path}`
                            );
                            return quote + publicImports.get(path) + quote;
                        }
                    );
                    let code = transformSync(adapted, {
                        loader: 'ts',
                        format: 'esm',
                        target: 'es2022',
                    }).code;
                    assert(!code.includes('../src/'));
                    for (const [module, imported] of names) {
                        const escaped = module.replaceAll('/', '\\/');
                        for (const match of code.matchAll(
                            new RegExp(
                                `import\\s*\\{([^}]+)\\}\\s*from\\s*["']${escaped}["']`,
                                'g'
                            )
                        )) {
                            for (const name of match[1].split(','))
                                imported.add(name.trim().split(/\s+as\s+/)[0]);
                        }
                        if (format === 'cjs')
                            code = code.replaceAll(
                                `"${module}"`,
                                `"./${module.endsWith('/ui') ? 'ui' : 'react'}-require.mjs"`
                            );
                    }
                    const destination = join(
                        root,
                        `${format}-${file}.test.mjs`
                    );
                    writeFileSync(destination, code);
                    tests.push(destination);
                }
                if (format === 'cjs')
                    for (const [module, imported] of names) {
                        for (const name of imported)
                            assert(/^[A-Za-z_$][\w$]*$/.test(name));
                        writeFileSync(
                            join(
                                root,
                                `${module.endsWith('/ui') ? 'ui' : 'react'}-require.mjs`
                            ),
                            `import {createRequire} from 'node:module';const api=createRequire(import.meta.url)(${JSON.stringify(module)});\n` +
                                [...imported]
                                    .map(
                                        (name) =>
                                            `export const ${name}=api.${name};`
                                    )
                                    .join('\n')
                        );
                    }
                const output = execFileSync(
                    process.execPath,
                    [
                        '--test',
                        '--test-reporter=tap',
                        '--test-concurrency=1',
                        ...tests,
                    ],
                    {
                        cwd: root,
                        encoding: 'utf8',
                        timeout: 120000,
                        maxBuffer: 8 * 1024 * 1024,
                    }
                );
                assert.match(
                    output,
                    new RegExp(`^# tests ${expectedTestCount}$`, 'm')
                );
                assert.match(
                    output,
                    new RegExp(`^# pass ${expectedTestCount}$`, 'm')
                );
                assert.match(output, /# fail 0\b/);
                formats.push({
                    format,
                    tests: expectedTestCount,
                    originalAssertions: true,
                    publicEntries: true,
                    outputSha256: sha(output),
                });
            }
            assert.equal(sha(readFileSync(archivePath)), archiveSha256);
            profiles.push({
                version,
                archiveSha256,
                lockSha256,
                policy,
                installedArchiveBytes: true,
                types: ['NodeNext ESM', 'NodeNext CJS'],
                cssSha256: sha(css),
                formats,
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
            assert(!existsSync(root));
        }
    }
    return { profiles, cleanup: 'completed', actualBrowserPreview: false };
}
