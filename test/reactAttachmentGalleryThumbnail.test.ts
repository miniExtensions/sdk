import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { act, createElement as h, type ComponentProps } from 'react';
import {
    AttachmentGalleryThumbnail,
    type AttachmentGalleryDocument,
} from '../src/react/AttachmentGalleryThumbnail.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';
import { deferred } from './fixtures/scannerDom.js';

const thumbnailClass = 'mx-sdk-attachment-gallery-thumbnail';
const captionSelector = '[data-testid=attachmentThumbnailCaptionTestId]';
const documentFallback = `.${thumbnailClass}__fallback--document`;
const defaults: ComponentProps<typeof AttachmentGalleryThumbnail> = {
    attachment: { filename: 'Synthetic attachment' },
    imageSources: [],
    icon: 'document',
    layout: 'thumbnail',
    fit: 'contain',
    showNames: true,
    retryLabel: 'Retry preview',
};

async function fixture(t: TestContext) {
    const f = await htmlPresentationFixture(t);
    const observers: Array<ViewObserver> = [];
    class ViewObserver {
        target?: unknown;
        disconnected = false;
        constructor(
            readonly notify: (entries: { isIntersecting: boolean }[]) => void
        ) {
            observers.push(this);
        }
        observe(target: unknown) {
            this.target = target;
        }
        disconnect() {
            this.disconnected = true;
        }
    }
    Object.defineProperty(f.window, 'IntersectionObserver', {
        value: ViewObserver,
    });
    const visibility = (visible: boolean) =>
        act(async () => {
            const active = observers.filter(
                (observer) => !observer.disconnected
            );
            assert.equal(active.length, 1);
            assert(active[0].target);
            active[0].notify([{ isIntersecting: visible }]);
        });
    return {
        ...f,
        observers,
        visibility,
        view: (overrides: Partial<typeof defaults> = {}) =>
            f.render(
                h(AttachmentGalleryThumbnail, { ...defaults, ...overrides })
            ),
    };
}

function uriDocument(
    path: string,
    overrides: Partial<AttachmentGalleryDocument> = {}
): AttachmentGalleryDocument {
    return {
        uri: `https://gallery.example.test/${path}`,
        options: { source: { kind: 'uri' } },
        ...overrides,
    };
}

function syntheticText(...chunks: string[]) {
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks)
                controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
        },
    });
    return new Response(stream, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
}

function observeRequests(
    respond: (
        url: string,
        method: string,
        signal: AbortSignal | null | undefined
    ) => Response | Promise<Response>
) {
    const calls: Array<{
        url: string;
        method: string;
        credentials: RequestCredentials | undefined;
        signal: AbortSignal | null | undefined;
    }> = [];
    // The fixture's own window fetch still denies loads, including iframe loads.
    globalThis.fetch = async (input, init) => {
        assert.equal(typeof input, 'string');
        const url = input as string;
        const method = init?.method ?? 'GET';
        calls.push({
            url,
            method,
            credentials: init?.credentials,
            signal: init?.signal,
        });
        return respond(url, method, init?.signal);
    };
    return calls;
}

test('gallery images defer outside the viewport except during printing and retire old observers', async (t) => {
    const f = await fixture(t);
    const primary = '/synthetic.jpg';
    const opts = { imageSources: [primary], icon: 'play' as const };
    await f.view(opts);
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(
        f.container.querySelector(captionSelector)?.textContent,
        'Synthetic attachment'
    );
    const retired = [...f.observers];
    assert.equal(
        retired.some((entry) => !entry.disconnected),
        true
    );

    await f.view({ ...opts, prepareImagesForPrint: true });
    assert(f.container.querySelector('img.object-contain'));
    await f.view(opts);
    assert.equal(f.container.querySelector('img'), null);

    await f.view({ ...opts, layout: 'icon' });
    assert(f.container.querySelector('img.object-cover'));
    assert(retired.every((entry) => entry.disconnected));
    await f.view({ ...opts, layout: 'grid' });
    assert.equal(f.container.querySelector(captionSelector), null);
    assert.equal(f.container.querySelector('img'), null);
    await act(async () =>
        retired.forEach((entry) => entry.notify([{ isIntersecting: true }]))
    );
    assert.equal(f.container.querySelector('img'), null);
    await act(async () => f.observers.at(-1)?.notify([]));
    assert.equal(f.container.querySelector('img'), null);

    await f.visibility(true);
    assert(f.container.querySelector('img.object-cover'));
    await f.visibility(false);
    assert.equal(f.container.querySelector('img'), null);
    await f.view({ imageSources: [], layout: 'icon', icon: 'play' });
    assert(f.container.querySelector(`.${thumbnailClass}--icon svg`));
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(
        f.container.querySelector(captionSelector)?.textContent,
        'Synthetic attachment'
    );
});

