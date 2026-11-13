import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/** Run the complete component contracts against packed ESM/CJS in React 18/19. */
export function checkSignatureReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-signature-consumer-'));
    const versions = [];
    const source =
        readFileSync(
            new URL('../test/reactSignatureField.test.ts', import.meta.url),
            'utf8'
        )
            .replaceAll(
                '../src/react/SignatureField.js',
                '@miniextensions/sdk/react'
            )
            .replaceAll(
                '../src/react/signatureReceipt.js',
                '@miniextensions/sdk/react'
            )
            .replaceAll('../src/runtime/types.js', '@miniextensions/sdk')
            .replaceAll("'happy-dom'", JSON.stringify(happyDomModulePath)) +
        String.raw`
const publicContract: SignatureFieldProps = {id:'s',ownerIdentity:null,value:[],storage:{store:async()=>({attachment,release:async()=>'released'})},appendCurrent:()=>'retired',onRecovery:()=>{}};
// @ts-expect-error The complete control cannot require a native renderer slot.
const rendererSlot: SignatureFieldProps={...publicContract,renderNative:()=>null};
// @ts-expect-error Metadata-only uploads lack operation-bound release authority.
const metadataOnly: TemporarySignature={attachment};
// @ts-expect-error A queued writer is not a synchronous canonical commit result.
const queuedWrite: SignatureFieldProps={...publicContract,appendCurrent:()=>{}};
// @ts-expect-error There is only one canonical host attachment list.
const secondStore: SignatureFieldProps={...publicContract,defaultValue:[]};
void rendererSlot;void metadataOnly;void queuedWrite;void secondStore;
`;
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: {
                    '@miniextensions/sdk': 'file:' + resolve(archivePath),
                },
            })
        );
        for (const version of [
            { react: '18.3.1', types: '18.3.12', dom: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', dom: '19.2.2' },
        ]) {
            execFileSync(
                'npm',
                [
                    'install',
                    '--ignore-scripts',
                    '--strict-peer-deps',
                    '--no-audit',
                    '--no-fund',
                    '--package-lock=false',
                    '--cache',
                    join(directory, 'npm-cache'),
                    '@types/node@22.20.5',
                    'react@' + version.react,
                    'react-dom@' + version.react,
                    '@types/react@' + version.types,
                    '@types/react-dom@' + version.dom,
                ],
                { cwd: directory, stdio: 'inherit' }
            );
            for (const extension of ['mts', 'cts']) {
                const name = 'signature.' + extension;
                writeFileSync(join(directory, name), source);
                execFileSync(
                    process.execPath,
                    [
                        typescriptBin,
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
                    ],
                    { cwd: directory, stdio: 'inherit' }
                );
                execFileSync(
                    process.execPath,
                    [
                        '--test',
                        '--test-concurrency=1',
                        'signature.' + (extension === 'mts' ? 'mjs' : 'cjs'),
                    ],
                    { cwd: directory, stdio: 'inherit' }
                );
            }
            const css = execFileSync(
                process.execPath,
                [
                    '--input-type=module',
                    '-e',
                    `import{createRequire}from'node:module';import{readFileSync}from'node:fs';const require=createRequire(import.meta.url);const css=readFileSync(require.resolve('@miniextensions/sdk/react/signature.css'),'utf8');if(!css.includes('.mx-sdk-signature-canvas')||css.includes('@tailwind'))throw Error('Missing portable signature CSS');`,
                ],
                { cwd: directory, encoding: 'utf8' }
            );
            assert.equal(css, '');
            versions.push({
                react: version.react,
                formats: ['esm', 'cjs'],
                status: 'passed',
            });
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
