/** DRAFT fixture source. Integrate beside the existing SDK browser fixtures.
 * Uses packed public SDK APIs and the real default driver. Only the separately
 * routed Google JavaScript response supplies a synthetic provider API.
 */
export const portalMapSyntheticKey = 'PORTAL_MAP_SYNTHETIC_KEY_NEVER_SENT';
export const portalMapPrivateMarker = 'PORTAL_MAP_PRIVATE_UNMODELED_DATA';

export const portalMapBrowserFixture = String.raw`
import React, { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
__PORTAL_MAP_API__

const mode = new URLSearchParams(location.search).get('mode') || 'shared';
const apiKey = 'PORTAL_MAP_SYNTHETIC_KEY_NEVER_SENT';
const privateMarker = 'PORTAL_MAP_PRIVATE_UNMODELED_DATA';
const configuration = Object.freeze({ apiKey });
const stats = { react: React.version, realmReads: 0, acquisitions: 0,
    successfulAcquisitions: 0, refusals: [], opens: [], triggerRegistrations: 0,
    triggerReleases: 0, trustedInputs: [], explicitCardRetirements: 0,
    explicitCardSuccessors: 0, disposed: false };
const leases = [];
const roots = new Map();
const driver = createGoogleMapsPortalMapDriver({
    getRealm() { stats.realmReads++; return window; }
});
const coordinator = createPortalMapProviderCoordinator(driver);

function observedBinding(owner, selected = configuration) {
    const real = bindPortalMapProvider(coordinator, owner, selected);
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
function makeRoot(name, selected = configuration) {
    if (roots.get(name)?.mounted) throw Error('Fixture root already mounted');
    const host = document.createElement('div');
    host.className = 'portal-map-proof-root'; host.dataset.proofRoot = name;
    document.querySelector('main').append(host);
    const providerOwner = createPortalMapProviderOwnerScope();
    const cardOwner = createPortalMapProviderOwnerScope();
    const item = { name, host, root: createRoot(host), providerOwner, cardOwner,
        provider: observedBinding(providerOwner.capture(), selected), mounted: true,
        currentCardOwner: cardOwner.capture(), identity: {}, rows: initialRows(name),
        patch: null, echo: 0 };
    roots.set(name, item);
    const activate = (row) => () => stats.opens.push({ root: name, record: row.key });
    function card(row, owner, identity) {
        return { recordId: row.key, identity, owner,
            accessibleLabel: 'Record ' + row.label,
            projection: { status: 'present', layout: 'map', primary: row.label,
                primaryIsEmpty: false, unrecognizedHiddenField: privateMarker },
            unrecognizedPrivateData: privateMarker,
            open: { label: 'Open ' + row.label, activate: activate(row),
                registerTrigger(element) {
                    stats.triggerRegistrations++;
                    if (!(element instanceof HTMLButtonElement))
                        throw Error('Actual SDK trigger required');
                    let released = false;
                    return () => { if (!released) { released = true; stats.triggerReleases++; } };
                } }, needsReviewLabel: 'Review required' };
    }
    function App() {
        const [state, setState] = useState({ rows: item.rows,
            owner: item.currentCardOwner, identity: item.identity, echo: 0 });
        item.patch = (change) => flushSync(() => setState(old => {
            const next = { ...old, ...change }; item.rows = next.rows;
            item.currentCardOwner = next.owner; item.identity = next.identity;
            item.echo = next.echo; return next;
        }));
        return h(PortalMap, { provider: item.provider,
            markers: state.rows.map(row => ({ key: row.key,
                position: { lat: row.lat, lng: row.lng },
                card: card(row, state.owner, state.identity) })),
            label: 'Portal Map ' + name, loadingLabel: 'Synthetic Map loading',
            failureLabel: code => 'Synthetic Map unavailable: ' + code });
    }
    flushSync(() => item.root.render(h(React.StrictMode, null, h(App))));
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
window.portalMapProof = {
    snapshot: safeSnapshot,
    beforeLoadRows() {
        setRows('first', [
            { key: 'first-current-1', label: 'first current one', lat: 3, lng: 4 },
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
    mountConflict() { makeRoot('conflict', { apiKey, language: 'fr' }); },
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
        }
        window.portalMapGoogleBoundary?.flush();
        window.portalMapGoogleBoundary?.flushLateDraws();
        return safeSnapshot();
    }
};
makeRoot('first');
if (mode === 'shared' || mode === 'deferred') makeRoot('second');
`;