test('image errors fall through the admitted chain and retry is local to the tile', async (t) => {
    const f = await fixture(t);
    let bubbled = 0;
    const initial = '/synthetic-small.jpg';
    const next = '/synthetic-large.jpg';
    const img = () => f.container.querySelector('img');
    const parent = (filename?: string) =>
        h(
            'section',
            { onClick: () => bubbled++ },
            h(AttachmentGalleryThumbnail, {
                ...defaults,
                attachment: { filename },
                layout: 'icon',
                imageSources: [initial, next],
            })
        );
    await f.render(parent('Synthetic image'));
    assert.equal(img()?.getAttribute('src'), initial);
    await f.imageEvent(img()!, 'error');
    assert.equal(img()?.getAttribute('src'), next);
    await f.imageEvent(img()!, 'error');
    assert.equal(img(), null);
    const status = f.container.querySelector('[role=status]');
    assert.equal(
        status?.getAttribute('aria-label'),
        'Could not load Synthetic image'
    );
    const retry = status?.querySelector('button');
    assert(retry);
    assert.equal(retry.textContent, 'Retry preview');
    assert.equal(retry.type, 'button');
    await f.click(retry);
    assert.equal(bubbled, 0);
    assert.equal(img()?.getAttribute('src'), initial);

    await f.render(parent());
    await f.imageEvent(img()!, 'error');
    await f.imageEvent(img()!, 'error');
    assert.equal(
        f.container.querySelector('[role=status]')?.getAttribute('aria-label'),
        'Could not load attachment'
    );
});

test('local document bytes stay inside their admitted visibility and resource lifetime', async (t) => {
    const f = await fixture(t);
    const requests = observeRequests(() =>
        assert.fail('A local document cannot use HTTP transport')
    );
    const held = deferred<Response>();
    const signals: AbortSignal[] = [];
    let staleBodyCancellations = 0;
    const document = uriDocument('local', {
        readLocal(signal) {
            signals.push(signal);
            return signals.length === 1
                ? held.promise
                : Promise.resolve(syntheticText('Owned ', 'local bytes'));
        },
        legacyOfficePreview: true,
        options: {
            source: { kind: 'uri' },
            labels: { loading: 'Reading the local file' },
        },
    });
    await f.view({ document, prepareImagesForPrint: true });
    assert.equal(signals.length, 0, 'Printing only forces offscreen images');
    await f.visibility(true);
    assert.equal(signals.length, 1);
    assert.equal(
        f.container
            .querySelector('[data-testid=loading-component]')
            ?.getAttribute('aria-label'),
        'Reading the local file'
    );
    await f.visibility(false);
    assert(signals[0].aborted);
    assert.equal(
        f.container.querySelector(`.${thumbnailClass}__document`),
        null
    );

    await act(async () => {
        held.resolve(
            new Response(
                new ReadableStream({
                    cancel() {
                        staleBodyCancellations++;
                    },
                }),
                { headers: { 'Content-Type': 'text/plain' } }
            )
        );
    });
    assert.equal(staleBodyCancellations, 1);
    await f.visibility(true);
    assert.equal(signals.length, 2);
    assert.equal(
        f.container.querySelector('[data-document-thumbnail=text]')
            ?.textContent,
        'Owned local bytes'
    );
    assert.equal(
        f.container.querySelector('[data-testid=loading-component]'),
        null
    );
    assert.equal(f.container.querySelector('iframe'), null);
    assert.deepEqual(requests, []);
    await f.view({ ...defaults, layout: 'icon' });
    assert(signals[1].aborted);
});

