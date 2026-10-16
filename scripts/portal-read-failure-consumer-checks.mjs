import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { portalRecipeFixtures } from './portal-recipe-checks.mjs';

// Execute the public installed owner and runtime transport. Every HTTP response
// and thrown value is synthetic; the retained result contains only finite facts.
const runtimeConsumer = `
const cases = [];
const privateMarker = 'PRIVATE_SYNTHETIC_READ_FAILURE';
const base = ${JSON.stringify(portalRecipeFixtures.makePortal())};
const readOptions = {pagesToFetch:1,refreshLoggedInPortalRecord:false};
const criteria = () => ({
    selectedCustomViewId:'view_example',searchTerm:null,searchParamsMap:{},
    sortFieldsByEndUser:null,filtersByEndUser:null,
    supportsEndUserSortCleanup:true,supportsEndUserFilterCleanup:true
});
const response = () => new Response(JSON.stringify({
    recordIds:[],airtableOffset:null,tableIdsToLinkedTableStates:{},customViewDetailFields:null
}));
function make(respond) {
    const requests = [];
    let revision = 0;
    let sessionChanges = 0;
    let answer = respond;
    const client = createMiniExtensionsClient({
        apiOrigin:'https://sdk.example.test',session:{visitor:'synthetic-read-owner'},
        fetch:async (input,init) => {
            const route = new URL(String(input)).searchParams.get('route');
            assert.equal(route,'fetchRecordsForLinkedTableOnPortal');
            requests.push(JSON.parse(String(init.body)));
            return answer(input,init);
        }
    });
    const setSession = client.setSession;
    client.setSession = next => {sessionChanges++;setSession(next);};
    const session = client.getSession();
    const owner = createPortalListOwner({
        client,portal:structuredClone(base),portalFieldId:'fld_children',criteria:criteria(),
        getScope:()=>({ownerId:'synthetic-read-owner',revision})
    });
    return {
        client,owner,requests,session,
        setResponse(next) {answer=next;},
        retire() {revision++;owner.getSnapshot();},
        assertSession() {
            assert.equal(sessionChanges,0);
            assert.deepEqual(client.getSession(),session);
        }
    };
}
function assertFailure(snapshot,expected) {
    assert.equal(snapshot.phase,'error');
    assert.equal(snapshot.pending,false);
    assert.equal(snapshot.page,null);
    assert.equal(snapshot.cleanup,null);
    assert.equal(snapshot.readRequired,true);
    assert.deepEqual(snapshot.failure,expected);
    assert.deepEqual(Object.keys(snapshot.failure).sort(),['kind','status']);
    assert.equal(JSON.stringify(snapshot).includes(privateMarker),false);
}
async function main() {
    for (const item of [
        {name:'network',expected:{kind:'network',status:null},respond:()=>{throw Error(privateMarker);}},
        {name:'HTTP 503',expected:{kind:'http',status:503},respond:()=>new Response(JSON.stringify({message:privateMarker,code:privateMarker}),{status:503})},
        {name:'HTTP 403',expected:{kind:'http',status:403},respond:()=>new Response(JSON.stringify({message:privateMarker,code:privateMarker}),{status:403})},
        {name:'API envelope',expected:{kind:'api',status:200},respond:()=>new Response(JSON.stringify({error:true,message:privateMarker,code:privateMarker}))},
        {name:'invalid JSON',expected:{kind:'protocol',status:200},respond:()=>new Response(privateMarker)},
        {name:'unknown thrown value',expected:{kind:'unknown',status:null},respond:()=>response(),unknown:true}
    ]) {
        const f = make(item.respond);
        const snapshots = [];
        const stop = f.owner.subscribe(snapshot=>snapshots.push(snapshot));
        try {
            assert.equal(f.owner.getSnapshot().failure,null);
            assert.equal(f.requests.length,0);
            const originalRead = f.client.portals.listLinkedRecords;
            if (item.unknown) f.client.portals.listLinkedRecords = async ()=>{throw Error(privateMarker);};
            assert.equal(await f.owner.readFirst(f.owner.getSnapshot().revision,readOptions),false);
            const failed = f.owner.getSnapshot();
            assertFailure(failed,item.expected);
            const failedRevision = failed.revision;
            const callCount = item.unknown ? 0 : 1;
            assert.equal(f.requests.length,callCount);
            const delivered = snapshots.at(-1);
            assert.deepEqual(delivered.failure,item.expected);
            failed.failure.kind = 'unknown';
            failed.failure.status = 599;
            delivered.failure.kind = 'unknown';
            delivered.failure.status = 599;
            assert.deepEqual(f.owner.getSnapshot().failure,item.expected);
            await Promise.resolve();
            f.owner.getSnapshot();
            assert.equal(f.requests.length,callCount);
            // A deliberate criteria replacement clears feedback but performs no read.
            assert.equal(f.owner.setCriteria(failedRevision,criteria()),true);
            assert.equal(f.owner.getSnapshot().failure,null);
            assert.equal(f.requests.length,callCount);
            assert.equal(await f.owner.readFirst(failedRevision,readOptions),false);
            assert.equal(f.requests.length,callCount);
            f.client.portals.listLinkedRecords = originalRead;
            f.setResponse(response);
            assert.equal(await f.owner.readFirst(f.owner.getSnapshot().revision,readOptions),true);
            assert.equal(f.requests.length,callCount+1);
            assert.equal(f.owner.getSnapshot().failure,null);
            assert.equal(f.owner.getSnapshot().error,null);
            f.assertSession();
            cases.push(item.name+' sanitized, detached and explicitly retried');
        } finally {
            stop();
            f.owner.destroy();
        }
    }
    {
        let release;
        const f = make(()=>new Promise(resolve=>{release=resolve;}));
        try {
            const flight = f.owner.readFirst(f.owner.getSnapshot().revision,readOptions);
            assert.equal(f.requests.length,1);
            f.owner.cancel(f.owner.getSnapshot().revision);
            assertFailure(f.owner.getSnapshot(),{kind:'cancelled',status:null});
            release(response());
            assert.equal(await flight,false);
            assertFailure(f.owner.getSnapshot(),{kind:'cancelled',status:null});
            assert.equal(f.requests.length,1);
            f.assertSession();
            cases.push('explicit cancellation remains distinct after an abort-ignoring result');
        } finally {
            release?.(response());
            f.owner.destroy();
        }
    }
    {
        let release;
        const f = make(()=>new Promise(resolve=>{release=resolve;}));
        try {
            const flight = f.owner.readFirst(f.owner.getSnapshot().revision,readOptions);
            assert.equal(f.requests.length,1);
            f.retire();
            assert.equal(f.owner.getSnapshot().phase,'retired');
            assert.equal(f.owner.getSnapshot().failure,null);
            release(new Response(JSON.stringify({message:privateMarker}),{status:403}));
            assert.equal(await flight,false);
            assert.equal(f.owner.getSnapshot().failure,null);
            assert.equal(f.owner.getSnapshot().error,null);
            assert.equal(f.requests.length,1);
            f.assertSession();
            cases.push('retired owner suppresses a late denied-read failure');
        } finally {
            release?.(response());
            f.owner.destroy();
        }
    }
    console.log(JSON.stringify({checks:cases.length,cases}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
`;

