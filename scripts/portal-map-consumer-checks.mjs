// Packed consumer/type/CSS proof. This matrix never acquires a provider or creates DOM.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const peers = /^(?:react|react-dom)(?:\/.*)?$/;
const forbiddenCustomerPackages = [
    '@react-google-maps/api',
    '@googlemaps/js-api-loader',
    '@types/google.maps',
];
const expectedPhysicalInputs = new Map([
    [
        '@react-google-maps/api',
        {
            version: '2.20.7',
            path: 'dist/esm.js',
            sha256: 'b59f4ae04f1500a8f20929607d5e85926acd34e829c915e4b7d253be6fa3e36d',
        },
    ],
    [
        '@googlemaps/js-api-loader',
        {
            version: '1.16.8',
            path: 'dist/index.mjs',
            sha256: '54ce0a34af51343b4758d88c42f7b6eb3134b3cd0034863ae61bf515b1e1908c',
        },
    ],
]);

export const portalMapTypedConsumer = String.raw`
import { createElement } from 'react';
import {
    PortalMap, PortalMapCard, createGoogleMapsPortalMapDriver,
    type PortalMapProps, type PortalMapMarker, type PortalMapCardData,
} from '@miniextensions/sdk/react';
import {
    createPortalMapProviderCoordinator, createPortalMapProviderOwnerScope,
    bindPortalMapProvider,
    type PortalMapProviderConfiguration, type PortalMapProviderOwner,
} from '@miniextensions/sdk/portals';
const scope = createPortalMapProviderOwnerScope();
const owner = scope.capture();
const configuration: PortalMapProviderConfiguration = {
    apiKey: 'synthetic-package-proof-not-a-provider-key', libraries: ['maps'],
};
const driver = createGoogleMapsPortalMapDriver({ getRealm: () => null });
const coordinator = createPortalMapProviderCoordinator(driver);
const binding = bindPortalMapProvider(coordinator, owner, configuration);
const card: PortalMapCardData = {
    recordId: 'one', identity: {}, owner, accessibleLabel: 'Record one',
    projection: { status: 'present', layout: 'map', primary: 'Primary', primaryIsEmpty: false },
    open: { label: 'Open record', activate() {}, registerTrigger(element) {
        const button: HTMLButtonElement = element; void button; return () => {};
    } }, needsReviewLabel: 'Needs review',
};
const markers: readonly PortalMapMarker[] = [{ key: 'one-occurrence', position: {lat: 10, lng: 20}, card }];
const props: PortalMapProps = {
    provider: binding, markers, label: 'Map', loadingLabel: 'Loading map',
    failureLabel: code => code,
};
createElement(PortalMap, props);
createElement(PortalMapCard, { card });
createPortalMapProviderCoordinator({
    inspectRealm: () => ({kind: 'empty'}),
    createLoader(effective) {
        const retries: 0 = effective.retries;
        const url: 'https://maps.googleapis.com/maps/api/js' = effective.url;
        void retries; void url;
        return {load: async () => {}};
    },
});
// @ts-expect-error complete Map owns its marker/card renderer
const nativeRenderer: PortalMapProps = {...props, renderMarker() { return null; }};
// @ts-expect-error provider ownership is a binding, not a credential string
const keyOnly: PortalMapProps = {...props, provider: configuration.apiKey};
// @ts-expect-error coordinates remain numeric SDK data
const invalidPosition: PortalMapMarker = {...markers[0]!, position: {lat: '10', lng: 20}};
// @ts-expect-error ownership checks are synchronous boolean observations
const asyncOwner: PortalMapProviderOwner = {isCurrent: async () => true};
// @ts-expect-error no arbitrary vendor Map options in the public complete surface
const vendorProps: PortalMapProps = {...props, mapOptions: {zoom: 5}};
// @ts-expect-error the headless core entry must not acquire the React surface
import { PortalMap as CoreMap } from '@miniextensions/sdk';
// @ts-expect-error the fresh customer must not require the bundled build vendor
import type { GoogleMapProps as CustomerVendorProps } from '@react-google-maps/api';
// @ts-expect-error public declarations do not install an ambient Google Maps namespace
type CustomerGoogleMap = google.maps.Map;
void nativeRenderer; void keyOnly; void invalidPosition; void asyncOwner; void vendorProps; void CoreMap;
`;

