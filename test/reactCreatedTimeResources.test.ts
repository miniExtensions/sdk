import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Window } from 'happy-dom';
import { act, createElement as h, StrictMode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { documentCanvasHarness } from './documentPreviewHarness.js';
import {
    CreatedTimeField as ControlledCreatedTimeField,
    type ControlledCreatedTimeFieldProps,
} from '../src/react/index.js';

const imageURL = 'https://resources.example.test/photo.jpg';
const documentFixtures = JSON.parse(
    readFileSync('scripts/fixtures/document-thumbnail.json', 'utf8')
) as Record<string, string>;
const opaqueURL = 'https://resources.example.test/opaque-document';
const ownedBytes = (
    mimeType: string,
    bytes: Uint8Array,
    revision: unknown = {}
) => ({
    ...base,
    value: opaqueURL,
    attachmentOptions: {
        documentPreview: {
            source: { kind: 'bytes' as const, mimeType, bytes, revision },
        },
    },
});
const labels = {
    openLink: 'Open URL',
    invalidLink: 'Invalid URL',
    openAttachment: 'Open attachment',
    attachments: 'Attachments',
    open: 'Open',
    download: 'Download',
    close: 'Close',
    tryAgain: 'Try again',
    previewUnavailable: 'Preview unavailable',
    imageUnavailable: 'Image unavailable',
    downloadFailed: 'Download failed',
};
const base: ControlledCreatedTimeFieldProps = {
    value: imageURL,
    language: 'en',
    dateConfig: {
        type: 'dateTime',
        options: {
            dateFormat: { format: 'YYYY-MM-DD' },
            timeFormat: { format: 'HH:mm' },
            timeZone: 'America/New_York',
        },
    },
    displayAsAttachments: true,
    labels,
};
const markup = (props: ControlledCreatedTimeFieldProps) =>
    renderToStaticMarkup(h(ControlledCreatedTimeField, props));

it('preserves readonly attachment precedence and mailto button fallback', () => {
    const attachment = markup({
        ...base,
        value: 'example.com/photo.jpg',
        displayAsButton: true,
        attachmentOptions: { displayMode: 'icon' },
    });
    assert.match(attachment, /src="https:\/\/example\.com\/photo\.jpg"/);
    assert.doesNotMatch(attachment, />Open URL</);
    const button = markup({
        ...base,
        value: 'mailto:user@example.com',
        displayAsButton: true,
        buttonLabel: '  Contact  ',
    });
    assert.match(button, /href="mailto:user@example.com"/);
    assert.match(button, />Contact</);
    assert.match(button, /target="_blank"/);
    assert.match(button, /rel="noreferrer"/);
    assert.doesNotMatch(button, /<img|<iframe/);
});

for (const value of [
    null,
    undefined,
    '2026-11-12T12:30:00Z',
    '/relative-path',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'file:///private/data',
    'https://user:password@example.com/file',
    'https://example.com/with\\backslash',
    'https://example.com/%0d%0aheader',
    'https://example.com/\nheader',
]) {
    it(`keeps invalid configured URL ${JSON.stringify(value)} inert`, () => {
        const output = markup({
            ...base,
            value,
            displayAsButton: true,
        });
        assert.match(output, /<button/);
        assert.match(output, /type="button"/);
        assert.match(output, /disabled/);
        assert.doesNotMatch(output, /href=|<img|<iframe/);
    });
}

it('uses configured text for editable dispatch and attachment-only fallback', () => {
    for (const props of [
        { ...base, displayAsAttachments: true },
        { ...base, displayAsButton: true, displayContext: 'editable' as const },
    ]) {
        const output = markup({
            ...props,
            value: '2026-11-12T12:30:00Z',
        });
        assert.match(output, /2026-11-12 07:30/);
        assert.doesNotMatch(output, /<button|<img|href=/);
    }
});

it('validates shape and conceals before considering URL modes', () => {
    const malformed = {
        toString: () => {
            throw Error('Do not coerce a native value');
        },
    } as unknown as string;
    const invalid = markup({
        ...base,
        value: malformed,
        displayAsButton: true,
    });
    assert.match(invalid, /role="alert"/);
    assert.doesNotMatch(invalid, /href=|<img/);
    const concealed = markup({
        ...base,
        value: malformed,
        displayAsButton: true,
        masked: true,
    });
    assert.match(concealed, /••••••••/);
    assert.doesNotMatch(concealed, /href=|<img|<button/);
});

it('uses localized fallback labels and removes resource activation in preview', () => {
    const button = markup({
        ...base,
        value: 'example.com/resource',
        displayAsAttachments: false,
        displayAsButton: true,
        buttonLabel: '  ',
        labels: { ...labels, openLink: 'Ouvrir le lien' },
    });
    assert.match(button, /Ouvrir le lien/);
    for (const displayAsAttachments of [false, true]) {
        const inert = markup({
            ...base,
            displayAsAttachments,
            displayAsButton: true,
            inert: true,
        });
        assert.doesNotMatch(inert, /href=|<img|<iframe/);
    }
});

async function fixture(
    t: TestContext,
    transport?: (url: string, init?: RequestInit) => Promise<Response>,
    visibleInitially = true,
    strict = false
) {
    const window = new Window({
        url: 'https://created-time.example.test/',
        settings: {
            disableCSSFileLoading: true,
            disableJavaScriptFileLoading: true,
            disableIframePageLoading: true,
        },
    });
    const requests: { url: string; init?: RequestInit }[] = [];
    const observers = new Set<{
        emit(visible: boolean): void;
    }>();
    class OwnedVisibilityObserver {
        private targets = new Set<Element>();
        constructor(private callback: IntersectionObserverCallback) {}
        observe(target: Element) {
            this.targets.add(target);
            observers.add(this);
            this.emit(visibleInitially);
        }
        unobserve(target: Element) {
            this.targets.delete(target);
        }
        disconnect() {
            this.targets.clear();
            observers.delete(this);
        }
        takeRecords() {
            return [];
        }
        emit(visible: boolean) {
            this.callback(
                Array.from(this.targets, (target) => ({
                    target,
                    isIntersecting: visible,
                    intersectionRatio: visible ? 1 : 0,
                    time: 0,
                    boundingClientRect: {} as DOMRectReadOnly,
                    intersectionRect: {} as DOMRectReadOnly,
                    rootBounds: null,
                })),
                this as unknown as IntersectionObserver
            );
        }
    }
    Object.defineProperty(window, 'IntersectionObserver', {
        value: OwnedVisibilityObserver,
    });
    const fetchResource = async (
        input: RequestInfo | URL,
        init?: RequestInit
    ) => {
        assert.equal(typeof input, 'string');
        const url = input as string;
        requests.push({ url, init });
        if (!transport) throw Error('Unexpected resource request');
        return transport(url, init);
    };
    const keys = [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'HTMLAnchorElement',
        'HTMLDialogElement',
        'Node',
        'fetch',
        'IS_REACT_ACT_ENVIRONMENT',
    ] as const;
    const originals = keys.map((key) =>
        Object.getOwnPropertyDescriptor(globalThis, key)
    );
    let root: import('react-dom/client').Root | undefined;
    let submissions = 0;
    let bubbledClicks = 0;
    t.after(async () => {
        try {
            if (root) {
                const mountedRoot = root;
                await act(async () => mountedRoot.unmount());
            }
        } finally {
            try {
                await window.happyDOM.close();
            } finally {
                keys.forEach((key, index) => {
                    const original = originals[index];
                    if (original)
                        Object.defineProperty(globalThis, key, original);
                    else Reflect.deleteProperty(globalThis, key);
                });
                assert.equal(submissions, 0);
                if (!transport) assert.equal(requests.length, 0);
            }
        }
    });
    for (const key of keys)
        Object.defineProperty(globalThis, key, {
            configurable: true,
            writable: true,
            value:
                key === 'IS_REACT_ACT_ENVIRONMENT'
                    ? true
                    : key === 'fetch'
                      ? fetchResource
                      : window[key as keyof Window],
        });
    Object.defineProperty(window, 'fetch', { value: fetchResource });
    const { createRoot } = await import('react-dom/client');
    const container = window.document.createElement('form');
    window.document.body.append(container);
    container.addEventListener('submit', (event) => {
        submissions++;
        event.preventDefault();
    });
    window.document.body.addEventListener('click', () => {
        bubbledClicks++;
    });
    const mountedRoot = createRoot(container as unknown as HTMLElement);
    root = mountedRoot;
    const render = async (props: ControlledCreatedTimeFieldProps) => {
        const view = h(
            'div',
            null,
            h(ControlledCreatedTimeField, props),
            h('input', { 'data-neighbor': true, defaultValue: 'neighbor' })
        );
        await act(async () =>
            mountedRoot.render(strict ? h(StrictMode, null, view) : view)
        );
    };
    const click = async (
        element: NonNullable<ReturnType<typeof container.querySelector>>
    ) => {
        await act(async () => {
            element.dispatchEvent(
                new window.MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                })
            );
        });
    };
    const button = (text: string) => {
        const result = Array.from(
            window.document.querySelectorAll('button')
        ).find((node) => node.textContent?.trim() === text);
        assert.ok(result, `Missing button ${text}`);
        return result;
    };
    const open = async (url: string) => {
        const result = Array.from(container.querySelectorAll('button')).find(
            (node) => node.getAttribute('aria-label') === url
        );
        assert.ok(result, 'Missing attachment preview opener');
        await click(result);
    };
    return {
        window,
        container,
        render,
        click,
        button,
        open,
        requests,
        visibility: async (visible: boolean) => {
            await act(async () => {
                for (const observer of observers) observer.emit(visible);
            });
        },
        bubbledClicks: () => bubbledClicks,
        dialog: () => window.document.querySelector('dialog, [role="dialog"]'),
    };
}

