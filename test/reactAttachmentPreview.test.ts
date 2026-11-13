import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { JSDOM } from 'jsdom';
import { act, createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import {
    AttachmentPreview,
    type AttachmentPreviewSource,
} from '../src/react/index.js';

const word =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const source = (name: string): AttachmentPreviewSource => ({
    url: `https://preview.example.test/${name}.docx`,
    type: word,
});
const bytes = (name: string) =>
    readFileSync(`test/fixtures/attachment-preview/${name}.docx`);
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
};

async function fixture(t: TestContext) {
    const window = new Window({ url: 'https://preview.example.test/' });
    // happy-dom retains prefixes in XML attribute localName. Use jsdom's
    // namespace-aware XML parser for the actual OOXML decoder boundary.
    const xml = new JSDOM('').window;
    const globals = {
        window,
        document: window.document,
        navigator: window.navigator,
        HTMLElement: window.HTMLElement,
        Node: window.Node,
        NodeFilter: window.NodeFilter,
        DOMParser: xml.DOMParser,
        XMLSerializer: xml.XMLSerializer,
        FileReader: window.FileReader,
        Blob: window.Blob,
        IS_REACT_ACT_ENVIRONMENT: true,
    };
    const descriptors = Object.keys(globals).map(
        (key) =>
            [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
    );
    let root: Root | undefined;
    t.after(async () => {
        try {
            if (root) await act(async () => root?.unmount());
        } finally {
            for (const [key, original] of descriptors) {
                if (original) Object.defineProperty(globalThis, key, original);
                else Reflect.deleteProperty(globalThis, key);
            }
            xml.close();
            await window.happyDOM.close();
        }
    });
    for (const [key, value] of Object.entries(globals))
        Object.defineProperty(globalThis, key, {
            value,
            configurable: true,
            writable: true,
        });
    const progressListeners = new Set<() => void>();
    const notifyProgress = () => {
        for (const listener of progressListeners) listener();
    };
    const assets: unknown[] = [];
    t.mock.method(URL, 'createObjectURL', (blob: unknown) => {
        assets.push(blob);
        notifyProgress();
        return `blob:controlled-${assets.length}`;
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
    const render = (node: ReactNode) => act(async () => root?.render(node));
    // FileReader and the real ZIP decoder cross timer/I/O turns. A fixed
    // number of setImmediate turns can expire before either advances. Await
    // actual DOM/asset/diagnostic progress with a finite wall-clock deadline;
    // callers retain their original exact assertions after this wait.
    const waitUntil = async (ready: () => boolean) => {
        if (ready()) return;
        await act(async () => {
            await new Promise<void>((resolve) => {
                const observer = new window.MutationObserver(check);
                const deadline = setTimeout(finish, 5_000);
                function finish() {
                    clearTimeout(deadline);
                    observer.disconnect();
                    progressListeners.delete(check);
                    resolve();
                }
                function check() {
                    if (ready()) finish();
                }
                observer.observe(host, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                    attributes: true,
                });
                progressListeners.add(check);
                check();
            });
        });
    };
    const ready = async (text: string) => {
        await waitUntil(() => host.textContent.includes(text));
        assert.ok(host.textContent.includes(text), host.innerHTML);
    };
    const response = (name: string) =>
        ({
            blob: async () => new window.Blob([bytes(name)]),
        }) as unknown as Response;
    return {
        window,
        host,
        render,
        ready,
        waitUntil,
        notifyProgress,
        response,
        assets,
        submits: () => submits,
    };
}

it('server imports and renders explicit image, audio, video, PDF and localized unsupported branches', () => {
    const render = (attachment: AttachmentPreviewSource) =>
        renderToStaticMarkup(
            h(AttachmentPreview, {
                attachment,
                labels: {
                    attachments: 'Archivos adjuntos',
                    previewNotAvailable: 'Vista previa no disponible',
                },
            })
        );
    assert.match(render({ url: '/photo.PNG?q=1' }), /<img/);
    assert.match(
        render({ url: '/photo.jpg', type: '' }),
        /Vista previa no disponible/
    );
    assert.match(
        render({ url: '/file', type: 'audio/mpeg' }),
        /<audio[^>]*controls/
    );
    assert.match(
        render({ url: '/file.pdf', type: 'video/mp4' }),
        /<video[^>]*controls/
    );
    assert.match(
        render({ url: '/file.pdf', filename: ' Invoice ' }),
        /title=" Invoice "/
    );
    assert.match(
        render({ url: '/file.pdf', filename: ' ' }),
        /title="Archivos adjuntos"/
    );
    assert.match(render({ url: '/file.pdf' }), /file.pdf#toolbar=0/);
    assert.match(render({ url: '/file.PDF' }), /Vista previa no disponible/);
    assert.match(
        render({ url: '/file.pdf?q=1' }),
        /Vista previa no disponible/
    );
    assert.match(
        render({
            url: '/photo.HEIC',
            type: 'application/octet-stream',
            thumbnails: { full: { url: '/full.jpg' } },
        }),
        /src="\/full.jpg"/
    );
    assert.match(
        render({ url: '/image.heic', type: 'image/heic' }),
        /src="\/image.heic"/
    );
    assert.match(
        render({ url: '/legacy.doc', type: 'application/msword' }),
        /Vista previa no disponible/
    );
});

// Retained pre-extraction native characterization, exercised through the public
// SDK export so package composition cannot broaden MIME/suffix inference.
for (const [name, attachment, tag] of [
    [
        'empty filename suppresses URL inference',
        { url: '/photo.jpg', filename: '' },
        null,
    ],
    [
        'image MIME remains case sensitive',
        { url: '/photo.jpg', type: 'IMAGE/JPEG' },
        null,
    ],
    [
        'custom image MIME is accepted',
        { url: '/file', type: 'image/custom' },
        'img',
    ],
    [
        'PDF fragment does not match the suffix fallback',
        { url: '/file.pdf#page=2' },
        null,
    ],
    [
        'exact PDF MIME needs no filename',
        { url: '/file', type: 'application/pdf' },
        'iframe',
    ],
    [
        'PDF MIME remains case sensitive',
        { url: '/file', type: 'Application/PDF' },
        null,
    ],
    ['video filename does not replace MIME', { url: '/file.mp4' }, null],
    ['audio filename does not replace MIME', { url: '/file.mp3' }, null],
    ['Word filename does not replace MIME', { url: '/file.docx' }, null],
    [
        'PDF suffix precedes Word MIME',
        { url: '/file.pdf', type: word },
        'iframe',
    ],
] satisfies [string, AttachmentPreviewSource, string | null][]) {
    it(`preserves native classification: ${name}`, () => {
        const markup = renderToStaticMarkup(
            h(AttachmentPreview, { attachment })
        );
        if (tag) assert.match(markup, new RegExp(`<${tag}(?:\\s|>)`));
        else assert.match(markup, /Preview Not Available/);
    });
}

it('uses the full HEIF thumbnail before the original image URL', () => {
    const markup = renderToStaticMarkup(
        h(AttachmentPreview, {
            attachment: {
                url: '/photo.heif',
                type: 'image/heif',
                thumbnails: { full: { url: '/full-heif.jpg' } },
            },
        })
    );
    assert.match(markup, /src="\/full-heif.jpg"/);
    assert.doesNotMatch(markup, /src="\/photo.heif"/);
});

it('renders actual controlled DOCX text, embedded image and font with the unmocked 0.3.0 vendor; stable rerenders retain DOM', async (t) => {
    const f = await fixture(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () =>
        f.response('B')
    );
    await f.render(h(AttachmentPreview, { attachment: source('B') }));
    await f.ready('Controlled attachment B');
    await f.waitUntil(() => f.assets.length >= 2);
    assert.equal(f.assets.length, 2);
    assert.match(f.host.querySelector('img')?.src ?? '', /^blob:controlled-/);
    assert.match(f.host.textContent, /@font-face/);
    assert.match(f.host.textContent, /AttachmentSmoke/);
    const document = f.host.querySelector('.docx-wrapper');
    assert.ok(document);
    await f.render(
        h(AttachmentPreview, {
            attachment: { ...source('B'), filename: 'New name' },
            labels: { attachments: '添付ファイル' },
        })
    );
    assert.equal(f.host.querySelector('.docx-wrapper'), document);
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(f.submits(), 0);
});

it('retires delayed A across A-B-A without overwriting the fresh actual Word render', async (t) => {
    const f = await fixture(t);
    const first = deferred<Response>();
    let calls = 0;
    t.mock.method(
        globalThis,
        'fetch',
        async (input: Parameters<typeof fetch>[0]) => {
            calls++;
            if (calls === 1) return first.promise;
            return f.response(String(input).includes('/A.') ? 'A' : 'B');
        }
    );
    await f.render(h(AttachmentPreview, { attachment: source('A') }));
    await f.render(h(AttachmentPreview, { attachment: source('B') }));
    await f.ready('Controlled attachment B');
    await f.render(h(AttachmentPreview, { attachment: source('A') }));
    await f.ready('Controlled attachment A');
    const current = f.host.querySelector('.docx-wrapper');
    await act(async () => first.resolve(f.response('B')));
    assert.equal(f.host.querySelector('.docx-wrapper'), current);
    assert.ok(!f.host.textContent.includes('Controlled attachment B'));
    assert.equal(calls, 3);
    assert.equal(f.submits(), 0);
});

it('contains active actual parser failure and suppresses retired transport rejection', async (t) => {
    const f = await fixture(t);
    const diagnostics = t.mock.method(console, 'error', () => {
        queueMicrotask(f.notifyProgress);
    });
    const retired = deferred<Response>();
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () =>
        ++calls === 1
            ? retired.promise
            : ({
                  blob: async () => new f.window.Blob(['invalid zip']),
              } as unknown as Response)
    );
    await f.render(h(AttachmentPreview, { attachment: source('A') }));
    await f.render(h(AttachmentPreview, { attachment: source('B') }));
    await f.waitUntil(() => diagnostics.mock.callCount() > 0);
    assert.equal(diagnostics.mock.callCount(), 1);
    await act(async () => retired.reject(new Error('retired transport')));
    assert.equal(diagnostics.mock.callCount(), 1);
    assert.equal(f.submits(), 0);
});

it('keeps video controls and disposes only the retained video on teardown', async (t) => {
    const f = await fixture(t);
    t.mock.method(globalThis, 'fetch', async () =>
        assert.fail('Non-Word preview fetched')
    );
    await f.render(
        h(AttachmentPreview, {
            attachment: { url: '/a.mp4', type: 'video/mp4' },
        })
    );
    const video = f.host.querySelector('video');
    assert.ok(video);
    assert.equal(video.controls, true);
    const events: string[] = [];
    t.mock.method(video, 'pause', () => events.push('pause'));
    const remove = video.removeAttribute.bind(video);
    t.mock.method(video, 'removeAttribute', (name: string) => {
        events.push(name);
        remove(name);
    });
    t.mock.method(video, 'load', () => events.push('load'));
    await f.render(
        h(AttachmentPreview, {
            attachment: { url: '/b.mp4', type: 'video/mp4' },
        })
    );
    assert.equal(f.host.querySelector('video'), video);
    assert.equal(events.length, 0);
    await f.render(null);
    assert.deepEqual(events, ['pause', 'src', 'load']);
    assert.equal(f.submits(), 0);
});
