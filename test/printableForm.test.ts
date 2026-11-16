import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    createPrintableFormAdmission,
    createPrintableFormController,
    type PrintableFormAdmission,
    type PrintableFormAuthority,
    type PrintableFormEngine,
    type PrintableFormPreparedDocument,
    type PrintableFormRequest,
    type PrintableFormScope,
} from '../src/ui/printableForm.js';
import type { ReadonlyPrintDocument } from '../src/ui/readonlyPrintDocument.js';

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function admitted(request: PrintableFormRequest) {
    assert.equal(request.status, 'admitted');
    if (request.status !== 'admitted') throw Error('Expected admitted job');
    return request.job;
}
function fixture(
    admission: PrintableFormAdmission = createPrintableFormAdmission()
) {
    const authority: {
        scope: { owner: object; revision: object };
        explicitAllowed: boolean;
        keyboardAllowed: boolean;
        keyboardLease: object | null;
    } = {
        scope: { owner: {}, revision: {} },
        explicitAllowed: true,
        keyboardAllowed: true,
        keyboardLease: {},
    };
    const data = {
        language: 'en' as const,
        fields: [
            {
                key: 'field',
                fieldName: 'Field',
                title: 'Title before',
                semanticTitle: 'Title before',
                showTitle: true,
                required: false,
                sameRow: false,
                enableSideBySideOnMobile: false,
                facet: {
                    kind: 'text' as const,
                    value: 'Value before',
                    emptyLabel: 'None',
                },
            },
        ],
    };
    const preparation = deferred<PrintableFormPreparedDocument>();
    const documents: ReadonlyPrintDocument[] = [];
    let context: Parameters<PrintableFormEngine['prepare']>[1] | undefined;
    let captures = 0;
    let prints = 0;
    let disposals = 0;
    let throwPrint = false;
    let throwDisposal = false;
    const current = (scope: PrintableFormScope) =>
        Object.is(scope.owner, authority.scope.owner) &&
        Object.is(scope.revision, authority.scope.revision);
    const source = {
        readAuthority: (): PrintableFormAuthority => authority,
        isCurrent: current,
        capture(scope: PrintableFormScope) {
            assert.ok(current(scope));
            captures++;
            return { status: 'accepted' as const, document: data };
        },
    };
    const engine: PrintableFormEngine = {
        prepare(document, value) {
            documents.push(document);
            context = value;
            return preparation.promise;
        },
    };
    const resource: PrintableFormPreparedDocument = {
        invoke(boundary) {
            boundary(() => {
                prints++;
                if (throwPrint) throw Error('synthetic browser failure');
            });
        },
        dispose() {
            disposals++;
            if (throwDisposal) throw Error('synthetic cleanup failure');
        },
    };
    const controller = createPrintableFormController({
        source,
        admission,
        engine,
    });
    return {
        controller,
        authority,
        data,
        admission,
        source,
        preparation,
        documents,
        resource,
        get context() {
            assert.ok(context);
            return context;
        },
        get captures() {
            return captures;
        },
        get prints() {
            return prints;
        },
        get disposals() {
            return disposals;
        },
        failPrint() {
            throwPrint = true;
        },
        failDisposal(value: boolean) {
            throwDisposal = value;
        },
    };
}

test('one admitted print retains a detached snapshot and explicit finish owns cleanup/release', async () => {
    const f = fixture();
    const job = admitted(f.controller.request());
    assert.equal(job.getSnapshot().phase, 'preparing');
    assert.equal(f.captures, 1);
    f.data.fields[0].title = 'Title after';
    f.data.fields[0].facet.value = 'Value after';
    assert.equal(f.documents[0].fields[0].title, 'Title before');
    assert.equal(Object.isFrozen(f.documents[0].fields[0].facet), true);
    f.preparation.resolve(f.resource);
    await flush();
    assert.equal(f.prints, 1);
    assert.equal(job.getSnapshot().phase, 'invoked');
    assert.equal(f.disposals, 0);
    assert.equal(job.cancelBeforeInvocation(), false);
    assert.equal(await job.finish('explicit-dialog-closed'), true);
    assert.equal(f.disposals, 1);
    assert.equal(job.getSnapshot().cleaned, true);
    assert.equal(f.controller.getSnapshot().job, null);
    assert.equal(await job.finish('explicit-dialog-closed'), false);
});