async function untilDocument(check: () => boolean, diagnostic?: () => string) {
    const end = Date.now() + 3000;
    while (!check() && Date.now() < end) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
        });
    }
    assert.ok(check(), diagnostic?.() ?? 'Owned document did not settle');
}

for (const failure of ['error', 'messageerror', 'retire', 'latent retire'])
    it(`closes an owned PDF worker with no ready handshake on ${failure}`, async (t) => {
        const f = await fixture(t);
        const workers: FailedWorker[] = [];
        let current = true;
        class FailedWorker extends EventTarget {
            terminated = false;
            constructor() {
                super();
                workers.push(this);
            }
            postMessage() {
                throw Error('No protocol before ready');
            }
            terminate() {
                this.terminated = true;
            }
        }
        Object.defineProperty(f.window, 'Worker', {
            configurable: true,
            value: FailedWorker,
        });
        const props: ControlledCreatedTimeFieldProps = {
            ...ownedBytes(
                'application/pdf',
                Buffer.from(documentFixtures.pdf, 'base64')
            ),
            owner: { token: {}, isCurrent: () => current },
            attachmentOptions: {
                isInGrid: true,
                documentPreview: {
                    source: {
                        kind: 'bytes',
                        mimeType: 'application/pdf',
                        bytes: Buffer.from(documentFixtures.pdf, 'base64'),
                        revision: {},
                    },
                    pdfWorkerUrl:
                        'https://created-time.example.test/missing-worker.mjs',
                    pdfResourceBaseUrl:
                        'https://created-time.example.test/pdf-assets/',
                },
            },
        };
        await f.render(props);
        await untilDocument(() => workers.length === 1);
        if (failure === 'latent retire') {
            current = false;
            await act(async () =>
                workers[0].dispatchEvent(
                    new MessageEvent('message', { data: { action: 'ready' } })
                )
            );
        } else if (failure === 'retire')
            await f.render({ ...props, inert: true });
        else {
            await act(async () =>
                workers[0].dispatchEvent(
                    new Event(failure, { cancelable: true })
                )
            );
            assert.match(
                f.container.textContent ?? '',
                /Document preview unavailable/
            );
        }
        assert.equal(workers[0].terminated, true);
        assert.equal(f.container.querySelector('canvas'), null);
    });

