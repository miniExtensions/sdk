/** DRAFT fixture source. Integrate beside the existing SDK browser fixtures.
 * Uses packed public SDK APIs and the real default driver. Only the separately
 * routed Google JavaScript response supplies a synthetic provider API.
 */
export const portalMapSyntheticKey = 'PORTAL_MAP_SYNTHETIC_KEY_NEVER_SENT';
export const portalMapPrivateMarker = 'PORTAL_MAP_PRIVATE_UNMODELED_DATA';

/** Identical public-props recipe for the actual Node SSR and browser hydration. */
export const portalMapPropsFactory = String.raw`
function makePortalMapProps({ name, provider, rows, owner, identity, privateMarker, onOpen, registerTrigger }) {
    return { provider,
        markers: rows.map(row => ({ key: row.key,
            position: row.position ?? { lat: row.lat, lng: row.lng },
            card: { recordId: row.recordId ?? row.key, identity, owner,
                accessibleLabel: 'Record ' + row.label,
                projection: { status: 'present', layout: 'map', primary: row.label,
                    primaryIsEmpty: false, unrecognizedHiddenField: privateMarker },
                unrecognizedPrivateData: privateMarker,
                open: { label: 'Open ' + row.label, activate: () => onOpen(row), registerTrigger },
                needsReviewLabel: 'Review required' }
        })),
        label: 'Portal Map ' + name, loadingLabel: 'Synthetic Map loading',
        failureLabel: code => 'Synthetic Map unavailable: ' + code };
}
function portalMapPropsSignature(props) {
    return { label: props.label, loadingLabel: props.loadingLabel,
        failureLabel: props.failureLabel('provider-failed'),
        providerHasAcquire: typeof props.provider.acquire === 'function',
        markers: props.markers.map(marker => ({ key: marker.key, position: marker.position,
            recordId: marker.card.recordId, accessibleLabel: marker.card.accessibleLabel,
            layout: marker.card.projection.layout, primary: marker.card.projection.primary,
            primaryIsEmpty: marker.card.projection.primaryIsEmpty,
            openLabel: marker.card.open.label, needsReviewLabel: marker.card.needsReviewLabel,
            hasOpenCallback: typeof marker.card.open.activate === 'function',
            hasRegisterTrigger: typeof marker.card.open.registerTrigger === 'function' })) };
}
`;

/** Executed only by the owning checker in a bounded Node child inside its consumer. */
export const portalMapNodeSSRFixture = String.raw`
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
__PORTAL_MAP_PROPS_FACTORY__
const absent = () => ['window', 'document', 'google', 'HTMLElement'].every(name => !(name in globalThis));
assert(absent(), 'SSR must begin without DOM/provider globals');
const stats = { acquisitions: 0, inspections: 0, constructions: 0, realmReads: 0,
    networkAttempts: 0, triggerRegistrations: 0, opens: 0, consoleErrors: 0, consoleWarnings: 0 };
console.error = () => { stats.consoleErrors++; };
console.warn = () => { stats.consoleWarnings++; };
globalThis.fetch = () => { stats.networkAttempts++; throw Error('SSR network forbidden'); };
const require = createRequire(join(dirname(dirname(fileURLToPath(import.meta.url))), 'package.json'));
const React = require('react');
const { renderToString } = require('react-dom/server');
const format = process.argv[2];
assert(['esm', 'cjs'].includes(format));
const reactAPI = format === 'esm' ? await import('@miniextensions/sdk/react') : require('@miniextensions/sdk/react');
const portals = format === 'esm' ? await import('@miniextensions/sdk/portals') : require('@miniextensions/sdk/portals');
const sdkRequire = createRequire(join(dirname(dirname(fileURLToPath(import.meta.url))), 'node_modules/@miniextensions/sdk/package.json'));
assert.equal(sdkRequire('react'), React, 'SSR SDK shares installed React');
assert.equal(sdkRequire('react-dom/server'), require('react-dom/server'));
const realDriver = reactAPI.createGoogleMapsPortalMapDriver({ getRealm() {
    stats.realmReads++; throw Error('SSR must not inspect realm');
} });
const coordinator = portals.createPortalMapProviderCoordinator({
    inspectRealm(configuration) { stats.inspections++; return realDriver.inspectRealm(configuration); },
    createLoader(configuration) { stats.constructions++; return realDriver.createLoader(configuration); }
});
const providerOwner = portals.createPortalMapProviderOwnerScope();
const realBinding = portals.bindPortalMapProvider(coordinator, providerOwner.capture(), { apiKey: 'PORTAL_MAP_SYNTHETIC_KEY_NEVER_SENT' });
const provider = Object.freeze({ ...realBinding, acquire() { stats.acquisitions++; return realBinding.acquire(); } });
const cardOwner = portals.createPortalMapProviderOwnerScope();
const props = makePortalMapProps({ name: 'first', provider,
    rows: [{ key: 'first-initial', label: 'first initial', lat: 1, lng: 2 }],
    owner: cardOwner.capture(), identity: {}, privateMarker: 'PORTAL_MAP_PRIVATE_UNMODELED_DATA',
    onOpen() { stats.opens++; }, registerTrigger() { stats.triggerRegistrations++; throw Error('SSR trigger forbidden'); }
});
const markup = renderToString(React.createElement(React.StrictMode, null, React.createElement(reactAPI.PortalMap, props)));
assert(markup.includes('Synthetic Map loading'));
assert(!markup.includes('first initial') && !markup.includes('PORTAL_MAP_PRIVATE_UNMODELED_DATA') &&
    !markup.includes('PORTAL_MAP_SYNTHETIC_KEY_NEVER_SENT'), 'SSR output excludes row/private/provider data');
assert(absent(), 'SSR must finish without DOM/provider globals');
assert(Object.values(stats).every(count => count === 0), 'SSR performed a forbidden side effect');
process.stdout.write(JSON.stringify({ format, react: React.version, markup, stats,
    propsSignature: portalMapPropsSignature(props),
    noDOMBeforeAndAfter: true, samePhysicalReactPeer: true }));
`;

