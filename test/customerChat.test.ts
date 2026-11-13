import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCustomerChatBroker } from '../src/customer-chat/index.js';
import {
    createIntercomCustomerChatAdapter,
    type IntercomCustomerConfiguration,
} from '../src/customer-chat/intercom.js';
import { legacyPlatform } from './customerChatPlatform.js';

const A = { appId: 'synthetic-A', user_id: 'visitor' };
const B = { appId: 'synthetic-B', user_id: 'visitor' };
function setup(options: Parameters<typeof legacyPlatform>[0] = {}) {
    const transport = legacyPlatform(options);
    const broker = createCustomerChatBroker({
        isSameConfiguration: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        arbitration: 'last-registered',
        environment: 'client',
        adapter: createIntercomCustomerChatAdapter({
            enabled: true,
            platform: transport.platform,
            existingProvider: 'host-handoff',
        }),
        isSameIdentity: (a: IntercomCustomerConfiguration, b) =>
            a.appId === b.appId && a.user_id === b.user_id,
    });
    const register = (configuration: IntercomCustomerConfiguration) =>
        broker.register({ identity: configuration, configuration });
    return { transport, broker, register };
}

test('same identity preserves conversation; inactive and duplicate cleanup are inert', () => {
    const { transport, broker, register } = setup({ existing: true });
    const a = register(A);
    const b = register({ ...A });
    assert.equal(transport.boots, 1);
    assert.equal(a.showNewMessage('old'), 'inactive');
    assert.equal(b.showNewMessage('synthetic help'), 'accepted');
    a.release();
    a.release();
    assert.equal(transport.boots, 1);
    assert.equal(
        transport.calls.filter(([name]) => name === 'shutdown').length,
        0
    );
    b.release();
    b.release();
    assert.equal(broker.getSnapshot().customerCount, 0);
    assert.equal(
        transport.calls.filter(([name]) => name === 'shutdown').length,
        1
    );
    assert.equal(b.showNewMessage('retired'), 'inactive');
});

test('different app restores only latest mounted customer; no admin boot after final release', () => {
    const { transport, register, broker } = setup({ existing: true });
    const a = register(A);
    const b = register(B);
    b.release();
    assert.equal(a.isActive(), true);
    assert.deepEqual(
        transport.calls
            .filter(([name]) => name === 'boot')
            .map(([, value]) => (value as { app_id: string }).app_id),
        [A.appId, B.appId, A.appId]
    );
    const c = register(B);
    a.release();
    c.release();
    assert.equal(transport.boots, 4);
    assert.equal(broker.getSnapshot().activeRegistration, null);
});

test('nested launcher leases survive app switch and restore current default', () => {
    const { transport, broker, register } = setup({ existing: true });
    const a = register(A);
    const outer = broker.acquireLauncherHide();
    const inner = broker.acquireLauncherHide();
    const b = register(B);
    const boot = transport.calls
        .filter(([name]) => name === 'boot')
        .at(-1)![1] as { hide_default_launcher: boolean };
    assert.equal(boot.hide_default_launcher, true);
    outer();
    outer();
    assert.equal(broker.getSnapshot().launcherHidden, true);
    broker.setDefaultLauncherHidden(true);
    inner();
    assert.equal(broker.getSnapshot().launcherHidden, true);
    broker.setDefaultLauncherHidden(false);
    assert.deepEqual(transport.calls.at(-1), [
        'update',
        { hide_default_launcher: false },
    ]);
    b.release();
    a.release();
});

test('cold queue, no anchor, late callback and same-app handoff keep separate evidence', () => {
    const { transport, broker, register } = setup({
        anchor: false,
        deferInsertion: true,
    });
    const a = register(A);
    assert.equal(broker.getSnapshot().state.loading, 'requested');
    assert.equal(broker.getSnapshot().state.boot, 'accepted');
    assert.equal(broker.getSnapshot().state.available, false);
    assert.equal(broker.getSnapshot().state.visible, null);
    const b = register({ ...A });
    assert.equal(transport.boots, 1);
    for (const callback of transport.pending) callback();
    assert.equal(transport.scripts.length, 0);
    assert.equal(broker.getSnapshot().state.loading, 'requested');
    transport.ready();
    assert.equal(broker.getSnapshot().state.available, true);
    assert.equal(broker.getSnapshot().state.visible, null);
    transport.fire('onShow');
    assert.equal(broker.getSnapshot().state.visible, true);
    b.release();
    a.release();
    const snapshot = broker.getSnapshot();
    for (const callback of transport.insertionCallbacks) callback();
    transport.fire('onShow');
    assert.equal(broker.getSnapshot(), snapshot);
    assert.equal(transport.availabilityListeners.size, 0);
});

