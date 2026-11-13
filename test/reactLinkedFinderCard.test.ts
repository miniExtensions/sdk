import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    LinkedFinderCard,
    LinkedFinderRichLeaf,
    type LinkedFinderCardProjection,
} from '../src/react/index.js';
import {
    linkedFinderCarouselImages,
    linkedFinderCarouselIndex,
    linkedFinderListImageVector,
    type LinkedFinderImage,
} from '../src/ui/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';
import { createRendererProps } from '../src/ui/rendererRegistry.js';

const images: LinkedFinderImage[] = Array.from({ length: 8 }, (_, index) => ({
    id: `image-${index}`,
    url: `https://images.example.test/original-${index}`,
    largeUrl: `https://images.example.test/large-${index}`,
    filename: `Image ${index}`,
}));
const present = (
    patch: Partial<
        Extract<LinkedFinderCardProjection, { status: 'present' }>
    > = {}
): LinkedFinderCardProjection => ({
    status: 'present',
    primary: 'Admitted primary',
    fields: [],
    language: 'en',
    layout: 'list',
    images,
    imageFit: 'contain',
    imageHeight: 80,
    shouldRenderThumbnail: true,
    thumbnailLocation: 'left',
    fieldsPerCardRow: 1,
    labels: {
        previousImage: 'Previous image',
        nextImage: 'Next image',
        noImage: 'No image',
    },
    ...patch,
});

test('List vector tracks complete ordered id/url/filename data, independently of thumbnail URL and references', () => {
    assert.equal(
        linkedFinderListImageVector(images),
        linkedFinderListImageVector(
            images.map((image) => ({ ...image, largeUrl: 'different' }))
        )
    );
    for (const key of ['id', 'url', 'filename'] as const) {
        const changed = images.map((image, index) =>
            index === 7 ? { ...image, [key]: 'changed' } : image
        );
        assert.notEqual(
            linkedFinderListImageVector(images),
            linkedFinderListImageVector(changed)
        );
    }
});

test('Gallery slices six before failures, separates ID/source, retains selected identity and clamps removals', () => {
    const first = linkedFinderCarouselImages(images, new Set());
    const failed = new Set(first.map((image) => image.failureKey));
    assert.equal(first.length, 6);
    assert.deepEqual(linkedFinderCarouselImages(images, failed), []);
    const changed = images.map((image, index) =>
        index === 0 ? { ...image, largeUrl: 'replacement' } : image
    );
    assert.deepEqual(
        linkedFinderCarouselImages(changed, failed).map(
            (image) => image.source
        ),
        ['replacement']
    );
    const reordered = linkedFinderCarouselImages(
        [images[1], images[0]],
        new Set()
    );
    assert.equal(linkedFinderCarouselIndex(reordered, first[1].identity, 1), 0);
    assert.equal(
        linkedFinderCarouselIndex(reordered.slice(0, 1), first[5].identity, 5),
        0
    );
    const noId = linkedFinderCarouselImages(
        images.map(({ id: _, ...image }) => image),
        new Set()
    );
    const noIdReordered = linkedFinderCarouselImages(
        [images[1], images[0]].map(({ id: _, ...image }) => image),
        new Set()
    );
    assert.notEqual(noId[0].identity, noIdReordered[0].identity);
});

test('actual List traverses all supplied original URLs, ignores equivalent references and resets on vector changes', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert(
        f.window instanceof Window,
        'Use the real owned happy-dom fixture realm'
    );
    await f.render(h(LinkedFinderCard, { projection: present() }));
    for (let index = 0; index < images.length; index++) {
        const image = f.container.querySelector('img')!;
        assert.equal(image.getAttribute('src'), images[index].url);
        if (index === 2) {
            await f.render(
                h(LinkedFinderCard, {
                    projection: present({
                        images: images.map((image) => ({ ...image })),
                    }),
                })
            );
            assert.equal(f.container.querySelector('img'), image);
        }
        await f.imageEvent(image, 'error');
    }
    assert.equal(f.container.querySelector('img'), null);
    await f.render(
        h(LinkedFinderCard, {
            projection: present({
                images: images.map((image, index) =>
                    index === 7 ? { ...image, filename: 'renamed' } : image
                ),
            }),
        })
    );
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        images[0].url
    );
});

