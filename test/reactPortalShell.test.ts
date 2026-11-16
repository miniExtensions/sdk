import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Window } from 'happy-dom';
import { CompletePortalShell } from '../src/react/CompletePortalShell.js';
import { resolvePortalShellSelection } from '../src/portals/shell.js';
import {
    assertPortalShellConsumer,
    assertPortalShellSidebarConsumer,
    assertPortalShellPresentationConsumer,
} from '../scripts/portal-shell-runtime.mjs';

it('configured shell presentation preserves native availability/layout/disclosure and retires committed logout authority', async () => {
    const result = await assertPortalShellPresentationConsumer({
        React,
        ui: { CompletePortalShell },
        Window,
        createRoot,
        renderToString,
    });
    assert.deepEqual(result, {
        availabilityCases: 8,
        authorityRetirements: 3,
        logoutIntents: 2,
        submitEvents: 0,
        bodyRemountsWhileSelected: 0,
        implicitNetworkRequests: 0,
        synchronousPublications: 1,
        siblingLogoutIntents: 1,
    });
});

it('controlled sidebar reuses the native resize engine with end-only current-owner commits and stable record body', async () => {
    const result = await assertPortalShellSidebarConsumer({
        React,
        ui: { CompletePortalShell },
        Window,
        createRoot,
        renderToString,
    });
    assert.deepEqual(result, {
        endOnlyCommits: 11,
        staleCommits: 0,
        bodyRemountsDuringResize: 0,
    });
});

it('controlled SDK-owned shell: SSR, selection/remount, menus, modal keyboard/backdrop cancellation, skip focus and host effects', async () => {
    const result = await assertPortalShellConsumer({
        React,
        ui: { CompletePortalShell },
        portals: { resolvePortalShellSelection },
        Window,
        createRoot,
        renderToString,
    });
    assert.deepEqual(result, {
        navigationIntents: 4,
        storageEffects: 4,
        customViewReads: 1,
        dismissals: 3,
        implicitNetworkRequests: 0,
        ssrEffects: 0,
    });
});
