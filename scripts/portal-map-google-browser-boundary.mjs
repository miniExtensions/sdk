/**
 * Synthetic response body for the real Loader 1.16.8 Google JavaScript request.
 * Importing this module only returns source; it does not install a provider.
 * Fulfill the actual intercepted request after Loader has created maps.__ib__.
 * The real @react-google-maps/api GoogleMap and OverlayViewF remain unchanged.
 */
export const portalMapGoogleBrowserBoundary = String.raw`(() => {
    'use strict';

    const googleGlobal = window.google;
    const maps = googleGlobal && googleGlobal.maps;
    const bootstrapCallback = maps && maps.__ib__;
    if (!maps || typeof bootstrapCallback !== 'function') {
        throw new Error('Synthetic map boundary requires the Loader bootstrap callback.');
    }
    if (Object.prototype.hasOwnProperty.call(window, 'portalMapGoogleBoundary')) {
        throw new Error('Synthetic map boundary is already installed.');
    }
    if (typeof maps.Map === 'function' || typeof maps.OverlayView === 'function') {
        throw new Error('Synthetic map boundary requires an unpopulated provider namespace.');
    }

    const paneNames = Object.freeze([
        'mapPane',
        'overlayLayer',
        'markerLayer',
        'overlayMouseTarget',
        'floatPane',
    ]);
    const mapStates = [];
    const overlayStates = [];
    const listenerStates = [];
    const mapsByInstance = new WeakMap();
    const overlaysByInstance = new WeakMap();
    const listenersByHandle = new WeakMap();
    const pendingAttachments = [];
    const pendingLateDraws = [];
    const lateDrawCaptures = [];
    let deferred = false;
    const totals = {
        attachmentCallbacksRun: 0,
        attachmentCallbacksPrevented: 0,
        lateDrawCallbacksRun: 0,
        lateDrawCallbacksPrevented: 0,
    };

    function numericCoordinate(value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new TypeError('Synthetic map coordinates must be finite numbers.');
        }
        return value;
    }

    function pointOf(value) {
        if (!value || typeof value !== 'object') {
            throw new TypeError('Synthetic map position is required.');
        }
        const lat = typeof value.lat === 'function' ? value.lat() : value.lat;
        const lng = typeof value.lng === 'function' ? value.lng() : value.lng;
        return { lat: numericCoordinate(lat), lng: numericCoordinate(lng) };
    }

    class FakeLatLng {
        constructor(lat, lng) {
            const point = typeof lat === 'object' && lat !== null
                ? pointOf(lat)
                : { lat: numericCoordinate(lat), lng: numericCoordinate(lng) };
            this.lat = () => point.lat;
            this.lng = () => point.lng;
        }

        equals(other) {
            if (!other) return false;
            const point = pointOf(other);
            return this.lat() === point.lat && this.lng() === point.lng;
        }

        toJSON() {
            return { lat: this.lat(), lng: this.lng() };
        }

        toString() {
            return '(' + this.lat() + ', ' + this.lng() + ')';
        }
    }

    const boundsPoints = new WeakMap();
    class FakeLatLngBounds {
        constructor(southWest, northEast) {
            boundsPoints.set(this, []);
            if (southWest !== undefined) this.extend(southWest);
            if (northEast !== undefined) this.extend(northEast);
        }

        extend(point) {
            boundsPoints.get(this).push(pointOf(point));
            return this;
        }

        isEmpty() {
            return boundsPoints.get(this).length === 0;
        }

        getSouthWest() {
            const points = boundsPoints.get(this);
            if (!points.length) return undefined;
            return new FakeLatLng(
                Math.min(...points.map((point) => point.lat)),
                Math.min(...points.map((point) => point.lng))
            );
        }

        getNorthEast() {
            const points = boundsPoints.get(this);
            if (!points.length) return undefined;
            return new FakeLatLng(
                Math.max(...points.map((point) => point.lat)),
                Math.max(...points.map((point) => point.lng))
            );
        }

        toJSON() {
            const southWest = this.getSouthWest();
            const northEast = this.getNorthEast();
            return southWest && northEast ? {
                south: southWest.lat(),
                west: southWest.lng(),
                north: northEast.lat(),
                east: northEast.lng(),
            } : null;
        }

        toString() {
            const southWest = this.getSouthWest();
            const northEast = this.getNorthEast();
            return southWest && northEast
                ? '(' + southWest.toString() + ', ' + northEast.toString() + ')'
                : '(empty)';
        }
    }

    const projection = Object.freeze({
        fromLatLngToDivPixel(value) {
            const point = pointOf(value);
            return { x: 300 + point.lng * 10, y: 200 + point.lat * 10 };
        },
        fromDivPixelToLatLng(value) {
            return new FakeLatLng(
                (numericCoordinate(value.y) - 200) / 10,
                (numericCoordinate(value.x) - 300) / 10
            );
        },
    });

    function removeListener(handle) {
        const state = listenersByHandle.get(handle);
        if (!state || !state.active) return;
        state.active = false;
        if (state.domTarget) {
            state.domTarget.removeEventListener(state.eventName, state.domHandler);
        }
    }

    function registerListener(target, eventName, callback, once, dom) {
        if (!target || typeof callback !== 'function' || typeof eventName !== 'string') {
            throw new TypeError('Synthetic map listener requires a target, event and callback.');
        }
        if (dom && (typeof target.addEventListener !== 'function'
            || typeof target.removeEventListener !== 'function')) {
            throw new TypeError('Synthetic DOM listener requires an EventTarget.');
        }
        const state = {
            id: listenerStates.length + 1,
            target,
            eventName,
            callback,
            once,
            active: true,
            domTarget: dom ? target : null,
            domHandler: null,
            handle: null,
        };
        const handle = Object.freeze({ remove: () => removeListener(handle) });
        state.handle = handle;
        if (dom) {
            state.domHandler = function () {
                if (!state.active) return;
                if (state.once) removeListener(handle);
                state.callback.apply(state.target, arguments);
            };
            target.addEventListener(eventName, state.domHandler);
        }
        listenerStates.push(state);
        listenersByHandle.set(handle, state);
        return handle;
    }

    const event = Object.freeze({
        addListener: (target, name, callback) => registerListener(target, name, callback, false, false),
        addListenerOnce: (target, name, callback) => registerListener(target, name, callback, true, false),
        addDomListener: (target, name, callback) => registerListener(target, name, callback, false, true),
        addDomListenerOnce: (target, name, callback) => registerListener(target, name, callback, true, true),
        removeListener,
        clearListeners(target, name) {
            for (const state of listenerStates) {
                if (state.target === target && state.eventName === name) removeListener(state.handle);
            }
        },
        clearInstanceListeners(target) {
            for (const state of listenerStates) {
                if (state.target === target) removeListener(state.handle);
            }
        },
        hasListeners(target, name) {
            return listenerStates.some((state) => state.active
                && state.target === target && state.eventName === name);
        },
        trigger(target, name, ...args) {
            const matching = listenerStates.filter((state) => state.active
                && state.target === target && state.eventName === name);
            for (const state of matching) {
                if (!state.active) continue;
                if (state.once) removeListener(state.handle);
                state.callback.apply(target, args);
            }
        },
    });

    class FakeMap {
        constructor(div, options) {
            if (!(div instanceof HTMLElement)) {
                throw new TypeError('Synthetic map requires a real HTMLElement.');
            }
            const state = {
                id: mapStates.length + 1,
                instance: this,
                div,
                panes: Object.create(null),
                flags: { fullscreenControl: null, streetViewControl: null },
                setOptionsCalls: 0,
                fits: [],
            };
            mapStates.push(state);
            mapsByInstance.set(this, state);
            // Provider-owned pane structure only. No dimensions or overlay DOM are fabricated.
            if (!div.style.position) div.style.position = 'relative';
            for (const name of paneNames) {
                const pane = document.createElement('div');
                pane.setAttribute('data-portal-map-google-pane', name);
                pane.setAttribute('data-portal-map-google-map-id', String(state.id));
                pane.style.position = 'absolute';
                pane.style.inset = '0px';
                pane.style.pointerEvents = name === 'overlayMouseTarget' ? 'auto' : 'none';
                state.panes[name] = pane;
                div.appendChild(pane);
            }
            this.setOptions(options);
        }

        setOptions(options) {
            const state = mapsByInstance.get(this);
            state.setOptionsCalls += 1;
            // Intentionally never retain arbitrary provider options, keys or credentials.
            for (const name of ['fullscreenControl', 'streetViewControl']) {
                if (options && typeof options[name] === 'boolean') state.flags[name] = options[name];
            }
        }

        fitBounds(bounds) {
            const points = boundsPoints.get(bounds);
            if (!points) throw new TypeError('Synthetic fitBounds requires synthetic LatLngBounds.');
            mapsByInstance.get(this).fits.push(points.map((point) => ({ ...point })));
        }

        getDiv() {
            return mapsByInstance.get(this).div;
        }

        getProjection() {
            return projection;
        }

        addListener(name, callback) {
            return event.addListener(this, name, callback);
        }
    }

    function callLifecycle(state, name, callback) {
        const fn = callback || state.instance[name];
        if (typeof fn !== 'function') return false;
        state[name + 'Calls'] += 1;
        fn.call(state.instance);
        return true;
    }

    function attachmentIsCurrent(entry) {
        return entry.state.generation === entry.generation
            && entry.state.map === entry.map && !entry.state.attached;
    }

    function attach(entry) {
        if (!attachmentIsCurrent(entry)) {
            totals.attachmentCallbacksPrevented += 1;
            return false;
        }
        const state = entry.state;
        state.attached = true;
        totals.attachmentCallbacksRun += 1;
        callLifecycle(state, 'onAdd');
        // onAdd is application code and could synchronously detach or change maps.
        if (state.generation === entry.generation && state.map === entry.map && state.attached) {
            callLifecycle(state, 'draw');
        }
        return true;
    }

    class FakeOverlayView {
        constructor() {
            const state = {
                id: overlayStates.length + 1,
                instance: this,
                map: null,
                attached: false,
                generation: 0,
                setMapCalls: 0,
                onAddCalls: 0,
                drawCalls: 0,
                onRemoveCalls: 0,
            };
            overlayStates.push(state);
            overlaysByInstance.set(this, state);
            // No DOM is allocated or attached here. Vendor subclasses own their container.
        }

        setMap(map) {
            const state = overlaysByInstance.get(this);
            if (map !== null && !mapsByInstance.has(map)) {
                throw new TypeError('Synthetic overlay requires a synthetic map or null.');
            }
            state.setMapCalls += 1;
            if (state.map === map) return;
            state.generation += 1;
            const previousMap = state.map;
            state.attached = false;
            // Invalidate pending attachment work without running vendor DOM callbacks.
            for (let index = pendingAttachments.length - 1; index >= 0; index -= 1) {
                if (pendingAttachments[index].state === state) {
                    pendingAttachments.splice(index, 1);
                    totals.attachmentCallbacksPrevented += 1;
                }
            }
            if (previousMap !== null) {
                // The vendor onRemove performs removal; listener records are never auto-cleared.
                try {
                    callLifecycle(state, 'onRemove');
                } finally {
                    state.map = null;
                }
            }
            if (map === null) return;
            state.map = map;
            const entry = { state, map, generation: state.generation };
            if (deferred) pendingAttachments.push(entry);
            else attach(entry);
        }

        getMap() {
            return overlaysByInstance.get(this).map;
        }

        getPanes() {
            const state = overlaysByInstance.get(this);
            return state.map ? mapsByInstance.get(state.map).panes : null;
        }

        getProjection() {
            return overlaysByInstance.get(this).map ? projection : null;
        }

        addListener(name, callback) {
            return event.addListener(this, name, callback);
        }
    }

    function containerOf(state) {
        const container = state.instance.container;
        return container instanceof HTMLElement ? container : null;
    }

    function sectionLabelOf(div) {
        const section = div.closest('section');
        return section ? section.getAttribute('aria-label') : null;
    }

    function listenerTargetOf(target) {
        const map = mapsByInstance.get(target);
        if (map) return { kind: 'map', id: map.id };
        const overlay = overlaysByInstance.get(target);
        if (overlay) return { kind: 'overlay', id: overlay.id };
        return { kind: target instanceof EventTarget ? 'dom' : 'other', id: null };
    }

    function lateDrawIsCurrent(entry) {
        return entry.state.generation === entry.generation
            && entry.state.map === entry.map && entry.state.attached
            && entry.state.instance.draw === entry.callback;
    }

    function snapshot() {
        const connectedContainers = new Set();
        const activeConnectedContainers = new Set();
        const overlaySnapshots = overlayStates.map((state) => {
            const container = containerOf(state);
            const map = state.map && mapsByInstance.get(state.map);
            const connected = Boolean(container && container.isConnected);
            const active = state.attached && state.map !== null;
            if (connected) connectedContainers.add(container);
            if (connected && active) activeConnectedContainers.add(container);
            return {
                id: state.id,
                mapId: map ? map.id : null,
                generation: state.generation,
                status: active ? 'attached' : state.map ? 'pending' : 'detached',
                containerPresent: container !== null,
                connected,
                containerConnected: connected,
                parentPane: map && container
                    ? paneNames.find((name) => map.panes[name] === container.parentNode) || null
                    : null,
                setMapCalls: state.setMapCalls,
                onAddCalls: state.onAddCalls,
                drawCalls: state.drawCalls,
                onRemoveCalls: state.onRemoveCalls,
            };
        });
        return {
            deferred,
            constructedMapCount: mapStates.length,
            connectedMapCount: mapStates.filter((state) => state.div.isConnected).length,
            constructedOverlayCount: overlayStates.length,
            activeOverlayCount: overlayStates.filter((state) => state.attached && state.map !== null).length,
            pendingOverlayCount: overlayStates.filter((state) => !state.attached && state.map !== null).length,
            connectedOverlayDivCount: connectedContainers.size,
            activeConnectedOverlayDivCount: activeConnectedContainers.size,
            overlayInstancesWithConnectedDivCount: overlaySnapshots.filter((state) => state.containerConnected).length,
            constructedListenerCount: listenerStates.length,
            activeListenerCount: listenerStates.filter((state) => state.active).length,
            maps: mapStates.map((state) => ({
                id: state.id,
                label: sectionLabelOf(state.div),
                sectionAriaLabel: sectionLabelOf(state.div),
                connected: state.div.isConnected,
                flags: { ...state.flags },
                options: { ...state.flags },
                setOptionsCalls: state.setOptionsCalls,
                fits: state.fits.map((points) => points.map((point) => ({ ...point }))),
                paneCount: paneNames.length,
                connectedPaneCount: paneNames.filter((name) => state.panes[name].isConnected).length,
                panes: paneNames.map((name) => ({
                    name,
                    connected: state.panes[name].isConnected,
                    childElementCount: state.panes[name].childElementCount,
                })),
            })),
            overlays: overlaySnapshots,
            listeners: listenerStates.map((state) => ({
                id: state.id,
                target: listenerTargetOf(state.target),
                eventName: state.eventName,
                once: state.once,
                active: state.active,
                dom: state.domTarget !== null,
            })),
            pendingQueues: {
                attachments: pendingAttachments.length,
                currentAttachments: pendingAttachments.filter(attachmentIsCurrent).length,
                lateDraws: pendingLateDraws.length,
                currentLateDraws: pendingLateDraws.filter(lateDrawIsCurrent).length,
                capturedLateDraws: lateDrawCaptures.reduce((count, capture) => count + capture.entries.length, 0),
                captureCount: lateDrawCaptures.length,
            },
            totals: { ...totals },
            bootstrapCallbackPreserved: window.google === googleGlobal
                && window.google.maps === maps && maps.__ib__ === bootstrapCallback,
        };
    }

    function flushLateDraws() {
        let lateDrawnCount = 0;
        const lateDraws = pendingLateDraws.splice(0);
        for (const entry of lateDraws) {
            if (!lateDrawIsCurrent(entry)) {
                totals.lateDrawCallbacksPrevented += 1;
                continue;
            }
            if (callLifecycle(entry.state, 'draw', entry.callback)) {
                totals.lateDrawCallbacksRun += 1;
                lateDrawnCount += 1;
            }
        }
        return { lateDrawnCount, totals: { ...totals } };
    }

    const proof = Object.freeze({
        snapshot,
        draw() {
            // These reads ask the browser for real layout; dimensions are never replaced.
            for (const state of mapStates) state.div.getBoundingClientRect();
            let drawnCount = 0;
            for (const state of overlayStates) {
                if (state.attached && state.map !== null && callLifecycle(state, 'draw')) drawnCount += 1;
            }
            return { drawnCount };
        },
        setDeferred(value) {
            if (typeof value !== 'boolean') throw new TypeError('Deferred mode must be boolean.');
            deferred = value;
            // Changing mode does not flush, attach, detach, or repair any existing work.
            return { deferred, pendingAttachmentCount: pendingAttachments.length };
        },
        captureLateDraws() {
            const entries = overlayStates.filter((state) => state.attached && state.map !== null
                && typeof state.instance.draw === 'function').map((state) => ({
                    state,
                    map: state.map,
                    generation: state.generation,
                    callback: state.instance.draw,
                }));
            const capture = { id: lateDrawCaptures.length + 1, entries };
            lateDrawCaptures.push(capture);
            return { captureId: capture.id, capturedCount: entries.length };
        },
        queueLateDraws(captureId) {
            const id = captureId === undefined ? lateDrawCaptures.length : captureId;
            if (!Number.isInteger(id) || id < 1 || id > lateDrawCaptures.length) {
                throw new TypeError('Late draw capture is required.');
            }
            const capture = lateDrawCaptures[id - 1];
            pendingLateDraws.push(...capture.entries);
            return { captureId: id, queuedCount: capture.entries.length };
        },
        flushLateDraws,
        flush() {
            let attachedCount = 0;
            const attachments = pendingAttachments.splice(0);
            for (const entry of attachments) if (attach(entry)) attachedCount += 1;
            const { lateDrawnCount } = flushLateDraws();
            return { attachedCount, lateDrawnCount, totals: { ...totals } };
        },
    });

    const library = Object.freeze({
        Map: FakeMap,
        OverlayView: FakeOverlayView,
        LatLng: FakeLatLng,
        LatLngBounds: FakeLatLngBounds,
        event,
    });
    Object.assign(maps, library);
    maps.importLibrary = () => Promise.resolve(library);
    Object.defineProperty(window, 'portalMapGoogleBoundary', {
        configurable: false,
        enumerable: false,
        writable: false,
        value: proof,
    });
    // Resolve the real bootstrap promise only after replacing its importLibrary shim.
    // Leave google, maps, __ib__, the request script, and all old map panes intact.
    bootstrapCallback();
})();`;
