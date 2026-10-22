import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const borrowedButtonActionTypedConsumer = `
import {createBorrowedButtonActionController,type BorrowedButtonActionOptions,type BorrowedButtonActionController,type BorrowedButtonActionResult} from '@miniextensions/sdk/ui';
const borrowedButtonRequest={source:{native:17},file:new File(['a'],'native.txt')};
const borrowedButtonReceipt={ownerRevision:1};
const borrowedButtonOptions:BorrowedButtonActionOptions<typeof borrowedButtonRequest,{success:boolean},typeof borrowedButtonReceipt>={
 readContext:()=>({owner:'real-native-host',revision:1,visible:true,available:true}),subscribe:()=>()=>{},mayStartNewIntent:()=>true,
 captureIntent:()=>({request:borrowedButtonRequest,receipt:borrowedButtonReceipt}),allocate:async(request)=>({success:request.source.native===17}),
 settleAllocated:async(receipt,outcome,feedback)=>{const n:number=receipt.ownerRevision;if(outcome.type==='resolved'){const b:boolean=outcome.value.success;void b;}else{const original:unknown=outcome.error;void original;}const current:boolean=feedback.isCurrent();void n;void current;},
};
const borrowedButtonController:BorrowedButtonActionController<{success:boolean}>=createBorrowedButtonActionController(borrowedButtonOptions);
const borrowedButtonResult:Promise<BorrowedButtonActionResult<{success:boolean}>>=borrowedButtonController.trigger();
// @ts-expect-error host settlement is required
createBorrowedButtonActionController({readContext:()=>null,subscribe:()=>()=>{},mayStartNewIntent:()=>true,captureIntent:()=>null,allocate:async()=>({})});
// @ts-expect-error allocation exposes its native Promise
createBorrowedButtonActionController({...borrowedButtonOptions,allocate:()=>({success:true})});
// @ts-expect-error no fabricated client/accepted Form is requested
createBorrowedButtonActionController({...borrowedButtonOptions,client:{}});
// @ts-expect-error allocated transport is never cancelled by this controller
borrowedButtonController.cancel();
// @ts-expect-error host explicit retry does not become journal acknowledgement
borrowedButtonController.acknowledgeNewIntent();
borrowedButtonController.dispose();void borrowedButtonResult;
`;
export async function checkBorrowedButtonActionConsumer({ consumerDirectory }) {
    const loader = join(consumerDirectory, 'borrowed-button-action-public.mjs');
    writeFileSync(
        loader,
        "export {createBorrowedButtonActionController} from '@miniextensions/sdk/ui';\n"
    );
    const esm = await import(pathToFileURL(loader).href),
        require = createRequire(join(consumerDirectory, 'package.json'));
    const faults = [];
    const reentrantProbes = [];
    for (const [format, api] of [
        ['ESM', esm],
        ['CommonJS', require('@miniextensions/sdk/ui')],
    ]) {
        const owner = {},
            receipt = {},
            request = { opaque: new Date(0) },
            native = { success: false };
        let calls = 0,
            settlements = 0;
        const error = { original: true };
        let model;
        const nested = [];
        model = api.createBorrowedButtonActionController({
            readContext: () => ({
                owner,
                revision: 1,
                visible: true,
                available: true,
            }),
            subscribe: () => () => {},
            mayStartNewIntent: () => true,
            captureIntent: () => ({ request, receipt }),
            allocate: async (input) => {
                assert.equal(input, request);
                calls++;
                if (calls === 2) throw error;
                return native;
            },
            settleAllocated: (r, outcome) => {
                assert.equal(r, receipt);
                settlements++;
                nested.push(model.trigger());
                if (outcome.type === 'resolved')
                    assert.equal(outcome.value, native);
                else assert.equal(outcome.error, error);
            },
        });
        const first = await model.trigger();
        assert.equal(first.type, 'settled');
        assert.equal(first.outcome.value, native);
        assert.equal(calls, 1);
        const second = await model.trigger();
        assert.equal(second.outcome.error, error);
        assert.equal(second.settlementFailure, null);
        assert.equal(calls, 2);
        await model.trigger();
        assert.equal(calls, 3);
        assert.equal(settlements, 3);
        assert.ok(
            (await Promise.all(nested)).every((r) => r.type === 'refused')
        );
        model.dispose();
        for (const key of ['owner', 'revision', 'visible', 'available'])
            for (const rejected of [false, true]) {
                let armed = false,
                    observed = 0,
                    settled = 0,
                    release,
                    reject;
                const completion = new Promise((yes, no) => {
                    release = yes;
                    reject = no;
                });
                const result = {},
                    original = {};
                const controlled = api.createBorrowedButtonActionController({
                    readContext: () => {
                        const field = {
                            owner,
                            revision: 1,
                            visible: true,
                            available: true,
                        };
                        const value = field[key];
                        Object.defineProperty(field, key, {
                            get() {
                                if (armed) {
                                    observed++;
                                    throw Error(
                                        'Observed installed metadata fault'
                                    );
                                }
                                return value;
                            },
                        });
                        return field;
                    },
                    subscribe: () => () => {},
                    mayStartNewIntent: () => true,
                    captureIntent: () => ({ request, receipt }),
                    allocate: () => completion,
                    settleAllocated: (r, outcome) => {
                        assert.ok(
                            observed > 0,
                            'Expected actual getter fault before allocated settlement'
                        );
                        assert.equal(r, receipt);
                        settled++;
                        if (rejected) assert.equal(outcome.error, original);
                        else assert.equal(outcome.value, result);
                    },
                });
                controlled.subscribe(() => {});
                const running = controlled.trigger();
                armed = true;
                if (rejected) reject(original);
                else release(result);
                const outcome = await running;
                assert.ok(observed > 0);
                assert.equal(settled, 1);
                assert.equal(outcome.settlementFailure, null);
                faults.push({ format, key, rejected, observed });
                controlled.dispose();
            }
        for (const phase of ['pending', 'settling', 'settled'])
            for (const rejected of [false, true]) {
                let observed = 0,
                    settled = 0;
                const result = {},
                    original = {};
                const controlled = api.createBorrowedButtonActionController({
                    readContext: () => ({
                        owner,
                        revision: 1,
                        visible: true,
                        available: true,
                    }),
                    subscribe: () => () => {},
                    mayStartNewIntent: () => true,
                    captureIntent: () => ({ request, receipt }),
                    allocate: () =>
                        rejected
                            ? Promise.reject(original)
                            : Promise.resolve(result),
                    settleAllocated: (_r, outcome) => {
                        settled++;
                        if (rejected) assert.equal(outcome.error, original);
                        else assert.equal(outcome.value, result);
                    },
                });
                controlled.subscribe((s) => {
                    if (s.phase === phase) {
                        observed++;
                        throw Error('Observed installed listener fault');
                    }
                });
                const outcome = await controlled.trigger();
                assert.ok(observed > 0);
                assert.equal(settled, 1);
                assert.equal(outcome.settlementFailure, null);
                faults.push({ format, phase, rejected, observed });
                controlled.dispose();
            }
        let asyncFaults = 0,
            asyncSettlements = 0;
        const asynchronous = api.createBorrowedButtonActionController({
            readContext: () => ({
                owner,
                revision: 1,
                visible: true,
                available: true,
            }),
            subscribe: () => async () => {
                asyncFaults++;
                throw Error('Installed async cleanup fault');
            },
            mayStartNewIntent: () => true,
            captureIntent: () => ({ request, receipt }),
            allocate: async () => native,
            settleAllocated: () => {
                asyncSettlements++;
            },
        });
        asynchronous.subscribe(async (snapshot) => {
            if (snapshot.phase === 'settling') {
                asyncFaults++;
                throw Error('Installed async listener fault');
            }
        });
        assert.equal((await asynchronous.trigger()).settlementFailure, null);
        asynchronous.dispose();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(asyncSettlements, 1);
        assert.equal(asyncFaults, 2);
        faults.push({
            format,
            phase: 'async listener and cleanup',
            observed: asyncFaults,
        });
        let finish,
            settled = 0;
        const completion = new Promise((resolve) => {
            finish = resolve;
        });
        const result = {};
        const allocated = api.createBorrowedButtonActionController({
            readContext: () => ({
                owner,
                revision: 1,
                visible: true,
                available: true,
            }),
            subscribe: () => () => {},
            mayStartNewIntent: () => true,
            captureIntent: () => ({ request, receipt }),
            allocate: () => completion,
            settleAllocated: (_r, outcome, feedback) => {
                settled++;
                assert.equal(outcome.value, result);
                assert.equal(feedback.isCurrent(), false);
            },
        });
        const running = allocated.trigger();
        allocated.dispose();
        finish(result);
        assert.equal((await running).outcome.value, result);
        assert.equal(settled, 1);
        assert.equal((await allocated.trigger()).type, 'refused');
        reentrantProbes.push(
            ...(await checkBorrowedButtonReentrancy(api, format))
        );
    }
    console.log(
        'Installed borrowed Button reentrancy observations:',
        JSON.stringify(reentrantProbes)
    );
    assert.equal(reentrantProbes.length, 22);
    assert.ok(
        reentrantProbes.every((probe) => probe.passed && probe.observed > 0),
        JSON.stringify(reentrantProbes.filter((probe) => !probe.passed))
    );
    assert.equal(faults.length, 30);
    assert.ok(faults.every((p) => p.observed > 0));
    console.log(
        'Installed borrowed Button observed faults:',
        JSON.stringify(faults)
    );
    console.log(
        'Installed borrowed Button action: ESM/CommonJS native identity, explicit retry, reentrancy, original errors, disposal settlement and 30 actual metadata/listener fault probes (including async listener/cleanup rejection) passed; strict NodeNext/Bundler declarations included.'
    );
    return 2;
}