test('local failures keep the tile fallback and preloaded bytes bypass the local reader', async (t) => {
    const f = await fixture(t);
    const requests = observeRequests(() =>
        assert.fail(
            'Admitted local and preloaded document cases must stay offline'
        )
    );
    let rejectedBodyCancellations = 0;
    const unsupported = uriDocument('unsupported', {
        async readLocal() {
            return new Response(
                new ReadableStream({
                    cancel() {
                        rejectedBodyCancellations++;
                    },
                }),
                { headers: { 'Content-Type': 'application/x-synthetic' } }
            );
        },
    });
    await f.view({ document: unsupported, icon: 'play' });
    await f.visibility(true);
    assert.equal(rejectedBodyCancellations, 1);
    assert(f.container.querySelector(`${documentFallback} svg`));
    assert.equal(f.container.querySelector('iframe'), null);

    const failure = uriDocument('rejected', {
        async readLocal() {
            throw Error('Synthetic local transport rejection');
        },
    });
    await f.view({ document: failure });
    assert(f.container.querySelector(documentFallback));

    let localReads = 0;
    const preloaded = uriDocument('preloaded', {
        async readLocal() {
            localReads++;
            throw Error('The preloaded bytes own the preview');
        },
        options: {
            source: {
                kind: 'bytes',
                revision: 1,
                mimeType: 'text/plain',
                bytes: new TextEncoder().encode('Accepted bytes'),
            },
        },
        legacyOfficePreview: true,
    });
    await f.view({ document: preloaded });
    assert.equal(
        f.container.querySelector('[data-document-thumbnail=text]')
            ?.textContent,
        'Accepted bytes'
    );
    assert.equal(localReads, 0);
    assert.deepEqual(requests, []);
});

test('renders BOM-marked UTF-16 and both UTF-8 variants as literal text', async (t) => {
    const f = await fixture(t);
    const requests = observeRequests(() =>
        assert.fail('Preloaded text previews must stay offline')
    );
    const download = t.mock.method(
        f.window.HTMLAnchorElement.prototype,
        'click',
        () => assert.fail('Rendering a preview must not download a file')
    );
    const expected = 'Café — €25';
    const utf8 = new TextEncoder().encode(expected);
    const samples = [
        [
            'UTF-16LE',
            Uint8Array.of(
                0xff,
                0xfe,
                0x43,
                0,
                0x61,
                0,
                0x66,
                0,
                0xe9,
                0,
                0x20,
                0,
                0x14,
                0x20,
                0x20,
                0,
                0xac,
                0x20,
                0x32,
                0,
                0x35,
                0
            ),
        ],
        [
            'UTF-16BE',
            Uint8Array.of(
                0xfe,
                0xff,
                0,
                0x43,
                0,
                0x61,
                0,
                0x66,
                0,
                0xe9,
                0,
                0x20,
                0x20,
                0x14,
                0,
                0x20,
                0x20,
                0xac,
                0,
                0x32,
                0,
                0x35
            ),
        ],
        ['UTF-8 with BOM', Uint8Array.of(0xef, 0xbb, 0xbf, ...utf8)],
        ['UTF-8', utf8],
    ] as const;
    const actual: Record<string, string | null> = {};
    for (const [revision, [encoding, bytes]] of samples.entries()) {
        await f.view({
            document: uriDocument('encoding.txt', {
                options: {
                    source: {
                        kind: 'bytes',
                        revision,
                        mimeType: 'text/plain',
                        bytes,
                    },
                },
            }),
        });
        await f.visibility(true);
        actual[encoding] =
            f.container.querySelector('[data-document-thumbnail=text]')
                ?.textContent ?? null;
        assert.equal(f.container.querySelector('iframe, a[download]'), null);
    }

    f.unchangedEffects();
    assert.equal(download.mock.callCount(), 0);
    assert.deepEqual(requests, []);
    assert.deepEqual(
        actual,
        Object.fromEntries(samples.map(([encoding]) => [encoding, expected]))
    );
});

