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
        unmount: async () => {
            const current = root;
            root = undefined;
            await act(async () => current?.unmount());
        },
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

it('denies revoked connected actions while preserving Close and suppressing obsolete focus', async (t) => {
    const f = await fixture(t);
    let valid = true;
    const owner = { token: {}, isCurrent: () => valid };
    const requests = t.mock.method(globalThis, 'fetch', async () => {
        throw Error('No revoked resource request');
    });
    await f.render({
        entries: [entry('first'), entry('second')],
        owner,
        identity: 'owned',
    });
    const opener = f.host.querySelector('button')!;
    opener.focus();
    await f.open(0);
    valid = false; // No render or notification: retained controls must recheck.
    const link = f.host.querySelector('.mx-sdk-url-gallery__actions a')!;
    for (const type of ['click', 'auxclick']) {
        const event = new f.window.MouseEvent(type, {
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            link.dispatchEvent(event);
        });
        assert.equal(event.defaultPrevented, true);
    }
    await f.click('button[aria-label="Next"]');
    assert.equal(f.index(), '1 / 2');
    const download = Array.from(f.host.querySelectorAll('button')).find(
        (node) => node.textContent === 'Download'
    )!;
    await act(async () => download.click());
    assert.equal(requests.mock.callCount(), 0);
    const close = Array.from(f.host.querySelectorAll('button')).find(
        (node) => node.textContent === 'Close'
    )!;
    await act(async () => close.click());
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    assert.notEqual(f.window.document.activeElement, opener);
    assert.equal(f.submits(), 0);
});

it('never upgrades a deferred same-URL download into a replacement owner', async (t) => {
    const f = await fixture(t);
    let current = 1,
        clicks = 0;
    const pending: {
        resolve(response: Response): void;
        signal: AbortSignal;
    }[] = [];
    t.mock.method(URL, 'createObjectURL', () => 'blob:owned-gallery');
    t.mock.method(URL, 'revokeObjectURL', () => {});
    t.mock.method(f.window.HTMLAnchorElement.prototype, 'click', () => {
        clicks++;
    });
    t.mock.method(
        globalThis,
        'fetch',
        async (_url: string | URL | Request, options?: RequestInit) =>
            new Promise<Response>((resolve) =>
                pending.push({
                    resolve,
                    signal: options!.signal as AbortSignal,
                })
            )
    );
    const entries = [entry('same')];
    const owner = (generation: number) => ({
        token: {},
        isCurrent: () => current === generation,
    });
    const a = owner(1),
        b = owner(2),
        a2 = owner(3);
    const download = async () => {
        const button = Array.from(f.host.querySelectorAll('button')).find(
            (node) => node.textContent === 'Download'
        )!;
        assert.ok(button);
        await act(async () => button.click());
    };
    await f.render({ entries, owner: a, identity: 'same-record' });
    await f.open(0);
    await download();
    current = 2;
    await f.render({ entries, owner: b, identity: 'same-record' });
    assert.equal(pending[0].signal.aborted, true);
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    await f.open(0);
    await download();
    await act(async () =>
        pending[0].resolve(new Response(new Uint8Array([1])))
    );
    assert.equal(clicks, 0);
    assert.match(f.host.textContent ?? '', /0%/);
    await act(async () =>
        pending[1].resolve(new Response(new Uint8Array([2])))
    );
    assert.equal(clicks, 1);
    current = 3;
    await f.render({ entries, owner: a2, identity: 'same-record' });
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    assert.equal(a.isCurrent(), false);
    await f.open(0);
    await download();
    await act(async () =>
        pending[2].resolve(new Response(new Uint8Array([3])))
    );
    assert.equal(clicks, 2);
    assert.equal(f.host.ownerDocument.querySelector('a[download]'), null);
    assert.equal(f.submits(), 0);
});

it('aborts subscribed retirement and ignores obsolete notifications after same-owner reconciliation', async (t) => {
    const f = await fixture(t);
    let current = true;
    const listeners = new Set<() => void>();
    const retained: (() => void)[] = [];
    const owner = {
        token: {},
        isCurrent: () => current,
        subscribe(listener: () => void) {
            listeners.add(listener);
            retained.push(listener);
            return () => listeners.delete(listener);
        },
    };
    let signal: AbortSignal | undefined;
    let resolve!: (response: Response) => void;
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
    await f.render({
        entries: [entry('same'), entry('same')],
        owner,
        identity: 'a',
    });
    await f.open(1);
    await f.render({
        entries: [entry('same'), entry('same'), entry('other')],
        owner,
        identity: 'a',
    });
    assert.equal(f.index(), '2 / 3');
    const button = Array.from(f.host.querySelectorAll('button')).find(
        (node) => node.textContent === 'Download'
    )!;
    await act(async () => button.click());
    current = false;
    await act(async () => {
        for (const listener of [...listeners]) listener();
    });
    assert.equal(signal?.aborted, true);
    assert.equal(listeners.size, 0);
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    await act(async () => resolve(new Response(new Uint8Array([1]))));
    const successor = { token: {}, isCurrent: () => true };
    await f.render({
        entries: [entry('successor')],
        owner: successor,
        identity: 'b',
    });
    await f.open(0);
    await act(async () => {
        for (const listener of retained) listener();
    });
    assert.ok(f.host.querySelector('[role="dialog"]'));
    assert.equal(f.submits(), 0);
});

