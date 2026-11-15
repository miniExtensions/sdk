import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import type { Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    ReadOnlyURLGallery,
    type ReadOnlyURLGalleryEntry,
    type ReadOnlyURLGalleryProps,
} from '../src/react/ReadOnlyURLGallery.js';

const entry = (name: string, id?: string): ReadOnlyURLGalleryEntry => ({
    url: `https://files.example.test/${name}.png`,
    filename: `${name}.png`,
    ...(id == null ? {} : { id }),
});

async function fixture(t: TestContext) {
    const window = new Window({ url: 'https://gallery.example.test/' });
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        Node: window.Node,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const descriptors = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            value,
            writable: true,
            configurable: true,
        });
    let root: Root | undefined;
    t.after(async () => {
        try {
            if (root) await act(async () => root?.unmount());
        } finally {
            for (const [key, descriptor] of descriptors) {
                if (descriptor)
                    Object.defineProperty(globalThis, key, descriptor);
                else Reflect.deleteProperty(globalThis, key);
            }
            await window.happyDOM.close();
        }
    });
    const { createRoot } = await import('react-dom/client');
    const host = window.document.createElement('form');
    let submits = 0;
    host.addEventListener('submit', (event) => {
        event.preventDefault();
        submits++;
    });
    window.document.body.append(host);
    root = createRoot(host as unknown as HTMLElement);
    const render = (props: ReadOnlyURLGalleryProps) =>
        act(async () =>
            root?.render(h(StrictMode, null, h(ReadOnlyURLGallery, props)))
        );
    const click = async (selector: string) => {
        const node = host.querySelector(selector);
        assert.ok(node, selector + '\n' + host.innerHTML);
        await act(async () => (node as unknown as HTMLElement).click());
    };
    const open = (index: number) =>
        click(`.mx-sdk-url-gallery__entry:nth-child(${index + 1}) button`);
    const index = () =>
        host.querySelector('.mx-sdk-url-gallery__position')?.textContent;
    const preview = () => host.querySelector('.mx-sdk-url-gallery__preview');
    return {
        window,
        host,
        render,
        click,
        open,
        index,
        preview,
        submits: () => submits,
    };
}

it('renders localized ordered rows and explicit layout options without write controls', () => {
    const html = renderToStaticMarkup(
        h(ReadOnlyURLGallery, {
            entries: [entry('same'), entry('same'), entry('last')],
            isInGrid: true,
            displayMode: 'icon',
            thumbnailSize: 'small',
            thumbFitType: 'contain',
            hideAttachmentName: false,
            labels: {
                attachments: 'Archivos',
                openAttachment: 'Abrir archivo',
            },
        })
    );
    assert.equal(
        (
            html.match(
                /aria-label="https:\/\/files.example.test\/same.png"/g
            ) ?? []
        ).length,
        2
    );
    assert.match(html, /aria-label="Archivos"/);
    assert.match(html, /Abrir archivo/);
    assert.match(html, /data-grid="true"/);
    assert.match(html, /data-size="small"/);
    assert.match(html, /data-fit="contain"/);
    assert.doesNotMatch(
        html,
        /type="file"|Delete|Annotate|Upload|type="submit"/
    );
});

it('preserves selected repeated URL occurrence across reorder/shrink and synchronously closes on empty', async (t) => {
    const f = await fixture(t);
    await f.render({
        entries: [entry('same'), entry('middle'), entry('same'), entry('last')],
    });
    await f.open(2);
    assert.equal(f.index(), '3 / 4');
    await f.render({
        entries: [entry('same'), entry('same'), entry('middle')],
    });
    assert.equal(f.index(), '2 / 3');
    assert.equal(
        f.preview()?.querySelector('img')?.getAttribute('src'),
        entry('same').url
    );
    await f.render({ entries: [entry('last'), entry('same')] });
    assert.equal(f.index(), '2 / 2');
    await f.render({ entries: [] });
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    assert.equal(f.host.querySelector('img'), null);
    await f.render({ entries: [entry('recovered')] });
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    assert.equal(f.submits(), 0);
});

it('matches URL with ID, uses unique ID fallback, and otherwise clamps the previous index', async (t) => {
    const f = await fixture(t);
    await f.render({
        entries: [
            entry('first', 'first'),
            entry('same', 'id-a'),
            entry('same', 'id-b'),
        ],
    });
    await f.open(2);
    await f.render({
        entries: [
            entry('same', 'id-b'),
            entry('same', 'id-a'),
            entry('last', 'last'),
        ],
    });
    assert.equal(f.index(), '1 / 3');
    await f.render({ entries: [entry('first'), entry('changed-url', 'id-b')] });
    assert.equal(f.index(), '2 / 2');
    assert.equal(
        f.preview()?.querySelector('img')?.getAttribute('src'),
        entry('changed-url').url
    );
    await f.render({ entries: [entry('replacement')] });
    assert.equal(f.index(), '1 / 1');
    assert.equal(
        f.preview()?.querySelector('img')?.getAttribute('src'),
        entry('replacement').url
    );
    // An old repeated ID does not authorize a same-ID/different-URL jump.
    await f.render({
        entries: [entry('one', 'repeat'), entry('two', 'repeat')],
    });
    await f.click('button[aria-label="Next"]');
    await f.render({
        entries: [entry('changed', 'repeat'), entry('fallback')],
    });
    assert.equal(f.index(), '2 / 2');
    assert.equal(
        f.preview()?.querySelector('img')?.getAttribute('src'),
        entry('fallback').url
    );
});