it('retires a PDF byte download when the live payload revision changes during completion', async (t) => {
    const f = await fixture(t, async () => {
        throw Error('Synthetic PDF requires no font fetch');
    });
    documentCanvasHarness(t, f.window);
    const source = {
        kind: 'bytes' as const,
        mimeType: 'application/pdf',
        bytes: Buffer.from(documentFixtures.pdf, 'base64'),
        revision: {},
    };
    await f.render({
        ...base,
        value: opaqueURL,
        attachmentOptions: {
            isInGrid: true,
            disableOpenFiles: true,
            documentPreview: {
                source,
                pdfWorkerUrl:
                    'https://created-time.example.test/pdf.worker.mjs',
                pdfResourceBaseUrl:
                    'https://created-time.example.test/pdf-assets/',
            },
        },
    });
    await untilDocument(
        () => f.container.querySelector('[data-rendered-page]') !== null
    );
    const create = URL.createObjectURL,
        revoke = URL.revokeObjectURL;
    const click = f.window.HTMLAnchorElement.prototype.click;
    let downloads = 0,
        made = 0,
        revoked = 0;
    URL.createObjectURL = () => {
        made++;
        source.revision = {};
        return 'blob:retired-pdf-bytes';
    };
    URL.revokeObjectURL = () => {
        revoked++;
    };
    f.window.HTMLAnchorElement.prototype.click = () => {
        downloads++;
    };
    t.after(() => {
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
        f.window.HTMLAnchorElement.prototype.click = click;
    });
    await f.click(f.button('Download'));
    await untilDocument(() => revoked === 1);
    assert.equal(made, 1);
    assert.equal(downloads, 0);
    assert.equal(f.container.querySelector('a[download]'), null);
});

it('renders explicitly admitted text only while visible and preserves the sibling draft', async (t) => {
    const f = await fixture(t, undefined, false);
    const bytes = new TextEncoder().encode('First literal');
    const revision = {};
    await f.render(ownedBytes('text/plain', bytes, revision));
    assert.equal(f.container.querySelector('[data-document-thumbnail]'), null);
    const neighbor = f.container.querySelector('[data-neighbor]');
    assert.ok(neighbor instanceof f.window.HTMLInputElement);
    neighbor.value = 'unsaved neighbor';
    await f.visibility(true);
    await untilDocument(
        () => f.container.textContent?.includes('First literal') === true
    );
    bytes.set(new TextEncoder().encode('Later literal'));
    await f.render(ownedBytes('text/plain', bytes, revision));
    assert.match(f.container.textContent ?? '', /First literal/);
    await f.render(ownedBytes('text/plain', bytes));
    await untilDocument(
        () => f.container.textContent?.includes('Later literal') === true
    );
    assert.equal(f.container.querySelector('[data-neighbor]'), neighbor);
    assert.equal(neighbor.value, 'unsaved neighbor');
    await f.visibility(false);
    assert.equal(f.container.querySelector('[data-document-thumbnail]'), null);
});

it('renders CSV headers and cells as literal text through the natural API', async (t) => {
    const f = await fixture(t);
    await f.render(
        ownedBytes('text/csv', new TextEncoder().encode(documentFixtures.csv))
    );
    await untilDocument(() => f.container.querySelectorAll('td').length === 4);
    assert.deepEqual(
        Array.from(
            f.container.querySelectorAll('th'),
            (node) => node.textContent
        ),
        ['Name', 'Value']
    );
    assert.match(
        f.container.textContent ?? '',
        /<img src=x onerror=alert\(1\)>/
    );
    assert.equal(f.container.querySelector('img, script'), null);
    await f.open(opaqueURL);
    assert.match(f.dialog()!.textContent ?? '', /Preview unavailable/);
    assert.equal(f.dialog()!.querySelector('table'), null);
});

it('renders sanitized owned HTML without embedded loads, navigation, controls or global IDs', async (t) => {
    const f = await fixture(t);
    await f.render(
        ownedBytes('text/html', new TextEncoder().encode(documentFixtures.html))
    );
    await untilDocument(() => f.container.querySelector('h2') !== null);
    assert.equal(f.container.querySelector('h2')!.textContent, 'Owned HTML');
    assert.equal(
        f.container.querySelector('strong')!.textContent,
        'Safe formatting'
    );
    const content = f.container.querySelector('[data-document-thumbnail]')!;
    assert.equal(
        content.querySelector(
            'script, iframe, img, form, input, style, [href], [src], [id]'
        ),
        null
    );
    assert.equal(f.requests.length, 0);
});

it('requires explicit URI admission and keeps discovered MIME private to the thumbnail', async (t) => {
    const f = await fixture(t, async (_url, init) =>
        init?.method === 'HEAD'
            ? new Response(null, {
                  headers: { 'Content-Type': 'text/csv; charset=utf-8' },
              })
            : new Response(documentFixtures.csv)
    );
    await f.render({
        ...base,
        value: opaqueURL,
        attachmentOptions: { documentPreview: { source: { kind: 'uri' } } },
    });
    await untilDocument(() => f.container.querySelector('table') !== null);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].init?.method, 'HEAD');
    for (const request of f.requests) {
        assert.equal(request.url, opaqueURL);
        assert.equal(request.init?.credentials, 'omit');
    }
    await f.open(opaqueURL);
    assert.match(f.dialog()!.textContent ?? '', /Preview unavailable/);
    assert.equal(f.requests.length, 2);
});

for (const mime of [
    'application/octet-stream',
    'application/msword',
    'image/svg+xml',
]) {
    it(`refuses ${mime} after MIME admission without GET or provider activation`, async (t) => {
        const f = await fixture(
            t,
            async () =>
                new Response(null, { headers: { 'Content-Type': mime } })
        );
        await f.render({
            ...base,
            value: opaqueURL,
            attachmentOptions: { documentPreview: { source: { kind: 'uri' } } },
        });
        await untilDocument(
            () =>
                f.container.textContent?.includes(
                    'Document preview unavailable'
                ) === true
        );
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].init?.method, 'HEAD');
        assert.equal(
            f.container.querySelector('iframe, object, embed, img'),
            null
        );
    });
}

