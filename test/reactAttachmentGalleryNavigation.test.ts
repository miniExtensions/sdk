import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { act, createElement as h, useLayoutEffect } from 'react';
import {
    useAttachmentGalleryNavigation,
    type AttachmentGalleryNavigation,
    type AttachmentGalleryRowIdentity,
} from '../src/react/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

async function mountGallery(t: TestContext) {
    const { render } = await htmlPresentationFixture(t);
    let committed: AttachmentGalleryNavigation | undefined;
    function Gallery({
        rows,
    }: {
        rows: readonly AttachmentGalleryRowIdentity[];
    }) {
        const navigation = useAttachmentGalleryNavigation(rows);
        useLayoutEffect(() => {
            committed = navigation;
        }, [navigation]);
        return h('output', null, navigation.currentSliderIndex);
    }
    const current = () => {
        assert.ok(committed);
        return committed;
    };
    return {
        renderRows: (rows: readonly AttachmentGalleryRowIdentity[]) =>
            render(h(Gallery, { rows })),
        current,
        open: (index: number) =>
            act(async () => current().handleAttachmentThumbnailClick(index)),
    };
}

test('gallery refresh preserves the selected duplicate occurrence and owner', async (t) => {
    const gallery = await mountGallery(t);
    const duplicate = { id: 'same', url: '/same.png' };
    const differentUrl = { id: 'same', url: '/different.png' };
    const other = { id: 'other', url: '/other.png' };

    await gallery.renderRows([duplicate, differentUrl, { ...duplicate }]);
    await gallery.open(2);
    const owner = gallery.current().navigationOwner;
    assert.ok(owner);

    await gallery.renderRows([
        differentUrl,
        duplicate,
        other,
        { ...duplicate },
    ]);
    assert.equal(gallery.current().currentSliderIndex, 3);
    assert.equal(gallery.current().navigationOwner, owner);

    await gallery.renderRows([differentUrl, other, duplicate]);
    assert.equal(gallery.current().currentSliderIndex, 2);
    assert.equal(gallery.current().navigationOwner, owner);
});

test('gallery follows a unique ID across URL refresh and avoids an ambiguous match', async (t) => {
    const gallery = await mountGallery(t);
    const selected = { id: 'selected', url: '/old.png' };
    const other = { id: 'other', url: '/other.png' };

    await gallery.renderRows([other, selected]);
    await gallery.open(1);
    const owner = gallery.current().navigationOwner;
    await gallery.renderRows([{ ...selected, url: '/new.png' }, other]);
    assert.equal(gallery.current().currentSliderIndex, 0);
    assert.equal(gallery.current().navigationOwner, owner);

    await gallery.renderRows([
        other,
        { ...selected, url: '/ambiguous-first.png' },
        { ...selected, url: '/ambiguous-second.png' },
    ]);
    assert.equal(gallery.current().currentSliderIndex, 0);
    assert.equal(gallery.current().navigationOwner, owner);
});

test('gallery keeps a URL-only prefill selected when it gains an ID', async (t) => {
    const gallery = await mountGallery(t);
    const prefill = { url: '/prefill.png' };
    const other = { id: 'other', url: '/other.png' };

    await gallery.renderRows([other, prefill]);
    await gallery.open(1);
    const owner = gallery.current().navigationOwner;
    await gallery.renderRows([{ ...prefill, id: 'saved' }, other]);
    assert.equal(gallery.current().currentSliderIndex, 0);
    assert.equal(gallery.current().navigationOwner, owner);
});

test('gallery clamps the removed selection and closes an empty collection', async (t) => {
    const gallery = await mountGallery(t);
    const first = { id: 'first', url: '/first.png' };
    const second = { id: 'second', url: '/second.png' };
    const third = { id: 'third', url: '/third.png' };

    await gallery.renderRows([first, second, third]);
    await gallery.open(1);
    const owner = gallery.current().navigationOwner;
    await act(async () =>
        gallery.current().setCurrentSliderIndex((index) => index + 1)
    );
    assert.equal(gallery.current().currentSliderIndex, 2);

    await gallery.renderRows([first, second]);
    assert.equal(gallery.current().currentSliderIndex, 1);
    assert.equal(gallery.current().navigationOwner, owner);

    await gallery.renderRows([]);
    assert.equal(gallery.current().currentSliderIndex, 0);
    assert.equal(gallery.current().navigationOwner, null);

    await gallery.renderRows([first]);
    assert.equal(gallery.current().currentSliderIndex, 0);
    assert.equal(gallery.current().navigationOwner, null);
});

test('a retained gallery dismiss cannot close a later open of the same row', async (t) => {
    const gallery = await mountGallery(t);
    await gallery.renderRows([{ id: null, url: '/prefill.png' }]);
    await gallery.open(0);
    const previous = gallery.current();
    assert.ok(previous.navigationOwner);

    await gallery.open(0);
    const current = gallery.current();
    assert.ok(current.navigationOwner);
    assert.notEqual(current.navigationOwner, previous.navigationOwner);

    await act(async () => previous.dismissSlider());
    assert.equal(gallery.current().navigationOwner, current.navigationOwner);

    await act(async () => current.dismissSlider());
    assert.equal(gallery.current().navigationOwner, null);
});