function assertAbsent(consumer, name) {
    // Declaration-only packages have no JavaScript entry, so resolving their
    // bare name could fail even while their ambient types are installed.
    const target = name.startsWith('@types/') ? name + '/package.json' : name;
    assert.throws(() => consumer.resolve(target), { code: 'MODULE_NOT_FOUND' });
}

function noBrowserGlobals() {
    assert.equal(typeof globalThis.document, 'undefined');
    assert.equal(typeof globalThis.window, 'undefined');
    assert.equal(typeof globalThis.google, 'undefined');
}

function exportPath(root, manifest, subpath, format) {
    const branch =
        manifest.exports[subpath][format === 'esm' ? 'import' : 'require'];
    const path = resolve(
        root,
        typeof branch === 'string' ? branch : branch.default
    );
    assert(realpathSync(path).startsWith(realpathSync(root) + sep));
    assert(lstatSync(path).isFile());
    return path;
}

async function loadEntry(consumer, root, manifest, subpath, format) {
    const specifier =
        '@miniextensions/sdk' + (subpath === '.' ? '' : subpath.slice(1));
    return format === 'cjs'
        ? consumer(specifier)
        : import(
              pathToFileURL(exportPath(root, manifest, subpath, format)).href
          );
}

function installedArchiveReader(root, archivePath) {
    const cache = new Map();
    return (path) => {
        path = resolve(path);
        const rel = relative(root, path).replaceAll('\\', '/');
        assert(rel && !rel.startsWith('../') && !rel.startsWith('/'));
        assert(
            lstatSync(path).isFile(),
            'Installed packed member must be regular'
        );
        assert(realpathSync(path).startsWith(realpathSync(root) + sep));
        if (!cache.has(rel)) {
            cache.set(
                rel,
                execFileSync('tar', ['-xzOf', archivePath, 'package/' + rel], {
                    maxBuffer: 16 * 1024 * 1024,
                    timeout: 30000,
                })
            );
        }
        const installed = readFileSync(path);
        assert.deepEqual(installed, cache.get(rel), rel);
        return installed;
    };
}

function checkVendor(root, format, readPacked) {
    const directory = join(root, 'dist', format, 'react/map');
    const receipt = JSON.parse(
        readPacked(join(directory, 'portal-map-vendor.json'))
    );
    const upstreamBytes = readPacked(
        join(directory, 'portal-map-upstream.json')
    );
    const upstream = JSON.parse(upstreamBytes);
    const runtime = readPacked(join(directory, 'GoogleMapsRuntime.js'));
    const notices = readPacked(join(directory, 'portal-map.LICENSES.txt'));
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.format, format);
    assert.equal(
        receipt.child,
        `dist/${format}/react/map/GoogleMapsRuntime.js`
    );
    assert.equal(
        receipt.sourceEntry,
        'dist/esm/react/map/GoogleMapsRuntime.js'
    );
    assert.match(receipt.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.bytes, runtime.length);
    assert.equal(receipt.sha256, hash(runtime));
    assert.equal(receipt.upstreamSha256, hash(upstreamBytes));
    assert.equal(receipt.licensesSha256, hash(notices));
    assert.equal(upstream.licensesSha256, hash(notices));
    assert.equal(upstream.schemaVersion, 1);
    assert.equal(upstream.sourceMapContentVerification.compared, 58);
    assert.equal(upstream.sourceMapContentVerification.differences, 0);
    assert.equal(upstream.sourceMapContentVerification.nullContents, 1);
    assert.equal(upstream.licenseFiles.length, 13);
    for (const item of upstream.licenseFiles)
        assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
        upstream.physicalPackages
            .map(({ name, version }) => [name, version])
            .sort(),
        [...expectedPhysicalInputs]
            .map(([name, value]) => [name, value.version])
            .sort()
    );
    const reached = new Set();
    for (const input of receipt.physicalInputs) {
        if (peers.test(input.package)) {
            assert.equal(input.path, 'sdk-owned-external-ESM-peer-facade');
            continue;
        }
        const expected = expectedPhysicalInputs.get(input.package);
        assert(expected, 'Unexpected bundled Map input package');
        assert.equal(input.version, expected.version);
        assert.equal(input.path, expected.path);
        assert.equal(input.sha256, expected.sha256);
        reached.add(input.package);
    }
    assert.deepEqual(
        [...reached].sort(),
        [...expectedPhysicalInputs.keys()].sort()
    );
    assert(receipt.externalPeers.every((name) => peers.test(name)));
    for (const name of ['react', 'react-dom', 'react/jsx-runtime'])
        assert(receipt.externalPeers.includes(name));
    return {
        format,
        sourceSha256: receipt.sourceSha256,
        runtimeSha256: hash(runtime),
        upstreamSha256: hash(upstreamBytes),
        licensesSha256: hash(notices),
        externalPeers: receipt.externalPeers,
        physicalPackages: [...reached].sort(),
    };
}

