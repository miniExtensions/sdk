import assert from 'node:assert/strict';

/** Exercise the stock resize engine, never a replacement drag implementation. */
export async function assertPortalShellSidebarConsumer({
    React,
    ui,
    Window,
    createRoot,
    renderToString,
}) {
    const h = React.createElement;
    let snapshot = {
        scope: 'sidebar:user',
        revision: 1,
        items: [{ type: 'table', id: 'orders', label: 'Orders' }],
        selection: { type: 'table', itemId: 'orders', viewId: null },
        header: { layout: 'sidebar', title: 'Portal', sidebarWidth: 384 },
    };
    const changes = [],
        intents = [];
    let onSidebarWidthCommit = (change) => changes.push(change);
    const onIntent = (intent) => intents.push(intent);
    let bodyMounts = 0,
        bodyUnmounts = 0;
    function Body() {
        React.useEffect(() => {
            bodyMounts++;
            return () => bodyUnmounts++;
        }, []);
        return h('button', { type: 'button' }, 'Host record');
    }
    const element = () =>
        h(
            React.StrictMode,
            null,
            h(
                ui.CompletePortalShell,
                { snapshot, onIntent, onSidebarWidthCommit },
                h(Body)
            )
        );
    const ssr = renderToString(element());
    assert.match(ssr, /--mx-portal-sidebar-width:384px/);
    assert.doesNotMatch(
        ssr,
        /role="separator"/,
        'SSR keeps canonical width without loading a DOM resize engine'
    );
    const renderWidth = (sidebarWidth, extra = {}) =>
        renderToString(
            h(ui.CompletePortalShell, {
                snapshot: {
                    ...snapshot,
                    header: { ...snapshot.header, sidebarWidth },
                },
                onIntent,
                ...extra,
            })
        );
    assert.doesNotMatch(
        renderWidth(undefined),
        /role="separator"|--mx-portal-sidebar-width/
    );
    assert.match(
        renderWidth(undefined, { onSidebarWidthCommit }),
        /--mx-portal-sidebar-width:288px/
    );
    for (const [input, expected] of [
        [0, 120],
        [900, 600],
        [NaN, 288],
        [Infinity, 288],
    ]) {
        assert.match(
            renderWidth(input),
            new RegExp(`--mx-portal-sidebar-width:${expected}px`)
        );
    }
    assert.deepEqual(changes, []);
    assert.deepEqual(intents, []);
    const window = new Window({ url: 'https://consumer.invalid/portal' });
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
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        })
    );
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container);
    let mounted = true;
    const render = () => React.act(async () => root.render(element()));
    const handle = () => container.querySelector('[role="separator"]');
    const width = () =>
        container
            .querySelector('.mx-sdk-portal-shell')
            .style.getPropertyValue('--mx-portal-sidebar-width');
    const mouse = (node, type, x) =>
        React.act(async () =>
            node.dispatchEvent(
                new window.MouseEvent(type, {
                    clientX: x,
                    clientY: 30,
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
    const start = async () => {
        const box = container.querySelector('.mx-sdk-portal-sidebar-resize');
        assert(box);
        assert(handle());
        // happy-dom has no physical layout. Read only this engine's own written width;
        // the installed Chromium checks separately cover actual pixel geometry.
        Object.defineProperty(box, 'offsetWidth', {
            configurable: true,
            get: () => parseFloat(box.style.width) || 0,
        });
        Object.defineProperty(box, 'offsetHeight', {
            configurable: true,
            get: () => 240,
        });
        await mouse(handle(), 'mousedown', 384);
    };
    const key = (value) =>
        React.act(async () =>
            handle().dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: value,
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
    try {
        await render();
        assert.equal(handle().getAttribute('aria-valuenow'), '384');
        assert.equal(handle().getAttribute('aria-valuemin'), '120');
        assert.equal(handle().getAttribute('aria-valuemax'), '600');
        assert.equal(handle().getAttribute('type'), 'button');
        const body = container.querySelector('main button'),
            mounts = bodyMounts,
            unmounts = bodyUnmounts;
        await start();
        await mouse(window, 'mousemove', 484);
        assert.equal(width(), '484px');
        assert.deepEqual(changes, []);
        await mouse(window, 'mouseup', 484);
        assert.deepEqual(changes, [
            { scope: snapshot.scope, revision: 1, width: 484 },
        ]);
        assert.equal(
            width(),
            '384px',
            'Unaccepted preview must return to the canonical host width'
        );
        for (const [x, expected] of [
            [1800, 600],
            [-500, 120],
        ]) {
            await start();
            await mouse(window, 'mousemove', x);
            await mouse(window, 'mouseup', x);
            assert.equal(changes.at(-1).width, expected);
        }
        await key('ArrowRight');
        assert.equal(changes.at(-1).width, 394);
        await key('ArrowLeft');
        assert.equal(changes.at(-1).width, 374);
        await key('Home');
        assert.equal(changes.at(-1).width, 120);
        await key('End');
        assert.equal(changes.at(-1).width, 600);
        const beforeOtherKey = changes.length;
        await key('Enter');
        assert.equal(changes.length, beforeOtherKey);
        assert.equal(container.querySelector('main button'), body);
        assert.equal(bodyMounts, mounts);
        assert.equal(bodyUnmounts, unmounts);
        const count = changes.length;
        await start();
        await mouse(window, 'mousemove', 484);
        snapshot = { ...snapshot, revision: 2 };
        await render();
        await mouse(window, 'mouseup', 484);
        assert.equal(
            changes.length,
            count,
            'A new accepted revision retires an old drag'
        );
        assert.equal(width(), '384px');
        await start();
        const firstCallback = onSidebarWidthCommit;
        onSidebarWidthCommit = () => {
            throw Error('Replacement must not inherit an allocated drag');
        };
        await render();
        onSidebarWidthCommit = firstCallback;
        await render();
        await mouse(window, 'mousemove', 484);
        await mouse(window, 'mouseup', 484);
        assert.equal(
            changes.length,
            count,
            'Callback A-B-A never revives the old gesture'
        );
        await start();
        await mouse(window, 'mousemove', 484);
        onSidebarWidthCommit = undefined;
        await render();
        assert.equal(handle(), null);
        assert.equal(
            width(),
            '384px',
            'Withdrawing the resize callback restores canonical presentation'
        );
        onSidebarWidthCommit = firstCallback;
        await render();
        await mouse(window, 'mouseup', 484);
        assert.equal(
            changes.length,
            count,
            'Disable/re-enable does not allocate the old drag to a new control'
        );
        await start();
        await React.act(async () =>
            window.happyDOM.setWindowSize({ width: 500, height: 800 })
        );
        assert.equal(
            handle(),
            null,
            'Mobile drawer has no desktop resize control'
        );
        await React.act(async () =>
            window.happyDOM.setWindowSize({ width: 1280, height: 800 })
        );
        await mouse(window, 'mouseup', 484);
        assert.equal(changes.length, count);
        await start();
        snapshot = {
            ...snapshot,
            header: { ...snapshot.header, hidden: true },
        };
        await render();
        assert.equal(handle(), null);
        await mouse(window, 'mouseup', 484);
        assert.equal(changes.length, count);
        snapshot = {
            ...snapshot,
            header: { ...snapshot.header, hidden: false, layout: 'topbar' },
        };
        await render();
        assert.equal(handle(), null);
        snapshot = {
            ...snapshot,
            header: { ...snapshot.header, layout: 'sidebar' },
        };
        await render();
        await start();
        await mouse(window, 'mousemove', 434);
        await mouse(window, 'mouseup', 434);
        assert.equal(
            changes.length,
            count + 1,
            'The unchanged current owner can still complete a new drag'
        );
        assert.equal(changes.at(-1).width, 434);
        onSidebarWidthCommit = (change) => {
            assert.equal(change.scope, snapshot.scope);
            assert.equal(change.revision, snapshot.revision);
            changes.push(change);
            snapshot = {
                ...snapshot,
                revision: snapshot.revision + 1,
                header: { ...snapshot.header, sidebarWidth: change.width },
            };
            root.render(element());
        };
        await render();
        handle().focus();
        for (const [action, expected] of [
            ['ArrowRight', 394],
            ['End', 600],
            ['ArrowLeft', 590],
        ]) {
            const focused = window.document.activeElement;
            await React.act(async () =>
                focused.dispatchEvent(
                    new window.KeyboardEvent('keydown', {
                        key: action,
                        bubbles: true,
                        cancelable: true,
                    })
                )
            );
            assert.equal(changes.at(-1).width, expected);
            assert.equal(
                window.document.activeElement === handle(),
                true,
                'Accepted keyboard width keeps focus for the next key'
            );
        }
        assert.equal(
            changes.length,
            count + 4,
            'Each accepted keyboard action commits exactly once'
        );
        onSidebarWidthCommit = firstCallback;
        snapshot = {
            ...snapshot,
            header: { ...snapshot.header, sidebarWidth: 384 },
        };
        await render();
        const completed = changes.length;
        await start();
        await mouse(window, 'mousemove', 484);
        await React.act(async () => root.unmount());
        mounted = false;
        await mouse(window, 'mouseup', 484);
        assert.equal(
            changes.length,
            completed,
            'Unmount does not settle an unfinished gesture'
        );
        assert.deepEqual(
            intents,
            [],
            'Resizing never navigates, logs out or reads records'
        );
        assert.equal(window.localStorage.length, 0);
        assert.equal(window.sessionStorage.length, 0);
        return {
            endOnlyCommits: completed,
            staleCommits: 0,
            bodyRemountsDuringResize: 0,
        };
    } finally {
        if (mounted) await React.act(async () => root.unmount());
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}

export async function assertPortalShellConsumer({
    React,
    ui,
    portals,
    Window,
    createRoot,
    renderToString,
}) {
    const h = React.createElement;
    const items = [
        {
            type: 'table',
            id: 'orders',
            label: '<Orders>',
            views: [
                { id: 'open', label: 'Open orders' },
                { id: 'done', label: 'Done orders' },
            ],
        },
        { type: 'table', id: 'people', label: 'People' },
        {
            type: 'group',
            id: 'resources',
            label: 'Resources',
            items: [
                {
                    type: 'embedded',
                    id: 'guide',
                    label: 'Guide',
                    url: 'https://example.test/new',
                },
                {
                    type: 'external',
                    id: 'docs',
                    label: 'Documentation',
                    url: 'https://example.test/docs',
                },
            ],
        },
    ];
    let snapshot = {
        scope: 'portal:user',
        revision: 1,
        items,
        selection: portals.resolvePortalShellSelection({
            items,
            initialSelection: { viewId: 'open', itemId: 'people' },
            phase: 'initial',
        }),
        header: {
            layout: 'sidebar',
            title: '<Portal>',
            descriptionHtml: '<p>Safe description</p><script>bad()</script>',
        },
        user: { name: '0', settingsEnabled: true, logoutEnabled: true },
        searchAgainEnabled: true,
    };
    const intents = [],
        reads = [],
        writes = [],
        dismissals = [];
    const onIntent = (intent) => {
        assert.equal(intent.scope, snapshot.scope);
        assert.equal(intent.revision, snapshot.revision);
        intents.push(intent);
        if (intent.type === 'navigate') {
            writes.push(intent.selection);
            if (
                intent.selection.type === 'table' &&
                intent.previousSelection?.type === 'table' &&
                intent.selection.viewId !== intent.previousSelection.viewId
            )
                reads.push(intent.selection);
            snapshot = {
                ...snapshot,
                revision: snapshot.revision + 1,
                selection: intent.selection,
            };
        } else if (intent.type === 'dismiss-welcome') {
            dismissals.push(intent.welcomeId);
            snapshot = {
                ...snapshot,
                revision: snapshot.revision + 1,
                welcome: { ...snapshot.welcome, dismissed: true },
            };
        }
    };
    const element = () =>
        h(
            React.StrictMode,
            null,
            h(
                ui.CompletePortalShell,
                { snapshot, onIntent },
                h('p', null, 'Host records')
            )
        );
    const html = renderToString(element());
    assert.match(html, /&lt;Portal&gt;/);
    assert.match(html, /&lt;Orders&gt;/);
    assert.doesNotMatch(html, /<script|bad\(\)/);
    assert.deepEqual(intents, []);
    const richHeader = {
        ...snapshot.header,
        title: 'Plain header fallback',
        titleHtml:
            '<h1>Owned heading</h1><strong>Owned title</strong><script>bad()</script>',
    };
    const renderHeader = (header) =>
        renderToString(
            h(ui.CompletePortalShell, {
                snapshot: { ...snapshot, header },
                onIntent,
            })
        );
    const richMarkup = renderHeader(richHeader);
    assert.match(richMarkup, /<h1>Owned heading<\/h1>/);
    assert.match(richMarkup, /<strong>Owned title<\/strong>/);
    assert.doesNotMatch(richMarkup, /Plain header fallback|<script|bad\(\)/);
    assert.doesNotMatch(richMarkup, /<h1[^>]*>\s*<div/);
    for (const titleHtml of ['', '<script>bad()</script>']) {
        const blank = renderHeader({ ...richHeader, titleHtml });
        assert.doesNotMatch(blank, /Plain header fallback|<script|bad\(\)/);
    }
    const branded = renderHeader({
        ...richHeader,
        logoUrl: 'https://example.test/logo.png',
    });
    assert.match(branded, /src="https:\/\/example.test\/logo.png"/);
    assert.match(branded, /<strong>Owned title<\/strong>/);
    assert.doesNotMatch(
        renderHeader({ ...richHeader, hidden: true }),
        /Owned heading|Owned title|Plain header fallback/
    );
    assert.deepEqual(intents, []);
    let networks = 0;
    const window = new Window({
        url: 'https://consumer.invalid/portal?viewId=open',
        settings: {
            disableIframePageLoading: true,
            fetch: {
                interceptor: {
                    beforeAsyncRequest() {
                        networks++;
                        throw Error('Unexpected network');
                    },
                    beforeSyncRequest() {
                        networks++;
                        throw Error('Unexpected network');
                    },
                },
            },
        },
    });
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
    const container = window.document.createElement('div');
    window.document.body.append(container);
    let root = createRoot(container);
    const render = async () => React.act(async () => root.render(element()));
    const update = async (patch) => {
        snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
        await render();
    };
    const find = (selector, text) => {
        const node = [...container.querySelectorAll(selector)].find(
            (node) => node.textContent === text
        );
        assert(node, `Missing ${selector}: ${text}`);
        return node;
    };
    const click = async (text) => {
        await React.act(async () => find('button', text).click());
        await render();
    };
    const key = async (node, key) =>
        React.act(async () =>
            node.dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key,
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
    try {
        await render();
        assert.deepEqual(intents, []);
        const originalHeader = snapshot.header;
        await update({ header: richHeader });
        const renderedTitle = container.querySelector(
            '.mx-sdk-portal-title-html'
        );
        assert(renderedTitle);
        assert.equal(
            renderedTitle.querySelector('h1').textContent,
            'Owned heading'
        );
        assert.equal(
            renderedTitle.querySelector('strong').textContent,
            'Owned title'
        );
        assert.equal(renderedTitle.querySelector('script'), null);
        for (const titleHtml of ['', '<script>bad()</script>']) {
            await update({ header: { ...richHeader, titleHtml } });
            assert.equal(
                container.querySelector('.mx-sdk-portal-title-html')
                    .textContent,
                ''
            );
            assert(!container.textContent.includes('Plain header fallback'));
        }
        await update({ header: originalHeader });
        assert.equal(
            container.querySelector('.mx-sdk-portal-title-html'),
            null
        );
        assert.equal(
            container.querySelector('.mx-sdk-portal-brand h1').textContent,
            '<Portal>'
        );
        assert.deepEqual(intents, []);
        assert.equal(networks, 0);
        assert.equal(
            container.querySelector('[aria-current="page"]').textContent,
            'Open orders'
        );
        const orders = find('summary', '<Orders>');
        await React.act(async () => orders.click());
        await React.act(async () =>
            find('button', 'Done orders').dispatchEvent(
                new window.MouseEvent('mouseover', { bubbles: true })
            )
        );
        find('button', 'Done orders').focus();
        assert.deepEqual(reads, []);
        assert.deepEqual(writes, []);
        await click('Done orders');
        assert.equal(intents.length, 1);
        assert.equal(reads.length, 1);
        assert.equal(writes.length, 1);
        await click('Done orders');
        assert.equal(intents.length, 1);
        await update({ header: { ...snapshot.header, layout: 'topbar' } });
        find('summary', '<Orders>').parentElement.removeAttribute('open');
        await React.act(async () => find('summary', '<Orders>').click());
        await click('Done orders');
        assert.equal(
            find('summary', '<Orders>').parentElement.hasAttribute('open'),
            false
        );
        assert.equal(window.document.activeElement.textContent, '<Orders>');
        await React.act(async () => find('summary', '<Orders>').click());
        await React.act(async () => container.querySelector('main').click());
        assert.equal(
            find('summary', '<Orders>').parentElement.hasAttribute('open'),
            false
        );
        await update({
            header: { ...snapshot.header, layout: 'sidebar' },
            items: [
                ...items,
                {
                    type: 'group',
                    id: 'outer',
                    label: 'Outer',
                    items: [
                        {
                            type: 'group',
                            id: 'inner',
                            label: 'Inner',
                            items: [
                                { type: 'table', id: 'deep', label: 'Deep' },
                            ],
                        },
                    ],
                },
            ],
        });
        find('button', 'People').focus();
        await key(find('button', 'People'), 'End');
        assert.equal(window.document.activeElement.textContent, 'Outer');
        await update({ items: structuredClone(items) });
        assert.equal(
            container.querySelector('[aria-current="page"]').textContent,
            'Done orders'
        );
        await React.act(async () => root.unmount());
        root = createRoot(container);
        await render();
        assert.equal(
            container.querySelector('[aria-current="page"]').textContent,
            'Done orders'
        );
        assert.equal(intents.length, 1);
        await React.act(async () => find('summary', 'Resources').click());
        await click('Guide');
        assert.equal(intents.length, 2);
        assert.equal(writes.length, 2);
        assert.equal(reads.length, 1);
        assert.equal(
            container.querySelector('iframe').getAttribute('src'),
            'https://example.test/new'
        );
        const changed = structuredClone(items);
        changed[2].items[0].url = 'https://example.test/changed';
        await update({ items: changed });
        assert.equal(
            container.querySelector('iframe').getAttribute('src'),
            'https://example.test/new'
        );
        await click('Guide');
        assert.equal(
            container.querySelector('iframe').getAttribute('src'),
            'https://example.test/changed'
        );
        assert.equal(intents.length, 3);
        await click('People');
        assert.equal(container.querySelector('iframe'), null);
        assert.equal(intents.length, 4);
        const anchor = find('a', 'Documentation (opens in a new tab)');
        assert.equal(anchor.target, '_blank');
        assert.equal(anchor.rel, 'noopener noreferrer');
        assert.equal(
            intents.length,
            4,
            'external anchors must not also dispatch navigation'
        );
        await update({ header: { ...snapshot.header, hidden: true } });
        await click('Open navigation');
        assert.equal(
            container
                .querySelector('[role="dialog"]')
                .getAttribute('aria-modal'),
            'true'
        );
        assert.equal(
            container.querySelector(
                '.mx-sdk-portal-navigation .mx-sdk-portal-group > summary'
            )?.textContent,
            '<Orders>'
        );
        assert.equal(
            container
                .querySelector('.mx-sdk-portal-navigation')
                .textContent.includes('Resources'),
            false,
            'hidden-header groups are flat'
        );
        const close = container.querySelector(
            '.mx-sdk-portal-navigation > button'
        );
        assert(close);
        close.focus();
        await key(close, 'End');
        assert.equal(
            window.document.activeElement.textContent,
            'Documentation (opens in a new tab)'
        );
        await key(window.document.activeElement, 'Escape');
        assert.equal(container.querySelector('[role="dialog"]'), null);
        assert.equal(
            window.document.activeElement.textContent,
            'Open navigation'
        );
        await update({
            header: { layout: 'topbar', title: 'Portal' },
            welcome: {
                id: 'welcome-user',
                title: 'Welcome',
                messageHtml: '<p>Hello</p>',
                dismissed: false,
            },
        });
        assert.equal(
            container.querySelector('[role="dialog"] h2').textContent,
            'Welcome'
        );
        await React.act(async () => {
            const button = find('button', 'Continue');
            button.click();
            button.click();
        });
        await render();
        assert.deepEqual(dismissals, ['welcome-user']);
        assert.equal(container.querySelector('[role="dialog"]'), null);
        await React.act(async () => root.unmount());
        root = createRoot(container);
        await render();
        assert.equal(container.querySelector('[role="dialog"]'), null);
        await update({
            welcome: {
                id: 'welcome-keyboard',
                title: 'Keyboard welcome',
                messageHtml: '<p>Hello again</p>',
                dismissed: false,
            },
        });
        await key(find('button', 'Continue'), 'Escape');
        await render();
        assert.deepEqual(dismissals, ['welcome-user', 'welcome-keyboard']);
        assert.equal(container.querySelector('[role="dialog"]'), null);
        await React.act(async () => root.unmount());
        root = createRoot(container);
        await render();
        assert.equal(
            container.querySelector('[role="dialog"]'),
            null,
            'Keyboard welcome dismissal is accepted by the host and survives remount'
        );
        await update({
            welcome: {
                id: 'welcome-backdrop',
                title: 'Backdrop welcome',
                messageHtml: '<p>Dismiss once</p>',
                dismissed: false,
            },
        });
        await React.act(async () =>
            container.querySelector('[role="dialog"] h2').click()
        );
        assert.equal(
            container.querySelector('[role="dialog"] h2').textContent,
            'Backdrop welcome',
            'Clicking dialog content must not dismiss it'
        );
        assert.equal(dismissals.length, 2);
        await React.act(async () =>
            container.querySelector('.mx-sdk-portal-backdrop').click()
        );
        await render();
        assert.deepEqual(dismissals, [
            'welcome-user',
            'welcome-keyboard',
            'welcome-backdrop',
        ]);
        assert.equal(container.querySelector('[role="dialog"]'), null);
        const beforeUserEscape = intents.length;
        await React.act(async () => find('summary', '0').click());
        await key(find('summary', '0'), 'Escape');
        assert.equal(
            find('summary', '0').parentElement.hasAttribute('open'),
            false
        );
        assert.equal(window.document.activeElement, find('summary', '0'));
        assert.equal(
            intents.length,
            beforeUserEscape,
            'Closing the user disclosure emits no settings or auth intent'
        );
        await React.act(async () => find('summary', '0').click());
        await click('User settings');
        assert.equal(intents.at(-1).type, 'user-settings');
        assert.equal(window.document.activeElement.textContent, '0');
        await React.act(async () => find('summary', '0').click());
        await click('User settings');
        assert.equal(
            intents.filter((intent) => intent.type === 'user-settings').length,
            2
        );
        await React.act(async () => find('summary', '0').click());
        await click('Log out');
        await click('Cancel');
        assert.equal(window.document.activeElement.textContent, '0');
        assert.equal(
            intents.filter((intent) => intent.type === 'logout').length,
            0
        );
        await React.act(async () => find('summary', '0').click());
        await click('Log out');
        assert.equal(window.document.activeElement, find('button', 'Cancel'));
        const confirm = container.querySelector(
            '[role="dialog"] button:last-child'
        );
        confirm.focus();
        const forwardTab = new window.KeyboardEvent('keydown', {
            key: 'Tab',
            bubbles: true,
            cancelable: true,
        });
        await React.act(async () => confirm.dispatchEvent(forwardTab));
        assert.equal(forwardTab.defaultPrevented, true);
        assert.equal(
            window.document.activeElement,
            find('button', 'Cancel'),
            'Tab from confirmation wraps to the first dialog control'
        );
        const reverseTab = new window.KeyboardEvent('keydown', {
            key: 'Tab',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        await React.act(async () =>
            find('button', 'Cancel').dispatchEvent(reverseTab)
        );
        assert.equal(reverseTab.defaultPrevented, true);
        assert.equal(
            window.document.activeElement,
            confirm,
            'Shift+Tab wraps back to confirmation'
        );
        await key(confirm, 'Escape');
        await render();
        assert.equal(container.querySelector('[role="dialog"]'), null);
        assert.equal(window.document.activeElement, find('summary', '0'));
        assert.equal(
            intents.filter((intent) => intent.type === 'logout').length,
            0,
            'Escape cancels without invoking host auth'
        );
        await React.act(async () => find('summary', '0').click());
        await click('Log out');
        await React.act(async () =>
            container.querySelector('[role="dialog"] h2').click()
        );
        assert(
            container.querySelector('[role="dialog"]'),
            'Clicking logout dialog content keeps the confirmation open'
        );
        await React.act(async () =>
            container.querySelector('.mx-sdk-portal-backdrop').click()
        );
        await render();
        assert.equal(container.querySelector('[role="dialog"]'), null);
        assert.equal(window.document.activeElement, find('summary', '0'));
        assert.equal(
            intents.filter((intent) => intent.type === 'logout').length,
            0,
            'Backdrop dismissal cancels without host auth'
        );
        await React.act(async () => find('summary', '0').click());
        await click('Log out');
        await React.act(async () =>
            container.querySelector('[role="dialog"] button:last-child').click()
        );
        await render();
        assert.equal(
            intents.filter((intent) => intent.type === 'logout').length,
            1
        );
        await click('Search again');
        assert.equal(intents.at(-1).type, 'search-again');
        await click('Search again');
        assert.equal(
            intents.filter((intent) => intent.type === 'search-again').length,
            2
        );
        const beforeSkip = {
            intents: intents.length,
            writes: writes.length,
            reads: reads.length,
        };
        const skipMainId = container.querySelector('main').id;
        assert.equal(
            find('a', 'Skip to content').getAttribute('href'),
            `#${skipMainId}`
        );
        await React.act(async () => find('a', 'Skip to content').click());
        assert.equal(
            window.document.activeElement,
            container.querySelector('main')
        );
        assert.deepEqual(
            {
                intents: intents.length,
                writes: writes.length,
                reads: reads.length,
            },
            beforeSkip,
            'Skip-to-content only moves focus; it does not navigate the host, persist selection or read records'
        );
        const pendingForever = new Promise(() => {});
        function SuspendedSibling() {
            throw pendingForever;
        }
        const speculative = { ...snapshot, revision: snapshot.revision + 1 };
        await React.act(async () =>
            React.startTransition(() =>
                root.render(
                    h(
                        React.StrictMode,
                        null,
                        h(ui.CompletePortalShell, {
                            snapshot: speculative,
                            onIntent,
                        }),
                        h(SuspendedSibling)
                    )
                )
            )
        );
        const beforeInterrupted = intents.length;
        await React.act(async () => find('button', 'Search again').click());
        assert.equal(
            intents.length,
            beforeInterrupted + 1,
            'An interrupted render must not retire the currently committed controls'
        );
        await render();
        await update({ items: [], selection: null });
        assert.equal(
            container.querySelector('[role="status"]').textContent,
            'No views available'
        );
        assert.equal(window.localStorage.length, 0);
        assert.equal(window.sessionStorage.length, 0);
        assert.equal(networks, 0);
        assert.equal(
            window.location.href.split('#')[0],
            'https://consumer.invalid/portal?viewId=open'
        );
        assert.equal(
            decodeURIComponent(new URL(window.location.href).hash.slice(1)),
            skipMainId,
            'Only the intended skip-to-content fragment may change'
        );
        return {
            navigationIntents: intents.filter(
                (intent) => intent.type === 'navigate'
            ).length,
            storageEffects: writes.length,
            customViewReads: reads.length,
            dismissals: dismissals.length,
            implicitNetworkRequests: networks,
            ssrEffects: 0,
        };
    } finally {
        await React.act(async () => root.unmount());
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    }
}