it('cancels a document read when owner retirement is observed without parent rerender', async (t) => {
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({
        start(value) {
            stream = value;
        },
        cancel() {
            cancelled++;
        },
    });
    const f = await fixture(t, async () => new Response(body));
    let current = true;
    await f.render({
        ...base,
        value: opaqueURL,
        owner: { token: {}, isCurrent: () => current },
        attachmentOptions: {
            documentPreview: {
                source: { kind: 'uri', mimeType: 'text/plain' },
            },
        },
    });
    await untilDocument(() => body.locked);
    current = false;
    await act(async () => stream!.enqueue(new Uint8Array([65])));
    assert.equal(cancelled, 1);
    assert.equal(body.locked, false);
    assert.equal(f.requests[0].init?.signal?.aborted, true);
    assert.doesNotMatch(
        f.container.textContent ?? '',
        /Document preview unavailable/
    );
});

it('refuses late document A to B to A completions and aborts the retired loads', async (t) => {
    const pending: ((value: Response) => void)[] = [];
    const f = await fixture(
        t,
        () => new Promise((resolve) => pending.push(resolve))
    );
    const props = (value: string): ControlledCreatedTimeFieldProps => ({
        ...base,
        value,
        attachmentOptions: {
            documentPreview: {
                source: { kind: 'uri', mimeType: 'text/plain' },
            },
        },
    });
    await f.render(props(opaqueURL));
    await f.render(props(opaqueURL + '-b'));
    await f.render(props(opaqueURL));
    assert.equal(pending.length, 3);
    await act(async () => {
        pending[0](new Response('old A'));
        pending[1](new Response('old B'));
        pending[2](new Response('new A'));
    });
    await untilDocument(
        () => f.container.textContent?.includes('new A') === true
    );
    assert.doesNotMatch(f.container.textContent ?? '', /old A|old B/);
    assert.equal(f.requests[0].init?.signal?.aborted, true);
    assert.equal(f.requests[1].init?.signal?.aborted, true);
});

it('keeps explicit document admission inert and conceals before inspecting its inputs', async (t) => {
    const f = await fixture(t);
    const documentPreview = Object.defineProperty({}, 'source', {
        get() {
            throw Error('Do not inspect concealed document');
        },
    }) as NonNullable<
        ControlledCreatedTimeFieldProps['attachmentOptions']
    >['documentPreview'];
    for (const extra of [
        { inert: true },
        { masked: true },
        { owner: { isCurrent: () => false } },
    ]) {
        await f.render({
            ...base,
            value: opaqueURL,
            ...extra,
            attachmentOptions: { documentPreview },
        });
        assert.equal(
            f.container.querySelector('[data-document-thumbnail]'),
            null
        );
    }
});

it('mounts and retires thumbnail/grid resources with visibility while keeping icon mode immediate', async (t) => {
    assert.doesNotMatch(markup(base), /<img|<iframe/);
    const f = await fixture(t, undefined, false);
    await f.render(base);
    assert.equal(f.container.querySelector('img'), null);
    await f.visibility(true);
    const visibleImage = f.container.querySelector('img');
    assert.ok(visibleImage);
    assert.equal(visibleImage.getAttribute('src'), imageURL);
    await f.visibility(false);
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(visibleImage.getAttribute('src'), null);
    await f.render({ ...base, attachmentOptions: { displayMode: 'icon' } });
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        imageURL
    );
    await f.render({
        ...base,
        attachmentOptions: { displayMode: 'icon', isInGrid: true },
    });
    assert.equal(f.container.querySelector('img'), null);
    await f.visibility(true);
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        imageURL
    );
});

it('owns image preview, URL replacement, identity retirement and neighboring drafts', async (t) => {
    const f = await fixture(t);
    const identity = {};
    await f.render({ ...base, identity });
    const neighbor = f.container.querySelector('input[data-neighbor]');
    assert.ok(neighbor instanceof f.window.HTMLInputElement);
    neighbor.value = 'kept draft';
    await f.open(imageURL);
    assert.ok(f.dialog());
    const newerURL = 'https://resources.example.test/new.PNG?size=large';
    await f.render({ ...base, identity, value: newerURL });
    assert.ok(f.dialog());
    assert.ok(
        Array.from(f.dialog()!.querySelectorAll('img')).some(
            (node) => node.getAttribute('src') === newerURL
        )
    );
    const oldOpen = f.dialog()!.querySelector('a');
    assert.ok(oldOpen);
    await f.render({ ...base, identity: {}, value: newerURL });
    assert.equal(f.dialog(), null);
    assert.equal(oldOpen.getAttribute('href'), null);
    assert.equal(neighbor.value, 'kept draft');
    assert.equal(f.container.querySelector('input[data-neighbor]'), neighbor);
    assert.equal(f.bubbledClicks(), 0);
});

it('retires token changes before commit and does not reactivate old links after ABA', async (t) => {
    const f = await fixture(t);
    const owner = { token: 'owner-one', isCurrent: () => true };
    const props = {
        ...base,
        displayAsAttachments: false,
        displayAsButton: true,
        owner,
    };
    await f.render(props);
    const stale = f.container.querySelector('a');
    assert.ok(stale);
    owner.token = 'owner-two';
    const event = new f.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
    });
    await act(async () => {
        stale.dispatchEvent(event);
    });
    assert.equal(event.defaultPrevented, true);
    assert.equal(stale.getAttribute('href'), null);
    await f.render(props);
    assert.equal(
        f.container.querySelector('a')?.getAttribute('href'),
        imageURL
    );
    owner.token = 'owner-one';
    await f.render(props);
    assert.equal(stale.getAttribute('href'), null);
    assert.notEqual(f.container.querySelector('a'), stale);
    assert.equal(f.bubbledClicks(), 0);
});

