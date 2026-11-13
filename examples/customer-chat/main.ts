import { createElement, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createCustomerChatBroker } from '@miniextensions/sdk/customer-chat';
import {
    createIntercomCustomerChatAdapter,
    type IntercomCommand,
} from '@miniextensions/sdk/customer-chat/intercom';
import {
    useCustomerChat,
    useCustomerChatLauncherHidden,
} from '@miniextensions/sdk/customer-chat/react';

// This fixture has no provider script, network, accounts, cookies or messages.
const events: string[] = [];
const callbacks = new Map<string, (() => void)[]>();
const subscribers = new Set<() => void>();
let available = false;
let insertion: (() => void) | undefined;
let acceptedBoots = 0;
const output = document.querySelector('#events')!;
const command: IntercomCommand = (name, value) => {
    if (name === 'onShow' || name === 'onHide') {
        const list = callbacks.get(name) ?? [];
        list.push(value as () => void);
        callbacks.set(name, list);
    }
    events.push(
        name +
            ' ' +
            (typeof value === 'function'
                ? '[callback]'
                : (JSON.stringify(value) ?? ''))
    );
    output.textContent = events.join('\n');
};
let provider: IntercomCommand | undefined;
const broker = createCustomerChatBroker({
    arbitration: 'last-registered',
    environment: 'client',
    isSameIdentity: (a: string, b) => a === b,
    isSameConfiguration: (a, b) => a.appId === b.appId,
    adapter: createIntercomCustomerChatAdapter({
        enabled: true,
        existingProvider: 'reject',
        platform: {
            getCommand: () => provider,
            loadIntercom(settings) {
                provider = command;
                insertion = settings.callBack;
            },
            initIntercomWindow(settings) {
                acceptedBoots++;
                command('boot', settings);
            },
            isAvailable: () => available,
            subscribeAvailability(listener) {
                subscribers.add(listener);
                return () => {
                    subscribers.delete(listener);
                };
            },
        },
    }),
});
const controls = { app: 'Synthetic-A', hidden: false, mounted: [false, false] };
let staleHelp: (() => void) | undefined;
function Customer({ index }: { index: number }) {
    const configuration = { appId: index === 0 ? 'Synthetic-A' : controls.app };
    const chat = useCustomerChat({
        broker,
        enabled: true,
        identity: configuration.appId,
        configuration,
    });
    useCustomerChatLauncherHidden(broker, index === 0 && controls.hidden);
    return createElement(
        'button',
        {
            onClick() {
                const result = chat.showNewMessage('Synthetic draft');
                staleHelp = () => {
                    document.querySelector('#result')!.textContent =
                        chat.showNewMessage('Retained synthetic action');
                };
                document.querySelector('#result')!.textContent = result;
            },
        },
        `Root ${index + 1}: ${chat.active ? 'active' : 'inactive'} help`
    );
}
const roots = [
    createRoot(document.querySelector('#root-one')!),
    createRoot(document.querySelector('#root-two')!),
];
const render = () =>
    roots.forEach((root, index) =>
        root.render(
            controls.mounted[index] ? createElement(Customer, { index }) : null
        )
    );
function Status() {
    const snapshot = useSyncExternalStore(
        broker.subscribe,
        broker.getSnapshot,
        broker.getSnapshot
    );
    return createElement(
        'pre',
        null,
        JSON.stringify(
            {
                ...snapshot,
                activeRegistration: snapshot.activeRegistration !== null,
                acceptedBoots,
            },
            null,
            2
        )
    );
}
createRoot(document.querySelector('#status')!).render(createElement(Status));
for (const index of [0, 1])
    document
        .querySelector(`#toggle-${index + 1}`)!
        .addEventListener('click', () => {
            controls.mounted[index] = !controls.mounted[index];
            render();
        });
document.querySelector('#switch')!.addEventListener('click', () => {
    controls.app =
        controls.app === 'Synthetic-A' ? 'Synthetic-B' : 'Synthetic-A';
    render();
});
document.querySelector('#hide')!.addEventListener('click', () => {
    controls.hidden = !controls.hidden;
    render();
});
document.querySelector('#available')!.addEventListener('click', () => {
    available = true;
    for (const listener of subscribers) listener();
});
document
    .querySelector('#insert')!
    .addEventListener('click', () => insertion?.());
document.querySelector('#show')!.addEventListener('click', () => {
    for (const callback of callbacks.get('onShow') ?? []) callback();
});
document
    .querySelector('#stale')!
    .addEventListener('click', () => staleHelp?.());
