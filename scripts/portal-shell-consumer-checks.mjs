import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    cpSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const typed = String.raw`
import {createElement} from 'react';
import {resolvePortalShellSelection,type PortalShellMenuItem,type PortalShellIntent} from '@miniextensions/sdk/portals';
import {CompletePortalShell,type CompletePortalShellProps,type PortalShellSnapshot} from '@miniextensions/sdk/react';
const items:readonly PortalShellMenuItem[]=[{type:'table',id:'orders',label:'Orders'}];
const snapshot:PortalShellSnapshot={scope:'public:user',revision:1,items,selection:resolvePortalShellSelection({items,phase:'initial',initialSelection:{itemId:'orders'}}),header:{layout:'sidebar',title:'Portal'}};
const props:CompletePortalShellProps={snapshot,onIntent(intent:PortalShellIntent){if(intent.type==='navigate')console.log(intent.selection.itemId);}};
createElement(CompletePortalShell,props);
// @ts-expect-error SDK owns navigation presentation
const nativeMenu:CompletePortalShellProps={...props,renderMenu(){return null;}};
// @ts-expect-error no implicit host record loading API
const fetcher:CompletePortalShellProps={...props,fetchRecords(){}};
// @ts-expect-error owner/revision envelope is required
const unscoped:PortalShellIntent={type:'logout'};
void nativeMenu;void fetcher;void unscoped;
`;

export function checkPortalShellReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-portal-shell-'));
    const versions = [];
    const run = (command, args, options = {}) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: 'inherit',
            ...options,
        });
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: { '@miniextensions/sdk': `file:${archivePath}` },
            })
        );
        cpSync(
            new URL('./portal-shell-runtime.mjs', import.meta.url),
            join(directory, 'scenarios.mjs')
        );
        writeFileSync(
            join(directory, 'runtime.mjs'),
            String.raw`
import assert from 'node:assert/strict';import{createRequire}from'node:module';
import React from'react';import{createRoot}from'react-dom/client';import{renderToString}from'react-dom/server';
import{assertPortalShellConsumer}from'./scenarios.mjs';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof window,'undefined');assert.equal(typeof document,'undefined');
const ui=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const portals=format==='esm'?await import('@miniextensions/sdk/portals'):require('@miniextensions/sdk/portals');
assert.equal(typeof window,'undefined');assert.equal(typeof document,'undefined');
const{Window}=require(process.argv[3]);
const result=await assertPortalShellConsumer({React,ui,portals,Window,createRoot,renderToString});
console.log(JSON.stringify({format,react:React.version,...result}));
`
        );
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            run('npm', [
                'install',
                '--ignore-scripts',
                '--strict-peer-deps',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                `react@${version.react}`,
                `react-dom@${version.react}`,
                `@types/react@${version.types}`,
                `@types/react-dom@${version.domTypes}`,
            ]);
            const installed = join(
                directory,
                'node_modules/@miniextensions/sdk'
            );
            const guide = readFileSync(
                join(installed, 'docs/portal-shell.md'),
                'utf8'
            ).match(/```tsx\n([\s\S]*?)\n```/)?.[1];
            assert(guide, 'Missing packed host-boundary recipe');
            for (const extension of ['mts', 'cts']) {
                writeFileSync(join(directory, `consumer.${extension}`), typed);
                writeFileSync(join(directory, `guide.${extension}`), guide);
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--exactOptionalPropertyTypes',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    `consumer.${extension}`,
                    `guide.${extension}`,
                ]);
            }
            const formats = [];
            for (const format of ['esm', 'cjs']) {
                const result = JSON.parse(
                    run(
                        process.execPath,
                        ['runtime.mjs', format, happyDomModulePath],
                        {
                            encoding: 'utf8',
                            stdio: ['ignore', 'pipe', 'inherit'],
                        }
                    )
                );
                assert.equal(result.react, version.react);
                assert.equal(result.navigationIntents, 4);
                assert.equal(result.implicitNetworkRequests, 0);
                formats.push(result);
            }
            const css = readFileSync(
                join(installed, 'dist/esm/react/portal-shell.css')
            );
            assert(
                css.equals(
                    readFileSync(
                        join(installed, 'dist/cjs/react/portal-shell.css')
                    )
                )
            );
            assert(css.includes('.mx-sdk-portal-shell'));
            assert(css.includes('forced-colors'));
            run(process.execPath, [
                '--input-type=module',
                '-e',
                `import assert from'node:assert/strict';import{createRequire}from'node:module';const r=createRequire(import.meta.url);r.resolve('@miniextensions/sdk/react/portal-shell.css');const{buildSync}=r(${JSON.stringify(esbuildModulePath)});for(const format of ['esm','cjs']){const result=buildSync({stdin:{contents:format==='esm'?"import{CompletePortalShell}from'@miniextensions/sdk/react';import'@miniextensions/sdk/react/portal-shell.css';console.log(CompletePortalShell)":"require('@miniextensions/sdk/react/portal-shell.css');console.log(require('@miniextensions/sdk/react').CompletePortalShell)",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});assert(result.outputFiles.some(file=>file.path.endsWith('.css')&&file.text.includes('.mx-sdk-portal-shell')));}`,
            ]);
            versions.push({ react: version.react, formats });
            console.log(
                `Installed Portal shell React ${version.react}: ESM/CJS/types/CSS/SSR and controlled navigation passed.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
