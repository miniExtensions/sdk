import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type {
    IntercomCommand,
    IntercomPlatform,
} from '../src/customer-chat/intercom.js';

/** Actual historical driver, isolated behind synthetic DOM/provider boundaries. */
export function legacyPlatform(
    options: {
        existing?: boolean;
        anchor?: boolean;
        deferInsertion?: boolean;
        failOnHide?: boolean;
    } = {}
) {
    const calls: [string, unknown][] = [];
    const callbacks = new Map<string, (() => void)[]>();
    const availabilityListeners = new Set<() => void>();
    const pending: (() => void)[] = [];
    const scripts: string[] = [];
    const insertionCallbacks: (() => void)[] = [];
    let available = false;
    let loads = 0;
    let reads = 0;
    let boots = 0;
    const provider: IntercomCommand = (name, argument) => {
        calls.push([name, argument]);
        if (name === 'onHide' && options.failOnHide)
            throw new Error('synthetic listener refusal');
        if (typeof argument === 'function') {
            const list = callbacks.get(name) ?? [];
            list.push(argument as () => void);
            callbacks.set(name, list);
        }
    };
    type Queue = IntercomCommand & { q?: IArguments[] };
    const window: { Intercom?: Queue; intercomSettings?: unknown } = {};
    if (options.existing) window.Intercom = provider;
    const exports: {
        loadIntercom?: IntercomPlatform['loadIntercom'];
        initIntercomWindow?: IntercomPlatform['initIntercomWindow'];
    } = {};
    runInNewContext(
        readFileSync(
            'test/fixtures/customer-chat/intercom-next-1.3.5.cjs',
            'utf8'
        ),
        {
            exports,
            window,
            document: {
                querySelector: () => null,
                createElement: () => ({ src: '' }),
                getElementsByTagName: () =>
                    options.anchor === false
                        ? []
                        : [
                              {
                                  parentNode: {
                                      insertBefore: (script: { src: string }) =>
                                          scripts.push(script.src),
                                  },
                              },
                          ],
            },
            setTimeout: (callback: () => void) => pending.push(callback),
            console: { log() {}, warn() {}, error() {} },
            fetch: () => {
                throw new Error('Network is prohibited in this fixture');
            },
        }
    );
    const platform: IntercomPlatform = {
        loadIntercom(settings) {
            loads++;
            insertionCallbacks.push(settings.callBack);
            return exports.loadIntercom!({
                ...settings,
                ...(options.deferInsertion ? { scriptInitDelay: 1 } : {}),
            });
        },
        initIntercomWindow(settings) {
            boots++;
            return exports.initIntercomWindow!(settings);
        },
        getCommand() {
            reads++;
            return window.Intercom;
        },
        isAvailable: () => available,
        subscribeAvailability(listener) {
            availabilityListeners.add(listener);
            return () => {
                availabilityListeners.delete(listener);
            };
        },
    };
    return {
        platform,
        calls,
        scripts,
        pending,
        insertionCallbacks,
        callbacks,
        availabilityListeners,
        get loads() {
            return loads;
        },
        get reads() {
            return reads;
        },
        get boots() {
            return boots;
        },
        queued: () =>
            Array.from(window.Intercom?.q ?? [], (args) => Array.from(args)),
        nativeBoot(appId?: string) {
            exports.initIntercomWindow!({ appId } as Parameters<
                IntercomPlatform['initIntercomWindow']
            >[0]);
        },
        ready() {
            const queue = window.Intercom?.q;
            window.Intercom = provider;
            for (const args of queue ?? [])
                provider(args[0] as string, args[1]);
            available = true;
            for (const listener of [...availabilityListeners]) listener();
        },
        fire(event: string) {
            for (const callback of callbacks.get(event) ?? []) callback();
        },
    };
}
