import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CompleteReadOnlyPhoneNumberField } from '../src/react/index.js';

async function mount(t: TestContext, node: ReactNode) {
    const window = new Window();
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLAnchorElement',
        'IS_REACT_ACT_ENVIRONMENT',
        'fetch',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    let requests = 0;
    const rejectRequest = async () => {
        requests++;
        throw Error('Unexpected request from read-only phone presentation');
    };
    let root: import('react-dom/client').Root | undefined;
    t.after(async () => {
        try {
            if (root != null) {
                const mountedRoot = root;
                await act(async () => mountedRoot.unmount());
            }
        } finally {
            keys.forEach((key, index) => {
                if (originals[index])
                    Object.defineProperty(globalThis, key, originals[index]!);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
        assert.equal(requests, 0);
    });
    Object.defineProperty(window, 'fetch', { value: rejectRequest });
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'fetch'
                      ? rejectRequest
                      : window[key as keyof Window],
        });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('div');
    window.document.body.append(container);
    const mountedRoot = createRoot(container as unknown as HTMLElement);
    root = mountedRoot;
    const render = async (next: ReactNode) => {
        await act(async () => mountedRoot.render(h(StrictMode, null, next)));
        assert.equal(requests, 0);
    };
    await render(node);
    return { window, container, render };
}

it('server-renders the saved telephone text and href literally without markup injection', async () => {
    assert.equal(typeof globalThis.document, 'undefined');
    const value = '  +1 (202) 555-0100 <em>extension</em> & "desk"  ';
    const html = renderToStaticMarkup(
        h(CompleteReadOnlyPhoneNumberField, {
            value,
            emptyLabel: 'No saved phone',
        })
    );
    const window = new Window();
    try {
        window.document.body.innerHTML = html;
        const link = window.document.querySelector('a');
        assert.ok(link);
        assert.equal(link.textContent, value);
        // Happy DOM 20 only decodes quote/amp entities in parsed attributes.
        // Assert the actual SSR serialization here; CSR below asserts raw DOM.
        assert.ok(
            html.includes(
                'href="tel:  +1 (202) 555-0100 &lt;em&gt;extension&lt;/em&gt; &amp; &quot;desk&quot;  "'
            )
        );
        assert.equal(link.getAttribute('target'), '_blank');
        assert.equal(link.getAttribute('rel'), 'noreferrer');
        assert.equal(
            window.document.querySelector('em,script,img,iframe'),
            null
        );
        assert.equal(
            window.document.querySelector('input,select,button'),
            null
        );
    } finally {
        await window.happyDOM.close();
    }
});

it('server-renders the supplied empty message as text', async () => {
    const emptyLabel = '<em>لا توجد قيمة</em> & "empty"';
    const html = renderToStaticMarkup(
        h(CompleteReadOnlyPhoneNumberField, { value: null, emptyLabel })
    );
    const window = new Window();
    try {
        window.document.body.innerHTML = html;
        assert.equal(window.document.body.textContent, emptyLabel);
        assert.equal(window.document.querySelector('a,em,input,select'), null);
        const icon = window.document.querySelector('svg');
        assert.ok(icon);
        assert.equal(icon.getAttribute('aria-hidden'), 'true');
        assert.equal(icon.getAttribute('focusable'), 'false');
    } finally {
        await window.happyDOM.close();
    }
});

it('uses the localized empty message only for null, undefined or the empty string', async (t) => {
    const emptyLabel = 'لا توجد قيمة';
    const f = await mount(
        t,
        h(CompleteReadOnlyPhoneNumberField, { value: null, emptyLabel })
    );
    for (const value of [null, undefined, ''] as const) {
        await f.render(
            h(CompleteReadOnlyPhoneNumberField, { value, emptyLabel })
        );
        assert.equal(f.container.textContent, emptyLabel);
        assert.equal(f.container.querySelector('a'), null);
    }
    for (const value of [
        '   ',
        'not a phone',
        '0044 020-0000 ext. 42',
        '<em>not markup</em> & "desk"',
    ]) {
        await f.render(
            h(CompleteReadOnlyPhoneNumberField, { value, emptyLabel })
        );
        const link = f.container.querySelector('a');
        assert.ok(link);
        assert.equal(link.textContent, value);
        assert.equal(link.getAttribute('href'), `tel:${value}`);
        assert.equal(f.container.querySelector('input,select,button'), null);
        assert.equal(f.container.querySelector('em,script,img,iframe'), null);
    }
    await f.render(
        h(CompleteReadOnlyPhoneNumberField, {
            value: '',
            emptyLabel: 'A replacement localized message',
        })
    );
    assert.equal(f.container.textContent, 'A replacement localized message');
    assert.equal(f.container.querySelector('a'), null);
});

it('stops a telephone click from selecting its parent without canceling the phone action', async (t) => {
    let parentClicks = 0;
    const value = '+233201234567';
    const f = await mount(
        t,
        h(
            'div',
            { onClick: () => parentClicks++ },
            h(CompleteReadOnlyPhoneNumberField, {
                value,
                emptyLabel: 'No saved phone',
            })
        )
    );
    const link = f.container.querySelector('a');
    assert.ok(link);
    let observedDefaultPrevented: boolean | undefined;
    let hostClicks = 0;
    // The listener is installed after createRoot's delegated listeners. It
    // observes the component's decision, then suppresses external tel navigation
    // at the test's browser boundary only.
    f.container.addEventListener('click', (event) => {
        hostClicks++;
        observedDefaultPrevented = event.defaultPrevented;
        event.preventDefault();
    });
    await act(async () => {
        link.dispatchEvent(
            new f.window.MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(parentClicks, 0);
    assert.equal(hostClicks, 1);
    assert.equal(observedDefaultPrevented, false);
    assert.equal(link.getAttribute('href'), `tel:${value}`);
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noreferrer');
});

it('forwards ordinary host layout classes on the root and link', async (t) => {
    const f = await mount(
        t,
        h(CompleteReadOnlyPhoneNumberField, {
            value: '+233201234567',
            emptyLabel: 'No value',
            className: 'host-phone',
            linkClassName: 'host-cell-text',
        })
    );
    const link = f.container.querySelector('a');
    assert.ok(link);
    assert.equal(link.parentElement?.classList.contains('host-phone'), true);
    assert.equal(link.classList.contains('mx-sdk-complete-phone-link'), true);
    assert.equal(link.classList.contains('host-cell-text'), true);
    assert.equal(link.getAttribute('href'), 'tel:+233201234567');
    await f.render(
        h(CompleteReadOnlyPhoneNumberField, {
            value: '',
            emptyLabel: 'No value',
            className: 'host-phone',
            linkClassName: 'host-cell-text',
        })
    );
    const empty = f.container.querySelector('p');
    assert.ok(empty);
    assert.equal(empty.classList.contains('mx-sdk-complete-phone-empty'), true);
    assert.equal(empty.classList.contains('host-phone'), true);
    assert.equal(empty.textContent, 'No value');
    assert.equal(f.container.querySelector('a'), null);
});
