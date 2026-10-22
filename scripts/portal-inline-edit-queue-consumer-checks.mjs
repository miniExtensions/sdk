import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const portalInlineEditQueueTypedConsumer = `
import {createPortalInlineEditQueue, createPortalCellBinding, type PortalInlineEditQueue, type PortalCellDraft, type PortalCellBindingOptions} from '@miniextensions/sdk/portals';
const nativeQueue:PortalInlineEditQueue<string,{value:string},string>=createPortalInlineEditQueue({commit:async(request:{value:string})=>request.value,committedValue:(result:string)=>result});
const nativeCellDraft:PortalCellDraft={read:()=>null,write:()=>true,revision:()=>1,dirty:()=>false,markSaved:()=>true};
declare const nativeCellOptions:PortalCellBindingOptions;
createPortalCellBinding({...nativeCellOptions,draft:nativeCellDraft});
// @ts-expect-error native queue transport retains its request type
nativeQueue.enqueue({request:{value:42}});
// @ts-expect-error retired draft revisions are null, never strings
const invalidNativeCellDraft:PortalCellDraft={...nativeCellDraft,revision:()=> 'retired'};
// @ts-expect-error queue ownership does not grant SDK client authority
nativeQueue.client.portals.updateGridCell({});
void invalidNativeCellDraft;
`;

export async function checkPortalInlineEditQueueConsumer({
    consumerDirectory,
}) {
    const loader = join(
        consumerDirectory,
        'portal-inline-edit-queue-public.mjs'
    );
    writeFileSync(
        loader,
        "export {createPortalInlineEditQueue} from '@miniextensions/sdk/portals';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/portals')]) {
        for (const outcome of ['success', 'failure']) {
            let resolve;
            let reject;
            const held = new Promise((yes, no) => {
                resolve = yes;
                reject = no;
            });
            const calls = [];
            const errors = [];
            const idlePending = [];
            let value = 'Initial';
            const queue = api.createPortalInlineEditQueue({
                commit: async (request) => {
                    calls.push(request.value);
                    if (calls.length === 1) return held;
                    throw new Error('successor failed');
                },
                committedValue: (result) => result,
            });
            const edit = (next) => ({
                cell: {
                    tableId: 'table',
                    recordId: 'record',
                    fieldId: 'field',
                },
                committedValue: value,
                value: next,
                request: { value: next },
                applyValue: (nextValue) => {
                    value = nextValue;
                },
                onCommitted: () => {},
                onError: (error) => errors.push(error),
                onBatchSettled: () => {},
                onIdle: () => idlePending.push(queue.hasPending()),
            });
            try {
                queue.enqueue(edit('A'));
                const saving = queue.flush();
                queue.enqueue(edit('B'));
                queue.enqueue(edit('A'));
                if (outcome === 'success') resolve('Canonical A');
                else reject(new Error('first failed'));
                await saving;
                assert.equal(value, 'A');
                assert.deepEqual(calls, ['A']);
                await queue.flush();
                assert.equal(
                    value,
                    outcome === 'success' ? 'Canonical A' : 'Initial'
                );
                assert.deepEqual(calls, ['A', 'A']);
                assert.equal(errors.length, outcome === 'success' ? 1 : 2);
                assert.deepEqual(idlePending, [false]);
                await queue.flush();
                assert.deepEqual(calls, ['A', 'A']);
                queue.enqueue(edit('Explicit retry'));
                await queue.flush();
                assert.deepEqual(calls, ['A', 'A', 'Explicit retry']);
            } finally {
                queue.dispose();
            }
        }
        let settle;
        const allocated = new Promise((resolve) => {
            settle = resolve;
        });
        const committed = [];
        const queue = api.createPortalInlineEditQueue({
            commit: () => allocated,
            committedValue: (result) => result,
        });
        const edit = {
            cell: { tableId: 'table', recordId: 'record', fieldId: 'field' },
            committedValue: 'Initial',
            value: 'Allocated',
            request: {},
            applyValue: () => {},
            onCommitted: (result) => committed.push(result),
            onError: (error) => {
                throw error;
            },
            onBatchSettled: () => {},
            onIdle: () => {},
        };
        queue.enqueue(edit);
        const saving = queue.flush();
        queue.dispose();
        assert.equal(queue.enqueue(edit), false);
        settle('Canonical allocated');
        await saving;
        assert.deepEqual(committed, ['Canonical allocated']);
        assert.equal(queue.hasPending(), false);
    }
    console.log(
        'Installed Portal inline queue: ESM/CommonJS ABA success/failure, conditional rollback, explicit retry and allocated settlement passed; native draft declarations included.'
    );
}
