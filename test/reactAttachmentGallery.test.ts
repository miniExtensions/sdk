import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement as h } from 'react';
import type {
    AttachmentGalleryProps,
    AttachmentGalleryRow,
} from '../src/react/attachment-slider.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';
import { deferred, scannerDom } from './fixtures/scannerDom.js';

const labels = {
    attachments: 'Attachments',
    previewNotAvailable: 'No attachment preview',
    previous: 'Previous attachment',
    next: 'Next attachment',
    close: 'Close gallery',
    delete: 'Delete selected',
    download: 'Download selected',
    open: 'Open selected externally',
    remove: 'Remove tile',
    retry: 'Retry',
    annotate: 'Annotate tile',
};

function row(name: string): AttachmentGalleryRow {
    return {
        id: name,
        resourceUrl: `stored/${name}`,
        url: `https://gallery.example.test/${name}`,
        filename: name,
        type: 'application/x-synthetic',
        imageSources: [],
        icon: 'document',
        canDownloadInSlider: false,
        canOpenInSlider: false,
    };
}

const defaults: AttachmentGalleryProps = {
    rows: [],
    layout: 'thumbnail',
    columns: 3,
    fit: 'contain',
    showNames: true,
    showOpen: true,
    labels,
    async readDownload() {
        assert.fail('A gallery selection must not download automatically');
    },
};

test('gallery projects native layouts, names and independently admitted tile controls', async (t) => {
    const f = await htmlPresentationFixture(t);
    const { AttachmentGallery } = await import(
        '../src/react/attachment-slider.js'
    );
    const removed: number[] = [];
    const annotated: number[] = [];
    const first = {
        ...row('First'),
        removeTestId: 'host-remove',
        annotationAllowed: true,
    };
    const second = { ...row('Second'), icon: 'play' as const };
    const props: AttachmentGalleryProps = {
        ...defaults,
        rows: [first, second],
        tileTestId: 'host-tile',
        canRemoveFromTile: () => true,
        onRemove: (index) => removed.push(index),
        onAnnotate: (index) => annotated.push(index),
    };
    await f.render(h(AttachmentGallery, props));
    const list = f.container.querySelector('ul');
    assert(list);
    assert(list.classList.contains('grid-cols-3'));
    assert.equal(list.style.gridTemplateColumns, 'repeat(3, minmax(0, 1fr))');
    assert.deepEqual(
        [
            ...list.querySelectorAll(
                '[data-testid=attachmentThumbnailCaptionTestId]'
            ),
        ].map((caption) => caption.textContent),
        ['First', 'Second']
    );
    const [firstTile, secondTile] = list.querySelectorAll(
        '[data-testid=host-tile]'
    );
    assert(firstTile && secondTile);
    const removeFirst = firstTile.querySelector(
        'button[data-testid=host-remove]'
    );
    const removeSecond = secondTile.querySelector('button[data-testid]');
    const annotate = firstTile.querySelector(
        'button[aria-label="Annotate tile"]'
    );
    const open = firstTile.querySelector(
        'button[aria-label="https://gallery.example.test/First"]'
    );
    assert(removeFirst && removeSecond && annotate && open);
    assert(removeSecond instanceof f.window.HTMLButtonElement);
    assert(annotate instanceof f.window.HTMLButtonElement);
    assert.equal(
        removeSecond.getAttribute('data-testid'),
        `removeAttachmentButton-${second.url}`
    );
    assert.equal(annotate.querySelectorAll('svg path').length, 2);
    assert.equal(
        removeFirst.querySelector('path')?.getAttribute('fill-rule'),
        'evenodd'
    );
    assert.equal(
        secondTile.querySelector('button[aria-label="Annotate tile"]'),
        null
    );
    await f.click(removeSecond);
    await f.click(annotate);
    assert.deepEqual(removed, [1]);
    assert.deepEqual(annotated, [0]);
    assert.equal(f.window.document.querySelector('[role=dialog]'), null);

    await f.render(
        h(AttachmentGallery, {
            ...props,
            layout: 'grid',
            showOpen: false,
            canRemoveFromTile: (index) => index === 0,
        })
    );
    assert(list.classList.contains('mx-sdk-attachment-gallery--grid'));
    assert(list.classList.contains('gap-1'));
    assert.equal(list.style.gridTemplateColumns, '');
    assert.equal(
        list.querySelectorAll('[data-testid=attachmentThumbnailCaptionTestId]')
            .length,
        0
    );
    assert.deepEqual(
        [...list.querySelectorAll('button')].map((button) =>
            button.getAttribute('data-testid')
        ),
        ['host-remove']
    );

    await f.render(
        h(AttachmentGallery, {
            ...props,
            layout: 'icon',
            showNames: false,
            onRemove: undefined,
        })
    );
    assert(list.classList.contains('space-y-1'));
    assert.equal(
        list.querySelectorAll('[data-testid=attachmentThumbnailCaptionTestId]')
            .length,
        0
    );
    assert.equal(list.querySelectorAll('li svg').length, 3); // document, video, annotate
    assert.equal(list.querySelectorAll('button[data-testid]').length, 0);
});