export const portalMapBrowserFixture = String.raw`
import React, { createElement as h, useState } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
__PORTAL_MAP_API__
__PORTAL_MAP_FOREIGN_API__
__PORTAL_MAP_PROPS_FACTORY__

const mode = new URLSearchParams(location.search).get('mode') || 'shared';
const apiKey = 'PORTAL_MAP_SYNTHETIC_KEY_NEVER_SENT';
const privateMarker = 'PORTAL_MAP_PRIVATE_UNMODELED_DATA';
const configuration = Object.freeze({ apiKey });
const stats = { react: React.version, realmReads: 0, acquisitions: 0,
    successfulAcquisitions: 0, refusals: [], opens: [], triggerRegistrations: 0,
    triggerReleases: 0, trustedInputs: [], submits: 0, explicitCardRetirements: 0,
    explicitCardSuccessors: 0, disposed: false,
    copiesDistinct: PortalMap !== ForeignPortalMap && bindPortalMapProvider !== foreignBindPortalMapProvider &&
        createPortalMapProviderOwnerScope !== foreignCreatePortalMapProviderOwnerScope,
    bindingCopies: [], foreignOwnerABA: null,
    hydrationStarted: false, recoverableHydrationErrors: 0,
    privateInHydrationError: false };
const leases = [];
const roots = new Map();
const driver = createGoogleMapsPortalMapDriver({
    getRealm() { stats.realmReads++; return window; }
});
const coordinator = createPortalMapProviderCoordinator(driver);

function observedBinding(owner, selected = configuration, copy = 'primary') {
    const bind = copy === 'foreign' ? foreignBindPortalMapProvider : bindPortalMapProvider;
    const real = bind(coordinator, owner, selected);
    stats.bindingCopies.push({ copy, sharedCoordinator: real.coordinator === coordinator });
    return Object.freeze({ ...real, acquire() {
        stats.acquisitions++;
        const result = real.acquire();
        if (result.kind === 'lease') {
            leases.push(result.lease); stats.successfulAcquisitions++;
        } else stats.refusals.push(result.code);
        return result;
    } });
}
function initialRows(name) {
    if (mode === 'empty' || mode === 'failure' || mode === 'unmanaged') return [];
    return [{ key: name + '-initial', label: name + ' initial', lat: 1, lng: 2 }];
}
let serverSection = null, serverLoading = null;
function makeRoot(name, selected = configuration, copy = 'primary', hydration = false) {
    if (roots.get(name)?.mounted) throw Error('Fixture root already mounted');
    const host = hydration ? document.querySelector('[data-proof-root="first"]') : document.createElement('div');
    if (!(host instanceof HTMLElement)) throw Error('Actual server root required');
    if (!hydration) {
        host.className = 'portal-map-proof-root'; host.dataset.proofRoot = name;
        document.querySelector('main').append(host);
    }
    const createOwner = copy === 'foreign' ? foreignCreatePortalMapProviderOwnerScope : createPortalMapProviderOwnerScope;
    const Component = copy === 'foreign' ? ForeignPortalMap : PortalMap;
    const providerOwner = createOwner();
    const cardOwner = createOwner();
    const item = { name, copy, host, root: null, providerOwner, cardOwner,
        provider: observedBinding(providerOwner.capture(), selected, copy), mounted: !hydration,
        currentCardOwner: cardOwner.capture(), identity: {}, rows: initialRows(name),
        patch: null, echo: 0 };
    roots.set(name, item);
    const registerTrigger = element => {
        stats.triggerRegistrations++;
        if (!(element instanceof HTMLButtonElement)) throw Error('Actual SDK trigger required');
        if (!element.isConnected) throw Error('Connected SDK trigger required');
        let released = false;
        return () => { if (!released) { released = true; stats.triggerReleases++; } };
    };
    const propsFor = state => makePortalMapProps({ name, provider: item.provider,
        rows: state.rows, owner: state.owner, identity: state.identity, privateMarker,
        onOpen: row => stats.opens.push({ root: name, record: row.recordId ?? row.key }), registerTrigger });
    item.initialPropsSignature = portalMapPropsSignature(propsFor({ rows: item.rows,
        owner: item.currentCardOwner, identity: item.identity }));
    function App() {
        const [state, setState] = useState({ rows: item.rows,
            owner: item.currentCardOwner, identity: item.identity, echo: 0 });
        item.patch = (change) => flushSync(() => setState(old => {
            const next = { ...old, ...change }; item.rows = next.rows;
            item.currentCardOwner = next.owner; item.identity = next.identity;
            item.echo = next.echo; return next;
        }));
        return h(Component, propsFor(state));
    }
    if (hydration) item.beginHydration = () => {
        if (stats.hydrationStarted || item.mounted) throw Error('Hydration already started');
        stats.hydrationStarted = true; item.mounted = true;
        item.root = hydrateRoot(host, h(React.StrictMode, null, h(App)), {
            onRecoverableError(error) {
                stats.recoverableHydrationErrors++;
                const message = String(error?.message ?? error);
                stats.privateInHydrationError ||= message.includes(apiKey) || message.includes(privateMarker);
            }
        });
    };
    else {
        item.root = createRoot(host);
        flushSync(() => item.root.render(h(React.StrictMode, null, h(App))));
    }
    return item;
}
function requireRoot(name) {
    const item = roots.get(name);
    if (!item?.mounted || !item.patch) throw Error('Missing owned fixture root');
    return item;
}
function setRows(name, rows) { requireRoot(name).patch({ rows }); }
function unmount(name) {
    const item = roots.get(name);
    if (!item?.mounted) return false;
    item.mounted = false;
    flushSync(() => item.root.unmount());
    item.host.remove();
    return true;
}
function safeSnapshot() {
    return { ...structuredClone(stats),
        mounted: [...roots.values()].filter(item => item.mounted).map(item => item.name),
        rootCopies: [...roots.values()].filter(item => item.mounted).map(item => ({ name: item.name, copy: item.copy })),
        hydrationPropsSignature: mode === 'hydrate' ? roots.get('first')?.initialPropsSignature ?? null : null,
        serverSectionPreserved: serverSection ? document.querySelector('[data-proof-root="first"] > section') === serverSection : null,
        serverLoadingPreserved: serverLoading ? serverSection?.querySelector('[role="status"]') === serverLoading : null,
        rows: [...roots.values()].filter(item => item.mounted).map(item => ({
            root: item.name, visible: item.rows.map(row => ({
                key: row.key, label: row.label, lat: row.lat, lng: row.lng })) })),
        leaseStatuses: leases.map(lease => coordinator.getSnapshot(lease).status),
        scripts: [...document.scripts].filter(script => {
            try { return new URL(script.src).origin === 'https://maps.googleapis.com'; }
            catch { return false; }
        }).length,
        googlePresent: Boolean(window.google?.maps) };
}
document.addEventListener('keydown', event => {
    if (event.target.closest?.('.mx-sdk-portal-map'))
        stats.trustedInputs.push(event.isTrusted);
});
document.addEventListener('click', event => {
    if (event.target.closest?.('.mx-sdk-portal-map'))
        stats.trustedInputs.push(event.isTrusted);
});
document.addEventListener('submit', () => stats.submits++, true);
let watchedOpen = null;
let openEvents = [];
for (const type of ['pointerdown', 'pointerup', 'keydown', 'keyup', 'click']) {
    document.addEventListener(type, event => {
        if (watchedOpen?.contains(event.target)) openEvents.push({
            type, trusted: event.isTrusted, key: event.key ?? null,
            detail: event.detail ?? null,
        });
    }, true);
}
window.portalMapProof = {
    snapshot: safeSnapshot,
    watchOpen(button) { watchedOpen = button; openEvents = []; },
    openEvents() { return openEvents.slice(); },
    replaceOpenRecord(recordId) {
        const item = requireRoot('first');
        const [row, ...rest] = item.rows;
        item.cardOwner.advance();
        item.patch({ rows: [{ ...row, recordId }, ...rest],
            owner: item.cardOwner.capture(), identity: {} });
        return { marker: row.key, recordId: item.rows[0].recordId };
    },
    beforeLoadRows() {
        setRows('first', [
            // Keep the provider overlay in place when only the Open record changes.
            { key: 'first-current-1', label: 'first current one', lat: 3, lng: 4,
                position: { lat: 3, lng: 4 } },
            { key: 'first-current-2', label: 'first current two', lat: 5, lng: 6 }
        ]);
        const second = roots.get('second');
        if (second?.mounted) setRows('second', [
            { key: 'second-current', label: 'second current', lat: 7, lng: 8 }
        ]);
    },
    laterRows(name = 'first') { setRows(name, [
        { key: name + '-later', label: name + ' later', lat: 9, lng: 10 }
    ]); },
    retireCardOwner(name = 'first') {
        requireRoot(name).cardOwner.advance(); stats.explicitCardRetirements++;
    },
    acceptCardSuccessor(name = 'first') {
        const item = requireRoot(name);
        item.patch({ owner: item.cardOwner.capture(), identity: item.identity });
        stats.explicitCardSuccessors++;
    },
    identityABA(name = 'first') {
        const item = requireRoot(name), old = item.identity;
        item.patch({ identity: {} }); item.patch({ identity: old });
    },
    echo(name = 'first') {
        const item = requireRoot(name); item.patch({ echo: item.echo + 1 });
    },
    unmount,
    retireProvider(name = 'first') {
        const item = roots.get(name); if (!item) throw Error('Missing provider owner');
        item.providerOwner.retire(); unmount(name);
    },
    mountEqual(name = 'successor') { makeRoot(name); },
    mountForeignEqual(name = 'foreign-successor') { makeRoot(name, configuration, 'foreign'); },
    mountConflict() { makeRoot('conflict', { apiKey, language: 'fr' }); },
    mountForeignConflict() { makeRoot('foreign-conflict', { apiKey, language: 'fr' }, 'foreign'); },
    foreignProviderOwnerABA() {
        const item = requireRoot('second');
        if (item.copy !== 'foreign') throw Error('Foreign root required');
        const oldOwner = item.provider.owner;
        item.providerOwner.advance();
        const successor = item.providerOwner.capture();
        const next = observedBinding(successor, configuration, 'foreign').acquire();
        const replay = observedBinding(oldOwner, configuration, 'foreign').acquire();
        stats.foreignOwnerABA = {
            oldOwnerCurrent: oldOwner.isCurrent(), successorCurrent: successor.isCurrent(),
            successorKind: next.kind,
            successorStatus: next.kind === 'lease' ? coordinator.getSnapshot(next.lease).status : next.code,
            replayKind: replay.kind, replayCode: replay.kind === 'refused' ? replay.code : null
        };
        if (next.kind === 'lease') coordinator.release(next.lease);
        if (replay.kind === 'lease') coordinator.release(replay.lease);
        item.patch({ echo: item.echo + 1 });
    },
    beginHydration() {
        const item = roots.get('first');
        if (mode !== 'hydrate' || !item?.beginHydration) throw Error('Prepared SSR root required');
        item.beginHydration();
    },
    privacy() {
        const sections = [...document.querySelectorAll('.mx-sdk-portal-map')];
        return { privateInVisibleText: document.body.innerText.includes(privateMarker),
            privateInSections: sections.some(node => node.outerHTML.includes(privateMarker)),
            keyInVisibleText: document.body.innerText.includes(apiKey),
            keyInSections: sections.some(node => node.outerHTML.includes(apiKey)),
            keyInSnapshot: JSON.stringify(safeSnapshot()).includes(apiKey) };
    },
    dispose() {
        stats.disposed = true;
        for (const item of roots.values()) {
            item.providerOwner.retire(); item.cardOwner.retire(); unmount(item.name);
            if (!item.root) item.host.remove();
        }
        window.portalMapGoogleBoundary?.flush();
        window.portalMapGoogleBoundary?.flushLateDraws();
        return safeSnapshot();
    }
};
if (mode === 'hydrate') {
    serverSection = document.querySelector('[data-proof-root="first"] > section');
    serverLoading = serverSection?.querySelector('[role="status"]');
    if (!serverSection || !serverLoading) throw Error('Actual server loading markup required');
    makeRoot('first', configuration, 'primary', true);
} else {
    makeRoot('first');
    if (mode === 'shared' || mode === 'deferred') makeRoot('second');
    if (mode === 'mixed') makeRoot('second', configuration, 'foreign');
}
`;
