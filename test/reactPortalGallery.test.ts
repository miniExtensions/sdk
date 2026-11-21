import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { act, createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import {
    PortalGallery,
    resolvePortalGalleryColumns,
    type PortalGalleryRow,
    type PortalGalleryProps,
} from '../src/react/index.js';
import { htmlPresentationFixture } from './fixtures/htmlPresentationFixture.js';

function row(id: string): PortalGalleryRow {
    return {
        key: id,
        recordId: id,
        accessibleLabel: `Record ${id}`,
        testId: 'native-compatible-row',
        projection: {
            status: 'present',
            primary: `Primary ${id}`,
            fields: [
                {
                    key: 'detail',
                    title: 'Detail',
                    leaf: { kind: 'literal', text: `Value ${id}` },
                },
            ],
            language: 'en',
            layout: 'gallery',
            images: [],
            imageFit: 'contain',
            imageHeight: 112,
            shouldRenderThumbnail: false,
            thumbnailLocation: 'left',
            fieldsPerCardRow: 1,
            labels: {
                previousImage: 'Previous',
                nextImage: 'Next',
                noImage: 'No image',
            },
        },
    };
}
const props = (rows: readonly PortalGalleryRow[]): PortalGalleryProps => ({
    label: 'Projects',
    content: { status: 'rows', rows, emptyLabel: null },
});

test('Gallery renders the complete rich-card view in SSR without a browser or native slots', () => {
    assert.equal(typeof document, 'undefined');
    const markup = renderToString(
        h(PortalGallery, { ...props([row('a')]), width: 'fixed' })
    );
    assert.match(markup, /<ul/);
    assert.match(markup, /Primary a/);
    assert.match(markup, /Detail/);
    assert.match(markup, /Value a/);
    assert.match(markup, /mx-sdk-portal-gallery-fixed/);
    assert.match(markup, /data-testid="native-compatible-row"/);
    assert.doesNotMatch(markup, /<button|<input|<iframe/);
});
test('Gallery preserves configured one-to-six column caps and source default five', () => {
    for (const count of [1, 2, 3, 4, 5, 6] as const) {
        assert.equal(resolvePortalGalleryColumns(count), count);
        assert.equal(resolvePortalGalleryColumns(String(count)), count);
    }
    for (const invalid of [
        undefined,
        null,
        0,
        7,
        -1,
        2.5,
        '',
        'three',
        NaN,
        {},
        true,
    ])
        assert.equal(resolvePortalGalleryColumns(invalid), 5);
});
test('Gallery StrictMode mount, row replacement and empty states allocate no actions or reads', async (t) => {
    const f = await htmlPresentationFixture(t);
    assert.ok(f.window instanceof Window);
    const actions: string[] = [];
    const a = {
        ...row('a'),
        open: {
            label: 'Open A',
            activate: () => {
                actions.push('open');
            },
        },
        requestUnlink: {
            label: 'Unlink A',
            description: 'Remove parent link',
            activate: () => {
                actions.push('unlink');
            },
        },
    };
    await f.render(h(PortalGallery, props([a, row('b')])));
    await f.render(
        h(PortalGallery, {
            ...props([
                row('b'),
                {
                    ...a,
                    projection: {
                        status: 'unavailable',
                        label: 'Unavailable A',
                    },
                },
            ]),
            columns: 2,
        })
    );
    assert.deepEqual(
        [...f.container.querySelectorAll('[data-record-id]')].map((e) =>
            e.getAttribute('data-record-id')
        ),
        ['b', 'a']
    );
    assert.match(f.container.textContent ?? '', /Unavailable A/);
    await f.render(
        h(PortalGallery, {
            label: 'Projects',
            content: { status: 'rows', rows: [], emptyLabel: 'Nothing here' },
        })
    );
    assert.equal(f.container.textContent, 'Nothing here');
    assert.equal(f.container.querySelector('[data-record-id]'), null);
    await f.render(
        h(PortalGallery, {
            label: 'Projects',
            content: { status: 'loading', label: 'Loading projects' },
        })
    );
    assert.equal(
        f.container.querySelector('[role=status]')?.textContent,
        'Loading projects'
    );
    await f.render(
        h(PortalGallery, {
            label: 'Projects',
            content: { status: 'unavailable', label: 'Project error' },
        })
    );
    assert.equal(
        f.container.querySelector('[role=alert]')?.textContent,
        'Project error'
    );
    assert.deepEqual(actions, []);
    f.unchangedEffects();
});
test('Gallery sends separate Open, Unlink and manual paging requests without submitting the host form', async (t) => {
    const f = await htmlPresentationFixture(t);
    const actions: string[] = [];
    const a = {
        ...row('a'),
        open: {
            label: 'Open A',
            activate: () => {
                actions.push('open:a');
            },
        },
        requestUnlink: {
            label: 'Unlink A',
            description: 'Remove parent link',
            activate: () => {
                actions.push('unlink:a');
            },
        },
    };
    await f.render(
        h(PortalGallery, {
            ...props([a]),
            paging: {
                canRequestMore: true,
                showSpinner: false,
                requestLabel: 'More',
                loadingLabel: 'Loading more',
                requestMore: () => {
                    actions.push('page');
                },
            },
        })
    );
    for (const label of ['Open A', 'Unlink A']) {
        const b = f.container.querySelector(`button[aria-label="${label}"]`);
        assert(b instanceof f.window.HTMLButtonElement);
        await f.click(b);
    }
    const more = f.container.querySelector('.mx-sdk-portal-gallery-load-more');
    assert(more instanceof f.window.HTMLButtonElement);
    await f.click(more);
    assert.deepEqual(actions, ['open:a', 'unlink:a', 'page']);
    f.unchangedEffects();
});
test('Gallery Unlink help follows focus, Escape and the current removable row', async (t) => {
    const f = await htmlPresentationFixture(t);
    const actions: string[] = [];
    const label = 'Eliminar registro vinculado';
    const description = 'Desvincular registro';
    const removable = {
        ...row('a'),
        open: { label: 'Open A', activate: () => actions.push('open') },
        requestUnlink: {
            label,
            description,
            activate: () => actions.push('unlink'),
        },
    };
    const neighbor = row('b');
    const rows = [removable, neighbor];
    await f.render(h(PortalGallery, props(rows)));
    const open = f.container.querySelector('button[aria-label="Open A"]');
    const unlink = f.container.querySelector(`button[aria-label="${label}"]`);
    assert(open instanceof f.window.HTMLButtonElement);
    assert(unlink instanceof f.window.HTMLButtonElement);
    const tooltip = () =>
        f.window.document.body.querySelector('[role="tooltip"]');
    const movePointer = (enterUnlink: boolean) => {
        const from = enterUnlink ? open : unlink;
        const to = enterUnlink ? unlink : open;
        from.dispatchEvent(
            new f.window.MouseEvent('mouseout', {
                bubbles: true,
                relatedTarget: to,
            })
        );
        to.dispatchEvent(
            new f.window.MouseEvent('mouseover', {
                bubbles: true,
                relatedTarget: from,
            })
        );
    };

    await act(async () => {
        open.focus();
        movePointer(true);
        await import('../src/react/fieldTooltipPopup.js');
    });
    const popup = tooltip();
    assert(popup);
    assert.equal(popup.textContent, description);
    assert.equal(unlink.getAttribute('aria-describedby'), popup.id);
    assert.equal(unlink.getAttribute('aria-label'), label);
    assert.equal(f.window.document.activeElement, open);
    await act(async () => {
        movePointer(false);
        unlink.focus();
    });
    assert.equal(tooltip(), popup);
    await act(async () => {
        movePointer(false);
        unlink.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'ArrowLeft',
                bubbles: true,
            })
        );
    });
    assert.equal(tooltip(), popup);
    await act(async () =>
        unlink.dispatchEvent(
            new f.window.KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true,
                cancelable: true,
            })
        )
    );
    assert.equal(tooltip(), null);
    assert.equal(unlink.getAttribute('aria-describedby'), null);
    assert.equal(f.window.document.activeElement, unlink);

    await act(async () => {
        open.focus();
        unlink.focus();
    });
    assert(tooltip());
    await f.render(
        h(PortalGallery, { ...props(rows), unlinkingRecordId: 'a' })
    );
    assert.equal(tooltip(), null);
    assert.equal(unlink.disabled, true);
    await f.render(h(PortalGallery, props(rows)));
    await act(async () => {
        open.focus();
        movePointer(true);
    });
    assert(tooltip());
    await act(async () => movePointer(false));
    await f.render(h(PortalGallery, props([neighbor])));
    assert.equal(tooltip(), null);
    assert.equal(
        f.container.querySelector('.mx-sdk-portal-gallery-unlink'),
        null
    );
    assert.deepEqual(actions, []);
    f.unchangedEffects();
});

