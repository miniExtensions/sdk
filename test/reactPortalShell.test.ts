import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Window } from 'happy-dom';
import {
    CompletePortalShell,
    type PortalShellSnapshot,
} from '../src/react/CompletePortalShell.js';
import { resolvePortalShellSelection } from '../src/portals/shell.js';
import { assertPortalShellNavigationConsumer } from '../scripts/portal-shell-navigation-runtime.mjs';
import {
    assertPortalShellConsumer,
    assertPortalShellSidebarConsumer,
    assertPortalShellPresentationConsumer,
    assertPortalShellSettingsConsumer,
} from '../scripts/portal-shell-runtime.mjs';

it('optional host activation and pointer notifications preserve native owners, menu controls and iframe presentation', async () => {
    const result = await assertPortalShellNavigationConsumer({
        React,
        ui: { CompletePortalShell },
        Window,
        createRoot,
        renderToString,
    });
    assert.deepEqual(result, {
        activations: 6,
        legacyNavigationIntents: 1,
        hoverNotifications: 4,
        settingsRequests: 1,
        precommitAdmission: 'rejected',
        providerRequests: 0,
        submitEvents: 0,
        preservedIframe: true,
        externalLinkClosure: 'passed',
        tabExitHandoff: 'passed',
        accountKeyboardAndMobileTrap: 'passed',
        hostSelectionAcrossMenuDrift: 'passed',
        closedNavigationKeyboard: 'passed',
        liveNavigationRevision: 'passed',
        editorDirectionalFocus: 'passed',
        navigationBrand: 'passed',
    });
});

it('authoring settings keep finite host targets, sibling controls and current callbacks without navigation or submit effects', async () => {
    const result = await assertPortalShellSettingsConsumer({
        React,
        ui: { CompletePortalShell },
        Window,
        createRoot,
        renderToString,
    });
    assert.deepEqual(result, {
        settingsRequests: 11,
        siblingRequests: 1,
        ordinaryIntents: 0,
        submitEvents: 0,
        implicitNetworkRequests: 0,
        precommitAdmission: 'rejected',
    });
});

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

it('renders a leading icon and localized name only for an opted-in visible sidebar', (t) => {
    const window = new Window();
    t.after(() => window.happyDOM.close());
    const { document } = window;
    const name = 'Abrir menú de navegación';
    const renderHeader = (header: PortalShellSnapshot['header']) => {
        const template = document.createElement('template');
        template.innerHTML = renderToString(
            React.createElement(CompletePortalShell, {
                snapshot: {
                    scope: 'projects',
                    revision: 1,
                    items: [
                        { type: 'table', id: 'projects', label: 'Proyectos' },
                    ],
                    selection: {
                        type: 'table',
                        itemId: 'projects',
                        viewId: null,
                    },
                    header,
                },
                labels: { openNavigation: name },
                onIntent() {
                    assert.fail(
                        'Rendering the opener dispatched a host action'
                    );
                },
            })
        );
        const shell = template.content.querySelector('header');
        const button = shell?.querySelector('button.mx-sdk-portal-toggle');
        assert(shell && button);
        return { shell, button };
    };

    const title = 'Proyectos';
    const { shell, button } = renderHeader({
        layout: 'sidebar',
        sidebarToggle: 'icon',
        title,
    });
    assert.equal(shell.firstElementChild, button);
    assert.equal(button.textContent, '');
    assert.equal(button.getAttribute('aria-label'), name);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(
        button.querySelector('svg')?.getAttribute('aria-hidden'),
        'true'
    );
    assert.equal(shell.querySelector('h1')?.textContent, title);

    for (const header of [
        { layout: 'sidebar', title },
        { layout: 'sidebar', sidebarToggle: 'icon', hidden: true, title },
        { layout: 'topbar', sidebarToggle: 'icon', title },
    ] as const) {
        const { button } = renderHeader(header);
        assert.equal(button.textContent, name);
        assert.equal(button.getAttribute('aria-label'), null);
        assert.equal(button.querySelector('svg'), null);
    }
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
