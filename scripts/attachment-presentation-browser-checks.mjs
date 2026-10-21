import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertBrowserInputs } from './package-checks.mjs';

// Private script seam: exercise the same independent cleanup sequence without
// launching a browser when checking ownership/error preservation.
export async function cleanupAttachmentPresentation({
    evidence,
    steps,
    bounded,
    primaryFailure,
}) {
    const cleanupErrors = [];
    for (const [name, available, cleanup, ownerBounded] of steps) {
        if (!available) {
            evidence.cleanup[name] = 'not-acquired';
            continue;
        }
        try {
            if (ownerBounded) await cleanup();
            else await bounded(`Attachment cleanup ${name}`, cleanup);
            evidence.cleanup[name] = 'completed';
        } catch (error) {
            evidence.cleanup[name] = { status: 'failed' };
            cleanupErrors.push(error);
        }
    }
    if (!cleanupErrors.length) return primaryFailure;
    evidence.status = 'failed';
    return {
        error: new AggregateError(
            primaryFailure === undefined
                ? cleanupErrors
                : [primaryFailure.error, ...cleanupErrors],
            'Attachment presentation and cleanup did not complete.'
        ),
    };
}

// Uses the same installed archive and sandboxed browser as check:browser.
// All transports and completions are synthetic; the real SDK owns the state.
export async function checkAttachmentPresentationBrowser({
    browser,
    consumer,
    fixture,
    output,
    createChooserOwner,
    evidence,
}) {
    assert(evidence && typeof evidence === 'object', 'Proof evidence required');
    const errors = [],
        external = [],
        captures = [];
    Object.assign(evidence, {
        status: 'running',
        phase: 'building',
        chooser: {},
        cleanup: {},
        captures,
    });
    let server, context, page, chooserOwner, exerciseFailure;
    let traceRequested = false;
    const bounded = async (label, operation) => {
        let timer;
        try {
            return await Promise.race([
                Promise.resolve().then(operation),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                new Error(`${label} timed out after 5000ms`)
                            ),
                        5000
                    );
                }),
            ]);
        } finally {
            clearTimeout(timer);
        }
    };
    const source = `
import {createElement as h, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createMiniExtensionsClient} from '@miniextensions/sdk';
import {createFormFieldBindings, RecoveryJournal} from '@miniextensions/sdk/forms';
import {AttachmentField} from '@miniextensions/sdk/react';
const loaded = ${JSON.stringify(fixture)};
const fieldId = 'fld_review_private_files';
const row = loaded.payload.formRecord.data[fieldId][0];
loaded.payload.formRecord.data[fieldId] = [row, {...row, size:501}, row];
loaded.payload.fieldIdsToSchemas[fieldId].miniExtConfig = {title:'Files', hideAttachmentName:true};
const calls = [], flights = [];
let generation = 0, owner, controller;
const client = createMiniExtensionsClient({apiOrigin:'https://synthetic-sdk.invalid', fetch:async () => {throw Error('Unexpected I/O');}});
client.forms.save = async input => {calls.push({operation:'save', input}); return {type:'error', formValidationErrors:[], formErrors:{}};};
client.attachments.uploadFile = async (input, options) => {
    calls.push({operation:'upload', name:input.filename});
    return new Promise((resolve,reject) => flights.push({resolve,reject,signal:options.signal}));
};
const replace = () => {
    owner?.destroy();
    const id = 'owner-' + ++generation;
    owner = createFormFieldBindings({client, loaded:structuredClone(loaded), getScope:() => ({ownerId:id, revision:0}), saveOptions:{captchaVal:null,isComputeMode:false,searchQuery:{},context:{type:'direct-url'},conditionalLinkedRecordFieldIdsToFilteringValues:{}}});
    controller = owner.attachment(fieldId, {journal:new RecoveryJournal(),loadVersion:1,scope:{owner:id,parentFieldId:null,tableId:null,childExtensionId:loaded.extensionId,context:'direct-url'}});
};
replace();
window.attachmentProbe = {
    snapshot:() => ({phase:controller.getSnapshot().phase, busy:controller.getSnapshot().busy, pending:controller.getSnapshot().files.map(f=>f.name), native:owner.field(fieldId).getSnapshot().value, calls, aborted:flights.map(f=>f.signal.aborted)}),
    accept:() => flights.shift().resolve({id:null,url:'https://files.invalid/PRIVATE_accepted',filename:'PRIVATE_accepted.txt',size:1,type:'text/plain'}),
    reject:() => flights.shift().reject(Error('Lost response')),
};
function Host() {
    const [mounted,setMounted] = useState(true);
    const [,refresh] = useState(0);
    const button = (label,onClick) => h('button',{type:'button',onClick},label);
    return h('div',null,
        h('h1',null,'Attachment presentation'),
        h('p',null,'Synthetic local Form. Upload each file explicitly, then Save.'),
        mounted ? h(AttachmentField,{binding:owner.field(fieldId),controller}) : null,
        h('div',{className:'host-actions'},
            button('Save',()=>void owner.save().catch(()=>{})),
            button('Replace owner',()=>{replace();refresh(n=>n+1);}),
            button('Unmount field',()=>setMounted(false)),
            button('Remount field',()=>setMounted(true)),
            button('Outside control',()=>{})));
}
createRoot(document.querySelector('main')).render(h(Host));
`;
    try {
        assert.equal(
            typeof createChooserOwner,
            'function',
            'Chooser owner factory required'
        );
        writeFileSync(
            join(consumer, 'attachment-presentation-host.mjs'),
            source
        );
        const bundle = await build({
            absWorkingDir: consumer,
            entryPoints: ['attachment-presentation-host.mjs'],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, consumer);
        evidence.phase = 'starting-server';
        server = createServer((request, response) => {
            if (request.url === '/host.js') {
                response.setHeader('content-type', 'text/javascript');
                response.end(bundle.outputFiles[0].contents);
            } else {
                response.setHeader('content-type', 'text/html');
                response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Attachment presentation</title><style>
body {font:16px/1.5 system-ui; color:#172033; background:#f8fafc; margin:0; padding:24px;}
main {max-width:640px; margin:auto;} section {background:white;} button {font:inherit; padding:8px 12px; border:1px solid #94a3b8; border-radius:6px; background:white; color:inherit; cursor:pointer;}
button:disabled {opacity:.55; cursor:default;} :focus-visible {outline:3px solid #2563eb; outline-offset:3px;} .host-actions {display:flex;flex-wrap:wrap;gap:8px;margin-top:24px;}
</style><main></main><script type="module" src="/host.js"></script></html>`);
            }
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({
            viewport: { width: 800, height: 900 },
            serviceWorkers: 'block',
            reducedMotion: 'reduce',
        });
        page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        await context.route('**/*', (route) => {
            if (new URL(route.request().url()).origin === origin)
                return route.continue();
            external.push(route.request().url());
            return route.abort();
        });
        const field = page.getByRole('region', { name: 'Files', exact: true });
        const button = (name) =>
            field.getByRole('button', { name, exact: true });
        const choose = button('Choose files');
        const upload = button('Upload next file');
        const cancel = button('Cancel upload');
        const status = field.getByRole('status');
        const probe = () =>
            page.evaluate(() => window.attachmentProbe.snapshot());
        const focusIs = async (locator) =>
            assert.equal(
                await locator.evaluate(
                    (node) => node === document.activeElement
                ),
                true
            );
        const capture = async (name) => {
            assert.doesNotMatch(await field.innerHTML(), /PRIVATE/);
            const ax = await field.ariaSnapshot();
            assert.doesNotMatch(ax, /PRIVATE/);
            const file = `attachment-${name}.png`;
            await page.screenshot({ path: join(output, file), fullPage: true });
            captures.push({ name, file, ax });
        };
        const select = async (names) =>
            field.locator('input[type=file]').setInputFiles(
                names.map((name) => ({
                    name,
                    mimeType: 'text/plain',
                    buffer: Buffer.from('a'),
                }))
            );
        const settle = async () => {
            await page.evaluate(() => window.attachmentProbe.accept());
            await page.waitForFunction(
                () => !window.attachmentProbe.snapshot().busy
            );
        };
        evidence.phase = 'mounting';
        await page.goto(origin);
        await field.waitFor();
        traceRequested = true;
        await bounded('Activation trace setup', () =>
            page.evaluate(() => {
                const events = [];
                const disposers = [];
                const controls = () => {
                    const field = document.querySelector(
                        'section[aria-label="Files"]'
                    );
                    const input = field?.querySelector('input[type=file]');
                    const choose = [
                        ...(field?.querySelectorAll('button') ?? []),
                    ].find((button) => button.textContent === 'Choose files');
                    return { field, input, choose };
                };
                const captured = controls();
                const state = () => {
                    const { field, input, choose } = controls();
                    const active = document.activeElement;
                    const flags = (node) =>
                        node
                            ? {
                                  connected: node.isConnected,
                                  disabled: Boolean(node.disabled),
                                  hidden: Boolean(node.hidden),
                                  isFile:
                                      node.tagName === 'INPUT' &&
                                      node.type === 'file',
                                  multiple: Boolean(node.multiple),
                              }
                            : null;
                    return {
                        hasFocus: document.hasFocus(),
                        visibility:
                            document.visibilityState === 'visible'
                                ? 'visible'
                                : 'hidden',
                        userActivation: {
                            isActive:
                                navigator.userActivation?.isActive ?? null,
                            hasBeenActive:
                                navigator.userActivation?.hasBeenActive ?? null,
                        },
                        activeKind:
                            active === choose
                                ? 'choose'
                                : active === input
                                  ? 'input'
                                  : 'other',
                        activeInsideField: Boolean(field?.contains(active)),
                        inputCount:
                            document.querySelectorAll('input[type=file]')
                                .length,
                        fieldInputCount:
                            field?.querySelectorAll('input[type=file]')
                                .length ?? 0,
                        currentInputIsCaptured: Boolean(
                            input && input === captured.input
                        ),
                        currentChooseIsCaptured: Boolean(
                            choose && choose === captured.choose
                        ),
                        capturedInputConnected: Boolean(
                            captured.input?.isConnected
                        ),
                        capturedChooseConnected: Boolean(
                            captured.choose?.isConnected
                        ),
                        choose: flags(choose),
                        input: flags(input),
                    };
                };
                const append = (event) => {
                    if (events.length === 32) events.shift();
                    events.push({
                        at: performance.now(),
                        ...event,
                        state: state(),
                    });
                };
                for (const type of [
                    'keydown',
                    'keypress',
                    'keyup',
                    'click',
                    'focus',
                    'focusin',
                ]) {
                    for (const capture of [true, false]) {
                        const listener = (event) => {
                            const { choose, input } = controls();
                            const nodeKind =
                                event.target === choose
                                    ? 'choose'
                                    : event.target === input
                                      ? 'input'
                                      : null;
                            const capturedNodeKind =
                                event.target === captured.choose
                                    ? 'choose'
                                    : event.target === captured.input
                                      ? 'input'
                                      : null;
                            if (nodeKind === null && capturedNodeKind === null)
                                return;
                            append({
                                type,
                                phase: capture ? 'capture' : 'bubble',
                                nodeKind,
                                capturedNodeKind,
                                isEnter: event.key === 'Enter',
                                isTab: event.key === 'Tab',
                                isTrusted: event.isTrusted,
                                defaultPrevented: event.defaultPrevented,
                            });
                        };
                        document.addEventListener(type, listener, {
                            capture,
                            passive: true,
                        });
                        disposers.push(() =>
                            document.removeEventListener(
                                type,
                                listener,
                                capture
                            )
                        );
                    }
                }
                window.__attachmentActivationTrace = {
                    checkpoint(label) {
                        append({
                            type: 'checkpoint',
                            label: ['before-enter', 'after-enter'].includes(
                                label
                            )
                                ? label
                                : 'other',
                        });
                    },
                    snapshot: () => ({ events, state: state() }),
                    dispose() {
                        for (const dispose of disposers) dispose();
                        delete window.__attachmentActivationTrace;
                    },
                };
            })
        );
        assert.equal((await probe()).calls.length, 0);
        assert.deepEqual(await field.locator('li span').allTextContents(), [
            'Attachment',
            'Attachment',
            'Attachment',
        ]);
        evidence.phase = 'native-removal';
        // Remove the middle native occurrence without disturbing duplicate order.
        await button('Remove attachment 2').focus();
        await page.keyboard.press('Enter');
        assert.deepEqual(
            (await probe()).native.map((row) => row.size),
            [500, 500]
        );
        await button('Remove attachment 2').focus();
        await page.keyboard.press('Enter');
        await focusIs(button('Remove attachment 1'));
        await button('Remove attachment 1').press('Enter');
        await focusIs(choose);
        // Native keyboard activation and an intercepted chooser completion.
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await focusIs(choose);
        evidence.phase = 'native-chooser';
        assert.equal(await page.locator('input[type=file]').count(), 1);
        const fileInput = await field
            .locator('input[type=file]')
            .elementHandle();
        assert(fileInput, 'Current attachment input required');
        chooserOwner = await createChooserOwner(page, evidence.chooser);
        await chooserOwner.choose(
            fileInput,
            async () => {
                await page.evaluate(() =>
                    window.__attachmentActivationTrace.checkpoint(
                        'before-enter'
                    )
                );
                await page.keyboard.press('Enter');
                await page.evaluate(() =>
                    window.__attachmentActivationTrace.checkpoint('after-enter')
                );
            },
            ['first', 'first', 'last'].map((name) => ({
                name: `PRIVATE_${name}.txt`,
                mimeType: 'text/plain',
                buffer: Buffer.from('a'),
            }))
        );
        // Freeze the chooser trace before later queue/remount exercises can
        // evict its native Enter events from the bounded live ring.
        evidence.activation = await bounded('Activation trace capture', () =>
            page.evaluate(() => window.__attachmentActivationTrace.snapshot())
        );
        evidence.phase = 'selected';
        assert.match(
            await status.textContent(),
            /3 pending files.*Files selected/s
        );
        await focusIs(choose);
        assert.equal(
            await choose.getAttribute('aria-describedby'),
            await status.getAttribute('id')
        );
        await capture('selected');
        await page.keyboard.press('Tab');
        await focusIs(upload);
        evidence.phase = 'uploading';
        await page.keyboard.press('Enter');
        await focusIs(cancel);
        assert.match(await status.textContent(), /Uploading one attachment/);
        assert.equal(
            await field.locator('progress').getAttribute('value'),
            null
        );
        assert.equal(
            await field.locator('progress').getAttribute('aria-valuenow'),
            null
        );
        await capture('uploading');
        await settle();
        evidence.phase = 'accepted';
        await focusIs(upload);
        assert.match(
            await status.textContent(),
            /2 pending files.*accepted into the draft.*Save/s
        );
        assert.deepEqual((await probe()).pending, [
            'PRIVATE_first.txt',
            'PRIVATE_last.txt',
        ]);
        assert.equal((await probe()).calls.length, 1);
        await capture('accepted');
        // Replacing a queue during a flight does not replace that captured upload.
        evidence.phase = 'queue-replacement';
        await upload.press('Enter');
        await select(['PRIVATE_replacement.txt']);
        await page
            .getByRole('button', { name: 'Outside control', exact: true })
            .focus();
        await settle();
        await focusIs(
            page.getByRole('button', { name: 'Outside control', exact: true })
        );
        assert.deepEqual((await probe()).pending, ['PRIVATE_replacement.txt']);
        assert.equal((await probe()).calls.length, 2);
        // Explicit cancellation remains uncertain even when its response arrives late.
        evidence.phase = 'cancel-upload';
        await upload.press('Enter');
        await cancel.press('Enter');
        assert.match(await status.textContent(), /Upload outcome uncertain/);
        const beforeLate = (await probe()).native;
        await settle();
        assert.deepEqual((await probe()).native, beforeLate);
        assert.equal(await upload.isDisabled(), true);
        assert.equal(await choose.isDisabled(), true);
        await focusIs(field);
        await button('Clear pending files').press('Enter');
        assert.match(
            await status.textContent(),
            /0 pending files.*Upload outcome uncertain/s
        );
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        assert.equal((await probe()).calls.length, 3);
        await capture('uncertain');
        evidence.phase = 'retained-uncertain';
        await page
            .getByRole('button', { name: 'Unmount field', exact: true })
            .click();
        await page
            .getByRole('button', { name: 'Remount field', exact: true })
            .click();
        assert.match(await status.textContent(), /Upload outcome uncertain/);
        // A lost response also announces uncertainty without requiring cancellation.
        evidence.phase = 'lost-response';
        await page
            .getByRole('button', { name: 'Replace owner', exact: true })
            .click();
        await select(['PRIVATE_lost.txt']);
        await upload.click();
        await page.evaluate(() => window.attachmentProbe.reject());
        await page.waitForFunction(
            () => !window.attachmentProbe.snapshot().busy
        );
        assert.match(await status.textContent(), /Upload outcome uncertain/);
        // Retired-owner completion cannot write into or refocus the replacement.
        evidence.phase = 'owner-replacement';
        await page
            .getByRole('button', { name: 'Replace owner', exact: true })
            .click();
        await select(['PRIVATE_old_owner.txt']);
        await upload.click();
        await page
            .getByRole('button', { name: 'Replace owner', exact: true })
            .click();
        await choose.focus();
        await settle();
        await focusIs(choose);
        assert.equal((await probe()).native.length, 3);
        assert.deepEqual((await probe()).pending, []);
        assert.match(await status.textContent(), /No pending files/);
        // Unmount is presentation cleanup; a current owner's upload can still settle.
        evidence.phase = 'unmount';
        await select(['PRIVATE_unmounted.txt']);
        await upload.click();
        await page
            .getByRole('button', { name: 'Unmount field', exact: true })
            .click();
        assert.deepEqual((await probe()).aborted, [false]);
        await settle();
        await focusIs(
            page.getByRole('button', { name: 'Unmount field', exact: true })
        );
        assert.equal(await field.count(), 0);
        await page
            .getByRole('button', { name: 'Remount field', exact: true })
            .click();
        assert.match(await status.textContent(), /accepted into the draft/);
        assert.equal((await probe()).native.length, 4);
        assert.equal(
            (await probe()).calls.filter((c) => c.operation === 'save').length,
            0
        );
        evidence.phase = 'narrow';
        await page.setViewportSize({ width: 360, height: 900 });
        assert.equal(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth
            ),
            true
        );
        await capture('narrow');
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        evidence.phase = 'complete';
    } catch (error) {
        exerciseFailure = { error };
        evidence.status = 'failed';
        evidence.failure = {
            phase: evidence.phase,
            message: 'Attachment presentation proof failed.',
            pageErrorCount: errors.length,
            pageErrors: errors.slice(0, 32).map(() => 'Page error observed.'),
            externalRequestCount: external.length,
        };
        if (page) {
            try {
                const diagnostics = await bounded('Failure diagnostics', () =>
                    page.evaluate(() => {
                        const state = window.attachmentProbe?.snapshot();
                        return {
                            activation:
                                window.__attachmentActivationTrace?.snapshot() ??
                                null,
                            probe: state
                                ? {
                                      phase: [
                                          'idle',
                                          'ready',
                                          'selected',
                                          'uploading',
                                          'accepted',
                                          'uncertain',
                                          'retired',
                                      ].includes(state.phase)
                                          ? state.phase
                                          : 'other',
                                      busy: Boolean(state.busy),
                                      pendingCount: state.pending.length,
                                      nativeCount: Array.isArray(state.native)
                                          ? state.native.length
                                          : null,
                                      operationTypes: state.calls
                                          .slice(0, 32)
                                          .map((call) =>
                                              ['save', 'upload'].includes(
                                                  call.operation
                                              )
                                                  ? call.operation
                                                  : 'other'
                                          ),
                                  }
                                : null,
                        };
                    })
                );
                evidence.activation ??= diagnostics.activation;
                evidence.failure.activation = diagnostics.activation;
                evidence.failure.probe = diagnostics.probe;
            } catch {
                evidence.failure.diagnostics = 'unavailable';
            }
            try {
                await bounded('Failure screenshot', () =>
                    page.screenshot({
                        path: join(output, 'attachment-failed.png'),
                        fullPage: true,
                    })
                );
                evidence.failure.screenshot = 'attachment-failed.png';
            } catch {
                evidence.failure.screenshot = 'unavailable';
            }
        }
    } finally {
        // Owner disposal already bounds each of its listener/interception/session
        // cleanup steps at 5s; do not shorten those independent budgets.
        exerciseFailure = await cleanupAttachmentPresentation({
            evidence,
            primaryFailure: exerciseFailure,
            bounded,
            steps: [
                [
                    'chooserOwner',
                    Boolean(chooserOwner),
                    () => chooserOwner.dispose(),
                    true,
                ],
                [
                    'activationTrace',
                    Boolean(page && traceRequested),
                    () =>
                        page.evaluate(() =>
                            window.__attachmentActivationTrace?.dispose()
                        ),
                    false,
                ],
                ['context', Boolean(context), () => context.close(), false],
                [
                    'server',
                    Boolean(server?.listening),
                    async () => {
                        server.closeAllConnections();
                        await new Promise((resolve, reject) =>
                            server.close((error) =>
                                error ? reject(error) : resolve()
                            )
                        );
                    },
                    false,
                ],
            ],
        });
    }
    if (exerciseFailure !== undefined) throw exerciseFailure.error;
    Object.assign(evidence, { status: 'passed', captures, errors, external });
    console.log(
        'Packed attachment presentation: keyboard/focus, selected/uploading/accepted/uncertain, duplicate order, queue/owner replacement, late completion, unmount and narrow layout passed'
    );
    return evidence;
}
