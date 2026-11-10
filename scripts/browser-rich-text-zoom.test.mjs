import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { completeRichTextZoomKeyboardReady } from './browser-complete-rich-text-checks.mjs';

const require = createRequire(import.meta.url);
const ImageZoom =
    require('../vendor/rich-markdown-editor/dependencies/react-medium-image-zoom/lib/ImageZoom.js').default;
const { transitionDuration } =
    require('../vendor/rich-markdown-editor/dependencies/react-medium-image-zoom/lib/defaults.js').default;

// Exercise the actual adapted zoom, portal and window listeners. This DOM clock
// regression does not claim native image decoding, geometry or keyboard proof.
async function zoomFixture(t) {
    const window = new Window({ url: 'https://zoom.synthetic.invalid/' });
    const { document } = window;
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'Node',
        'IS_REACT_ACT_ENVIRONMENT',
    ];
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    let root;
    t.after(async () => {
        try {
            if (root) await act(async () => root.unmount());
        } finally {
            try {
                t.mock.timers.reset();
            } finally {
                try {
                    await window.happyDOM.close();
                } finally {
                    keys.forEach((key, index) => {
                        if (originals[index]) {
                            Object.defineProperty(
                                globalThis,
                                key,
                                originals[index]
                            );
                        } else {
                            Reflect.deleteProperty(globalThis, key);
                        }
                    });
                }
            }
        }
    });
    for (const key of keys) {
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : window[key],
        });
    }
    const { createRoot } = await import('react-dom/client');
    const container = document.createElement('main');
    const focusTarget = document.createElement('button');
    focusTarget.textContent = 'Owned focus target';
    document.body.append(container, focusTarget);
    focusTarget.focus();
    root = createRoot(container);
    const calls = [];
    const render = async (owner = 'original') => {
        await act(async () =>
            root.render(
                h(
                    StrictMode,
                    null,
                    h(ImageZoom, {
                        key: owner,
                        image: {
                            src: `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>#${owner}`,
                            alt: owner,
                            width: 100,
                            height: 80,
                        },
                        onZoom: () => calls.push(`${owner}:zoom`),
                        onUnzoom: () => calls.push(`${owner}:unzoom`),
                    })
                )
            )
        );
        return container.querySelector('img');
    };
    const image = await render();
    assert(image);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const portalCount = () => document.querySelectorAll('body > div').length;
    const tick = async (ms) => act(async () => t.mock.timers.tick(ms));
    const escape = async () =>
        act(async () =>
            window.dispatchEvent(
                new window.KeyboardEvent('keydown', {
                    key: 'Escape',
                    keyCode: 27,
                    bubbles: true,
                    cancelable: true,
                })
            )
        );
    const probeWithoutEffects = () => {
        const html = document.body.innerHTML;
        const focus = document.activeElement;
        const beforeCalls = [...calls];
        const ready = completeRichTextZoomKeyboardReady();
        assert.equal(document.body.innerHTML, html);
        assert.equal(document.activeElement, focus);
        assert.deepEqual(calls, beforeCalls);
        return ready;
    };
    await act(async () => image.click());
    assert.equal(portalCount(), 1);
    assert.equal(image.style.visibility, 'hidden');
    assert.deepEqual(calls, ['original:zoom']);
    return {
        image,
        render,
        calls,
        window,
        portalCount,
        tick,
        escape,
        probeWithoutEffects,
    };
}

test('real zoom keyboard readiness waits for its listener, then Escape retires its portal', async (t) => {
    const f = await zoomFixture(t);
    assert.equal(f.probeWithoutEffects(), false);
    // Reproduce the native failure: a committed portal alone is not ready.
    await f.escape();
    assert.equal(f.portalCount(), 1);
    assert.deepEqual(f.calls, ['original:zoom']);
    await f.tick(transitionDuration - 1);
    assert.equal(f.probeWithoutEffects(), false);
    await f.tick(1);
    assert.equal(f.probeWithoutEffects(), true);
    await f.escape();
    assert.equal(f.portalCount(), 1);
    assert.equal(f.image.style.visibility, 'hidden');
    await f.tick(transitionDuration - 1);
    assert.equal(f.portalCount(), 1);
    await f.tick(1);
    assert.equal(f.portalCount(), 0);
    assert.equal(f.image.style.visibility, '');
    assert.equal(f.window.document.activeElement, f.image);
    assert.deepEqual(f.calls, ['original:zoom', 'original:unzoom']);
    assert.equal(f.probeWithoutEffects(), false);
});

for (const phase of ['opening', 'closing']) {
    test(`real zoom owner replacement during ${phase} retires listeners, portal and deferred focus`, async (t) => {
        const f = await zoomFixture(t);
        if (phase === 'closing') {
            await f.tick(transitionDuration);
            assert.equal(f.probeWithoutEffects(), true);
            await f.escape();
        } else {
            await f.tick(transitionDuration - 1);
            assert.equal(f.probeWithoutEffects(), false);
        }
        const successor = await f.render('successor');
        assert(successor);
        assert.notEqual(successor, f.image);
        assert.equal(f.image.isConnected, false);
        assert.equal(successor.style.visibility, '');
        assert.equal(f.portalCount(), 0);
        assert.equal(f.probeWithoutEffects(), false);
        await f.tick(transitionDuration * 2);
        assert.equal(f.portalCount(), 0);
        assert.equal(f.probeWithoutEffects(), false);
        assert.notEqual(f.window.document.activeElement, f.image);
        assert.notEqual(f.window.document.activeElement, successor);
        assert.deepEqual(f.calls, ['original:zoom']);
    });
}
