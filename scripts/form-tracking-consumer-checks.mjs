import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const typed = `import {createElement} from 'react';
import {captureFormTrackingPolicy,prepareAllocatedFormTracking,readBrowserFormLocation,type CapturedFormTrackingPolicy,type FormLocationReader} from '@miniextensions/sdk/forms';
import {CompleteFormTrackingDisclosure,type CompleteFormTrackingDisclosureProps} from '@miniextensions/sdk/react';
const policy:CapturedFormTrackingPolicy=captureFormTrackingPolicy({enableTracking:true,userLatitudeField:'lat'});
const readLocation:FormLocationReader=()=>readBrowserFormLocation();
const props:CompleteFormTrackingDisclosureProps={policy,labels:{ipAddress:'IP',location:'Location'},isLastPage:true,readOnly:false,preview:false};
createElement(CompleteFormTrackingDisclosure,props);
prepareAllocatedFormTracking({policy,readLocation}).then(value=>{const latitude:number|undefined=value.latitude;void latitude;});
// @ts-expect-error policy is immutable
policy.collectLatitude=false;
// @ts-expect-error a mutable current-config getter is not an allocated policy
prepareAllocatedFormTracking({policy:()=>policy,readLocation});
// @ts-expect-error explicit allocation requires a reader adapter
prepareAllocatedFormTracking({policy});
// @ts-expect-error native visibility gates must be explicit
createElement(CompleteFormTrackingDisclosure,{policy,labels:props.labels});
// @ts-expect-error no automatic controller async tracking hook
import type {FormControllerOptions} from '@miniextensions/sdk/forms'; const controller:FormControllerOptions={prepareTracking:readLocation};
void controller;
`;

const runtime = String.raw`import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import React from 'react';
const require=createRequire(import.meta.url),format=process.argv[2],mode=process.argv[3];
let reads=0;
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'synthetic-tracking-consumer',geolocation:{getCurrentPosition(){reads++;throw new Error('unexpected browser call');}}}});
const forms=format==='esm'?await import('@miniextensions/sdk/forms'):require('@miniextensions/sdk/forms');
const api=format==='esm'?await import('@miniextensions/sdk/react'):require('@miniextensions/sdk/react');
const {renderToString}=await import('react-dom/server');
const policy=forms.captureFormTrackingPolicy({enableTracking:true,userIPAddressField:'ip',userLatitudeField:'lat'});
const props={policy,labels:{ipAddress:'IP collectée',location:'<Location>'},isLastPage:true,readOnly:false,preview:false};
const node=()=>React.createElement(api.CompleteFormTrackingDisclosure,props);
const html=renderToString(node());
assert(html.includes('&lt;Location&gt;'));assert.equal((html.match(/role="alert"/g)||[]).length,2);assert.equal(reads,0);
for(const config of [{enableTracking:false,userLatitudeField:'retained'},{enableTracking:true,userIPAddressField:'ip'}]){
 let inactiveCalls=0;assert.deepEqual(await forms.prepareAllocatedFormTracking({policy:forms.captureFormTrackingPolicy(config),async readLocation(){inactiveCalls++;return {lat:1,long:2};}}),{});assert.equal(inactiveCalls,0);
}
let calls=0;assert.deepEqual(await forms.prepareAllocatedFormTracking({policy,async readLocation(){calls++;return {lat:0,long:9};}}),{latitude:0,longitude:undefined});assert.equal(calls,1);
assert.equal(reads,0);
if(mode==='dom'){
 const {Window}=require(process.argv[4]);const window=new Window();
 for(const key of ['window','document','HTMLElement'])Object.defineProperty(globalThis,key,{configurable:true,value:window[key]});
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const {hydrateRoot}=await import('react-dom/client');
 const container=window.document.createElement('main');window.document.body.append(container);container.innerHTML=html;const first=container.firstChild;
 let root;await React.act(async()=>{root=hydrateRoot(container,node());});assert.equal(container.firstChild,first);
 await React.act(async()=>{root.render(React.createElement(api.CompleteFormTrackingDisclosure,{...props,readOnly:true}));});assert.equal(container.textContent,'');
 await React.act(async()=>{root.render(React.createElement(api.CompleteFormTrackingDisclosure,{...props,labels:{ipAddress:'IP',location:'位置情報'},policy:forms.captureFormTrackingPolicy({enableTracking:true,userLongitudeField:'long'})}));});assert.equal(container.textContent,'位置情報');
 await React.act(async()=>root.unmount());await window.happyDOM.abort();
}
assert.equal(reads,0);console.log(JSON.stringify({format,mode,react:React.version,reads}));
`;

export function checkFormTrackingReactMatrix({
    archivePath,
    typescriptBin,
    happyDomModulePath,
    esbuildModulePath,
}) {
    const directory = mkdtempSync(join(tmpdir(), 'sdk-form-tracking-'));
    const profiles = [];
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
        writeFileSync(join(directory, 'runtime.mjs'), runtime);
        for (const version of [
            { react: '18.3.1', types: '18.3.12', dom: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', dom: '19.2.2' },
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
                `@types/react-dom@${version.dom}`,
            ]);
            for (const extension of ['mts', 'cts']) {
                const file = `tracking.${extension}`;
                writeFileSync(join(directory, file), typed);
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
                    file,
                ]);
            }
            for (const format of ['esm', 'cjs']) {
                for (const mode of ['ssr', 'dom']) {
                    const result = JSON.parse(
                        run(
                            process.execPath,
                            ['runtime.mjs', format, mode, happyDomModulePath],
                            {
                                encoding: 'utf8',
                                stdio: ['ignore', 'pipe', 'inherit'],
                            }
                        )
                    );
                    assert.equal(result.react, version.react);
                    assert.equal(result.reads, 0);
                }
                profiles.push({ react: version.react, format });
            }
            const css = readFileSync(
                join(
                    directory,
                    'node_modules/@miniextensions/sdk/dist/esm/react/form-tracking.css'
                ),
                'utf8'
            );
            assert(css.includes('.mx-sdk-form-tracking'));
            run(process.execPath, [
                '--input-type=module',
                '-e',
                `import{createRequire}from'node:module';const r=createRequire(import.meta.url);r.resolve('@miniextensions/sdk/react/form-tracking.css');const{buildSync}=r(${JSON.stringify(esbuildModulePath)});for(const format of ['esm','cjs'])buildSync({stdin:{contents:format==='esm'?"import{CompleteFormTrackingDisclosure}from'@miniextensions/sdk/react';console.log(CompleteFormTrackingDisclosure)":"console.log(require('@miniextensions/sdk/react').CompleteFormTrackingDisclosure)",resolveDir:process.cwd()},bundle:true,platform:'browser',format:'iife',write:false,logLevel:'silent'});`,
            ]);
        }
        return { profiles, cleanup: 'completed' };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
