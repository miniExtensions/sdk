import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const nativePortalKernelTypedConsumer = `
import {createNativePortalCollectionKernel} from '@miniextensions/sdk/portals';
const nativePortalKernel=createNativePortalCollectionKernel<{id:string;title:string},{id:string},{fieldId:string},{cache:string}>();
const nativePortalScope={sessionId:'session',fieldId:'field',linkedTableId:'table',bindingKey:'binding',fetchOwnerKey:'token-epoch',cacheOwnerEpoch:1};
const nativePortalInitial=nativePortalKernel.createState(nativePortalScope);
const nativePortalBegin=nativePortalKernel.begin(nativePortalInitial,{requestId:'request',mode:'first'});
if(nativePortalBegin){
    const nativePortalReceiptIsCurrent:boolean=nativePortalKernel.isCurrent(nativePortalBegin.state,nativePortalBegin.receipt);
    const nativePortalAccepted=nativePortalKernel.succeed(nativePortalBegin.state,nativePortalBegin.receipt,{recordIds:['record'],recordsById:{record:{id:'record',title:'Response only'}},schema:[{id:'title'}],linkedTableId:'table',details:{presence:'present',fields:[{fieldId:'title'}]},primary:{fieldId:'title'},nextOffset:null,projection:{cache:'response'}});
    if(nativePortalAccepted?.state.frame){
        const nativePortalRowTitle:string=nativePortalAccepted.state.frame.records[0].title;
        // @ts-expect-error row values retain the caller's shape
        const nativePortalWrong:number=nativePortalAccepted.state.frame.records[0].title;
        void nativePortalRowTitle; void nativePortalWrong;
    }
    void nativePortalReceiptIsCurrent;
}
// @ts-expect-error scope IDs must remain strings
nativePortalKernel.createState({...nativePortalScope,fieldId:42});
// @ts-expect-error public transition state is readonly
nativePortalInitial.scope.bindingKey='replacement';
// @ts-expect-error standalone closure-store methods are not kernel API
nativePortalKernel.getSnapshot();
`;

const reactTypedConsumer = `
import * as React from 'react';
import {renderToString} from 'react-dom/server';
import {createNativePortalCollectionKernel as createReactNativePortalKernel} from '@miniextensions/sdk/portals';
const reactNativePortalKernel=createReactNativePortalKernel<{id:string},string,string>();
const reactNativePortalState=reactNativePortalKernel.createState({sessionId:'session',fieldId:'field',linkedTableId:'table',bindingKey:'binding',fetchOwnerKey:'token-epoch',cacheOwnerEpoch:1});
const reactNativePortalHtml:string=renderToString(React.createElement('output',null,reactNativePortalState.paging.type));
void reactNativePortalHtml;
`;

function assertKernel(api) {
    const kernel = api.createNativePortalCollectionKernel();
    const scope = {
        sessionId: 'session',
        fieldId: 'field',
        linkedTableId: 'table',
        bindingKey: 'binding',
        fetchOwnerKey: 'token-epoch',
        cacheOwnerEpoch: 1,
    };
    const initial = kernel.createState(scope);
    assert.equal(initial.paging.type, 'notLoaded');
    assert.equal(initial.frame, null);
    assert.equal(Object.isFrozen(initial), true);
    const begin = kernel.begin(initial, {
        requestId: 'first',
        mode: 'first',
    });
    assert(begin);
    assert.equal(kernel.isCurrent(begin.state, begin.receipt), true);
    assert.equal(
        kernel.isCurrent(begin.state, { ...begin.receipt }),
        false,
        'plain receipt data cannot fabricate authority'
    );
    const row = { id: 'record', title: 'Response only' };
    const response = {
        recordIds: ['record', 'record'],
        recordsById: { record: row },
        schema: [{ id: 'title' }],
        linkedTableId: 'table',
        details: { presence: 'present', fields: [{ fieldId: 'title' }] },
        primary: { fieldId: 'title' },
        nextOffset: '',
        projection: { cache: 'response' },
    };
    const accepted = kernel.succeed(begin.state, begin.receipt, response);
    assert(accepted);
    assert.deepEqual(accepted.state.paging.recordIds, ['record', 'record']);
    assert.deepEqual(accepted.state.frame.recordIds, ['record']);
    assert.equal(accepted.state.frame.records[0].title, 'Response only');
    row.title = 'mutated external response';
    assert.equal(accepted.state.frame.records[0].title, 'Response only');
    assert.equal(
        kernel.begin(accepted.state, {
            requestId: 'cached',
            mode: 'first',
            onlyIfNotFetched: true,
        }),
        null
    );
    const next = kernel.begin(accepted.state, {
        requestId: 'next',
        mode: 'next',
        retainNextOnFailure: true,
    });
    assert(next);
    assert.equal(next.plan.cursor, '');
    assert.deepEqual(next.state.paging.recordIds, ['record', 'record']);
    const failed = kernel.fail(next.state, next.receipt, 'Synthetic failure');
    assert(failed);
    assert.equal(failed.state.paging.type, 'loaded');
    assert.equal(failed.state.paging.nextOffset, '');
    assert.deepEqual(failed.state.paging.recordIds, ['record', 'record']);
    const retry = kernel.begin(failed.state, {
        requestId: 'retry',
        mode: 'next',
        retainNextOnFailure: true,
    });
    assert(retry);
    assert.equal(retry.plan.cursor, '');
    const changed = kernel.observe(retry.state, {
        ...scope,
        bindingKey: 'changed criteria',
    });
    const back = kernel.observe(changed, scope);
    assert.equal(kernel.isCurrent(back, retry.receipt), false);
    assert.equal(kernel.succeed(back, retry.receipt, response), null);
    const cleanupBegin = kernel.begin(back, {
        requestId: 'cleanup',
        mode: 'first',
    });
    assert(cleanupBegin);
    const cleanup = kernel.cleanup(
        cleanupBegin.state,
        cleanupBegin.receipt,
        'sort',
        []
    );
    assert(cleanup);
    assert.equal(
        kernel.isCleanupCurrent(cleanup.state, cleanup.cleanup.receipt),
        true
    );
    const completed = kernel.completeCleanup(
        cleanup.state,
        cleanup.cleanup.receipt
    );
    assert(completed);
    assert.deepEqual(completed.read, {
        mode: 'first',
        onlyIfNotFetched: false,
    });
    assert.equal(kernel.fail(back, retry.receipt, 'stale failure'), null);
    assert.equal(initial.paging.type, 'notLoaded');
}