it('keeps configured image recovery and native dialog cancellation accessible', async (t) => {
    const f = await fixture(t);
    await f.render({
        ...base,
        attachmentOptions: {
            thumbnailSize: 'small',
            thumbFitType: 'contain',
            hideAttachmentName: false,
        },
    });
    const image = f.container.querySelector('img');
    assert.ok(image);
    assert.equal(image.style.objectFit, 'contain');
    assert.match(
        f.container.querySelector('ul')!.style.gridTemplateColumns,
        /repeat\(4,/
    );
    assert.equal(f.container.querySelector('li > p')?.textContent, '');
    await act(async () => {
        image.dispatchEvent(new f.window.Event('error'));
    });
    assert.equal(
        f.container
            .querySelector('[role="status"]')
            ?.getAttribute('aria-label'),
        labels.imageUnavailable
    );
    await f.click(f.button('Try again'));
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        imageURL
    );
    const opener = Array.from(f.container.querySelectorAll('button')).find(
        (node) => node.getAttribute('aria-label') === imageURL
    );
    assert.ok(opener);
    opener.focus();
    await f.click(opener);
    const dialog = f.dialog();
    assert.ok(dialog instanceof f.window.HTMLDialogElement);
    assert.equal(dialog.open, true);
    assert.equal(dialog.getAttribute('aria-label'), labels.attachments);
    const cancel = new f.window.Event('cancel', { cancelable: true });
    await act(async () => {
        dialog.dispatchEvent(cancel);
    });
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(f.dialog(), null);
    assert.equal(f.window.document.activeElement, opener);
    assert.equal(f.bubbledClicks(), 0);
});

it('preserves URL-only PDF classification and existing HTTPS iframe protection', async (t) => {
    const f = await fixture(t);
    for (const [url, expectedIframe] of [
        ['https://resources.example.test/file.pdf', true],
        ['http://resources.example.test/file.pdf', false],
        ['https://resources.example.test/file.PDF', false],
        ['https://resources.example.test/file.pdf?query=1', false],
        ['https://resources.example.test/video.mp4', false],
    ] as const) {
        await f.render({ ...base, value: url, identity: {} });
        await f.open(url);
        const dialog = f.dialog();
        assert.ok(dialog);
        const frame = dialog.querySelector('iframe');
        assert.equal(frame !== null, expectedIframe);
        if (frame) {
            assert.equal(frame.getAttribute('src'), `${url}#toolbar=0`);
            assert.equal(frame.getAttribute('referrerpolicy'), 'no-referrer');
            assert.ok(frame.getAttribute('sandbox'));
        } else {
            assert.match(dialog.textContent ?? '', /Preview unavailable/);
        }
    }
});

it('keeps download permission independent of opening and retires inert controls', async (t) => {
    const f = await fixture(t);
    const identity = {};
    await f.render({ ...base, identity });
    await f.open(imageURL);
    const staleOpen = f.dialog()!.querySelector('a');
    assert.ok(staleOpen);
    await f.render({
        ...base,
        identity,
        attachmentOptions: { disableOpenFiles: true },
    });
    assert.ok(f.dialog());
    assert.equal(f.dialog()!.querySelector('a'), null);
    assert.equal(f.button('Download').disabled, false);
    assert.equal(staleOpen.getAttribute('href'), null);
    await f.render({ ...base, identity, inert: true });
    assert.equal(
        f.container.querySelector('a[href], img[src], iframe[src]'),
        null
    );
    assert.equal(f.dialog(), null);
    assert.equal(f.bubbledClicks(), 0);
});

it('downloads only on explicit current intent and releases object URLs', async (t) => {
    const response = new Response(new Uint8Array([1, 2, 3]));
    const f = await fixture(t, async () => response);
    const originalCreate = Object.getOwnPropertyDescriptor(
        URL,
        'createObjectURL'
    );
    const originalRevoke = Object.getOwnPropertyDescriptor(
        URL,
        'revokeObjectURL'
    );
    const created: string[] = [];
    const revoked: string[] = [];
    const downloaded: { name: string; href: string | null }[] = [];
    const originalClick = f.window.HTMLAnchorElement.prototype.click;
    Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: () => {
            const url = `blob:created-time-${created.length}`;
            created.push(url);
            return url;
        },
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: (url: string) => {
            revoked.push(url);
        },
    });
    f.window.HTMLAnchorElement.prototype.click = function () {
        downloaded.push({
            name: this.download,
            href: this.getAttribute('href'),
        });
    };
    t.after(() => {
        if (originalCreate)
            Object.defineProperty(URL, 'createObjectURL', originalCreate);
        if (originalRevoke)
            Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
        f.window.HTMLAnchorElement.prototype.click = originalClick;
    });
    await f.render(base);
    assert.equal(f.requests.length, 0);
    await f.open(imageURL);
    assert.equal(f.requests.length, 0);
    await f.click(f.button('Download'));
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, imageURL);
    assert.equal(f.requests[0].init?.credentials, 'omit');
    assert.deepEqual(downloaded, [{ name: 'Unnamed', href: created[0] }]);
    assert.deepEqual(revoked, created);
    assert.equal(f.container.querySelector('a[download]'), null);
    assert.equal(response.body!.locked, false);
});

