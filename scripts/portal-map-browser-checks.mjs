/** Packed SDK Map proof, run by the maintained browser harness. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import {
    cpSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { assertBrowserInputs } from './package-checks.mjs';
import {
    portalMapBrowserFixture,
    portalMapSyntheticKey,
    portalMapPrivateMarker,
    portalMapPropsFactory,
    portalMapNodeSSRFixture,
} from './portal-map-browser-fixture.mjs';
import { portalMapGoogleBrowserBoundary } from './portal-map-google-browser-boundary.mjs';
import {
    assertPortalMapColocationTouchCandidate,
    capturePortalMapColocationTouchCandidate,
} from './portal-map-colocation-touch-checks.mjs';

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
function packedInventory(directory) {
    const files = [];
    function walk(parent, prefix = '') {
        for (const name of readdirSync(parent).sort()) {
            const absolute = join(parent, name),
                relative = prefix + name;
            const info = lstatSync(absolute);
            assert(
                !info.isSymbolicLink(),
                'Packed duplicate fixture must contain no symlinks'
            );
            if (info.isDirectory()) walk(absolute, relative + '/');
            else {
                assert(
                    info.isFile(),
                    'Packed duplicate fixture must contain only regular files'
                );
                const bytes = regular(absolute);
                files.push({
                    path: relative,
                    bytes: bytes.length,
                    sha256: hash(bytes),
                });
            }
        }
    }
    walk(directory);
    return {
        files,
        sha256: hash(JSON.stringify(files)),
        bytes: files.reduce((n, file) => n + file.bytes, 0),
    };
}
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
    let directory, duplicateDirectory, server, current, failure;
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
        // The shared map receives both a needs-review marker and a reviewed
        // control through normal SDK props. Leave the SSR fixture unchanged.
        const browserPropsFactory = portalMapPropsFactory.replace(
            "needsReviewLabel: 'Review required'",
            "needsReviewLabel: row.key === 'first-current-2' ? null : 'Review required'"
        );
        evidence.provenance = {
            react,
            upstreamPerFormat,
            checkerSHA256: hash(regular(new URL(import.meta.url))),
            fixtureSHA256: hash(portalMapBrowserFixture),
            propsFactorySHA256: hash(portalMapPropsFactory),
            browserPropsFactorySHA256: hash(browserPropsFactory),
            nodeSSRFixtureSHA256: hash(portalMapNodeSSRFixture),
            syntheticGoogleResponseSHA256: hash(portalMapGoogleBrowserBoundary),
        };
        directory = mkdtempSync(join(root, '.portal-map-proof-'));
        // This is a physical byte-identical installed package copy, not a mock
        // or rewritten module. Its package metadata and advertised trees remain
        // unchanged, and both copies resolve the same consumer React peers.
        const duplicateName = '@miniextensions/sdk-portal-map-proof-duplicate';
        const duplicate = join(root, 'node_modules', duplicateName);
        assert(
            !existsSync(duplicate),
            'Refuse an existing duplicate-copy fixture'
        );
        const originalInventory = packedInventory(sdk);
        mkdirSync(duplicate);
        duplicateDirectory = duplicate; // retain ownership even if copying fails midway
        // Keep the atomic ownership claim while copying only to absent children.
        // Node 24 refuses an existing root with these no-overwrite options.
        for (const entry of readdirSync(sdk)) {
            cpSync(join(sdk, entry), join(duplicate, entry), {
                recursive: true,
                dereference: false,
                force: false,
                errorOnExist: true,
            });
        }
        const duplicateInventory = packedInventory(duplicate);
        assert.equal(duplicateInventory.sha256, originalInventory.sha256);
        assert.equal(
            duplicateInventory.files.length,
            originalInventory.files.length
        );
        assert.equal(duplicateInventory.bytes, originalInventory.bytes);
        const duplicateRequire = createRequire(join(duplicate, 'package.json'));
        const sdkRequire = createRequire(join(sdk, 'package.json'));
        for (const peer of [
            'react',
            'react-dom',
            'react-dom/client',
            'react-dom/server',
        ]) {
            assert.equal(
                realpathSync(duplicateRequire.resolve(peer)),
                realpathSync(require.resolve(peer))
            );
            assert.equal(
                realpathSync(sdkRequire.resolve(peer)),
                realpathSync(require.resolve(peer))
            );
        }
        evidence.provenance.duplicateCopy = {
            physical: true,
            name: duplicateName,
            fileCount: duplicateInventory.files.length,
            bytes: duplicateInventory.bytes,
            inventorySHA256: duplicateInventory.sha256,
            samePhysicalReactPeers: true,
        };
        const responses = new Map();
        const ssrByFormat = new Map();
        const ssrEntry = join(directory, 'actual-packed-portal-map-ssr.mjs');
        writeFileSync(
            ssrEntry,
            portalMapNodeSSRFixture.replace(
                '__PORTAL_MAP_PROPS_FACTORY__',
                portalMapPropsFactory
            )
        );
        for (const format of ['esm', 'cjs']) {
            const api =
                format === 'esm'
                    ? "import { PortalMap, createGoogleMapsPortalMapDriver } from '@miniextensions/sdk/react';\nimport { bindPortalMapProvider, createPortalMapProviderCoordinator, createPortalMapProviderOwnerScope } from '@miniextensions/sdk/portals';"
                    : "const { PortalMap, createGoogleMapsPortalMapDriver } = require('@miniextensions/sdk/react');\nconst { bindPortalMapProvider, createPortalMapProviderCoordinator, createPortalMapProviderOwnerScope } = require('@miniextensions/sdk/portals');";
            const foreignFormat = format === 'esm' ? 'cjs' : 'esm';
            const foreign =
                foreignFormat === 'esm'
                    ? "import { PortalMap as ForeignPortalMap } from '" +
                      duplicateName +
                      "/react';\nimport { bindPortalMapProvider as foreignBindPortalMapProvider, createPortalMapProviderOwnerScope as foreignCreatePortalMapProviderOwnerScope } from '" +
                      duplicateName +
                      "/portals';"
                    : "const { PortalMap: ForeignPortalMap } = require('" +
                      duplicateName +
                      "/react');\nconst { bindPortalMapProvider: foreignBindPortalMapProvider, createPortalMapProviderOwnerScope: foreignCreatePortalMapProviderOwnerScope } = require('" +
                      duplicateName +
                      "/portals');";
            for (const mixed of [false, true]) {
                const entry = join(
                    directory,
                    format + (mixed ? '-mixed' : '') + '.mjs'
                );
                const foreignAPI = mixed
                    ? foreign
                    : 'const ForeignPortalMap = PortalMap, foreignBindPortalMapProvider = bindPortalMapProvider, foreignCreatePortalMapProviderOwnerScope = createPortalMapProviderOwnerScope;';
                writeFileSync(
                    entry,
                    portalMapBrowserFixture
                        .replace('__PORTAL_MAP_API__', api)
                        .replace('__PORTAL_MAP_FOREIGN_API__', foreignAPI)
                        .replace(
                            '__PORTAL_MAP_PROPS_FACTORY__',
                            browserPropsFactory
                        )
                );
                evidence.provenance.browserEntries ??= [];
                evidence.provenance.browserEntries.push({
                    format,
                    mixed,
                    sourceSHA256: hash(regular(entry)),
                });
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
                                path.includes(
                                    '/sdk/dist/' + format + '/react/'
                                ) && path.endsWith('/' + name)
                        ),
                        'Actual packed Map implementation must be in the bundle'
                    );
                if (mixed) {
                    const copies = [
                        { directory: sdk, format },
                        { directory: duplicate, format: foreignFormat },
                    ].map(({ directory, format: copyFormat }) => {
                        const reached = [
                            'PortalMap.js',
                            'PortalMapCard.js',
                            'map/GoogleMapsRuntime.js',
                        ].map((name) => {
                            const target = join(
                                directory,
                                'dist',
                                copyFormat,
                                'react',
                                name
                            );
                            assert(
                                inputs.some(
                                    (input) =>
                                        realpathSync(resolve(root, input)) ===
                                        realpathSync(target)
                                ),
                                'Both physical packed SDK/runtime copies must be bundled'
                            );
                            return {
                                path: 'dist/' + copyFormat + '/react/' + name,
                                sha256: hash(regular(target)),
                            };
                        });
                        return {
                            copy: directory === sdk ? 'primary' : 'foreign',
                            format: copyFormat,
                            reached,
                        };
                    });
                    evidence.provenance.mixedCopies ??= [];
                    evidence.provenance.mixedCopies.push({ format, copies });
                }
                responses.set(
                    '/' + format + (mixed ? '.mixed' : '') + '.bundle.js',
                    {
                        type: 'text/javascript',
                        bytes: bundle.outputFiles[0].contents,
                    }
                );
            }
            const ssr = JSON.parse(
                execFileSync(process.execPath, [ssrEntry, format], {
                    cwd: root,
                    encoding: 'utf8',
                    timeout: 10000,
                    maxBuffer: 65536,
                    stdio: ['ignore', 'pipe', 'pipe'],
                })
            );
            assert.equal(ssr.format, format);
            assert.equal(ssr.react, react);
            assert.equal(ssr.noDOMBeforeAndAfter, true);
            assert.equal(ssr.samePhysicalReactPeer, true);
            assert(Object.values(ssr.stats).every((count) => count === 0));
            assert(ssr.markup.includes('Synthetic Map loading'));
            assert(
                !ssr.markup.includes(portalMapSyntheticKey) &&
                    !ssr.markup.includes(portalMapPrivateMarker)
            );
            assert(
                !/<script\b/i.test(ssr.markup),
                'SSR must contain only trusted loading markup'
            );
            ssrByFormat.set(format, ssr);
            evidence.provenance.serverRendering ??= [];
            evidence.provenance.serverRendering.push({
                format,
                react,
                markupSHA256: hash(ssr.markup),
                stats: ssr.stats,
                nodeEntrySHA256: hash(regular(ssrEntry)),
                noDOMBeforeAndAfter: true,
                samePhysicalReactPeer: true,
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
                const mode = url.searchParams.get('mode');
                const main =
                    mode === 'hydrate'
                        ? '<div class="portal-map-proof-root" data-proof-root="first">' +
                          ssrByFormat.get(format).markup +
                          '</div>'
                        : '';
                const bundle =
                    format + (mode === 'mixed' ? '.mixed' : '') + '.bundle.js';
                const fitTouchViewport =
                    mode === 'colocation-touch'
                        ? '.portal-map-proof-root{width:100%;box-sizing:border-box}'
                        : '';
                response.setHeader('Content-Type', 'text/html');
                return response.end(
                    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Portal Map proof</title><link rel="stylesheet" href="/portal-map.css"><style>body{margin:0;padding:16px;background:#f8fafc}main{display:flex;gap:24px;flex-wrap:wrap}.portal-map-proof-root{width:640px;height:480px;border:1px solid #94a3b8}.mx-sdk-portal-map{height:100%}' +
                        fitTouchViewport +
                        '</style><main>' +
                        main +
                        '</main><script type="module" src="/' +
                        bundle +
                        '"></script>'
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
            const touch = mode === 'colocation-touch';
            const context = await browser.newContext({
                viewport: touch
                    ? { width: 390, height: 780 }
                    : { width: 1440, height: 1100 },
                ...(touch && { hasTouch: true, isMobile: true }),
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
                consoleWarnings: 0,
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
                if (message.type() === 'warning') item.consoleWarnings++;
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
            assert.equal(state.host.recoverableHydrationErrors, 0);
            assert.equal(state.host.privateInHydrationError, false);
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
                consoleWarningCount: current.consoleWarnings,
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
        async function checkReviewMarkerForcedColors(format) {
            const page = current.page;
            const needsReview = page.getByRole('group', {
                name: 'Record first current one',
                exact: true,
            });
            const reviewed = page.getByRole('group', {
                name: 'Record first current two',
                exact: true,
            });
            const dotSelector = '.mx-sdk-portal-map-review';
            const markRole = { name: 'Review required', exact: true };
            evidence.reviewMarkerForcedColors ??= {};
            const measurements = {};
            evidence.reviewMarkerForcedColors[format] = measurements;
            try {
                for (const [phase, forcedColors] of [
                    ['normal', 'none'],
                    ['forced', 'active'],
                    ['restored', 'none'],
                ]) {
                    await page.emulateMedia({ forcedColors });
                    const state = await needsReview.evaluate(
                        (card, selector) => {
                            const dot = card.querySelector(selector);
                            const bounds = (node) => {
                                const { x, y, width, height } =
                                    node.getBoundingClientRect();
                                return {
                                    x: x + scrollX,
                                    y: y + scrollY,
                                    width,
                                    height,
                                };
                            };
                            const dotStyle = dot && getComputedStyle(dot);
                            return {
                                forcedColors: matchMedia(
                                    '(forced-colors: active)'
                                ).matches,
                                dotColor: dotStyle?.backgroundColor ?? null,
                                cardColor:
                                    getComputedStyle(card).backgroundColor,
                                forcedColorAdjust:
                                    dotStyle?.forcedColorAdjust ?? null,
                                geometry: {
                                    card: bounds(card),
                                    dot: dot && bounds(dot),
                                },
                            };
                        },
                        dotSelector
                    );
                    const screenshot = `portal-map-${format}-review-marker-${phase}.png`;
                    measurements[phase] = {
                        ...state,
                        markCount: await needsReview
                            .getByRole('img', markRole)
                            .count(),
                        markVisible: await needsReview
                            .getByRole('img', markRole)
                            .isVisible(),
                        reviewedMarkCount: await reviewed
                            .getByRole('img', markRole)
                            .count(),
                        reviewedDotCount: await reviewed
                            .locator(dotSelector)
                            .count(),
                        screenshot,
                    };
                    const bytes = await page.screenshot({
                        path: join(output, screenshot),
                        fullPage: true,
                        scale: 'css',
                    });
                    measurements[phase].paint = await page.evaluate(
                        async ({ png, card, dot }) => {
                            const image = await createImageBitmap(
                                new Blob(
                                    [
                                        Uint8Array.from(
                                            atob(png),
                                            (character) =>
                                                character.charCodeAt(0)
                                        ),
                                    ],
                                    { type: 'image/png' }
                                )
                            );
                            try {
                                const canvas = document.createElement('canvas');
                                canvas.width = image.width;
                                canvas.height = image.height;
                                const context = canvas.getContext('2d');
                                context.drawImage(image, 0, 0);
                                const pixel = (x, y) =>
                                    Array.from(
                                        context.getImageData(
                                            Math.floor(x),
                                            Math.floor(y),
                                            1,
                                            1
                                        ).data
                                    );
                                return {
                                    card: pixel(
                                        card.x + card.width - 6,
                                        card.y + 6
                                    ),
                                    dot:
                                        dot &&
                                        pixel(
                                            dot.x + dot.width / 2,
                                            dot.y + dot.height / 2
                                        ),
                                };
                            } finally {
                                image.close();
                            }
                        },
                        { png: bytes.toString('base64'), ...state.geometry }
                    );
                }
            } finally {
                await page.emulateMedia({ forcedColors: 'none' });
            }
            const { normal, forced, restored } = measurements;
            assert.deepEqual(
                [
                    normal.forcedColors,
                    forced.forcedColors,
                    restored.forcedColors,
                ],
                [false, true, false]
            );
            for (const state of [normal, forced, restored]) {
                assert.equal(state.markCount, 1);
                assert.equal(state.markVisible, true);
                assert.equal(state.reviewedMarkCount, 0);
                assert.equal(state.reviewedDotCount, 0);
                assert.deepEqual(state.geometry, normal.geometry);
            }
            assert(normal.geometry.dot);
            assert.equal(normal.geometry.dot.width, 10);
            assert.equal(normal.geometry.dot.height, 10);
            for (const state of [normal, restored]) {
                assert.equal(state.dotColor, 'rgb(239, 68, 68)');
                assert.deepEqual(state.paint.dot, [239, 68, 68, 255]);
            }
            assert.notDeepEqual(
                forced.paint.dot,
                forced.paint.card,
                'Forced-colors review dot must paint distinctly from the card'
            );
        }

        for (const format of ['esm', 'cjs']) {
            const cases = [];
            {
                const touchCases = [];
                const name = 'colocation-touch';
                evidence.phase = format + ':' + name;
                const item = await visit(format, name);
                await bounded(
                    'Actual Loader bootstrap request',
                    () => item.providerSeen.promise
                );
                item.responseGate.resolve('fulfill');
                await waitCards('first', 3);
                await item.page.evaluate(() =>
                    window.portalMapGoogleBoundary.draw()
                );
                evidence.colocationTouch ??= {};
                const observation = {};
                evidence.colocationTouch[format] = observation;
                await capturePortalMapColocationTouchCandidate(item.page, {
                    observation,
                    onKeyboardFocus: () =>
                        item.page.screenshot({
                            path: join(
                                output,
                                `portal-map-${format}-${name}-keyboard-bay.png`
                            ),
                            fullPage: true,
                        }),
                    onDialog: (recordId) =>
                        item.page.screenshot({
                            path: join(
                                output,
                                `portal-map-${format}-${name}-${recordId}-choices.png`
                            ),
                            fullPage: true,
                        }),
                });
                await record(touchCases, format, name);
                assert.equal(item.providerRequests, 1);
                assert.equal(item.routeFulfilled, 1);
                assert.equal(item.routeAborted, 0);
                assert.equal(item.callbackValidated, true);
                assert.equal(evidence.externalProviderEgress, 0);
                await item.page.evaluate(() =>
                    window.portalMapProof.unmount('first')
                );
                const cleanupAfterUnmount = await assertPrivateSafe();
                assertCleanBoundary(cleanupAfterUnmount.boundary);
                assert.deepEqual(cleanupAfterUnmount.host.mounted, []);
                assert.equal(
                    cleanupAfterUnmount.host.triggerRegistrations,
                    cleanupAfterUnmount.host.triggerReleases
                );
                touchCases[0].cleanupAfterUnmount = cleanupAfterUnmount;
                assertPortalMapColocationTouchCandidate(observation);
                observation.case = touchCases[0];
            }
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

            evidence.phase = format + ':review-marker-forced-colors';
            await checkReviewMarkerForcedColors(format);
            cases.at(-1).reviewMarkerForcedColors =
                evidence.reviewMarkerForcedColors[format];

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
                2
            );
            await record(
                cases,
                format,
                'keyboard-current-owner-ABA-no-unlink-hidden-data'
            );

            evidence.phase = format + ':held-open-replacement';
            const heldOpens = [];
            const openButton = await open.elementHandle();
            assert(openButton);
            try {
                for (const modality of ['keyboard', 'pointer']) {
                    await open.focus();
                    await openButton.evaluate((button) => {
                        window.portalMapProof.watchOpen(button);
                    });
                    const before = (await snapshot()).host.opens.length;
                    const recordId = modality + '-open-successor';
                    if (modality === 'keyboard') {
                        await item.page.keyboard.down('Space');
                    } else {
                        await open.hover();
                        await item.page.mouse.down();
                    }
                    try {
                        assert.deepEqual(
                            await item.page.evaluate(
                                (id) =>
                                    window.portalMapProof.replaceOpenRecord(id),
                                recordId
                            ),
                            { marker: 'first-current-1', recordId }
                        );
                        assert(
                            await openButton.evaluate(
                                (button) =>
                                    button === document.activeElement &&
                                    button ===
                                        document.querySelector(
                                            '[aria-label="Open first current one"]'
                                        )
                            ),
                            'The replacement must reuse the focused Open button'
                        );
                    } finally {
                        if (modality === 'keyboard')
                            await item.page.keyboard.up('Space');
                        else await item.page.mouse.up();
                    }
                    const afterRelease = (await snapshot()).host.opens;
                    const events = await item.page.evaluate(() =>
                        window.portalMapProof.openEvents()
                    );
                    assert.deepEqual(
                        events.map((event) => event.type),
                        modality === 'keyboard'
                            ? ['keydown', 'keyup', 'click']
                            : ['pointerdown', 'pointerup', 'click']
                    );
                    assert(events.every((event) => event.trusted));
                    assert.equal(
                        events.at(-1).detail === 0,
                        modality === 'keyboard'
                    );
                    if (modality === 'keyboard')
                        await item.page.keyboard.press('Space');
                    else await open.click();
                    const afterFresh = (await snapshot()).host.opens;
                    heldOpens.push({
                        modality,
                        events,
                        held: afterRelease.slice(before),
                        fresh: afterFresh.slice(afterRelease.length),
                    });
                    assert.deepEqual(heldOpens.at(-1).fresh, [
                        { root: 'first', record: recordId },
                    ]);
                }
            } finally {
                await item.page.evaluate(() =>
                    window.portalMapProof.watchOpen(null)
                );
                await openButton.dispose();
            }
            evidence.heldOpenGestures ??= {};
            evidence.heldOpenGestures[format] = heldOpens;
            assert.deepEqual(
                heldOpens.map((proof) => proof.held),
                [[], []],
                'Held Space and pointer releases must leave the replacement closed'
            );
            assert.equal((await snapshot()).host.submits, 0);
            assert.equal(item.providerRequests, 1);
            await record(cases, format, 'held-open-owner-replacement');

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

            evidence.phase = format + ':duplicate-packed-copies';
            item = await visit(format, 'mixed');
            item.mode = 'mixed';
            await bounded(
                'Mixed-copy actual Loader bootstrap',
                () => item.providerSeen.promise
            );
            state = await snapshot();
            assert.equal(state.host.copiesDistinct, true);
            assert.deepEqual(state.host.rootCopies, [
                { name: 'first', copy: 'primary' },
                { name: 'second', copy: 'foreign' },
            ]);
            assert(
                state.host.bindingCopies.every(
                    (binding) => binding.sharedCoordinator
                )
            );
            assert.equal(state.host.realmReads, 2);
            assert.equal(item.providerRequests, 1);
            item.responseGate.resolve('fulfill');
            await waitCards('first', 1);
            await waitCards('second', 1);
            state = await snapshot();
            assert.equal(state.boundary.activeConnectedOverlayDivCount, 2);
            assert.equal(state.host.scripts, 1);
            assert.equal(item.routeFulfilled, 1);
            await assertAnchors();
            await item.page.evaluate(() =>
                window.portalMapProof.mountForeignConflict()
            );
            await waitFailure('foreign-conflict', 'configuration-conflict');
            assert.equal(item.providerRequests, 1);
            await item.page.evaluate(() => {
                window.portalMapProof.unmount('foreign-conflict');
                window.portalMapProof.unmount('first');
            });
            await waitCards('second', 1);
            assert.equal(
                (await snapshot()).boundary.activeConnectedOverlayDivCount,
                1
            );
            const foreignOpen = item.page.getByRole('button', {
                name: 'Open second initial',
                exact: true,
            });
            await foreignOpen.focus();
            await foreignOpen.press('Enter');
            assert.equal((await snapshot()).host.opens.at(-1).root, 'second');
            const foreignOpenCount = (await snapshot()).host.opens.length;
            await item.page.evaluate(() =>
                window.portalMapProof.retireCardOwner('second')
            );
            await foreignOpen.press('Enter');
            assert.equal(
                (await snapshot()).host.opens.length,
                foreignOpenCount
            );
            await item.page.evaluate(() => {
                window.portalMapProof.acceptCardSuccessor('second');
                window.portalMapProof.identityABA('second');
            });
            await foreignOpen.focus();
            await foreignOpen.press('Enter');
            assert.equal(
                (await snapshot()).host.opens.length,
                foreignOpenCount + 1
            );
            await item.page.evaluate(() =>
                window.portalMapProof.foreignProviderOwnerABA()
            );
            await waitFailure('second', 'owner-retired');
            state = await snapshot();
            assert.deepEqual(state.host.foreignOwnerABA, {
                oldOwnerCurrent: false,
                successorCurrent: true,
                successorKind: 'lease',
                successorStatus: 'ready',
                replayKind: 'refused',
                replayCode: 'owner-retired',
            });
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
            assert.equal(
                state.host.triggerRegistrations,
                state.host.triggerReleases
            );
            await item.page.evaluate(() =>
                window.portalMapProof.mountForeignEqual()
            );
            await waitCards('foreign-successor', 1);
            state = await snapshot();
            assert.deepEqual(state.host.rootCopies, [
                { name: 'foreign-successor', copy: 'foreign' },
            ]);
            assert(
                state.host.bindingCopies.every(
                    (binding) => binding.sharedCoordinator
                )
            );
            assert.equal(state.host.realmReads, 2);
            assert.equal(state.host.scripts, 1);
            assert.equal(
                item.providerRequests,
                1,
                'Foreign copy must not implicitly create its own loader'
            );
            await assertAnchors();
            await record(
                cases,
                format,
                'duplicate-packed-cross-format-copies-one-coordinator-owner-ABA'
            );

            evidence.phase = format + ':actual-SSR-hydration';
            item = await visit(format, 'hydrate');
            item.mode = 'hydrate';
            const serverRendered = ssrByFormat.get(format);
            assert.equal(
                await item.page
                    .locator('[data-proof-root="first"]')
                    .innerHTML(),
                serverRendered.markup
            );
            state = await snapshot();
            assert.deepEqual(state.host.mounted, []);
            assert.equal(state.host.acquisitions, 0);
            assert.equal(state.host.realmReads, 0);
            assert.equal(state.host.hydrationStarted, false);
            assert.equal(state.host.scripts, 0);
            assert.equal(item.providerRequests, 0);
            assert.equal(state.host.googlePresent, false);
            assert.equal(state.boundary, null);
            assert.equal(state.host.serverSectionPreserved, true);
            assert.equal(state.host.serverLoadingPreserved, true);
            assert.deepEqual(
                state.host.hydrationPropsSignature,
                serverRendered.propsSignature
            );
            const beforeHydration = await assertPrivateSafe();
            await item.page.evaluate(() =>
                window.portalMapProof.beginHydration()
            );
            await bounded(
                'Hydrated actual Loader bootstrap',
                () => item.providerSeen.promise
            );
            state = await snapshot();
            assert.equal(state.host.hydrationStarted, true);
            assert.deepEqual(state.host.mounted, ['first']);
            assert(state.host.acquisitions > 0);
            assert.equal(state.host.realmReads, 2);
            assert.equal(item.providerRequests, 1);
            assert.equal(item.routeFulfilled, 0);
            assert.equal(state.host.serverSectionPreserved, true);
            assert.equal(state.host.serverLoadingPreserved, true);
            assert.equal(state.host.recoverableHydrationErrors, 0);
            assert.equal(item.consoleErrors, 0);
            assert.equal(item.pageErrors, 0);
            assert.equal(item.consoleWarnings, 0);
            const hydratedWhileHeld = await assertPrivateSafe();
            item.responseGate.resolve('fulfill');
            await waitCards('first', 1);
            state = await snapshot();
            assert.equal(state.host.serverSectionPreserved, true);
            assert.equal(state.host.serverLoadingPreserved, false);
            assert.equal(state.host.recoverableHydrationErrors, 0);
            assert.equal(item.consoleErrors, 0);
            assert.equal(item.pageErrors, 0);
            assert.equal(item.consoleWarnings, 0);
            assert.equal(item.providerRequests, 1);
            assert.equal(item.routeFulfilled, 1);
            const hydrationMeasurements = await assertAnchors();
            const hydratedOpen = item.page.getByRole('button', {
                name: 'Open first initial',
                exact: true,
            });
            await hydratedOpen.focus();
            await hydratedOpen.press('Enter');
            assert.equal((await snapshot()).host.opens.length, 1);
            await record(
                cases,
                format,
                'actual-packed-SSR-hydrateRoot-default-loader'
            );
            Object.assign(cases.at(-1), {
                beforeHydration,
                hydratedWhileHeld,
                serverMarkupSHA256: hash(serverRendered.markup),
                measurements: hydrationMeasurements,
            });
            await item.page.evaluate(() =>
                window.portalMapProof.unmount('first')
            );
            state = await assertPrivateSafe();
            assertCleanBoundary(state.boundary);
            assert(
                state.host.leaseStatuses.every(
                    (status) => status === 'released'
                )
            );
            assert.equal(
                state.host.triggerRegistrations,
                state.host.triggerReleases
            );
            cases.at(-1).cleanupAfterUnmount = state;

            assert.equal(cases.length, 12);
            evidence.profiles.push({ format, react, cases });
        }
        await closeCurrent();
        assert.equal(evidence.pageErrorCount, 0);
        assert.deepEqual(evidence.unexpectedRequests, []);
        evidence.status = 'passed';
        evidence.scope =
            'Actual packed SDK ESM/CJS PortalMap, class GoogleMap, OverlayViewF, default driver and one direct Loader1.16.8; actual browser layout, keyboard, shared-point touch and portals under StrictMode, byte-identical physical installed SDK copies using opposite ESM/CJS trees and sharing one host coordinator, and actual no-DOM packed Node SSR followed by hydrateRoot preserving loading nodes without recoverable errors. Only intercepted Google JS/API is synthetic. No real provider egress, Google geography/gestures, key delivery, native host or persistence acceptance.';
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
        if (duplicateDirectory && !errors.length) {
            try {
                rmSync(duplicateDirectory, { recursive: true, force: true });
                assert(!existsSync(duplicateDirectory));
                evidence.cleanup.duplicateCopy = 'completed';
            } catch {
                errors.push('duplicate-copy');
                evidence.cleanup.duplicateCopy = 'failed-state-retained';
            }
        } else
            evidence.cleanup.duplicateCopy = duplicateDirectory
                ? 'retained-for-uncertain-cleanup'
                : 'not-acquired';
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