/** Used by the ordinary installed-package check before React is installed. */
export async function checkNativePortalKernelConsumer({ consumerDirectory }) {
    const loader = join(consumerDirectory, 'native-portal-kernel-public.mjs');
    writeFileSync(
        loader,
        "export {createNativePortalCollectionKernel} from '@miniextensions/sdk/portals';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/portals')]) {
        assertKernel(api);
    }
    return 2;
}

/** Public archive qualification only; it never loads native source or fixtures. */
export function checkNativePortalKernelReactMatrix({
    archivePath,
    typescriptBin,
}) {
    const archive = resolve(archivePath);
    readFileSync(archive);
    const directory = mkdtempSync(join(tmpdir(), 'sdk-native-portal-kernel-'));
    const run = (command, args, options = {}) =>
        execFileSync(command, args, {
            cwd: directory,
            stdio: 'inherit',
            timeout: 120000,
            ...options,
        });
    const versions = [];
    try {
        writeFileSync(
            join(directory, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: { '@miniextensions/sdk': `file:${archive}` },
            })
        );
        writeFileSync(
            join(directory, 'ssr.mjs'),
            `import assert from 'node:assert/strict';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {createRequire} from 'node:module';
import {createNativePortalCollectionKernel} from '@miniextensions/sdk/portals';
const require=createRequire(import.meta.url);
assert.equal(typeof window,'undefined');
assert.equal(typeof document,'undefined');
for(const create of [createNativePortalCollectionKernel,require('@miniextensions/sdk/portals').createNativePortalCollectionKernel]){
    const kernel=create();
    const state=kernel.createState({sessionId:'session',fieldId:'field',linkedTableId:'table',bindingKey:'binding',fetchOwnerKey:'token-epoch',cacheOwnerEpoch:1});
    assert.equal(renderToString(React.createElement('output',null,state.paging.type)),'<output>notLoaded</output>');
    assert.equal(state.active,null);
}
console.log(JSON.stringify({react:React.version,formats:['ESM','CJS'],browserGlobals:false,rendered:2}));
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
                '@types/node@22.20.5',
            ]);
            for (const [filename, module, resolution] of [
                ['consumer.mts', 'NodeNext', 'NodeNext'],
                ['consumer.cts', 'NodeNext', 'NodeNext'],
                ['consumer.ts', 'ESNext', 'Bundler'],
            ]) {
                writeFileSync(
                    join(directory, filename),
                    nativePortalKernelTypedConsumer + reactTypedConsumer
                );
                run(process.execPath, [
                    typescriptBin,
                    '--noEmit',
                    '--strict',
                    '--skipLibCheck',
                    'false',
                    '--target',
                    'ES2022',
                    '--module',
                    module,
                    '--moduleResolution',
                    resolution,
                    filename,
                ]);
            }
            run(process.execPath, ['ssr.mjs']);
            versions.push(version.react);
        }
        return {
            versions,
            formats: ['ESM', 'CJS'],
            declarations: ['NodeNext', 'Bundler'],
            cleanup: 'completed',
        };
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
    assert(
        process.argv[2],
        'Usage: node scripts/native-portal-kernel-consumer-checks.mjs <existing-sdk.tgz>'
    );
    const require = createRequire(import.meta.url);
    console.log(
        JSON.stringify(
            checkNativePortalKernelReactMatrix({
                archivePath: process.argv[2],
                typescriptBin: require.resolve('typescript/bin/tsc'),
            })
        )
    );
}
