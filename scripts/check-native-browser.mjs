import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {
    mkdtempSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    rmSync,
    readdirSync,
    lstatSync,
    realpathSync,
    existsSync,
} from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createReviewFixture } from './build-privacy-browser-proof.mjs';
import { addAttachmentReviewAnswers } from './attachment-review-recipe-checks.mjs';
import { portalRecipeFixtures as fixtures } from './portal-recipe-checks.mjs';

// One public CDP interception owner. Playwright filechooser subscriptions have
// their own asynchronous enable/disable path and must not share this lease.
const createFileChooserOwner = async (
    page,
    evidence,
    timers = { setTimeout, clearTimeout }
) => {
    assert.equal(page.listenerCount('filechooser'), 0);
    const session = await page.context().newCDPSession(page);
    let retired = false;
    let active;
    let failure;
    let disposal;
    let sequence = 0;
    evidence.events = [];
    evidence.cleanup = {};
    const fail = (error) => {
        failure ??= error;
        active?.reject?.(failure);
    };
    const onChooser = (event) => {
        if (retired) return;
        const ticket = active;
        evidence.events.push({
            activation: ticket?.sequence ?? null,
            phase: ticket?.phase ?? 'unarmed',
            ...event,
        });
        if (!ticket || ticket.phase !== 'activated' || ticket.received) {
            fail(new Error('Duplicate or unarmed CDP file chooser event'));
            return;
        }
        // Consume synchronously: a duplicate cannot start another acceptance.
        ticket.received = true;
        try {
            assert.deepEqual(
                {
                    frameId: event.frameId,
                    backendNodeId: event.backendNodeId,
                    mode: event.mode,
                },
                ticket.expected
            );
            ticket.resolve(event);
        } catch (error) {
            fail(error);
        }
    };
    const current = (ticket) => {
        assert(!retired && active === ticket, 'Chooser activation retired');
        if (failure) throw failure;
        assert.equal(page.listenerCount('filechooser'), 0);
    };
    const identity = async (input, wait) => {
        const { root } = await wait(session.send('DOM.getDocument'));
        const { nodeId } = await wait(
            session.send('DOM.querySelector', {
                nodeId: root.nodeId,
                selector: 'dialog[open] input[type=file]',
            })
        );
        assert(nodeId, 'Current dialog file input required');
        const { node } = await wait(
            session.send('DOM.describeNode', { nodeId })
        );
        const { frameTree } = await wait(session.send('Page.getFrameTree'));
        const actual = await wait(
            input.evaluate((element) => ({
                multiple: element.multiple,
                current:
                    element ===
                    document.querySelector('dialog[open] input[type=file]'),
            }))
        );
        assert(actual.current, 'File input identity changed');
        return {
            frameId: frameTree.frame.id,
            backendNodeId: node.backendNodeId,
            mode: actual.multiple ? 'selectMultiple' : 'selectSingle',
        };
    };
    const dispose = () => {
        if (disposal) return disposal;
        retired = true;
        if (active) {
            timers.clearTimeout(active.timer);
            active.reject?.(new Error('Chooser owner disposed'));
        }
        disposal = (async () => {
            const errors = [];
            for (const [name, cleanup] of [
                [
                    'interception',
                    () =>
                        session.send('Page.setInterceptFileChooserDialog', {
                            enabled: false,
                        }),
                ],
                [
                    'listener',
                    () => session.off('Page.fileChooserOpened', onChooser),
                ],
                ['session', () => session.detach()],
            ]) {
                try {
                    await cleanup();
                    evidence.cleanup[name] = 'completed';
                } catch (error) {
                    evidence.cleanup[name] = { error: error.message };
                    errors.push(error);
                }
            }
            if (errors.length)
                throw new AggregateError(errors, 'Chooser cleanup failed');
        })();
        return disposal;
    };
    try {
        session.on('Page.fileChooserOpened', onChooser);
        await session.send('Page.enable', {
            enableFileChooserOpenedEvent: true,
        });
    } catch (error) {
        try {
            await dispose();
        } catch (cleanupError) {
            throw new AggregateError(
                [error, cleanupError],
                'Chooser setup and cleanup failed'
            );
        }
        throw error;
    }
    return {
        dispose,
        async choose(input, activate, files) {
            assert(!active && !retired, 'Only one chooser activation allowed');
            if (failure) throw failure;
            const ticket = { sequence: ++sequence, phase: 'preparing' };
            active = ticket;
            // One unchanged 30s deadline covers all activation awaits, not only
            // delivery after a possibly still-pending interception command.
            const deadline = new Promise((_, reject) => {
                ticket.reject = reject;
                ticket.timer = timers.setTimeout(() => {
                    if (active === ticket && !retired)
                        fail(
                            new Error(
                                'CDP file chooser timed out after 30000ms'
                            )
                        );
                }, 30000);
            });
            deadline.catch(() => {});
            const wait = async (operation) => {
                const result = await Promise.race([operation, deadline]);
                current(ticket);
                return result;
            };
            let error;
            try {
                ticket.expected = await identity(input, wait);
                current(ticket);
                const received = new Promise((resolve) => {
                    ticket.resolve = resolve;
                });
                ticket.phase = 'enabling';
                await wait(
                    session.send('Page.setInterceptFileChooserDialog', {
                        enabled: true,
                    })
                );
                current(ticket);
                ticket.phase = 'activated';
                await wait(activate());
                await wait(received);
                current(ticket);
                ticket.phase = 'completing';
                assert.deepEqual(await identity(input, wait), ticket.expected);
                current(ticket);
                await wait(input.setInputFiles(files));
                current(ticket);
            } catch (caught) {
                error = caught;
            } finally {
                timers.clearTimeout(ticket.timer);
                ticket.phase = 'draining';
                ticket.reject?.(new Error('Chooser activation settled'));
                if (!retired) {
                    try {
                        await session.send(
                            'Page.setInterceptFileChooserDialog',
                            { enabled: false }
                        );
                        // Same-session response fence drains earlier received
                        // callbacks while unarmed; it is not an activation ID.
                        await session.send('Page.getFrameTree');
                    } catch (cleanupError) {
                        fail(cleanupError);
                        error = error
                            ? new AggregateError(
                                  [error, cleanupError],
                                  'Chooser activation cleanup failed'
                              )
                            : cleanupError;
                    }
                }
                if (active === ticket) active = undefined;
            }
            if (error) throw error;
            if (failure) throw failure;
        },
    };
};