test('actual Gallery preserves identity reorder/removal, rejects stale source errors and never backfills seventh', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert(
        f.window instanceof Window,
        'Use the real owned happy-dom fixture realm'
    );
    await f.render(
        h(LinkedFinderCard, { projection: present({ layout: 'gallery' }) })
    );
    assert.equal(f.container.querySelectorAll('img').length, 6);
    assert.equal(
        f.container.querySelector(
            'img[src="https://images.example.test/large-6"]'
        ),
        null
    );
    await f.click(
        f.container.querySelector(
            '[aria-label="Next image"]'
        ) as unknown as HTMLButtonElement
    );
    assert.equal(
        f.container.querySelector('[data-visible="true"]')?.getAttribute('src'),
        images[1].largeUrl
    );
    await f.render(
        h(LinkedFinderCard, {
            projection: present({
                layout: 'gallery',
                images: [images[1], images[0]],
            }),
        })
    );
    const old = f.container.querySelector('img')!;
    const changed = {
        ...images[1],
        largeUrl: 'https://images.example.test/new-source',
    };
    await f.render(
        h(LinkedFinderCard, {
            projection: present({
                layout: 'gallery',
                images: [changed, images[0]],
            }),
        })
    );
    assert.notEqual(f.container.querySelector('img'), old);
    await f.imageEvent(old, 'error');
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        changed.largeUrl
    );
    await f.render(
        h(LinkedFinderCard, { projection: present({ layout: 'gallery' }) })
    );
    for (let index = 0; index < 6; index++)
        await f.imageEvent(f.container.querySelector('img')!, 'error');
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(
        f.container
            .querySelector('[aria-label="No image"]')
            ?.getAttribute('role'),
        'img'
    );
});

test('List position survives hiding/side/layout changes; carousel failures share Gallery/Kanban lifetime only', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert(
        f.window instanceof Window,
        'Use the real owned happy-dom fixture realm'
    );
    await f.render(h(LinkedFinderCard, { projection: present() }));
    const old = f.container.querySelector('img')!;
    await f.imageEvent(old, 'error');
    await f.render(
        h(LinkedFinderCard, { projection: present({ layout: 'gallery' }) })
    );
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        images[0].largeUrl
    );
    await f.imageEvent(old, 'error');
    await f.imageEvent(f.container.querySelector('img')!, 'error');
    await f.render(
        h(LinkedFinderCard, { projection: present({ layout: 'kanban' }) })
    );
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        images[1].largeUrl
    );
    await f.render(h(LinkedFinderCard, { projection: present() }));
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        images[1].url
    );
    await f.render(
        h(LinkedFinderCard, {
            projection: present({ shouldRenderThumbnail: false }),
        })
    );
    assert.equal(f.container.querySelector('img'), null);
    await f.render(
        h(LinkedFinderCard, {
            projection: present({ thumbnailLocation: 'right' }),
        })
    );
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        images[1].url
    );
    await f.render(
        h(LinkedFinderCard, { projection: present({ layout: 'gallery' }) })
    );
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        images[0].largeUrl
    );
    await f.imageEvent(f.container.querySelector('img')!, 'error');
    await f.render(
        h(LinkedFinderCard, {
            projection: present({ layout: 'gallery', images: [] }),
        })
    );
    await f.render(
        h(LinkedFinderCard, { projection: present({ layout: 'gallery' }) })
    );
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        images[0].largeUrl
    );
});

test('card loading/unavailable do not recover any present data; primary stays escaped and details keep supplied order', () => {
    assert.match(
        renderToString(
            h(LinkedFinderCard, {
                projection: { status: 'loading', label: 'Chargement' },
            })
        ),
        /role="status"/
    );
    assert.equal(
        renderToString(
            h(LinkedFinderCard, {
                projection: { status: 'unavailable', label: 'Unavailable' },
            })
        ).includes('Admitted primary'),
        false
    );
    const html = renderToString(
        h(LinkedFinderCard, {
            projection: present({
                primary: '<b>Primary</b>',
                fields: [
                    {
                        key: 'second',
                        title: 'Second',
                        leaf: {
                            kind: 'pills',
                            items: [{ label: '<red>', color: 'red' }],
                        },
                    },
                    {
                        key: 'first',
                        title: null,
                        leaf: {
                            kind: 'linkedPills',
                            labels: ['Admitted only'],
                        },
                    },
                ],
            }),
        })
    );
    assert.match(html, /&lt;b&gt;Primary&lt;\/b&gt;/);
    assert.ok(html.indexOf('Second') < html.indexOf('Admitted only'));
    assert.equal(html.includes('<red>'), false);
});