test('tile removal accepts matching gestures and retires held pointers and Space with their owner', async (t) => {
    const f = await htmlPresentationFixture(t);
    const { AttachmentGallery } = await import(
        '../src/react/attachment-slider.js'
    );
    const form = {};
    const called: number[] = [];
    const original = { ...row('File'), removeTestId: 'guarded-remove' };
    const view = (attachment: AttachmentGalleryRow, owner: object) =>
        f.render(
            h(AttachmentGallery, {
                ...defaults,
                rows: [attachment],
                showOpen: false,
                formRemovalOwner: owner,
                canRemoveFromTile: () => true,
                onRemove: (index) => called.push(index),
            })
        );
    await view(original, form);
    const button = f.container.querySelector(
        'button[data-testid=guarded-remove]'
    );
    assert(button instanceof f.window.HTMLButtonElement);
    const pointer = (
        type: string,
        pointerId: number,
        overrides: Partial<{ isPrimary: boolean; button: number }> = {}
    ) =>
        act(async () => {
            button.dispatchEvent(
                new f.window.PointerEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    pointerType: 'mouse',
                    pointerId,
                    isPrimary: true,
                    button: 0,
                    detail: type === 'click' ? 1 : 0,
                    ...overrides,
                })
            );
        });
    const mouseClick = () =>
        act(async () => {
            button.dispatchEvent(
                new f.window.MouseEvent('click', { bubbles: true, detail: 1 })
            );
        });
    const key = async (type: string, name = ' ', repeat = false) => {
        const event = new f.window.KeyboardEvent(type, {
            key: name,
            repeat,
            bubbles: true,
            cancelable: true,
        });
        await act(async () => {
            button.dispatchEvent(event);
        });
        return event.defaultPrevented;
    };

    await pointer('pointerdown', 1);
    await pointer('pointerup', 1);
    await mouseClick();
    assert.deepEqual(called, [0]);
    await mouseClick();
    await pointer('pointerdown', 2, { isPrimary: false });
    await pointer('pointerup', 2, { button: 1 });
    await pointer('click', 2);
    await pointer('pointerdown', 3);
    await pointer('pointercancel', 3);
    await pointer('click', 3);
    assert.deepEqual(called, [0]);

    await pointer('pointerdown', 4);
    const replacement = { ...original, resourceUrl: 'stored/replacement' };
    await view(replacement, form);
    assert.equal(f.container.querySelector('button'), button);
    await pointer('pointerup', 4);
    await pointer('click', 4);
    assert.deepEqual(
        called,
        [0],
        'A held pointer cannot remove the replacement'
    );

    await pointer('pointerdown', 5);
    await pointer('click', 5);
    assert.deepEqual(
        called,
        [0, 0],
        'A fresh native pointer click can remove the accepted row'
    );

    await key('keydown');
    assert.equal(await key('keyup'), false);
    await f.click(button); // The synthetic DOM does not generate the browser's keyboard click.
    await key('keydown');
    const newForm = {};
    await view(replacement, newForm);
    assert.equal(await key('keyup'), true);
    await key('keydown', ' ', true);
    assert.equal(await key('keyup'), true);
    await key('keydown', 'Enter', true);
    assert.equal(await key('keyup', 'Enter'), false);
    button.focus();
    await key('keydown');
    await act(async () => button.blur());
    assert.equal(await key('keyup'), true);
    assert.deepEqual(called, [0, 0, 0]);
});

test('gallery opens the selected occurrence and an old confirmation cannot delete after navigation or replacement', async (t) => {
    const f = await scannerDom(t);
    const { AttachmentGallery } = await import(
        '../src/react/attachment-slider.js'
    );
    t.mock.method(globalThis, 'fetch', async () => {
        assert.fail('The unsupported preview must stay provider-free');
    });
    const first = row('First');
    const duplicate = { ...first, filename: 'Duplicate' };
    const removed: number[] = [];
    const prompts: string[] = [];
    const select = (index: number) => {
        const tiles = f.host.querySelectorAll('li');
        const open = tiles[index]?.querySelector('button');
        assert(open);
        return act(async () => open.click());
    };
    const selected = () =>
        f.document.querySelector(
            '.mx-sdk-attachment-thumbnail-rail__select[data-selected=true]'
        )?.textContent;
    const click = async (label: string) => f.click(label);
    let confirmation = deferred<boolean>();
    const props: AttachmentGalleryProps = {
        ...defaults,
        rows: [first, duplicate],
        collectionIdentity: {},
        canRemoveFromSlider: () => true,
        onRemove: (index) => removed.push(index),
        confirmRemove: (name) => {
            prompts.push(name);
            return confirmation.promise;
        },
    };
    const render = (overrides: Partial<AttachmentGalleryProps> = {}) =>
        f.render(h(AttachmentGallery, { ...props, ...overrides }));
    const answer = (value: boolean) =>
        act(async () => confirmation.resolve(value));

    await render();
    await select(1);
    await f.tick();
    assert.equal(selected(), 'Duplicate');
    assert(f.document.querySelector('[role=dialog][aria-modal=true]'));
    await click(labels.delete);
    assert.deepEqual(prompts, ['Duplicate']);
    await click(labels.previous);
    assert.equal(selected(), 'First');
    await answer(true);
    assert.deepEqual(removed, []);

    confirmation = deferred<boolean>();
    await click(labels.delete);
    await render({ collectionIdentity: {} });
    await answer(true);
    assert.deepEqual(removed, []);
    assert.equal(selected(), 'First');

    confirmation = deferred<boolean>();
    await click(labels.delete);
    await answer(false);
    assert.deepEqual(removed, []);
    await click(labels.next);
    assert.equal(selected(), 'Duplicate');

    confirmation = deferred<boolean>();
    await click(labels.delete);
    await answer(true);
    assert.deepEqual(removed, [1]);
    assert.equal(
        selected(),
        'First',
        'Removing the terminal occurrence selects its predecessor'
    );

    // The host commits the removal, leaving the first row selected. The next
    // accepted removal dismisses the viewer because the collection is empty.
    await render({ rows: [first] });
    assert.equal(selected(), 'First');
    confirmation = deferred<boolean>();
    await click(labels.delete);
    await answer(true);
    assert.deepEqual(removed, [1, 0]);
    assert.equal(f.document.querySelector('[role=dialog]'), null);
});