// Controlled helper ownership only; no browser or SDK behavior is simulated.
const checkFileChooserOwner = async () => {
    const deferred = () => {
        let resolve;
        const promise = new Promise((done) => {
            resolve = done;
        });
        return { promise, resolve };
    };
    const expected = {
        frameId: 'synthetic-frame',
        backendNodeId: 2,
        mode: 'selectMultiple',
    };
    const make = (onSend = () => {}) => {
        const listeners = new Set(),
            sent = [],
            completed = [];
        let detachCalls = 0;
        const session = {
            on: (event, listener) => {
                assert.equal(event, 'Page.fileChooserOpened');
                listeners.add(listener);
            },
            off: (event, listener) => {
                assert.equal(event, 'Page.fileChooserOpened');
                listeners.delete(listener);
            },
            detach: async () => {
                detachCalls++;
                await onSend('detach', {});
            },
            send: async (method, params = {}) => {
                sent.push({ method, ...params });
                await onSend(method, params);
                if (method === 'DOM.getDocument')
                    return { root: { nodeId: 1 } };
                if (method === 'DOM.querySelector') return { nodeId: 2 };
                if (method === 'DOM.describeNode')
                    return { node: { backendNodeId: 2 } };
                if (method === 'Page.getFrameTree')
                    return { frameTree: { frame: { id: expected.frameId } } };
                return {};
            },
        };
        const page = {
            listenerCount: () => 0,
            context: () => ({ newCDPSession: async () => session }),
        };
        const input = {
            evaluate: async () => ({ multiple: true, current: true }),
            setInputFiles: async (files) => completed.push(files),
        };
        const emit = (event = expected) =>
            [...listeners].forEach((listener) => listener(event));
        const cleaned = () => {
            assert.equal(listeners.size, 0);
            assert.equal(detachCalls, 1);
        };
        return { page, input, emit, listeners, sent, completed, cleaned };
    };
    const groups = [];
    {
        const enabled = deferred(),
            release = deferred();
        let enables = 0,
            activations = 0;
        const f = make(async (method, params) => {
            if (
                method === 'Page.setInterceptFileChooserDialog' &&
                params.enabled &&
                ++enables === 1
            ) {
                enabled.resolve();
                await release.promise;
            }
        });
        const owner = await createFileChooserOwner(f.page, {});
        try {
            const first = owner.choose(
                f.input,
                async () => {
                    activations++;
                    f.emit();
                },
                ['first']
            );
            await enabled.promise;
            assert.equal(activations, 0);
            release.resolve();
            await first;
            await owner.choose(
                f.input,
                async () => {
                    activations++;
                    f.emit();
                },
                []
            );
            assert.equal(activations, 2);
            assert.deepEqual(f.completed, [['first'], []]);
        } finally {
            await owner.dispose();
        }
        f.cleaned();
        groups.push('held acknowledgment and two sequential activations');
    }
    {
        const f = make(),
            owner = await createFileChooserOwner(f.page, {});
        let successor = 0;
        try {
            await assert.rejects(
                owner.choose(
                    f.input,
                    async () => {
                        f.emit();
                        f.emit();
                    },
                    []
                ),
                /Duplicate or unarmed/
            );
            await assert.rejects(
                owner.choose(
                    f.input,
                    async () => {
                        successor++;
                    },
                    []
                ),
                /Duplicate or unarmed/
            );
            assert.equal(successor, 0);
            assert.deepEqual(f.completed, []);
        } finally {
            await owner.dispose();
        }
        f.cleaned();
        groups.push('duplicate event fails closed before successor');
    }
    {
        const enabled = deferred(),
            release = deferred();
        const f = make(async (method, params) => {
            if (
                method === 'Page.setInterceptFileChooserDialog' &&
                params.enabled
            ) {
                enabled.resolve();
                await release.promise;
            }
        });
        const owner = await createFileChooserOwner(f.page, {});
        const oldCallback = [...f.listeners][0];
        let activations = 0;
        const pending = owner
            .choose(
                f.input,
                async () => {
                    activations++;
                },
                []
            )
            .catch((error) => error);
        await enabled.promise;
        await owner.dispose();
        const fresh = make(),
            successor = await createFileChooserOwner(fresh.page, {});
        try {
            release.resolve();
            assert.match((await pending).message, /Chooser owner disposed/);
            assert.equal(activations, 0);
            assert.deepEqual(f.completed, []);
            await successor.choose(
                fresh.input,
                async () => {
                    oldCallback(expected);
                    fresh.emit();
                },
                []
            );
            assert.deepEqual(fresh.completed, [[]]);
        } finally {
            await successor.dispose();
        }
        f.cleaned();
        fresh.cleaned();
        groups.push('disposed delayed callback cannot settle another owner');
    }
    for (const phase of ['disable', 'drain']) {
        let inject = false;
        let f;
        f = make(async (method, params) => {
            if (
                inject &&
                f.completed.length === 1 &&
                ((phase === 'disable' &&
                    method === 'Page.setInterceptFileChooserDialog' &&
                    !params.enabled) ||
                    (phase === 'drain' && method === 'Page.getFrameTree'))
            ) {
                inject = false;
                f.emit();
            }
        });
        const owner = await createFileChooserOwner(f.page, {});
        let successor = 0;
        try {
            await assert.rejects(
                owner.choose(
                    f.input,
                    async () => {
                        f.emit();
                        inject = true;
                    },
                    []
                ),
                /Duplicate or unarmed/
            );
            await assert.rejects(
                owner.choose(
                    f.input,
                    async () => {
                        successor++;
                    },
                    []
                ),
                /Duplicate or unarmed/
            );
            assert.equal(successor, 0);
            assert.deepEqual(f.completed, [[]]);
        } finally {
            await owner.dispose();
        }
        f.cleaned();
        groups.push(`event during ${phase} blocks successor`);
    }
    {
        const f = make(async (method) => {
            if (method === 'Page.enable')
                throw Error('controlled setup failure');
        });
        await assert.rejects(
            createFileChooserOwner(f.page, {}),
            /controlled setup failure/
        );
        f.cleaned();
        assert(
            f.sent.some(
                (call) =>
                    call.method === 'Page.setInterceptFileChooserDialog' &&
                    call.enabled === false
            )
        );
        groups.push('setup failure cleans every acquired resource');
    }
    {
        const f = make(async (method) => {
            if (method === 'DOM.describeNode')
                throw Error('controlled identity failure');
        });
        const owner = await createFileChooserOwner(f.page, {});
        let activations = 0;
        try {
            await assert.rejects(
                owner.choose(
                    f.input,
                    async () => {
                        activations++;
                    },
                    []
                ),
                /controlled identity failure/
            );
        } finally {
            await owner.dispose();
        }
        assert.equal(activations, 0);
        assert.deepEqual(f.completed, []);
        f.cleaned();
        groups.push(
            'identity query failure settles activation and cleans owner'
        );
    }
    {
        const f = make(),
            owner = await createFileChooserOwner(f.page, {});
        try {
            await assert.rejects(
                owner.choose(
                    f.input,
                    async () => {
                        f.emit({ ...expected, backendNodeId: 99 });
                    },
                    []
                )
            );
            assert.deepEqual(f.completed, []);
        } finally {
            await owner.dispose();
        }
        f.cleaned();
        groups.push('wrong chooser identity never completes input');
    }
    {
        const f = make(async (method, params) => {
            if (
                method === 'Page.setInterceptFileChooserDialog' &&
                !params.enabled
            )
                throw Error('controlled disable failure');
            if (method === 'detach') throw Error('controlled detach failure');
        });
        const evidence = {},
            owner = await createFileChooserOwner(f.page, evidence);
        await assert.rejects(owner.dispose(), (error) => {
            assert(error instanceof AggregateError);
            assert.deepEqual(
                error.errors.map((item) => item.message),
                ['controlled disable failure', 'controlled detach failure']
            );
            return true;
        });
        f.cleaned();
        assert.equal(evidence.cleanup.listener, 'completed');
        assert.equal(
            evidence.cleanup.interception.error,
            'controlled disable failure'
        );
        assert.equal(
            evidence.cleanup.session.error,
            'controlled detach failure'
        );
        groups.push(
            'disable and detach failures surface without skipping listener cleanup'
        );
    }
    for (const heldPhase of ['identity', 'acknowledgment', 'activation']) {
        const held = deferred(),
            release = deferred(),
            finished = deferred();
        const scheduled = [],
            cleared = [];
        const timers = {
            setTimeout(callback, milliseconds) {
                const timer = { callback, milliseconds };
                scheduled.push(timer);
                return timer;
            },
            clearTimeout(timer) {
                cleared.push(timer);
            },
        };
        let activations = 0;
        const f = make(async (method, params) => {
            if (
                (heldPhase === 'identity' && method === 'DOM.getDocument') ||
                (heldPhase === 'acknowledgment' &&
                    method === 'Page.setInterceptFileChooserDialog' &&
                    params.enabled)
            ) {
                held.resolve();
                await release.promise;
                finished.resolve();
            }
        });
        const evidence = {},
            owner = await createFileChooserOwner(f.page, evidence, timers);
        let pending;
        try {
            pending = owner
                .choose(
                    f.input,
                    async () => {
                        activations++;
                        if (heldPhase === 'activation') {
                            held.resolve();
                            await release.promise;
                            f.emit();
                            finished.resolve();
                        } else f.emit();
                    },
                    []
                )
                .catch((error) => error);
            await held.promise;
            assert.equal(scheduled.length, 1);
            assert.equal(scheduled[0].milliseconds, 30000);
            assert.equal(activations, heldPhase === 'activation' ? 1 : 0);
            scheduled[0].callback();
            const error = await pending;
            assert.match(error.message, /timed out after 30000ms/);
            assert.deepEqual(f.completed, []);
            assert(cleared.includes(scheduled[0]));
            let successor = 0;
            await assert.rejects(
                owner.choose(
                    f.input,
                    async () => {
                        successor++;
                    },
                    []
                ),
                /timed out after 30000ms/
            );
            assert.equal(successor, 0);
            assert.equal(scheduled.length, 1);
            await owner.dispose();
            const eventCount = evidence.events.length;
            const enables = f.sent.filter(
                (call) =>
                    call.method === 'Page.setInterceptFileChooserDialog' &&
                    call.enabled
            ).length;
            release.resolve();
            await finished.promise;
            await Promise.resolve();
            assert.deepEqual(f.completed, []);
            assert.equal(evidence.events.length, eventCount);
            assert.equal(
                f.sent.filter(
                    (call) =>
                        call.method === 'Page.setInterceptFileChooserDialog' &&
                        call.enabled
                ).length,
                enables
            );
            assert.equal(activations, heldPhase === 'activation' ? 1 : 0);
        } finally {
            release.resolve();
            await owner.dispose();
            if (pending) await pending;
        }
        f.cleaned();
        groups.push(
            `exact 30000ms deadline rejects held ${heldPhase} without late continuation`
        );
    }
    return {
        checks: groups.length,
        groups,
        limits: 'Controlled public-surface ownership checks; chooser events have no browser activation ID.',
    };
};
if (process.argv.includes('--check-file-chooser-owner')) {
    console.log(JSON.stringify(await checkFileChooserOwner(), null, 2));
    process.exit(0);
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const regular = (path) => {
    assert(lstatSync(path).isFile() && realpathSync(path) === resolve(path));
    return readFileSync(path);
};
const packageDirectory = resolve(process.env.SDK_NATIVE_PACKAGE_DIR ?? '');
const proofDirectory = resolve(process.env.SDK_NATIVE_PROOF_DIR ?? '');
const output = resolve(process.env.SDK_NATIVE_RESULT_DIR ?? '');
assert(
    process.env.SDK_NATIVE_PACKAGE_DIR &&
        process.env.SDK_NATIVE_PROOF_DIR &&
        process.env.SDK_NATIVE_RESULT_DIR,
    'Explicit artifact/result directories required'
);
assert(!existsSync(output), 'Refuse existing result directory');
mkdirSync(output, { recursive: true });
try {
    const receipt = JSON.parse(
        regular(join(packageDirectory, 'artifact-receipt.json'))
    );
    const manifestBytes = regular(join(proofDirectory, 'manifest.json'));
    const manifest = JSON.parse(manifestBytes);
    const tgzs = readdirSync(packageDirectory).filter((name) =>
        name.endsWith('.tgz')
    );
    assert.equal(tgzs.length, 1);
    const archive = join(packageDirectory, tgzs[0]);
    assert.equal(hash(regular(archive)), manifest.package.sha256);
    assert.deepEqual(receipt.source, manifest.source);
    const allowed = new Map();
    for (const entry of manifest.outputs) {
        assert(
            !entry.path.startsWith('/') && !entry.path.split('/').includes('..')
        );
        const bytes = regular(join(proofDirectory, entry.path));
        assert.equal(bytes.length, entry.bytes);
        assert.equal(hash(bytes), entry.sha256);
        allowed.set('/' + entry.path, bytes);
    }
    let temporary;
    const results = [];
    const network = [];
    let browser;
    let server;
    const report = {
        schemaVersion: 1,
        source: manifest.source,
        ci: manifest.ci,
        package: manifest.package,
        fixtureManifestSha256: hash(manifestBytes),
        harnessSha256: hash(regular('scripts/check-native-browser.mjs')),
        hostSha256: hash(regular('scripts/native-browser-fixture.mjs')),
        node: process.version,
        playwright: JSON.parse(
            regular(realpathSync('node_modules/playwright/package.json'))
        ).version,
        command: 'pnpm check:browser',
        fixtureSources: [
            'scripts/build-privacy-browser-proof.mjs',
            'scripts/attachment-review-recipe-checks.mjs',
            'scripts/portal-recipe-checks.mjs',
        ].map((path) => ({ path, sha256: hash(regular(path)) })),
        channel: 'chrome',
        chromiumSandbox: true,
        results,
        network,
        cleanup: {},
        limits: [
            'Native Chromium with synthetic local responses only; no live auth/backend/persistence.',
            'File chooser interception/empty completion and browser-supplied events are not OS picker Cancel/Escape or focus certification.',
            'Default/off and remembered session cases use only fake opaque credentials.',
            'Representative bounded scenarios; not all manual-kit routes or full parity.',
        ],
    };
    try {
        report.fileChooserOwnerRegressions = await checkFileChooserOwner();
        temporary = mkdtempSync(join(tmpdir(), 'sdk-native-consumer-'));
        writeFileSync(
            join(temporary, 'package.json'),
            JSON.stringify({
                private: true,
                type: 'module',
                dependencies: {
                    '@miniextensions/sdk': `file:${archive}`,
                    react: '19.2.0',
                    'react-dom': '19.2.0',
                    '@types/react': '18.3.12',
                    '@types/react-dom': '18.3.1',
                },
            })
        );
        execFileSync(
            'npm',
            [
                'install',
                '--ignore-scripts',
                '--no-audit',
                '--no-fund',
                '--cache',
                join(temporary, 'npm-cache'),
            ],
            { cwd: temporary, stdio: 'pipe' }
        );
        const form = createReviewFixture('review-answers').page();
        addAttachmentReviewAnswers(form);
        // Reuse complete public verification envelopes; no new schema/operator authority.
        const authFixture = await import(
            'file://' + join(proofDirectory, 'fixture.js')
        );
        const auth = authFixture.createPrivacyFixture('password').loginPage();
        const portal = fixtures.makePortal();
        const data = {
            form,
            auth,
            portal,
            oldPage: fixtures.page(
                [fixtures.record('rec_old', 'Old result', 1)],
                'old_offset'
            ),
            newPage: fixtures.page([
                fixtures.record('rec_new', 'New result', 2),
            ]),
            criteria: {
                selectedCustomViewId: 'view_example',
                sortFieldsByEndUser: null,
                supportsEndUserSortCleanup: true,
                filtersByEndUser: null,
                supportsEndUserFilterCleanup: true,
                searchParamsMap: {},
                searchTerm: null,
            },
        };
        const entry = join(temporary, 'native-browser-fixture.mjs');
        writeFileSync(entry, regular('scripts/native-browser-fixture.mjs'));
        const globals = join(temporary, 'native-fixture-globals.d.ts');
        writeFileSync(
            globals,
            `declare const __FIXTURES__: {
            form: import('@miniextensions/sdk').FormLoadedResult;
            auth: import('@miniextensions/sdk').LoginPageResult;
            portal: import('@miniextensions/sdk').PortalLoadedResult;
            oldPage: import('@miniextensions/sdk').ListPortalLinkedRecordsResult;
            newPage: import('@miniextensions/sdk').ListPortalLinkedRecordsResult;
            criteria: import('@miniextensions/sdk/portals').PortalCollectionCriteria;
        };
        interface Window { __nativeProbe: { snapshot(): any }; }
`
        );
        const compiler = realpathSync('node_modules/typescript/bin/tsc');
        const checkFixture = (path) =>
            execFileSync(
                process.execPath,
                [
                    compiler,
                    '--allowJs',
                    '--checkJs',
                    '--noEmit',
                    '--skipLibCheck',
                    '--module',
                    'NodeNext',
                    '--moduleResolution',
                    'NodeNext',
                    '--target',
                    'ES2022',
                    path,
                    globals,
                ],
                { cwd: temporary, stdio: 'pipe' }
            );
        checkFixture(entry);
        const malformedEntry = join(
            temporary,
            'native-browser-fixture-missing-scope.mjs'
        );
        const source = regular(entry).toString();
        const scopeLine = '        getScope: () => ({ ...scope }),\n';
        assert.equal(
            source.split(scopeLine).length,
            2,
            'Exactly one Portal scope insertion expected'
        );
        writeFileSync(malformedEntry, source.replace(scopeLine, ''));
        let rejectedScope = false;
        try {
            checkFixture(malformedEntry);
        } catch (error) {
            rejectedScope = String(error.stdout).includes(
                "Property 'getScope' is missing"
            );
        }
        assert(
            rejectedScope,
            'Installed declaration check must reject missing Portal getScope'
        );
        report.fixtureDeclarationCheck = {
            status: 'passed',
            compilerVersion: JSON.parse(
                regular(realpathSync('node_modules/typescript/package.json'))
            ).version,
            compilerEntrySha256: hash(regular(compiler)),
            missingScopeRegression: 'rejected',
            globalsSha256: hash(regular(globals)),
        };
        console.log('Installed native fixture declaration check: passed');
        const bundled = await build({
            absWorkingDir: temporary,
            entryPoints: [entry],
            bundle: true,
            platform: 'browser',
            format: 'esm',
            target: 'es2022',
            outfile: join(temporary, 'native.js'),
            write: false,
            metafile: true,
            legalComments: 'none',
            define: {
                __FIXTURES__: JSON.stringify(data),
                'process.env.NODE_ENV': '"production"',
            },
        });
        const installed = realpathSync(
            join(temporary, 'node_modules/@miniextensions/sdk')
        );
        report.fixtureDataSha256 = hash(JSON.stringify(data));
        report.bundleInputs = [];
        for (const name of Object.keys(bundled.metafile.inputs)) {
            if (name === '<define:__FIXTURES__>') {
                report.bundleInputs.push({
                    path: name,
                    virtual: true,
                    sha256: report.fixtureDataSha256,
                });
                continue;
            }
            const path = realpathSync(resolve(temporary, name));
            assert(
                path.startsWith(temporary + '/'),
                'No source aliases or workspace dependency allowed'
            );
            const bytes = regular(path);
            const item = {
                path: relative(temporary, path),
                sha256: hash(bytes),
                bytes: bytes.length,
            };
            if (path.startsWith(installed + '/')) {
                const member =
                    'package/' +
                    relative(installed, path).replaceAll('\\', '/');
                const original = execFileSync('tar', ['-xOf', archive, member]);
                assert.deepEqual(
                    bytes,
                    original,
                    'Installed SDK input differs from original TGZ'
                );
                item.archiveMember = member;
            }
            report.bundleInputs.push(item);
        }
        const code = bundled.outputFiles[0].contents;
        report.bundleSha256 = hash(code);
        allowed.set('/native.js', code);
        const html = Buffer.from(
            `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Native synthetic SDK consumer</title></head><body><main></main><script type="module" src="/native.js"></script></body></html>`
        );
        allowed.set('/native.html', html);
        server = createServer((request, response) => {
            const url = new URL(request.url, 'http://127.0.0.1');
            const bytes = allowed.get(url.pathname);
            if (!bytes || request.method !== 'GET') {
                response.writeHead(404);
                response.end();
                return;
            }
            response.setHeader(
                'Content-Type',
                url.pathname.endsWith('.js')
                    ? 'text/javascript'
                    : url.pathname.endsWith('.css')
                      ? 'text/css'
                      : 'text/html'
            );
            response.end(bytes);
        });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const origin = `http://127.0.0.1:${server.address().port}`;
        const executablePath = realpathSync('/opt/google/chrome/chrome');
        report.browserExecutable = {
            path: executablePath,
            version: execFileSync(executablePath, ['--version'], {
                encoding: 'utf8',
            }).trim(),
        };
        browser = await chromium.launch({
            channel: 'chrome',
            headless: true,
            chromiumSandbox: true,
        });
        report.chromium = browser.version();
        const run = async (name, exercise) => {
            const context = await browser.newContext({
                serviceWorkers: 'block',
            });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await context.route('**/*', async (route) => {
                if (new URL(route.request().url()).origin === origin)
                    await route.continue();
                else {
                    network.push({
                        case: name,
                        url: new URL(route.request().url()).origin,
                    });
                    await route.abort();
                }
            });
            const item = { name, status: 'running' };
            results.push(item);
            try {
                await exercise(page, origin);
                assert.deepEqual(errors, []);
                const state = await page.evaluate(
                    () =>
                        window.__nativeProbe?.snapshot() ??
                        window.__privacyBrowserProof?.snapshot()
                );
                assert.deepEqual(state.errors ?? state.unexpected, []);
                item.state = state;
                item.ax = await page.locator('body').ariaSnapshot();
                await page.screenshot({
                    path: join(output, name + '.png'),
                    fullPage: true,
                });
                item.status = 'passed';
                console.log(`Native Chromium ${name}: passed`);
            } catch (error) {
                item.status = 'failed';
                item.error = error.message;
                item.pageErrors = errors;
                try {
                    item.state = await page.evaluate(
                        () =>
                            window.__nativeProbe?.snapshot() ??
                            window.__privacyBrowserProof?.snapshot()
                    );
                } catch (captureError) {
                    item.stateCaptureError = captureError.message;
                }
                try {
                    item.ax = await page.locator('body').ariaSnapshot();
                } catch (captureError) {
                    item.axCaptureError = captureError.message;
                }
                await page
                    .screenshot({
                        path: join(output, name + '-failed.png'),
                        fullPage: true,
                    })
                    .catch(() => {});
                throw error;
            } finally {
                await context.close();
            }
        };
        const idle = (page) =>
            page.waitForFunction(
                () =>
                    document
                        .querySelector('#screen')
                        ?.getAttribute('aria-busy') === 'false'
            );
        const connect = async (page, origin, scenario) => {
            await page.goto(
                `${origin}/starter/index.html?scenario=${scenario}`
            );
            // Dynamic main-module evaluation installs the submit handler before
            // setting idle. An enabled form alone is not application readiness.
            await idle(page);
            await page
                .getByRole('button', { name: 'Connect and load', exact: true })
                .click();
            await idle(page);
        };
        for (const scenario of ['teardown-logout', 'teardown-disconnect'])
            await run(scenario, async (page, origin) => {
                await connect(page, origin, scenario);
                await page
                    .locator('[data-field-id="fld_title"]')
                    .fill('Previous visitor private narrative');
                await page
                    .getByRole('button', { name: 'Save', exact: true })
                    .click();
                await idle(page);
                await page
                    .getByRole('button', { name: 'Reload', exact: true })
                    .click();
                await idle(page);
                if (scenario.endsWith('logout')) {
                    await page
                        .getByRole('button', {
                            name: "Clear this visitor's session",
                            exact: true,
                        })
                        .click();
                    await page
                        .getByRole('button', { name: 'Reload', exact: true })
                        .click();
                } else {
                    await page
                        .getByRole('button', {
                            name: 'Disconnect',
                            exact: true,
                        })
                        .click();
                    await page
                        .getByRole('button', {
                            name: 'Connect and load',
                            exact: true,
                        })
                        .click();
                }
                await idle(page);
                assert.equal(
                    await page
                        .locator('[data-field-id="fld_title"]')
                        .inputValue(),
                    'Fresh public baseline'
                );
                const html = await page
                    .locator('#screen')
                    .evaluate((node) => node.outerHTML);
                for (const secret of [
                    'Previous visitor private narrative',
                    'Previous visitor private field label',
                    'previous-visitor-private-attachment.pdf',
                ])
                    assert(!html.includes(secret));
                const state = await page.evaluate(() =>
                    window.__privacyBrowserProof.snapshot()
                );
                assert.equal(
                    state.calls.filter((c) => c.route === 'saveForm').length,
                    1
                );
                assert.equal(
                    await page
                        .getByRole('button', { name: 'Save', exact: true })
                        .isDisabled(),
                    true
                );
            });
        await run('invalid-number', async (page, origin) => {
            await connect(page, origin, 'review-answers');
            const input = page.locator('[data-field-id="fld_review_number"]');
            await input.fill('7');
            await input.press('ControlOrMeta+A');
            await input.press('-');
            assert.equal(await input.getAttribute('type'), 'text');
            assert.equal(await input.inputValue(), '-');
            assert.equal(await input.getAttribute('aria-invalid'), 'true');
            await page
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await idle(page);
            assert.equal(await page.locator('dialog[open]').count(), 0);
            assert.equal(await input.inputValue(), '-');
            assert.equal(await input.getAttribute('aria-invalid'), 'true');
            let state = await page.evaluate(() =>
                window.__privacyBrowserProof.snapshot()
            );
            assert.equal(
                state.calls.filter((c) => c.route === 'saveForm').length,
                0
            );
            await page.locator('#visitor').selectOption('B');
            await page.locator('#visitor').selectOption('A');
            await input.waitFor();
            assert.equal(
                await input.inputValue(),
                '7',
                'Invalid native buffer must not replace the retained draft across a visitor remount'
            );
            await input.fill('9');
            await page
                .getByRole('button', { name: 'Save', exact: true })
                .click();
            await page
                .getByRole('button', { name: 'Confirm', exact: true })
                .click();
            await idle(page);
            state = await page.evaluate(() =>
                window.__privacyBrowserProof.snapshot()
            );
            const calls = state.calls.filter((c) => c.route === 'saveForm');
            assert.equal(calls.length, 1);
            assert.equal(calls[0].input.formRecord.data.fld_review_number, 9);
            assert(
                calls[0].input.formFieldIdsWithUnsavedChanges.includes(
                    'fld_review_number'
                )
            );
        });
        const nativeSetup = async (page, origin, mode) => {
            await page.goto(`${origin}/native.html?mode=${mode}`);
            await page.waitForFunction(
                () => window.__nativeProbe !== undefined
            );
            assert.deepEqual(
                (await page.evaluate(() => window.__nativeProbe.snapshot()))
                    .errors,
                []
            );
        };
        await run('attachment-picker', async (page, origin) => {
            const chooserEvidence = {};
            report.fileChooser = chooserEvidence;
            const chooserOwner = await createFileChooserOwner(
                page,
                chooserEvidence
            );
            let exerciseError;
            try {
                await nativeSetup(page, origin, 'attachment');
                await page.locator('dialog[open]').waitFor();
                const text = page.locator('dialog input[type=password]');
                await text.fill('Retained dirty text');
                const choose = page.getByRole('button', {
                    name: 'Choose files',
                    exact: true,
                });
                await choose.focus();
                const fileInput = page.locator('dialog input[type=file]');
                await chooserOwner.choose(
                    fileInput,
                    () => page.keyboard.press('Enter'),
                    {
                        name: 'FAKE_QUEUED.txt',
                        mimeType: 'text/plain',
                        buffer: Buffer.from('fake'),
                    }
                );
                const before = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                await chooserOwner.choose(
                    fileInput,
                    () => choose.press('Enter'),
                    []
                );
                assert.equal(await page.locator('dialog[open]').count(), 1);
                let state = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                assert.deepEqual(state.draft, before.draft);
                assert.deepEqual(state.pending, ['FAKE_QUEUED.txt']);
                assert.equal(state.calls.length, 0);
                // Explicitly supplied cancel event tests bubbling target guard only.
                await page
                    .locator('dialog input[type=file]')
                    .dispatchEvent('cancel', {
                        bubbles: true,
                        cancelable: true,
                    });
                state = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                assert.deepEqual(state.draft, before.draft);
                assert.deepEqual(state.pending, before.pending);
                assert.equal(await page.locator('dialog[open]').count(), 1);
                await page.keyboard.press('Escape');
                await page.locator('dialog').waitFor({ state: 'detached' });
                await page
                    .getByRole('button', { name: 'Open attachment editor' })
                    .click();
                await page.locator('dialog[open]').waitFor();
                assert.deepEqual(
                    (await page.evaluate(() => window.__nativeProbe.snapshot()))
                        .pending,
                    before.pending
                );
                await page
                    .getByRole('button', { name: 'Clear pending files' })
                    .click();
                await page
                    .getByRole('button', { name: 'Save synthetic Form' })
                    .click();
                await page.waitForFunction(
                    () => window.__nativeProbe.snapshot().calls.length === 1
                );
                state = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                assert.deepEqual(
                    state.calls[0].input.formRecord.data,
                    before.draft.data
                );
                assert.equal(chooserEvidence.events.length, 2);
            } catch (error) {
                exerciseError = error;
                throw error;
            } finally {
                try {
                    await chooserOwner.dispose();
                } catch (cleanupError) {
                    throw exerciseError
                        ? new AggregateError(
                              [exerciseError, cleanupError],
                              'Attachment proof and chooser cleanup failed'
                          )
                        : cleanupError;
                }
            }
        });
        await run('portal-late-criteria', async (page, origin) => {
            await nativeSetup(page, origin, 'portal');
            await page.getByRole('button', { name: 'Load records' }).click();
            await page.waitForFunction(
                () => window.__nativeProbe.snapshot().calls.length === 1
            );
            await page
                .getByRole('button', { name: 'Apply new search' })
                .click();
            assert.equal(
                (await page.evaluate(() => window.__nativeProbe.snapshot()))
                    .calls.length,
                1
            );
            await page
                .getByRole('button', { name: 'Release old response' })
                .click();
            await page.waitForFunction(() =>
                window.__nativeProbe
                    .snapshot()
                    .events.some((event) => event.type === 'read-settled')
            );
            assert.equal(
                (
                    await page.evaluate(() => window.__nativeProbe.snapshot())
                ).events.find((event) => event.type === 'read-settled')
                    .accepted,
                false
            );
            assert.equal(await page.locator('li').count(), 0);
            await page.getByRole('button', { name: 'Load records' }).click();
            await page.getByText('rec_new', { exact: true }).waitFor();
            let state = await page.evaluate(() =>
                window.__nativeProbe.snapshot()
            );
            assert.equal(state.calls.length, 2);
            assert.equal(state.calls[1].input.searchTerm, 'new query');
            assert.equal(state.calls[1].input.airtableOffset, null);
            for (const key of Object.keys(data.criteria).filter(
                (key) => key !== 'searchTerm'
            ))
                assert.deepEqual(state.calls[1].input[key], data.criteria[key]);
            assert.deepEqual(state.state.page.recordIds, ['rec_new']);
            await page.getByRole('button', { name: 'Replace visitor' }).click();
            await page.getByRole('button', { name: 'Load records' }).click();
            state = await page.evaluate(() => window.__nativeProbe.snapshot());
            assert.equal(state.calls.length, 2);
            assert.equal(state.state.phase, 'retired');
        });
        for (const mode of ['session-off', 'session-on'])
            await run(mode, async (page, origin) => {
                await nativeSetup(page, origin, mode);
                await page
                    .getByRole('button', { name: 'Login fake visitor' })
                    .click();
                await page
                    .getByRole('status')
                    .getByText('Fake session applied', { exact: true })
                    .waitFor();
                let state = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                assert.equal(state.sessionEntries, 1);
                assert.equal(state.calls.length, 0);
                assert.equal(
                    state.storageEntries,
                    mode === 'session-on' ? 1 : 0
                );
                assert(
                    !(
                        await page.evaluate(() => JSON.stringify(localStorage))
                    ).includes('FAKE_RAW_NOT_PERSISTED')
                );
                await page.reload();
                await page
                    .getByRole('button', { name: 'Restore fake visitor' })
                    .waitFor();
                state = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                assert.equal(state.sessionEntries, 0);
                assert.equal(state.calls.length, 0);
                await page
                    .getByRole('button', { name: 'Restore fake visitor' })
                    .click();
                await page
                    .getByRole('status')
                    .getByText(
                        mode === 'session-on'
                            ? 'Fresh fake load accepted'
                            : 'No remembered session',
                        { exact: true }
                    )
                    .waitFor();
                state = await page.evaluate(() =>
                    window.__nativeProbe.snapshot()
                );
                assert.equal(state.calls.length, mode === 'session-on' ? 1 : 0);
                if (mode === 'session-on') {
                    assert.equal(state.calls[0].credentialMatched, true);
                    assert.equal(state.sessionEntries, 1);
                }
                await page
                    .getByRole('button', { name: 'Logout fake visitor' })
                    .click();
                await page
                    .getByRole('status')
                    .getByText('Logged out', { exact: true })
                    .waitFor();
                assert.equal(
                    (await page.evaluate(() => window.__nativeProbe.snapshot()))
                        .storageEntries,
                    0
                );
                await page.reload();
                await page
                    .getByRole('button', { name: 'Restore fake visitor' })
                    .click();
                await page
                    .getByRole('status')
                    .getByText('No remembered session', { exact: true })
                    .waitFor();
                assert.equal(
                    (await page.evaluate(() => window.__nativeProbe.snapshot()))
                        .calls.length,
                    0
                );
            });
        assert.equal(results.length, 7);
        assert.deepEqual(network, []);
        report.status = 'passed';
    } catch (error) {
        report.status = 'failed';
        report.error = error.message;
        if (error.stdout) report.validationOutput = String(error.stdout);
        process.exitCode = 1;
        console.error(error);
    } finally {
        for (const [name, cleanup] of [
            [
                'browser',
                async () => {
                    if (browser) await browser.close();
                },
            ],
            [
                'server',
                async () => {
                    if (server) {
                        server.closeAllConnections();
                        await new Promise((resolve, reject) =>
                            server.close((error) =>
                                error ? reject(error) : resolve()
                            )
                        );
                    }
                },
            ],
            [
                'consumer',
                async () => {
                    if (temporary) {
                        rmSync(temporary, { recursive: true, force: true });
                        assert(!existsSync(temporary));
                    }
                },
            ],
        ]) {
            try {
                await cleanup();
                report.cleanup[name] =
                    (name === 'browser' && !browser) ||
                    (name === 'server' && !server) ||
                    (name === 'consumer' && !temporary)
                        ? 'not-started'
                        : 'completed';
            } catch (error) {
                report.cleanup[name] = { error: error.message };
                report.status = 'failed';
                process.exitCode = 1;
            }
        }
        writeFileSync(
            join(output, 'native-receipt.json'),
            JSON.stringify(report, null, 2) + '\n'
        );
        const members = readdirSync(output).sort();
        writeFileSync(
            join(output, 'SHA256SUMS'),
            members
                .map((name) => `${hash(regular(join(output, name)))}  ${name}`)
                .join('\n') + '\n'
        );
    }
} catch (error) {
    // Artifact validation failures have no consumer/browser/server to clean up.
    const failure = {
        schemaVersion: 1,
        status: 'failed',
        stage: 'artifact-preflight',
        node: process.version,
        error: error.message,
        cleanup: {
            consumer: 'not-started',
            browser: 'not-started',
            server: 'not-started',
        },
    };
    writeFileSync(
        join(output, 'native-receipt.json'),
        JSON.stringify(failure, null, 2) + '\n'
    );
    writeFileSync(
        join(output, 'SHA256SUMS'),
        `${hash(regular(join(output, 'native-receipt.json')))}  native-receipt.json\n`
    );
    console.error(error);
    process.exitCode = 1;
}
