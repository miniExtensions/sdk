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
import {createNativeFormProgressStorage} from '@miniextensions/sdk/forms';
import {useNativeFormProgress,FormProgressConflictAlert,type NativeFormProgressOptions,type NativeFormProgressPorts,type NativeFormProgressRead} from '@miniextensions/sdk/react';
const read:NativeFormProgressRead={shareId:'synthetic',revision:null,writerId:null};
const ports:NativeFormProgressPorts={
 readSnapshot:()=>undefined,remove:()=>true,getWriterId:()=> 'writer',
 write:args=>createNativeFormProgressStorage({shareId:args.shareId,writerId:args.writerId,getStorage:()=>localStorage}).write(args),
 subscribeStorage(listener){window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);},
};
const props:NativeFormProgressOptions={shareId:'synthetic',configurationEligible:true,record:{type:'create',data:{hidden:'retained'}},progressRead:read,ports};
function Consumer(){const result=useNativeFormProgress(props);return result.hasConflict?createElement(FormProgressConflictAlert):null;}
void Consumer;
useNativeFormProgress({...props,progressRead:undefined});
// @ts-expect-error explicit absence has both null revision and writer
const incomplete:NativeFormProgressRead={shareId:'synthetic',revision:null};
// @ts-expect-error eligibility is an explicit host decision
useNativeFormProgress({shareId:'synthetic',record:props.record,ports});
// @ts-expect-error the SDK owns complete conflict rendering and lifecycle
useNativeFormProgress({...props,renderConflict(){return null;}});
// @ts-expect-error every admitted lifecycle write forwards a post-lock guard
ports.write({shareId:'synthetic',writerId:'writer',record:{},expectedRevision:null});
void incomplete;
`;

export function checkSavedProgressReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-saved-progress-'));
    const run = (command, args, options = {}) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: 'inherit',
            ...options,
        });
    const versions = [];
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
            new URL('./saved-progress-consumer-checks.mjs', import.meta.url),
            join(directory, 'scenarios.mjs')
        );
        writeFileSync(
            join(directory, 'runtime.mjs'),
            String.raw`
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {renderToString} from 'react-dom/server';
import {assertSavedProgressConsumer} from './scenarios.mjs';
const require=createRequire(import.meta.url),format=process.argv[2];
assert.equal(typeof window,'undefined');assert.equal(typeof document,'undefined');
const ui=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const forms=format==='esm'?await import('@miniextensions/sdk/forms'):require('@miniextensions/sdk/forms');
const {Window}=require(process.argv[3]);
const result=await assertSavedProgressConsumer({React,ui,forms,Window,createRoot,renderToString});
assert.equal(result.pendingLocks,0);assert.equal(result.ssrCalls,0);
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
                join(installed, 'docs/saved-progress.md'),
                'utf8'
            ).match(/```tsx\n([\s\S]*?)\n```/)?.[1];
            assert(guide, 'Missing packed lifecycle recipe');
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
                formats.push(result);
            }
            const css = readFileSync(
                join(installed, 'dist/esm/react/form-progress.css')
            );
            assert(css.length > 0);
            assert(
                css.equals(
                    readFileSync(
                        join(installed, 'dist/cjs/react/form-progress.css')
                    )
                )
            );
            run(process.execPath, [
                '--input-type=module',
                '-e',
                `import assert from'node:assert/strict';import{createRequire}from'node:module';const r=createRequire(import.meta.url);r.resolve('@miniextensions/sdk/react/form-progress.css');const{buildSync}=r(${JSON.stringify(esbuildModulePath)});for(const format of ['esm','cjs']){const result=buildSync({stdin:{contents:format==='esm'?"import{useNativeFormProgress,FormProgressConflictAlert}from'@miniextensions/sdk/react';import'@miniextensions/sdk/react/form-progress.css';console.log(useNativeFormProgress,FormProgressConflictAlert)":"require('@miniextensions/sdk/react/form-progress.css');console.log(require('@miniextensions/sdk/react').useNativeFormProgress)",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',outdir:'browser-output',write:false,logLevel:'silent'});assert(result.outputFiles.some(file=>file.path.endsWith('.css')&&file.text.includes('.mx-sdk-form-progress-conflict')));}`,
            ]);
            versions.push({ react: version.react, formats });
            console.log(
                `Installed saved-progress React ${version.react}: ESM/CJS/types/exact optional/CSS/SSR and synthetic lifecycle controls passed.`
            );
        }
        return { versions, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
