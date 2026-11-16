import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import {
    FormCaptcha,
    type FormCaptchaProps,
} from '../src/react/FormCaptcha.js';
import type {
    FormCaptchaHost,
    FormCaptchaCallbacks,
    FormCaptchaSnapshot,
} from '../src/ui/formCaptcha.js';

function hostFixture() {
    const listeners = new Set<() => void>();
    const widgets: {
        callbacks: FormCaptchaCallbacks<object>;
        node: HTMLElement;
        removed: number;
        resets: number;
    }[] = [];
    let loads = 0;
    let writes = 0;
    const owner = {};
    let snapshot: FormCaptchaSnapshot<object, null> = {
        owner,
        configurationRevision: 0,
        enabled: true,
        editable: true,
        verified: false,
        options: null,
        token: { value: null, revision: {}, owner, configurationRevision: 0 },
        provider: {
            load() {
                loads++;
                return {
                    render(container, _options, callbacks) {
                        const node =
                            container.ownerDocument.createElement('button');
                        node.type = 'button';
                        node.textContent = 'Synthetic widget';
                        container.append(node);
                        const widget = {
                            callbacks,
                            node,
                            removed: 0,
                            resets: 0,
                        };
                        widgets.push(widget);
                        return {
                            reset() {
                                widget.resets++;
                                callbacks.change(null);
                            },
                            remove() {
                                widget.removed++;
                                node.remove();
                                callbacks.change(null);
                            },
                        };
                    },
                };
            },
        },
    };
    const emit = () => {
        for (const changed of [...listeners]) changed();
    };
    const host: FormCaptchaHost<object, null> = {
        read: () => snapshot,
        subscribe(changed) {
            listeners.add(changed);
            return () => {
                listeners.delete(changed);
            };
        },
        publish(scope, value) {
            if (
                scope.owner !== snapshot.owner ||
                scope.configurationRevision !==
                    snapshot.configurationRevision ||
                !snapshot.enabled ||
                !snapshot.editable ||
                snapshot.verified
            )
                return { status: 'refused' };
            writes++;
            snapshot = {
                ...snapshot,
                token: { ...scope, value, revision: {} },
            };
            emit();
            return { status: 'admitted' };
        },
        invalidate(scope, token) {
            if (
                scope.owner !== snapshot.owner ||
                token.revision !== snapshot.token.revision ||
                scope.configurationRevision !==
                    snapshot.token.configurationRevision
            )
                return { status: 'refused' };
            snapshot = {
                ...snapshot,
                token: { ...snapshot.token, value: null, revision: {} },
            };
            emit();
            return { status: 'admitted' };
        },
        notify() {},
    };
    return {
        host,
        widgets,
        get loads() {
            return loads;
        },
        get writes() {
            return writes;
        },
        get listeners() {
            return listeners.size;
        },
        read: () => snapshot,
        update(patch: Partial<typeof snapshot>) {
            snapshot = { ...snapshot, ...patch };
            emit();
        },
    };
}

async function dom(t: TestContext) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
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
                    : window[key as keyof Window],
        });
    const { createRoot, hydrateRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    t.after(async () => {
        keys.forEach((key, i) =>
            originals[i]
                ? Object.defineProperty(globalThis, key, originals[i]!)
                : Reflect.deleteProperty(globalThis, key)
        );
        await window.happyDOM.close();
    });
    return { window, container, createRoot, hydrateRoot };
}

test('preview is an inert localized actual component in SSR and StrictMode', async (t) => {
    const props = {
        mode: 'preview' as const,
        labels: { title: 'Prueba', preview: 'Vista previa' },
    };
    const html = renderToString(h(FormCaptcha, props));
    assert.match(html, /Vista previa/);
    assert.match(html, /aria-disabled="true"/);
    const f = await dom(t);
    const root = f.createRoot(f.container as unknown as HTMLElement);
    await act(async () =>
        root.render(h(StrictMode, null, h(FormCaptcha, props)))
    );
    assert.equal(f.container.querySelector('button,iframe,script,input'), null);
    assert.equal(
        f.container.querySelector('section')?.getAttribute('aria-label'),
        'Prueba'
    );
    await act(async () => root.unmount());
});

