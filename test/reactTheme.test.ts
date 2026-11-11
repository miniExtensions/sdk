import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { createPortal } from 'react-dom';
import {
    ThemeBoundary,
    getThemePortalProps,
    useThemeSnapshot,
} from '../src/react/ThemeBoundary.js';
import { getThemeStyles, type ThemeColor } from '../src/ui/index.js';

it('server renders explicit tokens without browser globals, CSS or default injection', () => {
    assert.equal(typeof document, 'undefined');
    const inherited = renderToString(h(ThemeBoundary, null, 'Inherited'));
    assert(!inherited.includes('--theme-'));
    const explicit = renderToString(
        h(ThemeBoundary, { theme: 'indigo' }, 'Standalone')
    );
    assert(explicit.includes('--theme-600:79 70 229'));
    assert(!explicit.includes('<style') && !explicit.includes('<script'));
    assert.equal(typeof document, 'undefined');
    assert.equal(getThemePortalProps({}).style, undefined);
});

async function fixture(t: TestContext) {
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
    const { createRoot } = await import('react-dom/client');
    const a = window.document.createElement('div'),
        b = window.document.createElement('div'),
        portal = window.document.createElement('div');
    window.document.body.append(a, b, portal);
    const ra = createRoot(a as unknown as HTMLElement),
        rb = createRoot(b as unknown as HTMLElement);
    let aMounted = true;
    t.after(async () => {
        if (aMounted) await act(async () => ra.unmount());
        await act(async () => rb.unmount());
        keys.forEach((key, i) => {
            if (originals[i])
                Object.defineProperty(globalThis, key, originals[i]!);
            else Reflect.deleteProperty(globalThis, key);
        });
        await window.happyDOM.close();
    });
    return {
        node(id: string) {
            const node = window.document.getElementById(id);
            assert(node instanceof window.HTMLElement);
            return node;
        },
        window,
        a,
        b,
        portal,
        render: async (node: ReactNode) =>
            act(async () => ra.render(h(StrictMode, null, node))),
        renderB: async (node: ReactNode) =>
            act(async () => rb.render(h(StrictMode, null, node))),
        unmountA: async () => {
            await act(async () => ra.unmount());
            aMounted = false;
        },
    };
}

it('inherits, replaces and restores nested scopes across A-B-A without changing independent roots or document', async (t) => {
    const f = await fixture(t);
    f.window.document.documentElement.style.setProperty('--theme-600', '9 9 9');
    await f.renderB(
        h(ThemeBoundary, { theme: 'blue', id: 'editor' }, 'Editor')
    );
    const tree = (theme: ThemeColor) =>
        h(
            ThemeBoundary,
            { theme, id: 'preview' },
            h(ThemeBoundary, { id: 'inherit' }, 'Inherited'),
            h(ThemeBoundary, { theme: 'indigo', id: 'nested' }, 'Nested')
        );
    for (const theme of ['green', 'rose', 'green'] as const) {
        await f.render(tree(theme));
        assert.equal(
            f.node('preview')!.style.getPropertyValue('--theme-600'),
            getThemeStyles(theme)['--theme-600']
        );
        assert.equal(
            f.node('inherit')!.style.getPropertyValue('--theme-600'),
            ''
        );
        assert.equal(
            f.node('nested')!.style.getPropertyValue('--theme-600'),
            '79 70 229'
        );
        assert.equal(
            f.node('editor')!.style.getPropertyValue('--theme-600'),
            '37 99 235'
        );
    }
    await f.unmountA();
    assert.equal(f.a.childElementCount, 0);
    assert.equal(
        f.node('editor')!.style.getPropertyValue('--theme-600'),
        '37 99 235'
    );
    assert.equal(
        f.window.document.documentElement.style.getPropertyValue('--theme-600'),
        '9 9 9'
    );
});

it('passes effective custom ten-token snapshots to detached DOM portals and retires only their own nodes', async (t) => {
    const f = await fixture(t);
    function Portal() {
        return createPortal(
            h(
                'div',
                { ...getThemePortalProps(useThemeSnapshot()), id: 'detached' },
                'Portal'
            ),
            f.portal as unknown as Element
        );
    }
    const tree = (theme: ThemeColor) =>
        h(
            ThemeBoundary,
            {
                theme,
                tokens: { ...getThemeStyles(theme), '--theme-600': '1 2 3' },
                id: 'local',
                style: { '--theme-500': '4 5 6' },
            },
            h(ThemeBoundary, null, h(Portal))
        );
    for (const theme of ['green', 'rose', 'green'] as const) {
        await f.render(tree(theme));
        const wrapper = f.node('detached')!;
        assert.equal(wrapper.style.getPropertyValue('--theme-600'), '1 2 3');
        assert.equal(
            wrapper.style.getPropertyValue('--theme-500'),
            getThemeStyles(theme)['--theme-500']
        );
        assert.equal(wrapper.getAttribute('data-mx-theme'), theme);
        assert.equal(
            f.node('local')!.style.getPropertyValue('--theme-500'),
            '4 5 6'
        );
        assert.equal(f.window.document.head.childElementCount, 0);
    }
    await f.unmountA();
    assert.equal(f.portal.childElementCount, 0);
    assert.equal(f.window.document.documentElement.style.length, 0);
});
