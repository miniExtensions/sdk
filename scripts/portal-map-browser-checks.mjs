/** Packed SDK Map proof, run by the maintained browser harness. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import {
    lstatSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import {
    portalMapBrowserFixture,
    portalMapSyntheticKey,
    portalMapPrivateMarker,
} from './portal-map-browser-fixture.mjs';
import { portalMapGoogleBrowserBoundary } from './portal-map-google-browser-boundary.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function regular(path) {
    const info = lstatSync(path);
    assert(
        info.isFile() && !info.isSymbolicLink(),
        'Proof input must be a regular file'
    );
    return readFileSync(path);
}
function deferred() {
    let resolve;
    const promise = new Promise((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
}
async function bounded(label, operation) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(Error(label + ' did not settle')),
                    10000
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
const fitTotal = (boundary) =>
    boundary.maps.reduce((sum, map) => sum + map.fits.length, 0);
const loadedMaps = (boundary) =>
    boundary.maps.filter((map) => map.fits.length > 0);
function assertCleanBoundary(boundary) {
    if (!boundary) return;
    assert.equal(boundary.activeOverlayCount, 0);
    assert.equal(boundary.pendingOverlayCount, 0);
    assert.equal(boundary.connectedOverlayDivCount, 0);
    assert.equal(boundary.connectedMapCount, 0);
    assert.equal(boundary.activeListenerCount, 0);
    assert.equal(boundary.pendingQueues.attachments, 0);
    assert.equal(boundary.pendingQueues.lateDraws, 0);
}

/** Actual packed SDK + actual selected vendor components + actual default Loader.
 * Only Google's JavaScript response/API is synthetic, fulfilled inside routing.
 * It does not prove real Google service, projection, gestures, billing or host use.
 */