test('rich leaves reuse sanitizing HTML, literal labels, duration, phone, checkbox and readonly barcode without actions', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert(
        f.window instanceof Window,
        'Use the real owned happy-dom fixture realm'
    );
    await f.render(
        h(LinkedFinderRichLeaf, {
            leaf: {
                kind: 'sequence',
                leaves: [
                    {
                        kind: 'html',
                        html: '<strong>Rich</strong><script>bad()</script>',
                    },
                    { kind: 'quill', html: '<em>Quill</em>' },
                    {
                        kind: 'duration',
                        display: {
                            value: 3601,
                            format: 'h:mm:ss',
                            language: 'en',
                        },
                    },
                    {
                        kind: 'phone',
                        display: { value: '+12025550123', emptyLabel: 'Empty' },
                    },
                    {
                        kind: 'checkbox',
                        value: true,
                        checkedLabel: 'Checked',
                        uncheckedLabel: 'Unchecked',
                    },
                    {
                        kind: 'barcode',
                        display: {
                            value: { text: '<barcode>' },
                            language: 'en',
                        },
                    },
                    {
                        kind: 'rating',
                        value: 2,
                        max: 3,
                        icon: 'heart',
                        color: 'red',
                        label: '2 of 3',
                    },
                ],
            },
        })
    );
    assert.equal(f.container.querySelector('script'), null);
    assert.equal(f.container.querySelector('strong')?.textContent, 'Rich');
    assert.equal(f.container.querySelector('em')?.textContent, 'Quill');
    assert.match(f.container.textContent, /1:00:01/);
    assert.match(f.container.textContent, /<barcode>/);
    assert.equal(
        f.container.querySelectorAll('[aria-label="2 of 3"] svg').length,
        3
    );
    assert.equal(
        f.container.querySelector('[data-testid="qr-scanner-button"]'),
        null
    );
});

test('admitted thumbnail enablement/location and detail grid survive List/Gallery transitions', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert(
        f.window instanceof Window,
        'Use the real owned happy-dom fixture realm'
    );
    const fields = [
        {
            key: 'detail',
            title: 'Detail',
            leaf: { kind: 'literal', text: 'Admitted' },
        } as const,
    ];
    await f.render(
        h(LinkedFinderCard, {
            projection: present({
                thumbnailLocation: 'right',
                fields,
                fieldsPerCardRow: 2,
            }),
        })
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-finder-card')?.lastElementChild
            ?.tagName,
        'IMG'
    );
    await f.render(
        h(LinkedFinderCard, {
            projection: present({
                layout: 'gallery',
                fields,
                fieldsPerCardRow: 2,
            }),
        })
    );
    assert.match(
        f.container
            .querySelector('.mx-sdk-finder-card-fields')
            ?.getAttribute('style') ?? '',
        /repeat\(2, minmax\(150px, 1fr\)\)/
    );
    await f.render(
        h(LinkedFinderCard, {
            projection: present({
                layout: 'gallery',
                shouldRenderThumbnail: false,
                fields,
            }),
        })
    );
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(f.container.querySelector('.mx-sdk-finder-carousel'), null);
    assert.equal(f.container.textContent.includes('Admitted'), true);
    await f.render(
        h(LinkedFinderCard, {
            projection: present({ thumbnailLocation: 'left' }),
        })
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-finder-card')?.firstElementChild
            ?.tagName,
        'IMG'
    );
});

test('numeric leaf forwards the admitted localized empty label to the complete display presenter', () => {
    const display = createRendererProps({
        physicalKind: 'number',
        fieldId: 'number',
        title: 'Amount',
        field: {
            id: 'number',
            name: 'Amount',
            description: null,
            isComputed: false,
            isPrimaryField: false,
            config: { type: 'number', options: { precision: 2 } },
        },
        displayConfig: null,
        value: null,
        context: 'linked-detail',
        computed: false,
        dirty: false,
        pending: false,
        validation: [],
        error: null,
        capability: { type: 'readonly' },
    });
    if (!display || display.physicalKind !== 'number')
        assert.fail('Expected an admitted numeric renderer');
    const html = renderToString(
        h(LinkedFinderRichLeaf, {
            leaf: {
                kind: 'numeric',
                display: { ...display, capability: { type: 'readonly' } },
                emptyLabel: 'Sin valor',
            },
        })
    );
    assert.match(html, /Sin valor/);
    assert.equal(html.includes('No value'), false);
});