test('Gallery honors controlled Unlink pending across all visible records and only supplied review dots', async (t) => {
    const f = await htmlPresentationFixture(t);
    let mutations = 0;
    const rows = ['a', 'b'].map((id) => ({
        ...row(id),
        requestUnlink: {
            label: `Unlink ${id}`,
            description: 'Remove link',
            activate: () => {
                mutations++;
            },
        },
        needsReviewLabel: id === 'b' ? 'Needs review' : null,
    }));
    await f.render(
        h(PortalGallery, { ...props(rows), unlinkingRecordId: 'a' })
    );
    const buttons = [
        ...f.container.querySelectorAll('.mx-sdk-portal-gallery-unlink'),
    ];
    assert.equal(buttons.length, 2);
    for (const b of buttons) {
        assert(b instanceof f.window.HTMLButtonElement);
        assert.equal(b.disabled, true);
        await f.click(b);
    }
    assert.equal(buttons[0]?.getAttribute('aria-busy'), 'true');
    assert.equal(buttons[1]?.getAttribute('aria-busy'), 'false');
    assert.equal(
        f.container.querySelectorAll('.mx-sdk-portal-gallery-review').length,
        1
    );
    assert.equal(mutations, 0);
    await f.render(h(PortalGallery, props(rows)));
    const b = f.container.querySelector('.mx-sdk-portal-gallery-unlink');
    assert(b instanceof f.window.HTMLButtonElement);
    await f.click(b);
    assert.equal(mutations, 1);
});
test('Gallery preserves manual paging when the host projects zero visible rows', async (t) => {
    const f = await htmlPresentationFixture(t);
    let reads = 0;
    const paging = {
        canRequestMore: true,
        showSpinner: false,
        requestLabel: 'More hidden matches',
        loadingLabel: 'Loading matches',
        requestMore: () => {
            reads++;
        },
    };
    await f.render(h(PortalGallery, { ...props([]), paging }));
    const more = f.container.querySelector('button');
    assert(more instanceof f.window.HTMLButtonElement);
    await f.click(more);
    assert.equal(reads, 1);
    await f.render(
        h(PortalGallery, {
            ...props([]),
            paging: { ...paging, canRequestMore: false, showSpinner: true },
        })
    );
    assert.equal(f.container.querySelector('button'), null);
    assert.equal(
        f.container.querySelector('[role=status]')?.getAttribute('aria-label'),
        'Loading matches'
    );
    assert.equal(reads, 1);
});
test('Gallery reload overlay preserves row nodes, image selection and current Open registration', async (t) => {
    const f = await htmlPresentationFixture(t);
    const active = new Set<unknown>();
    let retirements = 0;
    const registerTrigger = (element: HTMLButtonElement) => {
        active.add(element);
        return () => {
            active.delete(element);
            retirements++;
        };
    };
    const source = row('a');
    if (source.projection.status !== 'present')
        throw new Error('Expected present fixture');
    let opens = 0;
    const a = {
        ...source,
        projection: {
            ...source.projection,
            shouldRenderThumbnail: true,
            images: [
                {
                    id: 'one',
                    url: 'https://images.example.test/one',
                    filename: 'One',
                },
                {
                    id: 'two',
                    url: 'https://images.example.test/two',
                    filename: 'Two',
                },
            ],
            labels: { ...source.projection.labels, viewImage: 'View {index}' },
        },
        open: {
            label: 'Open A',
            activate: () => {
                opens++;
            },
            registerTrigger,
        },
    };
    await f.render(h(PortalGallery, props([a])));
    const dot = f.container.querySelectorAll(
        '.mx-sdk-finder-carousel-dots button'
    )[1];
    assert(dot instanceof f.window.HTMLButtonElement);
    await f.click(dot);
    assert.equal(opens, 0);
    const selected = f.container.querySelector('img[data-visible=true]');
    assert.equal(selected?.getAttribute('alt'), 'Two');
    const node = f.container.querySelector('[data-record-id=a]');
    const button = f.container.querySelector('.mx-sdk-portal-gallery-open');
    const before = retirements;
    assert.equal(active.size, 1);
    await f.render(
        h(PortalGallery, {
            ...props([a]),
            reloading: { label: 'Refreshing projects' },
        })
    );
    assert.equal(f.container.querySelector('[data-record-id=a]'), node);
    assert.equal(
        f.container.querySelector('.mx-sdk-portal-gallery-open'),
        button
    );
    assert.equal(active.size, 1);
    assert.equal(retirements, before);
    assert.equal(f.container.querySelector('img[data-visible=true]'), selected);
    assert.equal(
        f.container.querySelector('[role=status]')?.getAttribute('aria-label'),
        'Refreshing projects'
    );
    await f.render(h(PortalGallery, props([a])));
    assert.equal(f.container.querySelector('[data-record-id=a]'), node);
    assert.equal(retirements, before);
    await f.render(null);
    assert.equal(active.size, 0);
    assert.equal(retirements, before + 1);
});
test('Gallery captures the supplied activation function and never acquires a successor from mutated data', async (t) => {
    const f = await htmlPresentationFixture(t);
    const calls: string[] = [];
    const port = {
        label: 'Open A',
        activate: () => {
            calls.push('captured');
        },
    };
    await f.render(h(PortalGallery, props([{ ...row('a'), open: port }])));
    port.activate = () => {
        calls.push('successor');
    };
    const b = f.container.querySelector('.mx-sdk-portal-gallery-open');
    assert(b instanceof f.window.HTMLButtonElement);
    await f.click(b);
    assert.deepEqual(calls, ['captured']);
});

