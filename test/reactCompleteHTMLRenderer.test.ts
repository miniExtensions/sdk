import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { it } from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    CompleteHTMLRenderer,
    sanitizeHTML,
    hasRenderableHTMLContent,
} from '../src/react/html/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

/*
 * Native assertions are ported from HTMLRenderer.test.tsx at host ce9689e7;
 * implementation blob31b3466385350763639538aac1aaf5efa639e209. Expected policy
 * is source-backed native behavior, not a second implementation or SDK oracle.
 * Source DOM observations do not prove browser paint containment or that a
 * provider frame is safe; real-browser CSS/CSP input provenance is separate.
 */
const sandbox =
    'allow-downloads allow-forms allow-popups allow-presentation allow-same-origin allow-scripts';

it('sanitizes and server-renders supported HTML without a browser global', () => {
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    const html = renderToStaticMarkup(
        h(CompleteHTMLRenderer, {
            html: '<h2>Literal HTML</h2><script>globalThis.__formulaXss = true</script>',
            dangerouslySetInnerHTML: {
                __html: '<script>caller override</script>',
            },
        })
    );
    assert.match(html, /<h2>Literal HTML<\/h2>/);
    assert.doesNotMatch(html, /<script|__formulaXss|caller override/);
    assert.match(html, /contain:paint/);
    assert.match(html, /isolation:isolate/);
});

it('preserves supported native markup while removing executable attributes and URLs', async (t) => {
    const dom = await htmlPresentationFixture(t);
    assert.ok(dom.window instanceof Window);
    await dom.render(
        h(CompleteHTMLRenderer, {
            html: `
        <h2 style="color: rgb(255, 0, 0)">Safe heading</h2>
        <ul><li>Safe item</li></ul>
        <a href="https://example.com/safe">Safe link</a>
        <a href="javascript:window.__formulaXss = true">Unsafe link</a>
        <img src="https://example.com/image.png" alt="Safe image" onerror="window.__formulaXss = true">
        <script>window.__formulaXss = true</script>
    `,
        })
    );
    const heading = dom.container.querySelector('h2');
    assert.ok(heading);
    assert.equal(heading.textContent, 'Safe heading');
    assert.equal(heading.style.color, 'rgb(255, 0, 0)');
    assert.equal(dom.container.querySelector('li')?.textContent, 'Safe item');
    const links = dom.container.querySelectorAll('a');
    assert.equal(links[0]?.getAttribute('href'), 'https://example.com/safe');
    assert.equal(links[1]?.textContent, 'Unsafe link');
    assert.equal(links[1]?.getAttribute('href'), null);
    assert.equal(
        dom.container.querySelector('img')?.getAttribute('onerror'),
        null
    );
    assert.equal(dom.container.querySelector('script'), null);
});

it('forces the exact native bounded policy on arbitrary HTTPS iframes and replaces old content', async (t) => {
    const dom = await htmlPresentationFixture(t);
    await dom.render(
        h(CompleteHTMLRenderer, {
            html: `
        <iframe title="Formula frame" src="https://example.com/embed"
            sandbox="allow-top-navigation allow-popups-to-escape-sandbox"
            referrerpolicy="unsafe-url" loading="eager"
            srcdoc="<script>window.__formulaXss = true</script>"
            onload="window.__formulaXss = true"></iframe>
    `,
        })
    );
    const frame = dom.container.querySelector('iframe');
    assert.ok(frame);
    assert.equal(frame.getAttribute('src'), 'https://example.com/embed');
    assert.equal(frame.getAttribute('sandbox'), sandbox);
    assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
    assert.equal(frame.getAttribute('loading'), 'lazy');
    assert.equal(frame.getAttribute('srcdoc'), null);
    assert.equal(frame.getAttribute('onload'), null);
    await dom.render(
        h(CompleteHTMLRenderer, { html: '<p>Updated safe formula value</p>' })
    );
    assert.equal(dom.container.querySelector('iframe'), null);
    assert.equal(
        dom.container.querySelector('p')?.textContent,
        'Updated safe formula value'
    );
});

for (const source of [
    'http://example.com/embed',
    '//example.com/embed',
    '/relative-embed',
    'data:text/html,unsafe',
    'https://',
    'javascript:window.__formulaXss = true',
]) {
    it(`removes a native iframe without an explicit HTTPS source: ${source}`, async (t) => {
        const dom = await htmlPresentationFixture(t);
        await dom.render(
            h(CompleteHTMLRenderer, {
                html: `<iframe title="Unsafe frame" src="${source}"></iframe>`,
            })
        );
        assert.equal(dom.container.querySelector('iframe'), null);
    });
}

