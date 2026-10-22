import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const borrowedLinkedChildTypedConsumer = `
import {createBorrowedLinkedChildController,type BorrowedLinkedChildScope,type BorrowedLinkedChildRead,type BorrowedLinkedChildSave} from '@miniextensions/sdk/forms';
const nativeDraft={};
const childScope:BorrowedLinkedChildScope={source:['session','field','record','published',1],draft:[nativeDraft,1]};
const borrowedChild=createBorrowedLinkedChildController({readScope:()=>childScope});
const childRead:BorrowedLinkedChildRead|null=borrowedChild.captureRead();
if(childRead) borrowedChild.acceptRead(childRead,current=>current());
const childSave:BorrowedLinkedChildSave|null=borrowedChild.captureSave();
if(childSave) void borrowedChild.save(childSave,async()=>({nativeReceipt:1}));
// @ts-expect-error caller-created read labels are not tickets
borrowedChild.acceptRead({},()=>true);
// @ts-expect-error a native draft revision is part of the port
createBorrowedLinkedChildController({readScope:()=>({source:['session']})});
// @ts-expect-error a callback, not a client or second store, owns canonical Save
borrowedChild.save(childSave!,{save:async()=>true});
`;
export async function checkBorrowedLinkedChildConsumer({ consumerDirectory }) {
    const loader = join(consumerDirectory, 'borrowed-linked-child-public.mjs');
    writeFileSync(
        loader,
        "export {createBorrowedLinkedChildController} from '@miniextensions/sdk/forms';\n"
    );
    const esm = await import(pathToFileURL(loader).href);
    const require = createRequire(join(consumerDirectory, 'package.json'));
    for (const api of [esm, require('@miniextensions/sdk/forms')]) {
        const draft = {};
        let generation = 1;
        let revision = 1;
        const owner = api.createBorrowedLinkedChildController({
            readScope: () => ({
                source: ['parent-A', generation],
                draft: [draft, revision],
            }),
        });
        const read = owner.captureRead();
        assert.equal(
            owner.acceptRead(read, (current) => current()),
            true
        );
        revision++;
        assert.equal(owner.canPresent(read), true);
        const stale = owner.captureSave();
        generation += 2; // Same identity, different actual publication: A->B->A.
        assert.equal(owner.canPresent(read), false);
        let allocations = 0;
        assert.deepEqual(
            await owner.save(stale, async () => {
                allocations++;
            }),
            { type: 'retired' }
        );
        let settle;
        const response = new Promise((resolve) => {
            settle = resolve;
        });
        const pending = owner.save(owner.captureSave(), () => {
            allocations++;
            return response;
        });
        generation++;
        owner.dispose();
        const receipt = {};
        settle(receipt);
        const result = await pending;
        assert.equal(result.type, 'settled');
        assert.equal(result.value, receipt);
        assert.equal(allocations, 1);
    }
    console.log(
        'Installed borrowed linked-child ESM/CommonJS and strict declarations: native revisions, publication ABA, explicit Save and unchanged allocated settlement passed.'
    );
    return 2;
}