export const portalReadFailureTypedConsumer = `
import type {
    PortalListReadFailure as PublicPortalListReadFailure,
    PortalListSnapshot as PublicReadFailureSnapshot,
} from '@miniextensions/sdk/portals';
export function inspectPublicPortalReadFailure(snapshot: PublicReadFailureSnapshot) {
    const failure:PublicPortalListReadFailure|null|undefined = snapshot.failure;
    if (failure) {
        const kind:'network'|'http'|'api'|'protocol'|'cancelled'|'unknown' = failure.kind;
        const status:number|null = failure.status;
        // @ts-expect-error failure facts are readonly detached presentation
        failure.kind = 'network';
        // @ts-expect-error arbitrary API codes are not retained
        void failure.code;
        // @ts-expect-error raw errors and causes are not retained
        void failure.cause;
        // @ts-expect-error failure facts do not grant retry or authentication policy
        void failure.retryable;
        void [kind,status];
    }
    return failure;
}
// @ts-expect-error failure kinds are a finite public union
const invalidPortalFailure:PublicPortalListReadFailure = {kind:'permission-granted',status:null};
// @ts-expect-error server messages are not part of the failure descriptor
const privatePortalFailure:PublicPortalListReadFailure = {kind:'http',status:403,message:'private'};
void [invalidPortalFailure,privatePortalFailure];
`;

/** Actual installed ESM/CommonJS public owners, with deterministic fake HTTP. */
export function checkPortalReadFailureConsumer({ consumerDirectory, run }) {
    let checks = 0;
    for (const [filename, imports] of [
        [
            'portal-read-failure-consumer.mjs',
            "import assert from 'node:assert/strict';\nimport { createMiniExtensionsClient } from '@miniextensions/sdk';\nimport { createPortalListOwner } from '@miniextensions/sdk/portals';\n",
        ],
        [
            'portal-read-failure-consumer.cjs',
            "const assert = require('node:assert/strict');\nconst { createMiniExtensionsClient } = require('@miniextensions/sdk');\nconst { createPortalListOwner } = require('@miniextensions/sdk/portals');\n",
        ],
    ]) {
        writeFileSync(
            join(consumerDirectory, filename),
            imports + runtimeConsumer
        );
        const result = JSON.parse(run(process.execPath, [filename]));
        assert.equal(result.checks, 8);
        assert.equal(result.cases.length, result.checks);
        assert.equal(new Set(result.cases).size, result.checks);
        checks += result.checks;
    }
    return checks;
}

