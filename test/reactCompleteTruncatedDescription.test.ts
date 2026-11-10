import assert from 'node:assert/strict';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h } from 'react';
import { CompleteTruncatedDescription } from '../src/react/html/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

/*
 * Native source: components/reusables/TruncatedDescription.tsx and its adjacent
 * eleven-case suite. These tests exercise the real public HTML entrypoint,
 * sanitizer, Quill wrapper and disclosure, without copying an implementation
 * or installing a second sanitizer/observer lifecycle in the test.
 *
 * Geometry comes only from the fixture's external DOM getters and the bounded
 * per-element rectangles below. HappyDOM does not establish painted clipping,
 * trusted Tab traversal, image network loading or real browser layout.
 */
type Fixture = Awaited<ReturnType<typeof htmlPresentationFixture>>;

const makeLongDescription = (prefix: string) =>
    Array.from(
        { length: 8 },
        (_, index) => `<p>${prefix} ${index.toString()}</p>`
    ).join('');

function toggle(fixture: Fixture, label = 'Read more') {
    const button = fixture.container.querySelector('button');
    assert.ok(button, `Expected disclosure button: ${label}`);
    assert.equal(button.textContent, label);
    return button;
}

function viewport(fixture: Fixture, label = 'Read more') {
    const node = toggle(fixture, label).parentElement?.firstElementChild;
    assert.ok(node, 'Expected a truncated-description viewport');
    assert.equal(node.tagName, 'DIV');
    return node;
}

function assertViewportStyle(
    node: { getAttribute(name: string): string | null },
    expanded: boolean
) {
    const style = node.getAttribute('style') ?? '';
    assert.match(
        style,
        expanded ? /max-height:\s*none/ : /max-height:\s*4\.5rem/
    );
    assert.match(style, /overflow:\s*hidden/);
}

function defineRect(
    element: object,
    bounds: { bottom: number; height: number }
) {
    const top = bounds.bottom - bounds.height;
    Object.defineProperty(element, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            bottom: bounds.bottom,
            height: bounds.height,
            left: 0,
            right: 320,
            top,
            width: 320,
            x: 0,
            y: top,
            toJSON: () => ({}),
        }),
    });
}

function trackActualListeners(
    target: { addEventListener: unknown; removeEventListener: unknown },
    types: string[]
) {
    const add = target.addEventListener;
    const remove = target.removeEventListener;
    assert.ok(typeof add === 'function');
    assert.ok(typeof remove === 'function');
    const originals = ['addEventListener', 'removeEventListener'].map(
        (key) => [key, Object.getOwnPropertyDescriptor(target, key)] as const
    );
    const active = new Map(types.map((type) => [type, new Set<unknown>()]));
    Object.defineProperty(target, 'addEventListener', {
        configurable: true,
        value: function (this: unknown, ...args: unknown[]) {
            if (typeof args[0] === 'string') active.get(args[0])?.add(args[1]);
            return Reflect.apply(add, this, args);
        },
    });
    Object.defineProperty(target, 'removeEventListener', {
        configurable: true,
        value: function (this: unknown, ...args: unknown[]) {
            if (typeof args[0] === 'string')
                active.get(args[0])?.delete(args[1]);
            return Reflect.apply(remove, this, args);
        },
    });
    return {
        count: (type: string) => active.get(type)?.size ?? 0,
        restore() {
            for (const [key, descriptor] of originals) {
                if (descriptor) Object.defineProperty(target, key, descriptor);
                else Reflect.deleteProperty(target, key);
            }
        },
    };
}