test('insertion callback proves neither loading nor availability; existing function needs no callback', () => {
    for (const existing of [false, true]) {
        const { transport, broker, register } = setup({ existing });
        const a = register(A);
        assert.equal(transport.boots, 1);
        assert.equal(
            broker.getSnapshot().state.loading,
            existing ? 'requested' : 'insertion-attempted'
        );
        assert.equal(broker.getSnapshot().state.available, false);
        assert.equal(broker.getSnapshot().state.visible, null);
        assert.equal(a.showNewMessage('synthetic acceptance only'), 'accepted');
        a.release();
    }
});

test('partial listener failure and stale listeners cannot report visible', () => {
    const { transport, broker, register } = setup({ failOnHide: true });
    const a = register(A);
    transport.ready();
    transport.fire('onShow');
    assert.equal(broker.getSnapshot().state.visible, null);
    const b = register(B);
    transport.fire('onShow');
    assert.equal(broker.getSnapshot().state.visible, null);
    b.release();
    a.release();
    assert.equal(transport.availabilityListeners.size, 0);
});

test('disabled, absent/empty external ID, no platform and server admission allocate no provider operations', () => {
    for (const variant of [
        'disabled',
        'missing',
        'empty',
        'space',
        'ssr',
        'server',
    ] as const) {
        const transport = legacyPlatform();
        const adapter = createIntercomCustomerChatAdapter({
            enabled: variant !== 'disabled',
            platform: variant === 'ssr' ? undefined : transport.platform,
            existingProvider: 'reject',
        });
        const broker = createCustomerChatBroker({
            isSameConfiguration: (a, b) =>
                JSON.stringify(a) === JSON.stringify(b),
            arbitration: 'last-registered',
            environment: variant === 'server' ? 'server' : 'client',
            adapter,
            isSameIdentity: Object.is,
        });
        const configuration = {
            appId:
                variant === 'missing'
                    ? undefined
                    : variant === 'empty'
                      ? ''
                      : variant === 'space'
                        ? '  '
                        : A.appId,
        } as IntercomCustomerConfiguration;
        const lease = broker.register({
            identity: configuration,
            configuration,
        });
        broker.acquireLauncherHide()();
        assert.notEqual(lease.showNewMessage('prohibited'), 'accepted');
        lease.release();
        assert.equal(transport.loads, 0, variant);
        assert.equal(transport.reads, 0, variant);
        assert.equal(transport.boots, 0, variant);
        assert.equal(transport.availabilityListeners.size, 0, variant);
    }
});

test('pre-existing widget requires explicit host handoff', () => {
    const transport = legacyPlatform({ existing: true });
    const broker = createCustomerChatBroker({
        isSameConfiguration: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        arbitration: 'last-registered',
        environment: 'client',
        isSameIdentity: Object.is,
        adapter: createIntercomCustomerChatAdapter({
            enabled: true,
            platform: transport.platform,
            existingProvider: 'reject',
        }),
    });
    const lease = broker.register({ identity: A, configuration: A });
    assert.equal(lease.showNewMessage('rejected'), 'unavailable');
    lease.release();
    assert.equal(transport.loads, 0);
    assert.equal(transport.calls.length, 0);
});

test('failed cold acquisition cannot authorize a later unrelated widget', () => {
    const transport = legacyPlatform();
    let loads = 0;
    transport.platform.loadIntercom = () => {
        loads++;
        throw new Error('Synthetic loading refusal');
    };
    const broker = createCustomerChatBroker({
        arbitration: 'last-registered',
        environment: 'client',
        isSameIdentity: Object.is,
        isSameConfiguration: Object.is,
        adapter: createIntercomCustomerChatAdapter({
            enabled: true,
            platform: transport.platform,
            existingProvider: 'reject',
        }),
    });
    const first = broker.register({ identity: A, configuration: A });
    let foreignCommands = 0;
    transport.platform.getCommand = () => () => {
        foreignCommands++;
    };
    const next = broker.register({ identity: B, configuration: B });
    assert.equal(next.showNewMessage('must be rejected'), 'unavailable');
    next.release();
    first.release();
    assert.equal(loads, 1);
    assert.equal(foreignCommands, 0);
});