test('legacy Office performs only an admitted HEAD and no SDK GET, while known text is read in place', async (t) => {
    const f = await fixture(t);
    const office = uriDocument('opaque?id=a&selection=1', {
        legacyOfficePreview: true,
    });
    const ordinary = uriDocument('text', { legacyOfficePreview: true });
    const known = uriDocument('known', {
        legacyOfficePreview: true,
        options: { source: { kind: 'uri', mimeType: 'text/plain' } },
    });
    const calls = observeRequests((url, method) => {
        if (url === office.uri) {
            assert.equal(method, 'HEAD');
            return new Response(null, {
                headers: {
                    'Content-Type':
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=binary',
                },
            });
        }
        if (url === ordinary.uri && method === 'HEAD') {
            return new Response(null, {
                headers: { 'Content-Type': 'text/plain' },
            });
        }
        assert(method === 'GET' && (url === ordinary.uri || url === known.uri));
        return syntheticText('Synthetic remote text');
    });
    await f.view({ layout: 'grid', document: office });
    assert.equal(calls.length, 0);
    await f.visibility(true);
    const frame = f.container.querySelector('iframe');
    assert(frame);
    assert.equal(frame.id, 'msdoc-iframe');
    assert.equal(frame.title, 'msdoc-iframe');
    assert.equal(frame.getAttribute('frameBorder'), '0');
    assert.equal(
        frame.getAttribute('src'),
        `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(office.uri)}`
    );
    assert(
        f.container.querySelector(`.${thumbnailClass}__document.object-cover`)
    );
    assert.deepEqual(
        calls.map(({ url, method, credentials }) => [url, method, credentials]),
        [[office.uri, 'HEAD', 'omit']]
    );

    await f.view({ layout: 'grid', document: ordinary });
    assert.equal(calls[0].signal?.aborted, true);
    assert.equal(frame.isConnected, false);
    assert.equal(
        f.container.querySelector('[data-document-thumbnail=text]')
            ?.textContent,
        'Synthetic remote text'
    );
    await f.view({ layout: 'grid', document: known });
    assert.equal(
        f.container.querySelector('[data-document-thumbnail=text]')
            ?.textContent,
        'Synthetic remote text'
    );
    assert.deepEqual(
        calls
            .slice(1)
            .map(({ url, method, credentials }) => [url, method, credentials]),
        [
            [ordinary.uri, 'HEAD', 'omit'],
            [ordinary.uri, 'GET', 'omit'],
            [known.uri, 'GET', 'omit'],
        ]
    );
});

test('retired, denied, disabled and rejected Office probes never publish an iframe', async (t) => {
    const f = await fixture(t);
    const held = deferred<Response>();
    const stale = uriDocument('retired', { legacyOfficePreview: true });
    const denied = uriDocument('denied', {
        uri: 'file:///denied',
        legacyOfficePreview: true,
    });
    const disabled = uriDocument('disabled');
    const rejected = uriDocument('rejected', { legacyOfficePreview: true });
    const unavailable = uriDocument('unavailable', {
        legacyOfficePreview: true,
    });
    const calls = observeRequests((url, method) => {
        assert.equal(method, 'HEAD');
        if (url === stale.uri) return held.promise;
        if (url === disabled.uri)
            return new Response(null, {
                headers: { 'Content-Type': 'application/msword' },
            });
        if (url === rejected.uri) throw Error('Synthetic HEAD failure');
        assert.equal(url, unavailable.uri);
        return new Response(null, {
            status: 403,
            headers: { 'Content-Type': 'application/msword' },
        });
    });
    await f.view({ document: stale });
    await f.visibility(true);
    assert.equal(calls.length, 1);
    assert(f.container.querySelector('[data-testid=loading-component]'));
    await f.view({ document: denied });
    assert.equal(calls[0].signal?.aborted, true);
    assert.equal(calls.length, 1);
    assert(f.container.querySelector(documentFallback));
    await act(async () =>
        held.resolve(
            new Response(null, {
                headers: { 'Content-Type': 'application/msword' },
            })
        )
    );
    assert.equal(f.container.querySelector('iframe'), null);
    assert(f.container.querySelector(documentFallback));

    for (const document of [disabled, rejected, unavailable]) {
        await f.view({ document });
        assert(f.container.querySelector(documentFallback));
        assert.equal(f.container.querySelector('iframe'), null);
    }
    assert.deepEqual(
        calls.map(({ url, method }) => [url, method]),
        [
            [stale.uri, 'HEAD'],
            [disabled.uri, 'HEAD'],
            [rejected.uri, 'HEAD'],
            [unavailable.uri, 'HEAD'],
        ]
    );
});
