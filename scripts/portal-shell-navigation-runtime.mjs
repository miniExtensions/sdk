import assert from 'node:assert/strict';

export function assertPortalShellSubmenuProjection(portals) {
    const samples = [64, 128].map((n) => {
        let reads = 0;
        const views = Array.from({ length: n }, (_, index) => ({
            get id() {
                reads++;
                return `v${index}`;
            },
            label: `View ${index}`,
        }));
        const projected = portals.projectPortalShellMenu([
            { type: 'table', id: 'bench', label: 'Views', views },
        ]);
        const projectionReads = reads;
        assert.equal(projected[0].views.length, n);
        projected[0].views.forEach((view, index) => {
            assert.equal(view, views[index]);
        });

        reads = 0;
        const selection = {
            type: 'table',
            itemId: 'bench',
            viewId: `v${n - 1}`,
        };
        assert.deepEqual(
            portals.resolvePortalShellSelection({
                items: projected,
                selection,
                phase: 'reconcile',
            }),
            selection
        );
        return { n, projectionReads, reconcileReads: reads };
    });

    const unpadded = { id: 'same', label: 'Unpadded' };
    const padded = { id: ' same ', label: 'Padded' };
    const omitted = { type: 'table', id: 'omitted', label: 'Omitted' };
    const projected = portals.projectPortalShellMenu([
        {
            type: 'table',
            id: 'a',
            label: 'A',
            views: [
                unpadded,
                { id: 'duplicate', label: 'First' },
                padded,
                { id: 'duplicate', label: 'Second' },
                { id: 'duplicate', label: 'Third' },
                { id: ' ', label: 'Blank' },
                { id: '', label: 'Empty' },
            ],
        },
        { type: 'table', id: 'b', label: 'B', views: [unpadded] },
        { type: 'table', id: 'empty', label: 'Empty', views: [] },
        omitted,
    ]);
    assert.deepEqual(
        projected.map(({ id }) => id),
        ['a', 'b', 'omitted']
    );
    assert.equal(projected[0].views.length, 2);
    assert.equal(projected[0].views[0], unpadded);
    assert.equal(projected[0].views[1], padded);
    assert.equal(projected[1].views[0], unpadded);
    assert.equal(projected[2], omitted);

    for (const metric of ['projectionReads', 'reconcileReads']) {
        assert(
            samples.every((sample) => sample[metric] <= 4 * sample.n + 8) &&
                samples[1][metric] <= 2 * samples[0][metric] + 8,
            `Portal submenu read budget exceeded: ${JSON.stringify(samples)}`
        );
    }
    return samples;
}

