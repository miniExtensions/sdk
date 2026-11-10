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
    const assets: unknown[] = [];
    t.mock.method(URL, 'createObjectURL', (blob: unknown) => {
        assets.push(blob);
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
    const ready = async (text: string) => {
        for (let i = 0; i < 100 && !host.textContent.includes(text); i++)
            await act(async () => {
                await new Promise(setImmediate);
            });
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

it('renders actual controlled DOCX text, embedded image and font with the unmocked 0.3.0 vendor; stable rerenders retain DOM', async (t) => {
    const f = await fixture(t);
    const fetch = t.mock.method(globalThis, 'fetch', async () =>
        f.response('B')
    );
    await f.render(h(AttachmentPreview, { attachment: source('B') }));
    await f.ready('Controlled attachment B');
    for (let i = 0; i < 100 && f.assets.length < 2; i++)
        await act(async () => {
            await new Promise(setImmediate);
        });
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
    const diagnostics = t.mock.method(console, 'error', () => {});
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
    for (let i = 0; i < 100 && diagnostics.mock.callCount() === 0; i++)
        await act(async () => {
            await new Promise(setImmediate);
        });
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
