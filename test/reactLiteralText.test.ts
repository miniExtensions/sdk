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
import { LiteralText } from '../src/react/index.js';

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
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const root = createRoot(container as unknown as HTMLElement);
    t.after(async () => {
        await act(async () => root.unmount());
        keys.forEach((key, index) => {
            if (originals[index])
                Object.defineProperty(globalThis, key, originals[index]!);
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
    };
}

it('shares an actual native output/ref, literal escaped bytes, whitespace and native accessibility props', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLElement>();
    const value =
        '  <img src="https://synthetic.invalid/private" onerror="bad()">\n字  ';
    await f.render(
        h(LiteralText, {
            ref,
            value,
            id: 'literal',
            'aria-label': 'Result',
            'aria-busy': true,
            'aria-describedby': 'help',
            className: 'caller',
        })
    );
    const output = f.container.querySelector('output');
    assert(output);
    assert.equal(ref.current, output);
    assert.equal(output.textContent, value);
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(output.style.whiteSpace, 'pre-wrap');
    assert.equal(output.style.overflowWrap, 'anywhere');
    assert.equal(output.getAttribute('aria-describedby'), 'help');
    assert.equal(output.getAttribute('aria-busy'), 'true');
    assert.equal(output.className, 'caller');
    assert.equal(f.container.children.length, 1);
    await f.render(null);
    assert.equal(ref.current, null);
});

it('uses the explicit caller empty view without a wrapper while retaining zero text and default empty output', async (t) => {
    const f = await fixture(t);
    let formats = 0;
    for (const value of [undefined, null, '']) {
        await f.render(
            h(LiteralText, {
                value,
                empty: h('em', null, 'Localized empty'),
                renderText: () => {
                    formats++;
                    return 'unexpected';
                },
            })
        );
        assert.equal(f.container.firstElementChild?.tagName, 'EM');
        assert.equal(f.container.querySelector('output'), null);
    }
    assert.equal(formats, 0);
    await f.render(h(LiteralText, { value: '0', empty: 'Empty' }));
    assert.equal(f.container.querySelector('output')?.textContent, '0');
    await f.render(h(LiteralText, { value: '' }));
    assert(f.container.querySelector('output'));
    await f.render(h(LiteralText, { value: null, empty: null }));
    assert.equal(f.container.children.length, 0);
});

it('preserves a caller container, formatting subtree and native event bubbling with no added styles', async (t) => {
    const f = await fixture(t);
    const value = 'Literal URL https://example.invalid';
    let clicks = 0;
    await f.render(
        h(
            'section',
            {
                onClick: () => {
                    clicks++;
                },
            },
            h(LiteralText, {
                value,
                as: 'div',
                preserveWhitespace: false,
                className: 'relative',
                renderText: (text) =>
                    h('p', { className: 'existing-format' }, text),
            })
        )
    );
    const div = f.container.querySelector('section > div');
    assert(div);
    assert.equal(div.className, 'relative');
    assert.equal(div.getAttribute('style'), null);
    assert.equal(div.children.length, 1);
    assert.equal(div.firstElementChild?.tagName, 'P');
    assert.equal(div.textContent, value);
    await act(async () =>
        div.dispatchEvent(new f.window.MouseEvent('click', { bubbles: true }))
    );
    assert.equal(clicks, 1);
});

it('replaces display text, tag and styles without stale fallback or extra markup', async (t) => {
    const f = await fixture(t);
    const ref = createRef<HTMLElement>();
    await f.render(
        h(LiteralText, {
            ref,
            value: 'A',
            style: { whiteSpace: 'normal', display: 'inline' },
        })
    );
    assert.equal(
        f.container.querySelector('output')?.style.whiteSpace,
        'normal'
    );
    await f.render(
        h(LiteralText, {
            ref,
            value: ' B\n ',
            as: 'span',
            'aria-invalid': true,
        })
    );
    const span = f.container.querySelector('span');
    assert(span);
    assert.equal(ref.current, span);
    assert.equal(span.textContent, ' B\n ');
    assert.equal(span.style.whiteSpace, 'pre-wrap');
    assert.equal(span.getAttribute('aria-invalid'), 'true');
    assert.equal(f.container.querySelector('output'), null);
});