for (const contentType of ['text/html', 'application/octet-stream']) {
    it(`keeps opaque ${contentType} bytes outside preview authority`, async (t) => {
        const url = 'https://resources.example.test/opaque-token';
        const body =
            '<script>window.unsafeDocument = true</script><p>private document</p>';
        const response = new Response(body, {
            headers: { 'Content-Type': contentType },
        });
        const f = await fixture(t, async () => response, false);
        const originalCreate = Object.getOwnPropertyDescriptor(
            URL,
            'createObjectURL'
        );
        const originalRevoke = Object.getOwnPropertyDescriptor(
            URL,
            'revokeObjectURL'
        );
        const originalClick = f.window.HTMLAnchorElement.prototype.click;
        const blobs: Blob[] = [];
        const revoked: string[] = [];
        let downloads = 0;
        Object.defineProperty(URL, 'createObjectURL', {
            configurable: true,
            value: (blob: Blob) => {
                blobs.push(blob);
                return 'blob:opaque-download';
            },
        });
        Object.defineProperty(URL, 'revokeObjectURL', {
            configurable: true,
            value: (href: string) => revoked.push(href),
        });
        f.window.HTMLAnchorElement.prototype.click = function () {
            assert.equal(this.download, 'Unnamed');
            assert.equal(this.getAttribute('href'), 'blob:opaque-download');
            downloads++;
        };
        t.after(() => {
            if (originalCreate)
                Object.defineProperty(URL, 'createObjectURL', originalCreate);
            if (originalRevoke)
                Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
            f.window.HTMLAnchorElement.prototype.click = originalClick;
        });
        const identity = {};
        const props = { ...base, value: url, identity };
        await f.render(props);
        const neighbor = f.container.querySelector('[data-neighbor]');
        assert.ok(neighbor instanceof f.window.HTMLInputElement);
        neighbor.value = 'unsaved sibling';
        await f.visibility(true);
        await f.open(url);
        assert.equal(f.requests.length, 0);
        assert.match(f.dialog()!.textContent ?? '', /Preview unavailable/);
        assert.equal(
            f.window.document.querySelector('iframe, script, object, embed'),
            null
        );
        await f.click(f.button('Download'));
        assert.equal(f.requests.length, 1);
        assert.equal(f.requests[0].url, url);
        assert.equal(f.requests[0].init?.credentials, 'omit');
        assert.equal(f.requests[0].init?.method, undefined);
        assert.equal(downloads, 1);
        assert.equal(blobs.length, 1);
        assert.equal(await blobs[0].text(), body);
        assert.equal(blobs[0].type, '');
        assert.deepEqual(revoked, ['blob:opaque-download']);
        assert.equal(response.body!.locked, false);
        await f.render(props);
        assert.equal(f.requests.length, 1);
        assert.equal(f.container.querySelector('[data-neighbor]'), neighbor);
        assert.equal(neighbor.value, 'unsaved sibling');
        assert.equal(
            f.window.document.querySelector('iframe, script, object, embed'),
            null
        );
        assert.doesNotMatch(
            f.window.document.body.textContent ?? '',
            /private document/
        );
    });
}

it('aborts and cancels an unfinished HTTP error response body', async (t) => {
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>({
        cancel() {
            cancellations++;
        },
    });
    const response = new Response(body, { status: 500 });
    t.after(async () => {
        if (!body.locked) await body.cancel();
    });
    const f = await fixture(t, async () => response);
    await f.render(base);
    await f.open(imageURL);
    await f.click(f.button('Download'));
    assert.equal(cancellations, 1);
    assert.equal(f.requests[0].init?.signal?.aborted, true);
    assert.equal(body.locked, false);
    assert.match(f.dialog()!.textContent ?? '', /Download failed/);
    assert.equal(f.container.querySelector('a[download]'), null);
});

it('reports a current-owner stream read failure before cancelling the unfinished download', async (t) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
        start(value) {
            controller = value;
        },
    });
    const f = await fixture(t, async () => new Response(body));
    const message = 'Le téléchargement a échoué';
    await f.render({ ...base, labels: { ...labels, downloadFailed: message } });
    await f.open(imageURL);
    await f.click(f.button('Download'));
    assert.equal(body.locked, true);
    await act(async () => controller!.error(Error('synthetic stream failure')));
    assert.match(f.dialog()!.textContent ?? '', new RegExp(message));
    assert.equal(f.requests[0].init?.signal?.aborted, true);
    assert.equal(body.locked, false);
    assert.equal(f.container.querySelector('a[download]'), null);
    assert.equal(f.button('Download').disabled, false);
});

it('cancels an unfinished body when a read observes retirement without a parent rerender', async (t) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancellations = 0;
    const body = new ReadableStream<Uint8Array>({
        start(value) {
            controller = value;
        },
        cancel() {
            cancellations++;
        },
    });
    const response = new Response(body);
    t.after(async () => {
        if (!body.locked) await body.cancel();
    });
    const f = await fixture(t, async () => response);
    let current = true;
    await f.render({
        ...base,
        identity: {},
        owner: { token: {}, isCurrent: () => current },
    });
    await f.open(imageURL);
    const staleDownload = f.button('Download');
    await f.click(staleDownload);
    assert.equal(body.locked, true);
    current = false;
    await act(async () => controller!.enqueue(new Uint8Array([1])));
    assert.equal(cancellations, 1);
    assert.equal(f.requests[0].init?.signal?.aborted, true);
    assert.equal(body.locked, false);
    assert.equal(f.container.querySelector('a[download]'), null);
    assert.doesNotMatch(
        f.window.document.body.textContent ?? '',
        /Download failed/
    );
    await f.click(staleDownload);
    assert.equal(f.requests.length, 1);
});

it('refuses late download completion after the source owner retires', async (t) => {
    let finish: ((response: Response) => void) | undefined;
    const f = await fixture(
        t,
        () =>
            new Promise<Response>((resolve) => {
                finish = resolve;
            })
    );
    let current = true;
    await f.render({
        ...base,
        identity: {},
        owner: { token: {}, isCurrent: () => current },
    });
    await f.open(imageURL);
    const staleDownload = f.button('Download');
    await f.click(staleDownload);
    assert.equal(f.requests.length, 1);
    current = false;
    await f.render({ ...base, owner: { token: {}, isCurrent: () => false } });
    assert.equal(f.dialog(), null);
    await act(async () => {
        finish!(new Response(new Uint8Array([4, 5])));
    });
    assert.equal(f.requests[0].init?.signal?.aborted, true);
    await f.click(staleDownload);
    assert.equal(f.requests.length, 1);
});

it('renews explicit document loading through StrictMode effect replay', async (t) => {
    const f = await fixture(
        t,
        async () => new Response('strict current'),
        true,
        true
    );
    await f.render({
        ...base,
        value: opaqueURL,
        attachmentOptions: {
            documentPreview: {
                source: { kind: 'uri', mimeType: 'text/plain' },
            },
        },
    });
    await untilDocument(
        () => f.container.textContent?.includes('strict current') === true
    );
    assert.ok(f.requests.length >= 1);
    assert.ok(f.requests.some((request) => !request.init?.signal?.aborted));
});