it('toggles Spanish labels between the exact native collapsed and expanded states', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert.ok(f.window instanceof Window);
    f.setGeometry({ clientHeight: 0, scrollHeight: 0 });
    await f.render(
        h(CompleteTruncatedDescription, {
            html: makeLongDescription('Línea de descripción'),
            className: 'audited-description',
            readMoreLabel: 'Leer más',
            showLessLabel: 'Mostrar menos',
        })
    );
    const readMore = toggle(f, 'Leer más');
    const content = viewport(f, 'Leer más');
    assert.equal(readMore.getAttribute('aria-expanded'), 'false');
    assert.equal(readMore.getAttribute('aria-controls'), content.id);
    assert.notEqual(content.id, '');
    assertViewportStyle(content, false);
    assert.ok(content.querySelector('.audited-description'));
    await f.click(readMore);
    const showLess = toggle(f, 'Mostrar menos');
    assert.equal(viewport(f, 'Mostrar menos'), content);
    assert.equal(showLess.getAttribute('aria-expanded'), 'true');
    assert.equal(showLess.getAttribute('aria-controls'), content.id);
    assertViewportStyle(content, true);
    await f.click(showLess);
    const collapsed = toggle(f, 'Leer más');
    assert.equal(collapsed.getAttribute('aria-expanded'), 'false');
    assert.equal(collapsed.getAttribute('aria-controls'), content.id);
    assertViewportStyle(content, false);
    f.unchangedEffects();
});

it('never submits a surrounding Form when the disclosure is toggled', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    let submits = 0;
    const countSubmit = () => {
        submits++;
    };
    assert.equal(f.container.tagName, 'FORM');
    f.container.addEventListener('submit', countSubmit);
    t.after(() => f.container.removeEventListener('submit', countSubmit));
    await f.render(
        h(CompleteTruncatedDescription, {
            html: makeLongDescription('Long help content'),
        })
    );
    const button = toggle(f);
    assert.equal(button.getAttribute('type'), 'button');
    await f.click(button);
    assert.equal(submits, 0);
    assert.equal(toggle(f, 'Show less').getAttribute('aria-expanded'), 'true');
    await f.click(toggle(f, 'Show less'));
    assert.equal(submits, 0);
    f.unchangedEffects();
});

it('collapses when same-mounted HTML content changes', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.render(
        h(CompleteTruncatedDescription, {
            html: makeLongDescription('First record'),
        })
    );
    const content = viewport(f);
    await f.click(toggle(f));
    assert.equal(toggle(f, 'Show less').getAttribute('aria-expanded'), 'true');
    await f.render(
        h(CompleteTruncatedDescription, {
            html: makeLongDescription('Next record'),
        })
    );
    assert.equal(viewport(f), content);
    assert.equal(toggle(f).getAttribute('aria-expanded'), 'false');
    assertViewportStyle(content, false);
    assert.match(content.textContent ?? '', /Next record 0/);
    assert.doesNotMatch(content.textContent ?? '', /First record/);
});

it('collapses for a new record identity even when its HTML is identical', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    const html = makeLongDescription('Shared description');
    await f.render(
        h(CompleteTruncatedDescription, { html, resetKey: 'record-a' })
    );
    const content = viewport(f);
    await f.click(toggle(f));
    assert.equal(toggle(f, 'Show less').getAttribute('aria-expanded'), 'true');
    await f.render(
        h(CompleteTruncatedDescription, { html, resetKey: 'record-b' })
    );
    assert.equal(viewport(f), content);
    assert.equal(toggle(f).getAttribute('aria-expanded'), 'false');
    assertViewportStyle(content, false);
});

for (const [label, html] of [
    ['short content', '<p>Everything already fits.</p>'],
    ['markup-empty content', '<p><br></p>'],
    ['whitespace content', '<p> </p>'],
] as const) {
    it(`hides the native disclosure for ${label} that does not overflow`, async (t) => {
        const f = await htmlPresentationFixture(t);
        f.setGeometry({ clientHeight: 40, scrollHeight: 40 });
        await f.render(h(CompleteTruncatedDescription, { html }));
        assert.equal(f.container.querySelector('button'), null);
        f.unchangedEffects();
    });
}

it('keeps the native disclosure for genuinely overflowing content', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.render(
        h(CompleteTruncatedDescription, {
            html: makeLongDescription('Overflowing description'),
        })
    );
    assert.equal(toggle(f).getAttribute('aria-expanded'), 'false');
    assertViewportStyle(viewport(f), false);
});

it('remeasures overflow after an inline image finishes loading', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 72 });
    await f.render(
        h(CompleteTruncatedDescription, {
            html: '<p>Project diagram</p><p><img src="https://example.com/project.png"></p>',
        })
    );
    assert.equal(f.container.querySelector('button'), null);
    const image = f.container.querySelector('img');
    assert.ok(image);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.imageEvent(image, 'load');
    assert.equal(toggle(f).getAttribute('aria-expanded'), 'false');
});