test('all closed gates are hidden during cold SSR without provider loading', () => {
    for (const patch of [
        { enabled: false },
        { editable: false },
        { verified: true },
    ]) {
        const f = hostFixture();
        f.update(patch);
        const html = renderToString(
            h(FormCaptcha<object, null>, { mode: 'controlled', host: f.host })
        );
        assert.match(html, /hidden=""/);
        assert.equal(f.loads, 0);
        assert.equal(f.listeners, 0);
    }
});

test('actual hydration and StrictMode own a widget, preserve cosmetic updates, retire hidden UI and remove listeners', async (t) => {
    const f = hostFixture();
    const view = (title = 'CAPTCHA') =>
        h(
            StrictMode,
            null,
            h(FormCaptcha<object, null>, {
                mode: 'controlled',
                host: { ...f.host },
                labels: { title },
            })
        );
    const html = renderToString(view());
    assert.equal(f.loads, 0);
    const d = await dom(t);
    d.container.innerHTML = html;
    const errors: unknown[] = [];
    let root!: ReturnType<typeof d.hydrateRoot>;
    await act(async () => {
        root = d.hydrateRoot(d.container as unknown as HTMLElement, view(), {
            onRecoverableError: (error) => errors.push(error),
        });
    });
    assert.deepEqual(errors, []);
    assert.equal(d.container.querySelectorAll('button').length, 1);
    const active = f.widgets.at(-1)!;
    const loads = f.loads;
    await act(async () => root.render(view('Changed title')));
    assert.equal(f.loads, loads);
    assert.equal(active.removed, 0);
    await act(async () => active.callbacks.change({ synthetic: true }));
    assert.equal(f.writes, 1);
    await act(async () => f.update({ editable: false }));
    assert.equal(d.container.querySelector('button'), null);
    assert.equal(active.removed, 1);
    active.callbacks.expired();
    assert.equal(f.writes, 1);
    await act(async () => f.update({ editable: true }));
    assert.equal(d.container.querySelectorAll('button').length, 1);
    await act(async () => root.unmount());
    assert.equal(f.listeners, 0);
    assert.equal(d.container.children.length, 0);
});

test('separate mounted components never remove sibling widget resources', async (t) => {
    const f = hostFixture();
    const d = await dom(t);
    const root = d.createRoot(d.container as unknown as HTMLElement);
    const view = (first: boolean) =>
        h(
            'div',
            null,
            first &&
                h(FormCaptcha<object, null>, {
                    key: 'one',
                    mode: 'controlled',
                    host: f.host,
                }),
            h(FormCaptcha<object, null>, {
                key: 'two',
                mode: 'controlled',
                host: f.host,
            })
        );
    await act(async () => root.render(view(true)));
    assert.equal(d.container.querySelectorAll('button').length, 2);
    await act(async () => root.render(view(false)));
    assert.equal(d.container.querySelectorAll('button').length, 1);
    assert.equal(f.widgets[0].removed, 1);
    assert.equal(f.widgets[1].removed, 0);
    await act(async () => root.unmount());
});

test('preview and controlled modes replace resources without sharing provider authority', async (t) => {
    const f = hostFixture();
    const d = await dom(t);
    const root = d.createRoot(d.container as unknown as HTMLElement);
    await act(async () =>
        root.render(
            h(FormCaptcha<object, null>, { mode: 'controlled', host: f.host })
        )
    );
    const old = f.widgets[0];
    await act(async () => root.render(h(FormCaptcha, { mode: 'preview' })));
    assert.equal(old.removed, 1);
    assert.equal(f.listeners, 0);
    assert.equal(d.container.querySelector('button'), null);
    old.callbacks.change({ synthetic: true });
    assert.equal(f.writes, 0);
    await act(async () => root.unmount());
});

// @ts-expect-error preview cannot receive provider or canonical host authority
const mixed: FormCaptchaProps = { mode: 'preview', host: {} };
// @ts-expect-error controlled widgets require canonical host authority
const unowned: FormCaptchaProps = { mode: 'controlled' };
void mixed;
void unowned;
