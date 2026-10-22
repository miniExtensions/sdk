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
    const failures = [];
    for (const [format, api] of [
        ['ESM', esm],
        ['CommonJS', require('@miniextensions/sdk/forms')],
    ]) {
        const draft = {};
        let generation = 1;
        let revision = 1;
        const owner = api.createBorrowedLinkedChildController({
            readScope: () => ({
                source: ['parent-A', generation],
                draft: [draft, revision],
            }),
        });
        assert.equal(owner.captureSave(), null);
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
        assert.equal(owner.captureSave(), null);
        assert.equal(
            owner.acceptRead(owner.captureRead(), (current) => {
                if (!current()) return false;
                revision++;
                return true;
            }),
            true
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
        await checkObservedReentry(api, format, failures);
    }
    if (failures.length)
        throw new AggregateError(failures, 'Installed child ownership failed');
    console.log(
        'Installed borrowed linked-child ESM/CommonJS and strict declarations: native revisions, publication ABA, observed reentry/disposal/refusal, explicit Save and unchanged allocated settlement passed.'
    );
    return 2;
}

async function checkObservedReentry(api, format, failures) {
    const fixture = () => {
        const scope = { source: ['parent-A', 1], draft: [{}, 1] };
        let observe;
        const owner = api.createBorrowedLinkedChildController({
            readScope: () => {
                const callback = observe;
                observe = undefined;
                callback?.();
                return scope;
            },
        });
        return {
            owner,
            nextRead(callback) {
                observe = callback;
            },
            accept() {
                assert.equal(
                    owner.acceptRead(owner.captureRead(), (current) =>
                        current()
                    ),
                    true
                );
            },
        };
    };
    const check = async (name, run) => {
        try {
            await run();
            console.log(`Installed child ${format}: ${name} passed`);
        } catch (error) {
            failures.push(new Error(`${format}: ${name}`, { cause: error }));
            console.log(
                `Installed child ${format}: ${name} FAILED: ${error.message}`
            );
        }
    };
    await check('observed read reentry publishes once', () => {
        const f = fixture();
        const read = f.owner.captureRead();
        let publications = 0;
        let inner;
        f.nextRead(() => {
            inner = f.owner.acceptRead(read, () => {
                publications++;
                return true;
            });
        });
        const outer = f.owner.acceptRead(read, () => {
            publications++;
            return true;
        });
        assert.equal(publications, 1);
        assert.equal(inner, false);
        assert.equal(outer, true);
    });
    await check('observed Save reentry allocates once', async () => {
        const f = fixture();
        f.accept();
        const save = f.owner.captureSave();
        const receipt = {};
        const native = Promise.resolve(receipt);
        let allocations = 0;
        const allocate = () => {
            allocations++;
            return native;
        };
        let inner;
        f.nextRead(() => {
            inner = f.owner.save(save, allocate);
        });
        const outer = await f.owner.save(save, allocate);
        assert.equal(allocations, 1);
        assert.deepEqual(await inner, { type: 'retired' });
        assert.equal(outer.value, receipt);
    });
    await check('observed refusal stays hidden', () => {
        const f = fixture();
        const read = f.owner.captureRead();
        let publications = 0;
        f.nextRead(() => {
            assert.equal(
                f.owner.acceptRead(read, () => {
                    publications++;
                    return false;
                }),
                false
            );
        });
        const present = f.owner.canPresent(read);
        assert.equal(publications, 1);
        assert.equal(present, false);
        assert.equal(f.owner.canPresent(read), false);
    });
    await check('observed final Save disposal allocates nothing', async () => {
        const f = fixture();
        f.accept();
        const save = f.owner.captureSave();
        f.nextRead(() => f.owner.dispose());
        let allocations = 0;
        const result = await f.owner.save(save, async () => {
            allocations++;
        });
        assert.equal(allocations, 0);
        assert.deepEqual(result, { type: 'retired' });
    });
    await check('observed read disposal publishes nothing', () => {
        const f = fixture();
        const read = f.owner.captureRead();
        f.nextRead(() => f.owner.dispose());
        let publications = 0;
        assert.equal(
            f.owner.acceptRead(read, () => {
                publications++;
                return true;
            }),
            false
        );
        assert.equal(publications, 0);
    });
    await check('observed presentation disposal stays hidden', () => {
        const f = fixture();
        const read = f.owner.captureRead();
        f.nextRead(() => f.owner.dispose());
        assert.equal(f.owner.canPresent(read), false);
    });
    for (const boundary of [
        'readScope',
        'source getter',
        'draft getter',
        'source iteration',
        'draft iteration',
    ]) {
        for (const capture of ['captureRead', 'captureSave']) {
            await check(`${boundary} disposal refuses ${capture}`, () => {
                let armed = false;
                const retire = () => {
                    if (armed) owner.dispose();
                };
                const source = ['parent-A', 1];
                const draft = [{}, 1];
                for (const [name, tuple] of [
                    ['source iteration', source],
                    ['draft iteration', draft],
                ]) {
                    const iterator = tuple[Symbol.iterator].bind(tuple);
                    tuple[Symbol.iterator] = () => {
                        if (boundary === name) retire();
                        return iterator();
                    };
                }
                const owner = api.createBorrowedLinkedChildController({
                    readScope: () => {
                        if (boundary === 'readScope') retire();
                        return {
                            get source() {
                                if (boundary === 'source getter') retire();
                                return source;
                            },
                            get draft() {
                                if (boundary === 'draft getter') retire();
                                return draft;
                            },
                        };
                    },
                });
                assert.equal(
                    owner.acceptRead(owner.captureRead(), (current) =>
                        current()
                    ),
                    true
                );
                armed = true;
                assert.equal(owner[capture](), null);
            });
        }
    }
    await check(
        'allocated native rejection survives disposal by identity',
        async () => {
            const f = fixture();
            f.accept();
            const intent = f.owner.captureSave();
            let reject;
            const native = new Promise((_, no) => {
                reject = no;
            });
            let allocations = 0;
            const pending = f.owner.save(intent, () => {
                allocations++;
                f.owner.dispose();
                return native;
            });
            const error = new Error('native allocated failure');
            reject(error);
            await assert.rejects(pending, (cause) => cause === error);
            assert.equal(allocations, 1);
        }
    );
}