function checkCss(root, consumer, manifest, format, readPacked) {
    assert.equal(
        manifest.exports['./react/portal-map.css'],
        './dist/esm/react/portal-map.css'
    );
    assert.equal(
        realpathSync(
            consumer.resolve('@miniextensions/sdk/react/portal-map.css')
        ),
        realpathSync(join(root, 'dist/esm/react/portal-map.css'))
    );
    assert.deepEqual(
        readPacked(join(root, 'dist/esm/react/portal-map.css')),
        readPacked(join(root, 'dist/cjs/react/portal-map.css'))
    );
    const records = new Map();
    function visit(path) {
        path = resolve(path);
        assert(
            path.startsWith(resolve(root, 'dist', format) + sep) ||
                path ===
                    resolve(root, 'dist/vendor/phone-number-input/style.css'),
            'Map CSS may reach only its format closure and the shared finder phone stylesheet'
        );
        if (records.has(path)) return '';
        const bytes = readPacked(path);
        const text = bytes.toString('utf8');
        records.set(path, {
            path: relative(root, path).replaceAll('\\', '/'),
            sha256: hash(bytes),
        });
        const imports = [
            ...text.matchAll(
                /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?\s*;/g
            ),
        ];
        assert.equal(imports.length, (text.match(/@import\b/g) ?? []).length);
        let combined = '';
        for (const match of imports) {
            assert(match[1].startsWith('./') || match[1].startsWith('../'));
            assert(match[1].endsWith('.css'));
            combined += visit(resolve(dirname(path), match[1]));
        }
        return combined + text;
    }
    const css = visit(join(root, 'dist', format, 'react/portal-map.css'));
    for (const selector of [
        '.mx-sdk-portal-map',
        '.mx-sdk-portal-map-card',
        '.mx-sdk-portal-map-open',
        '.mx-sdk-portal-map-review',
        '.mx-sdk-portal-map-pointer',
        '.mx-sdk-finder-map-primary',
        '.mx-sdk-finder-map-primary-empty',
        ':focus-visible',
    ])
        assert(css.includes(selector), selector);
    return [...records.values()];
}

async function headless(directory, format) {
    noBrowserGlobals();
    const consumer = createRequire(join(directory, 'package.json'));
    for (const name of ['react', 'react-dom', ...forbiddenCustomerPackages])
        assertAbsent(consumer, name);
    const root = realpathSync(
        join(directory, 'node_modules/@miniextensions/sdk')
    );
    const manifest = json(join(root, 'package.json'));
    const core = await loadEntry(consumer, root, manifest, '.', format);
    const portals = await loadEntry(
        consumer,
        root,
        manifest,
        './portals',
        format
    );
    assert.equal(core.PortalMap, undefined);
    assert.equal(portals.PortalMap, undefined);
    for (const name of [
        'createPortalMapProviderCoordinator',
        'createPortalMapProviderOwnerScope',
        'bindPortalMapProvider',
        'getPortalMapCoordinates',
    ])
        assert.equal(typeof portals[name], 'function');
    noBrowserGlobals();
    for (const name of ['react', 'react-dom']) assertAbsent(consumer, name);
    return {
        format,
        headlessCoreAndPortals: true,
        reactInstalled: false,
        browserGlobals: false,
    };
}

