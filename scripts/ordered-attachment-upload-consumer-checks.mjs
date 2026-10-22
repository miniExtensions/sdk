import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const orderedAttachmentUploadTypedConsumer = `
import {iterateOrderedAttachmentUploads,type OrderedAttachmentUpload,type OrderedAttachmentUploadOptions} from '@miniextensions/sdk/ui';
const orderedUploadOptions:OrderedAttachmentUploadOptions<{url:string}>={files:[] as readonly File[],shouldContinue:()=>true,upload:async(file,index)=>({url:file.name+index})};
const orderedUploadIterator:AsyncGenerator<OrderedAttachmentUpload<{url:string}>,void,unknown>=iterateOrderedAttachmentUploads(orderedUploadOptions);
const orderedUploadNext:Promise<IteratorResult<OrderedAttachmentUpload<{url:string}>,void>>=orderedUploadIterator.next();
void orderedUploadNext;
// @ts-expect-error batch cancellation policy is host-supplied
iterateOrderedAttachmentUploads({files:[],upload:async()=>({})});
// @ts-expect-error upload must expose the allocated asynchronous settlement
iterateOrderedAttachmentUploads({...orderedUploadOptions,upload:()=>({url:'sync'})});
// @ts-expect-error native File metadata is not replaced with a Blob
iterateOrderedAttachmentUploads({...orderedUploadOptions,files:[new Blob()]});
// @ts-expect-error this iterator does not require or manufacture a client
iterateOrderedAttachmentUploads({...orderedUploadOptions,client:{}});
// @ts-expect-error this iterator never owns transport abort
orderedUploadIterator.cancel();
`;

export async function checkOrderedAttachmentUploadConsumer({
    consumerDirectory,
}) {
    const loader = join(
        consumerDirectory,
        'ordered-attachment-upload-public.mjs'
    );
    writeFileSync(
        loader,
        "export {iterateOrderedAttachmentUploads} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        const native = new File(['native'], 'bound.txt');
        const boundOptions = {
            files: [native],
            shouldContinue() {
                assert.equal(this, boundOptions);
                return true;
            },
            async upload(file, index) {
                assert.equal(this, boundOptions);
                assert.equal(this.files[index], file);
                return file;
            },
        };
        for await (const value of api.iterateOrderedAttachmentUploads(
            boundOptions
        ))
            assert.equal(value.attachment, native);
        const first = new File(['first'], 'same.txt', { type: 'text/plain' });
        const calls = [],
            accepted = [];
        let reads = 0;
        const opaque = Object.defineProperty({}, 'url', {
            get() {
                reads++;
                throw Error('opaque native');
            },
        });
        for await (const entry of api.iterateOrderedAttachmentUploads({
            files: Object.freeze([first, first]),
            shouldContinue: () => true,
            upload: async (file, index) => {
                calls.push([file, index]);
                return opaque;
            },
        }))
            accepted.push(entry);
        assert.equal(calls.length, 2);
        assert.equal(calls[0][0], first);
        assert.equal(calls[1][0], first);
        assert.deepEqual(
            calls.map(([, index]) => index),
            [0, 1]
        );
        assert.equal(accepted[0].attachment, opaque);
        assert.equal(accepted[1].file, first);
        assert.equal(reads, 0);

        const error = new Error('synthetic later failure');
        let uploads = 0;
        const prefix = [];
        try {
            for await (const entry of api.iterateOrderedAttachmentUploads({
                files: [first, first, first],
                shouldContinue: () => true,
                upload: async () => {
                    if (++uploads === 2) throw error;
                    return opaque;
                },
            }))
                prefix.push(entry.attachment);
            assert.fail('Expected original failure');
        } catch (caught) {
            assert.equal(caught, error);
        }
        assert.equal(prefix[0], opaque);
        assert.equal(uploads, 2);

        let release;
        const held = new Promise((resolve) => {
            release = resolve;
        });
        let allocations = 0;
        const iterator = api.iterateOrderedAttachmentUploads({
            files: [first, first],
            shouldContinue: () => true,
            upload: async () => {
                allocations++;
                return held;
            },
        });
        const next = iterator.next();
        const closing = iterator.return();
        release(opaque);
        const completed = await next;
        assert.equal(completed.done, false);
        assert.equal(completed.value.attachment, opaque);
        assert.equal((await closing).done, true);
        assert.equal(allocations, 1);

        let continueBatch = true;
        let releaseStopped;
        const stoppedUpload = new Promise((resolve) => {
            releaseStopped = resolve;
        });
        const stopped = api.iterateOrderedAttachmentUploads({
            files: [first, first],
            shouldContinue: () => continueBatch,
            upload: async () => stoppedUpload,
        });
        const pendingStopped = stopped.next();
        continueBatch = false;
        releaseStopped(opaque);
        assert.equal((await pendingStopped).value.attachment, opaque);
        assert.equal((await stopped.next()).done, true);
    }
    console.log(
        'Installed ordered attachment iteration: public ESM/CommonJS native identity/order, partial failure, cancellation and pending-next closure passed; strict NodeNext/Bundler declarations included.'
    );
    return 2;
}
