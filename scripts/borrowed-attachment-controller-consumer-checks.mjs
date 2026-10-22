import assert from 'node:assert/strict';
import { File } from 'node:buffer';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const borrowedAttachmentControllerTypedConsumer = `
import {createBorrowedAttachmentController,type BorrowedAttachmentControllerOptions,type BorrowedAttachmentController,type BorrowedAttachmentBatchResult} from '@miniextensions/sdk/ui';
const borrowedAttachmentNative={url:'native',extra:17};
const borrowedAttachmentReceipt={hostGeneration:1};
const borrowedAttachmentOptions:BorrowedAttachmentControllerOptions<typeof borrowedAttachmentNative,typeof borrowedAttachmentReceipt>={
 readField:()=>({owner:'actual-host',revision:1,visible:true,editable:true,valueReadable:true,value:[borrowedAttachmentNative]}),
 subscribe:()=>()=>{},
 captureBatch:()=>({receipt:borrowedAttachmentReceipt,canAllocate:()=>true}),
 allocate:()=>({completion:Promise.resolve(borrowedAttachmentNative)}),
 settleCompleted:(receipt,outcome)=>{const n:number=receipt.hostGeneration;const native:number|undefined=outcome.completed[0]?.attachment.extra;void n;void native;},
};
const borrowedAttachmentController:BorrowedAttachmentController<typeof borrowedAttachmentNative>=createBorrowedAttachmentController(borrowedAttachmentOptions);
const borrowedAttachmentResult:Promise<BorrowedAttachmentBatchResult<typeof borrowedAttachmentNative>>=borrowedAttachmentController.start([] as File[]);
// @ts-expect-error a host-owned settlement port is required
createBorrowedAttachmentController({readField:()=>null,subscribe:()=>()=>{},captureBatch:()=>null,allocate:()=>({completion:Promise.resolve({})})});
// @ts-expect-error allocation must expose an asynchronous native completion
createBorrowedAttachmentController({...borrowedAttachmentOptions,allocate:()=>({completion:borrowedAttachmentNative})});
// @ts-expect-error no client/accepted Form is manufactured by this API
createBorrowedAttachmentController({...borrowedAttachmentOptions,client:{}});
// @ts-expect-error native File identity is not replaced with a Blob
borrowedAttachmentController.start([new Blob()]);
// @ts-expect-error borrowed state has no native-draft setter
borrowedAttachmentController.setValue([]);
void borrowedAttachmentResult;
`;
export async function checkBorrowedAttachmentControllerConsumer({
    consumerDirectory,
}) {
    const loader = join(
        consumerDirectory,
        'borrowed-attachment-controller-public.mjs'
    );
    writeFileSync(
        loader,
        "export {createBorrowedAttachmentController} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/ui')]) {
        const owner = {},
            native = {},
            first = new File(['a'], 'same.txt'),
            next = new File(['b'], 'same.txt');
        let value = [native],
            changed = () => {},
            editable = true,
            reads = 0,
            settles = 0,
            calls = 0,
            cancel = 0;
        const receipt = {};
        let complete;
        const held = new Promise((resolve) => {
            complete = resolve;
        });
        const accepted = Object.defineProperty({}, 'private', {
            get() {
                reads++;
                throw Error('opaque native');
            },
        });
        const options = {
            readField: () => ({
                owner,
                revision: value.length,
                visible: true,
                editable,
                valueReadable: true,
                value,
            }),
            subscribe: (notify) => {
                changed = notify;
                return () => {};
            },
            captureBatch: () => ({ receipt, canAllocate: () => true }),
            allocate(file, index) {
                assert.equal(file, index === 0 ? first : next);
                calls++;
                return {
                    completion: held,
                    cancel: () => {
                        cancel++;
                    },
                };
            },
            settleCompleted(r, result) {
                assert.equal(r, receipt);
                settles++;
                value = value.concat(
                    result.completed.map((entry) => entry.attachment)
                );
            },
        };
        const model = api.createBorrowedAttachmentController(options);
        assert.equal(model.getSnapshot().value[0], native);
        const pending = model.start([first, next]);
        assert.equal((await model.start([next])).outcome, 'not-started');
        const concurrent = {};
        value = [native, concurrent];
        editable = false;
        changed();
        editable = true;
        changed();
        complete(accepted);
        const result = await pending;
        assert.equal(result.outcome, 'retired');
        assert.equal(result.completed[0].file, first);
        assert.equal(result.completed[0].attachment, accepted);
        assert.deepEqual(value, [native, concurrent, accepted]);
        assert.equal(calls, 1);
        assert.equal(settles, 1);
        assert.equal(reads, 0);
        assert.equal(cancel, 0);
        model.dispose();

        const originalError = {},
            cleanupError = {};
        const dispatched = [];
        let partial;
        const failure = api.createBorrowedAttachmentController({
            ...options,
            allocate(file, index) {
                dispatched.push(file);
                return {
                    completion:
                        index === 1
                            ? Promise.reject(originalError)
                            : Promise.resolve(accepted),
                };
            },
            settleCompleted(_receipt, outcome) {
                partial = outcome;
                throw cleanupError;
            },
        });
        const failed = await failure.start([first, next, first]);
        assert.deepEqual(dispatched, [first, next]);
        assert.equal(partial.completed[0].attachment, accepted);
        assert.equal(failed.failure.error, originalError);
        assert.equal(failed.settlementFailure.error, cleanupError);
        failure.dispose();

        let finish;
        const delayed = new Promise((resolve) => {
            finish = resolve;
        });
        let completed = 0;
        const stopped = api.createBorrowedAttachmentController({
            ...options,
            allocate: () => ({
                completion: delayed,
                cancel: () => {
                    cancel++;
                },
            }),
            settleCompleted: (_receipt, outcome) => {
                completed += outcome.completed.length;
            },
        });
        const stopping = stopped.start([first, next]);
        stopped.cancel();
        stopped.cancel();
        stopped.dispose();
        finish(accepted);
        assert.equal((await stopping).completed[0].attachment, accepted);
        assert.equal(completed, 1);
        assert.equal(cancel, 1);

        let nested, reentrant;
        reentrant = api.createBorrowedAttachmentController({
            ...options,
            captureBatch: () => {
                nested = reentrant.start([next]);
                reentrant.cancel();
                return { receipt, canAllocate: () => true };
            },
            allocate: () => {
                assert.fail('cancelled before dispatch');
            },
        });
        assert.equal((await reentrant.start([first])).outcome, 'cancelled');
        assert.equal((await nested).outcome, 'not-started');
        reentrant.dispose();

        const hidden = api.createBorrowedAttachmentController({
            ...options,
            readField: () => ({
                owner,
                revision: 0,
                visible: false,
                editable: true,
                valueReadable: false,
                get value() {
                    assert.fail('hidden native read');
                },
            }),
        });
        assert.equal(hidden.getSnapshot().value, null);
        assert.equal((await hidden.start([first])).allocatedCount, 0);
        hidden.dispose();

        for (const [key, throwOn] of [
            ['revision', 1],
            ['visible', 3],
            ['valueReadable', 2],
            ['owner', 3],
            ['editable', 1],
            ['visible', 1],
        ])
            for (const rejected of [false, true]) {
                let armed = false,
                    release,
                    reject,
                    settlements = 0;
                const nativeResult = {},
                    nativeError = {},
                    getterError = {};
                const completion = new Promise((yes, no) => {
                    release = yes;
                    reject = no;
                });
                const metadata = api.createBorrowedAttachmentController({
                    ...options,
                    readField() {
                        const field = {
                            owner,
                            revision: 1,
                            visible: true,
                            editable: true,
                            valueReadable: true,
                            value: [native],
                        };
                        const original = field[key];
                        let reads = 0;
                        Object.defineProperty(field, key, {
                            enumerable: true,
                            get() {
                                if (armed && ++reads >= throwOn)
                                    throw getterError;
                                return original;
                            },
                        });
                        return field;
                    },
                    allocate: () => ({ completion }),
                    settleCompleted(_receipt, result) {
                        settlements++;
                        if (rejected)
                            assert.equal(result.failure.error, nativeError);
                        else
                            assert.equal(
                                result.completed[0].attachment,
                                nativeResult
                            );
                    },
                });
                const pending = metadata.start([first]);
                armed = true;
                if (rejected) reject(nativeError);
                else release(nativeResult);
                const result = await pending;
                assert.equal(settlements, 1);
                assert.equal(result.settlementFailure, null);
                if (rejected) assert.equal(result.failure.error, nativeError);
                else {
                    assert.equal(result.failure, null);
                    assert.equal(result.completed[0].attachment, nativeResult);
                }
                metadata.dispose();
            }
    }
    console.log(
        'Installed borrowed attachment controller: ESM/CJS identity/concurrency, policy ABA, partial error/cleanup, cancellation/disposal reentrancy and metadata-getter success/rejection settlement passed; strict NodeNext/Bundler consumers included.'
    );
    return 2;
}
