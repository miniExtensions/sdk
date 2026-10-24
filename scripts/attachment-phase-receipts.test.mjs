import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
    attachmentPhaseCapacity,
    attachmentPhaseMaxBytes,
    createAttachmentPhaseReceipt,
    safeAttachmentPhaseMarker,
} from './attachment-phase-receipts.mjs';
import { runPackedTailChecks } from './packed-tail-checks.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sentinel = 'SYNTHETIC_FIXTURE_VALUE_MUST_NOT_APPEAR';
const phaseNames = [
    'upload-release',
    'settlement',
    'global-restoration',
    'happydom-close',
];
const recordKeys = ['sequence', 'caseIndex', 'total', 'phase', 'event', 'atMs'];
function assertValueFree(receipt) {
    assert.deepEqual(
        Object.keys(receipt).sort(),
        [
            'active',
            'capacity',
            'evicted',
            'pid',
            'records',
            'rejected',
            'schemaVersion',
            'sequence',
            'suite',
            'writeFailures',
        ].sort()
    );
    assert.equal(JSON.stringify(receipt).includes(sentinel), false);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.suite, 'attachment');
    for (const record of [
        ...receipt.records,
        ...(receipt.active ? [receipt.active] : []),
    ]) {
        assert.deepEqual(Object.keys(record).sort(), [...recordKeys].sort());
        assert(phaseNames.includes(record.phase));
        assert(['start', 'complete'].includes(record.event));
        for (const key of ['sequence', 'caseIndex', 'total', 'atMs'])
            assert(Number.isFinite(record[key]));
    }
}
function assertPending(receipt, phase) {
    assertValueFree(receipt);
    assert.equal(receipt.writeFailures, 0);
    assert.equal(receipt.rejected, 0);
    assert.equal(receipt.evicted, 0);
    assert.equal(receipt.active?.phase, phase, 'Exact pending phase required');
    assert.equal(receipt.active.event, 'start');
    assert.equal(receipt.active.caseIndex, 73);
    assert.equal(receipt.active.total, 90);
    assert.deepEqual(receipt.records.at(-1), receipt.active);
}