it('removes native direct Form controls while retaining their safe text', async (t) => {
    const dom = await htmlPresentationFixture(t);
    await dom.render(
        h(CompleteHTMLRenderer, {
            html: `
        <form action="https://example.com/collect"><label for="secret">Secret</label>
        <input id="secret" name="secret" value="capture me">
        <select><option>Choice</option></select><textarea>Message</textarea>
        <button type="submit">Submit</button></form>
    `,
        })
    );
    const renderer = dom.container.firstElementChild;
    assert.ok(renderer);
    assert.equal(
        renderer.querySelector(
            'form,label,input,select,option,textarea,button'
        ),
        null
    );
    for (const text of ['Secret', 'Choice', 'Message', 'Submit']) {
        assert.ok(renderer.textContent.includes(text));
    }
});

it('forbids the complete native Form-control tag set through the public sanitizer', async (t) => {
    const dom = await htmlPresentationFixture(t);
    const tags = [
        'button',
        'datalist',
        'fieldset',
        'form',
        'input',
        'label',
        'legend',
        'optgroup',
        'option',
        'output',
        'select',
        'textarea',
    ];
    for (const tag of tags) {
        await dom.render(
            h(CompleteHTMLRenderer, {
                html: `<${tag} id="untrusted-control">Safe text</${tag}>`,
            })
        );
        const renderer = dom.container.firstElementChild;
        assert.ok(renderer);
        assert.equal(renderer.querySelector(tags.join(',')), null, tag);
    }
});

it('retains native style containment and caller overflow precedence', async (t) => {
    const dom = await htmlPresentationFixture(t);
    await dom.render(
        h(CompleteHTMLRenderer, {
            html: '<div style="position: fixed; inset: 0; z-index: 2147483647">Styled formula</div>',
            style: {
                height: 96,
                overflow: 'hidden',
                contain: 'none',
                isolation: 'auto',
                position: 'fixed',
            },
        })
    );
    const renderer = dom.container.firstElementChild;
    assert.ok(renderer instanceof dom.window.HTMLDivElement);
    const customerContent = renderer.querySelector('div');
    assert.ok(customerContent);
    assert.equal(customerContent.style.position, 'fixed');
    assert.equal(customerContent.style.zIndex, '2147483647');
    assert.equal(renderer.style.contain, 'paint');
    assert.equal(renderer.style.height, '96px');
    assert.equal(renderer.style.isolation, 'isolate');
    assert.equal(renderer.style.overflow, 'hidden');
    assert.equal(renderer.style.position, 'relative');
    await dom.render(
        h(CompleteHTMLRenderer, { html: '<p>Default overflow</p>' })
    );
    assert.equal(renderer.style.overflow, 'auto');
});

it('forwards the actual div ref, safe native props and inline class presentation', async (t) => {
    const dom = await htmlPresentationFixture(t);
    const first = createRef<HTMLDivElement>();
    const second = createRef<HTMLDivElement>();
    let clicks = 0;
    await dom.render(
        h(CompleteHTMLRenderer, {
            html: '<p>First</p>',
            id: 'native-html-id',
            role: 'note',
            'aria-label': 'HTML help',
            className: 'consumer-html',
            ref: first,
            onClick: () => {
                clicks++;
            },
        })
    );
    const renderer = dom.container.firstElementChild;
    assert.ok(renderer instanceof dom.window.HTMLDivElement);
    assert.equal(first.current, renderer);
    assert.equal(renderer.id, 'native-html-id');
    assert.equal(renderer.getAttribute('role'), 'note');
    assert.equal(renderer.getAttribute('aria-label'), 'HTML help');
    assert.ok(renderer.className.includes('[&_ul]:list-disc'));
    assert.ok(renderer.classList.contains('consumer-html'));
    await dom.click(renderer);
    assert.equal(clicks, 1);
    await dom.render(
        h(CompleteHTMLRenderer, {
            html: '<p>Second</p>',
            inline: true,
            className: 'next-consumer-html',
            ref: second,
        })
    );
    assert.equal(dom.container.firstElementChild, renderer);
    assert.equal(first.current, null);
    assert.equal(second.current, renderer);
    assert.equal(renderer.className.includes('[&_ul]:list-disc'), false);
    assert.ok(renderer.classList.contains('next-consumer-html'));
    assert.equal(renderer.textContent, 'Second');
    await dom.render(null);
    assert.equal(second.current, null);
});

it('classifies native renderability after real sanitization without treating markup-empty text as content', () => {
    const empty = [
        '',
        ' \t\n',
        '<p><br></p>',
        '<p> </p>',
        '<p>&nbsp;</p>',
        '<p>&#160;&#x00a0;</p>',
        '<p>\u00a0\u200b\u200c\u200d\ufeff</p>',
        '<!-- only a comment -->',
        '<script>not rendered</script>',
        '<iframe src="http://example.com/removed"></iframe>',
        '<input value="not displayed">',
    ];
    const visible = [
        '0',
        '<p>0</p>',
        '<p>Literal **Markdown**</p>',
        '<p>&amp;</p>',
        '<p>&lt;b&gt;literal&lt;/b&gt;</p>',
        '<audio></audio>',
        '<hr>',
        '<iframe src="https://example.com/embed"></iframe>',
        '<img alt="">',
        '<table></table>',
        '<video></video>',
    ];
    for (const html of empty)
        assert.equal(hasRenderableHTMLContent(html), false, html);
    for (const html of visible)
        assert.equal(hasRenderableHTMLContent(html), true, html);
    assert.equal(sanitizeHTML('<p>0</p>'), '<p>0</p>');
});

