import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    createRef,
    StrictMode,
    type ReactNode,
} from 'react';
import { RecoverableImage } from '../src/react/index.js';

async function fixture(t: TestContext) {
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
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, i) => {
            if (previous[i])
                Object.defineProperty(globalThis, key, previous[i]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        window,
        container,
        render: async (node: ReactNode) => {
            await act(async () => root.render(h(StrictMode, null, node)));
        },
        error: async () => {
            const img = container.querySelector('img');
            assert(img);
            await act(async () => img.dispatchEvent(new window.Event('error')));
        },
        fallback: (retry: () => void) =>
            h('button', { type: 'button', onClick: retry }, 'Localized retry'),
    };
}

it('forwards the real native image/ref and attributes without changing caller URLs or source order', async (t) => {
    const f = await fixture(t),
        ref = createRef<HTMLImageElement>();
    const first = 'https://images.example.invalid/thumb?signature=a%2Bb#view';
    const sources = Object.freeze([
        '',
        first,
        first,
        'https://images.example.invalid/original',
    ]);
    let loads = 0;
    await f.render(
        h(RecoverableImage, {
            sources,
            alt: 'Caller attachment',
            ref,
            id: 'native-image',
            className: 'native-style',
            loading: 'lazy',
            crossOrigin: 'anonymous',
            'aria-describedby': 'description',
            onLoad: () => loads++,
            renderFallback: f.fallback,
        })
    );
    const image = f.container.querySelector('img');
    assert(image);
    assert.equal(ref.current, image);
    assert.equal(f.container.childElementCount, 1);
    assert.equal(image.getAttribute('src'), first);
    assert.equal(image.alt, 'Caller attachment');
    assert.equal(image.id, 'native-image');
    assert.equal(image.className, 'native-style');
    assert.equal(image.getAttribute('loading'), 'lazy');
    assert.equal(image.getAttribute('crossorigin'), 'anonymous');
    assert.equal(image.getAttribute('aria-describedby'), 'description');
    await act(async () => image.dispatchEvent(new f.window.Event('load')));
    assert.equal(loads, 1);
    await f.error();
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        sources[3]
    );
    assert.deepEqual(sources, [
        '',
        first,
        first,
        'https://images.example.invalid/original',
    ]);
    await f.render(null);
    assert.equal(ref.current, null);
});

it('retains an equivalent chain but resets immediately when source order or identity changes', async (t) => {
    const f = await fixture(t);
    const render = (sources: string[], alt = 'Attachment') =>
        f.render(
            h(RecoverableImage, { sources, alt, renderFallback: f.fallback })
        );
    await render(['one', 'two']);
    await f.error();
    const second = f.container.querySelector('img');
    assert(second);
    assert.equal(second.getAttribute('src'), 'two');
    await render(['', 'one', 'one', 'two'], 'Current localized label');
    assert.equal(f.container.querySelector('img'), second);
    assert.equal(second.alt, 'Current localized label');
    await render(['two', 'one']);
    assert.notEqual(f.container.querySelector('img'), second);
    assert.equal(f.container.querySelector('img')?.getAttribute('src'), 'two');
});

it('consumes repeated errors once per actual native image attempt instead of skipping the fallback', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(RecoverableImage, {
            sources: ['thumbnail', 'original'],
            alt: '',
            renderFallback: f.fallback,
        })
    );
    const first = f.container.querySelector('img');
    assert(first);
    await act(async () => {
        first.dispatchEvent(new f.window.Event('error'));
        first.dispatchEvent(new f.window.Event('error'));
    });
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        'original'
    );
    assert.equal(f.container.querySelector('button'), null);
    await f.error();
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(
        f.container.querySelector('button')?.textContent,
        'Localized retry'
    );
});

it('releases the image ref on failure and starts retry at the first source with a new native element', async (t) => {
    const f = await fixture(t),
        ref = createRef<HTMLImageElement>();
    let retainedRetry: (() => void) | undefined;
    await f.render(
        h(RecoverableImage, {
            ref,
            sources: ['thumbnail', 'original'],
            alt: '',
            renderFallback: (retry) => {
                retainedRetry = retry;
                return f.fallback(retry);
            },
        })
    );
    const first = f.container.querySelector('img');
    await f.error();
    await f.error();
    assert.equal(ref.current, null);
    const staleRetry = retainedRetry;
    assert(staleRetry);
    const retry = f.container.querySelector('button');
    assert(retry);
    await act(async () => retry.click());
    const next = f.container.querySelector('img');
    assert(next);
    assert.notEqual(next, first);
    assert.equal(ref.current, next);
    assert.equal(next.getAttribute('src'), 'thumbnail');
    await act(async () => staleRetry());
    assert.equal(f.container.querySelector('img'), next);
});

it('renders caller fallback for an empty chain and retires old retry callbacks on source replacement', async (t) => {
    const f = await fixture(t);
    let oldRetry: (() => void) | undefined;
    await f.render(
        h(RecoverableImage, {
            sources: [],
            alt: '',
            renderFallback: (retry) => {
                oldRetry = retry;
                return h('span', null, 'No image');
            },
        })
    );
    assert.equal(f.container.textContent, 'No image');
    assert.equal(f.container.querySelector('img'), null);
    await f.render(
        h(RecoverableImage, {
            sources: ['current'],
            alt: '',
            renderFallback: f.fallback,
        })
    );
    const current = f.container.querySelector('img');
    assert(current);
    assert(oldRetry);
    await act(async () => oldRetry?.());
    assert.equal(f.container.querySelector('img'), current);
    assert.equal(current.getAttribute('src'), 'current');
});