// Execute the actual instrumented finally block with controlled ports, rather
// than reimplementing its order in a lookalike fixture.
async function actualTeardownBody() {
    const source = await readFile(
        new URL('./attachment-review-recipe-checks.mjs', import.meta.url),
        'utf8'
    );
    const ast = ts.createSourceFile(
        'attachment.mjs',
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
    const blocks = [];
    const visit = (node) => {
        if (
            ts.isTryStatement(node) &&
            node.finallyBlock
                ?.getText(ast)
                .includes('await window.happyDOM.close()')
        )
            blocks.push(node.finallyBlock);
        ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(blocks.length, 1);
    return blocks[0].statements.map((node) => node.getText(ast)).join('\n');
}

test('attachment teardown markers retain original calls and awaits in order', async () => {
    const body = await actualTeardownBody();
    const ast = ts.createSourceFile(
        'body.mjs',
        body,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
    const original = `releaseUpload(); await settled();
        for (const [key, descriptor] of previous)
            if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
            else Object.defineProperty(globalThis, key, descriptor);
        await window.happyDOM.close();`;
    const originalAst = ts.createSourceFile(
        'original.mjs',
        original,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
    const printer = ts.createPrinter({ removeComments: true });
    const withoutMarkers = ast.statements.filter(
        (node) =>
            !(
                ts.isExpressionStatement(node) &&
                ts.isCallExpression(node.expression) &&
                node.expression.expression.getText(ast) === 'markTeardown'
            )
    );
    const print = (nodes, file) =>
        nodes
            .map((node) =>
                printer.printNode(ts.EmitHint.Unspecified, node, file)
            )
            .join('\n');
    assert.equal(
        print(withoutMarkers, ast),
        print(originalAst.statements, originalAst)
    );
    const AsyncFunction = Object.getPrototypeOf(
        async function () {}
    ).constructor;
    const run = new AsyncFunction(
        'releaseUpload',
        'settled',
        'previous',
        'globalThis',
        'window',
        'markTeardown',
        'index',
        'scenarios',
        body
    );
    const calls = [];
    const recorder = createAttachmentPhaseReceipt({
        persist: () => {},
        now: () => 1,
    });
    const globals = new Proxy(
        {},
        {
            defineProperty() {
                calls.push('restore');
                return true;
            },
        }
    );
    await run(
        () => calls.push('release'),
        async () => calls.push('settle'),
        [['fixture', { value: sentinel }]],
        globals,
        { happyDOM: { close: async () => calls.push('close') } },
        recorder.mark,
        72,
        Array(90)
    );
    assert.deepEqual(calls, ['release', 'settle', 'restore', 'close']);
    const receipt = recorder.snapshot();
    assertValueFree(receipt);
    assert.equal(receipt.active, null);
    assert.deepEqual(
        receipt.records.map(({ phase, event }) => [phase, event]),
        phaseNames.flatMap((phase) => [
            [phase, 'start'],
            [phase, 'complete'],
        ])
    );
    const originalError = { synthetic: sentinel };
    await assert.rejects(
        run(
            () => {
                throw originalError;
            },
            async () => {},
            [],
            {},
            {},
            safeAttachmentPhaseMarker(() => {
                throw Error(sentinel);
            }),
            72,
            Array(90)
        ),
        (error) => error === originalError
    );
});

test('attachment receipt storage is bounded, value-free and stops after failure', () => {
    let latest;
    const recorder = createAttachmentPhaseReceipt({
        persist: (text) => {
            latest = text;
        },
        now: () => 1e12,
    });
    recorder.mark(sentinel, 90, 'settlement', 'start');
    recorder.mark(1, 90, sentinel, 'start');
    for (let i = 0; i < 200; i++)
        recorder.mark(1, 90, 'settlement', i % 2 ? 'complete' : 'start');
    const receipt = JSON.parse(latest);
    assertValueFree(receipt);
    assert.equal(receipt.records.length, attachmentPhaseCapacity);
    assert.equal(receipt.evicted, 200 - attachmentPhaseCapacity);
    assert.equal(receipt.rejected, 2);
    assert(Buffer.byteLength(latest) <= attachmentPhaseMaxBytes);
    let attempts = 0;
    let warnings = 0;
    const failed = createAttachmentPhaseReceipt({
        persist: () => {
            attempts++;
            throw Error(sentinel);
        },
        warn: () => {
            warnings++;
            throw Error(sentinel);
        },
    });
    for (let i = 0; i < 10; i++) failed.mark(73, 90, 'settlement', 'start');
    assert.equal(attempts, 1);
    assert.equal(warnings, 1);
    assert.equal(failed.snapshot().writeFailures, 1);
    assertValueFree(failed.snapshot());
    assert.throws(
        () => createAttachmentPhaseReceipt({ pid: sentinel }),
        TypeError
    );
    assert.equal(createAttachmentPhaseReceipt().snapshot().records.length, 0);
});

async function timeoutFixture(t, phase, fault = 'none') {
    const root = await mkdtemp(join(tmpdir(), 'sdk-attachment-phase-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const moduleUrl = new URL(
        './attachment-phase-receipts.mjs',
        import.meta.url
    ).href;
    const worker = join(root, 'worker.mjs');
    await writeFile(
        worker,
        `
        import assert from 'node:assert/strict';
        import { writeFileSync } from 'node:fs';
        import { join } from 'node:path';
        import { createAttachmentPhaseReceipt, safeAttachmentPhaseMarker } from ${JSON.stringify(moduleUrl)};
        const [suite, directory] = process.argv.slice(2);
        const observe = phase => new Promise(resolve => {
            process.once('message', message => {
                assert.deepEqual(message, {schemaVersion:1,suite,phase,accepted:true}); resolve();
            });
            process.send({schemaVersion:1,suite,phase});
        });
        await observe('start');
        if (suite === 'attachment') {
            const fault = ${JSON.stringify(fault)};
            const receipt = createAttachmentPhaseReceipt({
                outputDirectory: directory,
                ...(fault === 'leak' ? {persist: text => writeFileSync(
                    join(directory, 'attachment-phase-' + process.pid + '.json'),
                    JSON.stringify({...JSON.parse(text), fixtureValue:${JSON.stringify(sentinel)}}))} : {}),
            });
            writeFileSync(join(directory,'attachment.pid'), String(process.pid));
            const phase = ${JSON.stringify(phase)};
            const block = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
            const wait = () => new Promise(() => {});
            const keepAlive = setInterval(() => {}, 1000);
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            const run = new AsyncFunction('releaseUpload','settled','previous','globalThis','window','markTeardown','index','scenarios',${JSON.stringify(await actualTeardownBody())});
            const globals = new Proxy({}, {defineProperty() {
                if (phase === 'global-restoration') block(); return true;
            }});
            await run(() => {if(phase==='upload-release') block();},
                () => phase==='settlement' ? wait() : Promise.resolve(),
                [['fixture',{value:${JSON.stringify(sentinel)}}]], globals,
                {happyDOM:{close:()=>phase==='happydom-close'?wait():Promise.resolve()}},
                safeAttachmentPhaseMarker((...args) => {
                    if(fault==='omit-start' && args[2]===phase && args[3]==='start') return;
                    receipt.mark(...args);
                }), 72, Array(90));
            clearInterval(keepAlive);
        }
        await observe('finish');
        process.send({schemaVersion:1,suite,result:suite==='review'?{checks:51}:{checks:104,browserChecks:90}},()=>process.disconnect());
    `
    );
    await assert.rejects(
        runPackedTailChecks({
            consumerDirectory: root,
            happyDomModulePath: 'unused-controlled-port',
            workerFile: worker,
            timeoutMs: 3000,
            terminationGraceMs: 100,
            drainTimeoutMs: 2000,
        }),
        (error) => {
            assert(error instanceof AggregateError);
            assert.equal(error.cleanupSafe, true);
            assert(
                error.errors.some(
                    (nested) =>
                        nested.message === '[attachment] Worker timed out'
                )
            );
            return true;
        }
    );
    const pid = Number(await readFile(join(root, 'attachment.pid'), 'utf8'));
    const file = join(root, `attachment-phase-${pid}.json`);
    const text = await readFile(file, 'utf8');
    assert(Buffer.byteLength(text) <= attachmentPhaseMaxBytes);
    const files = (await readdir(root)).filter((name) =>
        name.startsWith('attachment-phase-')
    );
    assert(files.length <= 2);
    return JSON.parse(text);
}

test(
    'attachment phase receipts survive controlled timeout with original supervisor guards',
    { timeout: 60000 },
    async (t) => {
        for (const phase of phaseNames) {
            await t.test(phase, async (t) => {
                assertPending(await timeoutFixture(t, phase), phase);
            });
        }
    }
);

test(
    'failing diagnostic-port controls detect lost pending marker and leaked value',
    { timeout: 30000 },
    async (t) => {
        const omitted = await timeoutFixture(t, 'happydom-close', 'omit-start');
        assert.throws(() => assertPending(omitted, 'happydom-close'), {
            code: 'ERR_ASSERTION',
            message: /Exact pending phase required/,
        });
        const leaked = await timeoutFixture(t, 'happydom-close', 'leak');
        assert.throws(() => assertValueFree(leaked), { code: 'ERR_ASSERTION' });
        // These are controlled diagnostic-port faults, not SDK runtime mutations.
    }
);