test('document-wide busy refusal occurs before a sibling private snapshot is captured', async () => {
    const admission = createPrintableFormAdmission();
    const first = fixture(admission);
    const second = fixture(admission);
    const job = admitted(first.controller.request());
    assert.deepEqual(second.controller.request(), { status: 'busy' });
    assert.equal(second.captures, 0);
    assert.equal(second.documents.length, 0);
    first.preparation.resolve(first.resource);
    await flush();
    assert.deepEqual(second.controller.request(), { status: 'busy' });
    assert.equal(second.captures, 0);
    await job.finish('explicit-dialog-closed');
    const next = admitted(second.controller.request());
    next.cancelBeforeInvocation();
    second.preparation.resolve(second.resource);
    await flush();
    assert.equal(second.prints, 0);
    assert.equal(second.disposals, 1);
});

test('retirement during preparation fences late invocation and holds admission through resource cleanup', async () => {
    const admission = createPrintableFormAdmission();
    const f = fixture(admission);
    const sibling = fixture(admission);
    const job = admitted(f.controller.request());
    f.controller.retire();
    assert.equal(job.getSnapshot().phase, 'cancelled-before-invoke');
    assert.deepEqual(sibling.controller.request(), { status: 'busy' });
    assert.equal(sibling.captures, 0);
    f.preparation.resolve(f.resource);
    await flush();
    assert.equal(f.prints, 0);
    assert.equal(f.disposals, 1);
    assert.equal(job.getSnapshot().cleaned, true);
    assert.deepEqual(f.controller.request(), {
        status: 'refused',
        reason: 'retired',
    });
    const next = admitted(sibling.controller.request());
    next.cancelBeforeInvocation();
    sibling.preparation.resolve(sibling.resource);
    await flush();
});

test('publication reentry retires authority before capture, after capture and at the actual print boundary', async () => {
    for (const phase of ['capturing', 'preparing', 'invoking'] as const) {
        const f = fixture();
        f.controller.subscribe(() => {
            if (f.controller.getSnapshot().job?.getSnapshot().phase === phase)
                f.authority.scope.revision = {};
        });
        const request = f.controller.request();
        if (phase !== 'invoking') {
            assert.deepEqual(request, { status: 'refused', reason: 'retired' });
            assert.equal(f.captures, phase === 'capturing' ? 0 : 1);
            assert.equal(f.documents.length, 0);
        } else {
            const job = admitted(request);
            f.preparation.resolve(f.resource);
            await flush();
            assert.equal(job.getSnapshot().phase, 'cancelled-before-invoke');
            assert.equal(f.prints, 0);
            assert.equal(f.disposals, 1);
        }
    }
});

test('mutable authority containers and owner ABA cannot retarget a captured document', async () => {
    for (const change of ['container', 'ABA'] as const) {
        const f = fixture();
        const owner = f.authority.scope.owner;
        const job = admitted(f.controller.request());
        f.authority.scope.owner = {};
        if (change === 'ABA') {
            f.authority.scope.owner = owner;
            f.authority.scope.revision = {};
        }
        f.preparation.resolve(f.resource);
        await flush();
        assert.equal(f.prints, 0);
        assert.equal(f.disposals, 1);
        assert.equal(job.getSnapshot().phase, 'cancelled-before-invoke');
    }
});

test('host predicates cannot resurrect cancellation or retirement at either invocation fence', async () => {
    for (const phase of ['preparing', 'invoking'] as const) {
        for (const predicate of ['isCurrent', 'readAuthority'] as const) {
            for (const retirement of ['cancel', 'retire'] as const) {
                const f = fixture();
                const job = admitted(f.controller.request());
                let armed = phase === 'preparing';
                f.controller.subscribe(() => {
                    if (job.getSnapshot().phase === 'invoking') armed = true;
                });
                const original = f.source[predicate];
                const intervene = () => {
                    if (!armed) return;
                    armed = false;
                    if (retirement === 'retire') f.controller.retire();
                    else job.cancelBeforeInvocation();
                };
                if (predicate === 'isCurrent') {
                    f.source.isCurrent = (scope) => {
                        intervene();
                        return (original as typeof f.source.isCurrent)(scope);
                    };
                } else {
                    f.source.readAuthority = () => {
                        intervene();
                        return (original as typeof f.source.readAuthority)();
                    };
                }
                f.preparation.resolve(f.resource);
                await flush();
                assert.equal(
                    f.prints,
                    0,
                    `${phase}/${predicate}/${retirement}`
                );
                assert.equal(f.disposals, 1);
                assert.equal(job.getSnapshot().cleaned, true);
            }
        }
    }
});