it('preserves legacy external focus return on full gallery unmount', async (t) => {
    const f = await fixture(t);
    const external = f.window.document.createElement('button');
    f.window.document.body.append(external);
    await f.render({ entries: [entry('legacy')] });
    external.focus();
    await f.open(0);
    assert.notEqual(f.window.document.activeElement, external);
    await f.unmount();
    assert.equal(f.window.document.activeElement, external);
});

it('reconciles a selected occurrence across resource replacement only while its parent selection lease remains current', async (t) => {
    const f = await fixture(t);
    const lifetime = () => {
        let current = true;
        const listeners = new Set<() => void>();
        return {
            owner: {
                token: {},
                isCurrent: () => current,
                subscribe(listener: () => void) {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
            },
            invalidate() {
                current = false;
            },
            async retire() {
                await act(async () => {
                    current = false;
                    for (const listener of [...listeners]) listener();
                });
            },
            listeners,
        };
    };
    const parent = lifetime();
    let resource = lifetime();
    const a = entry('A'),
        b = entry('B'),
        c = entry('C');
    await f.render({
        entries: [a, b, c],
        selectionOwner: parent.owner,
        owner: resource.owner,
    });
    await f.open(2);
    assert.equal(f.index(), '3 / 3');
    const oldOpen = f.host.querySelector('a[target="_blank"]')!;
    resource.invalidate();
    assert.equal(oldOpen.isConnected, true);
    const staleMenu = new f.window.MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
    });
    oldOpen.dispatchEvent(staleMenu);
    assert.equal(staleMenu.defaultPrevented, true);
    const staleClick = new f.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
    });
    oldOpen.dispatchEvent(staleClick);
    assert.equal(staleClick.defaultPrevented, true);
    await resource.retire();
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    for (const [entries, expected] of [
        [[c], '1 / 1'],
        [[a], '1 / 1'],
        [[a, c, b], '1 / 3'],
    ] as const) {
        resource = lifetime();
        await f.render({
            entries,
            selectionOwner: parent.owner,
            owner: resource.owner,
        });
        assert.equal(f.index(), expected);
        assert.equal(
            f.host.querySelector('a[target="_blank"]')?.getAttribute('href'),
            entries[0]!.url
        );
        await resource.retire();
        assert.equal(f.host.querySelector('[role="dialog"]'), null);
    }
    resource = lifetime();
    await f.render({
        entries: [c, a, b],
        selectionOwner: parent.owner,
        owner: resource.owner,
    });
    assert.ok(f.host.querySelector('[role="dialog"]'));
    const obsoleteTrigger = f.host.querySelector('li button')!;
    await parent.retire();
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    const successor = lifetime();
    await f.render({
        entries: [c, a, b],
        selectionOwner: successor.owner,
        owner: resource.owner,
    });
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    await act(async () => (obsoleteTrigger as unknown as HTMLElement).click());
    assert.equal(f.host.querySelector('[role="dialog"]'), null);
    await f.open(0);
    assert.ok(f.host.querySelector('[role="dialog"]'));
    await f.unmount();
    assert.equal(successor.listeners.size, 0);
    assert.equal(resource.listeners.size, 0);
    assert.equal(f.submits(), 0);
});

it('keeps a same-owner pending resource through reorder and releases listeners on unmount before settlement', async (t) => {
    const f = await fixture(t);
    const listeners = new Set<() => void>();
    const owner = {
        token: {},
        isCurrent: () => true,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    const pending: {
        resolve(response: Response): void;
        signal: AbortSignal;
    }[] = [];
    let clicks = 0;
    t.mock.method(URL, 'createObjectURL', () => 'blob:reconciled-gallery');
    t.mock.method(URL, 'revokeObjectURL', () => {});
    t.mock.method(f.window.HTMLAnchorElement.prototype, 'click', () => {
        clicks++;
    });
    t.mock.method(
        globalThis,
        'fetch',
        async (_url: string | URL | Request, options?: RequestInit) =>
            new Promise<Response>((resolve) =>
                pending.push({
                    resolve,
                    signal: options!.signal as AbortSignal,
                })
            )
    );
    const download = async () => {
        const button = Array.from(f.host.querySelectorAll('button')).find(
            (node) => node.textContent === 'Download'
        )!;
        await act(async () => button.click());
    };
    await f.render({
        entries: [entry('same'), entry('middle'), entry('same')],
        owner,
        identity: 'a',
    });
    await f.open(2);
    await download();
    await f.render({
        entries: [entry('same'), entry('same'), entry('middle')],
        owner,
        identity: 'a',
    });
    assert.equal(f.index(), '2 / 3');
    assert.equal(pending[0].signal.aborted, false);
    await act(async () =>
        pending[0].resolve(new Response(new Uint8Array([1])))
    );
    assert.equal(clicks, 1);
    await download();
    assert.equal(listeners.size, 2);
    await f.unmount();
    assert.equal(pending[1].signal.aborted, true);
    assert.equal(listeners.size, 0);
    await act(async () =>
        pending[1].resolve(new Response(new Uint8Array([2])))
    );
    assert.equal(clicks, 1);
});
