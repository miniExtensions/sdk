import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';

// Native keyboard input is essential: assigning/filling a number input cannot
// represent Chrome's nonempty invalid editing buffer with value === ''.
export async function checkNumberInputMaskBrowser({
    browser,
    consumer,
    evidence,
}) {
    assert(
        evidence && typeof evidence === 'object',
        'Number proof evidence required'
    );
    Object.assign(evidence, {
        status: 'running',
        phase: 'building',
        results: [],
        unexpectedRequests: [],
        pageErrors: [],
        cleanup: {},
    });
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
    let directory, server, context, page, failure;
    try {
        const root = realpathSync(consumer);
        directory = mkdtempSync(join(root, '.number-input-mask-'));
        evidence.starterSources = ['fields.ts', 'dom.ts'].map((name) => {
            const installed = join(
                root,
                'node_modules/@miniextensions/sdk/examples/browser/src',
                name
            );
            const copied = join(directory, name);
            const bytes = readFileSync(installed);
            writeFileSync(copied, bytes);
            assert.deepEqual(readFileSync(copied), bytes);
            return {
                installed: relative(root, installed),
                copied: relative(root, copied),
                bytes: bytes.length,
                sha256: hash(bytes),
            };
        });
        const host = `
import { AirtableFieldType } from '@miniextensions/sdk';
import { fieldControl } from './fields.ts';
let control, input, config, changes, inputs;
const requests = [];
window.fetch = async (...args) => { requests.push(String(args[0])); throw Error('Unexpected Number transport'); };
const snapshot = () => ({type:input.type,value:input.value,badInput:input.validity.badInput,valid:input.validity.valid,disabled:input.disabled,connected:input.isConnected,changes,inputs:[...inputs],requests:[...requests]});
const mount = (flag, masked) => {
    control?.destroy();
    config = {obscurePassword:false,maskPasswordOnLoginScreen:false};
    if (masked) config[flag] = true;
    changes = 0; inputs = [];
    control = fieldControl({id:'fld_number_mask_synthetic',name:'Synthetic Number',description:null,isComputed:false,isPrimaryField:false,config:{type:AirtableFieldType.NUMBER,options:{precision:0}}},config,null,() => {changes++;});
    document.querySelector('main').replaceChildren(control.node);
    input = control.node.querySelector('input');
    input.addEventListener('input', event => inputs.push({trusted:event.isTrusted,value:input.value,badInput:input.validity.badInput,type:input.type}));
    return snapshot();
};
window.numberInputMaskProbe = {
    mount, snapshot,
    policy:(flag, value) => {config[flag] = value; return snapshot();},
    read:() => {
        try { const value = control.read(); return {returned:true,value,state:snapshot()}; }
        catch(error) { return {returned:false,error:error.message,state:snapshot()}; }
    },
};
mount('obscurePassword', false);
`;
        writeFileSync(join(directory, 'host.mjs'), host);
        const bundle = await build({
            absWorkingDir: root,
            entryPoints: [join(directory, 'host.mjs')],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(bundle.metafile, root);
        evidence.hostSha256 = hash(host);
        evidence.bundleSha256 = hash(bundle.outputFiles[0].contents);
        evidence.bundleInputs = Object.keys(bundle.metafile.inputs).map(
            (input) => {
                const path = realpathSync(resolve(root, input));
                return {
                    path: relative(root, path),
                    sha256: hash(readFileSync(path)),
                };
            }
        );
        const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src 'none'; img-src data:; base-uri 'none'; form-action 'none'"><link rel="icon" href="data:,"><title>Native Number masking</title></head><body><main></main><script type="module" src="/host.js"></script></body></html>`;
        server = createServer((request, response) => {
            const path = new URL(request.url, 'http://127.0.0.1').pathname;
            if (request.method !== 'GET' || !['/', '/host.js'].includes(path)) {
                response.writeHead(404);
                response.end();
                return;
            }
            response.setHeader(
                'content-type',
                path === '/' ? 'text/html' : 'text/javascript'
            );
            response.end(path === '/' ? html : bundle.outputFiles[0].contents);
        });
        evidence.phase = 'starting-server';
        await bounded(
            'Number server startup',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = `http://127.0.0.1:${server.address().port}`;
        context = await browser.newContext({ serviceWorkers: 'block' });
        context.setDefaultTimeout(5000);
        await context.route('**/*', (route) => {
            const url = new URL(route.request().url());
            if (
                url.origin === origin &&
                ['/', '/host.js'].includes(url.pathname)
            )
                return route.continue();
            evidence.unexpectedRequests.push({
                url: route.request().url(),
                method: route.request().method(),
            });
            return route.abort();
        });
        page = await context.newPage();
        page.on('pageerror', (error) =>
            evidence.pageErrors.push(error.message)
        );
        const input = page.locator(
            'input[data-field-id="fld_number_mask_synthetic"]'
        );
        const probe = () =>
            page.evaluate(() => window.numberInputMaskProbe.snapshot());
        const read = () =>
            page.evaluate(() => window.numberInputMaskProbe.read());
        const clear = async () => {
            await input.press('ControlOrMeta+A');
            await input.press('Backspace');
        };
        const failures = [];
        const run = async (flag, masked) => {
            const result = {
                flag,
                direction: masked ? 'password-to-number' : 'number-to-password',
                status: 'running',
                captures: [],
            };
            evidence.results.push(result);
            evidence.phase = `${flag}:${result.direction}`;
            try {
                await page.goto(origin);
                await page.waitForFunction(() =>
                    Boolean(window.numberInputMaskProbe)
                );
                await page.evaluate(
                    ({ flag, masked }) =>
                        window.numberInputMaskProbe.mount(flag, masked),
                    { flag, masked }
                );
                assert.equal(await input.count(), 1);
                await input.focus();
                await input.pressSequentially('1e');
                const before = await probe();
                result.captures.push({
                    phase: 'native-invalid-before-policy',
                    state: before,
                });
                assert.equal(before.connected, true);
                assert.equal(before.disabled, false);
                assert.equal(before.type, masked ? 'password' : 'number');
                assert.equal(before.value, masked ? '1e' : '');
                assert.equal(before.badInput, !masked);
                assert.equal(before.inputs.length, 2);
                assert(before.inputs.every((event) => event.trusted));
                assert.equal(before.inputs[0].value, '1');
                assert.equal(before.inputs[1].value, masked ? '1e' : '');
                assert.equal(
                    before.changes,
                    2,
                    'onChange counts input without reading it.'
                );
                const policy = await page.evaluate(
                    ({ flag, value }) =>
                        window.numberInputMaskProbe.policy(flag, value),
                    { flag, value: !masked }
                );
                assert.equal(
                    policy.type,
                    before.type,
                    'Policy change alone does not read the control.'
                );
                assert.equal(policy.badInput, before.badInput);
                const rejected = await read();
                result.captures.push({
                    phase: 'invalid-read-after-policy',
                    ...rejected,
                });
                assert.equal(
                    rejected.returned,
                    false,
                    'An unfinished native draft must throw, never return null.'
                );
                assert.match(rejected.error, /must be a (valid )?number/);
                assert.equal(rejected.state.type, before.type);
                assert.equal(rejected.state.value, before.value);
                assert.equal(rejected.state.badInput, before.badInput);
                await clear();
                await input.pressSequentially('5678');
                const repaired = await read();
                result.captures.push({
                    phase: 'keyboard-repaired',
                    ...repaired,
                });
                assert.equal(repaired.returned, true);
                assert.equal(repaired.value, 5678);
                assert.equal(
                    repaired.state.type,
                    masked ? 'number' : 'password'
                );
                assert.equal(repaired.state.badInput, false);
                await clear();
                const empty = await read();
                result.captures.push({ phase: 'keyboard-cleared', ...empty });
                assert.equal(empty.returned, true);
                assert.equal(empty.value, null);
                assert.equal(empty.state.value, '');
                assert.equal(empty.state.badInput, false);
                assert.deepEqual(empty.state.requests, []);
                assert(empty.state.inputs.every((event) => event.trusted));
                result.status = 'passed';
            } catch (error) {
                result.status = 'failed';
                result.error = error.message;
                failures.push(error);
            }
        };
        for (const flag of ['obscurePassword', 'maskPasswordOnLoginScreen']) {
            await run(flag, false);
            await run(flag, true);
        }
        assert.deepEqual(evidence.unexpectedRequests, []);
        assert.deepEqual(evidence.pageErrors, []);
        if (failures.length)
            throw new AggregateError(
                failures,
                'Native Number masking regressions failed.'
            );
        evidence.status = 'passed';
    } catch (error) {
        failure = error;
        evidence.status = 'failed';
        evidence.error = error.message;
    } finally {
        const cleanupErrors = [];
        for (const [name, acquired, cleanup] of [
            ['context', Boolean(context), () => context.close()],
            [
                'server',
                Boolean(server),
                () =>
                    new Promise((resolve, reject) => {
                        server.closeAllConnections();
                        server.close((error) =>
                            error ? reject(error) : resolve()
                        );
                    }),
            ],
            [
                'probe',
                Boolean(directory),
                () => {
                    rmSync(directory, { recursive: true, force: true });
                    assert(!existsSync(directory));
                },
            ],
        ]) {
            if (!acquired) {
                evidence.cleanup[name] = 'not-acquired';
                continue;
            }
            try {
                await bounded(`Number cleanup ${name}`, cleanup);
                evidence.cleanup[name] = 'completed';
            } catch (error) {
                evidence.cleanup[name] = {
                    status: 'failed',
                    error: error.message,
                };
                cleanupErrors.push(error);
            }
        }
        if (cleanupErrors.length) {
            evidence.status = 'failed';
            failure = new AggregateError(
                failure ? [failure, ...cleanupErrors] : cleanupErrors,
                'Number proof and cleanup failed.'
            );
        }
    }
    if (failure) throw failure;
    return evidence;
}
