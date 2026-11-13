import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import {
    createCustomerChatBroker,
    type ChatCommandResult,
} from '../src/customer-chat/index.js';
import { createIntercomCustomerChatAdapter } from '../src/customer-chat/intercom.js';
import {
    CustomerChatProvider,
    useCustomerChat,
    useCustomerChatLauncherHidden,
} from '../src/customer-chat/react.js';
import { legacyPlatform } from './customerChatPlatform.js';

const A = { appId: 'synthetic-A' };
const B = { appId: 'synthetic-B' };
function setup() {
    const transport = legacyPlatform();
    const broker = createCustomerChatBroker({
        isSameConfiguration: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        arbitration: 'last-registered',
        environment: 'client',
        adapter: createIntercomCustomerChatAdapter({
            enabled: true,
            platform: transport.platform,
            existingProvider: 'reject',
        }),
        isSameIdentity: (a: string, b) => a === b,
    });
    return { transport, broker };
}
function environment(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const previous = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    keys.forEach((key) =>
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        })
    );
    const roots: ReturnType<typeof createRoot>[] = [];
    const mount = () => {
        const container = window.document.createElement('div');
        window.document.body.append(container);
        const root = createRoot(container as unknown as HTMLElement);
        roots.push(root);
        return {
            container,
            render: (node: ReactNode) =>
                act(async () => {
                    root.render(node);
                }),
        };
    };
    t.after(async () => {
        await act(async () => {
            for (const root of roots) root.unmount();
        });
        keys.forEach((key, index) => {
            if (previous[index])
                Object.defineProperty(globalThis, key, previous[index]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return { mount };
}

test('two roots and independently imported React bundles share one broker; stale help cannot redirect', async (t) => {
    const env = environment(t);
    const { broker, transport } = setup();
    const second = (await import(
        '../src/customer-chat/' + 'react.js?second-bundle'
    )) as typeof import('../src/customer-chat/react.js');
    const actions = new Map<string, (message: string) => ChatCommandResult>();
    function Root(props: {
        id: string;
        configuration: typeof A;
        second?: boolean;
        hidden?: boolean;
        enabled?: boolean;
        preview?: boolean;
    }) {
        const chat = (props.second ? second.useCustomerChat : useCustomerChat)({
            broker,
            identity: props.configuration.appId,
            configuration: props.configuration,
            enabled: props.enabled !== false,
            configurationPreview: props.preview,
        });
        useCustomerChatLauncherHidden(broker, props.hidden === true);
        actions.set(props.id, chat.showNewMessage);
        return createElement(
            'button',
            { onClick: () => chat.showNewMessage('synthetic click') },
            `${props.id}:${chat.active ? 'active' : 'inactive'}`
        );
    }
    const first = env.mount();
    const other = env.mount();
    await first.render(
        createElement(Root, { id: 'A', configuration: A, hidden: true })
    );
    const oldA = actions.get('A')!;
    await other.render(
        createElement(Root, { id: 'B', configuration: B, second: true })
    );
    assert.equal(broker.getSnapshot().customerCount, 2);
    assert.equal(oldA('stale'), 'inactive');
    assert.equal(first.container.textContent, 'A:inactive');
    assert.equal(other.container.textContent, 'B:active');
    await act(async () => {
        transport.ready();
    });
    await act(async () => {
        other.container.querySelector('button')!.click();
    });
    assert.equal(
        transport.calls.filter(([name]) => name === 'showNewMessage').length,
        1
    );
    const oldB = actions.get('B')!;
    await other.render(
        createElement(Root, { id: 'B', configuration: A, second: true })
    );
    assert.equal(oldB('must not target changed app'), 'inactive');
    const boots = transport.boots;
    await first.render(null);
    assert.equal(transport.boots, boots);
    assert.equal(broker.getSnapshot().launcherHidden, false);
    await other.render(null);
    assert.equal(broker.getSnapshot().customerCount, 0);
    assert.equal(transport.availabilityListeners.size, 0);
});

test('StrictMode provider settles to one lease and retires actual dispatched work', async (t) => {
    const env = environment(t);
    const { broker, transport } = setup();
    const root = env.mount();
    let show: ((message: string) => ChatCommandResult) | undefined;
    const node = createElement(CustomerChatProvider<string, typeof A>, {
        broker,
        identity: A.appId,
        configuration: A,
        enabled: true,
        children: (chat) => {
            show = chat.showNewMessage;
            return createElement(
                'span',
                null,
                chat.active ? 'active' : 'inactive'
            );
        },
    });
    await root.render(createElement(StrictMode, null, node));
    assert.equal(root.container.textContent, 'active');
    assert.equal(broker.getSnapshot().customerCount, 1);
    assert.equal(show!('synthetic draft'), 'accepted');
    const captured = show!;
    assert.equal(
        transport.boots,
        2,
        'StrictMode replay may dispatch two boots; cleanup does not cancel them'
    );
    await root.render(null);
    assert.equal(captured('retired'), 'inactive');
    assert.equal(broker.getSnapshot().customerCount, 0);
    assert.equal(transport.availabilityListeners.size, 0);
});

test('disabled and configuration-preview hooks are inert, re-enablement does not authorize retained actions', async (t) => {
    const env = environment(t);
    const { broker, transport } = setup();
    const root = env.mount();
    let action: (message: string) => ChatCommandResult = () => 'inactive';
    function Root(props: { enabled: boolean; configurationPreview?: boolean }) {
        const chat = useCustomerChat({
            broker,
            identity: A.appId,
            configuration: A,
            ...props,
        });
        action = chat.showNewMessage;
        return null;
    }
    await root.render(createElement(Root, { enabled: false }));
    await root.render(
        createElement(Root, { enabled: true, configurationPreview: true })
    );
    assert.equal(transport.reads, 0);
    assert.equal(transport.loads, 0);
    await root.render(createElement(Root, { enabled: true }));
    const old = action;
    await root.render(createElement(Root, { enabled: false }));
    await root.render(createElement(Root, { enabled: true }));
    assert.equal(old('retired prior mount'), 'inactive');
    assert.equal(action('current'), 'accepted');
    await root.render(null);
});

test('SSR imports and provider rendering perform no provider operations', () => {
    const { broker, transport } = setup();
    assert.equal(
        renderToString(
            createElement(CustomerChatProvider<string, typeof A>, {
                broker,
                identity: A.appId,
                configuration: A,
                enabled: true,
                children: 'server-safe',
            })
        ),
        'server-safe'
    );
    assert.equal(transport.reads, 0);
    assert.equal(transport.loads, 0);
    assert.equal(transport.boots, 0);
    assert.equal(broker.getSnapshot().customerCount, 0);
});

test('inline equivalent configuration does not create a render or registration loop', async (t) => {
    const env = environment(t);
    const { broker, transport } = setup();
    const root = env.mount();
    let renders = 0;
    function Inline() {
        renders++;
        if (renders > 10)
            throw new Error('Configuration caused an unbounded render loop');
        const chat = useCustomerChat({
            broker,
            enabled: true,
            identity: A.appId,
            configuration: { ...A },
        });
        return createElement('span', null, chat.active ? 'active' : 'inactive');
    }
    await root.render(createElement(Inline));
    assert.equal(root.container.textContent, 'active');
    assert.equal(transport.boots, 1);
    assert.equal(broker.getSnapshot().customerCount, 1);
    await root.render(null);
});
