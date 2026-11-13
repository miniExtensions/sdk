import assert from 'node:assert/strict';

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