it('removes only clipped interactive content from focus until expansion', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.render(
        h(CompleteTruncatedDescription, {
            html: [
                '<p><a href="https://example.com/visible">Visible link</a></p>',
                '<p>Middle content</p>',
                '<p><a href="https://example.com/clipped">Clipped link</a></p>',
            ].join(''),
        })
    );
    const readMore = toggle(f);
    const content = viewport(f);
    const visibleLink = content.querySelector(
        'a[href="https://example.com/visible"]'
    );
    const clippedLink = content.querySelector(
        'a[href="https://example.com/clipped"]'
    );
    assert.ok(visibleLink);
    assert.ok(clippedLink);
    defineRect(content, { bottom: 72, height: 72 });
    defineRect(visibleLink, { bottom: 24, height: 16 });
    defineRect(clippedLink, { bottom: 120, height: 16 });
    await f.resize();
    assert.equal(visibleLink.getAttribute('tabindex'), null);
    assert.equal(visibleLink.getAttribute('aria-hidden'), null);
    assert.equal(clippedLink.getAttribute('tabindex'), '-1');
    assert.equal(clippedLink.getAttribute('aria-hidden'), 'true');
    await f.click(readMore);
    assert.equal(clippedLink.getAttribute('tabindex'), null);
    assert.equal(clippedLink.getAttribute('aria-hidden'), null);
    await f.click(toggle(f, 'Show less'));
    assert.equal(clippedLink.getAttribute('tabindex'), '-1');
    assert.equal(clippedLink.getAttribute('aria-hidden'), 'true');
});

it('recomputes disclosure availability after layout changes without trapping expanded content', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 40, scrollHeight: 40 });
    await f.render(
        h(CompleteTruncatedDescription, {
            html: '<p>Responsive description content</p>',
        })
    );
    assert.equal(f.container.querySelector('button'), null);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.resize();
    await f.click(toggle(f));
    const content = viewport(f, 'Show less');
    assert.equal(toggle(f, 'Show less').getAttribute('aria-expanded'), 'true');
    f.setGeometry({ clientHeight: 40, scrollHeight: 40 });
    await f.resize();
    await f.notifyObservers();
    assert.equal(toggle(f, 'Show less').getAttribute('aria-expanded'), 'true');
    assertViewportStyle(content, true);
    await f.click(toggle(f, 'Show less'));
    assert.equal(f.container.querySelector('button'), null);
    assertViewportStyle(content, false);
});

it('resets expansion for an A-to-B-to-A identity sequence without remounting the viewport', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    const html = makeLongDescription('Identical record content');
    await f.render(h(CompleteTruncatedDescription, { html, resetKey: 'A' }));
    const content = viewport(f);
    const id = content.id;
    await f.click(toggle(f));
    for (const resetKey of ['B', 'A']) {
        await f.render(h(CompleteTruncatedDescription, { html, resetKey }));
        assert.equal(viewport(f), content);
        assert.equal(content.id, id);
        assert.equal(toggle(f).getAttribute('aria-controls'), id);
        assert.equal(toggle(f).getAttribute('aria-expanded'), 'false');
        assertViewportStyle(content, false);
        await f.click(toggle(f));
        assert.equal(
            toggle(f, 'Show less').getAttribute('aria-expanded'),
            'true'
        );
    }
});