it('navigates and closes without submission, reflects current options and rejects detached row callbacks', async (t) => {
    const f = await fixture(t);
    const entries = [entry('one'), entry('two')];
    await f.render({ entries, hideAttachmentName: false });
    const retiredRow = f.host.querySelector('button')!;
    await f.open(0);
    assert.equal(f.host.querySelector('button[aria-label="Previous"]'), null);
    await f.click('button[aria-label="Next"]');
    assert.equal(f.index(), '2 / 2');
    await f.click('button[aria-label="Select attachment 1"]');
    assert.equal(f.index(), '1 / 2');
    const open = f.host.querySelector('[role="dialog"] a');
    assert.equal(open?.getAttribute('href'), entries[0]?.url);
    assert.equal(open?.getAttribute('rel'), 'noreferrer');
    await f.render({
        entries,
        disableOpenFiles: true,
        disableDownloadFiles: true,
        hideAttachmentName: true,
    });
    assert.equal(
        f.host.querySelector('.mx-sdk-url-gallery__entry button'),
        null
    );
    assert.equal(f.host.querySelector('[role="dialog"] a'), null);
    assert.equal(f.host.querySelector('.mx-sdk-url-gallery__name'), null);
    assert.ok(!f.host.textContent.includes('Download'));
    const close = Array.from(f.host.querySelectorAll('button')).find(
        (node) => node.textContent === 'Close'
    )!;
    await act(async () => close.click());
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    await act(async () => (retiredRow as unknown as HTMLElement).click());
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    await f.render({
        entries,
        labels: { close: 'Cerrar', previous: 'Anterior', next: 'Siguiente' },
    });
    await f.open(0);
    const dialog = f.host.querySelector('[role="dialog"]')!;
    await act(async () =>
        dialog.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                bubbles: true,
                key: 'ArrowRight',
            })
        )
    );
    assert.equal(f.index(), '2 / 2');
    await act(async () =>
        dialog.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                bubbles: true,
                key: 'Escape',
            })
        )
    );
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    assert.equal(f.submits(), 0);
});

it('downloads through the shared reader, cleans URLs and retires a pending download on replacement/options', async (t) => {
    const f = await fixture(t);
    let clicks = 0;
    const created: string[] = [],
        revoked: string[] = [];
    t.mock.method(URL, 'createObjectURL', () => {
        const url = `blob:gallery-${created.length}`;
        created.push(url);
        return url;
    });
    t.mock.method(URL, 'revokeObjectURL', (url: string) => revoked.push(url));
    t.mock.method(f.window.HTMLAnchorElement.prototype, 'click', () => {
        clicks++;
    });
    let resolve!: (response: Response) => void;
    let signal: AbortSignal | undefined;
    t.mock.method(
        globalThis,
        'fetch',
        async (_url: string | URL | Request, options?: RequestInit) => {
            signal = options?.signal as AbortSignal;
            return new Promise<Response>((done) => {
                resolve = done;
            });
        }
    );
    const response = () => new Response(new Uint8Array([1, 2, 3]));
    const entries = [entry('one')];
    const download = async () => {
        const button = Array.from(f.host.querySelectorAll('button')).find(
            (node) => node.textContent === 'Download'
        )!;
        assert.ok(button);
        await act(async () => button.click());
    };
    await f.render({ entries });
    await f.open(0);
    await download();
    await act(async () => {
        resolve(response());
    });
    assert.equal(clicks, 1);
    assert.deepEqual(revoked, created);
    assert.equal(f.host.ownerDocument.querySelector('a[download]'), null);
    await download();
    await f.render({ entries, disableDownloadFiles: true });
    assert.equal(signal?.aborted, true);
    await act(async () => {
        resolve(response());
    });
    assert.equal(clicks, 1);
    await f.render({ entries });
    await download();
    await f.render({ entries: [] });
    assert.equal(signal?.aborted, true);
    await act(async () => {
        resolve(response());
    });
    assert.equal(clicks, 1);
    assert.equal(f.submits(), 0);
});

it('retires the real public video and pending Word leaf on navigation and empty replacement', async (t) => {
    const f = await fixture(t);
    let pauses = 0,
        loads = 0,
        blobReads = 0;
    t.mock.method(f.window.HTMLVideoElement.prototype, 'pause', () => {
        pauses++;
    });
    t.mock.method(f.window.HTMLVideoElement.prototype, 'load', () => {
        loads++;
    });
    let resolve!: (response: Response) => void;
    t.mock.method(
        globalThis,
        'fetch',
        async () =>
            new Promise<Response>((done) => {
                resolve = done;
            })
    );
    const word: ReadOnlyURLGalleryEntry = {
        url: 'https://files.example.test/report.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    await f.render({
        entries: [
            { url: 'https://files.example.test/video', type: 'video/mp4' },
            word,
        ],
    });
    await f.open(0);
    const video = f.preview()?.querySelector('video');
    assert.ok(video);
    await f.click('button[aria-label="Next"]');
    assert.equal(video.getAttribute('src'), null);
    assert.ok(pauses > 0 && loads > 0);
    await f.render({ entries: [] });
    await act(async () =>
        resolve({
            blob: async () => {
                blobReads++;
                return new Blob([]);
            },
        } as Response)
    );
    assert.equal(blobReads, 1);
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    assert.equal(
        f.host.querySelector(
            'video, audio, iframe, .mx-sdk-attachment-preview__word'
        ),
        null
    );
    await f.render({ entries: [entry('recovered')] });
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
});