it('retires document loads on live owner token and payload revision changes without parent render', async (t) => {
    const pending: ((value: Response) => void)[] = [];
    const f = await fixture(
        t,
        () => new Promise((resolve) => pending.push(resolve))
    );
    const owner = { token: {}, isCurrent: () => true };
    const source = {
        kind: 'uri' as const,
        mimeType: 'text/plain',
        revision: {},
    };
    const props = {
        ...base,
        value: opaqueURL,
        owner,
        attachmentOptions: { documentPreview: { source } },
    };
    await f.render(props);
    owner.token = {};
    await act(async () => pending[0](new Response('retired token')));
    assert.doesNotMatch(f.container.textContent ?? '', /retired token/);
    assert.equal(f.requests[0].init?.signal?.aborted, true);
    await f.render(props);
    source.revision = {};
    await act(async () => pending[1](new Response('retired revision')));
    assert.doesNotMatch(f.container.textContent ?? '', /retired revision/);
    assert.equal(f.requests[1].init?.signal?.aborted, true);
    await f.render(props);
    await act(async () => pending[2](new Response('accepted successor')));
    await untilDocument(
        () => f.container.textContent?.includes('accepted successor') === true
    );
});

it('renders owned TIFF pixels and disposes the canvas on visibility retirement', async (t) => {
    const f = await fixture(t);
    const harness = documentCanvasHarness(t, f.window);
    await f.render(
        ownedBytes(
            'image/tiff',
            Buffer.from(documentFixtures.packBitsTiff, 'base64')
        )
    );
    await untilDocument(
        () => f.container.querySelector('[data-rendered-tiff]') !== null
    );
    const canvas = f.container.querySelector('canvas')!;
    assert.deepEqual(
        Array.from(
            harness.surfaces
                .get(canvas)!
                .getContext('2d')
                .getImageData(0, 0, 2, 1).data
        ),
        [255, 0, 0, 255, 0, 0, 255, 255]
    );
    await f.visibility(false);
    assert.equal(canvas.width, 0);
    assert.equal(canvas.height, 0);
    assert.equal(canvas.hasAttribute('data-rendered-tiff'), false);
});

it('keeps malformed TIFF data and unconfigured PDF inert with localized feedback', async (t) => {
    const f = await fixture(t);
    for (const mime of ['image/tiff', 'application/pdf']) {
        const props = ownedBytes(mime, new Uint8Array([0, 1, 2]));
        await f.render({
            ...props,
            attachmentOptions: {
                ...props.attachmentOptions,
                documentPreview: {
                    ...props.attachmentOptions.documentPreview,
                    labels: { unavailable: 'Pas de document' },
                },
            },
        });
        await untilDocument(
            () => f.container.textContent?.includes('Pas de document') === true
        );
        assert.equal(f.container.querySelector('iframe, img'), null);
    }
});

it('renders opaque images through owned object URLs without changing modal classification', async (t) => {
    const f = await fixture(t);
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    const created: string[] = [];
    const revoked: string[] = [];
    URL.createObjectURL = (blob) => {
        const url = create(blob);
        created.push(url);
        return url;
    };
    URL.revokeObjectURL = (url) => {
        revoked.push(url);
        revoke(url);
    };
    t.after(() => {
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
    });
    const props = ownedBytes(
        'image/png',
        Buffer.from(documentFixtures.png, 'base64')
    );
    await f.render(props);
    await untilDocument(() => f.container.querySelector('img') !== null);
    const image = f.container.querySelector('img')!;
    assert.equal(image.getAttribute('src'), created[0]);
    await f.open(opaqueURL);
    assert.match(f.dialog()!.textContent ?? '', /Preview unavailable/);
    assert.equal(f.dialog()!.querySelector('img'), null);
    await f.render({ ...props, inert: true });
    assert.equal(image.getAttribute('src'), null);
    assert.deepEqual(revoked, created);
});

it('uses actual PDF.js worker/canvas for grid page, zoom, all-pages and guarded Download', async (t) => {
    const require = createRequire(import.meta.url);
    const assets = dirname(require.resolve('pdfjs-dist/package.json'));
    const baseURL = 'https://created-time.example.test/assets/';
    const f = await fixture(t, async (url, init) => {
        assert.ok(url.startsWith(baseURL));
        assert.equal(init?.credentials, 'omit');
        const relative = url.slice(baseURL.length);
        assert.match(
            relative,
            /^(?:cmaps|standard_fonts|wasm)\/[A-Za-z0-9_.-]+$/
        );
        return new Response(
            new Uint8Array(readFileSync(join(assets, relative)))
        );
    });
    const harness = documentCanvasHarness(t, f.window);
    const bytes = Buffer.from(documentFixtures.pdf, 'base64');
    const props: ControlledCreatedTimeFieldProps = {
        ...base,
        value: opaqueURL,
        attachmentOptions: {
            isInGrid: true,
            disableOpenFiles: true,
            documentPreview: {
                source: {
                    kind: 'bytes',
                    mimeType: 'application/pdf',
                    bytes,
                    revision: {},
                },
                pdfWorkerUrl: baseURL + 'pdf.worker.mjs',
                pdfResourceBaseUrl: baseURL,
            },
        },
    };
    await f.render(props);
    await untilDocument(
        () => f.container.querySelector('[data-rendered-page="1"]') !== null,
        () =>
            JSON.stringify({
                text: f.container.textContent,
                workers: harness.workers.length,
                terminated: harness.workers.map((worker) => worker.terminated),
                messages: harness.workers.map((worker) => worker.messages),
            })
    );
    assert.equal(harness.workers.length, 1);
    const first = f.container.querySelector('canvas')!;
    assert.deepEqual(
        Array.from(
            harness.surfaces
                .get(first)!
                .getContext('2d')
                .getImageData(5, 5, 1, 1).data
        ),
        [255, 0, 0, 255]
    );
    await f.click(f.button('›'));
    await untilDocument(
        () => f.container.querySelector('[data-rendered-page="2"]') !== null
    );
    assert.equal(first.width, 0);
    await f.click(f.button('+'));
    await untilDocument(
        () => f.container.querySelector('[data-rendered-page="2"]') !== null
    );
    assert.ok(f.container.querySelector('canvas')!.width > 200);
    await f.click(f.button('1:1'));
    await untilDocument(
        () => f.container.querySelector('canvas')?.width === 200
    );
    await f.click(f.button('Show all pages'));
    await untilDocument(
        () => f.container.querySelectorAll('[data-rendered-page]').length === 2
    );
    await f.click(f.button('Show one page'));
    await untilDocument(
        () => f.container.querySelectorAll('[data-rendered-page]').length === 1
    );
    const oldClick = f.window.HTMLAnchorElement.prototype.click;
    let downloads = 0;
    f.window.HTMLAnchorElement.prototype.click = function () {
        assert.equal(this.download, 'Unnamed');
        downloads++;
    };
    t.after(() => {
        f.window.HTMLAnchorElement.prototype.click = oldClick;
    });
    const staleDownload = f.button('Download');
    await f.click(staleDownload);
    await untilDocument(() => downloads === 1);
    await f.render({
        ...props,
        attachmentOptions: {
            ...props.attachmentOptions,
            disableDownloadFiles: true,
        },
    });
    assert.equal(
        Array.from(f.container.querySelectorAll('button')).some(
            (button) => button.textContent === 'Download'
        ),
        false
    );
    await f.click(staleDownload);
    assert.equal(downloads, 1);
    assert.equal(bytes.byteLength, 917);
    assert.equal(harness.workers.length, 1);
    await f.render({ ...props, inert: true });
    await untilDocument(() =>
        harness.workers.every((worker) => worker.terminated)
    );
});

