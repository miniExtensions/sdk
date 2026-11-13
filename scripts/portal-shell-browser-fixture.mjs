import React, { createElement as h, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CompletePortalShell } from '@miniextensions/sdk/react';
import { resolvePortalShellSelection } from '@miniextensions/sdk/portals';
import '@miniextensions/sdk/react/portal-shell.css';
import '@miniextensions/sdk/react/html-description.css';

const items = [
    {
        type: 'table',
        id: 'orders',
        label: 'Orders',
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
                url: 'https://example.test/guide',
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
window.fixtureItems = items;
window.proof = {
    intents: [],
    storage: [],
    reads: [],
    dismissals: [],
    mounts: 0,
};
function App() {
    const [snapshot, setSnapshot] = useState(() => ({
        scope: 'synthetic:user',
        revision: 1,
        items: window.startEmpty ? [] : items,
        selection: resolvePortalShellSelection({
            items: window.startEmpty ? [] : items,
            phase: 'initial',
            initialSelection: { viewId: 'open' },
        }),
        header: {
            layout: 'sidebar',
            title: '<Customer Portal>',
            descriptionHtml:
                '<p>Owned SDK shell</p><script>window.unsafe=true</script>',
        },
        user: {
            name: 'Synthetic user',
            settingsEnabled: true,
            logoutEnabled: true,
        },
        searchAgainEnabled: true,
    }));
    const [mount, setMount] = useState(0);
    const command = (intent) => {
        if (
            intent.scope !== snapshot.scope ||
            intent.revision !== snapshot.revision
        )
            throw Error('Stale host intent');
        window.proof.intents.push(intent);
        if (intent.type === 'navigate') {
            window.proof.storage.push(intent.selection);
            if (
                intent.selection.type === 'table' &&
                intent.previousSelection?.type === 'table' &&
                intent.selection.viewId !== intent.previousSelection.viewId
            )
                window.proof.reads.push(intent.selection);
            setSnapshot((value) => ({
                ...value,
                revision: value.revision + 1,
                selection: intent.selection,
            }));
        } else if (intent.type === 'dismiss-welcome') {
            window.proof.dismissals.push(intent.welcomeId);
            setSnapshot((value) => ({
                ...value,
                revision: value.revision + 1,
                welcome: { ...value.welcome, dismissed: true },
            }));
        }
    };
    window.configure = (patch) =>
        setSnapshot((value) => ({
            ...value,
            ...patch,
            revision: value.revision + 1,
        }));
    window.remount = () => {
        window.proof.mounts++;
        setMount((value) => value + 1);
    };
    return h(
        CompletePortalShell,
        { key: mount, snapshot, onIntent: command },
        h(
            'article',
            null,
            h('h2', null, 'Host collection'),
            h(
                'p',
                null,
                `Selected: ${snapshot.selection?.itemId}/${snapshot.selection?.viewId ?? ''}`
            ),
            h('button', { type: 'button' }, 'Record action')
        )
    );
}
createRoot(document.getElementById('app')).render(
    h(React.StrictMode, null, h(App))
);
