import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import type { TestContext } from 'node:test';

export async function scannerDom(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'Window',
        'Document',
        'DocumentFragment',
        'EventTarget',
        'Node',
        'NodeFilter',
        'Element',
        'HTMLElement',
        'SVGElement',
        'ShadowRoot',
        'Event',
        'CustomEvent',
        'MouseEvent',
        'PointerEvent',
        'KeyboardEvent',
        'FocusEvent',
        'HTMLInputElement',
        'HTMLTextAreaElement',
        'HTMLSelectElement',
        'HTMLAnchorElement',
        'HTMLIFrameElement',
        'HTMLButtonElement',
        'HTMLFieldSetElement',
        'HTMLLegendElement',
        'HTMLFormElement',
        'HTMLVideoElement',
        'HTMLImageElement',
        'MutationObserver',
        'ResizeObserver',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'getComputedStyle',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'Window'
                      ? Window
                      : [
                              'requestAnimationFrame',
                              'cancelAnimationFrame',
                              'getComputedStyle',
                          ].includes(key)
                        ? (window[key as keyof Window] as Function).bind(window)
                        : window[key as keyof Window],
        });
    // happy-dom has no MediaStream implementation; model only that media boundary.
    const sources = new WeakMap<object, unknown>();
    Object.defineProperty(window.HTMLMediaElement.prototype, 'srcObject', {
        configurable: true,
        get() {
            return sources.get(this);
        },
        set(value: unknown) {
            sources.set(this, value);
        },
    });
    const mediaDevices = {
        async getUserMedia(): Promise<MediaStream> {
            throw Error('Unconfigured synthetic media');
        },
    };
    Object.defineProperty(window.navigator, 'mediaDevices', {
        configurable: true,
        value: mediaDevices,
    });
    const { createRoot } = await import('react-dom/client');
    const host = window.document.createElement('main');
    window.document.body.append(host);
    const root = createRoot(host as unknown as HTMLElement);
    let mounted = true;
    const unmount = async () => {
        if (mounted) {
            mounted = false;
            await act(async () => root.unmount());
        }
    };
    t.after(async () => {
        try {
            await unmount();
        } finally {
            await window.happyDOM.close();
            keys.forEach((key, i) => {
                const old = originals[i];
                if (old) Object.defineProperty(globalThis, key, old);
                else Reflect.deleteProperty(globalThis, key);
            });
        }
    });
    const render = async (node: ReactNode, strict = false) => {
        await act(async () =>
            root.render(strict ? h(StrictMode, null, node) : node)
        );
    };
    const tick = async () => {
        await act(async () => {
            await new Promise<void>((resolve) =>
                window.requestAnimationFrame(() => resolve())
            );
        });
    };
    const click = async (text: string) => {
        const button = Array.from(
            window.document.querySelectorAll('button')
        ).find(
            (b) =>
                b.textContent === text || b.getAttribute('aria-label') === text
        );
        if (!button) throw Error('Missing button ' + text);
        await act(async () => button.click());
    };
    return {
        window,
        mediaDevices,
        document: window.document,
        host,
        render,
        click,
        tick,
        unmount,
    };
}
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
export function cameraStream() {
    let stops = 0;
    const track = {
        stop() {
            stops++;
        },
    };
    return {
        stream: {
            getTracks: () => [track],
            getVideoTracks: () => [track],
        } as unknown as MediaStream,
        stops: () => stops,
    };
}