it('restores exact prior tabindex and aria-hidden values on expansion, visibility and unmount', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.render(
        h(CompleteTruncatedDescription, {
            html: [
                '<a href="https://example.com/plain">Plain</a>',
                '<a href="https://example.com/custom" tabindex="7" aria-hidden="false">Custom</a>',
                '<a href="https://example.com/hidden" tabindex="-3" aria-hidden="true">Initially hidden</a>',
            ].join(''),
        })
    );
    const content = viewport(f);
    const links = [...content.querySelectorAll('a')];
    assert.equal(links.length, 3);
    const expected = [
        { tabIndex: null, ariaHidden: null },
        { tabIndex: '7', ariaHidden: 'false' },
        { tabIndex: '-3', ariaHidden: 'true' },
    ];
    const attributes = () =>
        links.map((link) => ({
            tabIndex: link.getAttribute('tabindex'),
            ariaHidden: link.getAttribute('aria-hidden'),
        }));
    assert.deepEqual(attributes(), expected);
    defineRect(content, { bottom: 72, height: 72 });
    for (const link of links) defineRect(link, { bottom: 120, height: 16 });
    await f.resize();
    assert.deepEqual(
        attributes(),
        links.map(() => ({ tabIndex: '-1', ariaHidden: 'true' }))
    );
    await f.click(toggle(f));
    assert.deepEqual(attributes(), expected);
    await f.click(toggle(f, 'Show less'));
    assert.deepEqual(
        attributes(),
        links.map(() => ({ tabIndex: '-1', ariaHidden: 'true' }))
    );
    for (const link of links) defineRect(link, { bottom: 24, height: 16 });
    await f.notifyObservers();
    assert.deepEqual(attributes(), expected);
    for (const link of links) defineRect(link, { bottom: 120, height: 16 });
    await f.notifyObservers();
    assert.deepEqual(
        attributes(),
        links.map(() => ({ tabIndex: '-1', ariaHidden: 'true' }))
    );
    await f.render(null);
    assert.equal(content.isConnected, false);
    assert.deepEqual(attributes(), expected);
    assert.equal(f.activeObserverCount(), 0);
});

it('remeasures on image error and retires image, resize and observer callbacks on unmount', async (t) => {
    const f = await htmlPresentationFixture(t);
    // Observe and delegate the real DOM registrations. Dispatch after unmount
    // alone cannot prove removal: even a leaked callback could see a null ref.
    const imageListeners = trackActualListeners(
        f.window.HTMLImageElement.prototype,
        ['load', 'error']
    );
    const windowListeners = trackActualListeners(f.window, ['resize']);
    t.after(() => {
        imageListeners.restore();
        windowListeners.restore();
    });
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.render(
        h(CompleteTruncatedDescription, {
            html: '<p>Diagram</p><img src="https://example.com/diagram.png">',
        })
    );
    const content = viewport(f);
    const image = content.querySelector('img');
    assert.ok(image);
    assert.equal(f.activeObserverCount(), 1);
    assert.equal(imageListeners.count('load'), 1);
    assert.equal(imageListeners.count('error'), 1);
    assert.equal(windowListeners.count('resize'), 1);
    f.setGeometry({ clientHeight: 72, scrollHeight: 72 });
    await f.imageEvent(image, 'error');
    assert.equal(f.container.querySelector('button'), null);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.imageEvent(image, 'error');
    assert.equal(toggle(f).getAttribute('aria-expanded'), 'false');
    await f.render(null);
    assert.equal(f.activeObserverCount(), 0);
    assert.equal(imageListeners.count('load'), 0);
    assert.equal(imageListeners.count('error'), 0);
    assert.equal(windowListeners.count('resize'), 0);
    await f.imageEvent(image, 'error');
    await f.imageEvent(image, 'load');
    await f.resize();
    await f.notifyObservers();
    assert.equal(f.container.childElementCount, 0);
    f.unchangedEffects();
});

it('preserves the last native overflow decision when both measured heights are zero', async (t) => {
    const f = await htmlPresentationFixture(t);
    f.setGeometry({ clientHeight: 0, scrollHeight: 0 });
    await f.render(
        h(CompleteTruncatedDescription, {
            html: makeLongDescription('Not yet measured'),
        })
    );
    assert.equal(toggle(f).getAttribute('aria-expanded'), 'false');
    f.setGeometry({ clientHeight: 40, scrollHeight: 40 });
    await f.resize();
    assert.equal(f.container.querySelector('button'), null);
    f.setGeometry({ clientHeight: 0, scrollHeight: 0 });
    await f.notifyObservers();
    assert.equal(f.container.querySelector('button'), null);
    f.setGeometry({ clientHeight: 72, scrollHeight: 144 });
    await f.notifyObservers();
    assert.equal(toggle(f).getAttribute('aria-expanded'), 'false');
    f.setGeometry({ clientHeight: 0, scrollHeight: 0 });
    await f.resize();
    assert.equal(toggle(f).getAttribute('aria-expanded'), 'false');
});