async function installed(directory, format, archivePath) {
    noBrowserGlobals();
    let networkRequests = 0;
    const fetchDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'fetch'
    );
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value() {
            networkRequests++;
            throw new Error('Network is prohibited in this SSR proof');
        },
    });
    try {
        const consumer = createRequire(join(directory, 'package.json'));
        const root = realpathSync(
            join(directory, 'node_modules/@miniextensions/sdk')
        );
        const manifest = json(join(root, 'package.json'));
        const readPacked = installedArchiveReader(root, archivePath);
        readPacked(join(root, 'package.json'));
        for (const name of forbiddenCustomerPackages) {
            assertAbsent(consumer, name);
            for (const field of [
                'dependencies',
                'optionalDependencies',
                'peerDependencies',
            ])
                assert.equal(Object.hasOwn(manifest[field] ?? {}, name), false);
        }
        assert.equal(manifest.peerDependenciesMeta.react.optional, true);
        assert.equal(manifest.peerDependenciesMeta['react-dom'].optional, true);
        const vendor = checkVendor(root, format, readPacked);
        const cssAssets = checkCss(
            root,
            consumer,
            manifest,
            format,
            readPacked
        );
        const React = consumer('react');
        const { renderToString } = consumer('react-dom/server');
        const sdkRequire = createRequire(join(root, 'package.json'));
        const runtimeRequire = createRequire(
            join(root, 'dist', format, 'react/map/GoogleMapsRuntime.js')
        );
        for (const name of forbiddenCustomerPackages) {
            assertAbsent(sdkRequire, name);
            assertAbsent(runtimeRequire, name);
        }
        const peerPaths = {};
        for (const peer of [
            'react',
            'react/jsx-runtime',
            'react-dom',
            'react-dom/server',
            'react-dom/client',
        ]) {
            assert.equal(
                realpathSync(sdkRequire.resolve(peer)),
                realpathSync(consumer.resolve(peer))
            );
            assert.equal(
                realpathSync(runtimeRequire.resolve(peer)),
                realpathSync(consumer.resolve(peer))
            );
            peerPaths[peer] = realpathSync(consumer.resolve(peer));
        }
        assert.equal(sdkRequire('react'), React);
        assert.equal(sdkRequire('react-dom'), consumer('react-dom'));
        const portals = await loadEntry(
            consumer,
            root,
            manifest,
            './portals',
            format
        );
        const api = await loadEntry(
            consumer,
            root,
            manifest,
            './react',
            format
        );
        noBrowserGlobals();
        assert.equal(typeof api.PortalMap, 'function');
        assert.equal(typeof api.PortalMapCard, 'function');
        assert.equal(typeof api.createGoogleMapsPortalMapDriver, 'function');
        let realmReads = 0,
            inspections = 0,
            loaderCreates = 0,
            acquisitions = 0;
        const defaultDriver = api.createGoogleMapsPortalMapDriver({
            getRealm() {
                realmReads++;
                return null;
            },
        });
        const coordinator = portals.createPortalMapProviderCoordinator({
            inspectRealm() {
                inspections++;
                return defaultDriver.inspectRealm();
            },
            createLoader() {
                loaderCreates++;
                throw new Error('SSR must not construct a loader');
            },
        });
        const owner = portals.createPortalMapProviderOwnerScope().capture();
        const fixtureKey = 'synthetic-package-proof-not-a-provider-key';
        const bound = portals.bindPortalMapProvider(coordinator, owner, {
            apiKey: fixtureKey,
            libraries: ['maps'],
        });
        const provider = Object.freeze({
            ...bound,
            acquire() {
                acquisitions++;
                return bound.acquire();
            },
        });
        const html = renderToString(
            React.createElement(
                React.StrictMode,
                null,
                React.createElement(api.PortalMap, {
                    provider,
                    markers: [],
                    label: 'Map <literal>',
                    loadingLabel: 'Loading <map>',
                    failureLabel: (code) => code,
                })
            )
        );
        assert(html.includes('aria-label="Map &lt;literal&gt;"'));
        assert(html.includes('role="status"'));
        assert(html.includes('Loading &lt;map&gt;'));
        assert(!html.includes(fixtureKey));
        assert(!html.includes('maps.googleapis.com'));
        assert.deepEqual(
            [realmReads, inspections, loaderCreates, acquisitions],
            [0, 0, 0, 0]
        );
        let forbiddenProjectionReads = 0,
            ownerChecks = 0,
            actions = 0,
            registrations = 0;
        const cardOwner = {
            isCurrent() {
                ownerChecks++;
                return true;
            },
        };
        const projection = {
            status: 'present',
            layout: 'map',
            primary: 'Primary <b>literal</b>',
            primaryIsEmpty: false,
        };
        for (const field of ['fields', 'images', 'shouldRenderThumbnail'])
            Object.defineProperty(projection, field, {
                get() {
                    forbiddenProjectionReads++;
                    throw new Error('Map must use primary-only projection');
                },
            });
        const card = {
            recordId: 'one',
            identity: {},
            owner: cardOwner,
            accessibleLabel: 'Card <literal>',
            projection,
            open: {
                label: 'Open <record>',
                activate() {
                    actions++;
                },
                registerTrigger() {
                    registrations++;
                    return () => {};
                },
            },
            needsReviewLabel: 'Needs <review>',
        };
        const cardHtml = renderToString(
            React.createElement(api.PortalMapCard, { card })
        );
        assert(cardHtml.includes('Primary &lt;b&gt;literal&lt;/b&gt;'));
        assert(cardHtml.includes('mx-sdk-finder-map-primary'));
        assert(cardHtml.includes('type="button"'));
        assert(cardHtml.includes('aria-label="Open &lt;record&gt;"'));
        assert(cardHtml.includes('aria-label="Needs &lt;review&gt;"'));
        assert(!/<(?:img|iframe|a)\b/.test(cardHtml));
        const empty = renderToString(
            React.createElement(api.PortalMapCard, {
                card: {
                    ...card,
                    open: null,
                    projection: {
                        status: 'present',
                        layout: 'map',
                        primary: 'Explicit empty',
                        primaryIsEmpty: true,
                    },
                },
            })
        );
        assert(empty.includes('mx-sdk-finder-map-primary-empty'));
        assert(empty.includes('Explicit empty'));
        const loading = renderToString(
            React.createElement(api.PortalMapCard, {
                card: {
                    ...card,
                    open: null,
                    projection: { status: 'loading', label: 'Card loading' },
                },
            })
        );
        assert(loading.includes('Card loading'));
        assert.deepEqual(
            [forbiddenProjectionReads, ownerChecks, actions, registrations],
            [0, 0, 0, 0]
        );
        assert.equal(networkRequests, 0);
        noBrowserGlobals();
        return {
            react: React.version,
            format,
            groups: 5,
            groupNames: [
                'packed-vendor-receipts',
                'physical-peers-and-no-bare-vendors',
                'packed-css-closure',
                'cold-import-and-map-loading-SSR',
                'shared-primary-only-card-SSR',
            ],
            vendor,
            cssAssets,
            peerPaths,
            noGoogleOrDOM: true,
            providerAcquisitions: 0,
            loaderConstructions: 0,
            networkRequests: 0,
            scope: 'Installed packed consumer/type/CSS/provenance and no-DOM SSR only; no provider, hydration, browser, or native acceptance.',
        };
    } finally {
        if (fetchDescriptor)
            Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
        else Reflect.deleteProperty(globalThis, 'fetch');
    }
}

