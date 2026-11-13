import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Window } from 'happy-dom';
import { CompletePortalShell } from '../src/react/CompletePortalShell.js';
import { resolvePortalShellSelection } from '../src/portals/shell.js';
import { assertPortalShellConsumer } from '../scripts/portal-shell-runtime.mjs';

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