it('matches the recorded actual native sanitizer bytes and renderability decisions', () => {
    // Captured by the real unchanged native helpers, not generated by the SDK.
    // Keep all finite inputs and exact outputs, including attribute ordering.
    const baseline = JSON.parse(
        readFileSync('test/fixtures/nativeHTMLPolicyBaseline.json', 'utf8')
    ) as {
        schemaVersion: number;
        source: {
            hostHead: string;
            htmlRendererBlob: string;
            dompurify: string;
            jsdom: string;
        };
        sanitizeCases: { input: string; output: string }[];
        renderableCases: { input: string; output: boolean }[];
    };
    assert.equal(baseline.schemaVersion, 1);
    assert.equal(
        baseline.source.hostHead,
        '787a2d23dded6c8fbd02132a2eb7ea1a44ee0075'
    );
    assert.equal(
        baseline.source.htmlRendererBlob,
        '31b3466385350763639538aac1aaf5efa639e209'
    );
    assert.equal(baseline.source.dompurify, '2.4.7');
    assert.equal(baseline.source.jsdom, '20.0.3');
    assert.equal(baseline.sanitizeCases.length, 9);
    assert.equal(baseline.renderableCases.length, 6);
    for (const [index, entry] of baseline.sanitizeCases.entries()) {
        assert.equal(
            sanitizeHTML(entry.input),
            entry.output,
            `Native sanitizer bytes ${index + 1}`
        );
    }
    for (const [index, entry] of baseline.renderableCases.entries()) {
        assert.equal(
            hasRenderableHTMLContent(entry.input),
            entry.output,
            `Native renderability ${index + 1}`
        );
    }
});

it('keeps the SDK sanitizer private from an application DOMPurify instance and global hooks', (t) => {
    // Real pinned dependencies, loaded through Node's public module boundary.
    // A structural test boundary avoids introducing a second type-only package.
    const require = createRequire(import.meta.url);
    type AppWindow = { close(): void };
    type Purifier = {
        sanitize(html: string, config?: Record<string, unknown>): string;
        addHook(name: string, callback: (node: Element) => void): void;
        removeAllHooks(): void;
        setConfig(config: Record<string, unknown>): void;
        clearConfig(): void;
    };
    const { JSDOM } = require('jsdom') as {
        JSDOM: new (html: string) => { window: AppWindow };
    };
    const createDOMPurify = require('dompurify') as (
        window: AppWindow
    ) => Purifier;
    const appWindow = new JSDOM('').window;
    const app = createDOMPurify(appWindow);
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'DOMPurify');
    t.after(() => {
        try {
            app.removeAllHooks();
            app.clearConfig();
            appWindow.close();
        } finally {
            if (previous)
                Object.defineProperty(globalThis, 'DOMPurify', previous);
            else Reflect.deleteProperty(globalThis, 'DOMPurify');
        }
    });
    let appHooks = 0;
    app.addHook('afterSanitizeAttributes', (node) => {
        appHooks++;
        node.setAttribute('data-application-hook', 'retained');
    });
    Object.defineProperty(globalThis, 'DOMPurify', {
        configurable: true,
        writable: true,
        value: app,
    });
    const frame =
        '<iframe src="https://example.com/embed" sandbox="allow-top-navigation"></iframe>';
    const config = { ADD_TAGS: ['iframe'], ADD_ATTR: ['sandbox'] };
    const before = app.sanitize(frame, config);
    assert.match(before, /data-application-hook="retained"/);
    assert.match(before, /sandbox="allow-top-navigation"/);
    const hooksBeforeSDK = appHooks;
    const sdk = sanitizeHTML(frame);
    assert.equal(appHooks, hooksBeforeSDK);
    assert.ok(sdk.includes(`sandbox="${sandbox}"`));
    assert.doesNotMatch(sdk, /data-application-hook|allow-top-navigation/);
    assert.equal(app.sanitize(frame, config), before);
    assert.ok(appHooks > hooksBeforeSDK);
    app.removeAllHooks();
    app.setConfig({ FORBID_TAGS: ['em'] });
    assert.equal(
        app.sanitize('<em>Application configuration</em>'),
        'Application configuration'
    );
    assert.equal(
        sanitizeHTML('<em>Application configuration</em>'),
        '<em>Application configuration</em>'
    );
    app.clearConfig();
    assert.ok(sanitizeHTML(frame).includes(`sandbox="${sandbox}"`));
    assert.equal(hasRenderableHTMLContent('<p>\u200b</p>'), false);
});