test('host identity can preserve native absent versus empty without generic fallback', () => {
    const identities: (string | undefined)[] = [];
    const broker = createCustomerChatBroker({
        isSameConfiguration: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        arbitration: 'last-registered',
        environment: 'client',
        isSameIdentity: (a: string | undefined, b) => a === b,
        adapter: {
            connect(configuration: string | undefined) {
                identities.push(configuration);
                return {
                    getState: () => ({
                        loading: 'idle',
                        boot: 'idle',
                        available: false,
                        visible: null,
                    }),
                    subscribe: () => () => {},
                    setLauncherHidden: () => 'unavailable',
                    showNewMessage: () => 'unavailable',
                    retire() {},
                };
            },
        },
    });
    const absent = broker.register({
        identity: undefined,
        configuration: undefined,
    });
    const empty = broker.register({ identity: '', configuration: '' });
    empty.release();
    absent.release();
    assert.deepEqual(identities, [undefined, '', undefined]);
});

test('actual historical driver preserves its native undefined fallback and explicit empty ID', () => {
    const transport = legacyPlatform();
    transport.platform.loadIntercom({
        appId: A.appId,
        initWindow: false,
        callBack() {},
    });
    transport.nativeBoot(undefined);
    transport.nativeBoot('');
    assert.deepEqual(
        transport
            .queued()
            .filter(([name]) => name === 'boot')
            .map(([, value]) => (value as { app_id: string }).app_id),
        [A.appId, '']
    );
});

test('host getCommand reentrancy cannot redirect a prior owner command', () => {
    const { transport, broker, register } = setup({ existing: true });
    const a = register(A);
    const original = transport.platform.getCommand;
    let switchNow = true;
    transport.platform.getCommand = () => {
        if (switchNow) {
            switchNow = false;
            register(B);
        }
        return original();
    };
    assert.equal(a.showNewMessage('must be refused'), 'inactive');
    assert.equal(
        transport.calls.filter(([name]) => name === 'showNewMessage').length,
        0
    );
    assert.equal(broker.getSnapshot().customerCount, 2);
    a.release();
});

test('reentrant availability cleanup cannot shut down or overwrite replacement', () => {
    const { transport, broker, register } = setup({ existing: true });
    const original = transport.platform.subscribeAvailability!;
    let replace = false;
    transport.platform.subscribeAvailability = (listener) => {
        const remove = original(listener);
        return () => {
            remove();
            if (replace) {
                replace = false;
                register({ appId: 'synthetic-C' });
            }
        };
    };
    register(A);
    replace = true;
    const b = register(B);
    assert.equal(b.isActive(), false);
    assert.equal(broker.getSnapshot().state.boot, 'accepted');
    assert.deepEqual(
        transport.calls
            .filter(([name]) => name === 'boot')
            .map(([, value]) => (value as { app_id: string }).app_id),
        [A.appId, 'synthetic-C']
    );
    assert.equal(
        transport.calls.filter(([name]) => name === 'shutdown').length,
        1
    );
});

test('broker subscription reentrancy and failure preserve the newer connection', () => {
    let trigger = true;
    let newestActive = false;
    let broker: ReturnType<typeof createCustomerChatBroker<string, string>>;
    broker = createCustomerChatBroker({
        arbitration: 'last-registered',
        environment: 'client',
        isSameIdentity: Object.is,
        isSameConfiguration: Object.is,
        adapter: {
            connect(configuration) {
                return {
                    getState: () => ({
                        loading: 'idle',
                        boot: 'accepted',
                        available: true,
                        visible: null,
                    }),
                    subscribe() {
                        if (trigger) {
                            trigger = false;
                            broker.register({
                                identity: 'B',
                                configuration: 'B',
                            });
                            throw new Error('old subscribe failed');
                        }
                        newestActive = true;
                        return () => {
                            newestActive = false;
                        };
                    },
                    setLauncherHidden: () => 'accepted',
                    showNewMessage: () =>
                        configuration === 'B' ? 'accepted' : 'failed',
                    retire() {},
                };
            },
        },
    });
    broker.register({ identity: 'A', configuration: 'A' });
    assert.equal(newestActive, true);
    assert.equal(broker.getSnapshot().state.boot, 'accepted');
    assert.equal(broker.getSnapshot().customerCount, 2);
});