function installCustomer(directory, archivePath, dependencies) {
    mkdirSync(directory);
    const policy = {
        nodeLinker: 'hoisted',
        minimumReleaseAge: 2880,
        minimumReleaseAgeExclude: [],
        blockExoticSubdeps: true,
        strictPeerDependencies: true,
        ignoreScripts: true,
    };
    const policyText =
        Object.entries(policy)
            .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
            .join('\n') + '\n';
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify(
            {
                private: true,
                type: 'module',
                packageManager: 'pnpm@10.28.2',
                dependencies: {
                    '@miniextensions/sdk': 'file:' + archivePath,
                    ...dependencies,
                },
            },
            null,
            2
        )
    );
    writeFileSync(join(directory, 'pnpm-workspace.yaml'), policyText);
    const pnpm = (args) =>
        execFileSync('pnpm', args, {
            cwd: directory,
            encoding: 'utf8',
            timeout: 120000,
            env: { ...process.env, COREPACK_ENABLE_AUTO_PIN: '0' },
        });
    assert.equal(pnpm(['--version']).trim(), '10.28.2');
    for (const [key, value] of Object.entries(policy))
        assert.deepEqual(
            JSON.parse(pnpm(['config', 'get', key, '--json']).trim()),
            value
        );
    pnpm(['install', '--strict-peer-dependencies', '--ignore-scripts']);
    const lockPath = join(directory, 'pnpm-lock.yaml');
    const lockHash = hash(readFileSync(lockPath));
    pnpm([
        'install',
        '--frozen-lockfile',
        '--strict-peer-dependencies',
        '--ignore-scripts',
    ]);
    assert.equal(hash(readFileSync(lockPath)), lockHash);
    assert.equal(
        readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8'),
        policyText
    );
    return {
        customerLockSha256: lockHash,
        frozenLockUnchanged: true,
        policyUnchanged: true,
    };
}