test('afterPrint notification neither establishes invocation nor releases an uncertain job', async () => {
    const f = fixture();
    const job = admitted(f.controller.request());
    f.context.afterPrint();
    assert.equal(job.getSnapshot().afterPrintObserved, true);
    assert.equal(job.getSnapshot().phase, 'preparing');
    assert.equal(await job.finish('explicit-dialog-closed'), false);
    f.preparation.resolve(f.resource);
    await flush();
    f.context.afterPrint();
    assert.equal(job.getSnapshot().phase, 'invoked');
    assert.deepEqual(f.controller.request(), { status: 'busy' });
    assert.equal(f.disposals, 0);
    await job.finish('explicit-dialog-closed');
    const snapshot = f.controller.getSnapshot();
    f.context.afterPrint();
    assert.equal(f.controller.getSnapshot(), snapshot);
});

test('throwing browser invocation is unknown with no automatic retry or cleanup', async () => {
    const f = fixture();
    f.failPrint();
    const job = admitted(f.controller.request());
    f.preparation.resolve(f.resource);
    await flush();
    assert.equal(job.getSnapshot().phase, 'unknown');
    assert.equal(f.prints, 1);
    assert.equal(f.disposals, 0);
    assert.deepEqual(f.controller.request(), { status: 'busy' });
    assert.equal(job.cancelBeforeInvocation(), false);
    assert.equal(await job.finish('explicit-dialog-closed'), true);
    assert.equal(f.disposals, 1);
    assert.equal(f.prints, 1);
});

test('cleanup failure retains admission and only a separate explicit finish retries exact cleanup', async () => {
    const f = fixture();
    const job = admitted(f.controller.request());
    f.preparation.resolve(f.resource);
    await flush();
    f.failDisposal(true);
    assert.equal(await job.finish('explicit-dialog-closed'), false);
    assert.equal(job.getSnapshot().phase, 'unknown');
    assert.deepEqual(f.controller.request(), { status: 'busy' });
    assert.equal(f.prints, 1);
    f.failDisposal(false);
    assert.equal(await job.finish('explicit-dialog-closed'), true);
    assert.equal(f.disposals, 2);
    assert.equal(f.prints, 1);
});

test('only an explicitly selected keyboard lease admits a keyboard request', async () => {
    const admission = createPrintableFormAdmission();
    const first = fixture(admission);
    const second = fixture(admission);
    assert.deepEqual(first.controller.request('keyboard'), {
        status: 'refused',
        reason: 'not-allowed',
    });
    assert.equal(first.captures, 0);
    assert.equal(
        admission.setKeyboardOwner(null, second.authority.keyboardLease),
        true
    );
    assert.deepEqual(first.controller.request('keyboard'), {
        status: 'refused',
        reason: 'not-allowed',
    });
    const job = admitted(second.controller.request('keyboard'));
    job.cancelBeforeInvocation();
    second.preparation.resolve(second.resource);
    await flush();
    second.authority.keyboardLease = null;
    assert.equal(
        admission.setKeyboardOwner(admission.keyboardOwner(), null),
        true
    );
    assert.deepEqual(second.controller.request('keyboard'), {
        status: 'refused',
        reason: 'not-allowed',
    });
});

test('capture failure is bounded, releases synchronous admission and cannot publish partial data', () => {
    const admission = createPrintableFormAdmission();
    const f = fixture(admission);
    const controller = createPrintableFormController({
        admission,
        source: {
            ...f.source,
            capture() {
                throw Error('synthetic-private-value');
            },
        },
        engine: {
            async prepare() {
                throw Error('Must not prepare');
            },
        },
    });
    const refused = controller.request();
    assert.deepEqual(refused, { status: 'refused', reason: 'capture-failed' });
    assert.equal(
        JSON.stringify(refused).includes('synthetic-private-value'),
        false
    );
    assert.equal(controller.getSnapshot().job, null);
    const grant = admission.tryAcquire();
    assert.ok(grant);
    assert.equal(admission.release(grant), true);
});