export async function checkPortalMapBrowser({
    browser,
    consumer,
    evidence,
    output,
}) {
    let directory, server, current, failure;
    let contextEverAcquired = false,
        contextCleanupFailed = false;
    const contextCleanupFailures = [];
    // Assigned before any context can be created; remains callable from finally.
    let closeCurrent = async () => {};
    Object.assign(evidence, {
        status: 'running',
        profiles: [],
        pageErrorCount: 0,
        unexpectedRequests: [],
        cleanup: {},
        externalProviderEgress: 0,
    });
    try {
        const root = realpathSync(consumer);
        const require = createRequire(join(root, 'package.json'));
        const sdk = join(root, 'node_modules/@miniextensions/sdk');
        const react = JSON.parse(
            regular(require.resolve('react/package.json'))
        ).version;
        assert(
            ['18.3.1', '19.2.0'].includes(react),
            'Use the registered React18/19 matrix'
        );
        const upstreamPerFormat = [];
        for (const format of ['esm', 'cjs']) {
            const parent = join(sdk, 'dist', format, 'react/map');
            const receipt = JSON.parse(
                regular(join(parent, 'portal-map-vendor.json'))
            );
            const upstreamBytes = regular(
                join(parent, 'portal-map-upstream.json')
            );
            const upstream = JSON.parse(upstreamBytes);
            const runtime = regular(join(parent, 'GoogleMapsRuntime.js'));
            assert.equal(receipt.format, format);
            assert.equal(receipt.sha256, hash(runtime));
            assert.equal(receipt.upstreamSha256, hash(upstreamBytes));
            assert.equal(
                upstream.selectedApiReleaseCommit,
                '093860a4b25c4ed5a9d94316a2587f2c375eced3'
            );
            assert.deepEqual(
                upstream.physicalPackages.map((item) => [
                    item.name,
                    item.version,
                ]),
                [
                    ['@react-google-maps/api', '2.20.7'],
                    ['@googlemaps/js-api-loader', '1.16.8'],
                ]
            );
            assert.equal(
                receipt.licensesSha256,
                hash(regular(join(parent, 'portal-map.LICENSES.txt')))
            );
            assert(
                receipt.physicalInputs.some(
                    (item) => item.package === '@react-google-maps/api'
                )
            );
            assert(
                receipt.physicalInputs.some(
                    (item) => item.package === '@googlemaps/js-api-loader'
                )
            );
            upstreamPerFormat.push({
                format,
                runtimeSHA256: hash(runtime),
                upstreamSHA256: hash(upstreamBytes),
                licensesSHA256: receipt.licensesSha256,
            });
        }
        evidence.provenance = {
            react,
            upstreamPerFormat,
            checkerSHA256: hash(regular(new URL(import.meta.url))),
            fixtureSHA256: hash(portalMapBrowserFixture),
            syntheticGoogleResponseSHA256: hash(portalMapGoogleBrowserBoundary),
        };
        directory = mkdtempSync(join(root, '.portal-map-proof-'));
        const responses = new Map();
        for (const format of ['esm', 'cjs']) {
            const api =
                format === 'esm'
                    ? "import { PortalMap, createGoogleMapsPortalMapDriver } from '@miniextensions/sdk/react';\nimport { bindPortalMapProvider, createPortalMapProviderCoordinator, createPortalMapProviderOwnerScope } from '@miniextensions/sdk/portals';"
                    : "const { PortalMap, createGoogleMapsPortalMapDriver } = require('@miniextensions/sdk/react');\nconst { bindPortalMapProvider, createPortalMapProviderCoordinator, createPortalMapProviderOwnerScope } = require('@miniextensions/sdk/portals');";
            const entry = join(directory, format + '.mjs');
            writeFileSync(
                entry,
                portalMapBrowserFixture.replace('__PORTAL_MAP_API__', api)
            );
            const bundle = await build({
                absWorkingDir: root,
                entryPoints: [entry],
                bundle: true,
                platform: 'browser',
                format: 'esm',
                write: false,
                metafile: true,
            });
            await assertBrowserInputs(bundle.metafile, root);
            const inputs = Object.keys(bundle.metafile.inputs);
            for (const name of [
                'PortalMap.js',
                'PortalMapCard.js',
                'GoogleMapsRuntime.js',
            ])
                assert(
                    inputs.some(
                        (path) =>
                            path.includes('/sdk/dist/' + format + '/react/') &&
                            path.endsWith('/' + name)
                    ),
                    'Actual packed Map implementation must be in the bundle'
                );
            responses.set('/' + format + '.bundle.js', {
                type: 'text/javascript',
                bytes: bundle.outputFiles[0].contents,
            });
        }
        const css = await build({
            absWorkingDir: root,
            entryPoints: [
                require.resolve('@miniextensions/sdk/react/portal-map.css'),
            ],
            bundle: true,
            write: false,
            metafile: true,
        });
        await assertBrowserInputs(css.metafile, root);
        responses.set('/portal-map.css', {
            type: 'text/css',
            bytes: css.outputFiles[0].contents,
        });
        server = createServer((request, response) => {
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self' https://maps.googleapis.com; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
            );
            if (request.method !== 'GET') return response.writeHead(405).end();
            const url = new URL(request.url, 'http://localhost');
            if (url.pathname === '/') {
                const format =
                    url.searchParams.get('format') === 'cjs' ? 'cjs' : 'esm';
                response.setHeader('Content-Type', 'text/html');
                return response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Portal Map proof</title><link rel="stylesheet" href="/portal-map.css"><style>body{margin:0;padding:16px;background:#f8fafc}main{display:flex;gap:24px;flex-wrap:wrap}.portal-map-proof-root{width:640px;height:480px;border:1px solid #94a3b8}.mx-sdk-portal-map{height:100%}</style><main></main><script type="module" src="/' +
                        format +
                        '.bundle.js"></script>'
                );
            }
            if (url.pathname === '/favicon.ico')
                return response.writeHead(204).end();
            const asset = responses.get(url.pathname);
            if (!asset) return response.writeHead(404).end();
            response.setHeader('Content-Type', asset.type);
            response.end(asset.bytes);
        });
        await bounded(
            'Map server start',
            () =>
                new Promise((resolve, reject) => {
                    server.once('error', reject);
                    server.listen(0, '127.0.0.1', resolve);
                })
        );
        const origin = 'http://127.0.0.1:' + server.address().port;

        closeCurrent = async function closeCurrentContext() {
            if (!current) return;
            const item = current;
            const errors = [];
            if (!item.hostTeardownAttempted && !item.closed) {
                item.hostTeardownAttempted = true;
                try {
                    if (
                        item.page &&
                        (await item.page.evaluate(() =>
                            Boolean(window.portalMapProof)
                        ))
                    ) {
                        await bounded('Map host teardown', () =>
                            item.page.evaluate(() =>
                                window.portalMapProof.dispose()
                            )
                        );
                        const host = await item.page.evaluate(() =>
                            window.portalMapProof.snapshot()
                        );
                        assert.deepEqual(host.mounted, []);
                        assert(
                            host.leaseStatuses.every(
                                (status) => status === 'released'
                            )
                        );
                        assert.equal(
                            host.triggerRegistrations,
                            host.triggerReleases
                        );
                        assertCleanBoundary(
                            await item.page.evaluate(
                                () =>
                                    window.portalMapGoogleBoundary?.snapshot() ??
                                    null
                            )
                        );
                    }
                } catch (error) {
                    errors.push(error);
                    contextCleanupFailures.push('host-teardown');
                }
            }
            // Release only this context's intercepted route, never a real Google request.
            item.responseGate.resolve('abort');
            // Dispatch close once. A timeout does not cancel it, so the outer
            // finally may observe this same promise without issuing a second
            // uncertain operation or losing the exact owned context handle.
            if (!item.closePromise)
                item.closePromise = Promise.resolve()
                    .then(() => item.context.close())
                    .then(() => {
                        item.closed = true;
                    });
            try {
                await bounded('Map context close', () => item.closePromise);
            } catch (error) {
                errors.push(error);
                contextCleanupFailures.push('context-close');
            }
            // A fulfilled close or the exact context's close event verifies
            // closure. Rejection/timeout alone must never clear this handle.
            if (item.closed) current = null;
            if (errors.length) {
                contextCleanupFailed = true;
                throw new AggregateError(
                    errors,
                    'Map context teardown incomplete'
                );
            }
        };
        async function visit(format, mode) {
            await closeCurrent();
            const context = await browser.newContext({
                viewport: { width: 1440, height: 1100 },
                serviceWorkers: 'block',
            });
            const responseGate = deferred(),
                providerSeen = deferred();
            const item = {
                context,
                page: null,
                responseGate,
                providerSeen,
                hostTeardownAttempted: false,
                closePromise: null,
                closed: false,
                providerRequests: 0,
                routeFulfilled: 0,
                routeAborted: 0,
                pageErrors: 0,
                consoleErrors: 0,
                expectedAbortConsoleErrors: 0,
                unexpectedConsoleErrors: 0,
                privateInConsole: false,
                privateInErrors: false,
                unexpected: [],
                callbackValidated: false,
            };
            current = item;
            contextEverAcquired = true;
            context.on('close', () => {
                item.closed = true;
            });
            // Retain the context before page acquisition, so newPage failure
            // still reaches this exact context's ordinary finally cleanup.
            const page = await context.newPage();
            item.page = page;
            page.setDefaultTimeout(10000);
            page.on('pageerror', (error) => {
                item.pageErrors++;
                evidence.pageErrorCount++;
                const text = String(error.message);
                item.privateInErrors ||=
                    text.includes(portalMapSyntheticKey) ||
                    text.includes(portalMapPrivateMarker);
            });
            page.on('console', (message) => {
                const text = message.text();
                item.privateInConsole ||=
                    text.includes(portalMapSyntheticKey) ||
                    text.includes(portalMapPrivateMarker);
                if (message.type() === 'error') {
                    item.consoleErrors++;
                    if (
                        item.mode === 'failure' &&
                        item.routeAborted === 1 &&
                        item.expectedAbortConsoleErrors === 0 &&
                        /^Failed to load resource: net::ERR_FAILED$/.test(text)
                    )
                        item.expectedAbortConsoleErrors++;
                    else item.unexpectedConsoleErrors++;
                }
            });
            if (mode === 'unmanaged')
                await context.addInitScript(() => {
                    window.google = {
                        maps: { version: 'synthetic-unmanaged' },
                    };
                });
            await context.route('**/*', async (route) => {
                const request = route.request(),
                    url = new URL(request.url());
                if (
                    url.origin === origin &&
                    request.method() === 'GET' &&
                    (url.pathname === '/' ||
                        url.pathname === '/favicon.ico' ||
                        responses.has(url.pathname))
                )
                    return route.continue();
                if (
                    url.origin === 'https://maps.googleapis.com' &&
                    url.pathname === '/maps/api/js' &&
                    request.method() === 'GET' &&
                    request.resourceType() === 'script'
                ) {
                    item.providerRequests++;
                    const valid =
                        url.searchParams.get('key') === portalMapSyntheticKey &&
                        url.searchParams.get('callback') ===
                            'google.maps.__ib__' &&
                        url.searchParams.get('language') === 'en' &&
                        url.searchParams.get('region') === 'US';
                    item.callbackValidated ||= valid;
                    providerSeen.resolve();
                    if (!valid || item.providerRequests !== 1) {
                        item.unexpected.push(
                            'invalid-or-duplicate-synthetic-bootstrap'
                        );
                        item.routeAborted++;
                        return route.abort();
                    }
                    const action = await responseGate.promise;
                    if (action === 'fulfill') {
                        item.routeFulfilled++;
                        return route.fulfill({
                            status: 200,
                            contentType: 'text/javascript',
                            body: portalMapGoogleBrowserBoundary,
                        });
                    }
                    item.routeAborted++;
                    return route.abort();
                }
                // Origin/path only. Never persist query parameters containing provider keys.
                item.unexpected.push(url.origin + url.pathname);
                evidence.unexpectedRequests.push(url.origin + url.pathname);
                return route.abort();
            });
            // The deliberately held async Google script can delay window.load.
            // Do not wait for that event before returning the control that releases it.
            await page.goto(origin + '/?format=' + format + '&mode=' + mode, {
                waitUntil: 'domcontentloaded',
            });
            await page.waitForFunction(() => Boolean(window.portalMapProof));
            assert.equal(
                (await page.evaluate(() => window.portalMapProof.snapshot()))
                    .react,
                react
            );
            return item;
        }
        const snapshot = () =>
            current.page.evaluate(() => ({
                host: window.portalMapProof.snapshot(),
                boundary: window.portalMapGoogleBoundary?.snapshot() ?? null,
                privacy: window.portalMapProof.privacy(),
            }));
        const waitCards = async (name, count) =>
            current.page.waitForFunction(
                ({ name, count }) => {
                    const root = [...document.querySelectorAll('section')].find(
                        (node) =>
                            node.getAttribute('aria-label') ===
                            'Portal Map ' + name
                    );
                    return (
                        root?.querySelectorAll('.mx-sdk-portal-map-card')
                            .length === count
                    );
                },
                { name, count }
            );
        const waitFailure = async (name, code) =>
            current.page
                .getByRole('region', {
                    name: 'Portal Map ' + name,
                    exact: true,
                })
                .locator('[role="alert"][data-map-status="' + code + '"]')
                .waitFor();
        async function assertPrivateSafe(item = current) {
            const state = await snapshot();
            assert.deepEqual(state.privacy, {
                privateInVisibleText: false,
                privateInSections: false,
                keyInVisibleText: false,
                keyInSections: false,
                keyInSnapshot: false,
            });
            assert.equal(
                item.privateInConsole,
                false,
                'No key/private data in console text'
            );
            assert.equal(
                item.privateInErrors,
                false,
                'No key/private data in page errors'
            );
            assert.equal(item.pageErrors, 0);
            assert.deepEqual(item.unexpected, []);
            assert.equal(
                item.unexpectedConsoleErrors,
                0,
                'Unexpected console error; raw text retained only in memory'
            );
            assert(item.expectedAbortConsoleErrors <= 1);
            return state;
        }
        async function record(cases, format, name) {
            const state = await assertPrivateSafe();
            cases.push({
                name,
                state,
                providerRequests: current.providerRequests,
                locallyFulfilled: current.routeFulfilled,
                locallyAborted: current.routeAborted,
                bootstrapValidated: current.callbackValidated,
                consoleErrorCount: current.consoleErrors,
                expectedAbortConsoleErrorCount:
                    current.expectedAbortConsoleErrors,
            });
            await current.page.screenshot({
                path: join(
                    output,
                    'portal-map-' + format + '-' + name + '.png'
                ),
                fullPage: true,
            });
        }
        async function assertAnchors() {
            await current.page.evaluate(() =>
                window.portalMapGoogleBoundary.draw()
            );
            const measurements = await current.page.evaluate(() => {
                const host = window.portalMapProof.snapshot(),
                    rows = [];
                for (const item of host.rows) {
                    const root = [...document.querySelectorAll('section')].find(
                        (node) =>
                            node.getAttribute('aria-label') ===
                            'Portal Map ' + item.root
                    );
                    for (const row of item.visible) {
                        const card = [
                            ...root.querySelectorAll('.mx-sdk-portal-map-card'),
                        ].find(
                            (node) =>
                                node.getAttribute('aria-label') ===
                                'Record ' + row.label
                        );
                        const content = card?.parentElement,
                            container = content?.parentElement;
                        const pointer = content?.querySelector(
                            '.mx-sdk-portal-map-pointer'
                        );
                        if (!card || !container || !pointer)
                            throw Error('Missing actual vendor marker DOM');
                        const pseudo = getComputedStyle(pointer, '::after');
                        rows.push({
                            width: container.offsetWidth,
                            height: container.offsetHeight,
                            left: parseFloat(container.style.left),
                            top: parseFloat(container.style.top),
                            expectedX: 300 + row.lng * 10,
                            expectedY: 200 + row.lat * 10,
                            pointerWidth: pointer.getBoundingClientRect().width,
                            pointerHeight:
                                pointer.getBoundingClientRect().height,
                            pointerClip: pseudo.clipPath,
                            pane: container.parentElement?.getAttribute(
                                'data-portal-map-google-pane'
                            ),
                        });
                    }
                }
                return rows;
            });
            assert(measurements.length > 0);
            for (const row of measurements) {
                assert(
                    row.width > 0 && row.height > 0,
                    'Use actual browser measurements'
                );
                assert(
                    Math.abs(row.left - (row.expectedX - row.width / 2)) <= 1
                );
                assert(Math.abs(row.top - (row.expectedY - row.height)) <= 1);
                assert.equal(row.pointerWidth, 24);
                assert.equal(row.pointerHeight, 12);
                assert(row.pointerClip.includes('polygon'));
                assert.equal(row.pane, 'overlayMouseTarget');
            }
            return measurements;
        }

        for (const format of ['esm', 'cjs']) {
            const cases = [];
            evidence.phase = format + ':shared-default-loader';
            let item = await visit(format, 'shared');
            item.mode = 'shared';
            await bounded(
                'Actual Loader bootstrap request',
                () => item.providerSeen.promise
            );
            assert.equal(item.providerRequests, 1);
            let state = await snapshot();
            assert.equal(
                state.host.realmReads,
                2,
                'Initial admission plus post-import custody recheck'
            );
            assert.deepEqual(state.host.mounted, ['first', 'second']);
            assert.equal(state.boundary, null);
            await item.page.evaluate(() =>
                window.portalMapProof.beforeLoadRows()
            );
            item.responseGate.resolve('fulfill');
            await waitCards('first', 2);
            await waitCards('second', 1);
            state = await snapshot();
            assert.equal(item.providerRequests, 1);
            assert.equal(item.routeFulfilled, 1);
            assert.equal(
                state.host.realmReads,
                2,
                'Initial admission plus post-import custody recheck'
            );
            assert(state.boundary.bootstrapCallbackPreserved);
            const loaded = loadedMaps(state.boundary);
            assert(loaded.length >= 2);
            for (const map of loaded) {
                assert.deepEqual(map.flags, {
                    fullscreenControl: false,
                    streetViewControl: false,
                });
                const expected =
                    map.label === 'Portal Map first'
                        ? [
                              { lat: 3, lng: 4 },
                              { lat: 5, lng: 6 },
                          ]
                        : [{ lat: 7, lng: 8 }];
                // StrictMode may replay initial vendor lifecycle callbacks.
                // Record that truthful multiplicity; every initial fit must
                // use current rows, and later ordinary updates must add none.
                for (const fit of map.fits) assert.deepEqual(fit, expected);
            }
            const initialFits = fitTotal(state.boundary);
            assert.equal(state.boundary.activeConnectedOverlayDivCount, 3);
            const anchors = await assertAnchors();
            await record(
                cases,
                format,
                'shared-loader-current-before-load-anchors'
            );
            cases.at(-1).measurements = anchors;

            evidence.phase = format + ':keyboard-current-ABA';
            const open = item.page.getByRole('button', {
                name: 'Open first current one',
                exact: true,
            });
            await open.focus();
            await open.press('Enter');
            assert.equal((await snapshot()).host.opens.length, 1);
            await item.page.evaluate(() =>
                window.portalMapProof.retireCardOwner()
            );
            await open.press('Enter');
            assert.equal(
                (await snapshot()).host.opens.length,
                1,
                'Retired owner must not activate'
            );
            await item.page.evaluate(() => {
                window.portalMapProof.acceptCardSuccessor();
                window.portalMapProof.identityABA();
            });
            await open.focus();
            await open.press('Enter');
            state = await snapshot();
            assert.equal(state.host.opens.length, 2);
            assert.equal(
                fitTotal(state.boundary),
                initialFits,
                'Card owner/identity echoes must not refit'
            );
            assert(
                state.host.trustedInputs.length > 0 &&
                    state.host.trustedInputs.every(Boolean)
            );
            assert.equal(
                await item.page
                    .getByRole('button', { name: /unlink|remove/i })
                    .count(),
                0
            );
            assert.equal(
                await item.page
                    .getByRole('img', { name: 'Review required' })
                    .count(),
                3
            );
            await record(
                cases,
                format,
                'keyboard-current-owner-ABA-no-unlink-hidden-data'
            );

            evidence.phase = format + ':no-ordinary-refit';
            const before = (await snapshot()).boundary;
            await item.page.evaluate(() => window.portalMapProof.laterRows());
            await waitCards('first', 1);
            state = await snapshot();
            assert.equal(
                state.boundary.constructedMapCount,
                before.constructedMapCount
            );
            assert.equal(fitTotal(state.boundary), fitTotal(before));
            await assertAnchors();
            await record(cases, format, 'ordinary-data-update-does-not-refit');

            evidence.phase = format + ':lease-release-and-conflict';
            await item.page.evaluate(() =>
                window.portalMapProof.mountConflict()
            );
            await waitFailure('conflict', 'configuration-conflict');
            assert.equal(item.providerRequests, 1);
            const capture = await item.page.evaluate(() =>
                window.portalMapGoogleBoundary.captureLateDraws()
            );
            assert(capture.capturedCount >= 2);
            await item.page.evaluate((id) => {
                window.portalMapProof.unmount('conflict');
                window.portalMapProof.unmount('first');
                window.portalMapGoogleBoundary.queueLateDraws(id);
                window.portalMapGoogleBoundary.flushLateDraws();
            }, capture.captureId);
            await waitCards('second', 1);
            state = await snapshot();
            assert.equal(state.boundary.activeConnectedOverlayDivCount, 1);
            assert(state.boundary.totals.lateDrawCallbacksPrevented > 0);
            const secondOpen = item.page.getByRole('button', {
                name: 'Open second current',
                exact: true,
            });
            await secondOpen.focus();
            await secondOpen.press('Enter');
            assert.equal((await snapshot()).host.opens.at(-1).root, 'second');
            await item.page.evaluate(() =>
                window.portalMapProof.unmount('second')
            );
            state = await snapshot();
            assertCleanBoundary(state.boundary);
            assert(
                state.host.leaseStatuses.every(
                    (status) => status === 'released'
                )
            );
            assert.equal(state.host.scripts, 1);
            assert.equal(state.host.googlePresent, true);
            await item.page.evaluate(() =>
                window.portalMapProof.mountConflict()
            );
            await waitFailure('conflict', 'configuration-conflict');
            assert.equal(item.providerRequests, 1);
            await record(
                cases,
                format,
                'release-one-late-callbacks-zero-lease-conflict'
            );

            evidence.phase = format + ':initial-empty';
            item = await visit(format, 'empty');
            item.mode = 'empty';
            await bounded(
                'Empty Map bootstrap',
                () => item.providerSeen.promise
            );
            item.responseGate.resolve('fulfill');
            await item.page.waitForFunction(() =>
                window.portalMapGoogleBoundary
                    ?.snapshot()
                    .maps.some((map) => map.fits.length > 0)
            );
            state = await snapshot();
            assert(loadedMaps(state.boundary).length > 0);
            for (const map of loadedMaps(state.boundary))
                for (const fit of map.fits) assert.deepEqual(fit, []);
            const emptyBefore = state.boundary;
            await item.page.evaluate(() => window.portalMapProof.laterRows());
            await waitCards('first', 1);
            state = await snapshot();
            assert.equal(
                state.boundary.constructedMapCount,
                emptyBefore.constructedMapCount
            );
            assert.equal(fitTotal(state.boundary), fitTotal(emptyBefore));
            await assertAnchors();
            await record(
                cases,
                format,
                'initial-empty-bounds-no-later-recenter'
            );

            evidence.phase = format + ':late-provider';
            item = await visit(format, 'late');
            item.mode = 'late';
            await bounded(
                'Late Map bootstrap',
                () => item.providerSeen.promise
            );
            await item.page.evaluate(() =>
                window.portalMapProof.retireProvider()
            );
            item.responseGate.resolve('fulfill');
            await item.page.waitForFunction(() =>
                Boolean(window.portalMapGoogleBoundary)
            );
            state = await snapshot();
            assert.equal(state.boundary.constructedMapCount, 0);
            assert.deepEqual(state.host.mounted, []);
            assert(
                state.host.leaseStatuses.every(
                    (status) => status === 'released'
                )
            );
            await item.page.evaluate(() => window.portalMapProof.mountEqual());
            await waitCards('successor', 1);
            assert.equal(item.providerRequests, 1);
            await record(
                cases,
                format,
                'late-provider-retirement-same-config-successor'
            );

            evidence.phase = format + ':unmanaged';
            item = await visit(format, 'unmanaged');
            item.mode = 'unmanaged';
            await waitFailure('first', 'unmanaged-provider');
            state = await snapshot();
            assert.equal(item.providerRequests, 0);
            assert.equal(state.host.scripts, 0);
            assert.equal(state.boundary, null);
            await record(cases, format, 'fresh-context-unmanaged-zero-scripts');

            evidence.phase = format + ':failure';
            item = await visit(format, 'failure');
            item.mode = 'failure';
            await bounded(
                'Failed Map bootstrap',
                () => item.providerSeen.promise
            );
            item.responseGate.resolve('abort');
            await waitFailure('first', 'provider-failed');
            assert.equal(item.providerRequests, 1);
            assert.equal(item.routeAborted, 1);
            await item.page.evaluate(() => {
                window.portalMapProof.unmount('first');
                window.portalMapProof.mountEqual('retry');
            });
            await waitFailure('retry', 'provider-failed');
            assert.equal(
                item.providerRequests,
                1,
                'Terminal failure/remount must not retry'
            );
            assert.equal((await snapshot()).boundary, null);
            await record(
                cases,
                format,
                'one-aborted-script-stable-failure-no-auto-retry'
            );

            evidence.phase = format + ':deferred-overlay';
            item = await visit(format, 'deferred');
            item.mode = 'deferred';
            await bounded(
                'Deferred Map bootstrap',
                () => item.providerSeen.promise
            );
            item.responseGate.resolve('fulfill');
            await waitCards('first', 1);
            await waitCards('second', 1);
            await item.page.evaluate(() => {
                window.portalMapGoogleBoundary.setDeferred(true);
                window.portalMapProof.laterRows();
            });
            await item.page.waitForFunction(
                () =>
                    window.portalMapGoogleBoundary.snapshot()
                        .pendingOverlayCount > 0
            );
            await item.page.evaluate(() => {
                window.portalMapProof.laterRows();
                window.portalMapProof.unmount('first');
                window.portalMapGoogleBoundary.flush();
            });
            state = await snapshot();
            assert.equal(state.boundary.pendingOverlayCount, 0);
            assert.equal(state.boundary.activeConnectedOverlayDivCount, 1);
            assert(state.boundary.totals.attachmentCallbacksPrevented > 0);
            await waitCards('second', 1);
            await record(
                cases,
                format,
                'deferred-overlay-retirement-keeps-other-root'
            );

            assert.equal(cases.length, 9);
            evidence.profiles.push({ format, react, cases });
        }
        await closeCurrent();
        assert.equal(evidence.pageErrorCount, 0);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
        evidence.scope =
            'Actual packed SDK ESM/CJS PortalMap, class GoogleMap, OverlayViewF, default driver and one direct Loader1.16.8; actual browser layout/keyboard/portals under StrictMode. Only intercepted Google JS/API is synthetic. No real provider egress, Google geography/gestures, key delivery, native host or persistence acceptance.';
    } catch (error) {
        const sensitiveDiagnostic =
            String(error.message).includes(portalMapSyntheticKey) ||
            String(error.message).includes(portalMapPrivateMarker);
        failure = sensitiveDiagnostic
            ? Error('Map proof failed; sensitive synthetic diagnostic withheld')
            : error;
        evidence.status = 'failed';
        // Assertion/phase labels are safe. Do not serialize provider errors/options/URLs.
        evidence.failure = {
            phase: evidence.phase ?? 'preparation',
            name: error.name,
            message: sensitiveDiagnostic
                ? 'Sensitive synthetic fixture diagnostic withheld'
                : error.message,
        };
        if (current) {
            try {
                evidence.failureState = await current.page.evaluate(() => ({
                    host: window.portalMapProof?.snapshot(),
                    boundary: window.portalMapGoogleBoundary?.snapshot(),
                }));
            } catch {
                evidence.failureCaptureUnavailable = true;
            }
        }
    } finally {
        const errors = [];
        try {
            await closeCurrent();
        } catch {
            errors.push('context');
        }
        // Transition cleanup failures remain part of this failed proof even
        // if a late close is subsequently verified. A no-op finally must not
        // replace the failed receipt or authorize deleting its directory.
        if (contextCleanupFailed) {
            if (!errors.includes('context')) errors.push('context');
            evidence.cleanup.context =
                current && !current.closed
                    ? 'failed-state-retained'
                    : 'closed-after-cleanup-failure';
        } else
            evidence.cleanup.context = contextEverAcquired
                ? 'completed'
                : 'not-acquired';
        evidence.cleanup.contextFailures = [...contextCleanupFailures];
        evidence.cleanup.contextClosureUnverified = Boolean(
            current && !current.closed
        );
        if (server) {
            try {
                await bounded(
                    'Map server close',
                    () =>
                        new Promise((resolve, reject) => {
                            server.closeAllConnections();
                            server.close((error) =>
                                error ? reject(error) : resolve()
                            );
                        })
                );
                evidence.cleanup.server = 'completed';
            } catch {
                errors.push('server');
                evidence.cleanup.server = 'failed';
            }
        } else evidence.cleanup.server = 'not-acquired';
        if (directory && !errors.length) {
            try {
                rmSync(directory, { recursive: true, force: true });
                evidence.cleanup.directory = 'completed';
            } catch {
                errors.push('directory');
                evidence.cleanup.directory = 'failed';
            }
        } else
            evidence.cleanup.directory = directory
                ? 'retained-for-uncertain-cleanup'
                : 'not-acquired';
        if (errors.length) {
            evidence.status = 'failed';
            failure ??= Error('Map proof cleanup incomplete');
        }
        if (current && !current.closed && failure) {
            // Private continuation handle for the owning caller; never JSON
            // serialize controller objects into the evidence receipt.
            Object.defineProperty(failure, 'retainedPortalMapContext', {
                value: current.context,
                enumerable: false,
            });
        }
        writeFileSync(
            join(output, 'portal-map.json'),
            JSON.stringify(evidence, null, 2) + '\n'
        );
    }
    if (failure) throw failure;
}