async function checkBorrowedButtonReentrancy(api, format) {
    const probes = [];
    const record = async (name, work) => {
        const detail = {
            format,
            name,
            observed: 0,
            publications: 0,
            passed: false,
        };
        try {
            await work(detail);
            detail.passed = true;
        } catch (error) {
            detail.error =
                error instanceof Error ? error.message : String(error);
        }
        probes.push(detail);
    };
    const fixture = (target, change) => {
        let reads = 0,
            allocated = 0,
            settled = 0,
            observed = 0,
            publications = 0,
            atAllocation = 0,
            revision = 1,
            notify = () => {},
            model;
        const owner = {};
        model = api.createBorrowedButtonActionController({
            readContext() {
                const index = ++reads,
                    copied = revision;
                return {
                    owner,
                    revision: copied,
                    visible: true,
                    get available() {
                        if (index === target) {
                            change(
                                model,
                                () => {
                                    publications++;
                                    notify();
                                },
                                (value) => {
                                    revision = value;
                                }
                            );
                            observed++;
                        }
                        return true;
                    },
                };
            },
            subscribe: (changed) => {
                notify = changed;
                return () => {};
            },
            mayStartNewIntent: () => true,
            captureIntent: () => ({ request: {}, receipt: {} }),
            allocate: async () => {
                allocated++;
                atAllocation = reads;
                return {};
            },
            settleAllocated: () => {
                settled++;
            },
        });
        return {
            model,
            get allocated() {
                return allocated;
            },
            get settled() {
                return settled;
            },
            get observed() {
                return observed;
            },
            get publications() {
                return publications;
            },
            get atAllocation() {
                return atAllocation;
            },
        };
    };
    for (const kind of ['dispose', 'publication', 'publication ABA'])
        await record('final-read ' + kind, async (detail) => {
            const control = fixture(-1, () => {});
            await control.model.trigger();
            assert.equal(control.allocated, 1);
            const target = control.atAllocation;
            assert.ok(target > 0);
            control.model.dispose();
            const f = fixture(target, (model, publish, setRevision) => {
                if (kind === 'dispose') model.dispose();
                else {
                    setRevision(2);
                    publish();
                    if (kind === 'publication ABA') {
                        setRevision(1);
                        publish();
                    }
                }
            });
            try {
                const answer = await f.model.trigger();
                detail.observed = f.observed;
                detail.publications = f.publications;
                detail.allocations = f.allocated;
                assert.equal(detail.observed, 1);
                assert.equal(
                    detail.publications,
                    kind === 'dispose' ? 0 : kind === 'publication' ? 1 : 2
                );
                assert.equal(f.allocated, 0);
                assert.equal(f.settled, 0);
                assert.equal(answer.type, 'refused');
            } finally {
                f.model.dispose();
            }
        });
    for (const kind of ['dispose', 'publication', 'publication ABA'])
        for (const rejected of [false, true])
            await record(
                'feedback ' + kind + ' ' + (rejected ? 'rejection' : 'success'),
                async (detail) => {
                    const owner = {},
                        value = {},
                        error = {};
                    let armed = false,
                        revision = 1,
                        notify = () => {},
                        settled = 0,
                        feedbackValue,
                        model;
                    model = api.createBorrowedButtonActionController({
                        readContext() {
                            const copied = revision;
                            return {
                                owner,
                                revision: copied,
                                visible: true,
                                get available() {
                                    if (armed) {
                                        armed = false;
                                        if (kind === 'dispose') model.dispose();
                                        else {
                                            revision = 2;
                                            detail.publications++;
                                            notify();
                                            if (kind === 'publication ABA') {
                                                revision = 1;
                                                detail.publications++;
                                                notify();
                                            }
                                        }
                                        detail.observed++;
                                    }
                                    return true;
                                },
                            };
                        },
                        subscribe: (changed) => {
                            notify = changed;
                            return () => {};
                        },
                        mayStartNewIntent: () => true,
                        captureIntent: () => ({ request: {}, receipt: {} }),
                        allocate: () =>
                            rejected
                                ? Promise.reject(error)
                                : Promise.resolve(value),
                        settleAllocated: (_receipt, outcome, feedback) => {
                            settled++;
                            armed = true;
                            feedbackValue = feedback.isCurrent();
                            if (rejected) assert.equal(outcome.error, error);
                            else assert.equal(outcome.value, value);
                        },
                    });
                    try {
                        const answer = await model.trigger();
                        detail.feedback = feedbackValue;
                        detail.settlements = settled;
                        assert.equal(detail.observed, 1);
                        assert.equal(
                            detail.publications,
                            kind === 'dispose'
                                ? 0
                                : kind === 'publication'
                                  ? 1
                                  : 2
                        );
                        assert.equal(feedbackValue, false);
                        assert.equal(settled, 1);
                        assert.equal(answer.type, 'settled');
                        assert.equal(answer.settlementFailure, null);
                        if (rejected) assert.equal(answer.outcome.error, error);
                        else assert.equal(answer.outcome.value, value);
                    } finally {
                        model.dispose();
                    }
                }
            );
    for (const rejected of [false, true])
        await record(
            'snapshot disposal ' + (rejected ? 'rejection' : 'success'),
            async (detail) => {
                const owner = {},
                    value = {},
                    error = {};
                let armed = false,
                    disposed = false,
                    late = 0,
                    settled = 0,
                    release,
                    reject,
                    model;
                const completion = new Promise((yes, no) => {
                    release = yes;
                    reject = no;
                });
                model = api.createBorrowedButtonActionController({
                    readContext: () => ({
                        owner,
                        revision: 1,
                        visible: true,
                        get available() {
                            if (armed) {
                                armed = false;
                                disposed = true;
                                model.dispose();
                                detail.observed++;
                            }
                            return true;
                        },
                    }),
                    subscribe: () => () => {},
                    mayStartNewIntent: () => true,
                    captureIntent: () => ({ request: {}, receipt: {} }),
                    allocate: () => completion,
                    settleAllocated: (_receipt, outcome) => {
                        settled++;
                        if (rejected) assert.equal(outcome.error, error);
                        else assert.equal(outcome.value, value);
                    },
                });
                model.subscribe(() => {
                    if (disposed) late++;
                });
                try {
                    const running = model.trigger();
                    armed = true;
                    if (rejected) reject(error);
                    else release(value);
                    const answer = await running;
                    detail.lateNotifications = late;
                    detail.settlements = settled;
                    assert.equal(detail.observed, 1);
                    assert.equal(late, 0);
                    assert.equal(settled, 1);
                    assert.equal(answer.type, 'settled');
                    assert.equal(answer.settlementFailure, null);
                } finally {
                    model.dispose();
                }
            }
        );
    return probes;
}