test('Gallery rich cards preserve ordered definition terms and explicit raw-primary empty metadata', async (t) => {
    const f = await htmlPresentationFixture(t);
    const source = row('a');
    if (source.projection.status !== 'present')
        throw new Error('Expected present fixture');
    const projection = {
        ...source.projection,
        primary: 'Localized unnamed',
        primaryIsEmpty: true,
        fieldsPerCardRow: 2,
        fields: [
            {
                key: 'zero',
                title: 'Visible title',
                leaf: { kind: 'literal' as const, text: '0' },
            },
            {
                key: 'hidden-title',
                title: null,
                leaf: { kind: 'literal' as const, text: 'Second value' },
            },
            {
                key: 'empty-title',
                title: '',
                leaf: { kind: 'literal' as const, text: 'Third value' },
            },
        ],
    };
    await f.render(h(PortalGallery, props([{ ...source, projection }])));
    assert.deepEqual(
        [...f.container.querySelectorAll('[role=term]')].map(
            (e) => e.textContent
        ),
        ['Visible title', '']
    );
    assert.deepEqual(
        [
            ...f.container.querySelectorAll('.mx-sdk-finder-card-field-value'),
        ].map((e) => e.textContent),
        ['0', 'Second value', 'Third value']
    );
    assert.equal(f.container.querySelectorAll('[role=definition]').length, 2);
    const primary = f.container.querySelector('.mx-sdk-finder-card-primary');
    assert.equal(primary?.getAttribute('title'), 'Localized unnamed');
    assert.equal(primary?.getAttribute('aria-label'), 'Localized unnamed');
    assert(primary?.classList.contains('mx-sdk-finder-card-primary-empty'));
    await f.render(
        h(
            PortalGallery,
            props([
                {
                    ...source,
                    projection: { ...projection, primaryIsEmpty: false },
                },
            ])
        )
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-finder-card-primary-empty'),
        null
    );
    await f.render(
        h(
            PortalGallery,
            props([{ ...source, projection: { ...projection, fields: [] } }])
        )
    );
    assert.equal(f.container.querySelector('dl'), null);
    assert.equal(
        f.container.querySelector('.mx-sdk-finder-card-primary-with-details'),
        null
    );
});

