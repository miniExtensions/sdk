import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import {
    act,
    createElement as h,
    StrictMode,
    type MouseEvent,
    type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Linkify from 'linkify-react';
import {
    CompleteReadOnlyTextField,
    LiteralText,
    type CompleteReadOnlyTextLanguage,
    type CompleteReadOnlyTextSize,
    type CompleteReadOnlyTextLayout,
} from '../src/react/index.js';

async function fixture(t: TestContext) {
    const window = new Window({ url: 'https://readonly-text.example.test/' });
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
        throw new Error('Unexpected request from read-only text presentation');
    };
    let root: import('react-dom/client').Root | undefined;
    let submits = 0;
    t.after(async () => {
        try {
            if (root != null) {
                const mountedRoot = root;
                await act(async () => mountedRoot.unmount());
            }
        } finally {
            keys.forEach((key, index) => {
                const original = originals[index];
                if (original) Object.defineProperty(globalThis, key, original);
                else Reflect.deleteProperty(globalThis, key);
            });
            await window.happyDOM.close();
        }
        assert.equal(requests, 0);
        assert.equal(submits, 0);
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
    const container = window.document.createElement('form');
    window.document.body.append(container);
    container.addEventListener('submit', (event) => {
        submits++;
        event.preventDefault();
    });
    const mountedRoot = createRoot(container as unknown as HTMLElement);
    root = mountedRoot;
    const render = async (node: ReactNode) => {
        await act(async () => mountedRoot.render(h(StrictMode, null, node)));
        assert.equal(requests, 0);
        assert.equal(submits, 0);
        assert.equal(
            window.location.href,
            'https://readonly-text.example.test/'
        );
    };
    return { window, container, render };
}

// The actual frozen native adapter is the differential oracle. The generic
// instantiation keeps its published declaration precise without an any cast.
const NativeLinkify = Linkify<{ className: string }, 'p'>;
function nativeText(value: string) {
    return h(
        NativeLinkify,
        {
            tagName: 'p',
            options: {
                target: '_blank',
                attributes: {
                    onClick: (event: MouseEvent<HTMLAnchorElement>) =>
                        event.stopPropagation(),
                },
            },
            className: 'linkify read-only-text',
        },
        value
    );
}

function anchors(node: {
    querySelectorAll(selectors: string): Iterable<{
        textContent: string | null;
        getAttribute(name: string): string | null;
    }>;
}) {
    return Array.from(node.querySelectorAll('a'), (link) => ({
        text: link.textContent,
        href: link.getAttribute('href'),
        target: link.getAttribute('target'),
        rel: link.getAttribute('rel'),
        className: link.getAttribute('class'),
    }));
}

it('server-renders escaped literal text and native links without DOM, controls or markup execution', async () => {
    assert.equal(typeof globalThis.document, 'undefined');
    const value =
        '  <img src="https://example.com/private" onerror="bad()"> & "quoted"\nhttps://example.org/a?x=1&y=2  ';
    const html = renderToStaticMarkup(
        h(CompleteReadOnlyTextField, { value, language: 'en' })
    );
    const window = new Window();
    try {
        window.document.body.innerHTML = html;
        const text = window.document.querySelector('p.read-only-text');
        assert.ok(text);
        assert.equal(text.textContent, value);
        assert.equal(window.document.querySelector('img,script,iframe'), null);
        assert.equal(
            window.document.querySelector('input,select,textarea,button'),
            null
        );
        assert.match(html, /&lt;img/);
        assert.match(html, /&amp;/);
        assert.equal(
            text.parentElement?.classList.contains(
                'mx-sdk-complete-readonly-text'
            ),
            true
        );
        assert.equal(text.parentElement?.getAttribute('style'), null);
    } finally {
        await window.happyDOM.close();
    }
    assert.equal(typeof globalThis.document, 'undefined');
});

const emptyCases: readonly [CompleteReadOnlyTextLanguage, string][] = [
    ['en', 'No Value'],
    ['es', 'Sin Valor'],
    ['fr', 'Pas de Valeur'],
    ['vi', 'Không có Giá trị'],
    ['nl', 'Geen Waarde'],
    ['de', 'Keine Wert'],
    ['ja', 'いいえ値'],
    ['ko', '아니요 값'],
    ['pt', 'Sem Valor'],
    ['cs', 'Žádná hodnota'],
    ['he', 'אין ערך'],
    ['it', 'Nessun Valore'],
    ['ka', 'არცერთი მნიშვნელობა'],
    ['zh-Hans', '没有值'],
    ['ca', 'Sense Valor'],
];

for (const [language, label] of emptyCases)
    it(
        'renders the native localized value-only empty presentation for ' +
            language,
        async (t) => {
            const f = await fixture(t);
            for (const value of [null, undefined, '']) {
                await f.render(
                    h(CompleteReadOnlyTextField, {
                        value,
                        language,
                        className: 'host-empty',
                    })
                );
                const empty = f.container.firstElementChild;
                assert.ok(empty);
                assert.equal(empty.tagName, 'P');
                assert.equal(f.container.children.length, 1);
                assert.equal(empty.textContent, label);
                assert.equal(
                    empty.getAttribute('data-testid'),
                    'no-value-test-id'
                );
                assert.equal(empty.classList.contains('host-empty'), true);
                assert.equal(
                    f.container.querySelector('div,.read-only-text'),
                    null
                );
                assert.equal(
                    f.container.querySelector('a,input,select,button'),
                    null
                );
                const icon = empty.querySelector('svg');
                assert.ok(icon);
                assert.equal(icon.getAttribute('aria-hidden'), 'true');
                assert.equal(icon.getAttribute('viewBox'), '0 0 24 24');
                assert.equal(icon.getAttribute('fill'), 'currentColor');
                assert.ok(icon.querySelector('path'));
                assert.equal(icon.querySelector('circle'), null);
                assert.equal(icon.querySelector('title'), null);
            }
        }
    );

const literalCases = [
    '0',
    '   ',
    ' first line\n second line\t  ',
    '  <b>literal</b> & "quoted"\nhttps://example.com/a?x=1&y=2  ',
    'http://example.com/a https://example.org/b www.example.com note@example.com',
    'FTP ftp://files.example.com/readme and mailto:person@example.com',
    'https://example.com/' + 'section/'.repeat(35) + '?q=long-label',
    'Malformed fragments: https:// name@ www.',
    'Repeated https://example.com/x then https://example.com/x',
];

for (const [index, value] of literalCases.entries())
    it(
        'matches actual native Linkify text, links and ordering for literal case ' +
            index,
        async (t) => {
            const f = await fixture(t);
            await f.render(
                h(
                    'section',
                    null,
                    h(
                        'article',
                        { id: 'complete' },
                        h(CompleteReadOnlyTextField, { value, language: 'en' })
                    ),
                    h('article', { id: 'native' }, nativeText(value))
                )
            );
            const complete = f.container.querySelector(
                '#complete p.read-only-text'
            );
            const native = f.container.querySelector(
                '#native p.read-only-text'
            );
            assert.ok(complete);
            assert.ok(native);
            assert.equal(complete.textContent, value);
            assert.equal(complete.textContent, native.textContent);
            assert.deepEqual(anchors(complete), anchors(native));
            assert.equal(complete.className, 'linkify read-only-text');
            assert.equal(
                complete.parentElement?.classList.contains('relative'),
                true
            );
            assert.equal(complete.parentElement?.getAttribute('style'), null);
            assert.equal(
                f.container.querySelector('b,img,script,iframe'),
                null
            );
            assert.equal(complete.querySelector('br'), null);
            assert.equal(
                f.container.querySelector('input,select,textarea,button'),
                null
            );
            assert.equal(
                f.container.querySelector('[data-testid="no-value-test-id"]'),
                null
            );
        }
    );

it('retains default HTTP, explicit HTTP/HTTPS, mailto, labels and absent rel without inventing link policy', async (t) => {
    const f = await fixture(t);
    const value =
        'http://example.com/a https://example.org/b www.example.com person@example.com';
    await f.render(h(CompleteReadOnlyTextField, { value, language: 'en' }));
    assert.deepEqual(anchors(f.container), [
        {
            text: 'http://example.com/a',
            href: 'http://example.com/a',
            target: '_blank',
            rel: null,
            className: null,
        },
        {
            text: 'https://example.org/b',
            href: 'https://example.org/b',
            target: '_blank',
            rel: null,
            className: null,
        },
        {
            text: 'www.example.com',
            href: 'http://www.example.com',
            target: '_blank',
            rel: null,
            className: null,
        },
        {
            text: 'person@example.com',
            href: 'mailto:person@example.com',
            target: '_blank',
            rel: null,
            className: null,
        },
    ]);
});

it('stops only link activation from reaching the row and leaves the default action available to the browser boundary', async (t) => {
    const f = await fixture(t);
    let rowClicks = 0;
    await f.render(
        h(
            'section',
            { onClick: () => rowClicks++ },
            h(CompleteReadOnlyTextField, {
                value: 'Open https://example.com/details from this row',
                language: 'en',
            })
        )
    );
    const link = f.container.querySelector('a');
    const text = f.container.querySelector('p.read-only-text');
    assert.ok(link);
    assert.ok(text);
    const observedDefaults: boolean[] = [];
    // Installed after createRoot's delegated listener: observe the component's
    // decision, then suppress navigation only at this test's browser boundary.
    f.container.addEventListener('click', (event) => {
        observedDefaults.push(event.defaultPrevented);
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
    assert.equal(rowClicks, 0);
    assert.deepEqual(observedDefaults, [false]);
    assert.equal(link.getAttribute('href'), 'https://example.com/details');
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), null);
    await act(async () => {
        text.dispatchEvent(
            new f.window.MouseEvent('click', {
                bubbles: true,
                cancelable: true,
            })
        );
    });
    assert.equal(rowClicks, 1);
    assert.deepEqual(observedDefaults, [false, false]);
    assert.equal(f.window.location.href, 'https://readonly-text.example.test/');
});

it('replaces links, size, locale and empty state without stale text, extra wrappers, form submission or requests', async (t) => {
    const f = await fixture(t);
    await f.render(
        h(CompleteReadOnlyTextField, {
            value: 'Old https://example.com/old',
            language: 'en',
            textSize: 'medium',
            layout: 'cell-short',
            className: 'caller-text',
        })
    );
    const first = f.container.querySelector('p.read-only-text');
    assert.ok(first);
    assert.equal(first.className, 'linkify read-only-text text-base');
    assert.equal(
        first.parentElement?.getAttribute('data-layout'),
        'cell-short'
    );
    assert.equal(first.parentElement?.classList.contains('caller-text'), true);
    await f.render(
        h(CompleteReadOnlyTextField, {
            value: 'New person@example.com\nsecond line',
            language: 'fr',
            textSize: 'large',
        })
    );
    const successor = f.container.querySelector('p.read-only-text');
    assert.ok(successor);
    assert.equal(successor.textContent, 'New person@example.com\nsecond line');
    assert.equal(successor.className, 'linkify read-only-text text-lg');
    assert.equal(successor.parentElement?.hasAttribute('data-layout'), false);
    assert.equal(
        successor.parentElement?.classList.contains('caller-text'),
        false
    );
    assert.equal(f.container.textContent?.includes('/old'), false);
    assert.deepEqual(
        anchors(successor).map((link) => link.href),
        ['mailto:person@example.com']
    );
    await f.render(h(CompleteReadOnlyTextField, { value: '', language: 'fr' }));
    assert.equal(f.container.firstElementChild?.tagName, 'P');
    assert.equal(f.container.textContent, 'Pas de Valeur');
    assert.equal(f.container.querySelector('div,.read-only-text,a'), null);
    await f.render(
        h(CompleteReadOnlyTextField, { value: '0', language: 'fr' })
    );
    assert.equal(f.container.textContent, '0');
    assert.equal(f.container.children.length, 1);
    assert.equal(
        f.container.querySelector('p.read-only-text')?.className,
        'linkify read-only-text'
    );
    assert.equal(f.container.querySelector('svg'), null);
    await f.render(null);
    assert.equal(f.container.children.length, 0);
});

it('retains native size hooks and explicit portable layout inputs without a container size default', async (t) => {
    const f = await fixture(t);
    const sizes: readonly [CompleteReadOnlyTextSize, string][] = [
        ['small', 'text-sm'],
        ['medium', 'text-base'],
        ['large', 'text-lg'],
        ['very large', 'text-xl'],
    ];
    for (const [textSize, className] of sizes) {
        await f.render(
            h(CompleteReadOnlyTextField, {
                value: 'Sized text',
                language: 'en',
                textSize,
            })
        );
        assert.equal(
            f.container.querySelector('p.read-only-text')?.className,
            'linkify read-only-text ' + className
        );
    }
    const layouts: readonly CompleteReadOnlyTextLayout[] = [
        'default',
        'linked-list',
        'cell-short',
        'cell-medium',
        'cell-tall',
        'cell-extra-tall',
        'cell-fit-content',
    ];
    for (const layout of layouts) {
        await f.render(
            h(CompleteReadOnlyTextField, {
                value: 'Portable text',
                language: 'en',
                layout,
            })
        );
        const text = f.container.querySelector('p.read-only-text');
        assert.ok(text);
        assert.equal(text.textContent, 'Portable text');
        assert.equal(text.parentElement?.getAttribute('data-layout'), layout);
        assert.equal(text.parentElement?.getAttribute('style'), null);
        assert.equal(text.className, 'linkify read-only-text');
    }
    // Actual computed geometry/ancestor clipping is owned by packed browser
    // checks; happy-dom attribute assertions do not establish layout parity.
});

it('keeps the generic LiteralText default inert while the complete component owns native automatic links', async (t) => {
    const f = await fixture(t);
    const value = 'Literal https://example.com/path';
    await f.render(
        h(
            'section',
            null,
            h('article', { id: 'generic' }, h(LiteralText, { value })),
            h(
                'article',
                { id: 'complete' },
                h(CompleteReadOnlyTextField, { value, language: 'en' })
            )
        )
    );
    const generic = f.container.querySelector('#generic');
    const complete = f.container.querySelector('#complete');
    assert.ok(generic);
    assert.ok(complete);
    assert.equal(generic.textContent, value);
    assert.equal(generic.querySelectorAll('a').length, 0);
    assert.equal(complete.querySelectorAll('a').length, 1);
    assert.equal(complete.textContent, value);
});