/** Real public controls; the synthetic host records, rather than performs, native operations. */
export async function assertPortalShellNavigationConsumer({
    React,
    ui,
    Window,
    createRoot,
    renderToString,
}) {
    const h = React.createElement;
    const views = [
        { id: 'open', label: 'Open orders', layout: 'calendar', badge: true },
        { id: 'done', label: 'Done orders', layout: null },
        ...['map', 'list', 'form', 'gallery', 'kanban', 'chart'].map(
            (layout) => ({ id: layout, label: layout, layout })
        ),
    ];
    let snapshot = {
        scope: 'navigation:member',
        revision: 1,
        selectionPolicy: 'host',
        items: [
            {
                type: 'embedded',
                id: 'guide',
                label: 'Guide',
                url: 'https://example.invalid/guide',
            },
            {
                type: 'table',
                id: 'orders',
                label: 'Orders',
                views,
                defaultViewId: 'open',
                sidebarInitiallyExpanded: true,
            },
            { type: 'table', id: 'people', label: 'People' },
            {
                type: 'group',
                id: 'links',
                label: 'Links',
                items: [
                    {
                        type: 'external',
                        id: 'docs',
                        label: 'Docs',
                        url: 'https://example.invalid/docs',
                    },
                ],
            },
            {
                type: 'group',
                id: 'waiting',
                label: 'Waiting for links',
                keepEmpty: true,
                items: [],
            },
            {
                type: 'embedded',
                id: 'unsafe',
                label: 'Unsafe',
                url: 'http://example.invalid',
            },
        ],
        selection: {
            type: 'table',
            itemId: 'people',
            viewId: null,
        },
        header: {
            layout: 'topbar',
            actionsPlacement: 'layout',
            title: 'Portal',
            menuInteraction: 'menu',
        },
        settings: {
            items: [
                { itemId: 'orders', label: 'Edit orders', includeViews: false },
            ],
        },
        embed: {
            preserveElement: true,
            referrerPolicy: 'browser-default',
            fullscreen: false,
        },
    };
    const fullItems = snapshot.items,
        settingsSpec = snapshot.settings;
    // Synthetic representation of the existing host's per-field view owner.
    const acceptedViews = new Map([
        ['orders', 'pending-native'],
        ['people', null],
    ]);
    const activations = [],
        ordinary = [],
        hovers = [],
        settings = [];
    let precommitProbe = false,
        precommitProbes = 0,
        mounted = true;
    let activate = (request) => {
        assert.equal(request.scope, snapshot.scope);
        assert.equal(request.revision, snapshot.revision);
        activations.push(request);
        if (
            request.selection.type === 'table' &&
            request.selection.viewId !== null
        )
            acceptedViews.set(
                request.selection.itemId,
                request.selection.viewId
            );
        const acceptedSelection =
            request.selection.type === 'table'
                ? {
                      ...request.selection,
                      viewId:
                          acceptedViews.get(request.selection.itemId) ?? null,
                  }
                : request.selection;
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            selection: acceptedSelection,
        };
        root.render(element());
    };
    const hover = (request) => {
        assert.equal(request.scope, snapshot.scope);
        assert.equal(request.revision, snapshot.revision);
        hovers.push(request);
    };
    function HostBody() {
        const useCommitEffect =
            typeof document === 'undefined'
                ? React.useEffect
                : React.useLayoutEffect;
        useCommitEffect(() => {
            if (!precommitProbe) return;
            const button = named('People');
            assert(button?.isConnected);
            precommitProbes++;
            button.click();
            const view = named('Open orders');
            assert(view?.isConnected);
            view.dispatchEvent(
                new window.MouseEvent('mouseover', {
                    bubbles: true,
                    relatedTarget: window.document.body,
                })
            );
        }, [snapshot]);
        return h('input', {
            'aria-label': 'Native record draft',
            defaultValue: 'Retained',
        });
    }
    const element = () =>
        h(
            React.StrictMode,
            null,
            h(
                ui.CompletePortalShell,
                {
                    snapshot,
                    onIntent: (request) => ordinary.push(request),
                    onSelectionActivate: activate,
                    onItemHover: hover,
                    onOpenSettings: (request) => settings.push(request),
                    labels: { empty: 'Owned native error' },
                },
                h(HostBody)
            )
        );
    const ssr = renderToString(element());
    assert.match(ssr, /Native record draft/);
    assert.match(ssr, /Waiting for links/);
    assert.doesNotMatch(ssr, /Unsafe/);
    const empty = renderToString(
        h(ui.CompletePortalShell, {
            snapshot: { ...snapshot, selection: null },
            onIntent() {},
            labels: { empty: 'Owned native error' },
        })
    );
    assert.match(empty, /Owned native error/);
    assert.doesNotMatch(empty, /<iframe/);
    const captured = {
        type: 'embedded',
        itemId: 'guide',
        url: 'https://example.invalid/captured',
    };
    for (const items of [
        [
            {
                type: 'external',
                id: 'guide',
                label: 'Current external',
                url: 'https://example.invalid/current',
            },
        ],
        [],
    ]) {
        const markup = renderToString(
            h(ui.CompletePortalShell, {
                snapshot: { ...snapshot, items, selection: captured },
                onIntent: (request) => ordinary.push(request),
            })
        );
        assert.match(markup, /src="https:\/\/example\.invalid\/captured"/);
    }
    for (const url of [
        'http://example.invalid',
        'javascript:alert(1)',
        'https://user:secret@example.invalid',
    ]) {
        const markup = renderToString(
            h(ui.CompletePortalShell, {
                snapshot: {
                    ...snapshot,
                    items: [],
                    selection: { ...captured, url },
                },
                onIntent: (request) => ordinary.push(request),
            })
        );
        assert.doesNotMatch(markup, /<iframe/);
    }
    const nativeError = h('p', null, 'Accepted native error owner');
    for (const selection of [
        { ...captured, itemId: ' ' },
        { ...captured, itemId: 0 },
        { type: 'table', itemId: ' ', viewId: 'pending-native' },
        { type: 'table', itemId: 'orders', viewId: 5 },
    ]) {
        const markup = renderToString(
            h(
                ui.CompletePortalShell,
                {
                    snapshot: { ...snapshot, selection },
                    onIntent: (request) => ordinary.push(request),
                },
                nativeError
            )
        );
        assert.doesNotMatch(markup, /<iframe/);
        assert.doesNotMatch(markup, /Accepted native error owner/);
    }
    const missingTable = {
        type: 'table',
        itemId: 'retiring-native-table',
        viewId: 'pending-native',
    };
    assert.match(
        renderToString(
            h(
                ui.CompletePortalShell,
                {
                    snapshot: {
                        ...snapshot,
                        items: [],
                        selection: missingTable,
                    },
                    onIntent: (request) => ordinary.push(request),
                },
                nativeError
            )
        ),
        /Accepted native error owner/
    );
    assert.doesNotMatch(
        renderToString(
            h(
                ui.CompletePortalShell,
                {
                    snapshot: {
                        ...snapshot,
                        items: [],
                        selection: missingTable,
                        selectionPolicy: 'resolve',
                    },
                    onIntent: (request) => ordinary.push(request),
                },
                nativeError
            )
        ),
        /Accepted native error owner/
    );
    assert.deepEqual(activations, []);
    assert.deepEqual(hovers, []);
    assert.deepEqual(ordinary, []);
    let networks = 0,
        submits = 0;
    const window = new Window({
        url: 'https://navigation.invalid/',
        settings: {
            disableIframePageLoading: true,
            fetch: {
                interceptor: {
                    beforeAsyncRequest() {
                        networks++;
                        throw Error('Unexpected provider request');
                    },
                    beforeSyncRequest() {
                        networks++;
                        throw Error('Unexpected provider request');
                    },
                },
            },
        },
    });
    window.happyDOM.setWindowSize({ width: 1280, height: 900 });
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    const container = window.document.createElement('form');
    container.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    window.document.body.append(container);
    const root = createRoot(container);
    const named = (name) =>
        [...container.querySelectorAll('button')].find(
            (node) => node.textContent === name
        );
    const summary = () =>
        [...container.querySelectorAll('summary')].find(
            (node) => node.textContent === 'Orders'
        );
    const render = () => React.act(async () => root.render(element()));
    const click = (node) =>
        React.act(async () => {
            assert(node);
            node.click();
        });
    const mouse = (node, type) =>
        React.act(async () =>
            node.dispatchEvent(
                new window.MouseEvent(type, {
                    bubbles: true,
                    relatedTarget: window.document.body,
                })
            )
        );
    const press = async (node, key, shiftKey = false) => {
        assert(node);
        const event = new window.KeyboardEvent('keydown', {
            key,
            shiftKey,
            bubbles: true,
            cancelable: true,
        });
        await React.act(async () => node.dispatchEvent(event));
        return event;
    };
    try {
        await render();
        const body = container.querySelector('input');
        const trigger = summary();
        await click(trigger);
        assert.equal(
            activations[0].selection.viewId,
            null,
            'Inactive parent activation never chooses the default view'
        );
        assert.equal(snapshot.selection.viewId, 'pending-native');
        await click(trigger);
        assert.equal(
            activations[1].selection.viewId,
            null,
            'Current pending parent activation leaves the view owner untouched'
        );
        assert.equal(snapshot.selection.viewId, 'pending-native');
        await React.act(async () => {
            trigger.focus();
            trigger.dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                })
            );
        });
        assert.equal(trigger.parentElement.open, true);
        assert.equal(window.document.activeElement, named('Open orders'));
        await React.act(async () =>
            named('Open orders').dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                })
            )
        );
        assert.equal(window.document.activeElement, named('Done orders'));
        await React.act(async () =>
            named('Done orders').dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'End',
                    bubbles: true,
                })
            )
        );
        assert.equal(window.document.activeElement, named('chart'));
        await React.act(async () =>
            named('chart').dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'Home',
                    bubbles: true,
                })
            )
        );
        assert.equal(window.document.activeElement, named('Open orders'));
        assert.equal(activations.length, 2);
        assert.equal(
            hovers.length,
            0,
            'Keyboard opening never invents hover reads'
        );
        const forwardTab = new window.KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true,
            cancelable: true,
        });
        await React.act(async () =>
            named('Open orders').dispatchEvent(forwardTab)
        );
        assert.equal(trigger.parentElement.open, false);
        assert.equal(window.document.activeElement, trigger);
        assert.equal(
            forwardTab.defaultPrevented,
            false,
            'The real browser retains sequential Tab navigation'
        );
        await React.act(async () => {
            trigger.focus();
            trigger.dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'ArrowUp',
                    bubbles: true,
                })
            );
        });
        assert.equal(window.document.activeElement, named('chart'));
        const backwardTab = new window.KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        await React.act(async () => named('chart').dispatchEvent(backwardTab));
        assert.equal(trigger.parentElement.open, false);
        assert.equal(window.document.activeElement, trigger);
        assert.equal(backwardTab.defaultPrevented, false);
        assert.equal(activations.length, 2);
        assert.equal(hovers.length, 0);
        await React.act(async () => {
            trigger.focus();
            trigger.dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'ArrowDown',
                    bubbles: true,
                })
            );
        });
        await click(named('Open orders'));
        assert.equal(activations.length, 3);
        assert.equal(
            activations[2].previousSelection.viewId,
            'pending-native',
            'The host pending/error view was not independently replaced'
        );
        assert.equal(trigger.parentElement.open, false);
        assert.equal(window.document.activeElement, trigger);
        await click(trigger);
        assert.equal(
            activations.length,
            4,
            'Summary activation reaches the host even for the same accepted selection'
        );
        assert.equal(trigger.parentElement.open, true);
        await click(named('Open orders'));
        assert.equal(
            activations.length,
            5,
            'An explicit same-view activation remains observable'
        );
        assert.equal(
            ordinary.length,
            0,
            'Activation replaces, rather than accompanies, ordinary navigate'
        );
        await mouse(trigger, 'mouseover');
        assert.equal(trigger.parentElement.open, true);
        assert.deepEqual(
            hovers.map((value) => [value.itemId, value.viewId]),
            [['orders', null]]
        );
        await mouse(trigger, 'mouseout');
        assert.equal(trigger.parentElement.open, false);
        const gear = container.querySelector('[aria-label="Edit orders"]');
        assert.equal(
            container.querySelectorAll('[aria-label="Edit orders"]').length,
            1,
            'Native parent-only settings omit view gears'
        );
        await mouse(gear, 'mouseover');
        await click(gear);
        assert.equal(settings.length, 1);
        assert.equal(hovers.length, 1);
        assert.equal(activations.length, 5);
        const linkTrigger = [...container.querySelectorAll('summary')].find(
            (node) => node.textContent === 'Links'
        );
        await click(linkTrigger);
        const anchor = container.querySelector(
            'a[href="https://example.invalid/docs"]'
        );
        anchor.addEventListener('click', (event) => event.preventDefault(), {
            once: true,
        });
        await click(anchor); // Intercept only the browser-owned external destination.
        assert.equal(linkTrigger.parentElement.open, false);
        assert.equal(window.document.activeElement, linkTrigger);
        assert.equal(activations.length, 5);
        assert.equal(ordinary.length, 0);
        assert.equal(
            container.querySelectorAll('.mx-sdk-portal-view-icon').length,
            8
        );
        assert(
            [...container.querySelectorAll('.mx-sdk-portal-view-icon')].every(
                (node) => node.style.display === 'none'
            )
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: { ...snapshot.header, layout: 'sidebar' },
        };
        await render();
        assert.equal(summary().parentElement.open, true);
        assert(
            [...container.querySelectorAll('.mx-sdk-portal-view-icon')].every(
                (node) => node.style.display !== 'none'
            )
        );
        assert.equal(
            container.querySelectorAll('.mx-sdk-portal-view-badge').length,
            1
        );
        await mouse(named('Open orders'), 'mouseover');
        assert.deepEqual(
            hovers.map((value) => [value.itemId, value.viewId]),
            [
                ['orders', null],
                ['orders', 'open'],
            ]
        );
        assert.equal(container.querySelector('input'), body);
        await mouse(named('People'), 'mouseover');
        assert.equal(
            hovers.length,
            2,
            'Visible flat sidebar rows do not prefetch'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: { ...snapshot.header, layout: 'topbar' },
        };
        await React.act(async () => {
            window.happyDOM.setWindowSize({ width: 639, height: 800 });
            root.render(element());
        });
        await click(named('Open navigation'));
        await mouse(named('People'), 'mouseover');
        assert.equal(
            hovers.length,
            2,
            'Visible flat topbar-mobile rows do not prefetch'
        );
        const originalBrandHeader = snapshot.header;
        const brandBefore = [
            activations.length,
            hovers.length,
            ordinary.length,
            settings.length,
        ];
        let brandDrawer = container.querySelector(
            '.mx-sdk-portal-navigation[role="dialog"]'
        );
        assert(brandDrawer);
        assert.equal(
            brandDrawer.querySelector('.mx-sdk-portal-brand') === null,
            true,
            'Default consumers retain header-only branding'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: {
                ...snapshot.header,
                showBrandInNavigation: true,
                title: 'Member Portal <literal>',
            },
        };
        await render();
        brandDrawer = container.querySelector(
            '.mx-sdk-portal-navigation[role="dialog"]'
        );
        assert.equal(
            brandDrawer?.querySelector('.mx-sdk-portal-title')?.textContent,
            'Member Portal <literal>',
            'Configured native drawer retains its literal title'
        );
        assert.equal(brandDrawer.querySelector('literal') === null, true);
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: {
                ...snapshot.header,
                titleHtml:
                    '<strong>Configured member</strong><script>throw Error("unsafe")</script>',
            },
        };
        await render();
        assert.equal(
            brandDrawer.querySelector('.mx-sdk-portal-title-html strong')
                ?.textContent,
            'Configured member'
        );
        assert.equal(brandDrawer.querySelector('script') === null, true);
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: {
                ...snapshot.header,
                titleHtml: '',
                logoUrl: 'https://example.invalid/configured-logo.svg',
            },
        };
        await render();
        assert.equal(
            brandDrawer
                .querySelector('.mx-sdk-portal-logo')
                ?.getAttribute('src'),
            'https://example.invalid/configured-logo.svg'
        );
        assert.equal(
            brandDrawer.querySelector('h1') === null,
            true,
            'Logo projection does not invent a blank title'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: { ...snapshot.header, hidden: true },
        };
        await render();
        await click(named('Open navigation'));
        brandDrawer = container.querySelector(
            '.mx-sdk-portal-navigation[role="dialog"]'
        );
        assert(brandDrawer);
        assert.equal(
            brandDrawer.querySelector('.mx-sdk-portal-brand') === null,
            true,
            'Hidden-header navigation never revives branding'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: { ...originalBrandHeader, showBrandInNavigation: true },
        };
        await React.act(async () => {
            // Happy DOM starts a newly subscribed MediaQueryList's previous
            // match at false. Publish the current narrow viewport first so
            // this real resize can notify its true-to-false transition.
            window.dispatchEvent(new window.Event('resize'));
            window.happyDOM.setWindowSize({ width: 1280, height: 800 });
            root.render(element());
        });
        assert.equal(
            container.querySelector(
                '.mx-sdk-portal-navigation .mx-sdk-portal-brand'
            ) === null,
            true,
            'Inline desktop navigation does not duplicate branding'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: originalBrandHeader,
        };
        await React.act(async () => {
            window.happyDOM.setWindowSize({ width: 639, height: 800 });
            root.render(element());
        });
        assert.deepEqual(
            [
                activations.length,
                hovers.length,
                ordinary.length,
                settings.length,
            ],
            brandBefore,
            'Brand presentation never creates host/settings work'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: { ...snapshot.header, hidden: true },
            settings: undefined,
            items: fullItems.map((item) =>
                item.type === 'table' ? { ...item, views: undefined } : item
            ),
        };
        await render();
        const closedToggle = named('Open navigation');
        closedToggle.focus();
        const beforeKeyboard = [
            activations.length,
            hovers.length,
            ordinary.length,
        ];
        await press(closedToggle, 'ArrowDown');
        assert.equal(
            window.document.activeElement === named('Guide'),
            true,
            'Closed configured navigation opens at its first destination'
        );
        await press(named('Guide'), 'ArrowDown');
        assert.equal(window.document.activeElement === named('Orders'), true);
        await press(named('Orders'), 'Home');
        assert.equal(window.document.activeElement === named('Guide'), true);
        await press(named('Guide'), 'End');
        const lastDestination = container.querySelector(
            'nav a[href="https://example.invalid/docs"]'
        );
        assert(lastDestination);
        assert.equal(window.document.activeElement === lastDestination, true);
        await press(lastDestination, 'Escape');
        assert.equal(
            window.document.activeElement === named('Open navigation'),
            true
        );
        await press(named('Open navigation'), 'ArrowUp');
        assert.equal(
            window.document.activeElement === lastDestination,
            true,
            'ArrowUp opens at the last destination'
        );
        await press(lastDestination, 'Escape');
        assert.deepEqual(
            [activations.length, hovers.length, ordinary.length],
            beforeKeyboard,
            'Opening and moving focus never allocates host work'
        );
        await click(named('Open navigation'));
        await mouse(named('People'), 'mouseover');
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            items: snapshot.items.map((item) =>
                item.type === 'group' && item.id === 'links'
                    ? {
                          ...item,
                          items: item.items.map((link) =>
                              link.id === 'docs'
                                  ? {
                                        ...link,
                                        url: 'https://example.invalid/current-docs',
                                    }
                                  : link
                          ),
                      }
                    : item
            ),
            settings: {
                items: [
                    { itemId: 'docs', label: 'Edit Docs', includeViews: false },
                ],
            },
        };
        await render();
        const liveDrawer = container.querySelector(
            '.mx-sdk-portal-navigation[role="dialog"]'
        );
        assert(
            liveDrawer,
            'Same-scope live data refresh preserves the open navigation'
        );
        const currentDocs = liveDrawer.querySelector(
            'a[href="https://example.invalid/current-docs"]'
        );
        assert(currentDocs);
        const docsEditor = liveDrawer.querySelector(
            'button[aria-label="Edit Docs"]'
        );
        assert(docsEditor);
        await press(named('Guide'), 'End');
        assert.equal(
            window.document.activeElement === currentDocs,
            true,
            'Directional navigation ends at the destination, not its settings gear'
        );
        docsEditor.focus();
        assert.equal(
            window.document.activeElement === docsEditor,
            true,
            'The editor remains separately focusable'
        );
        assert.equal(docsEditor.type, 'button');
        currentDocs.focus();
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            items: snapshot.items.map((item) =>
                item.type === 'group' && item.id === 'links'
                    ? { ...item, items: [] }
                    : item
            ),
        };
        await render();
        assert(container.querySelector('[role="dialog"]'));
        assert.equal(
            window.document.activeElement === named('Guide'),
            true,
            'Removing the focused destination recovers focus inside the current drawer'
        );
        const outsideOwner = container.querySelector('input');
        outsideOwner.focus();
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            items: snapshot.items.filter((item) => item.id !== 'guide'),
        };
        await render();
        assert.equal(
            window.document.activeElement === outsideOwner,
            true,
            'Live publication never steals legitimate native owner focus'
        );
        outsideOwner.blur();
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            items: [...snapshot.items],
        };
        await render();
        assert.equal(
            window.document.activeElement === window.document.body,
            true,
            'A relinquished drawer focus owner cannot revive on a later outside blur'
        );

        assert.equal(
            hovers.length,
            3,
            'Headerless flat fields retain the native pointer notification'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: { ...snapshot.header, hidden: false, layout: 'sidebar' },
            settings: settingsSpec,
            items: fullItems,
        };
        await React.act(async () => {
            window.happyDOM.setWindowSize({ width: 1280, height: 900 });
            root.render(element());
        });
        precommitProbe = true;
        snapshot = { ...snapshot, revision: snapshot.revision + 1 };
        await render();
        assert(precommitProbes > 0);
        assert.equal(activations.length, 5);
        assert.equal(hovers.length, 3);
        precommitProbe = false;
        await mouse(named('Open orders'), 'mouseover');
        assert.equal(
            hovers.length,
            4,
            'The current committed view still notifies the host'
        );
        await click(named('People'));
        assert.equal(activations.length, 6);
        activate = undefined;
        await render();
        await click(named('People'));
        assert.equal(
            ordinary.length,
            0,
            'Omission retains the legacy equal-selection suppression'
        );
        await click(named('Done orders'));
        assert.equal(ordinary.length, 1);
        assert.equal(ordinary[0].type, 'navigate');
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            selection: {
                type: 'embedded',
                itemId: 'guide',
                url: 'https://example.invalid/captured',
            },
        };
        await render();
        const frame = container.querySelector('iframe');
        assert(frame);
        assert.equal(frame.getAttribute('referrerpolicy'), null);
        assert.equal(frame.getAttribute('allow'), null);
        for (const items of [
            fullItems.map((item) =>
                item.id === 'guide'
                    ? {
                          type: 'external',
                          id: 'guide',
                          label: 'Current external',
                          url: 'https://example.invalid/current',
                      }
                    : item
            ),
            fullItems.filter((item) => item.id !== 'guide'),
        ]) {
            snapshot = { ...snapshot, revision: snapshot.revision + 1, items };
            await render();
            assert.equal(container.querySelector('iframe'), frame);
            assert.equal(frame.getAttribute('src'), captured.url);
            assert.equal(activations.length, 6);
            assert.equal(ordinary.length, 1);
        }
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            items: fullItems,
        };
        await render();
        assert.equal(container.querySelector('iframe'), frame);
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            selection: {
                ...snapshot.selection,
                url: 'https://example.invalid/replacement',
            },
        };
        await render();
        assert.equal(
            container.querySelector('iframe'),
            frame,
            'Native opt-in preserves the existing iframe element'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            embed: undefined,
        };
        await render();
        assert.notEqual(container.querySelector('iframe'), frame);
        assert.equal(
            container.querySelector('iframe').getAttribute('referrerpolicy'),
            'no-referrer'
        );
        assert.equal(
            container.querySelector('iframe').getAttribute('allow'),
            'fullscreen'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            user: {
                name: 'Member',
                settingsEnabled: true,
                logoutEnabled: true,
                presentation: 'text',
            },
        };
        await render();
        const account = container.querySelector('.mx-sdk-portal-user');
        const accountTrigger = account.querySelector('summary');
        await press(accountTrigger, 'ArrowDown');
        assert.equal(account.open, true);
        assert.equal(window.document.activeElement, named('User settings'));
        await press(named('User settings'), 'End');
        assert.equal(window.document.activeElement, named('Log out'));
        await press(named('Log out'), 'Home');
        assert.equal(window.document.activeElement, named('User settings'));
        await press(named('User settings'), 'ArrowUp');
        assert.equal(window.document.activeElement, named('Log out'));
        await press(named('Log out'), 'Escape');
        assert.equal(account.open, false);
        assert.equal(window.document.activeElement, accountTrigger);
        await press(accountTrigger, 'ArrowUp');
        assert.equal(window.document.activeElement, named('Log out'));
        const cancelledTab = new window.KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true,
            cancelable: true,
        });
        cancelledTab.preventDefault();
        await React.act(async () =>
            named('Log out').dispatchEvent(cancelledTab)
        );
        assert.equal(
            account.open,
            true,
            'A child-owned cancelled Tab keeps its menu'
        );
        assert.equal(window.document.activeElement, named('Log out'));
        const accountTab = await press(named('Log out'), 'Tab');
        assert.equal(account.open, false);
        assert.equal(accountTab.defaultPrevented, false);
        assert.equal(window.document.activeElement, accountTrigger);
        await press(accountTrigger, 'ArrowDown');
        await click(container);
        assert.equal(
            account.open,
            false,
            'An outside click closes the account menu'
        );
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            header: { ...snapshot.header, layout: 'topbar' },
        };
        await React.act(async () => {
            window.happyDOM.setWindowSize({ width: 639, height: 800 });
            root.render(element());
        });
        await click(named('Open navigation'));
        const drawer = container.querySelector(
            '.mx-sdk-portal-navigation[role="dialog"]'
        );
        assert(drawer);
        const mobileAccount = drawer.querySelector('.mx-sdk-portal-user');
        const mobileTrigger = mobileAccount.querySelector('summary');
        await press(mobileTrigger, 'ArrowDown');
        const mobileTab = await press(named('User settings'), 'Tab');
        assert.equal(mobileAccount.open, false);
        assert.equal(
            mobileTab.defaultPrevented,
            true,
            'Only the actual mobile boundary wrap cancels Tab'
        );
        assert(drawer.contains(window.document.activeElement));
        assert.notEqual(window.document.activeElement, mobileTrigger);
        assert.equal(
            ordinary.length,
            1,
            'Keyboard/menu closure never opens account or auth operations'
        );
        assert.equal(hovers.length, 4);
        await press(window.document.activeElement, 'Escape');
        assert.equal(container.querySelector('[role="dialog"]'), null);
        snapshot = {
            ...snapshot,
            revision: snapshot.revision + 1,
            items: [],
            hideMenuItems: true,
            searchAgainEnabled: true,
            user: {
                name: 'Action owner',
                settingsEnabled: true,
                logoutEnabled: false,
                presentation: 'icon',
            },
        };
        await render();
        await press(named('Open navigation'), 'ArrowDown');
        const actionDrawer = container.querySelector(
            '.mx-sdk-portal-navigation[role="dialog"]'
        );
        assert(actionDrawer);
        const closeOnly = actionDrawer.querySelector(':scope > button');
        const directSettings = actionDrawer.querySelector(
            'button[aria-label="User settings"]'
        );
        assert(directSettings);
        assert.equal(
            window.document.activeElement === closeOnly,
            true,
            'An action-only drawer still captures opening focus'
        );
        await press(closeOnly, 'End');
        assert.equal(window.document.activeElement === directSettings, true);
        await press(directSettings, 'Home');
        assert.equal(window.document.activeElement === closeOnly, true);
        await press(closeOnly, 'Escape');
        await press(named('Open navigation'), 'ArrowUp');
        assert.equal(window.document.activeElement === directSettings, true);
        await press(directSettings, 'Escape');
        await click(named('Open navigation'));
        assert.equal(
            actionDrawer.contains(window.document.activeElement),
            true
        );
        await press(window.document.activeElement, 'Escape');
        assert.equal(
            window.document.activeElement === named('Open navigation'),
            true
        );
        await click(named('Open navigation'));
        snapshot = {
            ...snapshot,
            scope: 'navigation:replacement',
            revision: snapshot.revision + 1,
        };
        await render();
        assert.equal(
            container.querySelector('[role="dialog"]'),
            null,
            'A new scope retires its open navigation'
        );
        snapshot = {
            ...snapshot,
            header: { ...snapshot.header, menuInteraction: 'disclosure' },
        };
        await render();
        await click(named('Open navigation'));
        assert(container.querySelector('[role="dialog"]'));
        snapshot = { ...snapshot, revision: snapshot.revision + 1 };
        await render();
        assert.equal(
            container.querySelector('[role="dialog"]'),
            null,
            'Ordinary disclosure mode still closes on revision changes'
        );

        const invalid = new Map([
            [1, 'repeat'],
            [25, 'repeat'],
            [76, 'repeat'],
            [2, ''],
            [95, '   '],
        ]);
        const manyViews = Array.from({ length: 128 }, (_, index) => ({
            id: invalid.get(index) ?? `v${index}`,
            label: `View ${index}`,
        }));
        const expectedLabels = manyViews.flatMap((view, index) =>
            invalid.has(index) ? [] : [view.label]
        );
        assert.equal(expectedLabels.length, 123);
        const submenuSnapshot = {
            scope: 'navigation:many-views',
            revision: 1,
            selectionPolicy: 'host',
            items: [
                {
                    type: 'table',
                    id: 'bench',
                    label: 'Many views',
                    views: manyViews,
                },
            ],
            selection: { type: 'table', itemId: 'bench', viewId: 'v0' },
            header: { layout: 'topbar', menuInteraction: 'menu' },
        };
        const submenuActivations = [];
        await React.act(async () => {
            window.happyDOM.setWindowSize({ width: 1280, height: 900 });
            root.render(
                h(ui.CompletePortalShell, {
                    snapshot: submenuSnapshot,
                    onIntent: (request) => ordinary.push(request),
                    onSelectionActivate: (request) =>
                        submenuActivations.push(request),
                })
            );
        });
        const submenu = container.querySelector('summary');
        assert.equal(submenu?.textContent, 'Many views');
        submenu.focus();
        assert.equal(
            (await press(submenu, 'ArrowDown')).defaultPrevented,
            true
        );
        assert.deepEqual(submenuActivations, []);
        const details = submenu.closest('details');
        assert.equal(details.open, true);
        const choices = [...details.querySelectorAll('button')];
        assert.deepEqual(
            choices.map((node) => node.textContent),
            expectedLabels
        );
        await click(choices.at(-1));
        assert.deepEqual(
            submenuActivations.map(({ scope, revision, selection }) => ({
                scope,
                revision,
                selection,
            })),
            [
                {
                    scope: submenuSnapshot.scope,
                    revision: 1,
                    selection: {
                        type: 'table',
                        itemId: 'bench',
                        viewId: 'v127',
                    },
                },
            ]
        );

        await React.act(async () => root.unmount());
        mounted = false;
        assert.equal(activations.length, 6);
        assert.equal(hovers.length, 4);
        assert.equal(ordinary.length, 1);
        assert.equal(submits, 0);
        assert.equal(networks, 0);
        return {
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
        };
    } finally {
        try {
            if (mounted) await React.act(async () => root.unmount());
        } finally {
            try {
                await window.happyDOM.close();
            } finally {
                keys.forEach((key, index) => {
                    const descriptor = originals[index];
                    if (descriptor)
                        Object.defineProperty(globalThis, key, descriptor);
                    else Reflect.deleteProperty(globalThis, key);
                });
            }
        }
    }
}
