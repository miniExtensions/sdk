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
import { addAttachmentRootLoadCheckpoints } from './attachment-review-recipe-checks.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const sentinel = 'SYNTHETIC_FIXTURE_VALUE_MUST_NOT_APPEAR';
const phaseNames = [
    'upload-release',
    'settlement',
    'global-restoration',
    'happydom-close',
];
const scenarioPhaseNames = [
    'fixture-window-setup',
    'unique-import',
    'initialization',
    'scenario-assertions',
];
const pointPhaseNames = [
    'connect-submit-start',
    'connect-submit-end',
    'synthetic-response-start',
    'synthetic-response-ready',
    'response-consumed',
    'root-accept-start',
    'root-render-start',
    'root-render-end',
    'readiness-poll-start',
    'readiness-observed',
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
        if (pointPhaseNames.includes(record.phase)) {
            assert.equal(record.event, 'point');
        } else {
            assert(
                [...phaseNames, ...scenarioPhaseNames].includes(record.phase)
            );
            assert(['start', 'complete'].includes(record.event));
        }
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
    const isDiagnosticStop = (node) =>
        ts.isExpressionStatement(node) &&
        ts.isBinaryExpression(node.expression) &&
        node.expression.left.getText(ast) === 'recordingInitialization' &&
        node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        node.expression.right.kind === ts.SyntaxKind.FalseKeyword;
    const diagnosticStops = ast.statements.filter(isDiagnosticStop);
    assert.equal(diagnosticStops.length, 1);
    assert.equal(ast.statements[0], diagnosticStops[0]);
    const withoutMarkers = ast.statements.filter(
        (node) =>
            !isDiagnosticStop(node) &&
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
        'recordingInitialization',
        `${body}\nreturn recordingInitialization;`
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
    const recordingAfterTeardown = await run(
        () => calls.push('release'),
        async () => calls.push('settle'),
        [['fixture', { value: sentinel }]],
        globals,
        { happyDOM: { close: async () => calls.push('close') } },
        recorder.mark,
        72,
        Array(90),
        true
    );
    assert.equal(recordingAfterTeardown, false);
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
            Array(90),
            true
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

test('detailed scenario phases are ordered, bounded and value-free', () => {
    let latest;
    let clock = 0;
    const receipt = createAttachmentPhaseReceipt({
        persist: (text) => {
            latest = text;
        },
        now: () => ++clock,
    });
    const events = scenarioPhaseNames.flatMap((phase) => [
        [phase, 'start'],
        [phase, 'complete'],
    ]);
    for (const [phase, event] of events) receipt.mark(73, 90, phase, event);
    let snapshot = JSON.parse(latest);
    assertValueFree(snapshot);
    assert.deepEqual(
        snapshot.records.map(({ phase, event }) => [phase, event]),
        events
    );
    assert.deepEqual(
        snapshot.records.map(({ atMs }) => atMs),
        [1, 2, 3, 4, 5, 6, 7, 8]
    );
    assert.equal(snapshot.active, null);
    assert.equal(snapshot.rejected, 0);
    for (let i = 0; i < 80; i++)
        receipt.mark(73, 90, scenarioPhaseNames[i % 4], 'complete');
    receipt.mark(sentinel, 90, 'unique-import', 'start');
    receipt.mark(73, 90, sentinel, 'start');
    snapshot = receipt.snapshot();
    assertValueFree(snapshot);
    assert.equal(snapshot.records.length, attachmentPhaseCapacity);
    assert.equal(snapshot.evicted, 88 - attachmentPhaseCapacity);
    assert.equal(snapshot.rejected, 2);
    assert(Buffer.byteLength(latest) <= attachmentPhaseMaxBytes);
});

test('point checkpoints are bounded, value-free and preserve active phase', () => {
    let latest;
    let clock = 0;
    const receipt = createAttachmentPhaseReceipt({
        persist: (text) => {
            latest = text;
        },
        now: () => ++clock,
    });
    receipt.mark(73, 90, 'initialization', 'start');
    const active = receipt.snapshot().active;
    for (const phase of pointPhaseNames) {
        receipt.mark(73, 90, phase, 'point');
        assert.deepEqual(receipt.snapshot().active, active);
    }
    assertValueFree(receipt.snapshot());
    assert.deepEqual(
        receipt
            .snapshot()
            .records.slice(1)
            .map(({ phase, event }) => [phase, event]),
        pointPhaseNames.map((phase) => [phase, 'point'])
    );
    receipt.mark(73, 90, 'connect-submit-start', 'start');
    receipt.mark(73, 90, 'connect-submit-start', 'complete');
    receipt.mark(73, 90, 'initialization', 'point');
    assert.equal(receipt.snapshot().rejected, 3);
    assert.deepEqual(receipt.snapshot().active, active);
    receipt.mark(73, 90, 'initialization', 'complete');
    assert.equal(receipt.snapshot().active, null);
    for (let i = 0; i < 80; i++)
        receipt.mark(
            73,
            90,
            pointPhaseNames[i % pointPhaseNames.length],
            'point'
        );
    const snapshot = receipt.snapshot();
    assertValueFree(snapshot);
    assert.equal(snapshot.records.length, attachmentPhaseCapacity);
    assert.equal(snapshot.evicted, 92 - attachmentPhaseCapacity);
    assert.equal(snapshot.rejected, 3);
    assert(Buffer.byteLength(latest) <= attachmentPhaseMaxBytes);
});

test('bounded ring retains two complete checkpointed cases and loses earlier events', () => {
    const receipt = createAttachmentPhaseReceipt({ persist: () => {} });
    const events = [
        ...scenarioPhaseNames.flatMap((phase) => [
            [phase, 'start'],
            [phase, 'complete'],
        ]),
        ...pointPhaseNames.map((phase) => [phase, 'point']),
        ...phaseNames.flatMap((phase) => [
            [phase, 'start'],
            [phase, 'complete'],
        ]),
    ];
    assert.equal(events.length, 26);
    for (const index of [1, 2, 3])
        for (const [phase, event] of events)
            receipt.mark(index, 90, phase, event);
    const snapshot = receipt.snapshot();
    assertValueFree(snapshot);
    assert.equal(snapshot.records.length, attachmentPhaseCapacity);
    assert.equal(snapshot.evicted, 78 - attachmentPhaseCapacity);
    assert(
        snapshot.records.filter(({ caseIndex }) => caseIndex === 1).length <
            events.length
    );
    for (const index of [2, 3])
        assert.deepEqual(
            snapshot.records
                .filter(({ caseIndex }) => caseIndex === index)
                .map(({ phase, event }) => [phase, event]),
            events
        );
});

test('disabled detailed recording avoids clock and storage work', () => {
    let clockCalls = 0;
    let warnings = 0;
    const receipt = createAttachmentPhaseReceipt({
        now: () => {
            clockCalls++;
            throw Error(sentinel);
        },
        warn: () => warnings++,
    });
    for (const phase of scenarioPhaseNames) {
        receipt.mark(73, 90, phase, 'start');
        receipt.mark(73, 90, phase, 'complete');
    }
    for (const phase of pointPhaseNames) receipt.mark(73, 90, phase, 'point');
    assert.equal(clockCalls, 0);
    assert.equal(warnings, 0);
    assert.equal(receipt.snapshot().sequence, 0);
    assert.deepEqual(receipt.snapshot().records, []);
    assert.equal(receipt.snapshot().writeFailures, 0);
});

test('detailed marker failures cannot replace the original error', () => {
    const originalError = { synthetic: sentinel };
    let attempts = 0;
    let warnings = 0;
    const receipt = createAttachmentPhaseReceipt({
        persist: () => {
            attempts++;
            throw Error(sentinel);
        },
        warn: () => {
            warnings++;
            throw Error(sentinel);
        },
    });
    for (const phase of scenarioPhaseNames)
        assert.doesNotThrow(() => receipt.mark(73, 90, phase, 'start'));
    assert.equal(attempts, 1);
    assert.equal(warnings, 1);
    assert.equal(receipt.snapshot().writeFailures, 1);
    const marker = safeAttachmentPhaseMarker(() => {
        throw Error(sentinel);
    });
    assert.throws(
        () => {
            marker(73, 90, 'unique-import', 'start');
            throw originalError;
        },
        (error) => error === originalError
    );
});

test('detailed worker port requires the explicit opt-in', async () => {
    const source = await readFile(
        new URL('./packed-tail-worker.mjs', import.meta.url),
        'utf8'
    );
    const ast = ts.createSourceFile(
        'worker.mjs',
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
    const spreads = [];
    const visit = (node) => {
        if (
            ts.isSpreadAssignment(node) &&
            node.getText(ast).includes('SDK_ATTACHMENT_PHASE_DETAIL')
        )
            spreads.push(node.expression.getText(ast));
        ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(spreads.length, 1);
    const port = new Function(
        'teardownReceipt',
        'process',
        `return (${spreads[0]});`
    );
    const mark = () => {};
    for (const value of [undefined, '', '0', 'true'])
        assert.deepEqual(
            port(
                { mark },
                {
                    env: {
                        SDK_ATTACHMENT_PHASE_RECEIPT_DIR: 'owned',
                        SDK_ATTACHMENT_PHASE_DETAIL: value,
                    },
                }
            ),
            {}
        );
    assert.deepEqual(
        port(null, {
            env: {
                SDK_ATTACHMENT_PHASE_RECEIPT_DIR: 'owned',
                SDK_ATTACHMENT_PHASE_DETAIL: '1',
            },
        }),
        {}
    );
    assert.deepEqual(
        port({ mark }, { env: { SDK_ATTACHMENT_PHASE_DETAIL: '1' } }),
        {}
    );
    assert.deepEqual(
        port(
            { mark },
            {
                env: {
                    SDK_ATTACHMENT_PHASE_RECEIPT_DIR: 'owned',
                    SDK_ATTACHMENT_PHASE_DETAIL: '1',
                },
            }
        ),
        { onScenarioPhase: mark }
    );
});

test('root-load points instrument only unique starter anchors', async () => {
    const source = await readFile(
        new URL('../examples/browser/src/main.ts', import.meta.url),
        'utf8'
    );
    const result = addAttachmentRootLoadCheckpoints(source);
    const names = [
        'response-consumed',
        'root-accept-start',
        'root-render-start',
        'root-render-end',
    ];
    const capture =
        'const __sdkAttachmentPhasePoint = globalThis.__sdkAttachmentPhasePoint;\n';
    assert(result.startsWith(capture));
    const body = result.slice(capture.length);
    const points = [
        ...body.matchAll(/__sdkAttachmentPhasePoint\?\.\('([^']+)'\);/g),
    ].map((match) => match[1]);
    assert.deepEqual(points, names);
    assert.equal(
        body
            .split('\n')
            .filter((line) => !line.includes('__sdkAttachmentPhasePoint?.('))
            .join('\n'),
        source
    );
    const calls = [];
    const owner = { __sdkAttachmentPhasePoint: (phase) => calls.push(phase) };
    const invokeCaptured = new Function(
        'globalThis',
        `${capture}return () => __sdkAttachmentPhasePoint?.('response-consumed');`
    )(owner);
    owner.__sdkAttachmentPhasePoint = () => calls.push('later-owner');
    invokeCaptured();
    assert.deepEqual(calls, ['response-consumed']);
    assert.throws(
        () =>
            addAttachmentRootLoadCheckpoints(
                `${source}\n__sdkAttachmentPhasePoint`
            ),
        /checkpoint name must be unused/
    );
    const anchors = [
        '            let result = await client.loadExtension(connection.input, {\n                signal,\n            });',
        '            acceptRootLoad(visitor, result, query);\n            render();\n            const loadedMessage =',
    ];
    for (const anchor of anchors) {
        assert.equal(source.indexOf(anchor), source.lastIndexOf(anchor));
        assert.notEqual(source.indexOf(anchor), -1);
        assert.throws(
            () => addAttachmentRootLoadCheckpoints(source.replace(anchor, '')),
            /root-load anchor must be unique/
        );
        assert.throws(
            () => addAttachmentRootLoadCheckpoints(`${source}\n${anchor}`),
            /root-load anchor must be unique/
        );
    }
    const recipe = await readFile(
        new URL('./attachment-review-recipe-checks.mjs', import.meta.url),
        'utf8'
    );
    assert.match(
        recipe,
        /const source = onScenarioPhase\s*\?\s*addAttachmentRootLoadCheckpoints\(originalSource\)\s*:\s*originalSource/
    );
});

test('local points bracket submit, synthetic response, and readiness', async () => {
    const source = await readFile(
        new URL('./attachment-review-recipe-checks.mjs', import.meta.url),
        'utf8'
    );
    const position = (text) => {
        const index = source.indexOf(text);
        assert.notEqual(index, -1, `Missing checkpoint boundary: ${text}`);
        assert.equal(index, source.lastIndexOf(text));
        return index;
    };
    const responseStart = position("markPoint('synthetic-response-start')");
    const responseReady = position("markPoint('synthetic-response-ready')");
    const response = source.indexOf(
        'const response = new Response(JSON.stringify(page))',
        responseStart
    );
    assert(responseStart < response && response < responseReady);
    assert.match(
        source.slice(
            source.lastIndexOf(
                "if (route === 'fetchExtensionForEndUser')",
                responseStart
            ),
            responseStart
        ),
        /if \(!markPoint \|\| !initialResponsePending\)/
    );
    const submitStart = position("markPoint?.('connect-submit-start')");
    const submitEnd = position("markPoint?.('connect-submit-end')");
    const submit = source.indexOf(
        "document.getElementById('connection-form').dispatchEvent(",
        submitStart
    );
    assert(submitStart < submit && submit < submitEnd);
    const pollStart = position("markPoint?.('readiness-poll-start')");
    const observed = position("markPoint?.('readiness-observed')");
    const poll = source.indexOf('await waitFor(', pollStart);
    assert(submitEnd < pollStart && pollStart < poll && poll < observed);
    const stopped = source.indexOf(
        'recordingInitialization = false;',
        observed
    );
    const initializationComplete = source.indexOf(
        "'initialization',",
        observed
    );
    assert(observed < stopped && stopped < initializationComplete);
    assert.match(
        source,
        /\.\.\.\(markPoint \? \{ __sdkAttachmentPhasePoint: markPoint \} : \{\}\)/
    );
});

test('captured point callback stops after readiness or cleanup', async () => {
    const source = await readFile(
        new URL('./attachment-review-recipe-checks.mjs', import.meta.url),
        'utf8'
    );
    const ast = ts.createSourceFile(
        'recipe.mjs',
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS
    );
    const declarations = [];
    const visit = (node) => {
        if (
            ts.isVariableDeclaration(node) &&
            node.name.getText(ast) === 'markPoint'
        )
            declarations.push(node);
        ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(declarations.length, 1);
    const initializer = declarations[0].initializer.getText(ast);
    const make = new Function(
        'markScenario',
        `let recordingInitialization = true; const index = 72; const scenarios = Array(90); const marker = (${initializer}); return { marker, stop: () => { recordingInitialization = false; } };`
    );
    const calls = [];
    const enabled = make((...args) => calls.push(args));
    enabled.marker('synthetic-response-start');
    enabled.stop();
    enabled.marker('root-render-end');
    assert.deepEqual(calls, [[73, 90, 'synthetic-response-start', 'point']]);
    assert.equal(make(null).marker, null);
    const safe = make(
        safeAttachmentPhaseMarker(() => {
            throw Error(sentinel);
        })
    );
    assert.doesNotThrow(() => safe.marker('root-render-start'));
});

test('detailed markers bracket the actual scenario boundaries', async () => {
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
    const markers = [];
    const loops = [];
    const guarded = [];
    const visit = (node) => {
        if (
            ts.isForOfStatement(node) &&
            node.expression.getText(ast) === 'scenarios.entries()'
        )
            loops.push(node);
        if (
            ts.isTryStatement(node) &&
            node.finallyBlock
                ?.getText(ast)
                .includes('await window.happyDOM.close()')
        )
            guarded.push(node);
        if (
            ts.isCallExpression(node) &&
            node.expression.getText(ast) === 'markScenario' &&
            node.questionDotToken != null
        )
            markers.push(node);
        ts.forEachChild(node, visit);
    };
    visit(ast);
    assert.equal(loops.length, 1);
    assert.equal(guarded.length, 1);
    assert.equal(markers.length, 9);
    assert.deepEqual(
        markers.map((node) => {
            assert.equal(node.arguments.length, 4);
            assert.equal(
                node.arguments[0].getText(ast).replaceAll(' ', ''),
                'index+1'
            );
            assert.equal(node.arguments[1].getText(ast), 'scenarios.length');
            assert(ts.isStringLiteral(node.arguments[2]));
            assert(ts.isStringLiteral(node.arguments[3]));
            return [node.arguments[2].text, node.arguments[3].text];
        }),
        [
            ...scenarioPhaseNames.flatMap((phase) => [
                [phase, 'start'],
                [phase, 'complete'],
            ]),
            ['scenario-assertions', 'complete'],
        ]
    );
    for (const marker of markers)
        assert(
            marker.getStart(ast) > loops[0].getStart(ast) &&
                marker.end < loops[0].end
        );
    const positions = markers.map((node) => node.getStart(ast));
    const between = (text, from, to) => {
        const index = source.indexOf(text, from);
        assert(index > from && index < to, `Expected boundary: ${text}`);
    };
    between(
        "const fixture = createReviewFixture('review-answers')",
        positions[0],
        positions[1]
    );
    between('const window = new Window(', positions[0], positions[1]);
    between('Object.assign(globalThis, globals)', positions[0], positions[1]);
    assert(positions[1] < guarded[0].getStart(ast));
    between('const probe = await import(', positions[2], positions[3]);
    between('const document = window.document', positions[4], positions[5]);
    between('await waitFor(', positions[4], positions[5]);
    between('const file = document.querySelector(', positions[6], positions[7]);
    between('await settled()', positions[6], positions[8]);
    assert(positions[2] > guarded[0].tryBlock.getStart(ast));
    assert(positions[8] < guarded[0].tryBlock.end);
    assert(
        markers.every(
            (node) =>
                node.getStart(ast) < guarded[0].finallyBlock.getStart(ast) ||
                node.end > guarded[0].finallyBlock.end
        )
    );
    const continues = [];
    const findContinues = (node) => {
        if (ts.isContinueStatement(node)) continues.push(node);
        ts.forEachChild(node, findContinues);
    };
    findContinues(guarded[0].tryBlock);
    assert.equal(continues.length, 1);
    const uploadBlock = continues[0].parent;
    assert(ts.isBlock(uploadBlock));
    const continueIndex = uploadBlock.statements.indexOf(continues[0]);
    assert(continueIndex >= 2);
    const uploadMarker = uploadBlock.statements[continueIndex - 2];
    const uploadLog = uploadBlock.statements[continueIndex - 1];
    assert(ts.isExpressionStatement(uploadMarker));
    assert.equal(uploadMarker.expression, markers[7]);
    assert.match(uploadLog.getText(ast), /Packed attachment upload:/);
    const reviewBlock = markers[8].parent.parent;
    assert(ts.isBlock(reviewBlock));
    const reviewIndex = reviewBlock.statements.indexOf(markers[8].parent);
    assert(reviewIndex >= 0);
    assert.match(
        reviewBlock.statements[reviewIndex + 1].getText(ast),
        /Packed attachment Review:/
    );
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
