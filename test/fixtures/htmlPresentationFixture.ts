import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement, StrictMode, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

/**
 * Owned synthetic DOM boundary, not an HTML policy or component double.
 * React and all SDK components/sanitization remain real. Only layout values
 * and ResizeObserver notifications are controlled; happyDOM does not provide
 * browser layout. Resource loading is disabled for this source-only DOM so
 * supported persisted images/frames cannot create a real provider request.
 */
export async function htmlPresentationFixture(t: TestContext) {
    const pageURL = 'https://html-presentation.example.test/';
    const window = new Window({
        url: pageURL,
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
            disableIframePageLoading: true,
        },
    });
    let root: Root | undefined;
    let requests = 0;
    let submits = 0;
    let geometry = { clientHeight: 0, scrollHeight: 0 };
    const observers = new Set<ObserverBoundary>();
    class ObserverBoundary {
        readonly elements = new Set<unknown>();
        constructor(readonly callback: () => void) {
            observers.add(this);
        }
        observe(element: unknown) {
            this.elements.add(element);
        }
        unobserve(element: unknown) {
            this.elements.delete(element);
        }
        disconnect() {
            this.elements.clear();
        }
    }
    const rejectRequest = async () => {
        requests++;
        throw new Error('Unexpected HTML presentation request');
    };
    const values = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        HTMLInputElement: window.HTMLInputElement,
        HTMLTextAreaElement: window.HTMLTextAreaElement,
        Element: window.Element,
        Node: window.Node,
        NodeFilter: window.NodeFilter,
        DocumentFragment: window.DocumentFragment,
        CustomEvent: window.CustomEvent,
        MutationObserver: window.MutationObserver,
        getComputedStyle: window.getComputedStyle.bind(window),
        HTMLDivElement: window.HTMLDivElement,
        HTMLAnchorElement: window.HTMLAnchorElement,
        HTMLImageElement: window.HTMLImageElement,
        ResizeObserver: ObserverBoundary,
        IS_REACT_ACT_ENVIRONMENT: true,
        fetch: rejectRequest,
    };
    const originals = Object.keys(values).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    const geometryOriginals = ['clientHeight', 'scrollHeight'].map(
        (key) =>
            [
                key,
                Object.getOwnPropertyDescriptor(
                    window.HTMLElement.prototype,
                    key
                ),
            ] as const
    );
    const unchangedEffects = () => {
        assert.equal(requests, 0);
        assert.equal(submits, 0);
        assert.equal(window.location.href, pageURL);
    };
    t.after(async () => {
        try {
            if (root) await act(async () => root?.unmount());
            // Radix FocusScope schedules its unmount autofocus event at zero
            // delay. Complete that real external lifecycle before removing the
            // platform realm used by CustomEvent/document in its cleanup.
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            assert.equal(
                [...observers].filter((entry) => entry.elements.size > 0)
                    .length,
                0
            );
            unchangedEffects();
        } finally {
            for (const [key, descriptor] of geometryOriginals) {
                if (descriptor)
                    Object.defineProperty(
                        window.HTMLElement.prototype,
                        key,
                        descriptor
                    );
                else Reflect.deleteProperty(window.HTMLElement.prototype, key);
            }
            for (const [key, descriptor] of originals) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });
    for (const [key, value] of Object.entries(values)) {
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value,
        });
    }
    Object.defineProperty(window, 'fetch', {
        configurable: true,
        value: rejectRequest,
    });
    Object.defineProperty(window, 'ResizeObserver', {
        configurable: true,
        value: ObserverBoundary,
    });
    for (const key of ['clientHeight', 'scrollHeight'] as const) {
        Object.defineProperty(window.HTMLElement.prototype, key, {
            configurable: true,
            get: () => geometry[key],
        });
    }
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('form');
    container.id = 'html-presentation-owner';
    container.addEventListener('submit', (event) => {
        submits++;
        event.preventDefault();
    });
    window.document.body.append(container);
    root = createRoot(container as unknown as HTMLElement);
    const render = async (node: ReactNode, strict = true) => {
        await act(async () =>
            root?.render(strict ? createElement(StrictMode, null, node) : node)
        );
        unchangedEffects();
    };
    const click = async (element: { click(): void }) => {
        await act(async () => element.click());
        unchangedEffects();
    };
    const resize = async () => {
        await act(async () => {
            window.dispatchEvent(new window.Event('resize'));
        });
        unchangedEffects();
    };
    const imageEvent = async (
        element: ReturnType<typeof window.document.createElement>,
        type: 'load' | 'error'
    ) => {
        await act(async () => {
            element.dispatchEvent(new window.Event(type));
        });
        unchangedEffects();
    };
    const notifyObservers = async () => {
        await act(async () => {
            for (const observer of [...observers]) {
                if (observer.elements.size > 0) observer.callback();
            }
        });
        unchangedEffects();
    };
    return {
        window,
        container,
        render,
        click,
        resize,
        imageEvent,
        setGeometry(next: typeof geometry) {
            geometry = next;
        },
        notifyObservers,
        activeObserverCount: () =>
            [...observers].filter((entry) => entry.elements.size > 0).length,
        unchangedEffects,
    };
}