/** Execute the shipped host recipe with actual installed PortalList/owner exports. */
export async function checkPortalReadFailureRecipeConsumer({
    consumerDirectory,
    happyDomModulePath,
}) {
    const consumer = realpathSync(consumerDirectory);
    const require = createRequire(join(consumer, 'package.json'));
    const installed = realpathSync(
        join(consumer, 'node_modules/@miniextensions/sdk')
    );
    for (const entry of [
        '@miniextensions/sdk',
        '@miniextensions/sdk/portals',
        '@miniextensions/sdk/react',
    ])
        assert.ok(
            realpathSync(require.resolve(entry)).startsWith(
                `${installed}/dist/`
            )
        );
    const guide = readFileSync(join(installed, 'docs/portals.md'), 'utf8');
    const recipes = [...guide.matchAll(/```ts\n([\s\S]*?)\n```/g)].filter(
        ([, source]) =>
            source.includes('export function PortalReadFailureList(')
    );
    assert.equal(
        recipes.length,
        1,
        'Missing unique shipped read-failure host recipe'
    );
    const outfile = join(consumer, '.generated/portal-read-failure-recipe.mjs');
    await build({
        absWorkingDir: consumer,
        stdin: {
            contents: `${recipes[0][1]}\nexport { createElement, act } from 'react';\nexport { createRoot } from 'react-dom/client';`,
            resolveDir: consumer,
            sourcefile: 'portal-read-failure-recipe.ts',
            loader: 'ts',
        },
        bundle: true,
        platform: 'node',
        external: ['react', 'react-dom', '@miniextensions/sdk/react'],
        format: 'esm',
        outfile,
        logLevel: 'silent',
    });
    const { Window } = require(happyDomModulePath);
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const old = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    let act;
    let root;
    let owner;
    let checks = 0;
    try {
        const recipe = await import(pathToFileURL(outfile).href);
        const { PortalReadFailureList, createElement, createRoot } = recipe;
        act = recipe.act;
        const { createMiniExtensionsClient } = require('@miniextensions/sdk');
        const {
            createPortalListOwner,
        } = require('@miniextensions/sdk/portals');
        for (const item of [
            {
                kind: 'network',
                status: null,
                copy: 'The Portal read could not complete. Choose Load records to try a fresh read.',
            },
            {
                kind: 'http',
                status: 503,
                copy: 'The Portal read could not complete. Choose Load records to try a fresh read.',
            },
            {
                kind: 'http',
                status: 403,
                copy: 'Access to these Portal records was denied. Check the permitted view or contact the workspace owner.',
            },
        ]) {
            let calls = 0;
            let sessionChanges = 0;
            let succeed = false;
            const client = createMiniExtensionsClient({
                apiOrigin: 'https://sdk.example.test',
                session: { visitor: 'synthetic-ui-owner' },
                fetch: async () => {
                    calls++;
                    if (succeed)
                        return new Response(
                            JSON.stringify({
                                recordIds: [],
                                airtableOffset: null,
                                tableIdsToLinkedTableStates: {},
                                customViewDetailFields: null,
                            })
                        );
                    if (item.kind === 'network')
                        throw Error('PRIVATE_SYNTHETIC_READ_FAILURE');
                    return new Response(
                        JSON.stringify({
                            message: 'PRIVATE_SYNTHETIC_READ_FAILURE',
                        }),
                        { status: item.status }
                    );
                },
            });
            const session = client.getSession();
            const setSession = client.setSession;
            client.setSession = (next) => {
                sessionChanges++;
                setSession(next);
            };
            owner = createPortalListOwner({
                client,
                portal: portalRecipeFixtures.makePortal(),
                portalFieldId: 'fld_children',
                criteria: {
                    selectedCustomViewId: 'view_example',
                    searchTerm: null,
                    searchParamsMap: {},
                    sortFieldsByEndUser: null,
                    filtersByEndUser: null,
                    supportsEndUserSortCleanup: true,
                    supportsEndUserFilterCleanup: true,
                },
                getScope: () => ({
                    ownerId: 'synthetic-ui-owner',
                    revision: 0,
                }),
            });
            const container = window.document.createElement('div');
            window.document.body.append(container);
            root = createRoot(container);
            await act(async () =>
                root.render(
                    createElement(PortalReadFailureList, {
                        owner,
                        readOptions: {
                            pagesToFetch: 1,
                            refreshLoggedInPortalRecord: false,
                        },
                    })
                )
            );
            assert.equal(calls, 0);
            const load = () => container.querySelector('button').click();
            await act(async () => load());
            assert.equal(calls, 1);
            assert.deepEqual(owner.getSnapshot().failure, {
                kind: item.kind,
                status: item.status,
            });
            assert.ok(container.textContent.includes(item.copy));
            assert.equal(
                container.innerHTML.includes('PRIVATE_SYNTHETIC_READ_FAILURE'),
                false
            );
            await act(async () => {
                await Promise.resolve();
            });
            assert.equal(calls, 1);
            succeed = true;
            await act(async () => load());
            assert.equal(calls, 2);
            assert.equal(owner.getSnapshot().failure, null);
            assert.equal(container.textContent.includes(item.copy), false);
            assert.equal(sessionChanges, 0);
            assert.deepEqual(client.getSession(), session);
            await act(async () => root.unmount());
            root = null;
            owner.destroy();
            owner = null;
            container.remove();
            checks++;
        }
        return checks;
    } finally {
        if (root) await act(async () => root.unmount());
        owner?.destroy();
        keys.forEach((key, index) => {
            if (old[index]) Object.defineProperty(globalThis, key, old[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