test('Gallery rich attachment leaves preserve missing and failed thumbnail filename occurrences without opening', async (t) => {
    const f = await htmlPresentationFixture(t);
    const source = row('a');
    if (source.projection.status !== 'present')
        throw new Error('Expected present fixture');
    const entries = [
        { id: 'pdf', thumbnailUrl: null, filename: 'Report.pdf' },
        {
            id: 'photo',
            thumbnailUrl: 'https://images.example.test/thumb',
            filename: 'Photo.png',
        },
        { id: 'pdf', thumbnailUrl: null, filename: 'Repeated report.pdf' },
    ];
    const projection = {
        ...source.projection,
        fields: [
            {
                key: 'attachments',
                title: 'Files',
                leaf: {
                    kind: 'attachmentImages' as const,
                    images: [],
                    entries,
                    empty: 'none' as const,
                    emptyLabel: 'No files',
                },
            },
        ],
    };
    await f.render(h(PortalGallery, props([{ ...source, projection }])));
    assert.deepEqual(
        [
            ...f.container.querySelectorAll(
                '.mx-sdk-finder-attachment-filename'
            ),
        ].map((e) => e.textContent),
        ['Report.pdf', 'Repeated report.pdf']
    );
    const image = f.container.querySelector('img');
    assert(image);
    assert.equal(image.alt, 'Photo.png');
    await f.imageEvent(image, 'error');
    assert.deepEqual(
        [
            ...f.container.querySelectorAll(
                '.mx-sdk-finder-attachment-filename'
            ),
        ].map((e) => e.textContent),
        ['Report.pdf', 'Photo.png', 'Repeated report.pdf']
    );
    assert.equal(f.container.querySelector('button,a,iframe'), null);
    await f.render(
        h(
            PortalGallery,
            props([
                {
                    ...source,
                    projection: {
                        ...projection,
                        fields: [
                            {
                                ...projection.fields[0]!,
                                leaf: {
                                    ...projection.fields[0]!.leaf,
                                    entries: [
                                        {
                                            ...entries[1]!,
                                            thumbnailUrl:
                                                'https://images.example.test/replacement',
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ])
        )
    );
    assert.equal(
        f.container.querySelector('img')?.getAttribute('src'),
        'https://images.example.test/replacement'
    );
    assert.equal(
        f.container.querySelector('.mx-sdk-finder-attachment-filename'),
        null
    );
    f.unchangedEffects();
});

test('Gallery legacy attachment images remain ordered and explicit empty entries do not recover them', async (t) => {
    const f = await htmlPresentationFixture(t);
    const source = row('legacy');
    if (source.projection.status !== 'present')
        throw new Error('Expected present fixture');
    const leaf = {
        kind: 'attachmentImages' as const,
        images: [
            {
                id: 'a',
                url: 'https://images.example.test/a',
                filename: 'A.png',
            },
            {
                id: 'b',
                url: 'https://images.example.test/b',
                filename: 'B.png',
            },
        ],
        empty: 'none' as const,
        emptyLabel: 'No files',
    };
    const projection = {
        ...source.projection,
        fields: [{ key: 'legacy', title: 'Files', leaf }],
    };
    await f.render(h(PortalGallery, props([{ ...source, projection }])));
    assert.deepEqual(
        [...f.container.querySelectorAll('img')].map((image) => image.alt),
        ['A.png', 'B.png']
    );
    await f.render(
        h(
            PortalGallery,
            props([
                {
                    ...source,
                    projection: {
                        ...projection,
                        fields: [
                            {
                                ...projection.fields[0]!,
                                leaf: { ...leaf, entries: [] },
                            },
                        ],
                    },
                },
            ])
        )
    );
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(
        f.container.querySelector('.mx-sdk-finder-attachment-filename'),
        null
    );
    assert.equal(f.container.querySelector('button,a,iframe'), null);
    f.unchangedEffects();
});

test('Gallery keeps only carousel UI identity through a loading publication and uses only the successor image vector', async (t) => {
    const f = await htmlPresentationFixture(t);
    const errors: unknown[][] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => {
        errors.push(args);
    });
    const source = row('image-publication');
    if (source.projection.status !== 'present')
        throw new Error('Expected present source');
    const one = {
        id: 'one',
        url: 'https://html-presentation.example.test/one.svg',
        filename: 'One',
    };
    const two = {
        id: 'two',
        url: 'https://html-presentation.example.test/two.svg',
        filename: 'Two',
    };
    const three = {
        id: 'three',
        url: 'https://html-presentation.example.test/three.svg',
        filename: 'Three',
    };
    const present = {
        ...source.projection,
        images: [one, two],
        shouldRenderThumbnail: true,
    };
    await f.render(
        h(PortalGallery, props([{ ...source, projection: present }]))
    );
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
        h(
            PortalGallery,
            props([
                {
                    ...source,
                    projection: {
                        status: 'loading',
                        label: 'Admitting current native leaves',
                    },
                },
            ])
        )
    );
    assert.equal(f.container.querySelector('img'), null);
    assert.equal(
        f.container.querySelector('.mx-sdk-portal-gallery-open'),
        null
    );
    await f.render(
        h(
            PortalGallery,
            props([
                {
                    ...source,
                    projection: { ...present, images: [three, two, one] },
                },
            ])
        )
    );
    assert.equal(
        f.container
            .querySelector('img[data-visible=true]')
            ?.getAttribute('alt'),
        'Two'
    );
    await f.render(
        h(
            PortalGallery,
            props([
                {
                    ...source,
                    projection: {
                        status: 'loading',
                        label: 'Current publication',
                    },
                },
            ])
        )
    );
    await f.render(
        h(
            PortalGallery,
            props([{ ...source, projection: { ...present, images: [three] } }])
        )
    );
    assert.equal(
        f.container
            .querySelector('img[data-visible=true]')
            ?.getAttribute('alt'),
        'Three'
    );
    assert.equal(f.container.querySelector('img[alt=Two]'), null);
    await f.render(
        h(
            PortalGallery,
            props([
                {
                    ...source,
                    projection: {
                        status: 'unavailable',
                        label: 'Current unavailable',
                    },
                },
            ])
        )
    );
    await f.render(
        h(PortalGallery, props([{ ...source, projection: present }]))
    );
    assert.equal(
        f.container
            .querySelector('img[data-visible=true]')
            ?.getAttribute('alt'),
        'One'
    );
    assert.deepEqual(errors, [], 'React lifecycle diagnostics remain clear');
});