export function checkPortalMapReactMatrix({ archivePath, typescriptBin }) {
    archivePath = resolve(archivePath);
    const archiveSha256 = hash(readFileSync(archivePath));
    const temporary = mkdtempSync(join(tmpdir(), 'sdk-portal-map-'));
    const versions = [],
        headlessProfiles = [];
    const child = (args, directory) =>
        JSON.parse(
            execFileSync(
                process.execPath,
                [fileURLToPath(import.meta.url), ...args],
                {
                    cwd: directory,
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'inherit'],
                    timeout: 120000,
                }
            )
        );
    try {
        const headlessDirectory = join(temporary, 'headless');
        const headlessLock = installCustomer(
            headlessDirectory,
            archivePath,
            {}
        );
        for (const format of ['esm', 'cjs'])
            headlessProfiles.push({
                ...child(
                    ['--headless', headlessDirectory, format],
                    headlessDirectory
                ),
                ...headlessLock,
            });
        for (const version of [
            { react: '18.3.1', types: '18.3.12', domTypes: '18.3.1' },
            { react: '19.2.0', types: '19.2.2', domTypes: '19.2.2' },
        ]) {
            assert.equal(hash(readFileSync(archivePath)), archiveSha256);
            const directory = join(temporary, version.react);
            const lock = installCustomer(directory, archivePath, {
                react: version.react,
                'react-dom': version.react,
                '@types/react': version.types,
                '@types/react-dom': version.domTypes,
                '@types/node': '22.20.5',
            });
            for (const extension of ['mts', 'cts']) {
                const name = 'portal-map.' + extension;
                writeFileSync(join(directory, name), portalMapTypedConsumer);
                execFileSync(
                    process.execPath,
                    [
                        typescriptBin,
                        '--noEmit',
                        '--strict',
                        '--skipLibCheck',
                        'false',
                        '--target',
                        'ES2022',
                        '--module',
                        'NodeNext',
                        '--moduleResolution',
                        'NodeNext',
                        name,
                    ],
                    { cwd: directory, stdio: 'inherit', timeout: 120000 }
                );
            }
            const profiles = ['esm', 'cjs'].map((format) =>
                child(
                    ['--installed', directory, format, archivePath],
                    directory
                )
            );
            for (const profile of profiles) {
                assert.equal(profile.react, version.react);
                assert.equal(profile.groups, 5);
                assert.equal(profile.providerAcquisitions, 0);
                assert.equal(profile.loaderConstructions, 0);
                assert.equal(profile.networkRequests, 0);
                assert.equal(profile.noGoogleOrDOM, true);
            }
            assert.equal(
                profiles[0].vendor.sourceSha256,
                profiles[1].vendor.sourceSha256
            );
            assert.equal(
                profiles[0].vendor.upstreamSha256,
                profiles[1].vendor.upstreamSha256
            );
            assert.equal(
                profiles[0].vendor.licensesSha256,
                profiles[1].vendor.licensesSha256
            );
            assert.equal(
                hash(readFileSync(join(directory, 'pnpm-lock.yaml'))),
                lock.customerLockSha256
            );
            versions.push({ react: version.react, profiles, ...lock });
            console.log(
                `Installed PortalMap React${version.react}: ESM/CJS, strict declarations, packed CSS/vendor/notices, peer identity and no-Google/no-DOM loading/card SSR passed; browser/provider acceptance separate.`
            );
        }
        assert.equal(hash(readFileSync(archivePath)), archiveSha256);
    } finally {
        rmSync(temporary, { recursive: true, force: true });
        assert.equal(existsSync(temporary), false);
    }
    return {
        versions,
        headless: { profiles: headlessProfiles },
        cleanup: 'completed',
        archiveSha256,
    };
}

if (process.argv[2] === '--headless')
    console.log(
        JSON.stringify(await headless(process.argv[3], process.argv[4]))
    );
if (process.argv[2] === '--installed')
    console.log(
        JSON.stringify(
            await installed(process.argv[3], process.argv[4], process.argv[5])
        )
    );