it('keeps MIME private in form thumbnails and renders known HTTP PDF modals without weakening iframe policy', async (t) => {
    const require = createRequire(import.meta.url);
    const assets = dirname(require.resolve('pdfjs-dist/package.json'));
    const baseURL = 'https://created-time.example.test/assets/';
    const f = await fixture(t, async (url, init) => {
        assert.equal(init?.credentials, 'omit');
        assert.ok(url.startsWith(baseURL));
        const relative = url.slice(baseURL.length);
        assert.match(
            relative,
            /^(?:cmaps|standard_fonts|wasm)\/[A-Za-z0-9_.-]+$/
        );
        return new Response(
            new Uint8Array(readFileSync(join(assets, relative)))
        );
    });
    const harness = documentCanvasHarness(t, f.window);
    const props: ControlledCreatedTimeFieldProps = {
        ...base,
        value: opaqueURL,
        attachmentOptions: {
            documentPreview: {
                source: {
                    kind: 'bytes',
                    mimeType: 'application/pdf',
                    bytes: Buffer.from(documentFixtures.pdf, 'base64'),
                    revision: {},
                },
                pdfWorkerUrl: baseURL + 'pdf.worker.mjs',
                pdfResourceBaseUrl: baseURL,
            },
        },
    };
    await f.render(props);
    await untilDocument(
        () => f.container.querySelector('[data-rendered-page="1"]') !== null
    );
    assert.equal(
        f.container.querySelectorAll('[data-rendered-page]').length,
        1
    );
    assert.equal(
        f.container.querySelector('[data-document-pdf-controls]'),
        null
    );
    await f.open(opaqueURL);
    assert.match(f.dialog()!.textContent ?? '', /Preview unavailable/);
    assert.equal(f.dialog()!.querySelector('canvas'), null);
    await f.click(f.button('Close'));
    const uri = 'http://resources.example.test/owned.pdf';
    await f.render({ ...props, value: uri });
    await untilDocument(() =>
        harness.workers.every((worker) => worker.terminated)
    );
    assert.equal(harness.workers.length, 1);
    await f.open(uri);
    await untilDocument(
        () => f.dialog()!.querySelectorAll('[data-rendered-page]').length === 2
    );
    assert.equal(
        f.dialog()!.querySelector('iframe, [data-document-pdf-controls]'),
        null
    );
    const canvases = Array.from(f.dialog()!.querySelectorAll('canvas'));
    await f.click(f.button('Close'));
    await untilDocument(() =>
        harness.workers.every((worker) => worker.terminated)
    );
    assert.ok(
        canvases.every((canvas) => canvas.width === 0 && canvas.height === 0)
    );
});

it('keeps equivalent URI modal successors current and rejects their latent revision changes', async (t) => {
    const require = createRequire(import.meta.url);
    const assets = dirname(require.resolve('pdfjs-dist/package.json'));
    const uri = 'https://resources.example.test/current.pdf';
    const baseURL = 'https://created-time.example.test/assets/';
    const pending: ((response: Response) => void)[] = [];
    const f = await fixture(t, async (url, init) => {
        assert.equal(init?.credentials, 'omit');
        if (url === uri)
            return new Promise<Response>((resolve) => pending.push(resolve));
        assert.ok(url.startsWith(baseURL));
        return new Response(
            new Uint8Array(
                readFileSync(join(assets, url.slice(baseURL.length)))
            )
        );
    });
    const harness = documentCanvasHarness(t, f.window);
    const first = { kind: 'uri' as const, revision: {} };
    const second = { ...first };
    const props = (source: typeof first): ControlledCreatedTimeFieldProps => ({
        ...base,
        value: uri,
        attachmentOptions: {
            documentPreview: {
                source,
                pdfWorkerUrl: baseURL + 'pdf.worker.mjs',
                pdfResourceBaseUrl: baseURL,
            },
        },
    });
    await f.render(props(first));
    await f.open(uri);
    await untilDocument(() => pending.length === 1);
    await f.render(props(second));
    first.revision = {};
    await act(async () =>
        pending[0](new Response(Buffer.from(documentFixtures.pdf, 'base64')))
    );
    await untilDocument(
        () => f.dialog()?.querySelectorAll('[data-rendered-page]').length === 2
    );
    assert.equal(
        harness.workers.length,
        1,
        'Retired source mutation cannot reject an equivalent successor'
    );
    await f.click(f.button('Close'));
    await untilDocument(() =>
        harness.workers.every((worker) => worker.terminated)
    );
    await f.open(uri);
    await untilDocument(() => pending.length === 2);
    second.revision = {};
    await act(async () =>
        pending[1](new Response(Buffer.from(documentFixtures.pdf, 'base64')))
    );
    await untilDocument(() =>
        f.requests
            .filter((request) => request.url === uri)
            .every((request) => request.init?.signal?.aborted)
    );
    assert.equal(
        harness.workers.length,
        1,
        'Current source mutation rejects the late decode before a new worker'
    );
    assert.equal(f.dialog()?.querySelector('canvas'), null);
});
