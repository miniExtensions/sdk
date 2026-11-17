import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h } from 'react';
import {
    LinkedFinderCard,
    type LinkedFinderCardProjection,
    type LinkedFinderMapCardProjection,
} from '../src/react/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

test('shared card keeps Map primary-only and retires carousel UI across real layout changes', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert(f.window instanceof Window);
    const errors: unknown[][] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => {
        errors.push(args);
    });
    const map: LinkedFinderMapCardProjection = {
        status: 'present',
        layout: 'map',
        primary: 'Admitted Map primary',
        primaryIsEmpty: false,
    };
    const gallery: LinkedFinderCardProjection = {
        status: 'present',
        layout: 'gallery',
        primary: 'Gallery primary',
        language: 'en',
        fields: [
            {
                key: 'detail',
                title: 'Detail',
                leaf: { kind: 'literal', text: 'Current Gallery detail' },
            },
        ],
        images: [
            {
                id: 'one',
                url: 'https://html-presentation.example.test/one.png',
                filename: 'One',
            },
            {
                id: 'two',
                url: 'https://html-presentation.example.test/two.png',
                filename: 'Two',
            },
        ],
        shouldRenderThumbnail: true,
        imageHeight: 112,
        imageFit: 'contain',
        thumbnailLocation: 'left',
        fieldsPerCardRow: 1,
        labels: {
            previousImage: 'Previous',
            nextImage: 'Next',
            noImage: 'No image',
            viewImage: 'View {index}',
        },
    };
    await f.render(h(LinkedFinderCard, { projection: map }));
    assert.equal(f.container.textContent, 'Admitted Map primary');
    assert.equal(f.container.querySelector('img,[role=term],button'), null);
    await f.render(h(LinkedFinderCard, { projection: gallery }));
    const dot = f.container.querySelectorAll(
        '.mx-sdk-finder-carousel-dots button'
    )[1];
    assert(dot instanceof f.window.HTMLButtonElement);
    await f.click(dot);
    assert.equal(
        f.container
            .querySelector('img[data-visible=true]')
            ?.getAttribute('alt'),
        'Two'
    );
    await f.render(
        h(LinkedFinderCard, {
            projection: { status: 'loading', label: 'Current publication' },
        })
    );
    assert.equal(f.container.querySelector('img'), null);
    await f.render(h(LinkedFinderCard, { projection: map }));
    assert.equal(f.container.textContent, 'Admitted Map primary');
    assert.equal(f.container.querySelector('img,[role=term],button'), null);
    await f.render(h(LinkedFinderCard, { projection: gallery }));
    assert.equal(
        f.container
            .querySelector('img[data-visible=true]')
            ?.getAttribute('alt'),
        'One'
    );
    assert.deepEqual(errors, []);
    f.unchangedEffects();
});
