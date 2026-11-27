import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it, type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { JSDOM } from 'jsdom';
import {
    act,
    createElement as h,
    StrictMode,
    useState,
    type ReactElement,
    type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Root } from 'react-dom/client';
import {
    AttachmentPreview,
    type AttachmentPreviewSource,
} from '../src/react/index.js';
import { renderAttachmentSlider } from '../src/react/AttachmentSlider.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

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

it('preserves the requested page of a typed PDF in the mounted iframe', async (t) => {
    const f = await htmlPresentationFixture(t);
    const base = '/guide.pdf?revision=2';
    const render = async (fragment: string) => {
        await f.render(
            h(AttachmentPreview, {
                attachment: {
                    url: base + fragment,
                    type: 'application/pdf',
                    filename: 'Guide.pdf',
                },
            })
        );
        const frame = f.container.querySelector('iframe');
        assert.ok(frame);
        assert.equal(frame.getAttribute('title'), 'Guide.pdf');
        const src = frame.getAttribute('src');
        assert.ok(src);
        return src;
    };
    const src = await render('#page=4');
    const parsed = new URL(src, f.window.location.href);
    assert.equal(parsed.pathname, '/guide.pdf');
    assert.equal(parsed.search, '?revision=2');
    const parameters = new URLSearchParams(parsed.hash.slice(1));
    assert.deepEqual(
        [...parameters],
        [
            ['page', '4'],
            ['toolbar', '0'],
        ]
    );
    assert.equal(src, `${base}#page=4&toolbar=0`);
    assert.equal(await render('#'), `${base}#toolbar=0`);
    assert.equal(await render('#page=4&'), `${base}#page=4&toolbar=0`);
    assert.equal(await render('#page=4&toolbar=0'), `${base}#page=4&toolbar=0`);
    assert.equal(await render('#page=4&toolbar=1'), `${base}#page=4&toolbar=1`);
    assert.equal(
        await render('#page=4&zoom=125%2C0%2C0'),
        `${base}#page=4&zoom=125%2C0%2C0&toolbar=0`
    );
    f.unchangedEffects();
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

it('shows the localized status for an active parser failure and suppresses retired and closed rejections', async (t) => {
    const f = await fixture(t);
    const diagnostics = t.mock.method(console, 'error', () => {
        queueMicrotask(f.notifyProgress);
    });
    const retired = deferred<Response>();
    const closed = deferred<Response>();
    const label = 'Aperçu Word indisponible';
    const fetch = t.mock.method(globalThis, 'fetch', async (url: string) => {
        if (url === source('A').url) return retired.promise;
        if (url === source('closed').url) return closed.promise;
        if (url === source('valid').url) return f.response('B');
        return {
            blob: async () => new f.window.Blob(['invalid zip']),
        } as unknown as Response;
    });
    const render = (name: string) =>
        f.render(
            h(AttachmentPreview, {
                attachment: source(name),
                labels: { previewNotAvailable: label },
            })
        );
    const statuses = () => [...f.host.querySelectorAll('[role="status"]')];

    await render('A');
    await render('B');
    await f.waitUntil(() => diagnostics.mock.callCount() > 0);
    assert.equal(diagnostics.mock.callCount(), 1);
    assert.deepEqual(
        statuses().map((status) => ({
            text: status.textContent,
            hidden: status.hasAttribute('hidden'),
        })),
        [{ text: label, hidden: false }]
    );
    assert.equal(f.host.querySelector('.docx-wrapper'), null);

    await render('valid');
    assert.deepEqual(statuses(), []);
    await f.ready('Controlled attachment B');
    assert.ok(f.host.querySelector('.docx-wrapper'));
    await act(async () => retired.reject(new Error('retired transport')));
    assert.deepEqual(statuses(), []);
    assert.ok(f.host.querySelector('.docx-wrapper'));

    await render('closed');
    await f.render(null);
    await act(async () => closed.reject(new Error('closed transport')));
    assert.deepEqual(statuses(), []);
    assert.equal(diagnostics.mock.callCount(), 1);
    assert.deepEqual(
        fetch.mock.calls.map(({ arguments: args }) => args[0]),
        ['A', 'B', 'valid', 'closed'].map((name) => source(name).url)
    );
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

it('publishes the actual owned DOCX only while current and retains ordinary same-owner rerenders', async (t) => {
    const f = await fixture(t);
    let current = true;
    const listeners = new Set<() => void>();
    const owner = {
        token: {},
        isCurrent: () => current,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const fetch = t.mock.method(globalThis, 'fetch', async () =>
        f.response('B')
    );
    await f.render(
        h(
            StrictMode,
            null,
            h(AttachmentPreview, {
                attachment: source('B'),
                owner,
                identity: 'owned-B',
            })
        )
    );
    await f.ready('Controlled attachment B');
    assert.ok(f.host.querySelector('img'));
    assert.match(f.host.textContent, /AttachmentSmoke/);
    const document = f.host.querySelector('.docx-wrapper');
    const requests = fetch.mock.callCount();
    assert.ok(document);
    await f.render(
        h(
            StrictMode,
            null,
            h(AttachmentPreview, {
                attachment: { ...source('B'), filename: 'Same capture' },
                owner,
                identity: 'owned-B',
            })
        )
    );
    assert.equal(f.host.querySelector('.docx-wrapper'), document);
    assert.equal(fetch.mock.callCount(), requests);
    current = false;
    await act(async () => {
        for (const listener of [...listeners]) listener();
    });
    assert.equal(listeners.size, 0);
    assert.equal(f.host.querySelector('.docx-wrapper'), null);
    assert.equal(f.host.querySelector('img'), null);
    assert.doesNotMatch(f.host.textContent, /Controlled attachment B/);
    assert.equal(f.submits(), 0);
});

it('cancels a revoked owned Word response before reading or publishing its bytes', async (t) => {
    const f = await fixture(t);
    let current = true,
        blobReads = 0,
        cancellations = 0;
    const listeners = new Set<() => void>();
    const owner = {
        token: {},
        isCurrent: () => current,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const pending = deferred<Response>();
    let signal: AbortSignal | undefined;
    t.mock.method(
        globalThis,
        'fetch',
        async (_input: Parameters<typeof fetch>[0], options?: RequestInit) => {
            signal = options?.signal as AbortSignal;
            return pending.promise;
        }
    );
    await f.render(
        h(AttachmentPreview, {
            attachment: source('A'),
            owner,
            identity: 'owned-A',
        })
    );
    current = false;
    await act(async () => {
        for (const listener of [...listeners]) listener();
    });
    assert.equal(signal?.aborted, true);
    assert.equal(listeners.size, 0);
    await act(async () =>
        pending.resolve({
            body: {
                cancel: async () => {
                    cancellations++;
                },
            },
            blob: async () => {
                blobReads++;
                return new f.window.Blob([bytes('A')]);
            },
        } as unknown as Response)
    );
    assert.equal(cancellations, 1);
    assert.equal(blobReads, 0);
    assert.equal(f.host.querySelector('.docx-wrapper'), null);
    assert.equal(f.assets.length, 0);
    assert.equal(f.submits(), 0);
});

it('cancels unread late Word bodies after the stock slider moves or closes', async (t) => {
    const f = await fixture(t);
    const retired = [deferred<Response>(), deferred<Response>()];
    const observations = retired.map(() => ({ cancels: 0, blobReads: 0 }));
    let nextRetired = 0;
    let currentReads = 0;
    let dismisses = 0;
    let deletes = 0;
    let downloads = 0;
    const requests: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url === source('A').url) return retired[nextRetired++].promise;
        assert.equal(url, source('B').url);
        return {
            blob: async () => {
                currentReads++;
                return new f.window.Blob([bytes('B')]);
            },
        } as unknown as Response;
    });
    const rows = ['A', 'B'].map((id) => ({
        ...source(id),
        id,
        filename: `${id}.docx`,
    }));
    const labels = {
        attachments: 'Attachments',
        previewNotAvailable: 'Preview unavailable',
        previous: 'Previous attachment',
        next: 'Next attachment',
        close: 'Close',
        delete: 'Delete',
        download: 'Download',
        open: 'Open',
    };
    const inlinePortal = ({ children }: { children: ReactElement }) => children;
    function Viewer() {
        const [currentIndex, setCurrentIndex] = useState(0);
        const [open, setOpen] = useState(true);
        return renderAttachmentSlider(
            {
                rows: open ? rows : [],
                currentIndex,
                setCurrentIndex,
                labels,
                navigationOwner: 'word-preview',
                downloadIdentity: currentIndex,
                canDownload: false,
                canOpen: false,
                readDownload: async () => {
                    downloads++;
                    throw Error('Unexpected download');
                },
                onDelete: () => deletes++,
                onDismiss: () => {
                    dismisses++;
                    setOpen(false);
                },
            },
            inlinePortal
        );
    }
    const resolveRetired = (index: number) =>
        act(async () => {
            const receipt = observations[index];
            retired[index].resolve({
                body: {
                    cancel: async () => {
                        receipt.cancels++;
                    },
                },
                blob: async () => {
                    receipt.blobReads++;
                    return new f.window.Blob([bytes('A')]);
                },
            } as unknown as Response);
        });
    const click = async (selector: string) => {
        const button = f.host.querySelector(selector);
        assert.ok(button instanceof f.window.HTMLButtonElement, selector);
        await act(async () => button.click());
    };

    await f.render(h(Viewer, { key: 'navigation' }));
    await click('button[aria-label="Next attachment"]');
    await f.ready('Controlled attachment B');
    const currentDocument = f.host.querySelector('.docx-wrapper');
    assert.ok(currentDocument);
    await resolveRetired(0);
    assert.equal(f.host.querySelector('.docx-wrapper'), currentDocument);
    assert.equal(f.host.textContent.includes('Controlled attachment A'), false);

    await f.render(h(Viewer, { key: 'dismissal' }));
    await click('button[data-testid="close-dialog"]');
    await resolveRetired(1);
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    assert.equal(f.host.querySelector('.docx-wrapper'), null);
    assert.equal(dismisses, 1);
    assert.deepEqual(requests, [
        source('A').url,
        source('B').url,
        source('A').url,
    ]);
    assert.equal(currentReads, 1);
    assert.equal(deletes, 0);
    assert.equal(downloads, 0);
    assert.equal(f.submits(), 0);
    assert.deepEqual(observations, [
        { cancels: 1, blobReads: 0 },
        { cancels: 1, blobReads: 0 },
    ]);
});

for (const strict of [false, true]) {
    for (const [kind, extension] of [
        ['video', 'mp4'],
        ['audio', 'mp3'],
    ] as const) {
        it(`retains ${kind} source on ${strict ? 'StrictMode replay' : 'ordinary mount'} and subsequent updates`, async (t) => {
            const f = await fixture(t);
            t.mock.method(globalThis, 'fetch', async () =>
                assert.fail('Non-Word preview fetched')
            );
            const render = (url: string, key = 'first') => {
                const preview = h(AttachmentPreview, {
                    key,
                    attachment: { url, type: `${kind}/${extension}` },
                });
                return f.render(
                    strict ? h(StrictMode, null, preview) : preview
                );
            };
            await render(`/a.${extension}`);
            const media = f.host.querySelector(kind);
            assert.ok(media);
            assert.equal(media.controls, true);
            assert.equal(media.getAttribute('src'), `/a.${extension}`);
            const events: string[] = [];
            t.mock.method(media, 'pause', () => events.push('pause'));
            t.mock.method(media, 'load', () => events.push('load'));
            await render(`/a.${extension}`);
            assert.equal(f.host.querySelector(kind), media);
            assert.equal(media.getAttribute('src'), `/a.${extension}`);
            await render(`/b.${extension}`);
            assert.equal(f.host.querySelector(kind), media);
            assert.equal(media.getAttribute('src'), `/b.${extension}`);
            assert.deepEqual(events, []);
            await render(`/c.${extension}`, 'successor');
            const successor = f.host.querySelector(kind);
            assert.ok(successor);
            assert.notEqual(successor, media);
            assert.equal(successor.getAttribute('src'), `/c.${extension}`);
            if (kind === 'video') {
                assert.deepEqual(events, ['pause', 'load']);
                assert.equal(media.getAttribute('src'), null);
                const cleanup: string[] = [];
                t.mock.method(successor, 'pause', () => cleanup.push('pause'));
                t.mock.method(successor, 'load', () => cleanup.push('load'));
                await f.render(null);
                assert.deepEqual(cleanup, ['pause', 'load']);
                assert.equal(successor.getAttribute('src'), null);
            } else await f.render(null);
            assert.equal(f.host.querySelector(kind), null);
            assert.equal(f.submits(), 0);
        });
    }
}
